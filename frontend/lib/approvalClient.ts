import { authClient } from './authClient';
import type { ApprovalRequest, ApprovalSummary } from './types';

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
  } catch {
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
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: ApprovalRequest[]; total: number }> {
  try {
    const params = new URLSearchParams();
    if (filters.module && filters.module !== 'all') params.set('module', filters.module);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.project && filters.project !== 'all') params.set('project', filters.project);
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));

    const res = await fetch(`/api/approvals?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { data: json.data || [], total: json.total || 0 };
  } catch {
    return { data: [], total: 0 };
  }
}

/**
 * Approve or reject an approval request.
 */
export async function processApprovalAction(
  id: string,
  action: 'APPROVE' | 'REJECT',
  remarks = ''
): Promise<{ success: boolean; data?: ApprovalRequest; error?: string }> {
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action, remarks }),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Failed to process approval.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

