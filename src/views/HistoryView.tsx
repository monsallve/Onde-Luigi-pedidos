import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  FileImage,
  History,
  PlusCircle,
  Search,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { MovementType } from '../types/pos';
import {
  formatCurrency,
  formatDateTimeShort,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../utils/orderMath';

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
  const { orders, movements } = usePosStore();
  const [subTab, setSubTab] = useState<'bitacora' | 'pedidos'>('bitacora');
  const [typeFilter, setTypeFilter] = useState<'todos' | MovementType>('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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
        o.waiterName.toLowerCase().includes(q)
      );
    });
  }, [orders, searchTerm]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
            HISTORIAL Y BITÁCORA
          </h1>
          <p className="text-xs text-zinc-400 mt-1 tabular-nums">
            Auditoría cronológica de {movements.length} movimientos en {orders.length} pedidos
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#141418] border border-[#27272E] rounded-xl self-start sm:self-auto">
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
          <button
            type="button"
            onClick={() => setSubTab('pedidos')}
            className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'pedidos'
                ? 'bg-amber-500 text-black font-bold'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            Línea por pedido
          </button>
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
            placeholder="Filtrar por #pedido, mesa, cliente o mesero..."
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

              return (
                <div
                  key={order.id}
                  className="bg-[#141418] border border-[#27272E] rounded-2xl overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedOrderId(isOpen ? null : order.id)}
                    aria-expanded={isOpen}
                    className="w-full p-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#1C1C22] transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                        <span className="font-bold text-amber-400">#{order.orderNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDateTimeShort(order.createdAtMs)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{orderMovs.length} eventos</span>
                      </div>
                      <p className="font-poster text-xl font-extrabold text-white mt-0.5 uppercase">
                        {order.reference}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-left sm:text-right">
                        <p className="text-xs font-semibold text-zinc-300">
                          {ORDER_STATUS_LABELS[order.status]} ·{' '}
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
                        <p className="font-mono text-sm font-bold text-amber-400 tabular-nums">
                          {formatCurrency(order.total)}
                        </p>
                      </div>
                      <History className="w-4 h-4 text-zinc-400 shrink-0" />
                    </div>
                  </button>

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
    </div>
  );
};
