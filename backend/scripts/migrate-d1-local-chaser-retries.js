'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WRANGLER_ENTRY = path.join(BACKEND_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DATABASE_NAME = 'enterprise-qua-d1';
const MIGRATION_VERSION = '0015_chaser_retry_attempts';
const MIGRATION_FILE = path.join(BACKEND_ROOT, 'src', 'db', 'migrations', '0015_chaser_retry_attempts.d1.sql');

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_ENTRY, ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Local D1 migration command failed: ${result.stderr || result.stdout || result.error}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    const error = new Error('Wrangler returned invalid JSON during the local D1 migration.');
    error.cause = cause;
    throw error;
  }
}

function readCount(response) {
  const firstResult = Array.isArray(response) ? response[0] : null;
  const firstRow = firstResult && Array.isArray(firstResult.results) ? firstResult.results[0] : null;
  const count = Number(firstRow?.count);
  return Number.isFinite(count) ? count : 0;
}

function ensureLocalChaserRetryMigration({ run = runWrangler } = {}) {
  const columnResponse = run([
    'd1', 'execute', DATABASE_NAME, '--local', '--json',
    '--command', "SELECT COUNT(*) AS count FROM pragma_table_info('chaser_queue') WHERE name='attempts'",
  ]);
  const columnExists = readCount(columnResponse) > 0;
  if (!columnExists) {
    run(['d1', 'execute', DATABASE_NAME, '--local', '--file', MIGRATION_FILE]);
  }

  const ledgerResponse = run([
    'd1', 'execute', DATABASE_NAME, '--local', '--json',
    '--command', `SELECT COUNT(*) AS count FROM schema_migrations WHERE version='${MIGRATION_VERSION}'`,
  ]);
  const migrationRecorded = readCount(ledgerResponse) > 0;
  if (!migrationRecorded) {
    run([
      'd1', 'execute', DATABASE_NAME, '--local', '--command',
      `INSERT INTO schema_migrations(version, description) VALUES ('${MIGRATION_VERSION}', 'bounded chaser delivery retries')`,
    ]);
  }

  return { columnAdded: !columnExists, ledgerInserted: !migrationRecorded };
}

if (require.main === module) {
  try {
    const result = ensureLocalChaserRetryMigration();
    console.log(`[local-chaser-migration] ${result.columnAdded ? 'Added attempts column' : 'Attempts column already present'}; ${result.ledgerInserted ? 'recorded migration' : 'migration already recorded'}.`);
  } catch (error) {
    console.error(`[local-chaser-migration] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ensureLocalChaserRetryMigration, readCount };
