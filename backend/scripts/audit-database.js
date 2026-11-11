#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIT_CHECKS = Object.freeze([
  {
    id: 'active_org_category_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1
      FROM org_division_category
      WHERE is_active = true
        AND organization_id IS NOT NULL
        AND division IS NOT NULL AND trim(division) <> ''
        AND category IS NOT NULL AND trim(category) <> ''
      GROUP BY organization_id, lower(trim(division)), lower(trim(category))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'active_user_category_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1
      FROM org_division_category
      WHERE is_active = true
        AND organization_id IS NULL
        AND user_id IS NOT NULL
        AND division IS NOT NULL AND trim(division) <> ''
        AND category IS NOT NULL AND trim(category) <> ''
      GROUP BY user_id, lower(trim(division)), lower(trim(category))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'blank_active_category_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM org_division_category
      WHERE is_active = true
        AND (division IS NULL OR trim(division) = '' OR category IS NULL OR trim(category) = ''))`,
  },
  {
    id: 'case_insensitive_vendor_email_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1 FROM vendors
      WHERE email IS NOT NULL AND trim(email) <> ''
      GROUP BY lower(trim(email))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'case_insensitive_buyer_email_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1 FROM buyer_accounts
      WHERE corporate_email IS NOT NULL AND trim(corporate_email) <> ''
      GROUP BY lower(trim(corporate_email))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'case_insensitive_rfq_number_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1 FROM rfqs
      WHERE rfq_number IS NOT NULL AND trim(rfq_number) <> ''
      GROUP BY lower(trim(rfq_number))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'case_insensitive_vendor_catalogue_sku_duplicate_groups',
    kind: 'duplicate_groups',
    expression: `(SELECT COUNT(*) FROM (
      SELECT 1 FROM vendor_catalogue
      WHERE vendor_id IS NOT NULL
        AND sku IS NOT NULL AND trim(sku) <> ''
      GROUP BY vendor_id, lower(trim(sku))
      HAVING COUNT(*) > 1
    ) duplicate_groups)`,
  },
  {
    id: 'orphan_evaluation_vendor_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM evaluations e
      LEFT JOIN vendors v ON v.id = e.vendor_id
      WHERE e.vendor_id IS NOT NULL AND v.id IS NULL)`,
  },
  {
    id: 'orphan_catalogue_vendor_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM vendor_catalogue c
      LEFT JOIN vendors v ON v.id = c.vendor_id
      WHERE c.vendor_id IS NOT NULL AND v.id IS NULL)`,
  },
  {
    id: 'orphan_payment_link_vendor_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM payment_links p
      LEFT JOIN vendors v ON v.id = p.vendor_id
      WHERE p.vendor_id IS NOT NULL AND v.id IS NULL)`,
  },
  {
    id: 'orphan_payment_link_buyer_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM payment_links p
      LEFT JOIN buyer_accounts b ON b.id = p.buyer_account_id
      WHERE p.buyer_account_id IS NOT NULL AND b.id IS NULL)`,
  },
  {
    id: 'orphan_enterprise_inquiry_buyer_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM enterprise_inquiries i
      LEFT JOIN buyer_accounts b ON b.id = i.buyer_account_id
      WHERE i.buyer_account_id IS NOT NULL AND b.id IS NULL)`,
  },
  {
    id: 'orphan_org_category_organization_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM org_division_category c
      LEFT JOIN organization o ON o.uuid = c.organization_id
      WHERE c.organization_id IS NOT NULL AND o.uuid IS NULL)`,
  },
  {
    id: 'orphan_org_category_user_rows',
    kind: 'rows',
    expression: `(SELECT COUNT(*)
      FROM org_division_category c
      LEFT JOIN "user" u ON u.uuid = c.user_id
      WHERE c.user_id IS NOT NULL AND u.uuid IS NULL)`,
  },
]);

function buildAuditSql(checks = AUDIT_CHECKS) {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('Database audit requires at least one check.');
  const projections = checks.map((check) => {
    if (!/^[a-z][a-z0-9_]*$/.test(check.id) || !/^\(\s*SELECT\b/i.test(check.expression)) {
      throw new Error(`Refusing non-read-only audit check: ${check.id}`);
    }
    return `${check.expression} AS ${check.id}`;
  });
  return `SELECT\n  ${projections.join(',\n  ')}`;
}

function parseArguments(argv = process.argv.slice(2)) {
  const postgres = argv.includes('--postgres');
  const d1 = argv.includes('--d1');
  const local = argv.includes('--local');
  if (postgres === d1) {
    throw new Error('Choose exactly one database target: --postgres or --d1.');
  }
  if (local && !d1) throw new Error('--local is supported only with the D1 audit target.');
  return { provider: d1 ? 'd1' : 'postgres', ...(local ? { local: true } : {}) };
}

function rowsFromResult(result, provider) {
  if (provider === 'postgres') return result?.rows || [];
  const firstResult = Array.isArray(result?.result) ? result.result[0] : result?.result;
  return firstResult?.results || [];
}

function countFromResult(result, provider, key = 'count') {
  const rows = rowsFromResult(result, provider);
  const count = Number(rows[0]?.[key]);
  if (!Number.isFinite(count) || count < 0) {
    throw new Error('Database audit query returned an invalid aggregate count.');
  }
  return count;
}

function loadLocalD1Query() {
  const backendRoot = path.resolve(__dirname, '..');
  const wranglerConfig = fs.readFileSync(path.join(backendRoot, 'wrangler.jsonc'), 'utf8');
  const databaseNameMatch = wranglerConfig.match(/"database_name"\s*:\s*"([A-Za-z0-9_-]+)"/);
  if (!databaseNameMatch) throw new Error('Local D1 audit could not find a database_name in wrangler.jsonc.');

  const wranglerCli = require.resolve('wrangler');
  return async (sql) => {
    const output = execFileSync(process.execPath, [
      wranglerCli,
      'd1',
      'execute',
      databaseNameMatch[1],
      '--local',
      '--json',
      '--command',
      sql,
    ], {
      cwd: backendRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return { result: JSON.parse(output) };
  };
}

async function runAudit({ provider, query, checks = AUDIT_CHECKS, now = () => new Date() }) {
  if (!['postgres', 'd1'].includes(provider)) throw new Error('Unsupported database audit provider.');
  if (typeof query !== 'function') throw new Error('Database audit requires a query function.');

  const auditSql = buildAuditSql(checks);
  if (!/^\s*SELECT\b/i.test(auditSql) || /;/.test(auditSql)) {
    throw new Error('Refusing non-read-only database audit statement.');
  }

  let results;
  try {
    const response = await query(auditSql);
    results = checks.map((check) => ({
      id: check.id,
      kind: check.kind,
      status: 'ok',
      count: countFromResult(response, provider, check.id),
    }));
  } catch (error) {
    results = checks.map((check) => ({
      id: check.id,
      kind: check.kind,
      status: 'unavailable',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
      errorMessage: String(error?.message || 'Database audit query failed.').slice(0, 240),
    }));
  }

  return {
    generatedAt: now().toISOString(),
    provider,
    readOnly: true,
    checks: results,
    failedChecks: results.filter((result) => result.status !== 'ok').length,
  };
}

function loadEnvironment(provider, argv) {
  const targetEnv = argv.includes('--prod')
    ? 'prod'
    : (argv.includes('--dev') ? 'dev' : (process.env.APP_ENV || (process.env.NODE_ENV === 'production' ? 'prod' : 'dev')));
  const dotenv = require('dotenv');
  const backendRoot = path.resolve(__dirname, '..');
  const envSpecific = path.join(backendRoot, `.env.${targetEnv}`);
  if (fs.existsSync(envSpecific)) dotenv.config({ path: envSpecific });
  dotenv.config({ path: path.join(backendRoot, '.env') });

  if (provider === 'd1') {
    const missing = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']
      .filter((name) => !process.env[name]);
    if (missing.length > 0) throw new Error(`D1 audit configuration is missing: ${missing.join(', ')}.`);
    return require('./migrate-d1').d1Query;
  }

  if (!process.env.DATABASE_URL) throw new Error('PostgreSQL audit configuration is missing DATABASE_URL.');
  const pool = require('../src/db/pool');
  if (!pool.pool) throw new Error('PostgreSQL pool is unavailable.');
  return async (sql) => pool.pool.query(sql);
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  let target;
  try {
    target = parseArguments(argv);
    if (target.provider === 'd1' && !argv.includes('--allow-full-scan')) {
      throw new Error('D1 integrity checks scan large tables. Add --allow-full-scan to approve the one-time read cost.');
    }
    const query = dependencies.query || (target.local ? loadLocalD1Query() : loadEnvironment(target.provider, argv));
    const report = await runAudit({ provider: target.provider, query });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.failedChecks > 0) process.exitCode = 1;
    return report;
  } catch (error) {
    process.stderr.write(`[db:audit] ${error.message}\n`);
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) main();

module.exports = {
  AUDIT_CHECKS,
  buildAuditSql,
  parseArguments,
  rowsFromResult,
  countFromResult,
  loadLocalD1Query,
  runAudit,
  main,
};
