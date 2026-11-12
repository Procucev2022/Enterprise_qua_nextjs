const request = require('supertest');
const express = require('express');
const loginLogsRoutes = require('../src/routes/loginLogs');
const loginLogsQueries = require('../src/db/loginLogsQueries');
const loginLogsController = require('../src/controllers/loginLogsController');
const pool = require('../src/db/pool');
const authService = require('../src/services/authService');

const adminToken = authService.generateSessionToken({
  id: 'cm-admin',
  uuid: 'cm-admin',
  email: 'admin@procucev.com',
  role: 'category_manager',
});

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (!req.headers.authorization && !req.headers['x-skip-auth']) {
    req.headers.authorization = `Bearer ${adminToken}`;
  }
  next();
});
app.use('/api/login-logs', loginLogsRoutes);

// Test-only fixture sessions. They are written directly into the process store so
// each test controls its own telemetry. Production code ships with an empty store.
function seedFixtureSessions() {
  loginLogsQueries.inMemoryLogs.clear();
  const now = Date.now();
  [
    { id: 'log_fixture_1', userId: 'buyer-fixture-1', userName: 'Tata Fixture Buyer', email: 'buyer1@test.local', phoneNumber: '+910000000001', companyName: 'Tata Fixture Co', userType: 'buyer', minutesAgo: 15, durationSeconds: 900, status: 'ACTIVE' },
    { id: 'log_fixture_2', userId: 'vendor-fixture-1', userName: 'Vendor Fixture', email: 'vendor1@test.local', phoneNumber: '+910000000002', companyName: 'Vendor Fixture Co', userType: 'vendor', minutesAgo: 45, durationSeconds: 2700, status: 'ACTIVE' },
    { id: 'log_fixture_3', userId: 'buyer-fixture-2', userName: 'Buyer Two', email: 'buyer2@test.local', phoneNumber: '+910000000003', companyName: 'Buyer Two Co', userType: 'buyer', minutesAgo: 180, durationSeconds: 3600, status: 'LOGGED_OUT' },
    { id: 'log_fixture_4', userId: 'vendor-fixture-2', userName: 'Vendor Two', email: 'vendor2@test.local', phoneNumber: '+910000000004', companyName: 'Vendor Two Co', userType: 'vendor', minutesAgo: 240, durationSeconds: 3600, status: 'LOGGED_OUT' },
    { id: 'log_fixture_5', userId: 'buyer-fixture-3', userName: 'Buyer Three', email: 'buyer3@test.local', phoneNumber: '+910000000005', companyName: 'Buyer Three Co', userType: 'buyer', minutesAgo: 360, durationSeconds: 1800, status: 'TIMED_OUT' },
  ].forEach((fixture) => {
    const loginAt = new Date(now - fixture.minutesAgo * 60 * 1000).toISOString();
    loginLogsQueries.inMemoryLogs.set(fixture.id, {
      ...fixture,
      loginAt,
      logoutAt: fixture.status === 'ACTIVE' ? null : new Date(new Date(loginAt).getTime() + fixture.durationSeconds * 1000).toISOString(),
      ipAddress: '203.0.113.10',
      deviceInfo: 'Test Browser',
      location: 'Test City',
      userAgent: 'test-agent',
      createdAt: loginAt,
      updatedAt: loginAt,
    });
  });
}

describe('Login Logs API & Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedFixtureSessions();
  });

  describe('Authentication & Authorization Gate', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/login-logs').set('x-skip-auth', 'true');
      expect(res.status).toBe(401);
    });

    test('rejects unauthorized roles with 403 on summary and logs', async () => {
      const buyerToken = authService.generateSessionToken({
        id: 'buyer-user',
        email: 'buyer@example.com',
        role: 'buyer',
      });
      const resLogs = await request(app).get('/api/login-logs').set('Authorization', `Bearer ${buyerToken}`);
      expect(resLogs.status).toBe(403);

      const resSummary = await request(app).get('/api/login-logs/summary').set('Authorization', `Bearer ${buyerToken}`);
      expect(resSummary.status).toBe(403);
    });
  });

  describe('GET /api/login-logs (HTTP Endpoint)', () => {
    test('returns list of logs with total count and pagination', async () => {
      const res = await request(app).get('/api/login-logs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(res.body.logs.length).toBeGreaterThan(0);
      expect(res.body.page).toBe(1);
      expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
    });

    test('filters logs by userType = buyer', async () => {
      const res = await request(app).get('/api/login-logs?userType=buyer');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logs.every((l) => l.userType === 'buyer')).toBe(true);
    });

    test('filters logs by userType = vendor', async () => {
      const res = await request(app).get('/api/login-logs?userType=vendor');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logs.every((l) => l.userType === 'vendor')).toBe(true);
    });

    test('filters logs by status = ACTIVE', async () => {
      const res = await request(app).get('/api/login-logs?status=ACTIVE');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logs.every((l) => l.status === 'ACTIVE')).toBe(true);
    });

    test('filters logs by search query matching company or name', async () => {
      const res = await request(app).get('/api/login-logs?search=Tata');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.logs.length).toBeGreaterThan(0);
      expect(res.body.logs[0].companyName).toContain('Tata');
    });

    test('filters logs by dateRangePreset presets (today, yesterday, last7, last30, startDate)', async () => {
      const resToday = await request(app).get('/api/login-logs?dateRangePreset=today');
      expect(resToday.status).toBe(200);
      expect(resToday.body.success).toBe(true);

      const resYesterday = await request(app).get('/api/login-logs?dateRangePreset=yesterday');
      expect(resYesterday.status).toBe(200);

      const resLast7 = await request(app).get('/api/login-logs?dateRangePreset=last7');
      expect(resLast7.status).toBe(200);

      const resLast30 = await request(app).get('/api/login-logs?dateRangePreset=last30');
      expect(resLast30.status).toBe(200);

      const resCustom = await request(app).get('/api/login-logs?startDate=2026-01-01');
      expect(resCustom.status).toBe(200);

      const resInvalidDate = await request(app).get('/api/login-logs?startDate=invalid-date&endDate=also-invalid');
      expect(resInvalidDate.status).toBe(200);
      expect(resInvalidDate.body.success).toBe(true);
    });

    test('handles controller failure gracefully with 500 status', async () => {
      jest.spyOn(loginLogsQueries, 'listLoginLogs').mockRejectedValueOnce(new Error('DB failure'));

      const res = await request(app).get('/api/login-logs');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve login session logs');
    });
  });

  describe('GET /api/login-logs/summary', () => {
    test('returns real-time KPI metrics summary', async () => {
      const res = await request(app).get('/api/login-logs/summary');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary).toHaveProperty('totalToday');
      expect(res.body.summary).toHaveProperty('activeNow');
      expect(res.body.summary).toHaveProperty('buyerLogins');
      expect(res.body.summary).toHaveProperty('sellerLogins');
      expect(res.body.summary).toHaveProperty('avgDurationMinutes');
    });

    test('handles summary retrieval failure with 500 status', async () => {
      jest.spyOn(loginLogsQueries, 'getLoginLogsSummary').mockRejectedValueOnce(new Error('Summary error'));

      const res = await request(app).get('/api/login-logs/summary');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve login logs summary');
    });
  });

  describe('POST /api/login-logs/event', () => {
    test('records a new login event', async () => {
      const payload = {
        userName: 'Vikram Malhotra',
        email: 'vikram.m@jsw.in',
        companyName: 'JSW Steel Ltd',
        phoneNumber: '+91 98200 11223',
        userType: 'buyer',
        ipAddress: '103.20.10.5',
      };

      const sessionToken = authService.generateSessionToken({
        id: 'buyer-vikram',
        email: 'vikram.m@jsw.in',
        name: 'Vikram Malhotra',
        role: 'buyer',
      });
      const res = await request(app)
        .post('/api/login-logs/event')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send(payload);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.entry.email).toBe('vikram.m@jsw.in');
      expect(res.body.entry.userType).toBe('buyer');
      expect(res.body.entry.status).toBe('ACTIVE');
    });

    test('ignores identity sent in the body and records the session user', async () => {
      const sessionToken = authService.generateSessionToken({
        id: 'buyer-session',
        email: 'session-user@test.local',
        role: 'buyer',
      });
      const res = await request(app)
        .post('/api/login-logs/event')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ email: 'spoofed@test.local', userName: 'Spoofed Name', userType: 'vendor' });
      expect(res.status).toBe(201);
      expect(res.body.entry.email).toBe('session-user@test.local');
      expect(res.body.entry.userName).toBeNull();
      expect(res.body.entry.userType).toBe('buyer');
    });

    test('records a logout event and sets status to LOGGED_OUT', async () => {
      // First ensure an active session exists
      await request(app).post('/api/login-logs/event').send({
        userName: 'Logout Test User',
        email: 'logout.test@enterprise.com',
        companyName: 'Logout Corp',
        phoneNumber: '+91 99999 12345',
        userType: 'vendor',
      });

      // Now logout
      const res = await request(app).post('/api/login-logs/event').send({
        type: 'logout',
        email: 'logout.test@enterprise.com',
        logoutReason: 'MANUAL',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.entry.status).toBe('LOGGED_OUT');
      expect(res.body.entry.logoutAt).toBeDefined();
    });

    test('handles logout event with TIMEOUT reason', async () => {
      await request(app).post('/api/login-logs/event').send({
        userName: 'Timeout User',
        email: 'timeout.user@enterprise.com',
        companyName: 'Timeout Corp',
        phoneNumber: '+91 99999 54321',
        userType: 'buyer',
      });

      const res = await request(app).post('/api/login-logs/event').send({
        type: 'logout',
        email: 'timeout.user@enterprise.com',
        logoutReason: 'TIMEOUT',
      });

      expect(res.status).toBe(200);
      expect(res.body.entry.status).toBe('TIMED_OUT');
    });

    test('handles recordEvent failure with 500 status', async () => {
      jest.spyOn(loginLogsQueries, 'recordLoginLog').mockRejectedValueOnce(new Error('Event write error'));

      const res = await request(app).post('/api/login-logs/event').send({
        userName: 'Fail User',
        email: 'fail@test.com',
      });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to record session log event');
    });
  });

  describe('PostgreSQL Database Pool Branch Coverage', () => {
    const rawSqlRow = {
      id: 'log_sql_1',
      user_id: 'USER-SQL-1',
      user_name: 'SQL User',
      email: 'sql.user@example.com',
      phone_number: '+91 99887 76655',
      company_name: 'SQL Technologies',
      user_type: 'buyer',
      login_at: new Date().toISOString(),
      logout_at: null,
      duration_seconds: 0,
      status: 'ACTIVE',
      ip_address: '10.0.0.1',
      device_info: 'Chrome / Windows',
      location: 'Bangalore, IN',
      user_agent: 'Mozilla/5.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    beforeEach(() => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('listLoginLogs returns filtered logs from in-memory repository', async () => {
      const result = await loginLogsQueries.listLoginLogs({
        userType: 'buyer',
        status: 'ACTIVE',
        search: 'Enterprise',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        limit: 10,
      });

      expect(Array.isArray(result.logs)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    test('listLoginLogs returns logs with default parameters', async () => {
      const result = await loginLogsQueries.listLoginLogs();
      expect(result.logs.length).toBeGreaterThan(0);
    });

    test('recordLoginLog records new login log in memory and logs info', async () => {
      const entry = await loginLogsQueries.recordLoginLog({
        userId: 'USER-MEM-2',
        userName: 'Memory Vendor',
        email: 'memory.vendor@example.com',
        companyName: 'Memory Industrial',
        userType: 'vendor',
      });

      expect(entry).toBeDefined();
      expect(entry.userType).toBe('vendor');
      expect(entry.userName).toBe('Memory Vendor');
    });

    test('recordLoginLog preserves entry in memory even with partial payload', async () => {
      const entry = await loginLogsQueries.recordLoginLog({
        userId: 'USER-MEM-PARTIAL',
        userName: 'Partial Vendor',
        email: 'partial.vendor@example.com',
      });

      expect(entry.userName).toBe('Partial Vendor');
    });

    test('recordLogoutLog updates session when active session found', async () => {
      await loginLogsQueries.recordLoginLog({
        userId: 'USER-LOGOUT-MEM',
        userName: 'Logout Target',
        email: 'logout.target@example.com',
      });

      const entry = await loginLogsQueries.recordLogoutLog({
        email: 'logout.target@example.com',
        logoutReason: 'MANUAL',
      });

      expect(entry).not.toBeNull();
      expect(entry.status).toBe('LOGGED_OUT');
    });

    test('recordLogoutLog updates session status to TIMEOUT', async () => {
      await loginLogsQueries.recordLoginLog({
        userId: 'USER-LOGOUT-TO',
        userName: 'Logout Timeout',
        email: 'logout.timeout@example.com',
      });

      const entry = await loginLogsQueries.recordLogoutLog({
        email: 'logout.timeout@example.com',
        logoutReason: 'TIMEOUT',
      });

      expect(entry.status).toBe('TIMED_OUT');
    });

    test('recordLogoutLog returns null when user session is not found', async () => {
      const entry = await loginLogsQueries.recordLogoutLog({
        email: 'non.existent.session@example.com',
      });
      expect(entry).toBeNull();
    });

    test('getLoginLogsSummary calculates summary from in-memory telemetry', async () => {
      const summary = await loginLogsQueries.getLoginLogsSummary();
      expect(typeof summary.totalToday).toBe('number');
      expect(typeof summary.activeNow).toBe('number');
      expect(typeof summary.buyerLogins).toBe('number');
      expect(typeof summary.sellerLogins).toBe('number');
      expect(typeof summary.avgDurationMinutes).toBe('number');
      expect(typeof summary.todayPeakHour).toBe('string');
    });
  });

  describe('Direct Controller Method Coverage', () => {
    test('listLogs handles empty query object defaults', async () => {
      const req = {};
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await loginLogsController.listLogs(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          page: 1,
        })
      );
    });

    test('listLogs handles explicit page and limit query params', async () => {
      const req = {
        query: { page: '2', limit: '20' },
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await loginLogsController.listLogs(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          page: 2,
        })
      );
    });

    test('recordEvent handles empty body object defaults', async () => {
      const req = { body: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await loginLogsController.recordEvent(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });
  });

  describe('Helper Functions & Edge Cases', () => {
    test('escapeLikeWildcards escapes wildcards properly', () => {
      expect(loginLogsQueries.escapeLikeWildcards('test%_\\str')).toBe('test\\%\\_\\\\str');
      expect(loginLogsQueries.escapeLikeWildcards(null)).toBe('');
      expect(loginLogsQueries.escapeLikeWildcards(123)).toBe('');
    });

    test('safeIsoDate parses valid dates and safely returns null on invalid dates', () => {
      expect(loginLogsQueries.safeIsoDate('2026-11-05T10:00:00Z')).toBe('2026-11-05T10:00:00.000Z');
      expect(loginLogsQueries.safeIsoDate('invalid-date-string')).toBeNull();
      expect(loginLogsQueries.safeIsoDate(null)).toBeNull();
      expect(loginLogsQueries.safeIsoDate('')).toBeNull();
    });

    test('mapRow returns null on null/undefined input', () => {
      expect(loginLogsQueries.mapRow(null)).toBeNull();
      expect(loginLogsQueries.mapRow(undefined)).toBeNull();
    });

    test('mapRow maps row and defaults safely with snake_case and camelCase fields', () => {
      const row1 = loginLogsQueries.mapRow({
        id: 'r1',
        user_name: 'Name 1',
        email: 'email@test.com',
        logout_at: '2026-11-05T12:00:00Z',
        duration_seconds: 180,
      });
      expect(row1.userName).toBe('Name 1');
      expect(row1.userType).toBeNull();
      expect(row1.status).toBeNull();
      expect(row1.durationSeconds).toBe(180);
      expect(row1.logoutAt).toBe('2026-11-05T12:00:00.000Z');

      const row2 = loginLogsQueries.mapRow({
        id: 'r2',
        userId: 'U-2',
        userName: 'Name 2',
        companyName: 'Company 2',
        phoneNumber: '+91 99999 88888',
        userType: 'vendor',
        ipAddress: '1.2.3.4',
        deviceInfo: 'Safari / macOS',
        location: 'Delhi',
        userAgent: 'Safari',
        createdAt: '2026-11-05T10:00:00Z',
        updatedAt: '2026-11-05T11:00:00Z',
        logoutAt: '2026-11-05T11:00:00Z',
      });
      expect(row2.userId).toBe('U-2');
      expect(row2.userType).toBe('vendor');
      expect(row2.ipAddress).toBe('1.2.3.4');

      const row3 = loginLogsQueries.mapRow({});
      expect(row3.id).toBeNull();
      expect(row3.userId).toBeNull();
      expect(row3.userName).toBeNull();
      expect(row3.email).toBeNull();
      expect(row3.logoutAt).toBeNull();
      expect(row3.ipAddress).toBeNull();
      expect(row3.loginAt).toBeNull();
    });

    test('recordLogoutLog finds and updates session matching userUuid', async () => {
      await loginLogsQueries.recordLoginLog({
        userId: 'USER-UUID-MATCH',
        userName: 'UUID User',
        email: 'uuid.user@example.com',
      });

      const entry = await loginLogsQueries.recordLogoutLog({
        userUuid: 'USER-UUID-MATCH',
        logoutReason: 'TIMEOUT',
      });

      expect(entry).not.toBeNull();
      expect(entry.status).toBe('TIMED_OUT');
    });
  });
});
