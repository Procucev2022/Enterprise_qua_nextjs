const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const { logger } = require('../src/services/loggerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');

const rfq = {
  id: 'rfq-inquiry-email',
  rfqNumber: 'RFQ-INQUIRY-EMAIL',
  title: 'Inquiry email fixture',
  raisedByEmail: 'buyer@example.test',
  inquiries: [{
    id: 'inquiry-1',
    vendorName: 'Vendor One',
    vendorEmail: 'vendor@example.test',
    messages: [{
      id: 'message-1',
      message: 'Please confirm the drawing revision.',
    }],
  }],
};
const payload = { rfqId: rfq.id, inquiryId: 'inquiry-1', messageId: 'message-1' };

describe('durable vendor inquiry acknowledgement delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(raw = payload) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-inquiry-ack-event',
      event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INQUIRY_ACK_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'rfq-inquiry-ack-lease',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue({
      id: rfq.id,
      rfq,
      raw: JSON.stringify(rfq),
    });
    jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@example.test');
  }

  test('sends the persisted inquiry, CCs the buyer, and completes after provider acceptance', async () => {
    claim();
    jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValue({ sent: true });
    const loggerSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['rfq-inquiry-ack-event'])).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      completedIds: ['rfq-inquiry-ack-event'],
    });
    expect(mailerService.sendVendorIssueAcknowledgementEmail).toHaveBeenCalledWith('vendor@example.test', {
      rfq,
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      vendorName: 'Vendor One',
      issueMessage: 'Please confirm the drawing revision.',
      cc: 'buyer@example.test',
    });
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      'rfq-inquiry-ack-event',
      'rfq-inquiry-ack-lease'
    );
    expect(loggerSpy).toHaveBeenCalledWith('Vendor inquiry acknowledgement accepted by provider', expect.objectContaining({
      rfqId: rfq.id,
      inquiryId: 'inquiry-1',
      messageId: 'message-1',
      outboxId: 'rfq-inquiry-ack-event',
    }), 'EVENT_OUTBOX');
  });

  test('retries when the mail provider declines the acknowledgement', async () => {
    claim();
    jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['rfq-inquiry-ack-event']))
      .resolves.toMatchObject({ retried: 1, dead: 0 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-inquiry-ack-event',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test('dead-letters malformed event identity before reading RFQ data', async () => {
    claim({ rfqId: rfq.id, inquiryId: '', messageId: 'message-1' });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['rfq-inquiry-ack-event']))
      .resolves.toMatchObject({ retried: 0, dead: 1 });
    expect(domainQueries.getRFQSnapshotByIdFromDB).not.toHaveBeenCalled();
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('dead-letters events whose persisted inquiry or message is missing', async () => {
    claim();
    const sender = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValue({ sent: true });
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue({
      id: rfq.id,
      rfq: { ...rfq, inquiries: [] },
      raw: JSON.stringify({ ...rfq, inquiries: [] }),
    });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['rfq-inquiry-ack-event']))
      .resolves.toMatchObject({ retried: 0, dead: 1 });
    expect(sender).not.toHaveBeenCalled();
  });
});
