// ==============================================================================
// LARGE FILE INGESTION SERVICE & JOBS TEST SUITE
// ==============================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const largeFileIngestionService = require('../src/services/largeFileIngestionService');
const queries = require('../src/db/vendorIngestionQueries');

describe('largeFileIngestionService unit tests', () => {
  describe('parseCsvLine', () => {
    it('splits simple comma-separated values', () => {
      const line = 'VND-1001,Apex Supplies Ltd.,Rajesh Nair,rajesh@apex.com';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual(['VND-1001', 'Apex Supplies Ltd.', 'Rajesh Nair', 'rajesh@apex.com']);
    });

    it('respects quoted fields containing commas', () => {
      const line = 'VND-1002,"Kiran Valves, Inc.",Amit Kumar,"Bhosari, Pune, MH",27AAACK3921P1Z9';
      const result = largeFileIngestionService.parseCsvLine(line);
      expect(result).toEqual([
        'VND-1002',
        'Kiran Valves, Inc.',
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
    it('extracts vendor master header mapping and maps row values', () => {
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

    it('extracts po dump header mapping and maps row values', () => {
      const headers = ['PO Number', 'PO Date', 'Vendor Name', 'Line Item Description', 'Specs', 'Quantity', 'Unit', 'Unit Price', 'Total Spend', 'Department'];
      const headerMap = largeFileIngestionService.extractHeaderIndices(headers, 'PO_DUMP');
      expect(headerMap.poNumber).toBe(0);
      expect(headerMap.vendorIdentifier).toBe(2);

      const rowValues = ['PO-991', '2025-05-10', 'Atlas Tech Ltd', 'Industrial Flange', 'ANSI 150', '20', 'Pcs', '450', '9000', 'Piping'];
      const mapped = largeFileIngestionService.mapRowValues(rowValues, headerMap, 'PO_DUMP', 0);
      expect(mapped.poNumber).toBe('PO-991');
      expect(mapped.vendorName).toBe('Atlas Tech Ltd');
      expect(mapped.itemDescription).toBe('Industrial Flange');
      expect(mapped.quantity).toBe(20);
      expect(mapped.spend).toBe(9000);
      expect(mapped.department).toBe('Piping');
    });
  });

  describe('Streaming CSV processing & resilience', () => {
    it('successfully streams and processes a CSV file without throwing', async () => {
      const tempPath = path.join(os.tmpdir(), `test-ingest-${Date.now()}.csv`);
      const csvContent = [
        'Vendor Code,Company Name,Contact Person,Email,Phone,Address,GSTIN,Rating',
        'VND-1,Vendor Alpha,Alice,alice@alpha.com,+91 91111 22222,Mumbai,27AAACA1111A1Z1,90',
        'VND-2,Vendor Beta,Bob,bob@beta.com,+91 92222 33333,Delhi,07AAACB2222B1Z2,80',
        'VND-3,Vendor Gamma,Charlie,charlie@gamma.com,+91 93333 44444,Pune,27AAACG3333C1Z3,85',
      ].join('\n');

      fs.writeFileSync(tempPath, csvContent, 'utf8');

      // Test streaming function directly
      await expect(
        largeFileIngestionService.streamProcessCsvFile({
          jobId: 'test-job-1',
          sessionId: 'test-session-1',
          organizationId: 'test-org-1',
          filePath: tempPath,
          fileName: 'test.csv',
          jobType: 'VENDOR_MASTER',
          batchSize: 2,
        })
      ).resolves.not.toThrow();

      // File should be deleted after processing
      expect(fs.existsSync(tempPath)).toBe(false);
    });
  });
});
