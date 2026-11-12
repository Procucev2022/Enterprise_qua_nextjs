const request = require('supertest');
const app = require('../src/app');
const rfqController = require('../src/controllers/rfqController');
const storeService = require('../src/services/storeService');
const whatsAppService = require('../src/services/whatsAppService');
const smsService = require('../src/services/smsService');
const { authHeader, TEST_USERS } = require('./testHelpers');
const { CHASER_OUTREACH_MESSAGES } = require('../src/config/constants');

describe('Batch Chaser & Purchase Order API', () => {
  // The RFQs these flows act on are created explicitly rather than relying on
  // a fixed, seeded id/number — storeService starts with no RFQs at all.
  let chaserRfqId;
  let poRfqNumber;
  // The buyer account the tests sign in as. RFQs the chaser tests act on are owned by it.
  let testBuyerAccount;

  beforeAll(async () => {
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

    // The buyer these tests sign in as owns the chaser RFQ, so the buyer's access check passes.
    testBuyerAccount = await storeService.ensureBuyerAccountForUser(TEST_USERS.buyer);
    chaserRfqId = storeService.createRFQ({
      title: 'RFQ under multi-channel outreach',
      category: 'Engineering Spares - Mechanical',
      assignedVendors: outreachVendors,
    }, testBuyerAccount).id;
    poRfqNumber = storeService.createRFQ({
      title: 'RFQ pending pre-purchase order approval',
      category: 'Engineering Spares - Mechanical',
    }).rfqNumber;
  });

  beforeEach(() => {
    // Clear throttle caches so chaser calls are not blocked by prior test runs
    whatsAppService.clearWhatsAppThrottleCache();
    smsService.clearSmsThrottleCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('POST /api/rfqs/:id/batch-chaser triggers multi-channel chasers and returns each channel result', async () => {
    // The 200 is only earned when the providers accept the messages, so they are mocked to accept.
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-http' });
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-http' });

    const res = await request(app)
      .post(`/api/rfqs/${chaserRfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send({ channels: ['call', 'whatsapp', 'sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Two vendors with phones, on WhatsApp and SMS: four accepted sends.
    expect(res.body.sentCount).toBe(4);
    expect(res.body.count).toBe(4);
    // Two vendors on three channels each: six per-channel rows, the voice calls included.
    expect(res.body.results).toHaveLength(6);
    expect(res.body.results.filter((r) => r.channel === 'call').every((r) => r.status === 'not_configured')).toBe(true);
  });

  test('triggerBatchChaser invokes WhatsApp and SMS senders for vendors with phones', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    const rfq = storeService.getRFQById(chaserRfqId);
    await storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

    const vendorsWithPhone = (rfq.assignedVendors || []).filter((v) => v.phone);
    expect(waSpy).toHaveBeenCalledTimes(vendorsWithPhone.length);
    expect(smsSpy).toHaveBeenCalledTimes(vendorsWithPhone.length);

    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  test('triggerBatchChaser skips WhatsApp/SMS when channels list excludes them', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    await storeService.triggerBatchChaser(chaserRfqId, ['call']);

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

    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-mock' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-mock' });

    const outcome = await storeService.triggerBatchChaser(noPhoneRfqId, ['whatsapp', 'sms']);

    // The single assigned vendor has no phone — both senders must stay silent.
    expect(waSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    expect(outcome.sentCount).toBe(0);
    expect(outcome.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(outcome.results.every((r) => r.error === CHASER_OUTREACH_MESSAGES.NO_PHONE_ON_RECORD)).toBe(true);

    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  test('POST /api/rfqs/:id/batch-chaser returns 404 for invalid RFQ', async () => {
    const res = await request(app)
      .post('/api/rfqs/invalid-rfq-id/batch-chaser')
      .set(authHeader('buyer'))
      .send({});
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('RFQ with ID invalid-rfq-id not found.');
  });

  describe('POST /api/rfqs/:id/batch-chaser status contract', () => {
    const chase = (rfqId, body) => request(app)
      .post(`/api/rfqs/${rfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send(body);

    test('returns 503 with each channel status when no provider accepts a send', async () => {
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'Meta rejected the template' });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'DLT rejected' });

      const res = await chase(chaserRfqId, { channels: ['whatsapp', 'sms'] });

      expect(res.statusCode).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.sentCount).toBe(0);
      expect(res.body.error).toBe(CHASER_OUTREACH_MESSAGES.NOTHING_SENT);
      expect(res.body.results.every((r) => r.status === 'failed' && r.success === false)).toBe(true);
      expect(res.body.results.map((r) => r.error)).toEqual(expect.arrayContaining(['Meta rejected the template', 'DLT rejected']));
    });

    test('returns 200 when at least one channel is accepted, and still lists the failed channel', async () => {
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-partial' });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'DLT rejected' });

      const res = await chase(chaserRfqId, { channels: ['whatsapp', 'sms'] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sentCount).toBe(2);
      expect(res.body.results.filter((r) => r.channel === 'whatsapp').every((r) => r.status === 'sent')).toBe(true);
      expect(res.body.results.filter((r) => r.channel === 'sms').every((r) => r.status === 'failed')).toBe(true);
    });

    test('returns 422 with the store message when the RFQ has no vendors assigned', async () => {
      const emptyRfqId = storeService.createRFQ({
        title: 'RFQ with nobody invited yet',
        category: 'Isolated-NoVendor-Category-XYZ',
        assignedVendors: [],
      }, testBuyerAccount).id;
      const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp');

      const res = await chase(emptyRfqId, { channels: ['whatsapp', 'sms'] });

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(CHASER_OUTREACH_MESSAGES.NO_VENDORS_ASSIGNED);
      expect(waSpy).not.toHaveBeenCalled();
    });

    test('returns 422 when every requested channel is skipped because the vendor has no phone number', async () => {
      const silentVendor = storeService.addVendor({
        name: 'Silent Vendor',
        email: 'silent@chaser-target.test',
        majorCategory: 'Isolated-Silent-Category-XYZ',
      });
      const silentRfqId = storeService.createRFQ({
        title: 'RFQ whose only vendor has no phone',
        category: 'Isolated-Silent-Category-XYZ',
        assignedVendors: [silentVendor],
      }, testBuyerAccount).id;
      const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms');

      const res = await chase(silentRfqId, { channels: ['sms'] });

      expect(res.statusCode).toBe(422);
      expect(res.body.error).toBe(CHASER_OUTREACH_MESSAGES.NOTHING_SENT);
      expect(res.body.results.every((r) => r.status === 'skipped' && r.error === CHASER_OUTREACH_MESSAGES.NO_PHONE_ON_RECORD)).toBe(true);
      expect(smsSpy).not.toHaveBeenCalled();
    });

    test('passes the signed-in user to the store as the actor', async () => {
      const storeSpy = jest.spyOn(storeService, 'triggerBatchChaser').mockResolvedValue({
        success: true, count: 1, logs: [], results: [], sentCount: 1,
      });

      const res = await chase(chaserRfqId, { channels: ['sms'] });

      expect(res.statusCode).toBe(200);
      expect(storeSpy).toHaveBeenCalledWith(chaserRfqId, ['sms'], expect.objectContaining({ email: 'buyer@procucev.com' }));
    });

    test('refuses a call with no signed-in user and never reaches the store', async () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      const storeSpy = jest.spyOn(storeService, 'triggerBatchChaser');

      await rfqController.triggerBatchChaser({ params: { id: chaserRfqId }, body: { channels: ['sms'] } }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(storeSpy).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    test('hands a store failure to the error handler instead of answering 200', async () => {
      jest.spyOn(storeService, 'triggerBatchChaser').mockRejectedValueOnce(new Error('store unavailable'));

      const res = await chase(chaserRfqId, { channels: ['sms'] });

      expect(res.statusCode).toBe(500);
      expect(res.body.success).toBe(false);
    });
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

  describe('triggerBatchChaser records only real outcomes', () => {
    // The stored record, not the reconciled copy that getRFQById returns.
    const storedRfq = () => storeService.rfqs.find((r) => r.id === chaserRfqId);

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('a provider acceptance is recorded as sent, with the provider message id', async () => {
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-accepted' });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-accepted' });

      const outcome = await storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

      expect(outcome.success).toBe(true);
      expect(outcome.sentCount).toBe(4);
      expect(outcome.results.every((r) => r.status === 'sent' && r.success === true)).toBe(true);
      expect(outcome.results.map((r) => r.messageId)).toEqual(expect.arrayContaining(['wa-accepted', 'sms-accepted']));
      expect(outcome.logs).toHaveLength(4);
      expect(outcome.logs.every((item) => item.status === 'sent' && item.type !== 'call')).toBe(true);
      expect(outcome.logs.every((item) => item.title.endsWith(' sent to ' + item.recipient))).toBe(true);
    });

    test('a provider rejection is recorded as failed, never as sent, and does not count as delivered', async () => {
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'Meta rejected the template' });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'DLT rejected' });
      const deliveredBefore = storedRfq().followUpData.whatsappStats.delivered;

      const outcome = await storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

      expect(outcome.success).toBe(false);
      expect(outcome.sentCount).toBe(0);
      expect(outcome.error).toBe(CHASER_OUTREACH_MESSAGES.NOTHING_SENT);
      expect(outcome.results.every((r) => r.status === 'failed' && r.success === false)).toBe(true);
      expect(outcome.results.map((r) => r.error)).toEqual(expect.arrayContaining(['Meta rejected the template', 'DLT rejected']));
      expect(outcome.logs.every((item) => item.status === 'failed' && item.title.includes('not sent'))).toBe(true);

      const followUp = storedRfq().followUpData;
      expect(followUp.whatsappStats.delivered).toBe(deliveredBefore);
      for (const vendor of storedRfq().assignedVendors) {
        // The follow-up entry for an assigned vendor is either the vendor's own record
        // (matched by id) or a record created by the chaser (matched by vendorId).
        const record = followUp.vendors.find((v) => (v.vendorId || v.id) === vendor.id);
        expect(record.whatsapp.status).toBe('failed');
        expect(record.sms.status).toBe('failed');
      }
    });

    test('a throttled or link-only provider result is not counted as sent', async () => {
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, throttled: true, messageId: 'sms-throttled' });
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, status: 'link_only', link: 'https://example.test/bid' });

      const outcome = await storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

      expect(outcome.sentCount).toBe(0);
      expect(outcome.results.filter((r) => r.channel === 'sms').every((r) => r.status === 'throttled' && r.messageId === null)).toBe(true);
      expect(outcome.results.filter((r) => r.channel === 'whatsapp').every((r) => r.status === 'link_only' && r.success === false)).toBe(true);
    });

    test('a thrown provider error becomes a failed outcome and does not stop the other channel', async () => {
      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockRejectedValue(new Error('network down'));
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });

      const outcome = await storeService.triggerBatchChaser(chaserRfqId, ['whatsapp', 'sms']);

      expect(outcome.results.filter((r) => r.channel === 'whatsapp').every((r) => r.status === 'failed' && r.error === 'network down')).toBe(true);
      expect(outcome.results.filter((r) => r.channel === 'sms').every((r) => r.status === 'sent')).toBe(true);
      expect(outcome.sentCount).toBe(2);
    });

    test('a voice call is reported as not_configured and nothing is recorded as made', async () => {
      const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp');
      const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms');

      const outcome = await storeService.triggerBatchChaser(chaserRfqId, ['call']);

      expect(waSpy).not.toHaveBeenCalled();
      expect(smsSpy).not.toHaveBeenCalled();
      expect(outcome.success).toBe(false);
      expect(outcome.results).toHaveLength(2);
      expect(outcome.results.every((r) => r.channel === 'call' && r.status === 'not_configured' && r.success === false)).toBe(true);
      expect(outcome.results[0].error).toBe(CHASER_OUTREACH_MESSAGES.VOICE_NOT_CONFIGURED);
      expect(outcome.logs).toEqual([]);
    });

    test('the audit entry names the authenticated actor, not a hardcoded bot account', async () => {
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-audit' });

      await storeService.triggerBatchChaser(chaserRfqId, ['sms'], { email: 'buyer.chaser@procucev.com' });

      const latest = storeService.getAuditLogs()[0];
      expect(latest.userEmail).toBe('buyer.chaser@procucev.com');
      expect(latest.action).toContain('2 sent, 0 not sent');
      expect(latest.userEmail).not.toBe('chaser.bot@procucev.com');
    });
  });
});
