'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Filter,
  Download,
  Plus,
  X,
  Calendar,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Building2,
  FileText,
  Tag,
  ChevronRight,
  MoreVertical,
  Trash2,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  ClipboardList,
  Flame,
  Check,
  ChevronDown,
  CheckSquare,
  XCircle,
  ShieldCheck,
  Settings,
  Users,
  ArrowUpRight,
  BarChart3,
  HelpCircle,
  Layers,
} from 'lucide-react';
import {
  InternalTask,
  TaskType,
  TaskPriority,
  TaskStatus,
  TaskEntityType,
  TaskFilterParams,
  TaskSummary,
  DEFAULT_TASK_TYPES,
  fetchInternalTasks,
  fetchTaskTypes,
  createNewTaskType,
  fetchTaskSummary,
  fetchTaskById,
  createInternalTask,
  updateInternalTask,
  deleteInternalTask,
  getExportTasksUrl,
  escalateTask,
  ApprovalItem,
  ApprovalSummary,
  ApprovalFilterParams,
  ApprovalStatus,
  fetchApprovals,
  fetchApprovalSummary,
  updateApprovalStatus,
  DEFAULT_APPROVAL_ITEMS,
  DEFAULT_EXECUTIVES,
  ExecutiveOption,
} from '@/lib/internalTaskClient';

type ActiveTab = 'tasks' | 'approvals' | 'tickets' | 'scorecard' | 'buyers' | 'sellers';

export default function InternalTasksDashboard() {
  // Navigation Tabs State
  const [activeTab, setActiveTab] = useState<ActiveTab>('tasks');

  // Tasks Data state
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [totalTasks, setTotalTasks] = useState<number>(0);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>(DEFAULT_TASK_TYPES);
  const [summary, setSummary] = useState<TaskSummary>({
    total: 0,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    completed: 0,
    escalated: 0,
    criticalCount: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Filter state for Tasks
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<'my' | 'exec' | 'all'>('my');
  const [selectedExecName, setSelectedExecName] = useState<string>('Sudheer Kangala');
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);
  const [activeFilters, setActiveFilters] = useState<TaskFilterParams>({
    status: 'all',
    priority: 'all',
    taskTypeId: 'all',
    relatedEntityType: 'all',
    assignedTo: '',
    dueFrom: '',
    dueTo: '',
  });

  // Draft filter state inside the drawer
  const [draftFilters, setDraftFilters] = useState<TaskFilterParams>({
    status: 'all',
    priority: 'all',
    taskTypeId: 'all',
    relatedEntityType: 'all',
    assignedTo: '',
    dueFrom: '',
    dueTo: '',
  });

  // Column Visibility State (10 columns matching Image 1)
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState<boolean>(false);
  const [visibleColumns, setVisibleColumns] = useState({
    statusToggle: true,
    subjectContext: true,
    project: true,
    relatedCustomer: true,
    taskType: true,
    priority: true,
    dueDate: true,
    daysOverdue: true,
    lastEdited: true,
    actions: true,
  });

  // Pagination state for Tasks
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 20;

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedTaskDetails, setSelectedTaskDetails] = useState<InternalTask | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Escalation Modal State
  const [isEscalateModalOpen, setIsEscalateModalOpen] = useState<boolean>(false);
  const [taskToEscalate, setTaskToEscalate] = useState<InternalTask | null>(null);
  const [escalateToExecutive, setEscalateToExecutive] = useState<string>('Sudheer Kangala');
  const [escalationReason, setEscationReason] = useState<string>('SLA Breach / At Risk');
  const [escalationNotes, setEscalationNotes] = useState<string>('');
  const [isEscalating, setIsEscalating] = useState<boolean>(false);

  // Create Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTaskTypeId, setNewTaskTypeId] = useState<string>(DEFAULT_TASK_TYPES[0]?.id || '');
  const [newPriority, setNewPriority] = useState<TaskPriority>('Medium');
  const [newStatus, setNewStatus] = useState<TaskStatus>('Pending');
  const [newAssignedToName, setNewAssignedToName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ==========================================================================
  // Approvals Module State (Image 2 & Image 3)
  // ==========================================================================
  const [approvals, setApprovals] = useState<ApprovalItem[]>(DEFAULT_APPROVAL_ITEMS);
  const [approvalSummary, setApprovalSummary] = useState<ApprovalSummary>({
    pending: 3,
    approved: 2,
    rejected: 1,
    total: 6,
  });
  const [selectedApprovalModule, setSelectedApprovalModule] = useState<string>('All Modules');
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<string>('all');
  const [approvalProjectFilter, setApprovalProjectFilter] = useState<string>('all');
  const [approvalSearchQuery, setApprovalSearchQuery] = useState<string>('');
  const [approvalDateFrom, setApprovalDateFrom] = useState<string>('');
  const [approvalDateTo, setApprovalDateTo] = useState<string>('');
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Calculate active filter count for Tasks
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeFilters.status && activeFilters.status !== 'all') count++;
    if (activeFilters.priority && activeFilters.priority !== 'all') count++;
    if (activeFilters.taskTypeId && activeFilters.taskTypeId !== 'all') count++;
    if (activeFilters.relatedEntityType && activeFilters.relatedEntityType !== 'all') count++;
    if (activeFilters.assignedTo && activeFilters.assignedTo.trim()) count++;
    if (activeFilters.dueFrom) count++;
    if (activeFilters.dueTo) count++;
    return count;
  }, [activeFilters]);

  // Load Task Types
  const loadTaskTypes = useCallback(async () => {
    const types = await fetchTaskTypes();
    if (types && types.length > 0) {
      setTaskTypes(types);
      setNewTaskTypeId((prev) => prev || types[0].id);
    }
  }, []);

  // Load Task Summary
  const loadSummary = useCallback(async () => {
    const sum = await fetchTaskSummary();
    setSummary(sum);
  }, []);

  // Load Approvals
  const loadApprovalsData = useCallback(async () => {
    const data = await fetchApprovals({
      module: selectedApprovalModule,
      status: approvalStatusFilter,
      project: approvalProjectFilter,
      search: approvalSearchQuery,
      requestFrom: approvalDateFrom,
      requestTo: approvalDateTo,
    });
    setApprovals(data);
    const sum = await fetchApprovalSummary();
    setApprovalSummary(sum);
  }, [selectedApprovalModule, approvalStatusFilter, approvalProjectFilter, approvalSearchQuery, approvalDateFrom, approvalDateTo]);

  // Load Tasks from Database with Scope filter applied
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const filters: TaskFilterParams = {
        search: searchQuery,
        ...activeFilters,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      };

      if (scopeFilter === 'my') {
        filters.assignedTo = 'Sudheer Kangala'; // Current logged in Category Manager
      } else if (scopeFilter === 'exec' && selectedExecName) {
        filters.assignedTo = selectedExecName;
      }

      const res = await fetchInternalTasks(filters);
      setTasks(res.tasks);
      setTotalTasks(res.total);
    } catch {
      setErrorMessage('Unable to load internal tasks from database.');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activeFilters, currentPage, scopeFilter, selectedExecName]);

  useEffect(() => {
    loadTaskTypes();
    loadSummary();
    loadApprovalsData();
  }, [loadTaskTypes, loadSummary, loadApprovalsData]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Filter & Column Helpers
  const toggleColumn = (key: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFilterChange = (field: keyof TaskFilterParams, val: string) => {
    setActiveFilters((prev) => ({ ...prev, [field]: val }));
    setCurrentPage(1);
  };

  const handleDraftFilterChange = (field: keyof TaskFilterParams, val: string) => {
    setDraftFilters((prev) => ({ ...prev, [field]: val }));
  };

  // Sync draft filters when drawer opens
  const handleOpenFilterDrawer = () => {
    setDraftFilters({ ...activeFilters });
    setIsFilterDrawerOpen(true);
  };

  const handleApplyFilters = () => {
    setActiveFilters({ ...draftFilters });
    setCurrentPage(1);
    setIsFilterDrawerOpen(false);
  };

  const handleResetFilters = () => {
    const cleared: TaskFilterParams = {
      status: 'all',
      priority: 'all',
      taskTypeId: 'all',
      relatedEntityType: 'all',
      assignedTo: '',
      dueFrom: '',
      dueTo: '',
    };
    setDraftFilters(cleared);
    setActiveFilters(cleared);
    setSearchQuery('');
    setCurrentPage(1);
    setIsFilterDrawerOpen(false);
  };

  // Open Create Modal with pre-selected type
  const handleOpenCreateModal = () => {
    if (!newTaskTypeId && taskTypes.length > 0) {
      setNewTaskTypeId(taskTypes[0].id);
    }
    setIsCreateModalOpen(true);
  };

  // Handle Quick Status Toggle
  const handleToggleStatus = async (task: InternalTask) => {
    const nextStatus: TaskStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    const updated = await updateInternalTask(task.id, {
      status: nextStatus,
      activityComment: `Status toggled to ${nextStatus}`,
    });
    if (updated) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      loadSummary();
      showToast(`Task ${task.task_number} marked as ${nextStatus}.`);
    }
  };

  // Handle Escalation Modal Open
  const handleOpenEscalateModal = (task: InternalTask) => {
    setTaskToEscalate(task);
    setEscalateToExecutive(DEFAULT_EXECUTIVES[0]?.name || 'Sudheer Kangala');
    setEscationReason('SLA Breach / At Risk');
    setEscalationNotes('');
    setIsEscalateModalOpen(true);
  };

  // Submit Escalation
  const handleConfirmEscalation = async () => {
    if (!taskToEscalate) return;
    setIsEscalating(true);
    try {
      const updated = await escalateTask(taskToEscalate.id, {
        escalateTo: escalateToExecutive,
        escalationReason,
        notes: escalationNotes,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === taskToEscalate.id ? updated : t)));
        if (selectedTaskDetails && selectedTaskDetails.id === taskToEscalate.id) {
          setSelectedTaskDetails(updated);
        }
        await loadSummary();
        showToast(`Task ${taskToEscalate.task_number} escalated to ${escalateToExecutive}.`);
        setIsEscalateModalOpen(false);
        setTaskToEscalate(null);
      } else {
        showToast('Failed to escalate task.');
      }
    } catch {
      showToast('Error during task escalation.');
    } finally {
      setIsEscalating(false);
    }
  };

  // Handle Approval Action (Approve / Reject)
  const handleApprovalDecision = async (item: ApprovalItem, decision: ApprovalStatus) => {
    const updated = await updateApprovalStatus(item.id, decision, 'Category Manager Admin');
    if (updated) {
      setApprovals((prev) => prev.map((a) => (a.id === item.id ? updated : a)));
      const sum = await fetchApprovalSummary();
      setApprovalSummary(sum);
      showToast(`Request ${item.requestId} was marked as ${decision}.`);
    } else {
      showToast(`Failed to update ${item.requestId}.`);
    }
  };

  // Handle Create Task Submission
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmitting(true);
    try {
      const finalTypeId = newTaskTypeId;
      const selectedType = taskTypes.find((t) => t.id === finalTypeId);
      const newTask = await createInternalTask({
        title: newTitle.trim(),
        description: newDescription.trim(),
        taskTypeId: finalTypeId || undefined,
        priority: newPriority,
        status: newStatus,
        assignedToName: newAssignedToName.trim() || 'Unassigned',
        dueDate: newDueDate || undefined,
        relatedEntityType: (selectedType?.default_module as TaskEntityType) || 'GENERAL',
        notes: newNotes.trim(),
      });

      if (newTask) {
        setIsCreateModalOpen(false);
        setNewTitle('');
        setNewDescription('');
        setNewNotes('');
        setNewAssignedToName('');
        setNewDueDate('');
        loadTasks();
        loadSummary();
        showToast(`Internal task ${newTask.task_number} created successfully.`);
      } else {
        showToast('Failed to create task in database.');
      }
    } catch {
      showToast('Error saving task.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete Task
  const handleDeleteTask = async (id: string, taskNumber: string) => {
    if (!window.confirm(`Are you sure you want to delete task ${taskNumber}?`)) return;
    const ok = await deleteInternalTask(id);
    if (ok) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      loadSummary();
      if (selectedTaskDetails && selectedTaskDetails.id === id) {
        setSelectedTaskDetails(null);
      }
      showToast(`Task ${taskNumber} deleted.`);
    } else {
      showToast('Failed to delete task.');
    }
  };

  // Calculate Overdue or Remaining
  const getDaysOverdueOrRemaining = (dueDateStr?: string, status?: TaskStatus) => {
    if (status === 'Completed') return { text: 'Completed', isOverdue: false, isCompleted: true };
    if (!dueDateStr) return { text: 'No Due Date', isOverdue: false, isCompleted: false };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `${Math.abs(diffDays)}d overdue`, isOverdue: true, isCompleted: false };
    } else if (diffDays === 0) {
      return { text: 'Due Today', isOverdue: true, isCompleted: false };
    } else {
      return { text: `In ${diffDays}d`, isOverdue: false, isCompleted: false };
    }
  };

  const exportUrl = useMemo(() => {
    return getExportTasksUrl({ search: searchQuery, ...activeFilters });
  }, [searchQuery, activeFilters]);

  const visibleColumnCount = Object.values(visibleColumns).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* 1. TOP TAB NAVIGATION BAR (Matching Images 1, 2, 3)             */}
      {/* ============================================================== */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {/* Internal Tasks Tab */}
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all shrink-0 ${
              activeTab === 'tasks'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Internal tasks</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'tasks'
                  ? 'bg-white/20 text-white'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
              }`}
            >
              {summary.pending || 0}
            </span>
          </button>

          {/* Approvals Tab */}
          <button
            onClick={() => setActiveTab('approvals')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all shrink-0 ${
              activeTab === 'approvals'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Approvals</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'approvals'
                  ? 'bg-white/20 text-white'
                  : 'bg-amber-500 text-white'
              }`}
            >
              {approvalSummary.pending}
            </span>
          </button>

          {/* Scorecard Tab */}
          <button
            onClick={() => setActiveTab('scorecard')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all shrink-0 ${
              activeTab === 'scorecard'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Scorecard</span>
          </button>

          {/* Tickets Tab (Future Phase) */}
          <button
            onClick={() => setActiveTab('tickets')}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all shrink-0 ${
              activeTab === 'tickets'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Tickets</span>
            <span className="px-1.5 py-0.2 bg-slate-200 dark:bg-slate-800 text-[9px] rounded text-slate-500 font-bold uppercase">
              Future
            </span>
          </button>

          {/* Buyers Directory Link Tab */}
          <Link
            href="/category-manager/buyers-directory"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <span>Buyers Directory</span>
            <ArrowUpRight className="w-3 h-3 text-slate-400" />
          </Link>

          {/* Sellers Directory Link Tab */}
          <Link
            href="/category-manager/sellers-directory"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <span>Sellers Directory</span>
            <ArrowUpRight className="w-3 h-3 text-slate-400" />
          </Link>

          {/* Reference Sub-chips (matching Image 1 & 2 UI) */}
          <span className="text-slate-300 dark:text-slate-700 px-1">|</span>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-default">
              Document Tracker <span className="bg-rose-500 text-white text-[9px] font-bold px-1 rounded-full">99+</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-default">
              Loans <span className="bg-blue-600 text-white text-[9px] font-bold px-1 rounded-full">17</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-default">
              Payment Dues <span className="bg-orange-500 text-white text-[9px] font-bold px-1 rounded-full">9</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-default">
              Leads <span className="bg-rose-500 text-white text-[9px] font-bold px-1 rounded-full">6</span>
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. TAB CONTENT: INTERNAL TASKS VIEW (Image 1 & Image 3)        */}
      {/* ============================================================== */}
      {activeTab === 'tasks' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* 5 Distinct Styled KPI Stat Cards (Image 1) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* Card 1: Total Tasks (Blue) */}
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/50 rounded-xl p-3.5 shadow-sm transition-all hover:shadow-md">
              <span className="text-[11px] font-medium text-sky-800 dark:text-sky-300 block">Total Tasks</span>
              <div className="flex items-center gap-2 mt-2">
                <CheckSquare className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                <span className="text-2xl font-bold tracking-tight text-sky-950 dark:text-sky-100">
                  {summary.total}
                </span>
              </div>
            </div>

            {/* Card 2: Pending Tasks (Yellow) */}
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3.5 shadow-sm transition-all hover:shadow-md">
              <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300 block">Pending Tasks</span>
              <div className="flex items-center gap-2 mt-2">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <span className="text-2xl font-bold tracking-tight text-amber-950 dark:text-amber-100">
                  {summary.pending}
                </span>
              </div>
            </div>

            {/* Card 3: Escalated Tasks (Peach / Orange) */}
            <div className="bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/50 rounded-xl p-3.5 shadow-sm transition-all hover:shadow-md">
              <span className="text-[11px] font-medium text-orange-800 dark:text-orange-300 block">Escalated Tasks</span>
              <div className="flex items-center gap-2 mt-2">
                <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                <span className="text-2xl font-bold tracking-tight text-orange-950 dark:text-orange-100">
                  {summary.escalated}
                </span>
              </div>
            </div>

            {/* Card 4: Completed Tasks (Green) */}
            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-3.5 shadow-sm transition-all hover:shadow-md">
              <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300 block">Completed Tasks</span>
              <div className="flex items-center gap-2 mt-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-2xl font-bold tracking-tight text-emerald-950 dark:text-emerald-100">
                  {summary.completed}
                </span>
              </div>
            </div>

            {/* Card 5: Critical / Overdue (Pink / Rose) */}
            <div className="bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 rounded-xl p-3.5 shadow-sm transition-all hover:shadow-md col-span-2 md:col-span-1">
              <span className="text-[11px] font-medium text-rose-800 dark:text-rose-300 block">Critical / Overdue</span>
              <div className="flex items-center gap-2 mt-2">
                <Flame className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                <span className="text-2xl font-bold tracking-tight text-rose-950 dark:text-rose-100">
                  {summary.criticalCount}
                </span>
              </div>
            </div>
          </div>

          {/* Filter & Action Toolbar (Matching Image 1) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm space-y-3">
            {/* Top row: Dropdown selectors & Action buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Scope selector (My Items / Exec wise / All Tasks) */}
                <div className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <select
                    value={scopeFilter}
                    onChange={(e) => {
                      setScopeFilter(e.target.value as 'my' | 'exec' | 'all');
                      setCurrentPage(1);
                    }}
                    className="bg-transparent font-semibold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="my">My Items</option>
                    <option value="exec">Exec wise Tasks</option>
                    <option value="all">All Tasks</option>
                  </select>
                </div>

                {/* Executive Selector (visible if scope is Exec wise) */}
                {scopeFilter === 'exec' && (
                  <select
                    value={selectedExecName}
                    onChange={(e) => {
                      setSelectedExecName(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                  >
                    {DEFAULT_EXECUTIVES.map((ex) => (
                      <option key={ex.id} value={ex.name}>
                        {ex.name} ({ex.role})
                      </option>
                    ))}
                  </select>
                )}

                {/* Status Dropdown */}
                <select
                  value={activeFilters.status || 'all'}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Escalated">Escalated</option>
                  <option value="Completed">Completed</option>
                </select>

                {/* Priority Dropdown */}
                <select
                  value={activeFilters.priority || 'all'}
                  onChange={(e) => handleFilterChange('priority', e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Priorities</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>

                {/* Project / Module Dropdown */}
                <select
                  value={activeFilters.relatedEntityType || 'all'}
                  onChange={(e) => handleFilterChange('relatedEntityType', e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Projects / Modules</option>
                  <option value="RFQ">RFQ Module</option>
                  <option value="BUYER">Buyer Module</option>
                  <option value="VENDOR">Seller / Vendor Module</option>
                  <option value="CREDIT">Credit Module</option>
                  <option value="CATEGORY">Category Module</option>
                  <option value="PAYMENT">Payment Module</option>
                  <option value="GENERAL">General Module</option>
                </select>

                {/* Due Date Range Inline Inputs */}
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500">
                  <input
                    type="date"
                    value={activeFilters.dueFrom || ''}
                    onChange={(e) => handleFilterChange('dueFrom', e.target.value)}
                    placeholder="Due From"
                    className="bg-transparent text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    value={activeFilters.dueTo || ''}
                    onChange={(e) => handleFilterChange('dueTo', e.target.value)}
                    placeholder="Due To"
                    className="bg-transparent text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none"
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                </div>
              </div>

              {/* Action Buttons: Columns, Export, Create Task, Refresh */}
              <div className="flex items-center gap-2">
                {/* Columns Dropdown Toggle */}
                <div className="relative">
                  <button
                    onClick={() => setIsColumnDropdownOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-500" />
                    <span>Columns</span>
                    <span className="w-4 h-4 bg-blue-600 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                      {visibleColumnCount}
                    </span>
                  </button>

                  {isColumnDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-3 z-30 space-y-2 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-1.5">
                        Customize Columns
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.statusToggle}
                          onChange={() => toggleColumn('statusToggle')}
                          className="rounded text-blue-600"
                        />
                        <span>Status & Toggle</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.subjectContext}
                          onChange={() => toggleColumn('subjectContext')}
                          className="rounded text-blue-600"
                        />
                        <span>Task Subject & Context</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.project}
                          onChange={() => toggleColumn('project')}
                          className="rounded text-blue-600"
                        />
                        <span>Project / Module</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.relatedCustomer}
                          onChange={() => toggleColumn('relatedCustomer')}
                          className="rounded text-blue-600"
                        />
                        <span>Related Customer / Unit</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.taskType}
                          onChange={() => toggleColumn('taskType')}
                          className="rounded text-blue-600"
                        />
                        <span>Task Type</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.priority}
                          onChange={() => toggleColumn('priority')}
                          className="rounded text-blue-600"
                        />
                        <span>Priority</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.dueDate}
                          onChange={() => toggleColumn('dueDate')}
                          className="rounded text-blue-600"
                        />
                        <span>Due Date</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.daysOverdue}
                          onChange={() => toggleColumn('daysOverdue')}
                          className="rounded text-blue-600"
                        />
                        <span>Days Overdue / Age</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.lastEdited}
                          onChange={() => toggleColumn('lastEdited')}
                          className="rounded text-blue-600"
                        />
                        <span>Last Edited</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.actions}
                          onChange={() => toggleColumn('actions')}
                          className="rounded text-blue-600"
                        />
                        <span>Actions</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Export Dropdown */}
                <a
                  href={exportUrl}
                  download
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Export</span>
                </a>

                {/* + Create Internal Task Button (Vibrant purple button matching Image 1) */}
                <button
                  onClick={handleOpenCreateModal}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm shadow-indigo-600/20 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Create Internal Task</span>
                </button>

                {/* Refresh Button */}
                <button
                  onClick={() => {
                    loadTasks();
                    loadSummary();
                    showToast('Data refreshed.');
                  }}
                  className="p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Bottom row: Search input + Reset button */}
            <div className="flex items-center gap-2 pt-1">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search by name, unit, customer, or notes..."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleResetFilters}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
              >
                Reset
              </button>
              <button
                onClick={handleOpenFilterDrawer}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <span>Filters {activeFilterCount > 0 && `(${activeFilterCount})`}</span>
              </button>
            </div>
          </div>

          {/* Tasks Table (Image 1) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            {errorMessage && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                  <span>{errorMessage}</span>
                </div>
                <button onClick={loadTasks} className="underline font-semibold">
                  Retry
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="p-12 text-center space-y-3">
                <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
                <p className="text-xs text-slate-500">Loading internal tasks from database...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="py-16 px-4 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">No internal tasks found matching current filters.</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Adjust your search query, scope, or date range to view tasks.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Internal Task</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold tracking-wide">
                    <tr>
                      {visibleColumns.statusToggle && (
                        <th className="py-3 px-3.5 w-14 text-center">Status & Quick Toggle</th>
                      )}
                      {visibleColumns.subjectContext && (
                        <th className="py-3 px-3.5 min-w-[220px]">Task Subject & Context</th>
                      )}
                      {visibleColumns.project && <th className="py-3 px-3.5 min-w-[120px]">Project</th>}
                      {visibleColumns.relatedCustomer && (
                        <th className="py-3 px-3.5 min-w-[160px]">Related Customer / Unit</th>
                      )}
                      {visibleColumns.taskType && <th className="py-3 px-3.5 w-28">Task Type</th>}
                      {visibleColumns.priority && <th className="py-3 px-3.5 w-24">Priority</th>}
                      {visibleColumns.dueDate && <th className="py-3 px-3.5 w-28">Due Date</th>}
                      {visibleColumns.daysOverdue && <th className="py-3 px-3.5 w-28">Days Overdue / Age</th>}
                      {visibleColumns.lastEdited && <th className="py-3 px-3.5 w-28">Last Edited</th>}
                      {visibleColumns.actions && <th className="py-3 px-3.5 text-right w-28">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {tasks.map((task) => {
                      const overdueInfo = getDaysOverdueOrRemaining(task.due_date, task.status);

                      return (
                        <tr
                          key={task.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Status & Quick Toggle */}
                          {visibleColumns.statusToggle && (
                            <td className="py-3 px-3.5 text-center">
                              <input
                                type="checkbox"
                                checked={task.status === 'Completed'}
                                onChange={() => handleToggleStatus(task)}
                                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                              />
                            </td>
                          )}

                          {/* Task Subject & Context */}
                          {visibleColumns.subjectContext && (
                            <td className="py-3 px-3.5">
                              <div
                                onClick={() => setSelectedTaskDetails(task)}
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors cursor-pointer"
                              >
                                {task.title}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[10px] text-slate-400 font-medium">
                                  {task.task_number || task.id}
                                </span>
                                {task.description && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                                    • {task.description}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}

                          {/* Project / Module */}
                          {visibleColumns.project && (
                            <td className="py-3 px-3.5">
                              <span
                                className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                  task.related_entity_type === 'RFQ'
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                                    : task.related_entity_type === 'BUYER'
                                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                                    : task.related_entity_type === 'VENDOR'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                    : task.related_entity_type === 'CREDIT' || task.related_entity_type === 'PAYMENT'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {task.related_entity_type}
                              </span>
                            </td>
                          )}

                          {/* Related Customer / Unit */}
                          {visibleColumns.relatedCustomer && (
                            <td className="py-3 px-3.5">
                              <span className="font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                                {task.related_entity_label || 'Direct Workspace'}
                              </span>
                            </td>
                          )}

                          {/* Task Type */}
                          {visibleColumns.taskType && (
                            <td className="py-3 px-3.5">
                              <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                                {task.task_type_name || task.task_type_id || 'General Task'}
                              </span>
                            </td>
                          )}

                          {/* Priority */}
                          {visibleColumns.priority && (
                            <td className="py-3 px-3.5">
                              <span
                                className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                  task.priority === 'Critical'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                    : task.priority === 'High'
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                                    : task.priority === 'Medium'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}
                              >
                                {task.priority}
                              </span>
                            </td>
                          )}

                          {/* Due Date */}
                          {visibleColumns.dueDate && (
                            <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">
                              {task.due_date || '—'}
                            </td>
                          )}

                          {/* Days Overdue / Age */}
                          {visibleColumns.daysOverdue && (
                            <td className="py-3 px-3.5">
                              <span
                                className={`text-[10px] font-semibold ${
                                  overdueInfo.isCompleted
                                    ? 'text-emerald-600'
                                    : overdueInfo.isOverdue
                                    ? 'text-rose-600 font-bold'
                                    : 'text-slate-400'
                                }`}
                              >
                                {overdueInfo.text}
                              </span>
                            </td>
                          )}

                          {/* Last Edited */}
                          {visibleColumns.lastEdited && (
                            <td className="py-3 px-3.5 text-slate-400 text-[10px]">
                              {task.updated_at ? task.updated_at.slice(0, 10) : '—'}
                            </td>
                          )}

                          {/* Actions: View Details, Escalate to Co-exec / Manager, Delete */}
                          {visibleColumns.actions && (
                            <td className="py-3 px-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Escalate Action (Option to escalate to co-exec or manager - Image 3) */}
                                <button
                                  onClick={() => handleOpenEscalateModal(task)}
                                  className="p-1 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/40 rounded transition-colors"
                                  title="Escalate to co-exec or manager"
                                  data-testid={`escalate-task-${task.id}`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setSelectedTaskDetails(task)}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                  title="View details"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteTask(task.id, task.task_number)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                  title="Delete task"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Toolbar */}
            {totalTasks > pageSize && (
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalTasks)} of{' '}
                  {totalTasks} tasks
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                    className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>Page {currentPage}</span>
                  <button
                    disabled={currentPage * pageSize >= totalTasks}
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. TAB CONTENT: APPROVALS VIEW (Image 2 & Image 3)             */}
      {/* ============================================================== */}
      {activeTab === 'approvals' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Approvals Action Toolbar */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Management Approvals Center</h2>
              <p className="text-xs text-slate-500">
                Manage managerial approvals for credits, account onboarding, commercial waivers, and trials.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => showToast('Exporting approvals audit log...')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export</span>
              </button>
              <button
                onClick={() => {
                  loadApprovalsData();
                  showToast('Approvals updated.');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                <span>Refresh</span>
              </button>
              <button
                onClick={() => setIsRulesModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
              >
                <Settings className="w-3.5 h-3.5 text-slate-500" />
                <span>Configure Rules</span>
              </button>
            </div>
          </div>

          {/* 4 Distinct KPI Stat Cards (Image 2) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Card 1: Pending Approvals (Amber/Yellow) */}
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-l-amber-500 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 block">Pending Approvals</span>
              <div className="flex items-center gap-2 mt-2">
                <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {approvalSummary.pending}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Awaiting managerial decision</p>
            </div>

            {/* Card 2: Approved (Green) */}
            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border-l-4 border-l-emerald-500 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 block">Approved</span>
              <div className="flex items-center gap-2 mt-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {approvalSummary.approved}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Cleared & updated live</p>
            </div>

            {/* Card 3: Rejected (Red) */}
            <div className="bg-rose-50/50 dark:bg-rose-950/20 border-l-4 border-l-rose-500 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300 block">Rejected</span>
              <div className="flex items-center gap-2 mt-2">
                <XCircle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {approvalSummary.rejected}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Declined & reverted</p>
            </div>

            {/* Card 4: Total Requests (Blue) */}
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border-l-4 border-l-sky-500 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs font-semibold text-sky-700 dark:text-sky-300 block">Total Requests</span>
              <div className="flex items-center gap-2 mt-2">
                <ShieldCheck className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {approvalSummary.total}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Lifetime audit transactions</p>
            </div>
          </div>

          {/* Sub-Module Filter Pills (Matching Image 2 & Image 3) */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            {[
              'All Modules',
              'Credit Allocations',
              'Account Approvals',
              'Discounts & Waivers',
              'Trial Period Extensions',
              'Payment Reconciliations',
            ].map((moduleName) => (
              <button
                key={moduleName}
                onClick={() => setSelectedApprovalModule(moduleName)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedApprovalModule === moduleName
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                }`}
              >
                {moduleName}
              </button>
            ))}
          </div>

          {/* Approvals Filters Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={approvalProjectFilter}
                onChange={(e) => setApprovalProjectFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="all">All Projects</option>
                <option value="Steel">Enterprise Steel Tender 2026</option>
                <option value="Solar">Solar EPC Procurement</option>
                <option value="Valve">Industrial Valve Ingestion</option>
                <option value="Fasteners">Automotive Fasteners Contract</option>
              </select>

              <select
                value={approvalStatusFilter}
                onChange={(e) => setApprovalStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 font-medium"
              >
                <option value="all">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>

              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500">
                <input
                  type="date"
                  value={approvalDateFrom}
                  onChange={(e) => setApprovalDateFrom(e.target.value)}
                  className="bg-transparent text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none"
                />
                <span>→</span>
                <input
                  type="date"
                  value={approvalDateTo}
                  onChange={(e) => setApprovalDateTo(e.target.value)}
                  className="bg-transparent text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none"
                />
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <input
                type="text"
                value={approvalSearchQuery}
                onChange={(e) => setApprovalSearchQuery(e.target.value)}
                placeholder="Search by request ID, customer, requester..."
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
              <button
                onClick={loadApprovalsData}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm"
              >
                Search
              </button>
            </div>
          </div>

          {/* Approvals Table (Image 2) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            {approvals.length === 0 ? (
              <div className="py-16 px-4 text-center space-y-2">
                <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto" />
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No approval requests match the selected filters.
                </h4>
                <p className="text-xs text-slate-400">
                  Try clearing sub-module filter or searching for another request ID.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold tracking-wide">
                    <tr>
                      <th className="py-3 px-3.5 min-w-[140px]">Request ID / Time</th>
                      <th className="py-3 px-3.5 min-w-[140px]">Module</th>
                      <th className="py-3 px-3.5 min-w-[180px]">Unit / Project</th>
                      <th className="py-3 px-3.5 min-w-[160px]">Applicant / Customer</th>
                      <th className="py-3 px-3.5 min-w-[180px]">Value / Impact</th>
                      <th className="py-3 px-3.5 min-w-[130px]">Maker (Requester)</th>
                      <th className="py-3 px-3.5 w-24">Status</th>
                      <th className="py-3 px-3.5 text-right w-44">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {approvals.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3.5 font-mono">
                          <div className="font-bold text-slate-900 dark:text-white">{item.requestId}</div>
                          <span className="text-[10px] text-slate-400">{item.createdAt.slice(0, 10)}</span>
                        </td>
                        <td className="py-3 px-3.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                            {item.module}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 font-medium text-slate-900 dark:text-slate-100">
                          {item.project}
                        </td>
                        <td className="py-3 px-3.5">{item.applicant}</td>
                        <td className="py-3 px-3.5 font-semibold text-emerald-700 dark:text-emerald-300">
                          {item.valueImpact}
                        </td>
                        <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400">{item.makerName}</td>
                        <td className="py-3 px-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.status === 'Approved'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : item.status === 'Rejected'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-right">
                          {item.status === 'Pending' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleApprovalDecision(item, 'Approved')}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-[11px] shadow-sm transition-colors"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleApprovalDecision(item, 'Rejected')}
                                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold text-[11px] shadow-sm transition-colors"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">
                              Reviewed by {item.reviewerName || 'Executive'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 4. TAB CONTENT: SCORECARD VIEW (Image 3 Requirement)           */}
      {/* ============================================================== */}
      {activeTab === 'scorecard' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Individual & Team Performance Scorecards</h2>
            <p className="text-xs text-slate-500">
              Live operational throughput, SLA adherence scores, and resolution metrics across category executives.
            </p>
          </div>

          {/* Team SLA Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs text-slate-500 block">Total Resolved Tasks</span>
              <span className="text-2xl font-bold text-slate-900 dark:text-white mt-1 block">159</span>
              <span className="text-[10px] text-emerald-600 font-semibold">+18% vs last month</span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs text-slate-500 block">Team SLA Adherence</span>
              <span className="text-2xl font-bold text-emerald-600 mt-1 block">97.4%</span>
              <span className="text-[10px] text-slate-400">Target: ≥ 95.0%</span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs text-slate-500 block">Avg Resolution Time</span>
              <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1 block">2.8h</span>
              <span className="text-[10px] text-emerald-600 font-semibold">0.6h faster than baseline</span>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
              <span className="text-xs text-slate-500 block">Escalation Rate</span>
              <span className="text-2xl font-bold text-orange-600 mt-1 block">3.8%</span>
              <span className="text-[10px] text-slate-400">Under 5% threshold</span>
            </div>
          </div>

          {/* Individual Executive Scorecards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {DEFAULT_EXECUTIVES.map((exec) => (
              <div
                key={exec.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold flex items-center justify-center text-sm">
                      {exec.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">{exec.name}</h4>
                      <p className="text-xs text-slate-500">{exec.role}</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-lg text-xs font-bold">
                    {exec.slaAdherence}% SLA
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-semibold">Resolved</span>
                    <p className="font-bold text-slate-900 dark:text-white mt-0.5">{exec.resolvedTasks}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-semibold">Open Tasks</span>
                    <p className="font-bold text-amber-600 mt-0.5">{exec.openTasks}</p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-semibold">Avg Speed</span>
                    <p className="font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{exec.avgResolutionTime}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. TAB CONTENT: TICKETS VIEW (Image 3 Requirement)             */}
      {/* ============================================================== */}
      {activeTab === 'tickets' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl">
            <div className="inline-block px-2.5 py-1 bg-white/20 backdrop-blur rounded-full text-[10px] font-bold uppercase tracking-wider mb-2">
              Future Phase — Roadmap
            </div>
            <h2 className="text-xl font-bold">Client Tickets & Complaints Hub</h2>
            <p className="text-xs text-blue-100 max-w-xl mt-1 leading-relaxed">
              Centralized complaint triage and error ticket governance to capture, track, and resolve buyer and seller
              system errors, RFQ issues, or account disputes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <AlertCircle className="w-6 h-6 text-rose-500" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Client Error Ingestion</h3>
              <p className="text-xs text-slate-500">
                Automatic crash reports and API failure ingestion from WhatsApp bots, vendor uploads, and web sessions.
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Buyer Complaints Escalation</h3>
              <p className="text-xs text-slate-500">
                Direct escalation matrix routing supplier disputes or quotation delays to senior category heads.
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <ShieldCheck className="w-6 h-6 text-emerald-500" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Resolution Audit & SLA</h3>
              <p className="text-xs text-slate-500">
                Real-time SLA timers, resolution notes, and customer CSAT feedback ratings after ticket closure.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ESCALATION MODAL (Option to escalate to co-exec or manager)    */}
      {/* ============================================================== */}
      {isEscalateModalOpen && taskToEscalate && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            onClick={() => setIsEscalateModalOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            data-testid="escalate-modal-backdrop"
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Escalate Task to Co-exec / Manager
                  </h3>
                </div>
                <button
                  onClick={() => setIsEscalateModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  data-testid="escalate-modal-close-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg text-xs space-y-1">
                <span className="font-bold text-amber-900 dark:text-amber-200 block">
                  {taskToEscalate.task_number}: {taskToEscalate.title}
                </span>
                <span className="text-amber-700 dark:text-amber-300 block">
                  Escalating elevates priority to <strong>Critical</strong> and marks status as <strong>Escalated</strong>.
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Assignee / Escalate To *
                  </label>
                  <select
                    value={escalateToExecutive}
                    onChange={(e) => setEscalateToExecutive(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    {DEFAULT_EXECUTIVES.map((ex) => (
                      <option key={ex.id} value={ex.name}>
                        {ex.name} — {ex.role}
                      </option>
                    ))}
                    <option value="Operations Manager">Operations Head / General Manager</option>
                    <option value="Director Signoff">Director Signoff Desk</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Reason for Escalation *
                  </label>
                  <select
                    value={escalationReason}
                    onChange={(e) => setEscationReason(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="SLA Breach / At Risk">SLA Breach / At Risk</option>
                    <option value="Technical Discrepancy">Technical Discrepancy in Quote</option>
                    <option value="High Value Approval Needed">High Value Approval Needed</option>
                    <option value="Vendor Non-responsiveness">Vendor Non-responsiveness</option>
                    <option value="Commercial Waiver Request">Commercial Waiver Request</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Escalation Notes / Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={escalationNotes}
                    onChange={(e) => setEscalationNotes(e.target.value)}
                    placeholder="Provide specific context or reason requiring manager intervention..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setIsEscalateModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  disabled={isEscalating}
                  onClick={handleConfirmEscalation}
                  className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
                  data-testid="confirm-escalation-btn"
                >
                  {isEscalating && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>Confirm Escalation</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* CONFIGURE RULES MODAL (Image 2)                                */}
      {/* ============================================================== */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            onClick={() => setIsRulesModalOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            data-testid="rules-modal-backdrop"
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Approval Rules & Authorization Thresholds
                  </h3>
                </div>
                <button
                  onClick={() => setIsRulesModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  data-testid="rules-modal-close-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Credit Allocations</span>
                  <p className="text-slate-500">
                    Requests ≤ 50 credits auto-escalate to Category Manager. Requests &gt; 50 credits require Finance Head signoff.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Account Approvals</span>
                  <p className="text-slate-500">
                    Self-registered accounts must have verified GSTIN and business PAN before Category Manager activation.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Discounts & Waivers</span>
                  <p className="text-slate-500">
                    Fee waivers &gt; 10% require dual-maker verification (Category Executive + Finance Lead).
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => setIsRulesModalOpen(false)}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* FILTER DRAWER / SIDEBAR (Matches Existing Workflow)            */}
      {/* ============================================================== */}
      {isFilterDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            onClick={() => setIsFilterDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            data-testid="filter-drawer-backdrop"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-sm bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Filter Tasks</h3>
                </div>
                <button
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                  data-testid="filter-drawer-close-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Status</label>
                  <select
                    value={draftFilters.status}
                    onChange={(e) => handleDraftFilterChange('status', e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Statuses</option>
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Escalated">Escalated</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Priority</label>
                  <select
                    value={draftFilters.priority}
                    onChange={(e) => handleDraftFilterChange('priority', e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Priorities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Related Module / Entity
                  </label>
                  <select
                    value={draftFilters.relatedEntityType}
                    onChange={(e) => handleDraftFilterChange('relatedEntityType', e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Modules</option>
                    <option value="RFQ">RFQ Tasks</option>
                    <option value="BUYER">Buyer Tasks</option>
                    <option value="VENDOR">Seller / Vendor Tasks</option>
                    <option value="CREDIT">Credit Tasks</option>
                    <option value="CATEGORY">Category Tasks</option>
                    <option value="PAYMENT">Payment Tasks</option>
                    <option value="GENERAL">General Operational Tasks</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Assigned To</label>
                  <input
                    type="text"
                    value={draftFilters.assignedTo}
                    onChange={(e) => handleDraftFilterChange('assignedTo', e.target.value)}
                    placeholder="Search by executive name..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Due Date Range</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={draftFilters.dueFrom}
                      onChange={(e) => handleDraftFilterChange('dueFrom', e.target.value)}
                      className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    />
                    <input
                      type="date"
                      value={draftFilters.dueTo}
                      onChange={(e) => handleDraftFilterChange('dueTo', e.target.value)}
                      className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={handleResetFilters}
                  className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400"
                >
                  Reset All
                </button>
                <button
                  onClick={handleApplyFilters}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* CREATE INTERNAL TASK MODAL                                     */}
      {/* ============================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            onClick={() => setIsCreateModalOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            data-testid="create-modal-backdrop"
          />

          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Create Internal Task</h3>
                </div>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  data-testid="create-modal-close-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Task Title *</label>
                  <input
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Audit Mechanical Spares RFQ Quotes"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Description</label>
                  <textarea
                    rows={2}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Provide operational context or background instructions..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Task Type</label>
                    <select
                      value={newTaskTypeId}
                      onChange={(e) => setNewTaskTypeId(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    >
                      {taskTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Priority</label>
                    <select
                      value={newPriority}
                      onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    >
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Assigned To</label>
                    <input
                      type="text"
                      value={newAssignedToName}
                      onChange={(e) => setNewAssignedToName(e.target.value)}
                      placeholder="e.g. Sudheer Kangala"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Due Date</label>
                    <input
                      type="date"
                      value={newDueDate}
                      onChange={(e) => setNewDueDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Internal Notes</label>
                  <textarea
                    rows={2}
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Private notes for team executives..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition-all"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TASK DETAILS DRAWER                                            */}
      {/* ============================================================== */}
      {selectedTaskDetails && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            onClick={() => setSelectedTaskDetails(null)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            data-testid="details-drawer-backdrop"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs text-slate-400 font-bold">
                    {selectedTaskDetails.task_number}
                  </span>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {selectedTaskDetails.title}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedTaskDetails(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                  data-testid="details-drawer-close-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
                {/* Description */}
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Description</span>
                  <p className="text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {selectedTaskDetails.description || 'No description provided.'}
                  </p>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Module</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedTaskDetails.related_entity_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Linked Entity</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">
                      {selectedTaskDetails.related_entity_label || 'Direct'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Priority</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedTaskDetails.priority}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Status</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedTaskDetails.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Assigned To</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedTaskDetails.assigned_to_name || 'Unassigned'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Due Date</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {selectedTaskDetails.due_date || 'None'}
                    </span>
                  </div>
                </div>

                {selectedTaskDetails.notes && (
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Notes</span>
                    <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-lg text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">
                      {selectedTaskDetails.notes}
                    </div>
                  </div>
                )}

                {/* Escalate from details drawer */}
                <div className="pt-2">
                  <button
                    onClick={() => {
                      handleOpenEscalateModal(selectedTaskDetails);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-300 bg-orange-50/50 dark:bg-orange-950/20 rounded-lg font-semibold hover:bg-orange-100 transition-colors"
                    data-testid="drawer-escalate-btn"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Escalate Task to Co-exec / Manager</span>
                  </button>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => handleDeleteTask(selectedTaskDetails.id, selectedTaskDetails.task_number)}
                  className="text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1"
                  data-testid="drawer-delete-task-btn"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Task</span>
                </button>
                <button
                  onClick={() => setSelectedTaskDetails(null)}
                  className="px-4 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold text-slate-700 dark:text-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
