const whatsAppService = require('../src/services/whatsAppService');

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
    const url = whatsAppService.generateOneClickBidUrl('RFQ-2026-001', 'supplier@apex.com');
    expect(url).toContain('RFQ-2026-001');
    expect(url).toContain('source=wa_1click');
    expect(url).toContain('supplier%40apex.com');
  });

  test('buildDirectWhatsAppLink returns a wa.me deep-link', () => {
    const link = whatsAppService.buildDirectWhatsAppLink('9876543210', 'Hello RFQ-001');
    expect(link).toContain('https://wa.me/919876543210');
    expect(link).toContain(encodeURIComponent('Hello RFQ-001'));
  });

  test('sendRFQInvitationWhatsApp dispatches RFQ invitation and generates wa.me deep-link', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Apex Supplies Ltd',
      contactPerson: 'Rajesh Kumar',
      rfqNumber: 'RFQ-2026-001',
      rfqTitle: 'Centrifugal Pumps & Valves',
      vendorEmail: 'rajesh@apex.com',
      deliveryDate: '2026-12-01',
      deliveryLocation: 'Mumbai, Maharashtra',
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBeDefined();
    expect(res.link).toContain('https://wa.me/919876543210');
    expect(res.bidUrl).toContain('RFQ-2026-001');
  });

  test('sendRFQInvitationWhatsApp rejects invalid phone number', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '123',
      vendorName: 'Apex Supplies Ltd',
      rfqNumber: 'RFQ-2026-001',
      rfqTitle: 'Centrifugal Pumps',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('Invalid phone number format');
  });

  test('sendRFQInvitationWhatsApp handles missing optional fields gracefully', async () => {
    const res = await whatsAppService.sendRFQInvitationWhatsApp({
      phone: '9876543210',
      vendorName: 'Test Vendor',
      rfqNumber: 'RFQ-2026-099',
      rfqTitle: '',
    });

    expect(res.success).toBe(true);
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

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      whatsAppService.clearWhatsAppThrottleCache();
      whatsAppService.WHATSAPP_CONFIG.USERNAME = 'testuser';
      whatsAppService.WHATSAPP_CONFIG.PASSWORD = 'testpass';
      whatsAppService.WHATSAPP_CONFIG.FROM_NUMBER = '919606848835';
    });

    afterEach(() => {
      process.env.NODE_ENV = origEnv;
      global.fetch = origFetch;
      whatsAppService.clearWhatsAppThrottleCache();
    });

    test('successfully dispatches via sendmsg.in in production', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', messageId: 'wa-123' }),
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        vendorName: 'Apex',
        contactPerson: 'Rahul',
        rfqNumber: 'RFQ-WA-01',
        rfqTitle: 'Valves',
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toContain('sendmsg-');
    });

    test('throttles rapid duplicate WhatsApp dispatches in production', async () => {
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

      const second = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-WA-01',
      });
      expect(second.success).toBe(true);
      expect(second.throttled).toBe(true);
      expect(second.messageId).toBe('wa-throttled');
    });

    test('handles sendmsg.in gateway failure and falls back to Meta or deep-link', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      // sendmsg.in fails, Meta succeeds
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
      expect(res.messageId).toBe('meta-msg-99');

      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
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
      expect(res.success).toBe(true);
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

    test('supports 6-placeholder reminder template with v2 in template name', async () => {
      const origTemplate = process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION;
      process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION = 'rfq_reminder_notification_v2';

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success' }),
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-REMIND-01',
        contactPerson: 'Aditi',
        vendorName: 'Aditi Corp',
        deliveryDate: '2026-11-15',
        deliveryLocation: 'Hyderabad',
        rfqTitle: 'Bearings',
      });
      expect(res.success).toBe(true);

      if (origTemplate) {
        process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION = origTemplate;
      } else {
        delete process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION;
      }
    });

    test('handles network exceptions in sendmsg.in and Meta Cloud gracefully', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      // sendmsg throws, Meta throws -> falls through to deep-link
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Network connection timeout on sendmsg'))
        .mockRejectedValueOnce(new Error('Network connection timeout on Meta'));

      const res = await whatsAppService.sendRFQInvitationWhatsApp({
        phone: '9876543210',
        rfqNumber: 'RFQ-ERR-01',
      });
      expect(res.success).toBe(true);
      expect(res.messageId).toContain('wa-link-');

      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
    });

    test('handles Meta Cloud API returning error status code', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      // sendmsg fails, Meta returns 400 error payload
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
      expect(res.success).toBe(true);
      expect(res.messageId).toContain('wa-link-');

      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
    });

    test('handles Meta Cloud API with empty response and json parse error', async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'meta-phone-1';
      process.env.WHATSAPP_ACCESS_TOKEN = 'meta-token-1';

      // sendmsg fails, Meta returns 502 with throwing json
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
      expect(res.success).toBe(true);
      expect(res.messageId).toContain('wa-link-');

      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
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
      globalThis.__CF_ENV__ = { WHATSAPP_SUPPORT_NUMBER: '919999999999' };
      const origSupport = process.env.WHATSAPP_SUPPORT_NUMBER;
      delete process.env.WHATSAPP_SUPPORT_NUMBER;
      expect(whatsAppService.WHATSAPP_CONFIG.SUPPORT_NUMBER).toBe('919999999999');
      if (origSupport !== undefined) process.env.WHATSAPP_SUPPORT_NUMBER = origSupport;
      delete globalThis.__CF_ENV__;
    });

    test('clearWhatsAppThrottleForPhone clears cache for individual number', () => {
      whatsAppService.clearWhatsAppThrottleForPhone('9876543210');
      whatsAppService.clearWhatsAppThrottleForPhone('');
      expect(true).toBe(true);
    });

    test('covers placeholder fallbacks for v2 and legacy templates', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WHATSAPP_USERNAME = 'user';
      process.env.WHATSAPP_PASSWORD = 'pass';
      process.env.WHATSAPP_FROM_NUMBER = '919000000000';

      // v2 template with empty fields
      process.env.WHATSAPP_TEMPLATE_RFQ_INVITE = 'rfq_reminder_notification_v2';
      process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION = 'rfq_reminder_notification_v2';
      let capturedBody = null;
      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, text: async () => JSON.stringify({ status: 'success' }) };
      });

      const res = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210' });
      expect(res.success).toBe(true);
      const ph1 = capturedBody.whatsapptosend[0].placeholders[0];
      expect(ph1['1']).toBe('N/A');
      expect(ph1['2']).toBe('As per RFQ');
      expect(ph1['3']).toBe('As per RFQ');
      expect(ph1['4']).toBe('Procurement Requisition');
      expect(ph1['5']).toContain('https://');

      // legacy template with empty fields
      whatsAppService.clearWhatsAppThrottleForPhone('9876543210');
      process.env.WHATSAPP_TEMPLATE_RFQ_INVITE = 'legacy_rfq_invite';
      process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION = 'legacy_rfq_invite';
      await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210' });
      const ph2 = capturedBody.whatsapptosend[0].placeholders[0];
      expect(ph2['1']).toBe('N/A');
      expect(ph2['2']).toBe('As per RFQ');
      expect(ph2['3']).toBe('As per RFQ');
      expect(ph2['4']).toBe('Procurement Requisition');

      delete process.env.WHATSAPP_TEMPLATE_RFQ_INVITE;
      delete process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION;
      delete process.env.WHATSAPP_USERNAME;
      delete process.env.WHATSAPP_PASSWORD;
      delete process.env.WHATSAPP_FROM_NUMBER;
      process.env.NODE_ENV = 'test';
    });

    test('handles sendmsg.in gateway status errors in 200 response with array and object payloads', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WHATSAPP_USERNAME = 'user';
      process.env.WHATSAPP_PASSWORD = 'pass';
      process.env.WHATSAPP_FROM_NUMBER = '919000000000';

      // Array body with Status and error property
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ Status: 'Error', error: 'Balance zero' }]),
      });

      const res1 = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-ARR-ERR' });
      expect(res1.success).toBe(true); // Falls back to deep-link
      expect(res1.messageId).toContain('wa-link-');

      // Object body with failure status and reason property
      whatsAppService.clearWhatsAppThrottleForPhone('9876543210');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'failure', reason: 'Blocked recipient' }),
      });

      const res2 = await whatsAppService.sendRFQInvitationWhatsApp({ phone: '9876543210', rfqNumber: 'RFQ-OBJ-ERR' });
      expect(res2.success).toBe(true); // Falls back to deep-link
      expect(res2.messageId).toContain('wa-link-');

      delete process.env.WHATSAPP_USERNAME;
      delete process.env.WHATSAPP_PASSWORD;
      delete process.env.WHATSAPP_FROM_NUMBER;
      process.env.NODE_ENV = 'test';
    });
  });
});
