#!/usr/bin/env node
// ============================================================================
// PostgreSQL migrations
//
// schema.sql is the immutable bootstrap snapshot. Its checksum is recorded on
// first application; later schema changes belong in numbered *.pg.sql files.
// A PostgreSQL advisory lock prevents two deploys from applying migrations at
// the same time. Each numbered migration and its ledger entry commit together.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();

const pool = require('./pool');
const { logger } = require('../services/loggerService');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MIGRATIONS_PATH = path.join(__dirname, 'migrations');
const BASELINE_VERSION = '0000_schema_baseline';
const BASELINE_DESCRIPTION = 'initial PostgreSQL schema snapshot';
const MIGRATION_LOCK_NAMESPACE = 1702069401;
const MIGRATION_LOCK_ID = 1;

const REPORTED_TABLES = [
  'schema_migrations',
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
  'audit_chain_state',
  'event_outbox',
  'notifications',
  'vendor_ingestion_sessions',
  'ingestion_jobs',
  'vendor_master_records',
  'po_line_items',
  'vendor_category_mappings',
  'vendor_category_dispatches',
  'vendor_email_dispatch_log',
  'vendor_ingestion_audit',
  'ai_classification_logs',
  'vendor_directory_sessions',
  'vendor_presence',
  'payment_dues_communications',
  'management_approvals',
  'management_approval_events',
  'client_registration_events',
  'enterprise_inquiries',
  'zoho_webhook_events',
  'tickets',
  'ticket_activities',
  'internal_task_types',
  'internal_tasks',
  'internal_task_activities',
  'approvals',
  'vendor_categories_indexed',
  'rfq_unlocks',
  'vendor_credit_transactions',
  'buyer_credit_transactions',
  'document_vault',
  'account_documents',
  'user_login_logs',
];

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadMigrations(migrationsPath = MIGRATIONS_PATH) {
  if (!fs.existsSync(migrationsPath)) return [];

  const fileNames = fs.readdirSync(migrationsPath)
    .filter((fileName) => /^\d{4}_[a-z0-9_]+\.pg\.sql$/i.test(fileName))
    .sort();
  const versions = new Set();

  return fileNames.map((fileName) => {
    const version = fileName.replace(/\.pg\.sql$/i, '');
    if (version === BASELINE_VERSION || versions.has(version)) {
      throw new Error(`Duplicate or reserved PostgreSQL migration version: ${version}`);
    }
    versions.add(version);
    const sql = fs.readFileSync(path.join(migrationsPath, fileName), 'utf8');
    if (!sql.trim()) throw new Error(`PostgreSQL migration is empty: ${fileName}`);
    return {
      version,
      description: version.replace(/^\d{4}_/, '').replaceAll('_', ' '),
      fileName,
      sql,
      checksum: checksum(sql),
    };
  });
}

async function ensureMigrationLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) PRIMARY KEY,
      description VARCHAR(255) NOT NULL,
      checksum VARCHAR(64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)');
}

async function readAppliedMigrations(client) {
  const result = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

async function applyBaseline(client, schemaSql, schemaChecksum) {
  await client.query('BEGIN');
  try {
    await client.query(schemaSql);
    await client.query(
      'INSERT INTO schema_migrations (version, description, checksum) VALUES ($1, $2, $3)',
      [BASELINE_VERSION, BASELINE_DESCRIPTION, schemaChecksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyNumberedMigration(client, migration) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (version, description, checksum) VALUES ($1, $2, $3)',
      [migration.version, migration.description, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('PostgreSQL migration failed and was rolled back', {
      error,
      migrationVersion: migration.version,
      migrationFile: migration.fileName,
    }, 'DATABASE_MIGRATION');
    throw error;
  }
}

async function applyMigrations(client, schemaSql, migrations) {
  const applied = await readAppliedMigrations(client);
  const schemaChecksum = checksum(schemaSql);
  const knownVersions = new Set([BASELINE_VERSION, ...migrations.map(({ version }) => version)]);
  const unknownVersions = [...applied.keys()].filter((version) => !knownVersions.has(version));
  if (unknownVersions.length > 0) {
    throw new Error(`PostgreSQL contains migration versions missing from this checkout: ${unknownVersions.join(', ')}`);
  }

  if (!applied.has(BASELINE_VERSION)) {
    logger.info('Applying PostgreSQL schema baseline', {
      migrationVersion: BASELINE_VERSION,
      checksum: schemaChecksum,
    }, 'DATABASE_MIGRATION');
    await applyBaseline(client, schemaSql, schemaChecksum);
    applied.set(BASELINE_VERSION, schemaChecksum);
  } else if (applied.get(BASELINE_VERSION) !== schemaChecksum) {
    throw new Error(
      'schema.sql changed after its PostgreSQL baseline was recorded. Add a numbered *.pg.sql migration; do not edit the bootstrap snapshot.'
    );
  } else {
    logger.info('PostgreSQL schema baseline checksum matches; skipping full schema replay', {
      migrationVersion: BASELINE_VERSION,
      checksum: schemaChecksum,
    }, 'DATABASE_MIGRATION');
  }

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      if (applied.get(migration.version) !== migration.checksum) {
        throw new Error(
          `PostgreSQL migration checksum mismatch for ${migration.version}. Applied migrations are immutable.`
        );
      }
      continue;
    }

    logger.info('Applying PostgreSQL migration', {
      migrationVersion: migration.version,
      migrationFile: migration.fileName,
      checksum: migration.checksum,
    }, 'DATABASE_MIGRATION');
    await applyNumberedMigration(client, migration);
    applied.set(migration.version, migration.checksum);
  }

}

async function reportRowCounts() {
  console.log('\n[migrate] Row counts:');
  for (const table of REPORTED_TABLES) {
    try {
      const result = await pool.query(`select count(*) as total from "${table}"`);
      console.log(`  ${table.padEnd(24)} ${result.rows[0].total}`);
    } catch (error) {
      logger.error('PostgreSQL migration row-count report failed', {
        error,
        table,
      }, 'DATABASE_MIGRATION');
      console.log(`  ${table.padEnd(24)} unavailable (${error.message})`);
    }
  }
}

async function migrate({ reportCounts = false, migrationsPath = MIGRATIONS_PATH } = {}) {
  if (!pool.pool) {
    logger.error('PostgreSQL migration cannot run because DATABASE_URL is not configured', {}, 'DATABASE_MIGRATION');
    process.exitCode = 1;
    return;
  }

  const client = await pool.pool.connect();
  let lockAcquired = false;
  let migrationFailure = null;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
    lockAcquired = true;
    logger.info('PostgreSQL migration lock acquired', {}, 'DATABASE_MIGRATION');
    await ensureMigrationLedger(client);

    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const migrations = loadMigrations(migrationsPath);
    await applyMigrations(client, schemaSql, migrations);

    if (reportCounts) await reportRowCounts();
    logger.info('PostgreSQL migrations completed', {
      baselineVersion: BASELINE_VERSION,
      numberedMigrationCount: migrations.length,
      rowCountsReported: reportCounts,
    }, 'DATABASE_MIGRATION');
    console.log('\n[migrate] Done. No seed data is written — records come from real use.');
    console.log('[migrate] To create a first sign-in account: node scripts/create-buyer.js --help');
  } catch (error) {
    migrationFailure = error;
    logger.error('PostgreSQL migration failed', { error }, 'DATABASE_MIGRATION');
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_ID]);
        logger.info('PostgreSQL migration lock released', {}, 'DATABASE_MIGRATION');
      }
    } catch (unlockError) {
      logger.error('PostgreSQL migration lock release failed', { error: unlockError }, 'DATABASE_MIGRATION');
      if (!migrationFailure) throw unlockError;
    } finally {
      client.release();
    }
  }
}

/** Runs migrate() and translates its outcome to a process exit code. */
function runCli(argv = process.argv.slice(2)) {
  return migrate({ reportCounts: argv.includes('--report-row-counts') })
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      logger.error('PostgreSQL migration command failed', { error }, 'DATABASE_MIGRATION');
      console.error('[migrate] Failed:', error.message);
      process.exit(1);
    });
}

/* istanbul ignore next */
if (require.main === module) {
  runCli();
}

module.exports = {
  migrate,
  runCli,
  reportRowCounts,
  REPORTED_TABLES,
  BASELINE_VERSION,
  checksum,
  loadMigrations,
};
