import { render, waitFor, act } from '@testing-library/react';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import type { UserRole } from '@/lib/types';

// The store's network boundary. Each test answers only the requests it is about.
const mockFetch = jest.fn();
global.fetch = mockFetch;

function respond(status: number, body: unknown, headers?: { get: (name: string) => string | null }) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    json: async () => body,
  });
}

function serveDefaults(url: string) {
  if (url === '/api/bootstrap') {
    return respond(200, {
      success: true,
      data: { buyerAccounts: [], vendors: [], evaluations: [], auditLogs: [], aiFeed: [], systemConfig: {} },
    });
  }
  if (/\/api\/rfqs(\?|$)/.test(url)) return respond(200, { success: true, data: [] });
  if (url === '/api/buyer-accounts/active') {
    return respond(404, { success: false, error: 'No buyer account is linked to this session.' });
  }
  return respond(200, { success: true, data: {} });
}

type StoreValue = ReturnType<typeof useApp>;

/** Mounts the store signed in as `role` and returns an accessor for its latest value. */
async function mountAs(role: UserRole): Promise<() => StoreValue> {
  authClient.setSession({
    id: `usr-${role}-session`,
    email: `${role}@procucev.com`,
    name: 'Session Tester',
    role,
    orgId: 'org-session-1',
    orgName: 'Session Org',
  }, `${role}-session-token`);
  let latest: StoreValue | null = null;
  const Consumer = () => {
    latest = useApp();
    return <div data-testid="ready">ready</div>;
  };
  render(
    <AppProvider>
      <Consumer />
    </AppProvider>
  );
  await waitFor(() => expect(latest?.isLoadingDB).toBe(false));
  return () => {
    if (!latest) throw new Error('The store has not mounted.');
    return latest;
  };
}

describe('lib/store.tsx - AI feed by role and RFQ load when the session ends', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => serveDefaults(url));
    logger.clearLogs();
    logger.isRemoteSyncEnabled = false;
  });

  afterEach(() => {
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  test('a vendor session does not request the AI feed, which is not offered to vendors', async () => {
    const app = await mountAs('buyer');
    await act(async () => {
      app().setCurrentRole('vendor');
    });
    mockFetch.mockClear();

    await act(async () => {
      await app().refreshAIFeed();
    });

    const requested = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.startsWith('/api/ai-feed'))).toBe(false);
    expect(app().aiFeed).toEqual([]);
    expect(app().aiFeedError).toBeNull();
  });

  test('a buyer session requests the AI feed, and a failed response is logged with the server request id', async () => {
    const app = await mountAs('buyer');
    const logSpy = jest.spyOn(logger, 'log');
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/ai-feed')) {
        return respond(500, { success: false, error: 'Feed failed.' }, {
          get: (name: string) => (name.toLowerCase() === 'x-request-id' ? 'req-feed-7' : null),
        });
      }
      return serveDefaults(url);
    });

    await act(async () => {
      await app().refreshAIFeed();
    });

    expect(logSpy).toHaveBeenCalledWith(
      'ERROR',
      'AI feed request failed',
      expect.objectContaining({ requestId: 'req-feed-7', status: 500, responseError: 'Feed failed.' }),
      'AI_FEED'
    );
    expect(app().aiFeedError).toBe('Feed failed.');
  });

  test('a failed response without a request id header is logged without one', async () => {
    const app = await mountAs('buyer');
    const logSpy = jest.spyOn(logger, 'log');
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/ai-feed')) return respond(503, { success: false, error: 'Busy.' });
      return serveDefaults(url);
    });

    await act(async () => {
      await app().refreshAIFeed();
    });

    const [, , metadata] = logSpy.mock.calls.find(([, message]) => message === 'AI feed request failed') ?? [];
    expect(metadata).toBeDefined();
    expect(metadata).not.toHaveProperty('requestId');
  });

  test('an admin RFQ list refused because the session ended is not retried and is logged as a warning', async () => {
    const app = await mountAs('admin');
    const logSpy = jest.spyOn(logger, 'log');
    mockFetch.mockClear();
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/rfqs/all')) {
        return respond(401, { success: false, error: 'Session has been logged out.' });
      }
      return serveDefaults(url);
    });

    await act(async () => {
      await app().refreshRFQs();
    });

    const requested = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requested.filter((url) => url.startsWith('/api/rfqs/all')).length).toBeGreaterThan(0);
    // The retry would have sent the list request again, with no token left to send.
    expect(requested.filter((url) => /^\/api\/rfqs(\?|$)/.test(url))).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith('WARN', 'RFQ list not loaded because the session ended', { reason: 'UNAUTHORIZED' }, 'RFQ_STORE');
    expect(logSpy).not.toHaveBeenCalledWith('ERROR', 'Failed to load RFQs', expect.anything(), 'RFQ_STORE');
    expect(app().rfqs).toEqual([]);
  });
});
