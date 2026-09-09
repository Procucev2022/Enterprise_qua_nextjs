'use client';

import React, { useState, useRef, useMemo } from 'react';
import { useApp } from '@/lib/store';
import {
  SOURCING_MODES,
  CURRENCY,
  MANUAL_LINE_ITEM_DEFAULTS,
  PINCODE_PATTERN,
  formatFileSize,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment } from '@/lib/rfqClient';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { buildExtractionRequest } from '@/lib/documentExtraction';
import type {
  SourcingMode,
  ExtractedEntity,
  VendorEntry,
  RFQAttachment,
  RFQExtractionRequest,
  RFQExtractionResult,
  RFQItem,
} from '@/lib/types';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Send,
  Layers,
  Trash2,
  Plus,
  FileText,
  Users,
  AlertCircle,
  Zap,
  Lock,
  Pencil,
  MapPin,
  Paperclip,
} from 'lucide-react';


const EXTRACTION = UI_STRINGS.rfqExtraction;
const WIZARD_STEPS = EXTRACTION.steps;
// Read at render time from the taxonomy registry the store populates from the
// database, rather than captured at module scope from a bundled JSON file.
function taxonomyMajors(): string[] {
  return getMajorCategories();
}
/** Mirrors RFQ_ATTACHMENT_CONFIG.MAX_PER_RFQ on the server. */
const MAX_ATTACHMENTS = 10;

/**
 * Option list for a taxonomy dropdown that must be able to display whatever the
 * line item currently holds.
 *
 * A select whose value is not among its options shows the wrong entry, so a
 * category the taxonomy does not contain is prepended rather than hidden.
 */
function withCurrentValue(options: string[], current: string | undefined): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

interface IngestionWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  forceSubscription?: 'free_trial' | 'version_1' | 'version_2' | 'version_3' | 'none';
}

export interface RecommendedProcucevVendor {
  id: string;
  name: string;
  brandName: string;
  majorCategory: string;
  minorCategories: string[];
  location: string;
  rating: number;
  ratingCount?: number;
  matchScore: number;
  proximity: string;
  contactPerson: string;
  email: string;
  phone: string;
  gstin: string;
  panNumber: string;
  establishedYear: number;
  annualTurnover: string;
  plantCapacity: string;
  certifications: string[];
  keyMachinery: string[];
  otifRate: string;
  qualityPpm: string;
  recommendationReason: string;
  isUnratedRecommendation?: boolean;
}

export default function IngestionWizard({ onComplete, onCancel, forceSubscription }: IngestionWizardProps) {
  const {
    addNewRFQ,
    adoptCreatedRFQ,
    currentMode,
    setCurrentMode,
    showToast,
    remainingFreeRFQs,
    activeSubscription: storeSubscription,
  } = useApp();

  const activeSubscription = forceSubscription || storeSubscription;

  const [activeStep, setActiveStep] = useState<number>(1);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  // Guards handleDispatch against being re-entered while its own request is
  // still in flight — without it, a double-click (or a slow network leaving
  // the button clickable for a couple of seconds) fired the whole async
  // create-RFQ chain more than once, each one a genuine, separate RFQ row.
  const [isDispatching, setIsDispatching] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  // Manual entry has no extraction to complete, so Step 1 needs its own signal
  // that the buyer has chosen to proceed. Without it the step strip would stay
  // locked and there would be no way to reach the line-item table.
  /** Whether the manual RFQ entry dialog is showing. */
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);


  const [isDraggingDoc, setIsDraggingDoc] = useState(false);

  // The staged document plus the outcome of the last AI extraction attempt.
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionSummary, setExtractionSummary] = useState<{
    model: string;
    accepted: number;
    needsReview: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);


  // Filled from the AI-derived document title, or keyed by the buyer on Step 2.
  const [rfqTitle, setRfqTitle] = useState('');
  const [rfqNumber] = useState(`RFQ-2026-00${Math.floor(430 + Math.random() * 50)}`);
  const [selectedMode, setSelectedMode] = useState<SourcingMode>(currentMode);

  // Read off the uploaded document, not seeded: a placeholder figure here would be
  // dispatched to vendors as though the buyer had approved it.
  const [budget, setBudget] = useState(0);
  const [budgetFromDocument, setBudgetFromDocument] = useState(false);

  // Delivery details the buyer supplies; vendors price freight against them.
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [deliveryPincode, setDeliveryPincode] = useState('');

  /**
   * Whether the buyer has tried to leave Step 2 yet.
   *
   * Both delivery fields start empty, so validating them on first render greeted
   * the buyer with two red errors against fields they had not reached. The blank
   * warnings are held back until Proceed is pressed, which is the first moment the
   * omission actually matters.
   */
  const [sourcingAttempted, setSourcingAttempted] = useState(false);


  // Line item entities state
  // Populated only by AI extraction or by the buyer adding rows on Step 2.
  const [entities, setEntities] = useState<ExtractedEntity[]>([]);

  /**
   * Record the chosen document. Nothing is parsed here: extraction happens when
   * the buyer continues to Step 2, so the file is only staged at this point.
   */
  const handleRealFileUpload = (file: File) => {
    if (!file) return;
    setUploadedFile(file);
    setUploadedFileName(file.name);
    setExtractionError(null);
    setExtractionSummary(null);
  };

  /**
   * Apply an extraction outcome and move to the review step.
   *
   * A failed extraction still advances to Step 2 by design: the buyer is shown why
   * the document could not be read and can key the line items there instead of
   * being stranded on the upload screen.
   */
  const applyExtraction = (result: RFQExtractionResult, fileName: string) => {
    if (result.success && result.data) {
      setEntities(result.data.extractedEntities);
      if (result.data.title) setRfqTitle(result.data.title);

      // A document that priced nothing leaves the field at zero for the buyer to
      // fill, rather than carrying over a figure from an earlier upload.
      const documentBudget = result.data.estimatedBudget;
      setBudget(documentBudget ?? 0);
      setBudgetFromDocument(Boolean(documentBudget));

      setExtractionError(null);
      setExtractionSummary({
        model: result.extraction?.model || '',
        accepted: result.classification?.accepted ?? result.data.extractedEntities.length,
        needsReview: result.classification?.needsReview ?? 0,
      });
      showToast(
        EXTRACTION.successTitle,
        formatString(EXTRACTION.successToast, {
          accepted: result.classification?.accepted ?? result.data.extractedEntities.length,
          fileName,
        }),
        'success'
      );
    } else {
      setEntities([]);
      setBudget(0);
      setBudgetFromDocument(false);
      setExtractionSummary(null);
      setExtractionError(result.error || EXTRACTION.unreadableResponse);
      showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.unreadableResponse, 'warning');
    }
    setActiveStep(2);
  };



  /**
   * Step 1 manual path: skip extraction entirely and open the review step with
   * one empty row ready to type into.
   *
   * Nothing is pre-filled beyond the structural defaults, and no extraction
   * banner is shown, because there was no document and therefore no AI outcome to
   * report. The rest of the wizard is unchanged: the same categorisation, the
   * same sourcing-mode gate and the same dispatch.
   */
  /**
   * The manual dialog has saved an RFQ.
   *
   * The record handed back is the server's, so it carries the allocated RFQ
   * number, the row id and the generated summary. It is adopted into the store as
   * given rather than reconstructed locally, and the wizard then closes.
   */
  const handleManualRFQCreated = (rfq: RFQItem) => {
    adoptCreatedRFQ(rfq);
    showToast(
      EXTRACTION.manualCreatedTitle,
      formatString(EXTRACTION.manualCreatedMessage, { rfqNumber: rfq.rfqNumber }),
      'success'
    );
    setIsManualModalOpen(false);
    onComplete();
  };

  /** Step 1 primary action: extract line items from the staged document. */
  const handleExtractDocument = async () => {
    if (!uploadedFile) {
      showToast(EXTRACTION.noFileTitle, EXTRACTION.noFileMessage, 'warning');
      return;
    }

    setIsProcessingDoc(true);
    try {
      const payload = await buildExtractionRequest(uploadedFile);
      applyExtraction(await extractLineItemsFromDocument(payload), uploadedFile.name);
    } catch {
      applyExtraction(
        { success: false, reason: 'NO_CONTENT', error: EXTRACTION.unreadableResponse },
        uploadedFile.name
      );
    } finally {
      setIsProcessingDoc(false);
    }
  };



  const handleEntityChange = (id: string, field: keyof ExtractedEntity, value: any) => {
    setEntities((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'majorCategory') {
          // The minor category belongs to the major, so changing one invalidates
          // the other. Falls back to '' rather than undefined so a row with no
          // major reads as unset and the Step 3 gate can see it.
          const validMinors = getMinorCategories(value);
          updated.minorCategory = validMinors[0] ?? '';
          updated.category = value;
        }
        return updated;
      })
    );
  };

  /**
   * Re-classify every line item against the shared major/minor taxonomy.
   *
   * This used to run a four-outcome keyword lookup in the browser and stamp 99%
   * confidence on the result, which meant an item the server had already placed
   * correctly could be silently moved to a default category, sometimes to a minor
   * category that is not even in the taxonomy dropdown. The server owns the full
   * taxonomy and the documented precedence rules, so it does the work now and
   * reports the real confidence for each row.
   *
   * The main use for it is after a failed extraction: rows keyed by hand start on
   * the first taxonomy entry, and this maps them properly in one action.
   */
  const handleAutoCategorizeAll = async () => {
    const quotable = entities.filter((e) => e.itemName.trim() !== '');
    if (quotable.length === 0) {
      showToast(EXTRACTION.classifyEmptyTitle, EXTRACTION.classifyEmptyMessage, 'warning');
      return;
    }

    setIsCategorizing(true);
    try {
      const result = await classifyLineItems(quotable);
      if (!result.success || !result.data) {
        showToast(EXTRACTION.fallbackTitle, result.error || EXTRACTION.classifyFailed, 'warning');
        return;
      }

      // Merged by id rather than replaced wholesale: the server drops rows with no
      // description, so a blank row the buyer has not filled in yet would
      // otherwise disappear from the table. Order is preserved too.
      const classified = new Map(result.data.extractedEntities.map((e) => [e.id, e]));
      setEntities((prev) => prev.map((item) => classified.get(item.id) ?? item));

      showToast(
        EXTRACTION.classifySuccessTitle,
        formatString(EXTRACTION.classifySuccessMessage, {
          accepted: result.classification?.accepted ?? result.data.extractedEntities.length,
          needsReview: result.classification?.needsReview ?? 0,
        }),
        'success'
      );
    } finally {
      setIsCategorizing(false);
    }
  };

  /** ISO date the configured number of days out, matching the backend default. */
  const defaultTargetDate = (): string => {
    const due = new Date();
    due.setDate(due.getDate() + MANUAL_LINE_ITEM_DEFAULTS.TARGET_DATE_OFFSET_DAYS);
    return due.toISOString().slice(0, 10);
  };

  /**
   * Append an empty row for the buyer to key.
   *
   * Description and specification start blank on purpose. Pre-filling them with
   * example text meant a buyer who skipped a field dispatched that example to
   * vendors as a real requirement. Only the structural fields carry defaults, and
   * the category dropdowns start on the first taxonomy entry so the row is always
   * classified against something the buyer can see and change.
   */
  /**
   * A row the buyer adds by hand, with every field genuinely empty.
   *
   * Defaults used to be pre-filled here — quantity 1, unit Nos, a target date and
   * the first taxonomy pair — which read as answers the buyer had given when they
   * had not. A quantity of 1 and a category of "Civil Works" are exactly the kind
   * of values that get dispatched to vendors unnoticed. The Step 3 gate requires
   * each of these instead, so nothing can be quoted against a guess.
   */
  const blankLineItem = (): ExtractedEntity => ({
    id: `ent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemName: '',
    quantity: 0,
    unit: '',
    targetDate: '',
    technicalSpecs: '',
    // Nothing was inferred, so there is no AI confidence to report.
    confidence: 0,
    category: '',
    majorCategory: '',
    minorCategory: '',
  });

  const handleAddEntity = () => {
    setEntities([...entities, blankLineItem()]);
  };

  // ─── Step progression ──────────────────────────────────────────────────────
  //
  // The wizard is strictly sequential: a step opens only once the one before it
  // has produced what the next one needs. Steps 2 and 3 used to be reachable from
  // the strip at any time, which let a buyer land on an empty review table or
  // pick a sourcing mode for an RFQ that had no line items.

  /**
   * Step 1 is done once an extraction has been attempted, whether it succeeded or
   * failed. A failure still counts: the buyer is then expected to key the line
   * items on Step 2, so keeping them on the upload screen would be a dead end.
   */
  const isExtractionAttempted =
    extractionSummary !== null || extractionError !== null;

  /**
   * Step 2 is done once every row can actually be quoted against.
   *
   * An extracted row always satisfies this — the server normalises the quantity
   * and unit and classifies the categories — so in practice this only holds back
   * rows keyed by hand, which now start empty.
   */
  const isLineItemComplete = (e: ExtractedEntity) =>
    e.itemName.trim() !== '' &&
    e.quantity > 0 &&
    e.unit.trim() !== '' &&
    e.majorCategory.trim() !== '' &&
    e.minorCategory.trim() !== '';

  const hasCompleteLineItems = entities.length > 0 && entities.every(isLineItemComplete);

  /**
   * Delivery destination, mandatory before sourcing.
   *
   * Unlike the budget, this cannot be left blank: vendors rate freight on the
   * location and its pincode, so a quote raised without them is not comparable
   * against one that has them. Extraction never supplies these, so they are
   * always keyed by the buyer on Step 2.
   */
  const trimmedDeliveryLocation = deliveryLocation.trim();
  const trimmedDeliveryPincode = deliveryPincode.trim();
  const isDeliveryLocationMissing = trimmedDeliveryLocation === '';
  const isDeliveryPincodeMissing = trimmedDeliveryPincode === '';
  const isDeliveryPincodeMalformed =
    !isDeliveryPincodeMissing && !PINCODE_PATTERN.test(trimmedDeliveryPincode);
  const hasDeliveryDestination =
    !isDeliveryLocationMissing && !isDeliveryPincodeMissing && !isDeliveryPincodeMalformed;

  // A blank field is only worth flagging once the buyer has tried to move on. A
  // malformed pincode is flagged immediately: it can only exist because something
  // was typed, so the buyer is already looking at the field.
  const showDeliveryLocationRequired = sourcingAttempted && isDeliveryLocationMissing;
  const showDeliveryPincodeRequired = sourcingAttempted && isDeliveryPincodeMissing;

  /** Highest step the buyer has earned access to. */
  const unlockedStep = !isExtractionAttempted ? 1 : hasCompleteLineItems && hasDeliveryDestination ? 3 : 2;

  /**
   * Strip navigation. Going back is always allowed; jumping ahead explains which
   * step is unfinished instead of silently doing nothing.
   */
  const goToStep = (step: number) => {
    if (step > unlockedStep) {
      showToast(
        EXTRACTION.stepLockedTitle,
        unlockedStep === 1 ? EXTRACTION.stepLockedExtractMessage : EXTRACTION.stepLockedReviewMessage,
        'warning'
      );
      return;
    }
    setActiveStep(step);
  };

  /**
   * Gate Step 2 -> Step 3. Every line item needs a description, whether it came
   * from AI extraction or was keyed after a failed extraction, otherwise vendors
   * would be asked to quote against a blank row. The delivery destination is
   * checked separately so the toast names the actual blocker rather than
   * reporting a line-item problem for a missing pincode.
   */
  const handleProceedToSourcing = () => {
    setSourcingAttempted(true);
    if (!hasCompleteLineItems) {
      showToast(EXTRACTION.incompleteItemsTitle, EXTRACTION.incompleteItemsMessage, 'warning');
      return;
    }
    if (!hasDeliveryDestination) {
      showToast(EXTRACTION.deliveryIncompleteTitle, EXTRACTION.deliveryIncompleteMessage, 'warning');
      return;
    }
    setActiveStep(3);
  };

  const handleDeleteEntity = (id: string) => {
    setEntities(entities.filter((e) => e.id !== id));
  };

  /**
   * Save the RFQ against the chosen sourcing mode.
   *
   * Vendor matching and standard-email dispatch are Coming Soon, so the RFQ is
   * persisted with an explicitly empty vendor list. Passing `[]` (rather than
   * omitting the argument) is deliberate: it stops the store falling back to
   * automatic matching and firing chaser sequences at suppliers who have not been
   * selected yet.
   */
  /**
   * Store the document this RFQ was extracted from, so it is retrievable later.
   *
   * The wizard used to send `attachments: []` unconditionally and keep only the
   * file *name*, which meant the BOQ or specification a buyer uploaded was read
   * for extraction and then thrown away. The RFQ details screen had nothing to
   * list, so its attachments panel was permanently empty for every RFQ raised
   * through this flow — only the manual dialog, which has its own picker, ever
   * produced one.
   *
   * Uploaded at dispatch rather than at extraction time: a wizard session that is
   * abandoned part way would otherwise leave an object in storage with no RFQ
   * referencing it.
   *
   * A failed upload does not block dispatch. The RFQ itself is the thing the
   * buyer is trying to raise, and refusing to create it because a copy of the
   * source document could not be stored would be the wrong trade — so it warns
   * and continues, and the panel reports the RFQ as having no attachment rather
   * than implying one is there.
   */
  const storeSourceDocument = async (): Promise<{ attachments: RFQAttachment[]; failure: string | null }> => {
    // Only the upload paths have a document. Email ingestion has a pasted body,
    // and manual entry posts its own RFQ from the dialog.
    if (!uploadedFile) return { attachments: [], failure: null };

    const result = await uploadRFQAttachment(uploadedFile);
    if (result?.success && result.data) return { attachments: [result.data], failure: null };

    // Returned rather than announced here. The upload has to finish before the RFQ
    // is posted, so a toast raised at this point is immediately replaced by the
    // dispatch confirmation and the buyer never reads it. The caller reports it
    // once the RFQ has actually been created, which is also when the message
    // ("the RFQ was created, but...") becomes true.
    return {
      attachments: [],
      failure: formatString(EXTRACTION.attachmentStoreFailedMessage, {
        fileName: uploadedFile.name,
        reason: result?.error || '',
      }),
    };
  };

  const handleDispatch = async () => {
    // Re-entrancy guard: without it, a double-click — or just a slow network
    // leaving the button clickable for the second or two this whole async
    // chain takes — fired handleDispatch more than once, each call running
    // the full create-RFQ request independently. Every extra call was a real,
    // separate RFQ row, not a UI artifact: confirmed live (3 RFQs from one
    // click sequence, then 2 from another).
    if (isDispatching) return;
    setIsDispatching(true);
    try {
      // Line-item completeness is not re-checked here: `unlockedStep` locks Step 3
      // the moment a row loses its description, so this screen cannot be reached
      // with an unquotable list.
      //
      // The budget is deliberately not gated. A document can price nothing at all,
      // and requiring a figure only made buyers invent a ceiling that vendors would
      // then quote against.
      //
      // The delivery destination is not re-checked here either, for the same reason:
      // both fields only render on Step 2, so they cannot be cleared while this
      // screen is showing, and `unlockedStep` drops back to 2 the moment one is
      // emptied, which re-locks the strip before dispatch can be reached.
      setCurrentMode(selectedMode);
      // No fallback needed: `hasCompleteLineItems` requires a major category on
      // every row before Step 3 unlocks, so the leading item always carries one.
      const mainMajor = entities[0].majorCategory;
      const vendorsToDispatch: VendorEntry[] = [];
      // Awaited before the RFQ is posted, because the attachment metadata has to
      // travel with the create payload. Any failure is held back and reported after
      // the RFQ exists.
      const { attachments: sourceAttachments, failure: attachmentFailure } = await storeSourceDocument();

      // No rfqNumber is sent: the server allocates it under the same scheme the Java
      // p2pservices app uses. This screen used to mint one with Math.random(), which
      // could collide and, worse, did not match what was actually saved — so the
      // details page fetched a number the database had never seen.
      const saved = await addNewRFQ(
        {
          // Extraction supplies a document title, but manual entry has none and the
          // API requires one, so it falls back to the leading line item the way
          // rfqIngestionService.deriveTitle does on the server.
          title: rfqTitle.trim() || entities[0].itemName.trim(),
          category: mainMajor,
          sourcingMode: selectedMode,
          targetDeliveryDate: entities[0].targetDate || defaultTargetDate(),
          budget,
          deliveryLocation: trimmedDeliveryLocation,
          deliveryPincode: trimmedDeliveryPincode,
          // The document this RFQ was extracted from, so the details screen can
          // list it and the buyer can reopen what they actually uploaded.
          attachments: sourceAttachments,
          extractedEntities: entities,
          aiScore: selectedMode === 'mode_3' ? 95 : 88,
          // The manual dialog creates its RFQ independently (handleManualRFQCreated)
          // and never reaches this submission path, so every RFQ built here is a
          // real document/email upload. `email_gateway` is stamped by the
          // autonomous mailbox poller, which creates its RFQs server-side without
          // going through here at all.
          source: 'web_portal',
          sourceFileName: uploadedFileName,
          autoCirculated: false,
        },
        vendorsToDispatch
      );

      // The attachment warning takes precedence over the success toast when both
      // apply: the buyer already knows the RFQ was raised (the wizard closes and the
      // record appears), whereas a document that silently failed to store is the
      // part they would otherwise never find out about. The message says both.
      if (attachmentFailure) {
        showToast(EXTRACTION.attachmentStoreFailedTitle, attachmentFailure, 'warning');
      } else {
        showToast(
          EXTRACTION.manualCreatedTitle,
          formatString(EXTRACTION.manualCreatedMessage, { rfqNumber: saved.rfqNumber }),
          'success'
        );
      }
      onComplete();
    } finally {
      // Reached on a thrown error only — the success path calls onComplete(),
      // which closes the wizard, so there is no stuck-disabled button to fix
      // up on the path where this flag would otherwise matter.
      setIsDispatching(false);
    }
  };

  return (
    // Widened from max-w-5xl: the Step 2 line-item table carries eight columns
    // plus two category dropdowns and was scrolling horizontally at 1024px.
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-10">
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
            Automated minor category classification, multi-tier vendor matching, and standard RFQ email transmission.
          </p>
        </div>
        <button onClick={onCancel} className="btn btn-secondary btn-sm">
          Exit Wizard
        </button>
      </div>

      {/* Step Progress Indicator */}
      <div className="grid grid-cols-3 gap-3">
        {WIZARD_STEPS.map((step) => {
          const isActive = activeStep === step.number;
          const isDone = activeStep > step.number;
          const isLocked = step.number > unlockedStep;

          return (
            <div
              key={step.number}
              data-testid={`wizard-step-${step.number}`}
              onClick={() => goToStep(step.number)}
              aria-disabled={isLocked}
              className={`p-3.5 rounded-xl border transition-all ${
                isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              } ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 text-indigo-950 dark:text-white shadow-sm'
                  : isDone
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-500/40 text-slate-700 dark:text-gray-300'
                  : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  {isDone ? (
                    <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
                  ) : isLocked ? (
                    <Lock size={12} className="text-slate-400 dark:text-gray-500" />
                  ) : (
                    `${step.number}.`
                  )}
                  {step.label}
                </span>
                <span className="text-[10px] mono text-slate-400 dark:text-gray-400">
                  {isLocked ? EXTRACTION.stepLockedHint : step.tag}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">{step.hint}</p>
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 1: INGESTION — a single drop zone, no method tabs. Email
          (.eml/.msg) and BOQ documents (xlsx/csv/pdf/docx/txt) both land here;
          the backend tells them apart by file type (see
          rfqController.extractRFQFromDocument). Manual entry stays reachable
          as a small secondary link, not a tab, since it bypasses extraction
          entirely via its own modal. */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 1 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud size={18} className="text-indigo-600 dark:text-indigo-400" />
              STEP 1: INGESTION SOURCE
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              Drop a BOQ document or a forwarded requisition email — AI reads it and stages the line items for review.
            </p>
          </div>

          <div className="space-y-4">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.eml,.msg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRealFileUpload(file);
              }}
            />

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
                const file = e.dataTransfer.files?.[0];
                if (file) handleRealFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer group ${
                isDraggingDoc
                  ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
                  : 'border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 bg-indigo-50/40 dark:bg-gray-900/40 hover:bg-indigo-50/80 dark:hover:bg-gray-900/70'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-600/20 border border-indigo-300 dark:border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                <FileSpreadsheet size={28} />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-3">
                {isProcessingDoc ? EXTRACTION.processingDocumentLabel : EXTRACTION.dropZoneHeading}
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
                {EXTRACTION.dropZoneHint}
              </p>
              {/* Only shown once a real file is staged; nothing is pre-filled. */}
              {uploadedFileName && (
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-gray-800 text-xs text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-gray-700 shadow-sm">
                  <span>Selected File:</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-300 mono">
                    {uploadedFileName}
                  </span>
                </div>
              )}
            </div>
          </div>

          {isProcessingDoc ? (
            <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/40 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold text-xs">
                <Sparkles size={16} className="animate-spin" />
                {EXTRACTION.extractingLabel}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-gray-400">{EXTRACTION.extractingHint}</p>
              <div className="w-full bg-slate-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden max-w-md mx-auto">
                <div className="bg-indigo-600 h-full w-3/4 animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-gray-800">
              <button
                data-testid="intake-manual"
                onClick={() => setIsManualModalOpen(true)}
                className="text-[11px] font-semibold text-slate-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5"
              >
                <Pencil size={12} /> {EXTRACTION.manualMethodLabel}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExtractDocument}
                  className="btn btn-primary font-bold flex items-center gap-2"
                >
                  <Sparkles size={14} /> <span>{EXTRACTION.extractAction}</span> <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 2: REVIEW ENTITIES & MINOR CATEGORIZATION */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 2 && (
        <div className="glass-panel p-6 rounded-2xl space-y-5 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Every extracted item is categorized into its standardized <strong>Major Category</strong> and <strong>Minor Category</strong> from the Excel taxonomy.
              </p>

            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAutoCategorizeAll}
                disabled={isCategorizing}
                className="btn btn-secondary btn-sm text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 flex items-center gap-1 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles size={13} />
                {isCategorizing ? EXTRACTION.classifyingLabel : EXTRACTION.classifyAction}
              </button>
              <button onClick={handleAddEntity} className="btn btn-secondary btn-sm flex items-center gap-1">
                <Plus size={13} /> Add Line Item
              </button>
            </div>
          </div>


          {/* AI extraction outcome: either what was read, or why it could not be. */}
          {extractionSummary && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs">
              <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <Sparkles size={14} /> {EXTRACTION.successTitle}
              </div>
              <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200 mt-0.5">
                {formatString(EXTRACTION.successSummary, {
                  accepted: extractionSummary.accepted,
                  model: extractionSummary.model,
                  needsReview: extractionSummary.needsReview,
                })}
              </p>
            </div>
          )}

          {extractionError && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 text-xs space-y-1">
              <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle size={14} /> {EXTRACTION.fallbackTitle}
              </div>
              <p className="text-[11px] text-amber-900/90 dark:text-amber-200">{extractionError}</p>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300 font-semibold">
                {EXTRACTION.fallbackHint}
              </p>
            </div>
          )}

          {/* RFQ Meta Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs">
            <div>
              <label className="block text-slate-600 dark:text-gray-400 font-semibold mb-1">Generated RFQ Number</label>
              <input type="text" value={rfqNumber} readOnly className="mono opacity-80 font-bold" />
            </div>
            <div>
              <label
                htmlFor="rfq-project-title"
                className="block text-slate-600 dark:text-gray-400 font-semibold mb-1"
              >
                Procurement Project Title
              </label>
              <input
                id="rfq-project-title"
                type="text"
                value={rfqTitle}
                onChange={(e) => setRfqTitle(e.target.value)}
                className="font-medium"
              />
            </div>
            <div>
              <label
                htmlFor="rfq-estimated-budget"
                className="block text-slate-600 dark:text-gray-400 font-semibold mb-1"
              >
                {formatString(EXTRACTION.budgetLabel, { symbol: CURRENCY.SYMBOL })}{' '}
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 dark:text-gray-500">
                  ({EXTRACTION.budgetOptionalTag})
                </span>
              </label>
              <input
                id="rfq-estimated-budget"
                type="number"
                min={0}
                value={budget}
                onChange={(e) => {
                  setBudget(Number(e.target.value));
                  // Once the buyer overrides it, the figure is theirs, not the document's.
                  setBudgetFromDocument(false);
                }}
                className="mono font-semibold"
              />
              {budgetFromDocument ? (
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">
                  {formatString(EXTRACTION.budgetFromDocumentHint, { fileName: uploadedFileName })}
                </p>
              ) : (
                budget <= 0 && (
                  <p className="text-[10px] text-slate-500 dark:text-gray-500 mt-1">
                    {EXTRACTION.budgetMissingHint}
                  </p>
                )
              )}
            </div>

            <div>
              <label
                htmlFor="rfq-delivery-location"
                className="block text-slate-600 dark:text-gray-400 font-semibold mb-1 flex items-center gap-1"
              >
                <MapPin size={11} /> {EXTRACTION.deliveryLocationLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  {EXTRACTION.deliveryRequiredMarker}
                </span>
              </label>
              <input
                id="rfq-delivery-location"
                type="text"
                required
                aria-required
                aria-invalid={showDeliveryLocationRequired}
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                placeholder={EXTRACTION.deliveryLocationPlaceholder}
                maxLength={200}
                className="font-medium"
              />
              {showDeliveryLocationRequired && (
                <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">
                  {EXTRACTION.deliveryLocationRequiredMessage}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="rfq-delivery-pincode"
                className="block text-slate-600 dark:text-gray-400 font-semibold mb-1"
              >
                {EXTRACTION.deliveryPincodeLabel}
                <span className="text-rose-600 dark:text-rose-400 font-bold" aria-hidden="true">
                  {EXTRACTION.deliveryRequiredMarker}
                </span>
              </label>
              <input
                id="rfq-delivery-pincode"
                type="text"
                required
                aria-required
                aria-invalid={showDeliveryPincodeRequired || isDeliveryPincodeMalformed}
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value)}
                placeholder={EXTRACTION.deliveryPincodePlaceholder}
                maxLength={10}
                className="mono font-semibold"
              />
              {/* Blank and malformed are reported separately: telling a buyer who
                  has typed nothing that the format is wrong sends them looking for
                  a typo that is not there. Both are flagged inline as well as on
                  save, so the problem surfaces while the field is still in view. */}
              {showDeliveryPincodeRequired && (
                <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-1">
                  {EXTRACTION.deliveryPincodeRequiredMessage}
                </p>
              )}
              {isDeliveryPincodeMalformed && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                  {EXTRACTION.deliveryPincodeInvalidMessage}
                </p>
              )}
            </div>
          </div>

          {/* Nothing to review yet: guide the buyer straight into keying a row. */}
          {entities.length === 0 ? (
            <div className="p-10 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 text-center space-y-3">
              <FileSpreadsheet size={30} className="mx-auto text-slate-300 dark:text-gray-700" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{EXTRACTION.emptyTitle}</h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 max-w-md mx-auto">{EXTRACTION.emptyMessage}</p>
              <button onClick={handleAddEntity} className="btn btn-primary btn-sm font-bold inline-flex items-center gap-1.5">
                <Plus size={14} /> {EXTRACTION.addFirstItemAction}
              </button>
            </div>
          ) : (
          /* Line Items Table with Major & Minor Category Dropdowns */
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-gray-800 shadow-sm">
            <table className="w-full text-left text-xs min-w-[1080px]">
              <thead className="bg-slate-100 dark:bg-gray-950 text-slate-700 dark:text-gray-300 text-[10px] uppercase tracking-wider font-bold border-b border-slate-200 dark:border-gray-800">
                <tr>
                  <th className="p-3 w-[22%] min-w-[210px]">Item Description &amp; Specs</th>
                  <th className="p-3 w-[16%] min-w-[160px]">Major Category</th>
                  <th className="p-3 w-[18%] min-w-[180px]">Minor Category (Taxonomy)</th>
                  <th className="p-3 w-[10%] min-w-[90px] text-center">QTY</th>
                  <th className="p-3 w-[14%] min-w-[125px] text-center">UOM / UNIT</th>
                  <th className="p-3 w-[13%] min-w-[140px]">Target Date</th>
                  <th className="p-3 w-[8%] min-w-[85px] text-center">Confidence</th>
                  <th className="p-3 w-[4%] min-w-[45px] text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-gray-800 text-slate-800 dark:text-gray-200">
                {entities.map((item) => {
                  const currentMajor = item.majorCategory;
                  const taxonomyMinors =
                    getMinorCategories(currentMajor);

                  // The classifier's documented fallback pair sits outside the Excel
                  // taxonomy, so the value actually held in state is always offered as
                  // an option. Without it the select would render a different category
                  // from the one the RFQ carries, and the minor list would be empty.
                  const majorOptions = withCurrentValue(taxonomyMajors(), currentMajor);
                  const availableMinors = withCurrentValue(taxonomyMinors, item.minorCategory);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="p-3 align-top min-w-[210px]">
                        <input
                          type="text"
                          value={item.itemName}
                          placeholder={EXTRACTION.itemNamePlaceholder}
                          onChange={(e) => handleEntityChange(item.id, 'itemName', e.target.value)}
                          className="font-bold text-xs w-full mb-1 !py-1.5 !px-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                        <textarea
                          rows={2}
                          value={item.technicalSpecs}
                          placeholder={EXTRACTION.itemSpecsPlaceholder}
                          onChange={(e) => handleEntityChange(item.id, 'technicalSpecs', e.target.value)}
                          className="text-[11px] w-full resize-none text-slate-500 dark:text-gray-400 !py-1.5 !px-2.5 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </td>

                      {/* Major Category Dropdown */}
                      <td className="p-3 align-top min-w-[160px]">
                        <select
                          value={currentMajor}
                          onChange={(e) => handleEntityChange(item.id, 'majorCategory', e.target.value)}
                          className="text-[11px] font-semibold w-full rounded-lg bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2 shadow-xs"
                        >
                          {/* Without an option matching the empty value a browser
                              displays the first real category, which would look
                              like a choice the buyer had made. */}
                          <option value="" disabled>
                            {EXTRACTION.categoryPlaceholder}
                          </option>
                          {majorOptions.map((major) => (
                            <option key={major} value={major}>
                              {major}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Minor Category Dropdown */}
                      <td className="p-3 align-top min-w-[180px]">
                        <select
                          value={item.minorCategory}
                          onChange={(e) => handleEntityChange(item.id, 'minorCategory', e.target.value)}
                          className="text-[11px] font-bold w-full rounded-lg bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 !py-2 !px-2 shadow-xs"
                        >
                          <option value="" disabled>
                            {EXTRACTION.minorCategoryPlaceholder}
                          </option>
                          {availableMinors.map((minor) => (
                            <option key={minor} value={minor}>
                              {minor}
                            </option>
                          ))}
                        </select>
                        {availableMinors.length > 0 && (
                          <span className="text-[9px] text-slate-400 mt-1 block">
                            Mapped from {availableMinors.length} minor items
                          </span>
                        )}
                      </td>

                      {/* Quantity */}
                      <td className="p-3 align-top text-center min-w-[90px]">
                        <input
                          type="number"
                          // Zero means "not stated" and shows as blank rather than
                          // as a quantity of 0. The old handler clamped every entry
                          // up to 1, so the field could never be cleared.
                          value={item.quantity > 0 ? item.quantity : ''}
                          min={1}
                          placeholder={EXTRACTION.itemQtyPlaceholder}
                          onChange={(e) =>
                            handleEntityChange(item.id, 'quantity', Math.max(0, Number(e.target.value) || 0))
                          }
                          className="mono text-xs text-center font-bold w-full min-w-[75px] rounded-lg bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2 shadow-inner focus:ring-2 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>

                      {/* Unit of Measurement (UOM) */}
                      <td className="p-3 align-top text-center min-w-[125px]">
                        <input
                          type="text"
                          list={`uom-options-${item.id}`}
                          value={item.unit}
                          placeholder={EXTRACTION.itemUnitPlaceholder}
                          onChange={(e) => handleEntityChange(item.id, 'unit', e.target.value)}
                          className="text-xs text-center font-semibold w-full min-w-[110px] rounded-lg bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 !py-2 !px-2.5 shadow-inner focus:ring-2 focus:ring-indigo-500"
                        />
                        <datalist id={`uom-options-${item.id}`}>
                          <option value="Units" />
                          <option value="Nos" />
                          <option value="Meters" />
                          <option value="Metric Tons" />
                          <option value="Kg" />
                          <option value="Sets" />
                          <option value="Liters" />
                          <option value="Pairs" />
                          <option value="Boxes" />
                          <option value="Hours" />
                          <option value="Lots" />
                        </datalist>
                      </td>

                      {/* Target Date */}
                      <td className="p-3 align-top min-w-[140px]">
                        <input
                          type="date"
                          value={item.targetDate}
                          onChange={(e) => handleEntityChange(item.id, 'targetDate', e.target.value)}
                          className="text-xs w-full min-w-[130px] !py-2 !px-2 rounded-lg border border-slate-200 dark:border-gray-800"
                        />
                      </td>

                      {/* Confidence Badge */}
                      <td className="p-3 align-top text-center min-w-[85px]">
                        {/* A keyed row has no AI confidence, so a green 0% badge
                            would report a score that was never computed. */}
                        {item.confidence > 0 ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 inline-block mt-1">
                            {item.confidence}%
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 dark:text-gray-500 inline-block mt-1">
                            {EXTRACTION.confidenceUnset}
                          </span>
                        )}
                      </td>

                      {/* Delete */}
                      <td className="p-3 align-top text-center min-w-[45px]">
                        <button
                          onClick={() => handleDeleteEntity(item.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Delete item"
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

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(1)} className="btn btn-secondary btn-sm">
              Back to Ingestion
            </button>
            <button
              onClick={handleProceedToSourcing}
              className="btn btn-primary font-bold flex items-center gap-2"
            >
              <span>Proceed to Sourcing Mode</span> <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* STEP 3: SOURCING MODE, VENDOR MATCHING & STANDARD RFQ EMAIL */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeStep === 3 && (
        <div className="glass-panel p-6 rounded-2xl space-y-6 animate-fade-in border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
                STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH
              </h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                Select your sourcing mode. The system matches suitable categorized vendors and transmits standard RFQ emails.
              </p>
            </div>
          </div>

          {/* Free Account Quota Banner */}
          {activeSubscription === 'free_trial' && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-emerald-500/10 border border-amber-300 dark:border-amber-700/50 text-xs flex items-center justify-between gap-3 flex-wrap shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Sparkles size={16} />
                </div>
                <div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    Free Starter Account: {remainingFreeRFQs} of 5 Free RFQs Available
                  </span>
                  <p className="text-[11px] text-slate-600 dark:text-gray-300 mt-0.5">
                    You can select and dispatch in <strong>ANY version (Version 1, Version 2, or Version 3)</strong> for this free RFQ.
                  </p>
                </div>
              </div>
              <span className="badge badge-amber font-bold mono">
                All 3 Versions Unlocked
              </span>
            </div>
          )}

          {/* Sourcing Mode Selectors (Version 1, 2, 3) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SOURCING_MODES.map((mode) => {
              const isSelected = selectedMode === mode.id;
              const isAllowed = 
                activeSubscription === 'version_3' ||
                (activeSubscription === 'version_2' && mode.id !== 'mode_3') ||
                (activeSubscription === 'version_1' && mode.id === 'mode_1') ||
                activeSubscription === 'free_trial';

              const handleModeClick = () => {
                if (!isAllowed) {
                  showToast(
                    'Upgrade Required',
                    mode.id === 'mode_3'
                      ? 'Version 3 (Mode 3: Autonomous AI) requires an active Version 3 Plan. Upgrade in Subscription Center.'
                      : 'Version 2 (Mode 2: Hybrid Sourcing) requires a Version 2 or Version 3 Plan.',
                    'warning'
                  );
                  return;
                }
                setSelectedMode(mode.id);
              };

              return (
                <div
                  key={mode.id}
                  data-testid={`mode-card-${mode.id}`}
                  onClick={handleModeClick}
                  className={`p-5 rounded-2xl border-2 transition-all flex flex-col justify-between relative group ${
                    !isAllowed
                      ? 'opacity-65 bg-slate-50 dark:bg-gray-900/40 border-slate-200 dark:border-gray-800 cursor-not-allowed'
                      : isSelected
                      ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 shadow-md cursor-pointer'
                      : 'bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 cursor-pointer'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-3 right-3 p-1 rounded-full bg-indigo-600 text-white">
                      <CheckCircle2 size={14} />
                    </div>
                  )}

                  {!isAllowed && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[9px] font-bold border border-amber-300">
                      🔒 Upgrade Required
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      {/* badgeColor is a Tailwind class string; passing it to
                          style={{ backgroundColor }} produced invalid CSS the
                          browser dropped, leaving the badge unstyled. */}
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider inline-block ${mode.badgeColor}`}
                      >
                        {mode.code}
                      </span>
                      {isAllowed && (
                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ Included
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{mode.shortLabel}</h3>
                    <p className="text-xs text-slate-600 dark:text-gray-400 mt-2 leading-relaxed">{mode.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-gray-800 text-[11px] font-medium text-slate-600 dark:text-gray-300">
                    • {mode.id === 'mode_1' ? 'Private buyer roster only (Features of Version 1)' : mode.id === 'mode_2' ? 'Buyer roster + Procucev Hybrid pool (Features of Version 1 & 2)' : 'Autonomous AI + 360° Qualification (Features of Version 1, 2 & 3)'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vendor matching & dispatch are being rebuilt; the RFQ still records its mode. */}
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-gray-950 border border-dashed border-slate-300 dark:border-gray-700 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                <Users size={16} className="text-slate-400" />
                {EXTRACTION.vendorComingSoonTitle}
              </h3>
              <span className="badge badge-amber font-bold">{EXTRACTION.vendorComingSoonBadge}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed max-w-3xl">
              {EXTRACTION.vendorComingSoonMessage}
            </p>
          </div>

          {/* Dispatch Summary Box */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-xs space-y-2">
            <div className="flex items-center justify-between font-semibold flex-wrap gap-2">
              <span className="text-slate-700 dark:text-gray-300">{EXTRACTION.dispatchAction}</span>
              <span className="mono text-indigo-700 dark:text-indigo-300 font-bold">
                {formatString(EXTRACTION.dispatchSummary, {
                  rfqNumber,
                  itemCount: entities.length,
                  modeCode: SOURCING_MODES.find((m) => m.id === selectedMode)?.code || selectedMode,
                })}
              </span>
            </div>
            <p className="text-slate-500 dark:text-gray-400 text-[11px]">
              Upon dispatch, official Standard RFQ Emails with itemized BOQ specifications and SHA-256 digital seals will be transmitted to all chosen suppliers. Suppliers submit quotations by replying directly to the email without changing the subject line for automated AI ingestion.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-gray-800">
            <button onClick={() => setActiveStep(2)} className="btn btn-secondary btn-sm">
              Back to Review
            </button>
            <button
              onClick={handleDispatch}
              disabled={isDispatching}
              className="btn btn-primary btn-lg font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Send size={16} /> {isDispatching ? 'Saving…' : EXTRACTION.dispatchAction}
            </button>
          </div>
        </div>
      )}

      {/* Manual entry runs entirely in this dialog. It posts to the API itself and
          hands back the saved record, so it does not pass through the extraction
          steps above — there is no document to read and nothing to review. */}
      <ManualRFQModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onCreated={handleManualRFQCreated}
      />
    </div>
  );
}

