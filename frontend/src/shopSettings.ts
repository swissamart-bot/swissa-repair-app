/**
 * Shop-level settings stored in local app_config and synced to Firestore
 * so devices share the same Google Review defaults.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirestoreDb, hasFirebaseWebAppConfig } from './firebase';
import { getFirebaseAuth } from './firebase';
import { signInAnonymously } from 'firebase/auth';

export const GOOGLE_REVIEW_LINK_KEY = 'googleReviewLink';
export const INCLUDE_GOOGLE_REVIEW_KEY = 'includeGoogleReviewInDelivery';
export const SHOP_SETTINGS_UPDATED_AT_KEY = 'shopSettingsUpdatedAt';

export async function getIncludeGoogleReviewDefault(): Promise<boolean> {
  const { getConfig } = await import('./database');
  const v = await getConfig(INCLUDE_GOOGLE_REVIEW_KEY);
  if (v === null || v === undefined || v === '') return true; // default ON
  return v === 'true' || v === '1';
}

export async function setIncludeGoogleReviewDefault(enabled: boolean): Promise<void> {
  const { setConfig } = await import('./database');
  const now = new Date().toISOString();
  await setConfig(INCLUDE_GOOGLE_REVIEW_KEY, enabled ? 'true' : 'false');
  await setConfig(SHOP_SETTINGS_UPDATED_AT_KEY, now);
  await pushShopSettingsToCloud().catch(e => console.warn('Shop settings push failed:', e));
}

export async function getGoogleReviewLink(): Promise<string> {
  const { getConfig } = await import('./database');
  return (await getConfig(GOOGLE_REVIEW_LINK_KEY)) || '';
}

export async function setGoogleReviewLink(link: string): Promise<void> {
  const { setConfig } = await import('./database');
  const now = new Date().toISOString();
  await setConfig(GOOGLE_REVIEW_LINK_KEY, link.trim());
  await setConfig(SHOP_SETTINGS_UPDATED_AT_KEY, now);
  await pushShopSettingsToCloud().catch(e => console.warn('Shop settings push failed:', e));
}

async function ensureAuth(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) await signInAnonymously(auth);
}

export async function pushShopSettingsToCloud(): Promise<void> {
  if (!hasFirebaseWebAppConfig()) return;
  await ensureAuth();
  const { getConfig } = await import('./database');
  const googleReviewLink = (await getConfig(GOOGLE_REVIEW_LINK_KEY)) || '';
  const includeRaw = await getConfig(INCLUDE_GOOGLE_REVIEW_KEY);
  const includeGoogleReviewInDelivery =
    includeRaw === null || includeRaw === undefined || includeRaw === ''
      ? true
      : includeRaw === 'true' || includeRaw === '1';
  const updatedAt = (await getConfig(SHOP_SETTINGS_UPDATED_AT_KEY)) || new Date().toISOString();

  const db = getFirestoreDb();
  await setDoc(
    doc(db, 'app_settings', 'shop'),
    {
      googleReviewLink,
      includeGoogleReviewInDelivery,
      updatedAt,
    },
    { merge: true },
  );
}

/** Pull shop settings from Firestore; newer updatedAt wins. */
export async function pullShopSettingsFromCloud(): Promise<void> {
  if (!hasFirebaseWebAppConfig()) return;
  try {
    await ensureAuth();
    const db = getFirestoreDb();
    const snap = await getDoc(doc(db, 'app_settings', 'shop'));
    if (!snap.exists()) return;
    const data = snap.data();
    const remoteTs = String(data.updatedAt || '');
    const { getConfig, setConfig } = await import('./database');
    const localTs = (await getConfig(SHOP_SETTINGS_UPDATED_AT_KEY)) || '';
    if (remoteTs && localTs && remoteTs <= localTs) return;

    if (typeof data.googleReviewLink === 'string') {
      await setConfig(GOOGLE_REVIEW_LINK_KEY, data.googleReviewLink);
    }
    if (typeof data.includeGoogleReviewInDelivery === 'boolean') {
      await setConfig(
        INCLUDE_GOOGLE_REVIEW_KEY,
        data.includeGoogleReviewInDelivery ? 'true' : 'false',
      );
    }
    if (remoteTs) await setConfig(SHOP_SETTINGS_UPDATED_AT_KEY, remoteTs);
  } catch (e) {
    console.warn('Shop settings pull failed:', e);
  }
}

export function formatGoogleReviewWhatsAppSection(link: string): string {
  return (
    `\n\n⭐ We value your feedback.\n` +
    `Please share your experience with Swissa Watch & Opticals:\n` +
    `${link.trim()}`
  );
}
