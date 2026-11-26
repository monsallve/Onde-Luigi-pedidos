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
  increment,
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
  ExpenseLineKind,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  InventoryUnit,
  Movement,
  MovementType,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  RecipeIngredientSpec,
  Sauce,
  SelfServicePaymentConfig,
  Shift,
  StaffMember,
  StaffRole,
  TrackedPaymentMethod,
  TransferReceipt,
  WorkspaceNotification,
  WorkspaceNotificationType,
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
  hasDuplicateProductName,
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
import {
  buildInventoryItemId,
  buildUnifiedInventoryPlan,
  calculatePurchaseUnitCost,
  computeInventoryDeltas,
  computeOrderInventoryConsumption,
  hasDuplicateInventoryName,
  normalizeIngredientKey,
  roundStockQty,
  splitProductRecipeFromSpecs,
} from '../utils/inventoryMath';
import { evaluateShiftClose } from '../utils/shiftMath';
import {
  aggregateInventoriablePurchases,
  buildNotificationCopy,
  calculateInvoiceTotals,
  mergeWorkspaceNotifications,
  normalizeInvoiceLine,
  validatePurchaseInvoiceDraft,
} from '../utils/purchaseExpenseMath';
import {
  DEFAULT_SELF_SERVICE_CONFIG,
  normalizeSelfServiceConfig,
} from '../utils/selfServiceMath';
import {
  type ReceiptUploadResult,
  uploadProductImage,
  uploadStorefrontQrImage,
  uploadTransferReceiptImage,
} from './storageService';
import {
  mapCustomerDoc,
  mapInventoryItemDoc,
  mapInventoryMovementDoc,
  mapMovementDoc,
  mapNotificationDoc,
  mapOrderDoc,
  mapProductDoc,
  mapPurchaseInvoiceDoc,
  mapSauceDoc,
  mapSelfOrderDoc,
  mapShiftDoc,
  mapStaffDoc,
  mapTransferDoc,
  resolveOrBootstrapCloudWorkspace,
  SHARED_WORKSPACE_ID,
  stripClientTimestamps,
  syncPublicStorefrontCatalog,
  toPublicProductPayload,
  toPublicSaucePayload,
} from './workspaceSync';

const ACTIVE_WAITER_STORAGE_KEY = 'ondeluigi_active_waiter_v2';
const CYCLIC_REF_COUNTER_KEY = 'ondeluigi_cyclic_ref_counter_v1';

export interface OrderCustomerInput {
  id?: string;
  documentNumber?: string;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface RegisterBulkPurchaseInput {
  receiptCode: string;
  supplier: OrderCustomerInput;
  paymentMethod: string;
  notes?: string;
  lines: Array<{
    id?: string;
    kind: ExpenseLineKind;
    description: string;
    inventoryItemId?: string;
    unit?: InventoryUnit;
    quantity: number;
    totalCost: number;
  }>;
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
  recipeIngredients?: RecipeIngredientSpec[];
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
  selfServiceConfig: SelfServicePaymentConfig;
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  notifications: WorkspaceNotification[];
  notificationsLoaded: boolean;
  purchaseInvoices: PurchaseInvoice[];

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
  saveSelfServiceConfig: (config: SelfServicePaymentConfig) => Promise<void>;
  uploadPaymentQrImage: (file: File) => Promise<ReceiptUploadResult>;
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

  saveInventoryItem: (input: {
    id?: string;
    name: string;
    unit: InventoryUnit;
    minStock?: number;
    initialQuantity?: number;
    initialTotalCost?: number;
    active?: boolean;
  }) => Promise<InventoryItem>;
  registerInventoryPurchase: (params: {
    inventoryItemId: string;
    quantity: number;
    totalCost: number;
    notes?: string;
  }) => Promise<void>;
  adjustInventoryStock: (params: {
    inventoryItemId: string;
    newStock: number;
    notes?: string;
  }) => Promise<void>;
  deleteInventoryItem: (inventoryItemId: string) => Promise<void>;
  mergeInventoryItems: (sourceId: string, targetId: string) => Promise<void>;
  unifyCatalogInventory: () => Promise<{ createdCount: number; updatedProductsCount: number }>;
  registerBulkPurchaseInvoice: (input: RegisterBulkPurchaseInput) => Promise<PurchaseInvoice>;
  deletePurchaseInvoice: (invoiceId: string) => Promise<void>;
  deleteWorkspaceNotification: (notifId: string) => Promise<void>;
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
  const [posOrders, setPosOrders] = useState<Order[]>([]);
  const [posOrdersLoaded, setPosOrdersLoaded] = useState(false);
  const [selfServiceOrders, setSelfServiceOrders] = useState<Order[]>([]);
  const [selfOrdersLoaded, setSelfOrdersLoaded] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [posTransfers, setPosTransfers] = useState<TransferReceipt[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [billingConfig, setBillingConfig] = useState<BusinessBillingConfig>(DEFAULT_BILLING_CONFIG);
  const [selfServiceConfig, setSelfServiceConfig] = useState<SelfServicePaymentConfig>(
    DEFAULT_SELF_SERVICE_CONFIG
  );
  const [publicStorefrontExists, setPublicStorefrontExists] = useState(false);
  const [publicStorefrontChecked, setPublicStorefrontChecked] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [posNotifications, setPosNotifications] = useState<WorkspaceNotification[]>([]);
  const [posNotificationsLoaded, setPosNotificationsLoaded] = useState(false);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const autoUnifyTriggeredRef = useRef(false);
  const autoStorefrontSyncRef = useRef(false);

  const orders = useMemo(() => {
    const promotedIds = new Set(posOrders.map((o) => o.id));
    const pendingSelf = selfServiceOrders.filter((s) => !promotedIds.has(s.id));
    return [...posOrders, ...pendingSelf].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  }, [posOrders, selfServiceOrders]);

  const transfers = useMemo(() => {
    const realIds = new Set(posTransfers.map((t) => t.id));
    const syntheticSelf: TransferReceipt[] = selfServiceOrders
      .filter((s) => s.receiptCount > 0 && Boolean(s.latestReceiptUrl) && !realIds.has(`tr_self_${s.id}`))
      .map((s) => ({
        id: `tr_self_${s.id}`,
        orderId: s.id,
        orderNumber: s.orderNumber,
        orderReference: s.reference,
        amount: s.total,
        imageUrl: s.latestReceiptUrl,
        storagePath: s.receiptStoragePath || '',
        waiterId: 'autoservicio',
        waiterName: s.deliveryType === 'domicilio' ? 'Autoservicio · Domicilio' : 'Autoservicio · Local',
        paymentStatus: s.paymentStatus,
        notes: s.notes || (s.deliveryType === 'domicilio' ? `Domicilio: ${s.deliveryAddress}` : 'Recoger en local'),
        ownerUid: s.ownerUid,
        createdByUid: s.createdByUid || 'autoservicio_public',
        allowedEmails: authorizedEmails,
        createdAtMs: s.createdAtMs,
      }));
    return [...posTransfers, ...syntheticSelf].sort(
      (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
  }, [posTransfers, selfServiceOrders, authorizedEmails]);

  const notifications = useMemo(
    () =>
      mergeWorkspaceNotifications({
        persistedNotifications: posNotifications,
        posOrders,
        selfServiceOrders,
        shifts,
        authorizedEmails,
      }),
    [posNotifications, posOrders, selfServiceOrders, shifts, authorizedEmails]
  );

  const notificationsLoaded =
    posNotificationsLoaded && selfOrdersLoaded && posOrdersLoaded && shiftsLoaded;

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
        setPosOrdersLoaded(false);
        setShiftsLoaded(false);
        setPosNotificationsLoaded(false);
        setSelfOrdersLoaded(false);
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
    setInventoryLoaded(false);
    setPosOrdersLoaded(false);
    setShiftsLoaded(false);
    setPosNotificationsLoaded(false);
    setSelfOrdersLoaded(false);
    setPublicStorefrontChecked(false);
    autoUnifyTriggeredRef.current = false;
    autoStorefrontSyncRef.current = false;
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
        setSelfServiceConfig(wsInfo.selfServiceConfig);
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
                selfServiceConfig?: Partial<SelfServicePaymentConfig>;
              };
              setWorkspaceOwnerUid(d.ownerUid);
              if (Array.isArray(d.authorizedEmails)) {
                setAuthorizedEmails(d.authorizedEmails.map((e) => e.toLowerCase()));
              }
              if (d.billingConfig) {
                setBillingConfig(normalizeBillingConfig(d.billingConfig));
              }
              if (d.selfServiceConfig) {
                setSelfServiceConfig(normalizeSelfServiceConfig(d.selfServiceConfig));
              }
            },
            (err) => handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`)
          ),
          onSnapshot(
            doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID),
            (snap) => {
              if (cancelled) return;
              setPublicStorefrontExists(snap.exists());
              setPublicStorefrontChecked(true);
            },
            () => {
              if (!cancelled) setPublicStorefrontChecked(true);
            }
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
                if (subName === 'inventory') setInventoryLoaded(true);
                if (subName === 'orders') setPosOrdersLoaded(true);
                if (subName === 'shifts') setShiftsLoaded(true);
                if (subName === 'notifications') setPosNotificationsLoaded(true);
                loadedCollections.add(subName);
                if (REQUIRED_COLLECTIONS.every((c) => loadedCollections.has(c))) {
                  setLoadingData(false);
                }
              },
              (err) => {
                setCloudError(err instanceof Error ? err.message : `Error al cargar ${subName}`);
                setStaffLoaded(true);
                if (subName === 'orders') setPosOrdersLoaded(true);
                if (subName === 'shifts') setShiftsLoaded(true);
                if (subName === 'notifications') setPosNotificationsLoaded(true);
                setLoadingData(false);
                handleFirestoreError(err, OperationType.LIST, path);
              }
            )
          );
        };

        listenSubCollection<StaffMember>('staff', (d, id) => mapStaffDoc(d, id), setStaff, false);
        listenSubCollection<Sauce>('sauces', (d) => mapSauceDoc(d), setSauces, false);
        listenSubCollection<Product>('products', (d) => mapProductDoc(d), setProducts, false);
        listenSubCollection<Order>('orders', (d) => mapOrderDoc(d), setPosOrders, true);
        listenSubCollection<Movement>('movements', (d) => mapMovementDoc(d), setMovements, true);
        listenSubCollection<TransferReceipt>('transfers', (d) => mapTransferDoc(d), setPosTransfers, true);
        listenSubCollection<Shift>('shifts', (d, id) => mapShiftDoc(d, id), setShifts, true);
        listenSubCollection<Customer>('customers', (d, id) => mapCustomerDoc(d, id), setCustomers, false);
        listenSubCollection<InventoryItem>('inventory', (d, id) => mapInventoryItemDoc(d, id), setInventory, false);
        listenSubCollection<InventoryMovement>(
          'inventoryMovements',
          (d, id) => mapInventoryMovementDoc(d, id),
          setInventoryMovements,
          true
        );
        listenSubCollection<WorkspaceNotification>(
          'notifications',
          (d, id) => mapNotificationDoc(d, id),
          setPosNotifications,
          true
        );
        listenSubCollection<PurchaseInvoice>(
          'purchaseInvoices',
          (d, id) => mapPurchaseInvoiceDoc(d, id),
          setPurchaseInvoices,
          true
        );

        unsubs.push(
          onSnapshot(
            query(
              collection(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/selfOrders`),
              where('ownerUid', '==', wsInfo.ownerUid)
            ),
            (snapshot) => {
              if (cancelled) return;
              const list = snapshot.docs.map((d) => mapSelfOrderDoc(d.data(), d.id));
              list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
              setSelfServiceOrders(list);
              setSelfOrdersLoaded(true);
            },
            () => {
              if (!cancelled) setSelfOrdersLoaded(true);
            }
          )
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
    setPosOrders([]);
    setPosOrdersLoaded(false);
    setSelfServiceOrders([]);
    setSelfOrdersLoaded(false);
    setMovements([]);
    setPosTransfers([]);
    setShifts([]);
    setShiftsLoaded(false);
    setCustomers([]);
    setInventory([]);
    setInventoryMovements([]);
    setInventoryLoaded(false);
    setPosNotifications([]);
    setPosNotificationsLoaded(false);
    setPurchaseInvoices([]);
    setPublicStorefrontExists(false);
    setPublicStorefrontChecked(false);
    autoUnifyTriggeredRef.current = false;
    autoStorefrontSyncRef.current = false;
    setBillingConfig(DEFAULT_BILLING_CONFIG);
    setSelfServiceConfig(DEFAULT_SELF_SERVICE_CONFIG);
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

  const buildInventoryMovementRecord = useCallback(
    (params: {
      inventoryItemId: string;
      ingredientName: string;
      unit: InventoryUnit;
      type: InventoryMovementType;
      quantityDelta: number;
      purchaseTotalCost?: number;
      calculatedUnitCost?: number;
      orderId?: string;
      orderNumber?: number;
      notes?: string;
    }): InventoryMovement => {
      const safeActorName =
        (activeWaiter?.name || firebaseUser?.displayName || actorEmail || 'Sistema')
          .trim()
          .slice(0, 80) || 'Sistema';
      return {
        id: createSafeId('imov'),
        inventoryItemId: params.inventoryItemId,
        ingredientName: params.ingredientName.trim().slice(0, 80) || 'Ingrediente',
        unit: params.unit,
        type: params.type,
        quantityDelta: roundStockQty(params.quantityDelta),
        purchaseTotalCost: Math.max(0, Math.round(params.purchaseTotalCost || 0)),
        calculatedUnitCost: Math.max(0, params.calculatedUnitCost || 0),
        orderId: (params.orderId || '').slice(0, 128),
        orderNumber: Math.max(0, Math.round(params.orderNumber || 0)),
        notes: (params.notes || '').trim().slice(0, 300),
        actorName: safeActorName,
        actorUid,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: Date.now(),
      };
    },
    [activeWaiter?.name, firebaseUser?.displayName, actorEmail, actorUid, workspaceOwnerUid, authorizedEmails]
  );

  const appendOrderInventoryBatchOps = useCallback(
    (
      batch: ReturnType<typeof writeBatch>,
      deltas: Record<string, number>,
      type: 'consumo_pedido' | 'edicion_pedido' | 'anulacion_pedido',
      orderId: string,
      orderNumber: number,
      notes: string
    ) => {
      const invMap = new Map(inventory.map((i) => [i.id, i]));
      for (const [invId, rawDelta] of Object.entries(deltas)) {
        const item = invMap.get(invId);
        const delta = roundStockQty(rawDelta);
        if (!item || delta === 0) continue;
        batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventory/${invId}`), {
          currentStock: increment(delta),
          updatedAt: serverTimestamp(),
        });
        const invMov = buildInventoryMovementRecord({
          inventoryItemId: invId,
          ingredientName: item.name,
          unit: item.unit,
          type,
          quantityDelta: delta,
          orderId,
          orderNumber,
          notes,
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${invMov.id}`), {
          ...stripClientTimestamps(invMov),
          createdAt: serverTimestamp(),
        });
      }
    },
    [inventory, buildInventoryMovementRecord]
  );

  const appendWorkspaceNotification = useCallback(
    (
      batch: ReturnType<typeof writeBatch>,
      params: {
        type: WorkspaceNotificationType;
        orderId?: string;
        orderNumber?: number;
        orderReference?: string;
        shiftId?: string;
        total?: number;
        openingBaseAmount?: number;
        paidOrdersCount?: number;
        wasPaidOrder?: boolean;
        reason?: string;
      }
    ) => {
      const safeActorName =
        (activeWaiter?.name || firebaseUser?.displayName || actorEmail || 'Equipo')
          .trim()
          .slice(0, 80) || 'Equipo';
      const copy = buildNotificationCopy({
        type: params.type,
        actorName: safeActorName,
        orderNumber: params.orderNumber,
        orderReference: params.orderReference,
        total: params.total,
        openingBaseAmount: params.openingBaseAmount,
        paidOrdersCount: params.paidOrdersCount,
        wasPaidOrder: params.wasPaidOrder,
        reason: params.reason,
      });
      const notifId = createSafeId('notif');
      batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/notifications/${notifId}`), {
        id: notifId,
        type: params.type,
        title: copy.title,
        message: copy.message,
        orderId: (params.orderId || '').slice(0, 128),
        orderNumber: Math.max(0, Math.round(params.orderNumber || 0)),
        shiftId: (params.shiftId || '').slice(0, 128),
        actorName: safeActorName,
        actorUid,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAt: serverTimestamp(),
      });
    },
    [activeWaiter?.name, firebaseUser?.displayName, actorEmail, actorUid, workspaceOwnerUid, authorizedEmails]
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
      const customerNotes = (customer?.notes || '').trim().slice(0, 300);

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
            notes: customerNotes || String(prev.notes || ''),
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
            notes: customerNotes,
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

      const rawConsumed = computeOrderInventoryConsumption(input.items, products);
      const existingInvIds = new Set(inventory.map((i) => i.id));
      const inventoryDeducted: Record<string, number> = {};
      for (const [invId, qty] of Object.entries(rawConsumed)) {
        if (existingInvIds.has(invId) && qty > 0) {
          inventoryDeducted[invId] = qty;
        }
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
        inventoryDeducted,
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
        appendOrderInventoryBatchOps(
          batch,
          computeInventoryDeltas({}, inventoryDeducted),
          'consumo_pedido',
          orderId,
          orderNumber,
          `Pedido #${orderNumber} · ${resolvedReference}`
        );
        appendWorkspaceNotification(batch, {
          type: 'nueva_comanda',
          orderId,
          orderNumber,
          orderReference: resolvedReference,
          total,
        });
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
      products,
      inventory,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
      appendOrderInventoryBatchOps,
      appendWorkspaceNotification,
    ]
  );

  const upsertOrderInBatch = useCallback(
    (
      batch: ReturnType<typeof writeBatch>,
      target: Order,
      patch: Record<string, unknown>,
      waiter: StaffMember,
      options?: { skipInitialSelfTransfer?: boolean }
    ) => {
      const orderRef = doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/orders/${target.id}`);
      const isAlreadyPosOrder = posOrders.some((o) => o.id === target.id);
      if (isAlreadyPosOrder) {
        batch.update(orderRef, patch);
        return;
      }

      const promotedPayload = {
        ...stripClientTimestamps(target),
        waiterId: waiter.id,
        waiterName: waiter.name,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        ...patch,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(orderRef, promotedPayload);

      if (
        !options?.skipInitialSelfTransfer &&
        target.source === 'autoservicio' &&
        target.latestReceiptUrl &&
        !posTransfers.some((t) => t.id === `tr_self_${target.id}`)
      ) {
        const transferId = `tr_self_${target.id}`;
        const transferPayStatus: PaymentStatus =
          patch.paymentStatus === 'pagado' || target.paymentStatus === 'pagado'
            ? 'pagado'
            : 'pendiente';
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`), {
          id: transferId,
          orderId: target.id,
          orderNumber: target.orderNumber,
          orderReference: String(patch.reference || target.reference).slice(0, 100),
          amount: Number(patch.total ?? target.total) || 0,
          imageUrl: target.latestReceiptUrl,
          storagePath: target.receiptStoragePath || '',
          waiterId: waiter.id,
          waiterName:
            target.deliveryType === 'domicilio' ? 'Autoservicio · Domicilio' : 'Autoservicio · Local',
          paymentStatus: transferPayStatus,
          notes: (
            target.notes ||
            (target.deliveryType === 'domicilio'
              ? `Domicilio: ${target.deliveryAddress || ''}`
              : 'Recoger en local')
          ).slice(0, 300),
          ownerUid: workspaceOwnerUid,
          createdByUid: actorUid,
          allowedEmails: authorizedEmails,
          createdAt: serverTimestamp(),
        });
      }
    },
    [posOrders, posTransfers, workspaceOwnerUid, actorUid, authorizedEmails]
  );

  const appendSelfOrderMirrorOps = useCallback(
    (
      batch: ReturnType<typeof writeBatch>,
      target: Order,
      overrides: {
        status?: OrderStatus;
        paymentStatus?: PaymentStatus;
        items?: OrderItem[];
        subtotal?: number;
        total?: number;
        reference?: string;
        notes?: string;
        receiptCount?: number;
        latestReceiptUrl?: string;
        voidReason?: string;
        voidedByName?: string;
        voidedAtMs?: number;
      }
    ) => {
      if (!selfServiceOrders.some((s) => s.id === target.id)) return;
      const nextStatus = overrides.status ?? target.status;
      const selfRef = doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/selfOrders/${target.id}`);
      const queueRef = doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/queueTickets/${target.id}`);

      const selfUpdate: Record<string, unknown> = {
        status: nextStatus,
        paymentStatus: overrides.paymentStatus ?? target.paymentStatus,
        updatedAt: serverTimestamp(),
      };
      if (overrides.items !== undefined) selfUpdate.items = overrides.items;
      if (overrides.subtotal !== undefined) selfUpdate.subtotal = overrides.subtotal;
      if (overrides.total !== undefined) selfUpdate.total = overrides.total;
      if (overrides.reference !== undefined) selfUpdate.reference = overrides.reference;
      if (overrides.notes !== undefined) selfUpdate.notes = overrides.notes;
      if (overrides.receiptCount !== undefined) selfUpdate.receiptCount = overrides.receiptCount;
      if (overrides.latestReceiptUrl !== undefined) {
        selfUpdate.latestReceiptUrl = overrides.latestReceiptUrl;
      }
      if (overrides.voidReason !== undefined) selfUpdate.voidReason = overrides.voidReason;
      if (overrides.voidedByName !== undefined) selfUpdate.voidedByName = overrides.voidedByName;
      if (overrides.voidedAtMs !== undefined) selfUpdate.voidedAtMs = overrides.voidedAtMs;

      batch.update(selfRef, selfUpdate);
      batch.update(queueRef, {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    },
    [selfServiceOrders]
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
      const unDeductedSelfOrder =
        target.source === 'autoservicio' &&
        target.status === 'pendiente_validacion' &&
        !target.inventoryDeducted;
      const prevDeducted = unDeductedSelfOrder
        ? {}
        : target.inventoryDeducted ?? computeOrderInventoryConsumption(target.items, products);
      const rawNextDeducted = computeOrderInventoryConsumption(nextItems, products);
      const existingInvIds = new Set(inventory.map((i) => i.id));
      const nextDeducted: Record<string, number> = {};
      if (!unDeductedSelfOrder) {
        for (const [invId, qty] of Object.entries(rawNextDeducted)) {
          if (existingInvIds.has(invId) && qty > 0) {
            nextDeducted[invId] = qty;
          }
        }
      }
      const invDeltas = computeInventoryDeltas(prevDeducted, nextDeducted);

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
        upsertOrderInBatch(
          batch,
          target,
          {
            items: nextItems,
            subtotal,
            total,
            reference: cleanRef,
            notes: cleanNotes,
            inventoryDeducted: nextDeducted,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          },
          waiter
        );
        appendSelfOrderMirrorOps(batch, target, {
          items: nextItems,
          subtotal,
          total,
          reference: cleanRef,
          notes: cleanNotes,
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        appendOrderInventoryBatchOps(
          batch,
          invDeltas,
          'edicion_pedido',
          target.id,
          target.orderNumber,
          `Edición pedido #${target.orderNumber}`
        );
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [
      permissions.canEditOrders,
      requireCloud,
      requireWaiter,
      orders,
      products,
      inventory,
      buildMovementRecord,
      appendOrderInventoryBatchOps,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
    ]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, nextStatus: OrderStatus) => {
      const target = orders.find((o) => o.id === orderId);
      if (nextStatus === 'tomado') {
        if (!permissions.canManagePayments && !permissions.canAdvanceKitchen) {
          throw new Error('Tu rol actual no tiene permiso para validar pedidos de autoservicio.');
        }
      }
      if ((nextStatus === 'preparacion' || nextStatus === 'listo') && !permissions.canAdvanceKitchen) {
        if (!(target?.status === 'pendiente_validacion' && permissions.canManagePayments)) {
          throw new Error('Tu rol actual no tiene permiso para avanzar preparación en cocina.');
        }
      }
      if (nextStatus === 'entregado' && !permissions.canDeliverOrders) {
        throw new Error('Tu rol actual no tiene permiso para marcar pedidos como entregados.');
      }
      requireCloud();
      const waiter = requireWaiter();
      if (!target) throw new Error('Pedido no encontrado.');
      if (target.status === nextStatus) return;

      const shouldDeductNow =
        target.source === 'autoservicio' &&
        target.status === 'pendiente_validacion' &&
        nextStatus !== 'cancelado' &&
        !target.inventoryDeducted;

      let nextDeducted: Record<string, number> | undefined;
      let invDeltas: Record<string, number> = {};
      if (shouldDeductNow) {
        const rawConsumed = computeOrderInventoryConsumption(target.items, products);
        const existingInvIds = new Set(inventory.map((i) => i.id));
        nextDeducted = {};
        for (const [invId, qty] of Object.entries(rawConsumed)) {
          if (existingInvIds.has(invId) && qty > 0) {
            nextDeducted[invId] = qty;
          }
        }
        invDeltas = computeInventoryDeltas({}, nextDeducted);
      }

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
        upsertOrderInBatch(
          batch,
          target,
          {
            status: nextStatus,
            ...(nextDeducted !== undefined ? { inventoryDeducted: nextDeducted } : {}),
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          },
          waiter
        );
        appendSelfOrderMirrorOps(batch, target, { status: nextStatus });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        if (shouldDeductNow) {
          appendOrderInventoryBatchOps(
            batch,
            invDeltas,
            'consumo_pedido',
            target.id,
            target.orderNumber,
            `Autoservicio #${target.orderNumber} · ${target.reference}`
          );
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [
      permissions.canManagePayments,
      permissions.canAdvanceKitchen,
      permissions.canDeliverOrders,
      requireCloud,
      requireWaiter,
      orders,
      products,
      inventory,
      buildMovementRecord,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
      appendOrderInventoryBatchOps,
    ]
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
      const wasUndeductedSelf =
        target.source === 'autoservicio' &&
        target.status === 'pendiente_validacion' &&
        !target.inventoryDeducted;
      const prevDeducted = wasUndeductedSelf
        ? {}
        : target.inventoryDeducted ?? computeOrderInventoryConsumption(target.items, products);
      const restoreDeltas = computeInventoryDeltas(prevDeducted, {});

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
        upsertOrderInBatch(
          batch,
          target,
          {
            status: 'cancelado',
            inventoryDeducted: {},
            voidReason: cleanReason,
            voidedByName: waiter.name.slice(0, 80),
            voidedAtMs: now,
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          },
          waiter,
          { skipInitialSelfTransfer: wasUndeductedSelf }
        );
        appendSelfOrderMirrorOps(batch, target, {
          status: 'cancelado',
          voidReason: cleanReason,
          voidedByName: waiter.name.slice(0, 80),
          voidedAtMs: now,
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        appendOrderInventoryBatchOps(
          batch,
          restoreDeltas,
          'anulacion_pedido',
          target.id,
          target.orderNumber,
          `Anulación pedido #${target.orderNumber}${cleanReason ? ` · ${cleanReason}` : ''}`
        );
        appendWorkspaceNotification(batch, {
          type: 'venta_anulada',
          orderId: target.id,
          orderNumber: target.orderNumber,
          orderReference: target.reference,
          wasPaidOrder: target.paymentStatus === 'pagado',
          reason: cleanReason,
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, orderPath);
      }
    },
    [
      permissions.canVoidOrders,
      requireCloud,
      requireWaiter,
      orders,
      products,
      buildMovementRecord,
      appendOrderInventoryBatchOps,
      appendWorkspaceNotification,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
    ]
  );

  const deleteOrderRecord = useCallback(
    async (orderId: string) => {
      requireAdmin();
      requireCloud();
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      const inPosOrders = posOrders.some((o) => o.id === orderId);
      const inSelfOrders = selfServiceOrders.some((s) => s.id === orderId);
      const wasUndeductedSelf =
        target.source === 'autoservicio' &&
        target.status === 'pendiente_validacion' &&
        !target.inventoryDeducted;

      try {
        const batch = writeBatch(db!);
        if (target.status !== 'cancelado' && !wasUndeductedSelf) {
          const prevDeducted =
            target.inventoryDeducted ?? computeOrderInventoryConsumption(target.items, products);
          const restoreDeltas = computeInventoryDeltas(prevDeducted, {});
          appendOrderInventoryBatchOps(
            batch,
            restoreDeltas,
            'anulacion_pedido',
            target.id,
            target.orderNumber,
            `Eliminación de pedido #${target.orderNumber}`
          );
        }
        if (inPosOrders) {
          batch.delete(doc(db!, orderPath));
        }
        if (inSelfOrders) {
          batch.delete(doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/selfOrders/${orderId}`));
          batch.delete(doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/queueTickets/${orderId}`));
        }
        for (const mov of movements.filter((m) => m.orderId === orderId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`));
        }
        for (const tr of posTransfers.filter((t) => t.orderId === orderId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${tr.id}`));
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, orderPath);
      }
    },
    [
      requireAdmin,
      requireCloud,
      orders,
      posOrders,
      selfServiceOrders,
      products,
      movements,
      posTransfers,
      appendOrderInventoryBatchOps,
    ]
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

      const shouldAutoConfirmSelf =
        target.source === 'autoservicio' &&
        target.status === 'pendiente_validacion' &&
        paymentStatus === 'pagado';
      const nextStatus: OrderStatus = shouldAutoConfirmSelf ? 'tomado' : target.status;

      let nextDeducted: Record<string, number> | undefined;
      let invDeltas: Record<string, number> = {};
      if (shouldAutoConfirmSelf && !target.inventoryDeducted) {
        const rawConsumed = computeOrderInventoryConsumption(target.items, products);
        const existingInvIds = new Set(inventory.map((i) => i.id));
        nextDeducted = {};
        for (const [invId, qty] of Object.entries(rawConsumed)) {
          if (existingInvIds.has(invId) && qty > 0) {
            nextDeducted[invId] = qty;
          }
        }
        invDeltas = computeInventoryDeltas({}, nextDeducted);
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

      const nextReceiptCount = target.receiptCount + (newReceipt ? 1 : 0);
      const nextReceiptUrl = newReceipt ? newReceipt.imageUrl : target.latestReceiptUrl;

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        upsertOrderInBatch(
          batch,
          target,
          {
            status: nextStatus,
            paymentStatus,
            paymentMethod,
            receiptCount: nextReceiptCount,
            latestReceiptUrl: nextReceiptUrl,
            ...(nextDeducted !== undefined ? { inventoryDeducted: nextDeducted } : {}),
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
          },
          waiter
        );
        appendSelfOrderMirrorOps(batch, target, {
          status: nextStatus,
          paymentStatus,
          receiptCount: nextReceiptCount,
          latestReceiptUrl: nextReceiptUrl,
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
        for (const tr of posTransfers.filter((t) => t.orderId === orderId)) {
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${tr.id}`), {
            paymentStatus,
          });
        }
        if (shouldAutoConfirmSelf) {
          appendOrderInventoryBatchOps(
            batch,
            invDeltas,
            'consumo_pedido',
            target.id,
            target.orderNumber,
            `Autoservicio confirmado #${target.orderNumber} · ${target.reference}`
          );
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
      products,
      inventory,
      posTransfers,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
      appendOrderInventoryBatchOps,
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

      const shouldAutoConfirmSelf =
        target.source === 'autoservicio' && target.status === 'pendiente_validacion';
      const nextStatus: OrderStatus = shouldAutoConfirmSelf ? 'tomado' : target.status;

      let nextDeducted: Record<string, number> | undefined;
      let invDeltas: Record<string, number> = {};
      if (shouldAutoConfirmSelf && !target.inventoryDeducted) {
        const rawConsumed = computeOrderInventoryConsumption(target.items, products);
        const existingInvIds = new Set(inventory.map((i) => i.id));
        nextDeducted = {};
        for (const [invId, qty] of Object.entries(rawConsumed)) {
          if (existingInvIds.has(invId) && qty > 0) {
            nextDeducted[invId] = qty;
          }
        }
        invDeltas = computeInventoryDeltas({}, nextDeducted);
      }

      const mov = buildMovementRecord({
        order: target,
        type: 'comprobante',
        description: `Subió comprobante de transferencia por $${amount.toLocaleString('es-CO')}`,
        waiter,
        details: { transferId, amount },
        createdAtMs: now,
      });

      const nextReceiptCount = target.receiptCount + 1;

      const orderPath = `workspaces/${SHARED_WORKSPACE_ID}/orders/${orderId}`;
      try {
        const batch = writeBatch(db!);
        upsertOrderInBatch(
          batch,
          target,
          {
            status: nextStatus,
            paymentStatus: 'pagado',
            paymentMethod: 'transferencia',
            receiptCount: nextReceiptCount,
            latestReceiptUrl: uploadRes.imageUrl,
            ...(nextDeducted !== undefined ? { inventoryDeducted: nextDeducted } : {}),
            waiterId: waiter.id,
            waiterName: waiter.name,
            updatedAt: serverTimestamp(),
          },
          waiter
        );
        appendSelfOrderMirrorOps(batch, target, {
          status: nextStatus,
          paymentStatus: 'pagado',
          receiptCount: nextReceiptCount,
          latestReceiptUrl: uploadRes.imageUrl,
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`), {
          ...stripClientTimestamps(newTransfer),
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        if (shouldAutoConfirmSelf) {
          appendOrderInventoryBatchOps(
            batch,
            invDeltas,
            'consumo_pedido',
            target.id,
            target.orderNumber,
            `Autoservicio confirmado #${target.orderNumber} · ${target.reference}`
          );
        }
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
      products,
      inventory,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
      appendOrderInventoryBatchOps,
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
      const isPersistedTransfer = posTransfers.some((t) => t.id === transferId);
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
        if (parentOrder) {
          upsertOrderInBatch(
            batch,
            parentOrder,
            {
              receiptCount: remainingActive.length,
              latestReceiptUrl: remainingActive[0]?.imageUrl || '',
              waiterId: waiter.id,
              waiterName: waiter.name,
              updatedAt: serverTimestamp(),
            },
            waiter,
            { skipInitialSelfTransfer: !isPersistedTransfer }
          );
          appendSelfOrderMirrorOps(batch, parentOrder, {
            receiptCount: remainingActive.length,
            latestReceiptUrl: remainingActive[0]?.imageUrl || '',
          });
        }
        if (isPersistedTransfer) {
          batch.update(doc(db!, path), {
            annulled: true,
            annulledByName: waiter.name.slice(0, 80),
            annulledReason: cleanReason,
            annulledAtMs: now,
          });
        } else {
          batch.set(doc(db!, path), {
            ...stripClientTimestamps(target),
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            allowedEmails: authorizedEmails,
            annulled: true,
            annulledByName: waiter.name.slice(0, 80),
            annulledReason: cleanReason,
            annulledAtMs: now,
            createdAt: serverTimestamp(),
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
    [
      permissions.canVoidReceipts,
      requireCloud,
      requireWaiter,
      transfers,
      posTransfers,
      orders,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      buildMovementRecord,
      upsertOrderInBatch,
      appendSelfOrderMirrorOps,
    ]
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
      const isPersistedTransfer = posTransfers.some((t) => t.id === transferId);
      const path = `workspaces/${SHARED_WORKSPACE_ID}/transfers/${transferId}`;
      try {
        const batch = writeBatch(db!);
        if (isPersistedTransfer) {
          batch.delete(doc(db!, path));
        }
        for (const mov of movements.filter((m) => m.details && m.details.transferId === transferId)) {
          batch.delete(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/movements/${mov.id}`));
        }
        if (parentOrder) {
          if (posOrders.some((o) => o.id === parentOrder.id)) {
            batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/orders/${parentOrder.id}`), {
              receiptCount: remainingActive.length,
              latestReceiptUrl: remainingActive[0]?.imageUrl || '',
              updatedAt: serverTimestamp(),
            });
          }
          appendSelfOrderMirrorOps(batch, parentOrder, {
            receiptCount: remainingActive.length,
            latestReceiptUrl: remainingActive[0]?.imageUrl || '',
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [
      requireAdmin,
      requireCloud,
      transfers,
      posTransfers,
      orders,
      posOrders,
      movements,
      appendSelfOrderMirrorOps,
    ]
  );

  // Admin Menu mutations
  const setSubDocActive = useCallback(
    async (subCol: 'products' | 'sauces', id: string, active: boolean) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/${subCol}/${id}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, path), { active, updatedAt: serverTimestamp() });
        if (publicStorefrontExists) {
          const pubRef = doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/${subCol}/${id}`);
          if (subCol === 'products') {
            const prod = products.find((p) => p.id === id);
            if (prod) batch.set(pubRef, toPublicProductPayload({ ...prod, active }));
          } else {
            const sauce = sauces.find((s) => s.id === id);
            if (sauce) batch.set(pubRef, toPublicSaucePayload({ ...sauce, active }));
          }
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [requireAdmin, requireCloud, publicStorefrontExists, products, sauces]
  );

  const deleteSubDoc = useCallback(
    async (subCol: 'products' | 'sauces', id: string) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/${subCol}/${id}`;
      try {
        const batch = writeBatch(db!);
        batch.delete(doc(db!, path));
        if (publicStorefrontExists) {
          batch.delete(doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/${subCol}/${id}`));
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud, publicStorefrontExists]
  );

  const saveProduct = useCallback(
    async (input: SaveProductInput) => {
      requireAdmin();
      requireCloud();
      const cleanName = input.name.trim().replace(/\s+/g, ' ').slice(0, 100);
      if (!cleanName) throw new Error('El nombre del producto es obligatorio.');
      if (hasDuplicateProductName(cleanName, products, input.id)) {
        throw new Error(
          `Ya existe un producto llamado "${cleanName}". No pueden haber dos productos con el mismo nombre.`
        );
      }
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

      const resolvedSpecs = Array.isArray(input.recipeIngredients)
        ? splitProductRecipeFromSpecs(input.recipeIngredients)
        : null;

      const cleanAddons: AddonOption[] = input.addonOptions.slice(0, 30).map((ex) => ({
        id: ex.id,
        name: ex.name.trim().slice(0, 80),
        price: Math.max(0, Math.round(ex.price || 0)),
        allowMultiple: ex.allowMultiple !== false,
        ...(ex.inventoryItemId
          ? {
              inventoryItemId: ex.inventoryItemId,
              inventoryQuantity:
                Number.isFinite(ex.inventoryQuantity) && (ex.inventoryQuantity as number) > 0
                  ? roundStockQty(ex.inventoryQuantity as number)
                  : 0,
            }
          : {}),
      }));

      const payload = {
        name: cleanName,
        category: input.category.trim().replace(/\s+/g, ' ').slice(0, 60) || 'General',
        basePrice: Math.round(input.basePrice),
        imageUrl: resolvedImageUrl,
        baseRecipe: resolvedSpecs
          ? resolvedSpecs.baseRecipe
          : input.baseRecipe.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        removableOptions: resolvedSpecs
          ? resolvedSpecs.removableOptions
          : input.removableOptions.map((s) => s.trim()).filter(Boolean).slice(0, 30),
        recipeIngredients: resolvedSpecs
          ? resolvedSpecs.recipeIngredients
          : existing?.recipeIngredients || [],
        addonOptions: cleanAddons,
        allowSauces: input.allowSauces,
        minSauces: minS,
        maxSauces: maxS,
        active: input.active,
        allowedEmails: authorizedEmails,
        updatedAt: serverTimestamp(),
      };

      const path = `workspaces/${SHARED_WORKSPACE_ID}/products/${prodId}`;
      try {
        const batch = writeBatch(db!);
        if (existing) {
          batch.update(doc(db!, path), payload);
        } else {
          batch.set(doc(db!, path), {
            id: prodId,
            ...payload,
            ownerUid: workspaceOwnerUid,
            createdByUid: actorUid,
            createdAt: serverTimestamp(),
          });
        }
        if (publicStorefrontExists) {
          batch.set(
            doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/products/${prodId}`),
            toPublicProductPayload({
              id: prodId,
              name: payload.name,
              category: payload.category,
              basePrice: payload.basePrice,
              imageUrl: payload.imageUrl,
              baseRecipe: payload.baseRecipe,
              removableOptions: payload.removableOptions,
              addonOptions: cleanAddons,
              allowSauces: payload.allowSauces,
              minSauces: payload.minSauces,
              maxSauces: payload.maxSauces,
              active: payload.active,
            })
          );
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
      }
    },
    [
      requireAdmin,
      requireCloud,
      products,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      publicStorefrontExists,
    ]
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
        const batch = writeBatch(db!);
        if (existing) {
          batch.update(doc(db!, path), {
            name: cleanName,
            active,
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db!, path), {
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
        if (publicStorefrontExists) {
          batch.set(
            doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/sauces/${sauceId}`),
            toPublicSaucePayload({ id: sauceId, name: cleanName, active })
          );
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
      }
    },
    [
      requireAdmin,
      requireCloud,
      sauces,
      workspaceOwnerUid,
      actorUid,
      authorizedEmails,
      publicStorefrontExists,
    ]
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
        const batches: Array<ReturnType<typeof writeBatch>> = [];
        let currentBatch = writeBatch(db!);
        let opCount = 0;

        const enqueueUpdate = (
          ref: ReturnType<typeof doc>,
          data: Record<string, unknown>
        ) => {
          if (opCount >= 380) {
            batches.push(currentBatch);
            currentBatch = writeBatch(db!);
            opCount = 0;
          }
          currentBatch.update(ref, data);
          opCount += 1;
        };

        enqueueUpdate(doc(db!, wsPath), {
          authorizedEmails: cleanList,
          updatedAt: serverTimestamp(),
        });

        for (const colName of [
          'staff',
          'sauces',
          'products',
          'orders',
          'shifts',
          'customers',
          'inventory',
          'purchaseInvoices',
        ] as const) {
          const snap = await getDocs(
            query(
              collection(db!, `workspaces/${SHARED_WORKSPACE_ID}/${colName}`),
              where('ownerUid', '==', workspaceOwnerUid)
            )
          );
          snap.docs.forEach((d) => {
            enqueueUpdate(d.ref, {
              allowedEmails: cleanList,
              updatedAt: serverTimestamp(),
            });
          });
        }

        if (opCount > 0) batches.push(currentBatch);
        for (const b of batches) {
          await b.commit();
        }
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
        const batch = writeBatch(db!);
        batch.update(doc(db!, wsPath), {
          billingConfig: normalized,
          updatedAt: serverTimestamp(),
        });
        if (publicStorefrontExists) {
          batch.update(doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}`), {
            businessName: normalized.businessName.trim().slice(0, 120) || "O'NDE LUIGI",
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
        setBillingConfig(normalized);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, wsPath);
      }
    },
    [requireAdmin, requireCloud, publicStorefrontExists]
  );

  const uploadPaymentQrImage = useCallback(
    async (file: File): Promise<ReceiptUploadResult> => {
      requireAdmin();
      requireCloud();
      return uploadStorefrontQrImage({
        workspaceId: SHARED_WORKSPACE_ID,
        file,
      });
    },
    [requireAdmin, requireCloud]
  );

  const saveSelfServiceConfig = useCallback(
    async (config: SelfServicePaymentConfig) => {
      requireAdmin();
      requireCloud();
      if (!config.brebKey.trim()) {
        throw new Error('Ingresa la llave de Bre-B / cuenta antes de guardar.');
      }
      if (!config.accountHolder.trim()) {
        throw new Error('Ingresa el nombre del titular de la cuenta.');
      }
      if (!config.bankName.trim()) {
        throw new Error('Ingresa el banco o billetera digital.');
      }
      const normalized = normalizeSelfServiceConfig(config);
      const wsPath = `workspaces/${SHARED_WORKSPACE_ID}`;
      try {
        if (publicStorefrontExists) {
          const batch = writeBatch(db!);
          batch.update(doc(db!, wsPath), {
            selfServiceConfig: normalized,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}`), {
            id: SHARED_WORKSPACE_ID,
            businessName: billingConfig.businessName.trim().slice(0, 120) || "O'NDE LUIGI",
            ...normalized,
            ownerUid: workspaceOwnerUid,
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
        } else {
          await updateDoc(doc(db!, wsPath), {
            selfServiceConfig: normalized,
            updatedAt: serverTimestamp(),
          });
          await syncPublicStorefrontCatalog({
            ownerUid: workspaceOwnerUid,
            businessName: billingConfig.businessName,
            selfServiceConfig: normalized,
            products,
            sauces,
          });
          setPublicStorefrontExists(true);
        }
        setSelfServiceConfig(normalized);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, wsPath);
      }
    },
    [
      requireAdmin,
      requireCloud,
      publicStorefrontExists,
      billingConfig.businessName,
      workspaceOwnerUid,
      products,
      sauces,
    ]
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
        const batch = writeBatch(db!);
        batch.set(doc(db!, path), {
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
        appendWorkspaceNotification(batch, {
          type: 'turno_abierto',
          shiftId: newShift.id,
          openingBaseAmount: safeBase,
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }

      return newShift;
    },
    [
      permissions.canManageShifts,
      requireCloud,
      requireWaiter,
      shifts,
      actorUid,
      workspaceOwnerUid,
      authorizedEmails,
      appendWorkspaceNotification,
    ]
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
        const batch = writeBatch(db!);
        batch.update(doc(db!, path), {
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
        appendWorkspaceNotification(batch, {
          type: 'turno_cerrado',
          shiftId: target.id,
          paidOrdersCount: evaluation.paidOrdersCount,
          total: evaluation.expectedTotal,
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [
      permissions.canManageShifts,
      requireCloud,
      requireWaiter,
      shifts,
      orders,
      movements,
      actorUid,
      appendWorkspaceNotification,
    ]
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

  // Admin Inventory mutations
  const saveInventoryItem = useCallback(
    async (input: {
      id?: string;
      name: string;
      unit: InventoryUnit;
      minStock?: number;
      initialQuantity?: number;
      initialTotalCost?: number;
      active?: boolean;
    }): Promise<InventoryItem> => {
      requireAdmin();
      requireCloud();
      const cleanName = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!cleanName) throw new Error('El nombre del ingrediente es obligatorio.');
      const nameKey = normalizeIngredientKey(cleanName);
      if (!nameKey) throw new Error('El nombre del ingrediente es obligatorio.');
      if (hasDuplicateInventoryName(cleanName, inventory, input.id)) {
        throw new Error(
          `Ya existe un ingrediente llamado "${cleanName}" en el inventario. Usa o edita el existente.`
        );
      }

      const unit: InventoryUnit = input.unit === 'ud' ? 'ud' : 'g';
      const minStock =
        Number.isFinite(input.minStock) && (input.minStock as number) >= 0
          ? roundStockQty(input.minStock as number)
          : 0;
      const active = input.active !== undefined ? input.active : true;
      const existing = input.id ? inventory.find((i) => i.id === input.id) : undefined;
      const now = Date.now();

      if (existing) {
        const invPath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${existing.id}`;
        try {
          const batch = writeBatch(db!);
          batch.update(doc(db!, invPath), {
            name: cleanName,
            nameKey,
            unit,
            minStock,
            active,
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });

          if (existing.name !== cleanName || existing.unit !== unit) {
            for (const prod of products) {
              const specs = prod.recipeIngredients || [];
              if (!specs.some((s) => s.inventoryItemId === existing.id)) continue;
              const updatedSpecs = specs.map((s) =>
                s.inventoryItemId === existing.id ? { ...s, name: cleanName, unit } : s
              );
              const split = splitProductRecipeFromSpecs(updatedSpecs);
              batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/products/${prod.id}`), {
                baseRecipe: split.baseRecipe,
                removableOptions: split.removableOptions,
                recipeIngredients: split.recipeIngredients,
                updatedAt: serverTimestamp(),
              });
              if (publicStorefrontExists) {
                batch.set(
                  doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/products/${prod.id}`),
                  toPublicProductPayload({
                    ...prod,
                    baseRecipe: split.baseRecipe,
                    removableOptions: split.removableOptions,
                  })
                );
              }
            }
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, invPath);
        }

        return {
          ...existing,
          name: cleanName,
          nameKey,
          unit,
          minStock,
          active,
          updatedAtMs: now,
        };
      }

      let itemId = buildInventoryItemId(cleanName);
      if (inventory.some((i) => i.id === itemId)) {
        itemId = createSafeId('inv');
      }
      const initQty =
        Number.isFinite(input.initialQuantity) && (input.initialQuantity as number) > 0
          ? roundStockQty(input.initialQuantity as number)
          : 0;
      const initCost =
        Number.isFinite(input.initialTotalCost) && (input.initialTotalCost as number) >= 0
          ? Math.round(input.initialTotalCost as number)
          : 0;
      const calcUnitCost = initQty > 0 ? calculatePurchaseUnitCost(initQty, initCost) : 0;

      const created: InventoryItem = {
        id: itemId,
        name: cleanName,
        nameKey,
        unit,
        currentStock: initQty,
        minStock,
        unitCost: calcUnitCost,
        lastPurchaseQuantity: initQty,
        lastPurchaseTotalCost: initCost,
        active,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      const invPath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${itemId}`;
      try {
        const batch = writeBatch(db!);
        batch.set(doc(db!, invPath), {
          ...stripClientTimestamps(created),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (initQty > 0) {
          const initMov = buildInventoryMovementRecord({
            inventoryItemId: itemId,
            ingredientName: cleanName,
            unit,
            type: 'compra',
            quantityDelta: initQty,
            purchaseTotalCost: initCost,
            calculatedUnitCost: calcUnitCost,
            notes: `Compra inicial (${initQty} ${unit})`,
          });
          batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${initMov.id}`), {
            ...stripClientTimestamps(initMov),
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, invPath);
      }

      return created;
    },
    [
      requireAdmin,
      requireCloud,
      inventory,
      products,
      authorizedEmails,
      workspaceOwnerUid,
      actorUid,
      buildInventoryMovementRecord,
      publicStorefrontExists,
    ]
  );

  const registerInventoryPurchase = useCallback(
    async ({
      inventoryItemId,
      quantity,
      totalCost,
      notes = '',
    }: {
      inventoryItemId: string;
      quantity: number;
      totalCost: number;
      notes?: string;
    }) => {
      requireAdmin();
      requireCloud();
      const target = inventory.find((i) => i.id === inventoryItemId);
      if (!target) throw new Error('Ingrediente de inventario no encontrado.');
      const qty = roundStockQty(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Ingresa una cantidad comprada mayor a 0 (${target.unit}).`);
      }
      if (!Number.isFinite(totalCost) || totalCost < 0) {
        throw new Error('Ingresa un costo total válido.');
      }

      const safeCost = Math.round(totalCost);
      const calculatedUnitCost = calculatePurchaseUnitCost(qty, safeCost);
      const mov = buildInventoryMovementRecord({
        inventoryItemId: target.id,
        ingredientName: target.name,
        unit: target.unit,
        type: 'compra',
        quantityDelta: qty,
        purchaseTotalCost: safeCost,
        calculatedUnitCost,
        notes:
          notes.trim().slice(0, 300) ||
          `Compra de ${qty} ${target.unit} por $${safeCost.toLocaleString('es-CO')}`,
      });

      const invPath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${target.id}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, invPath), {
          currentStock: increment(qty),
          unitCost: calculatedUnitCost,
          lastPurchaseQuantity: qty,
          lastPurchaseTotalCost: safeCost,
          allowedEmails: authorizedEmails,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, invPath);
      }
    },
    [requireAdmin, requireCloud, inventory, authorizedEmails, buildInventoryMovementRecord]
  );

  const adjustInventoryStock = useCallback(
    async ({
      inventoryItemId,
      newStock,
      notes = '',
    }: {
      inventoryItemId: string;
      newStock: number;
      notes?: string;
    }) => {
      requireAdmin();
      requireCloud();
      const target = inventory.find((i) => i.id === inventoryItemId);
      if (!target) throw new Error('Ingrediente de inventario no encontrado.');
      if (!Number.isFinite(newStock) || newStock < -100000000 || newStock > 100000000) {
        throw new Error('Ingresa una cantidad válida para el inventario.');
      }

      const targetStock = roundStockQty(newStock);
      const delta = roundStockQty(targetStock - target.currentStock);
      const mov = buildInventoryMovementRecord({
        inventoryItemId: target.id,
        ingredientName: target.name,
        unit: target.unit,
        type: 'ajuste_manual',
        quantityDelta: delta,
        notes:
          notes.trim().slice(0, 300) ||
          `Ajuste manual de ${target.currentStock} a ${targetStock} ${target.unit}`,
      });

      const invPath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${target.id}`;
      try {
        const batch = writeBatch(db!);
        batch.update(doc(db!, invPath), {
          currentStock: targetStock,
          allowedEmails: authorizedEmails,
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, invPath);
      }
    },
    [requireAdmin, requireCloud, inventory, authorizedEmails, buildInventoryMovementRecord]
  );

  const deleteInventoryItem = useCallback(
    async (inventoryItemId: string) => {
      requireAdmin();
      requireCloud();
      const target = inventory.find((i) => i.id === inventoryItemId);
      if (!target) return;

      const invPath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${inventoryItemId}`;
      try {
        const batch = writeBatch(db!);
        batch.delete(doc(db!, invPath));
        for (const prod of products) {
          const specs = prod.recipeIngredients || [];
          const hasSpec = specs.some((s) => s.inventoryItemId === inventoryItemId);
          const hasAddon = (prod.addonOptions || []).some(
            (a) => a.inventoryItemId === inventoryItemId
          );
          if (!hasSpec && !hasAddon) continue;

          const nextSpecs = specs.filter((s) => s.inventoryItemId !== inventoryItemId);
          const split = splitProductRecipeFromSpecs(nextSpecs);
          const nextAddons = (prod.addonOptions || []).map((a) => {
            if (a.inventoryItemId !== inventoryItemId) return a;
            const { inventoryItemId: _i, inventoryQuantity: _q, ...rest } = a;
            return rest;
          });
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/products/${prod.id}`), {
            baseRecipe: split.baseRecipe,
            removableOptions: split.removableOptions,
            recipeIngredients: split.recipeIngredients,
            addonOptions: nextAddons,
            updatedAt: serverTimestamp(),
          });
          if (publicStorefrontExists) {
            batch.set(
              doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/products/${prod.id}`),
              toPublicProductPayload({
                ...prod,
                baseRecipe: split.baseRecipe,
                removableOptions: split.removableOptions,
                addonOptions: nextAddons,
              })
            );
          }
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, invPath);
      }
    },
    [requireAdmin, requireCloud, inventory, products, publicStorefrontExists]
  );

  const mergeInventoryItems = useCallback(
    async (sourceId: string, targetId: string) => {
      requireAdmin();
      requireCloud();
      if (sourceId === targetId) {
        throw new Error('Selecciona un ingrediente destino distinto para fusionar.');
      }
      const source = inventory.find((i) => i.id === sourceId);
      const target = inventory.find((i) => i.id === targetId);
      if (!source || !target) {
        throw new Error('No se encontraron ambos ingredientes para fusionar.');
      }

      const mov = buildInventoryMovementRecord({
        inventoryItemId: target.id,
        ingredientName: target.name,
        unit: target.unit,
        type: 'fusion',
        quantityDelta: roundStockQty(source.currentStock),
        notes: `Fusión desde "${source.name}" (${source.currentStock} ${source.unit})`,
      });

      const sourcePath = `workspaces/${SHARED_WORKSPACE_ID}/inventory/${source.id}`;
      try {
        const batch = writeBatch(db!);
        if (source.currentStock !== 0) {
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventory/${target.id}`), {
            currentStock: increment(roundStockQty(source.currentStock)),
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${mov.id}`), {
          ...stripClientTimestamps(mov),
          createdAt: serverTimestamp(),
        });
        batch.delete(doc(db!, sourcePath));

        for (const prod of products) {
          const specs = prod.recipeIngredients || [];
          const hasSpec = specs.some((s) => s.inventoryItemId === source.id);
          const hasAddon = (prod.addonOptions || []).some((a) => a.inventoryItemId === source.id);
          if (!hasSpec && !hasAddon) continue;

          const mergedMap = new Map<string, RecipeIngredientSpec>();
          for (const spec of specs) {
            const inventoriable = spec.inventoriable !== false && Boolean(spec.inventoryItemId);
            if (!inventoriable) {
              const nonInvKey = `noninv:${normalizeIngredientKey(spec.name)}`;
              const existingNonInv = mergedMap.get(nonInvKey);
              if (existingNonInv) {
                existingNonInv.removable = existingNonInv.removable || spec.removable;
              } else {
                mergedMap.set(nonInvKey, {
                  inventoryItemId: '',
                  name: spec.name,
                  quantity: 0,
                  unit: spec.unit === 'ud' ? 'ud' : 'g',
                  removable: spec.removable,
                  inventoriable: false,
                });
              }
              continue;
            }
            const mappedId = spec.inventoryItemId === source.id ? target.id : spec.inventoryItemId;
            const mappedName = spec.inventoryItemId === source.id ? target.name : spec.name;
            const mappedUnit = spec.inventoryItemId === source.id ? target.unit : spec.unit;
            const invKey = `inv:${mappedId}`;
            const existingSpec = mergedMap.get(invKey);
            if (existingSpec) {
              existingSpec.quantity = roundStockQty(existingSpec.quantity + (spec.quantity || 0));
              existingSpec.removable = existingSpec.removable || spec.removable;
            } else {
              mergedMap.set(invKey, {
                inventoryItemId: mappedId,
                name: mappedName,
                quantity: spec.quantity || 0,
                unit: mappedUnit,
                removable: spec.removable,
              });
            }
          }
          const split = splitProductRecipeFromSpecs(Array.from(mergedMap.values()));
          const nextAddons = (prod.addonOptions || []).map((a) =>
            a.inventoryItemId === source.id ? { ...a, inventoryItemId: target.id } : a
          );
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/products/${prod.id}`), {
            baseRecipe: split.baseRecipe,
            removableOptions: split.removableOptions,
            recipeIngredients: split.recipeIngredients,
            addonOptions: nextAddons,
            updatedAt: serverTimestamp(),
          });
          if (publicStorefrontExists) {
            batch.set(
              doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/products/${prod.id}`),
              toPublicProductPayload({
                ...prod,
                baseRecipe: split.baseRecipe,
                removableOptions: split.removableOptions,
                addonOptions: nextAddons,
              })
            );
          }
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, sourcePath);
      }
    },
    [requireAdmin, requireCloud, inventory, products, buildInventoryMovementRecord, publicStorefrontExists]
  );

  const unifyCatalogInventory = useCallback(async (): Promise<{
    createdCount: number;
    updatedProductsCount: number;
  }> => {
    requireAdmin();
    requireCloud();
    const plan = buildUnifiedInventoryPlan(products, inventory);
    if (plan.newItemsToCreate.length === 0 && plan.productPatches.length === 0) {
      return { createdCount: 0, updatedProductsCount: 0 };
    }

    type Op = () => void;
    const batches: Array<ReturnType<typeof writeBatch>> = [];
    let currentBatch = writeBatch(db!);
    let opCount = 0;

    const enqueue = (apply: (b: ReturnType<typeof writeBatch>) => void) => {
      if (opCount >= 400) {
        batches.push(currentBatch);
        currentBatch = writeBatch(db!);
        opCount = 0;
      }
      apply(currentBatch);
      opCount += 1;
    };

    for (const item of plan.newItemsToCreate) {
      const invDoc = {
        id: item.id,
        name: item.name,
        nameKey: item.nameKey,
        unit: item.unit,
        currentStock: 0,
        minStock: 0,
        unitCost: 0,
        lastPurchaseQuantity: 0,
        lastPurchaseTotalCost: 0,
        active: true,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      enqueue((b) =>
        b.set(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventory/${item.id}`), invDoc)
      );
    }

    for (const patch of plan.productPatches) {
      enqueue((b) =>
        b.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/products/${patch.productId}`), {
          baseRecipe: patch.baseRecipe,
          removableOptions: patch.removableOptions,
          recipeIngredients: patch.recipeIngredients,
          updatedAt: serverTimestamp(),
        })
      );
      if (publicStorefrontExists) {
        const prod = products.find((p) => p.id === patch.productId);
        if (prod) {
          enqueue((b) =>
            b.set(
              doc(db!, `publicStorefronts/${SHARED_WORKSPACE_ID}/products/${patch.productId}`),
              toPublicProductPayload({
                ...prod,
                baseRecipe: patch.baseRecipe,
                removableOptions: patch.removableOptions,
              })
            )
          );
        }
      }
    }

    if (opCount > 0) batches.push(currentBatch);
    const runAll: Op = () => undefined;
    void runAll;

    try {
      for (const b of batches) {
        await b.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaces/${SHARED_WORKSPACE_ID}/inventory`);
    }

    return {
      createdCount: plan.newItemsToCreate.length,
      updatedProductsCount: plan.productPatches.length,
    };
  }, [
    requireAdmin,
    requireCloud,
    products,
    inventory,
    workspaceOwnerUid,
    actorUid,
    authorizedEmails,
    publicStorefrontExists,
  ]);

  // Auto-unify existing pre-inventory workspaces once on admin load
  useEffect(() => {
    if (
      sessionMode === 'cloud' &&
      isAdmin &&
      cloudReadyForUid === firebaseUser?.uid &&
      inventoryLoaded &&
      !loadingData &&
      !autoUnifyTriggeredRef.current &&
      inventory.length === 0 &&
      products.length > 0 &&
      products.every((p) => !p.recipeIngredients || p.recipeIngredients.length === 0)
    ) {
      autoUnifyTriggeredRef.current = true;
      void unifyCatalogInventory().catch(() => undefined);
    }
  }, [
    sessionMode,
    isAdmin,
    cloudReadyForUid,
    firebaseUser?.uid,
    inventoryLoaded,
    loadingData,
    inventory.length,
    products,
    unifyCatalogInventory,
  ]);

  // Auto-publish public storefront catalog once for existing workspaces that predate Autoservicio
  useEffect(() => {
    if (
      sessionMode === 'cloud' &&
      isAdmin &&
      cloudReadyForUid === firebaseUser?.uid &&
      publicStorefrontChecked &&
      !publicStorefrontExists &&
      !loadingData &&
      !autoStorefrontSyncRef.current &&
      Boolean(workspaceOwnerUid)
    ) {
      autoStorefrontSyncRef.current = true;
      void syncPublicStorefrontCatalog({
        ownerUid: workspaceOwnerUid,
        businessName: billingConfig.businessName,
        selfServiceConfig,
        products,
        sauces,
      }).catch(() => undefined);
    }
  }, [
    sessionMode,
    isAdmin,
    cloudReadyForUid,
    firebaseUser?.uid,
    publicStorefrontChecked,
    publicStorefrontExists,
    loadingData,
    workspaceOwnerUid,
    billingConfig.businessName,
    selfServiceConfig,
    products,
    sauces,
  ]);

  const registerBulkPurchaseInvoice = useCallback(
    async (input: RegisterBulkPurchaseInput): Promise<PurchaseInvoice> => {
      requireAdmin();
      requireCloud();

      const normalizedLines: PurchaseInvoiceLine[] = input.lines.map((l, idx) =>
        normalizeInvoiceLine({
          ...l,
          id: l.id || createSafeId(`pl_${idx}`),
        })
      );

      const validation = validatePurchaseInvoiceDraft({
        receiptCode: input.receiptCode,
        lines: normalizedLines,
      });
      if (!validation.valid) {
        throw new Error(validation.error || 'Verifica los datos de la colilla.');
      }

      const resolvedSupplier = await syncCustomCustomerRecord(input.supplier);
      const totals = calculateInvoiceTotals(normalizedLines);
      const aggregated = aggregateInventoriablePurchases(normalizedLines);
      const invMap = new Map(inventory.map((i) => [i.id, i]));

      // Ensure any freshly-created ingredient not yet reflected in local snapshot is verified
      for (const agg of aggregated) {
        if (!invMap.has(agg.inventoryItemId)) {
          const snap = await getDoc(
            doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventory/${agg.inventoryItemId}`)
          );
          if (!snap.exists()) {
            throw new Error(
              'Uno de los ingredientes seleccionados ya no existe en el inventario.'
            );
          }
          invMap.set(agg.inventoryItemId, mapInventoryItemDoc(snap.data(), snap.id));
        }
      }

      const now = Date.now();
      const invoiceId = createSafeId('pinv');
      const safeActorName =
        (activeWaiter?.name || firebaseUser?.displayName || actorEmail || 'Administrador')
          .trim()
          .slice(0, 80) || 'Administrador';

      const invoice: PurchaseInvoice = {
        id: invoiceId,
        receiptCode: validation.normalizedCode,
        supplierId: resolvedSupplier.customerId,
        supplierDocument: resolvedSupplier.customerDocument,
        supplierName: resolvedSupplier.customerName,
        supplierPhone: resolvedSupplier.customerPhone,
        supplierEmail: resolvedSupplier.customerEmail,
        paymentMethod: (input.paymentMethod || 'efectivo').trim().slice(0, 40),
        notes: (input.notes || '').trim().slice(0, 300),
        lines: normalizedLines,
        inventoriableTotal: totals.inventoriableTotal,
        expensesTotal: totals.expensesTotal,
        grandTotal: totals.grandTotal,
        actorName: safeActorName,
        actorUid,
        ownerUid: workspaceOwnerUid,
        createdByUid: actorUid,
        allowedEmails: authorizedEmails,
        createdAtMs: now,
        updatedAtMs: now,
      };

      const invoicePath = `workspaces/${SHARED_WORKSPACE_ID}/purchaseInvoices/${invoiceId}`;
      try {
        const batch = writeBatch(db!);
        batch.set(doc(db!, invoicePath), {
          ...stripClientTimestamps(invoice),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        for (const agg of aggregated) {
          const item = invMap.get(agg.inventoryItemId);
          if (!item) continue;
          batch.update(doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventory/${item.id}`), {
            currentStock: increment(agg.addedQuantity),
            unitCost: agg.weightedUnitCost,
            lastPurchaseQuantity: agg.addedQuantity,
            lastPurchaseTotalCost: agg.totalCost,
            allowedEmails: authorizedEmails,
            updatedAt: serverTimestamp(),
          });
        }

        for (const line of normalizedLines) {
          if (line.kind !== 'inventariable' || !line.inventoryItemId || line.quantity <= 0) {
            continue;
          }
          const item = invMap.get(line.inventoryItemId);
          if (!item) continue;
          const mov = buildInventoryMovementRecord({
            inventoryItemId: item.id,
            ingredientName: item.name,
            unit: item.unit,
            type: 'compra',
            quantityDelta: line.quantity,
            purchaseTotalCost: line.totalCost,
            calculatedUnitCost: line.calculatedUnitCost,
            notes: `Colilla ${validation.normalizedCode} · ${resolvedSupplier.customerName}`.slice(
              0,
              300
            ),
          });
          batch.set(
            doc(db!, `workspaces/${SHARED_WORKSPACE_ID}/inventoryMovements/${mov.id}`),
            {
              ...stripClientTimestamps(mov),
              createdAt: serverTimestamp(),
            }
          );
        }

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, invoicePath);
      }

      return invoice;
    },
    [
      requireAdmin,
      requireCloud,
      syncCustomCustomerRecord,
      inventory,
      activeWaiter?.name,
      firebaseUser?.displayName,
      actorEmail,
      actorUid,
      workspaceOwnerUid,
      authorizedEmails,
      buildInventoryMovementRecord,
    ]
  );

  const deletePurchaseInvoice = useCallback(
    async (invoiceId: string) => {
      requireAdmin();
      requireCloud();
      const path = `workspaces/${SHARED_WORKSPACE_ID}/purchaseInvoices/${invoiceId}`;
      try {
        await deleteDoc(doc(db!, path));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [requireAdmin, requireCloud]
  );

  const deleteWorkspaceNotification = useCallback(
    async (notifId: string) => {
      requireAdmin();
      requireCloud();
      if (notifId.startsWith('notif_self_') || notifId.startsWith('notif_sync_')) {
        return;
      }
      const path = `workspaces/${SHARED_WORKSPACE_ID}/notifications/${notifId}`;
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
    selfServiceConfig,
    inventory,
    inventoryMovements,
    notifications,
    notificationsLoaded,
    purchaseInvoices,

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
    saveSelfServiceConfig,
    uploadPaymentQrImage,
    upsertCustomer,
    deleteCustomerRecord,
    openCashShift,
    closeCashShift,
    deleteShiftRecord,
    saveInventoryItem,
    registerInventoryPurchase,
    adjustInventoryStock,
    deleteInventoryItem,
    mergeInventoryItems,
    unifyCatalogInventory,
    registerBulkPurchaseInvoice,
    deletePurchaseInvoice,
    deleteWorkspaceNotification,
  };

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
};

export function usePosStore(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error('usePosStore must be used inside PosProvider');
  return ctx;
}
