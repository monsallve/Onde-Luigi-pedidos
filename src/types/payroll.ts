export type PayrollPaymentMethod = 'efectivo' | 'banco';

export interface PayrollDayEntry {
  hours: number;
  night: boolean;
  holiday: boolean;
  value: number;
}

export interface PayrollDeductionItem {
  name: string;
  amount: number;
}

export interface PayrollDeductionsMap {
  salud?: number;
  pension?: number;
  retefuente?: number;
  otra1?: PayrollDeductionItem;
  otra2?: PayrollDeductionItem;
}

export interface PayrollQuincenaRecord {
  days: Record<string, PayrollDayEntry>;
  totalHours: number;
  gross: number;
  deductions: PayrollDeductionsMap;
  dedTotal: number;
  deductionList: PayrollDeductionItem[];
  neto: number;
  savedAt: string;
}

export interface PayrollEmployee {
  id: string;
  name: string;
  document: string;
  position: string;
  hourlyRate: number;
  paymentMethod: PayrollPaymentMethod;
  bank: string;
  phone: string;
  applyNight: boolean;
  nightPercent: number;
  applyHoliday: boolean;
  holidayPercent: number;
  notes: string;
  hours: Record<string, PayrollQuincenaRecord>;
}

export interface PayrollStubRecord {
  id: string;
  employeeId: string;
  periodKey: string;
  periodLabel: string;
  date: string;
  cutoff?: string;
  pay?: string;
  cutoffDay?: number;
  payDay?: number;
  total: number;
  totalHours: number;
  gross: number;
  days: Record<string, PayrollDayEntry>;
  deductions: PayrollDeductionItem[];
  dedTotal: number;
}

export interface PayrollCompany {
  id: string;
  name: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  rep: string;
  legal: string;
  logo: string;
  employees: PayrollEmployee[];
  stubs: PayrollStubRecord[];
  ownerUid: string;
  createdByUid: string;
  allowedEmails: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface PayrollCompanyInput {
  id?: string;
  name: string;
  nit: string;
  address: string;
  phone: string;
  email: string;
  rep: string;
  legal: string;
  logo: string;
}

export interface PayrollEmployeeInput {
  id?: string;
  name: string;
  document: string;
  position: string;
  hourlyRate: number;
  paymentMethod: PayrollPaymentMethod;
  bank: string;
  phone: string;
  applyNight: boolean;
  nightPercent: number;
  applyHoliday: boolean;
  holidayPercent: number;
  notes: string;
}

export interface QuincenaDayInfo {
  key: string;
  day: number;
  month: number;
  year: number;
  label: string;
  dow: number;
}

export interface CutoffPayInfo {
  cutoff: string;
  pay: string;
  cutoffDay: number;
  payDay: number;
}
