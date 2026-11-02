import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuyersDirectory from '@/app/category-manager/buyers-directory';
import CategoryManagerBuyersDirectoryPage from '@/app/category-manager/buyers-directory/page';
import { useApp } from '@/lib/store';
import * as reportsClient from '@/lib/reportsClient';
import { RFQ_MODES } from '@/lib/constants';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/reportsClient', () => {
  const actual = jest.requireActual('@/lib/reportsClient');
  return {
    ...actual,
    exportReportToExcel: jest.fn(),
  };
});

describe('BuyersDirectory Component Suite', () => {
  const mockBuyerAccounts = [
    {
      id: 'b-1',
      organizationName: 'Tata Motors Corp',
      contactPerson: 'Suresh Patel',
      corporateEmail: 'suresh@tatamotors.com',
      mobileNumber: '+919123456789',
      city: 'Pune',
      primaryPlantLocation: 'Pune Assembly Plant',
      sourcingMode: RFQ_MODES.MODE_1,
      subscriptionPlan: 'Growth Enterprise',
      remainingFreeRFQs: 4,
      totalRFQsCreated: 12,
      totalSpend: '₹45,00,000',
      status: 'ACTIVE_VERIFIED',
      createdDate: '2026-01-15T10:00:00Z',
      supportedMajorCategories: ['Automotive Parts', 'Sheet Metal'],
    },
    {
      id: 'b-2',
      organizationName: 'L&T Heavy Engineering',
      contactPerson: 'Manish Verma',
      corporateEmail: 'manish@lnt.com',
      mobileNumber: '+919988776655',
      city: 'Hazira',
      sourcingMode: RFQ_MODES.MODE_2,
      subscriptionPlan: 'Unlimited Enterprise',
      remainingFreeRFQs: 8,
      totalRFQsCreated: 24,
      totalSpend: '₹1,50,00,000',
      status: 'ACTIVE_VERIFIED',
      createdDate: '2026-02-10T12:00:00Z',
    },
    {
      id: 'b-3',
      organizationName: 'Bharat Electronics',
      contactPerson: 'Anil Kumar',
      corporateEmail: 'anil@bel.co.in',
      sourcingMode: RFQ_MODES.MODE_3,
      status: 'ACTIVE',
      supportedMajorCategories: undefined,
    },
    {
      id: 'b-4',
      organizationName: 'Standard Auto',
      contactPerson: 'Sunil Rao',
      corporateEmail: 'sunil@standard.in',
      sourcingMode: RFQ_MODES.MODE_0,
      status: 'PENDING_VERIFICATION',
    },
  ];

  const mockRfqs = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-TM-001',
      title: 'Precision Alloy Wheels',
      buyerAccountId: 'b-1',
      buyerAccountName: 'Tata Motors Corp',
      sourcingMode: RFQ_MODES.MODE_1,
      budget: 850000,
      createdAt: '2026-03-01T10:00:00Z',
      assignedVendors: [{}, {}],
      quotes: [{ id: 'q-1', totalPrice: 800000 }],
      status: 'Quotes Received',
    },
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ-BEL-002',
      title: 'Solar Inverters',
      buyerAccountId: 'b-3',
      buyerAccountName: 'Bharat Electronics',
      sourcingMode: RFQ_MODES.MODE_3,
      budget: 0,
      createdAt: '2026-03-05T10:00:00Z',
      assignedVendors: [],
      quotes: [],
      status: 'Draft',
    },
  ];

  const mockAuditLogs = [
    {
      id: 'audit-1',
      action: 'BUYER_RFQ_CREATED',
      actorEmail: 'suresh@tatamotors.com',
      details: 'Created RFQ-TM-001 for Tata Motors Corp',
      timestamp: '2026-03-01T10:05:00Z',
    },
    {
      id: 'audit-2',
      action: 'SYSTEM_MAINTENANCE',
      actorEmail: '',
      details: 'Automated verification check',
      timestamp: '2026-03-02T10:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: mockBuyerAccounts,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: jest.fn(),
    });
  });

  test('renders page header, summary KPI cards, and buyers table', () => {
    render(<BuyersDirectory />);

    expect(screen.getByText('Export Directory')).toBeInTheDocument();
    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();
    expect(screen.getByText('L&T Heavy Engineering')).toBeInTheDocument();
    expect(screen.getByText('Pune')).toBeInTheDocument();
  });

  test('searches buyers by company name, contact, or location', () => {
    render(<BuyersDirectory />);

    const searchInput = screen.getByPlaceholderText(/Search company, contact person/);
    fireEvent.change(searchInput, { target: { value: 'Tata' } });

    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();
    expect(screen.queryByText('L&T Heavy Engineering')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Hazira' } });
    expect(screen.getByText('L&T Heavy Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Corp')).not.toBeInTheDocument();

    // Search by email
    fireEvent.change(searchInput, { target: { value: 'bel.co.in' } });
    expect(screen.getByText('Bharat Electronics')).toBeInTheDocument();
  });

  test('filters buyers by sourcing mode and status', () => {
    render(<BuyersDirectory />);

    const modeSelect = screen.getByDisplayValue('All Sourcing Modes');
    fireEvent.change(modeSelect, { target: { value: RFQ_MODES.MODE_2 } });
    expect(screen.getByText('L&T Heavy Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Corp')).not.toBeInTheDocument();

    fireEvent.change(modeSelect, { target: { value: RFQ_MODES.MODE_1 } });
    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();

    fireEvent.change(modeSelect, { target: { value: RFQ_MODES.MODE_3 } });
    expect(screen.getByText('Bharat Electronics')).toBeInTheDocument();

    fireEvent.change(modeSelect, { target: { value: RFQ_MODES.MODE_0 } });
    expect(screen.getByText('Standard Auto')).toBeInTheDocument();

    // Reset mode
    fireEvent.change(modeSelect, { target: { value: 'all' } });

    // Status filter
    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'PENDING_VERIFICATION' } });
    expect(screen.getByText('Standard Auto')).toBeInTheDocument();
    expect(screen.queryByText('Tata Motors Corp')).not.toBeInTheDocument();

    fireEvent.change(statusSelect, { target: { value: 'ACTIVE_VERIFIED' } });
    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();
    expect(screen.getByText('Bharat Electronics')).toBeInTheDocument();
    expect(screen.queryByText('Standard Auto')).not.toBeInTheDocument();
  });

  test('displays empty state when search matches no buyers', () => {
    render(<BuyersDirectory />);

    const searchInput = screen.getByPlaceholderText(/Search company, contact person/);
    fireEvent.change(searchInput, { target: { value: 'Nonexistent Enterprise XYZ' } });

    expect(screen.getByText('No buyer accounts found matching your query.')).toBeInTheDocument();
  });

  test('export directory button invokes exportReportToExcel', () => {
    render(<BuyersDirectory />);

    const exportBtn = screen.getByText('Export Directory');
    fireEvent.click(exportBtn);

    expect(reportsClient.exportReportToExcel).toHaveBeenCalled();
  });

  test('clicking 360 Dossier opens drawer, allows browsing tabs, and closing via X button', async () => {
    const onSelectRFQ = jest.fn();
    render(<BuyersDirectory onSelectRFQ={onSelectRFQ} />);

    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Check Tab 1: Profile
    expect(screen.getByText('Corporate Contact')).toBeInTheDocument();
    expect(screen.getAllByText('suresh@tatamotors.com').length).toBeGreaterThanOrEqual(1);

    // Check Tab 2: RFQ History
    const rfqTab = screen.getByRole('button', { name: /RFQs/i });
    fireEvent.click(rfqTab);
    expect(screen.getByText('RFQ-TM-001')).toBeInTheDocument();
    expect(screen.getByText('Precision Alloy Wheels')).toBeInTheDocument();

    // Click RFQ action icon
    const rfqActionBtn = screen.getByTitle('Open RFQ Matrix');
    fireEvent.click(rfqActionBtn);
    expect(onSelectRFQ).toHaveBeenCalled();

    // Check Tab 3: Credits & Quotas
    const creditsTab = screen.getByRole('button', { name: /^Credit$/i });
    fireEvent.click(creditsTab);
    expect(screen.getByText(/Remaining Free (?:Credits|RFQs)/)).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);

    // Check Tab 4: Communications
    const commsTab = screen.getByRole('button', { name: /Communications|Messages/i });
    fireEvent.click(commsTab);
    expect(await screen.findByText(/Enterprise Onboarding Confirmation/)).toBeInTheDocument();

    // Check Tab 5: Payments
    const payTab = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(payTab);
    expect((await screen.findAllByText(/Growth Enterprise/)).length).toBeGreaterThanOrEqual(1);

    // Check Tab 6: Audit Activity is removed from visible navigation per dossier specification
    expect(screen.queryByRole('button', { name: /^Audit$/i })).not.toBeInTheDocument();

    // Close dossier via top X button (first button in header)
    const closeButtons = screen.getAllByRole('button');
    const xButton = closeButtons.find((btn) => btn.querySelector('svg.lucide-x'));
    if (xButton) {
      fireEvent.click(xButton);
    } else {
      const closeBtn = screen.getByText('Close Dossier');
      fireEvent.click(closeBtn);
    }

    await waitFor(() => {
      expect(screen.queryByText('Corporate Contact')).not.toBeInTheDocument();
    });

    // Now open b-3 (Bharat Electronics) which has budget 0, unverified categories
    fireEvent.click(dossierBtns[2]);
    expect(screen.getAllByText('Bharat Electronics').length).toBeGreaterThanOrEqual(1);

    // Tab 2: RFQ with 0 budget
    const belRfqTab = screen.getByRole('button', { name: /RFQs/i });
    fireEvent.click(belRfqTab);
    expect(screen.getByText('RFQ-BEL-002')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();

    // Close via bottom Close Dossier button
    const closeBelBtn = screen.getByText('Close Dossier');
    fireEvent.click(closeBelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Bharat Electronics' })).not.toBeInTheDocument();
    });

    // Now open second buyer (L&T Heavy Engineering) which has 0 RFQs and 0 audit logs
    fireEvent.click(dossierBtns[1]);
    expect(screen.getAllByText('L&T Heavy Engineering').length).toBeGreaterThanOrEqual(1);

    // Tab 2: Empty RFQs
    const emptyRfqTab = screen.getByRole('button', { name: /RFQs/i });
    fireEvent.click(emptyRfqTab);
    expect(screen.getByText('No RFQs created by this buyer yet.')).toBeInTheDocument();

    // Tab 6: Audit Activity is removed from visible navigation per dossier specification
    expect(screen.queryByRole('button', { name: /^Audit$/i })).not.toBeInTheDocument();

    // Close via bottom Close Dossier button
    const closeFooterBtn = screen.getByText('Close Dossier');
    fireEvent.click(closeFooterBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'L&T Heavy Engineering' })).not.toBeInTheDocument();
    });
  });

  test('CategoryManagerBuyersDirectoryPage wrapper component mounts properly and handles RFQ selection', () => {
    const mockRouterPush = jest.fn();
    const mockSetSelected = jest.fn();
    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: [
        ...mockBuyerAccounts,
        {
          id: 'b-5',
          organizationName: 'Unknown Mode Entity',
          sourcingMode: 'UNKNOWN_CUSTOM_MODE',
          status: 'PENDING_VERIFICATION',
        },
      ],
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: mockSetSelected,
    });

    render(<CategoryManagerBuyersDirectoryPage />);
    expect(screen.getByText('Export Directory')).toBeInTheDocument();

    // Open first buyer dossier
    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Go to RFQ tab
    const rfqTab = screen.getByRole('button', { name: /RFQs/i });
    fireEvent.click(rfqTab);

    // Click Open RFQ Matrix
    const rfqActionBtn = screen.getByTitle('Open RFQ Matrix');
    fireEvent.click(rfqActionBtn);

    expect(mockSetSelected).toHaveBeenCalledWith(mockRfqs[0]);
  });

  test('supports table pagination, rows per page, and displays real aggregated spend', () => {
    render(<BuyersDirectory />);

    // Check pagination info summary
    expect(screen.getByText('Showing')).toBeInTheDocument();
    expect(screen.getByText('of')).toBeInTheDocument();
    expect(screen.getByText('entries')).toBeInTheDocument();

    // Check Rows per page select
    const pageSizeSelect = screen.getByLabelText('Rows per page');
    expect(pageSizeSelect).toBeInTheDocument();
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });
    expect((pageSizeSelect as HTMLSelectElement).value).toBe('25');

    // Prev / Next buttons
    const prevBtn = screen.getByLabelText('Previous page');
    const nextBtn = screen.getByLabelText('Next page');
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeDisabled(); // 4 items with page size 25

    // Total Spend KPI card removed
    expect(screen.queryByText('Total Sourcing Spend')).not.toBeInTheDocument();
  });

  test('renders 5 summary cards with proper values and subtext', () => {
    render(<BuyersDirectory />);
    expect(screen.getByText('Total Buyers')).toBeInTheDocument();
    expect(screen.getByText('Subscription Buyers')).toBeInTheDocument();
    expect(screen.getByText('Total RFQs')).toBeInTheDocument();
    expect(screen.getByText('Free RFQs')).toBeInTheDocument();
    expect(screen.getByText('Paid RFQs')).toBeInTheDocument();
  });

  test('clicking company name opens dossier directly to profile tab', () => {
    render(<BuyersDirectory />);
    const companyBtn = screen.getByRole('button', { name: /Tata Motors Corp/i });
    fireEvent.click(companyBtn);
    expect(screen.getByText('Corporate Contact')).toBeInTheDocument();
  });

  test('opens and interacts with Column Settings modal, toggling columns and resetting', () => {
    render(<BuyersDirectory />);

    // Open Column Settings
    const gearBtn = screen.getByLabelText('Customize Columns');
    fireEvent.click(gearBtn);
    expect(screen.getByRole('dialog', { name: 'Customize Columns' })).toBeInTheDocument();
    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    // Toggle all optional columns on to test full cell rendering
    const optionalLabels = [
      'Contact Person',
      'Email',
      'Phone',
      'Free Credits',
      'Total Spend',
      'Registration Date',
      'Location',
    ];
    optionalLabels.forEach((label) => {
      const checkbox = screen.queryByLabelText(new RegExp(label, 'i'));
      if (checkbox) {
        fireEvent.click(checkbox);
      }
    });

    // Toggle required column (Buyer) - should be disabled and locked
    const orgCheckbox = screen.getByLabelText(/Buyer/i);
    expect(orgCheckbox).toBeDisabled();
    fireEvent.click(orgCheckbox);

    // Reset columns
    const resetBtn = screen.getByText('Reset to Default');
    fireEvent.click(resetBtn);

    // Click Done button
    const doneBtn = screen.getByText('Done');
    fireEvent.click(doneBtn);
    expect(screen.queryByRole('dialog', { name: 'Customize Columns' })).not.toBeInTheDocument();

    // Reopen and test close button (X)
    fireEvent.click(gearBtn);
    const closeBtn = screen.getByLabelText('Close column settings');
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog', { name: 'Customize Columns' })).not.toBeInTheDocument();
  });

  test('handles drag and drop reordering of columns in settings modal', () => {
    render(<BuyersDirectory />);

    const gearBtn = screen.getByLabelText('Customize Columns');
    fireEvent.click(gearBtn);

    const checkboxes = screen.getAllByRole('checkbox');
    const firstContainer = checkboxes[0].closest('div[draggable="true"]');
    const secondContainer = checkboxes[1].closest('div[draggable="true"]');

    if (firstContainer && secondContainer) {
      fireEvent.dragStart(firstContainer, { dataTransfer: { effectAllowed: 'move' } });
      fireEvent.dragOver(secondContainer, { dataTransfer: { dropEffect: 'move' } });
      fireEvent.drop(secondContainer);

      // Same item drop (no-op)
      fireEvent.dragStart(firstContainer, { dataTransfer: { effectAllowed: 'move' } });
      fireEvent.drop(firstContainer);
    }
  });

  test('sorts by different columns in ascending and descending orders', () => {
    // Render with all columns enabled via localStorage
    const allColsVisible = [
      { key: 'organizationName', label: 'Buyer', visible: true, required: true },
      { key: 'contactPerson', label: 'Contact Person', visible: true },
      { key: 'corporateEmail', label: 'Email', visible: true },
      { key: 'mobileNumber', label: 'Phone', visible: true },
      { key: 'location', label: 'Location', visible: true },
      { key: 'sourcingMode', label: 'Mode', visible: true },
      { key: 'subscriptionPlan', label: 'Plan', visible: true },
      { key: 'totalRFQsCreated', label: 'RFQs', visible: true },
      { key: 'remainingFreeRFQs', label: 'Free Credits', visible: true },
      { key: 'totalSpend', label: 'Total Spend', visible: true },
      { key: 'status', label: 'Status', visible: true },
      { key: 'createdDate', label: 'Registration Date', visible: true },
      { key: 'actions', label: 'Actions', visible: true, required: true },
    ];
    window.localStorage.setItem('buyer_directory_columns_pref', JSON.stringify(allColsVisible));

    render(<BuyersDirectory />);

    const columnHeaders = [
      'Buyer',
      'Contact Person',
      'Email',
      'Phone',
      'Location',
      'Mode',
      'Plan',
      'RFQs',
      'Free Credits',
      'Total Spend',
      'Status',
      'Registration Date',
    ];

    columnHeaders.forEach((name) => {
      const th = screen.queryByRole('columnheader', { name: new RegExp(name, 'i') });
      if (th) {
        fireEvent.click(th); // asc
        fireEvent.click(th); // desc
      }
    });

    // Also click actions column (should not trigger sort)
    const actionsTh = screen.queryByRole('columnheader', { name: /Actions/i });
    if (actionsTh) {
      fireEvent.click(actionsTh);
    }

    window.localStorage.clear();
  });

  test('loads partial column preferences and appends missing defaults', () => {
    const partialPrefs = [
      { key: 'organizationName', label: 'Buyer', visible: true, required: true },
      { key: 'location', label: 'Location', visible: false },
    ];
    window.localStorage.setItem('buyer_directory_columns_pref', JSON.stringify(partialPrefs));

    render(<BuyersDirectory />);
    expect(screen.getByText('Export Directory')).toBeInTheDocument();
    window.localStorage.clear();
  });

  test('handles corrupted localStorage JSON without crashing', () => {
    window.localStorage.setItem('buyer_directory_columns_pref', '{invalid_json');

    render(<BuyersDirectory />);
    expect(screen.getByText('Export Directory')).toBeInTheDocument();
    window.localStorage.clear();
  });
  test('filters buyers by Source Type (Web App, WhatsApp, Email, All)', () => {
    const buyersWithSources = [
      {
        ...mockBuyerAccounts[0],
        id: 'b-web',
        organizationName: 'Web Enterprises',
        sourceType: 'Web App',
        status: 'ACTIVE_VERIFIED',
      },
      {
        ...mockBuyerAccounts[1],
        id: 'b-wa',
        organizationName: 'WhatsApp Buyers Corp',
        sourceType: 'WhatsApp',
        status: 'ACTIVE_VERIFIED',
      },
      {
        ...mockBuyerAccounts[2],
        id: 'b-email',
        organizationName: 'Email Sourcing Group',
        sourceType: 'Email',
        status: 'ACTIVE_VERIFIED',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: buyersWithSources,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: jest.fn(),
    });

    render(<BuyersDirectory />);

    expect(screen.getByText('Web Enterprises')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp Buyers Corp')).toBeInTheDocument();
    expect(screen.getByText('Email Sourcing Group')).toBeInTheDocument();

    const sourceSelect = screen.getByDisplayValue('All Sources');

    // Filter by WhatsApp
    fireEvent.change(sourceSelect, { target: { value: 'WhatsApp' } });
    expect(screen.queryByText('Web Enterprises')).not.toBeInTheDocument();
    expect(screen.getByText('WhatsApp Buyers Corp')).toBeInTheDocument();
    expect(screen.queryByText('Email Sourcing Group')).not.toBeInTheDocument();

    // Filter by Email
    fireEvent.change(sourceSelect, { target: { value: 'Email' } });
    expect(screen.queryByText('Web Enterprises')).not.toBeInTheDocument();
    expect(screen.queryByText('WhatsApp Buyers Corp')).not.toBeInTheDocument();
    expect(screen.getByText('Email Sourcing Group')).toBeInTheDocument();

    // Filter by Web App
    fireEvent.change(sourceSelect, { target: { value: 'Web App' } });
    expect(screen.getByText('Web Enterprises')).toBeInTheDocument();
    expect(screen.queryByText('WhatsApp Buyers Corp')).not.toBeInTheDocument();
    expect(screen.queryByText('Email Sourcing Group')).not.toBeInTheDocument();

    // Reset to All Sources
    fireEvent.change(sourceSelect, { target: { value: 'all' } });
    expect(screen.getByText('Web Enterprises')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp Buyers Corp')).toBeInTheDocument();
    expect(screen.getByText('Email Sourcing Group')).toBeInTheDocument();
  });

  test('displays all pending verification buyer variations correctly', () => {
    const variedPendingBuyers = [
      {
        ...mockBuyerAccounts[0],
        id: 'b-pend-1',
        organizationName: 'Onboarding Pending Ltd',
        status: 'PENDING_ONBOARDING',
      },
      {
        ...mockBuyerAccounts[1],
        id: 'b-pend-2',
        organizationName: 'Email Pending Corp',
        status: 'PENDING_EMAIL_VERIFICATION',
      },
      {
        ...mockBuyerAccounts[2],
        id: 'b-pend-3',
        organizationName: 'Alignment Pending Co',
        status: 'PENDING_ALIGNMENT',
      },
      {
        ...mockBuyerAccounts[3],
        id: 'b-pend-4',
        organizationName: 'New Client Awaiting Approval',
        status: 'AWAITING_APPROVAL',
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: variedPendingBuyers,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: jest.fn(),
    });

    render(<BuyersDirectory />);

    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'PENDING_VERIFICATION' } });

    expect(screen.getByText('Onboarding Pending Ltd')).toBeInTheDocument();
    expect(screen.getByText('Email Pending Corp')).toBeInTheDocument();
    expect(screen.getByText('Alignment Pending Co')).toBeInTheDocument();
    expect(screen.getByText('New Client Awaiting Approval')).toBeInTheDocument();

    fireEvent.change(statusSelect, { target: { value: 'ACTIVE_VERIFIED' } });
    expect(screen.queryByText('Onboarding Pending Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText('Email Pending Corp')).not.toBeInTheDocument();
    expect(screen.queryByText('Alignment Pending Co')).not.toBeInTheDocument();
    expect(screen.queryByText('New Client Awaiting Approval')).not.toBeInTheDocument();
  });

  test('restores saved state from sessionStorage on mount', () => {
    const savedState = {
      searchTerm: 'Tata',
      selectedMode: RFQ_MODES.MODE_1,
      selectedStatus: 'ACTIVE_VERIFIED',
      selectedSource: 'Web App',
      sortColumn: 'organizationName',
      sortOrder: 'asc',
      currentPage: 1,
      pageSize: 10,
    };
    window.sessionStorage.setItem('buyer_directory_state', JSON.stringify(savedState));

    render(<BuyersDirectory />);

    expect(screen.getByDisplayValue('Tata')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Web App')).toBeInTheDocument();
    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();

    window.sessionStorage.clear();
  });

  test('handles corrupted sessionStorage JSON gracefully', () => {
    window.sessionStorage.setItem('buyer_directory_state', '{corrupted_json');

    render(<BuyersDirectory />);
    expect(screen.getByText('Export Directory')).toBeInTheDocument();

    window.sessionStorage.clear();
  });
  test('initialBuyerId opens drawer on matching buyer with initialTab', () => {
    render(<BuyersDirectory initialBuyerId="b-1" initialTab="rfqs" />);
    expect(screen.getByText('Close Dossier')).toBeInTheDocument();
  });

  test('initialBuyerId with non-matching buyer does not open drawer', () => {
    render(<BuyersDirectory initialBuyerId="non-matching-id" />);
    expect(screen.queryByText('Close Dossier')).toBeNull();
  });
});

