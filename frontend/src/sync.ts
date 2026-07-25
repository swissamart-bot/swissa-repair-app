/**
 * Firestore live sync for repair jobs.
 *
 * SYNC_ENABLED — live sync of cloud-eligible jobs (new / explicitly enabled).
 * SYNC_MIGRATE_EXISTING_LOCAL_JOBS — bulk upload of historical local jobs (OFF).
 *
 * Local SQLite remains source of truth for historical jobs until opted in.
 */
import NetInfo from '@react-native-community/netinfo';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import type { RepairJob, RepairItem } from './types';
import {
  FIRESTORE_JOBS_COLLECTION,
  getFirebaseAuth,
  getFirestoreDb,
  hasFirebaseWebAppConfig,
  getFirebaseConfigStatus,
} from './firebase';
import { sanitizePhotosForCloud, normalizePhotos } from './photos';
import { pullShopSettingsFromCloud, pushShopSettingsToCloud } from './shopSettings';

export type SyncUiStatus = 'synced' | 'syncing' | 'offline' | 'error';

/** Master switch: allow Firestore sync for cloud-eligible jobs. */
export const SYNC_ENABLED: boolean = true;

/**
 * Bulk migration of ALL existing local jobs — keep OFF until explicitly approved.
 * Does not block new / cloudSyncEnabled jobs.
 */
export const SYNC_MIGRATE_EXISTING_LOCAL_JOBS: boolean = false;

export type SyncDetailMeta = {
  status: SyncUiStatus;
  authenticated: boolean;
  firestoreReachable: boolean;
  pendingCount: number;
  uploadedCount: number;
  downloadedCount: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastMessage: string | null;
  syncEnabled: boolean;
  migrateExisting: boolean;
};

type SyncListener = (status: SyncUiStatus) => void;

type Tombstone = { id: string; updatedAt: string };

type FirestoreJobDoc = {
  id: string;
  jobNumber: string;
  customerName: string;
  mobileNumber: string;
  countryCode: string;
  receivedDate: string;
  advanceAmount: number;
  overallNotes: string;
  googleReviewSent: boolean;
  cloudSyncEnabled: boolean;
  items: RepairItem[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  deletedAt: string;
};

const DIRTY_KEY = 'sync_dirty_job_ids';
const TOMBSTONE_KEY = 'sync_pending_deletes';
const LAST_SYNC_KEY = 'sync_last_success_at';
const LAST_ERROR_KEY = 'sync_last_error';
const LAST_MSG_KEY = 'sync_last_message';
const UPLOADED_TOTAL_KEY = 'sync_uploaded_total';
const DOWNLOADED_TOTAL_KEY = 'sync_downloaded_total';

const PUSH_DEBOUNCE_MS = 1500;

let online = true;
let syncing = false;
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAfterRun = false;
let netUnsub: (() => void) | null = null;

const listeners = new Set<SyncListener>();
let lastError: string | null = null;
let lastSuccessAt: string | null = null;
let lastMessage: string | null = null;
let authenticated = false;
let firestoreReachable = false;
let lastCycleUploaded = 0;
let lastCycleDownloaded = 0;
let uploadedTotal = 0;
let downloadedTotal = 0;

const dirtyIds = new Set<string>();
const tombstones = new Map<string, string>();

function emit(): void {
  const status = getSyncStatus();
  listeners.forEach(l => {
    try { l(status); } catch { /* ignore */ }
  });
}

export function getSyncStatus(): SyncUiStatus {
  if (!online) return 'offline';
  if (syncing) return 'syncing';
  if (lastError) return 'error';
  if (dirtyIds.size > 0 || tombstones.size > 0) return 'syncing';
  return 'synced';
}

export function subscribeSyncStatus(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getSyncStatus());
  return () => { listeners.delete(listener); };
}

export function getSyncMeta(): SyncDetailMeta {
  return {
    status: getSyncStatus(),
    authenticated,
    firestoreReachable,
    pendingCount: dirtyIds.size + tombstones.size,
    uploadedCount: uploadedTotal,
    downloadedCount: downloadedTotal,
    lastSuccessAt,
    lastError,
    lastMessage,
    syncEnabled: SYNC_ENABLED,
    migrateExisting: SYNC_MIGRATE_EXISTING_LOCAL_JOBS,
  };
}

async function dbApi() {
  return import('./database');
}

async function persistQueues(): Promise<void> {
  const { setConfig } = await dbApi();
  await setConfig(DIRTY_KEY, JSON.stringify([...dirtyIds]));
  const tombs: Tombstone[] = [...tombstones.entries()].map(([id, updatedAt]) => ({ id, updatedAt }));
  await setConfig(TOMBSTONE_KEY, JSON.stringify(tombs));
}

async function loadQueues(): Promise<void> {
  const { getConfig } = await dbApi();
  try {
    const dirtyRaw = await getConfig(DIRTY_KEY);
    if (dirtyRaw) {
      const arr = JSON.parse(dirtyRaw);
      if (Array.isArray(arr)) arr.forEach((id: string) => { if (id) dirtyIds.add(String(id)); });
    }
  } catch { /* ignore */ }
  try {
    const tombRaw = await getConfig(TOMBSTONE_KEY);
    if (tombRaw) {
      const arr = JSON.parse(tombRaw);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (t?.id) tombstones.set(String(t.id), String(t.updatedAt || new Date().toISOString()));
        }
      }
    }
  } catch { /* ignore */ }
  try {
    lastSuccessAt = await getConfig(LAST_SYNC_KEY);
    lastError = (await getConfig(LAST_ERROR_KEY)) || null;
    if (lastError === '') lastError = null;
    lastMessage = (await getConfig(LAST_MSG_KEY)) || null;
    if (lastMessage === '') lastMessage = null;
    uploadedTotal = Number(await getConfig(UPLOADED_TOTAL_KEY)) || 0;
    downloadedTotal = Number(await getConfig(DOWNLOADED_TOTAL_KEY)) || 0;
  } catch { /* ignore */ }
}

export function effectiveUpdatedAt(job: Pick<RepairJob, 'updatedAt' | 'items'>): string {
  let max = job.updatedAt || '';
  for (const item of job.items || []) {
    if (item.updatedAt && item.updatedAt > max) max = item.updatedAt;
  }
  return max || new Date().toISOString();
}

function sanitizeItem(item: RepairItem): RepairItem {
  return {
    ...item,
    photos: sanitizePhotosForCloud(item.photos),
    amountPaid: item.amountPaid || 0,
    advanceApplied: item.advanceApplied || 0,
    refundAmount: item.refundAmount || 0,
    nonRefundableCharges: item.nonRefundableCharges || 0,
    returnedDate: item.returnedDate || '',
    selectedPhrases: item.selectedPhrases || [],
  };
}

function toFirestoreDoc(job: RepairJob, deleted = false): FirestoreJobDoc {
  const items = (job.items || []).map(sanitizeItem);
  const updatedAt = effectiveUpdatedAt({ ...job, items });
  return {
    id: job.id,
    jobNumber: job.jobNumber || '',
    customerName: job.customerName || '',
    mobileNumber: job.mobileNumber || '',
    countryCode: job.countryCode || '+91',
    receivedDate: job.receivedDate || '',
    advanceAmount: Number(job.advanceAmount) || 0,
    overallNotes: job.overallNotes || '',
    googleReviewSent: !!job.googleReviewSent,
    cloudSyncEnabled: true,
    items,
    createdAt: job.createdAt || updatedAt,
    updatedAt,
    deleted,
    deletedAt: deleted ? updatedAt : '',
  };
}

function fromFirestoreDoc(data: DocumentData): FirestoreJobDoc | null {
  if (!data || !data.id) return null;
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items: RepairItem[] = itemsRaw.map((it: any) => ({
    id: String(it.id || ''),
    jobId: String(it.jobId || data.id),
    itemNumber: Number(it.itemNumber) || 1,
    itemType: String(it.itemType || 'Watch'),
    brand: String(it.brand || ''),
    model: String(it.model || ''),
    color: String(it.color || ''),
    identification: String(it.identification || ''),
    description: String(it.description || ''),
    selectedPhrases: Array.isArray(it.selectedPhrases) ? it.selectedPhrases.map(String) : [],
    customerComplaint: String(it.customerComplaint || ''),
    accessoriesReceived: String(it.accessoriesReceived || ''),
    estimatedAmount: Number(it.estimatedAmount) || 0,
    finalAmount: Number(it.finalAmount) || 0,
    amountPaid: Number(it.amountPaid) || 0,
    advanceApplied: Number(it.advanceApplied) || 0,
    refundAmount: Number(it.refundAmount) || 0,
    nonRefundableCharges: Number(it.nonRefundableCharges) || 0,
    returnedDate: String(it.returnedDate || ''),
    technicianNotes: String(it.technicianNotes || ''),
    photos: normalizePhotos(it.photos),
    status: String(it.status || 'Received'),
    expectedDeliveryDate: String(it.expectedDeliveryDate || ''),
    warrantyDetails: String(it.warrantyDetails || ''),
    delivered: !!it.delivered,
    deliveredDate: String(it.deliveredDate || ''),
    createdAt: String(it.createdAt || ''),
    updatedAt: String(it.updatedAt || ''),
  }));
  return {
    id: String(data.id),
    jobNumber: String(data.jobNumber || ''),
    customerName: String(data.customerName || ''),
    mobileNumber: String(data.mobileNumber || ''),
    countryCode: String(data.countryCode || '+91'),
    receivedDate: String(data.receivedDate || ''),
    advanceAmount: Number(data.advanceAmount) || 0,
    overallNotes: String(data.overallNotes || ''),
    googleReviewSent: !!data.googleReviewSent,
    cloudSyncEnabled: data.cloudSyncEnabled !== false,
    items,
    createdAt: String(data.createdAt || ''),
    updatedAt: String(data.updatedAt || ''),
    deleted: !!data.deleted,
    deletedAt: String(data.deletedAt || ''),
  };
}

async function ensureAuth(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  if (!auth.currentUser) {
    authenticated = false;
    throw new Error('Firebase Authentication required: anonymous sign-in failed');
  }
  authenticated = true;
}

async function setLastError(msg: string | null): Promise<void> {
  lastError = msg;
  try {
    const { setConfig } = await dbApi();
    await setConfig(LAST_ERROR_KEY, msg || '');
  } catch { /* ignore */ }
}

async function setLastSuccess(iso: string): Promise<void> {
  lastSuccessAt = iso;
  try {
    const { setConfig } = await dbApi();
    await setConfig(LAST_SYNC_KEY, iso);
  } catch { /* ignore */ }
}

async function setLastMessage(msg: string | null): Promise<void> {
  lastMessage = msg;
  try {
    const { setConfig } = await dbApi();
    await setConfig(LAST_MSG_KEY, msg || '');
  } catch { /* ignore */ }
}

async function persistCounters(): Promise<void> {
  try {
    const { setConfig } = await dbApi();
    await setConfig(UPLOADED_TOTAL_KEY, String(uploadedTotal));
    await setConfig(DOWNLOADED_TOTAL_KEY, String(downloadedTotal));
  } catch { /* ignore */ }
}

async function isJobCloudEligible(jobId: string): Promise<boolean> {
  if (!SYNC_ENABLED) return false;
  if (SYNC_MIGRATE_EXISTING_LOCAL_JOBS) return true;
  const { getJob } = await dbApi();
  const job = await getJob(jobId);
  return !!job?.cloudSyncEnabled;
}

/** Queue a job for upload only if it is cloud-eligible. */
export function scheduleJobSync(jobId: string): void {
  if (!jobId || !SYNC_ENABLED) return;
  isJobCloudEligible(jobId)
    .then(ok => {
      if (!ok) return;
      dirtyIds.add(jobId);
      tombstones.delete(jobId);
      persistQueues().catch(() => {});
      emit();
      scheduleSyncSoon();
    })
    .catch(() => {});
}

export function scheduleJobDeleted(
  jobId: string,
  updatedAt?: string,
  wasCloudSynced?: boolean,
): void {
  if (!jobId || !SYNC_ENABLED) return;
  // Only push tombstones for jobs that were already on cloud / cloud-enabled
  if (!wasCloudSynced && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) return;
  dirtyIds.delete(jobId);
  tombstones.set(jobId, updatedAt || new Date().toISOString());
  persistQueues().catch(() => {});
  emit();
  scheduleSyncSoon();
}

export function scheduleJobsSync(jobIds: string[]): void {
  if (!SYNC_ENABLED) return;
  Promise.all(jobIds.map(async id => {
    if (!id) return;
    if (await isJobCloudEligible(id)) {
      dirtyIds.add(id);
      tombstones.delete(id);
    }
  }))
    .then(() => {
      persistQueues().catch(() => {});
      emit();
      scheduleSyncSoon();
    })
    .catch(() => {});
}

/** Staff opt-in: enable cloud sync for one historical job and queue upload. */
export async function enableCloudSyncForJob(jobId: string): Promise<void> {
  const { setJobCloudSyncEnabled } = await dbApi();
  await setJobCloudSyncEnabled(jobId, true);
  dirtyIds.add(jobId);
  tombstones.delete(jobId);
  await persistQueues();
  emit();
  scheduleSyncSoon(0);
}

export function scheduleFullSync(): void {
  scheduleSyncSoon(0);
}

function scheduleSyncSoon(delay = PUSH_DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runSyncCycle().catch(e => console.warn('Sync cycle failed:', e));
  }, delay);
}

/**
 * Push dirty cloud-eligible jobs + tombstones, then pull & merge.
 */
export async function runSyncCycle(opts?: { pullOnly?: boolean }): Promise<void> {
  if (!online) {
    emit();
    return;
  }
  if (syncing) {
    pendingAfterRun = true;
    return;
  }
  syncing = true;
  lastCycleUploaded = 0;
  lastCycleDownloaded = 0;
  emit();

  try {
    if (!hasFirebaseWebAppConfig()) {
      throw new Error(getFirebaseConfigStatus().message);
    }
    if (!SYNC_ENABLED) {
      await setLastMessage('Cloud sync is disabled (SYNC_ENABLED=false)');
      await setLastError(null);
      firestoreReachable = false;
      return;
    }

    await ensureAuth();

    if (!opts?.pullOnly) {
      await pushPending();
    }
    await pullAndMerge();
    if (!opts?.pullOnly && (dirtyIds.size > 0 || tombstones.size > 0)) {
      await pushPending();
    }

    firestoreReachable = true;
    uploadedTotal += lastCycleUploaded;
    downloadedTotal += lastCycleDownloaded;
    await persistCounters();

    const pending = dirtyIds.size + tombstones.size;
    let message: string;
    if (lastCycleUploaded === 0 && lastCycleDownloaded === 0 && pending === 0) {
      message = 'No records eligible for upload (historical jobs stay local until Enable cloud sync)';
    } else {
      const parts: string[] = [];
      if (lastCycleUploaded > 0) parts.push(`Uploaded ${lastCycleUploaded}`);
      if (lastCycleDownloaded > 0) parts.push(`Downloaded ${lastCycleDownloaded}`);
      if (pending > 0) parts.push(`${pending} still pending`);
      message = parts.join(' · ') || 'Sync complete';
    }

    await setLastMessage(message);
    await setLastSuccess(new Date().toISOString());
    await setLastError(null);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('Firestore sync error:', msg);
    firestoreReachable = /permission|unauth|offline|network|unavailable/i.test(msg)
      ? false
      : firestoreReachable;
    if (/permission/i.test(msg)) firestoreReachable = false;
    authenticated = !!getFirebaseAuth().currentUser;
    await setLastError(msg);
    await setLastMessage(null);
  } finally {
    syncing = false;
    emit();
    if (pendingAfterRun) {
      pendingAfterRun = false;
      scheduleSyncSoon(400);
    }
  }
}

async function pushPending(): Promise<void> {
  const { getJob } = await dbApi();
  const firestore = getFirestoreDb();

  const tombEntries = [...tombstones.entries()];
  for (const [id, updatedAt] of tombEntries) {
    const payload: FirestoreJobDoc = {
      id,
      jobNumber: '',
      customerName: '',
      mobileNumber: '',
      countryCode: '+91',
      receivedDate: '',
      advanceAmount: 0,
      overallNotes: '',
      googleReviewSent: false,
      cloudSyncEnabled: true,
      items: [],
      createdAt: updatedAt,
      updatedAt,
      deleted: true,
      deletedAt: updatedAt,
    };
    await setDoc(doc(firestore, FIRESTORE_JOBS_COLLECTION, id), payload, { merge: true });
    tombstones.delete(id);
    lastCycleUploaded += 1;
  }

  const ids = [...dirtyIds];
  for (const id of ids) {
    const job = await getJob(id);
    if (!job) {
      dirtyIds.delete(id);
      continue;
    }
    if (!job.cloudSyncEnabled && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
      dirtyIds.delete(id);
      continue;
    }
    const payload = toFirestoreDoc(job, false);
    await setDoc(doc(firestore, FIRESTORE_JOBS_COLLECTION, id), payload, { merge: false });
    dirtyIds.delete(id);
    lastCycleUploaded += 1;
  }

  await persistQueues();
}

async function pullAndMerge(): Promise<void> {
  const {
    getAllJobs,
    getJob,
    upsertFullJobFromCloud,
    deleteJobLocalOnly,
    runWithoutCloudSyncNotify,
  } = await dbApi();

  const firestore = getFirestoreDb();
  const snap = await getDocs(collection(firestore, FIRESTORE_JOBS_COLLECTION));
  firestoreReachable = true;
  const remoteById = new Map<string, FirestoreJobDoc>();

  snap.forEach(d => {
    const parsed = fromFirestoreDoc({ id: d.id, ...d.data() });
    if (parsed) remoteById.set(parsed.id, parsed);
  });

  const localJobs = await getAllJobs();
  const localById = new Map(localJobs.map(j => [j.id, j]));

  await runWithoutCloudSyncNotify(async () => {
    for (const remote of remoteById.values()) {
      const local = localById.get(remote.id) || (await getJob(remote.id));
      const remoteTs = remote.updatedAt || remote.deletedAt || '';
      const localTs = local ? effectiveUpdatedAt(local) : '';

      // Historical local-only jobs: never overwrite from cloud
      if (local && !local.cloudSyncEnabled && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
        continue;
      }

      if (remote.deleted) {
        if (!local) continue;
        if (!localTs || remoteTs >= localTs) {
          await deleteJobLocalOnly(remote.id);
          dirtyIds.delete(remote.id);
          tombstones.delete(remote.id);
          lastCycleDownloaded += 1;
        } else {
          dirtyIds.add(remote.id);
          tombstones.delete(remote.id);
        }
        continue;
      }

      const remoteJob: RepairJob = {
        id: remote.id,
        jobNumber: remote.jobNumber,
        customerName: remote.customerName,
        mobileNumber: remote.mobileNumber,
        countryCode: remote.countryCode,
        receivedDate: remote.receivedDate,
        advanceAmount: remote.advanceAmount,
        overallNotes: remote.overallNotes,
        googleReviewSent: remote.googleReviewSent,
        cloudSyncEnabled: true,
        items: remote.items,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
      };

      if (!local) {
        await upsertFullJobFromCloud(remoteJob);
        dirtyIds.delete(remote.id);
        lastCycleDownloaded += 1;
        continue;
      }

      if (remoteTs > localTs) {
        await upsertFullJobFromCloud({ ...remoteJob, cloudSyncEnabled: true });
        dirtyIds.delete(remote.id);
        lastCycleDownloaded += 1;
      } else if (localTs > remoteTs && local.cloudSyncEnabled) {
        dirtyIds.add(remote.id);
      }
    }

    // Bulk migrate historical local-only jobs — only when flag is ON
    if (SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
      const { setJobCloudSyncEnabled } = await dbApi();
      for (const local of localJobs) {
        if (!remoteById.has(local.id)) {
          if (!local.cloudSyncEnabled) {
            await setJobCloudSyncEnabled(local.id, true);
          }
          dirtyIds.add(local.id);
        }
      }
    }
  });

  await persistQueues();
}

export async function initCloudSync(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await loadQueues();

  // One-time: clear old bulk-seed queues; keep dirty only for cloud-eligible jobs later
  try {
    const { getConfig, setConfig, getJob } = await dbApi();
    const cleared = await getConfig('sync_eligibility_v3');
    if (!cleared) {
      const keep = new Set<string>();
      for (const id of [...dirtyIds]) {
        const job = await getJob(id);
        if (job?.cloudSyncEnabled) keep.add(id);
      }
      dirtyIds.clear();
      keep.forEach(id => dirtyIds.add(id));
      // Drop tombstones that were from pre-eligibility era unless migrate is on
      if (!SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
        tombstones.clear();
      }
      await persistQueues();
      await setConfig('sync_eligibility_v3', 'true');
      await setConfig('sync_seeded_v1', 'skipped_pending_approval');
    }
  } catch (e) {
    console.warn('Sync eligibility reset failed:', e);
  }

  const state = await NetInfo.fetch();
  online = !!(state.isConnected && state.isInternetReachable !== false);
  emit();

  netUnsub = NetInfo.addEventListener(s => {
    const next = !!(s.isConnected && s.isInternetReachable !== false);
    const wasOffline = !online;
    online = next;
    emit();
    if (wasOffline && online) {
      scheduleSyncSoon(500);
    }
  });

  // Shop settings (Google Review defaults) — pull then push local if newer
  try {
    await pullShopSettingsFromCloud();
    await pushShopSettingsToCloud();
  } catch (e) {
    console.warn('Shop settings sync skipped:', e);
  }

  if (online && SYNC_ENABLED) {
    await runSyncCycle();
  } else {
    emit();
  }
}

export function stopCloudSync(): void {
  if (netUnsub) {
    netUnsub();
    netUnsub = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  initialized = false;
}

/** Manual Sync Now from Settings. */
export async function syncNow(): Promise<{
  ok: boolean;
  error?: string;
  message?: string;
  uploaded?: number;
  downloaded?: number;
  pending?: number;
}> {
  if (!online) return { ok: false, error: 'Device is offline' };
  await runSyncCycle();
  const meta = getSyncMeta();
  if (meta.lastError) {
    return { ok: false, error: meta.lastError, message: meta.lastMessage || undefined };
  }
  return {
    ok: true,
    message: meta.lastMessage || undefined,
    uploaded: lastCycleUploaded,
    downloaded: lastCycleDownloaded,
    pending: meta.pendingCount,
  };
}
