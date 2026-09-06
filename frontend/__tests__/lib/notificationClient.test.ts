import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/notificationClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

const originalFetch = global.fetch;

const reply = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

const unreadable = (status: number) =>
  jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json');
    },
  });

const signIn = () =>
  authClient.setSession(
    { id: 'u1', email: 'v@x.com', name: 'V', role: 'vendor', orgId: 'o1', orgName: 'O' },
    'jwt-token'
  );

const lastInit = () => (global.fetch as jest.Mock).mock.calls[0][1];
const lastPath = () => (global.fetch as jest.Mock).mock.calls[0][0];

// jest.setup primes a test session token in localStorage, so the singleton
// authClient starts signed in. Each test decides its own auth state.
beforeEach(() => {
  authClient.setSession(null, null);
});

afterEach(() => {
  global.fetch = originalFetch;
  authClient.setSession(null, null);
  jest.restoreAllMocks();
});

describe('fetchNotifications', () => {
  it('resolves to an empty list without calling the API when signed out', async () => {
    global.fetch = jest.fn();
    const res = await fetchNotifications();
    expect(res).toEqual({ success: true, notifications: [], unreadCount: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reads the recipient-scoped list with the session token attached', async () => {
    signIn();
    const notifications = [{ id: 'n1', read: false }, { id: 'n2', read: true }];
    global.fetch = reply(200, { success: true, data: notifications, unreadCount: 1 });

    const res = await fetchNotifications();

    expect(res).toEqual({ success: true, notifications, unreadCount: 1 });
    expect(lastPath()).toBe('/api/notifications');
    expect(lastInit().headers).toEqual({ Authorization: 'Bearer jwt-token' });
  });

  it('derives the unread count when the server omits it', async () => {
    signIn();
    global.fetch = reply(200, { success: true, data: [{ id: 'n1', read: false }, { id: 'n2', read: false }] });

    const res = await fetchNotifications();

    expect(res.unreadCount).toBe(2);
  });

  it('reports an unreachable API as a soft failure', async () => {
    signIn();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    const res = await fetchNotifications();

    expect(res).toEqual({
      success: false,
      notifications: [],
      unreadCount: 0,
      error: UI_STRINGS.auth.networkUnreachable,
    });
  });

  it('reports an unreadable body as a soft failure', async () => {
    signIn();
    global.fetch = unreadable(500);

    const res = await fetchNotifications();

    expect(res.success).toBe(false);
    expect(res.error).toBe(UI_STRINGS.notifications.loadFailed);
  });

  it('rejects a non-array payload', async () => {
    signIn();
    global.fetch = reply(200, { success: true, data: { id: 'n1' } });

    const res = await fetchNotifications();

    expect(res.success).toBe(false);
    expect(res.notifications).toEqual([]);
  });

  it('surfaces the server error message on a non-ok response', async () => {
    signIn();
    global.fetch = reply(500, { success: false, error: 'Boom.' });

    const res = await fetchNotifications();

    expect(res).toMatchObject({ success: false, error: 'Boom.' });
  });
});

describe('markNotificationRead', () => {
  it('returns false without calling the API when signed out', async () => {
    global.fetch = jest.fn();
    expect(await markNotificationRead('n1')).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('PATCHes the id and returns true on a 200', async () => {
    signIn();
    global.fetch = reply(200, { success: true });

    expect(await markNotificationRead('n 1')).toBe(true);
    expect(lastPath()).toBe('/api/notifications/n%201/read');
    expect(lastInit().method).toBe('PATCH');
  });

  it('returns false on a non-ok response', async () => {
    signIn();
    global.fetch = reply(404, { success: false });
    expect(await markNotificationRead('n1')).toBe(false);
  });

  it('returns false when the request throws', async () => {
    signIn();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await markNotificationRead('n1')).toBe(false);
  });
});

describe('markAllNotificationsRead', () => {
  it('returns false without calling the API when signed out', async () => {
    global.fetch = jest.fn();
    expect(await markAllNotificationsRead()).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to the read-all route and returns true on a 200', async () => {
    signIn();
    global.fetch = reply(200, { success: true, updated: 3 });

    expect(await markAllNotificationsRead()).toBe(true);
    expect(lastPath()).toBe('/api/notifications/read-all');
    expect(lastInit().method).toBe('POST');
  });

  it('returns false on a non-ok response', async () => {
    signIn();
    global.fetch = reply(500, {});
    expect(await markAllNotificationsRead()).toBe(false);
  });

  it('returns false when the request throws', async () => {
    signIn();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await markAllNotificationsRead()).toBe(false);
  });
});
