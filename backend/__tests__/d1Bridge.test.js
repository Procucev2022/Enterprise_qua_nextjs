describe('d1Bridge', () => {
  afterEach(() => {
    jest.resetModules();
  });

  describe('getD1Binding', () => {
    it('returns null when cloudflare:workers is not resolvable (Node/Render)', () => {
      const { getD1Binding } = require('../src/db/d1Bridge');
      expect(getD1Binding()).toBeNull();
    });

    it('returns env.DB when running under Workers with the binding configured', () => {
      const fakeDb = { prepare: jest.fn() };
      jest.doMock('cloudflare:workers', () => ({ env: { DB: fakeDb } }), { virtual: true });
      jest.resetModules();
      const { getD1Binding } = require('../src/db/d1Bridge');
      expect(getD1Binding()).toBe(fakeDb);
    });

    it('returns null when running under Workers without the DB binding', () => {
      jest.doMock('cloudflare:workers', () => ({ env: {} }), { virtual: true });
      jest.resetModules();
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

    it('falls back to an empty rows array when D1 returns no results field', async () => {
      const all = jest.fn().mockResolvedValue({});
      const prepare = jest.fn().mockReturnValue({ all });
      const db = { prepare };

      const { queryD1 } = require('../src/db/d1Bridge');
      const result = await queryD1(db, 'select * from t');

      expect(result).toEqual({ rows: [] });
    });
  });
});
