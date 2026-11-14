import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-manager-stock.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-manager-stock',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-manager-stock.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(app);
export const firebaseDb = getFirestore(app);
export const firebaseFunctions = getFunctions(app, 'southamerica-east1');

// Conectar a los emuladores solo una vez (HMR en desarrollo).
const emulatorFlag = '__managerStockFirebaseEmulators__';
if (
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
  !(window as unknown as Record<string, boolean>)[emulatorFlag]
) {
  (window as unknown as Record<string, boolean>)[emulatorFlag] = true;
  const host = window.location.hostname || '127.0.0.1';
  connectAuthEmulator(firebaseAuth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firebaseDb, host, 8080);
  connectFunctionsEmulator(firebaseFunctions, host, 5001);
}

/**
 * Asegura una sesión de Firebase en modo desarrollo. En producción la
 * autenticación se resuelve con un flujo real de login (F2F.3b).
 */
export async function ensureFirebaseSignedIn(): Promise<ReturnType<typeof getAuth>['currentUser']> {
  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true') return null;
  try {
    const cred = await signInWithEmailAndPassword(firebaseAuth, 'owner.comidas@managerstock.test', 'ComidasDemo2026!');
    return cred.user;
  } catch (error) {
    console.error('[firebase] auto sign-in failed', error);
    return null;
  }
}
