import type {
  ExpenseLineKind,
  InventoryUnit,
  Order,
  PurchaseInvoiceLine,
  Shift,
  TrackedPaymentMethod,
  WorkspaceNotification,
  WorkspaceNotificationType,
} from '../types/pos';
import { calculatePurchaseUnitCost, roundStockQty } from './inventoryMath';
import { TRACKED_PAYMENT_METHOD_LABELS } from './shiftMath';
import { sanitizePlainText } from './inputSecurity';

export const EXPENSE_LINE_KIND_LABELS: Record<ExpenseLineKind, string> = {
  inventariable: 'Insumo inventariable',
  no_inventariable: 'Insumo no inventariable',
  servicio: 'Servicio público',
  gasto: 'Gasto operativo',
  inversion: 'Inversión del negocio',
};

export const PURCHASE_PAYMENT_METHOD_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  credito: 'Crédito / Por pagar',
  otro: 'Otro',
};

export function normalizeReceiptCode(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_/#.]/g, '')
    .toUpperCase()
    .slice(0, 60);
}

export function buildAutoReceiptCode(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `COL-${String(d.getFullYear()).slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function normalizeInvoiceLine(
  line: Omit<PurchaseInvoiceLine, 'calculatedUnitCost'> & { calculatedUnitCost?: number }
): PurchaseInvoiceLine {
  const quantity =
    Number.isFinite(line.quantity) && line.quantity > 0 ? roundStockQty(line.quantity) : 0;
  const totalCost =
    Number.isFinite(line.totalCost) && line.totalCost >= 0 ? Math.round(line.totalCost) : 0;
  const calculatedUnitCost =
    quantity > 0 ? calculatePurchaseUnitCost(quantity, totalCost) : 0;
  const unit: InventoryUnit | undefined =
    line.kind === 'inventariable' ? (line.unit === 'ud' ? 'ud' : 'g') : undefined;

  return {
    id: line.id,
    kind: line.kind,
    description: sanitizePlainText(line.description, { maxLen: 120 }),
    ...(line.kind === 'inventariable' && line.inventoryItemId
      ? { inventoryItemId: line.inventoryItemId }
      : {}),
    ...(unit ? { unit } : {}),
    quantity,
    totalCost,
    calculatedUnitCost,
  };
}

export function calculateInvoiceTotals(lines: PurchaseInvoiceLine[]): {
  inventoriableTotal: number;
  expensesTotal: number;
  grandTotal: number;
} {
  let inventoriableTotal = 0;
  let expensesTotal = 0;
  for (const line of lines) {
    const cost = Math.max(0, Math.round(Number(line.totalCost) || 0));
    if (line.kind === 'inventariable') {
      inventoriableTotal += cost;
    } else {
      expensesTotal += cost;
    }
  }
  return {
    inventoriableTotal,
    expensesTotal,
    grandTotal: inventoriableTotal + expensesTotal,
  };
}

export interface AggregatedInventoryPurchase {
  inventoryItemId: string;
  addedQuantity: number;
  totalCost: number;
  weightedUnitCost: number;
}

export function aggregateInventoriablePurchases(
  lines: PurchaseInvoiceLine[]
): AggregatedInventoryPurchase[] {
  const grouped = new Map<string, { qty: number; cost: number }>();
  for (const line of lines) {
    if (line.kind !== 'inventariable' || !line.inventoryItemId || line.quantity <= 0) {
      continue;
    }
    const prev = grouped.get(line.inventoryItemId) || { qty: 0, cost: 0 };
    grouped.set(line.inventoryItemId, {
      qty: roundStockQty(prev.qty + line.quantity),
      cost: prev.cost + Math.max(0, Math.round(line.totalCost || 0)),
    });
  }

  return Array.from(grouped.entries()).map(([inventoryItemId, val]) => ({
    inventoryItemId,
    addedQuantity: val.qty,
    totalCost: val.cost,
    weightedUnitCost: calculatePurchaseUnitCost(val.qty, val.cost),
  }));
}

export function validatePurchaseInvoiceDraft(params: {
  receiptCode: string;
  lines: PurchaseInvoiceLine[];
}): { valid: boolean; error?: string; normalizedCode: string } {
  const normalizedCode = normalizeReceiptCode(params.receiptCode);
  if (!normalizedCode) {
    return {
      valid: false,
      normalizedCode,
      error: 'Ingresa el número o código de la colilla de compra (letras y/o números).',
    };
  }
  if (!params.lines || params.lines.length === 0) {
    return {
      valid: false,
      normalizedCode,
      error: 'Agrega al menos un insumo inventariable, servicio o gasto a la colilla.',
    };
  }
  if (params.lines.length > 80) {
    return {
      valid: false,
      normalizedCode,
      error: 'Una sola colilla permite hasta 80 renglones.',
    };
  }

  for (let i = 0; i < params.lines.length; i += 1) {
    const line = params.lines[i];
    const rowNum = i + 1;
    if (!line.description.trim()) {
      return {
        valid: false,
        normalizedCode,
        error: `Falta la descripción en la fila #${rowNum}.`,
      };
    }
    if (line.kind === 'inventariable' && !line.inventoryItemId) {
      return {
        valid: false,
        normalizedCode,
        error: `Selecciona el ingrediente de inventario en la fila #${rowNum}.`,
      };
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return {
        valid: false,
        normalizedCode,
        error: `La cantidad en "${line.description}" debe ser mayor a 0.`,
      };
    }
    if (!Number.isFinite(line.totalCost) || line.totalCost < 0) {
      return {
        valid: false,
        normalizedCode,
        error: `El costo total en "${line.description}" no puede ser negativo.`,
      };
    }
  }

  return { valid: true, normalizedCode };
}

export function buildNotificationCopy(params: {
  type: WorkspaceNotificationType;
  actorName: string;
  orderNumber?: number;
  orderReference?: string;
  total?: number;
  openingBaseAmount?: number;
  paidOrdersCount?: number;
  wasPaidOrder?: boolean;
  refundMethod?: TrackedPaymentMethod;
  reason?: string;
  requesterEmail?: string;
}): { title: string; message: string } {
  const actor = sanitizePlainText(params.actorName, { maxLen: 80 }) || 'Equipo';
  const formatMoney = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

  switch (params.type) {
    case 'nueva_comanda': {
      const num = params.orderNumber ? `#${params.orderNumber}` : '';
      const ref = params.orderReference
        ? ` · ${sanitizePlainText(params.orderReference, { maxLen: 80 })}`
        : '';
      const money = params.total !== undefined ? ` · ${formatMoney(params.total)}` : '';
      return {
        title: `Nueva comanda ${num}${ref}`.trim().slice(0, 140),
        message: `${actor} registró un nuevo pedido${money}`.slice(0, 360),
      };
    }
    case 'turno_abierto': {
      const base =
        params.openingBaseAmount !== undefined ? formatMoney(params.openingBaseAmount) : '$0';
      return {
        title: 'Turno de caja abierto',
        message: `${actor} abrió turno con base inicial de ${base}`.slice(0, 360),
      };
    }
    case 'turno_cerrado': {
      const count = params.paidOrdersCount ?? 0;
      const totalStr = params.total !== undefined ? ` · Total esperado ${formatMoney(params.total)}` : '';
      return {
        title: 'Turno de caja cerrado',
        message: `${actor} cerró el turno (${count} ${count === 1 ? 'venta cobrada' : 'ventas cobradas'}${totalStr})`.slice(
          0,
          360
        ),
      };
    }
    case 'venta_anulada': {
      const num = params.orderNumber ? `#${params.orderNumber}` : '';
      const ref = params.orderReference
        ? ` · ${sanitizePlainText(params.orderReference, { maxLen: 80 })}`
        : '';
      const label = params.wasPaidOrder ? 'Venta anulada' : 'Comanda anulada';
      const refundSuffix =
        params.wasPaidOrder && params.refundMethod
          ? ` · Devolución: ${TRACKED_PAYMENT_METHOD_LABELS[params.refundMethod]}`
          : '';
      const reasonSuffix = params.reason
        ? ` · Motivo: ${sanitizePlainText(params.reason, { maxLen: 160 })}`
        : '';
      return {
        title: `${label} ${num}${ref}`.trim().slice(0, 140),
        message: `${actor} anuló ${params.wasPaidOrder ? 'la venta' : 'la comanda'} ${num}${refundSuffix}${reasonSuffix}`.slice(
          0,
          360
        ),
      };
    }
    case 'solicitud_acceso': {
      const emailSuffix = params.requesterEmail
        ? ` (${sanitizePlainText(params.requesterEmail, { maxLen: 120 })})`
        : '';
      return {
        title: 'Nueva solicitud de acceso al POS'.slice(0, 140),
        message: `${actor}${emailSuffix} espera aprobación y asignación de rol por un administrador.`.slice(
          0,
          360
        ),
      };
    }
  }
}

export function selectLiveNewNotifications(
  notifications: WorkspaceNotification[],
  sessionStartedAtMs: number,
  alreadySeenIds: Set<string>
): WorkspaceNotification[] {
  return notifications
    .filter(
      (n) =>
        !alreadySeenIds.has(n.id) &&
        n.createdAtMs >= sessionStartedAtMs - 10_000
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export function countUnreadNotifications(
  notifications: WorkspaceNotification[],
  lastReadAtMs: number
): number {
  return notifications.filter((n) => n.createdAtMs > lastReadAtMs).length;
}

export function mergeWorkspaceNotifications(params: {
  persistedNotifications: WorkspaceNotification[];
  posOrders: Order[];
  selfServiceOrders: Order[];
  shifts: Shift[];
  authorizedEmails: string[];
  maxItems?: number;
}): WorkspaceNotification[] {
  const {
    persistedNotifications,
    posOrders,
    selfServiceOrders,
    shifts,
    authorizedEmails,
    maxItems = 80,
  } = params;

  const existingOrderCreated = new Set(
    persistedNotifications
      .filter((n) => n.type === 'nueva_comanda' && Boolean(n.orderId))
      .map((n) => n.orderId)
  );
  const existingOrderVoided = new Set(
    persistedNotifications
      .filter((n) => n.type === 'venta_anulada' && Boolean(n.orderId))
      .map((n) => n.orderId)
  );
  const existingShiftOpened = new Set(
    persistedNotifications
      .filter((n) => n.type === 'turno_abierto' && Boolean(n.shiftId))
      .map((n) => n.shiftId)
  );
  const existingShiftClosed = new Set(
    persistedNotifications
      .filter((n) => n.type === 'turno_cerrado' && Boolean(n.shiftId))
      .map((n) => n.shiftId)
  );

  const synthetic: WorkspaceNotification[] = [];

  for (const s of selfServiceOrders) {
    if (!existingOrderCreated.has(s.id) && s.status !== 'cancelado') {
      synthetic.push({
        id: `notif_self_${s.id}`,
        type: 'nueva_comanda',
        title: `Autoservicio #${s.orderNumber} · ${s.deliveryType === 'domicilio' ? 'Domicilio' : 'Local'}`,
        message: `${s.customerName || 'Cliente'} envió pedido por $${Math.round(s.total).toLocaleString('es-CO')} con comprobante`,
        orderId: s.id,
        orderNumber: s.orderNumber,
        shiftId: '',
        actorName: s.customerName || 'Autoservicio',
        actorUid: 'autoservicio_public',
        ownerUid: s.ownerUid,
        createdByUid: 'autoservicio_public',
        allowedEmails: authorizedEmails,
        createdAtMs: s.createdAtMs,
      });
    }
  }

  for (const o of posOrders) {
    if (o.source !== 'autoservicio' && !existingOrderCreated.has(o.id) && o.createdAtMs > 0) {
      const copy = buildNotificationCopy({
        type: 'nueva_comanda',
        actorName: o.waiterName || 'Equipo',
        orderNumber: o.orderNumber,
        orderReference: o.reference,
        total: o.total,
      });
      synthetic.push({
        id: `notif_sync_order_${o.id}`,
        type: 'nueva_comanda',
        title: copy.title,
        message: copy.message,
        orderId: o.id,
        orderNumber: o.orderNumber,
        shiftId: '',
        actorName: o.waiterName || 'Equipo',
        actorUid: o.createdByUid || '',
        ownerUid: o.ownerUid,
        createdByUid: o.createdByUid || '',
        allowedEmails: authorizedEmails,
        createdAtMs: o.createdAtMs,
      });
    }
  }

  const allOrders = [...posOrders, ...selfServiceOrders];
  for (const o of allOrders) {
    if (o.status === 'cancelado' && !existingOrderVoided.has(o.id)) {
      const voidTs = o.voidedAtMs || o.updatedAtMs || o.createdAtMs;
      if (voidTs > 0) {
        const copy = buildNotificationCopy({
          type: 'venta_anulada',
          actorName: o.voidedByName || o.waiterName || 'Equipo',
          orderNumber: o.orderNumber,
          orderReference: o.reference,
          wasPaidOrder: o.paymentStatus === 'pagado',
          refundMethod: o.refundMethod,
          reason: o.voidReason,
        });
        synthetic.push({
          id: `notif_sync_void_${o.id}`,
          type: 'venta_anulada',
          title: copy.title,
          message: copy.message,
          orderId: o.id,
          orderNumber: o.orderNumber,
          shiftId: '',
          actorName: o.voidedByName || o.waiterName || 'Equipo',
          actorUid: o.createdByUid || '',
          ownerUid: o.ownerUid,
          createdByUid: o.createdByUid || '',
          allowedEmails: authorizedEmails,
          createdAtMs: voidTs,
        });
      }
    }
  }

  for (const sh of shifts) {
    const openTs = sh.openedAtMs || sh.createdAtMs;
    if (!existingShiftOpened.has(sh.id) && openTs > 0) {
      const copy = buildNotificationCopy({
        type: 'turno_abierto',
        actorName: sh.openedByName || 'Equipo',
        openingBaseAmount: sh.openingBaseAmount,
      });
      synthetic.push({
        id: `notif_sync_shift_open_${sh.id}`,
        type: 'turno_abierto',
        title: copy.title,
        message: copy.message,
        orderId: '',
        orderNumber: 0,
        shiftId: sh.id,
        actorName: sh.openedByName || 'Equipo',
        actorUid: sh.openedByUid || '',
        ownerUid: sh.ownerUid,
        createdByUid: sh.createdByUid || '',
        allowedEmails: authorizedEmails,
        createdAtMs: openTs,
      });
    }
    if (sh.status === 'cerrado' && !existingShiftClosed.has(sh.id)) {
      const closeTs = sh.closedAtMs || sh.updatedAtMs || openTs;
      if (closeTs > 0) {
        const copy = buildNotificationCopy({
          type: 'turno_cerrado',
          actorName: sh.closedByName || sh.openedByName || 'Equipo',
          paidOrdersCount: sh.paidOrdersCount,
          total: sh.expectedTotal,
        });
        synthetic.push({
          id: `notif_sync_shift_close_${sh.id}`,
          type: 'turno_cerrado',
          title: copy.title,
          message: copy.message,
          orderId: '',
          orderNumber: 0,
          shiftId: sh.id,
          actorName: sh.closedByName || sh.openedByName || 'Equipo',
          actorUid: sh.closedByUid || '',
          ownerUid: sh.ownerUid,
          createdByUid: sh.createdByUid || '',
          allowedEmails: authorizedEmails,
          createdAtMs: closeTs,
        });
      }
    }
  }

  return [...persistedNotifications, ...synthetic]
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(0, maxItems);
}
