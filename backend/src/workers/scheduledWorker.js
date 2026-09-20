// ==============================================================================
// CLOUDFLARE SCHEDULED WORKER (CRON TRIGGERS)
// ==============================================================================
// Executes autonomous background routines in Cloudflare Edge runtime on cron
// schedule (e.g., */5 * * * *), eliminating the need for persistent setInterval
// Node.js processes.
// ==============================================================================

const zohoReconciliationService = require('../services/zohoReconciliationService');
const { logger } = require('../services/loggerService');
const pool = require('../db/pool');

/**
 * Handles Cloudflare Workers scheduled() events triggered by cron expressions.
 *
 * @param {Object} event - Cloudflare ScheduledEvent containing { cron, scheduledTime }
 * @param {Object} env - Cloudflare environment bindings (HYPERDRIVE, R2_BUCKET, vars)
 * @param {Object} ctx - Cloudflare ExecutionContext (waitUntil, passThroughOnException)
 * @returns {Promise<Object>} Summary of execution results
 */
async function handleScheduled(event = {}, env = {}, ctx = null) {
  const startedAt = new Date().toISOString();
  const cronExpression = event.cron || 'manual';

  logger.info(`[ScheduledWorker] Triggered cron task: "${cronExpression}" at ${startedAt}`, {}, 'CRON');

  if (env && (env.HYPERDRIVE || env.DATABASE_URL)) {
    pool.initFromEnv(env);
  }

  const results = {
    cron: cronExpression,
    startedAt,
    zohoChecked: 0,
    success: true,
  };

  try {
    const zohoResult = await zohoReconciliationService.reconcileOnce();
    results.zohoChecked = zohoResult && typeof zohoResult.checked === 'number' ? zohoResult.checked : 0;
    logger.info(`[ScheduledWorker] Zoho reconciliation completed (${results.zohoChecked} checked)`, {}, 'CRON');
  } catch (err) {
    results.success = false;
    results.error = err.message;
    logger.error('[ScheduledWorker] Error during scheduled reconciliation', err, 'CRON');
  }

  return results;
}

module.exports = { handleScheduled };
