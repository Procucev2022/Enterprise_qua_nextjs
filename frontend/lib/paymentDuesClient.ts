import { authClient } from './authClient';
import type {
  PaymentDuesAccount,
  PaymentDuesSummary,
  PaymentDuesCommunication,
  PaymentDuesFilterParams,
  PaymentDuesAcknowledgementStatus,
  PaymentDuesAccountType,
} from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Network error';
}

function buildQueryParams(filters: PaymentDuesFilterParams): URLSearchParams {
  const params = new URLSearchParams();
  const entries: Array<[string, string | number | undefined]> = [
    ['search', filters.search],
    ['accountType', filters.accountType],
    ['credits', filters.credits],
    ['acknowledgementStatus', filters.acknowledgementStatus],
    ['accountStatus', filters.accountStatus],
    ['assignedExecutive', filters.assignedExecutive],
    ['notificationChannel', filters.notificationChannel],
    ['sortBy', filters.sortBy],
    ['sortOrder', filters.sortOrder],
    ['page', filters.page],
    ['limit', filters.limit],
  ];

  for (const [key, val] of entries) {
    if (val !== undefined && val !== null && val !== '' && val !== 'all') {
      params.set(key, String(val));
    }
  }
  return params;
}

const DEFAULT_SUMMARY: PaymentDuesSummary = {
  totalLowCreditAccounts: 0,
  totalBuyers: 0,
  totalSellers: 0,
  zeroCredits: 0,
  oneToTwoCredits: 0,
  acknowledgementPending: 0,
};

/**
 * Fetch dynamic summary KPI counts for low-credit monitoring.
 */
export async function fetchPaymentDuesSummary(): Promise<PaymentDuesSummary> {
  try {
    const res = await fetch('/api/payment-dues/summary', { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.summary || DEFAULT_SUMMARY;
  } catch {
    return DEFAULT_SUMMARY;
  }
}

/**
 * Fetch low-credit accounts matching search, filters, sorting, and pagination.
 */
export async function fetchPaymentDues(
  filters: PaymentDuesFilterParams = {}
): Promise<{
  accounts: PaymentDuesAccount[];
  total: number;
  summary: PaymentDuesSummary;
  page: number;
  limit: number;
}> {
  try {
    const params = buildQueryParams(filters);
    const res = await fetch(`/api/payment-dues?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      accounts: json.accounts || [],
      total: json.total || 0,
      summary: json.summary || DEFAULT_SUMMARY,
      page: json.page || 1,
      limit: json.limit || 25,
    };
  } catch {
    return {
      accounts: [],
      total: 0,
      summary: DEFAULT_SUMMARY,
      page: 1,
      limit: 25,
    };
  }
}

/**
 * Dispatch an email notification to a low-credit account.
 */
export async function sendPaymentDuesEmail(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  recipientEmail: string;
  subject: string;
  message: string;
  notes?: string;
}): Promise<{ success: boolean; communication?: PaymentDuesCommunication; error?: string }> {
  try {
    const res = await fetch('/api/payment-dues/email', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication };
  } catch (err: unknown) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Dispatch an in-app message notification to a low-credit account.
 */
export async function sendPaymentDuesMessage(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  title?: string;
  message: string;
  notes?: string;
}): Promise<{ success: boolean; communication?: PaymentDuesCommunication; error?: string }> {
  try {
    const res = await fetch('/api/payment-dues/message', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication };
  } catch (err: unknown) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Initiate and record a WhatsApp notification to a low-credit account.
 */
export async function sendPaymentDuesWhatsApp(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  phone: string;
  message: string;
  notes?: string;
}): Promise<{ success: boolean; communication?: PaymentDuesCommunication; directLink?: string; error?: string }> {
  try {
    const res = await fetch('/api/payment-dues/whatsapp', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication, directLink: json.directLink };
  } catch (err: unknown) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Update the acknowledgement status of a low-credit account.
 */
export async function updatePaymentDuesAcknowledgement(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  acknowledgementStatus: PaymentDuesAcknowledgementStatus;
  notes?: string;
}): Promise<{ success: boolean; communication?: PaymentDuesCommunication; error?: string }> {
  try {
    const res = await fetch('/api/payment-dues/acknowledge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication };
  } catch (err: unknown) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch communication history and audit log for a specific account.
 */
export async function fetchPaymentDuesHistory(
  accountId: string
): Promise<PaymentDuesCommunication[]> {
  try {
    const res = await fetch(`/api/payment-dues/history/${encodeURIComponent(accountId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.history || [];
  } catch {
    return [];
  }
}

/**
 * Generate CSV export download URL with existing filter parameters.
 */
export function getPaymentDuesExportUrl(filters: PaymentDuesFilterParams = {}): string {
  const params = buildQueryParams(filters);
  return `/api/payment-dues/export?${params.toString()}`;
}
