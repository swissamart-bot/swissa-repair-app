import * as SQLite from 'expo-sqlite';
import { RepairRecord, BackupData } from './types';

let db: SQLite.SQLiteDatabase | null = null;

export async function initDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync('swissa.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      countryCode TEXT DEFAULT '+91',
      item TEXT NOT NULL,
      issue TEXT DEFAULT '',
      photo TEXT,
      status TEXT DEFAULT 'Pending',
      date TEXT NOT NULL,
      repairedAt TEXT,
      deliveredAt TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export async function addRecord(record: RepairRecord): Promise<void> {
  await db!.runAsync(
    `INSERT INTO records (id, name, phone, countryCode, item, issue, photo, status, date, repairedAt, deliveredAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.name, record.phone, record.countryCode, record.item,
     record.issue, record.photo, record.status, record.date, record.repairedAt, record.deliveredAt]
  );
}

export async function getAllRecords(): Promise<RepairRecord[]> {
  const rows = await db!.getAllAsync('SELECT * FROM records ORDER BY date DESC');
  return rows as RepairRecord[];
}

export async function updateRecord(record: RepairRecord): Promise<void> {
  await db!.runAsync(
    `UPDATE records SET name=?, phone=?, countryCode=?, item=?, issue=?, photo=?, status=?, date=?, repairedAt=?, deliveredAt=? WHERE id=?`,
    [record.name, record.phone, record.countryCode, record.item, record.issue,
     record.photo, record.status, record.date, record.repairedAt, record.deliveredAt, record.id]
  );
}

export async function deleteRecordById(id: string): Promise<void> {
  await db!.runAsync('DELETE FROM records WHERE id=?', [id]);
}

export async function clearAllRecords(): Promise<void> {
  await db!.execAsync('DELETE FROM records');
}

export async function getRecordCount(): Promise<number> {
  const row = await db!.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM records');
  return row?.count ?? 0;
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db!.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db!.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export async function exportData(includePhotos = false): Promise<string> {
  const records = await getAllRecords();
  const exportRecords = includePhotos ? records : records.map(r => ({ ...r, photo: null }));
  const data: BackupData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    records: exportRecords,
  };
  return JSON.stringify(data);
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
