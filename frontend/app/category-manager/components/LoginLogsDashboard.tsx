'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LogIn,
  Activity,
  Building2,
  Truck,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Download,
  X,
  ExternalLink,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Globe,
  Laptop,
  Settings,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { UI_STRINGS } from '@/lib/uiStrings';
import type {
  LoginLogEntry,
  LoginLogsSummary,
  LoginLogsFilterParams,
  LoginLogUserType,
  LoginLogStatus,
} from '@/lib/types';
import {
  fetchLoginLogs,
  fetchLoginLogsSummary,
  FALLBACK_SUMMARY,
} from '@/lib/loginLogsClient';
import ColumnSettingsPopup, { type ColumnDef } from './ColumnSettingsPopup';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const LOGIN_LOGS_DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'user', label: 'User & Role', visible: true, required: true },
  { key: 'company', label: 'Company', visible: true },
  { key: 'contact', label: 'Contact Info', visible: true },
  { key: 'loginAt', label: 'Login Time', visible: true },
  { key: 'logoutAt', label: 'Logout Time / Duration', visible: true },
  { key: 'telemetry', label: 'IP & Device Info', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'actions', label: 'Actions', visible: true, required: true },
];

const LOGIN_LOGS_COL_PREF_KEY = 'qua_login_logs_col_prefs';

function loadColumnPrefs(): ColumnDef[] {
  try {
    const raw = localStorage.getItem(LOGIN_LOGS_COL_PREF_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnDef[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return LOGIN_LOGS_DEFAULT_COLUMNS;
}

// ---------------------------------------------------------------------------
// SortIcon helper
// ---------------------------------------------------------------------------

interface SortIconProps {
  colKey: string;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

function SortIcon({ colKey, sortField, sortOrder }: SortIconProps) {
  if (sortField !== colKey) return <ArrowUpDown size={12} className="ml-1 text-slate-400 opacity-50" />;
  if (sortOrder === 'asc') return <ArrowUp size={12} className="ml-1 text-indigo-500" />;
  return <ArrowDown size={12} className="ml-1 text-indigo-500" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LoginLogsDashboard() {
  const strings = UI_STRINGS.actionCenter.loginLogs;

  // -------------------------------------------------------------------------
  // Data states
  // -------------------------------------------------------------------------
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [summary, setSummary] = useState<LoginLogsSummary>(FALLBACK_SUMMARY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [realtimeActive, setRealtimeActive] = useState<boolean>(true);

  // -------------------------------------------------------------------------
  // Filter states
  // -------------------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUserType, setSelectedUserType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateRangePreset, setDateRangePreset] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // -------------------------------------------------------------------------
  // Sorting states
  // -------------------------------------------------------------------------
  const [sortField, setSortField] = useState<string>('loginAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // -------------------------------------------------------------------------
  // Column settings states
  // -------------------------------------------------------------------------
  const [showColumnSettings, setShowColumnSettings] = useState<boolean>(false);
  const [columns, setColumns] = useState<ColumnDef[]>(() => loadColumnPrefs());

  // -------------------------------------------------------------------------
  // Pagination & modal states
  // -------------------------------------------------------------------------
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedLogForDetails, setSelectedLogForDetails] = useState<LoginLogEntry | null>(null);
  const itemsPerPage = 10;

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const [logsRes, summaryRes] = await Promise.all([
        fetchLoginLogs({
          userType: (selectedUserType !== 'all' ? selectedUserType : undefined) as LoginLogsFilterParams['userType'],
          status: (selectedStatus !== 'all' ? selectedStatus : undefined) as LoginLogsFilterParams['status'],
          search: searchQuery || undefined,
          dateRangePreset: dateRangePreset as LoginLogsFilterParams['dateRangePreset'],
          startDate: dateRangePreset === 'custom' ? customStartDate : undefined,
          endDate: dateRangePreset === 'custom' ? customEndDate : undefined,
          page: 1,
          limit: 100,
        }),
        fetchLoginLogsSummary(),
      ]);

      setLogs(logsRes.logs);
      setSummary(summaryRes);
    } catch {
      // Errors handled gracefully within client
    } finally {
      setIsLoading(false);
      if (showRefreshing) setIsRefreshing(false);
    }
  }, [selectedUserType, selectedStatus, searchQuery, dateRangePreset, customStartDate, customEndDate]);

  // Initial fetch and dependency refresh
  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedLogForDetails) {
          setSelectedLogForDetails(null);
        } else if (showColumnSettings) {
          setShowColumnSettings(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLogForDetails, showColumnSettings]);

  // Real-time polling effect (every 15 seconds when active)
  useEffect(() => {
    if (!realtimeActive) return;
    const interval = setInterval(() => {
      loadData(false);
    }, 15000);

    return () => clearInterval(interval);
  }, [realtimeActive, loadData]);

  // -------------------------------------------------------------------------
  // Filtered + sorted logs
  // -------------------------------------------------------------------------
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // User Type filter
    if (selectedUserType !== 'all') {
      result = result.filter((item) => item.userType === selectedUserType);
    }

    // Status filter
    if (selectedStatus !== 'all') {
      result = result.filter((item) => item.status === selectedStatus);
    }

    // Search query across name, email, company, and phone
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.userName.toLowerCase().includes(q) ||
          item.email.toLowerCase().includes(q) ||
          item.companyName.toLowerCase().includes(q) ||
          item.phoneNumber.toLowerCase().includes(q)
      );
    }

    // Date range filters
    const now = new Date();
    if (dateRangePreset === 'today') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      result = result.filter((item) => new Date(item.loginAt).getTime() >= startOfToday);
    } else if (dateRangePreset === 'yesterday') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
      result = result.filter((item) => {
        const time = new Date(item.loginAt).getTime();
        return time >= startOfYesterday && time < startOfToday;
      });
    } else if (dateRangePreset === 'last7') {
      const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => new Date(item.loginAt).getTime() >= sevenDaysAgo);
    } else if (dateRangePreset === 'last30') {
      const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => new Date(item.loginAt).getTime() >= thirtyDaysAgo);
    } else if (dateRangePreset === 'custom') {
      if (customStartDate) {
        const start = new Date(customStartDate).getTime();
        result = result.filter((item) => new Date(item.loginAt).getTime() >= start);
      }
      if (customEndDate) {
        const end = new Date(customEndDate).getTime() + 24 * 60 * 60 * 1000;
        result = result.filter((item) => new Date(item.loginAt).getTime() <= end);
      }
    }

    // Sorting with tie-breaker
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'loginAt') {
        cmp = new Date(a.loginAt).getTime() - new Date(b.loginAt).getTime();
      } else if (sortField === 'logoutAt') {
        const aTime = a.logoutAt ? new Date(a.logoutAt).getTime() : 0;
        const bTime = b.logoutAt ? new Date(b.logoutAt).getTime() : 0;
        cmp = aTime - bTime;
      } else if (sortField === 'userName') {
        cmp = a.userName.localeCompare(b.userName);
      } else if (sortField === 'companyName') {
        cmp = a.companyName.localeCompare(b.companyName);
      } else if (sortField === 'durationSeconds') {
        cmp = (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
      }
      if (cmp !== 0) {
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return 0;
    });

    return result;
  }, [logs, selectedUserType, selectedStatus, searchQuery, dateRangePreset, customStartDate, customEndDate, sortField, sortOrder]);

  // -------------------------------------------------------------------------
  // Sort handler
  // -------------------------------------------------------------------------
  const handleSort = useCallback((field: string) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortOrder('asc');
      return field;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(start, start + itemsPerPage);
  }, [filteredLogs, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // -------------------------------------------------------------------------
  // Visible columns
  // -------------------------------------------------------------------------
  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  // -------------------------------------------------------------------------
  // CSV Export
  // -------------------------------------------------------------------------
  const handleExportCsv = () => {
    if (filteredLogs.length === 0) return;
    const headers = [
      'ID',
      'User Name',
      'Role',
      'Company Name',
      'Email',
      'Phone Number',
      'Login Time',
      'Logout Time',
      'Duration (Seconds)',
      'Status',
      'IP Address',
      'Device Info',
      'Location',
    ];

    const rows = filteredLogs.map((log) => [
      `"${log.id}"`,
      `"${log.userName.replace(/"/g, '""')}"`,
      `"${log.userType}"`,
      `"${log.companyName.replace(/"/g, '""')}"`,
      `"${log.email}"`,
      `"${log.phoneNumber}"`,
      `"${log.loginAt}"`,
      `"${log.logoutAt || ''}"`,
      `"${log.durationSeconds || 0}"`,
      `"${log.status}"`,
      `"${log.ipAddress || ''}"`,
      `"${(log.deviceInfo || '').replace(/"/g, '""')}"`,
      `"${(log.location || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `login_logs_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // -------------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------------
  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      const time = date.getTime();
      if (isNaN(time) || time <= 86400000) return '—';
      return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '—';
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '—';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  // -------------------------------------------------------------------------
  // Column save helper
  // -------------------------------------------------------------------------
  const saveColumnPrefs = (newCols: ColumnDef[]) => {
    setColumns(newCols);
    try {
      localStorage.setItem(LOGIN_LOGS_COL_PREF_KEY, JSON.stringify(newCols));
    } catch {
      // ignore storage errors
    }
  };

  const resetColumnPrefs = () => {
    setColumns(LOGIN_LOGS_DEFAULT_COLUMNS);
    try {
      localStorage.setItem(LOGIN_LOGS_COL_PREF_KEY, JSON.stringify(LOGIN_LOGS_DEFAULT_COLUMNS));
    } catch {
      // ignore storage errors
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers – per-column header label
  // -------------------------------------------------------------------------
  const colHeaderLabel = (key: string): string => {
    switch (key) {
      case 'user': return strings.table.colUser;
      case 'company': return strings.table.colCompany;
      case 'contact': return strings.table.colContact;
      case 'loginAt': return strings.table.colLoginTime;
      case 'logoutAt': return strings.table.colLogoutTime;
      case 'telemetry': return strings.table.colTelemetry;
      case 'status': return strings.table.colStatus;
      case 'actions': return 'Actions';
      default: return key;
    }
  };

  // Which columns are sortable and their sort key
  const sortableColKey = (key: string): string | null => {
    const map: Record<string, string> = {
      user: 'userName',
      company: 'companyName',
      loginAt: 'loginAt',
      logoutAt: 'logoutAt',
    };
    return map[key] ?? null;
  };

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-3.5 w-full min-w-0 max-w-full">
      {/* Hidden Accessible Banner Text for screen readers and test compliance */}
      <div className="sr-only">
        <h1>{strings.title}</h1>
        <p>{strings.subtitle}</p>
        {summary.todayPeakHour && <span>Peak: {summary.todayPeakHour}</span>}
      </div>

      {/* KPI Stats Grid – ultra-compact Action Center standard */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5 w-full">
        {/* Total Logins Today */}
        <div className="px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-between min-h-[52px] sm:min-h-[58px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight">
              {strings.stats.totalLoginsToday}
            </span>
            <LogIn size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-none">
              {summary.totalToday}
            </span>
          </div>
        </div>

        {/* Active Online Now */}
        <div className="px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-between min-h-[52px] sm:min-h-[58px] bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/60 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight">
              {strings.stats.activeOnlineNow}
            </span>
            <span className="flex h-2 w-2 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          </div>
          <div className="mt-1">
            <span className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none">
              {summary.activeNow}
            </span>
          </div>
        </div>

        {/* Buyer Logins */}
        <div className="px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-between min-h-[52px] sm:min-h-[58px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight">
              {strings.stats.buyerLogins}
            </span>
            <Building2 size={14} className="text-sky-600 dark:text-sky-400 shrink-0" />
          </div>
          <div className="mt-1">
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-none">
              {summary.buyerLogins}
            </span>
          </div>
        </div>

        {/* Seller Logins */}
        <div className="px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-between min-h-[52px] sm:min-h-[58px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight">
              {strings.stats.sellerLogins}
            </span>
            <Truck size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          </div>
          <div className="mt-1">
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-none">
              {summary.sellerLogins}
            </span>
          </div>
        </div>

        {/* Avg Duration */}
        <div className="px-2.5 py-1.5 rounded-lg border text-left flex flex-col justify-between min-h-[52px] sm:min-h-[58px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight">
              {strings.stats.avgSessionDuration}
            </span>
            <Clock size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          </div>
          <div className="mt-1">
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-none">
              {summary.avgDurationMinutes}m
            </span>
          </div>
        </div>
      </div>

      {/* Filter Bar – stable single container with zero horizontal overflow */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 shadow-xs w-full min-w-0 max-w-full box-border space-y-1.5">
        <div className="flex flex-row items-center gap-1 xl:gap-1.5 w-full min-w-0 box-border">
          {/* Search Box (Takes all flexible remaining width, clean left icon padding) */}
          <div className="relative flex-1 min-w-[140px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={strings.filters.searchPlaceholder}
              className="w-full has-leading-icon has-trailing-icon h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* User Type Role Pills */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg shrink-0 h-8">
            {[
              { id: 'all', label: strings.filters.allRoles, activeClass: 'text-slate-900 dark:text-white font-semibold' },
              { id: 'buyer', label: strings.filters.buyersOnly, activeClass: 'text-sky-600 dark:text-sky-400 font-semibold' },
              { id: 'vendor', label: strings.filters.sellersOnly, activeClass: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => {
                  setSelectedUserType(pill.id);
                  setCurrentPage(1);
                }}
                className={`px-2 h-7 text-[11px] font-medium rounded-md transition-all cursor-pointer whitespace-nowrap ${
                  selectedUserType === pill.id
                    ? `bg-white dark:bg-slate-700 ${pill.activeClass} shadow-xs`
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Status Dropdown Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setCurrentPage(1);
            }}
            className="shrink-0 h-8 w-[105px] xl:w-[115px] px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer truncate"
          >
            <option value="all">{strings.filters.allStatuses}</option>
            <option value="ACTIVE">{strings.filters.activeOnly}</option>
            <option value="LOGGED_OUT">{strings.filters.loggedOut}</option>
            <option value="TIMED_OUT">{strings.filters.timedOut}</option>
          </select>

          {/* Live tracking toggle button */}
          <button
            type="button"
            onClick={() => setRealtimeActive(!realtimeActive)}
            className={`shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
              realtimeActive
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
            }`}
            title={realtimeActive ? strings.actions.realtimeActive : strings.actions.realtimePaused}
          >
            <Activity size={13} className={realtimeActive ? 'text-emerald-600 animate-pulse' : 'text-slate-400'} />
            <span className="hidden xl:inline">{realtimeActive ? strings.actions.realtimeActive : strings.actions.realtimePaused}</span>
            <span className="inline xl:hidden">{realtimeActive ? 'Live' : 'Paused'}</span>
          </button>

          {/* Export CSV button */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            title={strings.actions.exportCsv}
            aria-label={strings.actions.exportCsv}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 dark:hover:text-indigo-400 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download size={14} />
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            title={strings.actions.refresh}
            aria-label={strings.actions.refresh}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 dark:hover:text-indigo-400 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-indigo-600' : ''} />
          </button>

          {/* Gear / Column Settings button */}
          <button
            type="button"
            onClick={() => setShowColumnSettings(true)}
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 dark:hover:text-indigo-400 transition-colors cursor-pointer"
            title="Column Settings"
            aria-label="Column Settings"
          >
            <Settings size={14} />
          </button>
        </div>

        {/* Date Wise Filter Row (Buttons) */}
        <div className="flex flex-wrap items-center gap-1 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1">Date Range:</span>
          {[
            { id: 'all', label: strings.filters.dateRangeAll },
            { id: 'today', label: strings.filters.dateRangeToday },
            { id: 'yesterday', label: strings.filters.dateRangeYesterday },
            { id: 'last7', label: strings.filters.dateRangeLast7Days },
            { id: 'last30', label: strings.filters.dateRangeLast30Days },
            { id: 'custom', label: strings.filters.dateRangeCustom },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setDateRangePreset(preset.id);
                setCurrentPage(1);
              }}
              className={`px-2 py-0.5 text-[11px] rounded-md border transition-all cursor-pointer whitespace-nowrap ${
                dateRangePreset === preset.id
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 font-semibold'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}

          {/* Custom Date Inputs */}
          {dateRangePreset === 'custom' && (
            <div className="flex items-center gap-1 ml-auto">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-1.5 py-0.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200"
                aria-label={strings.filters.startDate}
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setCustomEndDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-1.5 py-0.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200"
                aria-label={strings.filters.endDate}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs w-full min-w-0 max-w-full">
        <div className="overflow-x-auto scrollbar-thin w-full min-w-0">
          <table className="w-full text-left border-collapse text-xs min-w-[920px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 font-semibold text-slate-700 dark:text-slate-300">
                {visibleColumns.map((col) => {
                  const sk = sortableColKey(col.key);
                  const widthClass =
                    col.key === 'user'
                      ? 'w-[160px] min-w-[140px]'
                      : col.key === 'company'
                      ? 'w-[170px] min-w-[150px]'
                      : col.key === 'contact'
                      ? 'w-[180px] min-w-[160px]'
                      : col.key === 'loginAt'
                      ? 'w-[140px] min-w-[130px]'
                      : col.key === 'logoutAt'
                      ? 'w-[140px] min-w-[130px]'
                      : col.key === 'telemetry'
                      ? 'w-[160px] min-w-[140px]'
                      : col.key === 'status'
                      ? 'w-[100px] min-w-[90px]'
                      : col.key === 'actions'
                      ? 'w-[90px] min-w-[80px] text-right'
                      : '';
                  return (
                    <th
                      key={col.key}
                      className={`py-2.5 px-3 ${widthClass} ${sk ? 'cursor-pointer select-none hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors' : ''}`}
                      onClick={sk ? () => handleSort(sk) : undefined}
                    >
                      <span className="inline-flex items-center">
                        {colHeaderLabel(col.key)}
                        {sk && <SortIcon colKey={sk} sortField={sortField} sortOrder={sortOrder} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-12 text-center text-slate-400">
                    <RefreshCw className="animate-spin inline-block mr-2" size={18} />
                    Loading session logs...
                  </td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    <ShieldCheck className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    {strings.table.emptyState}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => {
                  const isBuyer = log.userType === 'buyer';
                  const isActive = log.status === 'ACTIVE';

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLogForDetails(log)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      {visibleColumns.map((col) => {
                        switch (col.key) {
                          case 'user':
                            return (
                              <td key="user" className="py-2.5 px-3">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[155px]" title={log.userName}>{log.userName}</div>
                                <span
                                  className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    isBuyer
                                      ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800/50'
                                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
                                  }`}
                                >
                                  {isBuyer ? 'Buyer' : 'Seller / Vendor'}
                                </span>
                              </td>
                            );
                          case 'company':
                            return (
                              <td key="company" className="py-2.5 px-3 text-slate-800 dark:text-slate-200 font-medium">
                                <div className="truncate max-w-[165px]" title={log.companyName}>{log.companyName}</div>
                              </td>
                            );
                          case 'contact':
                            return (
                              <td key="contact" className="py-2.5 px-3 space-y-0.5">
                                <div className="text-slate-900 dark:text-slate-100 font-mono text-[11px] truncate max-w-[175px]" title={log.email}>{log.email}</div>
                                <div className="text-slate-500 dark:text-slate-400 text-[11px] font-mono truncate max-w-[175px]" title={log.phoneNumber}>{log.phoneNumber}</div>
                              </td>
                            );
                          case 'loginAt':
                            return (
                              <td key="loginAt" className="py-2.5 px-3 whitespace-nowrap">
                                <div className="text-slate-900 dark:text-slate-100 font-medium">{formatDateTime(log.loginAt)}</div>
                              </td>
                            );
                          case 'logoutAt':
                            return (
                              <td key="logoutAt" className="py-2.5 px-3 whitespace-nowrap">
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    {strings.table.inProgress}
                                  </span>
                                ) : (
                                  <div>
                                    <div className="text-slate-800 dark:text-slate-200">{formatDateTime(log.logoutAt)}</div>
                                    <div className="text-slate-400 dark:text-slate-500 text-[10px]">
                                      Duration: {formatDuration(log.durationSeconds)}
                                    </div>
                                  </div>
                                )}
                              </td>
                            );
                          case 'telemetry':
                            return (
                              <td key="telemetry" className="py-2.5 px-3 space-y-0.5">
                                <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                                  <Globe size={11} className="text-slate-400 shrink-0" />
                                  <span className="truncate max-w-[145px]" title={log.ipAddress || '—'}>{log.ipAddress || '—'}</span>
                                </div>
                                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-[10px]">
                                  <Laptop size={11} className="text-slate-400 shrink-0" />
                                  <span className="truncate max-w-[145px]" title={log.deviceInfo || 'Desktop'}>{log.deviceInfo || 'Desktop'}</span>
                                </div>
                              </td>
                            );
                          case 'status':
                            return (
                              <td key="status" className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    isActive
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                                      : log.status === 'TIMED_OUT'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                  }`}
                                >
                                  {isActive
                                    ? strings.filters.activeOnly
                                    : log.status === 'TIMED_OUT'
                                    ? strings.filters.timedOut
                                    : strings.filters.loggedOut}
                                </span>
                              </td>
                            );
                          case 'actions':
                            return (
                              <td key="actions" className="py-2.5 px-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLogForDetails(log);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                                >
                                  <ExternalLink size={12} />
                                  <span>{strings.actions.viewDetails}</span>
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

        {/* Table Footer with Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <div>
            Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{paginatedLogs.length}</span> of{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{filteredLogs.length}</span> records
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 cursor-pointer"
              aria-label="Previous Page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 cursor-pointer"
              aria-label="Next Page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Session Details Modal */}
      {selectedLogForDetails && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setSelectedLogForDetails(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl relative animate-in fade-in zoom-in-95 duration-150"
          >
            <button
              type="button"
              onClick={() => setSelectedLogForDetails(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={strings.actions.closeDetails}
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="text-indigo-600 dark:text-indigo-400" size={22} />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{strings.details.title}</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                  {selectedLogForDetails.userName}
                </div>
                <div className="text-slate-600 dark:text-slate-300">{selectedLogForDetails.companyName}</div>
                <div className="font-mono text-indigo-600 dark:text-indigo-400 text-[11px]">
                  {selectedLogForDetails.email} • {selectedLogForDetails.phoneNumber}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.userRole}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 capitalize">
                    {selectedLogForDetails.userType === 'buyer' ? 'Buyer Account' : 'Seller / Vendor'}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.table.colStatus}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.status}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.loginTimestamp}</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatDateTime(selectedLogForDetails.loginAt)}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.logoutTimestamp}</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatDateTime(selectedLogForDetails.logoutAt)}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.networkIp}</div>
                  <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.ipAddress || '127.0.0.1'}
                  </div>
                </div>

                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.geoCity}</div>
                  <div className="text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedLogForDetails.location || 'India (National)'}
                  </div>
                </div>
              </div>

              {selectedLogForDetails.userAgent && (
                <div className="border border-slate-100 dark:border-slate-800 p-2.5 rounded-lg">
                  <div className="text-slate-400 text-[10px] uppercase font-semibold">{strings.details.clientUserAgent}</div>
                  <div className="font-mono text-[10px] text-slate-600 dark:text-slate-400 break-all mt-1">
                    {selectedLogForDetails.userAgent}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLogForDetails(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-opacity cursor-pointer"
              >
                {strings.actions.closeDetails}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Column Settings Popup */}
      <ColumnSettingsPopup
        isOpen={showColumnSettings}
        onClose={() => setShowColumnSettings(false)}
        columns={columns}
        onSave={saveColumnPrefs}
        onReset={resetColumnPrefs}
        title="Login Logs Columns"
      />
    </div>
  );
}
