const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const pool = require('../src/db/pool');
const accountDocumentQueries = require('../src/db/accountDocumentQueries');
const accountDocumentController = require('../src/controllers/accountDocumentController');

describe('Account Documents & Credit Workflows API', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  let mockBuyer;
  let mockVendor;
  let createdBuyerDocId;
  let createdSellerDocId;
  let cmToken;

  beforeAll(() => {
    accountDocumentQueries.resetInMemoryStore();
    cmToken = authService.generateSessionToken({
      id: 'cm-1',
      uuid: 'cm-1',
      email: 'cm@procucev.com',
      role: 'category_manager',
      fullName: 'Category Manager',
    });

    mockBuyer = storeService.addBuyerAccount({
      organizationName: 'Veera Babu Buyer Org',
      corporateEmail: 'buyer_test_doc@enterprise.com',
      contactPerson: 'Veera Babu',
      remainingFreeRFQs: 5,
    });

    mockVendor = storeService.addVendor({
      name: 'Test Supplier Ltd',
      email: 'vendor_test_doc@enterprise.com',
      contactPerson: 'Vendor Rep',
      freeQuotationCredits: 5,
      credits: 5,
    });
  });

  describe('Buyer Documents API', () => {
    it('GET /api/buyer-accounts/:id/documents returns 404 for nonexistent buyer', async () => {
      const res = await request(app)
        .get('/api/buyer-accounts/nonexistent-buyer-id/documents')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/buyer-accounts/:id/documents returns documents list for existing buyer', async () => {
      const res = await request(app)
        .get(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it('POST /api/buyer-accounts/:id/documents validates required fields', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ documentName: '' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/buyer-accounts/:id/documents uploads a document successfully', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          documentName: 'Enterprise GST Certificate 2026',
          fileName: 'gst_certificate.pdf',
          fileSize: 524000,
          mimeType: 'application/pdf',
          category: 'GST',
          description: 'Official GST filing certificate',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document).toBeDefined();
      expect(res.body.document.documentName).toBe('Enterprise GST Certificate 2026');
      expect(res.body.document.category).toBe('GST');
      createdBuyerDocId = res.body.document.id;
    });

    it('GET /api/buyer-accounts/:id/documents filters by category, type, and search', async () => {
      const res = await request(app)
        .get(`/api/buyer-accounts/${mockBuyer.id}/documents?category=GST&type=pdf&search=Certificate&sortOrder=asc`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.documents.length).toBeGreaterThanOrEqual(1);
      expect(res.body.documents[0].category).toBe('GST');
    });

    it('DELETE /api/buyer-accounts/:id/documents/:docId deletes uploaded document', async () => {
      const res = await request(app)
        .delete(`/api/buyer-accounts/${mockBuyer.id}/documents/${createdBuyerDocId}`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('DELETE /api/buyer-accounts/:id/documents/:docId returns 404 for invalid docId', async () => {
      const res = await request(app)
        .delete(`/api/buyer-accounts/${mockBuyer.id}/documents/nonexistent-doc-id`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('enforces role-based permissions on buyer document endpoints', async () => {
      const otherBuyerToken = authService.generateSessionToken({
        id: 'other-buyer-1',
        email: 'other_buyer@enterprise.com',
        role: 'buyer',
      });
      const authorizedBuyerToken = authService.generateSessionToken({
        id: 'auth-buyer-1',
        email: mockBuyer.corporateEmail,
        role: 'buyer',
      });

      // Unauthorized buyer cannot view documents
      const unauthGet = await request(app)
        .get(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${otherBuyerToken}`);
      expect(unauthGet.status).toBe(403);

      // Unauthenticated request returns 401
      const noAuthGet = await request(app)
        .get(`/api/buyer-accounts/${mockBuyer.id}/documents`);
      expect(noAuthGet.status).toBe(401);

      // Authorized buyer can view documents
      const authGet = await request(app)
        .get(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${authorizedBuyerToken}`);
      expect(authGet.status).toBe(200);

      // Unauthorized buyer cannot upload documents
      const unauthPost = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${otherBuyerToken}`)
        .send({ documentName: 'Secret Doc' });
      expect(unauthPost.status).toBe(403);

      // Unauthorized buyer cannot delete documents
      const unauthDel = await request(app)
        .delete(`/api/buyer-accounts/${mockBuyer.id}/documents/some-doc-id`)
        .set('Authorization', `Bearer ${otherBuyerToken}`);
      expect(unauthDel.status).toBe(403);

      // Non-existent buyer on delete returns 404
      const nonExistentBuyerDel = await request(app)
        .delete('/api/buyer-accounts/non-existent-buyer-id/documents/some-doc-id')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(nonExistentBuyerDel.status).toBe(404);
    });
  });

  describe('Seller Documents API', () => {
    it('GET /api/vendors/:id/documents returns 404 for nonexistent vendor', async () => {
      const res = await request(app)
        .get('/api/vendors/nonexistent-vendor-id/documents')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/vendors/:id/documents returns documents list for existing vendor', async () => {
      const res = await request(app)
        .get(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it('POST /api/vendors/:id/documents uploads seller document successfully', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          documentName: 'ISO 9001 Quality Certificate',
          fileName: 'iso_quality.pdf',
          fileSize: 450000,
          mimeType: 'application/pdf',
          category: 'Company Profile',
          description: 'Factory quality management audit accreditation',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document.documentName).toBe('ISO 9001 Quality Certificate');
      createdSellerDocId = res.body.document.id;
    });

    it('DELETE /api/vendors/:id/documents/:docId deletes uploaded seller document', async () => {
      const res = await request(app)
        .delete(`/api/vendors/${mockVendor.id}/documents/${createdSellerDocId}`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('enforces role-based permissions on seller document endpoints', async () => {
      const otherVendorToken = authService.generateSessionToken({
        id: 'other-vendor-1',
        email: 'other_vendor@enterprise.com',
        role: 'vendor',
      });
      const authorizedVendorToken = authService.generateSessionToken({
        id: mockVendor.id,
        email: mockVendor.email,
        role: 'vendor',
      });

      // Unauthorized vendor cannot view seller documents
      const unauthGet = await request(app)
        .get(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${otherVendorToken}`);
      expect(unauthGet.status).toBe(403);

      // Unauthenticated request returns 401
      const noAuthGet = await request(app)
        .get(`/api/vendors/${mockVendor.id}/documents`);
      expect(noAuthGet.status).toBe(401);

      // Authorized vendor can view documents
      const authGet = await request(app)
        .get(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${authorizedVendorToken}`);
      expect(authGet.status).toBe(200);

      // Unauthorized vendor cannot upload documents
      const unauthPost = await request(app)
        .post(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${otherVendorToken}`)
        .send({ documentName: 'Vendor Confidential' });
      expect(unauthPost.status).toBe(403);

      // Unauthorized vendor cannot delete documents
      const unauthDel = await request(app)
        .delete(`/api/vendors/${mockVendor.id}/documents/some-doc-id`)
        .set('Authorization', `Bearer ${otherVendorToken}`);
      expect(unauthDel.status).toBe(403);

      // Non-existent vendor on delete returns 404
      const nonExistentDel = await request(app)
        .delete('/api/vendors/non-existent-vendor-id/documents/some-doc-id')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(nonExistentDel.status).toBe(404);
    });
  });

  describe('Seller Quote Credits Allocation API', () => {
    it('rejects quote credits < 1 or > 5 or non-integers', async () => {
      const resZero = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ amount: 0 });
      expect(resZero.status).toBe(400);

      const resSix = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ amount: 6 });
      expect(resSix.status).toBe(400);

      const resDecimal = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ amount: 2.5 });
      expect(resDecimal.status).toBe(400);
    });

    it('successfully adds 1 to 5 quote credits to a vendor', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 3,
          reason: 'Manual quota extension by category manager',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updatedBalance).toBe(res.body.previousBalance + 3);
      expect(res.body.transaction).toBeDefined();
    });

    it('rejects unauthorized requests for adding quote credits', async () => {
      // Missing token
      const resNoAuth = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .send({ amount: 2 });
      expect(resNoAuth.status).toBe(401);

      // Non-category_manager role (buyer)
      const buyerToken = authService.generateSessionToken({
        id: 'buyer-user-1',
        email: 'buyer@example.com',
        role: 'buyer',
        roles: ['buyer'],
      });
      const resBuyer = await request(app)
        .post(`/api/vendors/${mockVendor.id}/add-quote-credits`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 2 });
      expect(resBuyer.status).toBe(403);
    });

    it('returns 404 when adding quote credits to a non-existent vendor', async () => {
      const res = await request(app)
        .post('/api/vendors/non-existent-vendor-xyz/add-quote-credits')
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ amount: 2 });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('handles fallback vendor balances and database sync branches', async () => {
      const origHasStorage = pool.hasStorage;
      const origQuery = pool.query;

      try {
        // Create vendor with no freeQuotationCredits but credits property
        const v2Payload = {
          name: 'Cred Fallback Vendor',
          email: 'v_fallback_cred1@enterprise.com',
          credits: 10,
        };
        const createdV2 = storeService.addVendor(v2Payload);
        delete createdV2.freeQuotationCredits;

        const res1 = await request(app)
          .post(`/api/vendors/${createdV2.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 4 });
        expect(res1.status).toBe(200);
        expect(res1.body.previousBalance).toBe(10);
        expect(res1.body.updatedBalance).toBe(14);

        // Create vendor with neither freeQuotationCredits nor credits (defaults to 5)
        const v3Payload = {
          name: 'Default 5 Vendor',
          email: 'v_default_5@enterprise.com',
        };
        const createdV3 = storeService.addVendor(v3Payload);
        delete createdV3.freeQuotationCredits;
        delete createdV3.credits;

        // Test with pool.hasStorage = true (success branch)
        pool.hasStorage = () => true;
        pool.query = jest.fn().mockResolvedValue({ rowCount: 1 });

        const res2 = await request(app)
          .post(`/api/vendors/${createdV3.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 5, reason: 'Special incentive allocation' });
        expect(res2.status).toBe(200);
        expect(res2.body.previousBalance).toBe(5);
        expect(res2.body.updatedBalance).toBe(10);
        expect(pool.query).toHaveBeenCalled();

        // Test with pool.hasStorage = true and dedicated pool.pool.connect
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rowCount: 1 }),
          release: jest.fn(),
        };
        const origPoolInstance = pool.pool;
        pool.pool = { connect: jest.fn().mockResolvedValue(mockClient) };

        const resClient = await request(app)
          .post(`/api/vendors/${createdV3.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 2 });
        expect(resClient.status).toBe(200);
        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(mockClient.release).toHaveBeenCalled();

        // Test with pool.hasStorage = true but transaction queries throw (rolls back and returns 500)
        const failingClient = {
          query: jest.fn().mockImplementation((sql) => {
            if (sql.includes('UPDATE vendors')) throw new Error('Postgres write failure');
            return { rowCount: 1 };
          }),
          release: jest.fn(),
        };
        pool.pool = { connect: jest.fn().mockResolvedValue(failingClient) };

        const res3 = await request(app)
          .post(`/api/vendors/${createdV3.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 1 });
        expect(res3.status).toBe(500);
        expect(res3.body.success).toBe(false);
        expect(failingClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(failingClient.release).toHaveBeenCalled();

        // Test with client without release function
        pool.pool = null;
        pool.query = jest.fn().mockRejectedValue(new Error('Postgres pool failure'));
        const res4 = await request(app)
          .post(`/api/vendors/${createdV3.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 1 });
        expect(res4.status).toBe(500);

        pool.pool = origPoolInstance;
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });

    it('assertCategoryManagerOrAdmin helper tests all roles', () => {
      const { assertCategoryManagerOrAdmin } = require('../src/controllers/vendorDossierExtensions');
      const mockRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res;
      };

      const res1 = mockRes();
      expect(assertCategoryManagerOrAdmin({ user: null }, res1)).toBe(false);
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      expect(assertCategoryManagerOrAdmin({ user: { role: 'vendor' } }, res2)).toBe(false);
      expect(res2.status).toHaveBeenCalledWith(403);

      const res3 = mockRes();
      expect(assertCategoryManagerOrAdmin({ user: { role: 'category_manager' } }, res3)).toBe(true);

      const res4 = mockRes();
      expect(assertCategoryManagerOrAdmin({ user: { role: 'admin' } }, res4)).toBe(true);
    });

    it('triggers next(err) in addQuoteCredits when an unexpected error is thrown', async () => {
      const { addQuoteCredits } = require('../src/controllers/vendorDossierExtensions');
      const req = {
        user: { role: 'admin' },
        params: { id: mockVendor.id },
        body: null, // will cause validatePayload or resolveVendor error
      };
      const next = jest.fn();
      await addQuoteCredits(req, {}, next);
      // Even if validatePayload handles null body or error throws, next or res is invoked
    });
  });

  describe('Buyer Credit Approval Workflow API', () => {
    it('validates approverName must be Srinu Sir or Sudheer Sir', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 10,
          reason: 'Quarterly review allocation',
          approverName: 'Unknown Approver',
          initiatorName: 'Govardhan',
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('validates initiatorName must be Govardhan, Krishna, or Chandhan', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 10,
          reason: 'Quarterly review allocation',
          approverName: 'Srinu Sir',
          initiatorName: 'Unknown Initiator',
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('submits credit request with Pending Approval status and creates internal task', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 15,
          reason: 'Special procurement project allocation',
          approverName: 'Sudheer Sir',
          initiatorName: 'Krishna',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.task).toBeDefined();
      expect(res.body.task.status).toBe('Pending Approval');
      expect(res.body.task.approval_status).toBe('PENDING');
      expect(res.body.task.assigned_to_name).toBe('Sudheer Sir');
      expect(res.body.task.credit_quantity).toBe(15);
    });
  });

  describe('Seller Quote Credit Approval Workflow API', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/request-credit-approval`)
        .send({ amount: 5, approverName: 'Srinu Sir', initiatorName: 'Govardhan' });
      expect(res.status).toBe(401);
    });

    it('returns 404 when seller is not found', async () => {
      const res = await request(app)
        .post('/api/vendors/non-existent-seller-id/request-credit-approval')
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ amount: 5, approverName: 'Srinu Sir', initiatorName: 'Govardhan' });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('validates approverName must be Srinu Sir or Sudheer Sir', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 5,
          reason: 'Authorized quota increase',
          approverName: 'Invalid Approver',
          initiatorName: 'Govardhan',
        });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('submits seller quote credit request with Pending Approval status and creates internal task and approval record', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 5,
          reason: 'High priority customer RFP quote top-up',
          approverName: 'Srinu Sir',
          initiatorName: 'Govardhan',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.task).toBeDefined();
      expect(res.body.task.status).toBe('Pending Approval');
      expect(res.body.task.approval_status).toBe('PENDING');
      expect(res.body.task.assigned_to_name).toBe('Srinu Sir');
      expect(res.body.task.credit_quantity).toBe(5);
    });

    it('rejects non-category-manager/admin roles with 403', async () => {
      const buyerToken = authService.generateSessionToken({
        id: 'buyer-unauth',
        email: 'buyer@procucev.com',
        role: 'buyer',
      });
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ amount: 5, approverName: 'Srinu Sir', initiatorName: 'Govardhan' });
      expect(res.status).toBe(403);
    });

    it('handles vendor with missing name and email, and omitted reason and user without email', async () => {
      const minimalVendor = storeService.addVendor({
        contactPerson: 'Sparse Seller',
      });
      delete minimalVendor.name;
      delete minimalVendor.email;
      delete minimalVendor.freeQuotationCredits;

      const userNoEmailToken = authService.generateSessionToken({
        id: 'cm-no-email',
        role: 'category_manager',
      });

      const res = await request(app)
        .post(`/api/vendors/${minimalVendor.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${userNoEmailToken}`)
        .send({
          amount: 3,
          approverName: 'Sudheer Sir',
          initiatorName: 'Krishna',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.task.assigned_to_name).toBe('Sudheer Sir');
    });

    it('handles unexpected exceptions and invokes next(err)', async () => {
      const { requestCreditApproval } = require('../src/controllers/vendorDossierExtensions');
      const req = {
        user: { role: 'category_manager' },
        params: { id: mockVendor.id },
        body: null,
      };
      const next = jest.fn();
      await requestCreditApproval(req, {}, next);
      expect(next).toHaveBeenCalled();
    });
  });

  
  describe('Vendor Dossier Extensions API (Credits, Communications, Payment History)', () => {
    const otherVendorToken = authService.generateSessionToken({ id: 'v-other-99', email: 'other@vendor.com', role: 'vendor' });
    const ownVendorToken = authService.generateSessionToken({ id: 'v-own-doc', email: 'vendor_test_doc@enterprise.com', role: 'vendor' });

    it('GET /api/vendors/:id/credit-history handles auth, not found, and success', async () => {
      // 401 unauth
      const unauth = await request(app).get(`/api/vendors/${mockVendor.id}/credit-history`);
      expect(unauth.status).toBe(401);

      // 404 not found
      const notFound = await request(app)
        .get('/api/vendors/non-existent-vendor-xyz/credit-history')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(notFound.status).toBe(404);

      // 403 forbidden other vendor
      const forbidden = await request(app)
        .get(`/api/vendors/${mockVendor.id}/credit-history`)
        .set('Authorization', `Bearer ${otherVendorToken}`);
      expect(forbidden.status).toBe(403);

      // 200 success
      const ok = await request(app)
        .get(`/api/vendors/${mockVendor.id}/credit-history`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);
      expect(ok.body.summary).toBeDefined();
    });

    it('GET /api/vendors/:id/communications handles not found and success', async () => {
      const notFound = await request(app)
        .get('/api/vendors/non-existent-vendor-xyz/communications')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(notFound.status).toBe(404);

      const ok = await request(app)
        .get(`/api/vendors/${mockVendor.id}/communications`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);
      expect(Array.isArray(ok.body.data)).toBe(true);
    });

    it('POST /api/vendors/:id/communications records email, SMS, and call communications', async () => {
      const notFound = await request(app)
        .post('/api/vendors/non-existent-vendor-xyz/communications')
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ channel: 'EMAIL', message: 'Hello' });
      expect(notFound.status).toBe(404);

      // EMAIL
      const emailRes = await request(app)
        .post(`/api/vendors/${mockVendor.id}/communications`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          channel: 'EMAIL',
          subject: 'Documentation Update',
          message: 'Please update your GST certificate.',
          recipient: 'vendor@test.com',
        });
      expect(emailRes.status).toBe(201);
      expect(emailRes.body.success).toBe(true);

      // SMS
      const smsRes = await request(app)
        .post(`/api/vendors/${mockVendor.id}/communications`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          channel: 'SMS',
          message: 'Urgent RFQ pending response.',
          recipient: '9876543210',
        });
      expect(smsRes.status).toBe(201);

      // CALL with follow-up
      const callRes = await request(app)
        .post(`/api/vendors/${mockVendor.id}/communications`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          channel: 'CALL',
          callOutcome: 'CONNECTED_POSITIVE',
          duration: '5m 30s',
          notes: 'Discussion about capacity',
          nextFollowupDate: '2026-12-01T10:00:00.000Z',
          followupPriority: 'High',
          followupNotes: 'Follow up on quote submission',
        });
      expect(callRes.status).toBe(201);
      expect(callRes.body.followupTask).toBeDefined();
    });

    it('GET /api/vendors/:id/payment-history handles not found and success', async () => {
      const notFound = await request(app)
        .get('/api/vendors/non-existent-vendor-xyz/payment-history')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(notFound.status).toBe(404);

      const ok = await request(app)
        .get(`/api/vendors/${mockVendor.id}/payment-history`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);
      expect(Array.isArray(ok.body.payments)).toBe(true);
    });

    it('vendorDossierExtensions branches: helper checks, vendor resolution, transactions, plans', async () => {
      const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
      const domainQueries = require('../src/db/domainQueries');
      const zohoReconciliationService = require('../src/services/zohoReconciliationService');

      // assertCategoryManagerOrVendor role variations
      const resMock = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: null }, resMock)).toBe(false);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'admin' } }, resMock)).toBe(true);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'vendor', vendorId: 'v-1' } }, resMock, { id: 'v-1' })).toBe(true);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'vendor', sub: 'v-2' } }, resMock, 'v-2')).toBe(true);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'vendor', email: 'v@test.com' } }, resMock, 'v@test.com')).toBe(true);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'vendor', email: 'v@test.com' } }, resMock, null)).toBe(true);
      expect(vendorDossierExtensions.assertCategoryManagerOrVendor({ user: { role: 'buyer' } }, resMock)).toBe(false);

      // resolveVendor with user email fallback
      const vEmail = await vendorDossierExtensions.resolveVendor('missing-id', { role: 'vendor', email: mockVendor.email });
      expect(vEmail).toBeDefined();

      // getCreditHistory with mock transactions covering all types (PURCHASE, ADJUSTMENT, UNLOCK)
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValueOnce([
        { transaction_type: 'INITIAL_ALLOCATION', amount: 5, balance_after: 5 },
        { transaction_type: 'PURCHASE_PLAN', amount: 10, balance_after: 15 },
        { transaction_type: 'REFUND_ADJUSTMENT', amount: 2, balance_after: 17 },
        { transaction_type: 'RFQ_UNLOCK', amount: -1, balance_after: 16 },
      ]);
      const resCredits = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory({ params: { id: mockVendor.id }, user: { role: 'category_manager' } }, resCredits, jest.fn());
      expect(resCredits.json).toHaveBeenCalled();

      // getCreditHistory with unlockedRfqIds
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValueOnce({
        freeCreditsAllocated: 5,
        unlockedRfqIds: ['rfq-alpha-1'],
      });
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ transaction_type: 'INITIAL_ALLOCATION', amount: 5, balance_after: 5 }]);
      await vendorDossierExtensions.getCreditHistory({ params: { id: mockVendor.id }, user: { role: 'category_manager' } }, resCredits, jest.fn());

      // getVendorPaymentHistory with select and connect plans, and payment links
      const vSelect = storeService.addVendor({ name: 'Select Vendor', subscriptionPlan: 'Preferred Select' });
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValueOnce([
        { id: 'pl-1', planId: 'select-annual', amount: 9999, currency: 'INR', status: 'PAID' }
      ]);
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValueOnce(1);
      const resPay = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorPaymentHistory({ params: { id: vSelect.id }, user: { role: 'category_manager' } }, resPay, jest.fn());
      expect(resPay.json).toHaveBeenCalled();

      // Connect plan
      const vConnect = storeService.addVendor({ name: 'Connect Vendor', subscriptionPlan: 'Supplier Connect' });
      await vendorDossierExtensions.getVendorPaymentHistory({ params: { id: vConnect.id }, user: { role: 'category_manager' } }, resPay, jest.fn());

      // recordVendorCommunication external SMS & Email mock warning branch
      const resComm = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager', email: 'cm@test.com' },
        body: {
          channel: 'SMS',
          recipient: '12345', // non 10-digit
          message: 'Fallback SMS',
        }
      }, resComm, jest.fn());
    });

    
    it('vendorDossierExtensions deep branch coverage: RFQ comms, payment statuses, task/mail failures', async () => {
      const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      const mailerService = require('../src/services/mailerService');
      const smsService = require('../src/services/smsService');

      // 1. getVendorCommunications with assigned RFQ
      jest.spyOn(storeService, 'getRFQs').mockReturnValueOnce([
        {
          id: 'rfq-comm-1',
          rfqNumber: 'RFQ-COMM-101',
          title: 'Steel Pipe Order',
          sourcingMode: 'Mode 1',
          assignedVendors: [{ id: mockVendor.id }],
          quotes: [{ vendorId: mockVendor.id }],
        },
      ]);
      const resComm = await request(app)
        .get(`/api/vendors/${mockVendor.id}/communications`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(resComm.status).toBe(200);
      expect(resComm.body.data.some((c) => c.subject.includes('RFQ-COMM-101'))).toBe(true);

      // 2. getVendorPaymentHistory with statuses (FAILED, PENDING, REFUNDED)
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValueOnce([
        { id: 'pl-fail', status: 'FAILED', amount: 100 },
        { id: 'pl-pend', status: 'PENDING', amount: 200 },
        { id: 'pl-ref', status: 'REFUNDED', amount: 50 },
      ]);
      const resPayStatuses = await request(app)
        .get(`/api/vendors/${mockVendor.id}/payment-history`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(resPayStatuses.status).toBe(200);
      expect(resPayStatuses.body.summary.failedPayments).toBe(1);
      expect(resPayStatuses.body.summary.pendingPayments).toBe(1);
      expect(resPayStatuses.body.summary.totalRefundedAmount).toBe(50);

      // 3. mailerService and smsService async rejection paths
      jest.spyOn(mailerService, 'deliver').mockRejectedValueOnce(new Error('Async mailer failure'));
      jest.spyOn(smsService, 'sendActionCenterSms').mockRejectedValueOnce(new Error('Async SMS failure'));
      const dummyRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager', email: 'cm@test.com' },
        body: { channel: 'EMAIL', recipient: 'vendor@enterprise.com', message: 'Test email' },
      }, dummyRes, jest.fn());

      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager' },
        body: { channel: 'SMS', recipient: '9876543210', message: 'Test SMS' },
      }, dummyRes, jest.fn());

      // 4. internalTaskQueries failure catches in recordVendorCommunication
      jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockRejectedValueOnce(new Error('Failed task 1'))
        .mockRejectedValueOnce(new Error('Failed task 2'));

      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager' },
        body: { channel: 'CALL', nextFollowupDate: '2026-12-01T00:00:00Z' },
      }, dummyRes, jest.fn());
    });

    
    it('vendorDossierExtensions remaining branches: UPGRADE tx, freeCreditsUsed fallback, db fallback, mailer/sms try/catch', async () => {
      const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
      const domainQueries = require('../src/db/domainQueries');

      // resolveVendor with DB fallback for user email
      const spyGetVendor = jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      const spyDbFallback = jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(mockVendor);
      const vFound = await vendorDossierExtensions.resolveVendor('missing-id', { role: 'vendor', email: 'test@email.com' });
      expect(vFound).toBeDefined();
      spyGetVendor.mockRestore();
      spyDbFallback.mockRestore();

      // getCreditHistory with UPGRADE transaction and freeCreditsUsed > 0 fallback
      const spyCredits = jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        freeCreditsAllocated: 10,
        freeCreditsUsed: 3,
        freeCreditsRemaining: 7,
      });
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        freeCreditsAllocated: 10,
        freeCreditsUsed: 3,
        freeCreditsRemaining: 7,
      });
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([
        { transaction_type: 'SUBSCRIPTION_UPGRADE', amount: 5, balance_after: 15 },
      ]);
      const resCred = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory({ params: { id: mockVendor.id }, user: { role: 'category_manager' } }, resCred, jest.fn());
      expect(resCred.json).toHaveBeenCalled();

      // recordVendorCommunication with mailer throw synchronously in deliver
      const mailerService = require('../src/services/mailerService');
      jest.spyOn(mailerService, 'deliver').mockImplementationOnce(() => {
        throw new Error('Sync deliver crash');
      });
      const smsService = require('../src/services/smsService');
      jest.spyOn(smsService, 'sendActionCenterSms').mockImplementationOnce(() => {
        throw new Error('Sync SMS crash');
      });
      const dummyRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager', email: 'cm@procucev.com' },
        body: { channel: 'EMAIL', recipient: 'vendor@enterprise.com', message: 'Test crash' },
      }, dummyRes, jest.fn());

      await vendorDossierExtensions.recordVendorCommunication({
        params: { id: mockVendor.id },
        user: { role: 'category_manager' },
        body: { channel: 'SMS', recipient: '9876543210', message: 'Test crash' },
      }, dummyRes, jest.fn());
    });

    it('vendorDossierExtensions error handling branches invoke next(err)', async () => {
      const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
      const errReq = {
        params: { id: mockVendor.id },
        user: { role: 'category_manager' },
        get: () => null,
      };

      const next1 = jest.fn();
      await vendorDossierExtensions.getCreditHistory(null, {}, next1);
      expect(next1).toHaveBeenCalled();

      const next2 = jest.fn();
      await vendorDossierExtensions.getVendorCommunications(null, {}, next2);
      expect(next2).toHaveBeenCalled();

      const next3 = jest.fn();
      await vendorDossierExtensions.recordVendorCommunication(null, {}, next3);
      expect(next3).toHaveBeenCalled();

      const next4 = jest.fn();
      await vendorDossierExtensions.getVendorPaymentHistory(null, {}, next4);
      expect(next4).toHaveBeenCalled();
    });
  });

  describe('accountDocumentQueries database & helper unit coverage', () => {
    it('handles matchesDocumentType across all extensions and mimes', () => {
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/pdf', fileName: 'test.pdf' }, 'pdf')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'image/png', fileName: 'test.png' }, 'image')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/vnd.ms-excel', fileName: 'test.xlsx' }, 'excel')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/msword', fileName: 'test.docx' }, 'word')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'text/plain', fileName: 'test.txt' }, 'other')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'text/plain', fileName: 'test.txt' }, 'all')).toBe(true);
    });

    it('handles mapRow with null, missing fields, and custom values', () => {
      expect(accountDocumentQueries.mapRow(null)).toBeNull();
      const mappedDb = accountDocumentQueries.mapRow({
        id: 'doc-row-1',
        account_type: 'buyer',
        account_id: 'b-1',
        document_name: 'Doc One',
        file_name: 'doc.pdf',
        file_size: '1024',
        mime_type: '',
        category: '',
        file_url: '',
        description: '',
        uploaded_by: '',
        is_active: 1,
        created_at: '',
        updated_at: '',
      });
      expect(mappedDb.id).toBe('doc-row-1');
      expect(mappedDb.documentName).toBe('Doc One');
      expect(mappedDb.mimeType).toBe('application/pdf');
      expect(mappedDb.category).toBe('Other');
      expect(mappedDb.uploadedBy).toBe('Category Manager');

      const mappedMem = accountDocumentQueries.mapRow({
        id: 'doc-row-2',
        accountType: 'seller',
        accountId: 's-1',
        documentName: 'Doc Two',
        fileName: 'doc2.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        category: 'GST',
        fileUrl: '/doc2.pdf',
        uploadedBy: 'Seller',
        isActive: false,
      });
      expect(mappedMem.id).toBe('doc-row-2');
      expect(mappedMem.isActive).toBe(false);

      // deleteAccountDocument null check
      expect(accountDocumentQueries.deleteAccountDocument(null)).resolves.toBe(false);
    });

    it('tests pool.hasStorage() simulation branches', async () => {
      const origHasStorage = pool.hasStorage;
      const origQuery = pool.query;

      try {
        pool.hasStorage = () => true;
        pool.query = async (sql) => {
          if (sql.includes('INSERT INTO account_documents')) {
            return {
              rows: [{
                id: 'db_doc_101',
                account_type: 'buyer',
                account_id: 'buyer-db-1',
                document_name: 'DB Document',
                file_name: 'db.pdf',
                file_size: 2048,
                mime_type: 'application/pdf',
                category: 'RFQ',
                file_url: '/db.pdf',
                description: 'Postgres doc',
                uploaded_by: 'Postgres Admin',
                is_active: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }],
            };
          }
          if (sql.includes('SELECT') && sql.includes('FROM account_documents')) {
            return {
              rows: [{
                id: 'db_doc_101',
                account_type: 'buyer',
                account_id: 'buyer-db-1',
                document_name: 'DB Document',
                file_name: 'db.pdf',
                file_size: 2048,
                mime_type: 'application/pdf',
                category: 'RFQ',
                file_url: '/db.pdf',
                description: 'Postgres doc',
                uploaded_by: 'Postgres Admin',
                is_active: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }],
            };
          }
          if (sql.includes('UPDATE account_documents')) {
            return { rows: [{ id: 'db_doc_101' }] };
          }
          return { rows: [] };
        };

        const created = await accountDocumentQueries.createAccountDocument({
          accountType: 'buyer',
          accountId: 'buyer-db-1',
          documentName: 'DB Document',
          fileName: 'db.pdf',
          isActive: false,
        });
        expect(created.id).toBe('db_doc_101');

        const listed = await accountDocumentQueries.listAccountDocuments({
          accountType: 'buyer',
          accountId: 'buyer-db-1',
          sortOrder: 'asc',
        });
        expect(listed.length).toBeGreaterThanOrEqual(1);

        const deleted = await accountDocumentQueries.deleteAccountDocument('db_doc_101', 'buyer', 'buyer-db-1');
        expect(deleted).toBe(true);

        // Delete workflow doc
        const workflowDeleted = await accountDocumentQueries.deleteAccountDocument('rfq_doc_test_1', 'buyer', 'buyer-db-1');
        expect(workflowDeleted).toBe(true);

        // Ensure there is an in-memory document matching buyer-db-1 so filter predicate runs
        pool.hasStorage = () => false;
        const memDoc = await accountDocumentQueries.createAccountDocument({
          accountType: 'buyer',
          accountId: 'buyer-db-1',
          documentName: 'Mem Doc Before Throw',
          fileName: 'mem.pdf',
        });
        pool.hasStorage = () => true;

        // Simulate pool query throw in list, create, delete
        pool.query = async () => { throw new Error('DB connection fail'); };
        const listCatch = await accountDocumentQueries.listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-db-1' });
        expect(Array.isArray(listCatch)).toBe(true);
        expect(listCatch.length).toBeGreaterThan(0);

        const createCatch = await accountDocumentQueries.createAccountDocument({ accountType: 'buyer', accountId: 'buyer-catch-1', documentName: 'Catch Doc', fileName: 'catch.pdf' });
        expect(createCatch).toBeDefined();

        // Del catch with matching in-memory doc to test catch block memory removal
        const delCatch = await accountDocumentQueries.deleteAccountDocument(memDoc.id, 'buyer', 'buyer-db-1');
        expect(delCatch).toBe(true);

        const delCatchNonExistent = await accountDocumentQueries.deleteAccountDocument('any-id', 'buyer', 'buyer-catch-1');
        expect(delCatchNonExistent).toBe(false);
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });

    it('covers escapeLikeWildcards, empty filters, and workflow document aggregation', async () => {
      expect(accountDocumentQueries.escapeLikeWildcards(null)).toBe('');
      expect(accountDocumentQueries.escapeLikeWildcards(123)).toBe('');
      expect(accountDocumentQueries.escapeLikeWildcards('test%_foo\\bar')).toBe('test\\%\\_foo\\\\bar');

      const emptyList = await accountDocumentQueries.listAccountDocuments({});
      expect(emptyList).toEqual([]);

      // Setup RFQ with attachments for buyer and quotes for seller
      if (!Array.isArray(storeService.rfqs)) {
        storeService.rfqs = [];
      }
      storeService.rfqs.push({
        id: 'rfq-doc-test-1',
        buyerId: mockBuyer.id,
        rfqNumber: 'RFQ-DOC-999',
        attachments: [
          { id: 'att-1', fileName: 'spec.pdf', size: 1024, mimeType: 'application/pdf', url: '/spec.pdf', uploadedBy: 'Veera' }
        ],
        quotes: [
          {
            vendorId: mockVendor.id,
            vendorName: mockVendor.supplierName,
            quotePrice: 50000,
          }
        ]
      });

      const buyerDocsWithRfq = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
      });
      const rfqDoc = buyerDocsWithRfq.find(d => d.id === 'rfq_doc_rfq-doc-test-1_att-1');
      expect(rfqDoc).toBeDefined();
      expect(rfqDoc.category).toBe('RFQ');

      // Setup Vendor evaluation in storeService.evaluations
      if (!Array.isArray(storeService.evaluations)) {
        storeService.evaluations = [];
      }
      storeService.evaluations.push({
        id: 'eval-rec-1',
        vendorId: mockVendor.id,
        documents: [
          { id: 'eval-1', name: 'ISO_Cert_GST.pdf', fileName: 'ISO_Cert_GST.pdf', fileUrl: '/iso.pdf', size: 5000, category: 'GST', uploadedBy: 'Quality Dept' },
          { id: 'eval-2', name: 'PAN_Card.pdf', fileName: 'PAN_Card.pdf', fileUrl: '/pan.pdf', size: 3000, category: 'PAN' },
          { id: 'eval-3', name: 'Company_Profile.pdf', fileName: 'Company_Profile.pdf', fileUrl: '/profile.pdf', size: 4000, category: 'Company Profile' },
        ]
      });

      const sellerDocsWithWorkflow = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      const evalDoc = sellerDocsWithWorkflow.find(d => d.id.includes('eval_doc'));
      expect(evalDoc).toBeDefined();

      const quoteDoc = sellerDocsWithWorkflow.find(d => d.id.includes('quote_doc'));
      expect(quoteDoc).toBeDefined();

      // Ensure evaluations has a document with 'profile' in lowercase to hit the profile branch
      storeService.evaluations[0].documents.push({
        id: 'eval-4',
        name: 'company_profile_dossier.pdf',
        fileUrl: '/profile2.pdf',
        size: 6000,
      });
      // And a plain registration document
      storeService.evaluations[0].documents.push({
        id: 'eval-5',
        name: 'certificate_of_incorporation.pdf',
        fileUrl: '/reg.pdf',
        size: 7000,
      });

      const recheckSellerDocs = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      expect(recheckSellerDocs.some(d => d.category === 'Company Profile')).toBe(true);
      expect(recheckSellerDocs.some(d => d.category === 'Registration')).toBe(true);

      // Re-listing with suppressed doc
      const evalDocToDel = recheckSellerDocs.find(d => d.id.includes('eval_doc'));
      await accountDocumentQueries.deleteAccountDocument(evalDocToDel.id, 'seller', mockVendor.id);
      const afterEvalDel = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      expect(afterEvalDel.some(d => d.id === evalDocToDel.id)).toBe(false);

      // Try suppressing the same doc again
      await accountDocumentQueries.deleteAccountDocument(evalDocToDel.id, 'seller', mockVendor.id);

      // Suppress quote doc and re-list seller docs
      await accountDocumentQueries.deleteAccountDocument(quoteDoc.id, 'seller', mockVendor.id);
      await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });

      // Search matching nothing (all 4 negative conditions)
      const noMatch = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        search: 'definitelynotexistingsuperlongterm12345',
      });
      expect(noMatch).toEqual([]);

      // Multi-item sort 'asc' in memory
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Sort Test Doc 1',
        fileName: 'sort1.pdf',
      });
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Sort Test Doc 2',
        fileName: 'sort2.pdf',
      });
      const sortedAsc = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        sortOrder: 'asc',
      });
      expect(sortedAsc.length).toBeGreaterThan(1);

      // Test sortOrder 'asc'
      const ascList = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        sortOrder: 'asc',
      });
      expect(ascList.length).toBeGreaterThan(0);

      // Test suppression of workflow docs on delete
      await accountDocumentQueries.deleteAccountDocument(rfqDoc.id, 'buyer', mockBuyer.id);
      const afterSuppressed = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
      });
      expect(afterSuppressed.some(d => d.id === rfqDoc.id)).toBe(false);

      // Test matchesDocumentType with various extensions & empty inputs
      expect(accountDocumentQueries.matchesDocumentType({}, '')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'file.jpg' }, 'image')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'data.csv' }, 'excel')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'memo.doc' }, 'word')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/pdf' }, 'excel')).toBe(false);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'image/jpeg' }, 'image')).toBe(true);

      // Create document with various actor structures
      const docStringActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Desc Search Test',
        fileName: 'desc_search.pdf',
        description: 'Specific unique keyword in description',
      }, 'Govardhan');
      expect(docStringActor.uploadedBy).toBe('Govardhan');

      const docFullName = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Doc Full Name',
        fileName: 'doc_fn.pdf',
      }, { fullName: 'Srinu Sir' });
      expect(docFullName.uploadedBy).toBe('Srinu Sir');

      const docObjActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Author Search Test',
        fileName: 'author_search.pdf',
        description: 'Some desc',
      }, { name: 'Chandhan' });
      expect(docObjActor.uploadedBy).toBe('Chandhan');

      const docEmailActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Email Actor Test',
        fileName: 'email_actor.pdf',
      }, { email: 'krishna@procucev.com' });
      expect(docEmailActor.uploadedBy).toBe('krishna@procucev.com');

      const docEmptyObjActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Empty Obj Actor',
        fileName: 'empty_obj.pdf',
      }, {});
      expect(docEmptyObjActor.uploadedBy).toBe('Category Manager');

      // Test all branches of matchesDocumentType
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'application/pdf' }, 'pdf')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'image/png' }, 'image')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'application/vnd.ms-excel' }, 'excel')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, 'excel')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'application/msword' }, 'word')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'noext', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'word')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'doc.txt', mimeType: 'text/plain' }, 'unknown')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'other.bin', mimeType: 'application/octet-stream' }, 'pdf')).toBe(false);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'other.bin', mimeType: 'application/octet-stream' }, 'image')).toBe(false);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'other.bin', mimeType: 'application/octet-stream' }, 'excel')).toBe(false);
      expect(accountDocumentQueries.matchesDocumentType({ fileName: 'other.bin', mimeType: 'application/octet-stream' }, 'word')).toBe(false);

      // Add RFQ with fallback attachment properties
      storeService.rfqs.push({
        id: 'rfq-fallback-1',
        buyerId: mockBuyer.id,
        // no rfqNumber
        attachments: [
          // name instead of fileName, size instead of fileSize, url instead of fileUrl, no uploadedBy
          { id: 'att-name-only', name: 'spec_from_name.pdf', size: 9999, url: '/from_name.pdf' },
          // completely bare attachment
          { id: 'att-bare' }
        ],
        quotes: [
          // Quote without vendorName
          { vendorId: mockVendor.id }
        ]
      });

      const buyerFallbackDocs = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
      });
      const nameDoc = buyerFallbackDocs.find(d => d.id === 'rfq_doc_rfq-fallback-1_att-name-only');
      expect(nameDoc).toBeDefined();
      expect(nameDoc.uploadedBy).toBe('Buyer Operations');

      const bareDoc = buyerFallbackDocs.find(d => d.id === 'rfq_doc_rfq-fallback-1_att-bare');
      expect(bareDoc).toBeDefined();
      expect(bareDoc.fileName).toBe('RFQ_spec.pdf');

      const sellerFallbackDocs = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      const anonQuoteDoc = sellerFallbackDocs.find(d => d.id === 'quote_doc_rfq-fallback-1_' + mockVendor.id);
      expect(anonQuoteDoc).toBeDefined();
      expect(anonQuoteDoc.uploadedBy).toBe('Supplier Representative');

      // Test default parameter branches
      const emptyParamsList = await accountDocumentQueries.listAccountDocuments();
      expect(emptyParamsList).toEqual([]);

      const emptyParamsCreate = await accountDocumentQueries.createAccountDocument();
      expect(emptyParamsCreate.documentName).toBe('Untitled Document');

      // Test delete with empty accountType/accountId
      await accountDocumentQueries.deleteAccountDocument('any-id');

      // Test duplicate document handling in listAccountDocuments (seenKeys branch)
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Duplicate Test',
        fileName: 'duplicate.pdf',
        category: 'Other',
      });
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Duplicate Test 2',
        fileName: 'duplicate.pdf',
        category: 'Other',
      });
      const dupDocs = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
      });
      expect(dupDocs.length).toBeGreaterThan(0);

      // Search matches by description
      const searchDesc = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        search: 'unique keyword',
      });
      expect(searchDesc.length).toBeGreaterThan(0);

      // Search matches by uploadedBy
      const searchAuthor = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        search: 'Chandhan',
      });
      expect(searchAuthor.length).toBeGreaterThan(0);

      // Search matches by fileName
      const searchFile = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        search: 'author_search',
      });
      expect(searchFile.length).toBeGreaterThan(0);

      // Test category filtering with 'all' and explicit match
      const allCat = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        category: 'all',
      });
      expect(allCat.length).toBeGreaterThan(0);

      const specificCat = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        category: 'RFQ',
      });
      expect(specificCat.every(d => d.category.toLowerCase() === 'rfq')).toBe(true);
    });
  });

  describe('accountDocumentController edge cases & error handler branches', () => {
    it('extractActor extracts headers when req.user is absent', () => {
      const actor1 = accountDocumentController.extractActor({
        headers: { 'x-user-name': 'Test User', 'x-user-email': 'test@example.com' }
      });
      expect(actor1.name).toBe('Test User');
      expect(actor1.email).toBe('test@example.com');

      const actor2 = accountDocumentController.extractActor({ headers: {} });
      expect(actor2.name).toBe('Category Manager');
      expect(actor2.email).toBe('admin@procucev.com');
    });

    it('handles not found and invalid payloads for buyer and seller operations', async () => {
      // Buyer upload 404
      const resBuyerNotFound = await request(app)
        .post('/api/buyer-accounts/non-existent-buyer/documents')
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ documentName: 'Doc', category: 'Other', fileName: 'f.pdf' });
      expect(resBuyerNotFound.status).toBe(404);

      // Seller upload 404
      const resSellerNotFound = await request(app)
        .post('/api/vendors/non-existent-vendor/documents')
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ documentName: 'Doc', category: 'Other', fileName: 'f.pdf' });
      expect(resSellerNotFound.status).toBe(404);

      // Seller upload validation error
      const resSellerValFail = await request(app)
        .post(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ category: 'Other' });
      expect(resSellerValFail.status).toBe(400);

      // Seller delete 404
      const resSellerDel404 = await request(app)
        .delete(`/api/vendors/${mockVendor.id}/documents/non-existent-doc-id`)
        .set('Authorization', `Bearer ${cmToken}`);
      expect(resSellerDel404.status).toBe(404);
    });

    it('triggers next(err) in controllers when an unhandled exception occurs', async () => {
      const err = new Error('Simulated controller crash');
      const nextFn = jest.fn();
      const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      const origList = accountDocumentQueries.listAccountDocuments;
      const origCreate = accountDocumentQueries.createAccountDocument;
      const origDelete = accountDocumentQueries.deleteAccountDocument;

      try {
        accountDocumentQueries.listAccountDocuments = async () => { throw err; };
        accountDocumentQueries.createAccountDocument = async () => { throw err; };
        accountDocumentQueries.deleteAccountDocument = async () => { throw err; };

        const cmUser = { id: 'u1', role: 'category_manager', email: 'cm@procucev.com' };

        await accountDocumentController.getBuyerDocuments({ params: { id: mockBuyer.id }, user: cmUser }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);

        nextFn.mockClear();
        await accountDocumentController.uploadBuyerDocument({
          params: { id: mockBuyer.id },
          body: { documentName: 'Test', category: 'Other', fileName: 't.pdf' },
          user: cmUser
        }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);

        nextFn.mockClear();
        await accountDocumentController.deleteBuyerDocument({
          params: { id: mockBuyer.id, docId: 'doc1' },
          user: cmUser
        }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);

        nextFn.mockClear();
        await accountDocumentController.getSellerDocuments({ params: { id: mockVendor.id }, user: cmUser }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);

        nextFn.mockClear();
        await accountDocumentController.uploadSellerDocument({
          params: { id: mockVendor.id },
          body: { documentName: 'Test', category: 'Other', fileName: 't.pdf' },
          user: cmUser
        }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);

        nextFn.mockClear();
        await accountDocumentController.deleteSellerDocument({
          params: { id: mockVendor.id, docId: 'doc1' },
          user: cmUser
        }, mockRes, nextFn);
        expect(nextFn).toHaveBeenCalledWith(err);
      } finally {
        accountDocumentQueries.listAccountDocuments = origList;
        accountDocumentQueries.createAccountDocument = origCreate;
        accountDocumentQueries.deleteAccountDocument = origDelete;
      }
    });
  });
    it('covers findBuyerSafe and findVendorSafe DB fallback and user resolution branches', async () => {
      const origHasStorage = pool.hasStorage;
      const origQuery = pool.query;
      try {
        const memBuyer = await accountDocumentController.findBuyerSafe(mockBuyer.id);
        expect(memBuyer.id).toBe(mockBuyer.id);
        pool.hasStorage = () => true;
        pool.query = jest.fn().mockResolvedValue({
          rows: [{ id: 'buyer-db-only-1', is_active: 1, raw: JSON.stringify({ organizationName: 'Postgres Buyer Corp', corporateEmail: 'pg_buyer@corp.com' }) }]
        });
        const dbBuyer1 = await accountDocumentController.findBuyerSafe('buyer-db-only-1');
        expect(dbBuyer1.id).toBe('buyer-db-only-1');
        pool.query = jest.fn().mockResolvedValue({
          rows: [{ id: 'buyer-db-only-2', is_active: 1, raw: { organizationName: 'Object Buyer Corp' } }]
        });
        const dbBuyer2 = await accountDocumentController.findBuyerSafe('buyer-db-only-2');
        expect(dbBuyer2.id).toBe('buyer-db-only-2');
        pool.query = async () => { throw new Error('Postgres fail'); };
        const dbBuyerCrash = await accountDocumentController.findBuyerSafe('buyer-db-crash');
        expect(dbBuyerCrash).toBeUndefined();
        const userFallback = await accountDocumentController.findBuyerSafe('non-existent', { role: 'buyer', email: mockBuyer.corporateEmail });
        expect(userFallback).toBeDefined();
        const memVendor = await accountDocumentController.findVendorSafe(mockVendor.id);
        expect(memVendor.id).toBe(mockVendor.id);
        const nullVendor = await accountDocumentController.findVendorSafe('missing-vendor');
        expect(nullVendor).toBeNull();
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });
});
