// ==============================================================================
// ACCOUNT DOCUMENT CONTROLLER
// ==============================================================================
// REST API handlers for managing Buyer and Seller Dossier documents.
// The acting user is always the authenticated session (req.user). Request
// headers are never used as identity.
// ==============================================================================

const accountDocumentQueries = require('../db/accountDocumentQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { AUTH_MESSAGES, PERSISTENCE_MESSAGES } = require('../config/constants');
const { logger } = require('../services/loggerService');
const storeService = require('../services/storeService');
const pool = require('../db/pool');
const { assertCategoryManagerOrBuyer } = require('./buyerAccountController');
const { assertCategoryManagerOrVendor } = require('./vendorDossierExtensions');

/**
 * Builds the acting user from the authenticated session. Returns null when the
 * session does not identify a user.
 */
function extractActor(req) {
  const user = req.user;
  if (!user) return null;
  const actor = {
    uuid: user.uuid || user.id || user.sub || null,
    name: user.fullName || user.name || user.email || null,
    email: user.email || null,
    role: user.role || null,
  };
  return actor.uuid || actor.name ? actor : null;
}

/**
 * Returns the session actor, or sends 401 and returns null.
 */
function requireSessionActor(req, res) {
  const actor = extractActor(req);
  if (!actor) {
    res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    return null;
  }
  return actor;
}

function persistenceUnavailable(cause) {
  const error = new Error('Account document storage is unavailable.');
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  return error;
}

function sendAccountDocumentError(res, next, err) {
  if (err?.code === 'PERSISTENCE_UNAVAILABLE') {
    return res.status(503).json({
      success: false,
      error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      retryable: true,
    });
  }
  if (err?.code === 'WORKFLOW_DOCUMENT_NOT_DELETABLE') {
    return res.status(409).json({ success: false, error: err.message, retryable: false });
  }
  if (err?.code === 'VALIDATION_FAILED') {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err?.code === 'ACTOR_REQUIRED') {
    return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
  }
  return next(err);
}

async function findBuyerSafe(id, user) {
  let buyer = (storeService.getBuyerAccounts ? storeService.getBuyerAccounts() : []).find((b) => b.id === id);
  if (!buyer && pool.hasStorage()) {
    try {
      const res = await pool.query('SELECT id, is_active, raw FROM buyer_accounts WHERE id = $1', [id]);
      if (res?.rows?.[0]) {
        const row = res.rows[0];
        buyer = { id: row.id, ...(typeof row.raw === 'string' ? JSON.parse(row.raw) : (row.raw || {})) };
      }
    } catch (err) {
      // A failed lookup must not be reported as "buyer not found".
      logger.error('Failed to resolve buyer account from database', err, 'ACCOUNT_DOC_CONTROLLER');
      throw persistenceUnavailable(err);
    }
  }
  if (!buyer && user?.role === 'buyer' && user.email && storeService.getBuyerAccountByEmail) {
    buyer = await storeService.getBuyerAccountByEmail(user.email);
  }
  return buyer;
}

async function findVendorSafe(id) {
  let vendor = storeService.getVendorById ? storeService.getVendorById(id, 'all') : null;
  if (!vendor && storeService.getVendorByIdWithDBFallback) {
    try {
      vendor = await storeService.getVendorByIdWithDBFallback(id, 'all');
    } catch (err) {
      // A failed lookup must not be reported as "seller not found".
      logger.error('Failed to resolve seller from database', err, 'ACCOUNT_DOC_CONTROLLER');
      throw persistenceUnavailable(err);
    }
  }
  return vendor;
}

/**
 * GET /api/buyer-accounts/:id/documents
 */
async function getBuyerDocuments(req, res, next) {
  try {
    const { id } = req.params;
    const { category, type, search, sortOrder } = req.query || {};

    const buyer = await findBuyerSafe(id, req.user);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account "${id}" not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const documents = await accountDocumentQueries.listAccountDocuments({
      accountType: 'buyer',
      accountId: id,
      category,
      type,
      search,
      sortOrder: sortOrder || 'desc',
    });

    return res.json({
      success: true,
      documents,
      count: documents.length,
    });
  } catch (err) {
    logger.error('accountDocumentController: getBuyerDocuments failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

/**
 * POST /api/buyer-accounts/:id/documents
 */
async function uploadBuyerDocument(req, res, next) {
  try {
    const actor = requireSessionActor(req, res);
    if (!actor) return;

    const { id } = req.params;
    const buyer = await findBuyerSafe(id, req.user);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account "${id}" not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const validation = validatePayload(VALIDATION_SCHEMAS.accountDocumentUpload, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on document upload payload.',
        details: validation.errors,
      });
    }

    const document = await accountDocumentQueries.createAccountDocument(
      {
        ...validation.sanitizedData,
        accountType: 'buyer',
        accountId: id,
      },
      actor
    );

    logger.info(`Document "${document.documentName}" uploaded for buyer ${id}`, { actor: actor.email }, 'ACCOUNT_DOC_CONTROLLER');
    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
      document,
    });
  } catch (err) {
    logger.error('accountDocumentController: uploadBuyerDocument failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

/**
 * DELETE /api/buyer-accounts/:id/documents/:docId
 */
async function deleteBuyerDocument(req, res, next) {
  try {
    const actor = requireSessionActor(req, res);
    if (!actor) return;

    const { id, docId } = req.params;
    const buyer = await findBuyerSafe(id, req.user);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account "${id}" not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const deleted = await accountDocumentQueries.deleteAccountDocument(docId, 'buyer', id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Document "${docId}" not found for this account.` });
    }

    logger.info(`Document "${docId}" deleted for buyer ${id}`, { actor: actor.email }, 'ACCOUNT_DOC_CONTROLLER');
    return res.json({
      success: true,
      message: 'Document deleted successfully.',
    });
  } catch (err) {
    logger.error('accountDocumentController: deleteBuyerDocument failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

/**
 * GET /api/vendors/:id/documents
 */
async function getSellerDocuments(req, res, next) {
  try {
    const { id } = req.params;
    const { category, type, search, sortOrder } = req.query || {};

    const vendor = await findVendorSafe(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const documents = await accountDocumentQueries.listAccountDocuments({
      accountType: 'seller',
      accountId: id,
      category,
      type,
      search,
      sortOrder: sortOrder || 'desc',
    });

    return res.json({
      success: true,
      documents,
      count: documents.length,
    });
  } catch (err) {
    logger.error('accountDocumentController: getSellerDocuments failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

/**
 * POST /api/vendors/:id/documents
 */
async function uploadSellerDocument(req, res, next) {
  try {
    const actor = requireSessionActor(req, res);
    if (!actor) return;

    const { id } = req.params;
    const vendor = await findVendorSafe(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const validation = validatePayload(VALIDATION_SCHEMAS.accountDocumentUpload, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on document upload payload.',
        details: validation.errors,
      });
    }

    const document = await accountDocumentQueries.createAccountDocument(
      {
        ...validation.sanitizedData,
        accountType: 'seller',
        accountId: id,
      },
      actor
    );

    logger.info(`Document "${document.documentName}" uploaded for seller ${id}`, { actor: actor.email }, 'ACCOUNT_DOC_CONTROLLER');
    return res.status(201).json({
      success: true,
      message: 'Document uploaded successfully.',
      document,
    });
  } catch (err) {
    logger.error('accountDocumentController: uploadSellerDocument failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

/**
 * DELETE /api/vendors/:id/documents/:docId
 */
async function deleteSellerDocument(req, res, next) {
  try {
    const actor = requireSessionActor(req, res);
    if (!actor) return;

    const { id, docId } = req.params;
    const vendor = await findVendorSafe(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const deleted = await accountDocumentQueries.deleteAccountDocument(docId, 'seller', id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Document "${docId}" not found for this account.` });
    }

    logger.info(`Document "${docId}" deleted for seller ${id}`, { actor: actor.email }, 'ACCOUNT_DOC_CONTROLLER');
    return res.json({
      success: true,
      message: 'Document deleted successfully.',
    });
  } catch (err) {
    logger.error('accountDocumentController: deleteSellerDocument failed', err, 'ACCOUNT_DOC_CONTROLLER');
    sendAccountDocumentError(res, next, err);
  }
}

module.exports = {
  getBuyerDocuments,
  uploadBuyerDocument,
  deleteBuyerDocument,
  getSellerDocuments,
  uploadSellerDocument,
  deleteSellerDocument,
  extractActor,
  findBuyerSafe,
  findVendorSafe,
};
