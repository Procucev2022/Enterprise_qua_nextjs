const { logger } = require('../services/loggerService');
const { logErrorResolver } = require('../services/logErrorResolver');
const { performanceOptimizer } = require('../services/performanceOptimizer');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');

function getLogs(req, res, next) {
  try {
    const q = req.query || {};
    const parsedLimit = q.limit ? parseInt(q.limit, 10) : 100;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
    const result = logger.queryLogs({
      level: q.level,
      category: q.category,
      search: q.search,
      from: q.from,
      to: q.to,
      limit,
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
    const validation = validatePayload(VALIDATION_SCHEMAS.clientLogEntry, {
      ...body,
      ...(body.level ? { level: String(body.level).toUpperCase() } : {}),
    });
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'The log entry contains invalid fields.',
        details: validation.errors,
      });
    }

    const { level, message, category, metadata, stackTrace } = validation.sanitizedData;
    const logMetadata = {
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      ...(stackTrace ? { stackTrace } : {}),
    };
    const logEntry = logger.log(level || 'INFO', message, logMetadata, category || 'FRONTEND');
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
      if (!result.success) {
        // 400 for an action the resolver does not support. 503 when a supported
        // action ran but did not succeed.
        const statusCode = result.status === 'not_supported' ? 400 : 503;
        return res.status(statusCode).json({ success: false, remediation: result });
      }
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
