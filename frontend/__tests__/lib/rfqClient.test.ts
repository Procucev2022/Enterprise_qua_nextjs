import {
  extractLineItemsFromDocument,
  extractLineItemsFromEmail,
  classifyLineItems,
  uploadRFQAttachment,
  rfqAttachmentUrl,
  createRFQ,
  fetchRFQById,
  fetchRFQList,
  updateRFQ,
  deleteRFQ,
} from '@/lib/rfqClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { RFQCreatePayload, RFQItem } from '@/lib/types';

describe('rfqClient.extractLineItemsFromDocument', () => {
  const originalFetch = global.fetch;

  const draft = {
    title: 'Pump Requirement',
    category: 'Engineering Spares - Mechanical',
    targetDeliveryDate: '2026-09-15',
    estimatedBudget: null,
    extractedEntities: [],
    source: 'web_portal' as const,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the document to the extraction endpoint and returns the draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: draft,
        classification: { totalExtracted: 1, accepted: 1, duplicatesRemoved: 0, needsReview: 0, autoClassified: 1 },
        extraction: { model: 'gemini-3.6-flash' },
      }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.success).toBe(true);
    expect(res.data?.title).toBe('Pump Requirement');
    expect(res.extraction?.model).toBe('gemini-3.6-flash');

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/extract');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: draft }),
    });

    await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');
  });

  test('omits the Authorization header when there is no session', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: draft }),
    });

    await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  // Fail closed: an unreachable API must never look like a successful extraction.
  test('reports a network failure rather than fabricating line items', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('NETWORK');
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
    expect(res.data).toBeUndefined();
  });

  test('passes the server reason and message straight through on a 422', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false, reason: 'NOT_CONFIGURED', error: 'AI extraction is not configured.' }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res).toEqual({ success: false, reason: 'NOT_CONFIGURED', error: 'AI extraction is not configured.' });
  });

  test('treats a non-JSON body as an unreadable response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('AI_FAILED');
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  // 422 is what the endpoint returns when it rejects a document, and this covers
  // the case where it omits both `reason` and `error`. A 5xx would instead be a
  // transport failure, which is reported separately and asserted further down.
  test('falls back to a default message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.reason).toBe('AI_FAILED');
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  // A 200 with success:true but no draft is malformed and must not be trusted.
  test('rejects a success response that carries no draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.success).toBe(false);
  });
});

describe('rfqClient.classifyLineItems', () => {
  const originalFetch = global.fetch;

  const row = {
    id: 'ent-1',
    itemName: 'Flanged Gate Valve 4 inch',
    quantity: 24,
    unit: 'Nos',
    targetDate: '2026-09-18',
    technicalSpecs: 'ASTM A216 WCB',
    confidence: 90,
    category: 'Pumps & Accessories',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
  };

  const classified = {
    title: 'Valve Requirement',
    category: 'Engineering Spares - Mechanical',
    targetDeliveryDate: '2026-09-18',
    estimatedBudget: null,
    extractedEntities: [{ ...row, minorCategory: 'Hoses, Valves & Fittings' }],
    source: 'web_portal' as const,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the rows to the ingest endpoint and returns the classified draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: classified,
        classification: { totalExtracted: 1, accepted: 1, duplicatesRemoved: 0, needsReview: 0, autoClassified: 1 },
      }),
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(true);
    expect(res.data?.extractedEntities[0].minorCategory).toBe('Hoses, Valves & Fittings');
    expect(res.classification?.accepted).toBe(1);

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/ingest');
    expect(init.method).toBe('POST');
  });

  // An explicit category wins server-side, so sending the current one would make
  // re-classification a no-op.
  test('withholds the categories already on the rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: classified }),
    });

    await classifyLineItems([row]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      lineItems: [
        {
          id: 'ent-1',
          itemName: 'Flanged Gate Valve 4 inch',
          quantity: 24,
          unit: 'Nos',
          targetDate: '2026-09-18',
          technicalSpecs: 'ASTM A216 WCB',
        },
      ],
    });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: classified }),
    });

    await classifyLineItems([row]);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  test('reports the network as unreachable rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('reports an unparseable reply as a classification failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.classifyFailed);
  });

  test('surfaces the server error on a rejected payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'lineItems must be an array of extracted rows.' }),
    });

    const res = await classifyLineItems([row]);

    expect(res.success).toBe(false);
    expect(res.error).toBe('lineItems must be an array of extracted rows.');
  });

  test('falls back to the generic message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false }),
    });

    const res = await classifyLineItems([row]);

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.classifyFailed);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Transport failures must not be reported as model failures
//
// When the API is stopped, the Next dev proxy answers with an HTML 500. Reporting
// the generic "unexpected response" for that blamed the AI for an unreachable
// backend, which is what made a plain "backend not started" look like a bug in
// extraction.
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqClient transport failure reporting', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('extractLineItemsFromDocument reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      // A proxy error page is HTML, so parsing must never even be attempted.
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'Pump | 12' });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('NETWORK');
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 }));
  });

  test('extractLineItemsFromDocument names the status it saw', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    const res = await extractLineItemsFromDocument({ fileName: 'BOQ.xlsx', documentText: 'x' });

    expect(res.error).toContain('502');
  });

  test('classifyLineItems reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });

    const res = await classifyLineItems([
      {
        id: 'ent-1',
        itemName: 'Flanged Gate Valve',
        quantity: 2,
        unit: 'Nos',
        targetDate: '2026-09-18',
        technicalSpecs: '',
        confidence: 90,
        category: 'Pumps & Accessories',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Pumps & Accessories',
      },
    ]);

    expect(res.success).toBe(false);
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Supporting document attachments
//
// Deliberately separate from extraction: on the manual path the document is
// evidence to keep with the RFQ, so no Gemini quota is spent reading it.
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqClient.uploadRFQAttachment', () => {
  const originalFetch = global.fetch;

  const stored = {
    id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 27,
    uploadedAt: '2026-09-02T11:07:16.000Z',
  };

  const pdf = () => new File(['%PDF-1.4 body'], 'annexure.pdf', { type: 'application/pdf' });

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the file to the attachment endpoint and returns its metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: stored }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(true);
    expect(res.data).toEqual(stored);

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/attachments');
    expect(init.method).toBe('POST');

    const sent = JSON.parse(init.body);
    expect(sent.fileName).toBe('annexure.pdf');
    expect(sent.mimeType).toBe('application/pdf');
    // Base64 only, with the data-URL prefix removed.
    expect(sent.content).not.toContain('data:');
    expect(sent.content.length).toBeGreaterThan(0);
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: stored }),
    });

    await uploadRFQAttachment(pdf());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });

  test('reports the network as unreachable rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('reports an unreachable API on a 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 }));
  });

  test('surfaces the refusal the server gave', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false, reason: 'UNSUPPORTED_TYPE', error: 'That file type cannot be attached.' }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe('That file type cannot be attached.');
  });

  test('falls back to a generic message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ success: false }),
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
  });

  test('reports an unparseable reply', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
  });

  // A file the browser cannot read must not be reported as a server fault.
  test('reports a file that cannot be read', async () => {
    global.fetch = jest.fn();
    jest.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });

    const res = await uploadRFQAttachment(pdf());

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.attachUnreachable);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('rfqAttachmentUrl', () => {
  test('addresses a stored document by id', () => {
    expect(rfqAttachmentUrl('a1b2c3d4-0000-4000-8000-abcdefabcdef')).toBe(
      '/api/rfqs/attachments/a1b2c3d4-0000-4000-8000-abcdefabcdef'
    );
  });

  test('encodes an id so it cannot alter the path', () => {
    expect(rfqAttachmentUrl('../secret')).toBe('/api/rfqs/attachments/..%2Fsecret');
  });
});

// ==============================================================================
// PERSISTENCE CALLS
// ==============================================================================
// createRFQ / fetchRFQById / fetchRFQList are the only routes RFQ data travels
// on now, and all three are authenticated and organisation-scoped server-side.
// The cases below pin down what each one reports back, because the caller has to
// distinguish "the server said no" from "the server never answered": the wizard
// keeps the buyer's keyed rows in one case and not the other.
// ==============================================================================

describe('rfqClient RFQ persistence', () => {
  const originalFetch = global.fetch;

  const RFQ: RFQItem = {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
  };

  const PAYLOAD: RFQCreatePayload = {
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    source: 'manual_entry',
    budget: 0,
    targetDeliveryDate: '2026-09-30',
    deliveryLocation: 'Navi Mumbai Plant, Gate 3',
    deliveryPincode: '400701',
    extractedEntities: [],
    attachments: [],
  };

  /** A minimal Response double. `status` is always set: the client reads it. */
  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const unreadable = (status: number) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new Error('not json');
      },
    });

  const signIn = () =>
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  describe('createRFQ', () => {
    test('posts the payload and returns the record the server saved', async () => {
      global.fetch = reply(201, { success: true, data: RFQ });

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(true);
      // The server's record, not the object that went in: it owns the number.
      expect(res.success && res.rfq).toEqual(RFQ);
      expect(lastPath()).toBe('/api/rfqs');
      expect(lastInit().method).toBe('POST');
      expect(JSON.parse(lastInit().body)).toEqual(PAYLOAD);
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(201, { success: true, data: RFQ });

      await createRFQ(PAYLOAD);

      expect(lastInit().headers.Authorization).toBe('Bearer jwt-token');
      expect(lastInit().headers['Content-Type']).toBe('application/json');
    });

    test('sends no Authorization header when there is no session', async () => {
      global.fetch = reply(201, { success: true, data: RFQ });

      await createRFQ(PAYLOAD);

      expect(lastInit().headers.Authorization).toBeUndefined();
    });

    test('reports an unreachable API rather than claiming the RFQ was saved', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(502);

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(false);
      expect(res.success === false && res.reason).toBe('NETWORK');
      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 })
      );
    });

    test('reports an expired session on a 401', async () => {
      global.fetch = reply(401, { success: false, error: 'Token expired.' });

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Token expired.' });
    });

    test('falls back to the session message when a 403 explains nothing', async () => {
      global.fetch = reply(403, {});

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'UNAUTHORIZED',
        error: UI_STRINGS.auth.sessionExpired,
      });
    });

    // Surfaced per field so the dialog can mark the input that caused it.
    test('passes field errors through on a 400', async () => {
      global.fetch = reply(400, {
        success: false,
        error: 'The RFQ was rejected.',
        fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
      });

      const res = await createRFQ(PAYLOAD);

      expect(res).toEqual({
        success: false,
        reason: 'VALIDATION',
        error: 'The RFQ was rejected.',
        fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
      });
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { success: false, error: 'Database unavailable.' });

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe('Database unavailable.');
    });

    test('falls back to a default message when the server sends none', async () => {
      global.fetch = reply(500, {});

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    // A 200 that carries no record is a failure: adopting nothing would leave the
    // dialog reporting success over an RFQ that was never written.
    test('rejects a 200 that carries no record', async () => {
      global.fetch = reply(200, { success: true });

      const res = await createRFQ(PAYLOAD);

      expect(res.success).toBe(false);
      expect(res.success === false && res.reason).toBe('SERVER');
    });

    test('rejects a 200 whose body denies success', async () => {
      global.fetch = reply(200, { success: false, data: RFQ, error: 'Not saved.' });

      const res = await createRFQ(PAYLOAD);

      expect(res.success === false && res.error).toBe('Not saved.');
    });
  });

  describe('fetchRFQById', () => {
    test('reads one RFQ through the scoped endpoint', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      const res = await fetchRFQById('RFQ260409000512');

      expect(res.success && res.rfq).toEqual(RFQ);
      expect(lastPath()).toBe('/api/rfqs/RFQ260409000512');
    });

    // An identifier is part of the path, so it cannot be allowed to alter it.
    test('encodes the identifier into the path', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('../bootstrap');

      expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('41');

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: RFQ });

      await fetchRFQById('41');

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchRFQById('41');

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(503);

      const res = await fetchRFQById('41');

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 })
      );
    });

    test('reports an expired session on a 403', async () => {
      global.fetch = reply(403, { error: 'No organisation on the session.' });

      const res = await fetchRFQById('41');

      expect(res).toEqual({
        success: false,
        reason: 'UNAUTHORIZED',
        error: 'No organisation on the session.',
      });
    });

    test('falls back to the session message on an unexplained 401', async () => {
      global.fetch = reply(401, {});

      const res = await fetchRFQById('41');

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    // Another organisation's RFQ reports as not found, which is what the backend
    // returns for it: the same answer as a number that never existed.
    test('reports a 404 as not found', async () => {
      global.fetch = reply(404, { success: false, error: 'No such RFQ.' });

      const res = await fetchRFQById('RFQ-OTHER-ORG');

      expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
    });

    test('falls back to the not-found message when the server sends none', async () => {
      global.fetch = reply(404, {});

      const res = await fetchRFQById('nope');

      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchRFQById('41');

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    test('rejects a 200 that carries no record', async () => {
      global.fetch = reply(200, { success: true });

      const res = await fetchRFQById('41');

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });
  });

  describe('fetchRFQList', () => {
    test('reads the organisation-scoped list', async () => {
      global.fetch = reply(200, { success: true, data: [RFQ] });

      const res = await fetchRFQList();

      expect(res.success && res.rfqs).toEqual([RFQ]);
      expect(lastPath()).toBe('/api/rfqs');
    });

    // An empty list is a valid answer: a buyer who has raised nothing has none.
    test('accepts an empty list', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: true, rfqs: [] });
    });

    test('attaches the session token when one is held', async () => {
      signIn();
      global.fetch = reply(200, { success: true, data: [] });

      await fetchRFQList();

      expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
    });

    test('sends no headers when there is no session', async () => {
      global.fetch = reply(200, { success: true, data: [] });

      await fetchRFQList();

      expect(lastInit().headers).toEqual({});
    });

    test('reports an unreachable API', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

      const res = await fetchRFQList();

      expect(res).toEqual({
        success: false,
        reason: 'NETWORK',
        error: UI_STRINGS.auth.networkUnreachable,
      });
    });

    test('names the status when the reply cannot be read', async () => {
      global.fetch = unreadable(500);

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe(
        formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 })
      );
    });

    test('reports an expired session on a 401', async () => {
      global.fetch = reply(401, { error: 'Missing token.' });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Missing token.' });
    });

    test('falls back to the session message on an unexplained 403', async () => {
      global.fetch = reply(403, {});

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
    });

    test('reports a server fault on a 500', async () => {
      global.fetch = reply(500, { error: 'Query failed.' });

      const res = await fetchRFQList();

      expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Query failed.' });
    });

    // Anything other than an array would be spread onto the dashboard as though
    // it were RFQs, so the shape is checked rather than trusted.
    test('rejects a body whose data is not an array', async () => {
      global.fetch = reply(200, { success: true, data: { rfqNumber: 'RFQ-1' } });

      const res = await fetchRFQList();

      expect(res.success === false && res.reason).toBe('SERVER');
      expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.loadFailed);
    });

    test('rejects a 200 whose body denies success', async () => {
      global.fetch = reply(200, { success: false, data: [], error: 'Not available.' });

      const res = await fetchRFQList();

      expect(res.success === false && res.error).toBe('Not available.');
    });
  });
});

// ==============================================================================
// EDIT AND DELETE
// ==============================================================================
// Both are partial by design and both are organisation-scoped server-side, so the
// case that matters most is NOT_FOUND: it is what another organisation's RFQ
// reports, indistinguishable from an id that never existed.
// ==============================================================================

describe('rfqClient.updateRFQ', () => {
  const originalFetch = global.fetch;

  const RFQ: RFQItem = {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
  };

  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const unreadable = (status: number) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new Error('not json');
      },
    });

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('PUTs only the fields it was given and adopts the stored record', async () => {
    global.fetch = reply(200, { success: true, data: { ...RFQ, title: 'Revised' } });

    const res = await updateRFQ('RFQ260409000512', { title: 'Revised' });

    expect(res.success).toBe(true);
    expect(res.success && res.rfq.title).toBe('Revised');
    expect(lastPath()).toBe('/api/rfqs/RFQ260409000512');
    expect(lastInit().method).toBe('PUT');
    expect(JSON.parse(lastInit().body)).toEqual({ title: 'Revised' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('41', { status: 'In Evaluation' });

    expect(lastInit().headers.Authorization).toBe('Bearer jwt-token');
    expect(lastInit().headers['Content-Type']).toBe('application/json');
  });

  test('sends no Authorization header when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('41', { status: 'In Evaluation' });

    expect(lastInit().headers.Authorization).toBeUndefined();
  });

  // An identifier is part of the path, so it cannot be allowed to alter it.
  test('encodes the identifier into the path', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });

    await updateRFQ('../bootstrap', { title: 'Revised' });

    expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
  });

  test('reports an unreachable API rather than claiming the edit was saved', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res).toEqual({
      success: false,
      reason: 'NETWORK',
      error: UI_STRINGS.auth.networkUnreachable,
    });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = unreadable(502);

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(
      formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 502 })
    );
  });

  test('reports an expired session on a 401', async () => {
    global.fetch = reply(401, { error: 'Token expired.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Token expired.' });
  });

  test('falls back to the session message on an unexplained 403', async () => {
    global.fetch = reply(403, {});

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  // Another organisation's RFQ answers exactly as a nonexistent one does.
  test('reports a 404 as not found', async () => {
    global.fetch = reply(404, { error: 'No such RFQ.' });

    const res = await updateRFQ('RFQ-OTHER-ORG', { title: 'Rewritten' });

    expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
  });

  test('falls back to the not-found message when the server sends none', async () => {
    global.fetch = reply(404, {});

    const res = await updateRFQ('nope', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
  });

  test('passes field errors through on a 400', async () => {
    global.fetch = reply(400, {
      error: 'The edit was rejected.',
      fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
    });

    const res = await updateRFQ('41', { deliveryPincode: '!!' });

    expect(res).toEqual({
      success: false,
      reason: 'VALIDATION',
      error: 'The edit was rejected.',
      fieldErrors: { deliveryPincode: 'PIN Code must be 6 digits.' },
    });
  });

  test('reports a server fault on a 500', async () => {
    global.fetch = reply(500, { error: 'Query failed.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.reason).toBe('SERVER');
    expect(res.success === false && res.error).toBe('Query failed.');
  });

  test('falls back to a default message when the server sends none', async () => {
    global.fetch = reply(500, {});

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqEdit.saveFailed);
  });

  // A 200 with no record would leave the caller reporting success over an edit
  // that may not have been written.
  test('rejects a 200 that carries no record', async () => {
    global.fetch = reply(200, { success: true });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.reason).toBe('SERVER');
  });

  test('rejects a 200 whose body denies success', async () => {
    global.fetch = reply(200, { success: false, data: RFQ, error: 'Not saved.' });

    const res = await updateRFQ('41', { title: 'Revised' });

    expect(res.success === false && res.error).toBe('Not saved.');
  });

  test('sends line items and attachments when the edit changed them', async () => {
    global.fetch = reply(200, { success: true, data: RFQ });
    const items = [
      {
        id: 'e1',
        itemName: 'Gate valve',
        quantity: 9,
        unit: 'Nos',
        targetDate: '2026-10-01',
        technicalSpecs: '',
        confidence: 0,
        category: 'Hoses, Valves & Fittings',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Hoses, Valves & Fittings',
      },
    ];

    await updateRFQ('41', { extractedEntities: items, attachments: [] });

    expect(JSON.parse(lastInit().body)).toEqual({ extractedEntities: items, attachments: [] });
  });
});

describe('rfqClient.deleteRFQ', () => {
  const originalFetch = global.fetch;

  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('DELETEs the RFQ and returns the number that was removed', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'RFQ260409000512' } });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: true, rfqNumber: 'RFQ260409000512' });
    expect(lastPath()).toBe('/api/rfqs/41');
    expect(lastInit().method).toBe('DELETE');
  });

  // The row still has to be dropped even if the response omitted the echo.
  test('falls back to the identifier it was asked to delete', async () => {
    global.fetch = reply(200, { success: true });

    const res = await deleteRFQ('RFQ260409000512');

    expect(res).toEqual({ success: true, rfqNumber: 'RFQ260409000512' });
  });

  test('attaches the session token when one is held', async () => {
    authClient.setSession(
      { id: 'u1', email: 'b@x.com', name: 'B', role: 'buyer', orgId: 'o1', orgName: 'O' },
      'jwt-token'
    );
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('R1');

    expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
  });

  test('sends no headers when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('R1');

    expect(lastInit().headers).toEqual({});
  });

  test('encodes the identifier into the path', async () => {
    global.fetch = reply(200, { success: true, data: { rfqNumber: 'R1' } });

    await deleteRFQ('../bootstrap');

    expect(lastPath()).toBe('/api/rfqs/..%2Fbootstrap');
  });

  test('reports an unreachable API rather than dropping the row', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await deleteRFQ('41');

    expect(res).toEqual({
      success: false,
      reason: 'NETWORK',
      error: UI_STRINGS.auth.networkUnreachable,
    });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(
      formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 503 })
    );
  });

  test('reports an expired session on a 401', async () => {
    global.fetch = reply(401, { error: 'Missing token.' });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Missing token.' });
  });

  test('falls back to the session message on an unexplained 403', async () => {
    global.fetch = reply(403, {});

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  // The case that matters: deleting another organisation's RFQ must not appear
  // to have worked.
  test('reports a 404 as not found', async () => {
    global.fetch = reply(404, { error: 'No such RFQ.' });

    const res = await deleteRFQ('RFQ-OTHER-ORG');

    expect(res).toEqual({ success: false, reason: 'NOT_FOUND', error: 'No such RFQ.' });
  });

  test('falls back to the not-found message when the server sends none', async () => {
    global.fetch = reply(404, {});

    const res = await deleteRFQ('nope');

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqDetails.notFoundMessage);
  });

  test('reports a server fault on a 500', async () => {
    global.fetch = reply(500, { error: 'Delete failed.' });

    const res = await deleteRFQ('41');

    expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Delete failed.' });
  });

  test('falls back to a default message when the server sends none', async () => {
    global.fetch = reply(500, {});

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe(UI_STRINGS.rfqEdit.deleteFailed);
  });

  test('rejects a 200 whose body denies success', async () => {
    global.fetch = reply(200, { success: false, error: 'Not deleted.' });

    const res = await deleteRFQ('41');

    expect(res.success === false && res.error).toBe('Not deleted.');
  });
});

// ==============================================================================
// EMAIL EXTRACTION
// ==============================================================================
// The whole `.eml` is uploaded and parsed server-side. What matters on this side
// is that provenance comes back from the parsed headers rather than being sent up,
// and that each refusal keeps its machine-readable reason so the wizard can name
// the recovery step instead of showing one generic failure.
// ==============================================================================

describe('rfqClient.extractLineItemsFromEmail', () => {
  const eml = () =>
    new File(['From: a@b.com\r\nSubject: Req\r\n\r\nPump - 4 Nos'], 'requisition.eml', {
      type: 'message/rfc822',
    });

  const EMAIL_META = {
    messageId: '<req-1@buyer.example.com>',
    subject: 'Urgent Requisition - Pumps',
    fromAddress: 'project.procurement@lt-heavy.com',
    fromName: 'Rajesh Iyer',
    toAddress: 'client@procucev.com',
    sentAt: '2026-09-07T03:44:22.000Z',
    attachmentNames: ['requisition.pdf'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('posts the file name and base64 body to the email endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { title: 'Pumps', source: 'email_upload' },
        email: EMAIL_META,
      }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res.success).toBe(true);
    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/extract-email');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.fileName).toBe('requisition.eml');
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(0);
    // Provenance is never sent up; it is read out of the message server-side.
    expect(body.sourceEmail).toBeUndefined();
  });

  test('returns the parsed message headers alongside the draft', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { title: 'Pumps', source: 'email_upload' },
        email: EMAIL_META,
        classification: { accepted: 2 },
        extraction: { model: 'gemini-test' },
      }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res.email).toEqual(EMAIL_META);
    expect(res.classification).toEqual({ accepted: 2 });
    expect(res.extraction).toEqual({ model: 'gemini-test' });
  });

  test('passes a non-fatal attachment warning through', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { title: 'Steel', source: 'email_upload' },
        email: EMAIL_META,
        warning: 'The attachment boq.xlsx was not read.',
      }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res.success).toBe(true);
    expect(res.warning).toContain('boq.xlsx');
  });

  test('keeps the server reason for a refused message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        reason: 'OUTLOOK_MSG_UNSUPPORTED',
        error: 'Outlook .msg files cannot be read.',
      }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res.success).toBe(false);
    expect(res.reason).toBe('OUTLOOK_MSG_UNSUPPORTED');
    expect(res.error).toBe('Outlook .msg files cannot be read.');
  });

  // Fails closed: the buyer is never shown fabricated line items.
  test('reports the API as unreachable on a transport failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

    const res = await extractLineItemsFromEmail(eml());

    expect(res).toMatchObject({ success: false, reason: 'NETWORK' });
    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  // A 5xx is the API failing, not the model misreading the message: every genuine
  // extraction refusal comes back as a 422 with a reason.
  test('treats a 5xx as a transport problem', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ success: false }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res.reason).toBe('NETWORK');
    expect(res.error).toContain('503');
  });

  test('reports an unreadable response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res).toMatchObject({ success: false, reason: 'AI_FAILED' });
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  test('falls back when a refusal carries no reason or message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    const res = await extractLineItemsFromEmail(eml());

    expect(res).toMatchObject({ success: false, reason: 'AI_FAILED' });
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  test('reports a file that cannot be read off disk', async () => {
    const unreadable = eml();
    // A FileReader error is what a revoked or moved file produces.
    const OriginalFileReader = global.FileReader;
    class FailingFileReader {
      public onerror: (() => void) | null = null;
      public onload: (() => void) | null = null;
      public result = '';
      readAsDataURL() {
        if (this.onerror) this.onerror();
      }
    }
    (global as unknown as { FileReader: unknown }).FileReader = FailingFileReader;
    global.fetch = jest.fn();

    const res = await extractLineItemsFromEmail(unreadable);

    expect(res).toMatchObject({ success: false, reason: 'UNREADABLE' });
    expect(res.error).toBe(UI_STRINGS.rfqExtraction.emailFileUnreadable);
    expect(global.fetch).not.toHaveBeenCalled();

    (global as unknown as { FileReader: unknown }).FileReader = OriginalFileReader;
  });
});
