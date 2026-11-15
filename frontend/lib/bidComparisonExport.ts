import * as XLSX from 'xlsx';
import type { ExtractedEntity, LineItemBid, QuoteComparison, RFQItem } from './types';
import { UI_STRINGS } from './uiStrings';

/** A quote that may carry a tax rate, as sent by the quote endpoint. */
type QuoteWithTaxRate = QuoteComparison & { taxRate?: number };

/** Cell shown where the quote does not record a value. Never a substitute number or label. */
const EMPTY_CELL = UI_STRINGS.dataLoad.emptyCell;

/** Shared build-workbook-and-download-it tail for single-sheet exports. */
function downloadWorkbook(sheetName: string, rows: Record<string, string | number>[], header: string[], fileName: string): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header });
  const workbook: XLSX.WorkBook = { Sheets: { [sheetName]: worksheet }, SheetNames: [sheetName] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Multi-sheet workbook downloader for full RFQ quote packages. */
export function downloadMultiSheetWorkbook(
  sheets: Array<{ name: string; rows?: Record<string, any>[]; header?: string[]; worksheet?: XLSX.WorkSheet }>,
  fileName: string
): void {
  const sheetsObj: Record<string, XLSX.WorkSheet> = {};
  const sheetNames: string[] = [];

  sheets.forEach(({ name, rows, header, worksheet }) => {
    // Excel sheet names cannot exceed 31 chars
    const safeName = name.slice(0, 31);
    const ws = worksheet || (rows ? (header ? XLSX.utils.json_to_sheet(rows, { header }) : XLSX.utils.json_to_sheet(rows)) : XLSX.utils.aoa_to_sheet([]));
    sheetsObj[safeName] = ws;
    sheetNames.push(safeName);
  });

  const workbook: XLSX.WorkBook = { Sheets: sheetsObj, SheetNames: sheetNames };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Finds a vendor's priced line item matching an RFQ line item — by
 * lineItemId first (the real link once both sides carry it), falling back
 * to a case-insensitive description match for quotes that only have the
 * item name (e.g. older email-extracted quotes).
 */
export function findVendorLineItemPrice(quote: QuoteComparison, rfqItem: ExtractedEntity) {
  const items = quote.lineItemQuotes || [];
  const byId = rfqItem.id ? items.find((li) => li.lineItemId === rfqItem.id) : undefined;
  if (byId) return byId;
  const name = (rfqItem.itemName || '').trim().toLowerCase();
  if (!name) return undefined;
  return items.find((li) => (li.itemName || '').trim().toLowerCase() === name);
}

/**
 * Builds a styled 2D bid comparison worksheet matching enterprise quote export template:
 * - Header Row 1: s.no, Item/Vendor, Qty, UOM, followed by merged vendor names across Rate & Amount
 * - Header Row 2: Rate, Amount under each vendor
 * - Line item rows: S.No (1, 2, ...), Item Description, Qty, UOM, and Rate & Amount per vendor
 * - Bottom summary rows:
 *   - BasicAmount (vendor item subtotal, or the quote total when no line prices exist)
 *   - GSTAmount (the quote's tax amount, or its tax rate applied to the basic amount; blank when neither is recorded)
 *   - TotalAmount (basic plus GST; blank when GST is not known)
 * A value the quote does not record is left blank or shown as a dash. No default rate or label is used.
 */
export function buildBidComparisonWorksheet(rfq: RFQItem, quotes: QuoteComparison[]): XLSX.WorkSheet {
  const safeQuotes = quotes || [];
  const lineItems = rfq?.extractedEntities || [];

  // Row 0: Header 1 (vendor names spanning across 2 columns)
  const headerRow1: (string | number)[] = ['s.no', 'Item/Vendor', 'Qty', 'UOM'];
  // Row 1: Header 2 (Rate, Amount underneath each vendor)
  const headerRow2: (string | number)[] = ['', '', '', ''];

  const merges: XLSX.Range[] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, // s.no
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }, // Item/Vendor
    { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } }, // Qty
    { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } }, // UOM
  ];

  safeQuotes.forEach((quote, qIdx) => {
    const startCol = 4 + qIdx * 2;
    headerRow1.push(quote.vendorName || EMPTY_CELL, '');
    headerRow2.push('Rate', 'Amount');
    merges.push({
      s: { r: 0, c: startCol },
      e: { r: 0, c: startCol + 1 },
    });
  });

  const aoa: (string | number)[][] = [headerRow1, headerRow2];

  // Track totals per vendor for BasicAmount
  const vendorTotals: number[] = new Array(safeQuotes.length).fill(0);

  // Line item rows
  lineItems.forEach((item, itemIdx) => {
    const sNo = itemIdx + 1;
    const rawSpecs = (item.technicalSpecs || '').trim();
    // Generic filler specs ("standard specification" and similar) are placeholder text, not
    // real technical detail, so they are left out of the item name.
    const isPlaceholderSpec = !rawSpecs || rawSpecs.toLowerCase() === 'standard specification' || rawSpecs.toLowerCase() === 'standard enterprise specification' || rawSpecs.toLowerCase() === 'industrial grade';
    const hasDistinctSpecs = !isPlaceholderSpec && rawSpecs.toLowerCase() !== (item.itemName || '').trim().toLowerCase();
    const itemName = hasDistinctSpecs ? `${item.itemName} (${rawSpecs})` : (item.itemName || '');
    // A quantity the RFQ does not record is left blank in the sheet. It is never written out as zero.
    const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
    const hasQuantity = Number.isFinite(quantity);
    const qty = hasQuantity ? quantity : 0;
    const uom = item.unit || '';

    const row: (string | number)[] = [sNo, itemName, hasQuantity ? qty : '', uom];

    safeQuotes.forEach((quote, qIdx) => {
      const matched = findVendorLineItemPrice(quote, item);
      let rate: number | '' = '';
      let amount: number | '' = '';

      if (matched) {
        if (typeof matched.unitPrice === 'number') {
          rate = matched.unitPrice;
        } else if (matched.unitPrice) {
          rate = Number(matched.unitPrice) || '';
        }

        if (typeof matched.totalPrice === 'number') {
          amount = matched.totalPrice;
        } else if (matched.totalPrice) {
          amount = Number(matched.totalPrice) || '';
        } else if (typeof rate === 'number' && qty > 0) {
          amount = rate * qty;
        }
      } else if (typeof quote.unitPrice === 'number' && quote.unitPrice > 0) {
        rate = quote.unitPrice;
        amount = qty > 0 ? quote.unitPrice * qty : quote.totalPrice || '';
      }

      row.push(rate, amount);
      if (typeof amount === 'number') {
        vendorTotals[qIdx] += amount;
      }
    });

    aoa.push(row);
  });

  // Footer summary rows (matching enterprise template)
  const basicAmountFor = (quote: QuoteComparison, qIdx: number): number | '' => {
    if (vendorTotals[qIdx] > 0) return vendorTotals[qIdx];
    return typeof quote.totalPrice === 'number' ? quote.totalPrice : '';
  };
  const gstAmountFor = (quote: QuoteComparison, basic: number | ''): number | '' => {
    const { taxes, taxRate } = quote as QuoteWithTaxRate;
    if (typeof taxes === 'number' && taxes > 0) return taxes;
    if (typeof taxRate === 'number' && taxRate > 0 && typeof basic === 'number' && basic > 0) {
      return Math.round((basic * taxRate) / 100);
    }
    return '';
  };

  const basicRow: (string | number)[] = ['', 'BasicAmount', '', ''];
  const gstRow: (string | number)[] = ['', 'GSTAmount', '', ''];
  const totalRow: (string | number)[] = ['', 'TotalAmount', '', ''];
  safeQuotes.forEach((quote, qIdx) => {
    const basic = basicAmountFor(quote, qIdx);
    const gst = gstAmountFor(quote, basic);
    const total = typeof basic === 'number' && typeof gst === 'number' ? basic + gst : '';
    basicRow.push('', basic);
    gstRow.push('', gst);
    totalRow.push('', total);
  });
  aoa.push(basicRow, gstRow, totalRow);

  // Commercial & bid info rows at the bottom (Warranty, Best Price, Payment Terms, Submitted, Remarks)
  const addMergedInfoRow = (label: string, getValue: (q: QuoteComparison) => string | number) => {
    const row: (string | number)[] = ['', label, '', ''];
    const rowIdx = aoa.length;
    safeQuotes.forEach((quote, qIdx) => {
      const startCol = 4 + qIdx * 2;
      const val = getValue(quote);
      row.push(val, '');
      merges.push({
        s: { r: rowIdx, c: startCol },
        e: { r: rowIdx, c: startCol + 1 },
      });
    });
    aoa.push(row);
  };

  addMergedInfoRow('Warranty', (q) => {
    if (typeof q.warrantyYears === 'number' && q.warrantyYears > 0) return `${q.warrantyYears} Year(s)`;
    return q.warrantyYears === 0 ? 'None' : EMPTY_CELL;
  });

  addMergedInfoRow('Best Price', (q) => {
    if (q.isBestPrice === true) return 'Yes';
    return q.isBestPrice === false ? 'No' : EMPTY_CELL;
  });

  addMergedInfoRow('Payment Terms', (q) => q.paymentTerms || EMPTY_CELL);

  addMergedInfoRow('Submitted', (q) =>
    q.submittedAt ? new Date(q.submittedAt).toLocaleDateString('en-IN') : EMPTY_CELL
  );

  addMergedInfoRow('Remarks', (q) => q.remarks || EMPTY_CELL);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!merges'] = merges;

  // Professional column widths
  const cols: { wch: number }[] = [
    { wch: 8 },  // s.no
    { wch: 45 }, // Item/Vendor
    { wch: 10 }, // Qty
    { wch: 10 }, // UOM
  ];
  safeQuotes.forEach((quote) => {
    const nameLen = (quote.vendorName || '').length;
    cols.push({ wch: Math.max(12, Math.floor(nameLen / 2)) }); // Rate
    cols.push({ wch: Math.max(14, Math.ceil(nameLen / 2)) });  // Amount
  });
  worksheet['!cols'] = cols;

  return worksheet;
}

/**
 * Builds and downloads a line-item-by-vendor bid comparison workbook:
 * Uses the exact enterprise format with 2 header rows, Rate & Amount columns per vendor,
 * and BasicAmount / GSTAmount / TotalAmount bottom summary rows on Sheet1.
 */
export function downloadBidComparisonExcel(rfq: RFQItem, quotes: QuoteComparison[]): void {
  const worksheet = buildBidComparisonWorksheet(rfq, quotes);
  const sheetName = 'Sheet1';
  const workbook: XLSX.WorkBook = { Sheets: { [sheetName]: worksheet }, SheetNames: [sheetName] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Bid_Comparison_${rfq?.rfqNumber || 'RFQ'}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Single-sheet quote comparison Excel export:
 * Strictly follows the enterprise layout (Rate & Amount per vendor) with
 * BasicAmount, GSTAmount, TotalAmount, Warranty, Best Price, Payment Terms,
 * Submitted, and Remarks at the bottom.
 * Exactly one sheet ('Sheet1') is generated, with AI match score omitted/hidden.
 */
export function downloadFullQuotesExcel(rfq: RFQItem, quotes: QuoteComparison[]): void {
  const safeQuotes = quotes || [];
  const worksheet = buildBidComparisonWorksheet(rfq, safeQuotes);
  const sheetName = 'Sheet1';
  const workbook: XLSX.WorkBook = { Sheets: { [sheetName]: worksheet }, SheetNames: [sheetName] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Full_Quotes_${rfq?.rfqNumber || 'RFQ'}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a single vendor's quotation in Excel format.
 *
 * When the quote has no line-item prices, each RFQ line is listed with blank price cells.
 * The quote total is shown only in the summary row. It is not copied onto every line.
 */
export function downloadSingleVendorQuoteExcel(rfq: RFQItem, quote: QuoteComparison): void {
  const lineItemQuotes = Array.isArray(quote.lineItemQuotes) ? quote.lineItemQuotes : [];
  const rows: Record<string, string | number>[] = lineItemQuotes.length > 0
    ? lineItemQuotes.map((item, idx) => ({
        'S.No': idx + 1,
        'Item ID': item.lineItemId || '',
        'Item Name': item.itemName,
        'Quantity': item.quantity,
        'Unit': item.unit || '',
        'Unit Price (INR)': item.unitPrice ?? '',
        'Total Price (INR)': item.totalPrice ?? '',
        'Lead Time (Days)': (item as any).leadTimeDays ?? '',
        'Warranty (Years)': (item as any).warrantyYears ?? '',
      }))
    : (rfq.extractedEntities || []).map((entity, idx) => ({
        'S.No': idx + 1,
        'Item ID': entity.id || '',
        'Item Name': entity.itemName,
        'Quantity': entity.quantity,
        'Unit': entity.unit || '',
        'Unit Price (INR)': '',
        'Total Price (INR)': '',
        'Lead Time (Days)': '',
        'Warranty (Years)': '',
      }));

  // Append summary row
  rows.push({
    'S.No': '',
    'Item ID': '',
    'Item Name': 'TOTAL BID AMOUNT',
    'Quantity': '',
    'Unit': '',
    'Unit Price (INR)': '',
    'Total Price (INR)': quote.totalPrice,
    'Lead Time (Days)': quote.leadTimeDays || '',
    'Warranty (Years)': quote.warrantyYears || '',
  });

  const vendorSafeName = quote.vendorName.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadWorkbook(
    'Quotation',
    rows,
    [
      'S.No',
      'Item ID',
      'Item Name',
      'Quantity',
      'Unit',
      'Unit Price (INR)',
      'Total Price (INR)',
      'Lead Time (Days)',
      'Warranty (Years)',
    ],
    `Quote_${vendorSafeName}_${rfq.rfqNumber}.xlsx`
  );
}

/**
 * Builds and downloads the vendor's own line-item quotation as it currently
 * stands in the bid form — Item / Qty / UOM / Rate / Amount, same shape as
 * the on-screen table — so a vendor has a real record of exactly what
 * they're about to submit (or just submitted).
 */
export function downloadVendorQuotationExcel(
  rfqNumber: string,
  lineItems: LineItemBid[],
  rates: Record<string, string>
): void {
  const rows = lineItems.map((item) => {
    const rate = Number(rates[item.id]) || 0;
    return {
      Item: item.description,
      Quantity: item.quantity,
      UOM: item.unit || '',
      'Rate (INR)': rate || '',
      'Amount (INR)': rate > 0 ? rate * item.quantity : '',
    };
  });

  downloadWorkbook(
    'Quotation',
    rows,
    ['Item', 'Quantity', 'UOM', 'Rate (INR)', 'Amount (INR)'],
    `Quotation_${rfqNumber}.xlsx`
  );
}
