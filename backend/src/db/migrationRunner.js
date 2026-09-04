// ==============================================================================
// MIGRATION RUNNER (shared Procucev MySQL)
// ==============================================================================
// Applies the ordered definitions in migrations.js and records each one in the
// bookkeeping table so a second run is a no-op.
//
// Two behaviours are deliberate:
//
//   Unconfigured database is a SKIP, not a failure. `npm run db:migrate` runs as
//   a quality-gate step and in CI, where no MySQL credentials exist. Failing
//   there would block every commit for a reason unrelated to the change under
//   test. A real SQL error against a configured database still fails loudly.
//
//   Duplicate-index errors are tolerated. MySQL has no CREATE INDEX IF NOT
//   EXISTS, so a migration interrupted midway would otherwise be unrepeatable.
//   Only the specific "already exists" codes are swallowed; everything else
//   propagates.
// ==============================================================================

const identityPoolModule = require('./identityPool');
const { BOOKKEEPING_DDL, MIGRATIONS } = require('./migrations');
const { RFQ_PERSISTENCE } = require('../config/constants');
const { logger } = require('../services/loggerService');

const { MIGRATIONS_TABLE } = RFQ_PERSISTENCE;

// MySQL error codes meaning "this object is already there". Re-running an
// interrupted migration hits these and must not be treated as a failure.
const ALREADY_EXISTS_CODES = new Set([
  'ER_DUP_KEYNAME', // index already exists
  'ER_TABLE_EXISTS_ERROR', // table already exists
  'ER_DUP_FIELDNAME', // column already added
]);

const MIGRATION_STATUS = {
  APPLIED: 'applied',
  SKIPPED_ALREADY_APPLIED: 'already_applied',
  SKIPPED_NOT_CONFIGURED: 'not_configured',
  FAILED: 'failed',
};

/**
 * Is this error MySQL telling us the object already exists?
 */
function isAlreadyExists(err) {
  return !!err && ALREADY_EXISTS_CODES.has(err.code);
}

/**
 * Execute one statement, tolerating "already exists".
 * Returns true when the statement did something, false when it was a no-op.
 */
async function runStatement(query, statement) {
  try {
    await query(statement);
    return true;
  } catch (err) {
    if (isAlreadyExists(err)) {
      logger.debug('Migration statement already applied, continuing.', { code: err.code }, 'DATABASE');
      return false;
    }
    throw err;
  }
}

/**
 * Read the ids already recorded in the bookkeeping table.
 */
async function loadAppliedIds(query) {
  const rows = await query(`SELECT id FROM \`${MIGRATIONS_TABLE}\``);
  return new Set((rows || []).map((row) => row.id));
}

/**
 * Apply every pending migration in order.
 *
 * @param {object} [options]
 * @param {Function} [options.query] parameterised query function, injected by tests
 * @param {Array}    [options.migrations] migration list, injected by tests
 * @returns {Promise<object>} a report describing what happened
 */
async function runMigrations(options = {}) {
  const migrations = options.migrations || MIGRATIONS;
  const query = options.query || (identityPoolModule.pool ? identityPoolModule.identityQuery : null);

  if (!query) {
    logger.warn(
      'Skipping migrations: the MySQL connection is not configured (MYSQL_HOST / MYSQL_DATABASE / MYSQL_USER).'
    );
    return {
      status: MIGRATION_STATUS.SKIPPED_NOT_CONFIGURED,
      applied: [],
      alreadyApplied: [],
      total: migrations.length,
    };
  }

  await runStatement(query, BOOKKEEPING_DDL);
  const appliedIds = await loadAppliedIds(query);

  const applied = [];
  const alreadyApplied = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      alreadyApplied.push(migration.id);
      continue;
    }

    const startedAt = Date.now();
    logger.info(`Applying migration ${migration.id}: ${migration.description}`);

    for (const statement of migration.statements) {
      await runStatement(query, statement);
    }

    const durationMs = Date.now() - startedAt;
    await query(
      `INSERT INTO \`${MIGRATIONS_TABLE}\` (id, applied_at, duration_ms) VALUES (?, ?, ?)`,
      [migration.id, new Date(), durationMs]
    );

    applied.push(migration.id);
    logger.info(`Migration ${migration.id} applied in ${durationMs}ms.`);
  }

  return {
    status: MIGRATION_STATUS.APPLIED,
    applied,
    alreadyApplied,
    total: migrations.length,
  };
}

module.exports = {
  MIGRATION_STATUS,
  isAlreadyExists,
  runStatement,
  loadAppliedIds,
  runMigrations,
};
