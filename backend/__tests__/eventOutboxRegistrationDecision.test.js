const pool = require('../src/db/pool');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const registrationDecisionNotificationService = require('../src/services/registrationDecisionNotificationService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable registration decision notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  const payload = {
    registrationId: 'registration-123',
    recipientEmail: 'buyer@example.test',
    recipientName: 'Asha Buyer',
    accountType: 'Buyer',
    decision: 'accepted',
  };

  function claim(raw = payload) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'registration-decision-email:registration-123',
      event_type: EVENT_OUTBOX_TYPES.REGISTRATION_DECISION_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'registration-lease',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('dispatches the persisted decision notice and completes only after provider acceptance', async () => {
    claim();
    jest.spyOn(registrationDecisionNotificationService, 'sendRegistrationDecisionNotification')
      .mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });
    expect(registrationDecisionNotificationService.sendRegistrationDecisionNotification).toHaveBeenCalledWith(payload);
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'registration-decision-email:registration-123',
      'registration-lease'
    );
  });

  test('reschedules a provider refusal without losing the registration outcome', async () => {
    claim();
    jest.spyOn(registrationDecisionNotificationService, 'sendRegistrationDecisionNotification')
      .mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1, dead: 0 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'registration-decision-email:registration-123',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test('dead-letters a corrupt persisted notification payload', async () => {
    claim({ decision: 'unsupported' });
    jest.spyOn(registrationDecisionNotificationService, 'sendRegistrationDecisionNotification')
      .mockRejectedValue(Object.assign(new Error('Invalid persisted payload'), { code: 'INVALID_PERSISTED_RECORD' }));

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1, retried: 0 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });
});
