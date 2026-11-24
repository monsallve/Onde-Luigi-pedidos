import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerDocId,
  buildReceiptFilename,
  buildReceiptNumber,
  DEFAULT_CUSTOMER_DOCUMENT,
  DEFAULT_CUSTOMER_NAME,
  isDefaultFinalConsumer,
  normalizeBillingConfig,
  normalizeCustomerDocument,
  normalizeCustomerName,
  resolveOrderCustomerInfo,
} from './billingUtils';

test('defaults customer document and name to 222222222 Consumidor Final when blank', () => {
  assert.equal(normalizeCustomerDocument(''), DEFAULT_CUSTOMER_DOCUMENT);
  assert.equal(normalizeCustomerDocument('   '), '222222222');
  assert.equal(normalizeCustomerName('', ''), DEFAULT_CUSTOMER_NAME);
  assert.equal(isDefaultFinalConsumer('222222222'), true);
  assert.equal(isDefaultFinalConsumer('222.222.222'), true);
  assert.equal(isDefaultFinalConsumer('1020304050'), false);

  assert.deepEqual(resolveOrderCustomerInfo({}), {
    documentNumber: '222222222',
    name: 'Consumidor Final',
    phone: '',
    email: '',
  });
});

test('preserves custom customer NIT/Cédula and builds deterministic customer IDs', () => {
  assert.equal(normalizeCustomerDocument(' 900.123.456-7 '), '900.123.456-7');
  assert.equal(normalizeCustomerName('Restaurante El Paso', '900123456'), 'Restaurante El Paso');
  assert.equal(buildCustomerDocId('1020.304.050'), 'cust_1020304050');
  assert.deepEqual(
    resolveOrderCustomerInfo({
      customerDocument: '1098765432',
      customerName: 'Ana Gómez',
      customerPhone: '3001234567',
      customerEmail: 'ana@correo.com',
    }),
    {
      documentNumber: '1098765432',
      name: 'Ana Gómez',
      phone: '3001234567',
      email: 'ana@correo.com',
    }
  );
});

test('normalizes business billing configuration and formats receipt numbers and PDF filenames', () => {
  const cfg = normalizeBillingConfig({
    businessName: "  O'NDE LUIGI BURGER ",
    nit: ' 901.555.222-3 ',
    receiptPrefix: 'ol-pos',
  });
  assert.equal(cfg.businessName, "O'NDE LUIGI BURGER");
  assert.equal(cfg.nit, '901.555.222-3');
  assert.equal(cfg.receiptPrefix, 'OL-POS');
  assert.equal(buildReceiptNumber({ orderNumber: 105 }, cfg), 'OL-POS-0105');
  assert.equal(buildReceiptFilename({ orderNumber: 105 }, cfg), 'Colilla_OL-POS-0105.pdf');
});
