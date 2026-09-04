// RFQ persistence is doubled so the resolvers can be exercised without MySQL.
jest.mock('../src/db/rfqQueries', () => require('./helpers/fakeRfqQueries'));
jest.mock('../src/services/rfqIdService', () => ({
  generateRfqId: jest.fn(async () => 'RFQ260409000999'),
}));

const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const fakeRfqQueries = require('./helpers/fakeRfqQueries');
const { getTestToken, TEST_USERS } = require('./testHelpers');

function contextFor(role) {
  return { req: { headers: { authorization: `Bearer ${getTestToken(role)}` } } };
}

describe('GraphQL Resolvers Direct Unit Tests', () => {
  const BUYER_ORG_ID = TEST_USERS.buyer.orgId;
  const SEEDED_RFQ = {
    rfqId: 'RFQ260409000555',
    buyerOrgId: BUYER_ORG_ID,
    buyerUserId: TEST_USERS.buyer.id,
    buyerEmail: TEST_USERS.buyer.email,
    title: 'Resolver Fixture RFQ',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    budget: 1000,
  };

  beforeEach(() => {
    fakeRfqQueries.__reset();
    fakeRfqQueries.__seed([SEEDED_RFQ]);
  });

  // RFQ resolvers are org-scoped now, so they need a session in context. An
  // anonymous call used to return every RFQ in the process.
  test('rfqs resolver refuses an anonymous call', async () => {
    await expect(rootResolvers.rfqs({}, undefined)).rejects.toThrow();
    await expect(rootResolvers.rfqs({}, {})).rejects.toThrow();
  });

  test('rfqs resolver filters by category, sourcingMode, and status', async () => {
    const context = contextFor('buyer');

    const all = await rootResolvers.rfqs({}, context);
    expect(all.length).toBeGreaterThan(0);

    const filtered = await rootResolvers.rfqs(
      { category: 'Spares', sourcingMode: 'mode_1', status: 'Quotes Pending', limit: 5, offset: 0 },
      context
    );
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered).toHaveLength(1);

    // A filter that matches nothing returns empty rather than falling back to all.
    const none = await rootResolvers.rfqs({ category: 'Nothing Matches This' }, context);
    expect(none).toEqual([]);
  });

  test('rfq resolver searches by id and rfqNumber or returns null', async () => {
    const context = contextFor('buyer');
    const first = await fakeRfqQueries.findRFQByRfqId(SEEDED_RFQ.rfqId, BUYER_ORG_ID);

    expect(await rootResolvers.rfq({ id: first.id }, context)).toEqual(first);
    expect(await rootResolvers.rfq({ rfqNumber: first.rfqNumber }, context)).toEqual(first);
    expect(await rootResolvers.rfq({ id: 'non-existent-id' }, context)).toBeNull();
    expect(await rootResolvers.rfq({}, context)).toBeNull();
  });

  // The category manager's token is valid but belongs to a different
  // organisation, so it must not see the buyer's RFQ.
  test('rfq resolvers are scoped to the caller organisation', async () => {
    const otherOrg = contextFor('category_manager');
    expect(await rootResolvers.rfqs({}, otherOrg)).toEqual([]);
    expect(await rootResolvers.rfq({ rfqNumber: SEEDED_RFQ.rfqId }, otherOrg)).toBeNull();
  });

  test('vendors resolver filters by majorCategory, source, search and pagination', () => {
    const all = rootResolvers.vendors();
    expect(all.length).toBeGreaterThan(0);

    const byCat = rootResolvers.vendors({ majorCategory: 'Mechanical' });
    expect(Array.isArray(byCat)).toBe(true);

    const bySource = rootResolvers.vendors({ source: 'buyer_manual' });
    expect(Array.isArray(bySource)).toBe(true);

    const bySearchName = rootResolvers.vendors({ search: 'Tata' });
    expect(Array.isArray(bySearchName)).toBe(true);

    const bySearchEmail = rootResolvers.vendors({ search: '@' });
    expect(Array.isArray(bySearchEmail)).toBe(true);
  });

  test('vendor resolver looks up by id and email or returns null', () => {
    const vendors = storeService.getVendors();
    const first = vendors[0];

    expect(rootResolvers.vendor({ id: first.id })).toEqual(first);
    expect(rootResolvers.vendor({ email: first.email })).toEqual(first);
    expect(rootResolvers.vendor({ id: 'non-existent-vendor' })).toBeNull();
    expect(rootResolvers.vendor({ email: 'unknown@email.com' })).toBeNull();
    expect(rootResolvers.vendor({})).toBeNull();
  });

  // The seeded companies are gone, so these start empty. An account created at
  // runtime is what they report now.
  test('buyerAccounts and activeBuyerAccount resolvers read the runtime store', () => {
    expect(rootResolvers.buyerAccounts()).toEqual([]);
    expect(rootResolvers.activeBuyerAccount()).toBeNull();

    const created = storeService.addBuyerAccount({
      organizationName: 'Runtime Buyer Co',
      corporateEmail: 'runtime@buyer.test',
    });
    storeService.alignActiveBuyerAccount(created.id);

    expect(rootResolvers.buyerAccounts().length).toBeGreaterThan(0);
    expect(rootResolvers.buyerAccounts({ limit: 1 })).toHaveLength(1);
    expect(rootResolvers.activeBuyerAccount().id).toBe(created.id);

    storeService.deleteBuyerAccount(created.id);
  });

  test('evaluations resolver filters by vendorName or returns all', () => {
    const all = rootResolvers.evaluations();
    expect(all.length).toBeGreaterThan(0);

    const filtered = rootResolvers.evaluations({ vendorName: 'Tata' });
    expect(Array.isArray(filtered)).toBe(true);
  });

  test('auditLogs resolver filters by search action or userEmail', () => {
    // The audit trail starts empty now that the seeded narrative is gone, so a
    // real entry is recorded before asserting the filters.
    storeService.addAuditLog({
      userEmail: 'buyer@procucev.com',
      action: 'Registered a resolver audit fixture',
    });

    const all = rootResolvers.auditLogs();
    expect(all.length).toBeGreaterThan(0);

    const searchAction = rootResolvers.auditLogs({ search: 'Registered' });
    expect(Array.isArray(searchAction)).toBe(true);

    const searchEmail = rootResolvers.auditLogs({ search: '@' });
    expect(Array.isArray(searchEmail)).toBe(true);
  });

  test('catalogue resolver filters by category and search (name/sku)', () => {
    const all = rootResolvers.catalogue();
    expect(all.length).toBeGreaterThan(0);

    const byCat = rootResolvers.catalogue({ category: 'Valves' });
    expect(Array.isArray(byCat)).toBe(true);

    const bySearchName = rootResolvers.catalogue({ search: 'Impeller' });
    expect(Array.isArray(bySearchName)).toBe(true);

    const bySearchSku = rootResolvers.catalogue({ search: 'SKU' });
    expect(Array.isArray(bySearchSku)).toBe(true);
  });

  test('aiFeed, systemConfig, dbHealth, optimizationMetrics, diagnoseLogErrors, auditPerformance resolvers execute', async () => {
    const feed = rootResolvers.aiFeed({ limit: 5 });
    expect(feed.length).toBeLessThanOrEqual(5);

    const config = rootResolvers.systemConfig();
    expect(config).toBeDefined();

    const health = await rootResolvers.dbHealth();
    expect(health).toBeDefined();

    const metrics = rootResolvers.optimizationMetrics();
    expect(metrics).toBeDefined();
    expect(metrics.cache).toBeDefined();

    const diag = rootResolvers.diagnoseLogErrors();
    expect(Array.isArray(diag)).toBe(true);

    const perf = rootResolvers.auditPerformance();
    expect(perf.healthScore).toBeGreaterThanOrEqual(0);
  });

  test('mutations execute properly for an authenticated user', async () => {
    const buyerCtx = contextFor('buyer');
    const adminCtx = contextFor('admin');

    // createRFQ is async now: it allocates a server-side RFQ id and persists.
    const createdRFQ = await rootResolvers.createRFQ({
      input: { title: 'Direct Resolver RFQ', category: 'Raw Materials' },
    }, buyerCtx);
    expect(createdRFQ.title).toBe('Direct Resolver RFQ');
    // The id comes from the server, never the client.
    expect(createdRFQ.rfqNumber).toMatch(/^RFQ\d+$/);

    // updateRFQ still operates on the in-memory store; quotations and status
    // transitions are not modelled in qua_enterprice_rfq yet, so it is given an
    // in-memory record rather than the persisted one above.
    const inMemoryRfq = storeService.createRFQ({ title: 'In-memory for update', category: 'Raw Materials' });
    const updatedRFQ = rootResolvers.updateRFQ({
      id: inMemoryRfq.id,
      input: { status: 'awarded' },
    }, buyerCtx);
    expect(updatedRFQ.status).toBe('awarded');

    const createdVendor = rootResolvers.createVendor({
      input: { name: 'Direct Resolver Vendor', email: 'resolver@vendor.com', majorCategory: 'Electrical' },
    }, buyerCtx);
    expect(createdVendor.name).toBe('Direct Resolver Vendor');

    const updatedVendor = rootResolvers.updateVendor({
      id: createdVendor.id,
      input: { rating: 4.9 },
    }, buyerCtx);
    expect(updatedVendor.rating).toBe(4.9);

    const deleted = rootResolvers.deleteVendor({ id: createdVendor.id }, buyerCtx);
    expect(deleted).toBe(true);

    const createdBuyer = rootResolvers.createBuyerAccount({
      input: { organizationName: 'Resolver Org', corporateEmail: 'resolver@org.com', contactPerson: 'Buyer' },
    }, buyerCtx);
    expect(createdBuyer.organizationName).toBe('Resolver Org');

    expect(rootResolvers.clearQueryCache(undefined, buyerCtx)).toBe(true);

    // purgeLogs/autoResolveLogErrors/optimizePerformance are admin-only
    const purgeDefault = rootResolvers.purgeLogs(undefined, adminCtx);
    expect(purgeDefault.success).toBe(true);

    const purgeCustom = rootResolvers.purgeLogs({ maxAgeDays: 10 }, adminCtx);
    expect(purgeCustom.success).toBe(true);

    // Auto resolve log errors mutations
    const autoResolveDefault = await rootResolvers.autoResolveLogErrors(undefined, adminCtx);
    expect(autoResolveDefault).toBeDefined();

    const autoResolveAction = await rootResolvers.autoResolveLogErrors({ action: 'OPTIMIZE_QUERY_CACHE' }, adminCtx);
    expect(autoResolveAction.remediationsApplied[0].actionType).toBe('OPTIMIZE_QUERY_CACHE');

    // Optimize performance mutations
    const optDefault = rootResolvers.optimizePerformance(undefined, adminCtx);
    expect(optDefault.status).toBe('OPTIMIZED');

    const optLevel = rootResolvers.optimizePerformance({ level: 'deep' }, adminCtx);
    expect(optLevel.level).toBe('deep');
  });

  test('mutations reject a missing/invalid token, and admin-only mutations reject a non-admin role', async () => {
    // Async now, so these reject rather than throwing synchronously.
    await expect(
      rootResolvers.createRFQ({ input: { title: 'X' } }, { req: { headers: {} } })
    ).rejects.toThrow();
    await expect(
      rootResolvers.createRFQ(
        { input: { title: 'X' } },
        { req: { headers: { authorization: 'Bearer not-a-real-token' } } }
      )
    ).rejects.toThrow();
    expect(() => rootResolvers.purgeLogs({}, contextFor('buyer'))).toThrow();
  });
});
