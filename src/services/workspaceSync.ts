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
  AccessRequestStatus,
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
  WorkspaceAccessRequest,
  WorkspaceNotification,
  WorkspaceNotificationType,
} from '../types/pos';
import type { PayrollCompany } from '../types/payroll';
import { DEFAULT_BILLING_CONFIG, normalizeBillingConfig } from '../utils/billingUtils';
import { findLinkedStaffMember } from '../utils/identityState';
import { sanitizePlainText, sanitizeSafeUrl, sanitizeStringList } from '../utils/inputSecurity';
import { normalizePayrollCompanyRecord } from '../utils/payrollMath';
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

export function omitUndefinedFields<T extends Record<string, unknown>>(obj: T): T {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean as T;
}

export function stripClientTimestamps<T extends { createdAtMs?: number; updatedAtMs?: number }>(
  obj: T
): Omit<T, 'createdAtMs' | 'updatedAtMs'> {
  const { createdAtMs: _c, updatedAtMs: _u, ...rest } = obj;
  return omitUndefinedFields(rest as Record<string, unknown>) as Omit<
    T,
    'createdAtMs' | 'updatedAtMs'
  >;
}

export function mapStaffDoc(d: Record<string, unknown>, fallbackId = ''): StaffMember {
  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 80 }),
    role: isValidStaffRole(d.role) ? d.role : 'mesero',
    active: Boolean(d.active),
    linkedUid: sanitizePlainText(d.linkedUid, { maxLen: 128 }),
    linkedEmail: sanitizePlainText(d.linkedEmail, { maxLen: 160 }).toLowerCase(),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapSauceDoc(d: Record<string, unknown>): Sauce {
  return {
    id: sanitizePlainText(d.id, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 60 }),
    active: Boolean(d.active),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapProductDoc(d: Record<string, unknown>): Product {
  const recipeIngredients: RecipeIngredientSpec[] = Array.isArray(d.recipeIngredients)
    ? (d.recipeIngredients as Record<string, unknown>[]).map((r) => {
        const inventoriable = r.inventoriable !== false && Boolean(r.inventoryItemId);
        return {
          inventoryItemId: inventoriable ? sanitizePlainText(r.inventoryItemId, { maxLen: 128 }) : '',
          name: sanitizePlainText(r.name, { maxLen: 80 }),
          quantity: inventoriable ? Number(r.quantity) || 0 : 0,
          unit: r.unit === 'ud' ? 'ud' : 'g',
          removable: Boolean(r.removable),
          ...(inventoriable ? {} : { inventoriable: false }),
        };
      })
    : [];

  return {
    id: sanitizePlainText(d.id, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 100 }),
    category: sanitizePlainText(d.category, { maxLen: 60 }) || 'General',
    basePrice: Number(d.basePrice) || 0,
    imageUrl: sanitizeSafeUrl(d.imageUrl, { allowDataImage: true, allowRelative: true, maxLen: 250000 }),
    baseRecipe: sanitizeStringList(d.baseRecipe, 30, 80),
    removableOptions: sanitizeStringList(d.removableOptions, 30, 80),
    recipeIngredients,
    addonOptions: Array.isArray(d.addonOptions)
      ? (d.addonOptions as AddonOption[]).map((ex) => ({
          id: sanitizePlainText(ex.id, { maxLen: 128 }),
          name: sanitizePlainText(ex.name, { maxLen: 80 }),
          price: Math.max(0, Math.round(Number(ex.price) || 0)),
          allowMultiple: ex.allowMultiple !== false,
          ...(ex.inventoryItemId
            ? { inventoryItemId: sanitizePlainText(ex.inventoryItemId, { maxLen: 128 }) }
            : {}),
          ...(ex.inventoryQuantity !== undefined
            ? { inventoryQuantity: Number(ex.inventoryQuantity) || 0 }
            : {}),
        }))
      : [],
    allowSauces: d.allowSauces !== undefined ? Boolean(d.allowSauces) : true,
    minSauces: d.minSauces !== undefined ? Number(d.minSauces) : 1,
    maxSauces: d.maxSauces !== undefined ? Number(d.maxSauces) : 4,
    active: Boolean(d.active),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
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

function sanitizeOrderItemsList(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as OrderItem[]).map((it) => ({
    lineId: sanitizePlainText(it.lineId, { maxLen: 128 }),
    productId: sanitizePlainText(it.productId, { maxLen: 128 }),
    productName: sanitizePlainText(it.productName, { maxLen: 100 }),
    category: sanitizePlainText(it.category, { maxLen: 60 }),
    quantity: Math.max(1, Number(it.quantity) || 1),
    basePrice: Math.max(0, Number(it.basePrice) || 0),
    removedIngredients: sanitizeStringList(it.removedIngredients, 30, 80),
    addedExtras: Array.isArray(it.addedExtras)
      ? it.addedExtras.map((ex) => ({
          id: sanitizePlainText(ex.id, { maxLen: 128 }),
          name: sanitizePlainText(ex.name, { maxLen: 80 }),
          price: Math.max(0, Number(ex.price) || 0),
          ...(ex.quantity !== undefined ? { quantity: Math.max(1, Number(ex.quantity) || 1) } : {}),
        }))
      : [],
    selectedSauces: sanitizeStringList(it.selectedSauces, 10, 60),
    customNote: sanitizePlainText(it.customNote, { maxLen: 200 }),
    unitPrice: Math.max(0, Number(it.unitPrice) || 0),
    lineTotal: Math.max(0, Number(it.lineTotal) || 0),
  }));
}

export function mapOrderDoc(d: Record<string, unknown>): Order {
  return {
    id: sanitizePlainText(d.id, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 1,
    reference: sanitizePlainText(d.reference, { maxLen: 100 }),
    waiterId: sanitizePlainText(d.waiterId, { maxLen: 128 }),
    waiterName: sanitizePlainText(d.waiterName, { maxLen: 80 }),
    status: d.status as OrderStatus,
    paymentStatus: d.paymentStatus as PaymentStatus,
    paymentMethod: (d.paymentMethod || '') as PaymentMethod,
    items: sanitizeOrderItemsList(d.items),
    subtotal: Number(d.subtotal) || 0,
    total: Number(d.total) || 0,
    notes: sanitizePlainText(d.notes, { maxLen: 400, allowNewlines: true }),
    receiptCount: Number(d.receiptCount) || 0,
    latestReceiptUrl: sanitizeSafeUrl(d.latestReceiptUrl, {
      allowDataImage: true,
      allowRelative: false,
      maxLen: 250000,
    }),
    receiptStoragePath: d.receiptStoragePath
      ? sanitizePlainText(d.receiptStoragePath, { maxLen: 500 })
      : undefined,
    source: d.source === 'autoservicio' ? 'autoservicio' : d.source === 'pos' ? 'pos' : undefined,
    deliveryType:
      d.deliveryType === 'domicilio'
        ? 'domicilio'
        : d.deliveryType === 'local'
          ? 'local'
          : undefined,
    deliveryAddress: d.deliveryAddress
      ? sanitizePlainText(d.deliveryAddress, { maxLen: 220 })
      : undefined,
    deliveryNeighborhood: d.deliveryNeighborhood
      ? sanitizePlainText(d.deliveryNeighborhood, { maxLen: 100 })
      : undefined,
    deliveryPhone: d.deliveryPhone
      ? sanitizePlainText(d.deliveryPhone, { maxLen: 40 })
      : undefined,
    deliveryNotes: d.deliveryNotes
      ? sanitizePlainText(d.deliveryNotes, { maxLen: 240, allowNewlines: true })
      : undefined,
    customerId: d.customerId ? sanitizePlainText(d.customerId, { maxLen: 128 }) : undefined,
    customerDocument: d.customerDocument
      ? sanitizePlainText(d.customerDocument, { maxLen: 40 })
      : undefined,
    customerName: d.customerName
      ? sanitizePlainText(d.customerName, { maxLen: 120 })
      : undefined,
    customerPhone: d.customerPhone
      ? sanitizePlainText(d.customerPhone, { maxLen: 40 })
      : undefined,
    customerEmail: d.customerEmail
      ? sanitizePlainText(d.customerEmail, { maxLen: 160 })
      : undefined,
    inventoryDeducted: parseInventoryDeducted(d.inventoryDeducted),
    voidReason: d.voidReason ? sanitizePlainText(d.voidReason, { maxLen: 240 }) : undefined,
    voidedByName: d.voidedByName ? sanitizePlainText(d.voidedByName, { maxLen: 80 }) : undefined,
    voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
    refundMethod:
      d.refundMethod === 'efectivo' ||
      d.refundMethod === 'transferencia' ||
      d.refundMethod === 'tarjeta' ||
      d.refundMethod === 'otro'
        ? d.refundMethod
        : undefined,
    refundAmount:
      d.refundAmount !== undefined && Number.isFinite(Number(d.refundAmount))
        ? Number(d.refundAmount)
        : undefined,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    businessName: sanitizePlainText(d.businessName, { maxLen: 120 }) || "O'NDE LUIGI",
    ...cfg,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapPublicProductDoc(d: Record<string, unknown>, fallbackId = ''): Product {
  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 100 }),
    category: sanitizePlainText(d.category, { maxLen: 60 }) || 'General',
    basePrice: Number(d.basePrice) || 0,
    imageUrl: sanitizeSafeUrl(d.imageUrl, { allowDataImage: true, allowRelative: true, maxLen: 250000 }),
    baseRecipe: sanitizeStringList(d.baseRecipe, 30, 80),
    removableOptions: sanitizeStringList(d.removableOptions, 30, 80),
    recipeIngredients: [],
    addonOptions: Array.isArray(d.addonOptions)
      ? (d.addonOptions as AddonOption[]).map((ex) => ({
          id: sanitizePlainText(ex.id, { maxLen: 128 }),
          name: sanitizePlainText(ex.name, { maxLen: 80 }),
          price: Math.max(0, Number(ex.price) || 0),
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 60 }),
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 501,
    status: (d.status || 'pendiente_validacion') as OrderStatus,
    deliveryType,
    createdAtMs: Number(d.createdAtMs) || toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapSelfOrderDoc(d: Record<string, unknown>, fallbackId = ''): Order {
  const deliveryType: DeliveryType = d.deliveryType === 'domicilio' ? 'domicilio' : 'local';
  const customerName = sanitizePlainText(d.customerName, { maxLen: 120 }) || 'Cliente Autoservicio';
  const deliveryPhone = sanitizePlainText(d.deliveryPhone, { maxLen: 40 });
  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 501,
    reference:
      sanitizePlainText(d.reference, { maxLen: 100 }) || `Autoservicio · ${customerName}`,
    waiterId: 'autoservicio',
    waiterName: deliveryType === 'domicilio' ? 'Autoservicio · Domicilio' : 'Autoservicio · Local',
    status: (d.status || 'pendiente_validacion') as OrderStatus,
    paymentStatus: d.paymentStatus === 'pagado' ? 'pagado' : 'pendiente',
    paymentMethod: 'transferencia',
    items: sanitizeOrderItemsList(d.items),
    subtotal: Number(d.subtotal) || 0,
    total: Number(d.total) || 0,
    notes: sanitizePlainText(d.notes, { maxLen: 400, allowNewlines: true }),
    receiptCount: Number(d.receiptCount) || 0,
    latestReceiptUrl: sanitizeSafeUrl(d.latestReceiptUrl, {
      allowDataImage: true,
      allowRelative: false,
      maxLen: 250000,
    }),
    receiptStoragePath: sanitizePlainText(d.receiptStoragePath, { maxLen: 500 }),
    source: 'autoservicio',
    deliveryType,
    deliveryAddress: sanitizePlainText(d.deliveryAddress, { maxLen: 220 }),
    deliveryNeighborhood: sanitizePlainText(d.deliveryNeighborhood, { maxLen: 100 }),
    deliveryPhone,
    deliveryNotes: sanitizePlainText(d.deliveryNotes, { maxLen: 240, allowNewlines: true }),
    customerName,
    customerPhone: deliveryPhone || undefined,
    voidReason: d.voidReason ? sanitizePlainText(d.voidReason, { maxLen: 240 }) : undefined,
    voidedByName: d.voidedByName ? sanitizePlainText(d.voidedByName, { maxLen: 80 }) : undefined,
    voidedAtMs: d.voidedAtMs ? Number(d.voidedAtMs) : undefined,
    refundMethod:
      d.refundMethod === 'efectivo' ||
      d.refundMethod === 'transferencia' ||
      d.refundMethod === 'tarjeta' ||
      d.refundMethod === 'otro'
        ? d.refundMethod
        : undefined,
    refundAmount:
      d.refundAmount !== undefined && Number.isFinite(Number(d.refundAmount))
        ? Number(d.refundAmount)
        : undefined,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }) || 'autoservicio',
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
    id: sanitizePlainText(product.id, { maxLen: 128 }),
    name: sanitizePlainText(product.name, { maxLen: 100 }),
    category: sanitizePlainText(product.category, { maxLen: 60 }) || 'General',
    basePrice: Math.max(0, Math.round(product.basePrice || 0)),
    imageUrl: sanitizeSafeUrl(product.imageUrl, {
      allowDataImage: true,
      allowRelative: true,
      maxLen: 250000,
    }),
    baseRecipe: sanitizeStringList(product.baseRecipe, 30, 80),
    removableOptions: sanitizeStringList(product.removableOptions, 30, 80),
    addonOptions: (product.addonOptions || []).slice(0, 30).map((ex) => ({
      id: sanitizePlainText(ex.id, { maxLen: 128 }),
      name: sanitizePlainText(ex.name, { maxLen: 80 }),
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
    id: sanitizePlainText(sauce.id, { maxLen: 128 }),
    name: sanitizePlainText(sauce.name, { maxLen: 60 }),
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
    businessName: sanitizePlainText(params.businessName, { maxLen: 120 }) || "O'NDE LUIGI",
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    documentNumber: sanitizePlainText(d.documentNumber, { maxLen: 40 }),
    name: sanitizePlainText(d.name, { maxLen: 120 }),
    phone: sanitizePlainText(d.phone, { maxLen: 40 }),
    email: sanitizePlainText(d.email, { maxLen: 160 }),
    notes: sanitizePlainText(d.notes, { maxLen: 300, allowNewlines: true }),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapInventoryItemDoc(d: Record<string, unknown>, fallbackId = ''): InventoryItem {
  const unit: InventoryUnit = d.unit === 'ud' ? 'ud' : 'g';
  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    name: sanitizePlainText(d.name, { maxLen: 80 }),
    nameKey: sanitizePlainText(d.nameKey, { maxLen: 80 }),
    unit,
    currentStock: Number(d.currentStock) || 0,
    minStock: Number(d.minStock) || 0,
    unitCost: Number(d.unitCost) || 0,
    lastPurchaseQuantity: Number(d.lastPurchaseQuantity) || 0,
    lastPurchaseTotalCost: Number(d.lastPurchaseTotalCost) || 0,
    active: d.active !== undefined ? Boolean(d.active) : true,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    inventoryItemId: sanitizePlainText(d.inventoryItemId, { maxLen: 128 }),
    ingredientName: sanitizePlainText(d.ingredientName, { maxLen: 80 }),
    unit,
    type: (d.type || 'ajuste_manual') as InventoryMovementType,
    quantityDelta: Number(d.quantityDelta) || 0,
    purchaseTotalCost: Number(d.purchaseTotalCost) || 0,
    calculatedUnitCost: Number(d.calculatedUnitCost) || 0,
    orderId: sanitizePlainText(d.orderId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 0,
    notes: sanitizePlainText(d.notes, { maxLen: 300, allowNewlines: true }),
    actorName: sanitizePlainText(d.actorName, { maxLen: 80 }),
    actorUid: sanitizePlainText(d.actorUid, { maxLen: 128 }),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
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
    d.type === 'venta_anulada' ||
    d.type === 'solicitud_acceso'
      ? d.type
      : 'nueva_comanda';

  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    type: validType,
    title: sanitizePlainText(d.title, { maxLen: 140 }),
    message: sanitizePlainText(d.message, { maxLen: 360 }),
    orderId: sanitizePlainText(d.orderId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 0,
    shiftId: sanitizePlainText(d.shiftId, { maxLen: 128 }),
    actorName: sanitizePlainText(d.actorName, { maxLen: 80 }),
    actorUid: sanitizePlainText(d.actorUid, { maxLen: 128 }),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
  };
}

export function mapAccessRequestDoc(
  d: Record<string, unknown>,
  fallbackUid = ''
): WorkspaceAccessRequest {
  const status: AccessRequestStatus =
    d.status === 'approved' || d.status === 'rejected' ? d.status : 'pending';
  return {
    uid: sanitizePlainText(d.uid || fallbackUid, { maxLen: 128 }),
    email: sanitizePlainText(d.email, { maxLen: 160 }).toLowerCase(),
    displayName: sanitizePlainText(d.displayName, { maxLen: 100 }),
    requestedName: sanitizePlainText(d.requestedName, { maxLen: 80 }),
    status,
    ...(isValidStaffRole(d.assignedRole) ? { assignedRole: d.assignedRole } : {}),
    ...(d.reviewedByName ? { reviewedByName: sanitizePlainText(d.reviewedByName, { maxLen: 80 }) } : {}),
    ...(d.reviewedByUid ? { reviewedByUid: sanitizePlainText(d.reviewedByUid, { maxLen: 128 }) } : {}),
    ...(d.rejectionReason ? { rejectionReason: sanitizePlainText(d.rejectionReason, { maxLen: 240 }) } : {}),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
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
        id: sanitizePlainText(line.id || `line_${idx}`, { maxLen: 128 }),
        kind: normalizeExpenseKind(line.kind),
        description: sanitizePlainText(line.description, { maxLen: 160 }),
        ...(line.inventoryItemId
          ? { inventoryItemId: sanitizePlainText(line.inventoryItemId, { maxLen: 128 }) }
          : {}),
        ...(line.unit === 'g' || line.unit === 'ud' ? { unit: line.unit } : {}),
        quantity: Number(line.quantity) || 0,
        totalCost: Number(line.totalCost) || 0,
        calculatedUnitCost: Number(line.calculatedUnitCost) || 0,
      }))
    : [];

  return {
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    receiptCode: sanitizePlainText(d.receiptCode, { maxLen: 60 }),
    supplierId: sanitizePlainText(d.supplierId, { maxLen: 128 }),
    supplierDocument: sanitizePlainText(d.supplierDocument, { maxLen: 40 }),
    supplierName: sanitizePlainText(d.supplierName, { maxLen: 120 }),
    supplierPhone: sanitizePlainText(d.supplierPhone, { maxLen: 40 }),
    supplierEmail: sanitizePlainText(d.supplierEmail, { maxLen: 160 }),
    paymentMethod: sanitizePlainText(d.paymentMethod, { maxLen: 40 }),
    notes: sanitizePlainText(d.notes, { maxLen: 300, allowNewlines: true }),
    lines,
    inventoriableTotal: Number(d.inventoriableTotal) || 0,
    expensesTotal: Number(d.expensesTotal) || 0,
    grandTotal: Number(d.grandTotal) || 0,
    actorName: sanitizePlainText(d.actorName, { maxLen: 80 }),
    actorUid: sanitizePlainText(d.actorUid, { maxLen: 128 }),
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapMovementDoc(d: Record<string, unknown>): Movement {
  return {
    id: sanitizePlainText(d.id, { maxLen: 128 }),
    orderId: sanitizePlainText(d.orderId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 1,
    orderReference: sanitizePlainText(d.orderReference, { maxLen: 100 }),
    type: d.type as Movement['type'],
    description: sanitizePlainText(d.description, { maxLen: 500 }),
    waiterId: sanitizePlainText(d.waiterId, { maxLen: 128 }),
    waiterName: sanitizePlainText(d.waiterName, { maxLen: 80 }),
    actorUid: sanitizePlainText(d.actorUid, { maxLen: 128 }),
    details: (d.details || {}) as Record<string, string | number | boolean>,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: toMillis(d.createdAt),
  };
}

export function mapTransferDoc(d: Record<string, unknown>): TransferReceipt {
  return {
    id: sanitizePlainText(d.id, { maxLen: 128 }),
    orderId: sanitizePlainText(d.orderId, { maxLen: 128 }),
    orderNumber: Number(d.orderNumber) || 1,
    orderReference: sanitizePlainText(d.orderReference, { maxLen: 100 }),
    amount: Number(d.amount) || 0,
    imageUrl: sanitizeSafeUrl(d.imageUrl, {
      allowDataImage: true,
      allowRelative: false,
      maxLen: 250000,
    }),
    storagePath: sanitizePlainText(d.storagePath, { maxLen: 500 }),
    waiterId: sanitizePlainText(d.waiterId, { maxLen: 128 }),
    waiterName: sanitizePlainText(d.waiterName, { maxLen: 80 }),
    paymentStatus: d.paymentStatus as PaymentStatus,
    notes: sanitizePlainText(d.notes, { maxLen: 300, allowNewlines: true }),
    annulled: Boolean(d.annulled),
    annulledByName: d.annulledByName ? sanitizePlainText(d.annulledByName, { maxLen: 80 }) : undefined,
    annulledReason: d.annulledReason ? sanitizePlainText(d.annulledReason, { maxLen: 240 }) : undefined,
    annulledAtMs: d.annulledAtMs ? Number(d.annulledAtMs) : undefined,
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
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
    id: sanitizePlainText(d.id || fallbackId, { maxLen: 128 }),
    status,
    openingBaseAmount: Number(d.openingBaseAmount) || 0,
    openingNote: sanitizePlainText(d.openingNote, { maxLen: 300, allowNewlines: true }),
    openedByStaffId: sanitizePlainText(d.openedByStaffId, { maxLen: 128 }),
    openedByName: sanitizePlainText(d.openedByName, { maxLen: 80 }),
    openedByUid: sanitizePlainText(d.openedByUid, { maxLen: 128 }),
    openedAtMs,
    closedAtMs,
    closedByStaffId: sanitizePlainText(d.closedByStaffId, { maxLen: 128 }),
    closedByName: sanitizePlainText(d.closedByName, { maxLen: 80 }),
    closedByUid: sanitizePlainText(d.closedByUid, { maxLen: 128 }),
    closingNote: sanitizePlainText(d.closingNote, { maxLen: 300, allowNewlines: true }),
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
    ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    createdAtMs: openedAtMs,
    updatedAtMs: toMillis(d.updatedAt),
  };
}

export function mapPayrollCompanyDoc(
  d: Record<string, unknown>,
  fallbackId = ''
): PayrollCompany {
  const mapped = normalizePayrollCompanyRecord(
    { ...d, id: d.id || fallbackId },
    {
      ownerUid: sanitizePlainText(d.ownerUid, { maxLen: 128 }),
      createdByUid: sanitizePlainText(d.createdByUid, { maxLen: 128 }),
      allowedEmails: sanitizeStringList(d.allowedEmails, 25, 160).map((e) => e.toLowerCase()),
    }
  );
  return {
    ...mapped,
    createdAtMs: toMillis(d.createdAt),
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

export type WorkspaceResolutionResult =
  | { status: 'approved'; workspaceInfo: WorkspaceBootstrapInfo }
  | {
      status: 'pending' | 'rejected' | 'deactivated';
      ownerUid: string;
      allowSelfRegistration: boolean;
      accessRequest: WorkspaceAccessRequest | null;
      reason?: string;
    };

export async function resolveOrBootstrapCloudWorkspace(
  user: User
): Promise<WorkspaceResolutionResult | null> {
  if (!db) return null;
  const wsRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID);
  const dirRef = doc(db, 'workspaceDirectory', SHARED_WORKSPACE_ID);
  const memberRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'members', user.uid);
  const accessReqRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'accessRequests', user.uid);
  const userEmail = sanitizePlainText(user.email || '', { maxLen: 160 }).toLowerCase();
  const safeDisplayName =
    sanitizePlainText(user.displayName || userEmail.split('@')[0] || 'Usuario', { maxLen: 80 }) ||
    'Usuario';
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
          displayName: safeDisplayName.slice(0, 100) || 'Administrador',
          role: 'admin',
          active: true,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
        });

        const adminStaffId = `staff_${user.uid}`;
        batch.set(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'staff', adminStaffId), {
          id: adminStaffId,
          name: safeDisplayName || 'Administrador',
          role: 'admin',
          active: true,
          linkedUid: user.uid,
          linkedEmail: userEmail,
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
          status: 'approved',
          workspaceInfo: {
            ownerUid: user.uid,
            authorizedEmails: initialEmails,
            allowSelfRegistration: true,
            memberRole: 'admin',
            billingConfig: DEFAULT_BILLING_CONFIG,
            selfServiceConfig: DEFAULT_SELF_SERVICE_CONFIG,
          },
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
          name: sanitizePlainText(data.name || "O'NDE LUIGI", { maxLen: 120 }),
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
          displayName: safeDisplayName.slice(0, 100) || 'Administrador',
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
          name: safeDisplayName || 'Administrador',
          role: 'admin',
          active: true,
          linkedUid: user.uid,
          linkedEmail: userEmail,
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
          linkedEmail: userEmail,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        status: 'approved',
        workspaceInfo: {
          ownerUid: data.ownerUid,
          authorizedEmails: emails,
          allowSelfRegistration: currentAllowSelf,
          memberRole: 'admin',
          billingConfig: normalizeBillingConfig(data.billingConfig),
          selfServiceConfig: normalizeSelfServiceConfig(data.selfServiceConfig),
        },
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
      return null;
    }
  }

  // 2. Non-admin user flow: zero direct access to POS until Admin approves & assigns role
  const [memberSnap, dirSnap, accessReqSnap] = await Promise.all([
    getDoc(memberRef).catch((err) => {
      handleFirestoreError(err, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}/members/${user.uid}`);
      throw err;
    }),
    getDoc(dirRef).catch((err) => {
      handleFirestoreError(err, OperationType.GET, `workspaceDirectory/${SHARED_WORKSPACE_ID}`);
      throw err;
    }),
    getDoc(accessReqRef).catch(() => null),
  ]);

  const dirAllowSelf = dirSnap.exists()
    ? Boolean((dirSnap.data() as { allowSelfRegistration?: boolean }).allowSelfRegistration)
    : false;
  const dirOwnerUid = dirSnap.exists()
    ? String((dirSnap.data() as { ownerUid?: string }).ownerUid || '')
    : '';
  const existingReq =
    accessReqSnap && accessReqSnap.exists()
      ? mapAccessRequestDoc(accessReqSnap.data() as Record<string, unknown>, user.uid)
      : null;

  if (memberSnap.exists()) {
    const mData = memberSnap.data() as { active?: boolean; role?: string };
    if (mData.active === false) {
      return {
        status: 'deactivated',
        ownerUid: dirOwnerUid,
        allowSelfRegistration: dirAllowSelf,
        accessRequest: existingReq,
        reason:
          'Tu acceso fue desactivado por el administrador. Pídele que vuelva a activarte en Ajustes.',
      };
    }

    const resolvedRole: AccountRole = mData.role === 'admin' ? 'admin' : 'mesero';
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
        status: 'approved',
        workspaceInfo: {
          ownerUid: wsData.ownerUid,
          authorizedEmails: emails,
          allowSelfRegistration: dirAllowSelf,
          memberRole: wsData.ownerUid === user.uid ? 'admin' : resolvedRole,
          billingConfig: normalizeBillingConfig(wsData.billingConfig),
          selfServiceConfig: normalizeSelfServiceConfig(wsData.selfServiceConfig),
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('no ha sido inicializado')) {
        throw error;
      }
      handleFirestoreError(error, OperationType.GET, `workspaces/${SHARED_WORKSPACE_ID}`);
      return null;
    }
  }

  if (!dirSnap.exists() || !dirOwnerUid) {
    throw new Error(
      `El administrador (${ADMIN_BOOTSTRAP_EMAIL}) debe abrir la aplicación una vez para activar el acceso del equipo.`
    );
  }

  // If open self-registration is disabled, verify the email is pre-authorized before queuing a waiting request
  if (!dirAllowSelf && dirOwnerUid !== user.uid) {
    let preAuthorizedSnap;
    try {
      preAuthorizedSnap = await getDoc(wsRef);
    } catch {
      throw new Error(
        `El registro abierto está desactivado. Pide al administrador (${ADMIN_BOOTSTRAP_EMAIL}) que active el registro con enlace o agregue tu correo (${userEmail}) en Ajustes.`
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
  }

  if (existingReq && existingReq.status === 'rejected') {
    return {
      status: 'rejected',
      ownerUid: dirOwnerUid,
      allowSelfRegistration: dirAllowSelf,
      accessRequest: existingReq,
      reason:
        existingReq.rejectionReason ||
        'Tu solicitud de acceso fue rechazada por el administrador.',
    };
  }

  if (!existingReq || existingReq.status !== 'pending') {
    const now = Date.now();
    const pendingPayload: WorkspaceAccessRequest = {
      uid: user.uid,
      email: userEmail,
      displayName: safeDisplayName.slice(0, 100),
      requestedName: safeDisplayName.slice(0, 80),
      status: 'pending',
      ownerUid: dirOwnerUid,
      createdAtMs: existingReq?.createdAtMs || now,
      updatedAtMs: now,
    };
    try {
      await setDoc(accessReqRef, {
        uid: pendingPayload.uid,
        email: pendingPayload.email,
        displayName: pendingPayload.displayName,
        requestedName: pendingPayload.requestedName,
        status: 'pending',
        ownerUid: dirOwnerUid,
        createdAt: existingReq ? Timestamp.fromMillis(pendingPayload.createdAtMs) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `workspaces/${SHARED_WORKSPACE_ID}/accessRequests/${user.uid}`
      );
    }
    return {
      status: 'pending',
      ownerUid: dirOwnerUid,
      allowSelfRegistration: dirAllowSelf,
      accessRequest: pendingPayload,
    };
  }

  return {
    status: 'pending',
    ownerUid: dirOwnerUid,
    allowSelfRegistration: dirAllowSelf,
    accessRequest: existingReq,
  };
}
