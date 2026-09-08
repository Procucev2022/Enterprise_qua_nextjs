const crypto = require('crypto');

jest.mock('../src/db/domainQueries');
const domainQueries = require('../src/db/domainQueries');
const { ZOHO_CONFIG } = require('../src/config/constants');
const zohoPaymentService = require('../src/services/zohoPaymentService');

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('zohoPaymentService', () => {
  const originalFetch = global.fetch;
  const originalRefreshToken = ZOHO_CONFIG.REFRESH_TOKEN;
  const originalClientId = ZOHO_CONFIG.CLIENT_ID;
  const originalClientSecret = ZOHO_CONFIG.CLIENT_SECRET;
  const originalSigningKey = ZOHO_CONFIG.WEBHOOK_SIGNING_KEY;
  const originalAccountId = ZOHO_CONFIG.ACCOUNT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    ZOHO_CONFIG.REFRESH_TOKEN = 'test-refresh-token';
    ZOHO_CONFIG.CLIENT_ID = 'test-client-id';
    ZOHO_CONFIG.CLIENT_SECRET = 'test-client-secret';
    ZOHO_CONFIG.WEBHOOK_SIGNING_KEY = 'test-signing-key';
    ZOHO_CONFIG.ACCOUNT_ID = 'acct-1';
    domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
    domainQueries.upsertZohoOAuthTokenInDB.mockResolvedValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    ZOHO_CONFIG.REFRESH_TOKEN = originalRefreshToken;
    ZOHO_CONFIG.CLIENT_ID = originalClientId;
    ZOHO_CONFIG.CLIENT_SECRET = originalClientSecret;
    ZOHO_CONFIG.WEBHOOK_SIGNING_KEY = originalSigningKey;
    ZOHO_CONFIG.ACCOUNT_ID = originalAccountId;
  });

  describe('getValidAccessToken', () => {
    test('throws when no refresh token is configured', async () => {
      ZOHO_CONFIG.REFRESH_TOKEN = '';
      await expect(zohoPaymentService.getValidAccessToken()).rejects.toThrow('Zoho refresh token not configured');
    });

    test('reuses a cached token that has not expired', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue({
        access_token: 'cached-token',
        expiry_time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      global.fetch = jest.fn();

      await expect(zohoPaymentService.getValidAccessToken()).resolves.toBe('cached-token');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('refreshes when the cached token is inside the expiry buffer', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue({
        access_token: 'stale-token',
        expiry_time: new Date(Date.now() + 30 * 1000).toISOString(),
      });
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'fresh-token', expires_in: 3600 }));

      const token = await zohoPaymentService.getValidAccessToken();

      expect(token).toBe('fresh-token');
      expect(global.fetch).toHaveBeenCalledWith(
        ZOHO_CONFIG.OAUTH_TOKEN_URL,
        expect.objectContaining({ method: 'POST' })
      );
      const [, init] = global.fetch.mock.calls[0];
      expect(init.body).toContain('grant_type=refresh_token');
      expect(init.body).toContain('refresh_token=test-refresh-token');
      expect(domainQueries.upsertZohoOAuthTokenInDB).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'fresh-token' })
      );
    });

    test('refreshes when there is no cached token at all', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'first-token', expires_in: 3600 }));

      await expect(zohoPaymentService.getValidAccessToken()).resolves.toBe('first-token');
    });

    test('defaults a missing expires_in to 0', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'no-expiry-token' }));

      await expect(zohoPaymentService.getValidAccessToken()).resolves.toBe('no-expiry-token');
      expect(domainQueries.upsertZohoOAuthTokenInDB).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'no-expiry-token' })
      );
    });

    test('throws with the Zoho error when the token exchange fails', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid_client' }));

      await expect(zohoPaymentService.getValidAccessToken()).rejects.toThrow(/Zoho OAuth token refresh failed \(401\): invalid_client/);
    });

    test('retries once and succeeds after a raw "fetch failed" network error', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'recovered-token', expires_in: 3600 }));

      await expect(zohoPaymentService.getValidAccessToken()).resolves.toBe('recovered-token');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('does not retry and rethrows a TypeError unrelated to "fetch failed"', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Invalid URL'));

      await expect(zohoPaymentService.getValidAccessToken()).rejects.toThrow('Invalid URL');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('does not retry and rethrows a second consecutive "fetch failed" error', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(zohoPaymentService.getValidAccessToken()).rejects.toThrow('fetch failed');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('throws a generic message when the failure body is unreadable', async () => {
      domainQueries.getZohoOAuthTokenFromDB.mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });

      await expect(zohoPaymentService.getValidAccessToken()).rejects.toThrow(/unknown error/);
    });
  });

  describe('createPaymentLink', () => {
    test('creates a payment link and returns Zoho\'s essential fields', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) {
          return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        }
        return Promise.resolve(
          jsonResponse(200, {
            payment_links: { payment_link_id: 'zoho-1', url: 'https://payments.zoho.in/x', status: 'CREATED' },
          })
        );
      });

      const result = await zohoPaymentService.createPaymentLink({
        planId: 'connect',
        planLabel: 'Connect Model',
        amountInr: 14160,
        email: 'vendor@example.com',
        phone: '9876543210',
        returnUrl: 'http://localhost:3000/return',
      });

      expect(result).toEqual({
        zohoPaymentLinkId: 'zoho-1',
        paymentUrl: 'https://payments.zoho.in/x',
        status: 'CREATED',
        rawResponse: expect.objectContaining({ payment_links: expect.any(Object) }),
      });

      const paymentLinkCall = global.fetch.mock.calls.find(([url]) => String(url).includes('paymentlinks'));
      expect(paymentLinkCall[0]).toContain(`account_id=${ZOHO_CONFIG.ACCOUNT_ID}`);
      const body = JSON.parse(paymentLinkCall[1].body);
      expect(body).toMatchObject({
        amount: 14160,
        currency: 'INR',
        email: 'vendor@example.com',
        phone: '9876543210',
        notify_user: true,
        return_url: 'http://localhost:3000/return',
      });
      expect(paymentLinkCall[1].headers.Authorization).toBe('Zoho-oauthtoken tok');
    });

    test('treats an unreadable success/failure body as an empty object', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        return Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
      });

      await expect(
        zohoPaymentService.createPaymentLink({ planId: 'connect', planLabel: 'Connect', amountInr: 1, email: 'a@x.com', phone: '', returnUrl: '' })
      ).rejects.toThrow(/unknown error/);
    });

    test('throws with the Zoho error when link creation fails', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        return Promise.resolve(jsonResponse(400, { message: 'Invalid amount' }));
      });

      await expect(
        zohoPaymentService.createPaymentLink({ planId: 'connect', planLabel: 'Connect', amountInr: 1, email: 'a@x.com', phone: '', returnUrl: '' })
      ).rejects.toThrow(/Zoho payment-link creation failed \(400\): Invalid amount/);
    });
  });

  describe('getPaymentLinkStatus', () => {
    test('fetches and returns the current status', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        return Promise.resolve(jsonResponse(200, { payment_links: { status: 'PAID', amount_paid: 14160 } }));
      });

      const result = await zohoPaymentService.getPaymentLinkStatus('zoho-1');

      expect(result).toEqual({ status: 'PAID', amountPaid: 14160, rawResponse: expect.any(Object) });
      const statusCall = global.fetch.mock.calls.find(([url]) => String(url).includes('paymentlinks/zoho-1'));
      expect(statusCall[1].headers.Authorization).toBe('Zoho-oauthtoken tok');
    });

    test('treats an unreadable body as an empty object', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        return Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } });
      });

      await expect(zohoPaymentService.getPaymentLinkStatus('zoho-1')).rejects.toThrow(/unknown error/);
    });

    test('throws with the Zoho error when the status fetch fails', async () => {
      global.fetch = jest.fn().mockImplementation((url) => {
        if (String(url).includes('oauth')) return Promise.resolve(jsonResponse(200, { access_token: 'tok', expires_in: 3600 }));
        return Promise.resolve(jsonResponse(404, { message: 'Not found' }));
      });

      await expect(zohoPaymentService.getPaymentLinkStatus('zoho-x')).rejects.toThrow(/Zoho payment-link status fetch failed \(404\): Not found/);
    });
  });

  describe('verifyWebhookSignature', () => {
    function sign(timestamp, rawBody, key = 'test-signing-key') {
      return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(`${timestamp}.${rawBody}`).digest('hex');
    }

    test('accepts a correctly signed body', () => {
      const rawBody = JSON.stringify({ event_id: 1 });
      const ts = Math.floor(Date.now() / 1000);
      const sig = sign(ts, rawBody);
      expect(zohoPaymentService.verifyWebhookSignature(`t=${ts},v=${sig}`, rawBody)).toBe(true);
    });

    test('accepts a signature compared case-insensitively', () => {
      const rawBody = JSON.stringify({ event_id: 1 });
      const ts = Math.floor(Date.now() / 1000);
      const sig = sign(ts, rawBody).toUpperCase();
      expect(zohoPaymentService.verifyWebhookSignature(`t=${ts},v=${sig}`, rawBody)).toBe(true);
    });

    test('rejects a tampered body', () => {
      const ts = Math.floor(Date.now() / 1000);
      const sig = sign(ts, JSON.stringify({ event_id: 1 }));
      expect(zohoPaymentService.verifyWebhookSignature(`t=${ts},v=${sig}`, JSON.stringify({ event_id: 2 }))).toBe(false);
    });

    test('rejects a signature from the wrong key', () => {
      const rawBody = JSON.stringify({ event_id: 1 });
      const ts = Math.floor(Date.now() / 1000);
      const sig = sign(ts, rawBody, 'wrong-key');
      expect(zohoPaymentService.verifyWebhookSignature(`t=${ts},v=${sig}`, rawBody)).toBe(false);
    });

    test('rejects a missing header', () => {
      expect(zohoPaymentService.verifyWebhookSignature(undefined, '{}')).toBe(false);
      expect(zohoPaymentService.verifyWebhookSignature('', '{}')).toBe(false);
    });

    test('rejects a malformed header missing t or v', () => {
      expect(zohoPaymentService.verifyWebhookSignature('v=abc', '{}')).toBe(false);
      expect(zohoPaymentService.verifyWebhookSignature('t=123', '{}')).toBe(false);
      expect(zohoPaymentService.verifyWebhookSignature('garbage', '{}')).toBe(false);
    });

    test('rejects a signature of a different length than expected (e.g. a truncated or garbage value)', () => {
      const rawBody = JSON.stringify({ event_id: 1 });
      const ts = Math.floor(Date.now() / 1000);
      expect(zohoPaymentService.verifyWebhookSignature(`t=${ts},v=short`, rawBody)).toBe(false);
    });

    test('rejects when no signing key is configured', () => {
      ZOHO_CONFIG.WEBHOOK_SIGNING_KEY = '';
      expect(zohoPaymentService.verifyWebhookSignature('t=1,v=abc', '{}')).toBe(false);
    });
  });
});
