import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
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
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../utils/orderMath';
import { uploadTransferReceiptImage } from './storageService';

const DEMO_STORAGE_KEY = 'ondeluigi_demo_state_v2';
const ACTIVE_WAITER_STORAGE_KEY = 'ondeluigi_active_waiter_v2';
const DEMO_MODE_FLAG_KEY = 'ondeluigi_demo_active_v2';
const DEMO_ROLE_STORAGE_KEY = 'ondeluigi_demo_role_v2';
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

  accountRole: AccountRole;
  isAdmin: boolean;
  authorizedEmails: string[];

  staff: StaffMember[];
  sauces: Sauce[];
  products: Product[];
  orders: Order[];
  movements: Movement[];
  transfers: TransferReceipt[];

  activeWaiterId: string;
  activeWaiter: StaffMember | null;
  setActiveWaiterId: (id: string) => void;

  enterDemoMode: (role?: AccountRole) => void;
  setDemoAccountRole: (role: AccountRole) => void;
  resetDemoData: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutSession: () => Promise<void>;

  createOrder: (input: CreateOrderInput) => Promise<Order>;
  updateOrderItems: (
    orderId: string,
    nextItems: OrderItem[],
    nextReference: string,
    nextNotes: string
  ) => Promise<void>;
  updateOrderStatus: (orderId: string, nextStatus: OrderStatus) => Promise<void>;
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

  saveProduct: (input: SaveProductInput) => Promise<void>;
  toggleProductActive: (productId: string, active: boolean) => Promise<void>;
  saveSauce: (name: string, id?: string, active?: boolean) => Promise<void>;
  toggleSauceActive: (sauceId: string, active: boolean) => Promise<void>;
  saveStaffMember: (name: string, role: StaffRole) => Promise<void>;
  toggleStaffActive: (staffId: string, active: boolean) => Promise<void>;
  updateAuthorizedEmails: (emails: string[]) => Promise<void>;
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

  const [demoAccountRole, setDemoAccountRoleState] = useState<AccountRole>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qRole = params.get('role');
      if (qRole === 'mesero' || qRole === 'admin') return qRole;
      const saved = safeGetStorage(DEMO_ROLE_STORAGE_KEY);
      if (saved === 'mesero' || saved === 'admin') return saved;
    }
    return 'admin';
  });

  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [workspaceOwnerUid, setWorkspaceOwnerUid] = useState<string>('demo_owner');
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([ADMIN_BOOTSTRAP_EMAIL]);

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

  const setDemoAccountRole = useCallback((role: AccountRole) => {
    setDemoAccountRoleState(role);
    try {
      localStorage.setItem(DEMO_ROLE_STORAGE_KEY, role);
    } catch {
      // ignore
    }
  }, []);

  const activeWaiter = useMemo(
    () => staff.find((s) => s.id === activeWaiterId && s.active) || null,
    [staff, activeWaiterId]
  );

  // Determine effective account role
  const accountRole: AccountRole = useMemo(() => {
    if (sessionMode === 'demo') return demoAccountRole;
    if (!firebaseUser) return 'mesero';
    const userEmail = (firebaseUser.email || '').toLowerCase();
    if (userEmail === ADMIN_BOOTSTRAP_EMAIL || firebaseUser.uid === workspaceOwnerUid) {
      return 'admin';
    }
    return 'mesero';
  }, [sessionMode, demoAccountRole, firebaseUser, workspaceOwnerUid]);

  const isAdmin = accountRole === 'admin';

  // Auto-select first active waiter on ?autostart=1 if none selected
  useEffect(() => {
    if (!activeWaiter && staff.length > 0 && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        const preferred =
          demoAccountRole === 'admin'
            ? staff.find((s) => s.active && s.role === 'admin') || staff.find((s) => s.active)
            : staff.find((s) => s.active && s.role === 'mesero') || staff.find((s) => s.active);
        if (preferred) {
          setActiveWaiterId(preferred.id);
        }
      }
    }
  }, [activeWaiter, staff, demoAccountRole, setActiveWaiterId]);

  // Monitor Firebase Auth + test connection
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthReady(true);
      return;
    }

    const safetyTimer = window.setTimeout(() => {
      setAuthReady(true);
    }, 2500);

    testFirestoreConnection().then((res) => {
      if (!res.ok && res.message) {
        setCloudError(res.message);
      }
    });

    const unsub = onAuthStateChanged(auth, (user) => {
      window.clearTimeout(safetyTimer);
      setFirebaseUser(user);
      setAuthReady(true);
      if (user && user.emailVerified) {
        setSessionMode('cloud');
        safeRemoveStorage(DEMO_MODE_FLAG_KEY);
      }
    });

    return () => {
      window.clearTimeout(safetyTimer);
      unsub();
    };
  }, []);

  // Load Demo Data when sessionMode === 'demo'
  useEffect(() => {
    if (sessionMode !== 'demo') return;
    const loaded = loadDemoState();
    setWorkspaceOwnerUid('demo_owner');
    setAuthorizedEmails(
      loaded.authorizedEmails && loaded.authorizedEmails.length > 0
        ? loaded.authorizedEmails
        : [ADMIN_BOOTSTRAP_EMAIL]
    );
    setStaff(loaded.staff);
    setSauces(loaded.sauces);
    setProducts(loaded.products);
    setOrders(loaded.orders.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setMovements(loaded.movements.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setTransfers(loaded.transfers.sort((a, b) => b.createdAtMs - a.createdAtMs));
    setLoadingData(false);
  }, [sessionMode]);

  const workspaceId = sessionMode === 'cloud' ? SHARED_WORKSPACE_ID : 'demo_ws';
  const actorUid = firebaseUser ? firebaseUser.uid : 'demo_owner';
  const effectiveOwnerUid = sessionMode === 'cloud' ? workspaceOwnerUid : 'demo_owner';

  // Ensure Shared Cloud Workspace exists & seed O'NDE LUIGI catalog for admin
  const resolveOrBootstrapCloudWorkspace = useCallback(async (user: User) => {
    if (!db) return null;
    const wsRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID);
    const userEmail = (user.email || '').toLowerCase();
    const isAdminEmail = userEmail === ADMIN_BOOTSTRAP_EMAIL;

    try {
      const snap = await getDoc(wsRef);
      if (!snap.exists()) {
        if (!isAdminEmail) {
          throw new Error(
            `El espacio O'NDE LUIGI aún no ha sido inicializado por el administrador (${ADMIN_BOOTSTRAP_EMAIL}).`
          );
        }
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

        const memberRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', user.uid);
        batch.set(memberRef, {
          uid: user.uid,
          displayName: user.displayName || userEmail || 'Administrador',
          role: 'admin',
          active: true,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
        });

        const seed = buildDemoSeedData(user.uid, userEmail);
        for (const member of seed.staff) {
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', member.id), {
            id: member.id,
            name: member.name,
            role: member.role,
            active: member.active,
            ownerUid: user.uid,
            createdByUid: user.uid,
            allowedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
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
        return { ownerUid: user.uid, authorizedEmails: initialEmails };
      }

      const data = snap.data() as {
        ownerUid: string;
        authorizedEmails?: string[];
      };
      const emails = Array.isArray(data.authorizedEmails)
        ? data.authorizedEmails.map((e) => e.toLowerCase())
        : [ADMIN_BOOTSTRAP_EMAIL];

      if (!isAdminEmail && data.ownerUid !== user.uid && !emails.includes(userEmail)) {
        throw new Error(
          `La cuenta ${userEmail} no está autorizada como mesero. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que agregue tu correo en Ajustes.`
        );
      }

      return { ownerUid: data.ownerUid, authorizedEmails: emails };
    } catch (error) {
      if (error instanceof Error && error.message.includes('no está autorizada')) {
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
    setCloudError(null);

    const userEmail = (firebaseUser.email || '').toLowerCase();
    const unsubs: Array<() => void> = [];

    resolveOrBootstrapCloudWorkspace(firebaseUser)
      .then((wsInfo) => {
        if (cancelled || !db || !wsInfo) return;

        setWorkspaceOwnerUid(wsInfo.ownerUid);
        setAuthorizedEmails(wsInfo.authorizedEmails);

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

        const isOwnerOrBootstrap =
          userEmail === ADMIN_BOOTSTRAP_EMAIL || firebaseUser.uid === wsInfo.ownerUid;

        const subCollection = <T extends { createdAtMs?: number }>(
          subName: string,
          mapper: (data: Record<string, unknown>) => T,
          setter: React.Dispatch<React.SetStateAction<T[]>>,
          sortDesc = true
        ) => {
          const path = `workspaces/${SHARED_WORKSPACE_ID}/${subName}`;
          const q = isOwnerOrBootstrap
            ? query(collection(db!, path), where('ownerUid', '==', wsInfo.ownerUid))
            : query(collection(db!, path), where('allowedEmails', 'array-contains', userEmail));

          const unsub = onSnapshot(
            q,
            (snapshot) => {
              const items = snapshot.docs.map((d) => mapper(d.data()));
              if (sortDesc) {
                items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
              }
              setter(items);
              setLoadingData(false);
            },
            (err) => {
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
              ? (d.addonOptions as AddonOption[])
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
        setLoadingData(false);
      });

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [sessionMode, firebaseUser, resolveOrBootstrapCloudWorkspace]);

  const enterDemoMode = useCallback(
    (role: AccountRole = 'admin') => {
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
    if (!auth) throw new Error('Firebase Auth no está configurado.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    if (cred.user) {
      safeRemoveStorage(DEMO_MODE_FLAG_KEY);
      setSessionMode('cloud');
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase Auth no está configurado.');
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user && !cred.user.emailVerified) {
      await signOut(auth);
      throw new Error('Tu correo aún no está verificado. Verifica tu bandeja o inicia sesión con Google.');
    }
    if (cred.user) {
      safeRemoveStorage(DEMO_MODE_FLAG_KEY);
      setSessionMode('cloud');
    }
  }, []);

  const signOutSession = useCallback(async () => {
    safeRemoveStorage(DEMO_MODE_FLAG_KEY);
    if (auth && firebaseUser) {
      await signOut(auth);
    }
    setSessionMode(null);
    setStaff([]);
    setSauces([]);
    setProducts([]);
    setOrders([]);
    setMovements([]);
    setTransfers([]);
  }, [firebaseUser]);

  const requireWaiter = useCallback((): StaffMember => {
    if (!activeWaiter) {
      throw new Error('Debes seleccionar tu nombre de mesero o encargado antes de registrar o editar pedidos.');
    }
    return activeWaiter;
  }, [activeWaiter]);

  const requireAdmin = useCallback(() => {
    if (!isAdmin) {
      throw new Error('Acceso restringido: solo la cuenta Administradora puede editar recetas, productos, salsas o equipo.');
    }
  }, [isAdmin]);

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
      const waiter = requireWaiter();
      if (!input.reference.trim()) {
        throw new Error('Indica la mesa o nombre del cliente.');
      }
      if (input.items.length === 0) {
        throw new Error('Agrega al menos un producto al pedido.');
      }

      const now = Date.now();
      const orderId = createSafeId('ord');
      const maxNum = orders.reduce((m, o) => Math.max(m, o.orderNumber), 100);
      const orderNumber = maxNum + 1;
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
          orderReference: input.reference.trim().slice(0, 100),
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
        reference: input.reference.trim().slice(0, 100),
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

  const saveStaffMember = useCallback(
    async (name: string, role: StaffRole) => {
      requireAdmin();
      const cleanName = name.trim().slice(0, 80);
      if (!cleanName) throw new Error('Escribe el nombre del integrante del equipo.');
      const now = Date.now();
      const id = createSafeId('staff');
      const member: StaffMember = {
        id,
        name: cleanName,
        role,
        active: true,
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
      requireAdmin,
      effectiveOwnerUid,
      actorUid,
      authorizedEmails,
      sessionMode,
      workspaceId,
      firebaseUser,
      syncDemoMutation,
      setActiveWaiterId,
    ]
  );

  const toggleStaffActive = useCallback(
    async (staffId: string, active: boolean) => {
      requireAdmin();
      const now = Date.now();
      if (sessionMode === 'cloud' && db && firebaseUser) {
        const path = `workspaces/${workspaceId}/staff/${staffId}`;
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
          staff: prev.staff.map((s) =>
            s.id === staffId ? { ...s, active, updatedAtMs: now } : s
          ),
        }));
      }
    },
    [requireAdmin, sessionMode, workspaceId, firebaseUser, syncDemoMutation]
  );

  const updateAuthorizedEmails = useCallback(
    async (emails: string[]) => {
      requireAdmin();
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
              batch.update(d.ref, {
                allowedEmails: cleanList,
                updatedAt: serverTimestamp(),
              });
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
    [requireAdmin, sessionMode, workspaceId, firebaseUser, effectiveOwnerUid, syncDemoMutation]
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

    accountRole,
    isAdmin,
    authorizedEmails,

    staff,
    sauces,
    products,
    orders,
    movements,
    transfers,

    activeWaiterId,
    activeWaiter,
    setActiveWaiterId,

    enterDemoMode,
    setDemoAccountRole,
    resetDemoData,
    signInWithGoogle,
    signInWithEmail,
    signOutSession,

    createOrder,
    updateOrderItems,
    updateOrderStatus,
    updateOrderPayment,
    attachReceiptToOrder,
    saveProduct,
    toggleProductActive,
    saveSauce,
    toggleSauceActive,
    saveStaffMember,
    toggleStaffActive,
    updateAuthorizedEmails,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export function usePosStore(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePosStore must be used inside PosProvider');
  return ctx;
}
