import {
  getVendorDirectorySession,
  isVendorDirectoryAuthenticated,
  getVendorDirectoryAuthToken,
  touchVendorDirectoryActivity,
  requestVendorDirectoryOtp,
  verifyVendorDirectoryOtp,
  logoutVendorDirectory,
} from '@/lib/vendorAuthClient';
import { VENDOR_DIRECTORY_AUTH_STORAGE_KEY } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('vendorAuthClient', () => {
  const S = UI_STRINGS.vendorDirectoryLogin;
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  describe('getVendorDirectorySession & isVendorDirectoryAuthenticated', () => {
    test('returns null / false when no session exists in sessionStorage', () => {
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
    });

    test('returns null / false and purges storage when session JSON is corrupted', () => {
      window.sessionStorage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, '{invalid-json');
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
    });

    test('returns null / false and cleans storage when session JSON parses to null', () => {
      window.sessionStorage.setItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY, 'null');
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });

    test('returns null / false and cleans storage when session lacks token', () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: '', authenticated: true, expiresAt: Date.now() + 10000 })
      );
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });

    test('returns null / false and cleans storage when session is not authenticated', () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_valid', authenticated: false, expiresAt: Date.now() + 10000 })
      );
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });

    test('returns null / false and purges storage when session is expired', () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_test', authenticated: true, expiresAt: Date.now() - 1000 })
      );
      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });

    test('returns session / true when valid non-expired session is present', () => {
      const now = Date.now();
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_valid', authenticated: true, expiresAt: now + 60000 })
      );
      const session = getVendorDirectorySession();
      expect(session).not.toBeNull();
      expect(session?.token).toBe('vdir_valid');
      expect(isVendorDirectoryAuthenticated()).toBe(true);
    });
  });

  describe('getVendorDirectoryAuthToken', () => {
    test('returns null when unauthenticated', () => {
      expect(getVendorDirectoryAuthToken()).toBeNull();
    });

    test('returns token string when session is valid', () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_token_123', authenticated: true, expiresAt: Date.now() + 60000 })
      );
      expect(getVendorDirectoryAuthToken()).toBe('vdir_token_123');
    });
  });

  describe('touchVendorDirectoryActivity', () => {
    test('does nothing if no active session', () => {
      expect(() => touchVendorDirectoryActivity()).not.toThrow();
    });

    test('updates lastActivityAt if session exists', () => {
      const past = Date.now() - 5000;
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_token', authenticated: true, expiresAt: Date.now() + 60000, lastActivityAt: past })
      );
      touchVendorDirectoryActivity();
      const updated = getVendorDirectorySession();
      expect(updated?.lastActivityAt).toBeGreaterThanOrEqual(past);
    });
  });

  describe('requestVendorDirectoryOtp', () => {
    test('rejects empty or whitespace email', async () => {
      const res1 = await requestVendorDirectoryOtp('');
      expect(res1.success).toBe(false);
      expect(res1.error).toBe(S.emptyEmail);

      const res2 = await requestVendorDirectoryOtp('   ');
      expect(res2.success).toBe(false);
      expect(res2.error).toBe(S.emptyEmail);
    });

    test('rejects non-procucev email', async () => {
      const res = await requestVendorDirectoryOtp('user@gmail.com');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.procucevEmailRequired);
    });

    test('sends request and returns success when server responds ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: 'OTP sent successfully',
          expiresInSeconds: 300,
        }),
      } as any);

      const res = await requestVendorDirectoryOtp('cm@procucev.com');
      expect(res.success).toBe(true);
      expect(res.message).toBe('OTP sent successfully');
      expect(res.expiresInSeconds).toBe(300);
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/vendor-directory/request-otp', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'cm@procucev.com' }),
      }));
    });

    test('returns accessDeniedNotice when server responds with 403', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ success: false }),
      } as any);

      const res = await requestVendorDirectoryOtp('not_cm@procucev.com');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.accessDeniedNotice);
    });

    test('returns server error message when available', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Custom rate limit exceeded' }),
      } as any);

      const res = await requestVendorDirectoryOtp('cm@procucev.com');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Custom rate limit exceeded');
    });

    test('handles JSON parse error on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as any);

      const res = await requestVendorDirectoryOtp('cm@procucev.com');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.networkError);
    });

    test('catches fetch network failure and returns networkError', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      const res = await requestVendorDirectoryOtp('cm@procucev.com');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.networkError);
    });
  });

  describe('verifyVendorDirectoryOtp', () => {
    test('validates inputs (empty email, non-procucev email, empty code, invalid code length)', async () => {
      const res1 = await verifyVendorDirectoryOtp('', '123456');
      expect(res1.success).toBe(false);
      expect(res1.error).toBe(S.emptyEmail);

      const res2 = await verifyVendorDirectoryOtp('cm@gmail.com', '123456');
      expect(res2.success).toBe(false);
      expect(res2.error).toBe(S.procucevEmailRequired);

      const res3 = await verifyVendorDirectoryOtp('cm@procucev.com', '');
      expect(res3.success).toBe(false);
      expect(res3.error).toBe(S.emptyOtp);

      const res4 = await verifyVendorDirectoryOtp('cm@procucev.com', '123');
      expect(res4.success).toBe(false);
      expect(res4.error).toBe(S.invalidOtp);

      const res5 = await verifyVendorDirectoryOtp('cm@procucev.com', 'abcdef');
      expect(res5.success).toBe(false);
      expect(res5.error).toBe(S.invalidOtp);
    });

    test('verifies OTP and stores session on success', async () => {
      const futureIso = new Date(Date.now() + 300000).toISOString();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'jwt_vd_token',
          sessionId: 'vdir_session_abc',
          expiresAt: futureIso,
          user: { id: 'u1', email: 'cm@procucev.com', role: 'category_manager', name: 'Category Mgr' },
        }),
      } as any);

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(true);
      expect(res.token).toBe('jwt_vd_token');
      expect(res.sessionId).toBe('vdir_session_abc');
      expect(res.user?.role).toBe('category_manager');

      const saved = getVendorDirectorySession();
      expect(saved?.authenticated).toBe(true);
      expect(saved?.sessionId).toBe('vdir_session_abc');
    });

    test('verifies OTP with numeric expiresAt and fallback when omitted', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'jwt_vd_token_num',
          sessionId: 'ses_num',
          expiresAt: Date.now() + 120000,
        }),
      } as any);

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(true);

      // Omitted expiresAt fallback
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'jwt_vd_token_fallback',
          sessionId: 'ses_fallback',
        }),
      } as any);

      const resFallback = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(resFallback.success).toBe(true);

      // Invalid date string fallback
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'jwt_vd_token_nan',
          sessionId: 'ses_nan',
          expiresAt: 'not-a-date',
        }),
      } as any);

      const resNan = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(resNan.success).toBe(true);
    });

    test('returns accessDeniedNotice on 403 response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ success: false }),
      } as any);

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.accessDeniedNotice);
    });

    test('returns server error message on 401 response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: 'OTP has expired' }),
      } as any);

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(false);
      expect(res.error).toBe('OTP has expired');
    });

    test('handles non-JSON error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('bad json');
        },
      } as any);

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.invalidOtp);
    });

    test('handles fetch rejection on verify', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection aborted'));

      const res = await verifyVendorDirectoryOtp('cm@procucev.com', '123456');
      expect(res.success).toBe(false);
      expect(res.error).toBe(S.networkError);
    });
  });

  describe('logoutVendorDirectory', () => {
    test('clears storage and calls logout endpoint with token and reason', async () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'active_token', authenticated: true, expiresAt: Date.now() + 60000 })
      );

      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as any);

      await logoutVendorDirectory('INACTIVITY');

      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer active_token',
        }),
        body: JSON.stringify({ logoutReason: 'INACTIVITY' }),
      }));
    });

    test('clears storage even if no token was present or fetch fails', async () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: '', authenticated: false, expiresAt: 0 })
      );

      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      await logoutVendorDirectory();

      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });
  });
});
