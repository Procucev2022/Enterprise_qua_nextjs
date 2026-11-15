import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';
import type {
  ActionCenterCommunicationPayload,
  ActionCenterCommunicationRecord,
  ActionCenterCommunicationResult,
} from './types';

const ACTION_CENTER_COMM_LOG_CATEGORY = 'ACTION_CENTER_COMM_CLIENT';
const RESOURCES = UI_STRINGS.dataLoad.resources;

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** The delivery state the API reports for a send, taken from the response only. */
function reportedStatus(json: { status?: unknown; communication?: { deliveryStatus?: unknown } }): string | undefined {
  if (typeof json.status === 'string') return json.status;
  const deliveryStatus = json.communication?.deliveryStatus;
  return typeof deliveryStatus === 'string' ? deliveryStatus : undefined;
}

/**
 * Dispatch an Action Center notification across SMS, Email, or Both.
 *
 * `success` is true only when the API reports success. A reply without that flag, or a
 * non-2xx reply, is a failure. `status` is the delivery state the API reported.
 */
export async function dispatchActionCenterCommunication(
  payload: ActionCenterCommunicationPayload
): Promise<ActionCenterCommunicationResult & { status?: string }> {
  try {
    const res = await fetch('/api/action-center/communications', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok || json.success !== true) {
      logger.warn(
        'Action Center communication dispatch failed at API boundary',
        { status: res.status, error: json.error },
        ACTION_CENTER_COMM_LOG_CATEGORY
      );
      return {
        success: false,
        status: reportedStatus(json) ?? 'failed',
        error: json.error || formatString(UI_STRINGS.dataLoad.requestFailedWithStatus, { status: res.status }),
      };
    }

    logger.info(
      'Action Center communication dispatched successfully',
      { entityType: payload.entityType, entityId: payload.entityId, channel: payload.channel },
      ACTION_CENTER_COMM_LOG_CATEGORY
    );

    return {
      success: true,
      status: reportedStatus(json),
      queued: json.queued === true,
      message: json.message,
      communication: json.communication,
      emailResult: json.emailResult,
      smsResult: json.smsResult,
      completedTask: json.completedTask,
      followupTask: json.followupTask,
      followupError: json.followupError,
    };
  } catch (err: unknown) {
    logger.error(
      'Error calling /api/action-center/communications',
      { error: err instanceof Error ? err.message : 'Network error' },
      ACTION_CENTER_COMM_LOG_CATEGORY
    );
    return {
      success: false,
      status: 'failed',
      error: UI_STRINGS.dataLoad.requestNetworkFailed,
    };
  }
}

/**
 * Fetch communication logs for Action Center entities with pagination.
 * On failure `items` is empty and `error` says why.
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
  error?: string;
}> {
  const resource = RESOURCES.actionCenterCommunications;
  const emptyPagination = { total: 0, page: params?.page || 1, pageSize: params?.pageSize || 20, totalPages: 1 };
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

    if (!res.ok) {
      return {
        items: [],
        pagination: emptyPagination,
        error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status }),
      };
    }
    const json = await res.json();
    if (!Array.isArray(json?.items)) {
      return {
        items: [],
        pagination: emptyPagination,
        error: formatString(UI_STRINGS.dataLoad.unexpectedResponse, { resource }),
      };
    }
    return {
      items: json.items,
      pagination: json.pagination || {
        total: json.items.length,
        page: params?.page || 1,
        pageSize: params?.pageSize || 20,
        totalPages: 1,
      },
    };
  } catch (err: unknown) {
    logger.error(
      'Failed to fetch action center communications',
      { error: err instanceof Error ? err.message : 'Network error' },
      ACTION_CENTER_COMM_LOG_CATEGORY
    );
    return {
      items: [],
      pagination: emptyPagination,
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }),
    };
  }
}
