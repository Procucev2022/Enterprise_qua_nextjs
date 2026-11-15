'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WRANGLER_ENTRY = path.join(BACKEND_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DATABASE_NAME = 'enterprise-qua-d1';
const MIGRATION_VERSION = '0017_audit_chain_integrity_anchors';
const MIGRATION_FILE = path.join(BACKEND_ROOT, 'src', 'db', 'migrations', '0017_audit_chain_integrity_anchors.d1.sql');

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_ENTRY, ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Local D1 audit-chain migration failed: ${result.stderr || result.stdout || result.error}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    const error = new Error('Wrangler returned invalid JSON during the local audit-chain migration.');
    error.cause = cause;
    throw error;
  }
}

function responseRows(response) {
  const firstResult = Array.isArray(response) ? response[0] : null;
  return Array.isArray(firstResult?.results) ? firstResult.results : [];
}

function migrationStatements(sql) {
  return sql.split(';').map((statement) => statement.trim()).filter(Boolean);
}

function ensureLocalAuditChainVerificationMigration({ run = runWrangler } = {}) {
  const columnResponse = run([
    'd1', 'execute', DATABASE_NAME, '--local', '--json',
    '--command', "SELECT name FROM pragma_table_info('audit_chain_state')",
  ]);
  const columns = new Set(responseRows(columnResponse).map((row) => row.name));
  let addedColumns = 0;
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  for (const statement of migrationStatements(sql)) {
    const addColumn = /^ALTER TABLE audit_chain_state ADD COLUMN (\w+)/i.exec(statement);
    if (addColumn) {
      const column = addColumn[1];
      if (columns.has(column)) continue;
      run(['d1', 'execute', DATABASE_NAME, '--local', '--json', '--command', statement]);
      columns.add(column);
      addedColumns += 1;
      continue;
    }
    run(['d1', 'execute', DATABASE_NAME, '--local', '--json', '--command', statement]);
  }

  const ledgerRows = responseRows(run([
    'd1', 'execute', DATABASE_NAME, '--local', '--json',
    '--command', `SELECT version FROM schema_migrations WHERE version='${MIGRATION_VERSION}'`,
  ]));
  const ledgerInserted = ledgerRows.length === 0;
  if (ledgerInserted) {
    run([
      'd1', 'execute', DATABASE_NAME, '--local', '--json', '--command',
      `INSERT INTO schema_migrations(version, description) VALUES ('${MIGRATION_VERSION}', 'audit chain integrity anchors')`,
    ]);
  }
  return { addedColumns, ledgerInserted };
}

if (require.main === module) {
  try {
    const result = ensureLocalAuditChainVerificationMigration();
    console.log(`[local-audit-chain-migration] Added ${result.addedColumns} anchor column(s); ${result.ledgerInserted ? 'recorded migration' : 'migration already recorded'}.`);
  } catch (error) {
    console.error(`[local-audit-chain-migration] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ensureLocalAuditChainVerificationMigration, migrationStatements, responseRows };
