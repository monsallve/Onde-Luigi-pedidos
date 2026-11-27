import type {
  AccessRequestStatus,
  ConnectionMode,
  StaffMember,
  StartupAccessStatus,
} from '../types/pos';
import { sanitizePlainText } from './inputSecurity';

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
  accessStatus?: StartupAccessStatus;
  staffLoaded: boolean;
  loadingData: boolean;
}

export function resolveStartupAccessStatus(params: {
  sessionMode: ConnectionMode | null;
  cloudError: string | null;
  isPrimaryAdmin: boolean;
  memberExists: boolean;
  memberActive: boolean;
  requestStatus?: AccessRequestStatus | null;
  staffLoaded?: boolean;
  myLinkedStaff?: StaffMember | null;
}): StartupAccessStatus {
  if (!params.sessionMode) return 'unauthenticated';
  if (params.isPrimaryAdmin) return 'approved';
  if (params.memberExists) {
    if (!params.memberActive) return 'deactivated';
    if (params.staffLoaded && params.myLinkedStaff && !params.myLinkedStaff.active) {
      return 'deactivated';
    }
    return 'approved';
  }
  if (params.requestStatus === 'rejected') return 'rejected';
  if (params.cloudError && !params.requestStatus) return 'pending';
  return 'pending';
}

export function isStartupIdentityReady({
  authReady,
  sessionMode,
  cloudError,
  firebaseUid,
  cloudReadyForUid,
  accessStatus,
  staffLoaded,
  loadingData,
}: StartupIdentityParams): boolean {
  if (!authReady) return false;
  if (!sessionMode) return true;
  if (cloudError) return true;
  if (!firebaseUid || cloudReadyForUid !== firebaseUid) return false;
  if (accessStatus === 'pending' || accessStatus === 'rejected' || accessStatus === 'deactivated') {
    return true;
  }
  return Boolean(staffLoaded && !loadingData);
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
      const cleanName = sanitizePlainText(firebaseDisplayName, { maxLen: 80 }) || 'Administrador';
      const normalizedEmail = (firebaseEmail || '').trim().toLowerCase();
      return {
        id: `staff_${firebaseUid}`,
        name: cleanName,
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
  accessStatus?: StartupAccessStatus;
  myLinkedStaff: StaffMember | null;
}

export function shouldPromptPermanentRegistration({
  sessionMode,
  identityReady,
  loadingData,
  cloudError,
  isPrimaryAdmin,
  accessStatus,
  myLinkedStaff,
}: PermanentPromptParams): boolean {
  if (sessionMode !== 'cloud') return false;
  if (!identityReady || loadingData || cloudError) return false;
  if (isPrimaryAdmin) return false;
  if (accessStatus && accessStatus !== 'approved') return false;
  return !myLinkedStaff;
}
