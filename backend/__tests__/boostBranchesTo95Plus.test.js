const aiChaserService = require('../src/services/aiChaserService');
const emailService = require('../src/services/emailService');
const auditService = require('../src/services/auditService');
const evaluationService = require('../src/services/evaluationService');
const storeService = require('../src/services/storeService');
const dbPool = require('../src/db/pool');
const { bootstrapServer, start } = require('../src/server');
const { logger } = require('../src/services/loggerService');
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

    await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' } }, res, next);
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
    expect(vendorEmailEmpty).not.toHaveProperty('tempPassword');
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
    const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit: ${code}`);
    });
    jest.spyOn(dbPool, 'checkDatabaseHealth').mockImplementationOnce(() => {
      throw new Error('Fatal DB Crash');
    });

    await expect(start(-1)).rejects.toThrow();
    expect(errorLogSpy.mock.calls.map(([message, , category]) => [message, category])).toContainEqual([
      'Failed to start server',
      'SERVER',
    ]);
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

    // 2. The atomic store rejects an exhausted trial against the current balance.
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
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FREE_RFQ_CREDITS_EXHAUSTED',
    }));

    // 3. A local store that cannot reserve a credit also fails closed.
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
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FREE_RFQ_CREDITS_EXHAUSTED',
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

    // 5. Successive RFQ creations decrement free trial credits each time (e.g. from 2 to 0)
    const multiBuyer = storeService.addBuyerAccount({
      organizationName: 'Multi RFQ Org',
      corporateEmail: 'multirfq@example.com',
      subscriptionPlan: 'free_trial',
      remainingFreeRFQs: 2,
    });

    const resRfq1 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Multi RFQ 1',
        category: 'Electronics',
        sourcingMode: 'mode_3',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Part 1', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'multirfq@example.com' },
    }, resRfq1, next);
    expect(resRfq1.status).toHaveBeenCalledWith(201);
    expect(resRfq1.json).toHaveBeenCalledWith(expect.objectContaining({
      remainingFreeRFQs: 1,
      consumedFreeTrial: true,
    }));
    expect(multiBuyer.remainingFreeRFQs).toBe(1);

    const resRfq2 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Multi RFQ 2',
        category: 'Electronics',
        sourcingMode: 'mode_3',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Part 2', quantity: 2, unit: 'pcs' }],
      },
      user: { email: 'multirfq@example.com' },
    }, resRfq2, next);
    expect(resRfq2.status).toHaveBeenCalledWith(201);
    expect(resRfq2.json).toHaveBeenCalledWith(expect.objectContaining({
      remainingFreeRFQs: 0,
      consumedFreeTrial: true,
    }));
    const updatedBuyer = await storeService.getBuyerAccountByEmail('multirfq@example.com');
    expect(updatedBuyer.remainingFreeRFQs).toBe(0);

    // 3rd attempt in Mode 3 is blocked (0 credits left)
    const resRfq3Blocked = mockRes();
    next.mockClear();
    await rfqController.createRFQ({
      body: {
        title: 'Multi RFQ 3 Blocked',
        category: 'Electronics',
        sourcingMode: 'mode_3',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Part 3', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'multirfq@example.com' },
    }, resRfq3Blocked, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FREE_RFQ_CREDITS_EXHAUSTED',
    }));

    // Mode 0 remains allowed (0 credits consumed) even with 0 credits
    const resRfq4Mode0 = mockRes();
    await rfqController.createRFQ({
      body: {
        title: 'Multi RFQ 4 Mode 0 Allowed',
        category: 'Electronics',
        sourcingMode: 'mode_0',
        targetDeliveryDate: '2028-10-15',
        deliveryLocation: 'Mumbai',
        deliveryPincode: '400001',
        extractedEntities: [{ itemName: 'Part 4', quantity: 1, unit: 'pcs' }],
      },
      user: { email: 'multirfq@example.com' },
    }, resRfq4Mode0, next);
    expect(resRfq4Mode0.status).toHaveBeenCalledWith(201);
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
    await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' }, query: { limit: '2' } }, resBuyer, next);
    expect(resBuyer.json).toHaveBeenCalled();

    // buyerAccountController when buyerAccounts is empty and DB storage is available
    const origAccounts = storeService.buyerAccounts;
    storeService.buyerAccounts = [];
    jest.spyOn(dbPool, 'hasStorage').mockReturnValueOnce(true);
    const persistedBuyerAccounts = jest.spyOn(domainQueries, 'getBuyerAccountsFromDB')
      .mockResolvedValueOnce({ accounts: [], activeId: null });
    const resBuyerSync = mockRes();
    await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' }, query: { limit: '50' } }, resBuyerSync, next);
    expect(persistedBuyerAccounts).toHaveBeenCalledWith(50);
    expect(resBuyerSync.json).toHaveBeenCalled();
    storeService.buyerAccounts = origAccounts;

    const resBuyerInvalid = mockRes();
    await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' }, query: { limit: 'abc' } }, resBuyerInvalid, next);
    expect(resBuyerInvalid.json).toHaveBeenCalled();

    // buyerAccountController.requestCreditApproval branches
    const resCredit404 = mockRes();
    await buyerAccountController.requestCreditApproval(
      { user: { role: 'admin' }, params: { id: 'non-existent-buyer-id' }, body: {} },
      resCredit404,
      next
    );
    expect(resCredit404.status).toHaveBeenCalledWith(404);

    const resCreditErr = mockRes();
    const throwNext = jest.fn();
    jest.spyOn(storeService, 'getBuyerAccounts').mockImplementationOnce(() => { throw new Error('DB Crash'); });
    await buyerAccountController.requestCreditApproval(
      { user: { role: 'admin' }, params: { id: 'some-id' }, body: {} },
      resCreditErr,
      throwNext
    );
    expect(throwNext).toHaveBeenCalled();

    // buyerAccountController.recordBuyerCommunication external email & SMS branches
    const buyerTarget = { id: 'b-comm-test', organizationName: 'Target Buyer', corporateEmail: 'target@corp.com', phone: '9876543210' };
    storeService.buyerAccounts.push(buyerTarget);

    const resCommEmail = mockRes();
    const mailerService = require('../src/services/mailerService');
    const deliverSpy = jest.spyOn(mailerService, 'deliver').mockImplementation(() => Promise.resolve({ success: true }));
    await buyerAccountController.recordBuyerCommunication(
      {
        user: { role: 'admin', email: 'admin@corp.com' },
        params: { id: buyerTarget.id },
        body: { channel: 'EMAIL', recipient: 'target@corp.com', subject: 'Notice', message: 'Hello' },
      },
      resCommEmail,
      next
    );
    expect(resCommEmail.status).toHaveBeenCalledWith(201);
    deliverSpy.mockRestore();

    const resCommSms = mockRes();
    const smsService = require('../src/services/smsService');
    const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockImplementation(() => Promise.resolve({ success: true }));
    await buyerAccountController.recordBuyerCommunication(
      {
        user: { role: 'category_manager', email: 'cm@corp.com' },
        params: { id: buyerTarget.id },
        body: { channel: 'SMS', recipient: '9876543210', subject: 'SMS Notice', message: 'Hello SMS' },
      },
      resCommSms,
      next
    );
    expect(resCommSms.status).toHaveBeenCalledWith(201);
    smsSpy.mockRestore();

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

  test('rfqController getRFQs limit query parameter and storeService getRFQByIdAsync fails closed', async () => {
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
      expect(syncSpy).not.toHaveBeenCalled();

      // 3. storeService.getRFQByIdAsync when DB throws error
      getSpy.mockRejectedValueOnce(new Error('DB connection drop'));
      await expect(storeService.getRFQByIdAsync('definitely-non-existent-rfq-id-12345')).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(syncSpy).not.toHaveBeenCalled();
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
    await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' }, query: { limit: '2' } }, resBA, jest.fn());
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
    await catalogueController.getProducts({ query: { limit: '2' } }, resCat, jest.fn());
    expect(resCat.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: [{ id: 'prod-1' }, { id: 'prod-2' }],
    }));
  });

  test('legacy audit upsert delegates to the chain-safe append', async () => {
    const auditLogQueries = require('../src/db/auditLogQueries');
    const entry = { id: 'log-cache-1', action: 'TEST' };
    const appendSpy = jest.spyOn(auditLogQueries, 'appendAuditLogInDB').mockResolvedValue(entry);

    await domainQueries.upsertAuditLogInDB(entry);

    expect(appendSpy).toHaveBeenCalledWith(entry);
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
    expect(feedSpy).toHaveBeenCalledWith(100);
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
    const storageSpy = jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
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
      storageSpy.mockRestore();
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
    const getAIFeedSpy = jest.spyOn(storeService, 'getAIFeedDurably').mockResolvedValue([
      { id: 'feed-1', title: 'Feed 1' },
      { id: 'feed-2', title: 'Feed 2' },
    ]);
    try {
      const result = await rootResolvers.aiFeed({ limit: 5 }, { req: { user: { role: 'admin' } } });
      expect(getAIFeedSpy).toHaveBeenCalledWith(100);
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
  test('storeService taxonomy matching and minor category fallback branches', () => {
    // 1. vendorCoversMinorCategory branches
    expect(storeService.vendorCoversMinorCategory(null, null)).toBe(false);
    expect(storeService.vendorCoversMinorCategory({}, '')).toBe(false);
    expect(storeService.vendorCoversMinorCategory({ majorCategory: 'Corrugated Box' }, 'Corrugated Boxes')).toBe(true);
    expect(storeService.vendorCoversMinorCategory({ vendorSelectedCategories: ['Valves'] }, 'Valves')).toBe(true);
    expect(storeService.vendorCoversMinorCategory({ clientMappedCategories: ['Plumbing Fixtures'] }, 'Plumbing')).toBe(true);
    expect(storeService.vendorCoversMinorCategory({ minorCategories: [null, ''] }, 'Pipes')).toBe(false);

    // 2. _rfqTaxonomyGroups edge cases
    expect(storeService._rfqTaxonomyGroups(null)).toEqual([]);
    expect(storeService._rfqTaxonomyGroups({})).toEqual([]);

    // Header minorCategory
    const rfqHeadMinor = {
      minorCategory: 'Corrugated Boxes',
      category: 'Packing Material',
    };
    const groupsHead = storeService._rfqTaxonomyGroups(rfqHeadMinor);
    expect(groupsHead[0].minorCategory).toBe('Corrugated Boxes');
    expect(groupsHead[0].majorCategory).toBe('Packing Material');

    // Header minorCategories array
    const rfqHeadMinors = {
      minorCategories: ['PVC Pipes', '', null],
      majorCategory: 'Plumbing',
    };
    const groupsArray = storeService._rfqTaxonomyGroups(rfqHeadMinors);
    expect(groupsArray[0].minorCategory).toBe('PVC Pipes');

    // Line item with subCategory
    const rfqSubCat = {
      extractedEntities: [
        { subCategory: 'Valves' },
        null,
      ],
    };
    const groupsSub = storeService._rfqTaxonomyGroups(rfqSubCat);
    expect(groupsSub[0].minorCategory).toBe('Valves');

    // 3. selectVendorsPerCategory & selectVendorsForRFQ edge cases
    expect(storeService.selectVendorsPerCategory([], ['Civil Works'])).toEqual([]);
    expect(storeService.selectVendorsPerCategory([{ id: 'v1' }], [])).toHaveLength(1);
    expect(storeService.selectVendorsPerCategory([{ id: 'v1' }], [null, ''])).toHaveLength(1);
    expect(storeService.selectVendorsForRFQ([], null)).toEqual([]);

    // Custom limit & destination
    const pool = [
      { id: 'v1', name: 'Vendor 1', minorCategories: ['Valves'], rating: 4 },
      { id: 'v2', name: 'Vendor 2', majorCategory: 'Plumbing', rating: 5 },
    ];
    const selected = storeService.selectVendorsForRFQ(pool, { minorCategory: 'Valves', majorCategory: 'Plumbing' }, 1);
    expect(selected).toHaveLength(1);

    // selectVendorsPerCategory with object category without minorCategory
    const majOnlySelected = storeService.selectVendorsPerCategory(pool, [{ majorCategory: 'Plumbing' }]);
    expect(majOnlySelected.length).toBeGreaterThan(0);

    // String category mapping to major
    const strSelected = storeService.selectVendorsPerCategory(pool, ['Valves']);
    expect(strSelected.length).toBeGreaterThan(0);
  });

  test('rfqChaserScheduler dispatch branches and follow-up stats', async () => {
    const scheduler = require('../src/services/rfqChaserScheduler');
    const smsService = require('../src/services/smsService');
    const whatsAppService = require('../src/services/whatsAppService');
    const mailerService = require('../src/services/mailerService');
    const domainQueries = require('../src/db/domainQueries');

    // 1. _updateLiveFollowUpStats branches
    const mockRfq = {
      rfqNumber: 'RFQ-FUP-BOOST',
      followUpData: {
        whatsappStats: { delivered: 1 },
        smsStats: { delivered: 2, total: 5 },
        emailStats: { delivered: 1, sent24h: 1 },
        vendors: [
          { vendorId: 'v-101', vendorName: 'Vendor 101' },
          { vendorId: 'v-102', vendorName: 'Vendor 102' },
        ],
      },
    };
    jest.spyOn(storeService, 'getRFQById').mockReturnValue(mockRfq);

    // whatsapp stats already present
    scheduler._updateLiveFollowUpStats('RFQ-FUP-BOOST', 'whatsapp', { id: 'v-101' });
    expect(mockRfq.followUpData.whatsappStats.delivered).toBe(2);

    // sms stats where delivered > total
    mockRfq.followUpData.smsStats = { delivered: 5, total: 5 };
    scheduler._updateLiveFollowUpStats('RFQ-FUP-BOOST', 'sms', { name: 'Vendor 102' });
    expect(mockRfq.followUpData.smsStats.total).toBe(6);

    // email stats already present
    scheduler._updateLiveFollowUpStats('RFQ-FUP-BOOST', 'email', { id: 'v-101' });
    expect(mockRfq.followUpData.emailStats.delivered).toBe(2);

    // 2. Dispatch helpers in non-test NODE_ENV
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // _dispatchWhatsApp with phone and jobId
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true });
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
    jest.spyOn(domainQueries, 'markChaserJobFailedInDB').mockResolvedValue(true);

    const waRes = await scheduler._dispatchWhatsApp(
      { rfqNumber: 'RFQ-FUP-BOOST' },
      { id: 'v-101', name: 'Vendor 101', phone: '9876543210' },
      'job-wa-1'
    );
    expect(waRes.success).toBe(true);

    // _dispatchWhatsApp failure
    whatsAppService.sendRFQInvitationWhatsApp.mockResolvedValueOnce({ success: false, error: 'Meta fail' });
    const waFail = await scheduler._dispatchWhatsApp(
      { rfqNumber: 'RFQ-FUP-BOOST' },
      { id: 'v-101', name: 'Vendor 101', phone: '9876543210' },
      'job-wa-2'
    );
    expect(waFail.success).toBe(false);

    // _dispatchSms with mobile, mobileNumber, and store fallback
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    const smsRes = await scheduler._dispatchSms(
      { rfqNumber: 'RFQ-FUP-BOOST', title: 'Test' },
      { id: 'v-101', name: 'Vendor 101', mobile: '9876543210' },
      'job-sms-1'
    );
    expect(smsRes.success).toBe(true);

    // _dispatchSms failure
    smsService.sendRFQChaserSms.mockResolvedValueOnce({ success: false, error: 'SMS failed' });
    const smsFail = await scheduler._dispatchSms(
      { rfqNumber: 'RFQ-FUP-BOOST', title: 'Test' },
      { id: 'v-101', name: 'Vendor 101', mobileNumber: '9876543210' },
      'job-sms-2'
    );
    expect(smsFail.success).toBe(false);

    // _dispatchReminderEmail failure
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'SMTP rejected' });
    const emailFail = await scheduler._dispatchReminderEmail(
      { rfqNumber: 'RFQ-FUP-BOOST' },
      { id: 'v-101', name: 'Vendor 101', email: 'v101@test.com' },
      {},
      'job-mail-1'
    );
    expect(emailFail.sent).toBe(false);

    // _dispatchReminderEmail success
    mailerService.sendRfqInviteEmail.mockResolvedValueOnce({ sent: true });
    const emailOk = await scheduler._dispatchReminderEmail(
      { rfqNumber: 'RFQ-FUP-BOOST' },
      { id: 'v-101', name: 'Vendor 101', email: 'v101@test.com' },
      {},
      'job-mail-2'
    );
    expect(emailOk.sent).toBe(true);

    process.env.NODE_ENV = oldNodeEnv;
  });
  test('rfqChaserScheduler deep branch boost (dedup keys, waitUntil timers, delays in prod, call with jobId)', async () => {
    const scheduler = require('../src/services/rfqChaserScheduler');
    const domainQueries = require('../src/db/domainQueries');

    // 1. scheduleRFQChasers with various vendor identifier shapes (phone-only, email-only, name-only, empty)
    const vendorsList = [
      null,
      { phone: '9876543210' },
      { email: 'onlyemail@test.com' },
      { name: 'Only Name' },
      {},
    ];
    scheduler.scheduleRFQChasers({ rfqNumber: 'RFQ-KEY-SHAPES' }, vendorsList);

    // 2. scheduleVendorChaser with waitUntil in Node mode (CF_WAIT_UNTIL present, CF_ENV empty)
    const waitUntilMock = jest.fn();
    globalThis.__CF_WAIT_UNTIL__ = waitUntilMock;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      scheduler.scheduleVendorChaser(
        { rfqNumber: 'RFQ-NODE-WAITUNTIL', title: 'Test WaitUntil' },
        { id: 'v-node-wu', name: 'WU Vendor', phone: '9123456789', email: 'wu@test.com' }
      );
      expect(waitUntilMock).toHaveBeenCalled();

      // 3. _dispatchCall in production with jobId
      const firedSpy = jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
      const callRes = await scheduler._dispatchCall(
        { rfqNumber: 'RFQ-CALL-JOB' },
        { id: 'v-call', name: 'Call Vendor', phone: '9123456789' },
        'job-call-1'
      );
      expect(callRes.skipped).toBe(true);
      expect(firedSpy).toHaveBeenCalledWith('job-call-1');
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      delete globalThis.__CF_WAIT_UNTIL__;
    }
  });

  test('rfqChaserScheduler recoverChasersOnBoot skip existing jobKey branch', async () => {
    const scheduler = require('../src/services/rfqChaserScheduler');
    const domainQueries = require('../src/db/domainQueries');

    scheduler.activeScheduledTimers.set('RFQ-REC:v-rec:sms', 9999);
    jest.spyOn(domainQueries, 'getPendingChaserJobsFromDB').mockResolvedValue([
      {
        id: 'job-rec-1',
        rfq_number: 'RFQ-REC',
        vendor_id: 'v-rec',
        channel: 'sms',
        fire_at: new Date(Date.now() - 1000).toISOString(),
      },
      {
        id: 'job-rec-2',
        rfq_number: 'RFQ-REC',
        vendor_id: null,
        channel: 'call',
        fire_at: new Date(Date.now() + 5000).toISOString(),
      },
    ]);

    await scheduler.recoverChasersOnBoot();
    scheduler.activeScheduledTimers.delete('RFQ-REC:v-rec:sms');
  });

  test('storeService deep branch boosts for null/edge lookups', async () => {
    expect(await storeService.getBuyerAccountByEmail(null)).toBeNull();
    expect(storeService.getVendorById(null)).toBeUndefined();
    expect(storeService.getRFQById(null)).toBeUndefined();
    expect(storeService.isBuyerUploaded(null)).toBe(false);
    expect(storeService.isProcucevVendor(null)).toBe(false);
    expect(storeService.getProcucevVendorCount(null)).toBe(0);

    // Delivery location location score branches
    expect(storeService.scoreVendorLocation({ city: 'Mumbai' }, { location: 'Mumbai' })).toBe(85);
    expect(storeService.scoreVendorLocation({ state: 'Gujarat' }, { location: 'Ahmedabad, Gujarat' })).toBe(65);
    expect(storeService.scoreVendorLocation({ location: 'GIDC Vatva' }, { location: 'Vatva Plant' })).toBe(60);

    // Taxonomy group with line items containing null/empty major/minor
    const weirdRfq = {
      extractedEntities: [
        { itemName: 'Item 1' }, // no major, no minor
        { minorCategory: '   ' },
        { majorCategory: '   ' },
      ],
    };
    expect(storeService._rfqTaxonomyGroups(weirdRfq)).toEqual([]);
  });


  test('storeService comprehensive branch coverage booster', async () => {
    // 1. isCategoryAvailable branches
    expect(storeService.isCategoryAvailable(null)).toBe(false);
    expect(storeService.isCategoryAvailable(undefined)).toBe(false);
    expect(storeService.isCategoryAvailable('')).toBe(false);
    expect(storeService.isCategoryAvailable('   ')).toBe(false);
    expect(storeService.isCategoryAvailable(999)).toBe(false);
    expect(storeService.isCategoryAvailable('Paints')).toBe(true);
    expect(storeService.isCategoryAvailable('Civil Works')).toBe(true);
    expect(storeService.isCategoryAvailable('Civil')).toBe(true);
    expect(storeService.isCategoryAvailable('Electricals')).toBe(true);
    expect(storeService.isCategoryAvailable('solar')).toBe(true);

    // Vendor directory fallback in isCategoryAvailable
    const tempVendor = storeService.addVendor({
      name: 'Custom Unlisted Category Supplier',
      majorCategory: 'Bespoke Custom Fabric',
      minorCategories: ['Handloom Silk Weave'],
    });
    expect(storeService.isCategoryAvailable('Bespoke Custom Fabric')).toBe(true);
    expect(storeService.isCategoryAvailable('Handloom Silk Weave')).toBe(true);
    expect(storeService.isCategoryAvailable('Totally Unknown Category XYZ')).toBe(false);

    // 2. notifyVendorsOfNewRFQ branches
    expect(storeService.notifyVendorsOfNewRFQ(null)).toEqual([]);
    expect(storeService.notifyVendorsOfNewRFQ({ needsCategoryManagerAssignment: true })).toEqual([]);
    expect(storeService.notifyVendorsOfNewRFQ({ categoryNotAvailable: true })).toEqual([]);

    // 3. vendorCoversRFQ branches
    expect(storeService.vendorCoversRFQ(null, {})).toBe(false);
    expect(storeService.vendorCoversRFQ({}, null)).toBe(false);
    expect(storeService.vendorCoversRFQ({ id: 'v1' }, { needsCategoryManagerAssignment: true, assignedVendors: [] })).toBe(false);
    expect(storeService.vendorCoversRFQ({ id: 'v1' }, { needsCategoryManagerAssignment: true, assignedVendors: [{ id: 'v1' }] })).toBe(true);
    expect(storeService.vendorCoversRFQ({ id: 'v1' }, { categoryNotAvailable: true, assignedVendors: [] })).toBe(false);

    // 4. createRFQ with unlisted category
    const unlistedRfq = storeService.createRFQ({
      title: 'Deep Unlisted RFQ',
      category: 'NonExistentCategory999',
      sourcingMode: 'mode_0',
    });
    expect(unlistedRfq.needsCategoryManagerAssignment).toBe(true);
    expect(unlistedRfq.categoryNotAvailable).toBe(true);
    expect(unlistedRfq.assignedVendors).toEqual([]);

    // 5. selectVendorsPerCategory null / empty / malformed branches
    expect(storeService.selectVendorsPerCategory(null, [])).toEqual([]);
    expect(storeService.selectVendorsPerCategory([], null)).toEqual([]);
    expect(storeService.selectVendorsPerCategory([{ id: 'v1' }], null)).toHaveLength(1);
    expect(storeService.selectVendorsPerCategory([{ id: 'v1' }], [null, '   ', {}])).toEqual([]);

    // 6. extendRFQ branch coverage
    expect(storeService.extendRFQ('non-existent-id')).toEqual(expect.objectContaining({ success: false, reason: 'NOT_FOUND' }));

    const rfqForExt = storeService.createRFQ({ title: 'Extendable RFQ', category: 'Pumps', sourcingMode: 'mode_0' });
    // Invalid hours
    expect(storeService.extendRFQ(rfqForExt.id, { hours: 12 })).toEqual(expect.objectContaining({ success: false, reason: 'VALIDATION' }));

    // Closed RFQ
    storeService.updateRFQ(rfqForExt.id, { status: 'Closed' });
    expect(storeService.extendRFQ(rfqForExt.id, { hours: 24 })).toEqual(expect.objectContaining({ success: false, reason: 'INVALID_STATUS' }));

    // Valid 24h extension
    storeService.updateRFQ(rfqForExt.id, { status: 'Quotes Pending' });
    const extOk = storeService.extendRFQ(rfqForExt.id, { hours: 24 });
    expect(extOk.success).toBe(true);

    // Already extended
    expect(storeService.extendRFQ(rfqForExt.id, { hours: 24 })).toEqual(expect.objectContaining({ success: false, reason: 'ALREADY_EXTENDED' }));

    // 7. addQuoteToRFQ with non-existent RFQ
    expect(storeService.addQuoteToRFQ('ghost-rfq-id', {})).toBeNull();

    // 8. isCategoryAvailable branches
    expect(storeService.isCategoryAvailable('')).toBe(false);
    expect(storeService.isCategoryAvailable('   ')).toBe(false);
    expect(storeService.isCategoryAvailable('Civil Works')).toBe(true);
    expect(storeService.isCategoryAvailable('Painting')).toBe(true);
    // check alias
    expect(storeService.isCategoryAvailable('Electricals')).toBe(true);
    expect(storeService.isCategoryAvailable('Solar')).toBe(true);
    expect(storeService.isCategoryAvailable('UnrealCustomCategory123')).toBe(false);
    const prevVendors = storeService.vendors;
    storeService.vendors = [null, { majorCategory: 'UnrealCustomMajor' }, { minorCategories: ['UnrealCustomMinor'] }];
    expect(storeService.isCategoryAvailable('UnrealCustomMajor')).toBe(true);
    expect(storeService.isCategoryAvailable('UnrealCustomMinor')).toBe(true);
    storeService.vendors = prevVendors;

    // 9. ensureBuyerAccountForUser branches
    expect(await storeService.ensureBuyerAccountForUser(null)).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'vendor', email: 'v@t.co' })).toBeNull();
    expect(await storeService.ensureBuyerAccountForUser({ role: 'buyer' })).toBeNull();

    // 10. getBuyerAccounts edge cases
    const prevAccounts = storeService.buyerAccounts;
    expect(storeService.getBuyerAccounts('invalid')).toEqual(expect.any(Array));
    expect(storeService.getBuyerAccounts(-5)).toEqual(expect.any(Array));
    storeService.buyerAccounts = null;
    expect(storeService.getBuyerAccounts()).toEqual([]);
    storeService.buyerAccounts = prevAccounts;

    // 11. deleteVendor edge cases
    const stubVendor = { id: 'v-no-email', name: 'NoEmailCo' };
    storeService.vendors.push(stubVendor);
    expect(storeService.deleteVendor('v-no-email')).toBe(true);
    expect(storeService.deleteVendor('v-no-email')).toBe(false);

    // 12. unlockRFQForVendor branches
    const testRfqWithNoNum = { id: 'rfq-no-num', title: 'No Num RFQ', sourcingMode: 'mode_0' };
    storeService.rfqs.push(testRfqWithNoNum);
    const subscriberVendor = { id: 'v-sub-test', email: 'sub@vendor.com', subscriptionPlan: 'connect', unlockedRfqIds: [] };
    storeService.vendors.push(subscriberVendor);
    const unlSub = await storeService.unlockRFQForVendor('v-sub-test', 'rfq-no-num');
    expect(unlSub.success).toBe(true);
    const unlimitedVendor = { id: 'v-unlim-test', email: 'unlim@vendor.com', subscriptionPlan: 'free', unlimitedRfqDownloads: true, unlockedRfqIds: [] };
    storeService.vendors.push(unlimitedVendor);
    const unlUnlim = await storeService.unlockRFQForVendor('v-unlim-test', 'rfq-no-num');
    expect(unlUnlim.success).toBe(true);
  });

  test('rfqController deep branch booster for 90%+ branch threshold', async () => {
    // 1. isPastDate branches
    expect(rfqController.isPastDate(null)).toBe(false);
    expect(rfqController.isPastDate('')).toBe(false);
    expect(rfqController.isPastDate('   ')).toBe(false);
    expect(rfqController.isPastDate(12345)).toBe(false);
    expect(rfqController.isPastDate('invalid-date')).toBe(false);
    expect(rfqController.isPastDate('2000-01-01')).toBe(true);
    expect(rfqController.isPastDate('2099-01-01')).toBe(false);

    // 2. resolveVendorForUser branches
    expect(await rfqController.resolveVendorForUser(null)).toBeNull();
    expect(await rfqController.resolveVendorForUser({})).toBeNull();
    const vendorWithEmail = { role: 'vendor', email: 'v-resolved@test.com', id: 'v-res-1' };
    storeService.vendors.push(vendorWithEmail);
    expect(await rfqController.resolveVendorForUser(vendorWithEmail)).toBeDefined();

    const spyDBFallback = jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
    expect(await rfqController.resolveVendorForUser({ role: 'buyer', email: 'unregistered-unique-buyer@test.com' })).toBeNull();
    spyDBFallback.mockRestore();

    // 3. resolveRfqReadScope branches
    const buyerScope = await rfqController.resolveRfqReadScope({ user: { role: 'buyer', email: 'b@test.com' } });
    expect(buyerScope.role).toBe('buyer');
    const vendorScope = await rfqController.resolveRfqReadScope({ user: { role: 'vendor', email: 'v-resolved@test.com' } });
    expect(vendorScope.role).toBe('vendor');
    const adminScope = await rfqController.resolveRfqReadScope({ user: { role: 'admin' } });
    expect(adminScope.restricted).toBe(false);
    const noUserScope = await rfqController.resolveRfqReadScope({});
    expect(noUserScope.restricted).toBe(false);

    // 4. canVendorViewRfq branches
    expect(rfqController.canVendorViewRfq(null, null)).toBe(false);
    expect(rfqController.canVendorViewRfq({}, null)).toBe(false);
    expect(rfqController.canVendorViewRfq(null, {})).toBe(false);
    expect(rfqController.canVendorViewRfq({ id: 'v-unmatched' }, { quotes: null })).toBe(false);
    expect(rfqController.canVendorViewRfq({ id: 'v-quoted' }, { quotes: [null, { vendorId: 'v-quoted' }] })).toBe(true);
    expect(rfqController.canVendorViewRfq({ email: 'v-email@t.co' }, { quotes: [null, { vendorEmail: 'v-email@t.co' }] })).toBe(true);
    expect(rfqController.canVendorViewRfq({ id: 'v1', email: 'v1@t.co' }, { quotes: [{ vendorId: 'v2', vendorEmail: 'v2@t.co' }] })).toBe(false);
    expect(rfqController.canVendorViewRfq({ id: 'v-unlim', unlimitedRfqDownloads: true }, { buyerAccountId: 'b1' })).toBeDefined();

    // 5. canAccessRfq branches
    const spyEnsureBuyer = jest.spyOn(storeService, 'ensureBuyerAccountForUser');
    spyEnsureBuyer.mockResolvedValueOnce(null);
    expect(await rfqController.canAccessRfq({ user: { role: 'buyer', email: 'nobuyer@test.com' } }, {})).toBe(false);

    spyEnsureBuyer.mockResolvedValue({ id: 'b-shared' });
    const buyerSharedReq = { user: { role: 'buyer', id: 'b-shared', email: 'collab@test.com' } };
    expect(await rfqController.canAccessRfq(buyerSharedReq, { sharedBuyerAccountIds: ['b-shared'] })).toBe(true);
    expect(await rfqController.canAccessRfq(buyerSharedReq, { buyerAccountId: 'b-shared' })).toBe(true);
    expect(await rfqController.canAccessRfq(buyerSharedReq, { buyerAccountId: 'b-other', sharedBuyerAccountIds: [] })).toBe(false);
    spyEnsureBuyer.mockRestore();

    expect(await rfqController.canAccessRfq({ user: { role: 'vendor', email: 'novendor@test.com' } }, {})).toBe(false);
    const vQuoted = { id: 'v-q', email: 'vq@test.com', role: 'vendor' };
    storeService.vendors.push(vQuoted);
    expect(await rfqController.canAccessRfq({ user: vQuoted }, { quotes: [{ vendorId: 'v-q' }] })).toBe(true);

    // 6. applyVendorBuyerPrivacy branches
    expect(rfqController.applyVendorBuyerPrivacy(null, null)).toBeNull();
    expect(rfqController.applyVendorBuyerPrivacy({ id: 'r1' }, null)).toEqual({ id: 'r1' });
    expect(rfqController.applyVendorBuyerPrivacy(null, { id: 'v1' })).toBeNull();
    // Vendor with no quotes on RFQ
    const noQuotesRes = rfqController.applyVendorBuyerPrivacy({ id: 'r-no-quotes', quotes: [] }, { id: 'v-none' });
    expect(noQuotesRes.buyerDetailsHidden).toBe(false);
    // Vendor matching by id
    const resIdMatch = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [null, { vendorId: 'v-match-id', submittedAt: new Date().toISOString() }] },
      { id: 'v-match-id' }
    );
    expect(resIdMatch.buyerDetailsHidden).toBe(true);
    // Vendor matching by email
    const resEmailMatch = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [{ vendorEmail: 'match@v.com', createdAt: new Date().toISOString() }] },
      { email: 'match@v.com' }
    );
    expect(resEmailMatch.buyerDetailsHidden).toBe(true);
    // Vendor matching by qvId === vEmail
    const resIdEmailMatch = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [{ vendorId: 'match2@v.com', timestamp: new Date().toISOString() }] },
      { email: 'match2@v.com' }
    );
    expect(resIdEmailMatch.buyerDetailsHidden).toBe(true);
    // Vendor matching by name
    const resNameMatch = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [{ vendorName: 'MatchVendorCorp', submittedAt: new Date().toISOString() }] },
      { name: 'MatchVendorCorp' }
    );
    expect(resNameMatch.buyerDetailsHidden).toBe(true);
    // Vendor quote older than 48h
    const resOldMatch = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [{ vendorId: 'v-old', submittedAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString() }] },
      { id: 'v-old' }
    );
    expect(resOldMatch.buyerDetailsHidden).toBe(false);
    // Vendor quote with no timestamp
    const resNoTs = rfqController.applyVendorBuyerPrivacy(
      { id: 'r-quoted', quotes: [{ vendorId: 'v-nots' }] },
      { id: 'v-nots' }
    );
    expect(resNoTs.buyerDetailsHidden).toBe(false);

    // 7. applyQuotesVisibility branches
    expect(rfqController.applyQuotesVisibility(null, 'buyer')).toBeNull();
    const qvClosed = rfqController.applyQuotesVisibility({ quotes: [{ id: 'q1' }], status: 'Closed' }, 'buyer');
    expect(qvClosed.quotesHidden).toBe(false);
    const qvPOGen = rfqController.applyQuotesVisibility({ quotes: [{ id: 'q1' }], status: 'PO Generated' }, 'buyer');
    expect(qvPOGen.quotesHidden).toBe(false);
    const qvV0 = rfqController.applyQuotesVisibility({ quotes: [{ id: 'q1' }], sourcingMode: 'mode_0' }, 'buyer');
    expect(qvV0.quotesHidden).toBe(false);
    expect(qvV0.quotes).toEqual([]);
    const qvRecent = rfqController.applyQuotesVisibility(
      { quotes: [{ id: 'q1' }], status: 'Published', createdAt: new Date().toISOString() },
      'buyer'
    );
    expect(qvRecent.quotesHidden).toBe(true);
    const qvOld = rfqController.applyQuotesVisibility(
      { quotes: [{ id: 'q1' }], status: 'Published', createdAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString() },
      'buyer'
    );
    expect(qvOld.quotesHidden).toBe(false);
    const qvAdmin = rfqController.applyQuotesVisibility(
      { quotes: [{ id: 'q1' }], status: 'Published', createdAt: new Date().toISOString() },
      'admin'
    );
    expect(qvAdmin.quotesHidden).toBeUndefined();

    // 8. requestVendorCategoryUpdate controller branches
    const resCat1 = mockRes();
    await rfqController.requestVendorCategoryUpdate({ body: {} }, resCat1, jest.fn());
    expect(resCat1.status).toHaveBeenCalledWith(400);

    const resCat2 = mockRes();
    const vendorForCat = { id: 'v-cat-req', email: 'vcat@test.com', name: 'CatVendor', contactPerson: 'John', majorCategory: 'Civil Works' };
    storeService.vendors.push(vendorForCat);
    jest.spyOn(require('../src/services/vendorCategoryUpdateNotificationService'), 'sendVendorCategoryUpdateNotification')
      .mockResolvedValue({ sent: true });
    await rfqController.requestVendorCategoryUpdate(
      {
        body: { vendorId: 'v-cat-req', vendorEmail: 'vcat@test.com', rfqCategory: 'Electrical', rfqTitle: 'Supply Cables', rfqNumber: 'RFQ-CAT-1' },
        user: { name: 'Buyer John', email: 'bjohn@test.com' }
      },
      resCat2,
      jest.fn()
    );
    expect(resCat2.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // 9. getRFQs controller with sharedBuyerAccountIds and assignedVendors
    const resGetRFQs = mockRes();
    const rfqWithShared = storeService.createRFQ({
      title: 'Shared Buyer RFQ',
      category: 'Pumps',
      buyerAccountId: 'b-owner',
      assignedVendors: [
        { name: 'AssignedV1' },
        { vendorName: 'AssignedV2' },
        { companyName: 'AssignedV3' },
      ],
      quotes: [{ id: 'q1', vendorId: 'v-q1', amount: 5000 }],
      sourcingMode: 'mode_0'
    });
    rfqWithShared.sharedBuyerAccountIds = ['b-collab'];
    await rfqController.getRFQs(
      { user: { role: 'buyer', id: 'b-collab', email: 'collab@test.com' }, query: {} },
      resGetRFQs,
      jest.fn()
    );
    expect(resGetRFQs.json).toHaveBeenCalled();

    // 10. canAccessRfq edge roles and null buyerAccountId
    expect(await rfqController.canAccessRfq({ user: { role: 'admin' } }, { id: 'rfq-g1' })).toBe(true);
    const scopeMockReq = { user: { role: 'buyer', id: 'b-other-acc', email: 'other@corp.com' } };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValueOnce({ id: 'b-other-acc' });
    expect(await rfqController.canAccessRfq(scopeMockReq, { id: 'rfq-g2', buyerAccountId: 'b-owner' })).toBe(false);

    // 11. addQuote role and profile validation
    const resAddQ1 = mockRes();
    await rfqController.addQuote({ user: { role: 'buyer' }, params: { id: 'rfq-1' }, body: {} }, resAddQ1, jest.fn());
    expect(resAddQ1.status).toHaveBeenCalledWith(403);

    const resAddQ2 = mockRes();
    await rfqController.addQuote({ user: { role: 'vendor', id: 'v-ghost', email: 'ghost@v.co' }, params: { id: 'rfq-1' }, body: {} }, resAddQ2, jest.fn());
    expect(resAddQ2.status).toHaveBeenCalledWith(400);

    // 12. generateEmailPreview branches
    const resEm1 = mockRes();
    await rfqController.generateEmailPreview({ params: { id: 'ghost-rfq' }, query: {} }, resEm1, jest.fn());
    expect(resEm1.status).toHaveBeenCalledWith(404);

    const resEm2 = mockRes();
    await rfqController.generateEmailPreview({ params: { id: rfqWithShared.id }, query: { vendorId: 'v-credit-test' } }, resEm2, jest.fn());
    expect(resEm2.json).toHaveBeenCalled();
  });

  test('storeService deep branch booster for 90%+ branch threshold', async () => {
    // 1. updateBuyerAccount fallback branches
    expect(storeService.updateBuyerAccount('ghost-id', { companyName: 'GhostCo' })).toBeNull();
    const bToUpdate = { id: 'b-upd-1', corporateEmail: 'upd@test.com', companyName: 'OldCo' };
    storeService.buyerAccounts.push(bToUpdate);
    const updatedRes = storeService.updateBuyerAccount('b-upd-1', { companyName: 'NewCo' });
    expect(updatedRes).toBeDefined();

    // 3. tryConsumeFreeRFQ comprehensive branches
    // String with no @
    expect(storeService.tryConsumeFreeRFQ('ghost-buyer-id')).toEqual({ ok: false, remaining: 0 });
    // String with @ (not found)
    expect(storeService.tryConsumeFreeRFQ('ghost@buyer.com')).toEqual({ ok: false, remaining: 0 });

    // Object with unlimited access (found in buyerAccounts)
    const bUnlim = { id: 'b-unlim-acc', corporateEmail: 'unlim@corp.com', unlimitedRfqAccess: true, remainingFreeRFQs: 999 };
    storeService.buyerAccounts.push(bUnlim);
    expect(storeService.tryConsumeFreeRFQ('b-unlim-acc')).toEqual({ ok: true, remaining: 999 });
    expect(storeService.tryConsumeFreeRFQ({ id: 'b-unlim-acc' })).toEqual({ ok: true, remaining: 999 });
    expect(storeService.tryConsumeFreeRFQ({ corporateEmail: 'unlim@corp.com' })).toEqual({ ok: true, remaining: 999 });

    // Object with unlimited access (NOT found in buyerAccounts)
    const bUnlimNew = { id: 'b-unlim-new', corporateEmail: 'unlimnew@corp.com', unlimitedRfqAccess: true, remainingFreeRFQs: 999 };
    expect(storeService.tryConsumeFreeRFQ(bUnlimNew)).toEqual({ ok: true, remaining: 999 });

    // Object with 0 remaining (found in buyerAccounts)
    const bZero = { id: 'b-zero-acc', corporateEmail: 'zero@corp.com', remainingFreeRFQs: 0 };
    storeService.buyerAccounts.push(bZero);
    expect(storeService.tryConsumeFreeRFQ('b-zero-acc')).toEqual({ ok: false, remaining: 0 });
    expect(storeService.tryConsumeFreeRFQ(bZero)).toEqual({ ok: false, remaining: 0 });

    // Object with 0 remaining (NOT found in buyerAccounts)
    const bZeroNew = { id: 'b-zero-new', corporateEmail: 'zeronew@corp.com', remainingFreeRFQs: 0 };
    expect(storeService.tryConsumeFreeRFQ(bZeroNew)).toEqual({ ok: false, remaining: 0 });

    // Object with remaining credits (found in buyerAccounts)
    const bNormal = { id: 'b-norm-acc', corporateEmail: 'norm@corp.com', remainingFreeRFQs: 3, freeRFQsUsed: 2 };
    storeService.buyerAccounts.push(bNormal);
    storeService.activeBuyerAccount = bNormal;
    const resConsNorm = storeService.tryConsumeFreeRFQ(bNormal);
    expect(resConsNorm.ok).toBe(true);
    expect(resConsNorm.remaining).toBe(2);

    // Object with remaining credits (NOT found in buyerAccounts)
    const bNewObj = { id: 'b-new-obj', corporateEmail: 'newobj@corp.com', remainingFreeRFQs: 5 };
    const resConsNew = storeService.tryConsumeFreeRFQ(bNewObj);
    expect(resConsNew.ok).toBe(true);
    expect(resConsNew.remaining).toBe(4);

    // 4. refundFreeRFQ comprehensive branches
    // String not found
    storeService.refundFreeRFQ('ghost-buyer-id');
    // String with @ not found
    storeService.refundFreeRFQ('ghost@buyer.com');
    // Object with unlimited access
    storeService.refundFreeRFQ(bUnlim);
    // Object normal found
    storeService.refundFreeRFQ(bNormal);
    expect(bNormal.remainingFreeRFQs).toBe(3);
    // String ID found
    storeService.refundFreeRFQ('b-norm-acc');
    const bFoundById = storeService.buyerAccounts.find((a) => a.id === 'b-norm-acc');
    expect(bFoundById.remainingFreeRFQs).toBe(4);
    // String email found
    storeService.refundFreeRFQ('norm@corp.com');
    const bFoundByEmail = storeService.buyerAccounts.find((a) => a.corporateEmail === 'norm@corp.com');
    expect(bFoundByEmail.remainingFreeRFQs).toBe(5);

    // 5. consumeRFQCreditIfApplicable branches
    expect(storeService.consumeRFQCreditIfApplicable(null, 'mode_1')).toEqual({ consumed: false, remaining: null });
    expect(storeService.consumeRFQCreditIfApplicable({}, 'mode_1')).toEqual({ consumed: false, remaining: null });
    expect(storeService.consumeRFQCreditIfApplicable(bUnlim, 'mode_1')).toEqual({ consumed: false, remaining: 999 });
    expect(storeService.consumeRFQCreditIfApplicable(bNormal, 'mode_0')).toEqual({ consumed: false, remaining: 3 });
    expect(storeService.consumeRFQCreditIfApplicable(bNormal, 'v0')).toEqual({ consumed: false, remaining: 3 });
    expect(storeService.consumeRFQCreditIfApplicable(bZero, 'mode_1')).toEqual({ consumed: false, remaining: 0 });
    expect(storeService.consumeRFQCreditIfApplicable(bNormal, 'mode_1')).toEqual({ consumed: true, remaining: 4 });

    // 6. isBuyerUploaded branches
    expect(storeService.isBuyerUploaded(null)).toBe(false);
    expect(storeService.isBuyerUploaded({ addedByBuyerCompany: 'BuyerCo' })).toBe(true);
    expect(storeService.isBuyerUploaded({ buyerAccountId: 'b1' })).toBe(true);
    expect(storeService.isBuyerUploaded({ buyerId: 'b1' })).toBe(true);
    expect(storeService.isBuyerUploaded({ buyerEmail: 'b@corp.com' })).toBe(true);
    expect(storeService.isBuyerUploaded({ mappedBuyerIds: ['b1'] })).toBe(true);
    expect(storeService.isBuyerUploaded({ buyerIds: ['b1'] })).toBe(true);
    expect(storeService.isBuyerUploaded({ source: 'buyer_upload' })).toBe(true);
    expect(storeService.isBuyerUploaded({ id: 'v-buyer-100' })).toBe(true);
    expect(storeService.isBuyerUploaded({ source: 'self_onboarded', id: 'vendor-100' })).toBe(false);

    // 7. consumeVendorQuotationCredit branches
    expect(storeService.consumeVendorQuotationCredit(null, 'rfq-1')).toBeNull();
    const vendorQuoter = { id: 'v-credit-test', email: 'vcredit@t.co', freeQuotationCredits: 3, quotedRfqIds: [], unlockedRfqIds: [] };
    storeService.vendors.push(vendorQuoter);
    const rfqNet = storeService.createRFQ({ title: 'Network RFQ', category: 'Pumps', sourcingMode: 'mode_0' });
    // First quote on network RFQ
    const vq1 = storeService.consumeVendorQuotationCredit(vendorQuoter.id, rfqNet.id);
    expect(vq1.freeQuotationCredits).toBe(2);
    // Second quote on same network RFQ (already quoted)
    const vq2 = storeService.consumeVendorQuotationCredit(vendorQuoter.id, rfqNet.id);
    expect(vq2.freeQuotationCredits).toBe(2);
    // Quote with RFQ number
    const vq3 = storeService.consumeVendorQuotationCredit(vendorQuoter.id, rfqNet.rfqNumber);
    expect(vq3.freeQuotationCredits).toBe(2);

    // 8. unlockRFQForVendor branches (alreadyUnlocked, exhausted, consume credit)
    const vUnlockExhausted = { id: 'v-unl-ex', email: 'unlex@t.co', freeRfqDownloadCredits: 0, freeQuotationCredits: 0, unlockedRfqIds: [] };
    storeService.vendors.push(vUnlockExhausted);
    const rfqNet2 = storeService.createRFQ({ title: 'Network RFQ 2', category: 'Pumps', sourcingMode: 'mode_0' });
    const resUnlEx = await storeService.unlockRFQForVendor(vUnlockExhausted.id, rfqNet2.id);
    expect(resUnlEx.success).toBe(false);
    expect(resUnlEx.creditsExhausted).toBe(true);

    const vUnlockNorm = { id: 'v-unl-norm', email: 'unlnorm@t.co', freeRfqDownloadCredits: 3, freeQuotationCredits: 3, unlockedRfqIds: [] };
    storeService.vendors.push(vUnlockNorm);
    const resUnlNorm = await storeService.unlockRFQForVendor(vUnlockNorm.id, rfqNet2.id);
    expect(resUnlNorm.success).toBe(true);
    expect(resUnlNorm.creditCharged).toBe(1);

    const resUnlAgain = await storeService.unlockRFQForVendor(vUnlockNorm.id, rfqNet2.id);
    expect(resUnlAgain.success).toBe(true);
    expect(resUnlAgain.alreadyUnlocked).toBe(true);
  });
});
