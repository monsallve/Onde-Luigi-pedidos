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

export function formatWithoutIngredientLabel(ingredient: string): string {
  const clean = ingredient.trim();
  if (!clean) return '';
  if (/^sin\s+/i.test(clean)) {
    return `Sin ${clean.slice(4).trim()}`;
  }
  return `Sin ${clean}`;
}

export function formatCustomizationSummary(item: OrderItem): string {
  const parts: string[] = [];
  if (item.removedIngredients.length > 0) {
    parts.push(item.removedIngredients.map((ing) => formatWithoutIngredientLabel(ing)).join(', '));
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

/**
 * Resolves local public asset paths against Vite's configured BASE_URL
 * so assets load cleanly on root domains AND subpath deployments (e.g. GitHub Pages).
 */
export function resolveAssetUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const metaEnv = (import.meta as { env?: { BASE_URL?: string } }).env;
  const base = metaEnv?.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = pathOrUrl.replace(/^\/+/, '');
  return `${normalizedBase}${cleanPath}`;
}

export function addOrMergeCartItem(prev: OrderItem[], candidate: OrderItem): OrderItem[] {
  const sig = buildItemSignature(candidate);
  const idx = prev.findIndex((i) => buildItemSignature(i) === sig);
  if (idx < 0) {
    return [...prev, candidate];
  }
  return prev.map((item, i) => {
    if (i !== idx) return item;
    const nextQty = item.quantity + candidate.quantity;
    return {
      ...item,
      quantity: nextQty,
      lineTotal: item.unitPrice * nextQty,
    };
  });
}

export function splitCartLineUnit(prev: OrderItem[], lineId: string): OrderItem[] {
  const target = prev.find((i) => i.lineId === lineId);
  if (!target || target.quantity <= 1) return prev;
  const result: OrderItem[] = [];
  for (const item of prev) {
    if (item.lineId !== lineId) {
      result.push(item);
    } else {
      const reducedQty = item.quantity - 1;
      result.push({
        ...item,
        quantity: reducedQty,
        lineTotal: item.unitPrice * reducedQty,
      });
      result.push({
        ...item,
        lineId: createSafeId('item'),
        quantity: 1,
        lineTotal: item.unitPrice,
      });
    }
  }
  return result;
}

export function adjustCartLineQuantity(
  prev: OrderItem[],
  lineId: string,
  delta: number
): OrderItem[] {
  return prev
    .map((item) => {
      if (item.lineId !== lineId) return item;
      const nextQty = item.quantity + delta;
      if (nextQty <= 0) return null;
      return {
        ...item,
        quantity: nextQty,
        lineTotal: item.unitPrice * nextQty,
      };
    })
    .filter((x): x is OrderItem => x !== null);
}

export const PRODUCT_IMAGE_MAX_URL_LENGTH = 250000;
export const PRODUCT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export function validateImageFileCandidate(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const cleanType = (file.type || '').trim().toLowerCase();
  const hasImageMime = cleanType.startsWith('image/');
  const hasImageExt = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');

  if (!hasImageMime && !hasImageExt) {
    return { ok: false, error: 'Selecciona un archivo de imagen válido (JPG, PNG, WEBP, etc.).' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'El archivo de imagen está vacío o dañado.' };
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'La imagen supera el tamaño máximo permitido (25 MB).' };
  }
  return { ok: true };
}

export function normalizeProductImageUrl(
  nextImageUrl: string | undefined,
  existingImageUrl?: string
): string {
  const raw = nextImageUrl !== undefined ? nextImageUrl : existingImageUrl || '';
  return raw.trim().slice(0, PRODUCT_IMAGE_MAX_URL_LENGTH);
}

export interface ProductInteractionStats {
  soldUnits: number;
  orderCount: number;
}

/**
 * Aggregates sold quantities and order appearances per productId across non-cancelled orders.
 */
export function computeProductSalesCounts(
  orders: Pick<Order, 'status' | 'items'>[]
): Record<string, ProductInteractionStats> {
  const stats: Record<string, ProductInteractionStats> = {};
  for (const order of orders) {
    if (order.status === 'cancelado') continue;
    const seenInOrder = new Set<string>();
    for (const item of order.items) {
      if (!item.productId) continue;
      if (!stats[item.productId]) {
        stats[item.productId] = { soldUnits: 0, orderCount: 0 };
      }
      const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 0;
      stats[item.productId].soldUnits += qty;
      if (!seenInOrder.has(item.productId)) {
        seenInOrder.add(item.productId);
        stats[item.productId].orderCount += 1;
      }
    }
  }
  return stats;
}

/**
 * Ranks products descending by interaction score:
 * historical sold units * 10 + local quick-add/customize interactions,
 * preserving original catalog order on ties.
 */
export function rankProductsByInteraction<T extends Pick<Product, 'id'>>(
  products: T[],
  salesCounts: Record<string, ProductInteractionStats>,
  localInteractions: Record<string, number> = {}
): {
  rankedProducts: T[];
  salesCounts: Record<string, ProductInteractionStats>;
} {
  const indexed = products.map((product, index) => {
    const soldUnits = salesCounts[product.id]?.soldUnits || 0;
    const localHits = Math.max(0, Math.floor(localInteractions[product.id] || 0));
    const score = soldUnits * 10 + localHits;
    return { product, index, score };
  });

  indexed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return {
    rankedProducts: indexed.map((entry) => entry.product),
    salesCounts,
  };
}

export const DEFAULT_MENU_CATEGORIES = [
  'Hamburguesas',
  'Perros y Papas',
  'Bebidas',
  'Combos',
  'Adicionales',
] as const;

export function collectMenuCategories(
  products: Pick<Product, 'category'>[],
  defaults: readonly string[] = DEFAULT_MENU_CATEGORIES
): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];

  for (const source of [...products.map((p) => p.category), ...defaults]) {
    const clean = (source || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(clean);
  }

  return categories;
}

export function normalizeProductNameKey(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasDuplicateProductName(
  name: string,
  products: Pick<Product, 'id' | 'name'>[],
  excludeProductId?: string
): boolean {
  const key = normalizeProductNameKey(name);
  if (!key) return false;
  return products.some(
    (p) => p.id !== excludeProductId && normalizeProductNameKey(p.name) === key
  );
}

export function suggestCopyProductName(
  sourceName: string,
  products: Pick<Product, 'id' | 'name'>[]
): string {
  const baseClean = (sourceName || '').trim().replace(/\s+/g, ' ');
  if (!baseClean) return '';

  const candidateFirst = `${baseClean.slice(0, 92)} (Copia)`;
  if (!hasDuplicateProductName(candidateFirst, products)) {
    return candidateFirst;
  }

  let index = 2;
  while (index < 100) {
    const suffix = ` (Copia ${index})`;
    const candidate = `${baseClean.slice(0, 100 - suffix.length)}${suffix}`;
    if (!hasDuplicateProductName(candidate, products)) {
      return candidate;
    }
    index += 1;
  }
  return candidateFirst;
}

export interface RecipeIngredientDraft {
  name: string;
  removable: boolean;
}

export function mergeProductIngredientsForEditor(
  baseRecipe: string[],
  removableOptions: string[]
): RecipeIngredientDraft[] {
  const removableKeys = new Set(
    removableOptions.map((r) => normalizeProductNameKey(r)).filter(Boolean)
  );
  const seen = new Set<string>();
  const result: RecipeIngredientDraft[] = [];

  for (const raw of baseRecipe) {
    const clean = (raw || '').trim();
    const key = normalizeProductNameKey(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push({
      name: clean,
      removable: removableKeys.has(key),
    });
  }

  for (const rawRemovable of removableOptions) {
    const clean = (rawRemovable || '').trim();
    const key = normalizeProductNameKey(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push({
      name: clean,
      removable: true,
    });
  }

  return result;
}

export function splitProductIngredientsFromEditor(
  ingredients: RecipeIngredientDraft[]
): {
  baseRecipe: string[];
  removableOptions: string[];
} {
  const seen = new Set<string>();
  const baseRecipe: string[] = [];
  const removableOptions: string[] = [];

  for (const item of ingredients) {
    const clean = (item.name || '').trim().slice(0, 80);
    const key = normalizeProductNameKey(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    if (baseRecipe.length < 30) {
      baseRecipe.push(clean);
      if (item.removable && removableOptions.length < 30) {
        removableOptions.push(clean);
      }
    }
  }

  return { baseRecipe, removableOptions };
}


