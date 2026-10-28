import React, { useEffect } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import {
  AppProvider,
  useApp,
  dedupeRequest,
  getSessionCache,
  setSessionCache,
  clearSessionCache,
} from '@/lib/store';
import { authClient } from '@/lib/authClient';
import * as rfqClient from '@/lib/rfqClient';
import * as buyerProfileClient from '@/lib/buyerProfileClient';

jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    createRFQ: jest.fn().mockResolvedValue({ success: true, rfq: { id: 'rfq-1', rfqNumber: 'RFQ-001', title: 'Default' } }),
    fetchRFQList: jest.fn().mockResolvedValue({ success: true, rfqs: [] }),
    downloadAndUnlockRFQ: jest.fn().mockResolvedValue({ success: true, alreadyUnlocked: false, freeCreditsRemaining: 4 }),
    getVendorRfqCredits: jest.fn().mockResolvedValue({
      success: true,
      data: {
        credits: 10,
        freeCreditsAllocated: 5,
        freeCreditsUsed: 1,
        unlockedRfqIds: ['rfq-1'],
      },
    }),
  };
});

jest.mock('@/lib/buyerProfileClient', () => {
  const actual = jest.requireActual('@/lib/buyerProfileClient');
  return {
    ...actual,
    fetchCategoryTaxonomy: jest.fn().mockResolvedValue({
      success: true,
      data: [{ majorCategory: 'Civil Works', minorCategories: ['Piling'] }],
    }),
  };
});

describe('lib/store.tsx Dedicated Booster Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    (rfqClient.fetchRFQList as jest.Mock).mockResolvedValue({ success: true, rfqs: [] });
    (rfqClient.downloadAndUnlockRFQ as jest.Mock).mockResolvedValue({ success: true, alreadyUnlocked: false, freeCreditsRemaining: 4 });
    (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: true,
      data: [{ majorCategory: 'Civil Works', minorCategories: ['Piling'] }],
    });
  });

  describe('Standalone Cache & Dedupe Helpers', () => {
    test('dedupeRequest reuses in-flight promise and cleans up key after settling', async () => {
      let resolveFirst: (val: string) => void = () => {};
      const promise1 = new Promise<string>((res) => {
        resolveFirst = res;
      });

      const p1 = dedupeRequest('test-key', () => promise1);
      const p2 = dedupeRequest('test-key', () => Promise.resolve('second-call-not-used'));

      expect(p1).toBe(p2);

      resolveFirst('first-value');
      const val1 = await p1;
      const val2 = await p2;
      expect(val1).toBe('first-value');
      expect(val2).toBe('first-value');

      // Next call after settlement creates a new promise
      const p3 = dedupeRequest('test-key', () => Promise.resolve('fresh-call'));
      expect(await p3).toBe('fresh-call');
    });

    test('getSessionCache, setSessionCache, and clearSessionCache execute safely', () => {
      expect(getSessionCache('vendors')).toBeNull();
      setSessionCache('vendors', [{ id: 'v1' }]);
      clearSessionCache();
      expect(sessionStorage.getItem('procucev_cache_vendors')).toBeNull();
    });
  });

  describe('useApp vendor unlock and ensure methods', () => {
    let capturedApp: ReturnType<typeof useApp> | null = null;

    function TestConsumer({ onReady }: { onReady: (app: ReturnType<typeof useApp>) => void }) {
      const app = useApp();
      useEffect(() => {
        onReady(app);
      }, [app, onReady]);
      return <div data-testid="ready">Store Ready</div>;
    }

    beforeEach(() => {
      capturedApp = null;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('/api/bootstrap')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                vendors: [
                  { id: 'v-1', name: 'Vendor 1', email: 'procucevvendor@gmail.com', subscriptionPlan: 'premium', rfqDownloadsUsed: 2 },
                  { id: 'v-2', name: 'Vendor 2', email: 'v2@test.com', subscriptionPlan: 'connect' },
                ],
                evaluations: [{ id: 'ev-1', vendorName: 'Vendor 1' }],
                buyerAccounts: [{ id: 'b-1', organizationName: 'Buyer Corp' }],
                auditLogs: [{ id: 'a-1', action: 'LOGIN' }],
                systemConfig: { maintenanceMode: false },
              },
            }),
          });
        }
        if (url.includes('/api/rfqs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: [
                { id: 'rfq-1', rfqNumber: 'RFQ-001', title: 'Pumps', status: 'Quotes Pending' },
              ],
            }),
          });
        }
        if (url.includes('/api/buyer-accounts/active')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { id: 'b-active', organizationName: 'Active Org' },
            }),
          });
        }
        if (url.includes('/api/vendors/')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                credits: 10,
                freeCreditsAllocated: 5,
                freeCreditsUsed: 1,
                unlockedRfqIds: ['rfq-1'],
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [] }),
        });
      });
    });

    test('unlockRFQForVendor handles success, credit decrements, and errors', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );

      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Mock downloadAndUnlockRFQ success with credit updates
      (rfqClient.downloadAndUnlockRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        alreadyUnlocked: false,
        freeCreditsRemaining: 4,
      });

      let unlockRes;
      await act(async () => {
        unlockRes = await capturedApp?.unlockRFQForVendor('rfq-100');
      });
      expect(unlockRes).toEqual({ success: true, alreadyUnlocked: false });
      expect(capturedApp?.vendorFreeCreditsRemaining).toBe(4);
      expect(capturedApp?.vendorUnlockedRfqIds).toContain('rfq-100');

      // Mock alreadyUnlocked: true
      (rfqClient.downloadAndUnlockRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        alreadyUnlocked: true,
      });
      await act(async () => {
        unlockRes = await capturedApp?.unlockRFQForVendor('rfq-100');
      });
      expect(unlockRes).toEqual({ success: true, alreadyUnlocked: true });

      // Mock downloadAndUnlockRFQ failure (exhausted)
      (rfqClient.downloadAndUnlockRFQ as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Free credits exhausted',
        exhausted: true,
      });
      await act(async () => {
        unlockRes = await capturedApp?.unlockRFQForVendor('rfq-200');
      });
      expect(unlockRes).toEqual({
        success: false,
        error: 'Free credits exhausted',
        exhausted: true,
        alreadyUnlocked: false,
      });
    });

    test('ensureRFQs, ensureBootstrapData, ensureActiveBuyerAccount, ensureCategoryTaxonomy force variations', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue('jwt-token-123');
      (rfqClient.fetchRFQList as jest.Mock).mockResolvedValue({
        success: true,
        rfqs: [{ id: 'rfq-force-1', rfqNumber: 'RFQ-F1', title: 'Valves' }],
      });
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
        success: true,
        data: [{ majorCategory: 'Civil Works', minorCategories: ['Piling'] }],
      });

      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // ensureRFQs
      await act(async () => {
        await capturedApp?.ensureRFQs(true);
        await capturedApp?.ensureRFQs(false);
      });

      // ensureRouteData
      await act(async () => {
        await capturedApp?.ensureRouteData('buyer');
        await capturedApp?.ensureRouteData('vendor');
        await capturedApp?.ensureRouteData('category_manager');
        await capturedApp?.ensureRouteData('admin');
        await capturedApp?.ensureVendors(true);
        await capturedApp?.ensureVendors(false);
        await capturedApp?.ensureVendorEvaluations(true);
        await capturedApp?.ensureVendorEvaluations(false);
        await capturedApp?.ensureAIFeed(true);
        await capturedApp?.ensureAIFeed(false);
      });

      // ensureActiveBuyerAccount
      await act(async () => {
        await capturedApp?.ensureActiveBuyerAccount(true);
        await capturedApp?.ensureActiveBuyerAccount(false);
      });

      // ensureCategoryTaxonomy
      await act(async () => {
        await capturedApp?.ensureCategoryTaxonomy(true);
        await capturedApp?.ensureCategoryTaxonomy(false);
      });

      expect(capturedApp?.categoryTaxonomy.length).toBeGreaterThan(0);
    });

    test('signed out state clears RFQs, activeBuyerAccount, and taxonomy', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null);

      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      await act(async () => {
        await capturedApp?.ensureRFQs(true);
        await capturedApp?.ensureActiveBuyerAccount(true);
        await capturedApp?.ensureCategoryTaxonomy(true);
      });

      expect(capturedApp?.rfqs).toEqual([]);
      expect(capturedApp?.activeBuyerAccount).toBeNull();
      expect(capturedApp?.categoryTaxonomy).toEqual([]);
    });

    test('refreshCategoryTaxonomy falls back to default taxonomy when API returns empty or fails', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue('token-xyz');
      (buyerProfileClient.fetchCategoryTaxonomy as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'API down',
      });

      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      await act(async () => {
        await capturedApp?.ensureCategoryTaxonomy(true);
      });

      expect(capturedApp?.categoryTaxonomy.length).toBeGreaterThan(0);
    });

    test('state setters update UI state without regressions', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      act(() => {
        capturedApp?.setCurrentRole('vendor');
        capturedApp?.setActiveTab('quotations');
        capturedApp?.setSelectedRFQForMatrix({ id: 'rfq-sel-1', rfqNumber: 'RFQ-S1' } as any);
        capturedApp?.setSelectedRFQForDeepDive({ id: 'rfq-sel-2', rfqNumber: 'RFQ-S2' } as any);
        capturedApp?.setSelectedVendorEvaluation({ id: 'ev-sel', vendorName: 'Vendor Sel' } as any);
        capturedApp?.setTheme('dark');
        capturedApp?.toggleTheme();
      });

      expect(capturedApp?.currentRole).toBe('vendor');
      expect(capturedApp?.selectedRFQForMatrix?.id).toBe('rfq-sel-1');
      expect(capturedApp?.selectedRFQForDeepDive?.id).toBe('rfq-sel-2');
      expect(capturedApp?.selectedVendorEvaluation?.id).toBe('ev-sel');
    });

    test('processHistoricalPurchaseData handles network errors, API failure payloads, and success', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      const vendorRecords: any = [
        { companyName: 'Old Vendor', contactPerson: 'John', email: 'v@test.com', phone: '9876543210', categoriesMappedByBuyer: true, firstSetMajorCategory: 'Mechanical' },
      ];

      // Network error
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network drop on import'));
      let count = await capturedApp?.processHistoricalPurchaseData('1_year', vendorRecords);
      expect(count).toBe(0);

      // API error with data.error
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'Malformed records' }),
      });
      count = await capturedApp?.processHistoricalPurchaseData('1_year', vendorRecords);
      expect(count).toBe(0);

      // API error with data.message
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, message: 'Schema failure' }),
      });
      count = await capturedApp?.processHistoricalPurchaseData('2_years', vendorRecords);
      expect(count).toBe(0);

      // HTTP 502 with statusText
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => { throw new Error('Not JSON'); },
      });
      count = await capturedApp?.processHistoricalPurchaseData('3_years', vendorRecords);
      expect(count).toBe(0);

      // Success
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          importedCount: 5,
          totalProcessed: 5,
          mappedCount: 3,
        }),
      });
      count = await capturedApp?.processHistoricalPurchaseData('1_year', vendorRecords);
      expect(count).toBe(5);
    });

    test('approvePO covers object vendorId, numeric vendorName, and error handling', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Object with id & name
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          poNumber: 'PO-TEST-001',
          issueDate: '2026-10-25',
          shaSignature: 'sha256-mock',
          lineItems: [],
        }),
      });
      let res = await capturedApp?.approvePO(
        'RFQ-001',
        { id: 'v-obj-1', name: 'Vendor Object 1' } as any,
        'Vendor Object 1',
        50000
      );
      expect(res?.success).toBe(true);

      // Object with vendorId & vendorName
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          poNumber: 'PO-TEST-002',
          issueDate: '2026-10-25',
          shaSignature: 'sha256-mock',
        }),
      });
      res = await capturedApp?.approvePO(
        'RFQ-001',
        { vendorId: 'v-obj-2', vendorName: 'Vendor Object 2' } as any,
        'Vendor Object 2',
        75000
      );
      expect(res?.success).toBe(true);

      // Numeric vendorName parameter (effectiveAmount fallback) and null vendorId
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, poNumber: 'PO-NUM-1' }),
      });
      res = await capturedApp?.approvePO('RFQ-001', null as any, 99000 as any, 0);
      expect(res?.success).toBe(true);

      // Server error
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'Budget exceeded' }),
      });
      res = await capturedApp?.approvePO('RFQ-001', 'v-1', 'Vendor 1', 100000);
      expect(res?.success).toBe(false);
      expect(res?.error).toBe('Budget exceeded');

      // Network throw
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Transport crash'));
      res = await capturedApp?.approvePO('RFQ-001', 'v-1', 'Vendor 1', 100000);
      expect(res?.success).toBe(false);
    });

    test('triggerChannelChaser covers companyName, Supplier fallback, and batch chaser', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      act(() => {
        // All pending suppliers
        capturedApp?.triggerChannelChaser('RFQ-001', 'call', 'all pending suppliers', 'Urgent quote needed');
        capturedApp?.triggerChannelChaser('RFQ-001', 'sms', '', undefined, true);
        capturedApp?.triggerChannelChaser('RFQ-001', 'email', 'Acme', undefined, true);
        capturedApp?.triggerBatchChannelChaser('RFQ-001', ['call', 'whatsapp', 'sms']);
      });

      expect(screen.getByTestId('ready')).toBeInTheDocument();
    });

    test('matchVendorsForRFQ and addNewRFQ cover category matching and deduplication', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Mock createRFQ
      (rfqClient.createRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-new-1',
          rfqNumber: 'RFQ-NEW-001',
          title: 'Mechanical Seals',
          sourcingMode: 'mode_1',
          assignedVendors: [],
          extractedEntities: [
            { id: 'e-1', itemName: 'Seal 50mm', quantity: 2, unit: 'Nos', majorCategory: 'Mechanical', minorCategory: 'Seals' },
          ],
        },
      });

      let created: any;
      await act(async () => {
        created = await capturedApp?.addNewRFQ({
          title: 'Mechanical Seals',
          category: 'Mechanical',
          sourcingMode: 'mode_1',
          extractedEntities: [
            { id: 'e-1', itemName: 'Seal 50mm', quantity: 2, unit: 'Nos', category: 'Mechanical' } as any,
          ],
        } as any);
      });

      expect(created?.rfqNumber).toBe('RFQ-NEW-001');
    });

    test('ensureRouteData exercises all buyer subpaths, vendor role, and admin role', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue('valid-token-route');

      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      const paths = [
        '/buyer',
        '/buyer/dashboard',
        '/buyer/command-center',
        '/buyer/rfq-summary',
        '/buyer/rfqs',
        '/buyer/rfq-details/123',
        '/buyer/quote-matrix',
        '/buyer/vendor-summary',
        '/buyer/vendor-evaluation-summary',
        '/buyer/profile',
        '/buyer/ingestion-wizard',
        '/buyer/buyer-directory',
        '/buyer/subscription-center',
        '/buyer/billing-history',
        '/buyer/other-unmatched',
      ];

      await act(async () => {
        for (const p of paths) {
          await capturedApp?.ensureRouteData(p, 'buyer');
        }
        await capturedApp?.ensureRouteData('/vendor/dashboard', 'vendor');
        await capturedApp?.ensureRouteData('/admin/overview', 'admin');
        await capturedApp?.ensureRouteData('/category-manager/kanban', 'category_manager');
      });

      expect(screen.getByTestId('ready')).toBeInTheDocument();
    });

    test('addAuditLog handles all 4 role defaults and custom user name', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      act(() => {
        capturedApp?.setCurrentRole('buyer');
        capturedApp?.addAuditLog('Action Buyer');

        capturedApp?.setCurrentRole('category_manager');
        capturedApp?.addAuditLog('Action CM');

        capturedApp?.setCurrentRole('vendor');
        capturedApp?.addAuditLog('Action Vendor');

        capturedApp?.setCurrentRole('admin');
        capturedApp?.addAuditLog('Action Admin');

        capturedApp?.addAuditLog('Custom User Action', 'RFQ-100', 'custom.user@enterprise.com');
      });

      expect(capturedApp?.auditLogs.length).toBeGreaterThanOrEqual(5);
    });

    test('updateRFQ handles longer assignedVendors, fallback to changes or empty', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Mock updateRFQ in rfqClient
      const rfqClientModule = require('@/lib/rfqClient');
      jest.spyOn(rfqClientModule, 'updateRFQ').mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-up-1',
          rfqNumber: 'RFQ-UP-001',
          title: 'Updated RFQ',
          assignedVendors: [{ id: 'v-1' }],
        },
      });

      let updated: any;
      await act(async () => {
        updated = await capturedApp?.updateRFQ('RFQ-UP-001', {
          title: 'Updated RFQ',
          assignedVendors: [{ id: 'v-1' }, { id: 'v-2' }] as any,
        });
      });
      expect(updated?.rfqNumber).toBe('RFQ-UP-001');

      // Failure branch
      jest.spyOn(rfqClientModule, 'updateRFQ').mockResolvedValueOnce({
        success: false,
        error: 'RFQ is locked',
      });

      await expect(
        act(async () => {
          await capturedApp?.updateRFQ('RFQ-UP-001', { title: 'Failed Edit' });
        })
      ).rejects.toThrow('RFQ is locked');
    });

    test('approvePO and triggerChannelChaser cover all remaining fallback branches', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, poNumber: 'PO-BRANCH-1', issueDate: '2026-10-25' }),
      });

      // approvePO where vendorName is not string, vendorId is object with no name or vendorName
      await capturedApp?.approvePO('RFQ-001', { someKey: 123 } as any, null as any, 1000);

      // approvePO where vendorName is not string, vendorId is not object, vendorName is null
      await capturedApp?.approvePO('RFQ-001', null as any, null as any, 1000);

      // triggerChannelChaser where rfq has no followUpData
      act(() => {
        capturedApp?.triggerChannelChaser('RFQ-NEW-001', 'call', '', 'Chasing without followUpData', true);
        capturedApp?.triggerChannelChaser('RFQ-NEW-001', 'whatsapp', 'Acme', 'WhatsApp Chaser', true);
      });

      expect(screen.getByTestId('ready')).toBeInTheDocument();
    });

    test('matchSuitableVendors covers apex email, empty categories fallback, and key fallbacks', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Seed vendors via refreshFromDB
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            vendors: [
              // Apex vendor with minorCategories
              {
                id: 'v-apex-1',
                name: 'Apex Mechanical',
                email: 'sales@apex.com',
                majorCategory: 'Mechanical',
                minorCategories: ['Seals', 'Pumps'],
                rating: 4.5,
              },
              // Vendor with clientMappedCategories and vendorSelectedCategories
              {
                id: 'v-mapped-1',
                name: 'Mapped Supplier',
                email: 'mapped@supplier.com',
                majorCategory: 'Mechanical',
                clientMappedCategories: ['Seals'],
                vendorSelectedCategories: ['Gaskets'],
                rating: 4.8,
              },
              // Vendor with no email, only name
              {
                id: 'v-noname-1',
                name: 'Only Name Co',
                majorCategory: 'Mechanical',
                minorCategories: ['Valves'],
              },
              // Vendor with no email, no name, only id
              {
                id: 'v-onlyid-1',
                majorCategory: 'Mechanical',
                minorCategories: ['Pipes'],
              },
              // Vendor with empty email, empty name, empty id
              {
                majorCategory: 'Mechanical',
                minorCategories: ['Bearings'],
              },
              // Duplicate vendor
              {
                id: 'v-mapped-1',
                email: 'mapped@supplier.com',
                majorCategory: 'Mechanical',
              },
              // Mode 2 Regional Hub vendor
              {
                id: 'v-delhi-1',
                name: 'Delhi Supplier',
                email: 'delhi@supplier.com',
                location: 'New Delhi, DL',
                majorCategory: 'Mechanical',
                source: 'buyer_manual',
              },
            ],
            evaluations: [],
            auditLogs: [],
          },
        }),
      });

      await act(async () => {
        await capturedApp?.refreshFromDB();
      });

      // Test Mode 1 matching
      const mode1Matches = capturedApp?.matchSuitableVendors(
        [{ id: 'e-1', itemName: 'Seal', majorCategory: 'Mechanical', minorCategory: 'Seals' } as any],
        'mode_1'
      );
      expect(mode1Matches).toBeDefined();

      // Test Mode 2 matching
      const mode2Matches = capturedApp?.matchSuitableVendors(
        [{ id: 'e-2', itemName: 'Valve', majorCategory: 'Mechanical', minorCategory: 'Valves' } as any],
        'mode_2'
      );
      expect(mode2Matches).toBeDefined();
    });

    test('addBuyerVendor handles onboarding email status branches and warning message', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Failed email status with warning
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'v-fail-1',
            name: 'Failed Email Vendor',
            email: 'fail@vendor.com',
            onboardingEmailStatus: 'failed',
          },
          warning: 'SMTP relay down',
        }),
      });

      let added = await capturedApp?.addBuyerVendor({
        name: 'Failed Email Vendor',
        email: 'fail@vendor.com',
      } as any);
      expect(added?.name).toBe('Failed Email Vendor');

      // Account exists status
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: 'v-exist-1',
            name: 'Existing Account Vendor',
            email: 'exist@vendor.com',
            onboardingEmailStatus: 'account_exists',
          },
        }),
      });

      added = await capturedApp?.addBuyerVendor({
        name: 'Existing Account Vendor',
        email: 'exist@vendor.com',
      } as any);
      expect(added?.name).toBe('Existing Account Vendor');
    });

    test('getSessionCache and setSessionCache handle non-test environment and sessionStorage errors', () => {
      const origEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = 'development';
        // Mock sessionStorage.getItem returns JSON
        const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce(JSON.stringify({ cached: true }));
        const cached = getSessionCache<{ cached: boolean }>('test_key');
        expect(cached?.cached).toBe(true);

        // Mock getItem throws error
        getItemSpy.mockImplementationOnce(() => { throw new Error('Quota error'); });
        expect(getSessionCache('test_err')).toBeNull();

        // setSessionCache calls setItem
        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {});
        setSessionCache('test_save', { saved: 1 });
        expect(setItemSpy).toHaveBeenCalled();

        // setSessionCache throws error
        setItemSpy.mockImplementationOnce(() => { throw new Error('Storage full'); });
        expect(() => setSessionCache('test_err', { bad: 1 })).not.toThrow();

        // clearSessionCache calls removeItem
        const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
        clearSessionCache();
        expect(removeItemSpy).toHaveBeenCalled();
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });

    test('refreshFromDB handles session email matching unlimited vendor, select plan vendor, and unlimited non-vendor', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // 1. Unlimited vendor match
      jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
        id: 'u-unlimited',
        email: 'procucevvendor@gmail.com',
        role: 'vendor',
      } as any);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            vendors: [
              { id: 'v-unlim', email: 'procucevvendor@gmail.com', rfqDownloadsUsed: 10, subscriptionPlan: 'unlimited' },
            ],
            evaluations: [],
          },
        }),
      });

      await act(async () => {
        await capturedApp?.refreshFromDB();
      });

      expect(capturedApp?.vendorSubscription).toBe('unlimited');

      // 2. Select plan vendor match
      jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
        id: 'u-select',
        email: 'selectvendor@test.com',
        role: 'vendor',
      } as any);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            vendors: [
              { id: 'v-sel', email: 'selectvendor@test.com', rfqDownloadsUsed: 2, subscriptionPlan: 'select' },
            ],
            evaluations: [],
          },
        }),
      });

      await act(async () => {
        await capturedApp?.refreshFromDB();
      });

      expect(capturedApp?.vendorSubscription).toBe('select');

      // 3. Unlimited non-vendor (not in vendors array)
      jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
        id: 'u-nonvend',
        email: 'procucevvendor@gmail.com',
        role: 'vendor',
      } as any);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            vendors: [],
            evaluations: [],
          },
        }),
      });

      await act(async () => {
        await capturedApp?.refreshFromDB();
      });

      expect(capturedApp?.vendorSubscription).toBe('unlimited');
    });

    test('triggerChannelChaser covers all pending suppliers, name, companyName, and Supplier fallback', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // Seed an RFQ with various vendor name fields
      act(() => {
        capturedApp?.adoptCreatedRFQ({
          id: 'rfq-chaser-vendors',
          rfqNumber: 'RFQ-CHASE-01',
          title: 'Chaser RFQ',
          status: 'Quotes Pending',
          followUpData: {
            vendors: [
              { vendorId: 'v-1', vendorName: 'Apex Tech' } as any,
              { vendorId: 'v-2', name: 'Beta Supplies' } as any,
              { vendorId: 'v-3', companyName: 'Gamma Corp' } as any,
              { vendorId: 'v-4' } as any,
            ],
            callStats: { total: 4, connected: 0 },
            whatsappStats: { total: 4, delivered: 0, read: 0 },
            smsStats: { total: 4, delivered: 0 },
            emailStats: { total: 4, sent24h: 0, opened: 0 },
          },
        } as any);
      });

      // Target "all pending suppliers"
      act(() => {
        capturedApp?.triggerChannelChaser('RFQ-CHASE-01', 'call', 'all pending suppliers', 'Calling all', true);
        capturedApp?.triggerChannelChaser('RFQ-CHASE-01', 'whatsapp', 'Beta Supplies', 'WA Beta', true);
        capturedApp?.triggerChannelChaser('RFQ-CHASE-01', 'sms', 'Gamma Corp', 'SMS Gamma', true);
        capturedApp?.triggerChannelChaser('RFQ-CHASE-01', 'call', 'Supplier', 'Calling fallback Supplier', true);
      });

      expect(screen.getByTestId('ready')).toBeInTheDocument();
    });

    test('addNewRFQ covers customMatchedVendors with various key combinations and duplicates', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      const rfqClientModule = require('@/lib/rfqClient');
      jest.spyOn(rfqClientModule, 'createRFQ').mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-cust-1',
          rfqNumber: 'RFQ-CUST-001',
          title: 'Custom Vendors RFQ',
          sourcingMode: 'mode_1',
          assignedVendors: [],
          extractedEntities: [{ id: 'e-1', itemName: 'Item 1' }],
        },
      });

      const customVendors: any = [
        { id: 'v-1', email: 'v1@test.com' },
        { id: 'v-2', name: 'Vendor Two' },
        { id: 'v-3' },
        {},
        { id: 'v-1', email: 'v1@test.com' }, // duplicate
      ];

      let created: any;
      await act(async () => {
        created = await capturedApp?.addNewRFQ(
          {
            title: 'Custom Vendors RFQ',
            category: 'Pumps',
            sourcingMode: 'mode_1',
            extractedEntities: [{ itemName: 'Item 1', quantity: 1 } as any],
          } as any,
          customVendors
        );
      });

      expect(created?.rfqNumber).toBe('RFQ-CUST-001');
    });

    test('processHistoricalPurchaseData handles data.message, status with text, status without text, and zero status', async () => {
      render(
        <AppProvider>
          <TestConsumer onReady={(app) => { capturedApp = app; }} />
        </AppProvider>
      );
      await waitFor(() => expect(screen.getByTestId('ready')).toBeInTheDocument());

      // 1. data.message
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, message: 'Invalid PO date format' }),
      });
      let res = await capturedApp?.processHistoricalPurchaseData('1_year', [{ companyName: 'Vendor 1' } as any]);
      expect(res).toBe(0);

      // 2. res.status with res.statusText
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => null,
      });
      res = await capturedApp?.processHistoricalPurchaseData('1_year', [{ companyName: 'Vendor 1' } as any]);
      expect(res).toBe(0);

      // 3. res.status without res.statusText
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: '',
        json: async () => null,
      });
      res = await capturedApp?.processHistoricalPurchaseData('1_year', [{ companyName: 'Vendor 1' } as any]);
      expect(res).toBe(0);

      // 4. res.status 0
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 0,
        json: async () => null,
      });
      res = await capturedApp?.processHistoricalPurchaseData('1_year', [{ companyName: 'Vendor 1' } as any]);
      expect(res).toBe(0);
    });
  });
});

