const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(BACKEND_ROOT, 'src/db/migrations');
const D1_MIGRATION = '0032_public_vendor_listing_index_v2.d1.sql';
const PG_MIGRATION = '0032_public_vendor_listing_index_v2.pg.sql';
const LOCAL_SCRIPT = 'db:migrate:d1:local:public-vendor-listing-index-v2';

const normalizeSql = (sql) => sql.replace(/\s+/g, ' ').trim();

// The WHERE clause of the partial index, with whitespace collapsed. SQLite only uses a partial
// index when the query repeats its WHERE terms exactly, so the query must contain this text.
function indexPredicate(migrationFile) {
  const sql = normalizeSql(fs.readFileSync(path.join(MIGRATIONS, migrationFile), 'utf8'));
  const match = sql.match(/CREATE INDEX IF NOT EXISTS idx_vendors_public_created_at ON vendors \(created_at DESC\) WHERE (.+?);?$/);
  if (!match) throw new Error(`no partial index definition found in ${migrationFile}`);
  return match[1].replace(/;$/, '');
}

function captureHydrationQueries() {
  let isolated;
  jest.isolateModules(() => {
    isolated = {
      pool: require('../src/db/pool'),
      domainQueries: require('../src/db/domainQueries'),
    };
  });
  const calls = [];
  jest.spyOn(isolated.pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(isolated.pool, 'query').mockImplementation(async (text, params, options) => {
    calls.push({ text, options });
    return { rows: [], rowCount: 0 };
  });
  return { domainQueries: isolated.domainQueries, calls };
}

describe('public vendor listing index', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the D1 hydration query filters with the predicate the 0032 index covers', async () => {
    const { domainQueries, calls } = captureHydrationQueries();
    await domainQueries.getVendorsPageFromDB({ limit: 500, offset: 0, skipCount: true, publicOnly: true });
    expect(calls).toHaveLength(1);
    expect(normalizeSql(calls[0].options.d1Text)).toContain(indexPredicate(D1_MIGRATION));
  });

  test('the D1 hydration query does not wrap the owner checks in lower(), which the planner cannot match', async () => {
    const { domainQueries, calls } = captureHydrationQueries();
    await domainQueries.getVendorsPageFromDB({ limit: 500, offset: 0, skipCount: true, publicOnly: true });
    expect(normalizeSql(calls[0].options.d1Text)).not.toContain("lower(json_extract(raw,'$.buyerId')) IS NULL");
    expect(normalizeSql(calls[0].options.d1Text)).not.toContain("lower(json_extract(raw,'$.buyerAccountId')) IS NULL");
  });

  test('the PostgreSQL hydration query filters with the owner checks the PostgreSQL index covers', async () => {
    const { domainQueries, calls } = captureHydrationQueries();
    await domainQueries.getVendorsPageFromDB({ limit: 500, offset: 0, skipCount: true, publicOnly: true });
    expect(calls).toHaveLength(1);
    expect(normalizeSql(calls[0].text)).toContain(indexPredicate(PG_MIGRATION));
  });

  test('both dialects ship the migration and the local mock setup applies it', () => {
    expect(fs.existsSync(path.join(MIGRATIONS, D1_MIGRATION))).toBe(true);
    expect(fs.existsSync(path.join(MIGRATIONS, PG_MIGRATION))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts[LOCAL_SCRIPT]).toContain(D1_MIGRATION);
    expect(pkg.scripts['db:setup:mock:local']).toContain(LOCAL_SCRIPT);
  });
});
