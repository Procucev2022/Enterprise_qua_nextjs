'use strict';

/**
 * The closing time of an RFQ: creation time plus 48 hours by default, stored as closingDeadline. The
 * closure sweep and the one-time extension both read that value. RFQs stored before closingDeadline existed
 * fall back to 48 hours after their creation time.
 */

const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');
const pool = require('../src/db/pool');
const { RFQ_AUTO_CLOSE_AFTER_MS } = require('../src/config/constants');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Far enough ahead that a target delivery date is never replaced by the "must be in the future" fallback.
const FAR_FUTURE_DATE = '2099-12-09';

/** The "YYYY-MM-DD HH:mm UTC" form createRFQ stores for a creation time. */
function storedStamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
}

/** An in-memory RFQ shaped like one createRFQ stores. The store reads quotes when an RFQ is updated. */
function cachedRfq(fields) {
  return { quotes: [], status: 'Quotes Pending', ...fields };
}

describe('RFQ closing deadline', () => {
  beforeEach(() => {
    storeService.rfqs = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(storeService, 'notifyOfRFQClosure').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe('creation', () => {
    test('closes 48 hours after the RFQ is raised, keeping the minute of creation', () => {
      const rfq = storeService.createRFQ({
        title: 'Hydraulic hose assemblies',
        category: 'Engineering Spares - Mechanical',
        createdAt: '2026-11-14 02:19 UTC',
        targetDeliveryDate: FAR_FUTURE_DATE,
      });

      expect(rfq.createdAt).toBe('2026-11-14 02:19 UTC');
      expect(rfq.closingDeadline).toBe('2026-11-16T02:19:00.000Z');
      expect(rfq.targetDeliveryDate).toBe(FAR_FUTURE_DATE);
      expect(rfq.deadline).toBe(FAR_FUTURE_DATE);
    });

    test('stamps the creation time itself when the request carries none, and closes 48 hours after it', () => {
      const before = Date.now();
      const rfq = storeService.createRFQ({ title: 'Pump seal kit', category: 'Engineering Spares - Mechanical' });
      const after = Date.now();

      expect(rfq.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      const createdMs = Date.parse(rfq.createdAt);
      expect(createdMs).toBeGreaterThanOrEqual(before - 60 * 1000);
      expect(createdMs).toBeLessThanOrEqual(after);
      expect(Date.parse(rfq.closingDeadline) - createdMs).toBe(RFQ_AUTO_CLOSE_AFTER_MS);
    });

    test('measures the closing time from now when the creation time cannot be read', () => {
      const before = Date.now();
      const rfq = storeService.createRFQ({
        title: 'Bearing housing',
        category: 'Engineering Spares - Mechanical',
        createdAt: 'not-a-date',
      });
      const closingMs = Date.parse(rfq.closingDeadline);

      expect(closingMs).toBeGreaterThanOrEqual(before + RFQ_AUTO_CLOSE_AFTER_MS);
      expect(closingMs).toBeLessThanOrEqual(Date.now() + RFQ_AUTO_CLOSE_AFTER_MS);
    });

    test('a deadline sent with the request does not set the closing time', () => {
      const rfq = storeService.createRFQ({
        title: 'Gasket sets',
        category: 'Engineering Spares - Mechanical',
        createdAt: '2026-11-14 02:19 UTC',
        deadline: '2099-01-10',
        targetDeliveryDate: FAR_FUTURE_DATE,
      });

      expect(rfq.closingDeadline).toBe('2026-11-16T02:19:00.000Z');
      expect(rfq.deadline).toBe('2099-01-10');
      expect(rfq.targetDeliveryDate).toBe(FAR_FUTURE_DATE);
    });

    test('a request with no target date uses its deadline as the target date and still closes 48 hours after creation', () => {
      const rfq = storeService.createRFQ({
        title: 'Coupling guard',
        category: 'Engineering Spares - Mechanical',
        createdAt: '2026-11-14 02:19 UTC',
        deadline: FAR_FUTURE_DATE,
      });

      expect(rfq.targetDeliveryDate).toBe(FAR_FUTURE_DATE);
      expect(rfq.closingDeadline).toBe('2026-11-16T02:19:00.000Z');
    });
  });

  describe('edit route', () => {
    test('a plain RFQ edit cannot write the closing time or the one-time extension record', async () => {
      const existing = cachedRfq({ id: 'rfq-guard-1', rfqNumber: 'RFQ-GUARD-1', title: 'Original title' });
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(existing);
      const updateSpy = jest.spyOn(storeService, 'updateRFQDurably').mockResolvedValue({ ...existing, title: 'Edited title' });
      const res = { statusCode: 200, status: jest.fn(function status(code) { this.statusCode = code; return this; }), json: jest.fn() };

      await rfqController.updateRFQ({
        params: { id: existing.id },
        body: {
          title: 'Edited title',
          closingDeadline: '2099-01-01T00:00:00.000Z',
          isExtended: false,
          extensionHours: 0,
          extendedAt: '',
        },
        user: { role: 'admin' },
      }, res, jest.fn());

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [, updates] = updateSpy.mock.calls[0];
      expect(updates).toEqual({ title: 'Edited title' });
    });
  });

  describe('closure sweep (in-memory store)', () => {
    test('keeps an RFQ open until its stored closing time, even when that is more than 48 hours after creation', async () => {
      storeService.rfqs = [cachedRfq({
        id: 'rfq-extended-open',
        rfqNumber: 'RFQ-EXT-OPEN',
        createdAt: storedStamp(Date.now() - 50 * HOUR_MS),
        closingDeadline: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      })];

      await expect(storeService.closeExpiredRFQsDurably()).resolves.toEqual([]);
      expect(storeService.rfqs[0].status).toBe('Quotes Pending');
    });

    test('closes an RFQ once its stored closing time has passed, even when it is younger than 48 hours', async () => {
      storeService.rfqs = [cachedRfq({
        id: 'rfq-closing-passed',
        rfqNumber: 'RFQ-CLOSING-PASSED',
        createdAt: storedStamp(Date.now() - 30 * HOUR_MS),
        closingDeadline: new Date(Date.now() - HOUR_MS).toISOString(),
      })];

      const closed = await storeService.closeExpiredRFQsDurably();

      expect(closed.map((rfq) => rfq.id)).toEqual(['rfq-closing-passed']);
      expect(storeService.rfqs[0].status).toBe('Closed');
      expect(storeService.rfqs[0].closedReason).toBeDefined();
    });

    test('closes a stored RFQ without a closing time 48 hours after its creation time', async () => {
      storeService.rfqs = [cachedRfq({
        id: 'rfq-legacy-due',
        rfqNumber: 'RFQ-LEGACY-DUE',
        createdAt: storedStamp(Date.now() - 49 * HOUR_MS),
        deadline: FAR_FUTURE_DATE,
      })];

      const closed = await storeService.closeExpiredRFQsDurably();

      expect(closed.map((rfq) => rfq.id)).toEqual(['rfq-legacy-due']);
    });

    test('keeps a stored RFQ without a closing time open until 48 hours after its creation time', async () => {
      storeService.rfqs = [cachedRfq({
        id: 'rfq-legacy-young',
        rfqNumber: 'RFQ-LEGACY-YOUNG',
        createdAt: storedStamp(Date.now() - 47 * HOUR_MS),
      })];

      await expect(storeService.closeExpiredRFQsDurably()).resolves.toEqual([]);
      expect(storeService.rfqs[0].status).toBe('Quotes Pending');
    });
  });

  describe('one-time extension base', () => {
    test('adds the days to the stored closing time when that time is still ahead', () => {
      const closingDeadline = new Date(Date.now() + 5 * DAY_MS).toISOString();
      storeService.rfqs = [cachedRfq({ id: 'rfq-ahead', rfqNumber: 'RFQ-AHEAD', closingDeadline })];

      const result = storeService.extendRFQ('rfq-ahead', { days: 3 });

      expect(result.success).toBe(true);
      expect(Date.parse(result.rfq.closingDeadline)).toBe(Date.parse(closingDeadline) + 3 * DAY_MS);
    });

    test('extends a stored RFQ without a closing time from its 48-hour closing time', () => {
      const createdAt = storedStamp(Date.now() - 10 * HOUR_MS);
      storeService.rfqs = [cachedRfq({ id: 'rfq-legacy-ahead', rfqNumber: 'RFQ-LEG-AHEAD', createdAt })];

      const result = storeService.extendRFQ('rfq-legacy-ahead', { days: 1 });

      expect(result.success).toBe(true);
      expect(Date.parse(result.rfq.closingDeadline)).toBe(Date.parse(createdAt) + RFQ_AUTO_CLOSE_AFTER_MS + DAY_MS);
    });

    test('extends from now when the 48-hour closing time of a stored RFQ has already passed', () => {
      storeService.rfqs = [cachedRfq({
        id: 'rfq-legacy-old',
        rfqNumber: 'RFQ-LEG-OLD',
        createdAt: storedStamp(Date.now() - 10 * DAY_MS),
      })];

      const before = Date.now();
      const result = storeService.extendRFQ('rfq-legacy-old', { days: 2 });
      const extendedMs = Date.parse(result.rfq.closingDeadline);

      expect(extendedMs).toBeGreaterThanOrEqual(before + 2 * DAY_MS);
      expect(extendedMs).toBeLessThanOrEqual(Date.now() + 2 * DAY_MS);
    });

    test('extends from now when the RFQ has neither a closing time nor a creation time', () => {
      storeService.rfqs = [cachedRfq({ id: 'rfq-undated', rfqNumber: 'RFQ-UNDATED' })];

      const before = Date.now();
      const result = storeService.extendRFQ('rfq-undated', { days: 4 });
      const extendedMs = Date.parse(result.rfq.closingDeadline);

      expect(extendedMs).toBeGreaterThanOrEqual(before + 4 * DAY_MS);
      expect(extendedMs).toBeLessThanOrEqual(Date.now() + 4 * DAY_MS);
    });
  });
});
