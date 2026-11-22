import test from 'node:test';
import assert from 'node:assert/strict';
import type { StaffMember } from '../types/pos';
import {
  findLinkedStaffMember,
  isStartupIdentityReady,
  resolveActiveWaiter,
  shouldPromptPermanentRegistration,
} from './identityState';

const baseStaff: StaffMember[] = [
  {
    id: 'staff_owner',
    name: 'Luigi Admin',
    role: 'admin',
    active: true,
    linkedUid: 'uid_owner',
    linkedEmail: 'perrodog1515@gmail.com',
    ownerUid: 'uid_owner',
    createdByUid: 'uid_owner',
    allowedEmails: ['perrodog1515@gmail.com'],
    createdAtMs: 1000,
    updatedAtMs: 1000,
  },
  {
    id: 'staff_waiter_1',
    name: 'Gabriela Cárdenas',
    role: 'mesero',
    active: true,
    linkedUid: 'uid_gaby',
    linkedEmail: 'gabrielacardenas2517@gmail.com',
    ownerUid: 'uid_owner',
    createdByUid: 'uid_gaby',
    allowedEmails: ['gabrielacardenas2517@gmail.com'],
    createdAtMs: 2000,
    updatedAtMs: 2000,
  },
  {
    id: 'staff_admin_2',
    name: 'Carla Admin',
    role: 'admin',
    active: true,
    linkedUid: 'uid_carla',
    linkedEmail: 'carla@ondeluigi.com',
    ownerUid: 'uid_owner',
    createdByUid: 'uid_owner',
    allowedEmails: ['carla@ondeluigi.com'],
    createdAtMs: 3000,
    updatedAtMs: 3000,
  },
];

test('isStartupIdentityReady stays false during cold cloud load until workspace and staff are verified', () => {
  assert.equal(
    isStartupIdentityReady({
      authReady: true,
      sessionMode: 'cloud',
      cloudError: null,
      firebaseUid: 'uid_gaby',
      cloudReadyForUid: null,
      staffLoaded: false,
      loadingData: true,
    }),
    false
  );

  // Even if another collection resolved early, staffLoaded=false must block readiness
  assert.equal(
    isStartupIdentityReady({
      authReady: true,
      sessionMode: 'cloud',
      cloudError: null,
      firebaseUid: 'uid_gaby',
      cloudReadyForUid: 'uid_gaby',
      staffLoaded: false,
      loadingData: true,
    }),
    false
  );

  // Once workspace, staff snapshot, and initial data are ready, returns true
  assert.equal(
    isStartupIdentityReady({
      authReady: true,
      sessionMode: 'cloud',
      cloudError: null,
      firebaseUid: 'uid_gaby',
      cloudReadyForUid: 'uid_gaby',
      staffLoaded: true,
      loadingData: false,
    }),
    true
  );

  // Errors never trap the user on the loading spinner
  assert.equal(
    isStartupIdentityReady({
      authReady: true,
      sessionMode: 'cloud',
      cloudError: 'Cuenta desactivada',
      firebaseUid: 'uid_gaby',
      cloudReadyForUid: null,
      staffLoaded: false,
      loadingData: false,
    }),
    true
  );
});

test('shouldPromptPermanentRegistration never triggers before identityReady or when linked staff exists', () => {
  // Cold start while loading: must NOT prompt!
  assert.equal(
    shouldPromptPermanentRegistration({
      sessionMode: 'cloud',
      identityReady: false,
      loadingData: true,
      cloudError: null,
      isPrimaryAdmin: false,
      myLinkedStaff: null,
    }),
    false
  );

  // Registered user once staff loaded: must NOT prompt!
  assert.equal(
    shouldPromptPermanentRegistration({
      sessionMode: 'cloud',
      identityReady: true,
      loadingData: false,
      cloudError: null,
      isPrimaryAdmin: false,
      myLinkedStaff: baseStaff[1],
    }),
    false
  );

  // Brand-new unregistered user after cloud identity verified: prompts once!
  assert.equal(
    shouldPromptPermanentRegistration({
      sessionMode: 'cloud',
      identityReady: true,
      loadingData: false,
      cloudError: null,
      isPrimaryAdmin: false,
      myLinkedStaff: null,
    }),
    true
  );
});

test('findLinkedStaffMember and resolveActiveWaiter lock non-primary users strictly to their permanent profile', () => {
  const gaby = findLinkedStaffMember(baseStaff, 'uid_gaby', 'GABRIELACARDENAS2517@gmail.com');
  assert.equal(gaby?.id, 'staff_waiter_1');

  // Even if localStorage had stale activeWaiterId of someone else, non-primary resolves to own permanent staff
  const active = resolveActiveWaiter({
    isPrimaryAdmin: false,
    myLinkedStaff: gaby,
    staff: baseStaff,
    activeWaiterId: 'staff_admin_2',
  });
  assert.equal(active?.id, 'staff_waiter_1');
  assert.equal(active?.role, 'mesero');

  // Primary admin stays on own permanent profile even if stale activeWaiterId points to another user
  const primary = findLinkedStaffMember(baseStaff, 'uid_owner', 'perrodog1515@gmail.com');
  const activePrimary = resolveActiveWaiter({
    isPrimaryAdmin: true,
    myLinkedStaff: primary,
    staff: baseStaff,
    activeWaiterId: 'staff_waiter_1',
  });
  assert.equal(activePrimary?.id, 'staff_owner');
});
