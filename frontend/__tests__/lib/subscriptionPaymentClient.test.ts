import { createPaymentLink } from '@/lib/subscriptionPaymentClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

describe('subscriptionPaymentClient.createPaymentLink', () => {
  const originalFetch = global.fetch;

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
    authClient.setSession({ id: 'u1', email: 'v@x.com', name: 'V', role: 'vendor', orgId: 'o1', orgName: 'O' }, 'jwt-token');

  const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
  const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('posts the plan and returns the redirect URL', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x', paymentLinkId: 'pl-1', status: 'CREATED' } });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: true, paymentUrl: 'https://payments.zoho.in/x', paymentLinkId: 'pl-1', status: 'CREATED' });
    expect(lastPath()).toBe('/api/vendors/v-1/payment-link');
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body)).toEqual({ plan: 'connect' });
  });

  test('defaults paymentLinkId/status to empty strings when the server omits them', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success && res.paymentLinkId).toBe('');
    expect(res.success && res.status).toBe('');
  });

  test('attaches the session token when one is held', async () => {
    signIn();
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    await createPaymentLink('v-1', 'select');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-token' });
  });

  test('sends no Authorization header when there is no session', async () => {
    global.fetch = reply(200, { success: true, data: { paymentUrl: 'https://payments.zoho.in/x' } });

    await createPaymentLink('v-1', 'select');

    expect(lastInit().headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('reports an unreachable API', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: false, reason: 'NETWORK', error: UI_STRINGS.auth.networkUnreachable });
  });

  test('names the status when the reply cannot be read', async () => {
    global.fetch = unreadable(500);

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.error).toBe(formatString(UI_STRINGS.rfqExtraction.apiUnavailable, { status: 500 }));
  });

  test('reports UNAUTHORIZED on a 403', async () => {
    global.fetch = reply(403, { error: 'Forbidden.' });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res).toEqual({ success: false, reason: 'UNAUTHORIZED', error: 'Forbidden.' });
  });

  test('falls back to the session message on an unexplained 401', async () => {
    global.fetch = reply(401, {});

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.error).toBe(UI_STRINGS.auth.sessionExpired);
  });

  test('reports VALIDATION on a 400 (e.g. an unpayable plan)', async () => {
    global.fetch = reply(400, { error: 'plan must be one of: connect, select.' });

    const res = await createPaymentLink('v-1', 'premium');

    expect(res).toEqual({ success: false, reason: 'VALIDATION', error: 'plan must be one of: connect, select.' });
  });

  test('reports SERVER on a 404 for an unknown vendor', async () => {
    global.fetch = reply(404, { error: 'Vendor not found.' });

    const res = await createPaymentLink('does-not-exist', 'connect');

    expect(res).toEqual({ success: false, reason: 'SERVER', error: 'Vendor not found.' });
  });

  test('reports SERVER when the body carries no paymentUrl', async () => {
    global.fetch = reply(200, { success: true, data: {} });

    const res = await createPaymentLink('v-1', 'connect');

    expect(res.success === false && res.reason).toBe('SERVER');
  });
});
