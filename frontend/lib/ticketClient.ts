import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  Ticket,
  TicketSummary,
  TicketFilterParams,
  TicketActivity,
} from './types';

const TICKET_LOG_CATEGORY = 'TICKET_CLIENT';
const RESOURCES = UI_STRINGS.dataLoad.resources;

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Result of the ticket summary request. `summary` is null when it could not be loaded. */
export interface TicketSummaryResult {
  summary: TicketSummary | null;
  error?: string;
}

/**
 * Fetch ticket summary counts.
 * On failure `summary` is null and `error` says why. No counts are substituted.
 */
export async function fetchTicketSummary(): Promise<TicketSummaryResult> {
  const resource = RESOURCES.ticketSummary;
  try {
    const res = await fetch('/api/tickets/summary', { headers: authHeaders() });
    if (!res.ok) {
      return { summary: null, error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }) };
    }
    const json = await res.json();
    if (!json?.summary) {
      return { summary: null, error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }) };
    }
    return { summary: json.summary };
  } catch (error: unknown) {
    logger.error('Ticket summary request failed', { error }, TICKET_LOG_CATEGORY);
    return { summary: null, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }) };
  }
}

/**
 * Fetch paginated tickets matching filters.
 * On failure `data` is empty and `error` says why.
 */
export async function fetchTickets(filters: TicketFilterParams = {}): Promise<{
  data: Ticket[];
  total: number;
  limit: number;
  offset: number;
  error?: string;
}> {
  const resource = RESOURCES.tickets;
  const requestedLimit = filters.limit || 50;
  const requestedOffset = filters.offset ?? 0;
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
    if (!res.ok) {
      return {
        data: [],
        total: 0,
        limit: requestedLimit,
        offset: requestedOffset,
        error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }),
      };
    }
    const json = await res.json();
    if (!Array.isArray(json?.data)) {
      return {
        data: [],
        total: 0,
        limit: requestedLimit,
        offset: requestedOffset,
        error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }),
      };
    }
    return {
      data: json.data,
      total: typeof json.total === 'number' ? json.total : json.data.length,
      limit: json.limit || requestedLimit,
      offset: json.offset || 0,
    };
  } catch (error: unknown) {
    logger.error('Ticket list request failed', { error }, TICKET_LOG_CATEGORY);
    return {
      data: [],
      total: 0,
      limit: requestedLimit,
      offset: requestedOffset,
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }),
    };
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
