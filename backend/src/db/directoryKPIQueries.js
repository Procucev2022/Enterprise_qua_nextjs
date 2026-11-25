// ==============================================================================
// DIRECTORY KPI QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Live database aggregate queries for Buyers Directory and Sellers Directory KPI cards.
// ==============================================================================

const pool = require('./pool');
const storeService = require('../services/storeService');
const { resolveStandardizedCommunicationCategory } = require('../config/constants');

function getDefaultOutreachAnalytics() {
  return {
    totalOutreach: 0,
    byCategory: {
      'Credit / Quote (Buyer / Seller)': 0,
      'Follow-up / New': 0,
      'Demo Schedule': 0,
      'Send Proposal': 0,
      'Send Corporate Email': 0,
      'Onboarding Process': 0,
      'Registration Task': 0,
      'Internal Operations (Others)': 0,
    },
    byChannel: {
      Call: 0,
      SMS: 0,
      WhatsApp: 0,
      Email: 0,
    },
  };
}

async function getCommunicationOutreachAnalyticsFromDB({ accountType = 'all' } = {}) {
  const analytics = getDefaultOutreachAnalytics();
  if (!pool.hasStorage()) {
    return analytics;
  }
  const conditions = [];
  const params = [];
  if (accountType && accountType !== 'all') {
    if (accountType === 'buyer') {
      conditions.push("lower(account_type) = 'buyer'");
    } else if (accountType === 'seller' || accountType === 'vendor') {
      conditions.push("lower(account_type) IN ('seller', 'vendor')");
    }
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT channel, metadata
    FROM payment_dues_communications
    ${whereClause}
  `;
  try {
    const result = await pool.query(sql, params, { d1: true, d1Text: sql, useCache: true, tag: 'payment_dues_communications', ttlMs: 10000 });
    const rows = result?.rows || [];
    for (const r of rows) {
      let meta = {};
      try {
        meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {});
      } catch {
        meta = {};
      }
      const cat = resolveStandardizedCommunicationCategory(meta?.category || meta?.templateType || meta?.scenarioId);
      analytics.byCategory[cat] = (analytics.byCategory[cat] || 0) + 1;

      const ch = String(r.channel || '').toUpperCase();
      if (ch === 'CALL') analytics.byChannel.Call++;
      else if (ch === 'SMS') analytics.byChannel.SMS++;
      else if (ch === 'WHATSAPP') analytics.byChannel.WhatsApp++;
      else if (ch === 'EMAIL') analytics.byChannel.Email++;
      else if (ch === 'BOTH') {
        analytics.byChannel.Email++;
        analytics.byChannel.SMS++;
      }
    }
    analytics.totalOutreach = rows.length;
    return analytics;
  } catch {
    return analytics;
  }
}

const FREE_VENDOR_PLANS = Object.freeze(['none', 'free', 'free_tier', 'free_trial', 'premium']);
const FREE_BUYER_PLANS = Object.freeze(['free_trial', 'free_tier', 'free', 'none']);

function isPaidVendorRecord(v) {
  if (!v) return false;
  const raw = v.raw && typeof v.raw === 'object' ? v.raw : {};
  const plan = String(
    v.subscriptionPlan || v.subscribedPlan || v.plan || raw.subscriptionPlan || raw.subscribedPlan || raw.plan || ''
  ).toLowerCase().trim();
  const isSub =
    v.isSubscribed === true ||
    v.isSubscribed === 'true' ||
    raw.isSubscribed === true ||
    raw.isSubscribed === 'true' ||
    raw.isSubscribed === 1;
  return Boolean((plan && !FREE_VENDOR_PLANS.includes(plan)) || isSub);
}

function isPaidBuyerRecord(b) {
  if (!b) return false;
  const raw = b.raw && typeof b.raw === 'object' ? b.raw : {};
  const plan = String(b.subscriptionPlan || raw.subscriptionPlan || b.plan || raw.plan || '').toLowerCase().trim();
  const tier = String(b.subscriptionTier || raw.subscriptionTier || '').toLowerCase().trim();
  const isSub =
    b.isSubscribed === true ||
    b.isSubscribed === 'true' ||
    raw.isSubscribed === true ||
    raw.isSubscribed === 'true' ||
    raw.isSubscribed === 1;
  return Boolean(
    (plan && !FREE_BUYER_PLANS.includes(plan)) ||
    (tier && !tier.includes('free')) ||
    isSub
  );
}

function computeBuyerKPIStatsFromAccounts(buyers = []) {
  const list = Array.isArray(buyers) ? buyers.filter(Boolean) : [];
  const modeCounts = { Mode_0: 0, Mode_1: 0, Mode_2: 0, Mode_3: 0 };
  for (const b of list) {
    const m = b.sourcingMode || 'Mode_0';
    if (modeCounts[m] !== undefined) modeCounts[m]++;
    else modeCounts.Mode_0++;
  }
  return {
    totalBuyers: list.length,
    verifiedBuyers: list.filter((b) => b.status === 'ACTIVE_VERIFIED' || b.status === 'VERIFIED').length,
    subscriptionBuyers: list.filter(isPaidBuyerRecord).length,
    modeCounts,
    outreachAnalytics: getDefaultOutreachAnalytics(),
  };
}

function computeSellerKPIStatsFromVendors(vendors = []) {
  const list = Array.isArray(vendors) ? vendors.filter(Boolean) : [];
  const subscriptionVendors = list.filter(isPaidVendorRecord).length;
  return {
    totalSuppliers: list.length,
    subscriptionVendors,
    subscriptionVendorsCount: subscriptionVendors,
    networkSuppliers: list.filter((v) => v.source === 'procucev_network' || (!v.buyerId && !v.buyerAccountId)).length,
    buyerUploaded: list.filter((v) => v.source === 'buyer_uploaded' || v.buyerId || v.buyerAccountId).length,
    verifiedActive: list.filter((v) => String(v.status || '').toUpperCase().includes('ACTIVE') || String(v.status || '').toUpperCase().includes('VERIFIED')).length,
    outreachAnalytics: getDefaultOutreachAnalytics(),
  };
}

const PAID_BUYER_SQL_PG = `((raw->>'subscriptionPlan' IS NOT NULL AND lower(raw->>'subscriptionPlan') NOT IN ('free_trial', 'free_tier', 'free', 'none', '')) OR (raw->>'subscriptionTier' IS NOT NULL AND lower(raw->>'subscriptionTier') NOT LIKE '%free%') OR raw->>'isSubscribed' = 'true')`;
const PAID_BUYER_SQL_D1 = `((json_extract(raw, '$.subscriptionPlan') IS NOT NULL AND lower(json_extract(raw, '$.subscriptionPlan')) NOT IN ('free_trial', 'free_tier', 'free', 'none', '')) OR (json_extract(raw, '$.subscriptionTier') IS NOT NULL AND lower(json_extract(raw, '$.subscriptionTier')) NOT LIKE '%free%') OR json_extract(raw, '$.isSubscribed') = 1 OR json_extract(raw, '$.isSubscribed') = 'true')`;

const PAID_VENDOR_SQL_PG = `((raw->>'subscriptionPlan' IS NOT NULL AND lower(raw->>'subscriptionPlan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (raw->>'subscribedPlan' IS NOT NULL AND lower(raw->>'subscribedPlan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (raw->>'plan' IS NOT NULL AND lower(raw->>'plan') NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR raw->>'isSubscribed' = 'true')`;
const PAID_VENDOR_SQL_D1 = `((json_extract(raw, '$.subscriptionPlan') IS NOT NULL AND lower(json_extract(raw, '$.subscriptionPlan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (json_extract(raw, '$.subscribedPlan') IS NOT NULL AND lower(json_extract(raw, '$.subscribedPlan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR (json_extract(raw, '$.plan') IS NOT NULL AND lower(json_extract(raw, '$.plan')) NOT IN ('none', 'free', 'free_tier', 'free_trial', 'premium', '')) OR json_extract(raw, '$.isSubscribed') = 1 OR json_extract(raw, '$.isSubscribed') = 'true')`;

async function getBuyerDirectoryKPIStatsFromDB() {
  if (!pool.hasStorage()) {
    return computeBuyerKPIStatsFromAccounts(storeService.getBuyerAccounts() || []);
  }
  const pgSql = `
    SELECT 
      COUNT(*)::int AS total_buyers,
      COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED') OR raw->>'status' IN ('ACTIVE_VERIFIED', 'VERIFIED') THEN 1 END)::int AS verified_buyers,
      COUNT(CASE WHEN (raw->>'subscriptionPlan' IS NOT NULL AND raw->>'subscriptionPlan' NOT IN ('free_trial', 'none')) OR (raw->>'subscriptionTier' IS NOT NULL AND lower(raw->>'subscriptionTier') NOT LIKE '%free%') THEN 1 END)::int AS subscription_buyers,
      COUNT(CASE WHEN ${PAID_BUYER_SQL_PG} THEN 1 END)::int AS subscription_buyers,
      COUNT(CASE WHEN raw->>'sourcingMode' = 'Mode_0' OR raw->>'sourcingMode' IS NULL THEN 1 END)::int AS mode_0,
      COUNT(CASE WHEN raw->>'sourcingMode' = 'Mode_1' THEN 1 END)::int AS mode_1,
      COUNT(CASE WHEN raw->>'sourcingMode' = 'Mode_2' THEN 1 END)::int AS mode_2,
      COUNT(CASE WHEN raw->>'sourcingMode' = 'Mode_3' THEN 1 END)::int AS mode_3
    FROM buyer_accounts
  `;
  const d1Sql = `
    SELECT 
      CAST(COUNT(*) AS INTEGER) AS total_buyers,
      CAST(COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED') OR json_extract(raw, '$.status') IN ('ACTIVE_VERIFIED', 'VERIFIED') THEN 1 END) AS INTEGER) AS verified_buyers,
      CAST(COUNT(CASE WHEN (json_extract(raw, '$.subscriptionPlan') IS NOT NULL AND json_extract(raw, '$.subscriptionPlan') NOT IN ('free_trial', 'none')) OR (json_extract(raw, '$.subscriptionTier') IS NOT NULL AND lower(json_extract(raw, '$.subscriptionTier')) NOT LIKE '%free%') THEN 1 END) AS INTEGER) AS subscription_buyers,
      CAST(COUNT(CASE WHEN ${PAID_BUYER_SQL_D1} THEN 1 END) AS INTEGER) AS subscription_buyers,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_0' OR json_extract(raw, '$.sourcingMode') IS NULL THEN 1 END) AS INTEGER) AS mode_0,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_1' THEN 1 END) AS INTEGER) AS mode_1,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_2' THEN 1 END) AS INTEGER) AS mode_2,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_3' THEN 1 END) AS INTEGER) AS mode_3
    FROM buyer_accounts
  `;
  try {
    const result = await pool.query(pgSql, [], { d1: true, d1Text: d1Sql, useCache: true, tag: 'buyer_accounts', ttlMs: 15000 });
    const row = result.rows?.[0] || {};
    const outreachAnalytics = await getCommunicationOutreachAnalyticsFromDB({ accountType: 'buyer' });
    return {
      totalBuyers: Number(row.total_buyers) || 0,
      verifiedBuyers: Number(row.verified_buyers) || 0,
      subscriptionBuyers: Number(row.subscription_buyers) || 0,
      modeCounts: {
        Mode_0: Number(row.mode_0) || 0,
        Mode_1: Number(row.mode_1) || 0,
        Mode_2: Number(row.mode_2) || 0,
        Mode_3: Number(row.mode_3) || 0,
      },
      outreachAnalytics,
    };
  } catch {
    return computeBuyerKPIStatsFromAccounts(storeService.getBuyerAccounts() || []);
  }
}

async function getSellerDirectoryKPIStatsFromDB() {
  if (!pool.hasStorage()) {
    return computeSellerKPIStatsFromVendors(storeService.getVendors() || []);
  }
  const pgSql = `
    SELECT 
      COUNT(*)::int AS total_suppliers,
      COUNT(CASE WHEN (raw->>'subscriptionPlan' IS NOT NULL AND raw->>'subscriptionPlan' NOT IN ('none', 'free_tier')) OR (raw->>'subscribedPlan' IS NOT NULL AND raw->>'subscribedPlan' NOT IN ('none', 'free_tier')) OR (raw->>'plan' IS NOT NULL AND raw->>'plan' NOT IN ('none', 'free_tier')) OR raw->>'isSubscribed' = 'true' THEN 1 END)::int AS subscription_vendors,
      COUNT(CASE WHEN ${PAID_VENDOR_SQL_PG} THEN 1 END)::int AS subscription_vendors,
      COUNT(CASE WHEN raw->>'source' = 'procucev_network' OR (raw->>'buyerId' IS NULL AND raw->>'buyerAccountId' IS NULL) THEN 1 END)::int AS network_suppliers,
      COUNT(CASE WHEN raw->>'source' = 'buyer_uploaded' OR raw->>'buyerId' IS NOT NULL OR raw->>'buyerAccountId' IS NOT NULL THEN 1 END)::int AS buyer_uploaded,
      COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED', 'ACTIVE') OR raw->>'status' ILIKE '%ACTIVE%' OR raw->>'status' ILIKE '%VERIFIED%' THEN 1 END)::int AS verified_active
    FROM vendors
  `;
  const d1Sql = `
    SELECT 
      CAST(COUNT(*) AS INTEGER) AS total_suppliers,
      CAST(COUNT(CASE WHEN (json_extract(raw, '$.subscriptionPlan') IS NOT NULL AND json_extract(raw, '$.subscriptionPlan') NOT IN ('none', 'free_tier')) OR (json_extract(raw, '$.subscribedPlan') IS NOT NULL AND json_extract(raw, '$.subscribedPlan') NOT IN ('none', 'free_tier')) OR (json_extract(raw, '$.plan') IS NOT NULL AND json_extract(raw, '$.plan') NOT IN ('none', 'free_tier')) OR json_extract(raw, '$.isSubscribed') = 1 OR json_extract(raw, '$.isSubscribed') = 'true' THEN 1 END) AS INTEGER) AS subscription_vendors,
      CAST(COUNT(CASE WHEN ${PAID_VENDOR_SQL_D1} THEN 1 END) AS INTEGER) AS subscription_vendors,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.source') = 'procucev_network' OR (json_extract(raw, '$.buyerId') IS NULL AND json_extract(raw, '$.buyerAccountId') IS NULL) THEN 1 END) AS INTEGER) AS network_suppliers,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.source') = 'buyer_uploaded' OR json_extract(raw, '$.buyerId') IS NOT NULL OR json_extract(raw, '$.buyerAccountId') IS NOT NULL THEN 1 END) AS INTEGER) AS buyer_uploaded,
      CAST(COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED', 'ACTIVE') OR json_extract(raw, '$.status') LIKE '%ACTIVE%' OR json_extract(raw, '$.status') LIKE '%VERIFIED%' THEN 1 END) AS INTEGER) AS verified_active
    FROM vendors
  `;
  try {
    const result = await pool.query(pgSql, [], { d1: true, d1Text: d1Sql, useCache: true, tag: 'vendors', ttlMs: 15000 });
    const row = result.rows?.[0] || {};
    const outreachAnalytics = await getCommunicationOutreachAnalyticsFromDB({ accountType: 'seller' });
    return {
      totalSuppliers: Number(row.total_suppliers) || 0,
      subscriptionVendors: Number(row.subscription_vendors) || 0,
      subscriptionVendorsCount: Number(row.subscription_vendors) || 0,
      networkSuppliers: Number(row.network_suppliers) || 0,
      buyerUploaded: Number(row.buyer_uploaded) || 0,
      verifiedActive: Number(row.verified_active) || 0,
      outreachAnalytics,
    };
  } catch {
    return computeSellerKPIStatsFromVendors(storeService.getVendors() || []);
  }
}

module.exports = {
  FREE_VENDOR_PLANS,
  FREE_BUYER_PLANS,
  PAID_BUYER_SQL_PG,
  PAID_BUYER_SQL_D1,
  PAID_VENDOR_SQL_PG,
  PAID_VENDOR_SQL_D1,
  isPaidBuyerRecord,
  isPaidVendorRecord,
  computeBuyerKPIStatsFromAccounts,
  computeSellerKPIStatsFromVendors,
  getCommunicationOutreachAnalyticsFromDB,
  getBuyerDirectoryKPIStatsFromDB,
  getSellerDirectoryKPIStatsFromDB,
};
