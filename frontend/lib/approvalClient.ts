import { authClient } from './authClient';
import { logger } from './logger';
import type { ApprovalRequest, ApprovalSummary } from './types';

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

/**
 * Fetch management approval summary counts.
 */
export async function fetchApprovalSummary(): Promise<ApprovalSummary> {
  try {
    const res = await fetch('/api/approvals/summary', { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.summary || { pending: 0, approved: 0, rejected: 0, total: 0 };
  } catch (error: unknown) {
    logApprovalTransportFailure('Approval summary', error);
    return { pending: 0, approved: 0, rejected: 0, total: 0 };
  }
}

/**
 * Fetch management approval requests matching filters.
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
} = {}): Promise<{ data: ApprovalRequest[]; total: number }> {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { data: json.data || [], total: json.total || 0 };
  } catch (error: unknown) {
    logApprovalTransportFailure('Approval list', error);
    return { data: [], total: 0 };
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
  approverName = ''
): Promise<{ success: boolean; data?: ApprovalRequest; error?: string }> {
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action, remarks, password, approverName }),
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
