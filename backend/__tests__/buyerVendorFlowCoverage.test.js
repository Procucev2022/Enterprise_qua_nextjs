const buyerAccountController = require('../src/controllers/buyerAccountController');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Buyer Vendor Ingestion & AI Categorization Full Flow Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    pool.pool = null;
  });

  describe('buyerAccountController Buyer-Vendor Handlers', () => {
    test('getBuyerVendors returns list with valid buyer role and query filters', async () => {
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBuyerVendors').mockReturnValue([{ id: 'bv-1', buyerOrgId: 'org-1' }]);

      await buyerAccountController.getBuyerVendors(
        { query: { buyerOrgId: 'org-1' }, user: { role: 'buyer', orgId: 'org-1' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.any(Array),
      }));

      // No query and no orgId on user
      await buyerAccountController.getBuyerVendors(
        { query: {}, user: { role: 'admin' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalled();
    });

    test('getBuyerVendors handles controller exceptions gracefully via next', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'getBuyerVendors').mockImplementation(() => {
        throw new Error('Query failure');
      });

      await buyerAccountController.getBuyerVendors(
        { query: {}, user: { role: 'buyer', orgId: 'org-1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('aiCategorizeVendors calls storeService and returns AI prediction results', async () => {
      const res = mockRes();
      const next = jest.fn();

      const fakeResult = {
        period: '2_years',
        totalVendors: 1,
        mappedCount: 1,
        unmappedCount: 0,
        vendors: [{ id: 'bv-1', companyName: 'L&T Valves' }],
      };

      jest.spyOn(storeService, 'categorizeVendorsWithAI').mockReturnValue(fakeResult);

      const req = {
        user: { id: 'usr-1', role: 'admin', orgId: 'org-test' },
        body: {
          vendorMaster: [{ companyName: 'L&T Valves', email: 'sales@lt.com' }],
          poDump: [{ vendorName: 'L&T Valves', itemDescription: 'Gate Valve 100mm', amount: 50000 }],
          period: '2_years',
          buyerOrgId: 'org-test',
        },
      };

      await buyerAccountController.aiCategorizeVendors(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        vendors: expect.any(Array),
      }));

      // Without vendorMaster / poDump / period
      await buyerAccountController.aiCategorizeVendors(
        { user: { role: 'buyer' }, body: {} },
        res,
        next
      );
      expect(res.json).toHaveBeenCalled();
    });

    test('aiCategorizeVendors handles unauthenticated, unauthorized and error branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      // No user
      await buyerAccountController.aiCategorizeVendors({ body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      // Unauthorized vendor role
      const unauthRes = mockRes();
      await buyerAccountController.aiCategorizeVendors({ user: { role: 'vendor' }, body: {} }, unauthRes, next);
      expect(unauthRes.status).toHaveBeenCalledWith(403);

      // Store throws error
      jest.spyOn(storeService, 'categorizeVendorsWithAI').mockImplementation(() => {
        throw new Error('AI error');
      });
      await buyerAccountController.aiCategorizeVendors(
        { user: { id: 'u1', role: 'admin' }, body: {} },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('saveBuyerVendors persists vendors and returns summary', async () => {
      const res = mockRes();
      const next = jest.fn();

      const savedResult = { success: true, savedCount: 1, totalBuyerVendors: 1, buyerOrgId: 'org-1' };
      jest.spyOn(storeService, 'saveBuyerVendors').mockReturnValue(savedResult);

      const req = {
        user: { id: 'usr-1', role: 'buyer', email: 'buyer@lt.com', orgId: 'org-1' },
        body: {
          buyerVendors: [{ id: 'bv-1', companyName: 'ABC Ltd' }],
          buyerOrgId: 'org-1',
        },
      };

      await buyerAccountController.saveBuyerVendors(req, res, next);
      expect(res.json).toHaveBeenCalledWith(savedResult);

      // Without body fields
      await buyerAccountController.saveBuyerVendors(
        { user: { role: 'buyer', email: 'buyer@lt.com' }, body: {} },
        res,
        next
      );
      expect(res.json).toHaveBeenCalled();
    });

    test('saveBuyerVendors handles unauthenticated and error branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.saveBuyerVendors({ body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      jest.spyOn(storeService, 'saveBuyerVendors').mockImplementation(() => {
        throw new Error('Save DB error');
      });
      await buyerAccountController.saveBuyerVendors(
        { user: { id: 'usr-1', role: 'buyer', email: 'b@b.com' }, body: {} },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('dispatchBuyerVendorEmails triggers notification flow and returns summary', async () => {
      const res = mockRes();
      const next = jest.fn();

      const dispatchResult = {
        success: true,
        dispatchedCount: 2,
        failedCount: 0,
        results: [{ vendor: 'V1', status: 'dispatched' }],
      };

      jest.spyOn(storeService, 'dispatchBuyerVendorEmails').mockReturnValue(dispatchResult);

      const req = {
        user: { id: 'usr-1', role: 'buyer', email: 'buyer@corp.com', orgId: 'org-1' },
        body: {
          buyerVendors: [{ id: 'v1' }, { id: 'v2' }],
          buyerOrgId: 'org-1',
        },
      };

      await buyerAccountController.dispatchBuyerVendorEmails(req, res, next);
      expect(res.json).toHaveBeenCalledWith(dispatchResult);

      // Without body fields
      await buyerAccountController.dispatchBuyerVendorEmails(
        { user: { role: 'admin', email: 'adm@corp.com' }, body: {} },
        res,
        next
      );
      expect(res.json).toHaveBeenCalled();
    });

    test('dispatchBuyerVendorEmails handles unauthenticated and error branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.dispatchBuyerVendorEmails({ body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      jest.spyOn(storeService, 'dispatchBuyerVendorEmails').mockImplementation(() => {
        throw new Error('Dispatch error');
      });
      await buyerAccountController.dispatchBuyerVendorEmails(
        { user: { id: 'u1', role: 'admin', email: 'adm@corp.com' }, body: {} },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('domainQueries buyer_vendor database operations', () => {
    test('getBuyerVendorsFromDB returns [] when pool is uninitialized', async () => {
      pool.pool = null;
      const res = await domainQueries.getBuyerVendorsFromDB('org-1');
      expect(res).toEqual([]);
    });

    test('getBuyerVendorsFromDB executes select query and maps rows', async () => {
      pool.pool = {};
      const fakeRecord = {
        id: 'bv-1',
        buyerOrgId: 'org-1',
        companyName: 'Apex Industrial',
        minorCategories: ['Valves & Actuators'],
      };

      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ raw: fakeRecord }],
      });

      const result = await domainQueries.getBuyerVendorsFromDB('org-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bv-1');
      expect(result[0].companyName).toBe('Apex Industrial');

      // Call without org ID
      await domainQueries.getBuyerVendorsFromDB();
      expect(pool.query).toHaveBeenCalled();
    });

    test('upsertBuyerVendorInDB inserts or updates record with active pool and handles all optional fields', async () => {
      pool.pool = {};
      const fullRecord = {
        id: 'bv-1',
        buyerOrgId: 'org-1',
        vendorId: 'v-1',
        vendorCode: 'VND-001',
        companyName: 'Apex Industrial',
        contactPerson: 'John Doe',
        email: 'john@apex.com',
        phone: '9876543210',
        address: 'Mumbai',
        gstin: '27AABCU9603R1ZM',
        rating: 90,
        hasPoHistory: true,
        poCount: 3,
        totalSpend: 500000,
        timeHorizon: '1_year',
        primaryMajorCategory: 'Electrical',
        minorCategories: ['Panels'],
        productLines: ['LV Panels'],
        aiConfidenceScore: 92,
        aiReason: 'Matched electrical POs',
        mappingStatus: 'approved',
        emailDispatchStatus: 'sent',
        dispatchedAt: new Date().toISOString(),
      };

      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ raw: fullRecord }],
      });

      const res = await domainQueries.upsertBuyerVendorInDB(fullRecord);
      expect(res).toEqual(fullRecord);

      // Record with fallback fields and name property
      const sparseRecord = {
        id: 'bv-sparse',
        name: 'Sparse Co',
        rating: 'not-a-number',
        poCount: 'invalid',
        totalSpend: 'invalid',
        aiConfidenceScore: 'invalid',
      };
      await domainQueries.upsertBuyerVendorInDB(sparseRecord);
      expect(pool.query).toHaveBeenCalled();

      // Record with no companyName and no name
      const emptyRecord = {
        id: 'bv-empty',
      };
      await domainQueries.upsertBuyerVendorInDB(emptyRecord);
      expect(pool.query).toHaveBeenCalled();

      // Test with pool null
      pool.pool = null;
      const nullRes = await domainQueries.upsertBuyerVendorInDB(fullRecord);
      expect(nullRes).toBeNull();
    });

    test('deleteBuyerVendorInDB deletes by ID', async () => {
      pool.pool = null;
      expect(await domainQueries.deleteBuyerVendorInDB('bv-1')).toBe(false);

      pool.pool = {};
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      const res = await domainQueries.deleteBuyerVendorInDB('bv-1');
      expect(res).toBe(true);
    });
  });

  describe('storeService categorization and persistence logic', () => {
    test('categorizeVendorsWithAI joins vendor master with PO dump across all categories and match strategies', async () => {
      const vendorMaster = [
        {
          id: 'v-mech',
          vendorCode: 'VM01',
          companyName: 'Precision Valves Ltd',
          email: 'valves@pv.com',
          rating: 92,
        },
        {
          id: 'v-elec',
          vendorCode: 'VE01',
          companyName: 'Siemens Switchgears',
          email: 'power@siemens.com',
        },
        {
          id: 'v-civil',
          companyName: 'Tata Steel Infra',
          gstNumber: '27AAACT2727Q1ZW',
        },
        {
          id: 'v-compressor',
          companyName: 'Atlas Compressors',
        },
        {
          id: 'v-cable',
          companyName: 'Havells Cables',
        },
        {
          id: 'v-roofing',
          companyName: 'Roofing Solutions',
        },
        {
          id: 'v-gen',
          companyName: 'General Spares Depot',
        },
        {
          id: 'v-unmapped',
          companyName: 'Unmapped Partner Without POs',
        },
      ];

      const poDump = [
        {
          vendorIdentifier: 'VM01',
          itemName: 'High Pressure Gate Valve 50mm and pump impeller',
          totalSpend: 150000,
          quantity: 10,
        },
        {
          vendor: 'Siemens Switchgears',
          materialDescription: 'MCCB 400A 4P Circuit Breaker and LV switchgear panel 415v',
          unitPrice: 25000,
          quantity: 10,
        },
        {
          vendorName: 'Tata Steel Infra',
          specs: 'Fe500D TMT Rebar and PEB structural frames reinforcement',
          totalSpend: 900000,
        },
        {
          vendorName: 'Atlas Compressors',
          description: 'Air Compressor 100 cfm receiver tank',
          totalSpend: 200000,
        },
        {
          vendorName: 'Havells Cables',
          description: 'Industrial wire and electrical cable tray',
          totalSpend: 80000,
        },
        {
          vendorName: 'Roofing Solutions',
          description: 'Color coated roofing sheet',
          totalSpend: 60000,
        },
        {
          vendorName: 'General Spares Depot',
          description: 'Workshop grease and cleaning rags',
          totalSpend: 5000,
        },
      ];

      const result = await storeService.categorizeVendorsWithAI({
        vendorMaster,
        poDump,
        period: '3_years',
        buyerOrgId: 'org-test-corp',
      });

      expect(result.totalVendors).toBe(8);
      expect(result.mappedCount).toBe(7);
      expect(result.unmappedCount).toBe(1);

      const mech = result.vendors.find((v) => v.companyName === 'Precision Valves Ltd');
      expect(mech.primaryMajorCategory).toBe('Engineering Spares - Mechanical');

      const elec = result.vendors.find((v) => v.companyName === 'Siemens Switchgears');
      expect(elec.primaryMajorCategory).toBe('Engineering Spares - Electrical');

      const civil = result.vendors.find((v) => v.companyName === 'Tata Steel Infra');
      expect(civil.primaryMajorCategory).toBe('Civil Works');

      const compressor = result.vendors.find((v) => v.companyName === 'Atlas Compressors');
      expect(compressor.minorCategories).toContain('Compressors & Accessories');

      const cable = result.vendors.find((v) => v.companyName === 'Havells Cables');
      expect(cable.minorCategories).toContain('Cables & Wiring');

      const roofing = result.vendors.find((v) => v.companyName === 'Roofing Solutions');
      expect(roofing.minorCategories).toContain('Roofing Sheets');

      const unmapped = result.vendors.find((v) => v.companyName === 'Unmapped Partner Without POs');
      expect(unmapped.hasPoHistory).toBe(false);
      expect(unmapped.mappingStatus).toBe('SELF_MAP_REQUIRED');
    });

    test('categorizeVendorsWithAI handles empty or missing inputs gracefully', async () => {
      const result = await storeService.categorizeVendorsWithAI({});
      expect(result.totalVendors).toBe(0);
      expect(result.mappedCount).toBe(0);
      expect(result.vendors).toEqual([]);
    });

    test('saveBuyerVendors and dispatchBuyerVendorEmails persist and update records', () => {
      const sampleVendors = [
        {
          id: 'bv-save-1',
          companyName: 'Apex Industrial',
          email: 'dispatch@apex.com',
          primaryMajorCategory: 'Mechanical Components & Heavy Spares',
          minorCategories: ['Valves & Actuators'],
          productLines: ['Ball Valves'],
          hasPoHistory: true,
          mappingStatus: 'PENDING',
        },
        {
          id: 'bv-save-2',
          companyName: 'Unmapped Co',
          email: 'unmapped@co.com',
          hasPoHistory: false,
          mappingStatus: 'PENDING',
        },
      ];

      jest.spyOn(domainQueries, 'upsertBuyerVendorInDB').mockResolvedValue(true);

      // Save without requesting buyer account and without orgId
      const saveSummary = storeService.saveBuyerVendors({
        buyerVendors: sampleVendors,
      });

      expect(saveSummary.success).toBe(true);
      expect(saveSummary.savedCount).toBe(2);
      expect(storeService.getBuyerVendorById('bv-save-1')).toBeDefined();

      // Update existing
      storeService.saveBuyerVendors({
        buyerVendors: [{ id: 'bv-save-1', companyName: 'Apex Industrial Updated' }],
        buyerOrgId: 'org-test',
        requestingBuyerAccount: { orgId: 'org-test', corporateEmail: 'lead@test.com' },
      });
      expect(storeService.getBuyerVendorById('bv-save-1').companyName).toBe('Apex Industrial Updated');

      // Dispatch emails
      const dispatchSummary = storeService.dispatchBuyerVendorEmails({
        buyerVendors: sampleVendors,
        buyerOrgId: 'org-test',
        requestingBuyerAccount: { orgId: 'org-test', corporateEmail: 'lead@test.com' },
      });

      expect(dispatchSummary.dispatchedCount).toBe(2);
      expect(dispatchSummary.mappedCount).toBe(1);
      expect(dispatchSummary.unmappedCount).toBe(1);

      // Dispatch with defaults
      const defaultDispatch = storeService.dispatchBuyerVendorEmails({});
      expect(defaultDispatch.dispatchedCount).toBe(0);
    });

    test('_persistBuyerVendor and _removeBuyerVendor execute without throwing', async () => {
      jest.spyOn(domainQueries, 'upsertBuyerVendorInDB').mockRejectedValue(new Error('DB Error'));
      jest.spyOn(domainQueries, 'deleteBuyerVendorInDB').mockRejectedValue(new Error('DB Error'));

      expect(() => storeService._persistBuyerVendor({ id: 'bv-test' })).not.toThrow();
      expect(() => storeService._removeBuyerVendor('bv-test')).not.toThrow();
    });

    test('getBuyerVendors filters by buyerOrgId correctly and getBuyerVendorById handles found and not found', () => {
      storeService.buyerVendors = [
        { id: 'bv-org1-1', buyerOrgId: 'org-1' },
        { id: 'bv-org2-1', buyerOrgId: 'org-2' },
      ];

      expect(storeService.getBuyerVendors('org-1')).toHaveLength(1);
      expect(storeService.getBuyerVendors('org-2')).toHaveLength(1);
      expect(storeService.getBuyerVendors()).toHaveLength(2);
      expect(storeService.getBuyerVendorById('bv-org1-1')).toEqual({ id: 'bv-org1-1', buyerOrgId: 'org-1' });
      expect(storeService.getBuyerVendorById('non-existent-id')).toBeNull();
    });

    test('hydrateFromDB loads buyer vendors from database', async () => {
      jest.spyOn(domainQueries, 'getBuyerVendorsFromDB').mockResolvedValue([
        { id: 'bv-hydrated-1', companyName: 'Hydrated Supplier Ltd', buyerOrgId: 'org-hydrated' },
      ]);

      await storeService.hydrateFromDB();
      expect(storeService.getBuyerVendorById('bv-hydrated-1')).toBeDefined();
    });

    test('categorizeVendorsWithAI covers all category sub-branches and multi-PO confidence tiers', async () => {
      const vendorMaster = [
        { id: 'v-multi-mech', vendorCode: 'MM01', companyName: 'Multi Mech Solutions', rating: 95 },
        { id: 'v-multi-elec', vendorCode: 'ME01', companyName: 'Multi Elec Power', vendorRatingScore: 88 },
        { id: 'v-breaker-only', vendorCode: 'BO01', companyName: 'Breaker Works' },
        { id: 'v-peb-only', vendorCode: 'PO01', companyName: 'PEB Specialist' },
        { id: 'v-tmt-only', vendorCode: 'TO01', companyName: 'TMT Direct' },
        { id: 'v-motor-only', vendorCode: 'MO01', companyName: 'Motor & Bearings Co' },
        { id: 'v-fallback-mech', vendorCode: 'FM01', companyName: 'Hydraulic Hoses Fitting Co' },
        { id: 'v-elec-fallback', vendorCode: 'EF01', companyName: 'Relay 415V Supplier' },
        { id: 'v-civil-fallback', vendorCode: 'CF01', companyName: 'General Civil Foundation' },
      ];

      const poDump = [
        // Multi mech (2 POs)
        { vendorCode: 'MM01', itemDescription: 'Centrifugal Water Pump 50 gpm', totalSpend: 50000 },
        { vendorCode: 'MM01', itemDescription: 'Forged Gate Valve Class 800', totalSpend: 75000 },
        // Multi elec (2 POs)
        { vendorCode: 'ME01', itemDescription: 'HT Distribution Panel 415v', totalSpend: 120000 },
        { vendorCode: 'ME01', itemDescription: 'Heavy Duty Power Cable and Wire', totalSpend: 80000 },
        // Breaker only
        { vendorCode: 'BO01', itemDescription: 'Molded Case Circuit Breaker MCCB 250A', totalSpend: 30000 },
        // PEB only
        { vendorCode: 'PO01', itemDescription: 'Heavy PEB Structure pre-engineered frame', totalSpend: 500000 },
        // TMT only
        { vendorCode: 'TO01', itemDescription: 'Fe500D Reinforcement Steel Rebar and Bar', totalSpend: 400000 },
        // Motor only
        { vendorCode: 'MO01', itemDescription: 'Induction Motor and Machinery Bearing', totalSpend: 60000 },
        // Fallback mech
        { vendorCode: 'FM01', itemDescription: 'Hydraulic Hose and Tube Fitting', totalSpend: 25000 },
        // Fallback elec
        { vendorCode: 'EF01', itemDescription: 'Industrial Protection Relay 415v', totalSpend: 15000 },
        // Fallback civil
        { vendorCode: 'CF01', itemDescription: 'Civil Foundation Concrete Pours', totalSpend: 80000 },
      ];

      const res = await storeService.categorizeVendorsWithAI({
        vendorMaster,
        poDump,
        period: '2_years',
        buyerOrgId: 'org-power-gen',
      });

      expect(res.totalVendors).toBe(9);
      expect(res.mappedCount).toBe(9);

      const mm = res.vendors.find((v) => v.vendorCode === 'MM01');
      expect(mm.aiConfidenceScore).toBe(94);
      expect(mm.minorCategories).toContain('Pumps & Accessories');
      expect(mm.minorCategories).toContain('Hoses, Valves & Fittings');

      const me = res.vendors.find((v) => v.vendorCode === 'ME01');
      expect(me.aiConfidenceScore).toBe(95);
      expect(me.minorCategories).toContain('Panels');
      expect(me.minorCategories).toContain('Cables & Wiring');

      const bo = res.vendors.find((v) => v.vendorCode === 'BO01');
      expect(bo.minorCategories).toContain('Circuit Breakers');

      const peb = res.vendors.find((v) => v.vendorCode === 'PO01');
      expect(peb.minorCategories).toContain('PEB Structure');

      const tmt = res.vendors.find((v) => v.vendorCode === 'TO01');
      expect(tmt.minorCategories).toContain('TMT BARS');

      const motor = res.vendors.find((v) => v.vendorCode === 'MO01');
      expect(motor.minorCategories).toContain('Machinery Parts');
    });

    test('categorizeVendorsWithAI integrates Google Gemini AI when configured and handles errors', async () => {
      const geminiService = require('../src/services/geminiService');
      const isConfiguredSpy = jest.spyOn(geminiService, 'isConfigured').mockReturnValue(true);
      const generateJsonSpy = jest.spyOn(geminiService, 'generateJson').mockResolvedValue({
        status: 'SUCCESS',
        model: 'gemini-1.5-pro',
        data: {
          categorizations: [
            {
              vendorCode: 'GEM-01',
              primaryMajorCategory: 'Advanced Instrumentation',
              minorCategories: ['Sensors & Transmitters'],
              productLines: ['Flow Transmitters'],
              aiConfidenceScore: 98,
              aiReason: 'Gemini detected high-precision sensor procurement pattern.',
            },
          ],
        },
      });

      const res = await storeService.categorizeVendorsWithAI({
        vendorMaster: [{ id: 'v-gem-1', vendorCode: 'GEM-01', companyName: 'Gemini Sensors Corp' }],
        poDump: [{ vendorIdentifier: 'GEM-01', itemName: 'Digital Flow Meter 4-20mA', totalSpend: 50000 }],
      });

      expect(res.aiModel).toContain('Google Gemini');
      const gemVendor = res.vendors.find((v) => v.vendorCode === 'GEM-01');
      expect(gemVendor.primaryMajorCategory).toBe('Advanced Instrumentation');
      expect(gemVendor.aiConfidenceScore).toBe(98);
      expect(gemVendor.aiReason).toContain('Gemini detected');

      // Test error fallback
      generateJsonSpy.mockRejectedValueOnce(new Error('AI Quota Exceeded'));
      const fallbackRes = await storeService.categorizeVendorsWithAI({
        vendorMaster: [{ id: 'v-gem-2', vendorCode: 'GEM-02', companyName: 'Pump Supplier' }],
        poDump: [{ vendorIdentifier: 'GEM-02', itemName: 'Water Pump Impeller', totalSpend: 10000 }],
      });
      expect(fallbackRes.vendors[0].primaryMajorCategory).toBe('Engineering Spares - Mechanical');

      isConfiguredSpy.mockRestore();
      generateJsonSpy.mockRestore();
    });

    test('saveBuyerVendors handles existing global vendor synchronization and unrated vendors', () => {
      // Pre-populate global vendors with matching email and matching name
      storeService.vendors = [
        { id: 'v-existing-1', email: 'existing@sync.com', name: 'Existing Global Supplier' },
      ];

      const vendorsToSave = [
        {
          id: 'bv-sync-existing',
          companyName: 'Existing Global Supplier',
          email: 'existing@sync.com',
          primaryMajorCategory: 'Not Available',
          rating: undefined,
        },
        {
          id: 'bv-sync-new-unrated',
          companyName: 'Brand New Supplier',
          email: 'newsupplier@sync.com',
          primaryMajorCategory: 'Engineering Spares - Electrical',
          rating: 85,
        },
      ];

      const saveResult = storeService.saveBuyerVendors({
        buyerVendors: vendorsToSave,
        buyerOrgId: 'org-sync-test',
        requestingBuyerAccount: null,
      });

      expect(saveResult.success).toBe(true);
      expect(saveResult.savedCount).toBe(2);
      expect(storeService.vendors.some((v) => v.email === 'newsupplier@sync.com')).toBe(true);
    });

    test('single buyer vendor CRUD operations via storeService and HTTP routes', async () => {
      // 1. Create single vendor
      const created = storeService.createSingleBuyerVendor({
        vendor: {
          vendorCode: 'VND-SINGLE-01',
          companyName: 'Single Supplier Ltd',
          email: 'single@supplier.com',
          contactPerson: 'Lead Manager',
          phone: '+91 99999 88888',
          address: 'Mumbai, Maharashtra',
          majorCategory: 'Engineering Spares - Electrical',
          minorCategories: ['Switchgears', 'Cables'],
          rating: 94,
        },
        buyerOrgId: 'org-single-test',
        requestingBuyerAccount: { orgId: 'org-single-test', organizationName: 'Tata Motors', corporateEmail: 'buyer@tatamotors.com' },
      });

      expect(created.success).toBe(true);
      expect(created.data.vendorCode).toBe('VND-SINGLE-01');
      const vendorId = created.data.id;

      // 2. Update single vendor
      const updated = storeService.updateBuyerVendor(vendorId, {
        companyName: 'Single Supplier Updated Ltd',
        rating: 96,
        minorCategories: ['Switchgears', 'Cables', 'Transformers'],
      }, 'org-single-test');

      expect(updated.companyName).toBe('Single Supplier Updated Ltd');
      expect(updated.rating).toBe(96);

      // 3. Delete single vendor
      const deleted = storeService.deleteBuyerVendor(vendorId, 'org-single-test');
      expect(deleted).toBe(true);

      // 4. Delete non-existent vendor
      const notFoundDeleted = storeService.deleteBuyerVendor('non-existent-id', 'org-single-test');
      expect(notFoundDeleted).toBe(false);

      // 5. Test controller handlers for single vendor CRUD
      const res1 = mockRes();
      const next1 = jest.fn();
      await buyerAccountController.createSingleBuyerVendor(
        {
          body: { vendorCode: 'VND-HTTP-01', companyName: 'HTTP Created Vendor', email: 'http@vendor.com' },
          user: { role: 'buyer', orgId: 'org-test', email: 'buyer@test.com' },
        },
        res1,
        next1
      );
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Update handler
      const res2 = mockRes();
      const next2 = jest.fn();
      await buyerAccountController.updateBuyerVendorHandler(
        {
          params: { id: 'VND-HTTP-01' },
          body: { companyName: 'HTTP Updated Vendor' },
          user: { role: 'buyer', orgId: 'org-test' },
        },
        res2,
        next2
      );
      expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Delete handler
      const res3 = mockRes();
      const next3 = jest.fn();
      await buyerAccountController.deleteBuyerVendorHandler(
        {
          params: { id: 'VND-HTTP-01' },
          user: { role: 'buyer', orgId: 'org-test' },
        },
        res3,
        next3
      );
      expect(res3.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Delete handler 404
      const res4 = mockRes();
      const next4 = jest.fn();
      await buyerAccountController.deleteBuyerVendorHandler(
        {
          params: { id: 'missing-999' },
          user: { role: 'buyer', orgId: 'org-test' },
        },
        res4,
        next4
      );
      expect(res4.status).toHaveBeenCalledWith(404);

      // Unauthorized & Error branches
      const resErr = mockRes();
      const nextErr = jest.fn();
      await buyerAccountController.createSingleBuyerVendor({ user: { role: 'vendor' } }, resErr, nextErr);
      expect(resErr.status).toHaveBeenCalledWith(403);

      await buyerAccountController.updateBuyerVendorHandler({ user: { role: 'vendor' } }, resErr, nextErr);
      expect(resErr.status).toHaveBeenCalledWith(403);

      await buyerAccountController.deleteBuyerVendorHandler({ user: { role: 'vendor' } }, resErr, nextErr);
      expect(resErr.status).toHaveBeenCalledWith(403);
    });
  });
});

