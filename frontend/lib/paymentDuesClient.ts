import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
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

const PAYMENT_DUES_LOG_CATEGORY = 'PAYMENT_DUES_CLIENT';
const RESOURCES = UI_STRINGS.dataLoad.resources;

/** Result of the summary KPI request. `summary` is null when it could not be loaded. */
export interface PaymentDuesSummaryResult {
  summary: PaymentDuesSummary | null;
  error?: string;
}

/** Result of the communication history request. `error` is set when the history could not be loaded. */
export interface PaymentDuesHistoryResult {
  history: PaymentDuesCommunication[];
  error?: string;
}

/** Shared shape for the send helpers. `status` is the delivery state the API reported. */
export interface PaymentDuesSendResult {
  success: boolean;
  communication?: PaymentDuesCommunication;
  status?: string;
  error?: string;
}

function logPaymentDuesFailure(
  operation: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void {
  const errorDetails = error instanceof Error
    ? { error, errorName: error.name, errorMessage: error.message }
    : { errorName: 'UnknownError', errorMessage: 'Non-Error payment dues failure' };
  logger.error(`Payment dues ${operation} failed`, { ...errorDetails, ...metadata }, PAYMENT_DUES_LOG_CATEGORY);
}

function logPaymentDuesResponseFailure(operation: string, status: number, responseErrorPresent = false): void {
  const httpFailure = status < 200 || status >= 300;
  const errorMessage = httpFailure ? `HTTP ${status}` : 'API response indicated failure';
  logPaymentDuesFailure(operation, new Error(errorMessage), {
    status,
    responseErrorPresent,
    errorName: httpFailure ? 'HttpError' : 'ApiResponseError',
  });
}

function loadFailureMessage(resource: string, status: number): string {
  return formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status });
}

function networkFailureMessage(resource: string): string {
  return formatString(UI_STRINGS.dataLoad.networkFailed, { resource });
}

function unexpectedResponseMessage(resource: string): string {
  return formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource });
}

/** The delivery state an API response reports, when it reports one. */
function reportedStatus(json: { status?: unknown; communication?: { deliveryStatus?: unknown } }): string | undefined {
  if (typeof json.status === 'string') return json.status;
  const deliveryStatus = json.communication?.deliveryStatus;
  return typeof deliveryStatus === 'string' ? deliveryStatus : undefined;
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

/**
 * Fetch dynamic summary KPI counts for low-credit monitoring.
 * On failure `summary` is null and `error` says why. No counts are substituted.
 */
export async function fetchPaymentDuesSummary(): Promise<PaymentDuesSummaryResult> {
  const resource = RESOURCES.paymentDuesSummary;
  try {
    const res = await fetch('/api/payment-dues/summary', { headers: authHeaders() });
    if (!res.ok) {
      logPaymentDuesResponseFailure('summary fetch', res.status);
      return { summary: null, error: loadFailureMessage(resource, res.status) };
    }
    const json = await res.json();
    if (!json?.summary) {
      logPaymentDuesFailure('summary fetch', new Error('Summary missing from response'));
      return { summary: null, error: unexpectedResponseMessage(resource) };
    }
    return { summary: json.summary };
  } catch (error: unknown) {
    logPaymentDuesFailure('summary fetch', error);
    return { summary: null, error: networkFailureMessage(resource) };
  }
}

/**
 * Fetch low-credit accounts matching search, filters, sorting, and pagination.
 * On failure `accounts` is empty, `summary` is null, and `error` is set.
 */
export async function fetchPaymentDues(
  filters: PaymentDuesFilterParams = {}
): Promise<{
  accounts: PaymentDuesAccount[];
  total: number;
  summary: PaymentDuesSummary | null;
  page: number;
  limit: number;
  error?: string;
}> {
  const resource = RESOURCES.paymentDues;
  try {
    const params = buildQueryParams(filters);
    const res = await fetch(`/api/payment-dues?${params.toString()}`, { headers: authHeaders() });
    if (!res.ok) {
      let errMsg = loadFailureMessage(resource, res.status);
      let responseErrorPresent = false;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) {
          errMsg = errJson.error;
          responseErrorPresent = true;
        }
      } catch (error: unknown) {
        logPaymentDuesFailure('account-list error response parsing', error, { status: res.status });
      }
      logPaymentDuesResponseFailure('account-list fetch', res.status, responseErrorPresent);
      return {
        accounts: [],
        total: 0,
        summary: null,
        page: 1,
        limit: 25,
        error: errMsg,
      };
    }
    const json = await res.json();
    if (!Array.isArray(json?.accounts)) {
      logPaymentDuesFailure('account-list fetch', new Error('Accounts missing from response'));
      return {
        accounts: [],
        total: 0,
        summary: null,
        page: 1,
        limit: 25,
        error: unexpectedResponseMessage(resource),
      };
    }
    return {
      accounts: json.accounts,
      total: json.total || 0,
      summary: json.summary ?? null,
      page: json.page || 1,
      limit: json.limit || 25,
    };
  } catch (err) {
    logPaymentDuesFailure('account-list fetch', err);
    return {
      accounts: [],
      total: 0,
      summary: null,
      page: 1,
      limit: 25,
      error: networkFailureMessage(resource),
    };
  }
}

/**
 * Dispatch an email notification to a low-credit account.
 * `success` is true only when the API reports success.
 */
export async function sendPaymentDuesEmail(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  recipientEmail: string;
  subject: string;
  message: string;
  notes?: string;
}): Promise<PaymentDuesSendResult> {
  try {
    const res = await fetch('/api/payment-dues/email', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.success !== true) {
      logPaymentDuesResponseFailure('email notification', res.status, Boolean(json.error));
      return { success: false, status: 'failed', error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication, status: reportedStatus(json) };
  } catch (err: unknown) {
    logPaymentDuesFailure('email notification', err, { method: 'POST' });
    return { success: false, status: 'failed', error: UI_STRINGS.dataLoad.requestNetworkFailed };
  }
}

/**
 * Dispatch an in-app message notification to a low-credit account.
 * `success` is true only when the API reports success.
 */
export async function sendPaymentDuesMessage(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  title?: string;
  message: string;
  notes?: string;
}): Promise<PaymentDuesSendResult> {
  try {
    const res = await fetch('/api/payment-dues/message', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.success !== true) {
      logPaymentDuesResponseFailure('in-app message notification', res.status, Boolean(json.error));
      return { success: false, status: 'failed', error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication, status: reportedStatus(json) };
  } catch (err: unknown) {
    logPaymentDuesFailure('in-app message notification', err, { method: 'POST' });
    return { success: false, status: 'failed', error: UI_STRINGS.dataLoad.requestNetworkFailed };
  }
}

/**
 * Initiate and record a WhatsApp notification to a low-credit account.
 * A reply with `directLink` did not reach a WhatsApp provider. The user must send the message
 * from the wa.me link, so `success` is false, `status` is 'link_only', and `directLink` is kept.
 */
export async function sendPaymentDuesWhatsApp(payload: {
  accountId: string;
  accountType: PaymentDuesAccountType;
  phone: string;
  message: string;
  notes?: string;
}): Promise<PaymentDuesSendResult & { directLink?: string }> {
  try {
    const res = await fetch('/api/payment-dues/whatsapp', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.success !== true) {
      logPaymentDuesResponseFailure('WhatsApp notification', res.status, Boolean(json.error));
      return { success: false, status: 'failed', error: json.error || `HTTP ${res.status}` };
    }
    const directLink = typeof json.directLink === 'string' && json.directLink ? json.directLink : undefined;
    if (directLink) {
      return {
        success: false,
        communication: json.communication,
        directLink,
        status: 'link_only',
        error: UI_STRINGS.dataLoad.whatsAppLinkOnly,
      };
    }
    return {
      success: true,
      communication: json.communication,
      directLink,
      status: reportedStatus(json),
    };
  } catch (err: unknown) {
    logPaymentDuesFailure('WhatsApp notification', err, { method: 'POST' });
    return { success: false, status: 'failed', error: UI_STRINGS.dataLoad.requestNetworkFailed };
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
}): Promise<PaymentDuesSendResult> {
  try {
    const res = await fetch('/api/payment-dues/acknowledge', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.success !== true) {
      logPaymentDuesResponseFailure('acknowledgement update', res.status, Boolean(json.error));
      return { success: false, status: 'failed', error: json.error || `HTTP ${res.status}` };
    }
    return { success: true, communication: json.communication, status: reportedStatus(json) };
  } catch (err: unknown) {
    logPaymentDuesFailure('acknowledgement update', err, { method: 'POST' });
    return { success: false, status: 'failed', error: UI_STRINGS.dataLoad.requestNetworkFailed };
  }
}

/**
 * Fetch communication history and audit log for a specific account.
 * On failure `history` is empty and `error` says why.
 */
export async function fetchPaymentDuesHistory(
  accountId: string
): Promise<PaymentDuesHistoryResult> {
  const resource = RESOURCES.paymentDuesHistory;
  try {
    const res = await fetch(`/api/payment-dues/history/${encodeURIComponent(accountId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      logPaymentDuesResponseFailure('communication history fetch', res.status);
      return { history: [], error: loadFailureMessage(resource, res.status) };
    }
    const json = await res.json();
    if (!Array.isArray(json?.history)) {
      logPaymentDuesFailure('communication history fetch', new Error('History missing from response'));
      return { history: [], error: unexpectedResponseMessage(resource) };
    }
    return { history: json.history };
  } catch (error: unknown) {
    logPaymentDuesFailure('communication history fetch', error);
    return { history: [], error: networkFailureMessage(resource) };
  }
}

/**
 * Generate CSV export download URL with existing filter parameters.
 */
export function getPaymentDuesExportUrl(filters: PaymentDuesFilterParams = {}): string {
  const params = buildQueryParams(filters);
  return `/api/payment-dues/export?${params.toString()}`;
}
