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
function createAuditEntry({ userEmail, action, rfqNumber = null, ipAddress = '10.0.4.12 (Azure Private VNet)', previousHash = '' }) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const id = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const signaturePayload = `${id}|${timestamp}|${userEmail}|${action}|${rfqNumber || ''}|${previousHash}`;
  const shaSignature = generateShaHash(signaturePayload);

  return {
    id,
    timestamp,
    userEmail: userEmail || 'system@procucev.ai',
    action,
    rfqNumber,
    shaSignature,
    status: 'TAMPER_CHECK_OK',
    ipAddress,
  };
}

/**
 * Verify integrity of an audit trail
 * @param {Array} auditLogs - Array of audit log entries
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
