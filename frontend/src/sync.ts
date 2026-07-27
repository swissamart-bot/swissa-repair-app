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
  limit,
  query,
  setDoc,
  where,
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

function sanitizeItem(item: RepairItem): RepairItem & {
  advanceAppliedToItem: number;
  deliveryPaymentAppliedToItem: number;
  totalPaidForItem: number;
  itemBalance: number;
  deliveredAt: string;
  deliveryTxnId: string;
} {
  const amountPaid = item.amountPaid || 0;
  const advanceApplied = item.advanceApplied || 0;
  const finalAmount = Math.max(0, Number(item.finalAmount) || 0);
  const estimatedAmount = Math.max(0, Number(item.estimatedAmount) || 0);
  const itemAmount = finalAmount > 0 ? finalAmount : estimatedAmount;
  const totalPaidForItem = amountPaid + advanceApplied;
  const deliveredAt = item.delivered
    ? (item.deliveredDate || item.updatedAt || '')
    : '';
  return {
    ...item,
    photos: sanitizePhotosForCloud(item.photos),
    amountPaid,
    advanceApplied,
    refundAmount: item.refundAmount || 0,
    nonRefundableCharges: item.nonRefundableCharges || 0,
    returnedDate: item.returnedDate || '',
    selectedPhrases: item.selectedPhrases || [],
    lastDeliveryTxnId: item.lastDeliveryTxnId || '',
    // Portal-friendly aliases (same values; do not change local schema semantics)
    advanceAppliedToItem: advanceApplied,
    deliveryPaymentAppliedToItem: amountPaid,
    totalPaidForItem,
    itemBalance: Math.max(0, itemAmount - totalPaidForItem),
    deliveredAt,
    deliveryTxnId: item.lastDeliveryTxnId || '',
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
    deliveredDate: String(it.deliveredDate || it.deliveredAt || ''),
    lastDeliveryTxnId: String(it.lastDeliveryTxnId || it.deliveryTxnId || ''),
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
  if (!hasFirebaseWebAppConfig()) {
    authenticated = false;
    throw new Error(getFirebaseConfigStatus().message);
  }
  try {
    const auth = getFirebaseAuth();
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    if (!auth.currentUser) {
      authenticated = false;
      throw new Error('Firebase Authentication required: anonymous sign-in failed');
    }
    authenticated = true;
  } catch (e: any) {
    authenticated = false;
    throw new Error(e?.message || 'Firebase Authentication failed');
  }
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

/**
 * True if another non-deleted Firestore job already uses this full Job ID (e.g. M48372).
 * Used for uniqueness — does not rewrite legacy IDs.
 */
export async function isJobNumberTakenInCloud(
  jobNumber: string,
  exceptJobId?: string,
): Promise<boolean> {
  const n = String(jobNumber || '').trim();
  if (!n || !hasFirebaseWebAppConfig()) return false;
  try {
    await ensureAuth();
    const firestore = getFirestoreDb();
    const snap = await getDocs(
      query(
        collection(firestore, FIRESTORE_JOBS_COLLECTION),
        where('jobNumber', '==', n),
        limit(5),
      ),
    );
    return snap.docs.some(d => {
      if (exceptJobId && d.id === exceptJobId) return false;
      const data = d.data() as DocumentData;
      return !data?.deleted;
    });
  } catch (e) {
    console.warn('Cloud Job ID uniqueness check skipped:', e);
    return false;
  }
}

async function isJobCloudEligible(jobId: string): Promise<boolean> {
  if (!SYNC_ENABLED) return false;
  if (SYNC_MIGRATE_EXISTING_LOCAL_JOBS) return true;
  const { getJob } = await dbApi();
  const job = await getJob(jobId);
  return !!job?.cloudSyncEnabled;
}

/** Mark dirty immediately (sync) so a concurrent pull cannot wipe in-flight local edits. */
export function markJobDirtyImmediate(jobId: string): void {
  if (!jobId || !SYNC_ENABLED) return;
  dirtyIds.add(jobId);
  tombstones.delete(jobId);
}

/** Queue a job for upload only if it is cloud-eligible. */
export function scheduleJobSync(jobId: string): void {
  if (!jobId || !SYNC_ENABLED) return;
  // IMMEDIATE dirty — closes race where pull overwrites before eligibility resolves
  markJobDirtyImmediate(jobId);
  persistQueues().catch(() => {});
  emit();
  isJobCloudEligible(jobId)
    .then(ok => {
      if (!ok) {
        dirtyIds.delete(jobId);
        persistQueues().catch(() => {});
        emit();
        return;
      }
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
  for (const id of jobIds) {
    if (id) markJobDirtyImmediate(id);
  }
  Promise.all(jobIds.map(async id => {
    if (!id) return;
    if (!(await isJobCloudEligible(id))) {
      dirtyIds.delete(id);
    }
  }))
    .then(() => {
      persistQueues().catch(() => {});
      emit();
      scheduleSyncSoon();
    })
    .catch(() => {});
}

/**
 * Push one job to Firestore now and wait for completion.
 * Used after delivery so Records/cloud match before success UI.
 */
export async function pushJobNow(jobId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!jobId) return { ok: false, error: 'Missing job id' };
  if (!SYNC_ENABLED) return { ok: true, skipped: true };
  if (!online) {
    // Local SQLite already verified; queue for next online sync.
    markJobDirtyImmediate(jobId);
    persistQueues().catch(() => {});
    emit();
    console.log('[delivery-debug] Firestore push deferred (offline)', { jobId });
    return { ok: true, skipped: true };
  }

  try {
    if (!hasFirebaseWebAppConfig()) {
      return { ok: false, error: getFirebaseConfigStatus().message };
    }
    await ensureAuth();
    const { getJob } = await dbApi();
    const job = await getJob(jobId);
    if (!job) return { ok: false, error: 'Job not found after delivery' };
    if (!job.cloudSyncEnabled && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
      return { ok: true, skipped: true };
    }

    markJobDirtyImmediate(jobId);
    const firestore = getFirestoreDb();
    const pushedAt = effectiveUpdatedAt(job);
    const payload = toFirestoreDoc(job, false);
    await setDoc(doc(firestore, FIRESTORE_JOBS_COLLECTION, jobId), payload, { merge: false });

    const latest = await getJob(jobId);
    if (!latest || effectiveUpdatedAt(latest) === pushedAt) {
      dirtyIds.delete(jobId);
    }
    await persistQueues();
    emit();
    console.log('[delivery-debug] Firestore push OK', {
      jobId,
      items: (payload.items || []).map((it: any) => ({
        id: it.id,
        status: it.status,
        delivered: it.delivered,
        amountPaid: it.amountPaid,
        advanceApplied: it.advanceApplied,
        totalPaidForItem: it.totalPaidForItem,
        itemBalance: it.itemBalance,
        deliveryTxnId: it.deliveryTxnId || it.lastDeliveryTxnId,
      })),
    });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('[delivery-debug] Firestore push FAILED', jobId, msg);
    return { ok: false, error: msg };
  }
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
      const status = getFirebaseConfigStatus();
      firestoreReachable = false;
      authenticated = false;
      await setLastError(status.message);
      await setLastMessage(null);
      return;
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
    try {
      authenticated = !!getFirebaseAuth().currentUser;
    } catch {
      authenticated = false;
    }
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
    // Always re-read immediately before upload so a delivery mid-sync is not missed.
    const job = await getJob(id);
    if (!job) {
      dirtyIds.delete(id);
      continue;
    }
    if (!job.cloudSyncEnabled && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
      dirtyIds.delete(id);
      continue;
    }
    const pushedAt = effectiveUpdatedAt(job);
    const payload = toFirestoreDoc(job, false);
    await setDoc(doc(firestore, FIRESTORE_JOBS_COLLECTION, id), payload, { merge: false });
    // Only clear dirty if nothing newer was written locally during the network await.
    const latest = await getJob(id);
    if (!latest || effectiveUpdatedAt(latest) === pushedAt) {
      dirtyIds.delete(id);
    }
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

  await runWithoutCloudSyncNotify(async () => {
    for (const remote of remoteById.values()) {
      // Always re-read local — never trust a stale snapshot while deliveries may be in flight.
      const local = await getJob(remote.id);
      const remoteTs = remote.updatedAt || remote.deletedAt || '';
      const localTs = local ? effectiveUpdatedAt(local) : '';

      // Historical local-only jobs: never overwrite from cloud
      if (local && !local.cloudSyncEnabled && !SYNC_MIGRATE_EXISTING_LOCAL_JOBS) {
        continue;
      }

      // Pending local delivery/payment must not be overwritten by an older cloud doc.
      if (local && dirtyIds.has(remote.id)) {
        if (!remoteTs || localTs >= remoteTs) {
          continue;
        }
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
      const localJobs = await getAllJobs();
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
