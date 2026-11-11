/**
 * rfqChaserScheduler unit tests
 *
 * All real outbound calls (WhatsApp, SMS, mailer) are mocked so no network
 * traffic is generated.  Jest fake timers let us advance time precisely to
 * verify each channel fires at the right delay.
 *
 * Coverage targets:
 *   • scheduleVendorChaser  — registers 3 timers, fires at correct delays
 *   • scheduleRFQChasers    — fans out across multiple vendors
 *   • clearScheduledChasers — cancels pending timers, handles unknown rfq
 *   • _dispatchWhatsApp     — success / skip-no-phone / error paths
 *   • _dispatchSms          — success / skip-no-phone / error paths
 *   • _dispatchReminderEmail — success / skip-no-email / error paths
 *   • NODE_ENV=test short-circuit on all dispatch helpers
 *   • pendingTimers Map state management
 */

const whatsAppService = require('../src/services/whatsAppService');
const smsService = require('../src/services/smsService');
const mailerService = require('../src/services/mailerService');
const domainQueries = require('../src/db/domainQueries');
const rfqComparisonQueueQueries = require('../src/db/rfqComparisonQueueQueries');
const scheduler = require('../src/services/rfqChaserScheduler');
const { logger } = require('../src/services/loggerService');
const { RFQ_COMPARISON_MEMORY_DEDUPE_LIMIT } = require('../src/config/constants');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RFQ = {
  rfqNumber: 'RFQ-TEST-001',
  title: 'Test RFQ',
  sourcingMode: 'mode_1',
  buyerAccountId: 'ba-001',
};

const VENDOR = {
  id: 'v-001',
  name: 'Apex Supplies',
  email: 'apex@supplier.com',
  phone: '9876543210',
  contactPerson: 'Rajesh Kumar',
};

const VENDOR_NO_PHONE = { id: 'v-002', name: 'No Phone Co', email: 'nophone@co.com' };
const VENDOR_NO_EMAIL = { id: 'v-003', name: 'No Email Co', phone: '9000000001' };

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Use fake timers so setTimeout never actually waits
  jest.useFakeTimers();
  // Clear timer registry between tests
  scheduler.pendingTimers.clear();
  scheduler.pendingComparisonTimers.forEach((handle) => clearTimeout(handle));
  scheduler.pendingComparisonTimers.clear();
  scheduler.completedMemoryComparisonJobs.clear();
  // Reset throttle caches so tests don't interfere with each other
  whatsAppService.clearWhatsAppThrottleCache();
  smsService.clearSmsThrottleCache();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
  // Cancel any timers left in the registry so they don't leak into other suites
  scheduler.pendingTimers.forEach((_, rfqNumber) => scheduler.clearScheduledChasers(rfqNumber));
  scheduler.pendingTimers.clear();
  scheduler.pendingComparisonTimers.forEach((handle) => clearTimeout(handle));
  scheduler.pendingComparisonTimers.clear();
  scheduler.completedMemoryComparisonJobs.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── scheduleVendorChaser ─────────────────────────────────────────────────────

describe('scheduleVendorChaser', () => {
  test('persists Worker chasers without request-scoped timers', async () => {
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;
    const waitUntil = jest.fn();
    const persistSpy = jest.spyOn(domainQueries, 'insertChaserJobInDB').mockResolvedValue(true);
    globalThis.__CF_ENV__ = { DB: {} };
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;

    try {
      scheduler.scheduleVendorChaser(RFQ, VENDOR);

      expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(false);
      expect(persistSpy).toHaveBeenCalledTimes(4);
      expect(waitUntil).toHaveBeenCalledTimes(4);
      await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });

  test('registers exactly 4 timer handles in pendingTimers (SMS, Call, WhatsApp, Email)', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);
  });

  test('fires SMS within 5 min delay and not before', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-1' });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before SMS delay — SMS not yet called
    jest.advanceTimersByTime(4 * 60 * 1000); // 4 min
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();

    // After SMS delay (5 min)
    jest.advanceTimersByTime(60 * 1000 + 100); // push past 5 min
    await Promise.resolve();
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
    }));
    process.env.NODE_ENV = origEnv;
  });

  test('dispatches persisted Node chasers through the durable claim path', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const dueJob = {
      id: 'chaser-RFQ-TEST-001-v-001-sms',
      rfq_number: RFQ.rfqNumber,
      rfq_id: 'rfq-001',
      vendor_id: VENDOR.id,
      vendor_name: VENDOR.name,
      vendor_phone: VENDOR.phone,
      vendor_email: VENDOR.email,
      channel: 'sms',
      attempts: 1,
    };
    jest.spyOn(domainQueries, 'insertChaserJobInDB').mockResolvedValue({ id: dueJob.id });
    const claimSpy = jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue([dueJob]);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(RFQ);
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true });

    try {
      scheduler.scheduleVendorChaser(RFQ, VENDOR);
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(claimSpy).toHaveBeenCalled();
      expect(smsSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('fires Call reminder after 6 hours', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before 6h
    jest.advanceTimersByTime(5 * 60 * 60 * 1000); // 5 hours
    await Promise.resolve();

    // Advance to 6 hours
    jest.advanceTimersByTime(60 * 60 * 1000 + 100); // push past 6h
    await Promise.resolve();

    process.env.NODE_ENV = origEnv;
  });

  test('fires WhatsApp reminder after 12h delay', async () => {
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-1' });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, {});

    // Before 12h
    jest.advanceTimersByTime(11 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(waSpy).not.toHaveBeenCalled();

    // Cross 12h mark
    jest.advanceTimersByTime(60 * 60 * 1000 + 100);
    await Promise.resolve();

    expect(waSpy).toHaveBeenCalledWith(expect.objectContaining({
      phone: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
      rfqTitle: RFQ.title,
      vendorName: VENDOR.name,
    }));
    process.env.NODE_ENV = origEnv;
  });

  test('fires reminder email after 24h delay', async () => {
    const emailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR, { freeCreditsRemaining: 3, isSubscribed: false });

    // 23h 59m — email not yet fired
    jest.advanceTimersByTime(23 * 60 * 60 * 1000 + 59 * 60 * 1000);
    await Promise.resolve();
    expect(emailSpy).not.toHaveBeenCalled();

    // Cross the 24h mark
    jest.advanceTimersByTime(2 * 60 * 1000);
    await Promise.resolve();
    expect(emailSpy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ rfq: RFQ, isReminder: true })
    );
    process.env.NODE_ENV = origEnv;
  });

  test('does nothing when rfq is null', () => {
    expect(() => scheduler.scheduleVendorChaser(null, VENDOR)).not.toThrow();
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when vendor is null', () => {
    expect(() => scheduler.scheduleVendorChaser(RFQ, null)).not.toThrow();
    expect(scheduler.pendingTimers.size).toBe(0);
  });
});

describe('dispatchDueChaserJobs', () => {
  test('loads the full RFQ and sends the due email reminder', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const emailJob = {
      id: 'chaser-RFQ-TEST-001-v-001-email',
      rfq_number: RFQ.rfqNumber,
      vendor_id: VENDOR.id,
      vendor_name: VENDOR.name,
      vendor_email: VENDOR.email,
      vendor_phone: VENDOR.phone,
      vendor_contact_person: VENDOR.contactPerson,
      channel: 'email',
    };
    jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue([emailJob]);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(RFQ);
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue();
    const emailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    process.env.NODE_ENV = 'production';

    try {
      await expect(scheduler.dispatchDueChaserJobs()).resolves.toEqual({
        claimed: 1,
        sent: 1,
        failed: 0,
        skipped: 0,
      });
      expect(emailSpy).toHaveBeenCalledWith(
        VENDOR.email,
        expect.objectContaining({ rfq: RFQ, isReminder: true })
      );
      expect(domainQueries.markChaserJobFiredInDB).toHaveBeenCalledWith(emailJob.id);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});

describe('durable buyer comparison notifications', () => {
  test('builds a stable comparison job intent and rejects incomplete RFQ identity', () => {
    expect(scheduler.buildBuyerComparisonJobIntent(null)).toBeNull();
    expect(scheduler.buildBuyerComparisonJobIntent({ id: 'rfq-no-number' })).toBeNull();
    const intent = scheduler.buildBuyerComparisonJobIntent({ id: 'rfq/with spaces', rfqNumber: 'RFQ-INTENT' }, 1000);

    expect(intent).toMatchObject({
      id: 'comparison-rfq_with_spaces',
      rfqId: 'rfq/with spaces',
      rfqNumber: 'RFQ-INTENT',
    });
    expect(new Date(intent.fireAt).getTime()).toBe(Date.now() + 1000);
  });

  test('persists Worker comparisons for Cron without creating an isolate timer', async () => {
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;
    const waitUntil = jest.fn();
    const persistSpy = jest.spyOn(rfqComparisonQueueQueries, 'insertRFQComparisonJobInDB').mockResolvedValue(true);
    globalThis.__CF_ENV__ = { DB: {} };
    globalThis.__CF_WAIT_UNTIL__ = waitUntil;

    try {
      const jobId = scheduler.scheduleBuyerComparison({ ...RFQ, id: 'rfq-compare-1' }, 300000);
      expect(jobId).toBe('comparison-rfq-compare-1');
      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({
        id: jobId,
        rfqId: 'rfq-compare-1',
        rfqNumber: RFQ.rfqNumber,
      }));
      expect(scheduler.pendingComparisonTimers.size).toBe(0);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });

  test('registers an atomically persisted comparison without issuing a duplicate insert', () => {
    const previousEnv = globalThis.__CF_ENV__;
    globalThis.__CF_ENV__ = { DB: {} };
    const insertSpy = jest.spyOn(rfqComparisonQueueQueries, 'insertRFQComparisonJobInDB');
    const intent = {
      id: 'comparison-rfq-atomic',
      rfqId: 'rfq-atomic',
      rfqNumber: 'RFQ-ATOMIC',
      fireAt: new Date(Date.now() + 60000).toISOString(),
    };

    try {
      expect(scheduler.schedulePersistedBuyerComparison({ id: 'rfq-atomic', rfqNumber: 'RFQ-ATOMIC' }, intent))
        .toBe(intent.id);
      expect(scheduler.pendingComparisonTimers.size).toBe(0);
      expect(insertSpy).not.toHaveBeenCalled();
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });

  test('handles missing identifiers, completed duplicate IDs, and Worker persistence without waitUntil', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;
    const persistSpy = jest.spyOn(rfqComparisonQueueQueries, 'insertRFQComparisonJobInDB').mockResolvedValue(true);
    delete globalThis.__CF_WAIT_UNTIL__;
    globalThis.__CF_ENV__ = { DB: {} };

    try {
      expect(scheduler.scheduleBuyerComparison(null)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Skipped RFQ comparison scheduling because RFQ identifiers are incomplete',
        expect.any(Object),
        'RFQ_COMPARISON_QUEUE'
      );
      scheduler.completedMemoryComparisonJobs.add('comparison-rfq-done');
      expect(scheduler.scheduleBuyerComparison({ id: 'rfq-done', rfqNumber: 'RFQ-DONE' })).toBe('comparison-rfq-done');
      expect(scheduler.pendingComparisonTimers.size).toBe(0);

      scheduler.scheduleBuyerComparison({ id: 'rfq-worker-no-context', rfqNumber: 'RFQ-WORKER-NO-CONTEXT' });
      await Promise.resolve();
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(scheduler.pendingComparisonTimers.size).toBe(0);
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });

  test('rejects partial RFQ identifiers and uses the RFQ number as the durable ID fallback', async () => {
    const previousEnv = globalThis.__CF_ENV__;
    const persistSpy = jest.spyOn(rfqComparisonQueueQueries, 'insertRFQComparisonJobInDB').mockResolvedValue(true);
    globalThis.__CF_ENV__ = { DB: {} };

    try {
      expect(scheduler.scheduleBuyerComparison({ id: 'rfq-only-id' })).toBeNull();
      expect(scheduler.scheduleBuyerComparison({ rfqNumber: 'RFQ-ONLY-NUMBER' }, 0))
        .toBe('comparison-RFQ-ONLY-NUMBER');
      await Promise.resolve();
      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({
        id: 'comparison-RFQ-ONLY-NUMBER',
        rfqId: 'RFQ-ONLY-NUMBER',
      }));
      expect(scheduler.pendingComparisonTimers.size).toBe(0);
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });

  test('dispatches a persisted Node job through the queue claim path', async () => {
    const previousEnv = globalThis.__CF_ENV__;
    delete globalThis.__CF_ENV__;
    jest.spyOn(rfqComparisonQueueQueries, 'insertRFQComparisonJobInDB').mockResolvedValue({ id: 'persisted-job' });
    const claimSpy = jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([]);
    try {
      scheduler.scheduleBuyerComparison({ id: 'rfq-persisted', rfqNumber: 'RFQ-PERSISTED' }, 0);
      await jest.advanceTimersByTimeAsync(1);
      expect(claimSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1, 'comparison-rfq-persisted');
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });

  test('claims due jobs, reloads the RFQ, dispatches, and marks the job complete', async () => {
    const storeService = require('../src/services/storeService');
    const job = {
      id: 'comparison-rfq-1',
      rfq_id: 'rfq-1',
      rfq_number: 'RFQ-1',
      attempts: 1,
    };
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([job]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: 'rfq-1', rfqNumber: 'RFQ-1' });
    const dispatchSpy = jest.spyOn(storeService, 'dispatchBuyerComparisonNotification').mockResolvedValue({
      emailCompleted: true,
      smsCompleted: true,
    });
    const completeSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobCompleteInDB').mockResolvedValue(undefined);
    const channelSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonChannelCompleteInDB').mockResolvedValue(undefined);

    await expect(scheduler.dispatchDueRFQComparisonJobs()).resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(dispatchSpy).toHaveBeenCalledWith(
      { id: 'rfq-1', rfqNumber: 'RFQ-1' },
      { emailCompleted: false, smsCompleted: false }
    );
    expect(completeSpy).toHaveBeenCalledWith(job.id);
    expect(channelSpy).toHaveBeenCalledWith(job.id, 'email');
    expect(channelSpy).toHaveBeenCalledWith(job.id, 'sms');
  });

  test('dispatches camel-case IDs through RFQ-number lookup and skips completed channels', async () => {
    const storeService = require('../src/services/storeService');
    const job = {
      id: 'comparison-camel-case',
      rfqId: 'rfq-camel',
      rfqNumber: 'RFQ-CAMEL',
      email_completed_at: '2026-11-01T00:00:00.000Z',
      attempts: 2,
    };
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([job]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    const numberLookup = jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue({ id: 'rfq-camel', rfqNumber: 'RFQ-CAMEL' });
    const dispatchSpy = jest.spyOn(storeService, 'dispatchBuyerComparisonNotification').mockResolvedValue({
      emailCompleted: true,
      smsCompleted: true,
    });
    const channelSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonChannelCompleteInDB').mockResolvedValue(undefined);
    const completeSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobCompleteInDB').mockResolvedValue(undefined);

    await expect(scheduler.dispatchDueRFQComparisonJobs(500)).resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(numberLookup).toHaveBeenCalledWith('RFQ-CAMEL');
    expect(dispatchSpy).toHaveBeenCalledWith(
      { id: 'rfq-camel', rfqNumber: 'RFQ-CAMEL' },
      { emailCompleted: true, smsCompleted: false }
    );
    expect(channelSpy).toHaveBeenCalledTimes(2);
    expect(completeSpy).toHaveBeenCalledWith(job.id);
  });

  test('retries only incomplete channels and tolerates an empty due queue', async () => {
    const storeService = require('../src/services/storeService');
    const job = { id: 'comparison-partial', rfq_id: 'rfq-partial', rfq_number: 'RFQ-PARTIAL', attempts: 1 };
    const claimSpy = jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB')
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: job.rfq_id, rfqNumber: job.rfq_number });
    jest.spyOn(storeService, 'dispatchBuyerComparisonNotification').mockResolvedValue({
      emailCompleted: true,
      smsCompleted: false,
    });
    const channelSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonChannelCompleteInDB').mockResolvedValue(undefined);
    const failedSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobFailedInDB').mockResolvedValue(undefined);

    await expect(scheduler.dispatchDueRFQComparisonJobs()).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(channelSpy).toHaveBeenCalledTimes(1);
    expect(channelSpy).toHaveBeenCalledWith(job.id, 'email');
    expect(failedSpy).toHaveBeenCalledWith(job.id, expect.stringContaining('sms'));
    await expect(scheduler.dispatchDueRFQComparisonJobs()).resolves.toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(claimSpy).toHaveBeenCalledTimes(2);
  });

  test('marks a job failed when the RFQ cannot be reloaded', async () => {
    const job = { id: 'comparison-missing-rfq', rfq_number: 'RFQ-MISSING', attempts: 1 };
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([job]);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(null);
    const failedSpy = jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobFailedInDB').mockResolvedValue(undefined);

    await expect(scheduler.dispatchDueRFQComparisonJobs()).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(failedSpy).toHaveBeenCalledWith(job.id, expect.stringContaining('was not found'));
  });

  test('records delivery failures and logs a failed durable state update', async () => {
    const error = new Error('mail delivery unavailable');
    const stateError = new Error('database write unavailable');
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([{
      id: 'comparison-rfq-2',
      rfq_id: 'rfq-2',
      rfq_number: 'RFQ-2',
      attempts: 2,
    }]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: 'rfq-2', rfqNumber: 'RFQ-2' });
    jest.spyOn(require('../src/services/storeService'), 'dispatchBuyerComparisonNotification').mockRejectedValue(error);
    jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobFailedInDB').mockRejectedValue(stateError);
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(scheduler.dispatchDueRFQComparisonJobs()).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(errorSpy).toHaveBeenCalledWith('Durable RFQ comparison notification dispatch failed', expect.objectContaining({ error }), 'RFQ_COMPARISON_QUEUE');
    expect(errorSpy).toHaveBeenCalledWith('Failed to update durable RFQ comparison job after dispatch failure', expect.objectContaining({ error: stateError }), 'RFQ_COMPARISON_QUEUE');
  });

  test('uses the Node timer fallback when no database storage is configured', async () => {
    const storeService = require('../src/services/storeService');
    const dispatchSpy = jest.spyOn(storeService, 'dispatchBuyerComparisonNotification').mockResolvedValue({
      emailCompleted: true,
      smsCompleted: true,
    });
    const rfq = { ...RFQ, id: 'rfq-node-1' };
    for (let index = 0; index < RFQ_COMPARISON_MEMORY_DEDUPE_LIMIT; index++) {
      scheduler.completedMemoryComparisonJobs.add(`completed-${index}`);
    }
    scheduler.scheduleBuyerComparison(rfq, 10);

    await jest.advanceTimersByTimeAsync(10);
    expect(dispatchSpy).toHaveBeenCalledWith(rfq, { emailCompleted: false, smsCompleted: false });
    expect(scheduler.pendingComparisonTimers.size).toBe(0);
    expect(scheduler.completedMemoryComparisonJobs.size).toBe(RFQ_COMPARISON_MEMORY_DEDUPE_LIMIT);
    expect(scheduler.completedMemoryComparisonJobs.has('completed-0')).toBe(false);
    expect(scheduler.completedMemoryComparisonJobs.has('comparison-rfq-node-1')).toBe(true);
    expect(scheduler.scheduleBuyerComparison(rfq, 10)).toBe('comparison-rfq-node-1');
    expect(scheduler.pendingComparisonTimers.size).toBe(0);
  });

  test('keeps the bounded memory dedupe set at capacity when its oldest entry is empty', async () => {
    const dispatchSpy = jest.spyOn(require('../src/services/storeService'), 'dispatchBuyerComparisonNotification')
      .mockResolvedValue({ emailCompleted: true, smsCompleted: true });
    scheduler.completedMemoryComparisonJobs.add('');
    for (let index = 1; index < RFQ_COMPARISON_MEMORY_DEDUPE_LIMIT; index++) {
      scheduler.completedMemoryComparisonJobs.add(`completed-${index}`);
    }
    scheduler.scheduleBuyerComparison({ ...RFQ, id: 'rfq-empty-oldest' }, 10);

    await jest.advanceTimersByTimeAsync(10);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(scheduler.completedMemoryComparisonJobs.size).toBe(RFQ_COMPARISON_MEMORY_DEDUPE_LIMIT);
    expect(scheduler.completedMemoryComparisonJobs.has('')).toBe(false);
  });

  test('recovers persisted Node comparison jobs after boot', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const job = {
      id: 'comparison-recovered-rfq',
      rfq_id: 'rfq-recovered',
      rfq_number: 'RFQ-RECOVERED',
      fire_at: new Date(Date.now() + 25).toISOString(),
    };
    jest.spyOn(rfqComparisonQueueQueries, 'getPendingRFQComparisonJobsFromDB').mockResolvedValue([job]);
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValue([job]);
    jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({ id: job.rfq_id, rfqNumber: job.rfq_number });
    jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonChannelCompleteInDB').mockResolvedValue(undefined);
    jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobCompleteInDB').mockResolvedValue(undefined);
    const dispatchSpy = jest.spyOn(require('../src/services/storeService'), 'dispatchBuyerComparisonNotification')
      .mockResolvedValue({ emailCompleted: true, smsCompleted: true });

    try {
      await scheduler.recoverRFQComparisonJobsOnBoot();
      expect(scheduler.pendingComparisonTimers.has(job.id)).toBe(true);
      await scheduler.recoverRFQComparisonJobsOnBoot();
      expect(scheduler.pendingComparisonTimers.size).toBe(1);
      await jest.advanceTimersByTimeAsync(50);
      expect(dispatchSpy).toHaveBeenCalledWith(
        { id: job.rfq_id, rfqNumber: job.rfq_number },
        { emailCompleted: false, smsCompleted: false }
      );
      expect(scheduler.pendingComparisonTimers.has(job.id)).toBe(false);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('recovers camel-case rows, applies the fallback timer path, and logs database claim errors', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const row = {
      id: 'comparison-camel-recovery',
      rfqId: 'rfq-camel-recovery',
      rfqNumber: 'RFQ-CAMEL-RECOVERY',
      fireAt: new Date(Date.now() + 10).toISOString(),
    };
    jest.spyOn(rfqComparisonQueueQueries, 'getPendingRFQComparisonJobsFromDB').mockResolvedValue([row]);
    jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockRejectedValue(new Error('queue read failed'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    try {
      await scheduler.recoverRFQComparisonJobsOnBoot();
      await jest.advanceTimersByTimeAsync(10);
      expect(errorSpy).toHaveBeenCalledWith('Node RFQ comparison notification timer failed', expect.objectContaining({
        jobId: row.id,
        rfqId: row.rfqId,
        rfqNumber: row.rfqNumber,
      }), 'RFQ_COMPARISON_QUEUE');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('uses default queue limits, resolves jobs without an RFQ ID, and skips Node recovery for an empty queue', async () => {
    const claimSpy = jest.spyOn(rfqComparisonQueueQueries, 'claimDueRFQComparisonJobsFromDB').mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'comparison-number-only', rfq_number: 'RFQ-NUMBER-ONLY' },
    ]);
    const idLookup = jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue({ rfqNumber: 'RFQ-NUMBER-ONLY' });
    const storeService = require('../src/services/storeService');
    jest.spyOn(storeService, 'dispatchBuyerComparisonNotification').mockResolvedValue({
      emailCompleted: true,
      smsCompleted: true,
    });
    jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonChannelCompleteInDB').mockResolvedValue(undefined);
    jest.spyOn(rfqComparisonQueueQueries, 'markRFQComparisonJobCompleteInDB').mockResolvedValue(undefined);

    await expect(scheduler.dispatchDueRFQComparisonJobs(0)).resolves.toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(claimSpy).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(String), 25, null);
    await expect(scheduler.dispatchDueRFQComparisonJobs(5)).resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(idLookup).not.toHaveBeenCalled();
    expect(domainQueries.getRFQByNumberFromDB).toHaveBeenCalledWith('RFQ-NUMBER-ONLY');

    const pendingSpy = jest.spyOn(rfqComparisonQueueQueries, 'getPendingRFQComparisonJobsFromDB').mockResolvedValue([]);
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await scheduler.recoverRFQComparisonJobsOnBoot();
      expect(pendingSpy).toHaveBeenCalledWith(1000);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('does not query recovery jobs in Workers, and logs Node recovery query failures', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const previousEnv = globalThis.__CF_ENV__;
    const lookupSpy = jest.spyOn(rfqComparisonQueueQueries, 'getPendingRFQComparisonJobsFromDB').mockRejectedValue(new Error('database down'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';
    try {
      globalThis.__CF_ENV__ = { DB: {} };
      await scheduler.recoverRFQComparisonJobsOnBoot();
      expect(lookupSpy).not.toHaveBeenCalled();

      delete globalThis.__CF_ENV__;
      await scheduler.recoverRFQComparisonJobsOnBoot();
      expect(lookupSpy).toHaveBeenCalledWith(1000);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to recover Node RFQ comparison notification jobs',
        expect.objectContaining({ error: expect.any(Error) }),
        'RFQ_COMPARISON_QUEUE'
      );
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
    }
  });
});

// ── scheduleRFQChasers ────────────────────────────────────────────────────────

describe('scheduleRFQChasers', () => {
  test('creates 4 timers per vendor (2 vendors → 8 timers)', () => {
    const vendors = [VENDOR, { ...VENDOR, id: 'v-999', name: 'Beta Supplies' }];
    scheduler.scheduleRFQChasers(RFQ, vendors);
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(8);
  });

  test('calls getCreditInfo for each vendor', () => {
    const getCreditInfo = jest.fn().mockReturnValue({ freeCreditsRemaining: 5, isSubscribed: true });
    scheduler.scheduleRFQChasers(RFQ, [VENDOR], getCreditInfo);
    expect(getCreditInfo).toHaveBeenCalledWith(VENDOR);
  });

  test('does nothing for an empty vendor list', () => {
    scheduler.scheduleRFQChasers(RFQ, []);
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when rfq is null', () => {
    scheduler.scheduleRFQChasers(null, [VENDOR]);
    expect(scheduler.pendingTimers.size).toBe(0);
  });

  test('does nothing when vendors is not an array', () => {
    scheduler.scheduleRFQChasers(RFQ, null);
    expect(scheduler.pendingTimers.size).toBe(0);
  });
});

// ── clearScheduledChasers ─────────────────────────────────────────────────────

describe('clearScheduledChasers', () => {
  test('cancels all timers for an rfqNumber and removes from map', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(true);

    scheduler.clearScheduledChasers(RFQ.rfqNumber);
    expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(false);
  });

  test('does not throw for an unknown rfqNumber', () => {
    expect(() => scheduler.clearScheduledChasers('RFQ-DOES-NOT-EXIST')).not.toThrow();
  });

  test('cleared timers do not fire after being cancelled', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true });
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    scheduler.clearScheduledChasers(RFQ.rfqNumber);

    jest.runAllTimers();
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();
    process.env.NODE_ENV = origEnv;
  });
});

// ── _dispatchWhatsApp ─────────────────────────────────────────────────────────

describe('_dispatchWhatsApp', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no phone', async () => {
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR_NO_PHONE);
    expect(result.skipped).toBe(true);
  });

  test('returns success:true on a successful API call', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-ok' });
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(true);
  });

  test('returns success:false when API returns failure', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'bad creds' });
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(false);
  });

  test('catches thrown errors and returns success:false', async () => {
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockRejectedValue(new Error('network down'));
    const result = await scheduler._dispatchWhatsApp(RFQ, VENDOR);
    expect(result.success).toBe(false);
    expect(result.error).toBe('network down');
  });
});

// ── _dispatchSms ──────────────────────────────────────────────────────────────

describe('_dispatchSms', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no phone', async () => {
    const result = await scheduler._dispatchSms(RFQ, VENDOR_NO_PHONE);
    expect(result.skipped).toBe(true);
  });

  test('returns success:true on a successful gateway call', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(true);
  });

  test('logs a chaser state-write failure after a successful delivery', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockRejectedValue(new Error('state update failed'));

    const result = await scheduler._dispatchSms(RFQ, VENDOR, 'job-state-fail');

    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'Best-effort chaser job persistence failed',
      expect.objectContaining({ error: expect.any(Error) }),
      'RFQ_CHASER'
    );
  });

  test('passes rfqNumber and mobile to sendRFQChaserSms', async () => {
    const spy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-ok' });
    await scheduler._dispatchSms(RFQ, VENDOR);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: RFQ.rfqNumber,
    }));
  });

  test('returns success:false when gateway returns failure', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'quota exceeded' });
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(false);
  });

  test('catches thrown errors and returns success:false', async () => {
    jest.spyOn(smsService, 'sendRFQChaserSms').mockRejectedValue(new Error('timeout'));
    const result = await scheduler._dispatchSms(RFQ, VENDOR);
    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout');
  });
});

// ── _dispatchCall ────────────────────────────────────────────────────────────

describe('_dispatchCall', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchCall(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true with reason calling_not_implemented in production', async () => {
    const result = await scheduler._dispatchCall(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('calling_not_implemented');
  });
});

// ── _dispatchReminderEmail ────────────────────────────────────────────────────

describe('_dispatchReminderEmail', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => { process.env.NODE_ENV = 'production'; });
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  test('returns skipped:true in test environment', async () => {
    process.env.NODE_ENV = 'test';
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.skipped).toBe(true);
  });

  test('returns skipped:true when vendor has no email', async () => {
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR_NO_EMAIL);
    expect(result.skipped).toBe(true);
  });

  test('returns sent:true on successful delivery', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR, { freeCreditsRemaining: 2, isSubscribed: false });
    expect(result.sent).toBe(true);
  });

  test('passes isReminder:true to sendRfqInviteEmail', async () => {
    const spy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    await scheduler._dispatchReminderEmail(RFQ, VENDOR, {});
    expect(spy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ isReminder: true, rfq: RFQ })
    );
  });

  test('returns sent:false when mailer returns sent:false', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'SMTP not configured' });
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.sent).toBe(false);
  });

  test('catches thrown errors and returns sent:false', async () => {
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockRejectedValue(new Error('auth failed'));
    const result = await scheduler._dispatchReminderEmail(RFQ, VENDOR);
    expect(result.sent).toBe(false);
    expect(result.error).toBe('auth failed');
  });

  test('uses null defaults for missing creditInfo fields', async () => {
    const spy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    await scheduler._dispatchReminderEmail(RFQ, VENDOR); // no creditInfo
    expect(spy).toHaveBeenCalledWith(
      VENDOR.email,
      expect.objectContaining({ freeCreditsRemaining: null, isSubscribed: false })
    );
  });
});

// ── V0 (Free Starter Trial) Chaser Scheduling ──────────────────────────────
describe('V0 Chaser Scheduling', () => {
  const V0_RFQ = {
    rfqNumber: 'RFQ-V0-001',
    id: 'rfq-v0-001',
    title: 'Precision Bearings Supply',
    sourcingMode: 'mode_0',
  };

  test('registers only 1 timer handle in pendingTimers (SMS only, no Call/WhatsApp/Email follow-ups) for V0', () => {
    scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});
    expect(scheduler.pendingTimers.get(V0_RFQ.rfqNumber)).toHaveLength(1);
  });

  test('fires SMS alert after 5 minutes for V0 and sends no follow-up chasers after 6h/12h/24h', async () => {
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-v0' });
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-v0' });
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});

    // Before 5 min — not yet called
    jest.advanceTimersByTime(4 * 60 * 1000);
    await Promise.resolve();
    expect(smsSpy).not.toHaveBeenCalled();

    // At 5 min — SMS is fired
    jest.advanceTimersByTime(60 * 1000 + 100);
    await Promise.resolve();
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
      mobile: VENDOR.phone,
      rfqNumber: V0_RFQ.rfqNumber,
    }));

    // Advance 6h, 12h, 24h — no follow-up chasers fired for V0
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(waSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();

    process.env.NODE_ENV = origEnv;
  });

  test('D1 persistence records only 1 SMS job for V0 RFQs', async () => {
    const persistSpy = jest.spyOn(domainQueries, 'insertChaserJobInDB').mockResolvedValue(true);
    const waitUntil = jest.fn();
    const previousEnv = globalThis.__CF_ENV__;
    const previousWaitUntil = globalThis.__CF_WAIT_UNTIL__;

    try {
      globalThis.__CF_ENV__ = { DB: {} };
      globalThis.__CF_WAIT_UNTIL__ = waitUntil;

      scheduler.scheduleVendorChaser(V0_RFQ, VENDOR, {});
      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'sms',
        rfqNumber: V0_RFQ.rfqNumber,
      }));
    } finally {
      if (previousEnv === undefined) delete globalThis.__CF_ENV__;
      else globalThis.__CF_ENV__ = previousEnv;
      if (previousWaitUntil === undefined) delete globalThis.__CF_WAIT_UNTIL__;
      else globalThis.__CF_WAIT_UNTIL__ = previousWaitUntil;
    }
  });
});

describe('recoverChasersOnBoot and dispatch error handling', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    jest.restoreAllMocks();
  });

  test('recoverChasersOnBoot handles empty pending list', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(domainQueries, 'getPendingChaserJobsFromDB').mockResolvedValue([]);

    await scheduler.recoverChasersOnBoot();
  });

  test('recoverChasersOnBoot reschedules pending jobs across all channels', async () => {
    process.env.NODE_ENV = 'production';
    const fakeJobs = [
      {
        id: 'job-1',
        channel: 'whatsapp',
        rfq_number: 'RFQ-BOOT-1',
        rfq_id: 'rfq-boot-1',
        vendor_id: 'v-1',
        vendor_name: 'Vendor 1',
        vendor_phone: '9876543210',
        fire_at: new Date(Date.now() + 1000).toISOString(),
      },
      {
        id: 'job-2',
        channel: 'sms',
        rfq_number: 'RFQ-BOOT-1',
        rfq_id: 'rfq-boot-1',
        vendor_id: 'v-1',
        vendor_name: 'Vendor 1',
        vendor_phone: '9876543210',
        fire_at: new Date(Date.now() - 1000).toISOString(), // past due
      },
      {
        id: 'job-3',
        channel: 'call',
        rfq_number: 'RFQ-BOOT-1',
        rfq_id: 'rfq-boot-1',
        vendor_id: 'v-1',
        vendor_name: 'Vendor 1',
        vendor_phone: '9876543210',
        fire_at: new Date(Date.now() + 2000).toISOString(),
      },
      {
        id: 'job-4',
        channel: 'email',
        rfq_number: 'RFQ-BOOT-1',
        rfq_id: 'rfq-boot-1',
        vendor_id: 'v-1',
        vendor_name: 'Vendor 1',
        vendor_email: 'v1@test.com',
        fire_at: new Date(Date.now() + 3000).toISOString(),
      },
    ];

    jest.spyOn(domainQueries, 'getPendingChaserJobsFromDB').mockResolvedValue(fakeJobs);
    const claimedIds = new Set();
    jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockImplementation(async (now) => fakeJobs
      .filter((job) => new Date(job.fire_at).getTime() <= new Date(now).getTime() && !claimedIds.has(job.id))
      .map((job) => {
        claimedIds.add(job.id);
        return { ...job, attempts: 1 };
      }));
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(RFQ);
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
    const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true });
    const mailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

    await scheduler.recoverChasersOnBoot();

    // Advance timers so scheduled callbacks run
    await jest.advanceTimersByTimeAsync(5000);

    expect(waSpy).toHaveBeenCalled();
    expect(smsSpy).toHaveBeenCalled();
    expect(mailSpy).toHaveBeenCalled();
  });

  test('recoverChasersOnBoot catches database error without crashing', async () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(domainQueries, 'getPendingChaserJobsFromDB').mockRejectedValue(new Error('connection timeout'));

    await expect(scheduler.recoverChasersOnBoot()).resolves.toBeUndefined();
  });

  test('dispatchDueChaserJobs handles missing RFQ and unsupported channel', async () => {
    const jobs = [
      { id: 'j-miss', rfq_number: 'RFQ-MISSING', channel: 'email', vendor_id: 'v-1', attempts: 1 },
      { id: 'j-bad', rfq_number: 'RFQ-OK', channel: 'telegram', vendor_id: 'v-1', attempts: 1 },
    ];
    jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue(jobs);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockImplementation(async (rfqNum) => {
      if (rfqNum === 'RFQ-MISSING') return null;
      return { rfqNumber: 'RFQ-OK', title: 'Test RFQ' };
    });
    const failSpy = jest.spyOn(domainQueries, 'markChaserJobFailedInDB').mockResolvedValue(true);

    const res = await scheduler.dispatchDueChaserJobs(10);
    expect(res.failed).toBe(2);
    expect(failSpy).toHaveBeenCalledWith('j-miss', expect.stringContaining('was not found'), 1);
    expect(failSpy).toHaveBeenCalledWith('j-bad', expect.stringContaining('Unsupported chaser channel'), 1);
  });

  test('dispatchDueChaserJobs handles whatsapp, sms, call, and failure outcomes', async () => {
    const jobs = [
      { id: 'j-wa', rfq_number: 'RFQ-1', channel: 'whatsapp', vendor_id: 'v-1', vendor_phone: '9876543210', attempts: 1 },
      { id: 'j-sms', rfq_number: 'RFQ-1', channel: 'sms', vendor_id: 'v-1', vendor_phone: '9876543210', attempts: 1 },
      { id: 'j-call', rfq_number: 'RFQ-1', channel: 'call', vendor_id: 'v-1', vendor_phone: '9876543210', attempts: 1 },
    ];
    jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue(jobs);
    jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue({ rfqNumber: 'RFQ-1', title: 'Test RFQ' });
    jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);

    process.env.NODE_ENV = 'production';
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'invalid recipient' });
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'm-1' });

    const res = await scheduler.dispatchDueChaserJobs(10);
    expect(res.claimed).toBe(3);
    expect(res.failed).toBe(1); // whatsapp failed
    expect(res.sent).toBe(1); // sms sent
    expect(res.skipped).toBe(1); // call skipped in production
  });

  test('dispatchDueChaserJobs persists follow-up updates once per RFQ after a channel batch', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const rfq = {
        rfqNumber: 'RFQ-BATCH-1',
        title: 'Batch RFQ',
        followUpData: {
          emailStats: { total: 2, delivered: 0, sent24h: 0, opened: 0 },
          smsStats: { total: 2, delivered: 0, clicked: 0 },
          vendors: [
            { vendorId: 'vendor-email', vendorName: 'Email Vendor' },
            { vendorId: 'vendor-sms', vendorName: 'SMS Vendor' },
          ],
        },
      };
      const jobs = [
        {
          id: 'job-email', rfq_number: rfq.rfqNumber, channel: 'email', attempts: 1,
          vendor_id: 'vendor-email', vendor_name: 'Email Vendor', vendor_email: 'email@example.com',
        },
        {
          id: 'job-sms', rfq_number: rfq.rfqNumber, channel: 'sms', attempts: 1,
          vendor_id: 'vendor-sms', vendor_name: 'SMS Vendor', vendor_phone: '9876543210',
        },
      ];
      jest.spyOn(domainQueries, 'claimDueChaserJobsFromDB').mockResolvedValue(jobs);
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(rfq);
      jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
      const upsertSpy = jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue(rfq);
      jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-batch' });

      const result = await scheduler.dispatchDueChaserJobs(10);

      expect(result).toEqual({ claimed: 2, sent: 2, failed: 0, skipped: 0 });
      expect(domainQueries.getRFQByNumberFromDB).toHaveBeenCalledTimes(1);
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      expect(upsertSpy).toHaveBeenCalledWith(rfq);
      expect(rfq.followUpData.emailStats.delivered).toBe(1);
      expect(rfq.followUpData.smsStats.delivered).toBe(1);
      expect(rfq.followUpData.vendors[0].emailSent).toBe(true);
      expect(rfq.followUpData.vendors[1].sms.status).toBe('delivered');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('scheduleVendorChaser handles _persistChaserJob failure gracefully', async () => {
    jest.spyOn(domainQueries, 'insertChaserJobInDB').mockRejectedValue(new Error('insert failed'));
    scheduler.scheduleVendorChaser({ rfqNumber: 'RFQ-ERR', title: 'Test' }, { id: 'v-1', name: 'Vendor 1' });
  });

  test('covers vendor phone/mobile fallbacks and store lookup in _dispatchSms and _dispatchWhatsApp', async () => {
    process.env.NODE_ENV = 'production';
    const storeService = require('../src/services/storeService');
    const getVendorSpy = jest.spyOn(storeService, 'getVendorById').mockReturnValue({ mobileNumber: '9123456789' });
    const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true });
    const failSpy = jest.spyOn(domainQueries, 'markChaserJobFailedInDB').mockResolvedValue(true);

    // Vendor with no phone, uses storeService fallback
    const resSms = await scheduler._dispatchSms(RFQ, { id: 'v-fallback', name: 'Store Vendor' }, 'job-sms-fallback');
    expect(resSms.success).toBe(true);
    expect(getVendorSpy).toHaveBeenCalledWith('v-fallback', 'all');

    // Vendor with mobile property
    const resWa = await scheduler._dispatchWhatsApp(RFQ, { id: 'v-mob', name: 'Mobile Vendor', mobile: '9988776655' }, 'job-wa');
    expect(resWa).toBeDefined();

    // Vendor with mobileNumber property
    const resWa2 = await scheduler._dispatchWhatsApp(RFQ, { id: 'v-mobnum', name: 'Mobile Vendor', mobileNumber: '9988776655' });
    expect(resWa2).toBeDefined();

    // SMS failure with jobId and custom error
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false, error: 'SMS gateway reject' });
    await scheduler._dispatchSms(RFQ, { id: 'v-fail', name: 'Fail Vendor', phone: '9876543210' }, 'job-sms-fail');
    expect(failSpy).toHaveBeenCalledWith('job-sms-fail', 'SMS gateway reject', 1);

    // SMS failure with jobId and default error message
    jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false });
    await scheduler._dispatchSms(RFQ, { id: 'v-fail2', name: 'Fail Vendor', phone: '9876543210' }, 'job-sms-fail2');
    expect(failSpy).toHaveBeenCalledWith('job-sms-fail2', 'gateway error', 1);

    // Email failure with jobId and custom reason
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'quota exceeded' });
    await scheduler._dispatchReminderEmail(RFQ, { id: 'v-em-fail', name: 'Email Fail', email: 'fail@v.com' }, {}, 'job-em-fail');
    expect(failSpy).toHaveBeenCalledWith('job-em-fail', 'quota exceeded', 1);

    // Email failure with jobId and default reason
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false });
    await scheduler._dispatchReminderEmail(RFQ, { id: 'v-em-fail2', name: 'Email Fail', email: 'fail@v.com' }, {}, 'job-em-fail2');
    expect(failSpy).toHaveBeenCalledWith('job-em-fail2', 'email delivery failed', 1);

    // WhatsApp failure with jobId and custom error
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'invalid template' });
    await scheduler._dispatchWhatsApp(RFQ, { id: 'v-wa-fail', name: 'Fail WA', phone: '9876543210' }, 'job-wa-fail');
    expect(failSpy).toHaveBeenCalledWith('job-wa-fail', 'invalid template', 1);

    // WhatsApp failure with jobId and default error
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false });
    await scheduler._dispatchWhatsApp(RFQ, { id: 'v-wa-fail2', name: 'Fail WA', phone: '9876543210' }, 'job-wa-fail2');
    expect(failSpy).toHaveBeenCalledWith('job-wa-fail2', 'gateway error', 1);

    // WhatsApp success with jobId
    const firedSpy = jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-ok' });
    await scheduler._dispatchWhatsApp(RFQ, { id: 'v-wa-ok', name: 'Ok WA', phone: '9876543210' }, 'job-wa-ok');
    expect(firedSpy).toHaveBeenCalledWith('job-wa-ok');

    // Call reminder with jobId and without phone
    await scheduler._dispatchCall(RFQ, { id: 'v-call-nophone', name: 'No Phone' }, 'job-call-nophone');
    await scheduler._dispatchCall(RFQ, { id: 'v-call-ok', name: 'Call Ok', phone: '9876543210' }, 'job-call-ok');
    expect(firedSpy).toHaveBeenCalledWith('job-call-ok');

    // SMS storeService null or throws
    getVendorSpy.mockReturnValueOnce(null);
    await scheduler._dispatchSms(RFQ, { id: 'v-null-store', name: 'Null Store' });

    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    getVendorSpy.mockImplementationOnce(() => { throw new Error('store error'); });
    await scheduler._dispatchSms(RFQ, { id: 'v-err-store', name: 'Err Store' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not load vendor contact for SMS chaser; continuing with supplied contact fields',
      expect.objectContaining({ vendorId: 'v-err-store' }),
      'RFQ_CHASER'
    );
  });

  test('covers scheduleRFQChasers with non-function creditInfo and defaults', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { CHASER_DELAYS } = require('../src/config/constants');
    const origSmsMs = CHASER_DELAYS.SMS_MS;
    const origWaMs = CHASER_DELAYS.WHATSAPP_MS;
    const origEmailMs = CHASER_DELAYS.EMAIL_MS;

    CHASER_DELAYS.SMS_MS = 'not-a-number';
    CHASER_DELAYS.WHATSAPP_MS = 'not-a-number';
    CHASER_DELAYS.EMAIL_MS = 'not-a-number';

    // Sourcing mode version_0
    scheduler.scheduleRFQChasers(
      { rfqNumber: 'RFQ-V0-ALT', title: 'Alt V0', sourcingMode: 'version_0' },
      [{ id: 'v-1', name: 'V1', phone: '9876543210' }],
      { freeCreditsRemaining: 3, isSubscribed: true }
    );

    // Sourcing mode v0
    scheduler.scheduleRFQChasers(
      { rfqNumber: 'RFQ-V0-ALT2', title: 'Alt V0 2', sourcingMode: 'v0' },
      [{ id: 'v-1', name: 'V1', phone: '9876543210' }]
    );

    // RFQ with no id (falls back to rfqNumber)
    scheduler.scheduleVendorChaser(
      { rfqNumber: 'RFQ-NO-ID', sourcingMode: 'mode_1' },
      { id: 'v-1', name: 'V1', phone: '9876543210' }
    );

    CHASER_DELAYS.SMS_MS = origSmsMs;
    CHASER_DELAYS.WHATSAPP_MS = origWaMs;
    CHASER_DELAYS.EMAIL_MS = origEmailMs;
    process.env.NODE_ENV = origEnv;
  });
});

// ── Deduplication & Duplicate Prevention ──────────────────────────────────────

describe('Deduplication & Duplicate Prevention', () => {
  test('handles missing vendor identity and filters empty vendor entries', () => {
    expect(scheduler._vendorKey(null)).toBe('unknown');
    expect(scheduler._vendorKey({})).toBe('unknown');
    scheduler.scheduleRFQChasers(RFQ, [null, {}]);
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);
  });

  test('scheduleRFQChasers deduplicates identical vendor stubs in the array', () => {
    // Array contains same vendor twice
    scheduler.scheduleRFQChasers(RFQ, [VENDOR, VENDOR]);
    // Exactly 4 timers registered (not 8)
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);
  });

  test('scheduleVendorChaser skips scheduling duplicate timers if invoked multiple times', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);

    // Repeated call for same RFQ and vendor
    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    // Still exactly 4 timers
    expect(scheduler.pendingTimers.get(RFQ.rfqNumber)).toHaveLength(4);
  });

  test('clearScheduledChasers clears activeScheduledTimers', () => {
    scheduler.scheduleVendorChaser(RFQ, VENDOR);
    expect(scheduler.activeScheduledTimers.size).toBe(4);

    scheduler.clearScheduledChasers(RFQ.rfqNumber);
    expect(scheduler.activeScheduledTimers.size).toBe(0);
    expect(scheduler.pendingTimers.has(RFQ.rfqNumber)).toBe(false);
  });

  test('_chaserJobId generates deterministic, repeatable job IDs without timestamps', () => {
    const id1 = scheduler._chaserJobId('RFQ-123', 'v-456', 'sms');
    const id2 = scheduler._chaserJobId('RFQ-123', 'v-456', 'sms');
    expect(id1).toBe('chaser-RFQ-123-v-456-sms');
    expect(id2).toBe('chaser-RFQ-123-v-456-sms');
  });

  test('_dispatchSms does not wipe out recent throttle cache', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const sendSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({
      success: true,
      messageId: 'sms-1',
    });

    // First dispatch
    await scheduler._dispatchSms(RFQ, VENDOR);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Second dispatch directly following should NOT clear throttle before calling sendRFQChaserSms
    await scheduler._dispatchSms(RFQ, VENDOR);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    process.env.NODE_ENV = origEnv;
  });

  test('dispatch helpers continue without job IDs when delivery fails or contact data is absent', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockRejectedValue(new Error('WhatsApp unavailable'));
    jest.spyOn(smsService, 'sendRFQChaserSms').mockRejectedValue(new Error('SMS unavailable'));
    jest.spyOn(mailerService, 'sendRfqInviteEmail').mockRejectedValue(new Error('Email unavailable'));
    const firedSpy = jest.spyOn(domainQueries, 'markChaserJobFiredInDB').mockResolvedValue(true);
    const failedSpy = jest.spyOn(domainQueries, 'markChaserJobFailedInDB').mockResolvedValue(true);
    const storeService = require('../src/services/storeService');
    const vendorLookup = jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);

    try {
      await scheduler._dispatchWhatsApp(RFQ, { id: 'vendor-no-job', name: 'Vendor', phone: VENDOR.phone });
      await scheduler._dispatchSms(RFQ, { id: 'vendor-no-job', name: 'Vendor', phone: VENDOR.phone });
      await scheduler._dispatchSms(RFQ, { id: 'vendor-no-job-phone', name: 'Vendor' });
      await scheduler._dispatchReminderEmail(RFQ, { id: 'vendor-no-job', name: 'Vendor', email: VENDOR.email });
      await scheduler._dispatchReminderEmail(RFQ, { id: 'vendor-no-email', name: 'Vendor' });
      await scheduler._dispatchWhatsApp(RFQ, { id: 'vendor-no-phone', name: 'Vendor' });
      await scheduler._dispatchCall(RFQ, { id: 'vendor-no-job', name: 'Vendor', phone: VENDOR.phone });
      expect(vendorLookup).toHaveBeenCalled();
      expect(firedSpy).not.toHaveBeenCalled();
      expect(failedSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

describe('_updateLiveFollowUpStats coverage', () => {
    test('updates follow-up stats for whatsapp, sms, and email', () => {
      const storeService = require('../src/services/storeService');
      const mockRfq = {
        rfqNumber: 'RFQ-FUP-TEST',
        followUpData: {
          vendors: [{ vendorId: 'v-001', vendorName: 'Apex Supplies' }],
        },
      };
      jest.spyOn(storeService, 'getRFQById').mockReturnValue(mockRfq);

      // Null check
      scheduler._updateLiveFollowUpStats(null, 'sms', null);

      // WhatsApp update
      scheduler._updateLiveFollowUpStats('RFQ-FUP-TEST', 'whatsapp', VENDOR);
      expect(mockRfq.followUpData.whatsappStats.delivered).toBe(1);

      // SMS update
      scheduler._updateLiveFollowUpStats('RFQ-FUP-TEST', 'sms', VENDOR);
      expect(mockRfq.followUpData.smsStats.delivered).toBe(1);
      expect(mockRfq.followUpData.smsStats.total).toBe(1);
      expect(mockRfq.followUpData.vendors[0].sms.status).toBe('delivered');

      // Email update
      scheduler._updateLiveFollowUpStats('RFQ-FUP-TEST', 'email', VENDOR);
      expect(mockRfq.followUpData.emailStats.delivered).toBe(1);
      expect(mockRfq.followUpData.emailStats.sent24h).toBe(1);

      // Missing followUpData
      const rfqNoFup = { rfqNumber: 'NO-FUP' };
      storeService.getRFQById.mockReturnValue(rfqNoFup);
      scheduler._updateLiveFollowUpStats('NO-FUP', 'sms', VENDOR);

      // Non-existent RFQ
      storeService.getRFQById.mockReturnValue(null);
      scheduler._updateLiveFollowUpStats('UNKNOWN-RFQ', 'sms', VENDOR);
    });
  });
});
