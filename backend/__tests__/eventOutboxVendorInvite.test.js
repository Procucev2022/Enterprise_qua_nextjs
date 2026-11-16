const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_MAX_BATCH_SIZE, EVENT_OUTBOX_TYPES } = require('../src/config/constants');
const VALID_INVITE_KEY = '1111111111111111111111111111111111111111111111111111111111111111';

describe('durable RFQ vendor invitation delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  function claim(job) {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: `rfq-vendor-invite:${VALID_INVITE_KEY}`,
      event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
      raw: job,
      attempts: 1,
      lease_token: 'lease-rfq-vendor-invite',
    }]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
  }

  const validTarget = {
    key: VALID_INVITE_KEY,
    vendorId: 'vendor-1',
    recipientEmail: 'vendor@example.test',
    recipientName: 'Vendor Contact',
    freeCreditsRemaining: 4,
    isSubscribed: false,
    isBuyerUploaded: true,
    buyerEmail: 'buyer@example.test',
    vendor: { id: 'vendor-1', source: 'buyer_uploaded', isBuyerUploaded: true },
  };

  test('reloads the persisted RFQ and completes an accepted vendor invitation', async () => {
    claim({ rfqId: 'rfq-1', target: validTarget });
    const rfq = { id: 'rfq-1', rfqNumber: 'RFQ-1', title: 'Pump spares' };
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
    });

    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith('rfq-1');
    expect(mailSpy).toHaveBeenCalledWith('vendor@example.test', expect.objectContaining({
      rfq,
      recipientName: 'Vendor Contact',
      buyerEmail: 'buyer@example.test',
      freeCreditsRemaining: 4,
      isSubscribed: false,
      isBuyerUploaded: true,
      vendor: validTarget.vendor,
    }));
    expect(eventOutboxQueries.markEventOutboxCompleteInDB).toHaveBeenCalledWith(
      `rfq-vendor-invite:${VALID_INVITE_KEY}`,
      'lease-rfq-vendor-invite'
    );
  });

  test.each([
    [{ target: validTarget }],
    [{ rfqId: '', target: validTarget }],
    [{ rfqId: 'rfq-1', target: { ...validTarget, key: '' } }],
    [{ rfqId: 'rfq-1', target: { ...validTarget, recipientEmail: ' ' } }],
    [{ rfqId: 'rfq-1', target: { ...validTarget, vendor: null } }],
  ])('dead-letters malformed RFQ invitation intent %p', async (raw) => {
    claim(raw);
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('dead-letters an invitation whose RFQ no longer exists', async () => {
    claim({ rfqId: 'missing-rfq', target: validTarget });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test('retries an RFQ invitation when the provider does not accept it', async () => {
    claim({ rfqId: 'rfq-1', target: validTarget });
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: 'rfq-1', rfqNumber: 'RFQ-1' });
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(eventOutboxQueries.rescheduleEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test('reuses a single RFQ lookup when batching multiple vendor invitations for the same RFQ', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const secondTarget = {
      ...validTarget,
      key: '2222222222222222222222222222222222222222222222222222222222222222',
      vendorId: 'vendor-2',
      recipientEmail: 'vendor2@example.test',
    };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([
      {
        id: `rfq-vendor-invite:${VALID_INVITE_KEY}`,
        event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
        raw: { rfqId: 'rfq-1', target: validTarget },
        attempts: 1,
        lease_token: 'lease-1',
      },
      {
        id: `rfq-vendor-invite:${secondTarget.key}`,
        event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
        raw: { rfqId: 'rfq-1', target: secondTarget },
        attempts: 1,
        lease_token: 'lease-2',
      },
    ]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
    const getRfqSpy = jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      id: 'rfq-1',
      rfqNumber: 'RFQ-1',
      title: 'Pump spares',
    });
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(2)).resolves.toMatchObject({
      claimed: 2,
      completed: 2,
    });
    expect(getRfqSpy).toHaveBeenCalledTimes(1);
    expect(mailSpy).toHaveBeenCalledTimes(2);
  });

  test('chunks explicit eventIds larger than EVENT_OUTBOX_MAX_BATCH_SIZE into bounded claims', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const allIds = Array.from(
      { length: EVENT_OUTBOX_MAX_BATCH_SIZE + 1 },
      (_, idx) => `rfq-vendor-invite:key-${idx}`
    );
    const claimSpy = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB')
      .mockResolvedValueOnce([{
        id: allIds[0],
        event_type: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
        raw: { rfqId: 'rfq-1', target: validTarget },
        attempts: 1,
        lease_token: 'lease-chunk-1',
      }])
      .mockResolvedValueOnce([]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: 'rfq-1', rfqNumber: 'RFQ-1' });
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    const summary = await eventOutboxService.dispatchDueEventOutboxJobs(allIds.length, allIds);

    expect(summary).toMatchObject({
      claimed: 1,
      completed: 1,
      completedIds: [allIds[0]],
    });
    expect(claimSpy).toHaveBeenCalledTimes(2);
    expect(claimSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      limit: EVENT_OUTBOX_MAX_BATCH_SIZE,
      ids: allIds.slice(0, EVENT_OUTBOX_MAX_BATCH_SIZE),
    }));
    expect(claimSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
      limit: 1,
      ids: allIds.slice(EVENT_OUTBOX_MAX_BATCH_SIZE),
    }));
  });
});
