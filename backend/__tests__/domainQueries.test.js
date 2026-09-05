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

    test('bulkInsertVendorsInDB returns an empty array', async () => {
      await expect(domainQueries.bulkInsertVendorsInDB([{ id: 'v-1', email: 'a@x.com' }])).resolves.toEqual([]);
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

    test('getEvaluationsFromDB returns an empty array', async () => {
      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([]);
    });

    test('upsertEvaluationInDB returns null', async () => {
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-1' })).resolves.toBeNull();
    });

    test('getVendorCatalogueFromDB returns an empty array', async () => {
      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([]);
    });

    test('upsertCatalogueProductInDB returns null', async () => {
      await expect(domainQueries.upsertCatalogueProductInDB({ id: 'prod-1' })).resolves.toBeNull();
    });

    test('deleteCatalogueProductInDB returns false', async () => {
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(false);
    });

    test('getBuyerAccountsFromDB returns an empty accounts list and null activeId', async () => {
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [], activeId: null });
    });

    test('upsertBuyerAccountInDB returns null', async () => {
      await expect(domainQueries.upsertBuyerAccountInDB({ id: 'buyer-1' })).resolves.toBeNull();
    });

    test('deleteBuyerAccountInDB returns false', async () => {
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB resolves without querying', async () => {
      await expect(domainQueries.setActiveBuyerAccountInDB('buyer-1')).resolves.toBeUndefined();
    });

    test('getAIFeedFromDB returns an empty array', async () => {
      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([]);
    });

    test('upsertAIFeedItemInDB returns null', async () => {
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-1' })).resolves.toBeNull();
    });

    test('getAuditLogsFromDB returns an empty array', async () => {
      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([]);
    });

    test('upsertAuditLogInDB returns null', async () => {
      await expect(domainQueries.upsertAuditLogInDB({ id: 'log-1' })).resolves.toBeNull();
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

    test('bulkInsertVendorsInDB returns [] without querying when the batch is empty', async () => {
      pool.pool = { query: jest.fn() };
      await expect(domainQueries.bulkInsertVendorsInDB([])).resolves.toEqual([]);
      expect(pool.pool.query).not.toHaveBeenCalled();
    });

    test('bulkInsertVendorsInDB builds one multi-row INSERT with ON CONFLICT (email) DO NOTHING and returns the emails that landed', async () => {
      const v1 = { id: 'v-1', email: 'a@x.com', majorCategory: 'Mechanical', status: 'REGISTERED / NOT EVALUATED', source: 'excel' };
      const v2 = { id: 'v-2', email: 'b@x.com', name: 'Bare' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ email: 'a@x.com' }] }) };

      const result = await domainQueries.bulkInsertVendorsInDB([v1, v2]);

      expect(result).toEqual(['a@x.com']);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendors');
      expect(sql).toContain('ON CONFLICT (email) DO NOTHING');
      expect(sql).toContain('($1, $2, $3, $4, $5, $6, now())');
      expect(sql).toContain('($7, $8, $9, $10, $11, $12, now())');
      expect(params).toEqual([
        'v-1', 'a@x.com', 'Mechanical', 'REGISTERED / NOT EVALUATED', 'excel', JSON.stringify(v1),
        'v-2', 'b@x.com', null, null, null, JSON.stringify(v2),
      ]);
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

  describe('evaluations', () => {
    test('getEvaluationsFromDB maps rows to their raw objects, newest first', async () => {
      const evaluation = { id: 'eval-1', vendorName: 'Apex' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await expect(domainQueries.getEvaluationsFromDB()).resolves.toEqual([evaluation]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertEvaluationInDB serializes the evaluation and returns the stored raw row', async () => {
      const evaluation = { id: 'eval-1', vendorId: 'v-001', status: 'PREFERRED ENTERPRISE SUPPLIER' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      const result = await domainQueries.upsertEvaluationInDB(evaluation);

      expect(result).toEqual(evaluation);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO evaluations');
      expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
      expect(params).toEqual(['eval-1', 'v-001', 'PREFERRED ENTERPRISE SUPPLIER', JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB falls back missing nullable fields to null', async () => {
      const evaluation = { id: 'eval-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: evaluation }] }) };

      await domainQueries.upsertEvaluationInDB(evaluation);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['eval-2', null, null, JSON.stringify(evaluation)]);
    });

    test('upsertEvaluationInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertEvaluationInDB({ id: 'eval-3' })).resolves.toBeNull();
    });
  });

  describe('vendor catalogue', () => {
    test('getVendorCatalogueFromDB maps rows to their raw objects, newest first', async () => {
      const product = { id: 'prod-1', name: 'Impeller' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await expect(domainQueries.getVendorCatalogueFromDB()).resolves.toEqual([product]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), []);
    });

    test('upsertCatalogueProductInDB serializes the product and returns the stored raw row', async () => {
      const product = { id: 'prod-1', vendorId: 'v-001', sku: 'SKU-1', category: 'Pumps' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      const result = await domainQueries.upsertCatalogueProductInDB(product);

      expect(result).toEqual(product);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO vendor_catalogue');
      expect(params).toEqual(['prod-1', 'v-001', 'SKU-1', 'Pumps', JSON.stringify(product)]);
    });

    test('upsertCatalogueProductInDB falls back missing nullable fields to null', async () => {
      const product = { id: 'prod-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: product }] }) };

      await domainQueries.upsertCatalogueProductInDB(product);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['prod-2', null, null, null, JSON.stringify(product)]);
    });

    test('deleteCatalogueProductInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-1')).resolves.toBe(true);
      expect(pool.pool.query).toHaveBeenCalledWith('DELETE FROM vendor_catalogue WHERE id = $1', ['prod-1']);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteCatalogueProductInDB('prod-x')).resolves.toBe(false);
    });
  });

  describe('buyer accounts', () => {
    test('getBuyerAccountsFromDB returns accounts and the active row id', async () => {
      const acc1 = { id: 'buyer-1', organizationName: 'L&T' };
      const acc2 = { id: 'buyer-2', organizationName: 'Siemens' };
      pool.pool = {
        query: jest.fn().mockResolvedValue({
          rows: [
            { id: 'buyer-1', is_active: false, raw: acc1 },
            { id: 'buyer-2', is_active: true, raw: acc2 },
          ],
        }),
      };

      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [acc1, acc2], activeId: 'buyer-2' });
    });

    test('getBuyerAccountsFromDB returns a null activeId when no row is flagged active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'buyer-1', is_active: false, raw: { id: 'buyer-1' } }] }) };
      await expect(domainQueries.getBuyerAccountsFromDB()).resolves.toEqual({ accounts: [{ id: 'buyer-1' }], activeId: null });
    });

    test('upsertBuyerAccountInDB serializes the account and returns the stored raw row', async () => {
      const account = { id: 'buyer-1', corporateEmail: 'buyer@lt.com', status: 'ACTIVE_VERIFIED' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      const result = await domainQueries.upsertBuyerAccountInDB(account);

      expect(result).toEqual(account);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO buyer_accounts');
      expect(sql).not.toContain('is_active');
      expect(params).toEqual(['buyer-1', 'buyer@lt.com', 'ACTIVE_VERIFIED', JSON.stringify(account)]);
    });

    test('upsertBuyerAccountInDB falls back missing nullable fields to null', async () => {
      const account = { id: 'buyer-2' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: account }] }) };

      await domainQueries.upsertBuyerAccountInDB(account);

      const [, params] = pool.pool.query.mock.calls[0];
      expect(params).toEqual(['buyer-2', null, null, JSON.stringify(account)]);
    });

    test('deleteBuyerAccountInDB reports whether a row was actually removed', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-1')).resolves.toBe(true);

      pool.pool = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };
      await expect(domainQueries.deleteBuyerAccountInDB('buyer-x')).resolves.toBe(false);
    });

    test('setActiveBuyerAccountInDB flags exactly the given id active', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({}) };
      await domainQueries.setActiveBuyerAccountInDB('buyer-2');
      expect(pool.pool.query).toHaveBeenCalledWith('UPDATE buyer_accounts SET is_active = (id = $1)', ['buyer-2']);
    });
  });

  describe('AI feed', () => {
    test('getAIFeedFromDB maps rows to their raw objects, in sequence order', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: item }] }) };

      await expect(domainQueries.getAIFeedFromDB()).resolves.toEqual([item]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('upsertAIFeedItemInDB inserts the item and trims the table to the newest 100 rows', async () => {
      const item = { id: 'feed-1', title: 'Call placed' };
      const queryMock = jest.fn().mockResolvedValue({ rows: [{ raw: item }] });
      pool.pool = { query: queryMock };

      const result = await domainQueries.upsertAIFeedItemInDB(item);

      expect(result).toEqual(item);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(queryMock.mock.calls[0][0]).toContain('INSERT INTO ai_feed');
      expect(queryMock.mock.calls[0][1]).toEqual(['feed-1', JSON.stringify(item)]);
      expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM ai_feed');
      expect(queryMock.mock.calls[1][0]).toContain('LIMIT 100');
    });

    test('upsertAIFeedItemInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertAIFeedItemInDB({ id: 'feed-2' })).resolves.toBeNull();
    });
  });

  describe('audit logs', () => {
    test('getAuditLogsFromDB maps rows to their raw objects, in sequence order', async () => {
      const entry = { id: 'log-1', action: 'Created vendor' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      await expect(domainQueries.getAuditLogsFromDB()).resolves.toEqual([entry]);
      expect(pool.pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence DESC'), []);
    });

    test('upsertAuditLogInDB serializes the entry and returns the stored raw row', async () => {
      const entry = { id: 'log-1', action: 'Created vendor', shaSignature: 'abc123' };
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: entry }] }) };

      const result = await domainQueries.upsertAuditLogInDB(entry);

      expect(result).toEqual(entry);
      const [sql, params] = pool.pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toEqual(['log-1', JSON.stringify(entry)]);
    });

    test('upsertAuditLogInDB returns null when nothing came back', async () => {
      pool.pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await expect(domainQueries.upsertAuditLogInDB({ id: 'log-2' })).resolves.toBeNull();
    });
  });
});
