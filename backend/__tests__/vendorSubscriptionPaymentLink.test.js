jest.mock('../src/services/zohoPaymentService');

const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const { authHeader, TEST_USERS } = require('./testHelpers');

describe('POST /api/vendors/:id/payment-link', () => {
  let vendor;

  beforeEach(() => {
    jest.clearAllMocks();
    vendor = storeService.addVendor({
      name: 'Payment Link Test Vendor',
      email: TEST_USERS.vendor.email,
      phone: '9876543210',
      majorCategory: 'Payment-Link-Cat',
    });
  });

  test('requires a session', async () => {
    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).send({ plan: 'connect' });
    expect(res.statusCode).toBe(401);
  });

  test('a buyer cannot create a payment link for someone else\'s vendor profile', async () => {
    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('buyer')).send({ plan: 'connect' });
    expect(res.statusCode).toBe(403);
  });

  test('another vendor cannot create a payment link for this vendor profile', async () => {
    const otherVendorToken = require('../src/services/authService').generateSessionToken({
      id: 'usr-other-vendor',
      email: 'someone-else@vendor.test',
      name: 'Other Vendor',
      role: 'vendor',
      orgId: 'o',
      orgName: 'O',
    });
    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/payment-link`)
      .set({ Authorization: `Bearer ${otherVendorToken}` })
      .send({ plan: 'connect' });
    expect(res.statusCode).toBe(403);
  });

  test('an admin may create a payment link on behalf of any vendor', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-admin-1',
      paymentUrl: 'https://payments.zoho.in/admin',
      status: 'CREATED',
      rawResponse: {},
    });
    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('admin')).send({ plan: 'connect' });
    expect(res.statusCode).toBe(200);
  });

  test('404s for an unknown vendor', async () => {
    const res = await request(app).post('/api/vendors/does-not-exist/payment-link').set(authHeader('vendor')).send({ plan: 'connect' });
    expect(res.statusCode).toBe(404);
  });

  test('rejects premium — it is free and never reaches Zoho', async () => {
    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('vendor')).send({ plan: 'premium' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/plan must be one of/i);
  });

  test('rejects an unrecognized plan', async () => {
    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('vendor')).send({ plan: 'ultimate' });
    expect(res.statusCode).toBe(400);
  });

  test('400s when the vendor has no email on file', async () => {
    const noEmailVendor = storeService.addVendor({ name: 'No Email Vendor', email: '', majorCategory: 'Payment-Link-Cat' });
    const token = require('../src/services/authService').generateSessionToken({
      id: 'usr-no-email-vendor',
      email: '',
      name: 'No Email',
      role: 'admin',
      orgId: 'o',
      orgName: 'O',
    });
    const res = await request(app)
      .post(`/api/vendors/${noEmailVendor.id}/payment-link`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ plan: 'connect' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/no email on file/i);
  });

  test('creates a real payment link, persists it, and returns the redirect URL', async () => {
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-happy-1',
      paymentUrl: 'https://payments.zoho.in/happy',
      status: 'CREATED',
      rawResponse: { payment_links: {} },
    });

    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('vendor')).send({ plan: 'connect' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { paymentUrl: 'https://payments.zoho.in/happy', paymentLinkId: expect.any(String), status: 'CREATED' },
    });
    expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'connect', email: vendor.email, phone: '+919876543210' })
    );
    await expect(storeService.getPaymentLinkByZohoId('zoho-happy-1')).resolves.toMatchObject({ vendorId: vendor.id, planId: 'connect' });
  });

  test('normalizes a bare-digit legacy phone to E.164 before calling Zoho', async () => {
    const legacyVendor = storeService.addVendor({
      name: 'Legacy Bulk Vendor',
      email: 'legacy-vendor@example.com',
      phone: '9974814444',
      majorCategory: 'Payment-Link-Cat',
    });
    const token = require('../src/services/authService').generateSessionToken({
      id: 'usr-legacy-vendor',
      email: 'legacy-vendor@example.com',
      name: 'Legacy Vendor',
      role: 'vendor',
      orgId: 'o',
      orgName: 'O',
    });
    zohoPaymentService.createPaymentLink.mockResolvedValue({
      zohoPaymentLinkId: 'zoho-legacy-1',
      paymentUrl: 'https://payments.zoho.in/legacy',
      status: 'CREATED',
      rawResponse: { payment_links: {} },
    });

    const res = await request(app)
      .post(`/api/vendors/${legacyVendor.id}/payment-link`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ plan: 'connect' });

    expect(res.statusCode).toBe(200);
    expect(zohoPaymentService.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+919974814444' })
    );
  });

  test('returns 502 when Zoho payment-link creation throws', async () => {
    zohoPaymentService.createPaymentLink.mockRejectedValue(new Error('Zoho OAuth token refresh failed (401): invalid_client'));

    const res = await request(app).post(`/api/vendors/${vendor.id}/payment-link`).set(authHeader('vendor')).send({ plan: 'select' });

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/vendors/:id/payment-links and invoice download', () => {
  let vendor;

  beforeEach(() => {
    jest.clearAllMocks();
    vendor = storeService.addVendor({
      name: 'Billing History Test Vendor',
      email: TEST_USERS.vendor.email,
      phone: '9876543210',
      majorCategory: 'Payment-Link-Cat',
    });
  });

  test('requires a session', async () => {
    const res = await request(app).get(`/api/vendors/${vendor.id}/payment-links`);
    expect(res.statusCode).toBe(401);
  });

  test('a buyer cannot list another vendor\'s billing history', async () => {
    const res = await request(app).get(`/api/vendors/${vendor.id}/payment-links`).set(authHeader('buyer'));
    expect(res.statusCode).toBe(403);
  });

  test('lists only this vendor\'s own payment links, newest first', async () => {
    storeService.createPaymentLinkRecord({
      id: 'pl-hist-1',
      zohoPaymentLinkId: 'zoho-hist-1',
      vendorId: vendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'active',
    });
    storeService.createPaymentLinkRecord({
      id: 'pl-hist-2',
      zohoPaymentLinkId: 'zoho-hist-2',
      vendorId: vendor.id,
      planId: 'select',
      amount: 5.9,
      paymentUrl: 'https://payments.zoho.in/2',
      status: 'paid',
    });
    // A different vendor's link must never appear in this vendor's history.
    const otherVendor = storeService.addVendor({ name: 'Other Vendor', email: 'other-billing@vendor.test', majorCategory: 'X' });
    storeService.createPaymentLinkRecord({
      id: 'pl-hist-other',
      zohoPaymentLinkId: 'zoho-hist-other',
      vendorId: otherVendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/3',
      status: 'active',
    });

    const res = await request(app).get(`/api/vendors/${vendor.id}/payment-links`).set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((l) => l.id)).toEqual(['pl-hist-2', 'pl-hist-1']);
  });

  test('404s for an unknown vendor', async () => {
    const res = await request(app).get('/api/vendors/does-not-exist/payment-links').set(authHeader('vendor'));
    expect(res.statusCode).toBe(404);
  });

  test('downloads a real PDF receipt for one of this vendor\'s own payments', async () => {
    const link = storeService.createPaymentLinkRecord({
      id: 'pl-invoice-1',
      zohoPaymentLinkId: 'zoho-invoice-1',
      vendorId: vendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/${link.id}/invoice`)
      .set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`receipt-${link.id}.pdf`);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  test('404s for a payment link that belongs to a different vendor', async () => {
    const otherVendor = storeService.addVendor({ name: 'Other Vendor 2', email: 'other-billing-2@vendor.test', majorCategory: 'X' });
    const otherLink = storeService.createPaymentLinkRecord({
      id: 'pl-not-mine',
      zohoPaymentLinkId: 'zoho-not-mine',
      vendorId: otherVendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/${otherLink.id}/invoice`)
      .set(authHeader('vendor'));

    expect(res.statusCode).toBe(404);
  });

  test('404s for an unknown payment link id', async () => {
    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/does-not-exist/invoice`)
      .set(authHeader('vendor'));
    expect(res.statusCode).toBe(404);
  });

  test('404s downloading an invoice for an unknown vendor', async () => {
    const res = await request(app)
      .get('/api/vendors/does-not-exist/payment-links/pl-whatever/invoice')
      .set(authHeader('vendor'));
    expect(res.statusCode).toBe(404);
  });

  test('a buyer cannot download another vendor\'s invoice', async () => {
    const link = storeService.createPaymentLinkRecord({
      id: 'pl-invoice-forbidden',
      zohoPaymentLinkId: 'zoho-invoice-forbidden',
      vendorId: vendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/${link.id}/invoice`)
      .set(authHeader('buyer'));

    expect(res.statusCode).toBe(403);
  });

  test('returns 500 when fetching billing history throws', async () => {
    jest.spyOn(storeService, 'getPaymentLinksForVendor').mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await request(app).get(`/api/vendors/${vendor.id}/payment-links`).set(authHeader('vendor'));

    expect(res.statusCode).toBe(500);
  });

  test('falls back to email and raw planId when the vendor has no name / the plan is unrecognized', async () => {
    storeService.updateVendor(vendor.id, { name: '' });
    const link = storeService.createPaymentLinkRecord({
      id: 'pl-invoice-fallback',
      zohoPaymentLinkId: 'zoho-invoice-fallback',
      vendorId: vendor.id,
      planId: 'not-a-real-plan-id',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/${link.id}/invoice`)
      .set(authHeader('vendor'));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  test('returns 500 when generating the invoice PDF throws', async () => {
    const link = storeService.createPaymentLinkRecord({
      id: 'pl-invoice-error',
      zohoPaymentLinkId: 'zoho-invoice-error',
      vendorId: vendor.id,
      planId: 'connect',
      amount: 2.36,
      paymentUrl: 'https://payments.zoho.in/1',
      status: 'paid',
    });
    jest.spyOn(storeService, 'getPaymentLinkById').mockRejectedValueOnce(new Error('DB unavailable'));

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}/payment-links/${link.id}/invoice`)
      .set(authHeader('vendor'));

    expect(res.statusCode).toBe(500);
  });
});
