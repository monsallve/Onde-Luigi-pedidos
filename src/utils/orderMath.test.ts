import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addOrMergeCartItem,
  adjustCartLineQuantity,
  buildItemSignature,
  buildOrderItem,
  calculateItemLineTotal,
  calculateItemUnitPrice,
  calculateOrderTotals,
  diffOrderItems,
  formatAutoOrderReference,
  formatCustomizationSummary,
  getNextCyclicOrderRefNumber,
  isOrderInCourse,
  splitCartLineUnit,
  validateItemSauces,
  validateOrderItemsSauces,
} from './orderMath';
import type { Product } from '../types/pos';

test('calculates unit price and line total including paid extras and multiple extra quantities', () => {
  const extras = [
    { id: 'ex1', name: 'Extra queso', price: 4500, quantity: 2 },
    { id: 'ex2', name: 'Tocineta', price: 6000, quantity: 1 },
  ];
  assert.equal(calculateItemUnitPrice(26000, extras), 41000);
  assert.equal(calculateItemLineTotal(26000, extras, 2), 82000);
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

test('produces distinct signatures for same product with different sauces, removed ingredients, or extra quantities', () => {
  const sigA = buildItemSignature({
    productId: 'p1',
    removedIngredients: ['Cebolla'],
    addedExtras: [{ id: 'ex1', name: 'Queso', price: 4500, quantity: 1 }],
    selectedSauces: ['Tártara', 'Piña'],
    customNote: '',
  });
  const sigB = buildItemSignature({
    productId: 'p1',
    removedIngredients: ['Cebolla'],
    addedExtras: [{ id: 'ex1', name: 'Queso', price: 4500, quantity: 2 }],
    selectedSauces: ['Tártara', 'Piña'],
    customNote: '',
  });
  const sigC = buildItemSignature({
    productId: 'p1',
    removedIngredients: ['Cebolla'],
    addedExtras: [{ id: 'ex1', name: 'Queso', price: 4500, quantity: 1 }],
    selectedSauces: ['BBQ'],
    customNote: '',
  });
  assert.notEqual(sigA, sigB);
  assert.notEqual(sigA, sigC);
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

test('formats customization summary with sauces, extra quantities, and diffs edited order items cleanly', () => {
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
    addedExtras: [{ id: 'ex1', name: 'Extra queso', price: 4500, quantity: 3 }],
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
  assert.match(summary, /\+3x Extra queso/);
  const diff = diffOrderItems([original], [updated, added]);
  assert.match(diff, /Cambió cantidad de Hamburguesa Sencilla: 1 -> 2/);
  assert.match(diff, /Ajustó receta de Hamburguesa Sencilla/);
  assert.match(diff, /Agregó 1x Gaseosa/);
});

test('keeps orders in Comandas until BOTH delivered and paid', () => {
  assert.equal(isOrderInCourse({ status: 'tomado', paymentStatus: 'pagado' }), true);
  assert.equal(isOrderInCourse({ status: 'entregado', paymentStatus: 'pendiente' }), true);
  assert.equal(isOrderInCourse({ status: 'listo', paymentStatus: 'pendiente' }), true);
  assert.equal(isOrderInCourse({ status: 'entregado', paymentStatus: 'pagado' }), false);
  assert.equal(isOrderInCourse({ status: 'cancelado', paymentStatus: 'pendiente' }), false);
  assert.equal(isOrderInCourse({ status: 'cancelado', paymentStatus: 'pagado' }), false);
});

test('generates cyclic 1..99 auto reference numbers wrapping cleanly from 99 to 1', () => {
  assert.equal(getNextCyclicOrderRefNumber(0), 1);
  assert.equal(getNextCyclicOrderRefNumber(1), 2);
  assert.equal(getNextCyclicOrderRefNumber(98), 99);
  assert.equal(getNextCyclicOrderRefNumber(99), 1);
  assert.equal(formatAutoOrderReference(1), 'Pedido #1');
  assert.equal(formatAutoOrderReference(99), 'Pedido #99');
});

test('merges matching cart items, splits single units, and adjusts quantities cleanly', () => {
  const first = buildOrderItem({
    lineId: 'l1',
    productId: 'p1',
    productName: 'Hamburguesa Sencilla',
    category: 'Hamburguesas',
    quantity: 1,
    basePrice: 16000,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: [],
    customNote: '',
  });
  const duplicate = buildOrderItem({
    lineId: 'l2',
    productId: 'p1',
    productName: 'Hamburguesa Sencilla',
    category: 'Hamburguesas',
    quantity: 2,
    basePrice: 16000,
    removedIngredients: [],
    addedExtras: [],
    selectedSauces: [],
    customNote: '',
  });

  const merged = addOrMergeCartItem([first], duplicate);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 3);
  assert.equal(merged[0].lineTotal, 48000);

  const split = splitCartLineUnit(merged, 'l1');
  assert.equal(split.length, 2);
  assert.equal(split[0].quantity, 2);
  assert.equal(split[1].quantity, 1);

  const decremented = adjustCartLineQuantity(split, split[1].lineId, -1);
  assert.equal(decremented.length, 1);
  assert.equal(decremented[0].quantity, 2);
});

