/**
 * Firebase / Firestore bootstrap for project swissa-repair-pro.
 *
 * Firebase JavaScript SDK only (package: `firebase`) — NOT `@react-native-firebase/*`.
 * Config is loaded from EXPO_PUBLIC_FIREBASE_* (EAS env / local .env) — Web app.
 *
 * IMPORTANT: Do not throw at module import time. Missing env must leave the app
 * runnable (SQLite / local) with cloud sync reporting a clear config error.
 */
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

const env = (key: string): string | undefined => {
  const v = (process.env as Record<string, string | undefined>)[key];
  return v && String(v).trim() ? String(v).trim() : undefined;
};

const REQUIRED_KEYS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
] as const;

/**
 * Lazy read + validate Firebase Web app config.
 * Safe to call repeatedly; does not throw — returns null when incomplete.
 */
export function getFirebaseConfig(): FirebaseWebConfig | null {
  const missing = REQUIRED_KEYS.filter(k => !env(k));
  if (missing.length > 0) return null;

  const appId = env('EXPO_PUBLIC_FIREBASE_APP_ID')!;
  if (!appId.includes(':web:')) return null;

  const measurementId = env('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID');
  return {
    apiKey: env('EXPO_PUBLIC_FIREBASE_API_KEY')!,
    authDomain: env('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN')!,
    projectId: env('EXPO_PUBLIC_FIREBASE_PROJECT_ID')!,
    storageBucket: env('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET')!,
    messagingSenderId: env('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID')!,
    appId,
    ...(measurementId ? { measurementId } : {}),
  };
}

/** True when a Web appId (`…:web:…`) and all required env keys are present. */
export function hasFirebaseWebAppConfig(): boolean {
  return getFirebaseConfig() != null;
}

export function getFirebaseConfigStatus(): {
  ok: boolean;
  source: 'env-web' | 'incomplete';
  projectId: string;
  appIdPreview: string;
  message: string;
} {
  const cfg = getFirebaseConfig();
  if (cfg) {
    return {
      ok: true,
      source: 'env-web',
      projectId: cfg.projectId,
      appIdPreview: cfg.appId.slice(0, 24) + '…',
      message: 'Firebase Web app config loaded from environment',
    };
  }

  const missing = REQUIRED_KEYS.filter(k => !env(k));
  const appId = env('EXPO_PUBLIC_FIREBASE_APP_ID') || '';
  let message: string;
  if (missing.length > 0) {
    message =
      `Cloud sync unavailable: missing ${missing.join(', ')}. ` +
      'Set EXPO_PUBLIC_FIREBASE_* in EAS preview environment (Web app config).';
  } else if (!appId.includes(':web:')) {
    message =
      'Cloud sync unavailable: EXPO_PUBLIC_FIREBASE_APP_ID must be the Firebase Web app ID (contains ":web:").';
  } else {
    message = 'Cloud sync unavailable: Firebase configuration is incomplete.';
  }

  return {
    ok: false,
    source: 'incomplete',
    projectId: env('EXPO_PUBLIC_FIREBASE_PROJECT_ID') || '',
    appIdPreview: appId ? appId.slice(0, 24) + '…' : '(empty)',
    message,
  };
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  const cfg = getFirebaseConfig();
  if (!cfg) {
    throw new Error(getFirebaseConfigStatus().message);
  }
  try {
    app = getApps().length ? getApp() : initializeApp(cfg);
    return app;
  } catch (e: any) {
    app = null;
    throw new Error(e?.message || 'Firebase app initialization failed');
  }
}

export function getFirestoreDb(): Firestore {
  if (db) return db;
  db = getFirestore(getFirebaseApp());
  return db;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();

  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
    return auth;
  }

  // Persist anonymous session across restarts (Metro resolves RN auth bundle).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    // getReactNativePersistence exists in the RN auth bundle; Node typings often omit it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authMod = require('firebase/auth') as typeof import('firebase/auth') & {
      getReactNativePersistence?: (storage: unknown) => unknown;
    };
    if (typeof authMod.getReactNativePersistence === 'function') {
      auth = initializeAuth(firebaseApp, {
        persistence: authMod.getReactNativePersistence(AsyncStorage) as any,
      });
      return auth;
    }
  } catch {
    // Already initialized, or persistence helper unavailable
  }

  auth = getAuth(firebaseApp);
  return auth;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (storage) return storage;
  storage = getStorage(getFirebaseApp());
  return storage;
}

/** Firestore collection for repair jobs (one document per job, items embedded). */
export const FIRESTORE_JOBS_COLLECTION = 'repair_jobs';
