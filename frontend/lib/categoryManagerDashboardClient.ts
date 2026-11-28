import { authClient } from './authClient';
import { logger } from './logger';
import type {
  CategoryManagerDashboardKPI,
  CategoryManagerDashboardCharts,
  CategoryManagerDashboardRecordType,
  CategoryManagerDashboardPopupRecord,
  CategoryManagerDashboardMetricsResponse,
  CategoryManagerDashboardRecordsResponse,
} from './types';

/** Standardized authorization headers matching all Category Manager clients */
function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface DashboardMetricsResult {
  success: boolean;
  kpi?: CategoryManagerDashboardKPI;
  charts?: CategoryManagerDashboardCharts;
  error?: string;
  status?: number;
}

export interface DashboardRecordsResult {
  success: boolean;
  records?: CategoryManagerDashboardPopupRecord[];
  total?: number;
  error?: string;
  status?: number;
}

/**
 * Fetch KPI metrics and 6-month chart trends from the backend.
 * Uses exact same relative URL and auth header conventions as All RFQs and Action Center.
 */
export async function fetchDashboardMetrics(options: {
  preset?: string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<DashboardMetricsResult> {
  const params = new URLSearchParams();
  if (options.preset && options.preset !== 'custom' && options.preset !== 'all') {
    params.set('preset', options.preset);
  }
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const url = `/api/category-manager/dashboard/metrics${queryStr}`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      logger.error('Dashboard metrics request failed', {
        status: res.status,
        url,
        errorBody,
      }, 'CM_DASHBOARD_CLIENT');
      return {
        success: false,
        status: res.status,
        error: `HTTP ${res.status}: ${errorBody || res.statusText}`,
      };
    }
    const data: CategoryManagerDashboardMetricsResponse = await res.json();
    return {
      success: true,
      kpi: data.kpi,
      charts: data.charts,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Dashboard metrics network failure', { url, error: err }, 'CM_DASHBOARD_CLIENT');
    return {
      success: false,
      error: `Network error: ${msg}`,
    };
  }
}

/**
 * Fetch popup drilldown records for a specific KPI metric card.
 */
export async function fetchDashboardRecords(options: {
  type: CategoryManagerDashboardRecordType;
  preset?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}): Promise<DashboardRecordsResult> {
  const params = new URLSearchParams({ type: options.type });
  if (options.preset && options.preset !== 'custom' && options.preset !== 'all') {
    params.set('preset', options.preset);
  }
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);
  if (options.search) params.set('search', options.search);

  const queryStr = `?${params.toString()}`;
  const url = `/api/category-manager/dashboard/records${queryStr}`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      logger.error('Dashboard records request failed', {
        status: res.status,
        url,
        errorBody,
      }, 'CM_DASHBOARD_CLIENT');
      return {
        success: false,
        status: res.status,
        error: `HTTP ${res.status}: ${errorBody || res.statusText}`,
      };
    }
    const data: CategoryManagerDashboardRecordsResponse = await res.json();
    return {
      success: true,
      records: data.records || [],
      total: data.total || 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Dashboard records network failure', { url, error: err }, 'CM_DASHBOARD_CLIENT');
    return {
      success: false,
      error: `Network error: ${msg}`,
    };
  }
}
