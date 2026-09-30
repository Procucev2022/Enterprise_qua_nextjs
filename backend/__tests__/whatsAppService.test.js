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
});
