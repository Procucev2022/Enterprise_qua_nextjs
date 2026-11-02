/**
 * Action Center Notification & Communication Service
 * Handles unified SMS & Email dispatch, audit logging, and task activity creation.
 */

const { logger } = require('./loggerService');
const mailerService = require('./mailerService');
const smsService = require('./smsService');
const paymentDuesQueries = require('../db/paymentDuesQueries');
const internalTaskQueries = require('../db/internalTaskQueries');

/**
 * Escapes HTML characters in user-provided content to prevent HTML/XSS injection.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates and sanitizes destination URLs to permitted HTTP/HTTPS protocols.
 */
function sanitizeActionUrl(rawUrl, fallbackUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return fallbackUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Malformed URL, use safe fallback
  }
  return fallbackUrl;
}

/**
 * Renders standard responsive HTML email template for Action Center alerts.
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
  const safeActionUrl = sanitizeActionUrl(linkUrl, `${defaultFrontend}/category-manager/internal-tasks`);
  const safeRecipient = escapeHtml(recipientName);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message);
  const safeSender = escapeHtml(senderName);
  const safeFormattedEntity = escapeHtml(String(entityType).replace(/_/g, ' ').toUpperCase());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
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
      <img src="${escapeHtml(logoUrl)}" alt="Procucev Enterprise" />
    </div>
    <div class="content">
      <div class="badge">${safeFormattedEntity} ALERT</div>
      <h1 class="title">${safeSubject}</h1>
      <p style="font-size: 14px; color: #334155;">Dear <strong>${safeRecipient}</strong>,</p>
      <div class="message-box">${safeMessage}</div>
      <div class="btn-container">
        <a href="${escapeHtml(safeActionUrl)}" class="btn" target="_blank" rel="noopener noreferrer">View in Action Center</a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
        Sent by: <strong>${safeSender}</strong> &bull; Procucev Enterprise Action Center
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
 */
async function dispatchActionCenterCommunication(payload, actor = {}) {
  const {
    entityType = 'internal_task',
    entityId,
    channel = 'EMAIL',
    recipientEmail,
    recipientPhone,
    recipientName = 'Partner',
    subject = 'Action Center Notification',
    message = '',
    linkUrl = '',
    notes = '',
    scheduleFollowup = null,
    metadata = {},
  } = payload;

  const senderName = actor.name || actor.email || 'Category Manager';
  const senderEmail = actor.email || 'category.manager@procucev.com';
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
        const isSent = Boolean(
          deliverRes?.sent === true ||
          deliverRes?.success === true ||
          (deliverRes && deliverRes.sent !== false && !deliverRes.reason && !deliverRes.error)
        );
        results.email = {
          success: isSent,
          messageId: deliverRes?.messageId || null,
          error: isSent ? undefined : (deliverRes?.reason || deliverRes?.error || 'Email was not sent.'),
          dispatchedAt: new Date().toISOString(),
          recipient: recipientEmail,
        };
      } else {
        results.email = { success: true, mock: true, recipient: recipientEmail };
      }

      logger.info(
        `[ACTION_CENTER] Dispatched email communication to ${recipientEmail} for ${entityType} ${entityId}`,
        { entityType, entityId, recipientEmail, success: results.email.success },
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
        messageId: smsRes.messageId || null,
        recipient: recipientPhone,
        throttled: Boolean(smsRes.throttled),
        error: smsRes.error || (smsRes.success ? undefined : 'SMS delivery failed.'),
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
  const emailOk = shouldSendEmail ? Boolean(results.email?.success) : false;
  const smsOk = shouldSendSms ? Boolean(results.sms?.success) : false;

  let overallSuccess = false;
  let partialSuccess = false;

  if (shouldSendEmail && shouldSendSms) {
    overallSuccess = emailOk && smsOk;
    partialSuccess = (emailOk || smsOk) && !overallSuccess;
  } else if (shouldSendEmail) {
    overallSuccess = emailOk;
  } else if (shouldSendSms) {
    overallSuccess = smsOk;
  } else {
    overallSuccess = true;
  }

  const deliveryStatus = overallSuccess ? 'Sent' : partialSuccess ? 'Partial' : 'Failed';

  // 4. Persist communication record
  const primaryRecipient =
    channelUpper === 'SMS'
      ? (recipientPhone || recipientName || recipientEmail)
      : (recipientEmail || recipientPhone || recipientName);
  const record = await paymentDuesQueries.recordCommunication({
    accountId: entityId,
    accountType: entityType,
    channel: channelUpper,
    recipient: primaryRecipient,
    subject,
    message,
    notificationStatus: overallSuccess ? 'Notification Sent' : 'Failed',
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
      gatewayMessageId: results.sms?.messageId || results.email?.messageId || null,
      dispatchedSmsText: results.sms?.renderedMessage || null,
      isSmsTruncated: Boolean(results.sms?.isTruncated),
      linkUrl,
    },
  });

  // 5. Create completed activity log task
  let completedTask = null;
  try {
    const channelLabel = channelUpper === 'BOTH' ? 'Email & SMS' : channelUpper;
    completedTask = await internalTaskQueries.createInternalTask(
      {
        title: `[${channelLabel} Dispatched] ${subject || recipientName}`,
        description: `Notification dispatched to ${primaryRecipient}.\nMessage: ${message}`,
        category: 'COMMUNICATION',
        priority: 'Low',
        status: 'Completed',
        assignedToUserId: actor.id || null,
        assignedToName: senderName,
        assignedTeam: 'Category Management',
        dueDate: new Date().toISOString(),
        relatedEntityType: String(entityType).toUpperCase(),
        relatedEntityId: entityId,
        relatedEntityLabel: recipientName || entityId,
        notes: `Recipient: ${primaryRecipient} | Channel: ${channelUpper} | Delivery: ${deliveryStatus}`,
        metadata: {
          entityType,
          entityId,
          channel: channelUpper,
          communicationId: record?.id || null,
          deliveryStatus,
          emailResult: results.email,
          smsResult: results.sms,
        },
      },
      actor
    );
  } catch (taskErr) {
    logger.warn('Failed to record completed activity task for communication', { error: taskErr.message }, 'ACTION_CENTER_COMM');
  }

  // 6. Optionally schedule follow-up internal task
  let followupTask = null;
  let followupError = null;
  if (scheduleFollowup && scheduleFollowup.dueDate) {
    try {
      followupTask = await internalTaskQueries.createInternalTask(
        {
          title: scheduleFollowup.title || `[Follow-up] ${subject || recipientName}`,
          description: scheduleFollowup.notes || (message ? `Follow-up on ${channelUpper} sent to ${primaryRecipient}.\nOriginal message: ${message}` : 'Follow up on communication dispatch.'),
          category: 'FOLLOW_UP',
          priority: scheduleFollowup.priority || 'Medium',
          status: 'Pending',
          assignedToUserId: scheduleFollowup.assigneeId || actor.id || null,
          assignedToName: scheduleFollowup.assigneeName || senderName,
          assignedTeam: 'Category Management',
          dueDate: scheduleFollowup.dueDate,
          relatedEntityType: String(entityType).toUpperCase(),
          relatedEntityId: entityId,
          relatedEntityLabel: recipientName || entityId,
          notes: scheduleFollowup.notes || `Scheduled follow-up for communication #${record?.id || ''}`,
          metadata: {
            entityType,
            entityId,
            sourceCommunicationId: record?.id || null,
            scheduledBy: senderEmail,
          },
        },
        actor
      );
    } catch (folErr) {
      followupError = folErr.message;
      logger.warn('Failed to schedule follow-up task for communication', { error: folErr.message }, 'ACTION_CENTER_COMM');
    }
  }

  return {
    success: overallSuccess,
    partialSuccess,
    communication: record,
    emailResult: results.email,
    smsResult: results.sms,
    completedTask,
    followupTask,
    followupError,
  };
}

/**
 * Retrieves communications history for an entity or across all entities.
 */
async function getActionCenterCommunications(filter = {}) {
  const { entityId, entityType, channel, page = 1, pageSize = 20 } = filter;
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (p - 1) * size;

  const result = await paymentDuesQueries.queryCommunications({
    accountId: entityId || '',
    entityType,
    channel,
    limit: size,
    offset,
    isCrossAccount: !entityId,
  });

  const total = Number(result?.total || 0);

  return {
    items: result?.items || [],
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
  escapeHtml,
  sanitizeActionUrl,
};
