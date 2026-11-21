'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RFQItem, QuoteComparison, RFQAssignedVendor } from '@/lib/types';
import ColumnSettingsPopup from '@/app/category-manager/components/ColumnSettingsPopup';
import {
  CM_ALL_RFQS_TABLE_COLUMNS,
  createBooleanSetterHandler,
  createColumnResetHandler,
  createColumnSortClickHandler,
  formatCurrency,
  formatIndianDateTime,
  getSortIndicatorSymbol,
  getTableAriaSort,
  getTableColumnClass,
  sortTableRows,
  type TableColumnOption,
  type TableSortState,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchAllRFQs } from '@/lib/rfqClient';
import { exportReportToCsv } from '@/lib/reportsClient';
import {
  Search,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  FileText,
  UserPlus,
  X,
  Building2,
  Store,
  Download,
  Settings,
  Calendar,
} from 'lucide-react';
import InviteVendorsModal from './InviteVendorsModal';
import BuyerDetailsModal from './BuyerDetailsModal';
import VendorDetailsModal from './VendorDetailsModal';

interface AllRFQsConsoleProps {
  /** Open the comparative quote matrix for one RFQ. */
  onNavigateToMatrix?: (rfq: RFQItem) => void;
  /** Open the full read-only detail view for one RFQ. */
  onViewDetails?: (rfq: RFQItem) => void;
}

const S = UI_STRINGS.allRfqs;
const PAGE_SIZE = 100;
// Shown wherever a value is not recorded on the RFQ or quote.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

/** Every real RFQ status → badge tone. Covers all members of the union. */
const STATUS_TONE: Record<RFQItem['status'], string> = {
  Parsing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'Quotes Pending': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  'Quotes Received': 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
  'In Evaluation': 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  'AI Recommended': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  'PO Generated': 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
  Closed: 'bg-slate-200 text-slate-800 dark:bg-gray-800 dark:text-slate-300',
  Expired: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

const ALL_STATUSES: RFQItem['status'][] = [
  'Parsing',
  'Quotes Pending',
  'Quotes Received',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
  'Closed',
  'Expired',
];

/**
 * The most recent vendor-quotation submission timestamp on an RFQ, or `null`
 * when no vendor has quoted yet. Each quote stamps `submittedAt` at submission
 * (both the portal and email-ingestion paths do — see rfqController and
 * emailGatewayService), so the latest is simply the max across the quotes.
 */
function latestQuoteSubmittedAt(rfq: RFQItem): string | null {
  const times = (rfq.quotes || [])
    .map((q) => q.submittedAt)
    .filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  if (times.length === 0) return null;
  return times.reduce((latest, t) => (Date.parse(t) > Date.parse(latest) ? t : latest));
}

/**
 * Name and id of an invited vendor, read from whichever field the API set.
 * A value that is not present stays null, so the caller can show a dash.
 */
function invitedVendorIdentity(vendor: RFQAssignedVendor): { name: string | null; id: string | null } {
  const raw: unknown = vendor;
  if (typeof raw === 'string') {
    return { name: raw.trim() || null, id: null };
  }
  const record = (raw || {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };
  return { name: pick('name', 'vendorName', 'companyName'), id: pick('id', 'vendorId') };
}

/** Check if RFQ has any category signal in header or line items */
function rfqHasCategorySignal(rfq: RFQItem): boolean {
  if (rfq.category && rfq.category.trim()) return true;
  for (const ent of Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : []) {
    if (
      (ent.majorCategory && ent.majorCategory.trim()) ||
      (ent.minorCategory && ent.minorCategory.trim()) ||
      (ent.category && ent.category.trim())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Category-manager "All RFQs" console.
 *
 * Reads `GET /api/rfqs/all` — the full cross-buyer list, which the server
 * gates to the category_manager/admin roles.
 */
export default function AllRFQsConsole({ onNavigateToMatrix, onViewDetails }: AllRFQsConsoleProps) {
  const [rfqs, setRfqs] = useState<RFQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [buyerFilter, setBuyerFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [inviteTargetRfq, setInviteTargetRfq] = useState<RFQItem | null>(null);
  const [allRfqsSort, setAllRfqsSort] = useState<TableSortState>({ key: null, dir: 'asc' });
  const [allRfqsColumns, setAllRfqsColumns] = useState<TableColumnOption[]>(() =>
    CM_ALL_RFQS_TABLE_COLUMNS.map((col) => ({ ...col }))
  );
  const [showAllRfqsColumnSettings, setShowAllRfqsColumnSettings] = useState(false);

  const [selectedBuyerInfo, setSelectedBuyerInfo] = useState<{
    name: string | null;
    id?: string | null;
    rfq: RFQItem;
  } | null>(null);

  const [selectedVendorInfo, setSelectedVendorInfo] = useState<{
    name: string;
    id?: string | null;
    quote?: QuoteComparison | null;
    assignedVendor?: RFQAssignedVendor | null;
    rfq: RFQItem;
  } | null>(null);

  const [vendorListModalData, setVendorListModalData] = useState<{
    rfq: RFQItem;
    mode: 'quotes' | 'assigned';
  } | null>(null);

  const [hoveredInvitedRfq, setHoveredInvitedRfq] = useState<{
    rfq: RFQItem;
    rect: { top: number; left: number };
  } | null>(null);

  const startDateInputRef = useRef<HTMLInputElement>(null);
  const endDateInputRef = useRef<HTMLInputElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const handleCellMouseEnter = (rfq: RFQItem, target: HTMLElement) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = target.getBoundingClientRect();
    setHoveredInvitedRfq({ rfq, rect: { top: rect.bottom + 4, left: Math.max(8, rect.left) } });
  };

  const handleCellMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredInvitedRfq(null);
    }, 200);
  };

  const handlePopoverMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  };

  const handlePopoverMouseLeave = () => {
    setHoveredInvitedRfq(null);
  };

  const openStartDatePicker = () => {
    if (typeof startDateInputRef.current?.showPicker === 'function') {
      try {
        startDateInputRef.current.showPicker();
        return;
      } catch {
        // Fall back to focus if showPicker fails
      }
    }
    startDateInputRef.current?.focus();
  };

  const openEndDatePicker = () => {
    if (typeof endDateInputRef.current?.showPicker === 'function') {
      try {
        endDateInputRef.current.showPicker();
        return;
      } catch {
        // Fall back to focus if showPicker fails
      }
    }
    endDateInputRef.current?.focus();
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAllRFQs({ summary: true, limit: 100 });
    if (result.success) {
      setRfqs(result.rfqs);
    } else {
      setError(result.error || S.loadFailed);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  // Escape key support to close vendor list modal
  useEffect(() => {
    if (!vendorListModalData) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVendorListModalData(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vendorListModalData]);

  const buyerNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rfqs) {
      if (r.buyerAccountName) names.add(r.buyerAccountName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rfqs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return rfqs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (buyerFilter !== 'all' && (r.buyerAccountName || '') !== buyerFilter) return false;

      if (startMs || endMs) {
        const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (!createdMs) return false;
        if (startMs && createdMs < startMs) return false;
        if (endMs && createdMs > endMs) return false;
      }

      if (!q) return true;
      return (
        r.rfqNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.buyerAccountName || '').toLowerCase().includes(q) ||
        (r.quotes || []).some((qt) => qt.vendorName?.toLowerCase().includes(q)) ||
        (r.assignedVendors || []).some((av) => (av.name || '').toLowerCase().includes(q))
      );
    });
  }, [rfqs, search, statusFilter, buyerFilter, startDate, endDate]);

  const hasFilters =
    search.trim().length > 0 ||
    statusFilter !== 'all' ||
    buyerFilter !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setBuyerFilter('all');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  // Reset to Page 1 whenever search, status, buyer or date filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, buyerFilter, startDate, endDate]);

  const sortedRfqs = useMemo(() => {
    return sortTableRows(filtered, allRfqsSort);
  }, [filtered, allRfqsSort]);

  const totalPages = Math.max(1, Math.ceil(sortedRfqs.length / PAGE_SIZE));

  const paginatedRfqs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedRfqs.slice(start, start + PAGE_SIZE);
  }, [sortedRfqs, currentPage]);

  const handlePageChange = (newPage: number) => {
    const targetPage = Math.max(1, Math.min(totalPages, newPage));
    setCurrentPage(targetPage);
    if (typeof tableContainerRef.current?.scrollTo === 'function') {
      tableContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const handleExportCsv = () => {
    const rows = filtered.map((rfq) => {
      const invitedVendorNames = (rfq.assignedVendors || [])
        .map((av) => invitedVendorIdentity(av).name)
        .filter(Boolean)
        .join('; ');

      const quotedVendorNames = (rfq.quotes || [])
        .map((q) => q.vendorName)
        .filter(Boolean)
        .join('; ');

      const latestQuote = latestQuoteSubmittedAt(rfq);

      return {
        [S.colRfqNumber]: rfq.rfqNumber,
        [S.colTitle]: rfq.title,
        [S.colCategory]: rfq.category || EMPTY_VALUE,
        [S.colBuyer]: rfq.buyerAccountName || S.buyerUnknown,
        [S.colStatus]: rfq.status,
        [S.colQuotes]: rfq.quotes?.length || rfq.quotesCount || 0,
        [S.colInvitedVendors]: invitedVendorNames || S.colInvitedVendorsNone,
        [S.colVendors]: quotedVendorNames || S.colVendorsNone,
        [S.colBudget]: rfq.budget > 0 ? formatCurrency(rfq.budget) : S.budgetUnset,
        [S.colCreated]: rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : EMPTY_VALUE,
        [S.colLatestQuote]: latestQuote ? formatIndianDateTime(latestQuote) : S.latestQuoteNone,
        [S.colDeliveryLocation]: rfq.deliveryLocation || EMPTY_VALUE,
        [S.colRequiredBy]: rfq.targetDeliveryDate || EMPTY_VALUE,
        [S.colQuoteDeadline]: rfq.deadline || EMPTY_VALUE,
        [S.colSourcingMode]: rfq.sourcingMode || EMPTY_VALUE,
      };
    });

    const dateSuffix = startDate || endDate
      ? `_${startDate || 'all'}_to_${endDate || 'all'}`
      : `_${new Date().toISOString().split('T')[0]}`;
    const fileName = `${S.downloadFilename}${dateSuffix}`;

    exportReportToCsv(rows, fileName);
  };

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-3 p-3 sm:p-4">
      {/* Hidden live regions for screen reader a11y */}
      {!loading && !error && (
        <>
          <p className="sr-only" data-testid="all-rfqs-count">
            {formatString(S.countSummary, { count: rfqs.length, buyers: buyerNames.length })}
          </p>
          <p className="sr-only" aria-live="polite">
            {formatString(S.resultCount, { shown: filtered.length, total: rfqs.length })}
          </p>
          {hasFilters && <span className="sr-only">{S.filtersApplied}</span>}
        </>
      )}

      {/* Single-Line Compact Spreadsheet Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-gray-950">
        <div className="flex items-center gap-2 flex-nowrap w-full overflow-x-auto whitespace-nowrap">
          {/* 1. Search bar (Wide — takes the remaining space) */}
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              id="all-rfqs-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={S.searchLabel}
              placeholder={S.searchPlaceholder}
              className={`h-9 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-8 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200 ${search ? 'pr-8' : ''}`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={S.clearSearch}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 2. All Statuses dropdown (Small/Compact) */}
          <select
            id="all-rfqs-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={S.statusFilterLabel}
            className="h-9 w-36 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-800 dark:bg-gray-950 dark:text-gray-200 cursor-pointer"
          >
            <option value="all">{S.allStatuses}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* 3. Start Date: Compact date button/control */}
          <div
            role="button"
            tabIndex={0}
            onClick={openStartDatePicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openStartDatePicker();
              }
            }}
            className="relative flex items-center justify-between h-9 w-36 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-250 cursor-pointer select-none"
          >
            <span className={startDate ? 'font-semibold text-slate-800 dark:text-gray-200 truncate' : 'text-slate-500 dark:text-gray-400 truncate'}>
              {startDate || S.startDateLabel}
            </span>
            <Calendar size={14} className="text-slate-400 shrink-0 ml-1.5 pointer-events-none" />
            <input
              ref={startDateInputRef}
              id="all-rfqs-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label={S.startDateLabel}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </div>

          {/* 4. End Date: Compact date button/control */}
          <div
            role="button"
            tabIndex={0}
            onClick={openEndDatePicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openEndDatePicker();
              }
            }}
            className="relative flex items-center justify-between h-9 w-36 shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-250 cursor-pointer select-none"
          >
            <span className={endDate ? 'font-semibold text-slate-800 dark:text-gray-200 truncate' : 'text-slate-500 dark:text-gray-400 truncate'}>
              {endDate || S.endDateLabel}
            </span>
            <Calendar size={14} className="text-slate-400 shrink-0 ml-1.5 pointer-events-none" />
            <input
              ref={endDateInputRef}
              id="all-rfqs-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label={S.endDateLabel}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </div>

          {/* Clear filters button */}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-gray-300 dark:hover:bg-gray-900 cursor-pointer"
              title={S.clearFilters}
              aria-label={S.clearFilters}
            >
              <X size={13} />
              <span>{S.clearFilters}</span>
            </button>
          )}

          {/* 5. Export button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || filtered.length === 0}
            aria-label={S.exportCsvAria}
            data-testid="all-rfqs-export-csv"
            className="inline-flex items-center gap-1.5 h-9 shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 px-3.5 text-xs font-bold text-white shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <Download size={14} className="shrink-0" />
            <span>Export</span>
          </button>

          {/* 6. Gear icon button */}
          <button
            type="button"
            onClick={createBooleanSetterHandler(setShowAllRfqsColumnSettings, true)}
            data-testid="all-rfqs-column-settings-btn"
            aria-label="Column Settings"
            title="Column Settings"
            className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-indigo-600 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-250 dark:hover:bg-gray-900 shadow-2xs transition-colors cursor-pointer"
          >
            <Settings size={15} />
          </button>

          {/* 7. Refresh/Retry icon button */}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label={S.retryAction}
            title={S.retryAction}
            data-testid="all-rfqs-refresh"
            className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60 dark:border-slate-800 dark:bg-gray-950 dark:text-gray-250 dark:hover:bg-gray-900 shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.loading}</p>}

      {!loading && error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle size={28} className="text-rose-500" />
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-primary text-xs font-bold px-4 py-1.5 rounded-lg bg-indigo-600 text-white cursor-pointer"
          >
            {S.retryAction}
          </button>
        </div>
      )}

      {!loading && !error && rfqs.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-gray-450 py-10 text-center">{S.empty}</p>
      )}

      {!loading && !error && rfqs.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <Search size={24} aria-hidden="true" className="text-slate-400" />
          <p className="text-sm text-slate-500 dark:text-gray-450">{S.noMatches}</p>
          <button type="button" onClick={clearFilters} className="text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer">
            {S.clearFilters}
          </button>
        </div>
      )}

      <ColumnSettingsPopup
        isOpen={showAllRfqsColumnSettings}
        onClose={createBooleanSetterHandler(setShowAllRfqsColumnSettings, false)}
        columns={allRfqsColumns}
        onSave={setAllRfqsColumns}
        onReset={createColumnResetHandler(CM_ALL_RFQS_TABLE_COLUMNS, setAllRfqsColumns)}
        title="Column Settings"
      />

      {/* 1-Line Excel-Style Spreadsheet Table */}
      {!loading && !error && filtered.length > 0 && (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-gray-950 overflow-hidden">
          <div ref={tableContainerRef} className="overflow-x-auto w-full">
            <table className="w-full min-w-max table-auto text-xs">
            <caption className="sr-only">{S.subtitle}</caption>
            <thead>
              <tr className="h-10 border-b border-slate-200 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-gray-900/90 dark:text-gray-400 select-none whitespace-nowrap">
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('rfqNumber', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'rfqNumber')}
                  className={getTableColumnClass(allRfqsColumns, 'rfqNumber', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colRfqNumber} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'rfqNumber')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('title', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'title')}
                  className={getTableColumnClass(allRfqsColumns, 'title', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colTitle} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'title')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('category', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'category')}
                  className={getTableColumnClass(allRfqsColumns, 'category', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colCategory} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'category')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('buyerAccountName', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'buyerAccountName')}
                  className={getTableColumnClass(allRfqsColumns, 'buyerAccountName', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colBuyer} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'buyerAccountName')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('status', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'status')}
                  className={getTableColumnClass(allRfqsColumns, 'status', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colStatus} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'status')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('quotesCount', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'quotesCount')}
                  className={getTableColumnClass(allRfqsColumns, 'quotesCount', 'px-3 py-2 text-right font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center justify-end gap-1">{S.colQuotes} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'quotesCount')}</span></span>
                </th>
                <th scope="col" className={getTableColumnClass(allRfqsColumns, 'invitedVendors', 'px-3 py-2 text-left font-bold whitespace-nowrap')}>{S.colInvitedVendors}</th>
                <th scope="col" className={getTableColumnClass(allRfqsColumns, 'quotedVendors', 'px-3 py-2 text-left font-bold whitespace-nowrap')}>{S.colVendors}</th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('budget', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'budget')}
                  className={getTableColumnClass(allRfqsColumns, 'budget', 'px-3 py-2 text-right font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center justify-end gap-1">{S.colBudget} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'budget')}</span></span>
                </th>
                <th
                  scope="col"
                  onClick={createColumnSortClickHandler('createdAt', setAllRfqsSort)}
                  aria-sort={getTableAriaSort(allRfqsSort, 'createdAt')}
                  className={getTableColumnClass(allRfqsColumns, 'createdAt', 'px-3 py-2 text-left font-bold cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-gray-800')}
                >
                  <span className="inline-flex items-center gap-1">{S.colCreated} <span aria-hidden="true">{getSortIndicatorSymbol(allRfqsSort, 'createdAt')}</span></span>
                </th>
                <th scope="col" className={getTableColumnClass(allRfqsColumns, 'latestQuote', 'px-3 py-2 text-left font-bold whitespace-nowrap')}>{S.colLatestQuote}</th>
                <th scope="col" className={getTableColumnClass(allRfqsColumns, 'actions', 'px-3 py-2 text-right font-bold whitespace-nowrap')}>{S.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
              {/* paginatedRfqs slices the sorted rows (sortedRfqs) into pages of 100 */}
              {paginatedRfqs.map((rfq) => {
                const isUncategorizedV0 =
                  (rfq.sourcingMode === 'mode_0' || (rfq.sourcingMode as string) === 'v0') &&
                  !rfqHasCategorySignal(rfq) &&
                  (!rfq.assignedVendors || rfq.assignedVendors.length === 0);
                const needsAssignment = Boolean(rfq.needsCategoryManagerAssignment || isUncategorizedV0);

                return (
                  <tr
                    key={rfq.id}
                    className="h-10 border-b border-slate-100 dark:border-slate-850 hover:bg-sky-50/50 dark:hover:bg-gray-900/60 whitespace-nowrap transition-colors"
                  >
                    <td className={getTableColumnClass(allRfqsColumns, 'rfqNumber', 'px-3 py-1.5 font-mono text-xs font-bold text-slate-800 dark:text-gray-200 whitespace-nowrap')}>{rfq.rfqNumber}</td>
                    <td className={getTableColumnClass(allRfqsColumns, 'title', 'px-3 py-1.5 max-w-[200px] whitespace-nowrap')}>
                      <div className="truncate font-bold text-slate-800 dark:text-gray-200" title={rfq.title}>{rfq.title}</div>
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'category', 'px-3 py-1.5 max-w-[140px] whitespace-nowrap')}>
                      <div className="truncate text-[11px] text-slate-500 dark:text-gray-450" title={rfq.category || undefined}>{rfq.category || '—'}</div>
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'buyerAccountName', 'px-3 py-1.5 max-w-[160px] whitespace-nowrap')}>
                      {rfq.buyerAccountName ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedBuyerInfo({
                              name: rfq.buyerAccountName || null,
                              id: rfq.buyerAccountId || null,
                              rfq,
                            })
                          }
                          className="inline-flex items-center gap-1.5 text-left font-bold text-slate-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition-colors group cursor-pointer max-w-full"
                          title={`Click to view full buyer details for ${rfq.buyerAccountName}`}
                        >
                          <Building2 size={13} className="text-slate-400 group-hover:text-indigo-500 shrink-0 transition-colors" />
                          <span className="truncate">{rfq.buyerAccountName}</span>
                        </button>
                      ) : (
                        <span className="italic text-slate-400">{S.buyerUnknown}</span>
                      )}
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'status', 'px-3 py-1.5 whitespace-nowrap')}>
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[rfq.status]}`}>
                          {rfq.status}
                        </span>
                        {needsAssignment && (
                          <span className="inline-flex whitespace-nowrap rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-bold">
                            Pending CM Assignment
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'quotesCount', 'px-3 py-1.5 text-right font-mono text-slate-700 dark:text-gray-300 whitespace-nowrap')}>{rfq.quotesCount}</td>
                    
                    {/* Invited Vendors column: show single vendor on the row, floating popover on hover */}
                    <td
                      className={getTableColumnClass(allRfqsColumns, 'invitedVendors', 'px-3 py-1.5 whitespace-nowrap')}
                      onMouseEnter={(e) => handleCellMouseEnter(rfq, e.currentTarget)}
                      onMouseLeave={handleCellMouseLeave}
                    >
                      {rfq.assignedVendors && rfq.assignedVendors.length > 0 ? (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="sr-only">Invited ({rfq.assignedVendors.length})</span>
                          {(() => {
                            const firstAv = rfq.assignedVendors[0];
                            const identity = invitedVendorIdentity(firstAv);
                            const vName = identity.name ?? EMPTY_VALUE;
                            const vId = identity.id;
                            const total = rfq.assignedVendors.length;

                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedVendorInfo({
                                      name: vName,
                                      id: vId,
                                      assignedVendor: firstAv,
                                      rfq,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors max-w-[130px] truncate cursor-pointer"
                                  title={`Invited vendor: ${vName}. Click to view details.`}
                                >
                                  <Store size={10} className="text-slate-400 shrink-0" />
                                  <span className="truncate">{vName}</span>
                                </button>
                                {total > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setVendorListModalData({ rfq, mode: 'assigned' })}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition border border-indigo-200 dark:border-indigo-800 cursor-pointer shrink-0"
                                    title="Click to view all invited vendors"
                                  >
                                    +{total - 1} more
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="italic text-slate-400 text-xs">{S.colInvitedVendorsNone}</span>
                      )}
                    </td>

                    {/* Quoted Vendors column: 1 line single quoted vendor */}
                    <td className={getTableColumnClass(allRfqsColumns, 'quotedVendors', 'px-3 py-1.5 whitespace-nowrap')}>
                      {rfq.quotes && rfq.quotes.length > 0 ? (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {(() => {
                            const q = rfq.quotes[0];
                            const total = rfq.quotes.length;
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedVendorInfo({
                                      name: q.vendorName,
                                      id: q.vendorId,
                                      quote: q,
                                      rfq,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/70 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-200 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900 transition-colors max-w-[135px] truncate cursor-pointer shadow-2xs group"
                                  title={`Quoted vendor: ${q.vendorName}. Click to view quotation details.`}
                                >
                                  <Store size={11} className="text-teal-600 dark:text-teal-400 shrink-0" />
                                  <span className="truncate">{q.vendorName}</span>
                                  {q.isBestPrice && (
                                    <span className="shrink-0 px-1 py-0.2 rounded text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                      L1
                                    </span>
                                  )}
                                </button>
                                {total > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setVendorListModalData({ rfq, mode: 'quotes' })}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900 transition border border-teal-200 dark:border-teal-800 cursor-pointer shrink-0"
                                    title="Click to view all quoted vendors"
                                  >
                                    +{total - 1} more
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="italic text-slate-400 text-xs">{S.colVendorsNone}</span>
                      )}
                    </td>

                    <td className={getTableColumnClass(allRfqsColumns, 'budget', 'px-3 py-1.5 text-right font-mono text-xs text-slate-700 dark:text-gray-300 whitespace-nowrap')}>
                      {rfq.budget > 0 ? formatCurrency(rfq.budget) : <span className="text-slate-400">{S.budgetUnset}</span>}
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'createdAt', 'whitespace-nowrap px-3 py-1.5 text-[11px] text-slate-500 dark:text-gray-450')}>
                      {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className={getTableColumnClass(allRfqsColumns, 'latestQuote', 'px-3 py-1.5 text-[11px] text-slate-600 dark:text-gray-300 whitespace-nowrap')} data-testid="all-rfqs-latest-quote">
                      {(() => {
                        const latest = latestQuoteSubmittedAt(rfq);
                        return latest ? (
                          <span className="whitespace-nowrap font-semibold">{formatIndianDateTime(latest)}</span>
                        ) : (
                          <span className="italic text-slate-400">{S.latestQuoteNone}</span>
                        );
                      })()}
                    </td>

                    {/* Actions: Invite Vendors, Details, Quote Matrix horizontally side-by-side on 1 line */}
                    <td className={getTableColumnClass(allRfqsColumns, 'actions', 'px-3 py-1.5 whitespace-nowrap text-right')}>
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setInviteTargetRfq(rfq)}
                          aria-label={formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber })}
                          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold hover:underline ${
                            needsAssignment ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' : 'text-slate-600 dark:text-gray-300'
                          }`}
                        >
                          <UserPlus size={13} /> <span>{needsAssignment ? 'Assign Vendors' : S.inviteVendorsAction}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onViewDetails?.(rfq)}
                          aria-label={formatString(S.viewDetailsAria, { rfqNumber: rfq.rfqNumber })}
                          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-slate-600 hover:underline dark:text-gray-300"
                        >
                          <FileText size={13} /> <span>{S.viewDetailsAction}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateToMatrix?.(rfq)}
                          aria-label={formatString(S.viewMatrixAria, { rfqNumber: rfq.rfqNumber })}
                          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          <span>{S.viewMatrixAction}</span> <ChevronRight size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* Pagination Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-950">
            <span className="text-xs text-slate-500 dark:text-gray-400 font-medium">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} RFQs
            </span>
            <div className="flex items-center gap-1.5 select-none">
              <button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Previous page"
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                &lt; Previous
              </button>
              {pageNumbers.map((p, idx) => {
                if (typeof p === 'string') {
                  return (
                    <span key={`ellipsis-${idx}`} className="px-2 text-xs text-slate-400 select-none">
                      {p}
                    </span>
                  );
                }
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePageChange(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === currentPage ? 'page' : undefined}
                    className={`h-8 min-w-8 px-2 rounded-lg flex items-center justify-center text-xs font-bold transition-colors cursor-pointer ${
                      p === currentPage
                        ? 'bg-[#009688] text-white border border-[#009688] shadow-xs'
                        : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 font-semibold'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Next &gt;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Hover Popover Tooltip for Invited Vendors */}
      {hoveredInvitedRfq && (
        <div
          role="tooltip"
          className="fixed z-50 w-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-2xl p-3 text-xs animate-in fade-in zoom-in-95 duration-100"
          style={{ top: hoveredInvitedRfq.rect.top, left: hoveredInvitedRfq.rect.left }}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          <div className="font-bold text-[10px] text-slate-400 dark:text-gray-400 uppercase tracking-wider mb-2">
            INVITED ({hoveredInvitedRfq.rfq.assignedVendors?.length || 0})
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {hoveredInvitedRfq.rfq.assignedVendors?.map((av, idx) => {
              const identity = invitedVendorIdentity(av);
              const vName = identity.name ?? EMPTY_VALUE;
              const vId = identity.id;
              return (
                <button
                  key={vId || idx}
                  type="button"
                  onClick={() => {
                    setSelectedVendorInfo({
                      name: vName,
                      id: vId,
                      assignedVendor: av,
                      rfq: hoveredInvitedRfq.rfq,
                    });
                    setHoveredInvitedRfq(null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-800 transition group cursor-pointer"
                >
                  <Store size={13} className="text-slate-400 group-hover:text-indigo-500 shrink-0" />
                  <span className="truncate flex-1 font-medium">{vName}</span>
                </button>
              );
            })}
          </div>
          {(hoveredInvitedRfq.rfq.assignedVendors?.length || 0) > 3 && (
            <button
              type="button"
              onClick={() => {
                const rfq = hoveredInvitedRfq.rfq;
                setHoveredInvitedRfq(null);
                setVendorListModalData({ rfq, mode: 'assigned' });
              }}
              className="mt-2 w-full text-center py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900 transition cursor-pointer"
            >
              +{(hoveredInvitedRfq.rfq.assignedVendors?.length || 0) - 3} more
            </button>
          )}
        </div>
      )}

      {/* Modals & Drawers: 100% existing components and handlers */}
      <InviteVendorsModal
        isOpen={inviteTargetRfq !== null}
        rfq={inviteTargetRfq}
        onClose={() => setInviteTargetRfq(null)}
        onInvited={(updatedRfq) => {
          setRfqs((prev) => prev.map((r) => (r.id === updatedRfq.id ? updatedRfq : r)));
        }}
      />

      <BuyerDetailsModal
        isOpen={selectedBuyerInfo !== null}
        buyerName={selectedBuyerInfo?.name}
        buyerAccountId={selectedBuyerInfo?.id}
        rfq={selectedBuyerInfo?.rfq}
        onClose={() => setSelectedBuyerInfo(null)}
      />

      <VendorDetailsModal
        isOpen={selectedVendorInfo !== null}
        vendorName={selectedVendorInfo?.name}
        vendorId={selectedVendorInfo?.id}
        quote={selectedVendorInfo?.quote}
        assignedVendor={selectedVendorInfo?.assignedVendor}
        rfq={selectedVendorInfo?.rfq}
        onClose={() => setSelectedVendorInfo(null)}
        onNavigateToMatrix={onNavigateToMatrix}
      />

      {/* Multiple Vendors Overview Modal */}
      {vendorListModalData && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVendorListModalData(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4 bg-white/95 dark:bg-gray-900/95">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="rounded-xl bg-teal-50 dark:bg-teal-950/70 p-2 text-teal-600 dark:text-teal-400 shrink-0">
                  <Store size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-900 dark:text-white truncate">
                    {vendorListModalData.mode === 'quotes'
                      ? `Quoted Vendors (${vendorListModalData.rfq.quotes?.length || 0})`
                      : `Invited Vendors (${vendorListModalData.rfq.assignedVendors?.length || 0})`}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-gray-450 truncate">
                    {vendorListModalData.rfq.rfqNumber} • {vendorListModalData.rfq.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVendorListModalData(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1 divide-y divide-slate-100 dark:divide-slate-800/60">
              {vendorListModalData.mode === 'quotes'
                ? (vendorListModalData.rfq.quotes || []).map((q, idx) => (
                    <div
                      key={q.vendorId || idx}
                      className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/50 transition border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                            {q.vendorName}
                          </span>
                          {q.isBestPrice && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              L1 Best Price
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-450 mt-1">
                          <span>Total: <strong className="text-slate-800 dark:text-gray-200">{formatCurrency(q.totalPrice)}</strong></span>
                          <span>Lead: <strong>{q.leadTimeDays != null ? `${q.leadTimeDays}d` : EMPTY_VALUE}</strong></span>
                          <span>Warranty: <strong>{q.warrantyYears != null ? `${q.warrantyYears}y` : EMPTY_VALUE}</strong></span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetRfq = vendorListModalData.rfq;
                          setVendorListModalData(null);
                          setSelectedVendorInfo({
                            name: q.vendorName,
                            id: q.vendorId,
                            quote: q,
                            rfq: targetRfq,
                          });
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition shadow-xs cursor-pointer"
                      >
                        View Details
                      </button>
                    </div>
                  ))
                : (vendorListModalData.rfq.assignedVendors || []).map((av, idx) => {
                    const identity = invitedVendorIdentity(av);
                    const vName = identity.name ?? EMPTY_VALUE;
                    const vId = identity.id;
                    return (
                      <div
                        key={vId || idx}
                        className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800/50 transition border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white text-sm truncate block">
                            {vName}
                          </span>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-gray-450 mt-0.5 flex-wrap">
                            {av.contactPerson && <span>Contact: {av.contactPerson}</span>}
                            {av.city && <span>{av.city}</span>}
                            <span className="italic text-amber-600 dark:text-amber-400">Awaiting Quotation</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const targetRfq = vendorListModalData.rfq;
                            setVendorListModalData(null);
                            setSelectedVendorInfo({
                              name: vName,
                              id: vId,
                              assignedVendor: av,
                              rfq: targetRfq,
                            });
                          }}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer"
                        >
                          View Details
                        </button>
                      </div>
                    );
                  })}
            </div>

            <div className="flex items-center justify-end border-t border-slate-200 dark:border-slate-800 px-5 py-3 bg-slate-50/80 dark:bg-gray-950/80">
              <button
                type="button"
                onClick={() => setVendorListModalData(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
