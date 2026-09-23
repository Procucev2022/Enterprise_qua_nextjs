// ==============================================================================
// D1 BRIDGE — lets pool.query() transparently serve reads from Cloudflare D1
// ==============================================================================
// This app's single Postgres choke point (pool.js) is being ported to D1 table
// by table (see /home/manav/procurecv/db_migrate.md for the full scoping). Until
// every table has moved, a query against a table D1 already has (currently just
// the taxonomy tables: role, org_types, master_status, category_division) can be
// served from D1 while everything else still goes to Postgres over pg — which
// doesn't work reliably from the Workers runtime's TCP layer anyway.
//
// `cloudflare:workers` only resolves inside the Workers runtime, never under
// Node/Render, so getD1Binding() below is a plain, cheap no-op there — this file
// changes nothing about the existing Node/pg path.
//
// This file is CommonJS (required deep under app.js), and the bundler only
// resolves `cloudflare:*` specifiers through a static ESM import — calling
// `require('cloudflare:workers')` here throws "Dynamic require ... is not
// supported" every time, which a bare try/catch swallowed silently, so every
// D1-ported query fell back to the pg pool without ever reaching D1. Real
// ESM `import { env } from 'cloudflare:workers'` only exists in worker.mjs
// (the actual Workers entry point), which stashes it on `globalThis.__CF_ENV__`
// once at module load, for this file to read back synchronously instead.
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

/**
 * Postgres uses $1/$2/... positional placeholders; D1 (SQLite) uses plain `?`.
 * Every query in this codebase is already written with $-placeholders for pg,
 * so this converts rather than requiring two copies of every query string.
 */
function toD1Sql(text) {
  return text.replace(/\$(\d+)/g, '?');
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
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return { rows: result.results || [], rowCount: result.meta ? result.meta.changes : undefined };
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

module.exports = { getD1Binding, toD1Sql, queryD1, getWaitUntil };
