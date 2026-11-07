const express = require('express');
const router = express.Router();
const documentVaultController = require('../controllers/documentVaultController');
const { authenticate, requireRole } = require('../middleware/auth');

const requireVaultAccess = [authenticate, requireRole('admin', 'category_manager')];

// GET /api/document-vault/summary - Summary KPI metrics
router.get('/summary', ...requireVaultAccess, documentVaultController.getSummary);

// GET /api/document-vault - List documents with filters
router.get('/', ...requireVaultAccess, documentVaultController.listDocuments);

// GET /api/document-vault/:id - Get single document by ID
router.get('/:id', ...requireVaultAccess, documentVaultController.getDocumentById);

// POST /api/document-vault - Create new document (Authorized Staff only)
router.post(
  '/',
  ...requireVaultAccess,
  documentVaultController.createDocument
);

// PUT /api/document-vault/:id - Update document (Authorized Staff only)
router.put(
  '/:id',
  ...requireVaultAccess,
  documentVaultController.updateDocument
);

// DELETE /api/document-vault/:id - Delete document (Authorized Staff only)
router.delete(
  '/:id',
  ...requireVaultAccess,
  documentVaultController.deleteDocument
);

module.exports = router;
