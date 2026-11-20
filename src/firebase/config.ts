import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';

export interface FirebaseResolvedConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
}

const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
const envAppId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;

const hasEnvConfig = Boolean(envApiKey && envProjectId && envAppId);

const hasAppletConfig = Boolean(
  appletConfig &&
    appletConfig.apiKey &&
    appletConfig.projectId &&
    appletConfig.projectId !== 'remixed-project-id'
);

export const configSource: 'env' | 'applet-config' | 'none' = hasEnvConfig
  ? 'env'
  : hasAppletConfig
    ? 'applet-config'
    : 'none';

export const resolvedFirebaseConfig: FirebaseResolvedConfig | null =
  configSource === 'env'
    ? {
        apiKey: envApiKey!,
        authDomain:
          (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
          `${envProjectId}.firebaseapp.com`,
        projectId: envProjectId!,
        storageBucket:
          (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
          `${envProjectId}.firebasestorage.app`,
        messagingSenderId:
          (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '',
        appId: envAppId!,
        firestoreDatabaseId:
          (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID as string) ||
          undefined,
      }
    : configSource === 'applet-config'
      ? {
          apiKey: appletConfig.apiKey,
          authDomain: appletConfig.authDomain,
          projectId: appletConfig.projectId,
          storageBucket: appletConfig.storageBucket,
          messagingSenderId: appletConfig.messagingSenderId,
          appId: appletConfig.appId,
          firestoreDatabaseId: appletConfig.firestoreDatabaseId,
        }
      : null;

export const isFirebaseConfigured = Boolean(resolvedFirebaseConfig);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

if (resolvedFirebaseConfig) {
  app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          apiKey: resolvedFirebaseConfig.apiKey,
          authDomain: resolvedFirebaseConfig.authDomain,
          projectId: resolvedFirebaseConfig.projectId,
          storageBucket: resolvedFirebaseConfig.storageBucket,
          messagingSenderId: resolvedFirebaseConfig.messagingSenderId,
          appId: resolvedFirebaseConfig.appId,
        });

  db = resolvedFirebaseConfig.firestoreDatabaseId
    ? getFirestore(app, resolvedFirebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

  auth = getAuth(app);
  storage = getStorage(app);
}

export { app, db, auth, storage };

export async function testFirestoreConnection(): Promise<{
  ok: boolean;
  message?: string;
}> {
  if (!db) {
    return { ok: false, message: 'Firebase no configurado' };
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return {
        ok: false,
        message: 'Sin conexión con Firestore. Verifica tu configuración de Firebase.',
      };
    }
    return { ok: true };
  }
}
