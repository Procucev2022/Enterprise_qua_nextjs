// ==============================================================================
// REGISTRATION QUERIES
// ==============================================================================
// Queries and state management for Registered Clients in Action Center.
// Provides persistent storage via the "user" & "organization" identity tables.
// Missing storage throws a PERSISTENCE_UNAVAILABLE (503) error; no client data is
// kept in or served from memory.
// ==============================================================================

const pool = require('./pool');
const { logger } = require('../services/loggerService');
const crypto = require('crypto');
const { getD1Binding, getD1HttpClient, batchD1 } = require('./d1Bridge');
const {
  EVENT_OUTBOX_TYPES,
  IDENTITY_ROLE_MAP,
} = require('../config/constants');

const REGISTRATION_ROLE_NAMES = Object.freeze(
  Object.keys(IDENTITY_ROLE_MAP).filter((roleName) => ['buyer', 'vendor'].includes(IDENTITY_ROLE_MAP[roleName]))
);
const REGISTRATION_VENDOR_ROLE_NAMES = Object.freeze(
  Object.keys(IDENTITY_ROLE_MAP).filter((roleName) => IDENTITY_ROLE_MAP[roleName] === 'vendor')
);

function normalizeSourceType(source) {
  const s = String(source || '').toLowerCase().trim();
  if (!s) return null;
  if (s.includes('whatsapp') || s.includes('whats_app')) return 'WhatsApp';
  if (s.includes('email')) return 'Email';
  return 'Web App';
}

/**
 * Maps a role name to the client type. This matches the SQL classification used
 * for filtering: vendor and supplier roles are sellers, and other roles are buyers.
 * A missing role has no classification, so the result is null.
 */
function normalizeClientType(roleName) {
  const s = String(roleName || '').toLowerCase().trim();
  if (!s) return null;
  if (s.includes('seller') || s.includes('vendor') || s.includes('supplier')) return 'Seller';
  return 'Buyer';
}

function normalizeStatus(isApproved, verificationStatus) {
  const vs = String(verificationStatus || '').toLowerCase();
  if (vs === 'rejected') return 'Rejected';
  if (isApproved === true || vs === 'verified' || vs === 'accepted' || vs === 'active') return 'Accepted';
  return 'New';
}

function createPersistenceError(error, operation, id = undefined, action = undefined) {
  logger.error('Client registration persistence failed', {
    error,
    operation,
    ...(id ? { registrationId: id } : {}),
    ...(action ? { action } : {}),
  }, 'REGISTRATION_QUERIES');
  const unavailable = new Error('Registration storage is temporarily unavailable. No action was completed. Please retry shortly.');
  unavailable.code = 'PERSISTENCE_UNAVAILABLE';
  unavailable.status = 503;
  unavailable.statusCode = 503;
  unavailable.cause = error;
  return unavailable;
}

const REGISTRATION_QUERY_ERRORS = Object.freeze({
  ACTOR_REQUIRED: 'A signed-in user is required to decide a client registration.',
});

function storageUnavailable(operation) {
  return createPersistenceError(new Error('Registration storage is not configured.'), operation);
}

function registrationConflict() {
  const conflict = new Error('This registration has already been processed. Refresh the list before taking another action.');
  conflict.code = 'REGISTRATION_ALREADY_PROCESSED';
  conflict.status = 409;
  conflict.statusCode = 409;
  return conflict;
}

function normalizeClientRow(row) {
  const source = row.isWhatsApp ? 'WhatsApp' : normalizeSourceType(row.sourceTypeRaw);
  const computedStatus = normalizeStatus(row.isApproved, row.verificationStatus);
  const registeredAt = row.regDate ? new Date(row.regDate) : null;
  return {
    id: row.id,
    userName: row.userName || null,
    companyName: row.companyName || null,
    phoneNumber: row.phoneNumber || null,
    userEmail: row.userEmail || null,
    regDate: registeredAt && !Number.isNaN(registeredAt.getTime()) ? registeredAt.toISOString() : null,
    status: computedStatus,
    sourceType: source,
    isApproved: Boolean(row.isApproved),
    clientType: normalizeClientType(row.roleName),
  };
}

function buildRegistrationRolePredicate(startIndex) {
  const placeholders = REGISTRATION_ROLE_NAMES.map((_, index) => `$${startIndex + index}`).join(', ');
  return `LOWER(REPLACE(COALESCE(r.role_name, ''), ' ', '')) IN (${placeholders})`;
}

function buildRegistrationSelect(whereClause) {
  return `SELECT u.uuid AS id,
      COALESCE(u.full_name, u.first_name, u.username) AS "userName",
      o.organization_name AS "companyName",
      u.phone AS "phoneNumber",
      COALESCE(u.email, u.username) AS "userEmail",
      u.created_ts AS "regDate",
      u.is_approved AS "isApproved",
      u.verification_status AS "verificationStatus",
      u.source_type AS "sourceTypeRaw",
      u.is_whats_app AS "isWhatsApp",
      u.is_web_app AS "isWebApp",
      r.role_name AS "roleName",
      COUNT(*) OVER() AS total
    FROM "user" u
    INNER JOIN role r ON r.uuid = u.role_uuid
    LEFT JOIN organization o ON o.uuid = u.org_uuid
    ${whereClause}`;
}

async function queryRegistrationRows(sql, params) {
  return pool.query(sql, params, { d1: true, useCache: false });
}

async function findRegistrationInDatabase(id) {
  const rolePredicate = buildRegistrationRolePredicate(2);
  const sql = buildRegistrationSelect(`WHERE u.uuid = $1 AND ${rolePredicate}`);
  const result = await queryRegistrationRows(sql, [id, ...REGISTRATION_ROLE_NAMES]);
  return result.rows[0] ? normalizeClientRow(result.rows[0]) : null;
}

/**
 * Get registered clients list with search, filter, and pagination
 */
async function getRegisteredClients({
  search = '',
  sourceType = 'all',
  status = 'all',
  clientType = 'all',
  limit = 100,
  offset = 0,
} = {}) {
  if (pool.hasStorage()) {
    try {
      const filters = [buildRegistrationRolePredicate(1)];
      const params = [...REGISTRATION_ROLE_NAMES];
      const addFilter = (value, predicate) => {
        params.push(value);
        filters.push(predicate(params.length));
      };


      if (sourceType && sourceType.toLowerCase() !== 'all') {
        addFilter(sourceType.toLowerCase(), (index) => `(CASE
          WHEN u.is_whats_app = true OR LOWER(COALESCE(u.source_type, '')) LIKE '%whatsapp%' THEN 'whatsapp'
          WHEN LOWER(COALESCE(u.source_type, '')) LIKE '%email%' THEN 'email'
          WHEN COALESCE(u.source_type, '') = '' AND COALESCE(u.is_whats_app, false) = false THEN NULL
          ELSE 'web app' END) = $${index}`);
      }
      if (status && status.toLowerCase() !== 'all') {
        addFilter(status.toLowerCase(), (index) => `(CASE
          WHEN LOWER(COALESCE(u.verification_status, '')) = 'rejected' THEN 'rejected'
          WHEN u.is_approved = true OR LOWER(COALESCE(u.verification_status, '')) IN ('verified', 'accepted', 'active') THEN 'accepted'
          ELSE 'new' END) = $${index}`);
      }
      if (clientType && clientType.toLowerCase() !== 'all') {
        addFilter(clientType.toLowerCase(), (index) => `(CASE
          WHEN LOWER(COALESCE(r.role_name, '')) LIKE '%vendor%' OR LOWER(COALESCE(r.role_name, '')) LIKE '%supplier%' THEN 'seller'
          ELSE 'buyer' END) = $${index}`);
      }
      if (search && search.trim()) {
        const searchValue = `%${search.trim().toLowerCase()}%`;
        addFilter(searchValue, (index) => `(
          LOWER(COALESCE(u.full_name, u.first_name, u.username, '')) LIKE $${index}
          OR LOWER(COALESCE(o.organization_name, '')) LIKE $${index}
          OR LOWER(COALESCE(u.phone, '')) LIKE $${index}
          OR LOWER(COALESCE(u.email, u.username, '')) LIKE $${index}
        )`);
      }

      const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);
      const safeOffset = Math.max(parseInt(String(offset), 10) || 0, 0);
      const where = `WHERE ${filters.join(' AND ')}`;
      const pageParams = [...params, safeLimit, safeOffset];
      const limitIndex = pageParams.length - 1;
      const offsetIndex = pageParams.length;
      const registrationQuery = buildRegistrationSelect(where);
      const sql = `${registrationQuery}
        ORDER BY u.created_ts DESC, u.uuid DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
      const result = await queryRegistrationRows(sql, pageParams);
      let rows = result.rows || [];
      let total = rows.length > 0 ? Number(rows[0].total) || 0 : 0;

      if (rows.length === 0 || rows[0].total === undefined) {
        const fromClause = registrationQuery.slice(registrationQuery.indexOf('FROM'));
        const countSql = `SELECT COUNT(*) AS total ${fromClause}`;
        const countResult = await queryRegistrationRows(countSql, params);
        total = Number(countResult.rows[0]?.total) || 0;
      }

      rows = rows.map((row) => normalizeClientRow(row));
      return { total, clients: rows, limit: safeLimit, offset: safeOffset };
    } catch (err) {
      throw createPersistenceError(err, 'list-registrations');
    }
  }

  throw storageUnavailable('list-registrations');
}

/**
 * Accept or reject a client registration
 */
async function updateClientRegistrationStatus(id, action, remarks = '', actor = {}) {
  const normAction = String(action || '').toLowerCase().trim();
  if (!['accept', 'reject'].includes(normAction)) {
    const invalidAction = new Error('Registration action must be accept or reject.');
    invalidAction.code = 'INVALID_REGISTRATION_ACTION';
    throw invalidAction;
  }
  const isAccept = normAction === 'accept';
  const newStatus = isAccept ? 'Accepted' : 'Rejected';
  const isApproved = isAccept;
  const verificationStatus = isAccept ? 'VERIFIED' : 'REJECTED';
  const normalizedRemarks = String(remarks || '');
  const actorId = actor.uuid || actor.id || actor.sub || null;
  const actorName = actor.fullName || actor.name || actor.email || null;
  const actorEmail = actor.email || null;
  if (!actorId && !actorName && !actorEmail) {
    const unauthenticated = new Error(REGISTRATION_QUERY_ERRORS.ACTOR_REQUIRED);
    unauthenticated.code = 'ACTOR_REQUIRED';
    unauthenticated.statusCode = 401;
    throw unauthenticated;
  }

  if (pool.hasStorage()) {
    try {
      const eventId = crypto.randomUUID();
      const notificationOutboxId = `registration-decision-email:${eventId}`;
      const d1 = getD1Binding() || getD1HttpClient();
      let updatedRow;

      if (d1) {
        const vendorRolePlaceholders = REGISTRATION_VENDOR_ROLE_NAMES
          .map((_, index) => `$${6 + index}`)
          .join(', ');
        const statements = [
          {
            text: `UPDATE "user"
              SET is_approved = $1, verification_status = $2, last_modified_ts = CURRENT_TIMESTAMP
              WHERE uuid = $3
                AND COALESCE(is_approved, false) = false
                AND LOWER(COALESCE(verification_status, '')) NOT IN ('verified', 'accepted', 'active', 'rejected')
                AND role_uuid IN (SELECT uuid FROM role WHERE LOWER(REPLACE(role_name, ' ', '')) IN ($4, $5, $6, $7, $8, $9))
              RETURNING uuid AS id, COALESCE(full_name, first_name, username) AS "userName",
                COALESCE(phone, '') AS "phoneNumber", COALESCE(email, username) AS "userEmail",
                created_ts AS "regDate", is_approved AS "isApproved", verification_status AS "verificationStatus",
                source_type AS "sourceTypeRaw", is_whats_app AS "isWhatsApp"`,
            params: [isApproved, verificationStatus, id, ...REGISTRATION_ROLE_NAMES],
          },
          {
            text: `INSERT INTO client_registration_events
              (id, user_id, user_email, action, previous_status, new_status,
               actor_id, actor_name, actor_email, remarks, created_at)
              SELECT $1, u.uuid, u.email, $3, 'New', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
              FROM "user" u WHERE u.uuid = $2 AND changes() = 1
              RETURNING id`,
            params: [eventId, id, newStatus, actorId, actorName, actorEmail, normalizedRemarks],
          },
          {
            text: `INSERT INTO event_outbox (id, event_type, raw)
              VALUES ($1, $2, CASE
                WHEN EXISTS (SELECT 1 FROM client_registration_events WHERE id = $5) THEN (
                  SELECT json_object(
                    'registrationId', u.uuid,
                    'recipientEmail', COALESCE(u.email, u.username),
                    'recipientName', COALESCE(u.full_name, u.first_name, u.username, u.email),
                    'accountType', CASE
                      WHEN LOWER(REPLACE(r.role_name, ' ', '')) IN (${vendorRolePlaceholders}) THEN 'Vendor'
                      ELSE 'Buyer'
                    END,
                    'decision', $3
                  )
                  FROM "user" u INNER JOIN role r ON r.uuid = u.role_uuid
                  WHERE u.uuid = $4
                )
                ELSE NULL
              END)
              RETURNING id`,
            params: [
              notificationOutboxId,
              EVENT_OUTBOX_TYPES.REGISTRATION_DECISION_EMAIL,
              newStatus.toLowerCase(),
              id,
              eventId,
              ...REGISTRATION_VENDOR_ROLE_NAMES,
            ],
          },
          {
            text: `UPDATE buyer_accounts SET status = $1, updated_at = CURRENT_TIMESTAMP
              WHERE EXISTS (SELECT 1 FROM client_registration_events WHERE id = $2)
                AND (id = $3 OR LOWER(corporate_email) =
                  (SELECT LOWER(email) FROM "user" WHERE uuid = $3))`,
            params: [isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED', eventId, id],
          },
          {
            text: `SELECT r.role_name AS "roleName"
              FROM "user" u INNER JOIN role r ON r.uuid = u.role_uuid
              WHERE u.uuid = $1
                AND EXISTS (SELECT 1 FROM client_registration_events WHERE id = $2)`,
            params: [id, eventId],
          },
        ];
        const results = await batchD1(d1, statements);
        updatedRow = results[0]?.rows?.[0] || null;
        if (updatedRow && !results[1]?.rows?.[0]) {
          throw new Error('Registration status changed without a durable event record.');
        }
        if (updatedRow && !results[2]?.rows?.[0]) {
          throw new Error('Registration status changed without a durable decision notification.');
        }
        const roleRow = results[4]?.rows?.[0];
        if (updatedRow && roleRow) updatedRow.roleName = roleRow.roleName;
      } else {
        updatedRow = await pool.withTransaction(async (client) => {
          const rolePredicate = buildRegistrationRolePredicate(2);
          const currentSql = `${buildRegistrationSelect(`WHERE u.uuid = $1 AND ${rolePredicate}`)} FOR UPDATE OF u`;
          const currentResult = await client.query(currentSql, [id, ...REGISTRATION_ROLE_NAMES]);
          const current = currentResult.rows[0];
          if (!current) return null;
          if (normalizeStatus(current.isApproved, current.verificationStatus) !== 'New') {
            throw registrationConflict();
          }

          const updateSql = `UPDATE "user"
            SET is_approved = $1, verification_status = $2, last_modified_ts = CURRENT_TIMESTAMP
            WHERE uuid = $3 AND COALESCE(is_approved, false) = false
              AND LOWER(COALESCE(verification_status, '')) NOT IN ('verified', 'accepted', 'active', 'rejected')
              AND role_uuid IN (SELECT uuid FROM role WHERE LOWER(REPLACE(role_name, ' ', '')) IN ($4, $5, $6, $7, $8, $9))
            RETURNING uuid AS id, COALESCE(full_name, first_name, username) AS "userName",
              COALESCE(phone, '') AS "phoneNumber", COALESCE(email, username) AS "userEmail",
              created_ts AS "regDate", is_approved AS "isApproved", verification_status AS "verificationStatus",
              source_type AS "sourceTypeRaw", is_whats_app AS "isWhatsApp"`;
          const updateResult = await client.query(updateSql, [isApproved, verificationStatus, id, ...REGISTRATION_ROLE_NAMES]);
          const saved = updateResult.rows[0];
          if (!saved) throw registrationConflict();

          await client.query(
            `UPDATE buyer_accounts SET status = $1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $2 OR LOWER(corporate_email) = LOWER($3)`,
            [isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED', id, saved.userEmail]
          );
          await client.query(
            `INSERT INTO client_registration_events
              (id, user_id, user_email, action, previous_status, new_status,
               actor_id, actor_name, actor_email, remarks, created_at)
              VALUES ($1, $2, $3, $4, 'New', $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
            [eventId, saved.id, saved.userEmail, newStatus, actorId, actorName, actorEmail, normalizedRemarks]
          );
          const accountType = normalizeClientType(current.roleName) === 'Seller'
            ? 'Vendor'
            : 'Buyer';
          const notificationPayload = {
            registrationId: saved.id,
            recipientEmail: saved.userEmail,
            recipientName: saved.userName || saved.userEmail,
            accountType,
            decision: newStatus.toLowerCase(),
          };
          const notificationResult = await client.query(
            `INSERT INTO event_outbox (id, event_type, raw)
              VALUES ($1, $2, $3)
              RETURNING id`,
            [notificationOutboxId, EVENT_OUTBOX_TYPES.REGISTRATION_DECISION_EMAIL, JSON.stringify(notificationPayload)]
          );
          if (!notificationResult.rows[0]) {
            throw new Error('Registration status changed without a durable decision notification.');
          }
          return { ...saved, companyName: current.companyName, roleName: current.roleName };
        });
      }

      if (!updatedRow) {
        const current = await findRegistrationInDatabase(id);
        if (!current) return null;
        throw registrationConflict();
      }

      const updated = normalizeClientRow(updatedRow);
      syncBuyerAccountCache(id, updated.userEmail, newStatus, isApproved, verificationStatus);
      logger.audit(`Client registration ${newStatus.toLowerCase()}`, actorEmail || actorId || actorName, {
        registrationId: id,
        actorId,
        eventId,
      });
      logger.info('Registration decision notification was persisted with the registration event', {
        registrationId: id,
        eventId,
        outboxId: notificationOutboxId,
        accountType: updated.clientType === 'Seller' ? 'Vendor' : 'Buyer',
        decision: newStatus.toLowerCase(),
      }, 'REGISTRATION_QUERIES');
      return { ...updated, remarks: normalizedRemarks };
    } catch (err) {
      if (err?.code === 'REGISTRATION_ALREADY_PROCESSED') throw err;
      throw createPersistenceError(err, 'update-registration-status', id, normAction);
    }
  }

  throw storageUnavailable('update-registration-status');
}

function syncBuyerAccountCache(id, email, status, isApproved, verificationStatus) {
  try {
    const storeService = require('../services/storeService');
    const matchingBuyer = (storeService.buyerAccounts || []).find((buyer) => (
      buyer.id === id || String(buyer.corporateEmail || '').toLowerCase() === String(email || '').toLowerCase()
    ));
    if (matchingBuyer) {
      matchingBuyer.status = status === 'Accepted' ? 'ACTIVE_VERIFIED' : 'REJECTED';
      matchingBuyer.profileVerified = isApproved;
      matchingBuyer.verificationStatus = verificationStatus;
    }
  } catch (error) {
    logger.warn('Could not synchronize the registration decision to the process-local buyer cache', {
      error,
      operation: 'sync-registration-cache',
      registrationId: id,
    }, 'REGISTRATION_QUERIES');
  }
}

module.exports = {
  normalizeClientType,
  getRegisteredClients,
  updateClientRegistrationStatus,
};
