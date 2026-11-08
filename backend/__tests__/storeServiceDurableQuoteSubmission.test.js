const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');

const RFQ_ID = 'rfq-durable-quote-test';
const VENDOR_ID = 'vendor-durable-quote-test';
const rfq = (overrides = {}) => ({
  id: RFQ_ID,
  rfqNumber: 'RFQ-DURABLE-QUOTE-TEST',
  status: 'Open',
  sourcingMode: 'mode_1',
  quotes: [],
  quotesCount: 0,
  assignedVendors: [],
  ...overrides,
});
const vendor = (overrides = {}) => ({
  id: VENDOR_ID,
  email: 'durable-quote@example.com',
  subscriptionPlan: 'connect',
  freeQuotationCredits: 2,
  freeRfqDownloadCredits: 2,
  quotedRfqIds: [],
  unlockedRfqIds: [],
  ...overrides,
});

describe('durable quote submission and credit synchronization', () => {
  beforeEach(() => {
    storeService.rfqs = storeService.rfqs.filter((item) => item.id !== RFQ_ID);
    storeService.vendors = storeService.vendors.filter((item) => item.id !== VENDOR_ID);
  });

  afterEach(() => {
    storeService.rfqs = storeService.rfqs.filter((item) => item.id !== RFQ_ID);
    storeService.vendors = storeService.vendors.filter((item) => item.id !== VENDOR_ID);
    jest.restoreAllMocks();
  });

  test('persists quote data before cache confirmation and notification side effects', async () => {
    const durableRFQ = rfq();
    const savedRFQ = { ...durableRFQ, quotes: [{ vendorId: VENDOR_ID, unitPrice: 300 }], quotesCount: 1, status: 'In Evaluation' };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(durableRFQ);
    jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue(savedRFQ);
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});
    const updateNotifications = jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});

    const result = await storeService.addQuoteToRFQDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 });

    expect(result).toEqual(savedRFQ);
    expect(domainQueries.upsertRFQInDB).toHaveBeenCalledWith(expect.objectContaining({ quotesCount: 1, status: 'In Evaluation' }));
    expect(storeService.rfqs.find((item) => item.id === RFQ_ID)).toEqual(savedRFQ);
    expect(updateNotifications).toHaveBeenCalledWith(savedRFQ, 'Open', { status: 'In Evaluation' });
    expect(sideEffects).toHaveBeenCalledWith(durableRFQ, savedRFQ, expect.objectContaining({ vendorId: VENDOR_ID }), false);
  });

  test('does not replace cached RFQ state when the durable quote write fails', async () => {
    const prior = rfq({ title: 'Previously cached' });
    storeService.rfqs.push(prior);
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'upsertRFQInDB').mockRejectedValue(new Error('database unavailable'));
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    await expect(storeService.addQuoteToRFQDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(storeService.rfqs.find((item) => item.id === RFQ_ID)).toBe(prior);
    expect(sideEffects).not.toHaveBeenCalled();
  });

  test('returns null for a durable RFQ miss and maps fresh-read failures to 503', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('read failed'));
    await expect(storeService.addQuoteToRFQDurably(RFQ_ID, {})).resolves.toBeNull();
    await expect(storeService.addQuoteToRFQDurably(RFQ_ID, {})).rejects.toMatchObject({ statusCode: 503 });
  });

  test('maps an empty durable quote result to a retryable failure', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue(null);
    await expect(storeService.addQuoteToRFQDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 })).rejects.toMatchObject({ statusCode: 503 });
    expect(storeService.rfqs.some((item) => item.id === RFQ_ID)).toBe(false);
  });

  test('uses the existing in-memory quote operation when storage is not configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const inMemory = jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue({ id: RFQ_ID });
    await expect(storeService.addQuoteToRFQDurably(RFQ_ID, {})).resolves.toEqual({ id: RFQ_ID });
    expect(inMemory).toHaveBeenCalledWith(RFQ_ID, {});
  });

  test('uses local credit mode without storage', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const local = jest.spyOn(storeService, 'consumeVendorQuotationCredit').mockReturnValue({ id: VENDOR_ID });
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).resolves.toEqual({ id: VENDOR_ID });
    expect(local).toHaveBeenCalledWith(VENDOR_ID, RFQ_ID);
  });

  test('records configured credits durably before updating the cache', async () => {
    const savedVendor = vendor({ freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [RFQ_ID] });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'recordVendorQuoteCreditInDB').mockResolvedValue({
      vendor: savedVendor,
      creditCharged: 1,
      alreadyQuoted: false,
    });

    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).resolves.toEqual(savedVendor);
    expect(domainQueries.recordVendorQuoteCreditInDB).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: VENDOR_ID,
      rfqId: RFQ_ID,
      idempotencyKey: `rfq-quote:${VENDOR_ID}:${RFQ_ID}`,
    }));
    expect(storeService.vendors.find((item) => item.id === VENDOR_ID)).toEqual(savedVendor);
  });

  test('submits a quote and consumes its credit in one durable operation', async () => {
    const currentRFQ = rfq();
    const currentVendor = vendor({ subscriptionPlan: 'free_trial' });
    const savedRFQ = { ...currentRFQ, status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 300 }], quotesCount: 1 };
    const savedVendor = { ...currentVendor, freeQuotationCredits: 1, freeRfqDownloadCredits: 1, quotedRfqIds: [RFQ_ID] };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: savedVendor,
      creditCharged: 1,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    const result = await storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 });

    expect(result).toEqual(savedRFQ);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: VENDOR_ID,
      rfqId: RFQ_ID,
      expectedVendor: currentVendor,
      expectedRFQ: currentRFQ,
      updatedRFQ: expect.objectContaining({ quotesCount: 1, status: 'In Evaluation' }),
    }));
    expect(storeService.vendors.find((item) => item.id === VENDOR_ID)).toEqual(savedVendor);
    expect(sideEffects).toHaveBeenCalledWith(currentRFQ, savedRFQ, expect.objectContaining({ vendorId: VENDOR_ID }), false);
  });

  test('persists a verified buyer quote email intent atomically and skips direct delivery', async () => {
    const currentRFQ = rfq({ buyerAccountId: 'buyer-quote-notification', buyerEmail: 'buyer@example.test' });
    const currentVendor = vendor({ subscriptionPlan: 'connect' });
    const savedRFQ = { ...currentRFQ, status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 300 }] };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue({
      buyer: { organizationName: 'Buyer Organization' },
      buyerEmail: 'buyer@example.test',
      requiresProfileCompletion: false,
    });
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    const submission = await storeService.submitVendorQuoteDurably(
      RFQ_ID,
      { vendorId: VENDOR_ID, unitPrice: 300 },
      { includeDeliveryState: true }
    );

    expect(submission).toEqual({
      rfq: savedRFQ,
      quoteId: expect.any(String),
      buyerQuoteNotificationQueued: true,
      buyerProfileReminderQueued: false,
      vendorQuoteAcknowledgementQueued: false,
      autoClosureEmailQueued: false,
      autoClosedByQuote: false,
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      rfqId: RFQ_ID,
      quoteId: expect.any(String),
      quoteNotificationEventId: expect.stringContaining('rfq_quote_received_email'),
      quoteNotificationRecipient: 'buyer@example.test',
      quoteNotificationRecipientName: 'Buyer Organization',
      updatedRFQ: expect.objectContaining({
        quotes: [expect.objectContaining({ id: expect.any(String), vendorId: VENDOR_ID })],
      }),
    }));
    expect(sideEffects).toHaveBeenCalledWith(
      currentRFQ,
      savedRFQ,
      expect.objectContaining({ vendorId: VENDOR_ID, id: expect.any(String) }),
      false,
      { skipQuoteEmail: true }
    );
  });

  test('persists and immediately dispatches the vendor quote acknowledgement intent', async () => {
    const currentRFQ = rfq();
    const currentVendor = vendor();
    const savedRFQ = { ...currentRFQ, status: 'In Evaluation', quotes: [{ id: 'quote-vendor-ack', vendorId: VENDOR_ID }] };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue(null);
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    const dispatch = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ claimed: 1, completed: 1 });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});
    const intent = {
      idempotencyKey: 'inbound-message-1#notice-vendor_quote_ack',
      recipientEmail: 'vendor@example.test',
      recipientName: 'Atomic Vendor',
      buyerEmail: 'buyer@example.test',
    };
    const eventId = eventOutboxService.buildEventOutboxId(
      'rfq_vendor_quote_ack_email',
      `${RFQ_ID}:${intent.idempotencyKey}`
    );

    const submission = await storeService.submitVendorQuoteDurably(
      RFQ_ID,
      { id: 'quote-vendor-ack', vendorId: VENDOR_ID, unitPrice: 300 },
      { includeDeliveryState: true, vendorQuoteAcknowledgement: intent }
    );

    expect(submission).toMatchObject({
      rfq: savedRFQ,
      vendorQuoteAcknowledgementQueued: true,
      buyerQuoteNotificationQueued: false,
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      vendorQuoteAcknowledgementEventId: eventId,
      vendorQuoteAcknowledgementRecipient: 'vendor@example.test',
      vendorQuoteAcknowledgementRecipientName: 'Atomic Vendor',
      vendorQuoteAcknowledgementBuyerEmail: 'buyer@example.test',
    }));
    expect(dispatch).toHaveBeenCalledWith(1, [eventId]);
  });

  test('persists a deferred quote email until the buyer completes profile onboarding', async () => {
    const currentRFQ = rfq({ buyerAccountId: 'buyer-pending-quote', buyerEmail: 'pending@example.test' });
    const currentVendor = vendor({ subscriptionPlan: 'connect' });
    const savedRFQ = { ...currentRFQ, status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 300 }] };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue({
      buyerEmail: 'pending@example.test',
      requiresProfileCompletion: true,
    });
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      onboardingRequired: true,
      status: 'PENDING_ONBOARDING',
    });
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    await storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 });

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      quoteNotificationEventId: expect.stringContaining('rfq_quote_received_email'),
      quoteNotificationRecipient: 'pending@example.test',
      quoteNotificationPendingOnboarding: true,
      buyerProfileReminderEventId: expect.stringContaining('buyer_profile_completion_reminder_email'),
      buyerProfileReminderRecipient: 'pending@example.test',
      buyerProfileReminderRecipientName: null,
    }));
    expect(sideEffects).toHaveBeenCalledWith(
      currentRFQ,
      savedRFQ,
      expect.objectContaining({ vendorId: VENDOR_ID }),
      false,
      { skipQuoteEmail: true }
    );
  });

  test('releases a deferred quote immediately if the persisted buyer completed during quote commit', async () => {
    const currentRFQ = rfq({ buyerAccountId: 'buyer-race', buyerEmail: 'pending@example.test' });
    const currentVendor = vendor({ subscriptionPlan: 'connect' });
    const savedRFQ = { ...currentRFQ, status: 'In Evaluation', quotes: [{ vendorId: VENDOR_ID, unitPrice: 300 }] };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue({
      buyerEmail: 'pending@example.test',
      requiresProfileCompletion: true,
    });
    jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue({
      corporateEmail: 'pending@example.test',
      onboardingRequired: false,
      phone: '9876543210',
    });
    const release = jest.spyOn(eventOutboxQueries, 'releasePendingBuyerQuoteNotificationsInDB')
      .mockResolvedValue([{ id: 'racing-quote-event' }]);
    const dispatch = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
      completedIds: ['racing-quote-event'],
    });
    jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    await storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 });

    expect(release).toHaveBeenCalledWith('pending@example.test');
    expect(dispatch).toHaveBeenCalledWith(1, ['racing-quote-event']);
  });

  test('releases and dispatches persisted quote notifications for the completed buyer only', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'releasePendingBuyerQuoteNotificationsInDB')
      .mockResolvedValue([{ id: 'pending-quote-event-1' }]);
    const dispatch = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
      completedIds: ['pending-quote-event-1'],
    });

    await expect(storeService.dispatchPendingQuoteNotifications(' PENDING@EXAMPLE.TEST ')).resolves.toEqual([
      { id: 'pending-quote-event-1' },
    ]);
    expect(eventOutboxQueries.releasePendingBuyerQuoteNotificationsInDB).toHaveBeenCalledWith('pending@example.test');
    expect(dispatch).toHaveBeenCalledWith(1, ['pending-quote-event-1']);
  });

  test('does not claim unrelated events when a buyer has no deferred quote notifications', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'releasePendingBuyerQuoteNotificationsInDB').mockResolvedValue([]);
    const dispatch = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs');

    await expect(storeService.dispatchPendingQuoteNotifications('buyer@example.test')).resolves.toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('leaves released quote notifications retryable when the targeted dispatch does not complete them', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'releasePendingBuyerQuoteNotificationsInDB')
      .mockResolvedValue([{ id: 'pending-quote-event-retry' }]);
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
      claimed: 1,
      retried: 1,
    });

    await expect(storeService.dispatchPendingQuoteNotifications('buyer@example.test')).resolves.toEqual([]);
  });

  test('persists an auto-closure acknowledgement with the closing quote transaction', async () => {
    const currentRFQ = rfq({
      buyerAccountId: 'buyer-auto-close',
      buyerEmail: 'buyer@example.test',
      assignedVendors: [{ id: VENDOR_ID, email: 'durable-quote@example.com', name: 'Atomic Vendor' }],
    });
    const currentVendor = vendor({ subscriptionPlan: 'connect' });
    const savedRFQ = {
      ...currentRFQ,
      status: 'Closed',
      quotes: [{ id: 'quote-auto-close-1', vendorId: VENDOR_ID, unitPrice: 300 }],
    };
    const comparisonIntent = {
      id: 'comparison-rfq-durable-quote-test',
      rfqId: RFQ_ID,
      rfqNumber: currentRFQ.rfqNumber,
      fireAt: '2026-11-06T10:05:00.000Z',
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue({
      buyer: { organizationName: 'Buyer Organization' },
      buyerEmail: 'buyer@example.test',
      requiresProfileCompletion: false,
    });
    jest.spyOn(rfqChaserScheduler, 'buildBuyerComparisonJobIntent').mockReturnValue({
      ...comparisonIntent,
    });
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: savedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    const submission = await storeService.submitVendorQuoteDurably(
      RFQ_ID,
      { id: 'quote-auto-close-1', vendorId: VENDOR_ID, unitPrice: 300 },
      { includeDeliveryState: true }
    );

    expect(submission).toEqual({
      rfq: savedRFQ,
      quoteId: 'quote-auto-close-1',
      buyerQuoteNotificationQueued: false,
      buyerProfileReminderQueued: false,
      vendorQuoteAcknowledgementQueued: false,
      autoClosureEmailQueued: true,
      autoClosedByQuote: true,
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      autoClosureEmailEventId: expect.stringContaining('rfq_auto_closure_ack_email'),
      autoClosureRecipientEmail: 'buyer@example.test',
      autoClosureRecipientName: 'Buyer Organization',
      autoClosureComparisonJobId: 'comparison-rfq-durable-quote-test',
      autoClosureComparisonFireAt: '2026-11-06T10:05:00.000Z',
    }));
    expect(submit).toHaveBeenCalledWith(expect.not.objectContaining({ quoteNotificationEventId: expect.anything() }));
    expect(sideEffects).toHaveBeenCalledWith(
      currentRFQ,
      savedRFQ,
      expect.objectContaining({ id: 'quote-auto-close-1' }),
      true,
      { skipQuoteEmail: true, skipAutoClosureEmail: true, comparisonJob: comparisonIntent }
    );
  });

  test('queues a profile reminder with auto-closure delivery without starting a direct reminder', async () => {
    const currentRFQ = rfq({
      buyerAccountId: 'buyer-pending-auto-close',
      buyerEmail: 'pending@example.test',
    });
    const closedRFQ = {
      ...currentRFQ,
      status: 'Closed',
      quotes: [{ id: 'quote-pending-auto-close', vendorId: VENDOR_ID, unitPrice: 300 }],
    };
    const currentVendor = vendor();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(currentRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(currentVendor);
    jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue(closedRFQ);
    jest.spyOn(storeService, '_buildBuyerQuoteEmailPlan').mockReturnValue({
      buyer: { organizationName: 'Pending Buyer' },
      buyerEmail: 'pending@example.test',
      requiresProfileCompletion: true,
    });
    jest.spyOn(rfqChaserScheduler, 'buildBuyerComparisonJobIntent').mockReturnValue({
      id: 'comparison-pending-auto-close',
      rfqId: RFQ_ID,
      rfqNumber: currentRFQ.rfqNumber,
      fireAt: '2026-11-08T10:05:00.000Z',
    });
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({
      rfq: closedRFQ,
      vendor: currentVendor,
      creditCharged: 0,
    });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    const sideEffects = jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    await storeService.submitVendorQuoteDurably(RFQ_ID, {
      id: 'quote-pending-auto-close',
      vendorId: VENDOR_ID,
      unitPrice: 300,
    });

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      buyerProfileReminderEventId: expect.stringContaining('buyer_profile_completion_reminder_email'),
      buyerProfileReminderRecipient: 'pending@example.test',
      autoClosureEmailEventId: expect.stringContaining('rfq_auto_closure_ack_email'),
    }));
    expect(sideEffects).toHaveBeenCalledWith(
      currentRFQ,
      closedRFQ,
      expect.objectContaining({ id: 'quote-pending-auto-close' }),
      true,
      expect.objectContaining({ skipAutoClosureEmail: true })
    );
  });

  test('does not send a direct auto-closure email when durable delivery owns the acknowledgement', () => {
    const rfq = { id: RFQ_ID, rfqNumber: 'RFQ-AUTO-CLOSE', buyerAccountId: 'buyer-auto-close' };
    jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@example.test');
    jest.spyOn(storeService, '_buildNotification').mockReturnValue({ id: 'notification-auto-close' });
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    const email = jest.spyOn(mailerService, 'sendRfqAutoClosureAcknowledgementEmail');
    const scheduleComparison = jest.spyOn(rfqChaserScheduler, 'scheduleBuyerComparison').mockReturnValue('comparison-auto-close');

    storeService.notifyBuyerOfAutoClosureAndScheduleComparison(
      rfq,
      [{ id: 'quote-auto-close-1' }],
      { skipEmail: true }
    );

    expect(email).not.toHaveBeenCalled();
    expect(scheduleComparison).toHaveBeenCalledWith(rfq);
  });

  test('registers an already committed comparison job without enqueuing it twice', () => {
    const rfq = { id: RFQ_ID, rfqNumber: 'RFQ-AUTO-CLOSE', buyerAccountId: 'buyer-auto-close' };
    const comparisonJob = {
      id: 'comparison-rfq-auto-close',
      rfqId: RFQ_ID,
      rfqNumber: rfq.rfqNumber,
      fireAt: '2026-11-06T10:05:00.000Z',
    };
    jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@example.test');
    jest.spyOn(storeService, '_buildNotification').mockReturnValue({ id: 'notification-auto-close' });
    jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
    const persistSchedule = jest.spyOn(rfqChaserScheduler, 'schedulePersistedBuyerComparison').mockReturnValue(comparisonJob.id);
    const insertSchedule = jest.spyOn(rfqChaserScheduler, 'scheduleBuyerComparison');

    storeService.notifyBuyerOfAutoClosureAndScheduleComparison(
      rfq,
      [{ id: 'quote-auto-close-1' }],
      { skipEmail: true, comparisonJob }
    );

    expect(persistSchedule).toHaveBeenCalledWith(rfq, comparisonJob);
    expect(insertSchedule).not.toHaveBeenCalled();
  });

  test('rebuilds the quote from fresh RFQ state after a concurrent writer wins', async () => {
    const currentRFQ = rfq();
    const newerRFQ = rfq({ quotes: [{ vendorId: 'other-vendor', unitPrice: 200 }], quotesCount: 1 });
    const savedRFQ = { ...newerRFQ, status: 'In Evaluation', quotes: [...newerRFQ.quotes, { vendorId: VENDOR_ID, unitPrice: 300 }], quotesCount: 2 };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValueOnce(currentRFQ).mockResolvedValueOnce(newerRFQ);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB')
      .mockResolvedValueOnce({ conflict: true })
      .mockResolvedValueOnce({ rfq: savedRFQ, vendor: vendor(), creditCharged: 0 });
    jest.spyOn(storeService, '_notifyRFQUpdate').mockImplementation(() => {});
    jest.spyOn(storeService, '_dispatchQuoteSubmissionSideEffects').mockImplementation(() => {});

    const result = await storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID, unitPrice: 300 });

    expect(result.quotes).toHaveLength(2);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].expectedRFQ).toEqual(newerRFQ);
    expect(submit.mock.calls[1][0].updatedRFQ.quotes).toHaveLength(2);
  });

  test('maps fresh-row misses, credit denial, and persistence errors', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValueOnce(null).mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(vendor()).mockResolvedValue(vendor({ freeQuotationCredits: 0, freeRfqDownloadCredits: 0, subscriptionPlan: 'premium' }));
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).resolves.toBeNull();
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({
      statusCode: 403,
      code: 'VENDOR_QUOTE_CREDITS_EXHAUSTED',
    });

    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockRejectedValueOnce(new Error('read failed'));
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({ statusCode: 503 });
  });

  test('does not write a missing quote candidate and maps transactional credit or RFQ denials', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    const candidate = jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue(null);
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB');
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).resolves.toBeNull();
    expect(candidate).toHaveBeenCalledWith(RFQ_ID, expect.objectContaining({
      id: expect.any(String),
      vendorId: VENDOR_ID,
    }), { persist: false, notify: false });
    expect(submit).not.toHaveBeenCalled();

    candidate.mockRestore();
    jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValueOnce({ creditsExhausted: true, freeCreditsRemaining: 0 });
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({
      statusCode: 403,
      code: 'VENDOR_QUOTE_CREDITS_EXHAUSTED',
    });

    jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValueOnce({ notFound: true });
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).resolves.toBeNull();
  });

  test('returns a retryable error when the vendor row is missing or the atomic adapter fails', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(null).mockResolvedValue(vendor());
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({ statusCode: 503 });
    jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockRejectedValueOnce(Object.assign(new Error('batch failed'), { statusCode: 503, code: 'ATOMIC_PERSISTENCE_REQUIRED' }));
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ATOMIC_PERSISTENCE_REQUIRED',
    });
  });

  test('stops after the bounded number of RFQ conflict retries', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    const submit = jest.spyOn(domainQueries, 'submitVendorQuoteInDB').mockResolvedValue({ conflict: true });
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RFQ_QUOTE_WRITE_CONFLICT',
    });
    expect(submit).toHaveBeenCalledTimes(5);
  });

  test('keeps the in-memory compatibility path when no storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const credit = jest.spyOn(storeService, 'consumeVendorQuotationCredit').mockReturnValue(null);
    const addQuote = jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue({ id: RFQ_ID });
    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).resolves.toEqual({ id: RFQ_ID });
    expect(credit).toHaveBeenCalledWith(VENDOR_ID, RFQ_ID);
    expect(addQuote).toHaveBeenCalledWith(RFQ_ID, expect.objectContaining({
      id: expect.any(String),
      vendorId: VENDOR_ID,
    }));
  });

  test('does not consume a credit when the in-memory RFQ is missing', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const credit = jest.spyOn(storeService, 'consumeVendorQuotationCredit').mockReturnValue(null);
    jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValue(null);

    await expect(storeService.submitVendorQuoteDurably(RFQ_ID, { vendorId: VENDOR_ID })).resolves.toBeNull();
    expect(credit).not.toHaveBeenCalled();
  });

  test('maps missing vendor and RFQ rows to retryable persistence errors', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValueOnce(null).mockResolvedValueOnce(vendor());
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValueOnce(rfq()).mockResolvedValueOnce(null);
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 503 });
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 503 });
  });

  test('rejects an exhausted account before recording a credit transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor({ subscriptionPlan: 'premium', freeQuotationCredits: 0 }));
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    const record = jest.spyOn(domainQueries, 'recordVendorQuoteCreditInDB');
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: 'VENDOR_QUOTE_CREDITS_EXHAUSTED',
    });
    expect(record).not.toHaveBeenCalled();
  });

  test('allows an already quoted vendor to resubmit without current free credits', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor({ subscriptionPlan: 'premium', freeQuotationCredits: 0 }));
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq({
      quotes: [{ vendorId: VENDOR_ID, unitPrice: 200 }],
    }));
    jest.spyOn(domainQueries, 'recordVendorQuoteCreditInDB').mockResolvedValue({
      vendor: vendor({ freeQuotationCredits: 0, quotedRfqIds: [RFQ_ID] }),
      alreadyQuoted: true,
      creditCharged: 0,
    });

    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).resolves.toMatchObject({ freeQuotationCredits: 0 });
    expect(domainQueries.recordVendorQuoteCreditInDB).toHaveBeenCalledWith(expect.objectContaining({ isResubmission: true }));
  });

  test('maps configured reads and ledger failures to retryable persistence errors', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockRejectedValueOnce(new Error('read failed'));
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 503 });

    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    jest.spyOn(domainQueries, 'recordVendorQuoteCreditInDB').mockRejectedValueOnce(new Error('write failed'));
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 503 });
  });

  test('maps empty and exhausted transaction outcomes, while permitting a repeated quote', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor());
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq());
    const record = jest.spyOn(domainQueries, 'recordVendorQuoteCreditInDB')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ vendor: vendor(), creditsExhausted: true, freeCreditsRemaining: 0 })
      .mockResolvedValueOnce({ vendor: vendor({ quotedRfqIds: [RFQ_ID] }), alreadyQuoted: true, creditCharged: 0 });

    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 503 });
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(storeService.consumeVendorQuotationCreditDurably(VENDOR_ID, RFQ_ID)).resolves.toMatchObject({ quotedRfqIds: [RFQ_ID] });
    expect(record).toHaveBeenCalledTimes(3);
  });
});
