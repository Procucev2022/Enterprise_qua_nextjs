#!/usr/bin/env node
// ==============================================================================
// DOMAIN DATABASE VIEWER (Neon PostgreSQL) — vendors + RFQs
// ==============================================================================
// Read-only CLI: prints what's actually in Neon right now, so you can check it
// without leaving the terminal or writing a one-off query. Never mutates
// anything.
// ==============================================================================

// Standalone script — same reasoning as migrate.js: .env isn't loaded
// automatically outside app.js, and this must happen before requiring ./pool.
require('dotenv').config();

const pool = require('./pool');

function printSummaryTable(title, rows, columns) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  console.table(
    rows.map((row) => {
      const picked = {};
      columns.forEach((col) => {
        picked[col] = row[col];
      });
      return picked;
    })
  );
}

async function view() {
  if (!pool.pool) {
    console.error('[db:view] DATABASE_URL is not set — nothing to view.');
    process.exitCode = 1;
    return;
  }

  const health = await pool.checkDomainDBHealth();
  console.log(`[db:view] Connected to ${health.providerLabel} (${health.poolStatus})`);

  const vendors = await pool.query(
    'SELECT id, email, major_category, status, source, created_at, raw FROM vendors ORDER BY created_at DESC'
  );
  const rfqs = await pool.query(
    'SELECT id, rfq_number, category, status, sourcing_mode, budget, created_at, raw FROM rfqs ORDER BY created_at DESC'
  );

  printSummaryTable('Vendors', vendors.rows, ['id', 'email', 'major_category', 'status', 'source', 'created_at']);
  printSummaryTable('RFQs', rfqs.rows, ['id', 'rfq_number', 'category', 'status', 'sourcing_mode', 'budget', 'created_at']);

  console.log('\n[db:view] Full stored records (the `raw` JSONB column each row hydrates from):');
  console.log('\n--- Vendors (raw) ---');
  console.log(JSON.stringify(vendors.rows.map((r) => r.raw), null, 2));
  console.log('\n--- RFQs (raw) ---');
  console.log(JSON.stringify(rfqs.rows.map((r) => r.raw), null, 2));
}

/** Runs view() and translates its outcome into a process exit code. */
function runCli() {
  return view()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
      console.error('[db:view] Failed:', err.message);
      process.exit(1);
    });
}

// This branch only fires when the script is actually run as `node
// src/db/view.js` (or `npm run db:view`) — Jest never sets require.main to
// this module, so it can't be exercised by a unit test. view()/runCli()
// themselves are both fully covered above.
/* istanbul ignore next */
if (require.main === module) {
  runCli();
}

module.exports = { view, runCli };
