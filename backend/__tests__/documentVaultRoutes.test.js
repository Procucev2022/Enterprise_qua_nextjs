const supertest = require('supertest');
const request = (app) => {
  const agent = supertest(app);
  return {
    get: (path) => agent.get(path).set('Authorization', 'Bearer document-vault-test-token'),
    post: (path) => agent.post(path).set('Authorization', 'Bearer document-vault-test-token'),
    put: (path) => agent.put(path).set('Authorization', 'Bearer document-vault-test-token'),
    delete: (path) => agent.delete(path).set('Authorization', 'Bearer document-vault-test-token'),
  };
};
const app = require('../src/app');
const authService = require('../src/services/authService');
const documentVaultQueries = require('../src/db/documentVaultQueries');

const VAULT_DOCUMENT = {
  id: 'doc-test-roi',
  documentName: 'Test ROI Benchmark',
  fileName: 'roi.pdf',
  fileSize: 1000,
  mimeType: 'application/pdf',
  category: 'marketing_overview',
  fileUrl: '',
  description: 'Fixture document for the route test.',
  uploadedBy: 'Category Lead',
  isActive: true,
  createdAt: '2026-01-15T09:00:00.000Z',
  updatedAt: '2026-01-15T09:00:00.000Z',
  accountType: 'vault',
  accountId: null,
};

describe('Document Vault API Routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: {
        sub: 'usr-cm-1',
        email: 'category.lead@test.local',
        role: 'category_manager',
        fullName: 'Category Lead',
      },
    });
    jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValue([VAULT_DOCUMENT]);
    jest.spyOn(documentVaultQueries, 'getDocumentById').mockImplementation(async (id) => (id === VAULT_DOCUMENT.id ? VAULT_DOCUMENT : null));
    jest.spyOn(documentVaultQueries, 'getDocumentVaultSummary').mockResolvedValue({
      totalDocuments: 1,
      activeDocuments: 1,
      totalSizeBytes: 1000,
      categoriesCount: 1,
      buyerDocuments: 0,
      sellerDocuments: 0,
      vaultDocuments: 1,
    });
    jest.spyOn(documentVaultQueries, 'createDocument').mockImplementation(async (payload, actor) => ({
      ...VAULT_DOCUMENT,
      id: 'doc-test-new',
      documentName: payload.documentName,
      uploadedBy: actor.fullName,
    }));
    jest.spyOn(documentVaultQueries, 'updateDocument').mockImplementation(async (id, updates) => (
      id === VAULT_DOCUMENT.id ? { ...VAULT_DOCUMENT, documentName: updates.documentName } : null
    ));
    jest.spyOn(documentVaultQueries, 'deleteDocument').mockImplementation(async (id) => id === VAULT_DOCUMENT.id);
  });

  test('GET /api/document-vault returns the document list from the query layer', async () => {
    const res = await request(app).get('/api/document-vault');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.documents).toEqual([VAULT_DOCUMENT]);
  });

  test('GET /api/document-vault returns 503 with a retry flag when storage is unavailable', async () => {
    documentVaultQueries.listDocuments.mockRejectedValue(Object.assign(new Error('down'), { code: 'PERSISTENCE_UNAVAILABLE' }));
    const res = await request(app).get('/api/document-vault');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.retryable).toBe(true);
  });

  test('GET /api/document-vault rejects anonymous and non-staff callers', async () => {
    const anonymous = await supertest(app).get('/api/document-vault');
    expect(anonymous.status).toBe(401);

    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'vendor-test-id', email: 'vendor@test.local', role: 'vendor' },
    });
    const vendor = await supertest(app)
      .get('/api/document-vault')
      .set('Authorization', 'Bearer vendor-token');
    expect(vendor.status).toBe(403);
  });

  test('GET /api/document-vault/summary returns metrics', async () => {
    const res = await request(app).get('/api/document-vault/summary');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.totalDocuments).toBe(1);
  });

  test('GET /api/document-vault/:id returns document or 404', async () => {
    const res = await request(app).get(`/api/document-vault/${VAULT_DOCUMENT.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.document.id).toBe(VAULT_DOCUMENT.id);

    const notFound = await request(app).get('/api/document-vault/non_existent_123');
    expect(notFound.status).toBe(404);
  });

  test('POST /api/document-vault rejects unauthenticated callers with 401', async () => {
    const res = await supertest(app)
      .post('/api/document-vault')
      .send({ documentName: 'Test Doc', fileName: 'test.pdf', category: 'marketing_overview' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/document-vault rejects unauthorized role with 403', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'usr-vendor-1', email: 'vendor@test.local', role: 'vendor' },
    });

    const res = await request(app)
      .post('/api/document-vault')
      .set('Authorization', 'Bearer vendor-token')
      .send({ documentName: 'Test Doc', fileName: 'test.pdf', category: 'marketing_overview' });

    expect(res.status).toBe(403);
  });

  test('POST /api/document-vault creates the document with the session user as uploader', async () => {
    const res = await request(app)
      .post('/api/document-vault')
      .send({ documentName: 'Brand New Rate Card', fileName: 'new_rate_card.pdf', category: 'rate_cards' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.document.documentName).toBe('Brand New Rate Card');
    expect(res.body.document.uploadedBy).toBe('Category Lead');
  });

  test('PUT /api/document-vault/:id rejects unauthenticated and allows authorized', async () => {
    const unauth = await supertest(app)
      .put(`/api/document-vault/${VAULT_DOCUMENT.id}`)
      .send({ documentName: 'Updated' });
    expect(unauth.status).toBe(401);

    const auth = await request(app)
      .put(`/api/document-vault/${VAULT_DOCUMENT.id}`)
      .send({ documentName: 'Updated Document Name' });
    expect(auth.status).toBe(200);
    expect(auth.body.document.documentName).toBe('Updated Document Name');
  });

  test('DELETE /api/document-vault/:id rejects unauthenticated and allows authorized', async () => {
    const unauth = await supertest(app).delete(`/api/document-vault/${VAULT_DOCUMENT.id}`);
    expect(unauth.status).toBe(401);

    const auth = await request(app).delete(`/api/document-vault/${VAULT_DOCUMENT.id}`);
    expect(auth.status).toBe(200);
    expect(auth.body.success).toBe(true);
  });
});
