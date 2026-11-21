// ==============================================================================
// DIRECTORY KPI QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Live database aggregate queries for Buyers Directory and Sellers Directory KPI cards.
// ==============================================================================

const pool = require('./pool');
const storeService = require('../services/storeService');

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
    subscriptionBuyers: list.filter((b) => b.subscriptionPlan && b.subscriptionPlan !== 'free_trial' && b.subscriptionPlan !== 'none').length,
    modeCounts,
  };
}

function computeSellerKPIStatsFromVendors(vendors = []) {
  const list = Array.isArray(vendors) ? vendors.filter(Boolean) : [];
  return {
    totalSuppliers: list.length,
    networkSuppliers: list.filter((v) => v.source === 'procucev_network' || (!v.buyerId && !v.buyerAccountId)).length,
    buyerUploaded: list.filter((v) => v.source === 'buyer_uploaded' || v.buyerId || v.buyerAccountId).length,
    verifiedActive: list.filter((v) => String(v.status || '').toUpperCase().includes('ACTIVE') || String(v.status || '').toUpperCase().includes('VERIFIED')).length,
  };
}

async function getBuyerDirectoryKPIStatsFromDB() {
  if (!pool.hasStorage()) {
    return computeBuyerKPIStatsFromAccounts(storeService.getBuyerAccounts() || []);
  }
  const pgSql = `
    SELECT 
      COUNT(*)::int AS total_buyers,
      COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED') OR raw->>'status' IN ('ACTIVE_VERIFIED', 'VERIFIED') THEN 1 END)::int AS verified_buyers,
      COUNT(CASE WHEN (raw->>'subscriptionPlan' IS NOT NULL AND raw->>'subscriptionPlan' NOT IN ('free_trial', 'none')) OR (raw->>'subscriptionTier' IS NOT NULL AND lower(raw->>'subscriptionTier') NOT LIKE '%free%') THEN 1 END)::int AS subscription_buyers,
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
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_0' OR json_extract(raw, '$.sourcingMode') IS NULL THEN 1 END) AS INTEGER) AS mode_0,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_1' THEN 1 END) AS INTEGER) AS mode_1,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_2' THEN 1 END) AS INTEGER) AS mode_2,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.sourcingMode') = 'Mode_3' THEN 1 END) AS INTEGER) AS mode_3
    FROM buyer_accounts
  `;
  try {
    const result = await pool.query(pgSql, [], { d1: true, d1Text: d1Sql, useCache: true, tag: 'buyer_accounts', ttlMs: 15000 });
    const row = result.rows?.[0] || {};
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
      COUNT(CASE WHEN raw->>'source' = 'procucev_network' OR (raw->>'buyerId' IS NULL AND raw->>'buyerAccountId' IS NULL) THEN 1 END)::int AS network_suppliers,
      COUNT(CASE WHEN raw->>'source' = 'buyer_uploaded' OR raw->>'buyerId' IS NOT NULL OR raw->>'buyerAccountId' IS NOT NULL THEN 1 END)::int AS buyer_uploaded,
      COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED', 'ACTIVE') OR raw->>'status' ILIKE '%ACTIVE%' OR raw->>'status' ILIKE '%VERIFIED%' THEN 1 END)::int AS verified_active
    FROM vendors
  `;
  const d1Sql = `
    SELECT 
      CAST(COUNT(*) AS INTEGER) AS total_suppliers,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.source') = 'procucev_network' OR (json_extract(raw, '$.buyerId') IS NULL AND json_extract(raw, '$.buyerAccountId') IS NULL) THEN 1 END) AS INTEGER) AS network_suppliers,
      CAST(COUNT(CASE WHEN json_extract(raw, '$.source') = 'buyer_uploaded' OR json_extract(raw, '$.buyerId') IS NOT NULL OR json_extract(raw, '$.buyerAccountId') IS NOT NULL THEN 1 END) AS INTEGER) AS buyer_uploaded,
      CAST(COUNT(CASE WHEN status IN ('ACTIVE_VERIFIED', 'VERIFIED', 'ACTIVE') OR json_extract(raw, '$.status') LIKE '%ACTIVE%' OR json_extract(raw, '$.status') LIKE '%VERIFIED%' THEN 1 END) AS INTEGER) AS verified_active
    FROM vendors
  `;
  try {
    const result = await pool.query(pgSql, [], { d1: true, d1Text: d1Sql, useCache: true, tag: 'vendors', ttlMs: 15000 });
    const row = result.rows?.[0] || {};
    return {
      totalSuppliers: Number(row.total_suppliers) || 0,
      networkSuppliers: Number(row.network_suppliers) || 0,
      buyerUploaded: Number(row.buyer_uploaded) || 0,
      verifiedActive: Number(row.verified_active) || 0,
    };
  } catch {
    return computeSellerKPIStatsFromVendors(storeService.getVendors() || []);
  }
}

module.exports = {
  computeBuyerKPIStatsFromAccounts,
  computeSellerKPIStatsFromVendors,
  getBuyerDirectoryKPIStatsFromDB,
  getSellerDirectoryKPIStatsFromDB,
};
