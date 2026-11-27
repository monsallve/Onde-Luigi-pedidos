import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRegisterStaffBackgroundPush,
  computePushSubId,
  detectPushPlatform,
} from './pushEligibility';
import type { StaffMember } from '../types/pos';

const activeWaiter: StaffMember = {
  id: 'staff_u1',
  name: 'Carlos Mesero',
  role: 'mesero',
  active: true,
  linkedUid: 'uid_1',
  linkedEmail: 'carlos@ondeluigi.com',
  ownerUid: 'owner_1',
  createdByUid: 'owner_1',
  allowedEmails: ['carlos@ondeluigi.com'],
  createdAtMs: 1000,
  updatedAtMs: 1000,
};

test('canRegisterStaffBackgroundPush strictly requires approved accessStatus, active staff, valid role, permission, and VAPID', () => {
  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'pending',
      firebaseUid: 'uid_1',
      staffProfile: activeWaiter,
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'rejected',
      firebaseUid: 'uid_1',
      staffProfile: activeWaiter,
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'deactivated',
      firebaseUid: 'uid_1',
      staffProfile: activeWaiter,
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'approved',
      firebaseUid: '',
      staffProfile: activeWaiter,
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'approved',
      firebaseUid: 'uid_1',
      staffProfile: null,
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'approved',
      firebaseUid: 'uid_1',
      staffProfile: { ...activeWaiter, active: false },
      effectiveRole: 'mesero',
      notificationPermission: 'granted',
      hasVapidKey: true,
    }).eligible,
    false
  );

  assert.equal(
    canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'approved',
      firebaseUid: 'uid_1',
      staffProfile: activeWaiter,
      effectiveRole: 'mesero',
      notificationPermission: 'default',
      hasVapidKey: true,
    }).eligible,
    false
  );

  const missingVapid = canRegisterStaffBackgroundPush({
    isFirebaseConfigured: true,
    accessStatus: 'approved',
    firebaseUid: 'uid_1',
    staffProfile: activeWaiter,
    effectiveRole: 'mesero',
    notificationPermission: 'granted',
    hasVapidKey: false,
  });
  assert.equal(missingVapid.eligible, false);
  assert.equal(missingVapid.reason, 'missing_vapid');

  for (const role of ['admin', 'mesero', 'cajero', 'cocina'] as const) {
    const ok = canRegisterStaffBackgroundPush({
      isFirebaseConfigured: true,
      accessStatus: 'approved',
      firebaseUid: 'uid_1',
      staffProfile: { ...activeWaiter, role },
      effectiveRole: role,
      notificationPermission: 'granted',
      hasVapidKey: true,
    });
    assert.equal(ok.eligible, true);
    assert.equal(ok.reason, 'ok');
  }
});

test('computePushSubId produces Firestore-safe document IDs and detectPushPlatform classifies devices', () => {
  const id = computePushSubId('user.uid:123', 'dev-abc!');
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(detectPushPlatform('Mozilla/5.0 (Linux; Android 14)'), 'android');
  assert.equal(detectPushPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)'), 'ios');
  assert.equal(detectPushPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');
});
