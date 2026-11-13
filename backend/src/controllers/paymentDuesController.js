// ==============================================================================
// PAYMENT DUES CONTROLLER
// ==============================================================================
// Handles HTTP endpoints for low-credit account monitoring, communication dispatch,
// acknowledgement tracking, and CSV reporting.
// ==============================================================================

const paymentDuesQueries = require('../db/paymentDuesQueries');
const pool = require('../db/pool');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const mailerService = require('../services/mailerService');
const eventOutboxService = require('../services/eventOutboxService');
const storeService = require('../services/storeService');
const whatsAppService = require('../services/whatsAppService');
const { logger } = require('../services/loggerService');
const { PERSISTENCE_MESSAGES } = require('../config/constants');

function sendControllerError(res, error, fallbackMessage) {
  if (error?.code === 'PERSISTENCE_UNAVAILABLE') {
    return res.status(503).json({
      success: false,
      retryable: true,
      error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
    });
  }

  return res.status(500).json({ success: false, error: fallbackMessage });
}

const PAYMENT_DUES_ACTOR_ERROR = 'Sign in with a staff account to record this payment-dues action. No signed-in user was found on the request.';

/**
 * Name recorded on a communication. The authenticated user is the only source, and no
 * default sender is assumed. Without a signed-in user the request fails with 401.
 */
function requireActor(req, res) {
  const actor = req.user?.name || req.user?.email;
  if (!actor) {
    res.status(401).json({ success: false, error: PAYMENT_DUES_ACTOR_ERROR });
    return null;
  }
  return actor;
}

/**
 * List low-credit accounts with filtering, sorting, pagination, and summary.
 */
async function listPaymentDues(req, res) {
  try {
    const {
      search = '',
      accountType = 'all',
      credits = 'all',
      acknowledgementStatus = 'all',
      accountStatus = 'all',
      assignedExecutive = 'all',
      notificationChannel = 'all',
      sortBy = 'availableCredits',
      sortOrder = 'asc',
      page = 1,
      limit = 25,
    } = req.query;

    const result = await paymentDuesQueries.getLowCreditAccounts({
      search,
      accountType,
      credits,
      acknowledgementStatus,
      accountStatus,
      assignedExecutive,
      notificationChannel,
      sortBy,
      sortOrder,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 25,
    });

    logger.info('Retrieved payment dues low-credit accounts', {
      total: result.total,
      page: result.page,
      limit: result.limit,
      requester: req.user?.email || 'anonymous',
    });

    return res.status(200).json({
      success: true,
      accounts: result.accounts,
      total: result.total,
      summary: result.summary,
      page: result.page,
      limit: result.limit,
    });
  } catch (error) {
    logger.error('Failed to list payment dues accounts', { error });
    return sendControllerError(res, error, 'An internal server error occurred while retrieving low-credit accounts.');
  }
}

/**
 * Get dynamic summary metrics for payment dues.
 */
async function getSummary(req, res) {
  try {
    const summary = await paymentDuesQueries.getPaymentDuesSummary();
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get payment dues summary', { error });
    return sendControllerError(res, error, 'An internal server error occurred while retrieving payment dues summary.');
  }
}

/**
 * Dispatch Email notification to low-credit account.
 */
async function sendEmailNotification(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.sendPaymentDuesEmail, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email payload parameters.',
        details: validation.errors,
      });
    }

    const { accountId, accountType, recipientEmail, subject, message, notes } = validation.sanitizedData;
    const sender = requireActor(req, res);
    if (!sender) return undefined;

    // Write pending history first so a crash or provider outage cannot leave an
    // externally sent email with no durable communication record.
    let communication;
    try {
      communication = await paymentDuesQueries.recordCommunication({
        accountId,
        accountType,
        channel: 'email',
        recipient: recipientEmail,
        subject,
        message,
        communicatedBy: sender,
        notificationStatus: 'Pending',
        deliveryStatus: 'Pending',
        acknowledgementStatus: 'Acknowledgement Pending',
        notes: notes || '',
      });
    } catch (error) {
      logger.error('Could not persist pending low-credit email before dispatch', {
        error,
        accountId,
      });
      return sendControllerError(
        res,
        error,
        'The email was not sent because its communication history could not be saved.'
      );
    }

    logger.info('Low-credit email dispatch started', {
      communicationId: communication.id,
      accountId,
      sender,
      deliveryStatus: communication.deliveryStatus,
    });

    if (pool.hasStorage()) {
      try {
        await eventOutboxService.dispatchDueEventOutboxJobs(1);
      } catch (dispatchError) {
        logger.error('Immediate low-credit email dispatch failed; durable recovery will retry', {
          error: dispatchError,
          accountId,
          communicationId: communication.id,
        }, 'PAYMENT_DUES');
      }

      let queuedCommunication;
      try {
        queuedCommunication = await paymentDuesQueries.getCommunicationById(communication.id);
      } catch (lookupError) {
        logger.error('Could not read low-credit email state after queueing', {
          error: lookupError,
          accountId,
          communicationId: communication.id,
        }, 'PAYMENT_DUES');
        return sendControllerError(
          res,
          lookupError,
          'The email is queued, but its current delivery status could not be loaded.'
        );
      }
      if (!queuedCommunication) {
        const missingCommunication = new Error('Queued low-credit email communication could not be found.');
        missingCommunication.code = 'PERSISTENCE_UNAVAILABLE';
        return sendControllerError(
          res,
          missingCommunication,
          'The email is queued, but its current delivery status could not be loaded.'
        );
      }

      const delivered = queuedCommunication.deliveryStatus === 'Delivered';
      return res.status(delivered ? 200 : 202).json({
        success: true,
        message: delivered
          ? 'Email notification sent and recorded successfully.'
          : 'Email delivery is queued and will retry automatically until its status is resolved.',
        communication: queuedCommunication,
      });
    }

    // Use the shared provider router so Node, Worker, Gmail, SMTP, and HTTP
    // transports follow the same retry, failover, cooldown, and logging rules.
    let deliveryError = null;
    let providerAvailable = true;
    try {
      const result = await mailerService.deliver({
        to: recipientEmail,
        subject,
        text: message,
      }, 'PAYMENT_DUES_NOTIFICATION');
      if (!result?.sent) {
        providerAvailable = false;
        throw new Error(result?.reason || 'No outbound email provider accepted the message.');
      }
    } catch (mailErr) {
      deliveryError = mailErr;
      logger.error('Failed to dispatch low-credit email', {
        error: mailErr,
        accountId,
        providerAvailable,
      });
    }

    let finalizedCommunication;
    try {
      finalizedCommunication = await paymentDuesQueries.updateCommunicationDeliveryStatus({
        communicationId: communication.id,
        notificationStatus: deliveryError ? 'Failed' : 'Notification Sent',
        deliveryStatus: deliveryError ? 'Failed' : 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      });
      if (!finalizedCommunication) {
        const missingHistory = new Error('Pending low-credit communication disappeared before delivery status was saved.');
        missingHistory.code = 'PERSISTENCE_UNAVAILABLE';
        throw missingHistory;
      }
    } catch (error) {
      logger.error('Low-credit email was attempted but its final delivery status could not be persisted', {
        error,
        communicationId: communication.id,
        accountId,
        providerAccepted: !deliveryError,
      });
      return res.status(503).json({
        success: false,
        retryable: false,
        error: PERSISTENCE_MESSAGES.PAYMENT_DUES_DELIVERY_STATUS_FAILED,
        communication,
      });
    }

    logger.info('Low-credit email communication logged', {
      communicationId: finalizedCommunication.id,
      accountId,
      sender,
      deliveryStatus: finalizedCommunication.deliveryStatus,
    });

    if (deliveryError) {
      return res.status(providerAvailable ? 502 : 503).json({
        success: false,
        retryable: !providerAvailable,
        error: providerAvailable
          ? 'Email delivery failed. Review communication history before retrying.'
          : 'Email service is not configured. The failed delivery has been recorded; contact support.',
        communication: finalizedCommunication,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Email notification sent and recorded successfully.',
      communication: finalizedCommunication,
    });
  } catch (error) {
    logger.error('Error sending low-credit email', { error });
    return sendControllerError(res, error, 'An internal server error occurred while sending email notification.');
  }
}

/**
 * Dispatch In-App Message notification to low-credit account.
 */
async function sendMessageNotification(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.sendPaymentDuesMessage, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid in-app message parameters.',
        details: validation.errors,
      });
    }

    const { accountId, accountType, title, message, notes } = validation.sanitizedData;
    const sender = requireActor(req, res);
    if (!sender) return undefined;
    const msgTitle = title || 'Action Required: Low Credit Balance Alert';

    // Persist the recipient notification before recording a successful delivery.
    try {
      await storeService.createNotificationDurably({
        recipientType: accountType === 'seller' ? 'vendor' : 'buyer',
        recipientId: accountId,
        kind: 'low_credit_alert',
        title: msgTitle,
        message,
        meta: { accountId, accountType, sentBy: sender },
      });
    } catch (notifErr) {
      logger.error('Failed to persist in-app low-credit notification', {
        error: notifErr,
        accountId,
        accountType,
      });
      return sendControllerError(
        res,
        notifErr,
        'The in-app notification could not be saved. Please retry shortly.'
      );
    }

    // Record communication in database
    const communication = await paymentDuesQueries.recordCommunication({
      accountId,
      accountType,
      channel: 'message',
      recipient: accountId,
      subject: msgTitle,
      message,
      communicatedBy: sender,
      notificationStatus: 'Delivered',
      deliveryStatus: 'Delivered',
      acknowledgementStatus: 'Acknowledgement Pending',
      notes: notes || '',
    });

    logger.info('Low-credit in-app message logged', {
      communicationId: communication.id,
      accountId,
      sender,
    });

    return res.status(200).json({
      success: true,
      message: 'In-app notification delivered and recorded successfully.',
      communication,
    });
  } catch (error) {
    logger.error('Error sending in-app message', { error });
    return sendControllerError(res, error, 'An internal server error occurred while sending in-app notification.');
  }
}

/**
 * Initiate WhatsApp notification and return direct chat deep-link.
 */
async function sendWhatsAppNotification(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.sendPaymentDuesWhatsApp, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid WhatsApp payload parameters.',
        details: validation.errors,
      });
    }

    const { accountId, accountType, phone, message, notes } = validation.sanitizedData;
    const sender = requireActor(req, res);
    if (!sender) return undefined;

    // Build direct wa.me link
    const directLink = typeof whatsAppService.buildDirectWhatsAppLink === 'function'
      ? whatsAppService.buildDirectWhatsAppLink(phone, message)
      : `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

    // Record communication in database
    const communication = await paymentDuesQueries.recordCommunication({
      accountId,
      accountType,
      channel: 'whatsapp',
      recipient: phone,
      subject: 'WhatsApp Low-Credit Alert',
      message,
      communicatedBy: sender,
      // A wa.me link only prepares the message. Delivery starts after a staff
      // member opens WhatsApp and sends it, so do not mark it delivered here.
      notificationStatus: 'Delivery Pending',
      deliveryStatus: 'Pending',
      acknowledgementStatus: 'Delivery Pending',
      notes: notes || '',
      metadata: { directLink },
    });

    logger.info('Low-credit WhatsApp notification logged', {
      communicationId: communication.id,
      accountId,
      phone,
      sender,
    });

    return res.status(200).json({
      success: true,
      message: 'WhatsApp notification initiated and recorded successfully.',
      communication,
      directLink,
    });
  } catch (error) {
    logger.error('Error sending WhatsApp notification', { error });
    return sendControllerError(res, error, 'An internal server error occurred while initiating WhatsApp notification.');
  }
}

/**
 * Update acknowledgement status of a low-credit account.
 */
async function updateAcknowledgement(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.updatePaymentDuesAcknowledgement, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid acknowledgement update parameters.',
        details: validation.errors,
      });
    }

    const { accountId, accountType, acknowledgementStatus, notes } = validation.sanitizedData;
    const updatedBy = requireActor(req, res);
    if (!updatedBy) return undefined;

    const updated = await paymentDuesQueries.updateAcknowledgementStatus({
      accountId,
      accountType,
      acknowledgementStatus,
      notes: notes || '',
      updatedBy,
    });

    logger.info('Payment dues acknowledgement updated', {
      accountId,
      accountType,
      acknowledgementStatus,
      updatedBy,
    });

    return res.status(200).json({
      success: true,
      message: 'Acknowledgement status updated successfully.',
      communication: updated,
    });
  } catch (error) {
    logger.error('Error updating acknowledgement status', { error });
    return sendControllerError(res, error, 'An internal server error occurred while updating acknowledgement status.');
  }
}

/**
 * Get communication history for an account.
 */
async function getHistory(req, res) {
  try {
    const { accountId } = req.params;
    if (!accountId) {
      return res.status(400).json({ success: false, error: 'Account ID is required.' });
    }
    if (accountId === '*' || accountId === '%2A') {
      return res.status(400).json({ success: false, error: 'Cross-account wildcard lookup is not permitted.' });
    }

    const history = await paymentDuesQueries.getCommunicationHistory(accountId, { isCrossAccount: false });
    return res.status(200).json({ success: true, history });
  } catch (error) {
    logger.error('Error fetching communication history', { error });
    return sendControllerError(res, error, 'An internal server error occurred while retrieving communication history.');
  }
}

/**
 * Export filtered low-credit payment dues accounts to CSV.
 */
async function exportCsv(req, res) {
  try {
    const {
      search = '',
      accountType = 'all',
      credits = 'all',
      acknowledgementStatus = 'all',
      accountStatus = 'all',
      assignedExecutive = 'all',
      notificationChannel = 'all',
      sortBy = 'availableCredits',
      sortOrder = 'asc',
    } = req.query;

    const result = await paymentDuesQueries.getLowCreditAccounts({
      search,
      accountType,
      credits,
      acknowledgementStatus,
      accountStatus,
      assignedExecutive,
      notificationChannel,
      sortBy,
      sortOrder,
      page: 1,
      limit: 10000,
    });

    const headers = [
      'Account ID',
      'Account Type',
      'Company Name',
      'Contact Person',
      'Email',
      'Phone Number',
      'Available Credits',
      'Total Credits',
      'Credits Used',
      'Account Status',
      'Registration Date',
      'Last Activity',
      'Assigned Executive',
      'Last Notification',
      'Notification Channel',
      'Acknowledgement Status',
    ];

    const escapeCsv = (str) => `"${String(str ?? '').replace(/"/g, '""')}"`;

    const csvRows = [headers.join(',')];
    for (const a of result.accounts) {
      csvRows.push(
        [
          escapeCsv(a.accountId),
          escapeCsv(a.accountType),
          escapeCsv(a.companyName),
          escapeCsv(a.contactPerson),
          escapeCsv(a.email),
          escapeCsv(a.phoneNumber),
          a.availableCredits,
          a.totalCredits,
          a.creditsUsed,
          escapeCsv(a.accountStatus),
          escapeCsv(a.registrationDate),
          escapeCsv(a.lastActivity),
          escapeCsv(a.assignedExecutive),
          escapeCsv(a.lastNotification ?? '–'),
          escapeCsv(a.notificationChannel ?? '–'),
          escapeCsv(a.acknowledgementStatus ?? 'Not Notified'),
        ].join(',')
      );
    }

    const csvContent = csvRows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payment_dues_report.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    logger.error('Error exporting payment dues CSV', { error });
    return sendControllerError(res, error, 'An internal server error occurred while exporting CSV report.');
  }
}

module.exports = {
  listPaymentDues,
  getSummary,
  sendEmailNotification,
  sendMessageNotification,
  sendWhatsAppNotification,
  updateAcknowledgement,
  getHistory,
  exportCsv,
};
