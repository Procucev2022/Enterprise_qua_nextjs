const aiChaserService = require('../src/services/aiChaserService');
const emailService = require('../src/services/emailService');
const auditService = require('../src/services/auditService');
const evaluationService = require('../src/services/evaluationService');
const storeService = require('../src/services/storeService');
const dbPool = require('../src/db/pool');
const { bootstrapServer, start } = require('../src/server');
const auditController = require('../src/controllers/auditController');
const evaluationController = require('../src/controllers/evaluationController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const rfqController = require('../src/controllers/rfqController');
const vendorController = require('../src/controllers/vendorController');
const catalogueController = require('../src/controllers/catalogueController');
const domainQueries = require('../src/db/domainQueries');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Full Branch & Function Benchmark Boost (>90%)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Controllers hydrated from DB ternary branches', async () => {
    const res = mockRes();
    const next = jest.fn();

    storeService.isHydratedFromDB = true;

    await auditController.getAuditLogs({}, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));

    await evaluationController.getEvaluations({}, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));

    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));

    await rfqController.getRFQs({}, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));

    await vendorController.getVendors({}, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));

    storeService.isHydratedFromDB = false;
  });

  test('auditController.getAuditLogs with limit', async () => {
    const res = mockRes();
    const next = jest.fn();
    await auditController.getAuditLogs({ query: { limit: '10' } }, res, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('aiChaserService fallback default parameters', () => {
    const itemDefault = aiChaserService.generateAIFeedItem({ title: 'T', message: 'M' });
    expect(itemDefault.type).toBe('call');
    expect(itemDefault.recipient).toBe('Vendor Partner');
    expect(itemDefault.rfqNumber).toBeNull();

    const emptyOutreach = aiChaserService.simulateChaserOutreach({}, {});
    expect(emptyOutreach).toHaveLength(4);
    expect(emptyOutreach[0].recipient).toContain('Sales Head');
  });

  test('emailService fallback default parameters', () => {
    const rfqEmailEmpty = emailService.generateStandardRFQEmail(
      {
        lineItems: [
          { description: 'Fallback Item', quantity: 5, unit: 'kg', technicalSpecs: 'Specs' },
          { itemName: 'Named Item' },
          {},
        ],
      },
      null
    );
    expect(rfqEmailEmpty.subject).toContain('RFQ-2026');
    expect(rfqEmailEmpty.to).toBe('navinchaudhary.dev@gmail.com');

    const vendorEmailEmpty = emailService.generateVendorOnboardingEmail({});
    expect(vendorEmailEmpty.recipientName).toBe('Vendor Partner');
    expect(vendorEmailEmpty.tempPassword).toBe('Procucev#2026!Vendor');
  });

  test('auditService fallback default parameters', () => {
    const defaultEntry = auditService.createAuditEntry({ action: 'DEFAULT_TEST' });
    expect(defaultEntry.userEmail).toBe('system@procucev.ai');
    expect(defaultEntry.rfqNumber).toBeNull();
    expect(defaultEntry.ipAddress).toContain('10.0.4.12');

    const emptyHash = auditService.generateShaHash('');
    expect(emptyHash.length).toBe(64);
  });

  test('evaluationService fallback default parameters & edge cases', () => {
    const quoteNoPrice = evaluationService.evaluateQuotes([
      { vendorName: 'Zero Price', totalPrice: 0, leadTimeDays: 0, warrantyYears: 0 },
    ]);
    expect(quoteNoPrice[0].isBestPrice).toBe(false);

    const eval360Defaults = evaluationService.calculate360Evaluation({});
    expect(eval360Defaults.overallScore).toBeGreaterThan(80);

    const revisedDefaults = evaluationService.calculateRevisedRating({
      qualityScore: 90,
      costScore: 90,
      deliveryScore: 90,
    });
    expect(revisedDefaults.newCompositeScore).toBeDefined();
  });



  test('bootstrapServer and start runner execution', async () => {
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValueOnce({
      isConnected: false,
      providerLabel: 'Identity DB Unreachable',
      errorMessage: 'offline',
    });

    const server = await start(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));

    // Test bootstrapServer with default port and hydrate
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockResolvedValueOnce({
      isConnected: true,
      providerLabel: 'Azure MySQL',
      database: 'test_db',
      userCount: 2,
      latencyMs: 4,
    });

    const server2 = await bootstrapServer(0);
    expect(server2).toBeDefined();
    await new Promise((resolve) => server2.close(resolve));
  });

  test('start runner error handling branch and AUTO_START_SERVER branch', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockImplementationOnce(() => {
      throw new Error('Fatal DB Crash');
    });

    await expect(start(-1)).rejects.toThrow();
    exitSpy.mockRestore();

    process.env.PORT = '0';
    process.env.AUTO_START_SERVER = 'true';
    let srv;
    jest.isolateModules(() => {
      srv = require('../src/server');
    });
    delete process.env.AUTO_START_SERVER;
    delete process.env.PORT;
  });


  test('storeService branches and ai feed overflow', async () => {

    // Fill AI Feed over 100 items to test pop()
    for (let i = 0; i < 105; i++) {
      storeService.addAIFeedItem({ title: `Item ${i}`, message: 'Msg' });
    }
    expect(storeService.getAIFeed().length).toBeLessThanOrEqual(100);

    // Test createRFQ with assigned vendors
    const rfqWithVendors = storeService.createRFQ({
      title: 'Outreach RFQ',
      assignedVendors: [{ name: 'Apex', phone: '+919999999999' }],
      quotes: [{ vendorName: 'Apex', totalPrice: 1000 }],
    });
    expect(rfqWithVendors.quotesCount).toBe(1);

    // Test createEvaluation with default fallback status
    const customEval = storeService.createEvaluation({
      vendorName: 'Custom Eval Supplier',
      moduleScores: {
        commercial: { score: 90 },
        technical: { score: 90 },
        quality: { score: 90 },
        delivery: { score: 90 },
        financial: { score: 90 },
        governance: { score: 90 },
      },
    });
    expect(customEval.overallScore).toBe(90);

    // Test reviseVendorRating with custom buyer remarks
    const vendor = storeService.getVendors()[0];
    if (vendor) {
      storeService.reviseVendorRating(vendor.id, {
        qualityScore: 95,
        costScore: 92,
        deliveryScore: 88,
        buyerCompany: 'Tata Motors',
        buyerName: 'Vikram',
        buyerEmail: 'vikram@tatamotors.com',
        remarks: 'Excellent vendor',
      });
    }

    // Test updateVendorCategories alignment branches
    const v1 = storeService.addVendor({ name: 'Cat Test V1' });
    const aligned = storeService.updateVendorCategories(v1.id, {
      clientMappedCategories: ['Cat1'],
      vendorSelectedCategories: ['Cat1', 'Cat2'],
    });
    expect(aligned.isCategoryAligned).toBe(true);

    const misaligned = storeService.updateVendorCategories(v1.id, {
      clientMappedCategories: ['Cat1', 'Cat3'],
      vendorSelectedCategories: ['Cat1'],
    });
    expect(misaligned.isCategoryAligned).toBe(false);
  });

  test('rfqController V0 sourcing mode variations', async () => {
    const rfqController = require('../src/controllers/rfqController');
    const next = jest.fn();

    const buyer = storeService.addBuyerAccount({
      organizationName: 'V0 Test Org',
      email: 'v0test@example.com',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 0,
    });

    const res1 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'V0 RFQ Mode 0',
        category: 'Electronics',
        sourcingMode: 'mode_0',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item 1', quantity: 10, unit: 'pcs' }],
      },
      user: { email: 'v0test@example.com' },
    }, res1, next);
    expect(res1.status).toHaveBeenCalledWith(201);

    const res2 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'V0 RFQ V0 Alias',
        category: 'Electronics',
        sourcingMode: 'v0',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item 2', quantity: 5, unit: 'pcs' }],
      },
      user: { email: 'v0test@example.com' },
    }, res2, next);
    expect(res2.status).toHaveBeenCalledWith(201);

    const res3 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'V0 RFQ Version 0 Alias',
        category: 'Electronics',
        sourcingMode: 'version_0',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item 3', quantity: 2, unit: 'pcs' }],
      },
      user: { email: 'v0test@example.com' },
    }, res3, next);
    expect(res3.status).toHaveBeenCalledWith(201);
  });

  test('storeService isBuyerUploaded and isProcucevVendor classification coverage', () => {
    // Null/undefined / empty
    expect(storeService.isBuyerUploaded(null)).toBe(false);
    expect(storeService.isBuyerUploaded(undefined)).toBe(false);
    expect(storeService.isProcucevVendor(null)).toBe(false);
    expect(storeService.isProcucevVendor(undefined)).toBe(false);
    expect(storeService.isBuyerUploaded({})).toBe(false);
    expect(storeService.isProcucevVendor({})).toBe(true);

    // Flags: addedByBuyerCompany, buyerAccountId, buyerId
    expect(storeService.isBuyerUploaded({ addedByBuyerCompany: 'Test Co' })).toBe(true);
    expect(storeService.isProcucevVendor({ addedByBuyerCompany: 'Test Co' })).toBe(false);
    expect(storeService.isBuyerUploaded({ buyerAccountId: 'ba-001' })).toBe(true);
    expect(storeService.isProcucevVendor({ buyerAccountId: 'ba-001' })).toBe(false);
    expect(storeService.isBuyerUploaded({ buyerId: 'b-001' })).toBe(true);
    expect(storeService.isProcucevVendor({ buyerId: 'b-001' })).toBe(false);

    // Sources
    const buyerSources = [
      'buyer_uploaded',
      'vendor_master_ingestion',
      'historical_purchase_dump',
      'buyer_manual',
      'buyer_excel',
      'excel_upload',
      'po_ingestion',
      'client_uploaded',
      'buyer',
      'some_buyer_feed',
      'raw_ingestion',
      'erp_purchase_dump',
    ];
    for (const src of buyerSources) {
      expect(storeService.isBuyerUploaded({ source: src })).toBe(true);
      expect(storeService.isProcucevVendor({ source: src })).toBe(false);
    }

    // ID patterns
    const buyerIdPrefixes = ['v-hist-99', 'vm-77', 'v-ingest-66', 'v-buyer-55'];
    for (const id of buyerIdPrefixes) {
      expect(storeService.isBuyerUploaded({ id })).toBe(true);
      expect(storeService.isProcucevVendor({ id })).toBe(false);
    }

    // Procucev network vendors
    const procucevSources = ['procucev_network', 'procucev_verified', 'platform', 'network', 'marketplace'];
    for (const src of procucevSources) {
      expect(storeService.isBuyerUploaded({ id: 'proc-101', source: src })).toBe(false);
      expect(storeService.isProcucevVendor({ id: 'proc-101', source: src })).toBe(true);
    }
  });

  test('storeService createRFQ V0 edge cases: pincodes, candidate fallbacks, and followUpData', () => {
    const mailerService = require('../src/services/mailerService');
    jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });

    const buyer = storeService.addBuyerAccount({
      organizationName: 'V0 Deep Coverage Buyer',
      corporateEmail: 'v0-deep@example.com',
      subscriptionPlan: 'free_trial',
    });

    const vProcPinMatch = storeService.addVendor({
      name: 'Proc Pin Match',
      email: 'pinmatch@example.com',
      contactPerson: 'Pin Match Contact',
      phone: '9876543210',
      majorCategory: 'Medical Devices',
      pincode: '560001',
      rating: 4.9,
      source: 'procucev_network',
    });

    const vProcPinOther = storeService.addVendor({
      name: 'Proc Pin Other',
      majorCategory: 'Medical Devices',
      pincode: '110001',
      rating: 4.1,
    });

    const vBuyerPrivate = storeService.addVendor({
      name: 'Private Uploaded Vendor',
      majorCategory: 'Medical Devices',
      addedByBuyerCompany: 'V0 Deep Coverage Buyer',
      source: 'buyer_uploaded',
    });

    // 1. V0 RFQ with deliveryPincode, assignedVendors with mixed IDs, and followUpData
    const rfq1 = storeService.createRFQ({
      title: 'V0 Pincode Medical RFQ',
      category: 'Medical Devices',
      sourcingMode: 'mode_0',
      deliveryPincode: '560001',
      followUpData: { totalInvited: 0, vendors: [] },
      assignedVendors: [
        { id: vProcPinMatch.id },
        { id: vBuyerPrivate.id },
        { id: 'non-existent-vendor-id', name: 'Ghost Vendor' },
        { name: 'Plain Object Vendor', source: 'procucev_verified' },
      ],
    }, buyer);

    expect(rfq1.assignedVendors.length).toBeGreaterThan(0);
    expect(rfq1.followUpData.totalInvited).toBe(rfq1.assignedVendors.length);
    const assignedIds = rfq1.assignedVendors.map((v) => v.id);
    expect(assignedIds).not.toContain(vBuyerPrivate.id);

    // 2. V0 RFQ without deliveryPincode
    const rfq2 = storeService.createRFQ({
      title: 'V0 Non-Pincode Medical RFQ',
      category: 'Medical Devices',
      sourcingMode: 'v0',
    }, buyer);
    expect(rfq2.assignedVendors.length).toBeGreaterThan(0);

    // 3. Category mismatch branch coverage (lines 1540-1575)
    const mismatchVendor = storeService.addVendor({
      name: 'Chemical Vendor',
      email: 'chem@example.com',
      majorCategory: 'Chemicals & Reagents',
      addedByBuyerCompany: 'V0 Deep Coverage Buyer',
      source: 'buyer_manual',
    });
    const rfqMismatch = storeService.createRFQ({
      title: 'Mismatched Category RFQ',
      category: 'Medical Devices',
      sourcingMode: 'mode_1',
      assignedVendors: [{ id: mismatchVendor.id }],
    }, buyer);
    expect(rfqMismatch.assignedVendors).toHaveLength(0);
  });

  test('rfqController createRFQ subscription plan & credit limit branch paths', async () => {
    const next = jest.fn();

    // 1. Plan entitlement violation: buyer on version_1 requesting mode_2 (disallowed)
    storeService.addBuyerAccount({
      organizationName: 'V1 Entitlement Org',
      corporateEmail: 'v1buyer@example.com',
      subscriptionPlan: 'version_1',
    });
    const resForbiddenMode = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Forbidden Mode RFQ',
        category: 'Electronics',
        sourcingMode: 'mode_2',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item A', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'v1buyer@example.com' },
    }, resForbiddenMode, next);
    expect(resForbiddenMode.status).toHaveBeenCalledWith(403);
    expect(resForbiddenMode.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('does not include mode_2'),
    }));

    // 2. Free trial buyer with 0 remaining credits requesting mode_1 (disallowed)
    storeService.addBuyerAccount({
      organizationName: 'Trial Exhausted Org',
      corporateEmail: 'exhausted@example.com',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 0,
    });
    const resExhausted = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Exhausted Credits RFQ',
        category: 'Electronics',
        sourcingMode: 'mode_1',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item B', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'exhausted@example.com' },
    }, resExhausted, next);
    expect(resExhausted.status).toHaveBeenCalledWith(403);
    expect(resExhausted.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('5 free trial RFQ credits for V1/V2/V3 have been fully used'),
    }));

    // 3. Free trial buyer with remaining credits but tryConsumeFreeRFQ returns false
    storeService.addBuyerAccount({
      organizationName: 'Trial Active Org',
      corporateEmail: 'trialactive@example.com',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 2,
    });
    jest.spyOn(storeService, 'tryConsumeFreeRFQ').mockReturnValueOnce({ ok: false });
    const resConsumeFail = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Consume Fail RFQ',
        category: 'Electronics',
        sourcingMode: 'mode_1',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item C', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'trialactive@example.com' },
    }, resConsumeFail, next);
    expect(resConsumeFail.status).toHaveBeenCalledWith(403);
    expect(resConsumeFail.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('free trial RFQs are used up'),
    }));

    // 4. Paid plan buyer (version_1) requesting mode_1 (allowed, no free trial consumed)
    const resPaidSuccess = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Paid Plan Mode 1 RFQ',
        category: 'Electronics',
        sourcingMode: 'mode_1',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Item D', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'v1buyer@example.com' },
    }, resPaidSuccess, next);
    expect(resPaidSuccess.status).toHaveBeenCalledWith(201);
  });

  test('pincodeController and pincodeService branch boost', async () => {
    const pincodeController = require('../src/controllers/pincodeController');
    const pincodeService = require('../src/services/pincodeService');

    // Dummy pincode branches
    expect(pincodeService.isDummyPincode('   ')).toBe(false);
    expect(pincodeService.isDummyPincode('88888888')).toBe(true);
    const emptyPinRes = await pincodeService.validateAndLookupPincode('');
    expect(emptyPinRes.valid).toBe(false);

    // Controller query parameter fallback & valid PIN
    const res1 = mockRes();
    const next1 = jest.fn();
    await pincodeController.lookupPincode({ params: {}, query: { pincode: '560001' } }, res1, next1);
    expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, valid: true }));

    // Controller with dummy PIN
    const res2 = mockRes();
    const next2 = jest.fn();
    await pincodeController.lookupPincode({ params: { pincode: '000000' } }, res2, next2);
    expect(res2.status).toHaveBeenCalledWith(400);

    // Controller with empty PIN (query & params empty)
    const resEmpty = mockRes();
    const nextEmpty = jest.fn();
    await pincodeController.lookupPincode({ params: {}, query: {} }, resEmpty, nextEmpty);
    expect(resEmpty.status).toHaveBeenCalledWith(400);

    // Controller catch error via invalid req
    const res3 = mockRes();
    const next3 = jest.fn();
    await pincodeController.lookupPincode(null, res3, next3);
    expect(next3).toHaveBeenCalled();
  });

  test('whatsAppService CF_ENV and Meta error branches', async () => {
    const whatsAppService = require('../src/services/whatsAppService');

    // CF_ENV branch
    globalThis.__CF_ENV__ = { WHATSAPP_BASE_URL: 'https://cf.sendmsg.test' };
    const oldEnv = process.env.WHATSAPP_BASE_URL;
    delete process.env.WHATSAPP_BASE_URL;
    expect(whatsAppService.WHATSAPP_CONFIG.SENDMSG_BASE_URL).toBe('https://cf.sendmsg.test');
    if (oldEnv !== undefined) process.env.WHATSAPP_BASE_URL = oldEnv;
    delete globalThis.__CF_ENV__;

    // Meta API throw & failure in non-test mode
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-id';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    delete process.env.WHATSAPP_USERNAME;

    // Fetch returns non-ok without error message
    const oldFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    whatsAppService.clearWhatsAppThrottleCache();
    const metaFail = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Test Vendor',
      rfqNumber: 'RFQ-META-FAIL',
      rfqTitle: 'Meta Fail Test',
    });
    expect(metaFail.success).toBe(true); // Falls back to deep-link

    // Fetch throws in Meta API
    global.fetch = jest.fn().mockRejectedValue(new Error('Meta Network Down'));
    whatsAppService.clearWhatsAppThrottleCache();
    const metaThrow = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Test Vendor',
      rfqNumber: 'RFQ-META-THROW',
      rfqTitle: 'Meta Throw Test',
    });
    expect(metaThrow.success).toBe(true); // Falls back to deep-link

    global.fetch = oldFetch;
    process.env.NODE_ENV = oldNodeEnv;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });

  test('storeService waitUntil, getBuyerAccountByEmail, and free trial refund branches', async () => {
    const domainQueries = require('../src/db/domainQueries');

    // 1. waitUntil in _background
    let waitUntilCalled = false;
    globalThis.__CF_WAIT_UNTIL__ = () => { waitUntilCalled = true; };
    storeService._background(Promise.resolve(), 'Test msg');
    expect(waitUntilCalled).toBe(true);
    delete globalThis.__CF_WAIT_UNTIL__;

    // 2. getBuyerAccountByEmail DB refresh branches
    const pool = require('../src/db/pool');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const mockFresh = {
      id: 'fresh-buyer-id',
      corporateEmail: 'fresh@example.com',
      organizationName: 'Fresh Corp',
    };
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValueOnce(mockFresh);
    // idx === -1 branch
    const loaded = await storeService.getBuyerAccountByEmail('fresh@example.com');
    expect(loaded.id).toBe('fresh-buyer-id');

    // idx !== -1 and activeBuyerAccount matching branch
    storeService.activeBuyerAccount = loaded;
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValueOnce({
      ...mockFresh,
      organizationName: 'Updated Fresh Corp',
    });
    const reloaded = await storeService.getBuyerAccountByEmail('fresh@example.com');
    expect(reloaded.organizationName).toBe('Updated Fresh Corp');
    expect(storeService.activeBuyerAccount.organizationName).toBe('Updated Fresh Corp');

    // fresh === null branch
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValueOnce(null);
    expect(await storeService.getBuyerAccountByEmail('notfound@example.com')).toBeNull();
    jest.spyOn(pool, 'hasStorage').mockRestore();

    // 3. tryConsumeFreeRFQ idx === -1, remaining <= 0, and activeBuyerAccount
    expect(storeService.tryConsumeFreeRFQ('non-existent-buyer-id')).toEqual({ ok: false, remaining: 0 });
    const zeroCreditsBuyer = storeService.addBuyerAccount({
      organizationName: 'Zero Credits Buyer',
      remainingFreeRFQs: 0,
    });
    expect(storeService.tryConsumeFreeRFQ(zeroCreditsBuyer.id)).toEqual({ ok: false, remaining: 0 });

    const activeBuyer = storeService.addBuyerAccount({
      organizationName: 'Active Credits Buyer',
      remainingFreeRFQs: 3,
    });
    storeService.activeBuyerAccount = activeBuyer;
    const consumed = storeService.tryConsumeFreeRFQ(activeBuyer.id);
    expect(consumed.ok).toBe(true);
    expect(storeService.activeBuyerAccount.remainingFreeRFQs).toBe(2);

    // 4. refundFreeRFQ idx === -1 and activeBuyerAccount
    storeService.refundFreeRFQ('non-existent-buyer-id');
    storeService.refundFreeRFQ(activeBuyer.id);
    expect(storeService.activeBuyerAccount.remainingFreeRFQs).toBe(3);
  });

  test('getAllRFQs and getRFQSummary optimization coverage', async () => {
    const rfqController = require('../src/controllers/rfqController');
    const resSummary = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    // 1. getAllRFQs with summary=true and limit
    await rfqController.getAllRFQs({ query: { summary: 'true', limit: '1' } }, resSummary, next);
    expect(resSummary.json).toHaveBeenCalled();
    const summaryData = resSummary.json.mock.calls[0][0].data;
    expect(Array.isArray(summaryData)).toBe(true);

    // 2. getRFQSummary with buyer account scope
    const resRfqSum = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    await rfqController.getRFQSummary({ user: { role: 'buyer', email: 'test-buyer@example.com' }, query: {} }, resRfqSum, next);
    expect(resRfqSum.json).toHaveBeenCalled();

    // 3. getBootstrapData vendorCatalogue scoping
    const vendorBootstrap = await storeService.getBootstrapData(null, 'apex@supplier.com');
    expect(Array.isArray(vendorBootstrap.vendorCatalogue)).toBe(true);

    const buyerBootstrap = await storeService.getBootstrapData('buyer-scoped-id', 'buyer@corp.com');
    expect(buyerBootstrap.vendorCatalogue).toEqual([]);
  });

  test('Controllers and domainQueries data fetching optimization coverage', async () => {
    const next = jest.fn();

    // 1. evaluationController with limit and invalid limit
    const resEval = mockRes();
    await evaluationController.getEvaluations({ query: { limit: '2' } }, resEval, next);
    expect(resEval.json).toHaveBeenCalled();
    const resEvalInvalid = mockRes();
    await evaluationController.getEvaluations({ query: { limit: 'abc' } }, resEvalInvalid, next);
    expect(resEvalInvalid.json).toHaveBeenCalled();

    // 2. buyerAccountController with limit and invalid limit
    const resBuyer = mockRes();
    await buyerAccountController.getBuyerAccounts({ query: { limit: '2' } }, resBuyer, next);
    expect(resBuyer.json).toHaveBeenCalled();
    const resBuyerInvalid = mockRes();
    await buyerAccountController.getBuyerAccounts({ query: { limit: 'abc' } }, resBuyerInvalid, next);
    expect(resBuyerInvalid.json).toHaveBeenCalled();

    // 3. catalogueController with limit and invalid limit
    const resCat = mockRes();
    await catalogueController.getProducts({ query: { limit: '2' } }, resCat, next);
    expect(resCat.json).toHaveBeenCalled();
    const resCatInvalid = mockRes();
    await catalogueController.getProducts({ query: { limit: 'abc' } }, resCatInvalid, next);
    expect(resCatInvalid.json).toHaveBeenCalled();

    // 4. vendorController with limit and invalid limit
    const resVend = mockRes();
    await vendorController.getVendors({ query: { limit: '2' } }, resVend, next);
    expect(resVend.json).toHaveBeenCalled();
    const resVendInvalid = mockRes();
    await vendorController.getVendors({ query: { limit: 'abc' } }, resVendInvalid, next);
    expect(resVendInvalid.json).toHaveBeenCalled();

    // 5. domainQueries scoped payment links, catalogue, unlocks, credits & evaluations
    const origPool = dbPool.pool;
    try {
      dbPool.pool = {
        query: jest.fn().mockResolvedValue({ rows: [{ raw: { id: 'test-1' } }] }),
      };

      // evaluations with and without limit
      const evalsLimited = await domainQueries.getEvaluationsFromDB(10);
      expect(evalsLimited).toEqual([{ id: 'test-1' }]);
      const evalsAll = await domainQueries.getEvaluationsFromDB(null);
      expect(evalsAll).toEqual([{ id: 'test-1' }]);

      // vendor catalogue with and without limit
      const catLimited = await domainQueries.getVendorCatalogueFromDB(10);
      expect(catLimited).toEqual([{ id: 'test-1' }]);
      const catAll = await domainQueries.getVendorCatalogueFromDB(null);
      expect(catAll).toEqual([{ id: 'test-1' }]);

      // payment links with and without limit
      const plLimited = await domainQueries.getPaymentLinksFromDB(10);
      expect(plLimited).toEqual([{ id: 'test-1' }]);
      const plAll = await domainQueries.getPaymentLinksFromDB(null);
      expect(plAll).toEqual([{ id: 'test-1' }]);

      // payment link by ID
      const plById = await domainQueries.getPaymentLinkByIdFromDB('pl-1');
      expect(plById).toEqual({ id: 'test-1' });
      const plByIdNull = await domainQueries.getPaymentLinkByIdFromDB(null);
      expect(plByIdNull).toBeNull();

      // payment links by vendor
      const plVendorLimited = await domainQueries.getPaymentLinksByVendorFromDB('v-test', 25);
      expect(plVendorLimited).toEqual([{ id: 'test-1' }]);
      const plVendorAll = await domainQueries.getPaymentLinksByVendorFromDB('v-test', null);
      expect(plVendorAll).toEqual([{ id: 'test-1' }]);
      const plVendorEmpty = await domainQueries.getPaymentLinksByVendorFromDB(null, 10);
      expect(plVendorEmpty).toEqual([]);

      // payment links by buyer
      const plBuyerLimited = await domainQueries.getPaymentLinksByBuyerFromDB('b-test', 25);
      expect(plBuyerLimited).toEqual([{ id: 'test-1' }]);
      const plBuyerAll = await domainQueries.getPaymentLinksByBuyerFromDB('b-test', null);
      expect(plBuyerAll).toEqual([{ id: 'test-1' }]);
      const plBuyerEmpty = await domainQueries.getPaymentLinksByBuyerFromDB(null, 10);
      expect(plBuyerEmpty).toEqual([]);

      // vendor unlocks with and without limit
      const unlLimited = await domainQueries.getVendorUnlocksFromDB('v-test', 10);
      expect(unlLimited).toEqual([{ raw: { id: 'test-1' } }]);
      const unlAll = await domainQueries.getVendorUnlocksFromDB('v-test', null);
      expect(unlAll).toEqual([{ raw: { id: 'test-1' } }]);
      const unlEmpty = await domainQueries.getVendorUnlocksFromDB(null, 10);
      expect(unlEmpty).toEqual([]);

      // vendor credit transactions with and without limit
      const txLimited = await domainQueries.getVendorCreditTransactionsFromDB('v-test', 10);
      expect(txLimited).toEqual([{ raw: { id: 'test-1' } }]);
      const txAll = await domainQueries.getVendorCreditTransactionsFromDB('v-test', null);
      expect(txAll).toEqual([{ raw: { id: 'test-1' } }]);
      const txEmpty = await domainQueries.getVendorCreditTransactionsFromDB(null, 10);
      expect(txEmpty).toEqual([]);

      // buyer accounts with and without limit
      const baLimited = await domainQueries.getBuyerAccountsFromDB(10);
      expect(baLimited).toEqual({ accounts: [{ id: 'test-1' }], activeId: null });
      const baAll = await domainQueries.getBuyerAccountsFromDB(null);
      expect(baAll).toEqual({ accounts: [{ id: 'test-1' }], activeId: null });

      // pending chaser jobs with and without limit
      const chaserLimited = await domainQueries.getPendingChaserJobsFromDB(10);
      expect(chaserLimited).toEqual([{ raw: { id: 'test-1' } }]);
      const chaserAll = await domainQueries.getPendingChaserJobsFromDB(null);
      expect(chaserAll).toEqual([{ raw: { id: 'test-1' } }]);

      // unconfigured storage branches
      dbPool.pool = null;
      expect(await domainQueries.getEvaluationsFromDB(10)).toEqual([]);
      expect(await domainQueries.getVendorCatalogueFromDB(10)).toEqual([]);
      expect(await domainQueries.getBuyerAccountsFromDB(10)).toEqual({ accounts: [], activeId: null });
      expect(await domainQueries.getPendingChaserJobsFromDB(10)).toEqual([]);
      expect(await domainQueries.getPaymentLinksFromDB(10)).toEqual([]);
      expect(await domainQueries.getPaymentLinkByIdFromDB('pl-1')).toBeNull();
      expect(await domainQueries.getPaymentLinksByVendorFromDB('v-test')).toEqual([]);
      expect(await domainQueries.getPaymentLinksByBuyerFromDB('b-test')).toEqual([]);
      expect(await domainQueries.getVendorUnlocksFromDB('v-test')).toEqual([]);
      expect(await domainQueries.getVendorCreditTransactionsFromDB('v-test')).toEqual([]);
    } finally {
      dbPool.pool = origPool;
    }
  });

  test('rfqController getRFQs limit query parameter and storeService getRFQByIdAsync clean null return', async () => {
    const res = mockRes();
    const next = jest.fn();

    // 1. rfqController.getRFQs with ?limit=1
    await rfqController.getRFQs({
      query: { limit: '1' },
      user: { role: 'category_manager', email: 'cm@procucev.com' },
    }, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.any(Array),
    }));
    const data = res.json.mock.calls[0][0].data;
    expect(data.length).toBeLessThanOrEqual(1);

    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const getSpy = jest.spyOn(domainQueries, 'getRFQByIdFromDB');
    const syncSpy = jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue([]);

    try {
      // 2. storeService.getRFQByIdAsync when DB returns null
      getSpy.mockResolvedValueOnce(null);
      const result = await storeService.getRFQByIdAsync('definitely-non-existent-rfq-id-12345');
      expect(result).toBeUndefined();
      expect(syncSpy).toHaveBeenCalledTimes(1);

      // 3. storeService.getRFQByIdAsync when DB throws error
      getSpy.mockRejectedValueOnce(new Error('DB connection drop'));
      const resultAfterErr = await storeService.getRFQByIdAsync('definitely-non-existent-rfq-id-12345');
      expect(resultAfterErr).toBeUndefined();
      expect(syncSpy).toHaveBeenCalledTimes(2);
    } finally {
      storageSpy.mockRestore();
      getSpy.mockRestore();
      syncSpy.mockRestore();
    }
  });

  test('reportsController limit query parameter branch coverage', async () => {
    const reportsController = require('../src/controllers/reportsController');
    const next = jest.fn();

    // 1. getSellerReports with limit
    const resSeller = mockRes();
    await reportsController.getSellerReports({ query: { limit: '1' } }, resSeller, next);
    expect(resSeller.json).toHaveBeenCalled();
    const sellerBody = resSeller.json.mock.calls[0][0];
    expect(sellerBody.success).toBe(true);
    expect(sellerBody.data.length).toBeLessThanOrEqual(1);

    // 2. getBuyerReports with limit
    const resBuyer = mockRes();
    await reportsController.getBuyerReports({ query: { limit: '1' } }, resBuyer, next);
    expect(resBuyer.json).toHaveBeenCalled();
    const buyerBody = resBuyer.json.mock.calls[0][0];
    expect(buyerBody.success).toBe(true);
    expect(buyerBody.data.length).toBeLessThanOrEqual(1);

    // 3. getRfqReports with limit
    const resRfq = mockRes();
    await reportsController.getRfqReports({ query: { limit: '1' } }, resRfq, next);
    expect(resRfq.json).toHaveBeenCalled();
    const rfqBody = resRfq.json.mock.calls[0][0];
    expect(rfqBody.success).toBe(true);
    expect(rfqBody.data.length).toBeLessThanOrEqual(1);

    // 4. Invalid limit fallthrough
    const resInvalid = mockRes();
    await reportsController.getSellerReports({ query: { limit: 'invalid' } }, resInvalid, next);
    expect(resInvalid.json).toHaveBeenCalled();
  });

  test('notificationController listNotifications limit branches', async () => {
    const notificationController = require('../src/controllers/notificationController');
    const next = jest.fn();

    // 1. Unauthenticated or empty recipient
    const resEmpty = mockRes();
    await notificationController.listNotifications({}, resEmpty, next);
    expect(resEmpty.json).toHaveBeenCalledWith({ success: true, data: [], unreadCount: 0 });

    // 2. Authenticated vendor with explicit limit
    const mockVendorReq = {
      user: { role: 'vendor', email: 'test-limit-vendor@supplier.com' },
      query: { limit: '5' },
    };
    const getVendorSpy = jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v-101' });
    const getNotificationsSpy = jest.spyOn(storeService, 'getNotificationsFor').mockReturnValue([
      { id: 'n-1', read: false },
    ]);
    const getUnreadSpy = jest.spyOn(storeService, 'getUnreadNotificationCountFor').mockReturnValue(1);

    const resVendor = mockRes();
    await notificationController.listNotifications(mockVendorReq, resVendor, next);
    expect(resVendor.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.any(Array),
      unreadCount: 1,
    }));
    expect(getNotificationsSpy).toHaveBeenCalledWith('vendor', 'v-101', 5);

    // 3. Fallback to default limit 50 when invalid limit provided
    const mockVendorInvalidReq = {
      user: { role: 'vendor', email: 'test-limit-vendor@supplier.com' },
      query: { limit: 'invalid' },
    };
    const resInvalid = mockRes();
    await notificationController.listNotifications(mockVendorInvalidReq, resInvalid, next);
    expect(getNotificationsSpy).toHaveBeenCalledWith('vendor', 'v-101', 50);

    getVendorSpy.mockRestore();
    getNotificationsSpy.mockRestore();
    getUnreadSpy.mockRestore();
  });

  test('syncRFQsFromDB caches buyer-specific syncs within 25s window', async () => {
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const getRFQsSpy = jest.spyOn(domainQueries, 'getRFQsFromDB').mockResolvedValue([{ id: 'rfq-c-1', buyerAccountId: 'buyer-acc-throttle' }]);

    try {
      // First call fetches from DB
      await storeService.syncRFQsFromDB(true, 'buyer-acc-throttle');
      expect(getRFQsSpy).toHaveBeenCalledTimes(1);

      // Second call within 25s should hit cache without calling getRFQsFromDB again
      await storeService.syncRFQsFromDB(false, 'buyer-acc-throttle');
      expect(getRFQsSpy).toHaveBeenCalledTimes(1);
    } finally {
      storageSpy.mockRestore();
      getRFQsSpy.mockRestore();
    }
  });

  test('rfqController getVendorCandidates respects query limit', async () => {
    const rfqController = require('../src/controllers/rfqController');
    const mockRfq = { id: 'rfq-cand-1', buyerAccountId: 'b-1', category: 'Raw Materials' };
    const getRfqSpy = jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(mockRfq);
    const candidateSpy = jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue([
      { id: 'v-1' },
      { id: 'v-2' },
      { id: 'v-3' },
    ]);

    const reqWithLimit = {
      user: { role: 'admin', email: 'admin@procucev.com' },
      params: { id: 'rfq-cand-1' },
      query: { limit: '2' },
    };
    const res = mockRes();
    const next = jest.fn();
    await rfqController.getVendorCandidates(reqWithLimit, res, next);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'v-1' }, { id: 'v-2' }],
    });

    // Test invalid limit fallback
    const reqInvalidLimit = {
      user: { role: 'admin', email: 'admin@procucev.com' },
      params: { id: 'rfq-cand-1' },
      query: { limit: 'invalid' },
    };
    const resInvalid = mockRes();
    await rfqController.getVendorCandidates(reqInvalidLimit, resInvalid, next);
    expect(resInvalid.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'v-1' }, { id: 'v-2' }, { id: 'v-3' }],
    });

    getRfqSpy.mockRestore();
    candidateSpy.mockRestore();
  });

  test('storeService limit parameters for evaluations, aiFeed, and vendorCatalogue', () => {
    storeService.evaluations = [{ id: 'e-1' }, { id: 'e-2' }, { id: 'e-3' }];
    expect(storeService.getEvaluations(2)).toHaveLength(2);
    expect(storeService.getEvaluations()).toHaveLength(3);

    storeService.aiFeed = [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }];
    expect(storeService.getAIFeed(1)).toHaveLength(1);
    expect(storeService.getAIFeed()).toHaveLength(3);

    storeService.vendorCatalogue = [
      { id: 'p-1', vendorId: 'v-cat' },
      { id: 'p-2', vendorId: 'v-cat' },
      { id: 'p-3', vendorId: 'v-cat' },
      { id: 'p-4', vendorId: 'v-other' },
    ];
    expect(storeService.getVendorCatalogue('v-cat', 2)).toHaveLength(2);
    expect(storeService.getVendorCatalogue('v-cat')).toHaveLength(3);
    expect(storeService.getVendorCatalogue(null, 2)).toHaveLength(2);

    storeService.enterpriseInquiries = [{ id: 'inq-1' }, { id: 'inq-2' }, { id: 'inq-3' }];
    expect(storeService.getEnterpriseInquiries(2)).toHaveLength(2);
    expect(storeService.getEnterpriseInquiries()).toHaveLength(3);

    storeService.buyerAccounts = [{ id: 'b-1' }, { id: 'b-2' }, { id: 'b-3' }];
    expect(storeService.getBuyerAccounts(2)).toHaveLength(2);
    expect(storeService.getBuyerAccounts()).toHaveLength(3);
  });

  test('controllers getBuyerAccounts, getEvaluations, and getProducts respect limit query', async () => {
    const buyerAccountController = require('../src/controllers/buyerAccountController');
    const evaluationController = require('../src/controllers/evaluationController');
    const catalogueController = require('../src/controllers/catalogueController');

    storeService.buyerAccounts = [{ id: 'ba-1' }, { id: 'ba-2' }, { id: 'ba-3' }];
    const resBA = mockRes();
    buyerAccountController.getBuyerAccounts({ query: { limit: '2' } }, resBA, jest.fn());
    expect(resBA.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [{ id: 'ba-1' }, { id: 'ba-2' }],
    }));

    storeService.evaluations = [{ id: 'ev-1' }, { id: 'ev-2' }];
    const resEv = mockRes();
    evaluationController.getEvaluations({ query: { limit: '1' } }, resEv, jest.fn());
    expect(resEv.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [{ id: 'ev-1' }],
    }));

    storeService.vendorCatalogue = [{ id: 'prod-1' }, { id: 'prod-2' }, { id: 'prod-3' }];
    const resCat = mockRes();
    catalogueController.getProducts({ query: { limit: '2' } }, resCat, jest.fn());
    expect(resCat.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [{ id: 'prod-1' }, { id: 'prod-2' }],
    }));
  });

  test('upsertAuditLogInDB invalidates audit_logs cache', async () => {
    const { queryCache } = require('../src/db/queryCache');
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    dbPool.pool = { query: jest.fn().mockResolvedValue({ rows: [{ raw: { id: 'log-cache-1' } }] }) };

    try {
      await domainQueries.upsertAuditLogInDB({ id: 'log-cache-1', action: 'TEST' });
      expect(invalidateSpy).toHaveBeenCalledWith('audit_logs');
    } finally {
      invalidateSpy.mockRestore();
      storageSpy.mockRestore();
    }
  });

  test('vendorIngestionController getVendorMasterPreview respects limit query', async () => {
    const vendorIngestionController = require('../src/controllers/vendorIngestionController');
    const vendorIngestionService = require('../src/services/vendorIngestionService');
    const previewSpy = jest.spyOn(vendorIngestionService, 'getVendorMasterPreview').mockResolvedValue({
      records: [{ id: 'vm-1' }],
      total: 10,
    });

    const req = {
      user: { email: 'buyer@corp.com', role: 'buyer' },
      params: { sessionId: 'sess-1' },
      query: { limit: '25' },
    };
    const res = mockRes();
    await vendorIngestionController.getVendorMasterPreview(req, res, jest.fn());
    expect(previewSpy).toHaveBeenCalledWith(req.user, 'sess-1', 25);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { records: [{ id: 'vm-1' }], total: 10 },
    });

    previewSpy.mockRestore();
  });

  test('updateProfile invalidates buyer_accounts cache', async () => {
    const { queryCache } = require('../src/db/queryCache');
    const buyerProfileQueries = require('../src/db/buyerProfileQueries');
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const withTxSpy = jest.spyOn(dbPool, 'withTransaction').mockImplementation(async (cb) => {
      const client = {
        query: jest.fn().mockResolvedValue({ rows: [{ uuid: 'org-1' }] }),
      };
      return cb(client);
    });

    try {
      const res = await buyerProfileQueries.updateProfile({
        organizationId: 'org-1',
        userId: 'u-1',
        patch: { companyName: 'New Org' },
      });
      expect(res.updated).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledWith('buyer_accounts');
    } finally {
      invalidateSpy.mockRestore();
      storageSpy.mockRestore();
      withTxSpy.mockRestore();
    }
  });

  test('aiFeedController getAIFeed passes limit to storeService when unrestricted', async () => {
    const aiFeedController = require('../src/controllers/aiFeedController');
    const feedSpy = jest.spyOn(storeService, 'getAIFeed').mockReturnValue([{ id: 'f-1' }]);
    const req = {
      user: { role: 'admin', email: 'admin@procucev.com' },
      query: { limit: '1' },
    };
    const res = mockRes();
    await aiFeedController.getAIFeed(req, res, jest.fn());
    expect(feedSpy).toHaveBeenCalledWith(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'f-1' }],
    });
    feedSpy.mockRestore();
  });

  test('domainQueries getVendorsFromDB and countVendorsCreatedBetween caching and limit', async () => {
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(dbPool, 'query').mockImplementation(async (sql, params, opts) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: 42 }] };
      }
      return { rows: [{ id: 'v-1', raw: JSON.stringify({ id: 'v-1', name: 'Vendor 1' }) }] };
    });

    try {
      const vendorsLimited = await domainQueries.getVendorsFromDB(5);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        [5],
        expect.objectContaining({ useCache: true, tag: 'vendors' })
      );
      expect(vendorsLimited).toHaveLength(1);

      const count = await domainQueries.countVendorsCreatedBetween(new Date('2026-01-01'), new Date('2026-12-31'));
      expect(count).toBe(42);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.any(Array),
        expect.objectContaining({ useCache: true, tag: 'vendors' })
      );
    } finally {
      storageSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  test('buyerProfileQueries dispatch templates caching and invalidation', async () => {
    const { queryCache } = require('../src/db/queryCache');
    const buyerProfileQueries = require('../src/db/buyerProfileQueries');
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValue([
      { template_type: 'category_mapped', subject: 'Subj', message: 'Msg' }
    ]);
    const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rows: [] });

    try {
      const templates = await buyerProfileQueries.getDispatchTemplates('org-dispatch-1');
      expect(rowsSpy).toHaveBeenCalledWith(
        expect.stringContaining('vendor_dispatch_templates'),
        ['org-dispatch-1'],
        expect.objectContaining({ useCache: true, tag: 'vendor_dispatch_templates' })
      );
      expect(templates.category_mapped).toEqual({ subject: 'Subj', message: 'Msg' });

      await buyerProfileQueries.upsertDispatchTemplate('org-dispatch-1', 'category_mapped', { subject: 'New', message: 'Msg' });
      expect(invalidateSpy).toHaveBeenCalledWith('vendor_dispatch_templates');

      await buyerProfileQueries.upsertDispatchTemplate('org-dispatch-1', 'category_mapped', { subject: '', message: '' });
      expect(invalidateSpy).toHaveBeenCalledWith('vendor_dispatch_templates');
    } finally {
      invalidateSpy.mockRestore();
      storageSpy.mockRestore();
      rowsSpy.mockRestore();
      querySpy.mockRestore();
    }
  });

  test('storeService getVendors and candidateVendorsForRFQ with limit', async () => {
    storeService.vendors = [
      { id: 'v-lim-1', majorCategory: 'Electronics', name: 'Vendor Lim 1' },
      { id: 'v-lim-2', majorCategory: 'Electronics', name: 'Vendor Lim 2' },
      { id: 'v-lim-3', majorCategory: 'Electronics', name: 'Vendor Lim 3' },
    ];

    const vendorsAllLimited = await storeService.getVendors('all', 2);
    expect(vendorsAllLimited).toHaveLength(2);

    const candidates = storeService.candidateVendorsForRFQ({ category: 'Electronics' }, 1);
    expect(candidates).toHaveLength(1);
  });

  test('buyerProfileQueries loadCategories with cache options', async () => {
    const buyerProfileQueries = require('../src/db/buyerProfileQueries');
    const rowsSpy = jest.spyOn(dbPool, 'rows').mockImplementation(async (sql) => {
      if (sql.includes('from "user"')) {
        return [{ user_uuid: 'user-cat-1', org_uuid: 'org-1' }];
      }
      return [{ division: 'IT', category: 'Laptops' }];
    });
    try {
      await buyerProfileQueries.findProfileByUserId('user-cat-1');
      expect(rowsSpy).toHaveBeenCalledWith(
        expect.stringContaining('org_division_category'),
        ['user-cat-1'],
        expect.objectContaining({ useCache: true, tag: 'buyer_accounts' })
      );
    } finally {
      rowsSpy.mockRestore();
    }
  });

  test('authSessionQueries isTokenRevoked, revokeToken, and purgeExpiredAuthState cache management', async () => {
    const authSessionQueries = require('../src/db/authSessionQueries');
    const realAuth = authSessionQueries.__real || authSessionQueries;
    const { queryCache } = require('../src/db/queryCache');
    const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);
    const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
    const invalidateSpy = jest.spyOn(queryCache, 'invalidate');
    try {
      const isRevoked = await realAuth.isTokenRevoked('test-sig-1');
      expect(isRevoked).toBe(false);
      expect(rowsSpy).toHaveBeenCalledWith(
        expect.stringContaining('auth_revoked_tokens'),
        ['test-sig-1'],
        expect.objectContaining({ useCache: true, tag: 'auth_revoked_tokens' })
      );

      await realAuth.revokeToken('test-sig-2', Date.now() + 60000);
      expect(invalidateSpy).toHaveBeenCalledWith('auth_revoked_tokens');

      await realAuth.purgeExpiredAuthState();
      expect(invalidateSpy).toHaveBeenCalledWith('auth_revoked_tokens');
    } finally {
      rowsSpy.mockRestore();
      querySpy.mockRestore();
      invalidateSpy.mockRestore();
    }
  });

  test('vendorIngestionQueries findOrganizationCategoryMaster with cache options', async () => {
    const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValue([
      { division: 'IT', category: 'Laptops' },
      { division: 'IT', category: 'Monitors' },
    ]);
    try {
      const res = await vendorIngestionQueries.findOrganizationCategoryMaster('org-ingest-1');
      expect(res).toEqual([{ majorCategory: 'IT', minorCategories: ['Laptops', 'Monitors'] }]);
      expect(rowsSpy).toHaveBeenCalledWith(
        expect.stringContaining('org_division_category'),
        ['org-ingest-1'],
        expect.objectContaining({ useCache: true, tag: 'taxonomy' })
      );
    } finally {
      storageSpy.mockRestore();
      rowsSpy.mockRestore();
    }
  });

  test('graphql resolvers aiFeed forwards limit when caller is unrestricted', async () => {
    const rootResolvers = require('../src/graphql/resolvers');
    const getAIFeedSpy = jest.spyOn(storeService, 'getAIFeed').mockReturnValue([
      { id: 'feed-1', title: 'Feed 1' },
      { id: 'feed-2', title: 'Feed 2' },
    ]);
    try {
      const result = await rootResolvers.aiFeed({ limit: 5 }, { req: { user: { role: 'admin' } } });
      expect(getAIFeedSpy).toHaveBeenCalledWith(5);
      expect(result).toHaveLength(2);
    } finally {
      getAIFeedSpy.mockRestore();
    }
  });

  test('domainQueries vendor search and lookup queries pass cache options to pool.query', async () => {
    const domainQueries = require('../src/db/domainQueries');
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(dbPool, 'query').mockImplementation(async (sql, params, opts) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 42 }] };
      }
      return { rows: [{ raw: JSON.stringify({ id: 'v-cached-1', email: 'cached@vendor.com' }) }] };
    });

    try {
      // 1. countPublicVendorsMatchingCategories
      const count = await domainQueries.countPublicVendorsMatchingCategories(['industrial']);
      expect(count).toBe(42);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.any(Array),
        expect.objectContaining({ useCache: true, tag: 'vendors', ttlMs: 60000 })
      );

      // 2. getPublicVendorsMatchingCategories
      const list = await domainQueries.getPublicVendorsMatchingCategories(['industrial'], 10);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('v-cached-1');
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('SELECT raw FROM vendors'),
        expect.any(Array),
        expect.objectContaining({ useCache: true, tag: 'vendors', ttlMs: 60000 })
      );

      // 3. getVendorByEmailFromDB
      const vendorEmail = await domainQueries.getVendorByEmailFromDB('cached@vendor.com');
      expect(vendorEmail.id).toBe('v-cached-1');
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('lower(email) = lower($1)'),
        ['cached@vendor.com'],
        expect.objectContaining({ useCache: true, tag: 'vendors', ttlMs: 60000 })
      );

      // 4. getVendorByIdFromDB
      const vendorId = await domainQueries.getVendorByIdFromDB('v-cached-1');
      expect(vendorId.id).toBe('v-cached-1');
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['v-cached-1'],
        expect.objectContaining({ useCache: true, tag: 'vendors', ttlMs: 60000 })
      );
    } finally {
      storageSpy.mockRestore();
      querySpy.mockRestore();
    }
  });
});


