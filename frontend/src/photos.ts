/**
 * Repair image helpers: normalize legacy string URIs, display priority,
 * compress + upload to Firebase Storage.
 */
import { Platform } from 'react-native';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { RepairItem, RepairJob, RepairPhoto, PhotoUploadStatus } from './types';
import { getFirebaseAuth, getFirebaseStorage } from './firebase';
import { signInAnonymously } from 'firebase/auth';

export function newPhotoId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isRemoteHttpUrl(uri: string | undefined | null): boolean {
  if (!uri) return false;
  return /^https?:\/\//i.test(uri);
}

export function isLocalDeviceUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  const u = String(uri);
  return (
    u.startsWith('file://') ||
    u.startsWith('content://') ||
    u.startsWith('ph://') ||
    u.startsWith('assets-library://') ||
    u.startsWith('data:') ||
    (!isRemoteHttpUrl(u) && u.length > 0)
  );
}

/** Convert legacy string[] / mixed JSON into RepairPhoto[]. */
export function normalizePhotos(raw: unknown): RepairPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: RepairPhoto[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      const uri = entry.trim();
      if (!uri) continue;
      if (isRemoteHttpUrl(uri)) {
        out.push({
          id: newPhotoId(),
          cloudUrl: uri,
          localUri: '',
          storagePath: '',
          uploadStatus: 'uploaded',
          uploadedAt: '',
        });
      } else {
        out.push({
          id: newPhotoId(),
          localUri: uri,
          cloudUrl: '',
          storagePath: '',
          uploadStatus: 'local',
          uploadedAt: '',
        });
      }
      continue;
    }
    if (typeof entry === 'object') {
      const o = entry as Partial<RepairPhoto>;
      const localUri = String(o.localUri || '');
      const cloudUrl = String(o.cloudUrl || '');
      if (!localUri && !cloudUrl) continue;
      let uploadStatus = (o.uploadStatus || 'local') as PhotoUploadStatus;
      if (cloudUrl && isRemoteHttpUrl(cloudUrl)) uploadStatus = 'uploaded';
      else if (!uploadStatus) uploadStatus = 'local';
      out.push({
        id: String(o.id || newPhotoId()),
        localUri,
        cloudUrl,
        storagePath: String(o.storagePath || ''),
        uploadStatus,
        uploadedAt: String(o.uploadedAt || ''),
      });
    }
  }
  return out;
}

export function photoHasDisplayableSource(p: RepairPhoto): boolean {
  if (p.cloudUrl && isRemoteHttpUrl(p.cloudUrl)) return true;
  if (Platform.OS !== 'web' && p.localUri) return true;
  return false;
}

/** True if any photo record exists (including local-only, useful on web for placeholders). */
export function itemHasPhotoRecords(photos: unknown): boolean {
  return normalizePhotos(photos).length > 0;
}

/** True if at least one photo can be shown on this platform. */
export function itemHasPhotos(photos: unknown): boolean {
  return normalizePhotos(photos).some(photoHasDisplayableSource);
}

/** Small list thumbnail URI (cloud preferred; never local device paths on web). */
export function getThumbnailUri(photos: unknown): string | null {
  return getFirstDisplayUri(photos);
}

/**
 * Display URI priority: cloudUrl → localUri (native only).
 * Never returns file:// / content:// / data: on web.
 */
export function getPhotoDisplayUri(photo: RepairPhoto | string | null | undefined): string | null {
  if (!photo) return null;
  const p = typeof photo === 'string'
    ? normalizePhotos([photo])[0]
    : photo;
  if (!p) return null;
  if (p.cloudUrl && isRemoteHttpUrl(p.cloudUrl)) return p.cloudUrl;
  if (Platform.OS === 'web') return null;
  if (p.localUri) return p.localUri;
  return null;
}

export function getFirstDisplayUri(photos: unknown): string | null {
  for (const p of normalizePhotos(photos)) {
    const uri = getPhotoDisplayUri(p);
    if (uri) return uri;
  }
  return null;
}

export function isLocalOnlyPhoto(p: RepairPhoto): boolean {
  const hasCloud = !!(p.cloudUrl && isRemoteHttpUrl(p.cloudUrl));
  const hasLocal = !!p.localUri;
  return hasLocal && !hasCloud;
}

export function countLocalOnlyPhotos(jobs: RepairJob[]): number {
  let n = 0;
  for (const j of jobs) {
    for (const item of j.items || []) {
      n += normalizePhotos(item.photos).filter(isLocalOnlyPhoto).length;
    }
  }
  return n;
}

export function createPhotoFromCapture(uri: string): RepairPhoto {
  return {
    id: newPhotoId(),
    localUri: uri,
    cloudUrl: '',
    storagePath: '',
    uploadStatus: 'pending',
    uploadedAt: '',
  };
}

/** Strip huge base64 blobs before Firestore sync; keep cloud URLs + short path refs. */
export function sanitizePhotosForCloud(photos: unknown): RepairPhoto[] {
  return normalizePhotos(photos).map(p => {
    const local = p.localUri || '';
    const keepLocal =
      local &&
      !local.startsWith('data:') &&
      local.length < 500 &&
      (local.startsWith('file://') || local.startsWith('content://') || local.startsWith('http'));
    return {
      id: p.id,
      localUri: keepLocal ? local : '',
      cloudUrl: p.cloudUrl && isRemoteHttpUrl(p.cloudUrl) ? p.cloudUrl : '',
      storagePath: p.storagePath || '',
      uploadStatus: p.cloudUrl && isRemoteHttpUrl(p.cloudUrl) ? 'uploaded' : p.uploadStatus,
      uploadedAt: p.uploadedAt || '',
    };
  });
}

async function ensureAuth(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) await signInAnonymously(auth);
}

async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  return await res.blob();
}

/** Compress / resize for upload (native). On web, pass through. */
export async function compressImageForUpload(uri: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImageManipulator = require('expo-image-manipulator');
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1400 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri || uri;
  } catch {
    return uri;
  }
}

/**
 * Upload one photo to Firebase Storage and return updated RepairPhoto.
 * Path: repair-jobs/{jobId}/items/{itemId}/{unique}.jpg
 */
export async function uploadRepairPhoto(
  photo: RepairPhoto,
  jobId: string,
  itemId: string,
): Promise<RepairPhoto> {
  if (photo.cloudUrl && isRemoteHttpUrl(photo.cloudUrl)) {
    return { ...photo, uploadStatus: 'uploaded' };
  }
  const source = photo.localUri;
  if (!source) {
    return { ...photo, uploadStatus: 'failed' };
  }

  await ensureAuth();
  const compressed = await compressImageForUpload(source);
  const storagePath = `repair-jobs/${jobId}/items/${itemId}/${photo.id}.jpg`;
  const storageRef = ref(getFirebaseStorage(), storagePath);

  let uploadUri = compressed;
  // data: URIs — write via fetch blob; file:// also works with fetch on RN
  if (source.startsWith('data:')) {
    uploadUri = source;
  }

  const blob = await uriToBlob(uploadUri);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
  const cloudUrl = await getDownloadURL(storageRef);

  return {
    ...photo,
    cloudUrl,
    storagePath,
    uploadStatus: 'uploaded',
    uploadedAt: new Date().toISOString(),
  };
}

export type UploadExistingProgress = {
  total: number;
  done: number;
  failed: number;
  currentJobId?: string;
};

/**
 * Upload all local-only photos across jobs. Updates items via callback.
 */
export async function uploadExistingLocalPhotos(
  jobs: RepairJob[],
  onProgress?: (p: UploadExistingProgress) => void,
  updateItemPhotos?: (itemId: string, photos: RepairPhoto[]) => Promise<void>,
  queueJobSync?: (jobId: string) => void,
): Promise<UploadExistingProgress> {
  type Task = { jobId: string; item: RepairItem; photo: RepairPhoto; index: number };
  const tasks: Task[] = [];
  for (const job of jobs) {
    for (const item of job.items || []) {
      const photos = normalizePhotos(item.photos);
      photos.forEach((photo, index) => {
        if (isLocalOnlyPhoto(photo)) tasks.push({ jobId: job.id, item, photo, index });
      });
    }
  }

  const progress: UploadExistingProgress = { total: tasks.length, done: 0, failed: 0 };
  onProgress?.(progress);

  // Group by item to write once per item
  const byItem = new Map<string, { jobId: string; item: RepairItem; photos: RepairPhoto[] }>();
  for (const job of jobs) {
    for (const item of job.items || []) {
      byItem.set(item.id, { jobId: job.id, item, photos: normalizePhotos(item.photos) });
    }
  }

  for (const task of tasks) {
    progress.currentJobId = task.jobId;
    onProgress?.({ ...progress });
    const entry = byItem.get(task.item.id);
    if (!entry) {
      progress.done += 1;
      progress.failed += 1;
      continue;
    }
    const idx = entry.photos.findIndex(p => p.id === task.photo.id);
    if (idx < 0) {
      progress.done += 1;
      continue;
    }
    try {
      entry.photos[idx] = {
        ...entry.photos[idx],
        uploadStatus: 'uploading',
      };
      const uploaded = await uploadRepairPhoto(entry.photos[idx], task.jobId, task.item.id);
      entry.photos[idx] = uploaded;
      if (updateItemPhotos) {
        await updateItemPhotos(task.item.id, entry.photos);
      }
      queueJobSync?.(task.jobId);
    } catch (e) {
      console.warn('Photo upload failed:', e);
      entry.photos[idx] = { ...entry.photos[idx], uploadStatus: 'failed' };
      if (updateItemPhotos) {
        await updateItemPhotos(task.item.id, entry.photos).catch(() => {});
      }
      progress.failed += 1;
    }
    progress.done += 1;
    onProgress?.({ ...progress });
  }

  return progress;
}
