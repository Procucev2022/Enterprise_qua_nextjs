import * as XLSX from 'xlsx';
import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import { EMAIL_PATTERN, GSTIN_PATTERN, PHONE_PATTERN } from './validationSchemas';
import type {
  ApprovedVendorMapping,
  IngestionUploadProgress,
  ParseIngestionFileResult,
  ParsedPoRow,
  ParsedVendorMasterRow,
  PoDumpUploadResult,
  VendorAiClassificationLogEntry,
  VendorCategorizationBatchResult,
  VendorCategoryMapping,
  VendorCategoryReviewAction,
  VendorCategorySegmentation,
  VendorDispatchPreview,
  VendorDispatchRetryResult,
  VendorDispatchSendResult,
  VendorDispatchStatusResult,
  VendorDispatchTemplate,
  VendorIngestionAuditEntry,
  VendorIngestionCategoryMaster,
  VendorIngestionHorizonType,
  VendorIngestionMasterRecord,
  VendorIngestionResumeState,
  VendorIngestionSession,
  VendorMappingListResult,
  VendorMasterUploadResult,
  VendorPoJoinResult,
} from './types';

/**
 * Vendor Master & PO Data Ingestion client.
 *
 * Two responsibilities:
 *
 *   1. Read the buyer's two spreadsheets in the browser and validate every row
 *      against the same rules the server enforces, so the buyer sees which lines
 *      are wrong before anything is submitted. Nothing is ever defaulted — a row
 *      missing a required value is reported invalid, never quietly filled in.
 *      (initial-setup-modal.tsx does the opposite: it invents a vendor code, a
 *      company name, an email, a phone number and a price for every blank cell.
 *      That is what produced vendor masters full of uncontactable suppliers.)
 *
 *   2. Wrap /api/vendor-ingestion/*. Following the rfqClient convention, no
 *      function here throws: every failure comes back as a discriminated result
 *      the caller renders, including the network and non-JSON cases.
 *
 * The API key, the AI prompt and the buyer's category master never appear in this
 * file — categorisation happens entirely server-side.
 */

const API_BASE = '/api/vendor-ingestion';

export const ALLOWED_INGESTION_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/**
 * A spreadsheet larger than this risks freezing the tab, because XLSX parses on
 * the main thread. Rejected client-side with a readable reason rather than
 * letting the browser hang with no explanation.
 */
export const MAX_INGESTION_FILE_BYTES = 25 * 1024 * 1024; // 25MB

/** Rows per upload request. Mirrors MAX_ROWS_PER_REQUEST on the server. */
export const UPLOAD_CHUNK_SIZE = 500;

export function isAllowedIngestionFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_INGESTION_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// ------------------------------------------------------------------------------
// SPREADSHEET READING
// ------------------------------------------------------------------------------

/** Normalise a header for comparison: strip everything but letters and digits. */
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Find a header cell matching any acceptable spelling, tolerant of case/spacing. */
function findColumn(headerKeys: string[], candidates: string[]): string | undefined {
  const normalized = candidates.map(normalizeHeader);
  return headerKeys.find((key) => normalized.includes(normalizeHeader(key)));
}

function cellToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/** Strip currency symbols, thousands separators and stray text from a number. */
function cellToNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Convert a spreadsheet date cell to YYYY-MM-DD.
 *
 * This is the single most failure-prone conversion in the module, because the
 * chosen time horizon filters on it: read 03/04/2024 as March instead of April
 * and a PO silently lands in the wrong window, changing the evidence a supplier
 * is categorised from. So the handling is explicit rather than left to `new Date`:
 *
 *   - An Excel serial number (what a real .xlsx date cell holds) is decoded via
 *     XLSX's own epoch parser, which is unambiguous.
 *   - An unambiguous ISO string is taken as-is.
 *   - A DD/MM/YYYY or MM/DD/YYYY string is only accepted when one reading is
 *     impossible (a component above 12 fixes which field is the day). A genuinely
 *     ambiguous value like 03/04/2024 is REJECTED, and the row is reported so the
 *     buyer can fix the column, rather than guessed at.
 *
 * Returns null when the value cannot be resolved with certainty.
 */
export function cellToIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toIsoParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // Excel stores a date as a serial number of days since its epoch.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
    if (parsed && parsed.y) return toIsoParts(parsed.y, parsed.m, parsed.d);
    return null;
  }

  const raw = String(value).trim();
  if (raw === '') return null;

  // ISO, or ISO with a time component — already unambiguous.
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    return toIsoParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // YYYY/MM/DD — year first, so also unambiguous.
  const yearFirst = raw.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (yearFirst) {
    return toIsoParts(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  // DD-MMM-YYYY / DD MMM YYYY (01-Apr-2024) — the month name removes all doubt.
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const named = raw.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{4})$/);
  if (named) {
    const monthIndex = monthNames.indexOf(named[2].slice(0, 3).toLowerCase());
    if (monthIndex === -1) return null;
    return toIsoParts(Number(named[3]), monthIndex + 1, Number(named[1]));
  }

  // Two numeric components then a year. Only accepted when the ordering is
  // forced by a value above 12; a truly ambiguous date is refused.
  const slashed = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = Number(slashed[3]);
    if (first > 12 && second <= 12) return toIsoParts(year, second, first); // DD/MM/YYYY
    if (second > 12 && first <= 12) return toIsoParts(year, first, second); // MM/DD/YYYY
    return null; // Ambiguous — refuse rather than guess.
  }

  return null;
}

/** Build YYYY-MM-DD, validating that the components form a real calendar date. */
function toIsoParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null; // e.g. 31 February
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Read the first sheet of a workbook into row objects. Never throws. */
function readSheetRows(
  file: File
): Promise<{ success: true; rows: Record<string, unknown>[] } | { success: false; error: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          resolve({ success: false, error: UI_STRINGS.vendorPoIngestion.validation.noRowsBody });
          return;
        }
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
          defval: '',
        });
        if (!rows || rows.length === 0) {
          resolve({ success: false, error: UI_STRINGS.vendorPoIngestion.validation.noRowsBody });
          return;
        }
        resolve({ success: true, rows });
      } catch (err: unknown) {
        resolve({
          success: false,
          error: err instanceof Error ? err.message : 'Could not read the file — is it a valid spreadsheet?',
        });
      }
    };

    reader.onerror = () => resolve({ success: false, error: 'Failed to read the file from disk.' });
    reader.readAsArrayBuffer(file);
  });
}

/** True when a row is entirely blank, so it can be skipped rather than reported. */
function isBlankRow(raw: Record<string, unknown>): boolean {
  return Object.values(raw).every((value) => cellToString(value) === '');
}

// ------------------------------------------------------------------------------
// VENDOR MASTER PARSING
// ------------------------------------------------------------------------------

export const VENDOR_MASTER_TEMPLATE_HEADERS = [
  'Vendor Code',
  'Company Name',
  'Contact Person',
  'Email',
  'Phone',
  'Address',
  'GSTIN',
  'Rating',
] as const;

/**
 * Parse and validate a Vendor Master file.
 *
 * Vendor Code, Company Name and Email are required: a row without them cannot be
 * matched to PO history or emailed, which are the only two things this module
 * does with a supplier. Rating is optional and is rejected — not clamped — when
 * out of 0-100, so a 0-5 rating column pasted into a 0-100 field surfaces instead
 * of being silently rescaled.
 */
export async function parseVendorMasterFile(file: File): Promise<ParseIngestionFileResult<ParsedVendorMasterRow>> {
  const sheet = await readSheetRows(file);
  if (!sheet.success) {
    return { success: false, rows: [], blankRowCount: 0, missingColumns: [], error: sheet.error };
  }

  const headerKeys = Object.keys(sheet.rows[0]);
  const codeCol = findColumn(headerKeys, ['vendorcode', 'vendor code', 'code', 'vendor id', 'supplier code']);
  const nameCol = findColumn(headerKeys, ['companyname', 'company name', 'vendor name', 'supplier name', 'name', 'vendor']);
  const contactCol = findColumn(headerKeys, ['contactperson', 'contact person', 'contact', 'person name']);
  const emailCol = findColumn(headerKeys, ['email', 'email id', 'emailid', 'mail']);
  const phoneCol = findColumn(headerKeys, ['phone', 'mobile', 'mobile no', 'phone number', 'contact number']);
  const addressCol = findColumn(headerKeys, ['address', 'location', 'plant location', 'office address']);
  const gstinCol = findColumn(headerKeys, ['gstin', 'gst', 'gst number', 'gstnumber', 'gst no']);
  const ratingCol = findColumn(headerKeys, ['rating', 'score', 'vendor rating', 'vendorratingscore', 'performance score']);

  const missingColumns: string[] = [];
  if (!codeCol) missingColumns.push('Vendor Code');
  if (!nameCol) missingColumns.push('Company Name');
  if (!emailCol) missingColumns.push('Email');
  if (missingColumns.length > 0) {
    return {
      success: false,
      rows: [],
      blankRowCount: 0,
      missingColumns,
      error: formatString(UI_STRINGS.vendorPoIngestion.validation.missingColumnsTemplate, {
        columns: missingColumns.join(', '),
      }),
    };
  }

  const seenCodes = new Map<string, number>();
  const seenGstins = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  const rows: ParsedVendorMasterRow[] = [];
  let blankRowCount = 0;

  sheet.rows.forEach((raw, index) => {
    const rowNumber = index + 2; // the header occupies row 1
    if (isBlankRow(raw)) {
      blankRowCount += 1;
      return;
    }

    const vendorCode = cellToString(raw[codeCol as string]);
    const companyName = cellToString(raw[nameCol as string]);
    const contactPerson = contactCol ? cellToString(raw[contactCol]) : '';
    const email = emailCol ? cellToString(raw[emailCol]).toLowerCase() : '';
    const phone = phoneCol ? cellToString(raw[phoneCol]) : '';
    const address = addressCol ? cellToString(raw[addressCol]) : '';
    const gstin = gstinCol ? cellToString(raw[gstinCol]).toUpperCase() : '';
    const ratingRaw = ratingCol ? cellToNumber(raw[ratingCol]) : null;

    const errors: string[] = [];
    if (vendorCode === '') errors.push('Vendor Code is required.');
    if (companyName === '') errors.push('Company Name is required.');
    else if (companyName.length < 2) errors.push('Company Name must be at least 2 characters.');
    if (email === '') errors.push('Email is required.');
    else if (!EMAIL_PATTERN.test(email)) errors.push('Email is not a valid email address.');
    if (phone !== '' && !PHONE_PATTERN.test(phone)) errors.push('Phone is not a valid contact number.');
    if (gstin !== '' && !GSTIN_PATTERN.test(gstin)) errors.push('GSTIN format is invalid.');
    if (ratingRaw !== null && (ratingRaw < 0 || ratingRaw > 100)) {
      errors.push('Rating must be between 0 and 100. Leave it blank if the supplier is unrated.');
    }

    if (vendorCode !== '') {
      const key = vendorCode.toLowerCase();
      const firstSeen = seenCodes.get(key);
      if (firstSeen !== undefined) errors.push(`Duplicate Vendor Code — already used on row ${firstSeen}.`);
      else seenCodes.set(key, rowNumber);
    }
    if (gstin !== '') {
      const firstSeen = seenGstins.get(gstin);
      if (firstSeen !== undefined) errors.push(`Duplicate GSTIN — already used on row ${firstSeen}.`);
      else seenGstins.set(gstin, rowNumber);
    }
    if (email !== '') {
      const firstSeen = seenEmails.get(email);
      if (firstSeen !== undefined) errors.push(`Duplicate email — already used on row ${firstSeen}.`);
      else seenEmails.set(email, rowNumber);
    }

    rows.push({
      rowNumber,
      vendor: {
        vendorCode,
        companyName,
        contactPerson,
        email,
        phone,
        address,
        gstin,
        ...(ratingRaw !== null ? { rating: ratingRaw } : {}),
      },
      isValid: errors.length === 0,
      errors,
    });
  });

  return { success: true, rows, blankRowCount, missingColumns: [] };
}

// ------------------------------------------------------------------------------
// PO DUMP PARSING
// ------------------------------------------------------------------------------

export const PO_TEMPLATE_HEADERS = [
  'PO Number',
  'PO Date',
  'Vendor Code',
  'Vendor Name',
  'Line Item Description',
  'Specification',
  'Quantity',
  'UOM',
  'Spend',
  'Department',
  'Material Code',
  'Existing Category',
  'Subcategory',
  'Currency',
] as const;

/**
 * Parse and validate a historical PO dump.
 *
 * Line Item Description is required and never defaulted, because it is the
 * evidence the categoriser reads: a blank description contributes nothing but
 * still counts towards a supplier's PO history, which would inflate confidence in
 * a category derived from fewer real lines than the count suggests.
 */
export async function parsePoDumpFile(file: File): Promise<ParseIngestionFileResult<ParsedPoRow>> {
  const sheet = await readSheetRows(file);
  if (!sheet.success) {
    return { success: false, rows: [], blankRowCount: 0, missingColumns: [], error: sheet.error };
  }

  const headerKeys = Object.keys(sheet.rows[0]);
  const poNumberCol = findColumn(headerKeys, ['ponumber', 'po number', 'po no', 'po #', 'order number', 'order id']);
  const poDateCol = findColumn(headerKeys, ['podate', 'po date', 'date', 'order date', 'document date']);
  const vendorCodeCol = findColumn(headerKeys, ['vendorcode', 'vendor code', 'supplier code', 'vendor id']);
  const vendorNameCol = findColumn(headerKeys, ['vendorname', 'vendor name', 'vendor', 'supplier', 'supplier name', 'company name']);
  const gstinCol = findColumn(headerKeys, ['vendorgstin', 'gstin', 'gst', 'gst number', 'vendor gstin']);
  const descCol = findColumn(headerKeys, [
    'lineitemdescription',
    'line item description',
    'item description',
    'description',
    'item name',
    'material description',
    'item',
  ]);
  const specCol = findColumn(headerKeys, ['specification', 'specs', 'technical specs', 'spec', 'grade']);
  const qtyCol = findColumn(headerKeys, ['quantity', 'qty', 'ordered qty', 'order quantity']);
  const uomCol = findColumn(headerKeys, ['uom', 'unit', 'unit of measure', 'units']);
  const spendCol = findColumn(headerKeys, ['spend', 'amount', 'total spend', 'total amount', 'net value', 'po value', 'line total']);
  const deptCol = findColumn(headerKeys, ['department', 'dept', 'cost center', 'cost centre', 'division', 'plant']);
  const materialCol = findColumn(headerKeys, ['materialcode', 'material code', 'material', 'sku', 'part number']);
  const catCol = findColumn(headerKeys, ['existingcategory', 'existing category', 'category', 'major category']);
  const subCatCol = findColumn(headerKeys, ['subcategory', 'sub category', 'minor category']);
  const currencyCol = findColumn(headerKeys, ['currency', 'curr', 'currency code']);

  const missingColumns: string[] = [];
  if (!poNumberCol) missingColumns.push('PO Number');
  if (!poDateCol) missingColumns.push('PO Date');
  if (!descCol) missingColumns.push('Line Item Description');
  if (!qtyCol) missingColumns.push('Quantity');
  if (!uomCol) missingColumns.push('UOM');
  if (!spendCol) missingColumns.push('Spend / Amount');
  if (!deptCol) missingColumns.push('Department');
  if (!vendorCodeCol && !vendorNameCol) missingColumns.push('Vendor Code or Vendor Name');
  if (missingColumns.length > 0) {
    return {
      success: false,
      rows: [],
      blankRowCount: 0,
      missingColumns,
      error: formatString(UI_STRINGS.vendorPoIngestion.validation.missingColumnsTemplate, {
        columns: missingColumns.join(', '),
      }),
    };
  }

  const rows: ParsedPoRow[] = [];
  let blankRowCount = 0;

  sheet.rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(raw)) {
      blankRowCount += 1;
      return;
    }

    const poNumber = cellToString(raw[poNumberCol as string]);
    const poDate = cellToIsoDate(raw[poDateCol as string]);
    const vendorCode = vendorCodeCol ? cellToString(raw[vendorCodeCol]) : '';
    const vendorName = vendorNameCol ? cellToString(raw[vendorNameCol]) : '';
    const vendorGstin = gstinCol ? cellToString(raw[gstinCol]).toUpperCase() : '';
    const itemDescription = cellToString(raw[descCol as string]);
    const specification = specCol ? cellToString(raw[specCol]) : '';
    const quantity = cellToNumber(raw[qtyCol as string]);
    const uom = cellToString(raw[uomCol as string]);
    const spend = cellToNumber(raw[spendCol as string]);
    const department = cellToString(raw[deptCol as string]);
    const materialCode = materialCol ? cellToString(raw[materialCol]) : '';
    const existingCategory = catCol ? cellToString(raw[catCol]) : '';
    const existingSubcategory = subCatCol ? cellToString(raw[subCatCol]) : '';
    const currency = currencyCol ? cellToString(raw[currencyCol]) : '';

    const errors: string[] = [];
    if (poNumber === '') errors.push('PO Number is required.');
    if (poDate === null) {
      errors.push(
        `PO Date could not be read as a date${
          cellToString(raw[poDateCol as string]) !== ''
            ? ` ("${cellToString(raw[poDateCol as string])}" is ambiguous or invalid — use YYYY-MM-DD or a real date cell)`
            : ''
        }.`
      );
    }
    if (itemDescription === '') errors.push('Line Item Description is required — it is the evidence used to categorise the supplier.');
    else if (itemDescription.length < 2) errors.push('Line Item Description must be at least 2 characters.');
    if (quantity === null) errors.push('Quantity is required.');
    else if (quantity < 0) errors.push('Quantity cannot be negative.');
    if (uom === '') errors.push('UOM is required.');
    if (spend === null) errors.push('Spend / Amount is required.');
    else if (spend < 0) errors.push('Spend cannot be negative.');
    if (department === '') errors.push('Department is required.');
    if (vendorCode === '' && vendorName === '') {
      errors.push('Either a Vendor Code or a Vendor Name is required to attribute the line.');
    }
    if (vendorGstin !== '' && !GSTIN_PATTERN.test(vendorGstin)) errors.push('Vendor GSTIN format is invalid.');

    rows.push({
      rowNumber,
      line: {
        poNumber,
        poDate: poDate || '',
        vendorCode,
        vendorName,
        vendorGstin,
        itemDescription,
        specification,
        quantity: quantity === null ? 0 : quantity,
        uom,
        spend: spend === null ? 0 : spend,
        currency,
        department,
        materialCode,
        existingCategory,
        existingSubcategory,
      },
      isValid: errors.length === 0,
      errors,
    });
  });

  return { success: true, rows, blankRowCount, missingColumns: [] };
}

// ------------------------------------------------------------------------------
// TEMPLATES & ERROR REPORT
// ------------------------------------------------------------------------------

/** Trigger a browser download for a generated workbook. */
function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string): void {
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
 * Guard against spreadsheet formula injection in an exported cell.
 *
 * A value beginning =, +, - or @ is interpreted as a formula by Excel and Sheets,
 * so a supplier name of `=HYPERLINK(...)` in the buyer's own ERP export would
 * become a live formula in the error report they download. Prefixing an
 * apostrophe forces it back to text.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

export function downloadVendorMasterTemplate(): void {
  const example = {
    'Vendor Code': 'VND-1001',
    'Company Name': 'Apex Supplies Ltd.',
    'Contact Person': 'Rajesh Nair',
    Email: 'rajesh@apexsupplies.example',
    Phone: '9820144820',
    Address: 'MIDC Thane, Mumbai, MH',
    GSTIN: '27AAACL1234F1Z5',
    Rating: 95,
  };
  const worksheet = XLSX.utils.json_to_sheet([example], { header: [...VENDOR_MASTER_TEMPLATE_HEADERS] });
  downloadWorkbook(
    { Sheets: { 'Vendor Master': worksheet }, SheetNames: ['Vendor Master'] },
    'Procucev_Vendor_Master_Template.xlsx'
  );
}

export function downloadPoDumpTemplate(): void {
  const example = {
    'PO Number': 'PO-2025-00891',
    'PO Date': '2024-04-12',
    'Vendor Code': 'VND-1001',
    'Vendor Name': 'Apex Supplies Ltd.',
    'Line Item Description': 'Centrifugal Water Pump 500 GPM',
    Specification: '15 HP motor, cast iron casing',
    Quantity: 12,
    UOM: 'Nos',
    Spend: 150000,
    Department: 'Mechanical Maintenance',
    'Material Code': 'MAT-PUMP-500',
    'Existing Category': '',
    Subcategory: '',
    Currency: 'INR',
  };
  const worksheet = XLSX.utils.json_to_sheet([example], { header: [...PO_TEMPLATE_HEADERS] });
  downloadWorkbook(
    { Sheets: { 'PO Dump': worksheet }, SheetNames: ['PO Dump'] },
    'Procucev_PO_Purchase_Dump_Template.xlsx'
  );
}

/**
 * Download the rejected rows so the buyer can correct the source file.
 *
 * Every cell goes through sanitizeSpreadsheetCell, because the reasons quote
 * values that came from the buyer's own upload.
 */
export function downloadRejectedRowsReport(
  rejected: Array<{ rowNumber: number; errors: string[] }>,
  fileLabel: string
): void {
  const sheetRows = rejected.map((row) => ({
    Row: row.rowNumber,
    'Validation Errors': sanitizeSpreadsheetCell(row.errors.join(' ')),
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows, { header: ['Row', 'Validation Errors'] });
  downloadWorkbook(
    { Sheets: { 'Rejected Rows': worksheet }, SheetNames: ['Rejected Rows'] },
    `Procucev_${fileLabel}_Rejected_Rows.xlsx`
  );
}

// ------------------------------------------------------------------------------
// TRANSPORT
// ------------------------------------------------------------------------------

export type IngestionFailureReason = 'NETWORK' | 'UNAUTHORIZED' | 'VALIDATION' | 'CONFLICT' | 'SERVER';

export type IngestionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      reason: IngestionFailureReason;
      error: string;
      fieldErrors?: Record<string, string>;
      rejected?: Array<{ rowNumber: number; errors: string[] }>;
    };

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * One request, with the whole error ladder in one place.
 *
 * Never throws, mirroring rfqClient: a transport failure, an unparseable body, an
 * expired session and a business-rule conflict are all outcomes the caller
 * renders. 409 is mapped to its own CONFLICT reason because this module returns
 * it for the step-ordering rules ("upload the Vendor Master first"), which the UI
 * shows as guidance rather than as an error.
 */
async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<IngestionResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method || 'GET',
      headers: authHeaders(),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: {
    success?: boolean;
    data?: T;
    error?: string;
    fieldErrors?: Record<string, string> & { invalidRows?: Array<{ rowNumber: number; errors: string[] }> };
  } = {};
  try {
    body = await res.json();
  } catch {
    return {
      success: false,
      reason: 'NETWORK',
      error: `The server returned an unreadable response (status ${res.status}).`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: 'UNAUTHORIZED', error: body.error || UI_STRINGS.auth.sessionExpired };
  }
  if (!res.ok || !body.success) {
    const reason: IngestionFailureReason =
      res.status === 409 ? 'CONFLICT' : res.status === 400 || res.status === 422 || res.status === 413 ? 'VALIDATION' : 'SERVER';
    const invalidRows = body.fieldErrors && Array.isArray(body.fieldErrors.invalidRows) ? body.fieldErrors.invalidRows : undefined;
    return {
      success: false,
      reason,
      error: body.error || UI_STRINGS.vendorPoIngestion.errors.saveFailed,
      ...(body.fieldErrors ? { fieldErrors: body.fieldErrors as Record<string, string> } : {}),
      ...(invalidRows ? { rejected: invalidRows } : {}),
    };
  }
  if (body.data === undefined) {
    return { success: false, reason: 'SERVER', error: UI_STRINGS.vendorPoIngestion.errors.loadFailed };
  }
  return { success: true, data: body.data };
}

// ------------------------------------------------------------------------------
// SESSION
// ------------------------------------------------------------------------------

export interface TimeHorizonPayload {
  horizonType: VendorIngestionHorizonType;
  startDate?: string;
  endDate?: string;
}

export async function createIngestionSession(
  horizon: TimeHorizonPayload
): Promise<IngestionResult<VendorIngestionSession>> {
  return request<VendorIngestionSession>('/session', { method: 'POST', body: horizon });
}

/** The session to resume. `data.session` is null when there has never been one. */
export async function fetchIngestionSession(sessionId?: string): Promise<IngestionResult<VendorIngestionResumeState>> {
  const path = sessionId ? `/session/${encodeURIComponent(sessionId)}` : '/session';
  return request<VendorIngestionResumeState>(path);
}

export async function updateTimeHorizon(
  sessionId: string,
  horizon: TimeHorizonPayload
): Promise<IngestionResult<VendorIngestionSession>> {
  return request<VendorIngestionSession>(`/session/${encodeURIComponent(sessionId)}/time-horizon`, {
    method: 'PUT',
    body: horizon,
  });
}

export async function fetchCategoryMaster(): Promise<IngestionResult<VendorIngestionCategoryMaster>> {
  return request<VendorIngestionCategoryMaster>('/categories');
}

// ------------------------------------------------------------------------------
// CHUNKED UPLOADS
// ------------------------------------------------------------------------------

/**
 * Upload only the valid rows, in bounded chunks.
 *
 * Never one request per row and never the whole file in one request. `replaceExisting`
 * is set on the FIRST chunk only — so a re-upload replaces the previous file
 * rather than merging with it, while later chunks append to the run just started.
 *
 * `onProgress` fires after each chunk so a large file shows a running count. A
 * chunk that fails aborts the upload and returns its error: continuing would
 * leave a half-stored file that the buyer would read as complete.
 */
export async function uploadVendorMasterRows(
  sessionId: string,
  rows: ParsedVendorMasterRow[],
  fileName: string,
  onProgress?: (progress: IngestionUploadProgress) => void
): Promise<IngestionResult<VendorMasterUploadResult>> {
  const valid = rows.filter((row) => row.isValid);
  if (valid.length === 0) {
    return {
      success: false,
      reason: 'VALIDATION',
      error: 'No valid vendor rows to upload. Fix the reported rows and try again.',
      rejected: rows.filter((r) => !r.isValid).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    };
  }

  const totalChunks = Math.ceil(valid.length / UPLOAD_CHUNK_SIZE);
  let last: VendorMasterUploadResult | null = null;
  const aggregateRejected: Array<{ rowNumber: number; errors: string[] }> = rows
    .filter((r) => !r.isValid)
    .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));
  let rowsStored = 0;

  for (let i = 0; i < valid.length; i += UPLOAD_CHUNK_SIZE) {
    const chunkIndex = i / UPLOAD_CHUNK_SIZE;
    const chunk = valid.slice(i, i + UPLOAD_CHUNK_SIZE);
    const result = await request<VendorMasterUploadResult>(
      `/${encodeURIComponent(sessionId)}/vendor-master/upload`,
      {
        method: 'POST',
        body: {
          fileName,
          replaceExisting: chunkIndex === 0,
          rows: chunk.map((row) => ({ rowNumber: row.rowNumber, ...row.vendor })),
        },
      }
    );
    if (!result.success) return result;

    last = result.data;
    rowsStored += result.data.storedRows;
    aggregateRejected.push(...result.data.rejected);
    onProgress?.({
      chunksSent: chunkIndex + 1,
      totalChunks,
      rowsSubmitted: Math.min(i + UPLOAD_CHUNK_SIZE, valid.length),
      rowsStored,
      rowsRejected: aggregateRejected.length,
    });
  }

  if (!last) {
    return { success: false, reason: 'SERVER', error: UI_STRINGS.vendorPoIngestion.errors.uploadFailed };
  }
  // De-duplicate: a server-rejected row can also appear in the client's own list.
  const seen = new Set<number>();
  const rejected = aggregateRejected.filter((row) => {
    if (seen.has(row.rowNumber)) return false;
    seen.add(row.rowNumber);
    return true;
  });
  return {
    success: true,
    data: { ...last, totalRows: rows.length, storedRows: rowsStored, invalidRows: rejected.length, rejected },
  };
}

export async function uploadPoDumpRows(
  sessionId: string,
  rows: ParsedPoRow[],
  fileName: string,
  onProgress?: (progress: IngestionUploadProgress) => void
): Promise<IngestionResult<PoDumpUploadResult>> {
  const valid = rows.filter((row) => row.isValid);
  if (valid.length === 0) {
    return {
      success: false,
      reason: 'VALIDATION',
      error: 'No valid PO rows to upload. Fix the reported rows and try again.',
      rejected: rows.filter((r) => !r.isValid).map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    };
  }

  const totalChunks = Math.ceil(valid.length / UPLOAD_CHUNK_SIZE);
  let last: PoDumpUploadResult | null = null;
  const aggregateRejected: Array<{ rowNumber: number; errors: string[] }> = rows
    .filter((r) => !r.isValid)
    .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));

  for (let i = 0; i < valid.length; i += UPLOAD_CHUNK_SIZE) {
    const chunkIndex = i / UPLOAD_CHUNK_SIZE;
    const chunk = valid.slice(i, i + UPLOAD_CHUNK_SIZE);
    const result = await request<PoDumpUploadResult>(`/${encodeURIComponent(sessionId)}/po-dump/upload`, {
      method: 'POST',
      body: {
        fileName,
        replaceExisting: chunkIndex === 0,
        rows: chunk.map((row) => ({ rowNumber: row.rowNumber, ...row.line })),
      },
    });
    if (!result.success) return result;

    last = result.data;
    aggregateRejected.push(...result.data.rejected);
    onProgress?.({
      chunksSent: chunkIndex + 1,
      totalChunks,
      rowsSubmitted: Math.min(i + UPLOAD_CHUNK_SIZE, valid.length),
      rowsStored: result.data.totalStored,
      rowsRejected: aggregateRejected.length,
    });
  }

  if (!last) {
    return { success: false, reason: 'SERVER', error: UI_STRINGS.vendorPoIngestion.errors.uploadFailed };
  }
  const seen = new Set<number>();
  const rejected = aggregateRejected.filter((row) => {
    if (seen.has(row.rowNumber)) return false;
    seen.add(row.rowNumber);
    return true;
  });
  return {
    success: true,
    data: { ...last, totalRows: rows.length, invalidRows: rejected.length, rejected },
  };
}

export async function fetchVendorMasterPreview(
  sessionId: string
): Promise<IngestionResult<{ records: VendorIngestionMasterRecord[]; total: number }>> {
  return request<{ records: VendorIngestionMasterRecord[]; total: number }>(
    `/${encodeURIComponent(sessionId)}/vendor-master/preview`
  );
}

// ------------------------------------------------------------------------------
// JOIN, AI, REVIEW
// ------------------------------------------------------------------------------

export async function runVendorPoJoin(sessionId: string): Promise<IngestionResult<VendorPoJoinResult>> {
  return request<VendorPoJoinResult>(`/${encodeURIComponent(sessionId)}/join`, { method: 'POST' });
}

/** One AI batch. Poll until `done`. */
export async function runCategorizationBatch(
  sessionId: string,
  batchSize?: number
): Promise<IngestionResult<VendorCategorizationBatchResult>> {
  return request<VendorCategorizationBatchResult>(`/${encodeURIComponent(sessionId)}/ai-categorize`, {
    method: 'POST',
    body: batchSize ? { batchSize } : {},
  });
}

export interface MappingFilters {
  status?: string;
  confidence?: string;
  hasPoHistory?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function fetchMappedVendors(
  sessionId: string,
  filters: MappingFilters = {}
): Promise<IngestionResult<VendorMappingListResult>> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return request<VendorMappingListResult>(
    `/${encodeURIComponent(sessionId)}/vendors${query ? `?${query}` : ''}`
  );
}

export async function reviewVendorCategory(
  sessionId: string,
  vendorRecordId: string,
  payload: { action: VendorCategoryReviewAction; majorCategory?: string; minorCategories?: string[] }
): Promise<IngestionResult<VendorCategoryMapping>> {
  return request<VendorCategoryMapping>(
    `/${encodeURIComponent(sessionId)}/vendors/${encodeURIComponent(vendorRecordId)}/category`,
    { method: 'PUT', body: payload }
  );
}

export async function reRunVendorAi(
  sessionId: string,
  vendorRecordId: string
): Promise<IngestionResult<VendorCategoryMapping>> {
  return request<VendorCategoryMapping>(
    `/${encodeURIComponent(sessionId)}/vendors/${encodeURIComponent(vendorRecordId)}/re-run-ai`,
    { method: 'POST' }
  );
}

export async function fetchCategorySegmentation(
  sessionId: string
): Promise<IngestionResult<VendorCategorySegmentation>> {
  return request<VendorCategorySegmentation>(`/${encodeURIComponent(sessionId)}/segmentation`);
}

// ------------------------------------------------------------------------------
// DISPATCH
// ------------------------------------------------------------------------------

export interface DispatchPayload {
  template: VendorDispatchTemplate;
  majorCategory?: string;
  vendorRecordIds?: string[];
}

export async function previewDispatch(
  sessionId: string,
  payload: DispatchPayload
): Promise<IngestionResult<VendorDispatchPreview>> {
  return request<VendorDispatchPreview>(`/${encodeURIComponent(sessionId)}/dispatch/preview`, {
    method: 'POST',
    body: payload,
  });
}

export async function sendDispatch(
  sessionId: string,
  payload: DispatchPayload
): Promise<IngestionResult<VendorDispatchSendResult>> {
  return request<VendorDispatchSendResult>(`/${encodeURIComponent(sessionId)}/dispatch/send`, {
    method: 'POST',
    body: payload,
  });
}

export async function retryFailedDispatch(
  sessionId: string
): Promise<IngestionResult<VendorDispatchRetryResult>> {
  return request<VendorDispatchRetryResult>(`/${encodeURIComponent(sessionId)}/dispatch/retry`, { method: 'POST' });
}

export async function fetchDispatchStatus(
  sessionId: string,
  filters: { status?: string; limit?: number } = {}
): Promise<IngestionResult<VendorDispatchStatusResult>> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return request<VendorDispatchStatusResult>(
    `/${encodeURIComponent(sessionId)}/dispatch/status${query ? `?${query}` : ''}`
  );
}

// ------------------------------------------------------------------------------
// AUDIT & CROSS-SESSION READS
// ------------------------------------------------------------------------------

export async function fetchIngestionAudit(
  filters: { sessionId?: string; limit?: number; offset?: number } = {}
): Promise<IngestionResult<{ entries: VendorIngestionAuditEntry[]; total: number }>> {
  const params = new URLSearchParams();
  if (filters.sessionId) params.set('sessionId', filters.sessionId);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const query = params.toString();
  return request<{ entries: VendorIngestionAuditEntry[]; total: number }>(`/audit${query ? `?${query}` : ''}`);
}

export async function fetchAiClassificationLogs(
  sessionId: string,
  limit?: number
): Promise<IngestionResult<{ logs: VendorAiClassificationLogEntry[]; total: number }>> {
  const query = limit ? `?limit=${limit}` : '';
  return request<{ logs: VendorAiClassificationLogEntry[]; total: number }>(
    `/${encodeURIComponent(sessionId)}/ai-logs${query}`
  );
}

/**
 * Approved mappings across every session.
 *
 * Read by the Vendor Summary screen so it can show the category a supplier is
 * genuinely empanelled under, with the confidence and the reason behind it.
 */
export async function fetchApprovedMappings(): Promise<
  IngestionResult<{ mappings: ApprovedVendorMapping[]; total: number }>
> {
  return request<{ mappings: ApprovedVendorMapping[]; total: number }>('/approved-mappings');
}

// ------------------------------------------------------------------------------
// PRESENTATION HELPERS
// ------------------------------------------------------------------------------

/** Render an ISO date as 01-Apr-2024, the format the period display uses. */
export function formatHorizonDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${match[3]}-${months[Number(match[2]) - 1]}-${match[1]}`;
}

/** The band label for a confidence score, or the "unstated" copy when null. */
export function confidenceLabel(confidence: number | null | undefined): string {
  const AI = UI_STRINGS.vendorPoIngestion.ai;
  if (confidence === null || confidence === undefined) return AI.confidenceUnstated;
  if (confidence >= 90) return AI.confidenceHigh;
  if (confidence >= 70) return AI.confidenceMedium;
  return AI.confidenceNeedsReview;
}

/**
 * Generate and download a CSV error report for rejected rows.
 */
export function downloadErrorReport(
  rejected: Array<{ rowNumber: number; errors: string[] }>,
  fileName: string = 'validation_errors.csv'
): void {
  if (typeof window === 'undefined' || !rejected || rejected.length === 0) return;
  const rows = [
    ['Row Number', 'Errors'],
    ...rejected.map((r) => [String(r.rowNumber), r.errors.join('; ')]),
  ];
  const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ------------------------------------------------------------------------------
// CONVENIENT FUNCTION ALIASES
// ------------------------------------------------------------------------------

export const createSession = createIngestionSession;
export const resumeSession = fetchIngestionSession;
export const uploadVendorMaster = uploadVendorMasterRows;
export const uploadPoDump = uploadPoDumpRows;
export const runJoin = runVendorPoJoin;
export const runAiCategorization = runCategorizationBatch;
export const reRunAiCategorization = reRunVendorAi;
export const listCategoryMappings = fetchMappedVendors;
export const getVendorSegmentation = fetchCategorySegmentation;
export const listIngestionCategoryMaster = fetchCategoryMaster;
export const retryDispatch = retryFailedDispatch;
export const getDispatchStatus = fetchDispatchStatus;
export const getAuditLog = fetchIngestionAudit;
export const getAiLogs = fetchAiClassificationLogs;
export const getApprovedMappings = fetchApprovedMappings;

