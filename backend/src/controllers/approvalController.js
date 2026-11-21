// ==============================================================================
// APPROVAL CONTROLLER
// ==============================================================================
// REST API handlers for management approvals (credit adjustments, account
// verifications, trial extensions, discounts) in the Action Center.
// ==============================================================================

const crypto = require('crypto');
const approvalQueries = require('../db/approvalQueries');
const authSessionQueries = require('../db/authSessionQueries');
const mailerService = require('../services/mailerService');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const {
  APPROVAL_MESSAGES,
  AUTH_MESSAGES,
  APPROVER_CONFIG,
  findApproverConfig,
  resolveApproverEmail,
  buildApprovalOtpKey,
} = require('../config/constants');
const { logger } = require('../services/loggerService');

function sendApprovalError(res, error, fallbackMessage) {
  if (error?.code === 'ACTOR_REQUIRED') {
    return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN, retryable: false });
  }
  if (error?.code === 'PERSISTENCE_UNAVAILABLE') {
    return res.status(503).json({
      success: false,
      error: APPROVAL_MESSAGES.DATABASE_UNAVAILABLE,
      retryable: true,
    });
  }
  if (error?.code === 'APPROVAL_ALREADY_DECIDED') {
    return res.status(409).json({
      success: false,
      error: APPROVAL_MESSAGES.ALREADY_DECIDED,
      retryable: false,
    });
  }
  if (error?.code === 'APPROVER_OTP_INVALID') {
    return res.status(401).json({ success: false, error: APPROVAL_MESSAGES.OTP_INVALID, retryable: false });
  }
  if (error?.code === 'APPROVER_PASSWORD_INVALID') {
    return res.status(401).json({ success: false, error: APPROVAL_MESSAGES.PASSWORD_INVALID, retryable: false });
  }
  if (error?.code === 'APPROVER_PASSWORD_NOT_CONFIGURED') {
    return res.status(503).json({ success: false, error: APPROVAL_MESSAGES.PASSWORD_CONFIGURATION_UNAVAILABLE, retryable: false });
  }
  return res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * Builds the acting approver from the authenticated session only. Request headers
 * are never used as identity. Returns null when the session does not identify a user.
 */
function extractActor(req) {
  const user = req.user;
  if (!user) return null;
  const actor = {
    uuid: user.uuid || user.id || null,
    name: user.fullName || user.name || user.email || null,
    email: user.email || null,
    role: user.role || null,
  };
  return actor.uuid || actor.name ? actor : null;
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
    return sendApprovalError(res, err, 'Failed to retrieve approval summary statistics.');
  }
}

/**
 * GET /api/approvals
 */
async function getApprovals(req, res) {
  try {
    const { module, status, project, search, assigned_approver, limit = 50, offset = 0, sortBy, sortOrder } = req.query;
    const result = await approvalQueries.getApprovals({
      module,
      status,
      project,
      search,
      assigned_approver,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
      sortBy,
      sortOrder,
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
    return sendApprovalError(res, err, 'Failed to retrieve approval requests.');
  }
}

/**
 * POST /api/approvals/:id/action
 */
async function processAction(req, res) {
  let actor = null;
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

    actor = extractActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    }
    const updated = await approvalQueries.processApprovalAction(id, validation.sanitizedData, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Approval request "${id}" not found.` });
    }

    logger.info(`Approval action processed on ${updated.request_number}: ${updated.status}`, { actor: actor.email }, 'APPROVAL_CONTROLLER');
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err?.code === 'APPROVER_PASSWORD_INVALID' || err?.code === 'APPROVER_OTP_INVALID' || err?.code === 'APPROVAL_ALREADY_DECIDED') {
      logger.warn(`Approval action rejected on ${req.params.id}: ${err.message}`, { actor: actor?.email, code: err.code }, 'APPROVAL_CONTROLLER');
    } else {
      logger.error(`Failed to process approval action on ${req.params.id}`, err, 'APPROVAL_CONTROLLER');
    }
    return sendApprovalError(res, err, 'Failed to process approval action.');
  }
}

/**
 * GET /api/approvals/approvers
 */
async function getApprovers(req, res) {
  try {
    const approvers = APPROVER_CONFIG.map((a) => ({
      id: a.id,
      name: a.name,
      title: a.title || 'Management Authority',
      email: resolveApproverEmail(a.name),
    }));
    return res.json({ success: true, approvers });
  } catch (err) {
    logger.error('Failed to retrieve approvers list', err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve approvers list.' });
  }
}

/**
 * POST /api/approvals/send-otp
 * POST /api/approvals/:id/send-otp
 */
async function sendApprovalOtp(req, res) {
  try {
    const actor = extractActor(req);
    if (!actor) {
      return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    }

    const { approverName, id } = req.body || {};
    if (!approverName || typeof approverName !== 'string' || !approverName.trim()) {
      return res.status(400).json({ success: false, error: 'Approver name is required to send verification OTP.' });
    }

    const approver = findApproverConfig(approverName.trim());
    if (!approver) {
      return res.status(400).json({ success: false, error: `Approver "${approverName}" is not recognized.` });
    }

    const email = resolveApproverEmail(approver.name);
    if (!email) {
      return res.status(400).json({ success: false, error: APPROVAL_MESSAGES.APPROVER_EMAIL_NOT_CONFIGURED });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresInSeconds = 600; // 10 minutes
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const otpKey = buildApprovalOtpKey(approver.id);

    await authSessionQueries.saveOtp(otpKey, code, expiresAt, email);

    try {
      await mailerService.sendOtpEmail(email, code, expiresInSeconds, {
        purpose: 'Management Approval Verification',
        approverName: approver.name,
        approvalId: id || req.params?.id || 'pending',
      });
    } catch (mailErr) {
      logger.warn('Failed to deliver approval OTP email', { error: mailErr, email }, 'APPROVAL_CONTROLLER');
    }

    logger.info('Approval OTP issued', { approver: approver.name, email, actor: actor.email }, 'APPROVAL_CONTROLLER');

    return res.json({
      success: true,
      message: `Verification code sent to ${email}.`,
      email,
      expiresInSeconds,
    });
  } catch (err) {
    logger.error('Failed to send approval OTP', err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to send approval OTP.' });
  }
}

/**
 * GET /api/approvals/users
 */
async function getUsers(req, res) {
  try {
    const internalTaskQueries = require('../db/internalTaskQueries');
    const users = await internalTaskQueries.getInternalAssignees();
    return res.json({ success: true, users });
  } catch (err) {
    logger.error('Failed to retrieve users list', err, 'APPROVAL_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve users list.' });
  }
}

module.exports = {
  getSummary,
  getApprovals,
  getApprovers,
  getUsers,
  processAction,
  sendApprovalOtp,
  extractActor,
};
