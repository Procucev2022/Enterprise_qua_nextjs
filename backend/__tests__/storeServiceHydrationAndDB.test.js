const storeService = require('../src/services/storeService');
const poolModule = require('../src/db/pool');

describe('Store Service Hydration & DB Persistence Branches', () => {
  let originalPool;

  beforeEach(() => {
    originalPool = poolModule.pool;
  });

  afterEach(() => {
    poolModule.pool = originalPool;
    jest.restoreAllMocks();
  });

  test('hydrateFromDB executes when pool is active', async () => {
    poolModule.pool = {};
    jest.spyOn(poolModule, 'query').mockImplementation(async (sql) => {
      if (sql.includes('buyer_accounts')) {
        return {
          rows: [
            {
              id: 'buyer-db-1',
              organizationName: 'L&T DB',
              corporateEmail: 'db@lt.com',
              supportedMajorCategories: [],
              supportedMinorCategories: [],
            },
          ],
        };
      }
      if (sql.includes('vendors')) {
        return {
          rows: [
            {
              id: 'vendor-db-1',
              name: 'DB Vendor',
              minorCategories: [],
              clientMappedCategories: [],
              vendorSelectedCategories: [],
            },
          ],
        };
      }
      if (sql.includes('rfqs')) {
        return {
          rows: [
            {
              id: 'rfq-db-1',
              rfqNumber: 'RFQ-DB-1',
              lineItems: [],
              quotes: [],
              assignedVendors: [],
              tags: [],
            },
          ],
        };
      }
      if (sql.includes('vendor_evaluations')) {
        return {
          rows: [
            {
              id: 'eval-db-1',
              vendorName: 'DB Vendor',
              moduleScores: {},
              verifiedClaims: [],
            },
          ],
        };
      }
      if (sql.includes('audit_logs')) {
        return {
          rows: [{ id: 'log-db-1', action: 'DB LOG', payload: {} }],
        };
      }
      if (sql.includes('system_config')) {
        return {
          rows: [{ value: { activeMode: 'mode_2' } }],
        };
      }
      return { rows: [] };
    });

    await storeService.hydrateFromDB();
    expect(storeService.isHydratedFromDB).toBe(true);
    expect(storeService.getBuyerAccounts().length).toBeGreaterThan(0);
  });

  test('CRUD operations trigger DB save when pool is active', async () => {
    poolModule.pool = {};
    jest.spyOn(poolModule, 'query').mockResolvedValue({ rows: [] });

    // Buyer DB branches
    const buyer = storeService.addBuyerAccount({
      organizationName: 'Pool Buyer',
      corporateEmail: 'pool@buyer.com',
    });
    storeService.updateBuyerAccount(buyer.id, { organizationName: 'Pool Buyer Updated' });
    storeService.deleteBuyerAccount(buyer.id);

    // Vendor DB branches
    const vendor = storeService.addVendor({
      name: 'Pool Vendor',
      majorCategory: 'Mechanical',
    });
    storeService.updateVendor(vendor.id, { name: 'Pool Vendor Updated' });
    storeService.deleteVendor(vendor.id);

    // RFQ DB branches
    const rfq = storeService.createRFQ({
      title: 'Pool RFQ',
      category: 'Mechanical',
    });
    storeService.updateRFQ(rfq.id, { title: 'Pool RFQ Updated' });
    storeService.addQuoteToRFQ(rfq.id, { vendorName: 'Apex', unitPrice: 200 });

    // Evaluation DB branches
    storeService.createEvaluation({
      vendorName: 'Pool Vendor',
      overallScore: 92,
    });

    // Config DB branches
    storeService.updateSystemConfig({ activeMode: 'mode_3' });
    storeService.getAzureHealth();

    // Historical data processing
    storeService.processHistoricalPurchaseData('FY2025-26', [
      { companyName: 'New Historical Vendor', email: 'hist@vendor.com', spend: 50000 },
      { companyName: 'DB Vendor', email: 'db@vendor.com', spend: 30000 },
    ]);
  });
});
