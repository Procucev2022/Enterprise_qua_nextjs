const crypto = require('crypto');
const { SYSTEM_ACTOR_EMAIL } = require('../config/constants');

const UNKNOWN_IP_ADDRESS = 'unknown';

/**
 * Generate a SHA-256 cryptographic seal
 * @param {string} payload - Data string to hash
 * @returns {string} - Hex-encoded SHA-256 hash
 */
function generateShaHash(payload = '') {
  const content = payload || crypto.randomUUID();
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Create a new cryptographic audit entry
 * @param {object} params
 * @param {string} params.userEmail
 * @param {string} params.action
 * @param {string} [params.rfqNumber]
 * @param {string} [params.ipAddress]
 * @param {string} [params.previousHash]
 * @returns {object} - Sealed audit log entry
 */
// Shared by createAuditEntry (to seal a new entry) and verifyAuditTrail (to
// recompute and check one) — both must derive the hash from exactly the same
// fields, in the same order, or "verification" is meaningless.
function buildSignaturePayload({ id, timestamp, userEmail, action, rfqNumber, previousHash }) {
  return `${id}|${timestamp}|${userEmail}|${action}|${rfqNumber || ''}|${previousHash || ''}`;
}

function sealAuditEntry(entry, previousHash = '') {
  const sealedEntry = { ...entry, previousHash: previousHash || '' };
  sealedEntry.shaSignature = generateShaHash(buildSignaturePayload(sealedEntry));
  return sealedEntry;
}

function createAuditEntry({ userEmail, action, rfqNumber = null, ipAddress = UNKNOWN_IP_ADDRESS, previousHash = '' }) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const id = `log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  // An entry with no signed-in actor is attributed to the documented system actor.
  const resolvedUserEmail = userEmail || SYSTEM_ACTOR_EMAIL;
  return sealAuditEntry({
    id,
    timestamp,
    userEmail: resolvedUserEmail,
    action,
    rfqNumber,
    status: 'TAMPER_CHECK_OK',
    ipAddress: ipAddress || UNKNOWN_IP_ADDRESS,
  }, previousHash);
}

/**
 * Verify integrity of an audit trail by actually recomputing each entry's
 * hash from its own fields and checking the previousHash chain linkage —
 * previously this only checked `shaSignature.length === 64`, which any
 * 64-character string satisfies regardless of whether it's the real hash or
 * the chain has been tampered with/reordered.
 * @param {Array} auditLogs - Array of audit log entries, newest-first (as
 *   stored by storeService.addAuditLog's `unshift`)
 * @returns {object} - Verification report
 */
function verifyAuditTrail(auditLogs = [], anchors = {}) {
  const logs = Array.isArray(auditLogs) ? auditLogs : [];
  const compromisedEntries = [];
  logs.forEach((rawEntry, idx) => {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const requiredStringFields = ['id', 'timestamp', 'userEmail', 'action'];
    if (requiredStringFields.some((field) => typeof entry[field] !== 'string')) {
      compromisedEntries.push({ id: typeof entry.id === 'string' ? entry.id : null, index: idx, reason: 'Audit entry is missing required signed fields' });
      return;
    }
    if (typeof entry.shaSignature !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.shaSignature)) {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'Invalid or missing SHA-256 hash' });
      return;
    }

    // Recompute: does the stored hash actually match this entry's content?
    // A valid chain must persist its link, including the empty genesis link.
    // Missing links cannot be treated as verified because neither content nor
    // adjacency can then be independently checked.
    if (typeof entry.previousHash !== 'string') {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'Missing previousHash link; entry cannot be verified' });
      return;
    }

    const recomputed = generateShaHash(buildSignaturePayload(entry));
    if (recomputed !== entry.shaSignature) {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'Hash does not match entry content (tampered or forged)' });
      return;
    }

    // Chain linkage: this entry's previousHash must equal the next (older)
    // entry's own hash, since addAuditLog seals each entry with the hash of
    // whatever was most recent at the time it was written.
    const olderEntry = logs[idx + 1];
    if (olderEntry && entry.previousHash !== olderEntry.shaSignature) {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'previousHash does not match the prior entry (chain broken)' });
    }
  });

  const newestHash = logs[0]?.shaSignature || '';
  const oldestHash = logs[logs.length - 1]?.shaSignature || '';
  if (anchors.expectedHeadHash !== undefined && newestHash !== anchors.expectedHeadHash) {
    compromisedEntries.push({
      id: logs[0]?.id || null,
      index: 0,
      reason: 'Newest audit entry does not match the persisted chain head',
    });
  }
  if (anchors.expectedRootHash !== undefined && oldestHash !== anchors.expectedRootHash) {
    compromisedEntries.push({
      id: logs[logs.length - 1]?.id || null,
      index: Math.max(logs.length - 1, 0),
      reason: 'Oldest audit entry does not match the persisted chain root',
    });
  }
  if (anchors.expectedEntryCount !== undefined && logs.length !== Number(anchors.expectedEntryCount)) {
    compromisedEntries.push({
      id: null,
      index: logs.length,
      reason: 'Persisted audit entry count does not match the verified records',
    });
  }

  return {
    valid: compromisedEntries.length === 0,
    verifiedCount: logs.length,
    compromisedEntries,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  generateShaHash,
  sealAuditEntry,
  createAuditEntry,
  verifyAuditTrail,
};
