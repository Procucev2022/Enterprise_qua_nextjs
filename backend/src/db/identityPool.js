// ==============================================================================
// IDENTITY DATABASE POOL (shared Procucev MySQL)
// ==============================================================================
// This is the only database connection in the backend. User accounts live in
// the shared Procucev MySQL schema that the Java p2pservices application owns,
// so authentication is verified against real user rows rather than an in-memory
// registry. Domain records are served from the in-memory enterprise store.
//
// Every value is read from the environment - no credentials are hardcoded here.
// ==============================================================================

const mysql = require('mysql2/promise');

const DEFAULT_PORT = 3306;
const DEFAULT_POOL_MAX = 5;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

/**
 * Resolve identity-database settings from the environment.
 * Returns `null` when the connection is not configured, which callers treat as
 * "identity database unavailable" rather than falling back to fake accounts.
 */
function resolveConfig(env = process.env) {
  const host = env.MYSQL_HOST || env.IDENTITY_DB_HOST || '';
  const database = env.MYSQL_DATABASE || env.IDENTITY_DB_NAME || '';
  const user = env.MYSQL_USER || env.IDENTITY_DB_USER || '';
  const password = env.MYSQL_PASSWORD || env.IDENTITY_DB_PASSWORD || '';

  if (!host || !database || !user) return null;

  return {
    host,
    port: env.MYSQL_PORT ? parseInt(env.MYSQL_PORT, 10) : DEFAULT_PORT,
    database,
    user,
    password,
    connectionLimit: env.MYSQL_POOL_MAX ? parseInt(env.MYSQL_POOL_MAX, 10) : DEFAULT_POOL_MAX,
    connectTimeout: env.MYSQL_CONNECT_TIMEOUT_MS
      ? parseInt(env.MYSQL_CONNECT_TIMEOUT_MS, 10)
      : DEFAULT_CONNECT_TIMEOUT_MS,
    // Azure Database for MySQL terminates TLS at the gateway with a chain that
    // is not in Node's default trust store, so verification is relaxed while
    // the transport itself stays encrypted.
    ssl: env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: 'Z',
  };
}

/**
 * Create a MySQL connection pool, or `null` when nothing is configured.
 */
function createIdentityPool(env = process.env) {
  const config = resolveConfig(env);
  if (!config) return null;
  return mysql.createPool(config);
}

// Mutable holder so tests can swap the pool without re-requiring the module.
const identityPoolModule = {
  pool: createIdentityPool(),
  isConfigured: !!resolveConfig(),
};

/**
 * Run a parameterised query against the identity database.
 */
async function identityQuery(sql, params = []) {
  if (!identityPoolModule.pool) {
    throw new Error('Identity database is not configured.');
  }
  const [rows] = await identityPoolModule.pool.query(sql, params);
  return rows;
}

/**
 * MySQL `bit(1)` columns arrive as a Buffer; normalise them to booleans.
 */
function bitToBoolean(value) {
  if (value === null || value === undefined) return false;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  if (typeof value === 'boolean') return value;
  return Number(value) === 1;
}

/**
 * Report identity-database reachability for the admin infrastructure screen.
 */
async function checkIdentityHealth() {
  const config = resolveConfig();
  const timestamp = new Date().toISOString();

  if (!identityPoolModule.pool || !config) {
    return {
      isConfigured: false,
      isConnected: false,
      provider: 'not_configured',
      providerLabel: 'Identity database not configured',
      poolStatus: 'NOT_CONFIGURED',
      latencyMs: 0,
      userCount: 0,
      errorMessage: 'MYSQL_HOST / MYSQL_DATABASE / MYSQL_USER are not set.',
      timestamp,
    };
  }

  const isAzure = /mysql\.database\.azure\.com$/i.test(config.host);
  const provider = isAzure ? 'azure_mysql' : 'mysql';
  const providerLabel = isAzure
    ? 'Azure Database for MySQL (shared Procucev identity schema)'
    : 'MySQL (shared Procucev identity schema)';

  const startedAt = Date.now();
  try {
    const rows = await identityQuery('select count(*) as total from `user` where is_active = 1');
    return {
      isConfigured: true,
      isConnected: true,
      provider,
      providerLabel,
      poolStatus: `ACTIVE (max ${config.connectionLimit} connections)`,
      database: config.database,
      latencyMs: Date.now() - startedAt,
      userCount: Number(rows[0]?.total || 0),
      timestamp,
    };
  } catch (err) {
    return {
      isConfigured: true,
      isConnected: false,
      provider,
      providerLabel,
      poolStatus: 'UNREACHABLE',
      database: config.database,
      latencyMs: Date.now() - startedAt,
      userCount: 0,
      errorMessage: err.message || 'Identity database connection failed.',
      timestamp,
    };
  }
}

/**
 * Close the pool (used by tests and graceful shutdown).
 */
async function closeIdentityPool() {
  if (!identityPoolModule.pool) return;
  await identityPoolModule.pool.end();
  identityPoolModule.pool = null;
}

identityPoolModule.resolveConfig = resolveConfig;
identityPoolModule.createIdentityPool = createIdentityPool;
identityPoolModule.identityQuery = identityQuery;
identityPoolModule.bitToBoolean = bitToBoolean;
identityPoolModule.checkIdentityHealth = checkIdentityHealth;
identityPoolModule.closeIdentityPool = closeIdentityPool;

module.exports = identityPoolModule;
