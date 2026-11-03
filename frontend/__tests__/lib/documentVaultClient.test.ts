import {
  fetchDocuments,
  fetchDocumentVaultSummary,
  createDocument,
  updateDocument,
  deleteDocument,
} from '@/lib/documentVaultClient';
import { authClient } from '@/lib/authClient';

describe('Document Vault Client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-jwt-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchDocuments', () => {
    test('fetches documents without query parameters and attaches auth header', async () => {
      const mockDocs = [{ id: 'doc_1', documentName: 'Brochure' }];
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: mockDocs }),
      } as unknown as Response);

      const result = await fetchDocuments();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/document-vault',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
          }),
        })
      );
      expect(result).toEqual(mockDocs);
    });

    test('fetches documents with category, search, and activeOnly filters', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] }),
      } as unknown as Response);

      await fetchDocuments({
        category: 'marketing_overview',
        search: 'Enterprise',
        activeOnly: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/document-vault?category=marketing_overview&search=Enterprise&activeOnly=true',
        expect.any(Object)
      );
    });

    test('ignores category "all"', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ documents: [] }),
      } as unknown as Response);

      await fetchDocuments({ category: 'all' });

      expect(global.fetch).toHaveBeenCalledWith('/api/document-vault', expect.any(Object));
    });

    test('throws structured error when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database query failed' }),
      } as unknown as Response);

      await expect(fetchDocuments()).rejects.toThrow('Database query failed');
    });

    test('throws fallback error when error response json parsing fails', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Parse error');
        },
      } as unknown as Response);

      await expect(fetchDocuments()).rejects.toThrow('Failed to fetch documents (502)');
    });
  });

  describe('fetchDocumentVaultSummary', () => {
    test('fetches summary metrics successfully', async () => {
      const mockSummary = {
        totalDocuments: 7,
        activeDocuments: 6,
        totalSizeBytes: 3500000,
        categoriesCount: 5,
      };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ summary: mockSummary }),
      } as unknown as Response);

      const result = await fetchDocumentVaultSummary();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/document-vault/summary',
        expect.any(Object)
      );
      expect(result).toEqual(mockSummary);
    });

    test('returns default zeroed summary when payload lacks summary', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as unknown as Response);

      const result = await fetchDocumentVaultSummary();
      expect(result).toEqual({
        totalDocuments: 0,
        activeDocuments: 0,
        totalSizeBytes: 0,
        categoriesCount: 0,
      });
    });

    test('throws structured error when summary fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Summary service unavailable' }),
      } as unknown as Response);

      await expect(fetchDocumentVaultSummary()).rejects.toThrow('Summary service unavailable');
    });

    test('throws fallback error when error body is not json', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error();
        },
      } as unknown as Response);

      await expect(fetchDocumentVaultSummary()).rejects.toThrow('Failed to fetch vault summary (503)');
    });
  });

  describe('createDocument', () => {
    test('creates document successfully and returns new item', async () => {
      const newDoc = { id: 'doc_new', documentName: 'ROI Guide' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ success: true, document: newDoc }),
      } as unknown as Response);

      const payload = {
        documentName: 'ROI Guide',
        fileName: 'guide.pdf',
        category: 'marketing_overview',
      };
      const res = await createDocument(payload);

      expect(res.success).toBe(true);
      expect(res.document).toEqual(newDoc);
    });

    test('returns error object when creation fails', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Document name is required' }),
      } as unknown as Response);

      const res = await createDocument({
        documentName: '',
        fileName: 'test.pdf',
        category: 'marketing_overview',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Document name is required');
    });
  });

  describe('updateDocument', () => {
    test('updates document successfully', async () => {
      const updated = { id: 'doc_1', documentName: 'Updated Guide' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, document: updated }),
      } as unknown as Response);

      const res = await updateDocument('doc_1', { documentName: 'Updated Guide' });

      expect(res.success).toBe(true);
      expect(res.document).toEqual(updated);
    });

    test('returns failure response on update error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Document not found' }),
      } as unknown as Response);

      const res = await updateDocument('invalid_id', { isActive: false });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Document not found');
    });
  });

  describe('deleteDocument', () => {
    test('deletes document successfully', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      const res = await deleteDocument('doc_to_delete');
      expect(res.success).toBe(true);
    });

    test('returns failure when deletion fails', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      } as unknown as Response);

      const res = await deleteDocument('invalid_id');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Not found');
    });

    test('handles unauthenticated requests and default fallback error strings across operations', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null);

      // fetchDocuments with null token and missing documents property
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as unknown as Response);
      const docs = await fetchDocuments();
      expect(docs).toEqual([]);

      // createDocument with failing json parse
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('JSON error');
        },
      } as unknown as Response);
      const createRes = await createDocument({ documentName: 'A', fileName: 'a.pdf', category: 'templates' });
      expect(createRes.success).toBe(false);
      expect(createRes.error).toContain('Failed to create document (500)');

      // updateDocument with empty json error
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response);
      const updateRes = await updateDocument('doc_1', { documentName: 'B' });
      expect(updateRes.success).toBe(false);
      expect(updateRes.error).toContain('Failed to update document (500)');

      // updateDocument with failing json parse
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Parse error');
        },
      } as unknown as Response);
      const updateRes2 = await updateDocument('doc_1', { documentName: 'C' });
      expect(updateRes2.success).toBe(false);

      // deleteDocument with empty json error
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response);
      const deleteRes = await deleteDocument('doc_1');
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toContain('Failed to delete document (500)');

      // deleteDocument with failing json parse
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('Parse error');
        },
      } as unknown as Response);
      const deleteRes2 = await deleteDocument('doc_1');
      expect(deleteRes2.success).toBe(false);
    });
  });
});
