#!/usr/bin/env node
// =============================================================================
// D1 MIGRATION  — applies schema.d1.sql to Cloudflare D1 via the REST API
// =============================================================================
// Usage:
//   node scripts/migrate-d1.js
//   npm run db:migrate:d1
//
// Requires in .env (or environment):
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_D1_DATABASE_ID
//   CLOUDFLARE_API_TOKEN
//
// Every statement in schema.d1.sql is idempotent (CREATE TABLE/INDEX IF NOT
// EXISTS), so rerunning this is always safe — it never drops or alters rows.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ACCOUNT_ID  = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const API_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;

const SCHEMA_PATH = path.join(__dirname, '../src/db/schema.d1.sql');

const QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
const HEADERS = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type':  'application/json',
};

// Tables to report row-counts for after migration
const REPORTED_TABLES = [
  'role', 'org_types', 'master_status', 'organization', 'user',
  'category_division', 'org_division_category',
  'auth_otp_codes', 'auth_revoked_tokens',
  'vendors', 'rfqs', 'evaluations', 'vendor_catalogue',
  'buyer_accounts', 'ai_feed', 'audit_logs', 'notifications',
  'email_ingestion_log', 'zoho_oauth_token', 'payment_links',
  'vendor_ingestion_sessions', 'ingestion_jobs', 'vendor_master_records',
  'po_line_items', 'vendor_category_mappings', 'vendor_category_dispatches',
  'vendor_email_dispatch_log', 'vendor_ingestion_audit', 'ai_classification_logs',
  'bulk_vendor_import_sessions',
];

async function d1Query(sql, params = []) {
  const res  = await fetch(QUERY_URL, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ sql, params }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`D1 non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || !json.success) {
    const msg = (json.errors && json.errors[0] && json.errors[0].message) || text.slice(0, 300);
    throw new Error(`D1 query failed (${res.status}): ${msg}`);
  }
  return json;
}

function splitStatements(sql) {
  // Split on semicolons, then for each chunk:
  //   1. Strip leading/trailing whitespace
  //   2. Remove leading comment lines (-- ...)
  //   3. Keep only non-empty chunks that contain a SQL keyword
  return sql
    .split(';')
    .map((chunk) => {
      // Remove comment lines from the start of the chunk
      const lines = chunk.split('\n');
      const codeLines = [];
      let seenCode = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!seenCode && (trimmed.startsWith('--') || trimmed === '')) continue;
        seenCode = true;
        codeLines.push(line);
      }
      return codeLines.join('\n').trim();
    })
    .filter((s) => s.length > 0);
}

async function migrate() {
  if (!ACCOUNT_ID || !DATABASE_ID || !API_TOKEN) {
    console.error(
      '[migrate-d1] Missing required env vars.\n' +
      '  Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN in .env'
    );
    process.exit(1);
  }

  console.log('[migrate-d1] Reading schema.d1.sql …');
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const statements = splitStatements(schemaSql);
  console.log(`[migrate-d1] Found ${statements.length} statements to apply.`);

  let applied = 0;
  let skipped = 0;

  for (const stmt of statements) {
    // Skip pure comment blocks
    if (stmt.startsWith('--')) { skipped++; continue; }
    try {
      await d1Query(stmt);
      applied++;
      // Show a short label for each statement
      const label = stmt.replace(/\s+/g, ' ').slice(0, 80);
      process.stdout.write(`  ✓  ${label}…\n`);
    } catch (err) {
      // "table already exists" and "index already exists" are expected when the
      // IF NOT EXISTS clause is somehow not honoured (older D1 versions).
      // Treat them as warnings, not failures.
      if (/already exists/i.test(err.message)) {
        skipped++;
        process.stdout.write(`  ~  (already exists) ${stmt.replace(/\s+/g, ' ').slice(0, 60)}…\n`);
      } else {
        console.error(`\n  ✗  FAILED: ${stmt.slice(0, 200)}`);
        console.error(`     Error : ${err.message}`);
        // Continue rather than abort — log all failures
        skipped++;
      }
    }
  }

  console.log(`\n[migrate-d1] Applied: ${applied}  Skipped/already-exists: ${skipped}`);

  // Row counts
  console.log('\n[migrate-d1] Row counts:');
  for (const table of REPORTED_TABLES) {
    try {
      const res  = await d1Query(`SELECT COUNT(*) AS total FROM "${table}"`);
      const rows = res.result[0].results;
      const total = rows && rows[0] ? rows[0].total : 0;
      console.log(`  ${table.padEnd(32)} ${total}`);
    } catch (err) {
      console.log(`  ${table.padEnd(32)} unavailable (${err.message.slice(0, 60)})`);
    }
  }

  console.log('\n[migrate-d1] Done. Schema is live on Cloudflare D1.');
}

migrate().catch((err) => {
  console.error('[migrate-d1] Fatal:', err.message);
  process.exit(1);
});
