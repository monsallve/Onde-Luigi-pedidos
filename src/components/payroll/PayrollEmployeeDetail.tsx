import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Save,
  Trash2,
  Zap,
} from 'lucide-react';
import type {
  PayrollCompany,
  PayrollEmployee,
  PayrollQuincenaRecord,
  PayrollStubRecord,
} from '../../types/payroll';
import {
  calculateQuincenaSummary,
  createInitialDayRows,
  createInitialDeductionsForm,
  formatCopMoney,
  getCutoffAndPayDates,
  getDaysInQuincena,
  getPeriodLabel,
  getQuincenaKey,
  PAYROLL_DAY_SHORT,
  PAYROLL_MONTHS,
  type DayGridFormRow,
  type DeductionsFormState,
} from '../../utils/payrollMath';
import { downloadPayrollStubPdf } from '../../utils/payrollPdf';
import { createSafeId } from '../../utils/orderMath';

interface PayrollEmployeeDetailProps {
  company: PayrollCompany;
  employee: PayrollEmployee;
  onBack: () => void;
  onEditEmployee: () => void;
  onDeleteEmployee: () => void;
  onSaveHours: (periodKey: string, record: PayrollQuincenaRecord) => Promise<void>;
  onSaveStub: (stub: PayrollStubRecord) => Promise<void>;
  onNotify: (msg: string, tone: 'success' | 'error') => void;
}

export const PayrollEmployeeDetail: React.FC<PayrollEmployeeDetailProps> = ({
  company,
  employee,
  onBack,
  onEditEmployee,
  onDeleteEmployee,
  onSaveHours,
  onSaveStub,
  onNotify,
}) => {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [half, setHalf] = useState<'1' | '2'>(now.getDate() <= 15 ? '1' : '2');
  const [saving, setSaving] = useState(false);

  const yearOptions = useMemo(() => {
    const base = now.getFullYear();
    return [base - 2, base - 1, base, base + 1];
  }, [now]);

  const periodKey = useMemo(() => getQuincenaKey(year, month, half), [year, month, half]);
  const days = useMemo(() => getDaysInQuincena(year, month, half), [year, month, half]);
  const savedPeriod = employee.hours?.[periodKey] || null;
  const savedPeriodSyncKey = `${employee.id}::${periodKey}::${savedPeriod?.savedAt || ''}`;

  const latestInitRef = useRef({ days, savedPeriod });
  latestInitRef.current = { days, savedPeriod };

  const [dayRows, setDayRows] = useState<Record<string, DayGridFormRow>>(() =>
    createInitialDayRows(days, savedPeriod)
  );
  const [deductionsForm, setDeductionsForm] = useState<DeductionsFormState>(() =>
    createInitialDeductionsForm(savedPeriod)
  );

  // Sync grid & deductions only when switching employee, quincena period, or after an actual save
  useEffect(() => {
    const { days: nextDays, savedPeriod: nextSaved } = latestInitRef.current;
    setDayRows(createInitialDayRows(nextDays, nextSaved));
    setDeductionsForm(createInitialDeductionsForm(nextSaved));
  }, [savedPeriodSyncKey]);

  const summary = useMemo(
    () =>
      calculateQuincenaSummary({
        employee,
        dayRows,
        deductionsForm,
      }),
    [employee, dayRows, deductionsForm]
  );

  const surchargesLabel = useMemo(() => {
    const items: string[] = [];
    if (employee.applyNight) items.push(`Noct. ${employee.nightPercent || 35}%`);
    if (employee.applyHoliday) items.push(`Dom/Fest ${employee.holidayPercent || 75}%`);
    return items.length ? items.join(' · ') : 'Ninguno';
  }, [employee]);

  const paymentLabel =
    employee.paymentMethod === 'banco'
      ? `Consignación${employee.bank ? ` · ${employee.bank}` : ''}`
      : 'Efectivo';

  const handleDayChange = (
    key: string,
    patch: Partial<Pick<DayGridFormRow, 'hoursStr' | 'night' | 'holiday'>>
  ) => {
    setDayRows((prev) => {
      const curr = prev[key] || { key, hoursStr: '', night: false, holiday: false };
      return {
        ...prev,
        [key]: { ...curr, ...patch },
      };
    });
  };

  const buildQuincenaPayload = (): PayrollQuincenaRecord => ({
    ...summary,
    savedAt: new Date().toISOString(),
  });

  const handleSaveHoursClick = async () => {
    setSaving(true);
    try {
      const record = buildQuincenaPayload();
      await onSaveHours(periodKey, record);
      onNotify('Horas y deducciones guardadas', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudieron guardar las horas', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateStubClick = async () => {
    if (summary.totalHours <= 0) {
      onNotify('Ingresa horas antes de generar la colilla', 'error');
      return;
    }

    setSaving(true);
    try {
      const record = buildQuincenaPayload();
      await onSaveHours(periodKey, record);

      const periodLabel = getPeriodLabel(year, month, half);
      const dateInfo = getCutoffAndPayDates(year, month, half);
      const genDate = new Date().toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const existingStub = company.stubs.find(
        (s) => s.employeeId === employee.id && s.periodKey === periodKey
      );
      const stubRecord: PayrollStubRecord = {
        id: existingStub ? existingStub.id : createSafeId('stub'),
        employeeId: employee.id,
        periodKey,
        periodLabel,
        date: new Date().toISOString().slice(0, 10),
        cutoff: dateInfo.cutoff,
        pay: dateInfo.pay,
        cutoffDay: dateInfo.cutoffDay,
        payDay: dateInfo.payDay,
        total: record.neto,
        totalHours: record.totalHours,
        gross: record.gross,
        days: record.days,
        deductions: record.deductionList,
        dedTotal: record.dedTotal,
      };

      await onSaveStub(stubRecord);
      await downloadPayrollStubPdf({
        company,
        employee,
        periodLabel,
        hoursData: record,
        genDate,
        dateInfo,
      });
      onNotify('Colilla generada y descargada', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'No se pudo generar la colilla PDF', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-amber-400 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver a la empresa</span>
      </button>

      {/* Employee Profile & Stats */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h2 className="font-poster text-2xl sm:text-3xl font-extrabold tracking-wide text-white leading-tight">
              {employee.name}
            </h2>
            <p className="text-xs text-zinc-300 mt-1">Documento: {employee.document}</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {employee.position || 'Sin cargo definido'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onEditEmployee}
              className="min-h-[38px] px-3.5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs font-semibold text-zinc-200 hover:border-amber-500 inline-flex items-center gap-1.5"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>Editar</span>
            </button>
            <button
              type="button"
              onClick={onDeleteEmployee}
              className="min-h-[38px] px-3.5 rounded-xl border border-red-800/70 bg-red-950/40 text-xs font-semibold text-red-300 hover:bg-red-900/60 inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-3">
            <p className="text-[11px] font-medium text-zinc-400">Valor hora</p>
            <p className="font-mono text-sm sm:text-base font-bold text-amber-400 mt-0.5">
              {formatCopMoney(employee.hourlyRate)}/h
            </p>
          </div>
          <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-3">
            <p className="text-[11px] font-medium text-zinc-400">Forma de pago</p>
            <p className="text-xs sm:text-sm font-semibold text-white mt-0.5 break-words">
              {paymentLabel}
            </p>
          </div>
          <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-3">
            <p className="text-[11px] font-medium text-zinc-400">Teléfono</p>
            <p className="text-xs sm:text-sm font-semibold text-white mt-0.5">
              {employee.phone || '—'}
            </p>
          </div>
          <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-3">
            <p className="text-[11px] font-medium text-zinc-400">Recargos</p>
            <p className="text-xs font-semibold text-zinc-200 mt-0.5">{surchargesLabel}</p>
          </div>
        </div>
      </div>

      {/* Quincena Hours Report & Deductions */}
      <div className="bg-[#141418] border border-[#27272E] rounded-2xl p-4 sm:p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-400 shrink-0" />
          <h3 className="font-poster text-xl font-extrabold tracking-wide text-white uppercase">
            Reporte de horas — Quincena
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="payroll-quincena-year"
              className="block text-xs font-semibold text-zinc-400 mb-1"
            >
              Año
            </label>
            <select
              id="payroll-quincena-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="payroll-quincena-month"
              className="block text-xs font-semibold text-zinc-400 mb-1"
            >
              Mes
            </label>
            <select
              id="payroll-quincena-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              {PAYROLL_MONTHS.map((mName, idx) => (
                <option key={mName} value={idx + 1}>
                  {mName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="payroll-quincena-half"
              className="block text-xs font-semibold text-zinc-400 mb-1"
            >
              Quincena
            </label>
            <select
              id="payroll-quincena-half"
              value={half}
              onChange={(e) => setHalf(e.target.value === '2' ? '2' : '1')}
              className="w-full min-h-[42px] px-3 rounded-xl border border-[#27272E] bg-[#0A0A0A] text-sm text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="1">29 → 13 (pago día 14)</option>
              <option value="2">14 → 28 (pago día 29)</option>
            </select>
          </div>
        </div>

        {(employee.applyNight || employee.applyHoliday) && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-200">
            <Zap className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Marca <strong>Nocturno</strong> o <strong>Dom/Fest</strong> solo donde aplique. Sin
              recargos activados en el empleado, todo se paga al valor base.
            </span>
          </div>
        )}

        {/* Days Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {days.map((di) => {
            const row = dayRows[di.key] || {
              key: di.key,
              hoursStr: '',
              night: false,
              holiday: di.dow === 0,
            };
            const isWeekend = di.dow === 0 || di.dow === 6;
            const inputId = `payroll-day-hours-${di.key}`;

            return (
              <div
                key={di.key}
                className={`rounded-xl border p-3 space-y-2 ${
                  isWeekend
                    ? 'bg-amber-950/20 border-amber-500/35'
                    : 'bg-[#0A0A0A] border-[#27272E]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-white">{di.label}</span>
                  <span
                    className={`text-[11px] font-semibold ${
                      di.dow === 0 ? 'text-amber-400' : 'text-zinc-400'
                    }`}
                  >
                    {PAYROLL_DAY_SHORT[di.dow]}
                  </span>
                </div>

                <div>
                  <label htmlFor={inputId} className="sr-only">
                    Horas trabajadas el {di.label} ({PAYROLL_DAY_SHORT[di.dow]})
                  </label>
                  <input
                    id={inputId}
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    inputMode="decimal"
                    placeholder="0"
                    value={row.hoursStr}
                    onChange={(e) => handleDayChange(di.key, { hoursStr: e.target.value })}
                    className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-sm font-mono text-white text-center placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {(employee.applyNight || employee.applyHoliday) && (
                  <div className="space-y-1 pt-0.5 text-[11px] text-zinc-300">
                    {employee.applyNight && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.night}
                          onChange={(e) => handleDayChange(di.key, { night: e.target.checked })}
                          className="w-3.5 h-3.5 rounded accent-amber-500"
                        />
                        <span>Nocturno</span>
                      </label>
                    )}
                    {employee.applyHoliday && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.holiday}
                          onChange={(e) => handleDayChange(di.key, { holiday: e.target.checked })}
                          className="w-3.5 h-3.5 rounded accent-amber-500"
                        />
                        <span>Dom/Fest</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Hours & Gross Summary */}
        <div className="rounded-xl bg-[#0A0A0A] border border-[#27272E] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-300">
            <span>Total horas</span>
            <span className="font-mono font-bold text-white tabular-nums">
              {summary.totalHours.toFixed(1)} h
            </span>
          </div>
          <div className="flex items-center justify-between text-sm sm:text-base font-bold text-white">
            <span>Valor bruto</span>
            <span className="font-mono text-amber-400 tabular-nums">
              {formatCopMoney(summary.gross)}
            </span>
          </div>
        </div>

        {/* Deductions */}
        <div className="space-y-3 pt-2 border-t border-[#27272E]">
          <h4 className="font-poster text-lg font-extrabold tracking-wide text-white uppercase">
            Deducciones de esta colilla
          </h4>
          <div className="rounded-xl bg-emerald-950/30 border border-emerald-700/50 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Solo se descuentan las que marques con valor mayor a cero. Si no marcas ninguna, neto =
              bruto.
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_108px] sm:grid-cols-[auto_minmax(0,1fr)_170px] items-center gap-2.5 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
              <input
                id="payroll-ded-salud"
                type="checkbox"
                checked={deductionsForm.saludChecked}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, saludChecked: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-amber-500"
              />
              <label
                htmlFor="payroll-ded-salud"
                className="text-xs sm:text-sm font-medium text-zinc-200 cursor-pointer"
              >
                Aporte salud (trabajador)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="0"
                aria-label="Valor aporte salud"
                value={deductionsForm.saludVal}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, saludVal: e.target.value }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm font-mono text-white text-right focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)_108px] sm:grid-cols-[auto_minmax(0,1fr)_170px] items-center gap-2.5 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
              <input
                id="payroll-ded-pension"
                type="checkbox"
                checked={deductionsForm.pensionChecked}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, pensionChecked: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-amber-500"
              />
              <label
                htmlFor="payroll-ded-pension"
                className="text-xs sm:text-sm font-medium text-zinc-200 cursor-pointer"
              >
                Aporte pensión (trabajador)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="0"
                aria-label="Valor aporte pensión"
                value={deductionsForm.pensionVal}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, pensionVal: e.target.value }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm font-mono text-white text-right focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)_108px] sm:grid-cols-[auto_minmax(0,1fr)_170px] items-center gap-2.5 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
              <input
                id="payroll-ded-retefuente"
                type="checkbox"
                checked={deductionsForm.retefuenteChecked}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, retefuenteChecked: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-amber-500"
              />
              <label
                htmlFor="payroll-ded-retefuente"
                className="text-xs sm:text-sm font-medium text-zinc-200 cursor-pointer"
              >
                Retención en la fuente
              </label>
              <input
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="0"
                aria-label="Valor retención en la fuente"
                value={deductionsForm.retefuenteVal}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, retefuenteVal: e.target.value }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm font-mono text-white text-right focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)_108px] sm:grid-cols-[auto_minmax(0,1fr)_170px] items-center gap-2.5 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
              <input
                type="checkbox"
                aria-label="Activar otra deducción 1"
                checked={deductionsForm.otra1Checked}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra1Checked: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-amber-500"
              />
              <input
                type="text"
                maxLength={80}
                placeholder="Nombre de otra deducción"
                aria-label="Nombre de otra deducción 1"
                value={deductionsForm.otra1Name}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra1Name: e.target.value }))
                }
                className="w-full min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="0"
                aria-label="Valor de otra deducción 1"
                value={deductionsForm.otra1Val}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra1Val: e.target.value }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm font-mono text-white text-right focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)_108px] sm:grid-cols-[auto_minmax(0,1fr)_170px] items-center gap-2.5 bg-[#0A0A0A] border border-[#27272E] rounded-xl px-3 py-2">
              <input
                type="checkbox"
                aria-label="Activar otra deducción 2"
                checked={deductionsForm.otra2Checked}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra2Checked: e.target.checked }))
                }
                className="w-4 h-4 rounded accent-amber-500"
              />
              <input
                type="text"
                maxLength={80}
                placeholder="Nombre de otra deducción"
                aria-label="Nombre de otra deducción 2"
                value={deductionsForm.otra2Name}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra2Name: e.target.value }))
                }
                className="w-full min-h-[36px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                step={100}
                inputMode="numeric"
                placeholder="0"
                aria-label="Valor de otra deducción 2"
                value={deductionsForm.otra2Val}
                onChange={(e) =>
                  setDeductionsForm((prev) => ({ ...prev, otra2Val: e.target.value }))
                }
                className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#27272E] bg-[#141418] text-xs sm:text-sm font-mono text-white text-right focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Neto Summary */}
        <div className="rounded-xl bg-emerald-950/35 border border-emerald-700/60 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-300">
            <span>Total deducciones</span>
            <span className="font-mono font-bold text-red-300 tabular-nums">
              {formatCopMoney(summary.dedTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between text-base sm:text-lg font-extrabold text-white">
            <span>Neto a pagar</span>
            <span className="font-mono text-emerald-400 tabular-nums">
              {formatCopMoney(summary.neto)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveHoursClick()}
            className="min-h-[44px] px-5 rounded-xl border border-[#27272E] bg-[#1C1C22] text-xs sm:text-sm font-bold text-white hover:border-amber-500 inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4 text-amber-400" />
            <span>Guardar horas</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleGenerateStubClick()}
            className="min-h-[44px] px-5 rounded-xl bg-amber-500 text-black text-xs sm:text-sm font-bold hover:bg-amber-400 inline-flex items-center gap-2 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            <span>Generar colilla PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
};
