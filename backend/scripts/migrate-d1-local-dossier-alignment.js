'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const WRANGLER_ENTRY = path.join(BACKEND_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DATABASE_NAME = 'enterprise-qua-d1';
const MIGRATION_VERSION = '0023_dossier_schema_alignment';
const MIGRATION_FILE = path.join(BACKEND_ROOT, 'src', 'db', 'migrations', '0023_dossier_schema_alignment.d1.sql');

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_ENTRY, ...args], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Local D1 dossier migration failed: ${result.stderr || result.stdout || result.error}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    const error = new Error('Wrangler returned invalid JSON during the local D1 dossier migration.');
    error.cause = cause;
    throw error;
  }
}

function responseRows(response) {
  const firstResult = Array.isArray(response) ? response[0] : null;
  return Array.isArray(firstResult?.results) ? firstResult.results : [];
}

function splitStatements(sql) {
  return sql.split(';').map((statement) => statement.trim()).filter(Boolean);
}

function execute(run, statement) {
  run(['d1', 'execute', DATABASE_NAME, '--local', '--json', '--command', statement]);
}

function ensureLocalDossierAlignmentMigration({ run = runWrangler } = {}) {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const columnsByTable = new Map();
  let addedColumns = 0;
  let statementsApplied = 0;

  for (const statement of splitStatements(sql)) {
    const addColumn = /^ALTER TABLE ([\w]+) ADD COLUMN ([\w]+)/i.exec(statement);
    if (addColumn) {
      const [, table, column] = addColumn;
      if (!columnsByTable.has(table)) {
        const rows = responseRows(run([
          'd1', 'execute', DATABASE_NAME, '--local', '--json',
          '--command', `SELECT name FROM pragma_table_info('${table}')`,
        ]));
        columnsByTable.set(table, new Set(rows.map((row) => row.name)));
      }
      const columns = columnsByTable.get(table);
      if (columns.has(column)) continue;
      execute(run, statement);
      columns.add(column);
      addedColumns += 1;
      statementsApplied += 1;
      continue;
    }
    execute(run, statement);
    statementsApplied += 1;
  }

  const ledgerRows = responseRows(run([
    'd1', 'execute', DATABASE_NAME, '--local', '--json',
    '--command', `SELECT version FROM schema_migrations WHERE version='${MIGRATION_VERSION}'`,
  ]));
  const ledgerInserted = ledgerRows.length === 0;
  if (ledgerInserted) {
    execute(run, `INSERT OR IGNORE INTO schema_migrations(version, description) VALUES ('${MIGRATION_VERSION}', 'dossier schema alignment')`);
  }
  return { addedColumns, statementsApplied, ledgerInserted };
}

if (require.main === module) {
  try {
    const result = ensureLocalDossierAlignmentMigration();
    console.log(`[local-dossier-migration] Added ${result.addedColumns} column(s), applied ${result.statementsApplied} statement(s); ${result.ledgerInserted ? 'recorded migration' : 'migration already recorded'}.`);
  } catch (error) {
    console.error(`[local-dossier-migration] ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ensureLocalDossierAlignmentMigration, responseRows, splitStatements };
