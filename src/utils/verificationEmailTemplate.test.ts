import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrandVerificationEmailHtml,
  EMAIL_VERIFICATION_COMPANY_NAME,
  EMAIL_VERIFICATION_SUBJECT,
} from './verificationEmailTemplate';

test('builds customized O\'NDE LUIGI verification email HTML with logo, company name, and recipient escaping', () => {
  const html = buildBrandVerificationEmailHtml({
    recipientName: 'Gabriela <Admin>',
    recipientEmail: 'gabriela@ondeluigi.com',
    logoUrl: 'https://monsallve.github.io/Onde-Luigi-pedidos/onde-luigi-logo.png',
    actionUrl: 'https://example.com/verify?oobCode=abc123',
  });

  assert.equal(EMAIL_VERIFICATION_COMPANY_NAME, "O'NDE LUIGI");
  assert.ok(EMAIL_VERIFICATION_SUBJECT.includes("O'NDE LUIGI"));
  assert.ok(html.includes('https://monsallve.github.io/Onde-Luigi-pedidos/onde-luigi-logo.png'));
  assert.ok(html.includes('verificación de correo electrónico para'));
  assert.ok(html.includes("O&#39;NDE LUIGI") || html.includes("O'NDE LUIGI"));
  assert.ok(html.includes('Gabriela &lt;Admin&gt;'));
  assert.ok(html.includes('https://example.com/verify?oobCode=abc123'));
});
