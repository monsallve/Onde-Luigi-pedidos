import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateInventoriablePurchases,
  buildAutoReceiptCode,
  buildNotificationCopy,
  calculateInvoiceTotals,
  countUnreadNotifications,
  mergeWorkspaceNotifications,
  normalizeInvoiceLine,
  normalizeReceiptCode,
  selectLiveNewNotifications,
  validatePurchaseInvoiceDraft,
} from './purchaseExpenseMath';
import type { Order, Shift, WorkspaceNotification } from '../types/pos';

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
    refundMethod: 'transferencia',
    reason: 'Error en cobro',
  });
  assert.match(anuladaVenta.title, /Venta anulada #105/);
  assert.match(anuladaVenta.message, /Devolución: Transferencia/);

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

test('mergeWorkspaceNotifications synthesizes missing POS/shift/void events without duplicating persisted notifications', () => {
  const persisted: WorkspaceNotification[] = [
    {
      id: 'notif_persisted_1',
      type: 'nueva_comanda',
      title: 'Nueva comanda #10 · Mesa 1',
      message: 'Laura registró pedido',
      orderId: 'ord_10',
      orderNumber: 10,
      shiftId: '',
      actorName: 'Laura',
      actorUid: 'u1',
      ownerUid: 'owner',
      createdByUid: 'u1',
      allowedEmails: [],
      createdAtMs: 2_000,
    },
  ];

  const posOrders: Order[] = [
    {
      id: 'ord_10',
      orderNumber: 10,
      reference: 'Mesa 1',
      waiterId: 'w1',
      waiterName: 'Laura',
      status: 'tomado',
      paymentStatus: 'pendiente',
      paymentMethod: '',
      items: [],
      subtotal: 16000,
      total: 16000,
      notes: '',
      receiptCount: 0,
      latestReceiptUrl: '',
      ownerUid: 'owner',
      createdByUid: 'u1',
      allowedEmails: [],
      createdAtMs: 2_000,
      updatedAtMs: 2_000,
    },
    {
      id: 'ord_11',
      orderNumber: 11,
      reference: 'Mesa 2',
      waiterId: 'w1',
      waiterName: 'Carlos',
      status: 'cancelado',
      paymentStatus: 'pagado',
      paymentMethod: 'efectivo',
      items: [],
      subtotal: 26000,
      total: 26000,
      notes: '',
      receiptCount: 0,
      latestReceiptUrl: '',
      voidReason: 'Cliente cambió pedido',
      voidedByName: 'Admin',
      voidedAtMs: 4_000,
      ownerUid: 'owner',
      createdByUid: 'u1',
      allowedEmails: [],
      createdAtMs: 3_000,
      updatedAtMs: 4_000,
    },
  ];

  const shifts: Shift[] = [
    {
      id: 'shift_1',
      status: 'cerrado',
      openedByStaffId: 'w1',
      openedByName: 'Admin',
      openedByUid: 'u1',
      openingBaseAmount: 100000,
      openingNote: '',
      openedAtMs: 1_000,
      closedByStaffId: 'w1',
      closedByName: 'Admin',
      closedByUid: 'u1',
      closedAtMs: 5_000,
      closingNote: '',
      usedPaymentMethods: ['efectivo'],
      declaredClosingBase: 100000,
      declaredByMethod: { efectivo: 26000 },
      expectedBaseAmount: 100000,
      expectedByMethod: { efectivo: 26000 },
      expectedTotal: 126000,
      declaredTotal: 126000,
      differenceTotal: 0,
      paidOrdersCount: 1,
      pendingOrdersCount: 0,
      ownerUid: 'owner',
      createdByUid: 'u1',
      allowedEmails: [],
      createdAtMs: 1_000,
      updatedAtMs: 5_000,
    },
  ];

  const merged = mergeWorkspaceNotifications({
    persistedNotifications: persisted,
    posOrders,
    selfServiceOrders: [],
    shifts,
    authorizedEmails: [],
  });

  // ord_10 is not duplicated; ord_11 generates created + voided; shift_1 generates open + close
  assert.deepEqual(
    merged.map((n) => n.id),
    [
      'notif_sync_shift_close_shift_1',
      'notif_sync_void_ord_11',
      'notif_sync_order_ord_11',
      'notif_persisted_1',
      'notif_sync_shift_open_shift_1',
    ]
  );
});
