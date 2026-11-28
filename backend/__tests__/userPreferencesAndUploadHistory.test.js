const express = require('express');
const request = require('supertest');

jest.mock('../src/db/pool', () => ({
  hasStorage: jest.fn(() => true),
  query: jest.fn(),
  rows: jest.fn(),
}));

jest.mock('../src/services/loggerService', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    audit: jest.fn(),
  },
}));

jest.mock('../src/services/storeService', () => ({
  getBuyerAccountByEmail: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (req.headers['x-test-unauth'] === 'true') {
      req.user = null;
      return next();
    }
    req.user = {
      sub: req.headers['x-test-sub'] || 'usr-1',
      email: req.headers['x-test-email'] !== undefined ? req.headers['x-test-email'] : 'buyer@acme.com',
      role: req.headers['x-test-role'] || 'buyer',
      orgId: req.headers['x-test-org'] || 'org-1',
    };
    return next();
  },
  requireRole: () => (req, res, next) => next(),
  requireVendorDirectorySession: (req, res, next) => next(),
}));

const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const userPreferencesQueries = require('../src/db/userPreferencesQueries');
const vendorUploadHistoryQueries = require('../src/db/vendorUploadHistoryQueries');
const userPreferencesRoutes = require('../src/routes/userPreferences');
const vendorUploadHistoryController = require('../src/controllers/vendorUploadHistoryController');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/user-preferences', userPreferencesRoutes);
  app.get('/api/vendors/upload-history', (req, res, next) => {
    req.user = req.headers['x-test-unauth'] === 'true'
      ? null
      : {
          sub: req.headers['x-test-sub'] || 'usr-1',
          email: req.headers['x-test-email'] !== undefined ? req.headers['x-test-email'] : 'buyer@acme.com',
          role: req.headers['x-test-role'] || 'buyer',
          orgId: req.headers['x-test-org'] || 'org-1',
        };
    return vendorUploadHistoryController.getUploadHistory(req, res, next);
  });
  app.post('/api/vendors/upload-history', (req, res, next) => {
    req.user = req.headers['x-test-unauth'] === 'true'
      ? null
      : {
          sub: req.headers['x-test-sub'] || 'usr-1',
          email: req.headers['x-test-email'] !== undefined ? req.headers['x-test-email'] : 'buyer@acme.com',
          role: req.headers['x-test-role'] || 'buyer',
          orgId: req.headers['x-test-org'] || 'org-1',
        };
    return vendorUploadHistoryController.createUploadHistory(req, res, next);
  });
  app.delete('/api/vendors/upload-history/:id', (req, res, next) => {
    req.user = req.headers['x-test-unauth'] === 'true'
      ? null
      : {
          sub: req.headers['x-test-sub'] || 'usr-1',
          email: req.headers['x-test-email'] !== undefined ? req.headers['x-test-email'] : 'buyer@acme.com',
          role: req.headers['x-test-role'] || 'buyer',
          orgId: req.headers['x-test-org'] || 'org-1',
        };
    return vendorUploadHistoryController.deleteUploadHistory(req, res, next);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ success: false, error: err.message });
  });
  return app;
}

describe('userPreferencesQueries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.hasStorage.mockReturnValue(true);
  });

  test('returns empty/null/false when storage is unconfigured or keys missing', async () => {
    pool.hasStorage.mockReturnValue(false);
    expect(await userPreferencesQueries.getPreferencesForUser('a@b.com')).toEqual({});
    expect(await userPreferencesQueries.upsertPreferenceForUser('a@b.com', 'theme', 'dark')).toBeNull();
    expect(await userPreferencesQueries.deletePreferenceForUser('a@b.com', 'theme')).toBe(false);

    pool.hasStorage.mockReturnValue(true);
    expect(await userPreferencesQueries.getPreferencesForUser('')).toEqual({});
    expect(await userPreferencesQueries.upsertPreferenceForUser('', 'theme', 'dark')).toBeNull();
    expect(await userPreferencesQueries.deletePreferenceForUser('a@b.com', '')).toBe(false);
  });

  test('reads, parses JSON and raw string values, and auto-creates table on missing-table error', async () => {
    pool.query
      .mockRejectedValueOnce(Object.assign(new Error('no such table: user_preferences'), { code: 'SQLITE_ERROR' }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { pref_key: 'theme', pref_value: '"dark"' },
          { pref_key: 'cols', pref_value: [{ key: 'name', visible: true }] },
          { pref_key: 'raw_invalid', pref_value: '{not-json' },
          { pref_key: '', pref_value: 'ignored' },
        ],
      });

    const prefs = await userPreferencesQueries.getPreferencesForUser('User@Example.com');
    expect(prefs).toEqual({
      theme: 'dark',
      cols: [{ key: 'name', visible: true }],
      raw_invalid: '{not-json',
    });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test('rethrows non-missing-table errors and supports upsert & delete', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection reset'));
    await expect(userPreferencesQueries.getPreferencesForUser('a@b.com')).rejects.toThrow('connection reset');

    pool.query.mockResolvedValueOnce({ rows: [] });
    const saved = await userPreferencesQueries.upsertPreferenceForUser('A@B.COM', 'theme', 'dark');
    expect(saved).toEqual({ key: 'theme', value: 'dark' });

    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    expect(await userPreferencesQueries.deletePreferenceForUser('A@B.COM', 'theme')).toBe(true);
  });
});

describe('vendorUploadHistoryQueries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.hasStorage.mockReturnValue(true);
  });

  test('guards against missing storage or empty scope/inputs', async () => {
    pool.hasStorage.mockReturnValue(false);
    expect(await vendorUploadHistoryQueries.listUploadHistory({ ownerKeys: ['org-1'] })).toEqual([]);
    expect(await vendorUploadHistoryQueries.upsertUploadHistory({ ownerKey: 'org-1', fileName: 'a.xlsx' })).toBeNull();
    expect(await vendorUploadHistoryQueries.deleteUploadHistory({ id: 'up-1', ownerKeys: ['org-1'] })).toBe(0);

    pool.hasStorage.mockReturnValue(true);
    expect(await vendorUploadHistoryQueries.listUploadHistory({})).toEqual([]);
    expect(await vendorUploadHistoryQueries.upsertUploadHistory({ ownerKey: '' })).toBeNull();
    expect(await vendorUploadHistoryQueries.deleteUploadHistory({ id: '', ownerKeys: ['org-1'] })).toBe(0);
    expect(await vendorUploadHistoryQueries.deleteUploadHistory({ id: 'up-1', ownerKeys: [], buyerIds: [] })).toBe(0);
  });

  test('lists batches, auto-creates table on 42P01, and parses record payloads safely', async () => {
    pool.query
      .mockRejectedValueOnce(Object.assign(new Error('relation "vendor_upload_history" does not exist'), { code: '42P01' }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'up-1',
            file_name: 'vendors.xlsx',
            created_at: new Date('2026-11-25T10:00:00.000Z'),
            total_count: 10,
            imported_count: 8,
            duplicate_count: 2,
            failed_count: 0,
            onboarding_failed_count: 0,
            onboarding_skipped_count: 1,
            status: 'COMPLETED',
            buyer_id: 'buyer-1',
            buyer_email: 'buyer@acme.com',
            role: 'buyer',
            records_json: JSON.stringify([{ name: 'Alpha' }]),
          },
          {
            id: 'up-2',
            file_name: 'bad-json.xlsx',
            created_at: '2026-11-24T10:00:00.000Z',
            total_count: 1,
            imported_count: 1,
            duplicate_count: 0,
            failed_count: 0,
            records_json: '{bad',
          },
          {
            id: 'up-3',
            file_name: 'array-records.xlsx',
            created_at: '2026-11-23T10:00:00.000Z',
            records_json: [{ name: 'Beta' }],
          },
        ],
      });

    const list = await vendorUploadHistoryQueries.listUploadHistory({
      ownerKeys: ['org-1'],
      buyerIds: ['buyer-1'],
      limit: 20,
    });
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      id: 'up-1',
      fileName: 'vendors.xlsx',
      imported: 8,
      duplicates: 2,
      records: [{ name: 'Alpha' }],
    });
    expect(list[1].records).toEqual([]);
    expect(list[2].records).toEqual([{ name: 'Beta' }]);

    // Owner-only and buyerId-only scope predicates + non-array JSON payload
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'up-4', file_name: 'obj.xlsx', records_json: '{"a":1}' }] });
    const ownerOnly = await vendorUploadHistoryQueries.listUploadHistory({ ownerKeys: ['org-1'] });
    expect(ownerOnly[0].records).toEqual([]);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await vendorUploadHistoryQueries.listUploadHistory({ buyerIds: ['buyer-1'] })).toEqual([]);
  });

  test('upserts with DB returning row and fallback return, and deletes by id/fileName', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'up-10',
          file_name: 'batch.xlsx',
          created_at: '2026-11-25T12:00:00.000Z',
          total_count: 5,
          imported_count: 5,
          duplicate_count: 0,
          failed_count: 0,
          records_json: '[]',
        },
      ],
    });
    const saved = await vendorUploadHistoryQueries.upsertUploadHistory({
      id: 'up-10',
      ownerKey: 'org-1',
      buyerId: 'buyer-1',
      buyerEmail: 'buyer@acme.com',
      fileName: 'batch.xlsx',
      total: 5,
      imported: 5,
      records: [{ name: 'A' }],
    });
    expect(saved.id).toBe('up-10');

    pool.query.mockResolvedValueOnce({ rows: [] });
    const fallbackSaved = await vendorUploadHistoryQueries.upsertUploadHistory({
      ownerKey: 'org-1',
      buyerId: 'buyer-2',
      buyerEmail: 'buyer2@acme.com',
      fileName: 'fallback.xlsx',
      total: 2,
      imported: 2,
      duplicates: 1,
      failed: 0,
      onboardingFailed: 1,
      onboardingSkipped: 1,
    });
    expect(fallbackSaved.fileName).toBe('fallback.xlsx');
    expect(fallbackSaved.buyerId).toBe('buyer-2');

    pool.query.mockResolvedValueOnce({ rows: [] });
    const minimalSaved = await vendorUploadHistoryQueries.upsertUploadHistory({
      ownerKey: 'org-1',
      fileName: 'minimal.xlsx',
    });
    expect(minimalSaved.total).toBe(0);

    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const deleted = await vendorUploadHistoryQueries.deleteUploadHistory({
      id: 'up-10',
      fileName: 'batch.xlsx',
      ownerKeys: ['org-1'],
      buyerIds: ['buyer-1'],
    });
    expect(deleted).toBe(1);

    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    expect(
      await vendorUploadHistoryQueries.deleteUploadHistory({ fileName: 'only-file.xlsx', buyerIds: ['buyer-1'] })
    ).toBe(0);
    pool.query.mockResolvedValueOnce({});
    expect(
      await vendorUploadHistoryQueries.deleteUploadHistory({ id: 'up-11', ownerKeys: ['org-1'] })
    ).toBe(0);

    pool.query.mockRejectedValueOnce(new Error('db timeout'));
    await expect(
      vendorUploadHistoryQueries.deleteUploadHistory({ id: 'up-10', ownerKeys: ['org-1'] })
    ).rejects.toThrow('db timeout');
  });
});

describe('userPreferences & vendorUploadHistory routes/controllers', () => {
  const app = createTestApp();

  beforeEach(() => {
    jest.clearAllMocks();
    pool.hasStorage.mockReturnValue(true);
    storeService.getBuyerAccountByEmail.mockResolvedValue({
      id: 'buyer-acc-1',
      corporateEmail: 'buyer@acme.com',
    });
  });

  test('GET/PUT/DELETE /api/user-preferences cover auth, validation, storage, and errors', async () => {
    const unauthRes = await request(app).get('/api/user-preferences').set('x-test-unauth', 'true');
    expect(unauthRes.status).toBe(401);

    pool.query.mockResolvedValueOnce({ rows: [{ pref_key: 'theme', pref_value: '"dark"' }] });
    const getRes = await request(app).get('/api/user-preferences');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ success: true, data: { theme: 'dark' } });

    pool.hasStorage.mockReturnValue(false);
    const noDbGet = await request(app).get('/api/user-preferences');
    expect(noDbGet.body).toEqual({ success: true, data: {} });
    const noDbPut = await request(app).put('/api/user-preferences/theme').send({ value: 'light' });
    expect(noDbPut.status).toBe(200);
    const noDbDel = await request(app).delete('/api/user-preferences/theme');
    expect(noDbDel.status).toBe(200);

    pool.hasStorage.mockReturnValue(true);
    const badKeyPut = await request(app).put('/api/user-preferences/invalid key!').send({ value: 'dark' });
    expect(badKeyPut.status).toBe(400);

    const missingValPut = await request(app).put('/api/user-preferences/theme').send({});
    expect(missingValPut.status).toBe(400);

    const hugeValPut = await request(app)
      .put('/api/user-preferences/theme')
      .send({ value: 'x'.repeat(40000) });
    expect(hugeValPut.status).toBe(400);

    pool.query.mockResolvedValueOnce({ rows: [] });
    const okPut = await request(app).put('/api/user-preferences/theme').send({ value: 'dark' });
    expect(okPut.status).toBe(200);
    expect(okPut.body.data).toEqual({ key: 'theme', value: 'dark' });

    const unauthPut = await request(app)
      .put('/api/user-preferences/theme')
      .set('x-test-unauth', 'true')
      .send({ value: 'dark' });
    expect(unauthPut.status).toBe(401);

    const unauthDel = await request(app)
      .delete('/api/user-preferences/theme')
      .set('x-test-unauth', 'true');
    expect(unauthDel.status).toBe(401);

    const badKeyDel = await request(app).delete('/api/user-preferences/bad key!');
    expect(badKeyDel.status).toBe(400);

    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const okDel = await request(app).delete('/api/user-preferences/theme');
    expect(okDel.status).toBe(200);

    pool.query.mockRejectedValueOnce(new Error('get boom'));
    expect((await request(app).get('/api/user-preferences')).status).toBe(500);
    pool.query.mockRejectedValueOnce(new Error('put boom'));
    expect((await request(app).put('/api/user-preferences/theme').send({ value: 'dark' })).status).toBe(500);
    pool.query.mockRejectedValueOnce(new Error('del boom'));
    expect((await request(app).delete('/api/user-preferences/theme')).status).toBe(500);

    // Fallback user key from sub when email is blank
    pool.query.mockResolvedValueOnce({ rows: [] });
    const subOnlyRes = await request(app).get('/api/user-preferences').set('x-test-email', '').set('x-test-sub', 'sub-only-user');
    expect(subOnlyRes.status).toBe(200);
  });

  test('GET/POST/DELETE /api/vendors/upload-history cover buyer, CM, validation, no-DB, and errors', async () => {
    expect((await request(app).get('/api/vendors/upload-history').set('x-test-unauth', 'true')).status).toBe(401);
    expect((await request(app).post('/api/vendors/upload-history').set('x-test-unauth', 'true').send({ fileName: 'a.xlsx' })).status).toBe(401);
    expect((await request(app).delete('/api/vendors/upload-history/up-1').set('x-test-unauth', 'true')).status).toBe(401);

    // Direct controller call with blank id and no fileName returns 400
    const mockRes400 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await vendorUploadHistoryController.deleteUploadHistory(
      { user: { sub: 'u1', email: 'buyer@acme.com', role: 'buyer' }, params: { id: '  ' }, query: {} },
      mockRes400,
      jest.fn()
    );
    expect(mockRes400.status).toHaveBeenCalledWith(400);

    // Buyer account lookup rejection falls back cleanly to org/email scope
    storeService.getBuyerAccountByEmail.mockRejectedValueOnce(new Error('lookup failed'));
    pool.query.mockResolvedValueOnce({ rows: [] });
    const buyerFallbackRes = await request(app).get('/api/vendors/upload-history');
    expect(buyerFallbackRes.status).toBe(200);

    pool.query.mockResolvedValueOnce({ rows: [] });
    const cmGet = await request(app)
      .get('/api/vendors/upload-history?limit=10')
      .set('x-test-role', 'category_manager')
      .set('x-test-email', 'cm@procucev.com');
    expect(cmGet.status).toBe(200);
    expect(cmGet.body.data).toEqual([]);

    const badPost = await request(app).post('/api/vendors/upload-history').send({});
    expect(badPost.status).toBe(400);

    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'up-99',
          file_name: 'sheet.xlsx',
          created_at: '2026-11-25T15:00:00.000Z',
          total_count: 3,
          imported_count: 3,
          duplicate_count: 0,
          failed_count: 0,
          records_json: '[{"name":"V1"}]',
        },
      ],
    });
    const okPost = await request(app)
      .post('/api/vendors/upload-history')
      .send({
        id: 'up-99',
        fileName: 'sheet.xlsx',
        total: 3,
        imported: 3,
        records: [{ name: 'V1' }],
      });
    expect(okPost.status).toBe(201);
    expect(okPost.body.data.id).toBe('up-99');

    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const okDel = await request(app).delete('/api/vendors/upload-history/up-99?fileName=sheet.xlsx');
    expect(okDel.status).toBe(200);
    expect(okDel.body.data.deletedCount).toBe(1);

    pool.hasStorage.mockReturnValue(false);
    expect((await request(app).get('/api/vendors/upload-history')).body.data).toEqual([]);
    expect((await request(app).post('/api/vendors/upload-history').send({ fileName: 'nodb.xlsx' })).status).toBe(201);
    expect((await request(app).delete('/api/vendors/upload-history/up-99')).body.data.deletedCount).toBe(0);

    pool.hasStorage.mockReturnValue(true);
    pool.query.mockRejectedValueOnce(new Error('list err'));
    expect((await request(app).get('/api/vendors/upload-history')).status).toBe(500);
    pool.query.mockRejectedValueOnce(new Error('save err'));
    expect((await request(app).post('/api/vendors/upload-history').send({ fileName: 'a.xlsx' })).status).toBe(500);
    pool.query.mockRejectedValueOnce(new Error('del err'));
    expect((await request(app).delete('/api/vendors/upload-history/up-1')).status).toBe(500);
  });
});
