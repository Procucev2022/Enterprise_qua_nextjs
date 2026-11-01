import { authClient } from './authClient';
import { logger } from './logger';
import type {
  ActionCenterCommunicationPayload,
  ActionCenterCommunicationRecord,
  ActionCenterCommunicationResult,
} from './types';

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Dispatch an Action Center notification across SMS, Email, or Both.
 */
export async function dispatchActionCenterCommunication(
  payload: ActionCenterCommunicationPayload
): Promise<ActionCenterCommunicationResult> {
  try {
    const res = await fetch('/api/action-center/communications', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      logger.warn(
        'Action Center communication dispatch failed at API boundary',
        { status: res.status, error: json.error },
        'ACTION_CENTER_COMM_CLIENT'
      );
      return {
        success: false,
        error: json.error || `HTTP ${res.status}: Failed to dispatch communication`,
      };
    }

    logger.info(
      'Action Center communication dispatched successfully',
      { entityType: payload.entityType, entityId: payload.entityId, channel: payload.channel },
      'ACTION_CENTER_COMM_CLIENT'
    );

    return {
      success: json.success !== false,
      message: json.message,
      communication: json.communication,
      emailResult: json.emailResult,
      smsResult: json.smsResult,
      completedTask: json.completedTask,
      followupTask: json.followupTask,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.error(
      'Error calling /api/action-center/communications',
      { error: message },
      'ACTION_CENTER_COMM_CLIENT'
    );
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Fetch communication logs for Action Center entities with pagination.
 */
export async function fetchActionCenterCommunications(params?: {
  entityType?: string;
  entityId?: string;
  channel?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: ActionCenterCommunicationRecord[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}> {
  try {
    const q = new URLSearchParams();
    if (params?.entityType) q.append('entityType', params.entityType);
    if (params?.entityId) q.append('entityId', params.entityId);
    if (params?.channel) q.append('channel', params.channel);
    if (params?.page) q.append('page', String(params.page));
    if (params?.pageSize) q.append('pageSize', String(params.pageSize));

    const res = await fetch(`/api/action-center/communications?${q.toString()}`, {
      headers: authHeaders(),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      items: json.items || [],
      pagination: json.pagination || {
        total: json.items?.length || 0,
        page: params?.page || 1,
        pageSize: params?.pageSize || 20,
        totalPages: 1,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.error(
      'Failed to fetch action center communications',
      { error: message },
      'ACTION_CENTER_COMM_CLIENT'
    );
    return {
      items: [],
      pagination: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    };
  }
}

