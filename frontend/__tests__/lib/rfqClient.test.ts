import {
  extractLineItemsFromDocument,
  classifyLineItems,
  uploadRFQAttachment,
  rfqAttachmentUrl,
} from '@/lib/rfqClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

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
