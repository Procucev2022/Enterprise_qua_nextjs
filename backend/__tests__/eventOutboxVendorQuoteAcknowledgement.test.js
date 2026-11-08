const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

const eventId = 'vendor-quote-ack:quote-1';
const payload = {
  rfqId: 'rfq-1',
  quoteId: 'quote-1',
  recipientEmail: 'vendor@example.test',
  recipientName: 'Current Vendor',
  buyerEmail: 'buyer@example.test',
};
const persistedRfq = {
  id: 'rfq-1',
  rfqNumber: 'RFQ-1',
  title: 'Pump spares',
  quotes: [{ id: 'quote-1', vendorId: 'vendor-1', vendorName: 'Atomic Vendor', unitPrice: 120 }],
};

describe('durable vendor quote acknowledgements', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw = payload) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: eventId,
      event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_QUOTE_ACK_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-vendor-quote-ack-1',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  test('reloads the committed quote and delivers the vendor acknowledgement', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-1');
    expect(send).toHaveBeenCalledWith('vendor@example.test', {
      rfqNumber: 'RFQ-1',
      rfqTitle: 'Pump spares',
      vendorName: 'Current Vendor',
      quote: persistedRfq.quotes[0],
      buyerEmail: 'buyer@example.test',
    });
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      eventId,
      'lease-vendor-quote-ack-1'
    );
  });

  test('uses the persisted quote vendor name when the queued name is absent', async () => {
    claim({ ...payload, recipientName: null, buyerEmail: null });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });

    await eventOutboxService.dispatchDueEventOutboxJobs(1);

    expect(send).toHaveBeenCalledWith('vendor@example.test', expect.objectContaining({
      vendorName: 'Atomic Vendor',
      buyerEmail: null,
    }));
  });

  test('uses a generic name when neither the queued event nor persisted quote has a vendor name', async () => {
    claim({ ...payload, recipientName: null, buyerEmail: null });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      ...persistedRfq,
      quotes: [{ id: 'quote-1', vendorId: 'vendor-1' }],
    });
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });

    await eventOutboxService.dispatchDueEventOutboxJobs(1);

    expect(send).toHaveBeenCalledWith('vendor@example.test', expect.objectContaining({
      vendorName: 'Vendor',
    }));
  });

  test('retries a vendor acknowledgement when the provider refuses delivery', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(persistedRfq);
    jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: false });

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
    [{ ...payload, buyerEmail: 'invalid' }],
  ])('dead-letters an invalid acknowledgement payload %p', async (raw) => {
    claim(raw);
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('dead-letters an acknowledgement when its persisted quote no longer exists', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ ...persistedRfq, quotes: [] });
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
  });

  test('dead-letters an acknowledgement when its persisted RFQ no longer exists', async () => {
    claim();
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    const send = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

    expect(send).not.toHaveBeenCalled();
  });
});
