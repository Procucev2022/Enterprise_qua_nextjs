const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('durable buyer credit additions', () => {
  let previousAccounts;
  let previousActiveAccount;
  let hasStorageSpy;
  let addCreditsSpy;

  beforeEach(() => {
    previousAccounts = storeService.buyerAccounts;
    previousActiveAccount = storeService.activeBuyerAccount;
    storeService.buyerAccounts = [];
    storeService.activeBuyerAccount = null;
    hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    addCreditsSpy = jest.spyOn(domainQueries, 'addBuyerCreditsInDB');
  });

  afterEach(() => {
    storeService.buyerAccounts = previousAccounts;
    storeService.activeBuyerAccount = previousActiveAccount;
    jest.restoreAllMocks();
  });

  test('updates buyer and active-account caches only after the atomic database write', async () => {
    const account = { id: 'buyer-credit-store', remainingFreeRFQs: 9 };
    const previous = { id: account.id, remainingFreeRFQs: 4 };
    const transaction = { id: 'credit-ledger-row' };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    addCreditsSpy.mockImplementation(async () => {
      await gate;
      return { account, previousBalance: 4, updatedBalance: 9, transaction, replayed: false };
    });
    storeService.buyerAccounts.push(previous);
    storeService.activeBuyerAccount = previous;

    const pending = storeService.addBuyerCreditsDurably(account.id, 5, transaction);
    expect(storeService.buyerAccounts[0]).toBe(previous);
    expect(storeService.activeBuyerAccount).toBe(previous);
    expect(addCreditsSpy).toHaveBeenCalledWith({ buyerId: account.id, amount: 5, transaction });
    release();

    await expect(pending).resolves.toMatchObject({
      account,
      previousBalance: 4,
      updatedBalance: 9,
      replayed: false,
    });
    expect(storeService.buyerAccounts[0]).toBe(account);
    expect(storeService.activeBuyerAccount).toBe(account);
    expect(hasStorageSpy).toHaveBeenCalled();
  });

  test('preserves cached balances and returns a retryable error when persistence fails', async () => {
    const account = { id: 'buyer-credit-store', remainingFreeRFQs: 4 };
    storeService.buyerAccounts.push(account);
    storeService.activeBuyerAccount = account;
    addCreditsSpy.mockRejectedValue(Object.assign(new Error('D1 unavailable'), {
      statusCode: 503,
      code: 'ATOMIC_PERSISTENCE_REQUIRED',
    }));

    await expect(storeService.addBuyerCreditsDurably(account.id, 5, { id: 'credit-tx' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'ATOMIC_PERSISTENCE_REQUIRED', retryable: true });
    expect(storeService.buyerAccounts[0]).toBe(account);
    expect(storeService.activeBuyerAccount).toBe(account);
  });

  test('updates local cache without a database and returns null for an unknown buyer', async () => {
    hasStorageSpy.mockReturnValue(false);
    const account = { id: 'buyer-credit-local', remainingFreeRFQs: 2 };
    storeService.buyerAccounts.push(account);
    storeService.activeBuyerAccount = account;

    await expect(storeService.addBuyerCreditsDurably(account.id, 3, { id: 'local-credit-tx' }))
      .resolves.toMatchObject({ previousBalance: 2, updatedBalance: 5, replayed: false });
    await expect(storeService.addBuyerCreditsDurably('missing-buyer', 3, { id: 'missing-credit-tx' }))
      .resolves.toBeNull();
    expect(storeService.activeBuyerAccount.remainingFreeRFQs).toBe(5);
    expect(addCreditsSpy).not.toHaveBeenCalled();
  });
});
