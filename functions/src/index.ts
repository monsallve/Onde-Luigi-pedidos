import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import {
  onDocumentCreated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';

const FIRESTORE_DATABASE_ID = 'ai-studio-fecee9a9-7631-4685-a974-37cd28b7a202';

const adminApp = initializeApp();
const db = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
const messaging = getMessaging(adminApp);

type StaffRole = 'admin' | 'mesero' | 'cajero' | 'cocina';

interface EligibleRecipient {
  subId: string;
  uid: string;
  token: string;
  role: StaffRole;
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/mismatched-credential',
]);

function sanitizePushText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeRole(raw: unknown): StaffRole | null {
  if (raw === 'admin' || raw === 'mesero' || raw === 'cajero' || raw === 'cocina') {
    return raw;
  }
  return null;
}

function resolveAllowedRolesForNotificationType(notifType: string): Set<StaffRole> {
  if (notifType === 'solicitud_acceso') {
    return new Set<StaffRole>(['admin']);
  }
  if (
    notifType === 'venta_anulada' ||
    notifType === 'turno_abierto' ||
    notifType === 'turno_cerrado'
  ) {
    return new Set<StaffRole>(['admin', 'mesero', 'cajero']);
  }
  return new Set<StaffRole>(['admin', 'mesero', 'cajero', 'cocina']);
}

async function getEligibleActiveRecipients(
  workspaceId: string,
  allowedRoles: Set<StaffRole>,
  excludeUid = ''
): Promise<EligibleRecipient[]> {
  const wsRef = db.collection('workspaces').doc(workspaceId);
  const [subsSnap, membersSnap, staffSnap] = await Promise.all([
    wsRef.collection('pushSubscriptions').where('active', '==', true).get(),
    wsRef.collection('members').where('active', '==', true).get(),
    wsRef.collection('staff').where('active', '==', true).get(),
  ]);

  if (subsSnap.empty) return [];

  const activeMemberRoles = new Map<string, 'admin' | 'mesero'>();
  for (const docSnap of membersSnap.docs) {
    const data = docSnap.data() as { active?: boolean; role?: string };
    if (data.active === true) {
      activeMemberRoles.set(docSnap.id, data.role === 'admin' ? 'admin' : 'mesero');
    }
  }

  const activeStaffByUid = new Map<string, StaffRole>();
  const activeStaffById = new Map<string, StaffRole>();
  for (const docSnap of staffSnap.docs) {
    const data = docSnap.data() as {
      active?: boolean;
      role?: string;
      linkedUid?: string;
    };
    const parsedRole = normalizeRole(data.role);
    if (data.active === true && parsedRole) {
      activeStaffById.set(docSnap.id, parsedRole);
      if (typeof data.linkedUid === 'string' && data.linkedUid.trim()) {
        activeStaffByUid.set(data.linkedUid.trim(), parsedRole);
      }
    }
  }

  const seenTokens = new Set<string>();
  const staleSubIds: string[] = [];
  const eligible: EligibleRecipient[] = [];

  for (const docSnap of subsSnap.docs) {
    const sub = docSnap.data() as {
      uid?: string;
      staffId?: string;
      role?: string;
      token?: string;
      active?: boolean;
    };
    const uid = typeof sub.uid === 'string' ? sub.uid.trim() : '';
    const token = typeof sub.token === 'string' ? sub.token.trim() : '';
    const staffId = typeof sub.staffId === 'string' ? sub.staffId.trim() : '';
    if (!uid || !token || sub.active !== true) {
      staleSubIds.push(docSnap.id);
      continue;
    }

    const memberRole = activeMemberRoles.get(uid);
    if (!memberRole) {
      // User is no longer an active approved member -> clean up token
      staleSubIds.push(docSnap.id);
      continue;
    }

    const staffRole =
      (staffId ? activeStaffById.get(staffId) : undefined) ||
      activeStaffByUid.get(uid);
    if (!staffRole) {
      // User does not have an active operational staff role
      staleSubIds.push(docSnap.id);
      continue;
    }

    const effectiveRole: StaffRole = memberRole === 'admin' ? 'admin' : staffRole;
    if (excludeUid && uid === excludeUid) {
      continue;
    }
    if (!allowedRoles.has(effectiveRole)) {
      continue;
    }
    if (seenTokens.has(token)) {
      continue;
    }
    seenTokens.add(token);
    eligible.push({
      subId: docSnap.id,
      uid,
      token,
      role: effectiveRole,
    });
  }

  if (staleSubIds.length > 0) {
    const batch = db.batch();
    for (const subId of staleSubIds) {
      batch.delete(wsRef.collection('pushSubscriptions').doc(subId));
    }
    await batch.commit().catch(() => undefined);
  }

  return eligible;
}

async function sendBackgroundWebPush(
  workspaceId: string,
  recipients: EligibleRecipient[],
  payload: {
    title: string;
    body: string;
    tag: string;
    type: string;
    notificationId?: string;
    orderId?: string;
    orderNumber?: number;
    shiftId?: string;
  }
): Promise<void> {
  if (recipients.length === 0) return;

  const title = sanitizePushText(payload.title, 140) || "O'NDE LUIGI · POS";
  const body = sanitizePushText(payload.body, 360) || 'Nueva actividad en el POS.';
  const dataPayload: Record<string, string> = {
    title,
    body,
    type: sanitizePushText(payload.type, 40),
    notificationId: sanitizePushText(payload.notificationId || payload.tag, 128),
    orderId: sanitizePushText(payload.orderId || '', 128),
    orderNumber: String(payload.orderNumber || 0),
    shiftId: sanitizePushText(payload.shiftId || '', 128),
    url: './',
  };

  for (let i = 0; i < recipients.length; i += 500) {
    const chunk = recipients.slice(i, i + 500);
    const message: MulticastMessage = {
      tokens: chunk.map((r) => r.token),
      notification: {
        title,
        body,
      },
      data: dataPayload,
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400',
        },
        notification: {
          title,
          body,
          tag: sanitizePushText(payload.tag, 128),
          renotify: true,
          requireInteraction:
            payload.type === 'nueva_comanda' || payload.type === 'venta_anulada',
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    if (response.failureCount > 0) {
      const wsRef = db.collection('workspaces').doc(workspaceId);
      const batch = db.batch();
      let deletions = 0;

      response.responses.forEach((res, idx) => {
        if (!res.success && res.error && INVALID_TOKEN_CODES.has(res.error.code)) {
          const recipient = chunk[idx];
          if (recipient) {
            batch.delete(wsRef.collection('pushSubscriptions').doc(recipient.subId));
            deletions += 1;
          }
        }
      });

      if (deletions > 0) {
        await batch.commit().catch(() => undefined);
      }
    }
  }
}

async function deletePushSubscriptionsForUser(
  workspaceId: string,
  uid: string
): Promise<void> {
  const cleanUid = uid.trim();
  if (!cleanUid) return;
  const subsCol = db
    .collection('workspaces')
    .doc(workspaceId)
    .collection('pushSubscriptions');

  const [directSnap, querySnap] = await Promise.all([
    subsCol.doc(`sub_${cleanUid}`).get().catch(() => null),
    subsCol.where('uid', '==', cleanUid).get().catch(() => null),
  ]);

  const idsToDelete = new Set<string>();
  if (directSnap && directSnap.exists) {
    idsToDelete.add(directSnap.id);
  }
  if (querySnap && !querySnap.empty) {
    for (const d of querySnap.docs) {
      idsToDelete.add(d.id);
    }
  }
  if (idsToDelete.size === 0) return;

  const batch = db.batch();
  for (const id of idsToDelete) {
    batch.delete(subsCol.doc(id));
  }
  await batch.commit().catch(() => undefined);
}

export const onNotificationCreatedSendPush = onDocumentCreated(
  {
    document: 'workspaces/{workspaceId}/notifications/{notifId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'us-central1',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as {
      type?: string;
      title?: string;
      message?: string;
      orderId?: string;
      orderNumber?: number;
      shiftId?: string;
      actorUid?: string;
    };

    const workspaceId = event.params.workspaceId;
    const notifType = sanitizePushText(data.type || 'nueva_comanda', 40);
    const allowedRoles = resolveAllowedRolesForNotificationType(notifType);
    const actorUid = typeof data.actorUid === 'string' ? data.actorUid.trim() : '';

    const recipients = await getEligibleActiveRecipients(
      workspaceId,
      allowedRoles,
      actorUid
    );

    await sendBackgroundWebPush(workspaceId, recipients, {
      title: data.title || "O'NDE LUIGI · POS",
      body: data.message || 'Tienes una nueva notificación operativa.',
      tag: `notif-${event.params.notifId}`,
      type: notifType,
      notificationId: event.params.notifId,
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      shiftId: data.shiftId,
    });
  }
);

export const onSelfOrderCreatedSendPush = onDocumentCreated(
  {
    document: 'publicStorefronts/{workspaceId}/selfOrders/{orderId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'us-central1',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as {
      orderNumber?: number;
      customerName?: string;
      deliveryType?: string;
      total?: number;
      items?: Array<{ quantity?: number }>;
    };

    const workspaceId = event.params.workspaceId;
    const orderNumber = Number(data.orderNumber) || 500;
    const customerName = sanitizePushText(data.customerName, 80) || 'Cliente';
    const deliveryLabel =
      data.deliveryType === 'domicilio' ? 'Domicilio' : 'Recoger en local';
    const unitsCount = Array.isArray(data.items)
      ? data.items.reduce((acc, it) => acc + Math.max(1, Number(it.quantity) || 1), 0)
      : 0;
    const totalFormatted = `$${Math.round(Number(data.total) || 0).toLocaleString('es-CO')}`;

    const recipients = await getEligibleActiveRecipients(
      workspaceId,
      new Set<StaffRole>(['admin', 'mesero', 'cajero', 'cocina'])
    );

    await sendBackgroundWebPush(workspaceId, recipients, {
      title: `Pedido Autoservicio #${orderNumber}`,
      body: `${customerName} (${deliveryLabel}) · ${unitsCount} prod. · ${totalFormatted} · Comprobante adjunto.`,
      tag: `self-${event.params.orderId}`,
      type: 'nueva_comanda',
      notificationId: `self_${event.params.orderId}`,
      orderId: event.params.orderId,
      orderNumber,
    });
  }
);

export const onAccessRequestCreatedSendPush = onDocumentCreated(
  {
    document: 'workspaces/{workspaceId}/accessRequests/{reqId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'us-central1',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as {
      status?: string;
      requestedName?: string;
      displayName?: string;
      email?: string;
    };
    if (data.status && data.status !== 'pending') return;

    const workspaceId = event.params.workspaceId;
    const name =
      sanitizePushText(data.requestedName || data.displayName || data.email, 80) ||
      'Nuevo usuario';
    const email = sanitizePushText(data.email || '', 120);

    const recipients = await getEligibleActiveRecipients(
      workspaceId,
      new Set<StaffRole>(['admin']),
      event.params.reqId
    );

    await sendBackgroundWebPush(workspaceId, recipients, {
      title: 'Nueva solicitud de acceso al POS',
      body: `${name}${email ? ` (${email})` : ''} está esperando asignación de rol.`,
      tag: `access-req-${event.params.reqId}`,
      type: 'solicitud_acceso',
      notificationId: `notif_access_req_${event.params.reqId}`,
    });
  }
);

export const onMemberChangedCleanupPush = onDocumentWritten(
  {
    document: 'workspaces/{workspaceId}/members/{uid}',
    database: FIRESTORE_DATABASE_ID,
    region: 'us-central1',
  },
  async (event) => {
    const afterSnap = event.data?.after;
    if (!afterSnap || !afterSnap.exists) {
      await deletePushSubscriptionsForUser(event.params.workspaceId, event.params.uid);
      return;
    }
    const data = afterSnap.data() as { active?: boolean };
    if (data.active === false) {
      await deletePushSubscriptionsForUser(event.params.workspaceId, event.params.uid);
    }
  }
);

export const onStaffChangedCleanupPush = onDocumentWritten(
  {
    document: 'workspaces/{workspaceId}/staff/{staffId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'us-central1',
  },
  async (event) => {
    const afterSnap = event.data?.after;
    const beforeSnap = event.data?.before;
    if (!afterSnap || !afterSnap.exists) {
      const beforeUid = beforeSnap?.exists
        ? String((beforeSnap.data() as { linkedUid?: string }).linkedUid || '')
        : '';
      if (beforeUid) {
        await deletePushSubscriptionsForUser(event.params.workspaceId, beforeUid);
      }
      return;
    }
    const data = afterSnap.data() as { active?: boolean; linkedUid?: string };
    const linkedUid = typeof data.linkedUid === 'string' ? data.linkedUid.trim() : '';
    if (linkedUid && data.active === false) {
      await deletePushSubscriptionsForUser(event.params.workspaceId, linkedUid);
    }
  }
);
