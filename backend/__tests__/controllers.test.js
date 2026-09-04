const aiFeedController = require('../src/controllers/aiFeedController');
const auditController = require('../src/controllers/auditController');
const bootstrapController = require('../src/controllers/bootstrapController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const catalogueController = require('../src/controllers/catalogueController');
const configController = require('../src/controllers/configController');
const dbController = require('../src/controllers/dbController');
const evaluationController = require('../src/controllers/evaluationController');
const rfqController = require('../src/controllers/rfqController');
const supportChatController = require('../src/controllers/supportChatController');
const vendorController = require('../src/controllers/vendorController');
const storeService = require('../src/services/storeService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Controllers Error & Edge-Case Coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('aiFeedController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await aiFeedController.getAIFeed({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await aiFeedController.createFeedItem({ body: { title: 'Test Feed', message: 'Test Message' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await aiFeedController.createFeedItem({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    jest.spyOn(storeService, 'getAIFeed').mockImplementationOnce(() => {
      throw new Error('AI Feed Error');
    });
    await aiFeedController.getAIFeed({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('auditController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await auditController.getAuditLogs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await auditController.createAuditLog({ body: { action: 'TEST_ACTION', userEmail: 'test@user.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await auditController.createAuditLog({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await auditController.verifyIntegrity({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getAuditLogs').mockImplementationOnce(() => {
      throw new Error('Audit Error');
    });
    await auditController.getAuditLogs({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('bootstrapController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await bootstrapController.getBootstrap({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getBootstrapData').mockImplementationOnce(() => {
      throw new Error('Bootstrap Error');
    });
    await bootstrapController.getBootstrap({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('buyerAccountController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.getActiveAccount({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.setActiveAccount({ body: { id: 'buyer-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.createBuyerAccount({ body: { organizationName: 'New Org', corporateEmail: 'test@org.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await buyerAccountController.createBuyerAccount({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await buyerAccountController.updateBuyerAccount({ params: { id: 'buyer-1' }, body: { organizationName: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.updateBuyerAccount({ params: { id: 'non-existent' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getBuyerAccounts').mockImplementationOnce(() => {
      throw new Error('Buyer Accounts Error');
    });
    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('catalogueController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await catalogueController.getProducts({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.addProduct({ body: { name: 'Item', sku: 'SKU-1', unitPrice: 100 } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await catalogueController.addProduct({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await catalogueController.updateProduct({ params: { id: 'prod-1' }, body: { name: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.updateProduct({ params: { id: 'invalid-prod' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await catalogueController.deleteProduct({ params: { id: 'prod-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.deleteProduct({ params: { id: 'invalid-prod' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('configController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await configController.getSystemConfig({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await configController.updateSystemConfig({ body: { activeMode: 'mode_3' } }, res, next);
    expect(res.json).toHaveBeenCalled();
  });

  test('dbController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    // initDBSchema / syncDBData were removed with PostgreSQL. The controller now
    // reports identity-database health and the query efficiency report.
    await dbController.getDBStatus({}, res, next);
    expect(res.json).toHaveBeenCalled();
    await dbController.getDBMetrics({}, res, next);
    expect(res.json).toHaveBeenCalled();
  });
  test('dbController reports the domain store as persisted once it is hydrated', async () => {
    const next = jest.fn();
    const res = mockRes();
    const original = storeService.isHydratedFromDB;
    storeService.isHydratedFromDB = true;
    try {
      await dbController.getDBStatus({}, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          domainStore: expect.objectContaining({ mode: 'persisted' }),
        })
      );
    } finally {
      storeService.isHydratedFromDB = original;
    }
  });

  test('evaluationController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await evaluationController.getEvaluations({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await evaluationController.createEvaluation({ body: { vendorName: 'Apex' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await evaluationController.createEvaluation({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rfqController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await rfqController.getRFQs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById({ params: { id: 'rfq-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await rfqController.createRFQ(
      {
        body: {
          title: 'New RFQ',
          category: 'Mechanical',
          budget: 50000,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
      },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await rfqController.createRFQ({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A payload that clears the title check but violates another rule must still
    // be rejected, which the old bare `if (!body.title)` gate let through.
    await rfqController.createRFQ({ body: { title: 'Only a title' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await rfqController.updateRFQ({ params: { id: 'rfq-1' }, body: { title: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', unitPrice: 100 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await rfqController.generateEmailPreview({ params: { id: 'rfq-1' }, query: {} }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.triggerBatchChaser({ params: { id: 'rfq-1' }, body: { channels: ['call'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', totalAmount: 50000 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('supportChatController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await supportChatController.sendMessage({ body: { prompt: 'How does Mode 1 work?' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await supportChatController.sendMessage({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('vendorController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await vendorController.getVendors({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await vendorController.createVendor({ body: { name: 'New Vendor', majorCategory: 'Mechanical' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await vendorController.createVendor({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.updateVendor({ params: { id: 'vendor-1' }, body: { name: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.generateOnboardingEmailPreview({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.updateCategories({ params: { id: 'vendor-1' }, body: { vendorSelectedCategories: ['Pumps'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
