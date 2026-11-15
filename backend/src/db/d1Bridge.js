// ==============================================================================
// D1 BRIDGE — lets pool.query() transparently serve reads/writes from
//              Cloudflare D1, regardless of runtime.
// ==============================================================================
// THREE PATHS — in priority order:
//
//   1. Workers binding  (production on Cloudflare Workers)
//      globalThis.__CF_ENV__.DB  is the bound D1 database object.
//      Used by getD1Binding() / queryD1() / batchD1().
//
//   2. D1 HTTP REST API  (Node dev / Render / any non-Workers host)
//      When CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_D1_DATABASE_ID +
//      CLOUDFLARE_API_TOKEN are set, queries are forwarded to the
//      Cloudflare REST endpoint:
//        POST /accounts/:account/d1/database/:db/query
//      getD1HttpClient() returns a pseudo-binding for single-query reads and
//      writes. Its multi-request helper is not transactional, so batchD1()
//      rejects multi-statement use through this adapter.
//
//   3. pg (PostgreSQL via DATABASE_URL)
//      Handled entirely in pool.js — this file is not involved.
//
// `cloudflare:workers` only resolves inside the Workers runtime, never under
// Node/Render, so getD1Binding() below is a plain, cheap no-op there.
// Real ESM `import { env } from 'cloudflare:workers'` only exists in
// worker.mjs, which stashes it on `globalThis.__CF_ENV__` at module load.
// ==============================================================================

const { logger } = require('../services/loggerService');
const { D1_RETRY_CONFIG } = require('../config/constants');

/** Returns the D1 binding (env.DB) when running on Workers with it configured, else null. */
function getD1Binding() {
  try {
    const env = globalThis.__CF_ENV__;
    return (env && env.DB) || null;
  } catch {
    return null;
  }
}

// ── D1 HTTP REST API client (Node / Render) ──────────────────────────────────

let _d1HttpClient = undefined; // undefined = not yet resolved, null = not configured

/**
 * Returns a pseudo D1 binding that forwards queries to Cloudflare's D1 REST
 * API via `fetch`.  Works from any Node.js host (local dev, Render, etc.).
 *
 * The returned object exposes `prepare(sql)` whose result has `.bind(...args)`
 * and `.all()` — the surface queryD1() needs. Multi-statement batches are
 * rejected by batchD1() because this HTTP API has no transaction.
 *
 * Returns null when the required env vars are absent.
 */
function getD1HttpClient() {
  if (_d1HttpClient !== undefined) return _d1HttpClient;

  const accountId  = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken   = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    _d1HttpClient = null;
    return null;
  }

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const headers = {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type':  'application/json',
  };

  /**
   * Execute one SQL statement via the REST API.
   * Returns rows, modified-row count, and D1 query metadata.
   */
  async function execHttp(sql, params = []) {
    const body = JSON.stringify({ sql, params });
    const res  = await fetch(baseUrl, { method: 'POST', headers, body });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error(`D1 HTTP API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok || !json.success) {
      const msg = (json.errors && json.errors[0] && json.errors[0].message) || text.slice(0, 300);
      throw new Error(`D1 HTTP query failed (${res.status}): ${msg}`);
    }

    // The REST API wraps results in json.result[0]
    const result = Array.isArray(json.result) ? json.result[0] : json.result;
    const meta = result && result.meta ? result.meta : {};
    return {
      rows:     (result && result.results) || [],
      rowCount: meta.changes ?? undefined,
      ...(result && result.meta ? { meta: result.meta } : {}),
    };
  }

  /**
   * Execute multiple statements as an atomic batch using Cloudflare D1's native
   * `/query` REST API batch payload `{ batch: [ { sql, params }, ... ] }`.
   */
  async function batchHttp(statements) {
    if (!statements || statements.length === 0) return [];
    const body = JSON.stringify({
      batch: statements.map((s) => ({ sql: s.sql, params: s.params || [] })),
    });
    const res = await fetch(baseUrl, { method: 'POST', headers, body });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error(`D1 HTTP API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }

    if (!res.ok || !json.success) {
      const msg = (json.errors && json.errors[0] && json.errors[0].message) || text.slice(0, 300);
      throw new Error(`D1 HTTP batch failed (${res.status}): ${msg}`);
    }

    const rawResults = Array.isArray(json.result) ? json.result : [json.result];
    return rawResults.map((item) => {
      const rows = Array.isArray(item?.results) ? item.results : (Array.isArray(item?.rows) ? item.rows : []);
      const meta = item?.meta || {};
      return {
        rows,
        rowCount: meta.changes ?? item?.rowCount,
        meta,
      };
    });
  }

  // The real Workers D1 binding's `.all()` resolves to `{results, success,
  // meta}` — queryD1()/batchD1() below read exactly that shape. execHttp
  // returns a different, pg-like `{rows, rowCount, meta}` shape instead (kept as-is
  // since scripts/test-rfq-sms.js calls `_execHttp` directly and already
  // depends on that shape) — this adapter translates one into the other, so
  // the prepare().bind().all() path queryD1() actually calls returns what it
  // expects. Confirmed live: without this, every `{d1:true}` query run
  // through the D1 HTTP client (any Node-side script against the real
  // database, not the Workers binding) silently returned zero rows with no
  // error — `result.results` was always undefined, so `result.results ||
  // []` just resolved to an empty array every single time.
  async function allAsNativeShape(sql, params) {
    const { rows, rowCount, meta } = await execHttp(sql, params);
    return { results: rows, success: true, meta: { ...(meta || {}), changes: rowCount } };
  }

  // Build a shim that looks like a Workers D1 binding to queryD1() / batchD1()
  _d1HttpClient = {
    _isHttpClient: true,
    prepare(sql) {
      return {
        _sql: sql,
        bind(...args) {
          return { _sql: sql, _params: args, all: () => allAsNativeShape(sql, args) };
        },
        all: () => allAsNativeShape(sql, []),
      };
    },
    batch: (stmts) => batchHttp(stmts.map((s) => ({ sql: s._sql, params: s._params || [] }))),
    _execHttp:  execHttp,
    _batchHttp: batchHttp,
  };

  return _d1HttpClient;
}

/** Reset the cached HTTP client (useful in tests or after env changes). */
function resetD1HttpClientCache() {
  _d1HttpClient = undefined;
}


/**
 * Postgres uses $1/$2/... positional placeholders; D1 (SQLite) uses plain `?`.
 * Every query in this codebase is already written with $-placeholders for pg,
 * so this converts rather than requiring two copies of every query string.
 */
function toD1Sql(text) {
  return text.replace(/\$(\d+)/g, '?').replace(/\bILIKE\b/g, 'LIKE');
}

/**
 * Expand a pg-style params array to match every `$n` OCCURRENCE in `text`,
 * in left-to-right order — not just every distinct placeholder.
 *
 * Postgres lets one bound value be referenced by the same `$n` more than
 * once in a query (e.g. `WHERE a ILIKE $1 OR b ILIKE $1` — one value, two
 * uses), and several D1-ported queries in this codebase genuinely do this
 * (getVendorsPageFromDB's search condition alone reuses $1 four times).
 * D1's `?` placeholders are purely positional with no reuse — toD1Sql's
 * blind text replace turns each of those four `$1`s into four separate `?`,
 * but the caller only supplied one value for them, so D1 throws "Wrong
 * number of parameter bindings for SQL query." (confirmed live — this is
 * exactly the bug that produced that error against the deployed Worker).
 * This walks the original (pre-replace) text and, for every `$n` it finds,
 * in the order `?` placeholders will actually appear in the converted SQL,
 * pushes `params[n-1]` again — so a value referenced 4 times is bound 4
 * times, matching what toD1Sql's expansion actually needs.
 */
function expandD1Params(text, params = []) {
  const matches = text.match(/\$(\d+)/g);
  if (!matches || matches.length === 0) {
    return Array.isArray(params) ? params : [];
  }
  const expanded = [];
  for (const match of matches) {
    const index = Number(match.slice(1)) - 1;
    expanded.push(params[index]);
  }
  return expanded;
}

/**
 * Run a query against D1, returning a result shaped like pg's: `{ rows,
 * rowCount }`. `rowCount` comes from D1's `meta.changes` — pg's `pg` driver
 * exposes it under that name for INSERT/UPDATE/DELETE, and a few call sites
 * (authSessionQueries.deleteOtp/purgeExpiredAuthState) read it directly to
 * know whether a delete actually removed a row, not just that the query ran.
 */
/**
 * Patterns matching transient Cloudflare D1 rate-limiting or resource overload errors.
 * D1 enforces a maximum resource consumption within a sliding 10-second window.
 */
const RETRYABLE_D1_ERROR_PATTERNS = [
  /overloaded/i,
  /too many resources/i,
  /rate limit/i,
  /temporarily unavailable/i,
  /resource limit/i,
];

function isRetryableD1Error(err) {
  if (!err) return false;
  const msg = err.message || String(err);
  return RETRYABLE_D1_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

// Narrower than isRetryableD1Error: only the platform's own overload message. The generic
// patterns (for example "rate limit") can come from other providers and must not change an
// HTTP response into a database-busy response.
const D1_OVERLOAD_ERROR_PATTERN = /D1 DB is overloaded|too many resources consumed/i;

function isD1OverloadError(err) {
  if (!err) return false;
  const msg = err.message || String(err);
  return D1_OVERLOAD_ERROR_PATTERN.test(msg);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed D1 attempt is retried. An overload is never retried: the database has already
 * spent its budget for the current window, and each retry spends more of that budget.
 */
function shouldRetryD1Attempt(err, attempts) {
  return attempts < D1_RETRY_CONFIG.MAX_ATTEMPTS
    && isRetryableD1Error(err)
    && !isD1OverloadError(err);
}

function d1RetryBackoffMs(attempts) {
  return D1_RETRY_CONFIG.BACKOFF_BASE_MS * attempts + Math.floor(Math.random() * D1_RETRY_CONFIG.BACKOFF_JITTER_MS);
}

/** Records how many attempts a failed query used, so its log line shows the retry pressure. */
function annotateD1Attempts(err, attempts) {
  if (err && typeof err === 'object') err.d1Attempts = attempts;
  return err;
}

/**
 * 1-based positions of the parameters that are `undefined`. D1 rejects those with
 * "Type 'undefined' not supported", and the position names the placeholder that needs a value.
 */
function findUndefinedParameterIndexes(params) {
  if (!Array.isArray(params)) return [];
  const indexes = [];
  params.forEach((value, index) => {
    if (value === undefined) indexes.push(index + 1);
  });
  return indexes;
}

let _d1OverloadUntil = 0;
const D1_OVERLOAD_COOLDOWN_MS = 15000;

function markD1Overloaded() {
  _d1OverloadUntil = Date.now() + D1_OVERLOAD_COOLDOWN_MS;
}

function isD1Overloaded() {
  return Date.now() < _d1OverloadUntil;
}

function resetD1OverloadState() {
  _d1OverloadUntil = 0;
}

async function queryD1(db, text, params = []) {
  const isErrorLog = typeof text === 'string' && text.includes('system_error_logs');

  // If D1 is currently experiencing resource overload and this query is an error log write,
  // drop it immediately without sending subrequests to D1 to avoid amplifying the overload.
  if (isErrorLog && isD1Overloaded()) {
    return { rows: [], rowCount: 0 };
  }

  const stmt = db.prepare(toD1Sql(text));
  const boundParams = expandD1Params(text, params);
  const bound = boundParams.length > 0 ? stmt.bind(...boundParams) : stmt;
  let attempts = 0;
  const maxAttempts = isErrorLog ? 1 : D1_RETRY_CONFIG.MAX_ATTEMPTS;
  let result;
  while (attempts < maxAttempts) {
    try {
      result = await bound.all();
      break;
    } catch (err) {
      attempts++;
      if (isRetryableD1Error(err)) {
        markD1Overloaded();
      }
      if (isErrorLog) {
        return { rows: [], rowCount: 0 };
      }
      if (shouldRetryD1Attempt(err, attempts)) {
        await sleep(d1RetryBackoffMs(attempts));
        continue;
      }
      throw annotateD1Attempts(err, attempts);
    }
  }
  const rawMeta = result && result.meta && typeof result.meta === 'object' ? result.meta : {};
  const metadataFields = [
    ['rowsRead', 'rows_read', 'rowsRead'],
    ['rowsWritten', 'rows_written', 'rowsWritten'],
    ['durationMs', 'duration', 'durationMs'],
    ['sizeAfterBytes', 'size_after', 'sizeAfterBytes'],
    ['servedByRegion', 'served_by_region', 'servedByRegion'],
    ['servedByPrimary', 'served_by_primary', 'servedByPrimary'],
    ['servedByColo', 'served_by_colo', 'servedByColo'],
  ];
  const meta = {};
  metadataFields.forEach(([normalizedName, snakeName, camelName]) => {
    const value = rawMeta[snakeName] ?? rawMeta[camelName];
    if (value !== undefined && value !== null) meta[normalizedName] = value;
  });
  return {
    rows: result && Array.isArray(result.results) ? result.results : [],
    rowCount: rawMeta.changes,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

/**
 * Run several INSERT/UPDATE statements against D1 as one `db.batch()` call.
 *
 * D1 enforces two separate limits a large multi-row bulk write can hit: at
 * most 100 bound parameters per individual statement, and a cap on the
 * number of subrequests a single Worker invocation may make (as low as 50
 * on some plans) — each `db.prepare(...).bind(...).all()` call is its own
 * subrequest. A naive fix for the parameter cap (splitting one big INSERT
 * into many small multi-row INSERTs, each run with its own `queryD1` call)
 * fixes the first limit but immediately hits the second: a 1000-row import
 * split into 16-row statements is ~63 separate subrequests, well past a
 * 50-subrequest cap (confirmed live: "Too many API requests by single
 * Worker invocation").
 *
 * `db.batch([stmt1, stmt2, ...])` sends every statement to D1 in one round
 * trip — one subrequest total, regardless of how many statements are in the
 * batch — so each statement can safely be a single-row INSERT (well under
 * the 100-param cap) without multiplying subrequest count. This is D1's own
 * documented pattern for bulk writes, not a workaround.
 *
 * `rows` is an array of `{ text, params }` (pg-style `$n` placeholders,
 * converted the same way a normal queryD1 call would). Returns one
 * `{ rows, rowCount }`-shaped result per statement, in the same order.
 */
async function batchD1(db, statements) {
  const prepared = statements.map(({ text, params = [] }) => {
    const stmt = db.prepare(toD1Sql(text));
    const boundParams = expandD1Params(text, params);
    return boundParams.length > 0 ? stmt.bind(...boundParams) : stmt;
  });
  let attempts = 0;
  const maxAttempts = D1_RETRY_CONFIG.MAX_ATTEMPTS;
  let results;
  while (attempts < maxAttempts) {
    try {
      results = await db.batch(prepared);
      break;
    } catch (err) {
      attempts++;
      if (isRetryableD1Error(err)) {
        markD1Overloaded();
      }
      if (shouldRetryD1Attempt(err, attempts)) {
        await sleep(d1RetryBackoffMs(attempts));
        continue;
      }
      throw annotateD1Attempts(err, attempts);
    }
  }
  return results.map((result) => {
    // Workers binding returns { results, meta }; HTTP client returns { rows, rowCount }
    if (result && result.rows !== undefined) return result;
    return {
      rows:     result.results || [],
      rowCount: result.meta ? result.meta.changes : undefined,
    };
  });
}

/**
 * Returns Workers' `waitUntil` (imported from `cloudflare:workers` in
 * worker.mjs, the only real ESM file in this backend — see its comment)
 * when running on Workers, else null. Used to extend a fire-and-forget
 * persistence write past the point the HTTP response is sent, which Workers
 * would otherwise cancel outright; a plain no-op on Node/Render.
 */
function getWaitUntil() {
  try {
    return globalThis.__CF_WAIT_UNTIL__ || null;
  } catch {
    return null;
  }
}

module.exports = {
  getD1Binding,
  getD1HttpClient,
  resetD1HttpClientCache,
  toD1Sql,
  expandD1Params,
  queryD1,
  batchD1,
  getWaitUntil,
  isRetryableD1Error,
  isD1OverloadError,
  findUndefinedParameterIndexes,
  isD1Overloaded,
  markD1Overloaded,
  resetD1OverloadState,
};
