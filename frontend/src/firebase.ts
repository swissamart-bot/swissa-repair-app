/**
 * Firebase / Firestore bootstrap for project swissa-repair.
 *
 * Firebase JavaScript SDK only (package: `firebase`) — NOT `@react-native-firebase/*`.
 * Config is loaded from EXPO_PUBLIC_FIREBASE_* in `.env` (registered Web app).
 */
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

const env = (key: string): string | undefined => {
  const v = (process.env as Record<string, string | undefined>)[key];
  return v && String(v).trim() ? String(v).trim() : undefined;
};

function requireEnv(key: string, fallback?: string): string {
  const v = env(key) || fallback;
  if (!v) {
    throw new Error(
      `Missing ${key}. Add it to frontend/.env from your Firebase Web app config.`
    );
  }
  return v;
}

/**
 * Loaded from Expo env (frontend/.env) — registered Firebase Web app.
 */
export const firebaseConfig = {
  apiKey: requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: requireEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: requireEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: requireEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: requireEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  ...(env('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID')
    ? { measurementId: env('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID') }
    : {}),
};

/** True when a Web appId (`…:web:…`) is present in env. */
export function hasFirebaseWebAppConfig(): boolean {
  const id = firebaseConfig.appId || '';
  return id.includes(':web:');
}

export function getFirebaseConfigStatus(): {
  ok: boolean;
  source: 'env-web' | 'incomplete';
  projectId: string;
  appIdPreview: string;
  message: string;
} {
  if (hasFirebaseWebAppConfig()) {
    return {
      ok: true,
      source: 'env-web',
      projectId: firebaseConfig.projectId,
      appIdPreview: firebaseConfig.appId.slice(0, 24) + '…',
      message: 'Firebase Web app config loaded from .env',
    };
  }
  return {
    ok: false,
    source: 'incomplete',
    projectId: firebaseConfig.projectId,
    appIdPreview: firebaseConfig.appId || '(empty)',
    message:
      'Set EXPO_PUBLIC_FIREBASE_APP_ID in frontend/.env to your Web appId (must contain ":web:"), then restart Expo.',
  };
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (!hasFirebaseWebAppConfig()) {
    throw new Error(getFirebaseConfigStatus().message);
  }
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
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
