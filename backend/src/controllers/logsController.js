const { logger } = require('../services/loggerService');

function getLogs(req, res, next) {
  try {
    const { level, category, search, from, to, limit, offset } = req.query;
    const result = logger.queryLogs({
      level,
      category,
      search,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

function createLog(req, res, next) {
  try {
    const { level = 'INFO', message, metadata = {}, category = 'FRONTEND' } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'message is required for log entry.' });
    }

    const logEntry = logger.log(level.toUpperCase(), message, metadata, category);
    res.status(201).json({ success: true, data: logEntry });
  } catch (err) {
    next(err);
  }
}

function purgeLogs(req, res, next) {
  try {
    const { maxAgeDays, maxSizeBytes } = req.body || {};
    const report = logger.purgeExpiredLogs({ maxAgeDays, maxSizeBytes });
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
}

function getLogStats(req, res, next) {
  try {
    const stats = logger.getLogStats();
    res.json({ success: true, stats });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLogs,
  createLog,
  purgeLogs,
  getLogStats,
};
