import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Banknote,
  CheckCircle2,
  CreditCard,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import type { Order, TrackedPaymentMethod } from '../types/pos';
import { formatCurrency, PAYMENT_METHOD_LABELS } from '../utils/orderMath';
import { TRACKED_PAYMENT_METHOD_LABELS, TRACKED_PAYMENT_METHODS } from '../utils/shiftMath';

interface Props {
  order: Order | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (params: {
    orderId: string;
    reason: string;
    refundMethod?: TrackedPaymentMethod;
  }) => Promise<void>;
}

const QUICK_VOID_REASONS = [
  'Cliente decidió no llevar',
  'Pedido no puede salir',
  'Pedido cancelado',
  'Error al registrar',
];

function RefundMethodIcon({ method }: { method: TrackedPaymentMethod }) {
  if (method === 'efectivo') return <Banknote className="w-4 h-4 shrink-0" />;
  if (method === 'transferencia') return <Smartphone className="w-4 h-4 shrink-0" />;
  if (method === 'tarjeta') return <CreditCard className="w-4 h-4 shrink-0" />;
  return <Wallet className="w-4 h-4 shrink-0" />;
}

export const VoidOrderModal: React.FC<Props> = ({
  order,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<TrackedPaymentMethod | undefined>(undefined);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setRefundMethod(undefined);
    setLocalError(null);
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    const handleBackIntercept = (e: Event) => {
      e.preventDefault();
      if (!busy) {
        onClose();
      }
    };
    window.addEventListener('ondeluigi:back-intercept', handleBackIntercept);
    return () => window.removeEventListener('ondeluigi:back-intercept', handleBackIntercept);
  }, [order, busy, onClose]);

  if (!order) return null;

  const isPaidOrder = order.paymentStatus === 'pagado';
  const combinedError = localError || error;
  const canSubmit = !busy && (!isPaidOrder || Boolean(refundMethod));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPaidOrder && !refundMethod) {
      setLocalError('Selecciona el método en que se devolverá el dinero al cliente.');
      return;
    }
    setLocalError(null);
    await onConfirm({
      orderId: order.id,
      reason: reason.trim(),
      refundMethod: isPaidOrder ? refundMethod : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-order-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between bg-[#101014] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Ban className="w-5 h-5 text-red-400 shrink-0" />
            <h2
              id="void-order-modal-title"
              className="font-poster text-xl font-extrabold tracking-wide uppercase truncate"
            >
              ANULAR COMANDA #{order.orderNumber}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Cerrar"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:bg-[#1C1C22] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {combinedError && (
            <div
              role="alert"
              className="rounded-xl bg-red-950/70 border border-red-700 px-3.5 py-2.5 text-xs font-semibold text-red-200 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{combinedError}</span>
            </div>
          )}

          <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-3.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white truncate">
                #{order.orderNumber} · {order.reference}
              </span>
              <span className="font-mono text-sm font-extrabold text-amber-400 tabular-nums shrink-0">
                {formatCurrency(order.total)}
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              {isPaidOrder
                ? `Ya cobrado por ${PAYMENT_METHOD_LABELS[order.paymentMethod]}`
                : 'Comanda pendiente por cobrar'}
              {' · '}Pasará a <strong>Comandas Anuladas</strong> y restaurará ingredientes en inventario.
            </p>
          </div>

          {isPaidOrder ? (
            <div className="rounded-xl border border-amber-500/45 bg-amber-950/20 p-3.5 space-y-2.5">
              <div>
                <p className="text-xs font-extrabold text-amber-300 uppercase tracking-wide">
                  ¿En qué método se devolverá el dinero? *
                </p>
                <p className="text-[11px] text-zinc-300 mt-0.5">
                  Este pedido ya está cancelado/pagado ({formatCurrency(order.total)}). Selecciona cómo se entrega el reembolso para cuadrar la caja:
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Método de devolución del dinero">
                {TRACKED_PAYMENT_METHODS.map((method) => {
                  const selected = refundMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      disabled={busy}
                      aria-pressed={selected}
                      onClick={() => {
                        setRefundMethod(method);
                        setLocalError(null);
                      }}
                      className={`min-h-[46px] px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                        selected
                          ? 'bg-amber-500 border-amber-400 text-black'
                          : 'bg-[#141418] border-[#27272E] text-zinc-200 hover:border-amber-500/60'
                      }`}
                    >
                      <RefundMethodIcon method={method} />
                      <span>{TRACKED_PAYMENT_METHOD_LABELS[method]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 py-2.5 text-xs text-zinc-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Comanda sin pago registrado: no requiere devolución de dinero.</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="void-order-reason" className="block text-xs font-semibold text-zinc-300">
              Motivo de anulación (opcional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_VOID_REASONS.map((preset) => {
                const active = reason.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={busy}
                    onClick={() => setReason(preset)}
                    className={`min-h-[32px] px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-red-600 border-red-500 text-white'
                        : 'bg-[#1C1C22] border-[#27272E] text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              id="void-order-reason"
              type="text"
              maxLength={240}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="O escribe el motivo detallado..."
              className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-[46px] rounded-xl border border-[#27272E] bg-[#1C1C22] text-sm font-semibold text-zinc-200 hover:border-zinc-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-[46px] rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {busy
                ? 'Anulando...'
                : isPaidOrder && !refundMethod
                  ? 'Elige devolución'
                  : 'Confirmar anulación'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
