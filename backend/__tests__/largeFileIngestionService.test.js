// ==============================================================================
// LARGE FILE INGESTION SERVICE & JOBS TEST SUITE
// ==============================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const largeFileIngestionService = require('../src/services/largeFileIngestionService');
const queries = require('../src/db/vendorIngestionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const { VENDOR_INGESTION_SESSION_STATUS, VENDOR_INGESTION_STEP } = require('../src/config/constants');

describe('largeFileIngestionService unit tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveOrganizationId', () => {
    it('returns organizationId if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ organizationId: 'org-direct' });
      expect(orgId).toBe('org-direct');
    });

    it('returns organization_id if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ organization_id: 'org-snake' });
      expect(orgId).toBe('org-snake');
    });

    it('returns orgId if present directly on sessionUser', async () => {
      const orgId = await largeFileIngestionService.resolveOrganizationId({ orgId: 'org-short' });
      expect(orgId).toBe('org-short');
    });

    it('looks up profile by user.sub when present', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValueOnce({
        found: true,
        profile: { organizationId: 'org-from-sub' },
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ sub: 'usr-123' });
      expect(orgId).toBe('org-from-sub');
    });

    it('looks up profile by userId or id when present', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValueOnce({
        found: true,
        profile: { organizationId: 'org-from-userid' },
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ userId: 'usr-456' });
      expect(orgId).toBe('org-from-userid');
    });

    it('handles error in buyerProfileQueries gracefully and falls back to sessionId', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockRejectedValueOnce(new Error('DB connection failed'));
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce({
        id: 'sess-1',
        organizationId: 'org-from-session',
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId({ sub: 'usr-err' }, 'sess-1');
      expect(orgId).toBe('org-from-session');
    });

    it('falls back to sessionId lookup if user has no org and no sub', async () => {
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce({
        id: 'sess-2',
        organizationId: 'org-session-only',
      });
      const orgId = await largeFileIngestionService.resolveOrganizationId(null, 'sess-2');
      expect(orgId).toBe('org-session-only');
    });

    it('returns null if no organizationId can be found', async () => {
      jest.spyOn(queries, 'findSessionById').mockRejectedValueOnce(new Error('not found'));
      const orgId = await largeFileIngestionService.resolveOrganizationId(null, 'sess-invalid');
      expect(orgId).toBeNull();
    });
  });

  describe('parseCsvLine', () => {
    it('splits simple comma-separated values', () => {
      const line = 'VND-1001,Apex Supplies Ltd.,Rajesh Nair,rajesh@apex.com';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual(['VND-1001', 'Apex Supplies Ltd.', 'Rajesh Nair', 'rajesh@apex.com']);
    });

    it('respects quoted fields containing commas and double quotes', () => {
      const line = 'VND-1002,"Kiran ""Valves"", Inc.",Amit Kumar,"Bhosari, Pune, MH",27AAACK3921P1Z9';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual([
        'VND-1002',
        'Kiran "Valves", Inc.',
        'Amit Kumar',
        'Bhosari, Pune, MH',
        '27AAACK3921P1Z9',
      ]);
    });

    it('handles tab-separated lines', () => {
      const line = 'PO-001\t2025-01-10\tApex Supplies\tPump 500 GPM\t10\t15000';
      const result = largeFileIngestionService.parseCsvLine(line, '\t');
      expect(result).toEqual(['PO-001', '2025-01-10', 'Apex Supplies', 'Pump 500 GPM', '10', '15000']);
    });
  });

  describe('extractHeaderIndices and mapRowValues', () => {
    it('extracts vendor master header mapping and maps row values with defaults', () => {
      const headers = ['Supplier Code', 'Company Name', 'Contact Person Name', 'Corporate Email', 'Phone', 'Address', 'GSTIN', 'Rating'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'VENDOR_MASTER');
      expect(headerMap.companyName).toBe(1);
      expect(headerMap.vendorCode).toBe(0);

      const rowValues = ['V-99', 'Atlas Tech Ltd', 'Suresh Patel', 'suresh@atlas.com', '+91 99000 11223', 'Mumbai', '27ABCDE1234F1Z5', '88'];
      const mapped = largeFileIngestionService.mapRowValues(rowValues, headerMap, 'VENDOR_MASTER', 0);
      expect(mapped.companyName).toBe('Atlas Tech Ltd');
      expect(mapped.vendorCode).toBe('V-99');
      expect(mapped.contactPerson).toBe('Suresh Patel');
      expect(mapped.email).toBe('suresh@atlas.com');
      expect(mapped.rating).toBe(88);
    });

    it('generates fallback values for vendor master rows when fields are empty', () => {
      const headerMap = largeFileIngestionService.extractHeaderIndices([], 'VENDOR_MASTER');
      const mapped = largeFileIngestionService.mapRowValues([], headerMap, 'VENDOR_MASTER', 2);
      expect(mapped.vendorCode).toBe('VND-1003');
      expect(mapped.companyName).toBe('Supplier 3');
      expect(mapped.contactPerson).toBe('Operations Lead');
      expect(mapped.rating).toBeNull();
    });

    it('extracts po dump header mapping and maps row values with unit price calculation', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Line Item Description', 'Specs', 'Quantity', 'Unit', 'Unit Price', 'Total Spend', 'Department'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');
      expect(headerMap.poNumber).toBe(0);
      expect(headerMap.vendorIdentifier).toBe(2);

      const rowValues = ['PO-991', '2025-05-10', 'VND-200', 'Industrial Flange', 'ANSI 150', '20', 'Pcs', '450', '9000', 'Piping'];
      const mapped = largeFileIngestionService.mapRowValues(rowValues, headerMap, 'PO_DUMP', 0);
      expect(mapped.poNumber).toBe('PO-991');
      expect(mapped.vendorName).toBe('VND-200');
      expect(mapped.vendorCode).toBe('VND-200');
      expect(mapped.itemDescription).toBe('Industrial Flange');
      expect(mapped.quantity).toBe(20);
      expect(mapped.spend).toBe(9000);
      expect(mapped.department).toBe('Piping');
    });

    it('calculates spend from unit price when spend is 0, and default spend when both are 0', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Item Description', 'Quantity', 'Unit Price', 'Total Spend'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');

      // Spend from unit price
      const mapped1 = largeFileIngestionService.mapRowValues(['PO-1', '2025-01-01', 'Supplier A', 'Bolts', '5', '100', '0'], headerMap, 'PO_DUMP', 0);
      expect(mapped1.spend).toBe(500);

      // Default spend
      const mapped2 = largeFileIngestionService.mapRowValues(['PO-2', '2025-01-01', 'Supplier B', 'Nuts', '4', '0', '0'], headerMap, 'PO_DUMP', 1);
      expect(mapped2.spend).toBe(2000); // 4 * 500
    });
  });

  describe('processVendorMasterBatch & processPoDumpBatch direct execution', () => {
    it('processes valid and invalid vendor master batches', async () => {
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValueOnce([{ id: 1 }]);
      const res = await largeFileIngestionService.processVendorMasterBatch('s1', 'o1', [
        { companyName: 'Valid Co' },
        { companyName: '' },
      ]);
      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(1);
    });

    it('handles bulkUpsertVendorMasterRecords failure', async () => {
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockRejectedValueOnce(new Error('DB err'));
      const res = await largeFileIngestionService.processVendorMasterBatch('s1', 'o1', [{ companyName: 'Valid' }]);
      expect(res.imported).toBe(0);
      expect(res.skipped).toBe(1);
    });

    it('processes valid and invalid po dump batches', async () => {
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValueOnce([{ id: 1 }]);
      const res = await largeFileIngestionService.processPoDumpBatch('s1', 'o1', [
        { vendorName: 'Apex', poDate: '2025-01-01' },
        { itemDescription: 'No Vendor' },
      ], { horizonStart: '2025-01-01', horizonEnd: '2025-12-31' });
      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(1);
    });

    it('handles bulkInsertPoLineItems failure', async () => {
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockRejectedValueOnce(new Error('DB err'));
      const res = await largeFileIngestionService.processPoDumpBatch('s1', 'o1', [{ vendorName: 'Apex' }], null);
      expect(res.imported).toBe(0);
      expect(res.skipped).toBe(1);
    });
  });

  describe('Streaming CSV processing & resilience', () => {
    it('successfully streams and processes a Vendor Master CSV file', async () => {
      const tempPath = path.join(os.tmpdir(), `test-vm-${Date.now()}.csv`);
      const csvContent = [
        'Vendor Code,Company Name,Contact Person,Email,Phone,Address,GSTIN,Rating',
        'VND-1,Vendor Alpha,Alice,alice@alpha.com,+91 91111 22222,Mumbai,27AAACA1111A1Z1,90',
        'VND-2,Vendor Beta,Bob,bob@beta.com,+91 92222 33333,Delhi,07AAACB2222B1Z2,80',
        'VND-3,Vendor Gamma,Charlie,charlie@gamma.com,+91 93333 44444,Pune,27AAACG3333C1Z3,85',
        '', // Empty line
      ].join('\n');

      fs.writeFileSync(tempPath, csvContent, 'utf8');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'session-1',
        organizationId: 'org-1',
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValue([{ id: 1 }, { id: 2 }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(3);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});

      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-vm',
          sessionId: 'session-1',
          organizationId: 'org-1',
          filePath: tempPath,
          fileName: 'test-vm.csv',
          jobType: 'VENDOR_MASTER',
          batchSize: 2,
        })
      ).resolves.not.toThrow();

      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('successfully streams and processes a PO Dump CSV file with semicolons and batch boundaries', async () => {
      const tempPath = path.join(os.tmpdir(), `test-po-${Date.now()}.csv`);
      const csvContent = [
        'PO Number;PO Date;Vendor Name;Line Item Description;Specs;Quantity;Unit;Unit Price;Total Spend;Department',
        'PO-101;2025-06-01;Apex Tech;Steel Rod;Grade A;10;Pcs;500;5000;Civil',
        'PO-102;2025-06-02;Apex Tech;Cement;Grade B;20;Bags;300;6000;Civil',
        'PO-103;2025-06-03;Apex Tech;Bricks;Grade C;30;Bags;100;3000;Civil',
      ].join('\n');

      fs.writeFileSync(tempPath, csvContent, 'utf8');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'session-po',
        organizationId: 'org-1',
        horizonStart: '2025-01-01',
        horizonEnd: '2025-12-31',
        status: VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
        currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
      });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValue([{ id: 1 }, { id: 2 }]);
      jest.spyOn(queries, 'countPoLineItems').mockResolvedValue({ total: 3, inHorizon: 3, outsideHorizon: 0 });
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});

      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-po',
          sessionId: 'session-po',
          organizationId: 'org-1',
          filePath: tempPath,
          fileName: 'test-po.csv',
          jobType: 'PO_DUMP',
          batchSize: 2, // Triggers both intermediate batch and remainder batch
        })
      ).resolves.not.toThrow();

      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('handles stream processing when session is not found', async () => {
      const tempPath = path.join(os.tmpdir(), `test-nosess-${Date.now()}.csv`);
      fs.writeFileSync(tempPath, 'header1,header2\nval1,val2', 'utf8');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce(null);
      const updateSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.streamProcessCsvFile({
        jobId: 'test-job-nosess',
        sessionId: 'session-not-found',
        organizationId: 'org-1',
        filePath: tempPath,
        fileName: 'test.csv',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateSpy).toHaveBeenCalledWith(
        'test-job-nosess',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Session not found' })
      );
      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('handles error during stream processing and marks job as FAILED', async () => {
      const tempPath = path.join(os.tmpdir(), `test-err-${Date.now()}.csv`);
      fs.writeFileSync(tempPath, 'header1\nrow1', 'utf8');

      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-1' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockRejectedValueOnce(new Error('Fatal DB crash'));

      await largeFileIngestionService.streamProcessCsvFile({
        jobId: 'test-job-err',
        sessionId: 'sess-1',
        organizationId: 'org-1',
        filePath: tempPath,
        fileName: 'test.csv',
        jobType: 'VENDOR_MASTER',
      });

      expect(fs.existsSync(tempPath)).toBe(false);
    });
  });

  describe('processArrayJob', () => {
    it('processes vendor master array batches and updates progress', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'sess-arr',
        organizationId: 'org-1',
        status: VENDOR_INGESTION_SESSION_STATUS.DRAFT,
        currentStep: VENDOR_INGESTION_STEP.VENDOR_MASTER,
      });
      jest.spyOn(queries, 'bulkUpsertVendorMasterRecords').mockResolvedValueOnce([{ id: 1 }]);
      jest.spyOn(queries, 'countVendorMasterRecords').mockResolvedValue(1);
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-arr-1',
        sessionId: 'sess-arr',
        organizationId: 'org-1',
        rows: [{ companyName: 'Valid Vendor' }, { companyName: '' }], // 1 valid, 1 invalid
        fileName: 'test.xlsx',
        jobType: 'VENDOR_MASTER',
        batchSize: 5,
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-arr-1',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', importedRecords: 1, failedRecords: 1 })
      );
    });

    it('processes po dump array batches and updates progress', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({
        id: 'sess-arr-po',
        organizationId: 'org-1',
        horizonStart: '2025-01-01',
        horizonEnd: '2025-12-31',
        status: VENDOR_INGESTION_SESSION_STATUS.VENDOR_MASTER_STORED,
        currentStep: VENDOR_INGESTION_STEP.PO_DUMP,
      });
      jest.spyOn(queries, 'bulkInsertPoLineItems').mockResolvedValueOnce([{ id: 1 }]);
      jest.spyOn(queries, 'countPoLineItems').mockResolvedValue({ total: 1, inHorizon: 1, outsideHorizon: 0 });
      jest.spyOn(queries, 'updateSession').mockResolvedValue({});
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-arr-po',
        sessionId: 'sess-arr-po',
        organizationId: 'org-1',
        rows: [{ vendorName: 'Apex', poDate: '2025-06-01' }, { itemDescription: 'No vendor' }], // 1 valid, 1 invalid
        fileName: 'po.xlsx',
        jobType: 'PO_DUMP',
        batchSize: 5,
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-arr-po',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', importedRecords: 1, failedRecords: 1 })
      );
    });

    it('handles empty rows array gracefully', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-empty' });
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-empty',
        sessionId: 'sess-empty',
        organizationId: 'org-1',
        rows: [],
        fileName: 'empty.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-empty',
        'org-1',
        expect.objectContaining({ status: 'COMPLETED', totalRecords: 0 })
      );
    });

    it('handles missing session for array job', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce(null);
      const updateProgressSpy = jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-nosess',
        sessionId: 'sess-none',
        organizationId: 'org-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'v.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      expect(updateProgressSpy).toHaveBeenCalledWith(
        'job-nosess',
        'org-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Session not found' })
      );
    });

    it('handles unexpected failure during array job and marks job as FAILED', async () => {
      jest.spyOn(queries, 'findSession').mockResolvedValueOnce({ id: 'sess-fail' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockRejectedValueOnce(new Error('DB failure'));

      await largeFileIngestionService.processArrayJob({
        jobId: 'job-fail',
        sessionId: 'sess-fail',
        organizationId: 'org-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'v.xlsx',
        jobType: 'VENDOR_MASTER',
      });
    });
  });

  describe('startIngestionJob & getJobStatus', () => {
    it('throws error when organization cannot be resolved', async () => {
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce(null);
      await expect(
        largeFileIngestionService.startIngestionJob({
          sessionUser: null,
          sessionId: 'invalid',
          rows: [],
          jobType: 'VENDOR_MASTER',
        })
      ).rejects.toThrow('Organization not linked to user');
    });

    it('creates job and launches background filePath worker and array worker', async () => {
      jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({
        id: 'job-file-1',
        status: 'PROCESSING',
      });
      jest.spyOn(queries, 'findSession').mockResolvedValue({ id: 'sess-1' });
      jest.spyOn(queries, 'updateIngestionJobProgress').mockResolvedValue({});

      const job1 = await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        filePath: 'path/to/file.csv',
        fileName: 'file.csv',
        jobType: 'VENDOR_MASTER',
        totalHint: 100,
      });
      expect(job1.id).toBe('job-file-1');

      const job2 = await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        rows: [{ companyName: 'Vendor 1' }],
        fileName: 'vendors.xlsx',
        jobType: 'VENDOR_MASTER',
      });
      expect(job2.id).toBe('job-file-1');

      // Wait a tick for setImmediate
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('logs error when background workers reject inside setImmediate', async () => {
      jest.spyOn(queries, 'createIngestionJob').mockResolvedValue({
        id: 'job-fail-bg',
        status: 'PROCESSING',
      });
      jest.spyOn(queries, 'findSession').mockRejectedValue(new Error('Fatal bg stream failure'));

      await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        filePath: 'path/to/nonexistent.csv',
        fileName: 'bad.csv',
        jobType: 'VENDOR_MASTER',
      });

      await largeFileIngestionService.startIngestionJob({
        sessionUser: { organizationId: 'org-1' },
        sessionId: 'sess-1',
        rows: [{ companyName: 'Vendor' }],
        fileName: 'bad.xlsx',
        jobType: 'VENDOR_MASTER',
      });

      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    it('retrieves job status by jobId, jobType, active jobs, or fallback', async () => {
      const mockFindJob = jest.spyOn(queries, 'findIngestionJob').mockResolvedValue({ id: 'by-id' });
      const mockFindLatest = jest.spyOn(queries, 'findLatestIngestionJob').mockResolvedValue({ id: 'by-type' });
      const mockFindActive = jest.spyOn(queries, 'findActiveIngestionJobs').mockResolvedValueOnce([{ id: 'active-1' }])
        .mockResolvedValueOnce([]); // Empty active jobs to trigger fallback

      // By jobId
      const job1 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1', 'job-123');
      expect(job1.id).toBe('by-id');

      // By jobType
      const job2 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1', null, 'VENDOR_MASTER');
      expect(job2.id).toBe('by-type');

      // Active jobs list
      const job3 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1');
      expect(job3.id).toBe('active-1');

      // Fallback when no active jobs
      const job4 = await largeFileIngestionService.getJobStatus({ organizationId: 'org-1' }, 'sess-1');
      expect(job4.id).toBe('by-type');

      // Unauthenticated / unresolvable returns null
      jest.spyOn(queries, 'findSessionById').mockResolvedValueOnce(null);
      const jobNull = await largeFileIngestionService.getJobStatus(null, 'bad-sess');
      expect(jobNull).toBeNull();
    });
  });
});
