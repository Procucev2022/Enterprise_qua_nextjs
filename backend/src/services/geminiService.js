/**
 * Gemini AI Document Extraction Service
 *
 * Extracts RFQ line items from an uploaded document. This is the Node equivalent
 * of AIExtractionService + GeminiApiClient in the Java p2pservices app, and it
 * keeps that service's two most important guarantees:
 *
 *   - Accuracy over completeness. The model is told never to guess a quantity,
 *     never to default it to 1, and never to reuse a number from the
 *     specification as the purchase quantity. A missing value comes back null so
 *     the buyer is asked, rather than being handed a fabricated figure.
 *   - Strict JSON. The response is parsed, not interpreted; anything that is not
 *     valid JSON with an `items` array is treated as a failed extraction.
 *
 * The API key is read from the environment on the server only. Callers receive a
 * documented failure reason instead of an exception, so the wizard can fall back
 * to manual line-item entry.
 */

const { GEMINI_CONFIG, GEMINI_INLINE_MIME_TYPES } = require('../config/constants');
const { logger } = require('./loggerService');
// Monetary parsing lives with the ingestion layer that consumes these rows, so
// prices from a model reply and prices from a browser-parsed BOQ normalise identically.
const { normalizeAmount } = require('./rfqIngestionService');

/** Machine-readable outcomes the route maps onto responses. */
const EXTRACTION_STATUS = {
  SUCCESS: 'SUCCESS',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NO_CONTENT: 'NO_CONTENT',
  DOCUMENT_TOO_LARGE: 'DOCUMENT_TOO_LARGE',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  AI_FAILED: 'AI_FAILED',
  NO_ITEMS_FOUND: 'NO_ITEMS_FOUND',
};

/**
 * Instruction block sent with every request.
 *
 * Condensed from prompts/rfq_prompt.txt in the Java service. The prohibitions are
 * load-bearing: without them the model routinely lifted a dimension out of the
 * specification and returned it as the order quantity.
 */
const EXTRACTION_PROMPT = `You are an enterprise RFQ extraction engine. Extract ONLY procurement line items that are explicitly present in the supplied document.

ACCURACY IS MORE IMPORTANT THAN COMPLETENESS. DO NOT GUESS.
- DO NOT infer a purchase quantity from a specification, dimension or model number.
- DO NOT default a missing quantity to 1. Return null instead.
- DO NOT invent items, units, dates or specifications that are not stated.
- A spreadsheet may be flattened with cells separated by " | ", one row per line. A label may sit in one cell with its value in the next cell on the same line, or as a column header with values in the rows beneath it. Read both layouts.
- If the document is an image or a scan, read the table structure and match each quantity to the row it sits on.

DESCRIPTION vs SPECIFICATION
- When a document prices items with a separate specification column, use it as stated.
- When one description carries both the item and its technical detail, split it. Keep the product name plus any size, dimension, bore, length or model token that IDENTIFIES the item in "itemDescription", and move the qualifying detail — material grade, standard, class, rating, voltage, phase, efficiency, certification, finish — into "specification".
- Splitting only moves text that is already written in the document. Never add a specification that is not stated, and never drop a token: every word of the original description must appear in one field or the other.
- Example: "Industrial Ball Valve, 2 inch, SS316, Class 150, threaded" becomes itemDescription "Industrial Ball Valve 2 inch" and specification "SS316, Class 150, threaded", because the bore identifies the valve while the material and class qualify it.

MONETARY VALUES
- Report money as a plain number with no currency symbol, thousands separator or words. "Rs. 1,45,000/-" becomes 145000.
- DO NOT calculate, estimate or infer a price that is not printed in the document. Return null instead.
- "estimatedBudget" is only for a stated overall value such as a grand total, total amount, estimated value or budget ceiling. If the document only prices individual lines, leave it null; the totals are derived from those lines instead.

Return a SINGLE JSON object with EXACTLY this shape and no surrounding prose or markdown:
{
  "documentTitle": "String, a short title for the overall requirement, or null",
  "category": "String, the overall category if stated, or null",
  "deliveryDate": "String in YYYY-MM-DD if a delivery or required-by date is stated, else null",
  "deliveryLocation": "String, overall delivery location or destination if stated, or null",
  "deliveryCity": "String, overall delivery city if stated, or null",
  "deliveryState": "String, overall delivery state if stated, or null",
  "deliveryPincode": "String, overall delivery pincode or postal code if stated, or null",
  "estimatedBudget": "Number, the overall stated total value or budget of the requirement, or null",
  "items": [
    {
      "itemDescription": "String, the product or material name including any size, dimension or model token that identifies it. Never an empty string.",
      "quantity": "Number, the purchase quantity exactly as stated, or null if not stated",
      "unit": "String, unit of measure as stated e.g. Nos, Units, Meters, Kg, Sets, or null",
      "specification": "String, technical specification, grade, material or standard as stated, or null",
      "brand": "String, brand or manufacturer if stated, or null",
      "category": "String, item level category if stated, or null",
      "targetDate": "String in YYYY-MM-DD if this line has its own date, else null",
      "deliveryCity": "String, destination city for this item if stated, else null",
      "deliveryState": "String, destination state for this item if stated, else null",
      "deliveryPincode": "String, destination pincode for this item if stated, else null",
      "deliveryLocation": "String, destination location for this item if stated, else null",
      "unitPrice": "Number, the stated rate or price for ONE unit of this line, or null",
      "totalPrice": "Number, the stated line total or amount for this line, or null"
    }
  ]
}

If the document contains no procurement line items at all, return {"items": []}.`;

/** True when a real extraction call can be attempted. */
function isConfigured() {
  return resolveApiKeys().length > 0;
}

/** Resolve API keys pool from GEMINI_CONFIG.API_KEY (supports comma-separated multiple keys). */
function resolveApiKeys() {
  const raw = String(GEMINI_CONFIG.API_KEY || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Models to attempt, primary first. */
function resolveModelChain() {
  return [GEMINI_CONFIG.PRIMARY_MODEL, ...GEMINI_CONFIG.FALLBACK_MODELS].filter(Boolean);
}

/**
 * Pull the model's text out of a generateContent response, tolerating the
 * multi-part shape the API can return.
 */
function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

/**
 * Parse the model's reply into an object.
 *
 * Models occasionally wrap JSON in a ```json fence despite being told not to, so
 * the fence is stripped and the outermost object is isolated before parsing.
 * Anything still unparseable is a failed extraction, never a partial guess.
 */
function parseExtractionJson(text) {
  if (!text) return null;

  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  candidate = candidate.slice(firstBrace, lastBrace + 1);

  // The candidate always starts with '{' and ends with '}', so a successful parse
  // is necessarily an object; anything else throws and is reported as a failure.
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Map the model's item shape onto the raw row shape rfqIngestionService expects.
 *
 * A row with no description cannot be quoted against and is dropped here. A null
 * quantity is passed through untouched so the ingestion layer applies the same
 * documented default the Java service used, rather than the model inventing one.
 */
function toRawLineItems(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const docDate = typeof parsed?.deliveryDate === 'string' ? parsed.deliveryDate.trim() : '';

  return items
    .map((item) => {
      const row = {
        itemName: typeof item?.itemDescription === 'string' ? item.itemDescription.trim() : '',
        quantity: item?.quantity,
        unit: typeof item?.unit === 'string' ? item.unit.trim() : '',
        technicalSpecs: typeof item?.specification === 'string' ? item.specification.trim() : '',
        category: typeof item?.category === 'string' ? item.category.trim() : '',
        targetDate: typeof item?.targetDate === 'string' ? item.targetDate.trim() : docDate,
        unitPrice: normalizeAmount(item?.unitPrice),
        totalPrice: normalizeAmount(item?.totalPrice),
      };

      if (item?.brand) row.brand = String(item.brand).trim();
      if (item?.deliveryCity || parsed?.deliveryCity) {
        row.deliveryCity = String(item?.deliveryCity || parsed.deliveryCity).trim();
      }
      if (item?.deliveryState || parsed?.deliveryState) {
        row.deliveryState = String(item?.deliveryState || parsed.deliveryState).trim();
      }
      if (item?.deliveryPincode || parsed?.deliveryPincode) {
        row.deliveryPincode = String(item?.deliveryPincode || parsed.deliveryPincode).trim();
      }
      if (item?.deliveryLocation || parsed?.deliveryLocation) {
        row.deliveryLocation = String(item?.deliveryLocation || parsed.deliveryLocation).trim();
      }

      return row;
    })
    .filter((item) => item.itemName !== '');
}

/**
 * Build the generateContent request body, sending the document either as text or
 * as inline base64 data depending on what the caller could produce.
 */
function buildRequestBody({ documentText, inlineData, mimeType, fileName }) {
  const parts = [{ text: EXTRACTION_PROMPT }];

  if (fileName) {
    parts.push({ text: `\nDOCUMENT FILE NAME: ${fileName}` });
  }
  if (documentText) {
    parts.push({ text: `\nDOCUMENT TEXT:\n${documentText}` });
  }
  if (inlineData) {
    parts.push({ inline_data: { mime_type: mimeType, data: inlineData } });
  }

  return {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: GEMINI_CONFIG.TEMPERATURE,
      response_mime_type: 'application/json',
    },
  };
}

/**
 * Call one model, returning its parsed JSON or throwing so the caller can try
 * the next model in the chain. Supports multiple API keys with failover.
 */
async function callModel(model, requestBody, timeoutMs = GEMINI_CONFIG.REQUEST_TIMEOUT_MS) {
  const url = `${GEMINI_CONFIG.BASE_URL}/${model}:generateContent`;
  const keys = resolveApiKeys();
  if (keys.length === 0) {
    throw new Error('No Gemini API key available');
  }

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header auth keeps the key out of the URL and therefore out of logs.
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini ${model} responded ${res.status}: ${detail.slice(0, 200)}`);
      }

      const payload = await res.json();
      const parsed = parseExtractionJson(extractResponseText(payload));
      if (!parsed) {
        throw new Error(`Gemini ${model} returned no parseable JSON`);
      }
      return parsed;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw err;
      }
      if (i < keys.length - 1) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Extract line items from a document.
 *
 * Never throws: every failure mode is reported as a status the caller can act on.
 *
 * @param {Object} input
 * @param {string} [input.documentText] flattened text extracted by the client
 * @param {string} [input.inlineData] base64 document body for PDFs and images
 * @param {string} [input.mimeType] required when inlineData is supplied
 * @param {string} [input.fileName]
 * @returns {Promise<{status: string, lineItems: Array<Object>, model: string|null,
 *   documentTitle: string|null, category: string|null, deliveryDate: string|null,
 *   estimatedBudget: number|null, error: string|null}>}
 */
async function extractLineItems(input = {}) {
  const { documentText, inlineData, mimeType, fileName } = input;

  const base = {
    lineItems: [],
    model: null,
    documentTitle: null,
    category: null,
    deliveryDate: null,
    estimatedBudget: null,
    error: null,
  };

  if (!isConfigured()) {
    logger.warn('Gemini extraction skipped: GEMINI_API_KEY is not set', {}, 'GEMINI');
    return { ...base, status: EXTRACTION_STATUS.NOT_CONFIGURED };
  }

  const trimmedText = typeof documentText === 'string' ? documentText.trim() : '';
  if (!trimmedText && !inlineData) {
    return { ...base, status: EXTRACTION_STATUS.NO_CONTENT };
  }

  if (inlineData) {
    if (!mimeType || !GEMINI_INLINE_MIME_TYPES.includes(mimeType)) {
      return { ...base, status: EXTRACTION_STATUS.UNSUPPORTED_TYPE };
    }
    // base64 inflates by 4/3; compare the decoded size against the cap.
    const approxBytes = Math.floor((inlineData.length * 3) / 4);
    if (approxBytes > GEMINI_CONFIG.MAX_DOCUMENT_BYTES) {
      return { ...base, status: EXTRACTION_STATUS.DOCUMENT_TOO_LARGE };
    }
  }

  const requestBody = buildRequestBody({
    // Oversized text is truncated rather than rejected: the head of a BOQ still
    // carries the line items, and a hard failure would lose them entirely.
    documentText: trimmedText.slice(0, GEMINI_CONFIG.MAX_DOCUMENT_TEXT_CHARS),
    inlineData,
    mimeType,
    fileName,
  });

  const failures = [];
  // One shared deadline for the whole chain, so a run of slow failures degrades
  // into a reported fallback instead of a request nobody is still waiting on.
  const deadline = Date.now() + GEMINI_CONFIG.TOTAL_BUDGET_MS;

  for (const model of resolveModelChain()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < GEMINI_CONFIG.MIN_ATTEMPT_MS) {
      failures.push(`skipped ${model}: extraction time budget exhausted`);
      logger.warn(
        `Gemini extraction budget exhausted before trying ${model}`,
        { budgetMs: GEMINI_CONFIG.TOTAL_BUDGET_MS },
        'GEMINI'
      );
      break;
    }

    try {
      // Never overrun the shared deadline, even if the per-attempt timeout is larger.
      const parsed = await callModel(model, requestBody, Math.min(GEMINI_CONFIG.REQUEST_TIMEOUT_MS, remainingMs));
      const lineItems = toRawLineItems(parsed);

      if (lineItems.length === 0) {
        logger.info(`Gemini ${model} found no line items in ${fileName || 'document'}`, {}, 'GEMINI');
        return { ...base, status: EXTRACTION_STATUS.NO_ITEMS_FOUND, model };
      }

      logger.info(
        `Gemini ${model} extracted ${lineItems.length} line items from ${fileName || 'document'}`,
        { model, itemCount: lineItems.length },
        'GEMINI'
      );

      return {
        status: EXTRACTION_STATUS.SUCCESS,
        lineItems,
        model,
        documentTitle: typeof parsed.documentTitle === 'string' ? parsed.documentTitle : null,
        category: typeof parsed.category === 'string' ? parsed.category : null,
        deliveryDate: typeof parsed.deliveryDate === 'string' ? parsed.deliveryDate : null,
        deliveryLocation: typeof parsed.deliveryLocation === 'string' ? parsed.deliveryLocation : null,
        deliveryCity: typeof parsed.deliveryCity === 'string' ? parsed.deliveryCity : null,
        deliveryState: typeof parsed.deliveryState === 'string' ? parsed.deliveryState : null,
        deliveryPincode: typeof parsed.deliveryPincode === 'string' ? parsed.deliveryPincode : null,
        estimatedBudget: normalizeAmount(parsed.estimatedBudget),
        error: null,
      };
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      logger.warn(`Gemini extraction attempt failed on ${model}`, { error: err.message }, 'GEMINI');
    }
  }

  return {
    ...base,
    status: EXTRACTION_STATUS.AI_FAILED,
    error: failures.join(' | '),
  };
}

/**
 * Run an arbitrary JSON-returning prompt through the same model chain, deadline
 * and timeout handling as extraction.
 *
 * Exists so callers that need a different prompt (the RFQ summary, for one) do
 * not each re-implement the transport, the fallback chain and the shared budget.
 * Like extractLineItems it never throws: the caller gets a status to act on.
 *
 * @param {object} input
 * @param {string} input.prompt the full prompt text
 * @param {string} [input.label] used in logs to say what was being generated
 * @returns {Promise<{status: string, data: object|null, model: string|null, error: string|null}>}
 */
async function generateJson(input = {}) {
  const { prompt, label = 'generation' } = input;

  const base = { data: null, model: null, error: null };

  if (!isConfigured()) {
    logger.warn(`Gemini ${label} skipped: GEMINI_API_KEY is not set`, {}, 'GEMINI');
    return { ...base, status: EXTRACTION_STATUS.NOT_CONFIGURED };
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { ...base, status: EXTRACTION_STATUS.NO_CONTENT };
  }

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: GEMINI_CONFIG.TEMPERATURE,
      response_mime_type: 'application/json',
    },
  };

  const failures = [];
  const deadline = Date.now() + GEMINI_CONFIG.TOTAL_BUDGET_MS;

  for (const model of resolveModelChain()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < GEMINI_CONFIG.MIN_ATTEMPT_MS) {
      failures.push(`skipped ${model}: time budget exhausted`);
      break;
    }

    try {
      const parsed = await callModel(
        model,
        requestBody,
        Math.min(GEMINI_CONFIG.REQUEST_TIMEOUT_MS, remainingMs)
      );
      logger.info(`Gemini ${model} completed ${label}`, { model }, 'GEMINI');
      return { status: EXTRACTION_STATUS.SUCCESS, data: parsed, model, error: null };
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
      logger.warn(`Gemini ${label} attempt failed on ${model}`, { error: err.message }, 'GEMINI');
    }
  }

  return { ...base, status: EXTRACTION_STATUS.AI_FAILED, error: failures.join(' | ') };
}

module.exports = {
  EXTRACTION_STATUS,
  EXTRACTION_PROMPT,
  isConfigured,
  resolveModelChain,
  resolveApiKeys,
  callModel,
  generateJson,
  extractResponseText,
  parseExtractionJson,
  toRawLineItems,
  buildRequestBody,
  extractLineItems,
};
