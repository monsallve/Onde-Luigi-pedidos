import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Edit3,
  Image as ImageIcon,
  MapPin,
  Phone,
  Plus,
  Search,
  Store,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Order, OrderStatus } from '../types/pos';
import { isDefaultFinalConsumer, resolveOrderCustomerInfo } from '../utils/billingUtils';
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
  pendiente_validacion: {
    text: 'Validando pago',
    classes: 'bg-orange-950/70 text-orange-300 border-orange-700',
    icon: <Clock className="w-3.5 h-3.5 text-orange-400" />,
  },
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
  if (status === 'pendiente_validacion') return 'preparacion';
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
  const {
    orders,
    openShift,
    activeWaiter,
    effectiveRole,
    permissions,
    updateOrderStatus,
    voidOrder,
    deleteOrderRecord,
    loadingData,
  } = usePosStore();

  const [statusFilter, setStatusFilter] = useState<'activos' | 'todos' | OrderStatus>('activos');
  const [paymentFilter, setPaymentFilter] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isKitchenOnly = effectiveRole === 'cocina';

  useEffect(() => {
    if (!permissions.canManagePayments && paymentFilter !== 'todos') {
      setPaymentFilter('todos');
    }
    if (isKitchenOnly && (statusFilter === 'entregado' || statusFilter === 'cancelado')) {
      setStatusFilter('activos');
    }
  }, [permissions.canManagePayments, paymentFilter, isKitchenOnly, statusFilter]);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (deleteTarget) {
        e.preventDefault();
        if (!deleting) {
          setDeleteTarget(null);
          setDeleteError(null);
        }
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [deleteTarget, deleting]);

  const counts = useMemo(() => {
    const active = orders.filter((o) =>
      isKitchenOnly
        ? o.status === 'tomado' || o.status === 'preparacion' || o.status === 'listo'
        : isOrderInCourse(o)
    ).length;
    const pendingPay = orders.filter(
      (o) => o.status !== 'cancelado' && o.paymentStatus === 'pendiente'
    ).length;
    return { active, pendingPay, total: orders.length };
  }, [orders, isKitchenOnly]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (isKitchenOnly && (o.status === 'entregado' || o.status === 'cancelado')) {
        return false;
      }

      if (statusFilter === 'activos') {
        if (isKitchenOnly) {
          if (o.status !== 'tomado' && o.status !== 'preparacion' && o.status !== 'listo') {
            return false;
          }
        } else if (!isOrderInCourse(o)) {
          return false;
        }
      } else if (statusFilter !== 'todos') {
        if (o.status !== statusFilter) return false;
      }

      if (permissions.canManagePayments && paymentFilter !== 'todos' && o.paymentStatus !== paymentFilter) {
        return false;
      }

      if (q) {
        const matchNum = String(o.orderNumber).includes(q);
        const matchRef = o.reference.toLowerCase().includes(q);
        const matchWaiter = o.waiterName.toLowerCase().includes(q);
        const matchCustDoc = (o.customerDocument || '').toLowerCase().includes(q);
        const matchCustName = (o.customerName || '').toLowerCase().includes(q);
        const matchAddress = (o.deliveryAddress || '').toLowerCase().includes(q);
        const matchNeighborhood = (o.deliveryNeighborhood || '').toLowerCase().includes(q);
        const matchPhone = (o.deliveryPhone || '').toLowerCase().includes(q);
        if (
          !matchNum &&
          !matchRef &&
          !matchWaiter &&
          !matchCustDoc &&
          !matchCustName &&
          !matchAddress &&
          !matchNeighborhood &&
          !matchPhone
        ) {
          return false;
        }
      }
      return true;
    });
  }, [orders, isKitchenOnly, statusFilter, permissions.canManagePayments, paymentFilter, searchQuery]);

  const handleStatusChange = async (orderId: string, nextStatus: OrderStatus) => {
    if (!activeWaiter) {
      onOpenWaiterPicker();
      return;
    }
    setBusyOrderId(orderId);
    try {
      if (nextStatus === 'cancelado') {
        await voidOrder(orderId);
      } else {
        await updateOrderStatus(orderId, nextStatus);
      }
      setConfirmCancelId(null);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleConfirmHardDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteOrderRecord(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar la comanda.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            COMANDAS EN CURSO
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {isKitchenOnly
              ? `${counts.active} comandas en cocina`
              : `${counts.active} activos · ${counts.pendingPay} por cobrar · ${counts.total} registrados`}
          </p>
        </div>
        {permissions.canTakeOrders && (
          <button
            type="button"
            onClick={onNewOrder}
            className="lg:hidden min-h-[44px] px-4 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo pedido</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3 space-y-2.5">
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

          {permissions.canManagePayments && (
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
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {(isKitchenOnly
            ? ([
                { id: 'activos', label: 'En cocina' },
                { id: 'tomado', label: 'Tomado' },
                { id: 'preparacion', label: 'En preparación' },
                { id: 'listo', label: 'Listo' },
              ] as const)
            : ([
                { id: 'activos', label: 'En curso' },
                { id: 'todos', label: 'Todos' },
                { id: 'pendiente_validacion', label: 'Por validar' },
                { id: 'tomado', label: 'Tomado' },
                { id: 'preparacion', label: 'En preparación' },
                { id: 'listo', label: 'Listo' },
                { id: 'entregado', label: 'Entregado' },
                { id: 'cancelado', label: 'Anulado' },
              ] as const)
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
            {permissions.canTakeOrders
              ? 'Cambia los filtros o vuelve a Tomar Pedido para registrar una nueva comanda.'
              : 'Cuando ingresen pedidos para preparar aparecerán aquí en tiempo real.'}
          </p>
          {permissions.canTakeOrders && (
            <button
              type="button"
              onClick={onNewOrder}
              className="min-h-[44px] px-5 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Tomar nuevo pedido</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {filteredOrders.map((order) => {
            const badge = STATUS_BADGE[order.status];
            const nextStatus = getNextStatus(order.status);
            const isBusy = busyOrderId === order.id;
            const isVoided = order.status === 'cancelado';
            const isSelfService = order.source === 'autoservicio';
            const canAdvanceThisStatus =
              order.status === 'pendiente_validacion'
                ? permissions.canManagePayments || permissions.canAdvanceKitchen
                : nextStatus === 'preparacion' || nextStatus === 'listo'
                  ? permissions.canAdvanceKitchen
                  : nextStatus === 'entregado'
                    ? permissions.canDeliverOrders
                    : false;

            return (
              <article
                key={order.id}
                className={`bg-[#141418] border rounded-2xl p-4 flex flex-col justify-between gap-4 ${
                  isVoided
                    ? 'border-red-900/70'
                    : order.status === 'pendiente_validacion'
                      ? 'border-orange-700/80'
                      : 'border-[#27272E]'
                }`}
              >
                <div className="space-y-3">
                  {/* Card Top */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 font-mono tabular-nums">
                        <span className="font-bold text-amber-400">#{order.orderNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTimeShort(order.createdAtMs)}</span>
                        {isSelfService && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-sans text-[10px] font-extrabold uppercase">
                            Autoservicio
                          </span>
                        )}
                      </div>
                      <h2 className="font-poster text-xl font-extrabold text-white mt-0.5 truncate uppercase">
                        {order.reference}
                      </h2>
                      <p className="text-xs text-zinc-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span>
                          Atiende: <span className="font-semibold text-zinc-200">{order.waiterName}</span>
                        </span>
                        {isSelfService && (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              order.deliveryType === 'domicilio'
                                ? 'bg-sky-950/60 border-sky-700 text-sky-300'
                                : 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                            }`}
                          >
                            {order.deliveryType === 'domicilio' ? (
                              <>
                                <Truck className="w-3 h-3" />
                                <span>Domicilio</span>
                              </>
                            ) : (
                              <>
                                <Store className="w-3 h-3" />
                                <span>Local</span>
                              </>
                            )}
                          </span>
                        )}
                      </p>
                      {permissions.canManagePayments &&
                        order.customerDocument &&
                        !isDefaultFinalConsumer(order.customerDocument) && (() => {
                          const cust = resolveOrderCustomerInfo(order);
                          return (
                            <p className="text-[11px] text-amber-300 mt-0.5 truncate">
                              {cust.name} · <span className="font-mono">{cust.documentNumber}</span>
                            </p>
                          );
                        })()}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${badge.classes}`}
                      >
                        {badge.icon}
                        <span>{badge.text}</span>
                      </span>
                      {permissions.canManagePayments && (
                        <span
                          className={`text-xs font-bold ${
                            isVoided
                              ? 'text-red-400'
                              : order.paymentStatus === 'pagado'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                          }`}
                        >
                          {isVoided
                            ? 'Venta anulada'
                            : order.paymentStatus === 'pagado'
                              ? `Pagado · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}`
                              : order.status === 'entregado'
                                ? 'Por cobrar (Entregado)'
                                : 'Por cobrar'}
                        </span>
                      )}
                    </div>
                  </div>

                  {isVoided && (order.voidedByName || order.voidReason) && (
                    <div className="rounded-lg bg-red-950/40 border border-red-900/60 px-2.5 py-1.5 text-xs text-red-200 flex items-start gap-1.5">
                      <Ban className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <span>
                        Anulada{order.voidedByName ? ` por ${order.voidedByName}` : ''}
                        {order.voidReason ? ` · ${order.voidReason}` : ''}
                      </span>
                    </div>
                  )}

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
                          {permissions.canManagePayments && (
                            <span className="font-mono text-zinc-300 tabular-nums shrink-0">
                              {formatCurrency(item.lineTotal)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {isSelfService && (
                    <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-2.5 text-xs space-y-1">
                      {order.deliveryType === 'domicilio' ? (
                        <>
                          <p className="font-bold text-sky-300 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {order.deliveryAddress}
                              {order.deliveryNeighborhood ? ` · ${order.deliveryNeighborhood}` : ''}
                            </span>
                          </p>
                          {order.deliveryPhone && (
                            <p className="text-zinc-300 flex items-center gap-1.5 font-mono">
                              <Phone className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              <span>{order.deliveryPhone}</span>
                            </p>
                          )}
                          {order.deliveryNotes && (
                            <p className="text-[11px] text-zinc-400">Ref: {order.deliveryNotes}</p>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-300">
                          <span className="font-bold flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5 shrink-0" />
                            <span>Recoger en local · {order.customerName}</span>
                          </span>
                          {order.deliveryPhone && (
                            <span className="font-mono text-zinc-300">{order.deliveryPhone}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {order.notes && (
                    <p className="text-xs text-zinc-300 bg-[#0A0A0A] border border-[#27272E] rounded-lg px-2.5 py-1.5">
                      Nota: {order.notes}
                    </p>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="space-y-2.5 pt-1">
                  {permissions.canManagePayments && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-400">Total comanda</span>
                      <span
                        className={`font-mono text-lg font-extrabold tabular-nums ${
                          isVoided ? 'text-red-400 line-through' : 'text-amber-400'
                        }`}
                      >
                        {formatCurrency(order.total)}
                      </span>
                    </div>
                  )}

                  {!isVoided && (permissions.canEditOrders || permissions.canManagePayments) && (
                    <div
                      className={`grid gap-2 ${
                        permissions.canEditOrders && permissions.canManagePayments
                          ? 'grid-cols-2'
                          : 'grid-cols-1'
                      }`}
                    >
                      {permissions.canEditOrders && (
                        <button
                          type="button"
                          onClick={() => onEditOrder(order)}
                          className="min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-zinc-500 flex items-center justify-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>
                      )}

                      {permissions.canManagePayments && (
                        <button
                          type="button"
                          onClick={() => onOpenPayment(order)}
                          className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                            order.paymentStatus === 'pagado'
                              ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-950'
                              : openShift
                                ? 'border-amber-400 bg-amber-500 text-black hover:bg-amber-400'
                                : 'border-amber-700/70 bg-amber-950/40 text-amber-200 hover:bg-amber-950/60'
                          }`}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>
                            {order.paymentStatus === 'pagado'
                              ? 'Pago / Colilla'
                              : openShift
                                ? 'Confirmar pago'
                                : 'Turno cerrado · Cobrar'}
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {nextStatus && canAdvanceThisStatus && (
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

                    {!isVoided && order.status !== 'entregado' && permissions.canVoidOrders && (
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

                    {isVoided && permissions.canHardDelete && (
                      <button
                        type="button"
                        aria-label={`Eliminar comanda anulada #${order.orderNumber}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(order);
                        }}
                        className="flex-1 min-h-[42px] px-3 rounded-xl border border-red-800 bg-red-950/50 text-red-200 text-xs font-bold hover:bg-red-950 flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        <span>Eliminar rastro</span>
                      </button>
                    )}

                    {order.receiptCount > 0 && permissions.canViewTransfers && (
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

      {/* Permanent Delete Modal for Annulled Comandas (Admin Only) */}
      {deleteTarget && permissions.canHardDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-comanda-modal-title"
        >
          <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <h2 id="delete-comanda-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ELIMINAR COMANDA ANULADA
                </h2>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {deleteError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {deleteError}
                </div>
              )}

              <p className="text-sm text-zinc-200 leading-relaxed">
                ¿Eliminar por completo la comanda anulada{' '}
                <strong className="text-amber-400">
                  #{deleteTarget.orderNumber} ({deleteTarget.reference})
                </strong>{' '}
                junto con toda su bitácora y comprobantes? Esta acción es permanente.
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmHardDelete}
                  className="min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting ? 'Eliminando...' : 'Eliminar rastro'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

