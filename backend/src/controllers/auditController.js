const storeService = require('../services/storeService');

function getAuditLogs(req, res, next) {
  try {
    const logs = storeService.getAuditLogs();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: logs });
  } catch (err) {
    next(err);
  }
}

function createAuditLog(req, res, next) {
  try {
    const { userEmail, action, rfqNumber, ipAddress } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: 'action description is required.' });
    }
    const entry = storeService.addAuditLog({ userEmail, action, rfqNumber, ipAddress });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

function verifyIntegrity(req, res, next) {
  try {
    const report = storeService.verifyAuditIntegrity();
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAuditLogs,
  createAuditLog,
  verifyIntegrity,
};
