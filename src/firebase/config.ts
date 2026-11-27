import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  CACHE_SIZE_UNLIMITED,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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

function cleanEnv(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return '';
  return trimmed;
}

const envApiKey = cleanEnv(import.meta.env.VITE_FIREBASE_API_KEY);
const envProjectId = cleanEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID);
const envAppId = cleanEnv(import.meta.env.VITE_FIREBASE_APP_ID);

const hasEnvConfig = Boolean(
  envApiKey &&
    envProjectId &&
    envAppId &&
    envProjectId !== 'remixed-project-id'
);

const hasAppletConfig = Boolean(
  appletConfig &&
    appletConfig.apiKey &&
    appletConfig.projectId &&
    appletConfig.projectId !== 'remixed-project-id'
);

function buildEnvConfig(): FirebaseResolvedConfig {
  return {
    apiKey: envApiKey,
    authDomain:
      cleanEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) ||
      `${envProjectId}.firebaseapp.com`,
    projectId: envProjectId,
    storageBucket:
      cleanEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) ||
      `${envProjectId}.firebasestorage.app`,
    messagingSenderId: cleanEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: envAppId,
    firestoreDatabaseId:
      cleanEnv(import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) || undefined,
  };
}

function buildAppletConfig(): FirebaseResolvedConfig {
  return {
    apiKey: appletConfig.apiKey,
    authDomain: appletConfig.authDomain,
    projectId: appletConfig.projectId,
    storageBucket: appletConfig.storageBucket,
    messagingSenderId: appletConfig.messagingSenderId,
    appId: appletConfig.appId,
    firestoreDatabaseId: appletConfig.firestoreDatabaseId,
  };
}

export let configSource: 'env' | 'applet-config' | 'none' = hasEnvConfig
  ? 'env'
  : hasAppletConfig
    ? 'applet-config'
    : 'none';

export let resolvedFirebaseConfig: FirebaseResolvedConfig | null =
  configSource === 'env'
    ? buildEnvConfig()
    : configSource === 'applet-config'
      ? buildAppletConfig()
      : null;

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

function createPersistentFirestore(
  firebaseApp: FirebaseApp,
  databaseId?: string
): Firestore {
  try {
    return initializeFirestore(
      firebaseApp,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: CACHE_SIZE_UNLIMITED,
        }),
      },
      databaseId
    );
  } catch {
    return databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);
  }
}

function initFromConfig(cfg: FirebaseResolvedConfig): boolean {
  try {
    const firebaseApp =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            storageBucket: cfg.storageBucket,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId,
          });

    const firestoreDb = createPersistentFirestore(firebaseApp, cfg.firestoreDatabaseId);

    const firebaseAuth = getAuth(firebaseApp);
    let firebaseStorage: FirebaseStorage | null = null;
    try {
      firebaseStorage = getStorage(firebaseApp);
    } catch {
      firebaseStorage = null;
    }

    app = firebaseApp;
    db = firestoreDb;
    auth = firebaseAuth;
    storage = firebaseStorage;
    return true;
  } catch (err) {
    console.warn('Firebase initialization warning:', err);
    return false;
  }
}

if (resolvedFirebaseConfig) {
  const ok = initFromConfig(resolvedFirebaseConfig);
  if (!ok && configSource === 'env' && hasAppletConfig) {
    const fallbackCfg = buildAppletConfig();
    if (initFromConfig(fallbackCfg)) {
      configSource = 'applet-config';
      resolvedFirebaseConfig = fallbackCfg;
    } else {
      configSource = 'none';
      resolvedFirebaseConfig = null;
    }
  } else if (!ok) {
    configSource = 'none';
    resolvedFirebaseConfig = null;
  }
}

export const isFirebaseConfigured = Boolean(app && db && auth);

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

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

