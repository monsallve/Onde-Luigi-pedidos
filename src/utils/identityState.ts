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
  if (sessionMode === 'demo') return staffLoaded;
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
  activeWaiterId: string;
}

export function resolveActiveWaiter({
  isPrimaryAdmin,
  myLinkedStaff,
  staff,
}: ActiveWaiterResolutionParams): StaffMember | null {
  if (myLinkedStaff && myLinkedStaff.active) {
    return myLinkedStaff;
  }
  if (isPrimaryAdmin) {
    return (
      staff.find(
        (s) =>
          s.active &&
          (Boolean(s.linkedUid) && s.linkedUid === s.ownerUid)
      ) || null
    );
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
