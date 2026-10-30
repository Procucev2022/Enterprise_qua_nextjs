import { fetchPublicVendors, fetchPublicVendorById, fetchPublicVendorFilters, clearPublicVendorClientCache } from '@/lib/vendorDirectoryClient';
import * as vendorAuthClient from '@/lib/vendorAuthClient';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('vendorDirectoryClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearPublicVendorClientCache();
  });

  afterEach(() => {
    clearPublicVendorClientCache();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('fetchPublicVendors', () => {
    test('fetches vendors successfully with default parameters', async () => {
      const mockResult = {
        success: true,
        data: [{ id: 'v-1', name: 'Acme Corp', majorCategory: 'Mechanical', minorCategories: [] }],
        pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const res = await fetchPublicVendors();
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].name).toBe('Acme Corp');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/public?page=1&pageSize=24'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('includes search, category, state, minRating, and verifiedOnly in query string', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } }),
      });

      await fetchPublicVendors({
        page: 2,
        pageSize: 10,
        search: 'pipes',
        category: 'Mechanical',
        state: 'Maharashtra',
        minRating: 4.5,
        verifiedOnly: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=10'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=pipes'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=Mechanical'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('state=Maharashtra'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('minRating=4.5'),
        expect.anything()
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('verifiedOnly=true'),
        expect.anything()
      );
    });

    test('ignores "all" for category and state and 0 for minRating', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 } }),
      });

      await fetchPublicVendors({
        category: 'all',
        state: 'all',
        minRating: 0,
      });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(callUrl).not.toContain('category=all');
      expect(callUrl).not.toContain('state=all');
      expect(callUrl).not.toContain('minRating=');
    });

    test('handles HTTP error responses with JSON error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid search parameter.' }),
      });

      const res = await fetchPublicVendors({ search: 'bad-query' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid search parameter.');
    });

    test('handles HTTP error responses where json parsing fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      const res = await fetchPublicVendors();
      expect(res.success).toBe(false);
      expect(res.error).toContain(UI_STRINGS.publicVendorDirectory.errorText);
      expect(res.error).toContain('HTTP 500');
    });

    test('handles network failure gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection failed'));

      const res = await fetchPublicVendors();
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.publicVendorDirectory.errorText);
      expect(res.data).toEqual([]);
    });
  });

  describe('fetchPublicVendorFilters', () => {
    test('fetches dynamic category and state filters successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            categories: ['Mechanical & Fluid Equipment', 'Electrical'],
            states: ['Gujarat', 'Maharashtra'],
          },
        }),
      });

      const res = await fetchPublicVendorFilters();
      expect(res.success).toBe(true);
      expect(res.categories).toEqual(['Mechanical & Fluid Equipment', 'Electrical']);
      expect(res.states).toEqual(['Gujarat', 'Maharashtra']);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/public/filters',
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('returns empty lists when API returns HTTP non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const res = await fetchPublicVendorFilters();
      expect(res.success).toBe(false);
      expect(res.categories).toEqual([]);
      expect(res.states).toEqual([]);
    });

    test('returns empty lists when fetch encounters a network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Fetch failed'));

      const res = await fetchPublicVendorFilters();
      expect(res.success).toBe(false);
      expect(res.categories).toEqual([]);
      expect(res.states).toEqual([]);
    });
  });

  describe('fetchPublicVendorById', () => {
    test('returns null if id is empty', async () => {
      const res = await fetchPublicVendorById('');
      expect(res).toBeNull();
    });

    test('returns vendor when found', async () => {
      const vendorData = { id: 'v-100', name: 'Specialty Steel Ltd', majorCategory: 'Metals & Alloys', minorCategories: [] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: vendorData }),
      });

      const res = await fetchPublicVendorById('v-100');
      expect(res).toEqual(vendorData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/public/v-100'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    test('returns null when API returns HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const res = await fetchPublicVendorById('v-not-found');
      expect(res).toBeNull();
    });

    test('returns null when API response has success: false or missing data', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      });

      const res = await fetchPublicVendorById('v-empty');
      expect(res).toBeNull();
    });

    test('returns null when network throws an exception', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

      const res = await fetchPublicVendorById('v-error');
      expect(res).toBeNull();
    });
  });

  describe('Client-Side In-Memory Caching & Database Shielding', () => {
    test('subsequent calls to fetchPublicVendors with identical params hit cache and avoid network', async () => {
      const mockResult = {
        success: true,
        data: [{ id: 'v-cached-1', name: 'Cached Vendor Co', majorCategory: 'Pumps', minorCategories: [] }],
        pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const firstCall = await fetchPublicVendors({ page: 1, pageSize: 24 });
      const secondCall = await fetchPublicVendors({ page: 1, pageSize: 24 });

      expect(firstCall).toEqual(secondCall);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('clearPublicVendorClientCache forces a fresh network call on next request', async () => {
      const mockResult = {
        success: true,
        data: [{ id: 'v-cached-2', name: 'Second Vendor', majorCategory: 'Valves', minorCategories: [] }],
        pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      await fetchPublicVendors({ page: 1, pageSize: 24 });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      clearPublicVendorClientCache();

      await fetchPublicVendors({ page: 1, pageSize: 24 });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('subsequent calls to fetchPublicVendorFilters hit cache and avoid network call', async () => {
      const mockFilters = {
        success: true,
        data: {
          categories: ['Electronics', 'Metals'],
          states: ['Delhi', 'Karnataka'],
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFilters,
      });

      const firstFilters = await fetchPublicVendorFilters();
      const secondFilters = await fetchPublicVendorFilters();

      expect(firstFilters).toEqual(secondFilters);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('subsequent calls to fetchPublicVendorById hit cache and avoid network call', async () => {
      const mockVendor = { id: 'v-cached-3', name: 'Single Cached Vendor', majorCategory: 'Electrical', minorCategories: [] };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockVendor }),
      });

      const firstVendor = await fetchPublicVendorById('v-cached-3');
      const secondVendor = await fetchPublicVendorById('v-cached-3');

      expect(firstVendor).toEqual(secondVendor);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('re-fetches when page cache entry expires', async () => {
      const mockResult = {
        success: true,
        data: [{ id: 'v-expired', name: 'Expired Co', majorCategory: 'Mechanical', minorCategories: [] }],
        pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const now = Date.now();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      await fetchPublicVendors({ page: 1, pageSize: 24 });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Advance time beyond 60-second TTL
      dateSpy.mockReturnValue(now + 65000);

      await fetchPublicVendors({ page: 1, pageSize: 24 });
      expect(global.fetch).toHaveBeenCalledTimes(2);

      dateSpy.mockRestore();
    });

    test('evicts oldest cache entry when page cache exceeds max capacity', async () => {
      global.fetch = jest.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => ({
          success: true,
          data: [{ id: `v-${url}`, name: 'Test', majorCategory: 'Testing', minorCategories: [] }],
          pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1 },
        }),
      }));

      // Insert 51 unique pages to trigger oldest entry eviction
      for (let i = 1; i <= 51; i++) {
        await fetchPublicVendors({ page: i, pageSize: 1 });
      }

      expect(global.fetch).toHaveBeenCalledTimes(51);

      // Requesting the 51st page again should hit cache (no new fetch)
      await fetchPublicVendors({ page: 51, pageSize: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(51);

      // Requesting the 1st page again should have been evicted, so it triggers a new fetch (call 52)
      await fetchPublicVendors({ page: 1, pageSize: 1 });
      expect(global.fetch).toHaveBeenCalledTimes(52);
    });

    test('attaches Authorization header with Bearer token when directory session exists', async () => {
      window.sessionStorage.setItem(
        'procucev_vendor_directory_auth',
        JSON.stringify({
          authenticated: true,
          token: 'mock-jwt-directory-token',
          expiresAt: Date.now() + 60000,
        })
      );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 } }),
      });

      await fetchPublicVendors({ page: 1 });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/public'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-directory-token',
          }),
          cache: 'no-store',
        })
      );
    });

    test('attaches Authorization header for fetchPublicVendorFilters and fetchPublicVendorById when session exists', async () => {
      window.sessionStorage.setItem(
        'procucev_vendor_directory_auth',
        JSON.stringify({
          authenticated: true,
          token: 'mock-jwt-directory-token',
          expiresAt: Date.now() + 60000,
        })
      );
      global.fetch = jest.fn().mockImplementation(async (url) => {
        if (url.includes('/filters')) {
          return {
            ok: true,
            json: async () => ({ success: true, data: {} }),
          };
        }
        return {
          ok: true,
          json: async () => ({ success: true, data: { id: 'v-101', name: 'Vendor 101' } }),
        };
      });

      const filtersResult = await fetchPublicVendorFilters();
      expect(filtersResult.categories).toEqual([]);
      expect(filtersResult.states).toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/public/filters',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-directory-token',
          }),
          cache: 'no-store',
        })
      );

      const vendor = await fetchPublicVendorById('v-101');
      expect(vendor?.name).toBe('Vendor 101');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/public/v-101',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-directory-token',
          }),
          cache: 'no-store',
        })
      );
    });
  });
});
