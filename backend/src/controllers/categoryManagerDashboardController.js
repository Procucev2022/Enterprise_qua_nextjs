// ==============================================================================
// CATEGORY MANAGER DASHBOARD CONTROLLER
// ==============================================================================
// Provides real-time live database metrics, monthly telemetry trends, and
// drill-down records for the Category Manager Operational Desk.
// ==============================================================================

const storeService = require('../services/storeService');
const pool = require('../db/pool');
const d1Bridge = require('../db/d1Bridge');
const domainQueries = require('../db/domainQueries');
const directoryKPIQueries = require('../db/directoryKPIQueries');
const loginLogsQueries = require('../db/loginLogsQueries');
const { D1_OVERLOAD_CONFIG } = require('../config/constants');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

const LOG_CATEGORY = 'CM_DASHBOARD_CONTROLLER';
const MAX_POPUP_RECORDS_DEFAULT = 2000;
const MAX_VENDOR_POPUP_RECORDS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const RFQ_COL_PG = "CASE WHEN created_at IS NOT NULL THEN created_at WHEN NULLIF(trim(raw->>'createdAt'), '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (raw->>'createdAt')::timestamptz END";
const RFQ_COL_D1 = "COALESCE(NULLIF(created_at, ''), CASE WHEN json_valid(raw) THEN json_extract(raw, '$.createdAt') END)";
const BUYER_COL_PG = "CASE WHEN created_at IS NOT NULL THEN created_at WHEN NULLIF(trim(raw->>'createdAt'), '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (raw->>'createdAt')::timestamptz END";
const BUYER_COL_D1 = "COALESCE(NULLIF(created_at, ''), CASE WHEN json_valid(raw) THEN json_extract(raw, '$.createdAt') END)";
const OPEN_CLAUSE_PG = "upper(COALESCE(status, raw->>'status', '')) NOT IN ('CLOSED', 'EXPIRED', 'AWARDED', 'CANCELLED', 'REJECTED')";
const OPEN_CLAUSE_D1 = "upper(COALESCE(status, CASE WHEN json_valid(raw) THEN json_extract(raw, '$.status') END, '')) NOT IN ('CLOSED', 'EXPIRED', 'AWARDED', 'CANCELLED', 'REJECTED')";
const QUOTE_LEN_PG = "COALESCE(CASE WHEN jsonb_typeof(raw->'quotes') = 'array' THEN jsonb_array_length(raw->'quotes') END, CASE WHEN jsonb_typeof(raw->'vendorQuotes') = 'array' THEN jsonb_array_length(raw->'vendorQuotes') END, CASE WHEN (raw->>'quotesReceivedCount') ~ '^\\d+$' THEN (raw->>'quotesReceivedCount')::int END, 0)";
const QUOTE_LEN_D1 = "COALESCE(CASE WHEN json_valid(raw) AND json_type(raw, '$.quotes') = 'array' THEN json_array_length(raw, '$.quotes') END, CASE WHEN json_valid(raw) AND json_type(raw, '$.vendorQuotes') = 'array' THEN json_array_length(raw, '$.vendorQuotes') END, CASE WHEN json_valid(raw) AND typeof(json_extract(raw, '$.quotesReceivedCount')) IN ('integer', 'real') THEN CAST(json_extract(raw, '$.quotesReceivedCount') AS INTEGER) WHEN json_valid(raw) AND typeof(json_extract(raw, '$.quotesReceivedCount')) = 'text' AND length(json_extract(raw, '$.quotesReceivedCount')) > 0 AND json_extract(raw, '$.quotesReceivedCount') GLOB '[0-9]*' AND json_extract(raw, '$.quotesReceivedCount') NOT GLOB '*[^0-9]*' THEN CAST(json_extract(raw, '$.quotesReceivedCount') AS INTEGER) END, 0)";

const MONTH_NAMES = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

function parseSafeJson(str) {
  if (!str) return {};
  try {
    return typeof str === 'string' ? JSON.parse(str) : str;
  } catch {
    return {};
  }
}

/**
 * Extracts a normalized Date instance from various timestamp representations across DB entities.
 */
function getItemDate(item) {
  if (!item) return null;
  const raw = typeof item.raw === 'string' ? parseSafeJson(item.raw) : (item.raw || {});
  const val =
    item.createdAt ||
    item.created_at ||
    item.creationDate ||
    item.creation_date ||
    item.timestamp ||
    item.loginAt ||
    item.login_at ||
    raw.createdAt ||
    raw.created_at ||
    raw.creationDate ||
    raw.timestamp;
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalizes query string bounds into UTC Date instances.
 */
function resolveDateBounds(preset, startDateStr, endDateStr) {
  const now = new Date();
  const normalizedPreset = String(preset || '').trim().toLowerCase();

  if (normalizedPreset === 'today') {
    const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { fromDate, toDate };
  }

  if (normalizedPreset === 'this_week') {
    const day = now.getDay();
    const diff = (day === 0 ? 6 : day - 1); // Monday is start of week
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    const fromDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0, 0);
    const toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { fromDate, toDate };
  }

  if (normalizedPreset === 'this_month') {
    const fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { fromDate, toDate };
  }

  const hasStart = Boolean(startDateStr && String(startDateStr).trim() !== '' && String(startDateStr).toLowerCase() !== 'all');
  const hasEnd = Boolean(endDateStr && String(endDateStr).trim() !== '' && String(endDateStr).toLowerCase() !== 'all');

  if (!hasStart && !hasEnd) {
    return { fromDate: null, toDate: null };
  }

  let fromDate = null;
  let toDate = null;

  if (hasStart) {
    const parsedStart = new Date(startDateStr);
    if (!isNaN(parsedStart.getTime())) {
      fromDate = new Date(parsedStart.getFullYear(), parsedStart.getMonth(), parsedStart.getDate(), 0, 0, 0, 0);
    }
  }

  if (hasEnd) {
    const parsedEnd = new Date(endDateStr);
    if (!isNaN(parsedEnd.getTime())) {
      toDate = new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate(), 23, 59, 59, 999);
    }
  }

  return { fromDate, toDate };
}

/**
 * Checks if a timestamp falls within the resolved from/to boundaries.
 */
function isWithinBounds(dateVal, fromDate, toDate) {
  if (!dateVal) return false;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  const t = d.getTime();
  if (isNaN(t)) return false;
  if (!fromDate && !toDate) return true;
  if (fromDate && t < fromDate.getTime()) return false;
  if (toDate && t > toDate.getTime()) return false;
  return true;
}

/**
 * Helper to determine if an RFQ is currently open.
 */
function isRfqOpen(rfq) {
  if (!rfq) return false;
  const status = String(rfq.status || '').toUpperCase();
  return !['CLOSED', 'EXPIRED', 'AWARDED', 'CANCELLED', 'REJECTED'].includes(status);
}

/**
 * Helper to determine quote count for an RFQ.
 */
function getQuoteCount(rfq) {
  if (!rfq) return 0;
  if (Array.isArray(rfq.quotes)) return rfq.quotes.length;
  if (typeof rfq.quotesReceivedCount === 'number') return rfq.quotesReceivedCount;
  if (Array.isArray(rfq.vendorQuotes)) return rfq.vendorQuotes.length;
  return 0;
}

/**
 * Helper to determine if a buyer account holds a paid/active subscription (excludes Free_trial / free).
 */
function isBuyerSubscribed(buyer) {
  if (!buyer) return false;
  const normalized = typeof buyer.raw === 'string' ? { ...buyer, raw: parseSafeJson(buyer.raw) } : buyer;
  return directoryKPIQueries.isPaidBuyerRecord(normalized);
}

/**
 * Helper to determine if a vendor account holds a paid subscription (excludes free / premium roster-uploaded).
 */
function isVendorSubscribed(vendor) {
  if (!vendor) return false;
  const normalized = typeof vendor.raw === 'string' ? { ...vendor, raw: parseSafeJson(vendor.raw) } : vendor;
  return directoryKPIQueries.isPaidVendorRecord(normalized);
}

/**
 * Flattens a DB row with JSON `raw` payload into a normalized domain object.
 */
function normalizeDbRow(row) {
  if (!row) return {};
  const rawObj = typeof row.raw === 'string' ? parseSafeJson(row.raw) : (row.raw || {});
  return { ...rawObj, ...row, raw: rawObj };
}

/**
 * Builds Postgres & D1 date filter clauses and normalized ISO parameter bindings.
 * When filtering on an indexed bare `created_at` column in D1, pairs the exact
 * `datetime()` check with coarse `YYYY-MM-DD` range bounds so SQLite uses
 * `idx_vendors_created_at` / partial indexes across both space- and `T`-separated timestamps.
 */
function buildSqlDateFilter(colPg, colD1, fromDate, toDate) {
  const pgConds = [];
  const d1Conds = [];
  const params = [];
  const d1Params = [];
  const isBareColumn = colD1 === 'created_at';
  const pgExpr = colPg === 'created_at' ? 'created_at::timestamptz' : colPg;

  const appendBound = (boundDate, op, coarseOffsetDays) => {
    const iso = boundDate.toISOString();
    params.push(iso);
    const pgIdx = params.length;
    pgConds.push(`${pgExpr} ${op} $${pgIdx}::timestamptz`);

    if (isBareColumn) {
      const coarse = new Date(boundDate.getTime() + coarseOffsetDays * DAY_MS).toISOString().slice(0, 10);
      d1Params.push(coarse);
      const coarseIdx = d1Params.length;
      d1Params.push(iso);
      const exactIdx = d1Params.length;
      d1Conds.push(`created_at ${op} $${coarseIdx} AND datetime(created_at) ${op} datetime($${exactIdx})`);
    } else {
      d1Params.push(iso);
      const exactIdx = d1Params.length;
      d1Conds.push(`datetime(${colD1}) ${op} datetime($${exactIdx})`);
    }
  };

  if (fromDate) appendBound(fromDate, '>=', -1);
  if (toDate) appendBound(toDate, '<=', 2);
  return {
    pgWhere: pgConds.length ? `WHERE ${pgConds.join(' AND ')}` : '',
    d1Where: d1Conds.length ? `WHERE ${d1Conds.join(' AND ')}` : '',
    pgAnd: pgConds.length ? `AND ${pgConds.join(' AND ')}` : '',
    d1And: d1Conds.length ? `AND ${d1Conds.join(' AND ')}` : '',
    params,
    d1Params,
  };
}

/**
 * Executes DB tasks sequentially when Cloudflare D1 is active so multiple queries
 * never saturate D1's 10-second sliding resource window in one parallel burst,
 * while preserving concurrent execution on PostgreSQL.
 */
async function executeQueries(tasks) {
  const isD1 = Boolean(d1Bridge.getD1Binding() || d1Bridge.getD1HttpClient());
  if (isD1) {
    const results = [];
    for (const task of tasks) {
      results.push(await task());
    }
    return results;
  }
  const results = await Promise.all(tasks.map((task) => task()));
  return results;
}

/**
 * Computes the last 6 calendar months metadata ({ ym: 'YYYY-MM', label: 'Nov', startOfMonth, endOfMonth }).
 */
function buildLast6MonthsMeta(now = new Date()) {
  const monthsMeta = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    monthsMeta.push({
      year,
      month,
      ym: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: MONTH_NAMES[month],
      startOfMonth: new Date(year, month, 1, 0, 0, 0, 0),
      endOfMonth: new Date(year, month + 1, 0, 23, 59, 59, 999),
    });
  }
  return monthsMeta;
}

/**
 * Fetches internal Category Manager Portal logins (scoped strictly to category_manager role/staff).
 */
async function loadCmPortalLogins(fromDate, toDate) {
  try {
    const logsResult = await loginLogsQueries.listLoginLogs({
      userType: 'category_manager',
      syncDb: true,
      limit: 1000,
    });
    const allCmLogs = logsResult && Array.isArray(logsResult.logs)
      ? logsResult.logs.filter((log) => log.userType === 'category_manager')
      : [];
    if (!fromDate && !toDate) {
      return allCmLogs;
    }
    return allCmLogs.filter((l) => isWithinBounds(getItemDate(l), fromDate, toDate));
  } catch {
    return [];
  }
}

/**
 * Queries full-table SQL aggregates (zero 200/1000 row truncation) and 6-month chart series from DB.
 */
async function loadDashboardMetricsFromDB({ fromDate, toDate }) {
  const rfqFilter = buildSqlDateFilter(RFQ_COL_PG, RFQ_COL_D1, fromDate, toDate);
  const buyerFilter = buildSqlDateFilter(BUYER_COL_PG, BUYER_COL_D1, fromDate, toDate);
  const vendorFilter = buildSqlDateFilter('created_at', 'created_at', fromDate, toDate);

  const rfqKpiPg = `
    SELECT
      COUNT(*)::int AS total_rfqs,
      COUNT(CASE WHEN ${OPEN_CLAUSE_PG} THEN 1 END)::int AS open_rfqs,
      COUNT(CASE WHEN ${OPEN_CLAUSE_PG} AND ${QUOTE_LEN_PG} = 0 THEN 1 END)::int AS rfqs_without_quotes
    FROM rfqs ${rfqFilter.pgWhere}`;
  const rfqKpiD1 = `
    SELECT
      CAST(COUNT(*) AS INTEGER) AS total_rfqs,
      CAST(COUNT(CASE WHEN ${OPEN_CLAUSE_D1} THEN 1 END) AS INTEGER) AS open_rfqs,
      CAST(COUNT(CASE WHEN ${OPEN_CLAUSE_D1} AND ${QUOTE_LEN_D1} = 0 THEN 1 END) AS INTEGER) AS rfqs_without_quotes
    FROM rfqs ${rfqFilter.d1Where}`;

  const buyerKpiPg = `
    SELECT
      COUNT(*)::int AS total_buyers,
      COUNT(CASE WHEN ${directoryKPIQueries.PAID_BUYER_SQL_PG} THEN 1 END)::int AS buyer_subscriptions
    FROM buyer_accounts ${buyerFilter.pgWhere}`;
  const buyerKpiD1 = `
    SELECT
      CAST(COUNT(*) AS INTEGER) AS total_buyers,
      CAST(COUNT(CASE WHEN ${directoryKPIQueries.PAID_BUYER_SQL_D1} THEN 1 END) AS INTEGER) AS buyer_subscriptions
    FROM buyer_accounts ${buyerFilter.d1Where}`;

  const rfqMonthlyPg = `
    SELECT to_char(date_trunc('month', ${RFQ_COL_PG}), 'YYYY-MM') AS ym,
      COUNT(*)::int AS rfqs,
      COALESCE(SUM(${QUOTE_LEN_PG}), 0)::int AS quotes
    FROM rfqs GROUP BY ym ORDER BY ym ASC`;
  const rfqMonthlyD1 = `
    SELECT strftime('%Y-%m', datetime(${RFQ_COL_D1})) AS ym,
      CAST(COUNT(*) AS INTEGER) AS rfqs,
      CAST(COALESCE(SUM(${QUOTE_LEN_D1}), 0) AS INTEGER) AS quotes
    FROM rfqs GROUP BY ym ORDER BY ym ASC`;

  const buyerMonthlyPg = `
    SELECT to_char(date_trunc('month', ${BUYER_COL_PG}), 'YYYY-MM') AS ym,
      COUNT(*)::int AS cnt,
      COUNT(CASE WHEN ${directoryKPIQueries.PAID_BUYER_SQL_PG} THEN 1 END)::int AS subs
    FROM buyer_accounts GROUP BY ym ORDER BY ym ASC`;
  const buyerMonthlyD1 = `
    SELECT strftime('%Y-%m', datetime(${BUYER_COL_D1})) AS ym,
      CAST(COUNT(*) AS INTEGER) AS cnt,
      CAST(COUNT(CASE WHEN ${directoryKPIQueries.PAID_BUYER_SQL_D1} THEN 1 END) AS INTEGER) AS subs
    FROM buyer_accounts GROUP BY ym ORDER BY ym ASC`;

  const monthsMeta = buildLast6MonthsMeta();
  const vendorStatsPgParams = [];
  const vendorStatsD1Params = [];
  const vendorStatsPgCols = [];
  const vendorStatsD1Cols = [];
  monthsMeta.forEach((m, i) => {
    const nextPg = new Date(m.year, m.month + 1, 1, 0, 0, 0, 0).toISOString();
    const nextD1 = new Date(Date.UTC(m.year, m.month + 1, 1)).toISOString().slice(0, 10);
    vendorStatsPgParams.push(m.startOfMonth.toISOString(), nextPg);
    vendorStatsD1Params.push(`${m.ym}-01`, nextD1);
    const p1 = `$${i * 2 + 1}`;
    const p2 = `$${i * 2 + 2}`;
    vendorStatsPgCols.push(`COUNT(*) FILTER (WHERE created_at >= ${p1}::timestamptz AND created_at < ${p2}::timestamptz)::int AS m${i}`);
    vendorStatsD1Cols.push(`CAST(COALESCE(SUM(CASE WHEN created_at >= ${p1} AND created_at < ${p2} THEN 1 ELSE 0 END), 0) AS INTEGER) AS m${i}`);
  });

  // Single covering-index scan over idx_vendors_created_at computes both total_vendors and the 6-month counts.
  const vendorStatsPg = `
    SELECT
      COUNT(*)::int AS total_vendors,
      ${vendorStatsPgCols.join(',\n      ')}
    FROM vendors`;
  const vendorStatsD1 = `
    SELECT
      CAST(COUNT(*) AS INTEGER) AS total_vendors,
      ${vendorStatsD1Cols.join(',\n      ')}
    FROM vendors`;

  const paidVendorsPg = `SELECT id, created_at, raw FROM vendors WHERE ${directoryKPIQueries.PAID_VENDOR_SQL_PG}`;
  const paidVendorsD1 = `SELECT id, created_at, raw FROM vendors WHERE ${directoryKPIQueries.PAID_VENDOR_SQL_D1}`;

  const [
    rfqKpiRes,
    buyerKpiRes,
    rfqMonthlyRes,
    buyerMonthlyRes,
    vendorStatsRes,
    paidVendorsRes,
    vendorBoundedRes,
    cmLogins,
  ] = await executeQueries([
    () => pool.query(rfqKpiPg, rfqFilter.params, { d1: true, d1Text: rfqKpiD1, d1Params: rfqFilter.d1Params, useCache: true, tag: 'rfqs', ttlMs: 15000 }),
    () => pool.query(buyerKpiPg, buyerFilter.params, { d1: true, d1Text: buyerKpiD1, d1Params: buyerFilter.d1Params, useCache: true, tag: 'buyer_accounts', ttlMs: 15000 }),
    () => pool.query(rfqMonthlyPg, [], { d1: true, d1Text: rfqMonthlyD1, useCache: true, tag: 'rfqs', ttlMs: 30000 }),
    () => pool.query(buyerMonthlyPg, [], { d1: true, d1Text: buyerMonthlyD1, useCache: true, tag: 'buyer_accounts', ttlMs: 30000 }),
    () => pool.query(vendorStatsPg, vendorStatsPgParams, { d1: true, d1Text: vendorStatsD1, d1Params: vendorStatsD1Params, useCache: true, tag: 'vendors', ttlMs: 30000 }),
    () => pool.query(paidVendorsPg, [], { d1: true, d1Text: paidVendorsD1, useCache: true, tag: 'vendors', ttlMs: 30000 }),
    () => ((fromDate || toDate)
      ? pool.query(
          `SELECT COUNT(*)::int AS total_vendors FROM vendors ${vendorFilter.pgWhere}`,
          vendorFilter.params,
          {
            d1: true,
            d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS total_vendors FROM vendors ${vendorFilter.d1Where}`,
            d1Params: vendorFilter.d1Params,
            useCache: true,
            tag: 'vendors',
            ttlMs: 30000,
          }
        )
      : Promise.resolve(null)),
    () => loadCmPortalLogins(fromDate, toDate),
  ]);

  const rfqRow = rfqKpiRes?.rows?.[0] || {};
  const buyerRow = buyerKpiRes?.rows?.[0] || {};
  const vendorStatsRow = vendorStatsRes?.rows?.[0] || {};
  const allTimeVendorTotal = Number(vendorStatsRow.total_vendors || 0);
  const totalVendorsCount = vendorBoundedRes
    ? Number(vendorBoundedRes.rows?.[0]?.total_vendors || 0)
    : allTimeVendorTotal;

  const paidVendors = (paidVendorsRes?.rows || []).map(normalizeDbRow);
  const filteredPaidVendors = (fromDate || toDate)
    ? paidVendors.filter((v) => isWithinBounds(getItemDate(v), fromDate, toDate))
    : paidVendors;

  const totalBuyersCount = Number(buyerRow.total_buyers || 0);
  const kpi = {
    totalRfqs: Number(rfqRow.total_rfqs || 0),
    openRfqs: Number(rfqRow.open_rfqs || 0),
    rfqsWithoutQuotes: Number(rfqRow.rfqs_without_quotes || 0),
    buyerSubscriptions: Number(buyerRow.buyer_subscriptions || 0),
    vendorSubscriptions: filteredPaidVendors.length,
    totalBuyers: totalBuyersCount,
    totalVendors: totalVendorsCount,
    buyerRegistration: totalBuyersCount,
    vendorRegistration: totalVendorsCount,
    totalLogins: cmLogins.length,
  };

  const rfqByMonth = new Map((rfqMonthlyRes?.rows || []).map((r) => [r.ym, r]));
  const buyerByMonth = new Map((buyerMonthlyRes?.rows || []).map((r) => [r.ym, r]));

  const totalRfqsAndSubs = [];
  const newRegistrations = [];
  const activityRfqsVsQuotes = [];

  monthsMeta.forEach((m, i) => {
    const rStats = rfqByMonth.get(m.ym) || {};
    const bStats = buyerByMonth.get(m.ym) || {};
    const vCount = Number(vendorStatsRow[`m${i}`] || 0);
    const monthPaidVendors = paidVendors.filter((v) => isWithinBounds(getItemDate(v), m.startOfMonth, m.endOfMonth)).length;

    const monthRfqs = Number(rStats.rfqs || 0);
    const monthQuotes = Number(rStats.quotes || 0);
    const monthBuyerSubs = Number(bStats.subs || 0);
    const monthNewBuyers = Number(bStats.cnt || 0);

    totalRfqsAndSubs.push({
      month: m.label,
      rfqs: monthRfqs,
      buyerSubs: monthBuyerSubs,
      vendorSubs: monthPaidVendors,
    });
    newRegistrations.push({
      month: m.label,
      newBuyers: monthNewBuyers,
      newVendors: vCount,
    });
    activityRfqsVsQuotes.push({
      month: m.label,
      rfqsRaised: monthRfqs,
      vendorQuotes: monthQuotes,
    });
  });

  return {
    kpi,
    charts: {
      months: monthsMeta.map((m) => m.label),
      totalRfqsAndSubs,
      newRegistrations,
      activityRfqsVsQuotes,
    },
  };
}

/**
 * Queries popup drilldown records directly from SQL using the exact same predicates as KPI metrics.
 */
async function loadDashboardRecordsFromDB({ type, fromDate, toDate, search }) {
  if (type === 'total_rfqs' || type === 'open_rfqs' || type === 'rfqs_without_quotes') {
    const df = buildSqlDateFilter(RFQ_COL_PG, RFQ_COL_D1, fromDate, toDate);
    const pgConds = [...(df.pgWhere ? [df.pgWhere.replace(/^WHERE /, '')] : [])];
    const d1Conds = [...(df.d1Where ? [df.d1Where.replace(/^WHERE /, '')] : [])];

    if (type === 'open_rfqs' || type === 'rfqs_without_quotes') {
      pgConds.push(OPEN_CLAUSE_PG);
      d1Conds.push(OPEN_CLAUSE_D1);
    }
    if (type === 'rfqs_without_quotes') {
      pgConds.push(`${QUOTE_LEN_PG} = 0`);
      d1Conds.push(`${QUOTE_LEN_D1} = 0`);
    }

    const pgWhere = pgConds.length ? `WHERE ${pgConds.join(' AND ')}` : '';
    const d1Where = d1Conds.length ? `WHERE ${d1Conds.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT id, rfq_number, category, status, created_at, raw FROM rfqs ${pgWhere} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
      df.params,
      {
        d1: true,
        d1Text: `SELECT id, rfq_number, category, status, created_at, raw FROM rfqs ${d1Where} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
        d1Params: df.d1Params,
      }
    );
    return { rows: (res?.rows || []).map(normalizeDbRow), exactTotal: null };
  }

  if (type === 'buyer_subscriptions' || type === 'total_buyers' || type === 'buyer_registration') {
    const df = buildSqlDateFilter(BUYER_COL_PG, BUYER_COL_D1, fromDate, toDate);
    const pgConds = [...(df.pgWhere ? [df.pgWhere.replace(/^WHERE /, '')] : [])];
    const d1Conds = [...(df.d1Where ? [df.d1Where.replace(/^WHERE /, '')] : [])];
    if (type === 'buyer_subscriptions') {
      pgConds.push(directoryKPIQueries.PAID_BUYER_SQL_PG);
      d1Conds.push(directoryKPIQueries.PAID_BUYER_SQL_D1);
    }
    const pgWhere = pgConds.length ? `WHERE ${pgConds.join(' AND ')}` : '';
    const d1Where = d1Conds.length ? `WHERE ${d1Conds.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT id, corporate_email, status, created_at, raw FROM buyer_accounts ${pgWhere} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
      df.params,
      {
        d1: true,
        d1Text: `SELECT id, corporate_email, status, created_at, raw FROM buyer_accounts ${d1Where} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
        d1Params: df.d1Params,
      }
    );
    return { rows: (res?.rows || []).map(normalizeDbRow), exactTotal: null };
  }

  if (type === 'vendor_subscriptions') {
    const df = buildSqlDateFilter('created_at', 'created_at', fromDate, toDate);
    const pgWhere = `WHERE ${directoryKPIQueries.PAID_VENDOR_SQL_PG}${df.pgAnd ? ` ${df.pgAnd}` : ''}`;
    const d1Where = `WHERE ${directoryKPIQueries.PAID_VENDOR_SQL_D1}${df.d1And ? ` ${df.d1And}` : ''}`;
    const res = await pool.query(
      `SELECT id, email, major_category, status, created_at, raw FROM vendors ${pgWhere} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
      df.params,
      {
        d1: true,
        d1Text: `SELECT id, email, major_category, status, created_at, raw FROM vendors ${d1Where} ORDER BY created_at DESC LIMIT ${MAX_POPUP_RECORDS_DEFAULT}`,
        d1Params: df.d1Params,
      }
    );
    return { rows: (res?.rows || []).map(normalizeDbRow), exactTotal: null };
  }

  if (type === 'total_vendors' || type === 'vendor_registration') {
    const df = buildSqlDateFilter('created_at', 'created_at', fromDate, toDate);
    const pgConds = [...(df.pgWhere ? [df.pgWhere.replace(/^WHERE /, '')] : [])];
    const d1Conds = [...(df.d1Where ? [df.d1Where.replace(/^WHERE /, '')] : [])];
    const pgParams = [...df.params];
    const d1Params = [...df.d1Params];
    const q = search && String(search).trim() !== '' ? `%${String(search).toLowerCase().trim()}%` : '';
    if (q) {
      pgParams.push(q);
      const pPg = `$${pgParams.length}`;
      pgConds.push(`(LOWER(COALESCE(email, '')) LIKE ${pPg} OR LOWER(COALESCE(major_category, '')) LIKE ${pPg} OR LOWER(raw::text) LIKE ${pPg})`);
      d1Params.push(q);
      const pD1 = `$${d1Params.length}`;
      d1Conds.push(`(LOWER(COALESCE(email, '')) LIKE ${pD1} OR LOWER(COALESCE(major_category, '')) LIKE ${pD1} OR LOWER(COALESCE(raw, '')) LIKE ${pD1})`);
    }
    const pgWhere = pgConds.length ? `WHERE ${pgConds.join(' AND ')}` : '';
    const d1Where = d1Conds.length ? `WHERE ${d1Conds.join(' AND ')}` : '';

    const [countRes, dataRes] = await executeQueries([
      () => pool.query(
        `SELECT COUNT(*)::int AS total FROM vendors ${pgWhere}`,
        pgParams,
        { d1: true, d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM vendors ${d1Where}`, d1Params }
      ),
      () => pool.query(
        `SELECT id, email, major_category, status, created_at, raw FROM vendors ${pgWhere} ORDER BY created_at DESC LIMIT ${MAX_VENDOR_POPUP_RECORDS}`,
        pgParams,
        { d1: true, d1Text: `SELECT id, email, major_category, status, created_at, raw FROM vendors ${d1Where} ORDER BY created_at DESC LIMIT ${MAX_VENDOR_POPUP_RECORDS}`, d1Params }
      ),
    ]);
    return {
      rows: (dataRes?.rows || []).map(normalizeDbRow),
      exactTotal: Number(countRes?.rows?.[0]?.total || 0),
    };
  }

  // total_logins
  const logs = await loadCmPortalLogins(fromDate, toDate);
  return { rows: logs, exactTotal: null };
}

/**
 * Load domain collections with DB-first and storeService-fallback logic (used for in-memory test paths & exports).
 */
async function loadCollections() {
  if (pool.hasStorage()) {
    try {
      await Promise.all([
        storeService.syncRFQsFromDB(true),
        storeService.syncBuyerAccountsFromDB(1000),
      ]);
    } catch (err) {
      logger.warn('Failed to sync domain collections for dashboard', { error: err?.message }, LOG_CATEGORY);
    }
  }

  let rfqs = (typeof storeService.getRFQs === 'function' ? storeService.getRFQs() : storeService.rfqs) || [];
  if (pool.hasStorage() && rfqs.length === 0) {
    try {
      const dbRfqs = await domainQueries.getRFQsFromDB(null, 1000);
      if (Array.isArray(dbRfqs) && dbRfqs.length > 0) {
        rfqs = dbRfqs;
      }
    } catch {
      // Non-fatal fallback
    }
  }

  let buyers = (typeof storeService.getBuyerAccounts === 'function' ? storeService.getBuyerAccounts() : storeService.buyerAccounts) || [];
  if (pool.hasStorage()) {
    try {
      const dbBuyersRes = await domainQueries.getBuyerAccountsFromDB(1000);
      if (Array.isArray(dbBuyersRes) && dbBuyersRes.length > 0) {
        buyers = dbBuyersRes;
      } else if (dbBuyersRes && Array.isArray(dbBuyersRes.accounts) && dbBuyersRes.accounts.length > 0) {
        buyers = dbBuyersRes.accounts;
      }
    } catch {
      // Non-fatal fallback
    }
  }

  let vendors = [];
  let totalVendorsCount = 0;
  if (pool.hasStorage()) {
    try {
      const vRes = await domainQueries.getVendorsPageFromDB({ limit: 1000, offset: 0 });
      if (Array.isArray(vRes)) {
        vendors = vRes;
        totalVendorsCount = vRes.length;
      } else if (vRes && Array.isArray(vRes.rows)) {
        vendors = vRes.rows;
        totalVendorsCount = typeof vRes.total === 'number' ? vRes.total : vRes.rows.length;
      }
    } catch {
      // Non-fatal fallback
    }
  }
  if (vendors.length === 0 && Array.isArray(storeService.vendors)) {
    vendors = storeService.vendors;
    totalVendorsCount = vendors.length;
  }

  return { rfqs, buyers, vendors, totalVendorsCount };
}

/**
 * Sends a structured error response for dashboard endpoints, surfacing Cloudflare D1
 * resource overload as a retryable 503 instead of masking it as an internal 500.
 */
function sendDashboardError(res, actionLabel, err, fallbackMessage) {
  const overload = d1Bridge.isD1OverloadError(err);
  const statusCode = overload ? 503 : 500;
  logger.error(`Failed to get Category Manager dashboard ${actionLabel}`, {
    error: err,
    errorName: err?.name,
    errorCode: err?.code,
    databaseOverloaded: overload,
    retryable: overload || d1Bridge.isRetryableD1Error(err),
  }, LOG_CATEGORY);
  if (overload && typeof res.setHeader === 'function') {
    res.setHeader('Retry-After', String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
  }
  return res.status(statusCode).json({
    success: false,
    ...(overload ? { retryable: true } : {}),
    error: overload ? D1_OVERLOAD_CONFIG.MESSAGE : fallbackMessage,
  });
}

/**
 * GET /api/category-manager/dashboard/metrics
 */
async function getMetrics(req, res) {
  try {
    const { startDate, endDate, preset } = req.query || {};
    const validation = validatePayload(VALIDATION_SCHEMAS.categoryManagerDashboardMetrics, req.query || {});
    if (!validation.isValid) {
      const errMsg = Object.values(validation.errors).join('; ');
      return res.status(400).json({ success: false, error: errMsg });
    }

    const { fromDate, toDate } = resolveDateBounds(preset, startDate, endDate);

    if (pool.hasStorage()) {
      const dbPayload = await loadDashboardMetricsFromDB({ fromDate, toDate });
      return res.json({
        success: true,
        ...dbPayload,
      });
    }

    const { rfqs, buyers, vendors } = await loadCollections();
    const cmLogins = await loadCmPortalLogins(fromDate, toDate);
    const hasFilter = Boolean(fromDate || toDate);

    const filteredRfqs = hasFilter ? rfqs.filter((r) => isWithinBounds(getItemDate(r), fromDate, toDate)) : rfqs;
    const openRfqs = filteredRfqs.filter(isRfqOpen);
    const rfqsWithoutQuotes = openRfqs.filter((r) => getQuoteCount(r) === 0);

    const filteredBuyers = hasFilter ? buyers.filter((b) => isWithinBounds(getItemDate(b), fromDate, toDate)) : buyers;
    const filteredVendors = hasFilter ? vendors.filter((v) => isWithinBounds(getItemDate(v), fromDate, toDate)) : vendors;

    const kpi = {
      totalRfqs: filteredRfqs.length,
      openRfqs: openRfqs.length,
      rfqsWithoutQuotes: rfqsWithoutQuotes.length,
      buyerSubscriptions: filteredBuyers.filter(isBuyerSubscribed).length,
      vendorSubscriptions: filteredVendors.filter(isVendorSubscribed).length,
      totalBuyers: filteredBuyers.length,
      totalVendors: filteredVendors.length,
      buyerRegistration: filteredBuyers.length,
      vendorRegistration: filteredVendors.length,
      totalLogins: cmLogins.length,
    };

    const monthsMeta = buildLast6MonthsMeta();
    const totalRfqsAndSubs = [];
    const newRegistrations = [];
    const activityRfqsVsQuotes = [];

    for (const m of monthsMeta) {
      const monthRfqs = rfqs.filter((r) => isWithinBounds(getItemDate(r), m.startOfMonth, m.endOfMonth));
      const monthQuotesCount = monthRfqs.reduce((acc, r) => acc + getQuoteCount(r), 0);
      const monthNewBuyers = buyers.filter((b) => isWithinBounds(getItemDate(b), m.startOfMonth, m.endOfMonth));
      const monthNewVendors = vendors.filter((v) => isWithinBounds(getItemDate(v), m.startOfMonth, m.endOfMonth));

      totalRfqsAndSubs.push({
        month: m.label,
        rfqs: monthRfqs.length,
        buyerSubs: monthNewBuyers.filter(isBuyerSubscribed).length,
        vendorSubs: monthNewVendors.filter(isVendorSubscribed).length,
      });

      newRegistrations.push({
        month: m.label,
        newBuyers: monthNewBuyers.length,
        newVendors: monthNewVendors.length,
      });

      activityRfqsVsQuotes.push({
        month: m.label,
        rfqsRaised: monthRfqs.length,
        vendorQuotes: monthQuotesCount,
      });
    }

    const charts = {
      months: monthsMeta.map((m) => m.label),
      totalRfqsAndSubs,
      newRegistrations,
      activityRfqsVsQuotes,
    };

    return res.json({
      success: true,
      kpi,
      charts,
    });
  } catch (err) {
    return sendDashboardError(res, 'metrics', err, 'Failed to retrieve dashboard metrics');
  }
}

/**
 * Selects the first non-empty, non-null value from an argument list.
 */
function pickFirst(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}

/**
 * Maps raw records into uniform popup table items.
 */
function mapRecord(type, item) {
  const raw = typeof item.raw === 'string' ? parseSafeJson(item.raw) : (item.raw || {});

  if (type === 'total_rfqs' || type === 'open_rfqs' || type === 'rfqs_without_quotes') {
    return {
      id: String(pickFirst(item.id, item.rfq_number, raw.id, raw.rfqNumber)),
      rfqNumber: pickFirst(item.rfq_number, item.rfqNumber, raw.rfqNumber, item.id),
      title: pickFirst(item.title, raw.title, item.material_description, 'RFQ Request'),
      category: pickFirst(item.category, raw.category, item.major_category, 'General'),
      status: pickFirst(item.status, raw.status, 'OPEN'),
      targetBudget: Number(pickFirst(item.target_budget, item.targetBudget, item.budget, raw.budget, 0)),
      quotesCount: getQuoteCount(item),
      createdAt: pickFirst(item.createdAt, item.created_at, raw.createdAt, raw.created_at),
    };
  }

  if (type === 'buyer_subscriptions' || type === 'total_buyers' || type === 'buyer_registration') {
    return {
      id: String(pickFirst(item.id, item.corporate_email, raw.id)),
      name: pickFirst(raw.contactPerson, item.contactPerson, raw.companyName, item.company_name, item.organizationName, raw.organizationName, 'Enterprise Buyer'),
      email: pickFirst(item.corporate_email, item.email, raw.corporateEmail, raw.email),
      organizationName: pickFirst(raw.companyName, item.company_name, item.organizationName, raw.organizationName, 'Procucev Buyer'),
      subscriptionPlan: pickFirst(item.subscriptionPlan, raw.subscriptionPlan, item.trialActive ? 'Trial Period' : 'Free_trial'),
      location: raw.city ? `${raw.city}, ${pickFirst(raw.state, 'India')}` : pickFirst(item.city, 'India'),
      createdAt: pickFirst(item.createdAt, item.created_at, raw.createdAt, raw.created_at),
    };
  }

  if (type === 'vendor_subscriptions' || type === 'total_vendors' || type === 'vendor_registration') {
    return {
      id: String(pickFirst(item.id, item.email, raw.id)),
      name: pickFirst(item.name, raw.name, raw.contactPerson, 'Enterprise Supplier'),
      email: pickFirst(item.email, raw.email),
      companyName: pickFirst(item.name, raw.name, 'Enterprise Supplier'),
      category: pickFirst(item.major_category, item.majorCategory, raw.majorCategory, 'Multi-Category'),
      subscriptionPlan: pickFirst(item.subscriptionPlan, raw.subscriptionPlan, 'premium'),
      location: pickFirst(item.location, raw.location, raw.city, 'India'),
      createdAt: pickFirst(item.createdAt, item.created_at, raw.createdAt, raw.created_at),
    };
  }

  // total_logins
  return {
    id: String(pickFirst(item.id)),
    userName: pickFirst(item.userName, item.user_name, 'Category Manager Staff'),
    email: pickFirst(item.email),
    role: 'Category Manager (Internal)',
    loginAt: pickFirst(item.loginAt, item.login_at, item.createdAt, item.created_at),
    logoutAt: pickFirst(item.logoutAt, item.logout_at),
    durationSeconds: Number(pickFirst(item.durationSeconds, item.duration_seconds, 0)),
    status: pickFirst(item.status, 'LOGGED_OUT'),
    deviceInfo: pickFirst(item.deviceInfo, item.device_info, 'Desktop (Chrome)'),
    ipAddress: pickFirst(item.ipAddress, item.ip_address, '106.51.72.10'),
  };
}

const VALID_RECORD_TYPES = Object.freeze([
  'total_rfqs',
  'open_rfqs',
  'rfqs_without_quotes',
  'buyer_subscriptions',
  'total_buyers',
  'buyer_registration',
  'vendor_subscriptions',
  'total_vendors',
  'vendor_registration',
  'total_logins',
]);

/**
 * GET /api/category-manager/dashboard/records
 */
async function getRecords(req, res) {
  try {
    const { type, startDate, endDate, preset, search } = req.query || {};
    const validation = validatePayload(VALIDATION_SCHEMAS.categoryManagerDashboardRecords, req.query || {});
    if (!validation.isValid) {
      const errMsg = Object.values(validation.errors).join('; ');
      return res.status(400).json({ success: false, error: errMsg });
    }

    if (!VALID_RECORD_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `Invalid record type: ${type}` });
    }

    const { fromDate, toDate } = resolveDateBounds(preset, startDate, endDate);
    const hasFilter = Boolean(fromDate || toDate);

    let rawList = [];
    let exactTotal = null;

    if (pool.hasStorage()) {
      const dbRes = await loadDashboardRecordsFromDB({ type, fromDate, toDate, search });
      rawList = dbRes.rows;
      exactTotal = dbRes.exactTotal;
    } else {
      const { rfqs, buyers, vendors } = await loadCollections();
      const filteredRfqs = hasFilter ? rfqs.filter((r) => isWithinBounds(getItemDate(r), fromDate, toDate)) : rfqs;
      const filteredBuyers = hasFilter ? buyers.filter((b) => isWithinBounds(getItemDate(b), fromDate, toDate)) : buyers;
      const filteredVendors = hasFilter ? vendors.filter((v) => isWithinBounds(getItemDate(v), fromDate, toDate)) : vendors;

      if (type === 'total_rfqs') {
        rawList = filteredRfqs;
      } else if (type === 'open_rfqs') {
        rawList = filteredRfqs.filter(isRfqOpen);
      } else if (type === 'rfqs_without_quotes') {
        rawList = filteredRfqs.filter((r) => isRfqOpen(r) && getQuoteCount(r) === 0);
      } else if (type === 'buyer_subscriptions') {
        rawList = filteredBuyers.filter(isBuyerSubscribed);
      } else if (type === 'total_buyers' || type === 'buyer_registration') {
        rawList = filteredBuyers;
      } else if (type === 'vendor_subscriptions') {
        rawList = filteredVendors.filter(isVendorSubscribed);
      } else if (type === 'total_vendors' || type === 'vendor_registration') {
        rawList = filteredVendors;
      } else {
        rawList = await loadCmPortalLogins(fromDate, toDate);
      }
    }

    let records = rawList.map((item) => mapRecord(type, item));

    // Optional quick search filter across mapped records
    if (search && String(search).trim() !== '' && exactTotal === null) {
      const q = String(search).toLowerCase().trim();
      records = records.filter((r) => {
        return Object.values(r).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
      });
    }

    return res.json({
      success: true,
      type,
      total: exactTotal !== null ? exactTotal : records.length,
      records,
    });
  } catch (err) {
    return sendDashboardError(res, 'records', err, 'Failed to retrieve dashboard records');
  }
}

module.exports = {
  resolveDateBounds,
  isWithinBounds,
  isRfqOpen,
  getQuoteCount,
  isBuyerSubscribed,
  isVendorSubscribed,
  getItemDate,
  loadCollections,
  loadDashboardMetricsFromDB,
  loadDashboardRecordsFromDB,
  getMetrics,
  getRecords,
};
