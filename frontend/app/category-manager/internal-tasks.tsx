'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Send,
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
  fetchInternalAssignees,
  completeInternalTask,
  type InternalTeamMember,
} from '@/lib/internalTaskClient';
import { DEFAULT_INTERNAL_MEMBERS } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';
import type { UserSession, PaymentDuesSummary, TicketSummary, ApprovalSummary } from '@/lib/types';

import ActionCenterSubNav, { type ActionCenterTabKey } from './components/ActionCenterSubNav';
import { TicketsDashboard } from './components/TicketsDashboard';
import { ApprovalsDashboard } from './components/ApprovalsDashboard';
import { ScorecardDashboard } from './components/ScorecardDashboard';
import BuyersDirectory from './buyers-directory';
import SellersDirectory from './sellers-directory';
import RegistrationsDashboard from './components/RegistrationsDashboard';
import { PaymentDuesDashboard } from './components/PaymentDuesDashboard';
import { fetchPaymentDuesSummary } from '@/lib/paymentDuesClient';
import { fetchTicketSummary } from '@/lib/ticketClient';
import { fetchApprovalSummary } from '@/lib/approvalClient';
import ActionCenterComposeModal from './components/ActionCenterComposeModal';

export default function InternalTasksDashboard() {
  // Data state
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [totalTasks, setTotalTasks] = useState<number>(0);
  const [assignees, setAssignees] = useState<InternalTeamMember[]>(DEFAULT_INTERNAL_MEMBERS);
  const [sessionUser, setSessionUser] = useState<UserSession | null>(null);
  const [isMyTasksActive, setIsMyTasksActive] = useState<boolean>(false);
  const [isCustomAssignee, setIsCustomAssignee] = useState<boolean>(false);
  const [newAssignedToUserId, setNewAssignedToUserId] = useState<string>('');
  const [showCompleteSection, setShowCompleteSection] = useState<boolean>(false);
  const [completionRemarks, setCompletionRemarks] = useState<string>('');
  const [isCompleting, setIsCompleting] = useState<boolean>(false);
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

  // Active Action Center tab state
  const [activeTab, setActiveTab] = useState<ActionCenterTabKey>('tasks');
  const [selectedBuyerDossierId, setSelectedBuyerDossierId] = useState<string | undefined>(undefined);
  const [selectedSellerDossierId, setSelectedSellerDossierId] = useState<string | undefined>(undefined);
  const [ticketSummary, setTicketSummary] = useState<TicketSummary | null>(null);
  const [approvalSummary, setApprovalSummary] = useState<ApprovalSummary | null>(null);
  const [paymentDuesSummary, setPaymentDuesSummary] = useState<PaymentDuesSummary | null>(null);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState<boolean>(false);

  useEffect(() => {
      const tabParam = new URLSearchParams(window.location.search).get('tab') as ActionCenterTabKey;
      const validTabs: ActionCenterTabKey[] = [
        'tasks',
        'tickets',
        'approvals',
        'scorecard',
        'buyers',
        'sellers',
        'registrations',
        'payment_dues',
      ];
      if (tabParam && validTabs.includes(tabParam)) {
        setActiveTab(tabParam);
      }
  }, []);

  useEffect(() => {
    fetchTicketSummary()
      .then((res) => {
        if (res) setTicketSummary(res);
      })
      .catch(() => {});

    fetchApprovalSummary()
      .then((res) => {
        if (res) setApprovalSummary(res);
      })
      .catch(() => {});

    fetchPaymentDuesSummary()
      .then((res) => {
        if (res) setPaymentDuesSummary(res);
      })
      .catch(() => {});

    fetchInternalAssignees()
      .then((res) => {
        if (res && res.length > 0) setAssignees(res);
      })
      .catch(() => {});

    const currentUser = authClient.getSessionUser();
    if (currentUser) {
      setSessionUser(currentUser);
    }
  }, []);

  useEffect(() => {
    const handlePaymentDuesUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<PaymentDuesSummary>;
      if (customEvent.detail) {
        setPaymentDuesSummary(customEvent.detail);
      }
    };
    window.addEventListener('qua_payment_dues_updated', handlePaymentDuesUpdate);
    return () => window.removeEventListener('qua_payment_dues_updated', handlePaymentDuesUpdate);
  }, []);

  const handleSelectTab = useCallback((tab: ActionCenterTabKey) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState({}, '', url.toString());
  }, []);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 20;

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedTaskDetails, setSelectedTaskDetails] = useState<InternalTask | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Create Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTaskTypeId, setNewTaskTypeId] = useState<string>(DEFAULT_TASK_TYPES[0]?.id || '');
  const [newPriority, setNewPriority] = useState<TaskPriority>('Medium');
  const [newStatus, setNewStatus] = useState<TaskStatus>('Pending');
  const [newAssignedToName, setNewAssignedToName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isCreatingTypeInline, setIsCreatingTypeInline] = useState(false);
  const [customTypeName, setCustomTypeName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Calculate active filter count
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
  const loadSummary = useCallback(async (assigneeFilter?: string) => {
    const filterVal = assigneeFilter !== undefined ? assigneeFilter : activeFilters.assignedTo;
    const sum = await fetchTaskSummary({ assignedTo: filterVal });
    setSummary(sum);
  }, [activeFilters.assignedTo]);

  // Load Tasks from Database
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchInternalTasks({
        search: searchQuery,
        ...activeFilters,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      });
      setTasks(res.tasks);
      setTotalTasks(res.total);
    } catch {
      setErrorMessage('Unable to load internal tasks from database.');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, activeFilters, currentPage]);

  useEffect(() => {
    loadTaskTypes();
    loadSummary();
  }, [loadTaskTypes, loadSummary]);

  const prevTabRef = useRef<ActionCenterTabKey>(activeTab);
  useEffect(() => {
    if (activeTab === 'tasks' && prevTabRef.current !== 'tasks') {
      loadTasks();
      loadSummary();
    }
    prevTabRef.current = activeTab;
  }, [activeTab, loadTasks, loadSummary]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Handle Toolbar Assignee change
  const handleAssigneeChange = (assigneeVal: string) => {
    const nextVal = assigneeVal === 'all' ? '' : assigneeVal;
    setActiveFilters((prev) => ({ ...prev, assignedTo: nextVal }));
    setDraftFilters((prev) => ({ ...prev, assignedTo: nextVal }));
    setCurrentPage(1);
    const isMe = Boolean(
      sessionUser?.name && nextVal.trim().toLowerCase() === sessionUser.name.trim().toLowerCase()
    );
    setIsMyTasksActive(isMe);
    loadSummary(nextVal);
  };

  // Handle Quick "My Tasks" toggle
  const handleToggleMyTasks = () => {
    if (isMyTasksActive) {
      handleAssigneeChange('all');
    } else {
      const myName = sessionUser?.name || 'My Tasks';
      handleAssigneeChange(myName);
      setIsMyTasksActive(true);
    }
  };

  // Handle Detailed Complete Task from Drawer
  const handleCompleteTaskWithRemarks = async () => {
    if (!selectedTaskDetails) return;
    setIsCompleting(true);
    try {
      const updated = await completeInternalTask(selectedTaskDetails.id, completionRemarks.trim());
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        loadSummary();
        setShowCompleteSection(false);
        setCompletionRemarks('');
        showToast(
          formatString(UI_STRINGS.actionCenter.tasks.taskMarkedCompleted, {
            taskNumber: updated.task_number || updated.id,
          })
        );
      } else {
        showToast('Failed to complete task.');
      }
    } catch {
      showToast('Error completing task.');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleReopenTaskFromDrawer = async () => {
    if (!selectedTaskDetails) return;
    setIsCompleting(true);
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        status: 'Pending',
        activityComment: 'Task reopened as Pending',
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        loadSummary();
        showToast(
          formatString(UI_STRINGS.actionCenter.tasks.taskReopened, {
            taskNumber: updated.task_number || updated.id,
          })
        );
      }
    } catch {
      showToast('Error reopening task.');
    } finally {
      setIsCompleting(false);
    }
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
      const msg = nextStatus === 'Completed'
        ? formatString(UI_STRINGS.actionCenter.tasks.taskMarkedCompleted, { taskNumber: task.task_number || task.id })
        : formatString(UI_STRINGS.actionCenter.tasks.taskReopened, { taskNumber: task.task_number || task.id });
      showToast(msg);
    }
  };

  // Handle Create Task Submission
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setIsSubmitting(true);
    try {
      let finalTypeId = newTaskTypeId;

      // If user typed a custom task type inline
      if (isCreatingTypeInline && customTypeName.trim()) {
        const createdType = await createNewTaskType({
          name: customTypeName.trim(),
          defaultModule: 'GENERAL',
        });
        if (createdType) {
          finalTypeId = createdType.id;
          await loadTaskTypes();
        }
      }

      const selectedType = taskTypes.find((t) => t.id === finalTypeId);
      const newTask = await createInternalTask({
        title: newTitle.trim(),
        description: newDescription.trim(),
        taskTypeId: finalTypeId || undefined,
        priority: newPriority,
        status: newStatus,
        assignedToUserId: newAssignedToUserId || undefined,
        assignedToName: newAssignedToName.trim() || 'Unassigned',
        dueDate: newDueDate || undefined,
        relatedEntityType: (selectedType?.default_module as TaskEntityType) || 'GENERAL',
        notes: newNotes.trim(),
      });

      if (newTask) {
        setIsCreateModalOpen(false);
        // Reset form
        setNewTitle('');
        setNewDescription('');
        setNewNotes('');
        setNewAssignedToName('');
        setNewAssignedToUserId('');
        setIsCustomAssignee(false);
        setNewDueDate('');
        setIsCreatingTypeInline(false);
        setCustomTypeName('');
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

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
        activeTab === 'payment_dues' ? 'p-2 sm:p-3 md:p-4 space-y-4' : 'p-4 md:p-6 space-y-6'
      }`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Action Center SubNav Header */}
      <ActionCenterSubNav
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        tasksCount={summary.pending || 0}
        ticketsCount={ticketSummary?.pending || 0}
        approvalsCount={approvalSummary?.pending || 0}
        paymentDuesCount={paymentDuesSummary?.totalLowCreditAccounts || 0}
      />

      {activeTab === 'tickets' && <TicketsDashboard />}
      {activeTab === 'approvals' && <ApprovalsDashboard />}
      {activeTab === 'scorecard' && <ScorecardDashboard />}
      {activeTab === 'buyers' && <BuyersDirectory initialBuyerId={selectedBuyerDossierId} />}
      {activeTab === 'sellers' && <SellersDirectory initialSellerId={selectedSellerDossierId} />}
      {activeTab === 'registrations' && <RegistrationsDashboard />}
      {activeTab === 'payment_dues' && <PaymentDuesDashboard onSummaryChange={setPaymentDuesSummary} />}
{activeTab === 'tasks' && (
        <>
          {/* Header & Metric Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Action Center</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Dynamic task governance, real-time assignment, cross-module workflow tracking, and escalation management.
          </p>
        </div>

        {/* Minimal Summary KPI Counters */}
        <div className="flex items-center gap-2 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm">
            <span className="text-slate-500 font-medium">Total:</span>
            <span className="font-bold text-slate-900 dark:text-white">{summary.total}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-lg">
            <span className="text-amber-700 dark:text-amber-300 font-medium">Pending:</span>
            <span className="font-bold text-amber-900 dark:text-amber-100">{summary.pending}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-lg">
            <span className="text-blue-700 dark:text-blue-300 font-medium">In Progress:</span>
            <span className="font-bold text-blue-900 dark:text-blue-100">{summary.inProgress}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 rounded-lg">
            <span className="text-rose-700 dark:text-rose-300 font-medium">Escalated:</span>
            <span className="font-bold text-rose-900 dark:text-rose-100">{summary.escalated}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-lg">
            <span className="text-emerald-700 dark:text-emerald-300 font-medium">Completed:</span>
            <span className="font-bold text-emerald-900 dark:text-emerald-100">{summary.completed}</span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* TOP SECTION: Search bar, Create Task, Export, and Filter only */}
      {/* ============================================================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by title, task ID, related entity, or notes..."
            className="w-full bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          {/* Quick "My Tasks" Button */}
          <button
            type="button"
            onClick={handleToggleMyTasks}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              isMyTasksActive
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            title={UI_STRINGS.actionCenter.tasks.myTasks}
            data-testid="toolbar-my-tasks-btn"
          >
            <User className="w-3.5 h-3.5" />
            <span>{UI_STRINGS.actionCenter.tasks.myTasks}</span>
          </button>

          {/* Internal User / Assignee Dropdown */}
          <div className="relative">
            <select
              value={activeFilters.assignedTo || 'all'}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              aria-label={UI_STRINGS.actionCenter.tasks.selectAssignee}
              data-testid="toolbar-assignee-select"
            >
              <option value="all">{UI_STRINGS.actionCenter.tasks.allUsers}</option>
              {sessionUser?.name && (
                <option value={sessionUser.name}>
                  {UI_STRINGS.actionCenter.tasks.myTasks} ({sessionUser.name})
                </option>
              )}
              <option value="Unassigned">{UI_STRINGS.actionCenter.tasks.unassigned}</option>
              <optgroup label="Internal Team Members">
                {assignees.map((m) => (
                  <option key={m.id || m.name} value={m.name}>
                    {m.name} {m.role ? `• ${m.role}` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Filter Button */}
          <button
            onClick={handleOpenFilterDrawer}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              activeFilterCount > 0
                ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-700 dark:text-blue-300 shadow-sm'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Export Button */}
          <a
            href={exportUrl}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
          </a>

          {/* Quick Compose SMS / Email Button */}
          <button
            type="button"
            onClick={() => setIsComposeModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-all shadow-sm"
            title="Dispatch SMS or Email Notification"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send SMS / Email</span>
          </button>

          {/* Create Internal Task Button */}
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm shadow-blue-600/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Internal Task</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => {
              loadTasks();
              loadSummary();
              showToast('Refreshed data.');
            }}
            className="p-1.5 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* DATA TABLE VIEW / EMPTY STATE / LOADING                        */}
      {/* ============================================================== */}
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
          /* Proper Empty State */
          <div className="py-16 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <ClipboardList className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">No internal tasks found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              There are no tasks matching your query, or no tasks have been created yet.
            </p>
            <div className="pt-2">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Task</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold tracking-wide">
                <tr>
                  <th className="py-3 px-3.5 w-12 text-center">Status</th>
                  <th className="py-3 px-3.5 min-w-[220px]">Task Subject & ID</th>
                  <th className="py-3 px-3.5 min-w-[160px]">Related Entity</th>
                  <th className="py-3 px-3.5 w-32">Task Type</th>
                  <th className="py-3 px-3.5 w-24">Priority</th>
                  <th className="py-3 px-3.5 min-w-[130px]">Assigned To</th>
                  <th className="py-3 px-3.5 w-28">Due Date</th>
                  <th className="py-3 px-3.5 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {tasks.map((task) => {
                  const overdueInfo = getDaysOverdueOrRemaining(task.due_date, task.status);

                  return (
                    <tr
                      key={task.id}
                      onClick={() => setSelectedTaskDetails(task)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                      data-testid={`task-row-${task.id}`}
                    >
                      {/* Checkbox toggle */}
                      <td className="py-3 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={task.status === 'Completed'}
                          onChange={() => handleToggleStatus(task)}
                          className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>

                      {/* Task title, ID & description */}
                      <td className="py-3 px-3.5">
                        <div
                          className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors"
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

                      {/* Related Entity Badge */}
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase ${
                              task.related_entity_type === 'RFQ'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                                : task.related_entity_type === 'BUYER'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                                : task.related_entity_type === 'VENDOR'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : task.related_entity_type === 'CREDIT' || task.related_entity_type === 'PAYMENT'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                : task.related_entity_type === 'CATEGORY'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {task.related_entity_type}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-200 line-clamp-1">
                            {task.related_entity_label || 'Direct Task'}
                          </span>
                        </div>
                      </td>

                      {/* Task Type */}
                      <td className="py-3 px-3.5">
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded">
                          {task.task_type_name || task.task_type_id || 'General Task'}
                        </span>
                      </td>

                      {/* Priority */}
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

                      {/* Assigned To */}
                      <td className="py-3 px-3.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] flex items-center justify-center font-bold text-slate-600 dark:text-slate-300">
                            {(task.assigned_to_name || 'U').slice(0, 1)}
                          </div>
                          <span className="font-medium">{task.assigned_to_name || 'Unassigned'}</span>
                        </div>
                      </td>

                      {/* Due Date & Overdue Badge */}
                      <td className="py-3 px-3.5">
                        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {task.due_date || '—'}
                        </div>
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

                      {/* Actions */}
                      <td className="py-3 px-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
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

      {/* ============================================================== */}
      {/* RIGHT-SIDE FILTER DRAWER / SIDEBAR (Matches User Request)      */}
      {/* ============================================================== */}
      {isFilterDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop blur */}
          <div
            onClick={() => setIsFilterDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            data-testid="filter-drawer-backdrop"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-sm bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
              {/* Drawer Header */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Filter Tasks</h3>
                </div>
                <button
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer Form Fields */}
              <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
                {/* Status */}
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Status</label>
                  <select
                    value={draftFilters.status}
                    onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
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

                {/* Priority */}
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Priority</label>
                  <select
                    value={draftFilters.priority}
                    onChange={(e) => setDraftFilters({ ...draftFilters, priority: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Priorities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                {/* Related Module / Entity */}
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                    Related Module / Entity
                  </label>
                  <select
                    value={draftFilters.relatedEntityType}
                    onChange={(e) => setDraftFilters({ ...draftFilters, relatedEntityType: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Modules</option>
                    <option value="RFQ">RFQ Tasks</option>
                    <option value="BUYER">Buyer Tasks</option>
                    <option value="VENDOR">Seller / Vendor Tasks</option>
                    <option value="CREDIT">Credit Tasks</option>
                    <option value="CATEGORY">Category Tasks</option>
                    <option value="PAYMENT">Payment Tasks</option>
                    <option value="USER">User / Account Tasks</option>
                    <option value="GENERAL">General Operational Tasks</option>
                  </select>
                </div>

                {/* Task Type (Dynamic from DB) */}
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Task Type</label>
                  <select
                    value={draftFilters.taskTypeId}
                    onChange={(e) => setDraftFilters({ ...draftFilters, taskTypeId: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="all">All Task Types</option>
                    {taskTypes.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name} ({tt.default_module})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assigned To */}
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Assigned User</label>
                  <input
                    type="text"
                    value={draftFilters.assignedTo}
                    onChange={(e) => setDraftFilters({ ...draftFilters, assignedTo: e.target.value })}
                    placeholder="Search assignee name..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>

                {/* Due Date Range */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-slate-700 dark:text-slate-300 block">Due Date Range</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400">Due From</span>
                      <input
                        type="date"
                        value={draftFilters.dueFrom}
                        onChange={(e) => setDraftFilters({ ...draftFilters, dueFrom: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Due To</span>
                      <input
                        type="date"
                        value={draftFilters.dueTo}
                        onChange={(e) => setDraftFilters({ ...draftFilters, dueTo: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/50">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3.5 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors text-center"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CREATE INTERNAL TASK (Dynamic & Relational)              */}
      {/* ============================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Create Internal Task</h3>
                  <p className="text-[11px] text-slate-400">Save new task into real database with relational links</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5 text-xs">
              {/* Title */}
              <div>
                <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Verify mechanical spare specifications for Tata Steel RFQ"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Description</label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Provide context, deliverables, or criteria for completion..."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Task Type (Dynamic) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">Task Type *</label>
                  <button
                    type="button"
                    onClick={() => setIsCreatingTypeInline(!isCreatingTypeInline)}
                    className="text-[11px] font-semibold text-blue-600 hover:underline"
                  >
                    {isCreatingTypeInline ? 'Choose Existing' : '+ Add Custom Task Type'}
                  </button>
                </div>

                {isCreatingTypeInline ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customTypeName}
                      onChange={(e) => setCustomTypeName(e.target.value)}
                      placeholder="e.g. GST Exemption Verification"
                      className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs"
                    />
                  </div>
                ) : (
                  <select
                    value={newTaskTypeId}
                    onChange={(e) => setNewTaskTypeId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="">Select Task Type</option>
                    {taskTypes.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name} ({tt.default_module})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Priority & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                  >
                    <option value="Pending">Pending</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Escalated">Escalated</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              {/* Assigned User & Due Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      {UI_STRINGS.actionCenter.tasks.assignedToUser}
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCustomAssignee(!isCustomAssignee)}
                      className="text-[10px] font-semibold text-blue-600 hover:underline"
                    >
                      {isCustomAssignee
                        ? UI_STRINGS.actionCenter.tasks.chooseExistingMember
                        : UI_STRINGS.actionCenter.tasks.customAssignee}
                    </button>
                  </div>
                  {isCustomAssignee ? (
                    <input
                      type="text"
                      value={newAssignedToName}
                      onChange={(e) => {
                        setNewAssignedToName(e.target.value);
                        setNewAssignedToUserId('');
                      }}
                      placeholder="e.g. Sudheer Kangala"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                      data-testid="custom-assignee-input"
                    />
                  ) : (
                    <select
                      value={newAssignedToName}
                      onChange={(e) => {
                        const member = assignees.find((m) => m.name === e.target.value);
                        setNewAssignedToName(e.target.value);
                        setNewAssignedToUserId(member?.id || '');
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                      data-testid="select-assignee-dropdown"
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((m) => (
                        <option key={m.id || m.name} value={m.name}>
                          {m.name} {m.role ? `• ${m.role}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
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

              {/* Notes */}
              <div>
                <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Notes & Internal Comments
                </label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Optional internal remarks or instructions..."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm shadow-blue-600/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving to Database...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* DRAWER: TASK DETAILS & ACTIVITY AUDIT TIMELINE                 */}
      {/* ============================================================== */}
      {selectedTaskDetails && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            onClick={() => setSelectedTaskDetails(null)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            data-testid="task-details-backdrop"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200 text-xs">
              {/* Header */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-blue-600 font-bold">
                    {selectedTaskDetails.task_number}
                  </span>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">Task Details</h3>
                </div>
                <button
                  onClick={() => setSelectedTaskDetails(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  data-testid="task-details-close-x"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <div>
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Subject</span>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedTaskDetails.title}
                  </h4>
                  {selectedTaskDetails.description && (
                    <p className="text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {selectedTaskDetails.description}
                    </p>
                  )}
                </div>

                {/* Completion Status & Action Section */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold uppercase">Execution Status</span>
                      <span className={`font-bold text-xs ${
                        selectedTaskDetails.status === 'Completed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {selectedTaskDetails.status}
                        {selectedTaskDetails.completed_at && ` (Finished ${selectedTaskDetails.completed_at.slice(0, 10)})`}
                      </span>
                    </div>

                    {selectedTaskDetails.status === 'Completed' ? (
                      <button
                        type="button"
                        onClick={handleReopenTaskFromDrawer}
                        disabled={isCompleting}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                        data-testid="drawer-reopen-task-btn"
                      >
                        <RefreshCw className="w-3 h-3 text-slate-500" />
                        <span>{UI_STRINGS.actionCenter.tasks.reopenTaskBtn}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowCompleteSection(!showCompleteSection)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition-colors"
                        data-testid="drawer-mark-complete-btn"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{UI_STRINGS.actionCenter.tasks.completeTaskBtn}</span>
                      </button>
                    )}
                  </div>

                  {/* Optional Resolution Notes Section when completing */}
                  {showCompleteSection && selectedTaskDetails.status !== 'Completed' && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {UI_STRINGS.actionCenter.tasks.resolutionRemarksLabel}
                      </label>
                      <textarea
                        rows={2}
                        value={completionRemarks}
                        onChange={(e) => setCompletionRemarks(e.target.value)}
                        placeholder={UI_STRINGS.actionCenter.tasks.resolutionRemarksPlaceholder}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                        data-testid="completion-remarks-input"
                      />
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowCompleteSection(false);
                            setCompletionRemarks('');
                          }}
                          className="px-2.5 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isCompleting}
                          onClick={handleCompleteTaskWithRemarks}
                          className="px-3 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
                          data-testid="confirm-complete-task-btn"
                        >
                          {isCompleting ? 'Saving...' : 'Confirm & Complete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

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
                    {selectedTaskDetails.related_entity_id && (selectedTaskDetails.related_entity_type === 'BUYER' || selectedTaskDetails.related_entity_type === 'VENDOR') && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedTaskDetails.related_entity_type === 'BUYER') {
                            setSelectedBuyerDossierId(selectedTaskDetails.related_entity_id);
                            setActiveTab('buyers');
                            setSelectedTaskDetails(null);
                          } else {
                            setSelectedSellerDossierId(selectedTaskDetails.related_entity_id);
                            setActiveTab('sellers');
                            setSelectedTaskDetails(null);
                          }
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                      >
                        <ExternalLink size={12} />
                        <span>View {selectedTaskDetails.related_entity_type === 'BUYER' ? 'Buyer' : 'Supplier'} Dossier</span>
                      </button>
                    )}
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
                    <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-lg text-slate-700 dark:text-slate-300 mt-1">
                      {selectedTaskDetails.notes}
                    </div>
                  </div>
                )}

                {/* Audit Timeline */}
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block">Activity Log</span>
                  <div className="space-y-2">
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{selectedTaskDetails.created_by_name || 'System'}</span>
                        <span>{selectedTaskDetails.created_at}</span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 font-medium mt-0.5">
                        Task created in database.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Drawer Footer */}
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
        </>
      )}

      {isComposeModalOpen && (
        <ActionCenterComposeModal
          isOpen={isComposeModalOpen}
          onClose={() => setIsComposeModalOpen(false)}
          entityType="internal_task"
          entityId="general-task"
          defaultSubject="Task Notification"
          defaultRecipientName={sessionUser?.name || 'Category Manager'}
          defaultRecipientEmail={sessionUser?.email || ''}
        />
      )}
    </div>
  );
}
