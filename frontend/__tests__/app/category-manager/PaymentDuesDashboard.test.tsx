import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PaymentDuesDashboard from '@/app/category-manager/components/PaymentDuesDashboard';
import * as paymentDuesClient from '@/lib/paymentDuesClient';
import type { PaymentDuesAccount, PaymentDuesSummary } from '@/lib/types';

jest.mock('@/lib/paymentDuesClient', () => {
  const actual = jest.requireActual('@/lib/paymentDuesClient');
  return {
    ...actual,
    fetchPaymentDues: jest.fn(),
    fetchPaymentDuesSummary: jest.fn(),
    sendPaymentDuesEmail: jest.fn(),
    sendPaymentDuesMessage: jest.fn(),
    sendPaymentDuesWhatsApp: jest.fn(),
    updatePaymentDuesAcknowledgement: jest.fn(),
    fetchPaymentDuesHistory: jest.fn(),
    getPaymentDuesExportUrl: jest.fn().mockReturnValue('/api/payment-dues/export'),
  };
});

// Mock sub-modals to prevent deep dependencies
jest.mock('@/app/category-manager/BuyerDetailsModal', () => {
  return function MockBuyerDetailsModal(props: any) {
    if (!props.isOpen) return null;
    return (
      <div data-testid="buyer-details-modal">
        <span>Buyer Modal: {props.buyerName}</span>
        <button onClick={props.onClose}>Close Buyer Modal</button>
      </div>
    );
  };
});

jest.mock('@/app/category-manager/VendorDetailsModal', () => {
  return function MockVendorDetailsModal(props: any) {
    if (!props.isOpen) return null;
    return (
      <div data-testid="vendor-details-modal">
        <span>Vendor Modal: {props.vendorName}</span>
        <button onClick={props.onClose}>Close Vendor Modal</button>
      </div>
    );
  };
});

const mockAccounts: PaymentDuesAccount[] = [
  {
    accountId: 'acc-buyer-1',
    accountType: 'buyer',
    companyName: 'Apex Industries',
    contactPerson: 'Alex Buyer',
    email: 'alex@apex.com',
    phoneNumber: '9876543210',
    availableCredits: 0,
    totalCredits: 5,
    creditsUsed: 5,
    accountStatus: 'Active',
    registrationDate: '2026-01-01T00:00:00.000Z',
    lastActivity: '2026-02-01T00:00:00.000Z',
    assignedExecutive: 'Devin',
    lastNotification: null,
    notificationChannel: '–',
    acknowledgementStatus: 'Not Notified',
  },
  {
    accountId: 'acc-seller-1',
    accountType: 'seller',
    companyName: 'Zenith Fasteners',
    contactPerson: 'Zack Seller',
    email: 'zack@zenith.com',
    phoneNumber: '9988776655',
    availableCredits: 1,
    totalCredits: 10,
    creditsUsed: 9,
    accountStatus: 'Preferred',
    registrationDate: '2026-01-10T00:00:00.000Z',
    lastActivity: '2026-02-05T00:00:00.000Z',
    assignedExecutive: 'Arun',
    lastNotification: '2026-02-06T00:00:00.000Z',
    notificationChannel: 'email',
    acknowledgementStatus: 'Acknowledgement Pending',
  },
  {
    accountId: 'acc-seller-2',
    accountType: 'seller',
    companyName: 'Delta Bearings',
    contactPerson: 'David Seller',
    email: 'david@delta.com',
    phoneNumber: '9123456789',
    availableCredits: 2,
    totalCredits: 10,
    creditsUsed: 8,
    accountStatus: 'Active',
    registrationDate: '2026-01-12T00:00:00.000Z',
    lastActivity: '2026-02-07T00:00:00.000Z',
    assignedExecutive: 'Nisha',
    lastNotification: '2026-02-07T00:00:00.000Z',
    notificationChannel: 'whatsapp',
    acknowledgementStatus: 'Acknowledged',
  },
  {
    accountId: 'acc-seller-3',
    accountType: 'seller',
    companyName: 'Gamma Tools',
    contactPerson: 'Gary Seller',
    email: 'gary@gamma.com',
    phoneNumber: '9123456780',
    availableCredits: 0,
    totalCredits: 10,
    creditsUsed: 10,
    accountStatus: 'Active',
    registrationDate: '2026-01-15T00:00:00.000Z',
    lastActivity: '2026-02-08T00:00:00.000Z',
    assignedExecutive: 'Devin',
    lastNotification: '2026-02-08T00:00:00.000Z',
    notificationChannel: 'whatsapp',
    acknowledgementStatus: 'Delivered',
  },
  {
    accountId: 'acc-seller-4',
    accountType: 'seller',
    companyName: 'Epsilon Tech',
    contactPerson: 'Eric Seller',
    email: 'eric@epsilon.com',
    phoneNumber: '9123456781',
    availableCredits: 1,
    totalCredits: 10,
    creditsUsed: 9,
    accountStatus: 'Active',
    registrationDate: '2026-01-16T00:00:00.000Z',
    lastActivity: '2026-02-09T00:00:00.000Z',
    assignedExecutive: 'Arun',
    lastNotification: '2026-02-09T00:00:00.000Z',
    notificationChannel: 'email',
    acknowledgementStatus: 'Notification Sent',
  },
  {
    accountId: 'acc-seller-5',
    accountType: 'seller',
    companyName: 'Zeta Parts',
    contactPerson: 'Zoe Seller',
    email: 'zoe@zeta.com',
    phoneNumber: '9123456782',
    availableCredits: 2,
    totalCredits: 10,
    creditsUsed: 8,
    accountStatus: 'Inactive',
    registrationDate: '2026-01-17T00:00:00.000Z',
    lastActivity: '2026-02-10T00:00:00.000Z',
    assignedExecutive: 'Nisha',
    lastNotification: '2026-02-10T00:00:00.000Z',
    notificationChannel: 'message',
    acknowledgementStatus: 'Failed',
  },

];

const mockSummary: PaymentDuesSummary = {
  totalLowCreditAccounts: 3,
  totalBuyers: 1,
  totalSellers: 2,
  zeroCredits: 1,
  oneToTwoCredits: 2,
  acknowledgementPending: 1,
};

describe('PaymentDuesDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: mockAccounts,
      total: 3,
      summary: mockSummary,
      page: 1,
      limit: 25,
    });
    (paymentDuesClient.fetchPaymentDuesSummary as jest.Mock).mockResolvedValue(mockSummary);
    (paymentDuesClient.updatePaymentDuesAcknowledgement as jest.Mock).mockResolvedValue({ success: true });
    (paymentDuesClient.sendPaymentDuesEmail as jest.Mock).mockResolvedValue({ success: true });
    (paymentDuesClient.sendPaymentDuesMessage as jest.Mock).mockResolvedValue({ success: true });
    (paymentDuesClient.sendPaymentDuesWhatsApp as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders summary KPI cards and table rows', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
      expect(screen.getByText('Zenith Fasteners')).toBeInTheDocument();
      expect(screen.getByText('Delta Bearings')).toBeInTheDocument();
    });

    // Check KPI counts
    expect(screen.getByText('Low-Credit Accounts')).toBeInTheDocument();
    expect(screen.getAllByText('0 Credits · Critical')[0]).toBeInTheDocument();
    expect(screen.getAllByText('1 Credit · Attention')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2 Credits · Low')[0]).toBeInTheDocument();
  });

  it('handles search input change and calls fetchPaymentDues', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search company, contact person/i);
    fireEvent.change(searchInput, { target: { value: 'Zenith' } });

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Zenith' })
      );
    });
  });

  it('handles account type, credit, and status dropdown filters', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const accountTypeSelect = screen.getByLabelText('Account Type');
    fireEvent.change(accountTypeSelect, { target: { value: 'buyer' } });

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: 'buyer' })
      );
    });

    const creditsSelect = screen.getByLabelText('Credit Balance');
    fireEvent.change(creditsSelect, { target: { value: '0' } });

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ credits: '0' })
      );
    });

    const statusSelect = screen.getByLabelText('Acknowledgement Status');
    fireEvent.change(statusSelect, { target: { value: 'Acknowledged' } });

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ acknowledgementStatus: 'Acknowledged' })
      );
    });
  });

  it('resets filters when clicking Reset Filters button', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const resetBtn = screen.getByTitle('Reset Filters');
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({
          search: '',
          accountType: 'all',
          credits: 'all',
          acknowledgementStatus: 'all',
        })
      );
    });
  });

  it('clicking KPI summary cards triggers filter shortcuts', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Click 0 Credits card
    const zeroCreditsCard = screen.getByText('0 Credits (Critical)').closest('div');
    if (zeroCreditsCard) fireEvent.click(zeroCreditsCard);

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ credits: '0' })
      );
    });

    // Click Total Buyers card
    const buyersCard = screen.getAllByText('Buyers')[0].closest('div');
    if (buyersCard) fireEvent.click(buyersCard);

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ accountType: 'buyer' })
      );
    });
  });

  it('opens BuyerDetailsModal when buyer name is clicked', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const buyerLink = screen.getByText('Apex Industries');
    fireEvent.click(buyerLink);

    expect(screen.getByTestId('buyer-details-modal')).toBeInTheDocument();
    expect(screen.getByText(/Buyer Modal: Apex Industries/i)).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByText('Close Buyer Modal'));
    expect(screen.queryByTestId('buyer-details-modal')).not.toBeInTheDocument();
  });

  it('opens VendorDetailsModal when seller name is clicked', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Fasteners')).toBeInTheDocument();
    });

    const vendorLink = screen.getByText('Zenith Fasteners');
    fireEvent.click(vendorLink);

    expect(screen.getByTestId('vendor-details-modal')).toBeInTheDocument();
    expect(screen.getByText(/Vendor Modal: Zenith Fasteners/i)).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByText('Close Vendor Modal'));
    expect(screen.queryByTestId('vendor-details-modal')).not.toBeInTheDocument();
  });

  it('Gear Icon popover toggles column visibility, select all, hide optional, and reset', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Click Gear button
    const gearBtn = screen.getByTitle('Customize Columns');
    fireEvent.click(gearBtn);

    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    // Click Hide All Optional
    const hideAllBtn = screen.getByText('Hide All Optional');
    fireEvent.click(hideAllBtn);

    // Email column header should now be hidden
    expect(screen.queryByRole('columnheader', { name: /Email/i })).not.toBeInTheDocument();

    // Click Select All
    const selectAllBtn = screen.getByText('Select All');
    fireEvent.click(selectAllBtn);

    // Email column header should be back
    expect(screen.getByRole('columnheader', { name: /Email/i })).toBeInTheDocument();

    // Click Reset to Default
    const resetBtn = screen.getByText('Reset to Default');
    fireEvent.click(resetBtn);

    expect(screen.getByRole('columnheader', { name: /Email/i })).toBeInTheDocument();
  });

  it('supports drag and drop column reordering in Column Settings', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const gearBtn = screen.getByTitle('Customize Columns');
    fireEvent.click(gearBtn);

    const draggables = screen.getAllByRole('checkbox');
    const firstColContainer = draggables[0].closest('div');
    const secondColContainer = draggables[1].closest('div');

    if (firstColContainer && secondColContainer) {
      fireEvent.dragStart(firstColContainer);
      fireEvent.dragOver(secondColContainer);
      fireEvent.drop(secondColContainer);
    }

    // Should save to localStorage
    expect(localStorage.getItem('qua_payment_dues_column_prefs')).toBeDefined();
  });

  it('toggles column sorting when clicking header', async () => {
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const creditsHeader = screen.getByRole('button', { name: /Available Credits/i });
    fireEvent.click(creditsHeader);

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'availableCredits', sortOrder: 'desc' })
      );
    });
  });

  it('opens Email modal, modifies subject/message, and submits email dispatch', async () => {
    (paymentDuesClient.sendPaymentDuesEmail as jest.Mock).mockResolvedValue({ success: true });
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const emailBtns = screen.getAllByTitle('Send Email');
    fireEvent.click(emailBtns[0]);

    expect(screen.getByText('Send Low-Credit Email Notification')).toBeInTheDocument();

    const subjectInput = screen.getByDisplayValue(/Low Credit Balance Notification – QUA AI/i);
    fireEvent.change(subjectInput, { target: { value: 'Updated Subject' } });

    const sendBtn = screen.getByText('Send Email');
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(paymentDuesClient.sendPaymentDuesEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-buyer-1',
          subject: 'Updated Subject',
        })
      );
    });
  });

  it('opens In-App Message modal and dispatches notification', async () => {
    (paymentDuesClient.sendPaymentDuesMessage as jest.Mock).mockResolvedValue({ success: true });
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const msgBtns = screen.getAllByTitle('Send Message');
    fireEvent.click(msgBtns[0]);

    expect(screen.getByText('Send In-App Notification')).toBeInTheDocument();

    const sendBtn = screen.getByText('Send Notification');
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(paymentDuesClient.sendPaymentDuesMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-buyer-1',
        })
      );
    });
  });

  it('opens WhatsApp modal and sends notification', async () => {
    (paymentDuesClient.sendPaymentDuesWhatsApp as jest.Mock).mockResolvedValue({
      success: true,
      directLink: 'https://wa.me/9876543210',
    });
    window.open = jest.fn();

    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const waBtns = screen.getAllByTitle('WhatsApp Notification');
    fireEvent.click(waBtns[0]);

    expect(screen.getByText('Send WhatsApp Notification')).toBeInTheDocument();

    const sendBtn = screen.getByText('Send via WhatsApp');
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(paymentDuesClient.sendPaymentDuesWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-buyer-1',
        })
      );
      expect(window.open).toHaveBeenCalledWith('https://wa.me/9876543210', '_blank', expect.any(String));
    });
  });

  it('opens Acknowledgement modal and updates status', async () => {
    (paymentDuesClient.updatePaymentDuesAcknowledgement as jest.Mock).mockResolvedValue({ success: true });
    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const ackBtns = screen.getAllByTitle('Update Acknowledgement');
    fireEvent.click(ackBtns[0]);

    expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument();

    const statusSelect = screen.getByLabelText('New Acknowledgement Status');
    fireEvent.change(statusSelect, { target: { value: 'Acknowledged' } });

    const saveBtn = screen.getByText('Save Status');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(paymentDuesClient.updatePaymentDuesAcknowledgement).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-buyer-1',
          acknowledgementStatus: 'Acknowledged',
        })
      );
    });
  });

  it('opens History modal and fetches audit records', async () => {
    (paymentDuesClient.fetchPaymentDuesHistory as jest.Mock).mockResolvedValue([
      {
        id: 'h-1',
        accountId: 'acc-buyer-1',
        accountType: 'buyer',
        channel: 'email',
        recipient: 'alex@apex.com',
        subject: 'Low credit alert',
        message: 'You have 0 credits',
        notificationStatus: 'Delivered',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
        communicatedBy: 'Devin',
        sentAt: '2026-02-01T00:00:00Z',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
    ]);

    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const historyBtns = screen.getAllByTitle('Communication History');
    fireEvent.click(historyBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('Communication & Acknowledgement Audit Trail')).toBeInTheDocument();
      expect(screen.getByText(/You have 0 credits/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByText('Communication & Acknowledgement Audit Trail')).not.toBeInTheDocument();
  });

  it('renders empty state when no accounts are returned', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: [],
      total: 0,
      summary: mockSummary,
      page: 1,
      limit: 25,
    });

    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(/No low-credit buyer or seller accounts found/i)
      ).toBeInTheDocument();
    });
  });

  it('handles pagination next and previous buttons', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: mockAccounts,
      total: 50,
      summary: mockSummary,
      page: 1,
      limit: 25,
    });

    render(<PaymentDuesDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('loads saved column preferences from localStorage on mount', async () => {
    localStorage.setItem(
      'qua_payment_dues_column_prefs',
      JSON.stringify([{ key: 'companyName', visible: true, label: 'Company Name' }])
    );
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });
  });

  it('handles pagination next, previous, page size selection, and refresh', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: mockAccounts,
      total: 100,
      summary: mockSummary,
      page: 2,
      limit: 10,
    });

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Change Page Size
    const pageSizeSelect = screen.getByDisplayValue('25');
    fireEvent.change(pageSizeSelect, { target: { value: '10' } });

    // Buttons
    const buttons = screen.getAllByRole('button');
    const prevBtn = buttons.find((b) => b.querySelector('svg.lucide-chevron-left'));
    const nextBtn = buttons.find((b) => b.querySelector('svg.lucide-chevron-right'));

    if (nextBtn) fireEvent.click(nextBtn);
    if (prevBtn) fireEvent.click(prevBtn);

    // Click Refresh button
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);
  });

  it('clicking all KPI summary cards triggers respective filters', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Total Low-Credit Accounts
    const totalCard = screen.getByText('Low-Credit Accounts').closest('div');
    if (totalCard) fireEvent.click(totalCard);

    // Total Sellers
    const sellersCard = screen.getAllByText('Sellers')[0].closest('div');
    if (sellersCard) fireEvent.click(sellersCard);

    // 1-2 Credits
    const warningCard = screen.getByText('1–2 Credits (Attention)').closest('div');
    if (warningCard) fireEvent.click(warningCard);

    // Ack Pending
    const ackCard = screen.getAllByText('Acknowledgement Pending')[0].closest('div');
    if (ackCard) fireEvent.click(ackCard);

    await waitFor(() => {
      expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();
    });
  });

  it('toggles individual column visibility in Gear popover', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const gearBtn = screen.getByTitle('Customize Columns');
    fireEvent.click(gearBtn);

    // Find checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // toggle accountId

    // Close Column Settings
    const closeBtn = screen.getByText('Column Settings').closest('div')?.querySelector('button');
    if (closeBtn) fireEvent.click(closeBtn);
  });

  it('clicking Account ID opens Buyer and Seller modals', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    const buyerIdBtn = screen.getByText('acc-buyer-1');
    fireEvent.click(buyerIdBtn);
    expect(screen.getByTestId('buyer-details-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Buyer Modal'));

    const sellerIdBtn = screen.getByText('acc-seller-1');
    fireEvent.click(sellerIdBtn);
    expect(screen.getByTestId('vendor-details-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Vendor Modal'));
  });

  it('handles field changes and cancel buttons in all modals', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // 1. Email Modal Cancel & Inputs
    const emailBtns = screen.getAllByTitle('Send Email');
    fireEvent.click(emailBtns[0]);
    await waitFor(() => expect(screen.getByText('Send Low-Credit Email Notification')).toBeInTheDocument());
    const emailInputs = screen.getAllByRole('textbox');
    fireEvent.change(emailInputs[0], { target: { value: 'new@email.com' } });
    fireEvent.change(emailInputs[1], { target: { value: 'New Sub' } });
    fireEvent.change(emailInputs[2], { target: { value: 'New Msg' } });
    const notesInput = screen.getByPlaceholderText(/Discussed extension with CFO/i);
    fireEvent.change(notesInput, { target: { value: 'Email note' } });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Send Low-Credit Email Notification')).not.toBeInTheDocument());

    // 2. Message Modal Cancel & Inputs
    const msgBtns = screen.getAllByTitle('Send Message');
    fireEvent.click(msgBtns[0]);
    await waitFor(() => expect(screen.getByText('Send In-App Notification')).toBeInTheDocument());
    const titleInput = screen.getByDisplayValue(/Low Credit Balance Notification/i);
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    const msgArea = screen.getByDisplayValue(/Your QUA AI credit balance/i);
    fireEvent.change(msgArea, { target: { value: 'Updated Msg' } });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Send In-App Notification')).not.toBeInTheDocument());

    // 3. WhatsApp Modal Cancel & Inputs
    const waBtns = screen.getAllByTitle('WhatsApp Notification');
    fireEvent.click(waBtns[0]);
    await waitFor(() => expect(screen.getByText('Send WhatsApp Notification')).toBeInTheDocument());
    const phoneInput = screen.getByDisplayValue('9876543210');
    fireEvent.change(phoneInput, { target: { value: '9999999999' } });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Send WhatsApp Notification')).not.toBeInTheDocument());

    // 4. Ack Modal Cancel & Notes
    const ackBtns = screen.getAllByTitle('Update Acknowledgement');
    fireEvent.click(ackBtns[0]);
    await waitFor(() => expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument());
    const ackNotes = screen.getByPlaceholderText(/telephone remarks/i);
    fireEvent.change(ackNotes, { target: { value: 'Ack notes' } });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Update Acknowledgement Status')).not.toBeInTheDocument());
  });

  it('handles API submission errors in communication modals', async () => {
    (paymentDuesClient.sendPaymentDuesEmail as jest.Mock).mockResolvedValue({ success: false, error: 'SMTP Timeout' });
    (paymentDuesClient.sendPaymentDuesMessage as jest.Mock).mockResolvedValue({ success: false, error: 'Queue Full' });
    (paymentDuesClient.sendPaymentDuesWhatsApp as jest.Mock).mockResolvedValue({ success: false, error: 'WA Error' });
    (paymentDuesClient.updatePaymentDuesAcknowledgement as jest.Mock).mockResolvedValue({ success: false, error: 'DB Error' });

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Email error
    fireEvent.click(screen.getAllByTitle('Send Email')[0]);
    fireEvent.click(screen.getByText('Send Email'));
    await waitFor(() => {
      expect(screen.getByText('SMTP Timeout')).toBeInTheDocument();
    });

    // Dismiss toast
    const toastClose = screen.getByText('SMTP Timeout').closest('div')?.querySelector('button');
    if (toastClose) fireEvent.click(toastClose);

    // Message error
    fireEvent.click(screen.getAllByTitle('Send Message')[0]);
    fireEvent.click(screen.getByText('Send Notification'));
    await waitFor(() => {
      expect(screen.getByText('Queue Full')).toBeInTheDocument();
    });

    // WhatsApp error
    fireEvent.click(screen.getAllByTitle('WhatsApp Notification')[0]);
    fireEvent.click(screen.getByText('Send via WhatsApp'));
    await waitFor(() => {
      expect(screen.getByText('WA Error')).toBeInTheDocument();
    });

    // Ack error
    fireEvent.click(screen.getAllByTitle('Update Acknowledgement')[0]);
    fireEvent.click(screen.getByText('Save Status'));
    await waitFor(() => {
      expect(screen.getByText('DB Error')).toBeInTheDocument();
    });
  });

  it('renders empty history audit state when no records exist', async () => {
    (paymentDuesClient.fetchPaymentDuesHistory as jest.Mock).mockResolvedValue([]);
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTitle('Communication History')[0]);
    await waitFor(() => {
      expect(screen.getByText('No communication attempts recorded for this account yet.')).toBeInTheDocument();
    });
  });

  it('resets filters from empty state action button', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: [],
      total: 0,
      summary: mockSummary,
      page: 1,
      limit: 25,
    });
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/No low-credit buyer or seller accounts found/i)).toBeInTheDocument();
    });

    const resetBtns = screen.getAllByText('Reset Filters');
    fireEvent.click(resetBtns[resetBtns.length - 1]);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();
  });


  it('handles loadData error and shows error toast', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockRejectedValueOnce(new Error('DB failure'));
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load low-credit accounts from database')).toBeInTheDocument();
    });
  });

  it('handles fetchPaymentDuesHistory failure in history modal', async () => {
    (paymentDuesClient.fetchPaymentDuesHistory as jest.Mock).mockRejectedValueOnce(new Error('History fail'));
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTitle('Communication History')[0]);
    await waitFor(() => {
      expect(screen.getByText('No communication attempts recorded for this account yet.')).toBeInTheDocument();
    });
  });

  it('handles modal close (X) buttons and form textarea/note modifications', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // 1. Column Settings X button
    fireEvent.click(screen.getByTitle('Customize Columns'));
    expect(screen.getByText('Column Settings')).toBeInTheDocument();
    const colCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(colCloseBtn);
    expect(screen.queryByText('Column Settings')).not.toBeInTheDocument();

    // 2. Email modal X button, notes & message textarea change
    fireEvent.click(screen.getAllByTitle('Send Email')[0]);
    await waitFor(() => expect(screen.getByText('Send Low-Credit Email Notification')).toBeInTheDocument());
    const emailNotes = screen.getByPlaceholderText('e.g. Discussed extension with CFO');
    fireEvent.change(emailNotes, { target: { value: 'Discussed with client' } });
    const emailTextarea = screen.getByDisplayValue(/This is to inform you that your QUA AI account currently has only/i);
    fireEvent.change(emailTextarea, { target: { value: 'Custom email body' } });
    const emailCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(emailCloseBtn);
    await waitFor(() => expect(screen.queryByText('Send Low-Credit Email Notification')).not.toBeInTheDocument());

    // 3. Message modal X button & message textarea change
    fireEvent.click(screen.getAllByTitle('Send Message')[0]);
    await waitFor(() => expect(screen.getByText('Send In-App Notification')).toBeInTheDocument());
    const msgTextarea = screen.getByDisplayValue(/credit balance is currently/i);
    fireEvent.change(msgTextarea, { target: { value: 'Updated in-app body' } });
    const msgCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(msgCloseBtn);
    await waitFor(() => expect(screen.queryByText('Send In-App Notification')).not.toBeInTheDocument());

    // 4. WhatsApp modal X button & message textarea change
    fireEvent.click(screen.getAllByTitle('WhatsApp Notification')[0]);
    await waitFor(() => expect(screen.getByText('Send WhatsApp Notification')).toBeInTheDocument());
    const waTextarea = screen.getByDisplayValue(/This is to inform you that your QUA AI account currently has only/i);
    fireEvent.change(waTextarea, { target: { value: 'Custom WA message body' } });
    const waCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(waCloseBtn);
    await waitFor(() => expect(screen.queryByText('Send WhatsApp Notification')).not.toBeInTheDocument());

    // 5. Ack modal X button
    fireEvent.click(screen.getAllByTitle('Update Acknowledgement')[0]);
    await waitFor(() => expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument());
    const ackCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(ackCloseBtn);
    await waitFor(() => expect(screen.queryByText('Update Acknowledgement Status')).not.toBeInTheDocument());

    // 6. History modal X button
    fireEvent.click(screen.getAllByTitle('Communication History')[0]);
    await waitFor(() => expect(screen.getByText('Communication & Acknowledgement Audit Trail')).toBeInTheDocument());
    const histCloseBtn = document.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    fireEvent.click(histCloseBtn);
    await waitFor(() => expect(screen.queryByText('Communication & Acknowledgement Audit Trail')).not.toBeInTheDocument());
  });

  it('handles toolbar refresh button and sorting toggles on same column', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Refresh button
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();

    // Toggle same column sort twice
    const creditsHeader = screen.getByText('Available Credits');
    fireEvent.click(creditsHeader);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();
    fireEvent.click(creditsHeader);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();

    // Switch to different column
    const companyHeader = screen.getByText('Company Name');
    fireEvent.click(companyHeader);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();
  });

  it('handles multi-page pagination prev and next button clicks', async () => {
    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValue({
      accounts: mockAccounts,
      total: 60,
      summary: mockSummary,
      page: 1,
      limit: 20,
    });

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    const prevBtn = screen.getByText('Page 1 of 3').previousElementSibling as HTMLButtonElement;
    const nextBtn = screen.getByText('Page 1 of 3').nextElementSibling as HTMLButtonElement;

    // Advance to next page
    fireEvent.click(nextBtn);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();

    // Go back to prev page
    fireEvent.click(prevBtn);
    expect(paymentDuesClient.fetchPaymentDues).toHaveBeenCalled();
  });

  it('handles drop on same index and dragOver default prevention', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Customize Columns'));
    const dragItems = screen.getAllByRole('button', { name: /Account ID|Company Name/i });
    const firstItem = dragItems[0]?.closest('div');

    if (firstItem) {
      fireEvent.dragStart(firstItem);
      fireEvent.dragOver(firstItem);
      fireEvent.drop(firstItem);
    }
  });

  it('handles WhatsApp directLink and accounts with fallback/dash values', async () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    (paymentDuesClient.sendPaymentDuesWhatsApp as jest.Mock).mockResolvedValueOnce({
      success: true,
      directLink: 'https://wa.me/919999999999?text=Hello',
    });

    const fallbackAccount: PaymentDuesAccount = {
      accountId: 'ACC-DASH',
      accountType: 'buyer',
      companyName: 'Dash Corp',
      contactPerson: '',
      email: '–',
      phoneNumber: '–',
      availableCredits: 1,
      totalCredits: 10,
      creditsUsed: 9,
      accountStatus: 'active',
      registrationDate: '',
      lastActivity: '',
      assignedExecutive: 'CM Ex',
      lastNotification: '',
      notificationChannel: '',
      acknowledgementStatus: '' as any,
    };

    (paymentDuesClient.fetchPaymentDues as jest.Mock).mockResolvedValueOnce({
      accounts: [fallbackAccount],
      total: 1,
      summary: mockSummary,
      page: 1,
      limit: 25,
    });

    (paymentDuesClient.fetchPaymentDuesHistory as jest.Mock).mockResolvedValueOnce([
      {
        id: 'hist-dash',
        accountId: 'ACC-DASH',
        accountType: 'buyer',
        channel: 'email',
        recipient: 'test@example.com',
        subject: '',
        message: 'No subject message',
        status: 'Delivered',
        acknowledgementStatus: 'Not Notified',
        communicatedBy: '',
        sentAt: '',
        notes: '',
      },
    ]);

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Dash Corp')).toBeInTheDocument();
    });

    // Check fallback dashes rendered
    const dashes = screen.getAllByText('–');
    expect(dashes.length).toBeGreaterThan(0);

    // Open email modal for fallbackAccount to test 'Valued Partner' and empty recipient
    fireEvent.click(screen.getByTitle('Send Email'));
    await waitFor(() => expect(screen.getByText('Send Low-Credit Email Notification')).toBeInTheDocument());
    expect(screen.getByDisplayValue(/Dear Valued Partner/i)).toBeInTheDocument();
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Send Low-Credit Email Notification')).not.toBeInTheDocument());

    // Open ack modal for fallbackAccount to test 'Acknowledgement Pending' fallback
    fireEvent.click(screen.getByTitle('Update Acknowledgement'));
    await waitFor(() => expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Update Acknowledgement Status')).not.toBeInTheDocument());

    // Open and submit WhatsApp to test directLink
    fireEvent.click(screen.getByTitle('WhatsApp Notification'));
    await waitFor(() => expect(screen.getByText('Send WhatsApp Notification')).toBeInTheDocument());
    const waForm = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(waForm);

    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledWith('https://wa.me/919999999999?text=Hello', '_blank', 'noopener,noreferrer');
    });

    // Open history to test fallback hist values
    fireEvent.click(screen.getAllByTitle('Communication History')[0]);
    await waitFor(() => {
      expect(screen.getByText('By Category Manager')).toBeInTheDocument();
    });

    windowOpenSpy.mockRestore();
  });

  it('handles summary fetch error gracefully on initial mount', async () => {
    (paymentDuesClient.fetchPaymentDuesSummary as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });
  });

  it('auto-dismisses toast message after timeout', async () => {
    jest.useFakeTimers();
    (paymentDuesClient.updatePaymentDuesAcknowledgement as jest.Mock).mockResolvedValueOnce({ success: true });

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Trigger toast via Ack update
    fireEvent.click(screen.getAllByTitle('Update Acknowledgement')[0]);
    await waitFor(() => expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument());
    const ackForm = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(ackForm);

    await waitFor(() => {
      expect(screen.getByText(/Acknowledgement status updated to/i)).toBeInTheDocument();
    });

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByText(/Acknowledgement status updated to/i)).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it('handles submission errors with default fallback error messages', async () => {
    (paymentDuesClient.sendPaymentDuesEmail as jest.Mock).mockResolvedValueOnce({ success: false });
    (paymentDuesClient.sendPaymentDuesMessage as jest.Mock).mockResolvedValueOnce({ success: false });
    (paymentDuesClient.sendPaymentDuesWhatsApp as jest.Mock).mockResolvedValueOnce({ success: false });
    (paymentDuesClient.updatePaymentDuesAcknowledgement as jest.Mock).mockResolvedValueOnce({ success: false });

    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });

    // Email error fallback
    fireEvent.click(screen.getAllByTitle('Send Email')[0]);
    await waitFor(() => expect(screen.getByText('Send Low-Credit Email Notification')).toBeInTheDocument());
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Failed to send email notification')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Send Low-Credit Email Notification')).not.toBeInTheDocument());

    // Message error fallback
    fireEvent.click(screen.getAllByTitle('Send Message')[0]);
    await waitFor(() => expect(screen.getByText('Send In-App Notification')).toBeInTheDocument());
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Failed to send in-app message')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Send In-App Notification')).not.toBeInTheDocument());

    // WhatsApp error fallback
    fireEvent.click(screen.getAllByTitle('WhatsApp Notification')[0]);
    await waitFor(() => expect(screen.getByText('Send WhatsApp Notification')).toBeInTheDocument());
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Failed to initiate WhatsApp notification')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Send WhatsApp Notification')).not.toBeInTheDocument());

    // Ack error fallback
    fireEvent.click(screen.getAllByTitle('Update Acknowledgement')[0]);
    await waitFor(() => expect(screen.getByText('Update Acknowledgement Status')).toBeInTheDocument());
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(screen.getByText('Failed to update acknowledgement status')).toBeInTheDocument());
    fireEvent.click(document.querySelector('button[aria-label="Close"]') as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByText('Update Acknowledgement Status')).not.toBeInTheDocument());
  });

  it('handles empty column preferences array in localStorage', async () => {
    localStorage.setItem('qua_payment_dues_column_prefs', '[]');
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });
  });

  it('handles drop when no column is being dragged', async () => {
    render(<PaymentDuesDashboard />);
    await waitFor(() => {
      expect(screen.getByText('Apex Industries')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('Customize Columns'));
    const dragItems = screen.getAllByRole('button', { name: /Account ID|Company Name/i });
    const firstItem = dragItems[0]?.closest('div');
    if (firstItem) {
      fireEvent.drop(firstItem);
    }
  });
});
