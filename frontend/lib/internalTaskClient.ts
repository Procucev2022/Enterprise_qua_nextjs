import { authClient } from './authClient';
import {
  DEFAULT_INTERNAL_MEMBERS,
  INTERNAL_TASK_CATEGORIES,
  INTERNAL_TASK_CATEGORY_LABELS,
  type InternalTeamMember,
} from './constants';
import type {
  InternalTask,
  TaskSummary,
  InternalTaskCategory,
  InternalTaskStatus,
  InternalTaskPriority,
  DemoStatus,
  CreditAccountType,
  InternalTaskActivity,
} from './types';

export type { InternalTeamMember, InternalTask, TaskSummary, InternalTaskCategory, InternalTaskStatus, InternalTaskPriority, DemoStatus, CreditAccountType };

export interface TaskType {
  id: string;
  name: string;
  code: string;
  default_module: string;
  description?: string;
  is_active?: boolean | number;
}

export type TaskActivity = InternalTaskActivity;
export type TaskPriority = InternalTaskPriority;
export type TaskStatus = InternalTaskStatus;
export type TaskEntityType = 'RFQ' | 'BUYER' | 'VENDOR' | 'CREDIT' | 'CATEGORY' | 'PAYMENT' | 'USER' | 'GENERAL';

export interface RelatedEntityOption {
  id: string;
  label: string;
  secondary?: string;
  entityType: TaskEntityType;
}

export interface TaskFilterParams {
  search?: string;
  status?: string;
  priority?: string;
  taskCategory?: string;
  taskType?: string;
  taskTypeId?: string;
  relatedEntityType?: string;
  assignedTo?: string;
  createdBy?: string;
  dueFrom?: string;
  dueTo?: string;
  limit?: number;
  offset?: number;
}

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const DEFAULT_TASK_TYPES: TaskType[] = [
  {
    id: 'itt_quotation_review',
    name: 'Quotation Review',
    code: 'quotation_review',
    default_module: 'RFQ',
    description: 'Review and approve technical quotes and commercial bids',
  },
  {
    id: 'itt_buyer_onboarding',
    name: 'Buyer Onboarding',
    code: 'buyer_onboarding',
    default_module: 'BUYER',
    description: 'Assist buyer organizations with onboarding and profile verification',
  },
  {
    id: 'itt_vendor_followup',
    name: 'Vendor Follow-up',
    code: 'vendor_followup',
    default_module: 'VENDOR',
    description: 'Communicate with vendors on RFQ bid submissions and pricing queries',
  },
  {
    id: 'itt_credit_approval',
    name: 'Credit Approval',
    code: 'credit_approval',
    default_module: 'CREDIT',
    description: 'Evaluate credit extension requests for enterprise buyers',
  },
  {
    id: 'itt_category_audit',
    name: 'Category Audit',
    code: 'category_audit',
    default_module: 'CATEGORY',
    description: 'Audit supplier catalogues, HSN mappings, and GST conformity',
  },
  {
    id: 'itt_payment_verification',
    name: 'Payment Verification',
    code: 'payment_verification',
    default_module: 'PAYMENT',
    description: 'Verify payment proofs and reconcile outstanding invoices',
  },
  {
    id: 'itt_account_governance',
    name: 'Account Governance',
    code: 'account_governance',
    default_module: 'USER',
    description: 'Conduct KYC reviews and enterprise buyer credential checks',
  },
  {
    id: 'itt_general_ops',
    name: 'General Operations',
    code: 'general_ops',
    default_module: 'GENERAL',
    description: 'Routine internal category manager tasks and follow-ups',
  },
  {
    id: 'itt_phone_call',
    name: 'Phone Call',
    code: 'phone_call',
    default_module: 'BUYER',
    description: 'Direct telephonic communication with client or vendor',
  },
  {
    id: 'itt_sms',
    name: 'SMS',
    code: 'sms',
    default_module: 'BUYER',
    description: 'Direct SMS communication',
  },
  {
    id: 'itt_whatsapp',
    name: 'WhatsApp',
    code: 'whatsapp',
    default_module: 'BUYER',
    description: 'WhatsApp communication with client or vendor',
  },
  {
    id: 'itt_email',
    name: 'Email',
    code: 'email',
    default_module: 'BUYER',
    description: 'Direct email communication',
  },
  {
    id: 'itt_followup_new',
    name: 'New Follow-up',
    code: 'followup_new',
    default_module: 'BUYER',
    description: 'Initiate new follow-up communication',
  },
  {
    id: 'itt_followup_existing',
    name: 'Existing Follow-up',
    code: 'followup_existing',
    default_module: 'BUYER',
    description: 'Continue ongoing follow-up communication',
  },
  {
    id: 'itt_demo_scheduling',
    name: 'Demo Scheduling',
    code: 'demo_scheduling',
    default_module: 'BUYER',
    description: 'Schedule product demonstrations for buyers or clients',
  },
  {
    id: 'itt_add_credits',
    name: 'Add Credits',
    code: 'add_credits',
    default_module: 'CREDIT',
    description: 'Request credit allocation for buyer or seller account (requires approval)',
  },
  {
    id: 'itt_delete_credits',
    name: 'Delete Credits',
    code: 'delete_credits',
    default_module: 'CREDIT',
    description: 'Request credit deduction for buyer or seller account (requires approval)',
  },
  {
    id: 'itt_send_proposal',
    name: 'Send Proposal',
    code: 'send_proposal',
    default_module: 'RFQ',
    description: 'Send commercial proposal or RFQ response to buyer',
  },
  {
    id: 'itt_corporate_email',
    name: 'Send Corporate Email',
    code: 'corporate_email',
    default_module: 'BUYER',
    description: 'Send corporate communication or business development email',
  },
  {
    id: 'itt_onboarding',
    name: 'Onboarding Process',
    code: 'onboarding_process',
    default_module: 'VENDOR',
    description: 'Client and vendor onboarding milestones and compliance checks',
  },
  {
    id: 'itt_internal_ops',
    name: 'Internal Operations',
    code: 'internal_ops',
    default_module: 'GENERAL',
    description: 'Internal operational activities and escalations',
  },
];

export async function fetchTaskTypes(): Promise<TaskType[]> {
  try {
    const res = await fetch('/api/internal-tasks/task-types', { headers: authHeaders() });
    if (!res.ok) return DEFAULT_TASK_TYPES;
    const data = await res.json();
    if (Array.isArray(data.taskTypes) && data.taskTypes.length > 0) {
      return data.taskTypes;
    }
    return DEFAULT_TASK_TYPES;
  } catch {
    return DEFAULT_TASK_TYPES;
  }
}

export async function createNewTaskType(payload: {
  name: string;
  code?: string;
  defaultModule?: string;
  description?: string;
}): Promise<TaskType | null> {
  try {
    const res = await fetch('/api/internal-tasks/task-types', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.taskType || null;
  } catch {
    return null;
  }
}

export async function fetchInternalTasks(filters: TaskFilterParams = {}): Promise<{
  tasks: InternalTask[];
  total: number;
}> {
  try {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
    if (filters.taskCategory && filters.taskCategory !== 'all') params.set('taskCategory', filters.taskCategory);
    if (filters.taskType && filters.taskType !== 'all') params.set('taskType', filters.taskType);
    if (filters.taskTypeId && filters.taskTypeId !== 'all') params.set('taskTypeId', filters.taskTypeId);
    if (filters.relatedEntityType && filters.relatedEntityType !== 'all') {
      params.set('relatedEntityType', filters.relatedEntityType);
    }
    if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
    if (filters.createdBy && filters.createdBy !== 'all') params.set('createdBy', filters.createdBy);
    if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
    if (filters.dueTo) params.set('dueTo', filters.dueTo);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));

    const url = `/api/internal-tasks?${params.toString()}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return { tasks: [], total: 0 };
    const data = await res.json();
    return {
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      total: typeof data.total === 'number' ? data.total : 0,
    };
  } catch {
    return { tasks: [], total: 0 };
  }
}

export async function fetchInternalAssignees(): Promise<InternalTeamMember[]> {
  try {
    const res = await fetch('/api/internal-tasks/assignees', { headers: authHeaders() });
    if (!res.ok) return DEFAULT_INTERNAL_MEMBERS;
    const data = await res.json();
    if (Array.isArray(data.assignees) && data.assignees.length > 0) {
      return data.assignees;
    }
    return DEFAULT_INTERNAL_MEMBERS;
  } catch {
    return DEFAULT_INTERNAL_MEMBERS;
  }
}

export async function fetchTaskSummary(params?: { assignedTo?: string; taskCategory?: string }): Promise<TaskSummary> {
  const fallback: TaskSummary = {
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
  };
  try {
    const query = new URLSearchParams();
    if (params?.assignedTo && params.assignedTo !== 'all') {
      query.set('assignedTo', params.assignedTo);
    }
    if (params?.taskCategory && params.taskCategory !== 'all') {
      query.set('taskCategory', params.taskCategory);
    }
    const queryString = query.toString();
    const url = `/api/internal-tasks/summary${queryString ? `?${queryString}` : ''}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.summary || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchTaskById(id: string): Promise<InternalTask | null> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.task || null;
  } catch {
    return null;
  }
}

export async function createInternalTask(payload: {
  title: string;
  description?: string;
  taskCategory?: InternalTaskCategory;
  taskType?: string;
  taskTypeId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedToUserId?: string;
  assignedToName?: string;
  assignedTeam?: string;
  dueDate?: string;
  dueTime?: string;
  relatedEntityType?: TaskEntityType;
  relatedEntityId?: string;
  relatedEntityLabel?: string;
  notes?: string;
  creditAccountType?: CreditAccountType;
  creditAccountId?: string;
  creditAccountName?: string;
  creditQuantity?: number;
  creditReason?: string;
  demoDate?: string;
  demoTime?: string;
  demoStatus?: DemoStatus;
  attachments?: Array<{ name: string; url?: string; size?: number }>;
}): Promise<InternalTask | null> {
  try {
    const res = await fetch('/api/internal-tasks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.task || null;
  } catch {
    return null;
  }
}

export async function updateInternalTask(
  id: string,
  updates: Partial<InternalTask> & {
    activityComment?: string;
    completionConfirmed?: boolean;
    actionOutcome?: string;
    completionRemarks?: string;
    newAttachment?: { name: string; url?: string; size?: number };
  }
): Promise<InternalTask | null> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.task || null;
  } catch {
    return null;
  }
}

export async function deleteInternalTask(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function approveCreditTask(
  id: string,
  remarks: string = ''
): Promise<{ success: boolean; message?: string; task?: InternalTask; error?: string }> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ remarks }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to approve credit task.' };
    }
    return { success: true, message: data.message, task: data.task };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function rejectCreditTask(
  id: string,
  remarks: string = ''
): Promise<{ success: boolean; message?: string; task?: InternalTask; error?: string }> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ remarks }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to reject credit task.' };
    }
    return { success: true, message: data.message, task: data.task };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function addTaskActivity(
  id: string,
  comment: string
): Promise<{ success: boolean; activity?: TaskActivity; error?: string }> {
  try {
    const res = await fetch(`/api/internal-tasks/${encodeURIComponent(id)}/activities`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ comment }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to add activity.' };
    }
    return { success: true, activity: data.activity };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function checkTaskReminders(): Promise<{
  success: boolean;
  count?: number;
  dispatched?: number;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/internal-tasks/check-reminders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to check reminders.' };
    }
    return { success: true, count: data.count, dispatched: data.dispatched, message: data.message };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function searchRelatedEntities(type: TaskEntityType, query: string = ''): Promise<RelatedEntityOption[]> {
  try {
    const params = new URLSearchParams({ type, q: query });
    const res = await fetch(`/api/internal-tasks/entities?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.entities) ? data.entities : [];
  } catch {
    return [];
  }
}

export function getExportTasksUrl(filters: TaskFilterParams = {}): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
  if (filters.taskCategory && filters.taskCategory !== 'all') params.set('taskCategory', filters.taskCategory);
  if (filters.taskType && filters.taskType !== 'all') params.set('taskType', filters.taskType);
  if (filters.taskTypeId && filters.taskTypeId !== 'all') params.set('taskTypeId', filters.taskTypeId);
  if (filters.relatedEntityType && filters.relatedEntityType !== 'all') {
    params.set('relatedEntityType', filters.relatedEntityType);
  }
  if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
  if (filters.createdBy && filters.createdBy !== 'all') params.set('createdBy', filters.createdBy);
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  return `/api/internal-tasks/export?${params.toString()}`;
}

export async function completeInternalTask(
  id: string,
  resolutionRemarks?: string
): Promise<InternalTask | null> {
  return updateInternalTask(id, {
    status: 'Completed',
    completionConfirmed: true,
    completionRemarks: resolutionRemarks,
    activityComment: resolutionRemarks ? `Completed: ${resolutionRemarks}` : 'Task marked as completed',
    notes: resolutionRemarks || undefined,
  });
}

export function exportTasksToCsv(tasks: InternalTask[]): string {
  const headers = [
    'Task Number',
    'Category',
    'Task Type',
    'Title',
    'Priority',
    'Status',
    'Assigned To',
    'Created By',
    'Due Date',
    'Due Time',
    'Completed At',
    'Completed By',
    'Related Entity Type',
    'Related Entity Label',
  ];
  const rows = (tasks || []).map((t) => [
    t.task_number || '',
    t.task_category || '',
    t.task_type || '',
    `"${(t.title || '').replace(/"/g, '""')}"`,
    t.priority || '',
    t.status || '',
    t.assigned_to_name || '',
    t.created_by_name || '',
    t.due_date || '',
    t.due_time || '',
    t.completed_at || '',
    t.completed_by_name || '',
    t.related_entity_type || '',
    `"${(t.related_entity_label || '').replace(/"/g, '""')}"`,
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
