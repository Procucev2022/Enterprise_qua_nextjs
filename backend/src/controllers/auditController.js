const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

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
  verifyIntegrity,
};
