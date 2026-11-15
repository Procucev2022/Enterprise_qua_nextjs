const { logger } = require('./loggerService');
const pool = require('../db/pool');
const vendorPresenceQueries = require('../db/vendorPresenceQueries');
const {
  PRESENCE_ONLINE_THRESHOLD_MS,
  PRESENCE_MIN_WRITE_INTERVAL_MS,
  VENDOR_PRESENCE_MAX_IDENTIFIERS,
  VENDOR_PRESENCE_VENDOR_ID_MAX_LENGTH,
} = require('../config/constants');

/**
 * In-memory vendor presence store.
 * Stores { identifier: string, lastActive: number, role?: string, vendorId?: string, status: 'online' | 'offline' }
 */
const presenceStore = new Map();

/**
 * Normalizes identifier string for consistent lookups.
 * @param {string} id
 * @returns {string}
 */
function normalizeIdentifier(id) {
  if (!id || typeof id !== 'string') return '';
  return id.trim().toLowerCase();
}

/**
 * Records or updates a vendor's heartbeat/activity.
 * @param {Object} options
 * @param {string} options.identifier - Vendor email, id, or username
 * @param {string} [options.role] - User role
 * @param {string} [options.vendorId] - Associated vendor ID
 * @param {'online'|'offline'} [options.status='online'] - Presence status
 * @param {number} [options.timestamp=Date.now()] - Activity timestamp
 * @returns {Object}
 */
function recordHeartbeat({ identifier, role = 'vendor', vendorId, status = 'online', timestamp = Date.now() }) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) {
    logger.warn('recordHeartbeat called without a valid identifier', {}, 'VENDOR_PRESENCE');
    return { success: false, error: 'Identifier is required.' };
  }

  const entry = {
    identifier: norm,
    role,
    vendorId: vendorId || norm,
    status: status === 'offline' ? 'offline' : 'online',
    lastActive: Number(timestamp) || Date.now(),
  };

  presenceStore.set(norm, entry);
  logger.info(
    'Vendor presence heartbeat recorded',
    { status: entry.status, lastActive: entry.lastActive, persistence: 'memory' },
    'VENDOR_PRESENCE'
  );

  return {
    success: true,
    identifier: norm,
    isOnline: entry.status === 'online',
    lastActive: new Date(entry.lastActive).toISOString(),
  };
}

/**
 * Checks if a specific vendor is online.
 * @param {string} identifier
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
function isVendorOnline(identifier, now = Date.now()) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) return false;

  const entry = presenceStore.get(norm);
  if (!entry) return false;

  if (entry.status === 'offline') return false;

  const elapsed = now - entry.lastActive;
  return elapsed >= 0 && elapsed <= PRESENCE_ONLINE_THRESHOLD_MS;
}

/**
 * Gets presence state for given identifiers or all online vendors.
 * @param {string[]|string} [identifiers]
 * @param {number} [now=Date.now()]
 * @returns {Object}
 */
function getPresence(identifiers, now = Date.now()) {
  let targetList = [];

  if (Array.isArray(identifiers)) {
    targetList = identifiers;
  } else if (typeof identifiers === 'string' && identifiers.trim()) {
    targetList = identifiers.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const onlineVendors = [];
  const details = {};

  if (targetList.length > 0) {
    for (const rawId of targetList) {
      const norm = normalizeIdentifier(rawId);
      if (!norm) continue;

      const online = isVendorOnline(norm, now);
      if (online) {
        onlineVendors.push(norm);
      }

      const existing = presenceStore.get(norm);
      details[norm] = {
        isOnline: online,
        lastActive: existing ? new Date(existing.lastActive).toISOString() : undefined,
      };
    }
  } else {
    for (const [norm, entry] of presenceStore.entries()) {
      const online = isVendorOnline(norm, now);
      if (online) {
        onlineVendors.push(norm);
      }
      details[norm] = {
        isOnline: online,
        lastActive: new Date(entry.lastActive).toISOString(),
      };
    }
  }

  return {
    success: true,
    thresholdMinutes: Math.round(PRESENCE_ONLINE_THRESHOLD_MS / (60 * 1000)),
    onlineVendors,
    details,
  };
}

function normalizeTargets(identifiers) {
  const values = Array.isArray(identifiers)
    ? identifiers
    : typeof identifiers === 'string' && identifiers.trim()
      ? identifiers.split(',')
      : [];
  return [...new Set(values.map(normalizeIdentifier).filter(Boolean))]
    .slice(0, VENDOR_PRESENCE_MAX_IDENTIFIERS);
}

function isOnlineRow(row, now) {
  if (row.status !== 'online') return false;
  const lastActive = Number(row.last_active_at);
  const elapsed = now - lastActive;
  return Number.isFinite(lastActive) && elapsed >= 0 && elapsed <= PRESENCE_ONLINE_THRESHOLD_MS;
}

function mapPersistedPresence(rows, requested, now) {
  const aliases = new Map();
  for (const row of rows) {
    const entry = {
      identifier: normalizeIdentifier(row.identifier),
      vendorId: normalizeIdentifier(row.vendor_id),
      status: row.status,
      lastActive: Number(row.last_active_at),
    };
    aliases.set(entry.identifier, entry);
    if (entry.vendorId) aliases.set(entry.vendorId, entry);
  }

  const onlineVendors = [];
  const details = {};
  const targetList = requested.length > 0 ? requested : [...aliases.keys()];
  for (const identifier of targetList) {
    const entry = aliases.get(identifier);
    const isOnline = Boolean(entry && isOnlineRow({ status: entry.status, last_active_at: entry.lastActive }, now));
    if (isOnline) onlineVendors.push(identifier);
    details[identifier] = {
      isOnline,
      lastActive: entry && Number.isFinite(entry.lastActive) ? new Date(entry.lastActive).toISOString() : undefined,
    };
  }

  return {
    success: true,
    thresholdMinutes: Math.round(PRESENCE_ONLINE_THRESHOLD_MS / (60 * 1000)),
    onlineVendors,
    details,
  };
}

function persistenceUnavailable(operation, cause) {
  const error = new Error(`Vendor presence ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.statusCode = 503;
  error.cause = cause;
  logger.error('Vendor presence persistence failed; refusing isolate-local fallback', {
    operation,
    error: cause,
  }, 'VENDOR_PRESENCE');
  return error;
}

async function recordHeartbeatDurably(options = {}) {
  if (!pool.hasStorage()) return recordHeartbeat(options);

  const identifier = normalizeIdentifier(options.identifier);
  if (!identifier) return recordHeartbeat(options);
  const timestamp = Number(options.timestamp) || Date.now();
  const status = options.status === 'offline' ? 'offline' : 'online';
  const requestedVendorId = normalizeIdentifier(options.vendorId);
  const vendorId = requestedVendorId && requestedVendorId !== identifier &&
    requestedVendorId.length <= VENDOR_PRESENCE_VENDOR_ID_MAX_LENGTH
    ? requestedVendorId
    : null;

  try {
    const row = await vendorPresenceQueries.upsertVendorPresence({
      identifier,
      vendorId,
      status,
      timestamp,
      writeCutoff: timestamp - PRESENCE_MIN_WRITE_INTERVAL_MS,
    });
    if (!row) throw new Error('Presence upsert completed without a persisted row.');
    const lastActive = Number(row.last_active_at);
    logger.info('Vendor presence heartbeat persisted', {
      status: row.status,
      lastActive,
      vendorIdPresent: Boolean(row.vendor_id),
      persistence: 'database',
    }, 'VENDOR_PRESENCE');
    return {
      success: true,
      identifier,
      isOnline: isOnlineRow(row, timestamp),
      lastActive: new Date(lastActive).toISOString(),
    };
  } catch (error) {
    throw persistenceUnavailable('heartbeat write', error);
  }
}

async function getPresenceDurably(identifiers, now = Date.now()) {
  if (!pool.hasStorage()) return getPresence(identifiers, now);

  const requested = normalizeTargets(identifiers);
  try {
    const rows = requested.length > 0
      ? await vendorPresenceQueries.getVendorPresenceByIdentifiers(requested)
      : await vendorPresenceQueries.getRecentOnlineVendorPresence({
        cutoff: now - PRESENCE_ONLINE_THRESHOLD_MS,
        limit: VENDOR_PRESENCE_MAX_IDENTIFIERS,
      });
    return mapPersistedPresence(rows, requested, now);
  } catch (error) {
    throw persistenceUnavailable('lookup', error);
  }
}

/**
 * Clears or marks a vendor as offline.
 * @param {string} identifier
 */
function clearPresence(identifier) {
  const norm = normalizeIdentifier(identifier);
  if (!norm) return false;
  return presenceStore.delete(norm);
}

/**
 * Clears all presence records (used in test tearDown).
 */
function resetAll() {
  presenceStore.clear();
}

/**
 * Sweeps expired offline entries older than 24 hours.
 * @param {number} [now=Date.now()]
 */
function sweepExpired(now = Date.now()) {
  const maxAge = 24 * 60 * 60 * 1000;
  for (const [norm, entry] of presenceStore.entries()) {
    if (now - entry.lastActive > maxAge) {
      presenceStore.delete(norm);
    }
  }
}

module.exports = {
  recordHeartbeat,
  recordHeartbeatDurably,
  isVendorOnline,
  getPresence,
  getPresenceDurably,
  clearPresence,
  resetAll,
  sweepExpired,
};
