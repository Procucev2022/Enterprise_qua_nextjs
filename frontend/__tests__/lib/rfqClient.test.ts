import { extractLineItemsFromDocument, classifyLineItems } from '@/lib/rfqClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

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

  test('falls back to a default message when the server sends none', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
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
