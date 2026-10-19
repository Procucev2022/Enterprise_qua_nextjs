const vendorController = require('../src/controllers/vendorController');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Public Vendor Directory Backend Controller & Database Queries', () => {
  afterEach(() => {
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
  });
});
