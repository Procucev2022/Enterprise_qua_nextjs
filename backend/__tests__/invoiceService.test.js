const { generateReceiptPdf } = require('../src/services/invoiceService');

describe('invoiceService.generateReceiptPdf', () => {
  test('returns a non-empty PDF buffer starting with the %PDF magic bytes', async () => {
    const link = {
      id: 'pl-test-1',
      zohoPaymentLinkId: 'zoho-1',
      planId: 'connect',
      amount: 2.36,
      status: 'paid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const pdf = await generateReceiptPdf({
      link,
      payerName: 'Test Vendor Co',
      payerEmail: 'vendor@example.com',
      planLabel: 'Connect Model (Marketplace Expansion)',
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  test('falls back gracefully when amount and status are missing', async () => {
    const link = {
      id: 'pl-test-3',
      zohoPaymentLinkId: 'zoho-3',
      planId: 'select',
      amount: undefined,
      status: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const pdf = await generateReceiptPdf({ link, payerName: 'Test Co', payerEmail: 'a@b.com', planLabel: 'Select' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  test('does not throw when payerName/payerEmail are missing', async () => {
    const link = {
      id: 'pl-test-2',
      zohoPaymentLinkId: null,
      planId: 'version_1',
      amount: 2,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    const pdf = await generateReceiptPdf({ link });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
