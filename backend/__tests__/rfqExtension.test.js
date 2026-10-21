const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const { ALLOWED_EXTENSION_HOURS, DEFAULT_EXTENSION_HOURS } = require('../src/config/constants');
const { VALIDATION_SCHEMAS, validatePayload } = require('../src/config/validationSchemas');
const { authHeader, TEST_USERS } = require('./testHelpers');

const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('RFQ Extension Feature (24h / 48h strictly one-time)', () => {
  describe('Constants and Schemas', () => {
    test('ALLOWED_EXTENSION_HOURS contains exactly 24 and 48', () => {
      expect(ALLOWED_EXTENSION_HOURS).toEqual([24, 48]);
      expect(DEFAULT_EXTENSION_HOURS).toBe(24);
    });

    test('extendRFQ schema validates valid hours', () => {
      const valid24 = validatePayload(VALIDATION_SCHEMAS.extendRFQ, { hours: 24 });
      expect(valid24.isValid).toBe(true);
      expect(valid24.sanitizedData.hours).toBe(24);

      const valid48 = validatePayload(VALIDATION_SCHEMAS.extendRFQ, { hours: 48 });
      expect(valid48.isValid).toBe(true);
      expect(valid48.sanitizedData.hours).toBe(48);
    });

    test('extendRFQ schema rejects invalid hours', () => {
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { hours: 12 }).isValid).toBe(false);
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { hours: 72 }).isValid).toBe(false);
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { hours: 'abc' }).isValid).toBe(false);
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, {}).isValid).toBe(false);
    });
  });

  describe('storeService.extendRFQ', () => {
    test('returns failure if RFQ does not exist', () => {
      const result = storeService.extendRFQ('non-existent-rfq-id', { hours: 24, userEmail: 'buyer@procucev.com' });
      expect(result.success).toBe(false);
      expect(result.reason).toBe('NOT_FOUND');
    });

    test('returns failure if RFQ is closed or expired', () => {
      const closed = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-CLOSED-${Date.now()}`,
        title: 'Closed RFQ for extension test',
        status: 'Closed',
      });

      const res = storeService.extendRFQ(closed.id, { hours: 24, userEmail: TEST_USERS.buyer.email });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('INVALID_STATUS');
    });

    test('successfully extends an open RFQ with a deadline by 24 hours', () => {
      const baseDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-24-${Date.now()}`,
        title: 'Open RFQ for 24h extension test',
        status: 'Open',
        deadline: baseDate.toISOString(),
      });

      const result = storeService.extendRFQ(created.id, {
        hours: 24,
        userEmail: TEST_USERS.buyer.email,
      });

      expect(result.success).toBe(true);
      expect(result.rfq.isExtended).toBe(true);
      expect(result.rfq.extensionHours).toBe(24);
      expect(result.rfq.extendedByEmail).toBe(TEST_USERS.buyer.email);
      expect(result.rfq.extendedAt).toBeDefined();

      const expectedMs = baseDate.getTime() + 24 * 60 * 60 * 1000;
      expect(new Date(result.rfq.closingDeadline).getTime()).toBe(expectedMs);
    });

    test('rejects a second extension attempt on the same RFQ', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-ONCE-${Date.now()}`,
        title: 'Open RFQ for one-time check',
        status: 'Open',
      });

      // First extension succeeds
      const first = storeService.extendRFQ(created.id, { hours: 24, userEmail: TEST_USERS.buyer.email });
      expect(first.success).toBe(true);

      // Second extension fails
      const second = storeService.extendRFQ(created.id, { hours: 48, userEmail: TEST_USERS.buyer.email });
      expect(second.success).toBe(false);
      expect(second.reason).toBe('ALREADY_EXTENDED');
    });

    test('rejects extension when hours is not 24 or 48', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-INVALID-${Date.now()}`,
        title: 'Open RFQ for invalid hours check',
        status: 'Open',
      });

      const fail = storeService.extendRFQ(created.id, { hours: 36 });
      expect(fail.success).toBe(false);
      expect(fail.reason).toBe('VALIDATION');
    });

    test('successfully extends an open RFQ without existing deadline by 48 hours', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-48-${Date.now()}`,
        title: 'Open RFQ without initial deadline',
        status: 'Open',
      });

      const before = Date.now();
      const result = storeService.extendRFQ(created.id, {
        hours: 48,
        userEmail: TEST_USERS.buyer.email,
      });

      expect(result.success).toBe(true);
      expect(result.rfq.isExtended).toBe(true);
      expect(result.rfq.extensionHours).toBe(48);
      const extendedDeadlineMs = new Date(result.rfq.closingDeadline).getTime();
      expect(extendedDeadlineMs).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000 - 5000);
    });
  });

  describe('HTTP Route POST /api/rfqs/:id/extend', () => {
    async function createOwnRFQ(overrides = {}) {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Mechanical Spares Procurement',
          category: 'Engineering Spares - Mechanical',
          sourcingMode: 'mode_2',
          budget: 348000,
          targetDeliveryDate: A_FUTURE_DATE,
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
          ...overrides,
        });
      return res.body.data;
    }

    test('rejects unauthenticated requests with 401', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .send({ hours: 24 });
      expect(res.status).toBe(401);
    });

    test('rejects vendor requests with 404/403', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('vendor'))
        .send({ hours: 24 });
      // canAccessRfq returns 404 to avoid enumerating buyer RFQs
      expect([403, 404]).toContain(res.status);
    });

    test('rejects invalid payload with 400', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ hours: 36 });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 404 for non-existent RFQ', async () => {
      const res = await request(app)
        .post('/api/rfqs/non-existent-rfq-id-9999/extend')
        .set(authHeader('buyer'))
        .send({ hours: 24 });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('successfully extends RFQ by 24h and rejects second attempt with 400', async () => {
      const rfq = await createOwnRFQ();

      const res1 = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ hours: 24 });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.isExtended).toBe(true);
      expect(res1.body.data.extensionHours).toBe(24);
      expect(typeof res1.body.emailsSent).toBe('number');

      // Attempt second extension on same RFQ
      const res2 = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ hours: 48 });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toMatch(/already received its one-time deadline extension/);
    });
  });

  describe('Extension Email Dispatch', () => {
    test('buildRfqExtensionEmail constructs email with 24h extension, subject, and deadlines', () => {
      const email = mailerService.buildRfqExtensionEmail('vendor@example.com', {
        rfq: {
          rfqNumber: 'RFQ-EXT-TEST-1',
          title: 'Packaging Boxes',
          category: 'Packaging',
          deadline: '2026-10-30T10:00:00.000Z',
          items: [{ itemName: 'Carton Box', quantity: 500, unit: 'Pieces' }],
        },
        recipientName: 'Apex Suppliers',
        extensionHours: 24,
        newDeadline: '2026-10-31T10:00:00.000Z',
        originalDeadline: '2026-10-30T10:00:00.000Z',
      });

      expect(email.to).toBe('vendor@example.com');
      expect(email.subject).toContain('Deadline Extended (+24h): RFQ RFQ-EXT-TEST-1');
      expect(email.subject).toContain('Packaging');
      expect(email.html).toContain('Apex Suppliers');
      expect(email.html).toContain('Bidding Deadline Extended by 24 Hours');
      expect(email.html).toContain('2026-10-31T10:00:00.000Z');
      expect(email.html).toContain('Carton Box');
      expect(email.html).toContain('Submit Quotation Before Revised Deadline');
    });

    test('buildRfqExtensionEmail constructs email without category and with >10 items portal instruction', () => {
      const items = Array.from({ length: 12 }, (_, i) => ({ itemName: `Item ${i + 1}`, quantity: 10 }));
      const email = mailerService.buildRfqExtensionEmail('supplier@example.com', {
        rfq: {
          rfqNumber: 'RFQ-EXT-TEST-2',
          title: 'Bulk Materials',
          deadline: '2026-11-01T12:00:00.000Z',
          items,
        },
        recipientName: 'Bulk Corp',
        extensionHours: 48,
        newDeadline: '2026-11-03T12:00:00.000Z',
      });

      expect(email.subject).toBe('Deadline Extended (+48h): RFQ RFQ-EXT-TEST-2');
      expect(email.html).toContain('48 Hours');
      expect(email.html).toContain('Email bids are not accepted for RFQs with more than 10 items');
    });

    test('sendRfqExtensionEmail resolves with delivery object in test env', async () => {
      const result = await mailerService.sendRfqExtensionEmail('test@vendor.com', {
        rfq: { rfqNumber: 'RFQ-TEST-99' },
        recipientName: 'Vendor',
        extensionHours: 24,
      });
      expect(result).toEqual({ sent: false, reason: 'test environment' });
    });

    test('storeService.emailRFQExtensionToVendors notifies matched and assigned vendors with de-duplication', () => {
      const sendSpy = jest.spyOn(mailerService, 'sendRfqExtensionEmail').mockResolvedValue({ sent: true });

      const testRfq = storeService.createRFQ({
        rfqNumber: `RFQ-EMAIL-TEST-${Date.now()}`,
        title: 'Industrial Pumps',
        category: 'Machinery & Equipment',
        status: 'Open',
        assignedVendors: [
          { email: 'assigned1@example.com', name: 'Assigned 1' },
          { email: 'duplicate@example.com', name: 'Duplicate Vendor' },
        ],
      });

      const selectSpy = jest.spyOn(storeService, 'selectVendorsForRFQEmail').mockReturnValue([
        { email: 'matched1@example.com', name: 'Matched 1' },
        { email: 'duplicate@example.com', name: 'Duplicate Vendor' },
      ]);

      const count = storeService.emailRFQExtensionToVendors(testRfq, 24, '2026-10-25T00:00:00.000Z');

      expect(count).toBe(3);
      expect(sendSpy).toHaveBeenCalledTimes(3);

      selectSpy.mockRestore();
      sendSpy.mockRestore();
    });

    test('storeService.emailRFQExtensionToVendors does not send if status is not valid for extension', () => {
      const sendSpy = jest.spyOn(mailerService, 'sendRfqExtensionEmail').mockResolvedValue({ sent: true });

      const draftRfq = { id: 'd-1', status: 'Draft' };
      const closedRfq = { id: 'c-1', status: 'Closed' };
      const expiredRfq = { id: 'e-1', status: 'Expired' };

      expect(storeService.emailRFQExtensionToVendors(draftRfq, 24)).toBe(0);
      expect(storeService.emailRFQExtensionToVendors(closedRfq, 24)).toBe(0);
      expect(storeService.emailRFQExtensionToVendors(expiredRfq, 24)).toBe(0);
      expect(storeService.emailRFQExtensionToVendors(null, 24)).toBe(0);

      expect(sendSpy).not.toHaveBeenCalled();
      sendSpy.mockRestore();
    });

    test('storeService.extendRFQ returns emailsSent count', () => {
      const sendSpy = jest.spyOn(mailerService, 'sendRfqExtensionEmail').mockResolvedValue({ sent: true });
      const selectSpy = jest.spyOn(storeService, 'selectVendorsForRFQEmail').mockReturnValue([
        { email: 'vendor1@test.com', name: 'Vendor 1' },
      ]);

      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-EMAILS-${Date.now()}`,
        title: 'Open RFQ for emailsSent test',
        status: 'Open',
      });

      const result = storeService.extendRFQ(created.id, {
        hours: 24,
        userEmail: TEST_USERS.buyer.email,
      });

      expect(result.success).toBe(true);
      expect(typeof result.emailsSent).toBe('number');
      expect(result.emailsSent).toBeGreaterThanOrEqual(1);

      selectSpy.mockRestore();
      sendSpy.mockRestore();
    });
  });
});
