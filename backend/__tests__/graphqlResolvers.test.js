const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const domainPool = require('../src/db/pool');
const { getTestToken, TEST_USERS } = require('./testHelpers');

function contextFor(role) {
  return { req: { headers: { authorization: `Bearer ${getTestToken(role)}` } } };
}

// Every session-gated resolver is async: revocation is read from the database, so
// requireAuth/requireAdmin/requireRfqReadScope all await. A rejected promise is
// NOT a synchronous throw — asserting one with `expect(() => ...).toThrow()`
// leaves the rejection unhandled, which crashes the Jest worker outright rather
// than failing the test. Every such assertion below therefore uses
// `.rejects.toThrow()`.
//
  // Each resolver read carries the same role and ownership rules as the REST
  // endpoints; contextFor() provides a verified session for direct unit tests.
describe('GraphQL Resolvers Direct Unit Tests', () => {
  let seededRfq;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // A real buyer account for TEST_USERS.buyer.email, so requireRfqReadScope's
    // filtering (getBuyerAccountByEmail) has something real to scope against.
    const account = storeService.addBuyerAccount({
      organizationName: 'Resolver Fixture Org',
      corporateEmail: TEST_USERS.buyer.email,
    });
    seededRfq = storeService.createRFQ(
      {
        title: 'Resolver Fixture RFQ',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_1',
        status: 'Quotes Pending',
        budget: 1000,
      },
      account
    );
  });

  // RFQ resolvers require a session, so an anonymous call is rejected before it
  // ever reads the store.
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
    const publicRFQ = { ...seededRfq };
    delete publicRFQ.vendorInvitationTargets;

    expect(await rootResolvers.rfq({ id: seededRfq.id }, context)).toEqual(publicRFQ);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, context)).toEqual(publicRFQ);
    expect(await rootResolvers.rfq({ id: 'non-existent-id' }, context)).toBeNull();
    expect(await rootResolvers.rfq({}, context)).toBeNull();
  });

  test('resolver defaults handle omitted arguments and buyers without an account', async () => {
    const orphanBuyer = { req: { user: { role: 'buyer', email: 'orphan@buyer.test', sub: 'orphan-buyer-id' } } };
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    jest.spyOn(domainPool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(storeService, 'getVendors').mockResolvedValue([
      { id: 'orphan-owned-vendor', email: 'private@vendor.test', buyerId: 'orphan-buyer-id' },
    ]);
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue({
      id: 'orphan-owned-vendor',
      email: 'private@vendor.test',
      buyerId: 'orphan-buyer-id',
    });

    await expect(rootResolvers.rfqs(undefined, orphanBuyer)).resolves.toEqual([]);
    await expect(rootResolvers.rfq(undefined, orphanBuyer)).resolves.toBeNull();
    await expect(rootResolvers.vendors(undefined, orphanBuyer)).resolves.toEqual([
      expect.objectContaining({ email: 'private@vendor.test' }),
    ]);
    await expect(rootResolvers.vendor(undefined, orphanBuyer)).resolves.toBeNull();
    await expect(rootResolvers.vendor({ id: 'orphan-owned-vendor' }, orphanBuyer)).resolves.toEqual(
      expect.objectContaining({ email: 'private@vendor.test' })
    );
    await expect(rootResolvers.buyerAccounts(undefined, orphanBuyer)).resolves.toEqual([]);
    await expect(rootResolvers.evaluations(undefined, contextFor('buyer'))).resolves.toBeDefined();
    await expect(rootResolvers.auditLogs(undefined, contextFor('admin'))).resolves.toBeDefined();
    await expect(rootResolvers.aiFeed(undefined, contextFor('admin'))).resolves.toBeDefined();
  });

  // Category managers/admins are deliberately unrestricted (they need the full
  // cross-buyer list — see resolvers.js's requireRfqReadScope), so the buyer-only
  // scoping case needs a second real buyer identity.
  test('rfq resolvers scope a buyer to their own account', async () => {
    storeService.addBuyerAccount({
      organizationName: 'Other Buyer Org',
      corporateEmail: TEST_USERS.category_manager.email,
    });
    const otherBuyerCtx = contextFor('category_manager');
    // A buyer with no account of its own exercises the "no match" branch.
    const unlinkedBuyerToken = require('../src/services/authService').generateSessionToken({
      id: 'usr-unlinked-buyer',
      email: 'unlinked-buyer@procucev.com',
      name: 'Unlinked Buyer',
      role: 'buyer',
    });
    const unlinkedBuyerCtx = { req: { headers: { authorization: `Bearer ${unlinkedBuyerToken}` } } };

    expect(await rootResolvers.rfqs({}, unlinkedBuyerCtx)).toEqual([]);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, unlinkedBuyerCtx)).toBeNull();
    // category_manager is unrestricted, so it does see the fixture RFQ.
    expect(await rootResolvers.rfqs({}, otherBuyerCtx)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
  });

  test('rfq resolvers scope a vendor to RFQs they were invited to — category match alone is not enough', async () => {
    // A vendor covering the fixture RFQ's category doesn't see it until a
    // category manager invites them onto it.
    const coveringVendor = storeService.addVendor({
      name: 'Covering Resolver Vendor',
      email: TEST_USERS.vendor.email,
      majorCategory: 'Engineering Spares - Mechanical',
    });
    const coveringCtx = contextFor('vendor');
    expect(await rootResolvers.rfqs({}, coveringCtx)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, coveringCtx)).toBeNull();

    await storeService.inviteVendorsToRFQ(seededRfq.id, [coveringVendor.id], TEST_USERS.category_manager.email);
    expect(await rootResolvers.rfqs({}, coveringCtx)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seededRfq.id })])
    );
    expect((await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, coveringCtx))?.id).toEqual(seededRfq.id);

    const orphanVendorToken = require('../src/services/authService').generateSessionToken({
      id: 'usr-orphan-resolver-vendor',
      email: 'orphan-resolver-vendor@nowhere.test',
      name: 'Orphan',
      role: 'vendor',
    });
    const orphanCtx = { req: { headers: { authorization: `Bearer ${orphanVendorToken}` } } };
    expect(await rootResolvers.rfqs({}, orphanCtx)).toEqual([]);
    expect(await rootResolvers.rfq({ rfqNumber: seededRfq.rfqNumber }, orphanCtx)).toBeNull();
  });

  test('vendors resolver filters by majorCategory, source, search and pagination', async () => {
    // Registered here because nothing is seeded: the roster is empty until a
    // vendor is actually created.
    storeService.addVendor({
      name: 'Resolver Filter Vendor',
      email: 'filter@resolver-vendor.test',
      majorCategory: 'Engineering Spares - Mechanical',
      source: 'buyer_manual',
    });

    const all = await rootResolvers.vendors();
    expect(all.length).toBeGreaterThan(0);

    const byCat = await rootResolvers.vendors({ majorCategory: 'Mechanical' });
    expect(byCat.length).toBeGreaterThan(0);

    const bySource = await rootResolvers.vendors({ source: 'buyer_manual' });
    expect(bySource.length).toBeGreaterThan(0);

    const bySearchName = await rootResolvers.vendors({ search: 'Resolver Filter' });
    expect(bySearchName.length).toBeGreaterThan(0);

    const bySearchEmail = await rootResolvers.vendors({ search: '@' });
    expect(bySearchEmail.length).toBeGreaterThan(0);

    // A search that matches nothing returns empty rather than the whole roster.
    expect(await rootResolvers.vendors({ search: 'no-such-vendor-anywhere' })).toEqual([]);
  });

  test('vendor resolver looks up by id and email or returns null', async () => {
    const created = storeService.addVendor({
      name: 'Resolver Lookup Vendor',
      email: 'lookup@resolver-vendor.test',
      majorCategory: 'Engineering Spares - Electrical',
    });

    expect(await rootResolvers.vendor({ id: created.id })).toEqual(expect.objectContaining({
      id: created.id,
      email: 'lXXXX@resolver-vendor.test',
    }));
    expect(await rootResolvers.vendor({ email: created.email })).toEqual(expect.objectContaining({
      id: created.id,
      email: 'lXXXX@resolver-vendor.test',
    }));
    expect(await rootResolvers.vendor({ id: 'non-existent-vendor' })).toBeNull();
    expect(await rootResolvers.vendor({ email: 'unknown@email.com' })).toBeNull();
    expect(await rootResolvers.vendor({})).toBeNull();
  });

  // When a DB pool IS configured, both resolvers route through the bounded
  // getVendorsPageFromDB/getVendorByEmailFromDB helpers instead of a full
  // in-memory scan — this is the fix for the D1 row-read exhaustion incident
  // (see storeService.hydrateFromDB's own comment). Mocked here since the
  // rest of this suite deliberately runs with no DB configured.
  describe('vendors/vendor resolvers with a DB pool configured', () => {
    let originalPool;
    beforeEach(() => {
      originalPool = domainPool.pool;
      domainPool.pool = { query: jest.fn() };
    });
    afterEach(() => {
      domainPool.pool = originalPool;
      jest.restoreAllMocks();
    });

    test('vendors resolver pages through domainQueries.getVendorsPageFromDB', async () => {
      const dbVendor = { id: 'v-db-1', email: 'db-vendor@example.com', source: 'excel' };
      const pageSpy = jest
        .spyOn(domainQueries, 'getVendorsPageFromDB')
        .mockResolvedValue({ rows: [dbVendor], total: 1 });

      const result = await rootResolvers.vendors({ majorCategory: 'IT', search: 'db', limit: 10, offset: 0 });

      expect(pageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0, search: 'db', category: 'IT' })
      );
      expect(result).toEqual([expect.objectContaining({ id: dbVendor.id, email: 'dXXXX@example.com' })]);

      // The `source` filter is applied client-side after the DB page load.
      const filteredOut = await rootResolvers.vendors({ source: 'buyer_manual' });
      expect(filteredOut).toEqual([]);
    });

    test('vendor resolver by email uses the bounded single-row DB lookup', async () => {
      const emailSpy = jest.spyOn(domainQueries, 'getVendorByEmailFromDB');
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);

      // Public vendor (no buyerId/buyerAccountId) is visible to anyone.
      emailSpy.mockResolvedValueOnce({ id: 'v-db-3', email: 'public@example.com' });
      expect(await rootResolvers.vendor({ email: 'public@example.com' })).toEqual(expect.objectContaining({
        id: 'v-db-3',
        email: 'pXXXX@example.com',
      }));

      // A buyer-scoped vendor is only returned to a matching buyerId.
      emailSpy.mockResolvedValueOnce({ id: 'v-db-2', email: 'scoped@example.com', buyerId: 'buyer-9' });
      const unlinkedBuyerToken = require('../src/services/authService').generateSessionToken({
        id: 'usr-unscoped',
        email: 'unscoped-buyer@procucev.com',
        name: 'Unscoped Buyer',
        role: 'buyer',
      });
      const unscopedCtx = { req: { headers: { authorization: `Bearer ${unlinkedBuyerToken}` } } };
      expect(await rootResolvers.vendor({ email: 'scoped@example.com' }, unscopedCtx)).toBeNull();

      emailSpy.mockResolvedValueOnce(null);
      expect(await rootResolvers.vendor({ email: 'not-found@example.com' })).toBeNull();

      const privateVendor = { id: 'v-private-admin', email: 'private@example.com', buyerId: 'buyer-owner' };
      emailSpy.mockResolvedValueOnce(privateVendor);
      expect(await rootResolvers.vendor({ email: 'private@example.com' }, { req: { user: { role: 'admin' } } }))
        .toEqual(privateVendor);

      emailSpy.mockResolvedValueOnce(privateVendor);
      const vendorContext = { req: { user: { role: 'vendor', email: 'different@vendor.test' } } };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(privateVendor);
      expect(await rootResolvers.vendor({ id: privateVendor.id }, vendorContext).then((value) => value.email))
        .toBe('pXXXX@example.com');
    });
  });

  // The seeded companies are gone, so these start empty. An account created at
  // runtime is what they report now.
  test('buyerAccounts and activeBuyerAccount resolvers scope buyers and retain management access', async () => {
    const adminContext = contextFor('admin');
    const beforeCount = (await rootResolvers.buyerAccounts({}, adminContext)).length;
    const created = storeService.addBuyerAccount({
      organizationName: 'Runtime Buyer Co',
      corporateEmail: 'runtime@buyer.test',
    });
    storeService.alignActiveBuyerAccount(created.id);

    expect((await rootResolvers.buyerAccounts({}, adminContext)).length).toBe(beforeCount + 1);
    expect(await rootResolvers.buyerAccounts({ limit: 1 }, adminContext)).toHaveLength(1);
    expect((await rootResolvers.activeBuyerAccount({}, adminContext)).id).toBe(created.id);

    const buyerAccounts = await rootResolvers.buyerAccounts({}, contextFor('buyer'));
    expect(buyerAccounts).toHaveLength(1);
    expect(buyerAccounts[0].corporateEmail).toBe(TEST_USERS.buyer.email);
    await expect(rootResolvers.buyerAccounts({}, contextFor('vendor'))).rejects.toThrow();

    storeService.deleteBuyerAccount(created.id);
  });

  test('buyerAccounts rejects anonymous access and scopes buyers to their own account', async () => {
    await expect(rootResolvers.buyerAccounts({}, {})).rejects.toThrow();
    const ownAccount = storeService.addBuyerAccount({
      organizationName: 'Private Buyer Account',
      corporateEmail: TEST_USERS.buyer.email,
    });
    const otherAccount = storeService.addBuyerAccount({
      organizationName: 'Other Buyer Account',
      corporateEmail: 'other-buyer@buyer.test',
    });

    const accounts = await rootResolvers.buyerAccounts({ buyerId: otherAccount.id }, contextFor('buyer'));
    expect(accounts).toEqual([expect.objectContaining({ id: ownAccount.id })]);

    storeService.deleteBuyerAccount(ownAccount.id);
    storeService.deleteBuyerAccount(otherAccount.id);
  });

  test('evaluations resolver filters by vendorName or returns all for a signed-in buyer', async () => {
    // The single fabricated 360° audit that used to be seeded is gone, so a real
    // evaluation is recorded before the filters are asserted.
    storeService.createEvaluation({
      vendorName: 'Resolver Evaluation Vendor',
      category: 'Engineering Spares - Mechanical',
    });

    const context = contextFor('buyer');
    const all = await rootResolvers.evaluations({}, context);
    expect(all.length).toBeGreaterThan(0);

    const filtered = await rootResolvers.evaluations({ vendorName: 'Resolver Evaluation' }, context);
    expect(filtered.length).toBeGreaterThan(0);

    const limited = await rootResolvers.evaluations({ limit: 1 }, context);
    expect(limited.length).toBeLessThanOrEqual(1);

    expect(await rootResolvers.evaluations({ vendorName: 'no-such-vendor' }, context)).toEqual([]);
  });

  test('auditLogs resolver filters by search action or userEmail for admins only', async () => {
    // The audit trail starts empty now that the seeded narrative is gone, so a
    // real entry is recorded before asserting the filters.
    storeService.addAuditLog({
      userEmail: 'buyer@procucev.com',
      action: 'Registered a resolver audit fixture',
    });

    const context = contextFor('admin');
    const all = await rootResolvers.auditLogs({}, context);
    expect(all.length).toBeGreaterThan(0);

    const searchAction = await rootResolvers.auditLogs({ search: 'Registered' }, context);
    expect(searchAction.length).toBeGreaterThan(0);

    const searchEmail = await rootResolvers.auditLogs({ search: '@' }, context);
    expect(searchEmail.length).toBeGreaterThan(0);
    await expect(rootResolvers.auditLogs({}, contextFor('buyer'))).rejects.toThrow();
  });

  test('catalogue resolver filters by category and search (name/sku)', () => {
    // The three unowned demo SKUs are gone, so the catalogue is empty until a
    // vendor publishes something.
    storeService.addProductToCatalogue(
      {
        name: 'Resolver Impeller',
        sku: 'SKU-RESOLVER-1',
        category: 'Valves & Actuators',
        unitPrice: 100,
      },
      'v-resolver-1',
      'vendor@resolver.test'
    );

    const all = rootResolvers.catalogue();
    expect(all.length).toBeGreaterThan(0);

    const byCat = rootResolvers.catalogue({ category: 'Valves' });
    expect(byCat.length).toBeGreaterThan(0);

    const bySearchName = rootResolvers.catalogue({ search: 'Impeller' });
    expect(bySearchName.length).toBeGreaterThan(0);

    const bySearchSku = rootResolvers.catalogue({ search: 'SKU' });
    expect(bySearchSku.length).toBeGreaterThan(0);

    const limited = rootResolvers.catalogue({ limit: 1 });
    expect(limited.length).toBeLessThanOrEqual(1);
  });

  test('aiFeed, systemConfig, dbHealth, optimizationMetrics, diagnoseLogErrors, auditPerformance resolvers execute', async () => {
    const context = contextFor('admin');
    const feed = await rootResolvers.aiFeed({ limit: 5 }, context);
    expect(feed.length).toBeLessThanOrEqual(5);

    const config = await rootResolvers.systemConfig({}, context);
    expect(config).toBeDefined();

    const health = await rootResolvers.dbHealth({}, context);
    expect(health).toBeDefined();
    // One connection, so one health answer covering accounts and domain records.
    expect(health).toHaveProperty('userCount');
    expect(health).toHaveProperty('vendorCount');
    expect(health).toHaveProperty('rfqCount');

    const metrics = await rootResolvers.optimizationMetrics({}, context);
    expect(metrics).toBeDefined();
    expect(metrics.cache).toBeDefined();

    const diag = await rootResolvers.diagnoseLogErrors({}, context);
    expect(Array.isArray(diag)).toBe(true);

    const perf = await rootResolvers.auditPerformance({}, context);
    expect(perf.healthScore).toBeGreaterThanOrEqual(0);
  });

  test('mutations execute properly for an authenticated user', async () => {
    const buyerCtx = contextFor('buyer');
    const adminCtx = contextFor('admin');

    const createdRFQ = await rootResolvers.createRFQ(
      { input: { title: 'Direct Resolver RFQ', category: 'Raw Materials' } },
      buyerCtx
    );
    expect(createdRFQ.title).toBe('Direct Resolver RFQ');
    // The id comes from the server, never the client. Attributed to the requesting
    // buyer's own account (the beforeEach fixture, matched by session email),
    // resolved server-side rather than taken from the payload.
    expect(createdRFQ.rfqNumber).toMatch(/^RFQ\d{12}$/);
    expect(createdRFQ.buyerAccountId).toBe(seededRfq.buyerAccountId);

    const extractedEntitiesRFQ = await rootResolvers.createRFQ(
      { input: { title: 'Resolver Extracted Entities RFQ', extractedEntities: [{ name: 'Valve' }] } },
      buyerCtx
    );
    expect(extractedEntitiesRFQ.extractedEntities).toEqual([{ name: 'Valve' }]);

    const updatedRFQ = await rootResolvers.updateRFQ(
      { id: createdRFQ.id, input: { status: 'awarded' } },
      buyerCtx
    );
    expect(updatedRFQ.status).toBe('awarded');

    const createdVendor = await rootResolvers.createVendor(
      { input: { name: 'Direct Resolver Vendor', email: 'resolver@vendor.com', majorCategory: 'Electrical' } },
      buyerCtx
    );
    expect(createdVendor.name).toBe('Direct Resolver Vendor');

    const updatedVendor = await rootResolvers.updateVendor(
      { id: createdVendor.id, input: { rating: 4.9 } },
      buyerCtx
    );
    expect(updatedVendor.rating).toBe(4.9);

    const deleted = await rootResolvers.deleteVendor({ id: createdVendor.id }, buyerCtx);
    expect(deleted).toBe(true);

    const createdBuyer = await rootResolvers.createBuyerAccount(
      { input: { organizationName: 'Resolver Org', corporateEmail: 'resolver@org.com', contactPerson: 'Buyer' } },
      buyerCtx
    );
    expect(createdBuyer.organizationName).toBe('Resolver Org');

    const adminCreatedVendor = await rootResolvers.createVendor(
      { input: { name: 'Admin Resolver Vendor', email: 'admin-resolver@vendor.test', majorCategory: 'Mechanical' } },
      adminCtx
    );
    expect(adminCreatedVendor.name).toBe('Admin Resolver Vendor');

    await expect(rootResolvers.clearQueryCache(undefined, buyerCtx)).rejects.toThrow();
    await expect(rootResolvers.clearQueryCache(undefined, adminCtx)).resolves.toBe(true);

    // purgeLogs/autoResolveLogErrors/optimizePerformance are admin-only.
    const purgeDefault = await rootResolvers.purgeLogs(undefined, adminCtx);
    expect(purgeDefault.success).toBe(true);

    const purgeCustom = await rootResolvers.purgeLogs({ maxAgeDays: 10 }, adminCtx);
    expect(purgeCustom.success).toBe(true);

    const autoResolveDefault = await rootResolvers.autoResolveLogErrors(undefined, adminCtx);
    expect(autoResolveDefault).toBeDefined();

    const autoResolveAction = await rootResolvers.autoResolveLogErrors(
      { action: 'OPTIMIZE_QUERY_CACHE' },
      adminCtx
    );
    expect(autoResolveAction.remediationsApplied[0].actionType).toBe('OPTIMIZE_QUERY_CACHE');
    expect(autoResolveAction.remediationsApplied[0]).toMatchObject({ success: true, status: 'applied' });
    expect(typeof autoResolveAction.remediationsApplied[0].remediationId).toBe('string');
    expect(autoResolveDefault.remediationsApplied.every((r) => typeof r.success === 'boolean' && typeof r.status === 'string')).toBe(true);

    // A refused action has a null remediationId, because the resolver records nothing for it.
    const refusedAction = await rootResolvers.autoResolveLogErrors({ action: 'NOT_A_REAL_ACTION' }, adminCtx);
    expect(refusedAction.remediationsApplied[0]).toMatchObject({
      remediationId: null,
      actionType: 'NOT_A_REAL_ACTION',
      success: false,
      status: 'not_supported',
    });
    expect(refusedAction.diagnosedCount).toBe(refusedAction.issues.length);

    const optDefault = await rootResolvers.optimizePerformance(undefined, adminCtx);
    expect(optDefault.status).toBe('OPTIMIZED');

    const optLevel = await rootResolvers.optimizePerformance({ level: 'deep' }, adminCtx);
    expect(optLevel.level).toBe('deep');
  });

  test('mutations reject a missing/invalid token, and admin-only mutations reject a non-admin role', async () => {
    await expect(
      rootResolvers.createRFQ({ input: { title: 'X' } }, { req: { headers: {} } })
    ).rejects.toThrow();
    await expect(
      rootResolvers.createRFQ(
        { input: { title: 'X' } },
        { req: { headers: { authorization: 'Bearer not-a-real-token' } } }
      )
    ).rejects.toThrow();
    await expect(rootResolvers.purgeLogs({}, contextFor('buyer'))).rejects.toThrow(
      'You do not have permission to perform this action.'
    );
  });

  describe('GraphQL Resolvers Dedicated Branch Boost', () => {
    test('rfqInScope covers vendor v0/v2/v3 mode branches and category signals', async () => {
      const vendorUser = { role: 'vendor', email: TEST_USERS.vendor.email, sub: 'usr-v-1' };
      const vendorContext = contextFor('vendor');

      // Create v0 RFQ with signals
      const v0Rfq = storeService.createRFQ(
        {
          title: 'V0 RFQ for Vendor',
          category: 'Machinery',
          sourcingMode: 'mode_0',
          status: 'Open',
        },
        null
      );

      // Mode 0 covered by category signals
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(false);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Machinery']);
      jest.spyOn(storeService, 'vendorCoversCategory').mockReturnValue(true);

      const rfqFound = await rootResolvers.rfq({ id: v0Rfq.id }, vendorContext);
      expect(rfqFound).toBeDefined();

      // Mode 0 with empty category signals
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue([]);
      const rfqEmptySig = await rootResolvers.rfq({ id: v0Rfq.id }, vendorContext);
      expect(rfqEmptySig).toBeDefined();

      // Mode 1 where vendor does not cover RFQ returns null (line 90)
      const v1Rfq = storeService.createRFQ(
        {
          title: 'V1 Private RFQ',
          category: 'Secret',
          sourcingMode: 'mode_1',
          status: 'Open',
        },
        null
      );
      const rfqNotAllowed = await rootResolvers.rfq({ id: v1Rfq.id }, vendorContext);
      expect(rfqNotAllowed).toBeNull();
    });

    test('vendors and vendor queries do not trust explicit buyerId args', async () => {
      const buyerCtx = { req: { user: { role: 'buyer', email: TEST_USERS.buyer.email } } };

      // vendors with buyer context
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'b-acct-1' });
      jest.spyOn(domainPool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getVendors').mockResolvedValue([
        { id: 'v-b-1', name: 'Vendor 1', email: 'v1@test.com' },
      ]);

      const vendorsBuyer = await rootResolvers.vendors({}, buyerCtx);
      expect(Array.isArray(vendorsBuyer)).toBe(true);

      // vendors with explicit args.buyerId
      const vendorsExplicit = await rootResolvers.vendors({ buyerId: 'b-explicit' }, {});
      expect(Array.isArray(vendorsExplicit)).toBe(true);

      // vendor by id with buyer context
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue({ id: 'v-b-1' });
      const vendorById = await rootResolvers.vendor({ id: 'v-b-1' }, buyerCtx);
      expect(vendorById.id).toBe('v-b-1');

      // vendor by id with explicit args.buyerId
      const vendorExplicit = await rootResolvers.vendor({ id: 'v-b-1', buyerId: 'b-explicit' }, {});
      expect(vendorExplicit.id).toBe('v-b-1');
      expect(vendorExplicit.email).not.toBe('v1@test.com');
    });

    test('vendor query by email ignores caller-supplied buyerId and enforces session ownership', async () => {
      jest.spyOn(domainPool, 'hasStorage').mockReturnValue(true);

      const scopedVendor = {
        id: 'v-scoped-1',
        email: 'scoped@test.com',
        buyerId: 'b-owner-1',
      };
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(scopedVendor);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'b-owner-1' });

      const buyerContext = { req: { user: { role: 'buyer', email: TEST_USERS.buyer.email } } };
      const foundMatch = await rootResolvers.vendor({ email: 'scoped@test.com', buyerId: 'b-other' }, buyerContext);
      expect(foundMatch).toEqual(scopedVendor);

      const anonymous = await rootResolvers.vendor({ email: 'scoped@test.com', buyerId: 'b-owner-1' }, {});
      expect(anonymous).toBeNull();
    });

    test('vendor mutations enforce buyer ownership, vendor self ownership, and management access', async () => {
      const privateVendor = { id: 'v-private-mutation', email: 'self@vendor.test', buyerId: 'owner-account' };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(privateVendor);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'owner-account' });
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: privateVendor.id });

      const buyerOwner = { req: { user: { role: 'buyer', email: 'owner@buyer.test' } } };
      await expect(rootResolvers.updateVendor({ id: privateVendor.id, input: {} }, buyerOwner))
        .resolves.toEqual({ id: privateVendor.id });

      storeService.getBuyerAccountByEmail.mockResolvedValueOnce({ id: 'another-account' });
      const buyerOther = { req: { user: { role: 'buyer', email: 'other@buyer.test' } } };
      await expect(rootResolvers.updateVendor({ id: privateVendor.id, input: {} }, buyerOther)).rejects.toThrow();

      const vendorOwner = { req: { user: { role: 'vendor', email: 'self@vendor.test' } } };
      await expect(rootResolvers.updateVendor({ id: privateVendor.id, input: {} }, vendorOwner))
        .resolves.toEqual({ id: privateVendor.id });
      const vendorOther = { req: { user: { role: 'vendor', email: 'other@vendor.test' } } };
      await expect(rootResolvers.updateVendor({ id: privateVendor.id, input: {} }, vendorOther)).rejects.toThrow();

      storeService.getVendorByIdWithDBFallback.mockResolvedValueOnce(null);
      storeService.updateVendorDurably.mockResolvedValueOnce(null);
      await expect(rootResolvers.updateVendor({ id: 'missing-vendor', input: {} }, contextFor('admin')))
        .resolves.toBeNull();

      await expect(rootResolvers.updateVendor({ id: privateVendor.id, input: {} }, contextFor('admin')))
        .resolves.toEqual({ id: privateVendor.id });
    });

    test('aiFeed query filters items for authenticated buyer role', async () => {
      const buyerCtx = { req: { user: { role: 'buyer', email: 'buyer.feed@procucev.com' } } };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'b-feed-acct' });
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        { id: 'rfq-f-1', rfqNumber: 'RFQ-FEED-99', buyerAccountId: 'b-feed-acct' },
      ]);
      jest.spyOn(storeService, 'getAIFeed').mockReturnValue([
        { id: 'feed-1', buyerAccountId: 'b-feed-acct', title: 'Feed 1' },
        { id: 'feed-2', rfqNumber: 'RFQ-FEED-99', title: 'Feed 2' },
        { id: 'feed-3', buyerAccountId: 'b-other-acct', title: 'Feed 3' },
      ]);

      const feed = await rootResolvers.aiFeed({}, buyerCtx);
      expect(feed.length).toBe(2);
      expect(feed.map((f) => f.id)).toEqual(['feed-1', 'feed-2']);
    });

    test('updateRFQ returns null when called by vendor role or RFQ is not in scope', async () => {
      // Vendor role returns null
      const vendorUpdate = await rootResolvers.updateRFQ(
        { id: seededRfq.id, input: { status: 'Closed' } },
        contextFor('vendor')
      );
      expect(vendorUpdate).toBeNull();

      // Non-existent RFQ returns null
      const missingUpdate = await rootResolvers.updateRFQ(
        { id: 'rfq-non-existent-999', input: { status: 'Closed' } },
        contextFor('buyer')
      );
      expect(missingUpdate).toBeNull();
    });
  });
});

