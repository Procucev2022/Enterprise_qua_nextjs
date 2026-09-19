const request = require('supertest');
const app = require('../src/app');
const gemini = require('../src/services/geminiService');
const { GEMINI_CONFIG, EXTRACTION_REASON_MESSAGES, EMAIL_INGESTION_STATUS } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');
const { PLAIN_REQUISITION_EML, EMPTY_BODY_EML, toBase64 } = require('./fixtures/sampleRequisitionEmail');

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

    test.each(['', '   ', 'no json here', '{ broken', 'null', '{ invalid json syntax }'])('returns null for %p', (input) => {
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

    test('carries brand and location fields from item or document level', () => {
      const rowsItem = gemini.toRawLineItems({
        items: [
          {
            itemDescription: 'Dell Latitude',
            brand: 'Dell',
            deliveryCity: 'Pune',
            deliveryState: 'Maharashtra',
            deliveryPincode: '411001',
            deliveryLocation: 'Pune Hub',
          },
        ],
      });
      expect(rowsItem[0].brand).toBe('Dell');
      expect(rowsItem[0].deliveryCity).toBe('Pune');
      expect(rowsItem[0].deliveryState).toBe('Maharashtra');
      expect(rowsItem[0].deliveryPincode).toBe('411001');
      expect(rowsItem[0].deliveryLocation).toBe('Pune Hub');

      const rowsDoc = gemini.toRawLineItems({
        deliveryCity: 'Bangalore',
        deliveryState: 'Karnataka',
        deliveryPincode: '560001',
        deliveryLocation: 'Bangalore Plant',
        items: [{ itemDescription: 'HP Laptop' }],
      });
      expect(rowsDoc[0].deliveryCity).toBe('Bangalore');
      expect(rowsDoc[0].deliveryState).toBe('Karnataka');
      expect(rowsDoc[0].deliveryPincode).toBe('560001');
      expect(rowsDoc[0].deliveryLocation).toBe('Bangalore Plant');
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

    describe('callModel and multi-key support', () => {
      test('throws error when no API key is configured', async () => {
        GEMINI_CONFIG.API_KEY = '';
        await expect(gemini.callModel('gemini-1.5-flash', {})).rejects.toThrow('No Gemini API key available');
      });

      test('fails over to next API key when first key returns error response', async () => {
        GEMINI_CONFIG.API_KEY = 'key-primary, key-backup';
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Quota exceeded' })
          .mockResolvedValueOnce(geminiReply('{"items":[{"itemDescription":"Valve"}]}'));

        const parsed = await gemini.callModel('gemini-1.5-flash', {});
        expect(parsed).toEqual({ items: [{ itemDescription: 'Valve' }] });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key-primary');
        expect(global.fetch.mock.calls[1][1].headers['x-goog-api-key']).toBe('key-backup');
      });

      test('fails over to next key on network error and throws if all fail', async () => {
        GEMINI_CONFIG.API_KEY = 'key-primary, key-backup';
        global.fetch = jest
          .fn()
          .mockRejectedValueOnce(new Error('Network drop on primary'))
          .mockRejectedValueOnce(new Error('Network drop on backup'));

        await expect(gemini.callModel('gemini-1.5-flash', {})).rejects.toThrow('Network drop on backup');
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      test('immediately throws without retry on AbortError', async () => {
        GEMINI_CONFIG.API_KEY = 'key-primary, key-backup';
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        global.fetch = jest.fn().mockRejectedValue(abortErr);

        await expect(gemini.callModel('gemini-1.5-flash', {})).rejects.toThrow('The operation was aborted');
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      test('rotates cyclically through multiple keys and retains working key', async () => {
        GEMINI_CONFIG.API_KEY = 'key-1, key-2, key-3';
        gemini.setActiveKeyIndex(0);
        expect(gemini.getActiveKeyIndex()).toBe(0);

        // First call: key-1 fails (401), key-2 succeeds
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' })
          .mockResolvedValueOnce(geminiReply('{"items":[{"itemDescription":"Gasket"}]}'));

        const parsed1 = await gemini.callModel('gemini-1.5-flash', {});
        expect(parsed1).toEqual({ items: [{ itemDescription: 'Gasket' }] });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key-1');
        expect(global.fetch.mock.calls[1][1].headers['x-goog-api-key']).toBe('key-2');
        expect(gemini.getActiveKeyIndex()).toBe(1);

        // Next call starts directly with the retained working key (key-2)
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce(geminiReply('{"items":[{"itemDescription":"Bolt"}]}'));

        const parsed2 = await gemini.callModel('gemini-1.5-flash', {});
        expect(parsed2).toEqual({ items: [{ itemDescription: 'Bolt' }] });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key-2');

        // When starting from key-3 (index 2), if key-3 fails, it cyclically loops back to key-1 (index 0)
        gemini.setActiveKeyIndex(2);
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limit' })
          .mockResolvedValueOnce(geminiReply('{"items":[{"itemDescription":"Nut"}]}'));

        const parsed3 = await gemini.callModel('gemini-1.5-flash', {});
        expect(parsed3).toEqual({ items: [{ itemDescription: 'Nut' }] });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('key-3');
        expect(global.fetch.mock.calls[1][1].headers['x-goog-api-key']).toBe('key-1');
        expect(gemini.getActiveKeyIndex()).toBe(0);
      });
    });

    describe('resolveApiKeys and isConfigured', () => {
      test('resolveApiKeys returns empty array when API_KEY is empty or whitespace', () => {
        GEMINI_CONFIG.API_KEY = '';
        expect(gemini.resolveApiKeys()).toEqual([]);
        GEMINI_CONFIG.API_KEY = '   ';
        expect(gemini.resolveApiKeys()).toEqual([]);
      });

      test('resolveApiKeys parses single and multiple comma-separated keys with trimming', () => {
        GEMINI_CONFIG.API_KEY = 'key-one';
        expect(gemini.resolveApiKeys()).toEqual(['key-one']);

        GEMINI_CONFIG.API_KEY = ' key1 , key2,  key3  ';
        expect(gemini.resolveApiKeys()).toEqual(['key1', 'key2', 'key3']);
      });

      test('isConfigured returns true when at least one key is present', () => {
        GEMINI_CONFIG.API_KEY = ' key1 ';
        expect(gemini.isConfigured()).toBe(true);
        GEMINI_CONFIG.API_KEY = '   ';
        expect(gemini.isConfigured()).toBe(false);
      });
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

  // A buyer uploading their own .eml/.msg goes through emailIngestionService's
  // real MIME parsing first, then the same Gemini extraction/classification as
  // every other document — see rfqController.extractRFQFromDocument.
  describe('uploading a raw .eml/.msg', () => {
    test('parses the email, extracts line items, and records the sender as sourceEmail', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(
        geminiReply(
          JSON.stringify({
            documentTitle: 'Requisition - Centrifugal Pumps for Hazira Expansion',
            items: [
              { itemDescription: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' },
              { itemDescription: 'Gate Valve 200mm', quantity: 12, unit: 'Nos' },
            ],
          })
        )
      );

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'original_msg.eml', inlineData: toBase64(PLAIN_REQUISITION_EML), mimeType: 'message/rfc822' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.extractedEntities).toHaveLength(2);
      expect(res.body.data.sourceEmail).toBe('project.procurement@lt-heavy.com');
      // The parsed email's own text (not the raw base64) reached the extractor.
      const [, init] = global.fetch.mock.calls[0];
      expect(String(init.body)).toContain('Centrifugal Pump, 150 m3/hr, 40m head, CI casing - 4 Nos');
    });

    test('returns 422 NO_CONTENT for an email with no readable body or attachment', async () => {
      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'empty.eml', inlineData: toBase64(EMPTY_BODY_EML), mimeType: 'message/rfc822' });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(EMAIL_INGESTION_STATUS.NO_CONTENT);
      expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.NO_CONTENT);
    });

    test('returns 422 NO_CONTENT for a .eml upload with an empty body', async () => {
      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'blank.eml', inlineData: '', mimeType: 'message/rfc822' });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(EMAIL_INGESTION_STATUS.NO_CONTENT);
    });

    test('returns 422 UNREADABLE when the message cannot be parsed', async () => {
      const emailIngestionService = require('../src/services/emailIngestionService');
      const spy = jest.spyOn(emailIngestionService, 'parseEmailMessage').mockRejectedValue(new Error('bad mime'));

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'broken.eml', inlineData: toBase64(PLAIN_REQUISITION_EML), mimeType: 'message/rfc822' });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(EMAIL_INGESTION_STATUS.UNREADABLE);
      expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.UNREADABLE);
      spy.mockRestore();
    });

    test('returns 422 TOO_LARGE for an oversized .eml', async () => {
      const { EMAIL_INGESTION_CONFIG } = require('../src/config/constants');
      const huge = Buffer.alloc(EMAIL_INGESTION_CONFIG.MAX_BYTES + 1, 'a').toString('base64');

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'huge.eml', inlineData: huge, mimeType: 'message/rfc822' });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(EMAIL_INGESTION_STATUS.TOO_LARGE);
      expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.TOO_LARGE);
    });

    test('returns 422 OUTLOOK_MSG_UNSUPPORTED for a .msg upload', async () => {
      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'requisition.msg', inlineData: toBase64('not really rfc822'), mimeType: 'application/vnd.ms-outlook' });

      expect(res.statusCode).toBe(422);
      expect(res.body.reason).toBe(EMAIL_INGESTION_STATUS.OUTLOOK_MSG_UNSUPPORTED);
      expect(res.body.error).toBe(EXTRACTION_REASON_MESSAGES.OUTLOOK_MSG_UNSUPPORTED);
    });

    test('a non-.eml, non-.msg upload is unaffected (regression check)', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue(geminiReply('{"items":[{"itemDescription":"Pump","quantity":1}]}'));

      const res = await request(app)
        .post('/api/rfqs/extract')
        .set(authHeader('buyer'))
        .send({ fileName: 'BOQ.xlsx', documentText: 'Pump | 1' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.sourceEmail).toBeUndefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// generateJson: the reusable prompt path
//
// Added so callers needing a different prompt — the RFQ summary is the first —
// share the model chain, the per-attempt timeout and the one shared deadline
// instead of each re-implementing the transport. Like extractLineItems it must
// never throw: every failure comes back as a status the caller can act on.
// ══════════════════════════════════════════════════════════════════════════════
describe('geminiService.generateJson', () => {
  const originalKey = GEMINI_CONFIG.API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    GEMINI_CONFIG.API_KEY = originalKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns the parsed JSON and the model that produced it', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn(async () => geminiReply('{"headline":"Two pumps","scope":"A package."}'));

    const result = await gemini.generateJson({ prompt: 'Summarise this', label: 'RFQ summary' });

    expect(result.status).toBe(EXTRACTION_STATUS.SUCCESS);
    expect(result.data).toEqual({ headline: 'Two pumps', scope: 'A package.' });
    expect(result.model).toBeTruthy();
    expect(result.error).toBeNull();
  });

  test('sends the prompt and asks for a JSON response', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    const fetchMock = jest.fn(async () => geminiReply('{"ok":true}'));
    global.fetch = fetchMock;

    await gemini.generateJson({ prompt: 'My exact prompt' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toBe('My exact prompt');
    expect(body.generationConfig.response_mime_type).toBe('application/json');
    // The key travels in a header, never the URL, so it stays out of logs.
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('test-key');
    expect(fetchMock.mock.calls[0][0]).not.toContain('test-key');
  });

  test('reports NOT_CONFIGURED without calling out when no key is set', async () => {
    GEMINI_CONFIG.API_KEY = '';
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await gemini.generateJson({ prompt: 'Summarise this' });

    expect(result.status).toBe(EXTRACTION_STATUS.NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([[''], ['   '], [undefined], [null], [42]])(
    'reports NO_CONTENT for a prompt of %p',
    async (prompt) => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const result = await gemini.generateJson({ prompt });

      expect(result.status).toBe(EXTRACTION_STATUS.NO_CONTENT);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  test('reports NO_CONTENT when called with no input at all', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    expect((await gemini.generateJson()).status).toBe(EXTRACTION_STATUS.NO_CONTENT);
  });

  test('falls through the model chain and reports every failure', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'unavailable' }));

    const result = await gemini.generateJson({ prompt: 'Summarise this' });

    expect(result.status).toBe(EXTRACTION_STATUS.AI_FAILED);
    expect(result.data).toBeNull();
    expect(result.error).toContain('503');
  });

  test('recovers on a later model in the chain', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return geminiReply('{"headline":"h","scope":"s"}');
    });

    const result = await gemini.generateJson({ prompt: 'Summarise this' });

    expect(result.status).toBe(EXTRACTION_STATUS.SUCCESS);
    expect(calls).toBe(2);
  });

  test('reports AI_FAILED when a model returns no parseable JSON', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    global.fetch = jest.fn(async () => geminiReply('I cannot help with that.'));

    const result = await gemini.generateJson({ prompt: 'Summarise this' });
    expect(result.status).toBe(EXTRACTION_STATUS.AI_FAILED);
  });

  // One deadline covers the whole chain, so a run of slow failures degrades into
  // a reported fallback rather than a request nobody is still waiting on.
  test('stops trying once the shared time budget is exhausted', async () => {
    GEMINI_CONFIG.API_KEY = 'test-key';
    const originalBudget = GEMINI_CONFIG.TOTAL_BUDGET_MS;
    GEMINI_CONFIG.TOTAL_BUDGET_MS = 0;
    try {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const result = await gemini.generateJson({ prompt: 'Summarise this' });

      expect(result.status).toBe(EXTRACTION_STATUS.AI_FAILED);
      expect(result.error).toContain('time budget exhausted');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      GEMINI_CONFIG.TOTAL_BUDGET_MS = originalBudget;
    }
  });

  describe('extractQuotationFallback & extractQuotationFromEmail', () => {
    const sampleRfq = {
      id: 'rfq-test-1',
      rfqNumber: 'RFQ-2026-00421',
      extractedEntities: [
        { itemName: 'Centrifugal Pump 150 m3/hr', quantity: 4, unit: 'Nos' },
        { itemName: 'Gate Valve 100mm', quantity: 10, unit: 'Nos' },
      ],
    };

    test('extractQuotationFallback extracts prices, terms, and line items via regex', () => {
      const emailText = `
        Dear Buyer,
        Here is our bid for RFQ-2026-00421:
        1. Centrifugal Pump: INR 12500 per unit, qty 4
        2. Gate Valve: Rs. 3500 per unit, qty 10
        Lead Time: 14 days
        Warranty: 2 years
        Payment Terms: Net 30 Days
        Taxes: 18% GST extra
        Freight charges: INR 5000
        Remarks: Standard warranty included
      `;

      const result = gemini.extractQuotationFallback(emailText, sampleRfq);
      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('heuristic_fallback');
      expect(result.leadTimeDays).toBe(14);
      expect(result.warrantyYears).toBe(2);
      expect(result.paymentTerms).toBe('Net 30 Days');
      expect(result.taxes).toBeGreaterThan(0);
      expect(result.deliveryCharges).toBe(5000);
      expect(result.lineItemQuotes.length).toBe(2);
      expect(result.lineItemQuotes[0].unitPrice).toBe(12500);
      expect(result.lineItemQuotes[1].unitPrice).toBe(3500);
      expect(result.totalPrice).toBe(4 * 12500 + 10 * 3500);
    });

    test('extractQuotationFallback uses default values when fields are missing', () => {
      const emailText = 'We cannot provide pricing at this moment.';
      const result = gemini.extractQuotationFallback(emailText, sampleRfq);
      expect(result).toBeDefined();
      expect(result.unitPrice).toBe(0);
      expect(result.leadTimeDays).toBe(7);
      expect(result.warrantyYears).toBe(1);
    });

    test('extractQuotationFromEmail returns parsed AI quote when Gemini succeeds', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const aiResponse = {
        unitPrice: 15000,
        totalPrice: 60000,
        leadTimeDays: 10,
        warrantyYears: 3,
        paymentTerms: '100% Against Dispatch',
        complianceStatus: 'Fully Compliant',
        taxes: 18,
        deliveryCharges: 2500,
        deliveryDate: '2026-10-15',
        remarks: 'All items ex-stock',
        lineItemQuotes: [
          {
            itemName: 'Centrifugal Pump 150 m3/hr',
            quantity: 4,
            unitPrice: 15000,
            totalPrice: 60000,
            leadTimeDays: 10,
            warrantyYears: 3,
            remarks: 'Ex-stock',
          },
        ],
      };

      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponse)));

      const result = await gemini.extractQuotationFromEmail({ bodyText: 'Quotation body' }, sampleRfq);
      expect(result).toBeDefined();
      expect(result.unitPrice).toBe(15000);
      expect(result.leadTimeDays).toBe(10);
      expect(result.warrantyYears).toBe(3);
      expect(result.lineItemQuotes.length).toBe(1);
    });

    test('extractQuotationFromEmail falls back to regex parser when Gemini fails or key is missing', async () => {
      delete GEMINI_CONFIG.API_KEY;
      const emailText = 'Unit price: INR 8500, Lead time: 7 days, Warranty: 2 years, Payment terms: Net 45';
      const result = await gemini.extractQuotationFromEmail({ bodyText: emailText }, sampleRfq);

      expect(result).toBeDefined();
      expect(result.extractionMethod).toBe('heuristic_fallback');
      expect(result.unitPrice).toBe(8500);
      expect(result.leadTimeDays).toBe(7);
      expect(result.warrantyYears).toBe(2);
    });

    test('extractQuotationFromEmail handles empty lineItemQuotes and calculates defaults from rfqItems', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const aiResponse = {
        unitPrice: 5000,
        complianceStatus: 'Minor Exception',
        taxes: 1000,
        deliveryCharges: 200,
        deliveryDate: '2026-12-01',
        quotationValidity: '45 days',
        lineItemQuotes: [], // triggers rfqItems mapping
      };

      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponse)));
      const result = await gemini.extractQuotationFromEmail(
        { bodyText: 'Quoted 5000', subject: 'Bid RFQ', fromAddress: 'vendor@test.com' },
        { ...sampleRfq, targetDeliveryDate: '2026-12-15' }
      );

      expect(result.complianceStatus).toBe('Minor Exception');
      expect(result.taxes).toBe(1000);
      expect(result.deliveryCharges).toBe(200);
      expect(result.quotationValidity).toBe('45 days');
      expect(result.lineItemQuotes.length).toBe(2);
      expect(result.lineItemQuotes[0].unitPrice).toBe(5000);
      expect(result.lineItemQuotes[0].tax).toBe(500);
    });

    test('extractQuotationFromEmail maps partial lineItemQuotes with missing fields and handles invalid complianceStatus', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const aiResponse = {
        unitPrice: 1200,
        complianceStatus: 'InvalidStatusThatDefaults',
        lineItemQuotes: [
          {
            // missing itemName, quantity, unitPrice, totalPrice, tax, deliveryDate
          },
        ],
      };

      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponse)));
      const result = await gemini.extractQuotationFromEmail({ text: 'Quote details' }, sampleRfq);

      expect(result.complianceStatus).toBe('Fully Compliant');
      expect(result.lineItemQuotes[0].itemName).toBe('Centrifugal Pump 150 m3/hr');
      expect(result.lineItemQuotes[0].unitPrice).toBe(1200);
    });

    test('extractQuotationFromEmail falls through to fallback when Gemini result is not successful or non-object', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'error' }));

      const result = await gemini.extractQuotationFromEmail({ bodyText: 'Price is INR 4500' }, sampleRfq);
      expect(result.extractionMethod).toBe('heuristic_fallback');
      expect(result.unitPrice).toBe(4500);
    });

    test('extractQuotationFallback exercises alternate fields, shipping, freight, and item matching', () => {
      const emailText = `
        Quote for items:
        Centrifugal Pump: Rs 9000 each
        Shipping charges: INR 1500
        Total amount: Rs 45000
        Payment terms: 30 days advance
        Remarks: Delivery within 10 days
      `;
      const rfqWithLineItems = {
        rfqNumber: 'RFQ-LINE-1',
        title: 'Line Item Test',
        targetDeliveryDate: '2026-11-20',
        lineItems: [
          { description: 'Centrifugal Pump 150 m3/hr', quantity: 2, unit: 'Nos', targetDate: '2026-11-20' },
        ],
      };

      const result = gemini.extractQuotationFallback(emailText, rfqWithLineItems);
      expect(result.deliveryCharges).toBe(1500);
      expect(result.lineItemQuotes[0].unitPrice).toBe(9000);
      expect(result.paymentTerms).toBe('30 days advance');
      expect(result.totalPrice).toBe(18000);
    });

    test('extractQuotationFallback exercises week/month lead times, warranty months, total-only pricing and taxes', () => {
      const emailText = 'Total price: INR 60000, 2 weeks delivery, 24 months warranty, GST: 18%';
      const rfqCtx = {
        lineItems: [{ itemName: 'Item A', quantity: 2 }, { itemName: 'Item B', quantity: 1 }],
      };
      const res = gemini.extractQuotationFallback(emailText, rfqCtx);
      expect(res.unitPrice).toBe(20000);
      expect(res.leadTimeDays).toBe(14);
      expect(res.warrantyYears).toBe(2);
      expect(res.taxes).toBeGreaterThan(0);

      const emailText2 = 'Dispatch in 1 month, 3 years guarantee';
      const res2 = gemini.extractQuotationFallback(emailText2, {});
      expect(res2.leadTimeDays).toBe(30);
      expect(res2.warrantyYears).toBe(3);
    });

    test('extractQuotationFallback covers unitPrice without totalPrice, freight charges, and missing descriptions', () => {
      const emailText = 'Unit price: INR 1500, freight charges: 300, payment: 100% advance, remarks: prompt dispatch';
      const rfqCtx = {
        lineItems: [
          { quantity: 4 }, // missing itemName and description -> triggers "Item 1"
          { description: 'Secondary Component', quantity: 2, targetDate: '2026-12-01' }
        ]
      };
      const result = gemini.extractQuotationFallback(emailText, rfqCtx);
      expect(result.unitPrice).toBe(1500);
      expect(result.totalPrice).toBe(9000); // 1500 * (4 + 2)
      expect(result.deliveryCharges).toBe(300);
      expect(result.paymentTerms).toBe('100% advance');
      expect(result.lineItemQuotes[0].itemName).toBe('Item 1');
      expect(result.lineItemQuotes[1].itemName).toBe('Secondary Component');
    });

    test('extractQuotationFromEmail covers branch where lineItemQuotes is empty and uses rfqItems mapping with location and specs', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      const aiResponse = {
        unitPrice: 2500,
        totalPrice: 5000,
        leadTimeDays: 10,
        warrantyYears: 2,
        paymentTerms: 'Net 45',
        complianceStatus: 'Pending Review',
        deliveryDate: '2026-11-15',
        quotationValidity: '60 days',
        taxes: 500,
        deliveryCharges: 100,
        lineItemQuotes: [], // empty -> triggers rfqItems.map fallback branch (lines 669-676)
      };

      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponse)));
      const rfqContext = {
        rfqNumber: 'RFQ-BRANCH-TEST',
        title: 'Branch Test RFQ',
        category: 'Electronics',
        budget: 10000,
        lineItems: [
          { itemName: 'Relay Board', quantity: 2, technicalSpecs: '24V DC', targetDate: '2026-11-15' },
          { description: 'Sensor Module', quantity: 1, specification: '4-20mA' },
        ],
      };

      const result = await gemini.extractQuotationFromEmail(
        { bodyText: 'Quotation details', subject: 'Quote RFQ-BRANCH-TEST', fromAddress: 'vendor@branch.com' },
        rfqContext
      );

      expect(result.extractionMethod).toBe('gemini_ai');
      expect(result.complianceStatus).toBe('Pending Review');
      expect(result.unitPrice).toBe(2500);
      expect(result.totalPrice).toBe(5000);
      expect(result.lineItemQuotes.length).toBe(2);
      expect(result.lineItemQuotes[0].itemName).toBe('Relay Board');
      expect(result.lineItemQuotes[1].itemName).toBe('Sensor Module');
      expect(result.lineItemQuotes[0].tax).toBe(250);
    });

    test('extractLineItems covers delivery location strings and default empty input', async () => {
      GEMINI_CONFIG.API_KEY = 'test-key';
      global.fetch = jest.fn(async () => geminiReply(JSON.stringify({
        documentTitle: 'Industrial Order',
        category: 'Valves',
        deliveryDate: '2026-12-31',
        deliveryLocation: 'Gate 4 Industrial Estate',
        deliveryCity: 'Pune',
        deliveryState: 'Maharashtra',
        deliveryPincode: '411001',
        estimatedBudget: 75000,
        items: [{ itemDescription: 'Control Valve DN50', quantity: 5 }]
      })));

      // Call extractLineItems with delivery location fields
      const res = await gemini.extractLineItems({
        documentText: 'Control Valve DN50 qty 5',
        fileName: 'valves.txt',
      });

      expect(res.status).toBe(EXTRACTION_STATUS.SUCCESS);
      expect(res.deliveryLocation).toBe('Gate 4 Industrial Estate');
      expect(res.deliveryCity).toBe('Pune');
      expect(res.deliveryState).toBe('Maharashtra');
      expect(res.deliveryPincode).toBe('411001');

      // Call extractLineItems() with default empty parameter
      const emptyRes = await gemini.extractLineItems();
      expect(emptyRes.status).toBe(EXTRACTION_STATUS.NO_CONTENT);
    });

    test('covers extractQuotationFallback and extractQuotationFromEmail defaults and total price fallbacks', async () => {
      // 1. extractQuotationFallback() with no arguments
      const emptyFallback = gemini.extractQuotationFallback();
      expect(emptyFallback.unitPrice).toBe(0);
      expect(emptyFallback.totalPrice).toBe(0);

      // 2. extractQuotationFromEmail() with no arguments (uses heuristic fallback when GEMINI_CONFIG.API_KEY is empty)
      GEMINI_CONFIG.API_KEY = '';
      const emptyEmailQuote = await gemini.extractQuotationFromEmail();
      expect(emptyEmailQuote.unitPrice).toBe(0);

      // 3. extractQuotationFromEmail with AI success where totalPrice is 0 and lineItemQuotes has full fields
      GEMINI_CONFIG.API_KEY = 'test-key';
      const aiResponse = {
        unitPrice: 300,
        totalPrice: 0, // tests totalPrice || unitPrice branch
        lineItemQuotes: [
          { itemName: 'Component Alpha', quantity: 2, unitPrice: 300, totalPrice: 600, tax: 60, deliveryDate: '2026-10-10' }
        ]
      };
      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponse)));
      const resWithDefaults = await gemini.extractQuotationFromEmail(
        { bodyText: 'Quoting 300' },
        { lineItems: [{ description: 'Component Alpha', quantity: 2 }] } // tests rfqItems fallback to lineItems & description
      );
      expect(resWithDefaults.unitPrice).toBe(300);
      expect(resWithDefaults.totalPrice).toBe(300);
      expect(resWithDefaults.lineItemQuotes[0].itemName).toBe('Component Alpha');

      // 4. extractQuotationFallback where unitPrice is initially 0 but line item has a price
      const itemQuoteFallback = gemini.extractQuotationFallback(
        'Turbo Pump: 5000 per unit',
        { lineItems: [{ itemName: 'Turbo Pump', quantity: 3 }] }
      );
      expect(itemQuoteFallback.unitPrice).toBe(5000);
      expect(itemQuoteFallback.totalPrice).toBe(15000);

      // 5. extractQuotationFromEmail where AI response unitPrice is 0 and derived from lineItemQuotes
      const aiResponseItemOnly = {
        unitPrice: 0,
        totalPrice: 0,
        lineItemQuotes: [
          { itemName: '', quantity: 2, unitPrice: 400, totalPrice: 0 }
        ]
      };
      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponseItemOnly)));
      const resItemOnly = await gemini.extractQuotationFromEmail(
        { bodyText: 'Quoting Item X' },
        { lineItems: [{ description: 'Item X', quantity: 2 }] }
      );
      expect(resItemOnly.unitPrice).toBe(400);
      expect(resItemOnly.totalPrice).toBe(800);

      // 6. extractQuotationFromEmail with Minor Exception complianceStatus
      const aiResponseMinor = {
        unitPrice: 100,
        totalPrice: 100,
        complianceStatus: 'Minor Exception',
      };
      global.fetch = jest.fn(async () => geminiReply(JSON.stringify(aiResponseMinor)));
      const resMinor = await gemini.extractQuotationFromEmail({ bodyText: 'Test' }, {});
      expect(resMinor.complianceStatus).toBe('Minor Exception');
    });
  });
});



