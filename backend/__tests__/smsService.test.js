const smsService = require('../src/services/smsService');

const { SMS_SEND_STATUS } = smsService;

describe('smsService Unit Tests', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalRfqSmsgid = process.env.SMS_GATEWAY_RFQ_SMSGID;
  const originalSmsGatewayUser = process.env.SMS_GATEWAY_USER;
  const originalRfqSmsGatewayUser = process.env.SMS_GATEWAY_RFQ_USER;
  const originalRfqSmsGatewayPass = process.env.SMS_GATEWAY_RFQ_PASS;
  const originalSmsGatewayPass = process.env.SMS_GATEWAY_PASS;
  const originalFetch = global.fetch;

  beforeEach(() => {
    smsService.clearSmsThrottleCache();
    // Every gateway account is configured by default. Tests that cover a missing account delete it themselves.
    process.env.SMS_GATEWAY_USER = 'otp-test-user';
    process.env.SMS_GATEWAY_PASS = 'otp-test-password';
    process.env.SMS_GATEWAY_RFQ_USER = 'rfq-test-user';
    process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-test-password';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalSmsGatewayPass === undefined) {
      delete process.env.SMS_GATEWAY_PASS;
    } else {
      process.env.SMS_GATEWAY_PASS = originalSmsGatewayPass;
    }
    if (originalRfqSmsgid === undefined) {
      delete process.env.SMS_GATEWAY_RFQ_SMSGID;
    } else {
      process.env.SMS_GATEWAY_RFQ_SMSGID = originalRfqSmsgid;
    }
    if (originalSmsGatewayUser === undefined) {
      delete process.env.SMS_GATEWAY_USER;
    } else {
      process.env.SMS_GATEWAY_USER = originalSmsGatewayUser;
    }
    if (originalRfqSmsGatewayUser === undefined) {
      delete process.env.SMS_GATEWAY_RFQ_USER;
    } else {
      process.env.SMS_GATEWAY_RFQ_USER = originalRfqSmsGatewayUser;
    }
    if (originalRfqSmsGatewayPass === undefined) {
      delete process.env.SMS_GATEWAY_RFQ_PASS;
    } else {
      process.env.SMS_GATEWAY_RFQ_PASS = originalRfqSmsGatewayPass;
    }
    jest.useRealTimers();
    global.fetch = originalFetch;
    smsService.clearSmsThrottleCache();
    jest.restoreAllMocks();
  });

  describe('formatMobileNumber', () => {
    test('handles empty or null inputs', () => {
      expect(smsService.formatMobileNumber('')).toBe('');
      expect(smsService.formatMobileNumber(null)).toBe('');
      expect(smsService.formatMobileNumber(undefined)).toBe('');
    });

    test('strips country code 91 if 12 digits', () => {
      expect(smsService.formatMobileNumber('919157154504')).toBe('9157154504');
    });

    test('strips leading 0 if 11 digits', () => {
      expect(smsService.formatMobileNumber('09157154504')).toBe('9157154504');
    });

    test('retains 10 digits', () => {
      expect(smsService.formatMobileNumber('9157154504')).toBe('9157154504');
    });
  });

  describe('sendOtpSms', () => {
    test('rejects invalid mobile number with status skipped', async () => {
      const res = await smsService.sendOtpSms('123', '123456');
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.error).toContain('Invalid mobile number format');
    });

    test('does not claim success under the test environment and never calls the gateway', async () => {
      process.env.NODE_ENV = 'test';
      global.fetch = jest.fn();
      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.reason).toBe('test_environment');
      expect(res.messageId).toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('performs live HTTP post in non-test environment and reports the gateway message id', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_USER = 'Procucev_OTP';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success","msgid":"MSG123"}',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBe('MSG123');
      expect(res.response).toContain('MSG123');
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).user).toBe('Procucev_OTP');
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).pass).toBe(
        smsService.SMS_GATEWAY_CONFIG.PASS
      );
      expect(global.fetch).toHaveBeenCalledWith(
        smsService.SMS_GATEWAY_CONFIG.URL,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    test('reports sent without a message id when the gateway returns none', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBeUndefined();
    });

    test('throttles rapid repeated dispatches to the same mobile number with status throttled', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success","msgid":"MSG123"}',
      });

      const first = await smsService.sendOtpSms('9157154504', '123456');
      expect(first.success).toBe(true);
      expect(first.throttled).toBeUndefined();

      // Second immediate call within 30s cooldown should be throttled
      const second = await smsService.sendOtpSms('9157154504', '654321');
      expect(second.success).toBe(false);
      expect(second.status).toBe(SMS_SEND_STATUS.THROTTLED);
      expect(second.throttled).toBe(true);
      expect(second.messageId).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('handles gateway error response in non-test environment with status failed', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.FAILED);
      expect(res.error).toBe('SMS gateway rejected the message (HTTP 500).');
    });

    test('treats an HTTP 200 body that carries an error status as a rejection', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"error","reason":"DLT mismatch"}',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.FAILED);
      expect(res.messageId).toBeUndefined();
    });

    test('shortenUrl handles empty, valid TinyURL responses, caching, and fallbacks', async () => {
      smsService.clearShortUrlCache();

      // Empty URL returns as-is
      expect(await smsService.shortenUrl('')).toBe('');
      expect(await smsService.shortenUrl(null)).toBe(null);

      // Successful TinyURL shortening
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => 'https://tinyurl.com/xyz123\n',
      });
      const short = await smsService.shortenUrl('https://example.com/very/long/url/for/rfq/123');
      expect(short).toBe('https://tinyurl.com/xyz123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call uses in-memory cache
      const cached = await smsService.shortenUrl('https://example.com/very/long/url/for/rfq/123');
      expect(cached).toBe('https://tinyurl.com/xyz123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Clear cache and test fallback on non-tinyurl body
      smsService.clearShortUrlCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => 'Error: Rate limit',
      });
      const fallbackBadBody = await smsService.shortenUrl('https://example.com/another');
      expect(fallbackBadBody).toBe('https://example.com/another');

      // Fallback on network/fetch exception
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const fallbackErr = await smsService.shortenUrl('https://example.com/another2');
      expect(fallbackErr).toBe('https://example.com/another2');

      // Fallback on HTTP error status
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      });
      const fallback500 = await smsService.shortenUrl('https://example.com/another3');
      expect(fallback500).toBe('https://example.com/another3');
    });

    test('sendRFQChaserSms reports skipped under test and rejects invalid input before any gateway call', async () => {
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';
      global.fetch = jest.fn();

      const invalid = await smsService.sendRFQChaserSms({ mobile: '123', rfqNumber: 'RFQ-001' });
      expect(invalid.success).toBe(false);
      expect(invalid.status).toBe(SMS_SEND_STATUS.SKIPPED);

      const valid = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        vendorName: 'Test Supplier Co',
        rfqNumber: 'RFQ-001',
        rfqTitle: 'Valves',
        bidLink: 'https://procucev.com/quote',
      });
      expect(valid.success).toBe(false);
      expect(valid.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(valid.reason).toBe('test_environment');
      expect(valid.messageId).toBeUndefined();

      const validFallback = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-002',
      });
      expect(validFallback.success).toBe(false);
      expect(validFallback.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sendRFQChaserSms refuses to send without an RFQ number', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';
      global.fetch = jest.fn();

      const res = await smsService.sendRFQChaserSms({ mobile: '9157154504', vendorName: 'Test Supplier' });
      expect(res).toEqual({
        success: false,
        status: SMS_SEND_STATUS.SKIPPED,
        error: 'An RFQ number is required to send this SMS.',
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not use the OTP gateway password when RFQ credentials are missing', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalRfqPassword = process.env.SMS_GATEWAY_RFQ_PASS;
      process.env.NODE_ENV = 'production';
      delete process.env.SMS_GATEWAY_RFQ_PASS;
      global.fetch = jest.fn();

      try {
        const result = await smsService.sendRFQChaserSms({
          mobile: '9157154504',
          rfqNumber: 'RFQ-CREDENTIALS-01',
        });

        expect(result).toEqual({
          success: false,
          status: SMS_SEND_STATUS.NOT_CONFIGURED,
          error: 'RFQ SMS gateway credentials are not configured',
        });
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalRfqPassword === undefined) {
          delete process.env.SMS_GATEWAY_RFQ_PASS;
        } else {
          process.env.SMS_GATEWAY_RFQ_PASS = originalRfqPassword;
        }
      }
    });

    test('sendRFQChaserSms handles production gateway flow, errors, and throttling', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_RFQ_SMSGID = '1777179076323440961';
      process.env.SMS_GATEWAY_USER = 'Procucev_OTP';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success","msgid":"CHASER-1"}',
      });

      const res = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-01',
        rfqTitle: 'Pumps',
        bidLink: 'https://procucev.com/quote/1',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBe('CHASER-1');
      const requestPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(requestPayload.user).toBe('ProcucevWapp1');
      expect(requestPayload.pass).toBe('rfq-account-test-password');
      expect(requestPayload.smstosend[0]).toMatchObject({
        to: '919157154504',
        from: 'PROCUC',
        smstext: 'RFQ Alert RFQ-CHASER-01: You are invited to bid for Pumps. Submit quote : https://procucev.com/quote/1 - Team Procucev.',
        smsgid: '1777179076323440961',
      });

      // Rapid call triggers throttle
      const throttled = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-01',
      });
      expect(throttled.success).toBe(false);
      expect(throttled.status).toBe(SMS_SEND_STATUS.THROTTLED);
      expect(throttled.throttled).toBe(true);
      expect(throttled.messageId).toBeUndefined();

      smsService.clearSmsThrottleForPhone('9157154504');
      const afterThrottleClear = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-01',
      });
      expect(afterThrottleClear.success).toBe(true);
      expect(afterThrottleClear.throttled).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Gateway failure response
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });
      const failed = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-02',
      });
      expect(failed.success).toBe(false);
      expect(failed.status).toBe(SMS_SEND_STATUS.FAILED);
      expect(failed.messageId).toBeUndefined();

      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"rejected","error":"Template mismatch"}',
      });
      const rejected = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-03',
      });
      expect(rejected.success).toBe(false);
      expect(rejected.status).toBe(SMS_SEND_STATUS.FAILED);

      // Gateway exception
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection aborted'));
      const errorRes = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-04',
      });
      expect(errorRes.success).toBe(false);
      expect(errorRes.status).toBe(SMS_SEND_STATUS.FAILED);
      expect(errorRes.error).toBe('Connection aborted');
    });

    test('sendRFQChaserSms aborts requests that exceed the gateway timeout', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';
      global.fetch = jest.fn(
        (_url, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new Error('SMS gateway request timed out')),
              { once: true }
            );
          })
      );
      jest.useFakeTimers();

      const pending = smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-TIMEOUT-01',
      });
      const pendingOtp = smsService.sendOtpSms('9157154505', '123456');
      await jest.advanceTimersByTimeAsync(6000);
      const [result, otpResult] = await Promise.all([pending, pendingOtp]);

      expect(result).toMatchObject({
        success: false,
        status: SMS_SEND_STATUS.FAILED,
        error: 'SMS gateway request timed out',
      });
      expect(otpResult).toMatchObject({
        success: false,
        status: SMS_SEND_STATUS.FAILED,
        error: 'SMS gateway request timed out',
      });
    });

    test('sendBuyerComparisonSms reports skipped under test and validates its inputs first', async () => {
      global.fetch = jest.fn();
      const invalid = await smsService.sendBuyerComparisonSms({ mobile: '123', rfqNumber: 'RFQ-001', quotesCount: 1 });
      expect(invalid.success).toBe(false);
      expect(invalid.status).toBe(SMS_SEND_STATUS.SKIPPED);

      const valid = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        buyerName: 'Acme Buyer',
        rfqNumber: 'RFQ-001',
        quotesCount: 3,
        matrixLink: 'https://procucev.com/matrix',
      });
      expect(valid.success).toBe(false);
      expect(valid.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(valid.reason).toBe('test_environment');
      expect(valid.messageId).toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sendBuyerComparisonSms refuses to send without a whole-number quote count', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn();

      const missing = await smsService.sendBuyerComparisonSms({ mobile: '9157154504', rfqNumber: 'RFQ-010' });
      expect(missing.success).toBe(false);
      expect(missing.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(missing.error).toBe('A whole number of quotes (0 or more) is required to send the buyer comparison SMS.');

      const fractional = await smsService.sendBuyerComparisonSms({ mobile: '9157154504', rfqNumber: 'RFQ-010', quotesCount: 1.5 });
      expect(fractional.status).toBe(SMS_SEND_STATUS.SKIPPED);

      const negative = await smsService.sendBuyerComparisonSms({ mobile: '9157154504', rfqNumber: 'RFQ-010', quotesCount: -1 });
      expect(negative.status).toBe(SMS_SEND_STATUS.SKIPPED);

      const missingRfq = await smsService.sendBuyerComparisonSms({ mobile: '9157154504', quotesCount: 2 });
      expect(missingRfq.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sendBuyerComparisonSms renders the quote count, including zero, into the template', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success"}',
      });

      const res = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-ZERO-1',
        quotesCount: 0,
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBeUndefined();
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).smstosend[0].smstext).toContain('ready with 0 quotes');
    });

    test('sendBuyerComparisonSms handles production gateway flow, errors, and throttling', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_USER = 'Procucev_OTP';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success","msgid":"COMP-1"}',
      });

      const res = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        buyerName: 'Acme Buyer',
        rfqNumber: 'RFQ-001',
        quotesCount: 5,
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBe('COMP-1');
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).user).toBe(
        smsService.SMS_GATEWAY_CONFIG.RFQ_USER
      );
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).pass).toBe(
        smsService.SMS_GATEWAY_CONFIG.RFQ_PASS
      );

      // Throttling
      const throttled = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        buyerName: 'Acme Buyer',
        rfqNumber: 'RFQ-001',
        quotesCount: 5,
      });
      expect(throttled.success).toBe(false);
      expect(throttled.status).toBe(SMS_SEND_STATUS.THROTTLED);
      expect(throttled.throttled).toBe(true);

      // Gateway failure
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Gateway Error',
      });
      const failed = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-002',
        quotesCount: 2,
      });
      expect(failed.success).toBe(false);
      expect(failed.status).toBe(SMS_SEND_STATUS.FAILED);

      // Gateway exception
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      const errorRes = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-003',
        quotesCount: 2,
      });
      expect(errorRes.success).toBe(false);
      expect(errorRes.status).toBe(SMS_SEND_STATUS.FAILED);
    });
  });

  describe('sendActionCenterSms', () => {
    test('rejects invalid mobile number', async () => {
      const res = await smsService.sendActionCenterSms({
        mobile: '123',
        message: 'Action Center Notification',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.error).toBe('Invalid mobile number format. A 10-digit Indian mobile number is required.');
    });

    test('refuses to send an empty message', async () => {
      global.fetch = jest.fn();
      const res = await smsService.sendActionCenterSms({ mobile: '9157154504', message: '   ' });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.error).toBe('Message text is required to send an Action Center SMS.');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not claim success under the test environment and still returns the rendered text', async () => {
      process.env.NODE_ENV = 'test';
      global.fetch = jest.fn();
      const res = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        recipientName: 'Enterprise Client',
        message: 'Your ticket has been updated',
        linkUrl: 'https://procucev.com/action-center',
        entityType: 'ticket',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.reason).toBe('test_environment');
      expect(res.messageId).toBeUndefined();
      expect(res.renderedMessage).toBe('Your ticket has been updated');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('handles non-test environment live, throttled, failure, and exception', async () => {
      process.env.NODE_ENV = 'production';
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', msgid: 'ACT123' }),
      });
      const res = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        recipientName: 'Acme Admin',
        message: 'Action needed on task',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe(SMS_SEND_STATUS.SENT);
      expect(res.messageId).toBe('ACT123');
      expect(res.response).toContain('ACT123');
      const sentPayload = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(sentPayload.smstosend[0].smstext).toContain('Acme Admin');
      expect(sentPayload.smstosend[0].smstext).toContain('Action needed on task');
      expect(sentPayload.smstosend[0].smstext).not.toMatch(/\{#[a-z0-9_]+#\}/i);

      const throttled = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Duplicate action',
      });
      expect(throttled.success).toBe(false);
      expect(throttled.status).toBe(SMS_SEND_STATUS.THROTTLED);
      expect(throttled.throttled).toBe(true);
      expect(throttled.messageId).toBeUndefined();

      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Gateway Error',
      });
      const failed = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Failure test',
      });
      expect(failed.success).toBe(false);
      expect(failed.status).toBe(SMS_SEND_STATUS.FAILED);

      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const errorRes = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Network error test',
      });
      expect(errorRes.success).toBe(false);
      expect(errorRes.status).toBe(SMS_SEND_STATUS.FAILED);
    });

    test('uses "Not specified" for a missing recipient name and the public frontend home for a missing link', async () => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_FRONTEND_URL = 'https://portal.example.test';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
      });

      const res = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Review the request',
      });
      delete process.env.PUBLIC_FRONTEND_URL;

      expect(res.success).toBe(true);
      expect(res.messageId).toBeUndefined();
      const smstext = JSON.parse(global.fetch.mock.calls[0][1].body).smstosend[0].smstext;
      expect(smstext).toContain('Not specified');
      expect(smstext).toContain('https://portal.example.test');
      expect(smstext).not.toContain('Valued Partner');
      expect(smstext).not.toContain('category-manager');
    });

    test('covers branch edge-cases for CF_ENV, URL cleaning, and Action Center fallbacks', async () => {
      // 1. clearSmsThrottleForPhone
      smsService.clearSmsThrottleForPhone('9157154504');
      smsService.clearSmsThrottleForPhone('invalid-num');

      // 2. CF_ENV fallback in getEnv
      const prevUrl = process.env.SMS_GATEWAY_URL;
      delete process.env.SMS_GATEWAY_URL;
      globalThis.__CF_ENV__ = { SMS_GATEWAY_URL: 'https://cf.example.com/sms' };
      expect(smsService.SMS_GATEWAY_CONFIG.URL).toBe('https://cf.example.com/sms');
      delete globalThis.__CF_ENV__;
      if (prevUrl) process.env.SMS_GATEWAY_URL = prevUrl;

      // 3. SMS_GATEWAY_CONFIG getters
      expect(smsService.SMS_GATEWAY_CONFIG.ACTION_CENTER_SMSGID).toBeTruthy();
      expect(smsService.SMS_GATEWAY_CONFIG.BUYER_UNLOCKED_SMSGID).toBeTruthy();

      // 4. sendRFQChaserSms with &source=wa_1click and empty title fallback
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';
      process.env.SMS_GATEWAY_RFQ_PASS = 'rfq-account-test-password';
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', msgid: 'CHASER-WA-CLEAN' }),
      });
      const resWa = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-999',
        rfqTitle: '',
        bidLink: 'https://procucev.com/quote?rfq=RFQ-999&source=wa_1click',
      });
      expect(resWa.success).toBe(true);
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).smstosend[0].smstext).not.toContain('source=wa_1click');

      // 5. sendBuyerComparisonSms with a custom matrix link and a zero quote count
      smsService.clearSmsThrottleCache();
      const resBuyerWa = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-888',
        buyerName: '',
        quotesCount: 2,
        matrixLink: 'https://procucev.com/compare?rfq=RFQ-888',
      });
      expect(resBuyerWa.success).toBe(true);

      // 6. sendActionCenterSms with a DLT rejection body
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'error', error: 'DLT_REJECT' }),
      });
      const resReject = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Rejected test',
      });
      expect(resReject.success).toBe(false);
      expect(resReject.status).toBe(SMS_SEND_STATUS.FAILED);

      // 7. sendActionCenterSms with ERR string response
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'ERR_INVALID_SENDER',
      });
      const resErrStr = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        message: 'Sender test',
      });
      expect(resErrStr.success).toBe(false);
      expect(resErrStr.status).toBe(SMS_SEND_STATUS.FAILED);
    });
  });

  describe('missing gateway credentials', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn();
    });

    test('sendOtpSms returns not_configured without calling the gateway or recording a throttle entry', async () => {
      delete process.env.SMS_GATEWAY_USER;
      delete process.env.SMS_GATEWAY_PASS;

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.NOT_CONFIGURED);
      expect(res.messageId).toBeUndefined();
      expect(res.error).toBe('SMS gateway credentials are not configured. Set SMS_GATEWAY_USER and SMS_GATEWAY_PASS before sending.');
      expect(global.fetch).not.toHaveBeenCalled();

      process.env.SMS_GATEWAY_USER = 'otp-test-user';
      process.env.SMS_GATEWAY_PASS = 'otp-test-password';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ msgid: 'otp-42' }),
      });
      const retry = await smsService.sendOtpSms('9157154504', '123456');
      expect(retry.success).toBe(true);
      expect(retry.status).toBe(SMS_SEND_STATUS.SENT);
      expect(retry.throttled).toBeUndefined();
      expect(retry.messageId).toBe('otp-42');
    });

    test('sendBuyerComparisonSms returns not_configured when the RFQ gateway account is missing', async () => {
      delete process.env.SMS_GATEWAY_RFQ_PASS;

      const res = await smsService.sendBuyerComparisonSms({ mobile: '9157154504', rfqNumber: 'RFQ-NC-01', quotesCount: 3 });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.NOT_CONFIGURED);
      expect(res.error).toBe('RFQ SMS gateway credentials are not configured');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sendActionCenterSms returns not_configured when the gateway account is missing', async () => {
      delete process.env.SMS_GATEWAY_USER;

      const res = await smsService.sendActionCenterSms({
        mobile: '9157154504',
        recipientName: 'Test Recipient',
        message: 'Payment due today',
        entityType: 'payment',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.NOT_CONFIGURED);
      expect(res.error).toBe('SMS gateway credentials are not configured. Set SMS_GATEWAY_USER and SMS_GATEWAY_PASS before sending.');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('test environment reports skipped with reason test_environment even when no account is configured', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.SMS_GATEWAY_USER;
      delete process.env.SMS_GATEWAY_RFQ_USER;

      const res = await smsService.sendRFQChaserSms({ mobile: '9157154504', rfqNumber: 'RFQ-NC-02', vendorName: 'Test Vendor' });
      expect(res.success).toBe(false);
      expect(res.status).toBe(SMS_SEND_STATUS.SKIPPED);
      expect(res.reason).toBe('test_environment');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
