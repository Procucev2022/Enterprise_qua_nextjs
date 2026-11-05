#!/usr/bin/env node
// ==============================================================================
// ENTERPRISE QUA - DAILY RFQ INFLOW & SOURCING REPORT DISPATCHER
// ==============================================================================
// Dispatches yesterday's daily RFQ inflow report (counts by sourcing mode and
// ingestion channel) to configured recipients (default: veerababu.v@procucev.com).
//
// Usage:
//   node scripts/send-daily-rfq-report.js
//   node scripts/send-daily-rfq-report.js --date 2026-11-03
//   node scripts/send-daily-rfq-report.js --to veerababu.v@procucev.com,team@procucev.com
//   node scripts/send-daily-rfq-report.js --dry-run
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const dailyRfqReportService = require('../src/services/dailyRfqReportService');
const { logger } = require('../src/services/loggerService');

function parseArgs(args = process.argv.slice(2)) {
  const options = {
    date: null,
    to: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date' && args[i + 1]) {
      options.date = args[++i].trim();
    } else if (arg.startsWith('--date=')) {
      options.date = arg.split('=')[1].trim();
    } else if (arg === '--to' && args[i + 1]) {
      options.to = args[++i].trim();
    } else if (arg.startsWith('--to=')) {
      options.to = arg.split('=')[1].trim();
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

async function main(argv = process.argv.slice(2)) {
  console.log('================================================================');
  console.log('       ENTERPRISE QUA - DAILY RFQ INFLOW REPORT DISPATCHER      ');
  console.log('================================================================\n');

  const options = parseArgs(argv);

  // Check database connectivity if storage is configured
  if (pool.hasStorage()) {
    const health = await pool.checkDatabaseHealth();
    if (!health.isConnected) {
      console.warn(`[WARN] Database connection warning: ${health.errorMessage}`);
    } else {
      console.log(`✔ Database connected: ${health.providerLabel} (${health.database})`);
    }

    console.log('✔ Hydrating store and syncing latest RFQs from DB...');
    await storeService.hydrateFromDB().catch(() => {});
    await storeService.syncRFQsFromDB(true).catch(() => {});
  } else {
    console.log('✔ Memory store active.');
  }

  const recipients = dailyRfqReportService.resolveRecipients(options.to);
  const targetDate = options.date || dailyRfqReportService.getYesterdayDateStr();

  console.log(`✔ Report Target Date: ${targetDate}`);
  console.log(`✔ Target Recipients:  ${recipients.join(', ')}`);
  console.log(`✔ Execution Mode:     ${options.dryRun ? 'DRY-RUN (Simulated)' : 'LIVE DISPATCH'}`);
  console.log('\nGenerating report...\n');

  try {
    const result = await dailyRfqReportService.sendDailyRfqReport({
      date: targetDate,
      recipients,
      dryRun: options.dryRun,
    });

    console.log('----------------------------------------------------------------');
    console.log(`✔ Report Status:      ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`✔ Date:               ${result.reportDate}`);
    console.log(`✔ Total Inbound RFQs: ${result.totalRFQs}`);
    console.log('✔ By Sourcing Mode:');
    Object.entries(result.summary?.bySourcingMode || {}).forEach(([mode, count]) => {
      console.log(`    - ${mode}: ${count}`);
    });
    console.log('✔ By Ingestion Channel:');
    Object.entries(result.summary?.bySource || {}).forEach(([channel, count]) => {
      console.log(`    - ${channel}: ${count}`);
    });
    if (result.messageId) {
      console.log(`✔ Message ID:         ${result.messageId}`);
    }
    console.log('----------------------------------------------------------------\n');

    return result;
  } catch (err) {
    logger.error('Failed to dispatch daily RFQ report via CLI', err, 'DAILY_RFQ_REPORT_CLI');
    console.error(`[ERROR] Report dispatch failed: ${err.message}`);
    process.exitCode = 1;
    return { success: false, error: err.message };
  }
}

if (require.main === module) {
  main().then(async () => {
    if (pool.hasStorage()) {
      await new Promise((r) => setTimeout(r, 1000));
      await pool.closePool().catch(() => {});
    }
  });
}

module.exports = { main, parseArgs };
