import type {
  CutoffPayInfo,
  PayrollCompany,
  PayrollDayEntry,
  PayrollDeductionItem,
  PayrollDeductionsMap,
  PayrollEmployee,
  PayrollQuincenaRecord,
  PayrollStubRecord,
  QuincenaDayInfo,
} from '../types/payroll';
import {
  containsDangerousCodePattern,
  safeJsonParse,
  sanitizePlainText,
  sanitizeSafeUrl,
  sanitizeStringList,
} from './inputSecurity';
import { createSafeId } from './orderMath';

export const PAYROLL_DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export const PAYROLL_MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function formatCopMoney(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function getPayrollInitials(name: string): string {
  const clean = sanitizePlainText(name, { maxLen: 120 });
  if (!clean) return '?';
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || '?';
}

export function sanitizePayrollDocId(raw: unknown, prefix = 'pay'): string {
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (SAFE_ID_RE.test(str)) return str;
  const normalized = str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  if (SAFE_ID_RE.test(normalized)) return normalized;
  return createSafeId(prefix);
}

export function getQuincenaKey(
  year: number | string,
  month: number | string,
  half: '1' | '2' | string
): string {
  const y = Math.max(1970, Math.min(2100, Math.trunc(Number(year) || new Date().getFullYear())));
  const m = Math.max(1, Math.min(12, Math.trunc(Number(month) || 1)));
  const h = String(half) === '2' ? '2' : '1';
  return `${y}-${String(m).padStart(2, '0')}-${h}`;
}

/**
 * Mes seleccionado = mes del corte y del pago.
 * 1ª: 29 (mes ant.) -> 13 (mes actual) · corte 13 · pago 14
 * 2ª: 14 -> 28 (mes actual) · corte 28 · pago 29
 */
export function getDaysInQuincena(
  year: number,
  month: number,
  half: '1' | '2'
): QuincenaDayInfo[] {
  const y = Math.trunc(Number(year));
  const m = Math.trunc(Number(month));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return [];

  const pad = (n: number) => String(n).padStart(2, '0');
  const make = (yy: number, mm: number, dd: number): QuincenaDayInfo | null => {
    const date = new Date(yy, mm - 1, dd);
    if (date.getFullYear() !== yy || date.getMonth() !== mm - 1 || date.getDate() !== dd) {
      return null;
    }
    return {
      key: `${yy}-${pad(mm)}-${pad(dd)}`,
      day: dd,
      month: mm,
      year: yy,
      label: `${pad(dd)}/${pad(mm)}`,
      dow: date.getDay(),
    };
  };

  const out: QuincenaDayInfo[] = [];
  if (half === '1') {
    let py = y;
    let pm = m - 1;
    if (pm < 1) {
      pm = 12;
      py = y - 1;
    }
    const lastPrev = new Date(py, pm, 0).getDate();
    for (let d = 29; d <= lastPrev; d++) {
      const row = make(py, pm, d);
      if (row) out.push(row);
    }
    for (let d = 1; d <= 13; d++) {
      const row = make(y, m, d);
      if (row) out.push(row);
    }
  } else {
    for (let d = 14; d <= 28; d++) {
      const row = make(y, m, d);
      if (row) out.push(row);
    }
  }
  return out;
}

export function getPeriodLabel(year: number, month: number, half: '1' | '2'): string {
  const y = Math.trunc(Number(year));
  const m = Math.max(1, Math.min(12, Math.trunc(Number(month) || 1)));
  if (half === '1') {
    let pm = m - 1;
    let py = y;
    if (pm < 1) {
      pm = 12;
      py = y - 1;
    }
    return `29 ${PAYROLL_MONTHS[pm - 1]} ${py} → 13 ${PAYROLL_MONTHS[m - 1]} ${y} (pago 14)`;
  }
  return `14 → 28 ${PAYROLL_MONTHS[m - 1]} ${y} (pago 29)`;
}

export function getCutoffAndPayDates(
  year: number | string,
  month: number | string,
  half: '1' | '2' | string
): CutoffPayInfo {
  const y = Math.trunc(Number(year));
  const m = Math.max(1, Math.min(12, Math.trunc(Number(month) || 1)));
  const h = String(half) === '2' ? '2' : '1';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h === '1') {
    return {
      cutoff: `${pad(13)}/${pad(m)}/${y}`,
      pay: `${pad(14)}/${pad(m)}/${y}`,
      cutoffDay: 13,
      payDay: 14,
    };
  }
  return {
    cutoff: `${pad(28)}/${pad(m)}/${y}`,
    pay: `${pad(29)}/${pad(m)}/${y}`,
    cutoffDay: 28,
    payDay: 29,
  };
}

export function lookupDayEntry(
  daysData: Record<string, PayrollDayEntry | number> | undefined,
  dayInfo: QuincenaDayInfo | undefined
): Partial<PayrollDayEntry> | number | null {
  if (!daysData || !dayInfo) return null;
  if (daysData[dayInfo.key] != null) return daysData[dayInfo.key];
  if (daysData[String(dayInfo.day)] != null) return daysData[String(dayInfo.day)];
  return null;
}

export function calcDayValue(
  hours: number,
  isNight: boolean,
  isHoliday: boolean,
  emp: Pick<PayrollEmployee, 'hourlyRate' | 'applyNight' | 'nightPercent' | 'applyHoliday' | 'holidayPercent'>
): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  let rate = Number(emp.hourlyRate) || 0;
  if (rate <= 0) return 0;
  if (emp.applyNight && isNight) {
    const pct = Number.isFinite(emp.nightPercent) && emp.nightPercent >= 0 ? emp.nightPercent : 35;
    rate *= 1 + pct / 100;
  }
  if (emp.applyHoliday && isHoliday) {
    const pct = Number.isFinite(emp.holidayPercent) && emp.holidayPercent >= 0 ? emp.holidayPercent : 75;
    rate *= 1 + pct / 100;
  }
  return hours * rate;
}

export interface DayGridFormRow {
  key: string;
  hoursStr: string;
  night: boolean;
  holiday: boolean;
}

export interface DeductionsFormState {
  saludChecked: boolean;
  saludVal: string;
  pensionChecked: boolean;
  pensionVal: string;
  retefuenteChecked: boolean;
  retefuenteVal: string;
  otra1Checked: boolean;
  otra1Name: string;
  otra1Val: string;
  otra2Checked: boolean;
  otra2Name: string;
  otra2Val: string;
}

export const EMPTY_DEDUCTIONS_FORM: DeductionsFormState = {
  saludChecked: false,
  saludVal: '',
  pensionChecked: false,
  pensionVal: '',
  retefuenteChecked: false,
  retefuenteVal: '',
  otra1Checked: false,
  otra1Name: '',
  otra1Val: '',
  otra2Checked: false,
  otra2Name: '',
  otra2Val: '',
};

export function createInitialDayRows(
  days: QuincenaDayInfo[],
  saved?: PayrollQuincenaRecord | null
): Record<string, DayGridFormRow> {
  const daysData = saved?.days || {};
  const result: Record<string, DayGridFormRow> = {};

  for (const di of days) {
    const dd = lookupDayEntry(daysData, di);
    const hoursVal =
      typeof dd === 'object' && dd != null && dd.hours != null
        ? String(dd.hours)
        : typeof dd === 'number'
          ? String(dd)
          : '';
    const nightVal = typeof dd === 'object' && dd != null ? Boolean(dd.night) : false;
    const holVal =
      typeof dd === 'object' && dd != null
        ? dd.holiday != null
          ? Boolean(dd.holiday)
          : di.dow === 0
        : di.dow === 0;

    result[di.key] = {
      key: di.key,
      hoursStr: hoursVal,
      night: nightVal,
      holiday: holVal,
    };
  }
  return result;
}

export function createInitialDeductionsForm(
  saved?: PayrollQuincenaRecord | null
): DeductionsFormState {
  const dd = saved?.deductions;
  if (!dd) return { ...EMPTY_DEDUCTIONS_FORM };

  return {
    saludChecked: Number(dd.salud) > 0,
    saludVal: Number(dd.salud) > 0 ? String(dd.salud) : '',
    pensionChecked: Number(dd.pension) > 0,
    pensionVal: Number(dd.pension) > 0 ? String(dd.pension) : '',
    retefuenteChecked: Number(dd.retefuente) > 0,
    retefuenteVal: Number(dd.retefuente) > 0 ? String(dd.retefuente) : '',
    otra1Checked: Boolean(dd.otra1 && Number(dd.otra1.amount) > 0),
    otra1Name: dd.otra1?.name ? sanitizePlainText(dd.otra1.name, { maxLen: 80 }) : '',
    otra1Val: dd.otra1 && Number(dd.otra1.amount) > 0 ? String(dd.otra1.amount) : '',
    otra2Checked: Boolean(dd.otra2 && Number(dd.otra2.amount) > 0),
    otra2Name: dd.otra2?.name ? sanitizePlainText(dd.otra2.name, { maxLen: 80 }) : '',
    otra2Val: dd.otra2 && Number(dd.otra2.amount) > 0 ? String(dd.otra2.amount) : '',
  };
}

export function calculateQuincenaSummary(params: {
  employee: PayrollEmployee;
  dayRows: Record<string, DayGridFormRow>;
  deductionsForm: DeductionsFormState;
}): Omit<PayrollQuincenaRecord, 'savedAt'> {
  const { employee, dayRows, deductionsForm } = params;
  const days: Record<string, PayrollDayEntry> = {};
  let totalHours = 0;
  let gross = 0;

  for (const [key, row] of Object.entries(dayRows)) {
    let hours = parseFloat(row.hoursStr);
    if (!Number.isFinite(hours) || hours < 0) hours = 0;
    if (hours > 24) hours = 24;

    const isNight = Boolean(row.night);
    const isHoliday = Boolean(row.holiday);
    if (hours <= 0 && !isNight && !isHoliday) continue;

    const value = calcDayValue(hours, isNight, isHoliday, employee);
    days[key] = {
      hours,
      night: isNight,
      holiday: isHoliday,
      value,
    };
    totalHours += hours;
    gross += value;
  }

  const deductionList: PayrollDeductionItem[] = [];
  let dedTotal = 0;
  const deductions: PayrollDeductionsMap = {};

  const parseAmount = (raw: string): number => {
    const num = parseFloat(raw);
    return Number.isFinite(num) && num > 0 ? Math.min(100000000, num) : 0;
  };

  if (deductionsForm.saludChecked) {
    const amount = parseAmount(deductionsForm.saludVal);
    deductions.salud = amount;
    if (amount > 0) {
      deductionList.push({ name: 'Aporte salud (trabajador)', amount });
      dedTotal += amount;
    }
  }
  if (deductionsForm.pensionChecked) {
    const amount = parseAmount(deductionsForm.pensionVal);
    deductions.pension = amount;
    if (amount > 0) {
      deductionList.push({ name: 'Aporte pensión (trabajador)', amount });
      dedTotal += amount;
    }
  }
  if (deductionsForm.retefuenteChecked) {
    const amount = parseAmount(deductionsForm.retefuenteVal);
    deductions.retefuente = amount;
    if (amount > 0) {
      deductionList.push({ name: 'Retención en la fuente', amount });
      dedTotal += amount;
    }
  }
  if (deductionsForm.otra1Checked) {
    const name = sanitizePlainText(deductionsForm.otra1Name, { maxLen: 80 }) || 'Otra deducción';
    const amount = parseAmount(deductionsForm.otra1Val);
    deductions.otra1 = { name, amount };
    if (amount > 0) {
      deductionList.push({ name, amount });
      dedTotal += amount;
    }
  }
  if (deductionsForm.otra2Checked) {
    const name = sanitizePlainText(deductionsForm.otra2Name, { maxLen: 80 }) || 'Otra deducción';
    const amount = parseAmount(deductionsForm.otra2Val);
    deductions.otra2 = { name, amount };
    if (amount > 0) {
      deductionList.push({ name, amount });
      dedTotal += amount;
    }
  }

  const neto = Math.max(0, gross - dedTotal);
  return {
    days,
    totalHours,
    gross,
    deductions,
    dedTotal,
    deductionList,
    neto,
  };
}

function sanitizeDayEntriesMap(raw: unknown): Record<string, PayrollDayEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PayrollDayEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = sanitizePlainText(k, { maxLen: 24 });
    if (!cleanKey) continue;
    if (typeof v === 'number') {
      const h = Math.max(0, Math.min(24, Number(v) || 0));
      out[cleanKey] = { hours: h, night: false, holiday: false, value: 0 };
    } else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const hours = Math.max(0, Math.min(24, Number(obj.hours) || 0));
      out[cleanKey] = {
        hours,
        night: Boolean(obj.night),
        holiday: Boolean(obj.holiday),
        value: Math.max(0, Number(obj.value) || 0),
      };
    }
  }
  return out;
}

function sanitizeDeductionList(raw: unknown): PayrollDeductionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PayrollDeductionItem[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = sanitizePlainText(obj.name, { maxLen: 80 });
    const amount = Math.max(0, Number(obj.amount) || 0);
    if (name && amount > 0) out.push({ name, amount });
  }
  return out;
}

function sanitizeHoursMap(raw: unknown): Record<string, PayrollQuincenaRecord> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PayrollQuincenaRecord> = {};
  for (const [periodKey, val] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = sanitizePlainText(periodKey, { maxLen: 20 });
    if (!cleanKey || !val || typeof val !== 'object') continue;
    const rec = val as Record<string, unknown>;
    const rawDed = (rec.deductions && typeof rec.deductions === 'object'
      ? rec.deductions
      : {}) as Record<string, unknown>;
    const deductions: PayrollDeductionsMap = {};
    if (Number(rawDed.salud) > 0) deductions.salud = Math.max(0, Number(rawDed.salud));
    if (Number(rawDed.pension) > 0) deductions.pension = Math.max(0, Number(rawDed.pension));
    if (Number(rawDed.retefuente) > 0) deductions.retefuente = Math.max(0, Number(rawDed.retefuente));
    if (rawDed.otra1 && typeof rawDed.otra1 === 'object') {
      const o1 = rawDed.otra1 as Record<string, unknown>;
      deductions.otra1 = {
        name: sanitizePlainText(o1.name, { maxLen: 80 }) || 'Otra deducción',
        amount: Math.max(0, Number(o1.amount) || 0),
      };
    }
    if (rawDed.otra2 && typeof rawDed.otra2 === 'object') {
      const o2 = rawDed.otra2 as Record<string, unknown>;
      deductions.otra2 = {
        name: sanitizePlainText(o2.name, { maxLen: 80 }) || 'Otra deducción',
        amount: Math.max(0, Number(o2.amount) || 0),
      };
    }

    const gross = Math.max(0, Number(rec.gross) || 0);
    const dedTotal = Math.max(0, Number(rec.dedTotal) || 0);
    out[cleanKey] = {
      days: sanitizeDayEntriesMap(rec.days),
      totalHours: Math.max(0, Number(rec.totalHours) || 0),
      gross,
      deductions,
      dedTotal,
      deductionList: sanitizeDeductionList(rec.deductionList),
      neto:
        rec.neto != null && Number.isFinite(Number(rec.neto))
          ? Math.max(0, Number(rec.neto))
          : Math.max(0, gross - dedTotal),
      savedAt: sanitizePlainText(rec.savedAt, { maxLen: 40 }),
    };
  }
  return out;
}

export function normalizePayrollCompanyRecord(
  raw: Record<string, unknown>,
  ownership: {
    ownerUid: string;
    createdByUid: string;
    allowedEmails: string[];
    nowMs?: number;
  }
): PayrollCompany {
  const now = ownership.nowMs ?? Date.now();
  const rawEmployees = Array.isArray(raw.employees) ? raw.employees : [];
  const employees: PayrollEmployee[] = rawEmployees
    .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
    .slice(0, 120)
    .map((e) => ({
      id: sanitizePayrollDocId(e.id, 'emp'),
      name: sanitizePlainText(e.name, { maxLen: 120 }) || 'Sin nombre',
      document: sanitizePlainText(e.document, { maxLen: 40 }),
      position: sanitizePlainText(e.position, { maxLen: 80 }),
      hourlyRate: Math.max(0, Number(e.hourlyRate) || 0),
      paymentMethod: e.paymentMethod === 'banco' ? 'banco' : 'efectivo',
      bank: sanitizePlainText(e.bank, { maxLen: 120 }),
      phone: sanitizePlainText(e.phone, { maxLen: 40 }),
      applyNight: Boolean(e.applyNight),
      nightPercent:
        e.nightPercent != null && Number(e.nightPercent) >= 0 ? Number(e.nightPercent) : 35,
      applyHoliday: Boolean(e.applyHoliday),
      holidayPercent:
        e.holidayPercent != null && Number(e.holidayPercent) >= 0 ? Number(e.holidayPercent) : 75,
      notes: sanitizePlainText(e.notes, { maxLen: 400, allowNewlines: true }),
      hours: sanitizeHoursMap(e.hours),
    }));

  const rawStubs = Array.isArray(raw.stubs) ? raw.stubs : [];
  const stubs: PayrollStubRecord[] = rawStubs
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .slice(0, 300)
    .map((s) => ({
      id: sanitizePayrollDocId(s.id, 'stub'),
      employeeId: sanitizePayrollDocId(s.employeeId, 'emp'),
      periodKey: sanitizePlainText(s.periodKey, { maxLen: 20 }),
      periodLabel: sanitizePlainText(s.periodLabel, { maxLen: 100 }),
      date: sanitizePlainText(s.date, { maxLen: 24 }),
      ...(s.cutoff ? { cutoff: sanitizePlainText(s.cutoff, { maxLen: 20 }) } : {}),
      ...(s.pay ? { pay: sanitizePlainText(s.pay, { maxLen: 20 }) } : {}),
      ...(s.cutoffDay != null ? { cutoffDay: Number(s.cutoffDay) || 13 } : {}),
      ...(s.payDay != null ? { payDay: Number(s.payDay) || 14 } : {}),
      total: Math.max(0, Number(s.total) || 0),
      totalHours: Math.max(0, Number(s.totalHours) || 0),
      gross: Math.max(0, Number(s.gross) || 0),
      days: sanitizeDayEntriesMap(s.days),
      deductions: sanitizeDeductionList(s.deductions),
      dedTotal: Math.max(0, Number(s.dedTotal) || 0),
    }));

  const logoUrl = sanitizeSafeUrl(raw.logo, {
    allowDataImage: true,
    allowRelative: false,
    maxLen: 250000,
  });

  return {
    id: sanitizePayrollDocId(raw.id, 'pcomp'),
    name: sanitizePlainText(raw.name, { maxLen: 140 }) || 'Sin nombre',
    nit: sanitizePlainText(raw.nit, { maxLen: 40 }),
    address: sanitizePlainText(raw.address, { maxLen: 160 }),
    phone: sanitizePlainText(raw.phone, { maxLen: 40 }),
    email: sanitizePlainText(raw.email, { maxLen: 160 }),
    rep: sanitizePlainText(raw.rep, { maxLen: 120 }),
    legal: sanitizePlainText(raw.legal, { maxLen: 400, allowNewlines: true }),
    logo: logoUrl,
    employees,
    stubs,
    ownerUid: sanitizePlainText(raw.ownerUid || ownership.ownerUid, { maxLen: 128 }),
    createdByUid: sanitizePlainText(raw.createdByUid || ownership.createdByUid, { maxLen: 128 }),
    allowedEmails: sanitizeStringList(
      Array.isArray(raw.allowedEmails) && raw.allowedEmails.length > 0
        ? raw.allowedEmails
        : ownership.allowedEmails,
      25,
      160
    ).map((e) => e.toLowerCase()),
    createdAtMs: Number(raw.createdAtMs) || now,
    updatedAtMs: Number(raw.updatedAtMs) || now,
  };
}

export function parseAndNormalizePayrollImport(
  jsonText: string,
  ownership: {
    ownerUid: string;
    createdByUid: string;
    allowedEmails: string[];
  }
): PayrollCompany[] {
  if (containsDangerousCodePattern(jsonText)) {
    throw new Error(
      'Por seguridad, el archivo importado contiene código o etiquetas HTML no permitidas.'
    );
  }
  const parsed = safeJsonParse<{ companies?: unknown } | null>(jsonText, null);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.companies)) {
    throw new Error('Archivo inválido: debe contener una lista "companies" en formato JSON válido.');
  }

  return parsed.companies
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .slice(0, 40)
    .map((c) => normalizePayrollCompanyRecord(c, ownership));
}

export function serializePayrollExportJson(companies: PayrollCompany[]): string {
  const cleanCompanies = companies.map((c) => ({
    id: c.id,
    name: c.name,
    nit: c.nit,
    address: c.address,
    phone: c.phone,
    email: c.email,
    rep: c.rep,
    legal: c.legal,
    logo: c.logo || null,
    employees: c.employees,
    stubs: c.stubs,
  }));
  return JSON.stringify({ companies: cleanCompanies }, null, 2);
}

export function sanitizeExportFilename(rawName: string): string {
  const fallback = `nomina_${new Date().toISOString().slice(0, 10)}`;
  let name = sanitizePlainText(rawName, { maxLen: 100 }) || fallback;
  name = name.replace(/[\\/:*?"<>|]/g, '_');
  if (!name.toLowerCase().endsWith('.json')) name += '.json';
  return name;
}
