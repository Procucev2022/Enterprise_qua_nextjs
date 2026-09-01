import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('Frontend AuthClient Service - Comprehensive 100% Coverage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authClient.setSession(null, null);
    jest.clearAllMocks();
  });

  describe('Successful API Paths', () => {
    test('loginWithPassword handles successful login response', async () => {
      const mockUser = {
        id: 'usr-buyer-001',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer Desk',
        role: 'buyer' as const,
        orgId: 'org-procucev-01',
        orgName: 'Procucev Heavy Engineering',
        authMethod: 'PASSWORD' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'test-jwt-token',
          user: mockUser,
        }),
      });

      const res = await authClient.loginWithPassword('buyer@procucev.com', 'password123');
      expect(res.success).toBe(true);
      expect(res.user?.email).toBe('buyer@procucev.com');
      expect(authClient.getToken()).toBe('test-jwt-token');
      expect(authClient.getSessionUser()?.email).toBe('buyer@procucev.com');
    });

    test('requestOtp dispatches verification code', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Verification OTP dispatched to buyer@procucev.com',
          demoCode: '1234',
          expiresInSeconds: 600,
        }),
      });

      const res = await authClient.requestOtp('buyer@procucev.com', 'buyer');
      expect(res.success).toBe(true);
      expect(res.demoCode).toBe('1234');
    });

    test('verifyOtp signs in user upon successful verification', async () => {
      const mockUser = {
        id: 'usr-buyer-001',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer Desk',
        role: 'buyer' as const,
        orgId: 'org-procucev-01',
        orgName: 'Procucev Heavy Engineering',
        authMethod: 'EMAIL_OTP' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'test-otp-jwt-token',
          user: mockUser,
        }),
      });

      const res = await authClient.verifyOtp('buyer@procucev.com', '1234');
      expect(res.success).toBe(true);
      expect(res.user?.authMethod).toBe('EMAIL_OTP');
      expect(authClient.getToken()).toBe('test-otp-jwt-token');
    });

    test('register creates a new user account', async () => {
      const mockNewUser = {
        id: 'usr-new-001',
        email: 'newbuyer@enterprise.com',
        name: 'New Buyer',
        role: 'buyer' as const,
        orgId: 'org-new-001',
        orgName: 'New Enterprise Corp',
        authMethod: 'PASSWORD' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'new-user-jwt-token',
          user: mockNewUser,
        }),
      });

      const res = await authClient.register({
        name: 'New Buyer',
        email: 'newbuyer@enterprise.com',
        password: 'SecurePassword123!',
        mobile: '+91 98000 11223',
        role: 'buyer',
        orgName: 'New Enterprise Corp',
      });

      expect(res.success).toBe(true);
      expect(res.user?.email).toBe('newbuyer@enterprise.com');
    });

    test('getSession returns server session when token is valid and active', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'session@procucev.com',
          name: 'Session User',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'valid-token'
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          user: {
            id: 'usr-1',
            email: 'session@procucev.com',
            name: 'Session User',
            role: 'buyer',
            orgId: 'org-1',
            orgName: 'Org',
          },
        }),
      });

      const session = await authClient.getSession();
      expect(session?.email).toBe('session@procucev.com');
    });

    test('getSession returns cached session when token is null', async () => {
      authClient.setSession(null, null);
      const session = await authClient.getSession();
      expect(session).toBeNull();
    });

    test('logout clears active session state', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'buyer@procucev.com',
          name: 'Buyer',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Procucev',
        },
        'active-token'
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await authClient.logout('buyer@procucev.com');
      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });
  });

  describe('Unreachable Backend Fails Closed', () => {
    // The client used to fabricate a valid session whenever fetch() rejected,
    // which made an unreachable API indistinguishable from a real sign-in.
    // Every transport failure must now surface as an explicit failure.
    test('loginWithPassword reports a network failure instead of signing the user in', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      for (const email of ['vendor@test.com', 'admin@test.com', 'manager@test.com', 'buyer@test.com']) {
        const res = await authClient.loginWithPassword(email, 'p');
        expect(res.success).toBe(false);
        expect(res.user).toBeUndefined();
        expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      }

      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });

    test('requestOtp reports a network failure and never invents a demo code', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.requestOtp('buyer@test.com', 'buyer');
      expect(res.success).toBe(false);
      expect(res.demoCode).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
    });

    test('verifyOtp reports a network failure instead of signing the user in', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.verifyOtp('vendor@test.com', '1234');
      expect(res.success).toBe(false);
      expect(res.user).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      expect(authClient.getToken()).toBeNull();
    });

    test('register reports a network failure instead of creating a local account', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.register({ name: '', email: 'fallback.reg@enterprise.com' });
      expect(res.success).toBe(false);
      expect(res.user).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      expect(authClient.getToken()).toBeNull();
    });

    test('a response body that is not JSON is reported as a server error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      });

      const res = await authClient.loginWithPassword('buyer@test.com', 'p');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.auth.serverErrorFallback);
    });

    test('an error status with no message from the server still fails with an explanation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false }),
      });

      const res = await authClient.loginWithPassword('buyer@test.com', 'p');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.auth.serverErrorFallback);
    });

    test('getSession keeps the cached session offline but discards a rejected token', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'cached@test.com',
          name: 'Cached',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'token-123'
      );

      // Network failure: the cached session is retained rather than signing out.
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const offlineSession = await authClient.getSession();
      expect(offlineSession?.email).toBe('cached@test.com');

      // A 401 means the token is genuinely invalid, so local state is cleared.
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
      const rejectedSession = await authClient.getSession();
      expect(rejectedSession).toBeNull();
      expect(authClient.getToken()).toBeNull();
    });

    test('getSession returns null without a token and makes no request', async () => {
      authClient.setSession(null, null);
      global.fetch = jest.fn();

      await expect(authClient.getSession()).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('logout handles fetch error gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      await expect(authClient.logout()).resolves.toBeUndefined();
      expect(authClient.getToken()).toBeNull();
    });
  });

  describe('Resolved but Unsuccessful Responses', () => {
    test('loginWithPassword returns the failure response without establishing a session', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Invalid email or password.' }),
      });

      const res = await authClient.loginWithPassword('buyer@procucev.com', 'wrongpassword');
      expect(res.success).toBe(false);
      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });

    test('register returns the failure response without establishing a session', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Email is required for registration.' }),
      });

      const res = await authClient.register({ name: 'No Email', email: '' });
      expect(res.success).toBe(false);
      expect(authClient.getToken()).toBeNull();
    });

    test('getSession returns null when the server responds with success:false', async () => {
      authClient.setSession(null, 'some-token');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Invalid session' }),
      });

      const session = await authClient.getSession();
      expect(session).toBeNull();
    });
  });

  describe('Storage & Session Management', () => {
    test('setSession writes to and removes from localStorage', () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'stored@test.com',
          name: 'Stored',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'token-abc'
      );
      expect(localStorage.getItem('procucev_user_session')).toContain('stored@test.com');
      expect(localStorage.getItem('procucev_auth_token')).toBe('token-abc');

      authClient.setSession(null, null);
      expect(localStorage.getItem('procucev_user_session')).toBeNull();
      expect(localStorage.getItem('procucev_auth_token')).toBeNull();
    });
  });
});
