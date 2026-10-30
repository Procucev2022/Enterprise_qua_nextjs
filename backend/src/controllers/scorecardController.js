// ==============================================================================
// SCORECARD CONTROLLER
// ==============================================================================
// REST API handlers for executive and team performance tracking across
// Operations, Revenue, and Sales pillars in the Action Center.
// ==============================================================================

const scorecardQueries = require('../db/scorecardQueries');
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
    return res.status(500).json({ success: false, error: 'Failed to retrieve scorecard performance analytics.' });
  }
}

module.exports = {
  getScorecard,
};

