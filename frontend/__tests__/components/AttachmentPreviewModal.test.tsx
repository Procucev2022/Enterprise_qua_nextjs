import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AttachmentPreviewModal from '@/app/components/AttachmentPreviewModal';
import { formatFileSize } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { AttachmentPreviewState, RFQAttachment } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

function makeAttachment(overrides: Partial<RFQAttachment> = {}): RFQAttachment {
  return {
    id: 'att-1',
    fileName: 'smaple rfq email.eml',
    mimeType: 'message/rfc822',
    size: 7782,
    uploadedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  };
}

function makePreview(overrides: Partial<AttachmentPreviewState> = {}): AttachmentPreviewState {
  const file = overrides.file || makeAttachment();
  return {
    file,
    status: 'ready',
    previewKind: 'email',
    resolvedMime: file.mimeType,
    objectUrl: 'blob:preview-1',
    textContent: null,
    emailPreview: {
      subject: 'RFQ for Business Laptops',
      from: 'buyer@acme.in',
      to: 'rfq@procucev.ai',
      cc: 'ops@acme.in',
      date: '14 Nov 2026',
      body: 'Please share quote for 20 laptops.',
      embeddedAttachments: ['specs.pdf'],
      raw: 'Subject: RFQ for Business Laptops\n\nPlease share quote for 20 laptops.',
    },
    errorMessage: null,
    ...overrides,
  };
}

describe('AttachmentPreviewModal', () => {
  test('renders nothing when preview is null', () => {
    const { container } = render(
      <AttachmentPreviewModal preview={null} onClose={jest.fn()} onRetry={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders loading state and invokes onClose when closed', () => {
    const onClose = jest.fn();
    render(
      <AttachmentPreviewModal
        preview={makePreview({ status: 'loading', objectUrl: null })}
        onClose={onClose}
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(DETAILS.attachmentLoadingPreview)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: DETAILS.attachmentCloseAction }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('renders error state with custom error and retry callback', () => {
    const onRetry = jest.fn();
    const file = makeAttachment();
    render(
      <AttachmentPreviewModal
        preview={makePreview({ status: 'error', objectUrl: null, errorMessage: 'Missing file in bucket', file })}
        onClose={jest.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Missing file in bucket')).toBeInTheDocument();
    expect(screen.getByText(DETAILS.attachmentPreviewErrorHint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: DETAILS.attachmentRetryAction }));
    expect(onRetry).toHaveBeenCalledWith(file);
  });

  test('falls back to localized generic error message when errorMessage is null', () => {
    render(
      <AttachmentPreviewModal
        preview={makePreview({ status: 'error', objectUrl: null, errorMessage: null })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByText(DETAILS.attachmentLoadFailed)).toBeInTheDocument();
  });

  test('renders formatted .eml email preview, embedded attachments, download link, and raw toggle', () => {
    const preview = makePreview();
    render(<AttachmentPreviewModal preview={preview} onClose={jest.fn()} onRetry={jest.fn()} />);

    expect(screen.getByText(preview.file.fileName)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatFileSize(preview.file.size)))).toBeInTheDocument();
    expect(screen.getByText('RFQ for Business Laptops')).toBeInTheDocument();
    expect(screen.getByText('buyer@acme.in')).toBeInTheDocument();
    expect(screen.getByText('specs.pdf')).toBeInTheDocument();
    expect(screen.getByText('Please share quote for 20 laptops.')).toBeInTheDocument();

    const downloadLink = screen.getByRole('link', { name: DETAILS.attachmentDownloadAction });
    expect(downloadLink).toHaveAttribute('href', 'blob:preview-1');
    expect(downloadLink).toHaveAttribute('download', 'smaple rfq email.eml');

    const newTabLink = screen.getByRole('link', { name: DETAILS.attachmentOpenNewTab });
    expect(newTabLink).toHaveAttribute('href', 'blob:preview-1');
    expect(newTabLink).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: DETAILS.attachmentEmailViewRaw }));
    expect(screen.getByText(/Subject: RFQ for Business Laptops/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: DETAILS.attachmentEmailViewFormatted }));
    expect(screen.getByText('Please share quote for 20 laptops.')).toBeInTheDocument();
  });

  test('renders empty-body notice when .eml has no headers or text body', () => {
    render(
      <AttachmentPreviewModal
        preview={makePreview({
          emailPreview: { body: '', embeddedAttachments: [], raw: '' },
        })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByText(DETAILS.attachmentEmailEmptyBody)).toBeInTheDocument();
  });

  test('renders PDF iframe, image viewer, plain text viewer, and binary download notice', () => {
    const pdfFile = makeAttachment({ fileName: 'annexure.pdf', mimeType: 'application/pdf' });
    const { rerender } = render(
      <AttachmentPreviewModal
        preview={makePreview({ file: pdfFile, previewKind: 'pdf', resolvedMime: 'application/pdf', emailPreview: null })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(
      screen.getByTitle(formatString(DETAILS.attachmentPreviewIframeTitle, { fileName: 'annexure.pdf' }))
    ).toHaveAttribute('src', 'blob:preview-1');

    const imgFile = makeAttachment({ fileName: 'layout.png', mimeType: 'image/png' });
    rerender(
      <AttachmentPreviewModal
        preview={makePreview({ file: imgFile, previewKind: 'image', resolvedMime: 'image/png', emailPreview: null })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByAltText('layout.png')).toHaveAttribute('src', 'blob:preview-1');

    const txtFile = makeAttachment({ fileName: 'notes.txt', mimeType: 'text/plain' });
    rerender(
      <AttachmentPreviewModal
        preview={makePreview({
          file: txtFile,
          previewKind: 'text',
          resolvedMime: 'text/plain',
          textContent: 'Line 1 requirements',
          emailPreview: null,
        })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByText('Line 1 requirements')).toBeInTheDocument();

    const xlsxFile = makeAttachment({
      fileName: 'boq.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    rerender(
      <AttachmentPreviewModal
        preview={makePreview({
          file: xlsxFile,
          previewKind: 'download',
          resolvedMime: xlsxFile.mimeType,
          emailPreview: null,
        })}
        onClose={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(
      screen.getByText(formatString(DETAILS.attachmentBinaryNotice, { fileType: xlsxFile.mimeType }))
    ).toBeInTheDocument();
  });
});
