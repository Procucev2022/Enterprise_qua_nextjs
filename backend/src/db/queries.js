const poolModule = require('./pool');

// ==============================================================================
// 1. BUYER ACCOUNTS QUERIES
// ==============================================================================

async function getBuyerAccountsFromDB() {
  if (!poolModule.pool) return [];
  const res = await poolModule.query(`
    SELECT
      id,
      organization_name AS "organizationName",
      corporate_email AS "corporateEmail",
      contact_person AS "contactPerson",
      contact_phone AS "mobileNumber",
      industry_vertical AS "industrySector",
      account_source AS "accountSource",
      subscription AS "subscriptionPlan",
      total_rfqs_created AS "totalRFQsCreated",
      total_spend AS "totalSpend",
      created_date AS "createdDate",
      sync_timestamp AS "syncTimestamp",
      sourcing_mode AS "sourcingMode",
      status,
      gstin,
      primary_plant_location AS "primaryPlantLocation",
      supported_major_categories AS "supportedMajorCategories",
      supported_minor_categories AS "supportedMinorCategories",
      remaining_free_rfqs AS "remainingFreeRFQs"
    FROM buyer_accounts
    ORDER BY created_at DESC
  `);
  return res.rows;
}

async function upsertBuyerAccountInDB(acc) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO buyer_accounts (
      id, organization_name, corporate_email, contact_person, contact_phone,
      industry_vertical, account_source, subscription, total_rfqs_created,
      total_spend, is_verified, created_date, sync_timestamp, sourcing_mode,
      status, gstin, primary_plant_location, supported_major_categories,
      supported_minor_categories, remaining_free_rfqs
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (id) DO UPDATE SET
      organization_name = EXCLUDED.organization_name,
      contact_person = EXCLUDED.contact_person,
      contact_phone = EXCLUDED.contact_phone,
      subscription = EXCLUDED.subscription,
      total_rfqs_created = EXCLUDED.total_rfqs_created,
      total_spend = EXCLUDED.total_spend,
      sync_timestamp = CURRENT_TIMESTAMP,
      sourcing_mode = EXCLUDED.sourcing_mode,
      status = EXCLUDED.status,
      supported_major_categories = EXCLUDED.supported_major_categories,
      supported_minor_categories = EXCLUDED.supported_minor_categories,
      remaining_free_rfqs = EXCLUDED.remaining_free_rfqs
  `,
    [
      acc.id,
      acc.organizationName,
      acc.corporateEmail,
      acc.contactPerson,
      acc.mobileNumber || acc.contactPhone,
      acc.industrySector || acc.industryVertical,
      acc.accountSource,
      acc.subscriptionPlan || acc.subscription,
      acc.totalRFQsCreated || 0,
      acc.totalSpend || '$0',
      acc.isVerified || true,
      acc.createdDate || new Date().toISOString().substring(0, 10),
      acc.sourcingMode || 'mode_1',
      acc.status || 'ACTIVE_VERIFIED',
      acc.gstin,
      acc.primaryPlantLocation,
      JSON.stringify(acc.supportedMajorCategories || []),
      JSON.stringify(acc.supportedMinorCategories || []),
      acc.remainingFreeRFQs || 5,
    ]
  );
}

async function deleteBuyerAccountInDB(id) {
  if (!poolModule.pool) return;
  await poolModule.query('DELETE FROM buyer_accounts WHERE id = $1', [id]);
}

// ==============================================================================
// 2. VENDORS QUERIES
// ==============================================================================

async function getVendorsFromDB() {
  if (!poolModule.pool) return [];
  const res = await poolModule.query(`
    SELECT
      id,
      name,
      email,
      phone,
      location,
      major_category AS "majorCategory",
      minor_categories AS "minorCategories",
      rating,
      score,
      whatsapp_sla AS "whatsappSla",
      awarded_spend AS "awardedSpend",
      lead_time_days AS "leadTimeDays",
      empanelled_by AS "empanelledBy",
      status,
      is_empanelled AS "isEmpanelled",
      evaluation_id AS "evaluationId",
      category_count AS "categoryCount",
      client_mapped_categories AS "clientMappedCategories",
      vendor_selected_categories AS "vendorSelectedCategories"
    FROM vendors
    ORDER BY created_at DESC
  `);
  return res.rows.map((row) => ({
    ...row,
    minorCategories: typeof row.minorCategories === 'string' ? JSON.parse(row.minorCategories) : row.minorCategories,
    clientMappedCategories: typeof row.clientMappedCategories === 'string' ? JSON.parse(row.clientMappedCategories) : row.clientMappedCategories,
    vendorSelectedCategories: typeof row.vendorSelectedCategories === 'string' ? JSON.parse(row.vendorSelectedCategories) : row.vendorSelectedCategories,
  }));
}

async function upsertVendorInDB(v) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO vendors (
      id, name, email, phone, location, major_category, minor_categories,
      rating, score, whatsapp_sla, awarded_spend, lead_time_days, empanelled_by,
      status, is_empanelled, evaluation_id, category_count,
      client_mapped_categories, vendor_selected_categories
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      rating = EXCLUDED.rating,
      score = EXCLUDED.score,
      whatsapp_sla = EXCLUDED.whatsapp_sla,
      awarded_spend = EXCLUDED.awarded_spend,
      lead_time_days = EXCLUDED.lead_time_days,
      status = EXCLUDED.status,
      category_count = EXCLUDED.category_count,
      client_mapped_categories = EXCLUDED.client_mapped_categories,
      vendor_selected_categories = EXCLUDED.vendor_selected_categories
  `,
    [
      v.id,
      v.name,
      v.email,
      v.phone,
      v.location,
      v.majorCategory,
      JSON.stringify(v.minorCategories || []),
      v.rating || 4.5,
      v.score || 85,
      v.whatsappSla || 90,
      v.awardedSpend || 0,
      v.leadTimeDays || 14,
      v.empanelledBy,
      v.status || 'Active',
      v.isEmpanelled || false,
      v.evaluationId,
      v.categoryCount || 1,
      JSON.stringify(v.clientMappedCategories || []),
      JSON.stringify(v.vendorSelectedCategories || []),
    ]
  );
}

async function deleteVendorInDB(id) {
  if (!poolModule.pool) return;
  await poolModule.query('DELETE FROM vendors WHERE id = $1', [id]);
}

// ==============================================================================
// 3. RFQS QUERIES
// ==============================================================================

async function getRFQsFromDB() {
  if (!poolModule.pool) return [];
  const res = await poolModule.query(`
    SELECT
      id,
      rfq_number AS "rfqNumber",
      title,
      category,
      sourcing_mode AS "sourcingMode",
      buyer_company AS "buyerCompany",
      buyer_contact AS "buyerContact",
      buyer_email AS "buyerEmail",
      created_date AS "createdDate",
      deadline,
      budget,
      status,
      quotes_count AS "quotesCount",
      target_savings AS "targetSavings",
      is_double_blind AS "isDoubleBlind",
      source,
      line_items AS "lineItems",
      quotes,
      assigned_vendors AS "assignedVendors",
      tags,
      po_number AS "poNumber",
      po_amount AS "poAmount",
      po_awarded_to AS "poAwardedTo",
      po_award_date AS "poAwardDate",
      po_status AS "poStatus",
      po_approver_notes AS "poApproverNotes"
    FROM rfqs
    ORDER BY created_at DESC
  `);
  return res.rows.map((row) => ({
    ...row,
    lineItems: typeof row.lineItems === 'string' ? JSON.parse(row.lineItems) : row.lineItems,
    quotes: typeof row.quotes === 'string' ? JSON.parse(row.quotes) : row.quotes,
    assignedVendors: typeof row.assignedVendors === 'string' ? JSON.parse(row.assignedVendors) : row.assignedVendors,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
  }));
}

async function upsertRFQInDB(rfq) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO rfqs (
      id, rfq_number, title, category, sourcing_mode, buyer_company, buyer_contact,
      buyer_email, created_date, deadline, budget, status, quotes_count,
      target_savings, is_double_blind, source, line_items, quotes, assigned_vendors,
      tags, po_number, po_amount, po_awarded_to, po_award_date, po_status, po_approver_notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      status = EXCLUDED.status,
      quotes_count = EXCLUDED.quotes_count,
      target_savings = EXCLUDED.target_savings,
      quotes = EXCLUDED.quotes,
      assigned_vendors = EXCLUDED.assigned_vendors,
      po_number = EXCLUDED.po_number,
      po_amount = EXCLUDED.po_amount,
      po_awarded_to = EXCLUDED.po_awarded_to,
      po_award_date = EXCLUDED.po_award_date,
      po_status = EXCLUDED.po_status,
      po_approver_notes = EXCLUDED.po_approver_notes
  `,
    [
      rfq.id,
      rfq.rfqNumber,
      rfq.title,
      rfq.category,
      rfq.sourcingMode || 'mode_1',
      rfq.buyerCompany,
      rfq.buyerContact,
      rfq.buyerEmail,
      rfq.createdDate || new Date().toISOString().substring(0, 10),
      rfq.deadline,
      rfq.budget || 0,
      rfq.status || 'In Evaluation',
      rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0),
      rfq.targetSavings || '14.8%',
      rfq.isDoubleBlind || false,
      rfq.source || 'web_portal',
      JSON.stringify(rfq.lineItems || []),
      JSON.stringify(rfq.quotes || []),
      JSON.stringify(rfq.assignedVendors || []),
      JSON.stringify(rfq.tags || []),
      rfq.poNumber || null,
      rfq.poAmount || null,
      rfq.poAwardedTo || null,
      rfq.poAwardDate || null,
      rfq.poStatus || null,
      rfq.poApproverNotes || null,
    ]
  );
}

// ==============================================================================
// 4. EVALUATIONS QUERIES
// ==============================================================================

async function getEvaluationsFromDB() {
  if (!poolModule.pool) return [];
  const res = await poolModule.query(`
    SELECT
      id,
      vendor_name AS "vendorName",
      overall_score AS "overallScore",
      status,
      submission_date AS "submissionDate",
      audit_hash AS "auditHash",
      module_scores AS "moduleScores",
      verified_claims AS "verifiedClaims"
    FROM vendor_evaluations
    ORDER BY created_at DESC
  `);
  return res.rows.map((row) => ({
    ...row,
    moduleScores: typeof row.moduleScores === 'string' ? JSON.parse(row.moduleScores) : row.moduleScores,
    verifiedClaims: typeof row.verifiedClaims === 'string' ? JSON.parse(row.verifiedClaims) : row.verifiedClaims,
  }));
}

async function upsertEvaluationInDB(ev) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO vendor_evaluations (
      id, vendor_name, overall_score, status, submission_date, audit_hash,
      module_scores, verified_claims
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score,
      status = EXCLUDED.status,
      audit_hash = EXCLUDED.audit_hash,
      module_scores = EXCLUDED.module_scores,
      verified_claims = EXCLUDED.verified_claims
  `,
    [
      ev.id,
      ev.vendorName,
      ev.overallScore || 0,
      ev.status || 'Qualified',
      ev.submissionDate || new Date().toISOString().substring(0, 10),
      ev.auditHash,
      JSON.stringify(ev.moduleScores || {}),
      JSON.stringify(ev.verifiedClaims || []),
    ]
  );
}

// ==============================================================================
// 5. AUDIT LOGS QUERIES
// ==============================================================================

async function getAuditLogsFromDB() {
  if (!poolModule.pool) return [];
  const res = await poolModule.query(`
    SELECT
      id,
      timestamp,
      user_email AS "userEmail",
      action,
      rfq_number AS "rfqNumber",
      ip_address AS "ipAddress",
      sha_signature AS "shaSignature",
      previous_sha AS "previousSha",
      payload,
      verified
    FROM audit_logs
    ORDER BY id DESC
  `);
  return res.rows.map((row) => ({
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  }));
}

async function insertAuditLogInDB(log) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO audit_logs (
      id, timestamp, user_email, action, rfq_number, ip_address,
      sha_signature, previous_sha, payload, verified
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (id) DO NOTHING
  `,
    [
      log.id,
      log.timestamp,
      log.userEmail,
      log.action,
      log.rfqNumber || null,
      log.ipAddress || null,
      log.shaSignature,
      log.previousSha || null,
      JSON.stringify(log.payload || {}),
      log.verified !== undefined ? log.verified : true,
    ]
  );
}

// ==============================================================================
// 6. SYSTEM CONFIG QUERIES
// ==============================================================================

async function getSystemConfigFromDB() {
  if (!poolModule.pool) return null;
  const res = await poolModule.query(`SELECT value FROM system_config WHERE key = 'main_config' LIMIT 1`);
  return res.rows[0]?.value || null;
}

async function upsertSystemConfigInDB(config) {
  if (!poolModule.pool) return;
  await poolModule.query(
    `
    INSERT INTO system_config (id, key, value, updated_at)
    VALUES ('sys-cfg-1', 'main_config', $1, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP
  `,
    [JSON.stringify(config)]
  );
}

module.exports = {
  getBuyerAccountsFromDB,
  upsertBuyerAccountInDB,
  deleteBuyerAccountInDB,
  getVendorsFromDB,
  upsertVendorInDB,
  deleteVendorInDB,
  getRFQsFromDB,
  upsertRFQInDB,
  getEvaluationsFromDB,
  upsertEvaluationInDB,
  getAuditLogsFromDB,
  insertAuditLogInDB,
  getSystemConfigFromDB,
  upsertSystemConfigInDB,
};
