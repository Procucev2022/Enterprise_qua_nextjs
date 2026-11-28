import { authClient } from '@/lib/authClient';
import {
  clearUserPreferencesCache,
  deleteUserPreference,
  getUserPreference,
  loadUserPreferences,
  purgeLegacyClientStorage,
  saveUserPreference,
} from '@/lib/userPreferencesClient';

describe('userPreferencesClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearUserPreferencesCache();
    authClient.setSession(
      {
        id: 'u-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'category_manager',
        orgId: 'org-1',
        orgName: 'Procucev',
      },
      'pref-token-1'
    );
  });

  afterEach(() => {
    clearUserPreferencesCache();
  });

  test('returns empty/null/false when unauthenticated or key is blank', async () => {
    authClient.setSession(null, null);
    expect(await loadUserPreferences()).toEqual({});
    expect(await getUserPreference('theme')).toBeNull();
    expect(await saveUserPreference('theme', 'dark')).toBe(false);
    expect(await deleteUserPreference('theme')).toBe(false);

    authClient.setSession({ id: 'u-1', email: 'a@b.com', name: 'A', role: 'buyer', orgId: 'o1', orgName: 'Org' }, 'tok');
    expect(await getUserPreference('   ')).toBeNull();
    expect(await saveUserPreference('   ', 'dark')).toBe(false);
    expect(await deleteUserPreference('   ')).toBe(false);
  });

  test('loads preferences once, deduplicates in-flight loads, caches in memory, and refreshes on force', async () => {
    let resolveFetch: (val: unknown) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.fn().mockReturnValueOnce(pendingPromise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const p1 = loadUserPreferences();
    const p2 = loadUserPreferences();
    resolveFetch({
      ok: true,
      json: async () => ({ success: true, data: { theme: 'dark', cols: [{ key: 'a', visible: true }] } }),
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ theme: 'dark', cols: [{ key: 'a', visible: true }] });
    expect(r2).toEqual(r1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Subsequent call uses in-memory cache without re-fetching
    expect(await getUserPreference('theme')).toBe('dark');
    expect(await getUserPreference('missing_key')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Force refresh fetches again
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { theme: 'light' } }),
    });
    expect(await loadUserPreferences(true)).toEqual({ theme: 'light' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('handles non-ok, invalid JSON, and network failure responses gracefully', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: ['not-an-object'] }) })
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch;

    expect(await loadUserPreferences(true)).toEqual({});
    expect(await loadUserPreferences(true)).toEqual({});
    expect(await loadUserPreferences(true)).toEqual({});
  });

  test('saves and deletes preferences via backend API and updates in-memory cache', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockRejectedValueOnce(new Error('put fail'))
      .mockRejectedValueOnce(new Error('del fail')) as unknown as typeof fetch;

    expect(await saveUserPreference('theme', 'dark')).toBe(true);
    expect(await getUserPreference('theme')).toBe('dark');

    expect(await saveUserPreference('cols', [1, 2])).toBe(true);
    expect(await getUserPreference('cols')).toEqual([1, 2]);

    expect(await deleteUserPreference('theme')).toBe(true);
    expect(await getUserPreference('theme')).toBeNull();

    expect(await saveUserPreference('x', 1)).toBe(false);
    expect(await deleteUserPreference('x')).toBe(false);

    // Deleting a key not currently in cache still calls DELETE cleanly
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    expect(await deleteUserPreference('never_cached_key')).toBe(true);

    // Force-refresh failure after cache is populated preserves cached preferences
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockRejectedValueOnce(new Error('network blip'));
    expect(await loadUserPreferences(true)).toEqual({ cols: [1, 2] });
    expect(await loadUserPreferences(true)).toEqual({ cols: [1, 2] });
    expect(await loadUserPreferences(true)).toEqual({ cols: [1, 2] });
  });

  test('purgeLegacyClientStorage removes deprecated localStorage and sessionStorage keys while preserving auth tokens', () => {
    localStorage.setItem('procucev_auth_token', 'keep-me');
    localStorage.setItem('procucev_vendor_upload_history', '[{"id":"old"}]');
    localStorage.setItem('procucev_theme', 'dark');
    localStorage.setItem('procucev_approval_col_prefs_user1', '[]');
    localStorage.setItem('qua_approvals_columns_user1', '[]');
    sessionStorage.setItem('procucev_cache_rfqs', '[]');
    sessionStorage.setItem('buyer_directory_state', '{}');

    purgeLegacyClientStorage();

    expect(localStorage.getItem('procucev_auth_token')).toBe('keep-me');
    expect(localStorage.getItem('procucev_vendor_upload_history')).toBeNull();
    expect(localStorage.getItem('procucev_theme')).toBeNull();
    expect(localStorage.getItem('procucev_approval_col_prefs_user1')).toBeNull();
    expect(localStorage.getItem('qua_approvals_columns_user1')).toBeNull();
    expect(sessionStorage.getItem('procucev_cache_rfqs')).toBeNull();
    expect(sessionStorage.getItem('buyer_directory_state')).toBeNull();
  });

  test('purgeLegacyClientStorage ignores storage access exceptions safely', () => {
    const spyLocal = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(() => purgeLegacyClientStorage()).not.toThrow();
    } finally {
      spyLocal.mockRestore();
    }
  });
});
