import type { VendorPresenceResponse } from './types';
import { authClient } from './authClient';
import { logger } from './logger';
import { UI_STRINGS, formatString } from './uiStrings';

const VENDOR_PRESENCE_LOG_CATEGORY = 'VENDOR_PRESENCE_CLIENT';

/**
 * Presence response plus an error. When `error` is set, `onlineVendors` is empty only
 * because the status is unknown. Callers must not read it as "all vendors offline".
 */
export type VendorPresenceResult = VendorPresenceResponse & { error?: string };

/**
 * Fetches the real-time online/offline presence for given vendors, or all active vendors.
 */
export async function getVendorPresence(identifiers?: string[]): Promise<VendorPresenceResult> {
  const resource = UI_STRINGS.dataLoad.resources.vendorPresence;
  try {
    const token = authClient.getToken();
    const query =
      Array.isArray(identifiers) && identifiers.length > 0
        ? `?identifiers=${encodeURIComponent(identifiers.join(','))}`
        : '';

    const res = await fetch(`/api/vendors/presence${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const error = formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource, status: res.status });
      logger.warn('Vendor presence request rejected', { status: res.status }, VENDOR_PRESENCE_LOG_CATEGORY);
      return { success: false, onlineVendors: [], details: {}, error };
    }

    const data: VendorPresenceResponse = await res.json();
    return data;
  } catch (err: unknown) {
    logger.warn('Vendor presence request failed', { error: err }, VENDOR_PRESENCE_LOG_CATEGORY);
    return {
      success: false,
      onlineVendors: [],
      details: {},
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource }),
    };
  }
}

/**
 * Sends a vendor presence heartbeat to the server.
 */
export async function sendVendorHeartbeat(data?: {
  identifier?: string;
  status?: 'online' | 'offline';
}): Promise<{ success: boolean; identifier?: string; isOnline?: boolean; error?: string }> {
  try {
    const token = authClient.getToken();

    const res = await fetch('/api/vendors/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data || {}),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    return { ...json, success: json?.success === true };
  } catch (err: unknown) {
    logger.warn('Failed to send vendor heartbeat', { error: err }, VENDOR_PRESENCE_LOG_CATEGORY);
    return {
      success: false,
      error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.vendorPresence }),
    };
  }
}
