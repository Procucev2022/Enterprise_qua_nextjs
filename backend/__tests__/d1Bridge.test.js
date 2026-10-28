describe('d1Bridge', () => {
  const originalCfEnv = globalThis.__CF_ENV__;
  const originalWaitUntil = globalThis.__CF_WAIT_UNTIL__;

  afterEach(() => {
    jest.resetModules();
    globalThis.__CF_ENV__ = originalCfEnv;
    globalThis.__CF_WAIT_UNTIL__ = originalWaitUntil;
  });

  describe('getD1Binding', () => {
    it('returns null when globalThis.__CF_ENV__ was never set (Node/Render)', () => {
      delete globalThis.__CF_ENV__;
      const { getD1Binding } = require('../src/db/d1Bridge');
      expect(getD1Binding()).toBeNull();
    });

    // worker.mjs is the only real ESM file in the backend, and it's the only
    // place that can do `import { env } from 'cloudflare:workers'` — a
    // require() of that specifier anywhere else throws "Dynamic require of
    // 'cloudflare:workers' is not supported" under the Workers bundler. So
    // worker.mjs stashes it on globalThis.__CF_ENV__ once at module load, and
    // this file reads that back instead of importing/requiring the
    // cloudflare: specifier itself.
    it('returns env.DB when worker.mjs has stashed the binding on globalThis', () => {
      const fakeDb = { prepare: jest.fn() };
      globalThis.__CF_ENV__ = { DB: fakeDb };
      const { getD1Binding } = require('../src/db/d1Bridge');
      expect(getD1Binding()).toBe(fakeDb);
    });

    it('returns null when globalThis.__CF_ENV__ is set but has no DB binding', () => {
      globalThis.__CF_ENV__ = {};
      const { getD1Binding } = require('../src/db/d1Bridge');
      expect(getD1Binding()).toBeNull();
    });
  });

  describe('getWaitUntil', () => {
    it('returns null when globalThis.__CF_WAIT_UNTIL__ was never set (Node/Render)', () => {
      delete globalThis.__CF_WAIT_UNTIL__;
      const { getWaitUntil } = require('../src/db/d1Bridge');
      expect(getWaitUntil()).toBeNull();
    });

    // Same reasoning as getD1Binding: worker.mjs is the only file that can
    // `import { waitUntil } from 'cloudflare:workers'`, so it stashes the
    // function on globalThis for this file to read back.
    it('returns the stashed waitUntil function when worker.mjs has set it', () => {
      const fakeWaitUntil = jest.fn();
      globalThis.__CF_WAIT_UNTIL__ = fakeWaitUntil;
      const { getWaitUntil } = require('../src/db/d1Bridge');
      expect(getWaitUntil()).toBe(fakeWaitUntil);
    });
  });

  describe('toD1Sql', () => {
    it('converts Postgres $-placeholders to D1 ? placeholders', () => {
      const { toD1Sql } = require('../src/db/d1Bridge');
      expect(toD1Sql('select * from t where a = $1 and b = $2')).toBe(
        'select * from t where a = ? and b = ?'
      );
    });

    it('leaves a query with no placeholders unchanged', () => {
      const { toD1Sql } = require('../src/db/d1Bridge');
      expect(toD1Sql('select * from t')).toBe('select * from t');
    });
  });

  describe('queryD1', () => {
    it('binds params and returns rows from D1 .all()', async () => {
      const all = jest.fn().mockResolvedValue({ results: [{ id: 1 }] });
      const bind = jest.fn().mockReturnValue({ all });
      const prepare = jest.fn().mockReturnValue({ bind });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      const result = await queryD1(db, 'select * from t where a = $1', ['x']);

      expect(prepare).toHaveBeenCalledWith('select * from t where a = ?');
      expect(bind).toHaveBeenCalledWith('x');
      expect(result).toEqual({ rows: [{ id: 1 }] });
    });

    // Found live against the deployed Worker: the Invite Vendors "All
    // Vendors" search hit "D1_ERROR: Wrong number of parameter bindings for
    // SQL query." getVendorsPageFromDB's search condition references $1
    // four times (one value, four ILIKE/LIKE clauses) — valid Postgres, but
    // toD1Sql's blind text replace turns each of those four $1s into a
    // separate ? placeholder while only one value was ever bound for them.
    it('expands a value referenced by the same $n more than once to one bound value per occurrence', async () => {
      const all = jest.fn().mockResolvedValue({ results: [] });
      const bind = jest.fn().mockReturnValue({ all });
      const prepare = jest.fn().mockReturnValue({ bind });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      await queryD1(
        db,
        'select * from vendors where (lower(a) like lower($1) or lower(b) like lower($1)) and c = $2',
        ['%needle%', 'exact']
      );

      expect(prepare).toHaveBeenCalledWith(
        'select * from vendors where (lower(a) like lower(?) or lower(b) like lower(?)) and c = ?'
      );
      // $1 appears twice, so its value is bound twice, in occurrence order,
      // then $2's value once — three ? placeholders, three bound values.
      expect(bind).toHaveBeenCalledWith('%needle%', '%needle%', 'exact');
    });

    it('skips bind() when there are no params', async () => {
      const all = jest.fn().mockResolvedValue({ results: [] });
      const prepare = jest.fn().mockReturnValue({ all });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      const result = await queryD1(db, 'select * from t');

      expect(all).toHaveBeenCalled();
      expect(result).toEqual({ rows: [] });
    });

    it('falls back to an empty rows array and undefined rowCount when D1 returns no meta/results', async () => {
      const all = jest.fn().mockResolvedValue({});
      const prepare = jest.fn().mockReturnValue({ all });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      const result = await queryD1(db, 'select * from t');

      expect(result).toEqual({ rows: [], rowCount: undefined });
    });

    it('reports rowCount from D1 meta.changes for an INSERT/UPDATE/DELETE', async () => {
      const all = jest.fn().mockResolvedValue({ results: [], meta: { changes: 1 } });
      const bind = jest.fn().mockReturnValue({ all });
      const prepare = jest.fn().mockReturnValue({ bind });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      const result = await queryD1(db, 'delete from t where id = $1', ['x']);

      expect(result).toEqual({ rows: [], rowCount: 1 });
    });

    it('binds params directly when query already uses ? placeholders', async () => {
      const all = jest.fn().mockResolvedValue({ results: [{ id: 1 }] });
      const bind = jest.fn().mockReturnValue({ all });
      const prepare = jest.fn().mockReturnValue({ bind });
      const db = { prepare };

      const { queryD1, expandD1Params } = require('../src/db/d1Bridge');
      expect(expandD1Params('select * from t where id = ?', ['abc'])).toEqual(['abc']);

      const result = await queryD1(db, 'select * from t where id = ?', ['abc']);
      expect(prepare).toHaveBeenCalledWith('select * from t where id = ?');
      expect(bind).toHaveBeenCalledWith('abc');
      expect(result).toEqual({ rows: [{ id: 1 }] });
    });
  });

  describe('getD1HttpClient', () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };

    afterEach(() => {
      global.fetch = originalFetch;
      process.env = { ...originalEnv };
    });

    it('returns null when CLOUDFLARE_ACCOUNT_ID/D1_DATABASE_ID/API_TOKEN are not all set', () => {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_D1_DATABASE_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      const { getD1HttpClient } = require('../src/db/d1Bridge');
      expect(getD1HttpClient()).toBeNull();
    });

    // Real bug, found live: execHttp (the raw REST call) returns a pg-like
    // {rows, rowCount} shape, kept as-is since scripts/test-rfq-sms.js calls
    // it directly and depends on that shape — but queryD1() (used for both
    // the native Workers binding and this HTTP shim) reads the native D1
    // binding's real {results, meta} shape. Without translating between the
    // two inside prepare().bind().all(), every `{d1:true}` query run through
    // this client silently returned zero rows with no error, since
    // `result.results` was always undefined on the {rows, rowCount} shape.
    it('queryD1 against the HTTP client shim returns real rows, not an empty array', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              result: [{ results: [{ email: 'a@b.com' }], success: true, meta: { changes: 0 } }],
            })
          ),
      });

      const { getD1HttpClient, queryD1 } = require('../src/db/d1Bridge');
      const client = getD1HttpClient();
      const result = await queryD1(client, 'select email from "user" where a = $1', ['x']);

      expect(result).toEqual({ rows: [{ email: 'a@b.com' }], rowCount: 0 });
    });

    it('_execHttp (used directly by scripts/test-rfq-sms.js) still returns its own {rows, rowCount} shape', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              result: [{ results: [{ id: 'rfq-1' }], success: true, meta: { changes: 0 } }],
            })
          ),
      });

      const { getD1HttpClient } = require('../src/db/d1Bridge');
      const client = getD1HttpClient();
      const result = await client._execHttp('select id from rfqs where rfq_number = ?', ['RFQ-1']);

      expect(result).toEqual({ rows: [{ id: 'rfq-1' }], rowCount: 0 });
    });

    it('handles non-JSON error response from D1 HTTP API', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad Gateway Error HTML'),
      });

      const { getD1HttpClient } = require('../src/db/d1Bridge');
      const client = getD1HttpClient();
      await expect(client._execHttp('select 1')).rejects.toThrow('D1 HTTP API returned non-JSON (502): Bad Gateway Error HTML');
    });

    it('handles D1 HTTP API error messages from json.errors or raw body', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve(JSON.stringify({ success: false, errors: [{ message: 'Syntax error' }] })),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve(JSON.stringify({ success: false })),
        });

      const { getD1HttpClient, resetD1HttpClientCache } = require('../src/db/d1Bridge');
      resetD1HttpClientCache();
      const client = getD1HttpClient();
      await expect(client._execHttp('select bad')).rejects.toThrow('D1 HTTP query failed (400): Syntax error');
      await expect(client._execHttp('select bad2')).rejects.toThrow('D1 HTTP query failed (403):');
    });

    it('supports prepare().all() without bind and batchHttp on the HTTP client', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              result: [{ results: [{ ok: 1 }], meta: { changes: 1 } }],
            })
          ),
      });

      const { getD1HttpClient, resetD1HttpClientCache } = require('../src/db/d1Bridge');
      resetD1HttpClientCache();
      const client = getD1HttpClient();
      const direct = await client.prepare('select 1').all();
      expect(direct).toEqual({ results: [{ ok: 1 }], success: true, meta: { changes: 1 } });

      const batchRes = await client.batch([client.prepare('update t set a = 1')]);
      expect(batchRes).toHaveLength(1);
      expect(batchRes[0]).toEqual({ rows: [{ ok: 1 }], rowCount: 1 });
    });
  });

  describe('batchD1', () => {
    it('executes statements as a batch against workers binding and maps results', async () => {
      const batchMock = jest.fn().mockResolvedValue([
        { results: [{ id: 1 }], meta: { changes: 1 } },
        { results: [], meta: { changes: 0 } },
      ]);
      const bindMock = jest.fn().mockReturnValue({});
      const prepareMock = jest.fn().mockImplementation((sql) => ({
        bind: bindMock,
      }));
      const db = { prepare: prepareMock, batch: batchMock };

      const { batchD1 } = require('../src/db/d1Bridge');
      const results = await batchD1(db, [
        { text: 'insert into t (id) values ($1)', params: [1] },
        { text: 'delete from t where id = $1', params: [2] },
      ]);

      expect(batchMock).toHaveBeenCalled();
      expect(results).toEqual([
        { rows: [{ id: 1 }], rowCount: 1 },
        { rows: [], rowCount: 0 },
      ]);
    });

    it('handles batch results that already have rows/rowCount (HTTP client)', async () => {
      const batchMock = jest.fn().mockResolvedValue([
        { rows: [{ id: 10 }], rowCount: 1 },
      ]);
      const db = {
        prepare: jest.fn().mockReturnValue({}),
        batch: batchMock,
      };

      const { batchD1 } = require('../src/db/d1Bridge');
      const results = await batchD1(db, [{ text: 'select 1' }]);
      expect(results).toEqual([{ rows: [{ id: 10 }], rowCount: 1 }]);
    });
  });

  describe('edge cases', () => {
    it('returns cached _d1HttpClient on subsequent calls', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      const { getD1HttpClient, resetD1HttpClientCache } = require('../src/db/d1Bridge');
      resetD1HttpClientCache();
      const client1 = getD1HttpClient();
      const client2 = getD1HttpClient();
      expect(client1).toBe(client2);
    });

    it('handles non-array json.result and empty result in execHttp', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'db-1';
      process.env.CLOUDFLARE_API_TOKEN = 'token-1';
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ success: true, result: { results: [{ x: 1 }], meta: { changes: 1 } } })),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ success: true, result: null })),
        });

      const { getD1HttpClient, resetD1HttpClientCache } = require('../src/db/d1Bridge');
      resetD1HttpClientCache();
      const client = getD1HttpClient();
      const res1 = await client._execHttp('select 1');
      expect(res1).toEqual({ rows: [{ x: 1 }], rowCount: 1 });

      const res2 = await client._execHttp('select 2');
      expect(res2).toEqual({ rows: [], rowCount: undefined });
    });

    it('handles batch results with missing results/meta', async () => {
      const batchMock = jest.fn().mockResolvedValue([{}]);
      const db = { prepare: jest.fn().mockReturnValue({}), batch: batchMock };
      const { batchD1 } = require('../src/db/d1Bridge');
      const results = await batchD1(db, [{ text: 'select 1' }]);
      expect(results).toEqual([{ rows: [], rowCount: undefined }]);
    });

    it('expandD1Params handles default params and non-array params', () => {
      const { expandD1Params } = require('../src/db/d1Bridge');
      expect(expandD1Params('select 1')).toEqual([]);
      expect(expandD1Params('select 1', null)).toEqual([]);
    });

    it('catches and returns null when globalThis access throws', () => {
      const { getD1Binding, getWaitUntil } = require('../src/db/d1Bridge');
      const origEnv = Object.getOwnPropertyDescriptor(globalThis, '__CF_ENV__');
      Object.defineProperty(globalThis, '__CF_ENV__', {
        get() { throw new Error('Simulated access error'); },
        configurable: true,
      });
      expect(getD1Binding()).toBeNull();
      if (origEnv) {
        Object.defineProperty(globalThis, '__CF_ENV__', origEnv);
      } else {
        delete globalThis.__CF_ENV__;
      }

      const origWait = Object.getOwnPropertyDescriptor(globalThis, '__CF_WAIT_UNTIL__');
      Object.defineProperty(globalThis, '__CF_WAIT_UNTIL__', {
        get() { throw new Error('Simulated access error'); },
        configurable: true,
      });
      expect(getWaitUntil()).toBeNull();
      if (origWait) {
        Object.defineProperty(globalThis, '__CF_WAIT_UNTIL__', origWait);
      } else {
        delete globalThis.__CF_WAIT_UNTIL__;
      }
    });
  });
});
