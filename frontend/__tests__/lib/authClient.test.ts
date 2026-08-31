import { authClient } from '@/lib/authClient';

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

  describe('Offline & Error Fallback Paths', () => {
    test('loginWithPassword handles network error with role fallbacks', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      // Vendor fallback
      const vRes = await authClient.loginWithPassword('vendor@test.com', 'p');
      expect(vRes.user?.role).toBe('vendor');

      // Admin fallback
      const aRes = await authClient.loginWithPassword('admin@test.com', 'p');
      expect(aRes.user?.role).toBe('admin');

      // Manager fallback
      const mRes = await authClient.loginWithPassword('manager@test.com', 'p');
      expect(mRes.user?.role).toBe('category_manager');

      // Buyer fallback
      const bRes = await authClient.loginWithPassword('buyer@test.com', 'p');
      expect(bRes.user?.role).toBe('buyer');
    });

    test('requestOtp handles network error fallback', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const res = await authClient.requestOtp('buyer@test.com', 'buyer');
      expect(res.success).toBe(true);
      expect(res.demoCode).toBeDefined();
    });

    test('verifyOtp handles network error with role fallbacks', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const vRes = await authClient.verifyOtp('vendor@test.com', '1234');
      expect(vRes.user?.role).toBe('vendor');

      const aRes = await authClient.verifyOtp('admin@test.com', '1234');
      expect(aRes.user?.role).toBe('admin');

      const mRes = await authClient.verifyOtp('manager@test.com', '1234');
      expect(mRes.user?.role).toBe('category_manager');

      const bRes = await authClient.verifyOtp('buyer@test.com', '1234');
      expect(bRes.user?.role).toBe('buyer');
    });

    test('register handles network error fallback with default values', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.register({
        name: '',
        email: 'fallback.reg@enterprise.com',
      });
      expect(res.success).toBe(true);
      expect(res.user?.email).toBe('fallback.reg@enterprise.com');
      expect(res.user?.role).toBe('buyer');
    });

    test('getSession handles network error and non-ok gracefully', async () => {
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

      // fetch rejects
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const session1 = await authClient.getSession();
      expect(session1?.email).toBe('cached@test.com');

      // fetch returns non-ok (e.g. 401)
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
      const session2 = await authClient.getSession();
      expect(session2?.email).toBe('cached@test.com');
    });

    test('logout handles fetch error gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      await expect(authClient.logout()).resolves.toBeUndefined();
      expect(authClient.getToken()).toBeNull();
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
