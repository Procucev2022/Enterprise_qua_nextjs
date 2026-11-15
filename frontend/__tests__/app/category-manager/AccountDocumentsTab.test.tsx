import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AccountDocumentsTab, {
  formatFileSize,
  detectDocumentType,
  getFileIcon,
} from '@/app/category-manager/components/AccountDocumentsTab';
import * as accountDocsClient from '@/lib/accountDocumentsClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { AccountDocument } from '@/lib/types';

jest.mock('@/lib/accountDocumentsClient');

const DOCUMENT_STRINGS = UI_STRINGS.buyerDirectory.dossier.documents;
const LOAD_FAILURE =
  'Could not load account documents (HTTP 500). Try again in a moment.';

const mockDocs: AccountDocument[] = [
  {
    id: 'doc-1',
    accountType: 'buyer' as const,
    accountId: 'buyer-1',
    documentName: 'GST Registration Certificate',
    fileName: 'gst_certificate.pdf',
    fileSize: 1048576, // 1MB
    mimeType: 'application/pdf',
    category: 'GST',
    fileUrl: '/documents/gst.pdf',
    description: 'Statutory GSTIN copy',
    uploadedBy: 'Govardhan',
    uploadDate: '2026-05-15T10:00:00.000Z',
    isActive: true,
  },
  {
    id: 'doc-2',
    accountType: 'buyer' as const,
    accountId: 'buyer-1',
    documentName: 'Company Logo',
    fileName: 'logo.png',
    fileSize: 204800, // 200KB
    mimeType: 'image/png',
    category: 'Company Profile',
    fileUrl: '/documents/logo.png',
    description: 'High-res brand logo',
    uploadedBy: 'Veera Babu',
    uploadDate: '2026-05-16T12:00:00.000Z',
    isActive: true,
  },
  {
    id: 'doc-3',
    accountType: 'buyer' as const,
    accountId: 'buyer-1',
    documentName: 'Commercial Specs Spreadsheet',
    fileName: 'specs.xlsx',
    fileSize: 512,
    mimeType: 'application/vnd.ms-excel',
    category: 'RFQ',
    fileUrl: '/documents/specs.xlsx',
    description: 'Technical specs spreadsheet',
    uploadedBy: 'Krishna',
    uploadDate: '2026-05-17T14:00:00.000Z',
    isActive: true,
  },
  {
    id: 'doc-4',
    accountType: 'buyer' as const,
    accountId: 'buyer-1',
    documentName: 'Legal Memorandum',
    fileName: 'memo.docx',
    fileSize: 0,
    mimeType: 'application/msword',
    category: 'Other',
    fileUrl: '',
    description: '',
    uploadedBy: '',
    uploadDate: '',
    createdAt: '2026-05-18T10:00:00.000Z',
    isActive: true,
  },
];

describe('AccountDocumentsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatFileSize & detectDocumentType helpers', () => {
    it('formats file sizes accurately across boundaries', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(-10)).toBe(UI_STRINGS.dataLoad.emptyCell);
      expect(formatFileSize(undefined)).toBe(UI_STRINGS.dataLoad.emptyCell);
      expect(formatFileSize(null)).toBe(UI_STRINGS.dataLoad.emptyCell);
      expect(formatFileSize(Number.NaN)).toBe(UI_STRINGS.dataLoad.emptyCell);
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1048576)).toBe('1.00 MB');
      expect(formatFileSize(2621440)).toBe('2.50 MB');
    });

    it('detects document types from MIME and extensions', () => {
      expect(detectDocumentType('application/pdf', 'test.pdf')).toBe('PDF');
      expect(detectDocumentType('', 'sample.pdf')).toBe('PDF');
      expect(detectDocumentType('image/jpeg', 'photo.jpg')).toBe('Image');
      expect(detectDocumentType('', 'photo.svg')).toBe('Image');
      expect(detectDocumentType('application/vnd.ms-excel', 'data.xls')).toBe('Excel');
      expect(detectDocumentType('', 'data.csv')).toBe('Excel');
      expect(detectDocumentType('application/msword', 'doc.docx')).toBe('Word');
      expect(detectDocumentType('', 'doc.doc')).toBe('Word');
      expect(detectDocumentType('text/plain', 'note.txt')).toBe('Document');
      expect(detectDocumentType('', '')).toBe('Document');
    });

    it('renders appropriate icons for document formats', () => {
      expect(getFileIcon('application/pdf', 'file.pdf')).toBeDefined();
      expect(getFileIcon('', 'file.pdf')).toBeDefined();
      expect(getFileIcon('image/png', 'img.png')).toBeDefined();
      expect(getFileIcon('', 'img.webp')).toBeDefined();
      expect(getFileIcon('application/vnd.ms-excel', 'calc.xlsx')).toBeDefined();
      expect(getFileIcon('', 'calc.csv')).toBeDefined();
      expect(getFileIcon('application/msword', 'file.docx')).toBeDefined();
      expect(getFileIcon('', 'file.doc')).toBeDefined();
      expect(getFileIcon('application/octet-stream', 'bin.dat')).toBeDefined();
      expect(getFileIcon('', '')).toBeDefined();
    });
  });

  describe('Component Rendering & Interactions', () => {
    it('renders loading state and then documents list table', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });
      const onCountChange = jest.fn();

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
          onDocumentCountChange={onCountChange}
        />
      );

      expect(screen.getByText(DOCUMENT_STRINGS.loadingDocuments)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      expect(screen.getByText('Company Logo')).toBeInTheDocument();
      expect(screen.getByText('Commercial Specs Spreadsheet')).toBeInTheDocument();
      expect(screen.getByText('Legal Memorandum')).toBeInTheDocument();
      expect(onCountChange).toHaveBeenCalledWith(4);

      // A record without a file link shows no download action, and no uploader or category is invented.
      const legalRow = screen.getByText('Legal Memorandum').closest('tr') as HTMLElement;
      expect(within(legalRow).queryByTitle(DOCUMENT_STRINGS.actionDownload)).not.toBeInTheDocument();
      expect(within(legalRow).queryByText('Category Manager')).not.toBeInTheDocument();
      expect(within(legalRow).getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);
      expect(within(legalRow).getByText('0 B')).toBeInTheDocument();
    });

    it('renders empty state when no documents exist and opens upload modal', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: [] });

      render(
        <AccountDocumentsTab
          accountType="seller"
          accountId="seller-1"
          accountName="Acme Supplies"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(DOCUMENT_STRINGS.noDocuments)).toBeInTheDocument();
      });
      expect(
        screen.getByText(formatString(DOCUMENT_STRINGS.noAccountDocuments, { accountType: 'seller' }))
      ).toBeInTheDocument();

      // Click Upload from empty state
      const uploadButtons = screen.getAllByRole('button', { name: /Upload Document/i });
      fireEvent.click(uploadButtons[1]); // empty state button
      expect(screen.getByText('Upload Associated Document')).toBeInTheDocument();
    });

    it('shows the client error instead of an empty list, reports no count, and retries on demand', async () => {
      const onCountChange = jest.fn();
      const fetchSpy = jest.spyOn(accountDocsClient, 'fetchAccountDocuments')
        .mockResolvedValueOnce({ documents: [], error: LOAD_FAILURE })
        .mockResolvedValueOnce({ documents: mockDocs });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
          onDocumentCountChange={onCountChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(LOAD_FAILURE)).toBeInTheDocument();
      });
      expect(screen.queryByText(DOCUMENT_STRINGS.noDocuments)).not.toBeInTheDocument();
      expect(screen.queryByText('GST Registration Certificate')).not.toBeInTheDocument();
      // The total is a dash while the list is unavailable, never a zero.
      expect(screen.getByText(UI_STRINGS.dataLoad.emptyCell)).toBeInTheDocument();
      expect(onCountChange).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: DOCUMENT_STRINGS.retryBtn }));

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });
      expect(onCountChange).toHaveBeenCalledWith(4);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('shows a network message when the client call itself throws', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockRejectedValueOnce(new Error('Fetch failed'));

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(
          screen.getByText(
            formatString(UI_STRINGS.dataLoad.networkFailed, {
              resource: UI_STRINGS.dataLoad.resources.accountDocuments,
            })
          )
        ).toBeInTheDocument();
      });
    });

    it('handles search input, clear button, filters, and sort order toggle', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      // Search input
      const searchInput = screen.getByPlaceholderText('Search document name or description...');
      fireEvent.change(searchInput, { target: { value: 'logo' } });
      expect(searchInput).toHaveValue('logo');

      // Click clear search X icon
      const clearSearchBtn = screen.getByRole('button', { name: '' });
      fireEvent.click(clearSearchBtn);
      expect(searchInput).toHaveValue('');

      // Category filter
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: 'GST' } });

      // Document Type filter
      fireEvent.change(selects[1], { target: { value: 'PDF' } });

      // Sort Order toggle
      const sortBtn = screen.getByText('Newest First');
      fireEvent.click(sortBtn);
      expect(screen.getByText('Oldest First')).toBeInTheDocument();

      // Clear filters button
      const clearFiltersBtn = screen.getByText('Clear Filters');
      fireEvent.click(clearFiltersBtn);
      expect(searchInput).toHaveValue('');
    });

    it('handles document upload workflow with validation and submission', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });
      const uploadSpy = jest.spyOn(accountDocsClient, 'uploadAccountDocument').mockResolvedValue({
        success: true,
        document: {
          id: 'doc-new',
          accountType: 'buyer',
          accountId: 'buyer-1',
          documentName: 'New ISO Cert',
          fileName: 'iso.pdf',
          fileSize: 5000,
          mimeType: 'application/pdf',
          category: 'Registration',
          fileUrl: '/documents/iso.pdf',
          uploadedBy: 'Category Manager',
          uploadDate: new Date().toISOString(),
        },
      });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      // Open upload modal
      const openUploadBtns = screen.getAllByText('Upload Document');
      fireEvent.click(openUploadBtns[0]);

      const modal = screen.getByRole('dialog');
      expect(within(modal).getByText('Upload Associated Document')).toBeInTheDocument();

      // Select category
      const catSelect = within(modal).getByRole('combobox');
      fireEvent.change(catSelect, { target: { value: 'Registration' } });

      // Select file
      const fileInput = document.getElementById('doc-file-upload') as HTMLInputElement;
      const file = new File(['file contents'], 'iso.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      // Change doc name and description
      const nameInput = within(modal).getByPlaceholderText('e.g. GST Certificate 2026');
      fireEvent.change(nameInput, { target: { value: 'New ISO Cert' } });

      const descInput = within(modal).getByPlaceholderText('Additional context or notes for this document...');
      fireEvent.change(descInput, { target: { value: 'Uploaded during audit' } });

      // Submit inside modal
      const submitBtn = within(modal).getByRole('button', { name: /^Upload Document$/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(uploadSpy).toHaveBeenCalledWith(
          'buyer',
          'buyer-1',
          expect.objectContaining({
            documentName: 'New ISO Cert',
            category: 'Registration',
            description: 'Uploaded during audit',
          })
        );
      });
    });

    it('handles upload validation errors (empty name or file size limits >25MB)', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      // Open modal
      fireEvent.click(screen.getAllByText('Upload Document')[0]);
      const modal = screen.getByRole('dialog');

      // Empty name test
      const nameInput = within(modal).getByPlaceholderText('e.g. GST Certificate 2026');
      fireEvent.change(nameInput, { target: { value: '' } });
      const form = modal.querySelector('form') as HTMLFormElement;
      fireEvent.submit(form);
      expect(within(modal).getByText(DOCUMENT_STRINGS.uploadNameRequired)).toBeInTheDocument();

      // Name provided but no file selected
      fireEvent.change(nameInput, { target: { value: 'Valid Name' } });
      fireEvent.submit(form);
      expect(within(modal).getByText(DOCUMENT_STRINGS.uploadFileRequired)).toBeInTheDocument();

      // Empty target.files test
      const fileInput = document.getElementById('doc-file-upload') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: null } });

      // File change when name is already filled preserves name
      const validSmallFile = new File(['small'], 'cert.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [validSmallFile] } });
      expect(nameInput).toHaveValue('Valid Name');

      // File > 25MB
      const bigFile = new File(['x'.repeat(100)], 'huge.pdf', { type: 'application/pdf' });
      Object.defineProperty(bigFile, 'size', { value: 30 * 1024 * 1024 });

      fireEvent.change(fileInput, { target: { files: [bigFile] } });
      expect(within(modal).getByText(DOCUMENT_STRINGS.fileTooLarge)).toBeInTheDocument();

      // Cancel button inside modal
      fireEvent.click(within(modal).getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('handles upload rejection from server and network throw', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });
      jest.spyOn(accountDocsClient, 'uploadAccountDocument')
        .mockResolvedValueOnce({
          success: false,
          error: 'Duplicate document already exists.',
        })
        .mockRejectedValueOnce(new Error('Network drop'));

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      fireEvent.click(screen.getAllByText('Upload Document')[0]);
      const modal = screen.getByRole('dialog');

      const fileInput = document.getElementById('doc-file-upload') as HTMLInputElement;
      const file = new File(['data'], 'dup.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      const submitBtn = within(modal).getByRole('button', { name: /^Upload Document$/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(within(modal).getByText('Duplicate document already exists.')).toBeInTheDocument();
      });

      // Trigger second submit to hit network throw catch block
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(within(modal).getByText(DOCUMENT_STRINGS.toastUploadError)).toBeInTheDocument();
      });
    });

    it('opens and closes in-app document preview for PDF, Image, and Word/Excel', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      const previewBtns = screen.getAllByTitle('Preview');

      // 1. Preview PDF
      fireEvent.click(previewBtns[0]);
      let previewModal = screen.getByRole('dialog');
      expect(within(previewModal).getByTitle('GST Registration Certificate')).toBeInTheDocument();

      // Close preview with X button
      const closePreviewBtn = within(previewModal).getByRole('button', { name: '' });
      fireEvent.click(closePreviewBtn);

      // 2. Preview Image
      fireEvent.click(previewBtns[1]);
      previewModal = screen.getByRole('dialog');
      expect(within(previewModal).getByAltText('Company Logo')).toBeInTheDocument();
      fireEvent.click(within(previewModal).getByRole('button', { name: '' }));

      // 3. Preview Word/Excel/Unsupported file
      fireEvent.click(previewBtns[2]);
      previewModal = screen.getByRole('dialog');
      expect(within(previewModal).getByText(/In-app preview is not available for this file type/i)).toBeInTheDocument();
      fireEvent.click(within(previewModal).getByRole('button', { name: '' }));
    });

    it('handles delete confirmation modal, cancellation, and execution', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });
      const deleteSpy = jest.spyOn(accountDocsClient, 'deleteAccountDocument').mockResolvedValue({
        success: true,
      });

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      const deleteBtns = screen.getAllByTitle('Delete');
      fireEvent.click(deleteBtns[0]);

      let modal = screen.getByRole('dialog');
      expect(within(modal).getByRole('heading', { name: 'Delete Document' })).toBeInTheDocument();
      expect(within(modal).getByText(/Are you sure you want to delete GST Registration Certificate/i)).toBeInTheDocument();

      // Cancel delete
      fireEvent.click(within(modal).getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Confirm delete
      fireEvent.click(deleteBtns[0]);
      modal = screen.getByRole('dialog');
      const confirmDeleteBtn = within(modal).getByRole('button', { name: 'Delete Document' });
      fireEvent.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith('buyer', 'buyer-1', 'doc-1');
      });
    });

    it('handles delete rejection and network throw from server', async () => {
      jest.spyOn(accountDocsClient, 'fetchAccountDocuments').mockResolvedValue({ documents: mockDocs });
      jest.spyOn(accountDocsClient, 'deleteAccountDocument')
        .mockResolvedValueOnce({
          success: false,
          error: 'Permission denied to delete this document.',
        })
        .mockRejectedValueOnce(new Error('Delete connection timeout'));

      render(
        <AccountDocumentsTab
          accountType="buyer"
          accountId="buyer-1"
          accountName="Veera Babu Buyer Org"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('GST Registration Certificate')).toBeInTheDocument();
      });

      const deleteBtns = screen.getAllByTitle('Delete');
      fireEvent.click(deleteBtns[0]);

      let modal = screen.getByRole('dialog');
      fireEvent.click(within(modal).getByRole('button', { name: 'Delete Document' }));

      await waitFor(() => {
        expect(screen.getByText('Permission denied to delete this document.')).toBeInTheDocument();
      });

      // Second delete triggers network throw catch
      fireEvent.click(deleteBtns[0]);
      modal = screen.getByRole('dialog');
      fireEvent.click(within(modal).getByRole('button', { name: 'Delete Document' }));

      await waitFor(() => {
        expect(screen.getByText(DOCUMENT_STRINGS.toastDeleteError)).toBeInTheDocument();
      });
    });
  });
});
