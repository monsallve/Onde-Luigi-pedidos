import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemSignature,
  buildOrderItem,
  calculateItemLineTotal,
  calculateItemUnitPrice,
  calculateOrderTotals,
  diffOrderItems,
  formatCustomizationSummary,
  validateItemSauces,
  validateOrderItemsSauces,
} from './orderMath';
import type { Product } from '../types/pos';

test('calculates unit price and line total including paid extras', () => {
  const extras = [
    { id: 'ex1', name: 'Extra queso', price: 4500 },
    { id: 'ex2', name: 'Tocineta', price: 6000 },
  ];
  assert.equal(calculateItemUnitPrice(26000, extras), 36500);
  assert.equal(calculateItemLineTotal(26000, extras, 2), 73000);
});

test('calculates order subtotal and total across multiple customized items', () => {
  const item1 = buildOrderItem({
    lineId: 'l1',
    productId: 'p1',
    productName: 'Hamburguesa Mixta',
    category: 'Hamburguesas',
    quantity: 2,
    basePrice: 26000,
    removedIngredients: ['Tomate'],
    addedExtras: [{ id: 'ex1', name: 'Extra queso', price: 4500 }],
    selectedSauces: ['Tártara', 'Piña'],
    customNote: 'Bien asada',
  });
  const item2 = buildOrderItem({
    lineId: 'l2',
    productId: 'p2',
    productName: 'Gaseosa Personal',
    category: 'Bebidas',
    quantity: 1,
    basePrice: 4500,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: [],
    customNote: '',
  });
  const totals = calculateOrderTotals([item1, item2]);
  assert.equal(totals.subtotal, 65500);
  assert.equal(totals.total, 65500);
});

test('produces distinct signatures for same product with different sauces or removed ingredients', () => {
  const sigA = buildItemSignature({
    productId: 'p1',
    removedIngredients: ['Cebolla'],
    addedExtras: [],
    selectedSauces: ['Tártara', 'Piña'],
    customNote: '',
  });
  const sigB = buildItemSignature({
    productId: 'p1',
    removedIngredients: ['Cebolla'],
    addedExtras: [],
    selectedSauces: ['BBQ'],
    customNote: '',
  });
  assert.notEqual(sigA, sigB);
});

test('validates 1 to 4 sauce rules per product', () => {
  const burgerProduct: Pick<Product, 'id' | 'allowSauces' | 'minSauces' | 'maxSauces'> = {
    id: 'p_burger',
    allowSauces: true,
    minSauces: 1,
    maxSauces: 4,
  };
  const drinkProduct: Pick<Product, 'id' | 'allowSauces' | 'minSauces' | 'maxSauces'> = {
    id: 'p_drink',
    allowSauces: false,
    minSauces: 0,
    maxSauces: 0,
  };

  assert.equal(
    validateItemSauces({ productName: 'Hamburguesa Mixta', selectedSauces: [] }, burgerProduct).valid,
    false
  );
  assert.equal(
    validateItemSauces(
      { productName: 'Hamburguesa Mixta', selectedSauces: ['Tártara', 'Piña', 'BBQ', 'Ajo'] },
      burgerProduct
    ).valid,
    true
  );
  assert.equal(
    validateItemSauces(
      {
        productName: 'Hamburguesa Mixta',
        selectedSauces: ['Tártara', 'Piña', 'BBQ', 'Ajo', 'Rosada'],
      },
      burgerProduct
    ).valid,
    false
  );
  assert.equal(
    validateItemSauces({ productName: 'Gaseosa', selectedSauces: [] }, drinkProduct).valid,
    true
  );

  const itemNoSauce = buildOrderItem({
    lineId: 'l1',
    productId: 'p_burger',
    productName: 'Hamburguesa Mixta',
    category: 'Hamburguesas',
    quantity: 1,
    basePrice: 26000,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: [],
    customNote: '',
  });
  const fullValidation = validateOrderItemsSauces([itemNoSauce], [
    {
      ...burgerProduct,
      name: 'Hamburguesa Mixta',
      category: 'Hamburguesas',
      basePrice: 26000,
      imageUrl: '',
      baseRecipe: [],
      removableOptions: [],
      addonOptions: [],
      active: true,
      ownerUid: 'u',
      createdByUid: 'u',
      allowedEmails: [],
      createdAtMs: 0,
      updatedAtMs: 0,
    },
  ]);
  assert.equal(fullValidation.valid, false);
  assert.deepEqual(fullValidation.invalidLineIds, ['l1']);
});

test('formats customization summary with sauces and diffs edited order items cleanly', () => {
  const original = buildOrderItem({
    lineId: 'l1',
    productId: 'p1',
    productName: 'Hamburguesa Sencilla',
    category: 'Hamburguesas',
    quantity: 1,
    basePrice: 16000,
    removedIngredients: ['Tomate'],
    addedExtras: [],
    selectedSauces: ['Tártara'],
    customNote: '',
  });
  const updated = buildOrderItem({
    lineId: 'l1',
    productId: 'p1',
    productName: 'Hamburguesa Sencilla',
    category: 'Hamburguesas',
    quantity: 2,
    basePrice: 16000,
    removedIngredients: ['Tomate', 'Cebolla'],
    addedExtras: [{ id: 'ex1', name: 'Extra queso', price: 4500 }],
    selectedSauces: ['Tártara', 'Piña'],
    customNote: 'Bien asada',
  });
  const added = buildOrderItem({
    lineId: 'l2',
    productId: 'p2',
    productName: 'Gaseosa',
    category: 'Bebidas',
    quantity: 1,
    basePrice: 4500,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: [],
    customNote: '',
  });

  const summary = formatCustomizationSummary(updated);
  assert.match(summary, /Sin Cebolla/);
  assert.match(summary, /Salsas \(2\): Piña, Tártara/);
  const diff = diffOrderItems([original], [updated, added]);
  assert.match(diff, /Cambió cantidad de Hamburguesa Sencilla: 1 -> 2/);
  assert.match(diff, /Ajustó receta de Hamburguesa Sencilla/);
  assert.match(diff, /Agregó 1x Gaseosa/);
});
