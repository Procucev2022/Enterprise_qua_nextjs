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

    expect(screen.getByText('Sellers Directory')).toBeInTheDocument();

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

    const searchInput = screen.getByPlaceholderText(/Search company, contact, category/);
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

    const searchInput = screen.getByPlaceholderText(/Search company, contact, category/);
    fireEvent.change(searchInput, { target: { value: 'apexfasteners.com' } });
    expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Precision Forgings Pvt Ltd')).not.toBeInTheDocument();
  });

  test('displays empty state when query matches no suppliers', async () => {
    render(<SellersDirectory />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search company, contact, category/);
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

  test('clicking 360 Dossier opens seller drawer with all 6 sections and rating revision', async () => {
    const onSelectRFQ = jest.fn();
    render(<SellersDirectory onSelectRFQ={onSelectRFQ} />);

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Tab 1: Profile
    expect(screen.getByText('Contact Details')).toBeInTheDocument();
    expect(screen.getByText('24AAACA1111A1Z1')).toBeInTheDocument();

    // Tab 2: RFQ & Quotes
    const rfqTab = screen.getByText(/2. RFQ & Quotes/);
    fireEvent.click(rfqTab);
    expect(screen.getByText('RFQ-NET-001')).toBeInTheDocument();
    expect(screen.getByText('M16 Galvanized Bolts')).toBeInTheDocument();

    // Test Open RFQ Matrix
    const matrixBtn = screen.getByTitle('Open RFQ Matrix');
    fireEvent.click(matrixBtn);
    expect(onSelectRFQ).toHaveBeenCalled();

    // Tab 3: Credits & Quotas
    const creditsTab = screen.getByText('3. Credits & Quotas');
    fireEvent.click(creditsTab);
    expect(screen.getByText('Free Quotation Credits')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();

    // Tab 4: Communications
    const commsTab = screen.getByText(/4. Communications/);
    fireEvent.click(commsTab);
    expect(screen.getByText(/Procucev Supplier Network Onboarding/)).toBeInTheDocument();

    // Tab 5: Payments
    const payTab = screen.getByText(/5. Payments/);
    fireEvent.click(payTab);
    expect(screen.getAllByText(/Preferred Partner/).length).toBeGreaterThanOrEqual(1);

    // Tab 6: 360 AI Review & Activity
    const actTab = screen.getByText(/6. 360° AI Review & Activity/);
    fireEvent.click(actTab);
    expect(screen.getByText('Category Manager Rating Revision')).toBeInTheDocument();

    // Change numeric revision scores
    const qualityInput = screen.getByDisplayValue('85');
    fireEvent.change(qualityInput, { target: { value: '95' } });
    const costInput = screen.getByDisplayValue('80');
    fireEvent.change(costInput, { target: { value: '88' } });
    const deliveryInput = screen.getByDisplayValue('90');
    fireEvent.change(deliveryInput, { target: { value: '92' } });

    // Fill and save rating revision
    const remarksInput = screen.getByPlaceholderText(/Audited factory quality/);
    fireEvent.change(remarksInput, { target: { value: 'Passed quarterly ISO audit with flying colors' } });

    const saveRatingBtn = screen.getByText('Save Rating Revision');
    fireEvent.click(saveRatingBtn);

    await waitFor(() => {
      expect(screen.getByText(/Category Manager Rating Revision saved/)).toBeInTheDocument();
    });

    // Close dossier via top X button
    const closeButtons = screen.getAllByRole('button');
    const xButton = closeButtons.find((btn) => btn.querySelector('svg.lucide-x'));
    if (xButton) {
      fireEvent.click(xButton);
    } else {
      const closeBtn = screen.getByText('Close Dossier');
      fireEvent.click(closeBtn);
    }

    await waitFor(() => {
      expect(screen.queryByText('Category Manager Rating Revision')).not.toBeInTheDocument();
    });

    // Open second vendor (Precision Forgings Pvt Ltd) which has 0 RFQs
    fireEvent.click(dossierBtns[1]);
    expect(screen.getAllByText('Precision Forgings Pvt Ltd').length).toBeGreaterThanOrEqual(1);

    // Tab 2: Empty RFQs
    const emptyRfqTab = screen.getByText(/2. RFQ & Quotes/);
    fireEvent.click(emptyRfqTab);
    expect(screen.getByText(/No active RFQs or bids found for this supplier/)).toBeInTheDocument();

    // Tab 3: Credits
    const creditsTab2 = screen.getByText('3. Credits & Quotas');
    fireEvent.click(creditsTab2);
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1);

    // Tab 4: Communications
    const commsTab2 = screen.getByText(/4. Communications/);
    fireEvent.click(commsTab2);
    expect(screen.getByText(/Procucev Supplier Network Onboarding/)).toBeInTheDocument();

    // Tab 5: Payments
    const payTab2 = screen.getByText(/5. Payments/);
    fireEvent.click(payTab2);
    expect(screen.getByText(/SUP-INV/)).toBeInTheDocument();

    // Tab 6: Save revision without custom remarks (uses default remark)
    const actTab2 = screen.getByText(/6. 360° AI Review & Activity/);
    fireEvent.click(actTab2);
    const saveRatingBtn2 = screen.getByText('Save Rating Revision');
    fireEvent.click(saveRatingBtn2);

    await waitFor(() => {
      expect(screen.getByText(/Category Manager Rating Revision saved/)).toBeInTheDocument();
    });

    // Close via footer Close Dossier button
    const closeFooterBtn = screen.getByText('Close Dossier');
    fireEvent.click(closeFooterBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Precision Forgings Pvt Ltd' })).not.toBeInTheDocument();
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
    expect(screen.getByText('Sellers Directory')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Apex Fasteners Ltd')).toBeInTheDocument();
    });

    // Open dossier
    const dossierBtns = screen.getAllByText('360° Dossier');
    fireEvent.click(dossierBtns[0]);

    // Go to RFQ tab
    const rfqTab = screen.getByText(/2. RFQ & Quotes/);
    fireEvent.click(rfqTab);

    // Click Matrix button
    const matrixBtn = screen.getByTitle('Open RFQ Matrix');
    fireEvent.click(matrixBtn);

    expect(mockSetSelected).toHaveBeenCalledWith(mockRfqs[0]);
  });
});
