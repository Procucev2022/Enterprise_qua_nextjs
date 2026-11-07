const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { validatePayload } = require('../config/validationSchemas');

function getAuditLogs(req, res, next) {
  try {
    const rawLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const limit = (Number.isInteger(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 500) : 100;
    logger.info('Fetching cryptographic audit trail', { query: req.query, limit }, 'AUDIT_CONTROLLER');
    const logs = storeService.getAuditLogs(limit);
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: logs });
  } catch (err) {
    logger.error('Error fetching audit logs', err, 'AUDIT_CONTROLLER');
    next(err);
  }
}

async function createAuditLog(req, res, next) {
  try {
    if (!req.user || !req.user.email) {
      return res.status(401).json({ success: false, error: 'An authenticated user identity is required to create an audit event.' });
    }

    const { isValid, errors, sanitizedData } = validatePayload('auditLogEntry', req.body || {});
    if (!isValid) {
      logger.warn('Rejected invalid audit event payload', {
        fields: Object.keys(errors),
        role: req.user.role,
        requestId: req.id || req.requestId || null,
      }, 'AUDIT_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const entry = await storeService.addAuditLogDurably({
      userEmail: req.user.email,
      action: sanitizedData.action,
      rfqNumber: sanitizedData.rfqNumber || null,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    logger.error('Error creating audit log entry', err, 'AUDIT_CONTROLLER');
    next(err);
  }
}

async function verifyIntegrity(req, res, next) {
  try {
    logger.info('Running persisted SHA-256 audit-chain verification', {}, 'AUDIT_CONTROLLER');
    const report = await storeService.verifyAuditIntegrityDurably();
    res.json({ success: true, report });
  } catch (err) {
    logger.error('Error verifying audit trail integrity', err, 'AUDIT_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getAuditLogs,
  createAuditLog,
  verifyIntegrity,
};
