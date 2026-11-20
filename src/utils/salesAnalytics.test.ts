import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSalesReport, resolveDateRange } from './salesAnalytics';
import { buildOrderItem } from './orderMath';
import type { Order } from '../types/pos';

const fixedNow = new Date(2026, 10, 20, 15, 0, 0).getTime(); // Nov 20, 2026 15:00 local

const sampleOrders: Order[] = [
  {
    id: 'ord_1',
    orderNumber: 101,
    reference: 'Mesa 1',
    waiterId: 'w1',
    waiterName: 'Mateo Ríos',
    status: 'entregado',
    paymentStatus: 'pagado',
    paymentMethod: 'transferencia',
    items: [
      buildOrderItem({
        lineId: 'i1',
        productId: 'p_burger',
        productName: 'Hamburguesa',
        category: 'Fuertes',
        quantity: 2,
        basePrice: 28000,
        removedIngredients: [],
        addedExtras: [],
        customNote: '',
      }),
    ],
    subtotal: 56000,
    total: 56000,
    notes: '',
    receiptCount: 1,
    latestReceiptUrl: 'https://example.com/1.jpg',
    ownerUid: 'u1',
    createdByUid: 'u1',
    allowedEmails: [],
    createdAtMs: fixedNow - 2 * 60 * 60 * 1000,
    updatedAtMs: fixedNow - 60 * 60 * 1000,
  },
  {
    id: 'ord_2',
    orderNumber: 102,
    reference: 'Mesa 2',
    waiterId: 'w2',
    waiterName: 'Camila Vega',
    status: 'preparacion',
    paymentStatus: 'pendiente',
    paymentMethod: '',
    items: [
      buildOrderItem({
        lineId: 'i2',
        productId: 'p_burger',
        productName: 'Hamburguesa',
        category: 'Fuertes',
        quantity: 1,
        basePrice: 28000,
        removedIngredients: ['Cebolla'],
        addedExtras: [{ id: 'ex', name: 'Extra queso', price: 4500 }],
        customNote: '',
      }),
      buildOrderItem({
        lineId: 'i3',
        productId: 'p_limo',
        productName: 'Limonada',
        category: 'Bebidas',
        quantity: 3,
        basePrice: 9500,
        removedIngredients: [],
        addedExtras: [],
        customNote: '',
      }),
    ],
    subtotal: 61000,
    total: 61000,
    notes: '',
    receiptCount: 0,
    latestReceiptUrl: '',
    ownerUid: 'u1',
    createdByUid: 'u1',
    allowedEmails: [],
    createdAtMs: fixedNow - 30 * 60 * 1000,
    updatedAtMs: fixedNow - 30 * 60 * 1000,
  },
  {
    id: 'ord_3_cancelled',
    orderNumber: 103,
    reference: 'Mesa 3',
    waiterId: 'w1',
    waiterName: 'Mateo Ríos',
    status: 'cancelado',
    paymentStatus: 'pendiente',
    paymentMethod: '',
    items: [
      buildOrderItem({
        lineId: 'i4',
        productId: 'p_limo',
        productName: 'Limonada',
        category: 'Bebidas',
        quantity: 10,
        basePrice: 9500,
        removedIngredients: [],
        addedExtras: [],
        customNote: '',
      }),
    ],
    subtotal: 95000,
    total: 95000,
    notes: 'Cancelado por cliente',
    receiptCount: 0,
    latestReceiptUrl: '',
    ownerUid: 'u1',
    createdByUid: 'u1',
    allowedEmails: [],
    createdAtMs: fixedNow - 45 * 60 * 1000,
    updatedAtMs: fixedNow - 40 * 60 * 1000,
  },
  {
    id: 'ord_4_yesterday',
    orderNumber: 100,
    reference: 'Mesa 4',
    waiterId: 'w2',
    waiterName: 'Camila Vega',
    status: 'entregado',
    paymentStatus: 'pagado',
    paymentMethod: 'efectivo',
    items: [
      buildOrderItem({
        lineId: 'i5',
        productId: 'p_limo',
        productName: 'Limonada',
        category: 'Bebidas',
        quantity: 2,
        basePrice: 9500,
        removedIngredients: [],
        addedExtras: [],
        customNote: '',
      }),
    ],
    subtotal: 19000,
    total: 19000,
    notes: '',
    receiptCount: 0,
    latestReceiptUrl: '',
    ownerUid: 'u1',
    createdByUid: 'u1',
    allowedEmails: [],
    createdAtMs: fixedNow - 26 * 60 * 60 * 1000,
    updatedAtMs: fixedNow - 26 * 60 * 60 * 1000,
  },
];

test('computes today sales report excluding cancelled orders and separating paid vs pending', () => {
  const { startMs, endMs } = resolveDateRange('hoy', undefined, undefined, fixedNow);
  const report = computeSalesReport(sampleOrders, startMs, endMs);

  assert.equal(report.orderCount, 2);
  assert.equal(report.cancelledCount, 1);
  assert.equal(report.totalSales, 117000);
  assert.equal(report.totalPaid, 56000);
  assert.equal(report.totalPending, 61000);
  assert.equal(report.totalUnitsSold, 6);

  const burgerRow = report.productBreakdown.find((p) => p.productId === 'p_burger');
  assert.ok(burgerRow);
  assert.equal(burgerRow.unitsSold, 3);
  assert.equal(burgerRow.totalRevenue, 88500);
  assert.deepEqual(burgerRow.orderIds, ['ord_1', 'ord_2']);

  const limoRow = report.productBreakdown.find((p) => p.productId === 'p_limo');
  assert.ok(limoRow);
  assert.equal(limoRow.unitsSold, 3);
  assert.equal(limoRow.totalRevenue, 28500);
});

test('resolves yesterday and custom date ranges accurately', () => {
  const yesterdayRange = resolveDateRange('ayer', undefined, undefined, fixedNow);
  const yesterdayReport = computeSalesReport(sampleOrders, yesterdayRange.startMs, yesterdayRange.endMs);
  assert.equal(yesterdayReport.orderCount, 1);
  assert.equal(yesterdayReport.totalPaid, 19000);

  const customRange = resolveDateRange('personalizado', '2026-11-19', '2026-11-20', fixedNow);
  const combinedReport = computeSalesReport(sampleOrders, customRange.startMs, customRange.endMs);
  assert.equal(combinedReport.orderCount, 3);
  assert.equal(combinedReport.totalSales, 136000);
});
