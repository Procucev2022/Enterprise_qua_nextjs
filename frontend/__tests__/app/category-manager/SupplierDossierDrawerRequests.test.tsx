jest.mock('@/lib/accountDocumentsClient', () => ({
  addSellerQuoteCredits: jest.fn().mockResolvedValue({ success: true, message: 'Added credits' }),
  createCreditApprovalIdempotencyKey: jest.fn(() => '00000000-0000-4000-8000-000000000002'),
  requestSellerQuoteCreditApproval: jest.fn().mockResolvedValue({ success: true, message: 'Request submitted' }),
  fetchAccountDocuments: jest.fn().mockResolvedValue([]),
  uploadAccountDocument: jest.fn().mockResolvedValue({ success: true }),
  deleteAccountDocument: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchCategoryTaxonomy: jest.fn().mockResolvedValue({
    success: true,
    data: [
      { majorCategory: 'Engineering Spares - Electrical', minorCategories: [] },
      { majorCategory: 'Industrial Supplies', minorCategories: [] },
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

jest.mock('@/lib/supplierProfileClient', () => ({
  fetchSupplierCreditHistory: jest.fn().mockResolvedValue({
    success: true,
    summary: { remainingFreeCredits: 10, totalCreditsGranted: 15, totalCreditsUsed: 5 },
    transactions: [],
  }),
  updateSupplierCategories: jest.fn().mockResolvedValue({ success: true }),
  fetchSupplierCommunications: jest.fn().mockResolvedValue({ success: true, count: 0, data: [] }),
  recordSupplierCommunication: jest.fn(),
  fetchSupplierPaymentHistory: jest.fn().mockResolvedValue({ success: true, summary: null, transactions: [] }),
  fetchSellerBuyerUploads: jest.fn().mockResolvedValue({ success: true, count: 0, data: [] }),
  fetchSellerActiveRFQs: jest.fn().mockResolvedValue({ success: true, count: 0, data: [] }),
}));

jest.mock('@/lib/documentVaultClient', () => ({
  fetchDocuments: jest.fn().mockResolvedValue([]),
}));

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SupplierDossierDrawer from '@/app/category-manager/components/SupplierDossierDrawer';
import { authClient } from '@/lib/authClient';
import { requestSellerQuoteCreditApproval } from '@/lib/accountDocumentsClient';
import { updateSupplierCategories } from '@/lib/supplierProfileClient';
import { UI_STRINGS } from '@/lib/uiStrings';

class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,mockbase64`;
    if (this.onload) this.onload();
  }
}

const mockSeller = {
  id: 'vendor-seller-101',
  name: 'Acme Technologies Pvt Ltd',
  companyName: 'Acme Technologies Pvt Ltd',
  contactPerson: 'Alice Vendor',
  email: 'alice@acmetech.com',
  phone: '9876543210',
  city: 'Hyderabad',
  state: 'Telangana',
  freeQuotationCredits: 10,
  subscriptionTier: 'PREMIUM',
  source: 'procucev_network',
  createdAt: '2026-01-15T10:00:00Z',
};

describe('SupplierDossierDrawer - Seller Request Management Workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { FileReader: unknown }).FileReader = MockFileReader;
    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValue({ success: true, message: 'Request submitted' });
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: 'session-user-1',
      name: 'Session Initiator',
      email: 'initiator@example.com',
    } as unknown as ReturnType<typeof authClient.getSessionUser>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Scenario 1: Opens Request Type dropdown and displays all 5 seller request types', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    const dropdownBtn = screen.getByTestId('request-type-dropdown-btn');
    expect(dropdownBtn).toBeInTheDocument();
    fireEvent.click(dropdownBtn);

    expect(screen.getByRole('menuitem', { name: 'Seller Credit Addition' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Discount' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Trial Period' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Offline Payments' })).toBeInTheDocument();
  });

  it('Scenario 2: Seller Credit Addition workflow with validation and successful submission', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Addition' }));

    expect(screen.getByText('Request Seller Quote Credit Approval')).toBeInTheDocument();

    const creditInput = document.getElementById('quote-credits-requested') as HTMLInputElement;
    fireEvent.change(creditInput, { target: { value: '5' } });

    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    const reasonInput = screen.getByPlaceholderText('Reason for credit addition...');
    fireEvent.change(reasonInput, { target: { value: 'Adding initial onboarding credits' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          amount: 5,
          approverName: 'Srinu Sir',
          reason: 'Adding initial onboarding credits',
        })
      );
    });
  });

  it('Scenario 3: Seller Credit Deletion workflow with balance constraint validation and submission', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' }));

    expect(screen.getByText('Request Seller Credit Deletion')).toBeInTheDocument();
    expect(screen.getByText(/Credits Available/i)).toBeInTheDocument();

    const creditInput = document.getElementById('quote-credits-requested') as HTMLInputElement;
    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    // Try deleting more than available balance (mockSeller balance is 10)
    fireEvent.change(creditInput, { target: { value: '99' } });
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    expect(requestSellerQuoteCreditApproval).not.toHaveBeenCalled();

    // Now enter valid deduction amount
    fireEvent.change(creditInput, { target: { value: '4' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Seller Credit Deletion',
          amount: 4,
          approverName: 'Srinu Sir',
        })
      );
    });
  });

  it('Scenario 4: Discount workflow displays ONLY Connect Model and Select Model, calculates live breakdown, and submits', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));

    expect(screen.getByText('Request Discount Approval')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2: Select sourcing mode for discount request/i)).toBeInTheDocument();

    // Verify ONLY Connect Model and Select Model are displayed with their annual prices
    expect(screen.getByRole('button', { name: /Connect Model/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Model/i })).toBeInTheDocument();
    expect(screen.getByText(/₹7,499 \/ yr/i)).toBeInTheDocument();
    expect(screen.getByText(/₹14,999 \/ yr/i)).toBeInTheDocument();
    expect(screen.queryByText('Mode 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Mode 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Mode 3')).not.toBeInTheDocument();

    // Step 1: Click Connect Model
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));

    // Step 2: Enter Discount & Review Breakdown directly (without duration selection)
    expect(screen.getByText(/Step 2 of 2: Submit discount authorization for Connect Model/i)).toBeInTheDocument();
    expect(screen.getByText(/Price Breakdown/i)).toBeInTheDocument();
    expect(screen.getAllByText('Original Plan Price')[0]).toBeInTheDocument();
    expect(screen.getAllByText('₹7,499')[0]).toBeInTheDocument();

    // Enter discount percentage
    const discountInput = screen.getByPlaceholderText('0');
    fireEvent.change(discountInput, { target: { value: '20' } });

    // Verify calculated breakdown contains 20% discount amount and GST
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('Price Breakdown')).toBeInTheDocument();

    // Enter approver and submit
    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Discount',
          selectedMode: 'Connect Model',
          billingDuration: '12 Months',
          discountPercentage: 20,
          approverName: 'Srinu Sir',
        })
      );
    });
  });

  it('Scenario 5: Trial Period workflow displays ONLY Connect Model and Select Model, validates duration and submits', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));

    expect(screen.getByRole('heading', { name: 'Request Trial Period Approval' })).toBeInTheDocument();
    expect(screen.getByText('Select Sourcing Mode')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2: Select sourcing mode for trial period request.')).toBeInTheDocument();

    // Verify ONLY Connect Model and Select Model are displayed
    expect(screen.getByRole('button', { name: /Connect Model/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Model/i })).toBeInTheDocument();
    expect(screen.queryByText('Mode 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Mode 2')).not.toBeInTheDocument();

    // Step 1: Select Select Model
    fireEvent.click(screen.getByRole('button', { name: /Select Model/i }));

    // Step 2: Trial Extension Period Details
    expect(screen.getByText('Request Trial Period Approval')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Select Model')).toBeInTheDocument();

    // Test start date change
    const startDateInput = document.getElementById('trial-start-date') as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: '2026-12-01' } });

    // Test invalid end date before start date
    const endDateInput = document.getElementById('trial-end-date') as HTMLInputElement;
    fireEvent.change(endDateInput, { target: { value: '2026-11-01' } });
    expect(screen.getByText('End date cannot be earlier than start date.')).toBeInTheDocument();

    // Correct end date (30 days)
    fireEvent.change(endDateInput, { target: { value: '2026-12-31' } });

    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Trial Period',
          selectedMode: 'Select Model',
          durationDays: 30,
          approverName: 'Srinu Sir',
        })
      );
    });
  });

  it('Scenario 6: Offline Payments workflow hides Transaction ID when Cash is selected and shows for other types', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

    expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();

    // Initially NEFT / RTGS is selected -> Transaction ID field must be visible
    expect(document.getElementById('offline-transaction-id')).toBeInTheDocument();

    const typeSelect = screen.getByTestId('offline-payment-type-select') as HTMLSelectElement;

    // Switch to Cash -> Transaction ID field MUST BE HIDDEN
    fireEvent.change(typeSelect, { target: { value: 'Cash' } });
    expect(document.getElementById('offline-transaction-id')).toBeNull();

    // Switch to UPI -> Transaction ID field MUST REAPPEAR
    fireEvent.change(typeSelect, { target: { value: 'UPI' } });
    expect(document.getElementById('offline-transaction-id')).toBeInTheDocument();

    // Switch to Cheque -> Transaction ID field remains visible
    fireEvent.change(typeSelect, { target: { value: 'Cheque' } });
    expect(document.getElementById('offline-transaction-id')).toBeInTheDocument();
  });

  it('Scenario 7: Offline Payments handles proof file upload (image format, preview and remove) and submission', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

    // Test file input with invalid extension
    const fileInput = screen.getByTestId('offline-proof-file-input') as HTMLInputElement;
    const invalidFile = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    // Test oversized file
    const oversizedFile = new File([new Uint8Array(11 * 1024 * 1024)], 'large.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    // Upload valid image file
    const validFile = new File(['valid-image-bytes'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });
    expect(screen.getByText('receipt.png')).toBeInTheDocument();

    // Test removing proof
    const removeBtn = screen.getByTitle('Remove attachment');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('receipt.png')).not.toBeInTheDocument();

    // Re-upload valid file
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    // Fill form fields
    const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-11-19' } });

    const txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
    fireEvent.change(txInput, { target: { value: 'UTR-9876543210' } });

    const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '14999' } });

    const approverInput = document.getElementById('offline-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Offline Payments',
          paymentAmount: 14999,
          paymentDate: '2026-11-19',
          transactionId: 'UTR-9876543210',
          approverName: 'Srinu Sir',
        })
      );
    });
  });

  it('Scenario 8: Keyboard Escape dismisses request type dropdown and open modals', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Open dropdown
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    expect(screen.getByRole('menuitem', { name: 'Seller Credit Addition' })).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Seller Credit Addition' })).not.toBeInTheDocument();

    // Open modal
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));
    expect(screen.getByText('Request Discount Approval')).toBeInTheDocument();

    // Press Escape closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Request Discount Approval')).not.toBeInTheDocument();
  });

  it('Scenario 9: Discount workflow navigation (Back buttons), 6 Months duration, input validation, and API rejection', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Open Discount
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));

    // Step 1: Select Select Model
    fireEvent.click(screen.getByRole('button', { name: /Select Model/i }));

    // In Step 2 for Select Model: Verify ₹14,999 pricing
    expect(screen.getByText(/Step 2 of 2: Submit discount authorization for Select Model/i)).toBeInTheDocument();
    expect(screen.getAllByText('₹14,999')[0]).toBeInTheDocument();

    // Click Back button to return to Step 1
    const backBtn = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(backBtn);
    expect(screen.getByText(/Step 1 of 2: Select sourcing mode for discount request/i)).toBeInTheDocument();

    // Select Connect Model again
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));
    expect(screen.getAllByText('₹7,499')[0]).toBeInTheDocument();

    // Enter invalid discount percentage > 100
    const discountInput = screen.getByPlaceholderText('0');
    fireEvent.change(discountInput, { target: { value: '150' } });
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    // Enter negative discount
    fireEvent.change(discountInput, { target: { value: '-10' } });
    fireEvent.click(submitBtn);

    // Enter valid discount but clear approver
    fireEvent.change(discountInput, { target: { value: '15' } });
    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: '' } });
    fireEvent.click(submitBtn);

    // Test API rejection branch
    (requestSellerQuoteCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network error on discount'));
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // Test Cancel button
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Request Discount Approval')).not.toBeInTheDocument();
  });

  it('Scenario 10: Trial Period workflow navigation (Back button), date validation edge cases, and API rejection', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));

    // Step 1: Select Connect Model
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));

    // Step 2: Click Back button
    const backBtn = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(backBtn);
    expect(screen.getByText('Step 1 of 2: Select sourcing mode for trial period request.')).toBeInTheDocument();

    // Select Connect Model again
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));

    // Test start date change and end date change
    const startDateInput = document.getElementById('trial-start-date') as HTMLInputElement;
    const endDateInput = document.getElementById('trial-end-date') as HTMLInputElement;
    fireEvent.change(startDateInput, { target: { value: '2026-11-01' } });
    fireEvent.change(endDateInput, { target: { value: '2026-11-15' } }); // 14 days difference

    // Clear approver and submit
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    fireEvent.change(approverInput, { target: { value: '' } });
    fireEvent.click(submitBtn);

    // Test API rejection branch
    (requestSellerQuoteCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Network error on trial'));
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // Test Cancel button closes modal
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Request Trial Period Approval')).not.toBeInTheDocument();
  });

  it('Scenario 11: Offline Payments validations, Cash payment submission, dropzone click and cancel', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

    expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();

    // Test click upload dropzone
    const dropzoneBtn = screen.getByText(/upload payment/i);
    fireEvent.click(dropzoneBtn);

    const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
    const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
    const approverInput = document.getElementById('offline-approver') as HTMLInputElement;
    const typeSelect = screen.getByTestId('offline-payment-type-select') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });

    // Enter amount to enable submit button
    fireEvent.change(amountInput, { target: { value: '5000' } });

    // Test empty date
    fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.click(submitBtn);

    // Test non-cash (NEFT / RTGS) without transaction ID
    fireEvent.change(dateInput, { target: { value: '2026-11-19' } });
    const txInput = document.getElementById('offline-transaction-id') as HTMLInputElement;
    fireEvent.change(txInput, { target: { value: '' } });
    fireEvent.click(submitBtn);

    // Test Cash mode submission: transaction ID is not required
    fireEvent.change(typeSelect, { target: { value: 'Cash' } });
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValueOnce({
      success: true,
      message: 'Offline payment recorded successfully',
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Offline Payments',
          paymentAmount: 5000,
          paymentType: 'Cash',
          transactionId: undefined,
        })
      );
    });
  });

  it('Scenario 11b: Offline Payments API rejection and cancel button', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

    const dateInput = document.getElementById('offline-payment-date') as HTMLInputElement;
    const amountInput = document.getElementById('offline-payment-amount') as HTMLInputElement;
    const approverInput = document.getElementById('offline-approver') as HTMLInputElement;
    const typeSelect = screen.getByTestId('offline-payment-type-select') as HTMLSelectElement;

    fireEvent.change(dateInput, { target: { value: '2026-11-19' } });
    fireEvent.change(amountInput, { target: { value: '7499' } });
    fireEvent.change(typeSelect, { target: { value: 'Cash' } });
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });

    (requestSellerQuoteCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Offline payment failed'));
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // Test cancel button
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Request Offline Payment Approval')).not.toBeInTheDocument();
  });

  it('Scenario 12: Seller Credit Deletion and Addition edge cases, cancel buttons, and API rejection error toasts', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // 1. Credit Deletion: amount <= 0, empty approver, cancel button, and API error
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' }));

    const creditInput = document.getElementById('quote-credits-requested') as HTMLInputElement;
    const approverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    const submitBtn = screen.getByRole('button', { name: 'Submit for Approval' });

    // Amount <= 0
    fireEvent.change(creditInput, { target: { value: '0' } });
    fireEvent.click(submitBtn);

    // Missing approver
    fireEvent.change(creditInput, { target: { value: '2' } });
    fireEvent.change(approverInput, { target: { value: '' } });
    fireEvent.click(submitBtn);

    // API error on deduction
    (requestSellerQuoteCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Deduction failed'));
    fireEvent.change(approverInput, { target: { value: 'Srinu Sir' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // Cancel deduction modal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Request Seller Credit Deletion')).not.toBeInTheDocument();

    // 2. Credit Addition: amount <= 0, empty approver, cancel button, and API error
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Addition' }));
    expect(screen.getByText('Request Seller Quote Credit Approval')).toBeInTheDocument();

    const addCreditInput = document.getElementById('quote-credits-requested') as HTMLInputElement;
    const addApproverInput = document.getElementById('quote-credit-approver') as HTMLInputElement;
    const addSubmitBtn = screen.getByRole('button', { name: 'Submit for Approval' });

    // Amount <= 0
    fireEvent.change(addCreditInput, { target: { value: '0' } });
    fireEvent.click(addSubmitBtn);

    // Empty approver
    fireEvent.change(addCreditInput, { target: { value: '3' } });
    fireEvent.change(addApproverInput, { target: { value: '' } });
    fireEvent.click(addSubmitBtn);

    // API returns success: false
    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Backend addition rejected',
    });
    fireEvent.change(addApproverInput, { target: { value: 'Srinu Sir' } });
    fireEvent.click(addSubmitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // API error on addition (rejects)
    (requestSellerQuoteCreditApproval as jest.Mock).mockRejectedValueOnce(new Error('Addition failed'));
    fireEvent.click(addSubmitBtn);

    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalled();
    });

    // Cancel addition modal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Request Seller Quote Credit Approval')).not.toBeInTheDocument();
  });

  it('Scenario 13: Drawer Tab switches, Credit history export and clicking outside request type dropdown', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Test clicking outside request type dropdown
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    expect(screen.getByRole('menuitem', { name: 'Seller Credit Addition' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menuitem', { name: 'Seller Credit Addition' })).not.toBeInTheDocument();

    // Tab switches
    const quotesTab = screen.getByRole('button', { name: /Quotes \(/i });
    fireEvent.click(quotesTab);

    const creditTab = screen.getByRole('button', { name: /^Credit$/i });
    fireEvent.click(creditTab);

    // Filter credits and change search
    const creditSearchInput = screen.queryByPlaceholderText(/Search transactions/i);
    if (creditSearchInput) {
      fireEvent.change(creditSearchInput, { target: { value: 'TX123' } });
    }

    const commsTab = screen.getByRole('button', { name: /Communications \(/i });
    fireEvent.click(commsTab);

    const paymentsTab = screen.getByRole('button', { name: /Payments \(/i });
    fireEvent.click(paymentsTab);

    const docsTab = screen.getByRole('button', { name: /Documents \(/i });
    fireEvent.click(docsTab);

    const buyerUploadsTab = screen.getByRole('button', { name: /Buyer Uploads \(/i });
    fireEvent.click(buyerUploadsTab);

    const activeRfqsTab = screen.getByRole('button', { name: /Active RFQs \(/i });
    fireEvent.click(activeRfqsTab);

    const profileTab = screen.getByRole('button', { name: /^Profile$/i });
    fireEvent.click(profileTab);
  });

  it('Scenario 14: Category edit modal open, toggle category, add category, and save', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Click Edit Procurement Categories Master
    const editBtn = screen.getByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtn);

    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('heading', { name: /Procurement Categories Master/i })).toBeInTheDocument();

    // Add new category
    const input = screen.getByPlaceholderText(UI_STRINGS.vendorCategorySelect.searchPlaceholder);
    fireEvent.change(input, { target: { value: 'Custom Hardware Division' } });
    const addCategoryBtn = within(modal).getByRole('button', { name: /Add Category/i });
    fireEvent.click(addCategoryBtn);

    // Save
    const saveBtn = screen.getByRole('button', { name: /Save Categories/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSupplierCategories).toHaveBeenCalled();
    });
  });

  it('Scenario 15: Discount modal navigation, close buttons, cancel buttons, and step transitions', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Step 1: Open and Cancel
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));
    expect(screen.getByText('Select Sourcing Mode')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Select Sourcing Mode')).not.toBeInTheDocument();

    // Step 1: Open and transition to Step 2
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));
    fireEvent.click(screen.getByText('Connect Model'));
    expect(screen.getByDisplayValue('Connect Model')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12 Months')).toBeInTheDocument();

    // Step 2: Back button returns to Step 1
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByText('Select Sourcing Mode')).toBeInTheDocument();

    // Transition Step 1 -> Step 2 -> Cancel
    fireEvent.click(screen.getByText('Select Model'));
    expect(screen.getByDisplayValue('Select Model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Request Discount Approval')).not.toBeInTheDocument();

    // Transition Step 1 -> Step 2 -> Close (X)
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));
    fireEvent.click(screen.getByText('Connect Model'));
    expect(screen.getByText('Request Discount Approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Request Discount Approval')).not.toBeInTheDocument();
  });

  it('Scenario 16: Trial Period and Offline Payments interactive navigation, sourcing mode change, and dismissals', async () => {
    render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Trial Period Step 1: Cancel
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));
    expect(screen.getByRole('heading', { name: 'Request Trial Period Approval' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Request Trial Period Approval' })).not.toBeInTheDocument();

    // Trial Period Step 1 -> Step 2 -> Close (X)
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));
    fireEvent.click(screen.getByText('Select Model'));
    expect(document.getElementById('trial-start-date')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.getElementById('trial-start-date')).not.toBeInTheDocument();

    // Offline Payments: Change sourcing mode, remarks, and Close (X)
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
    expect(screen.getByText('Request Offline Payment Approval')).toBeInTheDocument();

    const modeSelect = document.getElementById('offline-sourcing-mode-select') as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'Select Model' } });
    expect(modeSelect.value).toBe('Select Model');

    const remarksTextarea = document.getElementById('offline-remarks') as HTMLTextAreaElement;
    if (remarksTextarea) {
      fireEvent.change(remarksTextarea, { target: { value: 'Payment remarks for offline verification' } });
    }

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Request Offline Payment Approval')).not.toBeInTheDocument();
  });
  it('Scenario 17: Fallback branch coverage for success toasts without message, error fallbacks, and edge case props', async () => {
    // 1. Render without id and without initialTab
    const { unmount } = render(
      <SupplierDossierDrawer seller={{ ...mockSeller, id: '' }} onClose={jest.fn()} />
    );
    expect(screen.getByText('Acme Technologies Pvt Ltd')).toBeInTheDocument();
    unmount();

    // 2. Render with fallback rfqs prop when sellerRfqs is empty
    const { unmount: unmount2 } = render(
      <SupplierDossierDrawer
        seller={mockSeller}
        sellerRfqs={[]}
        rfqs={[{ id: 'rfq-fb-1', rfqNumber: 'RFQ-FB-001', title: 'Fallback RFQ', quotesCount: 0 } as any]}
        initialTab="quotes"
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Quotes \(0\)/i })).toBeInTheDocument();
    unmount2();

    // 3. Render fresh component for remaining workflow assertions
    const { unmount: unmount3 } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // 3. Test success toasts without res.message (fallbacks for Discount, Trial, Addition, Deletion, Offline)
    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValue({ success: true });

    // 3a. Discount without res.message
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }));
    fireEvent.click(screen.getByText('Connect Model'));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '20' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Discount request submitted/i)[0]).toBeInTheDocument();
    });

    // 3b. Trial Period without res.message
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));
    fireEvent.click(screen.getByText('Connect Model'));
    fireEvent.change(document.getElementById('trial-start-date') as HTMLInputElement, { target: { value: '2026-11-01' } });
    fireEvent.change(document.getElementById('trial-end-date') as HTMLInputElement, { target: { value: '2026-12-01' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Trial period request submitted/i)[0]).toBeInTheDocument();
    });

    // 3c. Seller Credit Deletion without res.message
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' }));
    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '2' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Credit deduction request submitted/i)[0]).toBeInTheDocument();
    });

    // 3d. Seller Credit Addition without res.message
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Addition' }));
    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '3' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Quote credit request submitted/i)[0]).toBeInTheDocument();
    });

    // 3e. Offline Payments without res.message
    // 3e. Offline Payments without res.message
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
    fireEvent.change(document.getElementById('offline-payment-date') as HTMLInputElement, { target: { value: '2026-11-19' } });
    fireEvent.change(screen.getByTestId('offline-payment-type-select'), { target: { value: 'Cash' } });
    fireEvent.change(document.getElementById('offline-payment-amount') as HTMLInputElement, { target: { value: '1500' } });
    fireEvent.change(document.getElementById('offline-initiator') as HTMLSelectElement, { target: { value: 'Govardhan' } });
    fireEvent.change(document.getElementById('offline-approver') as HTMLSelectElement, { target: { value: 'Srinu Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getAllByText(/Offline payment request submitted/i)[0]).toBeInTheDocument();
    });

    // 4. API failures without res.error (fallback error strings)
    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Addition' }));
    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '1' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Approval' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Failed to submit quote credit approval request/i)[0]).toBeInTheDocument();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 4b. Offline payment API failure without res.error
    (requestSellerQuoteCreditApproval as jest.Mock).mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
    fireEvent.change(document.getElementById('offline-payment-date') as HTMLInputElement, { target: { value: '2026-11-19' } });
    fireEvent.change(screen.getByTestId('offline-payment-type-select'), { target: { value: 'Cash' } });
    fireEvent.change(document.getElementById('offline-payment-amount') as HTMLInputElement, { target: { value: '1000' } });
    fireEvent.change(document.getElementById('offline-initiator') as HTMLSelectElement, { target: { value: 'Govardhan' } });
    fireEvent.change(document.getElementById('offline-approver') as HTMLSelectElement, { target: { value: 'Srinu Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getAllByText('Failed to submit offline payment approval request.')[0]).toBeInTheDocument();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 5. Trial period date validation where end date is before start date
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));
    fireEvent.change(document.getElementById('trial-start-date') as HTMLInputElement, { target: { value: '2026-12-01' } });
    fireEvent.change(document.getElementById('trial-end-date') as HTMLInputElement, { target: { value: '2026-11-01' } });
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeDisabled();
    unmount3();
  });

  it('Scenario 19: Validates 2 Modes (Connect & Select Model), 12 Months duration, Initiators, and Approvers', async () => {
    const { unmount } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="credit" onClose={jest.fn()} />);

    // Open Discount workflow
    const dropdownBtn = screen.getByTestId('request-type-dropdown-btn');
    fireEvent.click(dropdownBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Discount$/i }));

    // Step 1: Verify Connect Model and Select Model are available
    expect(screen.getByText('Connect Model')).toBeInTheDocument();
    expect(screen.getByText('Select Model')).toBeInTheDocument();

    // Select "Select Model" - advances directly to Step 2
    fireEvent.click(screen.getByText('Select Model'));

    // Step 2: Verify Selected Mode, Duration and pricing displayed
    expect(screen.getByDisplayValue('Select Model')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12 Months')).toBeInTheDocument();
    expect(screen.getAllByText('₹14,999')[0]).toBeInTheDocument();

    // Test Back button from Step 2 to Step 1
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Connect Model')).toBeInTheDocument();

    // Re-select Connect Model
    fireEvent.click(screen.getByText('Connect Model'));
    expect(screen.getByDisplayValue('Connect Model')).toBeInTheDocument();
    expect(screen.getAllByText('₹7,499')[0]).toBeInTheDocument();

    // Verify Initiated By dropdown options: first four strictly Govardhan, Chandan, Krishna Chaitanya, Sudheer
    const initiatorSelect = document.getElementById('discount-initiator') as HTMLSelectElement;
    expect(initiatorSelect).toBeInTheDocument();
    const initiatorOptionValues = Array.from(initiatorSelect.options).map((opt) => opt.value);
    expect(initiatorOptionValues[1]).toBe('Govardhan');
    expect(initiatorOptionValues[2]).toBe('Chandan');
    expect(initiatorOptionValues[3]).toBe('Krishna Chaitanya');
    expect(initiatorOptionValues[4]).toBe('Sudheer');

    // Verify Assigned Approver dropdown: strictly 3 options (Srinu Sir, Rao Sir, Sudheer Sir)
    const approverSelect = document.getElementById('quote-credit-approver') as HTMLSelectElement;
    expect(approverSelect).toBeInTheDocument();
    const approverOptions = Array.from(approverSelect.options).filter((opt) => opt.value !== '').map((opt) => opt.value);
    expect(approverOptions).toEqual(['Srinu Sir', 'Rao Sir', 'Sudheer Sir']);

    // Change discount percent and check breakdown
    const discountInput = document.getElementById('seller-discount-percentage') as HTMLInputElement;
    fireEvent.change(discountInput, { target: { value: '25' } });
    expect(discountInput.value).toBe('25');

    // Submit discount approval request
    fireEvent.change(initiatorSelect, { target: { value: 'Chandan' } });
    fireEvent.change(approverSelect, { target: { value: 'Rao Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Request submitted/i)).toBeInTheDocument();
    });
    unmount();
  });

  it('Scenario 20: Validates 2-step discount workflow, back button, and credit deletion validations', async () => {
    const { unmount } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="credit" onClose={jest.fn()} />);

    // Test Discount flow for Connect Model
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Discount$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));
    expect(screen.getByDisplayValue('Connect Model')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12 Months')).toBeInTheDocument();

    // Test Back button from Step 2 to Step 1
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /Connect Model/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Model/i })).toBeInTheDocument();

    // Cancel from Step 1
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Test Seller Credit Deletion
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' }));

    // Initiator dropdown first 4 options
    const delInitiatorSelect = document.getElementById('quote-credit-initiator') as HTMLSelectElement;
    expect(delInitiatorSelect).toBeInTheDocument();
    const delInitiatorOptions = Array.from(delInitiatorSelect.options).map((opt) => opt.value);
    expect(delInitiatorOptions[1]).toBe('Govardhan');
    expect(delInitiatorOptions[2]).toBe('Chandan');
    expect(delInitiatorOptions[3]).toBe('Krishna Chaitanya');
    expect(delInitiatorOptions[4]).toBe('Sudheer');

    // Approver dropdown strictly 3 options
    const delApproverSelect = document.getElementById('quote-credit-approver') as HTMLSelectElement;
    expect(delApproverSelect).toBeInTheDocument();
    const delApproverOptions = Array.from(delApproverSelect.options).filter((opt) => opt.value !== '').map((opt) => opt.value);
    expect(delApproverOptions).toEqual(['Srinu Sir', 'Rao Sir', 'Sudheer Sir']);

    // Attempt to deduct more than available credits
    const deductInput = document.getElementById('quote-credits-requested') as HTMLInputElement;
    fireEvent.change(deductInput, { target: { value: '9999' } });
    fireEvent.change(delApproverSelect, { target: { value: 'Sudheer Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    expect(requestSellerQuoteCreditApproval).not.toHaveBeenCalled();

    // Valid deduction amount
    fireEvent.change(deductInput, { target: { value: '2' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(requestSellerQuoteCreditApproval).toHaveBeenCalledWith(
        mockSeller.id,
        expect.objectContaining({
          requestType: 'Seller Credit Deletion',
          amount: 2,
          approverName: 'Sudheer Sir',
        })
      );
    });
    unmount();
  });

  it('Scenario 21: Validates Category Management autocomplete, keyboard, removal, empty error, and tag addition', async () => {
    const { unmount } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // Open Category Modal
    const editCatBtn = screen.getByRole('button', { name: /^Edit$/i });
    fireEvent.click(editCatBtn);

    const catInput = screen.getByLabelText(UI_STRINGS.vendorCategorySelect.categoryLabel);
    expect(catInput).toBeInTheDocument();

    // Type 2 chars (< 3 chars minCharsHint)
    fireEvent.change(catInput, { target: { value: 'El' } });
    expect(screen.getByText(UI_STRINGS.vendorCategorySelect.minCharsHint)).toBeInTheDocument();

    // Type 3+ chars to trigger suggestions
    fireEvent.change(catInput, { target: { value: 'Elec' } });
    fireEvent.focus(catInput);

    // Press Escape to hide suggestions
    fireEvent.keyDown(catInput, { key: 'Escape' });

    // Press Enter to add custom category
    fireEvent.keyDown(catInput, { key: 'Enter' });

    // Clear input using clear button
    fireEvent.change(catInput, { target: { value: 'Custom Hardware' } });
    const clearBtn = screen.getByLabelText('Clear category input');
    fireEvent.click(clearBtn);

    // Add category using Add button
    fireEvent.change(catInput, { target: { value: 'New Test Division' } });
    const addCatBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.click(addCatBtn);

    // Remove all categories to trigger empty validation
    const removeButtons = screen.getAllByLabelText(/^Remove /i);
    for (const btn of removeButtons) {
      fireEvent.click(btn);
    }

    // Try saving empty categories
    const saveBtn = screen.getByRole('button', { name: /Save Categories/i });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByText(/Please select at least one division/i)).toBeInTheDocument();
    });

    // Add a category and save successfully
    fireEvent.change(catInput, { target: { value: 'Engineering Spares' } });
    fireEvent.click(addCatBtn);
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(updateSupplierCategories).toHaveBeenCalled();
    });

    unmount();
  });

  it('Scenario 22: Validates Trial Period edge dates and Offline Payment file/field validations', async () => {
    const { unmount } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="credit" onClose={jest.fn()} />);

    // 1. Trial Period Date Edge Cases
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trial Period' }));
    fireEvent.click(screen.getByRole('button', { name: /Connect Model/i }));

    const startInput = document.getElementById('trial-start-date') as HTMLInputElement;
    const endInput = document.getElementById('trial-end-date') as HTMLInputElement;

    // Same day -> Trial period must be at least 1 day
    fireEvent.change(startInput, { target: { value: '2026-11-20' } });
    fireEvent.change(endInput, { target: { value: '2026-11-20' } });
    expect(screen.getByText(/Trial period must be at least 1 day/i)).toBeInTheDocument();

    // 400 days in future -> Trial extension cannot exceed 365 days
    fireEvent.change(endInput, { target: { value: '2028-01-01' } });
    expect(screen.getByText(/Trial extension cannot exceed 365 days/i)).toBeInTheDocument();

    // Close Trial Period modal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 2. Offline Payment File Format and Size Validations
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));

    const fileInput = screen.getByTestId('offline-proof-file-input');

    // Invalid file extension
    const invalidFile = new File(['dummy content'], 'document.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });
    await waitFor(() => {
      expect(screen.getByText(/Please upload an image file in JPG, JPEG, or PNG format/i)).toBeInTheDocument();
    });

    // File too large (>10MB)
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [largeFile] } });
    await waitFor(() => {
      expect(screen.getByText(/Payment proof file must be smaller than 10MB/i)).toBeInTheDocument();
    });

    // Valid file upload and then remove it
    const validFile = new File(['valid image content'], 'receipt.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });
    await waitFor(() => {
      expect(screen.getByTitle('Remove attachment')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('Remove attachment'));

    // 3. Offline Payment Field Validations
    const getOfflineForm = () => screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!;

    // Missing date
    fireEvent.change(document.getElementById('offline-payment-date') as HTMLInputElement, { target: { value: '' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/Payment date is mandatory/i)).toBeInTheDocument();
    });

    // Set date, missing transaction ID for non-Cash
    fireEvent.change(document.getElementById('offline-payment-date') as HTMLInputElement, { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByTestId('offline-payment-type-select'), { target: { value: 'NEFT / RTGS' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/Transaction ID is mandatory for NEFT \/ RTGS/i)).toBeInTheDocument();
    });

    // Set transaction ID, missing/zero amount
    fireEvent.change(document.getElementById('offline-transaction-id') as HTMLInputElement, { target: { value: 'TXN-9988' } });
    fireEvent.change(document.getElementById('offline-payment-amount') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/greater than 0/i)).toBeInTheDocument();
    });

    // Set amount, missing initiator
    fireEvent.change(document.getElementById('offline-payment-amount') as HTMLInputElement, { target: { value: '5000' } });
    fireEvent.change(document.getElementById('offline-initiator') as HTMLSelectElement, { target: { value: '' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/Initiated by user is mandatory/i)).toBeInTheDocument();
    });

    // Set initiator, missing approver
    fireEvent.change(document.getElementById('offline-initiator') as HTMLSelectElement, { target: { value: 'Govardhan' } });
    fireEvent.change(document.getElementById('offline-approver') as HTMLSelectElement, { target: { value: '' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/Assigned approver is mandatory/i)).toBeInTheDocument();
    });

    // Valid approver and submit successfully
    fireEvent.change(document.getElementById('offline-approver') as HTMLSelectElement, { target: { value: 'Srinu Sir' } });
    fireEvent.submit(getOfflineForm());
    await waitFor(() => {
      expect(screen.getByText(/Request submitted|Offline payment request submitted/i)).toBeInTheDocument();
    });

    unmount();
  });

  it('Scenario 23: Covers category suggestion selection, file upload without files, and credit amount zero validations', async () => {
    const { unmount } = render(<SupplierDossierDrawer seller={mockSeller} initialTab="profile" onClose={jest.fn()} />);

    // 1. Category suggestion selection via Add button
    const editCatBtn = screen.getByRole('button', { name: /^Edit$/i });
    fireEvent.click(editCatBtn);

    const catInput = screen.getByLabelText(UI_STRINGS.vendorCategorySelect.categoryLabel);
    fireEvent.change(catInput, { target: { value: 'Industrial' } });
    fireEvent.focus(catInput);

    const addCatBtn = screen.getByRole('button', { name: /Add Category/i });
    fireEvent.click(addCatBtn);

    // Close category modal
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // 2. Offline proof file input with empty files list
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Offline Payments' }));
    const fileInput = screen.getByTestId('offline-proof-file-input');
    fireEvent.change(fileInput, { target: { files: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 3. Deletion with zero amount and balance exceed
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Deletion' }));
    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.change(document.getElementById('quote-credit-initiator') as HTMLSelectElement, { target: { value: 'Govardhan' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.invalidCreditsError)).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '9999' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(/Cannot delete 9999 credits/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 4. Addition with zero amount
    fireEvent.click(screen.getByTestId('request-type-dropdown-btn'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seller Credit Addition' }));
    fireEvent.change(document.getElementById('quote-credits-requested') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.change(document.getElementById('quote-credit-initiator') as HTMLSelectElement, { target: { value: 'Govardhan' } });
    fireEvent.change(document.getElementById('quote-credit-approver') as HTMLInputElement, { target: { value: 'Srinu Sir' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Submit for Approval' }).closest('form')!);
    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.sellerDirectory.dossier.sellerQuoteCredits.invalidCreditsError)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    unmount();
  });
});
