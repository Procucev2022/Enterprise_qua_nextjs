const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getAuditLogs(req, res, next) {
  try {
    logger.info('Fetching cryptographic audit trail', { query: req.query }, 'AUDIT_CONTROLLER');
    const logs = storeService.getAuditLogs();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: logs });
  } catch (err) {
    logger.error('Error fetching audit logs', err, 'AUDIT_CONTROLLER');
    next(err);
  }
}

function createAuditLog(req, res, next) {
  try {
    const { userEmail, action, rfqNumber, ipAddress } = req.body;
    if (!action) {
      logger.warn('Failed to create audit log: Missing action description', { body: req.body }, 'AUDIT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'action description is required.' });
    }
    logger.audit(action, userEmail || 'system@procucev.ai', { rfqNumber, ipAddress }, rfqNumber);
    const entry = storeService.addAuditLog({ userEmail, action, rfqNumber, ipAddress });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    logger.error('Error creating audit log entry', err, 'AUDIT_CONTROLLER');
    next(err);
  }
}

function verifyIntegrity(req, res, next) {
  try {
    logger.info('Running SHA-256 cryptographic audit verification check', {}, 'AUDIT_CONTROLLER');
    const report = storeService.verifyAuditIntegrity();
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
