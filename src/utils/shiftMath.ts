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
 * Only paid, non-cancelled orders contribute to usedPaymentMethods and expected revenue.
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
  let paidOrdersCount = 0;
  let pendingOrdersCount = 0;
  let pendingAmount = 0;

  for (const order of orders) {
    if (order.status === 'cancelado') continue;
    const createdInShift = order.createdAtMs >= openedAtMs && order.createdAtMs <= closedAtMs;
    const settledInShift =
      order.paymentStatus === 'pagado' &&
      order.createdAtMs < openedAtMs &&
      paidInWindowOrderIds.has(order.id);

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

  // Only include payment methods that actually had paid orders in this shift
  const usedPaymentMethods = TRACKED_PAYMENT_METHODS.filter(
    (m) => (countsByMethod[m] || 0) > 0
  );

  const expectedSalesTotal = usedPaymentMethods.reduce(
    (sum, m) => sum + (expectedByMethod[m] || 0),
    0
  );

  return {
    usedPaymentMethods,
    expectedBaseAmount: safeBase,
    expectedByMethod,
    expectedTotal: safeBase + expectedSalesTotal,
    paidOrdersCount,
    pendingOrdersCount,
    pendingAmount,
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
