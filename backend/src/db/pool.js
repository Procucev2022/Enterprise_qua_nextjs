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
const { getD1Binding, getD1HttpClient, queryD1 } = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { queryAuditor } = require('./queryAuditor');
const { logger } = require('../services/loggerService');
const { DATABASE_QUERY_LOGGING } = require('../config/constants');
const crypto = require('crypto');

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
  // Neon's certificate chain is publicly trusted, so full verification is used
  // there. Other managed providers (e.g. Aiven) issue from their own CA by
  // default, which Node has no trust anchor for — verification would fail
  // even though the connection is genuinely encrypted, so it's relaxed to
  // encrypt-without-verify for anything not on a known-public-CA host.
  const hasPublicCA = connectionString.includes('neon.tech');

  // pg-connection-string parses a `sslmode` query param out of the URL into
  // its own ssl object and that takes precedence over the `ssl` field passed
  // alongside `connectionString` below — so a URL carrying `sslmode=require`
  // (Aiven's default) silently re-enables full verification regardless of
  // hasPublicCA. Stripped here so this file's ssl setting is the only one in
  // effect; the encryption itself is unaffected, only which layer configures it.
  let sanitizedConnectionString = connectionString;
  if (!isLocal) {
    try {
      const url = new URL(connectionString);
      url.searchParams.delete('sslmode');
      url.searchParams.delete('channel_binding');
      sanitizedConnectionString = url.toString();
    } catch {
      // Malformed URL: fall through unmodified and let `pg` surface its own error.
    }
  }

  return {
    connectionString: sanitizedConnectionString,
    max: env.DATABASE_POOL_MAX ? parseInt(env.DATABASE_POOL_MAX, 10) : DEFAULT_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS
      ? parseInt(env.DATABASE_CONNECT_TIMEOUT_MS, 10)
      : DEFAULT_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS
      ? parseInt(env.DATABASE_IDLE_TIMEOUT_MS, 10)
      : DEFAULT_IDLE_TIMEOUT_MS,
    // A local Postgres is assumed to be plaintext on the loopback interface.
    ssl: isLocal ? false : { rejectUnauthorized: hasPublicCA },
  };
}

/**
 * Create a PostgreSQL connection pool, or `null` when nothing is configured.
 */
function createPool(env = process.env) {
  const config = resolveConfig(env);
  if (!config) return null;
  const pool = new Pool(config);
  pool.on('error', (err) => {
    // Idle client dropped connection or transient network reset - log and prevent process termination
    if (process.env.NODE_ENV !== 'test') {
      logger.warn('Transient idle database client error; pool recovery continues', {
        error: err,
        recovery: 'client released by pool error handler',
      }, 'DATABASE_POOL');
    }
  });
  return pool;
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
 * Whether *some* backing store is reachable — pg pool, Workers D1 binding,
 * or D1 HTTP REST API (Node dev / Render).
 *
 * domainQueries.js/vendorIngestionQueries.js/identityQueries.js guard every
 * ported function with `if (!pool.hasStorage()) return <empty>;` before
 * calling query()/rows(). On Cloudflare there is no DATABASE_URL and
 * `poolModule.pool` is always null, so a guard that only checked `pool.pool`
 * would short-circuit every D1-ported call before it ever reached the D1
 * branch inside query(). This checks all three so the guard only fires when
 * nothing at all is configured.
 */
function hasStorage() {
  return !!poolModule.pool || !!getD1Binding() || !!getD1HttpClient();
}

/**
 * Run a parameterised query and return the full pg result.
 *
 * Pass `{ d1: true }` for a query against a table that has already been
 * ported to Cloudflare D1 (see d1Bridge.js) — an explicit per-call-site
 * opt-in, not automatic table sniffing, so only queries that have actually
 * been verified against the migrated D1 schema take that path. On Node/Render
 * (no Workers runtime, no D1 binding) this option is a no-op and the call
 * falls straight through to the normal pg pool, unchanged.
 *
 * Most ported queries share one SQL string across both backends (placeholder
 * syntax is the only difference, and d1Bridge.toD1Sql handles that). A few
 * genuinely can't — e.g. Postgres's jsonb_set() has no Postgres/SQLite-shared
 * spelling, SQLite's equivalent is json_set(). For those, pass `d1Text` with
 * the SQLite version; it's used only on the D1 path, `text` is untouched for
 * pg.
 *
 * Pass `d1Params` too when the two versions don't just differ in SQL text but
 * need a different-shaped params array — e.g. Postgres's `= any($n)` binds
 * one array parameter, but SQLite has no array parameter type at all, so the
 * D1 side expands to `in (?, ?, ...)` and needs each value as its own bound
 * param instead of one array.
 */
async function query(text, params = [], options = {}) {
  // D1 is an explicit per-query opt-in. Automatically routing every query to
  // D1 made unported PostgreSQL-only features fail intermittently with
  // "no such table" as soon as a Worker binding was present.
  const d1 = options.d1 ? (getD1Binding() || getD1HttpClient()) : null;
  const sql = options.d1Text || text;
  const boundParams = options.d1Params || params;
  const isWrite = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|UPSERT)\b/i.test(sql);

  // Auto-invalidation on write queries
  if (isWrite) {
    const table = queryAuditor.detectTable(sql);
    if (table && table !== 'other') {
      queryCache.invalidate(table);
      if (table === 'rfqs') queryCache.invalidate('rfqs');
      if (table === 'vendors') queryCache.invalidate('vendors');
      if (table === 'buyer_accounts') queryCache.invalidate('buyer_accounts');
      if (table === 'evaluations') queryCache.invalidate('evaluations');
      if (table === 'vendor_catalogue') queryCache.invalidate('catalogue');
      if (table === 'category_division' || table === 'org_division_category') queryCache.invalidate('taxonomy');
      if (table === 'ai_feed') queryCache.invalidate('ai_feed');
    }
  }

  // 1. Check Query Cache if cacheable read
  const cacheKey = options.cacheKey || (options.useCache ? queryCache.generateKey(sql, boundParams) : null);
  if (options.useCache && cacheKey && !isWrite) {
    const cachedData = queryCache.get(cacheKey, boundParams);
    if (cachedData !== null) {
      queryAuditor.auditQuery(sql, boundParams, 0, true);
      return { rows: cachedData, rowCount: cachedData.length, isCacheHit: true };
    }
  }

  // 2. Query execution with latency measurement
  const startTime = Date.now();
  let result;
  const table = queryAuditor.detectTable(sql);
  const queryId = crypto.createHash('sha256').update(sql.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
  const provider = d1
    ? (d1._isHttpClient ? 'cloudflare-d1-http' : 'cloudflare-d1')
    : 'postgres';
  try {
    if (d1) {
      result = await queryD1(d1, sql, boundParams);
    } else {
      if (!poolModule.pool) {
        throw new Error(NOT_CONFIGURED_MESSAGE);
      }
      result = await poolModule.pool.query(text, params);
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('Database query failed', {
      error: err,
      queryId,
      table,
      durationMs,
      parameterCount: boundParams.length,
      provider,
    }, 'DATABASE_QUERY');
    throw err;
  }
  const durationMs = Date.now() - startTime;

  // 3. Continuous query auditing
  queryAuditor.auditQuery(sql, boundParams, durationMs, false);

  if (d1) {
    const configuredSampleRate = Number(
      process.env.D1_QUERY_SUCCESS_LOG_SAMPLE_RATE ?? DATABASE_QUERY_LOGGING.D1_SUCCESS_SAMPLE_RATE_DEFAULT
    );
    const sampleRate = Number.isFinite(configuredSampleRate)
      ? Math.min(1, Math.max(0, configuredSampleRate))
      : DATABASE_QUERY_LOGGING.D1_SUCCESS_SAMPLE_RATE_DEFAULT;
    const configuredHighReadThreshold = Number(
      process.env.D1_QUERY_HIGH_READ_ROWS_THRESHOLD ??
      DATABASE_QUERY_LOGGING.D1_HIGH_READ_ROWS_THRESHOLD_DEFAULT
    );
    const highReadThreshold = Number.isFinite(configuredHighReadThreshold) && configuredHighReadThreshold >= 0
      ? configuredHighReadThreshold
      : DATABASE_QUERY_LOGGING.D1_HIGH_READ_ROWS_THRESHOLD_DEFAULT;
    const isSlow = durationMs >= queryAuditor.slowQueryThresholdMs;
    const rowsRead = result?.meta?.rowsRead;
    const isHighRead = Number.isFinite(rowsRead) &&
      rowsRead >= highReadThreshold;
    if (isSlow || isHighRead || Math.random() < sampleRate) {
      const operation = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toUpperCase() || 'UNKNOWN';
      logger.info('D1 query completed', {
        queryId,
        table,
        operation,
        access: isWrite ? 'write' : 'read',
        durationMs,
        parameterCount: boundParams.length,
        returnedRows: Array.isArray(result?.rows) ? result.rows.length : undefined,
        changedRows: result?.rowCount,
        rowsRead,
        rowsWritten: result?.meta?.rowsWritten,
        databaseDurationMs: result?.meta?.durationMs,
        databaseSizeAfterBytes: result?.meta?.sizeAfterBytes,
        servedByRegion: result?.meta?.servedByRegion,
        servedByPrimary: result?.meta?.servedByPrimary,
        servedByColo: result?.meta?.servedByColo,
        highRead: isHighRead,
        provider,
        slow: isSlow,
      }, 'DATABASE_QUERY');
    }
  }

  // 4. Cache storage if cache was enabled for this query
  if (options.useCache && cacheKey && !isWrite && result && Array.isArray(result.rows)) {
    const ttlMs = options.ttlMs || 60000;
    const tag = options.tag || queryAuditor.detectTable(sql) || 'general';
    queryCache.set(cacheKey, boundParams, result.rows, { tag, ttlMs, executionDurationMs: durationMs });
  }

  return result;
}

/**
 * Run a parameterised query and return just the rows.
 *
 * Most call sites only ever want `result.rows`, and unwrapping here keeps them
 * from repeating the same destructuring — and from silently reading `.rows` off
 * an undefined result if a mock forgets to supply it.
 */
async function rows(text, params = [], options = {}) {
  const result = await query(text, params, options);
  return result.rows || [];
}

/**
 * Run `fn` inside a transaction.
 * PostgreSQL callbacks run on one checked-out transaction client. D1 does not
 * support an interactive transaction callback: its atomic batch API requires
 * the complete statement list in advance, so D1 callers must use batchD1.
 */
async function withTransaction(fn) {
  const d1 = getD1Binding() || getD1HttpClient();
  if (d1) {
    const error = new Error('Interactive transactions are unavailable on D1; build a fixed statement list and use batchD1 with a Workers D1 binding.');
    logger.error('Interactive transaction rejected for D1', {
      error,
      provider: d1._isHttpClient ? 'cloudflare-d1-http' : 'cloudflare-d1',
      operation: 'withTransaction',
    }, 'DATABASE_TRANSACTION');
    throw error;
  }
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
    // original transaction error is still rethrown, while the secondary failure
    // is recorded so a broken connection is visible in operational logs.
    await client.query('ROLLBACK').catch((rollbackError) => {
      logger.error('Database transaction rollback failed after the original operation failed', {
        error: rollbackError,
        originalError: err,
      }, 'DATABASE_TRANSACTION');
    });
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
const HEALTH_CHECK_SQL = `select (select count(*) from "user" where is_active = true) as user_count,
    (select count(*) from vendors) as vendor_count,
    (select count(*) from rfqs) as rfq_count`;

const D1_HEALTH_CHECK_SQL = `SELECT 1 AS ok,
  (SELECT COUNT(*) FROM (SELECT 1 FROM "user" WHERE is_active = true LIMIT 50)) AS user_count,
  (SELECT COUNT(*) FROM (SELECT 1 from vendors LIMIT 50)) AS vendor_count,
  (SELECT COUNT(*) FROM (SELECT 1 FROM rfqs LIMIT 50)) AS rfq_count`;

let cachedD1Health = null;
let lastD1HealthCheckTime = 0;
const D1_HEALTH_CACHE_TTL_MS = 60000; // 60s in-memory cache

/**
 * Runs the health-check count query, bounded with a hard timeout —
 * confirmed live via `wrangler tail` that an unbounded query occasionally
 * hangs indefinitely (Neon compute cold-starting, or a stalled TCP socket
 * the `pg` driver's own connectionTimeoutMillis doesn't cover, since that
 * only bounds acquiring a connection, not a query already in flight on
 * one). Cloudflare's runtime then hard-kills the whole request with an
 * opaque "Worker hung" error instead of a clean isConnected:false response.
 * Shared by both the D1 and pg paths below so the timeout guard isn't
 * duplicated.
 */
async function runHealthCheckQuery(queryFn) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Database health check timed out after 8000ms')), 8000);
  });
  try {
    return await Promise.race([queryFn(), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function checkDatabaseHealth() {
  const timestamp = new Date().toISOString();

  // Cloudflare Workers deployments carry a D1 binding — vendors/rfqs/user
  // are all served from there (see domainQueries.js/identityQueries.js's
  // { d1: true } calls), so this is the real, authoritative store to check
  // there. This used to call query() with no { d1: true } option, which
  // always fell through to the Neon pg pool below even on Workers (D1 was
  // never consulted at all) — confirmed live: a deployed Worker with a
  // leftover DATABASE_URL secret reported reachability/row-counts against
  // an unrelated personal Neon database instead of the D1 store the app
  // actually reads and writes.
  const d1 = getD1Binding() || getD1HttpClient();
  if (d1) {
    if (
      cachedD1Health &&
      Date.now() - lastD1HealthCheckTime < D1_HEALTH_CACHE_TTL_MS &&
      process.env.NODE_ENV !== 'test'
    ) {
      return { ...cachedD1Health, timestamp };
    }
    const startedAt = Date.now();
    try {
      const result = await runHealthCheckQuery(() => queryD1(d1, D1_HEALTH_CHECK_SQL));
      const row = (result.rows && result.rows[0]) || {};
      const healthData = {
        isConfigured: true,
        isConnected: true,
        provider: 'cloudflare_d1',
        providerLabel: 'Cloudflare D1',
        poolStatus: getD1Binding() ? 'ACTIVE (D1 binding)' : 'ACTIVE (D1 HTTP REST)',
        database: 'enterprise-qua-d1',
        latencyMs: Date.now() - startedAt,
        userCount: Number(row.user_count || 0),
        vendorCount: Number(row.vendor_count || 0),
        rfqCount: Number(row.rfq_count || 0),
        timestamp,
      };
      cachedD1Health = healthData;
      lastD1HealthCheckTime = Date.now();
      return healthData;
    } catch (err) {
      return {
        isConfigured: true,
        isConnected: false,
        provider: 'cloudflare_d1',
        providerLabel: 'Cloudflare D1',
        poolStatus: 'UNREACHABLE',
        database: 'enterprise-qua-d1',
        latencyMs: Date.now() - startedAt,
        userCount: 0,
        vendorCount: 0,
        rfqCount: 0,
        errorMessage: err.message || 'D1 query failed.',
        timestamp,
      };
    }
  }

  // No D1 binding — Node/Render deployment, or local dev. Falls back to the
  // Neon/pg pool exactly as before.
  const config = resolveConfig();

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
    const result = await runHealthCheckQuery(() => query(HEALTH_CHECK_SQL));
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
poolModule.hasStorage = hasStorage;
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
poolModule.queryCache = queryCache;
poolModule.queryAuditor = queryAuditor;

module.exports = poolModule;
