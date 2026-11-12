// ==============================================================================
// PAYMENT DUES QUERIES (PostgreSQL & Cloudflare D1)
// ==============================================================================
// Fetches, filters, sorts, and records low-credit monitoring & communications.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { VENDOR_PLAN_RFQ_QUOTA } = require('../config/constants');
const { logger } = require('../services/loggerService');

const DASH = '–';
const PAYMENT_DUES_ERRORS = Object.freeze({
  COMMUNICATED_BY_REQUIRED: 'The sender name is required to record a communication. Sign in and retry.',
  UPDATED_BY_REQUIRED: 'The updating user is required to record an acknowledgement. Sign in and retry.',
});

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_FAILED';
  error.statusCode = 400;
  return error;
}

/** Account status from the stored status, or from the active flag. Unknown is a dash. */
function resolveAccountStatus(status, isActive) {
  if (status) return status;
  if (isActive === undefined || isActive === null) return DASH;
  return Number(isActive) ? 'Active' : 'Inactive';
}

function parseRaw(val, fallback = {}) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function pickFirst(...args) {
  for (let i = 0; i < args.length; i++) {
    const val = args[i];
    if (val) return val;
  }
  return '';
}

function parseCredits(val, fallback = 0) {
  if (val != null) {
    const num = Number(val);
    if (!isNaN(num)) return num;
  }
  return fallback;
}

// A Connect/Select subscriber's balance is plan quota less downloads used;
// their free-tier field stays 0, which wrongly listed them as low-credit.
function getSellerPlanQuota(v) {
  return VENDOR_PLAN_RFQ_QUOTA[v.subscriptionPlan];
}

function getSellerAvailableCredits(v) {
  const quota = getSellerPlanQuota(v);
  if (quota !== undefined) return Math.max(0, quota - parseCredits(v.rfqDownloadsUsed, 0));
  if (v.availableCredits != null) return parseCredits(v.availableCredits, null);
  if (v.freeQuotationCredits != null) return parseCredits(v.freeQuotationCredits, null);
  if (v.freeRfqDownloadCredits != null) return parseCredits(v.freeRfqDownloadCredits, null);
  if (v.freeCreditsRemaining != null) return parseCredits(v.freeCreditsRemaining, null);
  if (v.credits != null) return parseCredits(v.credits, null);
  return null;
}

function getSellerCreditsUsed(v, totalCredits, available) {
  if (v.freeCreditsUsed != null) return Number(v.freeCreditsUsed);
  if (v.rfqDownloadsUsed != null) return Number(v.rfqDownloadsUsed);
  if (totalCredits === null || available === null) return null;
  return Math.max(0, totalCredits - available);
}



function throwPersistenceUnavailable(operation, cause) {
  const error = new Error(`Payment dues ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Payment dues persistence failed', {
    operation,
    error: cause,
  }, 'PAYMENT_DUES');
  throw error;
}

function requireStorage(operation) {
  if (!pool.hasStorage()) throwPersistenceUnavailable(operation, null);
}

function mapCommunicationRow(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountType: row.account_type,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    message: row.message,
    notificationStatus: row.notification_status,
    deliveryStatus: row.delivery_status,
    acknowledgementStatus: row.acknowledgement_status,
    communicatedBy: row.communicated_by,
    sentAt: row.sent_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    notes: row.notes,
    metadata: parseRaw(row.metadata, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}



/**
 * Retrieve all registered buyers from the database
 */
async function fetchRawBuyers() {
  requireStorage('buyer account read');
  let result;
  try {
    const sql = 'SELECT id, is_active, raw, created_at, updated_at FROM buyer_accounts ORDER BY created_at DESC';
    result = await pool.query(sql, [], {
      d1: true,
      d1Text: 'SELECT id, is_active, raw, created_at, updated_at FROM buyer_accounts ORDER BY created_at DESC',
      useCache: true,
      tag: 'buyer_accounts',
      ttlMs: 30000,
    });
  } catch (error) {
    throwPersistenceUnavailable('buyer account read', error);
  }
  if (!result || !Array.isArray(result.rows)) {
    throwPersistenceUnavailable('buyer account read', new Error('The buyer account query returned no row set.'));
  }
  return result.rows.map((row) => {
    const raw = parseRaw(row.raw, {});
    return {
      id: row.id,
      ...raw,
      createdAt: row.created_at || raw.createdAt || null,
      updatedAt: row.updated_at || raw.updatedAt || null,
      isActive: row.is_active !== undefined ? row.is_active : raw.isActive,
    };
  });
}

/**
 * Retrieve all registered vendors from the database
 */
async function fetchRawVendors() {
  requireStorage('vendor account read');
  let result;
  try {
    const sql = 'SELECT id, email, status, raw, created_at, updated_at FROM vendors ORDER BY created_at DESC LIMIT 500';
    result = await pool.query(sql, [], {
      d1: true,
      d1Text: 'SELECT id, email, status, raw, created_at, updated_at FROM vendors ORDER BY created_at DESC LIMIT 500',
      useCache: true,
      tag: 'vendors',
      ttlMs: 30000,
    });
  } catch (error) {
    throwPersistenceUnavailable('vendor account read', error);
  }
  if (!result || !Array.isArray(result.rows)) {
    throwPersistenceUnavailable('vendor account read', new Error('The vendor account query returned no row set.'));
  }
  return result.rows.map((row) => {
    const raw = parseRaw(row.raw, {});
    return {
      id: row.id,
      email: row.email,
      status: row.status,
      ...raw,
      createdAt: row.created_at || raw.createdAt,
      updatedAt: row.updated_at || raw.updatedAt,
    };
  });
}

/**
 * Fetch communications for accounts
 */
async function fetchCommunicationsMap(accountIds) {
  const commMap = new Map();
  const hasAccountFilter = Array.isArray(accountIds);
  const selectedAccountIds = hasAccountFilter ? [...new Set(accountIds.filter(Boolean))] : null;
  const selectedAccountIdSet = hasAccountFilter ? new Set(selectedAccountIds) : null;
  if (hasAccountFilter && selectedAccountIds.length === 0) return commMap;

  if (pool.hasStorage()) {
    try {
      const accountFilterSql = hasAccountFilter ? 'WHERE account_id = ANY($1::text[])' : '';
      const accountFilterD1Sql = hasAccountFilter
        ? 'WHERE account_id IN (SELECT value FROM json_each($1))'
        : '';
      const sql = `SELECT account_id, channel, notification_status, delivery_status, acknowledgement_status, sent_at
        FROM (
          SELECT account_id, channel, notification_status, delivery_status, acknowledgement_status, sent_at,
            ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY sent_at DESC) AS row_num
          FROM payment_dues_communications
          ${accountFilterSql}
        ) latest
        WHERE row_num = 1`;
      const d1Sql = `SELECT account_id, channel, notification_status, delivery_status, acknowledgement_status, sent_at
        FROM (
          SELECT account_id, channel, notification_status, delivery_status, acknowledgement_status, sent_at,
            ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY sent_at DESC) AS row_num
          FROM payment_dues_communications
          ${accountFilterD1Sql}
        ) latest
        WHERE row_num = 1`;
      const params = hasAccountFilter ? [selectedAccountIds] : [];
      const result = await pool.query(sql, params, {
        d1: true,
        d1Text: d1Sql,
        ...(hasAccountFilter ? { d1Params: [JSON.stringify(selectedAccountIds)] } : {}),
        useCache: true,
        tag: 'payment_dues_communications',
        ttlMs: 15000,
      });
      if (result && Array.isArray(result.rows)) {
        result.rows.forEach((row) => {
          commMap.set(row.account_id, [{
            accountId: row.account_id,
            channel: row.channel,
            notificationStatus: row.notification_status,
            deliveryStatus: row.delivery_status,
            acknowledgementStatus: row.acknowledgement_status,
            sentAt: row.sent_at,
          }]);
        });
        return commMap;
      }
    } catch (error) {
      throwPersistenceUnavailable('latest communication lookup', error);
    }
  }

  throwPersistenceUnavailable('latest communication lookup', null);
}

/**
 * Fetch eligible low-credit accounts (available credits <= 2)
 */
async function getLowCreditAccounts({
  search = '',
  accountType = 'all',
  credits = 'all',
  acknowledgementStatus = 'all',
  accountStatus = 'all',
  assignedExecutive = 'all',
  notificationChannel = 'all',
  sortBy = 'availableCredits',
  sortOrder = 'asc',
  page = 1,
  limit = 25,
} = {}) {
  const [buyers, vendors] = await Promise.all([
    module.exports.fetchRawBuyers(),
    module.exports.fetchRawVendors(),
  ]);

  // Available credits are null when the record holds no credit figure. Such an account
  // is never listed as low-credit, because its balance is unknown.
  const isLowCredit = (available) => available !== null && available >= 0 && available <= 2;
  const buyerEntries = buyers.map((buyer) => ({ buyer, available: parseCredits(buyer.remainingFreeRFQs, null) }));
  const vendorEntries = vendors.map((vendor) => ({ vendor, available: getSellerAvailableCredits(vendor) }));
  const lowCreditAccountIds = [
    ...buyerEntries.filter((entry) => isLowCredit(entry.available)).map((entry) => entry.buyer.id),
    ...vendorEntries.filter((entry) => isLowCredit(entry.available)).map((entry) => entry.vendor.id),
  ].filter(Boolean);
  const commMap = await fetchCommunicationsMap(lowCreditAccountIds);

  const allEligibleAccounts = [];

  // 1. Process Buyers
  for (const { buyer: b, available } of buyerEntries) {
    if (!isLowCredit(available)) continue;

    const totalCredits = parseCredits(b.totalCredits, null);
    const creditsUsed = totalCredits === null ? null : Math.max(0, totalCredits - available);
    const history = commMap.get(b.id) || [];
    const latestComm = history[0] || null;

    allEligibleAccounts.push({
      accountId: b.id,
      accountType: 'buyer',
      companyName: pickFirst(b.organizationName, b.companyName, b.name) || DASH,
      contactPerson: pickFirst(b.contactPerson, b.fullName, b.adminName, b.name) || DASH,
      email: pickFirst(b.corporateEmail, b.email) || DASH,
      phoneNumber: pickFirst(b.phone, b.mobile, b.contactNumber) || DASH,
      availableCredits: available,
      totalCredits,
      creditsUsed,
      accountStatus: resolveAccountStatus(b.status, b.isActive),
      registrationDate: pickFirst(b.createdAt, b.created_at) || null,
      lastActivity: pickFirst(b.lastActivity, b.lastLogin, b.updatedAt, b.updated_at, b.createdAt) || null,
      assignedExecutive: pickFirst(b.assignedExecutive, b.accountManager) || DASH,
      lastNotification: latestComm ? latestComm.sentAt : null,
      notificationChannel: latestComm ? latestComm.channel : DASH,
      acknowledgementStatus: latestComm ? latestComm.acknowledgementStatus : 'Not Notified',
      deliveryStatus: latestComm ? latestComm.deliveryStatus : DASH,
      notificationStatus: latestComm ? latestComm.notificationStatus : 'Not Notified',
      rawRecord: b,
    });
  }

  // 2. Process Sellers (Vendors)
  for (const { vendor: v, available } of vendorEntries) {
    if (!isLowCredit(available)) continue;

    const totalCredits = getSellerPlanQuota(v) ?? parseCredits(v.totalCredits ?? v.freeCreditsAllocated, null);
    const creditsUsed = getSellerCreditsUsed(v, totalCredits, available);
    const history = commMap.get(v.id) || [];
    const latestComm = history[0] || null;

    allEligibleAccounts.push({
      accountId: v.id,
      accountType: 'seller',
      companyName: pickFirst(v.name, v.companyName) || DASH,
      contactPerson: pickFirst(v.contactPerson, v.ownerName, v.contactName) || DASH,
      email: pickFirst(v.email, v.corporateEmail) || DASH,
      phoneNumber: pickFirst(v.phone, v.mobile, v.mobileNumber) || DASH,
      availableCredits: available,
      totalCredits,
      creditsUsed,
      accountStatus: v.status || DASH,
      registrationDate: pickFirst(v.createdAt, v.created_at) || null,
      lastActivity: pickFirst(v.lastActivity, v.updatedAt, v.updated_at, v.createdAt) || null,
      assignedExecutive: pickFirst(v.assignedExecutive, v.accountManager) || DASH,
      lastNotification: latestComm ? latestComm.sentAt : null,
      notificationChannel: latestComm ? latestComm.channel : DASH,
      acknowledgementStatus: latestComm ? latestComm.acknowledgementStatus : 'Not Notified',
      deliveryStatus: latestComm ? latestComm.deliveryStatus : DASH,
      notificationStatus: latestComm ? latestComm.notificationStatus : 'Not Notified',
      rawRecord: v,
    });
  }

  // Compute summary metrics across all eligible low-credit accounts (independent of pagination)
  const summary = {
    totalLowCreditAccounts: allEligibleAccounts.length,
    totalBuyers: allEligibleAccounts.filter((a) => a.accountType === 'buyer').length,
    totalSellers: allEligibleAccounts.filter((a) => a.accountType === 'seller').length,
    zeroCredits: allEligibleAccounts.filter((a) => a.availableCredits === 0).length,
    oneToTwoCredits: allEligibleAccounts.filter((a) => a.availableCredits === 1 || a.availableCredits === 2).length,
    acknowledgementPending: allEligibleAccounts.filter((a) => a.acknowledgementStatus === 'Acknowledgement Pending').length,
  };

  // Filtering
  let filtered = [...allEligibleAccounts];

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((a) => {
      return (
        a.companyName.toLowerCase().includes(q) ||
        a.contactPerson.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phoneNumber.toLowerCase().includes(q) ||
        a.accountId.toLowerCase().includes(q) ||
        a.assignedExecutive.toLowerCase().includes(q)
      );
    });
  }

  if (accountType && accountType !== 'all') {
    filtered = filtered.filter((a) => a.accountType.toLowerCase() === accountType.toLowerCase());
  }

  if (credits && credits !== 'all') {
    if (credits === '0') {
      filtered = filtered.filter((a) => a.availableCredits === 0);
    } else if (credits === '1-2') {
      filtered = filtered.filter((a) => a.availableCredits === 1 || a.availableCredits === 2);
    } else {
      const numCredits = Number(credits);
      if (!isNaN(numCredits)) {
        filtered = filtered.filter((a) => a.availableCredits === numCredits);
      }
    }
  }

  if (acknowledgementStatus && acknowledgementStatus !== 'all') {
    filtered = filtered.filter(
      (a) => a.acknowledgementStatus.toLowerCase() === acknowledgementStatus.toLowerCase()
    );
  }

  if (accountStatus && accountStatus !== 'all') {
    filtered = filtered.filter((a) => a.accountStatus.toLowerCase() === accountStatus.toLowerCase());
  }

  if (assignedExecutive && assignedExecutive !== 'all') {
    filtered = filtered.filter(
      (a) => a.assignedExecutive.toLowerCase() === assignedExecutive.toLowerCase()
    );
  }

  if (notificationChannel && notificationChannel !== 'all') {
    filtered = filtered.filter(
      (a) => a.notificationChannel.toLowerCase() === notificationChannel.toLowerCase()
    );
  }

  // Sorting
  const dir = sortOrder && sortOrder.toLowerCase() === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];

    if (valA == null) valA = '';
    if (valB == null) valB = '';

    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dir;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    if (strA < strB) return -1 * dir;
    if (strA > strB) return 1 * dir;
    return 0;
  });

  const total = filtered.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, parseInt(limit, 10) || 25);
  const offset = (pageNum - 1) * pageSize;
  const paginatedRows = filtered.slice(offset, offset + pageSize);

  return {
    accounts: paginatedRows,
    total,
    summary,
    page: pageNum,
    limit: pageSize,
  };
}

/**
 * Get summary metrics only
 */
async function getPaymentDuesSummary() {
  const result = await getLowCreditAccounts({ limit: 1 });
  return result.summary;
}

/**
 * Record a communication attempt (Email, Message, or WhatsApp)
 */
async function recordCommunication({
  accountId,
  accountType,
  channel,
  recipient,
  subject = '',
  message,
  notificationStatus = 'Notification Pending',
  deliveryStatus = 'Pending',
  acknowledgementStatus = 'Acknowledgement Pending',
  communicatedBy,
  notes = '',
  metadata = {},
}) {
  // Statuses default to pending. A communication is reported delivered only when the
  // caller passes a delivery result from a provider.
  const sender = String(communicatedBy || '').trim();
  if (!sender) throw validationError(PAYMENT_DUES_ERRORS.COMMUNICATED_BY_REQUIRED);
  requireStorage('communication insert');

  const id = `pdc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const sql = `
    INSERT INTO payment_dues_communications (
      id, account_id, account_type, channel, recipient, subject, message,
      notification_status, delivery_status, acknowledgement_status,
      communicated_by, sent_at, notes, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `;
  const d1Sql = `
    INSERT INTO payment_dues_communications (
      id, account_id, account_type, channel, recipient, subject, message,
      notification_status, delivery_status, acknowledgement_status,
      communicated_by, sent_at, notes, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `;
  try {
    await pool.query(
      sql,
      [
        id,
        accountId,
        accountType,
        channel,
        recipient,
        subject || '',
        message,
        notificationStatus,
        deliveryStatus,
        acknowledgementStatus,
        sender,
        now,
        notes,
        typeof metadata === 'object' ? JSON.stringify(metadata) : metadata,
        now,
        now,
      ],
      { d1: true, d1Text: d1Sql }
    );
  } catch (err) {
    throwPersistenceUnavailable('communication insert', err);
  }

  return {
    id,
    accountId,
    accountType,
    channel,
    recipient,
    subject: subject || '',
    message,
    notificationStatus,
    deliveryStatus,
    acknowledgementStatus,
    communicatedBy: sender,
    sentAt: now,
    acknowledgedAt: null,
    acknowledgedBy: null,
    notes,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

async function updateCommunicationDeliveryStatus({
  communicationId,
  notificationStatus,
  deliveryStatus,
  acknowledgementStatus,
  metadataPatch,
}) {
  if (!communicationId) return null;
  requireStorage('delivery status update');

  const now = new Date().toISOString();
  const sql = `
    UPDATE payment_dues_communications
    SET notification_status = $2,
        delivery_status = $3,
        acknowledgement_status = $4,
        updated_at = $5,
        metadata = CASE WHEN $6::jsonb IS NULL THEN metadata
          ELSE COALESCE(metadata, '{}'::jsonb) || $6::jsonb END
    WHERE id = $1
    RETURNING *
  `;
  const d1Sql = `
    UPDATE payment_dues_communications
    SET notification_status = $2,
        delivery_status = $3,
        acknowledgement_status = $4,
        updated_at = $5,
        metadata = CASE WHEN $6 IS NULL THEN metadata
          ELSE json_patch(COALESCE(metadata, '{}'), $6) END
    WHERE id = $1
    RETURNING *
  `;
  let result;
  try {
    result = await pool.query(sql, [
      communicationId,
      notificationStatus,
      deliveryStatus,
      acknowledgementStatus,
      now,
      metadataPatch === undefined ? null : JSON.stringify(metadataPatch),
    ], { d1: true, d1Text: d1Sql });
  } catch (error) {
    throwPersistenceUnavailable('delivery status update', error);
  }
  const row = result?.rows?.[0];
  return row ? mapCommunicationRow(row) : null;
}

/**
 * Update acknowledgement status of an account
 */
async function updateAcknowledgementStatus({
  communicationId,
  accountId,
  acknowledgementStatus,
  deliveryStatus,
  notes = '',
  updatedBy,
}) {
  // Updates only an existing record. A missing record returns null and nothing is created.
  const actor = String(updatedBy || '').trim();
  if (!actor) throw validationError(PAYMENT_DUES_ERRORS.UPDATED_BY_REQUIRED);
  requireStorage('acknowledgement update');

  const now = new Date().toISOString();
  const sql = communicationId
    ? `
      UPDATE payment_dues_communications
      SET acknowledgement_status = COALESCE($1, acknowledgement_status),
          delivery_status = COALESCE($2, delivery_status),
          notes = COALESCE($3, notes),
          acknowledged_at = CASE WHEN $1 = 'Acknowledged' THEN $4 ELSE acknowledged_at END,
          acknowledged_by = CASE WHEN $1 = 'Acknowledged' THEN $5 ELSE acknowledged_by END,
          updated_at = $4
      WHERE id = $6
         OR metadata->>'gatewayMessageId' = $6
         OR metadata->>'msgid' = $6
          OR metadata->>'messageId' = $6
         OR metadata->'smsResult'->>'messageId' = $6
         OR metadata->'emailResult'->>'messageId' = $6
      RETURNING *
    `
    : `
      UPDATE payment_dues_communications
      SET acknowledgement_status = COALESCE($1, acknowledgement_status),
          delivery_status = COALESCE($2, delivery_status),
          notes = COALESCE($3, notes),
          acknowledged_at = CASE WHEN $1 = 'Acknowledged' THEN $4 ELSE acknowledged_at END,
          acknowledged_by = CASE WHEN $1 = 'Acknowledged' THEN $5 ELSE acknowledged_by END,
          updated_at = $4
      WHERE id = (
        SELECT id FROM payment_dues_communications
        WHERE account_id = $6
        ORDER BY sent_at DESC
        LIMIT 1
      )
      RETURNING *
    `;
  const d1Sql = communicationId
    ? `
      UPDATE payment_dues_communications
      SET acknowledgement_status = COALESCE($1, acknowledgement_status),
          delivery_status = COALESCE($2, delivery_status),
          notes = COALESCE($3, notes),
          acknowledged_at = CASE WHEN $1 = 'Acknowledged' THEN $4 ELSE acknowledged_at END,
          acknowledged_by = CASE WHEN $1 = 'Acknowledged' THEN $5 ELSE acknowledged_by END,
          updated_at = $4
      WHERE id = $6
         OR json_extract(metadata, '$.gatewayMessageId') = $6
         OR json_extract(metadata, '$.msgid') = $6
         OR json_extract(metadata, '$.messageId') = $6
         OR json_extract(metadata, '$.smsResult.messageId') = $6
         OR json_extract(metadata, '$.emailResult.messageId') = $6
      RETURNING *
    `
    : sql;
  const queryParams = [
    acknowledgementStatus || null,
    deliveryStatus || null,
    notes || null,
    now,
    actor,
    communicationId || accountId,
  ];
  let result;
  try {
    result = await pool.query(sql, queryParams, { d1: true, d1Text: d1Sql });
  } catch (err) {
    throwPersistenceUnavailable('acknowledgement update', err);
  }
  const row = result?.rows?.[0];
  return row ? mapCommunicationRow(row) : null;
}

/**
 * Get communication history for an account or across all accounts
 */
async function getCommunicationHistory(accountId, options = {}) {
  const isAll = Boolean(options?.isCrossAccount) && (!accountId || accountId === '' || accountId === '*');
  const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
  const offset = Math.max(Number(options?.offset) || 0, 0);
  requireStorage('communication history read');

  const sql = isAll
    ? 'SELECT * FROM payment_dues_communications ORDER BY sent_at DESC LIMIT $1 OFFSET $2'
    : 'SELECT * FROM payment_dues_communications WHERE account_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3';
  const params = isAll ? [limit, offset] : [accountId, limit, offset];
  let result;
  try {
    result = await pool.query(sql, params, { d1: true, d1Text: sql });
  } catch (error) {
    throwPersistenceUnavailable('communication history read', error);
  }
  if (!result || !Array.isArray(result.rows)) {
    throwPersistenceUnavailable('communication history read', new Error('The history query returned no row set.'));
  }
  return result.rows.map(mapCommunicationRow);
}

async function getCommunicationById(communicationId) {
  if (!communicationId) return null;
  requireStorage('communication lookup');

  const sql = 'SELECT * FROM payment_dues_communications WHERE id = $1 LIMIT 1';
  let result;
  try {
    result = await pool.query(sql, [communicationId], { d1: true, d1Text: sql });
  } catch (error) {
    throwPersistenceUnavailable('communication lookup', error);
  }
  return result?.rows?.[0] ? mapCommunicationRow(result.rows[0]) : null;
}


/**
 * Query communications with database-level filtering and pagination.
 */
async function queryCommunications({
  accountId,
  entityType,
  channel,
  limit = 20,
  offset = 0,
  isCrossAccount = false,
} = {}) {
  const pLimit = Math.max(1, Number(limit) || 20);
  const pOffset = Math.max(0, Number(offset) || 0);
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (accountId && !isCrossAccount) {
    conditions.push(`account_id = $${paramIdx++}`);
    params.push(accountId);
  }

  if (entityType) {
    conditions.push(`(LOWER(account_type) = LOWER($${paramIdx}) OR LOWER(metadata->>'entityType') = LOWER($${paramIdx}))`);
    paramIdx++;
    params.push(entityType);
  }

  if (channel && channel !== 'ALL') {
    conditions.push(`UPPER(channel) = UPPER($${paramIdx++})`);
    params.push(channel);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  if (pool.hasStorage()) {
    try {
      const countSql = `SELECT COUNT(*) AS total FROM payment_dues_communications ${whereClause}`;
      const countResult = await pool.query(countSql, params, { d1: true, d1Text: countSql });
      const total = Number(countResult?.rows?.[0]?.total || 0);

      const dataSql = `SELECT * FROM payment_dues_communications ${whereClause} ORDER BY sent_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      const dataParams = [...params, pLimit, pOffset];
      const dataResult = await pool.query(dataSql, dataParams, { d1: true, d1Text: dataSql });
      const rows = Array.isArray(dataResult?.rows) ? dataResult.rows : [];

      return {
        items: rows.map(mapCommunicationRow),
        total,
      };
    } catch (error) {
      throwPersistenceUnavailable('communications query', error);
    }
  }

  throwPersistenceUnavailable('communications query', null);
}

module.exports = {
  getLowCreditAccounts,
  getPaymentDuesSummary,
  recordCommunication,
  updateCommunicationDeliveryStatus,
  updateAcknowledgementStatus,
  getCommunicationHistory,
  getCommunicationById,
  queryCommunications,
  fetchRawBuyers,
  fetchRawVendors,
  fetchCommunicationsMap,
  parseRaw,
  pickFirst,
  parseCredits,
  getSellerAvailableCredits,
  getSellerCreditsUsed,
};
