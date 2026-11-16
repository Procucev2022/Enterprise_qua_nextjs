const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // node:sqlite requires Node 22+
}
const describeWithSqlite = DatabaseSync ? describe : describe.skip;

const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const { exclusiveNocasePrefixUpperBound } = require('../src/config/constants');
const { queryCache } = require('../src/db/queryCache');

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');
const D1_MIGRATION_SQL = fs.readFileSync(
  path.join(MIGRATIONS_DIR, '0039_vendor_email_search_indexes.d1.sql'),
  'utf8'
);

function setupSqliteVendorDb() {
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
    CREATE INDEX idx_vendors_created_at ON vendors (created_at DESC);
    ${D1_MIGRATION_SQL}
  `);

  const insert = db.prepare(
    'INSERT INTO vendors (id, email, major_category, status, source, created_at, updated_at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insert.run(
    'v-veera',
    'Veerababu.V@procucev.com',
    'Engineering Spares - Electrical',
    'verified',
    'self',
    '2026-11-16T08:00:00Z',
    '2026-11-16T08:00:00Z',
    JSON.stringify({
      id: 'v-veera',
      name: 'Veera Solutions Pvt Ltd',
      email: 'Veerababu.V@procucev.com',
      corporateEmail: 'Veerababu.V@procucev.com',
      majorCategory: 'Engineering Spares - Electrical',
    })
  );
  insert.run(
    'v-corp-only',
    null,
    'IT & Electronics',
    'verified',
    'self',
    '2026-11-16T07:00:00Z',
    '2026-11-16T07:00:00Z',
    JSON.stringify({
      id: 'v-corp-only',
      name: 'Corporate Only Vendor',
      corporateEmail: 'anshul.goel@procucev.com',
      majorCategory: 'IT & Electronics',
    })
  );
  insert.run(
    'v-underscore',
    'veerababu_other@procucev.com',
    'Engineering Spares - Electrical',
    'verified',
    'self',
    '2026-11-16T06:00:00Z',
    '2026-11-16T06:00:00Z',
    JSON.stringify({
      id: 'v-underscore',
      name: 'Underscore Neighbor',
      email: 'veerababu_other@procucev.com',
      majorCategory: 'Engineering Spares - Electrical',
    })
  );
  for (let i = 0; i < 400; i += 1) {
    const email = `noise${i}@supplier-${i}.example.net`;
    insert.run(
      `v-noise-${i}`,
      email,
      i % 2 === 0 ? 'Engineering Spares - Electrical' : 'Logistics & Packaging',
      'verified',
      'self',
      `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      '2026-10-01T00:00:00Z',
      JSON.stringify({ id: `v-noise-${i}`, name: `Noise ${i}`, email, corporateEmail: email })
    );
  }
  db.exec('ANALYZE');
  return db;
}

describeWithSqlite('D1 indexed vendor email search in getVendorsPageFromDB', () => {
  const prevPool = pool.pool;
  const prevCfEnv = globalThis.__CF_ENV__;

  afterEach(() => {
    pool.pool = prevPool;
    globalThis.__CF_ENV__ = prevCfEnv;
    jest.restoreAllMocks();
    queryCache.clear();
  });

  test('exclusiveNocasePrefixUpperBound handles empty, ASCII, @ boundary, and max BMP fallback', () => {
    expect(exclusiveNocasePrefixUpperBound('')).toBe('');
    expect(exclusiveNocasePrefixUpperBound('veerababu.v@')).toBe('veerababu.v[');
    expect(exclusiveNocasePrefixUpperBound('Veerababu.V@procucev.com')).toBe('veerababu.v@procucev.con');
    expect(exclusiveNocasePrefixUpperBound('\uFFFF')).toBe('\uFFFF\uFFFF');
  });

  test('executes exact, prefix, corporateEmail, multi-email, and domain searches end-to-end through d1Bridge without table scans on @ prefixes', async () => {
    const db = setupSqliteVendorDb();
    const plans = [];

    const mockD1 = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
                plans.push({ sql, plan });
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

    try {
      const exactPage = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: 'veerababu.v@procucev.com',
      });
      expect(exactPage.total).toBe(1);
      expect(exactPage.rows.map((r) => r.id)).toEqual(['v-veera']);

      // Both COUNT(*) and DATA queries must use NOCASE indexes rather than scanning vendors
      const exactPlans = plans.splice(0, plans.length);
      expect(exactPlans).toHaveLength(2);
      for (const entry of exactPlans) {
        const details = entry.plan.map((p) => p.detail);
        expect(details.some((d) => d.includes('idx_vendors_email_nocase'))).toBe(true);
        expect(details.some((d) => d.includes('idx_vendors_corp_email_nocase'))).toBe(true);
        expect(details.some((d) => d === 'SCAN vendors')).toBe(false);
      }

      // Partial @ prefix must match 'veerababu.v@...' and NOT leak into 'veerababu_other@...'
      const atBoundary = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: 'veerababu@',
      });
      expect(atBoundary.total).toBe(0);
      expect(atBoundary.rows).toHaveLength(0);

      const prefixMatch = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: 'veerababu.v@procu',
      });
      expect(prefixMatch.total).toBe(1);
      expect(prefixMatch.rows.map((r) => r.id)).toEqual(['v-veera']);

      // corporateEmail-only vendor lookup with additional category filter
      const corpAndCategory = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: 'anshul.goel@procucev.com',
        category: 'IT & Electronics',
      });
      expect(corpAndCategory.total).toBe(1);
      expect(corpAndCategory.rows.map((r) => r.id)).toEqual(['v-corp-only']);

      // Explicit email filter uses indexed range scan
      const emailFilterPage = await domainQueries.getVendorsPageFromDB({
        limit: 10,
        offset: 0,
        email: 'Veerababu.V@procucev.com',
      });
      expect(emailFilterPage.total).toBe(1);
      expect(emailFilterPage.rows.map((r) => r.id)).toEqual(['v-veera']);

      // Multi-email comma-separated search returns both exact and corporateEmail matches without full scan
      const multiEmail = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: 'anshul.goel@procucev.com, veerababu.v@procucev.com',
      });
      expect(multiEmail.total).toBe(2);
      expect(multiEmail.rows.map((r) => r.id)).toEqual(['v-veera', 'v-corp-only']);

      // Domain-only leading '@' search matches both email and corporateEmail
      const domainOnly = await domainQueries.getVendorsPageFromDB({
        limit: 50,
        offset: 0,
        search: '@procucev.com',
      });
      expect(domainOnly.total).toBe(3);
      expect(domainOnly.rows.map((r) => r.id)).toEqual(['v-veera', 'v-corp-only', 'v-underscore']);
    } finally {
      db.close();
    }
  });
});
