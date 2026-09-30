const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const whatsAppService = require('../src/services/whatsAppService');
const smsService = require('../src/services/smsService');
const { authHeader } = require('./testHelpers');

describe('Batch Chaser & Purchase Order API', () => {
  // The RFQs these flows act on are created explicitly rather than relying on
  // a fixed, seeded id/number — storeService starts with no RFQs at all.
  let chaserRfqId;
  let poRfqNumber;

  beforeAll(() => {
    // The vendors are created here too. storeService starts completely empty, so
    // `getVendors().slice(0, 2)` used to return the seeded roster and now returns
    // nothing — and triggerBatchChaser refuses an RFQ with nobody assigned rather
    // than falling back to the first few vendors in the directory, which is what
    // used to make it chase suppliers that were never invited.
    const outreachVendors = [
      storeService.addVendor({
        name: 'Chaser Target One',
        email: 'one@chaser-target.test',
        phone: '9000000001',
        majorCategory: 'Engineering Spares - Mechanical',
      }),
      storeService.addVendor({
        name: 'Chaser Target Two',
        email: 'two@chaser-target.test',
        phone: '9000000002',
        majorCategory: 'Engineering Spares - Mechanical',
      }),
    ];

    chaserRfqId = storeService.createRFQ({
      title: 'RFQ under multi-channel outreach',
      category: 'Engineering Spares - Mechanical',
      assignedVendors: outreachVendors,
    }).id;
    poRfqNumber = storeService.createRFQ({
      title: 'RFQ pending purchase order approval',
      category: 'Engineering Spares - Mechanical',
    }).rfqNumber;
  });

  beforeEach(() => {
    // Clear throttle caches so chaser calls are not blocked by prior test runs
    whatsAppService.clearWhatsAppThrottleCache();
    smsService.clearSmsThrottleCache();
  });

  test('POST /api/rfqs/:id/batch-chaser triggers multi-channel chasers', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${chaserRfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send({ channels: ['call', 'whatsapp', 'sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('triggerBatchChaser invokes WhatsApp and SMS senders for vendors with phones', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    const rfq = storeService.getRFQById(chaserRfqId);
    storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

    // Allow fire-and-forget promises to settle
    await new Promise((r) => setTimeout(r, 10));

    const vendorsWithPhone = (rfq.assignedVendors || []).filter((v) => v.phone);
    expect(waSpy).toHaveBeenCalledTimes(vendorsWithPhone.length);
    expect(smsSpy).toHaveBeenCalledTimes(vendorsWithPhone.length);

    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  test('triggerBatchChaser skips WhatsApp/SMS when channels list excludes them', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    storeService.triggerBatchChaser(chaserRfqId, ['call']);

    await new Promise((r) => setTimeout(r, 10));

    expect(waSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();

    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  test('triggerBatchChaser skips vendors without a phone number', async () => {
    const nophoneVendor = storeService.addVendor({
      name: 'No Phone Vendor',
      email: 'nophone@chaser-target.test',
      majorCategory: 'Isolated-NoPhone-Category-XYZ',
      // phone intentionally omitted — should not trigger WA/SMS
    });
    const noPhoneRfqId = storeService.createRFQ({
      title: 'No-phone chaser RFQ',
      // Use a unique category so no other vendor (with phones) matches this RFQ
      category: 'Isolated-NoPhone-Category-XYZ',
      assignedVendors: [nophoneVendor],
    }).id;

    // Install spies BEFORE the call, then clear any prior bleed from earlier
    // fire-and-forget timers that may still be settling.
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    // Wait for any background promises from createRFQ/earlier tests to drain, then clear.
    await new Promise((r) => setTimeout(r, 100));
    waSpy.mockClear();
    smsSpy.mockClear();

    storeService.triggerBatchChaser(noPhoneRfqId, ['whatsapp', 'sms']);
    await new Promise((r) => setTimeout(r, 50));

    // The single assigned vendor has no phone — both senders must stay silent.
    expect(waSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();

    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  test('POST /api/rfqs/:id/batch-chaser returns 404 for invalid RFQ', async () => {
    const res = await request(app)
      .post('/api/rfqs/invalid-rfq-id/batch-chaser')
      .set(authHeader('buyer'))
      .send({});
    expect(res.statusCode).toBe(404);
  });

  test('POST /api/rfqs/:id/batch-chaser requires authentication', async () => {
    const res = await request(app).post(`/api/rfqs/${chaserRfqId}/batch-chaser`).send({});
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/rfqs/:id/approve-po approves and seals PO with SHA-256', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${poRfqNumber}/approve-po`)
      .set(authHeader('buyer'))
      .send({
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        totalAmount: 52000,
        approverNotes: 'Compliant OEM specification and optimal lead time.',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.poNumber).toBeDefined();
    expect(res.body.shaSignature).toBeDefined();
  });

  test('POST /api/rfqs/:id/approve-po returns 400 for missing fields', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${poRfqNumber}/approve-po`)
      .set(authHeader('buyer'))
      .send({});
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/rfqs/:id/approve-po requires authentication', async () => {
    const res = await request(app).post(`/api/rfqs/${poRfqNumber}/approve-po`).send({});
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/rfqs/:id/approve-po returns 403 for a vendor (only buyer-side roles award a PO)', async () => {
    const res = await request(app)
      .post('/api/rfqs/RFQ-2026-0891/approve-po')
      .set(authHeader('vendor'))
      .send({ vendorName: 'Apex', totalAmount: 1000 });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/rfqs/:id/approve-po returns 404 for an invalid RFQ id', async () => {
    const res = await request(app)
      .post('/api/rfqs/nonexistent-rfq/approve-po')
      .set(authHeader('buyer'))
      .send({ vendorName: 'Apex', totalAmount: 1000 });
    expect(res.statusCode).toBe(404);
  });
});
