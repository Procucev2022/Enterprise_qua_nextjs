const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const {
  EXTENSION_HOURS_PER_DAY,
  DEFAULT_EXTENSION_DAYS,
  EXTENSION_MIN_DAYS,
  EXTENSION_MAX_DAYS,
} = require('../src/config/constants');
const { VALIDATION_SCHEMAS, validatePayload, isWholeExtensionDays } = require('../src/config/validationSchemas');
const { authHeader, TEST_USERS } = require('./testHelpers');

const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_MESSAGE = 'Extension must be a whole number of days from 1 to 30.';

// One line item with every field the RFQ form requires, so the create helper below is a valid RFQ.
const COMPLETE_LINE_ITEM = {
  itemName: 'Centrifugal pump bearing',
  technicalSpecs: 'Deep groove ball bearing, 6205 2RS',
  quantity: 2,
  unit: 'Nos',
  majorCategory: 'Engineering Spares - Mechanical',
  minorCategory: 'Bearings & Accessories',
};

describe('RFQ Extension Feature (whole days, strictly one-time)', () => {
  describe('Constants and Schemas', () => {
    test('extension is chosen in whole days from 1 to 30, defaulting to one day, stored as hours', () => {
      expect(EXTENSION_HOURS_PER_DAY).toBe(24);
      expect(EXTENSION_MIN_DAYS).toBe(1);
      expect(EXTENSION_MAX_DAYS).toBe(30);
      expect(DEFAULT_EXTENSION_DAYS).toBe(1);
    });

    test('extendRFQ schema accepts every whole day in range, as a number or a numeric string', () => {
      for (const days of [1, 3, 30, '7']) {
        const result = validatePayload(VALIDATION_SCHEMAS.extendRFQ, { days });
        expect(result.isValid).toBe(true);
        expect(result.sanitizedData.days).toBe(Number(days));
      }
    });

    test('extendRFQ schema rejects days outside the range, fractions, blanks and non-numeric input', () => {
      for (const days of [0, -1, 31, 2.5, 'abc', '', null]) {
        expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { days }).isValid).toBe(false);
      }
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, {}).isValid).toBe(false);
    });

    test('extendRFQ schema names the allowed range when it rejects a day count', () => {
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { days: 31 }).errors.days).toBe(RANGE_MESSAGE);
      expect(validatePayload(VALIDATION_SCHEMAS.extendRFQ, { days: 2.5 }).errors.days).toBe(RANGE_MESSAGE);
    });

    test('isWholeExtensionDays accepts the boundaries and rejects everything around them', () => {
      expect(isWholeExtensionDays(1)).toBe(true);
      expect(isWholeExtensionDays(30)).toBe(true);
      expect(isWholeExtensionDays(0)).toBe(false);
      expect(isWholeExtensionDays(31)).toBe(false);
      expect(isWholeExtensionDays(1.5)).toBe(false);
      expect(isWholeExtensionDays('')).toBe(false);
      expect(isWholeExtensionDays(null)).toBe(false);
      expect(isWholeExtensionDays(undefined)).toBe(false);
    });
  });

  describe('storeService.extendRFQ', () => {
    test('returns failure if RFQ does not exist', () => {
      const result = storeService.extendRFQ('non-existent-rfq-id', { days: 1, userEmail: 'buyer@procucev.com' });
      expect(result.success).toBe(false);
      expect(result.reason).toBe('NOT_FOUND');
    });

    test('returns failure if RFQ is closed or expired', () => {
      const closed = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-CLOSED-${Date.now()}`,
        title: 'Closed RFQ for extension test',
        status: 'Closed',
      });

      const res = storeService.extendRFQ(closed.id, { days: 1, userEmail: TEST_USERS.buyer.email });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('INVALID_STATUS');
    });

    test('extends an open RFQ with a deadline by the number of days the buyer chose', () => {
      const baseDate = new Date(Date.now() + 5 * DAY_MS);
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-3D-${Date.now()}`,
        title: 'Open RFQ for a three-day extension test',
        status: 'Open',
        deadline: baseDate.toISOString(),
      });

      const result = storeService.extendRFQ(created.id, {
        days: 3,
        userEmail: TEST_USERS.buyer.email,
      });

      expect(result.success).toBe(true);
      expect(result.rfq.isExtended).toBe(true);
      expect(result.rfq.extensionHours).toBe(72);
      expect(result.rfq.extendedByEmail).toBe(TEST_USERS.buyer.email);
      expect(result.rfq.extendedAt).toBeDefined();
      expect(new Date(result.rfq.closingDeadline).getTime()).toBe(baseDate.getTime() + 3 * DAY_MS);
    });

    test('rejects a second extension attempt on the same RFQ', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-ONCE-${Date.now()}`,
        title: 'Open RFQ for one-time check',
        status: 'Open',
      });

      const first = storeService.extendRFQ(created.id, { days: 1, userEmail: TEST_USERS.buyer.email });
      expect(first.success).toBe(true);

      const second = storeService.extendRFQ(created.id, { days: 2, userEmail: TEST_USERS.buyer.email });
      expect(second.success).toBe(false);
      expect(second.reason).toBe('ALREADY_EXTENDED');
    });

    test('rejects extension when the day count is outside the range or not whole', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-INVALID-${Date.now()}`,
        title: 'Open RFQ for invalid day count check',
        status: 'Open',
      });

      for (const days of [0, 31, 1.5]) {
        const fail = storeService.extendRFQ(created.id, { days });
        expect(fail.success).toBe(false);
        expect(fail.reason).toBe('VALIDATION');
        expect(fail.error).toBe(RANGE_MESSAGE);
      }
    });

    test('extends an open RFQ without an existing deadline by two days from its creation or from now', () => {
      const created = storeService.createRFQ({
        rfqNumber: `RFQ-EXT-2D-${Date.now()}`,
        title: 'Open RFQ without initial deadline',
        status: 'Open',
      });

      const before = Date.now();
      const result = storeService.extendRFQ(created.id, {
        days: 2,
        userEmail: TEST_USERS.buyer.email,
      });

      expect(result.success).toBe(true);
      expect(result.rfq.isExtended).toBe(true);
      expect(result.rfq.extensionHours).toBe(48);
      const extendedDeadlineMs = new Date(result.rfq.closingDeadline).getTime();
      expect(extendedDeadlineMs).toBeGreaterThanOrEqual(before + 2 * DAY_MS - 5000);
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
          extractedEntities: [{ ...COMPLETE_LINE_ITEM }],
          ...overrides,
        });
      return res.body.data;
    }

    test('rejects unauthenticated requests with 401', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .send({ days: 1 });
      expect(res.status).toBe(401);
    });

    test('rejects vendor requests with 404/403', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('vendor'))
        .send({ days: 1 });
      // canAccessRfq returns 404 to avoid enumerating buyer RFQs
      expect([403, 404]).toContain(res.status);
    });

    test('rejects a day count outside the range with 400 and names the range', async () => {
      const rfq = await createOwnRFQ();
      const res = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ days: 31 });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(RANGE_MESSAGE);
    });

    test('returns 404 for non-existent RFQ', async () => {
      const res = await request(app)
        .post('/api/rfqs/non-existent-rfq-id-9999/extend')
        .set(authHeader('buyer'))
        .send({ days: 1 });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('extends RFQ by the chosen days and rejects a second attempt with 400', async () => {
      const rfq = await createOwnRFQ();

      const res1 = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ days: 3 });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.isExtended).toBe(true);
      expect(res1.body.data.extensionHours).toBe(72);

      // Attempt second extension on same RFQ
      const res2 = await request(app)
        .post(`/api/rfqs/${rfq.id}/extend`)
        .set(authHeader('buyer'))
        .send({ days: 2 });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toMatch(/already received its one-time deadline extension/);
    });
  });
});
