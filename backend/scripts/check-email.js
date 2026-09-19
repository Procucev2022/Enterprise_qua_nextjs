#!/usr/bin/env node
// ==============================================================================
// CHECK INBOUND REQUISITION & QUOTATION EMAILS (DUAL INBOX)
// ==============================================================================
// Connects to both configured mailboxes:
//   1. Buyer Requisitions Mailbox: rfq@procucev.com (rfqprocucev@gmail.com)
//   2. Vendor Quotations Mailbox: srinu20252026@gmail.com
//
// Fetches unread emails, evaluates buyer authorization or vendor quotation validity:
//   - Authorized buyer -> extracts line items with Gemini AI & creates RFQ in 'Parsing'
//   - Unauthorized buyer -> blocks RFQ & dispatches registration notification email
//   - Vendor quote reply -> parses quotation, updates RFQ, dispatches acknowledgements
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
  console.log('     ENTERPRISE QUA - DUAL-INBOX EMAIL POLLING & CHECK (LOCAL)  ');
  console.log('================================================================\n');

  // Check DB health
  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`[ERROR] Database unavailable: ${health.errorMessage}`);
    return health;
  }
  console.log(`✔ Database connected: ${health.providerLabel} (${health.database})`);

  // Hydrate store so buyer accounts and vendors are loaded
  console.log('✔ Hydrating buyer accounts and domain data...');
  await storeService.hydrateFromDB();
  console.log(`✔ Loaded ${(storeService.buyerAccounts || []).length} buyer accounts from database.`);

  // Check gateway status for both mailboxes
  const status = await emailGatewayService.getStatus();
  console.log(`✔ Inbox 1 (Requisitions): ${status.mailboxUser || 'Not configured'} (${status.host || 'N/A'}) - Address: ${status.gatewayAddress || 'N/A'}`);
  console.log(`✔ Inbox 2 (Quotations):   ${status.vendorGateway?.mailboxUser || 'Not configured'} (${status.vendorGateway?.host || 'N/A'}) - Address: ${status.vendorGateway?.gatewayAddress || 'N/A'}`);

  console.log('\nExecuting dual-inbox scan for unread emails...\n');
  const result = await emailGatewayService.pollBothInboxesOnce();

  // 1. Report Inbox 1 Results (Requisitions)
  console.log('----------------------------------------------------------------');
  console.log(`[INBOX 1: ${result.buyerMailbox.address || 'Requisitions'}]`);
  if (result.buyerMailbox.skipped) {
    console.log(`  Status: Skipped (${result.buyerMailbox.reason})`);
  } else if (result.buyerMailbox.error) {
    console.log(`  Status: Error (${result.buyerMailbox.error})`);
  } else {
    console.log(`  Considered: ${result.buyerMailbox.considered || 0}`);
    console.log(`  Ingested:   ${result.buyerMailbox.ingested || 0}`);
    console.log(`  Pending:    ${result.buyerMailbox.pending || 0}`);
    if (result.buyerMailbox.outcomes && result.buyerMailbox.outcomes.length > 0) {
      result.buyerMailbox.outcomes.forEach((o, i) => {
        console.log(`    ${i + 1}. UID: ${o.uid} | Message-ID: ${o.messageId || 'N/A'} | Status: ${o.status}`);
      });
    } else {
      console.log('  No new unseen messages.');
    }
  }

  // 2. Report Inbox 2 Results (Vendor Quotations)
  console.log('\n----------------------------------------------------------------');
  console.log(`[INBOX 2: ${result.vendorMailbox.address || 'Vendor Quotations'}]`);
  if (result.vendorMailbox.skipped) {
    console.log(`  Status: Skipped (${result.vendorMailbox.reason})`);
  } else if (result.vendorMailbox.error) {
    console.log(`  Status: Error (${result.vendorMailbox.error})`);
  } else {
    console.log(`  Considered: ${result.vendorMailbox.considered || 0}`);
    console.log(`  Ingested:   ${result.vendorMailbox.ingested || 0}`);
    console.log(`  Pending:    ${result.vendorMailbox.pending || 0}`);
    if (result.vendorMailbox.outcomes && result.vendorMailbox.outcomes.length > 0) {
      result.vendorMailbox.outcomes.forEach((o, i) => {
        console.log(`    ${i + 1}. UID: ${o.uid} | Message-ID: ${o.messageId || 'N/A'} | Status: ${o.status}`);
      });
    } else {
      console.log('  No new unseen messages.');
    }
  }

  // Show recent ledger entries
  const recent = await emailGatewayQueries.listRecent(5);
  if (recent.length > 0) {
    console.log('\n================================================================');
    console.log('Recent Ingestion Ledger:');
    recent.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.status}] From: ${r.fromAddress || 'N/A'} | Subject: "${r.subject || 'N/A'}" | ${r.detail || ''}`);
    });
  }

  console.log('\n================================================================');
  console.log(`✔ Scan complete: ${result.totalIngested} ingested of ${result.totalConsidered} considered.`);
  console.log('================================================================\n');

  try {
    await pool.closePool();
  } catch (_) {}

  return result;
}

if (require.main === module) {
  main().then((res) => {
    if (res && res.isConnected === false) {
      process.exitCode = 1;
    }
  }).catch((err) => {
    console.error('Fatal error during email check:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
