// ==============================================================================
// ACCOUNT DOCUMENT CONTROLLER
// ==============================================================================
// REST API handlers for managing Buyer and Seller Dossier documents.
// ==============================================================================

const accountDocumentQueries = require('../db/accountDocumentQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');
const storeService = require('../services/storeService');
const pool = require('../db/pool');
const { assertCategoryManagerOrBuyer } = require('./buyerAccountController');
const { assertCategoryManagerOrVendor } = require('./vendorDossierExtensions');

function extractActor(req) {
  if (req.user) {
    return {
      uuid: req.user.uuid || req.user.id || null,
      name: req.user.fullName || req.user.name || req.user.email || 'Category Manager',
      email: req.user.email || null,
      role: req.user.role || 'category_manager',
    };
  }
  return {
    uuid: null,
    name: req.headers['x-user-name'] || 'Category Manager',
    email: req.headers['x-user-email'] || 'admin@procucev.com',
    role: 'category_manager',
  };
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
      logger.error('Failed to resolve buyer account from DB fallback', err, 'ACCOUNT_DOC_CONTROLLER');
    }
  }
  if (!buyer && user?.role === 'buyer' && user.email && storeService.getBuyerAccountByEmail) {
    buyer = await storeService.getBuyerAccountByEmail(user.email);
  }
  return buyer;
}

async function findVendorSafe(id, user) {
  try {
    let vendor = storeService.getVendorById ? storeService.getVendorById(id, 'all') : null;
    if (!vendor && storeService.getVendorByIdWithDBFallback) {
      vendor = await storeService.getVendorByIdWithDBFallback(id, 'all');
    }
    return vendor;
  } catch (err) {
    logger.error('Failed to resolve vendor from DB fallback', err, 'ACCOUNT_DOC_CONTROLLER');
    return null;
  }
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
    next(err);
  }
}

/**
 * POST /api/buyer-accounts/:id/documents
 */
async function uploadBuyerDocument(req, res, next) {
  try {
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

    const actor = extractActor(req);
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
    next(err);
  }
}

/**
 * DELETE /api/buyer-accounts/:id/documents/:docId
 */
async function deleteBuyerDocument(req, res, next) {
  try {
    const { id, docId } = req.params;
    const buyer = await findBuyerSafe(id, req.user);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account "${id}" not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const actor = extractActor(req);
    const deleted = await accountDocumentQueries.deleteAccountDocument(docId, 'buyer', id, actor);
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
    next(err);
  }
}

/**
 * GET /api/vendors/:id/documents
 */
async function getSellerDocuments(req, res, next) {
  try {
    const { id } = req.params;
    const { category, type, search, sortOrder } = req.query || {};

    const vendor = await findVendorSafe(id, req.user);
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
    next(err);
  }
}

/**
 * POST /api/vendors/:id/documents
 */
async function uploadSellerDocument(req, res, next) {
  try {
    const { id } = req.params;
    const vendor = await findVendorSafe(id, req.user);
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

    const actor = extractActor(req);
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
    next(err);
  }
}

/**
 * DELETE /api/vendors/:id/documents/:docId
 */
async function deleteSellerDocument(req, res, next) {
  try {
    const { id, docId } = req.params;
    const vendor = await findVendorSafe(id, req.user);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Seller "${id}" not found.` });
    }
    if (!assertCategoryManagerOrVendor(req, res, vendor)) return;

    const actor = extractActor(req);

    const deleted = await accountDocumentQueries.deleteAccountDocument(docId, 'seller', id, actor);
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
    next(err);
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
