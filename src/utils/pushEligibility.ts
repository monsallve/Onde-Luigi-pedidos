import type {
  PushPlatform,
  StaffMember,
  StaffRole,
  StartupAccessStatus,
} from '../types/pos';
import { sanitizePlainText } from './inputSecurity';
import type { NotificationPermissionState } from './notificationAlert';
import { isValidStaffRole } from './rolePermissions';

const DEVICE_ID_STORAGE_KEY = 'ondeluigi_push_device_id_v1';

export type PushEligibilityReason =
  | 'ok'
  | 'not_configured'
  | 'not_approved'
  | 'missing_uid'
  | 'missing_staff'
  | 'inactive_staff'
  | 'invalid_role'
  | 'permission_needed'
  | 'missing_vapid';

export interface PushSyncStatusInfo {
  status:
    | 'active'
    | 'permission_needed'
    | 'blocked'
    | 'ios_install_required'
    | 'vapid_missing'
    | 'unsupported'
    | 'ineligible'
    | 'syncing'
    | 'error';
  platform: PushPlatform;
  isStandalone: boolean;
  hasVapidKey: boolean;
  message: string;
}

export function canRegisterStaffBackgroundPush(params: {
  isFirebaseConfigured: boolean;
  accessStatus: StartupAccessStatus;
  firebaseUid: string | null | undefined;
  staffProfile: Pick<StaffMember, 'id' | 'active' | 'role'> | null | undefined;
  effectiveRole: StaffRole | null | undefined;
  notificationPermission: NotificationPermissionState;
  hasVapidKey: boolean;
}): { eligible: boolean; reason: PushEligibilityReason } {
  if (!params.isFirebaseConfigured) {
    return { eligible: false, reason: 'not_configured' };
  }
  if (params.accessStatus !== 'approved') {
    return { eligible: false, reason: 'not_approved' };
  }
  if (!params.firebaseUid || !params.firebaseUid.trim()) {
    return { eligible: false, reason: 'missing_uid' };
  }
  if (!params.staffProfile) {
    return { eligible: false, reason: 'missing_staff' };
  }
  if (!params.staffProfile.active) {
    return { eligible: false, reason: 'inactive_staff' };
  }
  if (!params.effectiveRole || !isValidStaffRole(params.effectiveRole)) {
    return { eligible: false, reason: 'invalid_role' };
  }
  if (params.notificationPermission !== 'granted') {
    return { eligible: false, reason: 'permission_needed' };
  }
  if (!params.hasVapidKey) {
    return { eligible: false, reason: 'missing_vapid' };
  }
  return { eligible: true, reason: 'ok' };
}

export function detectPushPlatform(userAgent?: string): PushPlatform {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');
  if (!ua) return 'unknown';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'unknown';
}

export function isStandalonePwaMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const standaloneMedia =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = Boolean(
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    );
    return standaloneMedia || iosStandalone;
  } catch {
    return false;
  }
}

export function getOrCreatePushDeviceId(): string {
  const fallback = 'webdev01';
  if (typeof window === 'undefined') return fallback;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '';
    if (/^[a-zA-Z0-9_-]{6,24}$/.test(existing)) {
      return existing;
    }
    const bytes = new Uint8Array(6);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return fallback;
  }
}

export function computePushSubId(uid: string, deviceId?: string): string {
  const safeUid = (uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const safeDev = (deviceId || getOrCreatePushDeviceId())
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24);
  return `sub_${safeUid}_${safeDev}`.slice(0, 128);
}

export function buildPushDeviceLabel(platform: PushPlatform, standalone: boolean): string {
  const platformName =
    platform === 'android'
      ? 'Android'
      : platform === 'ios'
        ? 'iPhone / iPad'
        : platform === 'desktop'
          ? 'Computador'
          : 'Dispositivo';
  return sanitizePlainText(
    standalone ? `${platformName} · PWA instalada` : `${platformName} · Navegador`,
    { maxLen: 80 }
  );
}
