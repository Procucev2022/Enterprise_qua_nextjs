/**
 * @file trialPeriodTimeBased.test.tsx
 * Automated regression test suite for Frontend Time-Based Trial Period:
 * 1. Live day-by-day countdown: 7 Days Trial Period -> 6 Days -> 1 Day Left -> expired.
 * 2. Header renders live countdown badge (e.g. "7 Days Trial Period (Unlimited RFQs)") and reverts upon expiry.
 * 3. Buyer Dossier Drawer (Profile & Credit tabs) displays active trial countdown & Unlimited RFQs without decrements.
 * 4. Manual RFQ allows all sourcing modes and unlimited creation during trial.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import Header from '@/app/components/Header';
import BuyerDossierDrawer from '@/app/category-manager/components/BuyerDossierDrawer';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import * as storeModule from '@/lib/store';
import { isBuyerTrialActive, getRemainingTrialDays } from '@/lib/constants';
import type { BuyerAccount } from '@/lib/types';

jest.mock('@/lib/store');

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => '/buyer/dashboard',
}));

jest.mock('@/lib/authClient', () => ({
  authClient: {
    logout: jest.fn().mockResolvedValue(undefined),
    getToken: jest.fn().mockReturnValue('mock-token'),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
    getSessionUser: jest.fn().mockReturnValue({ id: 'cm-1', role: 'category_manager', email: 'cm@test.com' }),
  },
}));

jest.mock('@/lib/notificationClient', () => ({
  fetchNotifications: jest.fn().mockResolvedValue({ success: true, notifications: [], unreadCount: 0 }),
  markNotificationRead: jest.fn().mockResolvedValue(true),
  markAllNotificationsRead: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerCreditHistory: jest.fn().mockResolvedValue({
    success: true,
    summary: {
      trialActive: true,
      trialDays: 7,
      trialStartDate: '2026-11-20T10:00:00Z',
      trialEndDate: '2026-11-27T10:00:00Z',
      remainingFreeCredits: 0,
    },
    transactions: [
      {
        id: 'tx-1',
        transactionId: 'CTX-TRIAL-001',
        transactionDate: '2026-11-20T10:00:00Z',
        transactionType: 'TRIAL_GRANTED',
        creditSource: 'Action Center Internal Tasks Approval',
        creditsAdded: 0,
        creditsConsumed: 0,
        updatedBalance: 0,
        status: 'COMPLETED',
        description: 'TRIAL_GRANTED: 7 Days Unlimited Trial',
      },
      {
        id: 'tx-2',
        transactionId: 'CTX-ADD-002',
        transactionDate: '2026-11-15T10:00:00Z',
        transactionType: 'Admin Credit Addition',
        creditSource: 'Action Center Internal Tasks Approval',
        creditsAdded: 5,
        creditsConsumed: 0,
        updatedBalance: 5,
        status: 'COMPLETED',
        description: 'Admin Credit Addition (+5)',
      },
    ],
  }),
  updateBuyerCategories: jest.fn().mockResolvedValue({ success: true }),
  fetchBuyerCommunications: jest.fn().mockResolvedValue({ success: true, communications: [] }),
  recordBuyerCommunication: jest.fn().mockResolvedValue({ success: true }),
  fetchBuyerPaymentHistory: jest.fn().mockResolvedValue({ success: true, transactions: [] }),
  fetchCategoryTaxonomy: jest.fn().mockResolvedValue({ categories: [] }),
  fetchBuyerUploadedVendors: jest.fn().mockResolvedValue({ success: true, vendors: [] }),
}));

jest.mock('@/lib/internalTaskClient', () => ({
  fetchInternalAssignees: jest.fn().mockResolvedValue({ assignees: [] }),
  createInternalTaskForAccount: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/lib/approvalClient', () => ({
  fetchApprovalUsers: jest.fn().mockResolvedValue({ users: [] }),
  fetchApprovalApprovers: jest.fn().mockResolvedValue({ approvers: [] }),
}));

jest.mock('@/lib/subscriptionPaymentClient', () => ({
  fetchSubscriptionPricing: jest.fn().mockResolvedValue({ plans: [] }),
}));

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn().mockResolvedValue([]),
}));

describe('Frontend Time-Based Trial Period', () => {
  const createMockBuyerAccount = (overrides: Partial<BuyerAccount> = {}): BuyerAccount => ({
    id: 'buyer-trial-test',
    organizationName: 'Acme Corp',
    corporateEmail: 'buyer@acme.com',
    contactPerson: 'John Buyer',
    mobileNumber: '+91 9999999999',
    city: 'Hyderabad',
    primaryPlantLocation: 'Telangana',
    gstin: '36AAAAA0000A1Z5',
    industrySector: 'Manufacturing',
    accountSource: 'web_registration',
    sourcingMode: 'mode_1',
    subscriptionPlan: 'free_trial',
    remainingFreeRFQs: 0,
    totalSpend: '₹0',
    totalRFQsCreated: 0,
    status: 'ACTIVE_VERIFIED',
    supportedMajorCategories: ['General Procurement'],
    createdDate: '2026-01-01T00:00:00Z',
    syncTimestamp: '2026-01-01 00:00 UTC',
    ...overrides,
  } as BuyerAccount);

  const baseStore = {
    currentRole: 'buyer',
    setCurrentRole: jest.fn(),
    isLoggedIn: true,
    setIsLoggedIn: jest.fn(),
    currentMode: 'mode_1',
    setCurrentMode: jest.fn(),
    vendorSubscription: null,
    setVendorSubscription: jest.fn(),
    vendorRfqDownloadsUsed: 0,
    aiFeed: [],
    setAiFeed: jest.fn(),
    markAllNotificationsAsRead: jest.fn(),
    theme: 'light',
    toggleTheme: jest.fn(),
    currentUserSession: { name: 'Acme Corp Buyer', email: 'buyer@acme.com', role: 'buyer' },
    setCurrentUserSession: jest.fn(),
    showToast: jest.fn(),
    addAuditLog: jest.fn(),
    rfqs: [],
    updateRFQStatus: jest.fn(),
    addNewRFQ: jest.fn(),
    buyerAccounts: [],
    activeBuyerId: 'buyer-trial-test',
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Dynamic Day-by-Day Countdown Calculation', () => {
    test('calculates correct days remaining from trialEndDate', () => {
      const now = Date.now();

      // Day 1: 7 days remaining
      const day7End = new Date(now + 7 * 86400000).toISOString();
      expect(getRemainingTrialDays(day7End)).toBe(7);

      // Day 2: 6 days remaining
      const day6End = new Date(now + 6 * 86400000).toISOString();
      expect(getRemainingTrialDays(day6End)).toBe(6);

      // Day 7: less than 24h remaining (e.g., 10 hours)
      const day1End = new Date(now + 10 * 3600000).toISOString();
      expect(getRemainingTrialDays(day1End)).toBe(1);

      // Expired: past date
      const pastEnd = new Date(now - 1000).toISOString();
      expect(getRemainingTrialDays(pastEnd)).toBe(0);
      expect(getRemainingTrialDays(null)).toBe(0);
      expect(getRemainingTrialDays(undefined)).toBe(0);
    });

    test('isBuyerTrialActive accurately checks trial validity and active flag', () => {
      const future = new Date(Date.now() + 5 * 86400000).toISOString();
      const past = new Date(Date.now() - 5 * 86400000).toISOString();

      expect(isBuyerTrialActive({ trialActive: true, trialEndDate: future })).toBe(true);
      expect(isBuyerTrialActive({ trialEndDate: future })).toBe(true);
      expect(isBuyerTrialActive({ trialActive: false, trialEndDate: future })).toBe(false);
      expect(isBuyerTrialActive({ trialActive: true, trialEndDate: past })).toBe(false);
      expect(isBuyerTrialActive(null)).toBe(false);
      expect(isBuyerTrialActive(undefined)).toBe(false);
    });
  });

  describe('2. Header Live Trial Badge Display', () => {
    test('renders Day 1 badge "7 Days Trial Period (Unlimited RFQs)"', () => {
      const trialEndDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const trialBuyerAccount = createMockBuyerAccount({
        id: 'buyer-trial-test',
        remainingFreeRFQs: 0,
        trialActive: true,
        trialDays: 7,
        trialStartDate: new Date().toISOString(),
        trialEndDate,
      });

      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        activeBuyerAccount: trialBuyerAccount,
      });

      render(<Header />);

      expect(screen.getByTestId('header-trial-period-badge')).toBeInTheDocument();
      expect(screen.getByText('7 Days Trial Period (Unlimited RFQs)')).toBeInTheDocument();
      // Should NOT render numeric sourcing credits badge
      expect(screen.queryByTestId('header-free-credits-badge')).toBeNull();
    });

    test('renders Day 2 badge "6 Days Trial Period (Unlimited RFQs)"', () => {
      const trialEndDate = new Date(Date.now() + 6 * 86400000).toISOString();
      const trialBuyerAccount = createMockBuyerAccount({
        id: 'buyer-trial-test',
        remainingFreeRFQs: 0,
        trialActive: true,
        trialDays: 7,
        trialEndDate,
      });

      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        activeBuyerAccount: trialBuyerAccount,
      });

      render(<Header />);

      expect(screen.getByText('6 Days Trial Period (Unlimited RFQs)')).toBeInTheDocument();
    });

    test('renders Final Day badge "1 Day Left (Unlimited RFQs)"', () => {
      const trialEndDate = new Date(Date.now() + 10 * 3600000).toISOString(); // 10 hours
      const trialBuyerAccount = createMockBuyerAccount({
        id: 'buyer-trial-test',
        remainingFreeRFQs: 0,
        trialActive: true,
        trialDays: 7,
        trialEndDate,
      });

      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        activeBuyerAccount: trialBuyerAccount,
      });

      render(<Header />);

      expect(screen.getByText('1 Day Left (Unlimited RFQs)')).toBeInTheDocument();
    });

    test('reverts to normal credits badge after trial expires', () => {
      const pastEndDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const expiredBuyerAccount = createMockBuyerAccount({
        id: 'buyer-trial-test',
        remainingFreeRFQs: 4,
        trialActive: true,
        trialDays: 7,
        trialEndDate: pastEndDate,
      });

      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        remainingFreeRFQs: 4,
        activeBuyerAccount: expiredBuyerAccount,
      });

      render(<Header />);

      // Should NOT render trial badge
      expect(screen.queryByTestId('header-trial-period-badge')).toBeNull();
      // Should revert to normal sourcing credits badge
      const creditsBadge = screen.getByTestId('header-free-credits-badge');
      expect(creditsBadge).toBeInTheDocument();
      expect(creditsBadge).toHaveTextContent(/Remaining:\s*4/i);
    });
  });

  describe('3. Category Manager > Buyer Dossier Drawer', () => {
    const trialEndDate = new Date(Date.now() + 7 * 86400000).toISOString();
    const mockBuyer = createMockBuyerAccount({
      id: 'buy-dossier-1',
      organizationName: 'Nova Technologies',
      corporateEmail: 'contact@nova.com',
      mobileNumber: '+91 9999999999',
      remainingFreeRFQs: 0,
      trialActive: true,
      trialDays: 7,
      trialStartDate: new Date().toISOString(),
      trialEndDate,
    });

    test('displays active trial countdown and unlimited RFQs in Profile tab', () => {
      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        currentRole: 'category_manager',
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={jest.fn()}
          onSelectRFQ={jest.fn()}
          initialTab="profile"
        />
      );

      // Quota card in Profile tab
      expect(screen.getByText('Available Quota')).toBeInTheDocument();
      expect(screen.getByText('7 Days Trial Period')).toBeInTheDocument();
      expect(screen.getByText(/Unlimited RFQs/i)).toBeInTheDocument();
    });

    test('displays active trial countdown and unlimited RFQs in Credit tab', async () => {
      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        currentRole: 'category_manager',
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={jest.fn()}
          onSelectRFQ={jest.fn()}
          initialTab="credits"
        />
      );

      // Credit tab card
      expect(screen.getByText('Remaining Free Credits')).toBeInTheDocument();
      expect(screen.getByText(/7 Days Trial Period — Unlimited RFQs/i)).toBeInTheDocument();

      // Transaction history loads TRIAL_GRANTED
      await waitFor(() => {
        expect(screen.getByText('TRIAL_GRANTED: 7 Days Unlimited Trial')).toBeInTheDocument();
      });

      // Filter options include TRIAL_GRANTED
      const filterSelect = screen.getByDisplayValue('All Types');
      expect(filterSelect).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Trial Granted' })).toBeInTheDocument();
    });
  });

  describe('4. ManualRFQModal allows all sourcing modes and unlimited creation during trial', () => {
    test('permits Mode 1, 2, 3 creation even when remainingFreeRFQs is 0', () => {
      const trialEndDate = new Date(Date.now() + 7 * 86400000).toISOString();
      const trialBuyer = createMockBuyerAccount({
        id: 'buyer-manual-test',
        organizationName: 'Apex Industrial',
        remainingFreeRFQs: 0, // 0 credits remaining
        trialActive: true,
        trialDays: 7,
        trialEndDate,
      });

      (storeModule.useApp as jest.Mock).mockReturnValue({
        ...baseStore,
        activeBuyerAccount: trialBuyer,
      });

      render(
        <ManualRFQModal
          isOpen={true}
          onClose={jest.fn()}
          onCreated={jest.fn()}
        />
      );

      // Mode 1, Mode 2, and Mode 3 buttons should be entitled and not locked
      expect(screen.queryByText(/Free trial quota exhausted/i)).toBeNull();
      expect(screen.getByTestId('manual-mode-mode_1')).toBeInTheDocument();
      expect(within(screen.getByTestId('manual-mode-mode_1')).queryByText(/LOCKED/i)).toBeNull();
      expect(screen.getByTestId('manual-mode-mode_2')).toBeInTheDocument();
      expect(within(screen.getByTestId('manual-mode-mode_2')).queryByText(/LOCKED/i)).toBeNull();
      expect(screen.getByTestId('manual-mode-mode_3')).toBeInTheDocument();
      expect(within(screen.getByTestId('manual-mode-mode_3')).queryByText(/LOCKED/i)).toBeNull();
    });
  });
});
