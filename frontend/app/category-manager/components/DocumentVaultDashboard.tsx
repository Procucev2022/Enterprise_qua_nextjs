'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FolderOpen,
  FileText,
  Upload,
  Search,
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  Download,
  AlertCircle,
  HardDrive,
  Layers,
  FileCheck,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import { DOCUMENT_VAULT_CATEGORIES, DOCUMENT_VAULT_SOURCES, DOCUMENT_VAULT_CONFIG } from '@/lib/constants';
import type { DocumentVaultItem, DocumentVaultSummary } from '@/lib/types';
import {
  fetchDocuments,
  fetchDocumentVaultSummary,
  createDocument,
  updateDocument,
  deleteDocument,
} from '@/lib/documentVaultClient';

export default function DocumentVaultDashboard() {
  const strings = UI_STRINGS.actionCenter.documentVault;

  const [documents, setDocuments] = useState<DocumentVaultItem[]>([]);
  const [summary, setSummary] = useState<DocumentVaultSummary>({
    totalDocuments: 0,
    activeDocuments: 0,
    totalSizeBytes: 0,
    categoriesCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingDoc, setEditingDoc] = useState<DocumentVaultItem | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form states
  const [formDocName, setFormDocName] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>('marketing_overview');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [formFile, setFormFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [docsData, summaryData] = await Promise.all([
        fetchDocuments({
          category: selectedCategory === 'all' ? undefined : selectedCategory,
          source: selectedSource === 'all' ? undefined : selectedSource,
          search: searchQuery.trim() || undefined,
        }),
        fetchDocumentVaultSummary(),
      ]);
      setDocuments(docsData);
      setSummary(summaryData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load document vault';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, selectedSource, searchQuery, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenUploadModal = () => {
    setEditingDoc(null);
    setFormDocName('');
    setFormCategory('marketing_overview');
    setFormDescription('');
    setFormIsActive(true);
    setFormFile(null);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (doc: DocumentVaultItem) => {
    setEditingDoc(doc);
    setFormDocName(doc.documentName);
    setFormCategory(doc.category);
    setFormDescription(doc.description || '');
    setFormIsActive(doc.isActive);
    setFormFile(null);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > DOCUMENT_VAULT_CONFIG.MAX_UPLOAD_SIZE_BYTES) {
      setErrorMessage(`File exceeds maximum size of 25MB.`);
      return;
    }

    setFormFile(file);
    if (!formDocName.trim()) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setFormDocName(cleanName);
    }
    setErrorMessage(null);
  };

  const handleSaveDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDocName.trim()) {
      setErrorMessage('Please provide a document display name.');
      return;
    }

    if (!editingDoc && !formFile) {
      setErrorMessage('Please select a file to upload.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      if (editingDoc) {
        const res = await updateDocument(editingDoc.id, {
          documentName: formDocName.trim(),
          category: formCategory,
          description: formDescription.trim(),
          isActive: formIsActive,
        });

        if (res.success && res.document) {
          showToast('Document updated successfully.');
          setIsModalOpen(false);
          loadData();
        } else {
          setErrorMessage(res.error || 'Failed to update document.');
        }
      } else if (formFile) {
        const res = await createDocument({
          documentName: formDocName.trim(),
          fileName: formFile.name,
          category: formCategory,
          fileSize: formFile.size,
          mimeType: formFile.type || 'application/pdf',
          description: formDescription.trim(),
          isActive: formIsActive,
        });

        if (res.success && res.document) {
          showToast('Document uploaded to vault successfully.');
          setIsModalOpen(false);
          loadData();
        } else {
          setErrorMessage(res.error || 'Failed to upload document.');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Operation failed';
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this document from the vault?')) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await deleteDocument(id);
      if (res.success) {
        showToast('Document deleted from vault.');
        loadData();
      } else {
        showToast(res.error || 'Failed to delete document.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (doc: DocumentVaultItem) => {
    try {
      const res = await updateDocument(doc.id, { isActive: !doc.isActive });
      if (res.success) {
        showToast(`Document ${doc.isActive ? 'deactivated' : 'activated'}.`);
        loadData();
      } else {
        showToast(res.error || 'Failed to toggle status.', 'error');
      }
    } catch {
      showToast('Error toggling document status.', 'error');
    }
  };

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (activeFilter === 'active' && !doc.isActive) return false;
      if (activeFilter === 'inactive' && doc.isActive) return false;
      return true;
    });
  }, [documents, activeFilter]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  return (
    <div className="space-y-6" data-testid="document-vault-dashboard">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 transition-all ${
            toastMessage.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          {toastMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
            <span>{strings.stats.totalDocuments}</span>
            <FileText size={16} className="text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="stat-total-documents">
            {summary.totalDocuments}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
            <span>{strings.stats.activeCollateral}</span>
            <FileCheck size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-active-documents">
            {summary.activeDocuments}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
            <span>{strings.stats.totalStorage}</span>
            <HardDrive size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="stat-total-storage">
            {formatFileSize(summary.totalSizeBytes)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-1">
            <span>{strings.stats.categories}</span>
            <Layers size={16} className="text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white" data-testid="stat-categories-count">
            {summary.categoriesCount}
          </div>
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={strings.actions.searchPlaceholder}
            data-testid="vault-search-input"
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Source Dropdown */}
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            data-testid="vault-source-filter"
            aria-label={strings.actions.filterSource}
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {DOCUMENT_VAULT_SOURCES.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            data-testid="vault-category-filter"
            aria-label={strings.actions.filterCategory}
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {DOCUMENT_VAULT_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>

          {/* Active status filter */}
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}
            data-testid="vault-status-filter"
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          {/* Upload Button */}
          <button
            type="button"
            onClick={handleOpenUploadModal}
            data-testid="upload-document-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <Upload size={13} />
            <span>{strings.actions.uploadDocument}</span>
          </button>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="py-16 text-center text-xs text-slate-500" data-testid="vault-loading">
            Loading collateral documents...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="py-16 text-center" data-testid="vault-empty">
            <FolderOpen size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {searchQuery || selectedCategory !== 'all'
                ? strings.table.emptyFiltered
                : strings.table.empty}
            </p>
            <button
              type="button"
              onClick={handleOpenUploadModal}
              className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
            >
              + {strings.actions.uploadDocument}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" data-testid="vault-table">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">{strings.table.documentName}</th>
                  <th className="py-3 px-3">{strings.table.source}</th>
                  <th className="py-3 px-3">{strings.table.category}</th>
                  <th className="py-3 px-3">{strings.table.fileDetails}</th>
                  <th className="py-3 px-3">{strings.table.uploadedBy}</th>
                  <th className="py-3 px-3 text-center">{strings.table.status}</th>
                  <th className="py-3 px-4 text-right">{strings.table.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {filteredDocuments.map((doc) => {
                  const catLabel =
                    DOCUMENT_VAULT_CATEGORIES.find((c) => c.id === doc.category)?.label ||
                    doc.category;

                  return (
                    <tr
                      key={doc.id}
                      data-testid={`doc-row-${doc.id}`}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-start gap-2.5">
                          <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-md shrink-0 mt-0.5">
                            <FileText size={16} />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {doc.documentName}
                            </div>
                            {doc.description && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                                {doc.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {catLabel}
                        </span>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {doc.fileName}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatFileSize(doc.fileSize)}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 text-[11px]">
                        <div>{doc.uploadedBy || 'Category Desk'}</div>
                        <div className="text-[10px] text-slate-400">
                          {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : 'Active'}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(doc)}
                          data-testid={`toggle-active-${doc.id}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${
                            doc.isActive
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {doc.isActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                          <span>{doc.isActive ? 'Active' : 'Inactive'}</span>
                        </button>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {doc.fileUrl && (
                            <a
                              href={doc.fileUrl}
                              download={doc.fileName}
                              target="_blank"
                              rel="noreferrer"
                              title={strings.actions.download}
                              data-testid={`download-doc-${doc.id}`}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                            >
                              <Download size={13} />
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(doc)}
                            title={strings.actions.edit}
                            data-testid={`edit-doc-${doc.id}`}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(doc.id)}
                            disabled={deletingId === doc.id}
                            title={strings.actions.delete}
                            data-testid={`delete-doc-${doc.id}`}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload / Edit Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              {editingDoc ? strings.modal.editTitle : strings.modal.uploadTitle}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Add corporate collateral for one-click attachment during customer conversion emails.
            </p>

            {errorMessage && (
              <div
                role="alert"
                className="mb-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2"
              >
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSaveDocument} className="space-y-4">
              {/* Document Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modal.documentNameLabel} *
                </label>
                <input
                  type="text"
                  value={formDocName}
                  onChange={(e) => setFormDocName(e.target.value)}
                  placeholder={strings.modal.documentNamePlaceholder}
                  required
                  data-testid="modal-doc-name-input"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modal.categoryLabel} *
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  data-testid="modal-category-select"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {DOCUMENT_VAULT_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {strings.modal.descriptionLabel}
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={strings.modal.descriptionPlaceholder}
                  rows={2}
                  data-testid="modal-description-input"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* File upload input (for new document) */}
              {!editingDoc && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {strings.modal.fileUploadLabel} *
                  </label>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept={DOCUMENT_VAULT_CONFIG.ALLOWED_EXTENSIONS.join(',')}
                    data-testid="modal-file-input"
                    className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                  />
                  {formFile && (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                      Selected: {formFile.name} ({formatFileSize(formFile.size)})
                    </p>
                  )}
                </div>
              )}

              {/* Active Toggle */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  data-testid="modal-active-checkbox"
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label
                  htmlFor="formIsActive"
                  className="text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                >
                  Active & Available for Email Collateral Selection
                </label>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  data-testid="modal-cancel-btn"
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                >
                  {strings.actions.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  data-testid="modal-save-btn"
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {isSaving ? strings.actions.uploading : strings.actions.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
