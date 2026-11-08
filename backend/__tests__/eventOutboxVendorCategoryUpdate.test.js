const pool = require('../src/db/pool');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const notificationService = require('../src/services/vendorCategoryUpdateNotificationService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable vendor category update notifications', () => {
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
    vendorId: 'vendor-123',
  };

  function claim(raw = payload) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'category-update-event',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_CATEGORY_UPDATE_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'category-update-lease',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('completes only after the email provider accepts the notification', async () => {
    claim();
    jest.spyOn(notificationService, 'sendVendorCategoryUpdateNotification').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['category-update-event'])).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      completedIds: ['category-update-event'],
    });
    expect(notificationService.sendVendorCategoryUpdateNotification).toHaveBeenCalledWith(payload);
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'category-update-event',
      'category-update-lease'
    );
  });

  test('retries an email provider refusal', async () => {
    claim();
    jest.spyOn(notificationService, 'sendVendorCategoryUpdateNotification').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['category-update-event']))
      .resolves.toMatchObject({ retried: 1, dead: 0 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'category-update-event',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test('dead-letters an invalid persisted email payload', async () => {
    claim({ ...payload, recipientEmail: 'invalid' });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['category-update-event']))
      .resolves.toMatchObject({ retried: 0, dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });
});
