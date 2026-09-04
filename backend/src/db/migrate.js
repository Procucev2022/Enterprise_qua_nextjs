#!/usr/bin/env node
// ==============================================================================
// DOMAIN DATABASE MIGRATION (Neon PostgreSQL)
// ==============================================================================
// One-off CLI: creates the schema, then seeds all 7 domain collections
// (vendors, RFQs, evaluations, buyer accounts, audit logs, AI feed — vendor
// catalogue is deliberately not seeded, see the comment below) from the
// matching SEED_* constants. Idempotent (every upsert is ON CONFLICT DO
// UPDATE), so rerunning it is always safe. Unlike the app's own graceful
// in-memory fallback, this script's whole purpose is to run once against a
// real connection string, so a missing DATABASE_URL is a hard failure here.
// ==============================================================================

const fs = require('fs');
const path = require('path');

// This script runs standalone (not through app.js), so .env isn't loaded
// automatically — pool.js reads DATABASE_URL from process.env at require
// time, so this must happen before that require below.
require('dotenv').config();

const pool = require('./pool');
const domainQueries = require('./domainQueries');
const { SEED_VENDORS, SEED_RFQS, SEED_EVALUATIONS, SEED_BUYER_ACCOUNTS, SEED_AUDIT_LOGS, SEED_AI_FEED } = require('./seed');

async function migrate() {
  if (!pool.pool) {
    console.error('[migrate] DATABASE_URL is not set — nothing to migrate against.');
    process.exitCode = 1;
    return;
  }

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] Applying schema.sql...');
  await pool.query(schemaSql);
  console.log('[migrate] Schema applied.');

  console.log(`[migrate] Seeding ${SEED_VENDORS.length} vendor(s)...`);
  for (const vendor of SEED_VENDORS) {
    await domainQueries.upsertVendorInDB(vendor);
  }

  console.log(`[migrate] Seeding ${SEED_RFQS.length} RFQ(s)...`);
  for (const rfq of SEED_RFQS) {
    await domainQueries.upsertRFQInDB(rfq);
  }

  console.log(`[migrate] Seeding ${SEED_EVALUATIONS.length} evaluation(s)...`);
  for (const evaluation of SEED_EVALUATIONS) {
    await domainQueries.upsertEvaluationInDB(evaluation);
  }

  // Note: the 3 seeded demo catalogue products (storeService.js's
  // constructor) have no vendorId and are deliberately never written to
  // Postgres — see schema.sql's comment on vendor_catalogue.vendor_id. Real
  // products only ever arrive via addProductToCatalogue, which always
  // supplies one.

  console.log(`[migrate] Seeding ${SEED_BUYER_ACCOUNTS.length} buyer account(s)...`);
  for (const account of SEED_BUYER_ACCOUNTS) {
    await domainQueries.upsertBuyerAccountInDB(account);
  }
  if (SEED_BUYER_ACCOUNTS.length > 0) {
    // Matches the in-memory constructor's default: activeBuyerAccount starts
    // as buyerAccounts[0].
    await domainQueries.setActiveBuyerAccountInDB(SEED_BUYER_ACCOUNTS[0].id);
  }

  // SEED_AUDIT_LOGS and SEED_AI_FEED are both authored with index 0 = the
  // most recent entry (matching how the in-memory arrays are read: newest
  // first). Both ai_feed/audit_logs tables use an auto-incrementing
  // `sequence` column read back via `ORDER BY sequence DESC`, so inserting
  // in *reverse* array order makes index 0 land on the highest sequence
  // value — i.e. still "first" after hydration, matching the in-memory shape.
  console.log(`[migrate] Seeding ${SEED_AUDIT_LOGS.length} audit log entry(s)...`);
  for (const entry of [...SEED_AUDIT_LOGS].reverse()) {
    await domainQueries.upsertAuditLogInDB(entry);
  }

  console.log(`[migrate] Seeding ${SEED_AI_FEED.length} AI feed item(s)...`);
  for (const item of [...SEED_AI_FEED].reverse()) {
    await domainQueries.upsertAIFeedItemInDB(item);
  }

  console.log('[migrate] Done.');
}

/** Runs migrate() and translates its outcome into a process exit code. */
function runCli() {
  return migrate()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
      console.error('[migrate] Failed:', err.message);
      process.exit(1);
    });
}

// This branch only fires when the script is actually run as `node
// src/db/migrate.js` (or `npm run db:migrate`) — Jest never sets require.main
// to this module, so it can't be exercised by a unit test. migrate()/runCli()
// themselves are both fully covered above.
/* istanbul ignore next */
if (require.main === module) {
  runCli();
}

module.exports = { migrate, runCli };
