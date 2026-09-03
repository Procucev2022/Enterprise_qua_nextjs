import { authClient } from './authClient';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  ExtractedEntity,
  RFQAttachment,
  RFQAttachmentResult,
  RFQExtractionRequest,
  RFQExtractionResult,
  RFQIngestionResponse,
} from './types';

/**
 * Transport for AI RFQ document extraction.
 *
 * The Gemini API key lives only on the server, so the browser never talks to
 * Gemini directly: it posts the document (flattened spreadsheet text, or base64
 * for a PDF/image) to the backend, which performs the extraction and classifies
 * the result. A document that cannot be read is a normal outcome rather than an
 * error, so every failure resolves with `success: false` plus a machine-readable
 * `reason` the wizard maps onto its manual-entry fallback.
 */
export async function extractLineItemsFromDocument(
  payload: RFQExtractionRequest
): Promise<RFQExtractionResult> {
  const token = authClient.getToken();

  let res: Response;
  try {
    res = await fetch('/api/rfqs/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // The API is unreachable. Fail closed so the buyer is never shown
    // fabricated line items.
    return { success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable };
  }

  // A 5xx is the API failing or absent, not the model misreading the document.
  // The endpoint reports every genuine extraction failure as a 422 with a reason,
  // so anything in the 500s is a transport problem and has to say so.
  if (res.status >= 500) {
    return {
      success: false,
      reason: 'NETWORK',
      error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }),
    };
  }

  let body: Partial<RFQExtractionResult> & { data?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, reason: 'AI_FAILED', error: UI_STRINGS.rfqExtraction.unreadableResponse };
  }

  if (!res.ok || !body.success || !body.data) {
    return {
      success: false,
      reason: body.reason || 'AI_FAILED',
      error: body.error || UI_STRINGS.rfqExtraction.unreadableResponse,
    };
  }

  return {
    success: true,
    data: body.data as RFQExtractionResult['data'],
    classification: body.classification,
    extraction: body.extraction,
  };
}

/**
 * Re-classify line items against the shared major/minor taxonomy.
 *
 * The wizard used to do this in the browser with a three-keyword lookup, which
 * silently downgraded anything it did not recognise to a default minor category.
 * The server owns the full 280+ category taxonomy and the same precedence rules
 * the ingest pipeline applies, so classification is asked of it instead.
 *
 * Rows are sent as-is and their existing categories are deliberately omitted: an
 * explicit category takes precedence server-side, so leaving them in would make
 * re-classification a no-op.
 */
export async function classifyLineItems(items: ExtractedEntity[]): Promise<RFQIngestionResponse> {
  const token = authClient.getToken();

  const lineItems = items.map((item) => ({
    id: item.id,
    itemName: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    targetDate: item.targetDate,
    technicalSpecs: item.technicalSpecs,
  }));

  let res: Response;
  try {
    res = await fetch('/api/rfqs/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ lineItems }),
    });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  if (res.status >= 500) {
    return { success: false, error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }) };
  }

  let body: Partial<RFQIngestionResponse> = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.classifyFailed };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.rfqExtraction.classifyFailed };
  }

  return { success: true, data: body.data, classification: body.classification };
}

/** Where a stored attachment is served from, used directly as a link target. */
export function rfqAttachmentUrl(attachmentId: string): string {
  return `/api/rfqs/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * Store a supporting document against an RFQ.
 *
 * Deliberately separate from `extractLineItemsFromDocument`: this is the manual
 * path, where the document is evidence to keep rather than something to read, so
 * no extraction is performed and no Gemini quota is spent.
 */
export async function uploadRFQAttachment(file: File): Promise<RFQAttachmentResult> {
  const token = authClient.getToken();

  let content: string;
  try {
    content = await readFileAsBase64(file);
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  let res: Response;
  try {
    res = await fetch('/api/rfqs/attachments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // The browser leaves `type` empty for some uploads; the server allow-list
      // rejects an unrecognised value, which is the outcome we want.
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, content }),
    });
  } catch {
    return { success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  if (res.status >= 500) {
    return { success: false, error: formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: res.status }) };
  }

  let body: { success?: boolean; data?: RFQAttachment; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return { success: false, error: UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  if (!res.ok || !body.success || !body.data) {
    return { success: false, error: body.error || UI_STRINGS.rfqExtraction.attachUnreachable };
  }

  return { success: true, data: body.data };
}

/** Read a file as the base64 body the upload endpoint accepts. */
function readFileAsBase64(file: File): Promise<string> {
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

const rfqClient = { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment, rfqAttachmentUrl };

export default rfqClient;
