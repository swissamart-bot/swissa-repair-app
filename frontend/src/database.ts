import * as SQLite from 'expo-sqlite';
import { RepairJob, RepairItem, CustomPhrase, BackupData, mapLegacyStatus, DiagnosisPhrase, DiagnosisCategory, DEFAULT_DIAGNOSIS_PHRASES, MAX_DIAGNOSIS_FAVOURITES, normalizeDiagnosisPhraseKey, normalizeServicePhraseKey, SERVICE_PHRASE_ALL_ITEMS, mapDiagnosisCategoryToItemType, DIAGNOSIS_ITEM_TYPES, getItemAmount } from './types';
import { DEFAULT_PHRASES, generateJobNumber } from './constants';
import { normalizePhotos, preparePhotosForStorage } from './photos';

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
      id TEXT PRIMARY KEY, itemType TEXT NOT NULL, phrase TEXT NOT NULL,
      isEnabled INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS diagnosis_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sortOrder INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS diagnosis_phrases (
      id TEXT PRIMARY KEY,
      phrase TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      isFavourite INTEGER DEFAULT 0,
      isEnabled INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0,
      useCount INTEGER DEFAULT 0,
      lastUsedAt TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  await migrateOldRecords();
  await ensureServicePhraseLibrary();
  await ensureDiagnosisLibrary();
  await ensureItemwisePaymentMigration();
  await ensureReturnRefundColumns();
  await ensureJobAdvanceSeparationMigration();
  await ensureCloudSyncColumn();
}

/** cloudSyncEnabled: historical jobs stay 0; new jobs set 1 when SYNC_ENABLED. */
async function ensureCloudSyncColumn(): Promise<void> {
  if (!db) return;
  try {
    await db.runAsync(`ALTER TABLE repair_jobs ADD COLUMN cloudSyncEnabled INTEGER DEFAULT 0`);
  } catch {
    // exists
  }
}

/** Add return/refund columns on repair_items (safe if already present). */
async function ensureReturnRefundColumns(): Promise<void> {
  if (!db) return;
  const cols = [
    { name: 'refundAmount', sql: `ALTER TABLE repair_items ADD COLUMN refundAmount REAL DEFAULT 0` },
    { name: 'nonRefundableCharges', sql: `ALTER TABLE repair_items ADD COLUMN nonRefundableCharges REAL DEFAULT 0` },
    { name: 'returnedDate', sql: `ALTER TABLE repair_items ADD COLUMN returnedDate TEXT DEFAULT ''` },
  ];
  for (const col of cols) {
    try {
      await db.runAsync(col.sql);
    } catch {
      // column already exists
    }
  }
}

/**
 * Keep job advance at job level (do not leave FIFO-allocated amountPaid on undelivered items).
 * Adds advanceApplied column; reinterprets historical amountPaid where possible.
 */
async function ensureJobAdvanceSeparationMigration(): Promise<void> {
  if (!db) return;
  try {
    await db.runAsync(`ALTER TABLE repair_items ADD COLUMN advanceApplied REAL DEFAULT 0`);
  } catch {
    // exists
  }
  try {
    await db.runAsync(`ALTER TABLE repair_items ADD COLUMN lastDeliveryTxnId TEXT DEFAULT ''`);
  } catch {
    // exists
  }
  try {
    const done = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_config WHERE key='advance_joblevel_v1'`
    );
    if (done) return;

    const jobs = await db.getAllAsync<{ id: string; advanceAmount: number }>(
      `SELECT id, advanceAmount FROM repair_jobs`
    );
    for (const job of jobs) {
      const items = await db.getAllAsync<{
        id: string;
        amountPaid: number;
        estimatedAmount: number;
        finalAmount: number;
        delivered: number;
        status: string;
      }>(
        `SELECT id, amountPaid, estimatedAmount, finalAmount, delivered, status FROM repair_items WHERE jobId=? ORDER BY itemNumber ASC`,
        [job.id]
      );
      if (!items.length) continue;

      let remainingAdv = Math.max(0, Number(job.advanceAmount) || 0);
      for (const item of items) {
        const paid = Math.max(0, Number(item.amountPaid) || 0);
        const amount = Math.max(0, Number(item.finalAmount) || Number(item.estimatedAmount) || 0);
        const isDelivered = !!item.delivered || item.status === 'Delivered';
        if (isDelivered) {
          const fromAdv = Math.min(paid, remainingAdv, amount);
          const itemPay = Math.max(0, paid - fromAdv);
          await db.runAsync(
            `UPDATE repair_items SET advanceApplied=?, amountPaid=? WHERE id=?`,
            [fromAdv, itemPay, item.id]
          );
          remainingAdv -= fromAdv;
        } else {
          // Undelivered: strip auto-allocated advance from item.amountPaid
          await db.runAsync(
            `UPDATE repair_items SET amountPaid=0, advanceApplied=0 WHERE id=?`,
            [item.id]
          );
        }
      }
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO app_config (key, value) VALUES ('advance_joblevel_v1', 'true')`
    );
  } catch (e) {
    console.warn('Job advance separation migration error:', e);
  }
}

/** @deprecated FIFO advance→item allocation removed — job advance stays at job level. */
async function ensureItemwisePaymentMigration(): Promise<void> {
  // Kept as no-op for older call sites / migration key compatibility.
  // Job advance is handled by ensureJobAdvanceSeparationMigration.
  return;
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
      const status = mapLegacyStatus(old.status || 'Received');
      const delivered = status === 'Delivered' || old.status === 'Delivered' || old.status === 'Completed';
      const photos = old.photo ? JSON.stringify([old.photo]) : '[]';
      await db.runAsync(
        `INSERT OR IGNORE INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [jobId, old.id, old.name||'', old.phone||'', old.countryCode||'+91', old.date||now, 0, '', 0, now, now]
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, jobId, 1, old.item||'Watch', '', '', '', '', old.issue||'', '[]', '', '', 0, 0, 0, '', photos, status, '', '', delivered?1:0, old.deliveredAt||'', now, now]
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

/** Exact match on full stored Job ID (e.g. M48372). Does not rewrite legacy IDs. */
export async function jobNumberExists(jobNumber: string): Promise<boolean> {
  if (!db) return false;
  const n = String(jobNumber || '').trim();
  if (!n) return false;
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM repair_jobs WHERE jobNumber = ?`,
    [n],
  );
  return (row?.c ?? 0) > 0;
}

/**
 * Allocate a unique Pro Job ID (Mxxxxx). Retries on collision.
 * Legacy numbers are never modified.
 */
async function isJobNumberAvailable(candidate: string): Promise<boolean> {
  if (await jobNumberExists(candidate)) return false;
  try {
    const sync = await import('./sync');
    if (await sync.isJobNumberTakenInCloud(candidate)) return false;
  } catch {
    /* offline / unavailable — local uniqueness still enforced */
  }
  return true;
}

/**
 * Prefer the on-screen Job ID when still free; otherwise allocate a new Mxxxxx.
 * Legacy numbers are never rewritten.
 */
export async function allocateUniqueJobNumber(
  preferred?: string,
  maxAttempts = 40,
): Promise<string> {
  const pref = String(preferred || '').trim();
  if (pref && (await isJobNumberAvailable(pref))) return pref;

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateJobNumber();
    if (await isJobNumberAvailable(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique Job ID');
}

export async function createJob(job: Omit<RepairJob,'items'>, items: RepairItem[]): Promise<void> {
  // New jobs are cloud-eligible when live sync is enabled (not bulk historical migration)
  let cloudSyncEnabled = !!job.cloudSyncEnabled;
  try {
    const sync = await import('./sync');
    if (sync.SYNC_ENABLED && job.cloudSyncEnabled !== false) {
      cloudSyncEnabled = true;
    }
  } catch {
    /* keep job.cloudSyncEnabled */
  }

  const jobNumber = String(job.jobNumber || '').trim();
  if (!jobNumber) throw new Error('Job ID is required');
  if (await jobNumberExists(jobNumber)) {
    throw new Error(`Job ID ${jobNumber} already exists`);
  }

  await db!.runAsync(
    `INSERT INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,cloudSyncEnabled,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      job.id, jobNumber, job.customerName, job.mobileNumber, job.countryCode, job.receivedDate,
      job.advanceAmount, job.overallNotes, job.googleReviewSent ? 1 : 0, cloudSyncEnabled ? 1 : 0,
      job.createdAt, job.updatedAt,
    ]
  );
  for (const item of items) {
    await insertItem(item);
  }
  notifyDataChanged({ jobId: job.id });
}

export async function setJobCloudSyncEnabled(jobId: string, enabled: boolean): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE repair_jobs SET cloudSyncEnabled=?, updatedAt=? WHERE id=?`,
    [enabled ? 1 : 0, now, jobId]
  );
  if (enabled) {
    notifyDataChanged({ jobId });
  } else {
    notifyDataChangedForBackup();
  }
}

async function insertItem(item: RepairItem): Promise<void> {
  await db!.runAsync(
    `INSERT INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,advanceApplied,refundAmount,nonRefundableCharges,returnedDate,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,lastDeliveryTxnId,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.jobId, item.itemNumber, item.itemType, item.brand, item.model, item.color,
      item.identification, item.description, JSON.stringify(item.selectedPhrases),
      item.customerComplaint, item.accessoriesReceived, item.estimatedAmount, item.finalAmount,
      item.amountPaid || 0, item.advanceApplied || 0, item.refundAmount || 0, item.nonRefundableCharges || 0, item.returnedDate || '',
      item.technicianNotes, JSON.stringify(preparePhotosForStorage(item.photos)), item.status, item.expectedDeliveryDate,
      item.warrantyDetails, item.delivered ? 1 : 0, item.deliveredDate, item.lastDeliveryTxnId || '', item.createdAt, item.updatedAt,
    ]
  );
}

export async function getAllJobs(): Promise<RepairJob[]> {
  const jobs = await db!.getAllAsync<any>(`SELECT * FROM repair_jobs ORDER BY createdAt DESC`);
  const result: RepairJob[] = [];
  for (const j of jobs) {
    const items = await db!.getAllAsync<any>(`SELECT * FROM repair_items WHERE jobId=? ORDER BY itemNumber`, [j.id]);
    result.push({
      ...j,
      googleReviewSent: !!j.googleReviewSent,
      cloudSyncEnabled: !!j.cloudSyncEnabled,
      items: items.map(parseItem),
    });
  }
  return result;
}

export async function getJob(id: string): Promise<RepairJob|null> {
  const j = await db!.getFirstAsync<any>(`SELECT * FROM repair_jobs WHERE id=?`, [id]);
  if (!j) return null;
  const items = await db!.getAllAsync<any>(`SELECT * FROM repair_items WHERE jobId=? ORDER BY itemNumber`, [id]);
  return {
    ...j,
    googleReviewSent: !!j.googleReviewSent,
    cloudSyncEnabled: !!j.cloudSyncEnabled,
    items: items.map(parseItem),
  };
}

/**
 * Count jobs for the same customer (mobile primary; name fallback if mobile blank).
 * Does not load items or photos.
 */
export async function countJobsByCustomer(mobileNumber: string, customerName: string): Promise<number> {
  if (!db) return 0;
  const mobile = String(mobileNumber || '').trim();
  const name = String(customerName || '').trim();
  if (mobile) {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM repair_jobs WHERE mobileNumber = ?`,
      [mobile]
    );
    return row?.count ?? 0;
  }
  if (name) {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM repair_jobs WHERE TRIM(mobileNumber) = '' AND LOWER(customerName) = LOWER(?)`,
      [name]
    );
    return row?.count ?? 0;
  }
  return 0;
}

/**
 * Load only this customer's jobs (newest first). Photos omitted from item payloads.
 */
export async function getJobsByCustomer(mobileNumber: string, customerName: string): Promise<RepairJob[]> {
  if (!db) return [];
  const mobile = String(mobileNumber || '').trim();
  const name = String(customerName || '').trim();

  let jobs: any[] = [];
  if (mobile) {
    jobs = await db.getAllAsync<any>(
      `SELECT * FROM repair_jobs WHERE mobileNumber = ? ORDER BY createdAt DESC`,
      [mobile]
    );
  } else if (name) {
    jobs = await db.getAllAsync<any>(
      `SELECT * FROM repair_jobs WHERE TRIM(mobileNumber) = '' AND LOWER(customerName) = LOWER(?) ORDER BY createdAt DESC`,
      [name]
    );
  } else {
    return [];
  }

  const result: RepairJob[] = [];
  for (const j of jobs) {
    const items = await db.getAllAsync<any>(
      `SELECT * FROM repair_items WHERE jobId=? ORDER BY itemNumber`,
      [j.id]
    );
    result.push({
      ...j,
      googleReviewSent: !!j.googleReviewSent,
      items: items.map((row: any) => ({
        ...parseItem({ ...row, photos: '[]' }),
        photos: [],
      })),
    });
  }
  return result;
}

function parseItem(row: any): RepairItem {
  return {
    ...row,
    selectedPhrases: safeJsonParse(row.selectedPhrases, []),
    photos: normalizePhotos(safeJsonParse(row.photos, [])),
    delivered: !!row.delivered,
    estimatedAmount: row.estimatedAmount || 0,
    finalAmount: row.finalAmount || 0,
    amountPaid: row.amountPaid || 0,
    advanceApplied: row.advanceApplied || 0,
    refundAmount: row.refundAmount || 0,
    nonRefundableCharges: row.nonRefundableCharges || 0,
    returnedDate: row.returnedDate || '',
    lastDeliveryTxnId: row.lastDeliveryTxnId || '',
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
  notifyDataChanged({ jobId: job.id });
}

export async function updateItem(item: RepairItem): Promise<void> {
  const now = new Date().toISOString();
  await db!.runAsync(
    `UPDATE repair_items SET itemNumber=?,itemType=?,brand=?,model=?,color=?,identification=?,description=?,selectedPhrases=?,customerComplaint=?,accessoriesReceived=?,estimatedAmount=?,finalAmount=?,amountPaid=?,advanceApplied=?,refundAmount=?,nonRefundableCharges=?,returnedDate=?,technicianNotes=?,photos=?,status=?,expectedDeliveryDate=?,warrantyDetails=?,delivered=?,deliveredDate=?,lastDeliveryTxnId=?,updatedAt=? WHERE id=?`,
    [
      item.itemNumber, item.itemType, item.brand, item.model, item.color, item.identification,
      item.description, JSON.stringify(item.selectedPhrases), item.customerComplaint,
      item.accessoriesReceived, item.estimatedAmount, item.finalAmount, item.amountPaid || 0,
      item.advanceApplied || 0, item.refundAmount || 0, item.nonRefundableCharges || 0, item.returnedDate || '',
      item.technicianNotes, JSON.stringify(preparePhotosForStorage(item.photos)), item.status, item.expectedDeliveryDate,
      item.warrantyDetails, item.delivered ? 1 : 0, item.deliveredDate, item.lastDeliveryTxnId || '', now, item.id,
    ]
  );
  // Also bump parent job updatedAt so conflict resolution sees item/payment edits
  await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, item.jobId]);
  notifyDataChanged({ jobId: item.jobId });
}

export async function addItemToJob(item: RepairItem): Promise<void> {
  await insertItem(item);
  const now = new Date().toISOString();
  await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, item.jobId]);
  notifyDataChanged({ jobId: item.jobId });
}

export async function deleteItem(id: string): Promise<void> {
  const jobId = await getJobIdByItemId(id);
  await db!.runAsync(`DELETE FROM repair_items WHERE id=?`, [id]);
  if (jobId) {
    const now = new Date().toISOString();
    await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, jobId]);
    notifyDataChanged({ jobId });
  } else {
    notifyDataChangedForBackup();
  }
}

export async function deleteJob(id: string): Promise<void> {
  const existing = await getJob(id);
  const now = new Date().toISOString();
  await db!.runAsync(`DELETE FROM repair_items WHERE jobId=?`, [id]);
  await db!.runAsync(`DELETE FROM repair_jobs WHERE id=?`, [id]);
  notifyDataChanged({
    deletedJobId: id,
    deletedAt: now,
    wasCloudSynced: !!existing?.cloudSyncEnabled,
  });
}

export async function markItemDelivered(
  id: string,
  date: string,
  amountPaid?: number,
  advanceApplied?: number,
  deliveryTxnId?: string,
): Promise<void> {
  const settlement: DeliveryItemSettlement = {
    itemId: id,
    amountPaid: amountPaid ?? undefined,
    advanceApplied: advanceApplied ?? undefined,
  };
  // Prefer absolute settlement when both payment fields are provided
  if (amountPaid !== undefined && advanceApplied !== undefined) {
    settlement.amountPaid = Math.max(0, amountPaid);
    settlement.advanceApplied = Math.max(0, advanceApplied);
  } else if (amountPaid !== undefined) {
    settlement.amountPaid = Math.max(0, amountPaid);
  }
  await markItemsDeliveredBatch([settlement], date, deliveryTxnId || '');
}

export type DeliveryItemSettlement = {
  itemId: string;
  /** Absolute delivery cash/UPI on the item after this delivery */
  amountPaid?: number;
  /** Absolute advance applied on the item after this delivery */
  advanceApplied?: number;
};

/**
 * Persist a partial/full delivery for one or more items in one shot.
 * Idempotent when the same deliveryTxnId is already stored on every target item.
 */
async function ensureLastDeliveryTxnColumn(): Promise<void> {
  if (!db) return;
  try {
    await db.runAsync(`ALTER TABLE repair_items ADD COLUMN lastDeliveryTxnId TEXT DEFAULT ''`);
  } catch {
    // already exists
  }
}

/**
 * Persist a partial/full delivery for one or more items.
 * Does NOT return success until SQLite re-read confirms status + payments.
 * Idempotent when the same deliveryTxnId is already stored on every target item.
 */
export async function markItemsDeliveredBatch(
  settlements: DeliveryItemSettlement[],
  deliveredAt: string,
  deliveryTxnId = '',
): Promise<{ applied: boolean; jobId: string; job: RepairJob }> {
  if (!db) {
    throw new Error('Delivery failed: database is not open');
  }
  if (settlements.length === 0) {
    throw new Error('Delivery failed: no items selected');
  }

  await ensureLastDeliveryTxnColumn();

  const now = new Date().toISOString();
  const date = deliveredAt || now;
  const txnId = String(deliveryTxnId || '').trim();

  const firstJobId = await getJobIdByItemId(settlements[0].itemId);
  if (!firstJobId) {
    throw new Error('Delivery failed: item not found in SQLite');
  }

  // Protect from concurrent Firestore pull BEFORE any write completes.
  try {
    const sync = await import('./sync');
    sync.markJobDirtyImmediate(firstJobId);
  } catch {
    // sync module optional during early boot
  }

  // Idempotency: same txn already applied → return current job (no double pay)
  if (txnId) {
    let allSameTxn = true;
    for (const s of settlements) {
      const row = await db.getFirstAsync<{ lastDeliveryTxnId?: string; delivered?: number; status?: string }>(
        `SELECT lastDeliveryTxnId, delivered, status FROM repair_items WHERE id=?`,
        [s.itemId],
      );
      const delivered =
        !!row?.delivered || String(row?.status || '').toLowerCase() === 'delivered';
      if (!row || row.lastDeliveryTxnId !== txnId || !delivered) {
        allSameTxn = false;
        break;
      }
    }
    if (allSameTxn) {
      const existing = await getJob(firstJobId);
      if (!existing) throw new Error('Delivery failed: job missing after idempotent check');
      return { applied: false, jobId: firstJobId, job: existing };
    }
  }

  // Plain sequential writes (avoid withTransactionAsync + nested SELECT quirks on Android).
  for (const s of settlements) {
    if (s.amountPaid === undefined || s.advanceApplied === undefined) {
      throw new Error('Delivery failed: amountPaid and advanceApplied are required');
    }
    const paid = Math.max(0, Number(s.amountPaid) || 0);
    const adv = Math.max(0, Number(s.advanceApplied) || 0);

    const result = await db.runAsync(
      `UPDATE repair_items
       SET delivered=1,
           deliveredDate=?,
           status='Delivered',
           amountPaid=?,
           advanceApplied=?,
           lastDeliveryTxnId=?,
           updatedAt=?
       WHERE id=?`,
      [date, paid, adv, txnId, now, s.itemId],
    );

    const changes = Number((result as { changes?: number } | undefined)?.changes ?? -1);
    if (changes === 0) {
      throw new Error(`Delivery failed: SQLite updated 0 rows for item ${s.itemId}`);
    }
  }

  await db.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, firstJobId]);

  // Hard reload from SQLite — source of truth for UI replacement.
  const job = await getJob(firstJobId);
  if (!job) {
    throw new Error('Delivery failed: could not reload job from SQLite');
  }

  for (const s of settlements) {
    const item = job.items.find(i => i.id === s.itemId);
    if (!item) {
      throw new Error(`Delivery failed: item ${s.itemId} missing after SQLite save`);
    }
    const paid = Math.max(0, Number(s.amountPaid) || 0);
    const adv = Math.max(0, Number(s.advanceApplied) || 0);
    if (!item.delivered || String(item.status) !== 'Delivered') {
      throw new Error(
        `Delivery failed: SQLite still has status="${item.status}" delivered=${item.delivered} for item ${s.itemId}`,
      );
    }
    if (Math.abs(Number(item.amountPaid) - paid) > 0.001) {
      throw new Error(
        `Delivery failed: SQLite amountPaid=${item.amountPaid} expected ${paid} for item ${s.itemId}`,
      );
    }
    if (Math.abs(Number(item.advanceApplied) - adv) > 0.001) {
      throw new Error(
        `Delivery failed: SQLite advanceApplied=${item.advanceApplied} expected ${adv} for item ${s.itemId}`,
      );
    }
  }

  console.log('[delivery-debug] SQLite save verified', {
    jobId: firstJobId,
    txnId,
    items: settlements.map(s => {
      const item = job.items.find(i => i.id === s.itemId)!;
      const totalPaidForItem = Number(item.amountPaid) + Number(item.advanceApplied);
      const itemAmount = getItemAmount(item);
      return {
        id: item.id,
        status: item.status,
        delivered: item.delivered,
        deliveredDate: item.deliveredDate,
        amountPaid: item.amountPaid,
        advanceApplied: item.advanceApplied,
        totalPaidForItem,
        itemBalance: Math.max(0, itemAmount - totalPaidForItem),
        lastDeliveryTxnId: item.lastDeliveryTxnId,
      };
    }),
  });

  notifyDataChanged({ jobId: firstJobId });
  return { applied: true, jobId: firstJobId, job };
}

/** Mark item as Returned / Not Repaired with refund details (does not change other items). */
export async function markItemReturned(
  id: string,
  date: string,
  refundAmount: number,
  nonRefundableCharges: number,
): Promise<void> {
  const now = new Date().toISOString();
  const refund = Math.max(0, Number(refundAmount) || 0);
  const charges = Math.max(0, Number(nonRefundableCharges) || 0);
  const jobId = await getJobIdByItemId(id);
  await db!.runAsync(
    `UPDATE repair_items SET status='Not Repaired', returnedDate=?, refundAmount=?, nonRefundableCharges=?, delivered=0, updatedAt=? WHERE id=?`,
    [date, refund, charges, now, id]
  );
  if (jobId) {
    await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, jobId]);
    notifyDataChanged({ jobId });
  } else {
    notifyDataChangedForBackup();
  }
}

async function getJobIdByItemId(itemId: string): Promise<string | null> {
  if (!db) return null;
  const row = await db.getFirstAsync<{ jobId: string }>(
    `SELECT jobId FROM repair_items WHERE id=?`,
    [itemId]
  );
  return row?.jobId ?? null;
}

// ============ SERVICE PERFORMED PHRASES ============
function parseCustomPhrase(row: any): CustomPhrase {
  return {
    id: row.id,
    itemType: row.itemType || 'Watch',
    phrase: row.phrase || '',
    isEnabled: row.isEnabled !== 0 && row.isEnabled !== false,
    sortOrder: row.sortOrder ?? 0,
  };
}

async function ensureServicePhraseSchema(): Promise<void> {
  if (!db) return;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS custom_phrases (
      id TEXT PRIMARY KEY, itemType TEXT NOT NULL, phrase TEXT NOT NULL,
      isEnabled INTEGER DEFAULT 1, sortOrder INTEGER DEFAULT 0
    );
  `);
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(custom_phrases)`);
  const names = new Set(cols.map(c => c.name));
  if (!names.has('isEnabled')) {
    await db.runAsync(`ALTER TABLE custom_phrases ADD COLUMN isEnabled INTEGER DEFAULT 1`);
  }
  if (!names.has('sortOrder')) {
    await db.runAsync(`ALTER TABLE custom_phrases ADD COLUMN sortOrder INTEGER DEFAULT 0`);
  }
}

async function ensureServicePhraseLibrary(): Promise<void> {
  if (!db) return;
  try {
    await ensureServicePhraseSchema();
    const seeded = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_config WHERE key='service_phrases_seeded_v1'`
    );
    if (seeded) return;

    const count = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM custom_phrases`);
    let order = (await db.getFirstAsync<{ m: number }>(`SELECT MAX(sortOrder) as m FROM custom_phrases`))?.m ?? 0;

    // Seed built-in defaults once; skip text that already exists for that item type
    const existing = await db.getAllAsync<{ itemType: string; phrase: string }>(
      `SELECT itemType, phrase FROM custom_phrases`
    );
    const existingKeys = new Set(
      existing.map(p => `${p.itemType}::${normalizeServicePhraseKey(p.phrase)}`)
    );

    for (const [itemType, phrases] of Object.entries(DEFAULT_PHRASES)) {
      for (const phrase of phrases) {
        const key = `${itemType}::${normalizeServicePhraseKey(phrase)}`;
        if (existingKeys.has(key)) continue;
        order += 1;
        await db.runAsync(
          `INSERT INTO custom_phrases (id, itemType, phrase, isEnabled, sortOrder) VALUES (?,?,?,?,?)`,
          [`sph_${Date.now()}_${order}_${Math.random().toString(36).slice(2, 6)}`, itemType, phrase, 1, order]
        );
        existingKeys.add(key);
      }
    }

    // Backfill sortOrder / isEnabled for any legacy rows
    if ((count?.count ?? 0) > 0) {
      await db.runAsync(`UPDATE custom_phrases SET isEnabled=1 WHERE isEnabled IS NULL`);
      await db.runAsync(`UPDATE custom_phrases SET sortOrder=0 WHERE sortOrder IS NULL`);
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO app_config (key, value) VALUES ('service_phrases_seeded_v1', 'true')`
    );
  } catch (e) {
    console.warn('Service phrase library seed error:', e);
  }
}

export async function getCustomPhrases(itemType: string): Promise<CustomPhrase[]> {
  await ensureServicePhraseLibrary();
  const rows = await db!.getAllAsync<any>(
    `SELECT * FROM custom_phrases WHERE itemType=? ORDER BY sortOrder ASC, phrase ASC`,
    [itemType]
  );
  return rows.map(parseCustomPhrase);
}

export async function getAllCustomPhrases(): Promise<CustomPhrase[]> {
  await ensureServicePhraseLibrary();
  const rows = await db!.getAllAsync<any>(
    `SELECT * FROM custom_phrases ORDER BY sortOrder ASC, phrase ASC`
  );
  return rows.map(parseCustomPhrase);
}

/** Enabled phrases for Records/Edit: item type + All Items */
export async function getServicePhrasesForItem(itemType: string): Promise<CustomPhrase[]> {
  await ensureServicePhraseLibrary();
  const rows = await db!.getAllAsync<any>(
    `SELECT * FROM custom_phrases
     WHERE isEnabled=1 AND (itemType=? OR itemType=?)
     ORDER BY sortOrder ASC, phrase ASC`,
    [itemType, SERVICE_PHRASE_ALL_ITEMS]
  );
  return rows.map(parseCustomPhrase);
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
  await ensureServicePhraseLibrary();
  const trimmed = phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Phrase cannot be blank');
  const type = (itemType || 'Watch').trim() || 'Watch';
  const key = normalizeServicePhraseKey(trimmed);
  const all = await db!.getAllAsync<{ id: string; phrase: string; itemType: string }>(
    `SELECT id, phrase, itemType FROM custom_phrases WHERE itemType=?`, [type]
  );
  if (all.some(p => normalizeServicePhraseKey(p.phrase) === key)) {
    throw new Error('A service phrase with this text already exists for this item type');
  }
  const max = await db!.getFirstAsync<{ m: number }>(`SELECT MAX(sortOrder) as m FROM custom_phrases`);
  const row: CustomPhrase = {
    id: id || `sph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    itemType: type,
    phrase: trimmed,
    isEnabled,
    sortOrder: (max?.m ?? 0) + 1,
  };
  await db!.runAsync(
    `INSERT INTO custom_phrases (id, itemType, phrase, isEnabled, sortOrder) VALUES (?,?,?,?,?)`,
    [row.id, row.itemType, row.phrase, row.isEnabled ? 1 : 0, row.sortOrder]
  );
  notifyDataChangedForBackup();
  return row;
}

export async function updateServicePhrase(
  id: string,
  patch: Partial<Pick<CustomPhrase, 'phrase' | 'itemType' | 'isEnabled' | 'sortOrder'>>
): Promise<void> {
  await ensureServicePhraseLibrary();
  const existing = await db!.getFirstAsync<any>(`SELECT * FROM custom_phrases WHERE id=?`, [id]);
  if (!existing) return;

  let phrase = existing.phrase;
  if (patch.phrase !== undefined) {
    phrase = patch.phrase.trim().replace(/\s+/g, ' ');
    if (!phrase) throw new Error('Phrase cannot be blank');
  }
  const itemType = patch.itemType !== undefined ? patch.itemType : existing.itemType;
  const key = normalizeServicePhraseKey(phrase);
  const siblings = await db!.getAllAsync<{ id: string; phrase: string }>(
    `SELECT id, phrase FROM custom_phrases WHERE itemType=?`, [itemType]
  );
  if (siblings.some(p => p.id !== id && normalizeServicePhraseKey(p.phrase) === key)) {
    throw new Error('A service phrase with this text already exists for this item type');
  }

  const isEnabled = patch.isEnabled !== undefined ? (patch.isEnabled ? 1 : 0) : (existing.isEnabled !== 0 ? 1 : 0);
  const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : (existing.sortOrder ?? 0);

  await db!.runAsync(
    `UPDATE custom_phrases SET phrase=?, itemType=?, isEnabled=?, sortOrder=? WHERE id=?`,
    [phrase, itemType, isEnabled, sortOrder, id]
  );
}

export async function deleteCustomPhrase(id: string): Promise<void> {
  await db!.runAsync(`DELETE FROM custom_phrases WHERE id=?`, [id]);
  notifyDataChangedForBackup();
}

export async function reorderServicePhrases(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db!.runAsync(`UPDATE custom_phrases SET sortOrder=? WHERE id=?`, [i, orderedIds[i]]);
  }
}

// ============ TECHNICIAN DIAGNOSIS PHRASE LIBRARY (by item type) ============
function parseDiagnosisPhrase(row: any): DiagnosisPhrase {
  const itemType = mapDiagnosisCategoryToItemType(row.category || row.itemType || 'Watch', row.phrase || '');
  return {
    id: row.id,
    phrase: row.phrase,
    itemType,
    isFavourite: !!row.isFavourite,
    isEnabled: row.isEnabled !== 0 && row.isEnabled !== false,
    sortOrder: row.sortOrder || 0,
    useCount: row.useCount || 0,
    lastUsedAt: row.lastUsedAt || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  };
}

async function ensureDiagnosisLibrary(): Promise<void> {
  if (!db) return;
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS diagnosis_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sortOrder INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS diagnosis_phrases (
        id TEXT PRIMARY KEY,
        phrase TEXT NOT NULL,
        category TEXT DEFAULT 'Watch',
        isFavourite INTEGER DEFAULT 0,
        isEnabled INTEGER DEFAULT 1,
        sortOrder INTEGER DEFAULT 0,
        useCount INTEGER DEFAULT 0,
        lastUsedAt TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);

    // v2: migrate legacy Battery/Machine/... categories → Watch/Spectacle/Goggle/Wall Clock
    const v2 = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_config WHERE key='diagnosis_itemtype_v2'`
    );
    if (!v2) {
      const rows = await db.getAllAsync<{ id: string; phrase: string; category: string }>(
        `SELECT id, phrase, category FROM diagnosis_phrases`
      );
      for (const r of rows) {
        const itemType = mapDiagnosisCategoryToItemType(r.category, r.phrase);
        if (itemType !== r.category) {
          await db.runAsync(`UPDATE diagnosis_phrases SET category=? WHERE id=?`, [itemType, r.id]);
        }
      }

      // Seed any missing default phrases per item type (do not wipe existing)
      const existing = await db.getAllAsync<{ phrase: string; category: string }>(
        `SELECT phrase, category FROM diagnosis_phrases`
      );
      const keys = new Set(
        existing.map(p => `${mapDiagnosisCategoryToItemType(p.category, p.phrase)}::${normalizeDiagnosisPhraseKey(p.phrase)}`)
      );
      let order = (await db.getFirstAsync<{ m: number }>(`SELECT MAX(sortOrder) as m FROM diagnosis_phrases`))?.m ?? 0;
      const now = new Date().toISOString();
      for (const p of DEFAULT_DIAGNOSIS_PHRASES) {
        const key = `${p.itemType}::${normalizeDiagnosisPhraseKey(p.phrase)}`;
        if (keys.has(key)) continue;
        order += 1;
        await db.runAsync(
          `INSERT INTO diagnosis_phrases
            (id, phrase, category, isFavourite, isEnabled, sortOrder, useCount, lastUsedAt, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            `dph_${Date.now()}_${order}_${Math.random().toString(36).slice(2, 6)}`,
            p.phrase, p.itemType, 0, 1, order, 0, '', now, now,
          ]
        );
        keys.add(key);
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO app_config (key, value) VALUES ('diagnosis_itemtype_v2', 'true')`
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO app_config (key, value) VALUES ('diagnosis_library_seeded_v1', 'true')`
      );
      return;
    }

    const seeded = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_config WHERE key='diagnosis_library_seeded_v1'`
    );
    if (seeded) return;

    const phraseCount = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM diagnosis_phrases`);
    const now = new Date().toISOString();
    if ((phraseCount?.count ?? 0) === 0) {
      let order = 0;
      for (const p of DEFAULT_DIAGNOSIS_PHRASES) {
        await db.runAsync(
          `INSERT OR IGNORE INTO diagnosis_phrases
            (id, phrase, category, isFavourite, isEnabled, sortOrder, useCount, lastUsedAt, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            `dph_${Date.now()}_${order}_${Math.random().toString(36).slice(2, 6)}`,
            p.phrase, p.itemType, 0, 1, order++, 0, '', now, now,
          ]
        );
      }
    }
    await db.runAsync(
      `INSERT OR REPLACE INTO app_config (key, value) VALUES ('diagnosis_library_seeded_v1', 'true')`
    );
    await db.runAsync(
      `INSERT OR REPLACE INTO app_config (key, value) VALUES ('diagnosis_itemtype_v2', 'true')`
    );
  } catch (e) {
    console.warn('Diagnosis library seed error:', e);
  }
}

/** @deprecated categories removed — returns the four item types as pseudo-categories for older callers */
export async function getDiagnosisCategories(): Promise<DiagnosisCategory[]> {
  await ensureDiagnosisLibrary();
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
  /** @deprecated use itemType */
  category?: string;
  search?: string;
  favouritesOnly?: boolean;
}): Promise<DiagnosisPhrase[]> {
  await ensureDiagnosisLibrary();
  let sql = `SELECT * FROM diagnosis_phrases WHERE 1=1`;
  const params: any[] = [];
  if (opts?.enabledOnly) sql += ` AND isEnabled=1`;
  if (opts?.favouritesOnly) sql += ` AND isFavourite=1`;
  const itemType = opts?.itemType || opts?.category;
  if (itemType && itemType !== 'All') {
    sql += ` AND category=?`;
    params.push(itemType);
  }
  if (opts?.search?.trim()) {
    sql += ` AND LOWER(phrase) LIKE ?`;
    params.push(`%${opts.search.trim().toLowerCase()}%`);
  }
  sql += ` ORDER BY sortOrder ASC, phrase ASC`;
  const rows = await db!.getAllAsync<any>(sql, params);
  return rows.map(parseDiagnosisPhrase);
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
  await ensureDiagnosisLibrary();
  let sql = `SELECT * FROM diagnosis_phrases WHERE isEnabled=1 AND lastUsedAt != ''`;
  const params: any[] = [];
  if (itemType) {
    sql += ` AND category=?`;
    params.push(itemType);
  }
  sql += ` ORDER BY lastUsedAt DESC LIMIT ?`;
  params.push(limit);
  const rows = await db!.getAllAsync<any>(sql, params);
  return rows.map(parseDiagnosisPhrase);
}

export async function getMostUsedDiagnosisPhrases(limit = 20, itemType?: string): Promise<DiagnosisPhrase[]> {
  await ensureDiagnosisLibrary();
  let sql = `SELECT * FROM diagnosis_phrases WHERE isEnabled=1 AND useCount > 0`;
  const params: any[] = [];
  if (itemType) {
    sql += ` AND category=?`;
    params.push(itemType);
  }
  sql += ` ORDER BY useCount DESC, phrase ASC LIMIT ?`;
  params.push(limit);
  const rows = await db!.getAllAsync<any>(sql, params);
  return rows.map(parseDiagnosisPhrase);
}

export async function addDiagnosisPhrase(phrase: string, itemType = 'Watch'): Promise<DiagnosisPhrase> {
  const trimmed = phrase.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Phrase cannot be blank');
  const type = mapDiagnosisCategoryToItemType(itemType, trimmed);
  const key = normalizeDiagnosisPhraseKey(trimmed);
  const all = await db!.getAllAsync<{ id: string; phrase: string }>(
    `SELECT id, phrase FROM diagnosis_phrases WHERE category=?`, [type]
  );
  if (all.some(p => normalizeDiagnosisPhraseKey(p.phrase) === key)) {
    throw new Error('A phrase with this text already exists for this item type');
  }
  const now = new Date().toISOString();
  const max = await db!.getFirstAsync<{ m: number }>(`SELECT MAX(sortOrder) as m FROM diagnosis_phrases`);
  const row: DiagnosisPhrase = {
    id: `dph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    phrase: trimmed,
    itemType: type,
    isFavourite: false,
    isEnabled: true,
    sortOrder: (max?.m ?? 0) + 1,
    useCount: 0,
    lastUsedAt: '',
    createdAt: now,
    updatedAt: now,
  };
  await db!.runAsync(
    `INSERT INTO diagnosis_phrases
      (id, phrase, category, isFavourite, isEnabled, sortOrder, useCount, lastUsedAt, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.phrase, row.itemType, 0, 1, row.sortOrder, 0, '', now, now]
  );
  notifyDataChangedForBackup();
  return row;
}

export async function updateDiagnosisPhrase(
  id: string,
  patch: Partial<Pick<DiagnosisPhrase, 'phrase' | 'itemType' | 'isFavourite' | 'isEnabled' | 'sortOrder'>>
): Promise<void> {
  const existing = await db!.getFirstAsync<any>(`SELECT * FROM diagnosis_phrases WHERE id=?`, [id]);
  if (!existing) return;

  let isFavourite = patch.isFavourite !== undefined ? (patch.isFavourite ? 1 : 0) : existing.isFavourite;
  if (patch.isFavourite === true && !existing.isFavourite) {
    const favCount = await db!.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM diagnosis_phrases WHERE isFavourite=1`
    );
    if ((favCount?.count ?? 0) >= MAX_DIAGNOSIS_FAVOURITES) {
      throw new Error(`Maximum ${MAX_DIAGNOSIS_FAVOURITES} favourites allowed`);
    }
  }

  let phrase = existing.phrase;
  if (patch.phrase !== undefined) {
    phrase = patch.phrase.trim().replace(/\s+/g, ' ');
    if (!phrase) throw new Error('Phrase cannot be blank');
  }
  const itemType = mapDiagnosisCategoryToItemType(
    patch.itemType !== undefined ? patch.itemType : existing.category,
    phrase
  );
  const key = normalizeDiagnosisPhraseKey(phrase);
  const siblings = await db!.getAllAsync<{ id: string; phrase: string }>(
    `SELECT id, phrase FROM diagnosis_phrases WHERE category=?`, [itemType]
  );
  if (siblings.some(p => p.id !== id && normalizeDiagnosisPhraseKey(p.phrase) === key)) {
    throw new Error('A phrase with this text already exists for this item type');
  }
  const isEnabled = patch.isEnabled !== undefined ? (patch.isEnabled ? 1 : 0) : existing.isEnabled;
  const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder;
  const now = new Date().toISOString();

  await db!.runAsync(
    `UPDATE diagnosis_phrases SET phrase=?, category=?, isFavourite=?, isEnabled=?, sortOrder=?, updatedAt=? WHERE id=?`,
    [phrase, itemType, isFavourite, isEnabled, sortOrder, now, id]
  );
}

export async function deleteDiagnosisPhrase(id: string): Promise<void> {
  await db!.runAsync(`DELETE FROM diagnosis_phrases WHERE id=?`, [id]);
  notifyDataChangedForBackup();
}

export async function duplicateDiagnosisPhrase(id: string): Promise<DiagnosisPhrase | null> {
  const existing = await db!.getFirstAsync<any>(`SELECT * FROM diagnosis_phrases WHERE id=?`, [id]);
  if (!existing) return null;
  const itemType = mapDiagnosisCategoryToItemType(existing.category, existing.phrase);
  return addDiagnosisPhrase(`${existing.phrase} (copy)`, itemType);
}

export async function reorderDiagnosisPhrases(orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    await db!.runAsync(
      `UPDATE diagnosis_phrases SET sortOrder=?, updatedAt=? WHERE id=?`,
      [i, now, orderedIds[i]]
    );
  }
}

export async function markDiagnosisPhrasesUsed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  for (const id of ids) {
    await db!.runAsync(
      `UPDATE diagnosis_phrases SET useCount = useCount + 1, lastUsedAt=?, updatedAt=? WHERE id=?`,
      [now, now, id]
    );
  }
}

export async function updateItemDiagnosis(itemId: string, diagnosis: string): Promise<void> {
  const now = new Date().toISOString();
  const jobId = await getJobIdByItemId(itemId);
  await db!.runAsync(
    `UPDATE repair_items SET technicianNotes=?, updatedAt=? WHERE id=?`,
    [diagnosis, now, itemId]
  );
  if (jobId) {
    await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, jobId]);
    notifyDataChanged({ jobId });
  } else {
    notifyDataChangedForBackup();
  }
}

export async function updateItemServicePerformed(itemId: string, servicePerformed: string): Promise<void> {
  const now = new Date().toISOString();
  const jobId = await getJobIdByItemId(itemId);
  await db!.runAsync(
    `UPDATE repair_items SET description=?, updatedAt=? WHERE id=?`,
    [servicePerformed, now, itemId]
  );
  if (jobId) {
    await db!.runAsync(`UPDATE repair_jobs SET updatedAt=? WHERE id=?`, [now, jobId]);
    notifyDataChanged({ jobId });
  } else {
    notifyDataChangedForBackup();
  }
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

/** Keep path/URL photo refs; strip large embedded base64 blobs from backups. */
function sanitizePhotoRef(photo: string | null | undefined): string {
  if (!photo) return '';
  const p = String(photo);
  if (
    p.startsWith('file://') ||
    p.startsWith('content://') ||
    p.startsWith('http://') ||
    p.startsWith('https://') ||
    p.startsWith('ph://') ||
    p.startsWith('assets-library://')
  ) {
    return p;
  }
  if (p.startsWith('data:') || p.length > 500) {
    return `[photo_ref_omitted:${Math.min(p.length, 999999)}]`;
  }
  return p;
}

function notifyDataChangedForBackup(): void {
  // Dynamic import avoids circular dependency with backup.ts
  import('./backup')
    .then(m => m.scheduleAutoBackup('data-change'))
    .catch(() => {});
}

/** When true, local writes from a Firestore pull must not re-queue cloud pushes. */
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

function notifyDataChanged(opts?: {
  jobId?: string;
  jobIds?: string[];
  deletedJobId?: string;
  deletedAt?: string;
  wasCloudSynced?: boolean;
}): void {
  notifyDataChangedForBackup();
  if (suppressCloudSyncNotify) return;
  import('./sync')
    .then(m => {
      if (opts?.deletedJobId) {
        m.scheduleJobDeleted(opts.deletedJobId, opts.deletedAt, opts.wasCloudSynced);
      } else if (opts?.jobIds?.length) {
        m.scheduleJobsSync(opts.jobIds);
      } else if (opts?.jobId) {
        m.scheduleJobSync(opts.jobId);
      }
    })
    .catch(() => {});
}

/**
 * Replace a full job (job row + items) from a Firestore pull.
 * Does not by itself suppress sync — callers should wrap with runWithoutCloudSyncNotify.
 */
export async function upsertFullJobFromCloud(job: RepairJob): Promise<void> {
  if (!db) return;
  await db.runAsync(`DELETE FROM repair_items WHERE jobId=?`, [job.id]);
  await db.runAsync(`DELETE FROM repair_jobs WHERE id=?`, [job.id]);
  await db.runAsync(
    `INSERT INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,cloudSyncEnabled,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      job.id, job.jobNumber, job.customerName, job.mobileNumber, job.countryCode || '+91',
      job.receivedDate, job.advanceAmount || 0, job.overallNotes || '', job.googleReviewSent ? 1 : 0,
      job.cloudSyncEnabled !== false ? 1 : 0,
      job.createdAt, job.updatedAt,
    ]
  );
  for (const item of job.items || []) {
    await insertItem({
      ...item,
      jobId: job.id,
      amountPaid: item.amountPaid || 0,
      advanceApplied: item.advanceApplied || 0,
      refundAmount: item.refundAmount || 0,
      nonRefundableCharges: item.nonRefundableCharges || 0,
      returnedDate: item.returnedDate || '',
      selectedPhrases: item.selectedPhrases || [],
      photos: item.photos || [],
    });
  }
  notifyDataChangedForBackup();
}

/** Delete local job after a remote tombstone wins conflict resolution. */
export async function deleteJobLocalOnly(id: string): Promise<void> {
  if (!db) return;
  await db.runAsync(`DELETE FROM repair_items WHERE jobId=?`, [id]);
  await db.runAsync(`DELETE FROM repair_jobs WHERE id=?`, [id]);
  notifyDataChangedForBackup();
}

export async function exportData(): Promise<string> {
  const jobs = await getAllJobs();
  const exportJobs = jobs.map(j => ({
    ...j,
    items: j.items.map(i => ({
      ...i,
      // Keep path/URL refs only — never embed large base64 image blobs
      photos: normalizePhotos(i.photos).map(p => ({
        ...p,
        localUri: p.localUri && !String(p.localUri).startsWith('data:') && String(p.localUri).length < 500
          ? sanitizePhotoRef(p.localUri)
          : (p.cloudUrl ? '' : sanitizePhotoRef(p.localUri || '')),
        cloudUrl: p.cloudUrl || '',
      })),
    })),
  }));
  const phrases = await getAllCustomPhrases();
  const diagnosisPhrases = await getDiagnosisPhrases();
  const diagnosisCategories = await getDiagnosisCategories();
  const configRows = await db!.getAllAsync<{key:string,value:string}>(`SELECT * FROM app_config`);
  const config: Record<string,string> = {};
  for (const r of configRows) config[r.key] = r.value;
  const data: BackupData = {
    version: '2.1',
    timestamp: new Date().toISOString(),
    jobs: exportJobs,
    customPhrases: phrases,
    diagnosisPhrases,
    diagnosisCategories,
    appConfig: config,
  };
  return JSON.stringify(data);
}

export async function importData(jsonStr: string): Promise<number> {
  const data: BackupData = JSON.parse(jsonStr);
  if ((data.version === '2.0' || data.version === '2.1' || String(data.version || '').startsWith('2.')) && data.jobs) {
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
          `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,advanceApplied,refundAmount,nonRefundableCharges,returnedDate,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            item.id, item.jobId, item.itemNumber, item.itemType, item.brand || '', item.model || '',
            item.color || '', item.identification || '', item.description || '',
            JSON.stringify(item.selectedPhrases || []), item.customerComplaint || '',
            item.accessoriesReceived || '', item.estimatedAmount || 0, item.finalAmount || 0,
            item.amountPaid || 0, item.advanceApplied || 0, item.refundAmount || 0, item.nonRefundableCharges || 0,
            item.returnedDate || '', item.technicianNotes || '', JSON.stringify(preparePhotosForStorage(item.photos)),
            item.status, item.expectedDeliveryDate || '', item.warrantyDetails || '',
            item.delivered ? 1 : 0, item.deliveredDate || '', item.createdAt, item.updatedAt,
          ]
        );
      }
    }
    if (data.customPhrases) {
      for (const p of data.customPhrases) {
        await db!.runAsync(
          `INSERT OR IGNORE INTO custom_phrases (id,itemType,phrase,isEnabled,sortOrder) VALUES (?,?,?,?,?)`,
          [p.id, p.itemType, p.phrase, p.isEnabled === false ? 0 : 1, p.sortOrder ?? 0]
        );
      }
    }
    if (data.diagnosisCategories) {
      for (const c of data.diagnosisCategories) {
        await db!.runAsync(
          `INSERT OR IGNORE INTO diagnosis_categories (id, name, sortOrder) VALUES (?,?,?)`,
          [c.id, c.name, c.sortOrder ?? 0]
        );
      }
    }
    if (data.diagnosisPhrases) {
      for (const p of data.diagnosisPhrases) {
        await db!.runAsync(
          `INSERT OR IGNORE INTO diagnosis_phrases
            (id, phrase, category, isFavourite, isEnabled, sortOrder, useCount, lastUsedAt, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            p.id, p.phrase, mapDiagnosisCategoryToItemType((p as any).itemType || (p as any).category || 'Watch', p.phrase), p.isFavourite ? 1 : 0, p.isEnabled !== false ? 1 : 0,
            p.sortOrder ?? 0, p.useCount ?? 0, p.lastUsedAt || '', p.createdAt || new Date().toISOString(),
            p.updatedAt || new Date().toISOString(),
          ]
        );
      }
    }
    if (data.appConfig) {
      for (const [k,v] of Object.entries(data.appConfig)) {
        await db!.runAsync(`INSERT OR REPLACE INTO app_config (key,value) VALUES (?,?)`, [k, v]);
      }
    }
    notifyDataChanged({ jobIds: data.jobs.map(j => j.id) });
    return data.jobs.length;
  } else if (data.records) {
    // Old format v1
    const now = new Date().toISOString();
    const importedIds: string[] = [];
    for (const old of data.records) {
      const jobId = 'imp_' + old.id;
      const itemId = 'imp_item_' + old.id;
      importedIds.push(jobId);
      const status = mapLegacyStatus(old.status || 'Received');
      const delivered = status === 'Delivered' || old.status === 'Delivered' || old.status === 'Completed';
      await db!.runAsync(
        `INSERT OR IGNORE INTO repair_jobs (id,jobNumber,customerName,mobileNumber,countryCode,receivedDate,advanceAmount,overallNotes,googleReviewSent,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [jobId, old.id, old.name, old.phone, old.countryCode||'+91', old.date||now, 0, '', 0, now, now]
      );
      await db!.runAsync(
        `INSERT OR IGNORE INTO repair_items (id,jobId,itemNumber,itemType,brand,model,color,identification,description,selectedPhrases,customerComplaint,accessoriesReceived,estimatedAmount,finalAmount,amountPaid,technicianNotes,photos,status,expectedDeliveryDate,warrantyDetails,delivered,deliveredDate,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, jobId, 1, old.item||'Watch', '', '', '', '', old.issue||'', '[]', '', '', 0, 0, 0, '', '[]', status, '', '', delivered?1:0, old.deliveredAt||'', now, now]
      );
    }
    notifyDataChanged({ jobIds: importedIds });
    return data.records.length;
  }
  throw new Error('Invalid backup format');
}

// Aliases for backward compat with settings screen
export const getSetting = getConfig;
export const setSetting = setConfig;
export const getRecordCount = getJobCount;
export const clearAllRecords = async () => {
  const jobs = await getAllJobs();
  const now = new Date().toISOString();
  await db!.execAsync('DELETE FROM repair_items');
  await db!.execAsync('DELETE FROM repair_jobs');
  notifyDataChangedForBackup();
  if (!suppressCloudSyncNotify) {
    import('./sync')
      .then(m => {
        for (const j of jobs) m.scheduleJobDeleted(j.id, now);
      })
      .catch(() => {});
  }
};
