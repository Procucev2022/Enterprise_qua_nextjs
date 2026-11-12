'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Globe,
  MessageSquare,
  Mail,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
  Users,
  RefreshCw,
  X,
  Settings,
  GripVertical,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import ActionCenterSummaryPopupModal from './ActionCenterSummaryPopupModal';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RegisteredClient, ActionCenterSummaryPopupColumn, RegistrationColumnConfig, RegistrationColumnKey } from '@/lib/types';
import { REGISTRATION_CLIENT_TYPES, REGISTRATION_COLUMN_PREF_KEY, DEFAULT_REGISTRATION_COLUMNS } from '@/lib/constants';
import { authClient } from '@/lib/authClient';

export interface RegistrationsDashboardProps {
  onTotalCountChange?: (count: number) => void;
}

export default function RegistrationsDashboard({ onTotalCountChange }: RegistrationsDashboardProps) {
  const strings = UI_STRINGS.actionCenter.registrationsDashboard;

  const [clients, setClients] = useState<RegisteredClient[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Filters & Search
  const [search, setSearch] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('');
  const [clientType, setClientType] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Column Reordering & Visibility state
  const [columns, setColumns] = useState<RegistrationColumnConfig[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(REGISTRATION_COLUMN_PREF_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // fallback
      }
    }
    return DEFAULT_REGISTRATION_COLUMNS;
  });

  const [showColumnSettings, setShowColumnSettings] = useState<boolean>(false);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  const [sortField, setSortField] = useState<RegistrationColumnKey>('regDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: RegistrationColumnKey) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedClients = useMemo(() => {
    if (!clients.length) return [];
    return [...clients].sort((a, b) => {
      const valA = a[sortField as keyof RegisteredClient];
      const valB = b[sortField as keyof RegisteredClient];
      if (sortField === 'regDate') {
        const timeA = new Date(a.regDate || 0).getTime();
        const timeB = new Date(b.regDate || 0).getTime();
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      }
      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB);
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [clients, sortField, sortOrder]);

  const saveColumns = useCallback((newCols: RegistrationColumnConfig[]) => {
    setColumns(newCols);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(REGISTRATION_COLUMN_PREF_KEY, JSON.stringify(newCols));
      } catch {
        // ignore
      }
    }
  }, []);

  const handleToggleColumn = (key: RegistrationColumnKey) => {
    const updated = columns.map((col) => {
      if (col.key === key && !col.required) {
        return { ...col, visible: !col.visible };
      }
      return col;
    });
    saveColumns(updated);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === targetIndex) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(draggedColIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDraggedColIndex(null);
    saveColumns(reordered);
  };

  const handleResetColumns = () => {
    saveColumns(DEFAULT_REGISTRATION_COLUMNS);
  };

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);


  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Action loading states
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Summary counts for KPI cards
  const [summaryCounts, setSummaryCounts] = useState<{
    total: number;
    webApp: number;
    whatsApp: number;
    email: number;
  }>({ total: 0, webApp: 0, whatsApp: 0, email: 0 });

  // Summary popup modal state
  const [summaryModalState, setSummaryModalState] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    totalCount: number;
    records: RegisteredClient[];
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    totalCount: 0,
    records: [],
  });

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (sourceType && sourceType !== 'all') params.append('sourceType', sourceType);
      if (clientType && clientType !== 'all') params.append('clientType', clientType);
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter);
      params.append('limit', String(pageSize));
      params.append('offset', String((currentPage - 1) * pageSize));

      const token = authClient.getToken();
      const res = await fetch(`/api/internal-tasks/registrations?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setClients(json.data);
        setTotalCount(json.total ?? json.data.length);
        if ((!sourceType || sourceType === 'all') && !search.trim()) {
          const tally = { total: json.total ?? json.data.length, webApp: 0, whatsApp: 0, email: 0 };
          json.data.forEach((c: RegisteredClient) => {
            const s = String(c.sourceType || '').toLowerCase();
            if (s.includes('web')) tally.webApp++;
            else if (s.includes('whatsapp')) tally.whatsApp++;
            else if (s.includes('email')) tally.email++;
          });
          setSummaryCounts(tally);
        }
        if (onTotalCountChange) onTotalCountChange(json.total ?? json.data.length);
      } else {
        setError(json.error || strings.noClientsFound);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : strings.actionError;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [search, sourceType, clientType, statusFilter, currentPage, pageSize, onTotalCountChange, strings.noClientsFound, strings.actionError]);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

  const handleAction = async (id: string, action: 'accept' | 'reject') => {
    setProcessingId(id);
    setActionFeedback(null);
    try {
      const token = authClient.getToken();
      const res = await fetch(`/api/internal-tasks/registrations/${encodeURIComponent(id)}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.success) {
        setClients((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: action === 'accept' ? 'Accepted' : 'Rejected',
                  isApproved: action === 'accept',
                }
              : c
          )
        );
        setActionFeedback({
          message: action === 'accept' ? strings.acceptSuccess : strings.rejectSuccess,
          type: 'success',
        });
      } else {
        setActionFeedback({ message: json.error || strings.actionError, type: 'error' });
      }
    } catch {
      setActionFeedback({ message: strings.actionError, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const formatDate = (isoString?: string): string => {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return isoString;
    }
  };

  const registrationPopupColumns = useMemo<ActionCenterSummaryPopupColumn<RegisteredClient>[]>(() => [
    {
      key: 'userName',
      label: strings.colUserName,
      render: (c) => <span className="font-semibold text-slate-900 dark:text-white">{c.userName}</span>,
    },
    {
      key: 'companyName',
      label: strings.colCompanyName,
      render: (c) => <span>{c.companyName}</span>,
    },
    {
      key: 'phoneNumber',
      label: strings.colPhoneNumber,
      render: (c) => <span className="font-mono text-[11px]">{c.phoneNumber || '–'}</span>,
    },
    {
      key: 'userEmail',
      label: strings.colUserEmail,
      render: (c) => <span className="font-mono text-[11px]">{c.userEmail}</span>,
    },
    {
      key: 'regDate',
      label: strings.colRegDate,
      render: (c) => <span>{formatDate(c.regDate)}</span>,
    },
    {
      key: 'status',
      label: strings.colStatus,
      render: (c) => (
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
            c.status === 'Accepted'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : c.status === 'Rejected'
              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          {c.status}
        </span>
      ),
    },
    {
      key: 'sourceType',
      label: strings.colSourceType,
      render: (c) => (
        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {c.sourceType}
        </span>
      ),
    },
  ], [strings]);

  const handleCardKeyDown = (e: React.KeyboardEvent, type: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSummaryCardClick(type);
    }
  };

  const handleSummaryCardClick = (type: string) => {
    setSourceType(type);
    setCurrentPage(1);

    const titleMap: Record<string, string> = {
      all: strings.kpiTotalClients,
      'Web App': strings.webApp,
      WhatsApp: strings.whatsapp,
      Email: strings.email,
    };

    const matchingClients = clients.filter((c) => {
      if (type === 'all') return true;
      const s = String(c.sourceType || '').toLowerCase();
      const t = type.toLowerCase();
      return s.includes(t) || c.sourceType === type;
    });

    setSummaryModalState({
      isOpen: true,
      title: titleMap[type] || type,
      subtitle: type === 'all' ? strings.title : `${type} ${strings.title}`,
      totalCount: matchingClients.length,
      records: matchingClients,
    });
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / pageSize)), [totalCount, pageSize]);

  return (
    <div className="w-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-5 space-y-3.5">
      {/* 4 Dynamic Compact Summary Cards (1 Horizontal Row at Top of Section) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full">
        {/* Total Registered Clients */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleSummaryCardClick('all')}
          onKeyDown={(e) => handleCardKeyDown(e, 'all')}
          className="bg-white dark:bg-slate-900 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-orange-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition cursor-pointer flex flex-col justify-between text-left h-full"
        >
          <div className="flex items-center justify-between gap-1 w-full">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-tight whitespace-nowrap">
              {strings.kpiTotalClients}
            </span>
            <Users className="w-3.5 h-3.5 text-orange-500 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 w-full">
            <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-none">
              {summaryCounts.total || totalCount}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Total clients
            </span>
          </div>
        </div>

        {/* Web App */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleSummaryCardClick('Web App')}
          onKeyDown={(e) => handleCardKeyDown(e, 'Web App')}
          className="bg-white dark:bg-slate-900 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-sky-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition cursor-pointer flex flex-col justify-between text-left h-full"
        >
          <div className="flex items-center justify-between gap-1 w-full">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-tight whitespace-nowrap">
              {strings.kpiWebApp}
            </span>
            <Globe className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 w-full">
            <span className="text-base sm:text-lg font-bold text-sky-600 dark:text-sky-400 leading-none">
              {summaryCounts.webApp} clients
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Web Portal
            </span>
          </div>
        </div>

        {/* WhatsApp */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleSummaryCardClick('WhatsApp')}
          onKeyDown={(e) => handleCardKeyDown(e, 'WhatsApp')}
          className="bg-white dark:bg-slate-900 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-emerald-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition cursor-pointer flex flex-col justify-between text-left h-full"
        >
          <div className="flex items-center justify-between gap-1 w-full">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-tight whitespace-nowrap">
              {strings.kpiWhatsApp}
            </span>
            <MessageSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 w-full">
            <span className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none">
              {summaryCounts.whatsApp} clients
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              WhatsApp bot
            </span>
          </div>
        </div>

        {/* Email */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleSummaryCardClick('Email')}
          onKeyDown={(e) => handleCardKeyDown(e, 'Email')}
          className="bg-white dark:bg-slate-900 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-indigo-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition cursor-pointer flex flex-col justify-between text-left h-full"
        >
          <div className="flex items-center justify-between gap-1 w-full">
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-tight whitespace-nowrap">
              {strings.kpiEmail}
            </span>
            <Mail className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 w-full">
            <span className="text-base sm:text-lg font-bold text-indigo-600 dark:text-indigo-400 leading-none">
              {summaryCounts.email} clients
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
              Email gateway
            </span>
          </div>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
          }`}
        >
          <span>{actionFeedback.message}</span>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Unified Horizontal Toolbar: Search Bar + Client View Filter + Source Type Filter + Status Filter + Refresh + Column Settings */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 shadow-xs flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 w-full min-w-0 max-w-full box-border">
        {/* Search field: flexible width with non-overlapping icon and clear button */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={strings.searchPlaceholder}
            aria-label={strings.searchPlaceholder}
            className="w-full has-leading-icon has-trailing-icon py-1.5 h-9 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCurrentPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Independent Filters + Action Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          {/* Client View Filter Dropdown */}
          <select
            id="client-type-select"
            value={clientType}
            onChange={(e) => {
              setClientType(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={strings.clientTypeLabel}
            className="h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer shrink-0 min-w-[175px]"
          >
            {REGISTRATION_CLIENT_TYPES.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.label}
              </option>
            ))}
          </select>

          {/* Source Type Filter Dropdown */}
          <select
            id="source-type-select"
            value={sourceType}
            onChange={(e) => {
              setSourceType(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={strings.sourceTypeLabel}
            className="h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer shrink-0 min-w-[130px]"
          >
            <option value="" disabled hidden>
              {strings.sourceTypePlaceholder}
            </option>
            <option value="all">{strings.allSources}</option>
            <option value="Web App">{strings.webApp}</option>
            <option value="WhatsApp">{strings.whatsapp}</option>
            <option value="Email">{strings.email}</option>
          </select>

          {/* Status Filter Dropdown */}
          <select
            id="registration-status-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={strings.colStatus}
            className="h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer shrink-0 min-w-[125px]"
          >
            <option value="all">{strings.allStatuses}</option>
            <option value="New">{strings.statusNew}</option>
            <option value="Accepted">{strings.statusAccepted}</option>
            <option value="Rejected">{strings.statusRejected}</option>
          </select>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchRegistrations()}
            title={strings.refreshTooltip}
            aria-label={strings.refreshTooltip}
            className="p-2 h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Column Settings Gear Button */}
          <button
            type="button"
            onClick={() => setShowColumnSettings(true)}
            title={strings.columnSettingsTooltip}
            aria-label={strings.columnSettingsTooltip}
            className="p-2 h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Column Customization Modal */}
      {showColumnSettings && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={strings.columnSettingsTitle}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{strings.columnSettingsTitle}</h3>
                  <p className="text-[11px] text-slate-500">{strings.columnSettingsSubtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowColumnSettings(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close column settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-1 divide-y divide-slate-100 dark:divide-slate-800/60 flex-1">
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, idx)}
                  className="flex items-center justify-between py-2 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors cursor-move group"
                >
                  <div className="flex items-center gap-2.5">
                    <GripVertical className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 shrink-0" />
                    <input
                      type="checkbox"
                      id={`col-toggle-${col.key}`}
                      checked={col.visible}
                      disabled={col.required}
                      onChange={() => handleToggleColumn(col.key)}
                      className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 cursor-pointer disabled:opacity-50"
                    />
                    <label
                      htmlFor={`col-toggle-${col.key}`}
                      className="text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer select-none"
                    >
                      {col.label}
                      {col.required && <span className="ml-1 text-[10px] text-slate-400">({strings.lockedBadge})</span>}
                    </label>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <button
                type="button"
                onClick={handleResetColumns}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{strings.resetToDefault}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowColumnSettings(false)}
                className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                {strings.doneBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
              {visibleColumns.map((col) => {
                const isSortable = col.key !== 'actions';
                const isSorted = sortField === col.key;
                return (
                  <th
                    key={col.key}
                    className={`py-3 px-3.5 whitespace-nowrap ${col.key === 'actions' ? 'text-center' : ''}`}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="inline-flex items-center gap-1 font-bold hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer"
                        data-testid={`sort-col-${col.key}`}
                      >
                        <span>{col.label}</span>
                        {isSorted ? (
                          sortOrder === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
            {loading ? (
              <tr>
                <td colSpan={visibleColumns.length} className="py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    <span>{strings.loadingClients}</span>
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={visibleColumns.length} className="py-12 text-center text-rose-500 font-semibold">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="w-6 h-6" />
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="py-12 text-center text-slate-400 font-semibold">
                  {strings.noClientsFound}
                </td>
              </tr>
            ) : (
              sortedClients.map((client, index) => {
                // Alternating peach and soft blue stripes matching reference image
                const isEven = index % 2 === 0;
                const rowBg = isEven
                  ? 'bg-[#fff5ee] dark:bg-slate-800/40' // Soft seashell/apricot tint
                  : 'bg-[#f0f7ff] dark:bg-slate-800/70'; // Soft sky blue tint

                const isSeller = client.clientType === 'Seller';
                const isNew = !isSeller && (client.status === 'New' || client.status === 'Pending');
                const isAccepted = isSeller || client.status === 'Accepted';

                return (
                  <tr
                    key={client.id}
                    className={`${rowBg} hover:opacity-90 transition-opacity text-slate-800 dark:text-slate-200`}
                  >
                    {visibleColumns.map((col) => {
                      if (col.key === 'userName') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 font-semibold text-slate-900 dark:text-white max-w-[150px] truncate" title={client.userName}>
                            {client.userName}
                          </td>
                        );
                      }
                      if (col.key === 'clientType') {
                        const isSeller = client.clientType === 'Seller';
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 whitespace-nowrap">
                            {isSeller ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                {strings.sellers}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                {strings.buyers}
                              </span>
                            )}
                          </td>
                        );
                      }
                      if (col.key === 'companyName') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 font-semibold text-slate-700 dark:text-slate-300 max-w-[180px] truncate" title={client.companyName}>
                            {client.companyName}
                          </td>
                        );
                      }
                      if (col.key === 'phoneNumber') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {client.phoneNumber}
                          </td>
                        );
                      }
                      if (col.key === 'userEmail') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 text-slate-600 dark:text-slate-400 max-w-[180px] truncate" title={client.userEmail}>
                            {client.userEmail}
                          </td>
                        );
                      }
                      if (col.key === 'regDate') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {formatDate(client.regDate)}
                          </td>
                        );
                      }
                      if (col.key === 'status') {
                        const isRejected = client.status === 'Rejected';
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`font-semibold ${
                                isRejected
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : isSeller
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : isAccepted
                                  ? 'text-indigo-600 dark:text-indigo-400'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {isSeller && !isRejected ? strings.statusAutoApproved : client.status}
                            </span>
                          </td>
                        );
                      }
                      if (col.key === 'sourceType') {
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 font-medium">
                              {client.sourceType === 'WhatsApp' ? (
                                <MessageSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                              ) : client.sourceType === 'Email' ? (
                                <Mail className="w-4 h-4 text-sky-500 shrink-0" />
                              ) : (
                                <Globe className="w-4 h-4 text-sky-600 shrink-0" />
                              )}
                              <span className="text-slate-700 dark:text-slate-300">{client.sourceType}</span>
                            </div>
                          </td>
                        );
                      }
                      if (col.key === 'actions') {
                        if (isSeller) {
                          return (
                            <td key={col.key} className="py-2.5 px-3.5 text-center whitespace-nowrap">
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                                {strings.statusAutoApproved}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className="py-2.5 px-3.5 text-center whitespace-nowrap">
                            {isNew ? (
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleAction(client.id, 'accept')}
                                  disabled={processingId === client.id}
                                  title={strings.acceptTooltip}
                                  aria-label={`${strings.acceptTooltip} for ${client.userName}`}
                                  className="p-1 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors disabled:opacity-40 cursor-pointer"
                                >
                                  <CheckCircle className="w-5 h-5 fill-emerald-600 text-white" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAction(client.id, 'reject')}
                                  disabled={processingId === client.id}
                                  title={strings.rejectTooltip}
                                  aria-label={`${strings.rejectTooltip} for ${client.userName}`}
                                  className="p-1 rounded-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors disabled:opacity-40 cursor-pointer"
                                >
                                  <XCircle className="w-5 h-5 fill-rose-600 text-white" />
                                </button>
                              </div>
                            ) : isAccepted ? (
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40">
                                {strings.statusAccepted}
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40">
                                {strings.statusRejected}
                              </span>
                            )}
                          </td>
                        );
                      }
                      return null;
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-center gap-3 pt-2 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage <= 1 || loading}
            aria-label="First page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronsLeft className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1 || loading}
            aria-label="Previous page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <span className="px-3 py-1 font-semibold text-slate-700 dark:text-slate-300">
            {currentPage}
          </span>

          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages || loading}
            aria-label="Next page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage >= totalPages || loading}
            aria-label="Last page"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>

        {/* Page Size Dropdown */}
        <div className="flex items-center gap-1.5 ml-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            aria-label="Select page size"
            className="h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold cursor-pointer text-xs"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>
    
      {/* Dynamic Summary Card Records Popup Modal */}
      <ActionCenterSummaryPopupModal
        isOpen={summaryModalState.isOpen}
        onClose={() => setSummaryModalState((prev) => ({ ...prev, isOpen: false }))}
        title={summaryModalState.title}
        subtitle={summaryModalState.subtitle}
        totalCount={summaryModalState.totalCount}
        columns={registrationPopupColumns}
        records={summaryModalState.records}
      />
</div>
  );
}

