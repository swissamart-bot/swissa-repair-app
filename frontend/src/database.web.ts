import { RepairJob, RepairItem, CustomPhrase, BackupData } from './types';

let memJobs: RepairJob[] = [];
let memPhrases: CustomPhrase[] = [];
let memConfig: Record<string, string> = {};

export async function initDB(): Promise<void> {}

export async function createJob(job: Omit<RepairJob,'items'>, items: RepairItem[]): Promise<void> {
  memJobs.unshift({ ...job, items: [...items] });
}

export async function getAllJobs(): Promise<RepairJob[]> {
  return memJobs.map(j => ({ ...j, items: [...j.items] }));
}

export async function getJob(id: string): Promise<RepairJob|null> {
  return memJobs.find(j => j.id === id) || null;
}

export async function updateJob(job: Omit<RepairJob,'items'>): Promise<void> {
  const idx = memJobs.findIndex(j => j.id === job.id);
  if (idx !== -1) memJobs[idx] = { ...memJobs[idx], ...job };
}

export async function updateItem(item: RepairItem): Promise<void> {
  for (const j of memJobs) {
    const idx = j.items.findIndex(i => i.id === item.id);
    if (idx !== -1) { j.items[idx] = { ...item }; return; }
  }
}

export async function addItemToJob(item: RepairItem): Promise<void> {
  const j = memJobs.find(j => j.id === item.jobId);
  if (j) j.items.push(item);
}

export async function deleteItem(id: string): Promise<void> {
  for (const j of memJobs) { j.items = j.items.filter(i => i.id !== id); }
}

export async function deleteJob(id: string): Promise<void> {
  memJobs = memJobs.filter(j => j.id !== id);
}

export async function markItemDelivered(id: string, date: string): Promise<void> {
  for (const j of memJobs) {
    const item = j.items.find(i => i.id === id);
    if (item) { item.delivered = true; item.deliveredDate = date; item.status = 'Delivered'; return; }
  }
}

export async function getCustomPhrases(itemType: string): Promise<CustomPhrase[]> {
  return memPhrases.filter(p => p.itemType === itemType);
}

export async function addCustomPhrase(id: string, itemType: string, phrase: string): Promise<void> {
  memPhrases.push({ id, itemType, phrase });
}

export async function deleteCustomPhrase(id: string): Promise<void> {
  memPhrases = memPhrases.filter(p => p.id !== id);
}

export async function getAllCustomPhrases(): Promise<CustomPhrase[]> {
  return [...memPhrases];
}

export async function getConfig(key: string): Promise<string|null> {
  return memConfig[key] ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  memConfig[key] = value;
}

export async function getJobCount(): Promise<number> { return memJobs.length; }

export async function exportData(): Promise<string> {
  const data: BackupData = {
    version: '2.0', timestamp: new Date().toISOString(),
    jobs: memJobs.map(j => ({ ...j, items: j.items.map(i => ({ ...i, photos: [] })) })),
    customPhrases: memPhrases, appConfig: memConfig,
  };
  return JSON.stringify(data);
}

export async function importData(jsonStr: string): Promise<number> {
  const data: BackupData = JSON.parse(jsonStr);
  if (data.jobs) {
    for (const j of data.jobs) memJobs.push(j);
    return data.jobs.length;
  }
  return 0;
}

export const getSetting = getConfig;
export const setSetting = setConfig;
export const getRecordCount = getJobCount;
export const clearAllRecords = async () => { memJobs = []; };
