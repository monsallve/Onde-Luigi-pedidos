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
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  configSource,
  db,
  handleFirestoreError,
  isFirebaseConfigured,
  OperationType,
  testFirestoreConnection,
} from '../firebase/config';
import { ADMIN_BOOTSTRAP_EMAIL } from '../data/initialCatalog';
import type {
  AccountRole,
  AddonOption,
  BusinessBillingConfig,
  ConnectionMode,
  Customer,
  Movement,
  MovementType,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  Sauce,
  Shift,
  StaffMember,
  StaffRole,
  TrackedPaymentMethod,
  TransferReceipt,
} from '../types/pos';
import {
  buildCustomerDocId,
  DEFAULT_BILLING_CONFIG,
  DEFAULT_CUSTOMER_DOCUMENT,
  isDefaultFinalConsumer,
  normalizeBillingConfig,
  normalizeCustomerDocument,
  normalizeCustomerName,
} from '../utils/billingUtils';
import {
  calculateOrderTotals,
  createSafeId,
  diffOrderItems,
  formatAutoOrderReference,
  getNextCyclicOrderRefNumber,
  normalizeProductImageUrl,
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
import { evaluateShiftClose } from '../utils/shiftMath';
import { uploadProductImage, uploadTransferReceiptImage } from './storageService';
import {
  mapCustomerDoc,
  mapMovementDoc,
  mapOrderDoc,
  mapProductDoc,
  mapSauceDoc,
  mapShiftDoc,
  mapStaffDoc,
  mapTransferDoc,
  resolveOrBootstrapCloudWorkspace,
  SHARED_WORKSPACE_ID,
  stripClientTimestamps,
} from './workspaceSync';

const ACTIVE_WAITER_STORAGE_KEY = 'ondeluigi_active_waiter_v2';
const CYCLIC_REF_COUNTER_KEY = 'ondeluigi_cyclic_ref_counter_v1';

export interface OrderCustomerInput {
  id?: string;
  documentNumber?: string;
  name?: string;
  phone?: string;
  email?: string;
}

export interface CreateOrderInput {
  reference: string;
  items: OrderItem[];
  notes: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  customer?: OrderCustomerInput;
  receiptFile?: File | null;
  receiptNotes?: string;
}

export interface SaveProductInput {
  id?: string;
  name: string;
  category: string;
  basePrice: number;
  imageUrl?: string;
  imageFile?: File | null;
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
  cloudError: string | null;
  loadingData: boolean;
  identityReady: boolean;

  effectiveRole: StaffRole;
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
  shifts: Shift[];
  openShift: Shift | null;
  customers: Customer[];
  billingConfig: BusinessBillingConfig;

  activeWaiter: StaffMember | null;
  myLinkedStaff: StaffMember | null;

  emailVerified: boolean;
  verificationNotice: string | null;
  clearVerificationNotice: () => void;

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
    customer?: OrderCustomerInput;
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
  toggleStaffActive: (staffId: string, active: boolean) => Promise<void>;
  deleteStaffMember: (staffId: string) => Promise<void>;
  updateAuthorizedEmails: (emails: string[]) => Promise<void>;
  updateAllowSelfRegistration: (allow: boolean) => Promise<void>;
  saveBillingConfig: (config: BusinessBillingConfig) => Promise<void>;
  upsertCustomer: (input: {
    id?: string;
    documentNumber: string;
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
  }) => Promise<Customer | null>;
  deleteCustomerRecord: (customerId: string) => Promise<void>;

  openCashShift: (openingBaseAmount: number, openingNote?: string) => Promise<Shift>;
  closeCashShift: (params: {
    shiftId: string;
    declaredClosingBase: number;
    declaredByMethod: Partial<Record<TrackedPaymentMethod, number>>;
    closingNote?: string;
  }) => Promise<void>;
  deleteShiftRecord: (shiftId: string) => Promise<void>;
}

const PosContext = createContext<PosContextValue | null>(null);

function safeStorageGet(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // ignore iframe/quota errors
  }
}

function safeStorageRemove(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    // ignore iframe/quota errors
  }
}

function claimNextAutoReference(): string {
  const raw = safeStorageGet(CYCLIC_REF_COUNTER_KEY);
  const next = getNextCyclicOrderRefNumber(raw ? Number(raw) : 0);
  safeStorageSet(CYCLIC_REF_COUNTER_KEY, String(next));
  return formatAutoOrderReference(next);
}

export const PosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionMode, setSessionMode] = useState<ConnectionMode | null>(null);
  const sessionModeRef = useRef<ConnectionMode | null>(sessionMode);
  sessionModeRef.current = sessionMode;

  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [emailVerifiedState, setEmailVerifiedState] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [cloudReadyForUid, setCloudReadyForUid] = useState<string | null>(null);

  const [workspaceOwnerUid, setWorkspaceOwnerUid] = useState('');
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([ADMIN_BOOTSTRAP_EMAIL]);
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(true);
  const [cloudMemberRole, setCloudMemberRole] = useState<AccountRole>('mesero');

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sauces, setSauces] = useState<Sauce[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [transfers, setTransfers] = useState<TransferReceipt[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [billingConfig, setBillingConfig] = useState<BusinessBillingConfig>(DEFAULT_BILLING_CONFIG);

  const openShift = useMemo(
    () => shifts.find((s) => s.status === 'abierto') || null,
    [shifts]
  );

  const [activeWaiterId, setActiveWaiterIdState] = useState<string>(
    () => safeStorageGet(ACTIVE_WAITER_STORAGE_KEY) || ''
  );

  const setActiveWaiterId = useCallback((id: string) => {
    setActiveWaiterIdState(id);
    safeStorageSet(ACTIVE_WAITER_STORAGE_KEY, id);
  }, []);

  const actorUid = firebaseUser?.uid || '';
  const actorEmail = (firebaseUser?.email || '').toLowerCase();

  const myLinkedStaff = useMemo(
    () => findLinkedStaffMember(staff, actorUid, actorEmail),
    [staff, actorUid, actorEmail]
  );

  const isRealPrimaryAdmin = useMemo(() => {
    if (!firebaseUser) return false;
    const userEmail = (firebaseUser.email || '').toLowerCase();
    return (
      userEmail === ADMIN_BOOTSTRAP_EMAIL ||
      (Boolean(workspaceOwnerUid) && firebaseUser.uid === workspaceOwnerUid)
    );
  }, [firebaseUser, workspaceOwnerUid]);

  const effectiveRole: StaffRole = useMemo(
    () => resolveEffectiveRole({ isRealPrimaryAdmin, cloudMemberRole, myLinkedStaff }),
    [isRealPrimaryAdmin, cloudMemberRole, myLinkedStaff]
  );

  const permissions = useMemo(() => getRolePermissions(effectiveRole), [effectiveRole]);
  const isAdmin = effectiveRole === 'admin';
  const isPrimaryAdmin = isRealPrimaryAdmin && effectiveRole === 'admin';

  const activeWaiter = useMemo(
    () =>
      resolveActiveWaiter({
        isPrimaryAdmin: isRealPrimaryAdmin,
        myLinkedStaff,
        staff,
        firebaseUid: firebaseUser?.uid || '',
        firebaseDisplayName: firebaseUser?.displayName || '',
        firebaseEmail: firebaseUser?.email || '',
        ownerUid: workspaceOwnerUid,
      }),
    [isRealPrimaryAdmin, myLinkedStaff, staff, firebaseUser, workspaceOwnerUid]
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

  // Clean legacy local keys on mount
  useEffect(() => {
    safeStorageRemove('ondeluigi_demo_state_v2');
    safeStorageRemove('ondeluigi_demo_active_v2');
    safeStorageRemove('ondeluigi_demo_role_v2');
  }, []);

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
  }, []);

  const clearVerificationNotice = useCallback(() => setVerificationNotice(null), []);

  // Monitor Firebase Auth + process email verification query params
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
          .catch(() => undefined)
          .finally(() => cleanUrlParams(['mode', 'oobCode', 'apiKey', 'lang']));
      }
    }

    const safetyTimer = window.setTimeout(() => setAuthReady(true), 4000);
    testFirestoreConnection().then((res) => {
      if (!res.ok && res.message) setCloudError(res.message);
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

  // Real-time Firestore listeners
  useEffect(() => {
    if (sessionMode !== 'cloud' || !db || !firebaseUser) return;

    let cancelled = false;
    setLoadingData(true);
    setStaffLoaded(false);
    setCloudReadyForUid(null);
    setCloudError(null);

    const isBootstrapAdmin = (firebaseUser.email || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL;
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
        setBillingConfig(wsInfo.billingConfig);
        setCloudReadyForUid(firebaseUser.uid);

        unsubs.push(
          onSnapshot(
            doc(db, 'workspaces', SHARED_WORKSPACE_ID),
            (snap) => {
              if (!snap.exists()) return;
              const d = snap.data() as {
                ownerUid: string;
                authorizedEmails?: string[];
                billingConfig?: Partial<BusinessBillingConfig>;
              };
              setWorkspaceOwnerUid(d.ownerUid);
              if (Array.isArray(d.authorizedEmails)) {
                setAuthorizedEmails(d.authorizedEmails.map((e) => e.toLowerCase()));
              }
              if (d.billingConfig) {
                setBillingConfig(normalizeBillingConfig(d.billingConfig));
              }
            },
            (err) => handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`)
          ),
          onSnapshot(
            doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID),
            (snap) => {
              if (snap.exists()) {
                setAllowSelfRegistration(Boolean((snap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration));
              }
            },
            () => undefined
          ),
          onSnapshot(
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
            () => undefined
          )
        );

        const listenSubCollection = <T extends { createdAtMs?: number }>(
          subName: string,
          mapper: (data: Record<string, unknown>, id: string) => T,
          setter: React.Dispatch<React.SetStateAction<T[]>>,
          sortDesc: boolean
        ) => {
          const path = `workspaces/${SHARED_WORKSPACE_ID}/${subName}`;
          const q = query(collection(db!, path), where('ownerUid', '==', wsInfo.ownerUid));
          unsubs.push(
            onSnapshot(
              q,
              (snapshot) => {
                if (cancelled) return;
                const items = snapshot.docs.map((d) => mapper(d.data(), d.id));
                if (sortDesc) items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
                setter(items);
                if (subName === 'staff') setStaffLoaded(true);
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
            )
          );
        };

        listenSubCollection<StaffMember>('staff', (d, id) => mapStaffDoc(d, id), setStaff, false);
        listenSubCollection<Sauce>('sauces', (d) => mapSauceDoc(d), setSauces, false);
        listenSubCollection<Product>('products', (d) => mapProductDoc(d), setProducts, false);
        listenSubCollection<Order>('orders', (d) => mapOrderDoc(d), setOrders, true);
        listenSubCollection<Movement>('movements', (d) => mapMovementDoc(d), setMovements, true);
        listenSubCollection<TransferReceipt>('transfers', (d) => mapTransferDoc(d), setTransfers, true);
        listenSubCollection<Shift>('shifts', (d, id) => mapShiftDoc(d, id), setShifts, true);
        listenSubCollection<Customer>('customers', (d, id) => mapCustomerDoc(d, id), setCustomers, false);
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
  }, [sessionMode, firebaseUser]);

  // Auth actions
  const signInWithGoogle = useCallback(async () => {
    if (!auth) throw new Error('El inicio de sesión no está disponible.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    if (cred.user) activateCloudSession(cred.user);
  }, [activateCloudSession]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (!auth) throw new Error('El inicio de sesión no está disponible.');
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (cred.user) activateCloudSession(cred.user);
    },
    [activateCloudSession]
  );

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      if (!auth) throw new Error('El registro no está disponible.');
      const cleanName = name.trim().slice(0, 80);
      if (!cleanName) throw new Error('Ingresa tu nombre completo.');
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (cred.user) {
        await updateProfile(cred.user, { displayName: cleanName }).catch(() => undefined);
        await cred.user.reload().catch(() => undefined);
        activateCloudSession(auth.currentUser || cred.user);
      }
    },
    [activateCloudSession]
  );

  const resetPassword = useCallback(async (email: string) => {
    if (!auth) throw new Error('La recuperación de contraseña no está disponible.');
    const cleanEmail = email.trim();
    if (!cleanEmail) throw new Error('Ingresa tu correo electrónico.');
    await sendPasswordResetEmail(auth, cleanEmail);
  }, []);

  const sendVerificationEmail = useCallback(async () => {
    if (!auth || !auth.currentUser) {
      throw new Error('Debes iniciar sesión para verificar tu correo.');
    }
    const cleanUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}?verified=1`
        : undefined;
    await sendEmailVerification(
      auth.currentUser,
      cleanUrl ? { url: cleanUrl, handleCodeInApp: false } : undefined
    );
  }, []);

  const refreshEmailVerification = useCallback(async (): Promise<boolean> => {
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
  }, []);

  const signOutSession = useCallback(async () => {
    safeStorageRemove(ACTIVE_WAITER_STORAGE_KEY);
    if (auth && firebaseUser) await signOut(auth);
    setActiveWaiterIdState('');
    setSessionMode(null);
    setCloudError(null);
    setCloudReadyForUid(null);
    setStaffLoaded(false);
    setLoadingData(false);
    setEmailVerifiedState(false);
    setVerificationNotice(null);
    setCloudMemberRole('mesero');
    setWorkspaceOwnerUid('');
    setStaff([]);
    setSauces([]);
    setProducts([]);
    setOrders([]);
    setMovements([]);
    setTransfers([]);
    setShifts([]);
    setCustomers([]);
    setBillingConfig(DEFAULT_BILLING_CONFIG);
  }, [firebaseUser]);

  // Guard & shared record builders
  const requireCloud = useCallback(() => {
    if (!db || !firebaseUser || !workspaceOwnerUid) {
      throw new Error('La conexión con la nube aún se está cargando.');
    }
  }, [firebaseUser, workspaceOwnerUid]);

  const requireWaiter = useCallback((): StaffMember => {
    if (!activeWaiter) {
      throw new Error('Debes asociar tu nombre antes de registrar o editar pedidos.');
    }
    return activeWaiter;
  }, [activeWaiter]);

  const requireAdmin = useCallback(() => {
    if (!isAdmin) {
      throw new Error('Acceso restringido: solo el rol Administrador puede realizar esta acción.');
    }
  }, [isAdmin]);

  const buildMovementRecord = useCallback(
    (params: {
      order: Pick<Order, 'id' | 'orderNumber' | 'reference'>;
      type: MovementType;
      description: string;
      waiter: StaffMember;
      details: Record<string, string | number | boolean>;
      createdAtMs?: number;
    }): Movement => ({
      id: createSafeId('mov'),
      orderId: params.order.id,
      orderNumber: params.order.orderNumber,
      orderReference: params.order.reference,
      type: params.type,
      description: params.description,
      waiterId: params.waiter.id,
      waiterName: params.waiter.name,
      actorUid,
      details: params.details,
      ownerUid: workspaceOwnerUid,
      createdByUid: actorUid,
      allowedEmails: authorizedEmails,
      createdAtMs: params.createdAtMs ?? Date.now(),
    }),
    [actorUid, workspaceOwnerUid, authorizedEmails]
  );

  // Order & Transfer mutations
  const syncCustomCustomerRecord = useCallback(
    async (customer?: OrderCustomerInput): Promise<{
      customerId: string;
      customerDocument: string;
      customerName: string;
      customerPhone: string;
      customerEmail: string;
    }> => {
      const customerDocument = normalizeCustomerDocument(customer?.documentNumber);
      const customerName = normalizeCustomerName(customer?.name, customerDocument);
      const customerPhone = (customer?.phone || '').trim().slice(0, 40);
      const customerEmail = (customer?.email || '').trim().slice(0, 160);

      if (isDefaultFinalConsumer(customerDocument)) {
        return {
          customerId: DEFAULT_CUSTOMER_DOCUMENT,
          customerDocument,
          customerName,
          customerPhone,
          customerEmail,
        };
      }

      const custId = (customer?.id || buildCustomerDocId(customerDocument)).slice(0, 128);
      const custPath = `workspaces/${SHARED_WORKSPACE_ID}/customers/${custId}`;
      try {
        const custRef = doc(db!, custPath);
        const existingSnap = await getDoc(custRef);
        if (existingSnap.exists()) {
          const prev = existingSnap.data() as { phone?: string; email?: string; notes?: string };
          await updateDoc(custRef, {
            documentNumber: customerDocument,
            name: customerName,
            phone: customerPhone || String(prev.phone || ''),
            email: customerEmail || String(prev.email || ''),
            notes: String(prev.notes || ''),
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(custRef, {
            id: custId,
            documentNumber: customerDocument,
            name: customerName,
            phone: customerPhone,
            email: customerEmail,
            notes: '',
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, custPath);
      }

      return {
        customerId: custId,
        customerDocument,
        customerName,
        customerPhone,
        customerEmail,
      };
    },
    [authorizedEmails, workspaceOwnerUid, actorUid]
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput): Promise<Order> => {
      if (!permissions.canTakeOrders) {
        throw new Error('Tu rol actual no tiene permiso para tomar pedidos.');
      }
      requireCloud();
      const waiter = requireWaiter();
      if (input.items.length === 0) {
        throw new Error('Agrega al menos un producto al pedido.');
      }
      if (input.paymentStatus === 'pagado' && !openShift) {
        throw new Error(
          'El turno está cerrado: no puedes confirmar pagos todavía. Envía el pedido como "Por cobrar" o abre un turno en la barra superior.'
        );
      }

      const resolvedCustomer = await syncCustomCustomerRecord(input.customer);
      const now = Date.now();
      const orderId = createSafeId('ord');
      const orderNumber = orders.reduce((m, o) => Math.max(m, o.orderNumber), 100) + 1;
      const resolvedReference = input.reference.trim().slice(0, 100) || claimNextAutoReference();
      const { subtotal, total } = calculateOrderTotals(input.items);

      let receiptUrl = '';
      let receiptCount = 0;
      let uploadedTransfer: TransferReceipt | null = null;

      if (input.receiptFile) {
        const transferId = createSafeId('tr');
        const uploadRes = await uploadTransferReceiptImage({
          workspaceId: SHARED_WORKSPACE_ID,
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
          ownerUid: workspaceOwnerUid,
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
        paymentMethod:
          input.paymentStatus === 'pagado' ? input.paymentMethod || 'efectivo' : input.paymentMethod,
        items: input.items,
        subtotal,
        total,
        notes: input.notes.trim().slice(0, 400),
        receiptCount,
        latestReceiptUrl: receiptUrl,
        customerId: resolvedCustomer.customerId,
        customerDocument: resolvedCustomer.customerDocument,
        customerName: resolvedCustomer.customerName,
        customerPhone: resolvedCustomer.customerPhone,
        customerEmail: resolvedCustomer.customerEmail,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      const itemCount = input.items.reduce((s, i) => s + i.quantity, 0);
      const creationMov = buildMovementRecord({
        order: newOrder,
        type: 'creacion',
        description: `Creó pedido #${orderNumber} (${itemCount} uds · ${
          newOrder.paymentStatus === 'pagado'
            ? `Pagado con ${PAYMENT_METHOD_LABELS[newOrder.paymentMethod]}`
            : 'Pendiente por cobrar'
        })`,
        waiter,
        details: { total, itemCount, paymentStatus: newOrder.paymentStatus },
        createdAtMs: now,
      });

      const receiptMov = uploadedTransfer
        ? buildMovementRecord({
            order: newOrder,
            type: 'comprobante',
            description: `Adjuntó comprobante fotográfico por $${total.toLocaleString('es-CO')}`,
            waiter,
            details: { transferId: uploadedTransfer.id, amount: total },
            createdAtMs: now + 1,
          })
        : null;

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.set(doc(db!, orderPath), {
          ...stripClientTimestamps(newOrder),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${creationMov.id}`), {
          ...stripClientTimestamps(creationMov),
          createdAt: serverTimestamp(),
        });
        if (uploadedTransfer) {
          batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${uploadedTransfer.id}`), {
            ...stripClientTimestamps(uploadedTransfer),
            createdAt: serverTimestamp(),
          });
        }
        if (receiptMov) {
          batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${receiptMov.id}`), {
            ...stripClientTimestamps(receiptMov),
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, orderPath);
      }

      return newOrder;
    },
    [
      permissions.canTakeOrders,
      requireCloud,
      requireWaiter,
      openShift,
      syncCustomCustomerRecord,
      orders,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
    ]
  );

  const updateOrderItems = useCallback(
    async (orderId: string, nextItems: OrderItem[], nextReference: string, nextNotes: string) => {
      if (!permissions.canEditOrders) {
        throw new Error('Tu rol actual no tiene permiso para editar productos del pedido.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (nextItems.length === 0) throw new Error('El pedido debe tener al menos un producto.');

      const { subtotal, total } = calculateOrderTotals(nextItems);
      const cleanRef = nextReference.trim().slice(0, 100) || target.reference;
      const cleanNotes = nextNotes.trim().slice(0, 400);
      const mov = buildMovementRecord({
        order: { id: target.id, orderNumber: target.orderNumber, reference: cleanRef },
        type: 'edicion_items',
        description: diffOrderItems(target.items, nextItems),
        waiter,
        details: { prevTotal: target.total, nextTotal: total },
      });

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, orderPath), {
          items: nextItems,
          subtotal,
          total,
          reference: cleanRef,
          notes: cleanNotes,
          waiterId: waiter.id,
          waiterName: waiter.name,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [permissions.canEditOrders, requireCloud, requireWaiter, orders, buildMovementRecord]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, nextStatus: OrderStatus) => {
      if ((nextStatus === 'preparacion' || nextStatus === 'listo') && !permissions.canAdvanceKitchen) {
        throw new Error('Tu rol actual no tiene permiso para avanzar preparación en cocina.');
      }
      if (nextStatus === 'entregado' && !permissions.canDeliverOrders) {
        throw new Error('Tu rol actual no tiene permiso para marcar pedidos como entregados.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (target.status === nextStatus) return;

      const mov = buildMovementRecord({
        order: target,
        type: 'estado_pedido',
        description: `Cambió estado de ${ORDER_STATUS_LABELS[target.status]} a ${ORDER_STATUS_LABELS[nextStatus]}`,
        waiter,
        details: { from: target.status, to: nextStatus },
      });

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, orderPath), {
          status: nextStatus,
          waiterId: waiter.id,
          waiterName: waiter.name,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [permissions.canAdvanceKitchen, permissions.canDeliverOrders, requireCloud, requireWaiter, orders, buildMovementRecord]
  );

  const voidOrder = useCallback(
    async (orderId: string, reason = '') => {
      if (!permissions.canVoidOrders) {
        throw new Error('Tu rol actual no tiene permiso para anular pedidos.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');
      if (target.status === 'cancelado') return;

      const now = Date.now();
      const cleanReason = reason.trim().slice(0, 240);
      const mov = buildMovementRecord({
        order: target,
        type: 'estado_pedido',
        description: `Anuló venta #${target.orderNumber}${cleanReason ? ` · Motivo: ${cleanReason}` : ''}`,
        waiter,
        details: { from: target.status, to: 'cancelado', voided: true },
        createdAtMs: now,
      });

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, orderPath), {
          status: 'cancelado',
          voidReason: cleanReason,
          voidedByName: waiter.name.slice(0, 80),
          voidedAtMs: now,
          waiterId: waiter.id,
          waiterName: waiter.name,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [permissions.canVoidOrders, requireCloud, requireWaiter, orders, buildMovementRecord]
  );

  const deleteOrderRecord = useCallback(
    async (orderId: string) => {
      requireAdmin();
      requireCloud();
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.delete(doc(db!, orderPath));
        for (const mov of movements.filter((m) => m.orderId === orderId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`));
        }
        for (const tr of transfers.filter((t) => t.orderId === orderId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${tr.id}`));
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, orderPath);
      }
    },
    [requireAdmin, requireCloud, orders, movements, transfers]
  );

  const updateOrderPayment = useCallback(
    async ({
      orderId,
      paymentStatus,
      paymentMethod,
      customer,
      receiptFile,
      receiptNotes,
    }: {
      orderId: string;
      paymentStatus: PaymentStatus;
      paymentMethod: PaymentMethod;
      customer?: OrderCustomerInput;
      receiptFile?: File | null;
      receiptNotes?: string;
    }) => {
      if (!permissions.canManagePayments) {
        throw new Error('Tu rol actual no tiene permiso para confirmar o modificar pagos.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');

      if (paymentStatus === 'pagado' && !openShift) {
        throw new Error(
          'El turno está cerrado: debes abrir un turno en la barra superior antes de confirmar el pago o finalizar una comanda.'
        );
      }

      const resolvedCustomer = customer ? await syncCustomCustomerRecord(customer) : null;
      const now = Date.now();
      let newReceipt: TransferReceipt | null = null;
      let usedFallbackInline = false;

      if (receiptFile) {
        const transferId = createSafeId('tr');
        const uploadRes = await uploadTransferReceiptImage({
          workspaceId: SHARED_WORKSPACE_ID,
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
          ownerUid: workspaceOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAtMs: now,
        };
      }

      const payMov = buildMovementRecord({
        order: target,
        type: newReceipt ? 'comprobante' : 'estado_pago',
        description: newReceipt
          ? `Registró pago (${PAYMENT_METHOD_LABELS[paymentMethod]}) y adjuntó comprobante`
          : `Actualizó pago a ${paymentStatus === 'pagado' ? 'Pagado' : 'Pendiente'}${
              paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[paymentMethod]}` : ''
            }`,
        waiter,
        details: { paymentStatus, paymentMethod, total: target.total },
        createdAtMs: now,
      });

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, orderPath), {
          paymentStatus,
          paymentMethod,
          receiptCount: target.receiptCount + (newReceipt ? 1 : 0),
          latestReceiptUrl: newReceipt ? newReceipt.imageUrl : target.latestReceiptUrl,
          ...(resolvedCustomer
            ? {
                customerId: resolvedCustomer.customerId,
                customerDocument: resolvedCustomer.customerDocument,
                customerName: resolvedCustomer.customerName,
                customerPhone: resolvedCustomer.customerPhone,
                customerEmail: resolvedCustomer.customerEmail,
              }
            : {}),
          waiterId: waiter.id,
          waiterName: waiter.name,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${payMov.id}`), {
          ...stripClientTimestamps(payMov),
          createdAt: serverTimestamp(),
        });
        if (newReceipt) {
          batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${newReceipt.id}`), {
            ...stripClientTimestamps(newReceipt),
            createdAt: serverTimestamp(),
          });
        }
        for (const tr of transfers.filter((t) => t.orderId === orderId)) {
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${tr.id}`), {
            paymentStatus,
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }

      return { usedFallbackInline };
    },
    [
      permissions.canManagePayments,
      requireCloud,
      requireWaiter,
      orders,
      openShift,
      syncCustomCustomerRecord,
      transfers,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
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
      requireCloud();
      const waiter = requireWaiter();
      if (!openShift) {
        throw new Error('El turno está cerrado: abre un turno antes de confirmar pagos con comprobante.');
      }
      const target = orders.find((o) => o.id === orderId);
      if (!target) throw new Error('Pedido no encontrado.');

      const transferId = createSafeId('tr');
      const uploadRes = await uploadTransferReceiptImage({
        workspaceId: SHARED_WORKSPACE_ID,
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
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
      };

      const mov = buildMovementRecord({
        order: target,
        type: 'comprobante',
        description: `Subió comprobante de transferencia por $${amount.toLocaleString('es-CO')}`,
        waiter,
        details: { transferId, amount },
        createdAtMs: now,
      });

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, orderPath), {
          paymentStatus: 'pagado',
          paymentMethod: 'transferencia',
          receiptCount: target.receiptCount + 1,
          latestReceiptUrl: uploadRes.imageUrl,
          waiterId: waiter.id,
          waiterName: waiter.name,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`), {
          ...stripClientTimestamps(newTransfer),
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }

      return { usedFallbackInline: uploadRes.usedFallbackInline };
    },
    [
      permissions.canUploadReceipts,
      requireCloud,
      requireWaiter,
      openShift,
      orders,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
    ]
  );

  const voidTransferReceipt = useCallback(
    async (transferId: string, reason = '') => {
      if (!permissions.canVoidReceipts) {
        throw new Error('Tu rol actual no tiene permiso para anular comprobantes.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = transfers.find((t) => t.id === transferId);
      if (!target || target.annulled) return;

      const now = Date.now();
      const cleanReason = reason.trim().slice(0, 240);
      const parentOrder = orders.find((o) => o.id === target.orderId);
      const remainingActive = transfers.filter(
        (t) => t.orderId === target.orderId && t.id !== transferId && !t.annulled
      );
      const mov = parentOrder
        ? buildMovementRecord({
            order: parentOrder,
            type: 'comprobante',
            description: `Anuló comprobante por $${target.amount.toLocaleString('es-CO')}${
              cleanReason ? ` · Motivo: ${cleanReason}` : ''
            }`,
            waiter,
            details: { transferId, annulled: true },
            createdAtMs: now,
          })
        : null;

      const path = `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, path), {
          annulled: true,
          annulledByName: waiter.name.slice(0, 80),
          annulledReason: cleanReason,
          annulledAtMs: now,
        });
        if (parentOrder) {
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/orders/${parentOrder.id}`), {
            receiptCount: remainingActive.length,
            latestReceiptUrl: remainingActive[0]?.imageUrl || '',
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          });
        }
        if (mov) {
          batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
            ...stripClientTimestamps(mov),
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [permissions.canVoidReceipts, requireCloud, requireWaiter, transfers, orders, buildMovementRecord]
  );

  const deleteTransferReceipt = useCallback(
    async (transferId: string) => {
      requireAdmin();
      requireCloud();
      const target = transfers.find((t) => t.id === transferId);
      if (!target) return;

      const parentOrder = orders.find((o) => o.id === target.orderId);
      const remainingActive = transfers.filter(
        (t) => t.orderId === target.orderId && t.id !== transferId && !t.annulled
      );
      const path = `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`;
      try {
        const batch = writeBatch(db!);
        batch.delete(doc(db!, path));
        for (const mov of movements.filter((m) => m.details && m.details.transferId === transferId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`));
        }
        if (parentOrder) {
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/orders/${parentOrder.id}`), {
            receiptCount: remainingActive.length,
            latestReceiptUrl: remainingActive[0]?.imageUrl || '',
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud, transfers, orders, movements]
  );

  // Admin Menu mutations
  const setSubDocActive = useCallback(
    async (subCol: 'products' | 'sauces', id: string, active: boolean) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/${subCol}/${id}`;
      try {
        await updateDoc(doc(db!, path), { active, updatedAt: serverTimestamp() });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [requireAdmin, requireCloud]
  );

  const deleteSubDoc = useCallback(
    async (subCol: 'products' | 'sauces', id: string) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/${subCol}/${id}`;
      try {
        await deleteDoc(doc(db!, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud]
  );

  const saveProduct = useCallback(
    async (input: SaveProductInput) => {
      requireAdmin();
      requireCloud();
      if (!input.name.trim()) throw new Error('El nombre del producto es obligatorio.');
      if (!Number.isFinite(input.basePrice) || input.basePrice < 0) {
        throw new Error('El precio base debe ser válido.');
      }

      const prodId = input.id || createSafeId('prod');
      const existing = products.find((p) => p.id === prodId);
      const minS = input.allowSauces ? Math.max(0, Math.min(4, Math.round(input.minSauces))) : 0;
      const maxS = input.allowSauces ? Math.max(minS, Math.min(4, Math.round(input.maxSauces))) : 0;

      let resolvedImageUrl = normalizeProductImageUrl(input.imageUrl, existing?.imageUrl);
      if (input.imageFile) {
        const uploaded = await uploadProductImage({
          workspaceId: SHARED_WORKSPACE_ID,
          productId: prodId,
          file: input.imageFile,
        });
        resolvedImageUrl = normalizeProductImageUrl(uploaded.imageUrl, existing?.imageUrl);
      }

      const payload = {
        name: input.name.trim().slice(0, 100),
        category: input.category.trim().slice(0, 60) || 'General',
        basePrice: Math.round(input.basePrice),
        imageUrl: resolvedImageUrl,
        baseRecipe: input.baseRecipe.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        removableOptions: input.removableOptions.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        addonOptions: input.addonOptions.slice(0, 30),
        allowSauces: input.allowSauces,
        minSauces: minS,
        maxSauces: maxS,
        active: input.active,
        allowedEmails: authorizedEmails,
        updatedAt: serverTimestamp(),
      };

      const path = `workspaces/${SHARED_WORKSPACE_ID}/products/${prodId}`;
      try {
        if (existing) {
          await updateDoc(doc(db!, path), payload);
        } else {
          await setDoc(doc(db!, path), {
            id: prodId,
            ...payload,
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
      }
    },
    [requireAdmin, requireCloud, products, workspaceOwnerUid, actorUid, authorizedEmails]
  );

  const toggleProductActive = useCallback(
    (productId: string, active: boolean) => setSubDocActive('products', productId, active),
    [setSubDocActive]
  );
  const deleteProduct = useCallback(
    (productId: string) => deleteSubDoc('products', productId),
    [deleteSubDoc]
  );

  const saveSauce = useCallback(
    async (name: string, id?: string, active = true) => {
      requireAdmin();
      requireCloud();
      const cleanName = name.trim().slice(0, 60);
      if (!cleanName) throw new Error('Escribe el nombre de la salsa.');
      const sauceId = id || createSafeId('sauce');
      const existing = sauces.find((s) => s.id === sauceId);
      const path = `workspaces/${SHARED_WORKSPACE_ID}/sauces/${sauceId}`;
      try {
        if (existing) {
          await updateDoc(doc(db!, path), {
            name: cleanName,
            active,
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db!, path), {
            id: sauceId,
            name: cleanName,
            active,
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
      }
    },
    [requireAdmin, requireCloud, sauces, workspaceOwnerUid, actorUid, authorizedEmails]
  );

  const toggleSauceActive = useCallback(
    (sauceId: string, active: boolean) => setSubDocActive('sauces', sauceId, active),
    [setSubDocActive]
  );
  const deleteSauce = useCallback(
    (sauceId: string) => deleteSubDoc('sauces', sauceId),
    [deleteSubDoc]
  );

  // Team & Role mutations
  const saveStaffMember = useCallback(
    async (name: string, role: StaffRole = 'mesero') => {
      requireCloud();
      const cleanName = name.trim().slice(0, 80);
      if (!cleanName) throw new Error('Escribe el nombre del integrante del equipo.');

      if (!isAdmin) {
        const ownId = `staff_${actorUid}`;
        const existingOwn = staff.find(
          (s) =>
            s.id === ownId ||
            s.linkedUid === actorUid ||
            (s.linkedEmail && actorEmail && s.linkedEmail.toLowerCase() === actorEmail)
        );
        if (existingOwn) {
          throw new Error(
            'Tu nombre y rol ya están asignados permanentemente. Solo un administrador puede modificarlos.'
          );
        }

        const path = `workspaces/${SHARED_WORKSPACE_ID}/staff/${ownId}`;
        try {
          await setDoc(doc(db!, path), {
            id: ownId,
            name: cleanName,
            role: 'mesero',
            active: true,
            linkedUid: actorUid,
            linkedEmail: actorEmail || (firebaseUser?.email || '').toLowerCase(),
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
        setActiveWaiterId(ownId);
        return;
      }

      const id = createSafeId('staff');
      const path = `workspaces/${SHARED_WORKSPACE_ID}/staff/${id}`;
      try {
        await setDoc(doc(db!, path), {
          id,
          name: cleanName,
          role,
          active: true,
          linkedUid: '',
          linkedEmail: '',
          ownerUid: workspaceOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [requireCloud, isAdmin, staff, workspaceOwnerUid, actorUid, actorEmail, authorizedEmails, firebaseUser, setActiveWaiterId]
  );

  const updateStaffRole = useCallback(
    async (staffId: string, role: StaffRole) => {
      requireCloud();
      if (!isValidStaffRole(role)) throw new Error('Rol inválido.');
      const target = staff.find((s) => s.id === staffId);
      if (!target) throw new Error('Usuario no encontrado.');

      const isMainAdminTarget = Boolean(
        (target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (Boolean(target.linkedUid) && target.linkedUid === workspaceOwnerUid)
      );

      if (isMainAdminTarget) {
        if (!isRealPrimaryAdmin) {
          throw new Error('Solo el administrador principal puede cambiar su propio rol operativo.');
        }
      } else {
        requireAdmin();
      }

      const path = `workspaces/${SHARED_WORKSPACE_ID}/staff/${staffId}`;
      try {
        await updateDoc(doc(db!, path), {
          role,
          linkedUid: target.linkedUid || '',
          linkedEmail: target.linkedEmail || '',
          updatedAt: serverTimestamp(),
        });
        if (!isMainAdminTarget && target.linkedUid && target.linkedUid !== workspaceOwnerUid) {
          const memberRef = doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/members/${target.linkedUid}`);
          const nextMemberRole: AccountRole = role === 'admin' ? 'admin' : 'mesero';
          if ((await getDoc(memberRef)).exists()) {
            await updateDoc(memberRef, { role: nextMemberRole });
          } else {
            await setDoc(memberRef, {
              uid: target.linkedUid,
              displayName: (target.name || target.linkedEmail || 'Usuario').trim().slice(0, 100),
              role: nextMemberRole,
              active: target.active,
              ownerUid: workspaceOwnerUid,
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [requireCloud, requireAdmin, isRealPrimaryAdmin, staff, workspaceOwnerUid]
  );

  const toggleStaffActive = useCallback(
    async (staffId: string, active: boolean) => {
      requireAdmin();
      requireCloud();
      const target = staff.find((s) => s.id === staffId);
      if (
        !active &&
        target &&
        ((target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (target.linkedUid && target.linkedUid === workspaceOwnerUid))
      ) {
        throw new Error('No puedes desactivar la cuenta del administrador principal.');
      }

      const path = `workspaces/${SHARED_WORKSPACE_ID}/staff/${staffId}`;
      try {
        await updateDoc(doc(db!, path), {
          active,
          linkedUid: target?.linkedUid || '',
          linkedEmail: target?.linkedEmail || '',
          updatedAt: serverTimestamp(),
        });
        if (target?.linkedUid && target.linkedUid !== workspaceOwnerUid) {
          const memberRef = doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/members/${target.linkedUid}`);
          if ((await getDoc(memberRef)).exists()) {
            await updateDoc(memberRef, { active });
          } else {
            await setDoc(memberRef, {
              uid: target.linkedUid,
              displayName: (target.name || target.linkedEmail || 'Usuario').trim().slice(0, 100),
              role: target.role === 'admin' ? 'admin' : 'mesero',
              active,
              ownerUid: workspaceOwnerUid,
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [requireAdmin, requireCloud, staff, workspaceOwnerUid]
  );

  const deleteStaffMember = useCallback(
    async (staffId: string) => {
      requireAdmin();
      requireCloud();
      const target = staff.find((s) => s.id === staffId);
      if (
        target &&
        ((target.linkedEmail || '').toLowerCase() === ADMIN_BOOTSTRAP_EMAIL ||
          (target.linkedUid && target.linkedUid === workspaceOwnerUid))
      ) {
        throw new Error('No puedes eliminar al administrador principal.');
      }

      const path = `workspaces/${SHARED_WORKSPACE_ID}/staff/${staffId}`;
      try {
        await deleteDoc(doc(db!, path));
        if (target?.linkedUid && target.linkedUid !== workspaceOwnerUid) {
          const memberRef = doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/members/${target.linkedUid}`);
          if ((await getDoc(memberRef)).exists()) {
            await deleteDoc(memberRef);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }

      if (activeWaiterId === staffId) {
        const nextActive = staff.find((s) => s.id !== staffId && s.active);
        setActiveWaiterId(nextActive ? nextActive.id : '');
      }
    },
    [requireAdmin, requireCloud, workspaceOwnerUid, activeWaiterId, staff, setActiveWaiterId]
  );

  const updateAuthorizedEmails = useCallback(
    async (emails: string[]) => {
      requireAdmin();
      requireCloud();
      const cleanList = Array.from(
        new Set(
          [ADMIN_BOOTSTRAP_EMAIL, ...emails]
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.includes('@'))
        )
      ).slice(0, 25);

      const wsPath = `workspaces/${SHARED_WORKSPACE_ID}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, wsPath), {
          authorizedEmails: cleanList,
          updatedAt: serverTimestamp(),
        });
        for (const colName of ['staff', 'sauces', 'products', 'orders', 'shifts', 'customers'] as const) {
          const snap = await getDocs(
            query(
              collection(db!, `workspaces/${SHARED_WORKSPACE_ID}/${colName}`),
              where('ownerUid', '==', workspaceOwnerUid)
            )
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
    },
    [requireAdmin, requireCloud, workspaceOwnerUid]
  );

  const updateAllowSelfRegistration = useCallback(
    async (allow: boolean) => {
      requireAdmin();
      requireCloud();
      const dirPath = `workspaceDirectory/${SHARED_WORKSPACE_ID}`;
      try {
        const dirRef = doc(db!, dirPath);
        if ((await getDoc(dirRef)).exists()) {
          await updateDoc(dirRef, { allowSelfRegistration: allow, updatedAt: serverTimestamp() });
        } else {
          await setDoc(dirRef, {
            id: SHARED_WORKSPACE_ID,
            name: "O'NDE LUIGI",
            ownerUid: workspaceOwnerUid,
            allowSelfRegistration: allow,
            updatedAt: serverTimestamp(),
          });
        }
        setAllowSelfRegistration(allow);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, dirPath);
      }
    },
    [requireAdmin, requireCloud, workspaceOwnerUid]
  );

  const saveBillingConfig = useCallback(
    async (config: BusinessBillingConfig) => {
      requireAdmin();
      requireCloud();
      const normalized = normalizeBillingConfig(config);
      const wsPath = `workspaces/${SHARED_WORKSPACE_ID}`;
      try {
        await updateDoc(doc(db!, wsPath), {
          billingConfig: normalized,
          updatedAt: serverTimestamp(),
        });
        setBillingConfig(normalized);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, wsPath);
      }
    },
    [requireAdmin, requireCloud]
  );

  const upsertCustomer = useCallback(
    async (input: {
      id?: string;
      documentNumber: string;
      name: string;
      phone?: string;
      email?: string;
      notes?: string;
    }): Promise<Customer | null> => {
      requireCloud();
      const cleanDoc = normalizeCustomerDocument(input.documentNumber);
      if (isDefaultFinalConsumer(cleanDoc)) {
        return null;
      }
      const cleanName = normalizeCustomerName(input.name, cleanDoc);
      const cleanPhone = (input.phone || '').trim().slice(0, 40);
      const cleanEmail = (input.email || '').trim().slice(0, 160);
      const cleanNotes = (input.notes || '').trim().slice(0, 300);

      const custId = (input.id || buildCustomerDocId(cleanDoc)).slice(0, 128);
      const path = `workspaces/${SHARED_WORKSPACE_ID}/customers/${custId}`;
      const now = Date.now();
      let createdAtMs = now;

      try {
        const ref = doc(db!, path);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const prev = snap.data() as { createdAt?: unknown };
          createdAtMs = typeof prev.createdAt === 'number' ? prev.createdAt : now;
          await updateDoc(ref, {
            documentNumber: cleanDoc,
            name: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            notes: cleanNotes,
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            id: custId,
            documentNumber: cleanDoc,
            name: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            notes: cleanNotes,
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }

      return {
        id: custId,
        documentNumber: cleanDoc,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        notes: cleanNotes,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs,
        updatedAtMs: now,
      };
    },
    [requireCloud, authorizedEmails, workspaceOwnerUid, actorUid]
  );

  const deleteCustomerRecord = useCallback(
    async (customerId: string) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/customers/${customerId}`;
      try {
        await deleteDoc(doc(db!, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud]
  );

  const openCashShift = useCallback(
    async (openingBaseAmount: number, openingNote = ''): Promise<Shift> => {
      if (!permissions.canManageShifts) {
        throw new Error('Tu rol actual no tiene permiso para abrir o cerrar turnos de caja.');
      }
      requireCloud();
      const waiter = requireWaiter();
      if (shifts.some((s) => s.status === 'abierto')) {
        throw new Error('Ya hay un turno abierto. Ciérralo antes de abrir uno nuevo.');
      }
      if (!Number.isFinite(openingBaseAmount) || openingBaseAmount < 0) {
        throw new Error('Ingresa un valor válido para la base inicial en caja.');
      }

      const safeBase = Math.round(openingBaseAmount);
      const shiftId = createSafeId('shift');
      const now = Date.now();
      const cleanNote = openingNote.trim().slice(0, 300);

      const newShift: Shift = {
        id: shiftId,
        status: 'abierto',
        openingBaseAmount: safeBase,
        openingNote: cleanNote,
        openedByStaffId: waiter.id,
        openedByName: waiter.name.slice(0, 80),
        openedByUid: actorUid,
        openedAtMs: now,
        closedAtMs: 0,
        closedByStaffId: '',
        closedByName: '',
        closedByUid: '',
        closingNote: '',
        usedPaymentMethods: [],
        declaredClosingBase: 0,
        declaredByMethod: {},
        expectedBaseAmount: safeBase,
        expectedByMethod: {},
        expectedTotal: safeBase,
        declaredTotal: 0,
        differenceTotal: 0,
        paidOrdersCount: 0,
        pendingOrdersCount: 0,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      const path = `workspaces/${SHARED_WORKSPACE_ID}/shifts/${shiftId}`;
      try {
        await setDoc(doc(db!, path), {
          id: newShift.id,
          status: newShift.status,
          openingBaseAmount: newShift.openingBaseAmount,
          openingNote: newShift.openingNote,
          openedByStaffId: newShift.openedByStaffId,
          openedByName: newShift.openedByName,
          openedByUid: newShift.openedByUid,
          closedByStaffId: '',
          closedByName: '',
          closedByUid: '',
          closingNote: '',
          usedPaymentMethods: [],
          declaredClosingBase: 0,
          declaredByMethod: {},
          expectedBaseAmount: newShift.expectedBaseAmount,
          expectedByMethod: {},
          expectedTotal: newShift.expectedTotal,
          declaredTotal: 0,
          differenceTotal: 0,
          paidOrdersCount: 0,
          pendingOrdersCount: 0,
          ownerUid: newShift.ownerUid,
          createdByUid: newShift.createdByUid,
          allowedEmails: newShift.allowedEmails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }

      return newShift;
    },
    [permissions.canManageShifts, requireCloud, requireWaiter, shifts, actorUid, workspaceOwnerUid, authorizedEmails]
  );

  const closeCashShift = useCallback(
    async ({
      shiftId,
      declaredClosingBase,
      declaredByMethod,
      closingNote = '',
    }: {
      shiftId: string;
      declaredClosingBase: number;
      declaredByMethod: Partial<Record<TrackedPaymentMethod, number>>;
      closingNote?: string;
    }) => {
      if (!permissions.canManageShifts) {
        throw new Error('Tu rol actual no tiene permiso para cerrar turnos de caja.');
      }
      requireCloud();
      const waiter = requireWaiter();
      const target = shifts.find((s) => s.id === shiftId);
      if (!target) throw new Error('Turno no encontrado.');
      if (target.status !== 'abierto') {
        throw new Error('Este turno ya fue cerrado.');
      }
      if (!Number.isFinite(declaredClosingBase) || declaredClosingBase < 0) {
        throw new Error('Ingresa un valor válido para la base que quedó en caja.');
      }

      const evaluation = evaluateShiftClose({
        orders,
        movements,
        openedAtMs: target.openedAtMs,
        closedAtMs: Date.now(),
        openingBaseAmount: target.openingBaseAmount,
        declaredClosingBase,
        declaredByMethod,
      });

      const path = `workspaces/${SHARED_WORKSPACE_ID}/shifts/${shiftId}`;
      try {
        await updateDoc(doc(db!, path), {
          status: 'cerrado',
          closedByStaffId: waiter.id,
          closedByName: waiter.name.slice(0, 80),
          closedByUid: actorUid,
          closingNote: closingNote.trim().slice(0, 300),
          usedPaymentMethods: evaluation.usedPaymentMethods,
          declaredClosingBase: evaluation.declaredClosingBase,
          declaredByMethod: evaluation.declaredByMethod,
          expectedBaseAmount: evaluation.expectedBaseAmount,
          expectedByMethod: evaluation.expectedByMethod,
          expectedTotal: evaluation.expectedTotal,
          declaredTotal: evaluation.declaredTotal,
          differenceTotal: evaluation.differenceTotal,
          paidOrdersCount: evaluation.paidOrdersCount,
          pendingOrdersCount: evaluation.pendingOrdersCount,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [permissions.canManageShifts, requireCloud, requireWaiter, shifts, orders, movements, actorUid]
  );

  const deleteShiftRecord = useCallback(
    async (shiftId: string) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/shifts/${shiftId}`;
      try {
        await deleteDoc(doc(db!, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud]
  );

  const value: PosContextValue = {
    sessionMode,
    authReady,
    firebaseUser,
    isFirebaseConfigured,
    configSource,
    cloudError,
    loadingData,
    identityReady,

    effectiveRole,
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
    shifts,
    openShift,
    customers,
    billingConfig,

    activeWaiter,
    myLinkedStaff,

    emailVerified: emailVerifiedState,
    verificationNotice,
    clearVerificationNotice,

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
    toggleStaffActive,
    deleteStaffMember,
    updateAuthorizedEmails,
    updateAllowSelfRegistration,
    saveBillingConfig,
    upsertCustomer,
    deleteCustomerRecord,
    openCashShift,
    closeCashShift,
    deleteShiftRecord,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export function usePosStore(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePosStore must be used inside PosProvider');
  return ctx;
}
