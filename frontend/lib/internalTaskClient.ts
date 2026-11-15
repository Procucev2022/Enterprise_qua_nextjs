import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  InternalTask,
  InternalTeamMember,
  TaskSummary,
  InternalTaskCategory,
  InternalTaskStatus,
  InternalTaskPriority,
  DemoStatus,
  CreditAccountType,
  InternalTaskActivity,
} from './types';

export type { InternalTeamMember, InternalTask, TaskSummary, InternalTaskCategory, InternalTaskStatus, InternalTaskPriority, DemoStatus, CreditAccountType };

const LOAD_RESOURCES = UI_STRINGS.dataLoad.resources;

function getInternalTaskErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function logInternalTaskTransportFailure(operation: string, error: unknown, fallback: string): string {
  const errorMessage = getInternalTaskErrorMessage(error, fallback);
  logger.error(`${operation} request failed`, {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage,
    ...(error instanceof Error ? { error } : {}),
  }, 'INTERNAL_TASK_CLIENT');
  return errorMessage;
}

function loadFailure(resource: string, status: number): string {
  return formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status });
}

function unexpectedResponse(resource: string): string {
  return formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource });
}

/** Logs a thrown request error and returns the message to show. The raw browser text is never shown. */
function reportLoadException(operation: string, error: unknown, resource: string): string {
  logInternalTaskTransportFailure(operation, error, resource);
  return formatString(UI_STRINGS.dataLoad.networkFailed, { resource });
}

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

/** Result of loading task types. `error` is set when the list could not be loaded. */
export interface TaskTypesResult {
  taskTypes: TaskType[];
  error?: string;
}

/** Result of loading task assignees. `error` is set when the list could not be loaded. */
export interface TaskAssigneesResult {
  assignees: InternalTeamMember[];
  error?: string;
}

/** Result of loading the task summary. `summary` is null when it could not be loaded. */
export interface TaskSummaryResult {
  summary: TaskSummary | null;
  error?: string;
}

/** Result of searching related records. `error` is set when the search failed. */
export interface RelatedEntitiesResult {
  entities: RelatedEntityOption[];
  error?: string;
}

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchTaskTypes(): Promise<TaskTypesResult> {
  const resource = LOAD_RESOURCES.taskTypes;
  try {
    const res = await fetch('/api/internal-tasks/task-types', { headers: authHeaders() });
    if (!res.ok) return { taskTypes: [], error: loadFailure(resource, res.status) };
    const data = await res.json();
    if (!Array.isArray(data?.taskTypes)) return { taskTypes: [], error: unexpectedResponse(resource) };
    return { taskTypes: data.taskTypes };
  } catch (error: unknown) {
    return { taskTypes: [], error: reportLoadException('Task types load', error, resource) };
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
  error?: string;
}> {
  const resource = LOAD_RESOURCES.internalTasks;
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
    if (!res.ok) return { tasks: [], total: 0, error: loadFailure(resource, res.status) };
    const data = await res.json();
    if (!Array.isArray(data?.tasks)) return { tasks: [], total: 0, error: unexpectedResponse(resource) };
    return {
      tasks: data.tasks,
      total: typeof data.total === 'number' ? data.total : data.tasks.length,
    };
  } catch (error: unknown) {
    return { tasks: [], total: 0, error: reportLoadException('Internal tasks load', error, resource) };
  }
}

export async function fetchInternalAssignees(): Promise<TaskAssigneesResult> {
  const resource = LOAD_RESOURCES.assignees;
  try {
    const res = await fetch('/api/internal-tasks/assignees', { headers: authHeaders() });
    if (!res.ok) return { assignees: [], error: loadFailure(resource, res.status) };
    const data = await res.json();
    if (!Array.isArray(data?.assignees)) return { assignees: [], error: unexpectedResponse(resource) };
    return { assignees: data.assignees };
  } catch (error: unknown) {
    return { assignees: [], error: reportLoadException('Task assignees load', error, resource) };
  }
}

export async function fetchTaskSummary(params?: { assignedTo?: string; taskCategory?: string }): Promise<TaskSummaryResult> {
  const resource = LOAD_RESOURCES.taskSummary;
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
    if (!res.ok) return { summary: null, error: loadFailure(resource, res.status) };
    const data = await res.json();
    if (!data?.summary) return { summary: null, error: unexpectedResponse(resource) };
    return { summary: data.summary };
  } catch (error: unknown) {
    return { summary: null, error: reportLoadException('Task summary load', error, resource) };
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
  } catch (error: unknown) {
    return {
      success: false,
      error: logInternalTaskTransportFailure('Credit task approval', error, 'Failed to approve credit task.'),
    };
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
  } catch (error: unknown) {
    return {
      success: false,
      error: logInternalTaskTransportFailure('Credit task rejection', error, 'Failed to reject credit task.'),
    };
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
  } catch (error: unknown) {
    return {
      success: false,
      error: logInternalTaskTransportFailure('Task activity submission', error, 'Failed to add activity.'),
    };
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
  } catch (error: unknown) {
    return {
      success: false,
      error: logInternalTaskTransportFailure('Task reminder check', error, 'Failed to check reminders.'),
    };
  }
}

export async function searchRelatedEntities(type: TaskEntityType, query: string = ''): Promise<RelatedEntitiesResult> {
  const resource = LOAD_RESOURCES.relatedRecords;
  try {
    const params = new URLSearchParams({ type, q: query });
    const res = await fetch(`/api/internal-tasks/entities?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) return { entities: [], error: loadFailure(resource, res.status) };
    const data = await res.json();
    if (!Array.isArray(data?.entities)) return { entities: [], error: unexpectedResponse(resource) };
    return { entities: data.entities };
  } catch (error: unknown) {
    return { entities: [], error: reportLoadException('Related records search', error, resource) };
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
