// VENDOR MASTER UPLOAD FLAG TEST SUITE
// ==============================================================================
// The organization's first successful vendor master upload ends the buyer initial
// setup popup at sign-in. These tests cover the write (the query, the upload
// service and both job finalization paths), the sign-in read (the identity row
// mapping, the sign-in query and the buyer-only field on the public user), and the
// cache invalidation that stops a quick re-sign-in from reading a stale value.

const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const dbPool = require('../src/db/pool');
const { queryCache } = require('../src/db/queryCache');
const queries = require('../src/db/vendorIngestionQueries');
const identityQueries = require('../src/db/identityQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const largeFileIngestionService = require('../src/services/largeFileIngestionService');
const vendorIngestionService = require('../src/services/vendorIngestionService');
const authService = require('../src/services/authService');
const storeService = require('../src/services/storeService');
const vendorPresenceService = require('../src/services/vendorPresenceService');
const r2Client = require('../src/services/r2Client');
const { logger } = require('../src/services/loggerService');
const {
  VENDOR_INGESTION_CONFIG,
  VENDOR_INGESTION_SESSION_STATUS,
  VENDOR_INGESTION_STEP,
} = require('../src/config/constants');

const ORG_ID = 'org-flag-1';
const SESSION_ID = 'sess-flag-1';
const USER_ID = 'usr-flag-1';
const FLAG_UNSET_SQL = 'vendor_master_uploaded_at is null';
const FIRST_UPLOAD_LOG = 'Organization vendor master upload recorded for the first time';

const SESSION_USER = { sub: USER_ID, email: 'buyer@flag.test', orgName: 'Flag Buyer Ltd' };
const VALID_ROW = { vendorCode: 'VND-9001', companyName: 'Apex Supplies', email: 'sales@apex.com', gstin: '27AAAAA0000A1Z5' };
const INVALID_ROW = { vendorCode: 'VND-9002', companyName: 'X', email: 'not-an-email' };

/**
 * Stands in for r2Client.getClient() the same way largeFileIngestionService.test.js does, so the
 * stream path can read a CSV without touching Cloudflare.
 */
function mockR2Client(content) {
  const send = jest.fn(async (command) => {
    if (command instanceof GetObjectCommand) {
      return { Body: [Buffer.from(content, 'utf8')] };
    }
    if (command instanceof PutObjectCommand || command instanceof DeleteObjectCommand) {
      return {};
    }
    throw new Error('Unexpected R2 command in test');
  });
  jest.spyOn(r2Client, 'getClient').mockReturnValue({ send });
  jest.spyOn(r2Client, 'bucket').mockReturnValue('test-bucket');
  return send;
}

/** Stub every dependency of confirmVendorMaster for a buyer whose organization is known. */
function mockBuyerUploadDependencies({ totalStored = 1, firstUpload = true } = {}) {
  jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
    found: true,
    profile: { userId: USER_ID, organizationId: ORG_ID, contactEmail: SESSION_USER.email, companyName: SESSION_USER.orgName },
  });
  jest.spyOn(queries, 'findSession').mockResolvedValue({
    id: SESSION_ID,
    organizationId: ORG_ID,
    status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
    currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
    vendorMasterFileName: null,
  });
  jest.spyOn(queries, 'deleteVendorMasterRecords').mockResolvedValue(0);
  jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValue([{ id: 'vmr-1' }]);
  jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(totalStored);
  jest.spyOn(queries, 'updateSession').mockResolvedValue({ id: SESSION_ID });
  jest.spyOn(queries, 'insertAuditEntry').mockResolvedValue({});
  jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
  return jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(firstUpload);
}

/** Stub sign-in so authenticateWithPassword resolves the given identity row. */
function mockPasswordSignIn(user) {
  jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(user);
  jest.spyOn(identityQueries, 'verifyStoredPassword').mockReturnValue(true);
  jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
  jest.spyOn(vendorPresenceService, 'recordHeartbeat').mockImplementation(() => {});
}

const SIGN_IN_BUYER = {
  id: USER_ID,
  email: 'buyer@flag.test',
  name: 'Flag Buyer',
  role: 'buyer',
  orgId: ORG_ID,
  orgName: 'Flag Buyer Ltd',
  mobile: '+919876543210',
  password: 'stored-password',
  isActive: true,
  isApproved: true,
  isSelfClient: false,
  resetPasswordRequired: false,
  verificationStatus: 'verified',
};

describe('vendor master upload flag', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    queryCache.clear();
  });

  describe('markVendorMasterUploaded (write query)', () => {
    it('writes nothing and reports false without database storage', async () => {
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(false);
      const querySpy = jest.spyOn(dbPool, 'query');

      await expect(queries.markVendorMasterUploaded(ORG_ID)).resolves.toBe(false);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('writes the timestamp only while it is unset, then clears the cached sign-in rows', async () => {
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      const invalidateSpy = jest.spyOn(queryCache, 'invalidate');
      const uploadedAt = '2026-11-14T03:00:00.000Z';

      await expect(queries.markVendorMasterUploaded(ORG_ID, uploadedAt)).resolves.toBe(true);

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain('update organization');
      expect(sql).toContain('set vendor_master_uploaded_at = $1');
      expect(sql).toContain(FLAG_UNSET_SQL);
      expect(params).toEqual([uploadedAt, ORG_ID]);
      expect(options).toEqual({ d1: true });
      expect(invalidateSpy).toHaveBeenCalledWith('user');
    });

    it('reports false when the organization already holds a timestamp', async () => {
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 0 });

      await expect(queries.markVendorMasterUploaded(ORG_ID)).resolves.toBe(false);
    });

    it('stamps the current time when no timestamp is passed', async () => {
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });
      const before = Date.now();

      await queries.markVendorMasterUploaded(ORG_ID);

      const stamped = Date.parse(querySpy.mock.calls[0][1][0]);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    });

    it('skips the write when no organization id is given', async () => {
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(dbPool, 'query');

      await expect(queries.markVendorMasterUploaded('')).resolves.toBe(false);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('drops a cached sign-in row so the next sign-in reads the new value', async () => {
      const cacheKey = 'select sign-in row for the flag test::[]';
      queryCache.set(cacheKey, [], [{ vendorMasterUploaded: false }], { tag: 'user', ttlMs: 60000 });
      expect(queryCache.get(cacheKey, [])).not.toBeNull();
      jest.spyOn(dbPool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(dbPool, 'query').mockResolvedValue({ rowCount: 1 });

      await queries.markVendorMasterUploaded(ORG_ID);

      expect(queryCache.get(cacheKey, [])).toBeNull();
    });
  });

  describe('confirmVendorMaster (small upload path)', () => {
    it('stamps the organization on its first successful upload and logs that once', async () => {
      const markSpy = mockBuyerUploadDependencies({ totalStored: 1, firstUpload: true });
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

      await vendorIngestionService.confirmVendorMaster(SESSION_USER, SESSION_ID, {
        rows: [VALID_ROW],
        fileName: 'vendors.csv',
        replaceExisting: false,
      });

      expect(markSpy).toHaveBeenCalledWith(ORG_ID);
      expect(infoSpy).toHaveBeenCalledWith(
        FIRST_UPLOAD_LOG,
        expect.objectContaining({ sessionId: SESSION_ID, organizationId: ORG_ID, totalStored: 1 }),
        expect.any(String)
      );
    });

    it('does not log again when the organization was already stamped', async () => {
      const markSpy = mockBuyerUploadDependencies({ totalStored: 1, firstUpload: false });
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

      await vendorIngestionService.confirmVendorMaster(SESSION_USER, SESSION_ID, {
        rows: [VALID_ROW],
        fileName: 'vendors.csv',
        replaceExisting: false,
      });

      expect(markSpy).toHaveBeenCalledWith(ORG_ID);
      expect(infoSpy).not.toHaveBeenCalledWith(FIRST_UPLOAD_LOG, expect.anything(), expect.anything());
    });

    it('does not stamp the organization when every row is rejected with a 422', async () => {
      const markSpy = mockBuyerUploadDependencies();

      await expect(
        vendorIngestionService.confirmVendorMaster(SESSION_USER, SESSION_ID, {
          rows: [INVALID_ROW],
          fileName: 'bad.csv',
          replaceExisting: false,
        })
      ).rejects.toMatchObject({ status: 422 });
      expect(markSpy).not.toHaveBeenCalled();
    });

    it('does not stamp the organization when the stored total is over the limit (413)', async () => {
      const markSpy = mockBuyerUploadDependencies({
        totalStored: VENDOR_INGESTION_CONFIG.MAX_VENDOR_MASTER_ROWS + 1,
      });

      await expect(
        vendorIngestionService.confirmVendorMaster(SESSION_USER, SESSION_ID, {
          rows: [VALID_ROW],
          fileName: 'huge.csv',
          replaceExisting: false,
        })
      ).rejects.toMatchObject({ status: 413 });
      expect(markSpy).not.toHaveBeenCalled();
    });

    it('does not stamp the organization when no vendor master rows are left stored', async () => {
      const markSpy = mockBuyerUploadDependencies({ totalStored: 0 });

      await vendorIngestionService.confirmVendorMaster(SESSION_USER, SESSION_ID, {
        rows: [VALID_ROW],
        fileName: 'vendors.csv',
        replaceExisting: false,
      });

      expect(markSpy).not.toHaveBeenCalled();
    });
  });

  describe('vendor master job finalization', () => {
    it('stamps the organization when an array VENDOR_MASTER job stores rows', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValueOnce([{ id: 'vmr-1' }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(1);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      const markSpy = jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(true);

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-flag-arr',
        sessionId: SESSION_ID,
        organizationId: ORG_ID,
        rows: [{ companyName: 'Valid Vendor' }],
        fileName: 'vendors.xlsx',
        jobType: 'VENDOR_MASTER',
        batchSize: 5,
      });

      expect(markSpy).toHaveBeenCalledWith(ORG_ID);
    });

    it('stamps the organization when a CSV VENDOR_MASTER stream stores rows', async () => {
      const csvContent = [
        'Vendor Code,Company Name,Contact Person,Email,Phone,Address,GSTIN,Rating',
        'VND-7,Flag Vendor,Dana,dana@flagvendor.com,+91 98000 11122,Pune,27AAACA1111A1Z1,75',
      ].join('\n');
      mockR2Client(csvContent);
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValue([{ id: 'vmr-7' }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(1);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      const markSpy = jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(true);

      await largeFileIngestionService.streamProcessCsvFile({
        jobId: 'job-flag-csv',
        sessionId: SESSION_ID,
        organizationId: ORG_ID,
        r2Key: 'uploads/vendor-ingestion/flag-vm.csv',
        fileName: 'flag-vm.csv',
        jobType: 'VENDOR_MASTER',
        batchSize: 2,
      });

      expect(markSpy).toHaveBeenCalledWith(ORG_ID);
    });

    it('does not stamp the organization when an array VENDOR_MASTER job stores nothing', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(0);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      const markSpy = jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(true);

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-flag-empty',
        sessionId: SESSION_ID,
        organizationId: ORG_ID,
        rows: [],
        fileName: 'empty.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      expect(markSpy).not.toHaveBeenCalled();
    });

    it('does not stamp the organization when a PO dump job finalizes', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
        currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
      });
      jest.spyOn(queries, 'countPoLineItems').mockResolvedValue({ total: 0, inHorizon: 0, outsideHorizon: 0 });
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      const markSpy = jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(true);

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-flag-po',
        sessionId: SESSION_ID,
        organizationId: ORG_ID,
        rows: [],
        fileName: 'po.xlsx',
        jobType: 'PO_DUMP',
      });

      expect(markSpy).not.toHaveBeenCalled();
    });

    it('does not stamp the organization when the job is cancelled before it finalizes', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: SESSION_ID,
        organizationId: ORG_ID,
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      const markSpy = jest.spyOn(queries, 'markVendorMasterUploaded').mockResolvedValue(true);
      largeFileIngestionService.activeCancellations.add('job-flag-cancel');

      try {
        await largeFileIngestionService.processArrayJob({
          jobId: 'job-flag-cancel',
          sessionId: SESSION_ID,
          organizationId: ORG_ID,
          rows: [{ companyName: 'Valid Vendor' }],
          fileName: 'vendors.xlsx',
          jobType: 'VENDOR_MASTER',
          batchSize: 5,
        });
      } finally {
        largeFileIngestionService.activeCancellations.delete('job-flag-cancel');
      }

      expect(markSpy).not.toHaveBeenCalled();
    });
  });

  describe('sign-in read path', () => {
    it('maps a stamped organization to vendorMasterUploaded true', () => {
      const mapped = identityQueries.mapRowToUser({
        username: 'buyer@flag.test',
        vendor_master_uploaded_at: '2026-11-14T03:00:00.000Z',
      });

      expect(mapped.vendorMasterUploaded).toBe(true);
    });

    it('maps an unstamped or absent organization to vendorMasterUploaded false', () => {
      expect(identityQueries.mapRowToUser({ username: 'a@b.com', vendor_master_uploaded_at: null }).vendorMasterUploaded).toBe(false);
      expect(identityQueries.mapRowToUser({ username: 'a@b.com' }).vendorMasterUploaded).toBe(false);
    });

    it('selects the organization timestamp in the sign-in lookup', async () => {
      const rowsSpy = jest.spyOn(dbPool, 'rows').mockResolvedValue([]);

      await identityQueries.findUserByEmailAndPhone('buyer@flag.test', '9876543210');

      expect(rowsSpy.mock.calls[0][0]).toContain('o.vendor_master_uploaded_at');
    });

    it('returns vendorMasterUploaded true to a buyer whose organization has uploaded', async () => {
      mockPasswordSignIn({ ...SIGN_IN_BUYER, vendorMasterUploaded: true });

      const result = await authService.authenticateWithPassword('buyer@flag.test', 'Pass@123', '127.0.0.1', '9876543210');

      expect(result.user.vendorMasterUploaded).toBe(true);
    });

    it('returns vendorMasterUploaded false to a buyer whose organization has not uploaded', async () => {
      mockPasswordSignIn({ ...SIGN_IN_BUYER, vendorMasterUploaded: false });

      const result = await authService.authenticateWithPassword('buyer@flag.test', 'Pass@123', '127.0.0.1', '9876543210');

      expect(result.user.vendorMasterUploaded).toBe(false);
    });

    it('treats a buyer record without the field as not uploaded', async () => {
      mockPasswordSignIn({ ...SIGN_IN_BUYER });

      const result = await authService.authenticateWithPassword('buyer@flag.test', 'Pass@123', '127.0.0.1', '9876543210');

      expect(result.user.vendorMasterUploaded).toBe(false);
    });

    it('leaves the field off the public user for non-buyer accounts', async () => {
      mockPasswordSignIn({ ...SIGN_IN_BUYER, role: 'vendor', vendorMasterUploaded: true });

      const result = await authService.authenticateWithPassword('buyer@flag.test', 'Pass@123', '127.0.0.1', '9876543210');

      expect(result.user).not.toHaveProperty('vendorMasterUploaded');
    });
  });
});
