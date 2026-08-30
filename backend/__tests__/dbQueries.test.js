const poolModule = require('../src/db/pool');
const queries = require('../src/db/queries');

describe('Database Queries Layer Unit Tests', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
  });

  afterEach(() => {
    poolModule.pool = originalPool;
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

  test('Queries execute SQL statements when pool is active', async () => {
    poolModule.pool = {};
    jest.spyOn(poolModule, 'query').mockImplementation(async (sql, params) => {
      if (sql.includes('buyer_accounts')) {
        return { rows: [{ id: 'buyer-1', organizationName: 'L&T' }] };
      }
      if (sql.includes('vendors')) {
        return { rows: [{ id: 'vendor-1', name: 'Apex Supplies' }] };
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
        return { rows: [{ id: 'log-1', action: 'CREATE_RFQ' }] };
      }
      if (sql.includes('system_config')) {
        return {
          rows: [{ value: { activeMode: 'mode_1' } }],
        };
      }
      return { rows: [] };
    });

    const buyers = await queries.getBuyerAccountsFromDB();
    expect(buyers).toHaveLength(1);

    await queries.upsertBuyerAccountInDB({
      id: 'buyer-1',
      organizationName: 'L&T',
    });
    await queries.deleteBuyerAccountInDB('buyer-1');

    const vendors = await queries.getVendorsFromDB();
    expect(vendors).toHaveLength(1);

    await queries.upsertVendorInDB({
      id: 'vendor-1',
      name: 'Apex',
    });
    await queries.deleteVendorInDB('vendor-1');

    const rfqs = await queries.getRFQsFromDB();
    expect(rfqs).toHaveLength(1);

    await queries.upsertRFQInDB({
      id: 'rfq-1',
      rfqNumber: 'RFQ-1',
    });

    const evals = await queries.getEvaluationsFromDB();
    expect(evals).toHaveLength(1);

    await queries.upsertEvaluationInDB({
      id: 'eval-1',
      vendorName: 'Apex',
    });

    const logs = await queries.getAuditLogsFromDB();
    expect(logs).toHaveLength(1);

    await queries.insertAuditLogInDB({
      id: 'log-1',
      action: 'LOGIN',
    });

    const config = await queries.getSystemConfigFromDB();
    expect(config).toBeDefined();

    await queries.upsertSystemConfigInDB({ activeMode: 'mode_2' });
  });
});
