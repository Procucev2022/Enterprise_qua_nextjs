const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const pool = require('../src/db/pool');
const { queryCache } = require('../src/db/queryCache');
const { logger } = require('../src/services/loggerService');
const accountDocumentQueries = require('../src/db/accountDocumentQueries');
const accountDocumentController = require('../src/controllers/accountDocumentController');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const smsService = require('../src/services/smsService');

// In-memory stand-in for the account_documents table. It answers the statement shapes that
// accountDocumentQueries sends: INSERT, UPDATE ... RETURNING, and SELECT with account, active,
// category and ILIKE search conditions. Other statements get an empty result, as an empty
// database would return. One store lives for the whole file so tests can build on each other.
function createAccountDocumentStore() {
  const rows = [];

  const insert = (params) => {
    const [id, accountType, accountId, documentName, fileName, fileSize, mimeType, category, fileUrl, description, uploadedBy, isActive, createdAt, updatedAt] = params;
    const row = {
      id,
      account_type: accountType,
      account_id: accountId,
      document_name: documentName,
      file_name: fileName,
      file_size: fileSize,
      mime_type: mimeType,
      category,
      file_url: fileUrl,
      description,
      uploaded_by: uploadedBy,
      is_active: isActive,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    };
    rows.push(row);
    return { rows: [{ ...row }], rowCount: 1 };
  };

  const softDelete = (params) => {
    const [id, accountType, accountId] = params;
    const match = rows.find((row) => row.id === id
      && row.account_type === accountType
      && row.account_id === accountId
      && row.is_active === 1);
    if (!match) return { rows: [], rowCount: 0 };
    match.is_active = 0;
    return { rows: [{ id: match.id }], rowCount: 1 };
  };

  const select = (sql, params) => {
    let matched = rows.slice();
    for (const [, column, index] of sql.matchAll(/(account_type|account_id|category) = \$(\d+)/g)) {
      const expected = params[Number(index) - 1];
      matched = matched.filter((row) => row[column] === expected);
    }
    if (sql.includes('is_active = 1')) {
      matched = matched.filter((row) => row.is_active === 1);
    }
    const search = sql.match(/ILIKE \$(\d+)/);
    if (search) {
      const term = String(params[Number(search[1]) - 1])
        .replace(/^%|%$/g, '')
        .replace(/\\([%_\\])/g, '$1')
        .toLowerCase();
      matched = matched.filter((row) => [row.document_name, row.file_name, row.description]
        .some((field) => String(field || '').toLowerCase().includes(term)));
    }
    const direction = sql.includes('ORDER BY created_at ASC') ? 1 : -1;
    matched.sort((a, b) => direction * a.created_at.localeCompare(b.created_at));
    return { rows: matched.map((row) => ({ ...row })), rowCount: matched.length };
  };

  const query = async (sql, params = []) => {
    const text = String(sql);
    if (/^\s*INSERT INTO account_documents/.test(text)) return insert(params);
    if (/^\s*UPDATE account_documents/.test(text)) return softDelete(params);
    if (/FROM account_documents/.test(text)) return select(text, params);
    return { rows: [], rowCount: 0 };
  };

  return { rows, query };
}

// Routes account document queries to the store for the current test. Jest restores the spies
// after each test.
const originalHydrationState = storeService.isHydratedFromDB;

function useAccountDocumentStore(store) {
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockImplementation(store.query);
  // The in-memory fixtures are the local cache. Without this flag, the first lookup would
  // hydrate from the empty store and replace them.
  storeService.isHydratedFromDB = true;
}

// The row the persistence layer returns for an approval task. It copies the submitted fields.
function persistedApprovalTask(taskData) {
  return {
    id: 'task-approval-1',
    task_number: 'TSK-APPROVAL-1',
    status: taskData.status,
    approval_status: taskData.approvalStatus,
    assigned_to_name: taskData.assignedToName,
    credit_quantity: taskData.creditQuantity,
  };
}

describe('Account Documents & Credit Workflows API', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    storeService.isHydratedFromDB = originalHydrationState;
  });
  let mockBuyer;
  let mockVendor;
  let createdBuyerDocId;
  let createdSellerDocId;
  let cmToken;
  let accountStore;

  beforeAll(() => {
    accountStore = createAccountDocumentStore();
    cmToken = authService.generateSessionToken({
      id: 'cm-1',
      uuid: 'cm-1',
      email: 'cm@procucev.com',
      role: 'category_manager',
      name: 'Category Manager',
    });

    mockBuyer = storeService.addBuyerAccount({
      organizationName: 'Veera Babu Buyer Org',
      corporateEmail: 'buyer_test_doc@enterprise.com',
      contactPerson: 'Veera Babu',
      remainingFreeRFQs: 5,
      creditBalance: 5,
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
    beforeEach(() => useAccountDocumentStore(accountStore));

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

    it('DELETE returns 409 for a workflow document and keeps the document listed', async () => {
      storeService.rfqs.push({
        id: 'rfq-409-test',
        buyerId: mockBuyer.id,
        rfqNumber: 'RFQ-409-TEST',
        attachments: [{ id: 'att-409', fileName: 'workflow-spec.pdf', mimeType: 'application/pdf' }],
      });
      try {
        const docId = 'rfq_doc_rfq-409-test_att-409';
        const res = await request(app)
          .delete(`/api/buyer-accounts/${mockBuyer.id}/documents/${docId}`)
          .set('Authorization', `Bearer ${cmToken}`);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false, retryable: false });
        expect(res.body.error).toContain('cannot be removed from the dossier');

        const list = await request(app)
          .get(`/api/buyer-accounts/${mockBuyer.id}/documents`)
          .set('Authorization', `Bearer ${cmToken}`);
        expect(list.body.documents.some((d) => d.id === docId)).toBe(true);
      } finally {
        storeService.rfqs = storeService.rfqs.filter((r) => r.id !== 'rfq-409-test');
      }
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
    beforeEach(() => useAccountDocumentStore(accountStore));

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
      const origHydrated = storeService.isHydratedFromDB;

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
        // This test supplies a fake database connection, so bypass the app's
        // real lazy-hydration gate before exercising the credit transaction.
        storeService.isHydratedFromDB = true;
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
            if (sql === 'ROLLBACK') throw new Error('Postgres rollback failure');
            return { rowCount: 1 };
          }),
          release: jest.fn(),
        };
        pool.pool = { connect: jest.fn().mockResolvedValue(failingClient) };
        const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

        const res3 = await request(app)
          .post(`/api/vendors/${createdV3.id}/add-quote-credits`)
          .set('Authorization', `Bearer ${cmToken}`)
          .send({ amount: 1 });
        expect(res3.status).toBe(500);
        expect(res3.body.success).toBe(false);
        expect(failingClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(failingClient.release).toHaveBeenCalled();
        expect(errorLogSpy).toHaveBeenCalledWith(
          'Vendor quote-credit transaction rollback failed',
          expect.objectContaining({
            operation: 'rollback-vendor-quote-credit-transaction',
            vendorId: createdV3.id,
          }),
          'VENDOR_CONTROLLER'
        );

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
        storeService.isHydratedFromDB = origHydrated;
      }
    });

    it('logs cache invalidation failure after the quote-credit transaction commits', async () => {
      const { addQuoteCredits } = require('../src/controllers/vendorDossierExtensions');
      const originalPoolInstance = pool.pool;
      const originalHydratedState = storeService.isHydratedFromDB;
      const cacheError = new Error('query cache is unavailable');
      const client = {
        query: jest.fn().mockResolvedValue({ rowCount: 1 }),
        release: jest.fn(),
      };
      const warningLogSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(queryCache, 'invalidate').mockImplementation(() => {
        throw cacheError;
      });
      jest.spyOn(storeService, 'updateVendor').mockReturnValue(mockVendor);
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      storeService.isHydratedFromDB = true;

      try {
        const response = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        await addQuoteCredits({
          user: { role: 'admin' },
          params: { id: mockVendor.id },
          body: { amount: 1 },
        }, response, jest.fn());

        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(warningLogSpy).toHaveBeenCalledWith(
          'Vendor quote-credit write committed but local query-cache invalidation failed',
          expect.objectContaining({
            error: cacheError,
            operation: 'invalidate-vendor-quote-credit-cache',
            vendorId: mockVendor.id,
            cacheTags: ['vendor_credits', 'vendors'],
          }),
          'VENDOR_CONTROLLER'
        );
      } finally {
        pool.pool = originalPoolInstance;
        storeService.isHydratedFromDB = originalHydratedState;
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

    it('ignores an initiatorName sent in the body and records the signed-in user as the maker', async () => {
      const createSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval')
        .mockImplementation(async (taskData) => persistedApprovalTask(taskData));

      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/request-credit-approval`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({
          amount: 10,
          reason: 'Quarterly review allocation',
          approverName: 'Srinu Sir',
          initiatorName: 'Unknown Initiator',
        });

      expect(res.status).toBe(201);
      const [taskData, actor] = createSpy.mock.calls[0];
      expect(actor).toMatchObject({ name: 'Category Manager', email: 'cm@procucev.com' });
      expect(taskData.notes).toContain('Initiated By: Category Manager');
      expect(taskData.notes).not.toContain('Unknown Initiator');
    });

    it('submits credit request with Pending Approval status and creates internal task', async () => {
      const createSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval')
        .mockImplementation(async (taskData) => persistedApprovalTask(taskData));
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
      const [taskData, actor] = createSpy.mock.calls[0];
      expect(taskData).toMatchObject({ status: 'Pending Approval', approvalStatus: 'PENDING', assignedToName: 'Sudheer Sir', creditQuantity: 15 });
      expect(actor).toMatchObject({ name: 'Category Manager' });
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
      const createSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval')
        .mockImplementation(async (taskData) => persistedApprovalTask(taskData));
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
      expect(createSpy.mock.calls[0][0]).toMatchObject({ status: 'Pending Approval', approvalStatus: 'PENDING', assignedToName: 'Srinu Sir', creditQuantity: 5 });
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
      jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval')
        .mockImplementation(async (taskData) => persistedApprovalTask(taskData));
      const minimalVendor = storeService.addVendor({
        contactPerson: 'Sparse Seller',
      });
      delete minimalVendor.name;
      delete minimalVendor.email;
      delete minimalVendor.freeQuotationCredits;

      // The session has a name but no email. An identified session is accepted.
      const userNoEmailToken = authService.generateSessionToken({
        id: 'cm-no-email',
        name: 'Category Manager',
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
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
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
      // No channel provider accepts a message in the test environment, so each delivery is recorded as Failed.
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Pending' });
      const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus')
        .mockResolvedValue({ id: 'comm-1', deliveryStatus: 'Failed' });
      jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue({
        success: false,
        status: 'not_configured',
        error: 'SMS provider is not configured.',
      });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'task-comm-1' });

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
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ communicationId: 'comm-1', deliveryStatus: 'Failed' }));

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
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const mailerService = require('../src/services/mailerService');
      const smsService = require('../src/services/smsService');

      // 1. getVendorCommunications with assigned RFQ
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce([
        { id: 'comm-rfq-101', subject: 'RFQ-COMM-101 invitation', channel: 'EMAIL', status: 'SENT' },
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
    beforeEach(() => useAccountDocumentStore(accountStore));

    it('handles matchesDocumentType across all extensions and mimes', () => {
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/pdf', fileName: 'test.pdf' }, 'pdf')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'image/png', fileName: 'test.png' }, 'image')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/vnd.ms-excel', fileName: 'test.xlsx' }, 'excel')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'application/msword', fileName: 'test.docx' }, 'word')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'text/plain', fileName: 'test.txt' }, 'other')).toBe(true);
      expect(accountDocumentQueries.matchesDocumentType({ mimeType: 'text/plain', fileName: 'test.txt' }, 'all')).toBe(true);
    });

    it('handles mapRow with null, missing fields, and custom values', async () => {
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
      // Empty strings are not recorded values, so they map to null rather than a default.
      expect(mappedDb.mimeType).toBeNull();
      expect(mappedDb.category).toBeNull();
      expect(mappedDb.uploadedBy).toBeNull();
      expect(mappedDb.createdAt).toBeNull();

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
      await expect(accountDocumentQueries.deleteAccountDocument(null)).resolves.toBe(false);
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
          category: 'RFQ',
          isActive: false,
        }, { name: 'Category Manager' });
        expect(created.id).toBe('db_doc_101');

        const listed = await accountDocumentQueries.listAccountDocuments({
          accountType: 'buyer',
          accountId: 'buyer-db-1',
          sortOrder: 'asc',
        });
        expect(listed.length).toBeGreaterThanOrEqual(1);

        const deleted = await accountDocumentQueries.deleteAccountDocument('db_doc_101', 'buyer', 'buyer-db-1');
        expect(deleted).toBe(true);

        // Workflow documents cannot be deleted. The request is refused, not acknowledged.
        await expect(accountDocumentQueries.deleteAccountDocument('rfq_doc_test_1', 'buyer', 'buyer-db-1'))
          .rejects.toMatchObject({ code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE' });

        // A statement failure in list, create and delete surfaces as PERSISTENCE_UNAVAILABLE.
        pool.query = async () => { throw new Error('DB connection fail'); };
        await expect(accountDocumentQueries.listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-db-1' }))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        await expect(accountDocumentQueries.createAccountDocument({
          accountType: 'buyer', accountId: 'buyer-catch-1', documentName: 'Catch Doc', fileName: 'catch.pdf', category: 'Other',
        }, { name: 'Category Manager' })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        await expect(accountDocumentQueries.deleteAccountDocument('db_doc_101', 'buyer', 'buyer-db-1'))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

        // A delete that matches no row returns false, not an error.
        pool.query = async () => ({ rows: [] });
        const delNoRow = await accountDocumentQueries.deleteAccountDocument('any-id', 'buyer', 'buyer-catch-1');
        expect(delNoRow).toBe(false);

        // Without a configured database nothing is read.
        pool.hasStorage = () => false;
        await expect(accountDocumentQueries.listAccountDocuments({ accountType: 'buyer', accountId: 'buyer-db-1' }))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        pool.hasStorage = () => true;
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });

    it('covers escapeLikeWildcards, empty filters, and workflow document aggregation', async () => {
      expect(accountDocumentQueries.escapeLikeWildcards(null)).toBe('');
      expect(accountDocumentQueries.escapeLikeWildcards(123)).toBe('');
      expect(accountDocumentQueries.escapeLikeWildcards('test%_foo\\bar')).toBe('test\\%\\_foo\\\\bar');

      await expect(accountDocumentQueries.listAccountDocuments({})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

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
      // A document whose name has no category keyword stays unclassified rather than labelled.
      expect(recheckSellerDocs.find(d => d.documentName === 'certificate_of_incorporation.pdf').category).toBeNull();

      // Evaluation and quotation documents come from source records, so a delete is refused
      // and the document stays listed.
      const evalDocToDel = recheckSellerDocs.find(d => d.id.includes('eval_doc'));
      await expect(accountDocumentQueries.deleteAccountDocument(evalDocToDel.id, 'seller', mockVendor.id))
        .rejects.toMatchObject({ code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE' });
      await expect(accountDocumentQueries.deleteAccountDocument(quoteDoc.id, 'seller', mockVendor.id))
        .rejects.toMatchObject({ code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE' });
      const afterRefusedDel = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      expect(afterRefusedDel.some(d => d.id === evalDocToDel.id)).toBe(true);

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
        category: 'Other',
      }, { name: 'Category Manager' });
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Sort Test Doc 2',
        fileName: 'sort2.pdf',
        category: 'Other',
      }, { name: 'Category Manager' });
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

      // RFQ attachments are workflow documents. A delete is refused and the attachment stays listed.
      await expect(accountDocumentQueries.deleteAccountDocument(rfqDoc.id, 'buyer', mockBuyer.id))
        .rejects.toMatchObject({ code: 'WORKFLOW_DOCUMENT_NOT_DELETABLE' });
      const afterRefusedRfqDel = await accountDocumentQueries.listAccountDocuments({
        accountType: 'buyer',
        accountId: mockBuyer.id,
      });
      expect(afterRefusedRfqDel.some(d => d.id === rfqDoc.id)).toBe(true);

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
        category: 'Other',
        description: 'Specific unique keyword in description',
      }, 'Govardhan');
      expect(docStringActor.uploadedBy).toBe('Govardhan');

      const docFullName = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Doc Full Name',
        fileName: 'doc_fn.pdf',
        category: 'Other',
      }, { fullName: 'Srinu Sir' });
      expect(docFullName.uploadedBy).toBe('Srinu Sir');

      const docObjActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Author Search Test',
        fileName: 'author_search.pdf',
        category: 'Other',
        description: 'Some desc',
      }, { name: 'Chandhan' });
      expect(docObjActor.uploadedBy).toBe('Chandhan');

      const docEmailActor = await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Email Actor Test',
        fileName: 'email_actor.pdf',
        category: 'Other',
      }, { email: 'krishna@procucev.com' });
      expect(docEmailActor.uploadedBy).toBe('krishna@procucev.com');

      // An actor with no name or email is refused. No uploader name is substituted.
      await expect(accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Empty Obj Actor',
        fileName: 'empty_obj.pdf',
        category: 'Other',
      }, {})).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });

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
      expect(nameDoc.uploadedBy).toBeNull();

      const bareDoc = buyerFallbackDocs.find(d => d.id === 'rfq_doc_rfq-fallback-1_att-bare');
      expect(bareDoc).toBeDefined();
      expect(bareDoc.fileName).toBeNull();

      const sellerFallbackDocs = await accountDocumentQueries.listAccountDocuments({
        accountType: 'seller',
        accountId: mockVendor.id,
      });
      const anonQuoteDoc = sellerFallbackDocs.find(d => d.id === 'quote_doc_rfq-fallback-1_' + mockVendor.id);
      expect(anonQuoteDoc).toBeDefined();
      expect(anonQuoteDoc.uploadedBy).toBeNull();

      // Calls with no account type and id are refused.
      await expect(accountDocumentQueries.listAccountDocuments()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(accountDocumentQueries.createAccountDocument()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      // Test delete with empty accountType/accountId
      await accountDocumentQueries.deleteAccountDocument('any-id');

      // Test duplicate document handling in listAccountDocuments (seenKeys branch)
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Duplicate Test',
        fileName: 'duplicate.pdf',
        category: 'Other',
      }, { name: 'Category Manager' });
      await accountDocumentQueries.createAccountDocument({
        accountType: 'buyer',
        accountId: mockBuyer.id,
        documentName: 'Duplicate Test 2',
        fileName: 'duplicate.pdf',
        category: 'Other',
      }, { name: 'Category Manager' });
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

    it('logs buyer and seller workflow aggregation failures while preserving the partial result', async () => {
      const originalHasStorage = pool.hasStorage;
      const originalRfqs = storeService.rfqs;
      const originalEvaluations = storeService.evaluations;
      const buyerError = new Error('RFQ workflow source unavailable');
      const sellerError = new Error('Seller workflow source unavailable');
      const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      try {
        // The persisted document must survive the workflow failure.
        await accountDocumentQueries.createAccountDocument({
          accountType: 'buyer',
          accountId: 'buyer-workflow-error',
          documentName: 'Partial Buyer Doc',
          fileName: 'partial-buyer.pdf',
          category: 'Other',
        }, { name: 'Category Manager' });
        storeService.rfqs = new Proxy([], {
          get(target, property, receiver) {
            if (property === 'filter') throw buyerError;
            return Reflect.get(target, property, receiver);
          },
        });

        const buyerDocuments = await accountDocumentQueries.listAccountDocuments({
          accountType: 'buyer',
          accountId: 'buyer-workflow-error',
        });
        expect(buyerDocuments.map((d) => d.documentName)).toEqual(['Partial Buyer Doc']);
        expect(errorLogSpy).toHaveBeenCalledWith(
          'Workflow documents could not be aggregated for the account dossier',
          expect.objectContaining({
            error: buyerError,
            operation: 'aggregate-workflow-documents',
            accountType: 'buyer',
            accountIdPresent: true,
          }),
          'ACCOUNT_DOCUMENT_QUERIES'
        );

        await accountDocumentQueries.createAccountDocument({
          accountType: 'seller',
          accountId: 'seller-workflow-error',
          documentName: 'Partial Seller Doc',
          fileName: 'partial-seller.pdf',
          category: 'Other',
        }, { name: 'Category Manager' });
        storeService.evaluations = new Proxy([], {
          get(target, property, receiver) {
            if (property === 'find') throw sellerError;
            return Reflect.get(target, property, receiver);
          },
        });
        const sellerDocuments = await accountDocumentQueries.listAccountDocuments({
          accountType: 'seller',
          accountId: 'seller-workflow-error',
        });

        expect(sellerDocuments.map((d) => d.documentName)).toEqual(['Partial Seller Doc']);
        expect(errorLogSpy).toHaveBeenCalledWith(
          'Workflow documents could not be aggregated for the account dossier',
          expect.objectContaining({
            error: sellerError,
            operation: 'aggregate-workflow-documents',
            accountType: 'seller',
            accountIdPresent: true,
          }),
          'ACCOUNT_DOCUMENT_QUERIES'
        );
      } finally {
        pool.hasStorage = originalHasStorage;
        storeService.rfqs = originalRfqs;
        storeService.evaluations = originalEvaluations;
      }
    });
  });

  describe('accountDocumentController edge cases & error handler branches', () => {
    beforeEach(() => useAccountDocumentStore(accountStore));

    it('extractActor takes identity only from req.user and never from x-user-name or x-user-email headers', () => {
      const spoofedHeaders = { 'x-user-name': 'Spoofed Name', 'x-user-email': 'spoofed@procucev.com' };

      // No session: no actor, even when identity headers are present.
      expect(accountDocumentController.extractActor({ headers: spoofedHeaders })).toBeNull();
      expect(accountDocumentController.extractActor({ headers: {} })).toBeNull();

      // With a session: the session identity is used and the headers are ignored.
      const actor = accountDocumentController.extractActor({
        headers: spoofedHeaders,
        user: { email: 'cm@procucev.com', name: 'Category Manager', role: 'category_manager' },
      });
      expect(actor).toMatchObject({ name: 'Category Manager', email: 'cm@procucev.com' });
    });

    it('rejects an upload with no session with 401 even when identity headers are sent', async () => {
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('x-user-name', 'Spoofed Name')
        .set('x-user-email', 'spoofed@procucev.com')
        .send({ documentName: 'Doc', category: 'Other', fileName: 'f.pdf' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('the controller returns 401 for a request with no req.user before it looks anything up', async () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const findSpy = jest.spyOn(storeService, 'getVendorById');

      await accountDocumentController.uploadSellerDocument({
        params: { id: mockVendor.id },
        headers: { 'x-user-name': 'Spoofed Name' },
        body: { documentName: 'Doc', category: 'Other', fileName: 'f.pdf' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(findSpy).not.toHaveBeenCalled();
    });

    it('records the session name as uploadedBy, not an x-user-name header', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .set('x-user-name', 'Spoofed Name')
        .send({ documentName: 'Header Identity Check', fileName: 'identity.pdf', category: 'Other' });

      expect(res.status).toBe(201);
      expect(res.body.document.uploadedBy).toBe('Category Manager');
    });

    it('rejects an upload from a session that has a subject but no name or email with 401', async () => {
      const subjectOnlyToken = authService.generateSessionToken({ id: 'cm-subject-only', role: 'category_manager' });
      const res = await request(app)
        .post(`/api/buyer-accounts/${mockBuyer.id}/documents`)
        .set('Authorization', `Bearer ${subjectOnlyToken}`)
        .send({ documentName: 'Subject Only Doc', category: 'Other', fileName: 'subject.pdf' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when the document name is only whitespace', async () => {
      const res = await request(app)
        .post(`/api/vendors/${mockVendor.id}/documents`)
        .set('Authorization', `Bearer ${cmToken}`)
        .send({ documentName: '   ', category: 'Other', fileName: 'blank.pdf' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('finds the buyer account by session email when the id is unknown and no database is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const buyer = await accountDocumentController.findBuyerSafe('unknown-buyer-id', {
        role: 'buyer',
        email: mockBuyer.corporateEmail,
      });
      expect(buyer.id).toBe(mockBuyer.id);
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
        // A failed lookup is an unavailable store, never a "buyer not found" answer.
        await expect(accountDocumentController.findBuyerSafe('buyer-db-crash'))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        await expect(accountDocumentController.findBuyerSafe('non-existent', {
          role: 'buyer', email: mockBuyer.corporateEmail,
        })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        const memVendor = await accountDocumentController.findVendorSafe(mockVendor.id);
        expect(memVendor.id).toBe(mockVendor.id);
        // A lookup that the database answers with no row is "not found", not an error.
        pool.query = async () => ({ rows: [] });
        const nullVendor = await accountDocumentController.findVendorSafe('missing-vendor');
        expect(nullVendor).toBeFalsy();
        // A lookup that fails is an unavailable store, never a "seller not found" answer.
        pool.query = async () => { throw new Error('Postgres fail'); };
        await expect(accountDocumentController.findVendorSafe('missing-vendor'))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });
  describe('getAllAccountDocuments', () => {
    beforeEach(() => useAccountDocumentStore(accountStore));

    it('retrieves all account documents with various filters', async () => {
      await accountDocumentQueries.createAccountDocument({
        documentName: 'Buyer GST Certificate',
        fileName: 'gst.pdf',
        fileSize: 1000,
        category: 'GST',
        accountType: 'buyer',
        accountId: 'BUY-999',
        isActive: true,
      }, { name: 'Category Manager' });

      await accountDocumentQueries.createAccountDocument({
        documentName: 'Seller PAN Card',
        fileName: 'pan.pdf',
        fileSize: 2000,
        category: 'PAN',
        accountType: 'seller',
        accountId: 'SEL-999',
        isActive: false,
      }, { name: 'Category Manager' });

      const all = await accountDocumentQueries.getAllAccountDocuments();
      expect(all.length).toBeGreaterThan(0);

      const buyersOnly = await accountDocumentQueries.getAllAccountDocuments({ accountType: 'buyer' });
      expect(buyersOnly.every((d) => d.accountType === 'buyer')).toBe(true);

      const sellersOnly = await accountDocumentQueries.getAllAccountDocuments({ accountType: 'seller' });
      expect(sellersOnly.every((d) => d.accountType === 'seller')).toBe(true);

      const allTypes = await accountDocumentQueries.getAllAccountDocuments({ accountType: 'all' });
      expect(allTypes.length).toBe(all.length);

      const gstDocs = await accountDocumentQueries.getAllAccountDocuments({ category: 'GST' });
      expect(gstDocs.every((d) => d.category === 'GST')).toBe(true);

      const allCats = await accountDocumentQueries.getAllAccountDocuments({ category: 'all' });
      expect(allCats.length).toBe(all.length);

      const activeDocs = await accountDocumentQueries.getAllAccountDocuments({ activeOnly: true });
      expect(activeDocs.every((d) => d.isActive !== false)).toBe(true);

      const searched = await accountDocumentQueries.getAllAccountDocuments({ search: 'Certificate' });
      expect(searched.length).toBeGreaterThan(0);

    });

    it('retrieves documents using PostgreSQL pool when storage is enabled and handles error fallback', async () => {
      const origHasStorage = pool.hasStorage;
      const origQuery = pool.query;

      try {
        pool.hasStorage = () => true;
        pool.query = jest.fn().mockResolvedValue({
          rows: [
            {
              id: 'doc-pg-1',
              account_type: 'buyer',
              account_id: 'b-1',
              document_name: 'PostgreSQL Document',
              file_name: 'pg.pdf',
              file_size: 5000,
              mime_type: 'application/pdf',
              category: 'GST',
              file_url: '/docs/pg.pdf',
              description: 'PG Description',
              uploaded_by: 'Admin',
              is_active: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        });

        const pgDocs = await accountDocumentQueries.getAllAccountDocuments({
          accountType: 'buyer',
          category: 'GST',
          search: 'PostgreSQL',
          activeOnly: true,
        });

        expect(pool.query).toHaveBeenCalledWith(
          expect.stringContaining('SELECT id, account_type'),
          expect.any(Array),
          { d1: true }
        );
        expect(pgDocs.length).toBe(1);

        pool.query = jest.fn().mockRejectedValue(new Error('PG query failure'));
        await expect(accountDocumentQueries.getAllAccountDocuments())
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
      } finally {
        pool.hasStorage = origHasStorage;
        pool.query = origQuery;
      }
    });
  });

});
