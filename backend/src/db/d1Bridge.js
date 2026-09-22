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
// ==============================================================================

/** Returns the D1 binding (env.DB) when running on Workers with it configured, else null. */
function getD1Binding() {
  try {
    // eslint-disable-next-line global-require
    const { env } = require('cloudflare:workers');
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
 * Run a query against D1, returning the same `{ rows }` shape pool.query()'s
 * pg path returns, so callers reading `.rows` don't need to know which
 * database actually served the request.
 */
async function queryD1(db, text, params = []) {
  const stmt = db.prepare(toD1Sql(text));
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return { rows: result.results || [] };
}

module.exports = { getD1Binding, toD1Sql, queryD1 };
