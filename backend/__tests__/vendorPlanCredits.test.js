const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const { VENDOR_PLAN_RFQ_QUOTA } = require('../src/config/constants');

// A Connect/Select subscriber's credit balance is their plan quota less the
// downloads used. It used to be read from the free-tier field, which stays 0
// for subscribers, so every subscriber was shown "0 credits" (e.g. a Select
// vendor with 11 downloads used saw 0 instead of 89).
describe('subscriber credit balance', () => {
  let savedVendors;
  let savedRfqs;

  beforeEach(() => {
    savedVendors = storeService.vendors;
    savedRfqs = storeService.rfqs;
    jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(true);
    jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue(true);
  });

  afterEach(() => {
    storeService.vendors = savedVendors;
    storeService.rfqs = savedRfqs;
    jest.restoreAllMocks();
  });

  test('exposes the advertised plan quotas', () => {
    expect(VENDOR_PLAN_RFQ_QUOTA).toEqual({ connect: 50, select: 100 });
  });

  test('a Select subscriber sees quota less downloads used, not the free-tier 0', () => {
    storeService.vendors = [
      { id: 'v-select', email: 'select@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 11, freeQuotationCredits: 0 },
    ];
    expect(storeService.getVendorRfqCredits('v-select')).toMatchObject({
      freeCreditsAllocated: 100,
      freeCreditsUsed: 11,
      freeCreditsRemaining: 89,
      isSubscribed: true,
      subscriptionPlan: 'select',
    });
  });

  test('a Connect subscriber with no usage yet has the full quota, and never goes negative', () => {
    storeService.vendors = [
      { id: 'v-connect', email: 'connect@plan.test', subscriptionPlan: 'connect' },
      { id: 'v-over', email: 'over@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 70, unlockedRfqIds: ['r1'] },
    ];
    expect(storeService.getVendorRfqCredits('v-connect')).toMatchObject({ freeCreditsRemaining: 50, freeCreditsUsed: 0, unlockedRfqIds: [] });
    expect(storeService.getVendorRfqCredits('v-over')).toMatchObject({ freeCreditsRemaining: 0, freeCreditsUsed: 50, unlockedRfqIds: ['r1'] });
  });

  test('a vendor without a subscription shows their free-tier balance (0 by default)', () => {
    storeService.vendors = [{ id: 'v-none', email: 'none@plan.test', subscriptionPlan: 'premium', freeQuotationCredits: 0 }];
    expect(storeService.getVendorRfqCredits('v-none')).toMatchObject({ freeCreditsRemaining: 0, isSubscribed: false });
  });

  test('an unlimited-access vendor keeps the unlimited balance whatever their plan', () => {
    storeService.vendors = [{ id: 'v-unl', email: 'unl@plan.test', subscriptionPlan: 'select', unlimitedDownloads: true }];
    expect(storeService.getVendorRfqCredits('v-unl').freeCreditsRemaining).toBe(999999);
  });

  describe('downloads counted against the plan', () => {
    const marketplaceRfq = { id: 'rfq-plan-1', rfqNumber: 'RFQ-PLAN-1', sourcingMode: 'mode_0', quotes: [] };

    test('a first-time download uses one credit and returns the new balance', async () => {
      storeService.vendors = [{ id: 'v-dl', email: 'dl@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 11, unlockedRfqIds: [] }];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-dl', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, creditCharged: 0, freeCreditsRemaining: 88 });
      expect(storeService.getVendorById('v-dl', 'all').rfqDownloadsUsed).toBe(12);
    });

    test('re-downloading an RFQ already unlocked does not use another credit', async () => {
      storeService.vendors = [
        { id: 'v-re', email: 're@plan.test', subscriptionPlan: 'select', rfqDownloadsUsed: 5, unlockedRfqIds: ['rfq-plan-1'] },
      ];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-re', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, alreadyUnlocked: true, freeCreditsRemaining: 95 });
      expect(storeService.getVendorById('v-re', 'all').rfqDownloadsUsed).toBe(5);
    });

    test("an RFQ from the vendor's own buyer is free", async () => {
      storeService.vendors = [
        { id: 'v-own', email: 'own@plan.test', subscriptionPlan: 'connect', rfqDownloadsUsed: 3, buyerId: 'buyer-own', unlockedRfqIds: [] },
      ];
      storeService.rfqs = [{ ...marketplaceRfq, id: 'rfq-own-1', buyerAccountId: 'buyer-own' }];

      const res = await storeService.unlockRFQForVendor('v-own', 'rfq-own-1');

      expect(res.success).toBe(true);
      expect(storeService.getVendorById('v-own', 'all').rfqDownloadsUsed).toBe(3);
    });

    test('a free-tier download also records the download count', async () => {
      storeService.vendors = [{ id: 'v-free', email: 'free@plan.test', freeQuotationCredits: 2, unlockedRfqIds: [] }];
      storeService.rfqs = [marketplaceRfq];

      const res = await storeService.unlockRFQForVendor('v-free', 'rfq-plan-1');

      expect(res).toMatchObject({ success: true, creditCharged: 1, freeCreditsRemaining: 1 });
      expect(storeService.getVendorById('v-free', 'all').rfqDownloadsUsed).toBe(1);
    });
  });
});

describe('Payment Dues low-credit monitoring for subscribers', () => {
  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(paymentDuesQueries, 'fetchRawBuyers').mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  test('lists a subscriber only when their plan balance is low, not because the free-tier field is 0', async () => {
    jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
      { id: 'v-healthy', name: 'Healthy Select', subscriptionPlan: 'select', rfqDownloadsUsed: 11, freeQuotationCredits: 0 },
      { id: 'v-low', name: 'Low Connect', subscriptionPlan: 'connect', rfqDownloadsUsed: 49, freeQuotationCredits: 0 },
    ]);

    // A database is configured, and its communication table has no rows for these accounts.
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    const result = await paymentDuesQueries.getLowCreditAccounts();
    const rows = result.data || result.accounts || result;
    const ids = rows.map((a) => a.accountId);

    expect(ids).not.toContain('v-healthy');
    expect(ids).toContain('v-low');
    expect(rows.find((a) => a.accountId === 'v-low')).toMatchObject({ totalCredits: 50 });
  });

  test('refuses to list low-credit accounts when no database is configured', async () => {
    jest.spyOn(paymentDuesQueries, 'fetchRawVendors').mockResolvedValue([
      { id: 'v-low', name: 'Low Connect', subscriptionPlan: 'connect', rfqDownloadsUsed: 49, freeQuotationCredits: 0 },
    ]);

    await expect(paymentDuesQueries.getLowCreditAccounts()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  });
});
