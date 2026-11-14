'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useApp, getLastHistoricalDataError } from '@/lib/store';
import {
  formatCurrency,
  normalizePoDate,
  PERIOD_BY_VENDOR_INGESTION_HORIZON,
  VENDOR_INGESTION_HORIZON_BY_PERIOD,
  VENDOR_MAPPING_PAGE_SIZE,
} from '@/lib/constants';
import {
  VendorMasterUploadRecord,
  PurchaseOrderLineItemRecord,
  HistoricalPurchaseVendorRecord,
  IngestionSummary,
  VendorCategoryMapping,
  VendorIngestionSession,
} from '@/lib/types';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { logger } from '@/lib/logger';
import { findMissingPoDumpFields, findMissingPoDumpHeaders } from '@/lib/validationSchemas';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Star,
  Clock,
  Download,
  AlertCircle,
  AlertTriangle,
  Tag,
  Zap,
  X,
  Layers,
  ChevronRight,
  Plus,
  Trash2,
  SlidersHorizontal,
  Check,
  Database,
  Pencil,
  RefreshCw,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';

export interface IngestionJobState {
  id: string;
  jobType: 'VENDOR_MASTER' | 'PO_DUMP' | 'AI_CATEGORY';
  fileName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  errorMessage?: string | null;
}

export function IngestionProgressCard({
  job,
  title,
  unit = 'records',
}: {
  job: IngestionJobState;
  title: string;
  unit?: string;
}) {
  const total = job.totalRecords || 0;
  const processed = job.processedRecords || 0;
  const imported = job.importedRecords || 0;
  const skipped = job.skippedRecords || 0;
  const failed = job.failedRecords || 0;
  const percentage =
    total > 0
      ? Math.min(100, Math.round((processed / total) * 100))
      : job.status === 'COMPLETED'
      ? 100
      : processed > 0
      ? 100
      : 0;

  const formatNumber = (n: number) => n.toLocaleString('en-IN');

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 border-2 border-indigo-500/40 text-white shadow-xl space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-md shadow-indigo-600/20">
            <Database size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black tracking-wide text-white">
                {title} Ingestion
              </h4>
              {job.status === 'PROCESSING' && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                  Processing...
                </span>
              )}
              {job.status === 'COMPLETED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-xs">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  Completed
                </span>
              )}
              {job.status === 'FAILED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30">
                  <AlertCircle size={11} className="text-rose-400" />
                  Failed
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              File: <span className="text-indigo-300 font-semibold">{job.fileName}</span>
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-200 to-emerald-300">
            {percentage}%
          </span>
          <span className="block text-[10px] text-slate-400 font-medium">
            {formatNumber(processed)} / {formatNumber(total || processed)} {unit} processed ({percentage}%)
          </span>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-3.5 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/60 p-0.5 shadow-inner">
          <div
            className={`h-full rounded-full transition-all duration-300 shadow-sm ${
              job.status === 'FAILED'
                ? 'bg-rose-500'
                : job.status === 'COMPLETED'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, percentage))}%` }}
          />
        </div>
      </div>

      {/* Metrics Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
        <div className="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Total</span>
          <span className="font-mono font-black text-slate-100 text-sm">{formatNumber(total || processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-800/60">
          <span className="text-[10px] uppercase font-bold text-indigo-300 block">Processed</span>
          <span className="font-mono font-black text-indigo-100 text-sm">{formatNumber(processed)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-800/60">
          <span className="text-[10px] uppercase font-bold text-emerald-300 block">Imported</span>
          <span className="font-mono font-black text-emerald-200 text-sm">{formatNumber(imported)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-800/60">
          <span className="text-[10px] uppercase font-bold text-amber-300 block">Skipped</span>
          <span className="font-mono font-black text-amber-200 text-sm">{formatNumber(skipped)}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-bold text-rose-300 block">Failed</span>
          <span className="font-mono font-black text-rose-200 text-sm">{formatNumber(failed)}</span>
        </div>
      </div>

      {job.errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-800/70 text-xs text-rose-200 flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0 text-rose-400" />
          <span>{job.errorMessage}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 flex-wrap gap-1">
        <span>
          Status:{' '}
          <strong className="text-slate-200">
            {job.status === 'PROCESSING'
              ? 'Processing...'
              : job.status === 'COMPLETED'
              ? 'Completed Successfully'
              : job.status === 'FAILED'
              ? 'Processing Failed'
              : 'Pending'}
          </strong>
        </span>
        <span className="text-[10px] text-indigo-300/80 italic flex items-center gap-1">
          <Sparkles size={11} className="text-indigo-400" />
          Backend processing continues if you close this window or navigate away
        </span>
      </div>
    </div>
  );
}

// Parse vendor mobile number: accepts with or without +91 country code,
// validates exactly 10 digits after country code, and stores country code without duplication.
export interface ParsedVendorMobile {
  isValid: boolean;
  nationalNumber: string;
  storedNumber: string;
}

export const parseVendorMobile = (phone: string | undefined | null): ParsedVendorMobile => {
  if (!phone || typeof phone !== 'string') {
    return { isValid: true, nationalNumber: '', storedNumber: '' };
  }
  const trimmed = phone.trim();
  if (trimmed === '') {
    return { isValid: true, nationalNumber: '', storedNumber: '' };
  }

  // Reject alphanumeric characters
  if (/[a-zA-Z]/.test(trimmed)) {
    return { isValid: false, nationalNumber: '', storedNumber: trimmed };
  }

  // Reject invalid symbols (only digits, +, -, spaces, parentheses allowed)
  if (!/^[\d\s+\-()]+$/.test(trimmed)) {
    return { isValid: false, nationalNumber: '', storedNumber: trimmed };
  }

  // Strip duplicate or multiple leading country code indicators (+91, + 91, (+91), leading +, etc.)
  let remainder = trimmed;
  while (/^\s*(?:\+\s*91|\(\s*\+?91\s*\)|\+\s*)/.test(remainder)) {
    remainder = remainder.replace(/^\s*(?:\+\s*91|\(\s*\+?91\s*\)|\+\s*)/, '').trim();
  }

  // Extract all digits from remainder
  let digits = remainder.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Must be numeric value with exactly 10 digits after country code
  if (digits.length === 10 && /^\d{10}$/.test(digits)) {
    return {
      isValid: true,
      nationalNumber: digits,
      storedNumber: `+91 ${digits}`,
    };
  }

  return { isValid: false, nationalNumber: '', storedNumber: trimmed };
};

/**
 * Every supplier mapping the server holds for a session, read in pages of VENDOR_MAPPING_PAGE_SIZE.
 * Throws when a page cannot be read, so the caller can tell the buyer the results are unavailable.
 */
async function fetchVendorMappingPages(sessionId: string, headers: Record<string, string>): Promise<VendorCategoryMapping[]> {
  const mappings: VendorCategoryMapping[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (mappings.length < total) {
    const res = await fetch(
      `/api/vendor-ingestion/${sessionId}/vendors?limit=${VENDOR_MAPPING_PAGE_SIZE}&offset=${mappings.length}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Supplier categories could not be loaded (HTTP ${res.status}).`);
    const json = await res.json();
    const page: VendorCategoryMapping[] = Array.isArray(json?.data?.vendors) ? json.data.vendors : [];
    total = Number(json?.data?.total) || 0;
    if (page.length === 0) break;
    mappings.push(...page);
  }
  return mappings;
}

export default function InitialSetupModal() {
  const {
    initialSetupModalOpen,
    setInitialSetupModalOpen,
    historicalPurchaseDataPeriod,
    setHistoricalPurchaseDataPeriod,
    processHistoricalPurchaseData,
    lastIngestionSummary,
    lastIngestionError,
    setInitialSetupCompleted,
    activeBuyerAccount,
    buyerVendors,
    showToast,
  } = useApp();

  const [completionSummary, setCompletionSummary] = useState<IngestionSummary | null>(null);
  const [isRetryingFailedEmails, setIsRetryingFailedEmails] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  React.useEffect(() => {
    if (lastIngestionSummary) {
      setCompletionSummary(lastIngestionSummary);
    }
  }, [lastIngestionSummary]);
  const [selectedPeriod, setSelectedPeriod] = useState<'1_year' | '2_years' | '3_years'>(historicalPurchaseDataPeriod || '2_years');

  // Active Session & Ingestion Job States
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vendorJob, setVendorJob] = useState<IngestionJobState | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [vendorUploadError, setVendorUploadError] = useState<string | null>(null);
  const [poUploadError, setPoUploadError] = useState<string | null>(null);
  const [poJob, setPoJob] = useState<IngestionJobState | null>(null);

  // Separate Upload States & File Handlers
  const [storedVendors, setStoredVendors] = useState<VendorMasterUploadRecord[]>([]);
  const [vendorMasterUploaded, setVendorMasterUploaded] = useState(false);
  const [vendorFileName, setVendorFileName] = useState<string>('');
  const [isDraggingVendor, setIsDraggingVendor] = useState<boolean>(false);
  const [isParsingVendor, setIsParsingVendor] = useState<boolean>(false);
  const [isEditingVendorTable, setIsEditingVendorTable] = useState<boolean>(false);

  const [poLineItems, setPoLineItems] = useState<PurchaseOrderLineItemRecord[]>([]);
  const [poDataUploaded, setPoDataUploaded] = useState(false);
  const [poFileName, setPoFileName] = useState<string>(`PO_Purchase_Dump_${selectedPeriod}.xlsx`);
  const [isDraggingPo, setIsDraggingPo] = useState<boolean>(false);
  const [isParsingPo, setIsParsingPo] = useState<boolean>(false);

  const [vendorPreviewLimit, setVendorPreviewLimit] = useState<number>(50);
  const [poPreviewLimit, setPoPreviewLimit] = useState<number>(50);

  const vendorFileInputRef = useRef<HTMLInputElement>(null);
  const poFileInputRef = useRef<HTMLInputElement>(null);

  const [isProcessingPOJoin, setIsProcessingPOJoin] = useState(false);
  const [isConfirmingIngestion, setIsConfirmingIngestion] = useState(false);
  const [apiJoinedVendors, setApiJoinedVendors] = useState<HistoricalPurchaseVendorRecord[] | null>(null);

  // Background AI category job for this session. The server reads the stored PO rows and extracts a
  // category per supplier, so the wizard polls its progress the same way it polls the upload jobs.
  const [aiJob, setAiJob] = useState<IngestionJobState | null>(null);
  const isAiRunning = aiJob?.status === 'PENDING' || aiJob?.status === 'PROCESSING';
  // The PO dump is optional. A dump counts when the browser holds its lines or the server holds stored rows.
  const hasPoDump = poDataUploaded || poLineItems.length > 0;

  // Validate vendor mobile number: accepts with or without +91, exactly 10 numeric digits after country code
  const isValidVendorMobile = (phone: string | undefined | null): boolean => {
    if (!phone || typeof phone !== 'string') return true;
    const trimmed = phone.trim();
    if (trimmed === '') return true;

    return parseVendorMobile(trimmed).isValid;
  };

  // Validate a vendor row for required fields
  const getVendorRowErrors = (v: VendorMasterUploadRecord): string[] => {
    const errs: string[] = [];
    if (!v.companyName || v.companyName.trim() === '') {
      errs.push('Company Name is required');
    }
    if (v.email && v.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
      errs.push('Invalid email format');
    }
    if (v.phone && v.phone.trim() !== '' && !isValidVendorMobile(v.phone)) {
      errs.push('Mobile number must be a 10-digit numeric value');
    }
    return errs;
  };

  const invalidVendors = storedVendors.filter((v) => getVendorRowErrors(v).length > 0);

  /** PO lines that name this supplier by company name or vendor code. Shown for context only, never used for categories. */
  const matchPoLinesForVendor = (v: VendorMasterUploadRecord): PurchaseOrderLineItemRecord[] =>
    poLineItems.filter(
      (po) =>
        po.vendorIdentifier.toLowerCase().includes(v.companyName.toLowerCase()) ||
        v.companyName.toLowerCase().includes(po.vendorIdentifier.toLowerCase()) ||
        (v.vendorCode && po.vendorIdentifier.toLowerCase().includes(v.vendorCode.toLowerCase()))
    );

  /**
   * Step 4 vendor records built from the server's AI results. Categories are the supplier's final category
   * from the AI job. Contact details come from the local Vendor Master, matched by vendor code or email.
   */
  const recordsFromMappings = (mappings: VendorCategoryMapping[]): HistoricalPurchaseVendorRecord[] =>
    mappings.map((mapping) => {
      const local = storedVendors.find(
        (v) =>
          (mapping.vendorCode !== '' && v.vendorCode === mapping.vendorCode) ||
          (mapping.email !== '' && (v.email || '').toLowerCase() === mapping.email.toLowerCase())
      );
      return {
        id: mapping.vendorRecordId,
        vendorCode: mapping.vendorCode || undefined,
        companyName: mapping.companyName,
        email: mapping.email,
        contactPerson: local?.contactPerson,
        phone: local?.phone ?? '',
        address: local?.address ?? '',
        gstNumber: local?.gstNumber ?? '',
        vendorRatingScore: local?.vendorRatingScore,
        hasPoHistory: mapping.hasPoHistory,
        categoriesMappedByBuyer: mapping.finalMajorCategory !== '',
        itemsSupplied: local ? matchPoLinesForVendor(local).map((p) => p.itemName) : [],
        pastPoSpend: mapping.hasPoHistory
          ? `${formatCurrency(mapping.totalSpend)} (${mapping.poCount} POs)`
          : 'No PO History in Dump',
        poCount: mapping.poCount,
        firstSetMajorCategory: mapping.finalMajorCategory,
        secondSetMinorCategories: mapping.finalMinorCategories,
        secondSetSecondaryMajors: [],
      };
    });

  /** Refuse PO changes while the AI job reads the stored rows. Shows the PO banner and returns true when blocked. */
  const blockIfAiRunning = (): boolean => {
    if (!isAiRunning) return false;
    setPoUploadError(UI_STRINGS.vendorPoIngestion.aiCategory.blockedWhileRunning);
    return true;
  };

  const navigateToStep = (targetStep: 1 | 2 | 3 | 4): boolean => {
    // Backward navigation to Step 1 or 2 is always allowed
    if (targetStep <= 2) {
      setStep(targetStep);
      return true;
    }

    // Moving forward to Step 3 or 4 requires at least 1 vendor in Vendor Master
    if (storedVendors.length === 0) {
      const msg = 'Vendor Master is required. Please upload your Vendor Master spreadsheet or add vendor records before proceeding.';
      setVendorUploadError(msg);
      showToast('Vendor Master Required', msg, 'warning');
      setStep(2);
      return false;
    }

    // Moving forward to Step 3 or 4 requires all Vendor Master rows to pass required-field validation
    if (invalidVendors.length > 0) {
      const msg = `Cannot proceed: ${invalidVendors.length} vendor record(s) contain missing or invalid required fields (Company Name, Email, or Mobile). Please click 'Edit Data' to fix them before continuing.`;
      setVendorUploadError(msg);
      showToast('Validation Error in Vendor Master', msg, 'warning');
      setStep(2);
      return false;
    }

    // If ingestion was completed in the current session, allow viewing the Step 4 (dispatch) summary
    if (targetStep === 4 && (completionSummary || (lastIngestionSummary && hasPoDump))) {
      setStep(4);
      return true;
    }

    // The PO dump is optional. Once one is stored, its suppliers' categories come from the AI job, so review
    // waits for that job. Without a PO dump there is nothing to extract and review can open straight away.
    if (targetStep === 4 && hasPoDump && apiJoinedVendors === null) {
      setPoUploadError(UI_STRINGS.vendorPoIngestion.aiCategory.runFirst);
      setStep(3);
      return false;
    }

    setVendorUploadError(null);
    setPoUploadError(null);
    setStep(targetStep);
    return true;
  };

  const authFetchHeaders = (): Record<string, string> => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
        : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // Live job progress polling — setVendorJob/setPoJob were previously only
  // ever set once, from the upload response, at the instant the background
  // job had barely started (0 processed). "Progress is tracked live" was
  // never actually true: nothing re-fetched the job afterward, so the
  // progress card just froze at that first snapshot until the buyer
  // reloaded the page. Polls GET /:sessionId/jobs/:jobId every 2s while a
  // job is PENDING/PROCESSING and stops itself once it lands on a terminal
  // status (or the session/modal goes away).
  React.useEffect(() => {
    if (!sessionId) return;
    const pollableJobs: Array<['vendor' | 'po' | 'ai', IngestionJobState | null]> = [
      ['vendor', vendorJob],
      ['po', poJob],
      ['ai', aiJob],
    ];
    const active = pollableJobs.filter(
      ([, job]) => job && (job.status === 'PENDING' || job.status === 'PROCESSING')
    );
    if (active.length === 0) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      for (const [which, job] of active) {
        if (!job) continue;
        try {
          const res = await fetch(`/api/vendor-ingestion/${sessionId}/jobs/${job.id}`, {
            headers: authFetchHeaders(),
          });
          if (!res.ok || cancelled) continue;
          const json = await res.json();
          const freshJob: IngestionJobState | undefined = json?.data?.job;
          if (!freshJob || cancelled) continue;
          if (which === 'vendor') setVendorJob(freshJob);
          else if (which === 'po') setPoJob(freshJob);
          else setAiJob(freshJob);
        } catch (err) {
          logger.log('WARN', 'Could not refresh ingestion job progress', { error: err, jobType: which }, 'VENDOR_INGESTION');
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, vendorJob?.id, vendorJob?.status, poJob?.id, poJob?.status, aiJob?.id, aiJob?.status]);

  // When the AI category job completes, read the supplier mappings it stored and open the review.
  React.useEffect(() => {
    if (!sessionId || aiJob?.status !== 'COMPLETED') return;
    let cancelled = false;
    const loadResults = async () => {
      try {
        const mappings = await fetchVendorMappingPages(sessionId, authFetchHeaders());
        if (cancelled) return;
        setApiJoinedVendors(recordsFromMappings(mappings));
        setStep(4);
        logger.log('INFO', 'AI category results loaded', { sessionId, suppliers: mappings.length }, 'VENDOR_INGESTION');
      } catch (err) {
        if (cancelled) return;
        logger.log('ERROR', 'Could not load AI category results', { error: err }, 'VENDOR_INGESTION');
        setPoUploadError(UI_STRINGS.vendorPoIngestion.aiCategory.resultsFailed);
        showToast('AI Category Results', UI_STRINGS.vendorPoIngestion.aiCategory.resultsFailed, 'warning');
      }
    };
    loadResults();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, aiJob]);

  const handleCloseModal = async () => {
    if (sessionId && (vendorJob?.status === 'PROCESSING' || poJob?.status === 'PROCESSING')) {
      try {
        await fetch(`/api/vendor-ingestion/${sessionId}/jobs/cancel`, {
          method: 'POST',
          headers: authFetchHeaders(),
        });
      } catch (e) {
        logger.log('WARN', 'Could not cancel background ingestion job when closing setup', { error: e }, 'VENDOR_INGESTION');
      }
    }
    setVendorJob(null);
    setPoJob(null);
    setAiJob(null);
    setInitialSetupModalOpen(false);
  };

  // Re-establish the session on open. A first visit has none, so one is created here: uploads and the AI
  // job are stored against it, and the server needs the chosen period as its time horizon.
  React.useEffect(() => {
    if (!initialSetupModalOpen) {
      setVendorJob(null);
      setPoJob(null);
      setAiJob(null);
      return;
    }

    const initSession = async () => {
      try {
        const res = await fetch('/api/vendor-ingestion/session', { headers: authFetchHeaders() });
        if (!res.ok) return;
        const json = await res.json();
        let sess: VendorIngestionSession | null = json?.data?.session ?? null;
        if (!sess?.id) {
          const created = await fetch('/api/vendor-ingestion/session', {
            method: 'POST',
            headers: authFetchHeaders(),
            body: JSON.stringify({ horizonType: VENDOR_INGESTION_HORIZON_BY_PERIOD[selectedPeriod] }),
          });
          if (!created.ok) return;
          sess = (await created.json())?.data ?? null;
        }
        if (!sess?.id) return;
        setSessionId(sess.id);
        // The saved session's period wins, so the buyer sees the window the server actually uses.
        const savedPeriod = sess.horizonType ? PERIOD_BY_VENDOR_INGESTION_HORIZON[sess.horizonType] : undefined;
        if (savedPeriod) {
          setSelectedPeriod(savedPeriod);
          setHistoricalPurchaseDataPeriod(savedPeriod);
        }
        if (sess.vendorMasterFileName && sess.vendorMasterRowCount > 0) {
          setVendorFileName(sess.vendorMasterFileName);
          setVendorMasterUploaded(true);
        }
        if (sess.poFileName && sess.poRowCount > 0) {
          setPoFileName(sess.poFileName);
          setPoDataUploaded(true);
        }
      } catch (err) {
        logger.log('WARN', 'Could not initialize vendor ingestion session', { error: err }, 'VENDOR_INGESTION');
      }
    };

    initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSetupModalOpen]);



  if (!initialSetupModalOpen) return null;

  const ALLOWED_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv', '.txt'];
  const isAllowedSpreadsheetFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
  };

  // Real File Upload & SheetJS/CSV Parsing for File 1: Vendor Master
  const handleVendorFileUpload = (file: File) => {
    if (!file) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setVendorFileName(file.name);
    setIsParsingVendor(true);

    // Set initial active job state
    setVendorJob({
      id: `job-vm-${Date.now()}`,
      jobType: 'VENDOR_MASTER',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');
    setVendorFileName(file.name);

    if (isCsvOrText && sessionId) {
      // Stream directly to backend for large files / session tracking in parallel
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=VENDOR_MASTER&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setVendorJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for ${file.name}. Progress is tracked live.`, 'info');
            }
          } else {
            const errJson = await res.json().catch(() => null);
            const errMsg = errJson?.error || errJson?.message || `Server returned ${res.status}: ${res.statusText}`;
            setVendorUploadError(errMsg);
            showToast('Upload Error', errMsg, 'warning');
          }
        } catch (err: any) {
          logger.log('ERROR', 'Vendor master streaming upload failed', { error: err }, 'VENDOR_INGESTION');
          const errMsg = err?.message || 'Streaming upload failed';
          setVendorUploadError(errMsg);
          showToast('Upload Error', errMsg, 'warning');
        }
      })();
    }

    // Always parse file client-side so storedVendors and table UI are populated immediately
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            const errMsg = 'The uploaded Vendor Master file has no readable data rows.';
            setVendorUploadError(errMsg);
            showToast('Empty File', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            return;
          }

          const headerKeys = Object.keys(rawJson[0]);
          const hasCompanyName = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['companyname', 'company', 'vendorname', 'vendor', 'suppliername', 'supplier', 'name', 'organization'].some(
              (c) => clean === c || (clean.includes(c) && !clean.includes('code') && !clean.includes('mail') && !clean.includes('phone') && !clean.includes('contact'))
            );
          });
          const hasEmail = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['email', 'emailid', 'emailaddress', 'mail', 'corporateemail', 'companyemail', 'vendoremail'].some((c) => clean.includes(c));
          });
          const hasPhone = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['phone', 'mobile', 'contactnumber', 'phonenumber', 'telephone', 'mobileno', 'contactno', 'cell', 'whatsapp'].some((c) => clean.includes(c));
          });
          const hasVendorCode = headerKeys.some((k) => {
            const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            return ['vendorcode', 'suppliercode', 'vendorid', 'supplierid', 'vcode', 'vendorno', 'vndcode'].some((c) => clean.includes(c));
          });

          if (!hasCompanyName && !hasEmail && !hasPhone && !hasVendorCode) {
            const foundHeaders = headerKeys.filter(Boolean).slice(0, 6).join(', ') || 'None';
            const errMsg = `Sheet headers do not match Vendor Master required fields. Expected: Company Name, Email ID, Mobile No. (Found: [${foundHeaders}]). Please download and use the official Vendor Master template.`;
            setVendorUploadError(errMsg);
            showToast('Invalid Sheet Headers', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            if (vendorFileInputRef.current) vendorFileInputRef.current.value = '';
            return;
          }

          const vendorCodeAliases = [
            'vendorcode', 'vendor code', 'vendor_code', 'suppliercode', 'supplier code',
            'vendor id', 'supplier id', 'vcode', 'vnd code', 'vendorno', 'vendor no',
            'vendor number', 'supplier number', 'vendor identifier'
          ];

          const getRowVal = (row: any, possibleKeys: string[], excludeSubstrings: string[] = []): string => {
            const keys = Object.keys(row);
            // Pass 1: Exact matches (after stripping non-alphanumeric)
            for (const pk of possibleKeys) {
              const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
              const matchedKey = keys.find((k) => {
                const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                return kClean === pkClean;
              });
              if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                return String(row[matchedKey]).trim();
              }
            }
            // Pass 2: Fuzzy matches (only for keys with 4+ alphanumeric chars)
            for (const pk of possibleKeys) {
              const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (!pkClean || pkClean.length < 4) continue;
              const matchedKey = keys.find((k) => {
                const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                return kClean.includes(pkClean);
              });
              if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                return String(row[matchedKey]).trim();
              }
            }
            return '';
          };

          // Collect all explicitly provided vendor codes to avoid overwriting or duplicate collisions
          const explicitlyProvidedCodes = new Set<string>();
          storedVendors.forEach((v) => {
            if (v.vendorCode && v.vendorCode.trim()) {
              explicitlyProvidedCodes.add(v.vendorCode.trim().toLowerCase());
            }
          });

          rawJson.forEach((row) => {
            let code = getRowVal(row, vendorCodeAliases, ['email', 'mail', 'phone', 'contact', 'gst']);
            if (code && (code.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(code))) {
              code = '';
            }
            if (code.trim()) {
              explicitlyProvidedCodes.add(code.trim().toLowerCase());
            }
          });

          // Unique sequential code generator: 1, 2, 3, etc. skipping any explicitly provided codes
          let nextSequentialVendorCode = 1;
          const getNextUniqueSequentialVendorCode = (): string => {
            while (explicitlyProvidedCodes.has(String(nextSequentialVendorCode).toLowerCase())) {
              nextSequentialVendorCode++;
            }
            const generated = String(nextSequentialVendorCode);
            explicitlyProvidedCodes.add(generated.toLowerCase());
            nextSequentialVendorCode++;
            return generated;
          };

          const parsedVendors: VendorMasterUploadRecord[] = rawJson.map((row, idx) => {
            const getVal = (possibleKeys: string[], excludeSubstrings: string[] = []): string =>
              getRowVal(row, possibleKeys, excludeSubstrings);

            let rawVendorCode = getVal(
              vendorCodeAliases,
              ['email', 'mail', 'phone', 'contact', 'gst']
            );
            // If the resolved vendorCode is an email address, discard it so it doesn't take email as vendor code
            if (rawVendorCode && (rawVendorCode.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVendorCode))) {
              rawVendorCode = '';
            }
            // If a vendor code is provided, retain and use that code.
            // If no vendor code is provided, automatically generate sequential vendor codes: 1, 2, 3, etc.
            const vendorCode = rawVendorCode.trim() ? rawVendorCode.trim() : getNextUniqueSequentialVendorCode();
            const companyName = getVal(['companyname', 'company name', 'vendor name', 'supplier name', 'supplier', 'company', 'organization', 'vendor', 'name'], ['email', 'mail', 'phone', 'contactperson', 'code']);
            const contactPerson = getVal(['contactperson', 'contact person', 'contact person name', 'representative', 'person name', 'contact name', 'person', 'poc'], ['email', 'mail', 'phone', 'mobile']);
            const email = getVal(['email', 'email id', 'email_id', 'emailid', 'email address', 'emailaddress', 'mail', 'corporate email', 'company email', 'vendor email']);
            const rawPhone = getVal(['phone', 'mobile', 'contact number', 'phone number', 'telephone', 'mobile number', 'contact no', 'phone no', 'mobile no', 'cell', 'whatsapp'], ['email', 'mail', 'person', 'contactperson']);
            const parsedPhone = parseVendorMobile(rawPhone);
            // Accept mobile numbers with or without +91, validate 10 digits after country code, and store with country code without duplication
            const phone = parsedPhone.isValid && parsedPhone.nationalNumber
              ? `+91 ${parsedPhone.nationalNumber}`
              : rawPhone;
            const address = getVal(['address', 'location', 'city', 'plant location', 'street', 'office address', 'plant', 'state', 'pincode', 'pin code']);
            const gstNumber = getVal(['gstnumber', 'gstin', 'gst', 'gst number', 'tax id', 'gst no', 'taxid', 'tax number', 'gstin number']);
            const ratingRaw = getVal(['vendorratingscore', 'rating', 'score', 'vendor rating', 'rating 0 100', 'performance score', 'vendor rating score', 'rating optional', 'rating 0-100', 'rating0100']);
            let vendorRatingScore: number | undefined = undefined;
            if (ratingRaw && !isNaN(Number(ratingRaw))) {
              const num = Number(ratingRaw);
              if (num > 0 && num <= 5) {
                vendorRatingScore = Math.round(num * 20);
              } else {
                vendorRatingScore = Math.min(100, Math.max(0, Math.round(num)));
              }
            }

            return {
              id: `vm-upload-${Date.now()}-${idx}`,
              vendorCode,
              companyName,
              contactPerson,
              email,
              phone,
              address,
              gstNumber,
              vendorRatingScore,
            };
          }).filter((v) => Boolean(v.companyName?.trim() || v.email?.trim() || v.phone?.trim() || v.gstNumber?.trim() || v.contactPerson?.trim()));

          if (parsedVendors.length === 0) {
            const errMsg = 'The uploaded Vendor Master file has no recognizable supplier rows. Please verify your file.';
            setVendorUploadError(errMsg);
            showToast('Invalid Vendor File', errMsg, 'warning');
            setIsParsingVendor(false);
            setVendorJob(null);
            if (vendorFileInputRef.current) vendorFileInputRef.current.value = '';
            return;
          }

          const invalidMobiles = parsedVendors.filter(
            (v) => v.phone && v.phone.trim() !== '' && !isValidVendorMobile(v.phone)
          );
          if (invalidMobiles.length > 0) {
            const sample = invalidMobiles[0].phone;
            const errMsg = `${invalidMobiles.length} vendor record(s) contain invalid or alphanumeric mobile numbers (e.g. "${sample}"). Mobile numbers must be numeric values with exactly 10 digits. Please click 'Edit Data' to correct them.`;
            setVendorUploadError(errMsg);
            showToast('Invalid Mobile Numbers', errMsg, 'warning');
          } else {
            setVendorUploadError(null);
          }

          setStoredVendors(parsedVendors);
          setVendorMasterUploaded(true);
          setVendorFileName(file.name);
          setIsEditingVendorTable(false);

          if (sessionId && !isCsvOrText) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedVendors,
                  fileName: file.name,
                  jobType: 'VENDOR_MASTER',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                const j = jobJson?.data?.job;
                setVendorJob({
                  id: j?.id || `job-${Date.now()}`,
                  jobType: 'VENDOR_MASTER',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedVendors.length,
                  processedRecords: parsedVendors.length,
                  importedRecords: parsedVendors.length,
                  skippedRecords: j?.skippedRecords || 0,
                  failedRecords: j?.failedRecords || 0,
                });
              } else {
                setVendorJob({
                  id: `job-${Date.now()}`,
                  jobType: 'VENDOR_MASTER',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedVendors.length,
                  processedRecords: parsedVendors.length,
                  importedRecords: parsedVendors.length,
                  skippedRecords: 0,
                  failedRecords: 0,
                });
              }
            } catch (e) {
              logger.log('WARN', 'Vendor master background job could not start; local parsing fallback will be used', { error: e }, 'VENDOR_INGESTION');
              setVendorJob({
                id: `job-${Date.now()}`,
                jobType: 'VENDOR_MASTER',
                fileName: file.name,
                status: 'COMPLETED',
                totalRecords: parsedVendors.length,
                processedRecords: parsedVendors.length,
                importedRecords: parsedVendors.length,
                skippedRecords: 0,
                failedRecords: 0,
              });
            }
          } else {
            setVendorJob({
              id: `job-${Date.now()}`,
              jobType: 'VENDOR_MASTER',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedVendors.length,
              processedRecords: parsedVendors.length,
              importedRecords: parsedVendors.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          try {
            const existingHistory = JSON.parse(localStorage.getItem('procucev_vendor_upload_history') || '[]');
            const historyEntry = {
              id: `up-${Date.now()}`,
              fileName: file.name,
              timestamp: new Date().toLocaleString(),
              total: parsedVendors.length,
              imported: parsedVendors.length,
              duplicates: 0,
              failed: 0,
              records: parsedVendors.slice(0, 100).map((v) => ({
                vendorCode: v.vendorCode,
                name: v.companyName,
                contactPerson: v.contactPerson,
                email: v.email,
                phone: v.phone,
                gstin: v.gstNumber,
                category: 'Vendor Master',
                city: v.address,
                rating: v.vendorRatingScore,
              })),
            };
            const updatedHistory = [historyEntry, ...existingHistory.filter((x: any) => x.fileName !== file.name)].slice(0, 30);
            localStorage.setItem('procucev_vendor_upload_history', JSON.stringify(updatedHistory));
          } catch {}

          showToast('Vendor Master Uploaded', `Loaded ${parsedVendors.length.toLocaleString('en-IN')} vendors from ${file.name}.`, 'success');
        } catch (err: any) {
          logger.log('ERROR', 'Vendor master file parsing failed', { error: err }, 'VENDOR_INGESTION');
          showToast('Parsing Error', `Could not parse file: ${err.message || 'Unknown format'}`, 'warning');
          setVendorJob(null);
        } finally {
          setIsParsingVendor(false);
        }
      };

      reader.onerror = () => {
        showToast('File Read Error', 'Failed to read file from disk.', 'warning');
        setIsParsingVendor(false);
        setVendorJob(null);
      };

      reader.readAsArrayBuffer(file);
  };

  // Real File Upload & SheetJS/CSV Parsing for File 2: PO Purchase Dump
  const handlePODataFileUpload = (file: File) => {
    if (!file) return;
    if (blockIfAiRunning()) return;
    if (!isAllowedSpreadsheetFile(file)) {
      showToast('Unsupported File Type', `"${file.name}" is not a supported spreadsheet file. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`, 'warning');
      return;
    }

    setPoFileName(file.name);
    setIsParsingPo(true);

    // Set initial active job state
    setPoJob({
      id: `job-po-${Date.now()}`,
      jobType: 'PO_DUMP',
      fileName: file.name,
      status: 'PROCESSING',
      totalRecords: 0,
      processedRecords: 0,
      importedRecords: 0,
      skippedRecords: 0,
      failedRecords: 0,
    });

    const isCsvOrText = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt');
    setPoFileName(file.name);

    if (isCsvOrText && sessionId) {
      // Direct stream upload for large PO dumps / session tracking in parallel
      (async () => {
        try {
          const token =
            typeof window !== 'undefined'
              ? localStorage.getItem('procucev_auth_token') || sessionStorage.getItem('procucev_auth_token')
              : null;

          const res = await fetch(`/api/vendor-ingestion/${sessionId}/stream-upload?type=PO_DUMP&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/csv',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: file,
          });

          if (res.ok) {
            const json = await res.json();
            if (json?.data?.job) {
              setPoJob(json.data.job);
              showToast('Ingestion Started', `Started background streaming ingestion for PO dump ${file.name}. Progress is tracked live.`, 'info');
            }
          } else {
            const errJson = await res.json().catch(() => null);
            const errMsg = errJson?.error || errJson?.message || `PO upload stream error: ${res.statusText}`;
            setPoUploadError(errMsg);
            showToast('PO Upload Error', errMsg, 'warning');
          }
        } catch (err: any) {
          logger.log('ERROR', 'Purchase order streaming upload failed', { error: err }, 'PURCHASE_ORDER_INGESTION');
          const errMsg = err?.message || 'Streaming PO upload failed';
          setPoUploadError(errMsg);
          showToast('Upload Error', errMsg, 'warning');
        }
      })();
    }

    // Always parse file client-side so poLineItems and table UI are populated immediately
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawJson || rawJson.length === 0) {
            const errMsg = 'The uploaded PO dump file has no readable data rows.';
            setPoUploadError(errMsg);
            showToast('Empty PO File', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            return;
          }

          const headerKeys = Object.keys(rawJson[0]);
          // The three required columns must each be present. Other PO columns are optional.
          const missingHeaders = findMissingPoDumpHeaders(headerKeys);

          if (missingHeaders.length > 0) {
            const foundHeaders = headerKeys.filter(Boolean).slice(0, 6).join(', ') || UI_STRINGS.vendorPoIngestion.poDump.noHeadersFound;
            const errMsg = formatString(UI_STRINGS.vendorPoIngestion.poDump.missingColumnsTemplate, {
              columns: missingHeaders.join(', '),
              found: foundHeaders,
            });
            setPoUploadError(errMsg);
            showToast(UI_STRINGS.vendorPoIngestion.poDump.invalidHeadersTitle, errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            if (poFileInputRef.current) poFileInputRef.current.value = '';
            return;
          }

          const invalidPoRows: string[] = [];
          const parsedPOs: PurchaseOrderLineItemRecord[] = rawJson.map((row, idx) => {
            const keys = Object.keys(row);
            const getRawVal = (possibleKeys: string[], excludeSubstrings: string[] = []): unknown => {
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matchedKey = keys.find((k) => k.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === pkClean);
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return row[matchedKey];
                }
              }
              for (const pk of possibleKeys) {
                const pkClean = pk.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!pkClean || pkClean.length < 3) continue;
                const matchedKey = keys.find((k) => {
                  const kClean = k.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                  if (excludeSubstrings.some((ex) => kClean.includes(ex.toLowerCase().replace(/[^a-z0-9]/g, '')))) return false;
                  return kClean.includes(pkClean);
                });
                if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== '') {
                  return row[matchedKey];
                }
              }
              return undefined;
            };

            const getVal = (possibleKeys: string[], excludeSubstrings: string[] = []): string => {
              const raw = getRawVal(possibleKeys, excludeSubstrings);
              return raw !== undefined && raw !== null ? String(raw).trim() : '';
            };

            const poNumber = getVal(['ponumber', 'po number', 'po #', 'po no', 'pono', 'order id', 'order number', 'order no']);
            const rawPoDate = getRawVal(['podate', 'po date', 'date', 'order date', 'creation date']);
            const poDate = normalizePoDate(rawPoDate) || '';
            const vendorIdentifier = getVal(['vendor name', 'vendor identifier', 'vendor', 'supplier name', 'supplier', 'company name', 'vendor code', 'vendor id']);
            const itemName = getVal(['line item description', 'line item', 'item description', 'description', 'item name', 'product description', 'product name', 'material description', 'material', 'service description', 'service', 'item']);
            const specs = getVal(['specs', 'specification', 'technical specs', 'specifications', 'details', 'item specs', 'grade']);
            
            const qtyRaw = getVal(['quantity', 'qty', 'units', 'count', 'ordered qty', 'volume']);
            // 0 means no usable quantity. The row is rejected below rather than set to 1.
            const quantity = qtyRaw && !isNaN(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) ? Math.round(Number(String(qtyRaw).replace(/[^0-9.]/g, ''))) : 0;
            
            const unit = getVal(['unit', 'uom', 'unit of measure', 'units']);

            const unitPriceRaw = getVal(['unit price inr', 'unit price', 'unit rate', 'rate inr', 'rate', 'price inr', 'price', 'item price']);
            const totalSpendRaw = getVal(['total spend inr', 'total spend (inr)', 'total spend rs', 'total spend', 'total amount inr', 'total amount (inr)', 'total amount', 'total inr', 'total (inr)', 'spend inr', 'spend', 'amount inr', 'amount', 'total value', 'po amount', 'total']);

            const parsedUnitPrice = unitPriceRaw && !isNaN(Number(String(unitPriceRaw).replace(/[^0-9.]/g, ''))) ? Number(String(unitPriceRaw).replace(/[^0-9.]/g, '')) : 0;
            const parsedTotalSpend = totalSpendRaw && !isNaN(Number(String(totalSpendRaw).replace(/[^0-9.]/g, ''))) ? Number(String(totalSpendRaw).replace(/[^0-9.]/g, '')) : 0;

            let totalSpend = parsedTotalSpend;
            let unitPrice = parsedUnitPrice;

            if (totalSpend > 0 && unitPrice === 0 && quantity > 0) {
              unitPrice = Math.round(totalSpend / quantity);
            } else if (totalSpend === 0 && unitPrice > 0) {
              totalSpend = unitPrice * quantity;
            }
            // With neither a unit price nor a spend figure, the row is rejected below. It is not priced at a guess.

            const department = getVal(['department', 'dept', 'cost center', 'plant', 'division', 'function']);

            // Rows the filter below would drop as blank are skipped here. Any other row must name every
            // required field it lacks. Nothing is substituted for a missing value. Category is not read from the
            // file: the AI job extracts it per supplier from the stored PO history.
            const isBlankRow = !vendorIdentifier && !itemName && !department;
            const missingFields = findMissingPoDumpFields({ vendorIdentifier, itemName, specs });
            if (!isBlankRow && missingFields.length > 0) {
              invalidPoRows.push(`${formatString(UI_STRINGS.vendorPoIngestion.validation.errorRowTemplate, { row: idx + 2 })}: ${missingFields.join(', ')}`);
            }

            return {
              id: `po-upload-${Date.now()}-${idx}`,
              poNumber,
              poDate,
              vendorName: vendorIdentifier,
              vendorIdentifier,
              itemName,
              itemDescription: itemName,
              specs,
              specification: specs,
              quantity,
              unit,
              uom: unit,
              unitPrice,
              totalSpend,
              spend: totalSpend,
              department: department || '',
            };
          })
            .filter((p) => Boolean(p.vendorIdentifier?.trim() || p.vendorName?.trim() || p.itemName?.trim() || p.itemDescription?.trim() || p.department?.trim()))
            .sort((a, b) => new Date(b.poDate || 0).getTime() - new Date(a.poDate || 0).getTime());

          // Any incomplete row rejects the whole file, so no partial PO dump is stored.
          if (invalidPoRows.length > 0) {
            const errMsg = `Nothing was imported. Fix these rows and upload the PO dump again: ${invalidPoRows.join('; ')}.`;
            setPoUploadError(errMsg);
            showToast('Invalid PO File', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            if (poFileInputRef.current) poFileInputRef.current.value = '';
            return;
          }

          if (parsedPOs.length === 0) {
            const errMsg = 'The uploaded PO dump file contains no recognizable purchase order records. Please verify your file.';
            setPoUploadError(errMsg);
            showToast('Invalid PO File', errMsg, 'warning');
            setIsParsingPo(false);
            setPoJob(null);
            if (poFileInputRef.current) poFileInputRef.current.value = '';
            return;
          }

          setPoUploadError(null);
          setPoLineItems(parsedPOs);
          setPoDataUploaded(true);
          // A new dump replaces the PO history that an earlier AI result was built from.
          setApiJoinedVendors(null);
          setAiJob(null);

          if (sessionId && !isCsvOrText) {
            try {
              const jobRes = await fetch(`/api/vendor-ingestion/${sessionId}/start-job`, {
                method: 'POST',
                headers: authFetchHeaders(),
                body: JSON.stringify({
                  rows: parsedPOs,
                  fileName: file.name,
                  jobType: 'PO_DUMP',
                }),
              });
              if (jobRes.ok) {
                const jobJson = await jobRes.json();
                const j = jobJson?.data?.job;
                setPoJob({
                  id: j?.id || `job-po-${Date.now()}`,
                  jobType: 'PO_DUMP',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedPOs.length,
                  processedRecords: parsedPOs.length,
                  importedRecords: parsedPOs.length,
                  skippedRecords: j?.skippedRecords || 0,
                  failedRecords: j?.failedRecords || 0,
                });
              } else {
                setPoJob({
                  id: `job-po-${Date.now()}`,
                  jobType: 'PO_DUMP',
                  fileName: file.name,
                  status: 'COMPLETED',
                  totalRecords: parsedPOs.length,
                  processedRecords: parsedPOs.length,
                  importedRecords: parsedPOs.length,
                  skippedRecords: 0,
                  failedRecords: 0,
                });
              }
            } catch (e) {
              logger.log('WARN', 'Purchase order background job could not start; local parsing fallback will be used', { error: e }, 'PURCHASE_ORDER_INGESTION');
              setPoJob({
                id: `job-po-${Date.now()}`,
                jobType: 'PO_DUMP',
                fileName: file.name,
                status: 'COMPLETED',
                totalRecords: parsedPOs.length,
                processedRecords: parsedPOs.length,
                importedRecords: parsedPOs.length,
                skippedRecords: 0,
                failedRecords: 0,
              });
            }
          } else {
            setPoJob({
              id: `job-po-${Date.now()}`,
              jobType: 'PO_DUMP',
              fileName: file.name,
              status: 'COMPLETED',
              totalRecords: parsedPOs.length,
              processedRecords: parsedPOs.length,
              importedRecords: parsedPOs.length,
              skippedRecords: 0,
              failedRecords: 0,
            });
          }

          showToast('PO Dump Uploaded', `Successfully parsed & loaded ${parsedPOs.length.toLocaleString('en-IN')} PO line items from ${file.name}.`, 'success');
        } catch (err: any) {
          logger.log('ERROR', 'Purchase order dump parsing failed', { error: err }, 'PURCHASE_ORDER_INGESTION');
          const errMsg = `Could not parse PO file: ${err.message || 'Unknown format'}`;
          setPoUploadError(errMsg);
          showToast('Parsing Error', errMsg, 'warning');
          setPoJob(null);
        } finally {
          setIsParsingPo(false);
        }
      };

      reader.onerror = () => {
        const errMsg = 'Failed to read file from disk.';
        setPoUploadError(errMsg);
        showToast('File Read Error', errMsg, 'warning');
        setIsParsingPo(false);
        setPoJob(null);
      };

      reader.readAsArrayBuffer(file);
  };

  const clearVendorMasterData = () => {
    setStoredVendors([]);
    setApiJoinedVendors(null);
    setVendorMasterUploaded(false);
    setVendorFileName('');
    setVendorUploadError(null);
    setIsEditingVendorTable(false);
    if (vendorFileInputRef.current) {
      vendorFileInputRef.current.value = '';
    }
    showToast('Selection Cleared', 'Vendor Master selection has been removed. Please upload a file.', 'info');
  };

  /** Clear the PO dump held in the browser, and any AI result or job built from it. */
  const clearPoDumpState = (period: '1_year' | '2_years' | '3_years') => {
    setPoLineItems([]);
    setApiJoinedVendors(null);
    setAiJob(null);
    setPoJob(null);
    setPoFileName(`PO_Purchase_Dump_${period}.xlsx`);
    setPoDataUploaded(false);
    setPoUploadError(null);
    if (poFileInputRef.current) {
      poFileInputRef.current.value = '';
    }
  };

  const resetPoUpload = () => {
    if (blockIfAiRunning()) return;
    clearPoDumpState(selectedPeriod);
    showToast('Reset Complete', 'PO Dump line items cleared. Please upload your spreadsheet.', 'info');
  };

  /**
   * Save the chosen period on the server, which is the window the AI job reads. The server clears any stored
   * PO rows when the window changes, so the browser clears its copy to match.
   */
  const choosePeriod = async (period: '1_year' | '2_years' | '3_years') => {
    if (isAiRunning) {
      showToast('Period Locked', UI_STRINGS.vendorPoIngestion.aiCategory.blockedWhileRunning, 'warning');
      return;
    }
    setSelectedPeriod(period);
    setHistoricalPurchaseDataPeriod(period);
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/vendor-ingestion/session/${sessionId}/time-horizon`, {
        method: 'PUT',
        headers: authFetchHeaders(),
        body: JSON.stringify({ horizonType: VENDOR_INGESTION_HORIZON_BY_PERIOD[period] }),
      });
      if (!res.ok) throw new Error(`Time horizon update failed with HTTP ${res.status}.`);
      const json = await res.json();
      if (json?.poDataCleared) {
        clearPoDumpState(period);
        showToast('PO Dump Cleared', UI_STRINGS.vendorPoIngestion.horizon.changeWarning, 'info');
      }
    } catch (err) {
      logger.log('WARN', 'Could not save the historical period on the server', { error: err }, 'VENDOR_INGESTION');
      showToast('Period Not Saved', UI_STRINGS.vendorPoIngestion.aiCategory.periodNotSaved, 'warning');
    }
  };

  // Browser-side join between the Vendor Master and the PO lines. It records which suppliers have PO history and
  // what they bought. It assigns no categories: categories come only from the server's AI category job.
  const computeJoinedRecords = (): HistoricalPurchaseVendorRecord[] => {
    return storedVendors.map((v) => {
      const matchingPOs = matchPoLinesForVendor(v);
      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + p.totalSpend, 0);

      const parsedP = parseVendorMobile(v.phone);
      const cleanPhone = parsedP.isValid && parsedP.nationalNumber ? `+91 ${parsedP.nationalNumber}` : v.phone;

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: cleanPhone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: false,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs
          ? `${formatCurrency(totalAmount)} (${matchingPOs.length} POs)`
          : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: '',
        secondSetMinorCategories: [],
        secondSetSecondaryMajors: [],
      };
    });
  };

  // Editable Vendor Master Table Handlers
  const handleUpdateVendorField = (id: string, field: keyof VendorMasterUploadRecord, value: any) => {
    setStoredVendors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const handleDeleteVendorRow = (id: string) => {
    setStoredVendors((prev) => {
      const updated = prev.filter((v) => v.id !== id);
      if (updated.length === 0) {
        setVendorMasterUploaded(false);
      }
      return updated;
    });
  };

  const handleAddVendorRow = () => {
    const usedCodes = new Set(
      storedVendors.map((v) => String(v.vendorCode || '').trim().toLowerCase()).filter(Boolean)
    );
    let nextSeq = 1;
    while (usedCodes.has(String(nextSeq).toLowerCase())) {
      nextSeq++;
    }
    const newVendor: VendorMasterUploadRecord = {
      id: globalThis.crypto.randomUUID(),
      vendorCode: String(nextSeq),
      companyName: '',
      contactPerson: '',
      email: '',
      phone: '',
      address: '',
      gstNumber: '',
      vendorRatingScore: undefined,
    };
    setStoredVendors((prev) => [...prev, newVendor]);
    setVendorMasterUploaded(true);
    setIsEditingVendorTable(true);
  };

  const fallbackJoined = computeJoinedRecords();
  const joinedVendors = apiJoinedVendors || fallbackJoined;
  const mappedVendors = joinedVendors.filter((v) => v.categoriesMappedByBuyer);
  const unmappedVendors = joinedVendors.filter((v) => !v.categoriesMappedByBuyer);

  // Download the Vendor Master template (.xlsx)
  const handleDownloadVendorMasterExcel = () => {
    // Headers only. The template carries no sample vendors, so nothing is pre-filled.
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Vendor Code', 'Company Name', 'Contact Person', 'Email ID', 'Phone', 'Address', 'GSTIN', 'Rating (0-100 Optional)'],
    ]);
    const workbook: XLSX.WorkBook = {
      Sheets: { 'Vendor Master': worksheet },
      SheetNames: ['Vendor Master'],
    };
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Procucev_Template_1_Vendor_Master.xlsx';
    link.click();
    showToast('Template Downloaded', 'Vendor Master Excel template downloaded.', 'success');
  };
  const handleDownloadVendorMasterCsv = handleDownloadVendorMasterExcel;

  // Download the PO Purchase Dump template (.xlsx)
  const handleDownloadPoDataExcel = () => {
    // Headers only. The template carries no sample purchase orders, so nothing is pre-filled.
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'PO Number',
        'PO Date',
        'Vendor Name',
        'Item Description',
        'Specifications',
        'Quantity',
        'Unit',
        'Unit Price (INR)',
        'Total Spend (INR)',
      ],
    ]);
    const workbook: XLSX.WorkBook = {
      Sheets: { 'PO Purchase Dump': worksheet },
      SheetNames: ['PO Purchase Dump'],
    };
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Procucev_Template_2_PO_Purchase_Dump_${selectedPeriod}.xlsx`;
    link.click();
    showToast('Template Downloaded', 'PO Purchase Dump Excel template downloaded.', 'success');
  };
  const handleDownloadPoDataCsv = handleDownloadPoDataExcel;

  /**
   * Run the AI Category Cross-Match. The PO dump is optional: without one there is nothing to categorise, so
   * suppliers open for review with no purchase history. With one, the server runs the join and the AI category
   * extraction as a background job; the progress card polls it, and the completion effect opens the review.
   */
  const handleSimulatePOJoin = async () => {
    if (isProcessingPOJoin || isAiRunning) return;
    if (storedVendors.length === 0) {
      const msg = 'Vendor Master is required. Please upload your Vendor Master spreadsheet before running AI Category Cross-Match.';
      setVendorUploadError(msg);
      showToast('Vendor Master Required', msg, 'warning');
      setStep(2);
      return;
    }
    if (invalidVendors.length > 0) {
      const msg = `Cannot proceed: ${invalidVendors.length} vendor record(s) contain missing or invalid required fields (Company Name, Email, or Mobile). Please fix them before continuing.`;
      setVendorUploadError(msg);
      showToast('Validation Error in Vendor Master', msg, 'warning');
      setStep(2);
      return;
    }

    if (!hasPoDump) {
      setPoUploadError(null);
      setApiJoinedVendors(null);
      setStep(4);
      return;
    }

    if (!sessionId) {
      setPoUploadError(UI_STRINGS.vendorPoIngestion.aiCategory.sessionNotReady);
      return;
    }

    setIsProcessingPOJoin(true);
    setPoUploadError(null);
    try {
      const res = await fetch(`/api/vendor-ingestion/${sessionId}/ai-categorize-job`, {
        method: 'POST',
        headers: authFetchHeaders(),
      });
      const json = await res.json().catch(() => null);
      const job: IngestionJobState | undefined = json?.data?.job;
      if (!res.ok || !job) {
        const msg: string = json?.error || UI_STRINGS.vendorPoIngestion.aiCategory.startFailed;
        setPoUploadError(msg);
        showToast('AI Category Cross-Match', msg, 'warning');
        return;
      }
      setAiJob({ ...job, fileName: job.fileName || poFileName });
      logger.log('INFO', 'AI category job started', { sessionId, jobId: job.id, status: job.status }, 'VENDOR_INGESTION');
    } catch (err) {
      logger.log('ERROR', 'Could not start the AI category job', { error: err }, 'VENDOR_INGESTION');
      setPoUploadError(UI_STRINGS.vendorPoIngestion.aiCategory.startFailed);
      showToast('AI Category Cross-Match', UI_STRINGS.vendorPoIngestion.aiCategory.startFailed, 'warning');
    } finally {
      setIsProcessingPOJoin(false);
    }
  };

  const handleConfirmFinalIngestion = async () => {
    if (isConfirmingIngestion) return;
    setSubmissionError(null);
    setIsConfirmingIngestion(true);
    try {
      if (joinedVendors.length === 0) {
        const msg = 'No vendor records found to ingest. Please upload a valid Vendor Master file first.';
        setSubmissionError(msg);
        showToast('Ingestion Error', msg, 'warning');
        return;
      }
      const imported = await processHistoricalPurchaseData(selectedPeriod, joinedVendors);
      const actualError = lastIngestionError || (typeof getLastHistoricalDataError === 'function' ? getLastHistoricalDataError() : null);
      if (actualError) {
        setSubmissionError(actualError);
        showToast('Ingestion Error', actualError, 'warning');
        return;
      }
      const summary = lastIngestionSummary;
      if (summary) {
        setCompletionSummary(summary);
      }
      if (summary && ((summary.skippedCount && summary.skippedCount > 0) || (summary.failedEmailCount && summary.failedEmailCount > 0))) {
        setInitialSetupModalOpen(false);
        showToast(
          'Ingestion Completed with Warnings',
          `${imported} vendor(s) uploaded successfully, but ${summary.skippedCount || 0} record(s) failed or were skipped.`,
          'warning'
        );
        return;
      }
      setInitialSetupModalOpen(false);
      showToast(
        'Setup Complete',
        `Dual-file vendor master and PO data ingested successfully for ${selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'} (${imported} suppliers processed).`,
        'success'
      );
    } catch (err: any) {
      logger.log('ERROR', 'Historical purchase ingestion confirmation failed', { error: err }, 'HISTORICAL_INGESTION');
      const msg = err?.message || 'An unexpected error occurred during ingestion. Please try again.';
      setSubmissionError(msg);
      showToast('Ingestion Error', msg, 'warning');
    } finally {
      setIsConfirmingIngestion(false);
    }
  };

  const handleRetryFailedEmails = async () => {
    if (isRetryingFailedEmails) return;
    setIsRetryingFailedEmails(true);
    try {
      await processHistoricalPurchaseData(selectedPeriod, joinedVendors);
      showToast(
        'Retrying Dispatches',
        'Re-attempting emails for failed vendors. Already sent emails were preserved.',
        'info'
      );
    } catch (err) {
      logger.log('ERROR', 'Historical purchase onboarding retry failed', { error: err }, 'HISTORICAL_INGESTION');
      showToast('Retry Failed', 'Could not complete retry dispatch.', 'warning');
    } finally {
      setIsRetryingFailedEmails(false);
    }
  };

  const handleCompleteAndClose = () => {
    if (setInitialSetupCompleted) {
      setInitialSetupCompleted(true);
    }
    setInitialSetupModalOpen(false);
    setCompletionSummary(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl p-6 sm:p-8 bg-white dark:bg-gray-900 border-2 border-indigo-500/30 dark:border-indigo-500/40 shadow-2xl space-y-6 animate-scale-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-gray-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Buyer Initial Setup: Vendor Master & PO Data Ingestion
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 leading-relaxed">
                {activeBuyerAccount?.organizationName ? <>Organization: <strong>{activeBuyerAccount.organizationName}</strong> · </> : null}Upload Vendor Master and PO purchase dump separately for AI category cross-mapping.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
              title="Dismiss setup (you can resume from the blinking corner badge)"
            >
              <X size={20} />
            </button>
          </div>
        </div>


        {/* Step Progress Indicators */}
        <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] font-bold">
          {[
            { num: 1, label: '1. Time Horizon' },
            { num: 2, label: '2. Vendor Master' },
            { num: 3, label: '3. PO Dump' },
            { num: 4, label: '4. Dispatch Emails' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => navigateToStep(s.num as any)}
              className={`p-2 rounded-xl border transition-all ${
                step === s.num
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : step > s.num
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200'
                  : 'bg-slate-50 dark:bg-gray-800/60 text-slate-400 dark:text-gray-500 border-slate-200 dark:border-gray-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1: CHOOSE TIME HORIZON */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 1: Choose Historical Purchase Period
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: '1_year' as const,
                  title: 'Last 1 Year (12 Months)',
                  desc: 'Fast bootstrap focusing on recent high-velocity procurement spares.',
                  badge: 'Quick Ingestion',
                },
                {
                  id: '2_years' as const,
                  title: 'Last 2 Years (24 Months)',
                  desc: 'Recommended baseline covering seasonal maintenance & capex cycles.',
                  badge: '⭐ Recommended',
                },
                {
                  id: '3_years' as const,
                  title: 'Last 3 Years (36 Months)',
                  desc: 'Complete historical enterprise audit and comprehensive supplier discovery.',
                  badge: 'Full Enterprise Audit',
                },
              ].map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => {
                    void choosePeriod(opt.id);
                  }}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    selectedPeriod === opt.id
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20 shadow-md'
                      : 'border-slate-200 dark:border-gray-800 hover:border-slate-300 dark:hover:border-gray-700 bg-slate-50/50 dark:bg-gray-850/40'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedPeriod === opt.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300'
                        }`}
                      >
                        {opt.badge}
                      </span>
                      <Clock size={15} className={selectedPeriod === opt.id ? 'text-indigo-600' : 'text-slate-400'} />
                    </div>
                    <h4 className="text-xs font-black text-slate-900 dark:text-white mt-1">{opt.title}</h4>
                    <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigateToStep(2)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Continue to File 1: Vendor Master <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: FILE 1 — VENDOR MASTER DATA INGESTION */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={vendorFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVendorFileUpload(file);
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 2: Upload File 1 — Vendor Master
              </h3>
              {storedVendors.length > 0 && (
                <button
                  type="button"
                  onClick={clearVendorMasterData}
                  className="text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400 underline font-medium"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {/* Vendor Master Template & Required Columns Banner */}
            <div className="p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/70 via-purple-50/30 to-blue-50/70 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-blue-950/40 flex items-center justify-between gap-3 shadow-xs flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="badge badge-indigo font-bold text-[10px] shrink-0">Required Columns</span>
                <span className="text-xs text-slate-700 dark:text-gray-300 font-medium">
                  Vendor Code, Company Name, Contact Person, Mobile, Email, GSTIN &amp; Location
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadVendorMasterExcel}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Download size={13} /> Download Vendor Master Template
                </button>
              </div>
            </div>

            {/* Error Banner if Vendor Upload has issues */}
            {vendorUploadError && (
              <div
                data-testid="vendor-upload-error-banner"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5 shadow-xs animate-shake"
              >
                <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-rose-900 dark:text-rose-100">Vendor Master Upload / Validation Error</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{vendorUploadError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setVendorUploadError(null)}
                  className="text-rose-500 hover:text-rose-700 dark:text-rose-400 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Validation Warning Banner if some stored vendors are missing required fields */}
            {storedVendors.length > 0 && invalidVendors.length > 0 && (
              <div
                data-testid="vendor-validation-warning-banner"
                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 shadow-xs"
              >
                <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-amber-900 dark:text-amber-100">
                    {invalidVendors.length} Supplier Record{invalidVendors.length > 1 ? 's' : ''} Missing Required Fields
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    Required field: <strong>Company Name</strong> (and mobile numbers must be 10-digit numeric values).
                    Please click &apos;Edit Data&apos; to fix records missing company names or with invalid mobile numbers before continuing.
                  </p>
                  {!isEditingVendorTable && (
                    <button
                      type="button"
                      onClick={() => setIsEditingVendorTable(true)}
                      className="btn btn-secondary btn-xs font-bold text-[10px] mt-2 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1"
                    >
                      <Pencil size={11} /> Edit and Fix Incomplete Records
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Progress Card when upload is active or completed */}
            {vendorJob && (
              <IngestionProgressCard job={vendorJob} title="Vendor Master" unit="vendors" />
            )}

            {/* Drag & Drop Vendor Master Area or Uploaded State Banner */}
            {storedVendors.length > 0 || vendorJob?.status === 'COMPLETED' ? (
              <div
                data-testid="vendor-master-uploaded-card"
                className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border-2 border-emerald-500/40 dark:border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fade-in"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        Vendor Master Uploaded Successfully
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border border-emerald-400/40">
                        <Check size={10} /> Active
                      </span>
                    </div>
                    <p className="text-sm font-black font-mono text-slate-900 dark:text-white">
                      {vendorFileName || vendorJob?.fileName || '—'}
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium">
                      {(vendorJob?.importedRecords || storedVendors.length).toLocaleString('en-IN')} suppliers parsed and loaded into vendor master
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => vendorFileInputRef.current?.click()}
                    className="btn btn-secondary btn-sm font-bold text-xs flex items-center gap-1.5 border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
                    title="Replace or upload a different Vendor Master file"
                  >
                    <UploadCloud size={13} /> Choose Another File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearVendorMasterData();
                      setVendorJob(null);
                    }}
                    className="btn btn-secondary btn-sm font-bold text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900/50 flex items-center gap-1.5"
                    title="Clear uploaded Vendor Master file"
                  >
                    <Trash2 size={13} /> Clear
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => vendorFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingVendor(true);
                }}
                onDragLeave={() => setIsDraggingVendor(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingVendor(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleVendorFileUpload(file);
                }}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                  isDraggingVendor
                    ? 'border-indigo-600 bg-indigo-100/70 dark:bg-indigo-900/50 scale-[1.01]'
                    : 'border-indigo-300 dark:border-indigo-500/50 hover:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 hover:bg-indigo-50/80'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center mx-auto text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                  <UploadCloud size={20} />
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-white mt-2">
                  {isParsingVendor || vendorJob?.status === 'PROCESSING'
                    ? 'Streaming and Processing Vendor Records in Background...'
                    : 'Click to browse or drag & drop Vendor Master (.xlsx, .csv, .xls)'}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      vendorFileInputRef.current?.click();
                    }}
                    className="btn btn-primary btn-xs font-bold text-[10px] inline-flex items-center gap-1 shadow-xs"
                  >
                    <UploadCloud size={11} /> Browse File
                  </button>
                  <span className="text-[10px] text-slate-400">Supported formats: .xlsx, .csv, .xls (Max 10MB)</span>
                </div>
              </div>
            )}

            {/* Table of Stored Vendor Master or Empty State */}
            {storedVendors.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      {isEditingVendorTable ? 'Editing Vendor Master Records' : 'Stored Vendor Master Records'} ({storedVendors.length.toLocaleString('en-IN')} Suppliers):
                    </span>
                    {isEditingVendorTable && (
                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800/50 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles size={10} /> Edit Mode Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingVendorTable ? (
                      <>
                        <button
                          type="button"
                          onClick={handleAddVendorRow}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1"
                        >
                          <Plus size={11} /> Add Vendor Row
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(false)}
                          className="btn btn-primary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs"
                        >
                          <Check size={11} /> Done Editing
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsEditingVendorTable(true)}
                          className="btn btn-secondary btn-xs font-bold text-[10px] flex items-center gap-1 shadow-xs border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                        >
                          <Pencil size={11} /> Edit Data
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingVendorTable ? (
                  /* EDITABLE MODE TABLE */
                  <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900 shadow-inner ring-1 ring-indigo-500/20">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-indigo-50/70 dark:bg-gray-800 text-[10px] uppercase font-bold text-indigo-900 dark:text-gray-300 sticky top-0 z-10">
                        <tr>
                          <th className="p-2 w-28">Vendor Code</th>
                          <th className="p-2 min-w-[140px]">Company Name *</th>
                          <th className="p-2 min-w-[120px]">Contact Person</th>
                          <th className="p-2 min-w-[140px]">Email Address</th>
                          <th className="p-2 min-w-[110px]">Phone</th>
                          <th className="p-2 min-w-[120px]">GSTIN</th>
                          <th className="p-2 min-w-[140px]">Address / Location</th>
                          <th className="p-2 min-w-[110px]">Rating</th>
                          <th className="p-2 w-10 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => {
                          const rowErrors = getVendorRowErrors(v);
                          const hasErrors = rowErrors.length > 0;
                          const isNameInvalid = !v.companyName || v.companyName.trim() === '';
                          const isEmailInvalid = Boolean(v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()));
                          const isPhoneInvalid = Boolean(v.phone && v.phone.trim() !== '' && !isValidVendorMobile(v.phone));

                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors ${
                                hasErrors
                                  ? 'bg-rose-50/50 dark:bg-rose-950/20'
                                  : 'hover:bg-indigo-50/30 dark:hover:bg-gray-800/50'
                              } group`}
                            >
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.vendorCode || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'vendorCode', e.target.value)}
                                  placeholder="VND-CODE"
                                  className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.companyName || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'companyName', e.target.value)}
                                  placeholder="Company name"
                                  className={`w-full font-bold text-xs px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isNameInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-900 dark:text-white focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isNameInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">Required</span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.contactPerson || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'contactPerson', e.target.value)}
                                  placeholder="Contact Name"
                                  className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-300 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="email"
                                  value={v.email || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'email', e.target.value)}
                                  placeholder="email@domain.com"
                                  className={`w-full font-mono text-[10px] font-semibold px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isEmailInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-indigo-600 dark:text-indigo-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isEmailInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">
                                    Invalid Email
                                  </span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.phone || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'phone', e.target.value)}
                                  onBlur={(e) => {
                                    const parsed = parseVendorMobile(e.target.value);
                                    if (parsed.isValid && parsed.nationalNumber) {
                                      handleUpdateVendorField(v.id, 'phone', `+91 ${parsed.nationalNumber}`);
                                    }
                                  }}
                                  placeholder="+91 Phone"
                                  className={`w-full text-[10px] px-1.5 py-1 rounded focus:outline-none transition-all ${
                                    isPhoneInvalid
                                      ? 'border border-rose-400 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 focus:border-rose-500'
                                      : 'border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/80 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900'
                                  }`}
                                />
                                {isPhoneInvalid && (
                                  <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold block mt-0.5">Must be 10 numeric digits</span>
                                )}
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.gstNumber || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'gstNumber', e.target.value.toUpperCase())}
                                  placeholder="GSTIN"
                                  className="w-full font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-gray-200 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <input
                                  type="text"
                                  value={v.address || ''}
                                  onChange={(e) => handleUpdateVendorField(v.id, 'address', e.target.value)}
                                  placeholder="City, State / Address"
                                  className="w-full text-[10px] px-1.5 py-1 rounded bg-slate-50 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-gray-900 focus:outline-none transition-all"
                                />
                              </td>
                              <td className="p-1.5 align-top">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={v.vendorRatingScore !== undefined ? v.vendorRatingScore : ''}
                                    onChange={(e) => {
                                      const raw = e.target.value.trim();
                                      handleUpdateVendorField(
                                        v.id,
                                        'vendorRatingScore',
                                        raw === '' ? undefined : Math.min(100, Math.max(0, Math.round(Number(raw))))
                                      );
                                    }}
                                    placeholder="0-100"
                                    className="w-16 text-center font-bold text-xs px-2 py-1 rounded bg-amber-50/80 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 placeholder:text-amber-400/60 focus:border-amber-500 focus:outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <span className="text-[10px] text-slate-400 font-bold shrink-0">/100</span>
                                </div>
                              </td>
                              <td className="p-1.5 align-top text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteVendorRow(v.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all opacity-70 group-hover:opacity-100"
                                  title={`Delete ${v.companyName || 'Row'}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* DEFAULT READ-ONLY TABLE WITH ALL DISTINCT COLUMNS */
                  <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-96 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                    <table className="w-full text-left border-collapse min-w-[960px]">
                      <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5">Vendor Code</th>
                          <th className="p-2.5">Company Name</th>
                          <th className="p-2.5">Contact Person</th>
                          <th className="p-2.5">Email Address</th>
                          <th className="p-2.5">Phone Number</th>
                          <th className="p-2.5">GSTIN</th>
                          <th className="p-2.5">Address / Location</th>
                          <th className="p-2.5">Rating (0-100)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                        {storedVendors.slice(0, vendorPreviewLimit).map((v) => {
                          const rowErrors = getVendorRowErrors(v);
                          const hasErrors = rowErrors.length > 0;
                          const isNameInvalid = !v.companyName || v.companyName.trim() === '';
                          const isEmailInvalid = Boolean(v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()));
                          const isPhoneInvalid = Boolean(v.phone && v.phone.trim() !== '' && !isValidVendorMobile(v.phone));

                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors ${
                                hasErrors
                                  ? 'bg-rose-50/70 dark:bg-rose-950/30 border-l-4 border-l-rose-500'
                                  : 'hover:bg-slate-50 dark:hover:bg-gray-800/40'
                              }`}
                            >
                              <td className="p-2.5 font-mono text-[10px] text-slate-500 max-w-[100px] truncate" title={v.vendorCode || '1'}>
                                {v.vendorCode || '1'}
                              </td>
                              <td className="p-2.5 font-bold text-slate-800 dark:text-white max-w-[180px]">
                                {isNameInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> Required
                                  </span>
                                ) : (
                                  <span className="truncate block" title={v.companyName}>
                                    {v.companyName}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 text-slate-700 dark:text-gray-300 font-medium max-w-[140px]">
                                <span className="truncate block" title={v.contactPerson || undefined}>
                                  {v.contactPerson || '—'}
                                </span>
                              </td>
                              <td className="p-2.5 font-mono text-[11px] max-w-[180px]">
                                {isEmailInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> Invalid Email
                                  </span>
                                ) : (
                                  <span className="text-indigo-600 dark:text-indigo-400 font-semibold truncate block" title={v.email || undefined}>
                                    {v.email || '—'}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 font-mono text-[11px] max-w-[130px]">
                                {isPhoneInvalid ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1">
                                    <AlertCircle size={11} /> Invalid Mobile ({v.phone})
                                  </span>
                                ) : (
                                  <span className="text-slate-600 dark:text-gray-400 truncate block" title={v.phone || undefined}>
                                    {v.phone || '—'}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 font-mono text-[10px] text-slate-700 dark:text-gray-200 font-bold max-w-[130px]">
                                <span className="truncate block" title={v.gstNumber || undefined}>
                                  {v.gstNumber || '—'}
                                </span>
                              </td>
                              <td className="p-2.5 text-slate-600 dark:text-gray-400 text-[11px] max-w-[200px]">
                                <span className="truncate block" title={v.address || undefined}>
                                  {v.address || '—'}
                                </span>
                              </td>
                              <td className="p-2.5 font-bold">
                                {v.vendorRatingScore !== undefined && v.vendorRatingScore !== null ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                    <Star size={11} className="fill-amber-400 text-amber-500" /> {v.vendorRatingScore}/100
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[10px]">Optional (N/A)</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Vendor Master Pagination / Show More Bar */}
                {storedVendors.length > 50 && (
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                    <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                      Showing <strong>1 – {Math.min(vendorPreviewLimit, storedVendors.length).toLocaleString('en-IN')}</strong> of <strong>{storedVendors.length.toLocaleString('en-IN')}</strong> suppliers
                    </span>
                    <div className="flex items-center gap-2">
                      {vendorPreviewLimit < storedVendors.length && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit((prev) => Math.min(prev + 50, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-indigo-400"
                        >
                          <ChevronDown size={12} /> Show More (+50)
                        </button>
                      )}
                      {vendorPreviewLimit < Math.min(500, storedVendors.length) && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(Math.min(500, storedVendors.length))}
                          className="btn btn-secondary btn-xs font-bold text-[11px] text-indigo-600 dark:text-indigo-400 hover:border-indigo-400"
                        >
                          Show All (up to 500)
                        </button>
                      )}
                      {vendorPreviewLimit > 50 && (
                        <button
                          type="button"
                          onClick={() => setVendorPreviewLimit(50)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                        >
                          Collapse to 50
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 border border-dashed border-slate-200 dark:border-gray-800 rounded-xl bg-slate-50/50 dark:bg-gray-950/40 space-y-2">
                <FileSpreadsheet className="mx-auto text-slate-400" size={24} />
                <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  No Vendor Master file selected
                </p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Upload your vendor master spreadsheet (.xlsx, .csv, .xls) or manually add suppliers to the table.
                </p>
                <button
                  type="button"
                  onClick={handleAddVendorRow}
                  className="btn btn-secondary btn-xs font-bold text-[11px] inline-flex items-center gap-1 mt-1"
                >
                  <Plus size={12} /> Add Vendor Manually
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => navigateToStep(1)} className="btn btn-secondary btn-sm">
                Back to Period
              </button>
              <button
                type="button"
                onClick={() => navigateToStep(3)}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5"
              >
                Proceed to File 2: PO Dump <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FILE 2 — PO PURCHASE DATA INGESTION */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            {/* Hidden native file input */}
            <input
              type="file"
              ref={poFileInputRef}
              className="hidden"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePODataFileUpload(file);
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Step 3: Upload File 2 — Historical PO Purchase Dump
                </h3>
                <span className="badge badge-purple font-bold text-[10px]">
                  {selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'}
                </span>
              </div>
            </div>

            {/* Single-line Simplified PO Dump Info & Download Banner */}
            <div className="p-3.5 rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-gradient-to-r from-purple-50/70 via-indigo-50/30 to-blue-50/70 dark:from-purple-950/40 dark:via-indigo-950/20 dark:to-blue-950/40 flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="badge badge-purple font-bold text-[10px] shrink-0">{UI_STRINGS.vendorPoIngestion.poDump.optionalBadge}</span>
                <span className="text-xs text-slate-700 dark:text-gray-300 font-medium">
                  {UI_STRINGS.vendorPoIngestion.poDump.requiredColumnsBanner}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadPoDataExcel}
                  className="btn btn-secondary btn-sm font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Download size={13} /> Download PO Dump Template (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={resetPoUpload}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-gray-200 underline font-medium"
                >
                  Reset Template
                </button>
              </div>
            </div>

            {/* Error Banner if PO Upload has issues */}
            {poUploadError && (
              <div
                data-testid="po-upload-error-banner"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5 shadow-xs animate-shake"
              >
                <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-rose-900 dark:text-rose-100">PO Dump Upload / Validation Error</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{poUploadError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPoUploadError(null)}
                  className="text-rose-500 hover:text-rose-700 dark:text-rose-400 p-0.5"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Failure of the AI category job, with the server's reason */}
            {aiJob?.status === 'FAILED' && (
              <div
                data-testid="ai-job-error-banner"
                className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5 shadow-xs"
              >
                <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-rose-900 dark:text-rose-100">{UI_STRINGS.vendorPoIngestion.aiCategory.failedTitle}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    {aiJob.errorMessage || UI_STRINGS.vendorPoIngestion.aiCategory.genericFailure}
                  </p>
                </div>
              </div>
            )}

            {/* Progress Card when PO upload is active or completed */}
            {poJob && (
              <IngestionProgressCard job={poJob} title="PO Dump" unit="PO records" />
            )}

            {/* Progress of the AI category job, read from the server while it runs */}
            {aiJob && (
              <IngestionProgressCard
                job={aiJob}
                title={UI_STRINGS.vendorPoIngestion.aiCategory.progressTitle}
                unit={UI_STRINGS.vendorPoIngestion.aiCategory.progressUnit}
              />
            )}

            {/* Drag & Drop PO Dump Area or Uploaded State Banner */}
            {poLineItems.length > 0 || poJob?.status === 'COMPLETED' ? (
              <div
                data-testid="po-dump-uploaded-card"
                className="p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border-2 border-emerald-500/40 dark:border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fade-in"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                        PO Dump Uploaded Successfully
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border border-emerald-400/40">
                        <Check size={10} /> Active
                      </span>
                    </div>
                    <p className="text-sm font-black font-mono text-slate-900 dark:text-white">
                      {poFileName || poJob?.fileName || 'PO_Purchase_Dump.xlsx'}
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium">
                      {(poJob?.importedRecords || poLineItems.length).toLocaleString('en-IN')} PO records loaded for period ({selectedPeriod === '1_year' ? '1 Year' : selectedPeriod === '2_years' ? '2 Years' : '3 Years'})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => poFileInputRef.current?.click()}
                    className="btn btn-secondary btn-sm font-bold text-xs flex items-center gap-1.5 border-slate-300 dark:border-gray-700 text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800"
                    title="Replace or upload a different PO Dump file"
                  >
                    <UploadCloud size={13} /> Choose Another File
                  </button>
                  <button
                    type="button"
                    onClick={resetPoUpload}
                    className="btn btn-secondary btn-sm font-bold text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 border-slate-300 dark:border-gray-700 flex items-center gap-1.5"
                    title="Reset PO data"
                  >
                    <RotateCcw size={13} /> Reset
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => poFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingPo(true);
                }}
                onDragLeave={() => setIsDraggingPo(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingPo(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handlePODataFileUpload(file);
                }}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer group ${
                  isDraggingPo
                    ? 'border-purple-600 bg-purple-100/70 dark:bg-purple-900/50 scale-[1.01]'
                    : 'border-purple-300 dark:border-purple-500/50 hover:border-purple-600 bg-purple-50/40 dark:bg-purple-950/20 hover:bg-purple-50/80'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-600/20 flex items-center justify-center mx-auto text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                  <FileSpreadsheet size={20} />
                </div>
                <div className="text-xs font-bold text-slate-800 dark:text-white mt-2">
                  {isParsingPo || poJob?.status === 'PROCESSING'
                    ? 'Streaming and Processing PO Dump Records in Background...'
                    : 'Click to browse or drag & drop PO Purchase Dump (.xlsx, .csv, .xls)'}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      poFileInputRef.current?.click();
                    }}
                    className="btn btn-primary btn-xs font-bold text-[10px] inline-flex items-center gap-1 shadow-xs"
                  >
                    <UploadCloud size={11} /> Browse File
                  </button>
                  <span className="text-[10px] text-slate-400">Supported formats: .xlsx, .csv, .xls (Max 10MB)</span>
                </div>
              </div>
            )}

            {/* PO Line Items Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    PO Line Items Preview ({poLineItems.length.toLocaleString('en-IN')} Line Items):
                  </span>
                </div>
                <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">
                  Total Spend: {formatCurrency(poLineItems.reduce((acc, p) => acc + p.totalSpend, 0))}
                </span>
              </div>

              <div className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden max-h-56 overflow-y-auto overflow-x-auto text-xs bg-white dark:bg-gray-900/60 shadow-xs">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-slate-100 dark:bg-gray-800 text-[10px] uppercase font-bold text-slate-500 dark:text-gray-400 sticky top-0 z-10">
                    <tr>
                      <th className="p-2.5">PO Number</th>
                      <th className="p-2.5">PO Date</th>
                      <th className="p-2.5">Vendor / Supplier</th>
                      <th className="p-2.5">Line Item Description</th>
                      <th className="p-2.5">Specifications</th>
                      <th className="p-2.5">Quantity</th>
                      <th className="p-2.5">Unit</th>
                      <th className="p-2.5">Unit Price</th>
                      <th className="p-2.5">Total Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-800 bg-white dark:bg-gray-900/60">
                    {poLineItems.slice(0, poPreviewLimit).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                        <td className="p-2.5 font-mono text-[10px] text-slate-500 max-w-[120px] truncate" title={p.poNumber}>{p.poNumber || '—'}</td>
                        <td className="p-2.5 font-mono text-[10px] text-slate-600 dark:text-gray-300">{normalizePoDate(p.poDate) || p.poDate || '—'}</td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-white max-w-[160px]">
                          <span className="truncate block" title={p.vendorIdentifier}>{p.vendorIdentifier}</span>
                        </td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-gray-200 max-w-[200px]">
                          <span className="truncate block" title={p.itemName}>{p.itemName}</span>
                        </td>
                        <td className="p-2.5 text-slate-400 text-[10px] max-w-[160px]">
                          <span className="truncate block" title={p.specs || undefined}>{p.specs || '—'}</span>
                        </td>
                        <td className="p-2.5 text-slate-600 dark:text-gray-300 font-bold">{p.quantity > 0 ? p.quantity.toLocaleString('en-IN') : '—'}</td>
                        <td className="p-2.5 text-slate-500 dark:text-gray-400 text-[10px]">{p.unit}</td>
                        <td className="p-2.5 font-mono text-slate-600 dark:text-gray-300">{p.unitPrice ? formatCurrency(p.unitPrice) : '—'}</td>
                        <td className="p-2.5 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {p.totalSpend > 0 ? formatCurrency(p.totalSpend) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* PO Dump Pagination / Show More Bar */}
              {poLineItems.length > 50 && (
                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-800 text-xs flex-wrap gap-2">
                  <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
                    Showing <strong>1 – {Math.min(poPreviewLimit, poLineItems.length).toLocaleString('en-IN')}</strong> of <strong>{poLineItems.length.toLocaleString('en-IN')}</strong> PO line items
                  </span>
                  <div className="flex items-center gap-2">
                    {poPreviewLimit < poLineItems.length && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit((prev) => Math.min(prev + 50, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] flex items-center gap-1 hover:border-purple-400"
                      >
                        <ChevronDown size={12} /> Show More (+50)
                      </button>
                    )}
                    {poPreviewLimit < Math.min(500, poLineItems.length) && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(Math.min(500, poLineItems.length))}
                        className="btn btn-secondary btn-xs font-bold text-[11px] text-purple-600 dark:text-purple-400 hover:border-purple-400"
                      >
                        Show All (up to 500)
                      </button>
                    )}
                    {poPreviewLimit > 50 && (
                      <button
                        type="button"
                        onClick={() => setPoPreviewLimit(50)}
                        className="text-[11px] text-slate-400 hover:text-slate-600 underline font-medium px-1"
                      >
                        Collapse to 50
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button type="button" onClick={() => navigateToStep(2)} className="btn btn-secondary btn-sm">
                Back to Vendor Master
              </button>
              <button
                type="button"
                onClick={handleSimulatePOJoin}
                disabled={isProcessingPOJoin || isAiRunning}
                className="btn btn-primary font-bold text-xs py-2.5 px-5 flex items-center gap-1.5 disabled:opacity-60"
              >
                {isProcessingPOJoin || isAiRunning
                  ? UI_STRINGS.vendorPoIngestion.aiCategory.runningAction
                  : hasPoDump
                  ? UI_STRINGS.vendorPoIngestion.aiCategory.runAction
                  : UI_STRINGS.vendorPoIngestion.aiCategory.continueWithoutPoAction}{' '}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: FINAL CONFIRMATION & TAILORED EMAIL PREVIEWS */}
        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Step 4: Confirm Ingestion & Dispatch Tailored Onboarding Emails
              </h3>
              <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                The platform will dispatch tailored credentials and category notices based on PO correlation.
              </p>
            </div>

            {/* Ingestion Totals Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                <span className="text-[10px] text-slate-400 block">Total Stored</span>
                <span className="font-black text-slate-900 dark:text-white text-sm">{joinedVendors.length} Vendors</span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">PO Mapped</span>
                <span className="font-black text-emerald-700 dark:text-emerald-300 text-sm">{mappedVendors.length} Suppliers</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
                <span className="text-[10px] text-amber-600 dark:text-amber-400 block">Self-Map Required</span>
                <span className="font-black text-amber-700 dark:text-amber-300 text-sm">{unmappedVendors.length} Suppliers</span>
              </div>
            </div>

            {/* Submission Error Banner */}
            {submissionError && (
              <div
                data-testid="dispatch-submission-error-banner"
                className="p-4 rounded-2xl bg-rose-50/90 dark:bg-rose-950/50 border-2 border-rose-300 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 flex items-start justify-between gap-3 animate-fade-in shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h5 className="font-bold text-xs uppercase tracking-wide text-rose-800 dark:text-rose-300">
                      Ingestion &amp; Dispatch Error
                    </h5>
                    <p className="text-xs font-medium leading-relaxed">{submissionError}</p>
                    <p className="text-[11px] text-rose-700/80 dark:text-rose-400/80">
                      Please verify your file data, network, or server connection and retry.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubmissionError(null)}
                  className="p-1 text-rose-400 hover:text-rose-600 rounded-lg shrink-0"
                  title="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigateToStep(3)}
                className="btn btn-secondary btn-sm"
                disabled={isConfirmingIngestion}
              >
                Back to PO Dump
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleConfirmFinalIngestion}
                  disabled={isConfirmingIngestion}
                  className="btn btn-primary font-bold text-xs py-3 px-6 shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-60"
                >
                  <CheckCircle2 size={16} />{' '}
                  {isConfirmingIngestion ? 'PROCESSING...' : `[ COMPLETE SETUP & INGEST ${joinedVendors.length} VENDORS ]`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
