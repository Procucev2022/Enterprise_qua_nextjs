import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { AppProvider, useApp } from '@/lib/store';
import { RFQItem, VendorEntry, BuyerAccount, VendorEvaluationRecord, ExtractedEntity } from '@/lib/types';
import type { UserSession } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';
import { STORE_MESSAGES } from '@/lib/constants';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';

// Mock global fetch for API calls triggered by store
const mockFetch = jest.fn();
global.fetch = mockFetch;
const originalLoggerRemoteSyncEnabled = logger.isRemoteSyncEnabled;

afterAll(() => {
  logger.isRemoteSyncEnabled = originalLoggerRemoteSyncEnabled;
  logger.clearLogs();
});

// RFQs are served from the authenticated GET /api/rfqs, which returns a bare
// array, while /api/bootstrap returns the reference-data object. The mock has to
// distinguish them or the store reads the wrong shape and reports no RFQs.
const STORE_RFQ_FIXTURES = [
  {
    id: 'rfq-1',
    title: 'Centrifugal Slurry Pumps',
    category: 'Mechanical',
    createdAt: '2026-08-29',
    targetDeliveryDate: '2026-09-20',
    status: 'Quotes Pending',
    sourcingMode: 'mode_1',
    quotesCount: 2,
    budget: 500000,
    extractedEntities: [
      {
        id: 'ent-1',
        itemName: 'Centrifugal Pump 50HP',
        quantity: 4,
        unit: 'units',
        targetDate: '2026-09-20',
        technicalSpecs: '50HP 1450RPM',
        confidence: 95,
        category: 'Centrifugal Pumps',
      },
    ],
    quotes: [
      {
        id: 'q-1',
        vendorId: 'v-001',
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        unitPrice: 37500,
        totalPrice: 150000,
        leadTimeDays: 14,
        complianceScore: 96,
        status: 'Under Review',
        submittedAt: '2026-08-29',
        deviationNotes: 'Exact spec match',
      },
    ],
    chasingActive: true,
    followUpData: {
      totalTargetVendors: 3,
      respondedVendors: 1,
      pendingVendors: 2,
      nextScheduledChaser: 'Today 04:00 PM',
      channelStats: { whatsappDelivered: 3, whatsappRead: 2, callsConnected: 2, smsSent: 3 },
      callStats: { connected: 2, total: 3, avgDuration: '1m 30s' },
      whatsappStats: { read: 2, total: 3, responseRate: '66%' },
      smsStats: { delivered: 3, total: 3 },
      emailStats: { opened: 2, total: 3 },
      vendors: [
        {
          vendorId: 'v-001',
          vendorName: 'Apex Supplies Ltd.',
          phone: '+91 98201 44820',
          contactPerson: 'Rajesh Nair',
          call: { status: 'completed', lastAttempt: '2h ago' },
          whatsapp: { status: 'read', lastAttempt: '1h ago' },
          sms: { status: 'delivered', lastAttempt: '3h ago' },
          email24h: { is24hReminderSent: true },
          overallStatus: 'Pending',
          lastInteraction: '1h ago',
          attemptsCount: 3,
          bidStatus: 'Pending',
        },
        {
          vendorId: 'v-002',
          vendorName: 'Global Valve Systems Ltd',
          phone: '+91 98201 44777',
          contactPerson: 'Karan Mehra',
          call: { status: 'pending', lastAttempt: 'never' },
          whatsapp: { status: 'pending', lastAttempt: 'never' },
          sms: { status: 'pending', lastAttempt: 'never' },
          email24h: { is24hReminderSent: false },
          overallStatus: 'Pending',
          lastInteraction: 'never',
          attemptsCount: 0,
          bidStatus: 'Pending',
        },
      ],
    },
  },
];

describe('lib/store.tsx - AppProvider and useApp', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    logger.isRemoteSyncEnabled = false;
    logger.clearLogs();
    // RFQs come from GET /api/rfqs as a bare array; /api/bootstrap returns the
    // reference-data object. Distinguished here or the store reads the wrong shape.
    const bootstrapPayload = {
      success: true,
      data: {
        buyerAccounts: [
          {
            id: 'buyer-acc-1',
            organizationName: 'Larsen & Toubro Limited',
            industry: 'Engineering & Construction',
            corporateEmail: 'buyer@procucev.com',
            contactPerson: 'Vikram Malhotra',
            phone: '+91 98201 44820',
            sourcingMode: 'mode_1',
            subscriptionPlan: 'version_1',
            remainingFreeRFQs: 5,
            totalRFQsCreated: 2,
            totalSpend: '$450,000',
            accountSource: 'direct_enterprise_signup',
            syncTimestamp: '2026-08-29 10:00 UTC',
            createdDate: '2026-08-29',
          },
          {
            id: 'buyer-acc-2',
            organizationName: 'Siemens Energy Ltd',
            industry: 'Power',
            corporateEmail: 'siemens@procucev.com',
            contactPerson: 'Ravi Verma',
            phone: '+91 98201 55667',
            sourcingMode: 'mode_2',
            subscriptionPlan: 'version_2',
            remainingFreeRFQs: 10,
            accountSource: 'direct_enterprise_signup',
          },
        ],
        vendors: [
          {
            id: 'v-001',
            name: 'Apex Industrial Dynamics Pvt Ltd',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apexindustrial.in',
            phone: '+91 98201 44820',
            majorCategory: 'Engineering Spares - Mechanical',
            minorCategories: ['Centrifugal Pumps', 'Slurry Pumps'],
            clientMappedCategories: ['Centrifugal Pumps'],
            vendorSelectedCategories: ['Centrifugal Pumps'],
            location: 'Pune, Maharashtra',
            rating: 4.8,
            source: 'buyer_manual',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            score: 94,
            evaluated: true,
            hasRecord: true,
          },
          {
            id: 'v-002',
            name: 'Global Valve Systems Ltd',
            contactPerson: 'Karan Mehra',
            email: 'karan@globalvalves.in',
            phone: '+91 98201 44777',
            majorCategory: 'Engineering Spares - Mechanical',
            minorCategories: ['Slurry Valves'],
            clientMappedCategories: ['Slurry Valves'],
            vendorSelectedCategories: [],
            location: 'Delhi',
            rating: 4.3,
            source: 'platform_database',
            status: 'REGISTERED / NOT EVALUATED',
            score: 76,
            evaluated: false,
            hasRecord: false,
          },
          {
            id: 'v-003',
            name: 'Mumbai Tech Dynamics',
            contactPerson: 'Sanjay Deshmukh',
            email: 'sanjay@mumbaitech.in',
            phone: '+91 98201 44666',
            majorCategory: 'Electrical',
            minorCategories: ['Switchgears'],
            location: 'Mumbai',
            rating: 0,
            source: 'buyer_manual',
            status: 'REGISTERED / NOT EVALUATED',
            evaluated: false,
          },
          {
            id: 'v-004',
            name: 'MH Spares Ltd',
            contactPerson: 'Nitin Patel',
            email: 'nitin@mhspares.in',
            phone: '+91 98201 44555',
            majorCategory: 'Engineering Spares - Mechanical',
            minorCategories: ['Custom Spares'],
            location: 'MH Hub',
            rating: 4.2,
            source: 'buyer_excel',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            evaluated: true,
          },
        ],
        evaluations: [
          {
            id: 'eval-1',
            vendorId: 'v-001',
            vendorName: 'Apex Industrial Dynamics Pvt Ltd',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apexindustrial.in',
            phone: '+91 98201 44820',
            category: 'Engineering Spares - Mechanical',
            submissionDate: '2026-08-29',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            overallScore: 92.4,
            systemAction: 'Auto-Promoted to Preferred Tier',
            moduleScores: {
              commercial: { score: 92, weightedScore: 23.0, maxScore: 25, weight: 25, remarks: 'Fair price' },
              technical: { score: 90, weightedScore: 13.5, maxScore: 15, weight: 15, remarks: 'High tech' },
              quality: { score: 94, weightedScore: 18.8, maxScore: 20, weight: 20, remarks: 'High quality' },
              delivery: { score: 93, weightedScore: 18.6, maxScore: 20, weight: 20, remarks: 'Fast delivery' },
              financial: { score: 80, weightedScore: 8.0, maxScore: 10, weight: 10, remarks: 'Solid finances' },
              governance: { score: 94, weightedScore: 9.4, maxScore: 10, weight: 10, remarks: 'Compliant' },
            },
            documents: [
              { id: 'doc-1', name: 'ISO 9001.pdf', type: 'Quality', uploadDate: '2026-08-29', verified: true, status: 'Verified' },
            ],
          },
          {
            id: 'eval-2',
            vendorId: 'v-002',
            vendorName: 'Global Valve Systems Ltd',
            contactPerson: 'Karan Mehra',
            email: 'karan@globalvalves.in',
            phone: '+91 98201 44777',
            category: 'Engineering Spares - Mechanical',
            submissionDate: '2026-08-29',
            status: 'CONDITIONAL / UNDER REVIEW',
            overallScore: 76.0,
            systemAction: 'Pending Review',
            moduleScores: {
              commercial: { score: 75, weightedScore: 18.75, maxScore: 25, weight: 25, remarks: 'Standard price' },
              technical: { score: 80, weightedScore: 12.0, maxScore: 15, weight: 15, remarks: 'Acceptable tech' },
              quality: { score: 75, weightedScore: 15.0, maxScore: 20, weight: 20, remarks: 'Standard quality' },
              delivery: { score: 75, weightedScore: 15.0, maxScore: 20, weight: 20, remarks: 'Standard delivery' },
              financial: { score: 70, weightedScore: 7.0, maxScore: 10, weight: 10, remarks: 'Stable' },
              governance: { score: 80, weightedScore: 8.0, maxScore: 10, weight: 10, remarks: 'Compliant' },
            },
            documents: [],
          },
        ],
        auditLogs: [
          {
            id: 'log-1',
            timestamp: '2026-08-29 10:00:00',
            action: 'Initial system bootstrap',
            user: 'System Bot',
            hash: 'abc123sha256',
          },
        ],
        aiFeed: [
          {
            id: 'feed-1',
            timestamp: '10:00 AM',
            title: 'Bootstrap Completed',
            message: 'System loaded successfully',
            type: 'system',
          },
        ],
        systemConfig: {
          ollamaModel: 'Llama 3 (8B Instruct)',
          ollamaActive: true,
          ocrExtractionThreshold: 85,
          whatsappAutoChaser: true,
          voiceCallAutoChaser: true,
          smsAutoChaser: true,
          escalationIntervalHours: 24,
        },
      },
    };
    // Method-aware: GET /api/rfqs lists (an array), POST /api/rfqs creates (one
    // record). The server allocates the RFQ number, so the created record carries
    // one the caller did not supply — which is exactly what the store must adopt.
    let allocated = 0;
    let allocatedVendors = 0;
    let allocatedAuditEntries = 0;
    let allocatedFeedItems = 0;
    let allocatedBuyerAccounts = 0;
    // The account the server reports as active. Activation changes it, and GET /api/buyer-accounts/active reads it.
    let serverActiveAccountId = 'buyer-acc-1';
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const isRfqEndpoint = typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url);
      const isVendorsEndpoint = typeof url === 'string' && /\/api\/vendors(\?|$)/.test(url);
      const isBuyerAccountEndpoint = typeof url === 'string' && /^\/api\/buyer-accounts\/[^/?]+$/.test(url);
      if (isBuyerAccountEndpoint && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { activeAccount: null } }),
        });
      }
      if (isVendorsEndpoint && init?.method === 'POST') {
        allocatedVendors += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { ...sent, id: `v-added-${allocatedVendors}` } }),
        });
      }
      if (isRfqEndpoint && init?.method === 'POST') {
        allocated += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              ...sent,
              id: `${allocated}`,
              rfqId: `RFQ26040900000${allocated}`,
              rfqNumber: `RFQ26040900000${allocated}`,
              createdAt: '2026-09-04T10:00:00.000Z',
              quotes: [],
              quotesCount: 0,
              chasingActive: false,
              aiSummary: null,
            },
          }),
        });
      }
      if (url === '/api/buyer-accounts' && init?.method === 'POST') {
        allocatedBuyerAccounts += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: { ...sent, id: `buyer-acc-new-${allocatedBuyerAccounts}`, createdDate: '2026-09-04', syncTimestamp: '2026-09-04 10:00 UTC' },
          }),
        });
      }
      const activateMatch = typeof url === 'string' ? url.match(/^\/api\/buyer-accounts\/([^/?]+)\/activate$/) : null;
      if (activateMatch && init?.method === 'POST') {
        serverActiveAccountId = activateMatch[1];
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { activeAccountId: serverActiveAccountId } }) });
      }
      if (url === '/api/buyer-accounts/active') {
        const known = bootstrapPayload.data.buyerAccounts.find((account) => account.id === serverActiveAccountId);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: known ?? null }) });
      }
      // The server stamps the audit actor and seal. The store adds the entry only from this stored copy.
      if (url === '/api/audit' && init?.method === 'POST') {
        allocatedAuditEntries += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              id: `audit-${allocatedAuditEntries}`,
              timestamp: '2026-09-04 10:00:00 UTC',
              userEmail: 'buyer@procucev.com',
              action: sent.action,
              rfqNumber: sent.rfqNumber ?? null,
              shaSignature: `sha-${allocatedAuditEntries}`,
              previousHash: '',
              ipAddress: '127.0.0.1',
            },
          }),
        });
      }
      if (url === '/api/ai-feed' && init?.method === 'POST') {
        allocatedFeedItems += 1;
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { ...sent, id: `feed-${allocatedFeedItems}`, timestamp: '10:00 AM' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (isRfqEndpoint ? { success: true, data: STORE_RFQ_FIXTURES } : bootstrapPayload),
      });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws error when useApp is called outside of AppProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
    const TestComponent = () => {
      useApp();
      return <div>Test</div>;
    };
    expect(() => render(<TestComponent />)).toThrow('useApp must be used within an AppProvider');
    spy.mockRestore();
  });

  it('hydrates initial state from /api/bootstrap and exposes store contexts', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return (
        <div>
          <span data-testid="role">{contextValue.currentRole}</span>
          <span data-testid="mode">{contextValue.currentMode}</span>
          <span data-testid="theme">{contextValue.theme}</span>
          <span data-testid="db">{contextValue.dbConnected ? 'connected' : 'disconnected'}</span>
          <span data-testid="rfq-count">{contextValue.rfqs.length}</span>
          <button onClick={() => contextValue.toggleTheme()}>Toggle Theme</button>
        </div>
      );
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('rfq-count')).toHaveTextContent('1');
    });

    expect(contextValue.rfqs.length).toBe(1);
    expect(contextValue.buyerAccounts.length).toBe(2);
    expect(contextValue.buyerVendors.length).toBe(4);
    expect(contextValue.vendorEvaluations.length).toBe(2);

    // Call refreshFromDB again when activeBuyerAccount is already set
    await act(async () => {
      await contextValue.refreshFromDB();
    });

    // Call refreshFromDB with live azureHealth array
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          azureHealth: [{ service: 'Database Live', status: 'Healthy' }],
        },
      }),
    });
    await act(async () => {
      await contextValue.refreshFromDB();
    });
    expect(contextValue.azureHealth[0].service).toBe('Database Live');

    // Call refreshFromDB when data is empty object (takes all fallback branches)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {},
      }),
    });
    await act(async () => {
      await contextValue.refreshFromDB();
    });

    // Test Theme toggle twice (light -> dark -> light)
    fireEvent.click(screen.getByText('Toggle Theme'));
    expect(contextValue.theme).toBe('dark');
    fireEvent.click(screen.getByText('Toggle Theme'));
    expect(contextValue.theme).toBe('light');

    // Test mount with saved 'dark' theme in localStorage
    localStorage.setItem('procucev_theme', 'dark');
    let darkThemeContext: any;
    const DarkConsumer = () => {
      darkThemeContext = useApp();
      return <div>Theme: {darkThemeContext.theme}</div>;
    };
    render(
      <AppProvider>
        <DarkConsumer />
      </AppProvider>
    );
    expect(darkThemeContext.theme).toBe('dark');
    localStorage.removeItem('procucev_theme');

    // Call refreshFromDB when activeBuyerAccount is already set to buyer-acc-1 (matching)
    await act(async () => {
      await contextValue.alignActiveBuyerAccount('buyer-acc-1');
    });
    await act(async () => {
      await contextValue.refreshFromDB();
    });

    // Vendor subscription and payment links with vendor session
    authClient.setSession(
      { id: 'u-vendor-1', email: 'rajesh@apexindustrial.in', name: 'Rajesh Nair', role: 'vendor', orgId: 'org-v-1', orgName: 'Apex Industrial' },
      'vendor-token'
    );

    // updateVendorSubscription network error
    mockFetch.mockRejectedValueOnce(new Error('Sub network error'));
    await act(async () => {
      const netErrSub = await contextValue.updateVendorSubscription('connect');
      expect(netErrSub).toBe(false);
    });
    expect(logger.buffer).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'ERROR',
        category: 'VENDOR_SUBSCRIPTION',
        message: 'Failed to update vendor subscription',
        metadata: expect.objectContaining({ error: expect.any(Error) }),
      }),
    ]));

    // updateVendorSubscription failed response with error message
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ success: false, error: 'Cannot upgrade' }),
    });
    await act(async () => {
      const failSub = await contextValue.updateVendorSubscription('connect');
      expect(failSub).toBe(false);
    });
    expect(logger.buffer).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'ERROR',
        category: 'VENDOR_SUBSCRIPTION',
        message: 'Vendor subscription update was rejected',
        metadata: expect.objectContaining({ status: 403, responseError: 'Cannot upgrade' }),
      }),
    ]));

    // updateVendorSubscription failed response with no error message (fallback)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false }),
    });
    await act(async () => {
      const failSubNoErr = await contextValue.updateVendorSubscription('connect');
      expect(failSubNoErr).toBe(false);
    });

    // updateVendorSubscription successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { subscriptionPlan: 'select', rfqDownloadsUsed: 2 } }),
    });
    await act(async () => {
      const okSub = await contextValue.updateVendorSubscription('select');
      expect(okSub).toBe(true);
    });

    // createVendorPaymentLink failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: 'Gateway unavailable' }),
    });
    let failPayLink: string | null = null;
    await act(async () => {
      failPayLink = await contextValue.createVendorPaymentLink('select');
    });
    expect(failPayLink).toBeNull();

    // createVendorPaymentLink success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { paymentUrl: 'https://pay.vendor.example.com' } }),
    });
    let okPayLink: string | null = null;
    await act(async () => {
      okPayLink = await contextValue.createVendorPaymentLink('select');
    });
    expect(okPayLink).toBe('https://pay.vendor.example.com');

    // checkVendorPaymentLinkStatus
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'v-link-1', status: 'PAID' }] }),
    });
    const vLinkStatus = await contextValue.checkVendorPaymentLinkStatus('v-link-1');
    expect(vLinkStatus).toBe('PAID');

    authClient.setSession(
      { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
      'test-session-token'
    );
  });

  it('handles role switching and tab defaults', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return (
        <div>
          <span data-testid="role">{contextValue.currentRole}</span>
          <span data-testid="tab">{contextValue.activeTab}</span>
        </div>
      );
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    act(() => {
      contextValue.setCurrentRole('category_manager');
    });
    expect(contextValue.activeTab).toBe('kanban_board');

    act(() => {
      contextValue.setCurrentRole('vendor');
    });
    expect(contextValue.activeTab).toBe('vendor_feed');

    act(() => {
      contextValue.setCurrentRole('admin');
    });
    expect(contextValue.activeTab).toBe('infra_control');

    act(() => {
      contextValue.setCurrentRole('buyer');
    });
    expect(contextValue.activeTab).toBe('command_center');
  });

  it('handles all state setters (systemConfig, subscriptions, catalogue, selfEvaluation)', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Config: {contextValue.systemConfig?.ollamaModel ?? ''}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    // No system config is substituted before the server returns one.
    expect(contextValue.systemConfig).toBeNull();
    expect(contextValue.azureHealth).toEqual([]);
    expect(contextValue.remainingFreeRFQs).toBeNull();
    expect(contextValue.activeSubscription).toBeNull();
    expect(contextValue.vendorSelfEvaluationScore).toBeNull();

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    act(() => {
      contextValue.setIsLoggedIn(false);
      contextValue.setCurrentMode('mode_3');
      contextValue.setActiveTab('custom_tab');
      contextValue.setSystemConfig({ ...contextValue.systemConfig, ollamaActive: false });
      contextValue.setRemainingFreeRFQs(3);
      contextValue.setActiveSubscription('version_3');
      contextValue.setVendorSubscription('select');
      contextValue.setVendorRfqDownloadsUsed(10);
      contextValue.setVendorCatalogue([{ id: 'cat-1', name: 'Item SKU 1' }]);
      contextValue.setVendorSelfEvaluationCompleted(true);
      contextValue.setVendorSelfEvaluationScore(98.5);
      contextValue.setInitialSetupModalOpen(true);
      contextValue.setInitialSetupCompleted(true);
      contextValue.setHistoricalPurchaseDataPeriod('3_years');
      contextValue.setSelectedRFQForMatrix(null);
    });

    expect(contextValue.isLoggedIn).toBe(false);
    expect(contextValue.currentMode).toBe('mode_3');
    expect(contextValue.activeTab).toBe('custom_tab');
    expect(contextValue.vendorSubscription).toBe('select');
    expect(contextValue.isVendorEvaluationFeeWaived).toBe(true);
    expect(contextValue.vendorSelfEvaluationScore).toBe(98.5);
    expect(contextValue.vendorCatalogue.length).toBe(1);
    expect(contextValue.initialSetupCompleted).toBe(true);
    expect(contextValue.historicalPurchaseDataPeriod).toBe('3_years');
  });

  it('handles buyer accounts operations (add, update, delete, align, import)', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Buyer Accounts: {contextValue.buyerAccounts.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.dbConnected).toBe(true));

    // 1. Adding an account stores the record the server returns and makes it the active account.
    const saved: { account: BuyerAccount | null } = { account: null };
    await act(async () => {
      saved.account = await contextValue.addBuyerAccount({
        organizationName: 'Tata Projects Ltd',
        industry: 'Infrastructure',
        corporateEmail: 'tata@procucev.com',
        contactPerson: 'Karan Sharma',
        phone: '+91 98201 11223',
        sourcingMode: 'mode_2',
        subscriptionPlan: 'version_2',
        remainingFreeRFQs: 10,
        accountSource: 'direct_enterprise_signup',
      });
    });
    const newAcc = saved.account as BuyerAccount;
    expect(newAcc.id).toBe('buyer-acc-new-1');
    expect(contextValue.buyerAccounts[0].id).toBe('buyer-acc-new-1');
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-new-1');

    // Updates go to the gated PUT route. The local record changes only after the server accepts them.
    // Activation of 'non-existent-id' is refused by the server; every other request keeps the shared mock.
    const sharedFetch = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/buyer-accounts/non-existent-id/activate') {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ success: false, error: 'Buyer account not found.' }),
        });
      }
      const match = typeof url === 'string' ? url.match(/^\/api\/buyer-accounts\/([^/?]+)$/) : null;
      if (match && init?.method === 'PUT') {
        const id = match[1];
        const known = contextValue.buyerAccounts.find((account: BuyerAccount) => account.id === id);
        if (!known) {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ success: false, error: `Buyer account ${id} not found.` }),
          });
        }
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { ...known, ...sent } }),
        });
      }
      return sharedFetch?.(url, init);
    });

    act(() => {
      contextValue.updateBuyerAccount(newAcc.id, { industry: 'Heavy Infrastructure & Power' });
      contextValue.updateBuyerAccount('buyer-acc-2', { industry: 'Renewable Power' });
      contextValue.updateBuyerAccount('non-existent-id', { industry: 'Noop' });
    });
    await waitFor(() =>
      expect(contextValue.activeBuyerAccount?.industry).toBe('Heavy Infrastructure & Power')
    );
    await waitFor(() =>
      expect(contextValue.buyerAccounts.find((a: BuyerAccount) => a.id === 'buyer-acc-2')?.industry).toBe('Renewable Power')
    );
    expect(contextValue.buyerAccounts.some((a: BuyerAccount) => a.id === 'non-existent-id')).toBe(false);

    // 3. Activating an account the server refuses returns false and leaves the active account unchanged.
    await act(async () => {
      expect(await contextValue.alignActiveBuyerAccount('non-existent-id')).toBe(false);
    });
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-new-1');

    // 4. Switching to an existing account is confirmed by the server and then reloaded as the active account.
    await act(async () => {
      expect(await contextValue.alignActiveBuyerAccount('buyer-acc-2')).toBe(true);
    });
    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-2'));

    // 5. Deleting a non-active account the server confirms removes it and keeps the active account.
    await act(async () => {
      expect(await contextValue.deleteBuyerAccount(newAcc.id)).toBe(true);
    });
    expect(contextValue.buyerAccounts.some((a: BuyerAccount) => a.id === newAcc.id)).toBe(false);
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-2');
  });

  it.each([
    ['HTTP failure', { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ success: false, error: 'Database unavailable' }) }],
    ['unconfirmed response', { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: false, error: 'Deletion not confirmed' }) }],
    ['malformed response', { ok: true, status: 200, statusText: 'OK', json: async () => { throw new SyntaxError('Invalid JSON'); } }],
  ])('keeps buyer-account state when deletion returns a %s', async (_label, failureResponse) => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return null;
    };
    render(<AppProvider><Consumer /></AppProvider>);
    await waitFor(() => expect(contextValue.dbConnected).toBe(true));
    await act(async () => {
      await contextValue.alignActiveBuyerAccount('buyer-acc-1');
    });

    const previousImplementation = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (typeof url === 'string' && url.endsWith('/buyer-acc-1') && init?.method === 'DELETE') {
        return Promise.resolve(failureResponse);
      }
      return previousImplementation?.(url, init) ?? Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: {} }),
      });
    });

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await contextValue.deleteBuyerAccount('buyer-acc-1');
    });

    expect(deleted).toBe(false);
    expect(contextValue.buyerAccounts.some((account: BuyerAccount) => account.id === 'buyer-acc-1')).toBe(true);
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-1');
    expect(logger.getLogs({ level: 'ERROR', category: 'BUYER_ACCOUNT' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Buyer account deletion request failed' })])
    );
  });

  it('updates an existing active-account replacement after confirmed deletion', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return null;
    };
    render(<AppProvider><Consumer /></AppProvider>);
    await waitFor(() => expect(contextValue.dbConnected).toBe(true));
    await act(async () => {
      await contextValue.alignActiveBuyerAccount('buyer-acc-1');
    });

    const existingReplacement = contextValue.buyerAccounts.find((account: BuyerAccount) => account.id === 'buyer-acc-2');
    const previousImplementation = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (typeof url === 'string' && url.endsWith('/buyer-acc-1') && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { activeAccount: { ...existingReplacement, organizationName: 'Updated Active Buyer' } },
          }),
        });
      }
      return previousImplementation?.(url, init);
    });

    await act(async () => {
      expect(await contextValue.deleteBuyerAccount('buyer-acc-1')).toBe(true);
    });

    expect(contextValue.buyerAccounts.some((account: BuyerAccount) => account.id === 'buyer-acc-1')).toBe(false);
    expect(contextValue.buyerAccounts.find((account: BuyerAccount) => account.id === 'buyer-acc-2')?.organizationName)
      .toBe('Updated Active Buyer');
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-2');
  });

  it('preserves the active buyer when a different account is deleted successfully', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return null;
    };
    render(<AppProvider><Consumer /></AppProvider>);
    await waitFor(() => expect(contextValue.dbConnected).toBe(true));
    await act(async () => {
      await contextValue.alignActiveBuyerAccount('buyer-acc-1');
    });

    await act(async () => {
      expect(await contextValue.deleteBuyerAccount('buyer-acc-2')).toBe(true);
    });

    expect(contextValue.buyerAccounts.some((account: BuyerAccount) => account.id === 'buyer-acc-2')).toBe(false);
    expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-1');
  });

  it('logs network failures and preserves buyer-account state when deletion is unconfirmed', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return null;
    };
    render(<AppProvider><Consumer /></AppProvider>);
    await waitFor(() => expect(contextValue.dbConnected).toBe(true));
    const previousImplementation = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (typeof url === 'string' && url.endsWith('/buyer-acc-1') && init?.method === 'DELETE') {
        return Promise.reject(new Error('connection reset'));
      }
      return previousImplementation?.(url, init) ?? Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: {} }),
      });
    });

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await contextValue.deleteBuyerAccount('buyer-acc-1');
    });

    expect(deleted).toBe(false);
    expect(contextValue.buyerAccounts.some((account: BuyerAccount) => account.id === 'buyer-acc-1')).toBe(true);
    expect(logger.getLogs({ level: 'ERROR', category: 'BUYER_ACCOUNT' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Buyer account deletion request could not reach the backend' })])
    );
  });

  it('handles buyer vendors, matching, reminders, and profile completion with dual-stream category resolution', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Vendors: {contextValue.buyerVendors.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    // 1. Add single Buyer Vendor (new and existing in DB)
    let addedVendor: VendorEntry | null = null;
    await act(async () => {
      addedVendor = await contextValue.addBuyerVendor({
        name: 'Precision Hydro Pumps',
        contactPerson: 'Karan Sharma',
        email: 'karan@precisionhydro.in',
        phone: '+91 98201 44999',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        clientMappedCategories: ['Centrifugal Pumps'],
        vendorSelectedCategories: ['Centrifugal Pumps'],
        location: 'Ahmedabad, Gujarat',
        rating: 4.5,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        score: 88,
        evaluated: true,
      });
      // Add existing vendor in DB
      await contextValue.addBuyerVendor({
        name: 'Apex Industrial Dynamics Pvt Ltd',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apexindustrial.in',
        phone: '+91 98201 44820',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Centrifugal Pumps'],
        location: 'Pune',
      });
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.name === 'Precision Hydro Pumps')).toBe(true);

    // 2. Add further buyer vendors with diverse category mappings (real bulk
    // upload now goes through POST /api/vendors/bulk-import, covered
    // separately in VendorUploadModal.test.tsx and the backend's own
    // storeService.test.js — this just needs more vendors on the client-side
    // buyerVendors list for the matching assertions below).
    await act(async () => {
      await contextValue.addBuyerVendor({
        name: 'FlowTech Systems',
        contactPerson: 'Sunil Rao',
        email: 'sunil@flowtech.in',
        phone: '+91 98201 44111',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Slurry Pumps'],
        clientMappedCategories: ['Slurry Pumps'],
        vendorSelectedCategories: [],
        location: 'Mumbai, Maharashtra',
        rating: 4.6,
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        score: 90,
        evaluated: true,
      });
      await contextValue.addBuyerVendor({
        name: 'Self Declared Vendor',
        contactPerson: 'Amit Kumar',
        email: 'amit@selfdeclared.in',
        phone: '+91 98201 44222',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: [],
        clientMappedCategories: [],
        vendorSelectedCategories: ['High Pressure Valves'],
        location: '', // empty location branch
        rating: 0,    // rating 0 branch
        source: 'buyer_manual',
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
      });
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.name === 'FlowTech Systems')).toBe(true);

    // 3. Match Suitable Vendors across mode_1, mode_2, mode_3, unmatched categories, and customList
    const entities: ExtractedEntity[] = [
      {
        id: 'e1',
        itemName: 'Centrifugal Pump 50HP',
        quantity: 2,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '50HP',
        confidence: 90,
        category: 'Centrifugal Pumps',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Centrifugal Pumps',
      },
      {
        id: 'e2',
        itemName: 'Slurry Pump 100GPM',
        quantity: 1,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '100GPM',
        confidence: 90,
        category: 'Slurry Pumps',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'Slurry Pumps',
      },
      {
        id: 'e3',
        itemName: 'High Pressure Valve 4-inch',
        quantity: 5,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: '4-inch',
        confidence: 90,
        category: 'High Pressure Valves',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategory: 'High Pressure Valves',
      },
    ];

    const unmatchedEntities: ExtractedEntity[] = [
      {
        id: 'e-unmatched',
        itemName: 'Obscure Aerospace Part XYZ',
        quantity: 1,
        unit: 'units',
        targetDate: '2026-10-15',
        technicalSpecs: 'XYZ',
        confidence: 10,
        category: 'Aerospace Obscurity',
        majorCategory: 'Aerospace',
        minorCategory: 'Aerospace Obscurity',
      },
    ];

    let matchedMode1: VendorEntry[] = [];
    let matchedMode2: VendorEntry[] = [];
    let matchedMode3: VendorEntry[] = [];
    let matchedCustom: VendorEntry[] = [];
    let matchedFallbackMode1: VendorEntry[] = [];
    let matchedFallbackMode2: VendorEntry[] = [];
    let matchedFallbackMode3: VendorEntry[] = [];

    act(() => {
      matchedMode1 = contextValue.matchSuitableVendors(entities, 'mode_1');
      matchedMode2 = contextValue.matchSuitableVendors(entities, 'mode_2');
      matchedMode3 = contextValue.matchSuitableVendors(entities, 'mode_3');
      matchedCustom = contextValue.matchSuitableVendors(entities, 'mode_1', [addedVendor, addedVendor]);
      matchedFallbackMode1 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_1');
      matchedFallbackMode2 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_2');
      matchedFallbackMode3 = contextValue.matchSuitableVendors(unmatchedEntities, 'mode_3');

      // Test sorting permutations for mode 2 and mode 3 (unevaluated vs evaluated, and equal evaluations)
      const unEvalVendor: VendorEntry = { id: 'v-uneval', name: 'Unevaluated Corp', contactPerson: 'Tester', phone: '+91 99999 11111', majorCategory: 'Mechanical', minorCategories: ['Centrifugal Pumps'], email: 'un@eval.com', rating: 0, location: 'Delhi', source: 'buyer_manual', status: 'REGISTERED / NOT EVALUATED' };
      const evalVendor: VendorEntry = { id: 'v-eval', name: 'Evaluated Corp', contactPerson: 'Tester', phone: '+91 99999 22222', majorCategory: 'Mechanical', minorCategories: ['Centrifugal Pumps'], email: 'ev@eval.com', rating: 4.5, location: 'Mumbai', source: 'buyer_manual', status: 'PREFERRED ENTERPRISE SUPPLIER' };
      contextValue.matchSuitableVendors(entities, 'mode_2', [unEvalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_2', [evalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_3', [unEvalVendor, evalVendor]);
      contextValue.matchSuitableVendors(entities, 'mode_3', [evalVendor, evalVendor]);
    });
    expect(matchedMode1.length).toBeGreaterThan(0);
    expect(matchedMode2.length).toBeGreaterThan(0);
    expect(matchedMode3.length).toBeGreaterThan(0);
    expect(matchedCustom.length).toBe(2);
    // No fallback list: an entity that no vendor matches yields no vendors in any mode.
    expect(matchedFallbackMode1).toEqual([]);
    expect(matchedFallbackMode2).toEqual([]);
    expect(matchedFallbackMode3).toEqual([]);

    // 4. Generate Standard RFQ Email (mode_1, mode_2, mode_3)
    const sampleRfq: RFQItem = {
      id: 'r-1',
      rfqNumber: 'RFQ260409000001',
      title: 'Sample RFQ',
      category: 'Mechanical',
      createdAt: '2026-08-29',
      targetDeliveryDate: '2026-09-30',
      status: 'Quotes Pending',
      sourcingMode: 'mode_2',
      quotesCount: 0,
      budget: 100000,
      extractedEntities: entities,
      quotes: [],
      chasingActive: true,
    };
    const rfqEmailMode2 = contextValue.generateStandardRFQEmail(sampleRfq, addedVendor!);
    expect(rfqEmailMode2.specialInstructions).toContain('Hybrid Competitive Sourcing');

    const sampleRfqMode3: RFQItem = { ...sampleRfq, sourcingMode: 'mode_3' };
    const rfqEmailMode3 = contextValue.generateStandardRFQEmail(sampleRfqMode3, { ...addedVendor!, minorCategories: [] });
    expect(rfqEmailMode3.specialInstructions).toContain('Mode 3 360-Degree');

    // Test mode 1 with vendor without minor categories, empty majorCategory, empty contact fields and empty extracted entities
    const sampleRfqMode1: RFQItem = { ...sampleRfq, sourcingMode: 'mode_1', budget: 0, category: '', createdAt: '', extractedEntities: [{ itemName: 'Bare Item' } as any] };
    const rfqEmailMode1 = contextValue.generateStandardRFQEmail(sampleRfqMode1, {
      id: 'v-fallback',
      name: 'Fallback Vendor',
      email: 'fallback@vendor.com',
      majorCategory: '',
      minorCategories: [],
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: false,
    });
    expect(rfqEmailMode1.specialInstructions).toContain('Strict Single-Roster');
    // With no category on the vendor, the RFQ or its line items, none is named. No stand-in category is substituted.
    expect(rfqEmailMode1.matchedMajorCategory).toBe('');

    // Test invalid sourcing mode fallback
    const invalidModeEmail = contextValue.generateStandardRFQEmail({ ...sampleRfq, sourcingMode: 'invalid_mode' as any }, addedVendor!);
    expect(invalidModeEmail.sourcingModeName).toBeDefined();

    // Open standard email modal without passing vendor and with followUpData null or non-matching vendor
    act(() => {
      contextValue.openStandardEmailModal(sampleRfq);
      contextValue.openStandardEmailModal({ ...sampleRfq, followUpData: undefined as any });
      contextValue.openStandardEmailModal({ ...sampleRfq, followUpData: { vendors: [{ vendorName: 'Unknown Nonexistent Supplier' }] } as any });
    });
    // None of these calls names a recipient the directory holds, so no email is built.
    expect(contextValue.emailModalOpen).toBe(false);
    expect(contextValue.toastMessage?.title).toBe(STORE_MESSAGES.emailNoRecipientTitle);

    // 5. Open Onboarding Email Modal & Generate Onboarding Email
    const emailNew = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      minorCategories: ['Centrifugal Pumps'],
    }, false);
    expect(emailNew.subject).toContain('Preferred Vendor Network');
    expect(emailNew).not.toHaveProperty('tempPassword');
    expect(emailNew.authInstructions).toContain('verification steps shown on the portal');

    const emailExistingMapped = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      minorCategories: ['Centrifugal Pumps'],
    }, true);
    expect(emailExistingMapped.subject).toContain('Network Association');

    const emailUnmapped = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      majorCategory: 'Uncategorized (No Past POs)',
      minorCategories: [],
    }, false);
    expect(emailUnmapped.subject).toContain('Set Up Categories');

    const emailUnassigned = contextValue.generateVendorOnboardingEmail({
      ...addedVendor!,
      majorCategory: '(None Assigned by Buyer)',
      minorCategories: [],
    }, false);
    expect(emailUnassigned.assignedMajorCategory).toBe('(None Assigned by Buyer)');

    act(() => {
      contextValue.openOnboardingEmailModal(addedVendor!);
    });
    expect(contextValue.onboardingEmailModalOpen).toBe(true);
    expect(contextValue.selectedOnboardingEmail).not.toBeNull();

    // 6. Trigger Vendor Reminder & Complete Profile
    // 7. Save Vendor Profile Categories (aligned and mismatched)
    act(() => {
      // Aligned: clientCats and vendorCats identical (hitting line 694)
      contextValue.saveVendorProfileCategories('karan@precisionhydro.in', ['Centrifugal Pumps'], ['Centrifugal Pumps']);
      // Mismatched: clientCats and vendorCats different
      contextValue.saveVendorProfileCategories('karan@precisionhydro.in', ['Cat A', 'Cat B'], ['Cat A', 'Cat C']);
      // Non-matching vendor email
      contextValue.saveVendorProfileCategories('nobody@nowhere.com', ['Cat A'], ['Cat B']);
      contextValue.setClientMappedCategories(['Cat A']);
      contextValue.setVendorSelectedCategories(['Cat B']);
    });

    // 8. Delete Buyer Vendor. The server confirms the vendor it holds and refuses the unknown id.
    const sharedFetch = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === `/api/vendors/${addedVendor!.id}` && init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      }
      if (url === '/api/vendors/non-existent-vendor-id' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ success: false, error: 'Vendor not found.' }) });
      }
      return sharedFetch?.(url, init);
    });
    await act(async () => {
      expect(await contextValue.deleteBuyerVendor(addedVendor!.id)).toBe(true);
      expect(await contextValue.deleteBuyerVendor('non-existent-vendor-id')).toBe(false);
    });
    expect(contextValue.buyerVendors.some((v: VendorEntry) => v.id === addedVendor!.id)).toBe(false);
  });

  it('handles RFQ creation, working hours calculations, subscription limits validation, and sequence timers', async () => {
    jest.useFakeTimers();
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>RFQs: {contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    // 1. Subscription limit validation errors inside act
    act(() => {
      contextValue.setActiveSubscription('none');
    });
    // Rejected rather than thrown: addNewRFQ persists before touching state.
    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Subscription required');

    act(() => {
      contextValue.setActiveSubscription('free_trial');
      contextValue.setRemainingFreeRFQs(0);
    });
    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Free account quota exhausted');

    act(() => {
      contextValue.setActiveSubscription('version_1');
    });
    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_2',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Subscription required');

    await expect(
      contextValue.addNewRFQ({
        title: 'Error RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_3',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow('Subscription required');

    // 2. Add New RFQ with free_trial and mode_1
    act(() => {
      contextValue.setActiveSubscription('free_trial');
      contextValue.setRemainingFreeRFQs(5);
    });

    // Test addWorkingHours on Saturday night at 20:00 (rolls over Sunday to Monday)
    const saturdayNight = new Date(2026, 7, 29, 20, 0, 0); // Saturday 8 PM local
    jest.setSystemTime(saturdayNight);

    let createdRfqMode1: RFQItem;
    await act(async () => {
      createdRfqMode1 = await contextValue.addNewRFQ({
        title: 'High Pressure Water Turbines',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 600000,
        extractedEntities: [
          {
            id: 'ent-99',
            itemName: 'Water Turbine 100kW',
            quantity: 2,
            unit: 'units',
            targetDate: '2026-10-15',
            technicalSpecs: '100kW Pelton Turbine',
            confidence: 92,
            category: 'Turbines',
          },
        ],
        customMatchedVendors: [
          {
            id: 'v-apex-custom',
            name: 'Apex Supplies Ltd.',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apex.in',
            phone: '+91 98201 44820',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Pune',
            rating: 4.8,
            source: 'buyer_manual',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            evaluated: true,
          },
          {
            id: 'v-other-custom',
            name: 'Other Non-Apex Vendor',
            contactPerson: 'Karan Mehra',
            email: 'karan@other.in',
            phone: '+91 98201 44777',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Delhi',
            rating: 4.3,
            source: 'buyer_manual',
            status: 'REGISTERED / NOT EVALUATED',
            evaluated: false,
          },
          {
            id: 'v-dup',
            name: 'Duplicate Vendor',
            email: 'karan@other.in', // Duplicate email exercises seenKeys.has(key)
            location: 'Delhi',
          },
          {
            id: '',
            name: 'Nameless Vendor',
            phone: '',
            contactPerson: '',
            location: 'Delhi',
          },
        ],
      });
      contextValue.setSelectedRFQForDeepDive(createdRfqMode1);
    });
    // Server-allocated: the client no longer chooses this.
    expect(createdRfqMode1!.rfqNumber).toMatch(/^RFQ\d+$/);

    // Test Sunday start with budget = 0 and source email_gateway
    const sundayDate = new Date(2026, 7, 30, 10, 0, 0); // Sunday 10 AM local
    jest.setSystemTime(sundayDate);
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Sunday RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_2',
        budget: 0,
        extractedEntities: [],
        source: 'email_gateway',
      });
    });

    // Test free_trial with mode_3 (testing 'Version 3 (Autonomous AI)' branch in modeName)
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Free Trial Mode 3 RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_3',
        budget: 200000,
        extractedEntities: [],
      });
    });

    // Test early morning before 8 AM
    const earlyDate = new Date(2026, 7, 31, 5, 0, 0); // Monday 5 AM local
    jest.setSystemTime(earlyDate);
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Early Morning RFQ',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_2',
        budget: 100000,
        extractedEntities: [],
      });
    });

    // First advance timers with matching selectedRFQForDeepDive (executing lines 1955-1970)
    act(() => {
      jest.advanceTimersByTime(20000);
    });

    // Create another mode 1 RFQ and advance timers with non-matching selectedRFQForDeepDive (executing line 1978)
    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Turbine Spares B',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 50000,
        extractedEntities: [],
        customMatchedVendors: [
          {
            id: 'v-apex-b',
            name: 'Apex Supplies Ltd.',
            contactPerson: 'Rajesh Nair',
            email: 'rajesh@apex.in',
            phone: '+91 98201 44820',
            majorCategory: 'Mechanical',
            minorCategories: ['Turbines'],
            location: 'Pune',
            rating: 4.8,
            source: 'buyer_manual',
            status: 'PREFERRED ENTERPRISE SUPPLIER',
            evaluated: true,
          },
        ],
      });
      contextValue.setSelectedRFQForDeepDive({ id: 'other-rfq', rfqNumber: 'RFQ-OTHER' } as any);
    });

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    // 3. Add New RFQ with mode_3 and version_3 plan
    act(() => {
      contextValue.setActiveSubscription('version_3');
    });

    await act(async () => {
      await contextValue.addNewRFQ({
        title: 'Autonomous Slurry Valves',
        category: 'Mechanical',
        targetDeliveryDate: '2026-11-20',
        sourcingMode: 'mode_3',
        budget: 450000,
        extractedEntities: [
          {
            id: 'ent-m3',
            itemName: 'Slurry Valve 8-inch',
            quantity: 5,
            unit: 'units',
            targetDate: '2026-11-20',
            technicalSpecs: '8-inch Flanged ANSI 300',
            confidence: 94,
            category: 'Valves',
          },
        ],
      });
    });

    // 4. Batch chaser goes through the server route. Single-vendor chasers are not sent.
    await act(async () => {
      await contextValue.triggerBatchChannelChaser('RFQ-2026-001', ['call', 'whatsapp', 'sms']);
    });

    // 5. Approve PO
    await act(async () => {
      await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Test approval note');
      await contextValue.approvePO('RFQ-2026-NONEXISTENT', null, 'Unknown', 100);
    });

    // Approve PO failure paths: a rejected response and a network-level throw
    // must both resolve to { success: false } without navigating or updating
    // RFQ state, rather than throwing out of the handler.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'PO rejected' }) });
    await act(async () => {
      const result = await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Rejected case');
      expect(result.success).toBe(false);
    });

    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      const result = await contextValue.approvePO('RFQ-2026-999', 'v-apex-b', 'Apex Supplies Ltd.', 580000, 'Network failure case');
      expect(result.success).toBe(false);
    });

    // 7. Open Deep Dive & Modal triggers
    act(() => {
      contextValue.openRFQDeepDive(createdRfqMode1!);
      contextValue.openStandardEmailModal(createdRfqMode1!);
    });
    expect(contextValue.deepDiveModalOpen).toBe(true);
    // No recipient was passed and this RFQ names no assigned vendor, so no email is built and the modal stays closed.
    expect(contextValue.emailModalOpen).toBe(false);
    expect(contextValue.toastMessage?.title).toBe(STORE_MESSAGES.emailNoRecipientTitle);

    jest.useRealTimers();
  });

  it('projects a vendor opportunity from an RFQ with no deadline or budget without inventing values', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>RFQs: {contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.buyerVendors.length).toBeGreaterThan(0));

    act(() => {
      contextValue.setActiveSubscription('version_3');
    });

    let created: RFQItem;
    await act(async () => {
      created = await contextValue.addNewRFQ({
        rfqNumber: 'RFQ-NO-DEADLINE',
        title: 'Undated Sourcing Request',
        category: 'Mechanical',
        targetDeliveryDate: '',
        sourcingMode: 'mode_1',
        budget: 0,
        extractedEntities: [],
      });
    });

    // The server allocates the real rfqNumber, ignoring whatever the client sent.
    const opportunity = contextValue.vendorOpportunities.find((o: any) => o.rfqNumber === created.rfqNumber);
    expect(opportunity).toBeDefined();
    // No deadline was ever set — daysRemaining must not fall back to a
    // fabricated countdown, and estimatedValue must not fall back to a
    // fabricated budget ceiling the buyer never stated.
    expect(opportunity.deadline).toBe('');
    expect(opportunity.daysRemaining).toBe(0);
    expect(opportunity.estimatedValue).toBeUndefined();
  });

  it('handles vendor evaluation, rating revisions, audit logs, and feed items', async () => {
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Logs: {contextValue.auditLogs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.vendorEvaluations.length).toBeGreaterThan(0));

    // 1. Add Vendor Evaluation Record
    const evalRecord: VendorEvaluationRecord = {
      id: 'eval-99',
      vendorId: 'v-001',
      vendorName: 'Apex Industrial Dynamics Pvt Ltd',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apexindustrial.in',
      phone: '+91 98201 44820',
      category: 'Mechanical',
      submissionDate: '2026-08-29',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      overallScore: 95.0,
      systemAction: 'Promoted',
      moduleScores: {
        commercial: { score: 95, weightedScore: 23.75, maxScore: 25, weight: 25, remarks: 'Best' },
        technical: { score: 95, weightedScore: 14.25, maxScore: 15, weight: 15, remarks: 'High' },
        quality: { score: 95, weightedScore: 19.0, maxScore: 20, weight: 20, remarks: 'High' },
        delivery: { score: 95, weightedScore: 19.0, maxScore: 20, weight: 20, remarks: 'Fast delivery' },
        financial: { score: 90, weightedScore: 9.0, maxScore: 10, weight: 10, remarks: 'Strong' },
        governance: { score: 95, weightedScore: 9.5, maxScore: 10, weight: 10, remarks: 'Compliant' },
      },
      documents: [
        { id: 'd1', name: 'Cert.pdf', type: 'Quality', uploadDate: '2026-08-29', verified: true, status: 'Verified' },
      ],
    };

    await act(async () => {
      const saved = await contextValue.addVendorEvaluation(evalRecord);
      expect(saved).toBe(true);
      contextValue.openVendorEvaluationSummary(evalRecord);
    });
    expect(contextValue.evaluationModalOpen).toBe(true);

    // Failure paths: the caller must learn a submission was NOT saved,
    // whether the request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const saved = await contextValue.addVendorEvaluation({ ...evalRecord, id: 'eval-fail-1' });
      expect(saved).toBe(false);
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const saved = await contextValue.addVendorEvaluation({ ...evalRecord, id: 'eval-fail-2' });
      expect(saved).toBe(false);
    });

    // 2. Revise Vendor Rating (preferred, conditional, disqualified, and unknown vendor).
    // reviseVendorRating awaits the real POST /api/vendors/:id/rating-revision and
    // uses the server's response as the source of truth, so each call needs an
    // explicit mocked response shaped like the real endpoint's { success, data:
    // { revisionRecord, updatedVendor } } payload.
    const mockRevisionResponse = (overrides: Record<string, unknown> = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          revisionRecord: {
            id: `rev-${Date.now()}`,
            vendorId: 'v-001',
            vendorName: 'Apex Supplies Ltd.',
            buyerCompany: 'Larsen & Toubro Limited',
            buyerName: 'Vikram Malhotra',
            buyerEmail: 'buyer@procucev.com',
            timestamp: new Date().toISOString(),
            qualityScore: 92,
            costScore: 94,
            deliveryScore: 90,
            buyerAverage: 92,
            previousScore: 85,
            newCompositeScore: 90,
            previousRating: 4.3,
            newRating: 4.5,
            remarks: 'Excellent quality performance',
            emailDispatched: true,
            shaSignature: 'sha256-test',
            ...overrides,
          },
          updatedVendor: { id: 'v-001', score: 90, rating: 4.5 },
        },
      }),
    });

    let revision1: any;
    await act(async () => {
      mockFetch.mockResolvedValueOnce(mockRevisionResponse());
      revision1 = await contextValue.reviseVendorRating('v-001', 92, 94, 90, 'Excellent quality performance');
      contextValue.openRatingRevisionEmailModal(revision1);

      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ newCompositeScore: 65, remarks: 'Conditional review' }));
      const revision2 = await contextValue.reviseVendorRating('v-001', 65, 70, 60, 'Conditional review');
      expect(revision2.newCompositeScore).toBeDefined();

      mockFetch.mockResolvedValueOnce(
        mockRevisionResponse({ newCompositeScore: 40, remarks: 'Disqualified due to performance' })
      );
      const revision3 = await contextValue.reviseVendorRating('v-001', 40, 45, 40, 'Disqualified due to performance');
      expect(revision3.newCompositeScore).toBeDefined();

      // Revise with empty remarks and unknown vendor
      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ vendorId: 'unknown-vendor-id', remarks: '' }));
      await contextValue.reviseVendorRating('unknown-vendor-id', 80, 80, 80, '');
      // Revise vendor with score 0
      mockFetch.mockResolvedValueOnce(mockRevisionResponse({ vendorId: 'v-003' }));
      await contextValue.reviseVendorRating('v-003', 70, 70, 70, 'Revised score 0 vendor');
    });
    expect(contextValue.ratingRevisionEmailModalOpen).toBe(true);

    // Failure paths: the caller must learn a revision was NOT saved, whether the
    // request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const saved = await contextValue.reviseVendorRating('v-001', 50, 50, 50, 'Network failure case');
      expect(saved).toBeNull();
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const saved = await contextValue.reviseVendorRating('v-001', 50, 50, 50, 'Rejected case');
      expect(saved).toBeNull();
    });

    // Request Vendor Evaluation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'Evaluation request sent' }),
    });
    await act(async () => {
      const res = await contextValue.requestVendorEvaluation('v-001', 'Please submit performance form');
      expect(res.success).toBe(true);
    });

    // Request evaluation for non-existent vendor
    await act(async () => {
      const res = await contextValue.requestVendorEvaluation('nonexistent-vendor');
      expect(res.success).toBe(false);
    });

    // Request evaluation failure response from server
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'Internal failure' }),
    });
    await act(async () => {
      const res = await contextValue.requestVendorEvaluation('v-001');
      expect(res.success).toBe(false);
    });

    // 3. Add Audit Log & Feed Item across all role contexts and feed types
    // Audit and feed writes are async: each entry appears only after the server returns it.
    await act(async () => {
      await contextValue.addAuditLog('Custom administrative policy update', 'RFQ-2026-001');
      await contextValue.addAuditLog('Userless log with buyer role');
      contextValue.setCurrentRole('category_manager');
      await contextValue.addAuditLog('Userless log with CM role');
      contextValue.setCurrentRole('vendor');
      await contextValue.addAuditLog('Userless log with vendor role');
      contextValue.setCurrentRole('admin');
      await contextValue.addAuditLog('Userless log with admin role');
      contextValue.setCurrentRole('buyer');

      // Feed items with implicit and explicit channels
      await contextValue.addFeedItem('Urgent Call Notification', 'Action required', 'call');
      await contextValue.addFeedItem('WhatsApp Alert', 'Dispatched WA', 'whatsapp');
      await contextValue.addFeedItem('SMS Alert', 'Dispatched SMS', 'sms');
      await contextValue.addFeedItem('Email Alert', 'Dispatched Email', 'email');
      await contextValue.addFeedItem('System Scoring', 'Evaluation done', 'system', 'RFQ-2026-001', 'Apex', 'system');
      await contextValue.addFeedItem('Plain Feed', 'Message only', 'system');
    });
    expect(contextValue.auditLogs.some((l: any) => l.action.includes('Custom administrative policy update'))).toBe(true);
    expect(contextValue.auditLogs.some((l: any) => l.action === 'Userless log with admin role')).toBe(true);

    // 4. Toast Notifications
    act(() => {
      contextValue.showToast('Test Toast', 'Description toast', 'success');
      contextValue.showToast('Default Info Toast', 'Default info description');
    });
    expect(contextValue.toastMessage).toEqual({
      title: 'Default Info Toast',
      description: 'Default info description',
      type: 'info',
    });
    act(() => {
      contextValue.dismissToast();
    });
    expect(contextValue.toastMessage).toBeNull();

    // 5. Process Historical Purchase Data (1_year, 2_years, 3_years). This now
    // awaits the real POST /api/buyer-accounts/historical-data and returns
    // whatever importedCount the server reports (dedup happens server-side),
    // so each call needs its own mocked response.
    const mockIngestResponse = (importedCount: number, summary = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, importedCount, period: '1_year', totalVendors: importedCount, ...summary }),
    });

    await act(async () => {
      mockFetch.mockResolvedValueOnce(mockIngestResponse(1, {
        mappedCount: 1,
        mappedEmailsSent: 0,
        mappedEmailsQueued: 1,
        unmappedCount: 0,
        unmappedEmailsSent: 0,
        unmappedEmailsQueued: 0,
      }));
      const processedCount1 = await contextValue.processHistoricalPurchaseData('1_year', [
        {
          id: 'h-0',
          companyName: 'One Year Vendor Ltd',
          contactPerson: 'Rohan Sen',
          email: 'rohan@oneyear.in',
          phone: '+91 98888 00000',
          address: 'Chennai',
          gstNumber: '33AAAAA1234A1Z1',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Pipes'],
          vendorRatingScore: 85,
          firstSetMajorCategory: 'Raw Materials',
          secondSetMinorCategories: ['Steel Pipes'],
        },
      ]);
      expect(processedCount1).toBe(1);

      mockFetch.mockResolvedValueOnce(mockIngestResponse(2));
      const processedCount2 = await contextValue.processHistoricalPurchaseData('2_years', [
        {
          id: 'h-1',
          companyName: 'Historical Steel Dynamics Ltd',
          contactPerson: 'Sanjay Gupta',
          email: 'sanjay@steel.in',
          phone: '+91 98888 11111',
          address: 'Mumbai, Maharashtra',
          gstNumber: '27AAAAA1234A1Z5',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Steel Plates'],
          vendorRatingScore: 75,
          firstSetMajorCategory: 'Raw Materials',
          secondSetMinorCategories: ['Steel Plates'],
        },
        {
          id: 'h-2',
          companyName: 'Uncategorized Vendor Ltd',
          contactPerson: 'Arun Varma',
          email: 'arun@uncat.in',
          phone: '+91 98888 22222',
          address: 'Delhi',
          gstNumber: '07AAAAA1234A1Z6',
          hasPoHistory: false,
          categoriesMappedByBuyer: false,
          itemsSupplied: [],
          firstSetMajorCategory: '',
          secondSetMinorCategories: [],
        },
      ]);
      expect(processedCount2).toBe(2);

      // Process 3_years with unmapped categories.
      mockFetch.mockResolvedValueOnce(mockIngestResponse(1, {
        mappedCount: 1,
        mappedEmailsSent: 0,
        mappedEmailsQueued: 1,
        unmappedCount: 0,
        unmappedEmailsSent: 0,
        unmappedEmailsQueued: 0,
      }));
      const processedCount3 = await contextValue.processHistoricalPurchaseData('3_years', [
        {
          id: 'h-3',
          companyName: 'Three Year Vendor Ltd',
          contactPerson: '',
          email: 'three@vendor.in',
          phone: '+91 98888 33333',
          address: 'Kolkata',
          gstNumber: '19AAAAA1234A1Z7',
          hasPoHistory: true,
          categoriesMappedByBuyer: true,
          itemsSupplied: ['Valves'],
          vendorRatingScore: undefined,
          firstSetMajorCategory: '',
          secondSetMinorCategories: [],
        },
      ]);
      expect(processedCount3).toBe(1);
    });
    expect(contextValue.lastIngestionSummary).toMatchObject({
      mappedEmailsSent: 0,
      mappedEmailsQueued: 1,
      unmappedEmailsQueued: 0,
    });

    // Failure paths: the caller must learn the import did NOT happen, whether
    // the request itself failed or the server reported success:false.
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, error: 'Server error' }) });
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Rejected' }) });
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });

    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      const processedCount = await contextValue.processHistoricalPurchaseData('1_year', []);
      expect(processedCount).toBe(0);
    });
  });


  // A failed RFQ save used to be swallowed by an unawaited POST, leaving the RFQ on
  // screen as though it had been dispatched while the database held nothing. It now
  // rejects and adds nothing.
  it('rejects an RFQ save failure instead of showing an RFQ the database does not hold', async () => {
    mockFetch.mockRejectedValue(new Error('Background write failed'));
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div data-testid="count">{contextValue.rfqs.length}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(contextValue.isLoadingDB).toBe(false));

    const before = contextValue.rfqs.length;

    await expect(
      contextValue.addNewRFQ({
        title: 'RFQ DB Fail',
        category: 'Mechanical',
        targetDeliveryDate: '2026-10-15',
        sourcingMode: 'mode_1',
        budget: 100000,
        extractedEntities: [],
      })
    ).rejects.toThrow();

    expect(contextValue.rfqs.length).toBe(before);
  });

  it('handles background DB write rejections cleanly without unhandled exceptions', async () => {
    mockFetch.mockRejectedValue(new Error('Background write failed'));
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(contextValue.isLoadingDB).toBe(false);
    });

    // Every request rejects. Each write must settle with its failure value and must not throw out of the act.
    await act(async () => {
      expect(await contextValue.addBuyerAccount({
        organizationName: 'Async Error Corp',
        industry: 'Testing',
        corporateEmail: 'err@procucev.com',
        contactPerson: 'Tester',
        phone: '+91 99999 99999',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
        accountSource: 'direct_enterprise_signup',
      })).toBeNull();
      contextValue.updateBuyerAccount('buyer-acc-1', { industry: 'Heavy Testing' });
      expect(await contextValue.deleteBuyerAccount('buyer-acc-1')).toBe(false);
      expect(await contextValue.reviseVendorRating('v-1', 85, 85, 85, 'Revision DB failure')).toBeNull();
      await contextValue.addAuditLog('Action with rejected DB');
      await contextValue.addFeedItem('Feed with rejected DB', 'msg', 'system');
      const evalSaved = await contextValue.addVendorEvaluation({
        id: 'eval-err',
        vendorId: 'v-err',
        vendorName: 'Error Vendor',
        contactPerson: 'Tester',
        email: 'err@vendor.com',
        phone: '+91 99999 99999',
        category: 'Test',
        submissionDate: '2026-08-29',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        overallScore: 80,
        systemAction: 'None',
        moduleScores: {
          commercial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          technical: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          quality: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          delivery: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          financial: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
          governance: { score: 20, weightedScore: 20, maxScore: 25, weight: 25, remarks: '' },
        },
        documents: [],
      });
      expect(evalSaved).toBe(false);
    });
  });

  it('resolves activeBuyerAccount from the real identity-schema endpoint on session change, with no fallback on failure', async () => {
    // The signed-in buyer's account is resolved via GET /api/buyer-accounts/active
    // (buyerAccountResolver on the backend) rather than matching session email
    // against the bootstrap-hydrated buyerAccounts array — that match was never
    // reliable since the shared identity schema has no unique index on email.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'buyer-acc-99', organizationName: 'Session Matched Org', corporateEmail: 'pub@procucev.com' },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });

    authClient.setSession(
      { id: 'u-1', email: 'pub@procucev.com', name: 'Test User', role: 'buyer', orgId: 'org-1', orgName: 'Test Org' },
      'test-token'
    );

    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('buyer-acc-99'));

    // A failed lookup clears it rather than falling back to any previous or
    // fabricated value — showing another organisation's account is the bug
    // this design replaced.
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: false, error: 'not linked' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    authClient.setSession(
      { id: 'u-2', email: 'other@procucev.com', name: 'Other User', role: 'buyer', orgId: 'org-2', orgName: 'Other Org' },
      'other-token'
    );
    await act(async () => {
      await contextValue.setCurrentUserSession({ id: 'u-2', email: 'other@procucev.com', name: 'Other User', role: 'buyer', orgId: 'org-2', orgName: 'Other Org' });
    });

    await waitFor(() => expect(contextValue.activeBuyerAccount).toBeNull());
    expect(logger.getLogs({ category: 'BUYER_ACCOUNT' }).some((entry) =>
      entry.message === 'Active buyer account lookup returned no linked account'
    )).toBe(true);
    authClient.setSession(null);
  });

  it('logs active buyer account HTTP, parsing, and transport failures', async () => {
    authClient.setSession(
      { id: 'account-error-user', email: 'buyer@procucev.com', name: 'Test User', role: 'buyer', orgId: 'org-1', orgName: 'Test Org' },
      'account-error-token'
    );
    const account = { id: 'account-error-1', organizationName: 'Account Error Org' };
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: account }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });

    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('account-error-1'));

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    await act(async () => contextValue.refreshActiveBuyerAccount());
    expect(contextValue.activeBuyerAccount).toBeNull();
    expect(logger.getLogs({ category: 'BUYER_ACCOUNT' }).some((entry) =>
      entry.message === 'Active buyer account lookup failed' && entry.metadata?.status === 503
    )).toBe(true);

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => { throw new SyntaxError('invalid JSON'); } });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    await act(async () => contextValue.refreshActiveBuyerAccount());
    expect(logger.getLogs({ category: 'BUYER_ACCOUNT' }).some((entry) =>
      entry.message === 'Active buyer account refresh failed' && entry.metadata?.error instanceof SyntaxError
    )).toBe(true);

    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        return Promise.reject(new TypeError('network unavailable'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });
    await act(async () => contextValue.refreshActiveBuyerAccount());
    expect(logger.getLogs({ category: 'BUYER_ACCOUNT' }).some((entry) =>
      entry.message === 'Active buyer account refresh failed' && entry.metadata?.error instanceof TypeError
    )).toBe(true);
    authClient.setSession(null);
  });

  it('ignores a delayed active account response after the signed-in user changes', async () => {
    const firstUser: UserSession = { id: 'first-user', email: 'first@procucev.com', name: 'First User', role: 'buyer', orgId: 'org-1', orgName: 'First Org' };
    const secondUser: UserSession = { id: 'second-user', email: 'second@procucev.com', name: 'Second User', role: 'buyer', orgId: 'org-2', orgName: 'Second Org' };
    const firstAccount = { id: 'first-account', organizationName: 'First Org' };
    const secondAccount = { id: 'second-account', organizationName: 'Second Org' };
    authClient.setSession(firstUser, 'first-token');
    let holdNextLookup = false;
    let releaseHeldLookup: ((response: Response) => void) | null = null;
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/buyer-accounts/active')) {
        if (holdNextLookup) {
          holdNextLookup = false;
          return new Promise<Response>((resolve) => {
            releaseHeldLookup = resolve;
          });
        }
        const data = authClient.getToken() === 'second-token' ? secondAccount : firstAccount;
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, data: {} }) });
    });

    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>Test</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('first-account'));

    holdNextLookup = true;
    const previousUserRequest = contextValue.refreshActiveBuyerAccount();
    await waitFor(() => expect(releaseHeldLookup).toBeInstanceOf(Function));
    await act(async () => {
      authClient.setSession(secondUser, 'second-token');
      contextValue.setCurrentUserSession(secondUser);
    });
    await waitFor(() => expect(contextValue.activeBuyerAccount?.id).toBe('second-account'));

    await act(async () => {
      releaseHeldLookup?.({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ success: true, data: firstAccount }),
      } as Response);
      await previousUserRequest;
    });
    expect(contextValue.activeBuyerAccount?.id).toBe('second-account');
    authClient.setSession(null);
  });

  it('handles error gracefully when refreshFromDB fetch fails or returns false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false }),
    });
    let contextValue: any;
    const Consumer = () => {
      contextValue = useApp();
      return <div>DB: {contextValue.dbConnected ? 'ok' : 'failed'}</div>;
    };

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );

    await waitFor(() => {
      expect(contextValue.isLoadingDB).toBe(false);
    });
    expect(contextValue.dbConnected).toBe(false);
  });
});

// ==============================================================================
// EDITING, ADOPTING AND DELETING AN RFQ
// ==============================================================================
// All three only touch local state once the API has confirmed. The alternative —
// patching state from the request and hoping the two agree — is the failure the
// RFQ create path already had: the browser and the database ended up holding
// different records for the same RFQ.
// ==============================================================================

describe('lib/store.tsx - RFQ edit and delete', () => {
  // Given an explicit rfqNumber. The shared fixture above has none, and every
  // assertion here turns on matching that number — without one the store would be
  // comparing undefined to undefined and the tests would pass regardless.
  const STORED = {
    ...(STORE_RFQ_FIXTURES[0] as unknown as RFQItem),
    id: 'rfq-1',
    rfqNumber: 'RFQ260409000512',
  } as RFQItem;

  /**
   * Serve the RFQ list, then answer PUT and DELETE however the test asks.
   * The list is served first so the store has a row to act on.
   */
  function serveRFQs(
    handlers: {
      put?: (body: unknown) => { status: number; body: unknown };
      del?: () => { status: number; body: unknown };
      /** The free-tier balance the server holds for the signed-in buyer's account. */
      balance?: { remaining: number };
    } = {}
  ) {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const isRfqEndpoint = typeof url === 'string' && /\/api\/rfqs/.test(url);

      if (isRfqEndpoint && init?.method === 'PUT') {
        const answer = handlers.put
          ? handlers.put(JSON.parse(init.body || '{}'))
          : { status: 200, body: { success: true, data: { ...STORED, title: 'Revised title' } } };
        return Promise.resolve({
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.body,
        });
      }

      if (isRfqEndpoint && init?.method === 'DELETE') {
        const answer = handlers.del
          ? handlers.del()
          : { status: 200, body: { success: true, data: { rfqNumber: STORED.rfqNumber } } };
        return Promise.resolve({
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: async () => answer.body,
        });
      }

      // The signed-in buyer's account, with the free-tier balance the server holds for it.
      if (url === '/api/buyer-accounts/active') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              id: 'buyer-acc-1',
              organizationName: 'Test Buyer Org',
              sourcingMode: 'mode_1',
              subscriptionPlan: 'free_trial',
              remainingFreeRFQs: handlers.balance?.remaining ?? 5,
            },
          }),
        });
      }

      // The audit route stores the entry and returns it, so the store adds the stored copy.
      if (url === '/api/audit' && init?.method === 'POST') {
        const sent = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              id: 'audit-test',
              timestamp: '2026-09-04 10:00:00 UTC',
              userEmail: 'buyer@procucev.com',
              action: sent.action,
              rfqNumber: sent.rfqNumber ?? null,
              shaSignature: 'sha-test',
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          /\/api\/rfqs(\?|$)/.test(String(url))
            ? { success: true, data: [STORED] }
            : { success: true, data: {} },
      });
    });
  }

  /** Mount the provider and wait for the RFQ list to arrive. */
  async function mountStore() {
    // refreshRFQs clears the list (and never calls fetchRFQList) when there is
    // no token, so a session must exist before mounting.
    authClient.setSession(
      { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
      'test-session-token'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any;
    const Consumer = () => {
      ctx = useApp();
      return <div data-testid="rfq-count">{ctx.rfqs.length}</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByTestId('rfq-count')).toHaveTextContent('1'));
    return () => ctx;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateRFQ', () => {
    it('adopts the record the API stored, not the change that was sent', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          // Deliberately different from what the caller sent: the response wins.
          body: { success: true, data: { ...STORED, title: 'What the database holds' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'What the caller sent' });
      });

      expect(ctx().rfqs[0].title).toBe('What the database holds');
    });

    it('sends only the fields it was given', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { status: 'In Evaluation' });
      });

      const put = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
      expect(JSON.parse(put?.[1].body)).toEqual({ status: 'In Evaluation' });
    });

    it('reports the edit on screen and in the audit log', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' });
      });

      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.savedTitle);
      await waitFor(() => expect(ctx().auditLogs[0].action).toContain('Edited'));
    });

    it('keeps the vendor opportunity for that RFQ in step', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          body: { success: true, data: { ...STORED, title: 'Renamed for vendors' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Renamed for vendors' });
      });

      const opp = ctx().vendorOpportunities.find(
        (o: { rfqNumber: string }) => o.rfqNumber === STORED.rfqNumber
      );
      expect(opp.title).toBe('Renamed for vendors');
    });

    // A screen already holding this RFQ would otherwise show the pre-edit terms.
    it('refreshes a selection pointing at the edited RFQ', async () => {
      serveRFQs({
        put: () => ({
          status: 200,
          body: { success: true, data: { ...STORED, title: 'Refreshed selection' } },
        }),
      });
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(STORED);
        ctx().openRFQDeepDive(STORED);
      });
      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Refreshed selection' });
      });

      expect(ctx().selectedRFQForMatrix.title).toBe('Refreshed selection');
      expect(ctx().selectedRFQForDeepDive.title).toBe('Refreshed selection');
    });

    it('leaves an unrelated selection alone', async () => {
      serveRFQs();
      const other = { ...STORED, id: 'other', rfqNumber: 'RFQ-OTHER' } as RFQItem;
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(other);
      });
      await act(async () => {
        await ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' });
      });

      expect(ctx().selectedRFQForMatrix.rfqNumber).toBe('RFQ-OTHER');
    });

    // A rejected edit must not leave the dashboard showing a change the database
    // does not hold.
    it('throws and changes nothing when the API rejects the edit', async () => {
      serveRFQs({ put: () => ({ status: 500, body: { error: 'Database unavailable.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().updateRFQ(STORED.rfqNumber, { title: 'Revised title' })).rejects.toThrow(
          'Database unavailable.'
        );
      });

      expect(ctx().rfqs[0].title).toBe(STORED.title);
      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.saveFailedTitle);
    });

    it('throws when the RFQ belongs to another organisation', async () => {
      serveRFQs({ put: () => ({ status: 404, body: { error: 'Not found under your organisation.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().updateRFQ('RFQ-SOMEONE-ELSE', { title: 'Rewritten' })).rejects.toThrow(
          'Not found under your organisation.'
        );
      });

      expect(ctx().rfqs).toHaveLength(1);
    });
  });

  describe('deleteRFQ', () => {
    it('drops the RFQ from every list once the API confirms', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().rfqs).toHaveLength(0);
      expect(
        ctx().vendorOpportunities.some((o: { rfqNumber: string }) => o.rfqNumber === STORED.rfqNumber)
      ).toBe(false);
    });

    it('reports the deletion on screen and in the audit log', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.deletedTitle);
      await waitFor(() => expect(ctx().auditLogs[0].action).toContain('Deleted'));
    });

    // A selection pointing at a deleted record would render a stale RFQ.
    it('clears a selection pointing at the deleted RFQ', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(STORED);
        ctx().openRFQDeepDive(STORED);
      });
      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().selectedRFQForMatrix).toBeNull();
      expect(ctx().selectedRFQForDeepDive).toBeNull();
    });

    it('leaves an unrelated selection alone', async () => {
      serveRFQs();
      const other = { ...STORED, id: 'other', rfqNumber: 'RFQ-OTHER' } as RFQItem;
      const ctx = await mountStore();

      await act(async () => {
        ctx().setSelectedRFQForMatrix(other);
      });
      await act(async () => {
        await ctx().deleteRFQ(STORED.rfqNumber);
      });

      expect(ctx().selectedRFQForMatrix.rfqNumber).toBe('RFQ-OTHER');
    });

    // Removing the row anyway would hide a record the database still holds.
    it('throws and keeps the row when the API refuses', async () => {
      serveRFQs({ del: () => ({ status: 500, body: { error: 'Delete failed.' } }) });
      const ctx = await mountStore();

      await act(async () => {
        await expect(ctx().deleteRFQ(STORED.rfqNumber)).rejects.toThrow('Delete failed.');
      });

      expect(ctx().rfqs).toHaveLength(1);
      expect(ctx().toastMessage?.title).toBe(UI_STRINGS.rfqEdit.deleteFailedTitle);
    });

    // The API echoes the number it removed, which is what the store drops.
    it('drops the row the API named rather than the identifier it was given', async () => {
      serveRFQs({
        del: () => ({ status: 200, body: { success: true, data: { rfqNumber: STORED.rfqNumber } } }),
      });
      const ctx = await mountStore();

      // Addressed by row id; the response names the RFQ number.
      await act(async () => {
        await ctx().deleteRFQ('rfq-1');
      });

      expect(ctx().rfqs).toHaveLength(0);
    });
  });

  describe('adoptCreatedRFQ', () => {
    it('takes a server-created RFQ into state and logs it', async () => {
      serveRFQs();
      const ctx = await mountStore();
      const created = { ...STORED, id: '99', rfqNumber: 'RFQ260409000099' } as RFQItem;

      await act(async () => {
        ctx().adoptCreatedRFQ(created);
      });

      expect(ctx().rfqs[0].rfqNumber).toBe('RFQ260409000099');
      await waitFor(() => expect(ctx().auditLogs[0].action).toContain('Created'));
    });

    // A concurrent refresh must not leave two copies of one RFQ.
    it('replaces an existing entry with the same number', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await act(async () => {
        ctx().adoptCreatedRFQ({ ...STORED, title: 'Adopted again' } as RFQItem);
      });

      expect(ctx().rfqs).toHaveLength(1);
      expect(ctx().rfqs[0].title).toBe('Adopted again');
    });

    it('does not decrement the free balance locally, whatever the sourcing mode', async () => {
      serveRFQs();
      const ctx = await mountStore();

      await waitFor(() => expect(ctx().remainingFreeRFQs).toBe(5));

      // The balance comes from the server. Adopting an RFQ leaves the count where the server put it.
      const rfq1 = { ...STORED, id: '101', rfqNumber: 'RFQ260409000101', sourcingMode: 'mode_3' } as RFQItem;
      await act(async () => {
        ctx().adoptCreatedRFQ(rfq1);
      });
      expect(ctx().remainingFreeRFQs).toBe(5);

      const rfqV0 = { ...STORED, id: '103', rfqNumber: 'RFQ260409000103', sourcingMode: 'mode_0' } as RFQItem;
      await act(async () => {
        ctx().adoptCreatedRFQ(rfqV0);
      });
      expect(ctx().remainingFreeRFQs).toBe(5);
      expect(ctx().rfqs.map((r: RFQItem) => r.rfqNumber)).toEqual(
        expect.arrayContaining(['RFQ260409000101', 'RFQ260409000103'])
      );
    });

    it('adopts the balance the server reports with the created RFQ', async () => {
      const balance = { remaining: 5 };
      serveRFQs({ balance });
      const ctx = await mountStore();
      await waitFor(() => expect(ctx().remainingFreeRFQs).toBe(5));

      // The server stores the new balance with the RFQ, so a later account read returns the same figure.
      balance.remaining = 1;
      const rfqServer = { ...STORED, id: '104', rfqNumber: 'RFQ260409000104', sourcingMode: 'mode_1' } as RFQItem;
      await act(async () => {
        ctx().adoptCreatedRFQ(rfqServer, 1);
      });
      expect(ctx().remainingFreeRFQs).toBe(1);
      await waitFor(() => expect(ctx().activeBuyerAccount?.remainingFreeRFQs).toBe(1));
    });

    it('ignores a balance embedded in the RFQ record and keeps the server-loaded count', async () => {
      serveRFQs();
      const ctx = await mountStore();
      await waitFor(() => expect(ctx().remainingFreeRFQs).toBe(5));
      const rfqWithEmbeddedBalance = {
        ...STORED,
        id: '105',
        rfqNumber: 'RFQ260409000105',
        sourcingMode: 'mode_1',
        remainingFreeRFQs: 2,
      } as RFQItem;

      await act(async () => {
        ctx().adoptCreatedRFQ(rfqWithEmbeddedBalance);
      });

      expect(ctx().remainingFreeRFQs).toBe(5);
    });
  });
});

// ==============================================================================
// MULTI-CHANNEL CHASER TELEMETRY
// ==============================================================================
// These branches only run for an RFQ that carries followUpData. The persisted
// mapper does not return that field, so they are unreachable through the API path
// today — but the chaser screens still read them, and an RFQ that does carry the
// block has to be updated correctly rather than silently ignored.
// ==============================================================================

describe('lib/store.tsx - channel chasers and bids', () => {
  const VENDOR = 'Apex Supplies Ltd.';
  const OTHER_VENDOR = 'Global Valve Systems Ltd';

  /** An RFQ with outreach telemetry, which is what these paths act on. */
  const withTelemetry = () =>
    ({
      ...(STORE_RFQ_FIXTURES[0] as unknown as RFQItem),
      id: 'rfq-chase',
      rfqNumber: 'RFQ260409000900',
    }) as RFQItem;

  function serve(rfq: RFQItem) {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          /\/api\/rfqs(\?|$)/.test(String(url))
            ? { success: true, data: [rfq] }
            : { success: true, data: {} },
      })
    );
  }

  async function mountStore(rfq: RFQItem = withTelemetry()) {
    // refreshRFQs clears the list (and never calls fetchRFQList) when there is
    // no token, so a session must exist before mounting for the fixture below
    // to actually be fetched and hydrated.
    authClient.setSession(
      { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
      'test-session-token'
    );
    serve(rfq);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ctx: any;
    const Consumer = () => {
      ctx = useApp();
      return <div data-testid="rfq-count">{ctx.rfqs.length}</div>;
    };
    render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    );
    await waitFor(() => expect(screen.getByTestId('rfq-count')).toHaveTextContent('1'));
    return () => ctx;
  }

  /** The telemetry record for one vendor on the first RFQ. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendorRecord = (ctx: () => any, name = VENDOR) =>
    ctx().rfqs[0].followUpData.vendors.find(
      (v: { vendorName: string }) => v.vendorName === name
    );

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('triggerChannelChaser', () => {
    // The server has no per-vendor chaser route, so a single-vendor chase is never sent. The record stays as it was.
    it.each(['call', 'whatsapp', 'sms', 'email'] as const)('sends nothing and leaves the record unchanged for a %s chase on one vendor', async (channel) => {
      const ctx = await mountStore();
      const before = JSON.stringify(vendorRecord(ctx));
      let sent: boolean | undefined;

      await act(async () => {
        sent = await ctx().triggerChannelChaser('RFQ260409000900', channel, VENDOR);
      });

      expect(sent).toBe(false);
      expect(JSON.stringify(vendorRecord(ctx))).toBe(before);
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/batch-chaser'))).toBe(false);
    });

    // Only the vendor being chased is touched; the rest of the roster is left as it was.
    it('leaves the other vendors untouched', async () => {
      const ctx = await mountStore();
      const before = vendorRecord(ctx, OTHER_VENDOR).attemptsCount;

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      expect(vendorRecord(ctx, OTHER_VENDOR).attemptsCount).toBe(before);
    });

    // Matched loosely in both directions, so 'Apex' finds 'Apex Supplies Ltd.'
    it('matches a vendor named only in part', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'sms', 'Apex');
      });

      expect(vendorRecord(ctx).sms.status).toBe('delivered');
    });

    it('leaves the channel totals unchanged, because no single-vendor chase is sent', async () => {
      const ctx = await mountStore();
      const before = ctx().rfqs[0].followUpData.callStats.total;

      await act(async () => {
        expect(await ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR)).toBe(false);
      });

      expect(ctx().rfqs[0].followUpData.callStats.total).toBe(before);
    });

    it('reports that nothing was sent and writes no audit entry', async () => {
      const ctx = await mountStore();
      const auditBefore = ctx().auditLogs.length;

      await act(async () => {
        await ctx().triggerChannelChaser('RFQ260409000900', 'whatsapp', VENDOR);
      });

      expect(ctx().toastMessage?.title).toBe(STORE_MESSAGES.chaserNotSentTitle);
      expect(ctx().auditLogs.length).toBe(auditBefore);
    });

    it('accepts a custom note without recording an attempt', async () => {
      const ctx = await mountStore();
      const before = vendorRecord(ctx).attemptsCount;

      await act(async () => {
        expect(await ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR, 'Chasing the revised price', true)).toBe(false);
      });

      expect(vendorRecord(ctx).attemptsCount).toBe(before);
    });

    // An RFQ without telemetry has nothing to update, and must not throw.
    it('does nothing for an RFQ that carries no telemetry', async () => {
      const bare = { ...withTelemetry(), followUpData: undefined } as unknown as RFQItem;
      const ctx = await mountStore(bare);

      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      expect(ctx().rfqs[0].followUpData).toBeUndefined();
    });

    it('does nothing for an RFQ number it does not hold', async () => {
      const ctx = await mountStore();
      const before = vendorRecord(ctx).attemptsCount;

      await act(async () => {
        ctx().triggerChannelChaser('RFQ-NOT-HERE', 'call', VENDOR);
      });

      expect(vendorRecord(ctx).attemptsCount).toBe(before);
    });

    it('refreshes a deep-dive selection pointing at the chased RFQ', async () => {
      const ctx = await mountStore();

      await act(async () => {
        ctx().openRFQDeepDive(ctx().rfqs[0]);
      });
      await act(async () => {
        ctx().triggerChannelChaser('RFQ260409000900', 'call', VENDOR);
      });

      const selected = ctx().selectedRFQForDeepDive.followUpData.vendors.find(
        (v: { vendorName: string }) => v.vendorName === VENDOR
      );
      expect(selected.call.status).toBe('completed');
    });
  });

  describe('approvePO', () => {
    it('returns the server response for the approval and does not mark the RFQ as approved locally', async () => {
      const ctx = await mountStore();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, poNumber: 'PO-2026-001', issueDate: '2026-09-04', shaSignature: 'sha-po', lineItems: [] }),
      });
      let result: { success: boolean; poNumber?: string } | undefined;

      await act(async () => {
        result = await ctx().approvePO('RFQ260409000900', 'v-001', VENDOR, 250000, 'Approved');
      });

      expect(result?.success).toBe(true);
      expect(result?.poNumber).toBe('PO-2026-001');
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/approve-po'))).toBe(true);
    });
  });

  describe('updateBuyerVendor & deleteBuyerVendor', () => {
    it('updates a buyer vendor and syncs to backend', async () => {
      const ctx = await mountStore();
      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/vendors' && init?.method === 'POST') {
          const sent = JSON.parse(init.body || '{}');
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ success: true, data: { ...sent, id: 'v-store-1' } }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });
      let createdVendor: any = null;
      await act(async () => {
        createdVendor = await ctx().addBuyerVendor({
          name: 'Store Test Vendor',
          email: 'storetest@vendor.com',
          phone: '+91 9876543210',
          categories: ['Industrial Valves'],
          rating: 4.5,
          location: 'Mumbai',
        });
      });
      expect(createdVendor?.id).toBe('v-store-1');

      // The server confirms the update for the vendor it holds and refuses the unknown id.
      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === `/api/vendors/${createdVendor.id}` && init?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { ...createdVendor, name: 'Updated Store Vendor' } }),
          });
        }
        if (url === '/api/vendors/non-existent-vendor-id-999' && init?.method === 'PUT') {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ success: false, error: 'Vendor not found.' }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });

      await act(async () => {
        expect(await ctx().updateBuyerVendor(createdVendor.id, { name: 'Updated Store Vendor' })).toBe(true);
        expect(await ctx().updateBuyerVendor('non-existent-vendor-id-999', { name: 'Ignored' })).toBe(false);
      });
      expect(ctx().buyerVendors.find((v: { id: string }) => v.id === createdVendor.id)?.name).toBe('Updated Store Vendor');
      expect(ctx().buyerVendors.some((v: { name: string }) => v.name === 'Ignored')).toBe(false);

      await act(async () => {
        expect(await ctx().deleteBuyerVendor(createdVendor.id)).toBe(true);
      });
      expect(ctx().buyerVendors.find((v: { id: string }) => v.id === createdVendor.id)).toBeUndefined();
    });

    it('handles deleteMultipleBuyerVendors with bulk-delete API and empty input', async () => {
      const ctx = await mountStore();
      // The server allocates each vendor id on create and reports the ids it deleted at the top level of its response.
      let vendorSequence = 0;
      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/vendors' && init?.method === 'POST') {
          vendorSequence += 1;
          const sent = JSON.parse(init.body || '{}');
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ success: true, data: { ...sent, id: `v-multi-${vendorSequence}` } }),
          });
        }
        if (url === '/api/vendors/bulk-delete' && init?.method === 'POST') {
          const sent = JSON.parse(init.body || '{}');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, deletedIds: sent.vendorIds, skippedIds: [] }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });

      let v1: any;
      let v2: any;
      await act(async () => {
        v1 = await ctx().addBuyerVendor({
          name: 'Multi Del Vendor 1',
          majorCategory: 'Mechanical',
          email: 'multi1@vendor.com',
        } as any);
        v2 = await ctx().addBuyerVendor({
          name: 'Multi Del Vendor 2',
          majorCategory: 'Electrical',
          email: 'multi2@vendor.com',
        } as any);
      });

      expect(ctx().buyerVendors.some((v: any) => v.id === v1.id)).toBe(true);
      expect(ctx().buyerVendors.some((v: any) => v.id === v2.id)).toBe(true);

      // Empty input sends no request.
      await act(async () => {
        await ctx().deleteMultipleBuyerVendors([]);
      });
      expect(mockFetch.mock.calls.some(([url]) => url === '/api/vendors/bulk-delete')).toBe(false);

      await act(async () => {
        await ctx().deleteMultipleBuyerVendors([v1.id, v2.id]);
      });

      expect(mockFetch.mock.calls.filter(([url]) => url === '/api/vendors/bulk-delete')).toHaveLength(1);
      expect(ctx().buyerVendors.some((v: any) => v.id === v1.id)).toBe(false);
      expect(ctx().buyerVendors.some((v: any) => v.id === v2.id)).toBe(false);
    });

    it('keeps every vendor and logs the failure when bulk deletion is refused', async () => {
      const ctx = await mountStore();
      const countBefore = ctx().buyerVendors.length;
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/vendors/bulk-delete') {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Unavailable',
            json: async () => ({ success: false, error: 'Vendor store unavailable' }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });

      await act(async () => {
        await ctx().deleteMultipleBuyerVendors(['vendor-delete-rejected', 'vendor-delete-unsuccessful']);
      });

      // No per-vendor fallback is attempted, and no row leaves the list.
      expect(mockFetch.mock.calls.some(([url]) => url === '/api/vendors/vendor-delete-rejected')).toBe(false);
      expect(ctx().buyerVendors.length).toBe(countBefore);
      expect(ctx().toastMessage?.title).toBe(STORE_MESSAGES.vendorDeleteFailedTitle);
      expect(logger.getLogs({ level: 'ERROR', category: 'VENDOR_PROFILE' })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Bulk vendor deletion request failed',
            metadata: expect.objectContaining({ status: 503, requestedCount: 2 }),
          }),
        ])
      );
    });

    it('handles addBuyerVendor API error and network failure in update/delete', async () => {
      const ctx = await mountStore();

      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/vendors')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ success: false, error: 'Validation failed' }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        });
      });

      let failedVendorResult: any = 'not-null';
      await act(async () => {
        failedVendorResult = await ctx().addBuyerVendor({
          name: 'Fail Vendor',
          email: 'fail@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(failedVendorResult).toBeNull();

      // Network throw on addBuyerVendor
      mockFetch.mockRejectedValue(new Error('Network error on add'));
      let netErrResult: any = 'not-null';
      await act(async () => {
        netErrResult = await ctx().addBuyerVendor({
          name: 'Net Err Vendor',
          email: 'neterr@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(netErrResult).toBeNull();

      // res.json() parse failure on addBuyerVendor
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('JSON parse error')),
        })
      );
      let jsonErrResult: any = 'not-null';
      await act(async () => {
        jsonErrResult = await ctx().addBuyerVendor({
          name: 'Json Err Vendor',
          email: 'jsonerr@vendor.com',
          phone: '1234567890',
          categories: ['Valves'],
          rating: 4.0,
          location: 'Delhi',
        });
      });
      expect(jsonErrResult).toBeNull();

      // Network rejection on update & delete
      mockFetch.mockRejectedValue(new Error('Network error'));
      await act(async () => {
        ctx().updateBuyerVendor('v-net-err', { name: 'Net Err' });
        ctx().deleteBuyerVendor('v-net-err');
      });
    });

    it('exercises payment link methods for buyer and vendor', async () => {
      const ctx = await mountStore();

      // updateVendorSubscription when myVendor is missing
      const noVendorSubRes = await ctx().updateVendorSubscription('connect');
      expect(noVendorSubRes).toBe(false);

      // checkBuyerPaymentLinkStatus when activeBuyerAccount is null / present
      const nullBuyerLinkStatus = await ctx().checkBuyerPaymentLinkStatus('link-1');
      expect(nullBuyerLinkStatus).toBeNull();

      // checkVendorPaymentLinkStatus when myVendor is null
      const nullVendorLinkStatus = await ctx().checkVendorPaymentLinkStatus('link-1');
      expect(nullVendorLinkStatus).toBeNull();

      // createBuyerPaymentLink when activeBuyerAccount is missing
      let noBuyerPayResult: string | null = null;
      await act(async () => {
        noBuyerPayResult = await ctx().createBuyerPaymentLink('annual_pro');
      });
      expect(noBuyerPayResult).toBeNull();

      // Add a buyer account through the server and make it active, then read a payment-link status.
      const statusAccount = {
        id: 'buyer-pay-1',
        organizationName: 'Status Buyer',
        corporateEmail: 'status@buyer.com',
        industry: 'Industrial',
        contactPerson: 'Status Person',
        phone: '+91 9111111111',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
      };
      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/buyer-accounts' && init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 201, json: async () => ({ success: true, data: statusAccount }) });
        }
        if (url === '/api/buyer-accounts/buyer-pay-1/activate' && init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { activeAccountId: 'buyer-pay-1' } }) });
        }
        if (url === '/api/buyer-accounts/active') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: statusAccount }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });
      await act(async () => {
        await ctx().addBuyerAccount({
          organizationName: 'Status Buyer',
          corporateEmail: 'status@buyer.com',
          industry: 'Industrial',
          contactPerson: 'Status Person',
          phone: '+91 9111111111',
          sourcingMode: 'mode_1',
          subscriptionPlan: 'version_1',
          remainingFreeRFQs: 5,
        });
      });
      await act(async () => {
        expect(await ctx().alignActiveBuyerAccount('buyer-pay-1')).toBe(true);
      });
      await waitFor(() => expect(ctx().activeBuyerAccount?.id).toBe('buyer-pay-1'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [{ id: 'link-1', status: 'PAID' }] }),
      });
      const activeBuyerLinkStatus = await ctx().checkBuyerPaymentLinkStatus('link-1');
      expect(activeBuyerLinkStatus).toBe('PAID');

      // Toggle theme between dark and light
      act(() => {
        ctx().toggleTheme();
      });
      expect(ctx().theme).toBe('dark');
      act(() => {
        ctx().toggleTheme();
      });
      expect(ctx().theme).toBe('light');
    });

    it('handles successful and failed createBuyerPaymentLink requests when buyer account exists', async () => {
      const ctx = await mountStore();
      const payAccount = {
        id: 'buyer-pay-2',
        organizationName: 'Buyer Corp',
        corporateEmail: 'buyer@procucev.com',
        industry: 'Tech',
        contactPerson: 'Buyer Person',
        phone: '+91 9999999999',
        sourcingMode: 'mode_1',
        subscriptionPlan: 'version_1',
        remainingFreeRFQs: 5,
      };
      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/buyer-accounts' && init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 201, json: async () => ({ success: true, data: payAccount }) });
        }
        if (url === '/api/buyer-accounts/buyer-pay-2/activate' && init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: { activeAccountId: 'buyer-pay-2' } }) });
        }
        if (url === '/api/buyer-accounts/active') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: payAccount }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
      });
      await act(async () => {
        await ctx().addBuyerAccount({
          organizationName: 'Buyer Corp',
          corporateEmail: 'buyer@procucev.com',
          industry: 'Tech',
          contactPerson: 'Buyer Person',
          phone: '+91 9999999999',
          sourcingMode: 'mode_1',
          subscriptionPlan: 'version_1',
          remainingFreeRFQs: 5,
        });
      });
      await act(async () => {
        expect(await ctx().alignActiveBuyerAccount('buyer-pay-2')).toBe(true);
      });
      await waitFor(() => expect(ctx().activeBuyerAccount?.id).toBe('buyer-pay-2'));

      mockFetch.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        const urlStr = String(url);
        if (urlStr.includes('/subscription-payment')) {
          const body = JSON.parse(init?.body || '{}');
          if (body.plan === 'version_2') {
            return Promise.resolve({
              ok: false,
              status: 400,
              json: async () => ({ success: false, error: 'Payment gateway offline' }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { paymentUrl: 'https://pay.example.com/checkout' } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        });
      });

      let payUrl: string | null = null;
      await act(async () => {
        payUrl = await ctx().createBuyerPaymentLink('version_1');
      });
      expect(payUrl).toBe('https://pay.example.com/checkout');

      let failedPayUrl: string | null = null;
      await act(async () => {
        failedPayUrl = await ctx().createBuyerPaymentLink('version_2');
      });
      expect(failedPayUrl).toBeNull();
    });

    it('exercises vendor payment link and resolveVendorId flows', async () => {
      const ctx = await mountStore();

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/payment-links')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: [{ id: 'link-v-1', status: 'PAID' }] }),
          };
        }
        if (u.includes('/payment-link')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { paymentUrl: 'https://pay.zoho.com/vendor-checkout' } }),
          };
        }
        if (u.includes('/subscription')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { subscriptionPlan: 'connect', rfqDownloadsUsed: 0 } }),
          };
        }
        if (u.includes('/api/vendors')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'v-acme-1',
                name: 'Acme Supplies',
                email: 'buyer@procucev.com',
                phone: '+91 9888877777',
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
      });

      // 1. Add vendor to buyerVendors
      await act(async () => {
        await ctx().addBuyerVendor({
          name: 'Acme Supplies',
          email: 'buyer@procucev.com',
          phone: '+91 9888877777',
          majorCategory: 'Mechanical',
          minorCategories: [],
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500001',
          country: 'India',
          address: '123 Main St',
          gstin: '36AAAAA0000A1Z5',
          pan: 'AAAAA0000A',
          turnover: '10 - 50 Cr',
          status: 'PREFERRED ENTERPRISE',
          rating: 4.5,
          contactPerson: 'Acme Rep',
          contactDesignation: 'Manager',
        });
      });

      let vendorPayUrl: string | null = null;
      await act(async () => {
        vendorPayUrl = await ctx().createVendorPaymentLink('connect', '12_months');
      });
      expect(vendorPayUrl).toBe('https://pay.zoho.com/vendor-checkout');

      // 3. updateVendorSubscription with matching vendor
      let updateRes: boolean = false;
      await act(async () => {
        updateRes = await ctx().updateVendorSubscription('connect');
      });
      expect(updateRes).toBe(true);

      // 4. checkVendorPaymentLinkStatus
      mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ id: 'link-v-1', status: 'PAID' }] }),
      }));
      const linkStatus = await ctx().checkVendorPaymentLinkStatus('link-v-1');
      expect(linkStatus).toBe('PAID');

      // 5. checkVendorPaymentLinkStatus not found
      mockFetch.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [{ id: 'link-v-other', status: 'PAID' }] }),
      }));
      const missingLinkStatus = await ctx().checkVendorPaymentLinkStatus('link-v-1');
      expect(missingLinkStatus).toBeNull();

      // 6. HTTP failure & exception on createVendorPaymentLink
      mockFetch.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false }),
      }));
      const failedVendorPay = await ctx().createVendorPaymentLink('select');
      expect(failedVendorPay).toBeNull();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const netErrVendorPay = await ctx().createVendorPaymentLink('select');
      expect(netErrVendorPay).toBeNull();
    });
  });
});
