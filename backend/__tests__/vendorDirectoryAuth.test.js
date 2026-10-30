const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');
const identityQueries = require('../src/db/identityQueries');
const authSessionQueries = require('../src/db/authSessionQueries');
const vendorDirectorySessionQueries = require('../src/db/vendorDirectorySessionQueries');
const mailerService = require('../src/services/mailerService');
const pool = require('../src/db/pool');
const { AUTH_MESSAGES, VENDOR_DIRECTORY_AUTH_CONFIG } = require('../src/config/constants');

function cmRecord(overrides = {}) {
  return {
    id: 'cm-user-123',
    email: 'cm.lead@procucev.com',
    name: 'Category Manager Lead',
    role: 'category_manager',
    rawRoleName: 'CategoryManager',
    orgId: 'org-procucev-internal',
    orgName: 'Procucev Inc',
    status: 'ACTIVE',
    isActive: true,
    isApproved: true,
    ...overrides,
  };
}

describe('Category Manager Vendor Directory Authentication', () => {
  const validEmail = 'cm.lead@procucev.com';

  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    vendorDirectorySessionQueries.clearMemoryStoreForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Route: POST /api/auth/vendor-directory/request-otp', () => {
    test('successfully generates and sends OTP for valid Category Manager', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true });

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.email).toBe(validEmail);
      expect(res.body.expiresInSeconds).toBe(VENDOR_DIRECTORY_AUTH_CONFIG.OTP_TTL_SECONDS);
      expect(res.body.message).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_SENT);
    });

    test('rejects request with missing email (400)', async () => {
      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    test('rejects non-procucev domain emails (400)', async () => {
      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: 'user@gmail.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('@procucev.com');
    });

    test('allows any active company employee with @procucev.com email to request OTP', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord({ role: 'buyer' }));
      jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true });

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.email).toBe(validEmail);
    });

    test('rejects when account is inactive (403)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord({ isActive: false }));

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_CM_ONLY);
    });

    test('allows employee not yet in DB to request OTP', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true });

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: 'new.employee@procucev.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('handles identity query database throw gracefully and still allows OTP dispatch', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue({ success: true });

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('handles saveOtp storage failure (400)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'saveOtp').mockRejectedValue(new Error('Storage disk failure'));

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(AUTH_MESSAGES.OTP_STORAGE_FAILED);
    });

    test('succeeds even if mailerService throws error (local/test fallback)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue(true);
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('SMTP down'));

      const res = await request(app)
        .post('/api/auth/vendor-directory/request-otp')
        .send({ email: validEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.email).toBe(validEmail);
    });
  });

  describe('Route: POST /api/auth/vendor-directory/verify-otp', () => {
    test('successfully verifies OTP, creates session and returns scoped token', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '654321',
        expiresAt: Date.now() + 60000,
        attempts: 0,
      });
      const deleteOtpSpy = jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '654321' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.user.role).toBe('category_manager');
      expect(deleteOtpSpy).toHaveBeenCalled();

      // Verify token decoded claims
      const decoded = authService.verifySessionToken(res.body.token);
      expect(decoded.valid).toBe(true);
      expect(decoded.user.scope).toBe('vendor_directory');
      expect(decoded.user.sessionId).toBe(res.body.sessionId);
    });

    test('successfully verifies OTP and provisions directory session for employee not pre-existing in DB', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 0,
      });
      const deleteOtpSpy = jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: 'mukul.rai@procucev.com', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('mukul.rai@procucev.com');
      expect(res.body.user.name).toBe('Mukul Rai');
      expect(deleteOtpSpy).toHaveBeenCalled();
    });

    test('rejects missing or malformed inputs (400)', async () => {
      const res1 = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '123' }); // short code

      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);

      const res2 = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: 'invalid-email', code: '123456' });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
    });

    test('rejects when no OTP found or already consumed (401)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_INVALID);
    });

    test('rejects expired OTP (401)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '123456',
        expiresAt: Date.now() - 5000,
        attempts: 0,
      });
      const deleteOtpSpy = jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_EXPIRED);
      expect(deleteOtpSpy).toHaveBeenCalled();
    });

    test('rejects when max attempts exceeded (401)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: VENDOR_DIRECTORY_AUTH_CONFIG.MAX_OTP_ATTEMPTS,
      });
      const deleteOtpSpy = jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_MAX_ATTEMPTS);
      expect(deleteOtpSpy).toHaveBeenCalled();
    });

    test('rejects incorrect OTP and increments attempt counter (401)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord());
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 1,
      });
      const incrementSpy = jest.spyOn(authSessionQueries, 'incrementOtpAttempts').mockResolvedValue(2);

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '999999' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_INVALID);
      expect(incrementSpy).toHaveBeenCalled();
    });

    test('rejects verification if user account is deactivated (403)', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord({ isActive: false }));

      const res = await request(app)
        .post('/api/auth/vendor-directory/verify-otp')
        .send({ email: validEmail, code: '123456' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(AUTH_MESSAGES.VENDOR_DIRECTORY_CM_ONLY);
    });
  });

  describe('Directory session closure on Logout (/api/auth/logout)', () => {
    test('closes active directory session when logging out with directory token', async () => {
      const session = await vendorDirectorySessionQueries.createSession({
        userUuid: 'cm-user-123',
        email: validEmail,
        role: 'category_manager',
      });

      const token = authService.generateVendorDirectoryToken(
        { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
        session.id
      );

      jest.spyOn(authSessionQueries, 'isTokenRevoked').mockResolvedValue(false);
      jest.spyOn(authSessionQueries, 'revokeToken').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: validEmail, logoutReason: 'INACTIVITY' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const closedSession = await vendorDirectorySessionQueries.findSessionById(session.id);
      expect(closedSession.status).toBe('CLOSED');
      expect(closedSession.logoutReason).toBe('INACTIVITY');
      expect(closedSession.logoutAt).toBeDefined();
    });

    test('handles closeSession error during logout gracefully', async () => {
      const token = authService.generateVendorDirectoryToken(
        { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
        'session-error-id'
      );
      jest.spyOn(vendorDirectorySessionQueries, 'closeSession').mockRejectedValue(new Error('DB err'));
      jest.spyOn(authSessionQueries, 'isTokenRevoked').mockResolvedValue(false);
      jest.spyOn(authSessionQueries, 'revokeToken').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: validEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('returns 503 when token revocation fails', async () => {
      const token = authService.generateVendorDirectoryToken(
        { id: 'cm-user-123', email: validEmail, role: 'category_manager' },
        'session-test-id'
      );
      jest.spyOn(authService, 'revokeSessionToken').mockResolvedValue(false);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: validEmail });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe(AUTH_MESSAGES.LOGOUT_REVOCATION_FAILED);
    });
  });

  describe('authController buyer onboarding branches', () => {
    test('completeBuyerOnboarding returns 400 on invalid payload', async () => {
      const req = { body: {}, user: { email: validEmail } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await authController.completeBuyerOnboarding(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
    });

    test('completeBuyerOnboarding handles service error and fallback', async () => {
      const req = {
        body: {
          emailOtp: '123456',
          mobile: '9876543210',
          mobileOtp: '654321',
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword123!',
          companyName: 'Acme Corp',
          contactName: 'John Buyer',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          address: '123 Main St',
          gstin: '27AAPFU0939F1ZV',
          pan: 'AAPFU0939F',
        },
        user: { email: validEmail },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      jest.spyOn(authService, 'completeBuyerOnboarding').mockRejectedValue(new Error('Onboarding error'));

      await authController.completeBuyerOnboarding(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Onboarding error' })
      );
    });

    test('completeBuyerOnboarding handles successful flow', async () => {
      const req = {
        body: {
          emailOtp: '123456',
          mobile: '9876543210',
          mobileOtp: '654321',
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword123!',
          companyName: 'Acme Corp',
          contactName: 'John Buyer',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          address: '123 Main St',
          gstin: '27AAPFU0939F1ZV',
          pan: 'AAPFU0939F',
        },
        user: { email: validEmail },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      jest.spyOn(authService, 'completeBuyerOnboarding').mockResolvedValue({ success: true });

      await authController.completeBuyerOnboarding(req, res);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('authService direct unit branch tests', () => {
    test('requestVendorDirectoryOtp throws on missing email', async () => {
      await expect(authService.requestVendorDirectoryOtp('')).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_REQUIRED
      );
    });

    test('requestVendorDirectoryOtp throws on non-procucev domain email', async () => {
      await expect(authService.requestVendorDirectoryOtp('user@othercorp.com')).rejects.toThrow(
        AUTH_MESSAGES.VENDOR_DIRECTORY_PROCUCEV_EMAIL_REQUIRED
      );
    });

    test('verifyVendorDirectoryOtp throws on missing email or code', async () => {
      await expect(authService.verifyVendorDirectoryOtp('', '123456')).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
      await expect(authService.verifyVendorDirectoryOtp('test@procucev.com', '')).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
    });

    test('verifyVendorDirectoryOtp throws on non-procucev domain', async () => {
      await expect(authService.verifyVendorDirectoryOtp('user@other.com', '123456')).rejects.toThrow(
        AUTH_MESSAGES.VENDOR_DIRECTORY_PROCUCEV_EMAIL_REQUIRED
      );
    });

    test('verifyVendorDirectoryOtp throws on non-6-digit code', async () => {
      await expect(authService.verifyVendorDirectoryOtp('user@procucev.com', 'abc')).rejects.toThrow(
        AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_INVALID
      );
    });

    test('verifyVendorDirectoryOtp rejects inactive account', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(cmRecord({ isActive: false }));
      await expect(authService.verifyVendorDirectoryOtp('user@procucev.com', '123456')).rejects.toThrow(
        AUTH_MESSAGES.VENDOR_DIRECTORY_CM_ONLY
      );
    });
  });

  describe('authController error fallbacks', () => {
    test('requestVendorDirectoryOtp handles unexpected error without message', async () => {
      const req = { body: { email: validEmail } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      jest.spyOn(authService, 'requestVendorDirectoryOtp').mockRejectedValue(new Error(''));

      await authController.requestVendorDirectoryOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: AUTH_MESSAGES.OTP_DELIVERY_FAILED })
      );
    });

    test('verifyVendorDirectoryOtp handles unexpected error without message', async () => {
      const req = { body: { email: validEmail, code: '123456' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      jest.spyOn(authService, 'verifyVendorDirectoryOtp').mockRejectedValue(new Error(''));

      await authController.verifyVendorDirectoryOtp(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: AUTH_MESSAGES.VENDOR_DIRECTORY_OTP_INVALID })
      );
    });
  });
});

