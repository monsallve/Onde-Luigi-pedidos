import type { Order, OrderItem, OrderItemAddon, OrderStatus, PaymentMethod, Product } from '../types/pos';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  tomado: 'Tomado',
  preparacion: 'En preparación',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Anulado',
};

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'tomado',
  'preparacion',
  'listo',
  'entregado',
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  '': 'Sin definir',
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

export function createSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function getAddonQuantity(extra: Pick<OrderItemAddon, 'quantity'>): number {
  return Number.isFinite(extra.quantity) && (extra.quantity as number) > 0
    ? Math.floor(extra.quantity as number)
    : 1;
}

export function isOrderInCourse(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  if (order.status === 'cancelado') return false;
  return !(order.status === 'entregado' && order.paymentStatus === 'pagado');
}

export function getNextCyclicOrderRefNumber(lastNumber: number): number {
  if (!Number.isFinite(lastNumber) || lastNumber < 1 || lastNumber >= 99) {
    return 1;
  }
  return Math.floor(lastNumber) + 1;
}

export function formatAutoOrderReference(num: number): string {
  const normalized = Number.isFinite(num) && num >= 1 && num <= 99 ? Math.floor(num) : 1;
  return `Pedido #${normalized}`;
}

export function calculateItemUnitPrice(
  basePrice: number,
  addedExtras: OrderItemAddon[]
): number {
  const safeBase = Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : 0;
  const extrasSum = addedExtras.reduce((sum, extra) => {
    const val = Number.isFinite(extra.price) && extra.price >= 0 ? extra.price : 0;
    return sum + val * getAddonQuantity(extra);
  }, 0);
  return Math.round(safeBase + extrasSum);
}

export function calculateItemLineTotal(
  basePrice: number,
  addedExtras: OrderItemAddon[],
  quantity: number
): number {
  const unit = calculateItemUnitPrice(basePrice, addedExtras);
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  return unit * safeQty;
}

export function buildOrderItem(params: {
  lineId?: string;
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  basePrice: number;
  removedIngredients: string[];
  addedExtras: OrderItemAddon[];
  selectedSauces?: string[];
  customNote: string;
}): OrderItem {
  const safeQty = Math.max(1, Math.floor(params.quantity));
  const normalizedExtras = params.addedExtras
    .filter((ex) => (ex.quantity === undefined ? true : ex.quantity > 0))
    .map((ex) => ({
      ...ex,
      quantity: getAddonQuantity(ex),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const unitPrice = calculateItemUnitPrice(params.basePrice, normalizedExtras);
  const lineTotal = unitPrice * safeQty;
  return {
    lineId: params.lineId || createSafeId('item'),
    productId: params.productId,
    productName: params.productName,
    category: params.category,
    quantity: safeQty,
    basePrice: params.basePrice,
    removedIngredients: [...params.removedIngredients].sort(),
    addedExtras: normalizedExtras,
    selectedSauces: [...(params.selectedSauces || [])].sort(),
    customNote: params.customNote.trim().slice(0, 160),
    unitPrice,
    lineTotal,
  };
}

export function calculateOrderTotals(items: OrderItem[]): {
  subtotal: number;
  total: number;
} {
  const subtotal = items.reduce((sum, item) => {
    const line = calculateItemLineTotal(item.basePrice, item.addedExtras, item.quantity);
    return sum + line;
  }, 0);
  return { subtotal, total: subtotal };
}

export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `$ ${safe.toLocaleString('es-CO')}`;
}

export function formatDateTimeShort(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCustomizationSummary(item: OrderItem): string {
  const parts: string[] = [];
  if (item.removedIngredients.length > 0) {
    parts.push(item.removedIngredients.map((ing) => `Sin ${ing}`).join(', '));
  }
  if (item.selectedSauces && item.selectedSauces.length > 0) {
    parts.push(`Salsas (${item.selectedSauces.length}): ${item.selectedSauces.join(', ')}`);
  }
  if (item.addedExtras.length > 0) {
    parts.push(
      item.addedExtras
        .map((ex) => {
          const qty = getAddonQuantity(ex);
          const prefix = qty > 1 ? `+${qty}x ${ex.name}` : `+${ex.name}`;
          const totalAddonPrice = ex.price * qty;
          return totalAddonPrice > 0 ? `${prefix} (${formatCurrency(totalAddonPrice)})` : prefix;
        })
        .join(', ')
    );
  }
  if (item.customNote) {
    parts.push(`Nota: "${item.customNote}"`);
  }
  return parts.join(' · ');
}

export function buildItemSignature(item: {
  productId: string;
  removedIngredients: string[];
  addedExtras: OrderItemAddon[];
  selectedSauces?: string[];
  customNote: string;
}): string {
  const removed = [...item.removedIngredients].sort().join('|');
  const extras = [...item.addedExtras]
    .map((e) => `${e.id}:${getAddonQuantity(e)}`)
    .sort()
    .join('|');
  const sauces = [...(item.selectedSauces || [])].sort().join('|');
  const note = item.customNote.trim().toLowerCase();
  return `${item.productId}::${removed}::${extras}::${sauces}::${note}`;
}

export function validateItemSauces(
  item: Pick<OrderItem, 'selectedSauces' | 'productName'>,
  product?: Pick<Product, 'allowSauces' | 'minSauces' | 'maxSauces'>
): { valid: boolean; message?: string } {
  if (!product || !product.allowSauces) {
    return { valid: true };
  }
  const min = Math.max(0, product.minSauces ?? 1);
  const max = Math.max(min, product.maxSauces ?? 4);
  const count = item.selectedSauces?.length || 0;

  if (count < min) {
    return {
      valid: false,
      message: `${item.productName}: elige al menos ${min} ${min === 1 ? 'salsa' : 'salsas'} (máximo ${max}).`,
    };
  }
  if (count > max) {
    return {
      valid: false,
      message: `${item.productName}: máximo ${max} salsas por unidad.`,
    };
  }
  return { valid: true };
}

export function validateOrderItemsSauces(
  items: OrderItem[],
  products: Product[]
): { valid: boolean; message?: string; invalidLineIds: string[] } {
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const invalidLineIds: string[] = [];
  let firstMessage: string | undefined;

  for (const item of items) {
    const product = prodMap.get(item.productId);
    const res = validateItemSauces(item, product);
    if (!res.valid) {
      invalidLineIds.push(item.lineId);
      if (!firstMessage) firstMessage = res.message;
    }
  }

  return {
    valid: invalidLineIds.length === 0,
    message: firstMessage,
    invalidLineIds,
  };
}

export function diffOrderItems(prevItems: OrderItem[], nextItems: OrderItem[]): string {
  const prevMap = new Map(prevItems.map((i) => [i.lineId, i]));
  const nextMap = new Map(nextItems.map((i) => [i.lineId, i]));
  const changes: string[] = [];

  for (const [id, next] of nextMap.entries()) {
    const prev = prevMap.get(id);
    if (!prev) {
      const cust = formatCustomizationSummary(next);
      changes.push(`Agregó ${next.quantity}x ${next.productName}${cust ? ` (${cust})` : ''}`);
    } else {
      if (prev.quantity !== next.quantity) {
        changes.push(`Cambió cantidad de ${next.productName}: ${prev.quantity} -> ${next.quantity}`);
      }
      const prevCust = formatCustomizationSummary(prev);
      const nextCust = formatCustomizationSummary(next);
      if (prevCust !== nextCust) {
        changes.push(`Ajustó receta de ${next.productName}: ${nextCust || 'Receta base'}`);
      }
    }
  }

  for (const [id, prev] of prevMap.entries()) {
    if (!nextMap.has(id)) {
      changes.push(`Eliminó ${prev.quantity}x ${prev.productName}`);
    }
  }

  return changes.length > 0 ? changes.join('; ') : 'Actualizó detalle del pedido';
}
