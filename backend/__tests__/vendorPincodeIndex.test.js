const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const vendorController = require('../src/controllers/vendorController');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const {
  normalizePincodeDigits,
  exclusiveDigitPrefixUpperBound,
  commonPincodePrefixLength,
  resolveVendorPinDigits,
  compareVendorPincodeProximity,
} = require('../src/config/constants');
const { VALIDATION_SCHEMAS, validatePayload } = require('../src/config/validationSchemas');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(BACKEND_ROOT, 'src/db/migrations');
const D1_MIGRATION = '0037_vendor_pincode_indexes.d1.sql';
const PG_MIGRATION = '0037_vendor_pincode_indexes.pg.sql';
const LOCAL_SCRIPT = 'db:migrate:d1:local:vendor-pincode-indexes';

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

function readMigration(file) {
  return normalizeSql(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

function createSqliteVendorFixtureDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE vendors (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      major_category TEXT,
      status TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      raw TEXT NOT NULL
    );
    CREATE INDEX idx_vendors_public_created_at ON vendors (created_at DESC)
      WHERE (source IS NULL OR source NOT IN ('buyer_manual', 'buyer_uploaded', 'buyer_excel', 'historical_purchase_dump'))
        AND json_extract(raw,'$.buyerId') IS NULL
        AND json_extract(raw,'$.buyerAccountId') IS NULL;
    CREATE INDEX idx_vendors_major_category_created_at ON vendors (major_category COLLATE NOCASE, created_at DESC);
    ${fs.readFileSync(path.join(MIGRATIONS, D1_MIGRATION), 'utf8')}
  `);

  const insert = db.prepare(
    'INSERT INTO vendors (id, email, major_category, source, created_at, raw) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const addVendor = (id, pincode, minors, createdAt, rating = 4) => {
    insert.run(
      id,
      `${id}@pin.test`,
      'Engineering Spares - Electrical',
      'procucev_network',
      createdAt,
      JSON.stringify({
        id,
        name: `Vendor ${id}`,
        email: `${id}@pin.test`,
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: minors,
        pincode,
        source: 'procucev_network',
        rating,
      })
    );
  };

  // Newer South India vendors (would otherwise crowd out older Delhi/NCR rows in LIMIT 3)
  addVendor('v-kerala-new', '683542', ['Semiconductors'], '2026-11-16 12:00:00');
  addVendor('v-hyd-new', '500080', ['Semiconductors'], '2026-11-15 12:00:00');
  addVendor('v-blr-new', '560043', ['Semiconductors'], '2026-11-14 12:00:00');
  // Older Delhi/North India vendors matching 110002 -> 110xxx -> 1xxxxx
  addVendor('v-delhi-exact', 110002, ['Semiconductors'], '2026-01-01 10:00:00', 4.5);
  addVendor('v-delhi-dist', ' 110045 ', ['Semiconductors'], '2026-02-01 10:00:00', 4.2);
  addVendor('v-haryana-zone', '122001', ['Semiconductors'], '2026-03-01 10:00:00', 4.0);
  // Private buyer vendor at 110002 (must stay excluded from public network lookups)
  insert.run(
    'v-private-delhi',
    'priv@pin.test',
    'Engineering Spares - Electrical',
    'buyer_uploaded',
    '2026-11-16 13:00:00',
    JSON.stringify({
      id: 'v-private-delhi',
      buyerId: 'buyer-99',
      pincode: '110002',
      majorCategory: 'Engineering Spares - Electrical',
      minorCategories: ['Semiconductors'],
      source: 'buyer_uploaded',
    })
  );

  return db;
}

describe('vendor pincode proximity index & tiered RFQ vendor queries', () => {
  const originalPool = pool.pool;
  const originalBinding = globalThis.__CF_ENV__;

  afterEach(() => {
    pool.pool = originalPool;
    if (originalBinding === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = originalBinding;
    if (pool.queryCache) pool.queryCache.clear();
    jest.restoreAllMocks();
  });

  test('migration 0037 ships both D1 and PostgreSQL composite pincode indexes and wires package.json', () => {
    expect(readMigration(D1_MIGRATION)).toContain('CREATE INDEX IF NOT EXISTS idx_vendors_major_pincode_created_at ON vendors');
    expect(readMigration(PG_MIGRATION)).toContain('CREATE INDEX IF NOT EXISTS idx_vendors_major_lower_pincode_created_at ON vendors');

    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts[LOCAL_SCRIPT]).toContain(D1_MIGRATION);
    expect(pkg.scripts['db:setup:mock:local']).toContain(LOCAL_SCRIPT);
  });

  test('pincode utility helpers normalize digits, compute exclusive range upper bounds, and compare proximity', () => {
    expect(normalizePincodeDigits(' 110 002 ')).toBe('110002');
    expect(normalizePincodeDigits('12')).toBe('');
    expect(exclusiveDigitPrefixUpperBound('')).toBe('');
    expect(exclusiveDigitPrefixUpperBound('110')).toBe('111');
    expect(exclusiveDigitPrefixUpperBound('119')).toBe('12');
    expect(exclusiveDigitPrefixUpperBound('9')).toBe('9z');
    expect(commonPincodePrefixLength('110002', '110045')).toBe(4);
    expect(resolveVendorPinDigits(null)).toBe('');
    expect(resolveVendorPinDigits({ location: 'Daryaganj, Delhi 110002' })).toBe('110002');

    expect(
      compareVendorPincodeProximity({ pincode: '110003' }, { pincode: '110099' }, '110002')
    ).toBeLessThan(0);
    expect(
      compareVendorPincodeProximity({ pincode: '110005' }, { pincode: '110009' }, '110002')
    ).toBeLessThan(0);
    expect(compareVendorPincodeProximity({ pincode: '110002' }, { pincode: '500080' }, 'invalid')).toBe(0);
    expect(compareVendorPincodeProximity({ city: 'Delhi' }, { pincode: '110005' }, '110002')).toBeGreaterThan(0);
    expect(compareVendorPincodeProximity({ city: 'Delhi' }, { city: 'Noida' }, '110002')).toBe(0);
  });

  test('validates preferredPincode in vendorDirectoryQuery schema and forwards it in vendorController', async () => {
    const valid = validatePayload(VALIDATION_SCHEMAS.vendorDirectoryQuery, { preferredPincode: '110002' });
    expect(valid.isValid).toBe(true);
    const invalid = validatePayload(VALIDATION_SCHEMAS.vendorDirectoryQuery, { preferredPincode: '12' });
    expect(invalid.isValid).toBe(false);

    pool.pool = { query: jest.fn() };
    const minorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([
      { id: 'v-110', name: 'Delhi Supplier', pincode: '110002', majorCategory: 'IT', minorCategories: ['Laptop'], rating: 4 },
    ]);
    const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await vendorController.getVendors(
      {
        user: { role: 'buyer', email: 'buyer@enterprise.com' },
        query: {
          page: '1',
          pageSize: '10',
          publicOnly: 'true',
          majors: 'IT',
          minors: 'Laptop',
          preferredPincode: '110 002',
        },
      },
      res,
      next
    );

    expect(minorSpy).toHaveBeenCalledWith(expect.any(Array), expect.any(Array), expect.any(Number), { pincode: '110002' });
    expect(majorSpy).toHaveBeenCalledWith(expect.any(Array), expect.any(Number), { pincode: '110002' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // Major-only lookup also forwards preferredPincode
    await vendorController.getVendors(
      {
        user: { role: 'buyer', email: 'buyer@enterprise.com' },
        query: { page: '1', pageSize: '10', publicOnly: 'true', majors: 'IT', preferredPincode: '110002' },
      },
      res,
      next
    );
    expect(majorSpy).toHaveBeenLastCalledWith(['IT'], expect.any(Number), { pincode: '110002' });
  });

  test('D1 queries execute progressive pincode stages using idx_vendors_major_pincode_created_at and prioritize Delhi over newer South India vendors', async () => {
    const db = createSqliteVendorFixtureDb();
    const plans = [];

    const mockD1 = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                if (sql.includes('UNION ALL')) {
                  plans.push(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail));
                }
                const results = db.prepare(sql).all(...args);
                return { results, success: true, meta: {} };
              },
            };
          },
        };
      },
    };
    pool.pool = null;
    globalThis.__CF_ENV__ = { DB: mockD1 };

    const minorMatches = await domainQueries.getPublicVendorsByMinorCategoryFromDB(
      ['semiconductors', 'semiconductor'],
      ['engineering spares - electrical'],
      3,
      { pincode: '110002' }
    );
    expect(minorMatches.map((v) => v.id)).toEqual(['v-delhi-exact', 'v-delhi-dist', 'v-haryana-zone']);
    expect(plans.some((p) => p.some((step) => step.includes('idx_vendors_major_pincode_created_at')))).toBe(true);

    // 3-digit prefix mode ("110") runs single-arm Stage 1 and falls back cleanly for 3rd slot
    const districtMatches = await domainQueries.getPublicVendorsByMajorCategoryFromDB(
      ['engineering spares - electrical'],
      3,
      { pincode: '110' }
    );
    expect(districtMatches.map((v) => v.id).slice(0, 2)).toEqual(['v-delhi-exact', 'v-delhi-dist']);
    expect(districtMatches).toHaveLength(3);

    // Category-matching SQL with pincode prioritizes Delhi even across generic category matching
    const genericMatches = await domainQueries.getPublicVendorsMatchingCategories(
      ['semiconductors'],
      3,
      { pincode: '110002' }
    );
    expect(genericMatches.map((v) => v.id)).toEqual(['v-delhi-exact', 'v-delhi-dist', 'v-haryana-zone']);

    // Exceeding D1 UNION ALL param cap splits arms sequentially cleanly
    const manyTerms = Array.from({ length: 40 }, (_, i) => (i === 0 ? 'semiconductors' : `term-${i}`));
    const splitMatches = await domainQueries.getPublicVendorsByMinorCategoryFromDB(
      manyTerms,
      ['engineering spares - electrical', 'electrical'],
      2,
      { pincode: '110002' }
    );
    expect(splitMatches.map((v) => v.id)).toEqual(['v-delhi-exact', 'v-delhi-dist']);
  });

  test('PostgreSQL queries build tiered UNION ALL and fallback queries when pincode is provided', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ raw: { id: 'pg-delhi', pincode: '110002' } }] });
    pool.pool = { query };

    const rows = await domainQueries.getPublicVendorsByMajorCategoryFromDB(
      ['Engineering Spares - Electrical'],
      5,
      { pincode: '110002' }
    );

    expect(rows).toEqual([{ id: 'pg-delhi', pincode: '110002' }]);
    const [firstSql] = query.mock.calls[0];
    expect(firstSql).toContain('UNION ALL');
    expect(firstSql).toContain("btrim(coalesce(raw->>'pincode', '')) = $2");
    expect(firstSql).toContain("btrim(coalesce(raw->>'pincode', '')) >= $4");
  });

  test('storeService extracts target pincode from location fallback, scores address pincodes, and passes pincode in candidate & Mode 3 / email ranking', async () => {
    expect(storeService._extractTargetLocation(null)).toEqual({ pincode: null, location: null });
    expect(storeService._extractTargetLocation('110002')).toEqual({ pincode: '110002', location: null });
    expect(storeService._extractTargetLocation('Central Delhi, Delhi - 110002')).toEqual({
      pincode: '110002',
      location: 'Central Delhi, Delhi - 110002',
    });

    expect(storeService.scoreVendorLocation({ location: 'ITO, Central Delhi - 110002' }, { pincode: '110002' })).toBe(100);
    expect(
      storeService._compareVendorsByLocationAndRating(
        { pincode: '110003', rating: 4 },
        { pincode: '110099', rating: 4 },
        { pincode: '110002' }
      )
    ).toBeLessThan(0);

    pool.pool = { query: jest.fn() };
    jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});
    const matchSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
      { id: 'c-1', name: 'Delhi Cand', pincode: '110002', majorCategory: 'Tools', source: 'procucev_network' },
    ]);
    storeService.vendors = [];
    const cands = await storeService.candidateVendorsForRFQAsync({
      id: 'rfq-cand-pin',
      category: 'Tools',
      deliveryPincode: '110002',
      deliveryLocation: 'Central Delhi, Delhi',
    }, 10);
    expect(matchSpy).toHaveBeenCalledWith(expect.any(Array), 10, { pincode: '110002' });
    expect(cands.map((v) => v.id)).toEqual(['c-1']);

    // selectVendorsForRFQEmail ranks district/region matches ahead of far vendors even when unsubscribed
    storeService.vendors = [
      { id: 'v-far-mail', name: 'Far Mail', email: 'far@test.com', majorCategory: 'Tools', pincode: '500080', rating: 4, source: 'buyer_uploaded', buyerAccountId: 'b1' },
      { id: 'v-dist-mail', name: 'Delhi Mail', email: 'delhi@test.com', majorCategory: 'Tools', pincode: '110045', rating: 4, source: 'buyer_uploaded', buyerAccountId: 'b1' },
    ];
    const emailed = storeService.selectVendorsForRFQEmail({
      id: 'rfq-email-rank',
      category: 'Tools',
      sourcingMode: 'mode_1',
      buyerAccountId: 'b1',
      deliveryPincode: '110002',
      deliveryLocation: 'Central Delhi, Delhi',
    }, 2);
    expect(emailed.map((v) => v.id)).toEqual(['v-dist-mail', 'v-far-mail']);
  });
});
