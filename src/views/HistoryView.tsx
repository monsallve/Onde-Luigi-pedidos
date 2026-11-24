import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  FileDown,
  FileImage,
  History,
  Lock,
  PlusCircle,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { CustomersModal } from '../components/CustomersModal';
import { usePosStore } from '../services/posStore';
import type { MovementType, Order } from '../types/pos';
import { resolveOrderCustomerInfo } from '../utils/billingUtils';
import {
  formatCurrency,
  formatDateTimeShort,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../utils/orderMath';
import { downloadOrderReceiptPdf } from '../utils/receiptPdf';
import { ROLE_LABELS } from '../utils/rolePermissions';

const MOVEMENT_META: Record<MovementType, { label: string; icon: React.ReactNode; tint: string }> = {
  creacion: {
    label: 'Creación',
    icon: <PlusCircle className="w-4 h-4" />,
    tint: 'text-amber-300 bg-amber-950/60 border border-amber-700',
  },
  edicion_items: {
    label: 'Edición ítems / receta',
    icon: <Edit3 className="w-4 h-4" />,
    tint: 'text-orange-300 bg-orange-950/60 border border-orange-700',
  },
  estado_pedido: {
    label: 'Cambio de estado',
    icon: <CheckCircle2 className="w-4 h-4" />,
    tint: 'text-sky-300 bg-sky-950/60 border border-sky-700',
  },
  estado_pago: {
    label: 'Registro de pago',
    icon: <CreditCard className="w-4 h-4" />,
    tint: 'text-emerald-300 bg-emerald-950/60 border border-emerald-700',
  },
  comprobante: {
    label: 'Comprobante',
    icon: <FileImage className="w-4 h-4" />,
    tint: 'text-emerald-300 bg-emerald-950/60 border border-emerald-700',
  },
};

export const HistoryView: React.FC = () => {
  const {
    orders,
    movements,
    customers,
    billingConfig,
    effectiveRole,
    permissions,
    voidOrder,
    deleteOrderRecord,
  } = usePosStore();
  const [subTab, setSubTab] = useState<'pedidos' | 'bitacora'>('pedidos');
  const [typeFilter, setTypeFilter] = useState<'todos' | MovementType>('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [downloadingOrderId, setDownloadingOrderId] = useState<string | null>(null);

  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const handleBackIntercept = (e: Event) => {
      if (deleteTarget) {
        e.preventDefault();
        if (!actionBusy) {
          setDeleteTarget(null);
          setActionError(null);
        }
      } else if (voidTarget) {
        e.preventDefault();
        if (!actionBusy) {
          setVoidTarget(null);
          setVoidReason('');
          setActionError(null);
        }
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [deleteTarget, voidTarget, actionBusy]);

  const filteredMovements = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return movements.filter((m) => {
      if (typeFilter !== 'todos' && m.type !== typeFilter) return false;
      if (q) {
        return (
          String(m.orderNumber).includes(q) ||
          m.orderReference.toLowerCase().includes(q) ||
          m.waiterName.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [movements, typeFilter, searchTerm]);

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      if (!q) return true;
      return (
        String(o.orderNumber).includes(q) ||
        o.reference.toLowerCase().includes(q) ||
        o.waiterName.toLowerCase().includes(q) ||
        (o.customerDocument || '').toLowerCase().includes(q) ||
        (o.customerName || '').toLowerCase().includes(q)
      );
    });
  }, [orders, searchTerm]);

  const handleDownloadPdf = async (order: Order) => {
    setDownloadingOrderId(order.id);
    try {
      await downloadOrderReceiptPdf(order, billingConfig);
    } finally {
      setDownloadingOrderId(null);
    }
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await voidOrder(voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo anular la venta.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmHardDelete = async () => {
    if (!deleteTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteOrderRecord(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo eliminar el registro.');
    } finally {
      setActionBusy(false);
    }
  };

  if (!permissions.canViewHistory) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          ACCESO RESTRINGIDO
        </h1>
        <p className="text-sm text-zinc-400">
          Tu rol actual (<strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>) no tiene acceso al historial ni a la bitácora de movimientos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            HISTORIAL Y BITÁCORA
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            {orders.length} pedidos · {movements.length} movimientos ·{' '}
            {permissions.canHardDelete
              ? 'Administrador: puede anular ventas o eliminar rastros permanentes'
              : permissions.canVoidOrders
                ? `${ROLE_LABELS[effectiveRole]}: puede visualizar el historial y anular ventas`
                : `${ROLE_LABELS[effectiveRole]}: solo visualización del historial`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setCustomersOpen(true)}
            className="min-h-[40px] px-3.5 rounded-xl border border-[#27272E] bg-[#141418] text-xs font-bold text-amber-300 hover:border-amber-500 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>Clientes ({customers.length})</span>
          </button>

          <div className="flex items-center gap-1 p-1 bg-[#141418] border border-[#27272E] rounded-xl">
            <button
              type="button"
              onClick={() => setSubTab('pedidos')}
              className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subTab === 'pedidos'
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Historial por pedido
            </button>
            <button
              type="button"
              onClick={() => setSubTab('bitacora')}
              className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subTab === 'bitacora'
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Bitácora de movimientos
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-3.5 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Buscar en historial por pedido, mesero o cambio"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por #pedido, mesa, cliente, NIT/cédula o mesero..."
            className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>

        {subTab === 'bitacora' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                { id: 'todos', label: 'Todos los eventos' },
                { id: 'creacion', label: 'Creación' },
                { id: 'edicion_items', label: 'Edición ítems' },
                { id: 'estado_pedido', label: 'Estados' },
                { id: 'estado_pago', label: 'Pagos' },
                { id: 'comprobante', label: 'Comprobantes' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 transition-colors ${
                  typeFilter === f.id
                    ? 'bg-red-600 text-white border-red-500 font-bold'
                    : 'bg-[#1C1C22] text-zinc-300 border-[#27272E] hover:border-zinc-500'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {subTab === 'bitacora' ? (
        <div className="bg-[#141418] border border-[#27272E] rounded-2xl divide-y divide-[#27272E] overflow-hidden">
          {filteredMovements.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-400">
              No se encontraron movimientos con este filtro.
            </div>
          ) : (
            filteredMovements.map((mov) => {
              const meta = MOVEMENT_META[mov.type];
              return (
                <div key={mov.id} className="p-4 flex items-start gap-3.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.tint}`}>
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white">
                        Pedido <span className="text-amber-400 font-mono">#{mov.orderNumber}</span> · {mov.orderReference}
                      </p>
                      <span className="font-mono text-xs text-zinc-400 tabular-nums">
                        {formatDateTimeShort(mov.createdAtMs)}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-200 mt-0.5">{mov.description}</p>
                    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
                      <span>{meta.label}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Por <strong className="text-zinc-200">{mov.waiterName}</strong>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.length === 0 ? (
            <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center text-sm text-zinc-400">
              No hay pedidos registrados que coincidan.
            </div>
          ) : (
            filteredOrders.map((order) => {
              const orderMovs = movements.filter((m) => m.orderId === order.id);
              const isOpen = expandedOrderId === order.id;
              const isVoided = order.status === 'cancelado';

              return (
                <div
                  key={order.id}
                  className={`bg-[#141418] border rounded-2xl overflow-hidden ${
                    isVoided ? 'border-red-900/70' : 'border-[#27272E]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedOrderId(isOpen ? null : order.id)}
                    aria-expanded={isOpen}
                    className="w-full p-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#1C1C22] transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                        <span className="font-bold text-amber-400">#{order.orderNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTimeShort(order.createdAtMs)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{orderMovs.length} eventos</span>
                        {isVoided && (
                          <span className="px-2 py-0.5 rounded bg-red-950/80 border border-red-700 text-red-300 font-sans font-bold uppercase text-[10px]">
                            Venta Anulada
                          </span>
                        )}
                      </div>
                      <p className="font-poster text-xl font-extrabold text-white mt-0.5 uppercase truncate">
                        {order.reference}
                      </p>
                      <p className="text-xs text-zinc-400">
                        Atendió: <span className="text-zinc-200 font-medium">{order.waiterName}</span>
                        {(() => {
                          const cust = resolveOrderCustomerInfo(order);
                          return (
                            <span className="ml-2 text-zinc-400">
                              · Cliente: <span className="text-zinc-200">{cust.name}</span>{' '}
                              <span className="font-mono text-zinc-400">({cust.documentNumber})</span>
                            </span>
                          );
                        })()}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="text-xs font-semibold text-zinc-300">
                          <span className={isVoided ? 'text-red-400 font-bold' : ''}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>{' '}
                          ·{' '}
                          <span
                            className={
                              order.paymentStatus === 'pagado'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                            }
                          >
                            {order.paymentStatus === 'pagado'
                              ? `Pagado (${PAYMENT_METHOD_LABELS[order.paymentMethod]})`
                              : 'Pendiente'}
                          </span>
                        </p>
                        <p
                          className={`font-mono text-sm font-bold tabular-nums ${
                            isVoided ? 'text-red-400 line-through' : 'text-amber-400'
                          }`}
                        >
                          {formatCurrency(order.total)}
                        </p>
                      </div>
                      <History className="w-4 h-4 text-zinc-400 shrink-0" />
                    </div>
                  </button>

                  {isVoided && (order.voidReason || order.voidedByName) && (
                    <div className="px-4 py-2 bg-red-950/30 border-t border-red-900/50 text-xs text-red-200 flex flex-wrap items-center gap-2">
                      <Ban className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span>
                        Anulada{order.voidedByName ? ` por ${order.voidedByName}` : ''}
                        {order.voidReason ? ` · Motivo: ${order.voidReason}` : ''}
                      </span>
                    </div>
                  )}

                  {/* Row Actions: Non-admin can Anular venta; ONLY Admin can Eliminar rastro */}
                  <div className="px-4 py-2.5 border-t border-[#27272E] bg-[#101014] flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedOrderId(isOpen ? null : order.id)}
                      className="text-xs font-semibold text-zinc-400 hover:text-white"
                    >
                      {isOpen ? 'Ocultar bitácora' : 'Ver detalle y movimientos'}
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={downloadingOrderId === order.id}
                        onClick={() => void handleDownloadPdf(order)}
                        className="min-h-[36px] px-3 rounded-lg border border-[#27272E] bg-[#141418] text-amber-300 text-xs font-semibold hover:border-amber-500 flex items-center gap-1.5"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>{downloadingOrderId === order.id ? 'Generando...' : 'Colilla PDF'}</span>
                      </button>

                      {!isVoided && permissions.canVoidOrders && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setVoidReason('');
                            setVoidTarget(order);
                          }}
                          className="min-h-[36px] px-3 rounded-lg border border-amber-700/80 bg-amber-950/40 text-amber-300 text-xs font-semibold hover:bg-amber-950 flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Anular venta</span>
                        </button>
                      )}

                      {permissions.canHardDelete && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setDeleteTarget(order);
                          }}
                          className="min-h-[36px] px-3 rounded-lg border border-red-800 bg-red-950/40 text-red-300 text-xs font-semibold hover:bg-red-950 flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Eliminar rastro</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-[#27272E] bg-[#0A0A0A] p-4 space-y-3">
                      <p className="text-xs font-semibold text-amber-400">
                        Línea de tiempo detallada del pedido #{order.orderNumber}
                      </p>
                      <div className="space-y-2.5">
                        {orderMovs.map((m) => (
                          <div key={m.id} className="flex items-start gap-2.5 text-xs">
                            <Clock className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <span className="font-mono text-zinc-400 tabular-nums">
                                {formatDateTimeShort(m.createdAtMs)}
                              </span>{' '}
                              <span className="font-semibold text-white">{m.waiterName}:</span>{' '}
                              <span className="text-zinc-300">{m.description}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Void Order Confirmation Modal */}
      {voidTarget && permissions.canVoidOrders && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-order-modal-title"
        >
          <form
            onSubmit={handleConfirmVoid}
            className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-amber-400 shrink-0" />
                <h2 id="void-order-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ANULAR VENTA #{voidTarget.orderNumber}
                </h2>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setVoidTarget(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <p className="text-xs text-zinc-300 leading-relaxed">
                El pedido <strong>#{voidTarget.orderNumber} ({voidTarget.reference})</strong> por{' '}
                <strong className="text-amber-400">{formatCurrency(voidTarget.total)}</strong> quedará registrado en el historial como <strong>Venta Anulada</strong> sin borrar su rastro de auditoría.
              </p>

              <div>
                <label htmlFor="void-order-reason" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Motivo de anulación (opcional)
                </label>
                <input
                  id="void-order-reason"
                  type="text"
                  maxLength={160}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Ej. Cliente canceló, error al registrar..."
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setVoidTarget(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="min-h-[44px] rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {actionBusy ? 'Anulando...' : 'Confirmar anulación'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Permanent Hard Delete Confirmation Modal (Admin Only) */}
      {deleteTarget && permissions.canHardDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-order-modal-title"
        >
          <div className="w-full sm:max-w-md bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <h2 id="delete-order-modal-title" className="font-poster text-xl font-extrabold tracking-wide uppercase">
                  ELIMINAR RASTRO COMPLETO
                </h2>
              </div>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setDeleteTarget(null)}
                aria-label="Cerrar"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="rounded-xl bg-red-950/60 border border-red-700 px-3 py-2 text-xs font-medium text-red-200">
                  {actionError}
                </div>
              )}

              <p className="text-sm text-zinc-200 leading-relaxed">
                ¿Eliminar por completo el pedido{' '}
                <strong className="text-amber-400">
                  #{deleteTarget.orderNumber} ({deleteTarget.reference})
                </strong>{' '}
                junto con toda su bitácora y comprobantes asociados? Esta acción es permanente.
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setDeleteTarget(null)}
                  className="min-h-[44px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleConfirmHardDelete}
                  className="min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-50"
                >
                  {actionBusy ? 'Eliminando...' : 'Eliminar rastro'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CustomersModal open={customersOpen} onClose={() => setCustomersOpen(false)} />
    </div>
  );
};

