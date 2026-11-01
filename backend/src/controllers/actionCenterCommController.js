/**
 * Action Center Communication Controller
 * HTTP handler for dispatching, retrieving, and tracking SMS and Email communications.
 */

const crypto = require('crypto');
const { logger } = require('../services/loggerService');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const actionCenterNotificationService = require('../services/actionCenterNotificationService');
const paymentDuesQueries = require('../db/paymentDuesQueries');

/**
 * Resolves verified actor strictly from authenticated session.
 */
function resolveActor(req) {
  const user = req?.user;
  return {
    id: user?.id || user?.uuid || user?.sub || null,
    name: user?.fullName || user?.name || user?.email || 'Category Manager',
    email: user?.email || null,
  };
}

/**
 * Timing-safe string comparison to prevent side-channel timing attacks.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verifies authenticity of inbound webhook callbacks.
 */
function verifyWebhookAuthenticity(req) {
  const expectedSecret =
    process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET ||
    process.env.ACTION_CENTER_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    return { valid: false, error: 'Webhook authentication is not configured.' };
  }

  const providedSecret =
    req?.headers?.['x-webhook-secret'] ||
    req?.headers?.['x-signature'] ||
    req?.headers?.['x-gateway-secret'] ||
    req?.query?.secret ||
    req?.body?.secret;

  if (!providedSecret) {
    return { valid: false, error: 'Missing webhook authentication signature.' };
  }

  const providedSecretStr = String(providedSecret);
  if (!timingSafeCompare(providedSecretStr, expectedSecret)) {
    return { valid: false, error: 'Invalid webhook authentication signature.' };
  }

  return { valid: true };
}

/**
 * POST /api/action-center/communications
 * Dispatches an SMS, Email, or multi-channel communication from Action Center.
 */
async function dispatchCommunication(req, res) {
  try {
    const actor = resolveActor(req);

    const validation = validatePayload(
      VALIDATION_SCHEMAS.actionCenterCommunicationSend,
      req.body
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid communication payload.',
        details: validation.errors,
      });
    }

    const { channel, recipientEmail, recipientPhone } = validation.sanitizedData;

    // Contact requirement assertions based on selected channel
    if ((channel === 'EMAIL' || channel === 'BOTH') && !recipientEmail) {
      return res.status(400).json({
        success: false,
        error: 'A valid recipient email address is required for Email dispatch.',
      });
    }

    if ((channel === 'SMS' || channel === 'BOTH') && !recipientPhone) {
      return res.status(400).json({
        success: false,
        error: 'A valid recipient phone number is required for SMS dispatch.',
      });
    }

    const result = await actionCenterNotificationService.dispatchActionCenterCommunication(
      validation.sanitizedData,
      actor
    );

    logger.audit(
      `[ACTION_CENTER_COMM] Dispatched ${channel} communication for ${validation.sanitizedData.entityType} ${validation.sanitizedData.entityId} by ${actor.email}`,
      actor.email,
      {
        actor: actor.email,
        channel,
        recipientEmail,
        recipientPhone,
        success: result.success,
      }
    );

    return res.status(200).json({
      success: result.success,
      message: result.followupError
        ? 'Communication dispatched, but scheduling follow-up task failed.'
        : result.success
        ? 'Communication dispatched and recorded successfully.'
        : 'Communication dispatch partially failed, but record was stored.',
      communication: result.communication,
      emailResult: result.emailResult,
      smsResult: result.smsResult,
      completedTask: result.completedTask,
      followupTask: result.followupTask,
      followupError: result.followupError || null,
    });
  } catch (err) {
    logger.error('Error dispatching Action Center communication', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while dispatching the communication.',
      details: err.message,
    });
  }
}

/**
 * GET /api/action-center/communications
 * Retrieves communication logs for Action Center entities.
 */
async function getCommunications(req, res) {
  try {
    const validation = validatePayload(
      VALIDATION_SCHEMAS.actionCenterCommunicationQuery,
      req.query
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters.',
        details: validation.errors,
      });
    }

    const result = await actionCenterNotificationService.getActionCenterCommunications(
      validation.sanitizedData
    );

    return res.status(200).json({
      success: true,
      items: result.items,
      pagination: result.pagination,
    });
  } catch (err) {
    logger.error('Error fetching Action Center communications', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve communication records.',
      details: err.message,
    });
  }
}

/**
 * POST /api/action-center/communications/webhook
 * Receives delivery status and acknowledgement updates using unique communication ID.
 */
async function handleDeliveryWebhook(req, res) {
  try {
    const authCheck = verifyWebhookAuthenticity(req);
    if (!authCheck.valid) {
      logger.warn(`Rejected unauthorized delivery webhook: ${authCheck.error}`, {}, 'ACTION_CENTER_CONTROLLER');
      return res.status(401).json({
        success: false,
        error: authCheck.error,
      });
    }

    const { communicationId, accountId, acknowledgementStatus, deliveryStatus, notes } = req.body || {};
    const targetId = communicationId || accountId;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        error: 'accountId is required.',
      });
    }

    const finalAcknowledgement = acknowledgementStatus || 'Acknowledged';

    const updated = await paymentDuesQueries.updateAcknowledgementStatus({
      ...(communicationId ? { communicationId } : {}),
      ...(accountId ? { accountId } : {}),
      acknowledgementStatus: finalAcknowledgement,
      notes: notes || `Webhook updated status to ${finalAcknowledgement}`,
      updatedBy: 'Category Manager',
    });

    if (!updated && communicationId) {
      return res.status(404).json({
        success: false,
        error: `Communication record with ID '${communicationId}' was not found.`,
      });
    }

    logger.audit(
      `[ACTION_CENTER_WEBHOOK] Updated status for communication ${targetId}: ack=${finalAcknowledgement}`,
      null,
      { communicationId, accountId, finalAcknowledgement }
    );

    return res.status(200).json({
      success: true,
      message: 'Communication status updated successfully.',
      updated,
    });
  } catch (err) {
    logger.error('Error in communication webhook handler', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to process delivery status webhook.',
      details: err.message,
    });
  }
}

module.exports = {
  dispatchCommunication,
  getCommunications,
  handleDeliveryWebhook,
  resolveActor,
  timingSafeCompare,
  verifyWebhookAuthenticity,
};
