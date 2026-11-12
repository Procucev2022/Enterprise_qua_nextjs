'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '@/lib/store';
import {
  VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT,
  VENDOR_EVALUATION_GATE_SCORE,
  VENDOR_EVALUATION_PILLARS,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  QuestionEvaluationItem,
  VendorEntry,
  VendorEvaluationPillarId,
  VendorEvaluationPillarView,
  VendorEvaluationRecord,
  VendorEvaluationSelectOption,
  VendorEvaluationSummaryProps,
  VendorEvaluationSummaryView,
} from '@/lib/types';
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Mail,
  Paperclip,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  UploadCloud,
  Zap,
} from 'lucide-react';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';

const SUMMARY = UI_STRINGS.vendorEvaluationSummary;
const NOT_RECORDED = UI_STRINGS.recordPlaceholders.notRecorded;
const NOT_EVALUATED = UI_STRINGS.recordPlaceholders.notEvaluated;

// Classification helper: a supplier the buyer uploaded. Reads only the ownership fields the supplier record carries.
// The supplier ID is never parsed for a prefix.
export const isBuyerUploaded = (
  v: Partial<Pick<VendorEntry, 'source' | 'buyerId' | 'buyerAccountId' | 'addedByBuyerCompany'>> | null | undefined
): boolean => {
  if (!v) return false;
  const s = String(v.source || '').toLowerCase().trim();
  return (
    s === 'buyer_uploaded' ||
    s === 'vendor_master_ingestion' ||
    s === 'historical_purchase_dump' ||
    s === 'buyer_manual' ||
    s === 'buyer_excel' ||
    s === 'buyer' ||
    s.includes('buyer') ||
    s.includes('ingestion') ||
    s.includes('purchase_dump') ||
    !!v.addedByBuyerCompany ||
    !!v.buyerId ||
    !!v.buyerAccountId
  );
};

// Classification helper: a Procucev supplier, meaning one the buyer did not upload.
export const isProcucevVendor = (
  v: Partial<Pick<VendorEntry, 'source' | 'buyerId' | 'buyerAccountId' | 'addedByBuyerCompany'>> | null | undefined
): boolean => {
  return !isBuyerUploaded(v);
};

/** A finite number from a number or a numeric string. Anything else counts as not on record. */
function toScore(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed text, or null when the value is missing or blank. */
function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function findEvaluation(records: VendorEvaluationRecord[] | undefined, vendorId: string): VendorEvaluationRecord | null {
  return (
    (records || []).find(
      (e) => e.vendorId === vendorId || (e.vendorName || '').toLowerCase() === vendorId.toLowerCase()
    ) ?? null
  );
}

function buildSelectOption(vendor: VendorEntry, overallScore: number | null): VendorEvaluationSelectOption {
  return {
    id: vendor.id,
    name: toText(vendor.name),
    category: toText(vendor.majorCategory),
    contactPerson: toText(vendor.contactPerson),
    email: toText(vendor.email),
    phone: toText(vendor.phone),
    isBuyerUploaded: isBuyerUploaded(vendor),
    overallScore,
  };
}

function buildOptionFromRecord(record: VendorEvaluationRecord): VendorEvaluationSelectOption {
  return {
    id: record.vendorId,
    name: toText(record.vendorName),
    category: toText(record.category),
    contactPerson: toText(record.contactPerson),
    email: toText(record.email),
    phone: toText(record.phone),
    isBuyerUploaded: false,
    overallScore: toScore(record.overallScore),
  };
}

function buildPillarView(
  record: VendorEvaluationRecord | null,
  pillar: (typeof VENDOR_EVALUATION_PILLARS)[number]
): VendorEvaluationPillarView {
  const moduleScore = record?.moduleScores?.[pillar.moduleKey];
  return {
    pillarId: pillar.id,
    name: pillar.name,
    weight: pillar.weight,
    weightedScore: toScore(moduleScore?.weightedScore),
    remarks: toText(moduleScore?.remarks),
  };
}

/**
 * The supplier evaluation the summary shows. Scores and remarks come only from the evaluation record. Identity and
 * contact fields fall back to the supplier's own record. A null field means nothing is on record for it.
 */
function buildSummaryView(
  record: VendorEvaluationRecord | null,
  option: VendorEvaluationSelectOption | null
): VendorEvaluationSummaryView {
  const questions = record?.questionBreakdown;
  const documents = record?.documents;
  return {
    isBuyerUploaded: option?.isBuyerUploaded ?? false,
    vendorId: toText(record?.vendorId) ?? option?.id ?? null,
    vendorName: toText(record?.vendorName) ?? option?.name ?? null,
    contactPerson: toText(record?.contactPerson) ?? option?.contactPerson ?? null,
    email: toText(record?.email) ?? option?.email ?? null,
    phone: toText(record?.phone) ?? option?.phone ?? null,
    category: toText(record?.category) ?? option?.category ?? null,
    submissionDate: toText(record?.submissionDate),
    status: record?.status ?? null,
    overallScore: toScore(record?.overallScore),
    systemAction: toText(record?.systemAction),
    pillars: VENDOR_EVALUATION_PILLARS.map((pillar) => buildPillarView(record, pillar)),
    questions: Array.isArray(questions) ? questions : [],
    documents: Array.isArray(documents) ? documents : [],
  };
}

/** Attachment line under a pillar's bar, computed from the criteria the record holds for that pillar. */
function attachmentSummaryFor(questions: QuestionEvaluationItem[], pillarId: VendorEvaluationPillarId) {
  const pillarQuestions = questions.filter((q) => q.pillarId === pillarId);
  const total = pillarQuestions.length;
  if (total === 0) {
    return {
      label: SUMMARY.noCriteriaOnRecord,
      statusLabel: NOT_EVALUATED,
      statusClass: 'text-slate-500 dark:text-gray-400 font-medium',
    };
  }
  const uploaded = pillarQuestions.filter((q) => Boolean(q.attachmentName)).length;
  const verified = pillarQuestions.filter((q) => Boolean(q.attachmentVerified)).length;
  const label = formatString(SUMMARY.attachmentsUploaded, { uploaded, total });
  if (uploaded === 0) {
    return {
      label,
      statusLabel: SUMMARY.noAttachmentOnRecord,
      statusClass: 'text-amber-600 dark:text-amber-400 font-semibold',
    };
  }
  if (verified === total) {
    return {
      label,
      statusLabel: SUMMARY.attachmentsAllVerified,
      statusClass: 'text-emerald-700 dark:text-emerald-400 font-bold',
    };
  }
  return {
    label,
    statusLabel: formatString(SUMMARY.attachmentsVerified, { verified, uploaded }),
    statusClass: 'text-indigo-600 dark:text-indigo-400 font-medium',
  };
}

function renderStatusBadge(status: VendorEvaluationSummaryView['status']) {
  if (status === null) {
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
        {NOT_EVALUATED}
      </span>
    );
  }
  if (status === 'PREFERRED ENTERPRISE SUPPLIER') {
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40">
        {status}
      </span>
    );
  }
  if (status === 'CONDITIONAL / UNDER REVIEW') {
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
        {status}
      </span>
    );
  }
  if (status === 'DISQUALIFIED SUPPLIER') {
    return (
      <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-500/40">
        {status}
      </span>
    );
  }
  // A status the record holds that this screen has no colour for is shown as written.
  return (
    <span className="px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
      {status}
    </span>
  );
}

export default function VendorEvaluationSummary({
  evaluationRecord,
  vendorEvaluation,
  onBack,
}: VendorEvaluationSummaryProps) {
  const { buyerVendors, vendorEvaluations, setActiveEvaluationRecord, showToast, dbConnected, isLoadingDB, refreshFromDB } = useApp();

  // The reference load that carries the suppliers and their evaluations has finished and failed. An empty list then
  // does not mean nothing is on record, so the screen says the load failed.
  const loadFailed = isLoadingDB === false && dbConnected === false;

  const activeRecord = evaluationRecord || vendorEvaluation;

  // Every supplier the picker knows about. The overall score is the score on its evaluation record, or null when it has none.
  const allOptions = useMemo<VendorEvaluationSelectOption[]>(() => {
    const evaluationById = new Map<string, VendorEvaluationRecord>();
    if (evaluationRecord?.vendorId) evaluationById.set(evaluationRecord.vendorId, evaluationRecord);
    (vendorEvaluations || []).forEach((e) => {
      if (e.vendorId && !evaluationById.has(e.vendorId)) evaluationById.set(e.vendorId, e);
    });

    const optionById = new Map<string, VendorEvaluationSelectOption>();
    (buyerVendors || []).forEach((v) => {
      if (!v.id) return;
      optionById.set(v.id, buildSelectOption(v, toScore(evaluationById.get(v.id)?.overallScore)));
    });
    evaluationById.forEach((e, id) => {
      if (!optionById.has(id)) optionById.set(id, buildOptionFromRecord(e));
    });
    return Array.from(optionById.values());
  }, [buyerVendors, vendorEvaluations, evaluationRecord]);

  // Buyer-uploaded suppliers when there are any. Otherwise every supplier.
  const companyOptions = useMemo(() => {
    const buyerUploaded = allOptions.filter(
      (c) => c.isBuyerUploaded || (evaluationRecord ? c.id === evaluationRecord.vendorId : false)
    );
    return buyerUploaded.length > 0 ? buyerUploaded : allOptions;
  }, [allOptions, evaluationRecord]);

  const initialVendorId =
    activeRecord?.vendorId ||
    companyOptions[0]?.id ||
    buyerVendors?.[0]?.id ||
    vendorEvaluations?.[0]?.vendorId ||
    '';
  const [selectedVendorId, setSelectedVendorId] = useState<string>(initialVendorId);
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPillarFilter, setSelectedPillarFilter] = useState<'ALL' | VendorEvaluationPillarId>('ALL');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update selectedVendorId if evaluationRecord prop changes
  useEffect(() => {
    if (evaluationRecord?.vendorId) {
      setSelectedVendorId(evaluationRecord.vendorId);
    }
  }, [evaluationRecord]);

  // Synchronize selectedVendorId when navigating directly without evaluationRecord
  useEffect(() => {
    if (!evaluationRecord && companyOptions.length > 0) {
      if (!selectedVendorId || !companyOptions.some((c) => c.id === selectedVendorId)) {
        setSelectedVendorId(companyOptions[0].id);
      }
    }
  }, [evaluationRecord, companyOptions, selectedVendorId]);

  // Resolve the supplier shown on screen
  const summary: VendorEvaluationSummaryView | null = useMemo(() => {
    // 1. The record passed in, when it matches the selected supplier or nothing is selected.
    if (evaluationRecord && (!selectedVendorId || evaluationRecord.vendorId === selectedVendorId)) {
      return buildSummaryView(
        evaluationRecord,
        allOptions.find((c) => c.id === evaluationRecord.vendorId) ?? null
      );
    }

    if (selectedVendorId) {
      const option = allOptions.find((c) => c.id === selectedVendorId) ?? null;
      // 2. The stored evaluation for the selected supplier.
      const stored = findEvaluation(vendorEvaluations, selectedVendorId);
      if (stored) return buildSummaryView(stored, option);
      // 3. A supplier with no evaluation yet. Its own details show, and every score is not evaluated.
      if (option) return buildSummaryView(null, option);
    }

    // 4. The record passed in, when the selection matches nothing.
    if (evaluationRecord) return buildSummaryView(evaluationRecord, null);

    // 5. The first supplier in the picker.
    const first = companyOptions[0];
    if (first) return buildSummaryView(findEvaluation(vendorEvaluations, first.id), first);

    // 6. The first stored evaluation, when no supplier is listed.
    const storedFirst = vendorEvaluations?.[0];
    return storedFirst ? buildSummaryView(storedFirst, null) : null;
  }, [evaluationRecord, selectedVendorId, vendorEvaluations, allOptions, companyOptions]);

  const filteredCompanyOptions = useMemo(() => {
    if (!searchQuery.trim()) return companyOptions;
    const q = searchQuery.toLowerCase();
    return companyOptions.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.category || '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [companyOptions, searchQuery]);

  const handleSelectCompany = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setDropdownOpen(false);
    setSearchQuery('');
    const option = allOptions.find((c) => c.id === vendorId);
    if (!option) return;
    if (setActiveEvaluationRecord) {
      setActiveEvaluationRecord(findEvaluation(vendorEvaluations, vendorId));
    }
    showToast(
      SUMMARY.companySelectedTitle,
      formatString(SUMMARY.companySelectedMessage, { name: option.name ?? NOT_RECORDED }),
      'info'
    );
  };

  if (!summary) {
    return (
      <div className="space-y-4 animate-fade-in p-8 text-center glass-panel rounded-2xl border border-slate-200 dark:border-slate-800 max-w-xl mx-auto my-12">
        <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center">
          <Building2 size={24} />
        </div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
          {loadFailed ? SUMMARY.loadFailedTitle : SUMMARY.noEvaluationTitle}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {loadFailed ? SUMMARY.loadFailedBody : SUMMARY.noEvaluationBody}
        </p>
        {loadFailed && (
          <div className="pt-1">
            <button type="button" onClick={() => void refreshFromDB()} className="btn btn-primary btn-sm">
              {SUMMARY.retryAction}
            </button>
          </div>
        )}
        {onBack && (
          <div className="pt-2">
            <button onClick={onBack} className="btn btn-secondary btn-sm">
              <ArrowLeft size={14} /> {SUMMARY.backAction}
            </button>
          </div>
        )}
      </div>
    );
  }

  const questions = summary.questions;
  const filteredQuestions = selectedPillarFilter === 'ALL'
    ? questions
    : questions.filter((q) => q.pillarId === selectedPillarFilter);
  const visiblePillars = selectedPillarFilter === 'ALL'
    ? summary.pillars
    : summary.pillars.filter((p) => p.pillarId === selectedPillarFilter);
  const pillarFilterOptions: Array<'ALL' | VendorEvaluationPillarId> = ['ALL', ...VENDOR_EVALUATION_PILLARS.map((p) => p.id)];

  const documents = summary.documents;
  const verifiedDocumentCount = documents.filter((d) => d.verified || d.status === 'Verified').length;
  const visibleDocuments = documents.slice(0, VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT);
  const overallScore = summary.overallScore;
  const gateText = overallScore === null
    ? NOT_EVALUATED
    : overallScore >= VENDOR_EVALUATION_GATE_SCORE
    ? formatString(SUMMARY.gateUnlocked, { score: VENDOR_EVALUATION_GATE_SCORE })
    : formatString(SUMMARY.gateLocked, { score: VENDOR_EVALUATION_GATE_SCORE });

  return (
    <div className="space-y-2.5 animate-fade-in pb-4">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="btn btn-secondary btn-sm">
              <ArrowLeft size={14} /> {SUMMARY.backAction}
            </button>
          )}
        </div>
      </div>

      {loadFailed && (
        <div role="alert" className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
          {SUMMARY.loadFailedStale}
        </div>
      )}

      {/* Interactive Company / Supplier Selection Dropdown Bar */}
      <div className="glass-panel p-2.5 sm:p-3 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50/70 via-white to-sky-50/70 dark:from-indigo-950/30 dark:via-gray-900/90 dark:to-sky-950/30 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-2.5 relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Building2 size={15} />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-400 tracking-wider">
              {SUMMARY.pickerLabel}
            </div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {SUMMARY.pickerHelp}
            </div>
          </div>
        </div>

        {/* Company Select Dropdown */}
        <div className="relative z-40" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-label={SUMMARY.pickerAriaLabel}
            className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg bg-white dark:bg-gray-800 border border-slate-300 dark:border-slate-700 hover:border-indigo-500 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-sm min-w-[280px] sm:min-w-[360px] transition-all cursor-pointer text-left"
          >
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <div className="truncate">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="font-black text-slate-900 dark:text-white truncate">
                    {summary.vendorName ?? NOT_RECORDED}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider flex items-center gap-1 shrink-0 ${
                      summary.isBuyerUploaded
                        ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    }`}
                  >
                    {summary.isBuyerUploaded ? <UploadCloud size={9} /> : <ShieldCheck size={9} />}
                    {summary.isBuyerUploaded ? SUMMARY.tagBuyerUploaded : SUMMARY.tagProcucevVendor}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal truncate block mt-0.5">
                  {summary.vendorId ?? NOT_RECORDED} • {summary.category ?? NOT_RECORDED}
                </span>
              </div>
            </div>
            <ChevronDown size={15} className={`text-slate-400 transition-transform shrink-0 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu Popover */}
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-84 sm:w-96 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden animate-fade-in">
              {/* Header */}
              <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-gray-950 flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                  <UploadCloud size={13} className="text-indigo-600" />
                  <span>{SUMMARY.pickerHeading}</span>
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
                  {companyOptions.length}
                </span>
              </div>

              {/* Search Bar */}
              <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-gray-950/60">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder={SUMMARY.searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-gray-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 px-1">
                  <span>
                    {formatString(
                      filteredCompanyOptions.length === 1 ? SUMMARY.foundOne : SUMMARY.foundMany,
                      { count: filteredCompanyOptions.length }
                    )}
                  </span>
                  <span>{SUMMARY.clickToInspect}</span>
                </div>
              </div>

              {/* Options List */}
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCompanyOptions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    {searchQuery.trim()
                      ? formatString(SUMMARY.noSearchMatch, { query: searchQuery })
                      : SUMMARY.noSuppliers}
                  </div>
                ) : (
                  filteredCompanyOptions.map((c) => {
                    const isSelected = c.id === summary.vendorId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCompany(c.id)}
                        className={`w-full text-left p-2.5 flex items-center justify-between gap-2 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 transition-colors ${
                          isSelected ? 'bg-indigo-50 dark:bg-indigo-950/60 font-bold' : ''
                        }`}
                      >
                        <div className="truncate">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {c.name ?? NOT_RECORDED}
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-medium flex items-center gap-1 ${
                                c.isBuyerUploaded
                                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              }`}
                            >
                              {c.isBuyerUploaded ? <UploadCloud size={9} /> : <ShieldCheck size={9} />}
                              {c.isBuyerUploaded ? SUMMARY.optionTagBuyer : SUMMARY.optionTagProcucev}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{c.id}</span> • {c.category ?? NOT_RECORDED}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-xs font-mono font-bold ${
                              c.overallScore === null
                                ? 'text-slate-500 dark:text-slate-400'
                                : c.overallScore >= VENDOR_EVALUATION_GATE_SCORE
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {c.overallScore === null ? NOT_EVALUATED : `${c.overallScore}%`}
                          </span>
                          {isSelected && <Check size={14} className="text-indigo-600 dark:text-indigo-400" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Vendor Executive Header Card */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md relative z-10 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          {/* Vendor Info */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                {summary.vendorId ?? NOT_RECORDED}
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-600 dark:text-gray-400 font-medium flex items-center gap-1">
                <Tag size={12} /> {summary.category ?? NOT_RECORDED}
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <CompanyHoverTooltip
                name={summary.vendorName ?? ''}
                type="vendor"
                contact={{
                  contactPerson: summary.contactPerson ?? undefined,
                  mobile: summary.phone ?? undefined,
                  email: summary.email ?? undefined,
                  verified: summary.status === 'PREFERRED ENTERPRISE SUPPLIER',
                }}
              />
              <ShieldCheck className="text-emerald-500" size={22} />
            </h2>

            <div className="flex items-center gap-3 sm:gap-4 text-xs text-slate-500 dark:text-gray-400 flex-wrap">
              <span className="flex items-center gap-1">
                <Building2 size={13} /> {SUMMARY.contactLabel}{' '}
                <strong className="text-slate-700 dark:text-gray-200">{summary.contactPerson ?? NOT_RECORDED}</strong>
              </span>
              <span className="flex items-center gap-1"><Mail size={13} /> {summary.email ?? NOT_RECORDED}</span>
              <span className="flex items-center gap-1"><Phone size={13} /> {summary.phone ?? NOT_RECORDED}</span>
              <span className="flex items-center gap-1">
                <Clock size={13} /> {SUMMARY.submittedLabel} {summary.submissionDate ?? NOT_RECORDED}
              </span>
            </div>
          </div>

          {/* Computed Rating Gauge */}
          <div className="flex items-center gap-4 p-3 sm:p-3.5 rounded-xl bg-slate-900 text-white shadow-lg shrink-0 border border-slate-800">
            <div className="text-center">
              <div className="text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                {SUMMARY.scoreLabel}
              </div>
              <div className="text-3xl sm:text-4xl font-black mono text-emerald-400 mt-0.5">
                {overallScore === null ? NOT_EVALUATED : `${overallScore}%`}
              </div>
            </div>

            <div className="space-y-1 border-l border-slate-800 pl-3.5">
              {renderStatusBadge(summary.status)}
              <div className="text-[10px] text-indigo-300">
                {SUMMARY.gateLabel} <span className="font-bold text-emerald-400">{gateText}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Automated System Execution Action Banner */}
        <div className="mt-3.5 p-2.5 sm:p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
            <Zap size={14} className="text-emerald-600 dark:text-emerald-400 animate-pulse" />
            <span>{SUMMARY.executionLabel}</span>
            <span className="font-normal text-emerald-900 dark:text-emerald-200">{summary.systemAction ?? NOT_RECORDED}</span>
          </div>
          {documents.length === 0 ? (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 flex items-center gap-1 font-mono">
              <Clock size={11} /> {SUMMARY.documentsEmptyTitle}
            </span>
          ) : (
            <span className="badge badge-emerald font-mono">
              {formatString(SUMMARY.attachmentsSummaryTotal, { verified: verifiedDocumentCount, total: documents.length })}
            </span>
          )}
        </div>
      </div>

      {/* 6 Subtotal Pillar Summary Cards */}
      <div>
        <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 mb-2.5 flex items-center gap-2">
          <Sparkles size={15} className="text-indigo-600 dark:text-indigo-400" />
          {SUMMARY.pillarsHeading}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
          {VENDOR_EVALUATION_PILLARS.map((pillar) => {
            const viewPillar = summary.pillars.find((p) => p.pillarId === pillar.id);
            const weightedScore = viewPillar?.weightedScore ?? null;
            const remarks = viewPillar?.remarks ?? null;
            const attachment = attachmentSummaryFor(questions, pillar.id);
            const barPercent = weightedScore === null ? 0 : Math.min(100, (weightedScore / pillar.weight) * 100);
            return (
              <div
                key={pillar.id}
                className="glass-panel p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-md font-bold text-xs flex items-center justify-center ${pillar.accent.badge}`}>
                        {pillar.id}
                      </span>
                      <span className="font-bold text-xs text-slate-800 dark:text-gray-200">{pillar.name}</span>
                    </div>
                    <span
                      className={`text-xs font-mono font-bold ${
                        weightedScore === null ? 'text-slate-500 dark:text-gray-400' : pillar.accent.score
                      }`}
                    >
                      {weightedScore === null
                        ? NOT_EVALUATED
                        : formatString(SUMMARY.pillarPoints, { score: weightedScore, weight: pillar.weight })}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div className={`${pillar.accent.bar} h-full rounded-full`} style={{ width: `${barPercent}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center justify-between">
                    <span>{attachment.label}</span>
                    <span className={attachment.statusClass}>{attachment.statusLabel}</span>
                  </div>
                </div>
                <div className={`p-2 rounded-lg text-[10px] ${pillar.accent.remarksBox}`}>
                  <div className={`font-bold mb-0.5 ${pillar.accent.remarksTitle}`}>
                    💬 {formatString(SUMMARY.pillarRemarksTitle, { pillarId: pillar.id })}
                  </div>
                  {remarks ?? NOT_RECORDED}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evaluation Matrix */}
      <div className="glass-panel p-3 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-100 dark:border-gray-800">
          <div>
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
              <FileText size={15} className="text-indigo-600 dark:text-indigo-400" />
              {SUMMARY.matrixTitle}
              {questions.length > 0 && formatString(SUMMARY.matrixCount, { count: questions.length })}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-gray-400">
              {questions.length > 0 ? SUMMARY.matrixSubtitle : SUMMARY.matrixNoScores}
            </p>
          </div>

          {/* Pillar Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            {pillarFilterOptions.map((p) => (
              <button
                key={p}
                onClick={() => setSelectedPillarFilter(p)}
                className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                  selectedPillarFilter === p
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'
                }`}
              >
                {p === 'ALL' ? SUMMARY.filterAll : p}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px] bg-slate-50/50 dark:bg-gray-950/50">
                <th className="py-2 px-2.5">{SUMMARY.colRef}</th>
                <th className="py-2 px-2.5">{SUMMARY.colCriteria}</th>
                <th className="py-2 px-2.5">{SUMMARY.colAttachment}</th>
                <th className="py-2 px-2.5 text-center">{SUMMARY.colScore}</th>
                <th className="py-2 px-2.5 text-right">{SUMMARY.colWeighted}</th>
                <th className="py-2 px-2.5">{SUMMARY.colRemarks}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800/80">
              {questions.length > 0
                ? filteredQuestions.map((q, idx) => {
                    const score = toScore(q.score);
                    const weighted = toScore(q.weightedScore);
                    const remarks = toText(q.remarks);
                    return (
                      <tr key={q.refId ? `${q.refId}-${idx}` : `q-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="py-2 px-2.5">
                          <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {toText(q.refId) ?? NOT_RECORDED}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-gray-200 max-w-xs">
                          {toText(q.criteria) ?? NOT_RECORDED}
                        </td>
                        <td className="py-2 px-2.5">
                          {q.attachmentName ? (
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                              <Paperclip size={12} className="shrink-0" />
                              <span className="truncate max-w-[160px]" title={q.attachmentName}>{q.attachmentName}</span>
                              {q.attachmentVerified ? (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                  {SUMMARY.attachmentVerifiedBadge}
                                </span>
                              ) : (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                                  {SUMMARY.attachmentPendingReview}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                              <Clock size={11} className="shrink-0" />
                              <span>{SUMMARY.noAttachmentOnRecord}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2.5 text-center font-bold text-slate-800 dark:text-gray-200 mono">
                          {score === null ? NOT_EVALUATED : formatString(SUMMARY.scoreOutOfFive, { score: score.toFixed(1) })}
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold text-indigo-600 dark:text-indigo-400 mono">
                          {weighted === null ? NOT_EVALUATED : formatString(SUMMARY.weightedPercent, { value: weighted.toFixed(2) })}
                        </td>
                        <td className="py-2 px-2.5 text-[11px] text-slate-600 dark:text-gray-300 italic max-w-md">
                          {remarks === null ? NOT_RECORDED : <>&quot;{remarks}&quot;</>}
                        </td>
                      </tr>
                    );
                  })
                : visiblePillars.map((pillar) => (
                    <tr key={pillar.pillarId} className="hover:bg-slate-50/80 dark:hover:bg-gray-800/40 transition-colors">
                      <td className="py-2 px-2.5">
                        <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {pillar.pillarId}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 font-semibold text-slate-800 dark:text-gray-200 max-w-xs">
                        {formatString(SUMMARY.pillarCriteriaName, { name: pillar.name, weight: pillar.weight })}
                      </td>
                      <td className="py-2 px-2.5 text-[10px] text-slate-500 dark:text-gray-400">{NOT_RECORDED}</td>
                      <td className="py-2 px-2.5 text-center text-slate-500 dark:text-gray-400 mono">{NOT_EVALUATED}</td>
                      <td className="py-2 px-2.5 text-right text-slate-500 dark:text-gray-400 mono">{NOT_EVALUATED}</td>
                      <td className="py-2 px-2.5 text-[11px] text-slate-600 dark:text-gray-300 italic max-w-md">
                        {pillar.remarks === null ? NOT_RECORDED : <>&quot;{pillar.remarks}&quot;</>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mandatory Attachments Overview Card */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-gray-200 flex items-center gap-2">
            <Paperclip size={15} className="text-indigo-600 dark:text-indigo-400" />
            {formatString(SUMMARY.documentsHeading, { count: documents.length })}
          </h3>
          {documents.length === 0 ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
              {SUMMARY.documentsEmptyTitle}
            </span>
          ) : (
            <span className="badge badge-emerald">
              {formatString(SUMMARY.documentsBadgeVerified, { verified: verifiedDocumentCount, total: documents.length })}
            </span>
          )}
        </div>

        {documents.length === 0 ? (
          <div className="py-6 px-4 rounded-lg border border-dashed border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 text-center">
            <Clock size={28} className="mx-auto mb-2 text-amber-600 dark:text-amber-400 opacity-80" />
            <h4 className="text-xs font-bold text-slate-800 dark:text-gray-200 mb-1">
              {SUMMARY.documentsEmptyTitle}
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-gray-400 max-w-md mx-auto">
              {SUMMARY.documentsEmptyBody}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 dark:text-gray-500 uppercase tracking-wider text-[10px]">
                  <th className="py-2 px-2">{SUMMARY.docColTitle}</th>
                  <th className="py-2 px-2">{SUMMARY.docColType}</th>
                  <th className="py-2 px-2">{SUMMARY.docColUploaded}</th>
                  <th className="py-2 px-2">{SUMMARY.docColStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
                {visibleDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/40">
                    <td className="py-2 px-2 font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                      <FileText size={14} className="text-indigo-500 shrink-0" />
                      <span>{toText(doc.name) ?? NOT_RECORDED}</span>
                    </td>
                    <td className="py-2 px-2 text-slate-600 dark:text-gray-400">{toText(doc.type) ?? NOT_RECORDED}</td>
                    <td className="py-2 px-2 text-slate-400 dark:text-gray-500 mono">{toText(doc.uploadDate) ?? NOT_RECORDED}</td>
                    <td className="py-2 px-2">
                      {doc.status === 'Verified' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                          {SUMMARY.docStatusVerified}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                          {toText(doc.status) ?? NOT_RECORDED}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {documents.length > VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT && (
              <div className="text-center py-2 text-xs text-indigo-600 font-bold">
                {formatString(SUMMARY.docMoreCount, { count: documents.length - VENDOR_EVALUATION_DOCUMENT_LIST_LIMIT })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
