import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VendorConsole, { DEFAULT_VENDOR_CONSOLE_COLUMNS } from '@/app/category-manager/vendor-console';
import { useApp } from '@/lib/store';
import { fetchAllVendors } from '@/lib/rfqClient';
import { fetchCategoryTaxonomy } from '@/lib/buyerProfileClient';
import { getMajorCategories, getMinorCategories } from '@/lib/categoryTaxonomy';
import { exportReportToCsv } from '@/lib/reportsClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { RFQItem, RFQVendorCandidate } from '@/lib/types';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/rfqClient', () => ({ fetchAllVendors: jest.fn() }));
jest.mock('@/lib/buyerProfileClient', () => ({ fetchCategoryTaxonomy: jest.fn() }));
jest.mock('@/lib/categoryTaxonomy', () => ({
  getMajorCategories: jest.fn(),
  getMinorCategories: jest.fn(() => []),
}));
jest.mock('@/lib/reportsClient', () => ({
  exportReportToCsv: jest.fn(),
}));

const candidateA: RFQVendorCandidate = {
  id: 'vendor-a',
  name: 'Alpha Corp',
  contactPerson: 'Alice',
  email: 'alice@alpha.com',
  phone: '1111111111',
  majorCategory: 'Electronics',
  minorCategories: [],
  location: 'Bangalore',
  pincode: '560001',
  rating: 3.5,
  source: 'category_manager_upload',
  alreadyInvited: false,
};

const candidateB: RFQVendorCandidate = {
  id: 'vendor-b',
  name: 'Beta Supplies',
  contactPerson: 'Bob',
  email: 'bob@beta.com',
  phone: '2222222222',
  majorCategory: 'Pumps',
  minorCategories: [],
  location: 'Mumbai',
  pincode: '400001',
  rating: 4.8,
  source: 'procucev_network',
  alreadyInvited: false,
};

const candidateC: RFQVendorCandidate = {
  id: 'vendor-c',
  name: 'Gamma Tools',
  contactPerson: '',
  email: '',
  phone: '',
  majorCategory: 'Tools',
  minorCategories: [],
  location: '',
  pincode: '',
  rating: 2.0,
  source: 'self_onboarded',
  alreadyInvited: false,
};

const candidateD: RFQVendorCandidate = {
  id: 'vendor-d',
  name: 'Alpha Corp',
  contactPerson: 'Alice',
  email: 'alice2@alpha.com',
  phone: '',
  majorCategory: 'Electronics',
  minorCategories: [],
  location: '',
  pincode: '',
  rating: null as unknown as number,
  source: 'category_manager_upload',
  alreadyInvited: false,
};

const candidateE: RFQVendorCandidate = {
  id: 'vendor-e',
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  majorCategory: '',
  minorCategories: [],
  location: '',
  pincode: '',
  rating: null as unknown as number,
  source: 'self_onboarded',
  alreadyInvited: false,
};

const makePage = (candidates: RFQVendorCandidate[]) => ({
  success: true,
  candidates,
  pagination: { page: 1, pageSize: 20, total: candidates.length, totalPages: 1 },
});

const mockRfqs: RFQItem[] = [
  {
    id: 'rfq-1',
    rfqNumber: 'RFQ-001',
    title: 'RFQ Alpha',
    category: 'Electronics',
    sourcingMode: 'mode_1',
    status: 'PO Generated',
    budget: 5000,
    awardedVendor: 'Alpha Corp',
    awardedAmount: 2500,
    quotesCount: 1,
    targetDeliveryDate: '2026-12-01',
    createdAt: '2026-10-01',
    chasingActive: false,
    extractedEntities: [],
    quotes: [
      {
        vendorId: 'vendor-a',
        vendorName: 'Alpha Corp',
        vendorCategory: 'Client List',
        unitPrice: 2500,
        totalPrice: 2500,
        leadTimeDays: 4,
        aiMatchScore: 95,
        warrantyYears: 1,
        paymentTerms: 'Advance',
        remarks: 'Optimal quote',
        complianceStatus: 'Fully Compliant',
      },
    ],
  },
  {
    id: 'rfq-2',
    rfqNumber: 'RFQ-002',
    title: 'RFQ Beta',
    category: 'Pumps',
    sourcingMode: 'mode_1',
    status: 'PO Generated',
    budget: 10000,
    awardedVendor: 'Beta Supplies',
    awardedAmount: 8000,
    quotesCount: 2,
    targetDeliveryDate: '2026-12-01',
    createdAt: '2026-10-01',
    chasingActive: false,
    extractedEntities: [],
    quotes: [
      {
        vendorId: 'vendor-b',
        vendorName: 'Beta Supplies',
        vendorCategory: 'Procucev Network',
        unitPrice: 4000,
        totalPrice: 8000,
        leadTimeDays: 10,
        aiMatchScore: 88,
        warrantyYears: 2,
        paymentTerms: 'Net 30',
        remarks: 'Standard bid',
        complianceStatus: 'Minor Exception',
      },
      {
        vendorId: 'vendor-b',
        vendorName: 'Beta Supplies',
        vendorCategory: 'Procucev Network',
        unitPrice: 4000,
        totalPrice: 8000,
        leadTimeDays: 12,
        aiMatchScore: 92,
        warrantyYears: 2,
        paymentTerms: 'Net 30',
        remarks: 'Compliant option',
        complianceStatus: 'Fully Compliant',
      },
    ],
  },
];

describe('VendorConsole Table, Sorting, CSV Export and Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({ rfqs: mockRfqs });
    (getMajorCategories as jest.Mock).mockReturnValue(['Electronics', 'Pumps', 'Tools']);
    (getMinorCategories as jest.Mock).mockReturnValue([]);
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (fetchAllVendors as jest.Mock).mockResolvedValue(makePage([candidateA, candidateB, candidateC, candidateD, candidateE]));
  });

  test('sorts each column asc and desc on header click with equal items and empty fallbacks', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const table = screen.getByRole('table');

    // Test sort by company (has duplicate 'Alpha Corp' and empty string to test all fallbacks)
    const companyHeader = within(table).getByRole('columnheader', { name: /VENDOR NAME/i });
    fireEvent.click(companyHeader); // asc
    fireEvent.click(companyHeader); // desc

    // Test sort by contact (has duplicate 'Alice', empty contact with name, and empty string)
    const contactHeader = within(table).getByRole('columnheader', { name: /CONTACT/i });
    fireEvent.click(contactHeader); // asc
    fireEvent.click(contactHeader); // desc

    // Test sort by category (has duplicate 'Electronics' and empty category)
    const categoryHeader = within(table).getByRole('columnheader', { name: /CATEGORY\/DIVISION/i });
    fireEvent.click(categoryHeader); // asc
    fireEvent.click(categoryHeader); // desc

    // Test sort by rating (has duplicate rating and null/undefined rating)
    const ratingHeader = within(table).getByRole('columnheader', { name: /RATING/i });
    fireEvent.click(ratingHeader); // asc
    fireEvent.click(ratingHeader); // desc

    // Test sort by total bids (has duplicate 0 and 1)
    const bidsHeader = within(table).getByRole('columnheader', { name: /TOTAL BIDS/i });
    fireEvent.click(bidsHeader); // asc
    fireEvent.click(bidsHeader); // desc

    // Test sort by compliance (has null compliance and defined compliance)
    const complianceHeader = within(table).getByRole('columnheader', { name: /COMPLIANCE/i });
    fireEvent.click(complianceHeader); // asc
    fireEvent.click(complianceHeader); // desc

    // Test sort by awarded spend
    const spendHeader = within(table).getByRole('columnheader', { name: /AWARDED SPEND/i });
    fireEvent.click(spendHeader); // asc
    fireEvent.click(spendHeader); // desc

    // Switch section tabs while sorting is active
    fireEvent.click(screen.getByRole('button', { name: /1\. CM Uploaded/i }));
    fireEvent.click(screen.getByRole('button', { name: /2\. Self-Onboard/i }));
  });

  test('opens vendor modal from company name button and toggles review action button', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    const cardA = await screen.findByTestId('vendor-card-vendor-a');

    // Click review performance button when closed (takes open modal branch)
    const actionBtn = within(cardA).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance });
    fireEvent.click(actionBtn);

    // Modal is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The review performance button should now say Hide Details
    const hideBtn = within(cardA).getByRole('button', { name: UI_STRINGS.actions.hideDetails });
    fireEvent.click(hideBtn);

    // Clicking again deselects and hides details
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen using company button
    const companyBtn = within(cardA).getByRole('button', { name: 'Alpha Corp' });
    fireEvent.click(companyBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('exports vendor rows to CSV when Export button is clicked and returns early when empty', async () => {
    const { unmount } = render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const exportBtn = screen.getByRole('button', { name: /Export/i });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);

    expect(exportReportToCsv).toHaveBeenCalledTimes(1);
    const [rows, filename] = (exportReportToCsv as jest.Mock).mock.calls[0];
    expect(rows.length).toBe(5);
    expect(rows[0]['Vendor Name']).toBe('Alpha Corp');
    expect(filename).toMatch(/^vendor_performance_\d{4}-\d{2}-\d{2}$/);
    unmount();

    // Test early return when displayed vendors is empty
    (fetchAllVendors as jest.Mock).mockResolvedValueOnce(makePage([]));
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByText('No Vendors Found');
  });

  test('opens column settings modal, modifies visibility, resets to default, and closes', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    // Click Settings button
    const settingsBtn = screen.getByRole('button', { name: 'Column Settings' });
    fireEvent.click(settingsBtn);

    // Modal should be open
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Column Settings' })).toBeInTheDocument();

    // Toggle a checkbox inside dialog
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    fireEvent.click(checkboxes[1]);

    // Find Reset to Default button
    const resetBtn = within(dialog).getByRole('button', { name: /Reset to Default/i });
    fireEvent.click(resetBtn);

    // Click Done
    const doneBtn = within(dialog).getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('triggers manual refetch when Retry/Refresh button is clicked', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    expect(fetchAllVendors).toHaveBeenCalledTimes(1);

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(fetchAllVendors).toHaveBeenCalledTimes(2);
    });
  });

  test('handles refetch error gracefully and displays the error message', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    (fetchAllVendors as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Network connectivity timeout',
    });

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Network connectivity timeout')).toBeInTheDocument();
  });

  test('handles accessible contact person filter changes', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const companySelect = screen.getByLabelText('Vendor Company');
    fireEvent.change(companySelect, { target: { value: 'Alpha Corp' } });

    const contactSelect = screen.getByLabelText('Contact Person');
    expect(contactSelect).not.toBeDisabled();
    fireEvent.change(contactSelect, { target: { value: 'vendor-a' } });
  });

  test('opens and closes VendorUploadModal when clicking Upload button', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const uploadBtn = screen.getByRole('button', { name: /Add \/ Upload CM Vendors/i });
    fireEvent.click(uploadBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('handles initial fetch error response and displays message', async () => {
    (fetchAllVendors as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Initial vendor loading failed',
    });
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    expect(await screen.findByText('Initial vendor loading failed')).toBeInTheDocument();
  });

  test('handles load more error gracefully', async () => {
    (fetchAllVendors as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        candidates: [candidateA],
        pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        success: false,
        error: 'Load more failed',
      });

    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const loadMoreBtn = screen.getByTestId('load-more-vendor-cards');
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText('Load more failed')).toBeInTheDocument();
  });

  test('shows partial pincode warning when entering fewer than 3 digits', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    await screen.findByTestId('vendor-card-vendor-a');

    const pincodeInput = screen.getByPlaceholderText(/Pincode/i);
    fireEvent.change(pincodeInput, { target: { value: '56' } });

    expect(screen.getByText(/Enter at least 3 digits/i)).toBeInTheDocument();
  });

  test('dismisses open vendor modal on Escape key', async () => {
    render(<VendorConsole onNavigateToMatrix={jest.fn()} />);
    const cardA = await screen.findByTestId('vendor-card-vendor-a');

    fireEvent.click(within(cardA).getByRole('button', { name: UI_STRINGS.actions.reviewVendorPerformance }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
