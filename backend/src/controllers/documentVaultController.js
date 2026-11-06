// ==============================================================================
// DOCUMENT VAULT CONTROLLER
// ==============================================================================
// Exposes API handlers for enterprise collateral management, commercial email
// attachment repository, and document analytics.
// ==============================================================================

const documentVaultQueries = require('../db/documentVaultQueries');
const { logger } = require('../services/loggerService');
const { DOCUMENT_VAULT_MESSAGES } = require('../config/constants');

function sendControllerError(res, err, fallbackMessage) {
  if (err?.code === 'PERSISTENCE_UNAVAILABLE') {
    return res.status(503).json({
      success: false,
      error: DOCUMENT_VAULT_MESSAGES.STORAGE_UNAVAILABLE,
      retryable: true,
    });
  }

  return res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * List documents with optional category, search, and active status filters.
 */
async function listDocuments(req, res) {
  try {
    const { category, search, activeOnly } = req.query || {};
    const isActiveOnly = activeOnly === 'true' || activeOnly === true;

    const documents = await documentVaultQueries.listDocuments({
      category,
      search,
      activeOnly: isActiveOnly,
    });

    return res.json({
      success: true,
      documents,
    });
  } catch (err) {
    logger.error('documentVaultController: listDocuments failed', { error: err });
    return sendControllerError(res, err, 'Failed to retrieve documents from vault');
  }
}

/**
 * Return summary metrics for document vault.
 */
async function getSummary(req, res) {
  try {
    const summary = await documentVaultQueries.getDocumentVaultSummary();
    return res.json({
      success: true,
      summary,
    });
  } catch (err) {
    logger.error('documentVaultController: getSummary failed', { error: err });
    return sendControllerError(res, err, 'Failed to retrieve vault summary');
  }
}

/**
 * Retrieve a single document by ID.
 */
async function getDocumentById(req, res) {
  try {
    const { id } = req.params;
    const document = await documentVaultQueries.getDocumentById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    return res.json({
      success: true,
      document,
    });
  } catch (err) {
    logger.error('documentVaultController: getDocumentById failed', { error: err, id: req.params?.id });
    return sendControllerError(res, err, 'Failed to retrieve document');
  }
}

/**
 * Create/upload new document into the vault.
 */
async function createDocument(req, res) {
  try {
    const { documentName, fileName, category } = req.body || {};

    if (!documentName || !documentName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Document name is required',
      });
    }

    if (!fileName || !fileName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'File name is required',
      });
    }

    if (!category || !category.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Category is required',
      });
    }

    const document = await documentVaultQueries.createDocument(req.body, req.user);

    return res.status(201).json({
      success: true,
      document,
    });
  } catch (err) {
    logger.error('documentVaultController: createDocument failed', { error: err });
    return sendControllerError(res, err, 'Failed to create document in vault');
  }
}

/**
 * Update document metadata or toggle active state.
 */
async function updateDocument(req, res) {
  try {
    const { id } = req.params;
    const document = await documentVaultQueries.updateDocument(id, req.body);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    return res.json({
      success: true,
      document,
    });
  } catch (err) {
    logger.error('documentVaultController: updateDocument failed', { error: err, id: req.params?.id });
    return sendControllerError(res, err, 'Failed to update document');
  }
}

/**
 * Delete document from vault.
 */
async function deleteDocument(req, res) {
  try {
    const { id } = req.params;
    const deleted = await documentVaultQueries.deleteDocument(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Document not found or already deleted',
      });
    }

    return res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (err) {
    logger.error('documentVaultController: deleteDocument failed', { error: err, id: req.params?.id });
    return sendControllerError(res, err, 'Failed to delete document');
  }
}

module.exports = {
  listDocuments,
  getSummary,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
};
