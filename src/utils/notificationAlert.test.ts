import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemNotificationOptions,
  shouldDispatchSystemNotification,
  shouldOfferPermissionPrompt,
} from './notificationAlert';
import type { WorkspaceNotification } from '../types/pos';

const sampleNotif: WorkspaceNotification = {
  id: 'notif_1',
  type: 'nueva_comanda',
  title: 'Nueva comanda #108',
  message: 'Laura registró Mesa 4 ($42.000)',
  orderId: 'ord_108',
  orderNumber: 108,
  shiftId: '',
  actorName: 'Laura',
  actorUid: 'u1',
  ownerUid: 'owner',
  createdByUid: 'u1',
  allowedEmails: [],
  createdAtMs: 1_700_000_000_000,
};

test('shouldOfferPermissionPrompt only returns true when state is default and not dismissed', () => {
  assert.equal(shouldOfferPermissionPrompt('default', false), true);
  assert.equal(shouldOfferPermissionPrompt('default', true), false);
  assert.equal(shouldOfferPermissionPrompt('granted', false), false);
  assert.equal(shouldOfferPermissionPrompt('denied', false), false);
  assert.equal(shouldOfferPermissionPrompt('unsupported', false), false);
});

test('shouldDispatchSystemNotification dispatches when granted and backgrounded, unfocused, or forced', () => {
  assert.equal(
    shouldDispatchSystemNotification({
      permission: 'default',
      hidden: true,
      hasFocus: false,
      forceOsNotification: true,
    }),
    false
  );
  assert.equal(
    shouldDispatchSystemNotification({
      permission: 'granted',
      hidden: false,
      hasFocus: true,
      forceOsNotification: false,
    }),
    false
  );
  assert.equal(
    shouldDispatchSystemNotification({
      permission: 'granted',
      hidden: true,
      hasFocus: true,
    }),
    true
  );
  assert.equal(
    shouldDispatchSystemNotification({
      permission: 'granted',
      hidden: false,
      hasFocus: false,
    }),
    true
  );
  assert.equal(
    shouldDispatchSystemNotification({
      permission: 'granted',
      hidden: false,
      hasFocus: true,
      forceOsNotification: true,
    }),
    true
  );
});

test('buildSystemNotificationOptions sets sound enabled, vibration, icon, and deep-link metadata', () => {
  const opts = buildSystemNotificationOptions(sampleNotif);
  assert.equal(opts.body, 'Laura registró Mesa 4 ($42.000)');
  assert.equal(opts.silent, false);
  assert.equal(opts.renotify, true);
  assert.equal(opts.requireInteraction, true);
  assert.equal(opts.data.type, 'nueva_comanda');
  assert.equal(opts.data.orderId, 'ord_108');
  assert.ok(opts.icon.includes('pwa-192x192.png'));

  const shiftOpts = buildSystemNotificationOptions({
    ...sampleNotif,
    id: 'notif_2',
    type: 'turno_abierto',
    orderId: '',
    orderNumber: 0,
  });
  assert.equal(shiftOpts.requireInteraction, false);

  const accessOpts = buildSystemNotificationOptions({
    ...sampleNotif,
    id: 'notif_3',
    type: 'solicitud_acceso',
    title: 'Nueva solicitud de acceso al POS',
    message: 'Carlos espera aprobación y asignación de rol.',
    orderId: '',
    orderNumber: 0,
  });
  assert.equal(accessOpts.data.type, 'solicitud_acceso');
  assert.equal(accessOpts.requireInteraction, false);
});
