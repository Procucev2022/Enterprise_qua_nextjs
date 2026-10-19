import * as XLSX from 'xlsx';
import {
  REPORT_OPTIONS,
  fetchReportData,
  exportReportToExcel,
  exportReportToCsv,
} from '@/lib/reportsClient';

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(() => ({})),
    sheet_to_csv: jest.fn(() => 'col1,col2\nval1,val2'),
  },
  write: jest.fn(() => new Uint8Array([1, 2, 3])),
}));

describe('reportsClient Suite', () => {
  let createObjectURLSpy: jest.SpyInstance;
  let revokeObjectURLSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    createObjectURLSpy = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-download');
    revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('REPORT_OPTIONS registry', () => {
    test('contains options for seller, rfq, buyer, and daily_activity', () => {
      const categories = new Set(REPORT_OPTIONS.map((r) => r.category));
      expect(categories.has('seller')).toBe(true);
      expect(categories.has('rfq')).toBe(true);
      expect(categories.has('buyer')).toBe(true);
      expect(categories.has('daily_activity')).toBe(true);
      expect(REPORT_OPTIONS.length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('fetchReportData', () => {
    test('fetches seller report data with requestType and dates', async () => {
      const mockResult = { success: true, totalRecords: 2, data: [{ SellerCompanyName: 'Apex' }] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const config = REPORT_OPTIONS[0]; // seller_detailed
      const res = await fetchReportData(config, '2026-01-01', '2026-01-31');

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/reports/seller-report?requestType=sellerReport&startDate=2026-01-01&endDate=2026-01-31')
      );
    });

    test('fetches daily activity report without requestType', async () => {
      const mockSummary = { success: true, summary: { rfqsCreated: 5 } };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSummary,
      } as Response);

      const config = REPORT_OPTIONS.find((r) => r.id === 'daily_activity')!;
      const res = await fetchReportData(config);

      expect(res.success).toBe(true);
      expect(res.summary?.rfqsCreated).toBe(5);
    });

    test('handles HTTP error responses gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid range' }),
      } as Response);

      const config = REPORT_OPTIONS[0];
      const res = await fetchReportData(config);

      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid range');
    });

    test('handles network exceptions gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const config = REPORT_OPTIONS[0];
      const res = await fetchReportData(config);

      expect(res.success).toBe(false);
      expect(res.error).toBe('Network offline');
    });
  });

  describe('exportReportToExcel', () => {
    test('does nothing when rows are empty', () => {
      exportReportToExcel([], 'TestReport');
      expect(createObjectURLSpy).not.toHaveBeenCalled();
    });

    test('generates workbook and triggers anchor click on valid rows', () => {
      const rows = [{ Name: 'Item 1', Price: 100 }];
      exportReportToExcel(rows, 'CustomReport', 'CustomSheet');

      expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(rows);
      expect(XLSX.write).toHaveBeenCalled();
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-download');
    });
  });

  describe('exportReportToCsv', () => {
    test('does nothing when rows are empty', () => {
      exportReportToCsv([], 'TestReport');
      expect(createObjectURLSpy).not.toHaveBeenCalled();
    });

    test('converts sheet to CSV and triggers anchor click on valid rows', () => {
      const rows = [{ Name: 'Item 1', Price: 100 }];
      exportReportToCsv(rows, 'CustomReport');

      expect(XLSX.utils.sheet_to_csv).toHaveBeenCalled();
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-download');
    });
  });
});
