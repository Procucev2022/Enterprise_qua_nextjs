const mailerService = require('../src/services/mailerService');
const notificationService = require('../src/services/vendorCategoryUpdateNotificationService');

describe('vendor category update notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  const payload = {
    recipientEmail: 'vendor@example.test',
    rfqNumber: 'RFQ-123',
    rfqTitle: 'Pump purchase',
    rfqCategory: 'Pumps',
    vendorName: 'Supplier One',
    vendorCurrentCategory: 'Valves',
    buyerAccountName: 'Buyer One',
    buyerEmail: 'buyer@example.test',
  };

  test('validates and sends the normalized persisted notification payload', async () => {
    const deliver = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });

    await expect(notificationService.sendVendorCategoryUpdateNotification({
      ...payload,
      recipientEmail: ' vendor@example.test ',
      rfqTitle: ' Pump purchase ',
    })).resolves.toEqual({ sent: true });
    expect(deliver).toHaveBeenCalledWith('vendor@example.test', expect.objectContaining({
      rfqTitle: 'Pump purchase',
      buyerEmail: 'buyer@example.test',
    }));
  });

  test.each([
    null,
    [],
    { ...payload, recipientEmail: 'invalid' },
    { ...payload, buyerEmail: 'invalid' },
    ...['rfqNumber', 'rfqTitle', 'rfqCategory', 'vendorName', 'vendorCurrentCategory', 'buyerAccountName']
      .map((field) => ({ ...payload, [field]: '' })),
    { ...payload, rfqTitle: 'x'.repeat(1001) },
  ])('rejects invalid persisted notification payloads', (invalidPayload) => {
    expect(() => notificationService.validatePayload(invalidPayload))
      .toThrow(expect.objectContaining({ code: 'INVALID_PERSISTED_RECORD' }));
  });

  test('allows an absent buyer email for accounts with no corporate address', () => {
    expect(notificationService.validatePayload({ ...payload, buyerEmail: null }).buyerEmail).toBeNull();
  });
});
