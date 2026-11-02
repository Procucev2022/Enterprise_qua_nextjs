import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SellersDirectory from '@/app/category-manager/sellers-directory';
import CategoryManagerSellersDirectoryPage from '@/app/category-manager/sellers-directory/page';
import { useApp } from '@/lib/store';
import * as reportsClient from '@/lib/reportsClient';
import * as rfqClient from '@/lib/rfqClient';
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

jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    fetchAllVendors: jest.fn(),
  };
});

describe('SellersDirectory Component Suite', () => {
  const mockRemoteVendors = [
    {
      id: 'v-net-1',
      name: 'Apex Fasteners Ltd',
      contactPerson: 'Rajesh Sharma',
      email: 'rajesh@apexfasteners.com',
      phone: '+919876543210',
      location: 'Ahmedabad, Gujarat',
      source: 'procucev_network',
      majorCategory: 'Industrial Fasteners',
      minorCategories: ['High Tensile Bolts', 'Hex Nuts'],
      score: 92,
      rating: 4.8,
      status: 'ACTIVE_VERIFIED',
      subscriptionPlan: 'Preferred Partner',
      freeQuotationCredits: 20,
      rfqDownloadsUsed: 6,
      gstNumber: '24AAACA1111A1Z1',
      panNumber: 'AAACA1111A',
      lastLogin: '2026-03-02T11:00:00Z',
    },
  ];

  const mockBuyerVendors = [
    {
      id: 'v-buy-1',
      name: 'Precision Forgings Pvt Ltd',
      contactPerson: 'Sunil Rao',
      email: 'sunil@precisionforgings.in',
      phone: '+919871112233',
      location: 'Pune, Maharashtra',
      majorCategory: 'Forgings & Castings',
      minorCategories: ['Steel Forgings'],
      qualityScore: 86,
      rating: 4.3,
      gstNumber: '27AAACB2222B1Z2',
      panNumber: 'AAACB2222B',
    },
  ];

  const mockRfqs = [
    {
      id: 'rfq-v1',
      rfqNumber: 'RFQ-NET-001',
      title: 'M16 Galvanized Bolts',
      buyerAccountName: 'Tata Motors',
      sourcingMode: RFQ_MODES.MODE_1,
      createdAt: '2026-03-05T10:00:00Z',
      assignedVendors: [{ id: 'v-net-1', name: 'Apex Fasteners Ltd' }],
      quotes: [
        {
          vendorId: 'v-net-1',
          vendorName: 'Apex Fasteners Ltd',
          totalPrice: 150000,
        },
      ],
      status: 'Quotes Received',
    },
  ];

  const mockAuditLogs = [
    {
      id: 'audit-v1',
      action: 'VENDOR_VERIFIED',
      actorEmail: 'admin@procucev.com',
      details: 'Supplier verified for Apex Fasteners Ltd',
      timestamp: '2026-03-01T10:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRemoteVendors,
    });

    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: mockBuyerVendors,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: jest.fn(),
    });
  });

  test('renders page header, KPI cards, and unified sellers table', async () => {
    render(<SellersDirectory />);

    expect(screen.getByText('Export Directory')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
      expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
      expect(screen.getAllByText('Procucev Network').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Buyer Uploaded').length).toBeGreaterThanOrEqual(1);
    });
  });

  test('searches sellers by company name, contact person, or location', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search company/i);
    fireEvent.change(searchInput, { target: { value: 'Apex' } });

    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Precision Forgings Pvt Ltd')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Pune' } });
    expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Apex Fasteners Ltd')).not.toBeInTheDocument();
  });

  test('filters sellers by source, category, and rating', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const sourceSelect = screen.getByDisplayValue('All Sources');
    fireEvent.change(sourceSelect, { target: { value: 'buyer' } });

    expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Apex Fasteners Ltd')).not.toBeInTheDocument();

    // Reset source
    fireEvent.change(sourceSelect, { target: { value: 'all' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();

    // Filter by category
    const categorySelect = screen.getByDisplayValue('All Categories');
    fireEvent.change(categorySelect, { target: { value: 'Industrial Fasteners' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();

    // Filter by rating
    const ratingSelect = screen.getByDisplayValue('All Ratings');
    fireEvent.change(ratingSelect, { target: { value: '4plus' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();

    fireEvent.change(ratingSelect, { target: { value: '4.5plus' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
  });

  test('searches sellers by company name, contact, category, or email', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search company/i);
    fireEvent.change(searchInput, { target: { value: 'apexfasteners.com' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Precision Forgings Pvt Ltd')).not.toBeInTheDocument();
  });

  test('renders actual last login dates for sellers and searches by email in unified search', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
      expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
    });

    // Apex Fasteners has genuine login timestamp, Precision Forgings displays "Never"
    expect(screen.getByText('Never')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search company/i);
    // Unified search by email
    fireEvent.change(searchInput, { target: { value: 'precisionforgings.in' } });
    expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Apex Fasteners Ltd')).not.toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    expect(screen.getByText('Precision Forgings Pvt Ltd')).toBeInTheDocument();
  });

  test('categoryOptions retains options when a category is selected', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: mockBuyerVendors,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      categoryTaxonomy: [
        { majorCategory: 'Industrial Fasteners', minorCategories: [] },
        { majorCategory: 'Electrical Supplies', minorCategories: [] },
      ],
      setSelectedRFQForMatrix: jest.fn(),
    });

    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const categorySelect = screen.getByDisplayValue('All Categories');
    fireEvent.change(categorySelect, { target: { value: 'Industrial Fasteners' } });

    // Ensure the other category options are still present in the dropdown
    expect(screen.getByRole('option', { name: 'Electrical Supplies' })).toBeInTheDocument();
  });

  test('displays empty state when query matches no suppliers', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search company/i);
    fireEvent.change(searchInput, { target: { value: 'Nonexistent Vendor 9999' } });

    expect(screen.getByText('No suppliers found matching your query.')).toBeInTheDocument();
  });

  test('export directory button triggers exportReportToExcel', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const exportBtn = screen.getByText('Export Directory');
    fireEvent.click(exportBtn);

    expect(reportsClient.exportReportToExcel).toHaveBeenCalled();
  });

  test('clicking 360 Dossier opens seller drawer with 5 sections and close button', async () => {
    const onSelectRFQ = jest.fn();
    render(<SellersDirectory onSelectRFQ={onSelectRFQ} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Tab 1: Profile
    expect(screen.getByText('Contact Details')).toBeInTheDocument();
    expect(screen.getAllByText('Ahmedabad, Gujarat').length).toBeGreaterThanOrEqual(1);

    // Tab 2: Quotes
    const rfqTab = screen.getByRole('button', { name: /Quotes/i });
    fireEvent.click(rfqTab);
    expect(screen.getByText('RFQ-NET-001')).toBeInTheDocument();

    // Open quote details modal
    fireEvent.click(screen.getByText('RFQ-NET-001'));
    const viewFullBtn = screen.getByRole('button', { name: /View Full Details/i });
    fireEvent.click(viewFullBtn);
    expect(onSelectRFQ).toHaveBeenCalled();

    // Tab 3: Credit
    const creditsTab = screen.getByRole('button', { name: /^Credit$/i });
    fireEvent.click(creditsTab);
    expect(screen.getByText('Total Credits Allocated')).toBeInTheDocument();

    // Tab 4: Communications
    const commsTab = screen.getByRole('button', { name: /Communications/i });
    fireEvent.click(commsTab);
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();

    // Tab 5: Payments
    const payTab = screen.getByRole('button', { name: /Payments/i });
    fireEvent.click(payTab);
    expect(screen.getByText('Total Amount Paid')).toBeInTheDocument();

    // Close dossier via header X button
    const closeBtns = screen.getAllByRole('button', { name: /Close Dossier/i });
    fireEvent.click(closeBtns[0]);

    await waitFor(() => {
      expect(screen.queryByLabelText('Supplier 360° Dossier')).not.toBeInTheDocument();
    });

    // Open second vendor (Precision Forgings Pvt Ltd) which has 0 RFQs
    const dossierBtns2 = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns2[1]);
    expect(screen.getAllByText('Precision Forgings Pvt Ltd').length).toBeGreaterThanOrEqual(1);

    // Tab 2: Empty Quotes
    const emptyRfqTab = screen.getByRole('button', { name: /Quotes/i });
    fireEvent.click(emptyRfqTab);
    expect(screen.getByText(/No quotation opportunities found/i)).toBeInTheDocument();

    // Close via footer Close Dossier button
    const closeButtons = screen.getAllByRole('button', { name: /Close Dossier/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByLabelText('Supplier 360° Dossier')).not.toBeInTheDocument();
    });
  });

  test('supports table pagination, changing page size, and navigating pages', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    // Pagination info summary
    expect(screen.getByText('Showing')).toBeInTheDocument();
    expect(screen.getByText('of')).toBeInTheDocument();
    expect(screen.getByText('entries')).toBeInTheDocument();

    // Rows per page dropdown
    const pageSizeSelect = screen.getByLabelText('Rows per page');
    expect(pageSizeSelect).toBeInTheDocument();
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });
    expect((pageSizeSelect as HTMLSelectElement).value).toBe('25');

    // Prev / Next buttons
    const prevBtn = screen.getByLabelText('Previous page');
    const nextBtn = screen.getByLabelText('Next page');
    expect(prevBtn).toBeDisabled(); // On first page
    expect(nextBtn).toBeDisabled(); // Only 2 items with page size 25
  });

  test('CategoryManagerSellersDirectoryPage wrapper component mounts properly and triggers RFQ matrix', async () => {
    const mockSetSelected = jest.fn();
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: mockBuyerVendors,
      rfqs: mockRfqs,
      auditLogs: mockAuditLogs,
      setSelectedRFQForMatrix: mockSetSelected,
    });

    render(<CategoryManagerSellersDirectoryPage />);
    expect(screen.getByText('Export Directory')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    // Open dossier
    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Go to Quotes tab
    const rfqTab = screen.getByRole('button', { name: /Quotes/i });
    fireEvent.click(rfqTab);

    // Click quote to open modal and click View Full Details
    fireEvent.click(screen.getByText('RFQ-NET-001'));
    const viewFullBtn = screen.getByRole('button', { name: /View Full Details/i });
    fireEvent.click(viewFullBtn);

    expect(mockSetSelected).toHaveBeenCalledWith(mockRfqs[0]);
  });

  test('safely handles seller with null email when opening dossier and filtering audit logs', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'v-null-email',
          name: 'Null Email Supplier',
          contactPerson: 'No Email Contact',
          email: null,
          location: 'Kolkata, West Bengal',
          source: 'procucev_network',
          majorCategory: 'Packaging',
          score: 80,
          rating: 4.0,
          status: 'ACTIVE',
        },
      ],
    });

    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Null Email Supplier')).toBeInTheDocument();
    });

    const dossierBtns = screen.getAllByText('360° Dossier');
    // Clicking dossier must not throw "TypeError: can't access property toLowerCase, activeSeller.email is null"
    expect(() => fireEvent.click(dossierBtns[0])).not.toThrow();
    expect(screen.getByText('supplier@procucev.com')).toBeInTheDocument();
  });
  test('opens and interacts with Column Settings modal, toggling columns and resetting', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRemoteVendors,
    });

    render(<SellersDirectory />);
    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    // Open Column Settings
    const gearBtn = screen.getByLabelText('Customize Columns');
    fireEvent.click(gearBtn);
    expect(screen.getByRole('dialog', { name: 'Customize Columns' })).toBeInTheDocument();
    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    // Toggle optional columns on to test full cell rendering
    const optionalLabels = [
      'Contact Person',
      'Email',
      'Phone',
      '360° Score',
      'Registration Date',
      'Location',
    ];
    optionalLabels.forEach((label) => {
      const checkbox = screen.queryByLabelText(new RegExp('^' + label, 'i'));
      if (checkbox) {
        fireEvent.click(checkbox);
      }
    });

    // Toggle required column (Supplier) - should be disabled and locked
    const supplierCheckbox = screen.getByLabelText(/Supplier/i);
    expect(supplierCheckbox).toBeDisabled();
    fireEvent.click(supplierCheckbox);

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

  test('handles drag and drop reordering of columns in settings modal', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRemoteVendors,
    });

    render(<SellersDirectory />);
    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

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

  test('sorts by different columns in ascending and descending orders', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: [
        ...mockRemoteVendors,
        {
          id: 'v-net-2',
          name: 'Zenith Bearings Ltd',
          contactPerson: 'Aarav Patel',
          email: 'aarav@zenithbearings.com',
          phone: '+919876543299',
          location: 'Bengaluru, Karnataka',
          deliveryLocation: 'Pan India',
          source: 'procucev_network',
          majorCategory: 'Bearings',
          score: 85,
          rating: 4.2,
          status: 'ACTIVE_VERIFIED',
          freeQuotationCredits: 10,
          createdAt: '2026-02-15T10:00:00Z',
          lastLogin: '2026-03-01T08:00:00Z',
        },
      ],
    });

    // Render with all columns enabled via localStorage
    const allColsVisible = [
      { key: 'supplierName', label: 'Supplier', visible: true, required: true },
      { key: 'location', label: 'Location', visible: true },
      { key: 'deliveryLocation', label: 'Delivery Location', visible: true },
      { key: 'category', label: 'Category', visible: true },
      { key: 'lastLogin', label: 'Last Login', visible: true },
      { key: 'rating', label: 'Rating', visible: true },
      { key: 'credits', label: 'Credits', visible: true },
      { key: 'status', label: 'Status', visible: true },
      { key: 'contactPerson', label: 'Contact Person', visible: true },
      { key: 'email', label: 'Email', visible: true },
      { key: 'phone', label: 'Phone', visible: true },
      { key: 'score360', label: '360° Score', visible: true },
      { key: 'registrationDate', label: 'Registration Date', visible: true },
      { key: 'actions', label: 'Actions', visible: true, required: true },
    ];
    window.localStorage.setItem('seller_directory_columns_pref', JSON.stringify(allColsVisible));

    render(<SellersDirectory />);
    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
      expect(screen.getByText('Zenith Bearings Ltd')).toBeInTheDocument();
    });

    const columnHeaders = [
      'Supplier',
      'Location',
      'Delivery Location',
      'Category',
      'Last Login',
      'Rating',
      'Credits',
      'Status',
      'Contact Person',
      'Email',
      'Phone',
      '360° Score',
      'Registration Date',
    ];

    columnHeaders.forEach((name) => {
      const th = screen.queryByRole('columnheader', { name: new RegExp('^' + name + '\$', 'i') });
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

  test('loads partial column preferences and appends missing defaults', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRemoteVendors,
    });

    const partialPrefs = [
      { key: 'supplierName', label: 'Supplier', visible: true, required: true },
      { key: 'location', label: 'Location', visible: false },
    ];
    window.localStorage.setItem('seller_directory_columns_pref', JSON.stringify(partialPrefs));

    render(<SellersDirectory />);
    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });
    expect(screen.getByText('Export Directory')).toBeInTheDocument();
    window.localStorage.clear();
  });

  test('handles corrupted localStorage JSON without crashing', async () => {
    (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
      success: true,
      data: mockRemoteVendors,
    });

    window.localStorage.setItem('seller_directory_columns_pref', '{invalid_json');

    render(<SellersDirectory />);
    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });
    expect(screen.getByText('Export Directory')).toBeInTheDocument();
    window.localStorage.clear();
  });

});
