'use client';

// ==============================================================================
// MANUAL RFQ ENTRY MODAL
// ==============================================================================
// Opened from the Manual tab on the ingestion wizard. Everything the buyer keys
// lives in a single ManualRFQForm from lib/manualRfqModel, so the rules about when
// an RFQ may be dispatched are stated once and tested without rendering a screen.
//
// The RFQ number is not shown or chosen here. The server allocates it under the
// same scheme the Java p2pservices application uses, and this dialog adopts what
// the server returns rather than assuming what it saved.
// ==============================================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  X,
  Loader2,
  Send,
  AlertCircle,
  Paperclip,
  FileText,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import { CURRENCY, SOURCING_MODES } from '@/lib/constants';
import { createRFQ, extractLineItemsFromDocument, uploadRFQAttachment } from '@/lib/rfqClient';
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
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  ManualRFQForm,
  ManualRFQLineItem,
  RFQAttachment,
  RFQItem,
  SourcingMode,
} from '@/lib/types';

const MANUAL = UI_STRINGS.manualRfq;
const MODAL = UI_STRINGS.manualRfqModal;

// Read at render time from the taxonomy registry the store populates from the
// database, not captured at module scope from a bundled JSON file. A bundled copy
// could offer a category the master no longer contains, and the row is dispatched
// to vendors under whatever is selected here.
function taxonomyMajors(): string[] {
  return getMajorCategories();
}

function minorsFor(major: string): string[] {
  return getMinorCategories(major);
}

interface ManualRFQModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the server's saved record once the RFQ is created. */
  onCreated: (rfq: RFQItem) => void;
}

/** A field-level validation message, rendered only once the buyer has submitted. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">{message}</p>;
}

export default function ManualRFQModal({ isOpen, onClose, onCreated }: ManualRFQModalProps) {
  const [form, setForm] = useState<ManualRFQForm>(createEmptyManualRFQForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  /**
   * The chosen File objects, kept only so extraction can re-read their bytes.
   *
   * A ref rather than state: the uploaded attachment metadata is what the form
   * carries, and re-rendering on every file selection buys nothing. The bytes
   * themselves are never put on the form, because a 10MB PDF is roughly 13MB of
   * base64 in every subsequent render.
   */
  const pendingFilesRef = useRef<File[]>([]);

  const validation = useMemo(() => validateManualRFQForm(form), [form]);

  // Held back until the buyer tries to save. Validating on open would greet them
  // with a screen of red against fields they have not reached.
  const formErrors = submitAttempted ? validation.formErrors : {};
  const lineItemErrors = submitAttempted ? validation.lineItemErrors : {};

  const patchForm = useCallback(<K extends keyof ManualRFQForm>(key: K, value: ManualRFQForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<ManualRFQLineItem>) => {
    setForm((prev) => updateManualRFQLineItem(prev, id, patch));
  }, []);

  /**
   * Upload each chosen file and keep only its metadata on the form.
   *
   * Uploaded one at a time so a single rejected file is reported against that
   * file rather than failing the whole selection.
   */
  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsAttaching(true);
    setAttachError(null);
    // Retained for extraction, which needs the bytes rather than the metadata.
    pendingFilesRef.current = [...pendingFilesRef.current, ...Array.from(files)];
    const stored: RFQAttachment[] = [];
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      // eslint-disable-next-line no-await-in-loop -- reported per file, so each
      // upload has to resolve before the next is attempted.
      const result = await uploadRFQAttachment(file);
      if (result.success && result.data) stored.push(result.data);
      else failures.push(`${file.name}: ${result.error || ''}`.trim());
    }

    if (stored.length > 0) {
      setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...stored] }));
    }
    if (failures.length > 0) setAttachError(failures.join(' | '));

    setIsAttaching(false);
    // Cleared so choosing the same file again still fires a change event.
    if (attachInputRef.current) attachInputRef.current.value = '';
  };

  /**
   * Read the attached documents and fill the line-item table from them.
   *
   * Optional on this path: the buyer may key everything by hand. When extraction
   * succeeds the rows are replaced with what was read, and they remain fully
   * editable — nothing is locked, because the model can misread a scan and the
   * buyer is the one who has to stand behind the numbers sent to vendors.
   *
   * A failure is reported and changes nothing, so a bad extraction never costs the
   * buyer rows they had already keyed.
   */
  const handleExtractFromDocuments = async () => {
    const files = pendingFilesRef.current;
    if (files.length === 0) return;

    setIsExtracting(true);
    setExtractError(null);

    const extracted: ManualRFQLineItem[] = [];
    const failures: string[] = [];
    let derivedTitle = '';
    let derivedBudget: number | null = null;

    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop -- each document is reported
      // against itself, so they are read one at a time.
      const request = await buildExtractionRequest(file);
      // eslint-disable-next-line no-await-in-loop
      const result = await extractLineItemsFromDocument(request);

      if (!result.success || !result.data) {
        failures.push(`${file.name}: ${result.error}`);
        continue;
      }
      if (!derivedTitle && result.data.title) derivedTitle = result.data.title;
      if (derivedBudget === null && result.data.estimatedBudget) {
        derivedBudget = result.data.estimatedBudget;
      }
      extracted.push(...result.data.extractedEntities.map(fromExtractedEntity));
    }

    setIsExtracting(false);

    if (failures.length > 0) setExtractError(failures.join(' | '));
    if (extracted.length === 0) return;

    setForm((prev) => ({
      ...prev,
      title: prev.title || derivedTitle,
      estimatedBudget: prev.estimatedBudget ?? derivedBudget,
      majorCategory: prev.majorCategory || extracted[0].majorCategory,
      lineItems: extracted,
    }));
  };

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setSubmitError(null);

    if (!validateManualRFQForm(form).isValid) return;

    setIsSaving(true);
    const result = await createRFQ(toRFQCreatePayload(form));
    setIsSaving(false);

    if (!result.success) {
      setSubmitError(result.error);
      return;
    }

    // The server's record is the authority: it owns the RFQ number, the row id,
    // the created timestamp and the generated summary.
    onCreated(result.rfq);
    setForm(createEmptyManualRFQForm());
    setSubmitAttempted(false);
    onClose();
  };

  const handleClose = () => {
    if (isSaving) return;
    setSubmitError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-rfq-modal-title"
      data-testid="manual-rfq-modal"
    >
      <div className="w-full max-w-5xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-800 my-auto">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-gray-800">
          <div>
            <h2
              id="manual-rfq-modal-title"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              {MODAL.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 max-w-2xl">
              {MODAL.subtitle}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={isSaving}
            aria-label={MODAL.closeAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-5 text-xs">
          {/* ── Supporting documents ──────────────────────────────────────── */}
          {/* Stored server-side and downloadable from the RFQ. Never sent for AI
              extraction: this is the manual path, so the document is evidence to
              attach rather than something to be read. */}
          <section className="p-3 rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/60 dark:bg-gray-950/40 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Paperclip size={13} className="text-slate-500 dark:text-gray-400" />
                  {MODAL.attachHeading}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 max-w-xl">
                  {MODAL.attachHint}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => attachInputRef.current?.click()}
                  disabled={isAttaching || isExtracting}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Paperclip size={13} />
                  {isAttaching ? MODAL.attachingAction : MODAL.attachAction}
                </button>
                {/* Optional. Extraction reads the document and fills the table
                    below; the buyer can still key or correct every row after. */}
                <button
                  onClick={handleExtractFromDocuments}
                  disabled={isAttaching || isExtracting || pendingFilesRef.current.length === 0}
                  data-testid="manual-extract"
                  className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isExtracting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {isExtracting ? MODAL.extractingAction : MODAL.extractAction}
                </button>
              </div>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                data-testid="manual-modal-attachment-input"
                className="hidden"
                onChange={(e) => handleAttach(e.target.files)}
              />
            </div>

            {attachError && (
              <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-400">
                {attachError}
              </p>
            )}
            {/* An extraction failure changes nothing, so it is reported without
                disturbing rows the buyer has already keyed. */}
            {extractError && (
              <p role="alert" className="text-[11px] text-amber-700 dark:text-amber-400">
                {extractError}
              </p>
            )}

            {form.attachments.length > 0 && (
              <ul className="space-y-1.5">
                {form.attachments.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText size={13} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-gray-200 truncate">
                        {file.fileName}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        patchForm(
                          'attachments',
                          form.attachments.filter((a) => a.id !== file.id)
                        )
                      }
                      aria-label={formatString(MODAL.removeAttachmentAria, { fileName: file.fileName })}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Header fields ─────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="xl:col-span-2">
              <label htmlFor="manual-rfq-title" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {MODAL.titleLabel}
              </label>
              <input
                id="manual-rfq-title"
                type="text"
                value={form.title}
                onChange={(e) => patchForm('title', e.target.value)}
                placeholder={MODAL.titlePlaceholder}
                maxLength={200}
                className="font-medium"
              />
              <FieldError message={formErrors.title} />
            </div>

            <div>
              <label htmlFor="manual-rfq-budget" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {formatString(MODAL.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                  ({MODAL.optionalTag})
                </span>
              </label>
              <input
                id="manual-rfq-budget"
                type="number"
                min={0}
                value={form.estimatedBudget ?? ''}
                onChange={(e) =>
                  patchForm('estimatedBudget', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder={MODAL.budgetPlaceholder}
                className="mono font-semibold"
              />
              <FieldError message={formErrors.estimatedBudget} />
            </div>

            <div>
              <label
                htmlFor="manual-rfq-location"
                className="block font-semibold text-slate-600 dark:text-gray-400 mb-1"
              >
                {MODAL.deliveryLocationLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="manual-rfq-location"
                type="text"
                required
                aria-required
                aria-invalid={!!formErrors.deliveryLocation}
                value={form.deliveryLocation}
                onChange={(e) => patchForm('deliveryLocation', e.target.value)}
                placeholder={MODAL.deliveryLocationPlaceholder}
                maxLength={200}
                className="font-medium"
              />
              <FieldError message={formErrors.deliveryLocation} />
            </div>

            <div>
              <label
                htmlFor="manual-rfq-pincode"
                className="block font-semibold text-slate-600 dark:text-gray-400 mb-1"
              >
                {MODAL.deliveryPincodeLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="manual-rfq-pincode"
                type="text"
                required
                aria-required
                aria-invalid={!!formErrors.deliveryPincode}
                value={form.deliveryPincode}
                onChange={(e) => patchForm('deliveryPincode', e.target.value)}
                placeholder={MODAL.deliveryPincodePlaceholder}
                maxLength={10}
                className="mono font-semibold"
              />
              <FieldError message={formErrors.deliveryPincode} />
            </div>

            <div>
              <label htmlFor="manual-rfq-date" className="block font-semibold text-slate-600 dark:text-gray-400 mb-1">
                {MODAL.targetDateLabel}
              </label>
              <input
                id="manual-rfq-date"
                type="date"
                value={form.targetDeliveryDate}
                onChange={(e) => patchForm('targetDeliveryDate', e.target.value)}
                className="font-medium"
              />
            </div>

          </section>

          {/* ── Line items ────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {formatString(MODAL.lineItemsHeading, { count: form.lineItems.length })}
              </h3>
              <button
                onClick={() => setForm(addManualRFQLineItem(form))}
                className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5"
              >
                <Plus size={13} /> {MODAL.addItemAction}
              </button>
            </div>

            <FieldError message={formErrors.lineItems} />

            {form.lineItems.length === 0 ? (
              <p className="p-6 text-center rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-slate-500 dark:text-gray-400">
                {MODAL.noItemsMessage}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800">
                <table className="w-full text-left min-w-[1080px]">
                  <thead className="bg-slate-50 dark:bg-gray-950/60 text-[10px] uppercase tracking-wide text-slate-500 dark:text-gray-400">
                    <tr>
                      <th className="px-2 py-2 font-bold">{MODAL.colItem}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colSpecs}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colMajor}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colMinor}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colQty}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colUnit}</th>
                      <th className="px-2 py-2 font-bold">{MODAL.colTargetDate}</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                    {form.lineItems.map((item) => {
                      const errors = lineItemErrors[item.id] || {};
                      return (
                        <tr key={item.id} data-testid={`manual-row-${item.id}`}>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colItem}
                              aria-invalid={!!errors.itemName}
                              value={item.itemName}
                              onChange={(e) => patchItem(item.id, { itemName: e.target.value })}
                              placeholder={MODAL.itemPlaceholder}
                              className="font-medium w-56"
                            />
                            <FieldError message={errors.itemName} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colSpecs}
                              value={item.technicalSpecs}
                              onChange={(e) => patchItem(item.id, { technicalSpecs: e.target.value })}
                              placeholder={MODAL.specsPlaceholder}
                              className="w-48"
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <select
                              aria-label={MODAL.colMajor}
                              aria-invalid={!!errors.majorCategory}
                              value={item.majorCategory}
                              onChange={(e) => patchItem(item.id, { majorCategory: e.target.value })}
                              className="w-44"
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
                          <td className="px-2 py-2 align-top">
                            <select
                              aria-label={MODAL.colMinor}
                              aria-invalid={!!errors.minorCategory}
                              value={item.minorCategory}
                              disabled={item.majorCategory === ''}
                              onChange={(e) => patchItem(item.id, { minorCategory: e.target.value })}
                              className="w-44 disabled:opacity-50"
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
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              min={1}
                              aria-label={MODAL.colQty}
                              aria-invalid={!!errors.quantity}
                              // Empty string for null so a blank row shows blank
                              // rather than a zero the buyer never typed.
                              value={item.quantity ?? ''}
                              onChange={(e) =>
                                patchItem(item.id, {
                                  quantity: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                              placeholder={MODAL.qtyPlaceholder}
                              className="mono w-28"
                            />
                            <FieldError message={errors.quantity} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              aria-label={MODAL.colUnit}
                              aria-invalid={!!errors.unit}
                              value={item.unit}
                              onChange={(e) => patchItem(item.id, { unit: e.target.value })}
                              placeholder={MODAL.unitPlaceholder}
                              className="w-28"
                            />
                            <FieldError message={errors.unit} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="date"
                              aria-label={MODAL.colTargetDate}
                              value={item.targetDate}
                              onChange={(e) => patchItem(item.id, { targetDate: e.target.value })}
                              className="w-36"
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <button
                              onClick={() => setForm(removeManualRFQLineItem(form, item.id))}
                              aria-label={formatString(MODAL.removeItemAria, {
                                item: item.itemName || MODAL.untitledItem,
                              })}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                            >
                              <Trash2 size={14} />
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

          {/* ── Sourcing mode ─────────────────────────────────────────────────
              Last, because it is the dispatch decision: it only makes sense once
              the buyer can see what is actually being sourced. Cards rather than a
              dropdown so the three modes can be compared before choosing. */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">{MODAL.sourcingModeLabel}</h3>
            <div
              role="radiogroup"
              aria-label={MODAL.sourcingModeLabel}
              className="grid grid-cols-1 md:grid-cols-3 gap-2"
            >
              {SOURCING_MODES.map((mode) => {
                const isSelected = form.sourcingMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`manual-mode-${mode.id}`}
                    onClick={() => patchForm('sourcingMode', mode.id as SourcingMode)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-indigo-500'
                        : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-900 dark:text-white">
                        {mode.shortLabel}
                      </span>
                      {isSelected && <CheckCircle2 size={14} className="text-indigo-600 shrink-0" />}
                    </span>
                    {/* badgeColor is a Tailwind class, so it is applied as one
                        rather than interpolated into inline CSS. */}
                    <span
                      className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide ${mode.badgeColor}`}
                    >
                      {mode.code}
                    </span>
                    <span className="block text-[10px] text-slate-500 dark:text-gray-400 mt-1.5 leading-snug">
                      {mode.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {submitError && (
            <p
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 dark:border-gray-800">
          <p className="text-[11px] text-slate-400 dark:text-gray-500">{MODAL.serverAllocatesNumber}</p>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} disabled={isSaving} className="btn btn-secondary btn-sm font-bold">
              {MODAL.cancelAction}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {isSaving ? MODAL.savingAction : MODAL.saveAction}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
