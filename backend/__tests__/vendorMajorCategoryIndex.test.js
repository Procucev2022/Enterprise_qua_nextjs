const fs = require('fs');
const path = require('path');

const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(BACKEND_ROOT, 'src/db/migrations');
const D1_MIGRATION = '0033_vendor_major_category_index.d1.sql';
const PG_MIGRATION = '0033_vendor_major_category_index.pg.sql';
const LOCAL_SCRIPT = 'db:migrate:d1:local:vendor-major-category-index';

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

function readMigration(file) {
  return normalizeSql(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

// SQLite and PostgreSQL only use an index when the query filters on the exact expression it covers.
// These tests keep the migrations and the V0 major-category lookup on the same expression.
describe('vendor major category index', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function captureLookupQuery() {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    return jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
  }

  test('the D1 migration indexes the major_category COLLATE NOCASE expression the lookup filters on', async () => {
    expect(readMigration(D1_MIGRATION)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_vendors_major_category_nocase ON vendors (major_category COLLATE NOCASE);'
    );
    const query = captureLookupQuery();
    await domainQueries.getPublicVendorsByMajorCategoryFromDB(['Steels'], 10);
    expect(normalizeSql(query.mock.calls[0][2].d1Text)).toContain('major_category COLLATE NOCASE IN ($1)');
  });

  test('the PostgreSQL migration indexes lower(major_category), the expression the PostgreSQL lookup filters on', async () => {
    expect(readMigration(PG_MIGRATION)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_vendors_major_category_lower ON vendors (lower(major_category));'
    );
    const query = captureLookupQuery();
    await domainQueries.getPublicVendorsByMajorCategoryFromDB(['Steels'], 10);
    expect(normalizeSql(query.mock.calls[0][0])).toContain('lower(major_category) = ANY($1::text[])');
  });

  test('both dialects ship the migration and the local mock setup applies the D1 migration', () => {
    expect(fs.existsSync(path.join(MIGRATIONS, D1_MIGRATION))).toBe(true);
    expect(fs.existsSync(path.join(MIGRATIONS, PG_MIGRATION))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts[LOCAL_SCRIPT]).toContain(D1_MIGRATION);
    expect(pkg.scripts['db:setup:mock:local']).toContain(LOCAL_SCRIPT);
  });
});
