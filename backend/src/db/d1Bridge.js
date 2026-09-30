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
//      getD1HttpClient() returns a pseudo-binding shaped like a Workers
//      D1 binding so queryD1() / batchD1() work unchanged.  The HTTP
//      client is initialised lazily on first call and cached for the
//      process lifetime.
//
//   3. pg (PostgreSQL via DATABASE_URL)
//      Handled entirely in pool.js — this file is not involved.
//
// `cloudflare:workers` only resolves inside the Workers runtime, never under
// Node/Render, so getD1Binding() below is a plain, cheap no-op there.
// Real ESM `import { env } from 'cloudflare:workers'` only exists in
// worker.mjs, which stashes it on `globalThis.__CF_ENV__` at module load.
// ==============================================================================

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
 * and `.all()` — exactly the surface that queryD1() / batchD1() call — so
 * both helpers work without modification whether the caller has a real Workers
 * binding or this HTTP shim.
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
   * Returns `{ rows, rowCount }` shaped like pg / the Workers binding.
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
    return {
      rows:     (result && result.results) || [],
      rowCount: (result && result.meta && result.meta.changes) ?? undefined,
    };
  }

  /**
   * Execute multiple statements as a single batch (one HTTP round-trip each
   * for the REST API — D1's HTTP API does not have a true batch endpoint, so
   * we run them in parallel via Promise.all, which is still far cheaper than
   * sequential awaits and mirrors the Workers db.batch() intent).
   */
  async function batchHttp(statements) {
    return Promise.all(statements.map(({ sql, params }) => execHttp(sql, params)));
  }

  // Build a shim that looks like a Workers D1 binding to queryD1() / batchD1()
  _d1HttpClient = {
    _isHttpClient: true,
    prepare(sql) {
      return {
        _sql: sql,
        bind(...args) {
          return { _sql: sql, _params: args, all: () => execHttp(sql, args) };
        },
        all: () => execHttp(sql, []),
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
  return text.replace(/\$(\d+)/g, '?');
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
  const expanded = [];
  const matches = text.match(/\$(\d+)/g) || [];
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
async function queryD1(db, text, params = []) {
  const stmt = db.prepare(toD1Sql(text));
  const boundParams = expandD1Params(text, params);
  const bound = boundParams.length > 0 ? stmt.bind(...boundParams) : stmt;
  const result = await bound.all();
  return { rows: result.results || [], rowCount: result.meta ? result.meta.changes : undefined };
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
  const results = await db.batch(prepared);
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

module.exports = { getD1Binding, getD1HttpClient, resetD1HttpClientCache, toD1Sql, expandD1Params, queryD1, batchD1, getWaitUntil };
