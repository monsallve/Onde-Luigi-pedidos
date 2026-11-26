import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIsolatedAutoservicioUrl,
  buildPublicAutoservicioLink,
  extractSafeOrderIdFromUrl,
  isDisallowedPosOrAdminNavigation,
  isInsideAutoservicioPath,
  shouldPosRedirectToAutoservicio,
} from './autoservicioRouteGuard.ts';

test('identifies isolated autoservicio paths across root and subpath deployments', () => {
  assert.equal(isInsideAutoservicioPath('/autoservicio/'), true);
  assert.equal(isInsideAutoservicioPath('/autoservicio'), true);
  assert.equal(isInsideAutoservicioPath('/autoservicio/index.html'), true);
  assert.equal(isInsideAutoservicioPath('/Onde-Luigi-pedidos/autoservicio/'), true);
  assert.equal(isInsideAutoservicioPath('/'), false);
  assert.equal(isInsideAutoservicioPath('/admin/pagos'), false);
  assert.equal(isInsideAutoservicioPath('/comandas'), false);
});

test('redirects legacy ?autoservicio=1 and #/autoservicio links from POS root to isolated PWA', () => {
  assert.equal(
    shouldPosRedirectToAutoservicio({ pathname: '/', search: '?autoservicio=1', hash: '' }),
    true
  );
  assert.equal(
    shouldPosRedirectToAutoservicio({
      pathname: '/',
      search: '?autoservicio=1&pedido=self_123_ab',
      hash: '',
    }),
    true
  );
  assert.equal(
    shouldPosRedirectToAutoservicio({ pathname: '/', search: '', hash: '#/autoservicio' }),
    true
  );
  assert.equal(
    shouldPosRedirectToAutoservicio({ pathname: '/', search: '', hash: '' }),
    false
  );
  assert.equal(
    shouldPosRedirectToAutoservicio({ pathname: '/admin/pagos', search: '', hash: '' }),
    false
  );
});

test('flags any POS, admin, or internal tab navigation attempts inside Autoservicio PWA', () => {
  assert.equal(
    isDisallowedPosOrAdminNavigation({ pathname: '/autoservicio/', search: '', hash: '' }),
    false
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({
      pathname: '/autoservicio/',
      search: '?pedido=self_170000_abcd1234',
      hash: '',
    }),
    false
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({ pathname: '/', search: '', hash: '' }),
    true
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({ pathname: '/admin/pagos', search: '', hash: '' }),
    true
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({
      pathname: '/autoservicio',
      search: '',
      hash: '',
    }),
    true
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({
      pathname: '/autoservicio/',
      search: '?tab=datos_pago',
      hash: '',
    }),
    true
  );
  assert.equal(
    isDisallowedPosOrAdminNavigation({
      pathname: '/autoservicio/',
      search: '',
      hash: '#/admin/pagos',
    }),
    true
  );
});

test('sanitizes isolated Autoservicio URL preserving valid pedido tracking id and stripping POS params', () => {
  assert.equal(
    buildIsolatedAutoservicioUrl(
      'https://example.com/admin/pagos?tab=datos_pago&pedido=self_123_abc#/admin',
      '/autoservicio/'
    ),
    '/autoservicio/?pedido=self_123_abc'
  );
  assert.equal(
    buildIsolatedAutoservicioUrl(
      'https://example.com/?autoservicio=1&pedido=bad/id/../x',
      '/autoservicio/'
    ),
    '/autoservicio/'
  );
  assert.equal(
    extractSafeOrderIdFromUrl({ search: '?pedido=self_999_a1b2', hash: '' }),
    'self_999_a1b2'
  );
  assert.equal(
    extractSafeOrderIdFromUrl({ search: '?pedido=<script>', hash: '' }),
    undefined
  );
});

test('builds clean shareable public Autoservicio PWA links from POS routes', () => {
  assert.equal(
    buildPublicAutoservicioLink('https://pos.ondeluigi.com/'),
    'https://pos.ondeluigi.com/autoservicio/'
  );
  assert.equal(
    buildPublicAutoservicioLink('https://pos.ondeluigi.com/admin/pagos'),
    'https://pos.ondeluigi.com/autoservicio/'
  );
  assert.equal(
    buildPublicAutoservicioLink('https://monsallve.github.io/Onde-Luigi-pedidos/', 'self_1_abc'),
    'https://monsallve.github.io/Onde-Luigi-pedidos/autoservicio/?pedido=self_1_abc'
  );
});
