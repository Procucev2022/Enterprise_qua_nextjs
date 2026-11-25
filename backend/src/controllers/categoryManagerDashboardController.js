// ==============================================================================
// CATEGORY MANAGER DASHBOARD CONTROLLER
// ==============================================================================
// Provides real-time live database metrics, monthly telemetry trends, and
// drill-down records for the Category Manager Operational Desk.
// ==============================================================================

const storeService = require('../services/storeService');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const loginLogsQueries = require('../db/loginLogsQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

const LOG_CATEGORY = 'CM_DASHBOARD_CONTROLLER';

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
 * Helper to determine if a buyer account holds an active subscription/trial.
 */
function isBuyerSubscribed(buyer) {
  if (!buyer) return false;
  const raw = typeof buyer.raw === 'string' ? parseSafeJson(buyer.raw) : (buyer.raw || {});
  const plan = buyer.subscriptionPlan || raw.subscriptionPlan || buyer.plan || raw.plan;
  const isTrial = buyer.trialActive === true || raw.trialActive === true;
  return Boolean(plan || isTrial || buyer.isSubscribed || raw.isSubscribed);
}

/**
 * Helper to determine if a vendor account holds an active subscription.
 */
function isVendorSubscribed(vendor) {
  if (!vendor) return false;
  const raw = typeof vendor.raw === 'string' ? parseSafeJson(vendor.raw) : (vendor.raw || {});
  const plan = vendor.subscriptionPlan || raw.subscriptionPlan || vendor.subscribedPlan || raw.subscribedPlan || vendor.plan || raw.plan;
  return Boolean(plan || vendor.isSubscribed || raw.isSubscribed);
}

/**
 * Load domain collections with DB-first and storeService-fallback logic.
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
    const { rfqs, buyers, vendors, totalVendorsCount } = await loadCollections();

    // Query Category Manager Portal Logins (Internal Staff ONLY)
    let cmLogins = [];
    try {
      const logsResult = await loginLogsQueries.listLoginLogs({
        userType: 'category_manager',
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        dateRangePreset: preset || undefined,
        syncDb: true,
        limit: 200,
      });
      if (logsResult && Array.isArray(logsResult.logs)) {
        cmLogins = logsResult.logs.filter((log) => log.userType === 'category_manager');
      }
    } catch {
      cmLogins = [];
    }

    // Platform-wide cumulative totals (not constrained by date presets)
    const allOpenRfqs = rfqs.filter(isRfqOpen);
    const allRfqsWithoutQuotes = allOpenRfqs.filter((r) => getQuoteCount(r) === 0);

    const buyerSubsCount = buyers.filter(isBuyerSubscribed).length;
    const vendorSubsCount = vendors.filter(isVendorSubscribed).length;

    // Period-filtered registration & login metrics
    const newBuyersList = buyers.filter((b) => isWithinBounds(getItemDate(b), fromDate, toDate));
    const newVendorsList = vendors.filter((v) => isWithinBounds(getItemDate(v), fromDate, toDate));

    const boundedCmLogins = cmLogins.filter((l) => isWithinBounds(getItemDate(l), fromDate, toDate));

    const kpi = {
      totalRfqs: rfqs.length,
      openRfqs: allOpenRfqs.length,
      rfqsWithoutQuotes: allRfqsWithoutQuotes.length,
      buyerSubscriptions: buyerSubsCount,
      vendorSubscriptions: vendorSubsCount,
      totalBuyers: buyers.length,
      totalVendors: totalVendorsCount,
      buyerRegistration: newBuyersList.length,
      vendorRegistration: newVendorsList.length,
      totalLogins: boundedCmLogins.length,
    };

    // Calculate Last 6 Months Chart Series
    const now = new Date();
    const monthsMeta = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsMeta.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        label: MONTH_NAMES[d.getMonth()],
      });
    }

    const totalRfqsAndSubs = [];
    const newRegistrations = [];
    const activityRfqsVsQuotes = [];

    for (const m of monthsMeta) {
      const startOfMonth = new Date(m.year, m.month, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(m.year, m.month + 1, 0, 23, 59, 59, 999);

      const monthRfqs = rfqs.filter((r) => isWithinBounds(getItemDate(r), startOfMonth, endOfMonth));
      const monthQuotesCount = monthRfqs.reduce((acc, r) => acc + getQuoteCount(r), 0);
      const monthNewBuyers = buyers.filter((b) => isWithinBounds(getItemDate(b), startOfMonth, endOfMonth));
      const monthNewVendors = vendors.filter((v) => isWithinBounds(getItemDate(v), startOfMonth, endOfMonth));

      totalRfqsAndSubs.push({
        month: m.label,
        rfqs: monthRfqs.length,
        buyerSubs: buyerSubsCount,
        vendorSubs: vendorSubsCount,
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
    logger.error('Failed to get Category Manager dashboard metrics', { error: err.message }, LOG_CATEGORY);
    return res.status(500).json({ success: false, error: 'Failed to retrieve dashboard metrics' });
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
      name: pickFirst(raw.contactPerson, item.contactPerson, item.company_name, item.organizationName, 'Enterprise Buyer'),
      email: pickFirst(item.corporate_email, item.email, raw.corporateEmail, raw.email),
      organizationName: pickFirst(item.company_name, item.organizationName, raw.organizationName, 'Procucev Buyer'),
      subscriptionPlan: pickFirst(item.subscriptionPlan, raw.subscriptionPlan, item.trialActive ? 'Trial Period' : 'Enterprise Standard'),
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
      subscriptionPlan: pickFirst(item.subscriptionPlan, raw.subscriptionPlan, 'Supplier Basic'),
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

    const { fromDate, toDate } = resolveDateBounds(preset, startDate, endDate);
    const { rfqs, buyers, vendors } = await loadCollections();

    let rawList = [];

    if (type === 'total_rfqs') {
      rawList = rfqs;
    } else if (type === 'open_rfqs') {
      rawList = rfqs.filter(isRfqOpen);
    } else if (type === 'rfqs_without_quotes') {
      rawList = rfqs.filter((r) => isRfqOpen(r) && getQuoteCount(r) === 0);
    } else if (type === 'buyer_subscriptions') {
      rawList = buyers.filter(isBuyerSubscribed);
    } else if (type === 'total_buyers') {
      rawList = buyers;
    } else if (type === 'buyer_registration') {
      rawList = buyers.filter((b) => isWithinBounds(getItemDate(b), fromDate, toDate));
    } else if (type === 'vendor_subscriptions') {
      rawList = vendors.filter(isVendorSubscribed);
    } else if (type === 'total_vendors') {
      rawList = vendors;
    } else if (type === 'vendor_registration') {
      rawList = vendors.filter((v) => isWithinBounds(getItemDate(v), fromDate, toDate));
    } else if (type === 'total_logins') {
      try {
        const logsResult = await loginLogsQueries.listLoginLogs({
          userType: 'category_manager',
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          dateRangePreset: preset || undefined,
          search: search || undefined,
          syncDb: true,
          limit: 200,
        });
        if (logsResult && Array.isArray(logsResult.logs)) {
          rawList = logsResult.logs.filter(
            (log) => log.userType === 'category_manager' && isWithinBounds(getItemDate(log), fromDate, toDate)
          );
        }
      } catch {
        rawList = [];
      }
    } else {
      return res.status(400).json({ success: false, error: `Invalid record type: ${type}` });
    }

    let records = rawList.map((item) => mapRecord(type, item));

    // Optional quick search filter across mapped records
    if (search && String(search).trim() !== '') {
      const q = String(search).toLowerCase().trim();
      records = records.filter((r) => {
        return Object.values(r).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
      });
    }

    return res.json({
      success: true,
      type,
      total: records.length,
      records,
    });
  } catch (err) {
    logger.error('Failed to get Category Manager dashboard records', { error: err.message }, LOG_CATEGORY);
    return res.status(500).json({ success: false, error: 'Failed to retrieve dashboard records' });
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
  getMetrics,
  getRecords,
};
