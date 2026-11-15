import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { AppProvider, useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import { STORE_MESSAGES } from '@/lib/constants';

// The store's network boundary. Every request is answered here, so each test controls only the
// response it is about. Anything not listed gets an empty successful envelope.
const mockFetch = jest.fn();
global.fetch = mockFetch;

const SESSION = {
  id: 'usr-branch-1',
  email: 'buyer@procucev.com',
  name: 'Branch Buyer',
  role: 'buyer' as const,
  orgId: 'org-branch-1',
  orgName: 'Branch Org',
};

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
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

async function mountStore(withSession = true): Promise<() => StoreValue> {
  if (withSession) {
    authClient.setSession(SESSION, 'test-session-token');
  } else {
    authClient.setSession(null, null);
  }
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

describe('lib/store.tsx - remaining failure branches', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => serveDefaults(url));
    logger.clearLogs();
    logger.isRemoteSyncEnabled = false;
  });

  afterEach(() => {
    authClient.setSession(null, null);
  });

  test('addBuyerAccount shows the server reason and adds nothing when the server refuses the account', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/buyer-accounts' && init?.method === 'POST') {
        return respond(400, { success: false, error: 'Corporate email is already registered.' });
      }
      return serveDefaults(url);
    });

    let created: unknown = 'unset';
    await act(async () => {
      const refusedAccount = {
        organizationName: 'Refused Corp',
        corporateEmail: 'refused@procucev.com',
        industrySector: 'Testing',
        contactPerson: 'Tester',
        mobileNumber: '+91 98201 00000',
        gstin: '27AAACR0000A1Z5',
        primaryPlantLocation: 'Pune',
        supportedMajorCategories: [],
        status: 'PENDING_ONBOARDING',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
        accountSource: 'web_registration',
      } as unknown as Parameters<StoreValue['addBuyerAccount']>[0];
      created = await app().addBuyerAccount(refusedAccount);
    });

    expect(created).toBeNull();
    expect(app().toastMessage?.title).toBe(STORE_MESSAGES.buyerAccountCreateFailedTitle);
    expect(app().toastMessage?.description).toBe('Corporate email is already registered.');
    expect(app().buyerAccounts.some((a) => a.organizationName === 'Refused Corp')).toBe(false);
  });

  test('alignActiveBuyerAccount reports an unreachable server and keeps the active account', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/buyer-accounts/buyer-x/activate' && init?.method === 'POST') {
        return Promise.reject(new Error('connection reset'));
      }
      return serveDefaults(url);
    });

    let switched = true;
    await act(async () => {
      switched = await app().alignActiveBuyerAccount('buyer-x');
    });

    expect(switched).toBe(false);
    expect(app().toastMessage?.title).toBe(STORE_MESSAGES.alignFailedTitle);
    expect(app().toastMessage?.description).toBe(STORE_MESSAGES.alignUnreachable);
  });

  test('refreshActiveBuyerAccount logs a missing link as a warning and leaves no active account', async () => {
    const app = await mountStore();

    expect(app().activeBuyerAccount).toBeNull();
    expect(logger.getLogs({ level: 'WARN', category: 'BUYER_ACCOUNT' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Active buyer account is not linked to this session' }),
      ])
    );
  });

  test('triggerBatchChannelChaser reports an unreachable server and does not count a send', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/rfqs/RFQ-BR-1/batch-chaser' && init?.method === 'POST') {
        return Promise.reject(new Error('socket hang up'));
      }
      return serveDefaults(url);
    });

    let sent = true;
    await act(async () => {
      sent = await app().triggerBatchChannelChaser('RFQ-BR-1', ['call', 'sms']);
    });

    expect(sent).toBe(false);
    expect(app().toastMessage?.title).toBe(STORE_MESSAGES.chaserNotSentTitle);
    expect(app().toastMessage?.description).toBe(STORE_MESSAGES.chaserUnreachable);
  });

  test('triggerBatchChannelChaser stays silent on an unreachable server when the caller suppresses the toast', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/rfqs/RFQ-BR-4/batch-chaser' && init?.method === 'POST') {
        return Promise.reject(new Error('socket hang up'));
      }
      return serveDefaults(url);
    });

    let sent = true;
    await act(async () => {
      sent = await app().triggerBatchChannelChaser('RFQ-BR-4', ['sms'], true);
    });

    expect(sent).toBe(false);
    expect(app().toastMessage).toBeNull();
  });

  test('triggerBatchChannelChaser stays silent when the caller suppresses the toast and the batch is refused', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/rfqs/RFQ-BR-5/batch-chaser' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Unavailable',
          json: async () => ({ success: false, error: 'Chaser provider is down' }),
        });
      }
      return serveDefaults(url);
    });

    let sent = true;
    await act(async () => {
      sent = await app().triggerBatchChannelChaser('RFQ-BR-5', ['sms'], true);
    });

    expect(sent).toBe(false);
    expect(app().toastMessage).toBeNull();
  });

  test('triggerBatchChannelChaser shows the server reason when the batch is refused', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/rfqs/RFQ-BR-2/batch-chaser' && init?.method === 'POST') {
        return respond(503, { success: false, error: 'Voice provider is offline.' });
      }
      return serveDefaults(url);
    });

    let sent = true;
    await act(async () => {
      sent = await app().triggerBatchChannelChaser('RFQ-BR-2', ['call']);
    });

    expect(sent).toBe(false);
    expect(app().toastMessage?.description).toBe('Voice provider is offline.');
  });

  test('addAuditLog writes the event to the frontend log and sends nothing to the server when there is no signed-in session', async () => {
    const app = await mountStore();
    authClient.setSession(null, null);
    mockFetch.mockClear();

    await act(async () => {
      await app().addAuditLog('Action without a session');
    });

    expect(mockFetch.mock.calls.some(([url]) => url === '/api/audit')).toBe(false);
    expect(logger.getLogs({ level: 'INFO', category: 'AUDIT_TRAIL' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Action without a session' })])
    );
  });

  test('updateVendorSubscription finds the signed-in vendor on the server and then saves the plan', async () => {
    const app = await mountStore();
    const encodedEmail = encodeURIComponent(SESSION.email);
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === `/api/vendors/${encodedEmail}`) {
        return respond(200, { success: true, data: { id: 'v-branch-9', email: SESSION.email } });
      }
      if (url === '/api/vendors/v-branch-9/subscription' && init?.method === 'PUT') {
        return respond(200, { success: true, data: { subscriptionPlan: 'connect', rfqDownloadsUsed: 3 } });
      }
      return serveDefaults(url);
    });

    let saved = false;
    await act(async () => {
      saved = await app().updateVendorSubscription('connect');
    });

    expect(saved).toBe(true);
    expect(app().vendorSubscription).toBe('connect');
    expect(app().vendorRfqDownloadsUsed).toBe(3);
  });

  test('triggerBatchChannelChaser confirms how many vendors the provider accepted', async () => {
    const app = await mountStore();
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/rfqs/RFQ-BR-3/batch-chaser' && init?.method === 'POST') {
        return respond(200, {
          success: true,
          sentCount: 2,
          results: [{ success: true }, { success: true }, { success: false }],
        });
      }
      return serveDefaults(url);
    });

    let sent = false;
    await act(async () => {
      sent = await app().triggerBatchChannelChaser('RFQ-BR-3', ['whatsapp']);
    });

    expect(sent).toBe(true);
    expect(app().toastMessage?.title).toBe(STORE_MESSAGES.chaserSentTitle);
  });

  test('an email preview opens once a recipient is resolved', async () => {
    const app = await mountStore();
    const rfq = {
      id: 'rfq-preview-1',
      rfqNumber: 'RFQ-PREVIEW-1',
      title: 'Preview RFQ',
      category: 'Mechanical',
      sourcingMode: 'mode_1',
      status: 'Quotes Pending',
      budget: 0,
      createdAt: '2026-09-01',
      targetDeliveryDate: '2026-09-30',
      quotesCount: 0,
      quotes: [],
      extractedEntities: [],
    } as unknown as Parameters<StoreValue['openStandardEmailModal']>[0];
    const vendor = {
      id: 'v-preview-1',
      name: 'Preview Vendor',
      email: 'preview@vendor.example',
      majorCategory: 'Mechanical',
      minorCategories: ['Pumps'],
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    } as unknown as Parameters<StoreValue['openStandardEmailModal']>[1];

    await act(async () => {
      app().openStandardEmailModal(rfq, vendor);
    });

    expect(app().emailModalOpen).toBe(true);
    expect(app().selectedEmailForModal?.recipientEmail).toBe('preview@vendor.example');
  });

  test('unlockRFQForVendor reloads the vendor download count from the vendor record', async () => {
    const app = await mountStore();
    const encodedEmail = encodeURIComponent(SESSION.email);
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === `/api/vendors/${encodedEmail}`) {
        return respond(200, { success: true, data: { id: 'v-unlock-1', email: SESSION.email } });
      }
      if (url === '/api/vendors/v-unlock-1') {
        return respond(200, { success: true, data: { id: 'v-unlock-1', rfqDownloadsUsed: 4 } });
      }
      if (url === '/api/rfqs/RFQ-UNLOCK-1/download' && init?.method === 'POST') {
        return respond(200, { success: true, unlocked: true, freeCreditsRemaining: 1, data: {} });
      }
      return serveDefaults(url);
    });

    let outcome: { success: boolean } = { success: false };
    await act(async () => {
      outcome = await app().unlockRFQForVendor('RFQ-UNLOCK-1');
    });

    expect(outcome.success).toBe(true);
    await waitFor(() => expect(app().vendorRfqDownloadsUsed).toBe(4));
    expect(app().vendorFreeCreditsRemaining).toBe(1);
  });

  test('unlockRFQForVendor logs a failed download-count reload and keeps the unlock result', async () => {
    const app = await mountStore();
    const encodedEmail = encodeURIComponent(SESSION.email);
    mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === `/api/vendors/${encodedEmail}`) {
        return respond(200, { success: true, data: { id: 'v-unlock-2', email: SESSION.email } });
      }
      if (url === '/api/vendors/v-unlock-2') {
        return Promise.reject(new Error('vendor record unreachable'));
      }
      if (url === '/api/rfqs/RFQ-UNLOCK-2/download' && init?.method === 'POST') {
        return respond(200, { success: true, unlocked: true, data: {} });
      }
      return serveDefaults(url);
    });

    let outcome: { success: boolean } = { success: false };
    await act(async () => {
      outcome = await app().unlockRFQForVendor('RFQ-UNLOCK-2');
    });

    expect(outcome.success).toBe(true);
    await waitFor(() =>
      expect(logger.getLogs({ level: 'WARN', category: 'VENDOR_CREDITS' })).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: 'Failed to refresh vendor RFQ download count' })])
      )
    );
  });

  test('refreshRFQs clears the list when no session exists outside the test runner', async () => {
    const app = await mountStore(false);
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      await act(async () => {
        await app().refreshRFQs();
      });
      expect(app().rfqs).toEqual([]);
      expect(app().isLoadingRFQs).toBe(false);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    }
  });

  test('an expired session on the RFQ list signs the buyer out and clears the RFQ list', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (/\/api\/rfqs(\?|$)/.test(url)) {
        return respond(401, { success: false, error: 'Session has been logged out.' });
      }
      return serveDefaults(url);
    });
    const app = await mountStore();

    await waitFor(() => expect(app().currentUserSession).toBeNull());
    expect(app().rfqs).toEqual([]);
    expect(authClient.getToken()).toBeNull();
  });

  test('updateVendorSubscription reports a failed vendor lookup instead of guessing a vendor', async () => {
    const app = await mountStore();
    const encodedEmail = encodeURIComponent(SESSION.email);
    mockFetch.mockImplementation((url: string) => {
      if (url === `/api/vendors/${encodedEmail}`) {
        return Promise.reject(new Error('lookup offline'));
      }
      return serveDefaults(url);
    });

    let saved = true;
    await act(async () => {
      saved = await app().updateVendorSubscription('select');
    });

    expect(saved).toBe(false);
    expect(app().toastMessage?.title).toBe('Subscription Update Failed');
    expect(app().toastMessage?.description).toBe('Could not find your vendor profile.');
  });
});
