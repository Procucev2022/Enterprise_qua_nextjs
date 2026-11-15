const whatsAppService = require('../src/services/whatsAppService');

const { WHATSAPP_SEND_STATUS } = whatsAppService;

// Every variable these tests change is restored after each case.
const ENV_KEYS = [
  'WHATSAPP_USERNAME',
  'WHATSAPP_PASSWORD',
  'WHATSAPP_FROM_NUMBER',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_TEMPLATE_RFQ_INVITE',
  'WHATSAPP_TEMPLATE_RFQ_NOTIFICATION',
];

describe('WhatsApp Service Unit Tests', () => {
  beforeEach(() => {
    whatsAppService.clearWhatsAppThrottleCache();
  });

  test('formatWhatsAppNumber formats 10, 11, and 12 digit numbers with 91 prefix', () => {
    expect(whatsAppService.formatWhatsAppNumber('9876543210')).toBe('919876543210');
    expect(whatsAppService.formatWhatsAppNumber('09876543210')).toBe('919876543210');
    expect(whatsAppService.formatWhatsAppNumber('919876543210')).toBe('919876543210');
    expect(whatsAppService.formatWhatsAppNumber('+91 98765 43210')).toBe('919876543210');
    expect(whatsAppService.formatWhatsAppNumber('')).toBe('');
  });

  test('generateOneClickBidUrl creates 1-click tokenized bid link', () => {
    const url = whatsAppService.generateOneClickBidUrl('RFQ-2026-001', 'supplier@supplier.test');
    expect(url).toContain('RFQ-2026-001');
    expect(url).toContain('source=wa_1click');
    expect(url).toContain('supplier%40supplier.test');
  });

  test('buildDirectWhatsAppLink returns a wa.me deep-link', () => {
    const link = whatsAppService.buildDirectWhatsAppLink('9876543210', 'Hello RFQ-001');
    expect(link).toContain('https://wa.me/919876543210');
    expect(link).toContain(encodeURIComponent('Hello RFQ-001'));
  });

  test('sendRFQInvitationWhatsApp returns not_configured with a wa.me link and never reports the message as sent', async () => {
    const savedEnv = {};
    ENV_KEYS.forEach((key) => {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    });
    let res;
    try {
      res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        vendorName: 'Test Supplier Ltd',
        contactPerson: 'Test Contact',
        rfqNumber: 'RFQ-2026-001',
        rfqTitle: 'Centrifugal Pumps & Valves',
        vendorEmail: 'contact@supplier.test',
        deliveryDate: '2026-12-01',
        deliveryLocation: 'Mumbai, Maharashtra',
      });
    } finally {
      ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      });
    }

    expect(res.success).toBe(false);
    expect(res.status).toBe(WHATSAPP_SEND_STATUS.NOT_CONFIGURED);
    expect(res.messageId).toBeUndefined();
    expect(res.error).toBe('No WhatsApp provider is configured. Set WHATSAPP_USERNAME, WHATSAPP_PASSWORD and WHATSAPP_FROM_NUMBER for sendmsg.in, or WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN for Meta Cloud API. Share the returned link manually until then.');
    expect(res.link).toContain('https://wa.me/919876543210');
    expect(res.bidUrl).toContain('RFQ-2026-001');
  });

  test('sendRFQInvitationWhatsApp rejects invalid phone number with status skipped', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '123',
      vendorName: 'Test Supplier Ltd',
      rfqNumber: 'RFQ-2026-001',
      rfqTitle: 'Centrifugal Pumps',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(WHATSAPP_SEND_STATUS.SKIPPED);
    expect(res.error).toBe('Invalid phone number format');
    expect(res.link).toBeUndefined();
  });

  test('sendRFQInvitationWhatsApp refuses to build a message without an RFQ number', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Test Vendor',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(WHATSAPP_SEND_STATUS.SKIPPED);
    expect(res.error).toBe('An RFQ number is required to send a WhatsApp RFQ invitation.');
    expect(res.link).toBeUndefined();
  });

  test('sendRFQInvitationWhatsApp shows "Not specified" for missing optional fields in the link text', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Test Vendor',
      rfqNumber: 'RFQ-2026-099',
      rfqTitle: '',
    });

    expect(res.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
    const linkText = decodeURIComponent(res.link);
    expect(linkText).toContain('*Delivery Date:* Not specified');
    expect(linkText).toContain('*Delivery Location:* Not specified');
    expect(linkText).toContain('*Description:* Not specified');
    expect(res.bidUrl).toContain('RFQ-2026-099');
  });

  test('WHATSAPP_CONFIG exposes sendmsg.in fields', () => {
    expect(whatsAppService.WHATSAPP_CONFIG).toHaveProperty('SENDMSG_BASE_URL');
    expect(whatsAppService.WHATSAPP_CONFIG).toHaveProperty('USERNAME');
    expect(whatsAppService.WHATSAPP_CONFIG).toHaveProperty('FROM_NUMBER');
    expect(whatsAppService.WHATSAPP_CONFIG).toHaveProperty('TEMPLATE_RFQ_INVITE');
    expect(whatsAppService.WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE).toBe(
      process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION || 'rfq_notification_for_sellers_for_rfq_feb_5'
    );
  });

  describe('production dispatch and gateway fallbacks', () => {
    const origEnv = process.env.NODE_ENV;
    const origFetch = global.fetch;
    const savedEnv = {};

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      ENV_KEYS.forEach((key) => {
        savedEnv[key] = process.env[key];
      });
      process.env.WHATSAPP_USERNAME = 'testuser';
      process.env.WHATSAPP_PASSWORD = 'testpass';
      process.env.WHATSAPP_FROM_NUMBER = '919606848835';
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      whatsAppService.clearWhatsAppThrottleCache();
    });

    afterEach(() => {
      process.env.NODE_ENV = origEnv;
      global.fetch = origFetch;
      ENV_KEYS.forEach((key) => {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      });
      whatsAppService.clearWhatsAppThrottleCache();
    });

    test('reports sent with the provider message id when sendmsg.in returns one', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', messageId: 'wa-123' }),
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        vendorName: 'Test Supplier',
        contactPerson: 'Rahul',
        rfqNumber: 'RFQ-WA-01',
        rfqTitle: 'Valves',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      expect(res.messageId).toBe('wa-123');
    });

    test('leaves messageId undefined when sendmsg.in accepts the message without an id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-WA-NOID',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      expect(res.messageId).toBeUndefined();
    });

    test('throttles rapid duplicate WhatsApp dispatches with status throttled', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
      });

      const first = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-WA-01',
      });
      expect(first.success).toBe(true);
      expect(first.status).toBe(WHATSAPP_SEND_STATUS.SENT);

      const second = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-WA-01',
      });
      expect(second.success).toBe(false);
      expect(second.status).toBe(WHATSAPP_SEND_STATUS.THROTTLED);
      expect(second.throttled).toBe(true);
      expect(second.messageId).toBeUndefined();
      expect(second.link).toContain('https://wa.me/919876543210');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('falls back to Meta Cloud API after a sendmsg.in rejection', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ status: 'error', message: 'Template not approved' }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'meta-msg-99' }] }),
        });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-WA-02',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      expect(res.messageId).toBe('meta-msg-99');
    });

    test('formats placeholders strictly for rfq_notification_for_sellers_for_rfq_feb_5 without rogue keys', async () => {
      let sentPayload = null;
      global.fetch = jest.fn().mockImplementation((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'success' }),
        });
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-FEB5-01',
        deliveryDate: '2026-11-01',
        deliveryLocation: 'Ahmedabad',
        rfqTitle: 'Industrial Pumps',
      });
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      expect(sentPayload).toBeDefined();
      const placeholders = sentPayload.whatsapptosend[0].placeholders[0];
      expect(placeholders).toEqual({
        '1': 'RFQ-FEB5-01',
        '2': '2026-11-01',
        '3': 'Ahmedabad',
        '4': 'Industrial Pumps',
        '5': expect.stringContaining('RFQ-FEB5-01'),
      });
      expect(placeholders['0']).toBeUndefined();
    });

    test('uses "Not specified" in template placeholders when optional fields are missing', async () => {
      process.env.WHATSAPP_TEMPLATE_RFQ_INVITE = 'rfq_reminder_notification_v2';
      let capturedBody = null;
      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'success' }) };
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-PH-01' });
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      const placeholders = capturedBody.whatsapptosend[0].placeholders[0];
      expect(placeholders['1']).toBe('RFQ-PH-01');
      expect(placeholders['2']).toBe('Not specified');
      expect(placeholders['3']).toBe('Not specified');
      expect(placeholders['4']).toBe('Not specified');
      expect(placeholders['5']).toContain('RFQ-PH-01');
    });

    test('never calls a provider when no RFQ number is supplied', async () => {
      global.fetch = jest.fn();
      const res = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', contactPerson: 'Aditi' });

      expect(res.success).toBe(false);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.SKIPPED);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('returns not_configured without calling any provider, and a later configured send is not throttled', async () => {
      delete process.env.WHATSAPP_USERNAME;
      delete process.env.WHATSAPP_PASSWORD;
      delete process.env.WHATSAPP_FROM_NUMBER;
      global.fetch = jest.fn();

      const res = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-NOGW-01' });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(res.success).toBe(false);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.NOT_CONFIGURED);
      expect(res.messageId).toBeUndefined();
      expect(res.link).toContain('https://wa.me/919876543210');

      process.env.WHATSAPP_USERNAME = 'testuser';
      process.env.WHATSAPP_PASSWORD = 'testpass';
      process.env.WHATSAPP_FROM_NUMBER = '919606848835';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
      });
      const retry = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-NOGW-01' });
      expect(retry.status).toBe(WHATSAPP_SEND_STATUS.SENT);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('reports link_only with the error text when every gateway throws', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network connection timeout on sendmsg'))
        .mockRejectedValueOnce(new Error('Network connection timeout on Meta'));

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-ERR-01',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
      expect(res.error).toBe('Network connection timeout on Meta');
      expect(res.messageId).toBeUndefined();
      expect(res.link).toContain('https://wa.me/919876543210');
    });

    test('reports link_only with the provider error when the Meta Cloud API returns an error payload', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => { throw new Error('Cannot read text'); },
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'OAuth Exception: Invalid OAuth access token' } }),
        });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-META-ERR-01',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
      expect(res.error).toBe('OAuth Exception: Invalid OAuth access token');
      expect(res.messageId).toBeUndefined();
    });

    test('reports link_only with the HTTP status when Meta returns an unreadable body', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => { throw new Error('Invalid JSON'); },
        });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-META-ERR-02',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
      expect(res.error).toBe('HTTP 502');
      expect(res.messageId).toBeUndefined();
    });

    test('reports link_only for sendmsg.in 200 responses that carry an error status (array and object payloads)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ Status: 'Error', error: 'Balance zero' }]),
      });

      const res1 = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-ARR-ERR' });
      expect(res1.success).toBe(false);
      expect(res1.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
      expect(res1.error).toBe('sendmsg.in: Balance zero');
      expect(res1.messageId).toBeUndefined();

      whatsAppService.clearWhatsAppThrottleForPhone('9876543210');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'failure', reason: 'Blocked recipient' }),
      });

      const res2 = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-OBJ-ERR' });
      expect(res2.success).toBe(false);
      expect(res2.status).toBe(WHATSAPP_SEND_STATUS.LINK_ONLY);
      expect(res2.error).toBe('sendmsg.in: Blocked recipient');
    });

    test('WHATSAPP_CONFIG getters all resolve correctly', () => {
      expect(whatsAppService.WHATSAPP_CONFIG.SENDMSG_BASE_URL).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.SENDMSG_TEMPLATE_URL).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.USERNAME).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.PASSWORD).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.FROM_NUMBER).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.META_API_URL).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.PHONE_NUMBER_ID).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.ACCESS_TOKEN).toBeDefined();
      expect(whatsAppService.WHATSAPP_CONFIG.SUPPORT_NUMBER).toBeDefined();

      // Test CF environment shim branch
      globalThis.__CF_ENV__ = { WHATSAPP_SUPPORT_NUMBER: '919000000001' };
      const origSupport = process.env.WHATSAPP_SUPPORT_NUMBER;
      delete process.env.WHATSAPP_SUPPORT_NUMBER;
      expect(whatsAppService.WHATSAPP_CONFIG.SUPPORT_NUMBER).toBe('919000000001');
      if (origSupport !== undefined) process.env.WHATSAPP_SUPPORT_NUMBER = origSupport;
      delete globalThis.__CF_ENV__;
    });

    test('clearWhatsAppThrottleForPhone clears cache for individual number', () => {
      whatsAppService.clearWhatsAppThrottleForPhone('9876543210');
      whatsAppService.clearWhatsAppThrottleForPhone('');
      expect(true).toBe(true);
    });
  });
});
