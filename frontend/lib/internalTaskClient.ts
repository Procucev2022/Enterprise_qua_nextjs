import { authClient } from './authClient';

export interface TaskType {
  id: string;
  name: string;
  code: string;
  default_module: string;
  description?: string;
  is_active?: boolean | number;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  action_type: string;
  actor_id?: string;
  actor_name?: string;
  from_value?: string;
  to_value?: string;
  comment?: string;
  created_at: string;
}

export type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Pending' | 'In Progress' | 'Blocked' | 'Completed' | 'Escalated';
export type TaskEntityType = 'RFQ' | 'BUYER' | 'VENDOR' | 'CREDIT' | 'CATEGORY' | 'PAYMENT' | 'USER' | 'GENERAL';

export interface InternalTask {
  id: string;
  task_number: string;
  title: string;
  description?: string;
  task_type_id?: string;
  task_type_name?: string;
  task_type_code?: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to_user_id?: string;
  assigned_to_name?: string;
  assigned_team?: string;
  created_by_user_id?: string;
  created_by_name?: string;
  due_date?: string;
  completed_at?: string;
  related_entity_type: TaskEntityType;
  related_entity_id?: string;
  related_entity_label?: string;
  notes?: string;
  attachments?: Array<{ name: string; url?: string; size?: number }>;
  activities?: TaskActivity[];
  created_at: string;
  updated_at: string;
}

export interface TaskSummary {
  total: number;
  pending: number;
  inProgress: number;
  blocked: number;
  completed: number;
  escalated: number;
  criticalCount: number;
}

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
  taskTypeId?: string;
  relatedEntityType?: string;
  assignedTo?: string;
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
    description: 'Follow-up with sellers on active tenders, pricing, or compliance',
  },
  {
    id: 'itt_credit_approval',
    name: 'Credit Approval',
    code: 'credit_approval',
    default_module: 'CREDIT',
    description: 'Review and grant credits for RFQ generation or download allowance',
  },
  {
    id: 'itt_category_audit',
    name: 'Category Audit',
    code: 'category_audit',
    default_module: 'CATEGORY',
    description: 'Audit procurement category taxonomy and vendor category mappings',
  },
  {
    id: 'itt_payment_verification',
    name: 'Payment Verification',
    code: 'payment_verification',
    default_module: 'PAYMENT',
    description: 'Reconcile offline payments, gateway webhooks, and refunds',
  },
  {
    id: 'itt_account_governance',
    name: 'Account Governance',
    code: 'account_governance',
    default_module: 'USER',
    description: 'Manage user accounts, credential resets, and permissions',
  },
  {
    id: 'itt_general_ops',
    name: 'General Operations',
    code: 'general_ops',
    default_module: 'GENERAL',
    description: 'Internal operational escalations and triage tasks',
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
    if (filters.taskTypeId && filters.taskTypeId !== 'all') params.set('taskTypeId', filters.taskTypeId);
    if (filters.relatedEntityType && filters.relatedEntityType !== 'all') {
      params.set('relatedEntityType', filters.relatedEntityType);
    }
    if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
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

export async function fetchTaskSummary(): Promise<TaskSummary> {
  const fallback: TaskSummary = {
    total: 0,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    completed: 0,
    escalated: 0,
    criticalCount: 0,
  };
  try {
    const res = await fetch('/api/internal-tasks/summary', { headers: authHeaders() });
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
  taskTypeId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedToUserId?: string;
  assignedToName?: string;
  assignedTeam?: string;
  dueDate?: string;
  relatedEntityType?: TaskEntityType;
  relatedEntityId?: string;
  relatedEntityLabel?: string;
  notes?: string;
  attachments?: Array<{ name: string; url?: string }>;
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
  updates: Partial<InternalTask> & { activityComment?: string }
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
  if (filters.taskTypeId && filters.taskTypeId !== 'all') params.set('taskTypeId', filters.taskTypeId);
  if (filters.relatedEntityType && filters.relatedEntityType !== 'all') {
    params.set('relatedEntityType', filters.relatedEntityType);
  }
  if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  return `/api/internal-tasks/export?${params.toString()}`;
}
