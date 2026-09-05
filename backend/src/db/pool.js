// ==============================================================================
// DATABASE POOL (Neon PostgreSQL) — the only database connection
// ==============================================================================
// One pool, one database. This backend used to open a second pool against a
// shared MySQL identity schema and keep authentication there while Postgres held
// the domain records; that pool is gone, along with the `mysql2` driver and every
// MYSQL_* setting. Identity, taxonomy and domain tables all live here now (see
// schema.sql), so a request never has to reconcile two datastores.
//
// Every value is read from the environment — no credentials are hardcoded here.
// ==============================================================================

const { Pool } = require('pg');

const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
// Neon bills for compute time while a connection is open, so idle clients are
// released aggressively rather than held for the process lifetime.
const DEFAULT_IDLE_TIMEOUT_MS = 10000;

/**
 * Resolve database settings from the environment.
 *
 * Returns `null` when DATABASE_URL is absent. Callers treat that as
 * "the database is not configured" and fail closed with a descriptive error —
 * it is no longer a signal to serve seed data from memory.
 */
function resolveConfig(env = process.env) {
  const connectionString = env.DATABASE_URL || '';
  if (!connectionString) return null;

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  return {
    connectionString,
    max: env.DATABASE_POOL_MAX ? parseInt(env.DATABASE_POOL_MAX, 10) : DEFAULT_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS
      ? parseInt(env.DATABASE_CONNECT_TIMEOUT_MS, 10)
      : DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS
      ? parseInt(env.DATABASE_IDLE_TIMEOUT_MS, 10)
      : DEFAULT_IDLE_TIMEOUT_MS,
    // Neon's certificate chain is publicly trusted, so this verifies for real.
    // A local Postgres is assumed to be plaintext on the loopback interface.
    ssl: isLocal ? false : { rejectUnauthorized: true },
  };
}

/**
 * Create a PostgreSQL connection pool, or `null` when nothing is configured.
 */
function createPool(env = process.env) {
  const config = resolveConfig(env);
  if (!config) return null;
  return new Pool(config);
}

function detectProvider(connectionString) {
  const lower = connectionString.toLowerCase();
  if (lower.includes('neon.tech')) {
    return { provider: 'neon', providerLabel: 'Neon PostgreSQL' };
  }
  return { provider: 'postgres', providerLabel: 'PostgreSQL' };
}

/** Extract the database name from a connection string for display only. */
function detectDatabaseName(connectionString) {
  const match = /\/([^/?]+)(\?|$)/.exec(connectionString || '');
  return match ? match[1] : '';
}

// Mutable holder so tests can swap the pool without re-requiring the module.
const poolModule = {
  pool: createPool(),
  isConfigured: !!resolveConfig(),
};

/** The message every caller uses when the database is absent. */
const NOT_CONFIGURED_MESSAGE = 'The database is not configured. Set DATABASE_URL so records can be read and written.';

/**
 * Run a parameterised query and return the full pg result.
 */
async function query(text, params = []) {
  if (!poolModule.pool) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  return poolModule.pool.query(text, params);
}

/**
 * Run a parameterised query and return just the rows.
 *
 * Most call sites only ever want `result.rows`, and unwrapping here keeps them
 * from repeating the same destructuring — and from silently reading `.rows` off
 * an undefined result if a mock forgets to supply it.
 */
async function rows(text, params = []) {
  const result = await query(text, params);
  return result.rows || [];
}

/**
 * Run `fn` inside a single transaction on one dedicated client.
 *
 * The client is always released and the transaction is always resolved, so a
 * failure part-way cannot leave a connection checked out of the pool holding an
 * open transaction — which on a serverless provider means paying for an idle
 * compute instance until the statement timeout fires.
 */
async function withTransaction(fn) {
  if (!poolModule.pool) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }
  const client = await poolModule.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A rollback can itself fail if the connection has already dropped. The
    // original error is what the caller needs to see, so this one is swallowed.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Report database reachability for the admin infrastructure screen.
 *
 * Counts accounts as well as domain rows: authentication reads the same
 * connection now, so a single reachability answer covers login and the
 * dashboards together rather than reporting two independent datastores.
 */
async function checkDatabaseHealth() {
  const config = resolveConfig();
  const timestamp = new Date().toISOString();

  if (!poolModule.pool || !config) {
    return {
      isConfigured: false,
      isConnected: false,
      provider: 'not_configured',
      providerLabel: 'Database not configured',
      poolStatus: 'NOT_CONFIGURED',
      database: '',
      latencyMs: 0,
      userCount: 0,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: 'DATABASE_URL is not set.',
      timestamp,
    };
  }

  const { provider, providerLabel } = detectProvider(config.connectionString);
  const database = detectDatabaseName(config.connectionString);
  const startedAt = Date.now();
  try {
    // One round trip rather than three: the health check runs on every admin
    // page load and on boot, and three separate counts meant three billable
    // queries for one answer.
    const result = await query(
      `select (select count(*) from "user" where is_active = true) as user_count,
              (select count(*) from vendors) as vendor_count,
              (select count(*) from rfqs) as rfq_count`
    );
    const row = (result.rows && result.rows[0]) || {};
    return {
      isConfigured: true,
      isConnected: true,
      provider,
      providerLabel,
      poolStatus: `ACTIVE (max ${config.max} connections)`,
      database,
      latencyMs: Date.now() - startedAt,
      userCount: Number(row.user_count || 0),
      vendorCount: Number(row.vendor_count || 0),
      rfqCount: Number(row.rfq_count || 0),
      timestamp,
    };
  } catch (err) {
    return {
      isConfigured: true,
      isConnected: false,
      provider,
      providerLabel,
      poolStatus: 'UNREACHABLE',
      database,
      latencyMs: Date.now() - startedAt,
      userCount: 0,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: err.message || 'Database connection failed.',
      timestamp,
    };
  }
}

/**
 * Close the pool (used by tests and graceful shutdown).
 */
async function closePool() {
  if (!poolModule.pool) return;
  await poolModule.pool.end();
  poolModule.pool = null;
}

poolModule.NOT_CONFIGURED_MESSAGE = NOT_CONFIGURED_MESSAGE;
poolModule.resolveConfig = resolveConfig;
poolModule.createPool = createPool;
poolModule.detectProvider = detectProvider;
poolModule.detectDatabaseName = detectDatabaseName;
poolModule.query = query;
poolModule.rows = rows;
poolModule.withTransaction = withTransaction;
poolModule.checkDatabaseHealth = checkDatabaseHealth;
poolModule.checkDomainDBHealth = checkDatabaseHealth;
poolModule.closePool = closePool;

module.exports = poolModule;
