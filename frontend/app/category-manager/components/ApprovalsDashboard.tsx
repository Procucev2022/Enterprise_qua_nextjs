'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Search,
  RefreshCw,
  FileCheck,
  Check,
  X,
  Settings,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Download,
  FileText,
  Calendar,
  User,
  Building2,
  Coins,
  History,
  Lock,
} from 'lucide-react';
import {
  fetchApprovalSummary,
  fetchApprovals,
  processApprovalAction,
} from '@/lib/approvalClient';
import { authClient } from '@/lib/authClient';
import type {
  ApprovalRequest,
  ApprovalSummary,
  ApprovalTableColumnConfig,
  ApprovalTableColumnKey,
  ApprovalTabKey,
  ActionCenterSummaryPopupColumn,
} from '@/lib/types';
import { APPROVAL_REQUEST_TYPES, DEFAULT_APPROVAL_COLUMNS } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import ActionCenterSummaryPopupModal from './ActionCenterSummaryPopupModal';

const STORAGE_PREFS_KEY_PREFIX = 'procucev_approval_col_prefs_';

const getUserStorageKey = (user: { id?: string; email?: string } | null | undefined): string => {
  return `${STORAGE_PREFS_KEY_PREFIX}${user?.id || user?.email || 'default'}`;
};

export function ApprovalsDashboard() {
  const strings = UI_STRINGS.actionCenter.approvals;

  // Primary Data State
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [total, setTotal] = useState<number>(0);
  // Null until the summary loads. Cards show a dash in that state, never a zero.
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filter State
  const [isMyApprovalsActive, setIsMyApprovalsActive] = useState<boolean>(false);

  // Toolbar Filters State. The project filter is free text, sent as the `project` query value.
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [requestTypeFilter, setRequestTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Sorting & Pagination State
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Column Customization State
  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState<boolean>(false);
  const [columns, setColumns] = useState<ApprovalTableColumnConfig[]>(DEFAULT_APPROVAL_COLUMNS);

  // Details Modal State
  const [detailsRequest, setDetailsRequest] = useState<ApprovalRequest | null>(null);

  // Approve / Reject Confirmation Modal State
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [actionRemarks, setActionRemarks] = useState<string>('');
  // Blank until the user picks the approver, or until a request supplies its stored approver.
  const [actionApprover, setActionApprover] = useState<string>('');
  const [actionPassword, setActionPassword] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Summary Card Modal State
  const [summaryModalState, setSummaryModalState] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    totalCount: number;
    records: ApprovalRequest[];
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    totalCount: 0,
    records: [],
  });

  // Current session user
  const sessionUser = useMemo(() => authClient.getSessionUser(), []);

  // Show Toast Helper
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Close Action Modal
  const handleCloseActionModal = useCallback(() => {
    setSelectedRequest(null);
    setPendingAction(null);
    setActionRemarks('');
    setActionPassword('');
    setPasswordError('');
    setActionApprover('');
  }, []);

  // Open Action Modal
  const openActionModal = useCallback((req: ApprovalRequest, action: 'APPROVE' | 'REJECT') => {
    setSelectedRequest(req);
    setPendingAction(action);
    setActionRemarks('');
    setActionPassword('');
    setPasswordError('');
    setActionApprover(req.assigned_approver || '');
  }, []);

  // Restore column preferences from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const userKey = getUserStorageKey(sessionUser);
      const stored = localStorage.getItem(userKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ApprovalTableColumnConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setColumns(parsed);
        }
      }
    } catch {
      // Use defaults if parse fails
    }
  }, [sessionUser]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedRequest && pendingAction) {
          handleCloseActionModal();
        } else if (detailsRequest) {
          setDetailsRequest(null);
        } else if (isColumnSettingsOpen) {
          setIsColumnSettingsOpen(false);
        } else if (summaryModalState.isOpen) {
          setSummaryModalState((prev) => ({ ...prev, isOpen: false }));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRequest, pendingAction, detailsRequest, isColumnSettingsOpen, summaryModalState.isOpen, handleCloseActionModal]);

  // Load summary statistics. A failed load leaves the figures unset and shows the error.
  const loadSummary = useCallback(async () => {
    try {
      const result = await fetchApprovalSummary();
      setSummary(result.summary);
      setSummaryError(result.error ?? null);
    } catch {
      setSummary(null);
      setSummaryError(
        formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvalSummary })
      );
    }
  }, []);

  // Determine effective status filter and approver filter
  const effectiveStatus = useMemo(() => {
    return statusFilter;
  }, [statusFilter]);

  const effectiveApprover = useMemo(() => {
    if (isMyApprovalsActive) {
      return sessionUser?.name || sessionUser?.email || '';
    }
    return '';
  }, [isMyApprovalsActive, sessionUser]);

  // Handle Quick "My Approvals" toggle
  const handleToggleMyApprovals = useCallback(() => {
    setIsMyApprovalsActive((prev) => !prev);
    setCurrentPage(1);
  }, []);

  // Load approvals list. A failed load clears the rows and shows the error in the table.
  const loadApprovals = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (currentPage - 1) * pageSize;
      const res = await fetchApprovals({
        module: requestTypeFilter === 'all' ? undefined : requestTypeFilter,
        status: effectiveStatus === 'all' ? undefined : effectiveStatus,
        project: projectFilter.trim() ? projectFilter.trim() : undefined,
        search: search.trim() ? search.trim() : undefined,
        assigned_approver: effectiveApprover || undefined,
        limit: pageSize,
        offset,
        sortBy: sortField,
        sortOrder,
      });
      setApprovals(res.data);
      setTotal(res.total);
      setListError(res.error ?? null);
    } catch {
      setApprovals([]);
      setTotal(0);
      setListError(
        formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvals })
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    currentPage,
    pageSize,
    requestTypeFilter,
    effectiveStatus,
    projectFilter,
    search,
    effectiveApprover,
    sortField,
    sortOrder,
  ]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  // Handle Summary Card Click
  const handleCardClick = useCallback(async (cardType: 'total' | 'pending' | 'approved' | 'rejected') => {
    let title = strings.total;
    let targetStatus = 'all';

    if (cardType === 'pending') {
      targetStatus = 'Pending';
      title = strings.pending;
      setStatusFilter('Pending');
      setIsMyApprovalsActive(false);
    } else if (cardType === 'approved') {
      targetStatus = 'Approved';
      title = strings.approved;
      setStatusFilter('Approved');
      setIsMyApprovalsActive(false);
    } else if (cardType === 'rejected') {
      targetStatus = 'Rejected';
      title = strings.rejected;
      setStatusFilter('Rejected');
      setIsMyApprovalsActive(false);
    } else {
      setStatusFilter('all');
      setIsMyApprovalsActive(false);
    }
    setCurrentPage(1);

    // Open matching modal with filtered records. A failed load shows the reason and opens nothing.
    try {
      const res = await fetchApprovals({
        status: targetStatus === 'all' ? undefined : targetStatus,
        limit: 100,
      });
      if (res.error) {
        showToast(res.error);
        return;
      }
      setSummaryModalState({
        isOpen: true,
        title: `${strings.summaryModalTitlePrefix}${title}`,
        subtitle: formatString(strings.summaryModalSubtitle, {
          count: res.total,
          filter: title,
        }),
        totalCount: res.total,
        records: res.data,
      });
    } catch {
      showToast(
        formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvals })
      );
    }
  }, [strings, showToast]);

  // Handle Keyboard Navigation on Summary Cards
  const handleKeyDownCard = (e: React.KeyboardEvent, cardType: 'total' | 'pending' | 'approved' | 'rejected') => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void handleCardClick(cardType);
    }
  };

  // Handle Action Confirmation (Approve / Reject)
  const handleActionConfirm = async () => {
    if (!selectedRequest || !pendingAction) return;

    if (!actionApprover.trim()) {
      setPasswordError(strings.approverRequired);
      return;
    }

    if (!actionPassword.trim()) {
      setPasswordError(strings.passwordRequiredError);
      return;
    }
    setPasswordError('');

    setIsProcessing(true);
    const res = await processApprovalAction(
      selectedRequest.id,
      pendingAction,
      actionRemarks,
      actionPassword,
      actionApprover.trim()
    );
    setIsProcessing(false);

    if (res.success) {
      const finalStatus = pendingAction === 'APPROVE' ? 'Approved' : 'Rejected';
      showToast(
        `Request ${selectedRequest.request_number} marked as ${finalStatus}.`
      );
      // Immediately reflect database confirmed status in local state
      setApprovals((prev) =>
        prev.map((item) =>
          item.id === selectedRequest.id
            ? {
                ...item,
                status: finalStatus,
                approver_name: actionApprover,
                approver_remarks: actionRemarks,
              }
            : item
        )
      );
      handleCloseActionModal();
      if (detailsRequest?.id === selectedRequest.id) {
        setDetailsRequest((prev) =>
          prev
            ? {
                ...prev,
                status: finalStatus,
                approver_name: actionApprover,
                approver_remarks: actionRemarks,
              }
            : null
        );
      }
      void loadSummary();
      void loadApprovals();
    } else {
      setPasswordError(res.error || strings.invalidPasswordError);
      showToast(res.error || strings.databaseSyncError);
    }
  };

  // Sort Header Handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Column Preference Handlers
  const handleToggleColumn = (key: ApprovalTableColumnKey) => {
    setColumns((prev) =>
      prev.map((col) => (col.key === key && !col.locked ? { ...col, visible: !col.visible } : col))
    );
  };

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    setColumns((prev) => {
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[nextIndex];
      updated[nextIndex] = temp;
      return updated.map((col, idx) => ({ ...col, order: idx + 1 }));
    });
  };

  const handleResetColumns = () => {
    setColumns(DEFAULT_APPROVAL_COLUMNS);
    const userKey = getUserStorageKey(sessionUser);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(userKey);
    }
    showToast(strings.resetToDefault);
  };

  const handleSaveColumns = () => {
    const userKey = getUserStorageKey(sessionUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem(userKey, JSON.stringify(columns));
    }
    setIsColumnSettingsOpen(false);
    showToast(strings.columnSettingsSaved);
  };

  // Export Filtered Records to CSV
  const handleExportCsv = () => {
    if (approvals.length === 0) {
      showToast(strings.noApprovalsFound);
      return;
    }

    const headers = [
      'Request ID',
      'Request Type',
      'Requested By',
      'Maker Role',
      'Project / Account',
      'Applicant Email',
      'Value / Impact',
      'Request Date',
      'Assigned Approver',
      'Status',
      'Approver Remarks',
    ];

    const csvRows = [headers.join(',')];

    for (const req of approvals) {
      const row = [
        `"${req.request_number}"`,
        `"${req.module || req.request_type || ''}"`,
        `"${req.maker_name || ''}"`,
        `"${req.maker_role || ''}"`,
        `"${req.project || req.applicant_name || ''}"`,
        `"${req.applicant_email || ''}"`,
        `"${req.value_impact || ''}"`,
        `"${new Date(req.created_at).toISOString()}"`,
        `"${req.assigned_approver || req.approver_name || ''}"`,
        `"${req.status}"`,
        `"${(req.approver_remarks || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `approvals_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(strings.exportCsvSuccess);
  };

  // Popup columns definition for ActionCenterSummaryPopupModal
  const summaryPopupColumns = useMemo<ActionCenterSummaryPopupColumn<ApprovalRequest>[]>(() => [
    {
      key: 'request_number',
      label: strings.colRequestId,
      render: (item: ApprovalRequest) => (
        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
          {item.request_number}
        </span>
      ),
    },
    {
      key: 'module',
      label: strings.colRequestType,
      render: (item: ApprovalRequest) => (
        <span className="font-semibold text-slate-800 dark:text-slate-200">
          {item.module || item.request_type}
        </span>
      ),
    },
    {
      key: 'applicant_name',
      label: strings.colProjectAccount,
      render: (item: ApprovalRequest) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-white">{item.applicant_name}</div>
          <div className="text-[10px] text-slate-400">{item.project}</div>
        </div>
      ),
    },
    {
      key: 'value_impact',
      label: strings.colAmountQuantity,
      render: (item: ApprovalRequest) => (
        <span className="font-bold text-slate-900 dark:text-white">{item.value_impact}</span>
      ),
    },
    {
      key: 'maker_name',
      label: strings.colRequestedBy,
      render: (item: ApprovalRequest) => (
        <div>
          <span className="font-medium text-slate-800 dark:text-slate-200">{item.maker_name}</span>
          <span className="text-[10px] text-slate-400 block">{item.maker_role}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: strings.colStatus,
      render: (item: ApprovalRequest) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            item.status === 'Approved'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
              : item.status === 'Rejected'
              ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300'
              : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          {item.status}
        </span>
      ),
    },
  ], [strings]);

  // Visible table columns in ordered sequence
  const visibleColumns = useMemo(() => {
    return [...columns].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  }, [columns]);

  // Total pages
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3.5">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl shadow-xl border border-slate-700 animate-slide-up flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {summaryError && (
        <div role="alert" className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-medium text-rose-800 dark:text-rose-300">
          {summaryError}
        </div>
      )}

      {/* 1. Summary Cards (4 compact cards in one horizontal row) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5 w-full">
        {/* Total Requests */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleCardClick('total')}
          onKeyDown={(e) => handleKeyDownCard(e, 'total')}
          className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
            statusFilter === 'all' && !isMyApprovalsActive
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
          }`}
          data-testid="card-total-requests"
        >
          <p className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight ${
            statusFilter === 'all' && !isMyApprovalsActive ? 'opacity-80' : 'text-slate-600 dark:text-slate-300'
          }`}>
            {strings.total}
          </p>
          <p className="text-base sm:text-lg font-bold leading-none mt-1">
            {summary ? summary.total : UI_STRINGS.dataLoad.emptyCell}
          </p>
          <span className={`text-[10px] whitespace-nowrap mt-1 leading-tight ${
            statusFilter === 'all' && !isMyApprovalsActive ? 'opacity-70' : 'text-slate-400 dark:text-slate-500'
          }`}>
            {strings.totalSubtitle}
          </span>
        </div>

        {/* Pending Approvals */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleCardClick('pending')}
          onKeyDown={(e) => handleKeyDownCard(e, 'pending')}
          className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
            statusFilter === 'Pending' && !isMyApprovalsActive
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
          }`}
          data-testid="card-pending-approvals"
        >
          <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-amber-700 dark:text-amber-300 whitespace-nowrap leading-tight">
            {strings.pending}
          </p>
          <p className="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400 leading-none mt-1">
            {summary ? summary.pending : UI_STRINGS.dataLoad.emptyCell}
          </p>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
            {strings.pendingSubtitle}
          </span>
        </div>

        {/* Approved */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleCardClick('approved')}
          onKeyDown={(e) => handleKeyDownCard(e, 'approved')}
          className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
            statusFilter === 'Approved' && !isMyApprovalsActive
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
          }`}
          data-testid="card-approved"
        >
          <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-emerald-700 dark:text-emerald-300 whitespace-nowrap leading-tight">
            {strings.approved}
          </p>
          <p className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-1">
            {summary ? summary.approved : UI_STRINGS.dataLoad.emptyCell}
          </p>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
            {strings.approvedSubtitle}
          </span>
        </div>

        {/* Rejected */}
        <div
          role="group"
          tabIndex={0}
          onClick={() => handleCardClick('rejected')}
          onKeyDown={(e) => handleKeyDownCard(e, 'rejected')}
          className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
            statusFilter === 'Rejected' && !isMyApprovalsActive
              ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
          }`}
          data-testid="card-rejected"
        >
          <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-rose-700 dark:text-rose-300 whitespace-nowrap leading-tight">
            {strings.rejected}
          </p>
          <p className="text-base sm:text-lg font-bold text-rose-600 dark:text-rose-400 leading-none mt-1">
            {summary ? summary.rejected : UI_STRINGS.dataLoad.emptyCell}
          </p>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
            {strings.rejectedSubtitle}
          </span>
        </div>
      </div>

      {/* 2. Single-Row Filter Toolbar (Clean Horizontal Row like Buyer Directory) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-2 shadow-sm flex flex-row items-center gap-1.5 sm:gap-2 text-xs w-full min-w-0 max-w-full box-border">
        {/* Search input (takes flexible width) */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={strings.searchPlaceholder}
            className="w-full has-leading-icon has-trailing-icon pr-3 py-1.5 h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* 1. Project filter. No project list is served by the API, so the value is typed. */}
        <input
          type="text"
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setCurrentPage(1);
          }}
          placeholder={strings.projectFilterPlaceholder}
          aria-label={strings.projectFilterPlaceholder}
          className="!w-40 shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap"
        />

        {/* 2. Request Type dropdown */}
        <select
          value={requestTypeFilter}
          onChange={(e) => {
            setRequestTypeFilter(e.target.value);
            setCurrentPage(1);
          }}
          aria-label={strings.allRequestTypes}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.allRequestTypes}</option>
          {APPROVAL_REQUEST_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {/* 3. All Statuses dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setIsMyApprovalsActive(false);
            setCurrentPage(1);
          }}
          aria-label={strings.allStatuses}
          className="!w-auto shrink-0 h-8.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 whitespace-nowrap cursor-pointer"
        >
          <option value="all">{strings.allStatuses}</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>

        {/* 4. Quick "My Approvals" Button */}
        <button
          type="button"
          onClick={handleToggleMyApprovals}
          className={`!w-auto shrink-0 h-8.5 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            isMyApprovalsActive
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
          data-testid="toggle-my-approvals"
        >
          <User size={13} />
          <span>{strings.tabMyApprovals}</span>
        </button>

        {/* Right aligned actions: Export CSV, Refresh, Gear */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 h-8.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{strings.exportCsvBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void loadSummary();
              void loadApprovals();
            }}
            title={strings.refreshTooltip}
            aria-label={strings.refreshTooltip}
            className="p-2 h-8.5 w-8.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin text-indigo-600' : ''} />
          </button>

          <button
            type="button"
            onClick={() => setIsColumnSettingsOpen(true)}
            title={strings.columnSettingsTooltip}
            aria-label={strings.columnSettingsTooltip}
            className="p-2 h-8.5 w-8.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* 4. Main Approval Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {visibleColumns.map((col) => {
                  if (col.key === 'request_id') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('request_number')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colRequestId}</span>
                          {sortField === 'request_number' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  if (col.key === 'request_type') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('module')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colRequestType}</span>
                          {sortField === 'module' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  if (col.key === 'requested_by') {
                    return (
                      <th key={col.key} className="py-2.5 px-3 whitespace-nowrap">
                        {strings.colRequestedBy}
                      </th>
                    );
                  }
                  if (col.key === 'project_account') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('project')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colProjectAccount}</span>
                          {sortField === 'project' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  if (col.key === 'amount_quantity') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('value_impact')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colAmountQuantity}</span>
                          {sortField === 'value_impact' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  if (col.key === 'request_date') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('created_at')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colRequestDate}</span>
                          {sortField === 'created_at' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  if (col.key === 'assigned_approver') {
                    return (
                      <th key={col.key} className="py-2.5 px-3 whitespace-nowrap">
                        {strings.colAssignedApprover}
                      </th>
                    );
                  }
                  if (col.key === 'status') {
                    return (
                      <th
                        key={col.key}
                        onClick={() => handleSort('status')}
                        className="py-2.5 px-3 whitespace-nowrap cursor-pointer hover:text-slate-900 dark:hover:text-white"
                      >
                        <div className="flex items-center gap-1">
                          <span>{strings.colStatus}</span>
                          {sortField === 'status' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                    );
                  }
                  return (
                    <th key={col.key} className="py-2.5 px-3 whitespace-nowrap text-right">
                      {strings.colActions}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-10 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>{strings.loading}</span>
                  </td>
                </tr>
              ) : listError ? (
                <tr>
                  <td colSpan={visibleColumns.length} role="alert" className="py-10 text-center text-rose-700 dark:text-rose-300">
                    <p className="font-semibold">{listError}</p>
                  </td>
                </tr>
              ) : approvals.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="py-10 text-center text-slate-400">
                    <FileCheck className="w-7 h-7 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">{strings.noApprovalsFound}</p>
                  </td>
                </tr>
              ) : (
                approvals.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    {visibleColumns.map((col) => {
                      if (col.key === 'request_id') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDetailsRequest(req)}
                              className="font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer block text-left"
                            >
                              {req.request_number}
                            </button>
                            <span className="text-[10px] text-slate-400">
                              {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </td>
                        );
                      }
                      if (col.key === 'request_type') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                            {req.module || req.request_type}
                          </td>
                        );
                      }
                      if (col.key === 'requested_by') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                            <div className="font-medium text-slate-900 dark:text-white">{req.maker_name}</div>
                            <div className="text-[10px] text-slate-400">{req.maker_role}</div>
                          </td>
                        );
                      }
                      if (col.key === 'project_account') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                            <div className="font-medium text-slate-900 dark:text-white">{req.applicant_name}</div>
                            <div className="text-[10px] text-slate-400">{req.project}</div>
                          </td>
                        );
                      }
                      if (col.key === 'amount_quantity') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap font-semibold text-slate-900 dark:text-white">
                            {req.value_impact}
                          </td>
                        );
                      }
                      if (col.key === 'request_date') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap text-slate-500 text-[11px]">
                            {new Date(req.created_at).toLocaleDateString()}
                          </td>
                        );
                      }
                      if (col.key === 'assigned_approver') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                            {req.assigned_approver || req.approver_name || UI_STRINGS.actionCenter.tasks.unassigned}
                          </td>
                        );
                      }
                      if (col.key === 'status') {
                        return (
                          <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                req.status === 'Approved'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : req.status === 'Rejected'
                                  ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {req.status}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className="py-2 px-3 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setDetailsRequest(req)}
                              className="px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex items-center gap-1 transition"
                              title={strings.actionView}
                            >
                              <Eye size={11} />
                              <span>{strings.actionView}</span>
                            </button>
                            {req.status === 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openActionModal(req, 'APPROVE')}
                                  className="px-2 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded flex items-center gap-0.5 transition"
                                  title={strings.approveBtn}
                                >
                                  <Check size={11} />
                                  <span>{strings.approveBtn}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openActionModal(req, 'REJECT')}
                                  className="px-2 py-0.5 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded flex items-center gap-0.5 transition"
                                  title={strings.rejectBtn}
                                >
                                  <X size={11} />
                                  <span>{strings.rejectBtn}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              {listError
                ? UI_STRINGS.dataLoad.emptyCell
                : formatString(strings.paginationShowing, {
                    from: total === 0 ? 0 : (currentPage - 1) * pageSize + 1,
                    to: Math.min(currentPage * pageSize, total),
                    total,
                  })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[11px]">{strings.rowsPerPage}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="p-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-2 font-medium">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Column Settings Modal */}
      {isColumnSettingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-fade-in"
          onClick={() => setIsColumnSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-4 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  {strings.columnSettingsTitle}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">{strings.columnSettingsSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsColumnSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600"
                aria-label={strings.closeModal}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-[10px] text-slate-400 w-4 text-center">
                      {idx + 1}
                    </span>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        disabled={col.locked}
                        onChange={() => handleToggleColumn(col.key)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                      />
                      <span className={`font-medium ${col.locked ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                        {col.label}
                      </span>
                    </label>
                    {col.locked && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-[9px] font-bold">
                        <Lock size={9} />
                        {strings.lockedColumnBadge}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveColumn(idx, 'up')}
                      className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-20"
                      title={strings.moveUp}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === columns.length - 1}
                      onClick={() => handleMoveColumn(idx, 'down')}
                      className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-20"
                      title={strings.moveDown}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleResetColumns}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
              >
                {strings.resetToDefault}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsColumnSettingsOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  {strings.closeModal}
                </button>
                <button
                  type="button"
                  onClick={handleSaveColumns}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs"
                >
                  {strings.saveDone}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Approval Request Details Popup */}
      {detailsRequest && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-fade-in"
          onClick={() => setDetailsRequest(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {strings.detailsTitle}
                </h3>
                <span className="font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                  {detailsRequest.request_number}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailsRequest(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label={strings.dismissModal}
              >
                <X size={18} />
              </button>
            </div>

            {/* Request Summary Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.requestTypeLabel}</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                  {detailsRequest.module || detailsRequest.request_type}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.currentStatusLabel}</span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border mt-0.5 ${
                    detailsRequest.status === 'Approved'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : detailsRequest.status === 'Rejected'
                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}
                >
                  {detailsRequest.status}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.requestedByLabel}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <User size={13} className="text-slate-400" />
                  <span className="font-semibold text-slate-900 dark:text-white">{detailsRequest.maker_name}</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{detailsRequest.maker_role}</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.assignedApproverLabel}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <User size={13} className="text-indigo-500" />
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                    {detailsRequest.assigned_approver || detailsRequest.approver_name || UI_STRINGS.actionCenter.tasks.unassigned}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.projectAccountLabel}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Building2 size={13} className="text-slate-400" />
                  <span className="font-semibold text-slate-900 dark:text-white">{detailsRequest.applicant_name}</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-0.5">{detailsRequest.project}</span>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.amountQuantityLabel}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Coins size={13} className="text-amber-500" />
                  <span className="font-bold text-slate-900 dark:text-white">{detailsRequest.value_impact}</span>
                </div>
                {detailsRequest.available_balance !== undefined && (
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    {strings.availableBalanceLabel}: {detailsRequest.available_balance}
                  </span>
                )}
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 col-span-2">
                <span className="text-[10px] text-slate-400 block font-semibold">{strings.dateTimeLabel}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Calendar size={13} className="text-slate-400" />
                  <span className="text-slate-700 dark:text-slate-300">
                    {new Date(detailsRequest.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Business Justification */}
            <div className="text-xs">
              <span className="text-[10px] text-slate-400 block font-semibold mb-1">
                {strings.reasonLabel}
              </span>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200">
                {detailsRequest.details || 'No justification remarks specified.'}
              </div>
            </div>

            {/* Supporting Documents & Attachments */}
            <div className="text-xs">
              <span className="text-[10px] text-slate-400 block font-semibold mb-1">
                {strings.documentsLabel}
              </span>
              {detailsRequest.attachments && detailsRequest.attachments.length > 0 ? (
                <div className="space-y-1">
                  {detailsRequest.attachments.map((doc, docIdx) => (
                    <div
                      key={docIdx}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-indigo-500" />
                        <span className="font-medium text-slate-800 dark:text-slate-200">{doc.name}</span>
                      </div>
                      {doc.url && (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">{strings.noDocuments}</p>
              )}
            </div>

            {/* Previous Approver Remarks */}
            {detailsRequest.approver_remarks && (
              <div className="text-xs">
                <span className="text-[10px] text-slate-400 block font-semibold mb-1">
                  {strings.previousRemarksLabel}
                </span>
                <div className="p-2.5 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60 rounded-lg text-indigo-900 dark:text-indigo-200">
                  <span className="font-semibold block text-[11px]">
                    {detailsRequest.approver_name || UI_STRINGS.dataLoad.emptyCell}:
                  </span>
                  <p className="mt-0.5">{detailsRequest.approver_remarks}</p>
                </div>
              </div>
            )}

            {/* Approval History Timeline */}
            <div className="text-xs">
              <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400 font-semibold">
                <History size={12} />
                <span>{strings.historyLabel}</span>
              </div>
              {detailsRequest.history && detailsRequest.history.length > 0 ? (
                <div className="space-y-1.5 border-l-2 border-indigo-200 dark:border-indigo-800 ml-2 pl-3">
                  {detailsRequest.history.map((hist, hIdx) => (
                    <div key={hIdx} className="text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{hist.action}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(hist.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <span className="text-slate-600 dark:text-slate-300">
                        {hist.actor_name} ({hist.actor_role || UI_STRINGS.dataLoad.emptyCell}): {hist.remarks || 'No notes'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">{strings.noHistory}</p>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDetailsRequest(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {strings.closeDetails}
              </button>

              {detailsRequest.status === 'Pending' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openActionModal(detailsRequest, 'REJECT')}
                    className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1"
                  >
                    <X size={12} />
                    <span>{strings.rejectBtn}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openActionModal(detailsRequest, 'APPROVE')}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1 shadow-2xs"
                  >
                    <Check size={12} />
                    <span>{strings.approveBtn}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. Action Confirmation Modal (Approve / Reject Workflow) */}
      {selectedRequest && pendingAction && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-fade-in"
          onClick={handleCloseActionModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {pendingAction === 'APPROVE' ? strings.confirmApprovalTitle : strings.confirmRejectionTitle}
              </h3>
              <button
                type="button"
                onClick={handleCloseActionModal}
                className="text-slate-400 hover:text-slate-600"
                aria-label={strings.dismissModal}
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              {pendingAction === 'APPROVE'
                ? formatString(strings.confirmApprovalPrompt, {
                    id: selectedRequest.request_number,
                    type: selectedRequest.module || selectedRequest.request_type || '',
                    account: selectedRequest.applicant_name,
                  })
                : formatString(strings.confirmRejectionPrompt, {
                    id: selectedRequest.request_number,
                    type: selectedRequest.module || selectedRequest.request_type || '',
                    account: selectedRequest.applicant_name,
                  })}
            </p>

            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">{strings.colAmountQuantity}:</span>
                <span className="font-bold text-slate-900 dark:text-white">{selectedRequest.value_impact}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{strings.colRequestedBy}:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{selectedRequest.maker_name}</span>
              </div>
            </div>

            <div>
              <label htmlFor="approval-approver-name" className="block text-slate-700 dark:text-slate-300 font-semibold text-xs mb-1">
                {strings.approverLabel}
              </label>
              {/* No approver list is served by the API. The backend checks the name against its configured approvers. */}
              <input
                id="approval-approver-name"
                type="text"
                value={actionApprover}
                onChange={(e) => setActionApprover(e.target.value)}
                placeholder={strings.approverInputPlaceholder}
                className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold text-xs mb-1">
                {strings.passwordLabel} <span className="text-rose-500">*</span>
              </label>
              <input
                type="password"
                value={actionPassword}
                onChange={(e) => {
                  setActionPassword(e.target.value);
                  if (passwordError) setPasswordError('');
                }}
                placeholder={strings.passwordPlaceholder}
                className={`w-full p-2 bg-slate-50 dark:bg-slate-800 border ${
                  passwordError ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700'
                } rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500`}
              />
              {passwordError && (
                <p className="text-[11px] text-rose-500 mt-1 font-medium">{passwordError}</p>
              )}
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-semibold text-xs mb-1">
                {strings.executiveRemarksLabel}
              </label>
              <textarea
                rows={2}
                value={actionRemarks}
                onChange={(e) => setActionRemarks(e.target.value)}
                placeholder={strings.executiveRemarksPlaceholder}
                className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleCloseActionModal}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {strings.cancelBtn}
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleActionConfirm}
                className={`px-4 py-1.5 text-xs font-bold text-white rounded-lg shadow-2xs ${
                  pendingAction === 'APPROVE'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {isProcessing
                  ? strings.processing
                  : pendingAction === 'APPROVE'
                  ? strings.confirmApproveBtn
                  : strings.confirmRejectBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Summary Card Popups (using ActionCenterSummaryPopupModal) */}
      <ActionCenterSummaryPopupModal<ApprovalRequest>
        isOpen={summaryModalState.isOpen}
        onClose={() => setSummaryModalState((prev) => ({ ...prev, isOpen: false }))}
        title={summaryModalState.title}
        subtitle={summaryModalState.subtitle}
        totalCount={summaryModalState.totalCount}
        columns={summaryPopupColumns}
        records={summaryModalState.records}
      />
    </div>
  );
}

export default ApprovalsDashboard;
