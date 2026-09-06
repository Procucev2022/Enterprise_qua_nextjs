#!/usr/bin/env node
// ==============================================================================
// DATABASE MIGRATION (Neon PostgreSQL)
// ==============================================================================
// Applies schema.sql. That is the whole job.
//
// It used to also seed six collections from SEED_* constants, which is why it was
// broken: it destructured SEED_RFQS, SEED_BUYER_ACCOUNTS, SEED_AUDIT_LOGS and
// SEED_AI_FEED from a module that had stopped exporting them, so every run threw
// a TypeError immediately after applying the schema. The seed data is gone
// entirely now — the whole point of this change is that the database contains
// records that are real or contains none — so there is nothing left to seed and
// nothing left to break.
//
// Every statement is idempotent (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS),
// so rerunning it is always safe and never destructive: it will not drop a table,
// alter a column or delete a row.
//
// Unlike the application, which logs and degrades when DATABASE_URL is missing,
// this script's whole purpose is to run against a real connection string, so an
// absent one is a hard failure.
// ==============================================================================

const fs = require('fs');
const path = require('path');

// This script runs standalone (not through app.js), so .env isn't loaded
// automatically — pool.js reads DATABASE_URL from process.env at require time, so
// this must happen before that require below.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const pool = require('./pool');

// Reported after the migration so the operator can see what the schema is holding
// rather than assuming an empty database means the migration failed.
const REPORTED_TABLES = [
  'role',
  'org_types',
  'master_status',
  'organization',
  'user',
  'category_division',
  'org_division_category',
  'auth_otp_codes',
  'auth_revoked_tokens',
  'vendors',
  'rfqs',
  'evaluations',
  'vendor_catalogue',
  'buyer_accounts',
  'ai_feed',
  'audit_logs',
  'notifications',
];

async function reportRowCounts() {
  console.log('\n[migrate] Row counts:');
  for (const table of REPORTED_TABLES) {
    try {
      const result = await pool.query(`select count(*) as total from "${table}"`);
      console.log(`  ${table.padEnd(24)} ${result.rows[0].total}`);
    } catch (err) {
      console.log(`  ${table.padEnd(24)} unavailable (${err.message})`);
    }
  }
}

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

  await reportRowCounts();

  console.log('\n[migrate] Done. No seed data is written — records come from real use.');
  console.log('[migrate] To create a first sign-in account: node scripts/create-buyer.js --help');
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

module.exports = { migrate, runCli, reportRowCounts, REPORTED_TABLES };
