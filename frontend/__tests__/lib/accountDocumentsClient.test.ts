import {
  fetchAccountDocuments,
  uploadAccountDocument,
  deleteAccountDocument,
  requestBuyerCreditApproval,
  addSellerQuoteCredits,
} from '../../lib/accountDocumentsClient';
import { authClient } from '../../lib/authClient';

describe('accountDocumentsClient', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-token-xyz');
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  describe('fetchAccountDocuments', () => {
    it('handles auth token absent', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, documents: [] }),
      } as unknown as Response);

      await fetchAccountDocuments('buyer', 'b-notoken');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/buyer-accounts/b-notoken/documents',
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: expect.anything() }),
        })
      );
    });

    it('handles fallbacks for upload error, request error, and add credits error when error string is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false }),
      } as unknown as Response);

      const upRes = await uploadAccountDocument('buyer', 'b-1', { documentName: 'D', category: 'C' });
      expect(upRes.error).toBe('Failed to upload document.');

      const reqRes = await requestBuyerCreditApproval('b-1', { amount: 5, approverName: 'Srinu Sir', initiatorName: 'Govardhan' });
      expect(reqRes.error).toBe('Failed to submit credit approval request.');

      const addRes = await addSellerQuoteCredits('v-1', { amount: 1 });
      expect(addRes.error).toBe('Failed to add quote credits.');
    });

    it('fetches buyer documents with query parameters', async () => {
      const mockDocs = [{ id: 'doc-1', documentName: 'GST' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, documents: mockDocs }),
      } as unknown as Response);

      const docs = await fetchAccountDocuments('buyer', 'buyer-1', {
        category: 'GST',
        type: 'PDF',
        search: 'cert',
        sortOrder: 'asc',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/buyer-accounts/buyer-1/documents?category=GST&type=PDF&search=cert&sortOrder=asc'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-xyz',
          }),
        })
      );
      expect(docs).toEqual(mockDocs);
    });

    it('fetches seller documents with bare URL and ignores all/default filters', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, documents: [] }),
      } as unknown as Response);

      const docs = await fetchAccountDocuments('seller', 'seller-1', {
        category: 'all',
        type: 'All Types',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/seller-1/documents',
        expect.anything()
      );
      expect(docs).toEqual([]);
    });

    it('returns empty array when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      const docs = await fetchAccountDocuments('buyer', 'b-err');
      expect(docs).toEqual([]);
    });

    it('handles network throw gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const docs = await fetchAccountDocuments('seller', 's-err');
      expect(docs).toEqual([]);
    });
  });

  describe('uploadAccountDocument', () => {
    it('uploads buyer document successfully with json payload', async () => {
      const mockUploaded = { id: 'doc-123', documentName: 'Uploaded Doc' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, document: mockUploaded }),
      } as unknown as Response);

      const result = await uploadAccountDocument('buyer', 'buyer-1', {
        documentName: 'Uploaded Doc',
        category: 'Registration',
        description: 'Details',
        fileName: 'upload.pdf',
        fileSize: 5000,
        mimeType: 'application/pdf',
      });

      expect(result.success).toBe(true);
      expect(result.document).toEqual(mockUploaded);
    });

    it('uploads seller document using File object fallback properties', async () => {
      const mockFile = new File(['content'], 'seller_file.png', { type: 'image/png' });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, document: { id: 'seller-doc-1' } }),
      } as unknown as Response);

      const result = await uploadAccountDocument('seller', 'seller-1', {
        documentName: 'Image Doc',
        category: 'Other',
        file: mockFile,
      });

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/seller-1/documents',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('returns error when upload response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'File size exceeded' }),
      } as unknown as Response);

      const result = await uploadAccountDocument('buyer', 'buyer-1', {
        documentName: 'Large Doc',
        category: 'PAN',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('File size exceeded');
    });

    it('handles upload network throw', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Upload socket drop'));
      const result = await uploadAccountDocument('seller', 's-1', {
        documentName: 'Doc',
        category: 'Other',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Upload socket drop');
    });
  });

  describe('deleteAccountDocument', () => {
    it('deletes buyer document successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

      const result = await deleteAccountDocument('buyer', 'buyer-1', 'doc-123');
      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/buyer-accounts/buyer-1/documents/doc-123',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('deletes seller document with failure handling', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ success: false, error: 'Document not found' }),
      } as unknown as Response);

      const result = await deleteAccountDocument('seller', 's-1', 'doc-404');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Document not found');
    });

    it('handles delete network throw', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Delete timeout'));
      const result = await deleteAccountDocument('buyer', 'b-1', 'doc-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Delete timeout');
    });
  });

  describe('requestBuyerCreditApproval', () => {
    it('submits buyer credit approval request successfully', async () => {
      const mockTask = { id: 'TASK-101', status: 'Pending Approval' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Request submitted', task: mockTask }),
      } as unknown as Response);

      const result = await requestBuyerCreditApproval('buyer-1', {
        amount: 10,
        reason: 'Monthly allocation',
        approverName: 'Srinu Sir',
        initiatorName: 'Govardhan',
      });

      expect(result.success).toBe(true);
      expect(result.task).toEqual(mockTask);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/buyer-accounts/buyer-1/request-credit-approval',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('handles failure when server rejects credit request', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Invalid approver' }),
      } as unknown as Response);

      const result = await requestBuyerCreditApproval('buyer-1', {
        amount: 0,
        approverName: 'Unknown',
        initiatorName: 'Govardhan',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid approver');
    });

    it('handles network throw during credit request', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Server unavailable'));
      const result = await requestBuyerCreditApproval('buyer-1', {
        amount: 5,
        approverName: 'Sudheer Sir',
        initiatorName: 'Krishna',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Server unavailable');
    });
  });

  describe('addSellerQuoteCredits', () => {
    it('adds quote credits for seller successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: '3 credits added', updatedBalance: 8 }),
      } as unknown as Response);

      const result = await addSellerQuoteCredits('vendor-1', {
        amount: 3,
        reason: 'Manual extension',
      });

      expect(result.success).toBe(true);
      expect(result.updatedBalance).toBe(8);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/vendor-1/add-quote-credits',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('handles validation error when quote credits amount is out of range', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Amount must be between 1 and 5' }),
      } as unknown as Response);

      const result = await addSellerQuoteCredits('vendor-1', { amount: 6 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Amount must be between 1 and 5');
    });

    it('handles network throw when adding quote credits', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection reset'));
      const result = await addSellerQuoteCredits('vendor-1', { amount: 2 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection reset');
    });
  });
});
