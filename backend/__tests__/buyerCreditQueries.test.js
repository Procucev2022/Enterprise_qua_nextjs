const buyerCreditQueries = require('../src/db/buyerCreditQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');

describe('buyer credit database mutations', () => {
  let originalPool;

  const account = { id: 'buyer-credit-1', remainingFreeRFQs: 4, organizationName: 'Credit Buyer' };
  const transaction = {
    id: 'credit-add-1',
    idempotencyKey: 'credit-key-1',
    transactionType: 'Admin Credit Addition',
    creditSource: 'Category Manager Console',
    description: 'Manual credit adjustment',
  };
  const ledgerRow = {
    id: transaction.id,
    buyer_id: account.id,
    transaction_type: transaction.transactionType,
    credit_source: transaction.creditSource,
    credits_added: 5,
    credits_consumed: 0,
    payment_reference: null,
    description: transaction.description,
    previous_balance: 4,
    updated_balance: 9,
  };

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
    if (pool.queryCache) pool.queryCache.clear();
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

  test('returns null when persistence is unconfigured and rejects invalid adjustments', async () => {
    pool.pool = null;
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction })).resolves.toBeNull();

    pool.pool = {};
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 0, transaction }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CREDIT_ADJUSTMENT' });
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction: {} }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CREDIT_ADJUSTMENT' });
  });

  test('commits the account update and credit ledger in one PostgreSQL transaction', async () => {
    const updatedAccount = { ...account, remainingFreeRFQs: 9 };
    const client = configurePostgres([
      { rows: [{ raw: account }] },
      { rows: [] },
      { rows: [{ raw: updatedAccount }] },
      { rows: [{ ...ledgerRow }] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .resolves.toMatchObject({
        account: updatedAccount,
        previousBalance: 4,
        updatedBalance: 9,
        replayed: false,
        transaction: { id: transaction.id, previousBalance: 4, updatedBalance: 9 },
      });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain('UPDATE buyer_accounts');
    expect(client.query.mock.calls[3][0]).toContain('INSERT INTO buyer_credit_transactions');
  });

  test('replays the existing PostgreSQL ledger without another balance update', async () => {
    const client = configurePostgres([
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }] },
      { rows: [{ ...ledgerRow }] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .resolves.toMatchObject({ updatedBalance: 9, replayed: true, transaction: { id: ledgerRow.id } });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('replays legacy camel-case ledger rows using the same idempotency payload', async () => {
    const legacyTransaction = {
      id: transaction.id,
      idempotencyKey: transaction.idempotencyKey,
      transactionType: null,
      creditSource: undefined,
      paymentReference: 'MANUAL-admin@example.com',
      description: 'Legacy adjustment',
    };
    const legacyRow = {
      id: transaction.id,
      buyerId: account.id,
      creditsAdded: 5,
      transactionType: null,
      creditSource: 'Category Manager Console',
      paymentReference: 'MANUAL-admin@example.com',
      description: 'Legacy adjustment',
      previousBalance: 4,
      updatedBalance: 9,
    };
    configurePostgres([
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }] },
      { rows: [legacyRow] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction: legacyTransaction }))
      .resolves.toMatchObject({ replayed: true, previousBalance: 4, updatedBalance: 9 });
  });

  test('maps legacy camel-case ledger balances and valid account data', async () => {
    const minimalTransaction = { id: 'legacy-credit-tx', idempotencyKey: 'legacy-credit-key' };
    const client = configurePostgres([
      { rows: [{ raw: JSON.stringify({ id: account.id, organizationName: 'Legacy Buyer' }) }] },
      { rows: [] },
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 8 }) }] },
      { rows: [{
        id: minimalTransaction.id,
        buyer_id: account.id,
        transaction_type: null,
        credit_source: 'Category Manager Console',
        credits_added: 3,
        credits_consumed: 0,
        payment_reference: null,
        description: null,
        previousBalance: 2,
        updatedBalance: 3,
      }] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 3, transaction: minimalTransaction }))
      .resolves.toMatchObject({
        account: { id: account.id },
        previousBalance: 2,
        updatedBalance: 3,
        transaction: { id: minimalTransaction.id },
      });
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  test('defaults trial balance and optional ledger fields for legacy PostgreSQL accounts', async () => {
    const minimalTransaction = { id: 'credit-minimal', idempotencyKey: 'credit-minimal-key' };
    const client = configurePostgres([
      { rows: [{ raw: JSON.stringify({ id: account.id, organizationName: 'Legacy Buyer' }) }] },
      { rows: [] },
      { rows: [{ raw: { id: account.id, remainingFreeRFQs: 8 } }] },
      { rows: [{ id: minimalTransaction.id, previous_balance: 5, updated_balance: 8 }] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 3, transaction: minimalTransaction }))
      .resolves.toMatchObject({ previousBalance: 5, updatedBalance: 8 });
    expect(client.query.mock.calls[2][1][0]).toContain('"remainingFreeRFQs":8');
    expect(client.query.mock.calls[3][1]).toEqual(expect.arrayContaining(['Category Manager Console', 'COMPLETED']));
  });

  test('rejects an idempotency key reused for a different credit amount', async () => {
    const client = configurePostgres([
      { rows: [{ raw: account }] },
      { rows: [{ ...ledgerRow }] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 6, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  test('rejects malformed persisted account data instead of returning an empty cache value', async () => {
    configurePostgres([
      { rows: [{ raw: '{invalid-json' }] },
      { rows: [] },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 503, code: 'INVALID_PERSISTED_RECORD' });

    configurePostgres([
      { rows: [{ raw: null }] },
      { rows: [] },
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 503, code: 'INVALID_PERSISTED_RECORD' });
  });

  test('rejects missing accounts and idempotency keys already owned by another account', async () => {
    configurePostgres([{ rows: [] }]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 404, code: 'BUYER_ACCOUNT_NOT_FOUND' });

    configurePostgres([
      { rows: [{ raw: account }] },
      { rows: [{ ...ledgerRow, buyer_id: 'buyer-other' }] },
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });
  });

  test('rolls the PostgreSQL transaction back when account or ledger writes return no row', async () => {
    configurePostgres([
      { rows: [{ raw: account }] },
      { rows: [] },
      {},
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

    configurePostgres([
      { rows: [{ raw: account }] },
      { rows: [] },
      { rows: [{ raw: { ...account, remainingFreeRFQs: 9 } }] },
      {},
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });
  });

  test('uses one atomic D1 batch and returns persisted buyer and ledger data', async () => {
    const updatedAccount = { ...account, remainingFreeRFQs: 9 };
    const { binding, batch } = configureD1([
      { rows: [{ raw: JSON.stringify(updatedAccount) }], rowCount: 1 },
      { rows: [{ ...ledgerRow }], rowCount: 1 },
      { rows: [{ ...ledgerRow }], rowCount: 1 },
      { rows: [{ raw: JSON.stringify(updatedAccount) }], rowCount: 1 },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .resolves.toMatchObject({ account: updatedAccount, previousBalance: 4, updatedBalance: 9 });
    expect(batch).toHaveBeenCalledWith(binding, expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('json_set') }),
      expect.objectContaining({ text: expect.stringContaining('changes() > 0') }),
      expect.objectContaining({ text: expect.stringContaining('SELECT raw FROM buyer_accounts') }),
    ]));
  });

  test('treats an existing D1 idempotency ledger row as a successful replay', async () => {
    configureD1([
      {},
      { rows: [], rowCount: 0 },
      { rows: [{ ...ledgerRow }], rowCount: 0 },
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }], rowCount: 1 },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .resolves.toMatchObject({ updatedBalance: 9, replayed: true, transaction: { id: transaction.id } });
  });

  test('rejects D1 idempotency replay when the amount differs', async () => {
    configureD1([
      {},
      { rows: [], rowCount: 0 },
      { rows: [{ ...ledgerRow }], rowCount: 0 },
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }], rowCount: 1 },
    ]);

    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 6, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });
  });

  test('reports missing D1 accounts, cross-account key conflicts, and batch failures', async () => {
    configureD1([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 404, code: 'BUYER_ACCOUNT_NOT_FOUND' });

    configureD1([
      { rows: [] }, { rows: [] }, { rows: [{ ...ledgerRow, buyer_id: 'buyer-other' }] }, { rows: [{ raw: account }] },
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });

    configureD1([
      { rows: [{ raw: JSON.stringify(account) }] },
      { rows: [], rowCount: 0 },
      { rows: [] },
      { rows: [{ raw: JSON.stringify(account) }] },
    ]);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_IDEMPOTENCY_CONFLICT' });

    const { batch } = configureD1([]);
    const batchError = new Error('D1 unavailable');
    batch.mockRejectedValueOnce(batchError);
    await expect(buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction }))
      .rejects.toBe(batchError);
  });

  test('executes multi-statement adjustments through the atomic D1 HTTP adapter', async () => {
    pool.pool = {};
    const httpClientMock = { _isHttpClient: true };
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(httpClientMock);
    const batchMock = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }] },
      { rows: [{ ...ledgerRow }] },
      { rows: [{ ...ledgerRow }] },
      { rows: [{ raw: JSON.stringify({ ...account, remainingFreeRFQs: 9 }) }] },
    ]);

    const result = await buyerCreditQueries.addBuyerCreditsInDB({ buyerId: account.id, amount: 5, transaction });
    expect(batchMock).toHaveBeenCalledWith(httpClientMock, expect.any(Array));
    expect(result).toMatchObject({ updatedBalance: 9 });
  });
});
