import type {
  DeliveryType,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PublicQueueTicket,
  SelfServicePaymentConfig,
} from '../types/pos';
import {
  containsDangerousCodePattern,
  sanitizePlainText,
  sanitizeSafeUrl,
} from './inputSecurity';

export const DEFAULT_SELF_SERVICE_CONFIG: SelfServicePaymentConfig = {
  enabled: true,
  qrImageUrl: '',
  brebKey: '@ONDELUIGI',
  accountHolder: "O'NDE LUIGI",
  bankName: 'Bre-B / Nequi / Bancolombia',
  paymentInstructions:
    'Escanea el QR o transfiere usando la llave Bre-B y sube la captura de tu comprobante para enviar el pedido a cocina.',
  deliveryInstructions:
    'Domicilios en cobertura urbana. Recogida sin fila en barra presentando tu número de pedido.',
};

export function normalizeSelfServiceConfig(
  raw?: Partial<SelfServicePaymentConfig> | null
): SelfServicePaymentConfig {
  return {
    enabled: raw?.enabled !== undefined ? Boolean(raw.enabled) : DEFAULT_SELF_SERVICE_CONFIG.enabled,
    qrImageUrl: sanitizeSafeUrl(raw?.qrImageUrl, {
      allowDataImage: true,
      allowRelative: true,
      maxLen: 250000,
    }),
    brebKey:
      sanitizePlainText(raw?.brebKey ?? DEFAULT_SELF_SERVICE_CONFIG.brebKey, { maxLen: 100 }) ||
      DEFAULT_SELF_SERVICE_CONFIG.brebKey,
    accountHolder:
      sanitizePlainText(raw?.accountHolder ?? DEFAULT_SELF_SERVICE_CONFIG.accountHolder, {
        maxLen: 120,
      }) || DEFAULT_SELF_SERVICE_CONFIG.accountHolder,
    bankName:
      sanitizePlainText(raw?.bankName ?? DEFAULT_SELF_SERVICE_CONFIG.bankName, { maxLen: 120 }) ||
      DEFAULT_SELF_SERVICE_CONFIG.bankName,
    paymentInstructions: sanitizePlainText(
      raw?.paymentInstructions ?? DEFAULT_SELF_SERVICE_CONFIG.paymentInstructions,
      { maxLen: 400, allowNewlines: true }
    ),
    deliveryInstructions: sanitizePlainText(
      raw?.deliveryInstructions ?? DEFAULT_SELF_SERVICE_CONFIG.deliveryInstructions,
      { maxLen: 400, allowNewlines: true }
    ),
  };
}

export interface SelfServiceCheckoutDraft {
  deliveryType: DeliveryType | '';
  customerName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  deliveryNotes?: string;
  paymentMethod?: PaymentMethod;
  hasReceiptFile: boolean;
  items: OrderItem[];
}

export interface CheckoutValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  firstError: string | null;
}

export function validateSelfServiceCheckout(
  draft: SelfServiceCheckoutDraft
): CheckoutValidationResult {
  const errors: Record<string, string> = {};

  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    errors.items = 'Agrega al menos un producto a tu pedido.';
  }

  if (draft.deliveryType !== 'local' && draft.deliveryType !== 'domicilio') {
    errors.deliveryType = 'Debes elegir si recoges en local o deseas domicilio.';
  }

  const cleanName = sanitizePlainText(draft.customerName, { maxLen: 80 });
  if (containsDangerousCodePattern(draft.customerName)) {
    errors.customerName = 'El nombre contiene caracteres o código no permitido.';
  } else if (cleanName.length < 2) {
    errors.customerName = 'Ingresa tu nombre completo (mínimo 2 caracteres).';
  }

  const cleanPhone = draft.deliveryPhone.trim();
  if (containsDangerousCodePattern(draft.deliveryPhone)) {
    errors.deliveryPhone = 'El teléfono contiene caracteres no permitidos.';
  } else if (draft.deliveryType === 'domicilio') {
    const digits = cleanPhone.replace(/\D/g, '');
    if (digits.length < 7) {
      errors.deliveryPhone = 'Ingresa un teléfono o WhatsApp válido para el domicilio.';
    }
    if (containsDangerousCodePattern(draft.deliveryAddress)) {
      errors.deliveryAddress = 'La dirección contiene caracteres o código no permitido.';
    } else if (sanitizePlainText(draft.deliveryAddress, { maxLen: 220 }).length < 5) {
      errors.deliveryAddress = 'Ingresa la dirección exacta de entrega.';
    }
    if (containsDangerousCodePattern(draft.deliveryNeighborhood)) {
      errors.deliveryNeighborhood = 'El barrio contiene caracteres o código no permitido.';
    } else if (sanitizePlainText(draft.deliveryNeighborhood, { maxLen: 100 }).length < 2) {
      errors.deliveryNeighborhood = 'Ingresa el barrio o sector de entrega.';
    }
  } else if (cleanPhone.length > 0 && cleanPhone.replace(/\D/g, '').length < 7) {
    errors.deliveryPhone = 'Si ingresas teléfono, debe tener al menos 7 dígitos.';
  }

  if (draft.deliveryNotes && containsDangerousCodePattern(draft.deliveryNotes)) {
    errors.deliveryNotes = 'Las indicaciones contienen caracteres o código no permitido.';
  }

  if (draft.paymentMethod && draft.paymentMethod !== 'transferencia') {
    errors.paymentMethod = 'El autoservicio solo acepta pago digital por transferencia o QR.';
  }

  if (!draft.hasReceiptFile) {
    errors.receipt = 'Debes adjuntar la captura o foto del comprobante de pago antes de confirmar.';
  }

  const keys = Object.keys(errors);
  return {
    valid: keys.length === 0,
    errors,
    firstError: keys.length > 0 ? errors[keys[0]] : null,
  };
}

export function formatSelfServiceOrderReference(
  orderNumber: number,
  deliveryType: DeliveryType,
  customerName: string
): string {
  const prefix = deliveryType === 'domicilio' ? 'Domicilio' : 'Recoger';
  const cleanName = customerName.trim().replace(/\s+/g, ' ').slice(0, 32) || 'Cliente';
  return `${prefix} · ${cleanName} (#${orderNumber})`.slice(0, 100);
}

const ACTIVE_QUEUE_STATUSES = new Set<OrderStatus>([
  'pendiente_validacion',
  'tomado',
  'preparacion',
]);

export function computeOrdersAheadCount(
  tickets: Pick<PublicQueueTicket, 'id' | 'status' | 'createdAtMs' | 'orderNumber'>[],
  myTicketId: string
): number {
  const mine = tickets.find((t) => t.id === myTicketId);
  if (!mine) return 0;
  if (mine.status === 'listo' || mine.status === 'entregado' || mine.status === 'cancelado') {
    return 0;
  }
  return tickets.filter((t) => {
    if (t.id === mine.id) return false;
    if (!ACTIVE_QUEUE_STATUSES.has(t.status)) return false;
    if (t.createdAtMs !== mine.createdAtMs) {
      return t.createdAtMs < mine.createdAtMs;
    }
    return t.orderNumber < mine.orderNumber;
  }).length;
}

export function resolveNextSelfServiceOrderNumber(
  tickets: Pick<PublicQueueTicket, 'orderNumber'>[]
): number {
  const maxExisting = tickets.reduce(
    (max, t) => (Number.isFinite(t.orderNumber) ? Math.max(max, Math.floor(t.orderNumber)) : max),
    500
  );
  return maxExisting + 1;
}

export function createSelfOrderId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `self_${Date.now()}_${hex}`;
}

export function getSelfServiceStepIndex(status: OrderStatus): number {
  switch (status) {
    case 'pendiente_validacion':
      return 0;
    case 'tomado':
      return 1;
    case 'preparacion':
      return 2;
    case 'listo':
      return 3;
    case 'entregado':
      return 4;
    case 'cancelado':
      return -1;
  }
}

/**
 * Generates a clean 21x21 QR-style matrix with standard 7x7 finder patterns
 * and deterministic hash-derived payload cells when no uploaded QR image is provided.
 */
export function buildDeterministicQrMatrix(payload: string): boolean[][] {
  const size = 21;
  const grid: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = isBorder || isCenter;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  let seed = 2166136261;
  const clean = payload || 'ONDELUIGI';
  for (let i = 0; i < clean.length; i += 1) {
    seed ^= clean.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }

  const isReserved = (r: number, c: number) => {
    if (r < 8 && c < 8) return true;
    if (r < 8 && c >= size - 8) return true;
    if (r >= size - 8 && c < 8) return true;
    if (r === 6 || c === 6) return true;
    return false;
  };

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (isReserved(r, c)) continue;
      seed ^= (r * 31 + c * 17) & 0xff;
      seed = Math.imul(seed, 16777619);
      grid[r][c] = ((seed >>> 24) & 1) === 1;
    }
  }

  return grid;
}
