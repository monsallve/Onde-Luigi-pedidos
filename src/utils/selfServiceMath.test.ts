import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrderItem, PublicQueueTicket } from '../types/pos';
import {
  buildDeterministicQrMatrix,
  computeOrdersAheadCount,
  createSelfOrderId,
  formatSelfServiceOrderReference,
  getSelfServiceStepIndex,
  normalizeSelfServiceConfig,
  resolveNextSelfServiceOrderNumber,
  validateSelfServiceCheckout,
} from './selfServiceMath';

const SAMPLE_ITEM: OrderItem = {
  lineId: 'item_1',
  productId: 'prod_mixta',
  productName: 'Hamburguesa Mixta',
  category: 'Hamburguesas',
  quantity: 1,
  basePrice: 26000,
  removedIngredients: [],
  addedExtras: [],
  selectedSauces: ['Tártara'],
  customNote: '',
  unitPrice: 26000,
  lineTotal: 26000,
};

test('validateSelfServiceCheckout requires delivery mode, customer name, receipt, and forbids cash', () => {
  const emptyDraft = validateSelfServiceCheckout({
    deliveryType: '',
    customerName: '',
    deliveryPhone: '',
    deliveryAddress: '',
    deliveryNeighborhood: '',
    hasReceiptFile: false,
    items: [],
  });
  assert.equal(emptyDraft.valid, false);
  assert.ok(emptyDraft.errors.items);
  assert.ok(emptyDraft.errors.deliveryType);
  assert.ok(emptyDraft.errors.customerName);
  assert.ok(emptyDraft.errors.receipt);

  const cashAttempt = validateSelfServiceCheckout({
    deliveryType: 'local',
    customerName: 'Carlos Pérez',
    deliveryPhone: '',
    deliveryAddress: '',
    deliveryNeighborhood: '',
    paymentMethod: 'efectivo',
    hasReceiptFile: true,
    items: [SAMPLE_ITEM],
  });
  assert.equal(cashAttempt.valid, false);
  assert.ok(cashAttempt.errors.paymentMethod);

  const validLocal = validateSelfServiceCheckout({
    deliveryType: 'local',
    customerName: 'Carlos Pérez',
    deliveryPhone: '',
    deliveryAddress: '',
    deliveryNeighborhood: '',
    paymentMethod: 'transferencia',
    hasReceiptFile: true,
    items: [SAMPLE_ITEM],
  });
  assert.equal(validLocal.valid, true);
  assert.equal(validLocal.firstError, null);
});

test('validateSelfServiceCheckout enforces phone, address, and neighborhood for domicilio', () => {
  const missingDomicilio = validateSelfServiceCheckout({
    deliveryType: 'domicilio',
    customerName: 'Laura Gómez',
    deliveryPhone: '123',
    deliveryAddress: 'Cll',
    deliveryNeighborhood: '',
    paymentMethod: 'transferencia',
    hasReceiptFile: true,
    items: [SAMPLE_ITEM],
  });
  assert.equal(missingDomicilio.valid, false);
  assert.ok(missingDomicilio.errors.deliveryPhone);
  assert.ok(missingDomicilio.errors.deliveryAddress);
  assert.ok(missingDomicilio.errors.deliveryNeighborhood);

  const validDomicilio = validateSelfServiceCheckout({
    deliveryType: 'domicilio',
    customerName: 'Laura Gómez',
    deliveryPhone: '3001234567',
    deliveryAddress: 'Calle 45 # 12-30 Apto 202',
    deliveryNeighborhood: 'Cabecera',
    paymentMethod: 'transferencia',
    hasReceiptFile: true,
    items: [SAMPLE_ITEM],
  });
  assert.equal(validDomicilio.valid, true);
});

test('computeOrdersAheadCount counts only earlier active tickets without leaking other states', () => {
  const tickets: PublicQueueTicket[] = [
    { id: 't1', orderNumber: 501, status: 'listo', deliveryType: 'local', createdAtMs: 1000, updatedAtMs: 1000 },
    { id: 't2', orderNumber: 502, status: 'preparacion', deliveryType: 'local', createdAtMs: 2000, updatedAtMs: 2000 },
    { id: 't3', orderNumber: 503, status: 'tomado', deliveryType: 'domicilio', createdAtMs: 3000, updatedAtMs: 3000 },
    { id: 't4', orderNumber: 504, status: 'pendiente_validacion', deliveryType: 'local', createdAtMs: 4000, updatedAtMs: 4000 },
    { id: 't5', orderNumber: 505, status: 'cancelado', deliveryType: 'local', createdAtMs: 2500, updatedAtMs: 2500 },
  ];

  // For t4: t2 (preparacion) and t3 (tomado) are active ahead; t1 is listo and t5 is cancelado
  assert.equal(computeOrdersAheadCount(tickets, 't4'), 2);
  // Once order reaches listo, ahead count is 0
  assert.equal(computeOrdersAheadCount(tickets, 't1'), 0);
  // Unknown ticket returns 0
  assert.equal(computeOrdersAheadCount(tickets, 'unknown'), 0);
});

test('resolveNextSelfServiceOrderNumber starts at 501 and increments above max existing ticket', () => {
  assert.equal(resolveNextSelfServiceOrderNumber([]), 501);
  assert.equal(
    resolveNextSelfServiceOrderNumber([{ orderNumber: 501 }, { orderNumber: 514 }]),
    515
  );
});

test('normalizeSelfServiceConfig, formatting, QR matrix, and ID generator produce clean deterministic shapes', () => {
  const cfg = normalizeSelfServiceConfig({ brebKey: '  @MICOMERCIO  ', enabled: false });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.brebKey, '@MICOMERCIO');
  assert.ok(cfg.accountHolder.length > 0);

  const ref = formatSelfServiceOrderReference(508, 'domicilio', 'Juanita López');
  assert.equal(ref, 'Domicilio · Juanita López (#508)');

  assert.equal(getSelfServiceStepIndex('pendiente_validacion'), 0);
  assert.equal(getSelfServiceStepIndex('listo'), 3);
  assert.equal(getSelfServiceStepIndex('cancelado'), -1);

  const qrA = buildDeterministicQrMatrix('@ONDELUIGI');
  const qrB = buildDeterministicQrMatrix('@ONDELUIGI');
  assert.equal(qrA.length, 21);
  assert.deepEqual(qrA, qrB);
  assert.equal(qrA[0][0], true);

  const id1 = createSelfOrderId();
  const id2 = createSelfOrderId();
  assert.match(id1, /^self_\d+_[a-f0-9]{16}$/);
  assert.notEqual(id1, id2);
});
