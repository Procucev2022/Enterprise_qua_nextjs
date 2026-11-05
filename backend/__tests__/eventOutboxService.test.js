const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const enterpriseInquiryQueries = require('../src/db/enterpriseInquiryQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const mailerService = require('../src/services/mailerService');
const { EVENT_OUTBOX_TYPES } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');

describe('background event retry outbox', () => {
  afterEach(() => jest.restoreAllMocks());

  test('builds stable opaque ids and bounded retry delays', () => {
    const first = eventOutboxService.buildEventOutboxId(EVENT_OUTBOX_TYPES.AI_FEED, 'feed-1');
    expect(first).toBe(eventOutboxService.buildEventOutboxId(EVENT_OUTBOX_TYPES.AI_FEED, 'feed-1'));
    expect(first).not.toBe(eventOutboxService.buildEventOutboxId(EVENT_OUTBOX_TYPES.NOTIFICATION, 'feed-1'));
    expect(first).toMatch(/^retry:ai_feed:[a-f0-9]{64}$/);
    expect(() => eventOutboxService.buildEventOutboxId('unknown', 'id'))
      .toThrow(expect.objectContaining({ code: 'INVALID_EVENT_OUTBOX_TYPE' }));
    expect(eventOutboxService.getSafeErrorLabel(new Error('sensitive provider message'))).toBe('UNCLASSIFIED:Error');
    expect(eventOutboxService.getSafeErrorLabel(Object.assign(new TypeError('private'), { code: 'DB_DOWN' }))).toBe('DB_DOWN:TypeError');
    expect(eventOutboxService.getSafeErrorLabel({ code: 500, name: 5 })).toBe('UNCLASSIFIED:Error');
    expect(eventOutboxService.getRetryDelayMs(1)).toBe(1000);
    expect(eventOutboxService.getRetryDelayMs(0)).toBe(1000);
    expect(eventOutboxService.getRetryDelayMs(40)).toBe(15 * 60 * 1000);
  });

  test('does not use the outbox after a direct write succeeds', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const write = jest.fn().mockResolvedValue({ id: 'feed-1' });
    const enqueueSpy = jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.AI_FEED,
      idempotencyKey: 'feed-1',
      payload: { id: 'feed-1' },
      operation: 'feed-write',
      write,
    })).resolves.toEqual({ persisted: true });

    expect(write).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test.each([['null', null], ['undefined', undefined]])('queues a configured write that returns %s without a persisted row', async (_label, result) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB').mockResolvedValue({ id: 'retry-empty-write', status: 'pending' });
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.AI_FEED,
      idempotencyKey: `feed-empty-${_label}`,
      payload: { id: `feed-empty-${_label}` },
      operation: 'feed-write',
      write: jest.fn().mockResolvedValue(result),
    })).resolves.toMatchObject({ queued: true });
  });

  test('keeps explicitly unconfigured memory mode without an outbox record', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const write = jest.fn().mockResolvedValue(null);
    const enqueueSpy = jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
      idempotencyKey: 'notification-1',
      payload: { id: 'notification-1' },
      operation: 'notification-write',
      write,
    })).resolves.toEqual({ persisted: null });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  test('logs a rejected write when no durable retry store is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.AI_FEED,
      idempotencyKey: 'feed-unavailable',
      payload: { id: 'feed-unavailable' },
      operation: 'feed-write',
      write: jest.fn().mockRejectedValue(new Error('database connection lost')),
    })).resolves.toEqual({ persisted: null });
    expect(loggerSpy).toHaveBeenCalledWith(
      'Background event persistence failed; durable retry is unavailable',
      expect.objectContaining({ operation: 'feed-write', eventType: EVENT_OUTBOX_TYPES.AI_FEED }),
      'EVENT_OUTBOX'
    );
  });

  test('records failed direct writes and attempts immediate recovery', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB').mockResolvedValue({ id: 'retry-event', status: 'pending' });
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
      idempotencyKey: 'notification-2',
      payload: { id: 'notification-2' },
      operation: 'notification-write',
      write: jest.fn().mockRejectedValue(new Error('database unavailable')),
    })).resolves.toMatchObject({ queued: true });

    expect(eventOutboxQueries.enqueueEventOutboxInDB).toHaveBeenCalledWith(expect.objectContaining({
      eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
      payload: { id: 'notification-2' },
    }));
    expect(eventOutboxQueries.claimDueEventOutboxInDB).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledWith('Background event persistence failed; queuing a retry', expect.any(Object), 'EVENT_OUTBOX');
  });

  test('retries a temporarily unavailable outbox insert before returning a queued event', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB')
      .mockRejectedValueOnce(new Error('temporary database outage'))
      .mockResolvedValueOnce({ id: 'retry-event', status: 'pending' });
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.AI_FEED,
      idempotencyKey: 'feed-retry-1',
      payload: { id: 'feed-retry-1' },
      operation: 'feed-write',
      write: jest.fn().mockRejectedValue(new Error('initial write failure')),
    })).resolves.toMatchObject({ queued: true });
    expect(eventOutboxQueries.enqueueEventOutboxInDB).toHaveBeenCalledTimes(2);
    expect(loggerSpy).toHaveBeenCalledWith('Failed to record a background event for retry', expect.any(Object), 'EVENT_OUTBOX');
  });

  test('retries enqueue responses without persisted state and surfaces the final error', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB').mockResolvedValue(null);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.AI_FEED,
      idempotencyKey: 'feed-no-outbox-row',
      payload: { id: 'feed-no-outbox-row' },
      operation: 'feed-write',
      write: jest.fn().mockRejectedValue(new Error('initial write failure')),
    })).rejects.toThrow('Event-outbox enqueue returned no persisted state.');
    expect(eventOutboxQueries.enqueueEventOutboxInDB).toHaveBeenCalledTimes(3);
    expect(loggerSpy).toHaveBeenCalledTimes(4);
  });

  test('continues after the immediate dispatch attempt fails so scheduled recovery can retry', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB').mockResolvedValue({ id: 'retry-immediate-failure', status: 'pending' });
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockRejectedValue(new Error('claim unavailable'));
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.persistWithOutboxFallback({
      eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
      idempotencyKey: 'notification-immediate-failure',
      payload: { id: 'notification-immediate-failure' },
      operation: 'notification-write',
      write: jest.fn().mockRejectedValue(new Error('initial write failure')),
    })).resolves.toMatchObject({ queued: true });
    expect(loggerSpy).toHaveBeenCalledWith(
      'Immediate event-outbox retry failed; scheduled recovery will retry it', expect.any(Object), 'EVENT_OUTBOX'
    );
  });

  test('dispatches a claimed AI feed retry and completes its lease', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-feed', event_type: EVENT_OUTBOX_TYPES.AI_FEED, raw: { id: 'feed-1' }, attempts: 1, lease_token: 'lease-1',
    }]);
    jest.spyOn(domainQueries, 'upsertAIFeedItemInDB').mockResolvedValue({ id: 'feed-1' });
    const completeSpy = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs()).resolves.toMatchObject({ claimed: 1, completed: 1 });
    expect(domainQueries.upsertAIFeedItemInDB).toHaveBeenCalledWith({ id: 'feed-1' });
    expect(completeSpy).toHaveBeenCalledWith('retry-feed', 'lease-1');
  });

  test.each([
    [EVENT_OUTBOX_TYPES.AI_FEED, 'upsertAIFeedItemInDB'],
    [EVENT_OUTBOX_TYPES.NOTIFICATION, 'insertNotificationInDB'],
  ])('reschedules a %s retry when its domain write returns no row', async (eventType, method) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: `retry-empty-${eventType}`, event_type: eventType,
      raw: { id: `empty-${eventType}` }, attempts: 1,
    }]);
    jest.spyOn(domainQueries, method).mockResolvedValue(null);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: `retry-empty-${eventType}`, status: 'pending', leaseToken: expect.any(String),
    }));
  });

  test('skips dispatch when no backing store is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(eventOutboxService.dispatchDueEventOutboxJobs()).resolves.toEqual({
      claimed: 0, completed: 0, retried: 0, dead: 0,
    });
  });

  test('dispatches a single notification retry', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-notification', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION,
      raw: { id: 'notification-1' }, attempts: 1, lease_token: 'lease-2',
    }]);
    jest.spyOn(domainQueries, 'insertNotificationInDB').mockResolvedValue({ id: 'notification-1' });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(domainQueries.insertNotificationInDB).toHaveBeenCalledWith({ id: 'notification-1' });
  });

  test.each([
    ['team', 'sendEnterpriseInquiryNotificationEmail'],
    ['buyer_confirmation', 'sendEnterpriseInquiryBuyerConfirmationEmail'],
  ])('dispatches a persisted enterprise inquiry %s email using a fresh DB lookup', async (notificationType, sendMethod) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const inquiry = { id: 'ent-inq-queued', email: 'buyer@example.test', notes: 'read from source of truth' };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: `retry-inquiry-${notificationType}`,
      event_type: EVENT_OUTBOX_TYPES.ENTERPRISE_INQUIRY_EMAIL,
      raw: { inquiryId: inquiry.id, notificationType },
      attempts: 1,
      lease_token: 'lease-inquiry',
    }]);
    jest.spyOn(enterpriseInquiryQueries, 'getEnterpriseInquiryById').mockResolvedValue(inquiry);
    const sendSpy = jest.spyOn(mailerService, sendMethod).mockResolvedValue({ sent: true, messageId: 'mail-1' });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(enterpriseInquiryQueries.getEnterpriseInquiryById).toHaveBeenCalledWith(inquiry.id);
    expect(sendSpy).toHaveBeenCalledWith(inquiry);
  });

  test.each([
    [{ inquiryId: '', notificationType: 'team' }, 1, 'dead'],
    [{ inquiryId: 'ent-inq-missing', notificationType: 'team' }, 1, 'dead'],
    [{ inquiryId: 'ent-inq-queued', notificationType: 'team' }, 1, 'pending'],
  ])('records invalid or failed enterprise inquiry email retries', async (raw, attempts, expectedStatus) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-invalid-inquiry-email',
      event_type: EVENT_OUTBOX_TYPES.ENTERPRISE_INQUIRY_EMAIL,
      raw,
      attempts,
      lease_token: 'lease-invalid-inquiry',
    }]);
    jest.spyOn(enterpriseInquiryQueries, 'getEnterpriseInquiryById')
      .mockResolvedValue(raw.inquiryId && raw.inquiryId !== 'ent-inq-missing'
        ? { id: raw.inquiryId, email: 'buyer@example.test' }
        : null);
    jest.spyOn(mailerService, 'sendEnterpriseInquiryNotificationEmail').mockResolvedValue({ sent: false });
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    const result = await eventOutboxService.dispatchDueEventOutboxJobs(1);
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'retry-invalid-inquiry-email',
      status: expectedStatus,
      lastError: expect.any(String),
    }));
    expect(result[expectedStatus === 'dead' ? 'dead' : 'retried']).toBe(1);
  });

  test('dispatches a vendor rating revision email from the persisted revision snapshot', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const revision = {
      id: 'rev-rating-1',
      vendorName: 'Persisted Vendor Name',
      buyerCompany: 'Buyer Co',
      buyerName: 'Buyer Contact',
      previousRating: 4.2,
      newRating: 4.6,
      previousScore: 84,
      newCompositeScore: 92,
      remarks: 'Persisted remarks',
      qualityScore: 94,
      costScore: 91,
      deliveryScore: 90,
    };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-rating-email-1',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_RATING_REVISION_EMAIL,
      raw: { vendorId: 'vendor-rating-1', revisionId: revision.id, recipientEmail: 'rating@vendor.test' },
      attempts: 1,
      lease_token: 'lease-rating-1',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: 'vendor-rating-1',
      name: 'Stale Vendor Name',
      contactPerson: 'Vendor Contact',
      ratingRevisionHistory: [revision],
    });
    const buildSpy = jest.spyOn(mailerService, 'buildRatingRevisionEmail').mockReturnValue({ subject: 'Rating update' });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith('vendor-rating-1', { fresh: true });
    expect(buildSpy).toHaveBeenCalledWith({
      to: 'rating@vendor.test',
      recipientName: 'Vendor Contact',
      vendorName: 'Persisted Vendor Name',
      buyerCompany: 'Buyer Co',
      buyerName: 'Buyer Contact',
      previousRating: 4.2,
      newRating: 4.6,
      previousScore: 84,
      newScore: 92,
      remarks: 'Persisted remarks',
      qualityScore: 94,
      costScore: 91,
      deliveryScore: 90,
    });
    expect(sendSpy).toHaveBeenCalledWith({ subject: 'Rating update' }, 'rating-revision');
  });

  test.each([
    [{ vendorId: '', revisionId: 'rev-1', recipientEmail: 'vendor@test' }, null, { sent: true }, 'dead'],
    [{ vendorId: 'vendor-1', revisionId: 'missing-revision', recipientEmail: 'vendor@test' }, { id: 'vendor-1', ratingRevisionHistory: [] }, { sent: true }, 'dead'],
    [{ vendorId: 'vendor-1', revisionId: 'rev-1', recipientEmail: 'vendor@test' }, { id: 'vendor-1', ratingRevisionHistory: [{ id: 'rev-1' }] }, { sent: true }, 'dead'],
    [{ vendorId: 'vendor-1', revisionId: 'rev-1', recipientEmail: 'vendor@test' }, {
      id: 'vendor-1',
      ratingRevisionHistory: [{
        id: 'rev-1', previousRating: 4, newRating: 4.1, previousScore: 80, newCompositeScore: 82,
        qualityScore: 80, costScore: 82, deliveryScore: 84,
      }],
    }, { sent: false }, 'pending'],
  ])('reschedules or dead-letters an invalid rating email event', async (raw, vendor, delivery, expectedStatus) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-rating-email-invalid',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_RATING_REVISION_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-rating-invalid',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(mailerService, 'buildRatingRevisionEmail').mockReturnValue({ subject: 'Rating update' });
    jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue(delivery);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    const result = await eventOutboxService.dispatchDueEventOutboxJobs(1);
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'vendor-rating-email-invalid',
      status: expectedStatus,
      lastError: expect.any(String),
    }));
    expect(result[expectedStatus === 'dead' ? 'dead' : 'retried']).toBe(1);
  });

  test.each([[], { id: 'malformed-batch-shape' }])('completes empty or non-array notification batches without issuing writes', async (raw) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-empty-batch', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION_BATCH,
      raw, attempts: 1, lease_token: 'lease-empty-batch',
    }]);
    const bulkSpy = jest.spyOn(domainQueries, 'bulkInsertNotificationsInDB');
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(bulkSpy).not.toHaveBeenCalled();
  });

  test('bounds requested claim limits to the worker maximum and minimum', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const claimSpy = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);

    await eventOutboxService.dispatchDueEventOutboxJobs(0);
    await eventOutboxService.dispatchDueEventOutboxJobs(99);

    expect(claimSpy.mock.calls.map(([args]) => args.limit)).toEqual([1, 10]);
  });

  test('chunks notification fan-out retries under the parameter budget', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const notifications = Array.from({ length: 51 }, (_, index) => ({ id: `notification-${index}` }));
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-notification-batch', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION_BATCH,
      raw: notifications, attempts: 1, lease_token: 'lease-3',
    }]);
    const bulkSpy = jest.spyOn(domainQueries, 'bulkInsertNotificationsInDB').mockResolvedValue([]);
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(bulkSpy.mock.calls.map(([batch]) => batch.length)).toEqual([14, 14, 14, 9]);
  });

  test('reschedules transient delivery errors with safe metadata', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-feed-failure', event_type: EVENT_OUTBOX_TYPES.AI_FEED,
      raw: { id: 'feed-failure' }, attempts: 1, lease_token: 'lease-4',
    }]);
    jest.spyOn(domainQueries, 'upsertAIFeedItemInDB').mockRejectedValue(Object.assign(new Error('provider details'), { code: 'DB_TEMPORARY' }));
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'retry-feed-failure', leaseToken: 'lease-4', status: 'pending', lastError: 'DB_TEMPORARY:Error',
    }));
    expect(loggerSpy).toHaveBeenCalledWith('Background event delivery failed and was rescheduled', expect.any(Object), 'EVENT_OUTBOX');
  });

  test('dead-letters invalid event types and warns when a completed lease is lost', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB')
      .mockResolvedValueOnce([{
        id: 'retry-unknown', event_type: 'unknown', raw: {}, attempts: 1, lease_token: 'lease-5',
      }])
      .mockResolvedValueOnce([{
        id: 'retry-lost-lease', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION,
        raw: { id: 'n-1' }, attempts: 1, lease_token: 'lease-6',
      }]);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    jest.spyOn(domainQueries, 'insertNotificationInDB').mockResolvedValue({ id: 'n-1' });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValueOnce(false);
    const loggerSpy = jest.spyOn(logger, 'warn');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'retry-unknown', status: 'dead' }));
    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ claimed: 1, completed: 0 });
    expect(loggerSpy).toHaveBeenCalledWith('Event-outbox lease expired before completion was recorded', expect.any(Object), 'EVENT_OUTBOX');
  });

  test('dead-letters malformed payloads instead of repeatedly reclaiming them', async () => {
    const parseError = Object.assign(new Error('Persisted event-outbox payload contains invalid JSON.'), {
      code: 'INVALID_PERSISTED_RECORD',
    });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-malformed', event_type: EVENT_OUTBOX_TYPES.AI_FEED,
      raw: null, parseError, attempts: 1, lease_token: 'lease-malformed',
    }]);
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'retry-malformed', status: 'dead', lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('dead-letters a transient delivery error after the attempt budget is exhausted', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-exhausted', event_type: EVENT_OUTBOX_TYPES.AI_FEED,
      raw: { id: 'feed-exhausted' }, attempts: 8, lease_token: 'lease-exhausted',
    }]);
    jest.spyOn(domainQueries, 'upsertAIFeedItemInDB').mockRejectedValue(new Error('still unavailable'));
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'retry-exhausted', status: 'dead' }));
  });

  test('logs retry-state write failures without hiding the delivery failure', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-state-failure', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION,
      raw: { id: 'n-2' }, attempts: 2, lease_token: 'lease-7',
    }]);
    jest.spyOn(domainQueries, 'insertNotificationInDB').mockRejectedValue(new Error('notification unavailable'));
    jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockRejectedValue(new Error('outbox unavailable'));
    const loggerSpy = jest.spyOn(logger, 'error');

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(loggerSpy).toHaveBeenCalledWith('Failed to persist event-outbox retry state', expect.any(Object), 'EVENT_OUTBOX');
  });

  test('enqueues a durable event with a stable key and requires configured storage', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(eventOutboxService.enqueueEventOutbox(
      EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      'communication-1',
      { communicationId: 'communication-1' }
    )).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

    pool.hasStorage.mockReturnValue(true);
    const saved = { id: 'retry-payment-email', status: 'pending' };
    const enqueueSpy = jest.spyOn(eventOutboxQueries, 'enqueueEventOutboxInDB').mockResolvedValue(saved);
    await expect(eventOutboxService.enqueueEventOutbox(
      EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      'communication-1',
      { communicationId: 'communication-1' }
    )).resolves.toEqual(saved);
    expect(enqueueSpy).toHaveBeenCalledWith({
      id: eventOutboxService.buildEventOutboxId(EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL, 'communication-1'),
      eventType: EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      payload: { communicationId: 'communication-1' },
    });
  });

  test('dispatches a queued payment-dues email from persisted communication data', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-payment-email',
      event_type: EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      raw: { communicationId: 'communication-1' },
      attempts: 1,
      lease_token: 'lease-payment-email',
    }]);
    const communication = {
      id: 'communication-1', accountId: 'buyer-1', channel: 'email',
      recipient: 'buyer@example.test', subject: 'Low balance',
      message: 'Please replenish credits.', deliveryStatus: 'Pending',
    };
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(communication);
    const deliverySpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true, messageId: 'provider-1' });
    const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({
      ...communication, deliveryStatus: 'Delivered',
    });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(deliverySpy).toHaveBeenCalledWith({
      to: communication.recipient, subject: communication.subject, text: communication.message,
    }, 'PAYMENT_DUES_NOTIFICATION');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      communicationId: communication.id, deliveryStatus: 'Delivered',
    }));
  });

  test('does not resend a delivered payment-dues communication', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-payment-email-complete',
      event_type: EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      raw: { communicationId: 'communication-delivered' },
      attempts: 2,
      lease_token: 'lease-delivered',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: 'communication-delivered', channel: 'email', deliveryStatus: 'Delivered',
    });
    const deliverySpy = jest.spyOn(mailerService, 'deliver');
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(deliverySpy).not.toHaveBeenCalled();
  });

  test.each([
    [{ communicationId: '' }, null],
    [{ communicationId: 'missing' }, null],
    [{ communicationId: 'wrong-channel' }, { id: 'wrong-channel', channel: 'sms', deliveryStatus: 'Pending' }],
    [{ communicationId: 'failed' }, { id: 'failed', channel: 'email', deliveryStatus: 'Failed' }],
  ])('dead-letters malformed or ineligible payment-dues email intent: %p', async (raw, communication) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-payment-email-invalid',
      event_type: EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-invalid-payment-email',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(communication);
    const deliverySpy = jest.spyOn(mailerService, 'deliver');
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(deliverySpy).not.toHaveBeenCalled();
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
  });

  test.each([
    [{ sent: false }, { deliveryStatus: 'Pending' }],
    [{ sent: true }, null],
  ])('retries payment-dues email when provider or status persistence fails', async (delivery, savedStatus) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-payment-email-transient',
      event_type: EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL,
      raw: { communicationId: 'communication-transient' },
      attempts: 1,
      lease_token: 'lease-transient-payment-email',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: 'communication-transient', accountId: 'buyer-1', channel: 'email',
      recipient: 'buyer@example.test', subject: 'Low balance',
      message: 'Please replenish credits.', deliveryStatus: 'Pending',
    });
    jest.spyOn(mailerService, 'deliver').mockResolvedValue(delivery);
    jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue(savedStatus);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  test('purges retained rows only when storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(eventOutboxService.purgeExpiredEventOutboxRows()).resolves.toBe(0);

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const purgeSpy = jest.spyOn(eventOutboxQueries, 'purgeEventOutboxInDB').mockResolvedValue(2);
    const loggerSpy = jest.spyOn(logger, 'info');
    await expect(eventOutboxService.purgeExpiredEventOutboxRows()).resolves.toBe(2);
    expect(purgeSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    expect(loggerSpy).toHaveBeenCalledWith('Expired event-outbox rows purged', expect.any(Object), 'EVENT_OUTBOX');
    purgeSpy.mockResolvedValue(0);
    await expect(eventOutboxService.purgeExpiredEventOutboxRows()).resolves.toBe(0);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
  });
});
