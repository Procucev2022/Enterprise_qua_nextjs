/**
 * Login Logs API Client
 * Facilitates retrieving buyer and vendor session activity and real-time login telemetry.
 * Every result comes from GET /api/login-logs. A failed request returns an explicit error
 * and no substitute rows or counts.
 */

import type {
  LoginLogEntry,
  LoginLogsSummary,
  LoginLogsFilterParams,
} from './types';
import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';

const LOGIN_LOGS_LOG_CATEGORY = 'LOGIN_LOGS_CLIENT';
const RESOURCES = UI_STRINGS.dataLoad.resources;

function getAuthHeaders(): HeadersInit {
  const token = authClient.getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Result of the login log list request. `error` is set when the list could not be loaded. */
export interface LoginLogsResult {
  logs: LoginLogEntry[];
  total: number;
  page: number;
  totalPages: number;
  error?: string;
}

/** Result of the login log summary request. `summary` is null when it could not be loaded. */
export interface LoginLogsSummaryResult {
  summary: LoginLogsSummary | null;
  error?: string;
}

function emptyLogsResult(page: number, error: string): LoginLogsResult {
  return { logs: [], total: 0, page, totalPages: 0, error };
}

export async function fetchLoginLogs(params: LoginLogsFilterParams = {}): Promise<LoginLogsResult> {
  const query = new URLSearchParams();
  if (params.userType && params.userType !== 'all') {
    query.set('userType', params.userType);
  }
  if (params.status && params.status !== 'all') {
    query.set('status', params.status);
  }
  if (params.search) {
    query.set('search', params.search);
  }
  if (params.startDate) {
    query.set('startDate', params.startDate);
  }
  if (params.endDate) {
    query.set('endDate', params.endDate);
  }
  if (params.dateRangePreset) {
    query.set('dateRangePreset', params.dateRangePreset);
  }
  if (params.page) {
    query.set('page', String(params.page));
  }
  if (params.limit) {
    query.set('limit', String(params.limit));
  }

  const requestedPage = params.page || 1;
  const url = `/api/login-logs${query.toString() ? `?${query.toString()}` : ''}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      return emptyLogsResult(
        requestedPage,
        formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource: RESOURCES.loginLogs, status: res.status })
      );
    }

    const data = await res.json();
    if (!Array.isArray(data?.logs)) {
      return emptyLogsResult(
        requestedPage,
        formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource: RESOURCES.loginLogs })
      );
    }
    return {
      logs: data.logs,
      total: data.total !== undefined ? data.total : data.logs.length,
      page: data.page || 1,
      totalPages: data.totalPages || 1,
    };
  } catch (error: unknown) {
    logger.error('Login logs request failed', { error }, LOGIN_LOGS_LOG_CATEGORY);
    return emptyLogsResult(
      requestedPage,
      formatString(UI_STRINGS.dataLoad.networkFailed, { resource: RESOURCES.loginLogs })
    );
  }
}

export async function fetchLoginLogsSummary(): Promise<LoginLogsSummaryResult> {
  const resource = RESOURCES.loginLogsSummary;
  try {
    const res = await fetch('/api/login-logs/summary', {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      return {
        summary: null,
        error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }),
      };
    }

    const data = await res.json();
    if (!data?.summary) {
      return {
        summary: null,
        error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }),
      };
    }
    return { summary: data.summary };
  } catch (error: unknown) {
    logger.error('Login log summary request failed', { error }, LOGIN_LOGS_LOG_CATEGORY);
    return {
      summary: null,
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }),
    };
  }
}
