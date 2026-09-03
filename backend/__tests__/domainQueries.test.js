const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('Domain queries (vendors + RFQs, Neon PostgreSQL)', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
  });

  afterEach(() => {
    pool.pool = originalPool;
    jest.restoreAllMocks();
  });

  describe('not configured', () => {
    beforeEach(() => {
      pool.pool = null;
    });

    test('getVendorsFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([]);
    });

    test('upsertVendorInDB returns null', async () => {
      await expect(domainQueries.upsertVendorInDB({ id: 'v-1' })).resolves.toBeNull();
    });

    test('deleteVendorInDB returns false', async () => {
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(false);
    });

    test('getRFQsFromDB returns an empty array', async () => {
      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([]);
    });

    test('upsertRFQInDB returns null', async () => {
      await expect(domainQueries.upsertRFQInDB({ id: 'rfq-1' })).resolves.toBeNull();
    });

    test('deleteRFQInDB returns false', async () => {
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(false);
    });
  });

  describe('vendors', () => {
    test('getVendorsFromDB maps rows to their raw objects, newest first', async () => {
      const vendor = { id: 'v-1', name: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await expect(domainQueries.getVendorsFromDB()).resolves.toEqual([vendor]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertVendorInDB serializes the vendor and returns the stored raw row', async () => {
      const vendor = {
        id: 'v-1',
        email: 'v@x.com',
        majorCategory: 'Mechanical',
        status: 'ACTIVE',
        source: 'buyer_manual',
        name: 'Apex',
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      const result = await domainQueries.upsertVendorInDB(vendor);

      expect(result).toEqual(vendor);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['v-1', 'v@x.com', 'Mechanical', 'ACTIVE', 'buyer_manual', JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB falls back missing nullable fields to null', async () => {
      const vendor = { id: 'v-2', name: 'Bare Vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: vendor }] }) };

      await domainQueries.upsertVendorInDB(vendor);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['v-2', null, null, null, null, JSON.stringify(vendor)]);
    });

    test('upsertVendorInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertVendorInDB({ id: 'v-3' })).resolves.toBeNull();
    });

    test('deleteVendorInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteVendorInDB('v-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendors WHERE id = $1', ['v-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteVendorInDB('v-x')).resolves.toBe(false);
    });
  });

  describe('rfqs', () => {
    test('getRFQsFromDB maps rows to their raw objects, newest first', async () => {
      const rfq = { id: 'rfq-1', title: 'Test RFQ' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await expect(domainQueries.getRFQsFromDB()).resolves.toEqual([rfq]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertRFQInDB serializes the RFQ and returns the stored raw row', async () => {
      const rfq = {
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-0001',
        category: 'Mechanical',
        status: 'open',
        sourcingMode: 'mode_1',
        budget: 1000,
      };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      const result = await domainQueries.upsertRFQInDB(rfq);

      expect(result).toEqual(rfq);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO rfqs');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['rfq-1', 'RFQ-2026-0001', 'Mechanical', 'open', 'mode_1', 1000, JSON.stringify(rfq)]);
    });

    test('upsertRFQInDB falls back a non-numeric budget to null', async () => {
      const rfq = { id: 'rfq-2', budget: 'not-a-number' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params[5]).toBeNull();
    });

    test('upsertRFQInDB falls back missing nullable fields to null', async () => {
      const rfq = { id: 'rfq-3' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: rfq }] }) };

      await domainQueries.upsertRFQInDB(rfq);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['rfq-3', null, null, null, null, null, JSON.stringify(rfq)]);
    });

    test('deleteRFQInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM rfqs WHERE id = $1', ['rfq-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteRFQInDB('rfq-x')).resolves.toBe(false);
    });
  });
});
