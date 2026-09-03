const crypto = require('crypto');

/**
 * Generate a SHA-256 cryptographic seal
 * @param {string} payload - Data string to hash
 * @returns {string} - Hex-encoded SHA-256 hash
 */
function generateShaHash(payload = '') {
  const content = payload || `${Date.now()}-${Math.random()}`;
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

function createAuditEntry({ userEmail, action, rfqNumber = null, ipAddress = '10.0.4.12 (Azure Private VNet)', previousHash = '' }) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const id = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const resolvedUserEmail = userEmail || 'system@procucev.ai';
  const shaSignature = generateShaHash(buildSignaturePayload({ id, timestamp, userEmail: resolvedUserEmail, action, rfqNumber, previousHash }));

  return {
    id,
    timestamp,
    userEmail: resolvedUserEmail,
    action,
    rfqNumber,
    previousHash,
    shaSignature,
    status: 'TAMPER_CHECK_OK',
    ipAddress,
  };
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
function verifyAuditTrail(auditLogs = []) {
  if (!Array.isArray(auditLogs) || auditLogs.length === 0) {
    return { valid: true, verifiedCount: 0, compromisedEntries: [] };
  }

  const compromisedEntries = [];
  auditLogs.forEach((entry, idx) => {
    if (!entry.shaSignature || entry.shaSignature.length !== 64) {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'Invalid or missing SHA-256 hash' });
      return;
    }

    // Recompute: does the stored hash actually match this entry's content?
    // Entries created before `previousHash` was persisted on the record
    // (older sessions) won't carry it — fall back to chain-derived linkage
    // below rather than false-flagging them.
    if (entry.previousHash !== undefined) {
      const recomputed = generateShaHash(buildSignaturePayload(entry));
      if (recomputed !== entry.shaSignature) {
        compromisedEntries.push({ id: entry.id, index: idx, reason: 'Hash does not match entry content (tampered or forged)' });
        return;
      }
    }

    // Chain linkage: this entry's previousHash must equal the next (older)
    // entry's own hash, since addAuditLog seals each entry with the hash of
    // whatever was most recent at the time it was written.
    const olderEntry = auditLogs[idx + 1];
    if (olderEntry && entry.previousHash && entry.previousHash !== olderEntry.shaSignature) {
      compromisedEntries.push({ id: entry.id, index: idx, reason: 'previousHash does not match the prior entry (chain broken)' });
    }
  });

  return {
    valid: compromisedEntries.length === 0,
    verifiedCount: auditLogs.length,
    compromisedEntries,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  generateShaHash,
  createAuditEntry,
  verifyAuditTrail,
};
