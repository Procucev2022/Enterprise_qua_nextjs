const poolModule = require('../src/db/pool');
const queries = require('../src/db/queries');
const { queryCache } = require('../src/db/queryCache');

describe('Database Queries Layer Unit Tests', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
    queryCache.clear();
  });

  afterEach(() => {
    poolModule.pool = originalPool;
    queryCache.clear();
    jest.restoreAllMocks();
  });

  test('Queries return empty arrays or do nothing when pool is null', async () => {
    poolModule.pool = null;

    expect(await queries.getBuyerAccountsFromDB()).toEqual([]);
    expect(await queries.upsertBuyerAccountInDB({})).toBeUndefined();
    expect(await queries.deleteBuyerAccountInDB('b-1')).toBeUndefined();
    expect(await queries.getVendorsFromDB()).toEqual([]);
    expect(await queries.upsertVendorInDB({})).toBeUndefined();
    expect(await queries.deleteVendorInDB('v-1')).toBeUndefined();
    expect(await queries.getRFQsFromDB()).toEqual([]);
    expect(await queries.upsertRFQInDB({})).toBeUndefined();
    expect(await queries.getEvaluationsFromDB()).toEqual([]);
    expect(await queries.upsertEvaluationInDB({})).toBeUndefined();
    expect(await queries.getAuditLogsFromDB()).toEqual([]);
    expect(await queries.insertAuditLogInDB({})).toBeUndefined();
    expect(await queries.getSystemConfigFromDB()).toBeNull();
    expect(await queries.upsertSystemConfigInDB({})).toBeUndefined();
  });

  test('Queries execute SQL statements and utilize QueryCache on subsequent reads', async () => {
    poolModule.pool = {};
    const querySpy = jest.spyOn(poolModule, 'query').mockImplementation(async (sql, params) => {
      if (sql.includes('buyer_accounts')) {
        return { rows: [{ id: 'buyer-1', organizationName: 'L&T' }] };
      }
      if (sql.includes('vendors')) {
        return {
          rows: [
            {
              id: 'vendor-1',
              name: 'Apex Supplies',
              minorCategories: JSON.stringify(['Pumps']),
              clientMappedCategories: JSON.stringify(['Valves']),
              vendorSelectedCategories: JSON.stringify(['Electrical']),
            },
          ],
        };
      }
      if (sql.includes('rfqs')) {
        return {
          rows: [
            {
              id: 'rfq-1',
              rfqNumber: 'RFQ-2026-00421',
              lineItems: JSON.stringify([{ id: 'li-1', itemName: 'Pump' }]),
              quotes: JSON.stringify([{ vendorName: 'Apex', totalPrice: 50000 }]),
              assignedVendors: JSON.stringify(['vendor-1']),
              tags: JSON.stringify(['Mechanical']),
            },
          ],
        };
      }
      if (sql.includes('vendor_evaluations')) {
        return {
          rows: [
            {
              id: 'eval-1',
              moduleScores: JSON.stringify({ commercial: { score: 90 } }),
              verifiedClaims: JSON.stringify(['ISO 9001']),
            },
          ],
        };
      }
      if (sql.includes('audit_logs')) {
        return { rows: [{ id: 'log-1', action: 'CREATE_RFQ', payload: JSON.stringify({ rfq: 'RFQ-1' }) }] };
      }
      if (sql.includes('system_config')) {
        return {
          rows: [{ value: { activeMode: 'mode_1' } }],
        };
      }
      return { rows: [] };
    });

    // 1. Buyer accounts (First call DB query, Second call Cache hit)
    const buyers1 = await queries.getBuyerAccountsFromDB();
    expect(buyers1).toHaveLength(1);
    const buyers2 = await queries.getBuyerAccountsFromDB();
    expect(buyers2).toHaveLength(1);

    await queries.upsertBuyerAccountInDB({
      id: 'buyer-1',
      organizationName: 'L&T',
    });
    await queries.deleteBuyerAccountInDB('buyer-1');

    // 2. Vendors (First call DB query, Second call Cache hit)
    const vendors1 = await queries.getVendorsFromDB();
    expect(vendors1).toHaveLength(1);
    const vendors2 = await queries.getVendorsFromDB();
    expect(vendors2).toHaveLength(1);

    await queries.upsertVendorInDB({
      id: 'vendor-1',
      name: 'Apex',
    });
    await queries.deleteVendorInDB('vendor-1');

    // 3. RFQs (First call DB query, Second call Cache hit)
    const rfqs1 = await queries.getRFQsFromDB();
    expect(rfqs1).toHaveLength(1);
    const rfqs2 = await queries.getRFQsFromDB();
    expect(rfqs2).toHaveLength(1);

    await queries.upsertRFQInDB({
      id: 'rfq-1',
      rfqNumber: 'RFQ-1',
    });

    // 4. Evaluations (First call DB query, Second call Cache hit)
    const evals1 = await queries.getEvaluationsFromDB();
    expect(evals1).toHaveLength(1);
    const evals2 = await queries.getEvaluationsFromDB();
    expect(evals2).toHaveLength(1);

    await queries.upsertEvaluationInDB({
      id: 'eval-1',
      vendorName: 'Apex',
    });

    // 5. Audit logs (First call DB query, Second call Cache hit)
    const logs1 = await queries.getAuditLogsFromDB();
    expect(logs1).toHaveLength(1);
    const logs2 = await queries.getAuditLogsFromDB();
    expect(logs2).toHaveLength(1);

    await queries.insertAuditLogInDB({
      id: 'log-1',
      action: 'LOGIN',
    });

    // 6. System Config (First call DB query, Second call Cache hit)
    const config1 = await queries.getSystemConfigFromDB();
    expect(config1).toBeDefined();
    const config2 = await queries.getSystemConfigFromDB();
    expect(config2).toBeDefined();

    await queries.upsertSystemConfigInDB({ activeMode: 'mode_2' });

    // Verify query cache hit ratio increased
    const metrics = queryCache.getMetrics();
    expect(metrics.hits).toBeGreaterThanOrEqual(6);
  });
});
