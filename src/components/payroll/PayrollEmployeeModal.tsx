import React, { useEffect, useState } from 'react';
import { Info, UserPlus, X } from 'lucide-react';
import type { PayrollEmployee, PayrollEmployeeInput, PayrollPaymentMethod } from '../../types/payroll';
import { assertSafeTextInput } from '../../utils/inputSecurity';

interface PayrollEmployeeModalProps {
  open: boolean;
  editingEmployee: PayrollEmployee | null;
  onClose: () => void;
  onSave: (input: PayrollEmployeeInput) => Promise<void>;
}

export const PayrollEmployeeModal: React.FC<PayrollEmployeeModalProps> = ({
  open,
  editingEmployee,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [position, setPosition] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [phone, setPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PayrollPaymentMethod>('efectivo');
  const [bank, setBank] = useState('');
  const [applyNight, setApplyNight] = useState(false);
  const [nightPercent, setNightPercent] = useState('35');
  const [applyHoliday, setApplyHoliday] = useState(false);
  const [holidayPercent, setHolidayPercent] = useState('75');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingEmployee?.name || '');
    setDocument(editingEmployee?.document || '');
    setPosition(editingEmployee?.position || '');
    setHourlyRate(editingEmployee?.hourlyRate ? String(editingEmployee.hourlyRate) : '');
    setPhone(editingEmployee?.phone || '');
    setPaymentMethod(editingEmployee?.paymentMethod === 'banco' ? 'banco' : 'efectivo');
    setBank(editingEmployee?.bank || '');
    setApplyNight(Boolean(editingEmployee?.applyNight));
    setNightPercent(
      editingEmployee?.nightPercent != null ? String(editingEmployee.nightPercent) : '35'
    );
    setApplyHoliday(Boolean(editingEmployee?.applyHoliday));
    setHolidayPercent(
      editingEmployee?.holidayPercent != null ? String(editingEmployee.holidayPercent) : '75'
    );
    setNotes(editingEmployee?.notes || '');
    setError(null);
    setSubmitting(false);
  }, [open, editingEmployee]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const safeName = assertSafeTextInput(name, 'Nombre completo', {
        maxLen: 120,
        required: true,
      });
      const safeDoc = assertSafeTextInput(document, 'Documento (Cédula)', {
        maxLen: 40,
        required: true,
      });
      const rateNum = parseFloat(hourlyRate) || 0;
      if (rateNum <= 0) {
        setError('El valor por hora debe ser mayor a 0.');
        return;
      }
      const safePosition = assertSafeTextInput(position, 'Cargo', { maxLen: 80 });
      const safePhone = assertSafeTextInput(phone, 'Teléfono', { maxLen: 40 });
      const safeBank =
        paymentMethod === 'banco'
          ? assertSafeTextInput(bank, 'Cuenta bancaria / Entidad', { maxLen: 120 })
          : '';
      const safeNotes = assertSafeTextInput(notes, 'Observaciones', {
        maxLen: 400,
        allowNewlines: true,
      });

      const parsedNight = parseFloat(nightPercent);
      const parsedHoliday = parseFloat(holidayPercent);

      setSubmitting(true);
      await onSave({
        id: editingEmployee?.id,
        name: safeName,
        document: safeDoc,
        position: safePosition,
        hourlyRate: rateNum,
        paymentMethod,
        bank: safeBank,
        phone: safePhone,
        applyNight,
        nightPercent: Number.isFinite(parsedNight) && parsedNight >= 0 ? parsedNight : 35,
        applyHoliday,
        holidayPercent: Number.isFinite(parsedHoliday) && parsedHoliday >= 0 ? parsedHoliday : 75,
        notes: safeNotes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el empleado.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payroll-employee-modal-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-[#141418] text-white rounded-t-3xl sm:rounded-2xl border border-[#27272E] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-4 border-b border-[#27272E] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-5 h-5 text-amber-400 shrink-0" />
            <h2
              id="payroll-employee-modal-title"
              className="font-poster text-xl font-extrabold tracking-wide uppercase"
            >
              {editingEmployee ? 'Editar empleado' : 'Nuevo empleado'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de empleado"
            className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-zinc-400 hover:bg-[#1C1C22] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-red-950/60 border border-red-700 px-3.5 py-2.5 text-xs text-red-200 font-medium"
            >
              {error}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Datos personales
            </p>
            <div>
              <label htmlFor="payroll-e-name" className="block text-xs font-semibold text-zinc-300 mb-1">
                Nombre completo *
              </label>
              <input
                id="payroll-e-name"
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombres y apellidos"
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="payroll-e-doc" className="block text-xs font-semibold text-zinc-300 mb-1">
                Documento (Cédula) *
              </label>
              <input
                id="payroll-e-doc"
                type="text"
                required
                maxLength={40}
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                placeholder="Número de documento"
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="payroll-e-position" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Cargo
                </label>
                <input
                  id="payroll-e-position"
                  type="text"
                  maxLength={80}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="payroll-e-rate" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Valor hora base (COP) *
                </label>
                <input
                  id="payroll-e-rate"
                  type="number"
                  required
                  min={1}
                  step={100}
                  inputMode="numeric"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  placeholder="8000"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white font-mono placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="payroll-e-phone" className="block text-xs font-semibold text-zinc-300 mb-1">
                Teléfono
              </label>
              <input
                id="payroll-e-phone"
                type="tel"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-[#27272E]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Forma de pago
            </p>
            <div>
              <label htmlFor="payroll-e-payment" className="block text-xs font-semibold text-zinc-300 mb-1">
                Método
              </label>
              <select
                id="payroll-e-payment"
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value === 'banco' ? 'banco' : 'efectivo')
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="efectivo">Efectivo</option>
                <option value="banco">Consignación bancaria</option>
              </select>
            </div>

            {paymentMethod === 'banco' && (
              <div>
                <label htmlFor="payroll-e-bank" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Cuenta bancaria / Entidad
                </label>
                <input
                  id="payroll-e-bank"
                  type="text"
                  maxLength={120}
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  placeholder="Ej: Bancolombia 123-456789-01"
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="space-y-3 pt-2 border-t border-[#27272E]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Recargos opcionales
            </p>
            <div className="rounded-xl bg-[#1C1C22] border border-[#27272E] p-3 flex items-start gap-2.5 text-xs text-zinc-300">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Si no activas estos recargos, <strong className="text-white">todas las horas se pagan al valor base</strong>.
              </span>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={applyNight}
                onChange={(e) => setApplyNight(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500"
              />
              <span>Activar recargo nocturno</span>
            </label>

            {applyNight && (
              <div>
                <label htmlFor="payroll-e-night-pct" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Porcentaje recargo nocturno (%)
                </label>
                <input
                  id="payroll-e-night-pct"
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  inputMode="numeric"
                  value={nightPercent}
                  onChange={(e) => setNightPercent(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}

            <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={applyHoliday}
                onChange={(e) => setApplyHoliday(e.target.checked)}
                className="w-4 h-4 rounded accent-amber-500"
              />
              <span>Activar recargo dominical / festivo</span>
            </label>

            {applyHoliday && (
              <div>
                <label htmlFor="payroll-e-holiday-pct" className="block text-xs font-semibold text-zinc-300 mb-1">
                  Porcentaje recargo dominical/festivo (%)
                </label>
                <input
                  id="payroll-e-holiday-pct"
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  inputMode="numeric"
                  value={holidayPercent}
                  onChange={(e) => setHolidayPercent(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-[#27272E]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Otros</p>
            <div>
              <label htmlFor="payroll-e-notes" className="block text-xs font-semibold text-zinc-300 mb-1">
                Observaciones
              </label>
              <textarea
                id="payroll-e-notes"
                rows={2}
                maxLength={400}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#27272E]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-300 hover:border-zinc-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 disabled:opacity-60"
            >
              {submitting ? 'Guardando...' : 'Guardar empleado'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
