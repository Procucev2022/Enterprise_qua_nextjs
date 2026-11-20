const bootstrapController = require('../src/controllers/bootstrapController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const vendorController = require('../src/controllers/vendorController');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');
const rootResolvers = require('../src/graphql/resolvers');
const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const pool = require('../src/db/pool');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Vendor Directory, Buyer Isolation & Full Unit Coverage Suite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('bootstrapController.js', () => {
    test('getBootstrap with buyer user role finding account', async () => {
      const req = {
        user: { role: 'buyer', email: 'buyer@enterprise.com', sub: 'u-123' },
        query: { refresh: 'true' },
      };
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-99' });
      jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue(true);
      jest.spyOn(storeService, 'getBootstrapData').mockReturnValue({ rfqs: [], vendors: [] });

      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap with buyer user role falling back to sub/email', async () => {
      const req = {
        user: { role: 'buyer', email: 'nobuyer@enterprise.com', sub: 'u-sub-456' },
      };
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue(null);
      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap with query buyerId', async () => {
      const req = {
        user: null,
        query: { buyerId: 'ba-query-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await bootstrapController.getBootstrap(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBootstrap error handling', async () => {
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getBootstrapData').mockImplementation(() => {
        throw new Error('Bootstrap crash');
      });

      await bootstrapController.getBootstrap(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('buyerAccountController.js', () => {
    test('role gating: unauthenticated, forbidden, and allowed roles', async () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      buyerAccountController.createBuyerAccount({ user: null }, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      buyerAccountController.createBuyerAccount({ user: { role: 'vendor' } }, res2, next1);
      expect(res2.status).toHaveBeenCalledWith(403);

      jest.spyOn(storeService, 'addBuyerAccountDurably').mockResolvedValue({ id: 'ba-admin', organizationName: 'Admin Org' });
      const res3 = mockRes();
      await buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Admin Org', corporateEmail: 'admin@org.com' } },
        res3,
        next1
      );
      expect(res3.status).toHaveBeenCalledWith(201);
    });

    test('getBuyerAccounts and getActiveAccount', async () => {
      const domainQueries = require('../src/db/domainQueries');
      const next = jest.fn();

      // Without configured storage the listing is refused with the persistence error. It is not answered from memory.
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const unavailableRes = mockRes();
      await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' } }, unavailableRes, next);
      expect(unavailableRes.status).toHaveBeenCalledWith(503);
      expect(unavailableRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        code: 'PERSISTENCE_UNAVAILABLE',
        retryable: true,
      }));

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValueOnce({ accounts: [{ id: 'ba-1' }], activeId: 'ba-1' });
      const res = mockRes();
      await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' } }, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [{ id: 'ba-1' }] }));

      // A failed query is marked as a retryable 503 and forwarded to the error handler.
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockRejectedValueOnce(new Error('query failed'));
      await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' } }, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'query failed', status: 503, retryable: true }));
    });

    test('getActiveAccount resolver outcomes and error', async () => {
      const buyerAccountResolver = require('../src/services/buyerAccountResolver');
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockResolvedValueOnce({
        ok: true,
        account: { id: 'ba-1', orgName: 'Test Org' },
      });
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockResolvedValueOnce({
        ok: false,
        status: 404,
        error: 'Not found',
      });
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(404);

      jest.spyOn(buyerAccountResolver, 'resolveActiveBuyerAccount').mockRejectedValueOnce(new Error('crash'));
      await buyerAccountController.getActiveAccount({ user: { email: 'test@buyer.com' } }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('createBuyerAccount missing fields, success, and error', async () => {
      const res = mockRes();
      const next = jest.fn();

      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { organizationName: '' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      jest.spyOn(storeService, 'addBuyerAccountDurably').mockResolvedValue({ id: 'ba-created', organizationName: 'Acme Corp' });
      await buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Acme Corp', corporateEmail: 'acme@test.com' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      jest.spyOn(storeService, 'addBuyerAccountDurably').mockRejectedValueOnce(new Error('store fail'));
      await buyerAccountController.createBuyerAccount(
        { user: { role: 'admin' }, body: { organizationName: 'Acme', corporateEmail: 'a@a.com' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();

      // Merges into existing buyer mirror when an account already exists for corporateEmail
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'u-buyer-existing',
        corporateEmail: 'merge@test.com',
        organizationId: 'org-merge-1',
      });
      const mergeSpy = jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce({
        id: 'u-buyer-existing',
        organizationName: 'Merge Corp',
        gstin: '27AAAAA0000A1Z5',
        street: 'Plot 88',
      });
      const mergeRes = mockRes();
      await buyerAccountController.createBuyerAccount(
        {
          user: { role: 'buyer', sub: 'u-buyer-existing', email: 'merge@test.com' },
          body: {
            organizationName: 'Merge Corp',
            corporateEmail: 'merge@test.com',
            gstin: '27AAAAA0000A1Z5',
            street: 'Plot 88',
          },
        },
        mergeRes,
        next
      );
      expect(mergeSpy).toHaveBeenCalledWith('u-buyer-existing', expect.objectContaining({
        gstin: '27AAAAA0000A1Z5',
        street: 'Plot 88',
        organizationId: 'org-merge-1',
      }));
      expect(mergeRes.status).toHaveBeenCalledWith(201);

      // Syncs statutory/address updates from updateBuyerAccount to canonical organization row when storage is configured
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      const domainQueries = require('../src/db/domainQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updatedBuyerPayload = {
        id: 'u-buyer-existing',
        organizationId: 'org-merge-1',
        corporateEmail: 'merge@test.com',
        organizationName: 'Veera Solutions Pvt Ltd',
        brandName: 'Veera Brand',
        contactPerson: 'Veera',
        contactDesignation: 'Director',
        gstin: '27AAACK3921P1Z9',
        pan: 'AAACK3921P',
        street: '302 Sharada, AECS Layout',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560037',
        country: 'India',
      };
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(updatedBuyerPayload);
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue(updatedBuyerPayload);
      const syncOrgSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValueOnce({ updated: true });
      const syncRes = mockRes();
      await buyerAccountController.updateBuyerAccount(
        {
          user: { role: 'admin', sub: 'u-admin', email: 'admin@procucev.com' },
          params: { id: 'u-buyer-existing' },
          body: {
            organizationName: 'Veera Solutions Pvt Ltd',
            brandName: 'Veera Brand',
            contactPerson: 'Veera',
            contactDesignation: 'Director',
            gstin: '27AAACK3921P1Z9',
            pan: 'AAACK3921P',
            street: '302 Sharada, AECS Layout',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560037',
            country: 'India',
          },
        },
        syncRes,
        next
      );
      expect(syncOrgSpy).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: 'org-merge-1',
        patch: expect.objectContaining({
          companyName: 'Veera Solutions Pvt Ltd',
          brandName: 'Veera Brand',
          contactName: 'Veera',
          contactDesignation: 'Director',
          gstNumber: '27AAACK3921P1Z9',
          panNumber: 'AAACK3921P',
          street: '302 Sharada, AECS Layout',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          country: 'India',
        }),
      }));

      // Logs warning fail-open when organization sync throws
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValueOnce(new Error('org sync failed'));
      const warnRes = mockRes();
      await buyerAccountController.updateBuyerAccount(
        {
          user: { role: 'admin', sub: 'u-admin', email: 'admin@procucev.com' },
          params: { id: 'u-buyer-existing' },
          body: { city: 'Pune' },
        },
        warnRes,
        next
      );
      expect(warnRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Skips organization sync cleanly when account has no syncable statutory or address fields
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce({
        id: 'u-buyer-existing',
        organizationId: 'org-merge-1',
      });
      const noOpRes = mockRes();
      await buyerAccountController.updateBuyerAccount(
        {
          user: { role: 'admin', sub: 'u-admin', email: 'admin@procucev.com' },
          params: { id: 'u-buyer-existing' },
          body: {},
        },
        noOpRes,
        next
      );
      expect(noOpRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('updateBuyerAccount not found, success, and error', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await buyerAccountController.updateBuyerAccount(
        { user: { role: 'admin' }, params: { id: 'non-existent' }, body: { organizationName: 'New' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const accounts = storeService.getBuyerAccounts();
      if (accounts.length > 0) {
        jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValueOnce(null);
        await buyerAccountController.updateBuyerAccount(
          { user: { role: 'admin' }, params: { id: accounts[0].id }, body: { organizationName: 'Missing persisted row' } },
          res,
          next
        );
        expect(res.status).toHaveBeenCalledWith(404);

        jest.spyOn(storeService, 'updateBuyerAccountDurably').mockResolvedValue({ ...accounts[0], organizationName: 'Updated Name' });
        await buyerAccountController.updateBuyerAccount(
          { user: { role: 'admin' }, params: { id: accounts[0].id }, body: { organizationName: 'Updated Name' } },
          res,
          next
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockRejectedValueOnce(new Error('err'));
      const errorTarget = storeService.addBuyerAccount({ organizationName: 'Update Error', corporateEmail: 'update-error@test.com' });
      await buyerAccountController.updateBuyerAccount(
        { user: { role: 'admin' }, params: { id: errorTarget.id }, body: {} },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('deleteBuyerAccount not found, success, and error', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await buyerAccountController.deleteBuyerAccount(
        { user: { role: 'admin' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const created = storeService.addBuyerAccount({ organizationName: 'To Del', corporateEmail: 'todel@test.com' });
      await buyerAccountController.deleteBuyerAccount(
        { user: { role: 'admin' }, params: { id: created.id } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'deleteBuyerAccountDurably').mockRejectedValueOnce(new Error('err'));
      const errorTarget = storeService.addBuyerAccount({ organizationName: 'Delete Error', corporateEmail: 'delete-error@test.com' });
      await buyerAccountController.deleteBuyerAccount(
        { user: { role: 'admin' }, params: { id: errorTarget.id } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('setActiveAccount not found, success, and error', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await buyerAccountController.setActiveAccount(
        { user: { role: 'admin' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      const accounts = storeService.getBuyerAccounts();
      if (accounts.length > 0) {
        await buyerAccountController.setActiveAccount(
          { user: { role: 'admin' }, params: { id: accounts[0].id } },
          res,
          next
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      jest.spyOn(storeService, 'alignActiveBuyerAccountDurably').mockRejectedValueOnce(new Error('err'));
      const errorTarget = storeService.addBuyerAccount({ organizationName: 'Active Error', corporateEmail: 'active-error@test.com' });
      await buyerAccountController.setActiveAccount(
        { user: { role: 'admin' }, params: { id: errorTarget.id } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('createSubscriptionPaymentLink validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ mobile: '9123456780' });

      // Account not found and user has no email
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: '' }, params: { id: 'none' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      // Account without corporateEmail
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-no-email', corporateEmail: '' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'test@b.com' }, params: { id: 'ba-no-email' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // Invalid plan
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-1', corporateEmail: 'b@b.com' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'invalid_plan' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // User without prior account record created on the fly with orgName
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce(null);
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockResolvedValueOnce({
        id: 'ba-new',
        corporateEmail: 'neworgbuyer@test.com',
        mobileNumber: '',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ mobile: '9123456780' });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        zohoPaymentLinkId: 'zpl-new',
        paymentUrl: 'https://payments.zoho.in/pay/new',
        status: 'CREATED',
        rawResponse: {},
      });
      await buyerAccountController.createSubscriptionPaymentLink(
        {
          user: { role: 'buyer', email: 'neworgbuyer@test.com', orgName: 'New Org Ltd' },
          params: { id: 'ba-new' },
          body: { plan: 'version_2' },
        },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Successful payment link creation for version_3
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({
        id: 'ba-1',
        corporateEmail: 'b@b.com',
        mobileNumber: '9876543210',
      });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        zohoPaymentLinkId: 'zpl-123',
        paymentUrl: 'https://payments.zoho.in/pay/123',
        status: 'CREATED',
        rawResponse: {},
      });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'version_3' } },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Exception handling
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockRejectedValueOnce(new Error('Zoho down'));
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'ba-1' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(502);

      // No mobileNumber on the domain record and no phone in the identity record either
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValueOnce({ id: 'ba-2', corporateEmail: 'nomobile@b.com' });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ mobile: '' });
      await buyerAccountController.createSubscriptionPaymentLink(
        { user: { role: 'buyer', email: 'nomobile@b.com' }, params: { id: 'ba-2' }, body: { plan: 'version_1' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('ingestHistoricalData validation, processing, and error', async () => {
      const res = mockRes();
      const next = jest.fn();

      await buyerAccountController.ingestHistoricalData(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { period: '' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValueOnce({
        id: 'ba-hist-1',
        corporateEmail: 'b@b.com',
        organizationName: 'Buyer Hist Org',
      });
      await buyerAccountController.ingestHistoricalData(
        {
          user: { role: 'buyer', email: 'b@b.com' },
          body: {
            period: 'FY2025-Q1',
            vendorRecords: [{ name: 'Test Supp', email: 's@s.com', majorCategory: 'Mechanical' }],
          },
        },
        res,
        next
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'ba-hist-2',
        corporateEmail: 'b@b.com',
      });
      await buyerAccountController.ingestHistoricalData(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { period: 'FY2025-Q1', vendorRecords: [] } },
        res,
        next
      );

      jest.spyOn(storeService, 'processHistoricalPurchaseData').mockImplementation(() => {
        throw new Error('err');
      });
      await buyerAccountController.ingestHistoricalData(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { period: 'FY2025-Q1' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('aiCrossMatch all category keywords and conditions for 100% branch coverage', () => {
      const res = mockRes();
      const next = jest.fn();

      const vendors = [
        { id: 'v-it-all', vendorCode: 'V-IT-ALL', companyName: 'Google Microsoft Azure Partner', email: 'itall@test.com' },
        { id: 'v-it-subs', vendorCode: 'V-IT-SUBS', companyName: '365 Subscription Renewal Provider', email: 'subs@test.com' },
        { id: 'v-it-data', vendorCode: 'V-IT-DATA', companyName: 'BigQuery Data Analytics Ltd', email: 'data@test.com' },
        { id: 'v-it-infra', vendorCode: 'V-IT-INFRA', companyName: 'Datacenter Server Infrastructure', email: 'infra@test.com' },
        { id: 'v-it-plain-saas', vendorCode: 'V-IT-SAAS', companyName: 'Plain SaaS Provider', email: 'saas@test.com' },
        { id: 'v-mech-valves', vendorCode: 'V-MECH-V', companyName: 'Globe Gate Valves & Fittings', email: 'valves@test.com' },
        { id: 'v-mech-pumps', vendorCode: 'V-MECH-P', companyName: 'Slurry Pumps & Compressors', email: 'pumps@test.com' },
        { id: 'v-mech-motors', vendorCode: 'V-MECH-M', companyName: 'Electric Motor & Hose Spares', email: 'motors@test.com' },
        { id: 'v-elec-panels', vendorCode: 'V-ELEC-P', companyName: 'Switchgear Panels & Cables', email: 'elec1@test.com' },
        { id: 'v-elec-mccb', vendorCode: 'V-ELEC-M', companyName: 'MCCB Breakers Ltd', email: 'elec2@test.com' },
        { id: 'v-civil-peb', vendorCode: 'V-CIVIL-P', companyName: 'PEB Structure & Civil Construction', email: 'civil1@test.com' },
        { id: 'v-civil-tmt', vendorCode: 'V-CIVIL-T', companyName: 'TMT Steel Bars & Roofing', email: 'civil2@test.com' },
        { id: 'v-gen-fallback', vendorCode: 'V-GEN-F', companyName: 'Custom Fasteners and Consumables', email: 'gen@test.com' },
        { id: 'v-unmatched', vendorCode: 'V-UNMATCHED', companyName: 'Zero PO Vendor', email: 'none@test.com' },
      ];

      const poLineItems = [
        { vendorIdentifier: 'Google Microsoft', itemName: 'gcp compute credits & cloud storage', totalSpend: 25000000 },
        { vendorIdentifier: 'V-IT-SUBS', itemName: '365 workspace teams windows server renewal subscription license', totalSpend: 500000 },
        { vendorIdentifier: 'BigQuery Data', itemName: 'bigquery power bi analytics data platform', totalSpend: 300000 },
        { vendorIdentifier: 'Datacenter Server', itemName: 'datacenter server infrastructure', totalSpend: 400000 },
        { vendorIdentifier: 'Plain SaaS', itemName: 'saas software', totalSpend: 150000 }, // triggers secondSetMinors.length === 0 -> Enterprise Software & Licenses
        { vendorIdentifier: 'V-MECH-V', itemName: 'globe valve gate valve', totalSpend: 200000 },
        { vendorIdentifier: 'Slurry Pumps', itemName: 'pump compressor', totalSpend: 180000 },
        { vendorIdentifier: 'V-MECH-M', itemName: 'hose motor', totalSpend: 95000 },
        { vendorIdentifier: 'Switchgear Panels', itemName: 'switchgear panel cable', totalSpend: 45000 },
        { vendorIdentifier: 'V-ELEC-M', itemName: 'breaker mccb', totalSpend: 30000 },
        { vendorIdentifier: 'PEB Structure', itemName: 'peb civil', totalSpend: 80000 },
        { vendorIdentifier: 'V-CIVIL-T', itemName: 'tmt steel', totalSpend: 75000 },
        { vendorIdentifier: 'Custom Fasteners', itemName: 'bolts and tools', totalSpend: 1200 },
      ];

      buyerAccountController.aiCrossMatch(
        { user: { role: 'buyer' }, body: { vendors, poLineItems } },
        res,
        next
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalMatched: 13,
          totalUnmatched: 1,
        })
      );
    });

    test('createBuyerAccount missing email vs missing organizationName', () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { organizationName: 'Name Only' } },
        res1,
        next1
      );
      expect(res1.status).toHaveBeenCalledWith(400);

      const res2 = mockRes();
      buyerAccountController.createBuyerAccount(
        { user: { role: 'buyer' }, body: { corporateEmail: 'email@only.com' } },
        res2,
        next1
      );
      expect(res2.status).toHaveBeenCalledWith(400);
    });
  });

  describe('vendorController.js', () => {
    test('assertVendorOwnership and update/delete branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      const existingVendor = {
        id: 'v-test-ownership-1',
        email: 'vendor-owner@test.com',
        buyerId: 'ba-buyer-1',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(existingVendor);

      // No user on existing vendor
      await vendorController.updateVendor({ user: null, params: { id: existingVendor.id }, body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);

      // Vendor role editing own profile
      const resVendorSelf = mockRes();
      await vendorController.updateVendor(
        {
          user: { role: 'vendor', email: 'vendor-owner@test.com' },
          params: { id: existingVendor.id },
          body: { name: 'Self Name', rating: 5.0 },
        },
        resVendorSelf,
        next
      );
      expect(resVendorSelf.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Admin role is always allowed
      const resAdmin = mockRes();
      await vendorController.updateVendor(
        { user: { role: 'admin' }, params: { id: existingVendor.id }, body: { name: 'Admin Updated' } },
        resAdmin,
        next
      );
      expect(resAdmin.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer owning vendor via v-hist prefix
      const resBuyer = mockRes();
      const histVendor = { id: 'v-hist-123', email: 'hist@test.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(histVendor);
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: histVendor.id }, body: { name: 'Hist Updated' } },
        resBuyer,
        next
      );
      expect(resBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer owning vendor via the v-buyer-, v-hist- and vm- import prefixes
      for (const testId of ['v-buyer-1', 'v-hist-1', 'vm-1']) {
        const resB = mockRes();
        const vPrefix = { id: testId, email: `${testId}@test.com` };
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(vPrefix);
        await vendorController.updateVendor(
          { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: testId }, body: { name: 'Prefix Update' } },
          resB,
          next
        );
        expect(resB.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      // Buyer owning vendor via buyerAccountId or buyerEmail matching
      const resBuyerAccountMatch = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-match-ba',
        buyerAccountId: 'ba-buyer-1',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-buyer-1' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-match-ba' }, body: { name: 'Matched' } },
        resBuyerAccountMatch,
        next
      );
      expect(resBuyerAccountMatch.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const resBuyerEmailMatch = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-match-email',
        buyerEmail: 'b@b.com',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'b@b.com' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-match-email' }, body: { name: 'Matched Email' } },
        resBuyerEmailMatch,
        next
      );
      expect(resBuyerEmailMatch.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Buyer not owning vendor
      const resBuyerForbidden = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-other',
        buyerId: 'ba-other-org',
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockReturnValue({ id: 'ba-buyer-1' });
      await vendorController.updateVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v-other' }, body: { name: 'Other' } },
        resBuyerForbidden,
        next
      );
      expect(resBuyerForbidden.status).toHaveBeenCalledWith(403);

      // Deleting non-existent vendor with buyer pattern (idempotent delete)
      for (const delId of ['v-hist-999', 'v-buyer-999', 'vm-999', 'v-ingest-999', 'v-bulk-999']) {
        const resDelIdempotent = mockRes();
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
        await vendorController.deleteVendor(
          { user: { role: 'buyer', email: 'b@b.com' }, params: { id: delId } },
          resDelIdempotent,
          next
        );
        expect(resDelIdempotent.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      }

      // Deleting non-existent vendor with non-buyer pattern -> 404
      const resDel404 = mockRes();
      await vendorController.deleteVendor(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'some-random-id' } },
        resDel404,
        next
      );
      expect(resDel404.status).toHaveBeenCalledWith(404);

      // Deleting existing vendor successfully
      const resDelOk = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(existingVendor);
      await vendorController.deleteVendor(
        { user: { role: 'admin' }, params: { id: existingVendor.id } },
        resDelOk,
        next
      );
      expect(resDelOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('bulkDeleteVendors validation, authorization, and execution branches', async () => {
      const next = jest.fn();

      // 1. Missing targetIds -> 400
      const res400 = mockRes();
      await vendorController.bulkDeleteVendors({ user: { role: 'admin' }, body: {} }, res400, next);
      expect(res400.status).toHaveBeenCalledWith(400);

      // 2. Missing user -> 401
      const res401 = mockRes();
      await vendorController.bulkDeleteVendors({ user: null, body: { vendorIds: ['v1'] } }, res401, next);
      expect(res401.status).toHaveBeenCalledWith(401);

      // 3. User is buyer without account -> fallback to sub/email
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const resBuyerNoAccount = mockRes();
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      await vendorController.bulkDeleteVendors(
        { user: { role: 'buyer', email: 'b@b.com', sub: 'buyer-sub' }, body: { ids: ['v-hist-1', 'unmatched-id', ''] } },
        resBuyerNoAccount,
        next
      );
      expect(resBuyerNoAccount.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, deletedCount: 1, skippedIds: ['unmatched-id'] })
      );

      // 4. Buyer with account, existing vendor with buyerId, buyerAccountId, buyerEmail, or forbidden
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({ id: 'buyer-org-123' });
      const vBuyerId = { id: 'v-b1', buyerId: 'buyer-org-123' };
      const vBuyerAccountId = { id: 'v-b2', buyerAccountId: 'buyer-org-123' };
      const vBuyerEmail = { id: 'v-b3', buyerEmail: 'buyer-org-123' };
      const vForbidden = { id: 'v-other', buyerId: 'other-buyer-org' };

      jest.spyOn(storeService, 'deleteVendorDurably').mockResolvedValue(true);

      jest.spyOn(storeService, 'getVendorById').mockImplementation((id) => {
        if (id === 'v-b1') return vBuyerId;
        if (id === 'v-b2') return vBuyerAccountId;
        if (id === 'v-b3') return vBuyerEmail;
        if (id === 'v-other') return vForbidden;
        return null;
      });

      const resBuyerBulk = mockRes();
      await vendorController.bulkDeleteVendors(
        { user: { role: 'buyer', email: 'b@b.com' }, body: { vendorIds: ['v-b1', 'v-b2', 'v-b3', 'v-other'] } },
        resBuyerBulk,
        next
      );
      expect(resBuyerBulk.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, deletedCount: 3, skippedIds: ['v-other'] })
      );

      // 5. Vendor deleting own profile
      const vOwn = { id: 'v-self', email: 'vendor@test.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vOwn);
      const resVendorBulk = mockRes();
      await vendorController.bulkDeleteVendors(
        { user: { role: 'vendor', email: 'vendor@test.com' }, body: { vendorIds: ['v-self'] } },
        resVendorBulk,
        next
      );
      expect(resVendorBulk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, deletedCount: 1 }));

      // 6. Error handling -> next(err)
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Simulated database crash');
      });
      await vendorController.bulkDeleteVendors(
        { user: { role: 'admin' }, body: { vendorIds: ['v-err'] } },
        mockRes(),
        next
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));

      // 7. Batch storage path (pool.hasStorage() === true and multiple targetIds)
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      const getBatchSpy = jest.spyOn(domainQueries, 'getVendorsByIdsFromDB').mockResolvedValueOnce([
        { id: 'v-owned-1', buyerId: 'buyer-org-123' },
        { id: 'v-denied-1', buyerId: 'other-org' },
      ]);
      const deleteBatchDbSpy = jest.spyOn(domainQueries, 'deleteVendorsInDB').mockResolvedValueOnce(3);
      const resBatchStorage = mockRes();
      await vendorController.bulkDeleteVendors(
        {
          user: { role: 'buyer', email: 'b@b.com' },
          body: { vendorIds: ['v-owned-1', 'v-denied-1', 'vm-legacy-orphan', 'nonexistent'] },
        },
        resBatchStorage,
        next
      );
      expect(getBatchSpy).toHaveBeenCalledWith(['v-owned-1', 'v-denied-1', 'vm-legacy-orphan', 'nonexistent']);
      expect(deleteBatchDbSpy).toHaveBeenCalledWith(['v-owned-1', 'vm-legacy-orphan']);
      expect(resBatchStorage.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          deletedCount: 2,
          deletedIds: ['v-owned-1', 'vm-legacy-orphan'],
          skippedIds: ['v-denied-1', 'nonexistent'],
        })
      );

      // Admin with no matching delete targets skips DB deletion call
      getBatchSpy.mockResolvedValueOnce([]);
      const resAdminSkip = mockRes();
      await vendorController.bulkDeleteVendors(
        {
          user: { role: 'admin', email: 'admin@qua.com' },
          body: { vendorIds: ['unknown-1', 'unknown-2'] },
        },
        resAdminSkip,
        next
      );
      expect(resAdminSkip.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, deletedCount: 0, skippedIds: ['unknown-1', 'unknown-2'] })
      );

      // 8. Storage delete error in deleteVendorsDurably surfaces 503 via next(err)
      await expect(storeService.deleteVendorsDurably([])).resolves.toEqual([]);
      jest.spyOn(domainQueries, 'deleteVendorsInDB').mockRejectedValueOnce(new Error('D1 delete down'));
      await expect(storeService.deleteVendorsDurably(['v-err-1'], 'b@b.com')).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    test('reviseRating validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v1', name: 'Vendor 1' });

      // Vendor role cannot rate
      await vendorController.reviseRating(
        { user: { role: 'vendor' }, params: { id: 'v1' }, body: {} },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);

      // Missing scores
      const resMissing = mockRes();
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v1' }, body: { qualityScore: 90, costScore: 90 } },
        resMissing,
        next
      );
      expect(resMissing.status).toHaveBeenCalledWith(400);

      // Out of range score (> 100)
      const resRange = mockRes();
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'v1' }, body: { qualityScore: 150, costScore: 90, deliveryScore: 90 } },
        resRange,
        next
      );
      expect(resRange.status).toHaveBeenCalledWith(400);

      // Vendor not found in storeService
      const res404 = mockRes();
      jest.spyOn(storeService, 'reviseVendorRatingDurably').mockResolvedValueOnce(null);
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } },
        res404,
        next
      );
      expect(res404.status).toHaveBeenCalledWith(404);

      // Success
      const resOk = mockRes();
      jest.spyOn(storeService, 'reviseVendorRatingDurably').mockResolvedValueOnce({ id: 'v-revised', rating: 4.8 });
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 95, costScore: 90, deliveryScore: 92 } },
        resOk,
        next
      );
      expect(resOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Exception handling
      jest.spyOn(storeService, 'reviseVendorRatingDurably').mockImplementation(() => {
        throw new Error('crash');
      });
      await vendorController.reviseRating(
        { user: { role: 'buyer', email: 'buyer@test.com' }, params: { id: 'v1' }, body: { qualityScore: 95, costScore: 90, deliveryScore: 92 } },
        resOk,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('updateCategories and generateOnboardingEmailPreview validation and success flows', async () => {
      const res = mockRes();
      const next = jest.fn();

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v1',
        email: 'vendor@test.com',
        buyerId: 'buyer-1',
        tempPassword: 'temporary-pass',
      });

      // Non-owner updating categories -> 403
      await vendorController.updateCategories(
        { user: { role: 'vendor', email: 'other@vendor.com' }, params: { id: 'v1' }, body: {} },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);

      // Owner (admin) updating categories
      const resAdmin = mockRes();
      jest.spyOn(storeService, 'updateVendorCategories').mockReturnValueOnce({ id: 'v1', clientMappedCategories: ['Valves'] });
      await vendorController.updateCategories(
        { user: { role: 'admin' }, params: { id: 'v1' }, body: { clientMappedCategories: ['Valves'] } },
        resAdmin,
        next
      );
      expect(resAdmin.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // generateOnboardingEmailPreview: vendor role forbidden (403)
      const resEmailVendor = mockRes();
      await vendorController.generateOnboardingEmailPreview(
        { user: { role: 'vendor' }, params: { id: 'v1' } },
        resEmailVendor,
        next
      );
      expect(resEmailVendor.status).toHaveBeenCalledWith(403);

      // generateOnboardingEmailPreview: buyer success
      const resEmailBuyer = mockRes();
      await vendorController.generateOnboardingEmailPreview(
        { user: { role: 'buyer', sub: 'buyer-1' }, params: { id: 'v1' } },
        resEmailBuyer,
        next
      );
      expect(resEmailBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      const preview = resEmailBuyer.json.mock.calls[0][0].data;
      expect(preview).not.toHaveProperty('tempPassword');
      expect(preview.htmlBody).not.toContain('temporary-pass');
    });

    test('assertBulkImportRole branches', async () => {
      const res1 = mockRes();
      const next1 = jest.fn();
      vendorController.bulkImportVendors({ user: null }, res1, next1);
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      vendorController.bulkImportVendors({ user: { role: 'vendor' } }, res2, next1);
      expect(res2.status).toHaveBeenCalledWith(403);

      // A buyer role passes the gate but is 403'd separately if their session
      // has no linked buyer organisation to attribute the upload to.
      const res3 = mockRes();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      await vendorController.bulkImportVendors({ user: { role: 'buyer', email: 'nolink@b.com' } }, res3, next1);
      expect(res3.status).toHaveBeenCalledWith(403);

      const res4 = mockRes();
      vendorController.bulkImportVendors(
        { user: { role: 'category_manager' }, body: { vendors: [] } },
        res4,
        next1
      );
      expect(res4.status).not.toHaveBeenCalledWith(403);
    });

    test('getVendors and getVendorById with buyer scoping and error branches', async () => {
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getVendors({ user: { role: 'buyer', email: 'b@b.com' }, query: {} }, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      await vendorController.getVendorById(
        { user: { role: 'buyer', email: 'b@b.com' }, params: { id: 'non-existent' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(404);

      jest.spyOn(storeService, 'getVendors').mockImplementation(() => {
        throw new Error('fail');
      });
      await vendorController.getVendors({ query: {} }, res, next);
      expect(next).toHaveBeenCalled();

      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('fail');
      });
      await vendorController.getVendorById({ params: { id: 'v1' } }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('getVendors: explicit buyerId query param, search filtering, and pagination clamping', async () => {
      const next = jest.fn();

      storeService.addVendor({ name: 'Paginated Acme Co', email: 'paginated-acme@example.com', majorCategory: 'Fasteners' });
      storeService.addVendor({ name: 'Paginated Zenith Co', email: 'paginated-zenith@example.com', majorCategory: 'Cables' });

      // Non-buyer role reading an explicit ?buyerId= query param.
      const res1 = mockRes();
      await vendorController.getVendors({ user: { role: 'admin' }, query: { buyerId: 'some-buyer-id' } }, res1, next);
      expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Search narrows to matching rows only.
      const res2 = mockRes();
      await vendorController.getVendors({ query: { search: 'paginated-zenith' } }, res2, next);
      const searchPayload = res2.json.mock.calls[0][0];
      expect(searchPayload.data.some((v) => v.email === 'paginated-zenith@example.com')).toBe(true);
      expect(searchPayload.data.some((v) => v.email === 'paginated-acme@example.com')).toBe(false);

      // page=1 with an out-of-range/invalid pageSize clamps to the default,
      // and requesting more than MAX_VENDOR_PAGE_SIZE clamps to the cap.
      const res3 = mockRes();
      await vendorController.getVendors({ query: { page: '1', pageSize: 'not-a-number' } }, res3, next);
      const p1 = res3.json.mock.calls[0][0].pagination;
      expect(p1).toMatchObject({ page: 1, pageSize: 50 });

      const res4 = mockRes();
      await vendorController.getVendors({ query: { page: '0', pageSize: '999999' } }, res4, next);
      const p2 = res4.json.mock.calls[0][0].pagination;
      expect(p2).toMatchObject({ page: 1, pageSize: 200 });

      // A page beyond the last page returns an empty slice, not an error.
      const res5 = mockRes();
      await vendorController.getVendors({ query: { page: '999999', pageSize: '10' } }, res5, next);
      expect(res5.json.mock.calls[0][0].data).toEqual([]);
    });

    test('getVendors: buyerId=all with a configured pool answers straight from Postgres (bypassing the in-memory resync)', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-sql-1', name: 'SQL Path Vendor', email: 'sql-path@example.com' }],
        total: 12345,
      });
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors');

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '3', pageSize: '25', search: 'sql' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith({ limit: 25, offset: 50, search: 'sql', email: '', category: '', scopedBuyerId: '' });
        // The expensive full-table resync path must not run at all for this case.
        expect(getVendorsSpy).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
          success: true,
          source: 'persisted',
          data: [{ id: 'v-sql-1', name: 'SQL Path Vendor', email: 'sql-path@example.com' }],
          pagination: { page: 3, pageSize: 25, total: 12345, totalPages: Math.ceil(12345 / 25) },
        });
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
        getVendorsSpy.mockRestore();
      }
    });

    test('getVendors: an en/em dash category is queried with the stored plain hyphen', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      try {
        for (const dash of ['–', '—']) {
          pageSpy.mockClear();
          const res = mockRes();
          await vendorController.getVendors(
            { query: { buyerId: 'all', page: '1', pageSize: '20', category: `Others ${dash} New Product` } },
            res,
            next
          );
          expect(pageSpy).toHaveBeenCalledWith(expect.objectContaining({ category: 'Others - New Product' }));
          expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        }
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: buyerId=all falls back to the in-memory path when no DB pool is configured', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { buyerId: 'all', page: '1', pageSize: '10' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      } finally {
        pool.pool = originalPool;
      }
    });

    test('getVendors: a buyer-scoped paginated request also answers straight from Postgres, scoped to public-or-mine', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-scoped-1', name: 'Scoped Vendor' }],
        total: 42,
      });
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors');
      const buyerAccountSpy = jest
        .spyOn(storeService, 'getBuyerAccountByEmail')
        .mockResolvedValue({ id: 'ba-scoped-1' });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { user: { role: 'buyer', email: 'scoped-buyer@example.com' }, query: { page: '1', pageSize: '10' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 10, offset: 0, scopedBuyerId: expect.any(String) })
        );
        const call = pageSpy.mock.calls[0][0];
        expect(call.scopedBuyerId).not.toBe('');
        // Buyer-scoped pagination must not trigger the whole-table resync either —
        // the real fix for 600k-row scale, not just the 'all' listing.
        expect(getVendorsSpy).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, source: 'persisted', data: [{ id: 'v-scoped-1', name: 'Scoped Vendor' }] })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
        getVendorsSpy.mockRestore();
        buyerAccountSpy.mockRestore();
      }
    });

    test('getVendors: a category query param is passed through to the SQL fast path', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '1', pageSize: '10', category: 'Fasteners' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'Fasteners' })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: an email query param is passed through to the SQL fast path', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '1', pageSize: '10', email: 'test@vendor.com' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'test@vendor.com' })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: the in-memory fallback also applies the category filter when no pool is configured', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors').mockResolvedValue([
        { id: 'v-1', name: 'A', majorCategory: 'Fasteners' },
        { id: 'v-2', name: 'B', majorCategory: 'Electrical' },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { category: 'Fasteners' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, data: [{ id: 'v-1', name: 'A', majorCategory: 'Fasteners' }] })
        );
      } finally {
        pool.pool = originalPool;
        getVendorsSpy.mockRestore();
      }
    });

    test('getVendors: state and city query params are passed through to the SQL fast path', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [], total: 0 });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { query: { buyerId: 'all', page: '1', pageSize: '10', state: 'Maharashtra', city: 'Pune' } },
          res,
          next
        );

        expect(pageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ state: 'Maharashtra', city: 'Pune' })
        );
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: the in-memory fallback also applies state and city filters when no pool is configured', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors').mockResolvedValue([
        { id: 'v-1', name: 'A', state: 'Maharashtra', city: 'Pune' },
        { id: 'v-2', name: 'B', state: 'Gujarat', city: 'Surat' },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { state: 'Maharashtra', city: 'Pune' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, data: [{ id: 'v-1', name: 'A', state: 'Maharashtra', city: 'Pune' }] })
        );
      } finally {
        pool.pool = originalPool;
        getVendorsSpy.mockRestore();
      }
    });

    test('getVendors: in-memory fallback matches city with parenthesized alias', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors').mockResolvedValue([
        { id: 'v-1', name: 'Andaman Marine', state: 'Andaman and Nicobar Islands', city: 'Port Blair', location: 'Port Blair' },
        { id: 'v-2', name: 'Gujarat Forge', state: 'Gujarat', city: 'Surat', location: 'Surat' },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors({ query: { state: 'Andaman and Nicobar Islands', city: 'Sri Vijaya Puram (Port Blair)' } }, res, next);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ success: true, data: [expect.objectContaining({ id: 'v-1' })] })
        );
      } finally {
        pool.pool = originalPool;
        getVendorsSpy.mockRestore();
      }
    });

    test('getVendors: rejects invalid publicOnly query values with 400 validation errors', async () => {
      const next = jest.fn();
      const res = mockRes();

      await vendorController.getVendors(
        { user: { role: 'buyer', email: 'b@b.com' }, query: { publicOnly: 'maybe' } },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errors: expect.objectContaining({ publicOnly: expect.any(String) }),
        })
      );
    });

    test('getVendors: publicOnly indexed lookup for minor categories skips unindexed legacy scan when majors are known and tops up from parent major without leaking buyer-private vendors', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const getBuyerSpy = jest.spyOn(storeService, 'getBuyerAccountByEmail');
      const minorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([
        { id: 'v-priv', name: 'Private Supplier', isClientUploaded: true, buyerId: 'buyer-1', minorCategories: ['Laptop'] },
        { id: 'v-pub-minor', name: 'Public Minor Supplier', majorCategory: 'IT', minorCategories: ['Laptop'] },
      ]);
      const fallbackMinorSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-pub-minor', name: 'Public Minor Supplier', majorCategory: 'IT', minorCategories: ['Laptop'] },
        { id: 'v-pub-legacy', name: 'Legacy Minor Supplier', categories: ['Laptop'] },
      ]);
      const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockResolvedValue([
        { id: 'v-pub-major-1', name: 'Public IT Supplier', majorCategory: 'IT' },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors(
          {
            user: { role: 'buyer', email: 'buyer@enterprise.com' },
            query: { page: '1', pageSize: '10', publicOnly: 'true', majors: 'IT,All Categories', minors: 'Laptop' },
          },
          res,
          next
        );

        expect(getBuyerSpy).not.toHaveBeenCalled();
        expect(minorSpy).toHaveBeenCalled();
        expect(fallbackMinorSpy).not.toHaveBeenCalled();
        expect(majorSpy).toHaveBeenCalled();
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(true);
        expect(body.data.map((v) => v.id)).toEqual(['v-pub-minor', 'v-pub-major-1']);
      } finally {
        pool.pool = originalPool;
        getBuyerSpy.mockRestore();
        minorSpy.mockRestore();
        fallbackMinorSpy.mockRestore();
        majorSpy.mockRestore();
      }
    });

    test('getVendors: publicOnly indexed lookup for unmapped minor categories falls back to getPublicVendorsMatchingCategories when lookupMajors is empty', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const minorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockResolvedValue([
        { id: 'v-pub-minor', name: 'Public Minor Supplier', minorCategories: ['Custom Bespoke Widget'] },
      ]);
      const fallbackMinorSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([
        { id: 'v-pub-minor', name: 'Public Minor Supplier', minorCategories: ['Custom Bespoke Widget'] },
        { id: 'v-pub-legacy', name: 'Legacy Minor Supplier', categories: ['Custom Bespoke Widget'] },
      ]);

      try {
        const res = mockRes();
        await vendorController.getVendors(
          {
            user: { role: 'buyer', email: 'buyer@enterprise.com' },
            query: { page: '1', pageSize: '10', publicOnly: 'true', minors: 'Custom Bespoke Widget' },
          },
          res,
          next
        );

        expect(minorSpy).toHaveBeenCalled();
        expect(fallbackMinorSpy).toHaveBeenCalledWith(['custom bespoke widget'], 20);
        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(true);
        expect(body.data.map((v) => v.id)).toEqual(['v-pub-minor', 'v-pub-legacy']);
      } finally {
        pool.pool = originalPool;
        minorSpy.mockRestore();
        fallbackMinorSpy.mockRestore();
      }
    });

    test('getVendors: publicOnly multi-minor and multi-major indexed DB lookups prevent starving secondary divisions', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const minorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMinorCategoryFromDB').mockImplementation(async (terms) => {
        if (terms.includes('laptop') && terms.includes('monitors')) {
          return [{ id: 'v-laptop', name: 'Laptop Co', majorCategory: 'IT', minorCategories: ['Laptop'] }];
        }
        return [{ id: 'v-monitor', name: 'Monitor Co', majorCategory: 'IT', minorCategories: ['Monitors'] }];
      });
      const fallbackSpy = jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      const majorSpy = jest.spyOn(domainQueries, 'getPublicVendorsByMajorCategoryFromDB').mockImplementation(async (majors) => {
        if (majors.length === 1 && String(majors[0]).toLowerCase() === 'it') return [{ id: 'v-it-1', name: 'IT One', majorCategory: 'IT' }];
        if (majors.length === 1 && String(majors[0]).toLowerCase() === 'civil') return [{ id: 'v-civ-1', name: 'Civil One', majorCategory: 'Civil' }];
        return [{ id: 'v-comb-1', name: 'Combined One', majorCategory: 'Civil' }];
      });

      try {
        const resMinors = mockRes();
        await vendorController.getVendors(
          { query: { page: '1', pageSize: '10', publicOnly: '1', minors: ['Laptop', 'Monitors'], majors: 'IT' } },
          resMinors,
          next
        );
        expect(resMinors.json.mock.calls[0][0].data.map((v) => v.id)).toEqual(
          expect.arrayContaining(['v-laptop', 'v-monitor', 'v-it-1'])
        );

        const resMajors = mockRes();
        await vendorController.getVendors(
          { query: { page: '1', pageSize: '10', publicOnly: 'true', majors: 'IT,Civil' } },
          resMajors,
          next
        );
        expect(resMajors.json.mock.calls[0][0].data.map((v) => v.id)).toEqual(['v-it-1', 'v-civ-1', 'v-comb-1']);
      } finally {
        pool.pool = originalPool;
        minorSpy.mockRestore();
        fallbackSpy.mockRestore();
        majorSpy.mockRestore();
      }
    });

    test('getVendors: publicOnly All Categories falls through to paginated public DB lookup with cleared category filter', async () => {
      const next = jest.fn();
      const domainQueries = require('../src/db/domainQueries');
      const originalPool = pool.pool;
      pool.pool = { query: jest.fn() };
      const pageSpy = jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-all-1', name: 'Global Network Vendor' }],
        total: 1,
      });

      try {
        const res = mockRes();
        await vendorController.getVendors(
          { user: { role: 'buyer', email: 'buyer@co.com' }, query: { page: '1', pageSize: '10', publicOnly: 'true', category: 'All Categories' } },
          res,
          next
        );
        expect(pageSpy).toHaveBeenCalledWith({
          limit: 10,
          offset: 0,
          search: '',
          email: '',
          category: '',
          publicOnly: true,
          scopedBuyerId: '',
        });
      } finally {
        pool.pool = originalPool;
        pageSpy.mockRestore();
      }
    });

    test('getVendors: in-memory fallback honors publicOnly, minor-first matching, vendorSelectedCategories, and parent-major top-up', async () => {
      const next = jest.fn();
      const originalPool = pool.pool;
      pool.pool = null;
      const dataset = [
        { id: 'v-priv', name: 'Buyer Private', buyerId: 'b-1', isClientUploaded: true, majorCategory: 'IT', minorCategories: ['Laptop'] },
        { id: 'v-major', name: 'IT Generalist', clientMappedCategories: ['IT', 'Cloud'] },
        { id: 'v-minor', name: 'Selected Laptop', vendorSelectedCategories: ['Laptop'] },
      ];
      const getVendorsSpy = jest.spyOn(storeService, 'getVendors').mockResolvedValue(dataset);

      try {
        const resPublic = mockRes();
        await vendorController.getVendors(
          { query: { publicOnly: 'true', minors: 'Laptop', majors: 'IT' } },
          resPublic,
          next
        );
        expect(getVendorsSpy).toHaveBeenCalledWith(null, null);
        expect(resPublic.json.mock.calls[0][0].data.map((v) => v.id)).toEqual(['v-minor', 'v-major']);

        const resStrictMinor = mockRes();
        await vendorController.getVendors(
          { query: { minor: 'Laptop' } },
          resStrictMinor,
          next
        );
        expect(resStrictMinor.json.mock.calls[0][0].data.map((v) => v.id)).toEqual(['v-priv', 'v-minor']);
      } finally {
        pool.pool = originalPool;
        getVendorsSpy.mockRestore();
      }
    });

    test('createVendor role handling and validation', async () => {
      const res = mockRes();
      const next = jest.fn();

      // Buyer forbidden to create vendor directly via this endpoint
      await vendorController.createVendor({ user: { role: 'buyer' }, body: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);

      // Missing name
      await vendorController.createVendor(
        { user: { role: 'admin' }, body: { majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(400);

      // Admin role with query buyerId
      await vendorController.createVendor(
        { user: { role: 'admin' }, query: { buyerId: 'ba-1' }, body: { name: 'Admin Vendor', majorCategory: 'Civil' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      // Success
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v@v.com' }, body: { name: 'Vendor 1', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(201);

      // A duplicate email is rejected before the durable create path runs, so
      // it cannot leave a cache row or start identity/onboarding side effects.
      const addVendorSpy = jest.spyOn(storeService, 'addVendorDurably');
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v@v.com' }, body: { name: 'Vendor 1 Again', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(addVendorSpy).not.toHaveBeenCalled();
      addVendorSpy.mockRestore();

      // Exception handling. A distinct email from the "Success" case above —
      // createVendor now checks for an existing vendor email before addVendorDurably
      // is ever called, so reusing v@v.com here would short-circuit to a 409
      // and never reach the mocked throw this test is exercising.
      jest.spyOn(storeService, 'addVendorDurably').mockRejectedValue(new Error('err'));
      await vendorController.createVendor(
        { user: { role: 'vendor', email: 'v2@v.com' }, body: { name: 'Vendor 2', majorCategory: 'Mechanical' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('createVendor: buyer with a linked account can add a vendor, scoped and whitelisted server-side', async () => {
      const buyerAccount = storeService.addBuyerAccount({
        organizationName: 'Real Buyer Co',
        corporateEmail: 'real-buyer@example.com',
      });

      const res = mockRes();
      const next = jest.fn();
      await vendorController.createVendor(
        {
          user: { role: 'buyer', email: 'real-buyer@example.com' },
          body: {
            name: 'Direct Deal Vendor',
            email: 'direct-deal@vendor.test',
            phone: '9876543210',
            majorCategory: 'Fasteners',
            // Attempted spoofing of ownership/identity fields — must be
            // ignored, not trusted from the request body.
            buyerId: 'someone-elses-buyer-id',
            addedByBuyerCompany: 'A Totally Different Company',
            subscriptionPlan: 'select',
          },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(201);
      const created = res.json.mock.calls[0][0].data;
      expect(created.buyerId).toBe(buyerAccount.id);
      expect(created.addedByBuyerCompany).toBe('Real Buyer Co');
      expect(created.subscriptionPlan).not.toBe('select');
    });

    test('createVendor: buyer omitting a vendor email is rejected', async () => {
      storeService.addBuyerAccount({
        organizationName: 'Email Required Co',
        corporateEmail: 'email-required-buyer@example.com',
      });

      const res = mockRes();
      const next = jest.fn();
      await vendorController.createVendor(
        {
          user: { role: 'buyer', email: 'email-required-buyer@example.com' },
          body: { name: 'No Email Vendor', majorCategory: 'Cables' },
        },
        res,
        next
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('identityQueries.js insertVendorAccount and branches', () => {
    test('insertVendorAccount validation and error handling', async () => {
      // Missing pool
      const originalPool = pool.pool;
      pool.pool = null;
      await expect(identityQueries.insertVendorAccount({ email: 'v@v.com', password: 'pass' })).rejects.toThrow();

      // Restore mock pool
      pool.pool = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql.includes('from "user" where email')) {
            return Promise.resolve({ rows: [{ id: 'existing-v' }] });
          }
          return Promise.resolve({ rows: [{ uuid: 'uuid-role-1' }] });
        }),
      };

      // Missing email/password
      await expect(identityQueries.insertVendorAccount({ email: '', password: '' })).rejects.toThrow();

      // User already exists
      const resExists = await identityQueries.insertVendorAccount({
        email: 'exists@vendor.com',
        password: 'Password123',
      });
      expect(resExists.created).toBe(false);
      expect(resExists.reason).toBe('ALREADY_EXISTS');

      // Resolve master UUIDs fail
      pool.pool.query = jest.fn().mockResolvedValue({ rows: [] });
      await expect(
        identityQueries.insertVendorAccount({ email: 'new@v.com', password: 'Password123' })
      ).rejects.toThrow(/Role/);

      pool.pool = originalPool;
    });

    test('insertVendorAccount with transaction success (new org and reused org)', async () => {
      const originalPool = pool.pool;
      pool.pool = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql.includes('from "user"') || sql.includes('where lower(u.email)')) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [{ uuid: 'uuid-master-1' }] });
        }),
      };

      // Test with transaction executing client queries
      const userInsert = jest.fn().mockResolvedValue({ rows: [{ uuid: 'user-created' }] });
      jest.spyOn(pool, 'withTransaction').mockImplementation(async (callback) => {
        const client = {
          query: jest.fn().mockImplementation((sql, params) => {
            if (sql.includes('select uuid from organization')) {
              return Promise.resolve({ rows: [] });
            }
            if (sql.includes('insert into "user"')) {
              return userInsert(sql, params);
            }
            return Promise.resolve({ rows: [{ uuid: 'org-created' }] });
          }),
        };
        return await callback(client);
      });

      const res = await identityQueries.insertVendorAccount({
        email: 'fresh@vendor.com',
        password: 'Password123',
        fullName: 'Vendor Lead',
        organizationName: 'Fresh Vendor Inc',
        resetPasswordRequired: false,
      });
      expect(res.created).toBe(true);
      expect(res.user.role).toBe('vendor');
      expect(userInsert.mock.calls[0][0]).toContain('is_active, self_client, is_approved, reset_password');
      expect(userInsert.mock.calls[0][1][11]).toBe(false);

      pool.pool = originalPool;
    });
  });

  describe('graphql/resolvers.js Vendor & BuyerAccount mutations & Query Branches', () => {
    const mockContext = {
      req: {
        headers: { authorization: 'Bearer token-123' },
      },
    };

    beforeEach(() => {
      const authService = require('../src/services/authService');
      jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
        valid: true,
        user: { role: 'admin', email: 'admin@procucev.com' },
      });
    });

    test('createVendor, updateVendor, deleteVendor, and createBuyerAccount mutations', async () => {
      const newV = await rootResolvers.createVendor(
        { input: { name: 'GraphQL Vendor', majorCategory: 'Civil', email: 'gv@test.com' } },
        mockContext
      );
      expect(newV).toHaveProperty('name', 'GraphQL Vendor');

      const updatedV = await rootResolvers.updateVendor(
        { id: newV.id, input: { brandName: 'GraphQL Brand' } },
        mockContext
      );
      expect(updatedV).toHaveProperty('brandName', 'GraphQL Brand');

      const deleted = await rootResolvers.deleteVendor({ id: newV.id }, mockContext);
      expect(deleted).toBe(true);

      const ba = await rootResolvers.createBuyerAccount(
        { input: { organizationName: 'GQL Buyer Org', corporateEmail: 'gqlbuyer@test.com' } },
        mockContext
      );
      expect(ba).toHaveProperty('organizationName', 'GQL Buyer Org');
    });

    test('rfqs and rfq query filters and scoping', async () => {
      const allRfqs = await rootResolvers.rfqs(
        { category: 'Mechanical', sourcingMode: 'mode_1', status: 'OPEN', limit: 10, offset: 0 },
        mockContext
      );
      expect(Array.isArray(allRfqs)).toBe(true);

      const singleRfq = await rootResolvers.rfq({ rfqNumber: 'RFQ-NON-EXISTENT' }, mockContext);
      expect(singleRfq).toBeNull();

      const nullKeyRfq = await rootResolvers.rfq({}, mockContext);
      expect(nullKeyRfq).toBeNull();

      // updateRFQ with non-existent id returns null
      const updatedNull = await rootResolvers.updateRFQ({ id: 'non-existent', input: {} }, mockContext);
      expect(updatedNull).toBeNull();
    });

    test('createRFQ with lineItems fallback and decryptData variations', async () => {
      const createdRfq = await rootResolvers.createRFQ(
        { input: { title: 'Test RFQ GQL', lineItems: [{ name: 'Item 1' }] } },
        mockContext
      );
      expect(createdRfq).toHaveProperty('title', 'Test RFQ GQL');

      const cryptoService = require('../src/services/cryptoService');
      const encrypted = cryptoService.encrypt('test plaintext');

      // decryptData plain object vs token string (encrypted.encoded)
      const decryptedPlain = await rootResolvers.decryptData({ input: encrypted }, mockContext);
      expect(decryptedPlain).toHaveProperty('plaintext', 'test plaintext');

      const decryptedToken = await rootResolvers.decryptData({ input: { token: encrypted.encoded } }, mockContext);
      expect(decryptedToken).toHaveProperty('plaintext', 'test plaintext');
    });

    test('vendors, vendor, buyerAccounts, buyerAccount resolvers', async () => {
      // vendors with filters
      const vList = await rootResolvers.vendors(
        { majorCategory: 'Mechanical', source: 'buyer_manual', search: 'Apex', limit: 10, offset: 0 },
        mockContext
      );
      expect(Array.isArray(vList)).toBe(true);

      const vListBuyer = await rootResolvers.vendors(
        {},
        { req: { user: { role: 'buyer', email: 'b@b.com' } } }
      );
      expect(Array.isArray(vListBuyer)).toBe(true);

      const vListBuyerIdArg = await rootResolvers.vendors({ buyerId: 'ba-1' }, {});
      expect(Array.isArray(vListBuyerIdArg)).toBe(true);

      // vendor resolver by id and by buyerId
      const singleV = await rootResolvers.vendor({ id: 'non-existent' }, mockContext);
      expect(singleV).toBeNull();

      const singleVBuyer = await rootResolvers.vendor(
        { id: 'v1' },
        { req: { user: { role: 'buyer', email: 'b@b.com' } } }
      );
      expect(singleVBuyer).toBeDefined();

      const singleVBuyerArg = await rootResolvers.vendor({ id: 'v1', buyerId: 'ba-1' }, {});
      expect(singleVBuyerArg).toBeDefined();

      // buyerAccounts and buyerAccount resolvers
      if (rootResolvers.buyerAccounts) {
        const baList = await rootResolvers.buyerAccounts({}, mockContext);
        expect(Array.isArray(baList)).toBe(true);
      }
      if (rootResolvers.buyerAccount) {
        const singleBa = rootResolvers.buyerAccount({ id: 'ba-1' }, mockContext);
        expect(singleBa).toBeDefined();
      }
    });

    test('clearQueryCache, purgeLogs, optimizePerformance and autoResolveLogErrors', async () => {
      const cleared = await rootResolvers.clearQueryCache({}, mockContext);
      expect(cleared).toBe(true);

      const autoRes = await rootResolvers.autoResolveLogErrors({ action: 'CLEAR_STALE_SESSIONS' }, mockContext);
      // The count is the real diagnosis of the logs, not a fixed 1.
      expect(autoRes.diagnosedCount).toBe(autoRes.issues.length);
      expect(autoRes.remediationsApplied).toHaveLength(1);

      const autoResAll = await rootResolvers.autoResolveLogErrors({}, mockContext);
      expect(autoResAll).toBeDefined();

      const purged = await rootResolvers.purgeLogs({}, mockContext);
      expect(purged).toBeDefined();

      const optimized = await rootResolvers.optimizePerformance({}, mockContext);
      expect(optimized).toBeDefined();
    });
  });

  describe('storeService.js remaining branch coverage', () => {
    test('notifyBuyer with ID and corporateEmail', () => {
      expect(storeService.notifyBuyer(null)).toBeNull();

      const created = storeService.addBuyerAccount({
        organizationName: 'Notify Org',
        corporateEmail: 'notifyorg@test.com',
      });
      const notif1 = storeService.notifyBuyer(created.id, {
        title: 'T1',
        message: 'M1',
        meta: { rfq: { id: 'rfq-1', rfqNumber: 'RFQ-001' } },
      });
      expect(notif1.recipientId).toBe(created.id);

      const notif2 = storeService.notifyBuyer('notifyorg@test.com', {
        title: 'T2',
        message: 'M2',
        meta: { rfq: { id: 'rfq-1', rfqNumber: 'RFQ-001' } },
      });
      expect(notif2.recipientId).toBe(created.id);
    });

    test('refreshInfrastructureHealth connected and disconnected paths', async () => {
      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConfigured: true,
        isConnected: true,
        providerLabel: 'Neon PostgreSQL',
        database: 'procucev',
        latencyMs: 45,
        poolStatus: 'healthy',
        userCount: 10,
        vendorCount: 20,
        rfqCount: 5,
      });

      const resConnected = await storeService.refreshInfrastructureHealth();
      expect(resConnected.isConnected).toBe(true);

      jest.spyOn(pool, 'checkDatabaseHealth').mockResolvedValueOnce({
        isConfigured: false,
        isConnected: false,
        errorMessage: 'Connection refused',
      });

      const resDisconnected = await storeService.refreshInfrastructureHealth();
      expect(resDisconnected.isConnected).toBe(false);
    });

    test('empanelIngestedVendor minimal and full attributes', async () => {
      const ingestedVendor = await storeService.empanelIngestedVendor(
        {
          name: 'Ingested Supplier Ltd',
          email: 'ingested@test.com',
          majorCategory: 'Mechanical',
          minorCategories: ['Valves', 'Pumps'],
        },
        'buyer@test.com'
      );
      expect(ingestedVendor.name).toBe('Ingested Supplier Ltd');
      expect(ingestedVendor.source).toBe('vendor_master_ingestion');
    });

    test('getVendors in-memory handles multi-token comma-separated vendor emails', async () => {
      const req = {
        query: {
          search: 'govardhan.kilari@procucev.com, veerababu.v@procucev.com, nonexisting@procucev.com',
        },
      };
      const res = mockRes();
      const next = jest.fn();

      const mockVendors = [
        { id: 'v-1', name: 'Govardhan Solutions', email: 'govardhan.kilari@procucev.com', majorCategory: 'IT' },
        { id: 'v-2', name: 'Veerababu Corp', email: 'veerababu.v@procucev.com', majorCategory: 'Electrical' },
        { id: 'v-3', name: 'Other Vendor', email: 'other@procucev.com', majorCategory: 'Mechanical' },
      ];

      jest.spyOn(storeService, 'getVendors').mockResolvedValue(mockVendors);

      await vendorController.getVendors(req, res, next);
      expect(res.json).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.data.length).toBe(2);
      expect(response.data.map((v) => v.id)).toEqual(['v-1', 'v-2']);

      // Also test short token <= 3 characters matching minorCategories
      const shortReq = { query: { search: 'HR, IT' } };
      const shortRes = mockRes();
      const mockWithMinor = [
        { id: 'v-4', name: 'HR Services', email: 'hr@example.com', minorCategories: ['HR Consulting', 'Payroll'] },
        { id: 'v-5', name: 'Hardware Spares', email: 'hw@example.com', minorCategories: ['Bolts'] },
      ];
      jest.spyOn(storeService, 'getVendors').mockResolvedValue(mockWithMinor);
      await vendorController.getVendors(shortReq, shortRes, next);
      expect(shortRes.json).toHaveBeenCalled();
      const shortResponse = shortRes.json.mock.calls[0][0];
      expect(shortResponse.success).toBe(true);
      expect(shortResponse.data.map((v) => v.id)).toEqual(['v-4']);
    });

    test('getVendorsPageFromDB constructs multi-token conditions without D1 pattern overflow', async () => {
      const domainQueries = require('../src/db/domainQueries');
      let capturedSql = null;
      let capturedD1 = null;
      let capturedParams = null;

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation(async (sql, params, opts) => {
        capturedSql = sql;
        capturedD1 = opts && opts.d1Text;
        capturedParams = params;
        return { rows: [] };
      });

      const multiEmailSearch = 'govardhan.kilari@procucev.com, veerababu.v@procucev.com, nilesh.murme@procucev.com';
      await domainQueries.getVendorsPageFromDB({
        limit: 10,
        offset: 0,
        search: multiEmailSearch,
      });

      expect(capturedSql).toContain('email ILIKE');
      expect(capturedSql).toContain('OR');
      expect(capturedD1).toContain('email COLLATE NOCASE >=');
      expect(capturedD1).toContain("json_extract(raw, '$.corporateEmail') COLLATE NOCASE >=");
      expect(capturedD1).not.toContain("$.contact");
      expect(capturedD1).not.toContain('major_category');
      expect(capturedSql).toContain("raw->>'corporateEmail'");
      expect(capturedParams.length).toBeGreaterThanOrEqual(3);
      // Ensure no param string sent to LIKE exceeds 50 chars
      capturedParams.forEach((p) => {
        if (typeof p === 'string' && p.startsWith('%') && p.endsWith('%')) {
          expect(p.length).toBeLessThanOrEqual(50);
        }
      });

      // Test state and city with parenthesized alias
      await domainQueries.getVendorsPageFromDB({
        limit: 10,
        offset: 0,
        state: 'Andaman and Nicobar Islands',
        city: 'Sri Vijaya Puram (Port Blair)',
      });
      expect(capturedSql).toContain("raw->>'state' ILIKE");
      expect(capturedSql).toContain("raw->>'city' ILIKE");
      expect(capturedD1).toContain("lower(json_extract(raw,'$.state'))");
      expect(capturedD1).toContain("lower(json_extract(raw,'$.city'))");

      // Test plain city without alias
      await domainQueries.getVendorsPageFromDB({
        limit: 10,
        offset: 0,
        city: 'Pune',
      });
      expect(capturedSql).toContain("raw->>'city' ILIKE");
      expect(capturedD1).toContain("lower(json_extract(raw,'$.city'))");
    });

    test('enforces valid vendor categories across createVendor, updateVendor (including synthetic v-master fallback), and buyer bulkImportVendors', async () => {
      const { VENDOR_CATEGORY_VALIDATION_MESSAGES } = require('../src/config/constants');
      const buyerReqUser = { role: 'buyer', sub: 'u-buyer-cat-1', email: 'buyer@cat.test', orgId: 'org-buyer-cat-1', name: 'Buyer Cat' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'ba-cat-promo',
        corporateEmail: 'buyer@cat.test',
        organizationName: 'Buyer Org',
      });

      // 1. createVendor blocks placeholder majorCategory
      const badCreateRes = mockRes();
      await vendorController.createVendor({
        user: buyerReqUser,
        body: {
          name: 'Bad Category Vendor',
          email: 'badcat@vendor.test',
          phone: '9876543210',
          majorCategory: 'Vendor Master',
          minorCategories: [],
        },
      }, badCreateRes, jest.fn());
      expect(badCreateRes.status).toHaveBeenCalledWith(400);
      expect(badCreateRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED,
      }));

      // 2. updateVendor blocks updating to placeholder categories
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-owned-cat',
        name: 'Owned Vendor',
        email: 'owned@cat.test',
        buyerId: 'ba-cat-promo',
        majorCategory: 'Mechanical',
        minorCategories: ['Valves'],
      });
      const badUpdateRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-owned-cat' },
        user: buyerReqUser,
        body: { majorCategory: 'Uncategorized', minorCategories: ['None'] },
      }, badUpdateRes, jest.fn());
      expect(badUpdateRes.status).toHaveBeenCalledWith(400);
      expect(badUpdateRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED,
      }));

      // 3. updateVendor promotes synthetic v-master-* record with valid categories
      const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      jest.spyOn(storeService, 'getVendors').mockResolvedValue([]);
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce({
        id: 'gov-1',
        sessionId: 'sess-gov-1',
        companyName: 'Govardhan Master Co',
        email: 'govardhan@cat.test',
        phone: '9966766905',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValueOnce(null);
      const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor').mockResolvedValue({
        id: 'vnd-promoted-cat',
        name: 'Govardhan Master Co',
        email: 'govardhan@cat.test',
        majorCategory: 'IT Infrastructure',
        minorCategories: ['Laptops'],
        buyerId: 'ba-cat-promo',
      });
      const promoRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-gov-1' },
        user: buyerReqUser,
        body: {
          vendorEmail: 'govardhan@cat.test',
          vendorName: 'Govardhan Master Co',
          majorCategory: 'IT Infrastructure',
          minorCategories: ['Laptops'],
        },
      }, promoRes, jest.fn());
      expect(promoRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: 'vnd-promoted-cat',
          majorCategory: 'IT Infrastructure',
          minorCategories: ['Laptops'],
        }),
      }));
      expect(empanelSpy).toHaveBeenCalled();

      // 4. Synthetic v-hist-local-* update without valid category returns 400 VENDOR_CATEGORY_REQUIRED
      const promoMissingCatRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-hist-local-batch-2' },
        user: buyerReqUser,
        body: {
          vendorEmail: 'govardhan2@cat.test',
          vendorName: 'Govardhan 2 Co',
          phone: '9876543210',
        },
      }, promoMissingCatRes, jest.fn());
      expect(promoMissingCatRes.status).toHaveBeenCalledWith(400);
      expect(promoMissingCatRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        code: 'VENDOR_CATEGORY_REQUIRED',
      }));

      // 5. Buyer bulkImportVendors rejects rows lacking valid category
      const bulkRes = mockRes();
      await vendorController.bulkImportVendors({
        user: buyerReqUser,
        body: {
          vendors: [
            {
              name: 'No Cat Import Co',
              email: 'nocat-import@test.com',
              phone: '9876543210',
              majorCategory: 'Vendor Master',
            },
          ],
        },
      }, bulkRes, jest.fn());
      expect(bulkRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ total: 1, imported: 0, failed: 1 }),
      }));

      // 6. updateCategories validation, placeholder guard, synthetic promotion, and owned update
      const badSchemaCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-owned-1' },
        user: buyerReqUser,
        body: { minorCategories: 'not-an-array' },
      }, badSchemaCatRes, jest.fn());
      expect(badSchemaCatRes.status).toHaveBeenCalledWith(400);

      const placeholderMajorCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-owned-1' },
        user: buyerReqUser,
        body: { majorCategory: 'Vendor Master' },
      }, placeholderMajorCatRes, jest.fn());
      expect(placeholderMajorCatRes.status).toHaveBeenCalledWith(400);

      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce({
        id: 'gov-cat-1',
        sessionId: 'sess-cat-1',
        companyName: 'Gov Cat Co',
        email: 'govcat@cat.test',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const promoCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-master-gov-cat-1' },
        user: buyerReqUser,
        body: { majorCategory: 'Electrical', minorCategories: ['Switchgear'] },
      }, promoCatRes, jest.fn());
      expect(promoCatRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const missingCatPromoRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-hist-local-empty-cat' },
        user: buyerReqUser,
        body: { minorCategories: [] },
      }, missingCatPromoRes, jest.fn());
      expect(missingCatPromoRes.status).toHaveBeenCalledWith(400);
      expect(missingCatPromoRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_CATEGORY_REQUIRED' }));

      const missingMasterCatRes = mockRes();
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce(null);
      await vendorController.updateCategories({
        params: { id: 'v-master-missing-404' },
        user: buyerReqUser,
        body: { majorCategory: 'Electrical', minorCategories: ['Switchgear'] },
      }, missingMasterCatRes, jest.fn());
      expect(missingMasterCatRes.status).toHaveBeenCalledWith(404);

      const missingDirectCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-nonexistent-999' },
        user: buyerReqUser,
        body: { majorCategory: 'Electrical', minorCategories: ['Switchgear'] },
      }, missingDirectCatRes, jest.fn());
      expect(missingDirectCatRes.status).toHaveBeenCalledWith(404);

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-owned-clear',
        name: 'Clear Test',
        email: 'clear@cat.test',
        buyerAccountId: buyerReqUser.sub,
        majorCategory: '',
        minorCategories: ['Switchgear'],
      });
      const clearCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-owned-clear' },
        user: buyerReqUser,
        body: { minorCategories: [] },
      }, clearCatRes, jest.fn());
      expect(clearCatRes.status).toHaveBeenCalledWith(400);

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-owned-valid',
        name: 'Valid Cat Co',
        email: 'valid@cat.test',
        buyerEmail: buyerReqUser.email,
        majorCategory: 'Mechanical',
        minorCategories: ['Valves'],
      });
      jest.spyOn(storeService, 'updateVendorCategoriesDurably').mockResolvedValueOnce({
        id: 'v-owned-valid',
        majorCategory: 'Electrical',
        minorCategories: ['Cables'],
      });
      const validCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-owned-valid' },
        user: buyerReqUser,
        body: { majorCategory: 'Electrical', minorCategories: ['Cables'] },
      }, validCatRes, jest.fn());
      expect(validCatRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 7. resolveFallbackVendorRecord email/foreign/master-ai branches + v-hist-local promotion
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'v-existing-scope', name: 'In Scope', email: 'inscope@cat.test', buyerId: 'ba-cat-promo' });
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValueOnce({ id: 'v-existing-scope', majorCategory: 'Civil', minorCategories: ['Cement'] });
      const scopeMatchRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-email-scope' },
        user: buyerReqUser,
        body: { vendorEmail: 'inscope@cat.test', majorCategory: 'Civil', minorCategories: ['Cement'] },
      }, scopeMatchRes, jest.fn());
      expect(scopeMatchRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'v-foreign', email: 'foreign@cat.test', buyerId: 'other-buyer' });
      const foreignRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-foreign' },
        user: buyerReqUser,
        body: { vendorEmail: 'foreign@cat.test', majorCategory: 'Civil', minorCategories: ['Cement'] },
      }, foreignRes, jest.fn());
      expect(foreignRes.status).toHaveBeenCalledWith(404);

      // Cover sanitizeVendorCategoryUpdates placeholder minor array (lines 1003-1004) and empty existing major (1016-1017)
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-owned-placeholder-minors',
        email: 'phmin@cat.test',
        buyerId: 'ba-cat-promo',
        majorCategory: 'Civil',
        minorCategories: ['Cement'],
      });
      const phMinorsRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-owned-placeholder-minors' },
        user: buyerReqUser,
        body: { minorCategories: ['Vendor Master'] },
      }, phMinorsRes, jest.fn());
      expect(phMinorsRes.status).toHaveBeenCalledWith(400);

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-owned-empty-cats',
        email: 'emptycats@cat.test',
        buyerId: 'ba-cat-promo',
        majorCategory: '',
        minorCategories: ['Cement'],
      });
      const clearMinorsRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-owned-empty-cats' },
        user: buyerReqUser,
        body: { minorCategories: [] },
      }, clearMinorsRes, jest.fn());
      expect(clearMinorsRes.status).toHaveBeenCalledWith(400);

      // Cover synthetic v-master-* update with locked field (line 1030) and missing master record (1057-1058)
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce(null);
      const missingMasterUpdRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-not-found' },
        user: buyerReqUser,
        body: { pan: 'ABCDE1234F', majorCategory: 'Civil', minorCategories: ['Cement'] },
      }, missingMasterUpdRes, jest.fn());
      expect(missingMasterUpdRes.status).toHaveBeenCalledWith(404);

      // Synthetic v-master-* update when master record lookup returns null, but vendorName and categories are provided in payload
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue(null);
      jest.spyOn(storeService, 'empanelIngestedVendor').mockImplementationOnce(async (candidate) => ({
        id: 'vnd-promoted-gov',
        ...candidate,
      }));
      const fallbackMasterUpdRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-vmv-6091371f-a51e-47fd-ad3a-ecb5168f4ffb' },
        user: buyerReqUser,
        body: {
          vendorName: 'Govardhan Solutions pvt LTD.',
          majorCategory: 'IT',
          minorCategories: ['Laptop'],
          vendorCode: 'V-GOV-01',
          email: 'govardhan.kilari@procucev.com',
          location: 'Hyderabad',
        },
      }, fallbackMasterUpdRes, jest.fn());
      expect(fallbackMasterUpdRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          name: 'Govardhan Solutions pvt LTD.',
          majorCategory: 'IT',
          minorCategories: ['Laptop'],
        }),
      }));

      // Cover findCategoryMappingByVendorRecord rejection catch (line 1372)
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce({
        id: 'gov-cat-err-1',
        sessionId: 'sess-err-1',
        companyName: 'Gov Err Co',
        email: 'goverr@cat.test',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockRejectedValueOnce(new Error('D1 timeout'));
      const mappingErrRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-gov-cat-err-1' },
        user: buyerReqUser,
        body: { majorCategory: 'Mechanical', minorCategories: ['Valves'] },
      }, mappingErrRes, jest.fn());
      expect(mappingErrRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Cover updateCategories resolving synthetic v-master-* into already-existing buyer vendor (line 1850)
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'v-already-empanelled',
          email: 'already@cat.test',
          buyerId: 'ba-cat-promo',
          majorCategory: 'Mechanical',
          minorCategories: ['Valves'],
        });
      jest.spyOn(storeService, 'updateVendorCategoriesDurably').mockResolvedValueOnce({
        id: 'v-already-empanelled',
        majorCategory: 'Electrical',
        minorCategories: ['Cables'],
      });
      const promoExistingCatRes = mockRes();
      await vendorController.updateCategories({
        params: { id: 'v-master-already-empanelled' },
        user: buyerReqUser,
        body: { vendorEmail: 'already@cat.test', majorCategory: 'Electrical', minorCategories: ['Cables'] },
      }, promoExistingCatRes, jest.fn());
      expect(promoExistingCatRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

      // Cover checkVendorOwnership prefix check when buyer string prefix is passed (line 136)
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-hist-123',
        email: 'histprefix@cat.test',
        source: 'vendor',
      });
      const prefixAllowedRes = mockRes();
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValueOnce({ id: 'v-hist-123', majorCategory: 'Civil', minorCategories: ['Bricks'] });
      await vendorController.updateVendor({
        params: { id: 'v-hist-123' },
        user: buyerReqUser,
        body: { majorCategory: 'Civil', minorCategories: ['Bricks'] },
      }, prefixAllowedRes, jest.fn());
      expect(prefixAllowedRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Cover sendBulkImportInvitations uncovered branches (2083-2169)
      const eventOutboxService = require('../src/services/eventOutboxService');
      const cmUser = { role: 'category_manager', sub: 'cm-1', email: 'cm@procucev.com' };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce({
        id: 'v-buyer-priv',
        email: 'priv@co.test',
        buyerId: 'ba-1',
        onboardingEmailStatus: 'skipped',
      });
      const bulkCmSkipRes = mockRes();
      await vendorController.sendBulkImportInvitations({ user: cmUser, body: { vendorIds: ['v-buyer-priv'] } }, bulkCmSkipRes, jest.fn());
      expect(bulkCmSkipRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ results: [{ vendorId: 'v-buyer-priv', status: 'not_found' }] }),
      }));

      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce({
        id: 'v-bulk-null-save',
        email: 'nullsave@co.test',
        onboardingEmailStatus: 'skipped',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ id: 'u-ns', email: 'nullsave@co.test' });
      jest.spyOn(eventOutboxService, 'enqueueEventOutbox').mockResolvedValueOnce({ id: 'ob-1', status: 'pending' });
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValueOnce(null);
      const bulkNullSaveRes = mockRes();
      await vendorController.sendBulkImportInvitations({ user: cmUser, body: { vendorIds: ['v-bulk-null-save'] } }, bulkNullSaveRes, jest.fn());
      expect(bulkNullSaveRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ queuedCount: 1 }),
      }));

      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockRejectedValueOnce(new Error('DB read err'));
      const bulkItemErrRes = mockRes();
      await vendorController.sendBulkImportInvitations({ user: cmUser, body: { vendorIds: ['v-item-err'] } }, bulkItemErrRes, jest.fn());
      expect(bulkItemErrRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ results: [{ vendorId: 'v-item-err', status: 'failed' }] }),
      }));

      const persistErr = new Error('Persistence unavailable');
      persistErr.code = 'PERSISTENCE_UNAVAILABLE';
      const bulkOuterErrRes = mockRes();
      const nextSpy = jest.fn();
      await vendorController.sendBulkImportInvitations({
        user: cmUser,
        body: { get vendorIds() { throw persistErr; } },
      }, bulkOuterErrRes, nextSpy);
      expect(bulkOuterErrRes.status).toHaveBeenCalledWith(503);

      const bulkGenericErr = new Error('Unexpected fail');
      const bulkGenericNext = jest.fn();
      await vendorController.sendBulkImportInvitations({
        user: cmUser,
        body: { get vendorIds() { throw bulkGenericErr; } },
      }, mockRes(), bulkGenericNext);
      expect(bulkGenericNext).toHaveBeenCalledWith(bulkGenericErr);

      // Cover createSubscriptionPaymentLink phone fallback error & 400 (lines 1641-1657)
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-pay-nophone',
        email: 'nophone@pay.test',
        phone: '',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('identity timeout'));
      const payNoPhoneRes = mockRes();
      await vendorController.createSubscriptionPaymentLink({
        params: { id: 'v-pay-nophone' },
        user: { role: 'vendor', email: 'nophone@pay.test', mobile: '9876543210' },
        body: { plan: 'connect', billingDuration: '6_months' },
      }, payNoPhoneRes, jest.fn());
      // Even if downstream Zoho fails or succeeds, lines 1641-1655 ran
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce(null);
      const payStillNoPhoneRes = mockRes();
      await vendorController.createSubscriptionPaymentLink({
        params: { id: 'v-pay-nophone' },
        user: { role: 'vendor', email: 'nophone@pay.test' },
        body: { plan: 'connect' },
      }, payStillNoPhoneRes, jest.fn());
      expect(payStillNoPhoneRes.status).toHaveBeenCalledWith(400);

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce({
        id: 'gov-ai-1',
        sessionId: 'sess-ai-1',
        companyName: 'Gov AI Co',
        email: 'govai@cat.test',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValueOnce({
        aiSuggestion: { majorCategory: 'Mechanical', minorCategories: ['Pumps'] },
        status: 'APPROVED',
      });
      const aiPromoRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-gov-ai-1' },
        user: buyerReqUser,
        body: { vendorEmail: 'govai@cat.test' },
      }, aiPromoRes, jest.fn());
      expect(aiPromoRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // Rejected AI mapping with no payload category -> 400 VENDOR_CATEGORY_REQUIRED
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValueOnce({
        id: 'gov-ai-rej',
        sessionId: 'sess-ai-rej',
        companyName: 'Gov AI Rejected Co',
        email: 'govrej@cat.test',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValueOnce({
        aiSuggestion: { majorCategory: 'Mechanical', minorCategories: ['Pumps'] },
        reviewAction: 'REJECTED',
      });
      const aiRejRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-gov-ai-rej' },
        user: buyerReqUser,
        body: { vendorEmail: 'govrej@cat.test' },
      }, aiRejRes, jest.fn());
      expect(aiRejRes.status).toHaveBeenCalledWith(400);

      const histPromoRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-hist-local-promo-1' },
        user: buyerReqUser,
        body: { vendorEmail: 'hist@cat.test', vendorName: 'Hist Co', majorCategory: 'Mechanical', minorCategories: ['Pumps'] },
      }, histPromoRes, jest.fn());
      expect(histPromoRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // 8. checkVendorOwnership foreign buyerAccountId/buyerEmail + in-memory pincode filter
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce({
        id: 'v-other-account',
        email: 'other@cat.test',
        buyerAccountId: 'foreign-account-999',
        buyerEmail: 'otherbuyer@foreign.test',
      });
      const forbiddenRes = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-other-account' },
        user: buyerReqUser,
        body: { name: 'Attempted Edit' },
      }, forbiddenRes, jest.fn());
      expect(forbiddenRes.status).toHaveBeenCalledWith(403);

      jest.spyOn(storeService, 'getVendors').mockResolvedValueOnce([
        { id: 'v-pin-1', name: 'Pin One', category: 'Cables', pincode: '411 001', city: 'Pune', state: 'Maharashtra', location: 'Pune, Maharashtra' },
      ]);
      const pinReq = { query: { search: ' , Pin', pincode: '411001', state: 'Maharashtra', city: 'Pune', category: 'Cables' } };
      const pinRes = mockRes();
      await vendorController.getVendors(pinReq, pinRes, jest.fn());
      expect(pinRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: [expect.objectContaining({ id: 'v-pin-1' })],
      }));
    });

    test('updateVendorStatus, bulkUpdateVendorStatus, updateVendor(isActive), activeOnly filtering, requestEvaluation guard, and bootstrap fallback deduplication', async () => {
      const storeService = require('../src/services/storeService');
      const vendorController = require('../src/controllers/vendorController');
      const bootstrapController = require('../src/controllers/bootstrapController');
      const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      const domainQueries = require('../src/db/domainQueries');
      const pool = require('../src/db/pool');
      const constants = require('../src/config/constants');
      const { VENDOR_STATUS_MESSAGES } = constants;

      expect(constants.isVendorInactive(null)).toBe(false);
      expect(constants.isVendorActive(null)).toBe(false);
      expect(constants.isVendorInactive({ status: 'INACTIVE' })).toBe(true);
      expect(constants.isVendorActive({ id: 'v-act', status: 'REGISTERED / NOT EVALUATED' })).toBe(true);

      const mockRes = () => {
        const res = {
          status: jest.fn(),
          json: jest.fn(),
        };
        res.status.mockReturnValue(res);
        return res;
      };

      const buyerUser = { role: 'buyer', email: 'buyer-status@co.test', sub: 'buyer-status-id', orgId: 'org-status-1' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'buyer-status-id',
        organizationId: 'org-status-1',
        organizationName: 'Status Buyer Org',
        corporateEmail: 'buyer-status@co.test',
      });
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: true, profile: { organizationId: 'org-status-1' } });
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      // 1. Auth & validation guards on updateVendorStatus
      const res401 = mockRes();
      await vendorController.updateVendorStatus({ params: { id: 'v-1' }, user: null, body: { isActive: false } }, res401, jest.fn());
      expect(res401.status).toHaveBeenCalledWith(401);

      const res403 = mockRes();
      await vendorController.updateVendorStatus({ params: { id: 'v-1' }, user: { role: 'vendor', email: 'v@v.test' }, body: { isActive: false } }, res403, jest.fn());
      expect(res403.status).toHaveBeenCalledWith(403);

      const res400 = mockRes();
      await vendorController.updateVendorStatus({ params: { id: 'v-1' }, user: buyerUser, body: { isActive: 'not-bool' } }, res400, jest.fn());
      expect(res400.status).toHaveBeenCalledWith(400);

      const res404 = mockRes();
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(null);
      await vendorController.updateVendorStatus({ params: { id: 'v-nonexistent' }, user: buyerUser, body: { isActive: false } }, res404, jest.fn());
      expect(res404.status).toHaveBeenCalledWith(404);

      // 2. Synthetic fallback v-master-* without categories CAN still be marked inactive cleanly
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
        id: 'master-nocat-1',
        sessionId: 'sess-nc-1',
        companyName: 'Govardhan Solutions Pvt LTD',
        email: 'gov@master.test',
        vendorCode: 'GOV-001',
      });
      jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValue(null);
      const resMasterDisable = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: 'v-master-master-nocat-1' }, user: buyerUser, body: { isActive: false } },
        resMasterDisable,
        jest.fn()
      );
      expect(resMasterDisable.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          masterRecordId: 'master-nocat-1',
          isActive: false,
          status: 'INACTIVE',
        }),
      }));

      // 3. Existing persisted buyer vendor: mark inactive & reactivate preserving previousStatus
      const seeded = storeService.addVendor(
        {
          name: 'Toggle Supplier',
          email: 'toggle@supplier.test',
          majorCategory: 'Mechanical',
          minorCategories: ['Pumps'],
          status: 'PREFERRED ENTERPRISE SUPPLIER',
          buyerId: 'buyer-status-id',
          source: 'buyer_uploaded',
        },
        'buyer-status@co.test',
        'buyer-status-id'
      );

      const resDisable = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: seeded.id }, user: buyerUser, body: { isActive: false } },
        resDisable,
        jest.fn()
      );
      expect(resDisable.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: seeded.id, isActive: false, status: 'INACTIVE', previousStatus: 'PREFERRED ENTERPRISE SUPPLIER' }),
      }));

      // Request new evaluation on inactive vendor without existing evaluation -> 400 VENDOR_INACTIVE
      jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValueOnce([]);
      const resEvalBlocked = mockRes();
      await vendorController.requestEvaluation(
        { params: { id: seeded.id }, user: buyerUser, body: {} },
        resEvalBlocked,
        jest.fn()
      );
      expect(resEvalBlocked.status).toHaveBeenCalledWith(400);
      expect(resEvalBlocked.json).toHaveBeenCalledWith(expect.objectContaining({
        code: 'VENDOR_INACTIVE',
        error: VENDOR_STATUS_MESSAGES.INACTIVE_EVALUATION_BLOCKED,
      }));

      // Existing historical evaluation on inactive vendor still resolves read-only
      jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValueOnce([{ id: 'eval-hist-1', vendorId: seeded.id, overallScore: 91 }]);
      const resEvalHist = mockRes();
      await vendorController.requestEvaluation(
        { params: { id: seeded.id }, user: buyerUser, body: {} },
        resEvalHist,
        jest.fn()
      );
      expect(resEvalHist.status).toHaveBeenCalledWith(200);

      // Reactivate via updateVendorStatus restores previousStatus
      const resEnable = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: seeded.id }, user: buyerUser, body: { isActive: true } },
        resEnable,
        jest.fn()
      );
      expect(resEnable.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: seeded.id, isActive: true, status: 'PREFERRED ENTERPRISE SUPPLIER' }),
      }));

      // PUT /api/vendors/:id with isActive on categoryless v-hist-local-* fallback works
      const resPutFallback = mockRes();
      await vendorController.updateVendor(
        { params: { id: 'v-hist-local-batch9-0' }, user: buyerUser, body: { isActive: false, vendorName: 'Local Synth Vendor' } },
        resPutFallback,
        jest.fn()
      );
      expect(resPutFallback.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ isActive: false, status: 'INACTIVE' }),
      }));

      // getVendors?activeOnly=true hides inactive vendor while default directory read still shows it
      const resActiveOnly = mockRes();
      await vendorController.getVendors({ user: buyerUser, query: { activeOnly: 'true' } }, resActiveOnly, jest.fn());
      const activeIds = resActiveOnly.json.mock.calls[0][0].data.map((v) => v.name);
      expect(activeIds).toContain('Toggle Supplier');
      expect(activeIds).not.toContain('Govardhan Solutions Pvt LTD');

      // bulkUpdateVendorStatus guards + mixed ownership + promotion + error forwarding
      const bulk401 = mockRes();
      await vendorController.bulkUpdateVendorStatus({ user: null, body: { vendorIds: ['a'], isActive: false } }, bulk401, jest.fn());
      expect(bulk401.status).toHaveBeenCalledWith(401);

      const bulk403 = mockRes();
      await vendorController.bulkUpdateVendorStatus({ user: { role: 'vendor' }, body: { vendorIds: ['a'], isActive: false } }, bulk403, jest.fn());
      expect(bulk403.status).toHaveBeenCalledWith(403);

      const bulk400 = mockRes();
      await vendorController.bulkUpdateVendorStatus({ user: buyerUser, body: { vendorIds: [], isActive: false } }, bulk400, jest.fn());
      expect(bulk400.status).toHaveBeenCalledWith(400);

      const bulkBlankIds = mockRes();
      await vendorController.bulkUpdateVendorStatus({ user: buyerUser, body: { vendorIds: ['  '], isActive: false } }, bulkBlankIds, jest.fn());
      expect(bulkBlankIds.status).toHaveBeenCalledWith(400);

      const foreignVendor = { id: 'v-foreign-1', name: 'Foreign Co', buyerId: 'other-buyer' };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (id) => {
        if (id === seeded.id) return seeded;
        if (id === 'v-foreign-1') return foreignVendor;
        return null;
      });
      const bulkMixed = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        {
          user: buyerUser,
          body: {
            vendorIds: [seeded.id, 'v-foreign-1', 'v-missing', 'v-hist-local-bulk-0'],
            isActive: false,
            vendors: [{ id: 'v-hist-local-bulk-0', vendorName: 'Bulk Local Vendor' }],
          },
        },
        bulkMixed,
        jest.fn()
      );
      expect(bulkMixed.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        updatedCount: 2,
        skippedIds: ['v-foreign-1', 'v-missing'],
      }));

      // Single promoted reactivation (isActive: true) & bulk singular reactivation + skipped null update
      const reactivatePromoRes = mockRes();
      await vendorController.updateVendorStatus(
        {
          params: { id: 'v-hist-local-promo-1' },
          user: buyerUser,
          body: { isActive: true, vendorName: 'Reactivated Local Co' },
        },
        reactivatePromoRes,
        jest.fn()
      );
      expect(reactivatePromoRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'updateVendorActiveStatusDurably').mockResolvedValueOnce(null);
      const bulkReactivateSingle = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        { user: buyerUser, body: { vendorIds: [seeded.id, 'v-hist-local-promo-2'], isActive: true, vendors: [{ id: 'v-hist-local-promo-2', vendorName: 'Promo Two' }] } },
        bulkReactivateSingle,
        jest.fn()
      );
      expect(bulkReactivateSingle.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        updatedCount: 1,
        skippedIds: [seeded.id],
      }));

      // Error handling branches in requestEvaluation & getPublicVendorById
      const eval401 = mockRes();
      await vendorController.requestEvaluation({ params: { id: seeded.id }, user: null, body: {} }, eval401, jest.fn());
      expect(eval401.status).toHaveBeenCalledWith(401);

      const eval403 = mockRes();
      await vendorController.requestEvaluation({ params: { id: seeded.id }, user: { role: 'vendor' }, body: {} }, eval403, jest.fn());
      expect(eval403.status).toHaveBeenCalledWith(403);

      const noEmailVendor = { id: 'v-no-email', name: 'No Email Supplier', majorCategory: 'Mechanical', buyerId: 'buyer-status-id' };
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(noEmailVendor);
      jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValueOnce([]);
      const evalNoEmail = mockRes();
      await vendorController.requestEvaluation({ params: { id: noEmailVendor.id }, user: buyerUser, body: {} }, evalNoEmail, jest.fn());
      expect(evalNoEmail.status).toHaveBeenCalledWith(400);

      // Error forwarding in updateVendorStatus & bulkUpdateVendorStatus
      const nextErr = jest.fn();
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockRejectedValueOnce(new Error('DB crash'));
      await vendorController.updateVendorStatus({ params: { id: seeded.id }, user: buyerUser, body: { isActive: false } }, mockRes(), nextErr);
      expect(nextErr).toHaveBeenCalled();

      const nextBulkErr = jest.fn();
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockRejectedValueOnce(new Error('DB bulk crash'));
      await vendorController.bulkUpdateVendorStatus({ user: buyerUser, body: { vendorIds: [seeded.id], isActive: false } }, mockRes(), nextBulkErr);
      expect(nextBulkErr).toHaveBeenCalled();

      // bootstrapController.getBootstrap skips already-promoted masterRecordId & preserves inactive master record
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValueOnce({
        id: 'buyer-status-id',
        organizationId: 'org-status-1',
        organizationName: 'Status Buyer Org',
      });
      jest.spyOn(storeService, 'getBootstrapData').mockResolvedValueOnce({
        buyerAccounts: [],
        activeBuyerAccount: null,
        vendors: [{ id: 'v-ingest-1', masterRecordId: 'master-nocat-1', buyerId: 'buyer-status-id' }],
        vendorsTotal: 1,
        evaluations: [],
        auditLogs: [],
        aiFeed: [],
        systemConfig: {},
        azureHealth: {},
        vendorCatalogue: [],
      });
      jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValueOnce({ id: 'sess-boot-1' });
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecords').mockResolvedValueOnce([
        { id: 'master-nocat-1', companyName: 'Govardhan Solutions Pvt LTD', email: 'gov@master.test' },
        { id: 'master-inactive-2', companyName: 'Inactive Master Co', email: 'inact-master@test.co', isActive: false },
      ]);
      const bootRes = mockRes();
      await bootstrapController.getBootstrap({ user: buyerUser, query: {} }, bootRes, jest.fn());
      const bootVendors = bootRes.json.mock.calls[0][0].data.vendors;
      expect(bootVendors.map((v) => v.id)).not.toContain('v-master-master-nocat-1');
      expect(bootVendors.find((v) => v.id === 'v-master-master-inactive-2')).toMatchObject({
        id: 'v-master-master-inactive-2',
        isActive: false,
        status: 'INACTIVE',
      });
    });

    test('marks organization vendorMasterUploaded across buyer createVendor, bulkImportVendors, and ingestHistoricalData and logs warning on error', async () => {
      const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
      const buyerUser = { role: 'buyer', email: 'buyer-upload-flag@corp.test', orgId: 'org-upload-flag-1' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue({
        id: 'ba-upload-flag-1',
        corporateEmail: 'buyer-upload-flag@corp.test',
        organizationName: 'Upload Flag Buyer',
        organizationId: 'org-upload-flag-1',
      });
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
        id: 'ba-upload-flag-1',
        corporateEmail: 'buyer-upload-flag@corp.test',
        organizationName: 'Upload Flag Buyer',
        organizationId: 'org-upload-flag-1',
      });
      const markSpy = jest.spyOn(vendorIngestionQueries, 'markVendorMasterUploaded').mockRejectedValueOnce(new Error('D1 mark failed'));

      jest.spyOn(storeService, 'addVendorDurably').mockResolvedValueOnce({
        id: 'v-created-flag-1',
        name: 'First Buyer Vendor',
        email: 'firstv@corp.test',
      });
      jest.spyOn(storeService, 'provisionVendorOnboarding').mockResolvedValueOnce({ sent: true });
      const createRes = mockRes();
      await vendorController.createVendor({
        user: buyerUser,
        body: { name: 'First Buyer Vendor', email: 'firstv@corp.test', majorCategory: 'Mechanical' },
      }, createRes, jest.fn());
      expect(createRes.status).toHaveBeenCalledWith(201);
      expect(markSpy).toHaveBeenCalledWith('org-upload-flag-1');

      markSpy.mockRejectedValueOnce(new Error('D1 bulk mark failed'));
      jest.spyOn(domainQueries, 'createBulkImportSessionInDB').mockResolvedValueOnce({ id: 'sess-flag-1', processed: 0, imported: 0 });
      jest.spyOn(domainQueries, 'incrementBulkImportSessionInDB').mockResolvedValueOnce({ id: 'sess-flag-1', processed: 1, imported: 1 });
      jest.spyOn(storeService, 'bulkAddVendors').mockResolvedValueOnce({
        results: [{ rowNumber: 2, status: 'imported', vendor: { id: 'v-bulk-flag-1', name: 'Bulk Co' } }],
        importedCount: 1,
        duplicateCount: 0,
        missingEmailCount: 0,
      });
      const bulkRes = mockRes();
      await vendorController.bulkImportVendors({
        user: buyerUser,
        body: { vendors: [{ name: 'Bulk Co', email: 'bulkco@test.in', phone: '9876543210', majorCategory: 'Mechanical' }] },
      }, bulkRes, jest.fn());
      expect(bulkRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      markSpy.mockRejectedValueOnce(new Error('D1 hist mark failed'));
      jest.spyOn(storeService, 'processHistoricalPurchaseData').mockResolvedValueOnce({
        success: true,
        importedCount: 1,
      });
      const histRes = mockRes();
      await buyerAccountController.ingestHistoricalData({
        user: buyerUser,
        body: { period: '1_year', vendorRecords: [{ name: 'Hist Co', email: 'hist@test.in', majorCategory: 'Mechanical' }] },
      }, histRes, jest.fn());
      expect(histRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, importedCount: 1 }));
      expect(markSpy).toHaveBeenCalledTimes(3);
    });

    test('resolves promoted v-master-<id> vendor via masterRecordId and falls back to buyerAccount.id org scope', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const account = {
        id: 'buyer-org-fallback-1',
        corporateEmail: 'fallback-org@buyer.test',
      };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(account);
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(account);
      const promoted = {
        id: 'v-promoted-real-1',
        masterRecordId: 'vmr-promoted-99',
        name: 'Promoted Master Vendor',
        email: 'promoted@vendor.test',
        buyerAccountId: 'buyer-org-fallback-1',
        majorCategory: 'IT',
      };
      storeService.vendors = [promoted];
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const updDurable = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({
        ...promoted,
        majorCategory: 'Engineering Spares - Mechanical',
      });

      const res = mockRes();
      await vendorController.updateVendor({
        params: { id: 'v-master-vmr-promoted-99' },
        user: { role: 'buyer', email: 'fallback-org@buyer.test' },
        body: { majorCategory: 'Engineering Spares - Mechanical', minorCategories: ['Bearings'] },
      }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(updDurable).toHaveBeenCalledWith('v-promoted-real-1', expect.any(Object));
    });

    test('bulkUpdateVendorStatus handles shared-email v-master records via vendor_master_records without mutating foreign/public vendors and guards zero-update responses', async () => {
      const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
      const buyerUser = { role: 'buyer', email: 'navin@procucev.test', sub: 'u-navin-1', orgId: 'org-navin-1', orgName: 'procucev' };
      const buyerAccount = {
        id: 'buyer-navin-1',
        corporateEmail: 'navin@procucev.test',
        organizationId: 'org-navin-1',
        organizationName: 'procucev',
      };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(buyerAccount);
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyerAccount);

      // Invalid vendors hint shape -> 400
      const invalidHintsRes = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        { user: buyerUser, body: { vendorIds: ['v-1'], isActive: false, vendors: ['bad-entry'] } },
        invalidHintsRes,
        jest.fn()
      );
      expect(invalidHintsRes.status).toHaveBeenCalledWith(400);

      // Unselected vendor remains active; another buyer owns govardhan.kilari@procucev.com in global vendors table
      const otherBuyerVendor = {
        id: 'v-veera-gov-1',
        name: 'Govardhan Solutions pvt LTD',
        email: 'govardhan.kilari@procucev.com',
        buyerId: 'buyer-veera-99',
        source: 'buyer_uploaded',
        isActive: true,
        status: 'ACTIVE',
      };
      const unselectedVendor = storeService.addVendor(
        {
          name: 'Unselected Supplier',
          email: 'unselected@navin.test',
          majorCategory: 'IT',
          minorCategories: ['Networking Equipment'],
          buyerId: buyerAccount.id,
          source: 'buyer_uploaded',
        },
        buyerUser.email,
        buyerAccount.id
      );

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (id, scope) => {
        if (id === 'govardhan.kilari@procucev.com' && scope === 'all') return otherBuyerVendor;
        if (id === 'unowned@public.test') {
          return { id: 'v-pub-1', email: 'unowned@public.test', source: 'self_registered' };
        }
        return null;
      });
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockImplementation(async (recId) => {
        if (recId === 'vmr-chandan') {
          return {
            id: 'vmr-chandan',
            sessionId: 'sess-navin-1',
            companyName: 'Chandan Marketing solutions',
            email: 'chandan.behera@procucev.com',
            vendorCode: 'VC-CH-1',
          };
        }
        if (recId === 'vmr-gov') {
          return {
            id: 'vmr-gov',
            sessionId: 'sess-navin-1',
            companyName: 'Govardhan Solutions pvt LTD',
            email: 'govardhan.kilari@procucev.com',
            vendorCode: 'VC-GOV-1',
          };
        }
        return null;
      });
      const updateMasterSpy = jest
        .spyOn(vendorIngestionQueries, 'updateVendorMasterRecordActiveStatus')
        .mockResolvedValue({
          id: 'vmr-gov',
          companyName: 'Govardhan Solutions pvt LTD',
          email: 'govardhan.kilari@procucev.com',
          isActive: false,
          disabled: true,
          status: 'INACTIVE',
        });

      const bulkMasterRes = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        {
          user: buyerUser,
          body: {
            vendorIds: ['v-master-vmr-chandan', 'v-master-vmr-gov'],
            isActive: false,
            vendors: [
              { id: 'v-master-vmr-chandan', vendorName: 'Chandan Marketing solutions', vendorEmail: 'chandan.behera@procucev.com' },
              { id: 'v-master-vmr-gov', vendorName: 'Govardhan Solutions pvt LTD', vendorEmail: 'govardhan.kilari@procucev.com' },
            ],
          },
        },
        bulkMasterRes,
        jest.fn()
      );
      expect(bulkMasterRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          isActive: false,
          updatedCount: 2,
          skippedIds: [],
          idMappings: expect.objectContaining({
            'v-master-vmr-gov': 'v-master-vmr-gov',
          }),
          data: expect.arrayContaining([
            expect.objectContaining({ name: 'Chandan Marketing solutions', isActive: false, status: 'INACTIVE' }),
            expect.objectContaining({ id: 'v-master-vmr-gov', isActive: false, status: 'INACTIVE' }),
          ]),
        })
      );
      expect(updateMasterSpy).toHaveBeenCalledWith(
        'vmr-gov',
        'org-navin-1',
        expect.objectContaining({ isActive: false, disabled: true, status: 'INACTIVE' })
      );
      // Other buyer's vendor row and unselected buyer vendor remain completely untouched
      expect(otherBuyerVendor.isActive).toBe(true);
      expect(unselectedVendor.status).not.toBe('INACTIVE');

      // Zero updated due to missing IDs -> 404 (not 200 success)
      const bulkZeroNotFound = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        { user: buyerUser, body: { vendorIds: ['missing-a', 'missing-b'], isActive: false } },
        bulkZeroNotFound,
        jest.fn()
      );
      expect(bulkZeroNotFound.status).toHaveBeenCalledWith(404);
      expect(bulkZeroNotFound.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, updatedCount: 0 }));

      // Zero updated due to ownership denial -> 403
      const bulkZeroForbidden = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        {
          user: buyerUser,
          body: {
            vendorIds: ['v-hist-local-pub-0'],
            isActive: false,
            vendors: [{ id: 'v-hist-local-pub-0', vendorEmail: 'unowned@public.test' }],
          },
        },
        bulkZeroForbidden,
        jest.fn()
      );
      expect(bulkZeroForbidden.status).toHaveBeenCalledWith(403);
      expect(bulkZeroForbidden.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, updatedCount: 0 }));

      // Error in syncVendorMasterRecordStatus is caught cleanly and reactivation resets status
      updateMasterSpy.mockRejectedValueOnce(new Error('D1 sync timeout'));
      const singleCollidingReactivate = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: 'v-master-vmr-gov' }, user: buyerUser, body: { isActive: true } },
        singleCollidingReactivate,
        jest.fn()
      );
      expect(singleCollidingReactivate.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'v-master-vmr-gov', isActive: true }),
        })
      );

      // Admin bulk update + buyer-owned email match from vendor_master_records covers remaining ownership/sync branches
      const ownedViaMaster = storeService.addVendor(
        {
          name: 'Master Owned Already',
          email: 'master-owned@navin.test',
          majorCategory: 'IT',
          minorCategories: ['Laptop'],
          buyerId: buyerAccount.id,
          source: 'buyer_uploaded',
        },
        buyerUser.email,
        buyerAccount.id
      );
      vendorIngestionQueries.findVendorMasterRecord.mockResolvedValueOnce({
        id: 'vmr-already-owned',
        companyName: 'Master Owned Already',
        email: 'master-owned@navin.test',
      });
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (lookup) => {
        if (lookup === 'master-owned@navin.test') return ownedViaMaster;
        if (lookup === unselectedVendor.id) return unselectedVendor;
        return null;
      });
      const buyerMatchedRes = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        {
          user: buyerUser,
          body: { vendorIds: ['v-master-vmr-already-owned'], isActive: false },
        },
        buyerMatchedRes,
        jest.fn()
      );
      expect(buyerMatchedRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, updatedCount: 1, updatedIds: [ownedViaMaster.id] })
      );

      const adminBulkRes = mockRes();
      await vendorController.bulkUpdateVendorStatus(
        {
          user: { role: 'admin', email: 'admin@procucev.test' },
          body: { vendorIds: [unselectedVendor.id], isActive: false },
        },
        adminBulkRes,
        jest.fn()
      );
      expect(adminBulkRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, updatedCount: 1 })
      );

      // Single updateVendorStatus edge cases: ownershipDenied (unowned public fallback), non-owner 403, missing master record, and admin reactivation
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation(async (lookup) => {
        if (lookup === 'unowned@public.test') {
          return { id: 'v-pub-1', email: 'unowned@public.test', source: 'self_registered' };
        }
        if (lookup === unselectedVendor.id) return unselectedVendor;
        return null;
      });
      const singlePublicDenied = mockRes();
      await vendorController.updateVendorStatus(
        {
          params: { id: 'v-hist-local-pub-single' },
          user: buyerUser,
          body: { isActive: false, vendorEmail: 'unowned@public.test' },
        },
        singlePublicDenied,
        jest.fn()
      );
      expect(singlePublicDenied.status).toHaveBeenCalledWith(403);

      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(otherBuyerVendor);
      const singleForeignDenied = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: otherBuyerVendor.id }, user: buyerUser, body: { isActive: false } },
        singleForeignDenied,
        jest.fn()
      );
      expect(singleForeignDenied.status).toHaveBeenCalledWith(403);

      const adminSingleReactivate = mockRes();
      await vendorController.updateVendorStatus(
        { params: { id: unselectedVendor.id }, user: { role: 'admin', email: 'admin@procucev.test' }, body: { isActive: true } },
        adminSingleReactivate,
        jest.fn()
      );
      expect(adminSingleReactivate.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ isActive: true }) })
      );
    });
  });
});
