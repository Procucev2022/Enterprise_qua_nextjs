// ==============================================================================
// APPROVAL CONTROLLER
// ==============================================================================
// REST API handlers for management approvals (credit adjustments, account
// verifications, trial extensions, discounts) in the Action Center.
// ==============================================================================

const approvalQueries = require('../db/approvalQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { APPROVAL_MESSAGES } = require('../config/constants');
const { logger } = require('../services/loggerService');

const APPROVAL_ERROR_HTTP_MAP = {
  PERSISTENCE_UNAVAILABLE: {
    status: 503,
    message: APPROVAL_MESSAGES.DATABASE_UNAVAILABLE,
    retryable: true,
  },
  APPROVAL_ALREADY_DECIDED: {
    status: 409,
    message: APPROVAL_MESSAGES.ALREADY_DECIDED,
    retryable: false,
  },
  APPROVER_PASSWORD_INVALID: {
    status: 401,
    message: APPROVAL_MESSAGES.PASSWORD_INVALID,
    retryable: false,
  },
  APPROVER_PASSWORD_NOT_CONFIGURED: {
    status: 503,
    message: APPROVAL_MESSAGES.PASSWORD_CONFIGURATION_UNAVAILABLE,
    retryable: false,
  },
  APPROVAL_CREDENTIALS_REQUIRED: {
    status: 400,
    message: APPROVAL_MESSAGES.CREDENTIALS_REQUIRED,
    retryable: false,
  },
  APPROVER_UNKNOWN: {
    status: 400,
    message: APPROVAL_MESSAGES.APPROVER_UNKNOWN,
    retryable: false,
  },
  APPROVAL_OTP_INVALID: {
    status: 401,
    message: APPROVAL_MESSAGES.OTP_INVALID,
    retryable: false,
  },
  APPROVAL_OTP_EXPIRED: {
    status: 401,
    message: APPROVAL_MESSAGES.OTP_EXPIRED,
    retryable: false,
  },
  APPROVAL_OTP_MAX_ATTEMPTS: {
    status: 401,
    message: APPROVAL_MESSAGES.OTP_MAX_ATTEMPTS,
    retryable: false,
  },
  APPROVAL_OTP_DELIVERY_FAILED: {
    status: 503,
    message: APPROVAL_MESSAGES.OTP_DELIVERY_FAILED,
    retryable: true,
  },
  APPROVAL_OTP_STORAGE_FAILED: {
    status: 503,
    message: APPROVAL_MESSAGES.OTP_STORAGE_FAILED,
    retryable: true,
  },
};

function sendApprovalError(res, error, fallbackMessage) {
  const mapped = error?.code ? APPROVAL_ERROR_HTTP_MAP[error.code] : null;
  if (mapped) {
    return res.status(mapped.status).json({
      success: false,
      error: mapped.message,
      retryable: mapped.retryable,
    });
  }
  return res.status(500).json({ success: false, error: fallbackMessage });
}

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
 * POST /api/approvals/request-otp
 */
async function requestOtp(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.approvalOtpRequest, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on approval OTP request payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const result = await approvalQueries.requestApprovalOtp(
      validation.sanitizedData.approverName,
      actor,
      req.ip || ''
    );

    logger.info(
      `Approval Email OTP sent for ${result.approverName}`,
      { actor: actor.email, email: result.email },
      'APPROVAL_CONTROLLER'
    );
    return res.json(result);
  } catch (err) {
    logger.error('Failed to dispatch approval Email OTP', err, 'APPROVAL_CONTROLLER');
    return sendApprovalError(res, err, 'Failed to send approval Email OTP.');
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

    const { password, otpCode } = validation.sanitizedData;
    if (!password && !otpCode) {
      return res.status(400).json({
        success: false,
        error: APPROVAL_MESSAGES.CREDENTIALS_REQUIRED,
        details: { credentials: APPROVAL_MESSAGES.CREDENTIALS_REQUIRED },
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
    return sendApprovalError(res, err, 'Failed to process approval action.');
  }
}

module.exports = {
  getSummary,
  getApprovals,
  requestOtp,
  processAction,
  extractActor,
};
