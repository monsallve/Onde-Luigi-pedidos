import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Edit3,
  Image as ImageIcon,
  Plus,
  Search,
  XCircle,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Order, OrderStatus } from '../types/pos';
import {
  formatCurrency,
  formatCustomizationSummary,
  formatDateTimeShort,
  isOrderInCourse,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../utils/orderMath';

interface Props {
  onNewOrder: () => void;
  onEditOrder: (order: Order) => void;
  onOpenPayment: (order: Order) => void;
  onViewOrderReceipt: (orderId: string) => void;
  onOpenWaiterPicker: () => void;
}

const STATUS_BADGE: Record<OrderStatus, { text: string; classes: string; icon: React.ReactNode }> = {
  tomado: {
    text: 'Tomado',
    classes: 'bg-[#1C1C22] text-zinc-200 border-[#27272E]',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  preparacion: {
    text: 'En preparación',
    classes: 'bg-amber-950/60 text-amber-300 border-amber-700',
    icon: <ChefHat className="w-3.5 h-3.5" />,
  },
  listo: {
    text: 'Listo',
    classes: 'bg-sky-950/60 text-sky-300 border-sky-700',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  entregado: {
    text: 'Entregado',
    classes: 'bg-emerald-950/60 text-emerald-300 border-emerald-700',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  cancelado: {
    text: 'Anulado',
    classes: 'bg-red-950/60 text-red-300 border-red-700',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
};

function getNextStatus(status: OrderStatus): OrderStatus | null {
  if (status === 'tomado') return 'preparacion';
  if (status === 'preparacion') return 'listo';
  if (status === 'listo') return 'entregado';
  return null;
}

export const OrdersView: React.FC<Props> = ({
  onNewOrder,
  onEditOrder,
  onOpenPayment,
  onViewOrderReceipt,
  onOpenWaiterPicker,
}) => {
  const { orders, activeWaiter, updateOrderStatus, loadingData } = usePosStore();

  const [statusFilter, setStatusFilter] = useState<'activos' | 'todos' | OrderStatus>('activos');
  const [paymentFilter, setPaymentFilter] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const active = orders.filter(isOrderInCourse).length;
    const pendingPay = orders.filter(
      (o) => o.status !== 'cancelado' && o.paymentStatus === 'pendiente'
    ).length;
    return { active, pendingPay, total: orders.length };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter === 'activos') {
        if (!isOrderInCourse(o)) return false;
      } else if (statusFilter !== 'todos') {
        if (o.status !== statusFilter) return false;
      }

      if (paymentFilter !== 'todos' && o.paymentStatus !== paymentFilter) {
        return false;
      }

      if (q) {
        const matchNum = String(o.orderNumber).includes(q);
        const matchRef = o.reference.toLowerCase().includes(q);
        const matchWaiter = o.waiterName.toLowerCase().includes(q);
        if (!matchNum && !matchRef && !matchWaiter) return false;
      }
      return true;
    });
  }, [orders, statusFilter, paymentFilter, searchQuery]);

  const handleStatusChange = async (orderId: string, nextStatus: OrderStatus) => {
    if (!activeWaiter) {
      onOpenWaiterPicker();
      return;
    }
    setBusyOrderId(orderId);
    try {
      await updateOrderStatus(orderId, nextStatus);
      setConfirmCancelId(null);
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            COMANDAS EN CURSO
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {counts.active} activos · {counts.pendingPay} por cobrar · {counts.total} registrados
          </p>
        </div>
        <button
          type="button"
          onClick={onNewOrder}
          className="lg:hidden min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo pedido</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Buscar pedidos por número, mesa o mesero"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar #pedido, mesa, cliente o mesero..."
              className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#0A0A0A] border border-[#27272E] rounded-xl overflow-x-auto">
            {(
              [
                { id: 'todos', label: 'Todos pagos' },
                { id: 'pendiente', label: 'Por cobrar' },
                { id: 'pagado', label: 'Pagados' },
              ] as const
            ).map((pf) => (
              <button
                key={pf.id}
                type="button"
                onClick={() => setPaymentFilter(pf.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  paymentFilter === pf.id
                    ? 'bg-amber-500 text-black font-bold'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                {pf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(
            [
              { id: 'activos', label: 'En curso' },
              { id: 'todos', label: 'Todos' },
              { id: 'tomado', label: 'Tomado' },
              { id: 'preparacion', label: 'En preparación' },
              { id: 'listo', label: 'Listo' },
              { id: 'entregado', label: 'Entregado' },
              { id: 'cancelado', label: 'Anulado' },
            ] as const
          ).map((sf) => (
            <button
              key={sf.id}
              type="button"
              onClick={() => setStatusFilter(sf.id)}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                statusFilter === sf.id
                  ? 'bg-red-600 text-white border-red-500 font-bold'
                  : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
              }`}
            >
              {sf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Grid */}
      {loadingData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-56 bg-[#141418] border border-[#27272E] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center space-y-3">
          <p className="text-base font-bold text-white">
            No hay pedidos en esta vista
          </p>
          <p className="text-sm text-zinc-400 max-w-sm mx-auto">
            Cambia los filtros o vuelve a Tomar Pedido para registrar una nueva comanda.
          </p>
          <button
            type="button"
            onClick={onNewOrder}
            className="min-h-[44px] px-5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Tomar nuevo pedido</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {filteredOrders.map((order) => {
            const badge = STATUS_BADGE[order.status];
            const nextStatus = getNextStatus(order.status);
            const isBusy = busyOrderId === order.id;

            return (
              <article
                key={order.id}
                className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  {/* Card Top */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                        <span className="font-bold text-amber-400">#{order.orderNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTimeShort(order.createdAtMs)}</span>
                      </div>
                      <h2 className="font-poster text-xl font-extrabold text-white mt-0.5 truncate uppercase">
                        {order.reference}
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Atiende: <span className="font-semibold text-zinc-200">{order.waiterName}</span>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${badge.classes}`}
                      >
                        {badge.icon}
                        <span>{badge.text}</span>
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          order.paymentStatus === 'pagado'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {order.paymentStatus === 'pagado'
                          ? `Pagado · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}`
                          : order.status === 'entregado'
                            ? 'Por cobrar (Entregado)'
                            : 'Por cobrar'}
                      </span>
                    </div>
                  </div>

                  {/* Items List */}
                  <ul className="divide-y divide-[#27272E] border-t border-b border-[#27272E] py-1.5 space-y-1.5">
                    {order.items.map((item) => {
                      const custom = formatCustomizationSummary(item);
                      return (
                        <li key={item.lineId} className="pt-1.5 first:pt-0 flex items-start justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-white">
                              <span className="font-mono tabular-nums text-amber-400">
                                {item.quantity}x
                              </span>{' '}
                              {item.productName}
                            </p>
                            {custom && (
                              <p className="text-[11px] text-amber-300 mt-0.5 leading-snug">{custom}</p>
                            )}
                          </div>
                          <span className="font-mono text-zinc-300 tabular-nums shrink-0">
                            {formatCurrency(item.lineTotal)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {order.notes && (
                    <p className="text-xs text-zinc-300 bg-[#0A0A0A] border border-[#27272E] rounded-lg px-2.5 py-1.5">
                      Nota: {order.notes}
                    </p>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">Total comanda</span>
                    <span className="font-mono text-lg font-extrabold text-amber-400 tabular-nums">
                      {formatCurrency(order.total)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onEditOrder(order)}
                      disabled={order.status === 'cancelado'}
                      className="min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-45 flex items-center justify-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenPayment(order)}
                      className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                        order.paymentStatus === 'pagado'
                          ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950'
                          : 'border-amber-400 bg-amber-500 text-black hover:bg-amber-400'
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>{order.paymentStatus === 'pagado' ? 'Pago / Foto' : 'Confirmar pago'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {nextStatus && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleStatusChange(order.id, nextStatus)}
                        className="flex-1 min-h-[42px] px-3 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <span>Pasar a {ORDER_STATUS_LABELS[nextStatus]}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {order.status !== 'cancelado' && order.status !== 'entregado' && (
                      confirmCancelId === order.id ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleStatusChange(order.id, 'cancelado')}
                          className="min-h-[42px] px-3 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-500 whitespace-nowrap"
                        >
                          ¿Anular pedido?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelId(order.id)}
                          title="Anular pedido"
                          aria-label={`Anular pedido #${order.orderNumber}`}
                          className="min-h-[42px] px-3 rounded-xl border border-red-800 bg-red-950/40 text-red-300 text-xs font-semibold hover:bg-red-950 flex items-center gap-1 whitespace-nowrap"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Anular</span>
                        </button>
                      )
                    )}

                    {order.receiptCount > 0 && (
                      <button
                        type="button"
                        aria-label={`Ver comprobante del pedido #${order.orderNumber}`}
                        onClick={() => onViewOrderReceipt(order.id)}
                        className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-[#27272E] bg-[#1C1C22] text-amber-400 hover:border-amber-500"
                      >
                        <ImageIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
