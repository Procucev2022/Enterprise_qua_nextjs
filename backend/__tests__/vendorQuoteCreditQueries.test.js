const quoteCreditQueries = require('../src/db/vendorQuoteCreditQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');

const baseVendor = {
  id: 'vendor-quote-credit-1',
  subscriptionPlan: 'premium',
  freeQuotationCredits: 2,
  freeRfqDownloadCredits: 2,
  quotedRfqIds: [],
  unlockedRfqIds: [],
};
const options = {
  vendorId: baseVendor.id,
  rfqId: 'rfq-quote-credit-1',
  rfqNumber: 'RFQ-QUOTE-CREDIT-1',
  transactionId: 'quote-transaction-1',
  idempotencyKey: 'rfq-quote:vendor-quote-credit-1:rfq-quote-credit-1',
  isBuyerMapped: false,
};
const raw = (value) => ({ rows: value ? [{ raw: typeof value === 'string' ? value : JSON.stringify(value) }] : [], rowCount: value ? 1 : 0 });
const row = (value) => ({ rows: value ? [value] : [], rowCount: value ? 1 : 0 });

describe('atomic vendor quote credit persistence', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    pool.queryCache.clear();
    jest.restoreAllMocks();
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

  function d1Results({ vendor = baseVendor, existingLedger = null, updated = null, insertedLedger = null, finalVendor = updated || vendor, finalLedger = insertedLedger || existingLedger } = {}) {
    return [raw(vendor), row(existingLedger), raw(updated), row(insertedLedger), raw(finalVendor), row(finalLedger)];
  }

  test('validates object parsing and quote credit eligibility', () => {
    expect(quoteCreditQueries.parseVendorRaw(JSON.stringify(baseVendor))).toEqual(baseVendor);
    expect(quoteCreditQueries.parseVendorRaw({ id: 'v' })).toEqual({ id: 'v' });
    expect(quoteCreditQueries.parseVendorRaw(null)).toEqual({});
    expect(quoteCreditQueries.parseVendorRaw('[]')).toEqual({});
    expect(() => quoteCreditQueries.parseVendorRaw('bad-json')).toThrow('Persisted vendor profile contains invalid JSON');
    expect(quoteCreditQueries.quoteCreditState(baseVendor, false)).toEqual({ balance: 2, shouldCharge: true });
    expect(quoteCreditQueries.quoteCreditState({ ...baseVendor, subscriptionPlan: 'connect' }, false).shouldCharge).toBe(false);
    expect(quoteCreditQueries.quoteCreditState(baseVendor, true).shouldCharge).toBe(false);
    expect(quoteCreditQueries.quoteCreditState(baseVendor, false, true).shouldCharge).toBe(false);
    expect(quoteCreditQueries.quoteCreditState({ ...baseVendor, freeQuotationCredits: 'bad' }, false).balance).toBe(0);
    expect(quoteCreditQueries.quoteCreditState({}, false).balance).toBeGreaterThanOrEqual(0);
  });

  test('returns null without storage and rejects invalid input', async () => {
    pool.pool = null;
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toBeNull();
    pool.pool = {};
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB({ vendorId: options.vendorId }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_VENDOR_QUOTE_CREDIT' });
  });

  test('debits one quote credit and writes its ledger in one PostgreSQL transaction', async () => {
    const savedVendor = { ...baseVendor, freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [options.rfqId], unlockedRfqIds: [options.rfqId, options.rfqNumber] };
    const ledger = { id: options.transactionId, transaction_type: 'RFQ_QUOTE', amount: -1, balance_after: 1 };
    const client = configurePostgres([raw(baseVendor), row(null), raw(savedVendor), row(ledger)]);

    const result = await quoteCreditQueries.recordVendorQuoteCreditInDB(options);

    expect(result).toMatchObject({ vendor: savedVendor, creditCharged: 1, alreadyQuoted: false });
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain('UPDATE vendors');
    expect(client.query.mock.calls[3][0]).toContain("'RFQ_QUOTE'");
    expect(client.query.mock.calls[3][1]).toEqual([options.transactionId, options.vendorId, options.rfqId, -1, 1, options.idempotencyKey]);
  });

  test('records a zero-charge first quote for mapped or subscribed vendors', async () => {
    const mappedVendor = { ...baseVendor, quotedRfqIds: [options.rfqId], unlockedRfqIds: [options.rfqId] };
    const client = configurePostgres([raw(baseVendor), row(null), raw(mappedVendor), row({ amount: 0 })]);
    const result = await quoteCreditQueries.recordVendorQuoteCreditInDB({ ...options, isBuyerMapped: true });
    expect(result.creditCharged).toBe(0);
    expect(client.query.mock.calls[3][1][3]).toBe(-0);
  });

  test('fills missing tracking arrays and avoids duplicating an existing unlock marker', async () => {
    const noArrays = { id: baseVendor.id, freeQuotationCredits: 1, freeRfqDownloadCredits: 1 };
    const savedNoArrays = { ...noArrays, freeQuotationCredits: 0, freeRfqDownloadCredits: 0, quotedRfqIds: [options.rfqId], unlockedRfqIds: [options.rfqId] };
    configurePostgres([raw(noArrays), row(null), raw(savedNoArrays), row({ amount: -1 })]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB({ ...options, rfqNumber: null })).resolves.toMatchObject({ vendor: savedNoArrays });

    const alreadyUnlocked = { ...baseVendor, unlockedRfqIds: [options.rfqId, options.rfqNumber] };
    const savedExistingUnlock = { ...alreadyUnlocked, freeQuotationCredits: 1, quotedRfqIds: [options.rfqId] };
    configurePostgres([raw(alreadyUnlocked), row(null), raw(savedExistingUnlock), row({ amount: -1 })]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ vendor: savedExistingUnlock });
  });

  test('returns null for a missing PostgreSQL vendor and returns existing quote idempotently', async () => {
    configurePostgres([raw(null)]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toBeNull();

    configurePostgres([raw({ ...baseVendor, quotedRfqIds: [options.rfqId] }), row(null)]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true, creditCharged: 0 });
  });

  test('returns existing ledger idempotently and rejects exhausted balances', async () => {
    configurePostgres([raw(baseVendor), row({ id: 'existing' })]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true });

    configurePostgres([raw({ ...baseVendor, freeQuotationCredits: 0 }), row(null)]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ creditsExhausted: true, freeCreditsRemaining: 0 });
  });

  test('rejects a missing PostgreSQL row or ledger after starting the transaction', async () => {
    configurePostgres([raw(baseVendor), row(null), raw(null)]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('Vendor quote credit update returned no persisted row');

    configurePostgres([raw(baseVendor), row(null), raw({ ...baseVendor, quotedRfqIds: [options.rfqId] }), row(null)]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('Vendor quote credit ledger was not recorded');
  });

  test('returns null, idempotent result, and a charged result from D1 batches', async () => {
    configureD1(d1Results({ vendor: null }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toBeNull();

    configureD1(d1Results({ vendor: { ...baseVendor, quotedRfqIds: [options.rfqId] } }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true });

    const updated = { ...baseVendor, freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [options.rfqId], unlockedRfqIds: [options.rfqId, options.rfqNumber] };
    const ledger = { amount: -1, balance_after: 1 };
    const { batch, binding } = configureD1(d1Results({ updated, insertedLedger: ledger }));
    const result = await quoteCreditQueries.recordVendorQuoteCreditInDB(options);
    expect(result).toMatchObject({ vendor: updated, creditCharged: 1 });
    expect(batch).toHaveBeenCalledWith(binding, expect.any(Array));
    const batchStatements = quoteCreditQueries.makeD1VendorQuoteCreditStatements(options).statements;
    expect(batchStatements).toHaveLength(6);
    expect(batchStatements[2].text).toContain("'$.quotedRfqIds'");
    expect(batchStatements[2].text).toContain('NOT EXISTS (SELECT 1 FROM vendor_credit_transactions');
    expect(batchStatements[3].text).toContain("'RFQ_QUOTE'");
  });

  test('handles D1 ledger replay, exhausted balance, and inconsistent batch results', async () => {
    configureD1(d1Results({ existingLedger: { amount: -1 } }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true });

    configureD1(d1Results({ vendor: { ...baseVendor, freeQuotationCredits: 0 }, finalVendor: { ...baseVendor, freeQuotationCredits: 0 } }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ creditsExhausted: true });

    configureD1(d1Results({ updated: baseVendor, insertedLedger: null }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('D1 vendor quote credit ledger was not recorded');

    configureD1([
      raw(baseVendor),
      row(null),
      raw(null),
      row(null),
      raw(baseVendor),
      row({ id: options.transactionId, amount: -1 }),
    ]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true });

    configureD1(d1Results({ vendor: baseVendor, updated: baseVendor, insertedLedger: { amount: 0 }, finalVendor: baseVendor }));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB({ ...options, isResubmission: true }))
      .resolves.toMatchObject({ creditCharged: 0 });

    const statementOptions = quoteCreditQueries.makeD1VendorQuoteCreditStatements({
      ...options,
      rfqNumber: null,
      isBuyerMapped: true,
      isResubmission: true,
    });
    expect(statementOptions.params[2]).toBeNull();
    expect(statementOptions.params[5]).toBe(1);
    expect(statementOptions.params[6]).toBe(1);

    configureD1([
      raw(baseVendor),
      row(null),
      raw({ id: baseVendor.id, quotedRfqIds: [options.rfqId] }),
      row({ amount: 0 }),
      raw(null),
      row({ amount: 0 }),
    ]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: false, creditCharged: 0 });

    configureD1([
      raw(baseVendor),
      row(null),
      raw(null),
      row(null),
      raw(null),
      row(null),
    ]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('D1 vendor quote credit update did not return a persisted row');

    configureD1([
      raw(baseVendor),
      row(null),
      raw(null),
      row(null),
      raw({ ...baseVendor, quotedRfqIds: [options.rfqId] }),
      row(null),
    ]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ alreadyQuoted: true });

    configureD1([
      raw({ ...baseVendor, freeQuotationCredits: 0 }),
      row(null),
      raw(null),
      row(null),
      raw(null),
      row(null),
    ]);
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).resolves.toMatchObject({ creditsExhausted: true });
  });

  test('rejects the non-atomic D1 HTTP adapter and logs batch failures', async () => {
    pool.pool = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({});
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toMatchObject({
      statusCode: 503,
      code: 'ATOMIC_PERSISTENCE_REQUIRED',
    });

    const { batch } = configureD1([]);
    batch.mockRejectedValueOnce(new Error('batch failed'));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('batch failed');
  });

  test('surfaces PostgreSQL transaction failures', async () => {
    pool.pool = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'withTransaction').mockRejectedValue(new Error('transaction failed'));
    await expect(quoteCreditQueries.recordVendorQuoteCreditInDB(options)).rejects.toThrow('transaction failed');
  });
});
