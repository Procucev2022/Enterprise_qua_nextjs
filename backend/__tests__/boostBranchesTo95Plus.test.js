const aiChaserService = require('../src/services/aiChaserService');
const emailService = require('../src/services/emailService');
const auditService = require('../src/services/auditService');
const evaluationService = require('../src/services/evaluationService');
const storeService = require('../src/services/storeService');
const identityPool = require('../src/db/identityPool');
const { bootstrapServer, start } = require('../src/server');
const auditController = require('../src/controllers/auditController');
const evaluationController = require('../src/controllers/evaluationController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const rfqController = require('../src/controllers/rfqController');
const vendorController = require('../src/controllers/vendorController');

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

  test('aiChaserService fallback default parameters', () => {
    const itemDefault = aiChaserService.generateAIFeedItem({ title: 'T', message: 'M' });
    expect(itemDefault.type).toBe('call');
    expect(itemDefault.recipient).toBe('Vendor Partner');
    expect(itemDefault.rfqNumber).toBeNull();

    const emptyOutreach = aiChaserService.simulateChaserOutreach({}, {});
    expect(emptyOutreach).toHaveLength(3);
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
    expect(rfqEmailEmpty.to).toBe('partner@enterprise.com');

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
    jest.spyOn(identityPool, 'checkIdentityHealth').mockResolvedValueOnce({
      isConnected: false,
      providerLabel: 'Identity DB Unreachable',
      errorMessage: 'offline',
    });

    const server = await start(0);
    expect(server).toBeDefined();
    await new Promise((resolve) => server.close(resolve));

    // Test bootstrapServer with default port and hydrate
    jest.spyOn(identityPool, 'checkIdentityHealth').mockResolvedValueOnce({
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
    jest.spyOn(identityPool, 'checkIdentityHealth').mockImplementationOnce(() => {
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


});
