const request = require('supertest');
const app = require('../src/app');
const gemini = require('../src/services/geminiService');
const { GEMINI_CONFIG, EXTRACTION_REASON_MESSAGES } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

const { EXTRACTION_STATUS } = gemini;

/** Shape a Gemini generateContent success payload around a JSON string. */
function geminiReply(jsonText) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: jsonText }] } }] }),
  };
}

describe('Gemini document extraction service', () => {
  const originalKey = GEMINI_CONFIG.API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    GEMINI_CONFIG.API_KEY = originalKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ── Response parsing ───────────────────────────────────────────────────────
  describe('parseExtractionJson', () => {
    test('parses a bare JSON object', () => {
      expect(gemini.parseExtractionJson('{"items":[]}')).toEqual({ items: [] });
    });

    // Models add a markdown fence despite being told not to.
    test('unwraps a ```json fenced block', () => {
      expect(gemini.parseExtractionJson('```json\n{"items":[{"itemDescription":"Pump"}]}\n```')).toEqual({
        items: [{ itemDescription: 'Pump' }],
      });
    });

    test('isolates the object when the model adds prose around it', () => {
      expect(gemini.parseExtractionJson('Here you go:\n{"items":[]}\nHope that helps.')).toEqual({ items: [] });
    });

    test.each(['', '   ', 'no json here', '{ broken', 'null'])('returns null for %p', (input) => {
      expect(gemini.parseExtractionJson(input)).toBeNull();
    });
  });

  describe('extractResponseText', () => {
    test('joins every text part in order', () => {
      const payload = { candidates: [{ content: { parts: [{ text: '{"it' }, { text: 'ems":[]}' }] } }] };
      expect(gemini.extractResponseText(payload)).toBe('{"items":[]}');
    });

    test.each([{}, { candidates: [] }, { candidates: [{ content: {} }] }])(
      'returns an empty string for the malformed payload %p',
      (payload) => {
        expect(gemini.extractResponseText(payload)).toBe('');
      }
    );

    test('ignores non-text parts such as inline data echoes', () => {
      const payload = { candidates: [{ content: { parts: [{ inline_data: {} }, { text: 'ok' }] } }] };
      expect(gemini.extractResponseText(payload)).toBe('ok');
    });
  });

  describe('toRawLineItems', () => {
    test('maps the model shape onto ingestion rows', () => {
      const rows = gemini.toRawLineItems({
        items: [
          {
            itemDescription: '  Centrifugal Pump 500 GPM  ',
            quantity: 12,
            unit: 'Units',
            specification: 'SS316 impeller',
            category: 'Pumps',
            targetDate: '2026-09-15',
          },
        ],
      });
      expect(rows).toEqual([
        {
          itemName: 'Centrifugal Pump 500 GPM',
          quantity: 12,
          unit: 'Units',
          technicalSpecs: 'SS316 impeller',
          category: 'Pumps',
          targetDate: '2026-09-15',
          unitPrice: null,
          totalPrice: null,
        },
      ]);
    });

    test('carries stated prices through, stripping currency text', () => {
      const rows = gemini.toRawLineItems({
        items: [{ itemDescription: 'Gate Valve', unitPrice: 'Rs. 4,500/-', totalPrice: 108000 }],
      });
      expect(rows[0].unitPrice).toBe(4500);
      expect(rows[0].totalPrice).toBe(108000);
    });

    // A row with no description cannot be quoted against.
    test('drops rows with a missing or blank description', () => {
      const rows = gemini.toRawLineItems({
        items: [{ itemDescription: '   ' }, { quantity: 5 }, { itemDescription: 'Valve' }],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].itemName).toBe('Valve');
    });

    // Critical: a null quantity must survive so the ingestion layer applies the
    // documented default rather than the model inventing a number.
    test('passes a null quantity through untouched', () => {
      const rows = gemini.toRawLineItems({ items: [{ itemDescription: 'Pump', quantity: null }] });
      expect(rows[0].quantity).toBeNull();
    });

    test.each([{}, { items: null }, { items: 'nope' }])('tolerates the malformed payload %p', (payload) => {
      expect(gemini.toRawLineItems(payload)).toEqual([]);
    });
  });

  describe('buildRequestBody', () => {
    test('sends document text and pins temperature to zero for determinism', () => {
      const body = gemini.buildRequestBody({ documentText: 'Pump | 12 | Units', fileName: 'boq.xlsx' });
      expect(body.generationConfig.temperature).toBe(0);
      expect(body.generationConfig.response_mime_type).toBe('application/json');
      const text = body.contents[0].parts.map((p) => p.text || '').join('\n');
      expect(text).toContain('DO NOT default a missing quantity to 1');
      expect(text).toContain('boq.xlsx');
      expect(text).toContain('Pump | 12 | Units');
    });

    // A BOQ that prices everything in one description column left the technical
    // specification blank for every row, because the model had nowhere to split
    // it. The instruction redistributes text already written in the document,
    // which is why it is paired with a no-invent and no-drop rule.
    test('instructs the model to split a combined description without inventing or dropping text', () => {
      const body = gemini.buildRequestBody({ documentText: 'x' });
      const text = body.contents[0].parts.map((p) => p.text || '').join('\n');

      expect(text).toContain('DESCRIPTION vs SPECIFICATION');
      expect(text).toContain('Never add a specification that is not stated');
      expect(text).toContain('never drop a token');
      // The identifying tokens have to stay on the item, not move to the spec.
      expect(text).toContain('IDENTIFIES the item in "itemDescription"');
    });

    test('attaches inline data for a PDF', () => {
      const body = gemini.buildRequestBody({ inlineData: 'BASE64', mimeType: 'application/pdf' });
      expect(body.contents[0].parts).toEqual(
        expect.arrayContaining([{ inline_data: { mime_type: 'application/pdf', data: 'BASE64' } }])
      );
    });
  });

  // ── Extraction outcomes ────────────────────────────────────────────────────
  describe('extractLineItems', () => {
    test('reports NOT_CONFIGURED when no API key is set, without calling out', async () => {
      GEMINI_CONFIG.API_KEY = '';
      global.fetch = jest.fn();

      const res = await gemini.extractLineItems({ documentText: 'Pump' });

      expect(res.status).toBe(EXTRACTION_STATUS.NOT_CONFIGURED);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('reports NO_CONTENT when neither text nor inline data is supplied', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const res = await gemini.extractLineItems({ documentText: '   ' });
      expect(res.status).toBe(EXTRACTION_STATUS.NO_CONTENT);
    });

    test('rejects an unsupported inline mime type', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const res = await gemini.extractLineItems({ inlineData: 'AAAA', mimeType: 'application/zip' });
      expect(res.status).toBe(EXTRACTION_STATUS.UNSUPPORTED_TYPE);
    });

    test('rejects an oversized document before spending a request', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn();
      const huge = 'A'.repeat(GEMINI_CONFIG.MAX_DOCUMENT_BYTES * 2);

      const res = await gemini.extractLineItems({ inlineData: huge, mimeType: 'application/pdf' });

      expect(res.status).toBe(EXTRACTION_STATUS.DOCUMENT_TOO_LARGE);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('extracts line items on a successful call', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(
        geminiReply(
          JSON.stringify({
            documentTitle: 'Pump Requirement',
            category: 'Engineering Spares - Mechanical',
            deliveryDate: '2026-09-15',
            estimatedBudget: '₹ 1,45,000',
            items: [{ itemDescription: 'Centrifugal Pump', quantity: 12, unit: 'Units' }],
          })
        )
      );

      const res = await gemini.extractLineItems({ documentText: 'Pump | 12', fileName: 'boq.xlsx' });

      expect(res.status).toBe(EXTRACTION_STATUS.SUCCESS);
      expect(res.lineItems).toHaveLength(1);
      expect(res.documentTitle).toBe('Pump Requirement');
      expect(res.deliveryDate).toBe('2026-09-15');
      expect(res.estimatedBudget).toBe(145000);
      expect(res.model).toBe(GEMINI_CONFIG.PRIMARY_MODEL);
    });

    test('leaves the budget null when the document states no overall value', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Pump"}]}'));

      const res = await gemini.extractLineItems({ documentText: 'Pump' });

      expect(res.estimatedBudget).toBeNull();
    });

    test('sends the key as a header, never in the URL', async () => {
      GEMINI_CONFIG.API_KEY = 'secret-key';
      global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Pump"}]}'));

      await gemini.extractLineItems({ documentText: 'Pump' });

      const [url, init] = global.fetch.mock.calls[0];
      expect(url).not.toContain('secret-key');
      expect(init.headers['x-goog-api-key']).toBe('secret-key');
    });

    test('reports NO_ITEMS_FOUND when the model finds nothing quotable', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[]}'));

      const res = await gemini.extractLineItems({ documentText: 'Dear team, thanks.' });

      expect(res.status).toBe(EXTRACTION_STATUS.NO_ITEMS_FOUND);
      expect(res.lineItems).toEqual([]);
    });

    test('falls back to the next model when the primary one errors', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'overloaded' })
        .mockResolvedValueOnce(geminiReply('{"items":[{"itemDescription":"Valve","quantity":3}]}'));

      const res = await gemini.extractLineItems({ documentText: 'Valve | 3' });

      expect(res.status).toBe(EXTRACTION_STATUS.SUCCESS);
      expect(res.model).toBe(GEMINI_CONFIG.FALLBACK_MODELS[0]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('reports AI_FAILED once every model has been tried', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

      const res = await gemini.extractLineItems({ documentText: 'Pump' });

      expect(res.status).toBe(EXTRACTION_STATUS.AI_FAILED);
      expect(res.error).toContain('network down');
      expect(global.fetch).toHaveBeenCalledTimes(gemini.resolveModelChain().length);
    });

    // A model that never responds must not hang the request forever.
    test('aborts a model that exceeds the configured timeout', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn((_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        })
      );

      const originalTimeout = GEMINI_CONFIG.REQUEST_TIMEOUT_MS;
      GEMINI_CONFIG.REQUEST_TIMEOUT_MS = 5;
      try {
        const res = await gemini.extractLineItems({ documentText: 'Pump' });
        expect(res.status).toBe(EXTRACTION_STATUS.AI_FAILED);
        expect(res.error).toContain('abort');
      } finally {
        GEMINI_CONFIG.REQUEST_TIMEOUT_MS = originalTimeout;
      }
    });

    // The chain is walked inside a browser request, so it has to answer while a
    // client is still listening rather than running timeout x models.
    test('stops before the first model when the time budget is already spent', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn();

      const originalBudget = GEMINI_CONFIG.TOTAL_BUDGET_MS;
      GEMINI_CONFIG.TOTAL_BUDGET_MS = 0;
      try {
        const res = await gemini.extractLineItems({ documentText: 'Pump' });

        expect(res.status).toBe(EXTRACTION_STATUS.AI_FAILED);
        expect(res.error).toContain('time budget exhausted');
        // No request is started that could not have finished.
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        GEMINI_CONFIG.TOTAL_BUDGET_MS = originalBudget;
      }
    });

    test('caps a single attempt at the budget still remaining', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
          })
      );

      const originalBudget = GEMINI_CONFIG.TOTAL_BUDGET_MS;
      const originalMin = GEMINI_CONFIG.MIN_ATTEMPT_MS;
      const originalTimeout = GEMINI_CONFIG.REQUEST_TIMEOUT_MS;
      // Per-attempt timeout far exceeds the budget, so the budget must win.
      GEMINI_CONFIG.TOTAL_BUDGET_MS = 20;
      GEMINI_CONFIG.MIN_ATTEMPT_MS = 1;
      GEMINI_CONFIG.REQUEST_TIMEOUT_MS = 60000;
      try {
        const startedAt = Date.now();
        const res = await gemini.extractLineItems({ documentText: 'Pump' });

        expect(res.status).toBe(EXTRACTION_STATUS.AI_FAILED);
        // Would sit for 60s per model without the cap.
        expect(Date.now() - startedAt).toBeLessThan(2000);
      } finally {
        GEMINI_CONFIG.TOTAL_BUDGET_MS = originalBudget;
        GEMINI_CONFIG.MIN_ATTEMPT_MS = originalMin;
        GEMINI_CONFIG.REQUEST_TIMEOUT_MS = originalTimeout;
      }
    });

    test('treats an unparseable reply as a model failure', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(geminiReply('I could not read that document.'));

      const res = await gemini.extractLineItems({ documentText: 'Pump' });

      expect(res.status).toBe(EXTRACTION_STATUS.AI_FAILED);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/rfqs/extract', () => {
  const originalKey = GEMINI_CONFIG.API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    GEMINI_CONFIG.API_KEY = originalKey;
    global.fetch = originalFetch;
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/api/rfqs/extract').send({ fileName: 'boq.xlsx' });
    expect(res.statusCode).toBe(401);
  });

  test('rejects a payload with no file name', async () => {
    const res = await request(app).post('/api/rfqs/extract').set(authHeader('buyer')).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.fieldErrors.fileName).toBeDefined();
  });

  test('classifies extracted rows into a review-ready draft', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(
      geminiReply(
        JSON.stringify({
          documentTitle: 'Q3 Mechanical Spares',
          items: [
            { itemDescription: 'Centrifugal Water Pump 500 GPM', quantity: 12, unit: 'Units' },
            { itemDescription: 'Flanged Gate Valve 4 inch', quantity: 24, unit: 'Units' },
          ],
        })
      )
    );

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12 | Units\nValve | 24 | Units' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Q3 Mechanical Spares');
    expect(res.body.data.extractedEntities).toHaveLength(2);
    // The shared taxonomy classifier runs on AI output too.
    expect(res.body.data.extractedEntities[0].minorCategory).toBe('Pumps & Accessories');
    expect(res.body.extraction.model).toBe(GEMINI_CONFIG.PRIMARY_MODEL);
  });

  test('returns the overall value stated on the document as the budget', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(
      geminiReply(
        JSON.stringify({
          estimatedBudget: 890000,
          // Line totals are ignored once the document states a grand total.
          items: [{ itemDescription: 'Centrifugal Pump', quantity: 2, totalPrice: 1000 }],
        })
      )
    );

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 2' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.estimatedBudget).toBe(890000);
  });

  test('sums the priced line items when no overall total is stated', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(
      geminiReply(
        JSON.stringify({
          items: [
            { itemDescription: 'Centrifugal Pump', quantity: 12, totalPrice: 240000 },
            // Priced per unit only, so the line value is rate x quantity.
            { itemDescription: 'Flanged Gate Valve', quantity: 24, unitPrice: 4500 },
            // Unpriced: contributes nothing rather than dragging the total down.
            { itemDescription: 'Gasket Set', quantity: 10 },
          ],
        })
      )
    );

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'rows' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.estimatedBudget).toBe(240000 + 4500 * 24);
  });

  test('reports a null budget when the document carries no pricing at all', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Centrifugal Pump","quantity":12}]}'));

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.estimatedBudget).toBeNull();
  });

  // The wizard relies on `reason` to decide which message to show the buyer.
  test('returns 422 with NOT_CONFIGURED when no API key is present', async () => {
    GEMINI_CONFIG.API_KEY = '';

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.statusCode).toBe(422);
    expect(res.body.reason).toBe(EXTRACTION_STATUS.NOT_CONFIGURED);
    expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.NOT_CONFIGURED);
  });

  test('returns 422 with NO_ITEMS_FOUND when the document has no line items', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[]}'));

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'note.pdf', documentText: 'Dear team, please find attached.' });

    expect(res.statusCode).toBe(422);
    expect(res.body.reason).toBe(EXTRACTION_STATUS.NO_ITEMS_FOUND);
    expect(res.body.error).toContain('manually');
  });

  test('returns 422 with AI_FAILED when every model errors', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.statusCode).toBe(422);
    expect(res.body.reason).toBe(EXTRACTION_STATUS.AI_FAILED);
  });

  // Defends the contract between extraction and classification: if the taxonomy
  // layer ever rejects every row the model returned, the endpoint must still tell
  // the buyer to key them rather than returning an empty success.
  test('returns 422 when classification accepts none of the extracted rows', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Pump","quantity":1}]}'));
    const ingestion = require('../src/services/rfqIngestionService');
    const spy = jest.spyOn(ingestion, 'buildRFQDraft').mockReturnValue({
      draft: { extractedEntities: [] },
      classification: { totalExtracted: 1, accepted: 0, duplicatesRemoved: 0, needsReview: 0, autoClassified: 0 },
    });

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 1' });

    expect(res.statusCode).toBe(422);
    expect(res.body.reason).toBe(EXTRACTION_STATUS.NO_ITEMS_FOUND);
    spy.mockRestore();
  });

  // An unrecognised status must still produce a usable message.
  test('falls back to the generic message for an unknown extraction status', async () => {
    const spy = jest.spyOn(gemini, 'extractLineItems').mockResolvedValue({
      status: 'SOMETHING_NEW',
      lineItems: [],
      model: null,
      documentTitle: null,
      category: null,
      deliveryDate: null,
      error: null,
    });

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump' });

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.AI_FAILED);
    spy.mockRestore();
  });

  test('surfaces an unexpected service fault through the error handler', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    const spy = jest.spyOn(gemini, 'extractLineItems').mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'Pump' });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    spy.mockRestore();
  });

  // Every AI-extracted row still lands on a real taxonomy value, so an item the
  // classifier cannot place is flagged for review rather than silently accepted.
  test('flags unclassifiable extracted rows for review', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Assorted unnamed widget","quantity":2}]}'));

    const res = await request(app)
      .post('/api/rfqs/extract')
      .set(authHeader('buyer'))
      .send({ fileName: 'BOQ.xlsx', documentText: 'widget | 2' });

    expect(res.statusCode).toBe(200);
    expect(res.body.classification.needsReview).toBe(1);
  });
});
