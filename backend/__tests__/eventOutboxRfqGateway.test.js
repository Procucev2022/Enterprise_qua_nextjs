const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable RFQ gateway notification delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-gateway-email:rfq-gateway-1',
      event_type: EVENT_OUTBOX_TYPES.RFQ_GATEWAY_NOTIFICATION_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-rfq-gateway-1',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('reloads the saved RFQ and completes an accepted gateway email', async () => {
    claim({ rfqId: 'rfq-gateway-1' });
    const rfq = {
      id: 'rfq-gateway-1',
      rfqNumber: 'RFQ-GATEWAY-1',
      title: 'Pump spares',
      gatewayNotificationTarget: {
        recipientEmail: 'gateway@example.test',
        sourceEmail: 'buyer@example.test',
      },
    };
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendRequisitionNotificationEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-gateway-1');
    expect(sendSpy).toHaveBeenCalledWith('gateway@example.test', rfq, 'buyer@example.test');
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'rfq-gateway-email:rfq-gateway-1',
      'lease-rfq-gateway-1'
    );
  });

  test.each([
    [null],
    [{ id: 'rfq-gateway-1' }],
    [{ id: 'rfq-gateway-1', gatewayNotificationTarget: { recipientEmail: 'invalid' } }],
    [{ id: 'rfq-gateway-1', gatewayNotificationTarget: { recipientEmail: 'gateway@example.test', sourceEmail: 'invalid' } }],
  ])('dead-letters a missing RFQ or invalid persisted gateway target %p', async (rfq) => {
    claim({ rfqId: 'rfq-gateway-1' });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendRequisitionNotificationEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('retries a gateway email when the provider does not accept it', async () => {
    claim({ rfqId: 'rfq-gateway-1' });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      id: 'rfq-gateway-1',
      gatewayNotificationTarget: { recipientEmail: 'gateway@example.test' },
    });
    jest.spyOn(mailerService, 'sendRequisitionNotificationEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-gateway-email:rfq-gateway-1',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });
});
