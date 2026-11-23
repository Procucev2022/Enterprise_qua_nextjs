import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BuyerDossierDrawer from '@/app/category-manager/components/BuyerDossierDrawer';
import type { BuyerAccount, RFQItem } from '@/lib/types';
import * as buyerProfileClient from '@/lib/buyerProfileClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import * as accountDocsClient from '@/lib/accountDocumentsClient';
import { authClient } from '@/lib/authClient';
jest.mock('@/lib/accountDocumentsClient', () => ({
  createCreditApprovalIdempotencyKey: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
  requestBuyerCreditApproval: jest.fn().mockResolvedValue({ success: true, message: 'Request submitted' }),
  fetchAccountDocuments: jest.fn().mockResolvedValue([]),
  uploadAccountDocument: jest.fn().mockResolvedValue({ success: true }),
  deleteAccountDocument: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerCreditHistory: jest.fn(),
  addBuyerCredit: jest.fn(),
  updateBuyerCategories: jest.fn(),
  fetchBuyerCommunications: jest.fn(),
  fetchBuyerPaymentHistory: jest.fn(),
  recordBuyerCommunication: jest.fn(),
  fetchBuyerUploadedVendors: jest.fn().mockResolvedValue({ success: true, data: [] }),
  fetchCategoryTaxonomy: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { majorCategory: 'General Procurement', minorCategories: [] },
      { majorCategory: 'Raw Materials', minorCategories: [] },
      { majorCategory: 'Spares', minorCategories: [] },
      { majorCategory: 'Capital Equipment', minorCategories: [] },
      { majorCategory: 'IT & Telecom', minorCategories: [] },
    ],
  }),
}));

jest.mock('@/lib/internalTaskClient', () => ({
  fetchInternalAssignees: jest.fn().mockResolvedValue({
    assignees: [
      { id: 'exec-1', name: 'Test Assignee', role: 'Category Specialist' },
      { id: 'exec-2', name: 'Second Assignee', role: 'Account Manager' },
    ],
  }),
}));

jest.mock('@/lib/approvalClient', () => ({
  fetchApprovalUsers: jest.fn().mockResolvedValue({
    users: [
      { id: 'usr-govardhan', name: 'Govardhan', email: 'govardhan@procucev.com' },
      { id: 'usr-krishna', name: 'Krishna', email: 'krishna@procucev.com' },
      { id: 'session-user-1', name: 'Session Initiator', email: 'initiator@example.com' },
      { id: 'usr-buyer-001', name: 'Test Buyer', email: 'test.buyer@example.com' },
    ],
  }),
  fetchApprovalApprovers: jest.fn().mockResolvedValue({
    approvers: [
      { id: 'appr-srinu', name: 'Srinu Sir', title: 'VP Sourcing' },
      { id: 'appr-rao', name: 'Rao Sir', title: 'Director' },
      { id: 'appr-sudheer', name: 'Sudheer Sir', title: 'Head of Procurement' },
      { id: 'appr-test', name: 'Test Approver', title: 'Approver' },
      { id: 'appr-vp', name: 'VP Procurement', title: 'VP Procurement' },
    ],
  }),
}));

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn().mockResolvedValue([
    {
      id: 'doc-vault-1',
      documentName: 'Enterprise SLA Contract',
      fileName: 'sla_contract.pdf',
      fileSize: 102400,
      mimeType: 'application/pdf',
      category: 'CONTRACT',
      isActive: true,
    },
    {
      id: 'doc-vault-2',
      documentName: 'Product Rate Card',
      fileName: 'rate_card.pdf',
      fileSize: 204800,
      mimeType: 'application/pdf',
      category: 'PROPOSAL',
      isActive: true,
    },
  ]),
}));

const mockBuyer: BuyerAccount = {
  id: 'buyer-acc-1789811073812-ux3',
  organizationName: 'Veera Babu Buyer Org',
  contactPerson: 'Veera Babu V',
  corporateEmail: 'veerababuv2002@gmail.com',
  mobileNumber: '+919999999999',
  city: 'Hyderabad',
  primaryPlantLocation: 'Telangana, India',
  gstin: '36AAAAA0000A1Z5',
  industrySector: 'Information Technology',
  accountSource: 'web_registration',
  sourcingMode: 'mode_1',
  subscriptionPlan: 'free_trial',
  remainingFreeRFQs: 5,
  totalSpend: '₹0',
  totalRFQsCreated: 2,
  status: 'ACTIVE_VERIFIED',
  createdDate: '2026-09-19T05:30:00.000Z',
  syncTimestamp: '2026-10-30 10:00 UTC',
  supportedMajorCategories: ['General Procurement', 'Raw Materials', 'Spares'],
};

const mockRfqs: RFQItem[] = [
  {
    id: 'rfq-001',
    rfqNumber: 'RFQ262910731226',
    title: 'Dell Latitude Laptop Procurement',
    category: 'IT & Telecom',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 1,
    budget: 500000,
    targetDeliveryDate: '2026-11-15T00:00:00.000Z',
    deliveryLocation: 'Hyderabad, India',
    createdAt: '2026-10-29T11:01:00.000Z',
    extractedEntities: [
      {
        id: 'ent-1',
        itemName: 'Dell Latitude 5420',
        quantity: 10,
        unit: 'units',
        targetDate: '2026-11-15T00:00:00.000Z',
        technicalSpecs: '16GB RAM, 512GB SSD, Intel i7',
        confidence: 0.95,
        category: 'IT & Telecom',
        majorCategory: 'IT & Telecom',
        minorCategory: 'Laptops',
      },
    ],
    quotes: [
      {
        vendorId: 'ven-1',
        vendorName: 'Tech Supplies India',
        vendorCategory: 'Procucev Network',
        unitPrice: 50000,
        totalPrice: 500000,
        leadTimeDays: 7,
        aiMatchScore: 92,
        warrantyYears: 3,
        complianceStatus: 'Fully Compliant',
        paymentTerms: 'Net 30',
        remarks: 'Ready stock available',
      },
    ],
    assignedVendors: [{ id: 'ven-1', name: 'Tech Supplies India' }],
    chasingActive: false,
  },
  {
    id: 'rfq-002',
    rfqNumber: 'RFQ262910748064',
    title: 'Ergonomic Office Chair Procurement',
    category: 'General Procurement',
    sourcingMode: 'mode_1',
    status: 'Closed',
    quotesCount: 0,
    budget: 0,
    targetDeliveryDate: '2026-11-20T00:00:00.000Z',
    deliveryLocation: 'Mumbai, India',
    createdAt: '2026-10-29T10:28:00.000Z',
    extractedEntities: [],
    quotes: [],
    assignedVendors: [],
    chasingActive: false,
  },
];

// Generate 12 transactions for pagination testing
const generateMockTransactions = () => {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `ctx-${i + 1}`,
    transactionId: `ctx-${i + 1}`,
    transactionDate: new Date(2026, 8, 19 + i).toISOString(),
    transactionType: i % 2 === 0 ? 'Free Credits Allocated' : 'Credits Consumed',
    creditSource: i % 2 === 0 ? 'Enterprise Free Trial' : 'RFQ Creation',
    creditsAdded: i % 2 === 0 ? 5 : 0,
    creditsConsumed: i % 2 === 0 ? 0 : 1,
    previousBalance: 5,
    updatedBalance: i % 2 === 0 ? 10 : 4,
    relatedRfqId: i % 2 !== 0 ? 'RFQ262910731226' : null,
    paymentRef: i === 0 ? 'PAY-REF-1' : null,
    status: 'COMPLETED',
    description: i === 0 ? '' : `Transaction number ${i + 1}`,
  }));
};

// Generate 12 payments for pagination testing
const generateMockPayments = () => {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `pay-${i + 1}`,
    paymentId: `pay-${i + 1}`,
    invoiceNo: `INV-2026-BUYER-${i + 1}`,
    transactionDate: i % 2 === 0 ? new Date(2026, 8, 19 + i).toISOString() : undefined,
    date: i % 2 !== 0 ? new Date(2026, 8, 19 + i).toISOString() : undefined,
    description: `Payment batch ${i + 1}`,
    subscriptionPlan: 'version_3',
    amount: 50000 + i * 1000,
    currency: 'INR',
    gateway: 'Zoho Payments (India UPI / NetBanking)',
    paymentMethod: 'UPI / NetBanking',
    status: i === 1 ? 'COMPLETED' : i === 3 ? 'FAILED' : i % 2 === 0 ? 'PAID' : 'PENDING',
    receiptUrl: i === 0 ? 'https://procucev.com/receipt.pdf' : undefined,
  }));
};

describe('BuyerDossierDrawer', () => {
  const onCloseMock = jest.fn();
  const onSelectRFQMock = jest.fn();
  let clickSpy: jest.SpyInstance;
  let sessionSpy: jest.SpyInstance | undefined;

  // The credit initiator comes from the session. The approver name is typed. Both must be set before a
  // credit request can be submitted.
  const signInAndChooseApprover = () => {
    sessionSpy = jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: 'session-user-1',
      name: 'Session Initiator',
      email: 'initiator@example.com',
    } as unknown as ReturnType<typeof authClient.getSessionUser>);
    const approverInput = (document.getElementById('credit-approver') ||
      document.getElementById('discount-approver') ||
      document.getElementById('trial-approver') ||
      document.getElementById('trial-approver-select') ||
      document.getElementById('offline-approver-select')) as HTMLInputElement | HTMLSelectElement | null;
    if (approverInput) {
      fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
    }
    const initiatorInput = (document.getElementById('credit-initiator') ||
      document.getElementById('discount-initiator') ||
      document.getElementById('trial-initiator') ||
      document.getElementById('offline-initiator-select')) as HTMLInputElement | HTMLSelectElement | null;
    if (initiatorInput) {
      fireEvent.change(initiatorInput, { target: { value: 'Session Initiator' } });
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: {
        totalCreditsAllocated: 15,
        totalCreditsConsumed: 2,
        remainingFreeCredits: 5,
        purchasedCredits: 10,
        adjustedCredits: 0,
        currentEntitlementMode: 'mode_1',
        currentSubscriptionPlan: 'free_trial',
      },
      transactions: generateMockTransactions(),
    });

    (buyerProfileClient.addBuyerCredit as jest.Mock).mockResolvedValue({
      success: true,
      message: 'Successfully allocated 5 credits.',
    });

    (buyerProfileClient.updateBuyerCategories as jest.Mock).mockResolvedValue({
      success: true,
      data: { supportedMajorCategories: ['General Procurement', 'Raw Materials', 'Spares', 'IT & Telecom'] },
    });

    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'comm-1',
          accountId: 'buyer-acc-1789811073812-ux3',
          channel: 'EMAIL',
          subject: 'Enterprise Onboarding Confirmation & API Key Generation',
          sender: 'Procucev Onboarding Desk',
          recipient: 'veerababuv2002@gmail.com',
          message: 'Welcome Veera Babu V to the Procucev Enterprise Network.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-09-19T05:30:00.000Z',
        },
        {
          id: 'comm-2',
          accountId: 'buyer-acc-1789811073812-ux3',
          channel: 'SMS',
          recipient: '+919999999999',
          message: 'Your RFQ has been circulated to 5 verified suppliers.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-29T11:00:00.000Z',
        },
        {
          id: 'comm-3',
          accountId: 'buyer-acc-1789811073812-ux3',
          channel: 'WHATSAPP',
          recipient: '+919999999999',
          message: 'Quotation received from Tech Supplies India.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-29T12:00:00.000Z',
        },
        {
          id: 'comm-4',
          accountId: 'buyer-acc-1789811073812-ux3',
          channel: 'CALL',
          recipient: '+919999999999',
          message: 'Call regarding RFQ timeline discussion.',
          deliveryStatus: 'Answered',
          duration: '4m 32s',
          sentAt: '2026-10-29T14:00:00.000Z',
        },
      ],
    });

    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: {
        totalAmountPaid: 50000,
        totalSuccessfulPayments: 6,
        pendingPayments: 6,
        failedPayments: 0,
        totalRefundedAmount: 0,
      },
      payments: generateMockPayments(),
    });

    (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  afterEach(() => {
    clickSpy?.mockRestore();
    sessionSpy?.mockRestore();
    sessionSpy = undefined;
  });

  test('1. Renders Buyer Profile Header without Buyer ID, with Company Name, Sourcing Mode, Request Type button, and registration date', () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    expect(screen.getByText('Veera Babu Buyer Org')).toBeInTheDocument();
    expect(screen.getAllByText('Mode 1').length).toBeGreaterThan(0);
    expect(screen.getByTestId('request-type-dropdown-btn')).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.buyerDirectory.dossier.requestTypeDropdown)).toBeInTheDocument();
    expect(screen.getByText(/Registered:/i)).toBeInTheDocument();
    expect(screen.queryByText(/ID: buyer-acc-1789811073812-ux3/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Audit/i })).toBeNull();
  });

  test('2. Opens Add Credit modal, allows changing amount and reason, tests X close, backdrop click, Escape key, and submits', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    const openRequestModal = (type = 'Buyer Credit Addition') => {
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: type }));
    };

    openRequestModal('Buyer Credit Addition');

    expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();

    // Close via Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Request Buyer Credit Approval')).toBeNull();

    // Reopen and test Cancel button
    openRequestModal('Buyer Credit Addition');
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Request Buyer Credit Approval')).toBeNull();

    // Reopen and test X button (line 1268)
    openRequestModal('Buyer Credit Addition');
    const modalHeading = screen.getByText('Request Buyer Credit Approval');
    const modalX = modalHeading.closest('[class*="max-w-"]')?.querySelector('button');
    if (modalX) fireEvent.click(modalX);
    expect(screen.queryByText('Request Buyer Credit Approval')).toBeNull();

    // Reopen and test amount <= 0 guard (line 207)
    openRequestModal('Buyer Credit Addition');
    const amountInput = screen.getByRole('spinbutton');
    fireEvent.change(amountInput, { target: { value: '0' } });
    const reasonInput = screen.getByPlaceholderText(/Reason for credit addition|business justification/i);
    fireEvent.change(reasonInput, { target: { value: 'Quarterly bonus' } });
    fireEvent.change(reasonInput, { target: { value: '' } });
    const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
    fireEvent.click(submitBtn);
    const creditForm = submitBtn.closest('form');
    if (creditForm) fireEvent.submit(creditForm);
    expect(accountDocsClient.requestBuyerCreditApproval).not.toHaveBeenCalled();

    // Reopen with a valid amount and no reason. The reason is sent exactly as entered, which is blank.
    signInAndChooseApprover();
    fireEvent.change(amountInput, { target: { value: '10' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
        'buyer-acc-1789811073812-ux3',
        expect.objectContaining({
          requestType: 'Buyer Credit Addition',
          amount: 10,
          reason: '',
          approverName: expect.any(String),
          initiatorName: 'Session Initiator',
          idempotencyKey: expect.any(String),
        })
      );
    });
  });

  test('3. Handles Add Credit error response and exception gracefully', async () => {
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: '',
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
    signInAndChooseApprover();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } });
    const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
    fireEvent.click(submitBtn);
    const creditForm = submitBtn.closest('form');
    if (creditForm) fireEvent.submit(creditForm);

    await waitFor(() => {
      expect(screen.getByText('Failed to submit credit approval request.')).toBeInTheDocument();
    });
    const firstRequestKey = (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mock.calls[0][1].idempotencyKey;

    // Test exception branch (line 225)
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(submitBtn);
    if (creditForm) fireEvent.submit(creditForm);

    await waitFor(() => {
      expect(screen.getByText('Failed to submit credit approval request.')).toBeInTheDocument();
    });
    expect((accountDocsClient.requestBuyerCreditApproval as jest.Mock).mock.calls[1][1].idempotencyKey).toBe(firstRequestKey);
  });

  test('4. Profile tab renders categories, allows editing, adding custom category, toggling, backdrop click, Escape, and saving', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    expect(screen.getByText('Supported Divisions')).toBeInTheDocument();
    expect(screen.getByText('General Procurement')).toBeInTheDocument();

    const editBtn = screen.getByText('Edit');
    fireEvent.click(editBtn);

    expect(screen.getByText('Edit Supported Divisions')).toBeInTheDocument();

    // Test Escape key closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Edit Supported Divisions')).toBeNull();

    // Reopen modal and test X button (line 1349)
    fireEvent.click(screen.getByText('Edit'));
    const xButtons = screen.getAllByRole('button');
    const modalX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-lg'));
    if (modalX) fireEvent.click(modalX);
    expect(screen.queryByText('Edit Supported Divisions')).toBeNull();

    // Reopen modal for full operations
    fireEvent.click(screen.getByText('Edit'));

    // Remove Raw Materials using delete button inside badge (line 1413)
    const rawMatSpans = screen.getAllByText('Raw Materials');
    const badgeContainer = rawMatSpans[rawMatSpans.length - 1].closest('.inline-flex');
    const removeBtn = badgeContainer?.querySelector('button');
    if (removeBtn) fireEvent.click(removeBtn);

    // Test category search input with < 3 chars shows hint
    const searchInput = screen.getByPlaceholderText(/Search category/i);
    fireEvent.change(searchInput, { target: { value: 'ca' } });
    expect(screen.getByText(/Type at least 3 characters to search/i)).toBeInTheDocument();

    // Test category search input with >= 3 chars shows matching suggestions
    fireEvent.change(searchInput, { target: { value: 'Pump' } });
    expect(screen.queryByText(/Type at least 3 characters to search/i)).toBeNull();

    const addCustomBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.click(addCustomBtn);

    // Add another category
    fireEvent.change(searchInput, { target: { value: 'Packaging & Logistics' } });
    fireEvent.click(addCustomBtn);

    const saveBtn = screen.getByText('Save Categories');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalledWith(
        'buyer-acc-1789811073812-ux3',
        expect.arrayContaining(['General Procurement', 'Spares', 'Pumps & Accessories', 'Packaging & Logistics'])
      );
    });
  });

  test('5. Profile tab category edit failure displays error message (both res.error and catch)', async () => {
    (buyerProfileClient.updateBuyerCategories as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: '',
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save Categories'));

    await waitFor(() => {
      expect(screen.getByText('Failed to update categories')).toBeInTheDocument();
    });

    (buyerProfileClient.updateBuyerCategories as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByText('Save Categories'));

    await waitFor(() => {
      expect(screen.getByText('An error occurred while saving categories')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit Supported Divisions')).toBeNull();
  });

  test('6. RFQs tab renders RFQ table, filtering, searching, clicking RFQ Number opens popup modal, Escape, and handles view full details', () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    const rfqsTab = screen.getByRole('button', { name: /RFQs/i });
    fireEvent.click(rfqsTab);

    const searchInput = screen.getByPlaceholderText(/Search RFQs by number or title/i);
    fireEvent.change(searchInput, { target: { value: 'Dell' } });
    expect(screen.getByText('Dell Latitude Laptop Procurement')).toBeInTheDocument();
    expect(screen.queryByText('Ergonomic Office Chair Procurement')).toBeNull();

    fireEvent.change(searchInput, { target: { value: '' } });
    const statusSelect = screen.getByDisplayValue(/All Statuses/i);
    fireEvent.change(statusSelect, { target: { value: 'Closed' } });
    expect(screen.getByText('Ergonomic Office Chair Procurement')).toBeInTheDocument();
    expect(screen.queryByText('Dell Latitude Laptop Procurement')).toBeNull();

    // Click chair RFQ to test open budget and awaiting quotes
    const chairBtn = screen.getByText('RFQ262910748064');
    fireEvent.click(chairBtn);
    expect(screen.getByText('Open Budget')).toBeInTheDocument();
    expect(screen.getByText('Awaiting vendor quotation submissions.')).toBeInTheDocument();

    // Close via X button (line 1476)
    const xButtons = screen.getAllByRole('button');
    const rfqModalX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-2xl'));
    if (rfqModalX) fireEvent.click(rfqModalX);
    expect(screen.queryByText('Open Budget')).toBeNull();

    fireEvent.change(statusSelect, { target: { value: 'all' } });

    // Open via external link icon button (line 744)
    const viewPopupBtns = screen.getAllByTitle('View RFQ Popup');
    fireEvent.click(viewPopupBtns[0]);

    expect(screen.getByText('Line Items & Technical Specifications')).toBeInTheDocument();
    expect(screen.getByText('Dell Latitude 5420')).toBeInTheDocument();

    const viewFullLink = screen.getByText(/View Full Details/i);
    fireEvent.click(viewFullLink);
    expect(onSelectRFQMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'rfq-001' }));

    // Reopen modal via RFQ number button to test close button
    const rfqNumberBtn = screen.getByText('RFQ262910731226');
    fireEvent.click(rfqNumberBtn);
    expect(screen.getByText('Line Items & Technical Specifications')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Line Items & Technical Specifications')).toBeNull();
  });

  test('7. Credit tab renders summary, filters by type, search, sort order, pagination next/prev, and exports CSV', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    const creditTab = screen.getByRole('button', { name: /^Credit$/i });
    fireEvent.click(creditTab);

    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerCreditHistory).toHaveBeenCalledWith('buyer-acc-1789811073812-ux3');
    });

    expect(await screen.findByText('Total Credits Allocated')).toBeInTheDocument();
    expect(screen.getByText('Remaining Free Credits')).toBeInTheDocument();

    // Pagination test (lines 917-925)
    expect(screen.getByText(/Showing 1 to 10 of 12 transactions/i)).toBeInTheDocument();
    const paginationButtons = screen.getAllByRole('button');
    const chevronRightBtn = paginationButtons.find((btn) => btn.querySelector('.lucide-chevron-right'));
    if (chevronRightBtn) {
      fireEvent.click(chevronRightBtn);
      expect(screen.getByText(/Showing 11 to 12 of 12 transactions/i)).toBeInTheDocument();
      const chevronLeftBtn = paginationButtons.find((btn) => btn.querySelector('.lucide-chevron-left'));
      if (chevronLeftBtn) fireEvent.click(chevronLeftBtn);
    }

    const creditSearchInput = screen.getByPlaceholderText(/Search by transaction ID or RFQ ID/i);
    fireEvent.change(creditSearchInput, { target: { value: 'ctx-1' } });
    expect(screen.getByText('ctx-1')).toBeInTheDocument();

    fireEvent.change(creditSearchInput, { target: { value: '' } });

    const creditTypeSelect = screen.getByDisplayValue(/All Types/i);
    fireEvent.change(creditTypeSelect, { target: { value: 'Free Credits Allocated' } });
    expect(screen.getAllByText('Free Credits Allocated').length).toBeGreaterThan(0);

    fireEvent.change(creditTypeSelect, { target: { value: 'all' } });

    const sortBtn = screen.getByRole('button', { name: /Newest First/i });
    fireEvent.click(sortBtn);
    expect(screen.getByText(/Oldest First/i)).toBeInTheDocument();

    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  test('8. Communications tab displays 4 sub-tabs, filters by date, searches SMS, backdrop click, X button, and opens details modal with Escape', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    const commsTab = screen.getByRole('button', { name: /Communications/i });
    fireEvent.click(commsTab);

    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerCommunications).toHaveBeenCalledWith('buyer-acc-1789811073812-ux3');
    });

    const commSearchInput = screen.getByPlaceholderText(/Search (?:email )?communications/i);
    fireEvent.change(commSearchInput, { target: { value: 'Onboarding' } });
    expect(await screen.findByText('Enterprise Onboarding Confirmation & API Key Generation')).toBeInTheDocument();

    // Date filter change (line 982)
    const dateInput = screen.getByDisplayValue('');
    fireEvent.change(dateInput, { target: { value: '2026-09-19' } });
    expect(screen.getByText('Enterprise Onboarding Confirmation & API Key Generation')).toBeInTheDocument();
    fireEvent.change(dateInput, { target: { value: '' } });

    const viewBtn = screen.getByRole('button', { name: /View Full Content/i });
    fireEvent.click(viewBtn);
    expect(await screen.findByText('Email Dispatch Details')).toBeInTheDocument();

    // Reopen and test X button (line 1632)
    fireEvent.click(screen.getByRole('button', { name: /View Full Content/i }));
    const xButtons = screen.getAllByRole('button');
    const emailX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-lg'));
    if (emailX) fireEvent.click(emailX);
    expect(screen.queryByText('Email Dispatch Details')).toBeNull();

    // Reopen and test Escape
    fireEvent.click(screen.getByRole('button', { name: /View Full Content/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Email Dispatch Details')).toBeNull();

    // Reopen and test Close button (line 1657)
    fireEvent.click(screen.getByRole('button', { name: /View Full Content/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Email Dispatch Details')).toBeNull();

    // Clear search before switching sub-tabs
    fireEvent.change(commSearchInput, { target: { value: '' } });

    // Switch to SMS tab (line 313)
    const smsTab = screen.getByRole('button', { name: /SMS/i });
    fireEvent.click(smsTab);
    expect(await screen.findByText('Your RFQ has been circulated to 5 verified suppliers.')).toBeInTheDocument();

    const smsSearch = screen.getByPlaceholderText(/Search sms communications/i);
    fireEvent.change(smsSearch, { target: { value: 'circulated' } });
    expect(screen.getByText('Your RFQ has been circulated to 5 verified suppliers.')).toBeInTheDocument();
    fireEvent.change(smsSearch, { target: { value: '' } });

    // Switch to WhatsApp sub-tab
    const whatsappTab = screen.getByRole('button', { name: /WhatsApp/i });
    fireEvent.click(whatsappTab);
    expect(await screen.findByText('Quotation received from Tech Supplies India.')).toBeInTheDocument();

    // Switch to Call Logs sub-tab
    const callTab = screen.getByRole('button', { name: /Call Logs/i });
    fireEvent.click(callTab);
    expect(await screen.findByText('Call regarding RFQ timeline discussion.')).toBeInTheDocument();
    expect(screen.getByText(/4m 32s/i)).toBeInTheDocument();
  });

  test('9. Payments tab displays payment summary cards, search, status filter, pagination next/prev, backdrop click, X button, details modal with Escape, and exports CSV', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    const paymentsTab = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(paymentsTab);

    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerPaymentHistory).toHaveBeenCalledWith('buyer-acc-1789811073812-ux3');
    });

    expect(await screen.findByText('Total Amount Paid')).toBeInTheDocument();

    // Pagination test (lines 1213-1221)
    expect(screen.getByText(/Showing 1 to 10 of 12 payments/i)).toBeInTheDocument();
    const paginationButtons = screen.getAllByRole('button');
    const chevronRightBtn = paginationButtons.find((btn) => btn.querySelector('.lucide-chevron-right'));
    if (chevronRightBtn) {
      fireEvent.click(chevronRightBtn);
      expect(screen.getByText(/Showing 11 to 12 of 12 payments/i)).toBeInTheDocument();
      const chevronLeftBtn = paginationButtons.find((btn) => btn.querySelector('.lucide-chevron-left'));
      if (chevronLeftBtn) fireEvent.click(chevronLeftBtn);
    }

    const paymentSearchInput = screen.getByPlaceholderText(/Search payments by invoice or description/i);
    fireEvent.change(paymentSearchInput, { target: { value: 'INV-2026-BUYER-1' } });
    expect(await screen.findByText('INV-2026-BUYER-1')).toBeInTheDocument();

    const statusSelect = screen.getByDisplayValue(/All Statuses/i);
    fireEvent.change(statusSelect, { target: { value: 'PAID' } });
    expect(screen.getByText('INV-2026-BUYER-1')).toBeInTheDocument();

    const sortBtn = screen.getByRole('button', { name: /Newest First/i });
    fireEvent.click(sortBtn);
    expect(screen.getByText(/Oldest First/i)).toBeInTheDocument();

    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);
    expect(clickSpy).toHaveBeenCalled();

    const detailsBtn = screen.getAllByRole('button', { name: 'Details' })[0];
    fireEvent.click(detailsBtn);
    expect(await screen.findByText('Payment Record Details')).toBeInTheDocument();
    expect(screen.getByText('Download Invoice')).toBeInTheDocument();

    // Reopen and test X button (line 1686)
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    const xButtons = screen.getAllByRole('button');
    const payX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-md'));
    if (payX) fireEvent.click(payX);
    expect(screen.queryByText('Payment Record Details')).toBeNull();

    // Reopen and test Escape
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Payment Record Details')).toBeNull();

    // Reopen and test Close button (line 1730)
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Payment Record Details')).toBeNull();

    // Test non-Escape key press (line 373 false branch)
    fireEvent.keyDown(window, { key: 'Enter' });
  });

  test('10. Handles empty states and API errors across all tabs gracefully', async () => {
    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Failed to fetch credit records',
      transactions: [],
    });

    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

    render(
      <BuyerDossierDrawer
        buyer={{ ...mockBuyer, supportedMajorCategories: [] }}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={[]}
      />
    );

    // Profile tab
    expect(screen.getByText('Supported Divisions')).toBeInTheDocument();

    // RFQ tab
    fireEvent.click(screen.getByRole('button', { name: /RFQs/i }));
    expect(screen.getByText('No RFQs created by this buyer yet.')).toBeInTheDocument();

    // Credit tab
    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));
    await waitFor(() => {
      expect(screen.getByText('No credit transactions recorded matching filters.')).toBeInTheDocument();
    });

    // Communications tab
    fireEvent.click(screen.getByRole('button', { name: /Communications/i }));
    await waitFor(() => {
      expect(screen.getByText(/No recorded (?:EMAIL )?communications found/i)).toBeInTheDocument();
    });

    // Payments tab
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.buyerDirectory.dossier.payments.loadFailure)).toBeInTheDocument();
    });
    const retryButton = screen.getByRole('button', {
      name: UI_STRINGS.buyerDirectory.dossier.payments.retry,
    });
    fireEvent.click(retryButton);
    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerPaymentHistory).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(UI_STRINGS.buyerDirectory.dossier.payments.loadFailure)).not.toBeInTheDocument();
    });
  });

  test('explains when durable credit history is missing', async () => {
    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      historyAvailable: false,
      summary: {
        totalCreditsAllocated: 0,
        totalCreditsConsumed: 0,
        remainingFreeCredits: 4,
        purchasedCredits: 0,
        adjustedCredits: 0,
        currentEntitlementMode: 'mode_1',
        currentSubscriptionPlan: 'free_trial',
      },
      transactions: [],
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));

    expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.historyUnavailable)).toBeInTheDocument();
  });

  test('shows an empty payment state only after the stored history loads successfully', async () => {
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: {
        totalAmountPaid: 0,
        totalSuccessfulPayments: 0,
        pendingPayments: 0,
        failedPayments: 0,
        totalRefundedAmount: 0,
      },
      payments: [],
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));

    expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.payments.noRecords)).toBeInTheDocument();
    expect(screen.queryByText(UI_STRINGS.buyerDirectory.dossier.payments.loadFailure)).not.toBeInTheDocument();
  });

  test('11. Close Dossier button and Escape key trigger onClose callback', () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
      />
    );

    // Test Escape key calls onClose when no modals are open
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    const closeDossierBtn = screen.getByRole('button', { name: 'Close Dossier' });
    fireEvent.click(closeDossierBtn);

    expect(onCloseMock).toHaveBeenCalledTimes(2);

    // Dialog backdrop click (line 459)
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onCloseMock).toHaveBeenCalledTimes(3);
  });
  test('12. Renders sparse buyer and sparse RFQ to verify all default fallbacks and remaining branches', async () => {
    const sparseBuyer: any = {
      id: 'buyer-sparse',
      organizationName: 'Sparse Org',
      corporateEmail: 'sparse@test.com',
      sourcingMode: 'mode_0',
      createdDate: '',
    };

    const sparseRfq: any = {
      id: 'rfq-sparse',
      rfqNumber: 'RFQ-SPARSE',
      title: 'Sparse RFQ',
      category: 'General',
      sourcingMode: 'mode_0',
      budget: 0,
      createdAt: '2026-10-30',
      extractedEntities: [
        {
          id: 'item-1',
          itemName: 'Minimal Item',
          quantity: 2,
        },
      ],
      quotes: [
        {
          vendorId: 'v-1',
          unitPrice: 100,
        },
      ],
    };

    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: null,
      transactions: [
        {
          id: 'tx-sparse',
          transactionId: 'TX-SPARSE',
          transactionDate: '2026-10-30',
          transactionType: 'Credit Adjustment',
          creditSource: 'Manual',
          creditsAdded: 0,
          creditsConsumed: 1,
          previousBalance: 5,
          updatedBalance: 4,
          status: 'COMPLETED',
          description: 'sparse',
        },
      ],
    });

    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'comm-sparse',
          accountId: 'buyer-sparse',
          channel: 'SMS',
          recipient: '+919999999999',
          message: 'sparse msg',
          sentAt: '2026-10-30',
        },
      ],
    });

    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: null,
      payments: [
        {
          id: 'p-sparse',
          paymentId: 'P-SPARSE',
          invoiceNo: 'INV-SPARSE',
          date: '2026-10-30',
          description: 'sparse',
          subscriptionPlan: 'custom',
          amount: 1000,
          currency: 'INR',
          gateway: 'Custom',
          paymentMethod: 'Card',
          status: 'PAID',
        },
        {
          id: 'p-sparse-2',
          paymentId: 'P-SPARSE-2',
          invoiceNo: 'INV-SPARSE-2',
          date: '2026-10-30',
          description: 'sparse 2',
          subscriptionPlan: 'custom',
          amount: 500,
          currency: 'INR',
          gateway: 'Custom',
          paymentMethod: 'UPI',
          status: 'PENDING',
        },
      ],
    });

    render(
      <BuyerDossierDrawer
        buyer={sparseBuyer}
        onClose={onCloseMock}
        buyerRfqs={[sparseRfq]}
      />
    );

    // Profile fallbacks
    // Missing record values show a dash. They are not replaced by stand-in text.
    expect(screen.queryByText('Procurement Executive')).toBeNull();
    expect(screen.queryByText('+91 Not provided')).toBeNull();
    expect(screen.queryByText('Enterprise Trial')).toBeNull();
    expect(screen.queryByText('ACTIVE')).toBeNull();
    expect(screen.queryByText('Real-time')).toBeNull();
    expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThan(0);

    // RFQ tab with sparse RFQ modal and Escape (line 375)
    fireEvent.click(screen.getByRole('button', { name: /RFQs/i }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    fireEvent.click(screen.getByText('RFQ-SPARSE'));
    expect(screen.getByText('Open Budget')).toBeInTheDocument();
    expect(screen.getByText('Minimal Item')).toBeInTheDocument();
    expect(screen.queryByText('Vendor 1')).toBeNull();
    // Test Escape key closes RFQ modal (line 375)
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Open Budget')).toBeNull();

    // Switch to Credit tab
    const creditTab = screen.getByRole('button', { name: /^Credit$/i });
    fireEvent.click(creditTab);

    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerCreditHistory).toHaveBeenCalledWith('buyer-sparse');
    });

    expect(await screen.findByText('TX-SPARSE')).toBeInTheDocument();

    const creditSortBtn = screen.getByRole('button', { name: /Newest First|Oldest First/i });
    fireEvent.click(creditSortBtn);
    fireEvent.click(creditSortBtn);

    // Switch to Communications tab
    const commsTabBtn = screen.getByRole('button', { name: /Communications/i });
    fireEvent.click(commsTabBtn);
    expect(await screen.findByText('sparse msg')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Email$/i }));
    expect(await screen.findByText(/No recorded (?:EMAIL )?communications found for this buyer\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /SMS/i }));
    expect(await screen.findByText('sparse msg')).toBeInTheDocument();

    // Switch to Payments tab
    const payTabBtn = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(payTabBtn);
    expect(await screen.findByText('INV-SPARSE')).toBeInTheDocument();

    const paySortBtn = screen.getByRole('button', { name: /Newest First|Oldest First/i });
    fireEvent.click(paySortBtn);
    fireEvent.click(paySortBtn);

    // Test default argument buyerRfqs = [] (line 82)
    const { unmount } = render(
      <BuyerDossierDrawer
        buyer={sparseBuyer}
        onClose={onCloseMock}
      />
    );
    expect(screen.getAllByText('Sparse Org').length).toBeGreaterThan(0);
    unmount();
  });

test('Payments tab renders exactly 4 summary cards and removes refund summary card', async () => {
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: {
        totalPaid: 450000,
        totalPayments: 10,
        successfulPayments: 8,
        pendingPayments: 1,
        failedPayments: 1,
        refundedPayments: 0,
        totalRefunded: 0,
        currency: 'INR',
      },
      transactions: [],
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="payments"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Total Amount Paid')).toBeInTheDocument();
    });
    expect(screen.getByText('Total Successful Payments')).toBeInTheDocument();
    expect(screen.getByText('Pending Payments')).toBeInTheDocument();
    expect(screen.getByText('Failed Payments')).toBeInTheDocument();
    expect(screen.queryByText(/Total Refunded Amount/i)).toBeNull();
  });

  test('respects initialTab prop and triggers onTabChange callback', () => {
    const onTabChange = jest.fn();
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        buyerRfqs={mockRfqs}
        initialTab="rfqs"
        onTabChange={onTabChange}
      />
    );

    expect(screen.getByText('Dell Latitude Laptop Procurement')).toBeInTheDocument();

    const commsTab = screen.getByRole('button', { name: /Communications/i });
    fireEvent.click(commsTab);
    expect(onTabChange).toHaveBeenCalledWith('communications');
  });

  test('opens Record Communication modal and dispatches recordBuyerCommunication', async () => {
    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      communications: [],
    });
    (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({
      success: true,
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        buyerRfqs={mockRfqs}
        initialTab="communications"
      />
    );

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    expect(screen.getByPlaceholderText(/Price negotiation|Brief summary/i)).toBeInTheDocument();

    // Fill modal form fields
    const subjectInput = screen.getByPlaceholderText(/Price negotiation|Brief summary/i);
    const bodyTextarea = screen.getByPlaceholderText(/Enter detailed conversation notes|Key details/i);
    fireEvent.change(subjectInput, { target: { value: 'Followup on pricing' } });
    fireEvent.change(bodyTextarea, { target: { value: 'Buyer requested lower price on item 2' } });

    const saveBtn = screen.getByRole('button', { name: /Save & Synchronize Tasks|Save Record/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
        mockBuyer.id,
        expect.objectContaining({
          subject: 'Followup on pricing',
          message: 'Buyer requested lower price on item 2',
        })
      );
    });
  });

  test('comprehensive test covering all compose modal channels, fallbacks, backdrop clicks, and errors', async () => {
    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'comm-rcpt',
          accountId: mockBuyer.id,
          channel: 'SMS',
          recipient: 'special-recipient-number',
          message: 'Short text alert',
          sentAt: '2026-10-31',
        },
      ],
    });

    const buyerWithMobileOnly = {
      ...mockBuyer,
      corporateEmail: undefined,
      mobileNumber: '+919123456789',
    };

    const { rerender } = render(
      <BuyerDossierDrawer
        buyer={buyerWithMobileOnly as any}
        onClose={onCloseMock}
        buyerRfqs={mockRfqs}
        initialTab="communications"
      />
    );

    await waitFor(() => {
      expect(buyerProfileClient.fetchBuyerCommunications).toHaveBeenCalled();
    });

    // Switch sub-tabs and verify composeChannel auto-sets
    // SMS sub-tab
    const smsSubTab = screen.getByRole('button', { name: /SMS/i });
    fireEvent.click(smsSubTab);

    // Test searching by recipient
    const commSearchInput = screen.getByPlaceholderText(/Search sms communications/i);
    fireEvent.change(commSearchInput, { target: { value: 'special-recipient' } });
    expect(await screen.findByText('Short text alert')).toBeInTheDocument();
    fireEvent.change(commSearchInput, { target: { value: '' } });

    // Open compose from SMS
    const recordBtnSMS = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnSMS);
    expect(screen.getByPlaceholderText(/Price negotiation|Brief summary/i)).toBeInTheDocument();

    // Verify recipient defaulted to mobileNumber
    const recipientInput = screen.getByPlaceholderText(/buyer@company\.com|Recipient email/i);
    expect(recipientInput).toHaveValue('+919123456789');

    // Close via backdrop click (inner vs outer)
    const composeDialog = screen.getByPlaceholderText(/Price negotiation|Brief summary/i).closest('[role="dialog"]');
    // Click inner content does not close
    const modalInner = screen.getByPlaceholderText(/Price negotiation|Brief summary/i).closest('.max-w-lg');
    if (modalInner) fireEvent.click(modalInner);
    expect(screen.getByPlaceholderText(/Price negotiation|Brief summary/i)).toBeInTheDocument();

    // Click backdrop closes
    if (composeDialog) fireEvent.click(composeDialog);
    expect(screen.queryByPlaceholderText(/Price negotiation|Brief summary/i)).toBeNull();

    // Open from WhatsApp sub-tab
    const waSubTab = screen.getByRole('button', { name: /WhatsApp/i });
    fireEvent.click(waSubTab);
    const recordBtnWA = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnWA);

    // Close via Cancel button
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(screen.queryByPlaceholderText(/Price negotiation|Brief summary/i)).toBeNull();

    // Open from Call Logs sub-tab
    const callSubTab = screen.getByRole('button', { name: /Call Logs/i });
    fireEvent.click(callSubTab);
    const recordBtnCall = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnCall);

    // Close via X button
    const xBtn = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-x') && b.closest('.max-w-lg'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByPlaceholderText(/Price negotiation|Brief summary/i)).toBeNull();

    // Open and close via Escape
    const emailSubTab = screen.getByRole('button', { name: /Email/i });
    fireEvent.click(emailSubTab);
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/Price negotiation|Brief summary/i)).toBeNull();

    // Test form validation: empty message trimmed does not submit
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    const msgTextarea = screen.getByPlaceholderText(/Enter detailed conversation notes|Key details/i);
    fireEvent.change(msgTextarea, { target: { value: '   ' } });
    const saveBtn = screen.getByRole('button', { name: /Save & Synchronize Tasks|Save Record/i });
    fireEvent.click(saveBtn);
    expect(buyerProfileClient.recordBuyerCommunication).not.toHaveBeenCalled();

    // Test changing channel dropdown, empty subject fallback, empty recipient fallback
    // Select channels via modal channel buttons
    const modalChannelBtns = screen.getAllByRole('button');
    const waBtn = modalChannelBtns.find(b => b.textContent?.includes('WhatsApp') && b.closest('.grid-cols-4'));
    if (waBtn) fireEvent.click(waBtn);
    const smsBtn = modalChannelBtns.find(b => b.textContent?.includes('SMS') && b.closest('.grid-cols-4'));
    if (smsBtn) fireEvent.click(smsBtn);
    const callBtn = modalChannelBtns.find(b => b.textContent?.includes('Call Log') && b.closest('.grid-cols-4'));
    if (callBtn) fireEvent.click(callBtn);

    // Empty recipient and empty subject
    fireEvent.change(screen.getByPlaceholderText(/buyer@company\.com|Recipient email/i), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText(/Price negotiation|Brief summary/i), { target: { value: '' } });
    fireEvent.change(msgTextarea, { target: { value: 'Test call summary notes' } });

    (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Dispatch failed on carrier',
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
        mockBuyer.id,
        expect.objectContaining({
          channel: 'CALL',
          subject: 'Buyer Communication: CALL',
          message: 'Test call summary notes',
        })
      );
    });

    // Test API response with success: false and no error message
    (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledTimes(2);
    });

    // Test API rejection / catch block
    (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockRejectedValueOnce(new Error('Network offline'));
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledTimes(3);
    });

    // Test fallback recipient when neither corporateEmail nor mobileNumber exists
    const buyerNoContact = {
      ...mockBuyer,
      corporateEmail: undefined,
      mobileNumber: undefined,
    };
    rerender(
      <BuyerDossierDrawer
        buyer={buyerNoContact as any}
        onClose={onCloseMock}
        buyerRfqs={mockRfqs}
        initialTab="communications"
      />
    );
  });

  test('comprehensive test for Add Credit modal edge cases, Edit Categories backdrop, and RFQ popup edge cases', async () => {
    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: null,
      transactions: [],
    });

    const rfqWithFullBids: any = {
      id: 'rfq-detailed',
      rfqNumber: 'RFQ-DETAILED-001',
      title: 'Detailed RFQ Procurement',
      sourcingMode: 'mode_1',
      budget: 50000,
      createdAt: '2026-10-31',
      targetDeliveryDate: undefined, // test fallback to 'Standard'
      assignedVendors: ['v1', 'v2'],
      extractedEntities: [
        {
          id: 'ent-1',
          itemName: 'Special Steel Rods',
          technicalSpecs: '', // empty technicalSpecs
          quantity: 100,
          unit: '', // empty unit fallback to 'units'
          targetDate: undefined, // fallback to '-'
        },
      ],
      quotes: [
        {
          id: 'q-1',
          vendorId: 'v-steel',
          vendorName: 'Apex Steel Corp',
          totalPrice: 48000,
          leadTimeDays: 7,
          submittedAt: '2026-10-31',
          status: 'SUBMITTED',
        },
      ],
    };

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        buyerRfqs={[rfqWithFullBids]}
        initialTab="rfqs"
      />
    );

    // Open RFQ modal
    const viewRfqBtn = screen.getByTitle('View RFQ Popup');
    fireEvent.click(viewRfqBtn);
    expect(screen.getAllByText('RFQ-DETAILED-001').length).toBeGreaterThan(0);
    expect(screen.queryByText('Standard')).toBeNull();
    expect(screen.getByText('Special Steel Rods')).toBeInTheDocument();
    expect(screen.getByText('100 units')).toBeInTheDocument();
    expect(screen.getByText('Apex Steel Corp')).toBeInTheDocument();

    // Test backdrop click on RFQ modal (inner does not close, dialog backdrop closes)
    const rfqDialog = screen.getByRole('dialog', { name: 'RFQ Details' });
    const innerTitle = screen.getAllByText('Detailed RFQ Procurement')[0];
    fireEvent.click(innerTitle);
    expect(screen.getAllByText('RFQ-DETAILED-001').length).toBeGreaterThan(0);
    fireEvent.click(rfqDialog);
    expect(screen.queryByRole('dialog', { name: 'RFQ Details' })).toBeNull();

    // Test Edit Categories modal backdrop click
    const profileTab = screen.getByRole('button', { name: /^Profile$/i });
    fireEvent.click(profileTab);
    const editCatBtn = screen.getByText('Edit');
    fireEvent.click(editCatBtn);
    expect(screen.getByText('Edit Supported Divisions')).toBeInTheDocument();

    // Inner click does not close
    fireEvent.click(screen.getByText('Edit Supported Divisions'));
    expect(screen.getByText('Edit Supported Divisions')).toBeInTheDocument();

    // Backdrop click closes
    const catDialog = screen.getByText('Edit Supported Divisions').closest('[role="dialog"]');
    if (catDialog) fireEvent.click(catDialog);
    expect(screen.queryByText('Edit Supported Divisions')).toBeNull();

    // Test Add Credit modal edge cases
    const openAddCredit = () => {
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
    };
    openAddCredit();
    expect(screen.getByRole('heading', { name: 'Request Buyer Credit Approval' })).toBeInTheDocument();

    // Inner click does not close
    fireEvent.click(screen.getByRole('heading', { name: 'Request Buyer Credit Approval' }));
    expect(screen.getByRole('heading', { name: 'Request Buyer Credit Approval' })).toBeInTheDocument();

    // Empty input sets 0 via isNaN
    const creditAmountInput = screen.getByRole('spinbutton');
    fireEvent.change(creditAmountInput, { target: { value: '' } });
    expect(creditAmountInput).toHaveValue(0);

    // Form submission with amount <= 0 does not call addBuyerCredit
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);
    expect(accountDocsClient.requestBuyerCreditApproval).not.toHaveBeenCalled();

    // Fill a valid amount and choose an approver. A blank reason is sent as entered.
    signInAndChooseApprover();
    fireEvent.change(creditAmountInput, { target: { value: '10' } });
    const reasonTextarea = screen.getByPlaceholderText(/Reason for credit addition|business justification/i);
    fireEvent.change(reasonTextarea, { target: { value: '' } });

    // API success with no custom message
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({ success: true });
    fireEvent.click(submitBtn);
    const form = submitBtn.closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
    });

    // Reopen and test API failure with no custom error
    openAddCredit();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
    });

    // Reopen and test API rejection / throw
    openAddCredit();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('DB failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalled();
    });

    // Close via backdrop click
    openAddCredit();
    const creditDialog = screen.getByRole('heading', { name: /Request Buyer Credit Addition Approval|Request Buyer Credit Approval/i }).closest('[role="dialog"]');
    if (creditDialog) fireEvent.click(creditDialog);
    expect(screen.queryByRole('heading', { name: /Request Buyer Credit Addition Approval|Request Buyer Credit Approval/i })).toBeNull();
  });

  test('payments sort handles items without transactionDate or date', async () => {
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: null,
      payments: [
        {
          id: 'p-no-date-1',
          paymentId: 'PAY-ND1',
          invoiceNo: 'INV-ND1',
          amount: 100,
          status: 'PAID',
          description: 'No date test 1',
        },
        {
          id: 'p-no-date-2',
          paymentId: 'PAY-ND2',
          invoiceNo: 'INV-ND2',
          amount: 200,
          status: 'PAID',
          description: 'No date test 2',
        },
      ],
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="payments"
      />
    );

    expect(await screen.findByText('INV-ND1')).toBeInTheDocument();
    const sortBtn = screen.getByRole('button', { name: /Newest First/i });
    fireEvent.click(sortBtn);
    expect(screen.getByText(/Oldest First/i)).toBeInTheDocument();
  });

  test('exercises full followup workflow, call outcomes, and receiptUrl in payments modal', async () => {
    (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
    });
    (buyerProfileClient.recordBuyerCommunication as jest.Mock).mockResolvedValue({
      success: true,
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="communications"
      />
    );

    // Switch to Call Logs sub-tab first
    fireEvent.click(screen.getByRole('button', { name: /Call Logs/i }));

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    // Toggle channel buttons inside modal
    const composeDialog = screen.getByPlaceholderText(/Price negotiation|Brief summary/i).closest('[role="dialog"]') as HTMLElement;
    const modalChannelBtns = within(composeDialog).getAllByRole('button');
    const emailModalBtn = modalChannelBtns.find(b => b.textContent?.trim() === 'Email');
    if (emailModalBtn) fireEvent.click(emailModalBtn);
    const waModalBtn = modalChannelBtns.find(b => b.textContent?.trim() === 'WhatsApp');
    if (waModalBtn) fireEvent.click(waModalBtn);
    const smsModalBtn = modalChannelBtns.find(b => b.textContent?.trim() === 'SMS');
    if (smsModalBtn) fireEvent.click(smsModalBtn);
    const callModalBtn = modalChannelBtns.find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn) fireEvent.click(callModalBtn);

    // Call outcome and duration inputs
    const outcomeSelect = screen.getByDisplayValue(UI_STRINGS.dataLoad.emptyCell);
    fireEvent.change(outcomeSelect, { target: { value: 'Left Voicemail' } });

    const durationInput = screen.getByPlaceholderText(/e\.g\. 10 mins/i);
    fireEvent.change(durationInput, { target: { value: '15 mins' } });

    // Next followup date
    const followupDateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(followupDateInput).toBeInTheDocument();
    fireEvent.change(followupDateInput, { target: { value: '2026-11-05T14:30' } });

    // Priority change
    const prioritySelect = screen.getByDisplayValue(/Priority: Medium/i);
    fireEvent.change(prioritySelect, { target: { value: 'Critical' } });

    // Assignee change - test both matching member and non-matching member
    const assigneeSelect = screen.getByDisplayValue(/Select Assignee/i);
    fireEvent.change(assigneeSelect, { target: { value: 'exec-2' } });
    expect(screen.getByDisplayValue(/Second Assignee/i)).toBeInTheDocument();
    fireEvent.change(assigneeSelect, { target: { value: 'NON_EXISTENT_ID' } });

    // Followup objective
    const followupNotesInput = screen.getByPlaceholderText(/Action items for next scheduled interaction|Agenda or deliverables for next interaction/i);
    fireEvent.change(followupNotesInput, { target: { value: 'Final contract signing follow-up' } });

    // Test Clear button
    const clearBtn = screen.getByRole('button', { name: 'Clear' });
    fireEvent.click(clearBtn);

    // Re-add date
    fireEvent.change(followupDateInput, { target: { value: '2026-11-05T14:30' } });

    // Subject and message
    const subjectInput = screen.getByPlaceholderText(/Price negotiation|Brief summary/i);
    fireEvent.change(subjectInput, { target: { value: 'Executive alignment call' } });
    const messageInput = screen.getByPlaceholderText(/Enter detailed conversation notes|Key details/i);
    fireEvent.change(messageInput, { target: { value: 'Reviewed credit terms and finalized 15% annual pricing.' } });

    const saveBtn = screen.getByRole('button', { name: /Save Record|Save & Synchronize Tasks/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(buyerProfileClient.recordBuyerCommunication).toHaveBeenCalledWith(
        mockBuyer.id,
        expect.objectContaining({
          channel: 'CALL',
          duration: '15 mins',
          nextFollowupDate: '2026-11-05T14:30',
        })
      );
    });
  });

  test('payment details modal renders download invoice link when receiptUrl is present', async () => {
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: null,
      payments: [
        {
          id: 'p-receipt-1',
          paymentId: 'PAY-RCP-1',
          invoiceNo: 'INV-RCP-101',
          amount: 25000,
          status: 'SUCCESS',
          description: 'Quarterly enterprise tier',
          subscriptionPlan: 'Enterprise Pro',
          gateway: 'Razorpay',
          paymentMethod: 'Net Banking',
          receiptUrl: 'https://procucev.com/invoices/INV-RCP-101.pdf',
          transactionDate: '2026-10-25',
        },
      ],
    });

    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="payments"
      />
    );

    const viewPaymentBtn = await screen.findByRole('button', { name: 'Details' });
    fireEvent.click(viewPaymentBtn);

    expect(screen.getByText('Payment Record Details')).toBeInTheDocument();
    expect(screen.getByText('Download Invoice')).toBeInTheDocument();

    // Close payment modal via backdrop click (inner does not close, outer closes)
    const paymentDialog = screen.getByText('Payment Record Details').closest('[role="dialog"]');
    fireEvent.click(screen.getAllByText('Quarterly enterprise tier')[1]);
    expect(screen.getByText('Payment Record Details')).toBeInTheDocument();
    if (paymentDialog) fireEvent.click(paymentDialog);
    expect(screen.queryByText('Payment Record Details')).toBeNull();
  });

  test('handles buyer commercial email scenario selection and auto-attachments', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="communications"
      />
    );

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const composeDialog = (await screen.findByPlaceholderText(/Price negotiation|Brief summary/i)).closest('[role="dialog"]') as HTMLElement;

    // Switch to Email subtab inside composeDialog
    const modalBtns = within(composeDialog).getAllByRole('button');
    const emailModalBtn = modalBtns.find(b => b.textContent?.trim() === 'Email');
    if (emailModalBtn) fireEvent.click(emailModalBtn);

    // Change Scenario to Subscription Offer
    const scenarioSelect = within(composeDialog).getByText(/Select Conversion Scenario/i).closest('div')?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(scenarioSelect, { target: { value: 'buyer_subscription_offer' } });

    // Verify subject and message were interpolated
    const subjectInput = within(composeDialog).getByPlaceholderText(/Price negotiation|Brief summary/i) as HTMLInputElement;
    expect(subjectInput.value).toContain('Enterprise Sourcing Plan Overview - Veera Babu Buyer Org');

    // Change to Conversion Followup
    fireEvent.change(scenarioSelect, { target: { value: 'buyer_conversion_followup' } });
    expect(subjectInput.value).toContain('Procurement Optimization');

    // Test empty scenario selection
    fireEvent.change(scenarioSelect, { target: { value: '' } });

    // Test custom scenario selection
    fireEvent.change(scenarioSelect, { target: { value: 'custom' } });
    expect(scenarioSelect.value).toBe('custom');

    // Test custom scenario selection
    fireEvent.change(scenarioSelect, { target: { value: 'custom' } });
    expect(scenarioSelect.value).toBe('custom');
  });

  test('handles quick action email drafting for various call outcomes', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="communications"
      />
    );

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const composeDialog = (await screen.findByPlaceholderText(/Price negotiation|Brief summary/i)).closest('[role="dialog"]') as HTMLElement;

    // Switch to Call subtab
    const getModalBtns = () => within(composeDialog).getAllByRole('button');
    const callModalBtn = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn) fireEvent.click(callModalBtn);

    // Click Connected outcome draft button
    const connectedBtn = within(composeDialog).getByRole('button', { name: /Draft for Connected/i });
    fireEvent.click(connectedBtn);
    expect(within(composeDialog).getByPlaceholderText(/Price negotiation|Brief summary/i)).toBeInTheDocument();

    // Click Call Log again and test Left Voicemail
    const callModalBtn2 = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn2) fireEvent.click(callModalBtn2);
    const vmBtn = within(composeDialog).getByRole('button', { name: /Draft for Left Voicemail/i });
    fireEvent.click(vmBtn);

    // Click Call Log again and test Busy
    const callModalBtn3 = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn3) fireEvent.click(callModalBtn3);
    const busyBtn = within(composeDialog).getByRole('button', { name: /Draft for Busy/i });
    fireEvent.click(busyBtn);

    // Click Call Log again and test No Answer
    const callModalBtn4 = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn4) fireEvent.click(callModalBtn4);
    const noAnswerBtn = within(composeDialog).getByRole('button', { name: /Draft for No Answer/i });
    fireEvent.click(noAnswerBtn);

    // Click Call Log again and test Wrong Number
    const callModalBtn5 = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn5) fireEvent.click(callModalBtn5);
    const wrongNumBtn = within(composeDialog).getByRole('button', { name: /Draft for Wrong Number/i });
    fireEvent.click(wrongNumBtn);

    // Set followup date and test Convert Call to Followup Email button
    const callModalBtn6 = getModalBtns().find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn6) fireEvent.click(callModalBtn6);
    const dateInput = composeDialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    if (dateInput) fireEvent.change(dateInput, { target: { value: '2026-11-10T14:00' } });
    const convertBtn = within(composeDialog).getByRole('button', { name: /Email Follow-up Call Schedule to Buyer/i });
    fireEvent.click(convertBtn);
  });

  test('toggles vault dropdown and attaches/removes vault collateral and local files', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        initialTab="communications"
      />
    );

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const composeDialog = (await screen.findByPlaceholderText(/Price negotiation|Brief summary/i)).closest('[role="dialog"]') as HTMLElement;

    // Switch to Email subtab
    const modalBtns = within(composeDialog).getAllByRole('button');
    const emailModalBtn = modalBtns.find(b => b.textContent?.trim() === 'Email');
    if (emailModalBtn) fireEvent.click(emailModalBtn);

    // Open Document Vault dropdown
    const vaultDropdownBtn = within(composeDialog).getByText(/Select collateral from Document Vault\.\.\./i);
    fireEvent.click(vaultDropdownBtn);

    // Select Product Rate Card from vault
    const rateCardOption = await within(composeDialog).findByText('Product Rate Card');
    fireEvent.click(rateCardOption);

    // Verify rate card attachment badge appears
    expect(within(composeDialog).getAllByText('Product Rate Card').length).toBeGreaterThan(0);

    // Click again to unselect
    fireEvent.click(rateCardOption);

    // Select again so we can test the badge X removal button
    fireEvent.click(rateCardOption);

    // Attach local file
    const file = new File(['mock content'], 'test_specs.pdf', { type: 'application/pdf' });
    const fileInput = composeDialog.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [file] } });
      expect(await within(composeDialog).findByText(/test specs \(Local Upload\)/i)).toBeInTheDocument();
    }

    // Remove attachment via X button
    const removeBtns = within(composeDialog).getAllByRole('button').filter(b => b.querySelector('svg.lucide-x'));
    if (removeBtns.length > 0) {
      fireEvent.click(removeBtns[0]);
    }

    // Test file input with empty files list
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [] } });
    }
  });

  test('covers buyer scenario branch fallbacks with prefilled notes and unknown outcome', async () => {
    const sparseBuyer = {
      ...mockBuyer,
      contactPerson: undefined,
      organizationName: '',
      corporateEmail: undefined,
      mobileNumber: undefined,
    } as unknown as BuyerAccount;

    render(
      <BuyerDossierDrawer
        buyer={sparseBuyer}
        onClose={onCloseMock}
        initialTab="communications"
      />
    );

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const composeDialog = (await screen.findByPlaceholderText(/Price negotiation|Brief summary/i)).closest('[role="dialog"]') as HTMLElement;

    // Prefill followup notes and message
    const msgInput = within(composeDialog).getByPlaceholderText(/Enter detailed conversation notes|Key details/i);
    fireEvent.change(msgInput, { target: { value: 'Pre-existing draft notes' } });

    // Switch to Call tab and trigger unknown outcome fallback
    const modalBtns = within(composeDialog).getAllByRole('button');
    const callModalBtn = modalBtns.find(b => b.textContent?.trim() === 'Call Log');
    if (callModalBtn) fireEvent.click(callModalBtn);

    // Click Convert Call to Followup Email with prefilled notes
    const dateInput = composeDialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    if (dateInput) fireEvent.change(dateInput, { target: { value: '2026-11-20T10:00' } });
    const convertBtn = within(composeDialog).getByRole('button', { name: /Email Follow-up Call Schedule to Buyer/i });
    fireEvent.click(convertBtn);

    // Select non-matching scenario
    const scenarioSelect = within(composeDialog).getByText(/Select Conversion Scenario/i).closest('div')?.querySelector('select') as HTMLSelectElement;
    fireEvent.change(scenarioSelect, { target: { value: 'NON_EXISTENT_SCENARIO' } });
  });

  it('requires an approver name before a buyer credit request is submitted', async () => {
    render(
      <BuyerDossierDrawer buyer={mockBuyer} onClose={onCloseMock} onSelectRFQ={onSelectRFQMock} buyerRfqs={mockRfqs} />
    );
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: 'session-user-1',
      name: 'Session Initiator',
      email: 'initiator@example.com',
    } as unknown as ReturnType<typeof authClient.getSessionUser>);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));
    const approverSelect = document.getElementById('credit-approver') as HTMLSelectElement;
    if (approverSelect) {
      fireEvent.change(approverSelect, { target: { value: '' } });
    }
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    const form = screen.getByRole('button', { name: /Submit for Approval/i }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);

    expect(
      await screen.findByText(UI_STRINGS.buyerDirectory.dossier.creditApproval.approverRequired)
    ).toBeInTheDocument();
    expect(accountDocsClient.requestBuyerCreditApproval).not.toHaveBeenCalled();
  });

  it('shows the server reason when the buyer credit history reports a failure', async () => {
    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Credit ledger is unavailable.',
    });
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="credits"
      />
    );

    expect(await screen.findByText('Credit ledger is unavailable.')).toBeInTheDocument();
  });

  it('shows the credit load message when the buyer credit history request throws', async () => {
    (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockRejectedValueOnce(new Error('Socket closed'));
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="credits"
      />
    );

    expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.credit.loadFailure)).toBeInTheDocument();
  });

  it('shows the server reason when the buyer payment history reports a failure', async () => {
    (buyerProfileClient.fetchBuyerPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Payment gateway timed out.',
    });
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="payments"
      />
    );

    expect(await screen.findByText('Payment gateway timed out.')).toBeInTheDocument();
  });

  it('opens the RFQ matrix from the RFQs tab', () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="rfqs"
      />
    );

    fireEvent.click(screen.getAllByTitle('Open RFQ Matrix')[0]);
    expect(onSelectRFQMock).toHaveBeenCalledWith(mockRfqs[0]);
  });

  it('gives a local compose attachment an id from crypto.randomUUID, removes it, and refuses files when that API is missing', async () => {
    render(
      <BuyerDossierDrawer
        buyer={mockBuyer}
        onClose={onCloseMock}
        onSelectRFQ={onSelectRFQMock}
        buyerRfqs={mockRfqs}
        initialTab="communications"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Record Communication/i }));
    const composeDialog = (await screen.findByPlaceholderText(/Price negotiation|Brief summary/i)).closest(
      '[role="dialog"]'
    ) as HTMLElement;
    const fileInput = composeDialog.querySelector('input[type="file"]') as HTMLInputElement;

    const randomUUID = jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-0000000000aa');
    fireEvent.change(fileInput, {
      target: { files: [new File(['spec'], 'spec sheet.pdf', { type: 'application/pdf' })] },
    });
    expect(await within(composeDialog).findByText(/spec sheet \(Local Upload\)/i)).toBeInTheDocument();
    expect(randomUUID).toHaveBeenCalled();
    randomUUID.mockRestore();

    fireEvent.click(
      screen.getByText(/spec sheet \(Local Upload\)/i).parentElement?.querySelector('button') as HTMLButtonElement
    );
    expect(within(composeDialog).queryByText(/spec sheet \(Local Upload\)/i)).not.toBeInTheDocument();

    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      fireEvent.change(fileInput, {
        target: { files: [new File(['other'], 'other.pdf', { type: 'application/pdf' })] },
      });
      expect(await screen.findByText(UI_STRINGS.dataLoad.secureIdUnavailable)).toBeInTheDocument();
      expect(within(composeDialog).queryByText(/other \(Local Upload\)/i)).not.toBeInTheDocument();
    } finally {
      delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    }
  });

  describe('Buyer Uploaded Vendors Tab', () => {
    const mockUploadedVendors = [
      {
        id: 'v-up-1',
        name: 'GKS Enterprises',
        companyName: 'GKS Enterprises Pvt Ltd',
        contactPerson: 'Yuvraj Singh J',
        email: 'gksenterprisesblr@gmail.com',
        phone: '7760405823',
        createdAt: '2026-11-14T12:48:00.000Z',
        status: 'ACTIVE',
        majorCategory: 'Mechanical & Fluid Equipment',
        location: 'Bangalore, Karnataka',
        gstin: '29ABCDE1234F1Z5',
        pan: 'ABCDE1234F',
        source: 'buyer_uploaded',
      },
      {
        id: 'v-up-2',
        name: 'Apex Tools Ltd',
        companyName: 'Apex Precision Corp',
        contactPerson: 'Ramesh Kumar',
        email: 'ramesh@apextools.in',
        phone: '9876543210',
        createdAt: '2026-11-10T10:00:00.000Z',
        status: 'PENDING',
        majorCategory: 'Industrial Supplies',
        location: 'Mumbai, Maharashtra',
      },
    ];

    it('renders the Buyer Uploaded Vendors tab button with count', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: mockUploadedVendors,
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      expect(
        await screen.findByRole('button', {
          name: new RegExp(`${UI_STRINGS.buyerDirectory.dossier.uploadedVendorsTab} \\(2\\)`, 'i'),
        })
      ).toBeInTheDocument();
    });

    it('displays the uploaded vendors table and filters by search and status', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
        success: true,
        data: mockUploadedVendors,
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
          initialTab="uploaded-vendors"
        />
      );

      expect(await screen.findByText('GKS Enterprises')).toBeInTheDocument();
      expect(screen.getByText('Apex Tools Ltd')).toBeInTheDocument();
      expect(screen.getByText('Yuvraj Singh J')).toBeInTheDocument();
      expect(screen.getByText('gksenterprisesblr@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('7760405823')).toBeInTheDocument();

      // Search filter
      const searchInput = screen.getByPlaceholderText(UI_STRINGS.buyerDirectory.dossier.uploadedVendors.searchPlaceholder);
      fireEvent.change(searchInput, { target: { value: 'Apex' } });
      expect(screen.getByText('Apex Tools Ltd')).toBeInTheDocument();
      expect(screen.queryByText('GKS Enterprises')).not.toBeInTheDocument();

      // Clear search and status filter
      fireEvent.change(searchInput, { target: { value: '' } });
      const statusSelect = screen.getByLabelText(/Filter by vendor status/i);
      fireEvent.change(statusSelect, { target: { value: 'PENDING' } });
      expect(screen.getByText('Apex Tools Ltd')).toBeInTheDocument();
      expect(screen.queryByText('GKS Enterprises')).not.toBeInTheDocument();
    });

    it('opens vendor details modal when clicking View Details and closes it', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock).mockResolvedValue({
        success: true,
        data: mockUploadedVendors,
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
          initialTab="uploaded-vendors"
        />
      );

      const viewBtns = await screen.findAllByRole('button', {
        name: new RegExp(UI_STRINGS.buyerDirectory.dossier.uploadedVendors.viewDetails, 'i'),
      });
      fireEvent.click(viewBtns[0]);

      expect(await screen.findByText(UI_STRINGS.buyerDirectory.dossier.uploadedVendors.vendorDetailsTitle)).toBeInTheDocument();
      expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();
      expect(screen.getByText('Mechanical & Fluid Equipment')).toBeInTheDocument();

      // Close modal
      const closeBtns = screen.getAllByRole('button', {
        name: UI_STRINGS.buyerDirectory.dossier.uploadedVendors.closeModal,
      });
      fireEvent.click(closeBtns[0]);
      expect(screen.queryByText(UI_STRINGS.buyerDirectory.dossier.uploadedVendors.vendorDetailsTitle)).not.toBeInTheDocument();
    });

    it('displays error state and retries fetching', async () => {
      (buyerProfileClient.fetchBuyerUploadedVendors as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true, data: [] });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
          initialTab="uploaded-vendors"
        />
      );

      expect(await screen.findByText('Network error')).toBeInTheDocument();
      const retryBtns = screen.getAllByRole('button', {
        name: UI_STRINGS.buyerDirectory.dossier.uploadedVendors.retry,
      });
      fireEvent.click(retryBtns[0]);

      expect(
        await screen.findByText(UI_STRINGS.buyerDirectory.dossier.uploadedVendors.emptyMessage)
      ).toBeInTheDocument();
    });
  });

  describe('Request Type dropdown and multiple approval request types', () => {
    test('toggles Request Type dropdown and closes on click outside', () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      const dropdownBtn = screen.getByTestId('request-type-dropdown-btn');
      fireEvent.click(dropdownBtn);
      expect(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Buyer Credit Deletion' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Discounts' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Trial Periods' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Offline Payments' })).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('menuitem', { name: 'Buyer Credit Addition' })).toBeNull();
    });

    test('validates and submits Buyer Credit Deletion', async () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Deletion' }));
      signInAndChooseApprover();

      expect(screen.getByText('Request Buyer Credit Deletion')).toBeInTheDocument();
      const amountInput = screen.getByRole('spinbutton');
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });

      // Exceed available credits
      fireEvent.change(amountInput, { target: { value: '999' } });
      const form = submitBtn.closest('form') as HTMLFormElement;
      fireEvent.submit(form);
      expect(
        await screen.findByText(/Cannot deduct 999 credits/i)
      ).toBeInTheDocument();

      // Valid deduction
      fireEvent.change(amountInput, { target: { value: '5' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
          'buyer-acc-1789811073812-ux3',
          expect.objectContaining({
            requestType: 'Buyer Credit Deletion',
            amount: 5,
          })
        );
      });
    });

    test('validates and submits Discounts request', async () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      fireEvent.click(screen.getByRole('button', { name: /12 Months/i }));
      signInAndChooseApprover();

      expect(screen.getByText('Request Discount Approval')).toBeInTheDocument();
      const amountInput = screen.getByRole('spinbutton');
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });

      // Out of bounds: > 100
      fireEvent.change(amountInput, { target: { value: '150' } });
      const form = submitBtn.closest('form') as HTMLFormElement;
      fireEvent.submit(form);
      expect(
        await screen.findByText(/Please enter a valid discount percentage/i)
      ).toBeInTheDocument();

      // Valid discount: 25%
      fireEvent.change(amountInput, { target: { value: '25' } });
      fireEvent.submit(form);

      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
          'buyer-acc-1789811073812-ux3',
          expect.objectContaining({
            requestType: 'Discounts',
            discountPercentage: 25,
            amount: 25,
          })
        );
      });
    });

    test('validates and submits Trial Periods request', async () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      signInAndChooseApprover();

      expect(screen.getByText('Request Trial Period Approval')).toBeInTheDocument();
      const startDateInput = document.getElementById('trial-start-date') as HTMLInputElement;
      const endDateInput = document.getElementById('trial-end-date') as HTMLInputElement;
      fireEvent.change(startDateInput, { target: { value: '2026-11-01' } });
      fireEvent.change(endDateInput, { target: { value: '2026-12-16' } });
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });

      // Valid trial automatically calculated from dates: 45 days
      const form = submitBtn.closest('form') as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
          'buyer-acc-1789811073812-ux3',
          expect.objectContaining({
            requestType: 'Trial Periods',
            durationDays: 45,
            amount: 45,
          })
        );
      });
    });

    test('validates and submits Offline Payments request requiring reference', async () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
      signInAndChooseApprover();

      expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();
      const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
      expect(dateInput).toBeInTheDocument();
      fireEvent.change(dateInput, { target: { value: '2026-11-20' } });

      const amountInput = screen.getByRole('spinbutton');
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });

      // Valid amount but missing transaction ID (default payment type is NEFT / RTGS)
      fireEvent.change(amountInput, { target: { value: '25000' } });
      expect(submitBtn).toBeDisabled();

      const form = submitBtn.closest('form') as HTMLFormElement;
      fireEvent.submit(form);
      expect(
        await screen.findByText(/Transaction ID is mandatory for NEFT \/ RTGS/i)
      ).toBeInTheDocument();

      // Fill transaction ID
      const txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
      fireEvent.change(txInput, { target: { value: 'CHQ-987654' } });
      expect(submitBtn).toBeEnabled();
      fireEvent.submit(form);

      await waitFor(() => {
        expect(accountDocsClient.requestBuyerCreditApproval).toHaveBeenCalledWith(
          'buyer-acc-1789811073812-ux3',
          expect.objectContaining({
            requestType: 'Offline Payments',
            amount: 25000,
            transactionId: 'CHQ-987654',
          })
        );
      });
    });

    test('popup does not close when interacting with inputs, dropdowns, and buttons inside it; closes on backdrop click, X button, or Escape', () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      // 1. Verify single plus symbol on Request Type button
      const reqBtn = screen.getByTestId('request-type-dropdown-btn');
      expect(reqBtn).toBeInTheDocument();
      expect(reqBtn.textContent).toBe('Request Type');
      expect(reqBtn.textContent).not.toContain('+');

      // Open Request Type dropdown and select 'Buyer Credit Addition'
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Buyer Credit Addition' }));

      // Popup is now open
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();

      // Click inside the popup on inputs, text, labels, buttons - popup MUST NOT CLOSE, and drawer MUST NOT CLOSE
      const amountInput = screen.getByRole('spinbutton');
      fireEvent.click(amountInput);
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();

      fireEvent.change(amountInput, { target: { value: '25' } });
      fireEvent.click(amountInput);
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();

      const approverSelect = document.getElementById('credit-approver') as HTMLSelectElement;
      expect(approverSelect).toBeInTheDocument();
      fireEvent.click(approverSelect);
      fireEvent.change(approverSelect, { target: { value: 'Finance Lead' } });
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();

      const reasonTextarea = screen.getByPlaceholderText(/Reason for credit addition|business justification/i);
      fireEvent.click(reasonTextarea);
      fireEvent.change(reasonTextarea, { target: { value: 'Annual enterprise quota adjustment' } });
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();

      // Click on modal dialog card content container
      const modalHeading = screen.getByText('Request Buyer Credit Approval');
      fireEvent.click(modalHeading);
      expect(screen.getByText('Request Buyer Credit Approval')).toBeInTheDocument();
      expect(onCloseMock).not.toHaveBeenCalled();

      // Click the X button closes ONLY the popup, does NOT close the drawer
      const modalCard = modalHeading.closest('[class*="max-w-"]');
      const closeXBtn = modalCard?.querySelector('button');
      expect(closeXBtn).toBeInTheDocument();
      fireEvent.click(closeXBtn!);
      expect(screen.queryByText('Request Buyer Credit Approval')).toBeNull();
      expect(onCloseMock).not.toHaveBeenCalled();

      // Reopen popup and test Escape key closes popup, does NOT close the drawer
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));
      expect(screen.getAllByText('Select Sourcing Mode').length).toBeGreaterThan(0);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryAllByText('Select Sourcing Mode').length).toBe(0);
      expect(onCloseMock).not.toHaveBeenCalled();

      // Reopen popup and test clicking backdrop (outside dialog card) closes popup, does NOT close the drawer
      fireEvent.click(reqBtn);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Periods' }));
      expect(screen.getAllByText('Select Sourcing Mode').length).toBeGreaterThan(0);

      const dialogBackdrop = screen.getAllByRole('dialog').find(el => el.classList.contains('z-60'));
      expect(dialogBackdrop).toBeInTheDocument();

      // Clicking inside modal card does not close
      fireEvent.click(screen.getAllByText('Select Sourcing Mode')[0]);
      expect(screen.getAllByText('Select Sourcing Mode').length).toBeGreaterThan(0);
      expect(onCloseMock).not.toHaveBeenCalled();

      // Clicking backdrop closes popup only
      fireEvent.click(dialogBackdrop!);
      expect(screen.queryAllByText('Select Sourcing Mode').length).toBe(0);
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    test('covers discount workflow cancel, close, mode 3 with 6 months, and error responses', async () => {
      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          buyerRfqs={mockRfqs}
        />
      );

      // Step 1: cancel and close
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      expect(screen.getAllByText('Select Sourcing Mode').length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryAllByText('Select Sourcing Mode').length).toBe(0);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      const closeBtnStep1 = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtnStep1);
      expect(screen.queryAllByText('Select Sourcing Mode').length).toBe(0);

      // Step 2: cancel and close
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 3/i }));
      expect(screen.getByText('Select Billing Duration')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Select Billing Duration')).toBeNull();

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 3/i }));
      const closeBtnStep2 = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtnStep2);
      expect(screen.queryByText('Select Billing Duration')).toBeNull();

      // Step 3: 6 Months, cancel and close, and error handling
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 3/i }));
      fireEvent.click(screen.getByRole('button', { name: /6 Months/i }));
      expect(screen.getAllByText(/Discount Percentage/i).length).toBeGreaterThanOrEqual(1);

      const closeBtnStep3 = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtnStep3);
      expect(screen.queryAllByText(/Discount Percentage/i)).toHaveLength(0);

      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 3/i }));
      fireEvent.click(screen.getByRole('button', { name: /6 Months/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryAllByText(/Discount Percentage/i)).toHaveLength(0);

      // Reopen and test error response
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Discount approval quota exceeded',
      });
      fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Discounts' }));
      fireEvent.click(screen.getByRole('button', { name: /Mode 1/i }));
      fireEvent.click(screen.getByRole('button', { name: /6 Months/i }));
      const approverSelect = document.getElementById('discount-approver') as HTMLSelectElement;
      expect(approverSelect).toBeInTheDocument();
      fireEvent.change(approverSelect, { target: { value: 'Srinu Sir' } });
      const amountInput = screen.getByRole('spinbutton');
      fireEvent.change(amountInput, { target: { value: '15' } });
      const reasonInput = screen.getByPlaceholderText(/Reason for discount request/i);
      fireEvent.change(reasonInput, { target: { value: 'Strategic pilot agreement' } });
      const backBtn = screen.getByRole('button', { name: /Back/i });
      fireEvent.click(backBtn);
      expect(screen.getByText('Select Billing Duration')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /6 Months/i }));
      const submitBtn = screen.getByRole('button', { name: /Submit for Approval/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Discount approval quota exceeded')).toBeInTheDocument();
      });

      // Test exception thrown
      (accountDocsClient.requestBuyerCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network drop'));
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(screen.getByText('Failed to submit discount approval request.')).toBeInTheDocument();
      });
    });
  });

  describe('Permanent Bug Fixes & Regression Gate', () => {
    it('viewing credit history does not trigger buyer account write mutation or permission error and settles loading cleanly', async () => {
      (buyerProfileClient.fetchBuyerCreditHistory as jest.Mock).mockResolvedValueOnce({
        success: true,
        summary: {
          totalCreditsAllocated: 56,
          totalCreditsConsumed: 51,
          remainingFreeCredits: 5,
          purchasedCredits: 0,
          adjustedCredits: 0,
          currentEntitlementMode: 'mode_1',
          currentSubscriptionPlan: 'version_3',
        },
        transactions: [
          {
            id: 'ctx-rfq-1',
            transactionId: 'ctx-rfq-1',
            transactionDate: '2026-11-20T10:00:00Z',
            transactionType: 'Credits Consumed',
            creditSource: 'MODE_1',
            creditsAdded: null,
            creditsConsumed: 1,
            previousBalance: 5,
            updatedBalance: 5,
            relatedRfqId: 'rfq-test-1',
            status: 'COMPLETED',
            description: 'Credit consumed for RFQ RFQ001: Test Requisition',
          },
          {
            id: 'ctx-add-1',
            transactionId: 'ctx-add-1',
            transactionDate: '2026-11-22T03:00:00Z',
            transactionType: 'Admin Credit Addition',
            creditSource: 'Action Center Internal Tasks Approval',
            creditsAdded: 5,
            creditsConsumed: null,
            previousBalance: 0,
            updatedBalance: 5,
            status: 'COMPLETED',
            description: 'Internal Task approved: 5 credits',
          },
        ],
        historyAvailable: true,
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          initialTab="credits"
        />
      );

      // Verify that credit history is loaded and cards are rendered
      await waitFor(() => {
        expect(screen.getByText('56')).toBeInTheDocument();
        expect(screen.getByText('51')).toBeInTheDocument();
      });

      // Assert that no permission error toast is shown
      expect(screen.queryByText(/You do not have permission to modify buyer accounts/i)).toBeNull();
      expect(screen.queryByText(/Update Failed/i)).toBeNull();

      // Assert loading spinner has settled
      expect(screen.queryByText(/Loading complete credit history/i)).toBeNull();

      // Assert transactions are rendered
      expect(screen.getByText('Credit consumed for RFQ RFQ001: Test Requisition')).toBeInTheDocument();
      expect(screen.getByText('Internal Task approved: 5 credits')).toBeInTheDocument();

      // Test filter by Credits Consumed
      const filterSelect = screen.getByDisplayValue('All Types');
      fireEvent.change(filterSelect, { target: { value: 'Credits Consumed' } });
      expect(screen.getByText('Credit consumed for RFQ RFQ001: Test Requisition')).toBeInTheDocument();
      expect(screen.queryByText('Internal Task approved: 5 credits')).toBeNull();
    });

    it('viewing communications tab loads all aggregated emails, SMS, and notifications without error', async () => {
      (buyerProfileClient.fetchBuyerCommunications as jest.Mock).mockResolvedValue({
        success: true,
        data: [
          {
            id: 'pdc_1',
            channel: 'Email',
            recipient: 'buyer@example.com',
            subject: '[Approval Update] Request REQ-1 Approved',
            message: 'Your approval request has been approved.',
            deliveryStatus: 'Delivered',
            acknowledgementStatus: 'Acknowledged',
            sentAt: '2026-11-22T10:00:00Z',
          },
          {
            id: 'comm-rfq-email-1',
            channel: 'Email',
            recipient: 'buyer@example.com',
            subject: '[RFQ Acknowledgement] Requisition RFQ-1 Created',
            message: 'Requisition RFQ-1 has been successfully logged.',
            deliveryStatus: 'Delivered',
            acknowledgementStatus: 'Acknowledged',
            sentAt: '2026-11-21T09:00:00Z',
          },
          {
            id: 'comm-rfq-sms-1',
            channel: 'SMS',
            recipient: '+91 9876543210',
            subject: '[SMS Alert] RFQ RFQ-1 Registered',
            message: 'Dear Buyer, your RFQ RFQ-1 has been registered.',
            deliveryStatus: 'Delivered',
            acknowledgementStatus: 'Acknowledged',
            sentAt: '2026-11-21T09:00:00Z',
          },
        ],
      });

      render(
        <BuyerDossierDrawer
          buyer={mockBuyer}
          onClose={onCloseMock}
          onSelectRFQ={onSelectRFQMock}
          initialTab="communications"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('[Approval Update] Request REQ-1 Approved')).toBeInTheDocument();
        expect(screen.getByText('[RFQ Acknowledgement] Requisition RFQ-1 Created')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Update Failed/i)).toBeNull();
      expect(screen.queryByText(/You do not have permission to modify buyer accounts/i)).toBeNull();
    });
  });

});
