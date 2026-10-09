import * as XLSX from 'xlsx';
import { downloadBidComparisonExcel } from '@/lib/bidComparisonExport';
import type { RFQItem, QuoteComparison } from '@/lib/types';

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(() => ({})),
  },
  write: jest.fn(() => new Uint8Array([1, 2, 3])),
}));

function makeRfq(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    rfqNumber: 'RFQ-2026-TEST01',
    extractedEntities: [
      { id: 'li-1', itemName: 'Pump', quantity: 2, unit: 'Nos', targetDate: '', technicalSpecs: '', confidence: 1, category: 'IT', minorCategory: '' },
      { id: 'li-2', itemName: 'Valve', quantity: 5, unit: 'Nos', targetDate: '', technicalSpecs: '', confidence: 1, category: 'IT', minorCategory: '' },
    ],
    ...overrides,
  } as RFQItem;
}

function makeQuote(overrides: Partial<QuoteComparison> = {}): QuoteComparison {
  return {
    vendorId: 'v-1',
    vendorName: 'Acme Co',
    vendorCategory: 'Client List',
    unitPrice: 100,
    totalPrice: 1000,
    leadTimeDays: 10,
    aiMatchScore: 80,
    warrantyYears: 1,
    complianceStatus: 'Fully Compliant',
    paymentTerms: 'Net 30',
    remarks: '',
    ...overrides,
  } as QuoteComparison;
}

describe('downloadBidComparisonExcel', () => {
  let createObjectURLSpy: jest.SpyInstance;
  let revokeObjectURLSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    createObjectURLSpy = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  test('builds one row per RFQ line item with a real per-vendor price when the vendor itemized it', () => {
    const quote = makeQuote({
      lineItemQuotes: [
        { lineItemId: 'li-1', itemName: 'Pump', quantity: 2, unitPrice: 500, totalPrice: 1000 },
        { lineItemId: 'li-2', itemName: 'Valve', quantity: 5, unitPrice: 50, totalPrice: 250 },
      ],
    });

    downloadBidComparisonExcel(makeRfq(), [quote]);

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      [
        { Item: 'Pump', Quantity: 2, 'Acme Co — Unit Price': 500, 'Acme Co — Total': 1000 },
        { Item: 'Valve', Quantity: 5, 'Acme Co — Unit Price': 50, 'Acme Co — Total': 250 },
      ],
      { header: ['Item', 'Quantity', 'Acme Co — Unit Price', 'Acme Co — Total'] },
    );
  });

  test('falls back to the vendor\'s single blended price, marked "(not itemized)", when it never submitted a per-item breakdown', () => {
    const quote = makeQuote({ unitPrice: 999, totalPrice: 9990 }); // no lineItemQuotes

    downloadBidComparisonExcel(makeRfq(), [quote]);

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ 'Acme Co — Unit Price': '999 (not itemized)' }),
      ]),
      expect.anything(),
    );
  });

  test('triggers a download with the RFQ number in the filename', () => {
    downloadBidComparisonExcel(makeRfq(), [makeQuote()]);

    expect(XLSX.write).toHaveBeenCalledWith(expect.anything(), { bookType: 'xlsx', type: 'array' });
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});
