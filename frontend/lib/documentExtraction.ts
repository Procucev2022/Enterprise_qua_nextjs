// ==============================================================================
// DOCUMENT PREPARATION FOR AI EXTRACTION
// ==============================================================================
// Turns a browser File into the request shape POST /api/rfqs/extract accepts.
//
// Shared by the ingestion wizard's upload path and the manual RFQ dialog, which
// both offer extraction from an attached document. It lived inside the wizard
// component until the dialog needed it too; duplicating it would have let the two
// drift, and the spreadsheet flattening in particular has to match what the
// extraction prompt describes or quantities stop lining up with their items.
// ==============================================================================

import * as XLSX from 'xlsx';
import type { RFQExtractionRequest } from './types';

/**
 * Spreadsheet-like documents are flattened in the browser, because Gemini cannot
 * read an xlsx binary.
 */
export function isSpreadsheet(name: string): boolean {
  return /\.(xlsx|xls|csv|tsv)$/i.test(name);
}

/** A raw forwarded email — parsed server-side by emailIngestionService, not Gemini directly. */
export function isEmailFile(name: string): boolean {
  return /\.eml$/i.test(name);
}

/**
 * Turn a workbook into the " | "-delimited text layout the extraction prompt
 * describes, preserving row structure so quantities stay aligned with the item
 * they belong to.
 */
export function flattenWorkbook(data: ArrayBuffer): string {
  const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
  return workbook.SheetNames.map((sheetName) => {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const body = rows
      .map((row) => row.map((cell) => String(cell ?? '').trim()).join(' | '))
      .filter((line) => line.replace(/\|/g, '').trim() !== '')
      .join('\n');
    return `SHEET: ${sheetName}\n${body}`;
  }).join('\n\n');
}

/** Read a file as the base64 body Gemini accepts for PDFs and images. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // Strip the "data:<mime>;base64," prefix the API does not expect.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

/** Build the extraction request for whichever document the buyer supplied. */
export async function buildExtractionRequest(file: File): Promise<RFQExtractionRequest> {
  if (isSpreadsheet(file.name)) {
    return { fileName: file.name, documentText: flattenWorkbook(await readAsArrayBuffer(file)) };
  }
  if (isEmailFile(file.name)) {
    // Raw RFC822 bytes, base64 — the backend detects the .eml extension and
    // routes this through emailIngestionService instead of Gemini's inline
    // MIME allow-list (which doesn't include message/rfc822).
    return { fileName: file.name, inlineData: await readAsBase64(file), mimeType: 'message/rfc822' };
  }
  return {
    fileName: file.name,
    inlineData: await readAsBase64(file),
    // Browsers leave type empty for some uploads; PDF is the common default here.
    mimeType: file.type || 'application/pdf',
  };
}
