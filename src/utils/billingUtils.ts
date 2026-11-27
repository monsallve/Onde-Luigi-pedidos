import type { BusinessBillingConfig, Order, OrderItem } from '../types/pos';
import { sanitizePlainText } from './inputSecurity';
import { formatCustomizationSummary } from './orderMath';

export const DEFAULT_CUSTOMER_DOCUMENT = '222222222';
export const DEFAULT_CUSTOMER_NAME = 'Consumidor Final';

export const DEFAULT_BILLING_CONFIG: BusinessBillingConfig = {
  businessName: "O'NDE LUIGI",
  legalName: '',
  nit: '',
  regime: 'No responsable de IVA',
  address: '',
  city: 'Colombia',
  phone: '',
  email: '',
  receiptPrefix: 'COL',
  footerNote:
    'Gracias por su compra. Colilla de venta POS preparada para integración futura con facturación electrónica DIAN.',
};

export function normalizeBillingConfig(
  raw?: Partial<BusinessBillingConfig> | null
): BusinessBillingConfig {
  return {
    businessName:
      sanitizePlainText(raw?.businessName ?? DEFAULT_BILLING_CONFIG.businessName, { maxLen: 120 }) ||
      DEFAULT_BILLING_CONFIG.businessName,
    legalName: sanitizePlainText(raw?.legalName ?? '', { maxLen: 120 }),
    nit: sanitizePlainText(raw?.nit ?? '', { maxLen: 40 }),
    regime:
      sanitizePlainText(raw?.regime ?? DEFAULT_BILLING_CONFIG.regime, { maxLen: 80 }) ||
      DEFAULT_BILLING_CONFIG.regime,
    address: sanitizePlainText(raw?.address ?? '', { maxLen: 160 }),
    city:
      sanitizePlainText(raw?.city ?? DEFAULT_BILLING_CONFIG.city, { maxLen: 80 }) ||
      DEFAULT_BILLING_CONFIG.city,
    phone: sanitizePlainText(raw?.phone ?? '', { maxLen: 40 }),
    email: sanitizePlainText(raw?.email ?? '', { maxLen: 160 }),
    receiptPrefix:
      sanitizePlainText(raw?.receiptPrefix ?? DEFAULT_BILLING_CONFIG.receiptPrefix, { maxLen: 12 })
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 12) || DEFAULT_BILLING_CONFIG.receiptPrefix,
    footerNote:
      sanitizePlainText(raw?.footerNote ?? DEFAULT_BILLING_CONFIG.footerNote, {
        maxLen: 280,
        allowNewlines: true,
      }) || DEFAULT_BILLING_CONFIG.footerNote,
  };
}

export function normalizeCustomerDocument(raw?: string): string {
  const clean = sanitizePlainText(raw || '', { maxLen: 40 });
  return clean || DEFAULT_CUSTOMER_DOCUMENT;
}

export function isDefaultFinalConsumer(docNumber?: string): boolean {
  const normalized = normalizeCustomerDocument(docNumber).replace(/[.\-\s]/g, '');
  return normalized === DEFAULT_CUSTOMER_DOCUMENT || normalized === '222222222222';
}

export function normalizeCustomerName(rawName?: string, rawDoc?: string): string {
  const cleanName = sanitizePlainText(rawName || '', { maxLen: 120 });
  if (cleanName) return cleanName;
  return isDefaultFinalConsumer(rawDoc) ? DEFAULT_CUSTOMER_NAME : 'Cliente';
}

export function buildCustomerDocId(documentNumber: string): string {
  const slug = documentNumber
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!slug) {
    return `cust_${Date.now()}`;
  }
  return `cust_${slug}`.slice(0, 120);
}

export function resolveOrderCustomerInfo(
  order: Pick<Order, 'customerDocument' | 'customerName' | 'customerPhone' | 'customerEmail'>
): {
  documentNumber: string;
  name: string;
  phone: string;
  email: string;
} {
  const documentNumber = normalizeCustomerDocument(order.customerDocument);
  const name = normalizeCustomerName(order.customerName, documentNumber);
  return {
    documentNumber,
    name,
    phone: (order.customerPhone || '').trim(),
    email: (order.customerEmail || '').trim(),
  };
}

export function buildReceiptNumber(
  order: Pick<Order, 'orderNumber'>,
  config: Pick<BusinessBillingConfig, 'receiptPrefix'>
): string {
  const prefix = (config.receiptPrefix || DEFAULT_BILLING_CONFIG.receiptPrefix).trim() || 'COL';
  return `${prefix}-${String(order.orderNumber).padStart(4, '0')}`;
}

export function buildReceiptFilename(
  order: Pick<Order, 'orderNumber'>,
  config: Pick<BusinessBillingConfig, 'receiptPrefix'>
): string {
  return `Colilla_${buildReceiptNumber(order, config)}.pdf`;
}

export function buildReceiptItemLineDetails(item: OrderItem): string {
  return formatCustomizationSummary(item);
}
