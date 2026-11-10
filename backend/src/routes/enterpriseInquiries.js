const express = require('express');
const router = express.Router();
const enterpriseInquiryQueries = require('../db/enterpriseInquiryQueries');
const { authenticate, requireRole } = require('../middleware/auth');
const { logger } = require('../services/loggerService');
const eventOutboxService = require('../services/eventOutboxService');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');

const INQUIRY_MANAGEMENT_ACCESS = [authenticate, requireRole('category_manager', 'admin')];

function sendPersistenceUnavailable(res, error) {
  if (error?.code !== 'PERSISTENCE_UNAVAILABLE') return false;
  return res.status(503).json({
    success: false,
    retryable: true,
    error: 'Enterprise inquiry storage is temporarily unavailable. Please retry shortly.',
  });
}

async function dispatchInquiryEmailsBestEffort(inquiry) {
  try {
    const result = await eventOutboxService.dispatchDueEventOutboxJobs();
    if (result.retried > 0 || result.dead > 0) {
      logger.warn('Enterprise inquiry email delivery remains in the durable retry queue', {
        inquiryId: inquiry.id,
        claimed: result.claimed,
        completed: result.completed,
        retried: result.retried,
        dead: result.dead,
      }, 'ENTERPRISE_INQUIRIES');
    }
  } catch (error) {
    logger.error('Enterprise inquiry email dispatch could not start; scheduled outbox recovery will retry it', {
      error,
      inquiryId: inquiry.id,
    }, 'ENTERPRISE_INQUIRIES');
  }
}

/**
 * POST /api/enterprise-inquiries
 * Public lead intake. The server does not trust a client-supplied buyer account ID.
 */
router.post('/', async (req, res, next) => {
  const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
  const validation = validatePayload(VALIDATION_SCHEMAS.createEnterpriseInquiry, requestBody);
  const rawIdempotencyKey = req.get('Idempotency-Key');
  const idempotencyValidation = rawIdempotencyKey === undefined
    ? { isValid: true, errors: {}, sanitizedData: {} }
    : validatePayload(VALIDATION_SCHEMAS.enterpriseInquiryIdempotencyKey, {
        idempotencyKey: rawIdempotencyKey,
      });
  if (!validation.isValid || !idempotencyValidation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Enterprise inquiry details are invalid. Correct the highlighted fields and retry.',
      details: { ...validation.errors, ...idempotencyValidation.errors },
    });
  }

  try {
    const result = await enterpriseInquiryQueries.createEnterpriseInquiry({
      companyName: validation.sanitizedData.companyName,
      email: validation.sanitizedData.email,
      mobile: validation.sanitizedData.mobile,
      notes: validation.sanitizedData.notes || '',
      ...(idempotencyValidation.sanitizedData.idempotencyKey
        ? { idempotencyKey: idempotencyValidation.sanitizedData.idempotencyKey }
        : {}),
    });
    const { inquiry, created } = result;

    logger.info('New enterprise contract inquiry received', {
      inquiryId: inquiry.id,
      operation: created ? 'create' : 'idempotent-retry',
    }, 'ENTERPRISE_INQUIRIES');

    if (created) {
      await dispatchInquiryEmailsBestEffort(inquiry);
    }

    return res.status(201).json({
      success: true,
      message: 'Enterprise contract inquiry submitted successfully.',
      data: inquiry,
    });
  } catch (error) {
    logger.error('Enterprise inquiry submission failed', { error, operation: 'create' }, 'ENTERPRISE_INQUIRIES');
    if (sendPersistenceUnavailable(res, error)) return undefined;
    return next(error);
  }
});

/** GET /api/enterprise-inquiries — category manager and admin oversight. */
router.get('/', ...INQUIRY_MANAGEMENT_ACCESS, async (req, res, next) => {
  const rawLimit = req.query?.limit === undefined ? {} : { limit: req.query.limit };
  const validation = validatePayload(VALIDATION_SCHEMAS.listEnterpriseInquiries, rawLimit);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Limit must be a whole number between 1 and 500.',
      details: validation.errors,
    });
  }

  try {
    const inquiries = await enterpriseInquiryQueries.getEnterpriseInquiries(validation.sanitizedData.limit || 100);
    return res.json({ success: true, data: inquiries, total: inquiries.length });
  } catch (error) {
    logger.error('Enterprise inquiry database read failed', { error, operation: 'list' }, 'ENTERPRISE_INQUIRIES');
    if (sendPersistenceUnavailable(res, error)) return undefined;
    return next(error);
  }
});

/** PATCH /api/enterprise-inquiries/:id — category manager and admin updates. */
router.patch('/:id', ...INQUIRY_MANAGEMENT_ACCESS, async (req, res, next) => {
  const idValidation = validatePayload(VALIDATION_SCHEMAS.enterpriseInquiryId, { id: req.params.id });
  const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
  const updateValidation = validatePayload(VALIDATION_SCHEMAS.updateEnterpriseInquiry, requestBody);
  if (!idValidation.isValid || !updateValidation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Enterprise inquiry update is invalid. Correct the highlighted fields and retry.',
      details: { ...idValidation.errors, ...updateValidation.errors },
    });
  }

  const { status, notes } = updateValidation.sanitizedData;
  if (status === undefined && notes === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Provide a status or notes update.',
      details: { updates: 'At least one editable field is required.' },
    });
  }

  try {
    const updated = await enterpriseInquiryQueries.updateEnterpriseInquiry(idValidation.sanitizedData.id, {
      ...(status !== undefined ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      contactedBy: req.user.name || req.user.email || 'Category Manager',
      contactedAt: new Date().toISOString(),
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Enterprise inquiry not found.' });
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Enterprise inquiry database update failed', {
      error,
      inquiryId: idValidation.sanitizedData.id,
      operation: 'update',
    }, 'ENTERPRISE_INQUIRIES');
    if (sendPersistenceUnavailable(res, error)) return undefined;
    return next(error);
  }
});

module.exports = router;
