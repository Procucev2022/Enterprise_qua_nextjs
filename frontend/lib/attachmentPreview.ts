/**
 * Supporting document MIME resolution, blob normalization, and safe RFC 822 (.eml)
 * preview parsing utilities for RFQ attachments.
 */

import { ATTACHMENT_GENERIC_MIME_TYPES, resolveAttachmentMimeType } from './constants';
import type { AttachmentPreviewKind, ParsedEmlPreview } from './types';

const IMAGE_MIME_PREFIX = 'image/';
const TEXT_PREVIEW_MIMES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
]);
const EMAIL_MIMES: ReadonlySet<string> = new Set(['message/rfc822']);
const MAX_MIME_PART_DEPTH = 4;

/**
 * Determine which preview renderer should handle an attachment based on its
 * resolved MIME type and file extension.
 */
export function resolveAttachmentPreviewKind(fileName: string, resolvedMime: string): AttachmentPreviewKind {
  const mime = resolvedMime.split(';')[0].trim().toLowerCase();
  const lowerName = fileName.trim().toLowerCase();

  if (EMAIL_MIMES.has(mime) || lowerName.endsWith('.eml')) {
    return 'email';
  }
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'pdf';
  }
  if (mime.startsWith(IMAGE_MIME_PREFIX)) {
    return 'image';
  }
  if (TEXT_PREVIEW_MIMES.has(mime)) {
    return 'text';
  }
  return 'download';
}

/**
 * Resolve the authoritative MIME type for a downloaded attachment blob,
 * ensuring generic or missing Content-Type headers do not block browser inline rendering.
 */
export function normalizeAttachmentBlob(
  blob: Blob,
  fileName: string,
  responseContentType?: string | null,
  declaredMimeType?: string | null
): { blob: Blob; resolvedMime: string; previewKind: AttachmentPreviewKind } {
  const candidateMime = [responseContentType, declaredMimeType, blob.type].find((candidate) => {
    const clean = typeof candidate === 'string' ? candidate.split(';')[0].trim().toLowerCase() : '';
    return clean.length > 0 && !ATTACHMENT_GENERIC_MIME_TYPES.has(clean);
  });

  const resolvedMime = resolveAttachmentMimeType(fileName, candidateMime || '');
  const blobMime = typeof blob.type === 'string' ? blob.type.split(';')[0].trim().toLowerCase() : '';
  const normalizedBlob = blobMime === resolvedMime ? blob : new Blob([blob], { type: resolvedMime });

  return {
    blob: normalizedBlob,
    resolvedMime,
    previewKind: resolveAttachmentPreviewKind(fileName, resolvedMime),
  };
}

/**
 * Read a Blob as UTF-8 text reliably across modern browsers and JSDOM test runtimes.
 */
export async function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob text.'));
      reader.readAsText(blob);
    });
  }
  if (typeof Response !== 'undefined') {
    return new Response(blob).text();
  }
  return '';
}

function decodeQuotedPrintable(input: string): string {
  const withoutSoftBreaks = input.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i += 1) {
    const char = withoutSoftBreaks[i];
    if (char === '=' && /^[0-9a-fA-F]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const encoded = new TextEncoder().encode(char);
      for (let j = 0; j < encoded.length; j += 1) {
        bytes.push(encoded[j]);
      }
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function decodeBase64Text(input: string): string {
  const cleaned = input.replace(/\s+/g, '');
  if (!cleaned || typeof atob !== 'function') {
    return input.trim();
  }
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return input.trim();
  }
}

/**
 * Decode RFC 2047 encoded-word header fragments (e.g. =?UTF-8?B?...?= or =?UTF-8?Q?...?=).
 */
export function decodeRfc2047HeaderValue(rawValue: string): string {
  return rawValue.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (full, _charset: string, enc: string, text: string) => {
    const encoding = enc.toUpperCase();
    if (encoding === 'B') {
      return decodeBase64Text(text);
    }
    return decodeQuotedPrintable(text.replace(/_/g, ' '));
  });
}

function parseHeadersBlock(headerSection: string): Record<string, string> {
  const unfolded = headerSection.replace(/\r?\n[ \t]+/g, ' ');
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const val = decodeRfc2047HeaderValue(line.slice(sep + 1).trim());
    if (!headers[key]) {
      headers[key] = val;
    }
  }
  return headers;
}

function extractBoundary(contentTypeHeader: string): string | null {
  const match = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentTypeHeader);
  return match ? (match[1] || match[2] || '').trim() || null : null;
}

function extractFileNameParam(headerValue: string): string | null {
  const match = /(?:filename|name)\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(headerValue);
  const raw = match ? (match[1] || match[2] || '').trim() : '';
  return raw ? decodeRfc2047HeaderValue(raw) : null;
}

function stripHtmlTagsForSafeText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodePartBody(body: string, transferEncodingHeader?: string): string {
  const enc = (transferEncodingHeader || '').trim().toLowerCase();
  if (enc === 'base64') {
    return decodeBase64Text(body);
  }
  if (enc === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  return body;
}

function splitHeaderAndBody(entityText: string): { headers: Record<string, string>; body: string; hasHeaders: boolean } {
  const normalized = entityText.replace(/\r\n/g, '\n');
  const splitIdx = normalized.indexOf('\n\n');
  if (splitIdx === -1) {
    return { headers: {}, body: normalized, hasHeaders: false };
  }
  const candidateHeader = normalized.slice(0, splitIdx);
  if (!/^[a-z0-9-]+:/im.test(candidateHeader)) {
    return { headers: {}, body: normalized, hasHeaders: false };
  }
  return {
    headers: parseHeadersBlock(candidateHeader),
    body: normalized.slice(splitIdx + 2),
    hasHeaders: true,
  };
}

interface ExtractedMimeText {
  plainParts: string[];
  htmlParts: string[];
  embeddedAttachments: string[];
}

function collectMimeParts(entityText: string, depth: number, acc: ExtractedMimeText): void {
  const { headers, body } = splitHeaderAndBody(entityText);
  const contentType = (headers['content-type'] || 'text/plain').toLowerCase();
  const disposition = (headers['content-disposition'] || '').toLowerCase();
  const attachmentName = extractFileNameParam(disposition) || extractFileNameParam(headers['content-type'] || '');

  if (disposition.startsWith('attachment') || (attachmentName && !contentType.startsWith('multipart/'))) {
    acc.embeddedAttachments.push(attachmentName || 'attachment');
    return;
  }

  const boundary = contentType.startsWith('multipart/') ? extractBoundary(headers['content-type'] || '') : null;
  if (boundary && depth < MAX_MIME_PART_DEPTH) {
    const marker = `--${boundary}`;
    const segments = body.split(marker).slice(1);
    for (const segment of segments) {
      if (segment.startsWith('--')) break;
      const trimmedSegment = segment.replace(/^\r?\n/, '');
      if (trimmedSegment.trim()) {
        collectMimeParts(trimmedSegment, depth + 1, acc);
      }
    }
    return;
  }

  const decoded = decodePartBody(body, headers['content-transfer-encoding']).trim();
  if (!decoded) return;

  if (contentType.includes('text/html')) {
    acc.htmlParts.push(stripHtmlTagsForSafeText(decoded));
  } else if (contentType.startsWith('text/') || !contentType.includes('/')) {
    acc.plainParts.push(decoded);
  }
}

/**
 * Safely parse an RFC 822 (.eml) payload into structured email headers, plain-text
 * message content, and any embedded attachment filenames for declarative preview rendering.
 */
export function parseEmlContent(raw: string): ParsedEmlPreview {
  const normalized = raw.replace(/\r\n/g, '\n');
  const { headers } = splitHeaderAndBody(normalized);
  const acc: ExtractedMimeText = {
    plainParts: [],
    htmlParts: [],
    embeddedAttachments: [],
  };

  collectMimeParts(normalized, 0, acc);

  const primaryBody = acc.plainParts[0] || acc.htmlParts[0] || '';
  return {
    ...(headers.from ? { from: headers.from } : {}),
    ...(headers.to ? { to: headers.to } : {}),
    ...(headers.cc ? { cc: headers.cc } : {}),
    ...(headers.subject ? { subject: headers.subject } : {}),
    ...(headers.date ? { date: headers.date } : {}),
    body: primaryBody,
    embeddedAttachments: acc.embeddedAttachments,
    raw,
  };
}
