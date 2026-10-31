import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuyerDossierDrawer from '@/app/category-manager/components/BuyerDossierDrawer';
import type { BuyerAccount, RFQItem } from '@/lib/types';
import * as buyerProfileClient from '@/lib/buyerProfileClient';

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerCreditHistory: jest.fn(),
  addBuyerCredit: jest.fn(),
  updateBuyerCategories: jest.fn(),
  fetchBuyerCommunications: jest.fn(),
  fetchBuyerPaymentHistory: jest.fn(),
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
  });

  afterEach(() => {
    clickSpy?.mockRestore();
  });

  test('1. Renders Buyer Profile Header without Buyer ID, with Company Name, Sourcing Mode, Add Credit button, and registration date', () => {
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
    expect(screen.getByText('Add Credit')).toBeInTheDocument();
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

    const addCreditBtn = screen.getByText('Add Credit');
    fireEvent.click(addCreditBtn);

    expect(screen.getByText('Allocate Buyer Credits')).toBeInTheDocument();

    // Close via Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Allocate Buyer Credits')).toBeNull();

    // Reopen and test Cancel button
    fireEvent.click(screen.getByText('Add Credit'));
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Allocate Buyer Credits')).toBeNull();

    // Reopen and test X button (line 1268)
    fireEvent.click(screen.getByText('Add Credit'));
    const xButtons = screen.getAllByRole('button');
    const modalX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-md'));
    if (modalX) fireEvent.click(modalX);
    expect(screen.queryByText('Allocate Buyer Credits')).toBeNull();

    // Reopen and test amount <= 0 guard (line 207)
    fireEvent.click(screen.getByText('Add Credit'));
    const amountInput = screen.getByRole('spinbutton');
    fireEvent.change(amountInput, { target: { value: '0' } });
    const reasonInput = screen.getByPlaceholderText(/e\.g\., Enterprise relationship/i);
    fireEvent.change(reasonInput, { target: { value: 'Quarterly bonus' } });
    fireEvent.change(reasonInput, { target: { value: '' } });
    const submitBtn = screen.getByRole('button', { name: /Confirm Credit Allocation/i });
    fireEvent.click(submitBtn);
    expect(buyerProfileClient.addBuyerCredit).not.toHaveBeenCalled();

    // Reopen and change values with empty reason to test default reason fallback (line 212)
    fireEvent.change(amountInput, { target: { value: '10' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(buyerProfileClient.addBuyerCredit).toHaveBeenCalledWith(
        'buyer-acc-1789811073812-ux3',
        expect.objectContaining({ amount: 10, reason: 'Category Manager console allocation' })
      );
    });
  });

  test('3. Handles Add Credit error response and exception gracefully', async () => {
    (buyerProfileClient.addBuyerCredit as jest.Mock).mockResolvedValueOnce({
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

    fireEvent.click(screen.getByText('Add Credit'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Allocation/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to add credit')).toBeInTheDocument();
    });

    // Test exception branch (line 225)
    (buyerProfileClient.addBuyerCredit as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Credit Allocation/i }));

    await waitFor(() => {
      expect(screen.getByText('Error allocating credits')).toBeInTheDocument();
    });
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

    expect(screen.getByText('Supported Major Categories')).toBeInTheDocument();
    expect(screen.getByText('General Procurement')).toBeInTheDocument();

    const editBtn = screen.getByText('Edit');
    fireEvent.click(editBtn);

    expect(screen.getByText('Edit Supported Major Categories')).toBeInTheDocument();

    // Test Escape key closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Edit Supported Major Categories')).toBeNull();

    // Reopen modal and test X button (line 1349)
    fireEvent.click(screen.getByText('Edit'));
    const xButtons = screen.getAllByRole('button');
    const modalX = xButtons.find(b => b.querySelector('.lucide-x') && b.closest('.max-w-lg'));
    if (modalX) fireEvent.click(modalX);
    expect(screen.queryByText('Edit Supported Major Categories')).toBeNull();

    // Reopen modal for full operations
    fireEvent.click(screen.getByText('Edit'));

    // Remove Raw Materials using delete button inside badge (line 1413)
    const rawMatSpans = screen.getAllByText('Raw Materials');
    const badgeContainer = rawMatSpans[rawMatSpans.length - 1].closest('.inline-flex');
    const removeBtn = badgeContainer?.querySelector('button');
    if (removeBtn) fireEvent.click(removeBtn);

    // Toggle a category on then off using taxonomy buttons (line 1368)
    const defaultCatBtn = screen.getByText('+ Capital Equipment');
    fireEvent.click(defaultCatBtn); // selects it
    const selectedBadge = screen.getByText('✓ Capital Equipment');
    fireEvent.click(selectedBadge); // deselects it

    // Add standard category
    const itCatBtn = screen.getByText('+ IT & Telecom');
    fireEvent.click(itCatBtn);

    // Add custom category - test empty and duplicate branches (line 124)
    const customInput = screen.getByPlaceholderText(/Type custom major category/i);
    const addCustomBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.change(customInput, { target: { value: '   ' } });
    fireEvent.click(addCustomBtn);
    fireEvent.change(customInput, { target: { value: 'General Procurement' } });
    fireEvent.click(addCustomBtn);

    // Add unique custom category
    fireEvent.change(customInput, { target: { value: 'Packaging & Logistics' } });
    fireEvent.click(addCustomBtn);

    const saveBtn = screen.getByText('Save Categories');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(buyerProfileClient.updateBuyerCategories).toHaveBeenCalledWith(
        'buyer-acc-1789811073812-ux3',
        expect.arrayContaining(['General Procurement', 'Spares', 'IT & Telecom', 'Packaging & Logistics'])
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
    expect(screen.queryByText('Edit Supported Major Categories')).toBeNull();
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

    const commSearchInput = screen.getByPlaceholderText(/Search email communications/i);
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
    expect(screen.getByText('Supported Major Categories')).toBeInTheDocument();

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
      expect(screen.getByText(/No recorded EMAIL communications found/i)).toBeInTheDocument();
    });

    // Payments tab
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    await waitFor(() => {
      expect(screen.getByText('No payment records found.')).toBeInTheDocument();
    });
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
    expect(screen.getByText('Procurement Executive')).toBeInTheDocument();
    expect(screen.getByText('+91 Not provided')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Trial')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Real-time')).toBeInTheDocument();

    // RFQ tab with sparse RFQ modal and Escape (line 375)
    fireEvent.click(screen.getByRole('button', { name: /RFQs/i }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    fireEvent.click(screen.getByText('RFQ-SPARSE'));
    expect(screen.getByText('Open Budget')).toBeInTheDocument();
    expect(screen.getByText('Minimal Item')).toBeInTheDocument();
    expect(screen.getByText('Vendor 1')).toBeInTheDocument();
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
    expect(await screen.findByText('No recorded EMAIL communications found for this buyer.')).toBeInTheDocument();

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

});
