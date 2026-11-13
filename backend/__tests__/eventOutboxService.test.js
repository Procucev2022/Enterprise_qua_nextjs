const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const enterpriseInquiryQueries = require('../src/db/enterpriseInquiryQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const botBridgeQueries = require('../src/db/botBridgeQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const dailyRfqReportService = require('../src/services/dailyRfqReportService');
const mailerService = require('../src/services/mailerService');
const cryptoService = require('../src/services/cryptoService');
const { DAILY_RFQ_REPORT_CONFIG, EVENT_OUTBOX_TYPES } = require('../src/config/constants');
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

  test('dispatches WhatsApp credential email intents through the shared retry queue', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'whatsapp-outbox-test-key';
    const encryptedTempPassword = cryptoService.encrypt('Temp#123', {
      additionalData: 'whatsapp-registration-credentials:bot-buyer-1',
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-whatsapp-buyer',
      event_type: EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL,
      raw: { accountId: 'bot-buyer-1', role: 'buyer', encryptedTempPassword },
      attempts: 1,
      lease_token: 'lease-whatsapp-buyer',
    }]);
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue({
      id: 'bot-buyer-1', email: 'buyer@example.test', name: 'Buyer', role: 'buyer', mobile: '+919876543210',
      isActive: true, resetPasswordRequired: true, verificationStatus: 'EMAIL_VERIFIED',
    });
    const send = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ sent: true });
    const complete = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ claimed: 1, completed: 1 });
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ tempPassword: 'Temp#123' }));
      expect(complete).toHaveBeenCalledWith('retry-whatsapp-buyer', 'lease-whatsapp-buyer');
    } finally {
      if (originalEncryptionKey === undefined) delete process.env.AES_ENCRYPTION_KEY;
      else process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('dead-letters an invalid vendor WhatsApp credential event and records failed delivery status', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-whatsapp-invalid-vendor',
      event_type: EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL,
      raw: { accountId: 'missing-account', role: 'vendor', vendorId: 'vendor-1', encryptedTempPassword: 'cipher' },
      attempts: 1,
      lease_token: 'lease-whatsapp-invalid-vendor',
    }]);
    jest.spyOn(botBridgeQueries, 'findUserByUuid').mockResolvedValue(null);
    const storeService = require('../src/services/storeService');
    const update = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: 'vendor-1' });
    const reschedule = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(update).toHaveBeenCalledWith('vendor-1', { onboardingEmailStatus: 'failed' });
    expect(reschedule).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
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

  test('dead-letters an encrypted vendor onboarding credential that decrypts to an empty password', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'f'.repeat(64);
    const vendorId = 'vendor-onboarding-empty-password';
    const encryptedTempPassword = cryptoService.encrypt('', {
      additionalData: `vendor-onboarding-email:${vendorId}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-empty-password-event',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedTempPassword },
      attempts: 1,
      lease_token: 'lease-vendor-onboarding-empty-password',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: vendorId,
      email: 'empty-password@example.test',
      onboardingEmailStatus: 'pending',
    });
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendorId });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
      expect(sendSpy).not.toHaveBeenCalled();
      expect(statusSpy).toHaveBeenCalledWith(vendorId, { onboardingEmailStatus: 'failed' });
      expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('dispatches a persisted historical vendor email without changing its custom template', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = '9'.repeat(64);
    const vendorId = 'vendor-historical-outbox-success';
    const emailPayload = {
      to: 'historical-outbox@example.test',
      subject: 'Buyer mapped category invitation',
      html: '<p>Custom mapping and temporary credential content</p>',
    };
    const encryptedEmailPayload = cryptoService.encrypt(JSON.stringify(emailPayload), {
      additionalData: `vendor-historical-onboarding-email:${vendorId}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'historical-vendor-email-event',
      event_type: EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedEmailPayload },
      attempts: 1,
      lease_token: 'lease-historical-vendor-email',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: vendorId,
      name: 'Historical Outbox Vendor',
      email: emailPayload.to,
      onboardingEmailStatus: 'failed',
    });
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendorId });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      expect(sendSpy).toHaveBeenCalledWith(emailPayload, 'onboarding');
      expect(statusSpy).toHaveBeenCalledWith(vendorId, { onboardingEmailStatus: 'sent' });
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test.each([
    ['invalid ciphertext', 'not-a-token', 'historical-invalid-cipher@example.test'],
    ['recipient mismatch', null, 'historical-other-recipient@example.test'],
  ])('dead-letters historical vendor email with %s', async (_scenario, ciphertext, persistedEmail) => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = '8'.repeat(64);
    const vendorId = `vendor-historical-invalid-${_scenario.replaceAll(' ', '-')}`;
    const payload = {
      to: 'historical-target@example.test',
      subject: 'Historical invitation',
      html: '<p>Template content</p>',
    };
    const encryptedEmailPayload = ciphertext || cryptoService.encrypt(JSON.stringify(payload), {
      additionalData: `vendor-historical-onboarding-email:${vendorId}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: `historical-vendor-invalid-${_scenario}`,
      event_type: EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedEmailPayload },
      attempts: 1,
      lease_token: 'lease-historical-vendor-invalid',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: vendorId,
      email: persistedEmail,
      onboardingEmailStatus: 'pending',
    });
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: vendorId });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
      expect(sendSpy).not.toHaveBeenCalled();
      expect(statusSpy).toHaveBeenCalledWith(vendorId, { onboardingEmailStatus: 'failed' });
      expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('skips dispatch when no backing store is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await expect(eventOutboxService.dispatchDueEventOutboxJobs()).resolves.toEqual({
      claimed: 0, completed: 0, retried: 0, dead: 0,
    });
  });

  test('scheduled dispatch releases ready buyer quote notifications before claiming events', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const release = jest.spyOn(eventOutboxQueries, 'releaseReadyOnboardingQuoteNotificationsInDB')
      .mockResolvedValue([{ id: 'ready-quote-1' }]);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);

    await expect(eventOutboxService.dispatchScheduledEventOutboxJobs()).resolves.toMatchObject({
      claimed: 0,
      completed: 0,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('scheduled dispatch continues to due events when onboarding release scan fails', async () => {
    const failure = new Error('quote event release unavailable');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'releaseReadyOnboardingQuoteNotificationsInDB').mockRejectedValue(failure);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(eventOutboxService.dispatchScheduledEventOutboxJobs()).resolves.toMatchObject({ claimed: 0 });
    expect(errorSpy).toHaveBeenCalledWith(
      'Could not release completed-buyer quote notifications from deferred state',
      expect.objectContaining({ error: failure }),
      'EVENT_OUTBOX'
    );
  });

  test('dispatches a single notification retry', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const claim = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'retry-notification', event_type: EVENT_OUTBOX_TYPES.NOTIFICATION,
      raw: { id: 'notification-1' }, attempts: 1, lease_token: 'lease-2',
    }]);
    jest.spyOn(domainQueries, 'insertNotificationInDB').mockResolvedValue({ id: 'notification-1' });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1, ['retry-notification'])).resolves.toMatchObject({
      completed: 1,
      completedIds: ['retry-notification'],
    });
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ ids: ['retry-notification'] }));
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

  test('dispatches a rating revision for a never-rated vendor whose previous rating and score are null', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const revision = {
      id: 'rev-rating-first',
      vendorName: 'First Rated Vendor',
      buyerCompany: 'Buyer Co',
      buyerName: 'Buyer Contact',
      previousRating: null,
      newRating: 3.5,
      previousScore: null,
      newCompositeScore: 70,
      remarks: '',
      qualityScore: 70,
      costScore: 70,
      deliveryScore: 70,
    };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-rating-email-null',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_RATING_REVISION_EMAIL,
      raw: { vendorId: 'vendor-rating-null', revisionId: revision.id, recipientEmail: 'first@vendor.test' },
      attempts: 1,
      lease_token: 'lease-rating-null',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: 'vendor-rating-null',
      name: 'First Rated Vendor',
      contactPerson: 'First Contact',
      ratingRevisionHistory: [revision],
    });
    const buildSpy = jest.spyOn(mailerService, 'buildRatingRevisionEmail').mockReturnValue({ subject: 'Rating update' });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1, dead: 0 });
    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({
      previousRating: null,
      newRating: 3.5,
      previousScore: null,
      newScore: 70,
    }));
    expect(sendSpy).toHaveBeenCalledWith({ subject: 'Rating update' }, 'rating-revision');
  });

  test('dispatches encrypted vendor onboarding credentials and saves sent status', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'b'.repeat(64);
    const vendor = {
      id: 'vendor-onboarding-dispatch-1',
      name: 'Dispatch Vendor Co',
      contactPerson: 'Mira',
      email: 'dispatch-vendor@example.test',
      phone: '+919000000001',
      onboardingEmailStatus: 'pending',
    };
    const encryptedTempPassword = cryptoService.encrypt('Temporary123!', {
      additionalData: `vendor-onboarding-email:${vendor.id}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-email-1',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId: vendor.id, encryptedTempPassword },
      attempts: 1,
      lease_token: 'lease-vendor-onboarding-1',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    const buildSpy = jest.spyOn(mailerService, 'buildVendorOnboardingEmail').mockReturnValue({ html: 'credential email' });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ ...vendor, onboardingEmailStatus: 'sent' });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith(vendor.id, { fresh: true });
      expect(buildSpy).toHaveBeenCalledWith({
        to: vendor.email,
        recipientName: vendor.contactPerson,
        buyerOrganizationName: 'Procucev Enterprise',
        vendorCode: vendor.id,
        tempPassword: 'Temporary123!',
        contactPhone: vendor.phone,
      });
      expect(sendSpy).toHaveBeenCalledWith({ html: 'credential email' }, 'onboarding');
      expect(statusSpy).toHaveBeenCalledWith(vendor.id, { onboardingEmailStatus: 'sent' });
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('does not resend a vendor onboarding email after its sent status was persisted', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'c'.repeat(64);
    const vendorId = 'vendor-onboarding-already-sent';
    const encryptedTempPassword = cryptoService.encrypt('Temporary123!', {
      additionalData: `vendor-onboarding-email:${vendorId}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-email-sent',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedTempPassword },
      attempts: 2,
      lease_token: 'lease-vendor-onboarding-sent',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: vendorId,
      onboardingEmailStatus: 'sent',
    });
    const buildSpy = jest.spyOn(mailerService, 'buildVendorOnboardingEmail');
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably');
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      expect(buildSpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test.each([
    ['missing vendor identifier', { encryptedTempPassword: 'enc:v1:opaque' }, null],
    ['missing encrypted credential', { vendorId: 'vendor-bad-payload' }, null],
    ['missing persisted vendor', { vendorId: 'vendor-missing', encryptedTempPassword: 'enc:v1:opaque' }, null],
    ['vendor no longer pending', { vendorId: 'vendor-not-pending', encryptedTempPassword: 'enc:v1:opaque' }, { id: 'vendor-not-pending', onboardingEmailStatus: 'failed' }],
    ['invalid persisted email', { vendorId: 'vendor-invalid-email', encryptedTempPassword: 'enc:v1:opaque' }, { id: 'vendor-invalid-email', email: 'not-an-email', onboardingEmailStatus: 'pending' }],
    ['invalid encrypted credential', { vendorId: 'vendor-bad-ciphertext', encryptedTempPassword: 'not-a-token' }, { id: 'vendor-bad-ciphertext', email: 'ciphertext@example.test', onboardingEmailStatus: 'pending' }],
  ])('dead-letters %s vendor onboarding events', async (_scenario, raw, vendor) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-invalid-event',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-vendor-onboarding-invalid',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue({ id: raw.vendorId });
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
    if (raw.vendorId) {
      expect(statusSpy).toHaveBeenCalledWith(raw.vendorId, { onboardingEmailStatus: 'failed' });
    } else {
      expect(statusSpy).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['provider rejection', { sent: false }],
    ['provider exception', new Error('provider response must not leak credentials')],
  ])('reschedules vendor onboarding after %s', async (_scenario, delivery) => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'd'.repeat(64);
    const vendorId = `vendor-onboarding-retry-${_scenario.replaceAll(' ', '-')}`;
    const encryptedTempPassword = cryptoService.encrypt('Temporary123!', {
      additionalData: `vendor-onboarding-email:${vendorId}`,
    }).encoded;
    const vendor = {
      id: vendorId,
      name: 'Retry Vendor Co',
      email: 'retry-vendor@example.test',
      onboardingEmailStatus: 'pending',
    };
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-email-retry',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedTempPassword },
      attempts: 1,
      lease_token: 'lease-vendor-onboarding-retry',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(vendor);
    jest.spyOn(mailerService, 'buildVendorOnboardingEmail').mockReturnValue({ html: 'credential email' });
    const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail');
    if (delivery instanceof Error) sendSpy.mockRejectedValue(delivery);
    else sendSpy.mockResolvedValue(delivery);
    const storeService = require('../src/services/storeService');
    const statusSpy = jest.spyOn(storeService, 'updateVendorDurably');
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    const errorSpy = jest.spyOn(logger, 'error');

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
      expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
      expect(statusSpy).not.toHaveBeenCalled();
      const errorCall = errorSpy.mock.calls.find(([message]) => message === 'Background event delivery failed and was rescheduled');
      expect(JSON.stringify(errorCall)).not.toContain('provider response must not leak credentials');
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('retries a vendor onboarding event when delivery succeeds but status persistence fails', async () => {
    const originalEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    process.env.AES_ENCRYPTION_KEY = 'e'.repeat(64);
    const vendorId = 'vendor-onboarding-status-write-failure';
    const encryptedTempPassword = cryptoService.encrypt('Temporary123!', {
      additionalData: `vendor-onboarding-email:${vendorId}`,
    }).encoded;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'vendor-onboarding-email-status-failure',
      event_type: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
      raw: { vendorId, encryptedTempPassword },
      attempts: 1,
      lease_token: 'lease-vendor-onboarding-status-failure',
    }]);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
      id: vendorId,
      email: 'status-failure@example.test',
      onboardingEmailStatus: 'pending',
    });
    jest.spyOn(mailerService, 'buildVendorOnboardingEmail').mockReturnValue({ html: 'credential email' });
    jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
    const storeService = require('../src/services/storeService');
    jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue(null);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    try {
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
      expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    } finally {
      process.env.AES_ENCRYPTION_KEY = originalEncryptionKey;
    }
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

  test('dispatches durable dossier email from the communication row and saves delivery state', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:comm-buyer-email',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'comm-buyer-email' },
      attempts: 1,
      lease_token: 'lease-buyer-email',
    }]);
    const communication = {
      id: 'comm-buyer-email',
      accountId: 'buyer-1',
      accountType: 'buyer',
      channel: 'email',
      recipient: 'buyer@example.test',
      subject: 'Profile update',
      message: '',
      notes: 'The profile was updated.',
      metadata: {
        deliveryEmailSubject: '[Procucev] Profile update',
        deliveryReplyTo: 'staff@example.test',
      },
      deliveryStatus: 'Pending',
    };
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(communication);
    const deliverySpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
    const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({
      ...communication,
      deliveryStatus: 'Delivered',
    });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(deliverySpy).toHaveBeenCalledWith({
      to: communication.recipient,
      subject: '[Procucev] Profile update',
      text: 'The profile was updated.',
      replyTo: 'staff@example.test',
    }, 'COMMUNICATION_DELIVERY');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      communicationId: communication.id,
      deliveryStatus: 'Delivered',
    }));
  });

  test('dispatches durable dossier SMS and saves delivery state', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:comm-vendor-sms',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'comm-vendor-sms' },
      attempts: 1,
      lease_token: 'lease-vendor-sms',
    }]);
    const communication = {
      id: 'comm-vendor-sms',
      accountId: 'vendor-1',
      accountType: 'vendor',
      channel: 'SMS',
      recipient: '9157154504',
      subject: 'Supplier update',
      message: 'Please review the updated profile.',
      metadata: { deliveryRecipientName: 'Supplier One', deliveryEntityType: 'supplier_dossier' },
      deliveryStatus: 'Pending',
    };
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(communication);
    const smsService = require('../src/services/smsService');
    const deliverySpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue({ success: true });
    jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({
      ...communication,
      deliveryStatus: 'Delivered',
    });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(deliverySpy).toHaveBeenCalledWith({
      mobile: communication.recipient,
      recipientName: 'Supplier One',
      message: communication.message,
      linkUrl: '',
      entityType: 'supplier_dossier',
    });
  });

  test('dispatches RFQ creation acknowledgements from the persisted RFQ after restarts', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const rfq = {
      id: 'rfq-created-ack-1',
      rfqNumber: 'RFQ-ACK-1',
      title: 'Hydraulic pump',
      category: 'Pumps',
      buyerEmail: 'buyer@example.test',
      buyerAccountName: 'Buyer Co',
      creationAcknowledgementRequested: true,
      extractedEntities: [
        { itemName: 'Pump', technicalSpecs: 'SS316', quantity: 3, unit: 'Each' },
        { name: 'Valve', specifications: 'DIN', qty: 2, uom: 'Piece' },
        { item_name: 'Seal', specs: 'NBR', quantity: null, qty: 4, unit: 'Set' },
        { description: 'Housing', quantity: null },
        { item_spec: 'Replacement part' },
        {},
      ],
      deliveryLocation: 'Mumbai',
      targetDeliveryDate: '2026-12-01',
      deadline: '2026-11-20',
      assignedVendors: [{ id: 'vendor-1' }],
      procucevVendorCount: 4,
    };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-created-email:rfq-created-ack-1',
      event_type: EVENT_OUTBOX_TYPES.RFQ_CREATED_EMAIL,
      raw: { rfqId: rfq.id },
      attempts: 1,
      lease_token: 'lease-rfq-ack',
    }]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const sendSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: true });
    jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(domainQueries.getRFQByIdFromDB).toHaveBeenCalledWith(rfq.id);
    expect(sendSpy).toHaveBeenCalledWith({
      to: 'buyer@example.test',
      buyerName: 'Buyer Co',
      rfqNumber: 'RFQ-ACK-1',
      rfqTitle: 'Hydraulic pump',
      category: 'Pumps',
      itemCount: 6,
      deliveryLocation: 'Mumbai',
      deliveryDate: '2026-12-01',
      requiredBy: '2026-12-01',
      quoteDeadline: '2026-11-20',
      deadline: '2026-11-20',
      suppliersInvited: 1,
      items: [
        { item_name: 'Pump', item_spec: 'SS316', qty: 3, uom: 'Each' },
        { item_name: 'Valve', item_spec: 'DIN', qty: 2, uom: 'Piece' },
        { item_name: 'Seal', item_spec: 'NBR', qty: 4, uom: 'Set' },
        // Stored line items only: no placeholder name, specification, quantity or unit is invented.
        { item_spec: 'Housing' },
        { item_spec: 'Replacement part' },
        {},
      ],
    });
  });

  test('dispatches scheduled daily RFQ reports from a durable outbox event', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const event = {
      id: 'daily-rfq-report:2026-11-04',
      event_type: EVENT_OUTBOX_TYPES.DAILY_RFQ_REPORT_EMAIL,
      raw: {
        reportDate: '2026-11-03',
        timezone: 'Asia/Kolkata',
        recipients: ['reports@example.test'],
      },
      attempts: 1,
      lease_token: 'lease-daily-report',
    };
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([event]);
    jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockResolvedValue({
      success: true,
      reportDate: event.raw.reportDate,
      totalRFQs: 4,
    });
    const complete = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(dailyRfqReportService.sendDailyRfqReport).toHaveBeenCalledWith({
      date: '2026-11-03',
      timezone: 'Asia/Kolkata',
      recipients: ['reports@example.test'],
    });
    expect(complete).toHaveBeenCalledWith(event.id, event.lease_token);
  });

  test('retries scheduled daily RFQ reports that providers do not accept', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'daily-rfq-report:retry',
      event_type: EVENT_OUTBOX_TYPES.DAILY_RFQ_REPORT_EMAIL,
      raw: {
        reportDate: '2026-11-03',
        timezone: 'Asia/Kolkata',
        recipients: ['reports@example.test'],
      },
      attempts: 1,
      lease_token: 'lease-daily-report-retry',
    }]);
    jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport').mockResolvedValue({ success: false });
    const retry = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'daily-rfq-report:retry',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test.each([
    ['invalid report date format', { reportDate: '2026-11-3', timezone: 'Asia/Kolkata', recipients: ['reports@example.test'] }],
    ['invalid calendar date', { reportDate: '2026-02-31', timezone: 'Asia/Kolkata', recipients: ['reports@example.test'] }],
    ['invalid timezone', { reportDate: '2026-11-03', timezone: 'Invalid/Timezone', recipients: ['reports@example.test'] }],
    ['oversized timezone', { reportDate: '2026-11-03', timezone: 'x'.repeat(DAILY_RFQ_REPORT_CONFIG.MAX_TIMEZONE_LENGTH + 1), recipients: ['reports@example.test'] }],
    ['empty recipient list', { reportDate: '2026-11-03', timezone: 'Asia/Kolkata', recipients: [] }],
    ['invalid recipient', { reportDate: '2026-11-03', timezone: 'Asia/Kolkata', recipients: ['invalid recipient'] }],
  ])('dead-letters a scheduled daily RFQ report with %s', async (_scenario, raw) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'daily-rfq-report:invalid',
      event_type: EVENT_OUTBOX_TYPES.DAILY_RFQ_REPORT_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-daily-report-invalid',
    }]);
    const send = jest.spyOn(dailyRfqReportService, 'sendDailyRfqReport');
    const retry = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({
      id: 'daily-rfq-report:invalid',
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test.each([
    [{ rfqId: '' }, null],
    [{ rfqId: 'rfq-ack-missing' }, null],
    [{ rfqId: 'rfq-ack-no-recipient' }, { id: 'rfq-ack-no-recipient', creationAcknowledgementRequested: true }],
  ])('dead-letters malformed or ineligible RFQ acknowledgement events', async (raw, rfq) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-created-email:invalid',
      event_type: EVENT_OUTBOX_TYPES.RFQ_CREATED_EMAIL,
      raw,
      attempts: 1,
      lease_token: 'lease-rfq-ack-invalid',
    }]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(rfq);
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-created-email:invalid',
      status: 'dead',
      lastError: 'INVALID_PERSISTED_RECORD:Error',
    }));
  });

  test('reschedules RFQ acknowledgement emails that providers do not accept', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'rfq-created-email:rfq-ack-retry',
      event_type: EVENT_OUTBOX_TYPES.RFQ_CREATED_EMAIL,
      raw: { rfqId: 'rfq-ack-retry' },
      attempts: 1,
      lease_token: 'lease-rfq-ack-retry',
    }]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
      id: 'rfq-ack-retry',
      buyerEmail: 'buyer@example.test',
      creationAcknowledgementRequested: true,
    });
    jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ sent: false });
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'rfq-created-email:rfq-ack-retry',
      status: 'pending',
      lastError: 'EMAIL_DELIVERY_NOT_ACCEPTED:Error',
    }));
  });

  test('skips already-delivered generic communications and dead-letters ineligible records', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const claimSpy = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:already-delivered',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'already-delivered' },
      attempts: 1,
      lease_token: 'lease-delivered-generic',
    }]);
    const getCommunicationSpy = jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: 'already-delivered', channel: 'email', deliveryStatus: 'Delivered',
    });
    const mailSpy = jest.spyOn(mailerService, 'deliver');
    const completeSpy = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(mailSpy).not.toHaveBeenCalled();

    claimSpy.mockResolvedValueOnce([{
      id: 'communication-delivery:unsupported-channel',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'unsupported-channel' },
      attempts: 1,
      lease_token: 'lease-invalid-generic',
    }]);
    getCommunicationSpy.mockResolvedValueOnce({
      id: 'unsupported-channel', channel: 'whatsapp', deliveryStatus: 'Pending',
    });
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ communicationId: '' }, null],
    [{ communicationId: 'missing' }, null],
    [{ communicationId: 'failed' }, { id: 'failed', channel: 'email', deliveryStatus: 'Failed' }],
  ])('dead-letters malformed or missing generic communication intent: %p', async (raw, communication) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:invalid-record',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw,
      attempts: 1,
      lease_token: 'lease-invalid-record',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(communication);
    const mailSpy = jest.spyOn(mailerService, 'deliver');
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(mailSpy).not.toHaveBeenCalled();
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
  });

  test.each([
    ['email', { sent: false }],
    ['sms', { success: false, error: 'gateway failed' }],
  ])('reschedules communication delivery when the %s provider does not accept the message', async (channel, result) => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: `communication-delivery:provider-${channel}-failure`,
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: `provider-${channel}-failure` },
      attempts: 1,
      lease_token: `lease-provider-${channel}`,
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: `provider-${channel}-failure`,
      accountId: 'account-1',
      accountType: 'buyer',
      channel,
      recipient: channel === 'email' ? 'buyer@example.test' : '9157154504',
      subject: 'Account update',
      message: 'Please review the update.',
      deliveryStatus: 'Pending',
    });
    if (channel === 'email') {
      jest.spyOn(mailerService, 'deliver').mockResolvedValue(result);
    } else {
      const smsService = require('../src/services/smsService');
      jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue(result);
    }
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  test('retries only the undelivered channel for a durable BOTH communication', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const event = {
      id: 'communication-delivery:action-center-both',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'action-center-both' },
      attempts: 1,
      lease_token: 'lease-action-center-first',
    };
    const claimSpy = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB')
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([{ ...event, attempts: 2, lease_token: 'lease-action-center-second' }]);
    const communication = {
      id: 'action-center-both',
      accountId: 'ticket-1',
      accountType: 'ticket',
      channel: 'BOTH',
      recipient: 'buyer@example.test',
      subject: 'Action needed',
      message: 'Please review the ticket.',
      deliveryStatus: 'Pending',
      metadata: {
        deliveryTemplate: 'action_center',
        deliveryRecipientEmail: 'buyer@example.test',
        deliveryRecipientPhone: '9123456780',
        deliveryRecipientName: 'Buyer One',
        deliveryEntityType: 'ticket',
        deliverySenderName: 'Category Manager',
        deliveryLinkUrl: 'https://example.test/ticket/1',
      },
    };
    const getSpy = jest.spyOn(paymentDuesQueries, 'getCommunicationById')
      .mockResolvedValueOnce(communication)
      .mockResolvedValueOnce({
        ...communication,
        metadata: {
          ...communication.metadata,
          deliveryChannels: {
            email: { success: true, messageId: 'email-accepted' },
            sms: { success: false, error: 'gateway unavailable' },
          },
        },
      });
    const emailSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true, messageId: 'email-accepted' });
    const smsService = require('../src/services/smsService');
    const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms')
      .mockResolvedValueOnce({ success: false, error: 'gateway unavailable' })
      .mockResolvedValueOnce({ success: true, messageId: 'sms-accepted' });
    const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue(communication);
    const retrySpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);
    const completeSpy = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: 'buyer@example.test',
      html: expect.stringContaining('TICKET ALERT'),
    }), 'COMMUNICATION_DELIVERY');
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(retrySpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(smsSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(4);
    expect(updateSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      communicationId: 'action-center-both',
      deliveryStatus: 'Delivered',
      metadataPatch: expect.objectContaining({
        deliveryChannels: expect.objectContaining({
          email: expect.objectContaining({ success: true }),
          sms: expect.objectContaining({ success: true }),
        }),
      }),
    }));
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy).toHaveBeenCalledTimes(2);
  });

  test('reschedules generic communication when provider accepted but status persistence failed', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:status-failure',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'status-failure' },
      attempts: 1,
      lease_token: 'lease-status-failure',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: 'status-failure', channel: 'email', recipient: 'buyer@example.test',
      subject: 'Update', message: 'Details', deliveryStatus: 'Pending',
    });
    jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });
    jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue(null);
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
  });

  test('marks exhausted generic communication delivery as failed when dead-lettered', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([{
      id: 'communication-delivery:exhausted',
      event_type: EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY,
      raw: { communicationId: 'exhausted' },
      attempts: 8,
      lease_token: 'lease-exhausted',
    }]);
    jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
      id: 'exhausted', accountId: 'buyer-1', accountType: 'buyer',
      channel: 'sms', recipient: '9157154504', message: 'Update', deliveryStatus: 'Pending',
    });
    const smsService = require('../src/services/smsService');
    jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValue({ success: false });
    const updateSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue({
      id: 'exhausted', deliveryStatus: 'Failed',
    });
    const rescheduleSpy = jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

    await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });
    expect(updateSpy).toHaveBeenCalledWith({
      communicationId: 'exhausted',
      notificationStatus: 'Failed',
      deliveryStatus: 'Failed',
      acknowledgementStatus: 'Failed',
    });
    expect(rescheduleSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'dead' }));
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
