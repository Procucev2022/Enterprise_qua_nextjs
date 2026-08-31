const { logger } = require('../services/loggerService');
const { logErrorResolver } = require('../services/logErrorResolver');
const { performanceOptimizer } = require('../services/performanceOptimizer');

function getLogs(req, res, next) {
  try {
    const q = req.query || {};
    const result = logger.queryLogs({
      level: q.level,
      category: q.category,
      search: q.search,
      from: q.from,
      to: q.to,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
      offset: q.offset ? parseInt(q.offset, 10) : 0,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

function createLog(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.message) {
      return res.status(400).json({ success: false, error: 'message is required for log entry.' });
    }

    const level = (body.level || 'INFO').toUpperCase();
    const logEntry = logger.log(level, body.message, body.metadata || {}, body.category || 'FRONTEND');
    res.status(201).json({ success: true, data: logEntry });
  } catch (err) {
    next(err);
  }
}

function purgeLogs(req, res, next) {
  try {
    const body = req.body || {};
    const report = logger.purgeExpiredLogs(body);
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

function diagnoseLogErrors(req, res, next) {
  try {
    const issues = logErrorResolver.diagnoseErrors();
    const history = logErrorResolver.getRemediationHistory();
    res.json({ success: true, count: issues.length, issues, history });
  } catch (err) {
    next(err);
  }
}

async function autoResolveLogErrors(req, res, next) {
  try {
    const body = req.body || {};
    if (body.action) {
      const result = await logErrorResolver.executeRemediation(body.action);
      return res.json({ success: true, remediation: result });
    }
    const report = await logErrorResolver.autoResolveAll();
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
}

function getPerformanceAudit(req, res, next) {
  try {
    const audit = performanceOptimizer.auditPerformance();
    const history = performanceOptimizer.getOptimizationHistory();
    res.json({ success: true, audit, history });
  } catch (err) {
    next(err);
  }
}

function optimizePerformance(req, res, next) {
  try {
    const body = req.body || {};
    const result = performanceOptimizer.optimizePerformance(body.level || 'standard');
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLogs,
  createLog,
  purgeLogs,
  getLogStats,
  diagnoseLogErrors,
  autoResolveLogErrors,
  getPerformanceAudit,
  optimizePerformance,
};
