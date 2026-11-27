import test from 'node:test';
import assert from 'node:assert/strict';
import type { PayrollEmployee } from '../types/payroll';
import {
  calcDayValue,
  calculateQuincenaSummary,
  createInitialDayRows,
  createInitialDeductionsForm,
  getCutoffAndPayDates,
  getDaysInQuincena,
  getPeriodLabel,
  getQuincenaKey,
  parseAndNormalizePayrollImport,
  serializePayrollExportJson,
} from './payrollMath';

const baseEmployee: PayrollEmployee = {
  id: 'emp_1',
  name: 'Ana Gómez',
  document: '10101010',
  position: 'Auxiliar de cocina',
  hourlyRate: 10000,
  paymentMethod: 'efectivo',
  bank: '',
  phone: '3001234567',
  applyNight: false,
  nightPercent: 35,
  applyHoliday: false,
  holidayPercent: 75,
  notes: '',
  hours: {},
};

test('getDaysInQuincena matches 29->13 (1st half) and 14->28 (2nd half) rules across year and leap boundaries', () => {
  // January 1st half wraps back to December 29-31 of previous year + Jan 1-13
  const jan1st = getDaysInQuincena(2026, 1, '1');
  assert.equal(jan1st[0]?.key, '2025-12-29');
  assert.equal(jan1st[2]?.key, '2025-12-31');
  assert.equal(jan1st[3]?.key, '2026-01-01');
  assert.equal(jan1st[jan1st.length - 1]?.key, '2026-01-13');
  assert.equal(jan1st.length, 16);

  // March 1st half on leap year 2024 includes Feb 29
  const marLeap = getDaysInQuincena(2024, 3, '1');
  assert.equal(marLeap[0]?.key, '2024-02-29');
  assert.equal(marLeap.length, 14);

  // March 1st half on non-leap year 2026 starts on Mar 1
  const marNonLeap = getDaysInQuincena(2026, 3, '1');
  assert.equal(marNonLeap[0]?.key, '2026-03-01');
  assert.equal(marNonLeap.length, 13);

  // 2nd half always covers 14..28 (15 days)
  const secondHalf = getDaysInQuincena(2026, 11, '2');
  assert.equal(secondHalf[0]?.key, '2026-11-14');
  assert.equal(secondHalf[secondHalf.length - 1]?.key, '2026-11-28');
  assert.equal(secondHalf.length, 15);
});

test('getPeriodLabel, getQuincenaKey and getCutoffAndPayDates match upstream formatting', () => {
  assert.equal(getQuincenaKey(2026, 1, '1'), '2026-01-1');
  assert.equal(getPeriodLabel(2026, 1, '1'), '29 Diciembre 2025 → 13 Enero 2026 (pago 14)');
  assert.equal(getPeriodLabel(2026, 11, '2'), '14 → 28 Noviembre 2026 (pago 29)');
  assert.deepEqual(getCutoffAndPayDates(2026, 11, '1'), {
    cutoff: '13/11/2026',
    pay: '14/11/2026',
    cutoffDay: 13,
    payDay: 14,
  });
  assert.deepEqual(getCutoffAndPayDates(2026, 11, '2'), {
    cutoff: '28/11/2026',
    pay: '29/11/2026',
    cutoffDay: 28,
    payDay: 29,
  });
});

test('calcDayValue pays base rate unless employee explicitly enables night/holiday surcharges', () => {
  // Without surcharges enabled, night/holiday flags still pay base rate
  assert.equal(calcDayValue(8, true, true, baseEmployee), 80000);

  const withSurcharges: PayrollEmployee = {
    ...baseEmployee,
    applyNight: true,
    nightPercent: 35,
    applyHoliday: true,
    holidayPercent: 75,
  };
  assert.equal(calcDayValue(8, false, false, withSurcharges), 80000);
  assert.equal(calcDayValue(8, true, false, withSurcharges), 8 * 10000 * 1.35);
  assert.equal(calcDayValue(8, false, true, withSurcharges), 8 * 10000 * 1.75);
  assert.equal(calcDayValue(8, true, true, withSurcharges), 8 * 10000 * 1.35 * 1.75);
});

test('calculateQuincenaSummary only deducts checked items > 0 and floors neto at 0', () => {
  const days = getDaysInQuincena(2026, 11, '2');
  const rows = createInitialDayRows(days, null);
  // Sunday defaults holiday to true automatically
  const sundayRow = days.find((d) => d.dow === 0);
  assert.ok(sundayRow);
  assert.equal(rows[sundayRow.key].holiday, true);

  rows['2026-11-14'].hoursStr = '10';
  const empWithHol: PayrollEmployee = { ...baseEmployee, applyHoliday: true, holidayPercent: 75 };

  const form = createInitialDeductionsForm(null);
  form.saludChecked = true;
  form.saludVal = '20000';
  form.pensionChecked = false;
  form.pensionVal = '50000'; // unchecked -> must NOT deduct
  form.otra1Checked = true;
  form.otra1Name = 'Préstamo';
  form.otra1Val = '15000';

  const summary = calculateQuincenaSummary({
    employee: empWithHol,
    dayRows: rows,
    deductionsForm: form,
  });

  assert.equal(summary.totalHours, 10);
  assert.equal(summary.gross, 100000);
  assert.equal(summary.dedTotal, 35000);
  assert.equal(summary.deductionList.length, 2);
  assert.equal(summary.neto, 65000);

  // Deductions exceeding gross clamp neto at 0
  form.otra2Checked = true;
  form.otra2Name = 'Embargo';
  form.otra2Val = '500000';
  const clamped = calculateQuincenaSummary({
    employee: empWithHol,
    dayRows: rows,
    deductionsForm: form,
  });
  assert.equal(clamped.neto, 0);
});

test('parseAndNormalizePayrollImport blocks XSS/script injection and preserves valid data', () => {
  assert.throws(() =>
    parseAndNormalizePayrollImport(
      JSON.stringify({ companies: [{ name: '<script>alert(1)</script>', nit: '900' }] }),
      { ownerUid: 'u1', createdByUid: 'u1', allowedEmails: ['admin@ondeluigi.com'] }
    )
  );

  const normalized = parseAndNormalizePayrollImport(
    JSON.stringify({
      companies: [
        {
          id: 'comp_1',
          name: 'O NDE LUIGI SAS',
          nit: '900123456-7',
          employees: [
            {
              id: 'emp_1',
              name: 'Carlos Ruiz',
              document: '79123456',
              hourlyRate: 12000,
              paymentMethod: 'banco',
              bank: 'Bancolombia 123',
              applyNight: true,
              nightPercent: 35,
            },
          ],
          stubs: [],
        },
      ],
    }),
    { ownerUid: 'u1', createdByUid: 'u1', allowedEmails: ['admin@ondeluigi.com'] }
  );

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].employees[0].paymentMethod, 'banco');
  const exported = JSON.parse(serializePayrollExportJson(normalized));
  assert.equal(exported.companies[0].ownerUid, undefined);
  assert.equal(exported.companies[0].name, 'O NDE LUIGI SAS');
});
