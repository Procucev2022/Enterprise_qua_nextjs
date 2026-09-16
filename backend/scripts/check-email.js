#!/usr/bin/env node
// ==============================================================================
// CHECK INBOUND REQUISITION EMAILS & CREATE RFQ
// ==============================================================================
// Connects to the configured mailbox (rfqprocucev@gmail.com) via IMAP, fetches
// unread requisition emails, evaluates buyer authorization, and processes each:
//   - Authorized buyer -> extracts line items with Gemini AI & creates RFQ in 'Parsing'
//   - Unauthorized buyer -> blocks RFQ & dispatches registration notification email
//
// Usage:
//   node scripts/check-email.js
//   npm run email:check
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');

async function main() {
  console.log('================================================================');
  console.log('       ENTERPRISE QUA - CHECK EMAIL & CREATE RFQ (LOCAL)        ');
  console.log('================================================================\n');

  // Check DB health
  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`[ERROR] Database unavailable: ${health.errorMessage}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✔ Database connected: ${health.providerLabel} (${health.database})`);

  // Hydrate store so buyer accounts are loaded
  console.log('✔ Hydrating buyer accounts and domain data...');
  await storeService.hydrateFromDB();
  console.log(`✔ Loaded ${storeService.buyerAccounts.length} buyer accounts from database.`);

  // Check gateway configuration
  const status = await emailGatewayService.getStatus();
  if (!status.configured) {
    console.error('[ERROR] Email gateway is not configured in .env.');
    process.exitCode = 1;
    return;
  }
  console.log(`✔ Mailbox: ${status.mailboxUser} (${status.host})`);
  console.log(`✔ Intake address: ${status.gatewayAddress}`);

  console.log('\nScanning mailbox for unread requisition emails...\n');
  const result = await emailGatewayService.pollOnce();

  if (result.skipped) {
    console.log(`[INFO] Mailbox scan skipped: ${result.reason}`);
    return;
  }

  console.log('Scan completed:');
  console.log(`  - Considered: ${result.considered}`);
  console.log(`  - Ingested as RFQ: ${result.ingested}`);
  console.log(`  - Pending in mailbox: ${result.pending}`);

  if (result.outcomes && result.outcomes.length > 0) {
    console.log('\nMessage Outcomes:');
    result.outcomes.forEach((o, i) => {
      console.log(`  ${i + 1}. UID: ${o.uid} | Message-ID: ${o.messageId || 'N/A'} | Status: ${o.status}`);
    });
  } else {
    console.log('\nNo new unseen requisition emails in mailbox.');
  }

  // Show recent ledger entries
  const recent = await emailGatewayQueries.listRecent(5);
  if (recent.length > 0) {
    console.log('\nRecent Email Gateway Ingestion Ledger:');
    recent.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.status}] From: ${r.fromAddress || 'N/A'} | Subject: "${r.subject || 'N/A'}" | ${r.detail || ''}`);
    });
  }

  console.log('\n================================================================');
  console.log('✔ Email check completed successfully.');
  console.log('================================================================\n');

  try {
    await pool.end();
  } catch (_) {}
}

main().catch((err) => {
  console.error('Fatal error during email check:', err);
  process.exitCode = 1;
});
