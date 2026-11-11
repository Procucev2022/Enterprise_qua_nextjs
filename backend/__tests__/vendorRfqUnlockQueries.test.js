const vendorRfqUnlockQueries = require('../src/db/vendorRfqUnlockQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');

describe('atomic vendor RFQ unlock persistence', () => {
  let originalPool;
  const baseVendor = {
    id: 'vendor-unlock-1',
    email: 'unlock@vendor.test',
    subscriptionPlan: 'premium',
    freeQuotationCredits: 2,
    freeRfqDownloadCredits: 2,
    freeCreditsAllocated: 2,
    freeCreditsUsed: 0,
    rfqDownloadsUsed: 0,
    unlockedRfqIds: [],
  };
  const options = {
    vendorId: baseVendor.id,
    rfqId: 'rfq-unlock-1',
    rfqNumber: 'RFQ-UNLOCK-1',
    unlockId: 'unlock-record-1',
    transactionId: 'unlock-transaction-1',
    idempotencyKey: `tx-${baseVendor.id}-rfq-unlock-1`,
  };
  const unlockRow = {
    id: options.unlockId,
    vendor_id: options.vendorId,
    rfq_id: options.rfqId,
    credit_charged: 1,
    source: 'free_credit',
  };
  const ledgerRow = {
    id: options.transactionId,
    vendor_id: options.vendorId,
    rfq_id: options.rfqId,
    transaction_type: 'RFQ_UNLOCK',
    amount: -1,
    balance_after: 1,
    idempotency_key: options.idempotencyKey,
  };

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
    pool.queryCache.clear();
  });

  function configurePostgres(results) {
    const client = { query: jest.fn() };
    results.forEach((result) => client.query.mockResolvedValueOnce(result));
    pool.pool = {};
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));
    return client;
  }

  function configureD1(results) {
    const binding = {};
    pool.pool = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue(results);
    return { binding, batch };
  }

  function d1Results({
    vendor = baseVendor,
    existingUnlock = null,
    existingLedger = null,
    updated = null,
    insertedUnlock = null,
    insertedLedger = null,
    finalVendor = updated || vendor,
    finalUnlock = insertedUnlock || existingUnlock,
    finalLedger = insertedLedger || existingLedger,
  } = {}) {
    const raw = (value) => ({ rows: value ? [{ raw: JSON.stringify(value) }] : [], rowCount: value ? 1 : 0 });
    const row = (value) => ({ rows: value ? [value] : [], rowCount: value ? 1 : 0 });
    return [
      raw(vendor),
      row(existingUnlock),
      row(existingLedger),
      raw(updated),
      row(insertedUnlock),
      row(insertedLedger),
      raw(finalVendor),
      row(finalUnlock),
      row(finalLedger),
    ];
  }

  test('returns null without storage and rejects missing identifiers', async () => {
    pool.pool = null;
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toBeNull();

    pool.pool = {};
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB({ vendorId: options.vendorId }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_VENDOR_RFQ_UNLOCK' });
  });

  test('commits the vendor balance, unlock and debit ledger in one PostgreSQL transaction', async () => {
    const updatedVendor = {
      ...baseVendor,
      freeQuotationCredits: 1,
      freeRfqDownloadCredits: 1,
      freeCreditsUsed: 1,
      rfqDownloadsUsed: 1,
      unlockedRfqIds: [options.rfqId, options.rfqNumber],
    };
    const client = configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ raw: updatedVendor }] },
      { rows: [unlockRow] },
      { rows: [ledgerRow] },
    ]);

    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      success: true,
      creditCharged: 1,
      freeCreditsRemaining: 1,
      vendor: updatedVendor,
      unlock: unlockRow,
      transaction: ledgerRow,
    });
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[3][0]).toContain('UPDATE vendors SET raw');
    expect(client.query.mock.calls[4][0]).toContain('INSERT INTO rfq_unlocks');
    expect(client.query.mock.calls[5][0]).toContain('INSERT INTO vendor_credit_transactions');
  });

  test('returns existing PostgreSQL unlocks without a second balance or ledger write', async () => {
    const client = configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [unlockRow] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      alreadyUnlocked: true,
      creditCharged: 0,
      freeCreditsRemaining: 2,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('treats raw unlocked IDs as a replay and supports legacy JSON text', async () => {
    const client = configurePostgres([
      { rows: [{ raw: JSON.stringify({ ...baseVendor, unlockedRfqIds: [options.rfqNumber] }) }] },
      { rows: [] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({ alreadyUnlocked: true });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('returns missing and exhausted PostgreSQL vendors without writing', async () => {
    const missing = configurePostgres([{ rows: [] }]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toBeNull();
    expect(missing.query).toHaveBeenCalledTimes(1);

    const exhaustedVendor = { ...baseVendor, freeQuotationCredits: 0 };
    const exhausted = configurePostgres([
      { rows: [{ raw: exhaustedVendor }] },
      { rows: [] },
      { rows: [] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      success: false,
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });
    expect(exhausted.query).toHaveBeenCalledTimes(3);
  });

  test('rejects an orphan ledger and rolls back incomplete PostgreSQL mutations', async () => {
    configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
      { rows: [{ ...ledgerRow }] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options))
      .rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_CREDIT_STATE_INCONSISTENT' });

    configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toThrow('balance update returned no persisted row');

    configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toThrow('unlock was not recorded');

    configurePostgres([
      { rows: [{ raw: baseVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ raw: { ...baseVendor, freeQuotationCredits: 1 } }] },
      { rows: [unlockRow] },
      { rows: [] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toThrow('credit ledger was not recorded');
  });

  test('supports subscription and unlimited entitlement without charging free credits', async () => {
    const subscribedVendor = { ...baseVendor, subscriptionPlan: 'select', freeQuotationCredits: 0, rfqDownloadsUsed: 3 };
    const updatedVendor = {
      ...subscribedVendor,
      rfqDownloadsUsed: 4,
      unlockedRfqIds: [options.rfqId, options.rfqNumber],
    };
    const client = configurePostgres([
      { rows: [{ raw: subscribedVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ raw: updatedVendor }] },
      { rows: [{ ...unlockRow, credit_charged: 0, source: 'subscription' }] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      creditCharged: 0,
      source: 'subscription',
      freeCreditsRemaining: 96,
    });
    expect(client.query).toHaveBeenCalledTimes(5);

    const unlimitedVendor = { ...baseVendor, unlimitedDownloads: true, freeQuotationCredits: 0 };
    const unlimitedUpdated = { ...unlimitedVendor, rfqDownloadsUsed: 1, unlockedRfqIds: [options.rfqId, options.rfqNumber] };
    configurePostgres([
      { rows: [{ raw: unlimitedVendor }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ raw: unlimitedUpdated }] },
      { rows: [{ ...unlockRow, credit_charged: 0, source: 'unlimited_entitlement' }] },
    ]);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      creditCharged: 0,
      freeCreditsRemaining: 999999,
    });
  });

  test('uses one atomic D1 batch with duplicate and balance guards', async () => {
    const updatedVendor = {
      ...baseVendor,
      freeQuotationCredits: 1,
      freeRfqDownloadCredits: 1,
      freeCreditsUsed: 1,
      rfqDownloadsUsed: 1,
      unlockedRfqIds: [options.rfqId, options.rfqNumber],
    };
    const { binding, batch } = configureD1(d1Results({
      updated: updatedVendor,
      insertedUnlock: unlockRow,
      insertedLedger: ledgerRow,
      finalVendor: updatedVendor,
    }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      success: true,
      creditCharged: 1,
      freeCreditsRemaining: 1,
      vendor: updatedVendor,
    });
    expect(batch).toHaveBeenCalledWith(binding, expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('changes() > 0') }),
      expect.objectContaining({ text: expect.stringContaining('json_each') }),
      expect.objectContaining({ text: expect.stringContaining('vendor_credit_transactions') }),
    ]));
    expect(batch.mock.calls[0][1]).toHaveLength(9);
  });

  test('handles D1 replays, legacy raw IDs, exhaustion and missing vendors', async () => {
    configureD1(d1Results({ existingUnlock: unlockRow }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({ alreadyUnlocked: true });

    configureD1(d1Results({ vendor: { ...baseVendor, unlockedRfqIds: [options.rfqId] } }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({ alreadyUnlocked: true });

    const noCredits = { ...baseVendor, freeQuotationCredits: 0 };
    configureD1(d1Results({ vendor: noCredits, finalVendor: noCredits }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toMatchObject({
      success: false,
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });

    configureD1(d1Results({ vendor: null, finalVendor: null }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).resolves.toBeNull();
  });

  test('rejects D1 orphan ledger and reports incomplete D1 batch results', async () => {
    configureD1(d1Results({ existingLedger: ledgerRow }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options))
      .rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_CREDIT_STATE_INCONSISTENT' });

    configureD1(d1Results({
      updated: { ...baseVendor, freeQuotationCredits: 1 },
      finalVendor: { ...baseVendor, freeQuotationCredits: 1 },
    }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toThrow('unlock was not recorded');

    configureD1(d1Results({
      updated: { ...baseVendor, freeQuotationCredits: 1 },
      insertedUnlock: unlockRow,
      finalVendor: { ...baseVendor, freeQuotationCredits: 1 },
    }));
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toThrow('credit ledger was not recorded');
  });

  test('rejects the non-atomic D1 HTTP adapter and logs a D1 batch failure', async () => {
    pool.pool = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options))
      .rejects.toMatchObject({ statusCode: 503, code: 'ATOMIC_PERSISTENCE_REQUIRED' });

    configureD1([]);
    const failure = new Error('D1 batch unavailable');
    jest.spyOn(d1Bridge, 'batchD1').mockRejectedValueOnce(failure);
    await expect(vendorRfqUnlockQueries.unlockVendorRfqInDB(options)).rejects.toBe(failure);
  });

  test('calculates free, plan and unlimited credit state and rejects invalid raw JSON', () => {
    expect(vendorRfqUnlockQueries.vendorCreditState(baseVendor)).toMatchObject({ shouldCharge: true, remaining: 2 });
    expect(vendorRfqUnlockQueries.vendorCreditState({ subscriptionPlan: 'connect', rfqDownloadsUsed: 4 }))
      .toMatchObject({ shouldCharge: false, remaining: 46 });
    expect(vendorRfqUnlockQueries.vendorCreditState({ unlimitedAccess: true })).toMatchObject({ unlimited: true, remaining: 999999 });
    expect(vendorRfqUnlockQueries.vendorCreditState({ freeQuotationCredits: 'invalid' })).toMatchObject({ remaining: 0 });
    expect(vendorRfqUnlockQueries.parseVendorRaw('null')).toEqual({});
    expect(() => vendorRfqUnlockQueries.parseVendorRaw('{invalid')).toThrow('invalid JSON');
  });
});
