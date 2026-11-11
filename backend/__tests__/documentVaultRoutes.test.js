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

describe('Document Vault API Routes', () => {
  beforeEach(() => {
    documentVaultQueries.resetInMemoryStore();
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: {
        sub: 'usr-cm-1',
        email: 'category.lead@procucev.com',
        role: 'category_manager',
        fullName: 'Category Lead',
      },
    });
  });

  test('GET /api/document-vault returns document list', async () => {
    const res = await request(app).get('/api/document-vault');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  test('GET /api/document-vault rejects anonymous and non-staff callers', async () => {
    const anonymous = await supertest(app).get('/api/document-vault');
    expect(anonymous.status).toBe(401);

    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'vendor-test-id', email: 'vendor@example.test', role: 'vendor' },
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
    expect(res.body.summary).toBeDefined();
  });

  test('GET /api/document-vault/:id returns document or 404', async () => {
    const res = await request(app).get('/api/document-vault/doc_buyer_roi');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.document.id).toBe('doc_buyer_roi');

    const notFound = await request(app).get('/api/document-vault/non_existent_123');
    expect(notFound.status).toBe(404);
  });

  test('POST /api/document-vault rejects unauthenticated callers with 401', async () => {
    const res = await supertest(app)
      .post('/api/document-vault')
      .send({
        documentName: 'Test Doc',
        fileName: 'test.pdf',
        category: 'marketing_overview',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/document-vault rejects unauthorized role with 403', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: {
        sub: 'usr-vendor-1',
        email: 'vendor@procucev.com',
        role: 'vendor',
      },
    });

    const res = await request(app)
      .post('/api/document-vault')
      .set('Authorization', 'Bearer vendor-token')
      .send({
        documentName: 'Test Doc',
        fileName: 'test.pdf',
        category: 'marketing_overview',
      });

    expect(res.status).toBe(403);
  });

  test('POST /api/document-vault allows category_manager to create document', async () => {
    const res = await request(app)
      .post('/api/document-vault')
      .set('Authorization', 'Bearer valid-cm-token')
      .send({
        documentName: 'Brand New Rate Card',
        fileName: 'new_rate_card.pdf',
        category: 'rate_cards',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.document.documentName).toBe('Brand New Rate Card');
  });

  test('PUT /api/document-vault/:id rejects unauthenticated and allows authorized', async () => {
    const unauth = await supertest(app)
      .put('/api/document-vault/doc_buyer_roi')
      .send({ documentName: 'Updated' });
    expect(unauth.status).toBe(401);

    const auth = await request(app)
      .put('/api/document-vault/doc_buyer_roi')
      .set('Authorization', 'Bearer valid-cm-token')
      .send({ documentName: 'Updated Document Name' });
    expect(auth.status).toBe(200);
    expect(auth.body.document.documentName).toBe('Updated Document Name');
  });

  test('DELETE /api/document-vault/:id rejects unauthenticated and allows authorized', async () => {
    const unauth = await supertest(app).delete('/api/document-vault/doc_buyer_roi');
    expect(unauth.status).toBe(401);

    const auth = await request(app)
      .delete('/api/document-vault/doc_buyer_roi')
      .set('Authorization', 'Bearer valid-cm-token');
    expect(auth.status).toBe(200);
    expect(auth.body.success).toBe(true);
  });
});
