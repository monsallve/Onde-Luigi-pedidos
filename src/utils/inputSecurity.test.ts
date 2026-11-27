import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeEmailInput,
  assertSafeTextInput,
  containsDangerousCodePattern,
  isSafeImageUrl,
  safeJsonParse,
  sanitizePlainText,
  sanitizeSafeUrl,
} from './inputSecurity';

test('detects script tags, event handlers, dangerous schemes, and template injection', () => {
  assert.equal(containsDangerousCodePattern('<script>alert(1)</script>'), true);
  assert.equal(containsDangerousCodePattern('<img src=x onerror=alert(1)>'), true);
  assert.equal(containsDangerousCodePattern('<svg onload="fetch(1)">'), true);
  assert.equal(containsDangerousCodePattern('javascript:alert(1)'), true);
  assert.equal(containsDangerousCodePattern('data:text/html,<script>1</script>'), true);
  assert.equal(containsDangerousCodePattern('data:image/svg+xml;base64,PHN2Zz4='), true);
  assert.equal(containsDangerousCodePattern('{{constructor.constructor("alert(1)")()}}'), true);
  assert.equal(containsDangerousCodePattern('${process.env.SECRET}'), true);
  assert.equal(containsDangerousCodePattern('eval("2+2")'), true);
  assert.equal(containsDangerousCodePattern('__proto__'), true);
});

test('allows normal restaurant business names, addresses, prices, and Spanish accents', () => {
  assert.equal(containsDangerousCodePattern("O'NDE LUIGI"), false);
  assert.equal(containsDangerousCodePattern('Calle 15 # 12-40 · Barrio Centro'), false);
  assert.equal(containsDangerousCodePattern('Combo Perro + Gaseosa $18.500 (sin cebolla)'), false);
  assert.equal(containsDangerousCodePattern('@ONDELUIGI · Bre-B / Nequi'), false);
  assert.equal(containsDangerousCodePattern('Gabriela Cárdenas — Mesa #4'), false);
  assert.equal(containsDangerousCodePattern('perrodog1515@gmail.com'), false);
});

test('assertSafeTextInput throws readable Spanish error on code injection and normalizes safe text', () => {
  assert.throws(
    () => assertSafeTextInput('<script>hack()</script>', 'Nombre'),
    /no permite etiquetas HTML, scripts ni código ejecutable/i
  );
  assert.equal(
    assertSafeTextInput("  O'NDE   LUIGI  ", 'Nombre', { maxLen: 80, required: true }),
    "O'NDE LUIGI"
  );
});

test('sanitizePlainText strips HTML tags and control characters cleanly', () => {
  assert.equal(
    sanitizePlainText('Hola <b>Mundo</b> <script>alert(1)</script>'),
    'Hola Mundo'
  );
  assert.equal(
    sanitizePlainText('Línea 1\n\nLínea 2', { allowNewlines: true }),
    'Línea 1\n\nLínea 2'
  );
});

test('validates safe URLs and blocks javascript/svg data URLs', () => {
  assert.equal(isSafeImageUrl('https://example.com/qr.png'), true);
  assert.equal(isSafeImageUrl('/onde-luigi-logo.png'), true);
  assert.equal(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeImageUrl('javascript:alert(1)'), false);
  assert.equal(isSafeImageUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(sanitizeSafeUrl('javascript:alert(1)'), '');
});

test('assertSafeEmailInput rejects malformed or script-laden emails', () => {
  assert.equal(assertSafeEmailInput('Staff.User@Gmail.com '), 'staff.user@gmail.com');
  assert.throws(() => assertSafeEmailInput('<script>@evil.com'));
  assert.throws(() => assertSafeEmailInput('not-an-email'));
});

test('safeJsonParse strips __proto__ keys to prevent prototype pollution', () => {
  const parsed = safeJsonParse<Record<string, unknown>>(
    '{"ok":true,"__proto__":{"polluted":true},"nested":{"constructor":{"bad":1}}}',
    {}
  );
  assert.equal(parsed.ok, true);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, '__proto__'), false);
});
