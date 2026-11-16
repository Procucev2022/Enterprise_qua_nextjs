import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { AppProvider } from '@/lib/store';
import type { RFQItem, VendorOpportunity, UserSession } from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const BUYER_COMPANY = 'Enterprise Buyer Corp';
const BUYER_ID = 'buyer-corp-101';

const VENDOR_SESSION: UserSession = {
  id: 'usr-v1',
  email: 'vendor1@example.com',
  name: 'Vendor One Ltd',
  role: 'vendor',
  orgId: 'org-v1',
  orgName: 'Vendor One Ltd',
};

const VENDOR_PROFILE = {
  id: 'v-101',
  name: 'Vendor One Ltd',
  email: 'vendor1@example.com',
  buyerId: BUYER_ID,
  buyerAccountId: BUYER_ID,
  addedByBuyerCompany: BUYER_COMPANY,
  majorCategory: 'Civil Works', // Registered category is Civil Works
  freeQuotationCredits: 5,
  subscriptionPlan: 'premium',
};

// 1. RFQ-1: Mode 1 RFQ under "Engineering Spares" (different category from Civil Works), but vendor1 IS invited
const RFQ_INVITED_DIFFERENT_CAT: RFQItem = {
  id: 'rfq-invited-diff-cat',
  rfqNumber: 'RFQ-INVITED-01',
  title: 'High Pressure Water Pump Sourcing',
  buyerAccountId: BUYER_ID,
  buyerAccountName: BUYER_COMPANY,
  category: 'Engineering Spares - Mechanical',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  budget: 350000,
  createdAt: '2026-11-01',
  targetDeliveryDate: '2026-11-20',
  chasingActive: false,
  extractedEntities: [],
  assignedVendors: [
    { id: 'v-101', name: 'Vendor One Ltd', email: 'vendor1@example.com' },
  ],
  quotes: [],
};

// 2. RFQ-2: Mode 1 RFQ by the same buyer, but vendor1 is NOT invited (only other vendor is invited)
const RFQ_UNINVITED_SAME_BUYER: RFQItem = {
  id: 'rfq-uninvited-same-buyer',
  rfqNumber: 'RFQ-UNINVITED-02',
  title: 'Custom Electrical Transformers',
  buyerAccountId: BUYER_ID,
  buyerAccountName: BUYER_COMPANY,
  category: 'Electrical & Electronics',
  sourcingMode: 'mode_1',
  status: 'Quotes Pending',
  quotesCount: 0,
  budget: 600000,
  createdAt: '2026-11-02',
  targetDeliveryDate: '2026-11-25',
  chasingActive: false,
  extractedEntities: [],
  assignedVendors: [
    { id: 'v-other', name: 'Other Vendor Inc', email: 'other@example.com' },
  ],
  quotes: [],
};

// 3. RFQ-3: Mode 0 RFQ created by Buyer Corp
const RFQ_MODE_0_PUBLIC: RFQItem = {
  id: 'rfq-mode-0-public',
  rfqNumber: 'RFQ-PUBLIC-03',
  title: 'Standard Office Network Switches',
  buyerAccountId: BUYER_ID,
  buyerAccountName: BUYER_COMPANY,
  category: 'IT',
  sourcingMode: 'mode_0',
  status: 'Quotes Pending',
  quotesCount: 0,
  budget: 200000,
  createdAt: '2026-11-03',
  targetDeliveryDate: '2026-11-30',
  chasingActive: false,
  extractedEntities: [],
  assignedVendors: [],
  quotes: [],
};

describe('Vendor RFQ Visibility: My Enquiries and Public Enquiries in QuotationForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.endsWith('/api/vendors/rfq-credits')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                vendorId: VENDOR_PROFILE.id,
                freeCreditsRemaining: 5,
                freeCreditsAllocated: 5,
                freeCreditsUsed: 0,
                isSubscribed: false,
                subscriptionPlan: 'premium',
                unlockedRfqIds: [],
              },
            }),
        } as Response);
      }

      if (url.includes('/api/vendors/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: VENDOR_PROFILE }),
        } as Response);
      }

      if (url.includes('/api/rfqs')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: [RFQ_INVITED_DIFFERENT_CAT, RFQ_UNINVITED_SAME_BUYER, RFQ_MODE_0_PUBLIC],
            }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response);
    }) as jest.Mock;
  });

  test('invited vendor with different registered category sees RFQ in My Enquiries', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    // Wait for RFQs to load
    await waitFor(() => {
      expect(screen.getByText('RFQ-INVITED-01')).toBeInTheDocument();
    });

    // Verify My Enquiries tab contains RFQ-INVITED-01
    expect(screen.getByText('RFQ-INVITED-01')).toBeInTheDocument();
  });

  test('uninvited vendor belonging to same buyer does NOT see RFQ in My Enquiries', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('RFQ-INVITED-01')).toBeInTheDocument();
    });

    // In My Enquiries tab, RFQ-UNINVITED-02 should NOT be visible
    expect(screen.queryByText('RFQ-UNINVITED-02')).not.toBeInTheDocument();
  });

  test('Mode 0 RFQ appears in Public Enquiries tab, NOT in My Enquiries tab', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('RFQ-INVITED-01')).toBeInTheDocument();
    });

    // In My Enquiries tab, Mode 0 RFQ should NOT be present
    expect(screen.queryByText('RFQ-PUBLIC-03')).not.toBeInTheDocument();

    // Switch to Public Enquiries tab
    const publicTab = screen.getByRole('button', { name: /Public Enquiries/i });
    fireEvent.click(publicTab);

    // In Public Enquiries tab, Mode 0 RFQ SHOULD be present
    await waitFor(() => {
      expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    });
  });
});
