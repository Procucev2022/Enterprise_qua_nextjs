const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');

function buyerRow(id, raw) {
  return {
    id,
    is_active: 1,
    raw: JSON.stringify(raw),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchRawBuyers', () => {
  test('reports persistence unavailable without storage and never queries', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(paymentDuesQueries.fetchRawBuyers()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('wraps a failed buyer query and keeps the cause', async () => {
    pool.query.mockRejectedValueOnce(new Error('buyer timeout'));

    await expect(paymentDuesQueries.fetchRawBuyers()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.any(Error),
    });
  });

  test('reports persistence unavailable when the buyer query returns no row set', async () => {
    pool.query.mockResolvedValueOnce({});

    await expect(paymentDuesQueries.fetchRawBuyers()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      message: expect.stringContaining('buyer account read'),
    });
  });

  test('maps buyer rows with the stored raw record and tolerates malformed raw text', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        buyerRow('buyer-1', { companyName: 'Alpha Co', remainingFreeRFQs: 2 }),
        { id: 'buyer-2', is_active: 0, raw: '{broken', created_at: null, updated_at: null },
      ],
    });

    const buyers = await paymentDuesQueries.fetchRawBuyers();

    expect(buyers[0]).toMatchObject({ id: 'buyer-1', companyName: 'Alpha Co', remainingFreeRFQs: 2, isActive: 1 });
    expect(buyers[1]).toMatchObject({ id: 'buyer-2', isActive: 0 });
  });
});

describe('fetchRawVendors', () => {
  test('reports persistence unavailable without storage', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(paymentDuesQueries.fetchRawVendors()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('wraps a failed vendor query and keeps the cause', async () => {
    pool.query.mockRejectedValueOnce(new Error('vendor timeout'));

    await expect(paymentDuesQueries.fetchRawVendors()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.any(Error),
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues persistence failed',
      expect.objectContaining({ operation: 'vendor account read' }),
      'PAYMENT_DUES'
    );
  });

  test('reports persistence unavailable when the vendor result is not a row list', async () => {
    pool.query.mockResolvedValueOnce({ rows: 'not-a-list' });

    await expect(paymentDuesQueries.fetchRawVendors()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      message: expect.stringContaining('vendor account read'),
    });
  });

  test('maps vendor rows with their status and stored raw record', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'vendor-1',
          email: 'vendor@procure.test',
          status: 'Active',
          raw: JSON.stringify({ name: 'Vendor One', freeQuotationCredits: 1 }),
          created_at: '2026-02-01T00:00:00.000Z',
          updated_at: null,
        },
      ],
    });

    const [vendor] = await paymentDuesQueries.fetchRawVendors();

    expect(vendor).toMatchObject({
      id: 'vendor-1',
      email: 'vendor@procure.test',
      status: 'Active',
      name: 'Vendor One',
      freeQuotationCredits: 1,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('getLowCreditAccounts ordering', () => {
  test('keeps accounts with equal sort values in their original order', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM buyer_accounts/.test(sql)) {
        return {
          rows: [
            buyerRow('buyer-a', { companyName: 'Same Co', remainingFreeRFQs: 0 }),
            buyerRow('buyer-b', { companyName: 'Same Co', remainingFreeRFQs: 1 }),
          ],
        };
      }
      return { rows: [] };
    });

    const result = await paymentDuesQueries.getLowCreditAccounts({ sortBy: 'companyName', sortOrder: 'asc' });

    expect(result.total).toBe(2);
    expect(result.accounts.map((a) => a.accountId)).toEqual(['buyer-a', 'buyer-b']);
    expect(result.summary).toMatchObject({ totalLowCreditAccounts: 2, totalBuyers: 2, zeroCredits: 1 });
  });
});

describe('getCommunicationHistory multi-lookup & error branches', () => {
  test('handles cross-account error and missing rows exceptions', async () => {
    pool.query.mockRejectedValueOnce(new Error('Cross-account DB query timeout'));
    await expect(paymentDuesQueries.getCommunicationHistory('', { isCrossAccount: true })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });

    pool.query.mockResolvedValueOnce({});
    await expect(paymentDuesQueries.getCommunicationHistory('', { isCrossAccount: true })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });

  test('returns empty array when multi-lookup receives no valid identifiers', async () => {
    const res = await paymentDuesQueries.getCommunicationHistory([], { emails: [], phones: [] });
    expect(res).toEqual([]);

    const resEmptyStr = await paymentDuesQueries.getCommunicationHistory(' , ', { emails: [''], phones: [''] });
    expect(resEmptyStr).toEqual([]);
  });

  test('executes multi-identifier lookup across accounts, emails, and phones', async () => {
    const mockComm = {
      id: 'comm-ml-1',
      account_id: 'buyer-001',
      account_type: 'buyer',
      channel: 'EMAIL',
      recipient: 'user@test.com',
      subject: 'Follow-up',
      message: 'Checking status',
      sent_at: '2026-03-01T10:00:00.000Z',
      communicated_by: 'Category Manager',
      delivery_status: 'Delivered',
      notification_status: 'Sent',
      acknowledgement_status: 'Pending',
      notes: 'Initial check',
      metadata: JSON.stringify({ rfqId: 'rfq-1' }),
    };

    pool.query.mockResolvedValueOnce({ rows: [mockComm] });

    const result = await paymentDuesQueries.getCommunicationHistory(
      ['buyer-001', 'user@test.com'],
      {
        emails: ['alt@test.com'],
        phones: ['+919988776655'],
        limit: 10,
        offset: 0,
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'comm-ml-1',
      accountId: 'buyer-001',
      recipient: 'user@test.com',
      metadata: { rfqId: 'rfq-1' },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ('),
      expect.arrayContaining([
        expect.arrayContaining(['buyer-001', 'user@test.com']),
        expect.arrayContaining(['alt@test.com', 'user@test.com']),
        expect.arrayContaining(['+919988776655']),
      ]),
      expect.objectContaining({ d1: true, d1Text: expect.stringContaining('payment_dues_communications') })
    );
  });

  test('handles comma-separated account identifiers in multi-lookup', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await paymentDuesQueries.getCommunicationHistory('buyer-alpha, buyer-beta', {
      emails: ['contact@buyer.com'],
    });

    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ('),
      expect.arrayContaining([
        expect.arrayContaining(['buyer-alpha', 'buyer-beta']),
      ]),
      expect.anything()
    );
  });

  test('handles errors and missing rows in multi-lookup query', async () => {
    pool.query.mockRejectedValueOnce(new Error('Multi-lookup query failed'));
    await expect(paymentDuesQueries.getCommunicationHistory(['b-1'], { emails: ['b@test.com'] })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });

    pool.query.mockResolvedValueOnce({});
    await expect(paymentDuesQueries.getCommunicationHistory(['b-1'], { emails: ['b@test.com'] })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });
});

describe('queryCommunications branches', () => {
  test('executes queryCommunications with filters and handles edge cases', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/COUNT\(\*\)/.test(sql)) {
        return { rows: [{ total: '1' }] };
      }
      return {
        rows: [{
          id: 'comm-qc-1',
          account_id: 'acc-qc-1',
          account_type: 'seller',
          channel: 'SMS',
          message: 'Alert',
          sent_at: '2026-03-01T00:00:00.000Z',
        }],
      };
    });

    // With accountId, entityType, and channel
    const resFiltered = await paymentDuesQueries.queryCommunications({
      accountId: 'acc-qc-1',
      entityType: 'seller',
      channel: 'SMS',
      limit: 10,
      offset: 0,
    });

    expect(resFiltered.total).toBe(1);
    expect(resFiltered.items).toHaveLength(1);
    expect(resFiltered.items[0].id).toBe('comm-qc-1');

    // With cross-account and channel ALL
    const resCross = await paymentDuesQueries.queryCommunications({
      isCrossAccount: true,
      channel: 'ALL',
    });
    expect(resCross.total).toBe(1);

    // Default call without arguments
    const resDefaults = await paymentDuesQueries.queryCommunications();
    expect(resDefaults.total).toBe(1);

    // Without storage
    pool.hasStorage.mockReturnValueOnce(false);
    await expect(paymentDuesQueries.queryCommunications()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });
});

describe('fetchCommunicationsMap & seller communication status branches', () => {
  test('fetchCommunicationsMap queries without account filter when accountIds is undefined', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        account_id: 'acc-unfiltered',
        channel: 'EMAIL',
        notification_status: 'Sent',
        delivery_status: 'Delivered',
        acknowledgement_status: 'Acknowledged',
        sent_at: '2026-03-01T00:00:00.000Z',
      }],
    });

    const commMap = await paymentDuesQueries.fetchCommunicationsMap();
    expect(commMap.get('acc-unfiltered')).toBeDefined();
    expect(commMap.get('acc-unfiltered')[0].channel).toBe('EMAIL');
  });

  test('getLowCreditAccounts populates latestComm fields for low credit sellers', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM vendors/.test(sql)) {
        return {
          rows: [{
            id: 'vendor-low-1',
            name: 'Low Credit Vendor',
            is_active: 0,
            status: null,
            raw: JSON.stringify({
              credits: 0,
              subscriptionPlan: 'free',
            }),
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
          }],
        };
      }
      if (/payment_dues_communications/.test(sql)) {
        return {
          rows: [{
            account_id: 'vendor-low-1',
            channel: 'WHATSAPP',
            notification_status: 'Delivered',
            delivery_status: 'Delivered',
            acknowledgement_status: 'Pending',
            sent_at: '2026-03-01T12:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const result = await paymentDuesQueries.getLowCreditAccounts({ accountType: 'seller' });
    expect(result.total).toBe(1);
    const account = result.accounts[0];
    expect(account.accountId).toBe('vendor-low-1');
    expect(account.notificationChannel).toBe('WHATSAPP');
    expect(account.acknowledgementStatus).toBe('Pending');
    expect(account.deliveryStatus).toBe('Delivered');
    expect(account.notificationStatus).toBe('Delivered');
    expect(account.accountStatus).toBe('–');
  });
});
