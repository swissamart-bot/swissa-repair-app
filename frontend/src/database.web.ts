import {
  RepairJob, RepairItem, CustomPhrase, BackupData,
  DiagnosisPhrase, DiagnosisCategory,
  DEFAULT_DIAGNOSIS_PHRASES, MAX_DIAGNOSIS_FAVOURITES, DIAGNOSIS_ITEM_TYPES,
  normalizeDiagnosisPhraseKey, normalizeServicePhraseKey, SERVICE_PHRASE_ALL_ITEMS,
  mapDiagnosisCategoryToItemType,
} from './types';
import { DEFAULT_PHRASES } from './constants';
import { normalizePhotos } from './photos';

let memJobs: RepairJob[] = [];
let memPhrases: CustomPhrase[] = [];
let memConfig: Record<string, string> = {};
let memDiagCats: DiagnosisCategory[] = [];
let memDiagPhrases: DiagnosisPhrase[] = [];
let diagSeeded = false;
let serviceSeeded = false;

let suppressCloudSyncNotify = false;

export async function runWithoutCloudSyncNotify<T>(fn: () => Promise<T>): Promise<T> {
  const prev = suppressCloudSyncNotify;
  suppressCloudSyncNotify = true;
  try {
    return await fn();
  } finally {
    suppressCloudSyncNotify = prev;
  }
}

function notifyBackup(): void {
  import('./backup').then(m => m.scheduleAutoBackup('web-data')).catch(() => {});
}

function notifyDataChanged(opts?: {
  jobId?: string;
  jobIds?: string[];
  deletedJobId?: string;
  deletedAt?: string;
  wasCloudSynced?: boolean;
}): void {
  notifyBackup();
  if (suppressCloudSyncNotify) return;
  import('./sync')
    .then(m => {
      if (opts?.deletedJobId) m.scheduleJobDeleted(opts.deletedJobId, opts.deletedAt, opts.wasCloudSynced);
      else if (opts?.jobIds?.length) m.scheduleJobsSync(opts.jobIds);
      else if (opts?.jobId) m.scheduleJobSync(opts.jobId);
    })
    .catch(() => {});
}

function seedServicePhraseLibrary() {
  if (serviceSeeded) return;
  if (memPhrases.length === 0) {
    let order = 0;
    for (const [itemType, phrases] of Object.entries(DEFAULT_PHRASES)) {
      for (const phrase of phrases) {
        memPhrases.push({
          id: `sph_web_${order}`,
          itemType,
          phrase,
          isEnabled: true,
          sortOrder: order++,
        });
      }
    }
  } else {
    memPhrases = memPhrases.map((p, i) => ({
      ...p,
      isEnabled: p.isEnabled !== false,
      sortOrder: p.sortOrder ?? i,
    }));
  }
  serviceSeeded = true;
}

function seedDiagnosisLibrary() {
  if (diagSeeded) return;
  memDiagCats = DIAGNOSIS_ITEM_TYPES.map((name, i) => ({
    id: `ditem_${name.replace(/\s+/g, '_').toLowerCase()}`,
    name,
    sortOrder: i,
  }));
  if (memDiagPhrases.length === 0) {
    const now = new Date().toISOString();
    memDiagPhrases = DEFAULT_DIAGNOSIS_PHRASES.map((p, i) => ({
      id: `dph_web_${i}`,
      phrase: p.phrase,
      itemType: p.itemType,
      isFavourite: false,
      isEnabled: true,
      sortOrder: i,
      useCount: 0,
      lastUsedAt: '',
      createdAt: now,
      updatedAt: now,
    }));
  } else {
    memDiagPhrases = memDiagPhrases.map(p => ({
      ...p,
      itemType: mapDiagnosisCategoryToItemType((p as any).itemType || (p as any).category || 'Watch', p.phrase),
    }));
  }
  diagSeeded = true;
}

export async function initDB(): Promise<void> {
  seedServicePhraseLibrary();
  seedDiagnosisLibrary();
}

export async function createJob(job: Omit<RepairJob,'items'>, items: RepairItem[]): Promise<void> {
  let cloudSyncEnabled = job.cloudSyncEnabled !== false;
  try {
    const sync = await import('./sync');
    cloudSyncEnabled = sync.SYNC_ENABLED && job.cloudSyncEnabled !== false;
  } catch { /* keep */ }
  memJobs.unshift({
    ...job,
    cloudSyncEnabled,
    items: items.map(i => ({ ...i, photos: normalizePhotos(i.photos) })),
  });
  notifyDataChanged({ jobId: job.id });
}

export async function getAllJobs(): Promise<RepairJob[]> {
  return memJobs.map(j => ({
    ...j,
    items: j.items.map(i => ({ ...i, photos: normalizePhotos(i.photos) })),
  }));
}

export async function getJob(id: string): Promise<RepairJob|null> {
  const j = memJobs.find(j => j.id === id);
  if (!j) return null;
  return {
    ...j,
    items: j.items.map(i => ({ ...i, photos: normalizePhotos(i.photos) })),
  };
}

export async function countJobsByCustomer(mobileNumber: string, customerName: string): Promise<number> {
  const mobile = String(mobileNumber || '').trim();
  const name = String(customerName || '').trim().toLowerCase();
  if (mobile) return memJobs.filter(j => j.mobileNumber === mobile).length;
  if (name) return memJobs.filter(j => !String(j.mobileNumber || '').trim() && j.customerName.toLowerCase() === name).length;
  return 0;
}

export async function getJobsByCustomer(mobileNumber: string, customerName: string): Promise<RepairJob[]> {
  const mobile = String(mobileNumber || '').trim();
  const name = String(customerName || '').trim().toLowerCase();
  let list: RepairJob[] = [];
  if (mobile) list = memJobs.filter(j => j.mobileNumber === mobile);
  else if (name) list = memJobs.filter(j => !String(j.mobileNumber || '').trim() && j.customerName.toLowerCase() === name);
  return list
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map(j => ({
      ...j,
      items: j.items.map(i => ({ ...i, photos: [] })),
    }));
}

export async function updateJob(job: Omit<RepairJob,'items'>): Promise<void> {
  const idx = memJobs.findIndex(j => j.id === job.id);
  const now = new Date().toISOString();
  if (idx !== -1) memJobs[idx] = { ...memJobs[idx], ...job, updatedAt: now };
  notifyDataChanged({ jobId: job.id });
}

export async function updateItem(item: RepairItem): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const idx = j.items.findIndex(i => i.id === item.id);
    if (idx !== -1) {
      j.items[idx] = { ...item, photos: normalizePhotos(item.photos), updatedAt: now };
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function addItemToJob(item: RepairItem): Promise<void> {
  const j = memJobs.find(j => j.id === item.jobId);
  const now = new Date().toISOString();
  if (j) {
    j.items.push({ ...item, photos: normalizePhotos(item.photos) });
    j.updatedAt = now;
  }
  notifyDataChanged({ jobId: item.jobId });
}

export async function deleteItem(id: string): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const before = j.items.length;
    j.items = j.items.filter(i => i.id !== id);
    if (j.items.length !== before) {
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function deleteJob(id: string): Promise<void> {
  const existing = memJobs.find(j => j.id === id);
  const now = new Date().toISOString();
  memJobs = memJobs.filter(j => j.id !== id);
  notifyDataChanged({
    deletedJobId: id,
    deletedAt: now,
    wasCloudSynced: !!existing?.cloudSyncEnabled,
  });
}

export async function setJobCloudSyncEnabled(jobId: string, enabled: boolean): Promise<void> {
  const j = memJobs.find(x => x.id === jobId);
  if (!j) return;
  j.cloudSyncEnabled = enabled;
  j.updatedAt = new Date().toISOString();
  if (enabled) notifyDataChanged({ jobId });
  else notifyBackup();
}

export async function markItemDelivered(
  id: string,
  date: string,
  amountPaid?: number,
  advanceApplied?: number,
): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const item = j.items.find(i => i.id === id);
    if (item) {
      item.delivered = true;
      item.deliveredDate = date;
      item.status = 'Delivered';
      item.updatedAt = now;
      if (amountPaid !== undefined) item.amountPaid = Math.max(0, amountPaid);
      if (advanceApplied !== undefined) item.advanceApplied = Math.max(0, advanceApplied);
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function markItemReturned(
  id: string,
  date: string,
  refundAmount: number,
  nonRefundableCharges: number,
): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const item = j.items.find(i => i.id === id);
    if (item) {
      item.status = 'Not Repaired';
      item.returnedDate = date;
      item.refundAmount = Math.max(0, Number(refundAmount) || 0);
      item.nonRefundableCharges = Math.max(0, Number(nonRefundableCharges) || 0);
      item.delivered = false;
      item.updatedAt = now;
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function getCustomPhrases(itemType: string): Promise<CustomPhrase[]> {
  seedServicePhraseLibrary();
  return memPhrases
    .filter(p => p.itemType === itemType)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.phrase.localeCompare(b.phrase));
}

export async function getAllCustomPhrases(): Promise<CustomPhrase[]> {
  seedServicePhraseLibrary();
  return [...memPhrases].sort((a, b) => a.sortOrder - b.sortOrder || a.phrase.localeCompare(b.phrase));
}

export async function getServicePhrasesForItem(itemType: string): Promise<CustomPhrase[]> {
  seedServicePhraseLibrary();
  return memPhrases
    .filter(p => p.isEnabled && (p.itemType === itemType || p.itemType === SERVICE_PHRASE_ALL_ITEMS))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.phrase.localeCompare(b.phrase));
}

export async function addCustomPhrase(id: string, itemType: string, phrase: string): Promise<void> {
  await addServicePhrase(phrase, itemType, true, id);
}

export async function addServicePhrase(
  phrase: string,
  itemType: string,
  isEnabled = true,
  id?: string
): Promise<CustomPhrase> {
  seedServicePhraseLibrary();
  const trimmed = phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Phrase cannot be blank');
  const type = (itemType || 'Watch').trim() || 'Watch';
  const key = normalizeServicePhraseKey(trimmed);
  if (memPhrases.some(p => p.itemType === type && normalizeServicePhraseKey(p.phrase) === key)) {
    throw new Error('A service phrase with this text already exists for this item type');
  }
  const max = memPhrases.reduce((m, p) => Math.max(m, p.sortOrder), 0);
  const row: CustomPhrase = {
    id: id || `sph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemType: type,
    phrase: trimmed,
    isEnabled,
    sortOrder: max + 1,
  };
  memPhrases.push(row);
  return row;
}

export async function updateServicePhrase(
  id: string,
  patch: Partial<Pick<CustomPhrase, 'phrase' | 'itemType' | 'isEnabled' | 'sortOrder'>>
): Promise<void> {
  const idx = memPhrases.findIndex(p => p.id === id);
  if (idx === -1) return;
  const existing = memPhrases[idx];
  let phrase = existing.phrase;
  if (patch.phrase !== undefined) {
    phrase = patch.phrase.trim().replace(/\s+/g, ' ');
    if (!phrase) throw new Error('Phrase cannot be blank');
  }
  const itemType = patch.itemType !== undefined ? patch.itemType : existing.itemType;
  const key = normalizeServicePhraseKey(phrase);
  if (memPhrases.some(p => p.id !== id && p.itemType === itemType && normalizeServicePhraseKey(p.phrase) === key)) {
    throw new Error('A service phrase with this text already exists for this item type');
  }
  memPhrases[idx] = {
    ...existing,
    phrase,
    itemType,
    isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : existing.isEnabled,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder,
  };
}

export async function deleteCustomPhrase(id: string): Promise<void> {
  memPhrases = memPhrases.filter(p => p.id !== id);
}

export async function reorderServicePhrases(orderedIds: string[]): Promise<void> {
  orderedIds.forEach((id, i) => {
    const idx = memPhrases.findIndex(p => p.id === id);
    if (idx !== -1) memPhrases[idx] = { ...memPhrases[idx], sortOrder: i };
  });
}

export async function getDiagnosisCategories(): Promise<DiagnosisCategory[]> {
  seedDiagnosisLibrary();
  return DIAGNOSIS_ITEM_TYPES.map((name, i) => ({
    id: `ditem_${name.replace(/\s+/g, '_').toLowerCase()}`,
    name,
    sortOrder: i,
  }));
}

export async function addDiagnosisCategory(_name: string): Promise<DiagnosisCategory> {
  throw new Error('Diagnosis categories are no longer used. Organize phrases by item type.');
}

export async function deleteDiagnosisCategory(_id: string): Promise<void> {
  // no-op — item types are fixed
}

export async function getDiagnosisPhrases(opts?: {
  enabledOnly?: boolean;
  itemType?: string;
  category?: string;
  search?: string;
  favouritesOnly?: boolean;
}): Promise<DiagnosisPhrase[]> {
  seedDiagnosisLibrary();
  let list = [...memDiagPhrases];
  if (opts?.enabledOnly) list = list.filter(p => p.isEnabled);
  if (opts?.favouritesOnly) list = list.filter(p => p.isFavourite);
  const itemType = opts?.itemType || opts?.category;
  if (itemType && itemType !== 'All') list = list.filter(p => p.itemType === itemType);
  if (opts?.search?.trim()) {
    const q = opts.search.trim().toLowerCase();
    list = list.filter(p => p.phrase.toLowerCase().includes(q));
  }
  return list.sort((a, b) => a.sortOrder - b.sortOrder || a.phrase.localeCompare(b.phrase));
}

export async function getFavouriteDiagnosisPhrases(itemType?: string): Promise<DiagnosisPhrase[]> {
  const rows = await getDiagnosisPhrases({
    enabledOnly: true,
    favouritesOnly: true,
    itemType: itemType && itemType !== 'All' ? itemType : undefined,
  });
  return rows.slice(0, MAX_DIAGNOSIS_FAVOURITES);
}

export async function getRecentDiagnosisPhrases(limit = 20, itemType?: string): Promise<DiagnosisPhrase[]> {
  seedDiagnosisLibrary();
  return [...memDiagPhrases]
    .filter(p => p.isEnabled && p.lastUsedAt && (!itemType || p.itemType === itemType))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, limit);
}

export async function getMostUsedDiagnosisPhrases(limit = 20, itemType?: string): Promise<DiagnosisPhrase[]> {
  seedDiagnosisLibrary();
  return [...memDiagPhrases]
    .filter(p => p.isEnabled && p.useCount > 0 && (!itemType || p.itemType === itemType))
    .sort((a, b) => b.useCount - a.useCount || a.phrase.localeCompare(b.phrase))
    .slice(0, limit);
}

export async function addDiagnosisPhrase(phrase: string, itemType = 'Watch'): Promise<DiagnosisPhrase> {
  seedDiagnosisLibrary();
  const trimmed = phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Phrase cannot be blank');
  const type = mapDiagnosisCategoryToItemType(itemType, trimmed);
  const key = normalizeDiagnosisPhraseKey(trimmed);
  if (memDiagPhrases.some(p => p.itemType === type && normalizeDiagnosisPhraseKey(p.phrase) === key)) {
    throw new Error('A phrase with this text already exists for this item type');
  }
  const now = new Date().toISOString();
  const max = memDiagPhrases.reduce((m, p) => Math.max(m, p.sortOrder), 0);
  const row: DiagnosisPhrase = {
    id: `dph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    phrase: trimmed,
    itemType: type,
    isFavourite: false,
    isEnabled: true,
    sortOrder: max + 1,
    useCount: 0,
    lastUsedAt: '',
    createdAt: now,
    updatedAt: now,
  };
  memDiagPhrases.push(row);
  return row;
}

export async function updateDiagnosisPhrase(
  id: string,
  patch: Partial<Pick<DiagnosisPhrase, 'phrase' | 'itemType' | 'isFavourite' | 'isEnabled' | 'sortOrder'>>
): Promise<void> {
  const idx = memDiagPhrases.findIndex(p => p.id === id);
  if (idx === -1) return;
  const existing = memDiagPhrases[idx];
  if (patch.isFavourite === true && !existing.isFavourite) {
    const favCount = memDiagPhrases.filter(p => p.isFavourite).length;
    if (favCount >= MAX_DIAGNOSIS_FAVOURITES) {
      throw new Error(`Maximum ${MAX_DIAGNOSIS_FAVOURITES} favourites allowed`);
    }
  }
  let phrase = existing.phrase;
  if (patch.phrase !== undefined) {
    phrase = patch.phrase.trim().replace(/\s+/g, ' ');
    if (!phrase) throw new Error('Phrase cannot be blank');
  }
  const itemType = mapDiagnosisCategoryToItemType(
    patch.itemType !== undefined ? patch.itemType : existing.itemType,
    phrase
  );
  const key = normalizeDiagnosisPhraseKey(phrase);
  if (memDiagPhrases.some(p => p.id !== id && p.itemType === itemType && normalizeDiagnosisPhraseKey(p.phrase) === key)) {
    throw new Error('A phrase with this text already exists for this item type');
  }
  memDiagPhrases[idx] = {
    ...existing,
    phrase,
    itemType,
    isFavourite: patch.isFavourite !== undefined ? patch.isFavourite : existing.isFavourite,
    isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : existing.isEnabled,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteDiagnosisPhrase(id: string): Promise<void> {
  memDiagPhrases = memDiagPhrases.filter(p => p.id !== id);
}

export async function duplicateDiagnosisPhrase(id: string): Promise<DiagnosisPhrase | null> {
  const existing = memDiagPhrases.find(p => p.id === id);
  if (!existing) return null;
  return addDiagnosisPhrase(`${existing.phrase} (copy)`, existing.itemType);
}

export async function reorderDiagnosisPhrases(orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  orderedIds.forEach((id, i) => {
    const idx = memDiagPhrases.findIndex(p => p.id === id);
    if (idx !== -1) {
      memDiagPhrases[idx] = { ...memDiagPhrases[idx], sortOrder: i, updatedAt: now };
    }
  });
}

export async function markDiagnosisPhrasesUsed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  for (const id of ids) {
    const idx = memDiagPhrases.findIndex(p => p.id === id);
    if (idx !== -1) {
      memDiagPhrases[idx] = {
        ...memDiagPhrases[idx],
        useCount: memDiagPhrases[idx].useCount + 1,
        lastUsedAt: now,
        updatedAt: now,
      };
    }
  }
}

export async function updateItemDiagnosis(itemId: string, diagnosis: string): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const idx = j.items.findIndex(i => i.id === itemId);
    if (idx !== -1) {
      j.items[idx] = {
        ...j.items[idx],
        technicianNotes: diagnosis,
        updatedAt: now,
      };
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function updateItemServicePerformed(itemId: string, servicePerformed: string): Promise<void> {
  const now = new Date().toISOString();
  for (const j of memJobs) {
    const idx = j.items.findIndex(i => i.id === itemId);
    if (idx !== -1) {
      j.items[idx] = {
        ...j.items[idx],
        description: servicePerformed,
        updatedAt: now,
      };
      j.updatedAt = now;
      notifyDataChanged({ jobId: j.id });
      return;
    }
  }
}

export async function getConfig(key: string): Promise<string|null> {
  return memConfig[key] ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  memConfig[key] = value;
}

export async function getJobCount(): Promise<number> { return memJobs.length; }

export async function exportData(): Promise<string> {
  seedDiagnosisLibrary();
  const sanitizeUri = (p: string) => {
    if (!p) return '';
    if (/^(file|content|https?|ph|assets-library):/i.test(p)) return p;
    if (p.startsWith('data:') || p.length > 500) return `[photo_ref_omitted:${Math.min(p.length, 999999)}]`;
    return p;
  };
  const data: BackupData = {
    version: '2.1', timestamp: new Date().toISOString(),
    jobs: memJobs.map(j => ({
      ...j,
      items: j.items.map(i => ({
        ...i,
        photos: normalizePhotos(i.photos).map(p => ({
          ...p,
          localUri: p.localUri && !String(p.localUri).startsWith('data:') && String(p.localUri).length < 500
            ? sanitizeUri(p.localUri)
            : (p.cloudUrl ? '' : sanitizeUri(p.localUri || '')),
          cloudUrl: p.cloudUrl || '',
        })),
      })),
    })),
    customPhrases: memPhrases,
    diagnosisPhrases: [...memDiagPhrases],
    diagnosisCategories: [...memDiagCats],
    appConfig: memConfig,
  };
  return JSON.stringify(data);
}

export async function importData(jsonStr: string): Promise<number> {
  const data: BackupData = JSON.parse(jsonStr);
  if (data.jobs) {
    for (const j of data.jobs) {
      memJobs.push({
        ...j,
        items: (j.items || []).map(i => ({ ...i, photos: normalizePhotos(i.photos) })),
      });
    }
    if (data.diagnosisCategories?.length) {
      for (const c of data.diagnosisCategories) {
        if (!memDiagCats.find(x => x.id === c.id)) memDiagCats.push(c);
      }
    }
    if (data.diagnosisPhrases?.length) {
      for (const p of data.diagnosisPhrases) {
        if (!memDiagPhrases.find(x => x.id === p.id)) {
          memDiagPhrases.push({
            ...p,
            itemType: mapDiagnosisCategoryToItemType((p as any).itemType || (p as any).category || 'Watch', p.phrase),
          });
        }
      }
      diagSeeded = true;
    }
    notifyDataChanged({ jobIds: data.jobs.map(j => j.id) });
    return data.jobs.length;
  }
  return 0;
}

export async function upsertFullJobFromCloud(job: RepairJob): Promise<void> {
  const idx = memJobs.findIndex(j => j.id === job.id);
  const copy = {
    ...job,
    cloudSyncEnabled: job.cloudSyncEnabled !== false,
    items: (job.items || []).map(i => ({ ...i, photos: normalizePhotos(i.photos) })),
  };
  if (idx === -1) memJobs.unshift(copy);
  else memJobs[idx] = copy;
  notifyBackup();
}

export async function deleteJobLocalOnly(id: string): Promise<void> {
  memJobs = memJobs.filter(j => j.id !== id);
  notifyBackup();
}

export const getSetting = getConfig;
export const setSetting = setConfig;
export const getRecordCount = getJobCount;
export const clearAllRecords = async () => {
  const jobs = [...memJobs];
  const now = new Date().toISOString();
  memJobs = [];
  notifyBackup();
  if (!suppressCloudSyncNotify) {
    import('./sync')
      .then(m => {
        for (const j of jobs) m.scheduleJobDeleted(j.id, now);
      })
      .catch(() => {});
  }
};
