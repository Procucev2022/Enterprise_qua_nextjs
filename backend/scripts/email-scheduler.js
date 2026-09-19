#!/usr/bin/env node
// ==============================================================================
// ENTERPRISE QUA - ALWAYS-RUNNING AUTOMATED EMAIL POLLING SCHEDULER
// ==============================================================================
// Continuously monitors both configured email inboxes:
//   1. rfq@procucev.com (Inbound Buyer Requisitions)
//   2. srinu20252026@gmail.com (Vendor Quotations & Responses)
//
// Automatically checks both inboxes every 1 minute (60,000 ms).
// Features:
//   - Connects to both configured email inboxes
//   - Fetches only new / unprocessed emails
//   - Processes each email according to its type (Buyer RFQ vs Vendor Quote Reply)
//   - Marks successfully processed emails (\Seen + ledger) so they are never duplicated
//   - Logs structured processing results
//   - Resilient: Continues processing if one email or one mailbox fails
//   - Safe shutdown on SIGINT / SIGTERM
//
// Usage:
//   node scripts/email-scheduler.js
//   npm run email:scheduler
//   node scripts/email-scheduler.js --once
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const emailGatewayService = require('../src/services/emailGatewayService');
const { logger } = require('../src/services/loggerService');

let schedulerTimer = null;
let isRunning = false;

async function executeCycle() {
  if (isRunning) {
    logger.warn('Scheduler cycle already in progress, skipping overlapping tick', {}, 'EMAIL_SCHEDULER');
    return { skipped: true, reason: 'Already running' };
  }

  isRunning = true;
  const startedAt = Date.now();

  try {
    const summary = await emailGatewayService.pollBothInboxesOnce();
    const durationMs = Date.now() - startedAt;

    console.log(
      `[${new Date().toISOString()}] Scheduled cycle finished in ${durationMs}ms: Buyer(${summary.buyerMailbox?.ingested || 0}/${summary.buyerMailbox?.considered || 0}) | Vendor(${summary.vendorMailbox?.ingested || 0}/${summary.vendorMailbox?.considered || 0})`
    );

    return summary;
  } catch (err) {
    logger.error('Error during scheduled email polling cycle', err, 'EMAIL_SCHEDULER');
    console.error(`[${new Date().toISOString()}] Scheduler cycle error: ${err.message}`);
    return { error: err.message };
  } finally {
    isRunning = false;
  }
}

async function startScheduler(pollIntervalMs = 60000, runOnce = false) {
  console.log('================================================================');
  console.log('       ENTERPRISE QUA - AUTOMATED EMAIL POLLING SCHEDULER       ');
  console.log('================================================================\n');

  // Verify database connection
  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`[ERROR] Database unavailable: ${health.errorMessage}`);
    return null;
  }
  console.log(`✔ Database connected: ${health.providerLabel} (${health.database})`);

  // Hydrate store so buyer accounts and vendors are loaded
  console.log('✔ Hydrating buyer accounts and domain data...');
  await storeService.hydrateFromDB();
  console.log(`✔ Loaded ${(storeService.buyerAccounts || []).length} buyer accounts from database.`);

  const status = await emailGatewayService.getStatus();
  console.log(`✔ Inbound Requisitions: ${status.mailboxUser || 'N/A'} (Intake: ${status.gatewayAddress || 'N/A'})`);
  console.log(`✔ Vendor Quotations:    ${status.vendorGateway?.mailboxUser || 'N/A'} (Intake: ${status.vendorGateway?.gatewayAddress || 'N/A'})`);
  console.log(`✔ Polling Cadence:      Every ${Math.round(pollIntervalMs / 1000)}s`);

  // Run immediate first cycle
  console.log('\n[Scheduler] Running initial immediate pass...');
  await executeCycle();

  if (runOnce) {
    console.log('\n[Scheduler] Single pass complete (--once flag passed). Exiting.');
    try {
      await pool.closePool();
    } catch (_) {}
    return { stopped: true };
  }

  console.log(`\n[Scheduler] Continuous scheduler active. Polling every ${Math.round(pollIntervalMs / 1000)}s.`);

  schedulerTimer = setInterval(executeCycle, pollIntervalMs);
  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }

  return { started: true, pollIntervalMs, timer: schedulerTimer };
}

function stopScheduler() {
  isRunning = false;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Scheduler] Background interval cleared.');
    return true;
  }
  return false;
}

// Graceful termination handlers
if (typeof process.on === 'function') {
  process.on('SIGINT', async () => {
    console.log('\n[Scheduler] Received SIGINT. Shutting down gracefully...');
    stopScheduler();
    try {
      await pool.closePool();
    } catch (_) {}
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Scheduler] Received SIGTERM. Shutting down gracefully...');
    stopScheduler();
    try {
      await pool.closePool();
    } catch (_) {}
    process.exit(0);
  });
}

if (require.main === module) {
  const isOnce = process.argv.includes('--once');
  startScheduler(60000, isOnce).then((res) => {
    if (!res) {
      process.exitCode = 1;
    }
  }).catch((err) => {
    console.error('Fatal scheduler error:', err);
    process.exitCode = 1;
  });
}

module.exports = { startScheduler, stopScheduler, executeCycle };
