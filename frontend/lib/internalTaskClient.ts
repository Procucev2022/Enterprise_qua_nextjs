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

export async function escalateTask(
  taskId: string,
  payload: {
    escalateTo: string;
    escalationReason: string;
    notes?: string;
  }
): Promise<InternalTask | null> {
  const comment = `Escalated to ${payload.escalateTo}: ${payload.escalationReason}`;
  const notesText = payload.notes
    ? `[ESCALATION to ${payload.escalateTo}] ${payload.escalationReason}\n${payload.notes}`
    : `[ESCALATION to ${payload.escalateTo}] ${payload.escalationReason}`;

  return updateInternalTask(taskId, {
    priority: 'Critical',
    status: 'Escalated',
    assigned_to_name: payload.escalateTo,
    notes: notesText,
    activityComment: comment,
  });
}

// ==============================================================================
// APPROVALS MODULE TYPES & API (Action Center Approvals)
// ==============================================================================

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ApprovalItem {
  id: string;
  requestId: string;
  module: string;
  project: string;
  applicant: string;
  valueImpact: string;
  makerName: string;
  status: ApprovalStatus;
  notes?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewerName?: string;
}

export interface ApprovalSummary {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface ApprovalFilterParams {
  module?: string;
  status?: string;
  project?: string;
  search?: string;
  requestFrom?: string;
  requestTo?: string;
}

export interface ExecutiveOption {
  id: string;
  name: string;
  role: string;
  department?: string;
  resolvedTasks: number;
  openTasks: number;
  slaAdherence: number;
  avgResolutionTime: string;
}

export const DEFAULT_EXECUTIVES: ExecutiveOption[] = [
  {
    id: 'exec_sudheer',
    name: 'Sudheer Kangala',
    role: 'Senior Category Manager',
    department: 'Category Management',
    resolvedTasks: 42,
    openTasks: 5,
    slaAdherence: 98.1,
    avgResolutionTime: '2.4h',
  },
  {
    id: 'exec_priya',
    name: 'Priya Sharma',
    role: 'Category Executive',
    department: 'Category Management',
    resolvedTasks: 37,
    openTasks: 3,
    slaAdherence: 96.5,
    avgResolutionTime: '3.1h',
  },
  {
    id: 'exec_rahul',
    name: 'Rahul Varma',
    role: 'Procurement Specialist',
    department: 'Operations',
    resolvedTasks: 29,
    openTasks: 7,
    slaAdherence: 94.2,
    avgResolutionTime: '4.5h',
  },
  {
    id: 'exec_marketing',
    name: 'Ananya Rao',
    role: 'Growth & Marketing Lead',
    department: 'Growth / Marketing',
    resolvedTasks: 34,
    openTasks: 4,
    slaAdherence: 97.2,
    avgResolutionTime: '2.1h',
  },
  {
    id: 'exec_finance',
    name: 'Finance Desk Lead',
    role: 'Credit & Payment Manager',
    department: 'Finance',
    resolvedTasks: 51,
    openTasks: 4,
    slaAdherence: 99.0,
    avgResolutionTime: '1.8h',
  },
];

export const DEFAULT_APPROVAL_ITEMS: ApprovalItem[] = [
  {
    id: 'app_101',
    requestId: 'REQ-2026-081',
    module: 'Credit Allocations',
    project: 'Enterprise Steel Tender 2026',
    applicant: 'Tata Steel Solutions Ltd',
    valueImpact: '+50 Credits (₹25,000 allowance)',
    makerName: 'Sudheer Kangala',
    status: 'Pending',
    notes: 'Requested for extra RFQ technical quote downloads during pilot.',
    createdAt: '2026-10-29T11:30:00Z',
  },
  {
    id: 'app_102',
    requestId: 'REQ-2026-082',
    module: 'Account Approvals',
    project: 'Solar EPC Procurement',
    applicant: 'Apex Solar Energy Pvt Ltd',
    valueImpact: 'KYC & GSTIN Verification Verified',
    makerName: 'Priya Sharma',
    status: 'Pending',
    notes: 'Buyer registration awaiting category manager approval for RFQ submission.',
    createdAt: '2026-10-29T10:15:00Z',
  },
  {
    id: 'app_103',
    requestId: 'REQ-2026-083',
    module: 'Discounts & Waivers',
    project: 'Industrial Valve Ingestion',
    applicant: 'Godrej Process Solutions',
    valueImpact: '15% Commission Waiver (₹45,000)',
    makerName: 'Rahul Varma',
    status: 'Pending',
    notes: 'Special rate waiver for first high-volume transaction milestone.',
    createdAt: '2026-10-28T16:45:00Z',
  },
  {
    id: 'app_104',
    requestId: 'REQ-2026-084',
    module: 'Trial Period Extensions',
    project: 'Automotive Fasteners Contract',
    applicant: 'Mahindra Logistics Hub',
    valueImpact: '30 Days Extended Trial',
    makerName: 'Sudheer Kangala',
    status: 'Approved',
    notes: 'Extension granted by management following board review.',
    createdAt: '2026-10-27T14:20:00Z',
    reviewedAt: '2026-10-28T09:10:00Z',
    reviewerName: 'Veerababu Lead',
  },
  {
    id: 'app_105',
    requestId: 'REQ-2026-085',
    module: 'Payment Reconciliations',
    project: 'Ceramic Raw Materials RFP',
    applicant: 'Unique Ceramic Solutions',
    valueImpact: '₹1,20,000 Offline NEFT Settlement',
    makerName: 'Finance Desk Lead',
    status: 'Approved',
    notes: 'UTR verified against bank statement successfully.',
    createdAt: '2026-10-26T12:00:00Z',
    reviewedAt: '2026-10-26T15:40:00Z',
    reviewerName: 'Admin Auditor',
  },
  {
    id: 'app_106',
    requestId: 'REQ-2026-086',
    module: 'Credit Allocations',
    project: 'Heavy Machinery Fab',
    applicant: 'L&T Heavy Engineering',
    valueImpact: '+200 Unlimited Credits',
    makerName: 'Rahul Varma',
    status: 'Rejected',
    notes: 'Quota exceed without executive director signoff.',
    createdAt: '2026-10-25T08:30:00Z',
    reviewedAt: '2026-10-25T11:00:00Z',
    reviewerName: 'Operations Head',
  },
];

let inMemoryApprovals: ApprovalItem[] = [...DEFAULT_APPROVAL_ITEMS];

export async function fetchApprovals(filters: ApprovalFilterParams = {}): Promise<ApprovalItem[]> {
  try {
    const params = new URLSearchParams();
    if (filters.module && filters.module !== 'All Modules') params.set('module', filters.module);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.project && filters.project !== 'all') params.set('project', filters.project);
    if (filters.search) params.set('search', filters.search);
    if (filters.requestFrom) params.set('requestFrom', filters.requestFrom);
    if (filters.requestTo) params.set('requestTo', filters.requestTo);

    const res = await fetch(`/api/internal-tasks/approvals?${params.toString()}`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.approvals)) {
        inMemoryApprovals = data.approvals;
        return inMemoryApprovals;
      }
    }
  } catch {
    // Graceful fallback to client state
  }

  // Client filtering
  return inMemoryApprovals.filter((item) => {
    if (filters.module && filters.module !== 'All Modules' && item.module !== filters.module) {
      return false;
    }
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) {
      return false;
    }
    if (filters.project && filters.project !== 'all' && !item.project.toLowerCase().includes(filters.project.toLowerCase())) {
      return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const match =
        item.requestId.toLowerCase().includes(q) ||
        item.applicant.toLowerCase().includes(q) ||
        item.makerName.toLowerCase().includes(q) ||
        item.project.toLowerCase().includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });
}

export async function fetchApprovalSummary(): Promise<ApprovalSummary> {
  const pending = inMemoryApprovals.filter((a) => a.status === 'Pending').length;
  const approved = inMemoryApprovals.filter((a) => a.status === 'Approved').length;
  const rejected = inMemoryApprovals.filter((a) => a.status === 'Rejected').length;
  return {
    pending,
    approved,
    rejected,
    total: inMemoryApprovals.length,
  };
}

export async function updateApprovalStatus(
  id: string,
  status: ApprovalStatus,
  reviewerName: string = 'Current Executive',
  notes?: string
): Promise<ApprovalItem | null> {
  try {
    const res = await fetch(`/api/internal-tasks/approvals/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ status, reviewerName, notes }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.approval) {
        inMemoryApprovals = inMemoryApprovals.map((a) => (a.id === id ? data.approval : a));
        return data.approval;
      }
    }
  } catch {
    // Fallback to local update
  }

  const existingIndex = inMemoryApprovals.findIndex((a) => a.id === id);
  if (existingIndex === -1) return null;

  const updated: ApprovalItem = {
    ...inMemoryApprovals[existingIndex],
    status,
    reviewedAt: new Date().toISOString(),
    reviewerName,
    ...(notes ? { notes: `${inMemoryApprovals[existingIndex].notes || ''}\n[Review Note]: ${notes}`.trim() } : {}),
  };

  inMemoryApprovals[existingIndex] = updated;
  return updated;
}

export async function createApprovalRequest(payload: {
  module: string;
  project: string;
  applicant: string;
  valueImpact: string;
  makerName: string;
  notes?: string;
}): Promise<ApprovalItem> {
  const newReq: ApprovalItem = {
    id: `app_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    requestId: `REQ-2026-${Math.floor(100 + Math.random() * 900)}`,
    module: payload.module,
    project: payload.project,
    applicant: payload.applicant,
    valueImpact: payload.valueImpact,
    makerName: payload.makerName,
    status: 'Pending',
    notes: payload.notes,
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/internal-tasks/approvals', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(newReq),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.approval) {
        inMemoryApprovals.unshift(data.approval);
        return data.approval;
      }
    }
  } catch {
    // Local fallback
  }

  inMemoryApprovals.unshift(newReq);
  return newReq;
}

export interface ApprovalRuleConfig {
  id: string;
  name: string;
  module: string;
  threshold: string;
  requiresReview: boolean;
  approverRole: string;
}

export const DEFAULT_APPROVAL_RULES: ApprovalRuleConfig[] = [
  {
    id: 'rule_1',
    name: 'Credit Allocation Cap',
    module: 'Credit Allocations',
    threshold: 'Credit addition > 50 credits (₹25,000)',
    requiresReview: true,
    approverRole: 'Finance Desk Lead / Admin',
  },
  {
    id: 'rule_2',
    name: 'Buyer KYC Fast-Track',
    module: 'Account Approvals',
    threshold: 'All Enterprise & Institutional Accounts',
    requiresReview: true,
    approverRole: 'Category Operations Head',
  },
  {
    id: 'rule_3',
    name: 'Commercial Waiver Limit',
    module: 'Discounts & Waivers',
    threshold: 'Discounts or Waivers > 10% fee',
    requiresReview: true,
    approverRole: 'Director of Procurement',
  },
  {
    id: 'rule_4',
    name: 'Trial Extension Period',
    module: 'Trial Period Extensions',
    threshold: 'Extensions exceeding 14 calendar days',
    requiresReview: true,
    approverRole: 'Senior Category Manager',
  },
];

const inMemoryRules: ApprovalRuleConfig[] = [...DEFAULT_APPROVAL_RULES];

export async function fetchApprovalRules(): Promise<ApprovalRuleConfig[]> {
  return [...inMemoryRules];
}

export async function updateApprovalRule(id: string, updates: Partial<ApprovalRuleConfig>): Promise<ApprovalRuleConfig | null> {
  const index = inMemoryRules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  inMemoryRules[index] = { ...inMemoryRules[index], ...updates };
  return inMemoryRules[index];
}
