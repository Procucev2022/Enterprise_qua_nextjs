const { generateAIFeedItem, simulateChaserOutreach } = require('../src/services/aiChaserService');

describe('AI Chaser Service', () => {
  test('generateAIFeedItem formats log entry correctly', () => {
    const item = generateAIFeedItem({
      type: 'call',
      title: 'Call Placed',
      message: 'Engaged supplier contact',
      recipient: 'John Doe',
      rfqNumber: 'RFQ-2026-0891',
    });

    expect(item.id).toBeDefined();
    expect(item.timestamp).toBeDefined();
    expect(item.type).toBe('call');
    expect(item.title).toBe('Call Placed');
    expect(item.rfqNumber).toBe('RFQ-2026-0891');
  });

  test('simulateChaserOutreach generates Voice, WhatsApp, and SMS actions', () => {
    const rfq = { rfqNumber: 'RFQ-2026-0891', title: 'Hydraulic Pumps' };
    const vendor = { name: 'Apex Supplies', contactPerson: 'Rajesh', phone: '+91 98000 11111' };

    const actions = simulateChaserOutreach(rfq, vendor);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBe(3);

    const types = actions.map((a) => a.type);
    expect(types).toContain('whatsapp');
    expect(types).toContain('call');
    expect(types).toContain('sms');
  });
});
