const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // node:sqlite requires Node 22+
}
const describeWithSqlite = DatabaseSync ? describe : describe.skip;
const { splitStatements } = require('../scripts/migrate-d1');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const mailerService = require('../src/services/mailerService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const storeService = require('../src/services/storeService');
const { foldCategoryDashes, expandCategoryDashVariants } = require('../src/config/constants');

function createD1Harness() {
  const db = new DatabaseSync(':memory:');
  const schemaSql = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.d1.sql'), 'utf8');
  for (const stmt of splitStatements(schemaSql)) {
    db.exec(stmt);
  }
  const prepare = (sql) => {
    const normalized = sql.replace(/\$(\d+)/g, '?');
    const runWithParams = (params) => {
      const bound = db.prepare(normalized);
      return {
        all: async () => ({ results: bound.all(...params), meta: {} }),
        first: async () => bound.get(...params) || null,
        run: async () => ({ success: true, meta: bound.run(...params) }),
      };
    };
    return {
      bind: (...params) => runWithParams(params),
      all: () => runWithParams([]).all(),
    };
  };
  return { db, binding: { prepare } };
}

describeWithSqlite('category dash normalization across taxonomy, D1 queries, and RFQ minor planning', () => {
  const originalPool = pool.pool;
  const originalBinding = globalThis.__CF_ENV__;

  afterEach(() => {
    pool.pool = originalPool;
    if (originalBinding === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = originalBinding;
    storeService.vendors = [];
    jest.restoreAllMocks();
  });

  test('foldCategoryDashes and expandCategoryDashVariants normalize en-dash/em-dash without duplicating plain hyphens', () => {
    expect(foldCategoryDashes('Others – New Product')).toBe('Others - New Product');
    expect(foldCategoryDashes('Others — New Service')).toBe('Others - New Service');
    expect(foldCategoryDashes(null)).toBe('');

    expect(expandCategoryDashVariants(['Others – New Product', 'Engineering Spares - Mechanical', '', null])).toEqual([
      'others – new product',
      'others - new product',
      'engineering spares - mechanical',
    ]);
    expect(expandCategoryDashVariants('not-an-array')).toEqual([]);
  });

  test('_majorCategoriesForMinors and canonicalMajor resolve plain-hyphen DB majors for Others – New Product/Service minors', () => {
    expect(rfqIngestionService.canonicalMajor('Others - New Product')).toBe('Others – New Product');
    expect(rfqIngestionService.canonicalMajor('Others - New Service')).toBe('Others – New Service');

    expect(storeService._majorCategoriesForMinors(['Stationery'], { allMajors: true })).toEqual(
      expect.arrayContaining(['others – new product', 'others - new product', 'general procurement'])
    );
    expect(storeService._majorCategoriesForMinors(['Consulting'], { allMajors: true })).toEqual(
      expect.arrayContaining(['others – new service', 'others - new service'])
    );

    const hyphenVendor = {
      id: 'v-others-hyphen',
      name: 'Hyphen Stationery Vendor',
      majorCategory: 'Others - New Product',
      minorCategories: ['Stationery'],
    };
    expect(storeService.vendorCoversCategory(hyphenVendor, 'Others – New Product')).toBe(true);
    expect(storeService.isCategoryAvailable('Others - New Product')).toBe(true);
  });

  test('V0 and V2 minor lookups in D1 find Stationery and Others - New Product top-up vendors instead of reporting 0 of 25', async () => {
    const { db, binding } = createD1Harness();
    const originalEnv = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';
    pool.pool = null;
    globalThis.__CF_ENV__ = { DB: binding };

    try {
      const insertVendor = db.prepare(
        `INSERT INTO vendors (id, email, major_category, source, status, created_at, raw)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      );
      for (let i = 1; i <= 5; i += 1) {
        const raw = {
          id: `v-stationery-${i}`,
          name: `Stationery Supplier ${i}`,
          email: `stationery-${i}@example.test`,
          majorCategory: 'Others - New Product',
          minorCategories: ['Stationery'],
          pincode: '110002',
          source: 'procucev_network',
          rating: 4.5,
        };
        insertVendor.run(raw.id, raw.email, 'Others - New Product', raw.source, '2026-11-16T00:00:00Z', JSON.stringify(raw));
      }
      for (let i = 1; i <= 3; i += 1) {
        const raw = {
          id: `v-others-major-${i}`,
          name: `General Others Supplier ${i}`,
          email: `others-major-${i}@example.test`,
          majorCategory: 'Others - New Product',
          minorCategories: ['Furniture'],
          pincode: '110005',
          source: 'procucev_network',
          rating: 4.0,
        };
        insertVendor.run(raw.id, raw.email, 'Others - New Product', raw.source, '2026-11-16T00:00:00Z', JSON.stringify(raw));
      }

      const rfq = {
        id: 'rfq-stationery-1',
        rfqNumber: 'RFQ261611703326',
        title: 'Office & Stationery',
        category: 'Others – New Product',
        sourcingMode: 'mode_0',
        deliveryLocation: 'Central Delhi, Delhi',
        deliveryPincode: '110002',
        extractedEntities: [
          {
            id: 'li-1',
            itemName: 'Office Stationery Pack',
            majorCategory: 'Others – New Product',
            minorCategory: 'Stationery',
            quantity: 10,
            unit: 'Set',
          },
        ],
        assignedVendors: [],
      };

      jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (_id, additions) => ({
        updatedRFQ: { ...rfq, assignedVendors: additions, procucevVendorCount: additions.length },
        committedAdditions: additions,
      }));
      jest.spyOn(storeService, '_dispatchRFQVendorInviteOutbox').mockReturnValue(true);
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
      const shortfallEmailSpy = jest.spyOn(mailerService, 'sendRfqMinorShortfallEmail').mockResolvedValue({ sent: true });

      const augmented = await storeService.augmentV0AssignmentsFromDB(rfq, { notifyShortfall: true });

      expect(augmented.assignedVendors).toHaveLength(8);
      expect(shortfallEmailSpy).toHaveBeenCalledWith(expect.objectContaining({
        shortfalls: [
          expect.objectContaining({
            minorCategory: 'Stationery',
            minorMatched: 5,
            majorFilled: 3,
          }),
        ],
      }));
    } finally {
      if (originalEnv === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalEnv;
      db.close();
    }
  });

  test('augmentV0AssignmentsFromDB falls back to getPublicVendorsMatchingCategories for unmapped minor categories', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const minorByMajorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([]);
    const matchAllSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
      {
        id: 'v-custom-minor',
        name: 'Custom Minor Vendor',
        email: 'custom@example.test',
        majorCategory: 'Others - New Product',
        minorCategories: ['Custom Exotic Widget'],
        source: 'procucev_network',
      },
    ]);
    const majorFallbackSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
    jest.spyOn(storeService, '_appendRFQAssignmentsDurably').mockImplementation(async (_id, additions) => ({
      updatedRFQ: { id: 'rfq-unmapped', assignedVendors: additions, procucevVendorCount: additions.length },
      committedAdditions: additions,
    }));
    jest.spyOn(storeService, '_dispatchRFQVendorInviteOutbox').mockReturnValue(true);
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

    const updated = await storeService.augmentV0AssignmentsFromDB({
      id: 'rfq-unmapped',
      rfqNumber: 'RFQ-UNMAPPED',
      title: 'Custom item',
      sourcingMode: 'mode_0',
      extractedEntities: [{ itemName: 'Custom', minorCategory: 'Custom Exotic Widget', majorCategory: 'Others – New Product' }],
      assignedVendors: [],
    });

    expect(minorByMajorSpy).not.toHaveBeenCalled();
    expect(matchAllSpy).toHaveBeenCalledWith(['custom exotic widget'], expect.any(Number));
    expect(majorFallbackSpy).not.toHaveBeenCalled();
    expect(updated.assignedVendors.map((v) => v.id)).toEqual(['v-custom-minor']);
  });
});
