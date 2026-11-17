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
      '%"bearings & accessories%',
      '%"bearings & accessorie%',
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
    expect(bind).toHaveBeenCalledWith('engineering spares - mechanical', '%"bearings & accessories%', 5);
  });

  test('produces wildcard LIKE patterns that match serialized JSON minorCategories payloads', async () => {
    const vendorRaw = JSON.stringify({
      id: 'v-laptop-json',
      name: 'Laptop Dealer',
      majorCategory: 'IT',
      minorCategories: ['Laptop', 'Computer'],
    });
    const all = jest.fn().mockImplementation(function () {
      const boundPattern = this._pattern;
      const regex = new RegExp(`^${String(boundPattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
      return Promise.resolve({
        results: regex.test(vendorRaw) ? [{ raw: vendorRaw }] : [],
        meta: {},
      });
    });
    const bind = jest.fn((...args) => ({ _pattern: args[1], all }));
    const prepare = jest.fn(() => ({ bind }));
    pool.pool = null;
    globalThis.__CF_ENV__ = { DB: { prepare } };

    const rows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(['laptop'], ['it'], 25);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('v-laptop-json');
  });

  test('tops up with broad name/products substring lookup when primary quoted-prefix lookup returns unverified or fewer rows than limit, and skips broad lookup for short terms', async () => {
    const emailNoiseVendor = {
      id: 'v-email-noise',
      name: 'Generic Hardware Co',
      email: 'laptop- enquiries@noise.test',
      majorCategory: 'IT',
      minorCategories: ['Hardware'],
    };
    const nameMatchedVendor = {
      id: 'v-name-laptop',
      name: 'Sri Sai Laptop Service Center',
      email: 'contact@srisai.test',
      majorCategory: 'IT',
      minorCategories: ['Hardware'],
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(emailNoiseVendor) }] })
      .mockResolvedValueOnce({ rows: [{ raw: JSON.stringify(nameMatchedVendor) }] });
    pool.pool = { query };

    const rows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(['laptop'], ['it'], 2);

    expect(query).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => r.id)).toEqual(['v-email-noise', 'v-name-laptop']);

    // Short terms (< 4 chars, e.g. "ups") skip the broad substring pass
    query.mockClear();
    query.mockResolvedValueOnce({ rows: [] });
    const shortRows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(['ups'], ['it'], 5);
    expect(shortRows).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
