#!/usr/bin/env node
// ==============================================================================
// SEED THE PROCUREMENT CATEGORY TAXONOMY (category_division)
// ==============================================================================
// Loads (division, category) pairs from a JSON file and inserts them into
// category_division in file order, so created_ts ordering reproduces the
// source spreadsheet's division/category order (see
// buyerProfileQueries.findCategoryTaxonomy, which orders by earliest
// created_ts per division).
//
// Usage:
//   node scripts/seed-category-taxonomy.js /path/to/pairs.json
//
// pairs.json: [["Civil Works", "Painting"], ["Civil Works", "Piling"], ...]
//
// Refuses to run if category_division already has rows — this table has no
// natural per-row idempotency key, so re-running against a populated table
// would duplicate every row. Delete/confirm intentionally first if you really
// mean to reseed.
// ==============================================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const crypto = require('crypto');
const pool = require('../src/db/pool');

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/seed-category-taxonomy.js /path/to/pairs.json');
    process.exitCode = 1;
    return;
  }

  const pairs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(pairs) || pairs.length === 0) {
    console.error('No pairs found in the given file.');
    process.exitCode = 1;
    return;
  }

  const health = await pool.checkDatabaseHealth();
  if (!health.isConnected) {
    console.error(`Database unavailable: ${health.errorMessage}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Database: ${health.providerLabel} — ${health.database}`);

  const existing = await pool.rows('select count(*) from category_division');
  const existingCount = Number(existing[0].count);
  if (existingCount > 0) {
    console.error(
      `category_division already has ${existingCount} row(s) — refusing to reseed. ` +
        'Delete/confirm intentionally first if you really mean to reseed.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Inserting ${pairs.length} (division, category) pairs...`);
  // Sequential, not batched: created_ts (DEFAULT now()) must increase in
  // spreadsheet order for findCategoryTaxonomy's ordering to reproduce it.
  for (const [division, category] of pairs) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query('insert into category_division (uuid, division, category, is_active) values ($1, $2, $3, true)', [
      crypto.randomUUID(),
      String(division).trim(),
      String(category).trim(),
    ]);
  }

  const final = await pool.rows('select count(*) from category_division');
  console.log(`Done. category_division now has ${final[0].count} row(s).`);
}

main()
  .catch((err) => {
    console.error('Failed to seed category taxonomy:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.closePool().catch(() => {}));
