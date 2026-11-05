// ==============================================================================
// USER LOGIN LOGS CONTROLLER
// ==============================================================================
// Exposes API handlers for category managers and administrators to view
// real-time session telemetry, login/logout timelines, and engagement metrics.
// ==============================================================================

const loginLogsQueries = require('../db/loginLogsQueries');
const { logger } = require('../services/loggerService');

/**
 * List login logs with optional filtering.
 */
async function listLogs(req, res) {
  try {
    const { userType, status, search, startDate, endDate, dateRangePreset, page, limit } = req.query || {};

    const result = await loginLogsQueries.listLoginLogs({
      userType,
      status,
      search,
      startDate,
      endDate,
      dateRangePreset,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });

    return res.json({
      success: true,
      logs: result.logs,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    });
  } catch (err) {
    logger.error('loginLogsController: listLogs failed', { error: err.message }, 'LOGIN_LOGS_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve login session logs',
    });
  }
}

/**
 * Get summary metrics for the real-time login logs dashboard.
 */
async function getSummary(req, res) {
  try {
    const summary = await loginLogsQueries.getLoginLogsSummary();
    return res.json({
      success: true,
      summary,
    });
  } catch (err) {
    logger.error('loginLogsController: getSummary failed', { error: err.message }, 'LOGIN_LOGS_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve login logs summary',
    });
  }
}

/**
 * Record a login or logout event from client or internal trigger.
 */
async function recordEvent(req, res) {
  try {
    const { type, email, userUuid, logoutReason, ...data } = req.body || {};

    if (type === 'logout') {
      const entry = await loginLogsQueries.recordLogoutLog({ email, userUuid, logoutReason });
      return res.json({ success: true, entry });
    }

    const entry = await loginLogsQueries.recordLoginLog({
      email,
      userId: userUuid,
      ...data,
    });

    return res.status(201).json({ success: true, entry });
  } catch (err) {
    logger.error('loginLogsController: recordEvent failed', { error: err.message }, 'LOGIN_LOGS_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to record session log event',
    });
  }
}

module.exports = {
  listLogs,
  getSummary,
  recordEvent,
};
