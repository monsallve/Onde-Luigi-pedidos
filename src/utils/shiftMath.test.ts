import test from 'node:test';
import assert from 'node:assert/strict';
import type { Movement, Order } from '../types/pos';
import {
  computeShiftExpectedSummary,
  evaluateShiftClose,
  formatShiftDuration,
} from './shiftMath';

const baseOrder: Order = {
  id: 'ord_1',
  orderNumber: 101,
  reference: 'Mesa 1',
  waiterId: 'st_1',
  waiterName: 'Mesero',
  status: 'entregado',
  paymentStatus: 'pagado',
  paymentMethod: 'efectivo',
  items: [],
  subtotal: 30000,
  total: 30000,
  notes: '',
  receiptCount: 0,
  latestReceiptUrl: '',
  ownerUid: 'owner_1',
  createdByUid: 'uid_1',
  allowedEmails: ['admin@test.com'],
  createdAtMs: 2000,
  updatedAtMs: 2000,
};

test('computeShiftExpectedSummary exposes ONLY payment methods actually used in the shift', () => {
  const orders: Order[] = [
    { ...baseOrder, id: 'o1', paymentMethod: 'efectivo', total: 40000, createdAtMs: 2000 },
    { ...baseOrder, id: 'o2', paymentMethod: 'transferencia', total: 25000, createdAtMs: 3000 },
    // Cancelled card order must NOT trigger tarjeta input
    {
      ...baseOrder,
      id: 'o3',
      status: 'cancelado',
      paymentMethod: 'tarjeta',
      total: 50000,
      createdAtMs: 3500,
    },
    // Unpaid order counts toward pendingOrdersCount, not usedPaymentMethods
    {
      ...baseOrder,
      id: 'o4',
      status: 'tomado',
      paymentStatus: 'pendiente',
      paymentMethod: '',
      total: 18000,
      createdAtMs: 4000,
    },
    // Order from before shift should be ignored unless settled during shift
    {
      ...baseOrder,
      id: 'o_old',
      paymentMethod: 'tarjeta',
      total: 90000,
      createdAtMs: 500,
      updatedAtMs: 500,
    },
  ];

  const summary = computeShiftExpectedSummary({
    orders,
    movements: [],
    openedAtMs: 1000,
    closedAtMs: 5000,
    openingBaseAmount: 100000,
  });

  assert.deepEqual(summary.usedPaymentMethods, ['efectivo', 'transferencia']);
  assert.equal(summary.usedPaymentMethods.includes('tarjeta'), false);
  assert.equal(summary.usedPaymentMethods.includes('otro'), false);
  assert.equal(summary.expectedBaseAmount, 100000);
  assert.equal(summary.expectedByMethod.efectivo, 40000);
  assert.equal(summary.expectedByMethod.transferencia, 25000);
  assert.equal(summary.expectedTotal, 165000);
  assert.equal(summary.paidOrdersCount, 2);
  assert.equal(summary.pendingOrdersCount, 1);
  assert.equal(summary.pendingAmount, 18000);
});

test('includes pre-shift unpaid order if payment movement occurred inside active shift window', () => {
  const orders: Order[] = [
    {
      ...baseOrder,
      id: 'o_prev',
      paymentStatus: 'pagado',
      paymentMethod: 'tarjeta',
      total: 42000,
      createdAtMs: 500,
      updatedAtMs: 3000,
    },
  ];
  const movements: Movement[] = [
    {
      id: 'mov_pay',
      orderId: 'o_prev',
      orderNumber: 99,
      orderReference: 'Mesa 2',
      type: 'estado_pago',
      description: 'Cobró por tarjeta',
      waiterId: 'st_1',
      waiterName: 'Caja',
      actorUid: 'uid_1',
      details: { paymentStatus: 'pagado' },
      ownerUid: 'owner_1',
      createdByUid: 'uid_1',
      allowedEmails: [],
      createdAtMs: 3000,
    },
  ];

  const summary = computeShiftExpectedSummary({
    orders,
    movements,
    openedAtMs: 1000,
    closedAtMs: 5000,
    openingBaseAmount: 50000,
  });

  assert.deepEqual(summary.usedPaymentMethods, ['tarjeta']);
  assert.equal(summary.expectedByMethod.tarjeta, 42000);
  assert.equal(summary.expectedTotal, 92000);
});

test('evaluateShiftClose computes exact base, per-method, and total differences for admin audit', () => {
  const orders: Order[] = [
    { ...baseOrder, id: 'o1', paymentMethod: 'efectivo', total: 60000, createdAtMs: 2000 },
    { ...baseOrder, id: 'o2', paymentMethod: 'transferencia', total: 35000, createdAtMs: 2500 },
  ];

  const evaluation = evaluateShiftClose({
    orders,
    movements: [],
    openedAtMs: 1000,
    closedAtMs: 4000,
    openingBaseAmount: 100000,
    declaredClosingBase: 95000,
    declaredByMethod: {
      efectivo: 60000,
      transferencia: 35000,
      tarjeta: 99999, // unused method must be ignored
    },
  });

  assert.deepEqual(evaluation.usedPaymentMethods, ['efectivo', 'transferencia']);
  assert.equal(evaluation.expectedTotal, 195000);
  assert.equal(evaluation.declaredTotal, 190000);
  assert.equal(evaluation.baseDifference, -5000);
  assert.equal(evaluation.methodDifferences.efectivo, 0);
  assert.equal(evaluation.methodDifferences.transferencia, 0);
  assert.equal(evaluation.differenceTotal, -5000);
  assert.equal(evaluation.declaredByMethod.tarjeta, undefined);
});

test('formatShiftDuration formats minutes and hours cleanly', () => {
  assert.equal(formatShiftDuration(0, 45 * 60000), '45 min');
  assert.equal(formatShiftDuration(0, 135 * 60000), '2 h 15 min');
});

test('handles same-method refund of paid voided order as net zero without polluting usedPaymentMethods', () => {
  const orders: Order[] = [
    { ...baseOrder, id: 'o_valid', paymentMethod: 'efectivo', total: 30000, createdAtMs: 2000 },
    {
      ...baseOrder,
      id: 'o_void_same',
      status: 'cancelado',
      paymentStatus: 'pagado',
      paymentMethod: 'transferencia',
      refundMethod: 'transferencia',
      refundAmount: 25000,
      total: 25000,
      createdAtMs: 2500,
      voidedAtMs: 3000,
    },
  ];

  const summary = computeShiftExpectedSummary({
    orders,
    movements: [],
    openedAtMs: 1000,
    closedAtMs: 5000,
    openingBaseAmount: 100000,
  });

  assert.deepEqual(summary.usedPaymentMethods, ['efectivo']);
  assert.equal(summary.expectedByMethod.efectivo, 30000);
  assert.equal(summary.expectedByMethod.transferencia, undefined);
  assert.equal(summary.refundsTotal, 25000);
  assert.equal(summary.refundsByMethod.transferencia, 25000);
  assert.equal(summary.expectedTotal, 130000);
});

test('handles cross-method refund (paid transferencia, refunded efectivo) including base deduction safely', () => {
  const orders: Order[] = [
    {
      ...baseOrder,
      id: 'o_cross',
      status: 'cancelado',
      paymentStatus: 'pagado',
      paymentMethod: 'transferencia',
      refundMethod: 'efectivo',
      refundAmount: 40000,
      total: 40000,
      createdAtMs: 2000,
      voidedAtMs: 3000,
    },
    {
      ...baseOrder,
      id: 'o_cash_sale',
      paymentMethod: 'efectivo',
      total: 15000,
      createdAtMs: 2200,
    },
  ];

  const summary = computeShiftExpectedSummary({
    orders,
    movements: [],
    openedAtMs: 1000,
    closedAtMs: 5000,
    openingBaseAmount: 100000,
  });

  // Transferencia received 40000; cash received 15000 but refunded 40000 -> -25000 deducted from opening base
  assert.equal(summary.expectedByMethod.transferencia, 40000);
  assert.equal(summary.expectedByMethod.efectivo, 0);
  assert.equal(summary.expectedBaseAmount, 75000);
  assert.equal(summary.expectedTotal, 115000);
  assert.equal(summary.refundsTotal, 40000);
  assert.equal(summary.refundsByMethod.efectivo, 40000);
});

