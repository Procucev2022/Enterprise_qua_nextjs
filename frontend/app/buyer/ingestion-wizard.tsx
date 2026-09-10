'use client';

import React, { useState, useRef, useMemo, useCallback } from 'react';
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
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQExtractionResult,
  SourcingMode,
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
} from 'lucide-react';

const EXTRACTION = UI_STRINGS.rfqExtraction;
const MODAL = UI_STRINGS.manualRfqModal;

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
  } = useApp();

  const [form, setForm] = useState<ManualRFQForm>(() => ({
    ...createEmptyManualRFQForm(),
    sourcingMode: currentMode || 'mode_2',
  }));

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

      const payload = toRFQCreatePayload(updatedForm);
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
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMajor}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colMinor}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colQty}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colUnit}</th>
                  <th className="px-3 py-2.5 font-bold">{MODAL.colTargetDate}</th>
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

                      {/* Major Category */}
                      <td className="px-3 py-2.5 align-top">
                        <select
                          aria-label={MODAL.colMajor}
                          value={item.majorCategory}
                          onChange={(e) => patchItem(item.id, { majorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">{MODAL.selectPlaceholder}</option>
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
                          disabled={!item.majorCategory}
                          onChange={(e) => patchItem(item.id, { minorCategory: e.target.value })}
                          className="w-44 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 font-medium disabled:opacity-40 focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">{MODAL.selectPlaceholder}</option>
                          {minorsFor(item.majorCategory).map((minor) => (
                            <option key={minor} value={minor}>
                              {minor}
                            </option>
                          ))}
                        </select>
                        <FieldError message={errors.minorCategory} />
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
                badgeStyle: 'bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300 border-purple-200 dark:border-purple-800',
                activeBorder: 'border-purple-500 ring-2 ring-purple-500/20 bg-purple-50/40 dark:bg-purple-950/30',
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
