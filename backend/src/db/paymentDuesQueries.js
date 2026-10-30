// ==============================================================================
// PAYMENT DUES QUERIES (PostgreSQL & Cloudflare D1 with in-memory fallback)
// ==============================================================================
// Fetches, filters, sorts, and records low-credit monitoring & communications.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const storeService = require('../services/storeService');

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

function getSellerAvailableCredits(v) {
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
    } catch {
      // fallback to storeService below
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
    } catch {
      // fallback to storeService below
    }
  }

  // Fallback to storeService
  const vendors = (await storeService.getVendors()) || [];
  return vendors.map((v) => ({ ...v }));
}

/**
 * Fetch communications for accounts
 */
async function fetchCommunicationsMap() {
  const commMap = new Map();

  if (pool.hasStorage()) {
    try {
      const sql = 'SELECT * FROM payment_dues_communications ORDER BY sent_at DESC';
      const result = await pool.query(sql, [], {
        d1: true,
        d1Text: 'SELECT * FROM payment_dues_communications ORDER BY sent_at DESC',
        useCache: true,
        tag: 'payment_dues_communications',
        ttlMs: 15000,
      });
      if (result && Array.isArray(result.rows)) {
        result.rows.forEach((row) => {
          const list = commMap.get(row.account_id) || [];
          list.push({
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
          });
          commMap.set(row.account_id, list);
        });
        return commMap;
      }
    } catch {
      // fallback to in-memory map
    }
  }

  // In-memory fallback
  for (const [accId, list] of inMemoryCommunications.entries()) {
    commMap.set(accId, [...list]);
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
  const [buyers, vendors, commMap] = await Promise.all([
    module.exports.fetchRawBuyers(),
    module.exports.fetchRawVendors(),
    fetchCommunicationsMap(),
  ]);

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

    const totalCredits = Number(v.totalCredits || v.freeCreditsAllocated || 10);
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
    } catch {
      // store in memory on DB failure
    }
  }

  // Always update in-memory record
  const list = inMemoryCommunications.get(accountId) || [];
  list.unshift(record);
  inMemoryCommunications.set(accountId, list);

  return record;
}

/**
 * Update acknowledgement status of an account
 */
async function updateAcknowledgementStatus({
  accountId,
  accountType,
  acknowledgementStatus,
  notes = '',
  updatedBy = 'Category Manager',
}) {
  const now = new Date().toISOString();
  let updatedRecord = null;

  if (pool.hasStorage()) {
    try {
      const sql = `
        UPDATE payment_dues_communications
        SET acknowledgement_status = $1,
            notes = COALESCE($2, notes),
            acknowledged_at = CASE WHEN $1 = 'Acknowledged' THEN $3 ELSE acknowledged_at END,
            acknowledged_by = CASE WHEN $1 = 'Acknowledged' THEN $4 ELSE acknowledged_by END,
            updated_at = $3
        WHERE id = (
          SELECT id FROM payment_dues_communications
          WHERE account_id = $5
          ORDER BY sent_at DESC
          LIMIT 1
        )
        RETURNING *
      `;
      const result = await pool.query(sql, [acknowledgementStatus, notes || null, now, updatedBy, accountId]);
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
    } catch {
      // fallback to in-memory
    }
  }

  // Update in-memory list
  const list = inMemoryCommunications.get(accountId) || [];
  if (list.length > 0) {
    const item = list[0];
    item.acknowledgementStatus = acknowledgementStatus;
    if (notes) item.notes = notes;
    if (acknowledgementStatus === 'Acknowledged') {
      item.acknowledgedAt = now;
      item.acknowledgedBy = updatedBy;
    }
    item.updatedAt = now;
    updatedRecord = item;
  } else {
    // If no prior communication existed, create an initial acknowledgement record
    updatedRecord = await recordCommunication({
      accountId,
      accountType: accountType || 'buyer',
      channel: 'message',
      recipient: accountId,
      subject: 'Manual Acknowledgement Status Update',
      message: `Status updated to ${acknowledgementStatus}`,
      communicatedBy: updatedBy,
      notificationStatus: 'Delivered',
      deliveryStatus: 'Delivered',
      acknowledgementStatus,
      notes,
    });
    if (acknowledgementStatus === 'Acknowledged') {
      updatedRecord.acknowledgedAt = now;
      updatedRecord.acknowledgedBy = updatedBy;
    }
  }

  return updatedRecord;
}

/**
 * Get communication history for an account
 */
async function getCommunicationHistory(accountId) {
  if (pool.hasStorage()) {
    try {
      const sql = 'SELECT * FROM payment_dues_communications WHERE account_id = $1 ORDER BY sent_at DESC';
      const result = await pool.query(sql, [accountId], {
        d1: true,
        d1Text: 'SELECT * FROM payment_dues_communications WHERE account_id = $1 ORDER BY sent_at DESC',
      });
      if (result && Array.isArray(result.rows)) {
        return result.rows.map((row) => ({
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
        }));
      }
    } catch {
      // fallback
    }
  }

  return inMemoryCommunications.get(accountId) || [];
}

module.exports = {
  getLowCreditAccounts,
  getPaymentDuesSummary,
  recordCommunication,
  updateAcknowledgementStatus,
  getCommunicationHistory,
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
