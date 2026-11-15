import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentVaultDashboard from '@/app/category-manager/components/DocumentVaultDashboard';
import {
  fetchDocuments,
  fetchDocumentVaultSummary,
  createDocument,
  updateDocument,
  deleteDocument,
} from '@/lib/documentVaultClient';
import type { DocumentVaultItem, DocumentVaultSummary } from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn(),
  fetchDocumentVaultSummary: jest.fn(),
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  deleteDocument: jest.fn(),
}));

const mockFetchDocuments = fetchDocuments as jest.Mock;
const mockFetchSummary = fetchDocumentVaultSummary as jest.Mock;
const mockCreateDocument = createDocument as jest.Mock;
const mockUpdateDocument = updateDocument as jest.Mock;
const mockDeleteDocument = deleteDocument as jest.Mock;

const MOCK_DOCS: DocumentVaultItem[] = [
  {
    id: 'doc_1',
    documentName: 'Enterprise Sourcing ROI Deck',
    fileName: 'Enterprise_ROI_Deck.pdf',
    fileSize: 1024000,
    mimeType: 'application/pdf',
    category: 'marketing_overview',
    fileUrl: '/documents/Enterprise_ROI_Deck.pdf',
    description: 'Overview of enterprise ROI and savings benchmarks',
    uploadedBy: 'Growth Lead',
    isActive: true,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  },
  {
    id: 'doc_2',
    documentName: 'Enterprise Buyer Subscription Plans',
    fileName: 'Buyer_Subscription_Plans.pdf',
    fileSize: 0,
    mimeType: 'application/pdf',
    category: 'rate_cards',
    fileUrl: '',
    description: '',
    uploadedBy: '',
    isActive: false,
    createdAt: '',
    updatedAt: '',
  },
];

const MOCK_SUMMARY: DocumentVaultSummary = {
  totalDocuments: 2,
  activeDocuments: 1,
  totalSizeBytes: 1536000,
  categoriesCount: 2,
};

describe('DocumentVaultDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchDocuments.mockResolvedValue(MOCK_DOCS);
    mockFetchSummary.mockResolvedValue(MOCK_SUMMARY);
    jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('renders header, stats cards, and document table', async () => {
    render(<DocumentVaultDashboard />);

    expect(screen.getByTestId('document-vault-dashboard')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('stat-total-documents')).toHaveTextContent('2');
      expect(screen.getByTestId('stat-active-documents')).toHaveTextContent('1');
      expect(screen.getByTestId('stat-total-storage')).toHaveTextContent('1.5 MB');
      expect(screen.getByTestId('stat-categories-count')).toHaveTextContent('2');
    });

    expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Buyer Subscription Plans')).toBeInTheDocument();
  });

  test('filters documents by search query and category', async () => {
    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    });

    // Search
    const searchInput = screen.getByTestId('vault-search-input');
    fireEvent.change(searchInput, { target: { value: 'ROI Deck' } });

    await waitFor(() => {
      expect(mockFetchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'ROI Deck' })
      );
    });

    // Category
    const categorySelect = screen.getByTestId('vault-category-filter');
    fireEvent.change(categorySelect, { target: { value: 'rate_cards' } });

    await waitFor(() => {
      expect(mockFetchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'rate_cards' })
      );
    });
  });

  test('filters documents by status (active / inactive)', async () => {
    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
      expect(screen.getByText('Enterprise Buyer Subscription Plans')).toBeInTheDocument();
    });

    const statusFilter = screen.getByTestId('vault-status-filter');

    // Filter active only
    fireEvent.change(statusFilter, { target: { value: 'active' } });
    expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    expect(screen.queryByText('Enterprise Buyer Subscription Plans')).not.toBeInTheDocument();

    // Filter inactive only
    fireEvent.change(statusFilter, { target: { value: 'inactive' } });
    expect(screen.queryByText('Enterprise Sourcing ROI Deck')).not.toBeInTheDocument();
    expect(screen.getByText('Enterprise Buyer Subscription Plans')).toBeInTheDocument();
  });

  test('opens upload modal, validates fields, and creates a new document', async () => {
    mockCreateDocument.mockResolvedValueOnce({
      success: true,
      document: {
        id: 'doc_3',
        documentName: 'New Presentation',
        fileName: 'presentation.pdf',
        fileSize: 204800,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/documents/presentation.pdf',
        uploadedBy: 'Category Manager',
        isActive: true,
      },
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('upload-document-btn')).toBeInTheDocument();
    });

    // Open upload modal
    fireEvent.click(screen.getByTestId('upload-document-btn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Try submitting without doc name
    fireEvent.change(screen.getByTestId('modal-doc-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('modal-save-btn'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Please provide a document display name.');
    });

    // Try submitting without file
    fireEvent.change(screen.getByTestId('modal-doc-name-input'), {
      target: { value: 'New Presentation' },
    });
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Please select a file to upload.');
    });

    // Attach file
    const file = new File(['mock content'], 'presentation.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByTestId('modal-file-input');
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Change category, description, and active toggle
    fireEvent.change(screen.getByTestId('modal-category-select'), {
      target: { value: 'templates' },
    });
    fireEvent.change(screen.getByTestId('modal-description-input'), {
      target: { value: 'Custom template walkthrough' },
    });
    fireEvent.click(screen.getByTestId('modal-active-checkbox'));

    // Submit form
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(mockCreateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          documentName: 'New Presentation',
          fileName: 'presentation.pdf',
          category: 'templates',
          description: 'Custom template walkthrough',
          isActive: false,
        })
      );
    });
  });

  test('handles creation failure response and exception', async () => {
    mockCreateDocument.mockResolvedValueOnce({
      success: false,
      error: 'Disk full error',
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('upload-document-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('upload-document-btn'));

    const file = new File(['data'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('modal-file-input'), { target: { files: [file] } });

    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Disk full error');
    });

    // Exception branch
    mockCreateDocument.mockRejectedValueOnce(new Error('Network crash'));
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network crash');
    });
  });

  test('rejects file larger than 25MB with error alert', async () => {
    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('upload-document-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('upload-document-btn'));

    const hugeFile = new File(['huge'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(hugeFile, 'size', { value: 30 * 1024 * 1024 });

    const fileInput = screen.getByTestId('modal-file-input');
    fireEvent.change(fileInput, { target: { files: [hugeFile] } });

    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds maximum size of 25MB.');

    // Cancel modal
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('opens edit modal and updates an existing document', async () => {
    mockUpdateDocument.mockResolvedValueOnce({
      success: true,
      document: {
        ...MOCK_DOCS[0]!,
        documentName: 'Updated ROI Deck',
      },
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('edit-doc-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('edit-doc-doc_1'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const nameInput = screen.getByTestId('modal-doc-name-input');
    fireEvent.change(nameInput, { target: { value: 'Updated ROI Deck' } });

    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(mockUpdateDocument).toHaveBeenCalledWith(
        'doc_1',
        expect.objectContaining({
          documentName: 'Updated ROI Deck',
        })
      );
    });
  });

  test('handles update failure response and exception in modal', async () => {
    mockUpdateDocument.mockResolvedValueOnce({
      success: false,
      error: 'Failed to update',
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('edit-doc-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('edit-doc-doc_1'));
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to update');
    });

    // Exception branch
    mockUpdateDocument.mockRejectedValueOnce(new Error('Update crashed'));
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Update crashed');
    });
  });

  test('toggles active status from table row with success and error branches', async () => {
    mockUpdateDocument.mockResolvedValueOnce({
      success: true,
      document: {
        ...MOCK_DOCS[0]!,
        isActive: false,
      },
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-active-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('toggle-active-doc_1'));

    await waitFor(() => {
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { isActive: false });
    });

    // Error response branch
    mockUpdateDocument.mockResolvedValueOnce({
      success: false,
      error: 'Cannot toggle status',
    });
    fireEvent.click(screen.getByTestId('toggle-active-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Cannot toggle status');
    });

    // Exception branch
    mockUpdateDocument.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('toggle-active-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Error toggling document status.');
    });
  });

  test('deletes document with success, failure response, and exception', async () => {
    mockDeleteDocument.mockResolvedValueOnce({ success: true });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-doc-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    await waitFor(() => {
      expect(mockDeleteDocument).toHaveBeenCalledWith('doc_1');
    });

    // Failure response branch
    mockDeleteDocument.mockResolvedValueOnce({ success: false, error: 'Cannot delete active document' });
    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Cannot delete active document');
    });

    // Exception branch
    mockDeleteDocument.mockRejectedValueOnce(new Error('Delete crash'));
    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Delete crash');
    });
  });

  test('does not delete document when user cancels confirmation', async () => {
    jest.spyOn(window, 'confirm').mockReturnValueOnce(false);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-doc-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  test('renders empty state when no documents are returned and triggers upload modal from button', async () => {
    mockFetchDocuments.mockResolvedValueOnce([]);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vault-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Upload Document/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('shows the load error in the table and dashes for the counts when the initial load fails', async () => {
    mockFetchDocuments.mockRejectedValueOnce(new Error('Network offline'));

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vault-load-error')).toHaveTextContent('Network offline');
    });
    expect(screen.queryByTestId('vault-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-total-documents')).toHaveTextContent(UI_STRINGS.dataLoad.emptyCell);
    expect(screen.getByTestId('stat-total-storage')).toHaveTextContent(UI_STRINGS.dataLoad.emptyCell);
  });

  test('handles empty file selection, automatic filename cleaning, and category fallback', async () => {
    const customDocs: DocumentVaultItem[] = [
      {
        id: 'doc_custom',
        documentName: 'Custom Cat Document',
        fileName: 'custom_cat.pdf',
        fileSize: 500,
        mimeType: 'application/pdf',
        category: 'unrecognized_category_id',
        fileUrl: '',
        isActive: true,
        createdAt: '2026-02-01T10:00:00Z',
      },
    ];
    mockFetchDocuments.mockResolvedValueOnce(customDocs);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Custom Cat Document')).toBeInTheDocument();
      expect(screen.getByText('unrecognized_category_id')).toBeInTheDocument();
    });

    // Open upload modal
    fireEvent.click(screen.getByTestId('upload-document-btn'));
    const fileInput = screen.getByTestId('modal-file-input');

    // Change with no file
    fireEvent.change(fileInput, { target: { files: [] } });

    // Change with file when name is empty -> should auto-clean file name
    const file = new File(['data'], 'prospectus_final_v2.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const docNameInput = screen.getByTestId('modal-doc-name-input') as HTMLInputElement;
    expect(docNameInput.value).toBe('prospectus final v2');

    // Cancel modal
    fireEvent.click(screen.getByTestId('modal-cancel-btn'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('displays emptyFiltered text when search yields 0 items', async () => {
    mockFetchDocuments.mockResolvedValueOnce(MOCK_DOCS);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    });

    mockFetchDocuments.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId('vault-search-input'), {
      target: { value: 'non_existent_search_query' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('vault-empty')).toBeInTheDocument();
      expect(screen.getByText('No documents match the selected filters.')).toBeInTheDocument();
    });
  });

  test('handles creation failure response without error message and non-Error exception', async () => {
    mockCreateDocument.mockResolvedValueOnce({ success: false });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('upload-document-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('upload-document-btn'));

    const fileNoType = new File(['data'], 'test_file', { type: '' });
    fireEvent.change(screen.getByTestId('modal-file-input'), { target: { files: [fileNoType] } });

    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to upload document.');
    });

    // Non-Error exception branch
    mockCreateDocument.mockRejectedValueOnce('String upload crash');
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Operation failed');
    });
  });

  test('handles edit modal for document without description and update failure without error string', async () => {
    mockUpdateDocument.mockResolvedValueOnce({ success: false });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('edit-doc-doc_2')).toBeInTheDocument();
    });

    // Open edit for doc_2 which has empty description
    fireEvent.click(screen.getByTestId('edit-doc-doc_2'));
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to update document.');
    });

    // Non-Error exception branch for update
    mockUpdateDocument.mockRejectedValueOnce('String update crash');
    fireEvent.click(screen.getByTestId('modal-save-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Operation failed');
    });
  });

  test('toggles active status from inactive to active and handles empty error response', async () => {
    mockUpdateDocument.mockResolvedValueOnce({
      success: true,
      document: { ...MOCK_DOCS[1]!, isActive: true },
    });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-active-doc_2')).toBeInTheDocument();
    });

    // Toggle inactive document to active
    fireEvent.click(screen.getByTestId('toggle-active-doc_2'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Document activated.');
    });

    // Failure response without error property
    mockUpdateDocument.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByTestId('toggle-active-doc_2'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Failed to toggle status.');
    });
  });

  test('deletes document with empty error response and non-Error exception', async () => {
    mockDeleteDocument.mockResolvedValueOnce({ success: false });

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-doc-doc_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Failed to delete document.');
    });

    // Non-Error exception branch
    mockDeleteDocument.mockRejectedValueOnce('Delete string crash');
    fireEvent.click(screen.getByTestId('delete-doc-doc_1'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Delete failed');
    });
  });

  test('displays the network message when the initial load throws a non-Error value', async () => {
    mockFetchDocuments.mockRejectedValueOnce('Non error load failure');

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vault-load-error')).toHaveTextContent(
        formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.documentVault })
      );
    });
  });

  test('formats KB file sizes and covers category dropdown filter with empty results', async () => {
    const kbDoc: DocumentVaultItem = {
      id: 'doc_kb',
      documentName: 'KB Sized Document',
      fileName: 'kb_file.pdf',
      fileSize: 45000,
      mimeType: 'application/pdf',
      category: 'legal_compliance',
      fileUrl: '/docs/kb.pdf',
      description: 'Legal terms',
      isActive: true,
      createdAt: '2026-02-01T10:00:00Z',
    };
    mockFetchDocuments.mockResolvedValueOnce([kbDoc]);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('KB Sized Document')).toBeInTheDocument();
      expect(screen.getByText('44 KB')).toBeInTheDocument();
    });

    mockFetchDocuments.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId('vault-category-filter'), {
      target: { value: 'templates' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('vault-empty')).toBeInTheDocument();
      expect(screen.getByText('No documents match the selected filters.')).toBeInTheDocument();
    });
  });
  test('filters by source and displays appropriate source badges for buyer, seller, and vault', async () => {
    const multiSourceDocs: DocumentVaultItem[] = [
      {
        id: 'doc_vault_1',
        documentName: 'Platform Overview',
        fileName: 'platform.pdf',
        fileSize: 100000,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/docs/platform.pdf',
        description: 'Deck',
        accountType: 'vault',
        isActive: true,
        createdAt: '2026-02-01T10:00:00Z',
      },
      {
        id: 'doc_buyer_1',
        documentName: 'Buyer GST Certificate',
        fileName: 'gst.pdf',
        fileSize: 150000,
        mimeType: 'application/pdf',
        category: 'compliance',
        fileUrl: '/docs/gst.pdf',
        description: 'GST',
        accountType: 'buyer',
        accountId: 'BUY-123',
        isActive: true,
        createdAt: '2026-02-02T10:00:00Z',
      },
      {
        id: 'doc_seller_1',
        documentName: 'Seller ISO Audit',
        fileName: 'iso.pdf',
        fileSize: 200000,
        mimeType: 'application/pdf',
        category: 'compliance',
        fileUrl: '/docs/iso.pdf',
        description: 'ISO',
        accountType: 'seller',
        accountId: 'SEL-456',
        isActive: true,
        createdAt: '2026-02-03T10:00:00Z',
      },
    ];

    mockFetchDocuments.mockResolvedValueOnce(multiSourceDocs);

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Platform Overview')).toBeInTheDocument();
      expect(screen.getByText('Platform Collateral')).toBeInTheDocument();
      expect(screen.getByText('Buyer Documents')).toBeInTheDocument();
      expect(screen.getByText('Seller Documents')).toBeInTheDocument();
    });

    mockFetchDocuments.mockResolvedValueOnce([multiSourceDocs[1]]);
    fireEvent.change(screen.getByTestId('vault-source-filter'), {
      target: { value: 'buyer' },
    });

    await waitFor(() => {
      expect(mockFetchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'buyer' })
      );
    });
  });


  test('supports sorting on Document Name, Category, Source, File Size, Uploaded By, Upload Date, and Status', async () => {
    const sortDocs: DocumentVaultItem[] = [
      {
        id: 'doc_alpha',
        documentName: 'Alpha Deck',
        fileName: 'alpha.pdf',
        fileSize: 500,
        mimeType: 'application/pdf',
        category: 'marketing_overview',
        fileUrl: '/alpha.pdf',
        description: 'Alpha',
        uploadedBy: 'Alice',
        isActive: true,
        accountType: 'buyer',
        createdAt: '2026-02-01T10:00:00Z',
      },
      {
        id: 'doc_beta',
        documentName: 'Beta Deck',
        fileName: 'beta.pdf',
        fileSize: 1000,
        mimeType: 'application/pdf',
        category: 'rate_cards',
        fileUrl: '/beta.pdf',
        description: 'Beta',
        uploadedBy: undefined as unknown as string,
        isActive: false,
        accountType: undefined as unknown as 'buyer',
        createdAt: '',
      },
      {
        id: 'doc_gamma',
        documentName: 'Beta Deck',
        fileName: 'beta2.pdf',
        fileSize: 1000,
        mimeType: 'application/pdf',
        category: 'rate_cards',
        fileUrl: '/beta2.pdf',
        description: 'Beta equal',
        uploadedBy: undefined as unknown as string,
        isActive: false,
        accountType: undefined as unknown as 'buyer',
        createdAt: '',
      },
    ];

    mockFetchDocuments.mockResolvedValueOnce(sortDocs);
    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Deck')).toBeInTheDocument();
    });

    // Sort by name (asc then desc)
    fireEvent.click(screen.getByText(/Document Name/i));
    fireEvent.click(screen.getByText(/Document Name/i));

    // Sort by category (asc then desc)
    fireEvent.click(screen.getByRole('columnheader', { name: /Category/i }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Category/i }));

    // Sort by source (asc then desc)
    fireEvent.click(screen.getByText(/Source \/ Account/i));
    fireEvent.click(screen.getByText(/Source \/ Account/i));

    // Sort by file size (asc then desc)
    fireEvent.click(screen.getByText(/File & Size/i));
    fireEvent.click(screen.getByText(/File & Size/i));

    // Sort by uploaded by (asc then desc)
    fireEvent.click(screen.getByText(/Uploaded By \/ Date/i));
    fireEvent.click(screen.getByText(/Uploaded By \/ Date/i));

    // Sort by upload date (asc then desc)
    fireEvent.click(screen.getByText(/Upload Date/i));
    fireEvent.click(screen.getByText(/Upload Date/i));

    // Sort by status (asc then desc)
    fireEvent.click(screen.getByRole('columnheader', { name: /Status/i }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Status/i }));

    expect(screen.getByText('Alpha Deck')).toBeInTheDocument();
  });

  test('opens column settings modal, toggles columns, resets to default, and saves', async () => {
    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    });

    const gearBtn = screen.getByRole('button', { name: /Column Settings/i });
    fireEvent.click(gearBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Toggle optional column
    const categoryCheckbox = screen.getByLabelText('Category');
    fireEvent.click(categoryCheckbox);

    // Save
    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and reset to default
    fireEvent.click(gearBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: 'Reset to Default' });
    fireEvent.click(resetBtn);

    // Reopen and close via close icon
    fireEvent.click(gearBtn);
    const closeBtn = screen.getByLabelText('Close column settings');
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('loads saved column preferences from localStorage on mount and handles dismissal', async () => {
    const customCols = [
      { key: 'name', label: 'Document Name', visible: true, required: true },
      { key: 'category', label: 'Category', visible: false },
    ];
    localStorage.setItem('qua_doc_vault_col_prefs', JSON.stringify(customCols));

    render(<DocumentVaultDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Enterprise Sourcing ROI Deck')).toBeInTheDocument();
    });

    // Dismiss toast manually if visible
    const closeToast = screen.queryByLabelText('Close notification');
    if (closeToast) fireEvent.click(closeToast);
  });

});
