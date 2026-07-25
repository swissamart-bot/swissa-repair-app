/**
 * One-shot verification: anonymous auth + write/read a repair_jobs document.
 * Mirrors what the app does for a new cloud-eligible job.
 *
 * Usage: node scripts/verify-firestore-upload.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const firebaseConfig = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.appId?.includes(':web:')) {
  console.error('FAIL: Web appId missing in .env');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const testId = `cursor_verify_${Date.now()}`;
const now = new Date().toISOString();

const payload = {
  id: testId,
  jobNumber: 'VERIFY',
  customerName: 'Cursor Firestore Verify',
  mobileNumber: '0000000000',
  countryCode: '+91',
  receivedDate: now,
  advanceAmount: 0,
  overallNotes: 'Automated connectivity test — safe to delete',
  googleReviewSent: false,
  cloudSyncEnabled: true,
  items: [],
  createdAt: now,
  updatedAt: now,
  deleted: false,
  deletedAt: '',
};

try {
  await signInAnonymously(auth);
  console.log('AUTH_OK', auth.currentUser?.uid);
  await setDoc(doc(db, 'repair_jobs', testId), payload);
  console.log('WRITE_OK', `repair_jobs/${testId}`);
  const snap = await getDoc(doc(db, 'repair_jobs', testId));
  if (!snap.exists()) throw new Error('Document missing after write');
  console.log('READ_OK', snap.data()?.customerName);
  // Keep the doc so you can see it in Console; uncomment to auto-clean:
  // await deleteDoc(doc(db, 'repair_jobs', testId));
  console.log('SUCCESS — open Firestore → repair_jobs →', testId);
} catch (e) {
  console.error('FAIL', e?.message || e);
  process.exit(1);
}
