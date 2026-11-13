// ==============================================================================
// PAYMENT DUES MODULE UNIT TESTS
// ==============================================================================
// Covers paymentDuesQueries (SQL layer, mocked through pool), paymentDuesController
// and its routes (query layer mocked at the module boundary). No in-memory store.
// ==============================================================================

const supertest = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const paymentDuesController = require('../src/controllers/paymentDuesController');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const whatsAppService = require('../src/services/whatsAppService');
const { logger } = require('../src/services/loggerService');
const { PERSISTENCE_MESSAGES } = require('../src/config/constants');

const request = (appUnderTest) => {
  const agent = supertest(appUnderTest);
  return {
    get: (path) => agent.get(path).set('Authorization', 'Bearer payment-dues-test-token'),
    post: (path) => agent.post(path).set('Authorization', 'Bearer payment-dues-test-token'),
  };
};

const STAFF_USER = { sub: 'staff-test-id', email: 'staff@example.test', name: 'Staff Member', role: 'admin' };

const UNAVAILABLE = { code: 'PERSISTENCE_UNAVAILABLE' };

function communicationRow(overrides = {}) {
  return {
    id: 'pdc_1',
    account_id: 'buyer-1',
    account_type: 'buyer',
    channel: 'email',
    recipient: 'buyer@example.com',
    subject: 'Low credit',
    message: 'Your credits are low.',
    notification_status: 'Notification Sent',
    delivery_status: 'Delivered',
    acknowledgement_status: 'Acknowledgement Pending',
    communicated_by: 'Staff Member',
    sent_at: '2026-03-01T10:00:00.000Z',
    acknowledged_at: null,
    acknowledged_by: null,
    notes: '',
    metadata: '{}',
    created_at: '2026-03-01T10:00:00.000Z',
    updated_at: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function lowCreditAccount(overrides = {}) {
  return {
    accountId: 'buyer-1',
    accountType: 'buyer',
    companyName: 'Acme Buyer',
    contactPerson: 'Asha',
    email: 'buyer@example.com',
    phoneNumber: '+919876543210',
    availableCredits: 1,
    totalCredits: 10,
    creditsUsed: 9,
    accountStatus: 'Active',
    registrationDate: '2026-01-01T00:00:00.000Z',
    lastActivity: '2026-02-01T00:00:00.000Z',
    assignedExecutive: 'Exec',
    lastNotification: null,
    notificationChannel: '–',
    acknowledgementStatus: 'Not Notified',
    deliveryStatus: '–',
    notificationStatus: 'Not Notified',
    rawRecord: {},
    ...overrides,
  };
}

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockImplementation(() => res);
  res.json = jest.fn().mockImplementation((body) => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn();
  res.send = jest.fn().mockImplementation((body) => {
    res.sent = body;
    return res;
  });
  return res;
}

describe('Payment Dues – Low Credit Monitoring & Communication', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({ valid: true, user: STAFF_USER });
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  describe('paymentDuesQueries unit tests', () => {
    let querySpy;

    beforeEach(() => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('Unexpected pool.query call in this test.'));
    });

    describe('fetchRawBuyers and fetchRawVendors', () => {
      test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
        pool.hasStorage.mockReturnValue(false);

        await expect(paymentDuesQueries.fetchRawBuyers()).rejects.toMatchObject(UNAVAILABLE);
        await expect(paymentDuesQueries.fetchRawVendors()).rejects.toMatchObject(UNAVAILABLE);
        expect(querySpy).not.toHaveBeenCalled();
      });

      test('maps buyer rows, merging the raw record and keeping database timestamps', async () => {
        querySpy.mockResolvedValueOnce({
          rows: [{
            id: 'buyer-db-1',
            is_active: true,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            raw: JSON.stringify({ organizationName: 'DB Buyer Corp', corporateEmail: 'alice@dbcorp.com', remainingFreeRFQs: 1 }),
          }],
        });

        const buyers = await paymentDuesQueries.fetchRawBuyers();

        expect(buyers).toEqual([expect.objectContaining({
          id: 'buyer-db-1',
          organizationName: 'DB Buyer Corp',
          corporateEmail: 'alice@dbcorp.com',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          isActive: true,
        })]);
        expect(querySpy.mock.calls[0][0]).toContain('FROM buyer_accounts');
      });

      test('maps vendor rows and refuses a result that carries no row set', async () => {
        querySpy.mockResolvedValueOnce({
          rows: [{ id: 'v-1', email: 'v@x.com', status: 'ACTIVE', raw: '{"name":"Apex"}', created_at: '2026-01-01T00:00:00.000Z' }],
        });

        await expect(paymentDuesQueries.fetchRawVendors()).resolves.toEqual([expect.objectContaining({
          id: 'v-1',
          name: 'Apex',
          email: 'v@x.com',
          status: 'ACTIVE',
        })]);

        querySpy.mockResolvedValueOnce({});
        await expect(paymentDuesQueries.fetchRawVendors()).rejects.toMatchObject(UNAVAILABLE);
      });

      test('fails closed with the cause when the buyer query errors', async () => {
        const cause = new Error('buyer query failed');
        querySpy.mockRejectedValueOnce(cause);

        await expect(paymentDuesQueries.fetchRawBuyers()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
      });
    });

    describe('getLowCreditAccounts', () => {
      const buyerFixtures = [
        { id: 'buyer-1', organizationName: 'Acme Buyer', corporateEmail: 'acme@example.com', remainingFreeRFQs: 1, totalCredits: 10, status: 'Active', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'buyer-2', organizationName: 'Beta Buyer', corporateEmail: 'beta@example.com', remainingFreeRFQs: 0, totalCredits: 5, status: 'Inactive', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'buyer-3', organizationName: 'Gamma Buyer', corporateEmail: 'gamma@example.com', remainingFreeRFQs: 9, totalCredits: 20, status: 'Active', createdAt: '2026-01-03T00:00:00.000Z' },
        { id: 'buyer-4', organizationName: 'Delta Buyer', corporateEmail: 'delta@example.com', remainingFreeRFQs: null, totalCredits: null, status: 'Active' },
      ];
      const vendorFixtures = [
        { id: 'vendor-1', name: 'Apex Supplies', email: 'apex@example.com', subscriptionPlan: 'premium', rfqDownloadsUsed: 8, status: 'ACTIVE', createdAt: '2026-01-05T00:00:00.000Z' },
        { id: 'vendor-2', name: 'Bolt Works', email: 'bolt@example.com', freeQuotationCredits: 2, status: 'ACTIVE', createdAt: '2026-01-06T00:00:00.000Z' },
        { id: 'vendor-3', name: 'Cable Co', email: 'cable@example.com', freeQuotationCredits: 40, status: 'ACTIVE' },
      ];

      beforeEach(() => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue(buyerFixtures);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue(vendorFixtures);
        querySpy.mockImplementation((sql) => {
          if (sql.includes('ROW_NUMBER')) {
            return Promise.resolve({
              rows: [{
                account_id: 'buyer-1',
                channel: 'email',
                notification_status: 'Notification Sent',
                delivery_status: 'Delivered',
                acknowledgement_status: 'Acknowledged',
                sent_at: '2026-03-01T00:00:00.000Z',
              }],
            });
          }
          return Promise.resolve({ rows: [] });
        });
      });

      test('lists only accounts with two or fewer available credits and summarizes them', async () => {
        const result = await paymentDuesQueries.getLowCreditAccounts();

        expect(result.total).toBe(3);
        expect(result.accounts.map((a) => a.accountId).sort()).toEqual(['buyer-1', 'buyer-2', 'vendor-2']);
        expect(result.summary).toEqual({
          totalLowCreditAccounts: 3,
          totalBuyers: 2,
          totalSellers: 1,
          zeroCredits: 1,
          oneToTwoCredits: 2,
          acknowledgementPending: 0,
        });
        expect(result.page).toBe(1);
        expect(result.limit).toBe(25);
      });

      test('derives a seller balance from the plan quota and reports the latest communication', async () => {
        const result = await paymentDuesQueries.getLowCreditAccounts({ accountType: 'seller' });
        const apex = result.accounts.find((a) => a.accountId === 'vendor-1');
        const buyer = (await paymentDuesQueries.getLowCreditAccounts()).accounts.find((a) => a.accountId === 'buyer-1');

        expect(apex).toBeUndefined();
        expect(result.accounts.map((a) => a.accountId)).toEqual(['vendor-2']);
        expect(buyer).toEqual(expect.objectContaining({
          notificationChannel: 'email',
          acknowledgementStatus: 'Acknowledged',
          deliveryStatus: 'Delivered',
          notificationStatus: 'Notification Sent',
          lastNotification: '2026-03-01T00:00:00.000Z',
        }));
      });

      test('uses dashes and null for missing buyer and seller contact fields', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([
          { id: 'buyer-bare', remainingFreeRFQs: 0, status: null, isActive: 0 },
        ]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([]);

        const { accounts } = await paymentDuesQueries.getLowCreditAccounts();

        expect(accounts[0]).toEqual(expect.objectContaining({
          companyName: '–',
          contactPerson: '–',
          email: '–',
          phoneNumber: '–',
          totalCredits: null,
          creditsUsed: null,
          accountStatus: 'Inactive',
          registrationDate: null,
          assignedExecutive: '–',
          notificationChannel: '–',
          acknowledgementStatus: 'Not Notified',
        }));
      });

      test('filters by search, credit band, status, executive, and channel', async () => {
        const bySearch = await paymentDuesQueries.getLowCreditAccounts({ search: 'bolt' });
        const byZero = await paymentDuesQueries.getLowCreditAccounts({ credits: '0', accountType: 'buyer' });
        const byBand = await paymentDuesQueries.getLowCreditAccounts({ credits: '1-2' });
        const byExact = await paymentDuesQueries.getLowCreditAccounts({ credits: '2' });
        const byStatus = await paymentDuesQueries.getLowCreditAccounts({ accountStatus: 'inactive' });
        const byExecutive = await paymentDuesQueries.getLowCreditAccounts({ assignedExecutive: 'Exec' });
        const byChannel = await paymentDuesQueries.getLowCreditAccounts({ notificationChannel: 'email' });
        const byAck = await paymentDuesQueries.getLowCreditAccounts({ acknowledgementStatus: 'not notified' });

        expect(bySearch.accounts.map((a) => a.accountId)).toEqual(['vendor-2']);
        expect(byZero.accounts.map((a) => a.accountId)).toEqual(['buyer-2']);
        expect(byBand.accounts.map((a) => a.accountId).sort()).toEqual(['buyer-1', 'vendor-2']);
        expect(byExact.accounts.map((a) => a.accountId)).toEqual(['vendor-2']);
        expect(byStatus.accounts.map((a) => a.accountId)).toEqual(['buyer-2']);
        expect(byExecutive.total).toBe(0);
        expect(byChannel.accounts.map((a) => a.accountId)).toEqual(['buyer-1']);
        expect(byAck.total).toBe(2);
      });

      test('sorts by a text field in both directions and by a numeric field', async () => {
        const ascending = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName', sortOrder: 'asc' });
        const descending = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName', sortOrder: 'DESC' });
        const numeric = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'availableCredits', sortOrder: 'desc' });

        expect(ascending.accounts[0].companyName < ascending.accounts[1].companyName).toBe(true);
        expect(descending.accounts[0].companyName > descending.accounts[1].companyName).toBe(true);
        expect(numeric.accounts[0].availableCredits).toBeGreaterThanOrEqual(numeric.accounts[1].availableCredits);
      });

      test('paginates and defaults invalid page and limit values', async () => {
        const page2 = await paymentDuesQueries.getLowCreditAccounts({ limit: 2, page: 2 });
        const invalid = await paymentDuesQueries.getLowCreditAccounts({ page: 'x', limit: '0' });

        expect(page2.accounts).toHaveLength(1);
        expect(page2.page).toBe(2);
        expect(invalid.page).toBe(1);
        expect(invalid.limit).toBe(25);
      });

      test('omits communication lookups when no account is eligible', async () => {
        jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([{ id: 'buyer-ok', remainingFreeRFQs: 50 }]);
        jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([]);
        querySpy.mockClear();

        const result = await paymentDuesQueries.getLowCreditAccounts();

        expect(result.total).toBe(0);
        expect(querySpy).not.toHaveBeenCalled();
      });

      test('fails closed when the latest communication lookup errors', async () => {
        const cause = new Error('lookup failed');
        querySpy.mockRejectedValueOnce(cause);

        await expect(paymentDuesQueries.getLowCreditAccounts()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
      });

      test('fails closed when storage is not configured for the communication lookup', async () => {
        pool.hasStorage.mockReturnValue(false);

        await expect(paymentDuesQueries.getLowCreditAccounts()).rejects.toMatchObject(UNAVAILABLE);
      });

      test('getPaymentDuesSummary returns the summary of all eligible accounts', async () => {
        await expect(paymentDuesQueries.getPaymentDuesSummary()).resolves.toEqual(expect.objectContaining({
          totalLowCreditAccounts: 3,
        }));
      });

      test('exposes the seller balance helpers', () => {
        expect(paymentDuesQueries.getSellerAvailableCredits({ availableCredits: '3' })).toBe(3);
        expect(paymentDuesQueries.getSellerAvailableCredits({ freeRfqDownloadCredits: 4 })).toBe(4);
        expect(paymentDuesQueries.getSellerAvailableCredits({ freeCreditsRemaining: 5 })).toBe(5);
        expect(paymentDuesQueries.getSellerAvailableCredits({ credits: 6 })).toBe(6);
        expect(paymentDuesQueries.getSellerAvailableCredits({})).toBeNull();
        expect(paymentDuesQueries.getSellerCreditsUsed({ freeCreditsUsed: 7 }, 10, 3)).toBe(7);
        expect(paymentDuesQueries.getSellerCreditsUsed({ rfqDownloadsUsed: 2 }, 10, 8)).toBe(2);
        expect(paymentDuesQueries.getSellerCreditsUsed({}, null, 3)).toBeNull();
        expect(paymentDuesQueries.getSellerCreditsUsed({}, 10, 3)).toBe(7);
      });

      test('parses raw values and picks the first present value', () => {
        expect(paymentDuesQueries.parseRaw('{"a":1}')).toEqual({ a: 1 });
        expect(paymentDuesQueries.parseRaw('not json', { fallback: true })).toEqual({ fallback: true });
        expect(paymentDuesQueries.parseRaw(null, { empty: true })).toEqual({ empty: true });
        expect(paymentDuesQueries.parseRaw({ direct: true })).toEqual({ direct: true });
        expect(paymentDuesQueries.pickFirst(null, '', 'third')).toBe('third');
        expect(paymentDuesQueries.pickFirst(null)).toBe('');
        expect(paymentDuesQueries.parseCredits('12')).toBe(12);
        expect(paymentDuesQueries.parseCredits('abc', 9)).toBe(9);
        expect(paymentDuesQueries.parseCredits(null, 4)).toBe(4);
      });
    });

    describe('recordCommunication', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      });

      test('requires the sender name before writing anything', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query');

        await expect(paymentDuesQueries.recordCommunication({
          accountId: 'buyer-1', accountType: 'buyer', channel: 'email', recipient: 'a@b.com', message: 'Hi', communicatedBy: '  ',
        })).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          statusCode: 400,
          message: 'The sender name is required to record a communication. Sign in and retry.',
        });
        expect(querySpyLocal).not.toHaveBeenCalled();
      });

      test('fails closed when storage is not configured', async () => {
        pool.hasStorage.mockReturnValue(false);

        await expect(paymentDuesQueries.recordCommunication({
          accountId: 'buyer-1', accountType: 'buyer', channel: 'email', recipient: 'a@b.com', message: 'Hi', communicatedBy: 'Staff',
        })).rejects.toMatchObject(UNAVAILABLE);
      });

      test('inserts a pending communication with the sender and returns it', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [communicationRow()] });

        const communication = await paymentDuesQueries.recordCommunication({
          accountId: 'buyer-1',
          accountType: 'buyer',
          channel: 'email',
          recipient: 'buyer@example.com',
          subject: 'Low credit',
          message: 'Your credits are low.',
          communicatedBy: ' Staff Member ',
          metadata: { source: 'test' },
        });

        const [sql, params, options] = querySpyLocal.mock.calls[0];
        expect(sql).toContain('INSERT INTO payment_dues_communications');
        expect(params[0]).toMatch(/^pdc_/);
        expect(params[10]).toBe('Staff Member');
        expect(params[7]).toBe('Notification Pending');
        expect(params[8]).toBe('Pending');
        expect(JSON.parse(params[13])).toEqual({ source: 'test' });
        expect(options).toEqual({ d1: true, d1Text: expect.any(String) });
        expect(communication).toEqual(expect.objectContaining({
          accountId: 'buyer-1',
          communicatedBy: 'Staff Member',
          notificationStatus: 'Notification Pending',
          deliveryStatus: 'Pending',
          acknowledgementStatus: 'Acknowledgement Pending',
          acknowledgedAt: null,
          metadata: { source: 'test' },
        }));
      });

      test('keeps metadata text as supplied when it is not an object', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

        await paymentDuesQueries.recordCommunication({
          accountId: 'buyer-1', accountType: 'buyer', channel: 'email', recipient: 'a@b.com', message: 'Hi', communicatedBy: 'Staff', metadata: 'plain-text',
        });

        expect(querySpyLocal.mock.calls[0][1][13]).toBe('plain-text');
      });

      test('fails closed with the cause when the insert fails', async () => {
        const cause = new Error('insert failed');
        jest.spyOn(pool, 'query').mockRejectedValueOnce(cause);

        await expect(paymentDuesQueries.recordCommunication({
          accountId: 'buyer-1', accountType: 'buyer', channel: 'email', recipient: 'a@b.com', message: 'Hi', communicatedBy: 'Staff',
        })).rejects.toMatchObject({ ...UNAVAILABLE, cause });
      });
    });

    describe('updateCommunicationDeliveryStatus', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      });

      test('returns null without an id and writes nothing', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query');

        await expect(paymentDuesQueries.updateCommunicationDeliveryStatus({ communicationId: '' })).resolves.toBeNull();
        expect(querySpyLocal).not.toHaveBeenCalled();
      });

      test('writes the new statuses and the metadata patch, and returns the mapped row', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [communicationRow({ delivery_status: 'Failed' })] });

        const row = await paymentDuesQueries.updateCommunicationDeliveryStatus({
          communicationId: 'pdc_1',
          notificationStatus: 'Failed',
          deliveryStatus: 'Failed',
          acknowledgementStatus: 'Acknowledgement Pending',
          metadataPatch: { providerError: 'timeout' },
        });

        expect(querySpyLocal.mock.calls[0][1][0]).toBe('pdc_1');
        expect(JSON.parse(querySpyLocal.mock.calls[0][1][5])).toEqual({ providerError: 'timeout' });
        expect(row).toEqual(expect.objectContaining({ id: 'pdc_1', deliveryStatus: 'Failed', metadata: {} }));
      });

      test('leaves metadata unchanged when no patch is supplied, and returns null for an unknown id', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

        await expect(paymentDuesQueries.updateCommunicationDeliveryStatus({ communicationId: 'missing' })).resolves.toBeNull();
        expect(querySpyLocal.mock.calls[0][1][5]).toBeNull();
      });

      test('fails closed with the cause when the update fails', async () => {
        const cause = new Error('update failed');
        jest.spyOn(pool, 'query').mockRejectedValueOnce(cause);

        await expect(paymentDuesQueries.updateCommunicationDeliveryStatus({ communicationId: 'pdc_1' }))
          .rejects.toMatchObject({ ...UNAVAILABLE, cause });
      });
    });

    describe('updateAcknowledgementStatus', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      });

      test('requires the updating user before writing', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query');

        await expect(paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'buyer-1', acknowledgementStatus: 'Acknowledged', updatedBy: '',
        })).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          message: 'The updating user is required to record an acknowledgement. Sign in and retry.',
        });
        expect(querySpyLocal).not.toHaveBeenCalled();
      });

      test('fails closed when storage is not configured', async () => {
        pool.hasStorage.mockReturnValue(false);

        await expect(paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'buyer-1', acknowledgementStatus: 'Acknowledged', updatedBy: 'Staff',
        })).rejects.toMatchObject(UNAVAILABLE);
      });

      test('updates the record named by communication id and stamps the acknowledger', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({
          rows: [communicationRow({ acknowledgement_status: 'Acknowledged', acknowledged_by: 'Staff' })],
        });

        const row = await paymentDuesQueries.updateAcknowledgementStatus({
          communicationId: 'pdc_1',
          accountId: 'buyer-1',
          acknowledgementStatus: 'Acknowledged',
          deliveryStatus: 'Delivered',
          notes: 'Confirmed by phone',
          updatedBy: 'Staff',
        });

        const [sql, params] = querySpyLocal.mock.calls[0];
        expect(sql).toContain('WHERE id = $6');
        expect(params[0]).toBe('Acknowledged');
        expect(params[4]).toBe('Staff');
        expect(params[5]).toBe('pdc_1');
        expect(row).toEqual(expect.objectContaining({ acknowledgementStatus: 'Acknowledged', acknowledgedBy: 'Staff' }));
      });

      test('updates the latest communication for the account when no id is given, and returns null when none exists', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

        await expect(paymentDuesQueries.updateAcknowledgementStatus({
          accountId: 'buyer-9', acknowledgementStatus: 'Acknowledged', updatedBy: 'Staff',
        })).resolves.toBeNull();
        expect(querySpyLocal.mock.calls[0][0]).toContain('WHERE account_id = $6');
        expect(querySpyLocal.mock.calls[0][1][5]).toBe('buyer-9');
      });

      test('fails closed with the cause when the update fails', async () => {
        const cause = new Error('ack failed');
        jest.spyOn(pool, 'query').mockRejectedValueOnce(cause);

        await expect(paymentDuesQueries.updateAcknowledgementStatus({
          communicationId: 'pdc_1', accountId: 'buyer-1', acknowledgementStatus: 'Acknowledged', updatedBy: 'Staff',
        })).rejects.toMatchObject({ ...UNAVAILABLE, cause });
      });
    });

    describe('history and lookup', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      });

      test('reads one account history with clamped paging and maps each row', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [communicationRow(), communicationRow({ id: 'pdc_2' })] });

        const history = await paymentDuesQueries.getCommunicationHistory('buyer-1', { limit: 500, offset: -1 });

        expect(querySpyLocal.mock.calls[0][1]).toEqual(['buyer-1', 200, 0]);
        expect(history.map((h) => h.id)).toEqual(['pdc_1', 'pdc_2']);
      });

      test('reads the cross-account history when requested', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

        await expect(paymentDuesQueries.getCommunicationHistory('', { isCrossAccount: true })).resolves.toEqual([]);
        expect(querySpyLocal.mock.calls[0][1]).toEqual([50, 0]);
      });

      test('fails closed when the history read returns no row set or errors', async () => {
        jest.spyOn(pool, 'query').mockResolvedValueOnce({});
        await expect(paymentDuesQueries.getCommunicationHistory('buyer-1')).rejects.toMatchObject(UNAVAILABLE);

        jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('history failed'));
        await expect(paymentDuesQueries.getCommunicationHistory('buyer-1')).rejects.toMatchObject(UNAVAILABLE);
      });

      test('fails closed when storage is not configured for history', async () => {
        pool.hasStorage.mockReturnValue(false);

        await expect(paymentDuesQueries.getCommunicationHistory('buyer-1')).rejects.toMatchObject(UNAVAILABLE);
      });

      test('looks up one communication by id and returns null for a missing or empty id', async () => {
        jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [communicationRow()] });

        await expect(paymentDuesQueries.getCommunicationById('pdc_1')).resolves.toEqual(expect.objectContaining({ id: 'pdc_1' }));
        await expect(paymentDuesQueries.getCommunicationById('')).resolves.toBeNull();

        jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });
        await expect(paymentDuesQueries.getCommunicationById('missing')).resolves.toBeNull();
      });

      test('fails closed when the communication lookup errors or storage is missing', async () => {
        jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('lookup failed'));
        await expect(paymentDuesQueries.getCommunicationById('pdc_1')).rejects.toMatchObject(UNAVAILABLE);

        pool.hasStorage.mockReturnValue(false);
        await expect(paymentDuesQueries.getCommunicationById('pdc_1')).rejects.toMatchObject(UNAVAILABLE);
      });
    });

    describe('queryCommunications', () => {
      beforeEach(() => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      });

      test('filters by account, entity type, and channel and returns the page with its total', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query')
          .mockResolvedValueOnce({ rows: [{ total: '5' }] })
          .mockResolvedValueOnce({ rows: [communicationRow()] });

        const result = await paymentDuesQueries.queryCommunications({
          accountId: 'buyer-1', entityType: 'buyer', channel: 'email', limit: 10, offset: 20,
        });

        expect(querySpyLocal.mock.calls[0][0]).toContain('account_id = $1');
        expect(querySpyLocal.mock.calls[0][0]).toContain('UPPER(channel) = UPPER($3)');
        expect(querySpyLocal.mock.calls[1][1]).toEqual(['buyer-1', 'buyer', 'email', 10, 20]);
        expect(result.total).toBe(5);
        expect(result.items).toEqual([expect.objectContaining({ id: 'pdc_1', channel: 'email' })]);
      });

      test('ignores the account filter for cross-account queries and treats a missing count as zero', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query')
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });

        const result = await paymentDuesQueries.queryCommunications({ accountId: 'buyer-1', isCrossAccount: true, channel: 'ALL' });

        expect(querySpyLocal.mock.calls[0][0]).not.toContain('account_id = $1');
        expect(result).toEqual({ items: [], total: 0 });
      });

      test('fails closed when the query errors or storage is missing', async () => {
        jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('query failed'));
        await expect(paymentDuesQueries.queryCommunications({})).rejects.toMatchObject(UNAVAILABLE);

        pool.hasStorage.mockReturnValue(false);
        await expect(paymentDuesQueries.queryCommunications({})).rejects.toMatchObject(UNAVAILABLE);
      });
    });

    describe('fetchCommunicationsMap', () => {
      test('returns an empty map for an empty account list without querying', async () => {
        const querySpyLocal = jest.spyOn(pool, 'query');

        const map = await paymentDuesQueries.fetchCommunicationsMap([]);

        expect(map.size).toBe(0);
        expect(querySpyLocal).not.toHaveBeenCalled();
      });

      test('maps the latest communication per account', async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValueOnce({
          rows: [{ account_id: 'buyer-1', channel: 'message', notification_status: 'Delivered', delivery_status: 'Delivered', acknowledgement_status: 'Acknowledged', sent_at: 'T' }],
        });

        const map = await paymentDuesQueries.fetchCommunicationsMap(['buyer-1', 'buyer-1']);

        expect(map.get('buyer-1')[0]).toEqual(expect.objectContaining({ channel: 'message', acknowledgementStatus: 'Acknowledged' }));
      });
    });
  });

  describe('paymentDuesController and API routes', () => {
    const listEntry = lowCreditAccount();

    beforeEach(() => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    });

    test('lists low-credit accounts with the query-string filters and paging', async () => {
      const listSpy = jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValueOnce({
        accounts: [listEntry], total: 1, summary: { totalLowCreditAccounts: 1 }, page: 2, limit: 10,
      });

      const res = await request(app).get('/api/payment-dues?search=acme&accountType=buyer&page=2&limit=10');

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', accountType: 'buyer', page: 2, limit: 10 }));
      expect(res.body).toEqual(expect.objectContaining({ success: true, total: 1, page: 2, limit: 10 }));
      expect(res.body.accounts).toEqual([listEntry]);
    });

    test('answers 503 with a retryable message when the list storage is unavailable', async () => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));

      const res = await request(app).get('/api/payment-dues');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, retryable: true, error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE });
    });

    test('answers 500 with the fallback message for an unexpected list failure', async () => {
      jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockRejectedValueOnce(new Error('boom'));

      const res = await request(app).get('/api/payment-dues');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('An internal server error occurred while retrieving low-credit accounts.');
    });

    test('returns the summary from the query layer and reports its failures', async () => {
      const summary = { totalLowCreditAccounts: 2 };
      jest.spyOn(paymentDuesQueries, 'getPaymentDuesSummary').mockResolvedValueOnce(summary);

      const ok = await request(app).get('/api/payment-dues/summary');
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ success: true, summary });

      jest.spyOn(paymentDuesQueries, 'getPaymentDuesSummary').mockRejectedValueOnce(new Error('boom'));
      const failed = await request(app).get('/api/payment-dues/summary');
      expect(failed.status).toBe(500);
      expect(failed.body.error).toBe('An internal server error occurred while retrieving payment dues summary.');
    });

    test('rejects requests from roles other than admin and category manager', async () => {
      authService.assertSessionActive.mockResolvedValueOnce({
        valid: true,
        user: { sub: 'buyer-1', email: 'buyer@example.com', name: 'Buyer', role: 'buyer' },
      });

      const res = await request(app).get('/api/payment-dues');

      expect(res.status).toBe(403);
    });

    describe('email notifications', () => {
      const emailBody = {
        accountId: 'buyer-1',
        accountType: 'buyer',
        recipientEmail: 'buyer@example.com',
        subject: 'Low credit balance',
        message: 'Your credit balance is low. Please top up.',
        notes: 'Follow up Monday',
      };

      test('rejects an invalid email payload with the field-level details', async () => {
        const res = await request(app).post('/api/payment-dues/email').send({ ...emailBody, recipientEmail: 'not-an-email' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid email payload parameters.');
        expect(res.body.details).toHaveProperty('recipientEmail');
      });

      test('refuses to send when the signed-in user has no name or email', async () => {
        authService.assertSessionActive.mockResolvedValueOnce({ valid: true, user: { sub: 'nameless', role: 'admin' } });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(401);
        expect(res.body.error).toContain('Sign in with a staff account');
      });

      test('records the pending communication, drains the outbox, and reports 200 once delivered', async () => {
        const pending = { id: 'pdc_9', deliveryStatus: 'Pending' };
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce(pending);
        const outboxSpy = jest.spyOn(require('../src/services/eventOutboxService'), 'dispatchDueEventOutboxJobs').mockResolvedValueOnce({});
        jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValueOnce({ id: 'pdc_9', deliveryStatus: 'Delivered' });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(200);
        expect(paymentDuesQueries.recordCommunication).toHaveBeenCalledWith(expect.objectContaining({
          channel: 'email',
          communicatedBy: 'Staff Member',
          notificationStatus: 'Pending',
          deliveryStatus: 'Pending',
        }));
        expect(outboxSpy).toHaveBeenCalledWith(1);
        expect(res.body.communication).toEqual({ id: 'pdc_9', deliveryStatus: 'Delivered' });
      });

      test('answers 202 while the email is still queued for retry', async () => {
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_10', deliveryStatus: 'Pending' });
        jest.spyOn(require('../src/services/eventOutboxService'), 'dispatchDueEventOutboxJobs').mockRejectedValueOnce(new Error('outbox offline'));
        jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValueOnce({ id: 'pdc_10', deliveryStatus: 'Pending' });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(202);
        expect(res.body.message).toContain('queued');
      });

      test('answers 503 when the queued communication cannot be read back', async () => {
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_11', deliveryStatus: 'Pending' });
        jest.spyOn(require('../src/services/eventOutboxService'), 'dispatchDueEventOutboxJobs').mockResolvedValueOnce({});
        jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ success: false, retryable: true, error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE });
      });

      test('answers 503 when the queued communication is missing afterwards', async () => {
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_12', deliveryStatus: 'Pending' });
        jest.spyOn(require('../src/services/eventOutboxService'), 'dispatchDueEventOutboxJobs').mockResolvedValueOnce({});
        jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValueOnce(null);

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(503);
      });

      test('answers 503 without sending when the pending history cannot be saved', async () => {
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));
        const dispatchSpy = jest.spyOn(mailerService, 'deliver');

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(503);
        expect(dispatchSpy).not.toHaveBeenCalled();
      });

      test('sends through the mail provider when no database is configured and records the delivered status', async () => {
        pool.hasStorage.mockReturnValue(false);
        const communication = { id: 'pdc_13', deliveryStatus: 'Pending' };
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce(communication);
        const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true });
        const finalSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus')
          .mockResolvedValueOnce({ id: 'pdc_13', deliveryStatus: 'Delivered' });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(200);
        expect(deliverSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'buyer@example.com' }), 'PAYMENT_DUES_NOTIFICATION');
        expect(finalSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Delivered' }));
      });

      test('records a failed delivery and answers 503 when no provider is configured', async () => {
        pool.hasStorage.mockReturnValue(false);
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_14', deliveryStatus: 'Pending' });
        jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: false, reason: 'not configured' });
        const finalSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus')
          .mockResolvedValueOnce({ id: 'pdc_14', deliveryStatus: 'Failed' });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(503);
        expect(res.body.retryable).toBe(true);
        expect(finalSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));
      });

      test('answers 502 and records the failure when the provider throws', async () => {
        pool.hasStorage.mockReturnValue(false);
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_15', deliveryStatus: 'Pending' });
        jest.spyOn(mailerService, 'deliver').mockRejectedValueOnce(new Error('smtp down'));
        jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValueOnce({ id: 'pdc_15', deliveryStatus: 'Failed' });

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(502);
        expect(res.body.retryable).toBe(false);
      });

      test('answers 503 with the delivery-status message when the final status cannot be saved', async () => {
        pool.hasStorage.mockReturnValue(false);
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_16', deliveryStatus: 'Pending' });
        jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true });
        jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValueOnce(null);

        const res = await request(app).post('/api/payment-dues/email').send(emailBody);

        expect(res.status).toBe(503);
        expect(res.body.error).toBe(PERSISTENCE_MESSAGES.PAYMENT_DUES_DELIVERY_STATUS_FAILED);
      });
    });

    describe('in-app and WhatsApp notifications', () => {
      test('stores the in-app notification and records a delivered message', async () => {
        const durableSpy = jest.spyOn(storeService, 'createNotificationDurably').mockResolvedValueOnce({});
        const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_m1' });

        const res = await request(app).post('/api/payment-dues/message').send({
          accountId: 'vendor-1',
          accountType: 'seller',
          message: 'Please top up your quote credits.',
        });

        expect(res.status).toBe(200);
        expect(durableSpy).toHaveBeenCalledWith(expect.objectContaining({ recipientType: 'vendor', recipientId: 'vendor-1' }));
        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: 'message', communicatedBy: 'Staff Member' }));
      });

      test('answers 503 when the in-app notification cannot be stored', async () => {
        jest.spyOn(storeService, 'createNotificationDurably').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));

        const res = await request(app).post('/api/payment-dues/message').send({
          accountId: 'buyer-1',
          accountType: 'buyer',
          message: 'Please top up your credits.',
        });

        expect(res.status).toBe(503);
      });

      test('rejects an in-app payload that fails validation', async () => {
        const res = await request(app).post('/api/payment-dues/message').send({ accountId: 'buyer-1', accountType: 'buyer', message: 'x' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid in-app message parameters.');
      });

      test('prepares a WhatsApp deep link and records it as pending rather than delivered', async () => {
        const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_w1' });
        jest.spyOn(whatsAppService, 'buildDirectWhatsAppLink').mockReturnValueOnce('https://wa.me/919876543210?text=Hi');

        const res = await request(app).post('/api/payment-dues/whatsapp').send({
          accountId: 'buyer-1',
          accountType: 'buyer',
          phone: '+91 98765 43210',
          message: 'Your credit balance is low.',
        });

        expect(res.status).toBe(200);
        expect(res.body.directLink).toBe('https://wa.me/919876543210?text=Hi');
        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
          channel: 'whatsapp',
          notificationStatus: 'Delivery Pending',
          deliveryStatus: 'Pending',
          metadata: { directLink: 'https://wa.me/919876543210?text=Hi' },
        }));
      });

      test('builds the WhatsApp link itself when the service does not provide one', async () => {
        jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'pdc_w2' });
        jest.spyOn(whatsAppService, 'buildDirectWhatsAppLink').mockImplementationOnce(undefined);

        const res = await request(app).post('/api/payment-dues/whatsapp').send({
          accountId: 'buyer-1',
          accountType: 'buyer',
          phone: '+91 98765-43210',
          message: 'Hi there',
        });

        expect(res.status).toBe(200);
        expect(res.body.directLink).toBe(`https://wa.me/919876543210?text=${encodeURIComponent('Hi there')}`);
      });

      test('rejects a WhatsApp payload that fails validation', async () => {
        const res = await request(app).post('/api/payment-dues/whatsapp').send({ accountId: 'buyer-1', accountType: 'buyer', phone: '1', message: 'Hi there' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid WhatsApp payload parameters.');
      });
    });

    describe('acknowledgement and history', () => {
      test('updates the acknowledgement for the signed-in user', async () => {
        const updateSpy = jest.spyOn(paymentDuesQueries, 'updateAcknowledgementStatus').mockResolvedValueOnce({ id: 'pdc_1', acknowledgementStatus: 'Acknowledged' });

        const res = await request(app).post('/api/payment-dues/acknowledge').send({
          accountId: 'buyer-1',
          accountType: 'buyer',
          acknowledgementStatus: 'Acknowledged',
          notes: 'Confirmed',
        });

        expect(res.status).toBe(200);
        expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ updatedBy: 'Staff Member', acknowledgementStatus: 'Acknowledged' }));
        expect(res.body.communication).toEqual({ id: 'pdc_1', acknowledgementStatus: 'Acknowledged' });
      });

      test('rejects an acknowledgement with an unknown status', async () => {
        const res = await request(app).post('/api/payment-dues/acknowledge').send({
          accountId: 'buyer-1', accountType: 'buyer', acknowledgementStatus: 'Maybe',
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid acknowledgement update parameters.');
      });

      test('reports a failed acknowledgement update as 500 with the fallback message', async () => {
        jest.spyOn(paymentDuesQueries, 'updateAcknowledgementStatus').mockRejectedValueOnce(new Error('ack failed'));

        const res = await request(app).post('/api/payment-dues/acknowledge').send({
          accountId: 'buyer-1', accountType: 'buyer', acknowledgementStatus: 'Acknowledged',
        });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('An internal server error occurred while updating acknowledgement status.');
      });

      test('returns the communication history for an account', async () => {
        jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce([{ id: 'pdc_1' }]);

        const res = await request(app).get('/api/payment-dues/history/buyer-1');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, history: [{ id: 'pdc_1' }] });
      });

      test('refuses the cross-account wildcard lookup', async () => {
        const res = await request(app).get('/api/payment-dues/history/%2A');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Cross-account wildcard lookup is not permitted.');
      });

      test('reports history failures as 503 when storage is unavailable', async () => {
        jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));

        const res = await request(app).get('/api/payment-dues/history/buyer-1');

        expect(res.status).toBe(503);
      });
    });

    describe('CSV export', () => {
      test('exports the filtered accounts as an attachment with escaped fields', async () => {
        jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValueOnce({
          accounts: [lowCreditAccount({ companyName: 'Acme "Quoted" Buyer', lastNotification: null, notificationChannel: '–' })],
          total: 1,
          summary: {},
          page: 1,
          limit: 10000,
        });
        const res = mockResponse();

        await paymentDuesController.exportCsv({ query: { search: 'acme' } }, res);

        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="payment_dues_report.csv"');
        expect(res.sent.split('\r\n')[0]).toContain('Account ID');
        expect(res.sent).toContain('"Acme ""Quoted"" Buyer"');
        expect(res.sent).toContain('"–"');
      });

      test('reports a failed export as 500 with the fallback message', async () => {
        jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockRejectedValueOnce(new Error('export failed'));
        const res = mockResponse();

        await paymentDuesController.exportCsv({ query: {} }, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'An internal server error occurred while exporting CSV report.' });
      });

      test('serves the CSV through the route', async () => {
        jest.spyOn(paymentDuesQueries, 'getLowCreditAccounts').mockResolvedValueOnce({ accounts: [], total: 0, summary: {}, page: 1, limit: 10000 });

        const res = await request(app).get('/api/payment-dues/export');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text.split('\r\n')).toHaveLength(1);
      });
    });
  });
});
