import { query, pool } from './index';
import {
  RFQItem,
  VendorEntry,
  VendorEvaluationRecord,
  AuditLogEntry,
  AIBotFeedItem,
  BuyerAccount,
  VendorRatingRevisionRecord,
} from '@/lib/types';

// ==============================================================================
// 1. BUYER ACCOUNTS QUERIES
// ==============================================================================

export async function getBuyerAccountsFromDB(): Promise<BuyerAccount[]> {
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

export async function upsertBuyerAccountInDB(acc: BuyerAccount): Promise<void> {
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
      acc.remainingFreeRFQs ?? 5,
    ]
  );
}

// ==============================================================================
// 2. VENDORS QUERIES
// ==============================================================================

export async function getVendorsFromDB(): Promise<VendorEntry[]> {
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
    ORDER BY created_at DESC
  `);
  return res.rows;
}

export async function upsertVendorInDB(v: VendorEntry): Promise<void> {
  if (!pool) return;
  await query(
    `
    INSERT INTO vendors (
      id, name, contact_person, email, phone, major_category, minor_categories,
      location, rating, score, source, status, evaluated, has_record, match_reason,
      proximity, proximity_match, is_existing_in_database, onboarding_email_status,
      onboarding_email_dispatched_at, temp_password, first_login_completed,
      reminder_cadence, next_reminder_date, reminders_sent_count,
      added_by_buyer_company, added_by_buyer_name, profile_completion_status,
      client_mapped_categories, vendor_selected_categories, is_category_aligned,
      category_mismatch_details, category_match_source, latest_rating_revision,
      rating_revision_history
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
      $29, $30, $31, $32, $33, $34, $35
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
      client_mapped_categories = EXCLUDED.client_mapped_categories,
      vendor_selected_categories = EXCLUDED.vendor_selected_categories,
      is_category_aligned = EXCLUDED.is_category_aligned,
      latest_rating_revision = EXCLUDED.latest_rating_revision,
      rating_revision_history = EXCLUDED.rating_revision_history,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      v.id,
      v.name,
      v.contactPerson,
      v.email,
      v.phone || '',
      v.majorCategory,
      JSON.stringify(v.minorCategories || []),
      v.location || '',
      v.rating || 4.5,
      v.score || 88.0,
      v.source || 'buyer_manual',
      v.status || 'PREFERRED ENTERPRISE SUPPLIER',
      v.evaluated ?? false,
      v.hasRecord ?? false,
      v.matchReason || '',
      v.proximity || '',
      v.proximityMatch ?? false,
      v.isExistingInDatabase ?? false,
      v.onboardingEmailStatus || 'sent',
      v.onboardingEmailDispatchedAt || null,
      v.tempPassword || null,
      v.firstLoginCompleted ?? false,
      v.reminderCadence || 'every_3_days',
      v.nextReminderDate || null,
      v.remindersSentCount || 0,
      v.addedByBuyerCompany || null,
      v.addedByBuyerName || null,
      v.profileCompletionStatus || 'pending',
      JSON.stringify(v.clientMappedCategories || []),
      JSON.stringify(v.vendorSelectedCategories || []),
      v.isCategoryAligned ?? true,
      JSON.stringify(v.categoryMismatchDetails || {}),
      v.categoryMatchSource || null,
      v.latestRatingRevision ? JSON.stringify(v.latestRatingRevision) : null,
      JSON.stringify(v.ratingRevisionHistory || []),
    ]
  );
}

// ==============================================================================
// 3. RFQS QUERIES
// ==============================================================================

export async function getRFQsFromDB(): Promise<RFQItem[]> {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      rfq_number AS "rfqNumber",
      title,
      category,
      created_at AS "createdAt",
      deadline AS "targetDeliveryDate",
      status,
      sourcing_mode AS "sourcingMode",
      quotes_count AS "quotesCount",
      chasing_active AS "chasingActive",
      quotes,
      follow_up_data AS "followUpData",
      line_items AS "extractedEntities"
    FROM rfqs
    ORDER BY db_created_at DESC
  `);
  return res.rows;
}

export async function upsertRFQInDB(rfq: RFQItem): Promise<void> {
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
      status = EXCLUDED.status,
      quotes_count = EXCLUDED.quotes_count,
      quotes = EXCLUDED.quotes,
      chasing_active = EXCLUDED.chasing_active,
      line_items = EXCLUDED.line_items,
      follow_up_data = EXCLUDED.follow_up_data,
      db_updated_at = CURRENT_TIMESTAMP
  `,
    [
      rfq.id,
      rfq.rfqNumber,
      rfq.title,
      rfq.category,
      rfq.createdAt,
      rfq.targetDeliveryDate || '',
      rfq.status,
      rfq.extractedEntities?.length || 1,
      rfq.budget ? `$${rfq.budget.toLocaleString()}` : '$150,000',
      rfq.sourcingMode || 'mode_1',
      rfq.quotesCount || rfq.quotes?.length || 0,
      '12-18%',
      rfq.chasingActive ?? false,
      '48 Hours',
      '14 Hours',
      JSON.stringify([]),
      JSON.stringify(rfq.extractedEntities || []),
      JSON.stringify(rfq.quotes || []),
      JSON.stringify(rfq.followUpData || {}),
    ]
  );
}

// ==============================================================================
// 4. VENDOR 360° EVALUATIONS QUERIES
// ==============================================================================

export async function getEvaluationsFromDB(): Promise<VendorEvaluationRecord[]> {
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
    ORDER BY created_at DESC
  `);
  return res.rows;
}

export async function upsertEvaluationInDB(ev: VendorEvaluationRecord): Promise<void> {
  if (!pool) return;
  await query(
    `
    INSERT INTO vendor_evaluations (
      id, vendor_id, vendor_name, contact_person, email, phone, category,
      submission_date, status, overall_score, system_action, module_scores, documents
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      overall_score = EXCLUDED.overall_score,
      system_action = EXCLUDED.system_action,
      module_scores = EXCLUDED.module_scores,
      documents = EXCLUDED.documents,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      ev.id,
      ev.vendorId,
      ev.vendorName,
      ev.contactPerson || '',
      ev.email || '',
      ev.phone || '',
      ev.category || '',
      ev.submissionDate || '',
      ev.status || 'PREFERRED ENTERPRISE SUPPLIER',
      ev.overallScore || 88.0,
      ev.systemAction || '',
      JSON.stringify(ev.moduleScores || {}),
      JSON.stringify(ev.documents || []),
    ]
  );
}

// ==============================================================================
// 5. AUDIT LOGS QUERIES
// ==============================================================================

export async function getAuditLogsFromDB(): Promise<AuditLogEntry[]> {
  if (!pool) return [];
  const res = await query(`
    SELECT
      id,
      timestamp,
      user_email AS "user",
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

export async function insertAuditLogInDB(log: AuditLogEntry): Promise<void> {
  if (!pool) return;
  await query(
    `
    INSERT INTO audit_logs (id, timestamp, user_email, action, rfq_number, sha_signature, status, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `,
    [
      log.id,
      log.timestamp,
      log.user,
      log.action,
      log.rfqNumber || null,
      log.shaSignature,
      log.status || 'TAMPER_CHECK_OK',
      log.ipAddress || '10.0.4.12 (Azure Private VNet)',
    ]
  );
}

// ==============================================================================
// 6. RATING REVISIONS QUERIES
// ==============================================================================

export async function insertRatingRevisionInDB(rev: VendorRatingRevisionRecord): Promise<void> {
  if (!pool) return;
  await query(
    `
    INSERT INTO vendor_rating_revisions (
      id, vendor_id, vendor_name, buyer_company, buyer_name, buyer_email,
      timestamp, quality_score, cost_score, delivery_score, buyer_average,
      previous_score, new_composite_score, previous_rating, new_rating,
      remarks, email_dispatched, sha_signature
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (id) DO NOTHING
  `,
    [
      rev.id,
      rev.vendorId,
      rev.vendorName,
      rev.buyerCompany,
      rev.buyerName,
      rev.buyerEmail || null,
      rev.timestamp,
      rev.qualityScore,
      rev.costScore,
      rev.deliveryScore,
      rev.buyerAverage,
      rev.previousScore,
      rev.newCompositeScore,
      rev.previousRating,
      rev.newRating,
      rev.remarks,
      rev.emailDispatched ?? true,
      rev.shaSignature,
    ]
  );
}
