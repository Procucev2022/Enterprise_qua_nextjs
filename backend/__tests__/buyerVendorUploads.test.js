const express = require('express');
const request = require('supertest');

const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const { queryCache } = require('../src/db/queryCache');
const domainQueries = require('../src/db/domainQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const buyerVendorUploadQueries = require('../src/db/buyerVendorUploadQueries');
const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
const storeService = require('../src/services/storeService');
const vendorIngestionService = require('../src/services/vendorIngestionService');
const authService = require('../src/services/authService');
const apiRoutes = require('../src/routes');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('Buyer-Vendor Upload Relationships (Queries, Services, and API Endpoints)', () => {
  beforeEach(() => {
    storeService.reset();
    queryCache.clear();
    jest.restoreAllMocks();
  });

  describe('buyerVendorUploadQueries unit tests', () => {
    it('returns null or empty arrays when storage is not configured or inputs are invalid', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      expect(await buyerVendorUploadQueries.recordBuyerVendorUploadInDB({ buyerId: 'b-1', vendorId: 'v-1' })).toBeNull();
      expect(await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([{ buyerId: 'b-1', vendorId: 'v-1' }])).toEqual([]);
      expect(await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('b-1')).toEqual([]);
      expect(await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-1')).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      expect(await buyerVendorUploadQueries.recordBuyerVendorUploadInDB(null)).toBeNull();
      expect(await buyerVendorUploadQueries.recordBuyerVendorUploadInDB({ buyerId: '', vendorId: 'v-1' })).toBeNull();
      expect(await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([])).toEqual([]);
      expect(await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([{ buyerId: '', vendorId: '' }])).toEqual([]);
    });

    it('records single buyer-vendor upload in DB and handles query errors safely', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [{ id: 'bvu-row-1', buyer_id: 'b-1', vendor_id: 'v-1' }],
      });

      const saved = await buyerVendorUploadQueries.recordBuyerVendorUploadInDB({
        id: 'bvu-row-1',
        buyerId: 'b-1',
        vendorId: 'v-1',
        buyerName: 'Buyer One',
        buyerCompany: 'Corp One',
        buyerEmail: 'BUYER1@CORP.COM',
        vendorName: 'Vendor One',
        vendorEmail: 'VENDOR1@SUPPLY.COM',
        uploadedAt: '2026-10-10T10:00:00.000Z',
      });

      expect(saved).toEqual({ id: 'bvu-row-1', buyer_id: 'b-1', vendor_id: 'v-1' });
      expect(querySpy).toHaveBeenCalledTimes(1);

      querySpy.mockRejectedValueOnce(new Error('DB write failure'));
      const failed = await buyerVendorUploadQueries.recordBuyerVendorUploadInDB({
        buyerId: 'b-1',
        vendorId: 'v-2',
        uploadedAt: new Date('invalid-date'),
      });
      expect(failed).toBeNull();
    });

    it('bulk-records deduplicated uploads across D1 batch and PostgreSQL multi-row paths', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // 1. D1 batch path
      const fakeD1 = { prepare: jest.fn() };
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(fakeD1);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const batchSpy = jest.spyOn(d1Bridge, 'batchD1').mockResolvedValueOnce([
        { rows: [{ id: 'bvu-1', buyer_id: 'b-1', vendor_id: 'v-1' }] },
      ]);

      const d1Rows = await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([
        { id: 'bvu-1', buyerId: 'b-1', vendorId: 'v-1' },
        { id: 'bvu-dup', buyerId: 'B-1', vendorId: 'V-1' }, // duplicate pair skipped
        { buyerId: '', vendorId: 'v-2' }, // invalid pair skipped
      ]);
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(d1Rows).toHaveLength(1);

      // 2. D1 HTTP Client + multi-chunk batch (> 25 records)
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue({ http: true });
      const thirtyRecords = Array.from({ length: 30 }, (_, idx) => ({
        id: `bvu-chunk-${idx}`,
        buyerId: `b-chunk-${idx}`,
        vendorId: `v-chunk-${idx}`,
      }));
      batchSpy.mockResolvedValue([{ rows: [] }]);
      await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB(thirtyRecords);
      expect(batchSpy).toHaveBeenCalledTimes(3); // 1 from earlier + 2 chunks (25 + 5)

      // 3. PostgreSQL path
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      const pgSpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({
        rows: [{ id: 'bvu-pg-1', buyer_id: 'b-2', vendor_id: 'v-2' }],
      });
      const pgRows = await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([
        { id: 'bvu-pg-1', buyerId: 'b-2', vendorId: 'v-2' },
      ]);
      expect(pgSpy).toHaveBeenCalledTimes(1);
      expect(pgRows).toEqual([{ id: 'bvu-pg-1', buyer_id: 'b-2', vendor_id: 'v-2' }]);

      // 3. Error branch
      pgSpy.mockRejectedValueOnce(new Error('PG bulk failure'));
      const errRows = await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([
        { id: 'bvu-pg-2', buyerId: 'b-3', vendorId: 'v-3' },
      ]);
      expect(errRows).toEqual([]);
    });

    it('resolves buyer aliases and aggregates uploaded vendors from junction, vendors, and category mappings', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM buyer_accounts')) {
          return {
            rows: [
              {
                id: 'buyer-acc-1',
                corporate_email: 'buyer1@corp.com',
                raw: JSON.stringify({ organizationId: 'org-1', userId: 'u-1', organizationName: 'Corp One' }),
              },
              {
                id: 'buyer-acc-bad-json',
                corporate_email: null,
                raw: 12345,
              },
              {
                id: 'buyer-acc-invalid-json',
                corporate_email: null,
                raw: '{not-valid-json',
              },
            ],
          };
        }
        if (sql.includes('FROM organization o')) {
          return {
            rows: [
              {
                org_uuid: 'org-1',
                organization_name: 'Corp One',
                org_email: 'org1@corp.com',
                user_uuid: 'u-1',
                username: 'buyer1@corp.com',
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads bvu')) {
          return {
            rows: [
              {
                id: 'bvu-1',
                buyer_id: 'buyer-acc-1',
                vendor_id: 'v-1',
                vendor_name: 'Alpha Steel',
                vendor_email: 'sales@alphasteel.in',
                upload_source: 'buyer_uploaded',
                status: 'VERIFIED_CLIENT_LIST',
                uploaded_at: '2026-10-12T10:00:00.000Z',
                vendor_raw: JSON.stringify({
                  id: 'v-1',
                  name: 'Alpha Steel Pvt Ltd',
                  contactPerson: 'Rajiv Nair',
                  email: 'sales@alphasteel.in',
                  phone: '+91 9811112222',
                  city: 'Mumbai',
                  state: 'Maharashtra',
                  majorCategory: 'Raw Materials',
                }),
                vendor_created_at: '2026-10-01T10:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM vendors WHERE')) {
          return {
            rows: [
              {
                id: 'v-1',
                created_at: '2026-10-01T10:00:00.000Z',
                raw: JSON.stringify({ id: 'v-1', name: 'Alpha Steel Pvt Ltd', buyerId: 'buyer-acc-1' }),
              },
              {
                id: 'v-2',
                created_at: '2026-10-15T10:00:00.000Z',
                raw: {
                  id: 'v-2',
                  name: 'Beta Pumps',
                  email: 'info@betapumps.in',
                  phone: '9876543210',
                  mappedBuyerIds: ['buyer-acc-1'],
                  status: 'ACTIVE',
                },
              },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings vcm')) {
          return {
            rows: [
              {
                id: 'vcm-1',
                organization_id: 'org-1',
                vendor_id: 'v-3',
                company_name: 'Gamma Logistics',
                email: 'ops@gammalogistics.in',
                source: 'vendor_master_ingestion',
                status: 'approved',
                created_at: '2026-10-20T09:00:00.000Z',
                vendor_raw: JSON.stringify({
                  id: 'v-3',
                  name: 'Gamma Logistics LLP',
                  location: 'Chennai',
                  verificationStatus: 'PENDING EVALUATION',
                }),
                vendor_created_at: '2026-10-20T09:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      });

      const vendors = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('buyer1@corp.com', { limit: 10 });
      expect(vendors).toHaveLength(3);
      expect(vendors.map((v) => v.vendorId)).toEqual(['v-3', 'v-2', 'v-1']);
      expect(vendors[2]).toEqual(
        expect.objectContaining({
          vendorId: 'v-1',
          vendorName: 'Alpha Steel Pvt Ltd',
          contactPerson: 'Rajiv Nair',
          email: 'sales@alphasteel.in',
          phone: '+91 9811112222',
          location: 'Mumbai, Maharashtra',
          status: 'VERIFIED_CLIENT_LIST',
        })
      );

      // Cached hit avoids re-querying
      const callsBefore = querySpy.mock.calls.length;
      const cached = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('buyer1@corp.com', { limit: 10 });
      expect(cached).toHaveLength(3);
      expect(querySpy.mock.calls.length).toBeLessThan(callsBefore + 3);

      // SafeQuery error resilience + minimal vendor with no buyer links -> hits hydrateBuyerMetadataMap empty early return
      querySpy.mockRejectedValue(new Error('Simulated transient SQL failure'));
      const fallbackSafe = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('err@corp.com', {
        knownBuyer: { id: 'err-id', organizationId: 'org-err', corporateEmail: 'err@corp.com', organizationName: 'Err Org' },
      });
      expect(fallbackSafe).toEqual([]);

      const bareVendorUploads = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-bare-1', {
        knownVendor: { id: 'v-bare-1', name: 'Bare Supplier', email: 'bare@supplier.in' },
      });
      expect(bareVendorUploads).toEqual({
        vendorId: 'v-bare-1',
        totalBuyers: 0,
        buyerUploads: [],
      });

      // Blank identifier returns empty array
      expect(await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('')).toEqual([]);
    });

    it('fetches, merges, and hydrates multi-buyer upload records for a seller ID and handles errors', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM vendors WHERE lower(id)')) {
          return {
            rows: [
              {
                id: 'v-multi-1',
                created_at: '2026-10-01T10:00:00.000Z',
                raw: JSON.stringify({
                  id: 'v-multi-1',
                  name: 'Shared CNC Corp',
                  email: 'shared@cnc.in',
                  buyerId: 'buyer-a',
                  buyerEmail: 'a@corp.com',
                  addedByBuyerCompany: 'Buyer A Corp',
                  mappedBuyerIds: ['buyer-a', 'org-b'],
                  source: 'vendor_master_ingestion',
                  createdAt: '2026-10-05T10:00:00.000Z',
                }),
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads')) {
          return {
            rows: [
              {
                id: 'bvu-a',
                buyer_id: 'buyer-a',
                vendor_id: 'v-multi-1',
                buyer_name: 'Amit Patel',
                buyer_company: 'Buyer A Corp',
                buyer_email: 'a@corp.com',
                upload_source: 'buyer_uploaded',
                status: 'ACTIVE',
                uploaded_at: '2026-10-05T10:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings')) {
          return {
            rows: [
              {
                id: 'vcm-b',
                organization_id: 'org-b',
                source: 'vendor_master_ingestion',
                status: 'approved',
                created_at: '2026-10-18T11:30:00.000Z',
                reviewed_at: '2026-10-18T12:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_accounts WHERE')) {
          return {
            rows: [
              {
                id: 'buyer-a',
                corporate_email: 'a@corp.com',
                status: 'ACTIVE_VERIFIED',
                created_at: '2026-09-01T00:00:00.000Z',
                raw: JSON.stringify({
                  organizationName: 'Buyer A Corp',
                  contactPerson: 'Amit Patel',
                  primaryPlantLocation: 'Ahmedabad',
                  state: 'Gujarat',
                  sourcingMode: 'mode_1',
                }),
              },
            ],
          };
        }
        if (sql.includes('FROM organization o')) {
          return {
            rows: [
              {
                org_uuid: 'org-b',
                organization_name: 'Buyer B Heavy Industries',
                contact_person: 'Meera Iyer',
                org_email: 'procurement@buyerb.in',
                organization_phonenumber: '044-1234567',
                city: 'Chennai',
                state: 'Tamil Nadu',
                gstin: '33AAACB1234B1Z5',
                created_ts: '2026-08-15T00:00:00.000Z',
                user_uuid: 'u-b',
                username: 'meera@buyerb.in',
              },
            ],
          };
        }
        throw new Error('Unexpected SQL failure');
      });

      const payload = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-multi-1', { limit: 20 });
      expect(payload).toEqual(
        expect.objectContaining({
          vendorId: 'v-multi-1',
          totalBuyers: 2,
        })
      );
      expect(payload.buyerUploads[0]).toEqual(
        expect.objectContaining({
          organizationId: 'org-b',
          buyerName: 'Meera Iyer',
          companyName: 'Buyer B Heavy Industries',
          location: 'Chennai, Tamil Nadu',
          status: 'ACTIVE_VERIFIED',
          uploadDate: '2026-10-18T12:00:00.000Z',
        })
      );
      expect(payload.buyerUploads[1]).toEqual(
        expect.objectContaining({
          buyerId: 'buyer-a',
          buyerName: 'Amit Patel',
          companyName: 'Buyer A Corp',
          sourcingMode: 'mode_1',
          status: 'ACTIVE_VERIFIED',
        })
      );

      // Second read with knownVendor hits cache with 0 DB calls
      const beforeCacheRead = querySpy.mock.calls.length;
      const cached = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-multi-1', {
        limit: 20,
        knownVendor: { id: 'v-multi-1', email: 'shared@cnc.in' },
      });
      expect(cached.totalBuyers).toBe(2);
      expect(querySpy.mock.calls.length).toBe(beforeCacheRead);

      // Unknown vendor returns null gracefully
      querySpy.mockRejectedValueOnce(new Error('DB connection error'));
      expect(await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('missing-v')).toBeNull();
    });

    it('covers sparse rows, Date timestamps, duplicate merging, and default helper branches', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const validDate = new Date('2026-10-01T00:00:00.000Z');
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM buyer_accounts WHERE') && sql.includes('lower(id)') && !sql.includes('status')) {
          return { rows: [] };
        }
        if (sql.includes('FROM buyer_accounts WHERE')) {
          return {
            rows: [
              {
                id: 'b-sparse-1',
                corporate_email: null,
                status: null,
                created_at: validDate,
                raw: {},
              },
              {
                id: 'b-full-1',
                corporate_email: 'full@buyer.in',
                status: 'ACTIVE_VERIFIED',
                created_at: validDate,
                raw: JSON.stringify({
                  id: 'b-full-1',
                  organizationId: 'org-full-1',
                  organizationName: 'Full Buyer Org',
                  contactPerson: 'Priya Verma',
                  mobileNumber: '9988776655',
                  city: 'Delhi',
                  gstin: '07AAAFF1234F1Z5',
                  sourcingMode: 'mode_2',
                }),
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads bvu')) {
          return {
            rows: [
              {
                id: null,
                buyer_id: 'b-sparse-1',
                vendor_id: 'v-merge-1',
                vendor_name: null,
                vendor_email: null,
                upload_source: null,
                status: null,
                uploaded_at: null,
                created_at: null,
                vendor_raw: null,
                vendor_created_at: null,
              },
              {
                id: 'bvu-merge-2',
                buyer_id: 'b-sparse-1',
                vendor_id: 'v-merge-1',
                vendor_name: 'Merged Vendor',
                vendor_email: 'merge@vendor.in',
                upload_source: 'excel',
                status: 'ACTIVE',
                uploaded_at: '2026-10-08T10:00:00.000Z',
                vendor_raw: JSON.stringify({
                  contactPerson: 'Contact Merge',
                  phone: '9112233445',
                  country: 'India',
                  category: 'Spares',
                }),
                vendor_created_at: validDate,
              },
            ],
          };
        }
        if (sql.includes('FROM vendors WHERE')) {
          return {
            rows: [
              {
                id: 'v-merge-1',
                created_at: '2026-10-03T10:00:00.000Z',
                raw: JSON.stringify({
                  corporateEmail: 'merge@vendor.in',
                  companyName: 'Merged Co',
                  buyerEmail: 'onlyemail@buyer.in',
                }),
              },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings vcm')) {
          return { rows: [] };
        }
        if (sql.includes('FROM buyer_vendor_uploads')) {
          return {
            rows: [
              {
                id: null,
                buyer_id: 'b-sparse-1',
                buyer_name: null,
                buyer_company: null,
                buyer_email: null,
                upload_source: null,
                status: null,
                uploaded_at: 'bad-date-text',
              },
              {
                id: 'bvu-2',
                buyer_id: 'b-sparse-1',
                buyer_name: 'Later Buyer Name',
                buyer_company: 'Later Buyer Co',
                buyer_email: 'later@buyer.in',
                upload_source: 'buyer_uploaded',
                status: 'VERIFIED',
                uploaded_at: '2026-10-12T00:00:00.000Z',
              },
              {
                id: 'bvu-3',
                buyer_id: 'b-full-1',
                buyer_name: 'Priya Verma',
                buyer_company: 'Full Buyer Org',
                buyer_email: 'full@buyer.in',
                upload_source: 'buyer_uploaded',
                status: 'ACTIVE',
                uploaded_at: '2026-10-01T00:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings')) {
          return {
            rows: [
              {
                id: 'vcm-sparse',
                organization_id: 'org-full-1',
                source: null,
                status: 'pending',
                created_at: '2026-10-15T00:00:00.000Z',
                reviewed_at: null,
              },
            ],
          };
        }
        if (sql.includes('FROM organization o')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const emailOnlyVendors = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('onlyemail@buyer.in');
      expect(emailOnlyVendors).toHaveLength(1);
      expect(emailOnlyVendors[0]).toEqual(
        expect.objectContaining({
          vendorId: 'v-merge-1',
          vendorName: 'Merged Vendor',
          contactPerson: 'Contact Merge',
          phone: '9112233445',
        })
      );

      const mergedBuyers = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-merge-1', {
        knownVendor: {
          id: 'v-merge-1',
          email: '',
          buyerId: 'b-sparse-1',
          buyerIds: ['b-full-1'],
        },
      });
      expect(mergedBuyers.totalBuyers).toBe(2);
    });

    it('covers remaining query branch edge cases (empty inputs, malformed JSON, empty filters, missing rows)', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // resolveBuyerAliases with null / empty input
      expect(await buyerVendorUploadQueries.resolveBuyerAliases('')).toEqual({
        buyerIds: [],
        emails: [],
        organizationId: null,
        companyName: null,
      });

      // query returning null / empty object, and non-Error rejection in recordBuyerVendorUploadInDB
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({});
      const recFallback = await buyerVendorUploadQueries.recordBuyerVendorUploadInDB({
        buyerId: 'b-edge-1',
        vendorId: 'v-edge-1',
      });
      expect(recFallback.buyerId).toBe('b-edge-1');

      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ prepare: jest.fn() });
      jest.spyOn(d1Bridge, 'getD1HttpClient').mockReturnValue(null);
      jest.spyOn(d1Bridge, 'batchD1').mockResolvedValueOnce([null, { rows: null }]);
      expect(
        await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([
          { buyerId: 'b-d1', vendorId: 'v-d1' },
        ])
      ).toEqual([]);

      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue(null);
      querySpy.mockResolvedValueOnce({});
      const pgFallback = await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB([
        { buyerId: 'b-pg-empty', vendorId: 'v-pg-empty' },
      ]);
      expect(pgFallback).toHaveLength(1);
      expect(await buyerVendorUploadQueries.bulkRecordBuyerVendorUploadsInDB(null)).toEqual([]);

      // Known buyer with aliases + org row filling blanks + id-only & empty-candidate hydration branches
      querySpy.mockImplementation(async (sql) => {
        if (sql.includes('SELECT id, corporate_email, raw FROM buyer_accounts')) {
          return {
            rows: [{ id: 'b-alias', corporate_email: 'alias@corp.com', raw: '["not-obj"]' }],
          };
        }
        if (sql.includes('FROM organization o')) {
          return {
            rows: [
              {
                org_uuid: 'org-edge',
                organization_name: 'Edge Org',
                org_email: 'edge@org.com',
                user_uuid: 'u-edge',
                username: 'alias@corp.com',
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads bvu')) {
          return {
            rows: [
              {
                id: null,
                buyer_id: 'b-alias',
                vendor_id: null,
                vendor_name: null,
                vendor_email: null,
                uploaded_at: '   ',
                vendor_raw: '[]',
                vendor_created_at: new Date('invalid'),
              },
            ],
          };
        }
        return { rows: null };
      });

      const knownAliasVendors = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('b-id-only', {
        knownBuyer: {
          id: 'b-alias',
          organizationId: 'org-edge',
          userId: 'u-edge',
          corporateEmail: 'alias@corp.com',
          email: 'alt@corp.com',
          organizationName: 'Known Org',
        },
      });
      expect(knownAliasVendors).toEqual([]);

      // getBuyerUploadsByVendorFromDB with id-only mappedBuyerIds and empty metadata
      const emptyHydration = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-no-email', {
        limit: 9999,
        knownVendor: {
          id: 'v-no-email',
          buyerId: 'only-id-buyer',
          mappedBuyerIds: ['', 'only-id-buyer'],
        },
      });
      expect(emptyHydration.totalBuyers).toBe(1);

      const noCandidates = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-empty-cands', {
        knownVendor: { id: 'v-empty-cands' },
      });
      expect(noCandidates.totalBuyers).toBe(0);

      // non-Error string throw in safeQuery
      querySpy.mockRejectedValueOnce('plain-string-error');
      expect(await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('b-err-str')).toEqual([]);

      // Rich before sparse merge, email-only & company-only keys, orgRows filling/preserving baRows, pickEarliestOrLatestIso branches
      querySpy.mockImplementation(async (sql) => {
        if (sql.includes('FROM buyer_accounts WHERE') && !sql.includes('status')) {
          return {
            rows: [
              { id: 'b-rich-1', corporate_email: 'rich@corp.com', raw: {} },
            ],
          };
        }
        if (sql.includes('SELECT id, corporate_email, status, created_at, raw FROM buyer_accounts')) {
          return {
            rows: [
              {
                id: 'b-hydrated-1',
                corporate_email: null,
                status: 'ACTIVE',
                created_at: '2026-10-01T00:00:00.000Z',
                raw: JSON.stringify({
                  organizationId: null,
                  organizationName: '',
                  contactPerson: 'Ba Contact',
                  corporateEmail: '',
                  mobileNumber: '9000011111',
                  city: 'Jaipur',
                  gstin: '08AAAAA0000A1Z5',
                }),
              },
            ],
          };
        }
        if (sql.includes('FROM organization o')) {
          return {
            rows: [
              {
                org_uuid: 'org-h-1',
                organization_name: 'Org Fill Co',
                contact_person: null,
                full_name: 'User Full Name',
                org_email: 'orgfill@corp.com',
                user_uuid: 'u-h-1',
                username: '',
                phone: '9888877777',
                city: 'Udaipur',
                gstin: '08BBBBB0000B1Z5',
                created_ts: '2026-10-02T00:00:00.000Z',
              },
              {
                org_uuid: '',
                organization_name: '',
                org_email: '',
                user_uuid: '',
                username: '',
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads bvu')) {
          return {
            rows: [
              {
                id: 'bvu-email-key',
                buyer_id: 'b-rich-1',
                vendor_id: '',
                vendor_name: 'Email Key Vendor',
                vendor_email: 'emailkey@sup.in',
                upload_source: 'buyer_manual',
                status: 'ACTIVE',
                uploaded_at: '2026-10-20T00:00:00.000Z',
                vendor_raw: JSON.stringify({
                  name: 'Email Key Vendor',
                  companyName: 'Email Key Co',
                  contactPerson: 'Kiran',
                  email: 'emailkey@sup.in',
                  phone: '9111122222',
                  location: 'Chennai',
                  majorCategory: 'IT',
                }),
              },
              {
                id: 'bvu-email-key-2',
                buyer_id: 'b-rich-1',
                vendor_id: '',
                vendor_name: null,
                vendor_email: 'emailkey@sup.in',
                upload_source: null,
                status: null,
                uploaded_at: '2026-10-05T00:00:00.000Z',
                vendor_raw: null,
              },
              {
                id: 'bvu-email-key-3',
                buyer_id: 'b-rich-1',
                vendor_id: '',
                vendor_name: null,
                vendor_email: 'emailkey@sup.in',
                uploaded_at: null,
              },
              {
                id: 'bvu-email-key-4',
                buyer_id: 'b-rich-1',
                vendor_id: '',
                vendor_name: null,
                vendor_email: 'emailkey@sup.in',
                uploaded_at: 'not-valid-iso',
              },
            ],
          };
        }
        if (sql.includes('FROM buyer_vendor_uploads')) {
          return {
            rows: [
              { id: 'u-email-only', buyer_id: '', buyer_email: 'only@buyer.in', uploaded_at: '2026-10-10T00:00:00.000Z' },
              { id: 'u-comp-only', buyer_id: '', buyer_company: 'Only Company Ltd', uploaded_at: '2026-10-11T00:00:00.000Z' },
              { id: 'u-all-empty', buyer_id: '', buyer_email: '', buyer_company: '' },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings vcm')) {
          return {
            rows: [
              {
                id: 'vcm-no-src',
                vendor_id: '',
                company_name: 'Unlinked Mapping',
                email: 'emailkey@sup.in',
                source: null,
                status: 'approved',
                created_at: '2026-10-01T00:00:00.000Z',
                vendor_raw: null,
              },
            ],
          };
        }
        if (sql.includes('FROM vendor_category_mappings')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const richMerged = await buyerVendorUploadQueries.getUploadedVendorsByBuyerFromDB('b-rich-1');
      expect(richMerged).toHaveLength(1);
      expect(richMerged[0].uploadDate).toBe('2026-10-20T00:00:00.000Z');

      const diverseBuyers = await buyerVendorUploadQueries.getBuyerUploadsByVendorFromDB('v-div-1', {
        knownVendor: { id: 'v-div-1', email: '', addedByBuyerCompany: 'Only Company Ltd' },
      });
      expect(diverseBuyers.totalBuyers).toBe(2);
    });
  });

  describe('storeService & vendorIngestionService multi-buyer upload persistence', () => {
    it('tracks multiple buyers uploading the same vendor across ingestion and historical dumps without duplicates', async () => {
      const buyerA = storeService.addBuyerAccount({
        id: 'buyer-a',
        organizationId: 'org-a',
        organizationName: 'Alpha Motors',
        contactPerson: 'Vikram Rao',
        corporateEmail: 'vikram@alphamotors.in',
        sourcingMode: 'mode_1',
        status: 'ACTIVE_VERIFIED',
      });
      const buyerB = storeService.addBuyerAccount({
        id: 'buyer-b',
        organizationId: 'org-b',
        organizationName: 'Beta Aerospace',
        contactPerson: 'Neha Kulkarni',
        corporateEmail: 'neha@betaaero.in',
        sourcingMode: 'mode_2',
        status: 'ACTIVE_VERIFIED',
      });

      const createdVendor = await storeService.addVendorDurably(
        {
          name: 'Precision Forgings Ltd',
          email: 'rfq@precisionforgings.in',
          contactPerson: 'Suresh Menon',
          phone: '9820012345',
          majorCategory: 'Machined Components',
          buyerId: buyerA.id,
          buyerAccountId: buyerA.id,
          buyerEmail: buyerA.corporateEmail,
          addedByBuyerCompany: buyerA.organizationName,
          source: 'buyer_uploaded',
        },
        buyerA.corporateEmail
      );

      // Second buyer processes historical purchase dump referencing the exact same supplier
      const histResult = await storeService.processHistoricalPurchaseData(
        '12M',
        [
          {
            companyName: 'Precision Forgings Ltd',
            email: 'rfq@precisionforgings.in',
            majorCategory: 'Machined Components',
            minorCategories: ['Forgings'],
            contactPerson: 'Suresh Menon',
            phone: '9820012345',
            location: 'Pune',
          },
          {
            companyName: 'New Hist Supplier',
            email: 'contact@newhist.in',
            majorCategory: 'Spares',
          },
        ],
        buyerB
      );

      expect(histResult.importedCount).toBe(2);
      // Must NOT duplicate the vendor record in storeService.vendors
      expect(storeService.vendors.filter((v) => v.email === 'rfq@precisionforgings.in')).toHaveLength(1);
      // Preserves original owner while recording both buyer links
      expect(createdVendor.buyerId).toBe('buyer-a');
      expect(createdVendor.mappedBuyerIds).toEqual(expect.arrayContaining(['buyer-a', 'buyer-b']));

      const sellerUploads = await storeService.getBuyerUploadsForVendor(createdVendor.id, createdVendor);
      expect(sellerUploads.totalBuyers).toBe(2);
      expect(sellerUploads.buyerUploads.map((b) => b.companyName)).toEqual(
        expect.arrayContaining(['Alpha Motors', 'Beta Aerospace'])
      );

      const buyerAVendors = await storeService.getUploadedVendorsForBuyer(buyerA.id, buyerA);
      const buyerBVendors = await storeService.getUploadedVendorsForBuyer(buyerB.id, buyerB);
      expect(buyerAVendors.map((v) => v.vendorId)).toContain(createdVendor.id);
      expect(buyerBVendors.map((v) => v.vendorId)).toEqual(
        expect.arrayContaining([createdVendor.id])
      );
      expect(buyerBVendors).toHaveLength(2);
    });

    it('bulkAddVendors persists buyer upload links and empanelApprovedVendor preserves multi-buyer uploads', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue(['bulk@supplier.in']);
      jest.spyOn(domainQueries, 'upsertVendorInDB').mockImplementation(async (v) => v);
      jest.spyOn(domainQueries, 'updateVendorIfUnchangedInDB').mockImplementation(async (_snap, upd) => upd);
      jest.spyOn(domainQueries, 'getVendorSnapshotByIdFromDB').mockImplementation(async (id) => {
        const found = storeService.vendors.find((v) => v.id === id);
        return found ? { id: found.id, version: 1, vendor: found } : null;
      });
      const bulkUploadSpy = jest.spyOn(domainQueries, 'bulkRecordBuyerVendorUploadsInDB').mockResolvedValue([]);
      const singleUploadSpy = jest.spyOn(domainQueries, 'recordBuyerVendorUploadInDB').mockResolvedValue({});

      const buyerOne = storeService.addBuyerAccount({
        id: 'buyer-bulk-1',
        organizationId: 'org-bulk-1',
        organizationName: 'Bulk Buyer Co',
        corporateEmail: 'bulk@buyer.com',
      });

      const bulkRes = await storeService.bulkAddVendors([
        {
          rowNumber: 1,
          name: 'Bulk Metal Works',
          email: 'bulk@supplier.in',
          phone: '9876543210',
          majorCategory: 'Metal',
          buyerId: buyerOne.id,
          buyerAccountId: buyerOne.id,
          buyerEmail: buyerOne.corporateEmail,
          addedByBuyerCompany: buyerOne.organizationName,
        },
      ]);
      expect(bulkRes.importedCount).toBe(1);
      expect(bulkUploadSpy).toHaveBeenCalledTimes(1);

      // Now Buyer 2 empaneled the same vendor via vendorIngestionService.empanelApprovedVendor
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
        contactPerson: 'Sales Lead',
        phone: '9988776655',
        address: 'Delhi',
        gstin: '07AAAAA0000A1Z5',
      });
      jest.spyOn(vendorIngestionQueries, 'attachVendorId').mockResolvedValue(true);
      const createdVendor = storeService.vendors.find((v) => v.email === 'bulk@supplier.in');
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(createdVendor);

      const secondBuyer = storeService.addBuyerAccount({
        id: 'buyer-ing-2',
        organizationId: 'org-ing-2',
        organizationName: 'Ingest Buyer Two',
        corporateEmail: 'ing2@buyer.com',
      });

      const empaneledExisting = await vendorIngestionService.empanelApprovedVendor(
        {
          email: secondBuyer.corporateEmail,
          organizationId: secondBuyer.organizationId,
          organizationName: secondBuyer.organizationName,
        },
        'sess-1',
        {
          id: 'map-1',
          vendorRecordId: 'vmr-1',
          companyName: 'Bulk Metal Works',
          email: 'bulk@supplier.in',
          buyerMajorCategory: 'Metal',
          buyerMinorCategories: ['Sheets'],
          aiSuggestion: { majorCategory: 'Metal', minorCategories: [] },
        }
      );

      expect(empaneledExisting.addedByBuyerCompany).toBe('Bulk Buyer Co');
      expect(singleUploadSpy).toHaveBeenCalled();

      const buyerUploads = await storeService.getBuyerUploadsForVendor(createdVendor.id, createdVendor);
      expect(buyerUploads.totalBuyers).toBe(2);

      // And fresh vendor via empanelApprovedVendor
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValueOnce(null);
      const freshEmpaneled = await vendorIngestionService.empanelApprovedVendor(
        {
          email: secondBuyer.corporateEmail,
          organizationId: secondBuyer.organizationId,
          organizationName: secondBuyer.organizationName,
        },
        'sess-2',
        {
          id: 'map-2',
          vendorRecordId: 'vmr-2',
          companyName: 'Fresh Foundry Pvt Ltd',
          email: 'fresh@foundry.in',
          buyerMajorCategory: 'Foundry',
          buyerMinorCategories: [],
          aiSuggestion: { majorCategory: 'Foundry', minorCategories: ['Castings'] },
        }
      );
      expect(freshEmpaneled.addedByBuyerCompany).toBe('Ingest Buyer Two');
    });

    it('exercises storeService upload helper edge cases, DB error fallbacks, and sparse merging', async () => {
      const account = storeService.addBuyerAccount({
        id: 'buyer-edge-s1',
        organizationId: 'org-edge-s1',
        organizationName: 'Edge Store Co',
        contactPerson: 'Nikhil Shah',
        corporateEmail: 'nikhil@edgestore.com',
        mobileNumber: '9811100001',
        city: 'Ahmedabad',
        state: 'Gujarat',
        gstin: '24AAAAA0000A1Z5',
        sourcingMode: 'mode_1',
        status: 'ACTIVE_VERIFIED',
      });

      // Invalid/empty guards
      expect(await storeService.recordBuyerVendorUpload(account, null)).toBeNull();
      expect(await storeService.recordBuyerVendorUpload({}, { id: 'v-no-buyer' })).toBeNull();
      expect(await storeService.linkBuyerToExistingVendor(null, account)).toBeNull();
      expect(await storeService.linkBuyerToExistingVendor({ id: 'v-empty-buyer' }, {})).toBeNull();

      // String buyer lookup, non-array buyerVendorUploads reset, and upsert overwrite/merge
      storeService.buyerVendorUploads = null;
      const vObj = {
        id: 'v-edge-s1',
        name: 'Edge Valve Supply',
        email: 'sales@edgevalves.in',
        buyerIds: ['buyer-edge-s1', ''],
        source: 'buyer_uploaded',
        createdAt: '2026-10-05T00:00:00.000Z',
      };
      storeService.vendors.unshift(vObj);

      const firstEntry = await storeService.recordBuyerVendorUpload('nikhil@edgestore.com', vObj);
      expect(firstEntry.buyerId).toBe(account.id);
      await storeService.recordBuyerVendorUpload({ organizationName: 'Edge Store Co' }, vObj);

      const updatedEntry = await storeService.recordBuyerVendorUpload(
        { id: account.id, organizationName: '', corporateEmail: '' },
        { id: 'v-edge-s1', email: 'sales@edgevalves.in' }
      );
      expect(updatedEntry.buyerCompany).toBe('Edge Store Co');
      await storeService.recordBuyerVendorUpload({ id: 'b-no-mail' }, { id: 'v-no-mail' });

      // linkBuyerToExistingVendor with DB error fallback (Error & plain string) and unchanged mappedBuyerIds
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'recordBuyerVendorUploadInDB').mockResolvedValue({});
      jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValueOnce(new Error('DB err obj'));
      await storeService.linkBuyerToExistingVendor(vObj, { id: 'b-err-obj' });
      jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValueOnce('string-upsert-err');
      await storeService.linkBuyerToExistingVendor(vObj, 'org-edge-s1');
      await storeService.linkBuyerToExistingVendor(vObj, 'org-edge-s1'); // already mapped -> skip upsert

      // getUploadedVendorsForBuyer merging dbItems (including sparse/null/email-only) + buyerIds + buyerEmail match
      jest.spyOn(domainQueries, 'getUploadedVendorsByBuyerFromDB').mockResolvedValueOnce([
        null,
        { vendorId: 'v-edge-s1', vendorName: '', email: 'sales@edgevalves.in', status: 'ACTIVE' },
        { vendorId: '', email: 'emailonly@edgevalves.in', vendorName: 'Email Only' },
        { vendorId: '', email: '' },
      ]);
      const buyerVendors = await storeService.getUploadedVendorsForBuyer('nikhil@edgestore.com');
      expect(buyerVendors.length).toBeGreaterThanOrEqual(2);

      // getBuyerUploadsForVendor missing vendor vs DB payload hydrated/unmatched + email/company canonical keys
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(null);
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValueOnce(null);
      jest.spyOn(domainQueries, 'getBuyerUploadsByVendorFromDB').mockResolvedValueOnce(null);
      expect(await storeService.getBuyerUploadsForVendor('missing-vendor-s1')).toBeNull();

      jest.spyOn(domainQueries, 'getBuyerUploadsByVendorFromDB').mockResolvedValueOnce({
        vendorId: 'v-edge-s1',
        buyerUploads: [
          null,
          { buyerId: 'buyer-edge-s1', buyerName: '', companyName: '' }, // matched & enriched
          { buyerId: '', organizationId: '', corporateEmail: 'dbonly@buyer.in', companyName: '' },
          { buyerId: '', organizationId: '', corporateEmail: '', companyName: 'Company Canonical Co' },
          { buyerId: '', organizationId: '', corporateEmail: '', companyName: '' },
        ],
      });
      storeService.buyerVendorUploads.push({
        id: 'bvu-email-match',
        buyerId: 'ext-unmatched-buyer',
        vendorId: 'other-id',
        vendorEmail: 'sales@edgevalves.in',
        buyerCompany: 'External Buyer Ltd',
        buyerEmail: 'ext@external.in',
        uploadedAt: '2026-10-10T00:00:00.000Z',
      });
      const vendorBuyers = await storeService.getBuyerUploadsForVendor('v-edge-s1', {
        ...vObj,
        buyerIds: ['', 'buyer-edge-s1', 'unmatched-mapped-id'],
      });
      expect(vendorBuyers.totalBuyers).toBeGreaterThanOrEqual(4);
    });
  });

  describe('API endpoints E2E (/api/buyer-accounts/:id/uploaded-vendors & /api/vendors/:id/buyer-uploads)', () => {
    it('enforces authentication, authorization, validation, 404, search filtering, and returns accurate DB records', async () => {
      const app = createTestApp();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const buyerA = storeService.addBuyerAccount({
        id: 'buyer-api-a',
        organizationName: 'API Buyer A',
        contactPerson: 'Asha Menon',
        corporateEmail: 'asha@apibuyera.com',
        status: 'ACTIVE_VERIFIED',
      });
      const buyerB = storeService.addBuyerAccount({
        id: 'buyer-api-b',
        organizationName: 'API Buyer B',
        contactPerson: 'Devendra Singh',
        corporateEmail: 'dev@apibuyerb.com',
        status: 'ACTIVE_VERIFIED',
      });
      const vendor = await storeService.addVendorDurably({
        name: 'Kaveri Valves Pvt Ltd',
        email: 'sales@kaverivalves.in',
        contactPerson: 'Karthik R',
        phone: '+91 9845011223',
        majorCategory: 'Industrial Valves',
        buyerId: buyerA.id,
        buyerAccountId: buyerA.id,
        buyerEmail: buyerA.corporateEmail,
        addedByBuyerCompany: buyerA.organizationName,
        source: 'buyer_uploaded',
      });
      await storeService.linkBuyerToExistingVendor(vendor, buyerB, { uploadSource: 'vendor_master_ingestion' });

      const adminToken = authService.generateSessionToken({
        id: 'u-cm',
        email: 'cm@procucev.com',
        name: 'Category Manager',
        role: 'category_manager',
        orgId: 'org-cm',
      });
      const buyerAToken = authService.generateSessionToken({
        id: buyerA.id,
        email: buyerA.corporateEmail,
        name: buyerA.contactPerson,
        role: 'buyer',
        orgId: buyerA.id,
      });
      const vendorToken = authService.generateSessionToken({
        id: vendor.id,
        email: vendor.email,
        name: vendor.name,
        role: 'vendor',
        orgId: vendor.id,
      });

      // 401 Unauthenticated
      await request(app).get(`/api/buyer-accounts/${buyerA.id}/uploaded-vendors`).expect(401);
      await request(app).get(`/api/vendors/${vendor.id}/buyer-uploads`).expect(401);

      // 403 Forbidden cross-role / cross-tenant
      await request(app)
        .get(`/api/buyer-accounts/${buyerB.id}/uploaded-vendors`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .expect(403);
      await request(app)
        .get(`/api/vendors/${vendor.id}/buyer-uploads`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .expect(403);

      // 400 Query validation
      await request(app)
        .get(`/api/buyer-accounts/${buyerA.id}/uploaded-vendors?limit=0`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      await request(app)
        .get(`/api/vendors/${vendor.id}/buyer-uploads?limit=0`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      // 404 Not found
      jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({ found: false });
      await request(app)
        .get('/api/buyer-accounts/non-existent-buyer/uploaded-vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
      await request(app)
        .get('/api/vendors/non-existent-vendor/buyer-uploads')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      // 200 Happy path: Buyer Uploaded Vendors (both Category Manager & Buyer A)
      const buyerVendorsRes = await request(app)
        .get(`/api/buyer-accounts/${buyerA.id}/uploaded-vendors`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .expect(200);
      expect(buyerVendorsRes.body.success).toBe(true);
      expect(buyerVendorsRes.body.totalVendors).toBe(1);
      expect(buyerVendorsRes.body.vendors[0]).toEqual(
        expect.objectContaining({
          vendorId: vendor.id,
          vendorName: 'Kaveri Valves Pvt Ltd',
          contactPerson: 'Karthik R',
          email: 'sales@kaverivalves.in',
        })
      );

      // Search filtering on Buyer Uploaded Vendors
      const filteredRes = await request(app)
        .get(`/api/buyer-accounts/${buyerA.id}/uploaded-vendors?search=NOMATCH`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(filteredRes.body.totalVendors).toBe(0);
      expect(filteredRes.body.vendors).toEqual([]);

      // 200 Happy path: Seller Buyer Uploads (both Category Manager & owning Vendor)
      const sellerUploadsRes = await request(app)
        .get(`/api/vendors/${vendor.id}/buyer-uploads`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .expect(200);
      expect(sellerUploadsRes.body.success).toBe(true);
      expect(sellerUploadsRes.body.vendorId).toBe(vendor.id);
      expect(sellerUploadsRes.body.totalBuyers).toBe(2);
      expect(sellerUploadsRes.body.buyerUploads.map((b) => b.buyerName)).toEqual(
        expect.arrayContaining(['Asha Menon', 'Devendra Singh'])
      );

      // Error forwarding coverage for both new endpoints
      jest.spyOn(storeService, 'getUploadedVendorsForBuyer').mockRejectedValueOnce(new Error('Store read boom'));
      await request(app)
        .get(`/api/buyer-accounts/${buyerA.id}/uploaded-vendors`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);

      jest.spyOn(storeService, 'getBuyerUploadsForVendor').mockRejectedValueOnce(new Error('Vendor upload boom'));
      await request(app)
        .get(`/api/vendors/${vendor.id}/buyer-uploads`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);
    });
  });
});
