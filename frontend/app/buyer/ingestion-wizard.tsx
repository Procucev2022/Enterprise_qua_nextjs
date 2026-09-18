'use client';

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useApp } from '@/lib/store';
import {
  SOURCING_MODES,
  CURRENCY,
  formatFileSize,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import {
  createRFQ,
  extractLineItemsFromDocument,
  classifyLineItems,
  uploadRFQAttachment,
  fetchAllVendors,
} from '@/lib/rfqClient';
import { buildExtractionRequest } from '@/lib/documentExtraction';
import {
  addManualRFQLineItem,
  createEmptyManualRFQForm,
  removeManualRFQLineItem,
  toRFQCreatePayload,
  fromExtractedEntity,
  updateManualRFQLineItem,
  validateManualRFQForm,
} from '@/lib/manualRfqModel';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import { isBuyerUploaded, isProcucevVendor } from './vendor-summary';
import { extractRfqCategorySignals, getCategoryMatchedProcucevVendors } from '@/lib/vendorMatching';
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQExtractionResult,
  RFQVendorCandidate,
  SourcingMode,
  VendorEntry,
  VendorPageMeta,
} from '@/lib/types';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Send,
  Trash2,
  Plus,
  FileText,
  AlertCircle,
  Paperclip,
  Loader2,
  Mail,
  FileCheck,
  RotateCcw,
  Building2,
  Phone,
  Star,
  Users,
  ShieldCheck,
  Tag,
  Info,
} from 'lucide-react';

const EXTRACTION = UI_STRINGS.rfqExtraction;
const MODAL = UI_STRINGS.manualRfqModal;

// A synthetic major-category value, never sent to the server as a real
// category (sanitized back to '' before submission) — opts a line item out
// of category-narrowed supplier matching so the marketplace-suppliers panel
// shows the whole real directory instead. Distinct from the "" placeholder
// value so the Minor Category select and validation still treat it as "a
// category was chosen", not "nothing chosen yet".
const ALL_CATEGORIES_OPTION = 'All Categories';
const ALL_VENDORS_PAGE_SIZE = 30;
const ALL_VENDORS_SEARCH_DEBOUNCE_MS = 350;

function taxonomyMajors(): string[] {
  return getMajorCategories();
}

function minorsFor(major: string): string[] {
  return getMinorCategories(major);
}

interface IngestionWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  forceSubscription?: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-medium">{message}</p>;
}

export default function IngestionWizard({ onComplete, onCancel, forceSubscription }: IngestionWizardProps) {
  const {
    addNewRFQ,
    adoptCreatedRFQ,
    currentMode,
    setCurrentMode,
    showToast,
    activeSubscription: storeSubscription,
    buyerVendors,
  } = useApp();

  const [form, setForm] = useState<ManualRFQForm>(() => ({
    ...createEmptyManualRFQForm(),
    sourcingMode: currentMode || 'mode_2',
  }));

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // "All Categories" opts a line item out of category-narrowed matching — the
  // marketplace-suppliers panel then browses the whole real vendor directory
  // instead (search + pagination, same server-backed pattern as the Invite
  // Vendors "All Vendors" tab), rather than the always-0-at-scale client match
  // that would otherwise run against the capped bootstrap vendor list.
  const isAllCategories = form.lineItems.some((item) => item.majorCategory === ALL_CATEGORIES_OPTION);
  const [allVendorsSearch, setAllVendorsSearch] = useState('');
  const [debouncedAllVendorsSearch, setDebouncedAllVendorsSearch] = useState('');
  const [allVendorsList, setAllVendorsList] = useState<RFQVendorCandidate[]>([]);
  const [allVendorsPagination, setAllVendorsPagination] = useState<VendorPageMeta | null>(null);
  const [allVendorsLoading, setAllVendorsLoading] = useState(false);
  const [allVendorsLoadingMore, setAllVendorsLoadingMore] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedAllVendorsSearch(allVendorsSearch), ALL_VENDORS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [allVendorsSearch]);

  const lastAllVendorsKeyRef = useRef<string | null>(null);
  // Guards against a slower, earlier request resolving AFTER a newer,
  // re-searched one and overwriting it with stale results.
  const allVendorsFetchSeqRef = useRef(0);
  useEffect(() => {
    if (!isAllCategories) return;
    if (allVendorsList.length > 0 && lastAllVendorsKeyRef.current === debouncedAllVendorsSearch) return;
    lastAllVendorsKeyRef.current = debouncedAllVendorsSearch;
    const seq = ++allVendorsFetchSeqRef.current;
    setAllVendorsLoading(true);
    void fetchAllVendors({ page: 1, pageSize: ALL_VENDORS_PAGE_SIZE, search: debouncedAllVendorsSearch }).then((result) => {
      if (seq !== allVendorsFetchSeqRef.current) return;
      if (result.success) {
        setAllVendorsList(result.candidates);
        setAllVendorsPagination(result.pagination);
      }
      setAllVendorsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allVendorsList is only read as a "has loaded yet" guard, not a re-fetch trigger
  }, [isAllCategories, debouncedAllVendorsSearch]);

  const loadMoreAllVendors = () => {
    if (!allVendorsPagination || allVendorsLoadingMore) return;
    const nextPage = allVendorsPagination.page + 1;
    if (nextPage > allVendorsPagination.totalPages) return;
    const seq = ++allVendorsFetchSeqRef.current;
    setAllVendorsLoadingMore(true);
    void fetchAllVendors({ page: nextPage, pageSize: ALL_VENDORS_PAGE_SIZE, search: debouncedAllVendorsSearch }).then((result) => {
      if (seq !== allVendorsFetchSeqRef.current) return;
      if (result.success) {
        setAllVendorsList((prev) => [...prev, ...result.candidates]);
        setAllVendorsPagination(result.pagination);
      }
      setAllVendorsLoadingMore(false);
    });
  };

  /**
   * The "All Categories" branch of the marketplace-suppliers panel: a real
   * server-searched, paginated browse of the whole vendor directory, in
   * place of the client-side category match (which has nothing to match
   * against once "All Categories" is chosen). Shared between Mode 2 and
   * Mode 3 — only the accent color and "no results" copy differ.
   */
  function renderAllVendorsBrowsePanel(accent: 'emerald' | 'indigo') {
    const ring = accent === 'emerald' ? 'focus:ring-emerald-300' : 'focus:ring-indigo-300';
    const border = accent === 'emerald' ? 'border-emerald-200/70 dark:border-emerald-900/50' : 'border-indigo-200/70 dark:border-indigo-900/50';
    const hoverBorder = accent === 'emerald' ? 'hover:border-emerald-400' : 'hover:border-indigo-400';
    const text = accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-300';
    const btnBorder = accent === 'emerald' ? 'border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40';

    return (
      <>
        <input
          type="text"
          value={allVendorsSearch}
          onChange={(e) => setAllVendorsSearch(e.target.value)}
          placeholder="Search suppliers by name, email or category..."
          className={`w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs focus:outline-none focus:ring-2 ${ring}`}
        />

        {allVendorsLoading ? (
          <div className="p-3.5 text-center text-[11px] text-slate-400 dark:text-gray-500">Loading suppliers…</div>
        ) : allVendorsList.length === 0 ? (
          <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
            No suppliers match this search.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
              {allVendorsList.map((v) => (
                <div key={v.id} className={`p-3 rounded-xl bg-white dark:bg-gray-900 border ${border} space-y-1 shadow-2xs ${hoverBorder} transition-colors`}>
                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate block" title={v.name}>
                    {v.name}
                  </span>
                  <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                    <span className={`truncate font-semibold ${text}`}>{v.majorCategory || 'General Industrial'}</span>
                    <span className="truncate">{v.city || v.state || v.location || 'India'}</span>
                  </div>
                </div>
              ))}
            </div>
            {allVendorsPagination && allVendorsPagination.page < allVendorsPagination.totalPages && (
              <button
                type="button"
                onClick={loadMoreAllVendors}
                disabled={allVendorsLoadingMore}
                className={`w-full text-[11px] font-semibold ${text} py-2 rounded-lg border ${btnBorder} disabled:opacity-50`}
              >
                {allVendorsLoadingMore ? 'Loading…' : 'Load more suppliers'}
              </button>
            )}
          </>
        )}
      </>
    );
  }

  // Document Upload & AI Extraction State
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionSummary, setExtractionSummary] = useState<{
    model: string;
    accepted: number;
    needsReview: number;
    fileName: string;
  } | null>(null);
  const [showAiInfo, setShowAiInfo] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => validateManualRFQForm(form), [form]);
  const formErrors = submitAttempted ? validation.formErrors : {};
  const lineItemErrors = submitAttempted ? validation.lineItemErrors : {};

  const patchForm = useCallback(<K extends keyof ManualRFQForm>(key: K, value: ManualRFQForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<ManualRFQLineItem>) => {
    setForm((prev) => updateManualRFQLineItem(prev, id, patch));
  }, []);

  /** Handles file selection via picker or drag-and-drop */
  const handleFilesSelected = (files: FileList | null | File[]) => {
    if (!files) return;
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    setUploadedFiles((prev) => [...prev, ...fileList]);
    setExtractionError(null);
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /** AI Extraction: processes uploaded document (.eml, .msg, .xlsx, .pdf, .docx, .csv) into form */
  const handleExtractFromFiles = async () => {
    if (uploadedFiles.length === 0) {
      showToast(EXTRACTION.noFileTitle, 'Please select or drop a BOQ document or requisition email first.', 'warning');
      return;
    }

    setIsExtracting(true);
    setExtractionError(null);
    setExtractionSummary(null);

    const primaryFile = uploadedFiles[0];
    try {
      const payload = await buildExtractionRequest(primaryFile);
      const result: RFQExtractionResult = await extractLineItemsFromDocument(payload);

      if (result.success && result.data) {
        const extracted = result.data.extractedEntities.map(fromExtractedEntity);
        const derivedTitle = result.data.title || '';
        const derivedBudget = result.data.estimatedBudget ?? null;
        const derivedMajor = extracted[0]?.majorCategory || '';

        setForm((prev) => ({
          ...prev,
          title: prev.title || derivedTitle,
          estimatedBudget: prev.estimatedBudget ?? derivedBudget,
          majorCategory: prev.majorCategory || derivedMajor,
          lineItems: extracted.length > 0 ? extracted : prev.lineItems,
        }));

        setExtractionSummary({
          model: result.extraction?.model || 'Gemini 2.5 AI',
          accepted: result.classification?.accepted ?? extracted.length,
          needsReview: result.classification?.needsReview ?? 0,
          fileName: primaryFile.name,
        });

        showToast(
          EXTRACTION.successTitle,
          `Extracted ${extracted.length} line items successfully from "${primaryFile.name}".`,
          'success'
        );
      } else {
        setExtractionError(result.error || EXTRACTION.unreadableResponse);
        showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.unreadableResponse, 'warning');
      }
    } catch (err: any) {
      const msg = err?.message || EXTRACTION.unreadableResponse;
      setExtractionError(msg);
      showToast(EXTRACTION.fallbackTitle, msg, 'warning');
    } finally {
      setIsExtracting(false);
    }
  };

  /** Auto-categorize all line items with AI */
  const handleAutoCategorizeAll = async () => {
    const quotableEntities = form.lineItems.map((item) => ({
      id: item.id,
      itemName: item.itemName,
      technicalSpecs: item.technicalSpecs,
      quantity: Number(item.quantity) || 0,
      unit: item.unit,
      targetDate: item.targetDate,
      category: item.minorCategory,
      majorCategory: item.majorCategory,
      minorCategory: item.minorCategory,
      confidence: 0,
    })).filter((e) => e.itemName.trim() !== '');

    if (quotableEntities.length === 0) {
      showToast(EXTRACTION.classifyEmptyTitle, 'Please enter at least one item name to categorize.', 'warning');
      return;
    }

    setIsCategorizing(true);
    try {
      const result = await classifyLineItems(quotableEntities);
      if (!result.success || !result.data) {
        showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.classifyFailed, 'warning');
        return;
      }

      const classified = new Map(result.data.extractedEntities.map((e) => [e.id, e]));
      setForm((prev) => ({
        ...prev,
        lineItems: prev.lineItems.map((item) => {
          const matched = classified.get(item.id);
          if (!matched) return item;
          return {
            ...item,
            majorCategory: matched.majorCategory || item.majorCategory,
            minorCategory: matched.minorCategory || item.minorCategory,
          };
        }),
      }));

      showToast(
        EXTRACTION.classifySuccessTitle,
        `Auto-classified ${result.data.extractedEntities.length} items across standardized categories.`,
        'success'
      );
    } catch {
      showToast(EXTRACTION.fallbackTitle, 'Category classification service unavailable.', 'warning');
    } finally {
      setIsCategorizing(false);
    }
  };

  /** Store uploaded files as RFQ attachments before creating the RFQ */
  const uploadAttachments = async (): Promise<RFQAttachment[]> => {
    if (uploadedFiles.length === 0) return [];
    const attachments: RFQAttachment[] = [];

    for (const file of uploadedFiles) {
      try {
        const res = await uploadRFQAttachment(file);
        if (res.success && res.data) {
          attachments.push(res.data);
        }
      } catch {
        // Continue with other attachments
      }
    }
    return attachments;
  };

  /** Form Submission / RFQ Dispatch */
  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setSubmitError(null);

    if (!validateManualRFQForm(form).isValid) {
      showToast('Validation Error', 'Please complete all required fields and line items before dispatching.', 'warning');
      return;
    }

    if (isDispatching) return;
    setIsDispatching(true);

    try {
      setCurrentMode(form.sourcingMode);

      // Upload any staged files as attachments
      const storedAttachments = await uploadAttachments();
      const updatedForm: ManualRFQForm = {
        ...form,
        attachments: [...form.attachments, ...storedAttachments],
      };

      type AssignedVendorEntry = {
        id?: string;
        name: string;
        email?: string | null;
        contactPerson?: string | null;
        phone?: string | null;
      };
      const toAssignedVendorEntry = (v: VendorEntry): AssignedVendorEntry => ({
        id: v.id,
        name: v.name || 'Enterprise Vendor',
        email: v.email || null,
        contactPerson: v.contactPerson || v.name || null,
        phone: v.phone || null,
      });

      // A vendor only ever sees an RFQ if it's their own private-roster match
      // (addedByBuyerCompany) or they're explicitly on assignedVendors —
      // category match alone no longer grants visibility (CM invite-gating,
      // see storeService.vendorCoversRFQ). Mode 2 previously left
      // assignedVendors empty, so the buyer's private roster only got in via
      // the addedByBuyerCompany fallback and nothing else was ever invited.
      // Explicitly scoped to buyer-uploaded vendors only, same as Mode 1 —
      // no marketplace/category-matched vendors here by design.
      let mode1AssignedVendors: AssignedVendorEntry[] | undefined = undefined;

      if ((form.sourcingMode === 'mode_1' || form.sourcingMode === 'mode_2') && Array.isArray(buyerVendors)) {
        const myUploadedVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
        if (myUploadedVendors.length > 0) {
          mode1AssignedVendors = myUploadedVendors.map(toAssignedVendorEntry);
        }
      }

      // ALL_CATEGORIES_OPTION is a UI-only sentinel that opts a line item out
      // of category-narrowed matching — never a real taxonomy value, so it
      // must never reach the server as this item's majorCategory.
      const sanitizedForm: ManualRFQForm = {
        ...updatedForm,
        lineItems: updatedForm.lineItems.map((item) =>
          item.majorCategory === ALL_CATEGORIES_OPTION ? { ...item, majorCategory: '' } : item
        ),
      };
      const payload = toRFQCreatePayload(sanitizedForm, mode1AssignedVendors);
      const result = await createRFQ(payload);

      if (!result.success) {
        setSubmitError(result.error || 'Failed to create RFQ.');
        showToast('Creation Failed', result.error || 'Failed to create RFQ.', 'warning');
        return;
      }

      adoptCreatedRFQ(result.rfq);
      showToast(
        'RFQ Dispatched',
        `RFQ ${result.rfq.rfqNumber} has been created and dispatched in ${form.sourcingMode.toUpperCase()} mode.`,
        'success'
      );
      onComplete();
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to dispatch RFQ.');
    } finally {
      setIsDispatching(false);
    }
  };

  /** Clears all form fields, line items, and uploaded documents */
  const handleClearForm = () => {
    setForm({
      ...createEmptyManualRFQForm(),
      sourcingMode: currentMode || 'mode_2',
    });
    setUploadedFiles([]);
    setExtractionSummary(null);
    setExtractionError(null);
    setSubmitAttempted(false);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    showToast('Form Cleared', 'All fields, line items, and uploaded files have been reset.', 'info');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
              AI RFQ Ingestion & Multi-Mode Sourcing Dispatch
            </h1>
            <span className="badge badge-purple">Screen 1.2</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
            Create RFQ directly, upload BOQ documents or forwarded requisition emails, extract line items with AI, and dispatch to verified suppliers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearForm}
            type="button"
            className="btn btn-secondary btn-sm font-semibold inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-600 dark:text-gray-300 dark:hover:text-rose-400 cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>Clear Form</span>
          </button>
          <button onClick={onCancel} className="btn btn-secondary btn-sm font-semibold cursor-pointer">
            Exit Wizard
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TOP: DOCUMENT & REQUISITION EMAIL UPLOAD & AI EXTRACTION      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-indigo-100 dark:border-indigo-950 bg-gradient-to-br from-indigo-50/50 via-white to-sky-50/30 dark:from-gray-900/90 dark:via-gray-900/80 dark:to-indigo-950/20 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100/60 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud size={18} className="text-indigo-600 dark:text-indigo-400" />
              Upload Source Documents & Forwarded Emails
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Upload BOQ files (<span className="font-semibold text-slate-700 dark:text-slate-300">.xlsx, .xls, .csv, .pdf, .docx, .txt</span>) or Forwarded Requisition Emails (<span className="font-semibold text-indigo-600 dark:text-indigo-400">.eml, .msg</span>).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isExtracting}
              className="btn btn-secondary btn-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Paperclip size={13} /> Select Files
            </button>
            <button
              onClick={handleExtractFromFiles}
              disabled={isExtracting || uploadedFiles.length === 0}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isExtracting ? 'Extracting with AI...' : 'Extract Line Items with AI'}
            </button>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg"
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {/* Drag & Drop Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingDoc(true);
          }}
          onDragLeave={() => setIsDraggingDoc(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingDoc(false);
            if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
            isDraggingDoc
              ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
              : 'border-indigo-300/80 dark:border-indigo-500/30 hover:border-indigo-500 bg-white/70 dark:bg-gray-900/40 hover:bg-indigo-50/50'
          }`}
        >
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
              <FileSpreadsheet size={20} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-600/20 border border-sky-200 dark:border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform">
              <Mail size={20} />
            </div>
          </div>
          <h3 className="text-xs font-bold text-slate-800 dark:text-white mt-2">
            {isExtracting ? 'Gemini AI is parsing document contents...' : 'Drag and drop BOQ spreadsheets or .eml / .msg emails here'}
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
            Supports Excel (.xlsx, .xls), CSV, PDF specs, Word (.docx), and Outlook/MIME Email (.eml, .msg).
          </p>
        </div>

        {/* Uploaded Files List */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-gray-300">
              <span className="flex items-center gap-1.5">
                <FileCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                Uploaded Documents ({uploadedFiles.length})
              </span>
              <span className="text-[10px] text-slate-400">Click &quot;Extract Line Items with AI&quot; to auto-fill form</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {uploadedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {file.name.endsWith('.eml') || file.name.endsWith('.msg') ? (
                      <Mail size={16} className="text-sky-600 dark:text-sky-400 shrink-0" />
                    ) : (
                      <FileText size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-gray-200 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-400">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveFile(idx)}
                    className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    title="Remove file"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Extraction Outcome Banners */}
        {extractionSummary && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs">
            <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Sparkles size={14} /> Extraction Complete
            </div>
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200 mt-0.5">
              Successfully extracted <strong>{extractionSummary.accepted} line items</strong> from &ldquo;{extractionSummary.fileName}&rdquo; using {extractionSummary.model}. Review and adjust details below.
            </p>
          </div>
        )}

        {extractionError && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-1">
            <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertCircle size={14} /> Document Parsing Notice
            </div>
            <p className="text-[11px] text-amber-900/90 dark:text-amber-200">{extractionError}</p>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300 font-semibold">
              You can key line items directly in the table below.
            </p>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: RFQ DETAILS & DELIVERY SPECIFICATIONS              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="border-b border-slate-100 dark:border-gray-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText size={18} className="text-indigo-600 dark:text-indigo-400" />
            1. RFQ Details & Delivery Terms
          </h2>
          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
            Specify the procurement title, target location, and financial parameters for this requirement.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-xs">
          {/* RFQ Title */}
          <div className="xl:col-span-2">
            <label htmlFor="rfq-title" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.titleLabel}
            </label>
            <input
              id="rfq-title"
              type="text"
              value={form.title}
              onChange={(e) => patchForm('title', e.target.value)}
              placeholder={MODAL.titlePlaceholder}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.title} />
          </div>

          {/* Estimated Budget */}
          <div>
            <label htmlFor="rfq-budget" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {formatString(MODAL.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
              <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">({MODAL.optionalTag})</span>
            </label>
            <input
              id="rfq-budget"
              type="number"
              min={0}
              value={form.estimatedBudget ?? ''}
              onChange={(e) => patchForm('estimatedBudget', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="e.g. 500000"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white mono font-semibold focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.estimatedBudget} />
          </div>

          {/* Delivery Location */}
          <div>
            <label htmlFor="rfq-location" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.deliveryLocationLabel}
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-0.5">*</span>
            </label>
            <input
              id="rfq-location"
              type="text"
              required
              value={form.deliveryLocation}
              onChange={(e) => patchForm('deliveryLocation', e.target.value)}
              placeholder={MODAL.deliveryLocationPlaceholder}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.deliveryLocation} />
          </div>

          {/* Delivery Pincode */}
          <div>
            <label htmlFor="rfq-pincode" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.deliveryPincodeLabel}
              <span className="text-rose-600 dark:text-rose-400 font-bold ml-0.5">*</span>
            </label>
            <input
              id="rfq-pincode"
              type="text"
              required
              value={form.deliveryPincode}
              onChange={(e) => patchForm('deliveryPincode', e.target.value)}
              placeholder={MODAL.deliveryPincodePlaceholder}
              maxLength={10}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white mono font-semibold focus:ring-2 focus:ring-indigo-500"
            />
            <FieldError message={formErrors.deliveryPincode} />
          </div>

          {/* Target Delivery Date */}
          <div>
            <label htmlFor="rfq-date" className="block font-semibold text-slate-700 dark:text-gray-300 mb-1">
              {MODAL.targetDateLabel}
            </label>
            <input
              id="rfq-date"
              type="date"
              value={form.targetDeliveryDate}
              onChange={(e) => patchForm('targetDeliveryDate', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: LINE ITEMS & TAXONOMY CATEGORIZATION TABLE         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
              2. Line Items Specification ({form.lineItems.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Classify each item into its standardized <strong>Major Category</strong> and <strong>Minor Category</strong> from the verified taxonomy.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoCategorizeAll}
              disabled={isCategorizing || form.lineItems.length === 0}
              className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold disabled:opacity-50"
            >
              {isCategorizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {isCategorizing ? 'Classifying...' : 'Auto-Categorize All (AI)'}
            </button>
            <button
              onClick={() => setForm(addManualRFQLineItem(form))}
              className="btn btn-primary btn-sm font-bold flex items-center gap-1 shadow-xs"
            >
              <Plus size={14} /> Add Line Item
            </button>
          </div>
        </div>

        <FieldError message={formErrors.lineItems} />

        {form.lineItems.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-gray-700 bg-slate-50/50 dark:bg-gray-900/40 space-y-3">
            <p className="text-sm font-medium text-slate-600 dark:text-gray-300">No line items added yet.</p>
            <button
              onClick={() => setForm(addManualRFQLineItem(form))}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Add First Line Item
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
            <table className="w-full text-left min-w-[1080px] text-xs">
              <thead className="bg-slate-50 dark:bg-gray-950/60 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gray-400 border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colItem}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colSpecs}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colQty}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colUnit}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colTargetDate}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMajor}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMinor}</th>
                  <th className="px-3 py-2.5 text-center font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {form.lineItems.map((item) => {
                  const errors = lineItemErrors[item.id] || {};
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-800/40 transition-colors">
                      {/* Item Name */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colItem}
                          value={item.itemName}
                          onChange={(e) => patchItem(item.id, { itemName: e.target.value })}
                          placeholder={MODAL.itemPlaceholder}
                          className="w-56 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.itemName} />
                      </td>

                      {/* Specs */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colSpecs}
                          value={item.technicalSpecs}
                          onChange={(e) => patchItem(item.id, { technicalSpecs: e.target.value })}
                          placeholder={MODAL.specsPlaceholder}
                          className="w-48 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500"
                        />
                      </td>

                      {/* Quantity */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="number"
                          min={1}
                          aria-label={MODAL.colQty}
                          value={item.quantity ?? ''}
                          onChange={(e) =>
                            patchItem(item.id, {
                              quantity: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                          placeholder={MODAL.qtyPlaceholder}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 mono font-semibold focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.quantity} />
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="text"
                          aria-label={MODAL.colUnit}
                          value={item.unit}
                          onChange={(e) => patchItem(item.id, { unit: e.target.value })}
                          placeholder={MODAL.unitPlaceholder}
                          className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        />
                        <FieldError message={errors.unit} />
                      </td>

                      {/* Target Date */}
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="date"
                          aria-label={MODAL.colTargetDate}
                          value={item.targetDate}
                          onChange={(e) => patchItem(item.id, { targetDate: e.target.value })}
                          className="w-36 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500"
                        />
                      </td>

                      {/* Major Category */}
                      <td className="px-3 py-2.5 align-top">
                        <select
                          aria-label={MODAL.colMajor}
                          value={item.majorCategory}
                          onChange={(e) => patchItem(item.id, { majorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">{MODAL.selectPlaceholder}</option>
                          <option value={ALL_CATEGORIES_OPTION}>All Categories</option>
                          {taxonomyMajors().map((major) => (
                            <option key={major} value={major}>
                              {major}
                            </option>
                          ))}
                        </select>
                        <FieldError message={errors.majorCategory} />
                      </td>

                      {/* Minor Category */}
                      <td className="px-3 py-2.5 align-top">
                        <select
                          aria-label={MODAL.colMinor}
                          value={item.minorCategory}
                          disabled={!item.majorCategory || item.majorCategory === ALL_CATEGORIES_OPTION}
                          onChange={(e) => patchItem(item.id, { minorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium disabled:opacity-40 focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">
                            {item.majorCategory === ALL_CATEGORIES_OPTION ? 'Not required' : MODAL.selectPlaceholder}
                          </option>
                          {minorsFor(item.majorCategory).map((minor) => (
                            <option key={minor} value={minor}>
                              {minor}
                            </option>
                          ))}
                        </select>
                        <FieldError message={errors.minorCategory} />
                      </td>

                      {/* Delete */}
                      <td className="px-3 py-2.5 align-top text-center">
                        <button
                          onClick={() => setForm(removeManualRFQLineItem(form, item.id))}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Remove line item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 3: SOURCING MODE SELECTION CARDS                      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <section className="glass-panel p-6 rounded-2xl space-y-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-xs">
        <div className="border-b border-slate-100 dark:border-gray-800 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 size={18} className="text-indigo-600 dark:text-indigo-400" />
              3. Select Sourcing Mode
            </h2>
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400">
              Choose how suppliers are matched and invited
            </span>
          </div>
        </div>

        <div role="radiogroup" aria-label="Sourcing Mode" className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SOURCING_MODES.map((mode, index) => {
            const isSelected = form.sourcingMode === mode.id;
            const modeConfig = [
              {
                icon: '🎯',
                badge: 'STARTER',
                badgeStyle: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                activeBorder: 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/40 dark:bg-blue-950/30',
              },
              {
                icon: '⚡',
                badge: 'RECOMMENDED',
                badgeStyle: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
                activeBorder: 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-950/30',
              },
              {
                icon: '🚀',
                badge: 'FULL REACH',
                badgeStyle: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
                activeBorder: 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-950/30',
              },
            ][index];

            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`mode-${mode.id}`}
                onClick={() => patchForm('sourcingMode', mode.id as SourcingMode)}
                className={`group relative text-left rounded-2xl border p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? `${modeConfig.activeBorder} shadow-sm`
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
                }`}
              >
                <div>
                  {/* Top Header: Icon + Badges + Radio */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg shadow-2xs ${
                        isSelected ? 'bg-white dark:bg-gray-800' : 'bg-slate-100 dark:bg-gray-800'
                      }`}
                    >
                      {modeConfig.icon}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[9px] font-extrabold tracking-wider uppercase border ${modeConfig.badgeStyle}`}
                      >
                        {modeConfig.badge}
                      </span>
                      <span
                        className={`flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-900'
                        }`}
                      >
                        {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h4
                    className={`text-sm font-black tracking-tight ${
                      isSelected ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-gray-100'
                    }`}
                  >
                    {mode.shortLabel}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-gray-400">
                    {mode.description}
                  </p>
                </div>

                {/* Bottom Feature Pill */}
                <div
                  className={`mt-4 rounded-xl p-2.5 border transition-all ${
                    isSelected
                      ? 'bg-white/95 dark:bg-gray-800/90 border-indigo-200/80 dark:border-indigo-900/60 shadow-2xs'
                      : 'bg-slate-50 dark:bg-gray-950/60 border-slate-200/60 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      size={14}
                      className={`mt-0.5 shrink-0 ${
                        isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-gray-500'
                      }`}
                    />
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-gray-300 leading-snug">
                      {mode.featureSummary}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Mode 1: Private Approved Vendor Roster Preview ── */}
        {form.sourcingMode === 'mode_1' && (
          <div className="mt-5 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/40 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-600 text-white shadow-xs">
                  <Building2 size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Mode 1: Buyer&apos;s Approved Vendor Roster</span>
                    <span className="badge badge-blue text-[10px] font-bold">
                      {buyerVendors.filter((v) => isBuyerUploaded(v)).length} Suppliers Found
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                    This RFQ will strictly be dispatched to your private, pre-approved supplier network below.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                🔒 Private Roster Only
              </span>
            </div>

            {(() => {
              const myVendors = buyerVendors.filter((v) => isBuyerUploaded(v));
              if (myVendors.length === 0) {
                return (
                  <div className="p-6 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 space-y-2">
                    <Users size={28} className="mx-auto text-slate-400 opacity-60" />
                    <p className="text-xs font-bold text-slate-700 dark:text-gray-300">No Private Vendors Uploaded Yet</p>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 max-w-md mx-auto">
                      Please ingest your 1–3 Year Purchase Orders or add approved vendors in the Vendor Directory to auto-dispatch in Mode 1.
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                  {myVendors.map((vendor, idx) => {
                    const rawMinor = vendor.minorCategories as string | string[] | undefined;
                    const minorList: string[] = Array.isArray(rawMinor)
                      ? rawMinor
                      : typeof rawMinor === 'string'
                      ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                      : Array.isArray(vendor.vendorSelectedCategories)
                      ? vendor.vendorSelectedCategories
                      : [];

                    return (
                      <div
                        key={vendor.id || idx}
                        className="rounded-xl border border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-3.5 space-y-2 shadow-2xs hover:border-blue-300 dark:hover:border-blue-700 transition-all"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-xs font-bold font-mono">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate" title={vendor.name}>
                              {vendor.name}
                            </span>
                          </div>
                          <span className="badge badge-emerald text-[9px] font-bold shrink-0">
                            Preferred
                          </span>
                        </div>

                        <div className="space-y-1 text-[11px] text-slate-600 dark:text-gray-300">
                          {vendor.contactPerson && (
                            <div className="flex items-center gap-1.5 text-slate-700 dark:text-gray-300">
                              <Users size={11} className="text-slate-400 shrink-0" />
                              <span className="truncate">{vendor.contactPerson}</span>
                            </div>
                          )}
                          {vendor.email && (
                            <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                              <Mail size={11} className="text-blue-500 shrink-0" />
                              <span className="font-mono text-[10px] truncate">{vendor.email}</span>
                            </div>
                          )}
                          {vendor.phone && (
                            <div className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400">
                              <Phone size={11} className="text-emerald-500 shrink-0" />
                              <span className="font-mono text-[10px]">{vendor.phone}</span>
                            </div>
                          )}
                        </div>

                        {/* Category & Rating */}
                        <div className="pt-2 border-t border-slate-100 dark:border-gray-800 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="font-semibold text-blue-700 dark:text-blue-300 truncate max-w-[150px]">
                              {vendor.majorCategory || 'General Industrial'}
                            </span>
                            <span className="text-amber-500 font-bold flex items-center gap-0.5 shrink-0">
                              <Star size={10} className="fill-amber-400 text-amber-400" />
                              <span>{vendor.rating || 4.5}</span>
                            </span>
                          </div>
                          {minorList.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {minorList.slice(0, 2).map((cat: string, ci: number) => (
                                <span
                                  key={ci}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-gray-700/60 truncate max-w-[120px]"
                                  title={cat}
                                >
                                  {cat}
                                </span>
                              ))}
                              {minorList.length > 2 && (
                                <span className="text-[8px] font-bold text-slate-400 dark:text-gray-500 self-center">
                                  +{minorList.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Mode 2: Hybrid Sourcing Pool (Private Roster + Procucev Marketplace) ── */}
        {form.sourcingMode === 'mode_2' && (
          <div className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            {(() => {
              const myVendors = buyerVendors.filter(isBuyerUploaded);
              const { signals: rfqSignals } = extractRfqCategorySignals(form);
              const matchedProcucev = getCategoryMatchedProcucevVendors(buyerVendors, rfqSignals, 80);

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-100 dark:border-emerald-900/40 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-600 text-white shadow-xs">
                        <Sparkles size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Mode 2: Hybrid Sourcing Pool (Private Roster + Procucev Marketplace)</span>
                          <span className="badge badge-emerald text-[10px] font-bold">
                            {myVendors.length + (isAllCategories ? (allVendorsPagination?.total ?? allVendorsList.length) : matchedProcucev.length)} Suppliers Matched
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                          {isAllCategories
                            ? `Combines your approved roster (${myVendors.length}) with the whole Procucev marketplace directory (${(allVendorsPagination?.total ?? allVendorsList.length).toLocaleString()} suppliers, searchable) since "All Categories" was chosen.`
                            : `Combines your approved roster (${myVendors.length}) with AI category-matched Procucev marketplace suppliers (${matchedProcucev.length}) for optimal price discovery.`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowAiInfo(!showAiInfo)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 bg-emerald-100/80 dark:bg-emerald-900/60 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                        title="Learn how AI categorizes and matches suppliers"
                      >
                        <Info size={13} />
                        <span>AI Matching Criteria</span>
                      </button>
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/50 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 shrink-0">
                        ⚡ Hybrid Multi-Channel
                      </span>
                    </div>
                  </div>

                  {/* AI Matching Info Panel */}
                  {showAiInfo && (
                    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800/60 text-slate-800 dark:text-gray-200 space-y-3 animate-fade-in shadow-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-xs text-emerald-800 dark:text-emerald-200">
                          <Sparkles size={15} className="text-emerald-600 dark:text-emerald-400" />
                          <span>How QUA AI Categorizes Line Items & Matches Marketplace Suppliers</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAiInfo(false)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          ✕ Close
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] leading-relaxed">
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">1. BOQ & Line-Item Classification</strong>
                          Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">2. Multi-Signal Supplier Scoring</strong>
                          Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">3. ≥80% Relevance Threshold</strong>
                          Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40">
                          <strong className="text-emerald-800 dark:text-emerald-300 block mb-1">4. Category Benchmarking</strong>
                          Evaluates vendor reliability ratings, location proximity, and verified product specifications.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Buyer Approved Roster */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Building2 size={13} className="text-blue-600 dark:text-blue-400" />
                        <span>Buyer Approved Roster ({myVendors.length} Private Vendors)</span>
                      </h4>
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">Direct Invites</span>
                    </div>

                    {myVendors.length === 0 ? (
                      <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500">
                        No private vendors found — Procucev verified vendors will serve this RFQ.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto pr-1">
                        {myVendors.map((v, i) => (
                          <div key={v.id || i} className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-slate-200/80 dark:border-gray-800 space-y-1 shadow-2xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{v.name}</span>
                              <span className="badge badge-blue text-[8px] font-bold shrink-0">Private</span>
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                              <span className="font-semibold text-slate-700 dark:text-gray-300">{v.majorCategory || 'General Industrial'}</span>
                              <span>{v.location || v.city || v.state || 'India'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Procucev AI-Matched Verified Vendors from Real Database */}
                  <div className="space-y-2 pt-2 border-t border-emerald-100 dark:border-emerald-900/40">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Sparkles size={13} className="text-emerald-600 dark:text-emerald-400" />
                        <span>
                          Procucev Verified Marketplace Suppliers (
                          {isAllCategories ? (allVendorsPagination ? allVendorsPagination.total.toLocaleString() : allVendorsList.length) : matchedProcucev.length} Matched)
                        </span>
                      </h4>
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold">
                        {isAllCategories ? 'All Categories' : 'Category Matched'}
                      </span>
                    </div>

                    {isAllCategories ? (
                      renderAllVendorsBrowsePanel('emerald')
                    ) : matchedProcucev.length === 0 ? (
                      <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500 space-y-1">
                        <p className="font-semibold text-slate-600 dark:text-gray-400">No marketplace suppliers directly matching this category yet.</p>
                        <p className="text-[10px] text-slate-400">Your RFQ will dispatch to your private roster, and category managers will assist with extended sourcing.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                        {matchedProcucev.map(({ vendor: v, matchScore, matchedMajor, matchedCategories }) => {
                          const rawMinor = v.minorCategories as string | string[] | undefined;
                          const minorList = Array.isArray(matchedCategories) && matchedCategories.length > 0
                            ? matchedCategories
                            : Array.isArray(rawMinor)
                            ? rawMinor
                            : typeof rawMinor === 'string'
                            ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                            : [];

                          return (
                            <div
                              key={v.id}
                              className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-emerald-200/70 dark:border-emerald-900/50 space-y-1.5 shadow-2xs hover:border-emerald-400 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="text-xs font-bold text-slate-900 dark:text-white truncate" title={v.name}>{v.name}</span>
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/40 shrink-0">
                                  {matchScore}% Match
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-gray-400 flex items-center justify-between">
                                <span className="truncate font-semibold text-emerald-700 dark:text-emerald-300">{matchedMajor || v.majorCategory || 'General Industrial'}</span>
                                <span className="truncate">{v.city || v.state || v.location || 'India'}</span>
                              </div>
                              {minorList.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100 dark:border-gray-800">
                                  {minorList.slice(0, 2).map((cat: string, ci: number) => (
                                    <span
                                      key={ci}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-gray-700/60 truncate max-w-[120px]"
                                      title={cat}
                                    >
                                      {cat}
                                    </span>
                                  ))}
                                  {minorList.length > 2 && (
                                    <span className="text-[8px] font-bold text-slate-400 dark:text-gray-500 self-center">
                                      +{minorList.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="pt-1 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between text-[9px]">
                                <span className="text-slate-400 truncate">{v.contactPerson || 'Verified Supplier'}</span>
                                <span className="text-amber-500 font-bold flex items-center gap-0.5 shrink-0">
                                  <Star size={9} className="fill-amber-400 text-amber-400" />
                                  <span>{v.rating || 4.5}</span>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Mode 3: Autonomous Sourcing & Double-Blind Verification Protocol (Version 3) ── */}
        {form.sourcingMode === 'mode_3' && (
          <div className="mt-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-5 space-y-4 animate-fade-in shadow-xs">
            {(() => {
              const { signals: rfqSignals } = extractRfqCategorySignals(form);
              const matchedProcucev = getCategoryMatchedProcucevVendors(buyerVendors, rfqSignals, 80);

              return (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/40 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-xs">
                        <ShieldCheck size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>Mode 3: Autonomous Sourcing & Double-Blind Verification Protocol</span>
                          <span className="badge badge-indigo text-[10px] font-bold">
                            {isAllCategories ? (allVendorsPagination?.total ?? allVendorsList.length) : matchedProcucev.length} Database Suppliers Queued
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
                          {isAllCategories
                            ? 'Browsing the whole verified marketplace directory since "All Categories" was chosen — search below to narrow it. Your corporate identity remains confidential.'
                            : 'Suppliers with >80% category match receive an anonymous capability questionnaire. Your corporate identity remains confidential.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowAiInfo(!showAiInfo)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 bg-indigo-100/80 dark:bg-indigo-900/60 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                        title="Learn how AI categorizes and matches suppliers"
                      >
                        <Info size={13} />
                        <span>AI Matching Criteria</span>
                      </button>
                      <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-900/50 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 shrink-0">
                        🛡️ Double-Blind Active
                      </span>
                    </div>
                  </div>

                  {/* AI Matching Info Panel */}
                  {showAiInfo && (
                    <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800/60 text-slate-800 dark:text-gray-200 space-y-3 animate-fade-in shadow-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-xs text-indigo-800 dark:text-indigo-200">
                          <Sparkles size={15} className="text-indigo-600 dark:text-indigo-400" />
                          <span>How QUA AI Categorizes Line Items & Matches Suppliers for Double-Blind Evaluation</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAiInfo(false)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          ✕ Close
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px] leading-relaxed">
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">1. BOQ & Line-Item Classification</strong>
                          Extracts items and maps keywords against our 280+ standard industrial category taxonomy.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">2. Multi-Signal Supplier Scoring</strong>
                          Matches vendor primary capabilities, registered minor categories, and historical PO delivery records.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">3. ≥80% Relevance Threshold</strong>
                          Ensures only verified suppliers with direct capability overlap receive RFQ invitations.
                        </div>
                        <div className="p-2.5 rounded-lg bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40">
                          <strong className="text-indigo-800 dark:text-indigo-300 block mb-1">4. Double-Blind Confidentiality Protocol</strong>
                          Supplier capability invites are anonymized; buyer identity is withheld until qualification.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Explanatory banner */}
                  <div className="p-3.5 rounded-xl bg-indigo-100/50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-[11px] text-indigo-950 dark:text-indigo-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-indigo-900 dark:text-indigo-300">
                      <ShieldCheck size={14} />
                      <span>Evaluation-First Protocol Active</span>
                    </div>
                    <p>
                      {isAllCategories
                        ? `The RFQ will be sent immediately to your private roster. Simultaneously, suppliers you invite from the whole verified marketplace directory below will receive an anonymous RFQ evaluation invite with specifications, while your company identity stays 100% confidential.`
                        : `The RFQ will be sent immediately to your private roster. Simultaneously, the ${matchedProcucev.length} category-matched Procucev database vendors below will receive an anonymous RFQ evaluation invite with specifications, while your company identity stays 100% confidential.`}
                    </p>
                  </div>

                  {/* Procucev Database Vendors Grid from Real Database */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Users size={13} className="text-indigo-600 dark:text-indigo-400" />
                        <span>Vetted Procucev Database Suppliers (Invited for Double-Blind Evaluation)</span>
                      </h4>
                      <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                        {isAllCategories ? (allVendorsPagination?.total ?? allVendorsList.length) : matchedProcucev.length} {isAllCategories ? 'Suppliers' : 'Database Matches'}
                      </span>
                    </div>

                    {isAllCategories ? (
                      renderAllVendorsBrowsePanel('indigo')
                    ) : matchedProcucev.length === 0 ? (
                      <div className="p-3.5 text-center rounded-xl bg-white dark:bg-gray-900/60 border border-slate-200 dark:border-gray-800 text-[11px] text-slate-500 space-y-1">
                        <p className="font-semibold text-slate-600 dark:text-gray-400">No database vendors with &gt;80% match in this category.</p>
                        <p className="text-[10px] text-slate-400">The RFQ will be routed to your private roster while our AI category desk identifies qualified suppliers.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                        {matchedProcucev.map(({ vendor: v, matchScore, matchedMajor, matchedCategories }) => {
                          const rawMinor = v.minorCategories as string | string[] | undefined;
                          const minorList = Array.isArray(matchedCategories) && matchedCategories.length > 0
                            ? matchedCategories
                            : Array.isArray(rawMinor)
                            ? rawMinor
                            : typeof rawMinor === 'string'
                            ? (rawMinor as string).split(',').map((s: string) => s.trim()).filter(Boolean)
                            : [];

                          return (
                            <div
                              key={v.id}
                              className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-indigo-200/70 dark:border-indigo-900/50 space-y-2 shadow-2xs hover:border-indigo-400 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <div>
                                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                    <span className="truncate" title={v.name}>{v.name}</span>
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/40 shrink-0">
                                      {matchScore}% Match
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">{matchedMajor || v.majorCategory || 'General Industrial'} · {v.city || v.state || v.location || 'India'}</div>
                                </div>
                              </div>

                              {minorList.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100 dark:border-gray-800">
                                  {minorList.slice(0, 3).map((cat: string, ci: number) => (
                                    <span
                                      key={ci}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-medium bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border border-slate-200/60 dark:border-gray-700/60 truncate max-w-[120px]"
                                      title={cat}
                                    >
                                      {cat}
                                    </span>
                                  ))}
                                  {minorList.length > 3 && (
                                    <span className="text-[8px] font-bold text-slate-400 dark:text-gray-500 self-center">
                                      +{minorList.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="pt-1.5 border-t border-slate-100 dark:border-gray-800 flex items-center justify-between text-[9px]">
                                <span className="text-slate-500 font-medium">Rating: ⭐ <strong className="text-slate-700 dark:text-gray-300">{v.rating || 4.5}</strong></span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                                  🔒 Double-Blind
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FOOTER ACTIONS & SUBMISSION                                   */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {submitError && (
        <p role="alert" className="flex items-start gap-2 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{submitError}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-4 pt-5 pb-6 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <button onClick={onCancel} disabled={isDispatching} type="button" className="btn btn-secondary font-semibold cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleClearForm}
            disabled={isDispatching}
            type="button"
            className="btn btn-secondary font-semibold inline-flex items-center gap-1.5 text-slate-600 hover:text-rose-600 dark:text-gray-300 dark:hover:text-rose-400 cursor-pointer"
          >
            <RotateCcw size={14} />
            <span>Clear Form</span>
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isDispatching}
          className="btn btn-primary font-black flex items-center gap-2 px-6 py-2.5 shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer"
        >
          {isDispatching ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Creating & Dispatching RFQ...</span>
            </>
          ) : (
            <>
              <Send size={16} />
              <span>Create & Dispatch RFQ</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
