// A buyer inserted straight into the identity `user` table (bulk import) can
// sign in but has no buyer_accounts row. Their RFQs used to be saved with no
// buyerAccountId, so GET /api/rfqs always came back empty for them.
const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');

const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function headerFor(user) {
  return { Authorization: `Bearer ${authService.generateSessionToken(user)}` };
}

describe('storeService.ensureBuyerAccountForUser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns null for a missing user, a non-buyer, or a buyer without an email', async () => {
    expect(await storeService.ensureBuyerAccountForUser(null)).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'admin', email: 'a@ex.com', sub: 'x' })).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'buyer', sub: 'x' })).toBeNull();
  });

  test('returns null when the buyer has no id to key the account on', async () => {
    expect(await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'no-id@ex.com' })).toBeNull();
  });

  test('returns the existing account without creating another', async () => {
    const existing = storeService.addBuyerAccount({ organizationName: 'Has Account', corporateEmail: 'has-account@ex.com' });
    const spy = jest.spyOn(storeService, 'addBuyerAccount');
    const got = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'HAS-ACCOUNT@ex.com', sub: 'u-has' });
    expect(got.id).toBe(existing.id);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('creates a free_trial account keyed on the user uuid, then reuses it', async () => {
    const user = { role: 'buyer', email: 'Imported@Ex.com', sub: 'u-imported-1', name: 'Imp', orgName: 'Imp Org', orgId: 'org-1' };
    const created = await storeService.ensureBuyerAccountForUser(user);
    expect(created).toMatchObject({
      id: 'u-imported-1',
      corporateEmail: 'imported@ex.com',
      organizationName: 'Imp Org',
      contactPerson: 'Imp',
      organizationId: 'org-1',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 5,
    });
    const again = await storeService.ensureBuyerAccountForUser(user);
    expect(again.id).toBe('u-imported-1');
    expect(storeService.getBuyerAccounts().filter((a) => a.id === 'u-imported-1')).toHaveLength(1);
  });

  test('falls back to email/blank names and user.id when optional claims are absent', async () => {
    const created = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'bare@ex.com', id: 'u-bare' });
    expect(created).toMatchObject({ id: 'u-bare', organizationName: 'bare@ex.com', contactPerson: '', organizationId: null });
  });

  test('configured storage creates a first-login account durably before caching it', async () => {
    storeService.buyerAccounts = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue(null);
    const byId = jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({ found: false, profile: null });
    const upsert = jest.spyOn(domainQueries, 'upsertBuyerAccountInDB').mockImplementation(async (account) => account);

    const account = await storeService.ensureBuyerAccountForUser({
      id: 'u-durable-first-login',
      email: 'durable-first-login@ex.com',
      role: 'buyer',
      name: 'Durable Buyer',
    });

    expect(byId).toHaveBeenCalledWith('u-durable-first-login', { fresh: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-durable-first-login' }));
    expect(storeService.buyerAccounts).toContain(account);
  });

  test('does not cache a first-login buyer account when configured persistence fails', async () => {
    storeService.buyerAccounts = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({ found: false, profile: null });
    jest.spyOn(domainQueries, 'upsertBuyerAccountInDB').mockRejectedValue(new Error('D1 unavailable'));

    await expect(storeService.ensureBuyerAccountForUser({
      id: 'u-durable-failure',
      email: 'durable-failure@ex.com',
      role: 'buyer',
    })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
    expect(storeService.buyerAccounts).toHaveLength(0);
  });

  test('reuses an in-memory account with the same id when the email lookup misses (persist still in flight)', async () => {
    const cached = { id: 'u-inflight', corporateEmail: 'other@ex.com' };
    storeService.buyerAccounts.unshift(cached);
    const spy = jest.spyOn(storeService, 'addBuyerAccount');
    const got = await storeService.ensureBuyerAccountForUser({ role: 'buyer', email: 'inflight@ex.com', sub: 'u-inflight' });
    expect(got).toBe(cached);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('enriches an existing account from DB profile when statutory details are missing', async () => {
    const buyerProfileQueries = require('../src/db/buyerProfileQueries');
    const existing = storeService.addBuyerAccount({
      organizationName: 'Basic Account',
      corporateEmail: 'enrich-me@ex.com',
    });

    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({
      found: true,
      profile: {
        companyName: 'Enriched Entity Ltd',
        gstNumber: '27AABCE1234F1Z5',
        panNumber: 'AABCE1234F',
        contactPhone: '+919999988888',
        city: 'Pune',
      },
    });

    const got = await storeService.ensureBuyerAccountForUser({
      role: 'buyer',
      email: 'enrich-me@ex.com',
      sub: existing.id,
    });

    expect(got.organizationName).toBe('Enriched Entity Ltd');
    expect(got.gstin).toBe('27AABCE1234F1Z5');
    expect(got.city).toBe('Pune');
  });

  test('refreshes an existing durable account by id and skips complete profiles', async () => {
    storeService.buyerAccounts = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    const existing = {
      id: 'db-buyer-profile',
      organizationName: 'Basic Durable Account',
      corporateEmail: 'db-profile@ex.com',
    };
    const enriched = {
      ...existing,
      gstin: '27AABCE1234F1Z5',
      mobileNumber: '+919999988888',
      city: 'Pune',
    };
    jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB')
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(enriched);
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({
      found: true,
      profile: { gstNumber: enriched.gstin, contactPhone: enriched.mobileNumber, city: enriched.city },
    });
    const update = jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue(enriched);

    const first = await storeService.ensureBuyerAccountForUser({
      role: 'buyer', email: existing.corporateEmail, sub: existing.id,
    });
    expect(first).toMatchObject({ id: existing.id, gstin: enriched.gstin });
    expect(update).toHaveBeenCalledTimes(1);

    const second = await storeService.ensureBuyerAccountForUser({
      role: 'buyer', email: existing.corporateEmail, sub: existing.id,
    });
    expect(second).toMatchObject({ id: existing.id, city: 'Pune' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  test('fails when profile enrichment cannot update the durable buyer account', async () => {
    storeService.buyerAccounts = [];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    const existing = { id: 'db-buyer-no-update', corporateEmail: 'no-update@ex.com' };
    jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(existing);
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({
      found: true,
      profile: { gstNumber: '27AABCE1234F1Z5' },
    });
    jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue(null);

    await expect(storeService.ensureBuyerAccountForUser({
      role: 'buyer', email: existing.corporateEmail, sub: existing.id,
    })).rejects.toThrow('Buyer profile enrichment did not find a durable account row.');
  });

  test('logs profile lookup errors and returns the existing account unchanged', async () => {
    const buyerProfileQueries = require('../src/db/buyerProfileQueries');
    const existing = storeService.addBuyerAccount({
      organizationName: 'Existing Account',
      corporateEmail: 'profile-error@ex.com',
    });
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockRejectedValue(new Error('profile database unavailable'));
    const warnSpy = jest.spyOn(logger, 'warn');

    const result = await storeService.ensureBuyerAccountForUser({
      role: 'buyer',
      email: 'profile-error@ex.com',
      sub: existing.id,
    });

    expect(result).toEqual(existing);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Buyer profile lookup failed'),
      expect.objectContaining({ operation: 'ensure-buyer-account-profile-enrichment', userId: existing.id }),
      'STORE_SERVICE'
    );
  });
});

describe('an imported buyer (no buyer_accounts row) can see the RFQ they create', () => {
  const user = { id: 'u-imported-rfq', email: 'imported-rfq@ex.com', name: 'Imported', role: 'buyer', orgId: 'o', orgName: 'Imported Org' };

  test('POST then GET /api/rfqs returns the new RFQ', async () => {
    expect(await storeService.getBuyerAccountByEmail(user.email)).toBeNull();

    const created = await request(app).post('/api/rfqs').set(headerFor(user)).send({
      title: 'Imported Buyer RFQ',
      category: 'Engineering Spares - Mechanical',
      budget: 5000,
      targetDeliveryDate: A_FUTURE_DATE,
      deadline: A_FUTURE_DATE,
      sourcingMode: 'mode_0',
      deliveryLocation: 'Plant A',
      deliveryPincode: '400001',
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.buyerAccountId).toBe('u-imported-rfq');

    const list = await request(app).get('/api/rfqs').set(headerFor(user));
    expect(list.statusCode).toBe(200);
    expect(list.body.data.map((r) => r.id)).toContain(created.body.data.id);
  });

  test('GET /api/bootstrap also provisions the account', async () => {
    const other = { ...user, id: 'u-imported-boot', email: 'imported-boot@ex.com' };
    const res = await request(app).get('/api/bootstrap').set(headerFor(other));
    expect(res.statusCode).toBe(200);
    expect((await storeService.getBuyerAccountByEmail(other.email)).id).toBe('u-imported-boot');
  });
});
