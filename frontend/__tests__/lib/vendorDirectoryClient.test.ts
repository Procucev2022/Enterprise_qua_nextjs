import { fetchPublicVendors, fetchPublicVendorById } from '@/lib/vendorDirectoryClient';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('vendorDirectoryClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
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

    test('includes search, category, state, and minRating in query string', async () => {
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
});
