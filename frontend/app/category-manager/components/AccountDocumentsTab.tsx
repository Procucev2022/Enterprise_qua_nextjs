'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText,
  Search,
  Filter,
  ArrowUpDown,
  Upload,
  Download,
  Eye,
  Trash2,
  X,
  Loader2,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  File,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import {
  fetchAccountDocuments,
  uploadAccountDocument,
  deleteAccountDocument,
} from '@/lib/accountDocumentsClient';
import {
  ACCOUNT_DOCUMENT_CATEGORIES,
  ACCOUNT_DOCUMENT_TYPES,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { AccountDocument } from '@/lib/types';
import { backdropDismissProps, useEscapeDismissStack } from '@/lib/useModalDismiss';

interface AccountDocumentsTabProps {
  accountType: 'buyer' | 'seller';
  accountId: string;
  accountName: string;
  onDocumentCountChange?: (count: number) => void;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getFileIcon(mimeType: string, fileName: string) {
  const mime = (mimeType || '').toLowerCase();
  const fn = (fileName || '').toLowerCase();

  if (mime.includes('pdf') || fn.endsWith('.pdf')) {
    return <FileText className="w-5 h-5 text-rose-500" />;
  }
  if (mime.includes('image') || /\.(jpg|jpeg|png|webp|svg)$/i.test(fn)) {
    return <ImageIcon className="w-5 h-5 text-indigo-500" />;
  }
  if (mime.includes('sheet') || mime.includes('excel') || /\.(xls|xlsx|csv)$/i.test(fn)) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
  }
  if (mime.includes('word') || mime.includes('officedocument') || /\.(doc|docx)$/i.test(fn)) {
    return <FileCode className="w-5 h-5 text-blue-500" />;
  }
  return <File className="w-5 h-5 text-slate-500" />;
}

export function detectDocumentType(mimeType: string, fileName: string): string {
  const mime = (mimeType || '').toLowerCase();
  const fn = (fileName || '').toLowerCase();

  if (mime.includes('pdf') || fn.endsWith('.pdf')) return 'PDF';
  if (mime.includes('image') || /\.(jpg|jpeg|png|webp|svg)$/i.test(fn)) return 'Image';
  if (mime.includes('sheet') || mime.includes('excel') || /\.(xls|xlsx|csv)$/i.test(fn)) return 'Excel';
  if (mime.includes('word') || mime.includes('officedocument') || /\.(doc|docx)$/i.test(fn)) return 'Word';
  return 'Document';
}

export default function AccountDocumentsTab({
  accountType,
  accountId,
  accountName,
  onDocumentCountChange,
}: AccountDocumentsTabProps) {
  const strings = UI_STRINGS.buyerDirectory.dossier.documents;

  // Documents state
  const [documents, setDocuments] = useState<AccountDocument[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Modal states
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [previewDoc, setPreviewDoc] = useState<AccountDocument | null>(null);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<AccountDocument | null>(null);

  const closeUploadModal = (): void => setIsUploadModalOpen(false);
  const closePreviewDocModal = (): void => setPreviewDoc(null);
  const closeDeleteConfirmModal = (): void => setDeleteConfirmDoc(null);
  useEscapeDismissStack([
    { isOpen: deleteConfirmDoc !== null, onClose: closeDeleteConfirmModal },
    { isOpen: previewDoc !== null, onClose: closePreviewDocModal },
    { isOpen: isUploadModalOpen, onClose: closeUploadModal },
  ]);

  // Upload Form state
  const [uploadName, setUploadName] = useState<string>('');
  const [uploadCategory, setUploadCategory] = useState<string>(ACCOUNT_DOCUMENT_CATEGORIES[0]);
  const [uploadDescription, setUploadDescription] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, []);

  // Fetch documents
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const docs = await fetchAccountDocuments(accountType, accountId, {
        category: selectedCategory,
        type: selectedType,
        search: searchQuery,
        sortOrder,
      });
      setDocuments(docs);
      if (onDocumentCountChange) {
        onDocumentCountChange(docs.length);
      }
    } catch {
      setErrorMessage(strings.toastUploadError);
    } finally {
      setLoading(false);
    }
  }, [accountType, accountId, selectedCategory, selectedType, searchQuery, sortOrder, onDocumentCountChange, strings.toastUploadError]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Handle Clear Filters
  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedType('all');
    setSortOrder('desc');
  }, []);

  // Handle File Change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 25 * 1024 * 1024) {
        setUploadError('File exceeds maximum size limit of 25MB.');
        return;
      }
      setSelectedFile(file);
      setUploadError(null);
      if (!uploadName.trim()) {
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        setUploadName(baseName);
      }
    }
  };

  // Submit Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadName.trim()) {
      setUploadError('Please provide a document name.');
      return;
    }
    if (!selectedFile) {
      setUploadError('Please select a file to upload.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const res = await uploadAccountDocument(accountType, accountId, {
        documentName: uploadName.trim(),
        category: uploadCategory,
        description: uploadDescription.trim(),
        file: selectedFile,
      });

      if (res.success && res.document) {
        showToast(strings.toastUploadSuccess, 'success');
        setIsUploadModalOpen(false);
        setUploadName('');
        setUploadDescription('');
        setSelectedFile(null);
        loadDocuments();
      } else {
        setUploadError(res.error || strings.toastUploadError);
      }
    } catch {
      setUploadError(strings.toastUploadError);
    } finally {
      setUploading(false);
    }
  };

  // Confirm Delete
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmDoc) return;
    try {
      const res = await deleteAccountDocument(accountType, accountId, deleteConfirmDoc.id);
      if (res.success) {
        showToast(strings.toastDeleteSuccess, 'success');
        setDeleteConfirmDoc(null);
        loadDocuments();
      } else {
        showToast(res.error || strings.toastDeleteError, 'error');
      }
    } catch {
      showToast(strings.toastDeleteError, 'error');
    }
  };

  // Formatted date helper
  const formatDate = (iso: string) => {
    if (!iso) return 'N/A';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const hasActiveFilters = searchQuery.trim() !== '' || selectedCategory !== 'all' || selectedType !== 'all';

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toast && (
        <div
          role="alert"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold border ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/90 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header Bar: Search, Category, Type, Sort, and Upload */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={strings.searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Action Button: Upload Document */}
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg transition shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{strings.uploadDocumentBtn}</span>
          </button>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          {/* Category Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="all">{strings.allCategories}</option>
              {ACCOUNT_DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Document Type Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {ACCOUNT_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t === 'All Types' ? 'all' : t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Order Toggle */}
          <button
            type="button"
            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition"
          >
            <ArrowUpDown className="w-3 h-3 text-slate-500" />
            <span>{sortOrder === 'desc' ? strings.sortNewestFirst : strings.sortOldestFirst}</span>
          </button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{strings.clearFilters}</span>
            </button>
          )}

          <div className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            Total Documents: <span className="font-semibold text-slate-800 dark:text-slate-200">{documents.length}</span>
          </div>
        </div>
      </div>

      {/* Main Content: Loading, Error, Empty, or Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <Loader2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin mb-3" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Loading associated documents...</p>
        </div>
      ) : errorMessage ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-xs font-semibold text-rose-800 dark:text-rose-300 mb-2">{errorMessage}</p>
          <button
            type="button"
            onClick={loadDocuments}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
          <FileText className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">{strings.noDocuments}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            No compliance or workflow records have been attached to this {accountType} account yet.
          </p>
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{strings.uploadDocumentBtn}</span>
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">{strings.tableDocName}</th>
                  <th className="py-3 px-3">{strings.tableDocType}</th>
                  <th className="py-3 px-3">{strings.tableCategory}</th>
                  <th className="py-3 px-3">{strings.tableUploadedBy}</th>
                  <th className="py-3 px-3">{strings.tableUploadDate}</th>
                  <th className="py-3 px-3">{strings.tableFileSize}</th>
                  <th className="py-3 px-3">{strings.tableDescription}</th>
                  <th className="py-3 px-4 text-right">{strings.tableActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {documents.map((doc) => {
                  const docType = detectDocumentType(doc.mimeType, doc.fileName);
                  const isPreviewable = docType === 'PDF' || docType === 'Image';

                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition duration-150"
                    >
                      {/* Document Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="shrink-0">{getFileIcon(doc.mimeType, doc.fileName)}</div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-xs" title={doc.documentName}>
                              {doc.documentName}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs font-mono">
                              {doc.fileName}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Document Type */}
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {docType}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {doc.category || 'Other'}
                        </span>
                      </td>

                      {/* Uploaded By */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {doc.uploadedBy || 'Category Manager'}
                      </td>

                      {/* Upload Date */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatDate(doc.uploadDate || doc.createdAt || '')}
                      </td>

                      {/* File Size */}
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono text-[11px]">
                        {formatFileSize(doc.fileSize)}
                      </td>

                      {/* Description */}
                      <td className="py-3 px-3 text-slate-500 dark:text-slate-400 max-w-xs truncate" title={doc.description || ''}>
                        {doc.description || '—'}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Preview Action */}
                          <button
                            type="button"
                            onClick={() => setPreviewDoc(doc)}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition"
                            title={strings.actionPreview}
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Open File Link */}
                          {doc.fileUrl && (
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition"
                              title={strings.actionOpen}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}

                          {/* Download Action */}
                          <a
                            href={doc.fileUrl || '#'}
                            download={doc.fileName}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition"
                            title={strings.actionDownload}
                          >
                            <Download className="w-4 h-4" />
                          </a>

                          {/* Delete Action */}
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmDoc(doc)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md transition"
                            title={strings.actionDelete}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 1: UPLOAD DOCUMENT MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {isUploadModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          {...backdropDismissProps(closeUploadModal)}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {strings.uploadModalTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {accountName} ({accountType.toUpperCase()})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {uploadError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg text-xs text-rose-700 dark:text-rose-300 font-medium">
                {uploadError}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
              {/* Document Name */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.docNameLabel} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={strings.docNamePlaceholder}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.categoryLabel} <span className="text-rose-500">*</span>
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  {ACCOUNT_DOCUMENT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* File Dropzone */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  File Attachment <span className="text-rose-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center hover:border-emerald-500 transition bg-slate-50/50 dark:bg-slate-800/40">
                  <input
                    type="file"
                    id="doc-file-upload"
                    required={!selectedFile}
                    onChange={handleFileChange}
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                  />
                  <label htmlFor="doc-file-upload" className="cursor-pointer block space-y-1.5">
                    <Upload className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {selectedFile ? selectedFile.name : strings.dropzoneText}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {selectedFile ? `${formatFileSize(selectedFile.size)} selected` : strings.dropzoneHint}
                    </p>
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.descriptionLabel}
                </label>
                <textarea
                  rows={2}
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder={strings.descriptionPlaceholder}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                >
                  {strings.cancelBtn}
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition"
                >
                  {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{uploading ? strings.uploadingBtn : strings.confirmUploadBtn}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 2: IN-APP DOCUMENT PREVIEW MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {previewDoc && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          {...backdropDismissProps(closePreviewDocModal)}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-4xl w-full h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                {getFileIcon(previewDoc.mimeType, previewDoc.fileName)}
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate max-w-md">
                    {previewDoc.documentName}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {previewDoc.fileName} • {formatFileSize(previewDoc.fileSize)} • {previewDoc.category}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={previewDoc.fileUrl}
                  download={previewDoc.fileName}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{strings.actionDownload}</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Viewer Content */}
            <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-4 overflow-auto flex items-center justify-center">
              {detectDocumentType(previewDoc.mimeType, previewDoc.fileName) === 'Image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewDoc.fileUrl}
                  alt={previewDoc.documentName}
                  className="max-h-full max-w-full object-contain rounded-lg shadow-md"
                />
              ) : detectDocumentType(previewDoc.mimeType, previewDoc.fileName) === 'PDF' ? (
                <iframe
                  src={previewDoc.fileUrl}
                  title={previewDoc.documentName}
                  className="w-full h-full rounded-lg bg-white shadow-md border-0"
                />
              ) : (
                <div className="text-center p-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-sm">
                  {getFileIcon(previewDoc.mimeType, previewDoc.fileName)}
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-2 mb-1">
                    {previewDoc.fileName}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    {strings.previewModalUnsupported}
                  </p>
                  <a
                    href={previewDoc.fileUrl}
                    download={previewDoc.fileName}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{strings.actionDownload}</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------------ */}
      {/* MODAL 3: DELETE CONFIRMATION MODAL */}
      {/* ------------------------------------------------------------------------ */}
      {deleteConfirmDoc && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          {...backdropDismissProps(closeDeleteConfirmModal)}
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {strings.deleteModalTitle}
                </h3>
                <p className="text-xs text-slate-500">
                  {formatString(strings.deleteModalConfirm, { documentName: deleteConfirmDoc.documentName })}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeleteConfirmDoc(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
              >
                {strings.cancelBtn}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition"
              >
                {strings.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
