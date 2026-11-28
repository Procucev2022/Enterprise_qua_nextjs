import * as XLSX from 'xlsx';
import { authClient } from './authClient';
import { isPlaceholderVendorCategory, normalizePoDate, normalizeVendorCategoryList } from './constants';
import { formatString, UI_STRINGS } from './uiStrings';
import { EMAIL_PATTERN, GSTIN_PATTERN, INDIAN_MOBILE_PATTERN, INDIAN_PINCODE_PATTERN } from './validationSchemas';
import type {
  ExistingPoDedupeCandidate,
  ExistingVendorDedupeCandidate,
  IngestionJobState,
  PoDuplicatePartitionCandidate,
  PoDuplicatePartitionResult,
  PurchaseOrderLineItemRecord,
  SkippedDuplicatePoRecord,
  SkippedDuplicateVendorRecord,
  VendorBulkInvitationResponse,
  VendorDedupeSummary,
  VendorDuplicatePartitionCandidate,
  VendorDuplicatePartitionResult,
  VendorMasterUploadRecord,
  VendorUploadImportResponse,
  VendorUploadRow,
  VendorUploadRowResult,
} from './types';

/**
 * Category manager vendor bulk upload — parsing, validation, template
 * generation, and chunked import against POST /api/vendors/bulk-import.
 *
 * Mirrors the real p2pservices Vendor Master sheet columns (verified against
 * both the Java backend's Apache POI row reader and a real sample export):
 * Company Name, Person Name, Email Id, Mobile No, GSTIN, Pin Code, City,
 * State, Cate-1..5, Products. The old system's own bulk path only ever
 * required company name, email and mobile — everything else here is
 * format-checked only when the row actually supplies it, matching that.
 */

export const VENDOR_TEMPLATE_HEADERS = [
  'Vendor Code',
  'Company Name',
  'Person Name',
  'Email Id',
  'Mobile No',
  'GSTIN',
  'Pin Code',
  'City',
  'State',
  'Category',
  'Products',
] as const;

const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx'];

export function isAllowedVendorUploadFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
}

// A vendor master file this large risks freezing the tab while XLSX parses
// it in the main thread — reject it client-side with a clear reason rather
// than letting the browser hang with no explanation.
export const MAX_VENDOR_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10MB

/** Matches a header cell against any of several acceptable spellings, tolerant of case/spacing/punctuation. */
function findColumn(headerKeys: string[], candidates: string[]): string | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedCandidates = candidates.map(normalize);
  return headerKeys.find((k) => normalizedCandidates.includes(normalize(k)));
}

function cellToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export interface ParsedVendorFile {
  rows: VendorUploadRow[];
  /** Rows that were entirely blank (every cell empty) — skipped, not counted as errors. */
  blankRowCount: number;
}

export type ParseVendorFileResult = { success: true; data: ParsedVendorFile } | { success: false; error: string };

/**
 * Reads a .xlsx File in the browser, maps its columns onto the vendor
 * shape, and validates every row. Nothing is fabricated for a missing
 * field — a row missing a required value is reported invalid, never
 * silently defaulted (see initial-setup-modal.tsx's Vendor Master upload
 * for the pattern this deliberately does NOT repeat).
 */
export function parseVendorUploadFile(
  file: File,
  options?: { requireCategory?: boolean; existingVendors?: ExistingVendorDedupeCandidate[] }
): Promise<ParseVendorFileResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          resolve({ success: false, error: 'The uploaded file has no sheets.' });
          return;
        }
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rawRows || rawRows.length === 0) {
          resolve({ success: false, error: 'The uploaded file has no readable data rows.' });
          return;
        }

        const headerKeys = Object.keys(rawRows[0]);
        const duplicateHeaderCheck = new Set<string>();
        const normalizedHeaders = headerKeys.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
        const hasDuplicateHeaders = normalizedHeaders.some((h) => {
          if (duplicateHeaderCheck.has(h)) return true;
          duplicateHeaderCheck.add(h);
          return false;
        });
        if (hasDuplicateHeaders) {
          resolve({ success: false, error: 'The file has duplicate column headers — each column must be unique.' });
          return;
        }

        const codeCol = findColumn(headerKeys, ['vendorcode', 'vendor code', 'vendor_code', 'code', 'vendor id']);
        const nameCol = findColumn(headerKeys, ['companyname', 'company name', 'vendor name', 'name']);
        const contactCol = findColumn(headerKeys, ['personname', 'person name', 'contactperson', 'contact person']);
        const emailCol = findColumn(headerKeys, ['emailid', 'email id', 'email']);
        const phoneCol = findColumn(headerKeys, ['mobileno', 'mobile no', 'mobile', 'phone', 'phone number', 'phonenumber']);
        const gstinCol = findColumn(headerKeys, ['gstin']);
        const pincodeCol = findColumn(headerKeys, ['pincode', 'pin code']);
        const cityCol = findColumn(headerKeys, ['city']);
        const stateCol = findColumn(headerKeys, ['state']);
        const productsCol = findColumn(headerKeys, ['products']);
        // Category may be one combined column (including the marketplace
        // scrape's misspelled "Categorys") or the sheet's real Cate-1..5 spread.
        const categoryCols = headerKeys.filter(
          (k) => /^cate\s*-?\s*[1-5]$/i.test(k.trim()) || /^categor(y|ys|ies)$/i.test(k.trim())
        );

        if (!nameCol && !emailCol && !phoneCol) {
          resolve({
            success: false,
            error: 'Could not find Company Name, Email Id or Mobile No columns — check the file matches the Vendor Master Template.',
          });
          return;
        }

        const dedupeChecker = createVendorDedupeChecker(options?.existingVendors || []);
        const rows: VendorUploadRow[] = [];
        let blankRowCount = 0;

        rawRows.forEach((raw, idx) => {
          const rowNumber = idx + 2; // header is row 1
          const allValues = Object.values(raw).map(cellToString);
          if (allValues.every((v) => v === '')) {
            blankRowCount += 1;
            return;
          }

          const vendorCode = codeCol ? cellToString(raw[codeCol]) : '';
          const name = nameCol ? cellToString(raw[nameCol]) : '';
          const contactPerson = contactCol ? cellToString(raw[contactCol]) : '';
          const email = emailCol ? cellToString(raw[emailCol]).toLowerCase() : '';
          const phone = phoneCol ? cellToString(raw[phoneCol]) : '';
          const gstin = gstinCol ? cellToString(raw[gstinCol]).toUpperCase() : '';
          const pincode = pincodeCol ? cellToString(raw[pincodeCol]) : '';
          const city = cityCol ? cellToString(raw[cityCol]) : '';
          const state = stateCol ? cellToString(raw[stateCol]) : '';
          const products = productsCol ? cellToString(raw[productsCol]) : '';
          const extractedCategories = normalizeVendorCategoryList(categoryCols.map((c) => cellToString(raw[c])));
          const majorCategory =
            extractedCategories[0] && !isPlaceholderVendorCategory(extractedCategories[0]) ? extractedCategories[0] : '';
          const minorCategories = extractedCategories;

          const errors: string[] = [];
          if (!name) errors.push('Company name is required.');
          if (options?.requireCategory && !majorCategory && minorCategories.length === 0) {
            errors.push('Category is required — a vendor cannot exist without a category.');
          }
          // A row with no email is not rejected — it still uploads with a
          // null email (never fabricated) and is flagged via `missingEmail`
          // instead, so a large marketplace-directory import doesn't drop or
          // invent contact data for the many real rows that genuinely have
          // none. A row that DOES supply an email is still format-checked.
          const missingEmail = !email;
          if (email && !EMAIL_PATTERN.test(email)) errors.push('Email is not a valid email address.');
          if (!phone) errors.push('Mobile number is required.');
          else if (!INDIAN_MOBILE_PATTERN.test(phone)) errors.push('Mobile number must be a valid 10-digit Indian number.');
          if (gstin && !GSTIN_PATTERN.test(gstin)) errors.push('GSTIN format is invalid.');
          if (pincode && !INDIAN_PINCODE_PATTERN.test(pincode)) errors.push('PIN code must be 6 digits and not start with 0.');

          const duplicateMatch = dedupeChecker.checkAndRegister({
            rowNumber,
            explicitVendorCode: vendorCode,
            companyName: name,
            email,
            phone,
            gstNumber: gstin,
          });
          if (duplicateMatch) {
            if (duplicateMatch.field === 'code') {
              errors.push(`Duplicate Vendor Code "${vendorCode}" — ${duplicateMatch.reason}`);
            } else if (duplicateMatch.field === 'email') {
              errors.push(`Duplicate email — ${duplicateMatch.reason}`);
            } else {
              errors.push(duplicateMatch.reason);
            }
          }

          rows.push({
            rowNumber,
            vendor: {
              vendorCode,
              name,
              email,
              phone,
              contactPerson,
              gstin,
              city,
              state,
              pincode,
              majorCategory,
              ...(minorCategories.length > 0 ? { minorCategories } : {}),
              products,
            },
            isValid: errors.length === 0,
            errors,
            ...(duplicateMatch
              ? {
                  isDuplicate: true,
                  matchedAgainst: duplicateMatch.matchedAgainst,
                  duplicateReason: duplicateMatch.reason,
                }
              : {}),
            missingEmail,
          });
        });

        resolve({ success: true, data: { rows, blankRowCount } });
      } catch (err: unknown) {
        resolve({ success: false, error: err instanceof Error ? err.message : 'Could not parse the file — is it a valid .xlsx workbook?' });
      }
    };

    reader.onerror = () => resolve({ success: false, error: 'Failed to read the file from disk.' });
    reader.readAsArrayBuffer(file);
  });
}

/** Builds and downloads a Vendor Master template that contains only the column headers. No sample rows. */
export function downloadVendorUploadTemplate(): void {
  const worksheet = XLSX.utils.aoa_to_sheet([[...VENDOR_TEMPLATE_HEADERS]]);
  const workbook: XLSX.WorkBook = { Sheets: { 'Vendor Master': worksheet }, SheetNames: ['Vendor Master'] };
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Vendor_Master_Template.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Rows sent per bulk-import request, so no single request carries the whole file.
const BULK_IMPORT_CHUNK_SIZE = 15;

export async function sendBulkVendorInvitations(
  vendorIds: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<VendorBulkInvitationResponse> {
  const aggregate: VendorBulkInvitationResponse = {
    sentCount: 0,
    queuedCount: 0,
    failedCount: 0,
    results: [],
  };
  const uniqueIds = Array.from(new Set(vendorIds.map((id) => id.trim()).filter(Boolean)));

  for (let i = 0; i < uniqueIds.length; i += BULK_IMPORT_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + BULK_IMPORT_CHUNK_SIZE);
    let results: VendorBulkInvitationResponse['results'] = [];
    const token = authClient.getToken();
    try {
      const response = await fetch('/api/vendors/bulk-import/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: chunk }),
      });
      let body: { success?: boolean; data?: VendorBulkInvitationResponse } = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      if (!response.ok || !body.success || !body.data) {
        results = chunk.map((vendorId) => ({ vendorId, status: 'failed' }));
      } else {
        const resultsByVendorId = new Map<string, VendorBulkInvitationResponse['results'][number]>(
          (Array.isArray(body.data.results) ? body.data.results : [])
            .map((result) => [result.vendorId, result] as const)
        );
        results = chunk.map((vendorId) => resultsByVendorId.get(vendorId) || ({ vendorId, status: 'failed' }));
      }
    } catch {
      results = chunk.map((vendorId) => ({ vendorId, status: 'failed' }));
    }

    aggregate.results.push(...results);
    aggregate.sentCount = aggregate.results.filter((result) => result.status === 'sent' || result.status === 'already_sent').length;
    aggregate.queuedCount = aggregate.results.filter((result) => result.status === 'queued').length;
    aggregate.failedCount = aggregate.results.length - aggregate.sentCount - aggregate.queuedCount;
    onProgress?.(Math.min(i + chunk.length, uniqueIds.length), uniqueIds.length);
  }

  return aggregate;
}

/**
 * Sends only the already-valid rows to the backend, in bounded chunks —
 * never one request per vendor, never the whole file in a single request.
 * `onProgress` fires after each chunk so the caller can show a running
 * imported/missing-email/duplicate/failed count while a large upload is
 * still in flight.
 *
 * `resumeSessionId` lets a later call (e.g. after a page reload) attach to
 * an upload run already in progress on the server, so a dropped
 * connection/tab doesn't lose the running totals a very large upload has
 * already accumulated.
 */
export async function bulkImportVendorRows(
  validRows: VendorUploadRow[],
  onProgress?: (soFar: VendorUploadImportResponse) => void,
  resumeSessionId?: string
): Promise<VendorUploadImportResponse> {
  const token = authClient.getToken();
  const aggregate: VendorUploadImportResponse = {
    sessionId: resumeSessionId,
    total: 0,
    imported: 0,
    missingEmail: 0,
    duplicates: 0,
    failed: 0,
    onboardingFailed: 0,
    onboardingSkipped: 0,
    results: [],
  };

  for (let i = 0; i < validRows.length; i += BULK_IMPORT_CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + BULK_IMPORT_CHUNK_SIZE);
    const payload = chunk.map((r) => ({ rowNumber: r.rowNumber, ...r.vendor, email: r.vendor.email || undefined }));

    let res: Response;
    try {
      res = await fetch('/api/vendors/bulk-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          vendors: payload,
          sessionId: aggregate.sessionId,
          totalRowsDeclared: validRows.length,
        }),
      });
    } catch {
      const results: VendorUploadRowResult[] = chunk.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'failed',
        errors: ['Network error — could not reach the server.'],
      }));
      aggregate.total += chunk.length;
      aggregate.failed += chunk.length;
      aggregate.results.push(...results);
      onProgress?.({ ...aggregate });
      continue;
    }

    let body: { success?: boolean; data?: VendorUploadImportResponse; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (!res.ok || !body.success || !body.data) {
      const results: VendorUploadRowResult[] = chunk.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'failed',
        errors: [body.error || `Server error (${res.status}).`],
      }));
      aggregate.total += chunk.length;
      aggregate.failed += chunk.length;
      aggregate.results.push(...results);
    } else {
      aggregate.sessionId = body.data.sessionId || aggregate.sessionId;
      aggregate.total += body.data.total;
      aggregate.imported += body.data.imported;
      aggregate.missingEmail += body.data.missingEmail || 0;
      aggregate.duplicates += body.data.duplicates;
      aggregate.failed += body.data.failed;
      aggregate.onboardingFailed = (aggregate.onboardingFailed || 0) + (body.data.onboardingFailed || 0);
      aggregate.onboardingSkipped = (aggregate.onboardingSkipped || 0) + (body.data.onboardingSkipped || 0);
      aggregate.results.push(...body.data.results);
    }

    onProgress?.({ ...aggregate });
  }

  return aggregate;
}

const PLACEHOLDER_GSTIN_VALUES = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', '-', '—', 'NOTPROVIDED', 'NOTAPPLICABLE']);

function normalizeDedupeEmail(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : '';
}

function normalizeDedupeGstin(raw: string | null | undefined): string {
  const cleaned = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned || PLACEHOLDER_GSTIN_VALUES.has(cleaned)) return '';
  return cleaned.length >= 5 ? cleaned : '';
}

function normalizeDedupeCode(raw: string | null | undefined): string {
  return String(raw || '').trim().toLowerCase();
}

function normalizeDedupeCompanyPhone(
  companyName: string | null | undefined,
  phone: string | null | undefined
): string | null {
  const normalizedCompany = String(companyName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const digits = String(phone || '').replace(/\D/g, '');
  const normalizedPhone = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!normalizedCompany || normalizedPhone.length < 7) return null;
  return `${normalizedCompany}|${normalizedPhone}`;
}

/**
 * Partition parsed Vendor Master rows into unique records to import and duplicate
 * records to skip and display to the buyer.
 *
 * Detects duplicates both against existing Buyer Directory vendors and earlier rows
 * within the uploaded file by email, GSTIN, explicit vendor code, or normalized
 * (companyName + phone).
 */
interface VendorDedupeMatch {
  field: 'email' | 'gstin' | 'code' | 'company_phone';
  reason: string;
  matchedAgainst: 'FILE' | 'EXISTING_VENDOR';
}

/**
 * Stateful duplicate detector shared between Vendor Master Setup and Bulk Vendor Upload.
 * Checks normalized email, GSTIN, explicit vendor code, and (companyName + phone)
 * against pre-existing Buyer Directory vendors and earlier rows within the file.
 */
function createVendorDedupeChecker(existingVendors: ExistingVendorDedupeCandidate[] = []) {
  const existingEmails = new Set<string>();
  const existingGstins = new Set<string>();
  const existingCodes = new Set<string>();
  const existingCompanyPhones = new Set<string>();

  for (const existing of existingVendors) {
    const emailKey = normalizeDedupeEmail(existing.email);
    if (emailKey) existingEmails.add(emailKey);

    const gstinKey = normalizeDedupeGstin(existing.gstNumber ?? existing.gstin);
    if (gstinKey) existingGstins.add(gstinKey);

    const codeKey = normalizeDedupeCode(existing.vendorCode);
    // Avoid colliding auto-numbered codes (1, 2, 3...) across separate uploads.
    if (codeKey && !/^\d+$/.test(codeKey)) existingCodes.add(codeKey);

    const companyPhoneKey = normalizeDedupeCompanyPhone(existing.companyName ?? existing.name, existing.phone);
    if (companyPhoneKey) existingCompanyPhones.add(companyPhoneKey);
  }

  const fileEmails = new Map<string, number>();
  const fileGstins = new Map<string, number>();
  const fileCodes = new Map<string, number>();
  const fileCompanyPhones = new Map<string, number>();
  const vmStrings = UI_STRINGS.vendorPoIngestion.vendorMaster;

  const checkAndRegister = (input: {
    rowNumber: number;
    explicitVendorCode?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    gstNumber?: string;
  }): VendorDedupeMatch | null => {
    const rawEmail = String(input.email || '').trim();
    const rawCode = String(input.explicitVendorCode || '').trim();
    const rawCompany = String(input.companyName || '').trim();
    const rawPhone = String(input.phone || '').trim();

    const emailKey = normalizeDedupeEmail(rawEmail);
    const gstinKey = normalizeDedupeGstin(input.gstNumber);
    const codeKey = normalizeDedupeCode(rawCode);
    const companyPhoneKey = normalizeDedupeCompanyPhone(rawCompany, rawPhone);

    if (emailKey) {
      if (existingEmails.has(emailKey)) {
        return {
          field: 'email',
          reason: formatString(vmStrings.duplicateReasonEmailExisting, { value: rawEmail }),
          matchedAgainst: 'EXISTING_VENDOR',
        };
      }
      const firstRow = fileEmails.get(emailKey);
      if (firstRow !== undefined) {
        return {
          field: 'email',
          reason: formatString(vmStrings.duplicateReasonEmailFile, { value: rawEmail, firstRow }),
          matchedAgainst: 'FILE',
        };
      }
    }

    if (gstinKey) {
      if (existingGstins.has(gstinKey)) {
        return {
          field: 'gstin',
          reason: formatString(vmStrings.duplicateReasonGstinExisting, { value: gstinKey }),
          matchedAgainst: 'EXISTING_VENDOR',
        };
      }
      const firstRow = fileGstins.get(gstinKey);
      if (firstRow !== undefined) {
        return {
          field: 'gstin',
          reason: formatString(vmStrings.duplicateReasonGstinFile, { value: gstinKey, firstRow }),
          matchedAgainst: 'FILE',
        };
      }
    }

    if (codeKey) {
      if (!/^\d+$/.test(codeKey) && existingCodes.has(codeKey)) {
        return {
          field: 'code',
          reason: formatString(vmStrings.duplicateReasonCodeExisting, { value: rawCode }),
          matchedAgainst: 'EXISTING_VENDOR',
        };
      }
      const firstRow = fileCodes.get(codeKey);
      if (firstRow !== undefined) {
        return {
          field: 'code',
          reason: formatString(vmStrings.duplicateReasonCodeFile, { value: rawCode, firstRow }),
          matchedAgainst: 'FILE',
        };
      }
    }

    if (companyPhoneKey) {
      if (existingCompanyPhones.has(companyPhoneKey)) {
        return {
          field: 'company_phone',
          reason: formatString(vmStrings.duplicateReasonCompanyPhoneExisting, {
            company: rawCompany,
            phone: rawPhone,
          }),
          matchedAgainst: 'EXISTING_VENDOR',
        };
      }
      const firstRow = fileCompanyPhones.get(companyPhoneKey);
      if (firstRow !== undefined) {
        return {
          field: 'company_phone',
          reason: formatString(vmStrings.duplicateReasonCompanyPhoneFile, {
            company: rawCompany,
            phone: rawPhone,
            firstRow,
          }),
          matchedAgainst: 'FILE',
        };
      }
    }

    if (emailKey) fileEmails.set(emailKey, input.rowNumber);
    if (gstinKey) fileGstins.set(gstinKey, input.rowNumber);
    if (codeKey) fileCodes.set(codeKey, input.rowNumber);
    if (companyPhoneKey) fileCompanyPhones.set(companyPhoneKey, input.rowNumber);
    return null;
  };

  return { checkAndRegister };
}

export function partitionDuplicateVendorMasterRows(
  candidates: VendorDuplicatePartitionCandidate[],
  existingVendors: ExistingVendorDedupeCandidate[] = []
): VendorDuplicatePartitionResult {
  const dedupeChecker = createVendorDedupeChecker(existingVendors);
  const uniqueRecords: VendorMasterUploadRecord[] = [];
  const skippedDuplicates: SkippedDuplicateVendorRecord[] = [];

  for (const candidate of candidates) {
    const match = dedupeChecker.checkAndRegister({
      rowNumber: candidate.rowNumber,
      explicitVendorCode: candidate.explicitVendorCode,
      companyName: candidate.vendor.companyName,
      email: candidate.vendor.email,
      phone: candidate.vendor.phone,
      gstNumber: candidate.vendor.gstNumber,
    });
    if (match) {
      skippedDuplicates.push({
        rowNumber: candidate.rowNumber,
        vendorCode: candidate.vendor.vendorCode,
        companyName: candidate.vendor.companyName,
        email: candidate.vendor.email,
        phone: candidate.vendor.phone,
        gstNumber: candidate.vendor.gstNumber,
        reason: match.reason,
        matchedAgainst: match.matchedAgainst,
      });
      continue;
    }

    uniqueRecords.push(candidate.vendor);
  }

  return { uniqueRecords, skippedDuplicates };
}

/** Extract structured skipped-duplicate rows from a backend ingestion job's errorDetails array. */
export function extractSkippedDuplicatesFromJob(job: IngestionJobState): SkippedDuplicateVendorRecord[] {
  const details = Array.isArray(job.errorDetails) ? job.errorDetails : [];
  const vmStrings = UI_STRINGS.vendorPoIngestion.vendorMaster;
  return details
    .filter(
      (item) =>
        Boolean(item) &&
        (item.status === 'duplicate_skipped' ||
          item.matchedAgainst === 'FILE' ||
          item.matchedAgainst === 'EXISTING_VENDOR')
    )
    .map((item) => ({
      rowNumber: Number(item.rowNumber) || 0,
      vendorCode: item.vendorCode || undefined,
      companyName: item.companyName || item.vendorName || '—',
      email: item.email || '—',
      phone: item.phone,
      gstNumber: item.gstNumber,
      reason: item.reason || vmStrings.duplicatesSkippedBannerHint,
      matchedAgainst: item.matchedAgainst === 'EXISTING_VENDOR' ? 'EXISTING_VENDOR' : 'FILE',
    }));
}

/** Trigger a browser CSV download listing skipped duplicate vendor rows and reasons. */
export function downloadSkippedDuplicatesCsv(
  records: SkippedDuplicateVendorRecord[],
  fileName = 'skipped_duplicate_vendors.csv'
): void {
  if (typeof window === 'undefined' || records.length === 0) return;
  const escapeCsvCell = (value: unknown) => {
    const raw = String(value ?? '');
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const header = ['Row Number', 'Vendor Code', 'Company Name', 'Email', 'Phone', 'GSTIN', 'Match Type', 'Skip Reason'];
  const lines = [
    header.map(escapeCsvCell).join(','),
    ...records.map((rec) =>
      [
        rec.rowNumber || '',
        rec.vendorCode || '',
        rec.companyName || '',
        rec.email || '',
        rec.phone || '',
        rec.gstNumber || '',
        rec.matchedAgainst === 'EXISTING_VENDOR' ? 'Existing Buyer Directory' : 'Within Uploaded File',
        rec.reason || '',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Merge client-side Vendor Master duplicate exclusions with polled/streamed server job counts without inflating stored totals. */
export function reconcileVendorJobProgress(
  serverJob: IngestionJobState,
  summary: VendorDedupeSummary | null
): IngestionJobState {
  if (!summary || (serverJob.fileName && serverJob.fileName !== summary.fileName)) {
    return serverJob;
  }
  const serverTotal = serverJob.totalRecords || 0;
  const serverProcessed = serverJob.processedRecords || 0;
  const serverImported = serverJob.importedRecords || 0;
  const serverSkipped = serverJob.skippedRecords || 0;
  const serverFailed = serverJob.failedRecords || 0;

  if (summary.isExcelOnly && summary.skippedCount > 0) {
    const combinedSkipped = serverSkipped + summary.skippedCount;
    const uploadedTotal = Math.max(summary.totalCount, serverTotal + combinedSkipped);
    const storedTarget = Math.max(0, uploadedTotal - combinedSkipped);
    const effectiveTotal = Math.max(serverTotal, storedTarget);
    const effectiveProcessed = Math.min(effectiveTotal, Math.max(serverProcessed, serverImported + serverFailed));
    return {
      ...serverJob,
      uploadedRecords: uploadedTotal,
      totalRecords: effectiveTotal,
      processedRecords: effectiveProcessed,
      skippedRecords: combinedSkipped,
    };
  }

  if (!summary.isExcelOnly && serverJob.status === 'COMPLETED' && summary.skippedCount > 0 && !serverSkipped) {
    const uploadedTotal = Math.max(summary.totalCount, serverTotal);
    const storedTarget = Math.max(0, uploadedTotal - summary.skippedCount);
    return {
      ...serverJob,
      uploadedRecords: uploadedTotal,
      totalRecords: storedTarget,
      processedRecords: storedTarget,
      skippedRecords: summary.skippedCount,
      importedRecords: storedTarget,
    };
  }

  return serverJob;
}

function normalizePoDedupeText(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizePoDedupeNumber(raw: number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Math.round(num * 100) / 100);
}

/**
 * Canonical PO line-item fingerprint matching backend `buildPoLineDedupeKey` so
 * client-side and server-side duplicate checks agree 1:1 on both 3-column PO
 * templates and full ERP PO dumps.
 */
export function buildPoLineDedupeKey(row: ExistingPoDedupeCandidate): string {
  const poNumberKey = String(row.poNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const poDateKey = normalizePoDate(row.poDate);
  const rawVendorName = normalizePoDedupeText(row.vendorName ?? row.vendorIdentifier);
  const rawVendorCode = normalizePoDedupeText(row.vendorCode);
  const vendorKey =
    rawVendorName && (!rawVendorCode || rawVendorName !== `vendor ${rawVendorCode}`)
      ? rawVendorName
      : rawVendorCode || rawVendorName;
  const itemKey = normalizePoDedupeText(row.itemDescription ?? row.itemName);
  if (!vendorKey && !itemKey) return '';
  const specKey = normalizePoDedupeText(row.specification ?? row.specs);
  const qtyKey = normalizePoDedupeNumber(row.quantity);
  const spendKey = normalizePoDedupeNumber(row.spend ?? row.totalSpend);
  return [poNumberKey, poDateKey, vendorKey, itemKey, specKey, qtyKey, spendKey].join('|');
}

function formatPoDuplicateSummary(row: {
  poNumber?: string;
  vendorName?: string;
  itemDescription?: string;
}): string {
  const vendorLabel = String(row.vendorName || '').trim() || 'Unknown Vendor';
  const itemLabel = String(row.itemDescription || '').trim() || 'PO Line';
  const base = `${vendorLabel} — ${itemLabel}`;
  return row.poNumber ? `${row.poNumber} / ${base}` : base;
}

/**
 * Partition parsed PO Dump rows into unique records to import and duplicate PO
 * rows to reject and display (both against previously uploaded PO records for
 * the buyer organization and earlier rows within the same uploaded file).
 */
export function partitionDuplicatePoRows(
  candidates: PoDuplicatePartitionCandidate[],
  existingPoRecords: ExistingPoDedupeCandidate[] = []
): PoDuplicatePartitionResult {
  const existingKeys = new Set<string>();
  for (const existing of existingPoRecords) {
    const key = buildPoLineDedupeKey(existing);
    if (key) existingKeys.add(key);
  }

  const fileKeys = new Map<string, number>();
  const uniqueRecords: PurchaseOrderLineItemRecord[] = [];
  const skippedDuplicates: SkippedDuplicatePoRecord[] = [];
  const poStrings = UI_STRINGS.vendorPoIngestion.poDump;

  for (const candidate of candidates) {
    const rec = candidate.record;
    const vendorName = String(rec.vendorName || rec.vendorIdentifier || '').trim();
    const itemDescription = String(rec.itemDescription || rec.itemName || '').trim();
    const specification = String(rec.specification || rec.specs || '').trim();
    const poNumber = String(rec.poNumber || '').trim();
    const poDate = normalizePoDate(rec.poDate);
    const key = buildPoLineDedupeKey({
      poNumber,
      poDate,
      vendorName,
      itemDescription,
      specification,
      quantity: rec.quantity,
      spend: rec.spend ?? rec.totalSpend,
    });

    if (key) {
      const summary = formatPoDuplicateSummary({ poNumber, vendorName, itemDescription });
      if (existingKeys.has(key)) {
        skippedDuplicates.push({
          rowNumber: candidate.rowNumber,
          ...(poNumber ? { poNumber } : {}),
          ...(poDate ? { poDate } : {}),
          vendorName: vendorName || '—',
          itemDescription: itemDescription || '—',
          ...(specification ? { specification } : {}),
          ...(rec.quantity > 0 ? { quantity: rec.quantity } : {}),
          ...((rec.spend ?? rec.totalSpend ?? 0) > 0 ? { spend: rec.spend ?? rec.totalSpend } : {}),
          reason: formatString(poStrings.duplicateReasonExisting, { summary }),
          matchedAgainst: 'EXISTING_PO',
        });
        continue;
      }

      const firstRow = fileKeys.get(key);
      if (firstRow !== undefined) {
        skippedDuplicates.push({
          rowNumber: candidate.rowNumber,
          ...(poNumber ? { poNumber } : {}),
          ...(poDate ? { poDate } : {}),
          vendorName: vendorName || '—',
          itemDescription: itemDescription || '—',
          ...(specification ? { specification } : {}),
          ...(rec.quantity > 0 ? { quantity: rec.quantity } : {}),
          ...((rec.spend ?? rec.totalSpend ?? 0) > 0 ? { spend: rec.spend ?? rec.totalSpend } : {}),
          reason: formatString(poStrings.duplicateReasonFile, { summary, firstRow }),
          matchedAgainst: 'FILE',
        });
        continue;
      }

      fileKeys.set(key, candidate.rowNumber);
    }

    uniqueRecords.push(rec);
  }

  return { uniqueRecords, skippedDuplicates };
}

/** Extract structured skipped-duplicate PO rows from a backend PO_DUMP job's errorDetails array. */
export function extractSkippedDuplicatePosFromJob(job: IngestionJobState): SkippedDuplicatePoRecord[] {
  const details = Array.isArray(job.errorDetails) ? job.errorDetails : [];
  const poStrings = UI_STRINGS.vendorPoIngestion.poDump;
  return details
    .filter(
      (item) =>
        Boolean(item) &&
        (item.status === 'duplicate_skipped' || item.matchedAgainst === 'EXISTING_PO' || item.matchedAgainst === 'FILE')
    )
    .map((item) => ({
      rowNumber: Number(item.rowNumber) || 0,
      ...(item.poNumber ? { poNumber: item.poNumber } : {}),
      ...(item.poDate ? { poDate: item.poDate } : {}),
      vendorName: item.vendorName || item.companyName || '—',
      itemDescription: item.itemDescription || '—',
      ...(item.specification ? { specification: item.specification } : {}),
      ...(typeof item.quantity === 'number' && item.quantity > 0 ? { quantity: item.quantity } : {}),
      ...(typeof item.spend === 'number' && item.spend > 0 ? { spend: item.spend } : {}),
      reason: item.reason || poStrings.duplicatesSkippedBannerHint,
      matchedAgainst: item.matchedAgainst === 'EXISTING_PO' ? 'EXISTING_PO' : 'FILE',
    }));
}

/** Trigger a browser CSV download listing skipped duplicate PO rows and duplicate reasons. */
export function downloadSkippedDuplicatePosCsv(
  records: SkippedDuplicatePoRecord[],
  fileName = 'skipped_duplicate_po_records.csv'
): void {
  if (typeof window === 'undefined' || records.length === 0) return;
  const escapeCsvCell = (value: unknown) => {
    const raw = String(value ?? '');
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const header = [
    'Row Number',
    'PO Number',
    'Vendor / Supplier',
    'Item Description',
    'Specifications',
    'PO Date',
    'Quantity',
    'Spend',
    'Match Type',
    'Duplicate Reason',
  ];
  const lines = [
    header.map(escapeCsvCell).join(','),
    ...records.map((rec) =>
      [
        rec.rowNumber || '',
        rec.poNumber || '',
        rec.vendorName || '',
        rec.itemDescription || '',
        rec.specification || '',
        rec.poDate || '',
        rec.quantity ?? '',
        rec.spend ?? '',
        rec.matchedAgainst === 'EXISTING_PO' ? 'Previously Uploaded PO' : 'Within Uploaded File',
        rec.reason || '',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
