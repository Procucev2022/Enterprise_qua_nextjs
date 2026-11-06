const documentVaultController = require('../src/controllers/documentVaultController');
const documentVaultQueries = require('../src/db/documentVaultQueries');
const { DOCUMENT_VAULT_MESSAGES } = require('../src/config/constants');

function mockResponse() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn().mockImplementation((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((data) => {
    res.body = data;
    return res;
  });
  return res;
}

describe('Document Vault Controller', () => {
  beforeEach(() => {
    documentVaultQueries.resetInMemoryStore();
    jest.clearAllMocks();
  });

  describe('listDocuments', () => {
    test('returns all documents with default 200', async () => {
      const req = { query: {} };
      const res = mockResponse();

      await documentVaultController.listDocuments(req, res);

      expect(res.json).toHaveBeenCalled();
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.documents)).toBe(true);
      expect(res.body.documents.length).toBeGreaterThan(0);
    });

    test('applies category, search, and activeOnly filters', async () => {
      const req = {
        query: {
          category: 'marketing_overview',
          search: 'Enterprise',
          activeOnly: 'true',
        },
      };
      const res = mockResponse();

      await documentVaultController.listDocuments(req, res);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    test('handles activeOnly as boolean true', async () => {
      const req = { query: { activeOnly: true } };
      const res = mockResponse();

      await documentVaultController.listDocuments(req, res);

      expect(res.body.success).toBe(true);
    });

    test('handles internal server error in listDocuments', async () => {
      const req = { query: {} };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'listDocuments').mockRejectedValueOnce(new Error('DB failure'));

      await documentVaultController.listDocuments(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve documents from vault');
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      const storageError = Object.assign(new Error('Database unavailable'), {
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      const req = { query: {} };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'listDocuments').mockRejectedValueOnce(storageError);

      await documentVaultController.listDocuments(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.body).toEqual({
        success: false,
        error: DOCUMENT_VAULT_MESSAGES.STORAGE_UNAVAILABLE,
        retryable: true,
      });
    });
  });

    test('passes source and accountType query parameters to query layer', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const req = { query: { source: 'buyer' } };
      const res = mockResponse();

      await documentVaultController.listDocuments(req, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'buyer' }));
      expect(res.body.success).toBe(true);

      const listSpy2 = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const req2 = { query: { accountType: 'seller' } };
      const res2 = mockResponse();

      await documentVaultController.listDocuments(req2, res2);

      expect(listSpy2).toHaveBeenCalledWith(expect.objectContaining({ source: 'seller' }));
      expect(res2.body.success).toBe(true);
    });

  describe('getSummary', () => {
    test('returns vault summary statistics', async () => {
      const req = {};
      const res = mockResponse();

      await documentVaultController.getSummary(req, res);

      expect(res.body.success).toBe(true);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.totalDocuments).toBeGreaterThan(0);
      expect(res.body.summary.categoriesCount).toBeGreaterThan(0);
    });

    test('handles internal server error in getSummary', async () => {
      const req = {};
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentVaultSummary').mockRejectedValueOnce(new Error('Summary error'));

      await documentVaultController.getSummary(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('getDocumentById', () => {
    test('retrieves an existing document by id', async () => {
      const req = { params: { id: 'doc_buyer_roi' } };
      const res = mockResponse();

      await documentVaultController.getDocumentById(req, res);

      expect(res.body.success).toBe(true);
      expect(res.body.document).toBeDefined();
      expect(res.body.document.id).toBe('doc_buyer_roi');
    });

    test('returns 404 when document not found', async () => {
      const req = { params: { id: 'non_existent_doc_id' } };
      const res = mockResponse();

      await documentVaultController.getDocumentById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Document not found');
    });

    test('handles internal server error in getDocumentById', async () => {
      const req = { params: { id: 'doc_buyer_roi' } };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentById').mockRejectedValueOnce(new Error('Fetch failure'));

      await documentVaultController.getDocumentById(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('createDocument', () => {
    test('rejects creation when documentName is missing', async () => {
      const req = { body: { fileName: 'file.pdf', category: 'marketing' } };
      const res = mockResponse();

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('Document name is required');
    });

    test('rejects creation when fileName is missing', async () => {
      const req = { body: { documentName: 'Doc', category: 'marketing' } };
      const res = mockResponse();

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('File name is required');
    });

    test('rejects creation when category is missing', async () => {
      const req = { body: { documentName: 'Doc', fileName: 'file.pdf' } };
      const res = mockResponse();

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('Category is required');
    });

    test('creates document with custom authenticated user info', async () => {
      const req = {
        user: { name: 'Sarah Commercial' },
        body: {
          documentName: 'Q1 Enterprise Sourcing Pitch',
          fileName: 'Enterprise_Pitch.pdf',
          category: 'marketing_overview',
          fileSize: 1024000,
          mimeType: 'application/pdf',
          fileUrl: '/uploads/pitch.pdf',
          description: 'Custom proposal deck',
          isActive: true,
        },
      };
      const res = mockResponse();

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document.documentName).toBe('Q1 Enterprise Sourcing Pitch');
      expect(res.body.document.uploadedBy).toBe('Sarah Commercial');
    });

    test('creates document with fallback actor when user object has corporateEmail or email or empty', async () => {
      const req = {
        user: { corporateEmail: 'corp@procucev.com' },
        body: {
          documentName: 'Rate Card Deck',
          fileName: 'rate_card.pdf',
          category: 'rate_cards',
        },
      };
      const res = mockResponse();

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.document.uploadedBy).toBe('corp@procucev.com');
      expect(res.body.document.fileUrl).toBe('/documents/rate_card.pdf');
    });

    test('handles internal server error in createDocument', async () => {
      const req = {
        body: {
          documentName: 'Error Doc',
          fileName: 'err.pdf',
          category: 'rate_cards',
        },
      };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'createDocument').mockRejectedValueOnce(new Error('Insert error'));

      await documentVaultController.createDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('updateDocument', () => {
    test('returns 404 if document does not exist', async () => {
      const req = { params: { id: 'unknown_doc' }, body: { documentName: 'New' } };
      const res = mockResponse();

      await documentVaultController.updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.error).toBe('Document not found');
    });

    test('updates document properties successfully', async () => {
      const req = {
        params: { id: 'doc_buyer_roi' },
        body: {
          documentName: 'Updated ROI Brochure 2026',
          isActive: false,
        },
      };
      const res = mockResponse();

      await documentVaultController.updateDocument(req, res);

      expect(res.body.success).toBe(true);
      expect(res.body.document.documentName).toBe('Updated ROI Brochure 2026');
      expect(res.body.document.isActive).toBe(false);
    });

    test('handles internal server error in updateDocument', async () => {
      const req = { params: { id: 'doc_buyer_roi' }, body: { documentName: 'Fail' } };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'updateDocument').mockRejectedValueOnce(new Error('Update failed'));

      await documentVaultController.updateDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('deleteDocument', () => {
    test('returns 404 when document to delete is not found', async () => {
      const req = { params: { id: 'non_existent_doc_to_delete' } };
      const res = mockResponse();

      await documentVaultController.deleteDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.error).toBe('Document not found or already deleted');
    });

    test('deletes document successfully', async () => {
      const req = { params: { id: 'doc_buyer_roi' } };
      const res = mockResponse();

      await documentVaultController.deleteDocument(req, res);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Document deleted successfully');

      // Verify it no longer exists
      const checkReq = { params: { id: 'doc_buyer_roi' } };
      const checkRes = mockResponse();
      await documentVaultController.getDocumentById(checkReq, checkRes);
      expect(checkRes.status).toHaveBeenCalledWith(404);
    });

    test('handles internal server error in deleteDocument', async () => {
      const req = { params: { id: 'doc_buyer_roi' } };
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'deleteDocument').mockRejectedValueOnce(new Error('Delete error'));

      await documentVaultController.deleteDocument(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
    });
  });
});

