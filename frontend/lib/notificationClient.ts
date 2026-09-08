import { authClient } from './authClient';
import { UI_STRINGS } from './uiStrings';
import type { AppNotification } from './types';

export interface NotificationListResult {
  success: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  error?: string;
}

const EMPTY: NotificationListResult = { success: true, notifications: [], unreadCount: 0 };

function authHeaders(): Record<string, string> {
  const token = authClient.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The signed-in recipient's notifications, newest first, plus the unread count.
 *
 * Signed out, there is nothing to fetch — resolves to an empty list rather than
 * calling the API without a session. A transport or server failure also resolves
 * to an empty list with `success: false`, so the bell can quietly keep whatever
 * it last showed instead of flashing an error.
 */
export async function fetchNotifications(): Promise<NotificationListResult> {
  if (!authClient.getToken()) return EMPTY;

  let res: Response;
  try {
    res = await fetch('/api/notifications', { headers: authHeaders() });
  } catch {
    return { ...EMPTY, success: false, error: UI_STRINGS.auth.networkUnreachable };
  }

  let body: { success?: boolean; data?: AppNotification[]; unreadCount?: number; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    return { ...EMPTY, success: false, error: UI_STRINGS.notifications.loadFailed };
  }

  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    return { ...EMPTY, success: false, error: body.error || UI_STRINGS.notifications.loadFailed };
  }

  return {
    success: true,
    notifications: body.data,
    unreadCount: typeof body.unreadCount === 'number' ? body.unreadCount : body.data.filter((n) => !n.read).length,
  };
}

/** Mark one notification read. Returns whether the server accepted it. */
export async function markNotificationRead(id: string): Promise<boolean> {
  if (!authClient.getToken()) return false;
  try {
    const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Mark every unread notification read. Returns whether the server accepted it. */
export async function markAllNotificationsRead(): Promise<boolean> {
  if (!authClient.getToken()) return false;
  try {
    const res = await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
