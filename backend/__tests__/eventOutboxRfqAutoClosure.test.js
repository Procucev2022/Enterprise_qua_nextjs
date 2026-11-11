const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable RFQ auto-closure acknowledgement delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-auto-close-email:quote-close-1',
      event_type: EVENT_OUTBOX_TYPES.RFQ_AUTO_CLOSURE_ACK_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-rfq-auto-close-1',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  const payload = {
    rfqId: 'rfq-auto-close-1',
    quoteId: 'quote-close-1',
    recipientEmail: 'buyer@example.test',
    recipientName: 'Buyer Organization',
  };

  test('reloads the persisted RFQ and completes an accepted closure acknowledgement', async () => {
    claim(payload);
    const rfq = {
      id: 'rfq-auto-close-1',
      rfqNumber: 'RFQ-AUTO-CLOSE-1',
      status: 'Closed',
      quotes: [
        { id: 'quote-close-1', vendorId: 'vendor-1' },
        { id: 'quote-close-2', vendorId: 'vendor-2' },
      ],
    };
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-auto-close-1');
    expect(sendSpy).toHaveBeenCalledWith('buyer@example.test', {
      rfq,
      quotesCount: 2,
      recipientName: 'Buyer Organization',
    });
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'rfq-auto-close-email:quote-close-1',
      'lease-rfq-auto-close-1'
    );
  });

  test.each([
    [null],
    [{ ...payload, rfqId: '' }],
    [{ ...payload, quoteId: '' }],
    [{ ...payload, recipientEmail: 'invalid' }],
  ])('dead-letters a malformed persisted auto-closure email %p', async (raw) => {
    claim(raw);
    const sendSpy = jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test.each([
    [null],
    [{ id: 'rfq-auto-close-1', quotes: [] }],
  ])('dead-letters a closure email whose RFQ or quote no longer exists %p', async (rfq) => {
    claim(payload);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('retries an auto-closure acknowledgement when the provider rejects it', async () => {
    claim(payload);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      id: 'rfq-auto-close-1',
      quotes: [{ id: 'quote-close-1', vendorId: 'vendor-1' }],
    });
    jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-auto-close-email:quote-close-1',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });
});
