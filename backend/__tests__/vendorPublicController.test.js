const vendorController = require('../src/controllers/vendorController');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const { INDIAN_STATES } = require('../src/config/constants');
const { queryCache } = require('../src/db/queryCache');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

describe('Public Vendor Directory Backend Controller & Database Queries', () => {
  beforeEach(() => {
    queryCache.clear();
  });

  afterEach(() => {
    queryCache.clear();
    jest.restoreAllMocks();
  });

  describe('vendorController.getPublicVendors', () => {
    test('returns paginated sanitized vendors without authentication', async () => {
      const mockVendorRow = {
        id: 'v-pub-1',
        name: 'Kirloskar Pneumatic Co',
        brandName: 'Kirloskar',
        major_category: 'Mechanical',
        status: 'VERIFIED SUPPLIER',
        created_at: '2024-01-01T00:00:00Z',
        raw: {
          id: 'v-pub-1',
          name: 'Kirloskar Pneumatic Co',
          pan: 'ABCDE1234F',
          gstin: '27ABCDE1234F1Z5',
          email: 'sales@kirloskar.example.com',
          phone: '+91 20 2710 1234',
          rating: 4.7,
        },
      };

      jest.spyOn(domainQueries, 'getPublicVendorsPageFromDB').mockResolvedValue({
        rows: [mockVendorRow],
        total: 1,
      });

      const req = {
        query: {
          page: '1',
          pageSize: '24',
          search: 'pneumatic',
          category: 'Mechanical',
          state: 'Maharashtra',
          minRating: '4',
        },
      };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendors(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              id: 'v-pub-1',
              name: 'Kirloskar Pneumatic Co',
              pan: 'ABC****4F', // Masked PAN
              isProcucevNetwork: true,
            }),
          ]),
          pagination: expect.objectContaining({
            page: 1,
            pageSize: 24,
            total: 1,
            totalPages: 1,
          }),
        })
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('public')
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('handles default query values when query parameters are omitted', async () => {
      jest.spyOn(domainQueries, 'getPublicVendorsPageFromDB').mockResolvedValue({
        rows: [],
        total: 0,
      });

      const req = { query: {} };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendors(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: [],
          pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
        })
      );
    });

    test('passes verifiedOnly boolean when requested in query params', async () => {
      const dbSpy = jest.spyOn(domainQueries, 'getPublicVendorsPageFromDB').mockResolvedValue({
        rows: [],
        total: 0,
      });

      const req = {
        query: {
          verifiedOnly: 'true',
        },
      };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendors(req, res, next);

      expect(dbSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          verifiedOnly: true,
        })
      );
      expect(res.json).toHaveBeenCalled();
    });

    test('calls next(err) if domain query throws an exception', async () => {
      const dbError = new Error('Database connection failed');
      jest.spyOn(domainQueries, 'getPublicVendorsPageFromDB').mockRejectedValue(dbError);

      const req = { query: {} };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendors(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('vendorController.getPublicVendorFilters', () => {
    test('returns categories and states successfully', async () => {
      jest.spyOn(domainQueries, 'getPublicVendorFiltersFromDB').mockResolvedValue({
        categories: ['Mechanical & Fluid Equipment', 'Electrical'],
        states: ['Gujarat', 'Maharashtra'],
      });

      const req = {};
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorFilters(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          categories: ['Mechanical & Fluid Equipment', 'Electrical'],
          states: ['Gujarat', 'Maharashtra'],
        },
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('public')
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('calls next(err) when domain query throws an exception', async () => {
      const dbError = new Error('DB filter aggregate failed');
      jest.spyOn(domainQueries, 'getPublicVendorFiltersFromDB').mockRejectedValue(dbError);

      const req = {};
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorFilters(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('vendorController.getPublicVendorById', () => {
    test('returns 400 when id is missing or empty', async () => {
      const req = { params: {} };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('returns 404 when vendor does not exist', async () => {
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);

      const req = { params: { id: 'non-existent' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('returns 404 when vendor belongs to a private buyer roster (buyerId or buyerAccountId is set)', async () => {
      const privateVendor1 = {
        id: 'v-private-1',
        buyerId: 'buyer-999',
        name: 'Private Supplier',
      };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(privateVendor1);

      const req1 = { params: { id: 'v-private-1' } };
      const res1 = mockRes();
      await vendorController.getPublicVendorById(req1, res1, jest.fn());
      expect(res1.status).toHaveBeenCalledWith(404);

      const privateVendor2 = {
        id: 'v-private-2',
        buyerAccountId: 'ba-555',
        name: 'Private Supplier 2',
      };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(privateVendor2);

      const req2 = { params: { id: 'v-private-2' } };
      const res2 = mockRes();
      await vendorController.getPublicVendorById(req2, res2, jest.fn());
      expect(res2.status).toHaveBeenCalledWith(404);
    });

    test('returns 200 with sanitized vendor when vendor is part of the public network', async () => {
      const publicVendor = {
        id: 'v-pub-88',
        name: 'Tata Steel Tubes Division',
        email: 'tubes@tatasteel.example.com',
        pan: 'AAACT1234G',
        gst: '27AAACT1234G1Z1',
        score: 92,
        city: 'Jamshedpur',
        major_category: 'Metals & Alloys',
      };
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(publicVendor);

      const req = { params: { id: 'v-pub-88' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorById(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            id: 'v-pub-88',
            name: 'Tata Steel Tubes Division',
            pan: 'AAA****4G',
            gstin: '27AAACT1234G1Z1',
            rating: 4.6, // Math.round(92 / 20 * 10) / 10
            location: 'Jamshedpur',
          }),
        })
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        expect.stringContaining('public')
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('calls next(err) when database error occurs', async () => {
      const dbError = new Error('Timeout');
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockRejectedValue(dbError);

      const req = { params: { id: 'v-err' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.getPublicVendorById(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  describe('domainQueries.getPublicVendorsPageFromDB', () => {
    test('returns empty result when pool has no storage', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const result = await domainQueries.getPublicVendorsPageFromDB();
      expect(result).toEqual({ rows: [], total: 0 });
    });

    test('builds and executes count and data queries with filters', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: 5 }] }) // count query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'v-sql-1',
              major_category: 'Electrical',
              status: 'VERIFIED SUPPLIER',
              created_at: '2024-02-01',
              raw: JSON.stringify({ id: 'v-sql-1', name: 'Havells India' }),
            },
          ],
        }); // data query

      const result = await domainQueries.getPublicVendorsPageFromDB({
        limit: 10,
        offset: 0,
        search: 'havells',
        category: 'Electrical',
        state: 'Delhi',
        minRating: 4.2,
      });

      expect(result.total).toBe(5);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Havells India');
      expect(querySpy).toHaveBeenCalledTimes(2);
    });

    test('builds and executes queries when category and state are all or omitted', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(null);

      const result = await domainQueries.getPublicVendorsPageFromDB({
        category: 'all',
        state: 'all',
        minRating: 0,
      });

      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    test('builds and executes queries when verifiedOnly is true', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: 2 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'v-sql-ver-1',
              major_category: 'Mechanical',
              status: 'verified',
              created_at: '2024-03-01',
              raw: JSON.stringify({ id: 'v-sql-ver-1', name: 'Verified Supplier Co', isVerified: true }),
            },
          ],
        });

      const result = await domainQueries.getPublicVendorsPageFromDB({
        verifiedOnly: true,
      });

      expect(result.total).toBe(2);
      expect(result.rows).toHaveLength(1);
      expect(querySpy.mock.calls[0][0]).toContain('status = \'verified\'');
    });

    test('serves subsequent requests from queryCache without hitting database', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'v-cached-sql-1',
              major_category: 'Electrical',
              status: 'active',
              created_at: '2024-03-01',
              raw: JSON.stringify({ id: 'v-cached-sql-1', name: 'Cached Cables Ltd' }),
            },
          ],
        });

      const firstCall = await domainQueries.getPublicVendorsPageFromDB({
        limit: 10,
        offset: 0,
        category: 'Electrical',
      });
      expect(firstCall.total).toBe(1);
      expect(firstCall.rows).toHaveLength(1);
      expect(querySpy).toHaveBeenCalledTimes(2);

      // Second call with same parameters should return cached result without calling pool.query
      const secondCall = await domainQueries.getPublicVendorsPageFromDB({
        limit: 10,
        offset: 0,
        category: 'Electrical',
      });
      expect(secondCall).toEqual(firstCall);
      expect(querySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('domainQueries.getPublicVendorFiltersFromDB', () => {
    test('returns empty categories and standard states when storage is not available', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const result = await domainQueries.getPublicVendorFiltersFromDB();
      expect(result.categories).toEqual([]);
      expect(result.states).toEqual([...INDIAN_STATES]);
    });

    test('queries and returns distinct categories and standard states when storage is available', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({
          rows: [
            { category: 'Mechanical & Fluid Equipment' },
            { category: 'Engineering Spares - Electrical' },
            { category: 'Uncategorized (No Past POs)' },
            { category: 'X' },
          ],
        });

      const result = await domainQueries.getPublicVendorFiltersFromDB();

      expect(result.categories).toEqual([
        'Mechanical & Fluid Equipment',
        'Engineering Spares - Electrical',
      ]);
      expect(result.states).toEqual([...INDIAN_STATES]);
    });

    test('handles empty or null query rows gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce(null);

      const result = await domainQueries.getPublicVendorFiltersFromDB();
      expect(result.categories).toEqual([]);
      expect(result.states).toEqual([...INDIAN_STATES]);
    });

    test('catches query errors and returns empty categories with standard states', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('Filter query failed'));

      const result = await domainQueries.getPublicVendorFiltersFromDB();
      expect(result.categories).toEqual([]);
      expect(result.states).toEqual([...INDIAN_STATES]);
    });
  });

  describe('vendorController.authenticateVendorDirectory', () => {
    test('authenticates successfully with default passkey', async () => {
      const req = { body: { passcode: 'Procucev@Vendors2026' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          token: expect.stringMatching(/^vdir_/),
          expiresAt: expect.any(Number),
          message: 'Vendor directory authentication successful.',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('authenticates successfully with alias passkey VENDOR2026', async () => {
      const req = { body: { accessKey: 'VENDOR2026' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          token: expect.stringMatching(/^vdir_/),
        })
      );
    });

    test('authenticates successfully with credentials username and password', async () => {
      const req = {
        body: {
          username: 'directory@procucev.com',
          password: 'Procucev@Vendors2026',
        },
      };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          token: expect.stringMatching(/^vdir_/),
        })
      );
    });

    test('returns 401 with descriptive error when passkey is invalid', async () => {
      const req = { body: { passcode: 'wrong-passkey' } };
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid directory access key. Please enter the valid passkey provided by Procucev.',
      });
    });

    test('returns 401 when body is empty or missing passkey', async () => {
      const req = {};
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    test('handles exceptions and calls next(err)', async () => {
      const req = null; // triggers exception in destructuring or body access
      const res = mockRes();
      const next = jest.fn();

      await vendorController.authenticateVendorDirectory(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
