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

export type AppTab = 'pedidos' | 'comandas' | 'historial' | 'transferencias' | 'ventas' | 'menu';

export type ConnectionMode = 'cloud' | 'demo';

export interface AddonOption {
  id: string;
  name: string;
  price: number;
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
