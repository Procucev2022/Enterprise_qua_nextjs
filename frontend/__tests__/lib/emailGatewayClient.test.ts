import { fetchEmailGatewayStatus, pollEmailGateway } from '@/lib/emailGatewayClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

// ==============================================================================
// EMAIL GATEWAY TRANSPORT
// ==============================================================================
// The panel is how a buyer finds out whether a forwarded requisition will be
// picked up, so every failure has to be distinguishable. Reporting a healthy
// gateway when the API is unreachable would be worse than reporting nothing.
// ==============================================================================

const GATEWAY = UI_STRINGS.emailGateway;

const STATUS = {
  enabled: true,
  configured: true,
  watching: true,
  mailboxUser: 'intake@procucev.com',
  mailbox: 'INBOX',
  host: 'imap.gmail.com',
  pollIntervalMs: 120000,
  allowedSenders: [],
  allowedDomains: [],
  lastPollAt: '2026-09-07T04:00:00.000Z',
  lastPollDurationMs: 820,
  lastConnectedAt: '2026-09-07T04:00:00.000Z',
  lastError: null,
  isPolling: false,
  counts: { INGESTED: 3 },
  recent: [],
  ingestedStatus: 'Parsing',
};

beforeEach(() => {
  jest.clearAllMocks();
  authClient.setSession(null, null);
});

describe('fetchEmailGatewayStatus', () => {
  test('returns the gateway state and attaches the session token', async () => {
    authClient.setSession(
      {
        id: 'u1',
        email: 'buyer@procucev.com',
        name: 'Buyer',
        role: 'buyer' as const,
        orgId: 'o1',
        orgName: 'Org',
      },
      'test-token'
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: STATUS }),
    });

    const res = await fetchEmailGatewayStatus();

    expect(res.success).toBe(true);
    expect(res.data?.mailboxUser).toBe('intake@procucev.com');
    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/rfqs/email-gateway/status');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  test('reports the API as unreachable on a transport failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await fetchEmailGatewayStatus();

    expect(res).toEqual({ success: false, error: UI_STRINGS.auth.networkUnreachable });
  });

  test('treats a 5xx as a transport problem', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    const res = await fetchEmailGatewayStatus();

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

    const res = await fetchEmailGatewayStatus();

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  test('falls back when the payload carries no data', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });

    const res = await fetchEmailGatewayStatus();

    expect(res).toEqual({ success: false, error: GATEWAY.statusUnavailable });
  });

  test('surfaces a server-supplied reason', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Gateway is misconfigured.' }),
    });

    const res = await fetchEmailGatewayStatus();

    expect(res.error).toBe('Gateway is misconfigured.');
  });
});

describe('pollEmailGateway', () => {
  test('returns the run summary', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { considered: 3, ingested: 2, pending: 1 } }),
    });

    const res = await pollEmailGateway();

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ considered: 3, ingested: 2, pending: 1 });
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST');
  });

  // A 409 means switched off or already running — expected, not a fault, and the
  // server's own wording explains which.
  test('passes a conflict reason through unchanged', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ success: false, error: 'The email gateway is switched off.' }),
    });

    const res = await pollEmailGateway();

    expect(res).toEqual({ success: false, error: 'The email gateway is switched off.' });
  });

  test('reports the API as unreachable on a transport failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await pollEmailGateway();

    expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
  });

  test('reports an unreadable response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await pollEmailGateway();

    expect(res.error).toBe(UI_STRINGS.rfqExtraction.unreadableResponse);
  });

  test('falls back when a failure carries no reason', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });

    const res = await pollEmailGateway();

    expect(res).toEqual({ success: false, error: GATEWAY.pollFailed });
  });

  test('omits the authorization header when no session is held', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { considered: 0, ingested: 0, pending: 0 } }),
    });

    await pollEmailGateway();

    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
