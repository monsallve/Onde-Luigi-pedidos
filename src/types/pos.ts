export type OrderStatus =
  | 'pendiente_validacion'
  | 'tomado'
  | 'preparacion'
  | 'listo'
  | 'entregado'
  | 'cancelado';

export type OrderSource = 'pos' | 'autoservicio';

export type DeliveryType = 'local' | 'domicilio';

export interface SelfServicePaymentConfig {
  enabled: boolean;
  qrImageUrl: string;
  brebKey: string;
  accountHolder: string;
  bankName: string;
  paymentInstructions: string;
  deliveryInstructions: string;
}

export interface PublicStorefrontConfig extends SelfServicePaymentConfig {
  id: string;
  businessName: string;
  ownerUid: string;
  updatedAtMs: number;
}

export interface PublicQueueTicket {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  deliveryType: DeliveryType;
  createdAtMs: number;
  updatedAtMs: number;
}

export type PaymentStatus = 'pendiente' | 'pagado';

export type PaymentMethod = '' | 'efectivo' | 'transferencia' | 'tarjeta' | 'otro';

export type StaffRole = 'admin' | 'mesero' | 'cajero' | 'cocina';

export type AccountRole = 'admin' | 'mesero';

export type MovementType =
  | 'creacion'
  | 'edicion_items'
  | 'estado_pedido'
  | 'estado_pago'
  | 'comprobante';

export type DateRangePreset = 'hoy' | 'ayer' | 'semana' | 'mes' | 'personalizado';

export type TrackedPaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'otro';

export type ShiftStatus = 'abierto' | 'cerrado';

export type InventoryUnit = 'g' | 'ud';

export type InventoryMovementType =
  | 'compra'
  | 'consumo_pedido'
  | 'edicion_pedido'
  | 'anulacion_pedido'
  | 'ajuste_manual'
  | 'fusion';

export type AppTab =
  | 'pedidos'
  | 'comandas'
  | 'historial'
  | 'transferencias'
  | 'ventas'
  | 'menu'
  | 'inventario'
  | 'datos_pago'
  | 'nomina';

export type ConnectionMode = 'cloud';

export interface BusinessBillingConfig {
  businessName: string;
  legalName: string;
  nit: string;
  regime: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  receiptPrefix: string;
  footerNote: string;
}

export interface Customer {
  id: string;
  documentNumber: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  nameKey: string;
  unit: InventoryUnit;
  currentStock: number;
  minStock: number;
  unitCost: number;
  lastPurchaseQuantity: number;
  lastPurchaseTotalCost: number;
  active: boolean;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  ingredientName: string;
  unit: InventoryUnit;
  type: InventoryMovementType;
  quantityDelta: number;
  purchaseTotalCost: number;
  calculatedUnitCost: number;
  orderId: string;
  orderNumber: number;
  notes: string;
  actorName: string;
  actorUid: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
}

export interface RecipeIngredientSpec {
  inventoryItemId: string;
  name: string;
  quantity: number;
  unit: InventoryUnit;
  removable: boolean;
  inventoriable?: boolean;
}

export interface AddonOption {
  id: string;
  name: string;
  price: number;
  allowMultiple?: boolean;
  inventoryItemId?: string;
  inventoryQuantity?: number;
}

export interface Sauce {
  id: string;
  name: string;
  active: boolean;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  imageUrl: string;
  baseRecipe: string[];
  removableOptions: string[];
  recipeIngredients?: RecipeIngredientSpec[];
  addonOptions: AddonOption[];
  allowSauces: boolean;
  minSauces: number;
  maxSauces: number;
  active: boolean;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface OrderItemAddon {
  id: string;
  name: string;
  price: number;
  quantity?: number;
}

export interface OrderItem {
  lineId: string;
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  basePrice: number;
  removedIngredients: string[];
  addedExtras: OrderItemAddon[];
  selectedSauces: string[];
  customNote: string;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  reference: string;
  waiterId: string;
  waiterName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  items: OrderItem[];
  subtotal: number;
  total: number;
  notes: string;
  receiptCount: number;
  latestReceiptUrl: string;
  receiptStoragePath?: string;
  source?: OrderSource;
  deliveryType?: DeliveryType;
  deliveryAddress?: string;
  deliveryNeighborhood?: string;
  deliveryPhone?: string;
  deliveryNotes?: string;
  customerId?: string;
  customerDocument?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  inventoryDeducted?: Record<string, number>;
  voidReason?: string;
  voidedByName?: string;
  voidedAtMs?: number;
  refundMethod?: TrackedPaymentMethod;
  refundAmount?: number;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface Movement {
  id: string;
  orderId: string;
  orderNumber: number;
  orderReference: string;
  type: MovementType;
  description: string;
  waiterId: string;
  waiterName: string;
  actorUid: string;
  details: Record<string, string | number | boolean>;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
}

export interface TransferReceipt {
  id: string;
  orderId: string;
  orderNumber: number;
  orderReference: string;
  amount: number;
  imageUrl: string;
  storagePath: string;
  waiterId: string;
  waiterName: string;
  paymentStatus: PaymentStatus;
  notes: string;
  annulled?: boolean;
  annulledByName?: string;
  annulledReason?: string;
  annulledAtMs?: number;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  linkedUid?: string;
  linkedEmail?: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface Shift {
  id: string;
  status: ShiftStatus;
  openingBaseAmount: number;
  openingNote: string;
  openedByStaffId: string;
  openedByName: string;
  openedByUid: string;
  openedAtMs: number;
  closedAtMs: number;
  closedByStaffId: string;
  closedByName: string;
  closedByUid: string;
  closingNote: string;
  usedPaymentMethods: TrackedPaymentMethod[];
  declaredClosingBase: number;
  declaredByMethod: Partial<Record<TrackedPaymentMethod, number>>;
  expectedBaseAmount: number;
  expectedByMethod: Partial<Record<TrackedPaymentMethod, number>>;
  expectedTotal: number;
  declaredTotal: number;
  differenceTotal: number;
  paidOrdersCount: number;
  pendingOrdersCount: number;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export type WorkspaceNotificationType =
  | 'nueva_comanda'
  | 'turno_abierto'
  | 'turno_cerrado'
  | 'venta_anulada'
  | 'solicitud_acceso';

export interface WorkspaceNotification {
  id: string;
  type: WorkspaceNotificationType;
  title: string;
  message: string;
  orderId: string;
  orderNumber: number;
  shiftId: string;
  actorName: string;
  actorUid: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
}

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export type StartupAccessStatus =
  | 'unauthenticated'
  | 'loading'
  | 'pending'
  | 'rejected'
  | 'deactivated'
  | 'approved';

export interface WorkspaceAccessRequest {
  uid: string;
  email: string;
  displayName: string;
  requestedName: string;
  status: AccessRequestStatus;
  assignedRole?: StaffRole;
  reviewedByName?: string;
  reviewedByUid?: string;
  rejectionReason?: string;
  ownerUid: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export type PushPlatform = 'android' | 'ios' | 'desktop' | 'unknown';

export interface PushSubscriptionRecord {
  id: string;
  uid: string;
  staffId: string;
  staffName: string;
  email: string;
  role: StaffRole;
  active: boolean;
  token: string;
  platform: PushPlatform;
  deviceLabel: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export type ExpenseLineKind =
  | 'inventariable'
  | 'no_inventariable'
  | 'servicio'
  | 'gasto'
  | 'inversion';

export interface PurchaseInvoiceLine {
  id: string;
  kind: ExpenseLineKind;
  description: string;
  inventoryItemId?: string;
  unit?: InventoryUnit;
  quantity: number;
  totalCost: number;
  calculatedUnitCost: number;
}

export interface PurchaseInvoice {
  id: string;
  receiptCode: string;
  supplierId: string;
  supplierDocument: string;
  supplierName: string;
  supplierPhone: string;
  supplierEmail: string;
  paymentMethod: string;
  notes: string;
  lines: PurchaseInvoiceLine[];
  inventoriableTotal: number;
  expensesTotal: number;
  grandTotal: number;
  actorName: string;
  actorUid: string;
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}


