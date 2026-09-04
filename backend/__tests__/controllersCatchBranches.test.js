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
const identityPool = require('../src/db/identityPool');
const optimizationMetrics = require('../src/db/optimizationMetrics');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Controllers Comprehensive Catch Blocks & Missing Branches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('AI Feed Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'addAIFeedItem').mockImplementationOnce(() => {
      throw new Error('Add feed fail');
    });
    await aiFeedController.createFeedItem({ body: { title: 'T', message: 'M' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Audit Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'addAuditLog').mockImplementationOnce(() => {
      throw new Error('Audit add fail');
    });
    await auditController.createAuditLog({ body: { action: 'Test' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'verifyAuditIntegrity').mockImplementationOnce(() => {
      throw new Error('Audit verify fail');
    });
    await auditController.verifyIntegrity({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Bootstrap Controller Postgres source branch', async () => {
    const res = mockRes();
    const next = jest.fn();
    storeService.isHydratedFromDB = true;
    await bootstrapController.getBootstrap({}, res, next);
    expect(res.json).toHaveBeenCalled();
    storeService.isHydratedFromDB = false;
  });

  test('Buyer Account Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getActiveBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Active Acc Error');
    });
    await buyerAccountController.getActiveAccount({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'addBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Create Acc Error');
    });
    await buyerAccountController.createBuyerAccount({ body: { organizationName: 'Org', corporateEmail: 'e@o.com' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'updateBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Update Acc Error');
    });
    await buyerAccountController.updateBuyerAccount({ params: { id: 'b-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'deleteBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Delete Acc Error');
    });
    await buyerAccountController.deleteBuyerAccount({ params: { id: 'b-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundDelete = mockRes();
    jest.spyOn(storeService, 'deleteBuyerAccount').mockReturnValueOnce(false);
    await buyerAccountController.deleteBuyerAccount({ params: { id: 'b-99' } }, notFoundDelete, next);
    expect(notFoundDelete.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'alignActiveBuyerAccount').mockImplementationOnce(() => {
      throw new Error('Set Active Error');
    });
    await buyerAccountController.setActiveAccount({ params: { id: 'b-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundRes = mockRes();
    jest.spyOn(storeService, 'alignActiveBuyerAccount').mockReturnValueOnce(null);
    await buyerAccountController.setActiveAccount({ params: { id: 'b-99' } }, notFoundRes, next);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);

    const noPeriodRes = mockRes();
    await buyerAccountController.ingestHistoricalData({ body: {} }, noPeriodRes, next);
    expect(noPeriodRes.status).toHaveBeenCalledWith(400);

    const histRes = mockRes();
    await buyerAccountController.ingestHistoricalData({ body: { period: 'FY26', vendorRecords: [] } }, histRes, next);
    expect(histRes.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'processHistoricalPurchaseData').mockImplementationOnce(() => {
      throw new Error('Hist error');
    });
    await buyerAccountController.ingestHistoricalData({ body: { period: 'FY26', vendorRecords: [] } }, histRes, next);
    expect(next).toHaveBeenCalled();
  });

  test('Catalogue Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getVendorCatalogue').mockImplementationOnce(() => {
      throw new Error('Cat error');
    });
    await catalogueController.getProducts({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'addProductToCatalogue').mockImplementationOnce(() => {
      throw new Error('Add prod error');
    });
    await catalogueController.addProduct({ body: { name: 'Item', sku: 'SKU', unitPrice: 10 } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'updateCatalogueProduct').mockImplementationOnce(() => {
      throw new Error('Update prod error');
    });
    await catalogueController.updateProduct({ params: { id: 'p-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'deleteCatalogueProduct').mockImplementationOnce(() => {
      throw new Error('Delete prod error');
    });
    await catalogueController.deleteProduct({ params: { id: 'p-1' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Config Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getSystemConfig').mockImplementationOnce(() => {
      throw new Error('Cfg error');
    });
    await configController.getSystemConfig({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'updateSystemConfig').mockImplementationOnce(() => {
      throw new Error('Update cfg error');
    });
    await configController.updateSystemConfig({ body: {} }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('DB Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();
    // The controller now depends on the MySQL identity connection rather than the
    // removed PostgreSQL pool and seed routines.
    jest.spyOn(identityPool, 'checkIdentityHealth').mockImplementationOnce(() => {
      throw new Error('Health error');
    });
    await dbController.getDBStatus({}, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    jest.spyOn(optimizationMetrics, 'getOptimizationMetrics').mockImplementationOnce(() => {
      throw new Error('Metrics error');
    });
    await dbController.getDBMetrics({}, res, next);
    expect(next).toHaveBeenCalled();
  });
  test('Evaluation Controller Error Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getEvaluations').mockImplementationOnce(() => {
      throw new Error('Eval error');
    });
    await evaluationController.getEvaluations({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'createEvaluation').mockImplementationOnce(() => {
      throw new Error('Create eval error');
    });
    await evaluationController.createEvaluation({ body: { vendorName: 'Apex' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('RFQ Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getRFQs').mockImplementationOnce(() => {
      throw new Error('RFQ error');
    });
    await rfqController.getRFQs({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'getRFQById').mockImplementationOnce(() => {
      throw new Error('RFQ by ID error');
    });
    await rfqController.getRFQById({ params: { id: 'rfq-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'createRFQ').mockImplementationOnce(() => {
      throw new Error('Create RFQ error');
    });
    // The payload must satisfy VALIDATION_SCHEMAS.createRFQ, otherwise the
    // handler returns 400 and never reaches the store call under test.
    await rfqController.createRFQ(
      {
        body: {
          title: 'RFQ Title',
          category: 'Mechanical',
          budget: 1000,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
      },
      res,
      next
    );
    expect(next).toHaveBeenCalled();

    // ── Ingestion & summary error branches ──
    jest.spyOn(storeService, 'getRFQSummary').mockImplementationOnce(() => {
      throw new Error('Summary error');
    });
    await rfqController.getRFQSummary({}, res, next);
    expect(next).toHaveBeenCalled();

    const ingestionService = require('../src/services/rfqIngestionService');
    jest.spyOn(ingestionService, 'buildRFQDraft').mockImplementationOnce(() => {
      throw new Error('Ingestion error');
    });
    await rfqController.ingestRFQ({ body: { lineItems: [{ itemName: 'Pump' }] } }, res, next);
    expect(next).toHaveBeenCalled();

    // A body-less request must fall back to {} rather than throwing on property access.
    const noBodyRes = mockRes();
    await rfqController.createRFQ({}, noBodyRes, next);
    expect(noBodyRes.status).toHaveBeenCalledWith(400);

    const noBodyIngest = mockRes();
    await rfqController.ingestRFQ({}, noBodyIngest, next);
    expect(noBodyIngest.status).toHaveBeenCalledWith(400);

    const notFoundUpdate = mockRes();
    jest.spyOn(storeService, 'updateRFQ').mockReturnValueOnce(null);
    await rfqController.updateRFQ({ params: { id: 'rfq-99' }, body: {} }, notFoundUpdate, next);
    expect(notFoundUpdate.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'updateRFQ').mockImplementationOnce(() => {
      throw new Error('Update RFQ error');
    });
    await rfqController.updateRFQ({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundQuote = mockRes();
    jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValueOnce(null);
    await rfqController.addQuote({ params: { id: 'rfq-99' }, body: { vendorName: 'Apex', unitPrice: 100 } }, notFoundQuote, next);
    expect(notFoundQuote.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'addQuoteToRFQ').mockImplementationOnce(() => {
      throw new Error('Quote error');
    });
    await rfqController.addQuote({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', unitPrice: 100 } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundEmail = mockRes();
    jest.spyOn(storeService, 'getRFQById').mockReturnValueOnce(null);
    await rfqController.generateEmailPreview({ params: { id: 'rfq-99' }, query: {} }, notFoundEmail, next);
    expect(notFoundEmail.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getRFQById').mockImplementationOnce(() => {
      throw new Error('Email preview error');
    });
    await rfqController.generateEmailPreview({ params: { id: 'rfq-1' }, query: {} }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundChaser = mockRes();
    jest.spyOn(storeService, 'triggerBatchChaser').mockReturnValueOnce(null);
    await rfqController.triggerBatchChaser({ params: { id: 'rfq-99' }, body: {} }, notFoundChaser, next);
    expect(notFoundChaser.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'triggerBatchChaser').mockImplementationOnce(() => {
      throw new Error('Chaser error');
    });
    await rfqController.triggerBatchChaser({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'approvePurchaseOrder').mockImplementationOnce(() => {
      throw new Error('PO error');
    });
    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', totalAmount: 100 } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Support Chat Error Branch', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'handleSupportChat').mockImplementationOnce(() => {
      throw new Error('Chat error');
    });
    await supportChatController.sendMessage({ body: { prompt: 'Hi' } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('Vendor Controller Error & 404 Branches', async () => {
    const next = jest.fn();
    const res = mockRes();

    jest.spyOn(storeService, 'getVendors').mockImplementationOnce(() => {
      throw new Error('Vendors error');
    });
    await vendorController.getVendors({}, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'getVendorById').mockImplementationOnce(() => {
      throw new Error('Vendor by id error');
    });
    await vendorController.getVendorById({ params: { id: 'v-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    jest.spyOn(storeService, 'addVendor').mockImplementationOnce(() => {
      throw new Error('Add vendor error');
    });
    await vendorController.createVendor({ body: { name: 'V', majorCategory: 'Cat' } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundUpdate = mockRes();
    jest.spyOn(storeService, 'updateVendor').mockReturnValueOnce(null);
    await vendorController.updateVendor({ params: { id: 'v-99' }, body: {} }, notFoundUpdate, next);
    expect(notFoundUpdate.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'updateVendor').mockImplementationOnce(() => {
      throw new Error('Update vendor error');
    });
    await vendorController.updateVendor({ params: { id: 'v-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundDelete = mockRes();
    jest.spyOn(storeService, 'deleteVendor').mockReturnValueOnce(false);
    await vendorController.deleteVendor({ params: { id: 'v-99' } }, notFoundDelete, next);
    expect(notFoundDelete.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'deleteVendor').mockImplementationOnce(() => {
      throw new Error('Delete vendor error');
    });
    await vendorController.deleteVendor({ params: { id: 'v-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundRating = mockRes();
    jest.spyOn(storeService, 'reviseVendorRating').mockReturnValueOnce(null);
    await vendorController.reviseRating({ params: { id: 'v-99' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } }, notFoundRating, next);
    expect(notFoundRating.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'reviseVendorRating').mockImplementationOnce(() => {
      throw new Error('Rating error');
    });
    await vendorController.reviseRating({ params: { id: 'v-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundEmail = mockRes();
    jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(null);
    await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-99' } }, notFoundEmail, next);
    expect(notFoundEmail.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getVendorById').mockImplementationOnce(() => {
      throw new Error('Email preview error');
    });
    await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-1' } }, res, next);
    expect(next).toHaveBeenCalled();

    const notFoundCat = mockRes();
    jest.spyOn(storeService, 'updateVendorCategories').mockReturnValueOnce(null);
    await vendorController.updateCategories({ params: { id: 'v-99' }, body: {} }, notFoundCat, next);
    expect(notFoundCat.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'updateVendorCategories').mockImplementationOnce(() => {
      throw new Error('Update cat error');
    });
    await vendorController.updateCategories({ params: { id: 'v-1' }, body: {} }, res, next);
    expect(next).toHaveBeenCalled();
  });
});
