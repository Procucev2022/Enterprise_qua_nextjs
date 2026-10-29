const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const vendorDirectorySessionQueries = require('../src/db/vendorDirectorySessionQueries');
const domainQueries = require('../src/db/domainQueries');
const authSessionQueries = require('../src/db/authSessionQueries');
const pool = require('../src/db/pool');
const { AUTH_MESSAGES } = require('../src/config/constants');
const { getTestToken } = require('./testHelpers');

describe('Protected Vendor Directory Routes (/api/vendors/public*)', () => {
  const validEmail = 'cm.lead@procucev.com';
  let activeSessionId;
  let validDirectoryToken;

  beforeEach(async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    vendorDirectorySessionQueries.clearMemoryStoreForTesting();
    jest.spyOn(authSessionQueries, 'isTokenRevoked').mockResolvedValue(false);

    const session = await vendorDirectorySessionQueries.createSession({
      userUuid: 'cm-user-123',
      email: validEmail,
      role: 'category_manager',
    });
    activeSessionId = session.id;

    validDirectoryToken = authService.generateVendorDirectoryToken(
      { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
      activeSessionId
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Route: GET /api/vendors/public', () => {
    test('rejects anonymous unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/vendors/public');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.NO_SESSION_TOKEN);
    });

    test('rejects authenticated buyer request with 403', async () => {
      const buyerToken = getTestToken('buyer');
      const res = await request(app)
        .get('/api/vendors/public')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('permission');
    });

    test('rejects authenticated admin request with 403 (strict CM only)', async () => {
      const adminToken = getTestToken('admin');
      const res = await request(app)
        .get('/api/vendors/public')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('permission');
    });

    test('rejects Category Manager main-app token without vendor_directory scope (403)', async () => {
      const cmMainToken = authService.generateSessionToken({
        id: 'cm-user-123',
        email: validEmail,
        role: 'category_manager',
      });

      const res = await request(app)
        .get('/api/vendors/public')
        .set('Authorization', `Bearer ${cmMainToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Vendor Directory session');
    });

    test('rejects Category Manager token with closed or non-existent session (401)', async () => {
      const orphanToken = authService.generateVendorDirectoryToken(
        { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
        'non-existent-session-uuid'
      );

      const res = await request(app)
        .get('/api/vendors/public')
        .set('Authorization', `Bearer ${orphanToken}`);

      expect(res.status).toBe(401);
      expect(res.body.sessionExpired).toBe(true);
    });

    test('rejects Category Manager session after 5-minute inactivity timeout (401)', async () => {
      // Create session whose last activity was 6 minutes ago
      const expiredSession = await vendorDirectorySessionQueries.createSession({
        userUuid: 'cm-user-123',
        email: validEmail,
        role: 'category_manager',
      });
      const mem = vendorDirectorySessionQueries.getMemoryStoreForTesting();
      if (mem && mem.has(expiredSession.id)) {
        const stored = mem.get(expiredSession.id);
        stored.lastActivityAt = new Date(Date.now() - 360000).toISOString();
        stored.last_activity_at = stored.lastActivityAt;
      }

      const expiredToken = authService.generateVendorDirectoryToken(
        { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
        expiredSession.id
      );

      const res = await request(app)
        .get('/api/vendors/public')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.sessionExpired).toBe(true);
      expect(res.body.inactivityTimeout).toBe(true);

      const sessionAfter = await vendorDirectorySessionQueries.findSessionById(expiredSession.id);
      expect(sessionAfter.status).toBe('CLOSED');
      expect(sessionAfter.logoutReason).toBe('INACTIVITY');
    });

    test('serves directory data with private cache headers for valid Category Manager directory session (200)', async () => {
      jest.spyOn(domainQueries, 'getPublicVendorsPageFromDB').mockResolvedValue({
        rows: [
          {
            id: 'v-101',
            name: 'Apex Industrial Piping',
            major_category: 'Mechanical',
            status: 'VERIFIED SUPPLIER',
            created_at: '2024-01-01T00:00:00Z',
            raw: { id: 'v-101', pan: 'ABCDE1234F', rating: 4.8 },
          },
        ],
        total: 1,
      });

      const res = await request(app)
        .get('/api/vendors/public?page=1&pageSize=24')
        .set('Authorization', `Bearer ${validDirectoryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Apex Industrial Piping');
      expect(res.headers['cache-control']).toContain('private');
      expect(res.headers['cache-control']).toContain('no-store');
    });
  });

  describe('Route: GET /api/vendors/public/filters', () => {
    test('enforces category_manager and directory session protection (401 anonymous, 200 authenticated)', async () => {
      const anonRes = await request(app).get('/api/vendors/public/filters');
      expect(anonRes.status).toBe(401);

      jest.spyOn(domainQueries, 'getPublicVendorFiltersFromDB').mockResolvedValue({
        categories: ['Mechanical', 'Electrical'],
        states: ['Maharashtra', 'Gujarat'],
      });

      const authRes = await request(app)
        .get('/api/vendors/public/filters')
        .set('Authorization', `Bearer ${validDirectoryToken}`);

      expect(authRes.status).toBe(200);
      expect(authRes.body.success).toBe(true);
      expect(authRes.body.data.categories).toContain('Mechanical');
      expect(authRes.headers['cache-control']).toContain('private');
      expect(authRes.headers['cache-control']).toContain('no-store');
    });
  });

  describe('Route: GET /api/vendors/public/:id', () => {
    test('enforces category_manager and directory session protection (401 anonymous, 200 authenticated)', async () => {
      const anonRes = await request(app).get('/api/vendors/public/v-101');
      expect(anonRes.status).toBe(401);

      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
        id: 'v-101',
        name: 'Apex Industrial Piping',
        major_category: 'Mechanical',
        status: 'VERIFIED SUPPLIER',
        created_at: '2024-01-01T00:00:00Z',
        raw: { id: 'v-101', pan: 'ABCDE1234F', rating: 4.8 },
      });

      const authRes = await request(app)
        .get('/api/vendors/public/v-101')
        .set('Authorization', `Bearer ${validDirectoryToken}`);

      expect(authRes.status).toBe(200);
      expect(authRes.body.success).toBe(true);
      expect(authRes.body.data.name).toBe('Apex Industrial Piping');
      expect(authRes.headers['cache-control']).toContain('private');
      expect(authRes.headers['cache-control']).toContain('no-store');
    });
  });

  describe('Obsolete passkey endpoint removal (/api/vendors/directory-auth)', () => {
    test('returns 404 since /directory-auth is retired', async () => {
      const res = await request(app)
        .post('/api/vendors/directory-auth')
        .send({ passcode: 'Procucev@Vendors2026' });

      expect(res.status).toBe(404);
    });
  });
});
