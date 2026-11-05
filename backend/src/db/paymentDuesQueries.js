// ==============================================================================
// PAYMENT DUES QUERIES (PostgreSQL & Cloudflare D1 with in-memory fallback)
// ==============================================================================
// Fetches, filters, sorts, and records low-credit monitoring & communications.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { VENDOR_PLAN_RFQ_QUOTA } = require('../config/constants');

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
  if (v.availableCredits != null) return parseCredits(v.availableCredits, 0);
  if (v.freeQuotationCredits != null) return parseCredits(v.freeQuotationCredits, 0);
  if (v.freeRfqDownloadCredits != null) return parseCredits(v.freeRfqDownloadCredits, 0);
  if (v.freeCreditsRemaining != null) return parseCredits(v.freeCreditsRemaining, 0);
  if (v.credits != null) return parseCredits(v.credits, 0);
  return 0;
}

function getSellerCreditsUsed(v, totalCredits, available) {
  if (v.freeCreditsUsed != null) return Number(v.freeCreditsUsed);
  if (v.rfqDownloadsUsed != null) return Number(v.rfqDownloadsUsed);
  return Math.max(0, totalCredits - available);
}

// In-memory communications storage when pool.hasStorage() is false (e.g. tests / offline)
const inMemoryCommunications = new Map();

function throwPersistenceUnavailable(operation, cause) {
  const error = new Error(`Payment dues ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Payment dues persistence failed; refusing in-memory fallback', {
    operation,
    error: cause,
  }, 'PAYMENT_DUES');
  throw error;
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
 * Reset in-memory communications (used by unit tests)
 */
function resetInMemoryCommunications() {
  inMemoryCommunications.clear();
}

/**
 * Retrieve all registered buyers from database or storeService
 */
async function fetchRawBuyers() {
  if (pool.hasStorage()) {
    try {
      const sql = 'SELECT id, is_active, raw, created_at, updated_at FROM buyer_accounts ORDER BY created_at DESC';
      const result = await pool.query(sql, [], {
        d1: true,
        d1Text: 'SELECT id, is_active, raw, created_at, updated_at FROM buyer_accounts ORDER BY created_at DESC',
        useCache: true,
        tag: 'buyer_accounts',
        ttlMs: 30000,
      });
      if (result && Array.isArray(result.rows)) {
        return result.rows.map((row) => {
          const raw = parseRaw(row.raw, {});
          return {
            id: row.id,
            ...raw,
            createdAt: row.created_at || raw.createdAt || '',
            updatedAt: row.updated_at || raw.updatedAt || '',
            isActive: row.is_active !== undefined ? row.is_active : raw.isActive,
          };
        });
      }
    } catch (error) {
      throwPersistenceUnavailable('buyer account read', error);
    }
  }

  // Fallback to storeService
  const accounts = storeService.getBuyerAccounts() || [];
  return accounts.map((acc) => ({ ...acc }));
}

/**
 * Retrieve all registered vendors from database or storeService
 */
async function fetchRawVendors() {
  if (pool.hasStorage()) {
    try {
      const sql = 'SELECT id, email, status, raw, created_at, updated_at FROM vendors ORDER BY created_at DESC';
      const result = await pool.query(sql, [], {
        d1: true,
        d1Text: 'SELECT id, email, status, raw, created_at, updated_at FROM vendors ORDER BY created_at DESC',
        useCache: true,
        tag: 'vendors',
        ttlMs: 30000,
      });
      if (result && Array.isArray(result.rows)) {
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
    } catch (error) {
      throwPersistenceUnavailable('vendor account read', error);
    }
  }

  // Fallback to storeService
  const vendors = (await storeService.getVendors()) || [];
  return vendors.map((v) => ({ ...v }));
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

  // In-memory fallback
  for (const [accId, list] of inMemoryCommunications.entries()) {
    if (hasAccountFilter && !selectedAccountIdSet.has(accId)) continue;
    if (list[0]) commMap.set(accId, [list[0]]);
  }
  return commMap;
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
  const lowCreditAccountIds = [
    ...buyers
      .filter((buyer) => {
        const available = parseCredits(buyer.remainingFreeRFQs, 5);
        return available <= 2 && available >= 0;
      })
      .map((buyer) => buyer.id),
    ...vendors
      .filter((vendor) => {
        const available = getSellerAvailableCredits(vendor);
        return available <= 2 && available >= 0;
      })
      .map((vendor) => vendor.id),
  ].filter(Boolean);
  const commMap = await fetchCommunicationsMap(lowCreditAccountIds);

  const allEligibleAccounts = [];

  // 1. Process Buyers
  for (const b of buyers) {
    const available = parseCredits(b.remainingFreeRFQs, 5);
    // Strict eligibility: available credits <= 2 and >= 0
    if (available > 2 || available < 0) continue;

    const totalCredits = Number(b.totalCredits || 5);
    const creditsUsed = Math.max(0, totalCredits - available);
    const history = commMap.get(b.id) || [];
    const latestComm = history[0] || null;

    allEligibleAccounts.push({
      accountId: b.id,
      accountType: 'buyer',
      companyName: pickFirst(b.organizationName, b.companyName, b.name, 'Unnamed Buyer'),
      contactPerson: pickFirst(b.contactPerson, b.fullName, b.adminName, b.name, '–'),
      email: pickFirst(b.corporateEmail, b.email, '–'),
      phoneNumber: pickFirst(b.phone, b.mobile, b.contactNumber, '–'),
      availableCredits: available,
      totalCredits,
      creditsUsed,
      accountStatus: b.status || (b.isActive !== false ? 'Active' : 'Inactive'),
      registrationDate: pickFirst(b.createdAt, b.created_at, new Date().toISOString()),
      lastActivity: pickFirst(b.lastActivity, b.lastLogin, b.updatedAt, b.updated_at, b.createdAt, new Date().toISOString()),
      assignedExecutive: pickFirst(b.assignedExecutive, b.accountManager, 'CM Team'),
      lastNotification: latestComm ? latestComm.sentAt : null,
      notificationChannel: latestComm ? latestComm.channel : '–',
      acknowledgementStatus: latestComm ? latestComm.acknowledgementStatus : 'Not Notified',
      deliveryStatus: latestComm ? latestComm.deliveryStatus : '–',
      notificationStatus: latestComm ? latestComm.notificationStatus : 'Not Notified',
      rawRecord: b,
    });
  }

  // 2. Process Sellers (Vendors)
  for (const v of vendors) {
    const available = getSellerAvailableCredits(v);
    // Strict eligibility: available credits <= 2 and >= 0
    if (available > 2 || available < 0) continue;

    const totalCredits = getSellerPlanQuota(v) ?? Number(v.totalCredits || v.freeCreditsAllocated || 10);
    const creditsUsed = getSellerCreditsUsed(v, totalCredits, available);
    const history = commMap.get(v.id) || [];
    const latestComm = history[0] || null;

    allEligibleAccounts.push({
      accountId: v.id,
      accountType: 'seller',
      companyName: pickFirst(v.name, v.companyName, 'Unnamed Seller'),
      contactPerson: pickFirst(v.contactPerson, v.ownerName, v.contactName, '–'),
      email: pickFirst(v.email, v.corporateEmail, '–'),
      phoneNumber: pickFirst(v.phone, v.mobile, v.mobileNumber, '–'),
      availableCredits: available,
      totalCredits,
      creditsUsed,
      accountStatus: v.status || 'Active',
      registrationDate: pickFirst(v.createdAt, v.created_at, new Date().toISOString()),
      lastActivity: pickFirst(v.lastActivity, v.updatedAt, v.updated_at, v.createdAt, new Date().toISOString()),
      assignedExecutive: pickFirst(v.assignedExecutive, v.accountManager, 'CM Team'),
      lastNotification: latestComm ? latestComm.sentAt : null,
      notificationChannel: latestComm ? latestComm.channel : '–',
      acknowledgementStatus: latestComm ? latestComm.acknowledgementStatus : 'Not Notified',
      deliveryStatus: latestComm ? latestComm.deliveryStatus : '–',
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
  notificationStatus = 'Notification Sent',
  deliveryStatus = 'Delivered',
  acknowledgementStatus = 'Acknowledgement Pending',
  communicatedBy = 'Category Manager',
  notes = '',
  metadata = {},
}) {
  const id = `pdc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const record = {
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
    communicatedBy,
    sentAt: now,
    acknowledgedAt: null,
    acknowledgedBy: null,
    notes,
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  if (pool.hasStorage()) {
    try {
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
          communicatedBy,
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
  }

  // Always update in-memory record
  const list = inMemoryCommunications.get(accountId) || [];
  list.unshift(record);
  inMemoryCommunications.set(accountId, list);

  return record;
}

async function updateCommunicationDeliveryStatus({
  communicationId,
  notificationStatus,
  deliveryStatus,
  acknowledgementStatus,
}) {
  if (!communicationId) return null;

  const now = new Date().toISOString();
  if (pool.hasStorage()) {
    const sql = `
      UPDATE payment_dues_communications
      SET notification_status = $2,
          delivery_status = $3,
          acknowledgement_status = $4,
          updated_at = $5
      WHERE id = $1
      RETURNING *
    `;
    try {
      const result = await pool.query(sql, [
        communicationId,
        notificationStatus,
        deliveryStatus,
        acknowledgementStatus,
        now,
      ], { d1: true, d1Text: sql });
      const row = result?.rows?.[0];
      if (!row) return null;
      return mapCommunicationRow(row);
    } catch (error) {
      throwPersistenceUnavailable('delivery status update', error);
    }
  }

  for (const communications of inMemoryCommunications.values()) {
    const communication = communications.find((item) => item.id === communicationId);
    if (!communication) continue;
    communication.notificationStatus = notificationStatus;
    communication.deliveryStatus = deliveryStatus;
    communication.acknowledgementStatus = acknowledgementStatus;
    communication.updatedAt = now;
    return communication;
  }

  return null;
}

/**
 * Update acknowledgement status of an account
 */
async function updateAcknowledgementStatus({
  communicationId,
  accountId,
  accountType,
  acknowledgementStatus,
  deliveryStatus,
  notes = '',
  updatedBy = 'Category Manager',
}) {
  const now = new Date().toISOString();
  let updatedRecord = null;

  if (pool.hasStorage()) {
    try {
      const targetParam = communicationId || accountId;
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
        updatedBy,
        targetParam,
      ];
      const result = await pool.query(sql, queryParams, { d1: true, d1Text: d1Sql });
      if (result && result.rows && result.rows.length > 0) {
        const row = result.rows[0];
        updatedRecord = {
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
    } catch (err) {
      throwPersistenceUnavailable('acknowledgement update', err);
    }
  }

  if (pool.hasStorage()) return updatedRecord;

  // Update in-memory storage
  if (communicationId) {
    for (const list of inMemoryCommunications.values()) {
      const found = list.find(
        (item) =>
          item.id === communicationId ||
          item.metadata?.gatewayMessageId === communicationId ||
          item.metadata?.msgid === communicationId ||
          item.metadata?.messageId === communicationId ||
          item.metadata?.smsResult?.messageId === communicationId ||
          item.metadata?.emailResult?.messageId === communicationId
      );
      if (found) {
        if (acknowledgementStatus) found.acknowledgementStatus = acknowledgementStatus;
        if (notes) found.notes = notes;
        if (acknowledgementStatus === 'Acknowledged') {
          found.acknowledgedAt = now;
          found.acknowledgedBy = updatedBy;
        }

        if (found.channel === 'BOTH') {
          if (deliveryStatus) {
            const isSmsTarget = found.metadata?.gatewayMessageId === communicationId ||
              found.metadata?.msgid === communicationId ||
              found.metadata?.smsResult?.messageId === communicationId;
            const isEmailTarget = found.metadata?.emailResult?.messageId === communicationId;

            if (isSmsTarget && !isEmailTarget) {
              found.metadata = found.metadata || {};
              found.metadata.smsDeliveryStatus = deliveryStatus;
              const emailState = found.metadata.emailDeliveryStatus ||
                ((found.metadata.emailResult?.success || found.metadata.emailResult?.sent) ? 'Delivered' : 'Failed');
              found.deliveryStatus = (emailState === 'Delivered' && deliveryStatus === 'Delivered')
                ? 'Delivered'
                : (deliveryStatus === 'Failed' && emailState === 'Failed')
                ? 'Failed'
                : 'Partial';
            } else if (isEmailTarget && !isSmsTarget) {
              found.metadata = found.metadata || {};
              found.metadata.emailDeliveryStatus = deliveryStatus;
              const smsState = found.metadata.smsDeliveryStatus ||
                ((found.metadata.smsResult?.success || found.metadata.smsResult?.sent) ? 'Delivered' : 'Failed');
              found.deliveryStatus = (smsState === 'Delivered' && deliveryStatus === 'Delivered')
                ? 'Delivered'
                : (deliveryStatus === 'Failed' && smsState === 'Failed')
                ? 'Failed'
                : 'Partial';
            } else {
              found.deliveryStatus = deliveryStatus;
            }
          }
        } else if (deliveryStatus) {
          found.deliveryStatus = deliveryStatus;
        }

        found.updatedAt = now;
        updatedRecord = found;
        break;
      }
    }
    return updatedRecord;
  }

  // Fallback by accountId when communicationId is not provided
  if (accountId) {
    const list = inMemoryCommunications.get(accountId) || [];
    if (list.length > 0) {
      const item = list[0];
      if (acknowledgementStatus) item.acknowledgementStatus = acknowledgementStatus;
      if (deliveryStatus) item.deliveryStatus = deliveryStatus;
      if (notes) item.notes = notes;
      if (acknowledgementStatus === 'Acknowledged') {
        item.acknowledgedAt = now;
        item.acknowledgedBy = updatedBy;
      }
      item.updatedAt = now;
      updatedRecord = item;
    } else {
      updatedRecord = await recordCommunication({
        accountId,
        accountType: accountType || 'buyer',
        channel: 'message',
        recipient: accountId,
        subject: 'Manual Acknowledgement Status Update',
        message: `Status updated to ${acknowledgementStatus || deliveryStatus}`,
        communicatedBy: updatedBy,
        notificationStatus: 'Delivered',
        deliveryStatus: deliveryStatus || 'Delivered',
        acknowledgementStatus: acknowledgementStatus || 'Pending',
        notes,
      });
      if (acknowledgementStatus === 'Acknowledged') {
        updatedRecord.acknowledgedAt = now;
        updatedRecord.acknowledgedBy = updatedBy;
      }
    }
  }

  return updatedRecord;
}

/**
 * Get communication history for an account or across all accounts
 */
async function getCommunicationHistory(accountId, options = {}) {
  const isAll = Boolean(options?.isCrossAccount) && (!accountId || accountId === '' || accountId === '*');
  const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
  const offset = Math.max(Number(options?.offset) || 0, 0);

  if (pool.hasStorage()) {
    try {
      const sql = isAll
        ? 'SELECT * FROM payment_dues_communications ORDER BY sent_at DESC LIMIT $1 OFFSET $2'
        : 'SELECT * FROM payment_dues_communications WHERE account_id = $1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3';
      const params = isAll ? [limit, offset] : [accountId, limit, offset];
      const result = await pool.query(sql, params, {
        d1: true,
        d1Text: sql,
      });
      if (result && Array.isArray(result.rows)) {
        return result.rows.map(mapCommunicationRow);
      }
    } catch (error) {
      throwPersistenceUnavailable('communication history read', error);
    }
  }

  if (isAll) {
    const all = [];
    for (const comms of inMemoryCommunications.values()) {
      all.push(...comms);
    }
    all.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
    return all.slice(offset, offset + limit);
  }

  const list = inMemoryCommunications.get(accountId) || [];
  return list.slice(offset, offset + limit);
}

async function getCommunicationById(communicationId) {
  if (!communicationId) return null;

  if (pool.hasStorage()) {
    const sql = 'SELECT * FROM payment_dues_communications WHERE id = $1 LIMIT 1';
    try {
      const result = await pool.query(sql, [communicationId], { d1: true, d1Text: sql });
      return result?.rows?.[0] ? mapCommunicationRow(result.rows[0]) : null;
    } catch (error) {
      throwPersistenceUnavailable('communication lookup', error);
    }
  }

  for (const communications of inMemoryCommunications.values()) {
    const record = communications.find((communication) => communication.id === communicationId);
    if (record) return record;
  }
  return null;
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

  // In-memory query implementation
  let all = [];
  if (accountId && !isCrossAccount) {
    all = [...(inMemoryCommunications.get(accountId) || [])];
  } else {
    for (const comms of inMemoryCommunications.values()) {
      all.push(...comms);
    }
  }

  if (entityType) {
    const et = String(entityType).toLowerCase();
    all = all.filter(
      (r) => String(r.accountType || '').toLowerCase() === et || String(r.metadata?.entityType || '').toLowerCase() === et
    );
  }

  if (channel && channel !== 'ALL') {
    const ch = String(channel).toUpperCase();
    all = all.filter((r) => String(r.channel || '').toUpperCase() === ch);
  }

  all.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
  const total = all.length;
  const items = all.slice(pOffset, pOffset + pLimit);

  return { items, total };
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
  resetInMemoryCommunications,
  fetchRawBuyers,
  fetchRawVendors,
  fetchCommunicationsMap,
  parseRaw,
  pickFirst,
  parseCredits,
  getSellerAvailableCredits,
  getSellerCreditsUsed,
};
