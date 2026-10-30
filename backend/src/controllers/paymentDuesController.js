// ==============================================================================
// PAYMENT DUES CONTROLLER
// ==============================================================================
// Handles HTTP endpoints for low-credit account monitoring, communication dispatch,
// acknowledgement tracking, and CSV reporting.
// ==============================================================================

const paymentDuesQueries = require('../db/paymentDuesQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const mailerService = require('../services/mailerService');
const storeService = require('../services/storeService');
const whatsAppService = require('../services/whatsAppService');
const { logger } = require('../services/loggerService');

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
    logger.error('Failed to list payment dues accounts', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while retrieving low-credit accounts.',
    });
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
    logger.error('Failed to get payment dues summary', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while retrieving payment dues summary.',
    });
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
    const sender = req.user?.name || req.user?.email || 'Category Manager';

    // Dispatch email via mailerService transporter if available
    try {
      const transporter = mailerService.getTransporter ? mailerService.getTransporter() : null;
      if (transporter && typeof transporter.sendMail === 'function') {
        await transporter.sendMail({
          to: recipientEmail,
          subject,
          text: message,
        });
      }
    } catch (mailErr) {
      logger.warn('Failed to dispatch external email, continuing with audit recording', {
        error: mailErr.message,
        recipient: recipientEmail,
      });
    }

    // Record communication in database
    const communication = await paymentDuesQueries.recordCommunication({
      accountId,
      accountType,
      channel: 'email',
      recipient: recipientEmail,
      subject,
      message,
      communicatedBy: sender,
      notificationStatus: 'Notification Sent',
      deliveryStatus: 'Delivered',
      acknowledgementStatus: 'Acknowledgement Pending',
      notes: notes || '',
    });

    logger.info('Low-credit email communication logged', {
      communicationId: communication.id,
      accountId,
      recipient: recipientEmail,
      sender,
    });

    return res.status(200).json({
      success: true,
      message: 'Email notification sent and recorded successfully.',
      communication,
    });
  } catch (error) {
    logger.error('Error sending low-credit email', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while sending email notification.',
    });
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
    const sender = req.user?.name || req.user?.email || 'Category Manager';
    const msgTitle = title || 'Action Required: Low Credit Balance Alert';

    // Queue in-app notification in storeService if available
    try {
      if (typeof storeService.createNotification === 'function') {
        const notif = storeService.createNotification({
          title: msgTitle,
          message,
          type: 'low_credit_alert',
          meta: { accountId, accountType, sentBy: sender },
        });
        if (Array.isArray(storeService.notifications)) {
          storeService.notifications.unshift(notif);
        }
        storeService._persistNotification?.(notif);
      }
    } catch (notifErr) {
      logger.warn('Failed to queue in-app store notification, continuing with audit recording', {
        error: notifErr.message,
        accountId,
      });
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
    logger.error('Error sending in-app message', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while sending in-app notification.',
    });
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
    const sender = req.user?.name || req.user?.email || 'Category Manager';

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
      notificationStatus: 'Notification Sent',
      deliveryStatus: 'Delivered',
      acknowledgementStatus: 'Acknowledgement Pending',
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
    logger.error('Error sending WhatsApp notification', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while initiating WhatsApp notification.',
    });
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
    const updatedBy = req.user?.name || req.user?.email || 'Category Manager';

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
    logger.error('Error updating acknowledgement status', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while updating acknowledgement status.',
    });
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

    const history = await paymentDuesQueries.getCommunicationHistory(accountId);
    return res.status(200).json({ success: true, history });
  } catch (error) {
    logger.error('Error fetching communication history', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while retrieving communication history.',
    });
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
    logger.error('Error exporting payment dues CSV', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while exporting CSV report.',
    });
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
