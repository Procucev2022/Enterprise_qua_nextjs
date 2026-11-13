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
