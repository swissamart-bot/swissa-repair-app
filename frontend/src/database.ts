import * as SQLite from 'expo-sqlite';
import { RepairJob, RepairItem, CustomPhrase, BackupData } from './types';

let db: SQLite.SQLiteDatabase | null = null;

export async function initDB(): Promise<void> {
  db = await SQLite.openDatabaseAsync('swissa.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS repair_jobs (
      id TEXT PRIMARY KEY, jobNumber TEXT NOT NULL, customerName TEXT NOT NULL,
      mobileNumber TEXT NOT NULL, countryCode TEXT DEFAULT '+91', receivedDate TEXT NOT NULL,
      advanceAmount REAL DEFAULT 0, overallNotes TEXT DEFAULT '',
      googleReviewSent INTEGER DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repair_items (
      id TEXT PRIMARY KEY, jobId TEXT NOT NULL, itemNumber INTEGER NOT NULL,
      itemType TEXT NOT NULL, brand TEXT DEFAULT '', model TEXT DEFAULT '',
      color TEXT DEFAULT '', identification TEXT DEFAULT '', description TEXT DEFAULT '',
      selectedPhrases TEXT DEFAULT '[]', customerComplaint TEXT DEFAULT '',
      accessoriesReceived TEXT DEFAULT '', estimatedAmount REAL DEFAULT 0,
      finalAmount REAL DEFAULT 0, amountPaid REAL DEFAULT 0, technicianNotes TEXT DEFAULT '',
      photos TEXT DEFAULT '[]', status TEXT DEFAULT 'Received', expectedDeliveryDate TEXT DEFAULT '',
      warrantyDetails TEXT DEFAULT '', delivered INTEGER DEFAULT 0, deliveredDate TEXT DEFAULT '',
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      FOREIGN KEY (jobId) REFERENCES repair_jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS custom_phrases (
      id TEXT PRIMARY KEY, itemType TEXT NOT NULL, phrase TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  await migrateOldRecords();
}

async function migrateOldRecords(): Promise<void> {
  if (!db) return;
  try {
    const migrated = await db.getFirstAsync<{value:string}>(`SELECT value FROM app_config WHERE key='migrated_v2'`);
    if (migrated) return;
    const tables = await db.getAllAsync<{name:string}>(`SELECT name FROM sqlite_master WHERE type='table' AND name='records'`);
    if (tables.length === 0) {
      await db.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES ('migrated_v2','true')`);
      return;
    }
    const oldRecords = await db.getAllAsync<any>(`SELECT * FROM records`);
    if (oldRecords.length === 0) {
      await db.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES ('migrated_v2','true')`);
      return;
    }
    const now = new Date().toISOString();
    for (const old of oldRecords) {
      const jobId = 'mig_' + old.id;
      const itemId = 'mig_item_' + old.id;
      const status = old.status === 'Delivered' ? 'Delivered' : old.status === 'Repaired' ? 'Ready' : 'Received';
      const photos = old.photo ? JSON.stringify([old.photo]) : '[]';
      await db.runAsync(
        `INSERT OR IGNORE INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [jobId, old.id, old.name||'', old.phone||'', old.countryCode||'+91', old.date||now, 0, '', 0, now, now]
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, jobId, 1, old.item||'Watch', '', '', '', '', old.issue||'', '[]', '', '', 0, 0, 0, '', photos, status, '', '', old.status==='Delivered'?1:0, old.deliveredAt||'', now, now]
      );
    }
    await db.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES ('migrated_v2','true')`);
    // Migrate old settings
    try {
      const oldSettings = await db.getAllAsync<any>(`SELECT * FROM settings`);
      for (const s of oldSettings) {
        await db.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES (?,?)`, [s.key, s.value]);
      }
    } catch {}
  } catch (e) {
    console.warn('Migration error:', e);
  }
}

// ============ JOBS CRUD ============
export async function createJob(job: Omit<RepairJob,'items'>, items: RepairItem[]): Promise<void> {
  await db!.runAsync(
    `INSERT INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [job.id, job.jobNumber, job.customerName, job.mobileNumber, job.countryCode, job.receivedDate, job.advanceAmount, job.overallNotes, job.googleReviewSent?1:0, job.createdAt, job.updatedAt]
  );
  for (const item of items) {
    await insertItem(item);
  }
}

async function insertItem(item: RepairItem): Promise<void> {
  await db!.runAsync(
    `INSERT INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [item.id, item.jobId, item.itemNumber, item.itemType, item.brand, item.model, item.color, item.identification, item.description, JSON.stringify(item.selectedPhrases), item.customerComplaint, item.accessoriesReceived, item.estimatedAmount, item.finalAmount, item.amountPaid, item.technicianNotes, JSON.stringify(item.photos), item.status, item.expectedDeliveryDate, item.warrantyDetails, item.delivered?1:0, item.deliveredDate, item.createdAt, item.updatedAt]
  );
}

export async function getAllJobs(): Promise<RepairJob[]> {
  const jobs = await db!.getAllAsync<any>(`SELECT * FROM repair_jobs ORDER BY createdAt DESC`);
  const result: RepairJob[] = [];
  for (const j of jobs) {
    const items = await db!.getAllAsync<any>(`SELECT * FROM repair_items WHERE jobId=? ORDER BY itemNumber`, [j.id]);
    result.push({
      ...j, googleReviewSent: !!j.googleReviewSent,
      items: items.map(parseItem),
    });
  }
  return result;
}

export async function getJob(id: string): Promise<RepairJob|null> {
  const j = await db!.getFirstAsync<any>(`SELECT * FROM repair_jobs WHERE id=?`, [id]);
  if (!j) return null;
  const items = await db!.getAllAsync<any>(`SELECT * FROM repair_items WHERE jobId=? ORDER BY itemNumber`, [id]);
  return { ...j, googleReviewSent: !!j.googleReviewSent, items: items.map(parseItem) };
}

function parseItem(row: any): RepairItem {
  return {
    ...row,
    selectedPhrases: safeJsonParse(row.selectedPhrases, []),
    photos: safeJsonParse(row.photos, []),
    delivered: !!row.delivered,
    estimatedAmount: row.estimatedAmount || 0,
    finalAmount: row.finalAmount || 0,
    amountPaid: row.amountPaid || 0,
  };
}

function safeJsonParse(str: string, fallback: any): any {
  try { return JSON.parse(str); } catch { return fallback; }
}

export async function updateJob(job: Omit<RepairJob,'items'>): Promise<void> {
  const now = new Date().toISOString();
  await db!.runAsync(
    `UPDATE repair_jobs SET customerName=?,mobileNumber=?,countryCode=?,receivedDate=?,advanceAmount=?,overallNotes=?,googleReviewSent=?,updatedAt=? WHERE id=?`,
    [job.customerName, job.mobileNumber, job.countryCode, job.receivedDate, job.advanceAmount, job.overallNotes, job.googleReviewSent?1:0, now, job.id]
  );
}

export async function updateItem(item: RepairItem): Promise<void> {
  const now = new Date().toISOString();
  await db!.runAsync(
    `UPDATE repair_items SET itemNumber=?,itemType=?,brand=?,model=?,color=?,identification=?,description=?,selectedPhrases=?,customerComplaint=?,accessoriesReceived=?,estimatedAmount=?,finalAmount=?,amountPaid=?,technicianNotes=?,photos=?,status=?,expectedDeliveryDate=?,warrantyDetails=?,delivered=?,deliveredDate=?,updatedAt=? WHERE id=?`,
    [item.itemNumber, item.itemType, item.brand, item.model, item.color, item.identification, item.description, JSON.stringify(item.selectedPhrases), item.customerComplaint, item.accessoriesReceived, item.estimatedAmount, item.finalAmount, item.amountPaid, item.technicianNotes, JSON.stringify(item.photos), item.status, item.expectedDeliveryDate, item.warrantyDetails, item.delivered?1:0, item.deliveredDate, new Date().toISOString(), item.id]
  );
}

export async function addItemToJob(item: RepairItem): Promise<void> {
  await insertItem(item);
}

export async function deleteItem(id: string): Promise<void> {
  await db!.runAsync(`DELETE FROM repair_items WHERE id=?`, [id]);
}

export async function deleteJob(id: string): Promise<void> {
  await db!.runAsync(`DELETE FROM repair_items WHERE jobId=?`, [id]);
  await db!.runAsync(`DELETE FROM repair_jobs WHERE id=?`, [id]);
}

export async function markItemDelivered(id: string, date: string): Promise<void> {
  await db!.runAsync(`UPDATE repair_items SET delivered=1,deliveredDate=?,status='Delivered',updatedAt=? WHERE id=?`, [date, new Date().toISOString(), id]);
}

// ============ PHRASES ============
export async function getCustomPhrases(itemType: string): Promise<CustomPhrase[]> {
  return await db!.getAllAsync<CustomPhrase>(`SELECT * FROM custom_phrases WHERE itemType=?`, [itemType]);
}

export async function addCustomPhrase(id: string, itemType: string, phrase: string): Promise<void> {
  await db!.runAsync(`INSERT INTO custom_phrases (id,itemType,phrase) VALUES (?,?,?)`, [id, itemType, phrase]);
}

export async function deleteCustomPhrase(id: string): Promise<void> {
  await db!.runAsync(`DELETE FROM custom_phrases WHERE id=?`, [id]);
}

export async function getAllCustomPhrases(): Promise<CustomPhrase[]> {
  return await db!.getAllAsync<CustomPhrase>(`SELECT * FROM custom_phrases`);
}

// ============ CONFIG ============
export async function getConfig(key: string): Promise<string|null> {
  const row = await db!.getFirstAsync<{value:string}>(`SELECT value FROM app_config WHERE key=?`, [key]);
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await db!.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES (?,?)`, [key, value]);
}

// ============ COUNTS ============
export async function getJobCount(): Promise<number> {
  const row = await db!.getFirstAsync<{count:number}>(`SELECT COUNT(*) as count FROM repair_jobs`);
  return row?.count ?? 0;
}

// ============ EXPORT / IMPORT ============
export async function exportData(): Promise<string> {
  const jobs = await getAllJobs();
  const exportJobs = jobs.map(j => ({
    ...j,
    items: j.items.map(i => ({ ...i, photos: [] })), // exclude photos for size
  }));
  const phrases = await getAllCustomPhrases();
  const configRows = await db!.getAllAsync<{key:string,value:string}>(`SELECT * FROM app_config`);
  const config: Record<string,string> = {};
  for (const r of configRows) config[r.key] = r.value;
  const data: BackupData = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    jobs: exportJobs,
    customPhrases: phrases,
    appConfig: config,
  };
  return JSON.stringify(data);
}

export async function importData(jsonStr: string): Promise<number> {
  const data: BackupData = JSON.parse(jsonStr);
  if (data.version === '2.0' && data.jobs) {
    // New format
    for (const job of data.jobs) {
      const existing = await db!.getFirstAsync(`SELECT id FROM repair_jobs WHERE id=?`, [job.id]);
      if (existing) continue;
      const { items, ...jobData } = job;
      await db!.runAsync(
        `INSERT OR IGNORE INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [jobData.id, jobData.jobNumber, jobData.customerName, jobData.mobileNumber, jobData.countryCode, jobData.receivedDate, jobData.advanceAmount, jobData.overallNotes, jobData.googleReviewSent?1:0, jobData.createdAt, jobData.updatedAt]
      );
      for (const item of items) {
        await db!.runAsync(
          `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [item.id, item.jobId, item.itemNumber, item.itemType, item.brand||'', item.model||'', item.color||'', item.identification||'', item.description||'', JSON.stringify(item.selectedPhrases||[]), item.customerComplaint||'', item.accessoriesReceived||'', item.estimatedAmount||0, item.finalAmount||0, item.amountPaid||0, item.technicianNotes||'', JSON.stringify(item.photos||[]), item.status, item.expectedDeliveryDate||'', item.warrantyDetails||'', item.delivered?1:0, item.deliveredDate||'', item.createdAt, item.updatedAt]
        );
      }
    }
    if (data.customPhrases) {
      for (const p of data.customPhrases) {
        await db!.runAsync(`INSERT OR IGNORE INTO custom_phrases (id,itemType,phrase) VALUES (?,?,?)`, [p.id, p.itemType, p.phrase]);
      }
    }
    if (data.appConfig) {
      for (const [k,v] of Object.entries(data.appConfig)) {
        await db!.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES (?,?)`, [k, v]);
      }
    }
    return data.jobs.length;
  } else if (data.records) {
    // Old format v1
    const now = new Date().toISOString();
    for (const old of data.records) {
      const jobId = 'imp_' + old.id;
      const itemId = 'imp_item_' + old.id;
      const status = old.status === 'Delivered' ? 'Delivered' : old.status === 'Repaired' ? 'Ready' : 'Received';
      await db!.runAsync(
        `INSERT OR IGNORE INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [jobId, old.id, old.name, old.phone, old.countryCode||'+91', old.date||now, 0, '', 0, now, now]
      );
      await db!.runAsync(
        `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, jobId, 1, old.item||'Watch', '', '', '', '', old.issue||'', '[]', '', '', 0, 0, 0, '', '[]', status, '', '', old.status==='Delivered'?1:0, old.deliveredAt||'', now, now]
      );
    }
    return data.records.length;
  }
  throw new Error('Invalid backup format');
}

// Aliases for backward compat with settings screen
export const getSetting = getConfig;
export const setSetting = setConfig;
export const getRecordCount = getJobCount;
export const clearAllRecords = async () => {
  await db!.execAsync('DELETE FROM repair_items');
  await db!.execAsync('DELETE FROM repair_jobs');
};
