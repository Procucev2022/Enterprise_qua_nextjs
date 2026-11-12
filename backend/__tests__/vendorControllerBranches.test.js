const vendorController = require('../src/controllers/vendorController');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const vendorPresenceService = require('../src/services/vendorPresenceService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');
const invoiceService = require('../src/services/invoiceService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('Vendor Controller Dedicated Branch Boost Suite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getVendorRfqCredits', () => {
    test('rejects unauthenticated caller with 401', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.getVendorRfqCredits({ params: { id: 'me' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('returns zeroed structure when caller is buyer role', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.getVendorRfqCredits(
        { params: { id: 'me' }, user: { role: 'buyer', email: 'buyer@example.com' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            freeCreditsAllocated: 0,
            freeCreditsRemaining: 0,
          }),
        })
      );
    });

    test('returns the default 5 free credits when vendor profile is not found', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

      await vendorController.getVendorRfqCredits(
        { params: { id: 'v-nonexistent' }, user: { role: 'vendor', email: 'unknown@vendor.com' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            freeCreditsAllocated: 5,
            freeCreditsRemaining: 5,
          }),
        })
      );
    });

    test('returns credits from storeService when vendor is found by id and by email', async () => {
      const res = mockRes();
      const next = jest.fn();
      const mockVendor = { id: 'v-credit-1', email: 'vcredit@example.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockVendor);
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        vendorId: 'v-credit-1',
        freeCreditsAllocated: 10,
        freeCreditsUsed: 2,
        freeCreditsRemaining: 8,
      });

      await vendorController.getVendorRfqCredits(
        { params: { id: 'v-credit-1' }, user: { role: 'vendor', email: 'vcredit@example.com' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ freeCreditsRemaining: 8 }),
        })
      );

      // Lookup with id='me' falling back to user.email
      const resMe = mockRes();
      await vendorController.getVendorRfqCredits(
        { params: { id: 'me' }, user: { role: 'vendor', email: 'vcredit@example.com' } },
        resMe,
        next
      );
      expect(resMe.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ freeCreditsRemaining: 8 }),
        })
      );
    });

    test('forwards errors to next(err)', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Credits lookup failed');
      });

      await vendorController.getVendorRfqCredits(
        { params: { id: 'v-err' }, user: { role: 'vendor', email: 'err@vendor.com' } },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getBulkImportSessionStatus', () => {
    test('rejects unauthorized roles via assertBulkImportRole', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.getBulkImportSessionStatus(
        { params: { sessionId: '00000000-0000-4000-8000-000000000001' }, user: { role: 'vendor' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns 404 when session is not found in DB', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValue(null);

      await vendorController.getBulkImportSessionStatus(
        { params: { sessionId: '00000000-0000-4000-8000-000000000002' }, user: { role: 'admin' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('returns session data when found in DB', async () => {
      const res = mockRes();
      const next = jest.fn();
      const session = {
        id: '00000000-0000-4000-8000-000000000003',
        created_by_email: 'cm@procucev.com',
        status: 'COMPLETED',
        totalRows: 50,
      };
      jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValue(session);

      await vendorController.getBulkImportSessionStatus(
        { params: { sessionId: session.id }, user: { role: 'category_manager', email: 'CM@procucev.com' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: session.id, status: 'COMPLETED', totalRows: 50 },
      });
    });

    test('forwards DB errors to next(err)', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockRejectedValue(new Error('DB connection drop'));

      await vendorController.getBulkImportSessionStatus(
        { params: { sessionId: '00000000-0000-4000-8000-000000000004' }, user: { role: 'admin' } },
        res,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getVendorsPresence & recordVendorHeartbeat', () => {
    test('getVendorsPresence validates query params schema', async () => {
      const res = mockRes();
      const next = jest.fn();

      // Invalid identifiers (exceeds maxLength 2000 to fail validation schema)
      const resBad = mockRes();
      await vendorController.getVendorsPresence(
        { query: { identifiers: 'x'.repeat(2005) } },
        resBad,
        next
      );
      expect(resBad.status).toHaveBeenCalledWith(400);

      // Valid identifiers
      jest.spyOn(vendorPresenceService, 'getPresenceDurably').mockResolvedValue({ onlineCount: 2 });
      await vendorController.getVendorsPresence(
        { query: { identifiers: 'v1,v2' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith({ onlineCount: 2 });

      // Error forwarding
      jest.spyOn(vendorPresenceService, 'getPresenceDurably').mockRejectedValue(new Error('Presence query failed'));
      await vendorController.getVendorsPresence(
        { query: { identifiers: 'v1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('recordVendorHeartbeat validates schema and missing identifier', async () => {
      const res = mockRes();
      const next = jest.fn();

      // Invalid body schema
      const resBad = mockRes();
      await vendorController.recordVendorHeartbeat(
        { body: { status: 9999 }, user: { role: 'vendor', email: 'vendor@example.com' } },
        resBad,
        next
      );
      expect(resBad.status).toHaveBeenCalledWith(400);

      // Missing session
      await vendorController.recordVendorHeartbeat(
        { body: { status: 'online' }, user: null },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(401);

      const resBuyer = mockRes();
      await vendorController.recordVendorHeartbeat(
        { body: { status: 'online' }, user: { role: 'buyer', email: 'buyer@example.com' } },
        resBuyer,
        next
      );
      expect(resBuyer.status).toHaveBeenCalledWith(403);

      const resMissingEmail = mockRes();
      await vendorController.recordVendorHeartbeat(
        { body: { status: 'online' }, user: { role: 'vendor' } },
        resMissingEmail,
        next
      );
      expect(resMissingEmail.status).toHaveBeenCalledWith(400);

      // Successful heartbeat
      jest.spyOn(vendorPresenceService, 'recordHeartbeatDurably').mockResolvedValue({ recorded: true });
      const resOk = mockRes();
      await vendorController.recordVendorHeartbeat(
        {
          body: { identifier: 'spoofed@example.com', role: 'admin', status: 'online' },
          user: { role: 'vendor', email: 'owner@example.com', sub: 'vendor-subject' },
        },
        resOk,
        next
      );
      expect(resOk.json).toHaveBeenCalledWith({ recorded: true });
      expect(vendorPresenceService.recordHeartbeatDurably).toHaveBeenCalledWith(expect.objectContaining({
        identifier: 'owner@example.com',
        role: 'vendor',
        vendorId: null,
      }));

      // Error forwarding
      jest.spyOn(vendorPresenceService, 'recordHeartbeatDurably').mockRejectedValue(new Error('Heartbeat error'));
      await vendorController.recordVendorHeartbeat(
        { body: { identifier: 'v-err' }, user: { role: 'vendor', email: 'owner@example.com' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });
  });

  describe('getSubscriptionPricing', () => {
    test('returns pricing config on success', () => {
      const res = mockRes();
      vendorController.getSubscriptionPricing({}, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Object),
        })
      );
    });
  });

  describe('getVendors query filters & limits', () => {
    test('filters vendors by email and search with short words in minorCategories', async () => {
      const mockList = [
        {
          id: 'v-flt-1',
          name: 'Pumps Inc',
          email: 'pumps@example.com',
          majorCategory: 'Industrial Machinery',
          minorCategories: ['pump', 'valves'],
        },
        {
          id: 'v-flt-2',
          name: 'Steel Works',
          email: 'steel@example.com',
          majorCategory: 'Metals',
          minorCategories: ['pipe', 'rod'],
        },
      ];
      jest.spyOn(storeService, 'getVendors').mockReturnValue(mockList);

      // Email filter
      const resEmail = mockRes();
      const next = jest.fn();
      await vendorController.getVendors({ query: { email: 'pumps' } }, resEmail, next);
      expect(resEmail.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [expect.objectContaining({ id: 'v-flt-1' })],
        })
      );

      // search <= 3 chars searching minorCategories: 'rod'
      const resQShort = mockRes();
      await vendorController.getVendors({ query: { search: 'rod' } }, resQShort, next);
      expect(resQShort.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [expect.objectContaining({ id: 'v-flt-2' })],
        })
      );

      // limit parameter
      const resLimit = mockRes();
      await vendorController.getVendors({ query: { limit: '1' } }, resLimit, next);
      expect(resLimit.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [expect.objectContaining({ id: 'v-flt-1' })],
        })
      );
    });
  });

  describe('getVendorById ownership & query branches', () => {
    test('vendor user can look up their own profile matching user.email', async () => {
      const res = mockRes();
      const next = jest.fn();
      const mockVendor = { id: 'v-self-1', email: 'self@vendor.com', name: 'Self Vendor' };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(mockVendor);

      await vendorController.getVendorById(
        {
          params: { id: 'self@vendor.com' },
          user: { role: 'vendor', email: 'self@vendor.com' },
          query: {},
        },
        res,
        next
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'v-self-1' }),
        })
      );
    });

    test('supports explicit query.buyerId parameter', async () => {
      const res = mockRes();
      const next = jest.fn();
      const mockVendor = { id: 'v-buyer-scoped', email: 'buyer@vendor.com' };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(mockVendor);

      await vendorController.getVendorById(
        {
          params: { id: 'v-buyer-scoped' },
          user: { role: 'admin' },
          query: { buyerId: 'b-org-99' },
        },
        res,
        next
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'v-buyer-scoped' }),
        })
      );
    });
  });

  describe('createVendor role handling & uniqueness', () => {
    test('category_manager assigns procucev_network source', async () => {
      const res = mockRes();
      const next = jest.fn();
      const newVendor = { id: 'v-cm-1', name: 'CM Vendor', majorCategory: 'Tools', email: 'cm@vendor.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      const addVendorSpy = jest.spyOn(storeService, 'addVendorDurably').mockResolvedValue(newVendor);
      jest.spyOn(storeService, 'provisionVendorOnboarding').mockResolvedValue({ error: null });

      await vendorController.createVendor(
        {
          body: { name: 'CM Vendor', majorCategory: 'Tools', email: 'cm@vendor.com' },
          user: { role: 'category_manager', email: 'cm@procucev.com' },
          query: {},
        },
        res,
        next
      );

      expect(addVendorSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'procucev_network' }), 'cm@procucev.com', null);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('rejects invalid or unauthorized roles with 403', async () => {
      const res = mockRes();
      const next = jest.fn();

      await vendorController.createVendor(
        {
          body: { name: 'Unauthorized', majorCategory: 'Tools' },
          user: { role: 'guest' },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects vendor creation when contact phone already exists with 409', async () => {
      const res = mockRes();
      const next = jest.fn();
      storeService.vendors = [{ id: 'v-exist-phone', phone: '+919876543210' }];

      await vendorController.createVendor(
        {
          body: { name: 'Duplicate Phone', majorCategory: 'Tools', email: 'dup@phone.com', phone: '+919876543210' },
          user: { role: 'admin' },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('updateSubscription & createSubscriptionPaymentLink branches', () => {
    test('updateSubscription validates plan against VALID_VENDOR_SUBSCRIPTION_PLANS', async () => {
      const res = mockRes();
      const next = jest.fn();
      const vendor = { id: 'v-sub-1', email: 'sub@vendor.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);

      // Invalid plan (e.g. 'enterprise')
      await vendorController.updateSubscription(
        {
          params: { id: 'v-sub-1' },
          body: { plan: 'enterprise' },
          user: { role: 'admin' },
        },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // Valid plan 'premium'
      const resOk = mockRes();
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ ...vendor, subscriptionPlan: 'premium' });
      await vendorController.updateSubscription(
        {
          params: { id: 'v-sub-1' },
          body: { plan: 'premium' },
          user: { role: 'admin' },
        },
        resOk,
        next
      );
      expect(resOk.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ subscriptionPlan: 'premium' }),
        })
      );
    });

    test('createSubscriptionPaymentLink validates email, plan, and duration', async () => {
      const next = jest.fn();

      // Missing vendor
      const res404 = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(null);
      await vendorController.createSubscriptionPaymentLink(
        { params: { id: 'v-missing' }, user: { role: 'admin' } },
        res404,
        next
      );
      expect(res404.status).toHaveBeenCalledWith(404);

      // Invalid plan
      const resPlan = mockRes();
      const vendorWithEmail = { id: 'v-ok', email: 'ok@vendor.com', phone: '+919876543210' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(vendorWithEmail);
      await vendorController.createSubscriptionPaymentLink(
        { params: { id: 'v-ok' }, body: { plan: 'invalid_tier' }, user: { role: 'admin' } },
        resPlan,
        next
      );
      expect(resPlan.status).toHaveBeenCalledWith(400);

      // Vendor with no email
      const resNoEmail = mockRes();
      const vendorNoEmail = { id: 'v-no-email', email: '' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValueOnce(vendorNoEmail);
      await vendorController.createSubscriptionPaymentLink(
        {
          params: { id: 'v-no-email' },
          body: { plan: 'connect', billingDuration: '6_months' },
          user: { role: 'admin' },
        },
        resNoEmail,
        next
      );
      expect(resNoEmail.status).toHaveBeenCalledWith(400);

      // Invalid pricing amount <= 0
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorWithEmail);
      const { ZOHO_SUBSCRIPTION_PRICING } = require('../src/config/constants');
      ZOHO_SUBSCRIPTION_PRICING.connect = -1;
      const resBadPrice = mockRes();
      await vendorController.createSubscriptionPaymentLink(
        {
          params: { id: 'v-ok' },
          body: { plan: 'connect', billingDuration: '12_months' },
          user: { role: 'admin' },
        },
        resBadPrice,
        next
      );
      delete ZOHO_SUBSCRIPTION_PRICING.connect;
      expect(resBadPrice.status).toHaveBeenCalledWith(400);

      // Successful Zoho payment link creation with duration '6_months'
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorWithEmail);
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValue({
        paymentUrl: 'https://payment.zoho.com/test',
        zohoPaymentLinkId: 'zpl_123',
        status: 'CREATED',
      });
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockResolvedValue({
        id: 'pl-123',
        paymentUrl: 'https://payment.zoho.com/test',
        status: 'CREATED',
      });

      const resSuccess = mockRes();
      await vendorController.createSubscriptionPaymentLink(
        {
          params: { id: 'v-ok' },
          body: { plan: 'connect', billingDuration: '6_months' },
          user: { role: 'admin' },
        },
        resSuccess,
        next
      );
      expect(resSuccess.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ paymentLinkId: 'pl-123' }),
        })
      );

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorWithEmail);
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        paymentUrl: 'https://payment.zoho.com/untracked',
        zohoPaymentLinkId: 'zpl-untracked',
        status: 'CREATED',
      });
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockRejectedValueOnce(
        Object.assign(new Error('database unavailable'), { statusCode: 503, code: 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE' })
      );
      const resPersistFail = mockRes();
      await vendorController.createSubscriptionPaymentLink(
        {
          params: { id: 'v-ok' },
          body: { plan: 'connect', billingDuration: '12_months' },
          user: { role: 'admin' },
        },
        resPersistFail,
        next
      );
      expect(resPersistFail.status).toHaveBeenCalledWith(503);

      // Error from Zoho service returns 502
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockRejectedValue(new Error('Zoho down'));
      const res502 = mockRes();
      await vendorController.createSubscriptionPaymentLink(
        {
          params: { id: 'v-ok' },
          body: { plan: 'connect' },
          user: { role: 'admin' },
        },
        res502,
        next
      );
      expect(res502.status).toHaveBeenCalledWith(502);
    });
  });

  describe('getPaymentLinks and downloadInvoice', () => {
    test('getPaymentLinks handles missing vendor, reconciliation reload, and errors', async () => {
      const next = jest.fn();

      // Missing vendor 404
      const res404 = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      await vendorController.getPaymentLinks({ params: { id: 'v-none' }, user: { role: 'admin' } }, res404, next);
      expect(res404.status).toHaveBeenCalledWith(404);

      // Vendor found and reconciliation reload
      const resOk = mockRes();
      const vendor = { id: 'v-pay-1', email: 'pay@vendor.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue([{ id: 'pl-1' }]);
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(1);

      await vendorController.getPaymentLinks({ params: { id: 'v-pay-1' }, user: { role: 'admin' } }, resOk, next);
      expect(resOk.json).toHaveBeenCalledWith({ success: true, data: [{ id: 'pl-1' }] });

      // Error forwarding
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockRejectedValue(new Error('Fetch links failed'));
      await vendorController.getPaymentLinks({ params: { id: 'v-pay-1' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    test('downloadInvoice handles 404s, PDF receipt generation, and error forwarding', async () => {
      const next = jest.fn();

      // Missing vendor 404
      const res404 = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      await vendorController.downloadInvoice({ params: { id: 'v-none', linkId: 'l1' }, user: { role: 'admin' } }, res404, next);
      expect(res404.status).toHaveBeenCalledWith(404);

      // Missing payment link or mismatch 404
      const vendor = { id: 'v-inv-1', email: 'inv@vendor.com', name: 'Invoice Vendor' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);
      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue(null);

      const resLink404 = mockRes();
      await vendorController.downloadInvoice({ params: { id: 'v-inv-1', linkId: 'l-bad' }, user: { role: 'admin' } }, resLink404, next);
      expect(resLink404.status).toHaveBeenCalledWith(404);

      // Successful PDF generation and streaming
      const validLink = { id: 'l-good', payerType: 'vendor', vendorId: 'v-inv-1', planId: 'connect' };
      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue(validLink);
      jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('PDF_BYTES'));

      const resPdf = mockRes();
      await vendorController.downloadInvoice({ params: { id: 'v-inv-1', linkId: 'l-good' }, user: { role: 'admin' } }, resPdf, next);
      expect(resPdf.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(resPdf.send).toHaveBeenCalled();

      // Error forwarding
      jest.spyOn(storeService, 'getPaymentLinkById').mockRejectedValueOnce(new Error('DB failure'));
      await vendorController.downloadInvoice({ params: { id: 'v-inv-1', linkId: 'l-good' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('bulkImportVendors branches', () => {
    test('bulkImportVendors handles buyer without account, empty rows, and size overflow', async () => {
      const next = jest.fn();

      // Buyer without account 403
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const resNoAccount = mockRes();
      await vendorController.bulkImportVendors(
        { user: { role: 'buyer', email: 'noorg@buyer.com' }, body: { vendors: [{ name: 'V' }] } },
        resNoAccount,
        next
      );
      expect(resNoAccount.status).toHaveBeenCalledWith(403);

      // Empty rows 400
      const resEmpty = mockRes();
      await vendorController.bulkImportVendors(
        { user: { role: 'admin' }, body: { vendors: [] } },
        resEmpty,
        next
      );
      expect(resEmpty.status).toHaveBeenCalledWith(400);

      // Exceeding MAX_BULK_IMPORT_ROWS_PER_REQUEST (15) -> 400
      const resOverflow = mockRes();
      const sixteenRows = Array.from({ length: 16 }, (_, i) => ({ name: `Vendor ${i}` }));
      await vendorController.bulkImportVendors(
        { user: { role: 'admin' }, body: { vendors: sixteenRows } },
        resOverflow,
        next
      );
      expect(resOverflow.status).toHaveBeenCalledWith(400);
    });
  });

  describe('generateOnboardingEmailPreview permissions', () => {
    test('rejects unauthenticated user with 401', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-1' }, user: null }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('rejects unauthorized role (vendor) with 403', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.generateOnboardingEmailPreview(
        { params: { id: 'v-1' }, user: { role: 'vendor' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('reviseRating validation', () => {
    test('rejects vendor caller with 403', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.reviseRating(
        { params: { id: 'v-1' }, body: {}, user: { role: 'vendor' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects missing score components with 400', async () => {
      const res = mockRes();
      const next = jest.fn();
      await vendorController.reviseRating(
        { params: { id: 'v-1' }, body: { qualityScore: 80 }, user: { role: 'buyer' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('assertVendorOwnership early return and catch blocks boost', () => {
    test('assertVendorOwnership early returns 403 on unauthorized actions', async () => {
      const next = jest.fn();
      const existingVendor = { id: 'v-own-1', email: 'owner@vendor.com', buyerId: 'b-owner-1' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(existingVendor);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(existingVendor);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'b-different' });

      const unauthorizedBuyer = { role: 'buyer', email: 'unauth@buyer.com' };

      // deleteVendor
      const resDel = mockRes();
      await vendorController.deleteVendor({ params: { id: 'v-own-1' }, user: unauthorizedBuyer }, resDel, next);
      expect(resDel.status).toHaveBeenCalledWith(403);

      // generateOnboardingEmailPreview
      const resEmail = mockRes();
      await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-own-1' }, user: unauthorizedBuyer }, resEmail, next);
      expect(resEmail.status).toHaveBeenCalledWith(403);

      // updateSubscription
      const resSub = mockRes();
      await vendorController.updateSubscription({ params: { id: 'v-own-1' }, body: { plan: 'premium' }, user: unauthorizedBuyer }, resSub, next);
      expect(resSub.status).toHaveBeenCalledWith(403);

      // createSubscriptionPaymentLink
      const resPayLink = mockRes();
      await vendorController.createSubscriptionPaymentLink({ params: { id: 'v-own-1' }, body: { plan: 'connect' }, user: unauthorizedBuyer }, resPayLink, next);
      expect(resPayLink.status).toHaveBeenCalledWith(403);

      // getPaymentLinks
      const resLinks = mockRes();
      await vendorController.getPaymentLinks({ params: { id: 'v-own-1' }, user: unauthorizedBuyer }, resLinks, next);
      expect(resLinks.status).toHaveBeenCalledWith(403);

      // downloadInvoice
      const resInv = mockRes();
      await vendorController.downloadInvoice({ params: { id: 'v-own-1', linkId: 'l-1' }, user: unauthorizedBuyer }, resInv, next);
      expect(resInv.status).toHaveBeenCalledWith(403);

      // updateCategories
      const resCat = mockRes();
      await vendorController.updateCategories({ params: { id: 'v-own-1' }, body: {}, user: unauthorizedBuyer }, resCat, next);
      expect(resCat.status).toHaveBeenCalledWith(403);
    });

    test('updateVendor, deleteVendor, and updateCategories catch blocks forward errors to next', async () => {
      const next = jest.fn();

      // updateVendor error
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockRejectedValueOnce(new Error('Update DB crash'));
      await vendorController.updateVendor({ params: { id: 'v-crash' }, body: {}, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // deleteVendor error
      jest.spyOn(storeService, 'getVendorById').mockImplementationOnce(() => {
        throw new Error('Delete crash');
      });
      await vendorController.deleteVendor({ params: { id: 'v-crash' }, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // updateCategories error
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockRejectedValueOnce(new Error('Taxonomy crash'));
      await vendorController.updateCategories({ params: { id: 'v-crash' }, body: {}, user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getSubscriptionPricing 500 error catch block', () => {
      const errRes = {
        json: jest.fn().mockImplementationOnce(() => {
          throw new Error('JSON serialisation fail');
        }).mockReturnValue({}),
        status: jest.fn().mockReturnThis(),
      };
      vendorController.getSubscriptionPricing({}, errRes);
      expect(errRes.status).toHaveBeenCalledWith(500);
    });

    test('bulkImportVendors with valid buyer account sets buyer attribution', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'b-authed-org',
        organizationName: 'Authed Corp',
      });
      const resVendor = { id: 'v-bulk-1', name: 'Bulk 1' };
      jest.spyOn(storeService, 'bulkAddVendors').mockResolvedValue({
        results: [
          { rowNumber: 1, vendor: { ...resVendor, id: 'v-bulk-skipped', onboardingEmailStatus: 'skipped' }, onboardingEmailStatus: 'skipped', hasIssues: false },
          { rowNumber: 2, vendor: { ...resVendor, id: 'v-bulk-failed', onboardingEmailStatus: 'failed' }, onboardingEmailStatus: 'failed', hasIssues: false },
        ],
        importedCount: 2,
        duplicateCount: 0,
        missingEmailCount: 0,
      });
      jest.spyOn(domainQueries, 'createBulkImportSessionInDB').mockResolvedValue({ id: 'sess-100' });
      jest.spyOn(domainQueries, 'incrementBulkImportSessionInDB').mockResolvedValue(true);

      await vendorController.bulkImportVendors(
        {
          user: { role: 'buyer', email: 'buyer@authed.com' },
          body: { vendors: [
            { name: 'Bulk Vendor', email: 'bulk1@vendor.com', majorCategory: 'Tools' },
            { name: 'Bulk Vendor Two', email: 'bulk2@vendor.com', majorCategory: 'Tools' },
          ] },
        },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            sessionId: expect.any(String),
            onboardingFailed: 1,
            onboardingSkipped: 1,
          }),
        })
      );
      // The import is attributed to the signed-in user, not to a built-in mailbox.
      expect(storeService.bulkAddVendors).toHaveBeenCalledWith(expect.any(Array), 'buyer@authed.com');
    });

    test('isHydratedFromDB surfaces persisted source in getVendors and getVendorById', async () => {
      const next = jest.fn();
      storeService.isHydratedFromDB = true;

      // getVendors with page
      jest.spyOn(storeService, 'getVendors').mockReturnValue([{ id: 'v-p1', name: 'V1' }]);
      const resPage = mockRes();
      await vendorController.getVendors({ query: { page: '1', pageSize: '10' } }, resPage, next);
      expect(resPage.json).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'persisted' })
      );

      // getVendors without page
      const resAll = mockRes();
      await vendorController.getVendors({ query: {} }, resAll, next);
      expect(resAll.json).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'persisted' })
      );

      // getVendorById
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue({ id: 'v-p1', name: 'V1' });
      const resById = mockRes();
      await vendorController.getVendorById({ params: { id: 'v-p1' }, user: { role: 'admin' }, query: {} }, resById, next);
      expect(resById.json).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'persisted' })
      );

      storeService.isHydratedFromDB = false;
    });

    test('getVendors fails closed and logs when the persisted vendor page query throws', async () => {
      const next = jest.fn();
      const res = mockRes();
      const pool = require('../src/db/pool');
      const { logger } = require('../src/services/loggerService');
      const logError = jest.spyOn(logger, 'error').mockImplementation(() => {});
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      storeService.vendors = [
        { id: 'v-b1', name: 'Alpha Fasteners', email: 'alpha@fast.com', majorCategory: 'Industrial', buyerId: 'b-99' },
        { id: 'v-b2', name: 'Beta Tools', email: 'beta@tools.com', majorCategory: 'Tools', buyerId: 'b-other' },
      ];
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockRejectedValue(new Error('D1 DB is overloaded'));

      await vendorController.getVendors(
        { query: { page: '1', pageSize: '10', buyerId: 'buyer@example.com', search: 'alpha' } },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: 'PERSISTENCE_UNAVAILABLE',
          retryable: true,
        })
      );
      expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'in_memory_fallback' }));
      expect(logError).toHaveBeenCalledWith(
        'Persisted vendor directory page query failed',
        expect.objectContaining({ operation: 'vendor-directory-page-read', hasBuyerScope: true }),
        'VENDOR_CONTROLLER'
      );
      expect(logError.mock.calls[0][1]).not.toHaveProperty('buyerId');
      expect(next).not.toHaveBeenCalled();
    });

    test('recordVendorHeartbeat rejects vendor sessions without an email identity', async () => {
      const next = jest.fn();
      const res = mockRes();
      const recordHeartbeat = jest.spyOn(vendorPresenceService, 'recordHeartbeat').mockReturnValue({ recorded: true });

      await vendorController.recordVendorHeartbeat(
        { body: {}, user: { role: 'vendor', sub: 'usr-sub-only' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(recordHeartbeat).not.toHaveBeenCalled();
    });

    test('covers updateVendor, updateSubscription, and catch branches in vendorController', async () => {
      const next = jest.fn();

      // updateVendor 404
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const resUp404 = mockRes();
      await vendorController.updateVendor({ params: { id: 'missing-v' }, body: {} }, resUp404, next);
      expect(resUp404.status).toHaveBeenCalledWith(404);

      // generateOnboardingEmailPreview catch
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Onboarding email error');
      });
      await vendorController.generateOnboardingEmailPreview(
        { params: { id: 'v1' }, user: { role: 'admin' } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // updateSubscription 404
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      const resSub404 = mockRes();
      await vendorController.updateSubscription(
        { params: { id: 'missing-v' }, user: { role: 'admin' }, body: { plan: 'premium' } },
        resSub404,
        next
      );
      expect(resSub404.status).toHaveBeenCalledWith(404);

      // updateSubscription catch
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Sub update error');
      });
      await vendorController.updateSubscription(
        { params: { id: 'v1' }, user: { role: 'admin' }, body: {} },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // downloadInvoice catch
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Download invoice error');
      });
      await vendorController.downloadInvoice({ params: { id: 'v1', linkId: 'l1' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // updateCategories 404
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const resCat404 = mockRes();
      await vendorController.updateCategories({ params: { id: 'missing-v' }, body: {} }, resCat404, next);
      expect(resCat404.status).toHaveBeenCalledWith(404);

      // bulkImportVendors with existing sessionId
      const existingSessionId = '00000000-0000-4000-8000-000000000005';
      jest.spyOn(domainQueries, 'getBulkImportSessionFromDB').mockResolvedValue({ id: existingSessionId });
      jest.spyOn(domainQueries, 'incrementBulkImportSessionInDB').mockResolvedValue(true);
      jest.spyOn(storeService, 'bulkAddVendors').mockResolvedValue({
        results: [{ rowNumber: 1, vendor: { id: 'v1' }, hasIssues: false }],
        importedCount: 1,
        duplicateCount: 0,
        missingEmailCount: 0,
      });
      const resSess = mockRes();
      await vendorController.bulkImportVendors(
        {
          user: { role: 'admin' },
          body: { sessionId: existingSessionId, vendors: [{ name: 'V', email: 'v@v.com', majorCategory: 'Tools' }] },
        },
        resSess,
        next
      );
      expect(resSess.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ sessionId: existingSessionId }) })
      );

      // Branch coverage for id === 'me' in updateSubscription, createSubscriptionPaymentLink, getPaymentLinks, downloadInvoice
      const meVendor = { id: 'v-me', email: 'me@vendor.com', phone: '+919988776655' };
      jest.spyOn(storeService, 'getVendorById').mockImplementation((queryId) => {
        if (queryId === 'me@vendor.com') return meVendor;
        return null;
      });
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ ...meVendor, subscriptionPlan: 'premium' });
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue([]);
      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue(null);

      const resSubMe = mockRes();
      await vendorController.updateSubscription(
        { params: { id: 'me' }, body: { plan: 'premium' }, user: { email: 'me@vendor.com', role: 'vendor' } },
        resSubMe,
        next
      );
      expect(resSubMe.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const resPayMe = mockRes();
      await vendorController.createSubscriptionPaymentLink(
        { params: { id: 'me' }, body: { plan: 'connect' }, user: { email: 'me@vendor.com', role: 'vendor' } },
        resPayMe,
        next
      );
      // Zoho payment link created or attempted
      expect(resPayMe.json).toHaveBeenCalled();

      const resLinksMe = mockRes();
      await vendorController.getPaymentLinks(
        { params: { id: 'me' }, user: { email: 'me@vendor.com', role: 'vendor' } },
        resLinksMe,
        next
      );
      expect(resLinksMe.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const resInvMe = mockRes();
      await vendorController.downloadInvoice(
        { params: { id: 'me', linkId: 'missing-link' }, user: { email: 'me@vendor.com', role: 'vendor' } },
        resInvMe,
        next
      );
      expect(resInvMe.status).toHaveBeenCalledWith(404);

      // Bulk delete vendor when deleteVendorDurably returns false
      const nonDeletable = { id: 'v-nodelete', email: 'admin@qua.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(nonDeletable);
      jest.spyOn(storeService, 'deleteVendorDurably').mockResolvedValue(false);
      const resBulkDel = mockRes();
      await vendorController.bulkDeleteVendors(
        { body: { vendorIds: ['v-nodelete'] }, user: { role: 'admin', email: 'admin@qua.com' } },
        resBulkDel,
        next
      );
      expect(resBulkDel.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, skippedIds: ['v-nodelete'] })
      );

      // Public vendor with 11+ digits un-prefixed phone to exercise maskPhoneNumber slice branch
      const phoneVendor = {
        id: 'v-phone-long',
        name: 'Phone Vendor',
        email: 'phone@vendor.com',
        phone: '123456789012',
      };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(phoneVendor);
      const resPubPhone = mockRes();
      await vendorController.getPublicVendorById(
        { params: { id: 'v-phone-long' } },
        resPubPhone,
        next
      );
      expect(resPubPhone.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ phone: expect.any(String) }) })
      );

      // Public vendor when sanitizePublicVendor returns null
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue('invalid-vendor-object');
      const resPubInvalid = mockRes();
      await vendorController.getPublicVendorById(
        { params: { id: 'v-invalid' } },
        resPubInvalid,
        next
      );
      expect(resPubInvalid.status).toHaveBeenCalledWith(404);
    });
  });
});

