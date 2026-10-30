import * as XLSX from 'xlsx';
import { downloadBidComparisonExcel, downloadVendorQuotationExcel, downloadFullQuotesExcel, downloadSingleVendorQuoteExcel, downloadMultiSheetWorkbook, buildBidComparisonWorksheet } from '@/lib/bidComparisonExport';
import type { RFQItem, QuoteComparison, LineItemBid } from '@/lib/types';

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(() => ({})),
    aoa_to_sheet: jest.fn(() => ({})),
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

describe('downloadMultiSheetWorkbook', () => {
  let createObjectURLSpy: jest.SpyInstance;
  let revokeObjectURLSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    createObjectURLSpy = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:multi-sheet');
    revokeObjectURLSpy = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  test('uses optional headers and truncates sheet names to Excel limits before downloading', () => {
    const longName = 'A worksheet name that exceeds thirty-one characters';
    downloadMultiSheetWorkbook([
      { name: longName, rows: [{ Item: 'Pump' }], header: ['Item', 'Quantity'] },
      { name: 'Overview', rows: [{ Vendor: 'Acme' }] },
    ], 'Quotes.xlsx');

    expect(XLSX.utils.json_to_sheet).toHaveBeenNthCalledWith(1, [{ Item: 'Pump' }], { header: ['Item', 'Quantity'] });
    expect(XLSX.utils.json_to_sheet).toHaveBeenNthCalledWith(2, [{ Vendor: 'Acme' }]);
    expect(XLSX.write).toHaveBeenCalledWith(
      expect.objectContaining({
        SheetNames: [longName.slice(0, 31), 'Overview'],
      }),
      { bookType: 'xlsx', type: 'array' },
    );
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:multi-sheet');
  });
});

describe('downloadBidComparisonExcel and buildBidComparisonWorksheet', () => {
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

  test('builds enterprise format with 2 header rows, Rate & Amount columns, and BasicAmount summary', () => {
    const quote = makeQuote({
      lineItemQuotes: [
        { lineItemId: 'li-1', itemName: 'Pump', quantity: 2, unitPrice: 500, totalPrice: 1000 },
        { lineItemId: 'li-2', itemName: 'Valve', quantity: 5, unitPrice: 50, totalPrice: 250 },
      ],
    });

    downloadBidComparisonExcel(makeRfq(), [quote]);

    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
      ['s.no', 'Item/Vendor', 'Qty', 'UOM', 'Acme Co', ''],
      ['', '', '', '', 'Rate', 'Amount'],
      [1, 'Pump', 2, 'Nos', 500, 1000],
      [2, 'Valve', 5, 'Nos', 50, 250],
      ['', 'BasicAmount', '', '', '', 1250],
      ['', 'GSTAmount', '', '', '', 225],
      ['', 'TotalAmount', '', '', '', 1475],
      ['', 'Warranty', '', '', '1 Year(s)', ''],
      ['', 'Best Price', '', '', 'No', ''],
      ['', 'Payment Terms', '', '', 'Net 30', ''],
      ['', 'Submitted', '', '', 'N/A', ''],
      ['', 'Remarks', '', '', 'None', ''],
    ]);

    expect(XLSX.write).toHaveBeenCalledWith(
      expect.objectContaining({
        SheetNames: ['Sheet1'],
      }),
      { bookType: 'xlsx', type: 'array' }
    );
  });

  test('handles blended quotes and populates GSTAmount and TotalAmount when taxes are present', () => {
    const quoteWithTaxes = makeQuote({
      vendorName: 'Beta Industrial',
      unitPrice: 200,
      totalPrice: 1400,
      taxes: 252,
    });

    downloadBidComparisonExcel(makeRfq(), [quoteWithTaxes]);

    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['', 'BasicAmount', '', '', '', 1400],
        ['', 'GSTAmount', '', '', '', 252],
        ['', 'TotalAmount', '', '', '', 1652],
      ])
    );
  });

  test('matches vendor item by name when id is not present or does not match', () => {
    const quote = makeQuote({
      lineItemQuotes: [
        { itemName: 'Pump', quantity: 2, unitPrice: 520, totalPrice: 1040 },
        { itemName: 'Unknown', quantity: 1, unitPrice: 10, totalPrice: 10 },
      ],
    });
    const rfq = makeRfq({
      extractedEntities: [
        { id: '', itemName: ' Pump ', quantity: 2, unit: 'Nos', targetDate: '', technicalSpecs: '', confidence: 1, category: 'IT', majorCategory: 'IT', minorCategory: '' },
        { id: 'li-999', itemName: '', quantity: 1, unit: 'Nos', targetDate: '', technicalSpecs: '', confidence: 1, category: 'IT', majorCategory: 'IT', minorCategory: '' },
      ],
    });

    downloadBidComparisonExcel(rfq, [quote]);

    expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        [1, ' Pump ', 2, 'Nos', 520, 1040],
        [2, '', 1, 'Nos', 100, 100],
      ])
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

describe('downloadVendorQuotationExcel', () => {
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

  const lineItems: LineItemBid[] = [
    { id: 'li-1', description: 'Pump', quantity: 2, unit: 'Nos', unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal', paymentTerms: '' },
    { id: 'li-2', description: 'Valve', quantity: 5, unit: 'Nos', unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal', paymentTerms: '' },
  ];

  test('builds one row per line item with the entered rate and computed amount', () => {
    downloadVendorQuotationExcel('RFQ-2026-TEST01', lineItems, { 'li-1': '500', 'li-2': '50' });

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      [
        { Item: 'Pump', Quantity: 2, UOM: 'Nos', 'Rate (INR)': 500, 'Amount (INR)': 1000 },
        { Item: 'Valve', Quantity: 5, UOM: 'Nos', 'Rate (INR)': 50, 'Amount (INR)': 250 },
      ],
      { header: ['Item', 'Quantity', 'UOM', 'Rate (INR)', 'Amount (INR)'] },
    );
  });

  test('leaves rate/amount blank (not 0) for a line item not yet priced', () => {
    downloadVendorQuotationExcel('RFQ-2026-TEST01', lineItems, { 'li-1': '500' });

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ Item: 'Valve', 'Rate (INR)': '', 'Amount (INR)': '' }),
      ]),
      expect.anything(),
    );
  });

  test('triggers a download with the RFQ number in the filename', () => {
    downloadVendorQuotationExcel('RFQ-2026-TEST01', lineItems, { 'li-1': '500', 'li-2': '50' });

    expect(XLSX.write).toHaveBeenCalledWith(expect.anything(), { bookType: 'xlsx', type: 'array' });
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('downloadFullQuotesExcel', () => {
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

  test('exports multi-tab workbook with itemized and non-itemized quotes', () => {
    const itemizedQuote = makeQuote({
      vendorId: 'v-1',
      vendorName: 'Acme Co',
      isBestPrice: true,
      lineItemQuotes: [
        { lineItemId: 'li-1', itemName: 'Pump', quantity: 2, unitPrice: 500, totalPrice: 1000 },
      ],
    });

    const nonItemizedQuote = makeQuote({
      vendorId: 'v-2',
      vendorName: 'Beta Ltd',
      isBestPrice: false,
      unitPrice: 300,
      totalPrice: 2100,
    });

    downloadFullQuotesExcel(makeRfq(), [itemizedQuote, nonItemizedQuote]);

    expect(XLSX.write).toHaveBeenCalledWith(
      expect.objectContaining({
        SheetNames: ['Sheet1'],
      }),
      { bookType: 'xlsx', type: 'array' }
    );
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('downloadSingleVendorQuoteExcel', () => {
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

  test('exports single vendor quote with itemized line items and totals', () => {
    const quote = makeQuote({
      vendorName: 'Delta Systems',
      lineItemQuotes: [
        { lineItemId: 'li-1', itemName: 'Pump', quantity: 2, unitPrice: 500, totalPrice: 1000 },
      ],
    });

    downloadSingleVendorQuoteExcel(makeRfq(), quote);

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ 'Item Name': 'Pump', 'Unit Price (INR)': 500 }),
        expect.objectContaining({ 'Item Name': 'TOTAL BID AMOUNT', 'Total Price (INR)': 1000 }),
      ]),
      expect.anything()
    );
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  test('exports single vendor quote when lineItemQuotes is empty and handles special character vendor name', () => {
    const quoteWithoutLineItems = makeQuote({
      vendorName: 'Delta & Sons / Ltd.',
      lineItemQuotes: undefined,
      totalPrice: 2000,
      unitPrice: 200,
      leadTimeDays: 15,
      warrantyYears: 2,
    });

    downloadSingleVendorQuoteExcel(
      makeRfq({
        extractedEntities: [
          { id: 'li-x', itemName: 'Spare Part', quantity: 10, unit: undefined } as any,
        ],
      }),
      quoteWithoutLineItems
    );

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ 'Item Name': 'Spare Part', 'Unit': 'Nos' }),
      ]),
      expect.anything()
    );
  });
});

describe('bidComparisonExport Additional Branch Coverage', () => {
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

  test('downloadFullQuotesExcel covers score breakdown, missing fallbacks, and non-itemized remarks', () => {
    const fullScoreQuote = makeQuote({
      vendorName: 'Alpha Tech',
      scoreBreakdown: {
        price: { raw: 100, weighted: 45 },
        leadTime: { raw: 90, weighted: 27 },
        warranty: { raw: 80, weighted: 20 },
      } as any,
      aiMatchScore: undefined,
      isBestPrice: true,
      leadTimeDays: undefined,
      warrantyYears: undefined,
      complianceStatus: undefined,
      paymentTerms: undefined,
      submittedAt: '2026-05-01T12:00:00Z',
      remarks: undefined,
      vendorCategory: undefined,
      totalPrice: undefined,
      unitPrice: undefined,
      lineItemQuotes: [
        {
          lineItemId: undefined,
          itemName: 'Item Without ID',
          quantity: 1,
          unit: undefined,
          unitPrice: 50,
          totalPrice: 50,
          leadTimeDays: undefined,
          warrantyYears: undefined,
        } as any,
      ],
    });

    const fallbackQuote = makeQuote({
      vendorName: 'Beta Tech',
      scoreBreakdown: undefined,
      aiMatchScore: 75,
      isBestPrice: false,
      leadTimeDays: 0,
      warrantyYears: 0,
      paymentTerms: '50% advance',
      submittedAt: undefined,
      remarks: 'Fast delivery',
      lineItemQuotes: [],
    });

    const rfqWithEmptyFields: RFQItem = {
      rfqNumber: 'RFQ-EMPTY-01',
      title: 'Empty Fields RFQ',
      category: undefined,
      extractedEntities: [
        {
          id: undefined,
          itemName: '',
          quantity: undefined,
          unit: undefined,
          majorCategory: undefined,
          minorCategory: undefined,
          targetDate: undefined,
          technicalSpecs: undefined,
        } as any,
      ],
    } as any;

    downloadFullQuotesExcel(rfqWithEmptyFields, [fullScoreQuote, fallbackQuote]);
    expect(XLSX.write).toHaveBeenCalled();
  });

  test('downloadBidComparisonExcel and downloadVendorQuotationExcel handle empty and unpriced lines', () => {
    // Empty extractedEntities in rfq
    downloadBidComparisonExcel({ rfqNumber: 'RFQ-NONE', extractedEntities: undefined } as any, []);

    // Line items with and without rates
    const lineBids: LineItemBid[] = [
      { id: 'lb-1', description: 'Item 1', quantity: 5, unit: undefined, unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal' as const, paymentTerms: 'Net 30' },
      { id: 'lb-2', description: 'Item 2', quantity: 2, unit: 'Kg', unitPrice: 150, leadTimeDays: 5, marketBandStatus: 'optimal' as const, paymentTerms: 'Net 30' },
    ];
    downloadVendorQuotationExcel('RFQ-RATE-TEST', lineBids, { 'lb-2': '150' });

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalled();
  });
});
