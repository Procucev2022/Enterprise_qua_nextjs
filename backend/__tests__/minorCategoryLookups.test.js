const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('getPublicVendorsByMinorCategoryFromDB', () => {
  const originalPool = pool.pool;
  const originalBinding = globalThis.__CF_ENV__;

  afterEach(() => {
    pool.pool = originalPool;
    if (originalBinding === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = originalBinding;
    jest.restoreAllMocks();
  });

  test('returns [] without querying when no pool is configured', async () => {
    pool.pool = null;
    globalThis.__CF_ENV__ = undefined;
    await expect(
      domainQueries.getPublicVendorsByMinorCategoryFromDB(['bearings & accessories'], ['engineering spares - mechanical'], 10)
    ).resolves.toEqual([]);
  });

  test('returns [] for missing minors or majors without querying', async () => {
    pool.pool = { query: jest.fn() };
    await expect(domainQueries.getPublicVendorsByMinorCategoryFromDB([], ['engineering spares - mechanical'], 10)).resolves.toEqual([]);
    await expect(domainQueries.getPublicVendorsByMinorCategoryFromDB(['  ', ''], ['engineering spares - mechanical'], 10)).resolves.toEqual([]);
    await expect(domainQueries.getPublicVendorsByMinorCategoryFromDB(['bearings'], [], 10)).resolves.toEqual([]);
    await expect(domainQueries.getPublicVendorsByMinorCategoryFromDB('bearings', 'mechanical', 10)).resolves.toEqual([]);
    expect(pool.pool.query).not.toHaveBeenCalled();
  });

  test('queries Postgres with the major array, one quoted pattern per term, and the capped limit', async () => {
    const vendor = { id: 'v-pg-minor', name: 'Pg Minor Vendor', minorCategories: ['Bearings & Accessories'] };
    const query = jest.fn().mockResolvedValue({ rows: [{ raw: JSON.stringify(vendor) }] });
    pool.pool = { query };

    const rows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(
      ['bearings & accessories', 'bearings & accessorie'],
      ['engineering spares - mechanical', 'mechanical'],
      100000
    );

    expect(rows).toEqual([expect.objectContaining({ id: 'v-pg-minor' })]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('lower(major_category) = ANY($1::text[])');
    expect(sql).toContain('LIKE $2');
    expect(sql).toContain('LIKE $3');
    expect(sql).toContain('ORDER BY created_at DESC LIMIT $4');
    expect(params).toEqual([
      ['engineering spares - mechanical', 'mechanical'],
      '%"bearings & accessories',
      '%"bearings & accessorie',
      500,
    ]);
  });

  test('binds one placeholder per major, then per term, then the limit on D1', async () => {
    const vendor = { id: 'v-d1-minor', name: 'D1 Minor Vendor' };
    const all = jest.fn().mockResolvedValue({ results: [{ raw: JSON.stringify(vendor) }], meta: {} });
    const bind = jest.fn(() => ({ all }));
    const prepare = jest.fn(() => ({ bind, all }));
    pool.pool = null;
    globalThis.__CF_ENV__ = { DB: { prepare } };

    const rows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(
      ['bearings & accessories'],
      ['engineering spares - mechanical'],
      5
    );

    expect(rows).toEqual([expect.objectContaining({ id: 'v-d1-minor' })]);
    const [sql] = prepare.mock.calls[0];
    expect(sql).toContain('major_category COLLATE NOCASE IN (?)');
    expect(sql).toContain('raw LIKE ?');
    expect(sql).toContain('ORDER BY created_at DESC LIMIT ?');
    expect(bind).toHaveBeenCalledWith('engineering spares - mechanical', '%"bearings & accessories', 5);
  });
});
