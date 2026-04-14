import { RepairRecord, BackupData } from './types';

// Web-only: in-memory database (SQLite not available on web)
let memRecords: RepairRecord[] = [];
let memSettings: Record<string, string> = {};

export async function initDB(): Promise<void> {
  // No-op for web
}

export async function addRecord(record: RepairRecord): Promise<void> {
  memRecords.unshift(record);
}

export async function getAllRecords(): Promise<RepairRecord[]> {
  return [...memRecords];
}

export async function updateRecord(record: RepairRecord): Promise<void> {
  const idx = memRecords.findIndex(r => r.id === record.id);
  if (idx !== -1) memRecords[idx] = { ...record };
}

export async function deleteRecordById(id: string): Promise<void> {
  memRecords = memRecords.filter(r => r.id !== id);
}

export async function clearAllRecords(): Promise<void> {
  memRecords = [];
}

export async function getRecordCount(): Promise<number> {
  return memRecords.length;
}

export async function getSetting(key: string): Promise<string | null> {
  return memSettings[key] ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  memSettings[key] = value;
}

export async function exportData(): Promise<string> {
  const records = await getAllRecords();
  const data: BackupData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    records,
  };
  return JSON.stringify(data, null, 2);
}

export async function importData(jsonStr: string): Promise<number> {
  const data: BackupData = JSON.parse(jsonStr);
  if (!data.records || !Array.isArray(data.records)) {
    throw new Error('Invalid backup file format');
  }
  await clearAllRecords();
  for (const record of data.records) {
    await addRecord(record);
  }
  return data.records.length;
}
