// ==============================================================================
// ZOHO PAYMENT LINK RECONCILIATION
// ==============================================================================
// Every RECONCILIATION_INTERVAL_MS, re-check every payment link still sitting
// in CREATED/pending against Zoho's own status, in case a webhook delivery was
// lost or delayed. Mirrors the reference app's PaymentReconciliationJob (a
// `0 */10 * * * *` cron), collapsed to a setInterval since this backend has no
// job scheduler — same shape as emailGatewayService.startPolling().
//
// Deliberate improvement over the reference implementation, which has an
// explicit TODO leaving this half-finished: if reconciliation discovers a link
// is now paid, it activates the subscription here too (via the same idempotent
// activateVendorSubscriptionFromPayment the webhook uses), rather than only
// updating the status and leaving the vendor stuck on their old plan.
// ==============================================================================

const storeService = require('../services/storeService');
const zohoPaymentService = require('./zohoPaymentService');
const { ZOHO_CONFIG } = require('../config/constants');
const { logger } = require('./loggerService');

const runtime = { timer: null };

const RECONCILABLE_STATUSES = ['CREATED', 'pending'];

async function reconcileOnce() {
  const pending = storeService.getPaymentLinksByStatusIn(RECONCILABLE_STATUSES);
  for (const link of pending) {
    try {
      const result = await zohoPaymentService.getPaymentLinkStatus(link.zohoPaymentLinkId);
      storeService.updatePaymentLinkRecord(link.id, { status: result.status, rawResponse: result.rawResponse });
      if (result.status === 'PAID') {
        storeService.activateVendorSubscriptionFromPayment(link.id);
      }
    } catch (err) {
      logger.error(`Zoho reconciliation failed for payment link ${link.id}`, err, 'ZOHO_RECONCILIATION');
    }
  }
  return { checked: pending.length };
}

/** Begin polling on an interval. Refuses to start twice or when disabled/unconfigured. */
function startPolling(config = ZOHO_CONFIG) {
  if (runtime.timer) return { started: false, reason: 'Already started.' };
  if (!config.RECONCILIATION_ENABLED) return { started: false, reason: 'ZOHO_RECONCILIATION_ENABLED is not true.' };
  if (!config.REFRESH_TOKEN) return { started: false, reason: 'ZOHO_REFRESH_TOKEN is not configured.' };

  runtime.timer = setInterval(() => {
    reconcileOnce().catch((err) => logger.error('Zoho reconciliation interval poll threw', err, 'ZOHO_RECONCILIATION'));
  }, config.RECONCILIATION_INTERVAL_MS);
  if (typeof runtime.timer.unref === 'function') runtime.timer.unref();

  logger.info(
    `Zoho payment-link reconciliation polling every ${Math.round(config.RECONCILIATION_INTERVAL_MS / 1000)}s`,
    {},
    'ZOHO_RECONCILIATION'
  );
  return { started: true, intervalMs: config.RECONCILIATION_INTERVAL_MS };
}

/** Stop the interval. Safe to call when it was never started. */
function stopPolling() {
  if (!runtime.timer) return false;
  clearInterval(runtime.timer);
  runtime.timer = null;
  return true;
}

module.exports = { reconcileOnce, startPolling, stopPolling };
