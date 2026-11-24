import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Lock,
  Play,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  Wallet,
} from 'lucide-react';
import { usePosStore } from '../services/posStore';
import type { Shift, TrackedPaymentMethod } from '../types/pos';
import { formatCurrency, formatDateTimeShort } from '../utils/orderMath';
import { ROLE_LABELS } from '../utils/rolePermissions';
import {
  computeShiftExpectedSummary,
  formatShiftDuration,
  TRACKED_PAYMENT_METHOD_LABELS,
} from '../utils/shiftMath';

function parseMoneyInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  return Math.max(0, Math.min(100000000, Number(digits)));
}

function MethodIcon({ method }: { method: TrackedPaymentMethod }) {
  if (method === 'efectivo') return <Banknote className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (method === 'transferencia') return <Smartphone className="w-4 h-4 text-sky-400 shrink-0" />;
  if (method === 'tarjeta') return <CreditCard className="w-4 h-4 text-amber-400 shrink-0" />;
  return <Wallet className="w-4 h-4 text-zinc-300 shrink-0" />;
}

function formatDiffLabel(diff: number): {
  text: string;
  badgeClass: string;
  tag: string;
} {
  if (diff === 0) {
    return {
      text: '$ 0',
      badgeClass: 'bg-emerald-950/70 border-emerald-700 text-emerald-300',
      tag: 'Cuadrada',
    };
  }
  if (diff > 0) {
    return {
      text: `+${formatCurrency(diff)}`,
      badgeClass: 'bg-emerald-950/70 border-emerald-700 text-emerald-300',
      tag: 'Sobrante',
    };
  }
  return {
    text: `-${formatCurrency(Math.abs(diff))}`,
    badgeClass: 'bg-red-950/70 border-red-700 text-red-300',
    tag: 'Faltante',
  };
}

export const ShiftsView: React.FC<{ embeddedInModal?: boolean }> = ({
  embeddedInModal = false,
}) => {
  const {
    shifts,
    openShift,
    orders,
    movements,
    permissions,
    effectiveRole,
    openCashShift,
    closeCashShift,
    deleteShiftRecord,
  } = usePosStore();

  const [openingBaseText, setOpeningBaseText] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [openingBusy, setOpeningBusy] = useState(false);

  const [closingBaseText, setClosingBaseText] = useState('');
  const [closingMethodInputs, setClosingMethodInputs] = useState<
    Partial<Record<TrackedPaymentMethod, string>>
  >({});
  const [closingNote, setClosingNote] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Live expectation snapshot for the currently open shift
  const liveExpected = useMemo(() => {
    if (!openShift) return null;
    return computeShiftExpectedSummary({
      orders,
      movements,
      openedAtMs: openShift.openedAtMs,
      closedAtMs: Date.now(),
      openingBaseAmount: openShift.openingBaseAmount,
    });
  }, [openShift, orders, movements]);

  const closedShifts = useMemo(
    () =>
      shifts
        .filter((s) => s.status === 'cerrado')
        .sort((a, b) => (b.closedAtMs || b.openedAtMs) - (a.closedAtMs || a.openedAtMs)),
    [shifts]
  );

  if (!permissions.canManageShifts) {
    return (
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-10 text-center max-w-lg mx-auto my-8 space-y-3">
        <Lock className="w-10 h-10 text-amber-400 mx-auto" />
        <h1 className="font-poster text-2xl font-extrabold text-white tracking-wide">
          TURNOS Y CAJA NO DISPONIBLE
        </h1>
        <p className="text-sm text-zinc-400">
          Tu rol actual (<strong className="text-white">{ROLE_LABELS[effectiveRole]}</strong>) no administra apertura ni cierre de caja.
        </p>
      </div>
    );
  }

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!openingBaseText.trim()) {
      setFeedback({
        type: 'error',
        text: 'Ingresa el valor de la base inicial en la caja física (puede ser 0 si arrancas vacía).',
      });
      return;
    }
    const parsedBase = parseMoneyInput(openingBaseText);
    setOpeningBusy(true);
    try {
      await openCashShift(parsedBase, openingNote);
      setOpeningBaseText('');
      setOpeningNote('');
      setClosingBaseText('');
      setClosingMethodInputs({});
      setClosingNote('');
      setFeedback({
        type: 'success',
        text: `Turno abierto con base inicial de ${formatCurrency(parsedBase)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo abrir el turno.',
      });
    } finally {
      setOpeningBusy(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openShift || !liveExpected) return;
    setFeedback(null);

    if (!closingBaseText.trim()) {
      setFeedback({
        type: 'error',
        text: 'Ingresa cuánto quedó en la base de la caja física.',
      });
      return;
    }

    const declaredClosingBase = parseMoneyInput(closingBaseText);
    const declaredByMethod: Partial<Record<TrackedPaymentMethod, number>> = {};

    for (const method of liveExpected.usedPaymentMethods) {
      const rawVal = closingMethodInputs[method] ?? '';
      if (!rawVal.trim()) {
        setFeedback({
          type: 'error',
          text: `Ingresa el total contado para ${TRACKED_PAYMENT_METHOD_LABELS[method]}.`,
        });
        return;
      }
      declaredByMethod[method] = parseMoneyInput(rawVal);
    }

    setClosingBusy(true);
    try {
      await closeCashShift({
        shiftId: openShift.id,
        declaredClosingBase,
        declaredByMethod,
        closingNote,
      });
      setClosingBaseText('');
      setClosingMethodInputs({});
      setClosingNote('');
      setFeedback({
        type: 'success',
        text: 'Turno cerrado y registrado correctamente.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo cerrar el turno.',
      });
    } finally {
      setClosingBusy(false);
    }
  };

  const handleDeleteShift = async (shift: Shift) => {
    setFeedback(null);
    try {
      await deleteShiftRecord(shift.id);
      setConfirmDeleteId(null);
      setFeedback({ type: 'success', text: 'Registro de turno eliminado.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el turno.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          {!embeddedInModal && (
            <h1 className="font-poster text-3xl sm:text-4xl font-extrabold tracking-wide text-white leading-none">
              TURNOS Y CAJA
            </h1>
          )}
          <p className={`text-xs text-zinc-400 ${embeddedInModal ? '' : 'mt-1'}`}>
            Control de apertura con base física y cierre selectivo según los métodos de pago usados en el turno.
          </p>
        </div>

        <div
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold self-start sm:self-auto shrink-0 ${
            openShift
              ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
              : 'bg-[#141418] border-[#27272E] text-zinc-300'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              openShift ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
            }`}
          />
          <span>{openShift ? 'TURNO EN CURSO' : 'SIN TURNO ABIERTO'}</span>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'error'
              ? 'bg-red-950/70 border-red-600 text-red-100'
              : 'bg-emerald-950/70 border-emerald-600 text-emerald-100'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Active Shift or Open Shift Card */}
      {!openShift ? (
        <section className="bg-[#141418] border border-[#27272E] rounded-2xl p-5 sm:p-6 space-y-5 max-w-2xl">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Play className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="font-poster text-xl font-extrabold text-white tracking-wide uppercase">
                ABRIR NUEVO TURNO
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Registra el dinero base con el que arranca la caja física y la hora exacta de apertura.
              </p>
            </div>
          </div>

          <form onSubmit={handleOpenShift} className="space-y-4">
            <div>
              <label
                htmlFor="shift-opening-base"
                className="block text-xs font-bold text-zinc-200 mb-1.5"
              >
                Base inicial en la caja física ($)
              </label>
              <input
                id="shift-opening-base"
                type="text"
                inputMode="numeric"
                value={openingBaseText}
                onChange={(e) => setOpeningBaseText(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Ej. 100000"
                className="w-full min-h-[46px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 font-mono text-base font-bold text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              {openingBaseText && (
                <p className="text-xs font-mono text-amber-400 mt-1">
                  {formatCurrency(parseMoneyInput(openingBaseText))}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="shift-opening-note"
                className="block text-xs font-semibold text-zinc-400 mb-1.5"
              >
                Observación de apertura (opcional)
              </label>
              <input
                id="shift-opening-note"
                type="text"
                maxLength={300}
                value={openingNote}
                onChange={(e) => setOpeningNote(e.target.value)}
                placeholder="Ej. Cambio en billetes pequeños..."
                className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={openingBusy}
              className="w-full sm:w-auto min-h-[46px] px-6 rounded-xl bg-amber-500 text-black text-sm font-extrabold uppercase tracking-wide hover:bg-amber-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              <span>{openingBusy ? 'Abriendo turno...' : 'Abrir turno ahora'}</span>
            </button>
          </form>
        </section>
      ) : (
        <section className="bg-[#141418] border border-amber-500/60 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 bg-[#101014] border-b border-[#27272E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="font-poster text-xl font-extrabold text-white tracking-wide uppercase">
                  TURNO ABIERTO
                </span>
              </div>
              <p className="text-xs text-zinc-300">
                Apertura: <strong className="text-white">{formatDateTimeShort(openShift.openedAtMs)}</strong> · Abierto por{' '}
                <strong className="text-amber-300">{openShift.openedByName}</strong>
              </p>
              {openShift.openingNote && (
                <p className="text-xs text-zinc-400">Nota: {openShift.openingNote}</p>
              )}
            </div>

            <div className="bg-[#1C1C22] border border-[#27272E] rounded-xl px-4 py-2.5 self-start sm:self-auto">
              <p className="text-[11px] font-semibold text-zinc-400 uppercase">Base inicial en caja</p>
              <p className="font-mono text-lg font-extrabold text-amber-400 tabular-nums">
                {formatCurrency(openShift.openingBaseAmount)}
              </p>
            </div>
          </div>

          <form onSubmit={handleCloseShift} className="p-4 sm:p-6 space-y-5">
            {liveExpected && liveExpected.pendingOrdersCount > 0 && (
              <div className="rounded-xl bg-amber-950/40 border border-amber-600/60 px-3.5 py-2.5 text-xs text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Hay <strong>{liveExpected.pendingOrdersCount}</strong>{' '}
                  {liveExpected.pendingOrdersCount === 1 ? 'pedido por cobrar' : 'pedidos por cobrar'} creado(s) en este turno que aún no figuran como pagados.
                </span>
              </div>
            )}

            {/* Admin-only live reference while shift is open */}
            {permissions.canAuditShiftDifferences && liveExpected && (
              <div className="rounded-xl border border-amber-500/40 bg-[#0A0A0A] p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wide">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Resumen esperado en tiempo real (Solo Administrador)</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="bg-[#141418] border border-[#27272E] rounded-lg p-2.5">
                    <p className="text-zinc-400">Base inicial</p>
                    <p className="font-mono font-bold text-white mt-0.5 tabular-nums">
                      {formatCurrency(liveExpected.expectedBaseAmount)}
                    </p>
                  </div>
                  {liveExpected.usedPaymentMethods.map((m) => (
                    <div key={m} className="bg-[#141418] border border-[#27272E] rounded-lg p-2.5">
                      <p className="text-zinc-400">{TRACKED_PAYMENT_METHOD_LABELS[m]}</p>
                      <p className="font-mono font-bold text-white mt-0.5 tabular-nums">
                        {formatCurrency(liveExpected.expectedByMethod[m] || 0)}
                      </p>
                    </div>
                  ))}
                  <div className="bg-[#141418] border border-amber-500/40 rounded-lg p-2.5">
                    <p className="text-amber-300 font-semibold">Total esperado</p>
                    <p className="font-mono font-extrabold text-amber-400 mt-0.5 tabular-nums">
                      {formatCurrency(liveExpected.expectedTotal)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Cierre de turno</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {permissions.canAuditShiftDifferences
                    ? 'Registra la base que quedó en caja y el total contado en cada método de pago utilizado.'
                    : 'Registra la base que quedó en la caja física y el total de los métodos usados. La comparación contra lo esperado solo es visible para administradores.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="shift-closing-base"
                    className="block text-xs font-bold text-zinc-200 mb-1.5"
                  >
                    Base que quedó en la caja física ($)
                  </label>
                  <input
                    id="shift-closing-base"
                    type="text"
                    inputMode="numeric"
                    value={closingBaseText}
                    onChange={(e) => setClosingBaseText(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Ej. 100000"
                    className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 font-mono text-sm font-bold text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {closingBaseText && (
                    <p className="text-[11px] font-mono text-amber-400 mt-1">
                      {formatCurrency(parseMoneyInput(closingBaseText))}
                    </p>
                  )}
                </div>

                {/* Selective fields: ONLY render payment methods that had paid orders in this shift */}
                {liveExpected?.usedPaymentMethods.map((method) => {
                  const valText = closingMethodInputs[method] ?? '';
                  return (
                    <div key={method}>
                      <label
                        htmlFor={`shift-method-${method}`}
                        className="flex items-center gap-1.5 text-xs font-bold text-zinc-200 mb-1.5"
                      >
                        <MethodIcon method={method} />
                        <span>Total en {TRACKED_PAYMENT_METHOD_LABELS[method]} ($)</span>
                      </label>
                      <input
                        id={`shift-method-${method}`}
                        type="text"
                        inputMode="numeric"
                        value={valText}
                        onChange={(e) =>
                          setClosingMethodInputs((prev) => ({
                            ...prev,
                            [method]: e.target.value.replace(/[^0-9]/g, ''),
                          }))
                        }
                        placeholder="0"
                        className="w-full min-h-[44px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 font-mono text-sm font-bold text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      {valText && (
                        <p className="text-[11px] font-mono text-zinc-300 mt-1">
                          {formatCurrency(parseMoneyInput(valText))}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {liveExpected && liveExpected.usedPaymentMethods.length === 0 && (
                <p className="text-xs text-zinc-400 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3.5 py-2.5">
                  No se han registrado ventas pagadas en este turno, por eso solo se solicita el conteo de la base en la caja física.
                </p>
              )}

              <div>
                <label
                  htmlFor="shift-closing-note"
                  className="block text-xs font-semibold text-zinc-400 mb-1.5"
                >
                  Nota de cierre (opcional)
                </label>
                <input
                  id="shift-closing-note"
                  type="text"
                  maxLength={300}
                  value={closingNote}
                  onChange={(e) => setClosingNote(e.target.value)}
                  placeholder="Ej. Novedades de caja o gastos menores..."
                  className="w-full min-h-[42px] rounded-xl border border-[#27272E] bg-[#0A0A0A] px-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#27272E]">
              <p className="text-xs text-zinc-400">
                La hora exacta de cierre se guardará automáticamente al confirmar.
              </p>
              <button
                type="submit"
                disabled={closingBusy}
                className="min-h-[46px] px-6 rounded-xl bg-red-600 text-white text-sm font-extrabold uppercase tracking-wide hover:bg-red-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <Square className="w-4 h-4" />
                <span>{closingBusy ? 'Cerrando turno...' : 'Cerrar turno'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Closed Shifts History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-poster text-xl font-extrabold text-white tracking-wide uppercase">
            HISTORIAL DE TURNOS ({closedShifts.length})
          </h2>
        </div>

        {closedShifts.length === 0 ? (
          <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-8 text-center text-sm text-zinc-400">
            Aún no hay turnos cerrados registrados.
          </div>
        ) : (
          <div className="space-y-3">
            {closedShifts.map((shift) => {
              const diffInfo = formatDiffLabel(shift.differenceTotal);
              const baseDiff = shift.declaredClosingBase - shift.expectedBaseAmount;

              return (
                <article
                  key={shift.id}
                  className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-[#1C1C22] border border-[#27272E] text-[11px] font-bold text-zinc-300">
                          Cerrado · {formatShiftDuration(shift.openedAtMs, shift.closedAtMs)}
                        </span>
                        {permissions.canAuditShiftDifferences && (
                          <span
                            className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold tabular-nums ${diffInfo.badgeClass}`}
                          >
                            {diffInfo.tag}: {diffInfo.text}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-300">
                        Apertura: <strong className="text-white">{formatDateTimeShort(shift.openedAtMs)}</strong> ({shift.openedByName})
                      </p>
                      <p className="text-xs text-zinc-300">
                        Cierre: <strong className="text-white">{formatDateTimeShort(shift.closedAtMs)}</strong> ({shift.closedByName || 'Equipo'})
                      </p>
                      {shift.closingNote && (
                        <p className="text-xs text-zinc-400">Nota cierre: {shift.closingNote}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-start">
                      <div className="bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3.5 py-2 text-right">
                        <p className="text-[11px] text-zinc-400">Total declarado</p>
                        <p className="font-mono text-base font-extrabold text-amber-400 tabular-nums">
                          {formatCurrency(shift.declaredTotal)}
                        </p>
                      </div>

                      {permissions.canAuditShiftDifferences && (
                        confirmDeleteId === shift.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleDeleteShift(shift)}
                              className="min-h-[38px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500"
                            >
                              Borrar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#1C1C22] text-xs text-zinc-300"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Eliminar turno ${formatDateTimeShort(shift.openedAtMs)}`}
                            onClick={() => setConfirmDeleteId(shift.id)}
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-[#27272E] bg-[#1C1C22] text-zinc-400 hover:text-red-400 hover:border-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Declared amounts visible to authorized staff */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-[#0A0A0A] border border-[#27272E] rounded-xl p-2.5">
                      <p className="text-zinc-400">Base apertura</p>
                      <p className="font-mono font-bold text-white mt-0.5 tabular-nums">
                        {formatCurrency(shift.openingBaseAmount)}
                      </p>
                    </div>
                    <div className="bg-[#0A0A0A] border border-[#27272E] rounded-xl p-2.5">
                      <p className="text-zinc-400">Base cierre declarada</p>
                      <p className="font-mono font-bold text-white mt-0.5 tabular-nums">
                        {formatCurrency(shift.declaredClosingBase)}
                      </p>
                    </div>
                    {shift.usedPaymentMethods.map((method) => (
                      <div key={method} className="bg-[#0A0A0A] border border-[#27272E] rounded-xl p-2.5">
                        <p className="text-zinc-400">
                          {TRACKED_PAYMENT_METHOD_LABELS[method]} declarado
                        </p>
                        <p className="font-mono font-bold text-white mt-0.5 tabular-nums">
                          {formatCurrency(shift.declaredByMethod[method] || 0)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Admin-only expected vs declared reconciliation */}
                  {permissions.canAuditShiftDifferences && (
                    <div className="rounded-xl border border-amber-500/35 bg-[#0A0A0A] p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 uppercase">
                          <ShieldCheck className="w-4 h-4" />
                          <span>Control de diferencias (Solo Administrador)</span>
                        </div>
                        <span className="text-[11px] text-zinc-400">
                          {shift.paidOrdersCount} cobrados
                          {shift.pendingOrdersCount > 0 ? ` · ${shift.pendingOrdersCount} pendientes` : ''}
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="text-[11px] text-zinc-400 border-b border-[#27272E]">
                            <tr>
                              <th className="py-1.5 pr-3 font-semibold">Concepto</th>
                              <th className="py-1.5 px-3 font-semibold text-right">Esperado</th>
                              <th className="py-1.5 px-3 font-semibold text-right">Declarado</th>
                              <th className="py-1.5 pl-3 font-semibold text-right">Diferencia</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#27272E]/60 font-mono tabular-nums">
                            <tr>
                              <td className="py-1.5 pr-3 font-sans text-zinc-200">Base física</td>
                              <td className="py-1.5 px-3 text-right text-zinc-300">
                                {formatCurrency(shift.expectedBaseAmount)}
                              </td>
                              <td className="py-1.5 px-3 text-right text-white">
                                {formatCurrency(shift.declaredClosingBase)}
                              </td>
                              <td
                                className={`py-1.5 pl-3 text-right font-bold ${
                                  baseDiff < 0 ? 'text-red-400' : 'text-emerald-400'
                                }`}
                              >
                                {formatDiffLabel(baseDiff).text}
                              </td>
                            </tr>
                            {shift.usedPaymentMethods.map((method) => {
                              const exp = shift.expectedByMethod[method] || 0;
                              const dec = shift.declaredByMethod[method] || 0;
                              const diff = dec - exp;
                              return (
                                <tr key={method}>
                                  <td className="py-1.5 pr-3 font-sans text-zinc-200">
                                    {TRACKED_PAYMENT_METHOD_LABELS[method]}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-zinc-300">
                                    {formatCurrency(exp)}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-white">
                                    {formatCurrency(dec)}
                                  </td>
                                  <td
                                    className={`py-1.5 pl-3 text-right font-bold ${
                                      diff < 0 ? 'text-red-400' : 'text-emerald-400'
                                    }`}
                                  >
                                    {formatDiffLabel(diff).text}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="border-t border-[#27272E] font-bold">
                              <td className="py-2 pr-3 font-sans text-white">Total general</td>
                              <td className="py-2 px-3 text-right text-zinc-200">
                                {formatCurrency(shift.expectedTotal)}
                              </td>
                              <td className="py-2 px-3 text-right text-amber-400">
                                {formatCurrency(shift.declaredTotal)}
                              </td>
                              <td
                                className={`py-2 pl-3 text-right ${
                                  shift.differenceTotal < 0 ? 'text-red-400' : 'text-emerald-400'
                                }`}
                              >
                                {diffInfo.text}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
