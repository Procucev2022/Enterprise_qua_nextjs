describe('d1Bridge', () => {
  const originalCfEnv = globalThis.__CF_ENV__;

  afterEach(() => {
    jest.resetModules();
    globalThis.__CF_ENV__ = originalCfEnv;
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
  });
});
