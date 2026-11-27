import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronRight, Lock, Package, Users, Wallet, X } from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { DateRangePreset } from '../types/pos';
import { formatCurrency, formatDateTimeShort, PAYMENT_METHOD_LABELS } from '../utils/orderMath';
import {
  computeSalesReport,
  resolveDateRange,
  toInputDateString,
  type ProductSalesRow,
} from '../utils/salesAnalytics';
import { ROLE_LABELS } from '../utils/rolePermissions';

export const SalesReportView: React.FC = () => {
  const { orders, effectiveRole, permissions } = usePosStore();

  const [preset, setPreset] = useState<DateRangePreset>('hoy');
  const [customFrom, setCustomFrom] = useState(() => toInputDateString(Date.now()));
  const [customTo, setCustomTo] = useState(() => toInputDateString(Date.now()));
  const [inspectedProduct, setInspectedProduct] = useState<ProductSalesRow | null>(null);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (inspectedProduct) {
        e.preventDefault();
        setInspectedProduct(null);
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [inspectedProduct]);

  const bounds = useMemo(
    () => resolveDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const report = useMemo(
    () => computeSalesReport(orders, bounds.startMs, bounds.endMs),
    [orders, bounds.startMs, bounds.endMs]
  );

  const inspectedOrders = useMemo(() => {
    if (!inspectedProduct) return [];
    const idSet = new Set(inspectedProduct.orderIds);
    return orders.filter((o) => idSet.has(o.id));
  }, [inspectedProduct, orders]);

  if (!permissions.canViewSales) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO ADMINISTRATIVO REQUERIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Solo las cuentas con rol Administrador pueden ver el resumen de ventas, ingresos y conteo de productos vendidos. Tu rol actual es <strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            VENTAS Y CONTEO DE PRODUCTOS
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Periodo seleccionado: <strong className="text-amber-400">{bounds.label}</strong>
          </p>
        </div>
      </div>

      {/* Date Range Controls */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { id: 'hoy', label: 'Hoy' },
              { id: 'ayer', label: 'Ayer' },
              { id: 'semana', label: 'Esta semana' },
              { id: 'mes', label: 'Este mes' },
              { id: 'personalizado', label: 'Personalizado' },
            ] as { id: DateRangePreset; label: string }[]
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                preset === p.id
                  ? 'bg-amber-500 text-black border-amber-400 font-bold'
                  : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label htmlFor="sales-date-from" className="block text-xs font-medium text-zinc-400 mb-1">
              Fecha desde
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="sales-date-from"
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setPreset('personalizado');
                }}
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="sales-date-to" className="block text-xs font-medium text-zinc-400 mb-1">
              Fecha hasta
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="sales-date-to"
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setPreset('personalizado');
                }}
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4">
          <p className="text-xs font-medium text-zinc-400">Total ventas</p>
          <p className="font-mono text-xl sm:text-2xl font-extrabold text-white mt-1 tabular-nums">
            {formatCurrency(report.totalSales)}
          </p>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {report.orderCount} pedidos válidos
            {(report.cancelledCount > 0 || report.refundedTotal > 0) && (
              <span className="block text-[11px] text-red-300 mt-0.5">
                {report.cancelledCount} {report.cancelledCount === 1 ? 'anulado' : 'anulados'}
                {report.refundedTotal > 0 ? ` · Dev. ${formatCurrency(report.refundedTotal)}` : ''}
              </span>
            )}
          </p>
        </div>

        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4">
          <p className="text-xs font-medium text-emerald-400">Total pagado</p>
          <p className="font-mono text-xl sm:text-2xl font-extrabold text-emerald-400 mt-1 tabular-nums">
            {formatCurrency(report.totalPaid)}
          </p>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {report.paidCount} pedidos cobrados
          </p>
        </div>

        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4">
          <p className="text-xs font-medium text-amber-400">Pendiente por cobrar</p>
          <p className="font-mono text-xl sm:text-2xl font-extrabold text-amber-400 mt-1 tabular-nums">
            {formatCurrency(report.totalPending)}
          </p>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {report.pendingCount} pedidos pendientes
          </p>
        </div>

        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4">
          <p className="text-xs font-medium text-zinc-400">Unidades vendidas</p>
          <p className="font-mono text-xl sm:text-2xl font-extrabold text-white mt-1 tabular-nums">
            {report.totalUnitsSold}
          </p>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            Ticket prom. {formatCurrency(report.averageTicket)}
          </p>
        </div>
      </div>

      {/* Product Sales Breakdown */}
      <section className="bg-[#141418] border border-[#27272E] rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#27272E] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-400" />
            <h2 className="font-poster text-xl font-extrabold text-white tracking-wide">
              PRODUCTOS VENDIDOS EN EL RANGO
            </h2>
          </div>
          <span className="text-xs text-zinc-400 hidden sm:inline">Toca un producto para ver pedidos</span>
        </div>

        {report.productBreakdown.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">
            No hay ventas registradas en el rango de fechas seleccionado.
          </div>
        ) : (
          <div className="divide-y divide-[#27272E]">
            {report.productBreakdown.map((row) => (
              <button
                key={row.productId}
                type="button"
                onClick={() => setInspectedProduct(row)}
                className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#1C1C22] text-left transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{row.productName}</p>
                  <p className="text-xs text-zinc-400">
                    {row.category} · {row.orderIds.length}{' '}
                    {row.orderIds.length === 1 ? 'pedido' : 'pedidos'}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-white tabular-nums">
                      {row.unitsSold} uds
                    </p>
                    <p className="font-mono text-xs font-semibold text-amber-400 tabular-nums">
                      {formatCurrency(row.totalRevenue)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Payment Methods & Waiter Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-[#141418] border border-[#27272E] rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#27272E] flex items-center gap-2">
            <Wallet className="w-4 h-4 text-amber-400" />
            <h2 className="font-poster text-xl font-extrabold text-white tracking-wide">
              POR MEDIO DE PAGO
            </h2>
          </div>
          {report.paymentMethodBreakdown.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-400">Sin datos en este rango.</div>
          ) : (
            <div className="divide-y divide-[#27272E]">
              {report.paymentMethodBreakdown.map((pm) => (
                <div
                  key={pm.method}
                  className="px-4 sm:px-5 py-3.5 flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-semibold text-white">{pm.label}</p>
                    <p className="text-xs text-zinc-400 tabular-nums">
                      {pm.orderCount} {pm.orderCount === 1 ? 'pedido' : 'pedidos'}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-amber-400 tabular-nums">
                    {formatCurrency(pm.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-[#141418] border border-[#27272E] rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#27272E] flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-400" />
            <h2 className="font-poster text-xl font-extrabold text-white tracking-wide">
              POR MESERO / ENCARGADO
            </h2>
          </div>
          {report.waiterBreakdown.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-400">Sin datos en este rango.</div>
          ) : (
            <div className="divide-y divide-[#27272E]">
              {report.waiterBreakdown.map((w) => (
                <div
                  key={w.waiterId || w.waiterName}
                  className="px-4 sm:px-5 py-3.5 flex items-center justify-between text-sm"
                >
                  <div>
                    <p className="font-semibold text-white">{w.waiterName}</p>
                    <p className="text-xs text-zinc-400 tabular-nums">
                      {w.orderCount} {w.orderCount === 1 ? 'pedido' : 'pedidos'} · Pagado{' '}
                      {formatCurrency(w.paidAmount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-white tabular-nums">
                      {formatCurrency(w.totalSales)}
                    </p>
                    {w.pendingAmount > 0 && (
                      <p className="font-mono text-[11px] font-semibold text-amber-400 tabular-nums">
                        Por cobrar {formatCurrency(w.pendingAmount)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Product Orders Inspection Modal */}
      {inspectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-product-title"
        >
          <div className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div>
                <h3 id="inspect-product-title" className="font-poster text-xl font-extrabold text-white uppercase">
                  {inspectedProduct.productName}
                </h3>
                <p className="text-xs text-amber-400 font-mono tabular-nums">
                  {inspectedProduct.unitsSold} unidades · {formatCurrency(inspectedProduct.totalRevenue)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedProduct(null)}
                aria-label="Cerrar detalle de producto"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto divide-y divide-[#27272E]">
              {inspectedOrders.map((o) => {
                const matchingItems = o.items.filter(
                  (i) => i.productId === inspectedProduct.productId
                );
                const qty = matchingItems.reduce((s, i) => s + i.quantity, 0);
                return (
                  <div key={o.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-white">
                        #{o.orderNumber} · {o.reference}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {formatDateTimeShort(o.createdAtMs)} · {o.waiterName} ·{' '}
                        {o.paymentStatus === 'pagado'
                          ? PAYMENT_METHOD_LABELS[o.paymentMethod]
                          : 'Por cobrar'}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="text-sm font-bold text-amber-400">{qty} uds</p>
                      <p className="text-xs text-zinc-400">{formatCurrency(o.total)} total</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
