const express = require('express');
const router = express.Router();
const documentVaultController = require('../controllers/documentVaultController');
const { authenticate, optionalAuthenticate, requireRole } = require('../middleware/auth');

// GET /api/document-vault/summary - Summary KPI metrics
router.get('/summary', optionalAuthenticate, documentVaultController.getSummary);

// GET /api/document-vault - List documents with filters
router.get('/', optionalAuthenticate, documentVaultController.listDocuments);

// GET /api/document-vault/:id - Get single document by ID
router.get('/:id', optionalAuthenticate, documentVaultController.getDocumentById);

// POST /api/document-vault - Create new document (Authorized Staff only)
router.post(
  '/',
  authenticate,
  requireRole('admin', 'category_manager'),
  documentVaultController.createDocument
);

// PUT /api/document-vault/:id - Update document (Authorized Staff only)
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'category_manager'),
  documentVaultController.updateDocument
);

// DELETE /api/document-vault/:id - Delete document (Authorized Staff only)
router.delete(
  '/:id',
  authenticate,
  requireRole('admin', 'category_manager'),
  documentVaultController.deleteDocument
);

module.exports = router;
