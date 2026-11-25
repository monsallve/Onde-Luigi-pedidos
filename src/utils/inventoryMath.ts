import type {
  InventoryItem,
  InventoryUnit,
  OrderItem,
  Product,
  RecipeIngredientSpec,
} from '../types/pos';
import { createSafeId, getAddonQuantity } from './orderMath';

export function roundStockQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

export function roundUnitCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10000) / 10000;
}

export function normalizeIngredientKey(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export interface CanonicalIngredientResolution {
  canonicalName: string;
  canonicalKey: string;
  suggestedMultiplier: number;
}

const CANONICAL_ALIASES: Array<{
  pattern: RegExp;
  canonicalName: string;
  multiplier: number;
}> = [
  { pattern: /^doble\s+carne(\s+de\s+res)?$/, canonicalName: 'Carne de res', multiplier: 2 },
  { pattern: /^carne(\s+de\s+res)?$/, canonicalName: 'Carne de res', multiplier: 1 },
  {
    pattern: /^doble\s+queso(\s+(fundido|derretido|cheddar))?$/,
    canonicalName: 'Queso',
    multiplier: 2,
  },
  { pattern: /^queso(\s+(fundido|derretido))?$/, canonicalName: 'Queso', multiplier: 1 },
  {
    pattern: /^doble\s+tocineta(\s+crocante)?$/,
    canonicalName: 'Tocineta',
    multiplier: 2,
  },
  { pattern: /^tocineta(\s+crocante)?$/, canonicalName: 'Tocineta', multiplier: 1 },
  { pattern: /^pap(a|itas)\s+ripio$/, canonicalName: 'Papitas ripio', multiplier: 1 },
];

export function canonicalizeRecipeIngredient(rawName: string): CanonicalIngredientResolution {
  const clean = (rawName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const key = normalizeIngredientKey(clean);
  if (!key) {
    return { canonicalName: '', canonicalKey: '', suggestedMultiplier: 1 };
  }
  for (const rule of CANONICAL_ALIASES) {
    if (rule.pattern.test(key)) {
      return {
        canonicalName: rule.canonicalName,
        canonicalKey: normalizeIngredientKey(rule.canonicalName),
        suggestedMultiplier: rule.multiplier,
      };
    }
  }
  return {
    canonicalName: clean,
    canonicalKey: key,
    suggestedMultiplier: 1,
  };
}

export function inferDefaultInventoryUnit(ingredientName: string): InventoryUnit {
  const key = normalizeIngredientKey(ingredientName);
  if (
    /\b(pan|salchicha|huevo|botella|bebida|filete|gaseosa|agua|vaso)\b/.test(key) ||
    key === 'carne de res'
  ) {
    return 'ud';
  }
  return 'g';
}

export function hasDuplicateInventoryName(
  name: string,
  items: Pick<InventoryItem, 'id' | 'name' | 'nameKey'>[],
  excludeId?: string
): boolean {
  const key = normalizeIngredientKey(name);
  if (!key) return false;
  return items.some(
    (item) =>
      item.id !== excludeId &&
      (normalizeIngredientKey(item.nameKey || item.name) === key)
  );
}

/**
 * Automatically calculates unit cost per gram ('g') or per unit ('ud')
 * from total purchase cost and purchased quantity.
 */
export function calculatePurchaseUnitCost(quantity: number, totalCost: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(totalCost) || totalCost < 0) return 0;
  return roundUnitCost(totalCost / quantity);
}

export function formatInventoryNumber(value: number): string {
  const safe = roundStockQty(value);
  return safe.toLocaleString('es-CO', {
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 1,
    maximumFractionDigits: 3,
  });
}

export function formatInventoryQuantity(quantity: number, unit: InventoryUnit): string {
  return `${formatInventoryNumber(quantity)} ${unit}`;
}

export function formatUnitCost(cost: number, unit: InventoryUnit): string {
  const safe = roundUnitCost(cost);
  const formatted = safe.toLocaleString('es-CO', {
    minimumFractionDigits: safe > 0 && safe < 100 && !Number.isInteger(safe) ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `$ ${formatted} / ${unit}`;
}

export function buildInventoryItemId(canonicalName: string): string {
  const slug = normalizeIngredientKey(canonicalName)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug ? `inv_${slug}` : createSafeId('inv');
}

export function isRecipeSpecInventoriable(
  spec: Pick<RecipeIngredientSpec, 'inventoryItemId' | 'inventoriable'>
): boolean {
  return spec.inventoriable !== false && Boolean(spec.inventoryItemId);
}

export function getRecipeSpecKey(
  spec: Pick<RecipeIngredientSpec, 'inventoryItemId' | 'inventoriable' | 'name'>
): string {
  if (isRecipeSpecInventoriable(spec)) {
    return `inv:${spec.inventoryItemId}`;
  }
  return `noninv:${normalizeIngredientKey(spec.name)}`;
}

export function splitProductRecipeFromSpecs(specs: RecipeIngredientSpec[]): {
  baseRecipe: string[];
  removableOptions: string[];
  recipeIngredients: RecipeIngredientSpec[];
} {
  const seenKeys = new Set<string>();
  const baseRecipe: string[] = [];
  const removableOptions: string[] = [];
  const recipeIngredients: RecipeIngredientSpec[] = [];

  for (const spec of specs) {
    const cleanName = (spec.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!cleanName) continue;

    const inventoriable = isRecipeSpecInventoriable(spec);
    const key = inventoriable
      ? `inv:${spec.inventoryItemId}`
      : `noninv:${normalizeIngredientKey(cleanName)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const safeQty =
      inventoriable && Number.isFinite(spec.quantity) && spec.quantity >= 0
        ? roundStockQty(spec.quantity)
        : 0;
    const unit: InventoryUnit = spec.unit === 'ud' ? 'ud' : 'g';

    if (recipeIngredients.length < 30) {
      recipeIngredients.push({
        inventoryItemId: inventoriable ? spec.inventoryItemId : '',
        name: cleanName,
        quantity: safeQty,
        unit,
        removable: Boolean(spec.removable),
        ...(inventoriable ? {} : { inventoriable: false }),
      });
      baseRecipe.push(cleanName);
      if (spec.removable) {
        removableOptions.push(cleanName);
      }
    }
  }

  return { baseRecipe, removableOptions, recipeIngredients };
}

export function resolveProductRecipeSpecs(
  product: Pick<Product, 'baseRecipe' | 'removableOptions' | 'recipeIngredients'>,
  inventoryMap?: Map<string, InventoryItem>
): RecipeIngredientSpec[] {
  if (Array.isArray(product.recipeIngredients) && product.recipeIngredients.length > 0) {
    return product.recipeIngredients.map((spec) => {
      const inventoriable = isRecipeSpecInventoriable(spec);
      const inv = inventoriable ? inventoryMap?.get(spec.inventoryItemId) : undefined;
      return {
        inventoryItemId: inventoriable ? spec.inventoryItemId : '',
        name: inv?.name || spec.name,
        quantity:
          inventoriable && Number.isFinite(spec.quantity) && spec.quantity >= 0
            ? roundStockQty(spec.quantity)
            : 0,
        unit: inv?.unit || (spec.unit === 'ud' ? 'ud' : 'g'),
        removable: Boolean(spec.removable),
        ...(inventoriable ? {} : { inventoriable: false }),
      };
    });
  }
  return [];
}

/**
 * Computes exact inventory consumption { [inventoryItemId]: quantity } for an order's items.
 * Skips any ingredient explicitly removed by the customer (e.g. "Sin Lechuga"),
 * and includes any add-on extras linked to an inventory item.
 */
export function computeOrderInventoryConsumption(
  items: OrderItem[],
  products: Product[]
): Record<string, number> {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const consumed: Record<string, number> = {};

  const addConsumption = (inventoryItemId: string | undefined, qty: number) => {
    if (!inventoryItemId || !Number.isFinite(qty) || qty <= 0) return;
    consumed[inventoryItemId] = roundStockQty((consumed[inventoryItemId] || 0) + qty);
  };

  for (const item of items) {
    const orderQty = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 0;
    if (orderQty <= 0) continue;
    const product = productMap.get(item.productId);
    if (!product) continue;

    const removedKeys = new Set(
      (item.removedIngredients || []).flatMap((raw) => {
        const rawKey = normalizeIngredientKey(raw);
        const canonical = canonicalizeRecipeIngredient(raw).canonicalKey;
        return [rawKey, canonical].filter(Boolean);
      })
    );

    const specs = Array.isArray(product.recipeIngredients) ? product.recipeIngredients : [];
    for (const spec of specs) {
      if (!isRecipeSpecInventoriable(spec) || !Number.isFinite(spec.quantity) || spec.quantity <= 0) {
        continue;
      }
      const specKey = normalizeIngredientKey(spec.name);
      const specCanonical = canonicalizeRecipeIngredient(spec.name).canonicalKey;
      const isRemoved =
        spec.removable && (removedKeys.has(specKey) || removedKeys.has(specCanonical));
      if (isRemoved) continue;
      addConsumption(spec.inventoryItemId, spec.quantity * orderQty);
    }

    if (Array.isArray(item.addedExtras) && item.addedExtras.length > 0 && Array.isArray(product.addonOptions)) {
      const addonMap = new Map(product.addonOptions.map((a) => [a.id, a]));
      for (const extra of item.addedExtras) {
        const addonDef = addonMap.get(extra.id);
        if (
          addonDef?.inventoryItemId &&
          Number.isFinite(addonDef.inventoryQuantity) &&
          (addonDef.inventoryQuantity as number) > 0
        ) {
          addConsumption(
            addonDef.inventoryItemId,
            (addonDef.inventoryQuantity as number) * getAddonQuantity(extra) * orderQty
          );
        }
      }
    }
  }

  return consumed;
}

/**
 * Given previous deducted quantities and next deducted quantities,
 * returns net stock changes per inventoryItemId (negative = deduct, positive = restore).
 */
export function computeInventoryDeltas(
  prevDeducted: Record<string, number>,
  nextDeducted: Record<string, number>
): Record<string, number> {
  const keys = new Set([...Object.keys(prevDeducted), ...Object.keys(nextDeducted)]);
  const deltas: Record<string, number> = {};

  for (const id of keys) {
    const prev = Number.isFinite(prevDeducted[id]) ? prevDeducted[id] : 0;
    const next = Number.isFinite(nextDeducted[id]) ? nextDeducted[id] : 0;
    const stockChange = roundStockQty(prev - next);
    if (stockChange !== 0) {
      deltas[id] = stockChange;
    }
  }

  return deltas;
}

export function calculateProductRecipeCost(
  specs: Pick<RecipeIngredientSpec, 'inventoryItemId' | 'quantity' | 'inventoriable'>[],
  inventoryMap: Map<string, Pick<InventoryItem, 'unitCost'>>
): number {
  let total = 0;
  for (const spec of specs) {
    if (!isRecipeSpecInventoriable(spec)) continue;
    const inv = inventoryMap.get(spec.inventoryItemId);
    if (!inv || !Number.isFinite(spec.quantity) || spec.quantity <= 0) continue;
    total += spec.quantity * (inv.unitCost || 0);
  }
  return Math.round(total);
}

export interface ProductUnificationPatch {
  productId: string;
  baseRecipe: string[];
  removableOptions: string[];
  recipeIngredients: RecipeIngredientSpec[];
}

export interface UnifiedInventoryPlan {
  newItemsToCreate: Array<{
    id: string;
    name: string;
    nameKey: string;
    unit: InventoryUnit;
  }>;
  productPatches: ProductUnificationPatch[];
}

/**
 * Scans existing products and links/unifies all recipe ingredients (both legacy baseRecipe
 * strings and existing recipeIngredients) to shared canonical InventoryItems.
 */
export function buildUnifiedInventoryPlan(
  products: Product[],
  existingInventory: InventoryItem[]
): UnifiedInventoryPlan {
  const byKey = new Map<string, InventoryItem>();
  const byId = new Map<string, InventoryItem>();
  for (const item of existingInventory) {
    const k = normalizeIngredientKey(item.nameKey || item.name);
    if (k && !byKey.has(k)) byKey.set(k, item);
    byId.set(item.id, item);
  }

  const createdByKey = new Map<
    string,
    { id: string; name: string; nameKey: string; unit: InventoryUnit }
  >();
  const usedIds = new Set(existingInventory.map((i) => i.id));

  const ensureCanonicalItem = (
    rawName: string,
    preferredUnit?: InventoryUnit,
    preferredId?: string
  ): { id: string; name: string; unit: InventoryUnit; suggestedMultiplier: number } | null => {
    if (preferredId && byId.has(preferredId)) {
      const existing = byId.get(preferredId)!;
      return {
        id: existing.id,
        name: existing.name,
        unit: existing.unit,
        suggestedMultiplier: 1,
      };
    }

    const resolved = canonicalizeRecipeIngredient(rawName);
    if (!resolved.canonicalName) return null;

    const existing = byKey.get(resolved.canonicalKey);
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        unit: existing.unit,
        suggestedMultiplier: resolved.suggestedMultiplier,
      };
    }

    const pending = createdByKey.get(resolved.canonicalKey);
    if (pending) {
      return {
        id: pending.id,
        name: pending.name,
        unit: pending.unit,
        suggestedMultiplier: resolved.suggestedMultiplier,
      };
    }

    let candidateId = buildInventoryItemId(resolved.canonicalName);
    if (usedIds.has(candidateId)) {
      candidateId = createSafeId('inv');
    }
    usedIds.add(candidateId);
    const unit = preferredUnit || inferDefaultInventoryUnit(resolved.canonicalName);
    const created = {
      id: candidateId,
      name: resolved.canonicalName,
      nameKey: resolved.canonicalKey,
      unit,
    };
    createdByKey.set(resolved.canonicalKey, created);

    return {
      id: created.id,
      name: created.name,
      unit: created.unit,
      suggestedMultiplier: resolved.suggestedMultiplier,
    };
  };

  const productPatches: ProductUnificationPatch[] = [];

  for (const product of products) {
    const existingSpecs = Array.isArray(product.recipeIngredients)
      ? product.recipeIngredients
      : [];
    const removableKeys = new Set(
      (product.removableOptions || []).flatMap((raw) => {
        const k = normalizeIngredientKey(raw);
        const ck = canonicalizeRecipeIngredient(raw).canonicalKey;
        return [k, ck].filter(Boolean);
      })
    );

    const specByInvId = new Map<string, RecipeIngredientSpec>();

    if (existingSpecs.length > 0) {
      for (const spec of existingSpecs) {
        if (!isRecipeSpecInventoriable(spec)) {
          const cleanName = (spec.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
          if (!cleanName) continue;
          const nonInvKey = `noninv:${normalizeIngredientKey(cleanName)}`;
          const prevNonInv = specByInvId.get(nonInvKey);
          const isRemovable =
            Boolean(spec.removable) || removableKeys.has(normalizeIngredientKey(cleanName));
          if (prevNonInv) {
            prevNonInv.removable = prevNonInv.removable || isRemovable;
          } else {
            specByInvId.set(nonInvKey, {
              inventoryItemId: '',
              name: cleanName,
              quantity: 0,
              unit: spec.unit === 'ud' ? 'ud' : 'g',
              removable: isRemovable,
              inventoriable: false,
            });
          }
          continue;
        }
        const target = ensureCanonicalItem(spec.name, spec.unit, spec.inventoryItemId);
        if (!target) continue;
        const prev = specByInvId.get(target.id);
        const qty = Number.isFinite(spec.quantity) && spec.quantity >= 0 ? spec.quantity : 0;
        const isRemovable =
          Boolean(spec.removable) || removableKeys.has(normalizeIngredientKey(target.name));
        if (prev) {
          prev.quantity = roundStockQty(prev.quantity + qty);
          prev.removable = prev.removable || isRemovable;
        } else {
          specByInvId.set(target.id, {
            inventoryItemId: target.id,
            name: target.name,
            quantity: roundStockQty(qty),
            unit: target.unit,
            removable: isRemovable,
          });
        }
      }
    } else {
      for (const rawIng of product.baseRecipe || []) {
        const target = ensureCanonicalItem(rawIng);
        if (!target) continue;
        const isRemovable =
          removableKeys.has(normalizeIngredientKey(rawIng)) ||
          removableKeys.has(normalizeIngredientKey(target.name));
        const defaultQty = target.unit === 'ud' ? target.suggestedMultiplier : 0;
        const prev = specByInvId.get(target.id);
        if (prev) {
          prev.quantity = roundStockQty(prev.quantity + defaultQty);
          prev.removable = prev.removable || isRemovable;
        } else {
          specByInvId.set(target.id, {
            inventoryItemId: target.id,
            name: target.name,
            quantity: defaultQty,
            unit: target.unit,
            removable: isRemovable,
          });
        }
      }
      for (const rawRem of product.removableOptions || []) {
        const target = ensureCanonicalItem(rawRem);
        if (!target) continue;
        if (!specByInvId.has(target.id)) {
          specByInvId.set(target.id, {
            inventoryItemId: target.id,
            name: target.name,
            quantity: target.unit === 'ud' ? target.suggestedMultiplier : 0,
            unit: target.unit,
            removable: true,
          });
        }
      }
    }

    const next = splitProductRecipeFromSpecs(Array.from(specByInvId.values()));
    const needsUpdate =
      existingSpecs.length === 0 ||
      JSON.stringify(existingSpecs) !== JSON.stringify(next.recipeIngredients) ||
      JSON.stringify(product.baseRecipe) !== JSON.stringify(next.baseRecipe) ||
      JSON.stringify(product.removableOptions) !== JSON.stringify(next.removableOptions);

    if (needsUpdate) {
      productPatches.push({
        productId: product.id,
        ...next,
      });
    }
  }

  return {
    newItemsToCreate: Array.from(createdByKey.values()),
    productPatches,
  };
}
