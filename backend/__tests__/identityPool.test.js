const identityPool = require('../src/db/identityPool');

describe('Identity pool (shared Procucev MySQL connection)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Configuration resolution ──────────────────────────────────────────────
  describe('resolveConfig', () => {
    const complete = {
      MYSQL_HOST: 'db.mysql.database.azure.com',
      MYSQL_DATABASE: 'development_gmtbfs',
      MYSQL_USER: 'p2padmin@db',
      MYSQL_PASSWORD: 'secret',
    };

    test('builds a config with sensible defaults', () => {
      const config = identityPool.resolveConfig(complete);

      expect(config).toMatchObject({
        host: complete.MYSQL_HOST,
        port: 3306,
        database: complete.MYSQL_DATABASE,
        user: complete.MYSQL_USER,
        connectionLimit: 5,
        connectTimeout: 15000,
        waitForConnections: true,
        timezone: 'Z',
      });
      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    test('honours explicit port, pool size and timeout overrides', () => {
      const config = identityPool.resolveConfig({
        ...complete,
        MYSQL_PORT: '3307',
        MYSQL_POOL_MAX: '11',
        MYSQL_CONNECT_TIMEOUT_MS: '9000',
      });

      expect(config.port).toBe(3307);
      expect(config.connectionLimit).toBe(11);
      expect(config.connectTimeout).toBe(9000);
    });

    test('disables TLS only when MYSQL_SSL is exactly "false"', () => {
      expect(identityPool.resolveConfig({ ...complete, MYSQL_SSL: 'false' }).ssl).toBeUndefined();
      expect(identityPool.resolveConfig({ ...complete, MYSQL_SSL: 'true' }).ssl).toEqual({
        rejectUnauthorized: false,
      });
    });

    test('accepts the IDENTITY_DB_* aliases', () => {
      const config = identityPool.resolveConfig({
        IDENTITY_DB_HOST: 'alias-host',
        IDENTITY_DB_NAME: 'alias-db',
        IDENTITY_DB_USER: 'alias-user',
        IDENTITY_DB_PASSWORD: 'alias-pass',
      });

      expect(config).toMatchObject({ host: 'alias-host', database: 'alias-db', user: 'alias-user' });
    });

    test('defaults the password to an empty string when unset', () => {
      const config = identityPool.resolveConfig({
        MYSQL_HOST: 'h',
        MYSQL_DATABASE: 'd',
        MYSQL_USER: 'u',
      });
      expect(config.password).toBe('');
    });

    test.each([
      ['host', { MYSQL_DATABASE: 'd', MYSQL_USER: 'u' }],
      ['database', { MYSQL_HOST: 'h', MYSQL_USER: 'u' }],
      ['user', { MYSQL_HOST: 'h', MYSQL_DATABASE: 'd' }],
    ])('returns null when %s is missing', (_field, env) => {
      expect(identityPool.resolveConfig(env)).toBeNull();
    });

    test('returns null for a completely empty environment', () => {
      expect(identityPool.resolveConfig({})).toBeNull();
    });
  });

  describe('createIdentityPool', () => {
    test('returns null when nothing is configured', () => {
      expect(identityPool.createIdentityPool({})).toBeNull();
    });

    test('returns a pool object when configuration is present', () => {
      const pool = identityPool.createIdentityPool({
        MYSQL_HOST: '127.0.0.1',
        MYSQL_DATABASE: 'd',
        MYSQL_USER: 'u',
        MYSQL_PASSWORD: 'p',
        MYSQL_SSL: 'false',
      });

      expect(pool).toBeTruthy();
      expect(typeof pool.query).toBe('function');
      // Created lazily, so ending it performs no network I/O.
      return pool.end().catch(() => {});
    });
  });

  // ── bit(1) coercion ───────────────────────────────────────────────────────
  describe('bitToBoolean', () => {
    test.each([
      [Buffer.from([1]), true],
      [Buffer.from([0]), false],
      [true, true],
      [false, false],
      [1, true],
      [0, false],
      ['1', true],
      [null, false],
      [undefined, false],
    ])('coerces %p to %p', (input, expected) => {
      expect(identityPool.bitToBoolean(input)).toBe(expected);
    });
  });

  // ── Query passthrough ─────────────────────────────────────────────────────
  describe('identityQuery', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = identityPool.pool;
    });

    afterEach(() => {
      identityPool.pool = originalPool;
    });

    test('returns the row set from the underlying driver', async () => {
      const rows = [{ uuid: 'u-1' }];
      identityPool.pool = { query: jest.fn().mockResolvedValue([rows, []]) };

      await expect(identityPool.identityQuery('select 1', [1])).resolves.toBe(rows);
      expect(identityPool.pool.query).toHaveBeenCalledWith('select 1', [1]);
    });

    test('defaults the parameter list', async () => {
      identityPool.pool = { query: jest.fn().mockResolvedValue([[], []]) };
      await identityPool.identityQuery('select 1');
      expect(identityPool.pool.query).toHaveBeenCalledWith('select 1', []);
    });

    test('throws a clear error when the connection is not configured', async () => {
      identityPool.pool = null;
      await expect(identityPool.identityQuery('select 1')).rejects.toThrow(
        'Identity database is not configured.'
      );
    });
  });

  // ── Health reporting ──────────────────────────────────────────────────────
  describe('checkIdentityHealth', () => {
    let originalPool;
    let originalEnv;

    // checkIdentityHealth resolves its config from process.env and queries through
    // the module's pool reference, so the environment and the pool stub are what
    // drive it rather than spies on the local helpers.
    const setEnv = (overrides = {}) => {
      Object.assign(process.env, {
        MYSQL_HOST: 'databasep2p.mysql.database.azure.com',
        MYSQL_DATABASE: 'development_gmtbfs',
        MYSQL_USER: 'p2padmin@db',
        MYSQL_PASSWORD: 'secret',
        MYSQL_POOL_MAX: '5',
        ...overrides,
      });
    };

    beforeEach(() => {
      originalPool = identityPool.pool;
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      identityPool.pool = originalPool;
      process.env = originalEnv;
    });

    test('reports the not-configured state without touching the network', async () => {
      identityPool.pool = null;
      ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'IDENTITY_DB_HOST', 'IDENTITY_DB_NAME', 'IDENTITY_DB_USER']
        .forEach((key) => delete process.env[key]);

      const health = await identityPool.checkIdentityHealth();

      expect(health).toMatchObject({
        isConfigured: false,
        isConnected: false,
        provider: 'not_configured',
        poolStatus: 'NOT_CONFIGURED',
        userCount: 0,
      });
      expect(health.errorMessage).toContain('MYSQL_HOST');
    });

    test('labels an Azure host as azure_mysql and reports the active user count', async () => {
      setEnv();
      identityPool.pool = { query: jest.fn().mockResolvedValue([[{ total: 197 }], []]) };

      const health = await identityPool.checkIdentityHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: true,
        provider: 'azure_mysql',
        database: 'development_gmtbfs',
        userCount: 197,
      });
      expect(health.providerLabel).toContain('Azure');
      expect(health.poolStatus).toContain('ACTIVE');
      expect(typeof health.latencyMs).toBe('number');
    });

    test('labels a non-Azure host as plain mysql', async () => {
      setEnv({ MYSQL_HOST: '127.0.0.1', MYSQL_DATABASE: 'local' });
      identityPool.pool = { query: jest.fn().mockResolvedValue([[{ total: 2 }], []]) };

      const health = await identityPool.checkIdentityHealth();

      expect(health.provider).toBe('mysql');
      expect(health.providerLabel).not.toContain('Azure');
    });

    test('defaults the user count when the count row is absent', async () => {
      setEnv();
      identityPool.pool = { query: jest.fn().mockResolvedValue([[], []]) };

      await expect(identityPool.checkIdentityHealth()).resolves.toMatchObject({ userCount: 0 });
    });

    test('reports an unreachable connection with the driver message', async () => {
      setEnv();
      identityPool.pool = { query: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) };

      const health = await identityPool.checkIdentityHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: false,
        poolStatus: 'UNREACHABLE',
        errorMessage: 'ETIMEDOUT',
        userCount: 0,
      });
    });

    test('falls back to a generic message when the error carries none', async () => {
      setEnv();
      identityPool.pool = { query: jest.fn().mockRejectedValue(new Error('')) };

      await expect(identityPool.checkIdentityHealth()).resolves.toMatchObject({
        errorMessage: 'Identity database connection failed.',
      });
    });
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────
  describe('closeIdentityPool', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = identityPool.pool;
    });

    afterEach(() => {
      identityPool.pool = originalPool;
    });

    test('ends the pool and clears the reference', async () => {
      const end = jest.fn().mockResolvedValue(undefined);
      identityPool.pool = { end };

      await identityPool.closeIdentityPool();

      expect(end).toHaveBeenCalled();
      expect(identityPool.pool).toBeNull();
    });

    test('is a no-op when there is no pool', async () => {
      identityPool.pool = null;
      await expect(identityPool.closeIdentityPool()).resolves.toBeUndefined();
    });
  });
});
