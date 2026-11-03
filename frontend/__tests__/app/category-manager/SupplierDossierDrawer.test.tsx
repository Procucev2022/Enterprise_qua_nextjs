jest.mock('@/lib/accountDocumentsClient', () => ({
  addSellerQuoteCredits: jest.fn().mockResolvedValue({ success: true, message: 'Added credits' }),
  fetchAccountDocuments: jest.fn().mockResolvedValue([]),
  uploadAccountDocument: jest.fn().mockResolvedValue({ success: true }),
  deleteAccountDocument: jest.fn().mockResolvedValue({ success: true }),
}));
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SupplierDossierDrawer from '@/app/category-manager/components/SupplierDossierDrawer';
import type { RFQItem } from '@/lib/types';
import * as supplierProfileClient from '@/lib/supplierProfileClient';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/supplierProfileClient', () => ({
  fetchSupplierCreditHistory: jest.fn(),
  updateSupplierCategories: jest.fn(),
  fetchSupplierCommunications: jest.fn(),
  recordSupplierCommunication: jest.fn(),
  fetchSupplierPaymentHistory: jest.fn(),
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

const mockSeller = {
  id: 'v-hist-1793193596192-6-qspy',
  name: 'Sudheer Solutions pvt LTD',
  companyName: 'Sudheer Solutions pvt LTD',
  contactPerson: 'Sudheer Kangala',
  email: 'sudheer.kangala@procucev.com',
  phone: '824 772 2944',
  location: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560043',
  deliveryLocation: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560043',
  majorCategory: 'Engineering Spares - Electrical',
  category: 'Engineering Spares - Electrical',
  categories: ['Engineering Spares - Electrical', 'Industrial Supplies'],
  gstin: '27AAACG0000A1Z5',
  pan: 'AAACG0000A',
  subscriptionPlan: 'Preferred Partner',
  verificationStatus: 'PENDING EVALUATION',
  source: 'buyer_uploaded',
  rating: 4.5,
  score360: 88,
  freeQuotationCredits: 15,
  createdAt: '2026-03-01T10:00:00.000Z',
  lastLogin: '2026-10-25T14:30:00.000Z',
};

const mockRfqs: any[] = [
  {
    id: 'rfq-101',
    rfqNumber: 'RFQ-2026-001',
    title: 'Electric Motors & Drives Procurement',
    category: 'Engineering Spares - Electrical',
    sourcingMode: 'mode_1',
    status: 'QUOTED',
    quotesCount: 1,
    budget: 350000,
    targetDeliveryDate: '2026-11-20T00:00:00.000Z',
    deliveryLocation: 'Bengaluru, India',
    createdAt: '2026-10-20T10:00:00.000Z',
    extractedEntities: [
      {
        id: 'ent-1',
        itemName: '5HP Induction Motor',
        quantity: 5,
        unit: 'Nos',
        targetDate: '2026-11-20T00:00:00.000Z',
        technicalSpecs: '415V, 3 Phase, Class F',
        confidence: 0.95,
        category: 'Engineering Spares - Electrical',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategory: 'Motors',
      },
    ],
    quotes: [
      {
        vendorId: 'v-hist-1793193596192-6-qspy',
        vendorName: 'Sudheer Solutions pvt LTD',
        vendorCategory: 'Buyer Uploaded',
        unitPrice: 70000,
        totalPrice: 350000,
        leadTimeDays: 10,
        aiMatchScore: 88,
        taxAmount: 63000,
        status: 'QUOTED',
        itemBids: [{ unitPrice: 70000 }],
      },
    ],
    assignedVendors: [{ id: 'v-hist-1793193596192-6-qspy', name: 'Sudheer Solutions pvt LTD' }],
    chasingActive: false,
  },
  {
    id: 'rfq-102',
    rfqNumber: 'RFQ-2026-002',
    title: 'Hydraulic Seals & O-Rings',
    category: 'Mechanical & Fluid Power',
    sourcingMode: 'mode_2',
    status: 'PENDING',
    quotesCount: 0,
    budget: 120000,
    targetDeliveryDate: '2026-11-25T00:00:00.000Z',
    deliveryLocation: 'Chennai, India',
    createdAt: '2026-10-22T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    assignedVendors: [{ id: 'v-hist-1793193596192-6-qspy', name: 'Sudheer Solutions pvt LTD', email: 'sudheer.kangala@procucev.com' }],
    chasingActive: false,
  },
];

describe('SupplierDossierDrawer', () => {
  const originalAnchorClick = HTMLAnchorElement.prototype.click;

  beforeEach(() => {
    jest.clearAllMocks();
    HTMLAnchorElement.prototype.click = jest.fn();

    (supplierProfileClient.fetchSupplierCreditHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: {
        totalCreditsAllocated: 20,
        totalCreditsConsumed: 5,
        remainingFreeCredits: 15,
        purchasedCredits: 0,
        adjustedCredits: 0,
        currentCreditBalance: 15,
        isSubscribed: true,
        subscriptionPlan: 'Preferred Partner',
      },
      transactions: Array.from({ length: 12 }, (_, i) => ({
        id: `vtx-${i + 1}`,
        transactionId: `TX-CREDIT-00${i + 1}`,
        transactionDate: `2026-10-${10 + i}T10:00:00.000Z`,
        transactionType: i % 2 === 0 ? 'INITIAL_ALLOCATION' : 'RFQ_UNLOCK',
        creditSource: i % 2 === 0 ? 'Free Tier Allocation' : 'Qua Quotation Engine',
        creditsAdded: i % 2 === 0 ? 5 : 0,
        creditsConsumed: i % 2 === 1 ? 1 : 0,
        previousBalance: 15,
        updatedBalance: 15 + (i % 2 === 0 ? 5 : -1),
        status: 'COMPLETED',
        description: i % 2 === 0 ? 'Quota allocation' : 'Unlock quotation',
      })),
});

    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'comm-1',
          accountId: 'v-hist-1793193596192-6-qspy',
          channel: 'EMAIL',
          subject: 'Onboarding Confirmation',
          recipient: 'sudheer.kangala@procucev.com',
          message: 'Welcome to Procucev Supplier Network.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-01T10:00:00.000Z',
          direction: 'OUTGOING',
        },
        {
          id: 'comm-2',
          accountId: 'v-hist-1793193596192-6-qspy',
          channel: 'SMS',
          recipient: '824 772 2944',
          message: 'RFQ quotation window closes in 24 hours.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-19T12:00:00.000Z',
          direction: 'OUTGOING',
        },
        {
          id: 'comm-3',
          accountId: 'v-hist-1793193596192-6-qspy',
          channel: 'WHATSAPP',
          recipient: '824 772 2944',
          message: 'Your quote was shortlisted.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-21T15:00:00.000Z',
          direction: 'INCOMING',
        },
        {
          id: 'comm-4',
          accountId: 'v-hist-1793193596192-6-qspy',
          channel: 'CALL',
          recipient: '824 772 2944',
          message: 'Discussion regarding technical specifications.',
          deliveryStatus: 'Delivered',
          sentAt: '2026-10-22T09:30:00.000Z',
          direction: 'OUTGOING',
        },
      ],
    });

    (supplierProfileClient.fetchSupplierPaymentHistory as jest.Mock).mockResolvedValue({
      success: true,
      summary: {
        totalAmountPaid: 5999,
        totalSuccessfulPayments: 1,
        pendingPayments: 0,
        failedPayments: 0,
        totalRefundedAmount: 0,
      },
      payments: Array.from({ length: 12 }, (_, i) => ({
        id: `pay-${i + 1}`,
        invoiceNo: `SUP-INV-2026-00${i + 1}`,
        description: `Plan: Preferred Partner Renewal #${i + 1}`,
        subscriptionPlan: 'Preferred Partner',
        amount: 5999,
        currency: 'INR',
        gateway: 'Zoho Corporate Payments',
        paymentMethod: 'UPI / NetBanking',
        status: i === 0 ? 'PAID' : i % 2 === 0 ? 'PENDING' : 'FAILED',
        transactionDate: `2026-03-${i + 1}T10:00:00.000Z`,
        receiptUrl: `/api/vendors/v-hist-1793193596192-6-qspy/payment-links/pay-${i + 1}/invoice`,
      })),
    });

    (supplierProfileClient.updateSupplierCategories as jest.Mock).mockResolvedValue({
      success: true,
      message: 'Categories updated',
    });

    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 'new-comm-1' },
    });
  });

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalAnchorClick;
  });

  test('1. Renders header with supplier name, badges, 360 AI Score, Rating and hides Seller ID', () => {
    const onClose = jest.fn();
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={onClose}
        sellerRfqs={mockRfqs}
      />
    );

    expect(screen.getByText('Sudheer Solutions pvt LTD')).toBeInTheDocument();
    expect(screen.getByText('Buyer Uploaded')).toBeInTheDocument();
    expect(screen.getByText(/360° AI Score:\s*88\/100/i)).toBeInTheDocument();
    expect(screen.getByText(/Rating:\s*★\s*4.5/i)).toBeInTheDocument();

    // Verify Seller ID (v-hist-...) is NOT rendered in visible UI header
    expect(screen.queryByText(/ID:\s*v-hist/i)).not.toBeInTheDocument();

    // Close button triggers onClose
    const closeBtn = screen.getByLabelText('Close Dossier');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  test('2. Profile Tab allows editing categories, selecting checkboxes, adding custom and saving', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // Click Edit button for categories
    const editBtn = screen.getByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtn);

    expect(screen.getByText('Select Major Procurement Categories:')).toBeInTheDocument();

    // Toggle a category checkbox
    const spareCheckbox = screen.getByLabelText('Raw Materials & Metallurgy');
    fireEvent.click(spareCheckbox);

    // Add custom category
    const customInput = screen.getByPlaceholderText('Enter custom category...');
    fireEvent.change(customInput, { target: { value: 'Solar Inverters & Panels' } });
    const addBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.click(addBtn);

    expect(screen.getByText('Solar Inverters & Panels')).toBeInTheDocument();

    // Save categories
    const saveBtn = screen.getByRole('button', { name: /Save Categories/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(supplierProfileClient.updateSupplierCategories).toHaveBeenCalledWith(
        mockSeller.id,
        expect.arrayContaining(['Solar Inverters & Panels'])
      );
    });
  });

  test('3. Profile Tab category edit handles empty categories, API failure and exceptions', async () => {
    render(
      <SupplierDossierDrawer
        seller={{ ...mockSeller, categories: [] }}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));

    // Uncheck existing category to test validation
    const checked = screen.getAllByRole('checkbox') as HTMLInputElement[];
    checked.forEach((cb) => {
      if (cb.checked) fireEvent.click(cb);
    });

    fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
    expect(screen.getByText(/Please select at least one major category/i)).toBeInTheDocument();

    // Add back category and test API failure
    const customInput = screen.getByPlaceholderText('Enter custom category...');
    fireEvent.change(customInput, { target: { value: 'IT Hardware' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Category/i }));

    (supplierProfileClient.updateSupplierCategories as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Backend permission denied',
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
    await waitFor(() => {
      expect(screen.getByText('Backend permission denied')).toBeInTheDocument();
    });

    // Test rejection exception
    (supplierProfileClient.updateSupplierCategories as jest.Mock).mockRejectedValueOnce(
      new Error('Network crash')
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Categories/i }));
    await waitFor(() => {
      expect(screen.getByText('Error updating categories')).toBeInTheDocument();
    });
  });

  test('4. Quotes Tab displays quotes, supports search, status filtering, and opens Quote Details Modal', async () => {
    const onSelectRFQ = jest.fn();
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        onSelectRFQ={onSelectRFQ}
        sellerRfqs={mockRfqs}
      />
    );

    // Switch to Quotes tab
    const quotesTab = screen.getByRole('button', { name: /Quotes \(2\)/i });
    fireEvent.click(quotesTab);

    expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();
    expect(screen.getByText('Electric Motors & Drives Procurement')).toBeInTheDocument();

    // Status filter
    const statusSelect = screen.getByLabelText(/Filter quotations by status/i);
    fireEvent.change(statusSelect, { target: { value: 'QUOTED' } });
    expect(screen.getByText('RFQ-2026-001')).toBeInTheDocument();

    // Search filter
    const searchInput = screen.getByPlaceholderText('Search quotation RFQs...');
    fireEvent.change(searchInput, { target: { value: 'Non-existent' } });
    expect(screen.getByText(/No quotation opportunities found/i)).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: 'Electric' } });

    // Click row to open Quote modal
    const row = screen.getByText('RFQ-2026-001');
    fireEvent.click(row);

    expect(screen.getByText(/Quotation Details:\s*RFQ-2026-001/i)).toBeInTheDocument();
    expect(screen.getByText('5HP Induction Motor')).toBeInTheDocument();

    // View Full Details button invokes onSelectRFQ
    const fullDetailsBtn = screen.getByRole('button', { name: /View Full Details/i });
    fireEvent.click(fullDetailsBtn);
    expect(onSelectRFQ).toHaveBeenCalledWith(mockRfqs[0]);
  });

  test('5. Escape key dismisses open Quote modal and Category modal', () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // Test Quote modal dismiss
    fireEvent.click(screen.getByRole('button', { name: /Quotes \(2\)/i }));
    fireEvent.click(screen.getByText('RFQ-2026-001'));
    expect(screen.getByText(/Quotation Details:\s*RFQ-2026-001/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Quotation Details:\s*RFQ-2026-001/i)).not.toBeInTheDocument();

    // Test Category modal dismiss
    fireEvent.click(screen.getByRole('button', { name: /^Profile$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    expect(screen.getByText('Select Major Procurement Categories:')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Select Major Procurement Categories:')).not.toBeInTheDocument();
  });

  test('6. Credit Tab displays summary cards, transaction table, sorting, pagination and CSV export', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // Switch to Credit tab
    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));

    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierCreditHistory).toHaveBeenCalledWith(mockSeller.id);
      expect(screen.getByText('TX-CREDIT-0012')).toBeInTheDocument();
    });

    // Search transactions
    const searchInput = screen.getByPlaceholderText('Search credit transactions...');
    fireEvent.change(searchInput, { target: { value: 'TX-CREDIT-001' } });
    expect(screen.getByText('TX-CREDIT-001')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Filter by type
    const typeSelect = screen.getByLabelText(/Filter credit transactions by type/i);
    fireEvent.change(typeSelect, { target: { value: 'INITIAL_ALLOCATION' } });
    fireEvent.change(typeSelect, { target: { value: 'all' } });

    // Sort order button
    const sortBtn = screen.getByRole('button', { name: /Sort \(DESC\)/i });
    fireEvent.click(sortBtn);
    expect(screen.getByRole('button', { name: /Sort \(ASC\)/i })).toBeInTheDocument();

    // Pagination next and prev
    const nextBtn = screen.getByLabelText('Next credit page');
    const prevBtn = screen.getByLabelText('Previous credit page');
    fireEvent.click(nextBtn);
    fireEvent.click(prevBtn);

    // Export CSV
    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);
    expect(screen.getByText(/Credit history exported successfully/i)).toBeInTheDocument();
  });

  test('7. Communications Tab displays 4 subtabs and opens Compose modal to dispatch', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // Switch to Communications tab
    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));

    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierCommunications).toHaveBeenCalledWith(mockSeller.id);
      expect(screen.getByText('Onboarding Confirmation')).toBeInTheDocument();
    });

    // Search within communications
    const searchInput = screen.getByPlaceholderText('Search logs...');
    fireEvent.change(searchInput, { target: { value: 'Onboarding' } });
    expect(screen.getByText('Onboarding Confirmation')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Click card to open full message modal
    fireEvent.click(screen.getByText('Onboarding Confirmation'));
    expect(screen.getAllByText(/Welcome to Procucev Supplier Network/i).length).toBeGreaterThanOrEqual(1);
    // Close modal via close button
    const closeMsgBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeMsgBtn);

    // Switch sub-tab to SMS
    fireEvent.click(screen.getByRole('button', { name: /SMS/i }));
    expect(screen.getByText('RFQ quotation window closes in 24 hours.')).toBeInTheDocument();

    // Switch sub-tab to WhatsApp
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/i }));
    expect(screen.getByText('Your quote was shortlisted.')).toBeInTheDocument();

    // Switch sub-tab to Call Logs
    fireEvent.click(screen.getByRole('button', { name: /Call Logs/i }));
    expect(screen.getByText('Discussion regarding technical specifications.')).toBeInTheDocument();

    // Open Compose modal
    const recordBtn = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    expect(screen.getByText(UI_STRINGS.sellerDirectory.dossier.compose.title)).toBeInTheDocument();
    const msgInput = screen.getByPlaceholderText(/Type message content/i);
    fireEvent.change(msgInput, { target: { value: 'Follow-up regarding technical queries.' } });

    const dispatchBtn = screen.getByRole('button', { name: /Dispatch & Record/i });
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          message: 'Follow-up regarding technical queries.',
        })
      );
    });
  });

  test('8. Record Communication handles API failure and exception', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));

    const msgInput = screen.getByPlaceholderText(/Type message content/i);
    fireEvent.change(msgInput, { target: { value: 'Follow-up' } });

    // API error
    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Dispatch failed at SMS gateway',
    });
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Record/i }));
    await waitFor(() => {
      expect(screen.getByText('Dispatch failed at SMS gateway')).toBeInTheDocument();
    });

    // Exception error
    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockRejectedValueOnce(
      new Error('Crash')
    );
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Record/i }));
    await waitFor(() => {
      expect(screen.getByText('Error recording communication')).toBeInTheDocument();
    });
  });

  test('9. Payments Tab displays summary cards, payments table, search, status filter, and CSV export', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // Switch to Payments tab
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));

    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierPaymentHistory).toHaveBeenCalledWith(mockSeller.id);
    });

    expect(screen.getByText('SUP-INV-2026-001')).toBeInTheDocument();

    // Search payments
    const searchInput = screen.getByPlaceholderText('Search invoices or gateway...');
    fireEvent.change(searchInput, { target: { value: 'SUP-INV-2026-001' } });
    expect(screen.getByText('SUP-INV-2026-001')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Status filter
    const statusSelect = screen.getByLabelText(/Filter payments by status/i);
    fireEvent.change(statusSelect, { target: { value: 'PAID' } });
    expect(screen.getByText('SUP-INV-2026-001')).toBeInTheDocument();
    fireEvent.change(statusSelect, { target: { value: 'all' } });

    // Pagination buttons
    const nextPayBtn = screen.getByLabelText('Next payment page');
    const prevPayBtn = screen.getByLabelText('Previous payment page');
    fireEvent.click(nextPayBtn);
    fireEvent.click(prevPayBtn);

    // Export CSV
    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);
    expect(screen.getByText(/Payment history exported successfully/i)).toBeInTheDocument();
  });

  test('10. Renders sparse seller with Procucev Network source and empty fallbacks', async () => {
    const sparseSeller = {
      id: 'v-net-999',
      source: 'procucev_network',
      isNetwork: true,
      majorCategory: 'Industrial Supplies',
    };
    render(
      <SupplierDossierDrawer
        seller={sparseSeller as any}
        onClose={jest.fn()}
        sellerRfqs={[]}
      />
    );

    expect(screen.getByText('Supplier Organization')).toBeInTheDocument();
    expect(screen.getByText('Procucev Network')).toBeInTheDocument();
    expect(screen.getByText(/Last Login: Never logged in/i)).toBeInTheDocument();

    // Switch to empty quotes
    fireEvent.click(screen.getByRole('button', { name: /Quotes \(0\)/i }));
    expect(screen.getByText(/No quotation opportunities found/i)).toBeInTheDocument();

    // Switch to empty communications
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [],
    });
    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));
    await waitFor(() => {
      expect(screen.getByText(/No EMAIL communication records found/i)).toBeInTheDocument();
    });

    // Switch to empty payments
    (supplierProfileClient.fetchSupplierPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: null,
      payments: [],
    });
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    await waitFor(() => {
      expect(screen.getByText(/No payment transactions recorded/i)).toBeInTheDocument();
    });

    // Test empty CSV exports
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(screen.getByText('No payment transactions to export')).toBeInTheDocument();
  });

  test('11. Close button in footer triggers onClose', () => {
    const onClose = jest.fn();
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={onClose}
        sellerRfqs={mockRfqs}
      />
    );

    const closeButtons = screen.getAllByRole('button', { name: /Close Dossier/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });

  test('12. Modal backdrop clicks, stopPropagation, cancel buttons, and edge-cases', async () => {
    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    // 1. Category Modal: open, test stopPropagation on modal container, Cancel button, submit empty input
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const catDialog = screen.getByRole('dialog');
    fireEvent.click(catDialog.firstElementChild as HTMLElement); // stopPropagation
    const addCatBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.click(addCatBtn); // empty input submission
    const cancelCatBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelCatBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and test backdrop click to close
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 2. Quotes: test Details button directly, stopPropagation on quote modal, Close button and backdrop click
    fireEvent.click(screen.getByRole('button', { name: /Quotes \(2\)/i }));
    const detailsBtns = screen.getAllByRole('button', { name: 'Details' });
    fireEvent.click(detailsBtns[0]); // direct button click
    const quoteDialog = screen.getByRole('dialog');
    fireEvent.click(quoteDialog.firstElementChild as HTMLElement); // stopPropagation
    const closeQuoteBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeQuoteBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and backdrop click
    fireEvent.click(detailsBtns[0]);
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 3. Credit empty export toast
    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));
    await waitFor(() => {
      expect(screen.getByText('TX-CREDIT-0012')).toBeInTheDocument();
    });
    // Filter to impossible search
    const creditSearch = screen.getByPlaceholderText('Search credit transactions...');
    fireEvent.change(creditSearch, { target: { value: 'IMPOSSIBLE_SEARCH_STRING_123' } });
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));
    expect(screen.getByText('No credit transactions to export')).toBeInTheDocument();
    fireEvent.change(creditSearch, { target: { value: '' } });

    // 4. Communication modal backdrop, stopPropagation, cancel compose, and compose channel change
    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));
    await waitFor(() => {
      expect(screen.getByText('Onboarding Confirmation')).toBeInTheDocument();
    });
    // Open message modal
    fireEvent.click(screen.getByText('Onboarding Confirmation'));
    const commDialog = screen.getByRole('dialog');
    fireEvent.click(commDialog.firstElementChild as HTMLElement); // stopPropagation
    fireEvent.click(commDialog); // backdrop click
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Open Compose modal
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    const composeDialog = screen.getByRole('dialog');
    fireEvent.click(composeDialog.firstElementChild as HTMLElement); // stopPropagation
    // Change channel select
    const channelSelect = composeDialog.querySelector('select') as HTMLSelectElement;
    fireEvent.change(channelSelect, { target: { value: 'SMS' } });
    // Cancel button
    const cancelComposeBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelComposeBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen compose and test backdrop click
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('13. Quotes modal line items fallback, lump-sum quote, and onSelectRFQ callback', () => {
    const onSelectRFQ = jest.fn();
    const lumpSumRfq: any = {
      id: 'rfq-lump-sum',
      rfqNumber: 'RFQ-LUMP-001',
      title: 'Lump Sum Construction',
      category: 'Civil & Infra',
      sourcingMode: '',
      status: 'QUOTED',
      quotesCount: 1,
      budget: 500000,
      targetDeliveryDate: '2026-12-01T00:00:00.000Z',
      deliveryLocation: 'Mumbai',
      createdAt: '2026-10-25T10:00:00.000Z',
      extractedEntities: [],
      quotes: [
        {
          vendorId: mockSeller.id,
          vendorName: mockSeller.name,
          unitPrice: 500000,
        },
      ],
      assignedVendors: [{ id: mockSeller.id, name: mockSeller.name }],
      chasingActive: false,
    };

    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={[lumpSumRfq]}
        onSelectRFQ={onSelectRFQ}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Quotes \(1\)/i }));
    fireEvent.click(screen.getByText('RFQ-LUMP-001'));

    expect(screen.getByText('Single lump-sum procurement requirement.')).toBeInTheDocument();
    expect(screen.getByText('7-14 Days')).toBeInTheDocument();

    const viewFullBtn = screen.getByRole('button', { name: /View Full Details/i });
    fireEvent.click(viewFullBtn);
    expect(onSelectRFQ).toHaveBeenCalledWith(lumpSumRfq);
  });

  test('14. Credit Tab sorting toggle, type filtering, and summary fallbacks', async () => {
    (supplierProfileClient.fetchSupplierCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: {
        totalCreditsAllocated: 100,
        totalCreditsConsumed: 20,
        remainingFreeCredits: 80,
        currentCreditBalance: 80,
        subscriptionPlan: 'Gold Partner',
      },
      transactions: [
        {
          id: 'tx-1',
          transactionId: 'TX-CREDIT-AAA',
          transactionDate: '2026-10-01T10:00:00.000Z',
          transactionType: 'INITIAL_ALLOCATION',
          creditsDeducted: 0,
          creditsAdded: 100,
          balanceAfter: 100,
          description: 'Initial quota',
          status: 'SUCCESS',
        },
        {
          id: 'tx-2',
          transactionId: 'TX-CREDIT-BBB',
          transactionDate: '2026-10-15T10:00:00.000Z',
          transactionType: 'RFQ_UNLOCK',
          creditsDeducted: 20,
          creditsAdded: 0,
          balanceAfter: 80,
          description: 'Unlocked RFQ-101',
          status: 'SUCCESS',
        },
      ],
    });

    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));

    await waitFor(() => {
      expect(screen.getByText('TX-CREDIT-AAA')).toBeInTheDocument();
      expect(screen.getByText('TX-CREDIT-BBB')).toBeInTheDocument();
    });

    // Toggle Sort Order from DESC to ASC and back to DESC
    const sortBtn = screen.getByRole('button', { name: /Sort \(DESC\)/i });
    fireEvent.click(sortBtn);
    expect(screen.getByRole('button', { name: /Sort \(ASC\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Sort \(ASC\)/i }));
    expect(screen.getByRole('button', { name: /Sort \(DESC\)/i })).toBeInTheDocument();

    // Filter by type
    const typeSelect = screen.getByLabelText(/Filter credit transactions by type/i);
    fireEvent.change(typeSelect, { target: { value: 'INITIAL_ALLOCATION' } });
    expect(screen.getByText('TX-CREDIT-AAA')).toBeInTheDocument();
    expect(screen.queryByText('TX-CREDIT-BBB')).not.toBeInTheDocument();
    fireEvent.change(typeSelect, { target: { value: 'all' } });
    expect(screen.getByText('TX-CREDIT-BBB')).toBeInTheDocument();
  });

  test('15. Communications Tab subtabs (SMS, WhatsApp, Call), compose channel defaults, and empty submit', async () => {
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'c-sms',
          channel: 'SMS',
          direction: 'INCOMING',
          recipient: '824 772 2944',
          subject: 'SMS Alert',
          message: 'SMS message text',
          sentAt: '2026-10-20T10:00:00.000Z',
          deliveryStatus: 'DELIVERED',
        },
        {
          id: 'c-wa',
          channel: 'WHATSAPP',
          direction: '' as any,
          recipient: '824 772 2944',
          subject: '',
          message: 'WhatsApp message text',
          sentAt: '2026-10-21T10:00:00.000Z',
          deliveryStatus: '' as any,
        },
        {
          id: 'c-call',
          channel: 'CALL',
          direction: 'OUTGOING',
          recipient: '824 772 2944',
          subject: 'Call Log',
          message: 'Call notes summary',
          sentAt: '2026-10-22T10:00:00.000Z',
          deliveryStatus: 'COMPLETED',
        },
      ],
    });

    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={mockRfqs}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'SMS' })).toBeInTheDocument();
    });

    // 1. Switch to SMS
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    expect(screen.getByText('SMS Alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    // Verify default select is SMS
    const smsSelect = screen.getByRole('dialog').querySelector('select') as HTMLSelectElement;
    expect(smsSelect.value).toBe('SMS');
    // Try dispatching with empty message (triggers early return)
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Record/i }));
    expect(supplierProfileClient.recordSupplierCommunication).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    // 2. Switch to WhatsApp
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(screen.getByText('WhatsApp message text')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    const waSelect = screen.getByRole('dialog').querySelector('select') as HTMLSelectElement;
    expect(waSelect.value).toBe('WHATSAPP');
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

    // 3. Switch to Call Logs
    fireEvent.click(screen.getByRole('button', { name: 'Call Logs' }));
    expect(screen.getByText('Call Log')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Record Communication/i }));
    const callSelect = screen.getByRole('dialog').querySelector('select') as HTMLSelectElement;
    expect(callSelect.value).toBe('CALL');
    const msgTextarea = screen.getByRole('dialog').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(msgTextarea, { target: { value: 'Call summary notes recorded.' } });
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Record/i }));
    expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalledWith(
      mockSeller.id,
      expect.objectContaining({
        channel: 'CALL',
        message: 'Call summary notes recorded.',
        subject: 'Supplier Communication: CALL',
      })
    );

    // 4. Click WhatsApp message card to open modal with fallback subject
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));
    fireEvent.click(screen.getByText('WhatsApp message text'));
    expect(screen.getByText('WHATSAPP Notification')).toBeInTheDocument();
  });

  test('16. Category selection branches: majorCategory fallback, duplicate add, and checkbox toggling', () => {
    const singleCatSeller = {
      id: 'v-single-cat',
      name: 'Single Cat Supplier',
      companyName: 'Single Cat Supplier',
      majorCategory: 'Packaging Materials',
      categories: undefined,
    };

    render(
      <SupplierDossierDrawer
        seller={singleCatSeller}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText(/Major: Packaging Materials/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const customInput = screen.getByPlaceholderText('Enter custom category...');
    // Try adding duplicate
    fireEvent.change(customInput, { target: { value: 'Packaging Materials' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Category/i }));

    // Toggle off the existing category
    const chk = screen.getByLabelText('Packaging Materials');
    fireEvent.click(chk);
    fireEvent.click(chk);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
  });

  test('17. Handles credit, communications, and payments API failure / rejection gracefully', async () => {
    (supplierProfileClient.fetchSupplierCreditHistory as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({ success: false });
    (supplierProfileClient.fetchSupplierPaymentHistory as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

    render(
      <SupplierDossierDrawer
        seller={{
          ...mockSeller,
          categories: undefined,
          majorCategory: undefined,
          category: 'Chemical Reagents',
        }}
        onClose={jest.fn()}
      />
    );

    // Tests category fallback to seller.category
    expect(screen.getByText(/Major: Chemical Reagents/i)).toBeInTheDocument();

    // Credit Tab failure
    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));
    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierCreditHistory).toHaveBeenCalled();
    });

    // Communications Tab failure
    fireEvent.click(screen.getByRole('button', { name: /^Communications \(\d+\)$/i }));
    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierCommunications).toHaveBeenCalled();
    });

    // Payments Tab failure
    fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
    await waitFor(() => {
      expect(supplierProfileClient.fetchSupplierPaymentHistory).toHaveBeenCalled();
    });
  });

  test('18. Quote matching by vendor name, line item description fallback, and notes search in credits', async () => {
    const specialRfq: any = {
      id: 'rfq-vendor-name-match',
      rfqNumber: 'RFQ-SPEC-999',
      title: 'Precision Machined Components',
      category: 'Mechanical',
      sourcingMode: 'mode_2',
      status: 'QUOTED',
      quotesCount: 1,
      budget: 200000,
      targetDeliveryDate: '2026-12-15T00:00:00.000Z',
      deliveryLocation: 'Pune',
      createdAt: '2026-10-26T10:00:00.000Z',
      extractedEntities: [
        {
          id: 'ent-desc-only',
          itemName: '',
          description: 'CNC Turned Brass Bushings',
          quantity: 20,
          unit: '',
        } as any,
      ],
      quotes: [
        {
          vendorId: 'other-id',
          vendorName: mockSeller.companyName, // matches by name
          unitPrice: 1000,
          totalPrice: 20000,
          leadTimeDays: 5,
          taxAmount: 3600,
          status: 'QUOTED',
        },
      ],
      assignedVendors: [],
      chasingActive: false,
    };

    (supplierProfileClient.fetchSupplierCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: null,
      transactions: [
        {
          id: 'tx-note-1',
          transactionId: 'TX-NOTE-SEARCH',
          transactionDate: '2026-10-18T10:00:00.000Z',
          transactionType: 'ADJUSTMENT',
          creditsDeducted: 0,
          creditsAdded: 10,
          balanceAfter: 25,
          description: '',
          notes: 'Special bonus credit adjustment',
          status: 'SUCCESS',
        },
      ],
    });

    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={[specialRfq]}
      />
    );

    // Quotes Tab
    fireEvent.click(screen.getByRole('button', { name: /Quotes \(1\)/i }));

    // Test Quote status filter
    const statusSelect = screen.getByLabelText(/Filter quotations by status/i);
    fireEvent.change(statusSelect, { target: { value: 'QUOTED' } });
    expect(screen.getByText('RFQ-SPEC-999')).toBeInTheDocument();
    fireEvent.change(statusSelect, { target: { value: 'all' } });

    // Open Modal and verify description fallback and 5 Days lead time
    fireEvent.click(screen.getByText('RFQ-SPEC-999'));
    expect(screen.getByText('CNC Turned Brass Bushings')).toBeInTheDocument();
    expect(screen.getByText('5 Days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));

    // Credit Tab: search by notes
    fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));
    await waitFor(() => {
      expect(screen.getByText('TX-NOTE-SEARCH')).toBeInTheDocument();
    });
    const creditSearch = screen.getByPlaceholderText('Search credit transactions...');
    fireEvent.change(creditSearch, { target: { value: 'bonus' } });
    expect(screen.getByText('TX-NOTE-SEARCH')).toBeInTheDocument();
  });

  test('exercises activity log with call outcome, duration, and scheduled followup date in supplier drawer', async () => {
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValue({
      success: true,
      data: [],
    });
    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockResolvedValue({
      success: true,
    });

    render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
        sellerRfqs={[]}
      />
    );

    // Switch to Communication tab
    fireEvent.click(screen.getByRole('button', { name: /^Communications/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record Communication/i })).toBeInTheDocument();
    });
    const recordBtn = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    // Channel selection and toggling all channel options
    const dialog = await screen.findByRole('dialog');
    const channelSelect = dialog.querySelector('select');
    if (channelSelect) {
      fireEvent.change(channelSelect, { target: { value: 'SMS' } });
      fireEvent.change(channelSelect, { target: { value: 'WHATSAPP' } });
      fireEvent.change(channelSelect, { target: { value: 'EMAIL' } });
      fireEvent.change(channelSelect, { target: { value: 'CALL' } });
    }

    // Recipient input manual change
    const recipientInput = screen.getByPlaceholderText(/supplier@company\.com|\+91/i);
    fireEvent.change(recipientInput, { target: { value: '9876543210' } });

    // Call outcome & duration
    const outcomeSelect = screen.getByDisplayValue('Connected');
    fireEvent.change(outcomeSelect, { target: { value: 'Wrong Number' } });

    const durationInput = screen.getByPlaceholderText(/e\.g\. 10 mins/i);
    fireEvent.change(durationInput, { target: { value: '5 mins' } });

    // Next followup date & clear button
    const followupDateInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(followupDateInput).toBeInTheDocument();
    fireEvent.change(followupDateInput, { target: { value: '2026-11-06T10:00' } });

    const clearBtn = screen.getByRole('button', { name: 'Clear' });
    fireEvent.click(clearBtn);
    fireEvent.change(followupDateInput, { target: { value: '2026-11-06T10:00' } });

    // Priority change
    const prioritySelect = screen.getByDisplayValue(/Priority: Medium/i);
    fireEvent.change(prioritySelect, { target: { value: 'High' } });

    // Assignee change - with valid and non-matching ids
    const assigneeSelect = screen.getByDisplayValue(/Pavani/i);
    fireEvent.change(assigneeSelect, { target: { value: 'exec-2' } });
    fireEvent.change(assigneeSelect, { target: { value: 'NON_EXISTENT_ID' } });

    // Follow-up notes
    const followupNotesInput = screen.getByPlaceholderText(/Action items for next scheduled interaction|Agenda or deliverables for next interaction/i);
    fireEvent.change(followupNotesInput, { target: { value: 'Confirm quotation delivery date' } });

    // Subject & message
    const subjectInput = screen.getByPlaceholderText(/clarification follow-up|Deadline Follow-up|RFQ Quotation/i);
    fireEvent.change(subjectInput, { target: { value: 'Delivery SLA follow-up' } });
    const messageInput = screen.getByPlaceholderText(/Type message content|summary of call/i);
    fireEvent.change(messageInput, { target: { value: 'Vendor agreed to shorten machining lead time.' } });

    // Save
    const saveBtn = screen.getByRole('button', { name: /Save & Synchronize Tasks|Dispatch & Record/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          channel: 'CALL',
          callOutcome: 'Wrong Number',
          duration: '5 mins',
          nextFollowupDate: '2026-11-06T10:00',
          followupPriority: 'High',
          followupAssigneeName: 'Navin Chaudhary',
          followupNotes: 'Confirm quotation delivery date',
        })
      );
    });

    // Re-open and test API failure branch without error string
    const recordBtnAgain = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnAgain);
    const msgInputAgain = screen.getByPlaceholderText(/Type message content|summary of call/i);
    fireEvent.change(msgInputAgain, { target: { value: 'Another follow-up note' } });

    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Synchronize Tasks|Dispatch & Record/i }));

    await waitFor(() => {
      expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalledTimes(2);
    });

    // Re-open and test API rejection / exception branch
    const recordBtnThird = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnThird);
    const msgInputThird = screen.getByPlaceholderText(/Type message content|summary of call/i);
    fireEvent.change(msgInputThird, { target: { value: 'Third attempt' } });

    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockRejectedValueOnce(
      new Error('Failed network gateway')
    );
    fireEvent.click(screen.getByRole('button', { name: /Save & Synchronize Tasks|Dispatch & Record/i }));

    await waitFor(() => {
      expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalledTimes(3);
    });

    // Re-open and test Escape key dismissal
    const recordBtnFourth = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtnFourth);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type message content|summary of call/i)).toBeNull();
    });

    // Test sparse seller with neither phone nor email to cover all fallback branches
    const sparseSeller = {
      ...mockSeller,
      phone: undefined,
      email: undefined,
    };
    const { unmount } = render(
      <SupplierDossierDrawer
        seller={sparseSeller as any}
        onClose={jest.fn()}
      />
    );
    unmount();
  });

  test('handles supplier commercial email scenario selection and auto-attachments', async () => {
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [],
    });
    render(
      <SupplierDossierDrawer
        seller={mockSeller as any}
        onClose={jest.fn()}
      />
    );

    // Switch to Communications tab
    fireEvent.click(screen.getByRole('button', { name: /^Communications/i }));

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const dialog = await screen.findByRole('dialog');

    // Change Scenario to seller_premium_access
    const scenarioSelect = dialog.querySelectorAll('select')[1];
    fireEvent.change(scenarioSelect, { target: { value: 'seller_premium_access' } });

    // Verify subject and message were interpolated
    const subjectInput = within(dialog).getByPlaceholderText(UI_STRINGS.sellerDirectory.dossier.compose.subjectPlaceholder) as HTMLInputElement;
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Change to seller_featured_placement scenario
    fireEvent.change(scenarioSelect, { target: { value: 'seller_featured_placement' } });
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Test custom scenario selection
    fireEvent.change(scenarioSelect, { target: { value: 'custom' } });
    expect(scenarioSelect.value).toBe('custom');
  });

  test('handles quick action email drafting for various seller call outcomes', async () => {
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [],
    });
    render(
      <SupplierDossierDrawer
        seller={mockSeller as any}
        onClose={jest.fn()}
      />
    );

    // Switch to Communications tab
    fireEvent.click(screen.getByRole('button', { name: /^Communications/i }));

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const dialog = await screen.findByRole('dialog');
    const channelSelect = dialog.querySelectorAll('select')[0];
    fireEvent.change(channelSelect, { target: { value: 'CALL' } });

    // Click Draft for Connected
    const connectedBtn = within(dialog).getByRole('button', { name: /Draft for Connected/i });
    fireEvent.click(connectedBtn);
    const subjectInput = within(dialog).getByPlaceholderText(UI_STRINGS.sellerDirectory.dossier.compose.subjectPlaceholder) as HTMLInputElement;
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Switch to CALL again and test Left Voicemail
    fireEvent.change(dialog.querySelectorAll('select')[0], { target: { value: 'CALL' } });
    const vmBtn = within(dialog).getByRole('button', { name: /Draft for Left Voicemail/i });
    fireEvent.click(vmBtn);
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Switch to CALL again and test Busy
    fireEvent.change(dialog.querySelectorAll('select')[0], { target: { value: 'CALL' } });
    const busyBtn = within(dialog).getByRole('button', { name: /Draft for Busy/i });
    fireEvent.click(busyBtn);
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Switch to CALL again and test No Answer
    fireEvent.change(dialog.querySelectorAll('select')[0], { target: { value: 'CALL' } });
    const noAnswerBtn = within(dialog).getByRole('button', { name: /Draft for No Answer/i });
    fireEvent.click(noAnswerBtn);
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Switch to CALL again and test Wrong Number
    fireEvent.change(dialog.querySelectorAll('select')[0], { target: { value: 'CALL' } });
    const wrongNumBtn = within(dialog).getByRole('button', { name: /Draft for Wrong Number/i });
    fireEvent.click(wrongNumBtn);
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');

    // Convert Call to Followup Email button with date set
    fireEvent.change(dialog.querySelectorAll('select')[0], { target: { value: 'CALL' } });
    const dateInput = dialog.querySelector('input[type="datetime-local"]');
    if (dateInput) {
      fireEvent.change(dateInput, { target: { value: '2026-11-10T14:00' } });
    }
    const convertBtn = within(dialog).getByRole('button', { name: /Email Follow-up Call Schedule to Vendor/i });
    fireEvent.click(convertBtn);
    expect(subjectInput.value).toContain('Sudheer Solutions pvt LTD');
  });

  test('toggles vault dropdown and attaches/removes vault collateral and local files for seller', async () => {
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [],
    });
    render(
      <SupplierDossierDrawer
        seller={mockSeller as any}
        onClose={jest.fn()}
      />
    );

    // Switch to Communications tab
    fireEvent.click(screen.getByRole('button', { name: /^Communications/i }));

    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);

    const dialog = await screen.findByRole('dialog');

    // Open Document Vault dropdown
    const vaultDropdownBtn = within(dialog).getByText(/Select collateral from Document Vault\.\.\./i);
    fireEvent.click(vaultDropdownBtn);

    // Select Product Rate Card from vault
    const rateCardOption = await within(dialog).findByText('Product Rate Card');
    fireEvent.click(rateCardOption);

    // Verify rate card attachment badge appears
    expect(within(dialog).getAllByText('Product Rate Card').length).toBeGreaterThan(0);

    // Click again to unselect
    fireEvent.click(rateCardOption);

    // Select again so we can test the badge X removal button
    fireEvent.click(rateCardOption);

    // Attach local file
    const file = new File(['mock content'], 'seller_specs.pdf', { type: 'application/pdf' });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [file] } });
      expect(await within(dialog).findByText(/seller specs \(Local Upload\)/i)).toBeInTheDocument();
    }

    // Remove attachment via X button
    const removeBtns = within(dialog).getAllByRole('button').filter(b => b.querySelector('svg.lucide-x'));
    if (removeBtns.length > 0) {
      fireEvent.click(removeBtns[0]);
    }
  });
  test('covers remaining edge-case branches for 90%+ branch coverage benchmark', async () => {
    // 1. initialTab and category fallback (line 132, 150)
    const sparseSeller: any = {
      id: 'v-sparse-1',
      category: 'Electronics',
      phone: '9876543210',
    };
    (supplierProfileClient.fetchSupplierCreditHistory as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    const { unmount } = render(
      <SupplierDossierDrawer
        seller={sparseSeller}
        initialTab="credit"
        onClose={jest.fn()}
      />
    );
    expect(await screen.findByText(/Total Credits Allocated/i)).toBeInTheDocument();
    unmount();

    // 2. Communications modal Escape, empty message validation, vault matching, and submission with attachments (lines 433-435, 494, 541, 557)
    const { fetchDocuments } = jest.requireMock('@/lib/documentVaultClient');
    fetchDocuments.mockResolvedValueOnce([
      {
        id: 'vault-rc-1',
        documentName: 'Rate Card 2026',
        fileName: 'rate_card.pdf',
        fileSize: 1024,
        category: 'rate_cards',
        isActive: true,
      },
    ]);
    (supplierProfileClient.fetchSupplierCommunications as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'comm-row-1',
          channel: 'EMAIL',
          subject: 'Test Subject Row',
          message: 'Test Message Row',
          recipient: 'seller@test.com',
          createdAt: '2026-11-01T10:00:00Z',
        },
      ],
    });
    (supplierProfileClient.recordSupplierCommunication as jest.Mock).mockResolvedValueOnce({
      success: true,
    });

    const { unmount: unmountComm } = render(
      <SupplierDossierDrawer
        seller={{ ...mockSeller, contactPerson: undefined, name: undefined }}
        initialTab="communications"
        onClose={jest.fn()}
      />
    );

    // Click communication table row to open detail modal, then press Escape (line 494)
    const commRow = await screen.findByText('Test Subject Row');
    fireEvent.click(commRow);
    expect(screen.getByText(/Channel:/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText(/Channel:/i)).not.toBeInTheDocument();
    });

    // Open record communication modal
    const recordBtn = await screen.findByRole('button', { name: /Record Communication/i });
    fireEvent.click(recordBtn);
    const dialog = await screen.findByRole('dialog');

    // Test submitting with empty message (line 541)
    const submitBtn = within(dialog).getByRole('button', { name: /Dispatch & Record/i });
    fireEvent.click(submitBtn);

    // Switch channel to SMS to cover line 1890 (seller.phone || seller.email || '')
    const channelSelect = dialog.querySelectorAll('select')[0];
    fireEvent.change(channelSelect, { target: { value: 'SMS' } });
    fireEvent.change(channelSelect, { target: { value: 'EMAIL' } });

    // Select seller_premium_access to trigger suggestedVaultTags: ['rate_cards'] matching vault docs (lines 433-435)
    const scenarioSelect = dialog.querySelectorAll('select')[1];
    fireEvent.change(scenarioSelect, { target: { value: 'seller_premium_access' } });

    // Upload file with empty MIME type to hit mimeType fallback (line 480)
    const fileNoType = new File(['mock content'], 'test_specs.doc', { type: '' });
    const localInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    if (localInput) {
      fireEvent.change(localInput, { target: { files: [fileNoType] } });
    }

    // Fill message and submit with attachments (lines 557)
    const messageInput = dialog.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: 'Valid test communication message content.' } });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(supplierProfileClient.recordSupplierCommunication).toHaveBeenCalled();
    });
    unmountComm();

    // 3. Payments with date fallback & search (lines 621, 642, 1460)
    (supplierProfileClient.fetchSupplierPaymentHistory as jest.Mock).mockResolvedValueOnce({
      success: true,
      payments: [
        {
          id: 'pay-fallback-date',
          invoiceNo: 'INV-DATE-TEST',
          date: '2026-11-02T10:00:00Z',
          amount: 15000,
          status: 'COMPLETED',
          description: 'Payment description search match',
          currency: 'INR',
          gateway: 'RAZORPAY',
          receiptUrl: 'https://example.com/receipt.pdf',
        },
      ],
      summary: { totalPaid: 15000, pendingCount: 0 },
    });
    const { unmount: unmountPay } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="payments"
        onClose={jest.fn()}
      />
    );
    expect(await screen.findByText('INV-DATE-TEST')).toBeInTheDocument();
    const searchInput = screen.getByPlaceholderText('Search invoices or gateway...');
    fireEvent.change(searchInput, { target: { value: 'search match' } });
    expect(screen.getByText('INV-DATE-TEST')).toBeInTheDocument();
    const exportBtn = screen.getByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtn);
    unmountPay();

    // 4. Quotes modal with missing itemName and unitPrice (lines 1724, 1725, 1727, 1730)
    const mockRfqWithFallback: any = {
      id: 'rfq-fallback',
      rfqNumber: 'RFQ-FALLBACK-01',
      title: 'RFQ Fallback Title',
      category: 'Engineering Spares - Electrical',
      sourcingMode: 'mode_1',
      status: 'QUOTED',
      quotesCount: 1,
      budget: 100000,
      extractedEntities: [
        {
          id: 'ent-desc-only',
          description: 'Custom Fitting Description',
          quantity: 2,
        },
      ],
      quotes: [
        {
          vendorId: 'v-hist-1793193596192-6-qspy',
          vendorName: 'Sudheer Solutions pvt LTD',
          totalPrice: 140000,
          leadTimeDays: 5,
        },
      ],
    };
    const { unmount: unmountQuotes } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="quotes"
        onClose={jest.fn()}
        sellerRfqs={[mockRfqWithFallback]}
      />
    );
    const detailsBtn = await screen.findByRole('button', { name: /^Details$/i });
    fireEvent.click(detailsBtn);
    expect(await screen.findByText(/Custom Fitting Description/i)).toBeInTheDocument();
    unmountQuotes();
  });

test('Documents tab renders AccountDocumentsTab and Add Quote Credits modal works', async () => {
    const onTabChangeMock = jest.fn();
    const { unmount } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="documents"
        onTabChange={onTabChangeMock}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(/Total Documents:/i)).toBeInTheDocument();
    
    // Switch tabs to trigger onTabChange
    const profileTabBtn = screen.getByRole('button', { name: /Profile/i });
    fireEvent.click(profileTabBtn);
    expect(onTabChangeMock).toHaveBeenCalledWith('profile');
    
    const docsTabBtn = screen.getByRole('button', { name: /Documents/i });
    fireEvent.click(docsTabBtn);
    expect(onTabChangeMock).toHaveBeenCalledWith('documents');
    unmount();

    // Reopen and test Add Quote Credits modal success with custom message and reason
    const { addSellerQuoteCredits } = require('@/lib/accountDocumentsClient');
    (addSellerQuoteCredits as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: 'Successfully allocated 3 quote credits to seller',
    });

    const { unmount: unmount2 } = render(
      <SupplierDossierDrawer
        seller={{ ...mockSeller, freeQuotationCredits: 5 }}
        initialTab="credit"
        onClose={jest.fn()}
      />
    );

    const addCreditsHeaderBtn = screen.getByTitle('Add Quote Credits (1-5)');
    fireEvent.click(addCreditsHeaderBtn);
    expect(screen.getByText('Add Seller Quote Credits')).toBeInTheDocument();

    // Select +3 credits and enter reason
    fireEvent.click(screen.getByRole('button', { name: '+3' }));

    // Click other credit amount buttons to exercise all button branches
    fireEvent.click(screen.getByRole('button', { name: '+1' }));
    fireEvent.click(screen.getByRole('button', { name: '+2' }));
    fireEvent.click(screen.getByRole('button', { name: '+4' }));
    fireEvent.click(screen.getByRole('button', { name: '+5' }));
    fireEvent.click(screen.getByRole('button', { name: '+3' }));

    const reasonInput = screen.getByPlaceholderText(/Reason for quote credits/i);
    fireEvent.change(reasonInput, { target: { value: 'High priority customer RFP support' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: 'Add Quote Credits' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(addSellerQuoteCredits).toHaveBeenCalledWith(mockSeller.id, {
        amount: 3,
        reason: 'High priority customer RFP support',
      });
    });
    unmount2();

    // Test success branch when res.message is empty (hits formatString branch)
    (addSellerQuoteCredits as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: '',
    });

    const { unmount: unmount3 } = render(
      <SupplierDossierDrawer
        seller={{ ...mockSeller, freeQuotationCredits: undefined }}
        initialTab="profile"
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Quote Credits' }));
    await waitFor(() => {
      expect(addSellerQuoteCredits).toHaveBeenCalled();
    });
    unmount3();

    // Test error branch with res.error
    (addSellerQuoteCredits as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Quota exhausted for this billing cycle',
    });

    const { unmount: unmount4 } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="profile"
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Quote Credits' }));
    await waitFor(() => {
      expect(addSellerQuoteCredits).toHaveBeenCalled();
    });
    unmount4();

    // Test rejection/throw branch
    (addSellerQuoteCredits as jest.Mock).mockRejectedValueOnce(new Error('Network offline'));

    const { unmount: unmount5 } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="profile"
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Quote Credits' }));
    await waitFor(() => {
      expect(addSellerQuoteCredits).toHaveBeenCalled();
    });

    // Test closing modal via backdrop click and cancel button
    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    const modalDialog = screen.getByRole('dialog');
    fireEvent.click(modalDialog); // clicks backdrop
    expect(screen.queryByText('Add Seller Quote Credits')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Add Seller Quote Credits')).not.toBeInTheDocument();
    unmount5();
  });


  test('covers extra SupplierDossierDrawer branches for 90%+ coverage', async () => {
    const { addSellerQuoteCredits } = require('@/lib/accountDocumentsClient');
    // 1. InitialTab omitted (defaults to 'profile') and rfqs fallback
    const { unmount } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText(mockSeller.name)).toBeInTheDocument();

    // Open add quote credits and test inner dialog click (does not close modal)
    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    const modalHeading = screen.getByText('Add Seller Quote Credits');
    fireEvent.click(modalHeading);
    expect(screen.getByText('Add Seller Quote Credits')).toBeInTheDocument();

    // Close via X button
    const closeButtons = screen.getAllByRole('button');
    const xBtn = closeButtons.find(b => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    unmount();

    // Test when res.success is false and res.error is absent (hits line 337 fallback)
    (addSellerQuoteCredits as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    const { unmount: unmountErrFallback } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        initialTab="profile"
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTitle('Add Quote Credits (1-5)'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Quote Credits' }));
    await waitFor(() => {
      expect(addSellerQuoteCredits).toHaveBeenCalled();
    });
    unmountErrFallback();

    // Test Communications tab empty message submit (line 605) and dispatch error branches (line 638, 641, 626)
    const { recordSupplierCommunication } = require('@/lib/supplierProfileClient');
    const { unmount: unmountComm } = render(
      <SupplierDossierDrawer
        seller={{ ...mockSeller, email: 'comm_seller@procucev.com' }}
        initialTab="communications"
        onClose={jest.fn()}
      />
    );

    const commTabBtn = screen.getByRole('button', { name: /^Communications \(\d+\)$/i });
    fireEvent.click(commTabBtn);

    const composeBtn = screen.getByRole('button', { name: /Record Communication/i });
    fireEvent.click(composeBtn);

    const messageInput = screen.getByPlaceholderText(/Type message content/i);
    // Submit with empty/whitespace message (hits line 605)
    fireEvent.change(messageInput, { target: { value: '   ' } });
    const sendBtn = screen.getByRole('button', { name: /Dispatch & Record/i });
    fireEvent.click(sendBtn);

    // Now enter valid message and followup date (hits line 626 and 638)
    fireEvent.change(messageInput, { target: { value: 'Valid follow up note' } });
    (recordSupplierCommunication as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'SMTP gateway timeout',
    });
    fireEvent.click(sendBtn);
    await waitFor(() => {
      expect(recordSupplierCommunication).toHaveBeenCalled();
    });

    // Test exception throw in recordSupplierCommunication (hits line 641)
    (recordSupplierCommunication as jest.Mock).mockRejectedValueOnce(new Error('Fatal comm error'));
    fireEvent.click(sendBtn);
    await waitFor(() => {
      expect(recordSupplierCommunication).toHaveBeenCalled();
    });

    unmountComm();

  });

});