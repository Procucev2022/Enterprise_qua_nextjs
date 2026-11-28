import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import { APPROVER_CONFIG } from './constants';
import type { ApprovalRequest, ApprovalSummary } from './types';

const RESOURCES = UI_STRINGS.dataLoad.resources;

function logApprovalTransportFailure(operation: string, error: unknown): void {
  logger.error(`${operation} request failed`, {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error && error.message ? error.message : 'Network error',
    ...(error instanceof Error ? { error } : {}),
  }, 'APPROVAL_CLIENT');
}

function logApprovalResponseFailure(operation: string, status: number): void {
  const metadata = Number.isFinite(status) ? { status } : {};
  const message = `${operation} request rejected`;
  if (status >= 500) {
    logger.error(message, metadata, 'APPROVAL_CLIENT');
  } else {
    logger.warn(message, metadata, 'APPROVAL_CLIENT');
  }
}

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Result of the approval summary request. `summary` is null when it could not be loaded. */
export interface ApprovalSummaryResult {
  summary: ApprovalSummary | null;
  error?: string;
}

/**
 * Fetch management approval summary counts.
 * On failure `summary` is null and `error` says why. No counts are substituted.
 */
export async function fetchApprovalSummary(): Promise<ApprovalSummaryResult> {
  const resource = RESOURCES.approvalSummary;
  try {
    const res = await fetch('/api/approvals/summary', { headers: authHeaders() });
    if (!res.ok) {
      logApprovalResponseFailure('Approval summary', res.status);
      return { summary: null, error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }) };
    }
    const json = await res.json();
    if (!json?.summary) {
      return { summary: null, error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }) };
    }
    return { summary: json.summary };
  } catch (error: unknown) {
    logApprovalTransportFailure('Approval summary', error);
    return { summary: null, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }) };
  }
}

/**
 * Fetch management approval requests matching filters.
 * On failure `data` is empty and `error` says why.
 */
export async function fetchApprovals(filters: {
  module?: string;
  status?: string;
  project?: string;
  search?: string;
  assigned_approver?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
} = {}): Promise<{ data: ApprovalRequest[]; total: number; error?: string }> {
  const resource = RESOURCES.approvals;
  try {
    const params = new URLSearchParams();
    if (filters.module && filters.module !== 'all') params.set('module', filters.module);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.project && filters.project !== 'all') params.set('project', filters.project);
    if (filters.search) params.set('search', filters.search);
    if (filters.assigned_approver) params.set('assigned_approver', filters.assigned_approver);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    if (filters.sortBy) params.set('sortBy', filters.sortBy);
    if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

    const res = await fetch(`/api/approvals?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) {
      logApprovalResponseFailure('Approval list', res.status);
      return { data: [], total: 0, error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }) };
    }
    const json = await res.json();
    if (!Array.isArray(json?.data)) {
      return { data: [], total: 0, error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }) };
    }
    return { data: json.data, total: typeof json.total === 'number' ? json.total : json.data.length };
  } catch (error: unknown) {
    logApprovalTransportFailure('Approval list', error);
    return { data: [], total: 0, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }) };
  }
}

/**
 * Approve or reject an approval request.
 */
export async function processApprovalAction(
  id: string,
  action: 'APPROVE' | 'REJECT',
  remarks = '',
  password = '',
  approverName = '',
  verificationType?: 'password' | 'otp'
): Promise<{ success: boolean; data?: ApprovalRequest; error?: string }> {
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action, remarks, password, approverName, verificationType }),
    });
    const json = await res.json();
    if (!res.ok) {
      logApprovalResponseFailure('Approval decision', res.status);
      return { success: false, error: json.error || 'Failed to process approval.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    logApprovalTransportFailure('Approval decision', err);
    const msg = err instanceof Error && err.message ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Send an OTP code to the assigned approver email for authorization.
 */
export async function sendApprovalOtp(
  approverName: string,
  id?: string
): Promise<{ success: boolean; message?: string; email?: string; expiresInSeconds?: number; error?: string }> {
  try {
    const res = await fetch('/api/approvals/send-otp', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ approverName, id }),
    });
    const json = await res.json();
    if (!res.ok) {
      logApprovalResponseFailure('Approval OTP request', res.status);
      return { success: false, error: json.error || 'Failed to send verification OTP.' };
    }
    return {
      success: true,
      message: json.message,
      email: json.email,
      expiresInSeconds: json.expiresInSeconds,
    };
  } catch (err: unknown) {
    logApprovalTransportFailure('Approval OTP request', err);
    const msg = err instanceof Error && err.message ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

export interface ApprovalApproverOption {
  id: string;
  name: string;
  title?: string;
  email?: string | null;
}

export interface ApprovalUserOption {
  id: string;
  name: string;
  role?: string | null;
  email?: string | null;
}

export async function fetchApprovalApprovers(): Promise<{ approvers: ApprovalApproverOption[]; error?: string }> {
  try {
    const res = await fetch('/api/approvals/approvers', { headers: authHeaders() });
    if (!res.ok) {
      return { approvers: [...APPROVER_CONFIG] };
    }
    const json = await res.json();
    if (Array.isArray(json?.approvers) && json.approvers.length > 0) {
      return { approvers: json.approvers };
    }
    return { approvers: [...APPROVER_CONFIG] };
  } catch {
    return { approvers: [...APPROVER_CONFIG] };
  }
}

export async function fetchApprovalUsers(): Promise<{ users: ApprovalUserOption[]; error?: string }> {
  try {
    const res = await fetch('/api/approvals/users', { headers: authHeaders() });
    if (!res.ok) {
      const fallback = await fetch('/api/internal-tasks/assignees', { headers: authHeaders() });
      if (fallback.ok) {
        const fJson = await fallback.json();
        if (Array.isArray(fJson?.assignees) && fJson.assignees.length > 0) {
          return { users: fJson.assignees };
        }
      }
      return {
        users: [
          { id: 'usr_govardhan', name: 'Govardhan', role: 'Category Manager' },
          { id: 'usr_krishna', name: 'Krishna', role: 'Category Manager' },
          { id: 'usr_chandan', name: 'Chandan', role: 'Internal Staff' },
          { id: 'usr_sudheer', name: 'Sudheer', role: 'Management Authority' },
        ],
      };
    }
    const json = await res.json();
    if (Array.isArray(json?.users) && json.users.length > 0) {
      return { users: json.users };
    }
    return {
      users: [
        { id: 'usr_govardhan', name: 'Govardhan', role: 'Category Manager' },
        { id: 'usr_krishna', name: 'Krishna', role: 'Category Manager' },
        { id: 'usr_chandan', name: 'Chandan', role: 'Internal Staff' },
        { id: 'usr_sudheer', name: 'Sudheer', role: 'Management Authority' },
      ],
    };
  } catch {
    return {
      users: [
        { id: 'usr_govardhan', name: 'Govardhan', role: 'Category Manager' },
        { id: 'usr_krishna', name: 'Krishna', role: 'Category Manager' },
        { id: 'usr_chandan', name: 'Chandan', role: 'Internal Staff' },
        { id: 'usr_sudheer', name: 'Sudheer', role: 'Management Authority' },
      ],
    };
  }
}
