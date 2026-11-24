export type OrderStatus = 'tomado' | 'preparacion' | 'listo' | 'entregado' | 'cancelado';

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

export type AppTab =
  | 'pedidos'
  | 'comandas'
  | 'historial'
  | 'transferencias'
  | 'ventas'
  | 'menu';

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

export interface AddonOption {
  id: string;
  name: string;
  price: number;
  allowMultiple?: boolean;
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
  customerId?: string;
  customerDocument?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  voidReason?: string;
  voidedByName?: string;
  voidedAtMs?: number;
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

