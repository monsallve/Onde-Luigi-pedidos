import type { ConnectionMode, StaffMember } from '../types/pos';

export function findLinkedStaffMember(
  staff: StaffMember[],
  actorUid: string,
  actorEmail: string
): StaffMember | null {
  const normalizedEmail = (actorEmail || '').trim().toLowerCase();
  if (actorUid) {
    const byUid = staff.find((s) => Boolean(s.linkedUid) && s.linkedUid === actorUid);
    if (byUid) return byUid;
  }
  if (normalizedEmail) {
    const byEmail = staff.find(
      (s) => Boolean(s.linkedEmail) && (s.linkedEmail || '').toLowerCase() === normalizedEmail
    );
    if (byEmail) return byEmail;
  }
  return null;
}

export interface StartupIdentityParams {
  authReady: boolean;
  sessionMode: ConnectionMode | null;
  cloudError: string | null;
  firebaseUid: string | null;
  cloudReadyForUid: string | null;
  staffLoaded: boolean;
  loadingData: boolean;
}

export function isStartupIdentityReady({
  authReady,
  sessionMode,
  cloudError,
  firebaseUid,
  cloudReadyForUid,
  staffLoaded,
  loadingData,
}: StartupIdentityParams): boolean {
  if (!authReady) return false;
  if (!sessionMode) return true;
  if (cloudError) return true;
  return Boolean(
    firebaseUid &&
      cloudReadyForUid === firebaseUid &&
      staffLoaded &&
      !loadingData
  );
}

export interface ActiveWaiterResolutionParams {
  isPrimaryAdmin: boolean;
  myLinkedStaff: StaffMember | null;
  staff: StaffMember[];
  firebaseUid?: string;
  firebaseDisplayName?: string;
  firebaseEmail?: string;
  ownerUid?: string;
}

export function resolveActiveWaiter({
  isPrimaryAdmin,
  myLinkedStaff,
  staff,
  firebaseUid = '',
  firebaseDisplayName = '',
  firebaseEmail = '',
  ownerUid = '',
}: ActiveWaiterResolutionParams): StaffMember | null {
  if (myLinkedStaff && myLinkedStaff.active) {
    return myLinkedStaff;
  }
  if (isPrimaryAdmin) {
    const ownerStaff = staff.find(
      (s) => s.active && Boolean(s.linkedUid) && s.linkedUid === s.ownerUid
    );
    if (ownerStaff) return ownerStaff;

    if (firebaseUid) {
      const now = Date.now();
      const cleanName = (firebaseDisplayName || '').trim() || 'Administrador';
      const normalizedEmail = (firebaseEmail || '').trim().toLowerCase();
      return {
        id: `staff_${firebaseUid}`,
        name: cleanName.slice(0, 80),
        role: 'admin',
        active: true,
        linkedUid: firebaseUid,
        linkedEmail: normalizedEmail,
        ownerUid: ownerUid || firebaseUid,
        createdByUid: firebaseUid,
        allowedEmails: normalizedEmail ? [normalizedEmail] : [],
        createdAtMs: now,
        updatedAtMs: now,
      };
    }
  }
  return null;
}

export interface PermanentPromptParams {
  sessionMode: ConnectionMode | null;
  identityReady: boolean;
  loadingData: boolean;
  cloudError: string | null;
  isPrimaryAdmin: boolean;
  myLinkedStaff: StaffMember | null;
}

export function shouldPromptPermanentRegistration({
  sessionMode,
  identityReady,
  loadingData,
  cloudError,
  isPrimaryAdmin,
  myLinkedStaff,
}: PermanentPromptParams): boolean {
  if (sessionMode !== 'cloud') return false;
  if (!identityReady || loadingData || cloudError) return false;
  if (isPrimaryAdmin) return false;
  return !myLinkedStaff;
}
