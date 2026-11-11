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
// The first run applies schema.d1.sql and records its checksum. Later runs
// skip the full DDL replay and apply only immutable, numbered migrations.
// A conditional lease row serializes migrators across processes; crashed leases
// become reclaimable after five minutes and are renewed while a migration runs.
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../src/services/loggerService');

const targetEnv = process.argv.includes('--prod')
  ? 'prod'
  : (process.argv.includes('--dev') ? 'dev' : (process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev')));
const envSpecific = path.resolve(__dirname, `../.env.${targetEnv}`);
if (fs.existsSync(envSpecific)) {
  require('dotenv').config({ path: envSpecific });
}
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function resolveD1Config({ target = targetEnv, wranglerPath = path.resolve(__dirname, '../wrangler.jsonc') } = {}) {
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || null;
  let databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || null;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || null;

  if (!databaseId || !accountId) {
    try {
      if (fs.existsSync(wranglerPath)) {
        const raw = fs.readFileSync(wranglerPath, 'utf8');
        const sanitized = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const config = JSON.parse(sanitized);
        if (!databaseId) {
          databaseId = (target && config.env?.[target]?.d1_databases?.[0]?.database_id)
            || config.d1_databases?.[0]?.database_id
            || null;
        }
        if (!accountId) {
          accountId = (target && config.env?.[target]?.account_id)
            || config.account_id
            || null;
        }
      }
    } catch {
      // Fall back to environment values
    }
  }

  return { accountId, databaseId, apiToken };
}

const { accountId: ACCOUNT_ID, databaseId: DATABASE_ID, apiToken: API_TOKEN } = resolveD1Config();

const SCHEMA_PATH = path.join(__dirname, '../src/db/schema.d1.sql');
const MIGRATIONS_PATH = path.join(__dirname, '../src/db/migrations');
const MIGRATION_LOCK_KEY = 'd1-schema-migrations';
const MIGRATION_LOCK_LEASE_SECONDS = 300;
const MIGRATION_LOCK_RENEWAL_MS = 60_000;

const QUERY_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
const HEADERS = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json',
};

// Tables to report row-counts for after migration
const REPORTED_TABLES = [
  'schema_migrations',
  'role', 'org_types', 'master_status', 'organization', 'user',
  'category_division', 'org_division_category', 'vendor_dispatch_templates',
  'auth_otp_codes', 'auth_revoked_tokens',
  'vendors', 'rfqs', 'evaluations', 'vendor_catalogue',
  'buyer_accounts', 'ai_feed', 'audit_logs', 'audit_chain_state', 'event_outbox', 'notifications',
  'email_ingestion_log', 'zoho_oauth_token', 'payment_links',
  'vendor_ingestion_sessions', 'ingestion_jobs', 'vendor_master_records',
  'po_line_items', 'vendor_category_mappings', 'vendor_category_dispatches',
  'vendor_email_dispatch_log', 'vendor_ingestion_audit', 'ai_classification_logs',
  'bulk_vendor_import_sessions', 'vendor_directory_sessions', 'user_login_logs',
  'payment_dues_communications',
  'schema_migration_locks',
  'management_approvals',
  'management_approval_events',
  'client_registration_events',
  'enterprise_inquiries',
  'zoho_webhook_events',
  'chaser_queue', 'rfq_unlocks',
  'vendor_credit_transactions', 'buyer_credit_transactions',
  'tickets', 'ticket_activities', 'internal_task_types',
  'internal_tasks', 'internal_task_activities', 'approvals',
  'system_error_logs', 'vendor_categories_indexed', 'document_vault', 'account_documents',
];

async function d1Query(sql, params = []) {
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sql, params }),
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

function splitStatements(sql = '') {
  const statements = [];
  const prefixTokens = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let trigger = false;
  let triggerBody = false;
  let caseDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        current += '\n';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        current += ' ';
        index += 1;
      }
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        if (next === quote && quote !== ']') {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '[') {
      quote = ']';
      current += character;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end += 1;
      const word = sql.slice(index, end);
      const upperWord = word.toUpperCase();
      if (!trigger && prefixTokens.length < 3) {
        prefixTokens.push(upperWord);
        trigger = prefixTokens[0] === 'CREATE'
          && (prefixTokens[1] === 'TRIGGER'
            || ((prefixTokens[1] === 'TEMP' || prefixTokens[1] === 'TEMPORARY') && prefixTokens[2] === 'TRIGGER'));
      }
      if (trigger && upperWord === 'BEGIN' && !triggerBody) {
        triggerBody = true;
      } else if (triggerBody && upperWord === 'CASE') {
        caseDepth += 1;
      } else if (triggerBody && upperWord === 'END') {
        if (caseDepth > 0) caseDepth -= 1;
        else triggerBody = false;
      }
      current += sql.slice(index, end);
      index = end - 1;
      continue;
    }

    if (character === ';' && !triggerBody) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      prefixTokens.length = 0;
      trigger = false;
      triggerBody = false;
      caseDepth = 0;
      continue;
    }
    current += character;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

function resultRows(response) {
  const result = Array.isArray(response?.result) ? response.result[0] : response?.result;
  return Array.isArray(result?.results) ? result.results : [];
}

async function acquireMigrationLock(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migration_locks (
      lock_key TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      lease_expires_at INTEGER NOT NULL
    )
  `);
  const ownerToken = crypto.randomUUID();
  const acquired = resultRows(await query(`
    INSERT INTO schema_migration_locks (lock_key, owner_token, lease_expires_at)
    VALUES (?, ?, unixepoch() + ?)
    ON CONFLICT(lock_key) DO UPDATE SET
      owner_token = excluded.owner_token,
      lease_expires_at = excluded.lease_expires_at
    WHERE schema_migration_locks.lease_expires_at <= unixepoch()
    RETURNING owner_token
  `, [MIGRATION_LOCK_KEY, ownerToken, MIGRATION_LOCK_LEASE_SECONDS]));

  if (acquired[0]?.owner_token !== ownerToken) {
    throw new Error('Another D1 migration holds the lock. Wait for it to finish or for its 5-minute lease to expire before retrying.');
  }

  let lostError = null;
  const assertOwned = () => {
    if (lostError) throw new Error(`D1 migration lock was lost: ${lostError.message}`);
  };
  const guardedQuery = async (sql, params = []) => {
    assertOwned();
    return query(sql, params);
  };
  const renewalTimer = setInterval(async () => {
    try {
      const renewed = resultRows(await query(`
        UPDATE schema_migration_locks
        SET lease_expires_at = unixepoch() + ?
        WHERE lock_key = ? AND owner_token = ?
        RETURNING owner_token
      `, [MIGRATION_LOCK_LEASE_SECONDS, MIGRATION_LOCK_KEY, ownerToken]));
      if (renewed[0]?.owner_token !== ownerToken) {
        lostError = new Error('lease renewal did not find this migration owner');
      }
    } catch (error) {
      lostError = error;
    }
  }, MIGRATION_LOCK_RENEWAL_MS);
  renewalTimer.unref?.();

  return {
    query: guardedQuery,
    assertOwned,
    async release() {
      clearInterval(renewalTimer);
      await query(
        'DELETE FROM schema_migration_locks WHERE lock_key = ? AND owner_token = ?',
        [MIGRATION_LOCK_KEY, ownerToken]
      );
    },
  };
}

async function applyD1Migrations({ query = d1Query, migrationsPath = MIGRATIONS_PATH } = {}) {
  if (!fs.existsSync(migrationsPath)) return { applied: 0, skipped: 0 };
  const files = fs.readdirSync(migrationsPath)
    .filter((file) => /^\d+_[\w-]+\.d1\.sql$/i.test(file))
    .sort();
  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const version = file.replace(/\.d1\.sql$/i, '');
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const existingRows = resultRows(await query(
      'SELECT checksum FROM schema_migrations WHERE version = ?',
      [version]
    ));
    if (existingRows.length > 0) {
      const existingChecksum = existingRows[0].checksum;
      if (existingChecksum && existingChecksum !== checksum) {
        throw new Error(`D1 migration checksum mismatch for ${version}; create a new migration instead of editing an applied migration.`);
      }
      if (!existingChecksum) {
        await query('UPDATE schema_migrations SET checksum = ? WHERE version = ?', [checksum, version]);
      }
      skipped += 1;
      continue;
    }

    const statements = splitStatements(sql);
    for (const statement of statements) {
      try {
        await query(statement);
      } catch (error) {
        const addedColumn = statement.match(/^\s*ALTER\s+TABLE\s+["`]?([\w]+)["`]?\s+ADD\s+COLUMN\s+["`]?([\w]+)/i);
        const duplicateColumn = String(error?.message || '').match(/duplicate column name:\s*["`]?([\w]+)/i);
        if (!addedColumn || !duplicateColumn || addedColumn[2].toLowerCase() !== duplicateColumn[1].toLowerCase()) {
          throw error;
        }
        logger.info('D1 migration column already exists; skipping idempotent add', {
          migrationVersion: version,
          table: addedColumn[1],
          column: addedColumn[2],
        }, 'DATABASE_MIGRATION');
      }
    }

    const description = version.replace(/^\d+_/, '').replaceAll('_', ' ');
    await query(
      'INSERT INTO schema_migrations (version, description, checksum) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
      [version, description, checksum]
    );
    const recordedRows = resultRows(await query(
      'SELECT checksum FROM schema_migrations WHERE version = ?',
      [version]
    ));
    if (recordedRows[0]?.checksum !== checksum) {
      throw new Error(`D1 migration ${version} did not persist its checksum.`);
    }
    applied += 1;
  }

  return { applied, skipped };
}

function schemaChecksum(sql) {
  return crypto.createHash('sha256').update(splitStatements(sql).join(';\n')).digest('hex');
}

async function getSchemaBaseline(query = d1Query) {
  try {
    return resultRows(await query(
      'SELECT checksum FROM schema_migrations WHERE version = ?',
      ['0000_schema_baseline']
    ))[0] || null;
  } catch (error) {
    if (/no such table:\s*schema_migrations/i.test(error.message)) return null;
    throw error;
  }
}

async function recordSchemaBaseline(query, checksum) {
  await query(
    'INSERT INTO schema_migrations (version, description, checksum) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
    ['0000_schema_baseline', 'initial schema baseline', checksum]
  );
  const recorded = await getSchemaBaseline(query);
  if (recorded?.checksum !== checksum) {
    throw new Error('The D1 schema baseline checksum was not recorded consistently.');
  }
}

async function reportRowCounts(query = d1Query) {

  console.log('\n[migrate-d1] Row counts:');
  for (const table of REPORTED_TABLES) {
    try {
      const rows = resultRows(await query(`SELECT COUNT(*) AS total FROM "${table}"`));
      const total = rows[0] ? rows[0].total : 0;
      console.log(`  ${table.padEnd(32)} ${total}`);
    } catch (err) {
      console.log(`  ${table.padEnd(32)} unavailable (${err.message.slice(0, 60)})`);
    }
  }
}

async function migrate({
  query = d1Query,
  schemaPath = SCHEMA_PATH,
  migrationsPath = MIGRATIONS_PATH,
  includeRowCounts = process.argv.includes('--report-row-counts'),
  requireCredentials = true,
  credentials = { accountId: ACCOUNT_ID, databaseId: DATABASE_ID, apiToken: API_TOKEN },
} = {}) {
  const accountId = credentials?.accountId;
  const databaseId = credentials?.databaseId;
  const apiToken = credentials?.apiToken;

  if (requireCredentials && (!accountId || !databaseId || !apiToken)) {
    console.error(
      '[migrate-d1] Missing required env vars.\n' +
      '  Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN in .env'
    );
    process.exitCode = 1;
    return { applied: 0, skipped: 0, failures: [] };
  }

  let applied = 0;
  let skipped = 0;
  const failures = [];

  let migrationLock;
  try {
    migrationLock = await acquireMigrationLock(query);
    logger.info('D1 migration lease acquired', {
      leaseSeconds: MIGRATION_LOCK_LEASE_SECONDS,
      renewalIntervalMs: MIGRATION_LOCK_RENEWAL_MS,
    }, 'DATABASE_MIGRATION');
  } catch (error) {
    logger.error('Could not acquire D1 migration lease', { error }, 'DATABASE_MIGRATION');
    console.error(`[migrate-d1] Could not acquire migration lock: ${error.message}`);
    process.exitCode = 1;
    failures.push({ statement: 'migration lock', message: error.message });
    return { applied, skipped, failures };
  }

  try {
    const migrationQuery = migrationLock.query;
    try {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      const currentChecksum = schemaChecksum(schemaSql);
      const baseline = await getSchemaBaseline(migrationQuery);
      if (baseline) {
        if (baseline.checksum !== currentChecksum) {
          throw new Error('schema.d1.sql changed after the recorded baseline. Add a new numbered migration instead of replaying the full schema.');
        }
        console.log('[migrate-d1] Schema baseline matches; skipping the full schema replay.');
      } else {
        console.log('');
        const statements = splitStatements(schemaSql);
        console.log(`[migrate-d1] Found ${statements.length} schema statements to apply.`);

        for (const stmt of statements) {
          try {
            await migrationQuery(stmt);
            applied++;
            const label = stmt.replace(/\s+/g, ' ').slice(0, 80);
            process.stdout.write(`  ✓  ${label}…\n`);
          } catch (err) {
            if (/already exists/i.test(err.message)) {
              skipped++;
              process.stdout.write(`  ~  (already exists) ${stmt.replace(/\s+/g, ' ').slice(0, 60)}…\n`);
            } else {
              failures.push({ statement: stmt, message: err.message });
              console.error(`\n  ✗  FAILED: ${stmt.slice(0, 200)}`);
              console.error(`     Error : ${err.stack || err.message}`);
              skipped++;
            }
          }
        }

        console.log(`\n[migrate-d1] Applied: ${applied}  Skipped/already-exists: ${skipped}`);
        if (failures.length === 0) await recordSchemaBaseline(migrationQuery, currentChecksum);
      }
    } catch (err) {
      failures.push({ statement: 'schema baseline', message: err.message });
      console.error(`\n[migrate-d1] Schema baseline failed: ${err.stack || err.message}`);
    }

    if (failures.length > 0) {
      console.error(`\n[migrate-d1] FAILED: ${failures.length} schema statement(s) did not apply.`);
      process.exitCode = 1;
      if (includeRowCounts) await reportRowCounts(migrationQuery);
      return { applied, skipped, failures };
    }

    let migrationSummary;
    try {
      migrationSummary = await applyD1Migrations({ query: migrationQuery, migrationsPath });
      console.log(`[migrate-d1] Numbered migrations applied: ${migrationSummary.applied}; already applied: ${migrationSummary.skipped}.`);
    } catch (err) {
      console.error('\n[migrate-d1] Numbered migration failed. The base schema may be present; fix the migration error and rerun safely.');
      console.error(`     Error : ${err.stack || err.message}`);
      process.exitCode = 1;
      failures.push({ statement: 'numbered migration', message: err.message });
    }

    if (includeRowCounts) {
      await reportRowCounts(migrationQuery);
    } else {
      console.log('[migrate-d1] Row-count scans skipped to avoid repeated full-table reads; pass --report-row-counts when needed.');
    }
    migrationLock.assertOwned();
    if (failures.length > 0) return { applied, skipped, failures, migrations: migrationSummary };
    console.log('\n[migrate-d1] Done. Schema is live on Cloudflare D1.');
    return { applied, skipped, failures, migrations: migrationSummary };
  } finally {
    try {
      await migrationLock.release();
      logger.info('D1 migration lease released', {}, 'DATABASE_MIGRATION');
    } catch (error) {
      logger.error('Could not release D1 migration lease', { error }, 'DATABASE_MIGRATION');
      console.error(`[migrate-d1] Could not release migration lock: ${error.message}`);
      process.exitCode = 1;
      failures.push({ statement: 'migration lock release', message: error.message });
    }
  }
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: npm run db:migrate:d1 -- [--dev|--prod] [--report-row-counts]');
    console.log('Applies schema.d1.sql and pending numbered migrations to the selected remote D1 database.');
  } else {
    migrate().catch((err) => {
      console.error('[migrate-d1] Fatal:', err.stack || err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  applyD1Migrations,
  d1Query,
  getSchemaBaseline,
  migrate,
  recordSchemaBaseline,
  reportRowCounts,
  resultRows,
  schemaChecksum,
  splitStatements,
  REPORTED_TABLES,
  acquireMigrationLock,
  resolveD1Config,
};
