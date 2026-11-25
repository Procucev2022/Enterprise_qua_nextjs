import * as XLSX from 'xlsx';
import {
  buildPoLineDedupeKey,
  bulkImportVendorRows,
  downloadSkippedDuplicatePosCsv,
  downloadSkippedDuplicatesCsv,
  downloadVendorUploadTemplate,
  extractSkippedDuplicatePosFromJob,
  extractSkippedDuplicatesFromJob,
  isAllowedVendorUploadFile,
  MAX_VENDOR_UPLOAD_FILE_BYTES,
  parseVendorUploadFile,
  partitionDuplicatePoRows,
  partitionDuplicateVendorMasterRows,
  reconcileVendorJobProgress,
  sendBulkVendorInvitations,
} from '@/lib/vendorUploadClient';
import { formatString, UI_STRINGS } from '@/lib/uiStrings';
import type { IngestionJobState } from '@/lib/types';
import { authClient } from '@/lib/authClient';
import type { VendorUploadRow } from '@/lib/types';

// Same MockFileReader technique as initial-setup-modal.test.tsx: jsdom's real
// File/Blob don't expose their bytes to FileReader synchronously in tests, so
// the file's real xlsx buffer is stashed on a __buffer property the mock reads.
class MockFileReader {
  onload: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsArrayBuffer(file: any) {
    if (file.__error) {
      if (this.onerror) this.onerror(new Error('Read error'));
      return;
    }
    if (file.__corrupt) {
      if (this.onload) this.onload(null as any);
      return;
    }
    if (file.__throwString) {
      if (this.onload) {
        this.onload({
          target: {
            get result(): any {
              throw 'Custom raw string exception';
            },
          },
        } as any);
      }
      return;
    }
    const buf = file.__buffer !== undefined ? file.__buffer : new ArrayBuffer(0);
    if (this.onload) this.onload({ target: { result: buf } });
  }
}

function xlsxFile(rows: Record<string, unknown>[], name = 'vendors.xlsx'): any {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const file: any = new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  file.__buffer = buffer;
  return file;
}

describe('vendorUploadClient', () => {
  const originalFileReader = global.FileReader;

  beforeAll(() => {
    (global as any).FileReader = MockFileReader;
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  describe('isAllowedVendorUploadFile', () => {
    test('accepts only .xlsx, case-insensitively', () => {
      expect(isAllowedVendorUploadFile(new File([], 'a.xlsx'))).toBe(true);
      expect(isAllowedVendorUploadFile(new File([], 'A.XLSX'))).toBe(true);
      expect(isAllowedVendorUploadFile(new File([], 'a.xls'))).toBe(false);
      expect(isAllowedVendorUploadFile(new File([], 'a.csv'))).toBe(false);
    });
  });

  describe('parseVendorUploadFile', () => {
    test('parses valid rows using the real Vendor Master column names', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Hydrocare Fluid Power Systems',
          'Person Name': 'Hydrocare',
          'Email Id': 'hydrocare.service@gmail.com',
          'Mobile No': '9243047807',
          GSTIN: '29AAAPL5929R1ZX',
          'Pin Code': '560047',
          City: 'Bengaluru',
          State: 'Karnataka',
          'Cate - 1': 'Hoses, Valves & Fittings',
          Products: 'Hydraulic Pumps, Valves',
        },
      ]);

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows).toHaveLength(1);
      const row = result.data.rows[0];
      expect(row.isValid).toBe(true);
      expect(row.errors).toEqual([]);
      expect(row.vendor).toMatchObject({
        name: 'Hydrocare Fluid Power Systems',
        contactPerson: 'Hydrocare',
        email: 'hydrocare.service@gmail.com',
        phone: '9243047807',
        gstin: '29AAAPL5929R1ZX',
        pincode: '560047',
        city: 'Bengaluru',
        state: 'Karnataka',
        majorCategory: 'Hoses, Valves & Fittings',
      });
    });

    test('reports required-field errors without fabricating a fallback value', async () => {
      // A row where every mapped field is blank is dropped as a blank row entirely
      // (see the blank-row test below) — City carries a value so the row survives
      // into `rows` while still triggering the required-field checks. Email is no
      // longer a required-field error — see the missing-email test below.
      const file = xlsxFile([{ 'Company Name': '', 'Email Id': '', 'Mobile No': '', City: 'Mumbai' }]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.vendor.name).toBe('');
      expect(row.missingEmail).toBe(true);
      expect(row.errors).toEqual(expect.arrayContaining(['Company name is required.', 'Mobile number is required.']));
      expect(row.errors).not.toEqual(expect.arrayContaining(['Email is required.']));
    });

    test('a row with no email is not rejected — it is flagged missingEmail and stays valid', async () => {
      const file = xlsxFile([
        { 'Company Name': 'No Email Co', 'Email Id': '', 'Mobile No': '9876543210' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.missingEmail).toBe(true);
      expect(row.isValid).toBe(true);
      expect(row.errors).toEqual([]);
      expect(row.vendor.email).toBe('');
    });

    test('normalizes the "Phone number" and "Categorys" header aliases', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Alias Co',
          'Email Id': 'alias@example.com',
          'Phone number': '9876543210',
          Categorys: 'Fasteners',
        },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(true);
      expect(row.vendor.phone).toBe('9876543210');
      expect(row.vendor.majorCategory).toBe('Fasteners');
    });

    test('flags an invalid email/phone/GSTIN/pincode format without rejecting the whole row silently', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Bad Data Co',
          'Email Id': 'not-an-email',
          'Mobile No': '12345',
          GSTIN: 'NOTAGSTIN',
          'Pin Code': '0abc',
        },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('valid email'),
          expect.stringContaining('10-digit'),
          expect.stringContaining('GSTIN'),
          expect.stringContaining('PIN code'),
        ])
      );
    });

    test('rejects a row with invalid special character GSTIN like EF#FD', async () => {
      const file = xlsxFile([
        {
          'Company Name': 'Invalid GSTIN Co',
          'Email Id': 'valid@example.com',
          'Mobile No': '9876543210',
          GSTIN: 'EF#FD',
          'Pin Code': '560047',
        },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const row = result.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('GSTIN'),
        ])
      );
    });

    test('counts a fully blank row separately from parsed rows and does not report it as an error', async () => {
      const file = xlsxFile([
        { 'Company Name': 'Real Co', 'Email Id': 'real@example.com', 'Mobile No': '9876543210' },
        { 'Company Name': '', 'Email Id': '', 'Mobile No': '' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.blankRowCount).toBe(1);
    });

    test('flags the second occurrence of a duplicate email within the same file', async () => {
      const file = xlsxFile([
        { 'Company Name': 'First Co', 'Email Id': 'dup@example.com', 'Mobile No': '9876543210' },
        { 'Company Name': 'Second Co', 'Email Id': 'dup@example.com', 'Mobile No': '9876543211' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows[0].isValid).toBe(true);
      expect(result.data.rows[1].isValid).toBe(false);
      expect(result.data.rows[1].errors[0]).toContain('Duplicate email');
    });

    test('flags the second occurrence of a duplicate vendor code within the same file', async () => {
      const file = xlsxFile([
        { 'Vendor Code': 'V-001', 'Company Name': 'First Co', 'Email Id': 'first@example.com', 'Mobile No': '9876543210' },
        { 'Vendor Code': 'V-001', 'Company Name': 'Second Co', 'Email Id': 'second@example.com', 'Mobile No': '9876543211' },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows[0].isValid).toBe(true);
      expect(result.data.rows[1].isValid).toBe(false);
      expect(result.data.rows[1].errors[0]).toContain('Duplicate Vendor Code');
    });

    test('reports non-Error throw as generic parse error', async () => {
      const file: any = new File([], 'throw-string.xlsx');
      file.__throwString = true;
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Could not parse the file');
    });

    test('handles null and undefined cell values gracefully', async () => {
      const file = xlsxFile([
        { 'Company Name': 'Sparse Co', 'Email Id': 'sparse@example.com', 'Mobile No': '9876543210', GSTIN: null, 'Pin Code': undefined },
      ]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rows[0].isValid).toBe(true);
    });

    test('rejects a file with duplicate column headers', async () => {
      // XLSX itself disambiguates two identical header strings by appending
      // "_1", which would defeat this test — two headers that normalize to the
      // same key without being byte-identical ("Email Id" / "EMAIL ID") reach
      // parseVendorUploadFile's own normalized-duplicate check instead.
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['Email Id', 'EMAIL ID', 'Company Name'],
        ['a@b.com', 'x@y.com', 'Acme'],
      ]);
      const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const file: any = new File([buffer], 'dup-headers.xlsx');
      file.__buffer = buffer;

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('duplicate column headers');
    });

    test('rejects a file with none of the expected columns', async () => {
      const file = xlsxFile([{ Foo: 'bar', Baz: 'qux' }]);
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Vendor Master Template');
    });

    test('reports an empty workbook as an error', async () => {
      const worksheet = XLSX.utils.json_to_sheet([]);
      const workbook: XLSX.WorkBook = { Sheets: { Sheet1: worksheet }, SheetNames: ['Sheet1'] };
      const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const file: any = new File([buffer], 'empty.xlsx');
      file.__buffer = buffer;

      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('no readable data rows');
    });

    test('reports a corrupt/unreadable file as an error rather than throwing', async () => {
      const file: any = new File([], 'corrupt.xlsx');
      file.__corrupt = true;
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
    });

    test('reports a disk read failure as an error', async () => {
      const file: any = new File([], 'err.xlsx');
      file.__error = true;
      const result = await parseVendorUploadFile(file);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Failed to read the file');
    });
  });

  describe('downloadVendorUploadTemplate', () => {
    test('triggers a download of an .xlsx file without throwing', () => {
      const clickSpy = jest.fn();
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = jest.fn();
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = clickSpy;

      expect(() => downloadVendorUploadTemplate()).not.toThrow();
      expect(clickSpy).toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });
  });

  describe('bulkImportVendorRows', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      authClient.setSession(null, null);
      jest.restoreAllMocks();
    });

    function makeRow(rowNumber: number, email: string): VendorUploadRow {
      return {
        rowNumber,
        vendor: { name: `Co ${rowNumber}`, email, phone: '9876543210' },
        isValid: true,
        errors: [],
        missingEmail: !email,
      };
    }

    test('sends a real Bearer token and aggregates a single chunk\'s response', async () => {
      authClient.setSession(
        { id: 'u1', email: 'cm@procucev.com', name: 'CM', role: 'category_manager', orgId: 'o1', orgName: 'Org' },
        'fake-token'
      );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessionId: 'bulk-import-1',
            total: 2,
            imported: 2,
            missingEmail: 0,
            duplicates: 0,
            failed: 0,
            onboardingFailed: 0,
            results: [{ rowNumber: 1, status: 'imported' }, { rowNumber: 2, status: 'imported' }],
          },
        }),
      });

      const onProgress = jest.fn();
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com'), makeRow(2, 'b@x.com')], onProgress);

      expect(result).toEqual({
        sessionId: 'bulk-import-1',
        total: 2,
        imported: 2,
        missingEmail: 0,
        duplicates: 0,
        failed: 0,
        onboardingFailed: 0,
        onboardingSkipped: 0,
        results: [{ rowNumber: 1, status: 'imported' }, { rowNumber: 2, status: 'imported' }],
      });
      expect(onProgress).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('/api/vendors/bulk-import');
      expect(options.headers.Authorization).toBe('Bearer fake-token');
      expect(JSON.parse(options.body).vendors).toHaveLength(2);
    });

    test('splits uploads into bounded chunks that the backend can provision synchronously', async () => {
      global.fetch = jest.fn().mockImplementation(async (_url, options) => {
        const sent = JSON.parse(options.body).vendors;
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { total: sent.length, imported: sent.length, missingEmail: 0, duplicates: 0, failed: 0, results: sent.map((v: any) => ({ rowNumber: v.rowNumber, status: 'imported' })) },
          }),
        };
      });

      const rows = Array.from({ length: 2250 }, (_, i) => makeRow(i + 1, `row${i}@example.com`));
      const result = await bulkImportVendorRows(rows);

      expect(global.fetch).toHaveBeenCalledTimes(150); // 15 vendors per request
      expect(result.total).toBe(2250);
      expect(result.imported).toBe(2250);
    });

    test('passes sessionId and totalRowsDeclared in the request body and aggregates missingEmail across chunks', async () => {
      global.fetch = jest.fn().mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        expect(body.totalRowsDeclared).toBe(2);
        expect(body.sessionId).toBeUndefined();
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessionId: 'session-abc',
              total: 2,
              imported: 1,
              missingEmail: 1,
              duplicates: 0,
              failed: 0,
              onboardingSkipped: 1,
              results: [
                { rowNumber: 1, status: 'imported', missingEmail: true },
                { rowNumber: 2, status: 'imported' },
              ],
            },
          }),
        };
      });

      const result = await bulkImportVendorRows([makeRow(1, ''), makeRow(2, 'b@x.com')]);

      expect(result.sessionId).toBe('session-abc');
      expect(result.missingEmail).toBe(1);
      expect(result.onboardingSkipped).toBe(1);
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const sentBody = JSON.parse(options.body);
      expect(sentBody.sessionId).toBeUndefined();
      expect(sentBody.totalRowsDeclared).toBe(2);
    });

    test('a network failure for one chunk is reported as failed rows, not a thrown error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toMatchObject({ rowNumber: 1, status: 'failed' });
    });

    test('a non-ok server response is reported as failed rows with the server error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ success: false, error: 'Only a category manager may bulk-import vendors.' }),
      });
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
      expect(result.results[0].errors).toEqual(['Only a category manager may bulk-import vendors.']);
    });

    test('an unparsable response body still reports a failure rather than throwing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      });
      const result = await bulkImportVendorRows([makeRow(1, 'a@x.com')]);
      expect(result.failed).toBe(1);
    });

    test('an empty row list resolves immediately with all-zero totals', async () => {
      global.fetch = jest.fn();
      const result = await bulkImportVendorRows([]);
      expect(result).toEqual({
        sessionId: undefined,
        total: 0,
        imported: 0,
        missingEmail: 0,
        duplicates: 0,
        failed: 0,
        onboardingFailed: 0,
        onboardingSkipped: 0,
        results: [],
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('sendBulkVendorInvitations', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      authClient.setSession(null, null);
      jest.restoreAllMocks();
    });

    test('uses bounded authenticated chunks and aggregates sent, queued, and failed results', async () => {
      authClient.setSession(
        { id: 'u1', email: 'cm@procucev.com', name: 'CM', role: 'category_manager', orgId: 'o1', orgName: 'Org' },
        'invite-token'
      );
      global.fetch = jest.fn().mockImplementation(async (_url, options) => {
        const vendorIds: string[] = JSON.parse(options.body).vendorIds;
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sentCount: 0,
              queuedCount: 0,
              failedCount: 0,
              results: vendorIds.map((vendorId) => ({
                vendorId,
                status: vendorId === 'v-1' ? 'sent' : vendorId === 'v-16' ? 'failed' : 'queued',
              })),
            },
          }),
        };
      });
      const ids = Array.from({ length: 16 }, (_item, index) => `v-${index + 1}`);
      const onProgress = jest.fn();

      const result = await sendBulkVendorInvitations(ids, onProgress);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ sentCount: 1, queuedCount: 14, failedCount: 1 });
      expect(result.results).toHaveLength(16);
      expect(onProgress).toHaveBeenNthCalledWith(1, 15, 16);
      expect(onProgress).toHaveBeenNthCalledWith(2, 16, 16);
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('/api/vendors/bulk-import/invitations');
      expect(options.headers.Authorization).toBe('Bearer invite-token');
      expect(JSON.parse(options.body).vendorIds).toHaveLength(15);
    });

    test('deduplicates vendor IDs and reports network failures per vendor', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const result = await sendBulkVendorInvitations(['v-1', 'v-1', 'v-2']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ sentCount: 0, queuedCount: 0, failedCount: 2 });
      expect(result.results.map((item) => item.vendorId)).toEqual(['v-1', 'v-2']);
      expect(result.results.every((item) => item.status === 'failed')).toBe(true);
    });

    test('marks missing server results and non-ok responses as failed', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ success: false }),
      });
      const result = await sendBulkVendorInvitations(['v-1']);
      expect(result.failedCount).toBe(1);
      expect(result.results).toEqual([{ vendorId: 'v-1', status: 'failed' }]);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { results: [] } }),
      });
      const incompleteResult = await sendBulkVendorInvitations(['v-2']);
      expect(incompleteResult.results).toEqual([{ vendorId: 'v-2', status: 'failed' }]);
    });

    test('parses Cate-1..5 columns, strips placeholder categories, and enforces requireCategory when requested', async () => {
      const { parseVendorUploadFile } = require('@/lib/vendorUploadClient');
      const XLSX = require('xlsx');
      const makeXlsx = (rows: Record<string, unknown>[]) => {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = { Sheets: { Sheet1: ws }, SheetNames: ['Sheet1'] };
        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const f = new File([buffer], 'cat-check.xlsx');
        (f as File & { __buffer: ArrayBuffer }).__buffer = buffer;
        return f;
      };

      const file = makeXlsx([
        {
          'Company Name': 'Multi Cat Co',
          'Email Id': 'multi@vendor.test',
          'Mobile No': '9876543210',
          Category: 'Vendor Master',
          'Cate-1': 'Valves',
          'Cate-2': 'Pumps',
          'Cate-3': 'None',
        },
        {
          'Company Name': 'No Cat Co',
          'Email Id': 'nocat@vendor.test',
          'Mobile No': '9876543211',
          Category: 'Uncategorized',
        },
      ]);

      const parsedStrict = await parseVendorUploadFile(file, { requireCategory: true });
      expect(parsedStrict.success).toBe(true);
      if (!parsedStrict.success) return;

      expect(parsedStrict.data.rows[0].isValid).toBe(true);
      expect(parsedStrict.data.rows[0].vendor.majorCategory).toBe('Valves');
      expect(parsedStrict.data.rows[0].vendor.minorCategories).toEqual(['Valves', 'Pumps']);

      expect(parsedStrict.data.rows[1].isValid).toBe(false);
      expect(parsedStrict.data.rows[1].errors.some((e: string) => /category/i.test(e))).toBe(true);
    });
  });

  describe('partitionDuplicateVendorMasterRows', () => {
    const vmStrings = UI_STRINGS.vendorPoIngestion.vendorMaster;

    test('detects and skips intra-file duplicates by email, gstin, explicit code, and company+phone while keeping distinct companies sharing a phone', () => {
      const makeRecord = (id: string, overrides: Record<string, string>) => ({
        id,
        vendorCode: overrides.vendorCode || id,
        companyName: overrides.companyName || `Co ${id}`,
        contactPerson: 'Contact',
        email: overrides.email ?? `${id}@example.com`,
        phone: overrides.phone ?? '+91 9811100000',
        address: 'Mumbai',
        gstNumber: overrides.gstNumber ?? '',
      });

      const candidates = [
        { rowNumber: 2, explicitVendorCode: 'V-1', vendor: makeRecord('1', { vendorCode: 'V-1', companyName: 'Alpha', email: 'alpha@co.in', gstNumber: '27AAACA1111A1Z1', phone: '+91 9800011111' }) },
        { rowNumber: 3, explicitVendorCode: '', vendor: makeRecord('2', { vendorCode: '1', companyName: 'Beta', email: 'beta@co.in', gstNumber: 'N/A', phone: '+91 9800011111' }) }, // different company sharing phone, placeholder GSTIN
        { rowNumber: 4, explicitVendorCode: 'V-9', vendor: makeRecord('3', { vendorCode: 'V-9', companyName: 'Alpha Copy', email: 'ALPHA@co.in', gstNumber: '27XXXXX9999X1Z1', phone: '+91 9700000000' }) }, // dup email
        { rowNumber: 5, explicitVendorCode: 'V-10', vendor: makeRecord('4', { vendorCode: 'V-10', companyName: 'Gamma', email: 'gamma@co.in', gstNumber: '27AAACA1111A1Z1', phone: '+91 9600000000' }) }, // dup GSTIN
        { rowNumber: 6, explicitVendorCode: 'V-1', vendor: makeRecord('5', { vendorCode: 'V-1', companyName: 'Delta', email: 'delta@co.in', gstNumber: '29BBBBB2222B1Z2', phone: '+91 9500000000' }) }, // dup explicit code
        { rowNumber: 7, explicitVendorCode: '', vendor: makeRecord('6', { vendorCode: '2', companyName: 'Beta', email: '', gstNumber: 'none', phone: '9800011111' }) }, // dup company+phone & placeholder gstin/invalid empty email
      ];

      const { uniqueRecords, skippedDuplicates } = partitionDuplicateVendorMasterRows(candidates, []);
      expect(uniqueRecords.map((r) => r.companyName)).toEqual(['Alpha', 'Beta']);
      expect(skippedDuplicates).toHaveLength(4);
      expect(skippedDuplicates[0]).toMatchObject({
        rowNumber: 4,
        matchedAgainst: 'FILE',
        reason: formatString(vmStrings.duplicateReasonEmailFile, { value: 'ALPHA@co.in', firstRow: 2 }),
      });
      expect(skippedDuplicates[1]).toMatchObject({
        rowNumber: 5,
        matchedAgainst: 'FILE',
        reason: formatString(vmStrings.duplicateReasonGstinFile, { value: '27AAACA1111A1Z1', firstRow: 2 }),
      });
      expect(skippedDuplicates[2]).toMatchObject({
        rowNumber: 6,
        matchedAgainst: 'FILE',
        reason: formatString(vmStrings.duplicateReasonCodeFile, { value: 'V-1', firstRow: 2 }),
      });
      expect(skippedDuplicates[3]).toMatchObject({
        rowNumber: 7,
        matchedAgainst: 'FILE',
        reason: formatString(vmStrings.duplicateReasonCompanyPhoneFile, { company: 'Beta', phone: '9800011111', firstRow: 3 }),
      });
    });

    test('detects duplicates against existing Buyer Directory vendors while ignoring purely numeric auto-codes', () => {
      const existing = [
        { vendorCode: '1', name: 'Existing Numeric Co', email: 'one@ext.in', phone: '+91 9111111111', gstin: '27EXTCA1234A1Z1' },
        { vendorCode: 'EXT-77', companyName: 'Custom Code Co', email: 'custom@ext.in', phone: '9222222222', gstNumber: '' },
        { name: 'No Email Existing', email: null, phone: '+91 9333333333', gstNumber: null },
      ];

      const makeRecord = (id: string, overrides: Record<string, string>) => ({
        id,
        vendorCode: overrides.vendorCode || id,
        companyName: overrides.companyName || `Co ${id}`,
        contactPerson: 'Contact',
        email: overrides.email ?? `${id}@new.in`,
        phone: overrides.phone ?? '+91 9444444444',
        address: 'Pune',
        gstNumber: overrides.gstNumber ?? '',
      });

      const candidates = [
        { rowNumber: 2, explicitVendorCode: '1', vendor: makeRecord('1', { vendorCode: '1', companyName: 'Brand New Serial 1', email: 'brandnew@new.in', phone: '9888888881' }) },
        { rowNumber: 3, explicitVendorCode: '', vendor: makeRecord('2', { vendorCode: '2', companyName: 'Dup Email', email: 'ONE@EXT.IN', phone: '9888888882' }) },
        { rowNumber: 4, explicitVendorCode: '', vendor: makeRecord('3', { vendorCode: '3', companyName: 'Dup GSTIN', email: 'gstdup@new.in', gstNumber: '27EXTCA1234A1Z1', phone: '9888888883' }) },
        { rowNumber: 5, explicitVendorCode: 'EXT-77', vendor: makeRecord('4', { vendorCode: 'EXT-77', companyName: 'Dup Custom Code', email: 'codedup@new.in', phone: '9888888884' }) },
        { rowNumber: 6, explicitVendorCode: '', vendor: makeRecord('5', { vendorCode: '4', companyName: 'No Email Existing', email: 'invalid-no-at', phone: '9333333333' }) },
      ];

      const { uniqueRecords, skippedDuplicates } = partitionDuplicateVendorMasterRows(candidates, existing);
      expect(uniqueRecords.map((r) => r.companyName)).toEqual(['Brand New Serial 1']);
      expect(skippedDuplicates).toHaveLength(4);
      expect(skippedDuplicates.every((d) => d.matchedAgainst === 'EXISTING_VENDOR')).toBe(true);
      expect(skippedDuplicates[0].reason).toBe(formatString(vmStrings.duplicateReasonEmailExisting, { value: 'ONE@EXT.IN' }));
      expect(skippedDuplicates[1].reason).toBe(formatString(vmStrings.duplicateReasonGstinExisting, { value: '27EXTCA1234A1Z1' }));
      expect(skippedDuplicates[2].reason).toBe(formatString(vmStrings.duplicateReasonCodeExisting, { value: 'EXT-77' }));
      expect(skippedDuplicates[3].reason).toBe(
        formatString(vmStrings.duplicateReasonCompanyPhoneExisting, { company: 'No Email Existing', phone: '9333333333' })
      );
    });
  });

  describe('extractSkippedDuplicatesFromJob and reconcileVendorJobProgress', () => {
    const baseJob: IngestionJobState = {
      id: 'job-1',
      jobType: 'VENDOR_MASTER',
      fileName: 'vendors.xlsx',
      status: 'COMPLETED',
      totalRecords: 8,
      processedRecords: 8,
      importedRecords: 8,
      skippedRecords: 0,
      failedRecords: 0,
    };

    test('extracts structured duplicate rows and applies fallback display defaults', () => {
      const skipped = extractSkippedDuplicatesFromJob({
        ...baseJob,
        errorDetails: [
          { status: 'validation_error', reason: 'Bad mobile' },
          {
            rowNumber: 3,
            vendorCode: 'V-9',
            companyName: 'Alpha Co',
            email: 'a@co.in',
            phone: '+91 9811111111',
            gstNumber: '27AAACA1111A1Z1',
            status: 'duplicate_skipped',
            matchedAgainst: 'EXISTING_VENDOR',
            reason: 'Dup email',
          },
          {
            vendorName: 'Fallback Name Co',
            matchedAgainst: 'FILE',
          },
        ],
      });

      expect(skipped).toHaveLength(2);
      expect(skipped[0]).toMatchObject({
        rowNumber: 3,
        vendorCode: 'V-9',
        companyName: 'Alpha Co',
        matchedAgainst: 'EXISTING_VENDOR',
        reason: 'Dup email',
      });
      expect(skipped[1]).toMatchObject({
        rowNumber: 0,
        vendorCode: undefined,
        companyName: 'Fallback Name Co',
        email: '—',
        matchedAgainst: 'FILE',
        reason: UI_STRINGS.vendorPoIngestion.vendorMaster.duplicatesSkippedBannerHint,
      });
      expect(extractSkippedDuplicatesFromJob(baseJob)).toEqual([]);
    });

    test('reconciles Excel and CSV duplicate offsets without double-counting or inflating stored totals', () => {
      // Mismatched filename or missing summary passes through untouched
      expect(
        reconcileVendorJobProgress(baseJob, {
          fileName: 'other.xlsx',
          totalCount: 10,
          skippedCount: 2,
          isExcelOnly: true,
          allSkippedClientSide: false,
        })
      ).toEqual(baseJob);

      // Excel upload sent 8 unique rows out of 10 uploaded (2 duplicates skipped client-side):
      // stored/processing total stays 8 while uploadedRecords = 10 and skippedRecords = 2.
      const reconciledExcel = reconcileVendorJobProgress(baseJob, {
        fileName: 'vendors.xlsx',
        totalCount: 10,
        skippedCount: 2,
        isExcelOnly: true,
        allSkippedClientSide: false,
      });
      expect(reconciledExcel).toMatchObject({
        uploadedRecords: 10,
        totalRecords: 8,
        processedRecords: 8,
        importedRecords: 8,
        skippedRecords: 2,
      });

      // CSV upload fallback when client detected duplicates against local buyerVendors that server missed
      const reconciledCsv = reconcileVendorJobProgress(
        { ...baseJob, fileName: 'vendors.csv', totalRecords: 10, processedRecords: 10, importedRecords: 10, skippedRecords: 0 },
        {
          fileName: 'vendors.csv',
          totalCount: 10,
          skippedCount: 3,
          isExcelOnly: false,
          allSkippedClientSide: false,
        }
      );
      expect(reconciledCsv).toMatchObject({
        uploadedRecords: 10,
        totalRecords: 7,
        processedRecords: 7,
        importedRecords: 7,
        skippedRecords: 3,
      });

      // Handles zero/undefined fields cleanly on Excel & null summary
      expect(reconcileVendorJobProgress(baseJob, null)).toEqual(baseJob);
      expect(
        reconcileVendorJobProgress(
          { ...baseJob, totalRecords: 0, processedRecords: 0, importedRecords: 0, skippedRecords: 0 },
          { fileName: 'vendors.xlsx', totalCount: 5, skippedCount: 2, isExcelOnly: true, allSkippedClientSide: false }
        )
      ).toMatchObject({ uploadedRecords: 5, totalRecords: 3, processedRecords: 0, skippedRecords: 2 });
      expect(
        reconcileVendorJobProgress(
          { ...baseJob, fileName: 'vendors.csv', totalRecords: 0, processedRecords: 0, importedRecords: 4, skippedRecords: 0 },
          { fileName: 'vendors.csv', totalCount: 4, skippedCount: 1, isExcelOnly: false, allSkippedClientSide: false }
        )
      ).toMatchObject({ uploadedRecords: 4, totalRecords: 3, processedRecords: 3, importedRecords: 3, skippedRecords: 1 });
    });

    test('detects GSTIN, company+phone, and existing buyer directory duplicates in parseVendorUploadFile and exports CSV', async () => {
      const file = xlsxFile([
        { 'Company Name': 'Alpha Corp', 'Email Id': 'alpha@co.in', 'Mobile No': '9811111111', GSTIN: '27AAACA1111A1Z1' },
        { 'Company Name': 'Beta GST Copy', 'Email Id': 'beta@co.in', 'Mobile No': '9822222222', GSTIN: '27AAACA1111A1Z1' },
        { 'Company Name': 'Existing Co', 'Email Id': 'newmail@co.in', 'Mobile No': '9833333333', GSTIN: '29BBBBB2222B1Z2' },
      ]);
      const parsed = await parseVendorUploadFile(file, {
        existingVendors: [{ name: 'Existing Co', email: 'existing@buyer.in', phone: '9833333333' }],
      });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.rows[0].isDuplicate).toBeUndefined();
      expect(parsed.data.rows[1]).toMatchObject({ isDuplicate: true, matchedAgainst: 'FILE' });
      expect(parsed.data.rows[2]).toMatchObject({ isDuplicate: true, matchedAgainst: 'EXISTING_VENDOR' });

      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      URL.createObjectURL = jest.fn().mockReturnValue('blob:dup-url');
      URL.revokeObjectURL = jest.fn();
      try {
        downloadSkippedDuplicatesCsv([]);
        expect(URL.createObjectURL).not.toHaveBeenCalled();

        downloadSkippedDuplicatesCsv([
          {
            rowNumber: 3,
            vendorCode: 'V-3',
            companyName: 'Dup, "Co"',
            email: 'dup@co.in',
            phone: '9811111111',
            gstNumber: '27AAACA1111A1Z1',
            matchedAgainst: 'EXISTING_VENDOR',
            reason: 'Already in buyer directory',
          },
        ]);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dup-url');
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        clickSpy.mockRestore();
      }
    });

    test('deduplicates PO dump rows against existing uploaded POs and intra-file duplicates, extracts server PO duplicate details, and downloads CSV', () => {
      expect(buildPoLineDedupeKey({})).toBe('');
      expect(
        buildPoLineDedupeKey({
          poNumber: '  po-101 ',
          poDate: '15/06/2025',
          vendorName: 'Vendor VND-9',
          vendorCode: 'VND-9',
          itemDescription: 'Ball Bearings',
          specification: 'SKF 6205',
          quantity: 10,
          spend: 25000,
        })
      ).toBe('PO-101|2025-06-15|vnd-9|ball bearings|skf 6205|10|25000');

      const makePo = (id: string, overrides: Record<string, unknown> = {}) => ({
        id,
        poNumber: '',
        poDate: '',
        vendorIdentifier: 'Apex Supplies',
        vendorName: 'Apex Supplies',
        itemName: 'Ball Bearings 6205',
        itemDescription: 'Ball Bearings 6205',
        specs: 'SKF',
        specification: 'SKF',
        quantity: 0,
        unit: '',
        uom: '',
        unitPrice: 0,
        totalSpend: 0,
        spend: 0,
        department: '',
        ...overrides,
      });

      const partitioned = partitionDuplicatePoRows(
        [
          { rowNumber: 2, record: makePo('po-1') },
          { rowNumber: 3, record: makePo('po-2', { poNumber: 'PO-500', poDate: '2025-07-01', itemName: 'Gate Valve', itemDescription: 'Gate Valve', specs: '2 inch', specification: '2 inch', quantity: 5, spend: 12000, totalSpend: 12000 }) },
          { rowNumber: 4, record: makePo('po-3', { poNumber: 'po-500', poDate: '01/07/2025', itemName: 'Gate Valve', itemDescription: 'Gate Valve', specs: '2 inch', specification: '2 inch', quantity: 5, spend: 12000, totalSpend: 12000 }) },
          { rowNumber: 5, record: makePo('po-4', { vendorIdentifier: '', vendorName: '', itemName: '', itemDescription: '' }) },
        ],
        [
          {
            vendorName: '  apex  supplies ',
            itemDescription: 'ball bearings 6205',
            specification: 'skf',
          },
        ]
      );

      expect(partitioned.uniqueRecords.map((r) => r.id)).toEqual(['po-2', 'po-4']);
      expect(partitioned.skippedDuplicates).toHaveLength(2);
      expect(partitioned.skippedDuplicates[0]).toMatchObject({
        rowNumber: 2,
        vendorName: 'Apex Supplies',
        itemDescription: 'Ball Bearings 6205',
        specification: 'SKF',
        matchedAgainst: 'EXISTING_PO',
      });
      expect(partitioned.skippedDuplicates[1]).toMatchObject({
        rowNumber: 4,
        poNumber: 'po-500',
        quantity: 5,
        spend: 12000,
        matchedAgainst: 'FILE',
      });

      const extracted = extractSkippedDuplicatePosFromJob({
        id: 'job-po-1',
        jobType: 'PO_DUMP',
        fileName: 'pos.xlsx',
        status: 'COMPLETED',
        totalRecords: 0,
        processedRecords: 0,
        importedRecords: 0,
        skippedRecords: 2,
        failedRecords: 0,
        errorDetails: [
          {
            rowNumber: 2,
            poNumber: 'PO-500',
            poDate: '2025-07-01',
            vendorName: 'Apex Supplies',
            itemDescription: 'Gate Valve',
            specification: '2 inch',
            quantity: 5,
            spend: 12000,
            status: 'duplicate_skipped',
            matchedAgainst: 'EXISTING_PO',
            reason: 'Already uploaded previously',
          },
          {
            rowNumber: 0,
            matchedAgainst: 'FILE',
          },
          {
            reason: 'Non-duplicate validation failure',
          },
        ],
      });
      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toMatchObject({
        rowNumber: 2,
        poNumber: 'PO-500',
        vendorName: 'Apex Supplies',
        itemDescription: 'Gate Valve',
        quantity: 5,
        spend: 12000,
        matchedAgainst: 'EXISTING_PO',
      });
      expect(extracted[1]).toMatchObject({
        rowNumber: 0,
        vendorName: '—',
        itemDescription: '—',
        matchedAgainst: 'FILE',
        reason: UI_STRINGS.vendorPoIngestion.poDump.duplicatesSkippedBannerHint,
      });

      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      URL.createObjectURL = jest.fn().mockReturnValue('blob:po-dup-url');
      URL.revokeObjectURL = jest.fn();
      try {
        downloadSkippedDuplicatePosCsv([]);
        expect(URL.createObjectURL).not.toHaveBeenCalled();

        downloadSkippedDuplicatePosCsv([
          ...extracted,
          {
            rowNumber: 5,
            vendorName: 'Quoted, "Vendor"',
            itemDescription: 'Bolts',
            matchedAgainst: 'FILE',
            reason: 'Duplicate in file',
          },
        ]);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:po-dup-url');
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        clickSpy.mockRestore();
      }
    });
  });
});
