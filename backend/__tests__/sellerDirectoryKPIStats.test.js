const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
const directoryKPIQueries = require('../src/db/directoryKPIQueries');
const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('vendorDossierExtensions.getSellerDirectoryKPIStats', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects unauthenticated requests or unauthorized roles', async () => {
    const resNoUser = mockRes();
    await vendorDossierExtensions.getSellerDirectoryKPIStats({}, resNoUser, jest.fn());
    expect(resNoUser.status).toHaveBeenCalledWith(401);

    const resBadRole = mockRes();
    await vendorDossierExtensions.getSellerDirectoryKPIStats({ user: { role: 'vendor' } }, resBadRole, jest.fn());
    expect(resBadRole.status).toHaveBeenCalledWith(403);
  });

  it('returns live database counts for category managers and admins', async () => {
    const mockStats = {
      totalSuppliers: 1420,
      networkSuppliers: 1050,
      buyerUploaded: 370,
      verifiedActive: 980,
    };
    jest.spyOn(directoryKPIQueries, 'getSellerDirectoryKPIStatsFromDB').mockResolvedValueOnce(mockStats);

    const res = mockRes();
    await vendorDossierExtensions.getSellerDirectoryKPIStats({ user: { role: 'category_manager' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, ...mockStats });
  });

  it('handles database errors gracefully and forwards them to error handler', async () => {
    const dbErr = new Error('Database connection failed');
    jest.spyOn(directoryKPIQueries, 'getSellerDirectoryKPIStatsFromDB').mockRejectedValueOnce(dbErr);

    const next = jest.fn();
    const res = mockRes();
    await vendorDossierExtensions.getSellerDirectoryKPIStats({ user: { role: 'admin' } }, res, next);
    expect(next).toHaveBeenCalledWith(dbErr);
  });
});

describe('directoryKPIQueries KPI Stats functions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('helper calculations: computeBuyerKPIStatsFromAccounts and computeSellerKPIStatsFromVendors', () => {
    it('computes buyer stats with default parameters and non-array arguments', () => {
      const statsDefault = directoryKPIQueries.computeBuyerKPIStatsFromAccounts();
      expect(statsDefault.totalBuyers).toBe(0);
      expect(statsDefault.verifiedBuyers).toBe(0);
      expect(statsDefault.subscriptionBuyers).toBe(0);

      const statsNonArray = directoryKPIQueries.computeBuyerKPIStatsFromAccounts('invalid');
      expect(statsNonArray.totalBuyers).toBe(0);

      const list = [
        { sourcingMode: 'Mode_1', status: 'ACTIVE_VERIFIED', subscriptionPlan: 'standard' },
        { sourcingMode: 'Mode_2', status: 'VERIFIED', subscriptionPlan: null },
        { sourcingMode: 'Mode_3', status: 'PENDING', subscriptionPlan: 'free_trial' },
        { sourcingMode: null, status: 'REJECTED', subscriptionPlan: 'none' },
      ];
      const statsList = directoryKPIQueries.computeBuyerKPIStatsFromAccounts(list);
      expect(statsList.totalBuyers).toBe(4);
      expect(statsList.verifiedBuyers).toBe(2);
      expect(statsList.subscriptionBuyers).toBe(1);
      expect(statsList.modeCounts.Mode_0).toBe(1);
      expect(statsList.modeCounts.Mode_1).toBe(1);
      expect(statsList.modeCounts.Mode_2).toBe(1);
      expect(statsList.modeCounts.Mode_3).toBe(1);
    });

    it('computes seller stats with default parameters and non-array arguments', () => {
      const statsDefault = directoryKPIQueries.computeSellerKPIStatsFromVendors();
      expect(statsDefault.totalSuppliers).toBe(0);

      const statsNonArray = directoryKPIQueries.computeSellerKPIStatsFromVendors('invalid');
      expect(statsNonArray.totalSuppliers).toBe(0);

      const list = [
        { source: 'procucev_network', status: 'ACTIVE', subscriptionPlan: 'connect' },
        { source: 'buyer_uploaded', status: 'VERIFIED', isSubscribed: true },
        { buyerId: 'b-1', status: 'PENDING', subscriptionPlan: 'free_tier' },
        { buyerAccountId: 'ba-2', status: null, subscriptionPlan: 'premium' },
        { status: 'UNKNOWN' },
      ];
      const statsList = directoryKPIQueries.computeSellerKPIStatsFromVendors(list);
      expect(statsList.totalSuppliers).toBe(5);
      expect(statsList.subscriptionVendors).toBe(2);
      expect(statsList.subscriptionVendorsCount).toBe(2);
      expect(statsList.networkSuppliers).toBe(3);
      expect(statsList.buyerUploaded).toBe(3);
      expect(statsList.verifiedActive).toBe(2);
    });
  });

  describe('getBuyerDirectoryKPIStatsFromDB', () => {
    it('queries DB when storage is configured and maps row counts', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [{
          total_buyers: 25,
          verified_buyers: 18,
          subscription_buyers: 12,
          mode_0: 10,
          mode_1: 8,
          mode_2: 5,
          mode_3: 2,
        }],
      });

      const stats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats.totalBuyers).toBe(25);
      expect(stats.verifiedBuyers).toBe(18);
      expect(stats.subscriptionBuyers).toBe(12);
      expect(stats.modeCounts.Mode_1).toBe(8);
      expect(stats.modeCounts.Mode_3).toBe(2);
    });

    it('handles empty row gracefully when storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

      const stats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats.totalBuyers).toBe(0);
      expect(stats.verifiedBuyers).toBe(0);
      expect(stats.subscriptionBuyers).toBe(0);
      expect(stats.modeCounts.Mode_0).toBe(0);
    });

    it('falls back to storeService on DB query error', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB failure'));
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce([
        { id: 'b1', sourcingMode: 'Mode_1', status: 'ACTIVE_VERIFIED', subscriptionPlan: 'version_1' },
        { id: 'b2', sourcingMode: 'Mode_2', status: 'VERIFIED', subscriptionPlan: 'version_2' },
        { id: 'b3', sourcingMode: 'Custom_Mode', status: 'PENDING', subscriptionPlan: 'free_trial' },
        { id: 'b4', status: 'PENDING', subscriptionPlan: 'none' },
      ]);

      const stats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats.totalBuyers).toBe(4);
      expect(stats.verifiedBuyers).toBe(2);
      expect(stats.subscriptionBuyers).toBe(2);
      expect(stats.modeCounts.Mode_1).toBe(1);
      expect(stats.modeCounts.Mode_2).toBe(1);
      expect(stats.modeCounts.Mode_0).toBe(2);
    });

    it('falls back cleanly when DB query throws and storeService returns null', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB failure'));
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce(null);

      const stats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats.totalBuyers).toBe(0);
    });

    it('calculates stats in-memory when storage is not configured (with populated list and null)', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce([
        { id: 'b1', sourcingMode: 'Mode_1', status: 'ACTIVE_VERIFIED', subscriptionPlan: 'version_1' },
        { id: 'b2', sourcingMode: 'Mode_3', status: 'VERIFIED', subscriptionPlan: 'version_3' },
        { id: 'b3', sourcingMode: 'Mode_0', status: 'PENDING', subscriptionPlan: 'free_trial' },
        { id: 'b4', sourcingMode: 'unknown_mode', status: 'REJECTED', subscriptionPlan: 'none' },
        null,
      ]);

      const stats1 = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats1.totalBuyers).toBe(4);
      expect(stats1.verifiedBuyers).toBe(2);
      expect(stats1.subscriptionBuyers).toBe(2);
      expect(stats1.modeCounts.Mode_1).toBe(1);
      expect(stats1.modeCounts.Mode_3).toBe(1);
      expect(stats1.modeCounts.Mode_0).toBe(2);

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValueOnce(null);
      const stats2 = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
      expect(stats2.totalBuyers).toBe(0);
      expect(stats2.verifiedBuyers).toBe(0);
    });
  });

  describe('getSellerDirectoryKPIStatsFromDB', () => {
    it('queries DB when storage is configured and maps row counts', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [{
          total_suppliers: 30,
          subscription_vendors: 12,
          network_suppliers: 20,
          buyer_uploaded: 10,
          verified_active: 28,
        }],
      });

      const stats = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats.totalSuppliers).toBe(30);
      expect(stats.subscriptionVendors).toBe(12);
      expect(stats.subscriptionVendorsCount).toBe(12);
      expect(stats.networkSuppliers).toBe(20);
      expect(stats.buyerUploaded).toBe(10);
      expect(stats.verifiedActive).toBe(28);
    });

    it('handles empty row gracefully when storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

      const stats = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats.totalSuppliers).toBe(0);
      expect(stats.subscriptionVendors).toBe(0);
      expect(stats.subscriptionVendorsCount).toBe(0);
      expect(stats.networkSuppliers).toBe(0);
      expect(stats.buyerUploaded).toBe(0);
      expect(stats.verifiedActive).toBe(0);
    });

    it('falls back to storeService on DB query error', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB failure'));
      jest.spyOn(storeService, 'getVendors').mockReturnValueOnce([
        { id: 'v1', source: 'procucev_network', status: 'ACTIVE', subscriptionPlan: 'select' },
        { id: 'v2', buyerId: 'b1', status: 'VERIFIED', subscriptionPlan: 'premium' },
        { id: 'v3', status: 'PENDING' },
      ]);

      const stats = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats.totalSuppliers).toBe(3);
      expect(stats.subscriptionVendors).toBe(1);
      expect(stats.subscriptionVendorsCount).toBe(1);
      expect(stats.networkSuppliers).toBe(2);
      expect(stats.buyerUploaded).toBe(1);
      expect(stats.verifiedActive).toBe(2);
    });

    it('falls back cleanly when DB query throws and storeService returns null', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB failure'));
      jest.spyOn(storeService, 'getVendors').mockReturnValueOnce(null);

      const stats = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats.totalSuppliers).toBe(0);
      expect(stats.subscriptionVendors).toBe(0);
      expect(stats.subscriptionVendorsCount).toBe(0);
    });

    it('calculates stats in-memory when storage is not configured (with populated list and null)', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getVendors').mockReturnValueOnce([
        { id: 'v1', source: 'procucev_network', status: 'ACTIVE', isSubscribed: true },
        { id: 'v2', buyerAccountId: 'ba-1', status: 'ACTIVE_VERIFIED', subscriptionPlan: 'free_tier' },
        { id: 'v3', status: 'REJECTED' },
        null,
      ]);

      const stats1 = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats1.totalSuppliers).toBe(3);
      expect(stats1.subscriptionVendors).toBe(1);
      expect(stats1.subscriptionVendorsCount).toBe(1);
      expect(stats1.networkSuppliers).toBe(2);
      expect(stats1.buyerUploaded).toBe(1);
      expect(stats1.verifiedActive).toBe(2);

      jest.spyOn(storeService, 'getVendors').mockReturnValueOnce(null);
      const stats2 = await directoryKPIQueries.getSellerDirectoryKPIStatsFromDB();
      expect(stats2.totalSuppliers).toBe(0);
      expect(stats2.subscriptionVendors).toBe(0);
      expect(stats2.subscriptionVendorsCount).toBe(0);
      expect(stats2.networkSuppliers).toBe(0);
    });
  });

  describe('getCommunicationOutreachAnalyticsFromDB', () => {
    it('returns default analytics when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const res = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB();
      expect(res.totalOutreach).toBe(0);
      expect(res.byChannel.Call).toBe(0);
    });

    it('queries DB and tallies channels and categories accurately', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [
          { channel: 'CALL', metadata: JSON.stringify({ category: 'Demo Schedule' }) },
          { channel: 'SMS', metadata: { category: 'Follow-up / New' } },
          { channel: 'WHATSAPP', metadata: 'invalid-json' },
          { channel: 'EMAIL', metadata: JSON.stringify({ templateType: 'Send Proposal' }) },
          { channel: 'BOTH', metadata: JSON.stringify({ scenarioId: 'Send Corporate Email' }) },
          { channel: 'OTHER', metadata: null },
        ],
      });

      const res = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'buyer' });
      expect(res.totalOutreach).toBe(6);
      expect(res.byChannel.Call).toBe(1);
      expect(res.byChannel.SMS).toBe(2);
      expect(res.byChannel.WhatsApp).toBe(1);
      expect(res.byChannel.Email).toBe(2);
      expect(res.byCategory['Demo Schedule']).toBe(1);
      expect(res.byCategory['Follow-up / New']).toBe(3);
      expect(res.byCategory['Send Proposal']).toBe(1);
      expect(res.byCategory['Send Corporate Email']).toBe(1);
    });

    it('handles query error gracefully and supports seller/vendor filtering', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Query error'));

      const res = await directoryKPIQueries.getCommunicationOutreachAnalyticsFromDB({ accountType: 'vendor' });
      expect(res.totalOutreach).toBe(0);
    });
  });

  describe('subscription vendor calculation edge cases in computeSellerKPIStatsFromVendors', () => {
    it('handles varied subscription signals including raw objects and string booleans', () => {
      const vendors = [
        { id: 'v1', subscriptionPlan: 'connect' },
        { id: 'v2', subscribedPlan: 'select' },
        { id: 'v3', plan: 'enterprise' },
        { id: 'v4', raw: { subscriptionPlan: 'growth' } },
        { id: 'v5', raw: { subscribedPlan: 'custom' } },
        { id: 'v6', raw: { plan: 'pro' } },
        { id: 'v7', isSubscribed: true },
        { id: 'v8', isSubscribed: 'true' },
        { id: 'v9', raw: { isSubscribed: 1 } },
        { id: 'v10', subscriptionPlan: 'none' },
        { id: 'v11', subscriptionPlan: 'free_tier' },
        { id: 'v12', isSubscribed: false },
      ];

      const stats = directoryKPIQueries.computeSellerKPIStatsFromVendors(vendors);
      expect(stats.totalSuppliers).toBe(12);
      expect(stats.subscriptionVendors).toBe(9);
      expect(stats.subscriptionVendorsCount).toBe(9);
    });
  });
});
