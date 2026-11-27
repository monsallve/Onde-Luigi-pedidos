import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type {
  DeliveryType,
  Order,
  OrderItem,
  Product,
  PublicQueueTicket,
  PublicStorefrontConfig,
  Sauce,
} from '../types/pos';
import { calculateOrderTotals } from '../utils/orderMath';
import {
  assertSafeTextInput,
  sanitizePlainText,
  sanitizeStringList,
} from '../utils/inputSecurity';
import {
  createSelfOrderId,
  formatSelfServiceOrderReference,
  resolveNextSelfServiceOrderNumber,
  validateSelfServiceCheckout,
} from '../utils/selfServiceMath';
import { uploadSelfServiceReceiptImage } from './storageService';
import {
  mapPublicProductDoc,
  mapPublicSauceDoc,
  mapPublicStorefrontDoc,
  mapQueueTicketDoc,
  mapSelfOrderDoc,
  SHARED_WORKSPACE_ID,
} from './workspaceSync';

const SELF_ORDER_TRACKING_KEY = 'ondeluigi_self_active_order_id_v1';

export function readStoredTrackingOrderId(): string {
  try {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(SELF_ORDER_TRACKING_KEY) || '';
  } catch {
    return '';
  }
}

export function persistTrackingOrderId(orderId: string): void {
  try {
    if (typeof window === 'undefined') return;
    if (orderId) {
      window.localStorage.setItem(SELF_ORDER_TRACKING_KEY, orderId);
    } else {
      window.localStorage.removeItem(SELF_ORDER_TRACKING_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function subscribePublicStorefront(
  onStorefront: (config: PublicStorefrontConfig | null, exists: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db) {
    onStorefront(null, false);
    return () => undefined;
  }
  return onSnapshot(
    doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID),
    (snap) => {
      if (!snap.exists()) {
        onStorefront(null, false);
        return;
      }
      onStorefront(
        mapPublicStorefrontDoc(snap.data() as Record<string, unknown>, snap.id),
        true
      );
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error('No se pudo cargar la tienda.'));
    }
  );
}

export function subscribePublicCatalog(
  onProducts: (products: Product[], hasCloudRows: boolean) => void,
  onSauces: (sauces: Sauce[], hasCloudRows: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db) {
    onProducts([], false);
    onSauces([], false);
    return () => undefined;
  }

  const prodQuery = query(
    collection(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'products'),
    where('active', 'in', [true, false])
  );
  const sauceQuery = query(
    collection(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'sauces'),
    where('active', 'in', [true, false])
  );

  const unsubProds = onSnapshot(
    prodQuery,
    (snap) => {
      const list = snap.docs.map((d) =>
        mapPublicProductDoc(d.data() as Record<string, unknown>, d.id)
      );
      onProducts(list, snap.docs.length > 0);
    },
    (err) => {
      console.warn('Public catalog products error:', err);
      onError?.(err instanceof Error ? err : new Error('No se pudo cargar la carta.'));
    }
  );

  const unsubSauces = onSnapshot(
    sauceQuery,
    (snap) => {
      const list = snap.docs.map((d) =>
        mapPublicSauceDoc(d.data() as Record<string, unknown>, d.id)
      );
      onSauces(list, snap.docs.length > 0);
    },
    (err) => {
      console.warn('Public catalog sauces error:', err);
      onError?.(err instanceof Error ? err : new Error('No se pudieron cargar las salsas.'));
    }
  );

  return () => {
    unsubProds();
    unsubSauces();
  };
}

export function subscribePublicQueueTickets(
  onTickets: (tickets: PublicQueueTicket[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db) {
    onTickets([]);
    return () => undefined;
  }
  const q = query(
    collection(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'queueTickets'),
    where('status', 'in', [
      'pendiente_validacion',
      'tomado',
      'preparacion',
      'listo',
      'entregado',
      'cancelado',
    ])
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) =>
        mapQueueTicketDoc(d.data() as Record<string, unknown>, d.id)
      );
      list.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onTickets(list);
    },
    (err) => {
      console.warn('Public queueTickets error:', err);
      onError?.(err instanceof Error ? err : new Error('No se pudo consultar la fila de pedidos.'));
    }
  );
}

export function subscribeSelfOrderById(
  orderId: string,
  onOrder: (order: Order | null) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db || !orderId) {
    onOrder(null);
    return () => undefined;
  }
  return onSnapshot(
    doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'selfOrders', orderId),
    (snap) => {
      if (!snap.exists()) {
        onOrder(null);
        return;
      }
      onOrder(mapSelfOrderDoc(snap.data() as Record<string, unknown>, snap.id));
    },
    (err) => {
      onError?.(err instanceof Error ? err : new Error('No se pudo consultar el estado de tu pedido.'));
    }
  );
}

export interface SubmitSelfServiceOrderInput {
  storefront: PublicStorefrontConfig | null;
  queueTickets: PublicQueueTicket[];
  items: OrderItem[];
  deliveryType: DeliveryType | '';
  customerName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
  deliveryNotes?: string;
  notes?: string;
  receiptFile: File | null;
}

export async function submitSelfServiceOrder(
  input: SubmitSelfServiceOrderInput
): Promise<Order> {
  if (!db) {
    throw new Error('La conexión en tiempo real no está disponible.');
  }
  if (!input.storefront || !input.storefront.ownerUid) {
    throw new Error(
      'El autoservicio aún no ha sido activado en la nube por el administrador (Ajustes → Autoservicio QR).'
    );
  }
  if (!input.storefront.enabled) {
    throw new Error('El autoservicio digital está pausado temporalmente por el restaurante.');
  }

  const validation = validateSelfServiceCheckout({
    deliveryType: input.deliveryType,
    customerName: input.customerName,
    deliveryPhone: input.deliveryPhone,
    deliveryAddress: input.deliveryAddress,
    deliveryNeighborhood: input.deliveryNeighborhood,
    deliveryNotes: input.deliveryNotes,
    paymentMethod: 'transferencia',
    hasReceiptFile: Boolean(input.receiptFile),
    items: input.items,
  });

  if (!validation.valid) {
    throw new Error(validation.firstError || 'Revisa los datos requeridos del pedido.');
  }
  if (!input.receiptFile || (input.deliveryType !== 'local' && input.deliveryType !== 'domicilio')) {
    throw new Error('Falta completar la modalidad de entrega o el comprobante.');
  }

  const cleanName = assertSafeTextInput(input.customerName, 'Nombre completo', {
    maxLen: 120,
    required: true,
  });
  const cleanPhone = assertSafeTextInput(input.deliveryPhone, 'Teléfono o WhatsApp', {
    maxLen: 40,
  });
  const cleanAddress =
    input.deliveryType === 'domicilio'
      ? assertSafeTextInput(input.deliveryAddress, 'Dirección de entrega', {
          maxLen: 220,
          required: true,
        })
      : '';
  const cleanNeighborhood =
    input.deliveryType === 'domicilio'
      ? assertSafeTextInput(input.deliveryNeighborhood, 'Barrio o sector', {
          maxLen: 100,
          required: true,
        })
      : '';
  const cleanDeliveryNotes =
    input.deliveryType === 'domicilio'
      ? assertSafeTextInput(input.deliveryNotes || '', 'Indicaciones de entrega', {
          maxLen: 240,
          allowNewlines: true,
        })
      : '';
  const cleanNotes = assertSafeTextInput(input.notes || '', 'Notas del pedido', {
    maxLen: 400,
    allowNewlines: true,
  });

  const sanitizedItems: OrderItem[] = input.items.map((it) => ({
    ...it,
    productName: sanitizePlainText(it.productName, { maxLen: 100 }),
    category: sanitizePlainText(it.category, { maxLen: 60 }),
    removedIngredients: sanitizeStringList(it.removedIngredients, 30, 80),
    selectedSauces: sanitizeStringList(it.selectedSauces, 10, 60),
    addedExtras: (it.addedExtras || []).map((ex) => ({
      ...ex,
      name: sanitizePlainText(ex.name, { maxLen: 80 }),
    })),
    customNote: assertSafeTextInput(it.customNote || '', `Nota de ${it.productName}`, {
      maxLen: 200,
    }),
  }));

  const orderId = createSelfOrderId();
  const orderNumber = resolveNextSelfServiceOrderNumber(input.queueTickets);
  const reference = formatSelfServiceOrderReference(orderNumber, input.deliveryType, cleanName);
  const { subtotal, total } = calculateOrderTotals(sanitizedItems);

  const uploadRes = await uploadSelfServiceReceiptImage({
    workspaceId: SHARED_WORKSPACE_ID,
    orderId,
    file: input.receiptFile,
  });

  const now = Date.now();
  const ownerUid = input.storefront.ownerUid;

  const batch = writeBatch(db);
  batch.set(doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'selfOrders', orderId), {
    id: orderId,
    orderNumber,
    reference,
    source: 'autoservicio',
    deliveryType: input.deliveryType,
    deliveryAddress: cleanAddress,
    deliveryNeighborhood: cleanNeighborhood,
    deliveryPhone: cleanPhone,
    deliveryNotes: cleanDeliveryNotes,
    customerName: cleanName,
    status: 'pendiente_validacion',
    paymentStatus: 'pendiente',
    paymentMethod: 'transferencia',
    items: sanitizedItems,
    subtotal,
    total,
    notes: cleanNotes,
    receiptCount: 1,
    latestReceiptUrl: uploadRes.imageUrl,
    receiptStoragePath: uploadRes.storagePath,
    ownerUid,
    createdByUid: 'autoservicio_public',
    createdAtMs: now,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'publicStorefronts', SHARED_WORKSPACE_ID, 'queueTickets', orderId), {
    id: orderId,
    orderNumber,
    status: 'pendiente_validacion',
    deliveryType: input.deliveryType,
    createdAtMs: now,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  persistTrackingOrderId(orderId);

  return {
    id: orderId,
    orderNumber,
    reference,
    waiterId: 'autoservicio',
    waiterName:
      input.deliveryType === 'domicilio'
        ? 'Autoservicio · Domicilio'
        : 'Autoservicio · Local',
    status: 'pendiente_validacion',
    paymentStatus: 'pendiente',
    paymentMethod: 'transferencia',
    items: sanitizedItems,
    subtotal,
    total,
    notes: cleanNotes,
    receiptCount: 1,
    latestReceiptUrl: uploadRes.imageUrl,
    receiptStoragePath: uploadRes.storagePath,
    source: 'autoservicio',
    deliveryType: input.deliveryType,
    deliveryAddress: cleanAddress,
    deliveryNeighborhood: cleanNeighborhood,
    deliveryPhone: cleanPhone,
    deliveryNotes: cleanDeliveryNotes,
    customerName: cleanName,
    customerPhone: cleanPhone || undefined,
    ownerUid,
    createdByUid: 'autoservicio_public',
    allowedEmails: [],
    createdAtMs: now,
    updatedAtMs: now,
  };
}
