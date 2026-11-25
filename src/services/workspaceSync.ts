import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { ADMIN_BOOTSTRAP_EMAIL, buildInitialCatalogSeed } from '../data/initialCatalog';
import type {
  AccountRole,
  AddonOption,
  BusinessBillingConfig,
  Customer,
  DeliveryType,
  ExpenseLineKind,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  InventoryUnit,
  Movement,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  PublicQueueTicket,
  PublicStorefrontConfig,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  RecipeIngredientSpec,
  Sauce,
  SelfServicePaymentConfig,
  Shift,
  ShiftStatus,
  StaffMember,
  TrackedPaymentMethod,
  TransferReceipt,
  WorkspaceNotification,
  WorkspaceNotificationType,
} from '../types/pos';
import { DEFAULT_BILLING_CONFIG, normalizeBillingConfig } from '../utils/billingUtils';
import { findLinkedStaffMember } from '../utils/identityState';
import { isValidStaffRole } from '../utils/rolePermissions';
import {
  DEFAULT_SELF_SERVICE_CONFIG,
  normalizeSelfServiceConfig,
} from '../utils/selfServiceMath';

export const SHARED_WORKSPACE_ID = 'ws_onde_luigi';

export function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  if (
    val &&
    typeof val === 'object' &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export function stripClientTimestamps<T extends { createdAtMs?: number; updatedAtMs?: number }>(
  obj: T
): Omit<T, 'createdAtMs' | 'updatedAtMs'> {
  const { createdAtMs: _c, updatedAtMs: _u, ...rest } = obj;
  return rest;
}

export function mapStaffDoc(d: Record<string, unknown>, fallbackId = ''): StaffMember {
  return {
    id: String(d.id || fallbackId),
    name: String(d.name || ''),
    role: isValidStaffRole(d.role) ? d.role : 'mesero',
    active: Boolean(d.active),
    linkedUid: String(d.linkedUid || ''),
    linkedEmail: String(d.linkedEmail || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapSauceDoc(d: Record<string, unknown>): Sauce {
  return {
    id: String(d.id),
    name: String(d.name),
    active: Boolean(d.active),
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapProductDoc(d: Record<string, unknown>): Product {
  const recipeIngredients: RecipeIngredientSpec[] = Array.isArray(d.recipeIngredients)
    ? (d.recipeIngredients as Record<string, unknown>[]).map((r) => {
        const inventoriable = r.inventoriable !== false && Boolean(r.inventoryItemId);
        return {
          inventoryItemId: inventoriable ? String(r.inventoryItemId || '') : '',
          name: String(r.name || ''),
          quantity: inventoriable ? Number(r.quantity) || 0 : 0,
          unit: r.unit === 'ud' ? 'ud' : 'g',
          removable: Boolean(r.removable),
          ...(inventoriable ? {} : { inventoriable: false }),
        };
      })
    : [];

  return {
    id: String(d.id),
    name: String(d.name),
    category: String(d.category),
    basePrice: Number(d.basePrice) || 0,
    imageUrl: String(d.imageUrl || ''),
    baseRecipe: Array.isArray(d.baseRecipe) ? (d.baseRecipe as string[]) : [],
    removableOptions: Array.isArray(d.removableOptions) ? (d.removableOptions as string[]) : [],
    recipeIngredients,
    addonOptions: Array.isArray(d.addonOptions)
      ? (d.addonOptions as AddonOption[]).map((ex) => ({
          ...ex,
          allowMultiple: ex.allowMultiple !== false,
          ...(ex.inventoryItemId ? { inventoryItemId: String(ex.inventoryItemId) } : {}),
          ...(ex.inventoryQuantity !== undefined
            ? { inventoryQuantity: Number(ex.inventoryQuantity) || 0 }
            : {}),
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
  };
}

function parseInventoryDeducted(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(v);
    if (k && Number.isFinite(num) && num > 0) {
      out[k] = num;
    }
  }
  return out;
}

export function mapOrderDoc(d: Record<string, unknown>): Order {
  return {
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
    receiptStoragePath: d.receiptStoragePath ? String(d.receiptStoragePath) : undefined,
    source: d.source === 'autoservicio' ? 'autoservicio' : d.source === 'pos' ? 'pos' : undefined,
    deliveryType:
      d.deliveryType === 'domicilio'
        ? 'domicilio'
        : d.deliveryType === 'local'
          ? 'local'
          : undefined,
    deliveryAddress: d.deliveryAddress ? String(d.deliveryAddress) : undefined,
    deliveryNeighborhood: d.deliveryNeighborhood ? String(d.deliveryNeighborhood) : undefined,
    deliveryPhone: d.deliveryPhone ? String(d.deliveryPhone) : undefined,
    deliveryNotes: d.deliveryNotes ? String(d.deliveryNotes) : undefined,
    customerId: d.customerId ? String(d.customerId) : undefined,
    customerDocument: d.customerDocument ? String(d.customerDocument) : undefined,
    customerName: d.customerName ? String(d.customerName) : undefined,
    customerPhone: d.customerPhone ? String(d.customerPhone) : undefined,
    customerEmail: d.customerEmail ? String(d.customerEmail) : undefined,
    inventoryDeducted: parseInventoryDeducted(d.inventoryDeducted),
    voidReason: d.voidReason ? String(d.voidReason) : undefined,
    voidedByName: d.voidedByName ? String(d.voidedByName) : undefined,
    voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
    ownerUid: String(d.ownerUid),
    createdByUid: String(d.createdByUid),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapPublicStorefrontDoc(
  d: Record<string, unknown>,
  fallbackId = SHARED_WORKSPACE_ID
): PublicStorefrontConfig {
  const cfg = normalizeSelfServiceConfig(d as Partial<SelfServicePaymentConfig>);
  return {
    id: String(d.id || fallbackId),
    businessName: String(d.businessName || "O'NDE LUIGI"),
    ...cfg,
    ownerUid: String(d.ownerUid || ''),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapPublicProductDoc(d: Record<string, unknown>, fallbackId = ''): Product {
  return {
    id: String(d.id || fallbackId),
    name: String(d.name || ''),
    category: String(d.category || 'General'),
    basePrice: Number(d.basePrice) || 0,
    imageUrl: String(d.imageUrl || ''),
    baseRecipe: Array.isArray(d.baseRecipe) ? (d.baseRecipe as string[]) : [],
    removableOptions: Array.isArray(d.removableOptions) ? (d.removableOptions as string[]) : [],
    recipeIngredients: [],
    addonOptions: Array.isArray(d.addonOptions)
      ? (d.addonOptions as AddonOption[]).map((ex) => ({
          id: String(ex.id || ''),
          name: String(ex.name || ''),
          price: Number(ex.price) || 0,
          allowMultiple: ex.allowMultiple !== false,
        }))
      : [],
    allowSauces: d.allowSauces !== undefined ? Boolean(d.allowSauces) : true,
    minSauces: d.minSauces !== undefined ? Number(d.minSauces) : 1,
    maxSauces: d.maxSauces !== undefined ? Number(d.maxSauces) : 4,
    active: Boolean(d.active),
    ownerUid: '',
    createdByUid: '',
    allowedEmails: [],
    createdAtMs: 0,
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapPublicSauceDoc(d: Record<string, unknown>, fallbackId = ''): Sauce {
  return {
    id: String(d.id || fallbackId),
    name: String(d.name || ''),
    active: Boolean(d.active),
    ownerUid: '',
    createdByUid: '',
    allowedEmails: [],
    createdAtMs: 0,
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapQueueTicketDoc(
  d: Record<string, unknown>,
  fallbackId = ''
): PublicQueueTicket {
  const deliveryType: DeliveryType = d.deliveryType === 'domicilio' ? 'domicilio' : 'local';
  return {
    id: String(d.id || fallbackId),
    orderNumber: Number(d.orderNumber) || 501,
    status: (d.status || 'pendiente_validacion') as OrderStatus,
    deliveryType,
    createdAtMs: Number(d.createdAtMs) || toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapSelfOrderDoc(d: Record<string, unknown>, fallbackId = ''): Order {
  const deliveryType: DeliveryType = d.deliveryType === 'domicilio' ? 'domicilio' : 'local';
  const customerName = String(d.customerName || 'Cliente Autoservicio');
  const deliveryPhone = String(d.deliveryPhone || '');
  return {
    id: String(d.id || fallbackId),
    orderNumber: Number(d.orderNumber) || 501,
    reference: String(d.reference || `Autoservicio · ${customerName}`),
    waiterId: 'autoservicio',
    waiterName: deliveryType === 'domicilio' ? 'Autoservicio · Domicilio' : 'Autoservicio · Local',
    status: (d.status || 'pendiente_validacion') as OrderStatus,
    paymentStatus: d.paymentStatus === 'pagado' ? 'pagado' : 'pendiente',
    paymentMethod: 'transferencia',
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
    receiptStoragePath: String(d.receiptStoragePath || ''),
    source: 'autoservicio',
    deliveryType,
    deliveryAddress: String(d.deliveryAddress || ''),
    deliveryNeighborhood: String(d.deliveryNeighborhood || ''),
    deliveryPhone,
    deliveryNotes: String(d.deliveryNotes || ''),
    customerName,
    customerPhone: deliveryPhone || undefined,
    voidReason: d.voidReason ? String(d.voidReason) : undefined,
    voidedByName: d.voidedByName ? String(d.voidedByName) : undefined,
    voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || 'autoservicio'),
    allowedEmails: [],
    createdAtMs: Number(d.createdAtMs) || toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function toPublicProductPayload(product: Pick<
  Product,
  | 'id'
  | 'name'
  | 'category'
  | 'basePrice'
  | 'imageUrl'
  | 'baseRecipe'
  | 'removableOptions'
  | 'addonOptions'
  | 'allowSauces'
  | 'minSauces'
  | 'maxSauces'
  | 'active'
>) {
  return {
    id: product.id,
    name: product.name.trim().slice(0, 100),
    category: product.category.trim().slice(0, 60) || 'General',
    basePrice: Math.max(0, Math.round(product.basePrice || 0)),
    imageUrl: String(product.imageUrl || '').slice(0, 250000),
    baseRecipe: (product.baseRecipe || []).slice(0, 30),
    removableOptions: (product.removableOptions || []).slice(0, 30),
    addonOptions: (product.addonOptions || []).slice(0, 30).map((ex) => ({
      id: ex.id,
      name: ex.name.trim().slice(0, 80),
      price: Math.max(0, Math.round(ex.price || 0)),
      allowMultiple: ex.allowMultiple !== false,
    })),
    allowSauces: Boolean(product.allowSauces),
    minSauces: Math.max(0, Math.min(4, Math.round(product.minSauces ?? 1))),
    maxSauces: Math.max(0, Math.min(4, Math.round(product.maxSauces ?? 4))),
    active: Boolean(product.active),
    updatedAt: serverTimestamp(),
  };
}

export function toPublicSaucePayload(sauce: Pick<Sauce, 'id' | 'name' | 'active'>) {
  return {
    id: sauce.id,
    name: sauce.name.trim().slice(0, 60),
    active: Boolean(sauce.active),
    updatedAt: serverTimestamp(),
  };
}

export async function syncPublicStorefrontCatalog(params: {
  ownerUid: string;
  businessName: string;
  selfServiceConfig: SelfServicePaymentConfig;
  products: Product[];
  sauces: Sauce[];
}): Promise<void> {
  if (!db || !params.ownerUid) return;
  const batch = writeBatch(db);
  const normalized = normalizeSelfServiceConfig(params.selfServiceConfig);
  batch.set(doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID), {
    id: SHARED_WORKSPACE_ID,
    businessName: params.businessName.trim().slice(0, 120) || "O'NDE LUIGI",
    ...normalized,
    ownerUid: params.ownerUid,
    updatedAt: serverTimestamp(),
  });
  for (const prod of params.products) {
    batch.set(
      doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'products', prod.id),
      toPublicProductPayload(prod)
    );
  }
  for (const sauce of params.sauces) {
    batch.set(
      doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'sauces', sauce.id),
      toPublicSaucePayload(sauce)
    );
  }
  await batch.commit();
}

export function mapCustomerDoc(d: Record<string, unknown>, fallbackId = ''): Customer {
  return {
    id: String(d.id || fallbackId),
    documentNumber: String(d.documentNumber || ''),
    name: String(d.name || ''),
    phone: String(d.phone || ''),
    email: String(d.email || ''),
    notes: String(d.notes || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapInventoryItemDoc(d: Record<string, unknown>, fallbackId = ''): InventoryItem {
  const unit: InventoryUnit = d.unit === 'ud' ? 'ud' : 'g';
  return {
    id: String(d.id || fallbackId),
    name: String(d.name || ''),
    nameKey: String(d.nameKey || ''),
    unit,
    currentStock: Number(d.currentStock) || 0,
    minStock: Number(d.minStock) || 0,
    unitCost: Number(d.unitCost) || 0,
    lastPurchaseQuantity: Number(d.lastPurchaseQuantity) || 0,
    lastPurchaseTotalCost: Number(d.lastPurchaseTotalCost) || 0,
    active: d.active !== undefined ? Boolean(d.active) : true,
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapInventoryMovementDoc(
  d: Record<string, unknown>,
  fallbackId = ''
): InventoryMovement {
  const unit: InventoryUnit = d.unit === 'ud' ? 'ud' : 'g';
  return {
    id: String(d.id || fallbackId),
    inventoryItemId: String(d.inventoryItemId || ''),
    ingredientName: String(d.ingredientName || ''),
    unit,
    type: (d.type || 'ajuste_manual') as InventoryMovementType,
    quantityDelta: Number(d.quantityDelta) || 0,
    purchaseTotalCost: Number(d.purchaseTotalCost) || 0,
    calculatedUnitCost: Number(d.calculatedUnitCost) || 0,
    orderId: String(d.orderId || ''),
    orderNumber: Number(d.orderNumber) || 0,
    notes: String(d.notes || ''),
    actorName: String(d.actorName || ''),
    actorUid: String(d.actorUid || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
  };
}

export function mapNotificationDoc(
  d: Record<string, unknown>,
  fallbackId = ''
): WorkspaceNotification {
  const validType: WorkspaceNotificationType =
    d.type === 'nueva_comanda' ||
    d.type === 'turno_abierto' ||
    d.type === 'turno_cerrado' ||
    d.type === 'venta_anulada'
      ? d.type
      : 'nueva_comanda';

  return {
    id: String(d.id || fallbackId),
    type: validType,
    title: String(d.title || ''),
    message: String(d.message || ''),
    orderId: String(d.orderId || ''),
    orderNumber: Number(d.orderNumber) || 0,
    shiftId: String(d.shiftId || ''),
    actorName: String(d.actorName || ''),
    actorUid: String(d.actorUid || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
  };
}

function normalizeExpenseKind(raw: unknown): ExpenseLineKind {
  if (
    raw === 'inventariable' ||
    raw === 'no_inventariable' ||
    raw === 'servicio' ||
    raw === 'gasto' ||
    raw === 'inversion'
  ) {
    return raw;
  }
  return 'gasto';
}

export function mapPurchaseInvoiceDoc(
  d: Record<string, unknown>,
  fallbackId = ''
): PurchaseInvoice {
  const lines: PurchaseInvoiceLine[] = Array.isArray(d.lines)
    ? (d.lines as Record<string, unknown>[]).map((line, idx) => ({
        id: String(line.id || `line_${idx}`),
        kind: normalizeExpenseKind(line.kind),
        description: String(line.description || ''),
        ...(line.inventoryItemId ? { inventoryItemId: String(line.inventoryItemId) } : {}),
        ...(line.unit === 'g' || line.unit === 'ud' ? { unit: line.unit } : {}),
        quantity: Number(line.quantity) || 0,
        totalCost: Number(line.totalCost) || 0,
        calculatedUnitCost: Number(line.calculatedUnitCost) || 0,
      }))
    : [];

  return {
    id: String(d.id || fallbackId),
    receiptCode: String(d.receiptCode || ''),
    supplierId: String(d.supplierId || ''),
    supplierDocument: String(d.supplierDocument || ''),
    supplierName: String(d.supplierName || ''),
    supplierPhone: String(d.supplierPhone || ''),
    supplierEmail: String(d.supplierEmail || ''),
    paymentMethod: String(d.paymentMethod || ''),
    notes: String(d.notes || ''),
    lines,
    inventoriableTotal: Number(d.inventoriableTotal) || 0,
    expensesTotal: Number(d.expensesTotal) || 0,
    grandTotal: Number(d.grandTotal) || 0,
    actorName: String(d.actorName || ''),
    actorUid: String(d.actorUid || ''),
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapMovementDoc(d: Record<string, unknown>): Movement {
  return {
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
  };
}

export function mapTransferDoc(d: Record<string, unknown>): TransferReceipt {
  return {
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
  };
}

function parseMethodMap(raw: unknown): Partial<Record<TrackedPaymentMethod, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const record = raw as Record<string, unknown>;
  const out: Partial<Record<TrackedPaymentMethod, number>> = {};
  for (const key of ['efectivo', 'transferencia', 'tarjeta', 'otro'] as const) {
    if (record[key] !== undefined && Number.isFinite(Number(record[key]))) {
      out[key] = Number(record[key]);
    }
  }
  return out;
}

export function mapShiftDoc(d: Record<string, unknown>, fallbackId = ''): Shift {
  const status: ShiftStatus = d.status === 'cerrado' ? 'cerrado' : 'abierto';
  const openedAtMs = toMillis(d.createdAt);
  const closedAtMs = status === 'cerrado' ? toMillis(d.updatedAt) : 0;
  const rawMethods = Array.isArray(d.usedPaymentMethods) ? d.usedPaymentMethods : [];
  const usedPaymentMethods = rawMethods.filter(
    (m): m is TrackedPaymentMethod =>
      m === 'efectivo' || m === 'transferencia' || m === 'tarjeta' || m === 'otro'
  );

  return {
    id: String(d.id || fallbackId),
    status,
    openingBaseAmount: Number(d.openingBaseAmount) || 0,
    openingNote: String(d.openingNote || ''),
    openedByStaffId: String(d.openedByStaffId || ''),
    openedByName: String(d.openedByName || ''),
    openedByUid: String(d.openedByUid || ''),
    openedAtMs,
    closedAtMs,
    closedByStaffId: String(d.closedByStaffId || ''),
    closedByName: String(d.closedByName || ''),
    closedByUid: String(d.closedByUid || ''),
    closingNote: String(d.closingNote || ''),
    usedPaymentMethods,
    declaredClosingBase: Number(d.declaredClosingBase) || 0,
    declaredByMethod: parseMethodMap(d.declaredByMethod),
    expectedBaseAmount: Number(d.expectedBaseAmount) || 0,
    expectedByMethod: parseMethodMap(d.expectedByMethod),
    expectedTotal: Number(d.expectedTotal) || 0,
    declaredTotal: Number(d.declaredTotal) || 0,
    differenceTotal: Number(d.differenceTotal) || 0,
    paidOrdersCount: Number(d.paidOrdersCount) || 0,
    pendingOrdersCount: Number(d.pendingOrdersCount) || 0,
    ownerUid: String(d.ownerUid || ''),
    createdByUid: String(d.createdByUid || ''),
    allowedEmails: Array.isArray(d.allowedEmails) ? (d.allowedEmails as string[]) : [],
    createdAtMs: openedAtMs,
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export interface WorkspaceBootstrapInfo {
  ownerUid: string;
  authorizedEmails: string[];
  allowSelfRegistration: boolean;
  memberRole: AccountRole;
  billingConfig: BusinessBillingConfig;
  selfServiceConfig: SelfServicePaymentConfig;
}

export async function resolveOrBootstrapCloudWorkspace(
  user: User
): Promise<WorkspaceBootstrapInfo | null> {
  if (!db) return null;
  const wsRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID);
  const dirRef = doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID);
  const memberRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', user.uid);
  const userEmail = (user.email || '').toLowerCase();
  const isAdminEmail = userEmail === ADMIN_BOOTSTRAP_EMAIL;

  // 1. Principal Admin bootstrap & backfill
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
          billingConfig: DEFAULT_BILLING_CONFIG,
          selfServiceConfig: DEFAULT_SELF_SERVICE_CONFIG,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID), {
          id: SHARED_WORKSPACE_ID,
          businessName: DEFAULT_BILLING_CONFIG.businessName,
          ...DEFAULT_SELF_SERVICE_CONFIG,
          ownerUid: user.uid,
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

        const seed = buildInitialCatalogSeed(user.uid, userEmail);
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
          batch.set(
            doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'sauces', sauce.id),
            toPublicSaucePayload(sauce)
          );
        }
        for (const prod of seed.products) {
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'products', prod.id), {
            ...stripClientTimestamps(prod),
            ownerUid: user.uid,
            createdByUid: user.uid,
            allowedEmails: initialEmails,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(
            doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'products', prod.id),
            toPublicProductPayload(prod)
          );
        }
        for (const inv of seed.inventory) {
          batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'inventory', inv.id), {
            ...stripClientTimestamps(inv),
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
          memberRole: 'admin',
          billingConfig: DEFAULT_BILLING_CONFIG,
          selfServiceConfig: DEFAULT_SELF_SERVICE_CONFIG,
        };
      }

      const data = snap.data() as {
        name?: string;
        ownerUid: string;
        authorizedEmails?: string[];
        billingConfig?: Partial<BusinessBillingConfig>;
        selfServiceConfig?: Partial<SelfServicePaymentConfig>;
      };
      const emails = Array.isArray(data.authorizedEmails)
        ? data.authorizedEmails.map((e) => e.toLowerCase())
        : [ADMIN_BOOTSTRAP_EMAIL];

      const [dirSnap, memberSnap, staffSnap] = await Promise.all([
        getDoc(dirRef),
        getDoc(memberRef),
        getDocs(
          query(
            collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff'),
            where('ownerUid', '==', data.ownerUid)
          )
        ),
      ]);

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
        currentAllowSelf = Boolean(
          (dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration
        );
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

      const existingStaffList = staffSnap.docs.map((d) =>
        mapStaffDoc(d.data() as Record<string, unknown>, d.id)
      );
      const existingAdminStaff = findLinkedStaffMember(existingStaffList, user.uid, userEmail);
      if (!existingAdminStaff) {
        const adminStaffId = `staff_${user.uid}`;
        await setDoc(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', adminStaffId), {
          id: adminStaffId,
          name: (user.displayName || 'Administrador').trim().slice(0, 80),
          role: 'admin',
          active: true,
          linkedUid: user.uid,
          linkedEmail: user.email || userEmail,
          ownerUid: data.ownerUid,
          createdByUid: user.uid,
          allowedEmails: emails,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (!existingAdminStaff.active || existingAdminStaff.linkedUid !== user.uid) {
        await updateDoc(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', existingAdminStaff.id), {
          active: true,
          linkedUid: user.uid,
          linkedEmail: user.email || userEmail,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        ownerUid: data.ownerUid,
        authorizedEmails: emails,
        allowSelfRegistration: currentAllowSelf,
        memberRole: 'admin',
        billingConfig: normalizeBillingConfig(data.billingConfig),
        selfServiceConfig: normalizeSelfServiceConfig(data.selfServiceConfig),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
      return null;
    }
  }

  // 2. Non-admin user flow
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

  const dirAllowSelf = dirSnap.exists()
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
    let preAuthorizedSnap;
    try {
      preAuthorizedSnap = await getDoc(wsRef);
    } catch {
      if (!dirSnap.exists()) {
        throw new Error(
          `El administrador (${ADMIN_BOOTSTRAP_EMAIL}) debe abrir la aplicación una vez para activar el acceso del equipo.`
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
    const wsData = wsSnap.data() as {
      ownerUid: string;
      authorizedEmails?: string[];
      billingConfig?: Partial<BusinessBillingConfig>;
      selfServiceConfig?: Partial<SelfServicePaymentConfig>;
    };
    const emails = Array.isArray(wsData.authorizedEmails)
      ? wsData.authorizedEmails.map((e) => e.toLowerCase())
      : [ADMIN_BOOTSTRAP_EMAIL];
    return {
      ownerUid: wsData.ownerUid,
      authorizedEmails: emails,
      allowSelfRegistration: dirAllowSelf,
      memberRole: wsData.ownerUid === user.uid ? 'admin' : resolvedRole,
      billingConfig: normalizeBillingConfig(wsData.billingConfig),
      selfServiceConfig: normalizeSelfServiceConfig(wsData.selfServiceConfig),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no ha sido inicializado')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
    return null;
  }
}
