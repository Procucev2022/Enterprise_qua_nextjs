import * as XLSX from 'xlsx';
import type { ExtractedEntity, LineItemBid, QuoteComparison, RFQItem } from './types';

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
 *   - BasicAmount (with 0 in s.no col and vendor item subtotal in Amount cols)
 *   - GSTAmount (with 0 in s.no col and tax amount in Amount cols)
 *   - TotalAmount (with 0 in s.no col and total amount in Amount cols)
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
    headerRow1.push(quote.vendorName || `Vendor ${qIdx + 1}`, '');
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
    const isMock = !rawSpecs || rawSpecs.toLowerCase() === 'standard specification' || rawSpecs.toLowerCase() === 'standard enterprise specification' || rawSpecs.toLowerCase() === 'industrial grade';
    const hasDistinctSpecs = !isMock && rawSpecs.toLowerCase() !== (item.itemName || '').trim().toLowerCase();
    const itemName = hasDistinctSpecs ? `${item.itemName} (${rawSpecs})` : (item.itemName || '');
    const qty = typeof item.quantity === 'number' ? item.quantity : (Number(item.quantity) || 0);
    const uom = item.unit || '';

    const row: (string | number)[] = [sNo, itemName, qty, uom];

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
  // 1. BasicAmount
  const basicRow: (string | number)[] = ['', 'BasicAmount', '', ''];
  safeQuotes.forEach((quote, qIdx) => {
    const basicAmount = vendorTotals[qIdx] > 0 ? vendorTotals[qIdx] : (quote.totalPrice || 0);
    basicRow.push('', basicAmount);
  });
  aoa.push(basicRow);

  // 2. GSTAmount (calculated at quote.taxRate or standard 18% GST if taxes not explicitly provided)
  const gstRow: (string | number)[] = ['', 'GSTAmount', '', ''];
  safeQuotes.forEach((quote, qIdx) => {
    const basicAmount = vendorTotals[qIdx] > 0 ? vendorTotals[qIdx] : (quote.totalPrice || 0);
    const taxRate = typeof (quote as any).taxRate === 'number' && (quote as any).taxRate > 0
      ? (quote as any).taxRate
      : 18;
    const gstVal = typeof quote.taxes === 'number' && quote.taxes > 0
      ? quote.taxes
      : (basicAmount > 0 ? Math.round((basicAmount * taxRate) / 100) : 0);
    gstRow.push('', gstVal);
  });
  aoa.push(gstRow);

  // 3. TotalAmount (Basic Amount + GST Amount)
  const totalRow: (string | number)[] = ['', 'TotalAmount', '', ''];
  safeQuotes.forEach((quote, qIdx) => {
    const basicAmount = vendorTotals[qIdx] > 0 ? vendorTotals[qIdx] : (quote.totalPrice || 0);
    const taxRate = typeof (quote as any).taxRate === 'number' && (quote as any).taxRate > 0
      ? (quote as any).taxRate
      : 18;
    const gstVal = typeof quote.taxes === 'number' && quote.taxes > 0
      ? quote.taxes
      : (basicAmount > 0 ? Math.round((basicAmount * taxRate) / 100) : 0);
    const totalVal = basicAmount + gstVal;
    totalRow.push('', totalVal);
  });
  aoa.push(totalRow);

  // 4. Commercial & Bid Info Rows at Bottom (Warranty, Best Price, Payment Terms, Submitted, Remarks)
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

  addMergedInfoRow('Warranty', (q) =>
    typeof q.warrantyYears === 'number' && q.warrantyYears > 0
      ? `${q.warrantyYears} Year(s)`
      : (q.warrantyYears === 0 ? 'None' : 'N/A')
  );

  addMergedInfoRow('Best Price', (q) => (q.isBestPrice ? 'Yes' : 'No'));

  addMergedInfoRow('Payment Terms', (q) => q.paymentTerms || 'N/A');

  addMergedInfoRow('Submitted', (q) =>
    q.submittedAt ? new Date(q.submittedAt).toLocaleDateString('en-IN') : 'N/A'
  );

  addMergedInfoRow('Remarks', (q) => q.remarks || 'None');

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
 */
export function downloadSingleVendorQuoteExcel(rfq: RFQItem, quote: QuoteComparison): void {
  const items = Array.isArray(quote.lineItemQuotes) && quote.lineItemQuotes.length > 0
    ? quote.lineItemQuotes
    : (rfq.extractedEntities || []).map((e) => ({
        lineItemId: e.id,
        itemName: e.itemName,
        quantity: e.quantity,
        unit: e.unit,
        unitPrice: quote.unitPrice,
        totalPrice: quote.totalPrice,
        leadTimeDays: quote.leadTimeDays,
        warrantyYears: quote.warrantyYears,
      }));

  const rows: Record<string, string | number>[] = items.map((item, idx) => ({
    'S.No': idx + 1,
    'Item ID': item.lineItemId || '',
    'Item Name': item.itemName,
    'Quantity': item.quantity,
    'Unit': item.unit || 'Nos',
    'Unit Price (INR)': item.unitPrice,
    'Total Price (INR)': item.totalPrice,
    'Lead Time (Days)': (item as any).leadTimeDays ?? quote.leadTimeDays ?? '',
    'Warranty (Years)': (item as any).warrantyYears ?? quote.warrantyYears ?? '',
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
