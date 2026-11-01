/**
 * Action Center Notification & Communication Service
 * Unified orchestration engine for SMS and Email dispatches across Action Center domains.
 */

const { logger } = require('./loggerService');
const mailerService = require('./mailerService');
const smsService = require('./smsService');
const paymentDuesQueries = require('../db/paymentDuesQueries');
const internalTaskQueries = require('../db/internalTaskQueries');
const { ACTION_CENTER_CHANNELS, ACTION_CENTER_ENTITY_TYPES } = require('../config/constants');

/**
 * Renders an enterprise-grade HTML email template for Action Center notifications.
 * @param {Object} params
 * @param {string} params.recipientName
 * @param {string} params.subject
 * @param {string} params.message
 * @param {string} [params.linkUrl]
 * @param {string} [params.entityType]
 * @param {string} [params.senderName]
 * @returns {string} HTML markup
 */
function renderActionCenterEmailHtml({
  recipientName = 'Valued Partner',
  subject = 'Action Center Notification',
  message = '',
  linkUrl = '',
  entityType = 'action_center',
  senderName = 'Category Management Team',
}) {
  const logoUrl =
    mailerService.getLogoUrl ? mailerService.getLogoUrl() : 'https://equa.procucev.com/procucev-logo.png';
  const defaultFrontend =
    mailerService.getPublicFrontendUrl
      ? mailerService.getPublicFrontendUrl()
      : 'https://equa.procucev.com';
  const actionUrl = linkUrl || `${defaultFrontend}/category-manager/internal-tasks`;
  const formattedEntity = String(entityType).replace(/_/g, ' ').toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
    .container { max-width: 600px; margin: 24px auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04); }
    .header { background: #0f172a; padding: 20px 28px; text-align: left; }
    .header img { max-height: 36px; }
    .content { padding: 32px 28px; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; background: #e0f2fe; color: #0369a1; text-transform: uppercase; margin-bottom: 12px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; }
    .message-box { background: #f8fafc; border-left: 4px solid #0284c7; padding: 16px 20px; border-radius: 0 6px 6px 0; margin: 20px 0; line-height: 1.6; white-space: pre-wrap; font-size: 14px; }
    .btn-container { margin: 28px 0; text-align: center; }
    .btn { display: inline-block; background: #0284c7; color: #ffffff !important; padding: 12px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; }
    .footer { background: #f1f5f9; padding: 20px 28px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="Procucev Enterprise" />
    </div>
    <div class="content">
      <div class="badge">${formattedEntity} ALERT</div>
      <h1 class="title">${subject}</h1>
      <p style="font-size: 14px; color: #334155;">Dear <strong>${recipientName}</strong>,</p>
      <div class="message-box">${message}</div>
      <div class="btn-container">
        <a href="${actionUrl}" class="btn" target="_blank" rel="noopener noreferrer">View in Action Center</a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
        Sent by: <strong>${senderName}</strong> &bull; Procucev Enterprise Action Center
      </p>
    </div>
    <div class="footer">
      This is an automated notification from Procucev Enterprise Procurement Portal.<br/>
      Please do not reply directly if this message was sent from an unmonitored address.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dispatches an Action Center communication across SMS, Email, or both,
 * persisting the record and optional tasks.
 *
 * @param {Object} payload
 * @param {string} payload.entityType - Action center domain ('internal_task', 'ticket', 'approval', etc.)
 * @param {string} payload.entityId - Identifier of the entity/account
 * @param {'EMAIL'|'SMS'|'BOTH'} payload.channel - Target notification channel
 * @param {string} [payload.recipientEmail] - Target email address
 * @param {string} [payload.recipientPhone] - Target phone number
 * @param {string} [payload.recipientName] - Human-readable recipient name
 * @param {string} [payload.subject] - Subject line
 * @param {string} payload.message - Notification message body
 * @param {string} [payload.linkUrl] - Action link
 * @param {string} [payload.notes] - Additional private notes
 * @param {Object} [payload.scheduleFollowup] - Optional follow-up task config
 * @param {Object} [actor] - Initiator user context
 * @returns {Promise<Object>} Dispatch result
 */
async function dispatchActionCenterCommunication(payload, actor = {}) {
  const {
    entityType = 'internal_task',
    entityId,
    channel = 'EMAIL',
    recipientEmail = '',
    recipientPhone = '',
    recipientName = 'Partner',
    subject = 'Action Center Notification',
    message = '',
    linkUrl = '',
    notes = '',
    metadata = {},
    scheduleFollowup = null,
  } = payload;

  const senderName = actor.fullName || actor.name || actor.email || 'Category Manager';
  const senderEmail = actor.email || '';

  const results = {
    email: null,
    sms: null,
  };

  const channelUpper = (channel || 'EMAIL').toUpperCase();
  const shouldSendEmail = (channelUpper === 'EMAIL' || channelUpper === 'BOTH') && Boolean(recipientEmail);
  const shouldSendSms = (channelUpper === 'SMS' || channelUpper === 'BOTH') && Boolean(recipientPhone);

  // 1. Dispatch Email if requested
  if (shouldSendEmail) {
    try {
      const htmlBody = renderActionCenterEmailHtml({
        recipientName,
        subject,
        message,
        linkUrl,
        entityType,
        senderName,
      });

      const emailPayload = {
        to: recipientEmail,
        subject: `[Procucev Alert] ${subject}`,
        html: htmlBody,
        text: `${subject}\n\nDear ${recipientName},\n\n${message}\n\nAction Link: ${linkUrl || 'https://equa.procucev.com'}\n\nSent by: ${senderName}`,
        replyTo: senderEmail || undefined,
      };

      if (typeof mailerService.deliver === 'function') {
        const deliverRes = await mailerService.deliver(emailPayload, 'ACTION_CENTER_NOTIFICATION');
        results.email = {
          success: deliverRes !== false,
          dispatchedAt: new Date().toISOString(),
          recipient: recipientEmail,
        };
      } else {
        results.email = { success: true, mock: true, recipient: recipientEmail };
      }

      logger.info(
        `[ACTION_CENTER] Dispatched email communication to ${recipientEmail} for ${entityType} ${entityId}`,
        { entityType, entityId, recipientEmail },
        'ACTION_CENTER_COMM'
      );
    } catch (mailErr) {
      logger.error(
        `[ACTION_CENTER] Failed to send email to ${recipientEmail}`,
        mailErr,
        'ACTION_CENTER_COMM'
      );
      results.email = { success: false, error: mailErr.message, recipient: recipientEmail };
    }
  }

  // 2. Dispatch SMS if requested
  if (shouldSendSms) {
    try {
      const smsRes = await smsService.sendActionCenterSms({
        mobile: recipientPhone,
        recipientName,
        message,
        linkUrl,
        entityType,
      });

      results.sms = {
        success: Boolean(smsRes.success),
        messageId: smsRes.messageId,
        recipient: recipientPhone,
        throttled: Boolean(smsRes.throttled),
      };

      logger.info(
        `[ACTION_CENTER] Dispatched SMS communication to ${recipientPhone} for ${entityType} ${entityId}`,
        { entityType, entityId, recipientPhone, smsSuccess: smsRes.success },
        'ACTION_CENTER_COMM'
      );
    } catch (smsErr) {
      logger.error(
        `[ACTION_CENTER] Failed to send SMS to ${recipientPhone}`,
        smsErr,
        'ACTION_CENTER_COMM'
      );
      results.sms = { success: false, error: smsErr.message, recipient: recipientPhone };
    }
  }

  // 3. Determine overall dispatch status
  const emailOk = shouldSendEmail ? results.email?.success : true;
  const smsOk = shouldSendSms ? results.sms?.success : true;
  const anyRequested = shouldSendEmail || shouldSendSms;
  const overallSuccess = anyRequested ? (emailOk && smsOk) : true;
  const deliveryStatus = overallSuccess ? 'Delivered' : 'Failed';

  // 4. Persist communication record
  const primaryRecipient = recipientEmail || recipientPhone || recipientName;
  const record = await paymentDuesQueries.recordCommunication({
    accountId: entityId,
    accountType: entityType,
    channel: channelUpper,
    recipient: primaryRecipient,
    subject,
    message,
    notificationStatus: deliveryStatus === 'Delivered' ? 'Notification Sent' : 'Failed',
    deliveryStatus,
    acknowledgementStatus: 'Acknowledgement Pending',
    communicatedBy: senderName,
    notes: notes || '',
    metadata: {
      ...(metadata || {}),
      entityType,
      entityId,
      recipientName,
      recipientEmail,
      recipientPhone,
      emailResult: results.email,
      smsResult: results.sms,
      linkUrl,
    },
  });

  // 5. Create completed activity log task
  let completedTask = null;
  try {
    const channelLabel = channelUpper === 'BOTH' ? 'Email & SMS' : channelUpper;
    completedTask = await internalTaskQueries.createInternalTask(
      {
        title: `[${channelLabel} Log / Completed] ${subject || recipientName}`,
        description: message || notes || 'Action Center communication dispatched.',
        priority: 'Medium',
        status: 'Completed',
        assignedToUserId: actor.id || actor.uuid || null,
        assignedToName: senderName,
        assignedTeam: 'Category Management',
        dueDate: new Date().toISOString(),
        relatedEntityType: String(entityType).toUpperCase(),
        relatedEntityId: entityId,
        relatedEntityLabel: recipientName || entityId,
        notes: `Recipient: ${primaryRecipient} | Channel: ${channelUpper} | Delivery: ${deliveryStatus}`,
      },
      actor
    );
  } catch (taskErr) {
    logger.warn('Failed to record completed activity task for communication', {
      error: taskErr.message,
    });
  }

  // 6. Schedule future follow-up task if requested
  let followupTask = null;
  if (scheduleFollowup && scheduleFollowup.dueDate) {
    try {
      followupTask = await internalTaskQueries.createInternalTask(
        {
          title: `[Follow-up] ${subject || recipientName}`,
          description: scheduleFollowup.notes || message || 'Follow up on communication dispatch.',
          priority: scheduleFollowup.priority || 'Medium',
          status: 'Pending',
          assignedToUserId: scheduleFollowup.assigneeId || actor.id || null,
          assignedToName: scheduleFollowup.assigneeName || senderName,
          assignedTeam: 'Category Management',
          dueDate: scheduleFollowup.dueDate,
          relatedEntityType: String(entityType).toUpperCase(),
          relatedEntityId: entityId,
          relatedEntityLabel: recipientName || entityId,
          notes: scheduleFollowup.notes || `Scheduled follow-up for communication #${record.id}`,
        },
        actor
      );
    } catch (fuErr) {
      logger.warn('Failed to schedule follow-up task', { error: fuErr.message });
    }
  }

  return {
    success: overallSuccess,
    communication: record,
    emailResult: results.email,
    smsResult: results.sms,
    completedTask,
    followupTask,
  };
}

/**
 * Retrieves communications history for an entity.
 * @param {Object} filter
 * @param {string} [filter.entityId]
 * @param {string} [filter.entityType]
 * @param {string} [filter.channel]
 * @param {number} [filter.page=1]
 * @param {number} [filter.pageSize=20]
 * @returns {Promise<Object>} List of communication records and pagination metadata
 */
async function getActionCenterCommunications(filter = {}) {
  const { entityId, entityType, channel, page = 1, pageSize = 20 } = filter;

  let records = [];
  if (entityId) {
    records = await paymentDuesQueries.getCommunicationHistory(entityId);
  } else {
    // If no specific entityId, retrieve all recent communications
    records = await paymentDuesQueries.getCommunicationHistory('');
  }

  let filtered = Array.isArray(records) ? records : [];

  if (entityType) {
    const et = String(entityType).toLowerCase();
    filtered = filtered.filter(
      (r) => String(r.accountType || '').toLowerCase() === et || String(r.metadata?.entityType || '').toLowerCase() === et
    );
  }

  if (channel && channel !== 'ALL') {
    const ch = String(channel).toUpperCase();
    filtered = filtered.filter((r) => String(r.channel || '').toUpperCase() === ch);
  }

  const total = filtered.length;
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const startIndex = (p - 1) * size;
  const items = filtered.slice(startIndex, startIndex + size);

  return {
    items,
    pagination: {
      total,
      page: p,
      pageSize: size,
      totalPages: Math.ceil(total / size) || 1,
    },
  };
}

module.exports = {
  renderActionCenterEmailHtml,
  dispatchActionCenterCommunication,
  getActionCenterCommunications,
};

