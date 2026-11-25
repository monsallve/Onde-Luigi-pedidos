import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInventoriablePurchases,
  buildAutoReceiptCode,
  buildNotificationCopy,
  calculateInvoiceTotals,
  countUnreadNotifications,
  normalizeInvoiceLine,
  normalizeReceiptCode,
  selectLiveNewNotifications,
  validatePurchaseInvoiceDraft,
} from './purchaseExpenseMath';
import type { WorkspaceNotification } from '../types/pos';

test('normalizeReceiptCode preserves alphanumeric letters and numbers cleanly', () => {
  assert.equal(normalizeReceiptCode('  fev-00412 / a9 '), 'FEV-00412-/-A9');
  assert.equal(normalizeReceiptCode('pos88a#12'), 'POS88A#12');
  assert.ok(buildAutoReceiptCode(Date.UTC(2026, 4, 15, 14, 30)).startsWith('COL-'));
});

test('normalizeInvoiceLine computes unit cost and calculateInvoiceTotals splits inventoriable vs expenses', () => {
  const l1 = normalizeInvoiceLine({
    id: 'l1',
    kind: 'inventariable',
    description: 'Carne de res',
    inventoryItemId: 'inv_carne',
    unit: 'g',
    quantity: 2000,
    totalCost: 50000,
  });
  const l2 = normalizeInvoiceLine({
    id: 'l2',
    kind: 'servicio',
    description: 'Recibo de energía eléctrica',
    quantity: 1,
    totalCost: 120000,
  });
  const l3 = normalizeInvoiceLine({
    id: 'l3',
    kind: 'inversion',
    description: 'Licuadora industrial',
    quantity: 1,
    totalCost: 350000,
  });

  assert.equal(l1.calculatedUnitCost, 25);
  assert.equal(l2.unit, undefined);

  const totals = calculateInvoiceTotals([l1, l2, l3]);
  assert.equal(totals.inventoriableTotal, 50000);
  assert.equal(totals.expensesTotal, 470000);
  assert.equal(totals.grandTotal, 520000);
});

test('aggregateInventoriablePurchases merges repeated ingredient rows into a single stock update', () => {
  const l1 = normalizeInvoiceLine({
    id: 'l1',
    kind: 'inventariable',
    description: 'Queso',
    inventoryItemId: 'inv_queso',
    unit: 'g',
    quantity: 1000,
    totalCost: 20000,
  });
  const l2 = normalizeInvoiceLine({
    id: 'l2',
    kind: 'inventariable',
    description: 'Queso lote 2',
    inventoryItemId: 'inv_queso',
    unit: 'g',
    quantity: 1000,
    totalCost: 24000,
  });
  const l3 = normalizeInvoiceLine({
    id: 'l3',
    kind: 'gasto',
    description: 'Flete domicilio',
    quantity: 1,
    totalCost: 8000,
  });

  const agg = aggregateInventoriablePurchases([l1, l2, l3]);
  assert.equal(agg.length, 1);
  assert.equal(agg[0].inventoryItemId, 'inv_queso');
  assert.equal(agg[0].addedQuantity, 2000);
  assert.equal(agg[0].totalCost, 44000);
  assert.equal(agg[0].weightedUnitCost, 22);
});

test('validatePurchaseInvoiceDraft rejects missing code, empty list, and invalid quantities', () => {
  const validLine = normalizeInvoiceLine({
    id: 'l1',
    kind: 'no_inventariable',
    description: 'Bolsas para domicilio',
    quantity: 2,
    totalCost: 15000,
  });

  assert.equal(
    validatePurchaseInvoiceDraft({ receiptCode: '', lines: [validLine] }).valid,
    false
  );
  assert.equal(
    validatePurchaseInvoiceDraft({ receiptCode: 'REM-12A', lines: [] }).valid,
    false
  );
  const ok = validatePurchaseInvoiceDraft({ receiptCode: 'rem 12a', lines: [validLine] });
  assert.equal(ok.valid, true);
  assert.equal(ok.normalizedCode, 'REM-12A');
});

test('notification builders and live filter distinguish events without historical spam', () => {
  const nueva = buildNotificationCopy({
    type: 'nueva_comanda',
    actorName: 'Laura',
    orderNumber: 108,
    orderReference: 'Mesa 4',
    total: 42000,
  });
  assert.match(nueva.title, /#108/);
  assert.match(nueva.message, /Laura/);

  const anuladaVenta = buildNotificationCopy({
    type: 'venta_anulada',
    actorName: 'Admin',
    orderNumber: 105,
    wasPaidOrder: true,
    reason: 'Error en cobro',
  });
  assert.match(anuladaVenta.title, /Venta anulada #105/);

  const anuladaComanda = buildNotificationCopy({
    type: 'venta_anulada',
    actorName: 'Admin',
    orderNumber: 106,
    wasPaidOrder: false,
  });
  assert.match(anuladaComanda.title, /Comanda anulada #106/);

  const baseNotif: Omit<WorkspaceNotification, 'id' | 'createdAtMs'> = {
    type: 'turno_abierto',
    title: 'Turno de caja abierto',
    message: 'Carlos abrió turno',
    orderId: '',
    orderNumber: 0,
    shiftId: 'shift_1',
    actorName: 'Carlos',
    actorUid: 'u1',
    ownerUid: 'owner',
    createdByUid: 'u1',
    allowedEmails: [],
  };

  const sessionStart = 1_000_000;
  const list: WorkspaceNotification[] = [
    { ...baseNotif, id: 'old_1', createdAtMs: 500_000 },
    { ...baseNotif, id: 'seen_2', createdAtMs: 1_002_000 },
    { ...baseNotif, id: 'live_3', createdAtMs: 1_005_000 },
  ];

  const live = selectLiveNewNotifications(list, sessionStart, new Set(['seen_2']));
  assert.deepEqual(
    live.map((n) => n.id),
    ['live_3']
  );
  assert.equal(countUnreadNotifications(list, 1_000_500), 2);
});
