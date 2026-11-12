// ==============================================================================
// USER LOGIN LOGS QUERIES (process memory)
// ==============================================================================
// Session telemetry for buyer and vendor logins. The user_login_logs table was
// dropped by migration 0029, so entries are kept in this process only. They are not
// persisted, they do not survive a restart, and each server instance holds its own.
// Each entry contains only values supplied by the request or the session. A value
// that is not known is null.
// ==============================================================================

const crypto = require('crypto');
const { logger } = require('../services/loggerService');

const LOGIN_LOG_ERRORS = Object.freeze({
  EMAIL_REQUIRED: 'An email address is required to record a login event.',
});

function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

function safeIsoDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Only the two supported account types are classified. Any other role is null. */
function normalizeUserType(value) {
  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'vendor') return 'vendor';
  if (normalized === 'buyer') return 'buyer';
  return null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id != null ? String(row.id) : null,
    userId: row.user_id || row.userId || null,
    userName: row.user_name || row.userName || null,
    email: row.email || null,
    phoneNumber: row.phone_number || row.phoneNumber || null,
    companyName: row.company_name || row.companyName || null,
    userType: normalizeUserType(row.user_type || row.userType),
    loginAt: safeIsoDate(row.login_at ?? row.loginAt),
    logoutAt: safeIsoDate(row.logout_at ?? row.logoutAt),
    durationSeconds: toNumberOrNull(row.duration_seconds ?? row.durationSeconds),
    status: row.status || null,
    ipAddress: row.ip_address || row.ipAddress || null,
    deviceInfo: row.device_info || row.deviceInfo || null,
    location: row.location || null,
    userAgent: row.user_agent || row.userAgent || null,
    createdAt: safeIsoDate(row.created_at ?? row.createdAt),
    updatedAt: safeIsoDate(row.updated_at ?? row.updatedAt),
  };
}

// Process-memory store. Starts empty: no seeded or sample sessions.
const inMemoryLogs = new Map();

/**
 * List login logs with optional filters for role, status, date range, search, and pagination.
 */
async function listLoginLogs(options = {}) {
  const { userType, status, search, startDate, endDate, dateRangePreset, page = 1, limit = 50 } = options;

  let items = Array.from(inMemoryLogs.values());

  if (userType && userType !== 'all') {
    items = items.filter((l) => l.userType === userType.toLowerCase());
  }
  if (status && status !== 'all') {
    items = items.filter((l) => l.status === status);
  }
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    items = items.filter(
      (l) =>
        String(l.userName || '').toLowerCase().includes(q) ||
        String(l.email || '').toLowerCase().includes(q) ||
        String(l.companyName || '').toLowerCase().includes(q) ||
        String(l.phoneNumber || '').includes(q)
    );
  }

  const now = Date.now();
  if (dateRangePreset === 'today') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    items = items.filter((l) => new Date(l.loginAt).getTime() >= startOfToday.getTime());
  } else if (dateRangePreset === 'yesterday') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3600 * 1000);
    items = items.filter((l) => {
      const t = new Date(l.loginAt).getTime();
      return t >= startOfYesterday.getTime() && t < startOfToday.getTime();
    });
  } else if (dateRangePreset === 'last7') {
    items = items.filter((l) => new Date(l.loginAt).getTime() >= now - 7 * 24 * 3600 * 1000);
  } else if (dateRangePreset === 'last30') {
    items = items.filter((l) => new Date(l.loginAt).getTime() >= now - 30 * 24 * 3600 * 1000);
  } else {
    const validStart = safeIsoDate(startDate);
    if (validStart) {
      const startTime = new Date(validStart).getTime();
      items = items.filter((l) => new Date(l.loginAt).getTime() >= startTime);
    }
  }

  items.sort((a, b) => new Date(b.loginAt).getTime() - new Date(a.loginAt).getTime());

  const total = items.length;
  const numPage = Math.max(1, Number(page));
  const numLimit = Math.max(1, Number(limit));
  const paged = items.slice((numPage - 1) * numLimit, numPage * numLimit);

  return {
    logs: paged,
    total,
    page: numPage,
    totalPages: Math.ceil(total / numLimit) || 1,
  };
}

/**
 * Returns summary KPI metrics for the real-time login logs dashboard.
 * todayPeakHour is the hour of day (HH:00) with the most logins today, or null when
 * there are no logins today.
 */
async function getLoginLogsSummary() {
  const items = Array.from(inMemoryLogs.values());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  let totalToday = 0;
  let activeNow = 0;
  let buyerLogins = 0;
  let sellerLogins = 0;
  let totalDurationSec = 0;
  let durationCount = 0;
  const loginsByHour = new Map();

  items.forEach((item) => {
    const loginDate = new Date(item.loginAt);
    if (loginDate.getTime() >= startOfTodayMs) {
      totalToday++;
      const hour = loginDate.getHours();
      loginsByHour.set(hour, (loginsByHour.get(hour) || 0) + 1);
    }
    if (item.status === 'ACTIVE') {
      activeNow++;
    }
    if (item.userType === 'buyer') {
      buyerLogins++;
    }
    if (item.userType === 'vendor') {
      sellerLogins++;
    }
    if (item.durationSeconds && item.durationSeconds > 0) {
      totalDurationSec += item.durationSeconds;
      durationCount++;
    }
  });

  let peakHour = null;
  let peakCount = 0;
  loginsByHour.forEach((count, hour) => {
    if (count > peakCount || (count === peakCount && hour < peakHour)) {
      peakHour = hour;
      peakCount = count;
    }
  });

  return {
    totalToday,
    activeNow,
    buyerLogins,
    sellerLogins,
    avgDurationMinutes: durationCount > 0 ? Math.round(totalDurationSec / durationCount / 60) : null,
    todayPeakHour: peakHour === null ? null : `${String(peakHour).padStart(2, '0')}:00`,
  };
}

/**
 * Record a login event. Identity, network, and device values come from the caller's
 * session and request. Values the caller does not supply are null.
 */
async function recordLoginLog(data = {}) {
  const email = String(data.email || '').toLowerCase().trim();
  if (!email) {
    const error = new Error(LOGIN_LOG_ERRORS.EMAIL_REQUIRED);
    error.code = 'VALIDATION_FAILED';
    error.statusCode = 400;
    throw error;
  }

  const id = `log_sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const entry = {
    id,
    userId: data.userId || null,
    userName: data.userName || data.name || null,
    email,
    phoneNumber: data.phoneNumber || data.mobile || data.phone || null,
    companyName: data.companyName || data.company || null,
    userType: normalizeUserType(data.userType || data.role),
    loginAt: now,
    logoutAt: null,
    durationSeconds: 0,
    status: 'ACTIVE',
    ipAddress: data.ipAddress || null,
    deviceInfo: data.deviceInfo || null,
    location: data.location || null,
    userAgent: data.userAgent || null,
    createdAt: now,
    updatedAt: now,
  };

  inMemoryLogs.set(id, entry);

  logger.info(
    `Recorded login event for ${entry.email} (${entry.userType || 'unclassified'})`,
    { id: entry.id, email: entry.email, userType: entry.userType, ipAddress: entry.ipAddress },
    'AUTH_LOGIN'
  );

  return entry;
}

/**
 * Record a logout event and calculate session duration.
 */
async function recordLogoutLog({ email, userUuid, logoutReason }) {
  const normEmail = (email || '').toLowerCase().trim();
  const now = new Date();
  const nowIso = now.toISOString();

  // Find active entry for this user
  for (const [id, entry] of inMemoryLogs.entries()) {
    if ((entry.email === normEmail || (userUuid && entry.userId === userUuid)) && entry.status === 'ACTIVE') {
      const loginTime = new Date(entry.loginAt).getTime();
      const durationSeconds = Math.max(0, Math.round((now.getTime() - loginTime) / 1000));
      entry.logoutAt = nowIso;
      entry.durationSeconds = durationSeconds;
      entry.status = logoutReason === 'TIMEOUT' ? 'TIMED_OUT' : 'LOGGED_OUT';
      entry.updatedAt = nowIso;
      inMemoryLogs.set(id, entry);

      logger.info(
        `Recorded logout event for ${entry.email} (session duration: ${durationSeconds}s, reason: ${entry.status})`,
        { id: entry.id, email: entry.email, durationSeconds, status: entry.status },
        'AUTH_LOGOUT'
      );
      return entry;
    }
  }

  return null;
}

module.exports = {
  listLoginLogs,
  getLoginLogsSummary,
  recordLoginLog,
  recordLogoutLog,
  escapeLikeWildcards,
  safeIsoDate,
  mapRow,
  inMemoryLogs,
};
