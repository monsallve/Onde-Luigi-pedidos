import type { WorkspaceNotification, WorkspaceNotificationType } from '../types/pos';
import { resolveAssetUrl } from './orderMath';

const NOTIF_SOUND_MUTED_KEY = 'ondeluigi_notif_muted_v1';
const NOTIF_PROMPT_DISMISSED_KEY = 'ondeluigi_notif_prompt_dismissed_v1';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface SystemNotificationPayloadOptions {
  body: string;
  icon: string;
  badge: string;
  tag: string;
  renotify: boolean;
  silent: boolean;
  requireInteraction: boolean;
  vibrate: number[];
  data: {
    url: string;
    type: WorkspaceNotificationType;
    orderId: string;
    notificationId: string;
  };
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedAudioCtx = new Ctor();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function unlockNotificationAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

export function isNotificationSoundMuted(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(NOTIF_SOUND_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NOTIF_SOUND_MUTED_KEY, muted ? '1' : '0');
    }
  } catch {
    // ignore storage errors
  }
}

export function isNotificationPromptDismissed(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem(NOTIF_PROMPT_DISMISSED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function setNotificationPromptDismissed(dismissed: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NOTIF_PROMPT_DISMISSED_KEY, dismissed ? '1' : '0');
    }
  } catch {
    // ignore storage errors
  }
}

export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const perm = window.Notification.permission;
  if (perm === 'granted' || perm === 'denied' || perm === 'default') {
    return perm;
  }
  return 'unsupported';
}

export function shouldOfferPermissionPrompt(
  state: NotificationPermissionState,
  dismissed: boolean
): boolean {
  return state === 'default' && !dismissed;
}

export function shouldDispatchSystemNotification(params: {
  permission: NotificationPermissionState;
  hidden: boolean;
  hasFocus: boolean;
  forceOsNotification?: boolean;
}): boolean {
  if (params.permission !== 'granted') return false;
  if (params.forceOsNotification) return true;
  return params.hidden || !params.hasFocus;
}

export async function requestDeviceNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const current = getNotificationPermissionState();
  if (current === 'granted' || current === 'denied') {
    return current;
  }

  unlockNotificationAudio();
  try {
    const result = await new Promise<NotificationPermission>((resolve, reject) => {
      try {
        const maybePromise = window.Notification.requestPermission((legacyPerm) => {
          resolve(legacyPerm);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
    if (result === 'granted' || result === 'denied' || result === 'default') {
      return result;
    }
    return getNotificationPermissionState();
  } catch {
    return getNotificationPermissionState();
  }
}

export function buildSystemNotificationOptions(
  notif: WorkspaceNotification
): SystemNotificationPayloadOptions {
  return {
    body: notif.message,
    icon: resolveAssetUrl('/pwa-192x192.png'),
    badge: resolveAssetUrl('/pwa-192x192.png'),
    tag: notif.id,
    renotify: true,
    silent: false,
    requireInteraction: notif.type === 'nueva_comanda' || notif.type === 'venta_anulada',
    vibrate: notif.type === 'venta_anulada' ? [220, 80, 220] : [140, 60, 140],
    data: {
      url: './',
      type: notif.type,
      orderId: notif.orderId || '',
      notificationId: notif.id,
    },
  };
}

export function playNotificationChime(type: WorkspaceNotificationType): void {
  if (isNotificationSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }

  try {
    const now = ctx.currentTime;
    const notes: Array<{ freq: number; start: number; duration: number }> =
      type === 'venta_anulada'
        ? [
            { freq: 520, start: 0, duration: 0.12 },
            { freq: 390, start: 0.13, duration: 0.18 },
          ]
        : type === 'turno_abierto' || type === 'turno_cerrado'
          ? [
              { freq: 587.33, start: 0, duration: 0.11 },
              { freq: 880, start: 0.12, duration: 0.18 },
            ]
          : [
              { freq: 659.25, start: 0, duration: 0.1 },
              { freq: 987.77, start: 0.11, duration: 0.17 },
            ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.11, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.02);
    }
  } catch {
    // ignore autoplay restriction errors
  }
}

export async function showSystemNotification(
  notif: WorkspaceNotification,
  opts?: { forceOsNotification?: boolean }
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const permission = getNotificationPermissionState();
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

  if (
    !shouldDispatchSystemNotification({
      permission,
      hidden: document.hidden,
      hasFocus,
      forceOsNotification: opts?.forceOsNotification,
    })
  ) {
    return false;
  }

  const payloadOptions = buildSystemNotificationOptions(notif);

  if ('serviceWorker' in navigator) {
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 900)),
      ]);
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(
          notif.title,
          payloadOptions as unknown as NotificationOptions
        );
        return true;
      }
    } catch {
      // fall through to window.Notification fallback
    }
  }

  if ('Notification' in window) {
    try {
      const instance = new window.Notification(notif.title, {
        body: payloadOptions.body,
        icon: payloadOptions.icon,
        tag: payloadOptions.tag,
        silent: false,
        data: payloadOptions.data,
      });
      instance.onclick = () => {
        window.focus();
        instance.close();
      };
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function triggerDeviceAlert(
  notif: WorkspaceNotification,
  opts?: { forceOsNotification?: boolean }
): void {
  playNotificationChime(notif.type);

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(notif.type === 'venta_anulada' ? [180, 70, 180] : [120, 50, 120]);
    } catch {
      // ignore vibration errors
    }
  }

  void showSystemNotification(notif, opts);
}

/** @deprecated Kept as alias for backwards compatibility */
export const triggerDeviceAlertWithoutPrompt = triggerDeviceAlert;
