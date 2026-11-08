const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

const eventId = 'buyer-profile-reminder:rfq-1';
const payload = {
  rfqId: 'rfq-1',
  quoteId: 'quote-1',
  recipientEmail: 'pending@example.test',
  recipientName: 'Buyer Organization',
};
const persistedRfq = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-1',
  title: 'Pump spares',
  sourcingMode: 'mode_1',
  quotes: [{ id: 'quote-1', vendorId: 'vendor-1' }],
};

describe('durable buyer profile completion reminders', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw = payload) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: eventId,
      event_type: EVENT_OUTBOX_TYPES.BUYER_PROFILE_COMPLETION_REMINDER_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-profile-reminder-1',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('reloads quote and current buyer state before sending an accepted reminder', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      organizationName: 'Current Buyer Organization',
      onboardingRequired: true,
      status: 'PENDING_ONBOARDING',
    });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail')
      .mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-1');
    expect(domainQueries.getBuyerAccountByEmailFromDB).toHaveBeenCalledWith('pending@example.test', { fresh: true });
    expect(send).toHaveBeenCalledWith({
      to: 'pending@example.test',
      recipientName: 'Current Buyer Organization',
      rfqNumber: 'RFQ-1',
      rfqTitle: 'Pump spares',
      quotesCount: 1,
    });
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      eventId,
      'lease-profile-reminder-1'
    );
  });

  test('suppresses a reminder after profile completion', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      onboardingRequired: false,
      status: 'ACTIVE_VERIFIED',
      profileVerified: true,
      phone: '9876543210',
    });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(send).not.toHaveBeenCalled();
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      eventId,
      'lease-profile-reminder-1'
    );
  });

  test('completes without delivery when the buyer account has been removed', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue(null);
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(send).not.toHaveBeenCalled();
  });

  test('uses the generic recipient name when persisted and queued names are empty', async () => {
    claim({ ...payload, recipientName: null });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      onboardingRequired: true,
    });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail')
      .mockResolvedValue({ sent: true });

    await eventOutboxService.dispatchDueEventOutboxJobs(1);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipientName: 'Buyer',
    }));
  });

  test('dead-letters a reminder with an invalid current buyer email', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      onboardingRequired: true,
    });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('retries a reminder when the provider refuses delivery', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      onboardingRequired: true,
    });
    jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      completed: 0,
      retried: 1,
      dead: 0,
    });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: eventId,
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test.each([
    [null],
    [{ ...payload, rfqId: '' }],
    [{ ...payload, quoteId: '' }],
    [{ ...payload, recipientEmail: 'invalid' }],
  ])('dead-letters malformed persisted reminder payload %p', async (raw) => {
    claim(raw);
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('dead-letters a reminder when its persisted quote no longer exists', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ ...persistedRfq, quotes: [] });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
  });

  test('dead-letters a reminder when the persisted quote has no id', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      ...persistedRfq,
      quotes: [{}],
    });
    const send = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
  });
});
