import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyActionCode,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  configSource,
  db,
  isFirebaseConfigured,
  resolvedFirebaseConfig,
  testFirestoreConnection,
} from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { ADMIN_BOOTSTRAP_EMAIL, buildDemoSeedData } from '../data/demoSeed';
import type {
  AccountRole,
  AddonOption,
  ConnectionMode,
  Movement,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  Sauce,
  StaffMember,
  StaffRole,
  TransferReceipt,
} from '../types/pos';
import {
  calculateOrderTotals,
  createSafeId,
  diffOrderItems,
  formatAutoOrderReference,
  getNextCyclicOrderRefNumber,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../utils/orderMath';
import {
  findLinkedStaffMember,
  isStartupIdentityReady,
  resolveActiveWaiter,
} from '../utils/identityState';
import {
  getRolePermissions,
  isValidStaffRole,
  resolveEffectiveRole,
  type RolePermissions,
} from '../utils/rolePermissions';
import { uploadTransferReceiptImage } from './storageService';

const DEMO_STORAGE_KEY = 'ondeluigi_demo_state_v2';
const ACTIVE_WAITER_STORAGE_KEY = 'ondeluigi_active_waiter_v2';
const DEMO_MODE_FLAG_KEY = 'ondeluigi_demo_active_v2';
const DEMO_ROLE_STORAGE_KEY = 'ondeluigi_demo_role_v2';
const PREVIEW_ROLE_STORAGE_KEY = 'ondeluigi_preview_role_v1';
const CYCLIC_REF_COUNTER_KEY = 'ondeluigi_cyclic_ref_counter_v1';
const SHARED_WORKSPACE_ID = 'ws_onde_luigi';

interface DemoStatePayload {
  staff: StaffMember[];
  sauces: Sauce[];
  products: Product[];
  orders: Order[];
  movements: Movement[];
  transfers: TransferReceipt[];
  authorizedEmails?: string[];
}

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function stripClientTimestamps<T extends { createdAtMs?: number; updatedAtMs?: number }>(
  obj: T
): Omit<T, 'createdAtMs' | 'updatedAtMs'> {
  const { createdAtMs: _createdAtMs, updatedAtMs: _updatedAtMs, ...rest } = obj;
  return rest;
}

export interface CreateOrderInput {
  reference: string;
  items: OrderItem[];
  notes: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  receiptFile?: File | null;
  receiptNotes?: string;
}

export interface SaveProductInput {
  id?: string;
  name: string;
  category: string;
  basePrice: number;
  imageUrl?: string;
  baseRecipe: string[];
  removableOptions: string[];
  addonOptions: AddonOption[];
  allowSauces: boolean;
  minSauces: number;
  maxSauces: number;
  active: boolean;
}

interface PosContextValue {
  sessionMode: ConnectionMode | null;
  authReady: boolean;
  firebaseUser: User | null;
  isFirebaseConfigured: boolean;
  configSource: 'env' | 'applet-config' | 'none';
  projectId: string | null;
  cloudError: string | null;
  loadingData: boolean;
  identityReady: boolean;

  accountRole: AccountRole;
  effectiveRole: StaffRole;
  previewRole: StaffRole;
  setPreviewRole: (role: StaffRole) => void;
  permissions: RolePermissions;
  isAdmin: boolean;
  isPrimaryAdmin: boolean;
  isRealPrimaryAdmin: boolean;
  authorizedEmails: string[];
  allowSelfRegistration: boolean;

  staff: StaffMember[];
  sauces: Sauce[];
  products: Product[];
  orders: Order[];
  movements: Movement[];
  transfers: TransferReceipt[];

  activeWaiterId: string;
  activeWaiter: StaffMember | null;
  myLinkedStaff: StaffMember | null;
  setActiveWaiterId: (id: string) => void;

  emailVerified: boolean;
  verificationNotice: string | null;
  clearVerificationNotice: () => void;

  enterDemoMode: (role?: StaffRole) => void;
  setDemoAccountRole: (role: StaffRole) => void;
  resetDemoData: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  refreshEmailVerification: () => Promise<boolean>;
  signOutSession: () => Promise<void>;

  createOrder: (input: CreateOrderInput) => Promise<Order>;
  updateOrderItems: (
    orderId: string,
    nextItems: OrderItem[],
    nextReference: string,
    nextNotes: string
  ) => Promise<void>;
  updateOrderStatus: (orderId: string, nextStatus: OrderStatus) => Promise<void>;
  voidOrder: (orderId: string, reason?: string) => Promise<void>;
  deleteOrderRecord: (orderId: string) => Promise<void>;
  updateOrderPayment: (params: {
    orderId: string;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    receiptFile?: File | null;
    receiptNotes?: string;
  }) => Promise<{ usedFallbackInline?: boolean }>;
  attachReceiptToOrder: (params: {
    orderId: string;
    file: File;
    amount: number;
    notes?: string;
  }) => Promise<{ usedFallbackInline?: boolean }>;
  voidTransferReceipt: (transferId: string, reason?: string) => Promise<void>;
  deleteTransferReceipt: (transferId: string) => Promise<void>;

  saveProduct: (input: SaveProductInput) => Promise<void>;
  toggleProductActive: (productId: string, active: boolean) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  saveSauce: (name: string, id?: string, active?: boolean) => Promise<void>;
  toggleSauceActive: (sauceId: string, active: boolean) => Promise<void>;
  deleteSauce: (sauceId: string) => Promise<void>;
  saveStaffMember: (name: string, role?: StaffRole) => Promise<void>;
  updateStaffRole: (staffId: string, role: StaffRole) => Promise<void>;
  renameStaffMember: (staffId: string, name: string) => Promise<void>;
  toggleStaffActive: (staffId: string, active: boolean) => Promise<void>;
  deleteStaffMember: (staffId: string) => Promise<void>;
  updateAuthorizedEmails: (emails: string[]) => Promise<void>;
  updateAllowSelfRegistration: (allow: boolean) => Promise<void>;
}

const PosContext = createContext<PosContextValue | null>(null);

function loadDemoState(): DemoStatePayload {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoStatePayload;
      if (
        Array.isArray(parsed.products) &&
        Array.isArray(parsed.orders) &&
        Array.isArray(parsed.staff) &&
        Array.isArray(parsed.sauces)
      ) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupted local storage and re-seed
  }
  const seed = buildDemoSeedData('demo_owner', ADMIN_BOOTSTRAP_EMAIL);
  const payload: DemoStatePayload = {
    ...seed,
    authorizedEmails: [ADMIN_BOOTSTRAP_EMAIL, 'mesero1@ondeluigi.com', 'mesero2@ondeluigi.com'],
  };
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
  return payload;
}

function persistDemoState(state: DemoStatePayload) {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function safeGetStorage(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore iframe/quota errors
  }
}

function safeRemoveStorage(key: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore iframe/quota errors
  }
}

function claimNextAutoReference(): string {
  const raw = safeGetStorage(CYCLIC_REF_COUNTER_KEY);
  const last = raw ? Number(raw) : 0;
  const next = getNextCyclicOrderRefNumber(last);
  safeSetStorage(CYCLIC_REF_COUNTER_KEY, String(next));
  return formatAutoOrderReference(next);
}

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionMode, setSessionMode] = useState<ConnectionMode | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        return 'demo';
      }
      if (safeGetStorage(DEMO_MODE_FLAG_KEY) === '1') {
        return 'demo';
      }
    }
    return null;
  });
  const sessionModeRef = useRef<ConnectionMode | null>(sessionMode);
  sessionModeRef.current = sessionMode;

  const [demoAccountRole, setDemoAccountRoleState] = useState<StaffRole>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qRole = params.get('role');
      if (isValidStaffRole(qRole)) return qRole;
      const saved = safeGetStorage(DEMO_ROLE_STORAGE_KEY);
      if (isValidStaffRole(saved)) return saved;
    }
    return 'admin';
  });

  const [previewRoleState, setPreviewRoleState] = useState<StaffRole>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = window.sessionStorage.getItem(PREVIEW_ROLE_STORAGE_KEY);
        if (isValidStaffRole(saved)) return saved;
      }
    } catch {
      // ignore sessionStorage errors
    }
    return 'admin';
  });

  const isSecondaryAdminDemo = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('secondaryAdmin') === '1';
  }, []);

  const isUnverifiedDemo = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('unverified') === '1';
  }, []);

  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [emailVerifiedState, setEmailVerifiedState] = useState<boolean>(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState<boolean>(() => sessionMode !== null);
  const [staffLoaded, setStaffLoaded] = useState<boolean>(false);
  const [cloudReadyForUid, setCloudReadyForUid] = useState<string | null>(null);

  const [workspaceOwnerUid, setWorkspaceOwnerUid] = useState<string>('demo_owner');
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([ADMIN_BOOTSTRAP_EMAIL]);
  const [allowSelfRegistration, setAllowSelfRegistration] = useState<boolean>(true);
  const [cloudMemberRole, setCloudMemberRole] = useState<AccountRole>('mesero');

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sauces, setSauces] = useState<Sauce[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [transfers, setTransfers] = useState<TransferReceipt[]>([]);

  const [activeWaiterId, setActiveWaiterIdState] = useState<string>(() => {
    return safeGetStorage(ACTIVE_WAITER_STORAGE_KEY) || '';
  });

  const setActiveWaiterId = useCallback((id: string) => {
    setActiveWaiterIdState(id);
    safeSetStorage(ACTIVE_WAITER_STORAGE_KEY, id);
  }, []);

  const setDemoAccountRole = useCallback((role: StaffRole) => {
    setDemoAccountRoleState(role);
    try {
      localStorage.setItem(DEMO_ROLE_STORAGE_KEY, role);
    } catch {
      // ignore
    }
  }, []);

  const actorUid = firebaseUser
    ? firebaseUser.uid
    : demoAccountRole === 'mesero'
      ? 'demo_waiter'
      : demoAccountRole === 'cajero'
        ? 'demo_cajero'
        : demoAccountRole === 'cocina'
          ? 'demo_cocina'
          : isSecondaryAdminDemo
            ? 'demo_secondary_admin'
            : 'demo_owner';
  const actorEmail = firebaseUser
    ? (firebaseUser.email || '').toLowerCase()
    : demoAccountRole === 'mesero'
      ? 'mesero1@ondeluigi.com'
      : demoAccountRole === 'cajero'
        ? 'caja@ondeluigi.com'
        : demoAccountRole === 'cocina'
          ? 'cocina@ondeluigi.com'
          : isSecondaryAdminDemo
            ? 'admin2@ondeluigi.com'
            : ADMIN_BOOTSTRAP_EMAIL;

  const myLinkedStaff = useMemo(
    () => findLinkedStaffMember(staff, actorUid, actorEmail),
    [staff, actorUid, actorEmail]
  );

  // Real primary admin identity (preserved even when previewing another role)
  const isRealPrimaryAdmin = useMemo(() => {
    if (sessionMode === 'demo') {
      return demoAccountRole === 'admin' && !isSecondaryAdminDemo;
    }
    if (!firebaseUser) return false;
    const userEmail = (firebaseUser.email || '').toLowerCase();
    return userEmail === ADMIN_BOOTSTRAP_EMAIL || firebaseUser.uid === workspaceOwnerUid;
  }, [sessionMode, demoAccountRole, isSecondaryAdminDemo, firebaseUser, workspaceOwnerUid]);

  const setPreviewRole = useCallback(
    (role: StaffRole) => {
      if (!isRealPrimaryAdmin || !isValidStaffRole(role)) return;
      setPreviewRoleState(role);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(PREVIEW_ROLE_STORAGE_KEY, role);
        }
      } catch {
        // ignore sessionStorage errors
      }
    },
    [isRealPrimaryAdmin]
  );

  const previewRole: StaffRole = isRealPrimaryAdmin ? previewRoleState : 'admin';

  const effectiveRole: StaffRole = useMemo(
    () =>
      resolveEffectiveRole({
        sessionMode,
        isRealPrimaryAdmin,
        previewRole,
        demoAccountRole,
        cloudMemberRole,
        myLinkedStaff,
      }),
    [sessionMode, isRealPrimaryAdmin, previewRole, demoAccountRole, cloudMemberRole, myLinkedStaff]
  );

  const permissions = useMemo(() => getRolePermissions(effectiveRole), [effectiveRole]);
  const accountRole: AccountRole = effectiveRole === 'admin' ? 'admin' : 'mesero';
  const isAdmin = effectiveRole === 'admin';
  const isPrimaryAdmin = isRealPrimaryAdmin && effectiveRole === 'admin';

  // Every user (including Principal Admin) always stays on their own permanent profile — no switching into other accounts
  const activeWaiter = useMemo(
    () =>
      resolveActiveWaiter({
        isPrimaryAdmin: isRealPrimaryAdmin,
        myLinkedStaff,
        staff,
        activeWaiterId,
      }),
    [isRealPrimaryAdmin, myLinkedStaff, staff, activeWaiterId]
  );

  const identityReady = useMemo(
    () =>
      isStartupIdentityReady({
        authReady,
        sessionMode,
        cloudError,
        firebaseUid: firebaseUser?.uid || null,
        cloudReadyForUid,
        staffLoaded,
        loadingData,
      }),
    [authReady, sessionMode, cloudError, firebaseUser, cloudReadyForUid, staffLoaded, loadingData]
  );

  // Auto-bind activeWaiterId strictly to the user's own permanent profile
  useEffect(() => {
    if (staff.length === 0) return;

    if (myLinkedStaff && myLinkedStaff.active && activeWaiterId !== myLinkedStaff.id) {
      setActiveWaiterId(myLinkedStaff.id);
      return;
    }

    if (isRealPrimaryAdmin && !myLinkedStaff && activeWaiter && activeWaiterId !== activeWaiter.id) {
      setActiveWaiterId(activeWaiter.id);
    }
  }, [isRealPrimaryAdmin, myLinkedStaff, activeWaiter, activeWaiterId, staff.length, setActiveWaiterId]);

  const activateCloudSession = useCallback((user: User) => {
    setFirebaseUser(user);
    setEmailVerifiedState(Boolean(user.emailVerified));
    setCloudError(null);
    setCloudReadyForUid(null);
    setStaffLoaded(false);
    setLoadingData(true);
    setSessionMode('cloud');
    safeRemoveStorage(DEMO_MODE_FLAG_KEY);
  }, []);

  const clearVerificationNotice = useCallback(() => {
    setVerificationNotice(null);
  }, []);

  // Monitor Firebase Auth + test connection + process email verification action links
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthReady(true);
      return;
    }

    const cleanUrlParams = (keys: string[]) => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        let changed = false;
        for (const k of keys) {
          if (url.searchParams.has(k)) {
            url.searchParams.delete(k);
            changed = true;
          }
        }
        if (changed) {
          window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
      } catch {
        // ignore URL cleanup errors
      }
    };

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      const oobCode = params.get('oobCode');
      if (mode === 'verifyEmail' && oobCode) {
        applyActionCode(auth, oobCode)
          .then(async () => {
            if (auth?.currentUser) {
              await auth.currentUser.reload().catch(() => undefined);
              await auth.currentUser.getIdToken(true).catch(() => undefined);
              setFirebaseUser(auth.currentUser);
              setEmailVerifiedState(Boolean(auth.currentUser.emailVerified));
            } else {
              setEmailVerifiedState(true);
            }
            setVerificationNotice("¡Tu correo electrónico fue verificado exitosamente para O'NDE LUIGI!");
          })
          .catch(() => {
            // Code might already have been consumed; reload user state safely
          })
          .finally(() => {
            cleanUrlParams(['mode', 'oobCode', 'apiKey', 'lang']);
          });
      }
    }

    const safetyTimer = window.setTimeout(() => {
      setAuthReady(true);
    }, 4000);

    testFirestoreConnection().then((res) => {
      if (!res.ok && res.message) {
        setCloudError(res.message);
      }
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      window.clearTimeout(safetyTimer);
      let activeUser = user;
      if (activeUser && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('verified') === '1') {
          await activeUser.reload().catch(() => undefined);
          await activeUser.getIdToken(true).catch(() => undefined);
          activeUser = auth?.currentUser || activeUser;
          if (activeUser.emailVerified) {
            setVerificationNotice("¡Tu correo electrónico fue verificado exitosamente para O'NDE LUIGI!");
          }
          cleanUrlParams(['verified']);
        }
      }

      setFirebaseUser(activeUser);
      setEmailVerifiedState(Boolean(activeUser?.emailVerified));
      setAuthReady(true);
      if (activeUser && activeUser.email) {
        activateCloudSession(activeUser);
      } else if (!activeUser && sessionModeRef.current === 'cloud') {
        setCloudReadyForUid(null);
        setStaffLoaded(false);
        setLoadingData(false);
        setSessionMode(null);
      }
    });

    return () => {
      window.clearTimeout(safetyTimer);
      unsub();
    };
  }, [activateCloudSession]);

  // Load Demo Data when sessionMode === 'demo'
  useEffect(() => {
    if (sessionMode !== 'demo') return;
    const loaded = loadDemoState();
    const demoStaff = [...loaded.staff];
    if (
      isSecondaryAdminDemo &&
      !demoStaff.some((s) => s.linkedUid === 'demo_secondary_admin')
    ) {
      const now = Date.now();
      demoStaff.push({
        id: 'staff_demo_secondary_admin',
        name: 'Carla Admin Secundaria',
        role: 'admin',
        active: true,
        linkedUid: 'demo_secondary_admin',
        linkedEmail: 'admin2@ondeluigi.com',
        ownerUid: 'demo_owner',
        createdByUid: 'demo_owner',
        allowedEmails: [ADMIN_BOOTSTRAP_EMAIL, 'admin2@ondeluigi.com'],
        createdAtMs: now,
        updatedAtMs: now,
      });
    }
    if (
      demoAccountRole === 'cajero' &&
      !demoStaff.some((s) => s.linkedUid === 'demo_cajero')
    ) {
      const now = Date.now();
      demoStaff.push({
        id: 'staff_demo_cajero',
        name: 'Laura Caja',
        role: 'cajero',
        active: true,
        linkedUid: 'demo_cajero',
        linkedEmail: 'caja@ondeluigi.com',
        ownerUid: 'demo_owner',
        createdByUid: 'demo_owner',
        allowedEmails: [ADMIN_BOOTSTRAP_EMAIL, 'caja@ondeluigi.com'],
        createdAtMs: now,
        updatedAtMs: now,
      });
    }
    if (
      demoAccountRole === 'cocina' &&
      !demoStaff.some((s) => s.linkedUid === 'demo_cocina')
    ) {
      const now = Date.now();
      demoStaff.push({
        id: 'staff_demo_cocina',
        name: 'Carlos Plancha',
        role: 'cocina',
        active: true,
        linkedUid: 'demo_cocina',
        linkedEmail: 'cocina@ondeluigi.com',
        ownerUid: 'demo_owner',
        createdByUid: 'demo_owner',
        allowedEmails: [ADMIN_BOOTSTRAP_EMAIL, 'cocina@ondeluigi.com'],
        createdAtMs: now,
        updatedAtMs: now,
      });
    }
    setWorkspaceOwnerUid('demo_owner');
    setAuthorizedEmails(
      loaded.authorizedEmails && loaded.authorizedEmails.length > 0
        ? loaded.authorizedEmails
        : [ADMIN_BOOTSTRAP_EMAIL]
    );
    setStaff(demoStaff);
    setSauces(loaded.sauces);
    setProducts(loaded.products);
    setOrders(loaded.orders.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setMovements(loaded.movements.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setTransfers(loaded.transfers.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setStaffLoaded(true);
    setLoadingData(false);
  }, [sessionMode, isSecondaryAdminDemo, demoAccountRole]);

  const workspaceId = sessionMode === 'cloud' ? SHARED_WORKSPACE_ID : 'demo_ws';
  const effectiveOwnerUid = sessionMode === 'cloud' ? workspaceOwnerUid : 'demo_owner';

  // Ensure Shared Cloud Workspace exists & enroll verified waiters via workspaceDirectory + members
  const resolveOrBootstrapCloudWorkspace = useCallback(async (user: User) => {
    if (!db) return null;
    const wsRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID);
    const dirRef = doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID);
    const memberRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', user.uid);
    const userEmail = (user.email || '').toLowerCase();
    const isAdminEmail = userEmail === ADMIN_BOOTSTRAP_EMAIL;

    // 1. Admin bootstrap or backfill (when workspace already exists without directory/member doc)
    if (isAdminEmail) {
      try {
        const snap = await getDoc(wsRef);
        if (!snap.exists()) {
          const batch = writeBatch(db);
          const initialEmails = [userEmail];
          batch.set(wsRef, {
            id: SHARED_WORKSPACE_ID,
            name: "O'NDE LUIGI",
            ownerUid: user.uid,
            ownerEmail: userEmail,
            authorizedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          batch.set(dirRef, {
            id: SHARED_WORKSPACE_ID,
            name: "O'NDE LUIGI",
            ownerUid: user.uid,
            allowSelfRegistration: true,
            updatedAt: serverTimestamp(),
          });

          batch.set(memberRef, {
            uid: user.uid,
            displayName: (user.displayName || userEmail || 'Administrador').trim().slice(0, 100),
            role: 'admin',
            active: true,
            ownerUid: user.uid,
            createdAt: serverTimestamp(),
          });

          // Seed only the Administrator's own staff profile (no predetermined fake waiters)
          const adminStaffId = `staff_${user.uid}`;
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', adminStaffId), {
            id: adminStaffId,
            name: (user.displayName || 'Administrador').trim().slice(0, 80),
            role: 'admin',
            active: true,
            linkedUid: user.uid,
            linkedEmail: user.email || userEmail,
            ownerUid: user.uid,
            createdByUid: user.uid,
            allowedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const seed = buildDemoSeedData(user.uid, userEmail);
          for (const sauce of seed.sauces) {
            batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'sauces', sauce.id), {
              id: sauce.id,
              name: sauce.name,
              active: sauce.active,
              ownerUid: user.uid,
              createdByUid: user.uid,
              allowedEmails: initialEmails,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          for (const prod of seed.products) {
            batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'products', prod.id), {
              id: prod.id,
              name: prod.name,
              category: prod.category,
              basePrice: prod.basePrice,
              imageUrl: prod.imageUrl,
              baseRecipe: prod.baseRecipe,
              removableOptions: prod.removableOptions,
              addonOptions: prod.addonOptions,
              allowSauces: prod.allowSauces,
              minSauces: prod.minSauces,
              maxSauces: prod.maxSauces,
              active: prod.active,
              ownerUid: user.uid,
              createdByUid: user.uid,
              allowedEmails: initialEmails,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          await batch.commit();
          return {
            ownerUid: user.uid,
            authorizedEmails: initialEmails,
            allowSelfRegistration: true,
            memberRole: 'admin' as AccountRole,
          };
        }

        const data = snap.data() as {
          name?: string;
          ownerUid: string;
          authorizedEmails?: string[];
        };
        const emails = Array.isArray(data.authorizedEmails)
          ? data.authorizedEmails.map((e) => e.toLowerCase())
          : [ADMIN_BOOTSTRAP_EMAIL];

        const [dirSnap, memberSnap] = await Promise.all([getDoc(dirRef), getDoc(memberRef)]);
        let currentAllowSelf = true;
        if (!dirSnap.exists()) {
          await setDoc(dirRef, {
            id: SHARED_WORKSPACE_ID,
            name: (data.name || "O'NDE LUIGI").slice(0, 120),
            ownerUid: data.ownerUid,
            allowSelfRegistration: true,
            updatedAt: serverTimestamp(),
          });
        } else {
          currentAllowSelf = Boolean((dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration);
        }

        if (!memberSnap.exists()) {
          await setDoc(memberRef, {
            uid: user.uid,
            displayName: (user.displayName || userEmail || 'Administrador').trim().slice(0, 100),
            role: 'admin',
            active: true,
            ownerUid: data.ownerUid,
            createdAt: serverTimestamp(),
          });
        }

        return {
          ownerUid: data.ownerUid,
          authorizedEmails: emails,
          allowSelfRegistration: currentAllowSelf,
          memberRole: 'admin' as AccountRole,
        };
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
        return null;
      }
    }

    // 2. Non-admin user flow: check own member doc and public workspaceDirectory FIRST (never hit workspaces/ws_onde_luigi unauthenticated)
    const [memberSnap, dirSnap] = await Promise.all([
      getDoc(memberRef).catch((err) => {
        handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}/members/${user.uid}`);
        throw err;
      }),
      getDoc(dirRef).catch((err) => {
        handleFirestoreError(err, OperationType.GET, `workspaceDirectory/${SHARED_WORKSPACE_ID}`);
        throw err;
      }),
    ]);

    let dirAllowSelf = dirSnap.exists()
      ? Boolean((dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration)
      : false;
    let resolvedRole: AccountRole = 'mesero';

    if (memberSnap.exists()) {
      const mData = memberSnap.data() as { active?: boolean; role?: string };
      if (mData.active === false) {
        throw new Error(
          'Tu acceso fue desactivado por el administrador. Pídele que vuelva a activarte en Ajustes.'
        );
      }
      resolvedRole = mData.role === 'admin' ? 'admin' : 'mesero';
    } else if (dirSnap.exists() && dirAllowSelf) {
      const dirData = dirSnap.data() as { ownerUid: string };
      try {
        await setDoc(memberRef, {
          uid: user.uid,
          displayName: (user.displayName || userEmail || 'Mesero').trim().slice(0, 100),
          role: 'mesero',
          active: true,
          ownerUid: dirData.ownerUid,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `workspaces/${SHARED_WORKSPACE_ID}/members/${user.uid}`);
      }
    } else {
      // Directory missing or self-registration disabled: check if admin pre-authorized this email on workspace
      let preAuthorizedSnap;
      try {
        preAuthorizedSnap = await getDoc(wsRef);
      } catch {
        if (!dirSnap.exists()) {
          throw new Error(
            `El administrador (${ADMIN_BOOTSTRAP_EMAIL}) debe abrir la aplicación una vez para activar el acceso de meseros.`
          );
        }
        throw new Error(
          `El registro abierto está desactivado. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que active el acceso con enlace o agregue tu correo (${userEmail}) en Ajustes.`
        );
      }

      if (!preAuthorizedSnap.exists()) {
        throw new Error(
          `El espacio O'NDE LUIGI aún no ha sido inicializado por el administrador (${ADMIN_BOOTSTRAP_EMAIL}).`
        );
      }

      const preData = preAuthorizedSnap.data() as { ownerUid: string; authorizedEmails?: string[] };
      const preEmails = Array.isArray(preData.authorizedEmails)
        ? preData.authorizedEmails.map((e) => e.toLowerCase())
        : [ADMIN_BOOTSTRAP_EMAIL];

      if (preData.ownerUid !== user.uid && !preEmails.includes(userEmail)) {
        throw new Error(
          `La cuenta ${userEmail} no está autorizada. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que agregue tu correo en Ajustes.`
        );
      }

      await setDoc(memberRef, {
        uid: user.uid,
        displayName: (user.displayName || userEmail || 'Mesero').trim().slice(0, 100),
        role: preData.ownerUid === user.uid ? 'admin' : 'mesero',
        active: true,
        ownerUid: preData.ownerUid,
        createdAt: serverTimestamp(),
      });
      resolvedRole = preData.ownerUid === user.uid ? 'admin' : 'mesero';
    }

    try {
      const wsSnap = await getDoc(wsRef);
      if (!wsSnap.exists()) {
        throw new Error(
          `El espacio O'NDE LUIGI aún no ha sido inicializado por el administrador (${ADMIN_BOOTSTRAP_EMAIL}).`
        );
      }
      const wsData = wsSnap.data() as { ownerUid: string; authorizedEmails?: string[] };
      const emails = Array.isArray(wsData.authorizedEmails)
        ? wsData.authorizedEmails.map((e) => e.toLowerCase())
        : [ADMIN_BOOTSTRAP_EMAIL];
      return {
        ownerUid: wsData.ownerUid,
        authorizedEmails: emails,
        allowSelfRegistration: dirAllowSelf,
        memberRole: wsData.ownerUid === user.uid ? ('admin' as AccountRole) : resolvedRole,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('no ha sido inicializado')) {
        throw error;
      }
      handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
      return null;
    }
  }, []);

  // Cloud Firestore real-time listeners
  useEffect(() => {
    if (sessionMode !== 'cloud' || !db || !firebaseUser) return;

    let cancelled = false;
    setLoadingData(true);
    setStaffLoaded(false);
    setCloudReadyForUid(null);
    setCloudError(null);

    const userEmail = (firebaseUser.email || '').toLowerCase();
    const isBootstrapAdmin = userEmail === ADMIN_BOOTSTRAP_EMAIL;
    const unsubs: Array<() => void> = [];
    const loadedCollections = new Set<string>();
    const REQUIRED_COLLECTIONS = ['staff', 'sauces', 'products', 'orders'];

    resolveOrBootstrapCloudWorkspace(firebaseUser)
      .then((wsInfo) => {
        if (cancelled || !db || !wsInfo) return;

        setWorkspaceOwnerUid(wsInfo.ownerUid);
        setAuthorizedEmails(wsInfo.authorizedEmails);
        setAllowSelfRegistration(wsInfo.allowSelfRegistration);
        setCloudMemberRole(wsInfo.memberRole);
        setCloudReadyForUid(firebaseUser.uid);

        // Listen to workspace doc for authorizedEmails updates
        const wsUnsub = onSnapshot(
          doc(db, 'workspaces', SHARED_WORKSPACE_ID),
          (snap) => {
            if (snap.exists()) {
              const d = snap.data() as { ownerUid: string; authorizedEmails?: string[] };
              setWorkspaceOwnerUid(d.ownerUid);
              if (Array.isArray(d.authorizedEmails)) {
                setAuthorizedEmails(d.authorizedEmails.map((e) => e.toLowerCase()));
              }
            }
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
          }
        );
        unsubs.push(wsUnsub);

        // Listen to directory doc for allowSelfRegistration updates
        const dirUnsub = onSnapshot(
          doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID),
          (snap) => {
            if (snap.exists()) {
              const d = snap.data() as { allowSelfRegistration?: boolean };
              setAllowSelfRegistration(Boolean(d.allowSelfRegistration));
            }
          },
          () => {
            // ignore non-fatal directory listener errors
          }
        );
        unsubs.push(dirUnsub);

        // Listen to own member doc for live role changes or admin deactivation/removal
        const memberUnsub = onSnapshot(
          doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', firebaseUser.uid),
          (snap) => {
            if (!snap.exists()) {
              if (!isBootstrapAdmin && firebaseUser.uid !== wsInfo.ownerUid) {
                setCloudError('Tu usuario fue eliminado del equipo por el administrador.');
                setLoadingData(false);
              }
              return;
            }
            const d = snap.data() as { active?: boolean; role?: string };
            if (d.active === false && !isBootstrapAdmin && firebaseUser.uid !== wsInfo.ownerUid) {
              setCloudError('Tu acceso fue desactivado por el administrador.');
              setLoadingData(false);
              return;
            }
            setCloudMemberRole(d.role === 'admin' ? 'admin' : 'mesero');
          },
          () => {
            // handled by primary workspace listeners
          }
        );
        unsubs.push(memberUnsub);

        const subCollection = <T extends { createdAtMs?: number }>(
          subName: string,
          mapper: (data: Record<string, unknown>) => T,
          setter: React.Dispatch<React.SetStateAction<T[]>>,
          sortDesc = true
        ) => {
          const path = `workspaces/${SHARED_WORKSPACE_ID}/${subName}`;
          const q = query(collection(db!, path), where('ownerUid', '==', wsInfo.ownerUid));

          const unsub = onSnapshot(
            q,
            (snapshot) => {
              if (cancelled) return;
              const items = snapshot.docs.map((d) => mapper(d.data()));
              if (sortDesc) {
                items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
              }
              setter(items);
              if (subName === 'staff') {
                setStaffLoaded(true);
              }
              loadedCollections.add(subName);
              if (REQUIRED_COLLECTIONS.every((c) => loadedCollections.has(c))) {
                setLoadingData(false);
              }
            },
            (err) => {
              setCloudError(err instanceof Error ? err.message : `Error al cargar ${subName}`);
              setStaffLoaded(true);
              setLoadingData(false);
              handleFirestoreError(err, OperationType.LIST, path);
            }
          );
          unsubs.push(unsub);
        };

        subCollection<StaffMember>(
          'staff',
          (d) => ({
            id: String(d.id),
            name: String(d.name),
            role: d.role as StaffRole,
            active: Boolean(d.active),
            linkedUid: String(d.linkedUid || ''),
            linkedEmail: String(d.linkedEmail || ''),
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
            updatedAtMs: toMillis(d.updatedAt),
          }),
          setStaff,
          false
        );

        subCollection<Sauce>(
          'sauces',
          (d) => ({
            id: String(d.id),
            name: String(d.name),
            active: Boolean(d.active),
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
            updatedAtMs: toMillis(d.updatedAt),
          }),
          setSauces,
          false
        );

        subCollection<Product>(
          'products',
          (d) => ({
            id: String(d.id),
            name: String(d.name),
            category: String(d.category),
            basePrice: Number(d.basePrice) || 0,
            imageUrl: String(d.imageUrl || ''),
            baseRecipe: Array.isArray(d.baseRecipe) ? (d.baseRecipe as string[]) : [],
            removableOptions: Array.isArray(d.removableOptions)
              ? (d.removableOptions as string[])
              : [],
            addonOptions: Array.isArray(d.addonOptions)
              ? (d.addonOptions as AddonOption[]).map((ex) => ({
                  ...ex,
                  allowMultiple: ex.allowMultiple !== false,
                }))
              : [],
            allowSauces: d.allowSauces !== undefined ? Boolean(d.allowSauces) : true,
            minSauces: d.minSauces !== undefined ? Number(d.minSauces) : 1,
            maxSauces: d.maxSauces !== undefined ? Number(d.maxSauces) : 4,
            active: Boolean(d.active),
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
            updatedAtMs: toMillis(d.updatedAt),
          }),
          setProducts,
          false
        );

        subCollection<Order>(
          'orders',
          (d) => ({
            id: String(d.id),
            orderNumber: Number(d.orderNumber) || 1,
            reference: String(d.reference),
            waiterId: String(d.waiterId),
            waiterName: String(d.waiterName),
            status: d.status as OrderStatus,
            paymentStatus: d.paymentStatus as PaymentStatus,
            paymentMethod: (d.paymentMethod || '') as PaymentMethod,
            items: Array.isArray(d.items)
              ? (d.items as OrderItem[]).map((it) => ({
                  ...it,
                  selectedSauces: Array.isArray(it.selectedSauces) ? it.selectedSauces : [],
                }))
              : [],
            subtotal: Number(d.subtotal) || 0,
            total: Number(d.total) || 0,
            notes: String(d.notes || ''),
            receiptCount: Number(d.receiptCount) || 0,
            latestReceiptUrl: String(d.latestReceiptUrl || ''),
            voidReason: d.voidReason ? String(d.voidReason) : undefined,
            voidedByName: d.voidedByName ? String(d.voidedByName) : undefined,
            voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
            updatedAtMs: toMillis(d.updatedAt),
          }),
          setOrders,
          true
        );

        subCollection<Movement>(
          'movements',
          (d) => ({
            id: String(d.id),
            orderId: String(d.orderId),
            orderNumber: Number(d.orderNumber) || 1,
            orderReference: String(d.orderReference),
            type: d.type as Movement['type'],
            description: String(d.description),
            waiterId: String(d.waiterId),
            waiterName: String(d.waiterName),
            actorUid: String(d.actorUid),
            details: (d.details || {}) as Record<string, string | number | boolean>,
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
          }),
          setMovements,
          true
        );

        subCollection<TransferReceipt>(
          'transfers',
          (d) => ({
            id: String(d.id),
            orderId: String(d.orderId),
            orderNumber: Number(d.orderNumber) || 1,
            orderReference: String(d.orderReference),
            amount: Number(d.amount) || 0,
            imageUrl: String(d.imageUrl),
            storagePath: String(d.storagePath || ''),
            waiterId: String(d.waiterId),
            waiterName: String(d.waiterName),
            paymentStatus: d.paymentStatus as PaymentStatus,
            notes: String(d.notes || ''),
            annulled: Boolean(d.annulled),
            annulledByName: d.annulledByName ? String(d.annulledByName) : undefined,
            annulledReason: d.annulledReason ? String(d.annulledReason) : undefined,
            annulledAtMs: d.annulledAtMs ? Number(d.annulledAtMs) : undefined,
            ownerUid: String(d.ownerUid),
            createdByUid: String(d.createdByUid),
            allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
            createdAtMs: toMillis(d.createdAt),
          }),
          setTransfers,
          true
        );
      })
      .catch((err) => {
        setCloudError(err instanceof Error ? err.message : 'Error al conectar con Firestore');
        setStaffLoaded(true);
        setLoadingData(false);
      });

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [sessionMode, firebaseUser, resolveOrBootstrapCloudWorkspace]);

  const enterDemoMode = useCallback(
    (role: StaffRole = 'admin') => {
      safeSetStorage(DEMO_MODE_FLAG_KEY, '1');
      setDemoAccountRole(role);
      setSessionMode('demo');
    },
    [setDemoAccountRole]
  );

  const resetDemoData = useCallback(() => {
    const fresh = buildDemoSeedData('demo_owner', ADMIN_BOOTSTRAP_EMAIL);
    const payload: DemoStatePayload = {
      ...fresh,
      authorizedEmails: [ADMIN_BOOTSTRAP_EMAIL, 'mesero1@ondeluigi.com', 'mesero2@ondeluigi.com'],
    };
    persistDemoState(payload);
    setStaff(payload.staff);
    setSauces(payload.sauces);
    setProducts(payload.products);
    setOrders(payload.orders.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setMovements(payload.movements.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setTransfers(payload.transfers.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setAuthorizedEmails(payload.authorizedEmails || [ADMIN_BOOTSTRAP_EMAIL]);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!auth) throw new Error('El inicio de sesión no está disponible.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    if (cred.user) {
      activateCloudSession(cred.user);
    }
  }, [activateCloudSession]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('El inicio de sesión no está disponible.');
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user) {
      activateCloudSession(cred.user);
    }
  }, [activateCloudSession]);

  const registerWithEmail = useCallback(async (name: string, email: string, password: string) => {
    if (!auth) throw new Error('El registro no está disponible.');
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new Error('Ingresa tu nombre completo.');
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user) {
      await updateProfile(cred.user, { displayName: cleanName }).catch(() => undefined);
      await cred.user.reload().catch(() => undefined);
      activateCloudSession(auth.currentUser || cred.user);
    }
  }, [activateCloudSession]);

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('La recuperación de contraseña no está disponible.');
    const cleanEmail = email.trim();
    if (!cleanEmail) throw new Error('Ingresa tu correo electrónico.');
    await sendPasswordResetEmail(auth, cleanEmail);
  }, []);

  const sendVerificationEmail = useCallback(async () => {
    if (sessionMode === 'demo') {
      return;
    }
    if (!auth || !auth.currentUser) {
      throw new Error('Debes iniciar sesión para verificar tu correo.');
    }
    const cleanUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}?verified=1`
        : undefined;
    await sendEmailVerification(
      auth.currentUser,
      cleanUrl
        ? {
            url: cleanUrl,
            handleCodeInApp: false,
          }
        : undefined
    );
  }, [sessionMode]);

  const refreshEmailVerification = useCallback(async (): Promise<boolean> => {
    if (sessionMode === 'demo') {
      const next = !isUnverifiedDemo;
      setEmailVerifiedState(next);
      return next;
    }
    if (!auth || !auth.currentUser) return false;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true).catch(() => undefined);
    const verified = Boolean(auth.currentUser.emailVerified);
    setFirebaseUser(auth.currentUser);
    setEmailVerifiedState(verified);
    if (verified) {
      setVerificationNotice("¡Tu correo electrónico fue verificado exitosamente para O'NDE LUIGI!");
    }
    return verified;
  }, [sessionMode, isUnverifiedDemo]);

  const signOutSession = useCallback(async () => {
    safeRemoveStorage(DEMO_MODE_FLAG_KEY);
    safeRemoveStorage(ACTIVE_WAITER_STORAGE_KEY);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(PREVIEW_ROLE_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    setPreviewRoleState('admin');
    if (auth && firebaseUser) {
      await signOut(auth);
    }
    setActiveWaiterIdState('');
    setSessionMode(null);
    setCloudError(null);
    setCloudReadyForUid(null);
    setStaffLoaded(false);
    setLoadingData(false);
    setEmailVerifiedState(false);
    setVerificationNotice(null);
    setCloudMemberRole('mesero');
    setStaff([]);
    setSauces([]);
    setProducts([]);
    setOrders([]);
    setMovements([]);
    setTransfers([]);
  }, [firebaseUser]);

  const requireWaiter = useCallback((): StaffMember => {
    if (!activeWaiter) {
      throw new Error('Debes elegir tu nombre antes de registrar o editar pedidos.');
    }
    return activeWaiter;
  }, [activeWaiter]);

  const requireAdmin = useCallback(() => {
    if (!isAdmin) {
      throw new Error('Acceso restringido: solo la cuenta Administradora puede realizar esta acción.');
    }
  }, [isAdmin]);

  const requirePrimaryAdmin = useCallback(() => {
    if (!isPrimaryAdmin) {
      throw new Error('Solo el administrador principal puede cambiar roles o administrar el equipo.');
    }
  }, [isPrimaryAdmin]);

  const syncDemoMutation = useCallback(
    (updater: (prev: DemoStatePayload) => DemoStatePayload) => {
      const current = loadDemoState();
      const next = updater(current);
      persistDemoState(next);
      setStaff([...next.staff]);
      setSauces([...next.sauces]);
      setProducts([...next.products]);
      setOrders([...next.orders].sort((a, b) => b.createdAtMs - a.createdAtMs));
      setMovements([...next.movements].sort((a, b) => b.createdAtMs - a.createdAtMs));
      setTransfers([...next.transfers].sort((a, b) => b.createdAtMs - a.createdAtMs));
      if (next.authorizedEmails) {
        setAuthorizedEmails([...next.authorizedEmails]);
      }
    },
    []
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput): Promise<Order> => {
      if (!permissions.canTakeOrders) {
        throw new Error('Tu rol actual no tiene permiso para tomar pedidos.');
      }
      const waiter = requireWaiter();
      if (input.items.length === 0) {
        throw new Error('Agrega al menos un producto al pedido.');
      }

      const now = Date.now();
      const orderId = createSafeId('ord');
      const maxNum = orders.reduce((m, o) => Math.max(m, o.orderNumber), 100);
      const orderNumber = maxNum + 1;
      const resolvedReference =
        input.reference.trim().slice(0, 100) || claimNextAutoReference();
      const { subtotal, total } = calculateOrderTotals(input.items);

      let receiptUrl = '';
      let receiptCount = 0;
      let uploadedTransfer: TransferReceipt | null = null;

      if (input.receiptFile) {
        const transferId = createSafeId('tr');
        const uploadRes = await uploadTransferReceiptImage({
          mode: sessionMode || 'demo',
          workspaceId,
          transferId,
          file: input.receiptFile,
        });
        receiptUrl = uploadRes.imageUrl;
        receiptCount = 1;
        uploadedTransfer = {
          id: transferId,
          orderId,
          orderNumber,
          orderReference: resolvedReference,
          amount: total,
          imageUrl: uploadRes.imageUrl,
          storagePath: uploadRes.storagePath,
          waiterId: waiter.id,
          waiterName: waiter.name,
          paymentStatus: input.paymentStatus,
          notes: (input.receiptNotes || '').trim().slice(0, 300),
          ownerUid: effectiveOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAtMs: now,
        };
      }

      const newOrder: Order = {
        id: orderId,
        orderNumber,
        reference: resolvedReference,
        waiterId: waiter.id,
        waiterName: waiter.name,
        status: 'tomado',
        paymentStatus: input.paymentStatus,
        paymentMethod: input.paymentStatus === 'pagado' ? input.paymentMethod || 'efectivo' : input.paymentMethod,
        items: input.items,
        subtotal,
        total,
        notes: input.notes.trim().slice(0, 400),
        receiptCount,
        latestReceiptUrl: receiptUrl,
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      const itemCount = input.items.reduce((s, i) => s + i.quantity, 0);
      const creationMovement: Movement = {
        id: createSafeId('mov'),
        orderId,
        orderNumber,
        orderReference: newOrder.reference,
        type: 'creacion',
        description: `Creó pedido #${orderNumber} (${itemCount} uds · ${
          newOrder.paymentStatus === 'pagado'
            ? `Pagado con ${PAYMENT_METHOD_LABELS[newOrder.paymentMethod]}`
            : 'Pendiente por cobrar'
        })`,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { total, itemCount, paymentStatus: newOrder.paymentStatus },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      const receiptMovement: Movement | null = uploadedTransfer
        ? {
            id: createSafeId('mov'),
            orderId,
            orderNumber,
            orderReference: newOrder.reference,
            type: 'comprobante',
            description: `Adjuntó comprobante fotográfico por $${total.toLocaleString('es-CO')}`,
            waiterId: waiter.id,
            waiterName: waiter.name,
            actorUid,
            details: { transferId: uploadedTransfer.id, amount: total },
            ownerUid: effectiveOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAtMs: now + 1,
          }
        : null;

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.set(doc(db, orderPath), {
            ...stripClientTimestamps(newOrder),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${creationMovement.id}`), {
            ...stripClientTimestamps(creationMovement),
            createdAt: serverTimestamp(),
          });
          if (uploadedTransfer) {
            batch.set(doc(db, `workspaces/${workspaceId}/transfers/${uploadedTransfer.id}`), {
              ...stripClientTimestamps(uploadedTransfer),
              createdAt: serverTimestamp(),
            });
          }
          if (receiptMovement) {
            batch.set(doc(db, `workspaces/${workspaceId}/movements/${receiptMovement.id}`), {
              ...stripClientTimestamps(receiptMovement),
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: [newOrder, ...prev.orders],
          movements: [
            ...(receiptMovement ? [receiptMovement] : []),
            creationMovement,
            ...prev.movements,
          ],
          transfers: uploadedTransfer ? [uploadedTransfer, ...prev.transfers] : prev.transfers,
        }));
      }

      return newOrder;
    },
    [
      permissions.canTakeOrders,
      requireWaiter,
      orders,
      sessionMode,
      workspaceId,
      effectiveOwnerUid,
      actorUid,
      authorizedEmails,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const updateOrderItems = useCallback(
    async (
      orderId: string,
      nextItems: OrderItem[],
      nextReference: string,
      nextNotes: string
    ) => {
      if (!permissions.canEditOrders) {
        throw new Error('Tu rol actual no tiene permiso para editar productos del pedido.');
      }
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (nextItems.length === 0) {
        throw new Error('El pedido debe tener al menos un producto.');
      }

      const { subtotal, total } = calculateOrderTotals(nextItems);
      const cleanRef = nextReference.trim().slice(0, 100) || target.reference;
      const cleanNotes = nextNotes.trim().slice(0, 400);
      const diffText = diffOrderItems(target.items, nextItems);
      const now = Date.now();

      const mov: Movement = {
        id: createSafeId('mov'),
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: cleanRef,
        type: 'edicion_items',
        description: diffText,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { prevTotal: target.total, nextTotal: total },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, orderPath), {
            items: nextItems,
            subtotal,
            total,
            reference: cleanRef,
            notes: cleanNotes,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`), {
            ...stripClientTimestamps(mov),
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: nextItems,
                  subtotal,
                  total,
                  reference: cleanRef,
                  notes: cleanNotes,
                  waiterId: waiter.id,
                  waiterName: waiter.name,
                  updatedAtMs: now,
                }
              : o
          ),
          movements: [mov, ...prev.movements],
        }));
      }
    },
    [
      permissions.canEditOrders,
      requireWaiter,
      orders,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, nextStatus: OrderStatus) => {
      if (
        (nextStatus === 'preparacion' || nextStatus === 'listo') &&
        !permissions.canAdvanceKitchen
      ) {
        throw new Error('Tu rol actual no tiene permiso para avanzar preparación en cocina.');
      }
      if (nextStatus === 'entregado' && !permissions.canDeliverOrders) {
        throw new Error('Tu rol actual no tiene permiso para marcar pedidos como entregados.');
      }
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (target.status === nextStatus) return;

      const now = Date.now();
      const mov: Movement = {
        id: createSafeId('mov'),
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: target.reference,
        type: 'estado_pedido',
        description: `Cambió estado de ${ORDER_STATUS_LABELS[target.status]} a ${ORDER_STATUS_LABELS[nextStatus]}`,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { from: target.status, to: nextStatus },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, orderPath), {
            status: nextStatus,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`), {
            ...stripClientTimestamps(mov),
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: nextStatus,
                  waiterId: waiter.id,
                  waiterName: waiter.name,
                  updatedAtMs: now,
                }
              : o
          ),
          movements: [mov, ...prev.movements],
        }));
      }
    },
    [
      permissions.canAdvanceKitchen,
      permissions.canDeliverOrders,
      requireWaiter,
      orders,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const voidOrder = useCallback(
    async (orderId: string, reason = '') => {
      if (!permissions.canVoidOrders) {
        throw new Error('Tu rol actual no tiene permiso para anular pedidos.');
      }
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (target.status === 'cancelado') return;

      const now = Date.now();
      const cleanReason = reason.trim().slice(0, 240);
      const mov: Movement = {
        id: createSafeId('mov'),
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: target.reference,
        type: 'estado_pedido',
        description: `Anuló venta #${target.orderNumber}${cleanReason ? ` · Motivo: ${cleanReason}` : ''}`,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { from: target.status, to: 'cancelado', voided: true },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, orderPath), {
            status: 'cancelado',
            voidReason: cleanReason,
            voidedByName: waiter.name.slice(0, 80),
            voidedAtMs: now,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`), {
            ...stripClientTimestamps(mov),
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: 'cancelado',
                  voidReason: cleanReason,
                  voidedByName: waiter.name,
                  voidedAtMs: now,
                  waiterId: waiter.id,
                  waiterName: waiter.name,
                  updatedAtMs: now,
                }
              : o
          ),
          movements: [mov, ...prev.movements],
        }));
      }
    },
    [
      permissions.canVoidOrders,
      requireWaiter,
      orders,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const deleteOrderRecord = useCallback(
    async (orderId: string) => {
      requireAdmin();
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;

      const relatedMovements = movements.filter((m) => m.orderId === orderId);
      const relatedTransfers = transfers.filter((t) => t.orderId === orderId);

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, orderPath));
          for (const mov of relatedMovements) {
            batch.delete(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`));
          }
          for (const tr of relatedTransfers) {
            batch.delete(doc(db, `workspaces/${workspaceId}/transfers/${tr.id}`));
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.filter((o) => o.id !== orderId),
          movements: prev.movements.filter((m) => m.orderId !== orderId),
          transfers: prev.transfers.filter((t) => t.orderId !== orderId),
        }));
      }
    },
    [
      requireAdmin,
      orders,
      movements,
      transfers,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const updateOrderPayment = useCallback(
    async ({
      orderId,
      paymentStatus,
      paymentMethod,
      receiptFile,
      receiptNotes,
    }: {
      orderId: string;
      paymentStatus: PaymentStatus;
      paymentMethod: PaymentMethod;
      receiptFile?: File | null;
      receiptNotes?: string;
    }) => {
      if (!permissions.canManagePayments) {
        throw new Error('Tu rol actual no tiene permiso para confirmar o modificar pagos.');
      }
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');

      const now = Date.now();
      let newReceipt: TransferReceipt | null = null;
      let usedFallbackInline = false;

      if (receiptFile) {
        const transferId = createSafeId('tr');
        const uploadRes = await uploadTransferReceiptImage({
          mode: sessionMode || 'demo',
          workspaceId,
          transferId,
          file: receiptFile,
        });
        usedFallbackInline = uploadRes.usedFallbackInline;
        newReceipt = {
          id: transferId,
          orderId: target.id,
          orderNumber: target.orderNumber,
          orderReference: target.reference,
          amount: target.total,
          imageUrl: uploadRes.imageUrl,
          storagePath: uploadRes.storagePath,
          waiterId: waiter.id,
          waiterName: waiter.name,
          paymentStatus,
          notes: (receiptNotes || '').trim().slice(0, 300),
          ownerUid: effectiveOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAtMs: now,
        };
      }

      const nextReceiptCount = target.receiptCount + (newReceipt ? 1 : 0);
      const nextLatestUrl = newReceipt ? newReceipt.imageUrl : target.latestReceiptUrl;

      const payMov: Movement = {
        id: createSafeId('mov'),
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: target.reference,
        type: newReceipt ? 'comprobante' : 'estado_pago',
        description: newReceipt
          ? `Registró pago (${PAYMENT_METHOD_LABELS[paymentMethod]}) y adjuntó comprobante`
          : `Actualizó pago a ${paymentStatus === 'pagado' ? 'Pagado' : 'Pendiente'}${
              paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[paymentMethod]}` : ''
            }`,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { paymentStatus, paymentMethod, total: target.total },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, orderPath), {
            paymentStatus,
            paymentMethod,
            receiptCount: nextReceiptCount,
            latestReceiptUrl: nextLatestUrl,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${payMov.id}`), {
            ...stripClientTimestamps(payMov),
            createdAt: serverTimestamp(),
          });
          if (newReceipt) {
            batch.set(doc(db, `workspaces/${workspaceId}/transfers/${newReceipt.id}`), {
              ...stripClientTimestamps(newReceipt),
              createdAt: serverTimestamp(),
            });
          }
          const existingTransfers = transfers.filter((t) => t.orderId === orderId);
          for (const tr of existingTransfers) {
            batch.update(doc(db, `workspaces/${workspaceId}/transfers/${tr.id}`), {
              paymentStatus,
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  paymentStatus,
                  paymentMethod,
                  receiptCount: nextReceiptCount,
                  latestReceiptUrl: nextLatestUrl,
                  waiterId: waiter.id,
                  waiterName: waiter.name,
                  updatedAtMs: now,
                }
              : o
          ),
          transfers: (newReceipt ? [newReceipt, ...prev.transfers] : prev.transfers).map((t) =>
            t.orderId === orderId ? { ...t, paymentStatus } : t
          ),
          movements: [payMov, ...prev.movements],
        }));
      }

      return { usedFallbackInline };
    },
    [
      permissions.canManagePayments,
      requireWaiter,
      orders,
      transfers,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const attachReceiptToOrder = useCallback(
    async ({
      orderId,
      file,
      amount,
      notes,
    }: {
      orderId: string;
      file: File;
      amount: number;
      notes?: string;
    }) => {
      if (!permissions.canUploadReceipts) {
        throw new Error('Tu rol actual no tiene permiso para subir comprobantes.');
      }
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');

      const transferId = createSafeId('tr');
      const uploadRes = await uploadTransferReceiptImage({
        mode: sessionMode || 'demo',
        workspaceId,
        transferId,
        file,
      });

      const now = Date.now();
      const newTransfer: TransferReceipt = {
        id: transferId,
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: target.reference,
        amount,
        imageUrl: uploadRes.imageUrl,
        storagePath: uploadRes.storagePath,
        waiterId: waiter.id,
        waiterName: waiter.name,
        paymentStatus: 'pagado',
        notes: (notes || '').trim().slice(0, 300),
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      const mov: Movement = {
        id: createSafeId('mov'),
        orderId: target.id,
        orderNumber: target.orderNumber,
        orderReference: target.reference,
        type: 'comprobante',
        description: `Subió comprobante de transferencia por $${amount.toLocaleString('es-CO')}`,
        waiterId: waiter.id,
        waiterName: waiter.name,
        actorUid,
        details: { transferId, amount },
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const orderPath = `workspaces/${workspaceId}/orders/${orderId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, orderPath), {
            paymentStatus: 'pagado',
            paymentMethod: 'transferencia',
            receiptCount: target.receiptCount + 1,
            latestReceiptUrl: uploadRes.imageUrl,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/transfers/${transferId}`), {
            ...stripClientTimestamps(newTransfer),
            createdAt: serverTimestamp(),
          });
          batch.set(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`), {
            ...stripClientTimestamps(mov),
            createdAt: serverTimestamp(),
          });
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, orderPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  paymentStatus: 'pagado',
                  paymentMethod: 'transferencia',
                  receiptCount: o.receiptCount + 1,
                  latestReceiptUrl: uploadRes.imageUrl,
                  waiterId: waiter.id,
                  waiterName: waiter.name,
                  updatedAtMs: now,
                }
              : o
          ),
          transfers: [newTransfer, ...prev.transfers],
          movements: [mov, ...prev.movements],
        }));
      }

      return { usedFallbackInline: uploadRes.usedFallbackInline };
    },
    [
      permissions.canUploadReceipts,
      requireWaiter,
      orders,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const voidTransferReceipt = useCallback(
    async (transferId: string, reason = '') => {
      if (!permissions.canVoidReceipts) {
        throw new Error('Tu rol actual no tiene permiso para anular comprobantes.');
      }
      const waiter = requireWaiter();
      const target = transfers.find((t) => t.id === transferId);
      if (!target || target.annulled) return;

      const now = Date.now();
      const cleanReason = reason.trim().slice(0, 240);
      const parentOrder = orders.find((o) => o.id === target.orderId);
      const remainingActive = transfers.filter(
        (t) => t.orderId === target.orderId && t.id !== transferId && !t.annulled
      );

      const mov: Movement | null = parentOrder
        ? {
            id: createSafeId('mov'),
            orderId: parentOrder.id,
            orderNumber: parentOrder.orderNumber,
            orderReference: parentOrder.reference,
            type: 'comprobante',
            description: `Anuló comprobante por $${target.amount.toLocaleString('es-CO')}${
              cleanReason ? ` · Motivo: ${cleanReason}` : ''
            }`,
            waiterId: waiter.id,
            waiterName: waiter.name,
            actorUid,
            details: { transferId, annulled: true },
            ownerUid: effectiveOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAtMs: now,
          }
        : null;

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/transfers/${transferId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, path), {
            annulled: true,
            annulledByName: waiter.name.slice(0, 80),
            annulledReason: cleanReason,
            annulledAtMs: now,
          });
          if (parentOrder) {
            batch.update(doc(db, `workspaces/${workspaceId}/orders/${parentOrder.id}`), {
              receiptCount: remainingActive.length,
              latestReceiptUrl: remainingActive[0]?.imageUrl || '',
              waiterId: waiter.id,
              waiterName: waiter.name,
              updatedAt: serverTimestamp(),
            });
          }
          if (mov) {
            batch.set(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`), {
              ...stripClientTimestamps(mov),
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          transfers: prev.transfers.map((t) =>
            t.id === transferId
              ? {
                  ...t,
                  annulled: true,
                  annulledByName: waiter.name,
                  annulledReason: cleanReason,
                  annulledAtMs: now,
                }
              : t
          ),
          orders: parentOrder
            ? prev.orders.map((o) =>
                o.id === parentOrder.id
                  ? {
                      ...o,
                      receiptCount: remainingActive.length,
                      latestReceiptUrl: remainingActive[0]?.imageUrl || '',
                      updatedAtMs: now,
                    }
                  : o
              )
            : prev.orders,
          movements: mov ? [mov, ...prev.movements] : prev.movements,
        }));
      }
    },
    [
      permissions.canVoidReceipts,
      requireWaiter,
      transfers,
      orders,
      actorUid,
      effectiveOwnerUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const deleteTransferReceipt = useCallback(
    async (transferId: string) => {
      requireAdmin();
      const target = transfers.find((t) => t.id === transferId);
      if (!target) return;

      const parentOrder = orders.find((o) => o.id === target.orderId);
      const remainingActive = transfers.filter(
        (t) => t.orderId === target.orderId && t.id !== transferId && !t.annulled
      );
      const relatedMovements = movements.filter(
        (m) => m.details && m.details.transferId === transferId
      );

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/transfers/${transferId}`;
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, path));
          for (const mov of relatedMovements) {
            batch.delete(doc(db, `workspaces/${workspaceId}/movements/${mov.id}`));
          }
          if (parentOrder) {
            batch.update(doc(db, `workspaces/${workspaceId}/orders/${parentOrder.id}`), {
              receiptCount: remainingActive.length,
              latestReceiptUrl: remainingActive[0]?.imageUrl || '',
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          transfers: prev.transfers.filter((t) => t.id !== transferId),
          movements: prev.movements.filter((m) => m.details?.transferId !== transferId),
          orders: parentOrder
            ? prev.orders.map((o) =>
                o.id === parentOrder.id
                  ? {
                      ...o,
                      receiptCount: remainingActive.length,
                      latestReceiptUrl: remainingActive[0]?.imageUrl || '',
                    }
                  : o
              )
            : prev.orders,
        }));
      }
    },
    [
      requireAdmin,
      transfers,
      orders,
      movements,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  // ADMIN-ONLY MUTATIONS
  const saveProduct = useCallback(
    async (input: SaveProductInput) => {
      requireAdmin();
      if (!input.name.trim()) {
        throw new Error('El nombre del producto es obligatorio.');
      }
      if (!Number.isFinite(input.basePrice) || input.basePrice < 0) {
        throw new Error('El precio base debe ser válido.');
      }
      const now = Date.now();
      const prodId = input.id || createSafeId('prod');
      const existing = products.find((p) => p.id === prodId);

      const minS = input.allowSauces ? Math.max(0, Math.min(4, Math.round(input.minSauces))) : 0;
      const maxS = input.allowSauces ? Math.max(minS, Math.min(4, Math.round(input.maxSauces))) : 0;

      const cleanProduct: Product = {
        id: prodId,
        name: input.name.trim().slice(0, 100),
        category: input.category.trim().slice(0, 60) || 'General',
        basePrice: Math.round(input.basePrice),
        imageUrl: (input.imageUrl || existing?.imageUrl || '').trim().slice(0, 500),
        baseRecipe: input.baseRecipe.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        removableOptions: input.removableOptions.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        addonOptions: input.addonOptions.slice(0, 30),
        allowSauces: input.allowSauces,
        minSauces: minS,
        maxSauces: maxS,
        active: input.active,
        ownerUid: effectiveOwnerUid,
        createdByUid: existing?.createdByUid || actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: existing?.createdAtMs || now,
        updatedAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/products/${prodId}`;
        try {
          if (existing) {
            await updateDoc(doc(db, path), {
              name: cleanProduct.name,
              category: cleanProduct.category,
              basePrice: cleanProduct.basePrice,
              imageUrl: cleanProduct.imageUrl,
              baseRecipe: cleanProduct.baseRecipe,
              removableOptions: cleanProduct.removableOptions,
              addonOptions: cleanProduct.addonOptions,
              allowSauces: cleanProduct.allowSauces,
              minSauces: cleanProduct.minSauces,
              maxSauces: cleanProduct.maxSauces,
              active: cleanProduct.active,
              allowedEmails: cleanProduct.allowedEmails,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, path), {
              ...stripClientTimestamps(cleanProduct),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      } else {
        syncDemoMutation((prev) => {
          const exists = prev.products.some((p) => p.id === prodId);
          return {
            ...prev,
            products: exists
              ? prev.products.map((p) => (p.id === prodId ? cleanProduct : p))
              : [cleanProduct, ...prev.products],
          };
        });
      }
    },
    [
      requireAdmin,
      products,
      effectiveOwnerUid,
      actorUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const toggleProductActive = useCallback(
    async (productId: string, active: boolean) => {
      requireAdmin();
      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/products/${productId}`;
        try {
          await updateDoc(doc(db, path), {
            active,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          products: prev.products.map((p) =>
            p.id === productId ? { ...p, active, updatedAtMs: now } : p
          ),
        }));
      }
    },
    [requireAdmin, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const deleteProduct = useCallback(
    async (productId: string) => {
      requireAdmin();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/products/${productId}`;
        try {
          await deleteDoc(doc(db, path));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          products: prev.products.filter((p) => p.id !== productId),
        }));
      }
    },
    [requireAdmin, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const saveSauce = useCallback(
    async (name: string, id?: string, active = true) => {
      requireAdmin();
      const cleanName = name.trim().slice(0, 60);
      if (!cleanName) throw new Error('Escribe el nombre de la salsa.');
      const now = Date.now();
      const sauceId = id || createSafeId('sauce');
      const existing = sauces.find((s) => s.id === sauceId);

      const cleanSauce: Sauce = {
        id: sauceId,
        name: cleanName,
        active,
        ownerUid: effectiveOwnerUid,
        createdByUid: existing?.createdByUid || actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: existing?.createdAtMs || now,
        updatedAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/sauces/${sauceId}`;
        try {
          if (existing) {
            await updateDoc(doc(db, path), {
              name: cleanSauce.name,
              active: cleanSauce.active,
              allowedEmails: cleanSauce.allowedEmails,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, path), {
              ...stripClientTimestamps(cleanSauce),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      } else {
        syncDemoMutation((prev) => {
          const exists = prev.sauces.some((s) => s.id === sauceId);
          return {
            ...prev,
            sauces: exists
              ? prev.sauces.map((s) => (s.id === sauceId ? cleanSauce : s))
              : [...prev.sauces, cleanSauce],
          };
        });
      }
    },
    [
      requireAdmin,
      sauces,
      effectiveOwnerUid,
      actorUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
    ]
  );

  const toggleSauceActive = useCallback(
    async (sauceId: string, active: boolean) => {
      requireAdmin();
      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/sauces/${sauceId}`;
        try {
          await updateDoc(doc(db, path), {
            active,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          sauces: prev.sauces.map((s) =>
            s.id === sauceId ? { ...s, active, updatedAtMs: now } : s
          ),
        }));
      }
    },
    [requireAdmin, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const deleteSauce = useCallback(
    async (sauceId: string) => {
      requireAdmin();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/sauces/${sauceId}`;
        try {
          await deleteDoc(doc(db, path));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          sauces: prev.sauces.filter((s) => s.id !== sauceId),
        }));
      }
    },
    [requireAdmin, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const saveStaffMember = useCallback(
    async (name: string, role: StaffRole = 'mesero') => {
      const cleanName = name.trim().slice(0, 80);
      if (!cleanName) throw new Error('Escribe el nombre del integrante del equipo.');
      const now = Date.now();

      // Non-primary accounts can ONLY register their own permanent name ONCE (role locked to 'mesero')
      if (!isPrimaryAdmin) {
        const ownId = `staff_${actorUid}`;
        const existingOwn = staff.find(
          (s) =>
            s.id === ownId ||
            s.linkedUid === actorUid ||
            (s.linkedEmail && actorEmail && s.linkedEmail.toLowerCase() === actorEmail)
        );
        if (existingOwn) {
          throw new Error(
            'Tu nombre y rol ya están asignados permanentemente. Solo el administrador principal puede modificarlos.'
          );
        }

        const selfMember: StaffMember = {
          id: ownId,
          name: cleanName,
          role: 'mesero',
          active: true,
          linkedUid: actorUid,
          linkedEmail: actorEmail || (firebaseUser?.email || '').toLowerCase(),
          ownerUid: effectiveOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAtMs: now,
          updatedAtMs: now,
        };

        if (sessionMode === 'cloud' && db && firebaseUser) {
          const path = `workspaces/${workspaceId}/staff/${ownId}`;
          try {
            await setDoc(doc(db, path), {
              ...stripClientTimestamps(selfMember),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, path);
          }
        } else {
          syncDemoMutation((prev) => ({
            ...prev,
            staff: [...prev.staff, selfMember],
          }));
        }
        setActiveWaiterId(ownId);
        return;
      }

      // Primary Admin creating a new staff member (any role)
      const id = createSafeId('staff');
      const member: StaffMember = {
        id,
        name: cleanName,
        role,
        active: true,
        linkedUid: '',
        linkedEmail: '',
        ownerUid: effectiveOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${id}`;
        try {
          await setDoc(doc(db, path), {
            ...stripClientTimestamps(member),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          staff: [...prev.staff, member],
        }));
      }
      setActiveWaiterId(id);
    },
    [
      isPrimaryAdmin,
      staff,
      effectiveOwnerUid,
      actorUid,
      actorEmail,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
      setActiveWaiterId,
    ]
  );

  const updateStaffRole = useCallback(
    async (staffId: string, role: StaffRole) => {
      requirePrimaryAdmin();
      const target = staff.find((s) => s.id === staffId);
      if (
        target &&
        ((target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (target.linkedUid && target.linkedUid === effectiveOwnerUid))
      ) {
        throw new Error('No puedes cambiar ni degradar el rol del administrador principal.');
      }

      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${staffId}`;
        try {
          await updateDoc(doc(db, path), {
            role,
            linkedUid: target?.linkedUid || '',
            linkedEmail: target?.linkedEmail || '',
            updatedAt: serverTimestamp(),
          });
          if (target?.linkedUid && target.linkedUid !== effectiveOwnerUid) {
            const memberRef = doc(db, `workspaces/${workspaceId}/members/${target.linkedUid}`);
            const mSnap = await getDoc(memberRef);
            if (mSnap.exists()) {
              await updateDoc(memberRef, {
                role: role === 'admin' ? 'admin' : 'mesero',
              });
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          staff: prev.staff.map((s) =>
            s.id === staffId ? { ...s, role, updatedAtMs: now } : s
          ),
        }));
      }
    },
    [requirePrimaryAdmin, staff, effectiveOwnerUid, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const renameStaffMember = useCallback(
    async (staffId: string, name: string) => {
      requirePrimaryAdmin();
      const cleanName = name.trim().slice(0, 80);
      if (!cleanName) throw new Error('Escribe un nombre válido.');
      const target = staff.find((s) => s.id === staffId);
      if (!target) throw new Error('Usuario no encontrado.');
      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${staffId}`;
        try {
          await updateDoc(doc(db, path), {
            name: cleanName,
            linkedUid: target.linkedUid || '',
            linkedEmail: target.linkedEmail || '',
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          staff: prev.staff.map((s) =>
            s.id === staffId ? { ...s, name: cleanName, updatedAtMs: now } : s
          ),
        }));
      }
    },
    [requirePrimaryAdmin, staff, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const toggleStaffActive = useCallback(
    async (staffId: string, active: boolean) => {
      requirePrimaryAdmin();
      const target = staff.find((s) => s.id === staffId);
      if (
        !active &&
        target &&
        ((target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (target.linkedUid && target.linkedUid === effectiveOwnerUid))
      ) {
        throw new Error('No puedes desactivar la cuenta del administrador principal.');
      }

      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${staffId}`;
        try {
          await updateDoc(doc(db, path), {
            active,
            linkedUid: target?.linkedUid || '',
            linkedEmail: target?.linkedEmail || '',
            updatedAt: serverTimestamp(),
          });
          if (target?.linkedUid && target.linkedUid !== effectiveOwnerUid) {
            const memberRef = doc(db, `workspaces/${workspaceId}/members/${target.linkedUid}`);
            const mSnap = await getDoc(memberRef);
            if (mSnap.exists()) {
              await updateDoc(memberRef, { active });
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          staff: prev.staff.map((s) =>
            s.id === staffId ? { ...s, active, updatedAtMs: now } : s
          ),
        }));
      }
    },
    [requirePrimaryAdmin, staff, effectiveOwnerUid, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const deleteStaffMember = useCallback(
    async (staffId: string) => {
      requirePrimaryAdmin();
      const target = staff.find((s) => s.id === staffId);
      if (
        target &&
        ((target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (target.linkedUid && target.linkedUid === effectiveOwnerUid))
      ) {
        throw new Error('No puedes eliminar al administrador principal.');
      }

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${staffId}`;
        try {
          await deleteDoc(doc(db, path));
          if (target?.linkedUid && target.linkedUid !== effectiveOwnerUid) {
            const memberRef = doc(db, `workspaces/${workspaceId}/members/${target.linkedUid}`);
            const mSnap = await getDoc(memberRef);
            if (mSnap.exists()) {
              await deleteDoc(memberRef);
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          staff: prev.staff.filter((s) => s.id !== staffId),
        }));
      }
      if (activeWaiterId === staffId) {
        const nextActive = staff.find((s) => s.id !== staffId && s.active);
        setActiveWaiterId(nextActive ? nextActive.id : '');
      }
    },
    [
      requirePrimaryAdmin,
      sessionMode,
      workspaceId,
      firebaseUser,
      effectiveOwnerUid,
      syncDemoMutation,
      activeWaiterId,
      staff,
      setActiveWaiterId,
    ]
  );

  const updateAuthorizedEmails = useCallback(
    async (emails: string[]) => {
      requirePrimaryAdmin();
      const cleanList = Array.from(
        new Set(
          [ADMIN_BOOTSTRAP_EMAIL, ...emails]
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.includes('@'))
        )
      ).slice(0, 25);

      if (sessionMode === 'cloud' && db && firebaseUser) {
        const wsPath = `workspaces/${workspaceId}`;
        try {
          const batch = writeBatch(db);
          batch.update(doc(db, wsPath), {
            authorizedEmails: cleanList,
            updatedAt: serverTimestamp(),
          });
          // Propagate allowedEmails to existing catalog & active records so waiters can list them
          for (const colName of ['staff', 'sauces', 'products', 'orders'] as const) {
            const snap = await getDocs(
              query(collection(db, `workspaces/${workspaceId}/${colName}`), where('ownerUid', '==', effectiveOwnerUid))
            );
            snap.docs.forEach((d) => {
              if (colName === 'staff') {
                const raw = d.data();
                batch.update(d.ref, {
                  allowedEmails: cleanList,
                  linkedUid: String(raw.linkedUid || ''),
                  linkedEmail: String(raw.linkedEmail || ''),
                  updatedAt: serverTimestamp(),
                });
              } else {
                batch.update(d.ref, {
                  allowedEmails: cleanList,
                  updatedAt: serverTimestamp(),
                });
              }
            });
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, wsPath);
        }
      } else {
        syncDemoMutation((prev) => ({
          ...prev,
          authorizedEmails: cleanList,
        }));
      }
    },
    [requirePrimaryAdmin, sessionMode, workspaceId, firebaseUser, effectiveOwnerUid, syncDemoMutation]
  );

  const updateAllowSelfRegistration = useCallback(
    async (allow: boolean) => {
      requirePrimaryAdmin();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const dirPath = `workspaceDirectory/${workspaceId}`;
        try {
          const dirRef = doc(db, dirPath);
          const dirSnap = await getDoc(dirRef);
          if (dirSnap.exists()) {
            await updateDoc(dirRef, {
              allowSelfRegistration: allow,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(dirRef, {
              id: workspaceId,
              name: "O'NDE LUIGI",
              ownerUid: effectiveOwnerUid,
              allowSelfRegistration: allow,
              updatedAt: serverTimestamp(),
            });
          }
          setAllowSelfRegistration(allow);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, dirPath);
        }
      } else {
        setAllowSelfRegistration(allow);
      }
    },
    [requirePrimaryAdmin, sessionMode, workspaceId, firebaseUser, effectiveOwnerUid]
  );

  const value: PosContextValue = {
    sessionMode,
    authReady,
    firebaseUser,
    isFirebaseConfigured,
    configSource,
    projectId: resolvedFirebaseConfig?.projectId || null,
    cloudError,
    loadingData,
    identityReady,

    accountRole,
    effectiveRole,
    previewRole,
    setPreviewRole,
    permissions,
    isAdmin,
    isPrimaryAdmin,
    isRealPrimaryAdmin,
    authorizedEmails,
    allowSelfRegistration,

    staff,
    sauces,
    products,
    orders,
    movements,
    transfers,

    activeWaiterId,
    activeWaiter,
    myLinkedStaff,
    setActiveWaiterId,

    emailVerified: sessionMode === 'demo' ? !isUnverifiedDemo : emailVerifiedState,
    verificationNotice,
    clearVerificationNotice,

    enterDemoMode,
    setDemoAccountRole,
    resetDemoData,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resetPassword,
    sendVerificationEmail,
    refreshEmailVerification,
    signOutSession,

    createOrder,
    updateOrderItems,
    updateOrderStatus,
    voidOrder,
    deleteOrderRecord,
    updateOrderPayment,
    attachReceiptToOrder,
    voidTransferReceipt,
    deleteTransferReceipt,
    saveProduct,
    toggleProductActive,
    deleteProduct,
    saveSauce,
    toggleSauceActive,
    deleteSauce,
    saveStaffMember,
    updateStaffRole,
    renameStaffMember,
    toggleStaffActive,
    deleteStaffMember,
    updateAuthorizedEmails,
    updateAllowSelfRegistration,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export function usePosStore(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePosStore must be used inside PosProvider');
  return ctx;
}
