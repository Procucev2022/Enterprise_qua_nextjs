/**
 * Controller for Qua AI Transactional Email Templates
 * Handles listing, previewing, and sending of all 13 standard transactional email templates.
 */

const transactionalEmailTemplates = require('../services/transactionalEmailTemplates');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');
const { TRANSACTIONAL_EMAIL_MESSAGES, formatMessage } = require('../config/constants');
const { logger } = require('../services/loggerService');

const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Returns the distinct {placeholder} names in a template string, in order of first appearance.
 */
function extractPlaceholderNames(template) {
  const names = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Finds the catalog entry for a canonical template key. Returns undefined when there is none.
 */
function findCatalogEntry(canonicalKey) {
  return transactionalEmailTemplates
    .getAllTransactionalEmailTemplates()
    .find((entry) => entry.templateId === canonicalKey);
}

/**
 * Lists metadata for all 13 Qua AI Transactional Email Templates.
 */
async function listTemplates(req, res, next) {
  try {
    const templates = transactionalEmailTemplates.getAllTransactionalEmailTemplates();
    logger.info('Listing all transactional email templates', { count: templates.length }, 'TRANSACTIONAL_EMAIL_CONTROLLER');
    return res.json({
      success: true,
      data: templates,
      total: templates.length,
    });
  } catch (err) {
    logger.error('Failed to list transactional email templates', err, 'TRANSACTIONAL_EMAIL_CONTROLLER');
    return next(err);
  }
}

/**
 * Returns catalog metadata for a specific template. Nothing is rendered, so no placeholder gets a made-up value.
 */
async function getTemplateById(req, res, next) {
  try {
    const { id } = req.params;
    const canonicalKey = transactionalEmailTemplates.resolveTemplateKey(id);
    const catalogEntry = findCatalogEntry(canonicalKey);

    if (!catalogEntry) {
      logger.warn(`Template not found: ${id}`, { id }, 'TRANSACTIONAL_EMAIL_CONTROLLER');
      return res.status(404).json({
        success: false,
        error: `Transactional Email Template '${id}' not found. Valid IDs: 1 to 13.`,
      });
    }

    logger.info(`Fetched transactional email template metadata for ${id}`, { canonicalKey }, 'TRANSACTIONAL_EMAIL_CONTROLLER');

    return res.json({
      success: true,
      data: {
        templateId: catalogEntry.templateId,
        templateNumber: catalogEntry.number,
        name: catalogEntry.name,
        who: catalogEntry.who,
        trigger: catalogEntry.trigger,
        // `subject` keeps its existing field name. Its value is the catalog subject template, not a rendered subject.
        subject: catalogEntry.subjectPattern,
        subjectPlaceholders: extractPlaceholderNames(catalogEntry.subjectPattern),
      },
    });
  } catch (err) {
    logger.error(`Error retrieving template ${req.params.id}`, err, 'TRANSACTIONAL_EMAIL_CONTROLLER');
    return next(err);
  }
}

/**
 * Previews a transactional email template with custom parameters.
 */
async function previewTemplate(req, res, next) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.transactionalEmailPreview, req.body);
    if (!validation.isValid) {
      logger.warn('Invalid transactional email preview request', validation.errors, 'TRANSACTIONAL_EMAIL_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Validation failed for email preview.',
        details: validation.errors,
      });
    }

    const { templateId, params } = req.body;
    const canonicalKey = transactionalEmailTemplates.resolveTemplateKey(templateId);

    if (!canonicalKey) {
      logger.warn(`Invalid template ID in preview: ${templateId}`, { templateId }, 'TRANSACTIONAL_EMAIL_CONTROLLER');
      return res.status(404).json({
        success: false,
        error: `Transactional Email Template '${templateId}' not found. Valid IDs: 1 to 13.`,
      });
    }

    const rendered = transactionalEmailTemplates.renderTransactionalEmail(canonicalKey, params || {});
    logger.info(`Generated preview for email template: ${canonicalKey}`, { templateId: canonicalKey }, 'TRANSACTIONAL_EMAIL_CONTROLLER');

    return res.json({
      success: true,
      data: rendered,
    });
  } catch (err) {
    logger.error('Failed to preview transactional email template', err, 'TRANSACTIONAL_EMAIL_CONTROLLER');
    return next(err);
  }
}

/**
 * Sends a transactional email template to a specified recipient.
 */
async function sendTemplate(req, res, next) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.transactionalEmailSend, req.body);
    if (!validation.isValid) {
      logger.warn('Invalid transactional email send request', validation.errors, 'TRANSACTIONAL_EMAIL_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Validation failed for email send request.',
        details: validation.errors,
      });
    }

    const { templateId, recipientEmail, params, options } = req.body;
    const canonicalKey = transactionalEmailTemplates.resolveTemplateKey(templateId);

    if (!canonicalKey) {
      logger.warn(`Invalid template ID in send: ${templateId}`, { templateId }, 'TRANSACTIONAL_EMAIL_CONTROLLER');
      return res.status(404).json({
        success: false,
        error: `Transactional Email Template '${templateId}' not found. Valid IDs: 1 to 13.`,
      });
    }

    const result = await transactionalEmailTemplates.sendTransactionalEmail(canonicalKey, recipientEmail, params || {}, options || {});
    logger.info(`Dispatched transactional email template ${canonicalKey} to ${recipientEmail}`, {
      templateId: canonicalKey,
      recipientEmail,
      sent: result.sent,
    }, 'TRANSACTIONAL_EMAIL_CONTROLLER');

    // success is true only when the email provider accepted the message. The message text
    // says the same, so a skipped or failed send is never reported as processed.
    const accepted = result.success === true;
    return res.json({
      success: accepted,
      message: formatMessage(
        accepted ? TRANSACTIONAL_EMAIL_MESSAGES.ACCEPTED : TRANSACTIONAL_EMAIL_MESSAGES.NOT_SENT,
        { templateId: canonicalKey, status: result.status || 'unknown' }
      ),
      result,
    });
  } catch (err) {
    logger.error('Failed to send transactional email template', err, 'TRANSACTIONAL_EMAIL_CONTROLLER');
    return next(err);
  }
}


module.exports = {
  listTemplates,
  getTemplateById,
  previewTemplate,
  sendTemplate,
};
