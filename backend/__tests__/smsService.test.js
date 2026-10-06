const smsService = require('../src/services/smsService');

describe('smsService Unit Tests', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalRfqSmsgid = process.env.SMS_GATEWAY_RFQ_SMSGID;
  const originalSmsGatewayUser = process.env.SMS_GATEWAY_USER;
  const originalRfqSmsGatewayUser = process.env.SMS_GATEWAY_RFQ_USER;
  const originalRfqSmsGatewayPass = process.env.SMS_GATEWAY_RFQ_PASS;
  const originalFetch = global.fetch;

  beforeEach(() => {
    smsService.clearSmsThrottleCache();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
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
    test('rejects invalid mobile number', async () => {
      const res = await smsService.sendOtpSms('123', '123456');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid mobile number format');
    });

    test('returns mock success in test environment', async () => {
      process.env.NODE_ENV = 'test';
      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(true);
      expect(res.messageId).toBe('mock-test-sms-id');
    });

    test('performs live HTTP post in non-test environment', async () => {
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

    test('throttles rapid repeated dispatches to the same mobile number', async () => {
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
      expect(second.success).toBe(true);
      expect(second.throttled).toBe(true);
      expect(second.messageId).toBe('throttled-cooldown');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('handles gateway error response in non-test environment', async () => {
      process.env.NODE_ENV = 'production';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(false);
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

    test('sendRFQChaserSms dispatches RFQ chaser SMS and handles validation', async () => {
      const invalid = await smsService.sendRFQChaserSms({ mobile: '123', rfqNumber: 'RFQ-001' });
      expect(invalid.success).toBe(false);

      const valid = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        vendorName: 'Apex Supplies',
        rfqNumber: 'RFQ-001',
        rfqTitle: 'Valves',
        bidLink: 'https://procucev.com/quote',
      });
      expect(valid.success).toBe(true);
      expect(valid.messageId).toBeDefined();

      // Test with missing rfqTitle and missing bidLink
      const validFallback = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-002',
      });
      expect(validFallback.success).toBe(true);
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
      expect(throttled.success).toBe(true);
      expect(throttled.throttled).toBe(true);

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

      // Gateway exception
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection aborted'));
      const errorRes = await smsService.sendRFQChaserSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-CHASER-04',
      });
      expect(errorRes.success).toBe(false);
      expect(errorRes.error).toBe('Connection aborted');
    });

    test('sendRFQChaserSms aborts requests that exceed the gateway timeout', async () => {
      process.env.NODE_ENV = 'production';
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
        error: 'SMS gateway request timed out',
      });
      expect(otpResult).toMatchObject({
        success: false,
        error: 'SMS gateway request timed out',
      });
    });

    test('sendBuyerComparisonSms dispatches buyer comparison SMS and validates mobile', async () => {
      const invalid = await smsService.sendBuyerComparisonSms({ mobile: '123', rfqNumber: 'RFQ-001' });
      expect(invalid.success).toBe(false);

      const valid = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        buyerName: 'Acme Buyer',
        rfqNumber: 'RFQ-001',
        quotesCount: 3,
        matrixLink: 'https://procucev.com/matrix',
      });
      expect(valid.success).toBe(true);
      expect(valid.messageId).toBe('mock-test-sms-buyer-comparison');
    });

    test('sendBuyerComparisonSms handles production gateway flow, errors, and throttling', async () => {
      process.env.NODE_ENV = 'production';
      process.env.SMS_GATEWAY_USER = 'Procucev_OTP';
      process.env.SMS_GATEWAY_RFQ_USER = 'ProcucevWapp1';

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
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).user).toBe('Procucev_OTP');
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).pass).toBe(
        smsService.SMS_GATEWAY_CONFIG.PASS
      );

      // Throttling
      const throttled = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        buyerName: 'Acme Buyer',
        rfqNumber: 'RFQ-001',
      });
      expect(throttled.success).toBe(true);
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
      });
      expect(failed.success).toBe(false);

      // Gateway exception
      smsService.clearSmsThrottleCache();
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      const errorRes = await smsService.sendBuyerComparisonSms({
        mobile: '9157154504',
        rfqNumber: 'RFQ-003',
      });
      expect(errorRes.success).toBe(false);
    });
  });
});
