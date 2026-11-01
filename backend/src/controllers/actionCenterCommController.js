/**
 * Action Center Communication Controller
 * HTTP handler for dispatching, retrieving, and tracking SMS and Email communications.
 */

const { logger } = require('../services/loggerService');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const actionCenterNotificationService = require('../services/actionCenterNotificationService');
const paymentDuesQueries = require('../db/paymentDuesQueries');

/**
 * Resolves current actor from request authentication.
 */
function resolveActor(req) {
  if (req.user) {
    return {
      id: req.user.id || req.user.uuid || null,
      name: req.user.fullName || req.user.name || req.user.email || 'Category Manager',
      email: req.user.email || null,
      role: req.user.role || 'category_manager',
    };
  }
  return {
    id: null,
    name: req.headers['x-user-name'] || 'Category Manager',
    email: req.headers['x-user-email'] || 'category.manager@procucev.com',
    role: 'category_manager',
  };
}

/**
 * POST /api/action-center/communications
 * Dispatches an SMS, Email, or multi-channel communication from Action Center.
 */
async function dispatchCommunication(req, res) {
  try {
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

    const actor = resolveActor(req);
    const result = await actionCenterNotificationService.dispatchActionCenterCommunication(
      validation.sanitizedData,
      actor
    );

    logger.info(
      `Action Center communication dispatched for ${validation.sanitizedData.entityType} ${validation.sanitizedData.entityId}`,
      { actor: actor.email, channel, success: result.success },
      'ACTION_CENTER_CONTROLLER'
    );

    return res.status(200).json({
      success: result.success,
      message: result.success
        ? 'Communication dispatched and recorded successfully.'
        : 'Communication dispatch partially failed, but record was stored.',
      communication: result.communication,
      emailResult: result.emailResult,
      smsResult: result.smsResult,
      completedTask: result.completedTask,
      followupTask: result.followupTask,
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
 * Receives delivery status and acknowledgement updates.
 */
async function handleDeliveryWebhook(req, res) {
  try {
    const { accountId, acknowledgementStatus, notes, deliveryStatus } = req.body || {};
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required.' });
    }

    const actor = resolveActor(req);
    const finalStatus = acknowledgementStatus || 'Acknowledged';
    const updated = await paymentDuesQueries.updateAcknowledgementStatus({
      accountId,
      acknowledgementStatus: finalStatus,
      notes: notes || `Webhook updated status to ${deliveryStatus || finalStatus}`,
      updatedBy: actor.name,
    });

    logger.info(
      `Delivery webhook updated communication for account ${accountId}`,
      { status: acknowledgementStatus, deliveryStatus },
      'ACTION_CENTER_CONTROLLER'
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
};
