import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import RFQDetails, {
  isPublicRfqForVendor,
  isRfqDownloadedByVendor,
  generateRfqSpecHtml,
} from '@/app/buyer/rfq-details';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import type { RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/authClient', () => ({
  authClient: {
    getToken: jest.fn(() => 'mock-token'),
    getSessionUser: jest.fn(() => ({ email: 'vendor@example.com' })),
  },
}));

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  updateRFQ: jest.fn().mockResolvedValue({ success: true }),
  extendRFQ: jest.fn().mockResolvedValue({ success: true }),
  rfqAttachmentUrl: jest.fn((id: string) => `/api/rfqs/attachments/${id}`),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: () => 'RFQ-TEST-100' }),
}));

describe('isPublicRfqForVendor & isRfqDownloadedByVendor helpers', () => {
  const baseRfq: RFQItem = {
    id: 'rfq-1',
    rfqNumber: 'RFQ-TEST-100',
    title: 'Precision Parts',
    category: 'Mechanical',
    sourcingMode: 'mode_1' as any,
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    budget: 100000,
    createdAt: '2026-11-01',
    extractedEntities: [
      { itemName: 'Gear Box', quantity: 10, unit: 'Nos', targetPrice: 5000, technicalSpecs: 'Steel C45' } as any,
    ],
    quotes: [],
    chasingActive: false,
  };

  test('isPublicRfqForVendor returns false for null RFQ', () => {
    expect(isPublicRfqForVendor(null)).toBe(false);
  });

  test('isPublicRfqForVendor recognizes Mode 0 and Mode 3 as public', () => {
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'mode_0' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'v0' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'version_0' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'mode_3' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'v3' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, sourcingMode: 'version_3' as any })).toBe(true);
    expect(isPublicRfqForVendor({ ...baseRfq, isPublic: true } as any)).toBe(true);
  });

  test('isPublicRfqForVendor checks vendorOpportunities type and mode', () => {
    const oppMarketplace = { rfqNumber: 'RFQ-TEST-100', type: 'marketplace' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppMarketplace as any] })).toBe(true);

    const oppPublicEnquiry = { rfqNumber: 'RFQ-TEST-100', type: 'public_enquiry' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppPublicEnquiry as any] })).toBe(true);

    const oppNetworkOpen = { rfqNumber: 'RFQ-TEST-100', type: 'network_open' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppNetworkOpen as any] })).toBe(true);

    const oppV0 = { rfqNumber: 'RFQ-TEST-100', sourcingMode: 'v0' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppV0 as any] })).toBe(true);

    const oppDirect = { rfqNumber: 'RFQ-TEST-100', type: 'direct_invitation' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppDirect as any] })).toBe(false);
  });

  test('isPublicRfqForVendor checks store rfqs list', () => {
    const storeRfqV0 = { rfqNumber: 'RFQ-TEST-100', sourcingMode: 'mode_0' };
    expect(isPublicRfqForVendor(baseRfq, { rfqs: [storeRfqV0 as any] })).toBe(true);

    const storeRfqPublic = { rfqNumber: 'RFQ-TEST-100', isPublic: true };
    expect(isPublicRfqForVendor(baseRfq, { rfqs: [storeRfqPublic as any] })).toBe(true);
  });

  test('isPublicRfqForVendor detects explicit assignedVendors match', () => {
    const rfqWithAssigned: RFQItem = {
      ...baseRfq,
      assignedVendors: [
        { id: 'v-1', name: 'Other Vendor', email: 'other@vendor.com' } as any,
        { id: 'v-me', name: 'My Vendor Inc', email: 'vendor@example.com' } as any,
      ],
    };
    const session = { email: 'vendor@example.com', orgId: 'v-me', name: 'My Vendor Inc' };
    // Vendor is in assigned list -> Direct (not public)
    expect(isPublicRfqForVendor(rfqWithAssigned, { currentUserSession: session })).toBe(false);

    // Vendor is NOT in assigned list -> Public to others
    const sessionOther = { email: 'different@vendor.com', orgId: 'v-other', name: 'Different' };
    expect(isPublicRfqForVendor(rfqWithAssigned, { currentUserSession: sessionOther })).toBe(true);
  });

  test('isPublicRfqForVendor detects client roster relationship', () => {
    const rfqWithBuyer: RFQItem = {
      ...baseRfq,
      buyerAccountName: 'Acme Corp',
      buyerAccountId: 'b-acme',
    };
    const buyerVendors = [
      { buyerCompany: 'Acme Corp', buyerId: 'b-acme' },
    ];
    // In client roster -> Direct
    expect(isPublicRfqForVendor(rfqWithBuyer, { buyerVendors: buyerVendors as any })).toBe(false);

    // Not in client roster -> Public
    expect(isPublicRfqForVendor(rfqWithBuyer, { buyerVendors: [{ buyerCompany: 'Other Corp' }] as any })).toBe(true);
  });

  test('isRfqDownloadedByVendor handles null and various unlocked states', () => {
    expect(isRfqDownloadedByVendor(null)).toBe(false);

    // Quotes already submitted
    expect(isRfqDownloadedByVendor({ ...baseRfq, quotes: [{ quoteId: 'q-1' } as any] })).toBe(true);

    // In vendorUnlockedRfqIds
    expect(isRfqDownloadedByVendor(baseRfq, { vendorUnlockedRfqIds: ['rfq-test-100'] })).toBe(true);
    expect(isRfqDownloadedByVendor(baseRfq, { vendorUnlockedRfqIds: ['rfq-1'] })).toBe(true);
    expect(isRfqDownloadedByVendor(baseRfq, { vendorUnlockedRfqIds: ['other-rfq'] })).toBe(false);

    // In localUnlockedIds
    expect(isRfqDownloadedByVendor(baseRfq, { localUnlockedIds: ['RFQ-TEST-100'] })).toBe(true);
    expect(isRfqDownloadedByVendor(baseRfq, { localUnlockedIds: ['rfq-1'] })).toBe(true);
    expect(isRfqDownloadedByVendor(baseRfq, { localUnlockedIds: ['non-existent'] })).toBe(false);
  });

  test('isPublicRfqForVendor exercises remaining branches', () => {
    // opp matching by id and having version_0 / version_3 / isPublic
    const oppIdMatch = { id: 'RFQ-TEST-100', sourcingMode: 'version_0' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppIdMatch as any] })).toBe(true);

    const oppV3Match = { id: 'RFQ-TEST-100', sourcingMode: 'version_3' };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppV3Match as any] })).toBe(true);

    const oppPublicMatch = { id: 'RFQ-TEST-100', isPublic: true };
    expect(isPublicRfqForVendor(baseRfq, { vendorOpportunities: [oppPublicMatch as any] })).toBe(true);

    // assignedVendors matching by id or name
    const rfqWithAssignedId: RFQItem = {
      ...baseRfq,
      assignedVendors: [null as any, { vendorId: 'vendor-id-match' } as any],
    };
    expect(isPublicRfqForVendor(rfqWithAssignedId, { currentUserSession: { vendorId: 'vendor-id-match' } })).toBe(false);

    const rfqWithAssignedName: RFQItem = {
      ...baseRfq,
      assignedVendors: [{ vendorName: 'Vendor Name Match' } as any],
    };
    expect(isPublicRfqForVendor(rfqWithAssignedName, { currentUserSession: { orgName: 'Vendor Name Match' } })).toBe(false);

    // buyerVendors matching by buyerId or addedByBuyerCompany
    const rfqWithBuyerId: RFQItem = {
      ...baseRfq,
      buyerAccountId: 'acc-123',
    };
    expect(isPublicRfqForVendor(rfqWithBuyerId, {
      buyerVendors: [null as any, { buyerAccountId: 'acc-123' }] as any,
    })).toBe(false);

    const rfqWithBuyerCo: RFQItem = {
      ...baseRfq,
      buyerAccountName: 'Special Buyer Co',
    };
    expect(isPublicRfqForVendor(rfqWithBuyerCo, {
      buyerVendors: [{ addedByBuyerCompany: 'Special Buyer Co' }] as any,
    })).toBe(false);
  });

  test('generateRfqSpecHtml builds valid HTML specification with all fallback variations', () => {
    const htmlFull = generateRfqSpecHtml(baseRfq);
    expect(htmlFull).toContain('RFQ Specification - RFQ-TEST-100');
    expect(htmlFull).toContain('Gear Box');
    expect(htmlFull).toContain('10 Nos');
    expect(htmlFull).toContain('₹5,000');
    expect(htmlFull).toContain('Steel C45');

    // Minimal RFQ with fallback fields
    const minimalRfq: RFQItem = {
      ...baseRfq,
      id: 'rfq-min',
      rfqNumber: 'RFQ-MIN-1',
      title: '',
      category: '',
      deliveryLocation: '',
      deliveryPincode: '560001',
      targetDeliveryDate: '2026-12-01',
      extractedEntities: [
        {
          description: 'Description Only Item',
          minorCategory: 'Consumables',
          unit: 'Units',
        } as any,
      ],
    };
    const htmlMin = generateRfqSpecHtml(minimalRfq);
    expect(htmlMin).toContain('Requirement Specification');
    expect(htmlMin).toContain('Description Only Item');
    expect(htmlMin).toContain('Not provided (PIN: 560001)');
    expect(htmlMin).toContain('2026-12-01');
    expect(htmlMin).toContain('Not provided');
  });

  test('resolveVendorCategories exercises vendor category matching branches', () => {
    const { resolveVendorCategories } = require('@/app/buyer/rfq-details');
    // Case 1: vendor object with minorCategory & matching entity
    const res1 = resolveVendorCategories(
      { majorCategory: 'Fasteners', minorCategory: 'Bolts' },
      null,
      false,
      baseRfq,
      0,
      [{ minorCategory: 'Bolts' } as any]
    );
    expect(res1.majorCategory).toBe('Fasteners');
    expect(res1.minorCategory).toBe('Bolts');

    // Case 2: vendor with minorCategories array & found with minorCategories
    const res2 = resolveVendorCategories(
      { category: 'Electrical', minorCategories: ['Cables', 'Wires'] },
      { minorCategory: 'Motors', minorCategories: ['Sensors'] },
      false,
      baseRfq,
      1,
      []
    );
    expect(res2.majorCategory).toBe('Electrical');

    // Case 3: isProc true with activeRfq fallback
    const res3 = resolveVendorCategories(
      null,
      null,
      true,
      { category: 'Mechanical' } as any,
      0,
      []
    );
    expect(res3.majorCategory).toBe('Mechanical');

    // Case 4: default General
    const res4 = resolveVendorCategories(null, null, false, null, 0, []);
    expect(res4.majorCategory).toBe('General');
  });
});

describe('Vendor RFQ Details download and submit quote interaction', () => {
  const publicRfq: RFQItem = {
    id: 'rfq-pub-1',
    rfqNumber: 'RFQ261811804439',
    title: 'Industrial Equipment & Consumables',
    category: 'Engineering Spares',
    sourcingMode: 'mode_0' as any,
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-11-28',
    budget: 500000,
    deliveryLocation: 'East Godavari, Andhra Pradesh',
    deliveryPincode: '533431',
    attachments: [
      { id: 'att-1', fileName: 'technical-specs.pdf', fileType: 'application/pdf', fileSize: 1024 } as any,
    ],
    createdAt: '2026-11-18T11:19:00.000Z',
    extractedEntities: [
      {
        itemName: 'Supply / provide Grinding Materials',
        quantity: 25,
        unit: 'Nos',
        category: 'Grinding Materials',
      } as any,
      {
        itemName: 'Supply / provide Powder Coating Machines',
        quantity: 50,
        unit: 'Nos',
        category: 'Powder Coating Machines',
      } as any,
    ],
    quotes: [],
    chasingActive: false,
  };

  let mockShowToast: jest.Mock;
  let mockUnlockRFQForVendor: jest.Mock;
  let mockRefreshVendorCredits: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast = jest.fn();
    mockUnlockRFQForVendor = jest.fn().mockResolvedValue({
      success: true,
      alreadyUnlocked: false,
      data: { htmlBody: '<html><body>Spec Content</body></html>' },
    });
    mockRefreshVendorCredits = jest.fn().mockResolvedValue(undefined);

    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com', name: 'Veera Solutions' },
      vendorUnlockedRfqIds: [],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [{ rfqNumber: 'RFQ261811804439', type: 'marketplace', sourcingMode: 'mode_0' }],
      rfqs: [publicRfq],
    });

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/download')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { htmlBody: '<html><body>Spec Content</body></html>' },
          }),
        });
      }
      if (url.includes('/attachments/')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['dummy attachment data'], { type: 'application/pdf' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      });
    }) as any;

    // Mock createObjectURL & revokeObjectURL
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    } else {
      jest.spyOn(global.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = jest.fn();
    } else {
      jest.spyOn(global.URL, 'revokeObjectURL').mockImplementation(() => {});
    }
  });

  test('disables Submit Quote button and displays Download RFQ button when public RFQ is NOT downloaded', () => {
    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    // Top action bar: Download RFQ button should be rendered
    const downloadBtns = screen.getAllByRole('button', { name: /Download RFQ/i });
    expect(downloadBtns.length).toBeGreaterThan(0);

    // Submit Quote button should be DISABLED
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).toBeDisabled();
    expect(submitBtns[0]).toHaveAttribute('title', 'Download RFQ first to enable bidding');

    // Clicking disabled button does not trigger router.push
    fireEvent.click(submitBtns[0]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('clicking Download RFQ downloads specification, unlocks the RFQ, and enables Submit Quote button', async () => {
    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const downloadBtn = screen.getAllByRole('button', { name: /Download RFQ/i })[0];
    expect(downloadBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    await waitFor(() => {
      expect(mockUnlockRFQForVendor).toHaveBeenCalledWith('RFQ261811804439');
    });

    // Check success toast was shown
    expect(mockShowToast).toHaveBeenCalledWith(
      'RFQ Downloaded',
      expect.stringContaining('Quote submission is now unlocked'),
      'success'
    );

    // After downloading, Submit Quote button must be ENABLED
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).not.toBeDisabled();
    expect(submitBtns[0]).toHaveAttribute('title', 'Submit quotation for this RFQ');

    // Clicking enabled Submit Quote button navigates to quotation form
    fireEvent.click(submitBtns[0]);
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form?rfq=RFQ261811804439');
  });

  test('when public RFQ is ALREADY downloaded, Submit Quote is enabled immediately', () => {
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com' },
      vendorUnlockedRfqIds: ['RFQ261811804439'],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [{ rfqNumber: 'RFQ261811804439', type: 'marketplace', sourcingMode: 'mode_0' }],
      rfqs: [publicRfq],
    });

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).not.toBeDisabled();
    expect(submitBtns[0]).toHaveAttribute('title', 'Submit quotation for this RFQ');

    fireEvent.click(submitBtns[0]);
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form?rfq=RFQ261811804439');
  });

  test('direct RFQ (not public) has Submit Quote enabled without requiring download', () => {
    const directRfq: RFQItem = {
      ...publicRfq,
      rfqNumber: 'RFQ-DIRECT-999',
      sourcingMode: 'mode_1' as any,
      assignedVendors: [
        { email: 'vendor@example.com', name: 'Veera Solutions' } as any,
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com', name: 'Veera Solutions' },
      vendorUnlockedRfqIds: [],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [{ rfqNumber: 'RFQ-DIRECT-999', type: 'direct_invitation', sourcingMode: 'mode_1' }],
      rfqs: [directRfq],
    });

    render(<RFQDetails rfq={directRfq} onBack={jest.fn()} isVendorView={true} />);

    // Direct RFQ: Submit Quote is enabled immediately
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).not.toBeDisabled();
  });

  test('closed or expired RFQ keeps Submit Quote disabled regardless of download state', () => {
    const closedRfq: RFQItem = {
      ...publicRfq,
      status: 'Closed',
    };

    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com' },
      vendorUnlockedRfqIds: ['RFQ261811804439'],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [],
      rfqs: [closedRfq],
    });

    render(<RFQDetails rfq={closedRfq} onBack={jest.fn()} isVendorView={true} />);

    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).toBeDisabled();
    expect(submitBtns[0]).toHaveAttribute('title', 'Bidding is closed for this RFQ');
  });

  test('handles credit exhaustion gracefully during download click', async () => {
    mockUnlockRFQForVendor.mockResolvedValueOnce({
      success: false,
      exhausted: true,
      error: 'Credits exhausted',
    });

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const downloadBtn = screen.getAllByRole('button', { name: /Download RFQ/i })[0];
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Free Credits Exhausted',
      expect.anything(),
      'warning'
    );

    // Submit Quote remains disabled
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns[0]).toBeDisabled();
  });

  test('handles general download failure gracefully when not exhausted', async () => {
    mockUnlockRFQForVendor.mockResolvedValueOnce({
      success: false,
      exhausted: false,
      error: 'Backend timeout',
    });

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const downloadBtn = screen.getAllByRole('button', { name: /Download RFQ/i })[0];
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Download Failed',
      'Backend timeout',
      'warning'
    );
  });

  test('executes fallback fetch when unlockRFQForVendor returns without htmlBody data', async () => {
    mockUnlockRFQForVendor.mockResolvedValueOnce({
      success: true,
      alreadyUnlocked: false,
      data: null,
    });

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const downloadBtn = screen.getAllByRole('button', { name: /Download RFQ/i })[0];
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/download'),
        expect.anything()
      );
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      'RFQ Downloaded',
      expect.stringContaining('Quote submission is now unlocked'),
      'success'
    );
  });

  test('exercises bottom CTA submit quote button and resubmit bid interactions', () => {
    const quotedRfq: RFQItem = {
      ...publicRfq,
      quotes: [
        {
          quoteId: 'q-me',
          vendorId: 'vendor-1',
          vendorName: 'Veera Solutions',
          totalPrice: 480000,
          submittedDate: '2026-11-18',
        } as any,
      ],
    };

    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com' },
      vendorUnlockedRfqIds: ['RFQ261811804439'],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [],
      rfqs: [quotedRfq],
    });

    render(<RFQDetails rfq={quotedRfq} onBack={jest.fn()} isVendorView={true} />);

    // Header Resubmit Bid button
    const resubmitBtns = screen.getAllByRole('button', { name: /Resubmit Bid/i });
    expect(resubmitBtns.length).toBeGreaterThan(0);
    fireEvent.click(resubmitBtns[0]);
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form?rfq=RFQ261811804439');

    // Panel Toolbar Resubmit Bid button
    const panelResubmitBtns = screen.getAllByTitle('Update or resubmit quotation');
    expect(panelResubmitBtns.length).toBeGreaterThan(0);
    fireEvent.click(panelResubmitBtns[panelResubmitBtns.length - 1]);
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  test('clicking bottom CTA Submit Quote navigates when unlocked and does nothing when disabled', async () => {
    // 1. Not downloaded -> Bottom CTA disabled
    const { unmount } = render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);
    const submitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    expect(submitBtns.length).toBeGreaterThan(1);
    const bottomSubmitBtn = submitBtns[submitBtns.length - 1];
    expect(bottomSubmitBtn).toBeDisabled();

    fireEvent.click(bottomSubmitBtn);
    expect(mockPush).not.toHaveBeenCalled();
    unmount();

    // 2. Downloaded -> Bottom CTA enabled
    (useApp as jest.Mock).mockReturnValue({
      currentRole: 'vendor',
      showToast: mockShowToast,
      refreshFromDB: jest.fn(),
      refreshRFQs: jest.fn(),
      syncRFQRecord: jest.fn(),
      buyerVendors: [],
      currentUserSession: { role: 'vendor', email: 'vendor@example.com' },
      vendorUnlockedRfqIds: ['RFQ261811804439'],
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      vendorOpportunities: [],
      rfqs: [publicRfq],
    });

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);
    const enabledSubmitBtns = screen.getAllByRole('button', { name: /Submit Quote/i });
    const enabledBottomBtn = enabledSubmitBtns[enabledSubmitBtns.length - 1];
    expect(enabledBottomBtn).not.toBeDisabled();

    fireEvent.click(enabledBottomBtn);
    expect(mockPush).toHaveBeenCalledWith('/vendor/quotation-form?rfq=RFQ261811804439');
  });

  test('handles download exception gracefully', async () => {
    mockUnlockRFQForVendor.mockRejectedValueOnce(new Error('Network offline'));

    render(<RFQDetails rfq={publicRfq} onBack={jest.fn()} isVendorView={true} />);

    const downloadBtn = screen.getAllByRole('button', { name: /Download RFQ/i })[0];
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Download Failed',
      'Network offline',
      'warning'
    );
  });
});
