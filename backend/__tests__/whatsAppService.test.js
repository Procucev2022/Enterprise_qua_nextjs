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
  });
});
