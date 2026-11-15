const buyerRfqCreationQueries = require('../src/db/buyerRfqCreationQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');

describe('atomic buyer RFQ creation and free-credit accounting', () => {
  let originalPool;
  const buyer = { id: 'buyer-rfq-1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 };
  const rfq = {
    id: 'rfq-credit-1',
    rfqNumber: 'RFQ-CREDIT-1',
    category: 'Machinery',
    status: 'Quotes Pending',
    sourcingMode: 'mode_2',
    budget: 12000,
    buyerAccountId: buyer.id,
  };
  const transaction = {
    id: 'credit-rfq-transaction-1',
    buyer_id: buyer.id,
    rfq_id: rfq.id,
    transaction_type: 'RFQ_CREATE',
    credits_consumed: 1,
    previous_balance: 2,
    updated_balance: 1,
    idempotency_key: `rfq-create-credit:${buyer.id}:${rfq.id}`,
  };
  const savedRfq = { ...rfq };
  const updatedBuyer = { ...buyer, remainingFreeRFQs: 1 };

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
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
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

  function row(value) {
    return { rows: value ? [value] : [], rowCount: value ? 1 : 0 };
  }

  function d1Results({
    account = buyer,
    existingRfq = null,
    existingLedger = null,
    updatedAccount = null,
    insertedLedger = null,
    insertedRfq = null,
    finalAccount = updatedAccount || account,
    finalRfq = insertedRfq || existingRfq,
    finalLedger = insertedLedger || existingLedger,
  } = {}) {
    const raw = (value) => row(value ? { raw: JSON.stringify(value) } : null);
    return [
      raw(account),
      raw(existingRfq),
      row(existingLedger),
      raw(updatedAccount),
      row(insertedLedger),
      raw(insertedRfq),
      raw(finalAccount),
      raw(finalRfq),
      row(finalLedger),
    ];
  }

  test('does not write without storage and validates identifiers before persistence', async () => {
    pool.pool = null;
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id })).resolves.toBeNull();

    pool.pool = {};
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: '' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BUYER_RFQ_CREATE' });
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({})).rejects.toMatchObject({ statusCode: 400 });
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq: {}, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BUYER_RFQ_CREATE' });
  });

  test('normalizes persisted JSON records, buyer ownership aliases, and credit defaults', () => {
    expect(buyerRfqCreationQueries.parseRaw({ id: 'object' })).toEqual({ id: 'object' });
    expect(buyerRfqCreationQueries.parseRaw('null')).toEqual({});
    expect(buyerRfqCreationQueries.parseRaw('[]')).toEqual({});
    expect(buyerRfqCreationQueries.parseRaw(null)).toEqual({});
    expect(buyerRfqCreationQueries.parseRaw([])).toEqual({});
    expect(buyerRfqCreationQueries.parseRaw('3')).toEqual({});
    expect(buyerRfqCreationQueries.transactionKey(buyer.id, rfq.id)).toBe(`rfq-create-credit:${buyer.id}:${rfq.id}`);
    expect(buyerRfqCreationQueries.creditState({}, undefined)).toMatchObject({ plan: 'free_trial', remaining: 5 });
    expect(buyerRfqCreationQueries.creditState({ remainingFreeRFQs: 'not-a-number' }, 'mode_1').remaining).toBe(0);
    expect(() => buyerRfqCreationQueries.assertRfqOwnership({ buyerId: buyer.id }, buyer, buyer.id)).not.toThrow();
    expect(() => buyerRfqCreationQueries.assertRfqOwnership({ buyer_account_id: buyer.id }, buyer, buyer.id)).not.toThrow();
    expect(() => buyerRfqCreationQueries.assertRfqOwnership(
      { buyerEmail: 'BUYER@EXAMPLE.TEST' },
      { corporateEmail: 'buyer@example.test' },
      buyer.id
    )).not.toThrow();
    expect(() => buyerRfqCreationQueries.assertRfqOwnership(
      { sourceEmail: 'buyer@example.test' },
      { email: 'buyer@example.test' },
      buyer.id
    )).not.toThrow();
    expect(() => buyerRfqCreationQueries.assertRfqOwnership({}, {}, buyer.id, true)).not.toThrow();
    expect(() => buyerRfqCreationQueries.assertRfqOwnership({}, {}, buyer.id)).toThrow('no verifiable owner');
    expect(buyerRfqCreationQueries.successResult({ rfq, account: {}, transaction: null }))
      .toMatchObject({ replayed: false, credit: { consumed: false, remaining: 5, transaction: null } });
  });

  test('commits a trial debit, ledger row and RFQ in one PostgreSQL transaction', async () => {
    const client = configurePostgres([
      row({ raw: buyer }), row(null), row(null), row({ raw: updatedBuyer }),
      row(transaction), row({ raw: savedRfq }),
    ]);

    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id })).resolves.toMatchObject({
      success: true,
      rfq: savedRfq,
      account: updatedBuyer,
      credit: { consumed: true, remaining: 1 },
    });
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[3][0]).toContain('UPDATE buyer_accounts');
    expect(client.query.mock.calls[4][0]).toContain('INSERT INTO buyer_credit_transactions');
    expect(client.query.mock.calls[5][0]).toContain('INSERT INTO rfqs');
  });

  test('replays RFQ and credit ledger without another debit', async () => {
    const client = configurePostgres([
      row({ raw: updatedBuyer }), row({ raw: savedRfq }), row(transaction),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, replayed: true, credit: { consumed: true, remaining: 1 } });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('replays a legacy RFQ without charging again when it has no credit ledger', async () => {
    const client = configurePostgres([row({ raw: updatedBuyer }), row({ raw: savedRfq }), row(null)]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, replayed: true, credit: { consumed: false } });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('rejects an existing RFQ owned by another buyer before returning its data', async () => {
    configurePostgres([
      row({ raw: buyer }),
      row({ raw: { ...savedRfq, buyerAccountId: 'buyer-other' } }),
      row(null),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });
  });

  test('restores an RFQ whose matching credit ledger already exists', async () => {
    const client = configurePostgres([
      row({ raw: updatedBuyer }), row(null), row(transaction), row({ raw: { ...savedRfq, buyerAccountId: undefined } }),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, replayed: true, rfq: { id: savedRfq.id }, credit: { remaining: 1 } });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO rfqs');
  });

  test('rejects a matching orphan-ledger repair when the RFQ insert does not return a row', async () => {
    configurePostgres([row({ raw: updatedBuyer }), row(null), row(transaction), row(null)]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });
  });

  test('rejects an exhausted trial without issuing a write', async () => {
    const exhaustedBuyer = { ...buyer, remainingFreeRFQs: 0 };
    const client = configurePostgres([row({ raw: exhaustedBuyer }), row(null), row(null)]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: false, creditsExhausted: true, remaining: 0 });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  test('does not charge V0, paid or unlimited accounts and defaults legacy balance to five', async () => {
    expect(buyerRfqCreationQueries.creditState({ ...buyer, remainingFreeRFQs: undefined }, 'mode_2'))
      .toMatchObject({ shouldCharge: true, remaining: 5 });
    expect(buyerRfqCreationQueries.creditState(buyer, 'version_0').shouldCharge).toBe(false);
    expect(buyerRfqCreationQueries.creditState({ ...buyer, subscriptionPlan: 'version_2' }, 'mode_2').shouldCharge).toBe(false);
    expect(buyerRfqCreationQueries.creditState({ ...buyer, unlimitedRfqAccess: true }, 'mode_2').shouldCharge).toBe(false);

    const paidAccount = { ...buyer, subscriptionPlan: 'version_2', remainingFreeRFQs: 0 };
    const client = configurePostgres([
      row({ raw: paidAccount }), row(null), row(null), row({ raw: savedRfq }),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({
      rfq: { id: rfq.id, sourcingMode: 'mode_0', budget: 'invalid' },
      buyerId: buyer.id,
    })).resolves.toMatchObject({ success: true, credit: { consumed: false } });
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  test('rejects missing accounts, malformed records, idempotency conflicts and incomplete writes', async () => {
    configurePostgres([row(null)]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 404, code: 'BUYER_ACCOUNT_NOT_FOUND' });

    configurePostgres([row({ raw: '{bad json' })]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ code: 'INVALID_PERSISTED_RECORD' });

    configurePostgres([row({ raw: buyer }), row(null), row({ ...transaction, buyer_id: 'another-buyer' })]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });

    configurePostgres([row({ raw: buyer }), row(null), row(null), row(null)]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toThrow('credit update returned no row');

    configurePostgres([
      row({ raw: buyer }), row(null), row(null), row({ raw: updatedBuyer }), row(null),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });

    configurePostgres([
      row({ raw: buyer }), row(null), row(null), row({ raw: updatedBuyer }), row(transaction), row(null),
    ]);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });
  });

  test('builds D1 conditional statements with consistent raw scope and parameter positions', () => {
    const statements = buyerRfqCreationQueries.makeD1Statements({ rfq, buyerId: buyer.id, transactionId: 'tx', idempotencyKey: 'key' });
    expect(statements).toHaveLength(9);
    expect(statements[3].text).toContain("json_extract(raw, '$.remainingFreeRFQs')");
    expect(statements[4].text).toContain('changes() > 0');
    expect(statements[5].text).toContain('SELECT raw FROM buyer_accounts WHERE id = $1');
    expect(statements[5].text).toContain('json_extract((SELECT raw FROM buyer_accounts WHERE id = $1)');
    expect(statements.every((statement) => statement.params[0] === buyer.id)).toBe(true);
    const sparse = buyerRfqCreationQueries.makeD1Statements({
      rfq: { id: rfq.id, budget: 'invalid' },
      buyerId: buyer.id,
      transactionId: 'tx',
      idempotencyKey: 'key',
    });
    expect(sparse[0].params.slice(2, 8)).toEqual([null, null, null, null, null, JSON.stringify({ id: rfq.id, budget: 'invalid' })]);
  });

  test('commits the buyer debit, ledger and RFQ in one D1 batch', async () => {
    const { binding, batch } = configureD1(d1Results({
      updatedAccount: updatedBuyer,
      insertedLedger: transaction,
      insertedRfq: savedRfq,
    }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, account: updatedBuyer, rfq: savedRfq, credit: { consumed: true, remaining: 1 } });
    expect(batch).toHaveBeenCalledWith(binding, expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('json_set') }),
      expect.objectContaining({ text: expect.stringContaining('changes() > 0') }),
      expect.objectContaining({ text: expect.stringContaining('INSERT INTO rfqs') }),
    ]));
  });

  test('returns D1 replays and handles paid plans without writing a credit ledger', async () => {
    configureD1(d1Results({
      account: updatedBuyer,
      existingRfq: savedRfq,
      existingLedger: transaction,
    }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, replayed: true, credit: { consumed: true } });

    const paid = { ...buyer, subscriptionPlan: 'version_1', remainingFreeRFQs: 0 };
    configureD1(d1Results({ account: paid, insertedRfq: savedRfq, finalRfq: savedRfq }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq: { ...rfq, sourcingMode: 'mode_0' }, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, credit: { consumed: false } });
  });

  test('returns D1 exhaustion, missing-account and idempotency-conflict outcomes', async () => {
    const exhausted = { ...buyer, remainingFreeRFQs: 0 };
    configureD1(d1Results({ account: exhausted, finalAccount: exhausted }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: false, creditsExhausted: true, remaining: 0 });

    configureD1(d1Results({ account: null, finalAccount: null }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 404, code: 'BUYER_ACCOUNT_NOT_FOUND' });

    configureD1(d1Results({ existingLedger: { ...transaction, buyer_id: 'another-buyer' } }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });

    configureD1(d1Results({
      existingRfq: { ...savedRfq, buyerAccountId: 'buyer-other' },
    }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });

    configureD1(d1Results({ insertedRfq: savedRfq, finalAccount: null, finalRfq: null, finalLedger: null }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_RFQ_CREDIT_CONFLICT' });
  });

  test('reports D1 writes that return no durable RFQ while credits remain', async () => {
    configureD1(d1Results({
      updatedAccount: { ...buyer, remainingFreeRFQs: 1 },
      insertedRfq: null,
      insertedLedger: null,
      finalRfq: null,
      finalLedger: null,
    }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toThrow('did not produce a durable row');
  });

  test('executes D1 atomic batch with D1 HTTP client and preserves database batch errors', async () => {
    pool.pool = {};
    const httpClientMock = { _isHttpClient: true };
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(httpClientMock);
    const batchMock = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue(d1Results({
      updatedAccount: { ...buyer, remainingFreeRFQs: 4 },
      insertedLedger: transaction,
      insertedRfq: savedRfq,
    }));
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .resolves.toMatchObject({ success: true, replayed: false, credit: { consumed: true } });
    expect(batchMock).toHaveBeenCalledWith(httpClientMock, expect.any(Array));

    const failure = new Error('D1 unavailable');
    batchMock.mockRejectedValueOnce(failure);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id })).rejects.toBe(failure);
  });

  test('fails closed with 503 DATABASE_UNAVAILABLE when storage exists but no database client is available', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    pool.pool = null;
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    await expect(buyerRfqCreationQueries.createRFQWithCreditInDB({ rfq, buyerId: buyer.id }))
      .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
  });
});
