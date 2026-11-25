'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/store';
import type { RFQItem, BuyerAccount } from '@/lib/types';
import { SOURCING_MODES, USER_PREFERENCE_KEYS, formatCurrency, formatIndianDateTime, formatIndianDate, parseRfqTimestamp } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { fetchBuyerDirectoryKPIStats } from '@/lib/buyerProfileClient';
import { exportReportToCsv } from '@/lib/reportsClient';
import { deleteUserPreference, getUserPreference, saveUserPreference } from '@/lib/userPreferencesClient';
import ColumnSettingsPopup, { type ColumnDef } from './components/ColumnSettingsPopup';
import CompanyHoverTooltip from '@/app/components/CompanyHoverTooltip';
import {
  Building2,
  Users,
  Search,
  ChevronRight,
  Clock,
  IndianRupee,
  Layers,
  ArrowRight,
  ChevronDown,
  RotateCw,
  Settings,
  Download,
} from 'lucide-react';

interface BuyerConsoleProps {
  onNavigateToMatrix: (rfq: RFQItem) => void;
  onNavigateToEvaluation: () => void;
}

// Shown wherever a value is not recorded on the buyer account or RFQ.
const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

export const DEFAULT_BUYER_CONSOLE_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Buyer Name', visible: true, required: true },
  { key: 'company', label: 'Company Name', visible: true },
  { key: 'email', label: 'Email', visible: true },
  { key: 'phone', label: 'Phone', visible: true },
  { key: 'sourcingMode', label: 'Sourcing Mode', visible: true },
  { key: 'totalRfqs', label: 'Total RFQs', visible: true },
  { key: 'activeRfqs', label: 'Active RFQs', visible: true },
  { key: 'sourcedSpend', label: 'Sourced Spend', visible: true },
  { key: 'avgQuotes', label: 'Avg Quotes / RFQ', visible: true },
  { key: 'date', label: 'Date', visible: true },
  { key: 'actions', label: 'Actions', visible: true, required: true },
];

const STORAGE_KEY_COLUMNS = USER_PREFERENCE_KEYS.BUYER_CONSOLE_COLUMNS;
const PAGE_SIZE = 100;

type SortField =
  | 'name'
  | 'company'
  | 'email'
  | 'phone'
  | 'sourcingMode'
  | 'totalRfqs'
  | 'activeRfqs'
  | 'sourcedSpend'
  | 'avgQuotes'
  | 'date';

type SortDir = 'asc' | 'desc';

// Deterministic decorative avatar color from org name
const AVATAR_PALETTE = [
  { bg: 'bg-indigo-600 text-white', avatar: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' },
  { bg: 'bg-orange-500 text-white', avatar: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  { bg: 'bg-purple-500 text-white', avatar: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' },
  { bg: 'bg-cyan-500 text-white', avatar: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300' },
  { bg: 'bg-emerald-600 text-white', avatar: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  { bg: 'bg-rose-600 text-white', avatar: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' },
];

function avatarStyleFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export default function BuyerConsole({ onNavigateToMatrix, onNavigateToEvaluation }: BuyerConsoleProps) {
  const { rfqs, buyerAccounts, refreshFromDB, refreshRFQs } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
  const [expandedRfqNumber, setExpandedRfqNumber] = useState<string | null>(null);
  const [drillDownDismissed, setDrillDownDismissed] = useState(false);

  // Dropdown context filter states
  const [selectedCompany, setSelectedCompany] = useState<string>('all');
  const [selectedBuyerFilterId, setSelectedBuyerFilterId] = useState<string>('all');

  // Sorting state
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState<1 | number>(1);
  const [dbKPIStats, setDbKPIStats] = useState<{ totalBuyers: number } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Column visibility and order state (hydrated from backend user preferences API)
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [columns, setColumns] = useState<ColumnDef[]>(DEFAULT_BUYER_CONSOLE_COLUMNS);

  useEffect(() => {
    let cancelled = false;
    void getUserPreference<ColumnDef[]>(STORAGE_KEY_COLUMNS).then((saved) => {
      if (cancelled || !Array.isArray(saved) || saved.length === 0) return;
      const validKeys = new Set(DEFAULT_BUYER_CONSOLE_COLUMNS.map((c) => c.key));
      const reordered = saved.filter((c) => validKeys.has(c.key));
      for (const def of DEFAULT_BUYER_CONSOLE_COLUMNS) {
        if (!reordered.some((c) => c.key === def.key)) {
          reordered.push({ ...def });
        }
      }
      if (reordered.length > 0) setColumns(reordered);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [draggedColIdx, setDraggedColIdx] = useState<number | null>(null);

  // Live Database KPI counts (Removes 500-cap)
  useEffect(() => {
    let isMounted = true;
    fetchBuyerDirectoryKPIStats()
      .then((res) => {
        if (isMounted && res.success && typeof res.totalBuyers === 'number') {
          setDbKPIStats({ totalBuyers: res.totalBuyers });
        }
      })
      .catch(() => {
        // Fallback to in-memory count
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Save column configuration via backend user preferences API
  const handleSaveColumns = useCallback((newCols: ColumnDef[]) => {
    setColumns(newCols);
    void saveUserPreference(STORAGE_KEY_COLUMNS, newCols);
  }, []);

  // Reset columns to default via backend user preferences API
  const handleResetColumns = useCallback(() => {
    setColumns(DEFAULT_BUYER_CONSOLE_COLUMNS);
    void deleteUserPreference(STORAGE_KEY_COLUMNS);
  }, []);

  // Header drag reordering
  const handleHeaderDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedColIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleHeaderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleHeaderDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedColIdx === null || draggedColIdx === targetIdx) {
      setDraggedColIdx(null);
      return;
    }
    const next = [...columns];
    const [moved] = next.splice(draggedColIdx, 1);
    next.splice(targetIdx, 0, moved);
    handleSaveColumns(next);
    setDraggedColIdx(null);
  };

  // Sort toggle handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const getSortIndicator = (field: SortField): string => {
    if (sortField !== field) return '↑↓';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  // Compile buyer rows with RFQ aggregations
  const compiledBuyers = useMemo(() => {
    return buyerAccounts.map((account) => {
      const rfqsList = rfqs.filter((r) =>
        (r.buyerAccountId && r.buyerAccountId === account.id) ||
        (r.raisedByEmail && account.corporateEmail && r.raisedByEmail.toLowerCase() === account.corporateEmail.toLowerCase()) ||
        (r.buyerEmail && account.corporateEmail && r.buyerEmail.toLowerCase() === account.corporateEmail.toLowerCase()) ||
        (r.buyerAccountName && account.organizationName && r.buyerAccountName.toLowerCase() === account.organizationName.toLowerCase())
      );

      const totalSpend = rfqsList.reduce((sum, r) => sum + (Number.isFinite(r.budget) ? r.budget : 0), 0);
      const activeCount = rfqsList.filter((r) => r.status !== 'PO Generated').length;
      const totalQuotes = rfqsList.reduce((sum, r) => sum + (r.quotesCount || 0), 0);
      const avgQuotesPerRfq = rfqsList.length > 0 ? Math.round((totalQuotes / rfqsList.length) * 10) / 10 : null;

      const displayName = account.contactPerson || EMPTY_VALUE;
      const displayCompany = account.organizationName || EMPTY_VALUE;
      const style = avatarStyleFor(displayCompany);

      const rawDate = account.createdDate || account.syncTimestamp || rfqsList[0]?.createdAt || '';
      const dateDisplay = rawDate ? formatIndianDate(rawDate) : EMPTY_VALUE;
      const dateTimestamp = parseRfqTimestamp(rawDate) ?? 0;

      return {
        id: account.id,
        name: displayName,
        email: account.corporateEmail,
        phone: account.mobileNumber || '',
        company: displayCompany,
        logoLetter: displayCompany.charAt(0).toUpperCase(),
        logoBg: style.bg,
        avatarColor: style.avatar,
        preferredMode: account.sourcingMode,
        avgQuotesPerRfq,
        rfqsList,
        totalSpend,
        activeCount,
        dateDisplay,
        dateTimestamp,
      };
    });
  }, [buyerAccounts, rfqs]);

  // Filter buyers based on dropdown context selection
  const filteredByDropdownBuyers = useMemo(() => {
    return compiledBuyers.filter((b) => {
      const matchCompany = selectedCompany === 'all' || b.company === selectedCompany;
      const matchBuyer = selectedBuyerFilterId === 'all' || b.id === selectedBuyerFilterId;
      return matchCompany && matchBuyer;
    });
  }, [compiledBuyers, selectedCompany, selectedBuyerFilterId]);

  // Overall Analytics computations based on dropdown filter scope
  const grandTotalSpend = filteredByDropdownBuyers.reduce((sum, b) => sum + b.totalSpend, 0);
  const totalRfqCount = filteredByDropdownBuyers.reduce((sum, b) => sum + b.rfqsList.length, 0);

  const buyersWithQuotes = filteredByDropdownBuyers.filter(
    (b): b is typeof b & { avgQuotesPerRfq: number } => b.avgQuotesPerRfq !== null
  );
  const avgQuotesAcrossBuyers =
    buyersWithQuotes.length > 0
      ? (buyersWithQuotes.reduce((sum, b) => sum + b.avgQuotesPerRfq, 0) / buyersWithQuotes.length).toFixed(1)
      : '—';

  // Search filter
  const cleanSearch = searchTerm.trim().toLowerCase();
  const searchFilteredBuyers = useMemo(() => {
    return filteredByDropdownBuyers.filter((b) => {
      if (!cleanSearch) return true;
      return (
        b.company.toLowerCase().includes(cleanSearch) ||
        b.name.toLowerCase().includes(cleanSearch) ||
        (b.email && b.email.toLowerCase().includes(cleanSearch))
      );
    });
  }, [filteredByDropdownBuyers, cleanSearch]);

  // Full column sorting
  const sortedBuyers = useMemo(() => {
    if (!sortField) return searchFilteredBuyers;
    return [...searchFilteredBuyers].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = (a.name || '').localeCompare(b.name || '');
          break;
        case 'company':
          cmp = (a.company || '').localeCompare(b.company || '');
          break;
        case 'email':
          cmp = (a.email || '').localeCompare(b.email || '');
          break;
        case 'phone':
          cmp = (a.phone || '').localeCompare(b.phone || '');
          break;
        case 'sourcingMode':
          cmp = (a.preferredMode || '').localeCompare(b.preferredMode || '');
          break;
        case 'totalRfqs':
          cmp = a.rfqsList.length - b.rfqsList.length;
          break;
        case 'activeRfqs':
          cmp = a.activeCount - b.activeCount;
          break;
        case 'sourcedSpend':
          cmp = a.totalSpend - b.totalSpend;
          break;
        case 'avgQuotes':
          cmp = (a.avgQuotesPerRfq ?? -1) - (b.avgQuotesPerRfq ?? -1);
          break;
        case 'date':
        default:
          cmp = a.dateTimestamp - b.dateTimestamp;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [searchFilteredBuyers, sortField, sortDir]);

  // Reset to page 1 on search, filter, or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCompany, selectedBuyerFilterId, sortField, sortDir]);

  // Exact live total count (removes 500 cap)
  const isFilterActive = Boolean(cleanSearch || selectedCompany !== 'all' || selectedBuyerFilterId !== 'all');
  const exactTotalBuyers = isFilterActive
    ? sortedBuyers.length
    : (dbKPIStats?.totalBuyers ?? sortedBuyers.length);

  const totalPages = Math.max(1, Math.ceil(exactTotalBuyers / PAGE_SIZE));
  const pagedBuyers = sortedBuyers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Smooth scroll table to top on page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    const el = document.getElementById('buyer-table-container');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Reload handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([
        refreshFromDB(),
        refreshRFQs(),
        fetchBuyerDirectoryKPIStats().then((res) => {
          if (res.success && typeof res.totalBuyers === 'number') {
            setDbKPIStats({ totalBuyers: res.totalBuyers });
          }
        }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Export filtered buyers to CSV
  const handleExportCsv = () => {
    if (sortedBuyers.length === 0) return;
    const rows = sortedBuyers.map((b) => ({
      'Buyer Name': b.name,
      'Company Name': b.company,
      'Email': b.email || '',
      'Phone': b.phone || '',
      'Sourcing Mode': b.preferredMode ? `${b.preferredMode.toUpperCase()} Sourcing` : '',
      'Total RFQs': b.rfqsList.length,
      'Active RFQs': b.activeCount,
      'Sourced Spend': b.totalSpend,
      'Avg Quotes / RFQ': b.avgQuotesPerRfq ?? 0,
      'Date': b.dateDisplay,
    }));
    exportReportToCsv(rows, `buyer_rfq_console_${new Date().toISOString().split('T')[0]}`);
  };

  // Drill-down resolution
  const dropdownDrivenBuyerId = selectedBuyerFilterId !== 'all' ? selectedBuyerFilterId : null;
  const activeBuyerId = drillDownDismissed ? null : dropdownDrivenBuyerId ?? selectedBuyerId;
  const selectedBuyer = compiledBuyers.find((b) => b.id === activeBuyerId);

  const handleToggleBuyer = (id: string) => {
    if (activeBuyerId === id) {
      setSelectedBuyerId(null);
      setDrillDownDismissed(true);
    } else {
      setSelectedBuyerId(id);
      setDrillDownDismissed(false);
      setExpandedRfqNumber(null);
      setTimeout(() => {
        const el = document.getElementById('buyer-drilldown-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    }
  };

  const visibleColumns = useMemo(() => columns.filter((col) => col.visible), [columns]);

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 1. COMPACT TOP KPI ROW (SLIM HORIZONTAL ROW, REMOVED BULKY LIST) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Total Active Spend Sourced */}
        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {UI_STRINGS.buyerConsole.kpiSpendTitle}
            </div>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">
              {formatCurrency(grandTotalSpend)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-650 dark:text-indigo-400 shrink-0">
            <IndianRupee size={20} />
          </div>
        </div>

        {/* KPI 2: Total Sourcing Volume */}
        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {UI_STRINGS.buyerConsole.kpiVolumeTitle}
            </div>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">
              {totalRfqCount} {UI_STRINGS.buyerConsole.rfqsLiveSuffix}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
            <Layers size={20} />
          </div>
        </div>

        {/* KPI 3: Avg Quotes Per RFQ */}
        <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
              {UI_STRINGS.buyerConsole.kpiAvgQuotesTitle}
            </div>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 mono">
              {avgQuotesAcrossBuyers}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Clock size={20} />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 2. SINGLE-ROW FILTER TOOLBAR (NO HORIZONTAL OVERFLOW)         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 w-full">
        {/* Accessible label for compatibility */}
        <span className="sr-only">Active Context Selection:</span>

        {/* 1. Search input */}
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
            <Search size={14} />
          </span>
          <input
            type="text"
            placeholder={UI_STRINGS.buyerConsole.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-9 pr-3 py-1.5 text-xs w-full bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 placeholder:text-slate-400 font-medium"
            aria-label="Search Buyer name or company"
          />
        </div>

        {/* 2. All Companies dropdown */}
        <div className="w-[160px] shrink-0">
          <select
            value={selectedCompany}
            onChange={(e) => {
              setSelectedCompany(e.target.value);
              setSelectedBuyerFilterId('all');
            }}
            aria-label="Filter by Company"
            className="select py-1.5 px-3 text-xs w-full bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 font-medium truncate cursor-pointer"
          >
            <option value="all">{UI_STRINGS.buyerConsole.allCompanies}</option>
            {Array.from(new Set(compiledBuyers.map((b) => b.company))).map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </div>

        {/* 3. All Buyers dropdown */}
        <div className="w-[160px] shrink-0">
          <select
            value={selectedBuyerFilterId}
            onChange={(e) => setSelectedBuyerFilterId(e.target.value)}
            aria-label="Filter by Buyer"
            disabled={selectedCompany === 'all'}
            className="select py-1.5 px-3 text-xs w-full bg-white dark:bg-gray-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-gray-200 font-medium truncate cursor-pointer disabled:opacity-50"
          >
            <option value="all">{UI_STRINGS.buyerConsole.allBuyers}</option>
            {compiledBuyers
              .filter((b) => b.company === selectedCompany)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </div>

        {/* 4. Export button */}
        <button
          type="button"
          onClick={handleExportCsv}
          aria-label={UI_STRINGS.buyerConsole.exportBtn}
          title={UI_STRINGS.buyerConsole.exportBtn}
          className="shrink-0 whitespace-nowrap h-9 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
        >
          <Download size={14} className="shrink-0" />
          <span>{UI_STRINGS.buyerConsole.exportBtn}</span>
        </button>

        {/* 5. Refresh icon button */}
        <button
          type="button"
          onClick={handleRefresh}
          aria-label={UI_STRINGS.buyerConsole.refreshBtn}
          title={UI_STRINGS.buyerConsole.refreshBtn}
          className="w-9 h-9 shrink-0 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
        >
          <RotateCw size={14} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
        </button>

        {/* 6. Gear icon button */}
        <button
          type="button"
          onClick={() => setShowColumnSettings(true)}
          aria-label={UI_STRINGS.buyerConsole.columnSettingsBtn}
          title={UI_STRINGS.buyerConsole.columnSettingsBtn}
          className="w-9 h-9 shrink-0 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 dark:hover:text-indigo-400 transition-colors cursor-pointer"
        >
          <Settings size={14} />
        </button>
      </div>

      <ColumnSettingsPopup
        isOpen={showColumnSettings}
        onClose={() => setShowColumnSettings(false)}
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
        title="Column Settings"
      />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 3. STRICT SINGLE-LINE EXCEL-STYLE TABLE                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div
        id="buyer-table-container"
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 shadow-xs overflow-hidden"
      >
        <div className="overflow-x-auto w-full">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50/90 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold select-none">
              <tr>
                {visibleColumns.map((col, idx) => {
                  const isSortable = col.key !== 'actions';
                  const isNumeric = ['totalRfqs', 'activeRfqs', 'sourcedSpend', 'avgQuotes'].includes(col.key);
                  return (
                    <th
                      key={col.key}
                      draggable={true}
                      onDragStart={(e) => handleHeaderDragStart(e, idx)}
                      onDragOver={handleHeaderDragOver}
                      onDrop={(e) => handleHeaderDrop(e, idx)}
                      onClick={isSortable ? () => handleSort(col.key as SortField) : undefined}
                      className={`py-2.5 px-3 text-xs font-semibold whitespace-nowrap select-none ${
                        isSortable ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors' : ''
                      } ${isNumeric ? 'text-right' : col.key === 'actions' ? 'text-right' : 'text-left'}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${isNumeric || col.key === 'actions' ? 'justify-end' : ''}`}>
                        {col.label}
                        {isSortable && (
                          <span className="text-[10px] opacity-60 font-mono">
                            {getSortIndicator(col.key as SortField)}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {pagedBuyers.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-12 text-center text-slate-400 dark:text-gray-500">
                    <Users size={32} className="mx-auto mb-2 opacity-40 text-slate-400" />
                    <p className="font-semibold text-slate-600 dark:text-slate-400">
                      {UI_STRINGS.buyerConsole.noBuyersFound}
                    </p>
                  </td>
                </tr>
              ) : (
                pagedBuyers.map((b) => {
                  const isSelected = activeBuyerId === b.id;
                  const preferredModeObj = SOURCING_MODES.find((m) => m.id === b.preferredMode);
                  const modeBadgeLabel = preferredModeObj ? `${preferredModeObj.code} Sourcing` : 'Mode 0 Sourcing';

                  return (
                    <tr
                      key={b.id}
                      className={`glass-panel border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors h-11 ${
                        isSelected ? 'bg-indigo-50/40 dark:bg-indigo-950/25' : ''
                      }`}
                    >
                      {visibleColumns.map((col) => {
                        switch (col.key) {
                          case 'name':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`w-6 h-6 rounded-full ${b.avatarColor} font-bold text-[10px] flex items-center justify-center shrink-0`}
                                  >
                                    {(b.name || 'B').charAt(0).toLowerCase()}
                                  </span>
                                  <h4 className="font-semibold text-slate-900 dark:text-white truncate max-w-[160px] text-xs">
                                    {b.name}
                                  </h4>
                                </div>
                              </td>
                            );
                          case 'company':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                                <div className="truncate max-w-[180px]" title={b.company}>
                                  <CompanyHoverTooltip
                                    name={b.company}
                                    type="buyer"
                                    contact={{ contactPerson: b.name, email: b.email }}
                                  />
                                </div>
                              </td>
                            );
                          case 'email':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                                <span
                                  className="text-slate-600 dark:text-slate-400 truncate max-w-[190px] inline-block align-middle"
                                  title={b.email || ''}
                                >
                                  {b.email || EMPTY_VALUE}
                                </span>
                              </td>
                            );
                          case 'phone':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 font-mono text-xs">
                                {b.phone ? b.phone : <span className="italic text-slate-400 font-sans">{EMPTY_VALUE}</span>}
                              </td>
                            );
                          case 'sourcingMode':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                                <span
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap"
                                  style={
                                    preferredModeObj
                                      ? {
                                          backgroundColor: `${preferredModeObj.badgeColor}15`,
                                          borderColor: `${preferredModeObj.badgeColor}35`,
                                          color: preferredModeObj.badgeColor,
                                        }
                                      : {
                                          backgroundColor: '#f1f5f9',
                                          borderColor: '#cbd5e1',
                                          color: '#475569',
                                        }
                                  }
                                >
                                  {modeBadgeLabel}
                                </span>
                              </td>
                            );
                          case 'totalRfqs':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right mono font-bold text-slate-900 dark:text-white">
                                {b.rfqsList.length}
                              </td>
                            );
                          case 'activeRfqs':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right mono font-bold text-slate-900 dark:text-white">
                                {b.activeCount}
                              </td>
                            );
                          case 'sourcedSpend':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right mono font-bold text-slate-900 dark:text-white">
                                {formatCurrency(b.totalSpend)}
                              </td>
                            );
                          case 'avgQuotes':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right mono font-bold text-slate-900 dark:text-white">
                                {b.avgQuotesPerRfq === null ? 0 : b.avgQuotesPerRfq}
                              </td>
                            );
                          case 'date':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400 font-medium">
                                {b.dateDisplay}
                              </td>
                            );
                          case 'actions':
                            return (
                              <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBuyer(b.id);
                                  }}
                                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                                >
                                  <span>{isSelected ? UI_STRINGS.actions.hideDetails : UI_STRINGS.actions.reviewRfqDetails}</span>
                                  <ChevronRight
                                    size={12}
                                    className={`transform transition-transform ${isSelected ? 'rotate-90' : ''}`}
                                  />
                                </button>
                              </td>
                            );
                          default:
                            return null;
                        }
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 5. EXACT DB COUNT & 100-BUYERS-PER-PAGE PAGINATION BAR         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            {exactTotalBuyers === 0 ? (
              <span>{UI_STRINGS.buyerConsole.showingEmptyPagination}</span>
            ) : (
              <span>
                {formatString(UI_STRINGS.buyerConsole.showingPagination, {
                  start: (currentPage - 1) * PAGE_SIZE + 1,
                  end: Math.min(currentPage * PAGE_SIZE, exactTotalBuyers),
                  total: exactTotalBuyers.toLocaleString(),
                })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              &lt; {UI_STRINGS.buyerConsole.prevPage}
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              // Calculate page numbers around currentPage
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              const isActive = pageNum === currentPage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => handlePageChange(pageNum)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                    isActive
                      ? 'bg-teal-600 text-white font-bold shadow-xs'
                      : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {UI_STRINGS.buyerConsole.nextPage} &gt;
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DETAILED DRILL DOWN SECTION (EXPANDS ON SELECTION)            */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {selectedBuyer && (
        <div
          id="buyer-drilldown-section"
          className="glass-panel p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900/80 shadow-md space-y-4 animate-slide-up scroll-mt-6"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-gray-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 size={16} className="text-indigo-650 dark:text-indigo-400" />
                Sourcing Details for {selectedBuyer.company} ({selectedBuyer.name})
              </h3>
              <p className="text-[10px] text-slate-450 dark:text-gray-500">
                Live drill-down. Double-click or expand specific RFQ rows below to inspect item specifications and quotes list.
              </p>
            </div>
            <span className="text-[11px] mono text-slate-500 font-bold bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded border border-indigo-200/20">
              {selectedBuyer.rfqsList.length} total dispatches
            </span>
          </div>

          {selectedBuyer.rfqsList.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500 dark:text-gray-400 space-y-2 bg-slate-50/50 dark:bg-gray-950/40 rounded-xl p-6 border border-slate-200/60 dark:border-gray-800">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto font-bold text-xs">
                {selectedBuyer.logoLetter}
              </div>
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                No active RFQ records found for this buyer profile ({selectedBuyer.name}).
              </p>
              <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                Buyer account is active ({selectedBuyer.company}). Any RFQs created and dispatched by this buyer will appear here with live quotes and evaluation analytics.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedBuyer.rfqsList.map((rfq) => {
                const isRfqExpanded = expandedRfqNumber === rfq.rfqNumber;
                const rfqModeObj = SOURCING_MODES.find((m) => m.id === rfq.sourcingMode);
                const lineItems = rfq.extractedEntities || [];
                const invitedVendorCount = rfq.assignedVendors?.length ?? 0;
                const followUp = rfq.followUpData;
                const followUpSummary =
                  followUp && followUp.totalInvited > 0
                    ? `Standard bidding. Vendor responses recorded: ${followUp.respondedCount} of ${followUp.totalInvited} invited.`
                    : 'Standard bidding. No vendor follow-up is recorded for this RFQ yet.';

                return (
                  <div
                    key={rfq.rfqNumber}
                    className="border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-gray-950/40"
                  >
                    {/* RFQ Row Title Header */}
                    <div
                      onClick={() => setExpandedRfqNumber(isRfqExpanded ? null : rfq.rfqNumber)}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-gray-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-md ${selectedBuyer.logoBg} font-mono font-bold text-[9px] flex items-center justify-center shrink-0`}
                        >
                          {selectedBuyer.logoLetter}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{rfq.title}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-505 dark:text-gray-400 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.25 rounded border border-slate-200 dark:border-gray-700">
                              {rfq.rfqNumber}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-450 dark:text-gray-500 mt-1">
                            <span>Sourced Spend: <strong>{formatCurrency(rfq.budget)}</strong></span>
                            <span>Line Items: <strong>{lineItems.length}</strong></span>
                            <span>Quotes Recd: <strong>{rfq.quotesCount}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {rfqModeObj && (
                          <span
                            className="px-2 py-0.5 rounded text-[8px] font-bold"
                            style={{
                              backgroundColor: `${rfqModeObj.badgeColor}15`,
                              color: rfqModeObj.badgeColor,
                              border: `1px solid ${rfqModeObj.badgeColor}35`,
                            }}
                          >
                            {rfqModeObj.code} Sourcing
                          </span>
                        )}

                        <span
                          className={`badge text-[9px] ${
                            rfq.status === 'Parsing'
                              ? 'badge-amber'
                              : rfq.status === 'In Evaluation'
                              ? 'badge-blue'
                              : 'badge-emerald'
                          }`}
                        >
                          {rfq.status}
                        </span>

                        <ChevronDown
                          size={14}
                          className="text-slate-450 transition-transform"
                          style={{ transform: isRfqExpanded ? 'rotate(180deg)' : 'none' }}
                        />
                      </div>
                    </div>

                    {/* RFQ Expanded Body Section */}
                    {isRfqExpanded && (
                      <div className="p-4 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4 animate-fade-in text-xs">
                        {/* 1. Line Item Table */}
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-extrabold uppercase text-slate-450 dark:text-gray-500 tracking-wider">
                            BOQ Specifications & Item Roster ({lineItems.length} items)
                          </h4>
                          <div className="border border-slate-200 dark:border-gray-800 rounded-lg overflow-hidden">
                            <table className="w-full text-[11px] text-left">
                              <thead>
                                <tr className="bg-slate-50 dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 text-slate-505 dark:text-gray-405 font-bold">
                                  <th className="p-2.5">Item Name / Description</th>
                                  <th className="p-2.5">Category</th>
                                  <th className="p-2.5 text-center">Quantity</th>
                                  <th className="p-2.5">Technical Specifications Spec</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lineItems.map((ent) => (
                                  <tr
                                    key={ent.id}
                                    className="border-b border-slate-100 dark:border-gray-850 text-slate-800 dark:text-gray-300"
                                  >
                                    <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{ent.itemName}</td>
                                    <td className="p-2.5">{ent.category}</td>
                                    <td className="p-2.5 text-center font-mono font-bold text-slate-900 dark:text-white">
                                      {ent.quantity} {ent.unit}
                                    </td>
                                    <td className="p-2.5 text-slate-500 dark:text-gray-400">{ent.technicalSpecs}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* 2. Dispatch / Quotes Evaluation Status Card */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 text-[11px] leading-relaxed text-slate-500 dark:text-gray-400">
                          <div>
                            💡 <strong>Category Control Action</strong>: RFQ was created on{' '}
                            <span className="text-slate-800 dark:text-white font-semibold">
                              {rfq.createdAt ? formatIndianDateTime(rfq.createdAt) : EMPTY_VALUE}
                            </span>{' '}
                            via Mode: <strong>{rfqModeObj?.name ?? EMPTY_VALUE}</strong>.
                            {rfq.sourcingMode === 'mode_3' ? (
                              <span className="block mt-1 text-indigo-650 dark:text-indigo-400 font-semibold">
                                Mode 3 RFQ: {invitedVendorCount} vendor(s) invited on this RFQ.
                              </span>
                            ) : (
                              <span className="block mt-1">{followUpSummary}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {rfq.quotesCount > 0 && (
                              <button
                                type="button"
                                onClick={() => onNavigateToMatrix(rfq)}
                                className="btn btn-primary btn-xs font-bold flex items-center gap-1"
                              >
                                <span>Go to Quote Matrix</span>
                                <ArrowRight size={10} />
                              </button>
                            )}
                            {rfq.sourcingMode === 'mode_3' && (
                              <button
                                type="button"
                                onClick={onNavigateToEvaluation}
                                className="btn btn-secondary btn-xs font-bold"
                              >
                                Review Survey Evaluation
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
