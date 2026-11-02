const rfqController = require('../src/controllers/rfqController');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');
const quoteAttachmentService = require('../src/services/quoteAttachmentService');
const emailGatewayService = require('../src/services/emailGatewayService');
const extractionStagingService = require('../src/services/extractionStagingService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const rfqSummaryService = require('../src/services/rfqSummaryService');
const geminiService = require('../src/services/geminiService');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(content) {
      this.data = content;
      return this;
    },
  };
  return res;
}

describe('rfqController Comprehensive Branch Coverage', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAllRFQs and canVendorViewRfq branches', () => {
    test('getAllRFQs formats output for non-admin user with assigned vendors and quotes', async () => {
      const rfqs = [
        {
          id: 'rfq-all-1',
          assignedVendors: [{ vendorId: 'v-1', vendorName: 'V1', status: 'Invited' }],
          quotes: [{ id: 'q-1', vendorId: 'v-1', vendorName: 'V1', submittedAt: '2026-01-01', totalAmount: 100 }],
        },
      ];
      jest.spyOn(storeService, 'getRFQs').mockReturnValue(rfqs);

      const req = { user: { role: 'buyer', email: 'b@test.com' } };
      const res = mockRes();
      const next = jest.fn();

      await rfqController.getAllRFQs(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data[0].assignedVendors[0].vendorName).toBe('V1');
      expect(res.data.data[0].quotes[0].id).toBe('q-1');

      // Admin role gets raw rfqs
      const reqAdmin = { user: { role: 'admin' } };
      const resAdmin = mockRes();
      await rfqController.getAllRFQs(reqAdmin, resAdmin, next);
      expect(resAdmin.data.data).toEqual(rfqs);

      storeService.getRFQs.mockRestore();
    });
  });

  describe('getVendorCandidates, inviteVendors, and validateVendorCategories', () => {
    test('getVendorCandidates respects query limit, handles 404 and catch block', async () => {
      const next = jest.fn();

      // 404
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.getVendorCandidates({ params: { id: 'rfq-none' } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // Success with query limit
      const rfq = { id: 'rfq-cand-1' };
      storeService.getRFQByIdAsync.mockResolvedValue(rfq);
      const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `v-${i}` }));
      jest.spyOn(storeService, 'candidateVendorsForRFQ').mockReturnValue(candidates);

      const resLimit = mockRes();
      await rfqController.getVendorCandidates(
        { params: { id: 'rfq-cand-1' }, query: { limit: '3' }, user: { role: 'admin' } },
        resLimit,
        next
      );
      expect(resLimit.statusCode).toBe(200);
      expect(resLimit.data.data.length).toBe(3);

      // Catch block
      storeService.candidateVendorsForRFQ.mockImplementation(() => { throw new Error('cand err'); });
      const resErr = mockRes();
      await rfqController.getVendorCandidates({ params: { id: 'rfq-cand-1' }, user: { role: 'admin' } }, resErr, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQByIdAsync.mockRestore();
      storeService.candidateVendorsForRFQ.mockRestore();
    });

    test('inviteVendors validations, success, and catch block', async () => {
      const next = jest.fn();

      // Empty vendorIds
      const resEmpty = mockRes();
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: [] } }, resEmpty, next);
      expect(resEmpty.statusCode).toBe(400);

      // Over 20 vendorIds returns 400
      const resLimit = mockRes();
      const twentyOne = Array.from({ length: 21 }, (_, i) => `v-${i + 1}`);
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: twentyOne } }, resLimit, next);
      expect(resLimit.statusCode).toBe(400);
      expect(resLimit.data.error).toContain('Maximum of 20 vendors');

      // Only falsy vendorIds returns 400
      const resFalsy = mockRes();
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: ['', null] } }, resFalsy, next);
      expect(resFalsy.statusCode).toBe(400);

      // 404
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // Success
      storeService.getRFQByIdAsync.mockResolvedValue({ id: 'rfq-1' });
      jest.spyOn(storeService, 'inviteVendorsToRFQ').mockResolvedValue({
        updatedRFQ: { id: 'rfq-1' },
        invitedCount: 1,
        excludedCount: 1,
        excludedVendors: ['v-2'],
      });
      const resOk = mockRes();
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] }, user: { role: 'admin', email: 'cm@test.com' } }, resOk, next);
      expect(resOk.statusCode).toBe(200);
      expect(resOk.data.invitedCount).toBe(1);

      // Catch block
      storeService.inviteVendorsToRFQ.mockRejectedValue(new Error('invite err'));
      await rfqController.inviteVendors({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQByIdAsync.mockRestore();
      storeService.inviteVendorsToRFQ.mockRestore();
    });

    test('validateVendorCategories validations, success, and catch block', async () => {
      const next = jest.fn();

      // Invalid vendorIds
      const resBad = mockRes();
      await rfqController.validateVendorCategories({ params: { id: 'rfq-1' }, body: {} }, resBad, next);
      expect(resBad.statusCode).toBe(400);

      // 404
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.validateVendorCategories({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // Success with excluded
      storeService.getRFQByIdAsync.mockResolvedValue({ id: 'rfq-1' });
      jest.spyOn(storeService, 'validateAndShortlistVendors').mockReturnValue({
        shortlisted: [{ id: 'v-1' }],
        excluded: [{ id: 'v-2' }],
      });
      const resOk = mockRes();
      await rfqController.validateVendorCategories({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1', 'v-2'] }, user: { role: 'admin' } }, resOk, next);
      expect(resOk.statusCode).toBe(200);
      expect(resOk.data.excluded.length).toBe(1);

      // Success with 0 excluded
      storeService.validateAndShortlistVendors.mockReturnValue({ shortlisted: [{ id: 'v-1' }], excluded: [] });
      const resAll = mockRes();
      await rfqController.validateVendorCategories({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] }, user: { role: 'admin' } }, resAll, next);
      expect(resAll.data.message).toBe('All vendors match RFQ category.');

      // Catch block
      storeService.validateAndShortlistVendors.mockImplementation(() => { throw new Error('val err'); });
      await rfqController.validateVendorCategories({ params: { id: 'rfq-1' }, body: { vendorIds: ['v-1'] }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQByIdAsync.mockRestore();
      storeService.validateAndShortlistVendors.mockRestore();
    });
  });

  describe('requestVendorCategoryUpdate', () => {
    test('requestVendorCategoryUpdate validations, email dispatch, and error handling', async () => {
      const next = jest.fn();

      // Missing email
      const resNoEmail = mockRes();
      await rfqController.requestVendorCategoryUpdate({ body: {} }, resNoEmail, next);
      expect(resNoEmail.statusCode).toBe(400);

      // Vendor lookup via getVendorById, with buyer account lookup
      const vendor = {
        id: 'v-req-1',
        name: 'Req Vendor',
        email: 'req@vendor.com',
        majorCategory: 'Pumps & Valves',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        companyName: 'Acme Buyers',
        corporateEmail: 'corp@acme.com',
      });
      const mailSpy = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue(true);
      const auditSpy = jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});

      const resSuccess = mockRes();
      await rfqController.requestVendorCategoryUpdate(
        {
          body: { vendorId: 'v-req-1', rfqNumber: 'RFQ-001', rfqCategory: 'Electrical' },
          user: { email: 'buyer@acme.com', name: 'Buyer John' },
        },
        resSuccess,
        next
      );

      expect(resSuccess.statusCode).toBe(200);
      expect(resSuccess.data.success).toBe(true);
      expect(mailSpy).toHaveBeenCalledWith('req@vendor.com', expect.objectContaining({
        buyerAccountName: 'Acme Buyers',
        vendorName: 'Req Vendor',
      }));

      // Vendor lookup via vendorEmail fallback
      storeService.getVendorById.mockReturnValue(null);
      storeService.getVendorByEmail = jest.fn().mockReturnValue(vendor);

      const resEmailFallback = mockRes();
      await rfqController.requestVendorCategoryUpdate(
        {
          body: { vendorEmail: 'req@vendor.com', vendorName: 'Fallback Name' },
          user: { email: 'buyer@acme.com' },
        },
        resEmailFallback,
        next
      );
      expect(resEmailFallback.statusCode).toBe(200);

      // Catch error
      mailSpy.mockRejectedValue(new Error('mail err'));
      await rfqController.requestVendorCategoryUpdate(
        { body: { vendorEmail: 'req@vendor.com' } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getVendorById.mockRestore();
      storeService.getBuyerAccountByEmail.mockRestore();
      mailSpy.mockRestore();
      auditSpy.mockRestore();
    });
  });

  describe('createRFQ category and line item validations, and post-creation hooks', () => {
    test('createRFQ category mismatch between major and minor returns 400', async () => {
      const next = jest.fn();
      jest.spyOn(rfqIngestionService, 'canonicalMajor').mockReturnValue('Pumps & Motors');
      jest.spyOn(rfqIngestionService, 'isMinorUnderMajor').mockReturnValue(false);

      // Minor without major
      const resMinorOnly = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            minorCategory: 'Centrifugal Pumps',
            lineItems: [{ itemName: 'Item 1' }],
          },
        },
        resMinorOnly,
        next
      );
      expect(resMinorOnly.statusCode).toBe(400);

      // Minor not under major
      const resMismatch = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            category: 'Pumps & Motors',
            majorCategory: 'Pumps & Motors',
            minorCategory: 'Invalid Minor',
            lineItems: [{ itemName: 'Item 1' }],
          },
        },
        resMismatch,
        next
      );
      expect(resMismatch.statusCode).toBe(400);

      // Line item targetDate in the past
      const resPastDate = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            lineItems: [{ itemName: 'Item 1', targetDate: '2020-01-01' }],
          },
        },
        resPastDate,
        next
      );
      expect(resPastDate.statusCode).toBe(400);

      // Line item with invalid majorCategory
      rfqIngestionService.canonicalMajor.mockReturnValueOnce(null);
      const resBadMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            lineItems: [{ itemName: 'Item 1', majorCategory: 'Unknown Major' }],
          },
        },
        resBadMajor,
        next
      );
      expect(resBadMajor.statusCode).toBe(400);

      // Line item minorCategory without major
      const resLineMinorNoMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            lineItems: [{ itemName: 'Item 1', minorCategory: 'Centrifugal Pumps' }],
          },
        },
        resLineMinorNoMajor,
        next
      );
      expect(resLineMinorNoMajor.statusCode).toBe(400);

      // Line item minorCategory not under major
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(false);
      const resLineMismatch = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test RFQ',
            lineItems: [{ itemName: 'Item 1', majorCategory: 'Pumps & Motors', minorCategory: 'Wrong Minor' }],
          },
        },
        resLineMismatch,
        next
      );
      expect(resLineMismatch.statusCode).toBe(400);

      rfqIngestionService.canonicalMajor.mockRestore();
      rfqIngestionService.isMinorUnderMajor.mockRestore();
    });

    test('createRFQ post-creation warning catches and refundFreeRFQ on failure', async () => {
      const next = jest.fn();
      jest.spyOn(rfqIngestionService, 'canonicalMajor').mockReturnValue('Pumps & Motors');
      jest.spyOn(rfqIngestionService, 'isMinorUnderMajor').mockReturnValue(true);

      // V0 augmentV0AssignmentsFromDB warning catch
      const createdV0 = {
        id: 'rfq-v0-created',
        rfqNumber: 'RFQ-V0-CR',
        sourcingMode: 'mode_0',
        deadline: '2027-01-01',
        lineItems: [{ itemName: 'Pump' }],
      };
      jest.spyOn(storeService, 'createRFQ').mockReturnValue(createdV0);
      jest.spyOn(storeService, 'augmentV0AssignmentsFromDB').mockRejectedValue(new Error('augment error'));
      jest.spyOn(mailerService, 'sendRequisitionNotificationEmail').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockImplementation(() => { throw new Error('mailer warning'); });

      const resV0 = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'V0 RFQ',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2027-10-10',
            deliveryLocation: 'Navi Mumbai Plant',
            deliveryPincode: '400701',
            sourcingMode: 'mode_0',
            lineItems: [{ itemName: 'Pump' }],
            source: 'email_gateway',
            buyerEmail: 'b@test.com',
          },
        },
        resV0,
        next
      );
      expect(resV0.statusCode).toBe(201);

      // V2 resolveProcucevVendorCountFromDB count elevation and error catch
      const createdV2 = {
        id: 'rfq-v2-created',
        rfqNumber: 'RFQ-V2-CR',
        sourcingMode: 'mode_2',
        procucevVendorCount: 2,
        lineItems: [{ itemName: 'Pump' }],
      };
      storeService.createRFQ.mockReturnValue(createdV2);
      jest.spyOn(storeService, 'resolveProcucevVendorCountFromDB').mockResolvedValue(5);

      const resV2 = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'V2 RFQ',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2027-10-10',
            deliveryLocation: 'Navi Mumbai Plant',
            deliveryPincode: '400701',
            sourcingMode: 'mode_2',
            lineItems: [{ itemName: 'Pump' }],
          },
        },
        resV2,
        next
      );
      expect(resV2.statusCode).toBe(201);
      expect(resV2.data.data.procucevVendorCount).toBe(5);

      // resolveProcucevVendorCountFromDB throwing error
      storeService.resolveProcucevVendorCountFromDB.mockRejectedValue(new Error('resolve db err'));
      const resV2Err = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'V2 RFQ',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2027-10-10',
            deliveryLocation: 'Navi Mumbai Plant',
            deliveryPincode: '400701',
            sourcingMode: 'mode_2',
            lineItems: [{ itemName: 'Pump' }],
          },
        },
        resV2Err,
        next
      );
      expect(resV2Err.statusCode).toBe(201);

      // refundFreeRFQ on failure
      const buyerAcc = { id: 'buyer-refund-1', remainingFreeRFQs: 5, subscriptionPlan: 'free' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAcc);
      jest.spyOn(storeService, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: true });
      const refundSpy = jest.spyOn(storeService, 'refundFreeRFQ').mockImplementation(() => {});
      jest.spyOn(storeService, 'createRFQ').mockImplementation(() => { throw new Error('create throw'); });

      const resFail = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Failing RFQ',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2027-10-10',
            deliveryLocation: 'Navi Mumbai Plant',
            deliveryPincode: '400701',
            sourcingMode: 'mode_1',
            lineItems: [{ itemName: 'Pump' }],
            buyerEmail: 'fail@buyer.com',
          },
          user: { role: 'buyer', email: 'fail@buyer.com' },
        },
        resFail,
        next
      );
      expect(refundSpy).toHaveBeenCalledWith('buyer-refund-1');
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Email gateway, attachments, and staging', () => {
    test('getEmailGatewayStatus and pollEmailGateway coverage', async () => {
      const next = jest.fn();

      // getEmailGatewayStatus success and catch
      jest.spyOn(emailGatewayService, 'getStatus').mockResolvedValue({ enabled: true });
      const resStatus = mockRes();
      await rfqController.getEmailGatewayStatus({}, resStatus, next);
      expect(resStatus.statusCode).toBe(200);
      expect(resStatus.data.data.enabled).toBe(true);

      emailGatewayService.getStatus.mockRejectedValue(new Error('stat err'));
      await rfqController.getEmailGatewayStatus({}, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // pollEmailGateway: skipped, error, success, and catch
      jest.spyOn(emailGatewayService, 'pollOnce').mockResolvedValue({ skipped: true, reason: 'Off' });
      const resSkip = mockRes();
      await rfqController.pollEmailGateway({}, resSkip, next);
      expect(resSkip.statusCode).toBe(409);

      emailGatewayService.pollOnce.mockResolvedValue({ error: 'Gateway down' });
      const resErr = mockRes();
      await rfqController.pollEmailGateway({}, resErr, next);
      expect(resErr.statusCode).toBe(502);

      emailGatewayService.pollOnce.mockResolvedValue({ considered: 2, ingested: 2, pending: 0 });
      const resOk = mockRes();
      await rfqController.pollEmailGateway({ user: { email: 'b@test.com' } }, resOk, next);
      expect(resOk.statusCode).toBe(200);

      emailGatewayService.pollOnce.mockRejectedValue(new Error('poll err'));
      await rfqController.pollEmailGateway({}, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      emailGatewayService.getStatus.mockRestore();
      emailGatewayService.pollOnce.mockRestore();
    });

    test('stageExtractionDocument buffer check, sizes, and catch', async () => {
      const next = jest.fn();

      // Not buffer
      const resBad = mockRes();
      await rfqController.stageExtractionDocument({ body: null, headers: {} }, resBad, next);
      expect(resBad.statusCode).toBe(400);

      // TOO_LARGE
      jest.spyOn(extractionStagingService, 'stage').mockResolvedValue({ status: 'TOO_LARGE' });
      const resLarge = mockRes();
      await rfqController.stageExtractionDocument({ body: Buffer.from('data'), query: {}, headers: {} }, resLarge, next);
      expect(resLarge.statusCode).toBe(413);

      // Not SAVED
      extractionStagingService.stage.mockResolvedValue({ status: 'ERROR', error: 'Storage failed' });
      const resNotSaved = mockRes();
      await rfqController.stageExtractionDocument({ body: Buffer.from('data'), query: {}, headers: {} }, resNotSaved, next);
      expect(resNotSaved.statusCode).toBe(502);

      // SAVED
      extractionStagingService.stage.mockResolvedValue({ status: 'SAVED', key: 'stage-key-1', size: 100 });
      const resSaved = mockRes();
      await rfqController.stageExtractionDocument({ body: Buffer.from('data'), query: {}, headers: {} }, resSaved, next);
      expect(resSaved.statusCode).toBe(200);
      expect(resSaved.data.data.key).toBe('stage-key-1');

      // Catch
      extractionStagingService.stage.mockRejectedValue(new Error('stage err'));
      await rfqController.stageExtractionDocument({ body: Buffer.from('data'), query: {}, headers: {} }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      extractionStagingService.stage.mockRestore();
    });

    test('uploadRFQAttachment and downloadRFQAttachment coverage', async () => {
      const next = jest.fn();

      // uploadRFQAttachment validation error
      const resBad = mockRes();
      await rfqController.uploadRFQAttachment({ body: {} }, resBad, next);
      expect(resBad.statusCode).toBe(400);

      // status WRITE_FAILED and INVALID_TYPE
      jest.spyOn(rfqAttachmentService, 'saveAttachment').mockResolvedValue({
        status: rfqAttachmentService.ATTACHMENT_STATUS.WRITE_FAILED,
      });
      const resWriteFail = mockRes();
      await rfqController.uploadRFQAttachment({ body: { fileName: 'test.pdf', mimeType: 'application/pdf', content: 'base64' } }, resWriteFail, next);
      expect(resWriteFail.statusCode).toBe(500);

      rfqAttachmentService.saveAttachment.mockResolvedValue({
        status: 'UNSUPPORTED_TYPE',
      });
      const resUnsup = mockRes();
      await rfqController.uploadRFQAttachment({ body: { fileName: 'test.exe', mimeType: 'application/x-msdownload', content: 'base64' } }, resUnsup, next);
      expect(resUnsup.statusCode).toBe(422);

      // downloadRFQAttachment 404, success, and catch
      jest.spyOn(rfqAttachmentService, 'loadAttachment').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.downloadRFQAttachment({ params: { attachmentId: 'att-none' } }, res404, next);
      expect(res404.statusCode).toBe(404);

      rfqAttachmentService.loadAttachment.mockResolvedValue({
        meta: { mimeType: 'application/pdf', fileName: 'sample.pdf' },
        content: Buffer.from('pdf data'),
      });
      const resStream = mockRes();
      await rfqController.downloadRFQAttachment({ params: { attachmentId: 'att-1' } }, resStream, next);
      expect(resStream.headers['Content-Type']).toBe('application/pdf');

      rfqAttachmentService.loadAttachment.mockRejectedValue(new Error('load err'));
      await rfqController.downloadRFQAttachment({ params: { attachmentId: 'att-1' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      rfqAttachmentService.saveAttachment.mockRestore();
      rfqAttachmentService.loadAttachment.mockRestore();
    });

    test('uploadQuoteAttachment and downloadQuoteAttachment branches', async () => {
      const next = jest.fn();

      // uploadQuoteAttachment role guard
      const resNonVendor = mockRes();
      await rfqController.uploadQuoteAttachment({ user: { role: 'buyer', email: 'b@test.com' } }, resNonVendor, next);
      expect(resNonVendor.statusCode).toBe(403);

      // uploadQuoteAttachment 404 when rfq or vendor missing
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.uploadQuoteAttachment({ user: { role: 'vendor', email: 'v@test.com' }, params: { id: 'rfq-none' } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // uploadQuoteAttachment status handling
      const rfq = { id: 'rfq-att-1' };
      const vendor = { id: 'v-att-1', email: 'v@test.com' };
      storeService.getRFQByIdAsync.mockResolvedValue(rfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);

      jest.spyOn(quoteAttachmentService, 'saveQuoteAttachment').mockResolvedValue({
        status: rfqAttachmentService.ATTACHMENT_STATUS.WRITE_FAILED,
      });
      const resFail = mockRes();
      await rfqController.uploadQuoteAttachment(
        { user: { role: 'vendor', id: 'v-att-1', email: 'v@test.com' }, params: { id: 'rfq-att-1' }, body: {} },
        resFail,
        next
      );
      expect(resFail.statusCode).toBe(500);

      quoteAttachmentService.saveQuoteAttachment.mockResolvedValue({
        status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED,
        attachment: { id: 'quote-att-1' },
      });
      const resSaved = mockRes();
      await rfqController.uploadQuoteAttachment(
        { user: { role: 'vendor', id: 'v-att-1', email: 'v@test.com' }, params: { id: 'rfq-att-1' }, body: {} },
        resSaved,
        next
      );
      expect(resSaved.statusCode).toBe(201);

      // downloadQuoteAttachment 404 when RFQ missing
      storeService.getRFQByIdAsync.mockResolvedValue(null);
      const resDl404 = mockRes();
      await rfqController.downloadQuoteAttachment({ params: { id: 'rfq-none' } }, resDl404, next);
      expect(resDl404.statusCode).toBe(404);

      // downloadQuoteAttachment 403 when buyer accesses during 48 hour window
      storeService.getRFQByIdAsync.mockResolvedValue(rfq);
      jest.spyOn(storeService, 'isWithin48HourWindow').mockReturnValue(true);
      const resDl403 = mockRes();
      await rfqController.downloadQuoteAttachment({ user: { role: 'admin' }, params: { id: 'rfq-att-1' } }, resDl403, next);
      expect(resDl403.statusCode).toBe(404); // attachmentId undefined so quote not found -> 404

      // downloadQuoteAttachment 404 when attachment not found on quote
      rfq.quotes = [{ vendorId: 'v-att-1', attachments: [] }];
      const resNoQuote = mockRes();
      await rfqController.downloadQuoteAttachment({ user: { role: 'admin' }, params: { id: 'rfq-att-1', attachmentId: 'att-missing' } }, resNoQuote, next);
      expect(resNoQuote.statusCode).toBe(404);

      // downloadQuoteAttachment vendor role access control
      rfq.quotes = [{ vendorId: 'v-other', attachments: [{ id: 'att-found' }] }];
      const resVendorMismatch = mockRes();
      await rfqController.downloadQuoteAttachment(
        { user: { role: 'vendor', id: 'v-att-1', email: 'v@test.com' }, params: { id: 'rfq-att-1', attachmentId: 'att-found' } },
        resVendorMismatch,
        next
      );
      expect(resVendorMismatch.statusCode).toBe(404);

      // downloadQuoteAttachment success
      rfq.quotes = [{ vendorId: 'v-att-1', attachments: [{ id: 'att-found' }] }];
      jest.spyOn(quoteAttachmentService, 'loadQuoteAttachment').mockResolvedValue({
        access: { rfqId: 'rfq-att-1', vendorId: 'v-att-1' },
        meta: { mimeType: 'application/pdf', fileName: 'quote.pdf' },
        content: Buffer.from('quote pdf'),
      });
      const resDlOk = mockRes();
      await rfqController.downloadQuoteAttachment(
        { user: { role: 'admin' }, params: { id: 'rfq-att-1', attachmentId: 'att-found' } },
        resDlOk,
        next
      );
      expect(resDlOk.headers['Content-Type']).toBe('application/pdf');

      storeService.getRFQByIdAsync.mockRestore();
      storeService.getVendorById.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.isWithin48HourWindow.mockRestore();
      quoteAttachmentService.saveQuoteAttachment.mockRestore();
      quoteAttachmentService.loadQuoteAttachment.mockRestore();
    });
  });

  describe('updateRFQ and extendRFQ comprehensive branches', () => {
    test('updateRFQ vendor role guard, invalid categories, line items, and Parsing transition', async () => {
      const next = jest.fn();
      const vendor = { id: 'v-vendor-update', email: 'v@update.com' };
      const rfq = {
        id: 'rfq-update-1',
        category: 'Pumps & Motors',
        status: 'Parsing',
        extractedEntities: [],
        assignedVendors: [],
      };
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(rfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);

      // Vendor role guard
      const resVendor = mockRes();
      await rfqController.updateRFQ({ params: { id: 'rfq-update-1' }, user: { role: 'vendor', email: 'v@update.com' } }, resVendor, next);
      expect(resVendor.statusCode).toBe(403);

      // Target delivery date in past
      const resPast = mockRes();
      await rfqController.updateRFQ(
        { params: { id: 'rfq-update-1' }, body: { targetDeliveryDate: '2020-01-01' }, user: { role: 'admin' } },
        resPast,
        next
      );
      expect(resPast.statusCode).toBe(400);

      // Declared minor without major
      rfq.category = null;
      rfq.majorCategory = null;
      const resMinorNoMajor = mockRes();
      await rfqController.updateRFQ(
        { params: { id: 'rfq-update-1' }, body: { minorCategory: 'Centrifugal Pumps' }, user: { role: 'admin' } },
        resMinorNoMajor,
        next
      );
      expect(resMinorNoMajor.statusCode).toBe(400);

      // ExtractedEntities past targetDate
      rfq.category = 'Pumps & Motors';
      const resItemPast = mockRes();
      await rfqController.updateRFQ(
        { params: { id: 'rfq-update-1' }, body: { extractedEntities: [{ itemName: 'Pump', targetDate: '2020-01-01' }] }, user: { role: 'admin' } },
        resItemPast,
        next
      );
      expect(resItemPast.statusCode).toBe(400);

      // ExtractedEntities minor category without major category
      const resItemNoMajor = mockRes();
      await rfqController.updateRFQ(
        { params: { id: 'rfq-update-1' }, body: { extractedEntities: [{ itemName: 'Pump', minorCategory: 'Centrifugal Pumps' }] }, user: { role: 'admin' } },
        resItemNoMajor,
        next
      );
      expect(resItemNoMajor.statusCode).toBe(400);

      // Status transition from Parsing to Quotes Pending when vendors assigned
      jest.spyOn(storeService, 'updateRFQ').mockReturnValue({ ...rfq, status: 'Quotes Pending' });
      const resOk = mockRes();
      await rfqController.updateRFQ(
        { params: { id: 'rfq-update-1' }, body: { assignedVendors: [{ id: 'v-1' }] }, user: { role: 'admin' } },
        resOk,
        next
      );
      expect(resOk.statusCode).toBe(200);

      // storeService.updateRFQ returning null
      storeService.updateRFQ.mockReturnValue(null);
      const resNull = mockRes();
      await rfqController.updateRFQ({ params: { id: 'rfq-update-1' }, body: {}, user: { role: 'admin' } }, resNull, next);
      expect(resNull.statusCode).toBe(404);

      storeService.getRFQById.mockRestore();
      storeService.getVendorById.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.updateRFQ.mockRestore();
    });

    test('extendRFQ 404, invalid payload, failure reason, and success', async () => {
      const next = jest.fn();

      // 404
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(null);
      const res404 = mockRes();
      await rfqController.extendRFQ({ params: { id: 'rfq-none' }, user: { role: 'admin' } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // Invalid payload
      storeService.getRFQById.mockReturnValue({ id: 'rfq-ext-1' });
      const resBad = mockRes();
      await rfqController.extendRFQ({ params: { id: 'rfq-ext-1' }, body: { hours: 'invalid' }, user: { role: 'admin' } }, resBad, next);
      expect(resBad.statusCode).toBe(400);

      // extendRFQ returns failure
      jest.spyOn(storeService, 'extendRFQ').mockReturnValue({ success: false, reason: 'ALREADY_EXTENDED', error: 'Already extended' });
      const resFail = mockRes();
      await rfqController.extendRFQ({ params: { id: 'rfq-ext-1' }, body: { hours: 24 }, user: { role: 'admin' } }, resFail, next);
      expect(resFail.statusCode).toBe(400);

      // extendRFQ returns success
      storeService.extendRFQ.mockReturnValue({
        success: true,
        rfq: { id: 'rfq-ext-1', closingDeadline: '2026-12-01' },
      });
      const resOk = mockRes();
      await rfqController.extendRFQ({ params: { id: 'rfq-ext-1' }, body: { hours: 24 }, user: { role: 'admin', email: 'b@test.com' } }, resOk, next);
      expect(resOk.statusCode).toBe(200);

      storeService.getRFQById.mockRestore();
      storeService.extendRFQ.mockRestore();
    });
  });

  describe('addQuote and downloadRFQ branches', () => {
    test('addQuote attachment validation, unlock check, credits, and catch block', async () => {
      const next = jest.fn();
      const vendor = { id: 'v-quote-1', name: 'Vendor 1', email: 'v@quote.com' };
      const rfq = { id: 'rfq-quote-1', sourcingMode: 'mode_0' };

      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);

      // Attachments not an array
      const resNotArr = mockRes();
      await rfqController.addQuote(
        { user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' }, params: { id: 'rfq-quote-1' }, body: { attachments: 'bad' } },
        resNotArr,
        next
      );
      expect(resNotArr.statusCode).toBe(400);

      // Attachments > 5
      const resTooMany = mockRes();
      await rfqController.addQuote(
        {
          user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' },
          params: { id: 'rfq-quote-1' },
          body: { attachments: Array.from({ length: 6 }, (_, i) => ({ id: `att-${i}` })) },
        },
        resTooMany,
        next
      );
      expect(resTooMany.statusCode).toBe(400);

      // Missing unitPrice
      const resNoPrice = mockRes();
      await rfqController.addQuote(
        { user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' }, params: { id: 'rfq-quote-1' }, body: {} },
        resNoPrice,
        next
      );
      expect(resNoPrice.statusCode).toBe(400);

      // Mode 0 locked RFQ without unlimited access
      jest.spyOn(storeService, 'isRfqUnlockedForVendor').mockReturnValue(false);
      const resLocked = mockRes();
      await rfqController.addQuote(
        { user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' }, params: { id: 'rfq-quote-1' }, body: { unitPrice: 100 } },
        resLocked,
        next
      );
      expect(resLocked.statusCode).toBe(403);
      expect(resLocked.data.downloadRequired).toBe(true);

      // Exhausted credits without unlimited access
      storeService.isRfqUnlockedForVendor.mockReturnValue(true);
      jest.spyOn(storeService, 'checkVendorQuotationEligibility').mockReturnValue({ eligible: false, freeCreditsRemaining: 0, subscriptionPlan: 'free' });
      const resExhausted = mockRes();
      await rfqController.addQuote(
        { user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' }, params: { id: 'rfq-quote-1' }, body: { unitPrice: 100 } },
        resExhausted,
        next
      );
      expect(resExhausted.statusCode).toBe(403);
      expect(resExhausted.data.upgradeRequired).toBe(true);

      // Invalid bid document from different RFQ
      storeService.checkVendorQuotationEligibility.mockReturnValue({ eligible: true });
      jest.spyOn(quoteAttachmentService, 'loadQuoteAttachment').mockResolvedValue({
        access: { rfqId: 'rfq-diff', vendorId: 'v-quote-1' },
      });
      const resBadDoc = mockRes();
      await rfqController.addQuote(
        {
          user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' },
          params: { id: 'rfq-quote-1' },
          body: { unitPrice: 100, attachments: [{ id: 'att-1' }] },
        },
        resBadDoc,
        next
      );
      expect(resBadDoc.statusCode).toBe(400);

      // addQuoteToRFQ returns null
      quoteAttachmentService.loadQuoteAttachment.mockResolvedValue({
        access: { rfqId: 'rfq-quote-1', vendorId: 'v-quote-1' },
        meta: { id: 'att-1', fileName: 'bid.pdf' },
      });
      jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue(null);
      const resNull = mockRes();
      await rfqController.addQuote(
        {
          user: { role: 'vendor', id: 'v-quote-1', email: 'v@quote.com' },
          params: { id: 'rfq-quote-1' },
          body: { unitPrice: 100, attachments: [{ id: 'att-1' }] },
        },
        resNull,
        next
      );
      expect(resNull.statusCode).toBe(404);

      storeService.getRFQByIdAsync.mockRestore();
      storeService.getVendorById.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.isRfqUnlockedForVendor.mockRestore();
      storeService.checkVendorQuotationEligibility.mockRestore();
      quoteAttachmentService.loadQuoteAttachment.mockRestore();
      storeService.addQuoteToRFQ.mockRestore();
    });

    test('downloadRFQ and generateEmailPreview exhaustion and non-vendor download', async () => {
      const next = jest.fn();
      const rfq = { id: 'rfq-dl-1', rfqNumber: 'RFQ-DL-1' };
      const vendor = { id: 'v-dl-1', email: 'v@dl.com', rfqDownloadsUsed: 5 };

      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(rfq);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(true);
      jest.spyOn(storeService, 'updateVendor').mockReturnValue(true);

      // downloadRFQ credits exhausted
      jest.spyOn(storeService, 'unlockRFQForVendor').mockResolvedValue({
        success: false,
        creditsExhausted: true,
        freeCreditsRemaining: 0,
        error: 'Credits exhausted',
      });
      const resDlEx = mockRes();
      await rfqController.downloadRFQ(
        { user: { role: 'vendor', id: 'v-dl-1', email: 'v@dl.com' }, params: { id: 'rfq-dl-1' } },
        resDlEx,
        next
      );
      expect(resDlEx.statusCode).toBe(403);

      // downloadRFQ for non-vendor (buyer)
      const resDlBuyer = mockRes();
      await rfqController.downloadRFQ(
        { user: { role: 'admin' }, params: { id: 'rfq-dl-1' } },
        resDlBuyer,
        next
      );
      expect(resDlBuyer.statusCode).toBe(200);

      // generateEmailPreview credits exhausted
      const resPrevEx = mockRes();
      await rfqController.generateEmailPreview(
        { user: { role: 'vendor', id: 'v-dl-1', email: 'v@dl.com' }, params: { id: 'rfq-dl-1' }, query: {} },
        resPrevEx,
        next
      );
      expect(resPrevEx.statusCode).toBe(403);

      storeService.getRFQByIdAsync.mockRestore();
      storeService.getRFQById.mockRestore();
      storeService.getVendorById.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.updateVendor.mockRestore();
      storeService.unlockRFQForVendor.mockRestore();
    });
  });

  describe('addInquiry and replyInquiry comprehensive suite', () => {
    test('addInquiry validations, dispatch, and error handling', async () => {
      const next = jest.fn();

      // Missing message
      const resNoMsg = mockRes();
      await rfqController.addInquiry({ params: { id: 'rfq-1' }, body: {} }, resNoMsg, next);
      expect(resNoMsg.statusCode).toBe(400);

      // 404
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.addInquiry({ params: { id: 'rfq-1' }, body: { message: 'Question' } }, res404, next);
      expect(res404.statusCode).toBe(404);

      // addInquiryToRFQ returns null
      const rfq = { id: 'rfq-1', rfqNumber: 'RFQ-001', title: 'Pumps RFQ' };
      storeService.getRFQByIdAsync.mockResolvedValue(rfq);
      jest.spyOn(storeService, 'addInquiryToRFQ').mockReturnValue(null);
      const resNull = mockRes();
      await rfqController.addInquiry({ params: { id: 'rfq-1' }, body: { message: 'Question' } }, resNull, next);
      expect(resNull.statusCode).toBe(404);

      // Success
      storeService.addInquiryToRFQ.mockReturnValue({
        inquiry: { id: 'inq-1', message: 'Question' },
        updatedRfq: rfq,
      });
      const mailSpy = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValue(true);
      const resOk = mockRes();
      await rfqController.addInquiry(
        {
          params: { id: 'rfq-1' },
          body: { message: 'Question', vendorEmail: 'v@test.com', vendorName: 'Vendor Name' },
          user: { role: 'vendor', id: 'v-1', email: 'v@test.com' },
        },
        resOk,
        next
      );
      expect(resOk.statusCode).toBe(201);
      expect(resOk.data.data.id).toBe('inq-1');
      expect(mailSpy).toHaveBeenCalledWith('v@test.com', expect.objectContaining({ rfqNumber: 'RFQ-001' }));

      // Catch error
      storeService.getRFQByIdAsync.mockRejectedValue(new Error('inq err'));
      await rfqController.addInquiry({ params: { id: 'rfq-1' }, body: { message: 'Question' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQByIdAsync.mockRestore();
      storeService.addInquiryToRFQ.mockRestore();
      mailSpy.mockRestore();
    });

    test('replyInquiry validations, success, and error handling', async () => {
      const next = jest.fn();

      // Missing reply
      const resNoReply = mockRes();
      await rfqController.replyInquiry({ params: { id: 'rfq-1', inquiryId: 'inq-1' }, body: {} }, resNoReply, next);
      expect(resNoReply.statusCode).toBe(400);

      // 404 RFQ
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(null);
      const res404 = mockRes();
      await rfqController.replyInquiry(
        { params: { id: 'rfq-1', inquiryId: 'inq-1' }, body: { reply: 'Answer' } },
        res404,
        next
      );
      expect(res404.statusCode).toBe(404);

      // 404 inquiry not found on RFQ
      const rfq = { id: 'rfq-1' };
      storeService.getRFQByIdAsync.mockResolvedValue(rfq);
      jest.spyOn(storeService, 'replyToRFQInquiry').mockReturnValue(null);
      const resNull = mockRes();
      await rfqController.replyInquiry(
        { params: { id: 'rfq-1', inquiryId: 'inq-1' }, body: { reply: 'Answer' } },
        resNull,
        next
      );
      expect(resNull.statusCode).toBe(404);

      // Success
      storeService.replyToRFQInquiry.mockReturnValue({
        inquiry: { id: 'inq-1', reply: 'Answer' },
        updatedRfq: rfq,
      });
      const resOk = mockRes();
      await rfqController.replyInquiry(
        {
          params: { id: 'rfq-1', inquiryId: 'inq-1' },
          body: { reply: 'Answer' },
          user: { name: 'Lead Buyer', email: 'buyer@corp.com' },
        },
        resOk,
        next
      );
      expect(resOk.statusCode).toBe(200);
      expect(resOk.data.data.reply).toBe('Answer');

      // Catch error
      storeService.getRFQByIdAsync.mockRejectedValue(new Error('reply err'));
      await rfqController.replyInquiry(
        { params: { id: 'rfq-1', inquiryId: 'inq-1' }, body: { reply: 'Answer' } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQByIdAsync.mockRestore();
      storeService.replyToRFQInquiry.mockRestore();
    });
  });

  describe('Comprehensive branch boost for rfqController', () => {
    test('getAllRFQs with summaryOnly = true formats mapped properties', async () => {
      const rfqs = [
        {
          id: 'rfq-sum-1',
          rfqNumber: 'RFQ-SUM-001',
          title: 'Summary Test',
          category: 'Pumps & Motors',
          status: 'Open',
          sourcingMode: 'mode_1',
          budget: 50000,
          createdAt: '2026-01-01',
          deadline: '2026-02-01',
          targetDeliveryDate: '2026-03-01',
          deliveryLocation: 'Mumbai',
          quotesCount: 1,
          buyerAccountId: 'acc-1',
          buyerAccountName: 'Acme',
          assignedVendors: [{ vendorId: 'v-1', vendorName: 'V1', status: 'Invited' }],
          quotes: [{ id: 'q-1', vendorId: 'v-1', vendorName: 'V1', submittedAt: '2026-01-02', totalAmount: 45000 }],
        },
      ];
      jest.spyOn(storeService, 'getRFQs').mockReturnValue(rfqs);

      const req = { user: { role: 'buyer', email: 'b@test.com' }, query: { summary: 'true' } };
      const res = mockRes();
      await rfqController.getAllRFQs(req, res, jest.fn());

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.data[0].id).toBe('rfq-sum-1');
      expect(res.data.data[0].assignedVendors[0].vendorName).toBe('V1');
      expect(res.data.data[0].quotes[0].id).toBe('q-1');
      storeService.getRFQs.mockRestore();
    });

    test('canVendorViewRfq via getRFQById with unlimited and V0/V2/V3 category rules', async () => {
      const next = jest.fn();

      // Unlimited download access vendor on non-private RFQ
      const rfqUnlimited = { id: 'rfq-unlim-view', sourcingMode: 'mode_1', buyerAccountId: 'b-unlim' };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfqUnlimited);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(false);
      jest.spyOn(storeService, 'isVendorPrivateToDifferentBuyer').mockReturnValue(false);

      const reqUnlimited = {
        params: { id: 'rfq-unlim-view' },
        user: { role: 'vendor', email: 'unlim@vendor.com', unlimitedRfqDownloads: true },
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-unlim',
        email: 'unlim@vendor.com',
        unlimitedRfqDownloads: true,
      });

      const resUnlimited = mockRes();
      await rfqController.getRFQById(reqUnlimited, resUnlimited, next);
      expect(resUnlimited.statusCode).toBe(200);

      // Vendor without majorCategory on V0 RFQ
      const rfqV0 = { id: 'rfq-v0-view', sourcingMode: 'mode_0' };
      storeService.getRFQByIdAsync.mockResolvedValue(rfqV0);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Pumps & Motors']);
      const reqV0NoCat = {
        params: { id: 'rfq-v0-view' },
        user: { role: 'vendor', email: 'nocat@vendor.com' },
      };
      storeService.getVendorById.mockReturnValue({
        id: 'v-nocat',
        email: 'nocat@vendor.com',
        majorCategory: '',
      });
      const resV0NoCat = mockRes();
      await rfqController.getRFQById(reqV0NoCat, resV0NoCat, next);
      expect(resV0NoCat.statusCode).toBe(200);

      storeService.getRFQByIdAsync.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.isVendorPrivateToDifferentBuyer.mockRestore();
      storeService._rfqCategorySignals.mockRestore();
      storeService.getVendorById.mockRestore();
    });

    test('createRFQ category validations and quota rejections', async () => {
      const next = jest.fn();

      // Past targetDeliveryDate
      const resPast = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2020-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resPast,
        next
      );
      expect(resPast.statusCode).toBe(400);
      expect(resPast.data.error).toContain('Target date cannot be earlier than today');

      // Invalid canonical major category
      jest.spyOn(rfqIngestionService, 'canonicalMajor').mockReturnValue(null);
      const resBadMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Invalid Cat 123',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resBadMajor,
        next
      );
      expect(resBadMajor.statusCode).toBe(400);
      expect(resBadMajor.data.error).toContain('Invalid major category');

      // Minor category not under major
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      jest.spyOn(rfqIngestionService, 'isMinorUnderMajor').mockReturnValue(false);
      const resBadMinor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            minorCategory: 'Bad Minor',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resBadMinor,
        next
      );
      expect(resBadMinor.statusCode).toBe(400);
      expect(resBadMinor.data.error).toContain('does not belong to major category');

      // Line item targetDate in past
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(true);
      const resItemPast = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
            lineItems: [{ targetDate: '2020-01-01' }],
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resItemPast,
        next
      );
      expect(resItemPast.statusCode).toBe(400);

      // Line item invalid major category
      rfqIngestionService.canonicalMajor.mockImplementation((c) => (c === 'Pumps & Motors' ? 'Pumps & Motors' : null));
      const resItemBadMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
            lineItems: [{ majorCategory: 'Unknown Major' }],
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resItemBadMajor,
        next
      );
      expect(resItemBadMajor.statusCode).toBe(400);

      // Line item minor without major
      const resItemMinorNoMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: '',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
            lineItems: [{ minorCategory: 'Some Minor' }],
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resItemMinorNoMajor,
        next
      );
      expect(resItemMinorNoMajor.statusCode).toBe(400);

      // Line item minor not under major
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(false);
      const resItemBadCombo = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
            lineItems: [{ majorCategory: 'Pumps & Motors', minorCategory: 'Wrong Sub' }],
          },
          user: { role: 'buyer', email: 'b@corp.com' },
        },
        resItemBadCombo,
        next
      );
      expect(resItemBadCombo.statusCode).toBe(400);

      // Unentitled mode (version_1 plan requesting mode_2)
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(true);
      const buyerAccount = { id: 'buyer-v1', subscriptionPlan: 'version_1', remainingFreeRFQs: 5 };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(buyerAccount);

      const resUnentitled = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_2',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@v1.com' },
        },
        resUnentitled,
        next
      );
      expect(resUnentitled.statusCode).toBe(403);
      expect(resUnentitled.data.error).toContain('does not include mode_2');

      // Free trial exhausted (remainingCredits <= 0)
      const buyerExhausted = { id: 'buyer-exh', subscriptionPlan: 'free', remainingFreeRFQs: 0 };
      storeService.getBuyerAccountByEmail.mockReturnValue(buyerExhausted);

      const resExhausted = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_1',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@exh.com' },
        },
        resExhausted,
        next
      );
      expect(resExhausted.statusCode).toBe(403);
      expect(resExhausted.data.error).toContain('fully used');

      // consumeRFQCreditIfApplicable returns consumed = false
      const buyerAlmostExhausted = { id: 'buyer-almost', subscriptionPlan: 'free', remainingFreeRFQs: 1 };
      storeService.getBuyerAccountByEmail.mockReturnValue(buyerAlmostExhausted);
      jest.spyOn(storeService, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: false });

      const resConsumeFail = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_1',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@almost.com' },
        },
        resConsumeFail,
        next
      );
      expect(resConsumeFail.statusCode).toBe(403);
      expect(resConsumeFail.data.error).toContain('free trial RFQs are used up');

      // Catch block when mailerService.sendRfqAcknowledgementEmail throws inside createRFQ
      storeService.consumeRFQCreditIfApplicable.mockReturnValue({ consumed: true });
      jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-created-mailfail',
        rfqNumber: 'RFQ-MAIL-FAIL',
        title: 'Test',
        category: 'Pumps & Motors',
        deliveryLocation: 'Mumbai',
        targetDeliveryDate: '2099-01-01',
        deadline: '2099-01-10',
        assignedVendors: [],
        extractedEntities: [],
      });
      jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockImplementation(() => {
        throw new Error('SMTP down');
      });

      const resMailFail = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_0',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@mailfail.com' },
        },
        resMailFail,
        next
      );
      expect(resMailFail.statusCode).toBe(201);
      expect(resMailFail.data.data.id).toBe('rfq-created-mailfail');

      // Failure during createRFQ after credit consumed refunds credit
      storeService.createRFQ.mockImplementation(() => { throw new Error('DB creation crash'); });
      const refundSpy = jest.spyOn(storeService, 'refundFreeRFQ').mockReturnValue(true);
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_1',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@crash.com' },
        },
        mockRes(),
        next
      );
      expect(refundSpy).toHaveBeenCalledWith('buyer-almost');
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      rfqIngestionService.canonicalMajor.mockRestore();
      rfqIngestionService.isMinorUnderMajor.mockRestore();
      storeService.getBuyerAccountByEmail.mockRestore();
      storeService.consumeRFQCreditIfApplicable.mockRestore();
      storeService.createRFQ.mockRestore();
      mailerService.sendRfqAcknowledgementEmail.mockRestore();
      refundSpy.mockRestore();
    });

    test('ingestRFQ and getRFQSummary endpoints', async () => {
      const next = jest.fn();

      // ingestRFQ validation failure
      const resIngestInvalid = mockRes();
      await rfqController.ingestRFQ({ body: {} }, resIngestInvalid, next);
      expect(resIngestInvalid.statusCode).toBe(400);

      // ingestRFQ 0 line items accepted -> 422
      jest.spyOn(rfqIngestionService, 'buildRFQDraft').mockResolvedValue({
        draft: {},
        classification: { accepted: 0, rejected: 2 },
      });
      const resIngest422 = mockRes();
      await rfqController.ingestRFQ(
        { body: { lineItems: [{ description: 'Pump' }] } },
        resIngest422,
        next
      );
      expect(resIngest422.statusCode).toBe(422);

      // ingestRFQ success
      rfqIngestionService.buildRFQDraft.mockResolvedValue({
        draft: { title: 'Draft RFQ' },
        classification: { accepted: 5, rejected: 0 },
      });
      const resIngestOk = mockRes();
      await rfqController.ingestRFQ(
        { body: { lineItems: [{ description: 'Good Pump' }] } },
        resIngestOk,
        next
      );
      expect(resIngestOk.statusCode).toBe(200);
      expect(resIngestOk.data.data.title).toBe('Draft RFQ');

      // ingestRFQ catch block
      rfqIngestionService.buildRFQDraft.mockRejectedValue(new Error('ingest crash'));
      await rfqController.ingestRFQ(
        { body: { lineItems: [{ description: 'Crash' }] } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // getRFQSummary success
      jest.spyOn(rfqSummaryService, 'buildPortfolioSummary').mockReturnValue({ totalRFQs: 12 });
      const resSummary = mockRes();
      await rfqController.getRFQSummary({ user: { role: 'admin' } }, resSummary, next);
      expect(resSummary.statusCode).toBe(200);
      expect(resSummary.data.data.totalRFQs).toBe(12);

      // getRFQSummary catch block
      rfqSummaryService.buildPortfolioSummary.mockImplementation(() => { throw new Error('summary crash'); });
      await rfqController.getRFQSummary({ user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      rfqIngestionService.buildRFQDraft.mockRestore();
      rfqSummaryService.buildPortfolioSummary.mockRestore();
    });

    test('extractRFQFromDocument handles fileKey branches', async () => {
      const next = jest.fn();

      // fileKey not found -> 422
      jest.spyOn(extractionStagingService, 'load').mockResolvedValue(null);
      const resNoKey = mockRes();
      await rfqController.extractRFQFromDocument(
        { body: { fileName: 'test.pdf', fileKey: 'missing-key' } },
        resNoKey,
        next
      );
      expect(resNoKey.statusCode).toBe(422);
      expect(resNoKey.data.reason).toBe('NO_CONTENT');

      // fileKey found -> loads buffer to base64
      extractionStagingService.load.mockResolvedValue(Buffer.from('sample pdf bytes'));
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        lineItems: [{ description: 'Extracted Pump', quantity: 1, unit: 'pcs' }],
        documentTitle: 'Title',
        category: 'Pumps & Motors',
      });
      const resWithKey = mockRes();
      await rfqController.extractRFQFromDocument(
        { body: { fileName: 'test.pdf', fileKey: 'valid-key' } },
        resWithKey,
        next
      );
      expect(resWithKey.statusCode).toBe(200);
      expect(resWithKey.data.success).toBe(true);

      extractionStagingService.load.mockRestore();
      geminiService.extractLineItems.mockRestore();
    });

    test('uploadRFQAttachment success and downloadQuoteAttachment 403/404/catch', async () => {
      const next = jest.fn();

      // uploadRFQAttachment success
      jest.spyOn(rfqAttachmentService, 'saveAttachment').mockResolvedValue({
        status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED,
        attachment: { id: 'att-saved-1', fileName: 'specs.pdf' },
      });
      const resUploadOk = mockRes();
      await rfqController.uploadRFQAttachment(
        { body: { fileName: 'specs.pdf', mimeType: 'application/pdf', content: 'dGVzdA==' } },
        resUploadOk,
        next
      );
      expect(resUploadOk.statusCode).toBe(201);
      expect(resUploadOk.data.data.id).toBe('att-saved-1');

      // uploadRFQAttachment catch block
      rfqAttachmentService.saveAttachment.mockRejectedValue(new Error('upload crash'));
      await rfqController.uploadRFQAttachment(
        { body: { fileName: 'specs.pdf', mimeType: 'application/pdf', content: 'dGVzdA==' } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // downloadQuoteAttachment 403 for buyer during 48-hour window
      const rfqSealed = { id: 'rfq-sealed', buyerAccountId: 'buyer-acc-sealed', quotes: [] };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfqSealed);
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({ id: 'buyer-acc-sealed' });
      jest.spyOn(storeService, 'isWithin48HourWindow').mockReturnValue(true);

      const resSealed = mockRes();
      await rfqController.downloadQuoteAttachment(
        {
          params: { id: 'rfq-sealed', attachmentId: 'att-1' },
          user: { role: 'buyer', email: 'b@sealed.com' },
        },
        resSealed,
        next
      );
      expect(resSealed.statusCode).toBe(403);
      expect(resSealed.data.error).toContain('sealed during the bidding window');

      // downloadQuoteAttachment 404 when stored.access does not match
      storeService.isWithin48HourWindow.mockReturnValue(false);
      rfqSealed.quotes = [{ id: 'q-1', vendorId: 'v-1', attachments: [{ id: 'att-1' }] }];
      jest.spyOn(quoteAttachmentService, 'loadQuoteAttachment').mockResolvedValue({
        access: { rfqId: 'different-rfq', vendorId: 'v-1' },
        content: Buffer.from('data'),
        meta: { fileName: 'quote.pdf' },
      });

      const resMismatch = mockRes();
      await rfqController.downloadQuoteAttachment(
        {
          params: { id: 'rfq-sealed', attachmentId: 'att-1' },
          user: { role: 'admin' },
        },
        resMismatch,
        next
      );
      expect(resMismatch.statusCode).toBe(404);

      // downloadQuoteAttachment catch block
      quoteAttachmentService.loadQuoteAttachment.mockRejectedValue(new Error('download quote crash'));
      await rfqController.downloadQuoteAttachment(
        {
          params: { id: 'rfq-sealed', attachmentId: 'att-1' },
          user: { role: 'admin' },
        },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      rfqAttachmentService.saveAttachment.mockRestore();
      storeService.getRFQByIdAsync.mockRestore();
      storeService.ensureBuyerAccountForUser.mockRestore();
      storeService.isWithin48HourWindow.mockRestore();
      quoteAttachmentService.loadQuoteAttachment.mockRestore();
    });

    test('updateRFQ category validations and catch block', async () => {
      const next = jest.fn();
      const existing = { id: 'rfq-up-1', status: 'Draft', category: 'Pumps & Motors' };
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(existing);

      // Invalid declaredMajor
      jest.spyOn(rfqIngestionService, 'canonicalMajor').mockReturnValue(null);
      const resBadMajor = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-1' },
          body: { majorCategory: 'Invalid Major' },
          user: { role: 'admin' },
        },
        resBadMajor,
        next
      );
      expect(resBadMajor.statusCode).toBe(400);

      // Minor not under major
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      jest.spyOn(rfqIngestionService, 'isMinorUnderMajor').mockReturnValue(false);
      const resBadMinor = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-1' },
          body: { minorCategory: 'Wrong Minor' },
          user: { role: 'admin' },
        },
        resBadMinor,
        next
      );
      expect(resBadMinor.statusCode).toBe(400);

      // extractedEntities with invalid major
      rfqIngestionService.canonicalMajor.mockImplementation((c) => (c === 'Pumps & Motors' ? 'Pumps & Motors' : null));
      const resItemBadMajor = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-1' },
          body: { extractedEntities: [{ majorCategory: 'Unknown Major' }] },
          user: { role: 'admin' },
        },
        resItemBadMajor,
        next
      );
      expect(resItemBadMajor.statusCode).toBe(400);

      // extractedEntities with minor without major
      existing.category = '';
      existing.majorCategory = '';
      const resItemMinorNoMajor = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-1' },
          body: { extractedEntities: [{ minorCategory: 'Sub Minor' }] },
          user: { role: 'admin' },
        },
        resItemMinorNoMajor,
        next
      );
      expect(resItemMinorNoMajor.statusCode).toBe(400);

      // extractedEntities with minor not under major
      existing.category = 'Pumps & Motors';
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(false);
      const resItemBadCombo = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-1' },
          body: { extractedEntities: [{ majorCategory: 'Pumps & Motors', minorCategory: 'Wrong Sub' }] },
          user: { role: 'admin' },
        },
        resItemBadCombo,
        next
      );
      expect(resItemBadCombo.statusCode).toBe(400);

      // Catch block
      storeService.getRFQById.mockImplementation(() => { throw new Error('update crash'); });
      await rfqController.updateRFQ({ params: { id: 'rfq-up-1' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQById.mockRestore();
      rfqIngestionService.canonicalMajor.mockRestore();
      rfqIngestionService.isMinorUnderMajor.mockRestore();
    });

    test('deleteRFQ, downloadRFQ, and controller error catches', async () => {
      const next = jest.fn();

      // deleteRFQ returns false -> 404
      const existing = { id: 'rfq-del-1', rfqNumber: 'RFQ-DEL-001' };
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(existing);
      jest.spyOn(storeService, 'deleteRFQ').mockReturnValue(false);

      const resDelFail = mockRes();
      await rfqController.deleteRFQ(
        { params: { id: 'rfq-del-1' }, user: { role: 'admin' } },
        resDelFail,
        next
      );
      expect(resDelFail.statusCode).toBe(404);

      // deleteRFQ returns true -> 200
      storeService.deleteRFQ.mockReturnValue(true);
      const resDelOk = mockRes();
      await rfqController.deleteRFQ(
        { params: { id: 'rfq-del-1' }, user: { role: 'admin' } },
        resDelOk,
        next
      );
      expect(resDelOk.statusCode).toBe(200);
      expect(resDelOk.data.data.rfqNumber).toBe('RFQ-DEL-001');

      // deleteRFQ catch block
      storeService.deleteRFQ.mockImplementation(() => { throw new Error('delete crash'); });
      await rfqController.deleteRFQ({ params: { id: 'rfq-del-1' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // downloadRFQ vendor profile not found -> 400
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(existing);
      jest.spyOn(storeService, 'ensureVendorProfileForUser')
        .mockResolvedValueOnce({ id: 'v-temp', email: 'missing@v.com', unlimitedRfqDownloads: true })
        .mockResolvedValueOnce(null);
      const resNoVend = mockRes();
      await rfqController.downloadRFQ(
        { params: { id: 'rfq-del-1' }, user: { role: 'vendor', email: 'missing@v.com', unlimitedRfqDownloads: true } },
        resNoVend,
        next
      );
      expect(resNoVend.statusCode).toBe(400);

      // triggerBatchChaser and approvePO catch blocks
      jest.spyOn(storeService, 'triggerBatchChaser').mockImplementation(() => { throw new Error('chaser crash'); });
      await rfqController.triggerBatchChaser({ params: { id: 'rfq-1' }, body: {} }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      jest.spyOn(storeService, 'approvePurchaseOrder').mockImplementation(() => { throw new Error('approve crash'); });
      await rfqController.approvePO(
        {
          params: { id: 'rfq-1' },
          user: { role: 'buyer', email: 'b@corp.com' },
          body: { vendorName: 'V', totalAmount: 100 },
        },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      storeService.getRFQById.mockRestore();
      storeService.deleteRFQ.mockRestore();
      storeService.getRFQByIdAsync.mockRestore();
      storeService.ensureVendorProfileForUser.mockRestore();
      storeService.triggerBatchChaser.mockRestore();
      storeService.approvePurchaseOrder.mockRestore();
    });

    test('Final push: coverage for lines 141, 268, 346, 562, 668, 1368, 1536, 1603, 1768, 1817, 1870, 1895, 1939', async () => {
      const next = jest.fn();

      // Line 141: canVendorViewRfq vendor covers category via signals.some
      const rfqV0Sig = { id: 'rfq-v0-sig', sourcingMode: 'mode_0' };
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfqV0Sig);
      jest.spyOn(storeService, 'vendorCoversRFQ').mockReturnValue(false);
      jest.spyOn(storeService, 'isVendorPrivateToDifferentBuyer').mockReturnValue(false);
      jest.spyOn(storeService, '_rfqCategorySignals').mockReturnValue(['Pumps & Motors']);
      jest.spyOn(storeService, 'vendorCoversCategory').mockReturnValue(true);

      const reqV0Sig = {
        params: { id: 'rfq-v0-sig' },
        user: { role: 'vendor', email: 'sig@vendor.com' },
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-sig',
        email: 'sig@vendor.com',
        majorCategory: 'Pumps & Motors',
      });
      const resV0Sig = mockRes();
      await rfqController.getRFQById(reqV0Sig, resV0Sig, next);
      expect(resV0Sig.statusCode).toBe(200);

      // Line 268: applyVendorBuyerPrivacy when bidSubmittedAt is > 48h ago
      const oldTime = new Date(Date.now() - 50 * 3600 * 1000).toISOString();
      const rfqOldQuote = {
        id: 'rfq-old-quote',
        sourcingMode: 'mode_1',
        buyerAccountId: 'b-old',
        quotes: [{ id: 'q-old', vendorId: 'v-sig', submittedAt: oldTime }],
      };
      storeService.getRFQByIdAsync.mockResolvedValue(rfqOldQuote);
      storeService.vendorCoversRFQ.mockReturnValue(true);
      const resOldQuote = mockRes();
      await rfqController.getRFQById(reqV0Sig, resOldQuote, next);
      expect(resOldQuote.statusCode).toBe(200);
      expect(resOldQuote.data.data.buyerDetailsHidden).toBe(false);

      // Line 346: getRFQs with summary = 'true'
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(undefined);
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        { id: 'rfq-sum-2', rfqNumber: 'RFQ-SUM-2', title: 'T', category: 'C', status: 'Open' },
      ]);
      const resGetSummary = mockRes();
      await rfqController.getRFQs({ user: { role: 'admin' }, query: { summary: 'true' } }, resGetSummary, next);
      expect(resGetSummary.statusCode).toBe(200);
      expect(resGetSummary.data.data[0].id).toBe('rfq-sum-2');

      // Line 562: requestVendorCategoryUpdate with storeService.recordAuditEntry
      storeService.recordAuditEntry = jest.fn();
      jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue(undefined);
      const resAuditEntry = mockRes();
      await rfqController.requestVendorCategoryUpdate(
        {
          body: { vendorId: 'v-audit', vendorEmail: 'v@audit.com' },
          user: { email: 'buyer@audit.com' },
        },
        resAuditEntry,
        next
      );
      expect(resAuditEntry.statusCode).toBe(200);
      expect(storeService.recordAuditEntry).toHaveBeenCalled();
      delete storeService.recordAuditEntry;

      // Line 668: createRFQ with declaredMinor without declaredMajor -> 400
      const resMinorNoMajor = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Test Minor No Major',
            category: '',
            majorCategory: '',
            minorCategory: 'Valves',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
          },
          user: { role: 'buyer', email: 'b@test.com' },
        },
        resMinorNoMajor,
        next
      );
      expect(resMinorNoMajor.statusCode).toBe(400);
      expect(resMinorNoMajor.data.error).toContain('without a valid major category');

      // Lines 1368-1369: uploadQuoteAttachment catch block
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue({ id: 'rfq-att-err', sourcingMode: 'mode_0' });
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v-att-err', email: 'sig@vendor.com' });
      storeService.vendorCoversRFQ.mockReturnValue(true);
      jest.spyOn(quoteAttachmentService, 'saveQuoteAttachment').mockRejectedValue(new Error('quote att crash'));
      await rfqController.uploadQuoteAttachment(
        {
          params: { id: 'rfq-att-err' },
          body: { fileName: 'test.pdf', mimeType: 'application/pdf', content: 'dGVzdA==' },
          user: { role: 'vendor', email: 'sig@vendor.com' },
        },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // Lines 1536-1537: updateRFQ with !item.majorCategory && effectiveLineMajor
      const rfqToUpdate = { id: 'rfq-up-eff', status: 'Draft', category: 'Pumps & Motors' };
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(rfqToUpdate);
      jest.spyOn(rfqIngestionService, 'canonicalMajor').mockReturnValue('Pumps & Motors');
      jest.spyOn(rfqIngestionService, 'isMinorUnderMajor').mockReturnValue(true);
      jest.spyOn(storeService, 'updateRFQ').mockReturnValue({ ...rfqToUpdate, title: 'Updated' });
      const resUpdateEff = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-up-eff' },
          body: { extractedEntities: [{ minorCategory: 'Centrifugal', targetDate: '2099-01-01' }] },
          user: { role: 'admin' },
        },
        resUpdateEff,
        next
      );
      expect(resUpdateEff.statusCode).toBe(200);

      // Lines 1603-1604: extendRFQ catch block
      storeService.getRFQById.mockImplementation(() => { throw new Error('extend crash'); });
      await rfqController.extendRFQ({ params: { id: 'rfq-ext-err' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // Lines 1768-1769: addQuote catch block
      storeService.getRFQByIdAsync.mockImplementationOnce(() => { throw new Error('add quote crash'); });
      await rfqController.addQuote(
        {
          params: { id: 'rfq-quote-err' },
          body: { totalAmount: 500, unitPrice: 500 },
          user: { role: 'vendor', email: 'sig@vendor.com' },
        },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // Lines 1817-1818: downloadRFQ catch block
      storeService.getRFQByIdAsync.mockImplementation(() => { throw new Error('download rfq crash'); });
      await rfqController.downloadRFQ({ params: { id: 'rfq-dl-err' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // Line 1870: triggerBatchChaser success
      jest.spyOn(storeService, 'triggerBatchChaser').mockReturnValue({ queuedCount: 3 });
      const resChaserOk = mockRes();
      rfqController.triggerBatchChaser({ params: { id: 'rfq-chaser-ok' }, body: {} }, resChaserOk, next);
      expect(resChaserOk.statusCode).toBe(200);
      expect(resChaserOk.data.queuedCount).toBe(3);

      // Line 1895: approvePO success
      jest.spyOn(storeService, 'approvePurchaseOrder').mockReturnValue({ success: true, poNumber: 'PO-2026-001' });
      const resPoOk = mockRes();
      rfqController.approvePO(
        {
          params: { id: 'rfq-po-ok' },
          user: { role: 'buyer', email: 'b@po.com' },
          body: { vendorName: 'Best Vendor', totalAmount: 15000 },
        },
        resPoOk,
        next
      );
      expect(resPoOk.statusCode).toBe(200);
      expect(resPoOk.data.poNumber).toBe('PO-2026-001');

      // Line 1939: addInquiry with rejected sendVendorIssueAcknowledgementEmail
      storeService.getRFQByIdAsync.mockResolvedValue({ id: 'rfq-inq-ack', rfqNumber: 'RFQ-INQ-001', title: 'Inq RFQ' });
      jest.spyOn(storeService, 'addInquiryToRFQ').mockReturnValue({
        inquiry: { id: 'inq-ack-1', message: 'Help' },
        updatedRfq: { id: 'rfq-inq-ack' },
      });
      jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockRejectedValue(new Error('Inq email fail'));
      const resInqAck = mockRes();
      await rfqController.addInquiry(
        {
          params: { id: 'rfq-inq-ack' },
          body: { message: 'Inquiry message', vendorEmail: 'v@inq.com' },
          user: { role: 'buyer', email: 'b@inq.com' },
        },
        resInqAck,
        next
      );
      expect(resInqAck.statusCode).toBe(201);
      expect(resInqAck.data.data.id).toBe('inq-ack-1');

      // Lines 664 & 727-728: createRFQ with body.majorCategory and lineItem without majorCategory
      rfqIngestionService.canonicalMajor.mockReturnValue('Pumps & Motors');
      rfqIngestionService.isMinorUnderMajor.mockReturnValue(true);
      jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-cat-fill',
        rfqNumber: 'RFQ-FILL',
        title: 'Fill Cat',
        category: 'Pumps & Motors',
        deliveryLocation: 'Mumbai',
        targetDeliveryDate: '2099-01-01',
        deadline: '2099-01-10',
        assignedVendors: [],
        extractedEntities: [],
      });
      const resFillCat = mockRes();
      await rfqController.createRFQ(
        {
          body: {
            title: 'Fill Cat',
            majorCategory: 'Pumps & Motors',
            category: 'Pumps & Motors',
            sourcingMode: 'mode_0',
            targetDeliveryDate: '2099-01-01',
            deliveryLocation: 'Mumbai',
            deliveryPincode: '400001',
            lineItems: [{ minorCategory: 'Centrifugal', targetDate: '2099-01-01' }],
          },
          user: { role: 'buyer', email: 'b@fill.com' },
        },
        resFillCat,
        next
      );
      expect(resFillCat.statusCode).toBe(201);
      storeService.createRFQ.mockRestore();

      // Lines 1545-1550: updateRFQ with existing.status === 'Parsing' transitioning to 'Quotes Pending'
      const rfqParsing = {
        id: 'rfq-parsing-1',
        status: 'Parsing',
        category: 'Pumps & Motors',
        assignedVendors: [{ vendorId: 'v-1' }],
      };
      storeService.getRFQById.mockReturnValue(rfqParsing);
      const resParsingOk = mockRes();
      await rfqController.updateRFQ(
        {
          params: { id: 'rfq-parsing-1' },
          body: {
            extractedEntities: [
              { majorCategory: 'Pumps & Motors', minorCategory: 'Centrifugal', targetDate: '2099-01-01' },
            ],
          },
          user: { role: 'admin' },
        },
        resParsingOk,
        next
      );
      expect(resParsingOk.statusCode).toBe(200);

      // Lines 193-197: getRFQById with buyer role and concluded RFQ (PO Generated / Expired)
      const rfqConcluded = {
        id: 'rfq-conc-1',
        sourcingMode: 'mode_1',
        status: 'PO Generated',
        poFinalised: true,
        buyerAccountId: 'b-conc',
        createdAt: new Date().toISOString(),
      };
      storeService.getRFQByIdAsync.mockResolvedValue(rfqConcluded);
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({ id: 'b-conc' });
      const resConc = mockRes();
      await rfqController.getRFQById({ params: { id: 'rfq-conc-1' }, user: { role: 'buyer', email: 'b@conc.com' } }, resConc, next);
      expect(resConc.statusCode).toBe(200);
      expect(resConc.data.data.quotesHidden).toBe(false);
      storeService.ensureBuyerAccountForUser.mockRestore();

      // Line 226-228: applyVendorBuyerPrivacy matching vendorRecord.email
      const rfqEmailQuote = {
        id: 'rfq-email-quote',
        sourcingMode: 'mode_1',
        quotes: [{ id: 'q-em', vendorEmail: 'matched@vendor.com', submittedAt: oldTime }],
      };
      storeService.getRFQByIdAsync.mockResolvedValue(rfqEmailQuote);
      storeService.getVendorById.mockReturnValue({
        id: 'v-email-match',
        email: 'matched@vendor.com',
      });
      const resEmailMatch = mockRes();
      await rfqController.getRFQById(
        { params: { id: 'rfq-email-quote' }, user: { role: 'vendor', email: 'matched@vendor.com' } },
        resEmailMatch,
        next
      );
      expect(resEmailMatch.statusCode).toBe(200);
      expect(resEmailMatch.data.data.quotes.length).toBe(1);

      storeService.getRFQByIdAsync.mockRestore();
      storeService.vendorCoversRFQ.mockRestore();
      storeService.isVendorPrivateToDifferentBuyer.mockRestore();
      storeService._rfqCategorySignals.mockRestore();
      storeService.vendorCoversCategory.mockRestore();
      storeService.getVendorById.mockRestore();
      storeService.syncRFQsFromDB.mockRestore();
      storeService.getRFQs.mockRestore();
      mailerService.sendVendorCategoryMismatchEmail.mockRestore();
      quoteAttachmentService.saveQuoteAttachment.mockRestore();
      storeService.getRFQById.mockRestore();
      rfqIngestionService.canonicalMajor.mockRestore();
      rfqIngestionService.isMinorUnderMajor.mockRestore();
      storeService.updateRFQ.mockRestore();
      storeService.triggerBatchChaser.mockRestore();
      storeService.approvePurchaseOrder.mockRestore();
      storeService.addInquiryToRFQ.mockRestore();
      mailerService.sendVendorIssueAcknowledgementEmail.mockRestore();
    });
  });
});
