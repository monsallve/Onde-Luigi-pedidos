import type { DateRangePreset, Order, PaymentMethod } from '../types/pos';

export interface DateRangeBounds {
  startMs: number;
  endMs: number;
  label: string;
}

export interface ProductSalesRow {
  productId: string;
  productName: string;
  category: string;
  unitsSold: number;
  totalRevenue: number;
  orderIds: string[];
}

export interface PaymentMethodRow {
  method: PaymentMethod | 'pendiente';
  label: string;
  orderCount: number;
  amount: number;
}

export interface WaiterSalesRow {
  waiterId: string;
  waiterName: string;
  orderCount: number;
  totalSales: number;
  paidAmount: number;
  pendingAmount: number;
}

export interface SalesReport {
  totalSales: number;
  totalPaid: number;
  totalPending: number;
  cancelledTotal: number;
  orderCount: number;
  paidCount: number;
  pendingCount: number;
  cancelledCount: number;
  averageTicket: number;
  totalUnitsSold: number;
  productBreakdown: ProductSalesRow[];
  paymentMethodBreakdown: PaymentMethodRow[];
  waiterBreakdown: WaiterSalesRow[];
}

function startOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function endOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy.getTime();
}

export function toInputDateString(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveDateRange(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string,
  nowMs: number = Date.now()
): DateRangeBounds {
  const now = new Date(nowMs);

  if (preset === 'hoy') {
    return {
      startMs: startOfDay(now),
      endMs: endOfDay(now),
      label: 'Hoy',
    };
  }

  if (preset === 'ayer') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return {
      startMs: startOfDay(yesterday),
      endMs: endOfDay(yesterday),
      label: 'Ayer',
    };
  }

  if (preset === 'semana') {
    const weekStart = new Date(now);
    const day = weekStart.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    weekStart.setDate(weekStart.getDate() - diffToMonday);
    return {
      startMs: startOfDay(weekStart),
      endMs: endOfDay(now),
      label: 'Esta semana',
    };
  }

  if (preset === 'mes') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      startMs: startOfDay(monthStart),
      endMs: endOfDay(now),
      label: 'Este mes',
    };
  }

  // Personalizado (YYYY-MM-DD in local timezone)
  const parsedFrom = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(startOfDay(now));
  const parsedTo = customTo ? new Date(`${customTo}T23:59:59.999`) : new Date(endOfDay(now));

  const startMs = Number.isNaN(parsedFrom.getTime()) ? startOfDay(now) : parsedFrom.getTime();
  const endMs = Number.isNaN(parsedTo.getTime()) ? endOfDay(now) : parsedTo.getTime();

  return {
    startMs: Math.min(startMs, endMs),
    endMs: Math.max(startMs, endMs),
    label: customFrom && customTo ? `${customFrom} al ${customTo}` : 'Rango personalizado',
  };
}

export function filterOrdersByDateRange(
  orders: Order[],
  startMs: number,
  endMs: number
): Order[] {
  return orders.filter((order) => order.createdAtMs >= startMs && order.createdAtMs <= endMs);
}

export function computeSalesReport(
  orders: Order[],
  startMs: number,
  endMs: number
): SalesReport {
  const inRange = filterOrdersByDateRange(orders, startMs, endMs);

  let totalSales = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let cancelledTotal = 0;
  let orderCount = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let totalUnitsSold = 0;

  const productMap = new Map<string, ProductSalesRow>();
  const paymentMap = new Map<PaymentMethod | 'pendiente', PaymentMethodRow>();
  const waiterMap = new Map<string, WaiterSalesRow>();

  const methodLabels: Record<PaymentMethod | 'pendiente', string> = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    tarjeta: 'Tarjeta',
    otro: 'Otro medio',
    '': 'Pagado (sin medio)',
    pendiente: 'Pendiente por cobrar',
  };

  for (const order of inRange) {
    if (order.status === 'cancelado') {
      cancelledCount += 1;
      cancelledTotal += order.total;
      continue;
    }

    orderCount += 1;
    totalSales += order.total;

    if (order.paymentStatus === 'pagado') {
      paidCount += 1;
      totalPaid += order.total;

      const methodKey: PaymentMethod = order.paymentMethod || 'otro';
      const existingPay = paymentMap.get(methodKey) || {
        method: methodKey,
        label: methodLabels[methodKey],
        orderCount: 0,
        amount: 0,
      };
      existingPay.orderCount += 1;
      existingPay.amount += order.total;
      paymentMap.set(methodKey, existingPay);
    } else {
      pendingCount += 1;
      totalPending += order.total;

      const existingPend = paymentMap.get('pendiente') || {
        method: 'pendiente',
        label: methodLabels.pendiente,
        orderCount: 0,
        amount: 0,
      };
      existingPend.orderCount += 1;
      existingPend.amount += order.total;
      paymentMap.set('pendiente', existingPend);
    }

    // Waiter breakdown
    const waiterKey = order.waiterId || order.waiterName;
    const existingWaiter = waiterMap.get(waiterKey) || {
      waiterId: order.waiterId,
      waiterName: order.waiterName,
      orderCount: 0,
      totalSales: 0,
      paidAmount: 0,
      pendingAmount: 0,
    };
    existingWaiter.orderCount += 1;
    existingWaiter.totalSales += order.total;
    if (order.paymentStatus === 'pagado') {
      existingWaiter.paidAmount += order.total;
    } else {
      existingWaiter.pendingAmount += order.total;
    }
    waiterMap.set(waiterKey, existingWaiter);

    // Product breakdown
    for (const item of order.items) {
      totalUnitsSold += item.quantity;
      const existingProd = productMap.get(item.productId) || {
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        unitsSold: 0,
        totalRevenue: 0,
        orderIds: [],
      };
      existingProd.unitsSold += item.quantity;
      existingProd.totalRevenue += item.lineTotal;
      if (!existingProd.orderIds.includes(order.id)) {
        existingProd.orderIds.push(order.id);
      }
      productMap.set(item.productId, existingProd);
    }
  }

  const productBreakdown = Array.from(productMap.values()).sort(
    (a, b) => b.totalRevenue - a.totalRevenue || b.unitsSold - a.unitsSold
  );

  const paymentMethodBreakdown = Array.from(paymentMap.values()).sort(
    (a, b) => b.amount - a.amount
  );

  const waiterBreakdown = Array.from(waiterMap.values()).sort(
    (a, b) => b.totalSales - a.totalSales
  );

  const averageTicket = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

  return {
    totalSales,
    totalPaid,
    totalPending,
    cancelledTotal,
    orderCount,
    paidCount,
    pendingCount,
    cancelledCount,
    averageTicket,
    totalUnitsSold,
    productBreakdown,
    paymentMethodBreakdown,
    waiterBreakdown,
  };
}
