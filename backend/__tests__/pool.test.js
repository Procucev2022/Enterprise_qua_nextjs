const dbPool = require('../src/db/pool');

describe('Database pool (Neon PostgreSQL)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Configuration resolution ──────────────────────────────────────────────
  describe('resolveConfig', () => {
    test('returns null when DATABASE_URL is unset', () => {
      expect(dbPool.resolveConfig({})).toBeNull();
    });

    test('builds a config with sensible defaults', () => {
      const config = dbPool.resolveConfig({
        DATABASE_URL: 'postgres://user:pass@ep.neon.tech/db?sslmode=require',
      });

      // sslmode/channel_binding are stripped from the outgoing connection string:
      // pg-connection-string would otherwise parse them into its own ssl config
      // and silently override the ssl object built below.
      expect(config).toMatchObject({
        connectionString: 'postgres://user:pass@ep.neon.tech/db',
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
      });
      expect(config.ssl).toEqual({ rejectUnauthorized: true });
    });

    test('relaxes certificate verification for a non-Neon host (e.g. Aiven, self-signed CA)', () => {
      const config = dbPool.resolveConfig({
        DATABASE_URL: 'postgres://user:pass@some-service.aivencloud.com:5432/db?sslmode=require',
      });

      expect(config.connectionString).toBe('postgres://user:pass@some-service.aivencloud.com:5432/db');
      expect(config.ssl).toEqual({ rejectUnauthorized: false });
    });

    test('honours explicit pool size and timeout overrides', () => {
      const config = dbPool.resolveConfig({
        DATABASE_URL: 'postgres://x/y',
        DATABASE_POOL_MAX: '20',
        DATABASE_CONNECT_TIMEOUT_MS: '9000',
        DATABASE_IDLE_TIMEOUT_MS: '2500',
      });

      expect(config.max).toBe(20);
      expect(config.connectionTimeoutMillis).toBe(9000);
      expect(config.idleTimeoutMillis).toBe(2500);
    });

    test.each(['postgres://user:pass@localhost:5432/db', 'postgres://user:pass@127.0.0.1:5432/db'])(
      'disables SSL for a local connection string (%s)',
      (connectionString) => {
        expect(dbPool.resolveConfig({ DATABASE_URL: connectionString }).ssl).toBe(false);
      }
    );
  });

  describe('createPool', () => {
    test('returns null when nothing is configured', () => {
      expect(dbPool.createPool({})).toBeNull();
    });

    test('returns a pool object when configuration is present and handles idle error', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const pool = dbPool.createPool({ DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/db' });

      expect(pool).toBeTruthy();
      expect(typeof pool.query).toBe('function');
      // Trigger error listener to verify idle client recovery log
      pool.emit('error', new Error('Connection reset by peer'));
      process.env.NODE_ENV = origEnv;
      // Created lazily, so ending it performs no network I/O.
      return pool.end().catch(() => {});
    });
  });

  describe('hasStorage', () => {
    test('reports true when pool is active', () => {
      const origPool = dbPool.pool;
      dbPool.pool = { query: jest.fn() };
      expect(dbPool.hasStorage()).toBe(true);
      dbPool.pool = origPool;
    });

    test('reports true when D1 binding or HTTP client is present', () => {
      const origPool = dbPool.pool;
      dbPool.pool = null;

      globalThis.__CF_ENV__ = { DB: { prepare: jest.fn() } };
      expect(dbPool.hasStorage()).toBe(true);
      delete globalThis.__CF_ENV__;

      dbPool.pool = origPool;
    });

    test('reports false when neither pool nor D1 is present', () => {
      const origPool = dbPool.pool;
      dbPool.pool = null;
      expect(dbPool.hasStorage()).toBe(false);
      dbPool.pool = origPool;
    });
  });

  describe('detectProvider', () => {
    test('labels a neon.tech host as neon', () => {
      expect(dbPool.detectProvider('postgres://u:p@ep.NEON.tech/db')).toMatchObject({ provider: 'neon' });
    });

    test('labels anything else as plain postgres', () => {
      expect(dbPool.detectProvider('postgres://u:p@db.example.com/db')).toMatchObject({
        provider: 'postgres',
      });
    });
  });

  describe('detectDatabaseName', () => {
    test('extracts the database name', () => {
      expect(dbPool.detectDatabaseName('postgres://u:p@host/neondb?sslmode=require')).toBe('neondb');
      expect(dbPool.detectDatabaseName('postgres://u:p@host/neondb')).toBe('neondb');
    });

    test('returns an empty string when there is no path segment', () => {
      expect(dbPool.detectDatabaseName('')).toBe('');
      expect(dbPool.detectDatabaseName(undefined)).toBe('');
    });
  });

  // ── Query passthrough ─────────────────────────────────────────────────────
  describe('query', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = dbPool.pool;
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('delegates to the underlying pool', async () => {
      const result = { rows: [{ id: 1 }], rowCount: 1 };
      dbPool.pool = { query: jest.fn().mockResolvedValue(result) };

      await expect(dbPool.query('select 1', [1])).resolves.toBe(result);
      expect(dbPool.pool.query).toHaveBeenCalledWith('select 1', [1]);
    });

    test('defaults the parameter list', async () => {
      dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await dbPool.query('select 1');
      expect(dbPool.pool.query).toHaveBeenCalledWith('select 1', []);
    });

    test('throws a clear error when the connection is not configured', async () => {
      dbPool.pool = null;
      await expect(dbPool.query('select 1')).rejects.toThrow(dbPool.NOT_CONFIGURED_MESSAGE);
      // The message names the setting the operator has to fix, rather than just
      // reporting that something is missing.
      expect(dbPool.NOT_CONFIGURED_MESSAGE).toContain('DATABASE_URL');
    });

    test('ignores the d1 option when no D1 binding is available (Node/Render)', async () => {
      const result = { rows: [{ id: 1 }] };
      dbPool.pool = { query: jest.fn().mockResolvedValue(result) };

      await expect(dbPool.query('select 1', [], { d1: true })).resolves.toBe(result);
      expect(dbPool.pool.query).toHaveBeenCalledWith('select 1', []);
    });

    test('routes to D1 when a binding is available and { d1: true } is passed', async () => {
      jest.resetModules();
      jest.doMock('../src/db/d1Bridge', () => ({
        getD1Binding: jest.fn().mockReturnValue({ id: 'fake-d1' }),
        queryD1: jest.fn().mockResolvedValue({ rows: [{ id: 'from-d1' }] }),
      }));
      const freshPool = require('../src/db/pool');
      const d1Bridge = require('../src/db/d1Bridge');

      const result = await freshPool.query('select 1', ['a'], { d1: true });

      expect(d1Bridge.queryD1).toHaveBeenCalledWith({ id: 'fake-d1' }, 'select 1', ['a']);
      expect(result).toEqual({ rows: [{ id: 'from-d1' }] });

      jest.dontMock('../src/db/d1Bridge');
      jest.resetModules();
    });

    test('supports query caching with { useCache: true } and returns cached data on hit', async () => {
      const dbResult = { rows: [{ id: 'cached-1', title: 'Cached Item' }], rowCount: 1 };
      dbPool.pool = { query: jest.fn().mockResolvedValue(dbResult) };
      dbPool.queryCache.clear();

      // First query: cache miss -> queries pool and sets cache
      const res1 = await dbPool.query('SELECT raw FROM rfqs WHERE id = $1', ['rfq-123'], {
        useCache: true,
        tag: 'rfqs',
        ttlMs: 60000,
      });
      expect(res1.rows).toEqual(dbResult.rows);
      expect(dbPool.pool.query).toHaveBeenCalledTimes(1);

      // Second query: cache hit -> returned from memory without calling pool.query
      const res2 = await dbPool.query('SELECT raw FROM rfqs WHERE id = $1', ['rfq-123'], {
        useCache: true,
        tag: 'rfqs',
        ttlMs: 60000,
      });
      expect(res2.rows).toEqual(dbResult.rows);
      expect(res2.isCacheHit).toBe(true);
      expect(dbPool.pool.query).toHaveBeenCalledTimes(1);

      // Write query: invalidates the rfqs tag
      await dbPool.query('INSERT INTO rfqs (id, title) VALUES ($1, $2)', ['rfq-999', 'New RFQ']);
      
      // Third query after write: cache miss again -> queries pool
      await dbPool.query('SELECT raw FROM rfqs WHERE id = $1', ['rfq-123'], {
        useCache: true,
        tag: 'rfqs',
        ttlMs: 60000,
      });
      expect(dbPool.pool.query).toHaveBeenCalledTimes(3);
    });
  });

  describe('rows', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = dbPool.pool;
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('unwraps result.rows', async () => {
      dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ n: 1 }, { n: 2 }] }) };
      await expect(dbPool.rows('select n')).resolves.toEqual([{ n: 1 }, { n: 2 }]);
    });

    test('yields an empty array when the driver returns no rows property', async () => {
      // Guards the call sites from reading .rows off an undefined result.
      dbPool.pool = { query: jest.fn().mockResolvedValue({}) };
      await expect(dbPool.rows('select n')).resolves.toEqual([]);
    });
  });

  // ── Transactions ──────────────────────────────────────────────────────────
  describe('withTransaction', () => {
    let originalPool;
    let client;

    beforeEach(() => {
      originalPool = dbPool.pool;
      client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
      dbPool.pool = { connect: jest.fn().mockResolvedValue(client) };
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('wraps the callback in BEGIN/COMMIT and returns its value', async () => {
      const result = await dbPool.withTransaction(async (c) => {
        await c.query('insert into t values (1)');
        return 'done';
      });

      expect(result).toBe('done');
      const statements = client.query.mock.calls.map((call) => call[0]);
      expect(statements[0]).toBe('BEGIN');
      expect(statements[statements.length - 1]).toBe('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    test('rolls back and rethrows the original error', async () => {
      const boom = new Error('constraint violation');
      await expect(
        dbPool.withTransaction(async () => {
          throw boom;
        })
      ).rejects.toBe(boom);

      expect(client.query.mock.calls.map((call) => call[0])).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    test('surfaces the original error even when the rollback itself fails', async () => {
      // A dropped connection makes ROLLBACK fail too; the caller needs the cause,
      // not the secondary failure.
      const boom = new Error('original cause');
      client.query.mockImplementation(async (sql) => {
        if (sql === 'ROLLBACK') throw new Error('connection already closed');
        if (sql === 'BEGIN') return { rows: [] };
        throw boom;
      });

      await expect(dbPool.withTransaction(async (c) => c.query('select 1'))).rejects.toThrow(
        'original cause'
      );
      expect(client.release).toHaveBeenCalled();
    });

    test('releases the client even when the callback succeeds', async () => {
      await dbPool.withTransaction(async () => 1);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('executes transaction with D1 client wrapper when D1 is available', async () => {
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: jest.fn().mockReturnValue({
            bind: jest.fn().mockReturnThis(),
            all: jest.fn().mockResolvedValue({ results: [{ id: 'tx-1' }] }),
          }),
        },
      };

      const result = await dbPool.withTransaction(async (client) => {
        const res = await client.query('select 1');
        return res.rows;
      });

      expect(result).toEqual([{ id: 'tx-1' }]);
      delete globalThis.__CF_ENV__;
    });

    test('throws without connecting when the pool is not configured', async () => {
      dbPool.pool = null;
      await expect(dbPool.withTransaction(async () => 1)).rejects.toThrow(dbPool.NOT_CONFIGURED_MESSAGE);
    });
  });

  describe('query invalidations across domain tables', () => {
    test('invalidates respective tags on INSERT/UPDATE/DELETE across domain tables', async () => {
      dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      const invalidateSpy = jest.spyOn(dbPool.queryCache, 'invalidate');

      await dbPool.query('INSERT INTO vendors (id, name) VALUES ($1, $2)', ['v1', 'Acme']);
      expect(invalidateSpy).toHaveBeenCalledWith('vendors');

      await dbPool.query('UPDATE buyer_accounts SET status = $1 WHERE id = $2', ['active', 'b1']);
      expect(invalidateSpy).toHaveBeenCalledWith('buyer_accounts');

      await dbPool.query('DELETE FROM evaluations WHERE id = $1', ['e1']);
      expect(invalidateSpy).toHaveBeenCalledWith('evaluations');

      await dbPool.query('INSERT INTO vendor_catalogue (id, sku) VALUES ($1, $2)', ['c1', 'SKU-1']);
      expect(invalidateSpy).toHaveBeenCalledWith('catalogue');

      await dbPool.query('UPDATE category_division SET division = $1 WHERE uuid = $2', ['IT', 'cat-1']);
      expect(invalidateSpy).toHaveBeenCalledWith('taxonomy');

      await dbPool.query('DELETE FROM ai_feed WHERE id = $1', ['f1']);
      expect(invalidateSpy).toHaveBeenCalledWith('ai_feed');

      invalidateSpy.mockRestore();
    });
  });

  // ── Health reporting ──────────────────────────────────────────────────────
  describe('checkDatabaseHealth', () => {
    let originalPool;
    let originalEnv;

    beforeEach(() => {
      originalPool = dbPool.pool;
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      dbPool.pool = originalPool;
      process.env = originalEnv;
    });

    test('reports the not-configured state without touching the network', async () => {
      dbPool.pool = null;
      delete process.env.DATABASE_URL;

      const health = await dbPool.checkDatabaseHealth();

      expect(health).toMatchObject({
        isConfigured: false,
        isConnected: false,
        provider: 'not_configured',
        poolStatus: 'NOT_CONFIGURED',
        userCount: 0,
        vendorCount: 0,
        rfqCount: 0,
      });
      expect(health.errorMessage).toContain('DATABASE_URL');
    });

    test('labels a neon.tech host as neon and reports account/vendor/RFQ counts', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/neondb';
      // One round trip, not three — the counts come from a single query.
      dbPool.pool = {
        query: jest
          .fn()
          .mockResolvedValue({ rows: [{ user_count: '7', vendor_count: '5', rfq_count: '3' }] }),
      };

      const health = await dbPool.checkDatabaseHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: true,
        provider: 'neon',
        database: 'neondb',
        userCount: 7,
        vendorCount: 5,
        rfqCount: 3,
      });
      expect(health.providerLabel).toContain('Neon');
      expect(health.poolStatus).toContain('ACTIVE');
      expect(typeof health.latencyMs).toBe('number');
      expect(dbPool.pool.query).toHaveBeenCalledTimes(1);
    });

    test('labels a non-neon host as plain postgres', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@somehost.example.com/db';
      dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };

      const health = await dbPool.checkDatabaseHealth();

      expect(health.provider).toBe('postgres');
      expect(health.providerLabel).not.toContain('Neon');
    });

    test('defaults counts to 0 when the count row is absent', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

      await expect(dbPool.checkDatabaseHealth()).resolves.toMatchObject({
        userCount: 0,
        vendorCount: 0,
        rfqCount: 0,
      });
    });

    test('reports an unreachable connection with the driver message', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      dbPool.pool = { query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

      const health = await dbPool.checkDatabaseHealth();

      expect(health).toMatchObject({
        isConfigured: true,
        isConnected: false,
        poolStatus: 'UNREACHABLE',
        errorMessage: 'ECONNREFUSED',
        userCount: 0,
        vendorCount: 0,
        rfqCount: 0,
      });
    });

    test('falls back to a generic message when the error carries none', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      dbPool.pool = { query: jest.fn().mockRejectedValue(new Error('')) };

      await expect(dbPool.checkDatabaseHealth()).resolves.toMatchObject({
        errorMessage: 'Database connection failed.',
      });
    });

    // Regression coverage for a real production incident: confirmed live via
    // `wrangler tail` that this query occasionally hangs indefinitely (Neon
    // compute cold-starting, or a stalled socket the pool's own
    // connectionTimeoutMillis doesn't cover, since that only bounds
    // acquiring a connection, not a query already in flight on one) — the
    // Workers runtime then hard-kills the whole request with an opaque
    // "hung" error instead of this function's normal isConnected:false
    // response. A hard timeout turns that into the same clean response every
    // other failure gets.
    test('reports unreachable instead of hanging forever when the query never resolves', async () => {
      jest.useFakeTimers();
      process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/db';
      dbPool.pool = { query: jest.fn(() => new Promise(() => {})) }; // never resolves

      const healthPromise = dbPool.checkDatabaseHealth();
      jest.advanceTimersByTime(8000);
      const health = await healthPromise;

      expect(health).toMatchObject({
        isConnected: false,
        poolStatus: 'UNREACHABLE',
        errorMessage: 'Database health check timed out after 8000ms',
      });
      jest.useRealTimers();
    });

    // Regression coverage: checkDatabaseHealth used to call query() with no
    // { d1: true } option, so on a real Cloudflare Worker (D1 binding
    // present) it silently fell through to the Neon pg pool below instead —
    // reporting reachability/counts from an unrelated leftover Neon database
    // rather than the D1 store vendors/rfqs/user actually live in. These
    // tests mock d1Bridge directly (the pg pool path can't tell us whether
    // D1 was actually consulted).
    describe('when a D1 binding is available (Cloudflare Workers)', () => {
      afterEach(() => {
        jest.dontMock('../src/db/d1Bridge');
        jest.resetModules();
      });

      test('reports counts from D1, not the Neon pg pool, and never touches pg', async () => {
        jest.resetModules();
        const pgQuery = jest.fn();
        const queryD1 = jest.fn().mockResolvedValue({ rows: [{ user_count: '11', vendor_count: '84', rfq_count: '28' }] });
        jest.doMock('../src/db/d1Bridge', () => ({
          getD1Binding: jest.fn().mockReturnValue({ id: 'fake-d1' }),
          queryD1,
        }));
        jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: pgQuery, on: jest.fn() })) }));
        process.env.DATABASE_URL = 'postgres://user:pass@ep.neon.tech/neondb';
        const freshPool = require('../src/db/pool');

        const health = await freshPool.checkDatabaseHealth();

        expect(health).toMatchObject({
          isConfigured: true,
          isConnected: true,
          provider: 'cloudflare_d1',
          providerLabel: 'Cloudflare D1',
          database: 'enterprise-qua-d1',
          userCount: 11,
          vendorCount: 84,
          rfqCount: 28,
        });
        expect(queryD1).toHaveBeenCalledWith({ id: 'fake-d1' }, expect.stringContaining('from vendors'));
        expect(pgQuery).not.toHaveBeenCalled();
        jest.dontMock('pg');
      });

      test('reports unreachable when the D1 query itself fails, without falling back to pg', async () => {
        jest.resetModules();
        const pgQuery = jest.fn();
        jest.doMock('../src/db/d1Bridge', () => ({
          getD1Binding: jest.fn().mockReturnValue({ id: 'fake-d1' }),
          queryD1: jest.fn().mockRejectedValue(new Error('D1_ERROR: table not found')),
        }));
        jest.doMock('pg', () => ({ Pool: jest.fn(() => ({ query: pgQuery, on: jest.fn() })) }));
        const freshPool = require('../src/db/pool');

        const health = await freshPool.checkDatabaseHealth();

        expect(health).toMatchObject({
          isConfigured: true,
          isConnected: false,
          provider: 'cloudflare_d1',
          poolStatus: 'UNREACHABLE',
          errorMessage: 'D1_ERROR: table not found',
        });
        expect(pgQuery).not.toHaveBeenCalled();
        jest.dontMock('pg');
      });

      test('times out cleanly instead of hanging when the D1 query never resolves', async () => {
        jest.resetModules();
        jest.useFakeTimers();
        jest.doMock('../src/db/d1Bridge', () => ({
          getD1Binding: jest.fn().mockReturnValue({ id: 'fake-d1' }),
          queryD1: jest.fn(() => new Promise(() => {})),
        }));
        const freshPool = require('../src/db/pool');

        const healthPromise = freshPool.checkDatabaseHealth();
        jest.advanceTimersByTime(8000);
        const health = await healthPromise;

        expect(health).toMatchObject({
          provider: 'cloudflare_d1',
          isConnected: false,
          errorMessage: 'Database health check timed out after 8000ms',
        });
        jest.useRealTimers();
      });
    });
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────
  describe('closePool', () => {
    let originalPool;

    beforeEach(() => {
      originalPool = dbPool.pool;
    });

    afterEach(() => {
      dbPool.pool = originalPool;
    });

    test('ends the pool and clears the reference', async () => {
      const end = jest.fn().mockResolvedValue(undefined);
      dbPool.pool = { end };

      await dbPool.closePool();

      expect(end).toHaveBeenCalled();
      expect(dbPool.pool).toBeNull();
    });

    test('is a no-op when there is no pool', async () => {
      dbPool.pool = null;
      await expect(dbPool.closePool()).resolves.toBeUndefined();
    });
  });
});
