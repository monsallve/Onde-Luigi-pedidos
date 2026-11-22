import test from 'node:test';
import assert from 'node:assert/strict';
import type { StaffMember } from '../types/pos';
import {
  ALL_STAFF_ROLES,
  getRolePermissions,
  isTabAllowedForRole,
  resolveEffectiveRole,
} from './rolePermissions';

const linkedCashier: StaffMember = {
  id: 'staff_cajero',
  name: 'Laura Caja',
  role: 'cajero',
  active: true,
  linkedUid: 'uid_cajero',
  linkedEmail: 'caja@ondeluigi.com',
  ownerUid: 'uid_owner',
  createdByUid: 'uid_owner',
  allowedEmails: ['caja@ondeluigi.com'],
  createdAtMs: 1000,
  updatedAtMs: 1000,
};

const linkedKitchen: StaffMember = {
  ...linkedCashier,
  id: 'staff_cocina',
  name: 'Carlos Plancha',
  role: 'cocina',
  linkedUid: 'uid_cocina',
  linkedEmail: 'cocina@ondeluigi.com',
};

test('getRolePermissions enforces strict capability boundaries across all 4 roles', () => {
  const admin = getRolePermissions('admin');
  assert.deepEqual(admin.allowedTabs, [
    'pedidos',
    'comandas',
    'historial',
    'transferencias',
    'ventas',
    'menu',
  ]);
  assert.equal(admin.canViewSales, true);
  assert.equal(admin.canManageMenu, true);
  assert.equal(admin.canHardDelete, true);
  assert.equal(admin.canManageTeam, true);

  const mesero = getRolePermissions('mesero');
  assert.deepEqual(mesero.allowedTabs, ['pedidos', 'comandas', 'historial', 'transferencias']);
  assert.equal(mesero.canTakeOrders, true);
  assert.equal(mesero.canDeliverOrders, true);
  assert.equal(mesero.canManagePayments, true);
  assert.equal(mesero.canVoidOrders, true);
  assert.equal(mesero.canViewSales, false);
  assert.equal(mesero.canManageMenu, false);
  assert.equal(mesero.canHardDelete, false);
  assert.equal(mesero.canManageTeam, false);

  const cajero = getRolePermissions('cajero');
  assert.deepEqual(cajero.allowedTabs, ['pedidos', 'comandas', 'historial', 'transferencias']);
  assert.equal(cajero.defaultTab, 'comandas');
  assert.equal(cajero.canManagePayments, true);
  assert.equal(cajero.canDeliverOrders, true);
  assert.equal(cajero.canAdvanceKitchen, false);
  assert.equal(cajero.canViewSales, false);
  assert.equal(cajero.canManageMenu, false);
  assert.equal(cajero.canHardDelete, false);

  const cocina = getRolePermissions('cocina');
  assert.deepEqual(cocina.allowedTabs, ['comandas']);
  assert.equal(cocina.defaultTab, 'comandas');
  assert.equal(cocina.canAdvanceKitchen, true);
  assert.equal(cocina.canDeliverOrders, false);
  assert.equal(cocina.canTakeOrders, false);
  assert.equal(cocina.canEditOrders, false);
  assert.equal(cocina.canManagePayments, false);
  assert.equal(cocina.canVoidOrders, false);
  assert.equal(cocina.canViewHistory, false);
  assert.equal(cocina.canViewTransfers, false);
  assert.equal(cocina.canViewSales, false);
  assert.equal(cocina.canManageMenu, false);
  assert.equal(cocina.canHardDelete, false);
});

test('resolveEffectiveRole lets ONLY primary admin preview any role while locking real users to assigned role', () => {
  for (const previewRole of ALL_STAFF_ROLES) {
    assert.equal(
      resolveEffectiveRole({
        sessionMode: 'cloud',
        isRealPrimaryAdmin: true,
        previewRole,
        demoAccountRole: 'admin',
        cloudMemberRole: 'admin',
        myLinkedStaff: null,
      }),
      previewRole
    );
  }

  // Non-primary real cloud user ignores previewRole and gets permanent linked staff role
  assert.equal(
    resolveEffectiveRole({
      sessionMode: 'cloud',
      isRealPrimaryAdmin: false,
      previewRole: 'admin',
      demoAccountRole: 'admin',
      cloudMemberRole: 'mesero',
      myLinkedStaff: linkedCashier,
    }),
    'cajero'
  );

  assert.equal(
    resolveEffectiveRole({
      sessionMode: 'cloud',
      isRealPrimaryAdmin: false,
      previewRole: 'admin',
      demoAccountRole: 'admin',
      cloudMemberRole: 'mesero',
      myLinkedStaff: linkedKitchen,
    }),
    'cocina'
  );
});

test('isTabAllowedForRole blocks restricted routes per role', () => {
  assert.equal(isTabAllowedForRole('cocina', 'pedidos'), false);
  assert.equal(isTabAllowedForRole('cocina', 'ventas'), false);
  assert.equal(isTabAllowedForRole('cocina', 'comandas'), true);
  assert.equal(isTabAllowedForRole('cajero', 'ventas'), false);
  assert.equal(isTabAllowedForRole('cajero', 'menu'), false);
  assert.equal(isTabAllowedForRole('mesero', 'menu'), false);
  assert.equal(isTabAllowedForRole('admin', 'menu'), true);
});
