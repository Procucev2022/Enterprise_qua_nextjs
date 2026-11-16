import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { AppProvider } from '@/lib/store';
import type { RFQItem, UserSession } from '@/lib/types';

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
  minorCategories: ['Structural Steel'],
  pincode: '400001',
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
  deliveryPincode: '400001',
  deliveryLocation: 'Mumbai',
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
  deliveryPincode: '400001',
  deliveryLocation: 'Mumbai',
  chasingActive: false,
  extractedEntities: [],
  assignedVendors: [
    { id: 'v-other', name: 'Other Vendor Inc', email: 'other@example.com' },
  ],
  quotes: [],
};

// 3. RFQ-3: Mode 0 RFQ created by Buyer Corp with non-matching category (IT) and pincode (110001)
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
  deliveryPincode: '110001',
  deliveryLocation: 'Delhi',
  chasingActive: false,
  extractedEntities: [{ id: 'ent-1', itemName: 'Network Switch', minorCategory: 'Networking', quantity: 5 } as any],
  assignedVendors: [],
  quotes: [],
};

// 4. RFQ-4: Mode 0 RFQ matching vendor minor category ('Structural Steel') AND vendor pincode ('400001')
const RFQ_MODE_0_MATCHING: RFQItem = {
  id: 'rfq-mode-0-matching',
  rfqNumber: 'RFQ-MATCHING-04',
  title: 'Structural Steel Beams',
  buyerAccountId: 'buyer-other-202',
  buyerAccountName: 'Construction Corp',
  category: 'Civil Works',
  sourcingMode: 'mode_0',
  status: 'Quotes Pending',
  quotesCount: 0,
  budget: 800000,
  createdAt: '2026-11-04',
  targetDeliveryDate: '2026-12-05',
  deliveryPincode: '400001',
  deliveryLocation: 'Mumbai',
  chasingActive: false,
  extractedEntities: [{ id: 'ent-2', itemName: 'Steel Beams', minorCategory: 'Structural Steel', quantity: 20 } as any],
  assignedVendors: [],
  quotes: [],
};

// 5. RFQ-5: Mode 0 RFQ with matching minor category ('Structural Steel') but DIFFERENT pincode ('560001')
const RFQ_MODE_0_DIFF_PIN: RFQItem = {
  id: 'rfq-mode-0-diff-pin',
  rfqNumber: 'RFQ-DIFFPIN-05',
  title: 'Bangalore Structural Steel Sourcing',
  buyerAccountId: 'buyer-other-202',
  buyerAccountName: 'Construction Corp',
  category: 'Civil Works',
  sourcingMode: 'mode_0',
  status: 'Quotes Pending',
  quotesCount: 0,
  budget: 450000,
  createdAt: '2026-11-05',
  targetDeliveryDate: '2026-12-10',
  deliveryPincode: '560001',
  deliveryLocation: 'Bangalore',
  chasingActive: false,
  extractedEntities: [{ id: 'ent-3', itemName: 'Steel Rebars', minorCategory: 'Structural Steel', quantity: 15 } as any],
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
              data: [
                RFQ_INVITED_DIFFERENT_CAT,
                RFQ_UNINVITED_SAME_BUYER,
                RFQ_MODE_0_PUBLIC,
                RFQ_MODE_0_MATCHING,
                RFQ_MODE_0_DIFF_PIN,
              ],
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

    await waitFor(() => {
      expect(screen.getByText('RFQ-INVITED-01')).toBeInTheDocument();
    });

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

    expect(screen.queryByText('RFQ-UNINVITED-02')).not.toBeInTheDocument();
  });

  test('Mode 0 RFQ with non-matching category/pincode appears in Public Enquiries tab, NOT in My Enquiries tab', async () => {
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

    // In My Enquiries tab, non-matching Mode 0 RFQ should NOT be present
    expect(screen.queryByText('RFQ-PUBLIC-03')).not.toBeInTheDocument();

    // Switch to Public Enquiries tab
    const publicTab = screen.getByRole('button', { name: /Public Enquiries/i });
    fireEvent.click(publicTab);

    // In Public Enquiries tab, all Mode 0 RFQs should be visible
    await waitFor(() => {
      expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    });
  });

  test('Mode 0 RFQ matching minor category AND pincode is displayed in My Enquiries as well as Public Enquiries', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    // In My Enquiries tab, RFQ-MATCHING-04 SHOULD be present because its minor category & pincode match
    await waitFor(() => {
      expect(screen.getByText('RFQ-MATCHING-04')).toBeInTheDocument();
    });

    // RFQ-DIFFPIN-05 should NOT be in My Enquiries because pincode does not match
    expect(screen.queryByText('RFQ-DIFFPIN-05')).not.toBeInTheDocument();

    // Switch to Public Enquiries tab
    const publicTab = screen.getByRole('button', { name: /Public Enquiries/i });
    fireEvent.click(publicTab);

    // In Public Enquiries tab, both Mode 0 RFQs should be present
    await waitFor(() => {
      expect(screen.getByText('RFQ-MATCHING-04')).toBeInTheDocument();
      expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
      expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    });
  });

  test('filters RFQs by single and multiple pincodes', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    // Switch to Public Enquiries tab where 110001, 400001, and 560001 are present
    const publicTab = screen.getByRole('button', { name: /Public Enquiries/i });
    fireEvent.click(publicTab);

    await waitFor(() => {
      expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
      expect(screen.getByText('RFQ-MATCHING-04')).toBeInTheDocument();
      expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
    });

    // Open the Pincode multi-select dropdown
    const pincodeBtn = screen.getByRole('button', { name: /filter enquiries by pincode/i });
    fireEvent.click(pincodeBtn);

    // Filter by single pincode: 560001
    const pin560001Checkbox = screen.getByRole('checkbox', { name: '560001' });
    fireEvent.click(pin560001Checkbox);

    // Only RFQ-DIFFPIN-05 should be visible
    expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
    expect(screen.queryByText('RFQ-PUBLIC-03')).not.toBeInTheDocument();
    expect(screen.queryByText('RFQ-MATCHING-04')).not.toBeInTheDocument();

    // Now select a second pincode: 110001 (multi-pincode filtering)
    const pin110001Checkbox = screen.getByRole('checkbox', { name: '110001' });
    fireEvent.click(pin110001Checkbox);

    // Both 560001 and 110001 RFQs should now be visible
    expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
    expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    expect(screen.queryByText('RFQ-MATCHING-04')).not.toBeInTheDocument();

    // Clear pincode filters
    const clearBtn = screen.getByRole('button', { name: /Clear All/i });
    fireEvent.click(clearBtn);

    // All RFQs should be visible again
    expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    expect(screen.getByText('RFQ-MATCHING-04')).toBeInTheDocument();
    expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
  });

  test('filters RFQs by category and minor category', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <QuotationForm onBack={jest.fn()} />
        </AppProvider>
      );
    });

    // Switch to Public Enquiries tab
    const publicTab = screen.getByRole('button', { name: /Public Enquiries/i });
    fireEvent.click(publicTab);

    await waitFor(() => {
      expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    });

    // Filter by category "IT"
    const catSelect = screen.getByLabelText(/filter enquiries by category/i);
    fireEvent.change(catSelect, { target: { value: 'IT' } });

    expect(screen.getByText('RFQ-PUBLIC-03')).toBeInTheDocument();
    expect(screen.queryByText('RFQ-MATCHING-04')).not.toBeInTheDocument();
    expect(screen.queryByText('RFQ-DIFFPIN-05')).not.toBeInTheDocument();

    // Filter by minor category "Structural Steel"
    fireEvent.change(catSelect, { target: { value: 'Structural Steel' } });

    expect(screen.getByText('RFQ-MATCHING-04')).toBeInTheDocument();
    expect(screen.getByText('RFQ-DIFFPIN-05')).toBeInTheDocument();
    expect(screen.queryByText('RFQ-PUBLIC-03')).not.toBeInTheDocument();
  });
});
