'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  Mail,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatFileSize } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { AttachmentPreviewState, RFQAttachment } from '@/lib/types';

const DETAILS = UI_STRINGS.rfqDetails;

export interface AttachmentPreviewModalProps {
  preview: AttachmentPreviewState | null;
  onClose: () => void;
  onRetry: (file: RFQAttachment) => void;
}

/**
 * Declarative modal viewer for RFQ supporting documents (.eml emails, PDFs,
 * images, plain text/CSV, and downloadable binary attachments).
 * Uses direct synchronous <a> links for download and new-tab opening so browser
 * popup blockers never drop async attachment views.
 */
export default function AttachmentPreviewModal({
  preview,
  onClose,
  onRetry,
}: AttachmentPreviewModalProps) {
  const [showRawEmail, setShowRawEmail] = useState(false);

  if (!preview) {
    return null;
  }

  const { file, status, previewKind, resolvedMime, objectUrl, textContent, emailPreview, errorMessage } = preview;
  const emailHeaders = emailPreview
    ? [
        { label: DETAILS.attachmentEmailSubject, value: emailPreview.subject },
        { label: DETAILS.attachmentEmailFrom, value: emailPreview.from },
        { label: DETAILS.attachmentEmailTo, value: emailPreview.to },
        { label: DETAILS.attachmentEmailCc, value: emailPreview.cc },
        { label: DETAILS.attachmentEmailDate, value: emailPreview.date },
      ].filter((row): row is { label: string; value: string } => Boolean(row.value))
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachment-preview-modal-title"
      className="fixed inset-0 z-[1300] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-gray-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl border border-slate-200 dark:border-gray-800 overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-950/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
              {previewKind === 'email' ? <Mail size={18} /> : <FileText size={18} />}
            </div>
            <div className="min-w-0">
              <h3
                id="attachment-preview-modal-title"
                className="text-sm font-bold text-slate-900 dark:text-white truncate"
              >
                {file.fileName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mono">
                {DETAILS.attachmentPreviewTitle} · {formatFileSize(file.size)} · {resolvedMime}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {status === 'ready' && objectUrl && (
              <>
                <a
                  href={objectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-xs font-bold inline-flex items-center gap-1"
                >
                  <ExternalLink size={12} />
                  <span>{DETAILS.attachmentOpenNewTab}</span>
                </a>
                <a
                  href={objectUrl}
                  download={file.fileName}
                  className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1"
                >
                  <Download size={12} />
                  <span>{DETAILS.attachmentDownloadAction}</span>
                </a>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={DETAILS.attachmentCloseAction}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-gray-800"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <span
                className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                {DETAILS.attachmentLoadingPreview}
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="max-w-lg mx-auto my-8 p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {errorMessage || DETAILS.attachmentLoadFailed}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-gray-300">
                    {DETAILS.attachmentPreviewErrorHint}
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onRetry(file)}
                  className="btn btn-primary btn-xs font-bold inline-flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  <span>{DETAILS.attachmentRetryAction}</span>
                </button>
              </div>
            </div>
          )}

          {status === 'ready' && objectUrl && previewKind === 'email' && emailPreview && (
            <div className="space-y-4">
              {emailHeaders.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950/60 border border-slate-200 dark:border-gray-800 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {DETAILS.attachmentEmailHeadersHeading}
                  </p>
                  <dl className="grid grid-cols-1 sm:grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-xs">
                    {emailHeaders.map((row) => (
                      <React.Fragment key={row.label}>
                        <dt className="font-semibold text-slate-500 dark:text-gray-400">{row.label}</dt>
                        <dd className="text-slate-900 dark:text-gray-100 break-words">{row.value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
              )}

              {emailPreview.embeddedAttachments.length > 0 && (
                <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/50 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                    {formatString(DETAILS.attachmentEmailAttachmentsHeading, {
                      count: emailPreview.embeddedAttachments.length,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {emailPreview.embeddedAttachments.map((name, idx) => (
                      <span
                        key={`${name}-${idx}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-slate-700 dark:text-gray-200"
                      >
                        <Paperclip size={11} />
                        <span>{name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {DETAILS.attachmentEmailBodyHeading}
                </span>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-gray-700 p-0.5 bg-slate-50 dark:bg-gray-950">
                  <button
                    type="button"
                    onClick={() => setShowRawEmail(false)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                      !showRawEmail
                        ? 'bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-gray-400'
                    }`}
                  >
                    {DETAILS.attachmentEmailViewFormatted}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawEmail(true)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                      showRawEmail
                        ? 'bg-white dark:bg-gray-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-gray-400'
                    }`}
                  >
                    {DETAILS.attachmentEmailViewRaw}
                  </button>
                </div>
              </div>

              {showRawEmail ? (
                <pre className="w-full max-h-[50vh] overflow-auto p-4 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono whitespace-pre-wrap break-words border border-slate-800">
                  {emailPreview.raw}
                </pre>
              ) : (
                <pre className="w-full max-h-[50vh] overflow-auto p-4 rounded-xl bg-slate-50 dark:bg-gray-950 text-slate-800 dark:text-gray-200 text-xs leading-relaxed font-sans whitespace-pre-wrap break-words border border-slate-200 dark:border-gray-800">
                  {emailPreview.body || DETAILS.attachmentEmailEmptyBody}
                </pre>
              )}
            </div>
          )}

          {status === 'ready' && objectUrl && previewKind === 'pdf' && (
            <iframe
              src={objectUrl}
              title={formatString(DETAILS.attachmentPreviewIframeTitle, { fileName: file.fileName })}
              className="w-full h-[65vh] rounded-xl border border-slate-200 dark:border-gray-700 bg-white"
            />
          )}

          {status === 'ready' && objectUrl && previewKind === 'image' && (
            <div className="flex items-center justify-center p-2 bg-slate-50 dark:bg-gray-950 rounded-xl border border-slate-200 dark:border-gray-800">
              <img
                src={objectUrl}
                alt={file.fileName}
                className="max-h-[65vh] max-w-full object-contain rounded-lg"
              />
            </div>
          )}

          {status === 'ready' && objectUrl && previewKind === 'text' && (
            <pre className="w-full max-h-[65vh] overflow-auto p-4 rounded-xl bg-slate-50 dark:bg-gray-950 text-slate-800 dark:text-gray-200 text-xs font-mono whitespace-pre-wrap break-words border border-slate-200 dark:border-gray-800">
              {textContent}
            </pre>
          )}

          {status === 'ready' && objectUrl && previewKind === 'download' && (
            <div className="max-w-lg mx-auto my-8 p-6 rounded-2xl bg-slate-50 dark:bg-gray-950/70 border border-slate-200 dark:border-gray-800 text-center space-y-4">
              <FileText size={32} className="mx-auto text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs text-slate-600 dark:text-gray-300 leading-relaxed">
                {formatString(DETAILS.attachmentBinaryNotice, { fileType: resolvedMime })}
              </p>
              <a
                href={objectUrl}
                download={file.fileName}
                className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <Download size={14} />
                <span>{DETAILS.attachmentDownloadAction}</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
