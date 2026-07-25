/**
 * Automatic backup service for Swissa Repair App.
 *
 * Local layers:
 *  1. Live SQLite / in-memory data
 *  2. Latest automatic backup (overwritten after debounced changes)
 *  3. Daily + weekly dated snapshots (retention limited)
 *  4. Manual Export Backup (never auto-deleted)
 *
 * Firebase live sync is handled separately in sync.ts (Firestore).
 * These files are recovery snapshots only.
 */
import { Platform } from 'react-native';
import { exportData, getJobCount, getConfig, setConfig } from './database';

export const AUTO_BACKUP_ENABLED_KEY = 'autoBackupEnabled';
export const LAST_AUTO_BACKUP_TIME_KEY = 'lastAutoBackupTime';
export const LAST_AUTO_BACKUP_RESULT_KEY = 'lastAutoBackupResult';
export const LAST_AUTO_BACKUP_ERROR_KEY = 'lastAutoBackupError';
export const LAST_AUTO_BACKUP_LOCATION_KEY = 'lastAutoBackupLocation';
export const LAST_DAILY_SNAPSHOT_KEY = 'lastDailySnapshotDate';

const DEBOUNCE_MS = 8000;
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;

const LATEST_NAME = 'swissa_auto_latest.json';
const DAILY_PREFIX = 'swissa_auto_daily_';
const WEEKLY_PREFIX = 'swissa_auto_weekly_';
const MANUAL_PREFIX = 'swissa_backup_'; // manual exports — never auto-delete

export type AutoBackupStatus = {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastResult: 'Successful' | 'Failed' | 'Never';
  lastError: string | null;
  location: string;
  jobCountHint: number;
};

type ValidatedBackup = {
  ok: true;
  json: string;
  timestamp: string;
  jobCount: number;
};

type InvalidBackup = {
  ok: false;
  reason: string;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pendingAfterRun = false;

function getFileSystem(): typeof import('expo-file-system/legacy') | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-file-system/legacy');
  } catch {
    return null;
  }
}

export function getAutoBackupRootDir(): string {
  const FS = getFileSystem();
  if (!FS?.documentDirectory) return '(app storage unavailable on this platform)';
  return `${FS.documentDirectory}SwissaBackups/`;
}

export function getAutoBackupLocationLabel(): string {
  if (Platform.OS === 'web') return 'Browser local storage (web)';
  return getAutoBackupRootDir();
}

async function ensureAutoDir(): Promise<string | null> {
  const FS = getFileSystem();
  if (!FS?.documentDirectory) return null;
  const dir = `${FS.documentDirectory}SwissaBackups/auto/`;
  await FS.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** Keep path/URL photo refs; strip large embedded base64 blobs. */
export function sanitizePhotoRef(photo: string | null | undefined): string {
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

export function validateBackupJson(jsonStr: string, currentJobCount = 0): ValidatedBackup | InvalidBackup {
  try {
    if (!jsonStr || !String(jsonStr).trim()) {
      return { ok: false, reason: 'Backup is empty' };
    }
    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'Backup is not a JSON object' };
    }
    if (!data.version) {
      return { ok: false, reason: 'Missing backup version' };
    }
    const jobs = Array.isArray(data.jobs)
      ? data.jobs
      : Array.isArray(data.records)
        ? data.records
        : null;
    if (!jobs) {
      return { ok: false, reason: 'Backup has no jobs/records array' };
    }
    const jobCount = jobs.length;
    // Never replace a populated DB backup with an empty incomplete dump
    if (jobCount === 0 && currentJobCount > 0) {
      return { ok: false, reason: 'Backup has 0 jobs but live database has records' };
    }
    const timestamp = typeof data.timestamp === 'string' && data.timestamp
      ? data.timestamp
      : new Date().toISOString();
    return { ok: true, json: jsonStr, timestamp, jobCount };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'Invalid JSON' };
  }
}

export async function peekBackupMeta(jsonStr: string): Promise<{
  timestamp: string;
  jobCount: number;
  version: string;
} | null> {
  try {
    const data = JSON.parse(jsonStr);
    const jobs = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data.records) ? data.records : [];
    return {
      timestamp: data.timestamp || '',
      jobCount: jobs.length,
      version: String(data.version || ''),
    };
  } catch {
    return null;
  }
}

function isoWeekKey(d: Date): string {
  // ISO week: YYYY-Www
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function writeNativeFile(path: string, contents: string): Promise<void> {
  const FS = getFileSystem();
  if (!FS) throw new Error('File system unavailable');
  await FS.writeAsStringAsync(path, contents);
}

async function readNativeFile(path: string): Promise<string> {
  const FS = getFileSystem();
  if (!FS) throw new Error('File system unavailable');
  return FS.readAsStringAsync(path);
}

async function listAutoFiles(dir: string): Promise<string[]> {
  const FS = getFileSystem();
  if (!FS) return [];
  try {
    const names = await FS.readDirectoryAsync(dir);
    return names.filter(n => n.startsWith('swissa_auto_'));
  } catch {
    return [];
  }
}

async function pruneRetention(dir: string): Promise<void> {
  const FS = getFileSystem();
  if (!FS) return;
  const names = await listAutoFiles(dir);

  const dailies = names
    .filter(n => n.startsWith(DAILY_PREFIX) && n.endsWith('.json'))
    .sort()
    .reverse();
  const weeklies = names
    .filter(n => n.startsWith(WEEKLY_PREFIX) && n.endsWith('.json'))
    .sort()
    .reverse();

  const keep = new Set<string>([LATEST_NAME]);
  dailies.slice(0, KEEP_DAILY).forEach(n => keep.add(n));
  weeklies.slice(0, KEEP_WEEKLY).forEach(n => keep.add(n));

  for (const name of names) {
    // Never touch manual exports (different folder / prefix)
    if (name.startsWith(MANUAL_PREFIX)) continue;
    if (!name.startsWith('swissa_auto_')) continue;
    if (keep.has(name)) continue;
    try {
      await FS.deleteAsync(dir + name, { idempotent: true });
    } catch {
      // ignore prune errors
    }
  }
}

async function writeWebLatest(json: string): Promise<string> {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }
  localStorage.setItem('swissa_auto_latest', json);
  const day = new Date().toISOString().slice(0, 10);
  localStorage.setItem(`swissa_auto_daily_${day}`, json);
  // prune old daily keys
  const dailyKeys = Object.keys(localStorage)
    .filter(k => k.startsWith('swissa_auto_daily_'))
    .sort()
    .reverse();
  dailyKeys.slice(KEEP_DAILY).forEach(k => localStorage.removeItem(k));
  return 'localStorage:swissa_auto_latest';
}

async function writeNativeLatest(json: string, alsoDaily: boolean, alsoWeekly: boolean): Promise<string> {
  const dir = await ensureAutoDir();
  if (!dir) throw new Error('Could not create backup directory');

  const latestPath = dir + LATEST_NAME;
  // Write to temp first, validate already done, then replace
  const tmpPath = dir + `swissa_auto_latest.tmp.json`;
  await writeNativeFile(tmpPath, json);
  // Atomic-ish replace: delete old latest then move by rewriting
  const FS = getFileSystem()!;
  try {
    const info = await FS.getInfoAsync(latestPath);
    if (info.exists) await FS.deleteAsync(latestPath, { idempotent: true });
  } catch { /* */ }
  await writeNativeFile(latestPath, json);
  try {
    await FS.deleteAsync(tmpPath, { idempotent: true });
  } catch { /* */ }

  if (alsoDaily) {
    const day = new Date().toISOString().slice(0, 10);
    await writeNativeFile(`${dir}${DAILY_PREFIX}${day}.json`, json);
  }
  if (alsoWeekly) {
    const week = isoWeekKey(new Date());
    await writeNativeFile(`${dir}${WEEKLY_PREFIX}${week}.json`, json);
  }

  await pruneRetention(dir);
  return latestPath;
}

async function markResult(ok: boolean, location: string, error?: string): Promise<void> {
  const now = new Date().toISOString();
  if (ok) {
    await setConfig(LAST_AUTO_BACKUP_TIME_KEY, now);
    await setConfig(LAST_AUTO_BACKUP_RESULT_KEY, 'success');
    await setConfig(LAST_AUTO_BACKUP_ERROR_KEY, '');
    await setConfig(LAST_AUTO_BACKUP_LOCATION_KEY, location);
    // Keep legacy key in sync for older UI
    await setConfig('lastBackupTime', now);
  } else {
    await setConfig(LAST_AUTO_BACKUP_RESULT_KEY, 'failed');
    await setConfig(LAST_AUTO_BACKUP_ERROR_KEY, error || 'Unknown error');
  }
}

/**
 * Run an automatic backup now (writes latest + optional daily/weekly snapshots).
 * Never overwrites a valid latest with invalid/empty data.
 */
export async function runAutoBackup(opts?: { forceDaily?: boolean }): Promise<{
  ok: boolean;
  location?: string;
  error?: string;
  jobCount?: number;
}> {
  if (running) {
    pendingAfterRun = true;
    return { ok: false, error: 'Backup already running' };
  }
  running = true;
  try {
    const enabled = await getConfig(AUTO_BACKUP_ENABLED_KEY);
    // Default ON when unset
    if (enabled === 'false') {
      return { ok: false, error: 'Automatic backup is OFF' };
    }

    const currentCount = await getJobCount();
    const raw = await exportData();
    const validated = validateBackupJson(raw, currentCount);
    if (!validated.ok) {
      await markResult(false, '', validated.reason);
      return { ok: false, error: validated.reason };
    }

    const today = new Date().toISOString().slice(0, 10);
    const lastDaily = await getConfig(LAST_DAILY_SNAPSHOT_KEY);
    const needDaily = opts?.forceDaily || lastDaily !== today;
    // Weekly snapshot once per ISO week (reuse last daily key pattern via weekly file existence)
    const needWeekly = true; // write weekly file; prune keeps last 4

    let location: string;
    if (Platform.OS === 'web') {
      location = await writeWebLatest(validated.json);
    } else {
      location = await writeNativeLatest(validated.json, needDaily, needWeekly);
    }

    if (needDaily) {
      await setConfig(LAST_DAILY_SNAPSHOT_KEY, today);
    }
    await markResult(true, location);
    return { ok: true, location, jobCount: validated.jobCount };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await markResult(false, '', msg);
    return { ok: false, error: msg };
  } finally {
    running = false;
    if (pendingAfterRun) {
      pendingAfterRun = false;
      scheduleAutoBackup('queued');
    }
  }
}

/** Debounced: several quick edits → one backup (~8s after last change). */
export function scheduleAutoBackup(_reason?: string): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runAutoBackup().catch(err => {
      console.warn('Auto backup failed:', err);
    });
  }, DEBOUNCE_MS);
}

/** Immediate backup (Back Up Now / pre-restore). Bypasses debounce. */
export async function backupNow(): Promise<{
  ok: boolean;
  location?: string;
  error?: string;
  jobCount?: number;
}> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  return runAutoBackup({ forceDaily: true });
}

export async function getAutoBackupStatus(): Promise<AutoBackupStatus> {
  const enabledRaw = await getConfig(AUTO_BACKUP_ENABLED_KEY);
  const enabled = enabledRaw !== 'false';
  const lastSuccessAt = await getConfig(LAST_AUTO_BACKUP_TIME_KEY);
  const resultRaw = await getConfig(LAST_AUTO_BACKUP_RESULT_KEY);
  const lastError = await getConfig(LAST_AUTO_BACKUP_ERROR_KEY);
  const location = (await getConfig(LAST_AUTO_BACKUP_LOCATION_KEY)) || getAutoBackupLocationLabel();
  let lastResult: AutoBackupStatus['lastResult'] = 'Never';
  if (resultRaw === 'success') lastResult = 'Successful';
  else if (resultRaw === 'failed') lastResult = 'Failed';
  else if (lastSuccessAt) lastResult = 'Successful';

  return {
    enabled,
    lastSuccessAt,
    lastResult,
    lastError: lastError || null,
    location,
    jobCountHint: await getJobCount(),
  };
}

export async function setAutoBackupEnabled(enabled: boolean): Promise<void> {
  await setConfig(AUTO_BACKUP_ENABLED_KEY, enabled ? 'true' : 'false');
  // legacy key used by older 9 PM toggle
  await setConfig('autoBackup', enabled ? 'true' : 'false');
}

/** On app open: ensure enabled by default, retry failed backup, create daily snapshot if needed. */
export async function initAutoBackupOnLaunch(): Promise<void> {
  try {
    const enabled = await getConfig(AUTO_BACKUP_ENABLED_KEY);
    if (enabled === null || enabled === undefined || enabled === '') {
      await setAutoBackupEnabled(true);
    }
    const result = await getConfig(LAST_AUTO_BACKUP_RESULT_KEY);
    const lastDaily = await getConfig(LAST_DAILY_SNAPSHOT_KEY);
    const today = new Date().toISOString().slice(0, 10);
    if (result === 'failed' || lastDaily !== today) {
      // Non-blocking
      runAutoBackup({ forceDaily: lastDaily !== today }).catch(() => {});
    }
  } catch (e) {
    console.warn('initAutoBackupOnLaunch failed:', e);
  }
}

/**
 * Manual export path (share / download). Does not delete these files during auto prune.
 */
export async function exportManualBackupFile(): Promise<{ uri: string; json: string }> {
  const json = await exportData();
  const currentCount = await getJobCount();
  const validated = validateBackupJson(json, currentCount);
  if (!validated.ok) throw new Error(validated.reason);

  if (Platform.OS === 'web') {
    return { uri: '', json: validated.json };
  }

  const FS = getFileSystem();
  if (!FS?.documentDirectory) throw new Error('File system unavailable');
  const dir = `${FS.documentDirectory}SwissaBackups/`;
  await FS.makeDirectoryAsync(dir, { intermediates: true });
  const filename = `${MANUAL_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const uri = dir + filename;
  await FS.writeAsStringAsync(uri, validated.json);
  await setConfig('lastBackupTime', new Date().toISOString());
  return { uri, json: validated.json };
}
