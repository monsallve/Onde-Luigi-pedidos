import test from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryItem, OrderItem, Product } from '../types/pos';
import {
  buildUnifiedInventoryPlan,
  calculateProductRecipeCost,
  calculatePurchaseUnitCost,
  canonicalizeRecipeIngredient,
  computeInventoryDeltas,
  computeOrderInventoryConsumption,
  formatInventoryQuantity,
  hasDuplicateInventoryName,
  splitProductRecipeFromSpecs,
} from './inventoryMath';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod_1',
    name: 'Hamburguesa Mixta',
    category: 'Hamburguesas',
    basePrice: 26000,
    imageUrl: '',
    baseRecipe: [],
    removableOptions: [],
    recipeIngredients: [],
    addonOptions: [],
    allowSauces: true,
    minSauces: 1,
    maxSauces: 4,
    active: true,
    ownerUid: 'owner_1',
    createdByUid: 'owner_1',
    allowedEmails: ['admin@test.com'],
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function makeOrderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    lineId: 'line_1',
    productId: 'prod_1',
    productName: 'Hamburguesa Mixta',
    category: 'Hamburguesas',
    quantity: 1,
    basePrice: 26000,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: ['Ajo'],
    customNote: '',
    unitPrice: 26000,
    lineTotal: 26000,
    ...overrides,
  };
}

test('calculatePurchaseUnitCost computes price per gram and price per unit automatically', () => {
  // 2000g for $25.000 => $12.5 / g
  assert.equal(calculatePurchaseUnitCost(2000, 25000), 12.5);
  // 300g for $2.500 => $8.3333 / g
  assert.equal(calculatePurchaseUnitCost(300, 2500), 8.3333);
  // 24 units for $12.000 => $500 / ud
  assert.equal(calculatePurchaseUnitCost(24, 12000), 500);
  // Invalid inputs return 0
  assert.equal(calculatePurchaseUnitCost(0, 10000), 0);
  assert.equal(calculatePurchaseUnitCost(-5, 10000), 0);
  assert.equal(calculatePurchaseUnitCost(10, -100), 0);
});

test('canonicalizeRecipeIngredient merges equivalent existing recipe names cleanly', () => {
  assert.deepEqual(canonicalizeRecipeIngredient('Doble queso derretido'), {
    canonicalName: 'Queso',
    canonicalKey: 'queso',
    suggestedMultiplier: 2,
  });
  assert.deepEqual(canonicalizeRecipeIngredient('Queso fundido'), {
    canonicalName: 'Queso',
    canonicalKey: 'queso',
    suggestedMultiplier: 1,
  });
  assert.deepEqual(canonicalizeRecipeIngredient('Papa ripio'), {
    canonicalName: 'Papitas ripio',
    canonicalKey: 'papitas ripio',
    suggestedMultiplier: 1,
  });
  assert.deepEqual(canonicalizeRecipeIngredient('Doble carne de res'), {
    canonicalName: 'Carne de res',
    canonicalKey: 'carne de res',
    suggestedMultiplier: 2,
  });
});

test('buildUnifiedInventoryPlan links identical ingredients across multiple products to one canonical item', () => {
  const products: Product[] = [
    makeProduct({
      id: 'prod_a',
      name: 'Burger A',
      baseRecipe: ['Pan brioche', 'Carne de res', 'Doble queso', 'Lechuga'],
      removableOptions: ['Queso', 'Lechuga'],
    }),
    makeProduct({
      id: 'prod_b',
      name: 'Burger B',
      baseRecipe: ['pan  brioche', 'Doble carne de res', 'Queso fundido', 'Lechuga'],
      removableOptions: ['Lechuga'],
    }),
  ];

  const plan = buildUnifiedInventoryPlan(products, []);
  const names = plan.newItemsToCreate.map((i) => i.name).sort();
  assert.deepEqual(names, ['Carne de res', 'Lechuga', 'Pan brioche', 'Queso']);
  assert.equal(plan.productPatches.length, 2);

  const patchA = plan.productPatches.find((p) => p.productId === 'prod_a')!;
  const patchB = plan.productPatches.find((p) => p.productId === 'prod_b')!;

  const quesoA = patchA.recipeIngredients.find((r) => r.name === 'Queso')!;
  const quesoB = patchB.recipeIngredients.find((r) => r.name === 'Queso')!;
  assert.equal(quesoA.inventoryItemId, quesoB.inventoryItemId);
  assert.equal(quesoA.removable, true);

  const carneA = patchA.recipeIngredients.find((r) => r.name === 'Carne de res')!;
  const carneB = patchB.recipeIngredients.find((r) => r.name === 'Carne de res')!;
  assert.equal(carneA.inventoryItemId, carneB.inventoryItemId);
  assert.equal(carneA.quantity, 1);
  assert.equal(carneB.quantity, 2);
});

test('computeOrderInventoryConsumption deducts ingredients, skips removed (Sin ...), includes linked extras, and allows negative stock', () => {
  const products: Product[] = [
    makeProduct({
      id: 'prod_burger',
      recipeIngredients: [
        { inventoryItemId: 'inv_pan', name: 'Pan brioche', quantity: 1, unit: 'ud', removable: false },
        { inventoryItemId: 'inv_ensalada', name: 'Ensalada', quantity: 50, unit: 'g', removable: true },
        { inventoryItemId: 'inv_queso', name: 'Queso', quantity: 30, unit: 'g', removable: true },
      ],
      addonOptions: [
        { id: 'ext_queso', name: 'Extra queso', price: 4500, inventoryItemId: 'inv_queso', inventoryQuantity: 30 },
      ],
    }),
  ];

  // Order 1: 2 burgers with extra queso (x1 each), NO salad removed => 2 pan, 100g ensalada, 120g queso
  const consumed1 = computeOrderInventoryConsumption(
    [
      makeOrderItem({
        productId: 'prod_burger',
        quantity: 2,
        removedIngredients: [],
        addedExtras: [{ id: 'ext_queso', name: 'Extra queso', price: 4500, quantity: 1 }],
      }),
    ],
    products
  );
  assert.deepEqual(consumed1, {
    inv_pan: 2,
    inv_ensalada: 100,
    inv_queso: 120,
  });

  // Order 2: 3 burgers "Sin Ensalada" => Ensalada is NOT deducted!
  const consumed2 = computeOrderInventoryConsumption(
    [
      makeOrderItem({
        productId: 'prod_burger',
        quantity: 3,
        removedIngredients: ['Ensalada'],
      }),
    ],
    products
  );
  assert.deepEqual(consumed2, {
    inv_pan: 3,
    inv_queso: 90,
  });

  // Suppose stock started at 40g Ensalada and order 1 consumes 100g => -60g negative stock allowed!
  const deltas = computeInventoryDeltas({}, consumed1);
  assert.equal(deltas.inv_ensalada, -100);
  const resultingStock = 40 + deltas.inv_ensalada;
  assert.equal(resultingStock, -60);
  assert.equal(formatInventoryQuantity(resultingStock, 'g'), '-60 g');

  // Editing order from 2 burgers (100g ensalada) to 1 burger (50g ensalada) restores +50g
  const editDeltas = computeInventoryDeltas(
    { inv_pan: 2, inv_ensalada: 100, inv_queso: 120 },
    { inv_pan: 1, inv_ensalada: 50, inv_queso: 30 }
  );
  assert.deepEqual(editDeltas, {
    inv_pan: 1,
    inv_ensalada: 50,
    inv_queso: 90,
  });
});

test('hasDuplicateInventoryName, calculateProductRecipeCost, and splitProductRecipeFromSpecs behave accurately', () => {
  const inventory: InventoryItem[] = [
    {
      id: 'inv_carne',
      name: 'Carne de res',
      nameKey: 'carne de res',
      unit: 'g',
      currentStock: 5000,
      minStock: 1000,
      unitCost: 30,
      lastPurchaseQuantity: 5000,
      lastPurchaseTotalCost: 150000,
      active: true,
      ownerUid: 'o',
      createdByUid: 'o',
      allowedEmails: [],
      createdAtMs: 1,
      updatedAtMs: 1,
    },
    {
      id: 'inv_pan',
      name: 'Pan brioche',
      nameKey: 'pan brioche',
      unit: 'ud',
      currentStock: 20,
      minStock: 5,
      unitCost: 1200,
      lastPurchaseQuantity: 20,
      lastPurchaseTotalCost: 24000,
      active: true,
      ownerUid: 'o',
      createdByUid: 'o',
      allowedEmails: [],
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ];

  assert.equal(hasDuplicateInventoryName('  carne   de res ', inventory), true);
  assert.equal(hasDuplicateInventoryName('Carne de res', inventory, 'inv_carne'), false);

  const split = splitProductRecipeFromSpecs([
    { inventoryItemId: 'inv_carne', name: 'Carne de res', quantity: 150, unit: 'g', removable: false },
    { inventoryItemId: 'inv_pan', name: 'Pan brioche', quantity: 1, unit: 'ud', removable: false },
    { inventoryItemId: 'inv_lechuga', name: 'Lechuga', quantity: 30, unit: 'g', removable: true },
  ]);
  assert.deepEqual(split.baseRecipe, ['Carne de res', 'Pan brioche', 'Lechuga']);
  assert.deepEqual(split.removableOptions, ['Lechuga']);

  const invMap = new Map(inventory.map((i) => [i.id, i]));
  // 150g * $30 + 1ud * $1200 = $5700
  assert.equal(calculateProductRecipeCost(split.recipeIngredients, invMap), 5700);
});

test('non-inventoriable recipe ingredients support removable options without creating or deducting inventory', () => {
  const split = splitProductRecipeFromSpecs([
    { inventoryItemId: 'inv_pan', name: 'Pan brioche', quantity: 1, unit: 'ud', removable: false },
    {
      inventoryItemId: '',
      name: 'Cebolla caramelizada',
      quantity: 25,
      unit: 'g',
      removable: true,
      inventoriable: false,
    },
    {
      inventoryItemId: '',
      name: '  cebolla caramelizada ',
      quantity: 0,
      unit: 'g',
      removable: false,
      inventoriable: false,
    },
    {
      inventoryItemId: '',
      name: 'Orégano',
      quantity: 0,
      unit: 'g',
      removable: false,
      inventoriable: false,
    },
  ]);

  assert.deepEqual(split.baseRecipe, ['Pan brioche', 'Cebolla caramelizada', 'Orégano']);
  assert.deepEqual(split.removableOptions, ['Cebolla caramelizada']);
  assert.equal(split.recipeIngredients.length, 3);
  assert.equal(split.recipeIngredients[1].inventoriable, false);
  assert.equal(split.recipeIngredients[1].inventoryItemId, '');
  assert.equal(split.recipeIngredients[1].quantity, 0);

  const product = makeProduct({
    id: 'prod_noninv',
    baseRecipe: split.baseRecipe,
    removableOptions: split.removableOptions,
    recipeIngredients: split.recipeIngredients,
  });

  // Consumption only deducts inventoriable Pan brioche, never non-inventoriable items
  const consumed = computeOrderInventoryConsumption(
    [makeOrderItem({ productId: 'prod_noninv', quantity: 3, removedIngredients: [] })],
    [product]
  );
  assert.deepEqual(consumed, { inv_pan: 3 });

  // Unification plan keeps non-inventoriable ingredients untouched and creates zero new inventory items for them
  const plan = buildUnifiedInventoryPlan(
    [product],
    [
      {
        id: 'inv_pan',
        name: 'Pan brioche',
        nameKey: 'pan brioche',
        unit: 'ud',
        currentStock: 10,
        minStock: 2,
        unitCost: 1000,
        lastPurchaseQuantity: 10,
        lastPurchaseTotalCost: 10000,
        active: true,
        ownerUid: 'o',
        createdByUid: 'o',
        allowedEmails: [],
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]
  );
  assert.equal(plan.newItemsToCreate.length, 0);
  assert.equal(plan.productPatches.length, 0);

  // Recipe cost skips non-inventoriable items cleanly
  const invMap = new Map([['inv_pan', { unitCost: 1000 }]]);
  assert.equal(calculateProductRecipeCost(split.recipeIngredients, invMap), 1000);
});
