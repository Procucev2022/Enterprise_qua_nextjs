const domainQueries = require('../src/db/domainQueries');
const auditLogQueries = require('../src/db/auditLogQueries');
const vendorRfqUnlockQueries = require('../src/db/vendorRfqUnlockQueries');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');

describe('Domain queries (vendors + RFQs, Neon PostgreSQL)', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
    if (pool.queryCache) pool.queryCache.clear();
  });

  afterEach(() => {
    pool.pool = originalPool;
    if (pool.queryCache) pool.queryCache.clear();
    jest.restoreAllMocks();
  });

  describe('not configured', () => {
    beforeEach(() => {
      pool.pool = null;
    });

    test('getVendorsFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([]);
    });

    test('upsertVendorInDB returns null', async () => {
      await expect(domainQueries.upsertVendorInDB({ id: 'v-1' })).resolves.toBeNull();
    });

    test('vendor snapshot and compare-and-swap helpers return null without storage', async () => {
      const snapshot = { id: 'v-1', vendor: { id: 'v-1' }, raw: '{"id":"v-1"}' };
      await expect(domainQueries.getVendorSnapshotByIdFromDB('v-1')).resolves.toBeNull();
      await expect(domainQueries.getVendorSnapshotByEmailFromDB('vendor@example.test')).resolves.toBeNull();
      await expect(domainQueries.updateVendorIfUnchangedInDB(snapshot, snapshot.vendor)).resolves.toBeNull();
    });

    test('deleteVendorInDB returns false', async () => {
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(false);
    });

    test('bulkInsertVendorsInDB returns an empty array', async () => {
      await expect(domainQueries.bulkInsertVendorsInDB([{ id: 'v-1', email: 'a@x.com' }])).resolves.toEqual([]);
    });

    test('createBulkImportSessionInDB / getBulkImportSessionFromDB / incrementBulkImportSessionInDB all return null', async () => {
      await expect(domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', 100)).resolves.toBeNull();
      await expect(domainQueries.getBulkImportSessionFromDB('s-1')).resolves.toBeNull();
      await expect(domainQueries.incrementBulkImportSessionInDB('s-1', { processed: 1 })).resolves.toBeNull();
    });

    test('getRFQsFromDB returns an empty array', async () => {
      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([]);
    });

    test('closeExpiredRFQsInDB returns an empty array without storage', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      await expect(domainQueries.closeExpiredRFQsInDB('2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'expired'))
        .resolves.toEqual([]);
    });

    test('upsertRFQInDB returns null', async () => {
      await expect(domainQueries.upsertRFQInDB({ id: 'rfq-1' })).resolves.toBeNull();
    });

    test('RFQ snapshot reads and compare-and-swap updates return null without storage', async () => {
      const snapshot = { id: 'rfq-1', rfq: { id: 'rfq-1' }, raw: '{"id":"rfq-1"}' };
      await expect(domainQueries.getRFQSnapshotByIdFromDB('rfq-1')).resolves.toBeNull();
      await expect(domainQueries.updateRFQIfUnchangedInDB(snapshot, snapshot.rfq)).resolves.toBeNull();
    });

    test('deleteRFQInDB returns false', async () => {
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(false);
    });

    test('getEvaluationsFromDB returns an empty array', async () => {
      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([]);
    });

    test('upsertEvaluationInDB returns null', async () => {
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-1' })).resolves.toBeNull();
    });

    test('getVendorCatalogueFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([]);
    });

    test('catalogue item reads return empty results when storage is not configured', async () => {
      await expect(domainQueries.getVendorCatalogueByVendorFromDB('v-1')).resolves.toEqual([]);
      await expect(domainQueries.getCatalogueProductByIdFromDB('prod-1')).resolves.toBeNull();
    });

    test('upsertCatalogueProductInDB returns null', async () => {
      await expect(domainQueries.upsertCatalogueProductInDB({ id: 'prod-1' })).resolves.toBeNull();
    });

    test('deleteCatalogueProductInDB returns false', async () => {
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(false);
    });

    test('getBuyerAccountsFromDB returns an empty accounts list and null activeId', async () => {
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [], activeId: null });
    });

    test('upsertBuyerAccountInDB returns null', async () => {
      await expect(domainQueries.upsertBuyerAccountInDB({ id: 'buyer-1' })).resolves.toBeNull();
    });

    test('deleteBuyerAccountInDB returns false', async () => {
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB resolves without querying', async () => {
      await expect(domainQueries.setActiveBuyerAccountInDB('buyer-1')).resolves.toBeUndefined();
    });

    test('durable buyer-account active and delete operations report unavailable storage', async () => {
      await expect(domainQueries.setActiveBuyerAccountDurablyInDB('buyer-1')).resolves.toBeNull();
      await expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB('buyer-1'))
        .resolves.toEqual({ deleted: false, activeAccount: null });
    });

    test('getAIFeedFromDB returns an empty array', async () => {
      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([]);
    });

    test('upsertAIFeedItemInDB returns null', async () => {
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-1' })).resolves.toBeNull();
    });

    test('getAuditLogsFromDB returns an empty array', async () => {
      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([]);
    });

    test('upsertAuditLogInDB returns null', async () => {
      await expect(domainQueries.upsertAuditLogInDB({ id: 'log-1' })).resolves.toBeNull();
    });

    test('notification helpers no-op', async () => {
      await expect(domainQueries.getNotificationsFromDB()).resolves.toEqual([]);
      await expect(domainQueries.insertNotificationInDB({ id: 'ntf-1' })).resolves.toBeNull();
      await expect(domainQueries.bulkInsertNotificationsInDB([{ id: 'ntf-1' }])).resolves.toEqual([]);
      await expect(domainQueries.markNotificationReadInDB('ntf-1', 'vendor', 'v-1')).resolves.toBe(false);
      await expect(domainQueries.markAllNotificationsReadInDB('vendor', 'v-1')).resolves.toBe(0);
    });
  });

  describe('vendors', () => {
    test('getVendorsFromDB maps rows to their raw objects, newest first', async () => {
      const vendor = { id: 'v-1', name: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([vendor]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    describe('getVendorsPageFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorsPageFromDB({ limit: 50, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
      });

      test('runs a plain LIMIT/OFFSET query with no WHERE clause when there is no search or publicOnly', async () => {
        const vendor = { id: 'v-1', name: 'Apex' };
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: vendor }] });
        pool.pool = { query };

        const result = await domainQueries.getVendorsPageFromDB({ limit: 50, offset: 100 });

        expect(result).toEqual({ rows: [vendor], total: 1 });
        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).not.toContain('WHERE');
        expect(countParams).toEqual([]);
        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $1 OFFSET $2');
        expect(dataParams).toEqual([50, 100]);
      });

      test('adds a search WHERE clause across name/email/category/minorCategories', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'fastener' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain('WHERE');
        expect(countSql).toContain('major_category ILIKE $1');
        expect(countParams).toEqual(['%fastener%']);
      });

      test('caches exact vendor counts across pages and vendor writes invalidate the count', async () => {
        const query = jest.fn()
          .mockResolvedValueOnce({ rows: [{ total: 7 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-2' } }] })
          .mockResolvedValueOnce({ rows: [{ total: 8 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-3' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 1, offset: 0, search: 'steel' });
        await domainQueries.getVendorsPageFromDB({ limit: 1, offset: 1, search: 'steel' });
        expect(query).toHaveBeenCalledTimes(3);
        expect(pool.queryCache.getMetrics().hits).toBe(1);

        pool.queryCache.invalidate('vendors');
        const refreshed = await domainQueries.getVendorsPageFromDB({ limit: 1, offset: 2, search: 'steel' });
        expect(refreshed.total).toBe(8);
        expect(query).toHaveBeenCalledTimes(5);
      });

      test('adds the publicOnly filter (no buyerId/buyerAccountId inside raw)', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 500, offset: 0, publicOnly: true });

        const [countSql] = query.mock.calls[0];
        expect(countSql).toContain("(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL");
      });

      test('combines search and publicOnly with AND', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'cables', publicOnly: true });

        const [countSql] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*buyerId/);
      });

      test('adds the scopedBuyerId filter (public vendors OR this buyer\'s own)', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 3 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, scopedBuyerId: 'ba-42' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain("(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL");
        expect(countSql).toContain("lower(raw->>'buyerId') = lower($1)");
        expect(countSql).toContain("lower(raw->>'buyerAccountId') = lower($1)");
        expect(countSql).toContain("lower(raw->>'buyerEmail') = lower($1)");
        expect(countParams).toEqual(['ba-42']);

        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');
        expect(dataParams).toEqual(['ba-42', 10, 0]);
      });

      test('combines search and scopedBuyerId with AND, using separate placeholders', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'pump', scopedBuyerId: 'ba-7' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*buyerId/);
        expect(countParams).toEqual(['%pump%', 'ba-7']);
      });

      test('does not add a scopedBuyerId filter when it is empty/falsy', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, scopedBuyerId: '' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).not.toContain('WHERE');
        expect(countParams).toEqual([]);
      });

      test('falls back to stale query cache when pool.query throws an error during getVendorsPageFromDB', async () => {
        const { queryCache } = require('../src/db/queryCache');
        const staleVendors = { rows: [{ id: 'stale-1', name: 'Stale Co' }], total: 1 };
        const cacheKey = queryCache.generateKey('vendors_page', [10, 0, '', '', '', '', '', false, '', true]);
        queryCache.set(cacheKey, [], staleVendors, { ttlMs: 1 });
        await new Promise((r) => setTimeout(r, 5));

        pool.pool = {
          query: jest.fn().mockRejectedValue(new Error('D1 DB is overloaded')),
        };

        const res = await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, skipCount: true });
        expect(res).toEqual(staleVendors);
      });

      test('adds an exact-match category filter', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 5 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, category: 'Fasteners' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain('major_category = $1');
        expect(countParams).toEqual(['Fasteners']);

        const [dataSql, dataParams] = query.mock.calls[1];
        expect(dataSql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');
        expect(dataParams).toEqual(['Fasteners', 10, 0]);
      });

      test('combines search and category with AND, using separate placeholders', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 0 }] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'steel', category: 'Fasteners' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toMatch(/WHERE[\s\S]* AND [\s\S]*major_category = \$2/);
        expect(countParams).toEqual(['%steel%', 'Fasteners']);
      });

      test('adds an email-specific filter when email parameter is provided', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1', email: 'specific@vendor.com' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, email: 'specific@vendor.com' });

        const [countSql, countParams] = query.mock.calls[0];
        expect(countSql).toContain("email ILIKE $1 OR raw->>'email' ILIKE $1");
        expect(countParams).toEqual(['%specific@vendor.com%']);
      });

      test('search includes contactPerson, location, city, and deliveryLocation', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-1' } }] });
        pool.pool = { query };

        await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'mumbai' });

        const [countSql] = query.mock.calls[0];
        expect(countSql).toContain("raw->>'contactPerson'");
        expect(countSql).toContain("raw->>'location'");
        expect(countSql).toContain("raw->>'city'");
        expect(countSql).toContain("raw->>'deliveryLocation'");
      });

      test('defaults total to 0 when the count query returns no row', async () => {
        const query = jest
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        pool.pool = { query };

        await expect(domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0 })).resolves.toEqual({ rows: [], total: 0 });
      });
    });

    describe('countVendorsCreatedBetween', () => {
      test('returns 0 when pool is not configured', async () => {
        pool.pool = null;
        await expect(domainQueries.countVendorsCreatedBetween(new Date(), new Date())).resolves.toBe(0);
      });

      test('returns 0 when dates are invalid', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.countVendorsCreatedBetween('not-a-date', 'invalid')).resolves.toBe(0);
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('queries database for vendor count within date range', async () => {
        const fromDate = new Date('2026-01-01T00:00:00Z');
        const toDate = new Date('2026-01-31T23:59:59Z');
        const query = jest.fn().mockResolvedValue({ rows: [{ count: 42 }] });
        pool.pool = { query };

        const count = await domainQueries.countVendorsCreatedBetween(fromDate, toDate);
        expect(count).toBe(42);

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('SELECT COUNT(*)::int AS count FROM vendors');
        expect(sql).toContain('created_at >= $1 AND created_at <= $2');
        expect(params).toEqual([fromDate.toISOString(), toDate.toISOString()]);
      });

      test('returns 0 when database query throws error', async () => {
        pool.pool = { query: jest.fn().mockRejectedValue(new Error('Connection failed')) };
        const count = await domainQueries.countVendorsCreatedBetween(new Date(), new Date());
        expect(count).toBe(0);
      });
    });

    describe('countPublicVendorsMatchingCategories', () => {
      test('no-ops to 0 when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.countPublicVendorsMatchingCategories(['Steels'])).resolves.toBe(0);
      });

      test('returns 0 for an empty / all-blank signal list without querying', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.countPublicVendorsMatchingCategories([])).resolves.toBe(0);
        await expect(domainQueries.countPublicVendorsMatchingCategories(['', '  '])).resolves.toBe(0);
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('counts matches across major and minor category pools, public vendors only', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ total: 20 }] });
        pool.pool = { query };

        const total = await domainQueries.countPublicVendorsMatchingCategories([
          'Raw Material',
          'Steels',
          'Engineering Spares - Mechanical',
          'Pipes & Pipe Fittings',
        ]);

        expect(total).toBe(20);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('COUNT(*)');
        expect(sql).toContain('major_category');
        expect(sql).toContain("raw->'minorCategories'");
        // Public-only clause present.
        expect(sql).toContain("(raw->>'buyerId') IS NULL");
        // De-duplicated, lower-cased, wildcard-wrapped params — one per distinct signal.
        expect(params).toEqual([
          '%raw material%',
          '%steels%',
          '%engineering spares - mechanical%',
          '%pipes & pipe fittings%',
        ]);
      });

      test('de-duplicates signals that differ only by case/whitespace', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ total: 3 }] });
        pool.pool = { query };

        await domainQueries.countPublicVendorsMatchingCategories(['Steels', ' steels ', 'STEELS']);

        const [, params] = query.mock.calls[0];
        expect(params).toEqual(['%steels%']);
      });

      test('defaults to 0 when the count query returns no row', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.countPublicVendorsMatchingCategories(['Steels'])).resolves.toBe(0);
      });
    });

    describe('getPublicVendorsMatchingCategories', () => {
      test('no-ops to [] when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getPublicVendorsMatchingCategories(['Steels'], 10)).resolves.toEqual([]);
      });

      test('returns [] for an empty / all-blank signal list without querying', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getPublicVendorsMatchingCategories([], 10)).resolves.toEqual([]);
        await expect(domainQueries.getPublicVendorsMatchingCategories(['', '  '], 10)).resolves.toEqual([]);
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns parsed matching vendor rows and binds the limit last', async () => {
        const vendor = { id: 'pv-1', name: 'Mamta Electrics', source: 'procucev_network' };
        const query = jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] });
        pool.pool = { query };

        const rows = await domainQueries.getPublicVendorsMatchingCategories(['Lighting'], 25);

        expect(rows).toEqual([vendor]);
        const [sql, params] = query.mock.calls[0];
        // Public-only filter and a LIMIT bound as the final parameter.
        expect(sql).toMatch(/LIMIT/i);
        expect(params[params.length - 1]).toBe(25);
        expect(params).toContain('%lighting%');
      });

      test('returns [] when the query yields no rows', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getPublicVendorsMatchingCategories(['Steels'], 10)).resolves.toEqual([]);
      });
    });

    describe('getVendorByEmailFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorByEmailFromDB('a@b.com')).resolves.toBeNull();
      });

      test('no-ops when no email is given', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getVendorByEmailFromDB('')).resolves.toBeNull();
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns the matching row', async () => {
        const vendor = { id: 'v-1', email: 'a@b.com' };
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };
        await expect(domainQueries.getVendorByEmailFromDB('a@b.com')).resolves.toEqual(vendor);
      });

      test('returns null when nothing matches', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getVendorByEmailFromDB('nobody@x.com')).resolves.toBeNull();
      });

      test('bypasses cached email results when requested by a durable mutation', async () => {
        pool.pool = {};
        const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: { id: 'vendor-fresh-email' } }] });
        await expect(domainQueries.getVendorByEmailFromDB('fresh@vendor.test', { fresh: true }))
          .resolves.toEqual({ id: 'vendor-fresh-email' });
        expect(querySpy).toHaveBeenCalledWith(
          expect.stringContaining('lower(email) = lower($1)'),
          ['fresh@vendor.test'],
          expect.objectContaining({ useCache: false, tag: 'vendors' })
        );
      });
    });

    describe('getVendorByIdFromDB', () => {
      test('no-ops when no pool is configured', async () => {
        pool.pool = null;
        await expect(domainQueries.getVendorByIdFromDB('v-1')).resolves.toBeNull();
      });

      test('no-ops when no id is given', async () => {
        pool.pool = { query: jest.fn() };
        await expect(domainQueries.getVendorByIdFromDB('')).resolves.toBeNull();
        expect(pool.pool.query).not.toHaveBeenCalled();
      });

      test('returns the matching row', async () => {
        const vendor = { id: 'v-1', email: 'a@b.com' };
        const spy = jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] });
        pool.pool = { query: spy };
        await expect(domainQueries.getVendorByIdFromDB('v-1')).resolves.toEqual(vendor);
        expect(spy).toHaveBeenCalledWith('SELECT raw FROM vendors WHERE id = $1 LIMIT 1', ['v-1']);
        // pool.query's 3rd arg ({d1:true}) is consumed by pool.js's own
        // wrapper, not forwarded to the underlying pg driver mock — matches
        // the existing assertion convention for every other test in this
        // file (see deleteCatalogueProductInDB's test / this session's fix
        // for that exact 2-vs-3-arg mismatch).
      });

      test('never returns a historical temporary password from vendor raw data', async () => {
        const spy = jest.fn().mockResolvedValue({ rows: [{ raw: { id: 'v-secret', tempPassword: 'legacy-secret' } }] });
        pool.pool = { query: spy };

        await expect(domainQueries.getVendorByIdFromDB('v-secret')).resolves.toEqual({ id: 'v-secret' });
      });

      test('returns null when nothing matches', async () => {
        pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(domainQueries.getVendorByIdFromDB('missing')).resolves.toBeNull();
      });

      test('can bypass the query cache when the caller needs current credit and entitlement state', async () => {
        pool.pool = {};
        const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: { id: 'v-fresh' } }] });
        await expect(domainQueries.getVendorByIdFromDB('v-fresh', { fresh: true })).resolves.toEqual({ id: 'v-fresh' });
        expect(querySpy).toHaveBeenCalledWith(
          'SELECT raw FROM vendors WHERE id = $1 LIMIT 1',
          ['v-fresh'],
          { d1: true, useCache: false, tag: 'vendors', ttlMs: 60000 }
        );
      });
    });

    test('upsertVendorInDB serializes the vendor and returns the stored raw row', async () => {
      const vendor = {
        id: 'v-1',
        email: 'v@x.com',
        majorCategory: 'Mechanical',
        status: 'ACTIVE',
        source: 'buyer_manual',
        name: 'Apex',
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      const result = await domainQueries.upsertVendorInDB(vendor);

      expect(result).toEqual(vendor);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['v-1', 'v@x.com', 'Mechanical', 'ACTIVE', 'buyer_manual', JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB strips temporary passwords from writes and returned records', async () => {
      const vendor = { id: 'v-secret', email: 'secret@vendor.test', tempPassword: 'plain-text-secret' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await expect(domainQueries.upsertVendorInDB(vendor)).resolves.toEqual({ id: 'v-secret', email: 'secret@vendor.test' });

      const [, params] = pool.pool.query.mock.calls[0];
      expect(JSON.parse(params[5])).toEqual({ id: 'v-secret', email: 'secret@vendor.test' });
      expect(JSON.stringify(params)).not.toContain('plain-text-secret');
    });

    test('upsertVendorInDB falls back missing nullable fields to null', async () => {
      const vendor = { id: 'v-2', name: 'Bare Vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await domainQueries.upsertVendorInDB(vendor);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['v-2', null, null, null, null, JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertVendorInDB({ id: 'v-3' })).resolves.toBeNull();
    });

    test('normalizes vendor email before writing both the typed column and raw payload', async () => {
      const vendor = { id: 'v-case', email: '  Sales@Example.COM ', name: 'Case Vendor' };
      const stored = { ...vendor, email: 'sales@example.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: stored }] }) };

      await expect(domainQueries.upsertVendorInDB(vendor)).resolves.toEqual(stored);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params[1]).toBe('sales@example.com');
      expect(JSON.parse(params[5])).toEqual(stored);
      expect(vendor.email).toBe('  Sales@Example.COM ');
    });

    test('returns null for an invalid vendor record without issuing a query', async () => {
      const query = jest.fn();
      pool.pool = { query };
      await expect(domainQueries.upsertVendorInDB(null)).resolves.toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    test('deleteVendorInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendors WHERE id = $1', ['v-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteVendorInDB('v-x')).resolves.toBe(false);
    });

    test('bulkInsertVendorsInDB returns [] without querying when the batch is empty', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.bulkInsertVendorsInDB([])).resolves.toEqual([]);
      expect(pool.pool.query).not.toHaveBeenCalled();
    });

    test('bulk vendor writes normalize casing and whitespace for email uniqueness', async () => {
      const vendor = { id: 'v-normalized', email: '  Vendor@Example.COM  ', name: 'Normalized' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ email: 'vendor@example.com' }] }) };

      await expect(domainQueries.bulkInsertVendorsInDB([vendor])).resolves.toEqual(['vendor@example.com']);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params[1]).toBe('vendor@example.com');
      expect(JSON.parse(params[5]).email).toBe('vendor@example.com');
    });

    test('bulkInsertVendorsInDB builds one multi-row INSERT with ON CONFLICT (email) DO NOTHING and returns the emails that landed', async () => {
      const v1 = { id: 'v-1', email: 'a@x.com', majorCategory: 'Mechanical', status: 'REGISTERED / NOT EVALUATED', source: 'excel' };
      const v2 = { id: 'v-2', email: 'b@x.com', name: 'Bare' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ email: 'a@x.com' }] }) };

      const result = await domainQueries.bulkInsertVendorsInDB([v1, v2]);

      expect(result).toEqual(['a@x.com']);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (email) DO NOTHING');
      expect(sql).toContain('($1, $2, $3, $4, $5, $6, now())');
      expect(sql).toContain('($7, $8, $9, $10, $11, $12, now())');
      expect(params).toEqual([
        'v-1', 'a@x.com', 'Mechanical', 'REGISTERED / NOT EVALUATED', 'excel', JSON.stringify(v1),
        'v-2', 'b@x.com', null, null, null, JSON.stringify(v2),
      ]);
    });

    test('createBulkImportSessionInDB inserts a new session row and returns it', async () => {
      const sessionRow = { id: 's-1', status: 'IN_PROGRESS', total_rows_declared: 500 };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [sessionRow] }) };

      const result = await domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', 500);

      expect(result).toEqual(sessionRow);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO bulk_vendor_import_sessions');
      expect(params).toEqual(['s-1', 'cm@x.com', 500]);
    });

    test('createBulkImportSessionInDB defaults totalRowsDeclared to 0 when omitted', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };
      await domainQueries.createBulkImportSessionInDB('s-1', 'cm@x.com', undefined);
      expect(pool.pool.query.mock.calls[0][1]).toEqual(['s-1', 'cm@x.com', 0]);
    });

    test('getBulkImportSessionFromDB returns null when no row matches', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getBulkImportSessionFromDB('missing')).resolves.toBeNull();
    });

    test('getBulkImportSessionFromDB returns the matching row', async () => {
      const sessionRow = { id: 's-1', status: 'IN_PROGRESS' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [sessionRow] }) };
      await expect(domainQueries.getBulkImportSessionFromDB('s-1')).resolves.toEqual(sessionRow);
      expect(pool.pool.query.mock.calls[0][1]).toEqual(['s-1']);
    });

    test('incrementBulkImportSessionInDB adds every delta field, defaulting missing ones to 0', async () => {
      const updated = { id: 's-1', status: 'IN_PROGRESS', processed_count: 10 };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [updated] }) };

      const result = await domainQueries.incrementBulkImportSessionInDB('s-1', { processed: 10, imported: 8 });

      expect(result).toEqual(updated);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE bulk_vendor_import_sessions');
      expect(params).toEqual(['s-1', 10, 8, 0, 0, 0]);
    });

    test('incrementBulkImportSessionInDB returns null when the session id does not exist', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.incrementBulkImportSessionInDB('missing', {})).resolves.toBeNull();
    });
  });

  describe('rfqs', () => {
    test('getRFQsFromDB maps rows to their raw objects, newest first', async () => {
      const rfq = { id: 'rfq-1', title: 'Test RFQ' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([rfq]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('getRFQsFromDB with buyerAccountId and limit applies filtering and limit clause', async () => {
      const rfq = { id: 'rfq-scoped', buyerAccountId: 'buyer-acc-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      const res = await domainQueries.getRFQsFromDB('buyer-acc-1', 25);
      expect(res).toEqual([rfq]);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain("raw->>'buyerAccountId' = $1");
      expect(sql).toContain('LIMIT $2');
      expect(params).toEqual(['buyer-acc-1', 25]);
    });

    test('getRFQsByBuyerFromDB delegates to getRFQsFromDB with limit', async () => {
      const rfq = { id: 'rfq-scoped-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      const res = await domainQueries.getRFQsByBuyerFromDB('buyer-acc-2', 15);
      expect(res).toEqual([rfq]);
      expect(pool.pool.query.mock.calls[0][1]).toEqual(['buyer-acc-2', 15]);
    });

    test('upsertRFQInDB serializes the RFQ and returns the stored raw row', async () => {
      const rfq = {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-0001',
        category: 'Mechanical',
        status: 'open',
        sourcingMode: 'mode_1',
        budget: 1000,
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      const result = await domainQueries.upsertRFQInDB(rfq);

      expect(result).toEqual(rfq);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO rfqs');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['rfq-1', 'RFQ-2026-0001', 'Mechanical', 'open', 'mode_1', 1000, JSON.stringify(rfq)]);
    });

    test('upsertRFQInDB falls back a non-numeric budget to null', async () => {
      const rfq = { id: 'rfq-2', budget: 'not-a-number' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params[5]).toBeNull();
    });

    test('upsertRFQInDB falls back missing nullable fields to null', async () => {
      const rfq = { id: 'rfq-3' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['rfq-3', null, null, null, null, null, JSON.stringify(rfq)]);
    });

    test('getRFQSnapshotByIdFromDB preserves the raw value for a compare-and-swap write', async () => {
      const rfq = { id: 'rfq-snapshot', title: 'Before' };
      const raw = JSON.stringify(rfq);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: rfq.id, raw }] });

      await expect(domainQueries.getRFQSnapshotByIdFromDB(rfq.id)).resolves.toEqual({ id: rfq.id, rfq, raw });
      expect(querySpy).toHaveBeenCalledWith(
        'SELECT id, raw FROM rfqs WHERE id = $1 OR rfq_number = $1 LIMIT 1',
        [rfq.id],
        { d1: true }
      );
    });

    test('vendor snapshots preserve the exact raw value for compare-and-swap updates', async () => {
      const vendor = { id: 'vendor-snapshot', name: 'Before' };
      const raw = JSON.stringify(vendor);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: vendor.id, raw }] });

      await expect(domainQueries.getVendorSnapshotByIdFromDB(vendor.id)).resolves.toEqual({ id: vendor.id, vendor, raw });
      expect(querySpy).toHaveBeenCalledWith(
        'SELECT id, raw FROM vendors WHERE id = $1 LIMIT 1',
        [vendor.id],
        { d1: true }
      );
    });

    test('vendor compare-and-swap guards raw data and updates indexed columns', async () => {
      const before = { id: 'vendor-cas', email: 'old@example.test', name: 'Before' };
      const after = { ...before, email: 'NEW@example.test', name: 'After' };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: after }] });

      await expect(domainQueries.updateVendorIfUnchangedInDB({
        id: before.id,
        vendor: before,
        raw: JSON.stringify(before),
      }, after)).resolves.toEqual(after);

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('WHERE id = $1 AND raw = $7::jsonb');
      expect(options.d1Text).toContain('WHERE id = $1 AND raw = $7');
      expect(params).toEqual([
        before.id,
        'new@example.test',
        null,
        null,
        null,
        JSON.stringify({ ...after, email: 'new@example.test' }),
        JSON.stringify(before),
      ]);
    });

    test('updateRFQIfUnchangedInDB uses a raw equality guard for Postgres and D1', async () => {
      const previous = { id: 'rfq-cas', rfqNumber: 'RFQ-CAS', title: 'Before', budget: 150 };
      const updated = { ...previous, title: 'After' };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: updated }] });

      await expect(domainQueries.updateRFQIfUnchangedInDB({
        id: previous.id,
        rfq: previous,
        raw: JSON.stringify(previous),
      }, updated)).resolves.toEqual(updated);

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('WHERE id = $1 AND raw = $8::jsonb');
      expect(options.d1Text).toContain('WHERE id = $1 AND raw = $8');
      expect(params).toEqual([
        previous.id,
        previous.rfqNumber,
        null,
        null,
        null,
        150,
        JSON.stringify(updated),
        JSON.stringify(previous),
      ]);
    });

    test('updateRFQIfUnchangedInDB returns null when another writer changed the snapshot first', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      await expect(domainQueries.updateRFQIfUnchangedInDB({
        id: 'rfq-conflict',
        rfq: { id: 'rfq-conflict' },
        raw: { id: 'rfq-conflict' },
      }, { id: 'rfq-conflict', title: 'Local patch' })).resolves.toBeNull();
    });

    test('closeExpiredRFQsInDB atomically closes eligible rows and returns stored RFQs', async () => {
      const closed = { id: 'rfq-due', status: 'Closed' };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: closed }] });

      await expect(domainQueries.closeExpiredRFQsInDB(
        '2026-01-01T00:00:00.000Z',
        '2026-01-03T00:00:00.000Z',
        'expired'
      )).resolves.toEqual([closed]);

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain("status = 'Closed'");
      expect(sql).toContain("raw->>'createdAt' <= $1");
      expect(sql).toContain("raw->>'poFinalised'");
      expect(options.d1Text).toContain('json_patch(raw, $2)');
      expect(options.d1Text).toContain("json_extract(raw, '$.createdAt') <= $1");
      expect(params).toEqual([
        '2026-01-01T00:00:00.000Z',
        JSON.stringify({ status: 'Closed', closedAt: '2026-01-03T00:00:00.000Z', closedReason: 'expired' }),
      ]);
    });

    test('closeExpiredRFQsInDB returns no rows when another scheduler already closed them', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      await expect(domainQueries.closeExpiredRFQsInDB('cutoff', 'closed-at', 'reason')).resolves.toEqual([]);
    });

    test('extendRFQOnceInDB applies a conditional update and returns the persisted RFQ', async () => {
      const updates = { isExtended: true, extensionHours: 24, deadline: '2026-11-05T00:00:00.000Z' };
      const updated = { id: 'rfq-extend', ...updates };
      pool.pool = {};
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: updated }] });
      const invalidateSpy = jest.spyOn(pool.queryCache, 'invalidate');

      await expect(domainQueries.extendRFQOnceInDB('rfq-extend', updates)).resolves.toEqual(updated);
      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain("COALESCE(raw->>'isExtended', 'false') <> 'true'");
      expect(sql).toContain("COALESCE(raw->>'status', status, '') NOT IN ('Closed', 'Expired')");
      expect(sql).toContain('RETURNING raw');
      expect(params).toEqual(['rfq-extend', JSON.stringify(updates)]);
      expect(options.d1).toBe(true);
      expect(options.d1Text).toContain('json_set(');
      expect(options.d1Text).toContain("COALESCE(json_extract(raw, '$.isExtended'), 0) NOT IN (1, 'true')");
      expect(sql).toContain("COALESCE(raw->>'extendedAt', '') = ''");
      expect(sql).toContain("COALESCE(raw->>'extensionHours', '') = ''");
      expect(options.d1Text).toContain("COALESCE(json_extract(raw, '$.extendedAt'), '') = ''");
      expect(options.d1Text).toContain("COALESCE(json_extract(raw, '$.extensionHours'), '') = ''");
      expect(invalidateSpy).toHaveBeenCalledWith('rfqs');
    });

    test('extendRFQOnceInDB returns null when a concurrent extension already won', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.extendRFQOnceInDB('rfq-extend', { isExtended: true })).resolves.toBeNull();
    });

    test('extendRFQOnceInDB is a no-op without configured storage', async () => {
      pool.pool = null;
      await expect(domainQueries.extendRFQOnceInDB('rfq-extend', { isExtended: true })).resolves.toBeNull();
    });

    test('deleteRFQInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM rfqs WHERE id = $1', ['rfq-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-x')).resolves.toBe(false);
    });
  });

  describe('evaluations', () => {
    test('getEvaluationsFromDB maps rows to their raw objects, newest first', async () => {
      const evaluation = { id: 'eval-1', vendorName: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([evaluation]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertEvaluationInDB serializes the evaluation and returns the stored raw row', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-001', status: 'PREFERRED ENTERPRISE SUPPLIER' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      const result = await domainQueries.upsertEvaluationInDB(evaluation);

      expect(result).toEqual(evaluation);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO evaluations');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['eval-1', 'v-001', 'PREFERRED ENTERPRISE SUPPLIER', JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB falls back missing nullable fields to null', async () => {
      const evaluation = { id: 'eval-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await domainQueries.upsertEvaluationInDB(evaluation);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['eval-2', null, null, JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-3' })).resolves.toBeNull();
    });

    // evaluations has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getEvaluationsFromDB parses a string raw column (D1)', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(evaluation) }] }) };

      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([evaluation]);
    });

    test('upsertEvaluationInDB parses a string raw column (D1)', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(evaluation) }] }) };

      await expect(domainQueries.upsertEvaluationInDB(evaluation)).resolves.toEqual(evaluation);
    });
  });

  describe('vendor catalogue', () => {
    test('getVendorCatalogueFromDB maps rows to their raw objects, newest first', async () => {
      const product = { id: 'prod-1', name: 'Impeller' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([product]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('getVendorCatalogueByVendorFromDB uses a bounded vendor-indexed read', async () => {
      const product = { id: 'prod-1', vendorId: 'v-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await expect(domainQueries.getVendorCatalogueByVendorFromDB('v-1', 101)).resolves.toEqual([product]);
      expect(pool.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE vendor_id = $1'),
        ['v-1', 101]
      );
    });

    test('getCatalogueProductByIdFromDB reads one product and parses D1 text JSON', async () => {
      const product = { id: 'prod-1', vendorId: 'v-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(product) }] }) };

      await expect(domainQueries.getCatalogueProductByIdFromDB('prod-1')).resolves.toEqual(product);
      expect(pool.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 LIMIT 1'),
        ['prod-1']
      );
    });

    test('upsertCatalogueProductInDB serializes the product and returns the stored raw row', async () => {
      const product = { id: 'prod-1', vendorId: 'v-001', sku: 'SKU-1', category: 'Pumps' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      const result = await domainQueries.upsertCatalogueProductInDB(product);

      expect(result).toEqual(product);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendor_catalogue');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('lower(trim(sku)) = lower(trim($3))');
      expect(params).toEqual(['prod-1', 'v-001', 'SKU-1', 'Pumps', JSON.stringify(product)]);
    });

    test('upsertCatalogueProductInDB rejects a duplicate SKU when the conditional insert returns no row', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

      await expect(domainQueries.upsertCatalogueProductInDB({
        id: 'prod-duplicate',
        vendorId: 'v-001',
        sku: ' sku-1 ',
      })).rejects.toMatchObject({
        statusCode: 409,
        code: 'CATALOGUE_SKU_CONFLICT',
      });

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual([
        'prod-duplicate',
        'v-001',
        'sku-1',
        null,
        JSON.stringify({ id: 'prod-duplicate', vendorId: 'v-001', sku: 'sku-1' }),
      ]);
    });

    test('upsertCatalogueProductInDB routes D1 through one conditional duplicate-safe write', async () => {
      const product = { id: 'prod-d1', vendorId: 'v-d1', sku: 'SKU-D1' };
      pool.pool = null;
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({});
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: product }], rowCount: 1 });

      await expect(domainQueries.upsertCatalogueProductInDB(product)).resolves.toEqual(product);

      const [, params, options] = querySpy.mock.calls[0];
      expect(params).toEqual(['prod-d1', 'v-d1', 'SKU-D1', null, JSON.stringify(product)]);
      expect(options.d1).toBe(true);
      expect(options.d1Text).toContain('NOT EXISTS');
      expect(options.d1Text).toContain('lower(trim(sku)) = lower(trim($3))');
    });

    test('upsertCatalogueProductInDB serializes concurrent PostgreSQL SKU writes by vendor', async () => {
      const product = { id: 'prod-pg', vendorId: 'v-pg', sku: 'SKU-PG' };
      const client = {
        query: jest.fn(async (sql) => sql.includes('INSERT INTO vendor_catalogue')
          ? { rows: [{ raw: product }], rowCount: 1 }
          : { rows: [], rowCount: 0 }),
        release: jest.fn(),
      };
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);

      await expect(domainQueries.upsertCatalogueProductInDB(product)).resolves.toEqual(product);

      expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['v-pg']
      );
      expect(client.query.mock.calls.some(([sql]) => sql.includes('NOT EXISTS'))).toBe(true);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('upsertCatalogueProductInDB falls back missing nullable fields to null', async () => {
      const product = { id: 'prod-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await domainQueries.upsertCatalogueProductInDB(product);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['prod-2', null, null, null, JSON.stringify({ id: 'prod-2', sku: null })]);
    });

    test('deleteCatalogueProductInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendor_catalogue WHERE id = $1', ['prod-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-x')).resolves.toBe(false);
    });

    // vendor_catalogue has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — raw comes back as a TEXT string there.
    test('getVendorCatalogueFromDB parses a string raw column (D1)', async () => {
      const product = { id: 'prod-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(product) }] }) };

      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([product]);
    });

    test('upsertCatalogueProductInDB parses a string raw column (D1)', async () => {
      const product = { id: 'prod-1', sku: 'SKU-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(product) }] }) };

      await expect(domainQueries.upsertCatalogueProductInDB(product)).resolves.toEqual(product);
    });
  });

  describe('buyer accounts', () => {
    test('getBuyerAccountsFromDB returns accounts and the active row id', async () => {
      const acc1 = { id: 'buyer-1', organizationName: 'L&T' };
      const acc2 = { id: 'buyer-2', organizationName: 'Siemens' };
      pool.pool = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { id: 'buyer-1', is_active: false, raw: acc1 },
            { id: 'buyer-2', is_active: true, raw: acc2 },
          ],
        }),
      };

      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [acc1, acc2], activeId: 'buyer-2' });
    });

    test('getBuyerAccountsFromDB returns a null activeId when no row is flagged active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'buyer-1', is_active: false, raw: { id: 'buyer-1' } }] }) };
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [{ id: 'buyer-1' }], activeId: null });
    });

    // buyer_accounts has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — raw comes back as a TEXT string there.
    test('getBuyerAccountsFromDB parses a string raw column (D1)', async () => {
      const acc = { id: 'buyer-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'buyer-1', is_active: true, raw: JSON.stringify(acc) }] }) };
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [acc], activeId: 'buyer-1' });
    });

    test('getBuyerAccountByEmailFromDB returns the matching account', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      await expect(domainQueries.getBuyerAccountByEmailFromDB('buyer@lt.com')).resolves.toEqual(account);
      expect(pool.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE lower(corporate_email) = lower($1)'),
        ['buyer@lt.com']
      );
    });

    test('getBuyerAccountByEmailFromDB parses a string raw column (D1)', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(account) }] }) };

      await expect(domainQueries.getBuyerAccountByEmailFromDB('buyer@lt.com')).resolves.toEqual(account);
    });

    test('buyer account snapshots and compare-and-swap preserve concurrent-write guards', async () => {
      const before = { id: 'buyer-cas', corporateEmail: 'buyer@example.test', organizationName: 'Before' };
      const raw = JSON.stringify(before);
      const after = { ...before, organizationName: 'After' };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ id: before.id, raw }] })
        .mockResolvedValueOnce({ rows: [{ raw: after }] });

      await expect(domainQueries.getBuyerAccountSnapshotByEmailFromDB(before.corporateEmail))
        .resolves.toEqual({ id: before.id, account: before, raw });
      await expect(domainQueries.updateBuyerAccountIfUnchangedInDB({ id: before.id, account: before, raw }, after))
        .resolves.toEqual(after);

      const [sql, params, options] = querySpy.mock.calls[1];
      expect(sql).toContain('WHERE id = $1 AND raw = $5::jsonb');
      expect(options.d1Text).toContain('WHERE id = $1 AND raw = $5');
      expect(params).toEqual([
        before.id,
        before.corporateEmail,
        null,
        JSON.stringify(after),
        raw,
      ]);
    });

    test('getBuyerAccountByEmailFromDB returns null when nothing matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getBuyerAccountByEmailFromDB('nobody@x.com')).resolves.toBeNull();
    });

    test('buyer account fresh lookups bypass cached records for email and id', async () => {
      pool.pool = {};
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: { id: 'buyer-fresh' } }] });

      await expect(domainQueries.getBuyerAccountByEmailFromDB('fresh@buyer.test', { fresh: true }))
        .resolves.toEqual({ id: 'buyer-fresh' });
      expect(querySpy).toHaveBeenLastCalledWith(
        expect.stringContaining('lower(corporate_email) = lower($1)'),
        ['fresh@buyer.test'],
        { d1: true, useCache: false, tag: 'buyer_accounts', ttlMs: 60000 }
      );

      await expect(domainQueries.getBuyerAccountByIdFromDB('buyer-fresh', { fresh: true }))
        .resolves.toEqual({ id: 'buyer-fresh' });
      expect(querySpy).toHaveBeenLastCalledWith(
        'SELECT raw FROM buyer_accounts WHERE id = $1 LIMIT 1',
        ['buyer-fresh'],
        { d1: true, useCache: false, tag: 'buyer_accounts', ttlMs: 60000 }
      );
    });

    test('getBuyerAccountByEmailFromDB returns null when not configured or no email given', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.getBuyerAccountByEmailFromDB('')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getBuyerAccountByEmailFromDB('x@y.com')).resolves.toBeNull();
    });

    test('getBuyerAccountByIdFromDB reads one persisted account', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(account) }] }) };

      await expect(domainQueries.getBuyerAccountByIdFromDB('buyer-1')).resolves.toEqual(account);
      expect(pool.pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['buyer-1']
      );
    });

    test('getBuyerAccountByIdFromDB returns null for missing IDs or when storage is unavailable', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getBuyerAccountByIdFromDB('missing')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getBuyerAccountByIdFromDB('buyer-1')).resolves.toBeNull();
    });

    test('upsertBuyerAccountInDB serializes the account and returns the stored raw row', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com', status: 'ACTIVE_VERIFIED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      const result = await domainQueries.upsertBuyerAccountInDB(account);

      expect(result).toEqual(account);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO buyer_accounts');
      expect(sql).not.toContain('is_active');
      expect(params).toEqual(['buyer-1', 'buyer@lt.com', 'ACTIVE_VERIFIED', JSON.stringify(account)]);
    });

    test('upsertBuyerAccountInDB falls back missing nullable fields to null', async () => {
      const account = { id: 'buyer-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      await domainQueries.upsertBuyerAccountInDB(account);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['buyer-2', null, null, JSON.stringify(account)]);
    });

    test('deleteBuyerAccountInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(true);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-x')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB flags exactly the given id active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({}) };
      await domainQueries.setActiveBuyerAccountInDB('buyer-2');
      expect(pool.pool.query).toHaveBeenCalledWith('UPDATE buyer_accounts SET is_active = (id = $1)', ['buyer-2']);
    });

    test('setActiveBuyerAccountDurablyInDB returns the persisted target row', async () => {
      const account = { id: 'buyer-2', organizationName: 'Second Buyer' };
      pool.pool = {
        query: jest.fn().mockResolvedValue({
          rows: [{ id: 'buyer-1', raw: { id: 'buyer-1' } }, { id: account.id, raw: account }],
        }),
      };

      await expect(domainQueries.setActiveBuyerAccountDurablyInDB(account.id)).resolves.toEqual(account);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('RETURNING id, raw'), [account.id]);
    });

    test('setActiveBuyerAccountDurablyInDB returns null when the target row is absent', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.setActiveBuyerAccountDurablyInDB('missing')).resolves.toBeNull();
    });

    test('deleteBuyerAccountAndPromoteActiveInDB uses a PostgreSQL transaction', async () => {
      const activeAccount = { id: 'buyer-next', organizationName: 'Next Buyer' };
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'buyer-delete' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ raw: activeAccount }] }),
      };
      pool.pool = {};
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));

      await expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB('buyer-delete'))
        .resolves.toEqual({ deleted: true, activeAccount });
      expect(client.query).toHaveBeenCalledTimes(3);
      expect(client.query.mock.calls[1][0]).toContain('ORDER BY is_active DESC, created_at DESC');
    });

    test('deleteBuyerAccountAndPromoteActiveInDB leaves state unchanged when the PostgreSQL row is absent', async () => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      pool.pool = {};
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => callback(client));

      await expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB('missing'))
        .resolves.toEqual({ deleted: false, activeAccount: null });
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    test('deleteBuyerAccountAndPromoteActiveInDB batches deletion and pointer promotion on Workers D1', async () => {
      const activeAccount = { id: 'buyer-next', organizationName: 'Next Buyer' };
      const binding = { prepare: jest.fn() };
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const batch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
        { rows: [{ id: 'buyer-delete' }], rowCount: 1 },
        { rows: [], rowCount: 2 },
        { rows: [{ raw: JSON.stringify(activeAccount) }], rowCount: 1 },
      ]);

      await expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB('buyer-delete'))
        .resolves.toEqual({ deleted: true, activeAccount });
      expect(batch).toHaveBeenCalledWith(binding, expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('DELETE FROM buyer_accounts') }),
        expect.objectContaining({ text: expect.stringContaining('UPDATE buyer_accounts') }),
      ]));
    });

    test('deleteBuyerAccountAndPromoteActiveInDB rejects a non-atomic D1 HTTP batch', async () => {
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ _isHttpClient: true });

      await expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB('buyer-delete'))
        .rejects.toThrow('cannot guarantee atomicity');
    });

    test('upsertBuyerAccountInDB parses a string raw column (D1)', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(account) }] }) };

      await expect(domainQueries.upsertBuyerAccountInDB(account)).resolves.toEqual(account);
    });
  });

  describe('AI feed', () => {
    test('getAIFeedFromDB maps rows to their raw objects, in sequence order', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: item }] }) };

      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([item]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('getAIFeedFromDB applies limit clause when limit is specified', async () => {
      const item = { id: 'feed-top' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: item }] }) };

      const res = await domainQueries.getAIFeedFromDB(10);
      expect(res).toEqual([item]);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('LIMIT $1');
      expect(params).toEqual([10]);
    });

    test('upsertAIFeedItemInDB inserts the item and trims the table to the newest 100 rows', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      const queryMock = jest.fn().mockResolvedValue({ rows: [{ raw: item }] });
      pool.pool = { query: queryMock };

      const result = await domainQueries.upsertAIFeedItemInDB(item);

      expect(result).toEqual(item);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO ai_feed');
      expect(queryMock.mock.calls[0][1]).toEqual(['feed-1', JSON.stringify(item)]);
      expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM ai_feed');
      expect(queryMock.mock.calls[1][0]).toContain('LIMIT 100');
    });

    test('upsertAIFeedItemInDB returns the saved row and logs when retention cleanup fails', async () => {
      const item = { id: 'feed-retention-warning', title: 'Saved before cleanup' };
      const queryMock = jest.fn()
        .mockResolvedValueOnce({ rows: [{ raw: item }] })
        .mockRejectedValueOnce(new Error('cleanup unavailable'));
      const warnSpy = jest.spyOn(require('../src/services/loggerService').logger, 'warn');
      pool.pool = { query: queryMock };

      await expect(domainQueries.upsertAIFeedItemInDB(item)).resolves.toEqual(item);
      expect(warnSpy).toHaveBeenCalledWith(
        'AI feed item was saved, but retention cleanup failed',
        expect.objectContaining({ itemId: item.id, error: expect.any(Error) }),
        'DATABASE_MAINTENANCE'
      );
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    test('upsertAIFeedItemInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-2' })).resolves.toBeNull();
    });

    // ai_feed has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getAIFeedFromDB parses a string raw column (D1)', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(item) }] }) };

      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([item]);
    });

    test('upsertAIFeedItemInDB parses a string raw column (D1)', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(item) }] }) };

      await expect(domainQueries.upsertAIFeedItemInDB(item)).resolves.toEqual(item);
    });
  });

  describe('audit logs', () => {
    test('getAuditLogsFromDB maps rows to their raw objects, in sequence order', async () => {
      const entry = { id: 'log-1', action: 'Created vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([entry]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('getAuditLogsFromDB applies limit clause when limit is specified', async () => {
      const entry = { id: 'log-top' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      const res = await domainQueries.getAuditLogsFromDB(50);
      expect(res).toEqual([entry]);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('LIMIT $1');
      expect(params).toEqual([50]);
    });

    test('legacy audit upsert delegates to the chain-safe append', async () => {
      const entry = { id: 'log-1', action: 'Created vendor', shaSignature: 'abc123' };
      const persisted = { ...entry, previousHash: 'authoritative-head' };
      const appendSpy = jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockResolvedValue(persisted);

      await expect(domainQueries.upsertAuditLogInDB(entry)).resolves.toEqual(persisted);
      expect(appendSpy).toHaveBeenCalledWith(entry);
    });

    // audit_logs has been ported to D1 (see d1Bridge.js), which has no JSON
    // column type — raw comes back as a TEXT string there.
    test('getAuditLogsFromDB parses a string raw column (D1)', async () => {
      const entry = { id: 'log-1', action: 'LOGIN' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(entry) }] }) };

      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([entry]);
    });

    test('legacy audit upsert preserves chain-safe D1 results', async () => {
      const entry = { id: 'log-1', action: 'LOGIN' };
      const persisted = { ...entry, previousHash: 'd1-authoritative-head' };
      jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockResolvedValue(persisted);

      await expect(domainQueries.upsertAuditLogInDB(entry)).resolves.toEqual(persisted);
    });
  });

  describe('notifications', () => {
    const NTF = {
      id: 'ntf-1',
      recipientType: 'vendor',
      recipientId: 'v-1',
      kind: 'rfq_category_match',
      rfqId: 'rfq-1',
      read: false,
      title: 'New RFQ',
    };

    test('getNotificationsFromDB maps rows to raw objects in sequence order', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: NTF }] }) };

      await expect(domainQueries.getNotificationsFromDB()).resolves.toEqual([NTF]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('getNotificationsFromDB applies recipientId filter and limit clause', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: NTF }] }) };

      const res = await domainQueries.getNotificationsFromDB('v-1', 20);
      expect(res).toEqual([NTF]);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('recipient_id = $1');
      expect(sql).toContain('LIMIT $2');
      expect(params).toEqual(['v-1', 20]);
    });

    test('insertNotificationInDB serializes the row and passes the typed columns', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: NTF }] }) };
      const querySpy = jest.spyOn(pool, 'query');

      const result = await domainQueries.insertNotificationInDB(NTF);

      expect(result).toEqual(NTF);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO notifications');
      expect(sql).toContain('raw = jsonb_set(EXCLUDED.raw');
      expect(querySpy).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
        d1Text: expect.stringContaining("raw = json_set(EXCLUDED.raw, '$.read'"),
      }));
      expect(params).toEqual(['ntf-1', 'vendor', 'v-1', 'rfq_category_match', 'rfq-1', false, JSON.stringify(NTF)]);
    });

    test('insertNotificationInDB tolerates a missing rfqId and returns null on no row', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      const result = await domainQueries.insertNotificationInDB({
        id: 'ntf-2',
        recipientType: 'buyer',
        recipientId: 'b-1',
        kind: 'quote_received',
      });

      expect(result).toBeNull();
      expect(pool.pool.query.mock.calls[0][1][4]).toBeNull();
    });

    test('bulkInsertNotificationsInDB writes one multi-row INSERT and returns the ids that landed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'ntf-1' }, { id: 'ntf-2' }] }) };

      const result = await domainQueries.bulkInsertNotificationsInDB([
        { ...NTF, id: 'ntf-1' },
        { ...NTF, id: 'ntf-2', rfqId: null },
      ]);

      expect(result).toEqual(['ntf-1', 'ntf-2']);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO notifications');
      expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
      expect(params).toHaveLength(14);
    });

    test('bulkInsertNotificationsInDB batches single-row statements on Workers D1', async () => {
      const binding = { prepare: jest.fn() };
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
      const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
        { rows: [{ id: 'ntf-worker-1' }], rowCount: 1 },
        { rows: [{ id: 'ntf-worker-2' }], rowCount: 1 },
      ]);

      await expect(domainQueries.bulkInsertNotificationsInDB([
        { ...NTF, id: 'ntf-worker-1' },
        { ...NTF, id: 'ntf-worker-2' },
      ])).resolves.toEqual(['ntf-worker-1', 'ntf-worker-2']);
      const [, statements] = batchSpy.mock.calls[0];
      expect(statements).toHaveLength(2);
      expect(statements.every((statement) => statement.params.length === 7)).toBe(true);
    });

    test('bulkInsertNotificationsInDB chunks the D1 HTTP adapter under the binding limit', async () => {
      const httpClient = { _isHttpClient: true };
      pool.pool = {};
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(httpClient);
      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'ntf-http-15' }] });
      const notifications = Array.from({ length: 15 }, (_, index) => ({ ...NTF, id: `ntf-http-${index + 1}` }));

      await expect(domainQueries.bulkInsertNotificationsInDB(notifications)).resolves.toEqual(['ntf-http-15']);
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[0][1]).toHaveLength(98);
      expect(querySpy.mock.calls[1][1]).toHaveLength(7);
    });

    test('bulkInsertNotificationsInDB returns empty for non-array input', async () => {
      pool.pool = {};
      await expect(domainQueries.bulkInsertNotificationsInDB(null)).resolves.toEqual([]);
    });

    test('bulkInsertNotificationsInDB no-ops on an empty list', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.bulkInsertNotificationsInDB([])).resolves.toEqual([]);
      expect(pool.pool.query).not.toHaveBeenCalled();
    });

    test('markNotificationReadInDB flips the column and the raw flag', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'ntf-1' }] }) };

      await expect(domainQueries.markNotificationReadInDB('ntf-1', 'vendor', 'v-1')).resolves.toBe(true);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE notifications');
      expect(sql).toContain("jsonb_set(raw, '{read}', 'true'::jsonb)");
      expect(sql).toContain('recipient_type = $2 AND recipient_id = $3');
      expect(sql).toContain('RETURNING id');
      expect(params).toEqual(['ntf-1', 'vendor', 'v-1']);
    });

    test('markNotificationReadInDB returns false when no row matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.markNotificationReadInDB('ntf-x', 'vendor', 'v-1')).resolves.toBe(false);
    });

    test('markAllNotificationsReadInDB returns the number of rows changed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 3 }) };

      await expect(domainQueries.markAllNotificationsReadInDB('vendor', 'v-1')).resolves.toBe(3);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('recipient_type = $1 AND recipient_id = $2 AND is_read = false');
      expect(params).toEqual(['vendor', 'v-1']);
    });
  });

  describe('Zoho OAuth token (single-row cache)', () => {
    test('not configured: getZohoOAuthTokenFromDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toBeNull();
    });

    test('not configured: upsertZohoOAuthTokenInDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.upsertZohoOAuthTokenInDB({ accessToken: 'x', expiryTime: 'y' })).resolves.toBeNull();
    });

    test('getZohoOAuthTokenFromDB reads the single default row', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ access_token: 'tok', expiry_time: '2026-01-01T00:00:00Z' }] }) };

      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toEqual({
        access_token: 'tok',
        expiry_time: '2026-01-01T00:00:00Z',
      });
      const [sql] = pool.pool.query.mock.calls[0];
      expect(sql).toContain("id = 'default'");
    });

    test('getZohoOAuthTokenFromDB returns null when no row exists yet', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getZohoOAuthTokenFromDB()).resolves.toBeNull();
    });

    test('upsertZohoOAuthTokenInDB upserts the single row and falls back nullable fields to null', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ access_token: 'tok', expiry_time: null }] }) };

      const result = await domainQueries.upsertZohoOAuthTokenInDB({ accessToken: 'tok' });

      expect(result).toEqual({ access_token: 'tok', expiry_time: null });
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO zoho_oauth_token');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['tok', null]);
    });
  });

  describe('Zoho payment links', () => {
    test('not configured: getPaymentLinksFromDB returns an empty array', async () => {
      pool.pool = null;
      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([]);
    });

    test('not configured: getPaymentLinkByZohoIdFromDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toBeNull();
    });

    test('not configured: upsertPaymentLinkInDB returns null', async () => {
      pool.pool = null;
      await expect(domainQueries.upsertPaymentLinkInDB({ id: 'pl-1' })).resolves.toBeNull();
    });

    test('getPaymentLinksFromDB maps rows to their raw objects, newest first', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([link]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('getPaymentLinkByZohoIdFromDB looks up by the Zoho id and returns its raw object', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toEqual(link);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE zoho_payment_link_id = $1'), ['zoho-1']);
    });

    test('getPaymentLinkByZohoIdFromDB returns null when nothing matched', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-x')).resolves.toBeNull();
    });

    // payment_links has been ported to D1 (see d1Bridge.js), which has no
    // JSON column type — `raw` comes back as a TEXT string there, not an
    // already-parsed object the way pg's jsonb driver returns it.
    test('getPaymentLinksFromDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.getPaymentLinksFromDB()).resolves.toEqual([link]);
    });

    test('getPaymentLinkByZohoIdFromDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.getPaymentLinkByZohoIdFromDB('zoho-1')).resolves.toEqual(link);
    });

    test('upsertPaymentLinkInDB parses a string raw column (D1)', async () => {
      const link = { id: 'pl-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(link) }] }) };

      await expect(domainQueries.upsertPaymentLinkInDB(link)).resolves.toEqual(link);
    });

    test('upsertPaymentLinkInDB serializes the link and returns the stored raw row', async () => {
      const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1', vendorId: 'v-1', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      const result = await domainQueries.upsertPaymentLinkInDB(link);

      expect(result).toEqual(link);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO payment_links');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['pl-1', 'zoho-1', 'v-1', null, 'vendor', 'CREATED', JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB serializes a buyer link with payerType/buyerAccountId', async () => {
      const link = { id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-b1', buyerAccountId: 'buyer-1', payerType: 'buyer', status: 'CREATED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await domainQueries.upsertPaymentLinkInDB(link);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['pl-buyer-1', 'zoho-b1', null, 'buyer-1', 'buyer', 'CREATED', JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB falls back missing nullable fields to null and payerType to vendor', async () => {
      const link = { id: 'pl-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await domainQueries.upsertPaymentLinkInDB(link);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['pl-2', null, null, null, 'vendor', null, JSON.stringify(link)]);
    });

    test('upsertPaymentLinkInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertPaymentLinkInDB({ id: 'pl-3' })).resolves.toBeNull();
    });

    test('getPaymentLinksByVendorFromDB maps rows with and without limit', async () => {
      const link = { id: 'pl-v1', vendorId: 'v-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinksByVendorFromDB('v-1', 10)).resolves.toEqual([link]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['v-1', 10]);

      await expect(domainQueries.getPaymentLinksByVendorFromDB('v-1', 0)).resolves.toEqual([link]);
      pool.pool = null;
      await expect(domainQueries.getPaymentLinksByVendorFromDB('v-1')).resolves.toEqual([]);
      await expect(domainQueries.getPaymentLinksByVendorFromDB('')).resolves.toEqual([]);
    });

    test('getPaymentLinksByBuyerFromDB maps rows with and without limit', async () => {
      const link = { id: 'pl-b1', buyerAccountId: 'b-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinksByBuyerFromDB('b-1', 5)).resolves.toEqual([link]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $2'), ['b-1', 5]);

      await expect(domainQueries.getPaymentLinksByBuyerFromDB('b-1', 0)).resolves.toEqual([link]);
      pool.pool = null;
      await expect(domainQueries.getPaymentLinksByBuyerFromDB('b-1')).resolves.toEqual([]);
      await expect(domainQueries.getPaymentLinksByBuyerFromDB('')).resolves.toEqual([]);
    });

    test('getPaymentLinkByIdFromDB returns matching row or null', async () => {
      const link = { id: 'pl-id-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: link }] }) };

      await expect(domainQueries.getPaymentLinkByIdFromDB('pl-id-1')).resolves.toEqual(link);
      const freshQuery = jest.fn().mockResolvedValue({ rows: [{ raw: link }] });
      pool.pool = { query: freshQuery };
      const querySpy = jest.spyOn(pool, 'query');
      await expect(domainQueries.getPaymentLinkByIdFromDB('pl-id-1', { fresh: true })).resolves.toEqual(link);
      expect(querySpy).toHaveBeenCalledWith(
        'SELECT raw FROM payment_links WHERE id = $1 LIMIT 1',
        ['pl-id-1'],
        expect.objectContaining({ d1: true, useCache: false })
      );
      querySpy.mockRestore();
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getPaymentLinkByIdFromDB('pl-missing')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getPaymentLinkByIdFromDB('pl-id-1')).resolves.toBeNull();
      await expect(domainQueries.getPaymentLinkByIdFromDB('')).resolves.toBeNull();
    });
  });

  describe('RFQs by number and id', () => {
    test('getRFQByNumberFromDB returns matching RFQ or null', async () => {
      const rfq = { id: 'rfq-1', rfqNumber: 'RFQ-001' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await expect(domainQueries.getRFQByNumberFromDB('RFQ-001')).resolves.toEqual(rfq);
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getRFQByNumberFromDB('RFQ-999')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getRFQByNumberFromDB('RFQ-001')).resolves.toBeNull();
    });

    test('getRFQByIdFromDB returns matching RFQ or null', async () => {
      const rfq = { id: 'rfq-1', rfqNumber: 'RFQ-001' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await expect(domainQueries.getRFQByIdFromDB('rfq-1')).resolves.toEqual(rfq);
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.getRFQByIdFromDB('missing')).resolves.toBeNull();
      pool.pool = null;
      await expect(domainQueries.getRFQByIdFromDB('rfq-1')).resolves.toBeNull();
    });
  });

  describe('vendors by buyer and per category', () => {
    test('getPublicVendorsPerCategoryFromDB returns deduplicated vendors', async () => {
      const v1 = { id: 'v1', email: 'v1@test.com' };
      const v2 = { id: 'v2', email: 'v2@test.com' };
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ raw: v1 }, { raw: v2 }] })
          .mockResolvedValueOnce({ rows: [{ raw: v2 }] }),
      };

      const res = await domainQueries.getPublicVendorsPerCategoryFromDB(['Pumps', 'Valves'], 5);
      expect(res).toEqual([v1, v2]);

      pool.pool = null;
      await expect(domainQueries.getPublicVendorsPerCategoryFromDB(['Pumps'])).resolves.toEqual([]);
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.getPublicVendorsPerCategoryFromDB([])).resolves.toEqual([]);
    });

    test('getVendorsByBuyerFromDB resolves candidate emails and returns vendors', async () => {
      const buyerAcc = { id: 'buyer-acc-1' };
      const v = { id: 'v-b1', name: 'Buyer Vendor' };
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ raw: buyerAcc }] }) // getBuyerAccountByEmailFromDB
          .mockResolvedValueOnce({ rows: [{ raw: v }] }), // getVendorsByBuyerFromDB
      };

      const res = await domainQueries.getVendorsByBuyerFromDB(['b-1'], 100, 'buyer@company.com');
      expect(res).toEqual([v]);

      // Cache hit branch
      const cachedRes = await domainQueries.getVendorsByBuyerFromDB(['b-1'], 100, 'buyer@company.com');
      expect(cachedRes).toEqual([v]);

      // Stale cache fallback test
      const { queryCache } = require('../src/db/queryCache');
      const staleVendors = [{ id: 'stale-buyer-v' }];
      queryCache.set('buyer_vendors:b-stale:500', [], staleVendors, { ttlMs: 1 });
      await new Promise((r) => setTimeout(r, 5));
      pool.pool = {
        query: jest.fn().mockRejectedValue(new Error('D1 DB is overloaded')),
      };
      const staleRes = await domainQueries.getVendorsByBuyerFromDB('b-stale', 500);
      expect(staleRes).toEqual(staleVendors);

      // Throws if no stale cache
      await expect(domainQueries.getVendorsByBuyerFromDB('b-nostale', 500)).rejects.toThrow('D1 DB is overloaded');

      pool.pool = null;
      await expect(domainQueries.getVendorsByBuyerFromDB('b-1')).resolves.toEqual([]);
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.getVendorsByBuyerFromDB(null, 50, null)).resolves.toEqual([]);
    });

    test('logs buyer-account candidate lookup failures and continues with the email scope', async () => {
      const { logger } = require('../src/services/loggerService');
      const vendor = { id: 'v-email-scope', buyerEmail: 'buyer@company.com' };
      pool.pool = {
        query: jest.fn()
          .mockRejectedValueOnce(new Error('buyer account query failed'))
          .mockResolvedValueOnce({ rows: [{ raw: vendor }] }),
      };
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect(domainQueries.getVendorsByBuyerFromDB([], 50, 'buyer@company.com'))
        .resolves.toEqual([vendor]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Buyer account lookup failed while resolving vendor ownership'),
        expect.objectContaining({ operation: 'resolve-vendor-buyer-candidates' }),
        'DATABASE_QUERY'
      );
    });

    test('getVendorsPageFromDB handles search query with length <= 3 and > 3', async () => {
      const v = { id: 'v-short', name: 'ABC Corp' };
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: v }] })
          .mockResolvedValueOnce({ rows: [{ total: 1 }] })
          .mockResolvedValueOnce({ rows: [{ raw: v }] }),
      };

      const res1 = await domainQueries.getVendorsPageFromDB({
        search: 'abc',
        email: 'abc@corp.com',
        category: 'Electronics',
        publicOnly: true,
        scopedBuyerId: 'b-1',
        limit: 10,
        offset: 0,
      });

      expect(res1.rows).toEqual([v]);
      expect(res1.total).toBe(1);

      const res2 = await domainQueries.getVendorsPageFromDB({
        search: 'long search term',
        limit: 'invalid',
        offset: -5,
      });
      expect(res2.rows).toEqual([v]);
    });

    test('bulkInsertVendorsInDB works with D1 binding and fallback', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      const spyBinding = jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({
        prepare: jest.fn().mockReturnValue({ bind: jest.fn().mockReturnValue({}) }),
      });
      const spyBatch = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValue([
        { rows: [{ email: 'v1@test.com' }] },
      ]);
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ email: 'v1@test.com' }] }) };

      const res = await domainQueries.bulkInsertVendorsInDB([{ id: 'v1', email: 'v1@test.com' }]);
      expect(res).toEqual(['v1@test.com']);
      spyBinding.mockRestore();
      spyBatch.mockRestore();

      // Test with empty array
      expect(await domainQueries.bulkInsertVendorsInDB([])).toEqual([]);
    });
  });

  describe('Chaser Queue', () => {
    const job = {
      id: 'job-1',
      rfqNumber: 'RFQ-001',
      rfqId: 'rfq-1',
      vendorId: 'v-1',
      vendorName: 'Vendor One',
      vendorPhone: '+919999999999',
      vendorEmail: 'v1@test.com',
      vendorContactPerson: 'John',
      rfqTitle: 'Pumps RFQ',
      channel: 'email',
      fireAt: '2026-10-25T10:00:00Z',
    };

    test('insertChaserJobInDB inserts a job', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      const res = await domainQueries.insertChaserJobInDB(job);
      expect(res).toEqual(job);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chaser_queue'), expect.any(Array));

      pool.pool = null;
      await expect(domainQueries.insertChaserJobInDB(job)).resolves.toBeNull();
    });

    test('markChaserJobFiredInDB updates job status', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await domainQueries.markChaserJobFiredInDB('job-1');
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining("status='fired'"), ['job-1']);

      pool.pool = null;
      await domainQueries.markChaserJobFiredInDB('job-1'); // safe no-op
    });

    test('markChaserJobFailedInDB schedules retry work and caps the terminal failure attempt', async () => {
      const originalNow = Date.now;
      Date.now = jest.fn(() => Date.parse('2026-11-05T00:00:00.000Z'));
      const { logger } = require('../src/services/loggerService');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'job-1', status: 'pending', attempts: 1, fire_at: 'retry-at' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'job-1', status: 'failed', attempts: 5 }] }),
      };
      try {
        await domainQueries.markChaserJobFailedInDB('job-1', 'SMTP timeout', 1);
        const retryCall = pool.pool.query.mock.calls[0];
        expect(retryCall[0]).toContain("CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END");
        expect(retryCall[0]).toContain("WHERE id = $1 AND status = 'processing'");
        expect(retryCall[1]).toEqual(['job-1', 'SMTP timeout', 5, '2026-11-05T00:00:30.000Z']);
        expect(warnSpy).toHaveBeenCalledWith('RFQ chaser delivery failed; retry scheduled', {
          chaserJobId: 'job-1',
          attempts: 1,
          nextAttemptAt: 'retry-at',
        }, 'RFQ_CHASER');

        await domainQueries.markChaserJobFailedInDB('job-1', undefined, 5);
        expect(pool.pool.query.mock.calls[1][1]).toEqual([
          'job-1',
          'unknown',
          5,
          '2026-11-05T00:08:00.000Z',
        ]);
        expect(errorSpy).toHaveBeenCalledWith('RFQ chaser delivery exhausted its retry budget', {
          chaserJobId: 'job-1',
          attempts: 5,
          maxAttempts: 5,
        }, 'RFQ_CHASER');

        pool.pool = null;
        await expect(domainQueries.markChaserJobFailedInDB('job-1')).resolves.toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });

    test('cancelChaserJobsForRFQInDB cancels pending jobs for RFQ', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 2 }) };
      await domainQueries.cancelChaserJobsForRFQInDB('RFQ-001');
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining("status='cancelled'"), ['RFQ-001']);

      pool.pool = null;
      await domainQueries.cancelChaserJobsForRFQInDB('RFQ-001');
    });

    test('getPendingChaserJobsFromDB fetches pending jobs', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'job-1' }] }) };
      const res1 = await domainQueries.getPendingChaserJobsFromDB(20);
      expect(res1).toEqual([{ id: 'job-1' }]);

      const res2 = await domainQueries.getPendingChaserJobsFromDB(0);
      expect(res2).toEqual([{ id: 'job-1' }]);

      pool.pool = null;
      await expect(domainQueries.getPendingChaserJobsFromDB()).resolves.toEqual([]);
    });

    test('insertChaserJobInDB handles null optional fields', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      const minimalJob = {
        id: 'job-min',
        rfqNumber: 'RFQ-002',
        rfqId: 'rfq-2',
        vendorId: 'v-2',
        vendorName: 'Vendor Two',
        channel: 'sms',
        fireAt: '2026-10-25T11:00:00Z',
      };
      const res = await domainQueries.insertChaserJobInDB(minimalJob);
      expect(res).toEqual(minimalJob);
    });

    test('claimDueChaserJobsFromDB handles limit edge cases', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await domainQueries.claimDueChaserJobsFromDB('now', 'stale', 'invalid');
      await domainQueries.claimDueChaserJobsFromDB('now', 'stale', 200);
      pool.pool = { query: jest.fn().mockResolvedValue({}) };
      const emptyRes = await domainQueries.claimDueChaserJobsFromDB('now', 'stale', 10);
      expect(emptyRes).toEqual([]);
    });

    test('persists, lists, claims, completes, and retries RFQ comparison jobs', async () => {
      const comparisonJob = {
        id: 'comparison-rfq-1',
        rfqId: 'rfq-1',
        rfqNumber: 'RFQ-001',
        fireAt: '2026-10-25T10:05:00.000Z',
      };
      const query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: comparisonJob.id }] })
        .mockResolvedValueOnce({ rows: [{ id: comparisonJob.id }] })
        .mockResolvedValueOnce({ rows: [{ id: comparisonJob.id, attempts: 1 }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      pool.pool = { query };

      await expect(domainQueries.insertRFQComparisonJobInDB(comparisonJob)).resolves.toEqual(comparisonJob);
      expect(query.mock.calls[0][0]).toContain('ON CONFLICT (rfq_id) DO NOTHING');
      expect(query.mock.calls[0][1]).toEqual([
        comparisonJob.id,
        comparisonJob.rfqId,
        comparisonJob.rfqNumber,
        comparisonJob.fireAt,
      ]);

      await expect(domainQueries.getPendingRFQComparisonJobsFromDB(20)).resolves.toEqual([{ id: comparisonJob.id }]);
      expect(query.mock.calls[1][0]).toContain('FROM rfq_comparison_queue');

      await expect(domainQueries.claimDueRFQComparisonJobsFromDB('now', 'stale', 10, comparisonJob.id))
        .resolves.toEqual([{ id: comparisonJob.id, attempts: 1 }]);
      expect(query.mock.calls[2][0]).toContain('attempts=attempts+1');
      expect(query.mock.calls[2][0]).toContain('AND id=$4');
      expect(query.mock.calls[2][0]).toContain('RETURNING id, rfq_id, rfq_number, fire_at, attempts');

      await domainQueries.markRFQComparisonJobCompleteInDB(comparisonJob.id);
      expect(query.mock.calls[3][0]).toContain("status='complete'");
      await domainQueries.markRFQComparisonChannelCompleteInDB(comparisonJob.id, 'email');
      expect(query.mock.calls[4][0]).toContain('email_completed_at=COALESCE(email_completed_at');
      await expect(domainQueries.markRFQComparisonChannelCompleteInDB(comparisonJob.id, 'fax'))
        .rejects.toThrow('Unsupported RFQ comparison channel: fax');
      await domainQueries.markRFQComparisonJobFailedInDB(comparisonJob.id, 'dispatch failed');
      expect(query.mock.calls[5][0]).toContain("WHEN attempts < $4 THEN 'pending'");
      expect(query.mock.calls[5][1][2]).toBe('dispatch failed');
      expect(query.mock.calls[5][1][3]).toBe(5);
    });

    test('uses bounded default limits and safely no-ops comparison queue operations without storage', async () => {
      const query = jest.fn().mockResolvedValue({});
      pool.pool = { query };
      await domainQueries.getPendingRFQComparisonJobsFromDB(0);
      await domainQueries.claimDueRFQComparisonJobsFromDB('now', 'stale', 'invalid');
      expect(query.mock.calls[0][1]).toEqual([1000]);
      expect(query.mock.calls[1][1][2]).toBe(25);

      pool.pool = null;
      await expect(domainQueries.getPendingRFQComparisonJobsFromDB()).resolves.toEqual([]);
      await expect(domainQueries.claimDueRFQComparisonJobsFromDB('now', 'stale')).resolves.toEqual([]);
      await expect(domainQueries.insertRFQComparisonJobInDB({})).resolves.toBeNull();
      await expect(domainQueries.markRFQComparisonJobCompleteInDB('job')).resolves.toBeUndefined();
      await expect(domainQueries.markRFQComparisonChannelCompleteInDB('job', 'sms')).resolves.toBeUndefined();
      await expect(domainQueries.markRFQComparisonJobFailedInDB('job', 'error')).resolves.toBeUndefined();
    });

    test('getVendorsPageFromDB with skipCount: true and cached key', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'v1', raw: { id: 'v1' } }] }) };
      const res = await domainQueries.getVendorsPageFromDB({
        limit: 10,
        offset: 0,
        skipCount: true,
      });
      expect(res.total).toBe(0);
      expect(res.rows).toHaveLength(1);
    });

    test('bulkInsertVendorsInDB under Postgres driver handles null attributes', async () => {
      const d1Bridge = require('../src/db/d1Bridge');
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      pool.pool = {
        query: jest.fn().mockResolvedValue({ rows: [{ email: null }] }),
      };

      const res = await domainQueries.bulkInsertVendorsInDB([
        { id: 'v-sparse' },
      ]);
      expect(res).toEqual([null]);
      d1Bridge.getD1Binding.mockRestore();
      d1Bridge.getD1HttpClient.mockRestore();
    });

    test('countVendorsCreatedBetween handles Date instances, invalid dates, and empty/error query', async () => {
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ count: '42' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockRejectedValueOnce(new Error('DB error')),
      };

      const d1 = new Date('2026-01-01');
      const d2 = new Date('2026-02-01');
      expect(await domainQueries.countVendorsCreatedBetween(d1, d2)).toBe(42);

      const d3 = new Date('2026-03-01');
      const d4 = new Date('2026-04-01');
      expect(await domainQueries.countVendorsCreatedBetween(d3, d4)).toBe(0);

      const d5 = new Date('2026-05-01');
      const d6 = new Date('2026-06-01');
      expect(await domainQueries.countVendorsCreatedBetween(d5, d6)).toBe(0);

      expect(await domainQueries.countVendorsCreatedBetween('invalid-date', d1)).toBe(0);
    });

    test('covers default parameters in createBulkImportSessionInDB, getRFQsByBuyerFromDB, and getPublicVendorsMatchingCategories', async () => {
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'rfq-b' } }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-capped' } }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'rfq-sparse' } }] }),
      };

      const sess = await domainQueries.createBulkImportSessionInDB('sess-1', 'admin@example.com');
      expect(sess).toEqual({ id: 'sess-1' });

      const rfqs = await domainQueries.getRFQsByBuyerFromDB('buyer-1');
      expect(rfqs).toHaveLength(1);

      const capped = await domainQueries.getPublicVendorsMatchingCategories(['Steels'], 9999);
      expect(capped).toHaveLength(1);

      const sparseRfq = await domainQueries.upsertRFQInDB({ id: 'rfq-sparse' });
      expect(sparseRfq).toEqual({ id: 'rfq-sparse' });
    });

    test('claimDueChaserJobsFromDB atomically claims due jobs and increments attempts', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'job-1', attempts: 1 }] }) };
      const res = await domainQueries.claimDueChaserJobsFromDB('2026-10-25T10:00:00Z', '2026-10-25T09:45:00Z', 10);
      expect(res).toEqual([{ id: 'job-1', attempts: 1 }]);
      expect(pool.pool.query.mock.calls[0][0]).toContain('attempts=attempts + 1');
      expect(pool.pool.query.mock.calls[0][0]).toContain("AND ((status='pending' AND fire_at <= $1)");

      pool.pool = null;
      await expect(domainQueries.claimDueChaserJobsFromDB('now', 'stale')).resolves.toEqual([]);
    });
  });

  describe('RFQ Unlocks & Vendor Credit Transactions', () => {
    test('routes durable vendor unlocks through the atomic credit repository', async () => {
      const result = { success: true, creditCharged: 0 };
      const durableUnlock = jest.spyOn(vendorRfqUnlockQueries, 'unlockVendorRfqInDB').mockResolvedValue(result);
      const options = { vendorId: 'v-1', rfqId: 'rfq-1' };
      await expect(domainQueries.unlockVendorRfqDurablyInDB(options)).resolves.toBe(result);
      expect(durableUnlock).toHaveBeenCalledWith(options);
    });

    test('unlockRFQInDB inserts an unlock record', async () => {
      const unlockRow = { id: 'u-1', vendor_id: 'v-1', rfq_id: 'rfq-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [unlockRow] }) };

      const res = await domainQueries.unlockRFQInDB({ id: 'u-1', vendorId: 'v-1', rfqId: 'rfq-1' });
      expect(res).toEqual(unlockRow);

      pool.pool = null;
      await expect(domainQueries.unlockRFQInDB({ id: 'u-1', vendorId: 'v-1', rfqId: 'rfq-1' })).resolves.toBeNull();
    });

    test('getRFQUnlockFromDB looks up unlock record', async () => {
      const unlockRow = { id: 'u-1', vendor_id: 'v-1', rfq_id: 'rfq-1' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [unlockRow] }) };

      const res = await domainQueries.getRFQUnlockFromDB('v-1', 'rfq-1');
      expect(res).toEqual(unlockRow);

      pool.pool = null;
      await expect(domainQueries.getRFQUnlockFromDB('v-1', 'rfq-1')).resolves.toBeNull();
    });

    test('getVendorUnlocksFromDB lists unlocks for a vendor', async () => {
      const unlockRows = [{ id: 'u-1' }, { id: 'u-2' }];
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: unlockRows }) };

      const res1 = await domainQueries.getVendorUnlocksFromDB('v-1', 10);
      expect(res1).toEqual(unlockRows);

      const res2 = await domainQueries.getVendorUnlocksFromDB('v-1', 0);
      expect(res2).toEqual(unlockRows);

      pool.pool = null;
      await expect(domainQueries.getVendorUnlocksFromDB('v-1')).resolves.toEqual([]);
      await expect(domainQueries.getVendorUnlocksFromDB('')).resolves.toEqual([]);
    });

    test('handles empty results in upsertRFQInDB, unlockRFQInDB, getRFQUnlock, getVendorUnlocks, and credit transactions', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      expect(await domainQueries.upsertRFQInDB({ id: 'rfq-none' })).toBeNull();

      pool.pool = { query: jest.fn().mockResolvedValue(null) };
      expect(await domainQueries.unlockRFQInDB({ id: 'u-none' })).toBeNull();
      expect(await domainQueries.getRFQUnlockFromDB('v-none', 'rfq-none')).toBeNull();
      expect(await domainQueries.getVendorUnlocksFromDB('v-none')).toEqual([]);
      expect(await domainQueries.recordCreditTransactionInDB({ id: 'tx-none' })).toBeNull();
      expect(await domainQueries.getVendorCreditTransactionsFromDB('v-none')).toEqual([]);
    });

    test('recordCreditTransactionInDB records a transaction', async () => {
      const txRow = { id: 'tx-1', vendor_id: 'v-1', amount: 10 };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [txRow] }) };

      const res = await domainQueries.recordCreditTransactionInDB({
        id: 'tx-1',
        vendorId: 'v-1',
        rfqId: 'rfq-1',
        transactionType: 'CREDIT_PURCHASE',
        amount: 10,
        balanceAfter: 20,
        idempotencyKey: 'idemp-1',
      });
      expect(res).toEqual(txRow);

      pool.pool = null;
      await expect(domainQueries.recordCreditTransactionInDB({ id: 'tx-1' })).resolves.toBeNull();
    });

    test('credit transaction helpers use the supplied transaction client', async () => {
      const poolQuery = jest.fn();
      const transactionQuery = jest.fn().mockResolvedValue({ rows: [{ id: 'tx-in-transaction' }] });
      pool.pool = { query: poolQuery };
      const queryClient = { query: transactionQuery };

      await domainQueries.recordCreditTransactionInDB({
        id: 'vendor-tx-in-transaction',
        vendorId: 'vendor-1',
        amount: 4,
        balanceAfter: 12,
        queryClient,
      });
      await domainQueries.recordBuyerCreditTransactionInDB({
        id: 'buyer-tx-in-transaction',
        buyerId: 'buyer-1',
        creditsAdded: 4,
        updatedBalance: 12,
        queryClient,
      });

      expect(transactionQuery).toHaveBeenCalledTimes(2);
      expect(transactionQuery.mock.calls[0][0]).toContain('INSERT INTO vendor_credit_transactions');
      expect(transactionQuery.mock.calls[1][0]).toContain('INSERT INTO buyer_credit_transactions');
      expect(transactionQuery.mock.calls.every((call) => call.length === 2)).toBe(true);
      expect(poolQuery).not.toHaveBeenCalled();
    });

    test('getVendorCreditTransactionsFromDB lists transactions for a vendor', async () => {
      const txRows = [{ id: 'tx-1' }];
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: txRows }) };

      const res1 = await domainQueries.getVendorCreditTransactionsFromDB('v-1', 10);
      expect(res1).toEqual(txRows);

      const res2 = await domainQueries.getVendorCreditTransactionsFromDB('v-1', 0);
      expect(res2).toEqual(txRows);

      pool.pool = null;
      await expect(domainQueries.getVendorCreditTransactionsFromDB('v-1')).resolves.toEqual([]);
      await expect(domainQueries.getVendorCreditTransactionsFromDB('')).resolves.toEqual([]);
    });

    test('getVendorsFromDB copies created_at and updated_at when missing on raw', async () => {
      pool.pool = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{ raw: { id: 'v-no-dates', name: 'No Dates' }, created_at: '2026-01-01', updated_at: '2026-01-02' }],
        }),
      };
      const res = await domainQueries.getVendorsFromDB(10);
      expect(res[0].created_at).toBe('2026-01-01');
      expect(res[0].createdAt).toBe('2026-01-01');
      expect(res[0].updated_at).toBe('2026-01-02');
    });

    test('category signals <= 3 characters in countPublicVendorsMatchingCategories and getPublicVendorsMatchingCategories', async () => {
      pool.pool = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ total: 2 }] })
          .mockResolvedValueOnce({ rows: [{ raw: { id: 'v-it' } }] }),
      };
      const count = await domainQueries.countPublicVendorsMatchingCategories(['IT', 'HR']);
      expect(count).toBe(2);
      const vendors = await domainQueries.getPublicVendorsMatchingCategories(['IT']);
      expect(vendors).toEqual([{ id: 'v-it' }]);
    });

    test('upsertVendorInDB triggers syncVendorCategoriesIndexed with categories arrays', async () => {
      const v = {
        id: 'v-cat-test',
        email: 'test@cat.com',
        majorCategory: 'Industrial',
        minorCategories: ['Valves'],
        vendorSelectedCategories: ['Pumps', ''],
        clientMappedCategories: ['Tubes', null],
      };
      pool.pool = {
        query: jest.fn().mockResolvedValue({ rows: [{ raw: v }] }),
      };
      const res = await domainQueries.upsertVendorInDB(v);
      expect(res).toEqual(v);
    });
  });
});

describe('D1 vendor search index readiness', () => {
  function installD1QueryMocks({ ftsTable = true, migrationApplied = true, failProbe = false } = {}) {
    const binding = {};
    jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(binding);
    jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
      if (sql.includes('sqlite_master')) {
        if (failProbe) throw new Error('D1 schema metadata unavailable');
        return {
          rows: [
            { name: 'schema_migrations' },
            ...(ftsTable ? [{ name: 'vendors_search_fts' }] : []),
          ],
        };
      }
      if (sql.includes('FROM schema_migrations')) {
        return { rows: migrationApplied ? [{ version: '0001_vendor_search_trigram_index' }] : [] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 0 }] };
      return { rows: [] };
    });
    return query;
  }

  beforeEach(() => {
    if (pool.queryCache) pool.queryCache.clear();
  });

  afterEach(() => {
    if (pool.queryCache) pool.queryCache.clear();
    jest.restoreAllMocks();
  });

  test('narrows long D1 vendor searches through the trigram index after migration', async () => {
    const query = installD1QueryMocks();

    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'stainless steel' });

    const d1Queries = query.mock.calls.map(([, , options]) => options?.d1Text).filter(Boolean);
    expect(d1Queries).toHaveLength(2);
    expect(d1Queries.every((sql) => sql.includes('vendors_search_fts'))).toBe(true);
    expect(d1Queries[0]).toContain('vendors.rowid IN');
  });

  test('uses the legacy D1 search path when the index or backfill is missing', async () => {
    const query = installD1QueryMocks({ ftsTable: false, migrationApplied: false });

    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'stainless steel' });

    const d1Queries = query.mock.calls.map(([, , options]) => options?.d1Text).filter(Boolean);
    expect(d1Queries).toHaveLength(2);
    expect(d1Queries.every((sql) => !sql.includes('vendors_search_fts'))).toBe(true);
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM schema_migrations'))).toHaveLength(0);
  });

  test('uses the legacy D1 search path and logs when schema probing fails', async () => {
    const query = installD1QueryMocks({ failProbe: true });

    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'industrial valve' });

    const d1Queries = query.mock.calls.map(([, , options]) => options?.d1Text).filter(Boolean);
    expect(d1Queries.every((sql) => !sql.includes('vendors_search_fts'))).toBe(true);
  });

  test('probes once per D1 binding and handles substring email searches', async () => {
    const query = installD1QueryMocks();

    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'sales@example.com' });
    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'support@example.com' });

    expect(query.mock.calls.filter(([sql]) => sql.includes('sqlite_master'))).toHaveLength(1);
    const d1Queries = query.mock.calls.map(([, , options]) => options?.d1Text).filter(Boolean);
    expect(d1Queries.some((sql) => sql.includes('lower(email) LIKE lower($1)') && sql.includes('vendors_search_fts'))).toBe(true);
  });

  test('does not probe or add trigram filters for short search tokens', async () => {
    const query = installD1QueryMocks();

    await domainQueries.getVendorsPageFromDB({ limit: 10, offset: 0, search: 'IT' });

    expect(query.mock.calls.some(([sql]) => sql.includes('sqlite_master'))).toBe(false);
    expect(query.mock.calls.every(([,, options]) => !options?.d1Text?.includes('vendors_search_fts'))).toBe(true);
  });

  test('narrows public D1 directory searches while preserving their exact filters', async () => {
    const query = installD1QueryMocks();

    await domainQueries.getPublicVendorsPageFromDB({ limit: 10, offset: 0, search: 'Havells India' });

    const d1Queries = query.mock.calls.map(([, , options]) => options?.d1Text).filter(Boolean);
    expect(d1Queries).toHaveLength(2);
    expect(d1Queries.every((sql) => sql.includes('vendors_search_fts'))).toBe(true);
    expect(d1Queries[0]).toContain("json_extract(raw,'$.buyerId') IS NULL");
    expect(d1Queries[0]).toContain('lower(json_extract(raw,\'$.name\')) LIKE lower($1)');
  });

  test('uses the trigram candidate for long category-count searches and keeps exact predicates', async () => {
    const query = installD1QueryMocks();

    await domainQueries.countPublicVendorsMatchingCategories(['industrial equipment']);

    const d1Query = query.mock.calls.map(([, , options]) => options?.d1Text).find(Boolean);
    expect(d1Query).toContain('vendors_search_fts');
    expect(d1Query).toContain("lower(json_extract(raw,'$.vendorSelectedCategories')) LIKE $1");
    expect(d1Query).toContain("json_extract(raw,'$.buyerId') IS NULL");
  });

  test('uses the trigram candidate for row-returning public category matching', async () => {
    const query = installD1QueryMocks();

    await domainQueries.getPublicVendorsMatchingCategories(['hydraulic systems'], 20);

    const d1Query = query.mock.calls.map(([, , options]) => options?.d1Text).find(Boolean);
    expect(d1Query).toContain('vendors_search_fts');
    expect(d1Query).toContain('ORDER BY created_at DESC LIMIT $2');
  });

  test('keeps short category signals on the compatibility path', async () => {
    const query = installD1QueryMocks();

    await domainQueries.countPublicVendorsMatchingCategories(['IT']);

    expect(query.mock.calls.some(([sql]) => sql.includes('sqlite_master'))).toBe(false);
    const d1Query = query.mock.calls.map(([, , options]) => options?.d1Text).find(Boolean);
    expect(d1Query).not.toContain('vendors_search_fts');
  });
});
