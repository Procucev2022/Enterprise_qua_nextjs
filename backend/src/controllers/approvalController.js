// ==============================================================================
// APPROVAL CONTROLLER
// ==============================================================================
// REST API handlers for management approvals (credit adjustments, account
// verifications, trial extensions, discounts) in the Action Center.
// ==============================================================================

const approvalQueries = require('../db/approvalQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

function extractActor(req) {
  if (req.user) {
    return {
      uuid: req.user.uuid || req.user.id || null,
      name: req.user.fullName || req.user.name || req.user.email || 'Management Authority',
      email: req.user.email || null,
      role: req.user.role || 'admin',
    };
  }
  return {
    uuid: null,
    name: req.headers['x-user-name'] || 'Management Authority',
    email: req.headers['x-user-email'] || 'admin@procucev.com',
    role: 'admin',
  };
}

/**
 * GET /api/approvals/summary
 */
async function getSummary(req, res) {
  try {
    const summary = await approvalQueries.getApprovalSummary();
    return res.json({ success: true, summary });
  } catch (err) {
    logger.error('Failed to fetch approval summary', err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve approval summary statistics.' });
  }
}

/**
 * GET /api/approvals
 */
async function getApprovals(req, res) {
  try {
    const { module, status, project, search, limit = 50, offset = 0 } = req.query;
    const result = await approvalQueries.getApprovals({
      module,
      status,
      project,
      search,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
    return res.json({
      success: true,
      data: result.rows,
      total: result.total,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  } catch (err) {
    logger.error('Failed to retrieve approval requests', err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve approval requests.' });
  }
}

/**
 * POST /api/approvals/:id/action
 */
async function processAction(req, res) {
  try {
    const { id } = req.params;
    const validation = validatePayload(VALIDATION_SCHEMAS.approvalAction, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on approval action payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const updated = await approvalQueries.processApprovalAction(id, validation.sanitizedData, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Approval request "${id}" not found.` });
    }

    logger.info(`Approval action processed on ${updated.request_number}: ${updated.status}`, { actor: actor.email }, 'APPROVAL_CONTROLLER');
    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Failed to process approval action on ${req.params.id}`, err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to process approval action.' });
  }
}

module.exports = {
  getSummary,
  getApprovals,
  processAction,
};
