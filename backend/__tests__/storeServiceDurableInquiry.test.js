const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const rfqInquiryQueries = require('../src/db/rfqInquiryQueries');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');

function makeRFQ(inquiries = []) {
  return {
    id: 'rfq-durable-inquiry',
    rfqNumber: 'RFQ-DURABLE-INQUIRY',
    title: 'Durable inquiry fixture',
    buyerAccountId: 'buyer-durable-inquiry',
    raisedByEmail: 'buyer@example.com',
    status: 'Quotes Received',
    quotes: [],
    inquiries,
  };
}

describe('durable RFQ clarification threads', () => {
  beforeEach(() => {
    storeService.reset();
    storeService.rfqs = [];
    storeService.auditLogs = [];
    storeService.aiFeed = [];
    storeService.notifications = [];
  });

  afterEach(() => jest.restoreAllMocks());

  test('waits for inquiry persistence before changing cache or notifying the buyer', async () => {
    const rfq = makeRFQ();
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const snapshot = { id: rfq.id, rfq, raw: JSON.stringify(rfq) };
    const readSpy = jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue(snapshot);
    let persistedRFQ;
    let signalUpdateStarted;
    const updateStarted = new Promise((resolve) => { signalUpdateStarted = resolve; });
    let releaseUpdate;
    const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
    const updateSpy = jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(async (_snapshot, updatedRFQ) => {
      persistedRFQ = updatedRFQ;
      signalUpdateStarted();
      await updateGate;
      return updatedRFQ;
    });
    const notifySpy = jest.spyOn(storeService, 'notifyBuyerOfInquiry').mockImplementation(() => {});

    const inquiryPromise = storeService.addInquiryToRFQ(rfq.id, {
      message: 'Please share the drawing revision.',
      vendorId: 'vendor-1',
      vendorName: 'Vendor One',
      vendorEmail: 'vendor@example.com',
      messageId: '<vendor-inquiry-1@example.com>',
    });
    await updateStarted;

    expect(readSpy).toHaveBeenCalledWith(rfq.id);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(snapshot, expect.objectContaining({ id: rfq.id }));
    expect(persistedRFQ.inquiries).toHaveLength(1);
    expect(storeService.rfqs[0].inquiries).toEqual([]);
    expect(storeService.aiFeed).toEqual([]);
    expect(storeService.auditLogs).toEqual([]);
    expect(notifySpy).not.toHaveBeenCalled();

    releaseUpdate();
    const result = await inquiryPromise;
    expect(result.inquiry.messages).toHaveLength(1);
    expect(result.inquiryMessageId).toBe(result.inquiry.messages[0].id);
    expect(storeService.rfqs[0].inquiries).toHaveLength(1);
    expect(storeService.aiFeed).toHaveLength(1);
    expect(storeService.auditLogs).toHaveLength(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  test('commits the acknowledgement outbox intent with the inquiry on the durable path', async () => {
    const rfq = makeRFQ();
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue({
      id: rfq.id,
      rfq,
      raw: JSON.stringify(rfq),
    });
    const atomicWrite = jest.spyOn(rfqInquiryQueries, 'updateRFQAndEnqueueInquiryEmailInDB').mockImplementation(
      async (_snapshot, candidate, event) => ({
        rfq: candidate,
        outboxEvent: { id: event.id, status: 'pending' },
      })
    );
    const regularWrite = jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB');

    const result = await storeService.addInquiryToRFQ(rfq.id, {
      message: 'Please confirm the drawing revision.',
      vendorId: 'vendor-1',
      vendorName: 'Vendor One',
      vendorEmail: 'vendor@example.com',
      messageId: '<vendor-inquiry-outbox@example.com>',
      queueAcknowledgement: true,
    });

    expect(atomicWrite).toHaveBeenCalledWith(
      expect.objectContaining({ id: rfq.id }),
      expect.objectContaining({ inquiries: expect.any(Array) }),
      expect.objectContaining({
        eventType: 'rfq_vendor_inquiry_ack_email',
        payload: expect.objectContaining({ rfqId: rfq.id, inquiryId: result.inquiry.id }),
      })
    );
    expect(result.acknowledgementOutboxEvent).toEqual({
      id: expect.stringMatching(/^retry:rfq_vendor_inquiry_ack_email:/),
      status: 'pending',
    });
    expect(result.inquiryMessageId).toBe(result.inquiry.messages[0].id);
    expect(regularWrite).not.toHaveBeenCalled();
    expect(storeService.rfqs[0].inquiries).toHaveLength(1);
  });

  test('keeps inquiry submission available without storage and reports the non-durable acknowledgement fallback', async () => {
    const rfq = makeRFQ();
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

    const result = await storeService.addInquiryToRFQ(rfq.id, {
      message: 'Please confirm the drawing revision.',
      vendorName: 'Vendor One',
      vendorEmail: 'vendor@example.com',
      queueAcknowledgement: true,
    });

    expect(result.acknowledgementOutboxEvent).toBeNull();
    expect(result.acknowledgementAtomicUnsupported).toBe(true);
    expect(storeService.rfqs[0].inquiries).toHaveLength(1);
  });

  test('uses the regular RFQ CAS writer when the configured D1 HTTP adapter cannot batch atomically', async () => {
    const rfq = makeRFQ();
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue({
      id: rfq.id,
      rfq,
      raw: JSON.stringify(rfq),
    });
    jest.spyOn(rfqInquiryQueries, 'updateRFQAndEnqueueInquiryEmailInDB').mockResolvedValue({ atomicUnsupported: true });
    const regularWrite = jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(
      async (_snapshot, candidate) => candidate
    );
    const result = {};

    const updated = await storeService.updateRFQDurably(
      rfq.id,
      { title: 'Updated title' },
      {
        outboxEvent: {
          id: 'retry:rfq_vendor_inquiry_ack_email:test',
          eventType: 'rfq_vendor_inquiry_ack_email',
          payload: { rfqId: rfq.id, inquiryId: 'inquiry-1', messageId: 'message-1' },
        },
        outboxResult: result,
      }
    );

    expect(updated.title).toBe('Updated title');
    expect(result.atomicUnsupported).toBe(true);
    expect(regularWrite).toHaveBeenCalledTimes(1);
  });

  test('leaves a buyer reply unapplied and logs a retryable failure when RFQ persistence fails', async () => {
    const initialInquiry = {
      id: 'inquiry-1',
      vendorName: 'Vendor One',
      vendorEmail: 'vendor@example.com',
      message: 'Please share the drawing revision.',
      createdAt: '2026-11-04T00:00:00.000Z',
      status: 'open',
      messages: [{ id: 'message-1', senderRole: 'vendor', message: 'Please share the drawing revision.' }],
    };
    const rfq = makeRFQ([initialInquiry]);
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockResolvedValue({
      id: rfq.id,
      rfq,
      raw: JSON.stringify(rfq),
    });
    jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockRejectedValue(new Error('database unavailable'));
    const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(storeService.replyToRFQInquiry(rfq.id, initialInquiry.id, {
      reply: 'The drawing is attached.',
      repliedBy: 'Buyer One',
      repliedByEmail: 'buyer@example.com',
    })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

    expect(storeService.rfqs[0].inquiries[0]).toEqual(initialInquiry);
    expect(storeService.aiFeed).toEqual([]);
    expect(storeService.auditLogs).toEqual([]);
    expect(loggerSpy).toHaveBeenCalledWith('Failed to persist RFQ mutation', expect.objectContaining({
      error: expect.any(Error),
      rfqId: rfq.id,
      operation: 'update-rfq-compare-and-swap',
    }), 'STORE_SERVICE');
  });
});
