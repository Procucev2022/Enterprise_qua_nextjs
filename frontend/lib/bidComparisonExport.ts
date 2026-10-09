import * as XLSX from 'xlsx';
import type { ExtractedEntity, LineItemBid, QuoteComparison, RFQItem } from './types';

/** Shared build-workbook-and-download-it tail for every export in this file. */
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

/**
 * Finds a vendor's priced line item matching an RFQ line item — by
 * lineItemId first (the real link once both sides carry it), falling back
 * to a case-insensitive description match for quotes that only have the
 * item name (e.g. older email-extracted quotes).
 */
function findVendorLineItemPrice(quote: QuoteComparison, rfqItem: ExtractedEntity) {
  const items = quote.lineItemQuotes || [];
  const byId = rfqItem.id ? items.find((li) => li.lineItemId === rfqItem.id) : undefined;
  if (byId) return byId;
  const name = (rfqItem.itemName || '').trim().toLowerCase();
  if (!name) return undefined;
  return items.find((li) => (li.itemName || '').trim().toLowerCase() === name);
}

/**
 * Builds and downloads a line-item-by-vendor bid comparison workbook — one
 * row per RFQ line item, two columns per vendor (Unit Price, Total). A
 * vendor with no itemized breakdown for this RFQ (lineItemQuotes empty —
 * an older quote, or one submitted before this feature existed) shows its
 * single blended unit price in every row, suffixed "(not itemized)" rather
 * than left blank, so the sheet still reflects what was actually quoted.
 */
export function downloadBidComparisonExcel(rfq: RFQItem, quotes: QuoteComparison[]): void {
  const lineItems = rfq.extractedEntities || [];
  const rows = lineItems.map((item) => {
    const row: Record<string, string | number> = {
      Item: item.itemName,
      Quantity: item.quantity,
    };
    quotes.forEach((quote) => {
      const matched = findVendorLineItemPrice(quote, item);
      if (matched) {
        row[`${quote.vendorName} — Unit Price`] = matched.unitPrice;
        row[`${quote.vendorName} — Total`] = matched.totalPrice;
      } else {
        row[`${quote.vendorName} — Unit Price`] = `${quote.unitPrice} (not itemized)`;
        row[`${quote.vendorName} — Total`] = `${quote.totalPrice} (not itemized)`;
      }
    });
    return row;
  });

  const header = ['Item', 'Quantity', ...quotes.flatMap((q) => [`${q.vendorName} — Unit Price`, `${q.vendorName} — Total`])];
  downloadWorkbook('Bid Comparison', rows, header, `Bid_Comparison_${rfq.rfqNumber}.xlsx`);
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
