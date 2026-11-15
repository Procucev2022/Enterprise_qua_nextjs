const fs = require('fs');
const path = require('path');

const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(BACKEND_ROOT, 'src/db/migrations');
const D1_MIGRATION = '0035_vendor_category_created_at_index.d1.sql';
const PG_MIGRATION = '0035_vendor_category_created_at_index.pg.sql';
const LOCAL_SCRIPT = 'db:migrate:d1:local:vendor-category-created-at-index';

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

function readMigration(file) {
  return normalizeSql(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

describe('vendor category + created_at composite index and D1 search prefiltering', () => {
  afterEach(() => {
    if (pool.queryCache) pool.queryCache.clear();
    jest.restoreAllMocks();
  });

  test('the D1 migration creates the composite (major_category COLLATE NOCASE, created_at DESC) index and paginated D1 category filter avoids full-table raw LIKE scans', async () => {
    expect(readMigration(D1_MIGRATION)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_vendors_major_category_created_at ON vendors (major_category COLLATE NOCASE, created_at DESC);'
    );

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await domainQueries.getVendorsPageFromDB({ limit: 20, offset: 0, category: 'IT', skipCount: true });

    const d1Sql = normalizeSql(query.mock.calls[0][2].d1Text);
    expect(d1Sql).toContain('major_category = $1 COLLATE NOCASE');
    expect(d1Sql).toContain('ORDER BY created_at DESC LIMIT $2 OFFSET $3');
    expect(d1Sql).not.toContain('raw LIKE');
  });

  test('the D1 search query guards multi-field json_extract parsing behind a raw/column LIKE prefilter', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const query = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    await domainQueries.getVendorsPageFromDB({ limit: 50, offset: 0, search: 'l', skipCount: true });

    const d1Sql = normalizeSql(query.mock.calls[0][2].d1Text);
    expect(d1Sql).toContain('(raw LIKE $1 OR major_category LIKE $1 OR email LIKE $1) AND');
    expect(query.mock.calls[0][0]).not.toContain('json_extract');
  });

  test('both dialects ship migration 0035, and package.json applies it locally', () => {
    expect(readMigration(PG_MIGRATION)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_vendors_major_category_lower_created_at ON vendors (lower(major_category), created_at DESC);'
    );
    expect(readMigration(D1_MIGRATION)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_vendors_major_category_created_at ON vendors (major_category COLLATE NOCASE, created_at DESC);'
    );

    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts[LOCAL_SCRIPT]).toContain(D1_MIGRATION);
    expect(pkg.scripts['db:setup:mock:local']).toContain(LOCAL_SCRIPT);
  });
});
