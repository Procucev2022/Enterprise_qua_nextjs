// ==============================================================================
// SCORECARD CONTROLLER
// ==============================================================================
// REST API handlers for executive and team performance tracking across
// Operations, Revenue, and Sales pillars in the Action Center.
// ==============================================================================

const scorecardQueries = require('../db/scorecardQueries');
const { PERSISTENCE_MESSAGES } = require('../config/constants');
const { logger } = require('../services/loggerService');

/**
 * GET /api/scorecard
 */
async function getScorecard(req, res) {
  try {
    const {
      period = 'this_month',
      startDate,
      endDate,
      project = 'all',
      pillar = 'all',
      executiveId,
    } = req.query;

    const data = await scorecardQueries.getScorecardData({
      period,
      startDate,
      endDate,
      project,
      pillar,
      executiveId,
    });

    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Failed to retrieve scorecard performance data', err, 'SCORECARD_CONTROLLER');
    if (err?.code === 'PERSISTENCE_UNAVAILABLE') {
      return res.status(503).json({ success: false, error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE, retryable: true });
    }
    if (err?.code === 'VALIDATION_FAILED') {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to retrieve scorecard performance analytics.' });
  }
}

module.exports = {
  getScorecard,
};
