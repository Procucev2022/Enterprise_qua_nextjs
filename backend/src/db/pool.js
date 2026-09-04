// ==============================================================================
// DOMAIN DATABASE POOL (Neon PostgreSQL)
// ==============================================================================
// Persists vendors and RFQs so they survive a backend restart. Everything else
// storeService.js holds (evaluations, audit logs, buyer accounts, catalogue)
// stays in-memory-only for now — this pool covers vendors + RFQs only.
//
// Every value is read from the environment - no credentials are hardcoded here.
// ==============================================================================

const { Pool } = require('pg');

const DEFAULT_PORT = 5432;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/**
 * Resolve domain-database settings from the environment.
 * Returns `null` when the connection is not configured, which callers treat as
 * "run fully in-memory" rather than throwing.
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
    // Neon's certificate chain is publicly trusted, so unlike the identity
    // MySQL pool's Azure gateway workaround, this can verify for real.
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
  if (lower.includes('neon.tech')) return { provider: 'neon', providerLabel: 'Neon PostgreSQL (vendors + RFQs)' };
  return { provider: 'postgres', providerLabel: 'PostgreSQL (vendors + RFQs)' };
}

// Mutable holder so tests can swap the pool without re-requiring the module.
const poolModule = {
  pool: createPool(),
  isConfigured: !!resolveConfig(),
};

/**
 * Run a parameterised query against the domain database.
 */
async function query(text, params = []) {
  if (!poolModule.pool) {
    throw new Error('Domain database is not configured.');
  }
  return poolModule.pool.query(text, params);
}

/**
 * Report domain-database reachability for the admin infrastructure screen.
 */
async function checkDomainDBHealth() {
  const config = resolveConfig();
  const timestamp = new Date().toISOString();

  if (!poolModule.pool || !config) {
    return {
      isConfigured: false,
      isConnected: false,
      provider: 'not_configured',
      providerLabel: 'Domain database not configured',
      poolStatus: 'NOT_CONFIGURED',
      latencyMs: 0,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: 'DATABASE_URL is not set.',
      timestamp,
    };
  }

  const { provider, providerLabel } = detectProvider(config.connectionString);
  const startedAt = Date.now();
  try {
    const [vendorRows, rfqRows] = await Promise.all([
      query('select count(*) as total from vendors'),
      query('select count(*) as total from rfqs'),
    ]);
    return {
      isConfigured: true,
      isConnected: true,
      provider,
      providerLabel,
      poolStatus: `ACTIVE (max ${config.max} connections)`,
      latencyMs: Date.now() - startedAt,
      vendorCount: Number(vendorRows.rows[0]?.total || 0),
      rfqCount: Number(rfqRows.rows[0]?.total || 0),
      timestamp,
    };
  } catch (err) {
    return {
      isConfigured: true,
      isConnected: false,
      provider,
      providerLabel,
      poolStatus: 'UNREACHABLE',
      latencyMs: Date.now() - startedAt,
      vendorCount: 0,
      rfqCount: 0,
      errorMessage: err.message || 'Domain database connection failed.',
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

poolModule.resolveConfig = resolveConfig;
poolModule.createPool = createPool;
poolModule.query = query;
poolModule.checkDomainDBHealth = checkDomainDBHealth;
poolModule.closePool = closePool;

module.exports = poolModule;
