import type { Movement, Order, TrackedPaymentMethod } from '../types/pos';

export const TRACKED_PAYMENT_METHODS: TrackedPaymentMethod[] = [
  'efectivo',
  'transferencia',
  'tarjeta',
  'otro',
];

export const TRACKED_PAYMENT_METHOD_LABELS: Record<TrackedPaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro medio',
};

export interface ShiftExpectedSummary {
  usedPaymentMethods: TrackedPaymentMethod[];
  expectedBaseAmount: number;
  expectedByMethod: Partial<Record<TrackedPaymentMethod, number>>;
  expectedTotal: number;
  paidOrdersCount: number;
  pendingOrdersCount: number;
  pendingAmount: number;
  refundsTotal: number;
  refundsByMethod: Partial<Record<TrackedPaymentMethod, number>>;
}

export interface ShiftCloseEvaluation extends ShiftExpectedSummary {
  declaredClosingBase: number;
  declaredByMethod: Partial<Record<TrackedPaymentMethod, number>>;
  declaredTotal: number;
  differenceTotal: number;
  baseDifference: number;
  methodDifferences: Partial<Record<TrackedPaymentMethod, number>>;
}

function normalizeTrackedMethod(method: Order['paymentMethod']): TrackedPaymentMethod {
  if (
    method === 'efectivo' ||
    method === 'transferencia' ||
    method === 'tarjeta' ||
    method === 'otro'
  ) {
    return method;
  }
  return 'efectivo';
}

/**
 * Determines which orders were created or settled during a shift window [openedAtMs, closedAtMs].
 * Active paid orders contribute to expected revenue; voided paid orders with an explicit
 * refundMethod adjust incoming/outgoing method totals accurately (including cross-method refunds).
 */
export function computeShiftExpectedSummary(params: {
  orders: Order[];
  movements: Movement[];
  openedAtMs: number;
  closedAtMs: number;
  openingBaseAmount: number;
}): ShiftExpectedSummary {
  const { orders, movements, openedAtMs, closedAtMs, openingBaseAmount } = params;
  const safeBase = Math.max(0, Math.round(openingBaseAmount || 0));

  const paidInWindowOrderIds = new Set<string>();
  for (const m of movements) {
    if (
      (m.type === 'estado_pago' || m.type === 'comprobante') &&
      m.createdAtMs >= openedAtMs &&
      m.createdAtMs <= closedAtMs
    ) {
      paidInWindowOrderIds.add(m.orderId);
    }
  }

  const expectedByMethod: Partial<Record<TrackedPaymentMethod, number>> = {};
  const countsByMethod: Partial<Record<TrackedPaymentMethod, number>> = {};
  const refundsByMethod: Partial<Record<TrackedPaymentMethod, number>> = {};
  let paidOrdersCount = 0;
  let pendingOrdersCount = 0;
  let pendingAmount = 0;
  let refundsTotal = 0;

  for (const order of orders) {
    const createdInShift = order.createdAtMs >= openedAtMs && order.createdAtMs <= closedAtMs;
    const settledInShift =
      order.paymentStatus === 'pagado' &&
      order.createdAtMs < openedAtMs &&
      paidInWindowOrderIds.has(order.id);
    const paidInShift = order.paymentStatus === 'pagado' && (createdInShift || settledInShift);

    if (order.status === 'cancelado') {
      if (order.paymentStatus === 'pagado' && order.refundMethod) {
        const payM = normalizeTrackedMethod(order.paymentMethod);
        const refM = normalizeTrackedMethod(order.refundMethod);
        const refundAmount = Math.max(0, Math.round(order.refundAmount ?? order.total));
        const refundTs = order.voidedAtMs || order.updatedAtMs || order.createdAtMs;
        const refundedInShift = refundTs >= openedAtMs && refundTs <= closedAtMs;

        if (refundedInShift && refundAmount > 0) {
          refundsByMethod[refM] = (refundsByMethod[refM] || 0) + refundAmount;
          refundsTotal += refundAmount;
        }

        if (paidInShift && refundedInShift && payM === refM) {
          // Paid and refunded in the exact same method during this shift: net 0
          continue;
        }

        if (paidInShift) {
          expectedByMethod[payM] = (expectedByMethod[payM] || 0) + order.total;
          countsByMethod[payM] = (countsByMethod[payM] || 0) + 1;
        }
        if (refundedInShift && refundAmount > 0) {
          expectedByMethod[refM] = (expectedByMethod[refM] || 0) - refundAmount;
        }
      }
      continue;
    }

    if (!createdInShift && !settledInShift) continue;

    if (order.paymentStatus === 'pagado') {
      const m = normalizeTrackedMethod(order.paymentMethod);
      expectedByMethod[m] = (expectedByMethod[m] || 0) + order.total;
      countsByMethod[m] = (countsByMethod[m] || 0) + 1;
      paidOrdersCount += 1;
    } else if (createdInShift) {
      pendingOrdersCount += 1;
      pendingAmount += order.total;
    }
  }

  // If cash refunds exceeded cash sales during the shift, the difference came out of the physical opening base
  let expectedBaseAmount = safeBase;
  const rawCash = expectedByMethod.efectivo;
  if (rawCash !== undefined && rawCash < 0) {
    expectedBaseAmount = Math.max(0, safeBase + rawCash);
    expectedByMethod.efectivo = 0;
  }

  // Clamp any non-cash negative balance to 0 cleanly so declared unsigned inputs always align
  for (const m of TRACKED_PAYMENT_METHODS) {
    const val = expectedByMethod[m];
    if (val !== undefined && val < 0) {
      expectedByMethod[m] = 0;
    }
  }

  // Only include payment methods that actually had net inflows or active sales in this shift
  const usedPaymentMethods = TRACKED_PAYMENT_METHODS.filter(
    (m) => (countsByMethod[m] || 0) > 0 || (expectedByMethod[m] || 0) > 0
  );

  const expectedSalesTotal = usedPaymentMethods.reduce(
    (sum, m) => sum + (expectedByMethod[m] || 0),
    0
  );

  return {
    usedPaymentMethods,
    expectedBaseAmount,
    expectedByMethod,
    expectedTotal: expectedBaseAmount + expectedSalesTotal,
    paidOrdersCount,
    pendingOrdersCount,
    pendingAmount,
    refundsTotal,
    refundsByMethod,
  };
}

export function evaluateShiftClose(params: {
  orders: Order[];
  movements: Movement[];
  openedAtMs: number;
  closedAtMs: number;
  openingBaseAmount: number;
  declaredClosingBase: number;
  declaredByMethod: Partial<Record<TrackedPaymentMethod, number>>;
}): ShiftCloseEvaluation {
  const expected = computeShiftExpectedSummary({
    orders: params.orders,
    movements: params.movements,
    openedAtMs: params.openedAtMs,
    closedAtMs: params.closedAtMs,
    openingBaseAmount: params.openingBaseAmount,
  });

  const safeDeclaredBase = Math.max(0, Math.round(params.declaredClosingBase || 0));
  const cleanDeclaredByMethod: Partial<Record<TrackedPaymentMethod, number>> = {};
  const methodDifferences: Partial<Record<TrackedPaymentMethod, number>> = {};

  let declaredSalesTotal = 0;
  for (const method of expected.usedPaymentMethods) {
    const val = Math.max(0, Math.round(params.declaredByMethod[method] || 0));
    cleanDeclaredByMethod[method] = val;
    declaredSalesTotal += val;
    methodDifferences[method] = val - (expected.expectedByMethod[method] || 0);
  }

  const declaredTotal = safeDeclaredBase + declaredSalesTotal;
  const baseDifference = safeDeclaredBase - expected.expectedBaseAmount;
  const differenceTotal = declaredTotal - expected.expectedTotal;

  return {
    ...expected,
    declaredClosingBase: safeDeclaredBase,
    declaredByMethod: cleanDeclaredByMethod,
    declaredTotal,
    differenceTotal,
    baseDifference,
    methodDifferences,
  };
}

export function formatShiftDuration(openedAtMs: number, closedAtMs: number): string {
  const diffMs = Math.max(0, closedAtMs - openedAtMs);
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}
