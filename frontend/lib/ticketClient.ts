import { authClient } from './authClient';
import type {
  Ticket,
  TicketSummary,
  TicketFilterParams,
  TicketActivity,
} from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetch ticket summary counts.
 */
export async function fetchTicketSummary(): Promise<TicketSummary> {
  try {
    const res = await fetch('/api/tickets/summary', { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (
      json.summary || {
        total: 0,
        pending: 0,
        inProgress: 0,
        escalated: 0,
        completed: 0,
        criticalCount: 0,
      }
    );
  } catch {
    return {
      total: 0,
      pending: 0,
      inProgress: 0,
      escalated: 0,
      completed: 0,
      criticalCount: 0,
    };
  }
}

/**
 * Fetch paginated tickets matching filters.
 */
export async function fetchTickets(filters: TicketFilterParams = {}): Promise<{
  data: Ticket[];
  total: number;
  limit: number;
  offset: number;
}> {
  try {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters.project && filters.project !== 'all') params.set('project', filters.project);
    if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));

    const res = await fetch(`/api/tickets?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      data: json.data || [],
      total: json.total || 0,
      limit: json.limit || 50,
      offset: json.offset || 0,
    };
  } catch {
    return { data: [], total: 0, limit: 50, offset: 0 };
  }
}

/**
 * Fetch ticket by ID with full audit trail.
 */
export async function fetchTicketById(id: string): Promise<Ticket | null> {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Create a new ticket.
 */
export async function createTicket(
  payload: Partial<Ticket> & { subject: string }
): Promise<{ success: boolean; data?: Ticket; error?: string }> {
  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Failed to create ticket.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Update an existing ticket.
 */
export async function updateTicket(
  id: string,
  payload: Partial<Ticket>
): Promise<{ success: boolean; data?: Ticket; error?: string }> {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Failed to update ticket.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Escalate ticket to a manager.
 */
export async function escalateTicket(
  id: string,
  payload: { escalatedTo: string; reason: string }
): Promise<{ success: boolean; data?: Ticket; error?: string }> {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/escalate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Failed to escalate ticket.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Add a comment to a ticket.
 */
export async function addTicketComment(
  id: string,
  payload: { comment: string }
): Promise<{ success: boolean; data?: TicketActivity; error?: string }> {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: json.error || 'Failed to add comment.' };
    }
    return { success: true, data: json.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Delete a ticket.
 */
export async function deleteTicket(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get CSV export URL.
 */
export function getExportTicketsUrl(filters: TicketFilterParams = {}): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);
  if (filters.project && filters.project !== 'all') params.set('project', filters.project);
  if (filters.assignedTo && filters.assignedTo !== 'all') params.set('assignedTo', filters.assignedTo);
  return `/api/tickets/export?${params.toString()}`;
}

