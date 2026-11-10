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
  RotateCcw,
  FolderOpen,
  ClipboardList,
  Flame,
  Check,
  ChevronDown,
  Send,
  Bell,
  ShieldCheck,
  CheckCheck,
  XCircle,
  Phone,
  MessageSquare,
  Mail,
  Award,
  CreditCard,
  Users,
  Settings,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GripVertical,
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
  approveCreditTask,
  rejectCreditTask,
  addTaskActivity,
  checkTaskReminders,
  exportTasksToCsv,
  type InternalTeamMember,
} from '@/lib/internalTaskClient';
import {
  DEFAULT_INTERNAL_MEMBERS,
  INTERNAL_TASK_CATEGORIES,
  INTERNAL_TASK_CATEGORY_LABELS,
  INTERNAL_TASK_CATEGORY_TYPES,
  INTERNAL_TASK_STATUSES,
  INTERNAL_TASK_PRIORITIES,
  DEMO_STATUSES,
  CREDIT_ACCOUNT_TYPES,
  CALL_OUTCOMES,
  PROPOSAL_STATUSES,
  ONBOARDING_STAGES,
} from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { authClient } from '@/lib/authClient';
import type {
  UserSession,
  PaymentDuesSummary,
  TicketSummary,
  ApprovalSummary,
  InternalTaskCategory,
  CreditAccountType,
  DemoStatus,
  ActionCenterSummaryPopupColumn,
} from '@/lib/types';

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
import DocumentVaultDashboard from './components/DocumentVaultDashboard';
import LoginLogsDashboard from './components/LoginLogsDashboard';
import ActionCenterSummaryPopupModal from './components/ActionCenterSummaryPopupModal';
import ColumnSettingsPopup, { type ColumnDef } from './components/ColumnSettingsPopup';


const DEFAULT_TASK_TABLE_COLUMNS: ColumnDef[] = [
  { key: 'done', label: 'Done', visible: true, required: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'task', label: 'Task Subject & ID', visible: true, required: true },
  { key: 'category', label: 'Category & Type', visible: true },
  { key: 'entity', label: 'Related Entity', visible: true },
  { key: 'priority', label: 'Priority', visible: true },
  { key: 'assignedTo', label: 'Assigned To', visible: true },
  { key: 'dueDate', label: 'Due Date & Time', visible: true },
  { key: 'actions', label: 'Actions', visible: true, required: true },
];
const TASK_COL_PREF_KEY = 'qua_internal_task_col_prefs';

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
  const [completionConfirmed, setCompletionConfirmed] = useState<boolean>(false);
  const [isCompleting, setIsCompleting] = useState<boolean>(false);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>(DEFAULT_TASK_TYPES);
  const [summary, setSummary] = useState<TaskSummary>({
    total: 0,
    newTasks: 0,
    assigned: 0,
    inProgress: 0,
    pendingApproval: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    overdueCount: 0,
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

  // Column customization & sorting states
  const [taskColumns, setTaskColumns] = useState<ColumnDef[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(TASK_COL_PREF_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return DEFAULT_TASK_TABLE_COLUMNS;
  });
  const [showTaskColumnSettings, setShowTaskColumnSettings] = useState<boolean>(false);
  const [taskSortField, setTaskSortField] = useState<string>('');
  const [taskSortOrder, setTaskSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleTaskSort = useCallback((field: string) => {
    setTaskSortField((prev) => {
      if (prev === field) {
        setTaskSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setTaskSortOrder('asc');
      return field;
    });
  }, []);

  const isColVisible = useCallback(
    (key: string) => {
      const col = taskColumns.find((c) => c.key === key);
      return col ? col.visible : true;
    },
    [taskColumns]
  );

  const TaskSortIcon = ({ field }: { field: string }) => {
    if (taskSortField !== field) return <ArrowUpDown size={11} className="inline ml-1 text-slate-400" />;
    return taskSortOrder === 'asc' ? (
      <ArrowUp size={11} className="inline ml-1 text-indigo-600" />
    ) : (
      <ArrowDown size={11} className="inline ml-1 text-indigo-600" />
    );
  };

  const visibleTaskColumns = useMemo(() => taskColumns.filter((c) => c.visible), [taskColumns]);

  const sortedTasks = useMemo(() => {
    if (!taskSortField) return tasks;
    const list = [...tasks];
    list.sort((a, b) => {
      let cmp = 0;
      if (taskSortField === 'dueDate') {
        const aT = a.due_date ? new Date(a.due_date).getTime() : 0;
        const bT = b.due_date ? new Date(b.due_date).getTime() : 0;
        cmp = aT - bT;
      } else if (taskSortField === 'task') {
        cmp = (a.title || '').localeCompare(b.title || '');
      } else if (taskSortField === 'status') {
        cmp = (a.status || '').localeCompare(b.status || '');
      } else if (taskSortField === 'priority') {
        const rank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
        cmp = (rank[a.priority] || 0) - (rank[b.priority] || 0);
      } else if (taskSortField === 'category') {
        cmp = (a.task_category || '').localeCompare(b.task_category || '');
      } else if (taskSortField === 'assignedTo') {
        cmp = (a.assigned_to_name || '').localeCompare(b.assigned_to_name || '');
      }
      return taskSortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [tasks, taskSortField, taskSortOrder]);

  // Summary Card Popup Modal State
  const [summaryModalState, setSummaryModalState] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    totalCount: number;
    records: InternalTask[];
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    totalCount: 0,
    records: [],
  });


  // Credit approval action state in Drawer
  const [creditApprovalRemarks, setCreditApprovalRemarks] = useState<string>('');
  const [isProcessingCreditAction, setIsProcessingCreditAction] = useState<boolean>(false);

  // New activity remark in Drawer
  const [newActivityComment, setNewActivityComment] = useState<string>('');
  const [isAddingActivity, setIsAddingActivity] = useState<boolean>(false);

  // Communication Task: Log Call Outcome
  const [selectedCallOutcome, setSelectedCallOutcome] = useState<string>('Connected');
  const [isLoggingCallOutcome, setIsLoggingCallOutcome] = useState<boolean>(false);

  // Demo Scheduling: Reschedule Demo & Status
  const [demoStatusVal, setDemoStatusVal] = useState<DemoStatus>('Scheduled');
  const [rescheduleDate, setRescheduleDate] = useState<string>('');
  const [rescheduleTime, setRescheduleTime] = useState<string>('');
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [isReschedulingDemo, setIsReschedulingDemo] = useState<boolean>(false);

  // Business Development: Proposal Status Tracking
  const [selectedProposalStatus, setSelectedProposalStatus] = useState<string>('Draft');
  const [isUpdatingProposal, setIsUpdatingProposal] = useState<boolean>(false);

  // Onboarding: Milestone Stepper
  const [isAdvancingStage, setIsAdvancingStage] = useState<boolean>(false);

  // Attachments Management
  const [showAddAttachment, setShowAddAttachment] = useState<boolean>(false);
  const [newAttachmentName, setNewAttachmentName] = useState<string>('');
  const [newAttachmentUrl, setNewAttachmentUrl] = useState<string>('');
  const [isAddingAttachment, setIsAddingAttachment] = useState<boolean>(false);

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
      'document_vault',
      'login_logs',
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
    taskCategory: 'all',
    taskType: 'all',
    taskTypeId: 'all',
    relatedEntityType: 'all',
    assignedTo: '',
    createdBy: '',
    dueFrom: '',
    dueTo: '',
  });

  // Draft filter state inside the drawer
  const [draftFilters, setDraftFilters] = useState<TaskFilterParams>({
    status: 'all',
    priority: 'all',
    taskCategory: 'all',
    taskType: 'all',
    taskTypeId: 'all',
    relatedEntityType: 'all',
    assignedTo: '',
    createdBy: '',
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCreateModalOpen) {
          setIsCreateModalOpen(false);
        } else if (selectedTaskDetails) {
          setSelectedTaskDetails(null);
        } else if (isFilterDrawerOpen) {
          setIsFilterDrawerOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateModalOpen, selectedTaskDetails, isFilterDrawerOpen]);

  // Create Form State with Category Architecture
  const [newCategory, setNewCategory] = useState<InternalTaskCategory>('COMMUNICATION');
  const [newTaskType, setNewTaskType] = useState<string>('Phone Call');
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTaskTypeId, setNewTaskTypeId] = useState<string>(DEFAULT_TASK_TYPES[0]?.id || '');
  const [newPriority, setNewPriority] = useState<TaskPriority>('Medium');
  const [newStatus, setNewStatus] = useState<TaskStatus>('Pending');
  const [newAssignedToName, setNewAssignedToName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDueTime, setNewDueTime] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isCreatingTypeInline, setIsCreatingTypeInline] = useState(false);
  const [customTypeName, setCustomTypeName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Category-specific form state
  const [newCreditAccountType, setNewCreditAccountType] = useState<CreditAccountType>('BUYER');
  const [newCreditAccountName, setNewCreditAccountName] = useState('');
  const [newCreditAccountId, setNewCreditAccountId] = useState('');
  const [newCreditQuantity, setNewCreditQuantity] = useState<number>(10);
  const [newCreditReason, setNewCreditReason] = useState('');
  const [newDemoDate, setNewDemoDate] = useState('');
  const [newDemoTime, setNewDemoTime] = useState('');
  const [newDemoStatus, setNewDemoStatus] = useState<DemoStatus>('Scheduled');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (activeFilters.status && activeFilters.status !== 'all') count++;
    if (activeFilters.priority && activeFilters.priority !== 'all') count++;
    if (activeFilters.taskCategory && activeFilters.taskCategory !== 'all') count++;
    if (activeFilters.taskTypeId && activeFilters.taskTypeId !== 'all') count++;
    if (activeFilters.relatedEntityType && activeFilters.relatedEntityType !== 'all') count++;
    if (activeFilters.assignedTo && activeFilters.assignedTo.trim()) count++;
    if (activeFilters.createdBy && activeFilters.createdBy.trim()) count++;
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
  const loadSummary = useCallback(
    async (assigneeFilter?: string, categoryFilter?: string) => {
      const filterVal = assigneeFilter !== undefined ? assigneeFilter : activeFilters.assignedTo;
      const catVal = categoryFilter !== undefined ? categoryFilter : activeFilters.taskCategory;
      const params: { assignedTo?: string; taskCategory?: string } = { assignedTo: filterVal };
      if (catVal && catVal !== 'all') {
        params.taskCategory = catVal;
      }
      const sum = await fetchTaskSummary(params);
      setSummary(sum);
    },
    [activeFilters.assignedTo, activeFilters.taskCategory]
  );

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

  // Handle Toolbar Category change
  const handleCategoryChange = (categoryVal: string) => {
    setActiveFilters((prev) => ({ ...prev, taskCategory: categoryVal }));
    setDraftFilters((prev) => ({ ...prev, taskCategory: categoryVal }));
    setCurrentPage(1);
    loadSummary(undefined, categoryVal);
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

  // Check Reminders
  const handleCheckReminders = async () => {
    try {
      showToast('Checking deadlines & overdue tasks...');
      const res = await checkTaskReminders();
      if (res.success) {
        showToast(res.message || `Dispatched ${res.dispatched ?? 0} reminders.`);
        loadTasks();
        loadSummary();
      } else {
        showToast(res.error || 'Failed to check reminders.');
      }
    } catch {
      showToast('Error checking task reminders.');
    }
  };

  // Summary Modal Columns Configuration
  const taskPopupColumns = useMemo<ActionCenterSummaryPopupColumn<InternalTask>[]>(() => [
    {
      key: 'task_number',
      label: 'Task ID',
      render: (t) => (
        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
          {t.task_number || t.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'title',
      label: 'Title',
      render: (t) => (
        <span className="font-semibold text-slate-900 dark:text-white max-w-xs truncate block" title={t.title}>
          {t.title}
        </span>
      ),
    },
    {
      key: 'task_category',
      label: 'Category',
      render: (t) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {t.task_category || 'GENERAL'}
        </span>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (t) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
            t.priority === 'Critical'
              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              : t.priority === 'High'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {t.priority}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (t) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
            t.status === 'Completed'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : t.status === 'In Progress'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
              : t.status === 'Pending Approval'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {t.status}
        </span>
      ),
    },
    {
      key: 'assigned_to_name',
      label: 'Assigned To',
      render: (t) => <span>{t.assigned_to_name || t.assigned_team || 'Unassigned'}</span>,
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (t) => {
        if (!t.due_date) return <span>–</span>;
        const d = new Date(t.due_date);
        return <span>{isNaN(d.getTime()) ? t.due_date : d.toLocaleDateString('en-GB')}</span>;
      },
    },
  ], []);

  // Summary Card Click Filter & Popup Modal Launcher
  const handleCardClick = (statusKey: string) => {
    let filtered: InternalTask[] = [];
    let modalTitle = 'Total Tasks';
    let modalSubtitle = 'All internal tasks across modules';

    if (statusKey === 'overdue') {
      const todayIso = new Date().toISOString().split('T')[0];
      setActiveFilters((prev) => ({ ...prev, status: 'all', dueTo: todayIso }));
      setDraftFilters((prev) => ({ ...prev, status: 'all', dueTo: todayIso }));
      filtered = tasks.filter((t) => getDaysOverdueOrRemaining(t.due_date, t.status).isOverdue);
      modalTitle = 'Overdue Tasks';
      modalSubtitle = 'Tasks that have exceeded their deadline';
    } else {
      const nextStatus = statusKey === 'all' ? 'all' : statusKey;
      setActiveFilters((prev) => ({ ...prev, status: nextStatus, dueTo: '' }));
      setDraftFilters((prev) => ({ ...prev, status: nextStatus, dueTo: '' }));
      if (statusKey === 'all') {
        filtered = tasks;
        modalTitle = 'Total Tasks';
        modalSubtitle = 'All internal tasks across modules';
      } else {
        filtered = tasks.filter((t) => t.status === statusKey);
        modalTitle = `${statusKey} Tasks`;
        modalSubtitle = `Tasks currently marked as ${statusKey}`;
      }
    }
    setCurrentPage(1);

    setSummaryModalState({
      isOpen: true,
      title: modalTitle,
      subtitle: modalSubtitle,
      totalCount: filtered.length,
      records: filtered,
    });
  };

  // Handle Detailed Complete Task from Drawer
  const handleCompleteTaskWithRemarks = async () => {
    if (!selectedTaskDetails) return;
    const isComm = selectedTaskDetails.task_category === 'COMMUNICATION';
    if (isComm && !completionConfirmed) {
      showToast('Failed to complete task. Communication tasks require explicit confirmation.');
      return;
    }
    setIsCompleting(true);
    try {
      const updated = await completeInternalTask(selectedTaskDetails.id, completionRemarks.trim());
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        loadSummary();
        setShowCompleteSection(false);
        setCompletionRemarks('');
        setCompletionConfirmed(false);
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

  // Credit approval action handlers
  const handleApproveCreditTask = async () => {
    if (!selectedTaskDetails) return;
    setIsProcessingCreditAction(true);
    try {
      const res = await approveCreditTask(selectedTaskDetails.id, creditApprovalRemarks.trim());
      if (res.success && res.task) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? res.task! : t)));
        setSelectedTaskDetails(res.task);
        loadSummary();
        setCreditApprovalRemarks('');
        showToast(res.message || 'Credit request approved and balances updated.');
      } else {
        showToast(res.error || 'Failed to approve credit task.');
      }
    } catch {
      showToast('Error approving credit task.');
    } finally {
      setIsProcessingCreditAction(false);
    }
  };

  const handleRejectCreditTask = async () => {
    if (!selectedTaskDetails) return;
    setIsProcessingCreditAction(true);
    try {
      const res = await rejectCreditTask(selectedTaskDetails.id, creditApprovalRemarks.trim());
      if (res.success && res.task) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? res.task! : t)));
        setSelectedTaskDetails(res.task);
        loadSummary();
        setCreditApprovalRemarks('');
        showToast(res.message || 'Credit request rejected.');
      } else {
        showToast(res.error || 'Failed to reject credit task.');
      }
    } catch {
      showToast('Error rejecting credit task.');
    } finally {
      setIsProcessingCreditAction(false);
    }
  };

  // Add activity note / comment in drawer
  const handleAddActivityComment = async () => {
    if (!selectedTaskDetails || !newActivityComment.trim()) return;
    setIsAddingActivity(true);
    try {
      const res = await addTaskActivity(selectedTaskDetails.id, newActivityComment.trim());
      if (res.success && res.activity) {
        const updatedActivities = [...(selectedTaskDetails.activities || []), res.activity];
        const updatedTask = { ...selectedTaskDetails, activities: updatedActivities };
        setSelectedTaskDetails(updatedTask);
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updatedTask : t)));
        setNewActivityComment('');
        showToast('Activity note added.');
      } else {
        showToast(res.error || 'Failed to add activity note.');
      }
    } catch {
      showToast('Error adding activity note.');
    } finally {
      setIsAddingActivity(false);
    }
  };

  // Open full task details
  const handleOpenTaskDetails = useCallback((task: InternalTask) => {
    setSelectedTaskDetails(task);
    setSelectedCallOutcome(task.call_outcome || 'Connected');
    setDemoStatusVal(task.demo_status || 'Scheduled');
    setRescheduleDate(task.demo_date || '');
    setRescheduleTime(task.demo_time || '');
    setSelectedProposalStatus(task.proposal_status || 'Draft');
    if (task.id) {
      Promise.resolve(fetchTaskById(task.id))
        .then((full) => {
          if (full) {
            setSelectedTaskDetails(full);
            if (full.call_outcome) setSelectedCallOutcome(full.call_outcome);
            if (full.demo_status) setDemoStatusVal(full.demo_status);
            if (full.demo_date) setRescheduleDate(full.demo_date);
            if (full.demo_time) setRescheduleTime(full.demo_time);
            if (full.proposal_status) setSelectedProposalStatus(full.proposal_status);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Log Call Outcome handler
  const handleLogCallOutcome = async () => {
    if (!selectedTaskDetails) return;
    setIsLoggingCallOutcome(true);
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        call_outcome: selectedCallOutcome,
        activityComment: `Call outcome logged: ${selectedCallOutcome}`,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        showToast('Call outcome logged successfully.');
      } else {
        showToast('Failed to log call outcome.');
      }
    } catch {
      showToast('Error logging call outcome.');
    } finally {
      setIsLoggingCallOutcome(false);
    }
  };

  // Demo Reschedule & Status handlers
  const handleRescheduleDemo = async () => {
    if (!selectedTaskDetails || !rescheduleDate) return;
    setIsReschedulingDemo(true);
    try {
      const comment = `Demo rescheduled to ${rescheduleDate}${rescheduleTime ? ` ${rescheduleTime}` : ''}${
        rescheduleReason ? `. Reason: ${rescheduleReason}` : ''
      }`;
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        demo_date: rescheduleDate,
        demo_time: rescheduleTime || undefined,
        demo_status: 'Rescheduled',
        activityComment: comment,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        setDemoStatusVal('Rescheduled');
        showToast('Demo rescheduled successfully.');
      } else {
        showToast('Failed to reschedule demo.');
      }
    } catch {
      showToast('Error rescheduling demo.');
    } finally {
      setIsReschedulingDemo(false);
    }
  };

  const handleUpdateDemoStatus = async () => {
    if (!selectedTaskDetails) return;
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        demo_status: demoStatusVal,
        activityComment: `Demo status updated to ${demoStatusVal}`,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        showToast('Demo status updated.');
      } else {
        showToast('Failed to update demo status.');
      }
    } catch {
      showToast('Error updating demo status.');
    }
  };

  // Proposal Status Tracking handlers
  const handleUpdateProposalStatus = async () => {
    if (!selectedTaskDetails) return;
    setIsUpdatingProposal(true);
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        proposal_status: selectedProposalStatus,
        activityComment: `Proposal status updated to ${selectedProposalStatus}`,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        showToast('Proposal status updated.');
      } else {
        showToast('Failed to update proposal status.');
      }
    } catch {
      showToast('Error updating proposal status.');
    } finally {
      setIsUpdatingProposal(false);
    }
  };

  const handleMarkProposalSent = async () => {
    if (!selectedTaskDetails) return;
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        proposal_status: 'Sent to Client',
        activityComment: 'Proposal marked as sent to client',
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        setSelectedProposalStatus('Sent to Client');
        showToast('Proposal marked as sent.');
      } else {
        showToast('Failed to mark proposal sent.');
      }
    } catch {
      showToast('Error updating proposal status.');
    }
  };

  // Onboarding Milestone Stepper handler
  const handleAdvanceOnboardingStage = async () => {
    if (!selectedTaskDetails) return;
    const current = selectedTaskDetails.onboarding_stage || 1;
    if (current >= 5) return;
    const nextStage = current + 1;
    setIsAdvancingStage(true);
    try {
      const stageLabel = ONBOARDING_STAGES[nextStage as keyof typeof ONBOARDING_STAGES] || `Stage ${nextStage}`;
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        onboarding_stage: nextStage,
        activityComment: `Onboarding advanced to Stage ${nextStage}: ${stageLabel}`,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        showToast('Onboarding stage advanced.');
      } else {
        showToast('Failed to advance onboarding stage.');
      }
    } catch {
      showToast('Error advancing onboarding stage.');
    } finally {
      setIsAdvancingStage(false);
    }
  };

  // Attachments Management handler
  const handleAddAttachment = async () => {
    if (!selectedTaskDetails || !newAttachmentName.trim()) return;
    setIsAddingAttachment(true);
    try {
      const updated = await updateInternalTask(selectedTaskDetails.id, {
        newAttachment: {
          name: newAttachmentName.trim(),
          url: newAttachmentUrl.trim() || undefined,
        },
        activityComment: `Attachment added: ${newAttachmentName.trim()}`,
      });
      if (updated) {
        setTasks((prev) => prev.map((t) => (t.id === selectedTaskDetails.id ? updated : t)));
        setSelectedTaskDetails(updated);
        setNewAttachmentName('');
        setNewAttachmentUrl('');
        setShowAddAttachment(false);
        showToast('Attachment added successfully.');
      } else {
        showToast('Failed to add attachment.');
      }
    } catch {
      showToast('Error adding attachment.');
    } finally {
      setIsAddingAttachment(false);
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
      taskCategory: 'all',
      taskType: 'all',
      taskTypeId: 'all',
      relatedEntityType: 'all',
      assignedTo: '',
      createdBy: '',
      dueFrom: '',
      dueTo: '',
    };
    setDraftFilters(cleared);
    setActiveFilters(cleared);
    setCurrentPage(1);
    setIsFilterDrawerOpen(false);
  };

  // Open Create Modal with pre-selected category and type
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
      completionConfirmed: true,
    });
    if (updated) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      loadSummary();
      const msg =
        nextStatus === 'Completed'
          ? formatString(UI_STRINGS.actionCenter.tasks.taskMarkedCompleted, { taskNumber: task.task_number || task.id })
          : formatString(UI_STRINGS.actionCenter.tasks.taskReopened, { taskNumber: task.task_number || task.id });
      showToast(msg);
    }
  };

  // Handle Create Task Submission with Category Architecture
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
      const isCredit = newCategory === 'CREDIT_MANAGEMENT';

      const newTask = await createInternalTask({
        title: newTitle.trim(),
        description: newDescription.trim(),
        taskCategory: newCategory,
        taskType: newTaskType || selectedType?.name || 'General Task',
        taskTypeId: finalTypeId || undefined,
        priority: newPriority,
        status: isCredit ? 'Pending Approval' : newStatus,
        assignedToUserId: newAssignedToUserId || undefined,
        assignedToName: newAssignedToName.trim() || 'Unassigned',
        dueDate: newDueDate || undefined,
        dueTime: newDueTime || undefined,
        relatedEntityType: isCredit
          ? ((newCreditAccountType === 'SELLER' ? 'VENDOR' : 'BUYER') as TaskEntityType)
          : ((selectedType?.default_module as TaskEntityType) || 'GENERAL'),
        relatedEntityId: isCredit ? newCreditAccountId || undefined : undefined,
        relatedEntityLabel: isCredit ? newCreditAccountName || undefined : undefined,
        notes: newNotes.trim(),
        creditAccountType: isCredit ? newCreditAccountType : undefined,
        creditAccountId: isCredit ? newCreditAccountId || undefined : undefined,
        creditAccountName: isCredit ? newCreditAccountName || undefined : undefined,
        creditQuantity: isCredit ? Number(newCreditQuantity) || 0 : undefined,
        creditReason: isCredit ? newCreditReason || undefined : undefined,
        demoDate: newCategory === 'DEMO_SCHEDULING' ? newDemoDate || undefined : undefined,
        demoTime: newCategory === 'DEMO_SCHEDULING' ? newDemoTime || undefined : undefined,
        demoStatus: newCategory === 'DEMO_SCHEDULING' ? newDemoStatus : undefined,
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
        setNewDueTime('');
        setIsCreatingTypeInline(false);
        setCustomTypeName('');
        setNewCreditAccountName('');
        setNewCreditAccountId('');
        setNewCreditReason('');
        setNewDemoDate('');
        setNewDemoTime('');
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

  const clientCsvExportUri = useMemo(() => {
    if (!tasks || tasks.length === 0) return '';
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(exportTasksToCsv(tasks));
  }, [tasks]);

  // Cascading task types based on selected Category
  const categoryTaskTypes = useMemo(() => {
    return INTERNAL_TASK_CATEGORY_TYPES[newCategory] || [];
  }, [newCategory]);

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-2.5 sm:p-3 md:p-4 space-y-3.5 w-full min-w-0 max-w-full overflow-x-hidden"
    >
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
        tasksCount={summary.newTasks || summary.pending || 0}
        ticketsCount={ticketSummary?.pending || 0}
        approvalsCount={approvalSummary?.pending || 0}
        paymentDuesCount={paymentDuesSummary?.totalLowCreditAccounts || 0}
      />

      {activeTab === 'tickets' && <TicketsDashboard />}
      {activeTab === 'approvals' && <ApprovalsDashboard />}
      {activeTab === 'scorecard' && <ScorecardDashboard />}
      {activeTab === 'buyers' && <BuyersDirectory initialBuyerId={selectedBuyerDossierId} />}
      {activeTab === 'sellers' && <SellersDirectory initialSellerId={selectedSellerDossierId} />}
      {activeTab === 'registrations' && (
        <div className="w-full min-w-0 max-w-full overflow-x-hidden">
          <RegistrationsDashboard />
        </div>
      )}
      {activeTab === 'payment_dues' && <PaymentDuesDashboard onSummaryChange={setPaymentDuesSummary} />}
      {activeTab === 'document_vault' && (
        <div className="w-full min-w-0 max-w-full overflow-x-hidden">
          <DocumentVaultDashboard />
        </div>
      )}
      {activeTab === 'login_logs' && (
        <div className="w-full min-w-0 max-w-full overflow-x-hidden">
          <LoginLogsDashboard />
        </div>
      )}

      {activeTab === 'tasks' && (
        <>
          {/* Section: Ultra-Compact Summary Cards (Single Horizontal Row, Responsive Grid) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5 w-full">
            {/* Total Tasks */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('all')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('all');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'all'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-total-tasks"
            >
              <p className={`text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight whitespace-nowrap leading-tight ${
                activeFilters.status === 'all' ? 'opacity-80' : 'text-slate-600 dark:text-slate-300'
              }`}>
                Total Tasks
              </p>
              <p className="text-base sm:text-lg font-bold leading-none mt-1">{summary.total}</p>
              <span className={`text-[10px] whitespace-nowrap mt-1 leading-tight ${
                activeFilters.status === 'all' ? 'opacity-70' : 'text-slate-400 dark:text-slate-500'
              }`}>
                All records
              </span>
            </div>

            {/* New Tasks */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('New')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('New');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'New'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-new-tasks"
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-blue-700 dark:text-blue-300 whitespace-nowrap leading-tight">
                New Tasks
              </p>
              <p className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400 leading-none mt-1">
                {summary.newTasks ?? summary.pending ?? 0}
              </p>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
                Awaiting action
              </span>
            </div>

            {/* In Progress */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('In Progress')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('In Progress');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'In Progress'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-in-progress"
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-indigo-700 dark:text-indigo-300 whitespace-nowrap leading-tight">
                In Progress
              </p>
              <p className="text-base sm:text-lg font-bold text-indigo-600 dark:text-indigo-400 leading-none mt-1">
                {summary.inProgress}
              </p>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
                Active work
              </span>
            </div>

            {/* Pending Approval */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('Pending Approval')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('Pending Approval');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'Pending Approval'
                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-pending-approval"
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-amber-700 dark:text-amber-300 whitespace-nowrap leading-tight">
                Pending Approval
              </p>
              <p className="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400 leading-none mt-1">
                {summary.pendingApproval ?? 0}
              </p>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
                Requires review
              </span>
            </div>

            {/* Completed */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('Completed')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('Completed');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'Completed'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-completed"
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-emerald-700 dark:text-emerald-300 whitespace-nowrap leading-tight">
                Completed
              </p>
              <p className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-1">
                {summary.completed}
              </p>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
                Resolved
              </span>
            </div>

            {/* Overdue Tasks */}
            <div
              role="group"
              tabIndex={0}
              onClick={() => handleCardClick('overdue')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick('overdue');
                }
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between h-full min-h-[52px] sm:min-h-[58px] ${
                activeFilters.status === 'overdue'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 shadow-xs'
              }`}
              data-testid="card-overdue"
            >
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-tight text-rose-700 dark:text-rose-300 whitespace-nowrap leading-tight">
                Overdue
              </p>
              <p className="text-base sm:text-lg font-bold text-rose-600 dark:text-rose-400 leading-none mt-1">
                {summary.overdueCount ?? 0}
              </p>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap mt-1 leading-tight">
                Past deadline
              </span>
            </div>
          </div>

          {/* ============================================================== */}
          {/* TOOLBAR: 1.Search, 2.Category, 3.My Tasks, 4.All Users, 5.Filter, 6.Export CSV, 7.Reminders, 8.Send SMS/Email, 9.Create Task, 10.Refresh, 11.Gear */}
          {/* ============================================================== */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2 py-1.5 shadow-xs flex flex-row items-center gap-1 xl:gap-1.5 w-full min-w-0 max-w-full box-border">
            {/* 1. Search Bar (Takes all flexible remaining width) */}
            <div className="relative flex-1 min-w-[140px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by title, ID, entity..."
                className="w-full has-leading-icon has-trailing-icon h-8 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 2. All Categories Dropdown */}
            <select
              value={activeFilters.taskCategory || 'all'}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="shrink-0 h-8 w-[125px] xl:w-[135px] px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer truncate"
              data-testid="toolbar-category-select"
            >
              <option value="all">All Categories</option>
              {Object.values(INTERNAL_TASK_CATEGORIES).map((cat) => (
                <option key={cat} value={cat}>
                  {INTERNAL_TASK_CATEGORY_LABELS[cat] || cat}
                </option>
              ))}
            </select>

            {/* 3. My Tasks Button */}
            <button
              type="button"
              onClick={handleToggleMyTasks}
              className={`shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                isMyTasksActive
                  ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
              }`}
              title={UI_STRINGS.actionCenter.tasks.myTasks}
              data-testid="toolbar-my-tasks-btn"
            >
              <User className="w-3.5 h-3.5" />
              <span>{UI_STRINGS.actionCenter.tasks.myTasks}</span>
            </button>

            {/* 4. All Users Dropdown */}
            <select
              value={activeFilters.assignedTo || 'all'}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              className="shrink-0 h-8 w-[95px] xl:w-[105px] px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer truncate"
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

            {/* 5. Filter Button */}
            <button
              type="button"
              onClick={handleOpenFilterDrawer}
              className={`shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                activeFilterCount > 0
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="w-3.5 h-3.5 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* 6. Export CSV Button */}
            <a
              href={clientCsvExportUri || exportUrl}
              download="internal_tasks.csv"
              className="shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              data-testid="toolbar-export-csv-btn"
              title="Export CSV"
              aria-label="Export CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export<span className="hidden 2xl:inline"> CSV</span></span>
            </a>

            {/* 7. Reminders Button */}
            <button
              type="button"
              onClick={handleCheckReminders}
              className="shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 transition-all shadow-xs cursor-pointer whitespace-nowrap"
              title="Evaluate deadline triggers and dispatch overdue reminders"
              data-testid="toolbar-check-reminders-btn"
            >
              <Bell className="w-3.5 h-3.5 text-amber-600" />
              <span>Reminders</span>
            </button>

            {/* 8. Send SMS / Email Button */}
            <button
              type="button"
              onClick={() => {
                setSelectedTaskDetails(null);
                setIsComposeModalOpen(true);
              }}
              className="shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium rounded-lg border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-all shadow-xs cursor-pointer whitespace-nowrap"
              title="Dispatch SMS or Email Notification"
              aria-label="Send SMS / Email"
            >
              <Send className="w-3.5 h-3.5" />
              <span><span className="hidden 2xl:inline">Send </span>SMS / Email</span>
            </button>

            {/* 9. Create Internal Task Button */}
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="shrink-0 h-8 inline-flex items-center gap-1 px-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-xs shadow-blue-600/20 transition-all cursor-pointer whitespace-nowrap"
              title="Create Internal Task"
              aria-label="Create Internal Task"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create<span className="hidden 2xl:inline"> Internal</span> Task</span>
            </button>

            {/* 10. Refresh Button */}
            <button
              type="button"
              onClick={() => {
                loadTasks();
                loadSummary();
                showToast('Refreshed data.');
              }}
              aria-label="Refresh tasks"
              className="shrink-0 h-8 w-8 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-500 transition-colors cursor-pointer"
              title="Refresh"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* 11. Gear icon (Column Settings) */}
            <button
              type="button"
              onClick={() => setShowTaskColumnSettings(true)}
              className="shrink-0 h-8 w-8 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 dark:hover:text-indigo-400 transition-colors cursor-pointer"
              title="Column Settings"
              aria-label="Column Settings"
              data-testid="toolbar-gear-btn"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
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
                <table className="w-full text-left text-xs min-w-[960px] border-collapse">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold tracking-wide">
                    <tr>
                      {isColVisible('done') && <th className="py-2.5 px-3 w-10 min-w-[40px] max-w-[40px] text-center">Done</th>}
                      {isColVisible('status') && (
                        <th
                          className="py-2.5 px-3 w-24 min-w-[95px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('status')}
                        >
                          Status
                          <TaskSortIcon field="status" />
                        </th>
                      )}
                      {isColVisible('task') && (
                        <th
                          className="py-2.5 px-3 min-w-[180px] max-w-[280px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('task')}
                        >
                          Task Subject & ID
                          <TaskSortIcon field="task" />
                        </th>
                      )}
                      {isColVisible('category') && (
                        <th
                          className="py-2.5 px-3 w-32 min-w-[115px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('category')}
                        >
                          Category & Type
                          <TaskSortIcon field="category" />
                        </th>
                      )}
                      {isColVisible('entity') && (
                        <th className="py-2.5 px-3 w-36 min-w-[125px]">Related Entity</th>
                      )}
                      {isColVisible('priority') && (
                        <th
                          className="py-2.5 px-3 w-20 min-w-[80px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('priority')}
                        >
                          Priority
                          <TaskSortIcon field="priority" />
                        </th>
                      )}
                      {isColVisible('assignedTo') && (
                        <th
                          className="py-2.5 px-3 w-32 min-w-[115px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('assignedTo')}
                        >
                          Assigned To
                          <TaskSortIcon field="assignedTo" />
                        </th>
                      )}
                      {isColVisible('dueDate') && (
                        <th
                          className="py-2.5 px-3 w-32 min-w-[115px] cursor-pointer select-none hover:text-slate-900 dark:hover:text-white"
                          onClick={() => handleTaskSort('dueDate')}
                        >
                          Due Date & Time
                          <TaskSortIcon field="dueDate" />
                        </th>
                      )}
                      {isColVisible('actions') && (
                        <th className="py-2.5 px-3 text-right w-20 min-w-[85px]">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {sortedTasks.map((task) => {
                      const overdueInfo = getDaysOverdueOrRemaining(task.due_date, task.status);

                      return (
                        <tr
                          key={task.id}
                          onClick={() => handleOpenTaskDetails(task)}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                          data-testid={`task-row-${task.id}`}
                        >
                          {/* Checkbox toggle */}
                          {isColVisible('done') && (
                            <td className="py-2.5 px-3 w-10 min-w-[40px] max-w-[40px] text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={task.status === 'Completed'}
                                onChange={() => handleToggleStatus(task)}
                                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                              />
                            </td>
                          )}

                          {/* Status Badge */}
                          {isColVisible('status') && (
                            <td className="py-2.5 px-3 w-24 min-w-[95px] whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded-full ${
                                  task.status === 'Completed'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                    : task.status === 'Pending Approval'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-extrabold animate-pulse'
                                    : task.status === 'In Progress'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                    : task.status === 'Rejected' || task.status === 'Cancelled'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                              >
                                {task.status}
                              </span>
                            </td>
                          )}

                          {/* Task title, ID & description */}
                          {isColVisible('task') && (
                            <td className="py-2.5 px-3 min-w-[180px] max-w-[280px]">
                              <div
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors truncate"
                                title={task.title}
                              >
                                {task.title}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-[10px] text-slate-400 font-medium shrink-0">
                                  {task.task_number || task.id}
                                </span>
                                {task.description && (
                                  <span
                                    className="text-[11px] text-slate-500 dark:text-slate-400 truncate"
                                    title={task.description}
                                  >
                                    • {task.description}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}

                          {/* Category & Task Type */}
                          {isColVisible('category') && (
                            <td className="py-2.5 px-3 w-32 min-w-[115px]">
                              <div
                                className="font-semibold text-slate-800 dark:text-slate-200 truncate"
                                title={task.task_type || task.task_type_name || 'General Task'}
                              >
                                {task.task_type || task.task_type_name || 'General Task'}
                              </div>
                              <span
                                className="text-[10px] text-slate-400 font-medium block truncate"
                                title={INTERNAL_TASK_CATEGORY_LABELS[task.task_category as InternalTaskCategory] || task.task_category || 'Operations'}
                              >
                                {INTERNAL_TASK_CATEGORY_LABELS[task.task_category as InternalTaskCategory] ||
                                  task.task_category ||
                                  'Operations'}
                              </span>
                            </td>
                          )}

                          {/* Related Entity Badge */}
                          {isColVisible('entity') && (
                            <td className="py-2.5 px-3 w-36 min-w-[125px]">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase shrink-0 ${
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
                                <span
                                  className="font-medium text-slate-800 dark:text-slate-200 truncate"
                                  title={task.credit_account_name || task.related_entity_label || 'Direct Task'}
                                >
                                  {task.credit_account_name || task.related_entity_label || 'Direct Task'}
                                </span>
                              </div>
                            </td>
                          )}

                          {/* Priority */}
                          {isColVisible('priority') && (
                            <td className="py-2.5 px-3 w-20 min-w-[80px] whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded ${
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

                          {/* Assigned To */}
                          {isColVisible('assignedTo') && (
                            <td className="py-2.5 px-3 w-32 min-w-[115px]">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 shrink-0">
                                  {(task.assigned_to_name || 'U').slice(0, 1)}
                                </div>
                                <span
                                  className="font-medium truncate"
                                  title={task.assigned_to_name || 'Unassigned'}
                                >
                                  {task.assigned_to_name || 'Unassigned'}
                                </span>
                              </div>
                            </td>
                          )}

                          {/* Due Date & Overdue Badge */}
                          {isColVisible('dueDate') && (
                            <td className="py-2.5 px-3 w-32 min-w-[115px] whitespace-nowrap">
                              <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                {task.due_date || '—'} {task.due_time ? `• ${task.due_time}` : ''}
                              </div>
                              <span
                                className={`text-[10px] font-semibold block ${
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

                          {/* Actions */}
                          {isColVisible('actions') && (
                            <td className="py-2.5 px-3 text-right w-20 min-w-[85px] whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedTaskDetails(task);
                                    setIsComposeModalOpen(true);
                                  }}
                                  className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                  title="Dispatch SMS / Email for task"
                                  data-testid={`task-row-compose-${task.id}`}
                                >
                                  <Send className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleOpenTaskDetails(task)}
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

          {/* ============================================================== */}
          {/* RIGHT-SIDE FILTER DRAWER                                       */}
          {/* ============================================================== */}
          {isFilterDrawerOpen && (
            <div className="fixed inset-0 z-50 overflow-hidden">
              <div
                onClick={() => setIsFilterDrawerOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
                data-testid="filter-drawer-backdrop"
              />

              <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="w-screen max-w-sm bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200"
                >
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

                  <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
                    {/* Category Filter */}
                    <div>
                      <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Category</label>
                      <select
                        value={draftFilters.taskCategory || 'all'}
                        onChange={(e) => setDraftFilters({ ...draftFilters, taskCategory: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                        data-testid="drawer-filter-category"
                      >
                        <option value="all">All Categories</option>
                        {Object.values(INTERNAL_TASK_CATEGORIES).map((cat) => (
                          <option key={cat} value={cat}>
                            {INTERNAL_TASK_CATEGORY_LABELS[cat] || cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status */}
                    <div>
                      <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Status</label>
                      <select
                        value={draftFilters.status}
                        onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                      >
                        <option value="all">All Statuses</option>
                        <option value="New">New</option>
                        <option value="Assigned">Assigned</option>
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pending Approval">Pending Approval</option>
                        <option value="Completed">Completed</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="Blocked">Blocked</option>
                        <option value="Escalated">Escalated</option>
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
                        {INTERNAL_TASK_PRIORITIES.map((pr) => (
                          <option key={pr} value={pr}>
                            {pr}
                          </option>
                        ))}
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

                    {/* Task Type */}
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

                    {/* Created By */}
                    <div>
                      <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Created By</label>
                      <input
                        type="text"
                        value={draftFilters.createdBy || ''}
                        onChange={(e) => setDraftFilters({ ...draftFilters, createdBy: e.target.value })}
                        placeholder="Creator name..."
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
          {/* MODAL: CREATE INTERNAL TASK (With Categories & Approval Flow)  */}
          {/* ============================================================== */}
          {isCreateModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setIsCreateModalOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">Create Internal Task</h3>
                      <p className="text-[11px] text-slate-400">
                        Create activity, assign responsibility, or submit credit approval request
                      </p>
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
                  {/* Category Selection */}
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      Task Category *
                    </label>
                    <select
                      value={newCategory}
                      onChange={(e) => {
                        const cat = e.target.value as InternalTaskCategory;
                        setNewCategory(cat);
                        const available = INTERNAL_TASK_CATEGORY_TYPES[cat] || [];
                        if (available.length > 0) {
                          setNewTaskType(available[0]);
                        }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                      data-testid="create-task-category-select"
                    >
                      {Object.values(INTERNAL_TASK_CATEGORIES).map((cat) => (
                        <option key={cat} value={cat}>
                          {INTERNAL_TASK_CATEGORY_LABELS[cat] || cat}
                        </option>
                      ))}
                    </select>
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
                        onChange={(e) => {
                          setNewTaskTypeId(e.target.value);
                          const matched = taskTypes.find((t) => t.id === e.target.value);
                          if (matched) setNewTaskType(matched.name);
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                        data-testid="create-task-type-select"
                      >
                        {taskTypes.map((tt) => (
                          <option key={tt.id} value={tt.id}>
                            {tt.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      Task Title *
                    </label>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="e.g. Verify mechanical spare specifications"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Description / Instructions */}
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      Description & Instructions
                    </label>
                    <textarea
                      rows={2}
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Provide context, deliverables, or criteria for completion..."
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Category-Specific Form Fields: Credit Management */}
                  {newCategory === 'CREDIT_MANAGEMENT' && (
                    <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl space-y-2.5">
                      <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-bold text-xs">
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Credit Approval Request Parameters</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Account Type
                          </label>
                          <select
                            value={newCreditAccountType}
                            onChange={(e) => setNewCreditAccountType(e.target.value as CreditAccountType)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                            data-testid="create-credit-account-type-select"
                          >
                            <option value="BUYER">Buyer Account</option>
                            <option value="SELLER">Seller / Vendor</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Credit Quantity *
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={newCreditQuantity}
                            onChange={(e) => setNewCreditQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                            data-testid="create-credit-quantity-input"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Account Name / Organization
                        </label>
                        <input
                          type="text"
                          value={newCreditAccountName}
                          onChange={(e) => setNewCreditAccountName(e.target.value)}
                          placeholder="e.g. Apex Infra Ltd"
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                          data-testid="create-credit-account-name-input"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Reason for Request *
                        </label>
                        <input
                          type="text"
                          value={newCreditReason}
                          onChange={(e) => setNewCreditReason(e.target.value)}
                          placeholder="e.g. Promotional onboarding grant approved by CM"
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                          data-testid="create-credit-reason-input"
                        />
                      </div>
                    </div>
                  )}

                  {/* Category-Specific Form Fields: Demo Scheduling */}
                  {newCategory === 'DEMO_SCHEDULING' && (
                    <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-xl space-y-2.5">
                      <div className="flex items-center gap-1.5 text-blue-800 dark:text-blue-200 font-bold text-xs">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Product Demonstration Schedule</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Demo Date
                          </label>
                          <input
                            type="date"
                            value={newDemoDate}
                            onChange={(e) => setNewDemoDate(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                            data-testid="create-demo-date-input"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                            Demo Time
                          </label>
                          <input
                            type="time"
                            value={newDemoTime}
                            onChange={(e) => setNewDemoTime(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs"
                            data-testid="create-demo-time-input"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Priority & Status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Priority</label>
                      <select
                        value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white"
                      >
                        {INTERNAL_TASK_PRIORITIES.map((pr) => (
                          <option key={pr} value={pr}>
                            {pr}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Status</label>
                      <select
                        value={newCategory === 'CREDIT_MANAGEMENT' ? 'Pending Approval' : newStatus}
                        disabled={newCategory === 'CREDIT_MANAGEMENT'}
                        onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        <option value="New">New</option>
                        <option value="Assigned">Assigned</option>
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pending Approval">Pending Approval</option>
                        <option value="Completed">Completed</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Cancelled">Cancelled</option>
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
                      Additional Notes
                    </label>
                    <textarea
                      rows={2}
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      placeholder="Optional internal remarks or references..."
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
          {/* DRAWER: TASK DETAILS, CREDIT APPROVAL & ACTIVITY AUDIT TIMELINE */}
          {/* ============================================================== */}
          {selectedTaskDetails && (
            <div className="fixed inset-0 z-50 overflow-hidden">
              <div
                onClick={() => setSelectedTaskDetails(null)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
                data-testid="task-details-backdrop"
              />

              <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200 text-xs"
                  data-testid="task-details-drawer"
                >
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
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">Subject & Instructions</span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                        {selectedTaskDetails.title}
                      </h4>
                      {selectedTaskDetails.description && (
                        <p className="text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                          {selectedTaskDetails.description}
                        </p>
                      )}
                    </div>

                    {/* Section 4: Credit Approval Workflow Panel */}
                    {(selectedTaskDetails.task_category === 'CREDIT_MANAGEMENT' ||
                      selectedTaskDetails.credit_quantity) && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-100">
                            <CreditCard className="w-4 h-4 text-amber-600" />
                            <span>Credit Management Approval</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${
                              selectedTaskDetails.approval_status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : selectedTaskDetails.approval_status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800 animate-pulse'
                            }`}
                          >
                            {selectedTaskDetails.approval_status || selectedTaskDetails.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 block font-semibold">Account:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {selectedTaskDetails.credit_account_name || 'N/A'} (
                              {selectedTaskDetails.credit_account_type || 'BUYER'})
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold">Quantity:</span>
                            <span className="font-bold text-amber-700 dark:text-amber-300">
                              {selectedTaskDetails.credit_quantity || 0} Credits
                            </span>
                          </div>
                        </div>
                        {selectedTaskDetails.credit_reason && (
                          <div className="text-[11px]">
                            <span className="text-slate-400 block font-semibold">Reason:</span>
                            <span className="text-slate-700 dark:text-slate-300 italic">
                              &ldquo;{selectedTaskDetails.credit_reason}&rdquo;
                            </span>
                          </div>
                        )}

                        {/* Live and Projected Balances */}
                        <div className="grid grid-cols-2 gap-2 text-[11px] p-2 bg-white/80 dark:bg-slate-900/80 rounded-lg border border-amber-200/60 dark:border-amber-800/50">
                          <div>
                            <span className="text-slate-400 block font-semibold">{UI_STRINGS.actionCenter.tasks.currentCreditsLabel}:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200" data-testid="drawer-current-credits">
                              {selectedTaskDetails.current_account_credits !== undefined
                                ? `${selectedTaskDetails.current_account_credits} Credits`
                                : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold">{UI_STRINGS.actionCenter.tasks.projectedCreditsLabel}:</span>
                            {(() => {
                              const curr = selectedTaskDetails.current_account_credits;
                              const isDeduct =
                                selectedTaskDetails.task_type_code === 'itt_delete_credits' ||
                                (selectedTaskDetails.task_type || '').toLowerCase().includes('delete') ||
                                (selectedTaskDetails.task_type || '').toLowerCase().includes('deduct');
                              const qty = selectedTaskDetails.credit_quantity || 0;
                              const projected = curr !== undefined ? curr + (isDeduct ? -qty : qty) : null;
                              return (
                                <span
                                  className={`font-bold ${
                                    projected !== null && projected < 0
                                      ? 'text-rose-600'
                                      : 'text-emerald-700 dark:text-emerald-400'
                                  }`}
                                  data-testid="drawer-projected-credits"
                                >
                                  {projected !== null ? `${projected} Credits` : '—'}
                                </span>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Approval actions for Admin / Approver */}
                        {selectedTaskDetails.status === 'Pending Approval' && (
                          <div className="pt-2 border-t border-amber-200 dark:border-amber-800 space-y-2">
                            <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase">
                              Approver Remarks
                            </label>
                            <input
                              type="text"
                              value={creditApprovalRemarks}
                              onChange={(e) => setCreditApprovalRemarks(e.target.value)}
                              placeholder="Enter approval remarks or verification notes..."
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                              data-testid="credit-approval-remarks-input"
                            />
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isProcessingCreditAction}
                                onClick={handleApproveCreditTask}
                                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1"
                                data-testid="drawer-approve-credit-btn"
                              >
                                <CheckCheck className="w-3.5 h-3.5" />
                                <span>Approve & Grant</span>
                              </button>
                              <button
                                type="button"
                                disabled={isProcessingCreditAction}
                                onClick={handleRejectCreditTask}
                                className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1"
                                data-testid="drawer-reject-credit-btn"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Communication Task Actions Card */}
                    {selectedTaskDetails.task_category === 'COMMUNICATION' && (
                      <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-blue-900 dark:text-blue-100">
                            <Phone className="w-4 h-4 text-blue-600" />
                            <span>Communication Suite</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200">
                            {selectedTaskDetails.task_type || 'Communication'}
                          </span>
                        </div>

                        {/* Recipient Details */}
                        <div className="text-[11px] grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-slate-400 block font-semibold">Recipient Phone:</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200" data-testid="drawer-recipient-phone">
                              {selectedTaskDetails.recipient_phone || '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold">Recipient Email:</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1" data-testid="drawer-recipient-email">
                              {selectedTaskDetails.recipient_email || '—'}
                            </span>
                          </div>
                        </div>

                        {/* Phone Call Actions */}
                        {((selectedTaskDetails.task_type || '').toLowerCase().includes('call') ||
                          (selectedTaskDetails.task_type || '').toLowerCase().includes('phone')) && (
                          <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60 space-y-2">
                            <div className="flex items-center gap-2">
                              {selectedTaskDetails.recipient_phone && (
                                <a
                                  href={`tel:${selectedTaskDetails.recipient_phone}`}
                                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                                  data-testid="drawer-call-client-btn"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                  <span>Call Client</span>
                                </a>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedCallOutcome}
                                onChange={(e) => setSelectedCallOutcome(e.target.value)}
                                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                                data-testid="drawer-call-outcome-select"
                              >
                                {CALL_OUTCOMES.map((co) => (
                                  <option key={co.value} value={co.value}>
                                    {co.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={isLoggingCallOutcome}
                                onClick={handleLogCallOutcome}
                                className="px-2.5 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                                data-testid="drawer-log-call-outcome-btn"
                              >
                                {isLoggingCallOutcome ? 'Logging...' : UI_STRINGS.actionCenter.tasks.logCallOutcomeBtn}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* WhatsApp Action */}
                        {(selectedTaskDetails.task_type || '').toLowerCase().includes('whatsapp') && (
                          <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60">
                            {selectedTaskDetails.recipient_phone ? (
                              <a
                                href={`https://wa.me/${selectedTaskDetails.recipient_phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                                  selectedTaskDetails.title
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm"
                                data-testid="drawer-open-whatsapp-btn"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Open WhatsApp Web</span>
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No phone number attached to task</span>
                            )}
                          </div>
                        )}

                        {/* Follow-up Action */}
                        {(selectedTaskDetails.task_type || '').toLowerCase().includes('follow') && (
                          <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/60">
                            <button
                              type="button"
                              onClick={() => {
                                setNewCategory('COMMUNICATION');
                                setNewTaskType('Follow-up');
                                setNewTitle(`Follow-up: ${selectedTaskDetails.title}`);
                                setNewNotes(`Follow-up for reference ${selectedTaskDetails.task_number}`);
                                setIsCreateModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
                              data-testid="drawer-schedule-followup-btn"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{UI_STRINGS.actionCenter.tasks.scheduleFollowupBtn}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Demo Scheduling Management Card */}
                    {selectedTaskDetails.task_category === 'DEMO_SCHEDULING' && (
                      <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-purple-900 dark:text-purple-100">
                            <Calendar className="w-4 h-4 text-purple-600" />
                            <span>Product Demo Scheduling</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200" data-testid="drawer-demo-status-badge">
                            {selectedTaskDetails.demo_status || 'Scheduled'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 block font-semibold">Demo Date:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200" data-testid="drawer-demo-date">
                              {selectedTaskDetails.demo_date || 'Not set'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold">Demo Time:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200" data-testid="drawer-demo-time">
                              {selectedTaskDetails.demo_time || 'Not set'}
                            </span>
                          </div>
                        </div>

                        {/* Demo Status Selector */}
                        <div className="pt-2 border-t border-purple-200/60 dark:border-purple-800/60 space-y-1.5">
                          <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase">
                            {UI_STRINGS.actionCenter.tasks.demoStatusLabel}
                          </label>
                          <div className="flex items-center gap-2">
                            <select
                              value={demoStatusVal}
                              onChange={(e) => setDemoStatusVal(e.target.value as DemoStatus)}
                              className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                              data-testid="drawer-demo-status-select"
                            >
                              {DEMO_STATUSES.map((ds) => (
                                <option key={ds} value={ds}>
                                  {ds}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={handleUpdateDemoStatus}
                              className="px-2.5 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                              data-testid="drawer-update-demo-status-btn"
                            >
                              {UI_STRINGS.actionCenter.tasks.updateDemoStatusBtn}
                            </button>
                          </div>
                        </div>

                        {/* Reschedule Demo Controls */}
                        <div className="pt-2 border-t border-purple-200/60 dark:border-purple-800/60 space-y-2">
                          <span className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase">
                            Reschedule Appointment
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="date"
                              value={rescheduleDate}
                              onChange={(e) => setRescheduleDate(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                              data-testid="drawer-reschedule-date-input"
                            />
                            <input
                              type="time"
                              value={rescheduleTime}
                              onChange={(e) => setRescheduleTime(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                              data-testid="drawer-reschedule-time-input"
                            />
                          </div>
                          <input
                            type="text"
                            value={rescheduleReason}
                            onChange={(e) => setRescheduleReason(e.target.value)}
                            placeholder="Reason for reschedule..."
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                            data-testid="drawer-reschedule-reason-input"
                          />
                          <button
                            type="button"
                            disabled={isReschedulingDemo || !rescheduleDate}
                            onClick={handleRescheduleDemo}
                            className="w-full py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1 text-xs disabled:opacity-50"
                            data-testid="drawer-reschedule-demo-btn"
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{UI_STRINGS.actionCenter.tasks.rescheduleDemoBtn}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Business Development & Proposal Tracking Card */}
                    {selectedTaskDetails.task_category === 'BUSINESS_DEVELOPMENT' && (
                      <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-900 dark:text-emerald-100">
                            <FileText className="w-4 h-4 text-emerald-600" />
                            <span>{UI_STRINGS.actionCenter.tasks.proposalTrackingTitle}</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200" data-testid="drawer-proposal-status-badge">
                            {selectedTaskDetails.proposal_status || 'Draft'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 block font-semibold">{UI_STRINGS.actionCenter.tasks.proposalValueLabel}:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200" data-testid="drawer-proposal-value">
                              {selectedTaskDetails.proposal_value !== undefined ? `₹${selectedTaskDetails.proposal_value.toLocaleString()}` : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-semibold">{UI_STRINGS.actionCenter.tasks.proposalUrlLabel}:</span>
                            {selectedTaskDetails.proposal_url ? (
                              <a
                                href={selectedTaskDetails.proposal_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 underline font-semibold flex items-center gap-0.5"
                                data-testid="drawer-proposal-link"
                              >
                                <span>Open Link</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-slate-400 italic">None</span>
                            )}
                          </div>
                        </div>

                        {/* Proposal Status Selector */}
                        <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60 space-y-1.5">
                          <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase">
                            {UI_STRINGS.actionCenter.tasks.proposalStatusLabel}
                          </label>
                          <div className="flex items-center gap-2">
                            <select
                              value={selectedProposalStatus}
                              onChange={(e) => setSelectedProposalStatus(e.target.value)}
                              className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                              data-testid="drawer-proposal-status-select"
                            >
                              {PROPOSAL_STATUSES.map((ps) => (
                                <option key={ps} value={ps}>
                                  {ps}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={isUpdatingProposal}
                              onClick={handleUpdateProposalStatus}
                              className="px-2.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                              data-testid="drawer-update-proposal-status-btn"
                            >
                              Update
                            </button>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={handleMarkProposalSent}
                              className="w-full py-1 text-xs font-semibold rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 border border-emerald-300 dark:border-emerald-700"
                              data-testid="drawer-mark-proposal-sent-btn"
                            >
                              {UI_STRINGS.actionCenter.tasks.markProposalSentBtn}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Client Onboarding Milestone Stepper */}
                    {selectedTaskDetails.task_category === 'ONBOARDING' && (
                      <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-800/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-indigo-900 dark:text-indigo-100">
                            <Award className="w-4 h-4 text-indigo-600" />
                            <span>{UI_STRINGS.actionCenter.tasks.onboardingStageTitle}</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200" data-testid="drawer-onboarding-stage-badge">
                            Stage {selectedTaskDetails.onboarding_stage || 1} of 5
                          </span>
                        </div>

                        {/* Stepper View */}
                        <div className="space-y-1.5 pt-1">
                          {[1, 2, 3, 4, 5].map((stageNum) => {
                            const currentStage = selectedTaskDetails.onboarding_stage || 1;
                            const isDone = stageNum < currentStage;
                            const isCurrent = stageNum === currentStage;
                            const stageName = ONBOARDING_STAGES[stageNum as keyof typeof ONBOARDING_STAGES] || `Stage ${stageNum}`;
                            return (
                              <div
                                key={stageNum}
                                className={`flex items-center gap-2 p-1.5 rounded-lg text-xs ${
                                  isCurrent
                                    ? 'bg-indigo-100 dark:bg-indigo-900/60 font-bold text-indigo-900 dark:text-indigo-100 border border-indigo-300 dark:border-indigo-700'
                                    : isDone
                                    ? 'text-emerald-700 dark:text-emerald-400 line-through opacity-80'
                                    : 'text-slate-400 opacity-60'
                                }`}
                                data-testid={`onboarding-stage-item-${stageNum}`}
                              >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                  isDone
                                    ? 'bg-emerald-600 text-white'
                                    : isCurrent
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                }`}>
                                  {isDone ? '✓' : stageNum}
                                </span>
                                <span>{stageName}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Advance Stage Button */}
                        {(selectedTaskDetails.onboarding_stage || 1) < 5 && (
                          <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60">
                            <button
                              type="button"
                              disabled={isAdvancingStage}
                              onClick={handleAdvanceOnboardingStage}
                              className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1 text-xs"
                              data-testid="drawer-advance-onboarding-btn"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                              <span>Advance to Next Stage</span>
                            </button>
                          </div>
                        )}

                        {/* Navigation link to Buyer or Vendor if available */}
                        {selectedTaskDetails.related_entity_id && (
                          <div className="pt-1 flex items-center gap-2 text-xs">
                            {selectedTaskDetails.related_entity_type === 'BUYER' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedBuyerDossierId(selectedTaskDetails.related_entity_id);
                                  handleSelectTab('buyers');
                                }}
                                className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                                data-testid="drawer-goto-buyer-btn"
                              >
                                <span>View Buyer Dossier</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            {selectedTaskDetails.related_entity_type === 'VENDOR' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSellerDossierId(selectedTaskDetails.related_entity_id);
                                  handleSelectTab('sellers');
                                }}
                                className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                                data-testid="drawer-goto-vendor-btn"
                              >
                                <span>View Vendor Dossier</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Completion Status & Action Section */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 block font-semibold uppercase">Execution Status</span>
                          <span
                            className={`font-bold text-xs ${
                              selectedTaskDetails.status === 'Completed'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {selectedTaskDetails.status}
                            {selectedTaskDetails.completed_at &&
                              ` (Finished ${selectedTaskDetails.completed_at.slice(0, 10)})`}
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
                          {selectedTaskDetails.task_category === 'COMMUNICATION' && (
                            <label className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-amber-900 dark:text-amber-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={completionConfirmed}
                                onChange={(e) => setCompletionConfirmed(e.target.checked)}
                                className="w-4 h-4 text-emerald-600 rounded"
                                data-testid="communication-confirm-checkbox"
                              />
                              <span>I confirm the communication action was successfully performed with client</span>
                            </label>
                          )}

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
                                setCompletionConfirmed(false);
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
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Category</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {INTERNAL_TASK_CATEGORY_LABELS[selectedTaskDetails.task_category as InternalTaskCategory] ||
                            selectedTaskDetails.task_category ||
                            'General'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Task Type</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedTaskDetails.task_type || selectedTaskDetails.task_type_name || 'General'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Assigned To</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedTaskDetails.assigned_to_name || 'Unassigned'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Created By</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedTaskDetails.created_by_name || 'System Admin'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Due Date & Time</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {selectedTaskDetails.due_date || 'None'}{' '}
                          {selectedTaskDetails.due_time ? `• ${selectedTaskDetails.due_time}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold uppercase">Linked Entity</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">
                          {selectedTaskDetails.credit_account_name ||
                            selectedTaskDetails.related_entity_label ||
                            selectedTaskDetails.related_entity_type ||
                            'Direct'}
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

                    {/* Attachments Section */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block text-xs">
                          {UI_STRINGS.actionCenter.tasks.attachments}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAddAttachment(!showAddAttachment)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                          data-testid="drawer-toggle-add-attachment-btn"
                        >
                          {showAddAttachment ? 'Cancel' : UI_STRINGS.actionCenter.tasks.addAttachment}
                        </button>
                      </div>

                      {/* Add Attachment Form */}
                      {showAddAttachment && (
                        <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
                          <input
                            type="text"
                            value={newAttachmentName}
                            onChange={(e) => setNewAttachmentName(e.target.value)}
                            placeholder={UI_STRINGS.actionCenter.tasks.attachmentNamePlaceholder}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                            data-testid="drawer-attachment-name-input"
                          />
                          <input
                            type="url"
                            value={newAttachmentUrl}
                            onChange={(e) => setNewAttachmentUrl(e.target.value)}
                            placeholder={UI_STRINGS.actionCenter.tasks.attachmentUrlPlaceholder}
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                            data-testid="drawer-attachment-url-input"
                          />
                          <button
                            type="button"
                            disabled={isAddingAttachment || !newAttachmentName.trim()}
                            onClick={handleAddAttachment}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs disabled:opacity-40"
                            data-testid="drawer-save-attachment-btn"
                          >
                            {isAddingAttachment ? 'Attaching...' : UI_STRINGS.actionCenter.tasks.addAttachmentBtn}
                          </button>
                        </div>
                      )}

                      {/* Existing Attachments List */}
                      {selectedTaskDetails.attachments && selectedTaskDetails.attachments.length > 0 ? (
                        <div className="space-y-1.5">
                          {selectedTaskDetails.attachments.map((att, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 text-xs"
                            >
                              <div className="flex items-center gap-1.5 overflow-hidden">
                                <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                  {att.name}
                                </span>
                              </div>
                              {att.url && (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline flex items-center gap-0.5 flex-shrink-0"
                                  data-testid={`attachment-link-${idx}`}
                                >
                                  <span>View</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic block">
                          {UI_STRINGS.actionCenter.tasks.noAttachments}
                        </span>
                      )}
                    </div>

                    {/* Section 3 & 6: Activity Timeline & Progress Notes */}
                    <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                          Activity Log & Progress Notes
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {(selectedTaskDetails.activities || []).length + 1} events
                        </span>
                      </div>

                      {/* Add progress note input */}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newActivityComment}
                          onChange={(e) => setNewActivityComment(e.target.value)}
                          placeholder="Add progress update note..."
                          className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-1.5 text-xs text-slate-900 dark:text-white"
                          data-testid="drawer-add-activity-input"
                        />
                        <button
                          type="button"
                          disabled={isAddingActivity || !newActivityComment.trim()}
                          onClick={handleAddActivityComment}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-40"
                          data-testid="drawer-add-activity-btn"
                        >
                          Add Note
                        </button>
                      </div>

                      {/* Activity List */}
                      <div className="space-y-2">
                        {(selectedTaskDetails.activities || []).map((act, idx) => (
                          <div
                            key={act.id || idx}
                            className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800"
                          >
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {act.actor_name || 'Team Member'}
                              </span>
                              <span>{act.created_at ? act.created_at.slice(0, 16).replace('T', ' ') : ''}</span>
                            </div>
                            <p className="text-slate-700 dark:text-slate-300 font-medium mt-0.5">
                              {act.comment || act.action_type}
                            </p>
                          </div>
                        ))}

                        <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{selectedTaskDetails.created_by_name || 'System Admin'}</span>
                            <span>{selectedTaskDetails.created_at?.slice(0, 10)}</span>
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 font-medium mt-0.5">
                            Task created in database with reference {selectedTaskDetails.task_number}.
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsComposeModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-all shadow-sm"
                        data-testid="drawer-compose-btn"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Dispatch SMS / Email</span>
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
            </div>
          )}
        </>
      )}

      {isComposeModalOpen && (() => {
        const activeTask = selectedTaskDetails;
        const matchedAssignee = activeTask
          ? assignees.find(
              (m) =>
                (activeTask.assigned_to_user_id && m.id === activeTask.assigned_to_user_id) ||
                (activeTask.assigned_to_name && m.name.toLowerCase() === activeTask.assigned_to_name.toLowerCase())
            )
          : null;
        const recipientEmail = matchedAssignee?.email || '';
        return (
          <ActionCenterComposeModal
            isOpen={isComposeModalOpen}
            onClose={() => setIsComposeModalOpen(false)}
            entityType={activeTask ? 'internal_task' : 'general'}
            entityId={activeTask?.id || 'general'}
            defaultSubject={activeTask?.title ? `Task Update: ${activeTask.title}` : 'Action Center Notification'}
            defaultRecipientName={activeTask?.assigned_to_name || ''}
            defaultRecipientEmail={recipientEmail}
          />
        );
      })()}
      {/* Action Center Tasks Summary Modal */}

      {/* Task Column Settings Popup */}
      <ColumnSettingsPopup
        isOpen={showTaskColumnSettings}
        onClose={() => setShowTaskColumnSettings(false)}
        columns={taskColumns}
        onSave={(newCols) => {
          setTaskColumns(newCols);
          try {
            localStorage.setItem(TASK_COL_PREF_KEY, JSON.stringify(newCols));
          } catch {}
        }}
        onReset={() => {
          setTaskColumns(DEFAULT_TASK_TABLE_COLUMNS);
          try {
            localStorage.setItem(TASK_COL_PREF_KEY, JSON.stringify(DEFAULT_TASK_TABLE_COLUMNS));
          } catch {}
        }}
        title="Internal Tasks Columns"
      />

      <ActionCenterSummaryPopupModal
        isOpen={summaryModalState.isOpen}
        onClose={() => setSummaryModalState((prev) => ({ ...prev, isOpen: false }))}
        title={summaryModalState.title}
        subtitle={summaryModalState.subtitle}
        totalCount={summaryModalState.totalCount}
        columns={taskPopupColumns}
        records={summaryModalState.records}
      />
    </div>
  );
}