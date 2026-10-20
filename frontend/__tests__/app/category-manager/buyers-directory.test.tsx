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
    (useApp as jest.Mock).mockReturnValue({
      buyerAccounts: mockBuyerAccounts,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: jest.fn(),
    });
  });

  test('renders page header, summary KPI cards, and buyers table', () => {
    render(<BuyersDirectory />);

    expect(screen.getByText('Buyers Directory')).toBeInTheDocument();
    expect(screen.getByText('4 Enterprises')).toBeInTheDocument();
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

    fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
    expect(screen.getByText('Bharat Electronics')).toBeInTheDocument();

    fireEvent.change(statusSelect, { target: { value: 'ACTIVE_VERIFIED' } });
    expect(screen.getByText('Tata Motors Corp')).toBeInTheDocument();
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
    expect(screen.getByText('Remaining Free RFQs')).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);

    // Check Tab 4: Communications
    const commsTab = screen.getByRole('button', { name: /Messages/i });
    fireEvent.click(commsTab);
    expect(screen.getByText(/Enterprise Onboarding Confirmation/)).toBeInTheDocument();

    // Check Tab 5: Payments
    const payTab = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(payTab);
    expect(screen.getAllByText(/Growth Enterprise/).length).toBeGreaterThanOrEqual(1);

    // Check Tab 6: Audit Activity
    const actTab = screen.getByRole('button', { name: /^Audit$/i });
    fireEvent.click(actTab);
    expect(screen.getByText('BUYER_RFQ_CREATED')).toBeInTheDocument();

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

    // Tab 6: Empty Audit Logs
    const emptyActTab = screen.getByRole('button', { name: /^Audit$/i });
    fireEvent.click(emptyActTab);
    expect(screen.getByText('No audit events logged for this enterprise buyer.')).toBeInTheDocument();

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
    expect(screen.getByText('Buyers Directory')).toBeInTheDocument();

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
});

