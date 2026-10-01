const smsService = require('../src/services/smsService');

describe('smsService Unit Tests', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;

  beforeEach(() => {
    smsService.clearSmsThrottleCache();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
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
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"success","msgid":"MSG123"}',
      });

      const res = await smsService.sendOtpSms('9157154504', '123456');
      expect(res.success).toBe(true);
      expect(res.response).toContain('MSG123');
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
  });
});
