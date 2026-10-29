/**
 * RFQ Chaser Scheduler
 *
 * Schedules real multi-channel follow-up notifications for vendors when an RFQ
 * is created or a vendor is manually invited.  The dispatch sequence mirrors
 * the plan feature copy on the subscription-center page:
 *
 *   Channel     Delay    Purpose
 *   ---------   ------   -----------------------------------------------
 *   SMS         5 min    Within 5 minutes of RFQ → SMS reminder
 *   Call        6 h      After 6 hours → Call reminder (logic kept, telephony deferred)
 *   WhatsApp    12 h     After another 6 hours (total 12h) → WhatsApp reminder
 *   Email       24 h     After 24 hours → Email reminder
 *
 * All delays are configurable via CHASER_DELAYS in constants.js, which itself
 * reads from env vars (CHASER_*_DELAY_MS) so they can be shortened in staging
 * or tests without a code change.
 *
 * Design decisions
 * ─────────────────
 * • Node deployments use timers for low-latency dispatch. Cloudflare Workers
 *   persist jobs to D1 and dispatch due jobs from a Cron Trigger, since request-
 *   scoped timers cannot reliably survive for hours.
 *
 * • Node timers are re-armed from the persisted queue on server boot. Workers
 *   claim due queue rows directly from the Cron Trigger instead.
 *
 * • Each channel send is fire-and-forget: a failure logs but never re-throws
 *   so one bad vendor number cannot abort the rest of the fan-out.
 *
 * • Timers are trackable via `pendingTimers` (Map rfqNumber → timer ids[])
 *   so the test suite can inspect or cancel them without going async.
 */

const { CHASER_DELAYS } = require('../config/constants');
const smsService = require('./smsService');
const whatsAppService = require('./whatsAppService');
const mailerService = require('./mailerService');
const { logger } = require('./loggerService');
const domainQueries = require('../db/domainQueries');
const { getD1Binding, getWaitUntil } = require('../db/d1Bridge');

const _ignoreError = () => {};

// ── Timer registry ────────────────────────────────────────────────────────────
// Maps rfqNumber → array of NodeJS.Timeout handles.
// Only used by tests (clearScheduledChasers) and graceful shutdown.
const pendingTimers = new Map();

// Maps `${rfqNumber}:${vendorKey}:${channel}` → NodeJS.Timeout handle.
// Ensures identical chaser timers are never scheduled twice for the same vendor & channel.
const activeScheduledTimers = new Map();

function _registerTimer(rfqNumber, handle) {
  if (!pendingTimers.has(rfqNumber)) pendingTimers.set(rfqNumber, []);
  pendingTimers.get(rfqNumber).push(handle);
}

/**
 * Cancel all pending chaser timers for one RFQ.
 * Called when an RFQ is deleted or closed so stale dispatches never fire.
 */
function clearScheduledChasers(rfqNumber) {
  const handles = pendingTimers.get(rfqNumber) || [];
  handles.forEach((h) => clearTimeout(h));
  pendingTimers.delete(rfqNumber);

  for (const [key, handle] of activeScheduledTimers.entries()) {
    if (key.startsWith(`${rfqNumber}:`)) {
      clearTimeout(handle);
      activeScheduledTimers.delete(key);
    }
  }

  if (handles.length > 0) {
    logger.info(
      `Cleared ${handles.length} pending chaser timer(s) for ${rfqNumber}`,
      { rfqNumber },
      'RFQ_CHASER'
    );
  }
  // Cancel persisted jobs in D1 (best-effort — never throw)
  domainQueries.cancelChaserJobsForRFQInDB(rfqNumber).catch(_ignoreError);
}

// ── Per-vendor dispatch helpers ───────────────────────────────────────────────

/**
 * Fire-and-forget WhatsApp invite for one vendor.
 * Returns the Promise so tests can await it; storeService ignores the return.
 */
async function _dispatchWhatsApp(rfq, vendor, jobId) {
  if (process.env.NODE_ENV === 'test') return { channel: 'whatsapp', skipped: true };
  const phone = vendor.phone || vendor.mobile || vendor.mobileNumber;
  if (!phone) {
    logger.debug(`[CHASER] WhatsApp skipped for ${vendor.name} — no phone`, {}, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
    return { channel: 'whatsapp', skipped: true };
  }
  try {
    const result = await whatsAppService.sendRFQInvitationWhatsApp({
      phone,
      vendorName: vendor.name,
      contactPerson: vendor.contactPerson,
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      vendorEmail: vendor.email,
      deliveryDate: rfq.targetDeliveryDate || rfq.deadline,
      deliveryLocation: rfq.deliveryLocation || rfq.deliveryCity,
    });
    logger.info(
      `[CHASER] WhatsApp → ${vendor.name} (${phone}) for ${rfq.rfqNumber}: ${result.success ? `ok (${result.messageId})` : `failed — ${result.error || 'unknown'}`}`,
      { rfqNumber: rfq.rfqNumber, vendorId: vendor.id, success: result.success },
      'RFQ_CHASER'
    );
    if (jobId) {
      if (result.success) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
      else await domainQueries.markChaserJobFailedInDB(jobId, result.error || 'gateway error').catch(_ignoreError);
    }
    return { channel: 'whatsapp', success: result.success };
  } catch (err) {
    logger.error(`[CHASER] WhatsApp error for ${vendor.name}: ${err.message}`, err, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFailedInDB(jobId, err.message).catch(_ignoreError);
    return { channel: 'whatsapp', success: false, error: err.message };
  }
}

/**
 * Fire-and-forget SMS chaser for one vendor.
 */
async function _dispatchSms(rfq, vendor, jobId) {
  if (process.env.NODE_ENV === 'test') return { channel: 'sms', skipped: true };
  let phone = vendor.phone || vendor.mobile || vendor.mobileNumber;
  if (!phone && vendor.id) {
    try {
      const storeService = require('./storeService');
      const full = storeService.getVendorById ? storeService.getVendorById(vendor.id, 'all') : null;
      if (full) phone = full.phone || full.mobile || full.mobileNumber;
    } catch {
      // ignore
    }
  }
  if (!phone) {
    logger.debug(`[CHASER] SMS skipped for ${vendor.name} — no phone`, {}, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
    return { channel: 'sms', skipped: true };
  }
  try {
    const bidUrl = whatsAppService.generateOneClickBidUrl(rfq.rfqNumber, vendor.email);
    const result = await smsService.sendRFQChaserSms({
      mobile: phone,
      vendorName: vendor.name,
      rfqNumber: rfq.rfqNumber,
      rfqTitle: rfq.title,
      bidLink: bidUrl,
    });
    logger.info(
      `[CHASER] SMS → ${vendor.name} (${phone}) for ${rfq.rfqNumber}: ${result.success ? `ok (${result.messageId})` : `failed — ${result.error || 'unknown'}`}`,
      { rfqNumber: rfq.rfqNumber, vendorId: vendor.id, success: result.success },
      'RFQ_CHASER'
    );
    if (jobId) {
      if (result.success) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
      else await domainQueries.markChaserJobFailedInDB(jobId, result.error || 'gateway error').catch(_ignoreError);
    }
    return { channel: 'sms', success: result.success };
  } catch (err) {
    logger.error(`[CHASER] SMS error for ${vendor.name}: ${err.message}`, err, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFailedInDB(jobId, err.message).catch(_ignoreError);
    return { channel: 'sms', success: false, error: err.message };
  }
}

/**
 * Fire-and-forget 24h reminder email for one vendor.
 * Uses the same sendRfqInviteEmail used on creation — vendors receive the full
 * RFQ detail email again as a formal reminder, labelled as a follow-up.
 */
async function _dispatchReminderEmail(rfq, vendor, creditInfo = {}, jobId) {
  if (process.env.NODE_ENV === 'test') return { channel: 'email', skipped: true };
  if (!vendor.email) {
    logger.debug(`[CHASER] Reminder email skipped for ${vendor.name} — no email`, {}, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
    return { channel: 'email', skipped: true };
  }
  try {
    const isBuyerUploaded = mailerService.isBuyerUploadedVendor
      ? mailerService.isBuyerUploadedVendor(vendor)
      : false;
    const result = await mailerService.sendRfqInviteEmail(vendor.email, {
      rfq,
      recipientName: vendor.contactPerson || vendor.name,
      freeCreditsRemaining: creditInfo.freeCreditsRemaining ?? null,
      isSubscribed: creditInfo.isSubscribed ?? false,
      isReminder: true,
      vendor,
      isBuyerUploaded,
    });
    logger.info(
      `[CHASER] Reminder email → ${vendor.email} for ${rfq.rfqNumber}: ${result.sent ? 'sent' : `not sent — ${result.reason || 'unknown'}`}`,
      { rfqNumber: rfq.rfqNumber, vendorId: vendor.id, sent: result.sent },
      'RFQ_CHASER'
    );
    if (jobId) {
      if (result.sent) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
      else await domainQueries.markChaserJobFailedInDB(jobId, result.reason || 'email delivery failed').catch(_ignoreError);
    }
    return { channel: 'email', sent: result.sent };
  } catch (err) {
    logger.error(`[CHASER] Reminder email error for ${vendor.email}: ${err.message}`, err, 'RFQ_CHASER');
    if (jobId) await domainQueries.markChaserJobFailedInDB(jobId, err.message).catch(_ignoreError);
    return { channel: 'email', sent: false, error: err.message };
  }
}

/**
 * Fire-and-forget call reminder step for one vendor.
 * Kept in the flow/logic as required; actual telephony calling is deferred for now.
 */
async function _dispatchCall(rfq, vendor, jobId) {
  if (process.env.NODE_ENV === 'test') return { channel: 'call', skipped: true };
  const phone = vendor.phone || vendor.mobile || vendor.mobileNumber;
  logger.info(
    `[CHASER] Call reminder triggered for ${vendor.name} (${phone || 'no phone'}) on ${rfq.rfqNumber} (calling deferred)`,
    { rfqNumber: rfq.rfqNumber, vendorId: vendor.id, phone },
    'RFQ_CHASER'
  );
  if (jobId) await domainQueries.markChaserJobFiredInDB(jobId).catch(_ignoreError);
  return { channel: 'call', skipped: true, reason: 'calling_not_implemented' };
}

/**
 * Resolves a stable string key for a vendor to deduplicate timers and job IDs.
 * @param {object} vendor
 * @returns {string}
 */
function _vendorKey(vendor) {
  if (!vendor) return 'unknown';
  if (vendor.id) return String(vendor.id).trim();
  const phone = vendor.phone || vendor.mobile || vendor.mobileNumber;
  if (phone) return String(phone).replace(/\D/g, '').slice(-10);
  if (vendor.email) return String(vendor.email).toLowerCase().trim();
  return String(vendor.name || 'unknown').toLowerCase().trim();
}

/**
 * Generates a deterministic chaser job ID.
 * @param {string} rfqNumber
 * @param {string} vendorIdOrKey
 * @param {string} channel
 * @returns {string}
 */
function _chaserJobId(rfqNumber, vendorIdOrKey, channel) {
  const safeVendorKey = String(vendorIdOrKey || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `chaser-${rfqNumber}-${safeVendorKey}-${channel}`;
}

/**
 * Persist a chaser job to D1 (fire-and-forget — never blocks scheduling).
 */
async function _persistChaserJob(jobId, rfq, vendor, channel, delayMs) {
  try {
    const fireAt = new Date(Date.now() + delayMs).toISOString();
    await domainQueries.insertChaserJobInDB({
      id: jobId,
      rfqNumber: rfq.rfqNumber,
      rfqId: rfq.id || rfq.rfqNumber,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorPhone: vendor.phone || null,
      vendorEmail: vendor.email || null,
      vendorContactPerson: vendor.contactPerson || null,
      rfqTitle: rfq.title || null,
      channel,
      fireAt,
    });
  } catch (err) {
    // Never block scheduling — chaser DB persistence is best-effort
    logger.warn(`[CHASER] Failed to persist ${channel} job for ${rfq.rfqNumber}: ${err.message}`, {}, 'RFQ_CHASER');
  }
}

/**
 * Schedule the full multi-channel chaser sequence for one vendor on one RFQ:
 * 1. Within 5 minutes of RFQ → SMS reminder
 * 2. After 6 hours → Call reminder (logic kept, telephony deferred)
 * 3. After another 6 hours (12h total) → WhatsApp reminder
 * 4. After 24 hours → Email reminder
 *
 * Persists each job to D1 so they can be recovered on server restart.
 *
 * @param {object} rfq    — RFQ object (needs rfqNumber, id, title, sourcingMode)
 * @param {object} vendor — Vendor stub (needs name, email, phone, contactPerson, id)
 * @param {object} [creditInfo] — { freeCreditsRemaining, isSubscribed } for the email
 */
function scheduleVendorChaser(rfq, vendor, creditInfo = {}) {
  if (!rfq || !vendor) return;

  const { rfqNumber } = rfq;
  const isV0 =
    rfq.sourcingMode === 'mode_0' ||
    rfq.sourcingMode === 'v0' ||
    rfq.sourcingMode === 'version_0';

  const vendorKey = _vendorKey(vendor);

  const smsDelay = process.env.NODE_ENV === 'test'
    ? (CHASER_DELAYS.SMS_MS ?? 5 * 60 * 1000)
    : (CHASER_DELAYS.SMS_MS !== undefined && !isNaN(Number(CHASER_DELAYS.SMS_MS))
        ? Math.max(0, Number(CHASER_DELAYS.SMS_MS))
        : (5 * 60 * 1000));
  const callDelay = CHASER_DELAYS.CALL_MS;
  const waDelay = process.env.NODE_ENV === 'test'
    ? (CHASER_DELAYS.WHATSAPP_MS ?? 12 * 60 * 60 * 1000)
    : Math.max(0, Number(CHASER_DELAYS.WHATSAPP_MS) || (12 * 60 * 60 * 1000));
  const emailDelay = process.env.NODE_ENV === 'test'
    ? (CHASER_DELAYS.EMAIL_MS ?? 24 * 60 * 60 * 1000)
    : Math.max(0, Number(CHASER_DELAYS.EMAIL_MS) || (24 * 60 * 60 * 1000));

  if (getD1Binding()) {
    const waitUntil = getWaitUntil();
    const jobs = isV0
      ? [['sms', smsDelay]]
      : [
          ['sms', smsDelay],
          ['call', callDelay],
          ['whatsapp', waDelay],
          ['email', emailDelay],
        ];
    jobs.forEach(([channel, delay]) => {
      const jobId = _chaserJobId(rfqNumber, vendorKey, channel);
      const persistPromise = _persistChaserJob(jobId, rfq, vendor, channel, delay);
      if (waitUntil) waitUntil(persistPromise);
    });
    logger.info(
      `[CHASER] Persisted Worker schedule for ${vendor.name} on ${rfqNumber} (isV0=${isV0}); dispatch is handled by Cron Trigger`,
      { rfqNumber, vendorId: vendor.id, isV0 },
      'RFQ_CHASER'
    );
    return;
  }

  const waitUntil = getWaitUntil();

  // 1. SMS reminder — within 5 minutes of RFQ (reusing approved RFQ chaser SMS template)
  const smsKey = `${rfqNumber}:${vendorKey}:sms`;
  if (!activeScheduledTimers.has(smsKey)) {
    const smsJobId = _chaserJobId(rfqNumber, vendorKey, 'sms');
    let smsPromiseResolve;
    const smsPromise = new Promise((resolve) => { smsPromiseResolve = resolve; });
    const smsHandle = setTimeout(async () => {
      try {
        await _dispatchSms(rfq, vendor, smsJobId).catch(_ignoreError);
      } finally {
        activeScheduledTimers.delete(smsKey);
        smsPromiseResolve();
      }
    }, smsDelay);
    activeScheduledTimers.set(smsKey, smsHandle);
    _registerTimer(rfqNumber, smsHandle);
    _persistChaserJob(smsJobId, rfq, vendor, 'sms', smsDelay);
    if (waitUntil) waitUntil(smsPromise);
  }

  // For V0 (Free Starter Trial): Only SMS notification is sent after 5 minutes. No follow-up notifications (Call, WhatsApp, Email).
  if (isV0) {
    logger.info(
      `[CHASER] V0 RFQ: Scheduled SMS alert for ${vendor.name} on ${rfqNumber} with delay +${smsDelay}ms (no follow-up reminders)`,
      { rfqNumber, vendorId: vendor.id, smsDelay },
      'RFQ_CHASER'
    );
    return;
  }

  // 2. Call reminder — after 6 hours (flow preserved, calling functionality deferred)
  const callKey = `${rfqNumber}:${vendorKey}:call`;
  if (!activeScheduledTimers.has(callKey)) {
    const callJobId = _chaserJobId(rfqNumber, vendorKey, 'call');
    let callPromiseResolve;
    const callPromise = new Promise((resolve) => { callPromiseResolve = resolve; });
    const callHandle = setTimeout(async () => {
      try {
        await _dispatchCall(rfq, vendor, callJobId).catch(_ignoreError);
      } finally {
        activeScheduledTimers.delete(callKey);
        callPromiseResolve();
      }
    }, callDelay);
    activeScheduledTimers.set(callKey, callHandle);
    _registerTimer(rfqNumber, callHandle);
    _persistChaserJob(callJobId, rfq, vendor, 'call', callDelay);
    if (waitUntil) waitUntil(callPromise);
  }

  // 3. WhatsApp reminder — after another 6 hours (12h total from RFQ)
  const waKey = `${rfqNumber}:${vendorKey}:whatsapp`;
  if (!activeScheduledTimers.has(waKey)) {
    const waJobId = _chaserJobId(rfqNumber, vendorKey, 'whatsapp');
    let waPromiseResolve;
    const waPromise = new Promise((resolve) => { waPromiseResolve = resolve; });
    const waHandle = setTimeout(async () => {
      try {
        await _dispatchWhatsApp(rfq, vendor, waJobId).catch(_ignoreError);
      } finally {
        activeScheduledTimers.delete(waKey);
        waPromiseResolve();
      }
    }, waDelay);
    activeScheduledTimers.set(waKey, waHandle);
    _registerTimer(rfqNumber, waHandle);
    _persistChaserJob(waJobId, rfq, vendor, 'whatsapp', waDelay);
    if (waitUntil) waitUntil(waPromise);
  }

  // 4. Reminder email — after 24 hours
  const emailKey = `${rfqNumber}:${vendorKey}:email`;
  if (!activeScheduledTimers.has(emailKey)) {
    const emailJobId = _chaserJobId(rfqNumber, vendorKey, 'email');
    const emailHandle = setTimeout(async () => {
      try {
        await _dispatchReminderEmail(rfq, vendor, creditInfo, emailJobId).catch(_ignoreError);
      } finally {
        activeScheduledTimers.delete(emailKey);
      }
    }, emailDelay);
    activeScheduledTimers.set(emailKey, emailHandle);
    _registerTimer(rfqNumber, emailHandle);
    _persistChaserJob(emailJobId, rfq, vendor, 'email', emailDelay);
  }

  logger.info(
    `[CHASER] Scheduled for ${vendor.name} on ${rfqNumber}: SMS +${smsDelay}ms, Call +${callDelay}ms, WhatsApp +${waDelay}ms, Email +${emailDelay}ms`,
    { rfqNumber, vendorId: vendor.id, smsDelay, callDelay, waDelay, emailDelay },
    'RFQ_CHASER'
  );
}

/**
 * Dispatch due D1-backed jobs from a Cloudflare Cron Trigger.
 * Jobs are atomically claimed, and an expired claim can be recovered on a
 * later run if the Worker invocation ended before dispatch completed.
 */
async function dispatchDueChaserJobs(limit = 25) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const jobs = await domainQueries.claimDueChaserJobsFromDB(
    now.toISOString(),
    staleBefore.toISOString(),
    limit
  );
  const rfqCache = new Map();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    try {
      let rfq = rfqCache.get(job.rfq_number);
      if (!rfqCache.has(job.rfq_number)) {
        rfq = await domainQueries.getRFQByNumberFromDB(job.rfq_number);
        rfqCache.set(job.rfq_number, rfq);
      }
      if (!rfq) {
        throw new Error(`RFQ ${job.rfq_number} was not found for scheduled ${job.channel} chaser`);
      }

      const vendor = {
        id: job.vendor_id,
        name: job.vendor_name,
        phone: job.vendor_phone || null,
        email: job.vendor_email || null,
        contactPerson: job.vendor_contact_person || null,
      };
      const result = job.channel === 'email'
        ? await _dispatchReminderEmail(rfq, vendor, {}, job.id)
        : job.channel === 'whatsapp'
          ? await _dispatchWhatsApp(rfq, vendor, job.id)
          : job.channel === 'sms'
            ? await _dispatchSms(rfq, vendor, job.id)
            : job.channel === 'call'
              ? await _dispatchCall(rfq, vendor, job.id)
              : null;

      if (!result) {
        throw new Error(`Unsupported chaser channel: ${job.channel}`);
      }
      if (result.skipped) skipped++;
      else if (result.sent === false || result.success === false || result.error) failed++;
      else sent++;
    } catch (err) {
      failed++;
      logger.error(`[CHASER] Scheduled dispatch failed for job ${job.id}: ${err.message}`, err, 'RFQ_CHASER');
      await domainQueries.markChaserJobFailedInDB(job.id, err.message);
    }
  }

  logger.info(
    `[CHASER] Cron dispatch complete: ${jobs.length} claimed, ${sent} sent, ${failed} failed, ${skipped} skipped`,
    { claimed: jobs.length, sent, failed, skipped },
    'RFQ_CHASER'
  );
  return { claimed: jobs.length, sent, failed, skipped };
}

/**
 * Schedule chasers for every vendor assigned to an RFQ in one call.
 * Convenience wrapper used by storeService.createRFQ.
 *
 * @param {object}   rfq         — RFQ object
 * @param {object[]} vendors     — Array of vendor stubs
 * @param {Function} [getCreditInfo] — Optional fn(vendor) → { freeCreditsRemaining, isSubscribed }
 */
function scheduleRFQChasers(rfq, vendors, getCreditInfo = () => ({})) {
  if (!rfq || !Array.isArray(vendors) || vendors.length === 0) return;

  // Deduplicate vendors by ID / phone / email so duplicate vendor records are not passed
  const seenVendorKeys = new Set();
  const dedupedVendors = [];
  vendors.forEach((vendor) => {
    if (!vendor) return;
    const key = vendor.id
      ? `id:${String(vendor.id).trim()}`
      : vendor.phone
        ? `phone:${String(vendor.phone).replace(/\D/g, '').slice(-10)}`
        : vendor.email
          ? `email:${String(vendor.email).toLowerCase().trim()}`
          : vendor.name
            ? `name:${String(vendor.name).toLowerCase().trim()}`
            : null;

    if (key && seenVendorKeys.has(key)) return;
    if (key) seenVendorKeys.add(key);
    dedupedVendors.push(vendor);
  });

  dedupedVendors.forEach((vendor) => {
    const credit = typeof getCreditInfo === 'function' ? getCreditInfo(vendor) : (getCreditInfo || {});
    scheduleVendorChaser(rfq, vendor, credit);
  });
  logger.info(
    `[CHASER] Queued chaser sequence for ${dedupedVendors.length} vendor(s) on ${rfq.rfqNumber}`,
    { rfqNumber: rfq.rfqNumber, vendorCount: dedupedVendors.length },
    'RFQ_CHASER'
  );
}

/**
 * Recover pending chaser jobs from D1 on server boot.
 *
 * Reads all rows with status='pending' from chaser_queue.
 * - Jobs whose fire_at is in the past → dispatch immediately.
 * - Jobs with future fire_at → re-arm setTimeout for the remaining time.
 *
 * Called once from server.js after the store hydrates.
 */
async function recoverChasersOnBoot() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const pending = await domainQueries.getPendingChaserJobsFromDB();
    if (!pending.length) {
      logger.info('[CHASER] Boot recovery: no pending chasers in D1.', {}, 'RFQ_CHASER');
      return;
    }
    logger.info(`[CHASER] Boot recovery: found ${pending.length} pending job(s) — re-scheduling.`, {}, 'RFQ_CHASER');

    const now = Date.now();
    let recovered = 0;

    for (const row of pending) {
      const jobKey = `${row.rfq_number}:${row.vendor_id || 'unknown'}:${row.channel}`;
      if (activeScheduledTimers.has(jobKey)) {
        continue;
      }

      const fireAt = new Date(row.fire_at).getTime();
      const delay = Math.max(0, fireAt - now);
      const jobId = row.id;
      const rfqStub = {
        rfqNumber: row.rfq_number,
        id: row.rfq_id,
        title: row.rfq_title || '',
      };
      const vendorStub = {
        id: row.vendor_id,
        name: row.vendor_name,
        phone: row.vendor_phone || null,
        email: row.vendor_email || null,
        contactPerson: row.vendor_contact_person || null,
      };

      const dispatchFn = row.channel === 'whatsapp'
        ? () => _dispatchWhatsApp(rfqStub, vendorStub, jobId).catch(_ignoreError)
        : row.channel === 'sms'
          ? () => _dispatchSms(rfqStub, vendorStub, jobId).catch(_ignoreError)
          : row.channel === 'call'
            ? () => _dispatchCall(rfqStub, vendorStub, jobId).catch(_ignoreError)
            : () => _dispatchReminderEmail(rfqStub, vendorStub, {}, jobId).catch(_ignoreError);

      const handle = setTimeout(async () => {
        try {
          await dispatchFn();
        } finally {
          activeScheduledTimers.delete(jobKey);
        }
      }, delay);
      activeScheduledTimers.set(jobKey, handle);
      _registerTimer(row.rfq_number, handle);
      recovered++;

      logger.info(
        `[CHASER] Boot recovery: ${row.channel} for ${row.vendor_name} on ${row.rfq_number} in ${delay}ms`,
        { jobId, delay, channel: row.channel, rfqNumber: row.rfq_number },
        'RFQ_CHASER'
      );
    }

    logger.info(`[CHASER] Boot recovery complete: ${recovered} job(s) re-armed.`, {}, 'RFQ_CHASER');
  } catch (err) {
    // Never crash the server on recovery failure
    logger.error(`[CHASER] Boot recovery failed: ${err.message}`, err, 'RFQ_CHASER');
  }
}

module.exports = {
  scheduleVendorChaser,
  scheduleRFQChasers,
  clearScheduledChasers,
  recoverChasersOnBoot,
  dispatchDueChaserJobs,
  pendingTimers,
  activeScheduledTimers,
  // Exported for unit tests only — not part of the public contract
  _dispatchWhatsApp,
  _dispatchSms,
  _dispatchCall,
  _dispatchReminderEmail,
  _chaserJobId,
  _vendorKey,
};
