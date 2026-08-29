const { query, pool } = require('./pool');

// ==============================================================================
// 1. BUYER ACCOUNTS QUERIES
// ==============================================================================

async function getBuyerAccountsFromDB() {
  if (!pool) return [];
  const res = await query(`
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
  if (!pool) return;
  await query(
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
      status = EXCLUDED.status,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      acc.id,
      acc.organizationName,
      acc.corporateEmail,
      acc.contactPerson,
      acc.mobileNumber || null,
      acc.industrySector || null,
      acc.accountSource || 'public_system',
      acc.subscriptionPlan || 'free_trial',
      acc.totalRFQsCreated || 0,
      acc.totalSpend || '$0',
      acc.status === 'ACTIVE_VERIFIED',
      acc.createdDate || new Date().toISOString().substring(0, 10),
      acc.sourcingMode || 'mode_1',
      acc.status || 'ACTIVE_VERIFIED',
      acc.gstin || '27AABCU9603R1ZN',
      acc.primaryPlantLocation || 'Mumbai, Maharashtra',
      JSON.stringify(acc.supportedMajorCategories || []),
      JSON.stringify(acc.supportedMinorCategories || []),
      acc.remainingFreeRFQs !== undefined ? acc.remainingFreeRFQs : 5,
    ]
  );
}

async function deleteBuyerAccountInDB(id) {
  if (!pool) return;
  await query(`DELETE FROM buyer_accounts WHERE id = $1`, [id]);
}

// ==============================================================================
// 2. VENDORS QUERIES
// ==============================================================================

async function getVendorsFromDB() {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      name,
      contact_person AS "contactPerson",
      email,
      phone,
      major_category AS "majorCategory",
      minor_categories AS "minorCategories",
      location,
      rating,
      score,
      source,
      status,
      evaluated,
      has_record AS "hasRecord",
      match_reason AS "matchReason",
      proximity,
      proximity_match AS "proximityMatch",
      is_existing_in_database AS "isExistingInDatabase",
      onboarding_email_status AS "onboardingEmailStatus",
      onboarding_email_dispatched_at AS "onboardingEmailDispatchedAt",
      temp_password AS "tempPassword",
      first_login_completed AS "firstLoginCompleted",
      reminder_cadence AS "reminderCadence",
      next_reminder_date AS "nextReminderDate",
      reminders_sent_count AS "remindersSentCount",
      added_by_buyer_company AS "addedByBuyerCompany",
      added_by_buyer_name AS "addedByBuyerName",
      profile_completion_status AS "profileCompletionStatus",
      client_mapped_categories AS "clientMappedCategories",
      vendor_selected_categories AS "vendorSelectedCategories",
      is_category_aligned AS "isCategoryAligned",
      category_mismatch_details AS "categoryMismatchDetails",
      category_match_source AS "categoryMatchSource",
      latest_rating_revision AS "latestRatingRevision",
      rating_revision_history AS "ratingRevisionHistory"
    FROM vendors
    ORDER BY score DESC
  `);
  return res.rows;
}

async function upsertVendorInDB(v) {
  if (!pool) return;
  await query(
    `
    INSERT INTO vendors (
      id, name, contact_person, email, phone, major_category, minor_categories,
      location, rating, score, source, status, evaluated, has_record, match_reason,
      proximity, proximity_match, is_existing_in_database, onboarding_email_status,
      onboarding_email_dispatched_at, temp_password, first_login_completed, reminder_cadence,
      next_reminder_date, reminders_sent_count, added_by_buyer_company, added_by_buyer_name,
      profile_completion_status, client_mapped_categories, vendor_selected_categories,
      is_category_aligned, category_mismatch_details, category_match_source,
      latest_rating_revision, rating_revision_history
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      contact_person = EXCLUDED.contact_person,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      major_category = EXCLUDED.major_category,
      minor_categories = EXCLUDED.minor_categories,
      rating = EXCLUDED.rating,
      score = EXCLUDED.score,
      status = EXCLUDED.status,
      evaluated = EXCLUDED.evaluated,
      onboarding_email_status = EXCLUDED.onboarding_email_status,
      profile_completion_status = EXCLUDED.profile_completion_status,
      client_mapped_categories = EXCLUDED.client_mapped_categories,
      vendor_selected_categories = EXCLUDED.vendor_selected_categories,
      latest_rating_revision = EXCLUDED.latest_rating_revision,
      rating_revision_history = EXCLUDED.rating_revision_history,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      v.id,
      v.name,
      v.contactPerson,
      v.email,
      v.phone || null,
      v.majorCategory,
      JSON.stringify(v.minorCategories || []),
      v.location || 'Mumbai, MH',
      v.rating || 4.5,
      v.score || 85.0,
      v.source || 'buyer_manual',
      v.status || 'PREFERRED ENTERPRISE SUPPLIER',
      v.evaluated || false,
      v.hasRecord || false,
      v.matchReason || null,
      v.proximity || null,
      v.proximityMatch || false,
      v.isExistingInDatabase || false,
      v.onboardingEmailStatus || 'sent',
      v.onboardingEmailDispatchedAt || null,
      v.tempPassword || null,
      v.firstLoginCompleted || false,
      v.reminderCadence || 'every_3_days',
      v.nextReminderDate || null,
      v.remindersSentCount || 0,
      v.addedByBuyerCompany || null,
      v.addedByBuyerName || null,
      v.profileCompletionStatus || 'pending',
      JSON.stringify(v.clientMappedCategories || []),
      JSON.stringify(v.vendorSelectedCategories || []),
      v.isCategoryAligned !== false,
      JSON.stringify(v.categoryMismatchDetails || {}),
      v.categoryMatchSource || 'exact_match',
      v.latestRatingRevision ? JSON.stringify(v.latestRatingRevision) : null,
      JSON.stringify(v.ratingRevisionHistory || []),
    ]
  );
}

async function deleteVendorInDB(id) {
  if (!pool) return;
  await query(`DELETE FROM vendors WHERE id = $1`, [id]);
}

// ==============================================================================
// 3. RFQS QUERIES
// ==============================================================================

async function getRFQsFromDB() {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      rfq_number AS "rfqNumber",
      title,
      category,
      created_at AS "createdAt",
      deadline,
      status,
      line_items_count AS "lineItemsCount",
      total_estimated_value AS "totalEstimatedValue",
      sourcing_mode AS "sourcingMode",
      quotes_count AS "quotesCount",
      target_savings AS "targetSavings",
      chasing_active AS "chasingActive",
      allocated_time AS "allocatedTime",
      elapsed_time AS "elapsedTime",
      assigned_vendors AS "assignedVendors",
      line_items AS "lineItems",
      quotes,
      follow_up_data AS "followUpData"
    FROM rfqs
    ORDER BY db_created_at DESC
  `);
  return res.rows;
}

async function upsertRFQInDB(rfq) {
  if (!pool) return;
  await query(
    `
    INSERT INTO rfqs (
      id, rfq_number, title, category, created_at, deadline, status,
      line_items_count, total_estimated_value, sourcing_mode, quotes_count,
      target_savings, chasing_active, allocated_time, elapsed_time,
      assigned_vendors, line_items, quotes, follow_up_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      status = EXCLUDED.status,
      quotes_count = EXCLUDED.quotes_count,
      chasing_active = EXCLUDED.chasing_active,
      assigned_vendors = EXCLUDED.assigned_vendors,
      quotes = EXCLUDED.quotes,
      follow_up_data = EXCLUDED.follow_up_data,
      db_updated_at = CURRENT_TIMESTAMP
  `,
    [
      rfq.id,
      rfq.rfqNumber,
      rfq.title,
      rfq.category,
      rfq.createdAt,
      rfq.deadline,
      rfq.status,
      rfq.lineItemsCount || (rfq.lineItems ? rfq.lineItems.length : 1),
      rfq.totalEstimatedValue || '$0',
      rfq.sourcingMode || 'mode_1',
      rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0),
      rfq.targetSavings || '12-18%',
      rfq.chasingActive || false,
      rfq.allocatedTime || '24 hrs',
      rfq.elapsedTime || '0 hrs',
      JSON.stringify(rfq.assignedVendors || []),
      JSON.stringify(rfq.lineItems || []),
      JSON.stringify(rfq.quotes || []),
      JSON.stringify(rfq.followUpData || {}),
    ]
  );
}

// ==============================================================================
// 4. EVALUATIONS QUERIES
// ==============================================================================

async function getEvaluationsFromDB() {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      vendor_id AS "vendorId",
      vendor_name AS "vendorName",
      contact_person AS "contactPerson",
      email,
      phone,
      category,
      submission_date AS "submissionDate",
      status,
      overall_score AS "overallScore",
      system_action AS "systemAction",
      module_scores AS "moduleScores",
      documents
    FROM vendor_evaluations
    ORDER BY overall_score DESC
  `);
  return res.rows;
}

async function upsertEvaluationInDB(ev) {
  if (!pool) return;
  await query(
    `
    INSERT INTO vendor_evaluations (
      id, vendor_id, vendor_name, contact_person, email, phone, category,
      submission_date, status, overall_score, system_action, module_scores, documents
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      overall_score = EXCLUDED.overall_score,
      status = EXCLUDED.status,
      system_action = EXCLUDED.system_action,
      module_scores = EXCLUDED.module_scores,
      documents = EXCLUDED.documents,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      ev.id,
      ev.vendorId,
      ev.vendorName,
      ev.contactPerson || null,
      ev.email || null,
      ev.phone || null,
      ev.category || null,
      ev.submissionDate || new Date().toISOString().substring(0, 10),
      ev.status || 'PREFERRED ENTERPRISE SUPPLIER',
      ev.overallScore || 85.0,
      ev.systemAction || null,
      JSON.stringify(ev.moduleScores || {}),
      JSON.stringify(ev.documents || []),
    ]
  );
}

// ==============================================================================
// 5. AUDIT LOGS QUERIES
// ==============================================================================

async function getAuditLogsFromDB() {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      timestamp,
      user_email AS "userEmail",
      action,
      rfq_number AS "rfqNumber",
      sha_signature AS "shaSignature",
      status,
      ip_address AS "ipAddress"
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return res.rows;
}

async function insertAuditLogInDB(log) {
  if (!pool) return;
  await query(
    `
    INSERT INTO audit_logs (id, timestamp, user_email, action, rfq_number, sha_signature, status, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `,
    [
      log.id,
      log.timestamp || new Date().toISOString(),
      log.userEmail || 'system@procucev.ai',
      log.action,
      log.rfqNumber || null,
      log.shaSignature,
      log.status || 'TAMPER_CHECK_OK',
      log.ipAddress || '10.0.4.12 (Azure Private VNet)',
    ]
  );
}

// ==============================================================================
// 6. SYSTEM CONFIG QUERIES
// ==============================================================================

async function getSystemConfigFromDB() {
  if (!pool) return null;
  const res = await query(`SELECT value FROM system_config WHERE key = 'main_config' LIMIT 1`);
  return res.rows[0]?.value || null;
}

async function upsertSystemConfigInDB(config) {
  if (!pool) return;
  await query(
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
