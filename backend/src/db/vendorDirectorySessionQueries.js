// ==============================================================================
// VENDOR DIRECTORY SESSION QUERIES (PostgreSQL / Cloudflare D1 / Memory Fallback)
// ==============================================================================
// Durable persistence and audit history for Category Manager directory sessions.
// Enforces single-session lifecycles, 5-minute inactivity tracking, and durable
// duration / logout auditing.
// ==============================================================================

const crypto = require('crypto');
const pool = require('./pool');
const {
  VENDOR_DIRECTORY_SESSION_STATUS,
  VENDOR_DIRECTORY_LOGOUT_REASONS,
  VENDOR_DIRECTORY_AUTH_CONFIG,
} = require('../config/constants');

// In-memory fallback map for development/offline/testing without active DB connection
const memoryDirectorySessions = new Map();

function logWarn(msg, err) {
  console.warn(`[VDIR_SESSION] ${msg}:`, err ? err.message : '');
}

/**
 * Format a Date or timestamp to ISO string, with safe fallback.
 */
function toIsoString(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString();
  }
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  const str = String(val).trim();
  if (/^\d{11,14}$/.test(str)) {
    return new Date(Number(str)).toISOString();
  }
  const isoCandidate = str.includes(' ') && !str.includes('Z') ? str.replace(' ', 'T') + 'Z' : str;
  const date = new Date(isoCandidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Map raw database row (snake_case) to application session object (camelCase).
 */
function mapRowToSession(row) {
  if (!row) return null;
  const loginAt = toIsoString(row.login_at);
  const lastActivityAt = toIsoString(row.last_activity_at) || loginAt;
  const logoutAt = toIsoString(row.logout_at);

  let durationSeconds = Number(row.duration_seconds || 0);
  if (durationSeconds <= 0 && loginAt && logoutAt) {
    const startMs = new Date(loginAt).getTime();
    const endMs = new Date(logoutAt).getTime();
    if (endMs > startMs) {
      durationSeconds = Math.round((endMs - startMs) / 1000);
    }
  }

  return {
    id: String(row.id),
    userUuid: String(row.user_uuid),
    email: String(row.email).toLowerCase().trim(),
    role: String(row.role || VENDOR_DIRECTORY_AUTH_CONFIG.REQUIRED_ROLE),
    authMethod: String(row.auth_method || 'EMAIL_OTP'),
    loginAt,
    lastActivityAt,
    logoutAt,
    durationSeconds,
    logoutReason: row.logout_reason || null,
    status: row.status || VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
    ipAddress: row.ip_address || null,
    userAgent: row.user_agent || null,
    createdAt: toIsoString(row.created_at) || loginAt,
  };
}

/**
 * Creates a new vendor directory session record.
 */
async function createSession(params = {}) {
  const id = params.id || crypto.randomUUID();
  const userUuid = params.userUuid || params.userId || '';
  const email = String(params.email || '').toLowerCase().trim();
  const role = params.role || VENDOR_DIRECTORY_AUTH_CONFIG.REQUIRED_ROLE;
  const authMethod = params.authMethod || 'EMAIL_OTP';
  const ipAddress = params.ipAddress || null;
  const userAgent = params.userAgent || null;

  const nowIso = new Date().toISOString();

  const sessionObj = {
    id,
    userUuid,
    email,
    role,
    authMethod,
    loginAt: nowIso,
    lastActivityAt: nowIso,
    logoutAt: null,
    durationSeconds: 0,
    logoutReason: null,
    status: VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
    ipAddress,
    userAgent,
    createdAt: nowIso,
  };

  // Always keep in-memory fallback updated
  memoryDirectorySessions.set(id, { ...sessionObj });

  const query = `
    INSERT INTO vendor_directory_sessions (
      id, user_uuid, email, role, auth_method,
      login_at, last_activity_at, logout_at, duration_seconds,
      logout_reason, status, ip_address, user_agent, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 0, NULL, $8, $9, $10, $11)
  `;
  const values = [
    id,
    userUuid,
    email,
    role,
    authMethod,
    nowIso,
    nowIso,
    VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE,
    ipAddress,
    userAgent,
    nowIso,
  ];

  try {
    await pool.query(query, values, { d1: true });
  } catch (err) {
    logWarn('createSession DB write fallback to memory', err);
  }

  return { ...sessionObj };
}

/**
 * Finds a directory session by ID.
 */
async function findSessionById(id) {
  if (!id) return null;

  try {
    const rows = await pool.rows(
      'SELECT * FROM vendor_directory_sessions WHERE id = $1 LIMIT 1',
      [id],
      { d1: true }
    );
    if (rows && rows.length > 0) {
      const session = mapRowToSession(rows[0]);
      memoryDirectorySessions.set(id, { ...session });
      return session;
    }
  } catch (err) {
    logWarn('findSessionById DB read failed, using memory fallback', err);
  }

  const mem = memoryDirectorySessions.get(id);
  return mem ? { ...mem } : null;
}

/**
 * Finds an active directory session by ID.
 */
async function findActiveSession(id) {
  if (!id) return null;

  try {
    const rows = await pool.rows(
      'SELECT * FROM vendor_directory_sessions WHERE id = $1 AND status = $2 LIMIT 1',
      [id, VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE],
      { d1: true }
    );
    if (rows && rows.length > 0) {
      const session = mapRowToSession(rows[0]);
      memoryDirectorySessions.set(id, { ...session });
      return session;
    }
  } catch (err) {
    logWarn('findActiveSession DB read failed, using memory fallback', err);
  }

  const mem = memoryDirectorySessions.get(id);
  if (mem && mem.status === VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE) {
    return { ...mem };
  }
  return null;
}

/**
 * Updates last_activity_at timestamp for an active directory session.
 */
async function updateSessionActivity(id, activityTime = new Date()) {
  if (!id) return false;
  const isoActivity = toIsoString(activityTime) || new Date().toISOString();

  let updatedMem = false;
  const mem = memoryDirectorySessions.get(id);
  if (mem) {
    if (mem.status !== VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE) return false;
    mem.lastActivityAt = isoActivity;
    updatedMem = true;
  }

  try {
    const query = `
      UPDATE vendor_directory_sessions
      SET last_activity_at = $2
      WHERE id = $1 AND status = $3
    `;
    const result = await pool.query(query, [id, isoActivity, VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE], { d1: true });
    return Boolean(result?.rowCount > 0 || updatedMem);
  } catch (err) {
    logWarn('updateSessionActivity DB write failed', err);
    return updatedMem;
  }
}

/**
 * Closes an active directory session with a logout reason, calculating elapsed duration.
 */
async function closeSession(id, options = {}) {
  if (!id) return null;

  const session = await findSessionById(id);
  if (!session) return null;

  const logoutAtDate = options.logoutAt ? new Date(options.logoutAt) : new Date();
  const logoutAtIso = toIsoString(logoutAtDate) || new Date().toISOString();
  const logoutReason = options.logoutReason || VENDOR_DIRECTORY_LOGOUT_REASONS.MANUAL;

  const loginAtMs = new Date(session.loginAt).getTime();
  const logoutAtMs = logoutAtDate.getTime();
  const durationSeconds = Math.max(0, Math.round((logoutAtMs - loginAtMs) / 1000));

  const updatedSession = {
    ...session,
    logoutAt: logoutAtIso,
    durationSeconds,
    logoutReason,
    status: VENDOR_DIRECTORY_SESSION_STATUS.CLOSED,
  };

  memoryDirectorySessions.set(id, { ...updatedSession });

  try {
    const query = `
      UPDATE vendor_directory_sessions
      SET logout_at = $2,
          duration_seconds = $3,
          logout_reason = $4,
          status = $5
      WHERE id = $1
    `;
    await pool.query(
      query,
      [id, logoutAtIso, durationSeconds, logoutReason, VENDOR_DIRECTORY_SESSION_STATUS.CLOSED],
      { d1: true }
    );
  } catch (err) {
    logWarn('closeSession DB write failed', err);
  }

  return { ...updatedSession };
}

/**
 * Lists directory session history with optional filters and pagination.
 */
async function listSessionHistory(filters = {}) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;

  if (filters.email) {
    conditions.push(`LOWER(email) = LOWER($${paramIndex++})`);
    values.push(String(filters.email).trim());
  }

  if (filters.userUuid) {
    conditions.push(`user_uuid = $${paramIndex++}`);
    values.push(String(filters.userUuid).trim());
  }

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(String(filters.status).trim());
  }

  if (filters.logoutReason) {
    conditions.push(`logout_reason = $${paramIndex++}`);
    values.push(String(filters.logoutReason).trim());
  }

  if (filters.startDate) {
    conditions.push(`login_at >= $${paramIndex++}`);
    values.push(toIsoString(filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(`login_at <= $${paramIndex++}`);
    values.push(toIsoString(filters.endDate));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
  const page = Math.max(1, Number(filters.page) || 1);
  const offset = filters.offset !== undefined ? Math.max(0, Number(filters.offset)) : (page - 1) * limit;

  try {
    const countSql = `SELECT count(*) as total FROM vendor_directory_sessions ${whereClause}`;
    const countRows = await pool.rows(countSql, values, { d1: true });
    const total = Number(countRows?.[0]?.total || 0);

    const listSql = `
      SELECT * FROM vendor_directory_sessions
      ${whereClause}
      ORDER BY login_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const rows = await pool.rows(listSql, [...values, limit, offset], { d1: true });
    const sessions = (rows || []).map(mapRowToSession);

    return {
      sessions,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  } catch (err) {
    logWarn('listSessionHistory DB query failed, filtering memory store', err);

    let allSessions = Array.from(memoryDirectorySessions.values());

    if (filters.email) {
      const emailFilter = String(filters.email).toLowerCase().trim();
      allSessions = allSessions.filter((s) => s.email.toLowerCase() === emailFilter);
    }
    if (filters.userUuid) {
      allSessions = allSessions.filter((s) => s.userUuid === filters.userUuid);
    }
    if (filters.status) {
      allSessions = allSessions.filter((s) => s.status === filters.status);
    }
    if (filters.logoutReason) {
      allSessions = allSessions.filter((s) => s.logoutReason === filters.logoutReason);
    }
    if (filters.startDate) {
      const startMs = new Date(filters.startDate).getTime();
      allSessions = allSessions.filter((s) => new Date(s.loginAt).getTime() >= startMs);
    }
    if (filters.endDate) {
      const endMs = new Date(filters.endDate).getTime();
      allSessions = allSessions.filter((s) => new Date(s.loginAt).getTime() <= endMs);
    }

    allSessions.sort((a, b) => new Date(b.loginAt).getTime() - new Date(a.loginAt).getTime());
    const total = allSessions.length;
    const paginated = allSessions.slice(offset, offset + limit);

    return {
      sessions: paginated,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

/**
 * Reconciles abandoned active sessions whose last activity exceeds the inactivity threshold.
 * Closes them with logoutReason = 'INACTIVITY' and computes duration.
 */
async function reconcileAbandonedSessions(inactivityTimeoutSeconds = VENDOR_DIRECTORY_AUTH_CONFIG.INACTIVITY_TIMEOUT_SECONDS) {
  const timeoutMs = inactivityTimeoutSeconds * 1000;
  const cutoffMs = Date.now() - timeoutMs;
  const cutoffIso = new Date(cutoffMs).toISOString();

  let reconciledCount = 0;
  const reconciledIds = [];

  try {
    const staleRows = await pool.rows(
      `SELECT id, login_at, last_activity_at FROM vendor_directory_sessions
       WHERE status = $1 AND last_activity_at < $2`,
      [VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE, cutoffIso],
      { d1: true }
    );

    if (staleRows && staleRows.length > 0) {
      for (const row of staleRows) {
        const lastActMs = new Date(row.last_activity_at).getTime();
        const loginMs = new Date(row.login_at).getTime();
        const logoutAtMs = lastActMs + timeoutMs;
        const durationSeconds = Math.max(0, Math.round((logoutAtMs - loginMs) / 1000));
        const logoutAtIso = new Date(logoutAtMs).toISOString();

        await pool.query(
          `UPDATE vendor_directory_sessions
           SET status = $2,
               logout_at = $3,
               logout_reason = $4,
               duration_seconds = $5
           WHERE id = $1`,
          [
            row.id,
            VENDOR_DIRECTORY_SESSION_STATUS.CLOSED,
            logoutAtIso,
            VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY,
            durationSeconds,
          ],
          { d1: true }
        );

        reconciledCount++;
        reconciledIds.push(row.id);

        const mem = memoryDirectorySessions.get(row.id);
        if (mem) {
          mem.status = VENDOR_DIRECTORY_SESSION_STATUS.CLOSED;
          mem.logoutAt = logoutAtIso;
          mem.logoutReason = VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY;
          mem.durationSeconds = durationSeconds;
        }
      }
    }
  } catch (err) {
    logWarn('reconcileAbandonedSessions DB check failed, reconciling memory store', err);
  }

  // Reconcile in-memory store
  for (const [id, session] of memoryDirectorySessions.entries()) {
    if (session.status === VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE) {
      const lastActMs = new Date(session.lastActivityAt).getTime();
      if (lastActMs < cutoffMs) {
        const loginMs = new Date(session.loginAt).getTime();
        const logoutAtMs = lastActMs + timeoutMs;
        const durationSeconds = Math.max(0, Math.round((logoutAtMs - loginMs) / 1000));
        const logoutAtIso = new Date(logoutAtMs).toISOString();

        session.status = VENDOR_DIRECTORY_SESSION_STATUS.CLOSED;
        session.logoutAt = logoutAtIso;
        session.logoutReason = VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY;
        session.durationSeconds = durationSeconds;

        if (!reconciledIds.includes(id)) {
          reconciledCount++;
          reconciledIds.push(id);
        }
      }
    }
  }

  return {
    reconciledCount,
    reconciledIds,
  };
}

/**
 * Resets in-memory store for isolated unit testing.
 */
function clearMemoryStoreForTesting() {
  memoryDirectorySessions.clear();
}

/**
 * Returns reference to in-memory store for test verification and fixture setup.
 */
function getMemoryStoreForTesting() {
  return memoryDirectorySessions;
}

module.exports = {
  createSession,
  findSessionById,
  findActiveSession,
  updateSessionActivity,
  closeSession,
  listSessionHistory,
  reconcileAbandonedSessions,
  clearMemoryStoreForTesting,
  getMemoryStoreForTesting,
  toIsoString,
  mapRowToSession,
};
