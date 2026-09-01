const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const { getTestToken } = require('./testHelpers');

function contextFor(role) {
  return { req: { headers: { authorization: `Bearer ${getTestToken(role)}` } } };
}

describe('GraphQL Resolvers Direct Unit Tests', () => {
  test('rfqs resolver filters by category, sourcingMode, and status with default arguments', () => {
    // Default call
    const all = rootResolvers.rfqs();
    expect(all.length).toBeGreaterThan(0);

    // Filtered
    const filtered = rootResolvers.rfqs({ category: 'Spares', sourcingMode: 'mode_1', status: 'open', limit: 5, offset: 0 });
    expect(Array.isArray(filtered)).toBe(true);
  });

  test('rfq resolver searches by id and rfqNumber or returns null', () => {
    const rfqs = storeService.getRFQs();
    const first = rfqs[0];

    expect(rootResolvers.rfq({ id: first.id })).toEqual(first);
    expect(rootResolvers.rfq({ rfqNumber: first.rfqNumber })).toEqual(first);
    expect(rootResolvers.rfq({ id: 'non-existent-id' })).toBeNull();
    expect(rootResolvers.rfq({})).toBeNull();
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

  test('buyerAccounts and activeBuyerAccount resolvers work', () => {
    const accounts = rootResolvers.buyerAccounts();
    expect(accounts.length).toBeGreaterThan(0);

    const limited = rootResolvers.buyerAccounts({ limit: 2 });
    expect(limited.length).toBe(2);

    const active = rootResolvers.activeBuyerAccount();
    expect(active).toBeDefined();
  });

  test('evaluations resolver filters by vendorName or returns all', () => {
    const all = rootResolvers.evaluations();
    expect(all.length).toBeGreaterThan(0);

    const filtered = rootResolvers.evaluations({ vendorName: 'Tata' });
    expect(Array.isArray(filtered)).toBe(true);
  });

  test('auditLogs resolver filters by search action or userEmail', () => {
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

    const createdRFQ = rootResolvers.createRFQ({
      input: { title: 'Direct Resolver RFQ', category: 'Raw Materials' },
    }, buyerCtx);
    expect(createdRFQ.title).toBe('Direct Resolver RFQ');

    const updatedRFQ = rootResolvers.updateRFQ({
      id: createdRFQ.id,
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

  test('mutations reject a missing/invalid token, and admin-only mutations reject a non-admin role', () => {
    expect(() => rootResolvers.createRFQ({ input: { title: 'X' } }, { req: { headers: {} } })).toThrow();
    expect(() => rootResolvers.createRFQ({ input: { title: 'X' } }, { req: { headers: { authorization: 'Bearer not-a-real-token' } } })).toThrow();
    expect(() => rootResolvers.purgeLogs({}, contextFor('buyer'))).toThrow();
  });
});
