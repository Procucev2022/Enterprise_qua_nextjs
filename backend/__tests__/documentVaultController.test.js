const documentVaultController = require('../src/controllers/documentVaultController');
const documentVaultQueries = require('../src/db/documentVaultQueries');
const { AUTH_MESSAGES, DOCUMENT_VAULT_MESSAGES } = require('../src/config/constants');

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

const sampleDocument = {
  id: 'doc_pg_101',
  documentName: 'PG Enterprise Pitch',
  fileName: 'pg_pitch.pdf',
  fileSize: 204800,
  mimeType: 'application/pdf',
  category: 'marketing_overview',
  fileUrl: '/documents/pg_pitch.pdf',
  description: 'SQL stored pitch deck',
  uploadedBy: 'Sarah Commercial',
  isActive: true,
  createdAt: '2026-02-01T12:00:00.000Z',
  updatedAt: '2026-02-01T12:00:00.000Z',
  accountType: 'vault',
  accountId: null,
};

function storageUnavailableError() {
  return Object.assign(new Error('Database unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' });
}

function expectRetryableStorageResponse(res) {
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.body).toEqual({
    success: false,
    error: DOCUMENT_VAULT_MESSAGES.STORAGE_UNAVAILABLE,
    retryable: true,
  });
}

describe('Document Vault Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('listDocuments', () => {
    test('returns the documents from the query layer', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([sampleDocument]);
      const res = mockResponse();

      await documentVaultController.listDocuments({ query: {} }, res);

      expect(listSpy).toHaveBeenCalledWith({ category: undefined, search: undefined, activeOnly: false, source: undefined });
      expect(res.status).not.toHaveBeenCalled();
      expect(res.body).toEqual({ success: true, documents: [sampleDocument] });
    });

    test('returns an empty list when the query layer finds nothing', async () => {
      jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res = mockResponse();

      await documentVaultController.listDocuments({ query: {} }, res);

      expect(res.body).toEqual({ success: true, documents: [] });
    });

    test('handles a request without a query object', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res = mockResponse();

      await documentVaultController.listDocuments({}, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: false }));
    });

    test('applies category, search, and activeOnly filters from the query string', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([sampleDocument]);
      const res = mockResponse();

      await documentVaultController.listDocuments({
        query: { category: 'marketing_overview', search: 'Enterprise', activeOnly: 'true' },
      }, res);

      expect(listSpy).toHaveBeenCalledWith({
        category: 'marketing_overview',
        search: 'Enterprise',
        activeOnly: true,
        source: undefined,
      });
      expect(res.body).toEqual({ success: true, documents: [sampleDocument] });
    });

    test('treats any activeOnly value other than "true" as false', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res = mockResponse();

      await documentVaultController.listDocuments({ query: { activeOnly: 'false' } }, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: false }));
    });

    test('handles activeOnly as boolean true', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res = mockResponse();

      await documentVaultController.listDocuments({ query: { activeOnly: true } }, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ activeOnly: true }));
      expect(res.body.success).toBe(true);
    });

    test('passes source and accountType query parameters to query layer', async () => {
      const listSpy = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res = mockResponse();

      await documentVaultController.listDocuments({ query: { source: 'buyer' } }, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'buyer' }));
      expect(res.body.success).toBe(true);

      const listSpy2 = jest.spyOn(documentVaultQueries, 'listDocuments').mockResolvedValueOnce([]);
      const res2 = mockResponse();

      await documentVaultController.listDocuments({ query: { accountType: 'seller' } }, res2);

      expect(listSpy2).toHaveBeenCalledWith(expect.objectContaining({ source: 'seller' }));
      expect(res2.body.success).toBe(true);
    });

    test('handles internal server error in listDocuments', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'listDocuments').mockRejectedValueOnce(new Error('DB failure'));

      await documentVaultController.listDocuments({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve documents from vault');
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'listDocuments').mockRejectedValueOnce(storageUnavailableError());

      await documentVaultController.listDocuments({ query: {} }, res);

      expectRetryableStorageResponse(res);
    });
  });

  describe('getSummary', () => {
    test('returns the vault summary from the query layer', async () => {
      const summary = {
        totalDocuments: 2,
        activeDocuments: 1,
        totalSizeBytes: 500,
        categoriesCount: 2,
        buyerDocuments: 1,
        sellerDocuments: 0,
        vaultDocuments: 1,
      };
      jest.spyOn(documentVaultQueries, 'getDocumentVaultSummary').mockResolvedValueOnce(summary);
      const res = mockResponse();

      await documentVaultController.getSummary({}, res);

      expect(res.body).toEqual({ success: true, summary });
    });

    test('handles internal server error in getSummary', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentVaultSummary').mockRejectedValueOnce(new Error('Summary error'));

      await documentVaultController.getSummary({}, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve vault summary');
    });

    test('returns a retryable service error instead of zero counts when storage is unavailable', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentVaultSummary').mockRejectedValueOnce(storageUnavailableError());

      await documentVaultController.getSummary({}, res);

      expectRetryableStorageResponse(res);
      expect(res.body.summary).toBeUndefined();
    });
  });

  describe('getDocumentById', () => {
    test('retrieves an existing document by id', async () => {
      const getSpy = jest.spyOn(documentVaultQueries, 'getDocumentById').mockResolvedValueOnce(sampleDocument);
      const res = mockResponse();

      await documentVaultController.getDocumentById({ params: { id: 'doc_pg_101' } }, res);

      expect(getSpy).toHaveBeenCalledWith('doc_pg_101');
      expect(res.body).toEqual({ success: true, document: sampleDocument });
    });

    test('returns 404 when document not found', async () => {
      jest.spyOn(documentVaultQueries, 'getDocumentById').mockResolvedValueOnce(null);
      const res = mockResponse();

      await documentVaultController.getDocumentById({ params: { id: 'non_existent_doc_id' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Document not found');
    });

    test('handles internal server error in getDocumentById', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentById').mockRejectedValueOnce(new Error('Fetch failure'));

      await documentVaultController.getDocumentById({ params: { id: 'doc_pg_101' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to retrieve document');
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      const res = mockResponse();
      jest.spyOn(documentVaultQueries, 'getDocumentById').mockRejectedValueOnce(storageUnavailableError());

      await documentVaultController.getDocumentById({ params: { id: 'doc_pg_101' } }, res);

      expectRetryableStorageResponse(res);
    });
  });

  describe('createDocument', () => {
    const user = { name: 'Sarah Commercial' };

    test('rejects the request when no authenticated user is attached', async () => {
      const createSpy = jest.spyOn(documentVaultQueries, 'createDocument');
      const res = mockResponse();

      await documentVaultController.createDocument({
        body: { documentName: 'Doc', fileName: 'file.pdf', category: 'marketing' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('rejects creation when documentName is missing', async () => {
      const res = mockResponse();

      await documentVaultController.createDocument({ user, body: { fileName: 'file.pdf', category: 'marketing' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('Document name is required');
    });

    test('rejects creation when documentName is only whitespace', async () => {
      const res = mockResponse();

      await documentVaultController.createDocument({
        user,
        body: { documentName: '   ', fileName: 'file.pdf', category: 'marketing' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('Document name is required');
    });

    test('rejects creation when fileName is missing', async () => {
      const res = mockResponse();

      await documentVaultController.createDocument({ user, body: { documentName: 'Doc', category: 'marketing' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('File name is required');
    });

    test('rejects creation when category is missing', async () => {
      const res = mockResponse();

      await documentVaultController.createDocument({ user, body: { documentName: 'Doc', fileName: 'file.pdf' } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe('Category is required');
    });

    test('creates the document with the authenticated user as the actor', async () => {
      const body = {
        documentName: 'Q1 Enterprise Sourcing Pitch',
        fileName: 'Enterprise_Pitch.pdf',
        category: 'marketing_overview',
        fileSize: 1024000,
        mimeType: 'application/pdf',
        fileUrl: '/uploads/pitch.pdf',
        description: 'Custom proposal deck',
        isActive: true,
      };
      const createSpy = jest.spyOn(documentVaultQueries, 'createDocument').mockResolvedValueOnce({
        ...sampleDocument,
        documentName: 'Q1 Enterprise Sourcing Pitch',
      });
      const res = mockResponse();

      await documentVaultController.createDocument({ user, body }, res);

      expect(createSpy).toHaveBeenCalledWith(body, user);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document.documentName).toBe('Q1 Enterprise Sourcing Pitch');
      expect(res.body.document.uploadedBy).toBe('Sarah Commercial');
    });

    test('passes a user that carries only a corporate email to the query layer as the actor', async () => {
      const corporateUser = { corporateEmail: 'corp@procucev.com' };
      const body = { documentName: 'Rate Card Deck', fileName: 'rate_card.pdf', category: 'rate_cards' };
      const createSpy = jest.spyOn(documentVaultQueries, 'createDocument').mockResolvedValueOnce({
        ...sampleDocument,
        uploadedBy: 'corp@procucev.com',
      });
      const res = mockResponse();

      await documentVaultController.createDocument({ user: corporateUser, body }, res);

      expect(createSpy).toHaveBeenCalledWith(body, corporateUser);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.body.document.uploadedBy).toBe('corp@procucev.com');
    });

    test('returns 401 when the query layer reports that no actor was supplied', async () => {
      jest.spyOn(documentVaultQueries, 'createDocument').mockRejectedValueOnce(Object.assign(
        new Error('A signed-in user is required to upload a document to the vault.'),
        { code: 'ACTOR_REQUIRED', statusCode: 401 }
      ));
      const res = mockResponse();

      await documentVaultController.createDocument({
        user,
        body: { documentName: 'Doc', fileName: 'file.pdf', category: 'rate_cards' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.body).toEqual({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    });

    test('returns 400 with the query layer validation message', async () => {
      jest.spyOn(documentVaultQueries, 'createDocument').mockRejectedValueOnce(Object.assign(
        new Error('Document category is required.'),
        { code: 'VALIDATION_FAILED' }
      ));
      const res = mockResponse();

      await documentVaultController.createDocument({
        user,
        body: { documentName: 'Doc', fileName: 'file.pdf', category: 'rate_cards' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body).toEqual({ success: false, error: 'Document category is required.' });
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      jest.spyOn(documentVaultQueries, 'createDocument').mockRejectedValueOnce(storageUnavailableError());
      const res = mockResponse();

      await documentVaultController.createDocument({
        user,
        body: { documentName: 'Doc', fileName: 'file.pdf', category: 'rate_cards' },
      }, res);

      expectRetryableStorageResponse(res);
    });

    test('handles internal server error in createDocument', async () => {
      jest.spyOn(documentVaultQueries, 'createDocument').mockRejectedValueOnce(new Error('Insert error'));
      const res = mockResponse();

      await documentVaultController.createDocument({
        user,
        body: { documentName: 'Error Doc', fileName: 'err.pdf', category: 'rate_cards' },
      }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to create document in vault');
    });
  });

  describe('updateDocument', () => {
    test('returns 404 if document does not exist', async () => {
      jest.spyOn(documentVaultQueries, 'updateDocument').mockResolvedValueOnce(null);
      const res = mockResponse();

      await documentVaultController.updateDocument({ params: { id: 'unknown_doc' }, body: { documentName: 'New' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.error).toBe('Document not found');
    });

    test('updates document properties successfully', async () => {
      const body = { documentName: 'Updated ROI Brochure 2026', isActive: false };
      const updateSpy = jest.spyOn(documentVaultQueries, 'updateDocument').mockResolvedValueOnce({
        ...sampleDocument,
        id: 'doc_buyer_roi',
        documentName: 'Updated ROI Brochure 2026',
        isActive: false,
      });
      const res = mockResponse();

      await documentVaultController.updateDocument({ params: { id: 'doc_buyer_roi' }, body }, res);

      expect(updateSpy).toHaveBeenCalledWith('doc_buyer_roi', body);
      expect(res.body.success).toBe(true);
      expect(res.body.document.documentName).toBe('Updated ROI Brochure 2026');
      expect(res.body.document.isActive).toBe(false);
    });

    test('handles internal server error in updateDocument', async () => {
      jest.spyOn(documentVaultQueries, 'updateDocument').mockRejectedValueOnce(new Error('Update failed'));
      const res = mockResponse();

      await documentVaultController.updateDocument({ params: { id: 'doc_buyer_roi' }, body: { documentName: 'Fail' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to update document');
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      jest.spyOn(documentVaultQueries, 'updateDocument').mockRejectedValueOnce(storageUnavailableError());
      const res = mockResponse();

      await documentVaultController.updateDocument({ params: { id: 'doc_buyer_roi' }, body: { documentName: 'X' } }, res);

      expectRetryableStorageResponse(res);
    });
  });

  describe('deleteDocument', () => {
    test('returns 404 when document to delete is not found', async () => {
      jest.spyOn(documentVaultQueries, 'deleteDocument').mockResolvedValueOnce(false);
      const res = mockResponse();

      await documentVaultController.deleteDocument({ params: { id: 'non_existent_doc_to_delete' } }, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.body.error).toBe('Document not found or already deleted');
    });

    test('deletes document successfully', async () => {
      const deleteSpy = jest.spyOn(documentVaultQueries, 'deleteDocument').mockResolvedValueOnce(true);
      const res = mockResponse();

      await documentVaultController.deleteDocument({ params: { id: 'doc_buyer_roi' } }, res);

      expect(deleteSpy).toHaveBeenCalledWith('doc_buyer_roi');
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Document deleted successfully');
    });

    test('handles internal server error in deleteDocument', async () => {
      jest.spyOn(documentVaultQueries, 'deleteDocument').mockRejectedValueOnce(new Error('Delete error'));
      const res = mockResponse();

      await documentVaultController.deleteDocument({ params: { id: 'doc_buyer_roi' } }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to delete document');
    });

    test('returns a retryable service error when configured storage is unavailable', async () => {
      jest.spyOn(documentVaultQueries, 'deleteDocument').mockRejectedValueOnce(storageUnavailableError());
      const res = mockResponse();

      await documentVaultController.deleteDocument({ params: { id: 'doc_buyer_roi' } }, res);

      expectRetryableStorageResponse(res);
    });
  });
});
