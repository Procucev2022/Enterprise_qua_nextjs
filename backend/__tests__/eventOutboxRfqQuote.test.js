const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

describe('durable RFQ quote notification delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-quote-email:quote-1',
      event_type: EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-rfq-quote-1',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  const payload = {
    rfqId: 'rfq-quote-1',
    quoteId: 'quote-1',
    recipientEmail: 'buyer@example.test',
    recipientName: 'Buyer Organization',
  };

  test('reloads the persisted quote and completes an accepted buyer email', async () => {
    claim(payload);
    const quote = { id: 'quote-1', vendorId: 'vendor-1', unitPrice: 125 };
    const rfq = {
      id: 'rfq-quote-1',
      rfqNumber: 'RFQ-QUOTE-1',
      title: 'Pump spares',
      quotes: [quote],
    };
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-quote-1');
    expect(sendSpy).toHaveBeenCalledWith('buyer@example.test', {
      rfq,
      quote,
      recipientName: 'Buyer Organization',
    });
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'rfq-quote-email:quote-1',
      'lease-rfq-quote-1'
    );
  });

  test.each([
    [null],
    [{ ...payload, rfqId: '' }],
    [{ ...payload, quoteId: '' }],
    [{ ...payload, recipientEmail: 'invalid' }],
  ])('dead-letters a malformed persisted quote notification %p', async (raw) => {
    claim(raw);
    const sendSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test.each([
    [null],
    [{ id: 'rfq-quote-1', quotes: [] }],
  ])('dead-letters a quote notification with no persisted RFQ or quote %p', async (rfq) => {
    claim(payload);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('retries a quote notification when the email provider rejects it', async () => {
    claim(payload);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      id: 'rfq-quote-1',
      quotes: [{ id: 'quote-1', vendorId: 'vendor-1' }],
    });
    jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-quote-email:quote-1',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });
});
