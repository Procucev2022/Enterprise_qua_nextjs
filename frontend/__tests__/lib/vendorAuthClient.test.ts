import {
  getVendorDirectorySession,
  isVendorDirectoryAuthenticated,
  getVendorDirectoryAuthToken,
  authenticateVendorDirectory,
  logoutVendorDirectory,
} from '@/lib/vendorAuthClient';
import { DEFAULT_VENDOR_DIRECTORY_PASSKEY, VENDOR_DIRECTORY_AUTH_STORAGE_KEY } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('vendorAuthClient', () => {
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

  describe('authenticateVendorDirectory', () => {
    test('returns error when passkey is empty or whitespace or falsy', async () => {
      const res1 = await authenticateVendorDirectory('   ');
      expect(res1.success).toBe(false);
      expect(res1.error).toBe(UI_STRINGS.vendorDirectoryLogin.emptyPasskey);

      // @ts-expect-error test undefined input
      const res2 = await authenticateVendorDirectory(undefined);
      expect(res2.success).toBe(false);
      expect(res2.error).toBe(UI_STRINGS.vendorDirectoryLogin.emptyPasskey);
    });

    test('authenticates successfully via backend API with explicit expiresAt', async () => {
      const customExpiry = Date.now() + 86400000;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'vdir_api_token_456',
          expiresAt: customExpiry,
        }),
      });

      const res = await authenticateVendorDirectory('Procucev@Vendors2026');
      expect(res.success).toBe(true);
      expect(res.token).toBe('vdir_api_token_456');

      const saved = JSON.parse(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY) || '{}');
      expect(saved.authenticated).toBe(true);
      expect(saved.token).toBe('vdir_api_token_456');
      expect(saved.expiresAt).toBe(customExpiry);
    });

    test('authenticates successfully via backend API when expiresAt is omitted (uses 24h default)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'vdir_api_token_no_expiry',
        }),
      });

      const res = await authenticateVendorDirectory('Procucev@Vendors2026');
      expect(res.success).toBe(true);
      expect(res.token).toBe('vdir_api_token_no_expiry');

      const saved = JSON.parse(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY) || '{}');
      expect(saved.authenticated).toBe(true);
      expect(saved.expiresAt).toBeGreaterThan(Date.now());
    });

    test('handles ok:true response where payload lacks token — falls through to error parse path', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Token not issued' }),
      });

      const res = await authenticateVendorDirectory('some-key');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Token not issued');
    });

    test('handles API HTTP 401 response with backend error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: 'Custom invalid passkey error',
        }),
      });

      const res = await authenticateVendorDirectory('wrong-key');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Custom invalid passkey error');
    });

    test('handles API HTTP error without specific error property (uses default invalidPasskey)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({}),
      });

      const res = await authenticateVendorDirectory('wrong-key');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.vendorDirectoryLogin.invalidPasskey);
    });

    test('handles API HTTP error when json parsing fails (uses default invalidPasskey)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      const res = await authenticateVendorDirectory('bad-key');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.vendorDirectoryLogin.invalidPasskey);
    });

    test('falls back gracefully to offline verification if network request fails and passkey matches default', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await authenticateVendorDirectory(DEFAULT_VENDOR_DIRECTORY_PASSKEY);
      expect(res.success).toBe(true);
      expect(res.token).toContain('vdir_offline_');

      const saved = JSON.parse(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY) || '{}');
      expect(saved.authenticated).toBe(true);
    });

    test('falls back gracefully to offline verification with VENDOR2026 alias key', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await authenticateVendorDirectory('VENDOR2026');
      expect(res.success).toBe(true);
      expect(res.token).toContain('vdir_offline_');

      const saved = JSON.parse(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY) || '{}');
      expect(saved.authenticated).toBe(true);
    });

    test('returns invalidPasskey error if network request fails and passkey does not match default or alias', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await authenticateVendorDirectory('completely-wrong-key');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.vendorDirectoryLogin.invalidPasskey);
    });
  });

  describe('logoutVendorDirectory', () => {
    test('removes session from sessionStorage', () => {
      window.sessionStorage.setItem(
        VENDOR_DIRECTORY_AUTH_STORAGE_KEY,
        JSON.stringify({ token: 'vdir_active', authenticated: true, expiresAt: Date.now() + 60000 })
      );
      expect(isVendorDirectoryAuthenticated()).toBe(true);

      logoutVendorDirectory();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(window.sessionStorage.getItem(VENDOR_DIRECTORY_AUTH_STORAGE_KEY)).toBeNull();
    });

    test('handles storage exceptions gracefully during logout', () => {
      const original = window.sessionStorage.removeItem.bind(window.sessionStorage);
      Object.defineProperty(window.sessionStorage, 'removeItem', {
        configurable: true,
        value: () => {
          throw new Error('Storage exception');
        },
      });

      expect(() => logoutVendorDirectory()).not.toThrow();

      Object.defineProperty(window.sessionStorage, 'removeItem', {
        configurable: true,
        value: original,
      });
    });
  });

  describe('Storage / SSR unavailable environment guards', () => {
    test('gracefully handles missing sessionStorage in storage helper', () => {
      const originalStorage = window.sessionStorage;
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: null,
      });

      expect(getVendorDirectorySession()).toBeNull();
      expect(isVendorDirectoryAuthenticated()).toBe(false);
      expect(getVendorDirectoryAuthToken()).toBeNull();
      expect(() => logoutVendorDirectory()).not.toThrow();

      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: originalStorage,
      });
    });

    test('authenticateVendorDirectory succeeds even if sessionStorage is unavailable', async () => {
      const originalStorage = window.sessionStorage;
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: null,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'vdir_token_no_storage',
        }),
      });

      const res = await authenticateVendorDirectory('Procucev@Vendors2026');
      expect(res.success).toBe(true);
      expect(res.token).toBe('vdir_token_no_storage');

      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: originalStorage,
      });
    });

    test('offline fallback succeeds even if sessionStorage is unavailable', async () => {
      const originalStorage = window.sessionStorage;
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: null,
      });

      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await authenticateVendorDirectory(DEFAULT_VENDOR_DIRECTORY_PASSKEY);
      expect(res.success).toBe(true);
      expect(res.token).toContain('vdir_offline_');

      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: originalStorage,
      });
    });
  });
});
