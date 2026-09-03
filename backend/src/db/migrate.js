#!/usr/bin/env node
// ==============================================================================
// DOMAIN DATABASE MIGRATION (Neon PostgreSQL) — vendors + RFQs
// ==============================================================================
// One-off CLI: creates the schema, then seeds it from SEED_VENDORS/SEED_RFQS.
// Idempotent (ON CONFLICT DO UPDATE via upsertVendorInDB/upsertRFQInDB), so
// rerunning it is always safe. Unlike the app's own graceful in-memory
// fallback, this script's whole purpose is to run once against a real
// connection string, so a missing DATABASE_URL is a hard failure here.
// ==============================================================================

const fs = require('fs');
const path = require('path');

// This script runs standalone (not through app.js), so .env isn't loaded
// automatically — pool.js reads DATABASE_URL from process.env at require
// time, so this must happen before that require below.
require('dotenv').config();

const pool = require('./pool');
const domainQueries = require('./domainQueries');
const { SEED_VENDORS, SEED_RFQS } = require('./seed');

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
