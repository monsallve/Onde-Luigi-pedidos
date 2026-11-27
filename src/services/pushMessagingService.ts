import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, db, isFirebaseConfigured } from '../firebase/config';
import type { StaffMember, StaffRole, StartupAccessStatus } from '../types/pos';
import { sanitizePlainText } from '../utils/inputSecurity';
import type { NotificationPermissionState } from '../utils/notificationAlert';
import {
  buildPushDeviceLabel,
  canRegisterStaffBackgroundPush,
  computePushSubId,
  detectPushPlatform,
  isStandalonePwaMode,
  type PushEligibilityReason,
  type PushSyncStatusInfo,
} from '../utils/pushEligibility';
import { SHARED_WORKSPACE_ID } from './workspaceSync';

export type { PushEligibilityReason, PushSyncStatusInfo };
export {
  canRegisterStaffBackgroundPush,
  computePushSubId,
  detectPushPlatform,
  isStandalonePwaMode,
};

export function getConfiguredVapidKey(): string {
  try {
    const raw = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_FIREBASE_VAPID_KEY;
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return '';
    return trimmed;
  } catch {
    return '';
  }
}

async function resolvePosServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    const posReg = regs.find((r) => /\/pos\//i.test(r.scope));
    if (posReg) return posReg;
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 1500)),
    ]);
    return ready;
  } catch {
    return undefined;
  }
}

export async function syncStaffBackgroundPush(params: {
  accessStatus: StartupAccessStatus;
  firebaseUid: string;
  email: string;
  staffProfile: StaffMember | null;
  effectiveRole: StaffRole | null;
  ownerUid: string;
  authorizedEmails: string[];
  notificationPermission: NotificationPermissionState;
}): Promise<PushSyncStatusInfo> {
  const platform = detectPushPlatform();
  const isStandalone = isStandalonePwaMode();
  const vapidKey = getConfiguredVapidKey();
  const hasVapidKey = Boolean(vapidKey);

  if (platform === 'ios' && !isStandalone) {
    return {
      status: 'ios_install_required',
      platform,
      isStandalone,
      hasVapidKey,
      message:
        'En iPhone/iPad debes instalar la app POS en "Agregar a pantalla de inicio" para recibir notificaciones en segundo plano.',
    };
  }

  if (params.notificationPermission === 'denied') {
    return {
      status: 'blocked',
      platform,
      isStandalone,
      hasVapidKey,
      message: 'El permiso de notificaciones está bloqueado en este navegador/dispositivo.',
    };
  }

  if (params.notificationPermission === 'unsupported') {
    return {
      status: 'unsupported',
      platform,
      isStandalone,
      hasVapidKey,
      message: 'Este navegador no soporta notificaciones del sistema.',
    };
  }

  if (params.notificationPermission !== 'granted') {
    return {
      status: 'permission_needed',
      platform,
      isStandalone,
      hasVapidKey,
      message: 'Activa el permiso de notificaciones para recibir alertas con la app cerrada.',
    };
  }

  const check = canRegisterStaffBackgroundPush({
    isFirebaseConfigured,
    accessStatus: params.accessStatus,
    firebaseUid: params.firebaseUid,
    staffProfile: params.staffProfile,
    effectiveRole: params.effectiveRole,
    notificationPermission: params.notificationPermission,
    hasVapidKey,
  });

  if (!check.eligible) {
    if (check.reason === 'missing_vapid') {
      return {
        status: 'vapid_missing',
        platform,
        isStandalone,
        hasVapidKey: false,
        message:
          'Permiso concedido. Falta configurar VITE_FIREBASE_VAPID_KEY y desplegar functions/ para envío FCM con la app cerrada.',
      };
    }
    return {
      status: 'ineligible',
      platform,
      isStandalone,
      hasVapidKey,
      message: 'Solo cuentas aprobadas con un rol activo pueden recibir alertas en segundo plano.',
    };
  }

  if (!app || !db || !params.staffProfile || !params.effectiveRole) {
    return {
      status: 'unsupported',
      platform,
      isStandalone,
      hasVapidKey,
      message: 'Firebase Messaging no disponible en este entorno.',
    };
  }

  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      return {
        status: 'unsupported',
        platform,
        isStandalone,
        hasVapidKey,
        message: 'Web Push en segundo plano no está soportado en este navegador.',
      };
    }

    const swReg = await resolvePosServiceWorkerRegistration();
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      ...(swReg ? { serviceWorkerRegistration: swReg } : {}),
    });

    if (!token) {
      return {
        status: 'error',
        platform,
        isStandalone,
        hasVapidKey,
        message: 'No se pudo obtener el token FCM de este dispositivo.',
      };
    }

    const subId = computePushSubId(params.firebaseUid);
    const normalizedEmail = (params.email || '').trim().toLowerCase();
    const allowedEmails = Array.from(
      new Set(
        [...params.authorizedEmails.map((e) => e.toLowerCase()), normalizedEmail].filter(Boolean)
      )
    ).slice(0, 25);

    const subRef = doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'pushSubscriptions', subId);
    const existingSub = await getDoc(subRef);
    const basePayload = {
      id: subId,
      uid: params.firebaseUid,
      staffId: params.staffProfile.id,
      staffName: sanitizePlainText(params.staffProfile.name, { maxLen: 80 }) || 'Equipo',
      email: normalizedEmail,
      role: params.effectiveRole,
      active: true,
      token: token.slice(0, 500),
      platform,
      deviceLabel: buildPushDeviceLabel(platform, isStandalone),
      ownerUid: params.ownerUid || params.firebaseUid,
      createdByUid: params.firebaseUid,
      allowedEmails,
      updatedAt: serverTimestamp(),
    };

    if (existingSub.exists()) {
      await updateDoc(subRef, basePayload);
    } else {
      await setDoc(subRef, {
        ...basePayload,
        createdAt: serverTimestamp(),
      });
    }

    return {
      status: 'active',
      platform,
      isStandalone,
      hasVapidKey,
      message: `Dispositivo vinculado (${params.effectiveRole}) para notificaciones en segundo plano.`,
    };
  } catch (err) {
    console.warn('FCM push subscription sync warning:', err);
    return {
      status: 'error',
      platform,
      isStandalone,
      hasVapidKey,
      message:
        err instanceof Error
          ? err.message
          : 'No se pudo registrar el token de notificaciones en segundo plano.',
    };
  }
}

export async function revokeStaffBackgroundPush(uid: string | null | undefined): Promise<void> {
  if (!uid || !db) return;
  const subId = computePushSubId(uid);
  try {
    await deleteDoc(doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'pushSubscriptions', subId));
  } catch {
    // Ignore if subscription did not exist or rules already denied
  }
  if (app) {
    try {
      const supported = await isSupported().catch(() => false);
      if (supported) {
        await deleteToken(getMessaging(app));
      }
    } catch {
      // Ignore deleteToken errors in unsupported environments
    }
  }
}

export function subscribeForegroundFcmMessages(
  onPayload: (payload: { title?: string; body?: string; data?: Record<string, string> }) => void
): () => void {
  if (!app || typeof window === 'undefined') return () => undefined;
  let active = true;
  let unsub: (() => void) | null = null;

  void isSupported()
    .then((supported) => {
      if (!active || !supported || !app) return;
      const messaging = getMessaging(app);
      unsub = onMessage(messaging, (payload) => {
        onPayload({
          title: payload.notification?.title || payload.data?.title,
          body: payload.notification?.body || payload.data?.body,
          data: payload.data,
        });
      });
    })
    .catch(() => undefined);

  return () => {
    active = false;
    if (unsub) unsub();
  };
}
