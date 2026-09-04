const domainPool = require('../src/db/pool');

describe('Domain pool (Neon PostgreSQL — vendors + RFQs)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Configuration resolution ──────────────────────────────────────────────
  describe('resolveConfig', () => {
    test('returns null when DATABASE_URL is unset', () => {
      expect(domainPool.resolveConfig({})).toBeNull();
    });

    test('builds a config with sensible defaults', () => {
      const config = domainPool.resolveConfig({
        DATABASE_URL: 'postgres://user:pass@ep.neon.tech/db?sslmode=require',
      });

      expect(config).toMatchObject({
        connectionString: 'postgres://user:pass@ep.neon.tech/db?sslmode=require',
        max: 10,
        connectionTimeoutMillis: 5000,
      });
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
    });

    test('honours explicit pool size and timeout overrides', () => {
      const config = domainPool.resolveConfig({
        DATABASE_URL: 'postgres://x/y',
        DATABASE_POOL_MAX: '20',
        DATABASE_CONNECT_TIMEOUT_MS: '9000',
      });

      expect(config.max).toBe(20);
      expect(config.connectionTimeoutMillis).toBe(9000);
    });

    test.each(['postgres://user:pass@localhost:5432/db', 'postgres://user:pass@127.0.0.1:5432/db'])(
      'disables SSL for a local connection string (%s)',
      (connectionString) => {
        expect(domainPool.resolveConfig({ DATABASE_URL: connectionString }).ssl).toBe(false);
      }
    );
  });

  describe('createPool', () => {
    test('returns null when nothing is configured', () => {
      expect(domainPool.createPool({})).toBeNull();
    });

    test('returns a pool object when configuration is present', () => {
      const pool = domainPool.createPool({ DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db' });

      expect(pool).toBeTruthy();
      expect(typeof pool.query).toBe('function');
      // Created lazily, so ending it performs no network I/O.
      return pool.end().catch(() => {});
    });
  });

  // ── Query passthrough ─────────────────────────────────────────────────────
  describe('query', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = domainPool.pool;
    });

    afterEach(() => {
      domainPool.pool = originalPool;
    });

    test('delegates to the underlying pool', async () => {
      const result = { rows: [{ id: 1 }], rowCount: 1 };
      domainPool.pool = { query: jest.fn().mockResolvedValue(result) };

      await expect(domainPool.query('select 1', [1])).resolves.toBe(result);
      expect(domainPool.pool.query).toHaveBeenCalledWith('select 1', [1]);
    });

    test('defaults the parameter list', async () => {
      domainPool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await domainPool.query('select 1');
      expect(domainPool.pool.query).toHaveBeenCalledWith('select 1', []);
    });

    test('throws a clear error when the connection is not configured', async () => {
      domainPool.pool = null;
      await expect(domainPool.query('select 1')).rejects.toThrow('Domain database is not configured.');
    });
  });

  // ── Health reporting ──────────────────────────────────────────────────────
  describe('checkDomainDBHealth', () => {
    let originalPool;
    let originalEnv;

    beforeEach(() => {
      originalPool = domainPool.pool;
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      domainPool.pool = originalPool;
      process.env = originalEnv;
    });

    test('reports the not-configured state without touching the network', async () => {
      domainPool.pool = null;
      delete process.env.DATABASE_URL;

      const health = await domainPool.checkDomainDBHealth();

      expect(health).toMatchObject({
        isConfigured: false,
        isConnected: false,
        provider: 'not_configured',
        poolStatus: 'NOT_CONFIGURED',
        vendorCount: 0,
        rfqCount: 0,
      });
      expect(health.errorMessage).toContain('DATABASE_URL');
    });

    test('labels a neon.tech host as neon and reports vendor/RFQ counts', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      domainPool.pool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ total: 5 }] })
          .mockResolvedValueOnce({ rows: [{ total: 3 }] }),
      };

      const health = await domainPool.checkDomainDBHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: true,
        provider: 'neon',
        vendorCount: 5,
        rfqCount: 3,
      });
      expect(health.providerLabel).toContain('Neon');
      expect(health.poolStatus).toContain('ACTIVE');
      expect(typeof health.latencyMs).toBe('number');
    });

    test('labels a non-neon host as plain postgres', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@somehost.example.com/db';
      domainPool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ total: 0 }] }) };

      const health = await domainPool.checkDomainDBHealth();

      expect(health.provider).toBe('postgres');
      expect(health.providerLabel).not.toContain('Neon');
    });

    test('defaults counts to 0 when the count row is absent', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      domainPool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      await expect(domainPool.checkDomainDBHealth()).resolves.toMatchObject({ vendorCount: 0, rfqCount: 0 });
    });

    test('reports an unreachable connection with the driver message', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      domainPool.pool = { query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

      const health = await domainPool.checkDomainDBHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: false,
        poolStatus: 'UNREACHABLE',
        errorMessage: 'ECONNREFUSED',
        vendorCount: 0,
        rfqCount: 0,
      });
    });

    test('falls back to a generic message when the error carries none', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      domainPool.pool = { query: jest.fn().mockRejectedValue(new Error('')) };

      await expect(domainPool.checkDomainDBHealth()).resolves.toMatchObject({
        errorMessage: 'Domain database connection failed.',
      });
    });
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────
  describe('closePool', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = domainPool.pool;
    });

    afterEach(() => {
      domainPool.pool = originalPool;
    });

    test('ends the pool and clears the reference', async () => {
      const end = jest.fn().mockResolvedValue(undefined);
      domainPool.pool = { end };

      await domainPool.closePool();

      expect(end).toHaveBeenCalled();
      expect(domainPool.pool).toBeNull();
    });

    test('is a no-op when there is no pool', async () => {
      domainPool.pool = null;
      await expect(domainPool.closePool()).resolves.toBeUndefined();
    });
  });
});
