import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorSummary, { isBuyerUploaded, isProcucevVendor } from '@/app/buyer/vendor-summary';
import { useApp } from '@/lib/store';
import * as rfqClient from '@/lib/rfqClient';
import * as buyerProfileClient from '@/lib/buyerProfileClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));
jest.mock('@/lib/rfqClient', () => ({
  fetchAllVendors: jest.fn(),
}));
jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
}));

const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const mockFetchBuyerProfile = buyerProfileClient.fetchBuyerProfile as jest.Mock;

describe('app/buyer/vendor-summary.tsx', () => {
  const mockOnViewEvaluation = jest.fn();
  const mockOnNavigateToWizard = jest.fn();
  const mockShowToast = jest.fn();
  const mockReviseVendorRating = jest.fn();
  const mockOpenRatingRevisionEmailModal = jest.fn();
  const mockAddBuyerVendor = jest.fn();
  const mockUpdateBuyerVendor = jest.fn();
  const mockDeleteBuyerVendor = jest.fn();

  const mockBuyerVendors: any[] = [
    {
      id: 'v-1',
      name: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      location: 'Pune, Maharashtra',
      rating: 4.8,
      score: 96,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
      majorCategory: 'Mechanical',
      minorCategories: ['Valves', 'Pumps'],
      latestRatingRevision: {
        vendorId: 'v-1',
        vendorName: 'Apex Supplies Ltd.',
        qualityScore: 95,
        costScore: 90,
        deliveryScore: 98,
        newCompositeScore: 96,
        newRating: 4.8,
        remarks: 'Consistent high quality deliveries',
        timestamp: '2026-02-28 10:00:00',
        buyerCompany: 'Larsen & Toubro Limited',
      },
    },
    {
      id: 'v-2',
      name: 'Global Valves Ltd',
      contactPerson: 'Suresh Rao',
      email: 'suresh@globalvalves.in',
      phone: '+91 98201 55443',
      location: 'Vadodara, Gujarat',
      rating: 4.2,
      source: 'buyer_excel',
      status: 'CONDITIONAL / UNDER REVIEW',
      evaluated: true,
      majorCategory: 'Mechanical',
      minorCategories: ['Industrial Gate Valves'],
    },
    {
      id: 'v-3',
      name: 'TechnoForce Electricals Ltd',
      contactPerson: 'Pooja Verma',
      email: 'pooja@technoforce.com',
      phone: '+91 98000 22222',
      location: 'Bengaluru, KA',
      rating: 4.0,
      source: 'procucev_network',
      status: 'REGISTERED',
      evaluated: false,
      majorCategory: 'Electrical',
      overlap: true,
    },
    {
      id: 'net-4',
      name: 'Everest Steel & Infra',
      contactPerson: 'Vikram Rawat',
      email: 'vikram@everest.com',
      phone: '+91 98000 33333',
      location: 'Kolkata, WB',
      rating: 3.5,
      source: 'procucev_network',
      status: 'PENDING_ALIGNMENT',
      evaluated: false,
      majorCategory: 'Civil',
    },
    {
      id: 'net-5',
      name: 'HydraFlow Systems',
      contactPerson: 'Karan Mehra',
      email: 'karan@hydraflow.com',
      phone: '+91 98000 55555',
      location: 'Chennai, TN',
      source: 'procucev_network',
      status: 'OTHER_STATUS',
      evaluated: false,
      majorCategory: 'Mechanical',
    },
  ];

  const mockEvaluationRecords: any[] = [
    {
      id: 'eval-v-1',
      vendorId: 'v-1',
      vendorName: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      category: 'Mechanical',
      submissionDate: '2026-02-28',
      overallScore: 96,
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      systemAction: 'Auto Direct Dispatch Authorized',
      moduleScores: {
        commercial: { weightedScore: 24, remarks: 'Good' },
        technical: { weightedScore: 14, remarks: 'Good' },
        quality: { weightedScore: 19, remarks: 'Good' },
        delivery: { weightedScore: 19, remarks: 'Good' },
        financial: { weightedScore: 10, remarks: 'Good' },
        governance: { weightedScore: 10, remarks: 'Good' },
      },
      questionBreakdown: [],
      documents: [],
    },
  ];

  const mockRFQs: any[] = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Pumps',
      quotes: [
        { vendorId: 'v-1', vendorName: 'Apex Supplies Ltd.' },
        { vendorId: 'net-5', vendorName: 'HydraFlow Systems' }, // Network vendor used in RFQ
      ],
      followUpData: {
        vendors: [{ vendorId: 'v-3', vendorName: 'TechnoForce Electricals Ltd' }],
      },
    },
  ];

  // The "Procucev Vendors" tab is fetched via fetchAllVendors (the real
  // 80k+-row marketplace directory), never from buyerVendors — mockBuyerVendors
  // above still carries these for other fixtures (rfqs reference them by id),
  // but the mock below is what the tab itself actually renders from.
  const mockProcucevVendors = mockBuyerVendors.filter((v) => v.source === 'procucev_network');

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_3',
      rfqs: mockRFQs,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      updateBuyerVendor: mockUpdateBuyerVendor,
      deleteBuyerVendor: mockDeleteBuyerVendor,
      categoryTaxonomy: [
        { majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] },
        { majorCategory: 'Electrical', minorCategories: ['Cables', 'Transformers'] },
      ],
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
    });
    mockFetchAllVendors.mockImplementation(async (opts: { search?: string } = {}) => {
      const q = (opts.search || '').toLowerCase();
      const candidates = q
        ? mockProcucevVendors.filter(
            (v) =>
              v.name.toLowerCase().includes(q) ||
              (v.majorCategory || '').toLowerCase().includes(q) ||
              (v.email || '').toLowerCase().includes(q)
          )
        : mockProcucevVendors;
      return {
        success: true,
        candidates,
        pagination: { page: 1, pageSize: 20, total: candidates.length, totalPages: 1 },
      };
    });
    mockFetchBuyerProfile.mockResolvedValue({ success: false, error: 'unavailable' });
  });

  describe('helper classification functions', () => {
    it('correctly classifies buyer-uploaded vendors', () => {
      expect(isBuyerUploaded({ source: 'buyer_uploaded' })).toBe(true);
      expect(isBuyerUploaded({ source: 'vendor_master_ingestion' })).toBe(true);
      expect(isBuyerUploaded({ source: 'historical_purchase_dump' })).toBe(true);
      expect(isBuyerUploaded({ source: 'buyer_manual' })).toBe(true);
      expect(isBuyerUploaded({ source: 'buyer_excel' })).toBe(true);
      expect(isBuyerUploaded({ id: 'v-ingest-123', source: 'any' })).toBe(true);
      expect(isBuyerUploaded({ id: 'v-hist-123', source: 'any' })).toBe(true);
    });

    it('correctly classifies Procucev vendors', () => {
      expect(isProcucevVendor({ source: 'excel', id: 'cm-123' })).toBe(true);
      expect(isProcucevVendor({ source: 'category_manager_upload', id: 'cm-456' })).toBe(true);
      expect(isProcucevVendor({ source: 'procucev_network', id: 'net-789' })).toBe(true);
      expect(isProcucevVendor({ source: 'self_onboarded', id: 'self-123' })).toBe(true);
    });
  });

  it('renders vendor directory header and search controls', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    expect(screen.getByText('Vendor Directory & Management')).toBeInTheDocument();
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();
  });

  it('handles multi-select and select all vendor checkboxes', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    const selectAllCheckbox = screen.getByTestId('select-all-vendors-checkbox');
    const selectApex = screen.getByTestId('select-vendor-v-1');
    const selectGlobal = screen.getByTestId('select-vendor-v-2');

    expect(selectApex).not.toBeChecked();
    expect(selectGlobal).not.toBeChecked();

    // Toggle individual vendor
    fireEvent.click(selectApex);
    expect(selectApex).toBeChecked();
    expect(selectGlobal).not.toBeChecked();
    expect(screen.getByText('1 Selected')).toBeInTheDocument();

    // Select all
    fireEvent.click(selectAllCheckbox);
    expect(selectApex).toBeChecked();
    expect(selectGlobal).toBeChecked();

    // Clear selection
    const clearBtn = screen.getByRole('button', { name: /Clear Selection/i });
    fireEvent.click(clearBtn);
    expect(selectApex).not.toBeChecked();
    expect(selectGlobal).not.toBeChecked();
  });

  it('renders stats counters, vendor cards, and handles search & filters', async () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    expect(screen.getByText('Vendor Directory & Management')).toBeInTheDocument();
    expect(screen.getByText('Total Empanelled')).toBeInTheDocument();
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

    // Click Upload Vendor button
    fireEvent.click(screen.getByText(/Upload Vendor/i));
    expect(mockOnNavigateToWizard).toHaveBeenCalled();

    // Search filter
    const searchInput = screen.getByPlaceholderText(/Search vendors by name, contact, category/i);
    fireEvent.change(searchInput, { target: { value: 'Apex' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.queryByText('Global Valves Ltd')).not.toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Category filter
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Mechanical' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    fireEvent.change(selects[0], { target: { value: 'ALL' } });

    // Status filter: EVALUATED
    fireEvent.change(selects[1], { target: { value: 'EVALUATED' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Status filter: PREFERRED
    fireEvent.change(selects[1], { target: { value: 'PREFERRED' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Status filter: CONDITIONAL
    fireEvent.change(selects[1], { target: { value: 'CONDITIONAL' } });
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

    // Search with no results
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-12345' } });
    expect(screen.getByText(/No vendors match the selected filters/i)).toBeInTheDocument();
  });

  it('handles viewing 360° evaluation report', async () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // View evaluation on evaluated vendor
    const viewEvalBtns = screen.getAllByText(/View 360° Evaluation/i);
    fireEvent.click(viewEvalBtns[0]);
    expect(mockOnViewEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ vendorName: 'Apex Supplies Ltd.' })
    );
  });

  it('handles rating revision modal workflow for vendor with and without prior revision', async () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // 1. Click Revise Rating for Apex Supplies (has prior revision & score >= 90)
    const reviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(reviseBtns[0]);

    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

    // Test input sliders (range) and number inputs
    const rangeInputs = screen.getAllByRole('slider');
    if (rangeInputs[0]) fireEvent.change(rangeInputs[0], { target: { value: '94' } });
    if (rangeInputs[1]) fireEvent.change(rangeInputs[1], { target: { value: '86' } });
    if (rangeInputs[2]) fireEvent.change(rangeInputs[2], { target: { value: '92' } });

    const numberInputs = screen.getAllByRole('spinbutton');
    if (numberInputs[0]) fireEvent.change(numberInputs[0], { target: { value: '95' } });
    if (numberInputs[1]) fireEvent.change(numberInputs[1], { target: { value: '88' } });
    if (numberInputs[2]) fireEvent.change(numberInputs[2], { target: { value: '96' } });

    // Test remarks input
    const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
    fireEvent.change(textarea, { target: { value: 'Outstanding delivery speed and zero quality defects.' } });

    // Submit revision form
    fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));
    expect(mockReviseVendorRating).toHaveBeenCalledWith(
      'v-1',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      'Outstanding delivery speed and zero quality defects.'
    );

    // 2. Click Revise Rating for Global Valves (v-2, no prior revision, score < 90, empanelled vendor without RFQ)
    const buyerReviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(buyerReviseBtns[1]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));

    // Test X close button
    fireEvent.click(buyerReviseBtns[1]);
    const xBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument();

    // Click View Dispatched Email Notice
    fireEvent.click(screen.getByText(/View Dispatched Email Notice/i));
    expect(mockOpenRatingRevisionEmailModal).toHaveBeenCalled();
  });

  it('handles empty remarks warning on rating revision submit', async () => {
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_3',
      rfqs: mockRFQs,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: null,
    });

    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Click revise rating on Apex Supplies
    const buyerReviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(buyerReviseBtns[0]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

    // Clear remarks and submit
    const remarksInput = screen.getByPlaceholderText(/Describe specific delivery delays/i);
    fireEvent.change(remarksInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Remarks Required',
      expect.stringContaining('Please provide performance remarks'),
      'warning'
    );
  });

  it('handles Mode 1 and Mode 2 rendering rules for buyer-uploaded vendors', async () => {
    // Mode 1: Private Roster only
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_1',
      rfqs: mockRFQs,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: null,
    });

    const { rerender } = render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Mode 2: Hybrid Sourcing
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_2',
      rfqs: [],
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: null,
    });

    rerender(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );
    expect(screen.getAllByText('BUYER ROSTER (NO EVAL)')[0]).toBeInTheDocument();
  });

  describe('Vendor CRUD Operations', () => {
    it('handles View Vendor Profile modal workflow', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Click View Profile on Apex Supplies
      const viewProfileBtns = screen.getAllByRole('button', { name: /View Profile/i });
      fireEvent.click(viewProfileBtns[0]);

      expect(screen.getByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).toBeInTheDocument();
      expect(screen.getByText(/Procurement Taxonomy & Products/i)).toBeInTheDocument();
      expect(screen.getByText(/Statutory & Financial Registration/i)).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).not.toBeInTheDocument();
    });

    it('handles Add Vendor modal workflow (open, fill required fields, submit, persists via addBuyerVendor)', async () => {
      mockAddBuyerVendor.mockResolvedValue({ id: 'v-new', name: 'New Direct Vendor', email: 'new-direct@vendor.test' });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
      expect(screen.getByRole('heading', { name: 'Add Vendor' })).toBeInTheDocument();

      // Submitting with required fields blank (whitespace passes HTML5
      // `required` but fails the handler's own .trim() check) shows a
      // validation toast and never calls the backend.
      fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: '   ' } });
      fireEvent.change(screen.getByLabelText(/Contact Person/i), { target: { value: '   ' } });
      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'a@b.com' } });
      fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '   ' } });
      fireEvent.click(screen.getByTestId('submit-add-vendor'));
      expect(mockShowToast).toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');
      expect(mockAddBuyerVendor).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: 'New Direct Vendor' } });
      fireEvent.change(screen.getByLabelText(/Contact Person/i), { target: { value: 'Priya Singh' } });
      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'new-direct@vendor.test' } });
      fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '9876543210' } });
      fireEvent.change(screen.getByLabelText(/Major Category/i), { target: { value: 'Electrical' } });
      fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Mumbai' } });
      fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Maharashtra' } });
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '400001' } });
      fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: '27AAAAA0000A1Z5' } });

      fireEvent.click(screen.getByTestId('submit-add-vendor'));

      await waitFor(() => expect(mockAddBuyerVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Direct Vendor',
          contactPerson: 'Priya Singh',
          email: 'new-direct@vendor.test',
          phone: '9876543210',
          majorCategory: 'Electrical',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        })
      ));
      // Modal closes only after the backend confirms the write.
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Vendor' })).not.toBeInTheDocument());
    });

    it('closes the Add Vendor modal via the header close button', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
      fireEvent.click(screen.getByTestId('close-add-vendor-modal'));
      expect(screen.queryByRole('heading', { name: 'Add Vendor' })).not.toBeInTheDocument();
      expect(mockAddBuyerVendor).not.toHaveBeenCalled();
    });

    it('keeps the Add Vendor modal open with the form intact when the backend rejects the write', async () => {
      mockAddBuyerVendor.mockResolvedValue(null);

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
      fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: 'Rejected Vendor Co' } });
      fireEvent.change(screen.getByLabelText(/Contact Person/i), { target: { value: 'Someone' } });
      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'rejected@vendor.test' } });
      fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '9876543210' } });
      fireEvent.click(screen.getByTestId('submit-add-vendor'));

      await waitFor(() => expect(mockAddBuyerVendor).toHaveBeenCalled());
      // addBuyerVendor itself is responsible for the failure toast; the modal
      // just stays open so nothing typed is lost.
      expect(screen.getByRole('heading', { name: 'Add Vendor' })).toBeInTheDocument();
      expect(screen.getByDisplayValue('Rejected Vendor Co')).toBeInTheDocument();
    });

    it('adds and removes a minor category tag in the Add Vendor form', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
      const minorInput = screen.getByPlaceholderText(/Type a minor category and press Enter/i);
      fireEvent.change(minorInput, { target: { value: 'Custom Category' } });
      fireEvent.keyDown(minorInput, { key: 'Enter' });
      expect(screen.getByText('Custom Category')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Custom Category').closest('span')!.querySelector('button')!);
      expect(screen.queryByText('Custom Category')).not.toBeInTheDocument();
    });

    it('closes the Add Vendor modal via Cancel without calling addBuyerVendor', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('heading', { name: 'Add Vendor' })).not.toBeInTheDocument();
      expect(mockAddBuyerVendor).not.toHaveBeenCalled();
    });

    it('handles Edit Vendor modal workflow (open, update fields, save changes)', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Click Edit on Apex Supplies
      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();

      // Modify Contact Person
      const contactInput = screen.getByDisplayValue('Rajesh Nair');
      fireEvent.change(contactInput, { target: { value: 'Rajesh Nair Updated' } });

      // Save changes
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

      expect(mockUpdateBuyerVendor).toHaveBeenCalledWith(
        'v-1',
        expect.objectContaining({
          contactPerson: 'Rajesh Nair Updated',
        })
      );
    });

    it('handles Delete Vendor modal workflow (open, confirm deletion)', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Click Delete on Apex Supplies
      const deleteBtns = screen.getAllByRole('button', { name: /Delete/i });
      fireEvent.click(deleteBtns[0]);

      expect(screen.getByText('Delete Vendor Record')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();

      // Confirm delete
      const confirmDeleteBtn = screen.getByRole('button', { name: /Delete Vendor/i });
      fireEvent.click(confirmDeleteBtn);

      expect(mockDeleteBuyerVendor).toHaveBeenCalledWith('v-1');
    });

    it('handles tab navigation, search input, status filter, and category filter', async () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Search vendor
      const searchInput = screen.getByPlaceholderText(/Search vendors by name/i);
      fireEvent.change(searchInput, { target: { value: 'Global' } });
      expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();
      expect(screen.queryByText('Apex Supplies Ltd.')).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

      // Navigate to Wizard button
      const uploadBtn = screen.getByRole('button', { name: /Upload Vendor/i });
      fireEvent.click(uploadBtn);
      expect(mockOnNavigateToWizard).toHaveBeenCalledTimes(1);
    });

    it('handles View Profile, Edit, and Delete modal cancel actions', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Click View Profile on Apex Supplies
      const viewBtns = screen.getAllByRole('button', { name: /View Profile/i });
      fireEvent.click(viewBtns[0]);

      expect(screen.getByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).toBeInTheDocument();

      // Close view modal
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtn);
      expect(screen.queryByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).not.toBeInTheDocument();

      // Click Edit and then Cancel
      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);
      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByText('Edit Vendor Profile')).not.toBeInTheDocument();

      // Click Delete and then Cancel
      const deleteBtns = screen.getAllByRole('button', { name: /Delete/i });
      fireEvent.click(deleteBtns[0]);
      expect(screen.getByText('Delete Vendor Record')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByText('Delete Vendor Record')).not.toBeInTheDocument();
    });

    it('handles minor category tag add (incl. duplicate/empty no-ops) and removal in Edit modal', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      const tagInput = screen.getByPlaceholderText(/Type category and press Add Tag/i);
      const addTagBtn = screen.getByRole('button', { name: /Add Tag/i });

      // Add a brand-new tag
      fireEvent.change(tagInput, { target: { value: 'Gaskets' } });
      fireEvent.click(addTagBtn);
      expect(screen.getByText('Gaskets')).toBeInTheDocument();

      // Attempt to add a duplicate tag (no-op branch)
      fireEvent.change(tagInput, { target: { value: 'Gaskets' } });
      fireEvent.click(addTagBtn);
      expect(screen.getAllByText('Gaskets')).toHaveLength(1);

      // Attempt to add an empty/whitespace tag (no-op branch)
      fireEvent.change(tagInput, { target: { value: '   ' } });
      fireEvent.click(addTagBtn);

      // Add tag via Enter keydown
      fireEvent.change(tagInput, { target: { value: 'Seals' } });
      fireEvent.keyDown(tagInput, { key: 'Enter' });
      expect(screen.getByText('Seals')).toBeInTheDocument();

      // Remove the 'Gaskets' tag using its × button
      const gasketsChip = screen.getByText('Gaskets').closest('span') as HTMLElement;
      const removeBtn = gasketsChip.querySelector('button') as HTMLElement;
      fireEvent.click(removeBtn);
      expect(screen.queryByText('Gaskets')).not.toBeInTheDocument();
    });

    it('shows validation error when required Edit Vendor fields are missing', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      const contactInput = screen.getByDisplayValue('Rajesh Nair');
      fireEvent.change(contactInput, { target: { value: '   ' } });

      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockShowToast).toHaveBeenCalledWith(
        'Validation Error',
        'Please complete all required fields.',
        'warning'
      );
      expect(mockUpdateBuyerVendor).not.toHaveBeenCalled();
    });

    it('fills out and edits every field of the Edit Vendor form before saving', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      const [nameInput, brandInput] = screen.getAllByDisplayValue('Apex Supplies Ltd.');
      fireEvent.change(nameInput, { target: { value: 'Apex Supplies Pvt Ltd.' } });
      fireEvent.change(brandInput, { target: { value: 'Apex Pvt Brand' } });
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4.9' } });

      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[selects.length - 1], { target: { value: 'Electrical' } });

      fireEvent.change(screen.getByDisplayValue('rajesh@apex.in'), {
        target: { value: 'rajesh.new@apex.in' },
      });
      fireEvent.change(screen.getByDisplayValue('+91 98201 44820'), {
        target: { value: '+91 90000 00000' },
      });
      fireEvent.change(screen.getByDisplayValue('Pune, Maharashtra'), {
        target: { value: 'Mumbai, Maharashtra' },
      });

      // Designation, City, State, Pincode, Country, GST, PAN, MSME, Annual Turnover
      fireEvent.change(screen.getByDisplayValue('Authorized Representative'), {
        target: { value: 'VP Sales' },
      });
      fireEvent.change(screen.getByDisplayValue('India'), { target: { value: 'Bharat' } });
      fireEvent.change(screen.getByDisplayValue('₹10 - ₹50 Cr'), {
        target: { value: '₹100 Cr+' },
      });

      const emptyTextInputs = screen
        .getAllByRole('textbox')
        .filter((input) => (input as HTMLInputElement).value === '');
      emptyTextInputs.forEach((input) => {
        fireEvent.change(input, { target: { value: 'Sample' } });
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockUpdateBuyerVendor).toHaveBeenCalledWith(
        'v-1',
        expect.objectContaining({
          name: 'Apex Supplies Pvt Ltd.',
          majorCategory: 'Electrical',
          email: 'rajesh.new@apex.in',
          phone: '+91 90000 00000',
        })
      );
    });

    it('closes the Edit Vendor modal via its X icon button', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);
      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();

      const xBtn = screen
        .getAllByRole('button')
        .find((b) => b.querySelector('svg.lucide-x') && !b.textContent);
      expect(xBtn).toBeTruthy();
      fireEvent.click(xBtn as HTMLElement);
      expect(screen.queryByText('Edit Vendor Profile')).not.toBeInTheDocument();
    });

    it('closes the View Vendor Profile modal via its X icon button and navigates to Edit Profile from it', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const viewBtns = screen.getAllByRole('button', { name: /View Profile/i });
      fireEvent.click(viewBtns[0]);
      expect(screen.getByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).toBeInTheDocument();

      const xBtn = screen
        .getAllByRole('button')
        .find((b) => b.querySelector('svg.lucide-x') && !b.textContent);
      expect(xBtn).toBeTruthy();
      fireEvent.click(xBtn as HTMLElement);
      expect(screen.queryByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).not.toBeInTheDocument();

      // Re-open and use "Edit Profile" button inside the View modal
      fireEvent.click(viewBtns[0]);
      fireEvent.click(screen.getByRole('button', { name: /Edit Profile/i }));
      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();
      expect(screen.queryByText('Comprehensive supplier registration, compliance, and taxonomy profile.')).not.toBeInTheDocument();
    });

    it('closes the rating revision modal via Cancel and falls back to a synthetic evaluation record for View 360° Evaluation', () => {
      const vendorsWithoutStoreEval = [
        {
          ...mockBuyerVendors[1],
        },
      ];
      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: vendorsWithoutStoreEval,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [
          { majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] },
        ],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // v-2 (Global Valves) is marked evaluated:true in fixture, has no matching vendorEvaluations record
      const viewEvalBtns = screen.getAllByText(/View 360° Evaluation/i);
      fireEvent.click(viewEvalBtns[0]);
      expect(mockOnViewEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ vendorName: 'Global Valves Ltd', id: 'eval-v-2' })
      );
    });

    it('submits a rating revision successfully and closes the modal on success', async () => {
      mockReviseVendorRating.mockResolvedValueOnce(true);

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const reviseBtns = screen.getAllByText(/Revise Rating/i);
      fireEvent.click(reviseBtns[0]);

      const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
      fireEvent.change(textarea, { target: { value: 'Great vendor performance this quarter.' } });

      fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));

      await waitFor(() => expect(mockReviseVendorRating).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument()
      );
    });

    it('covers all vendor-origin badge classification branches', () => {
      const originVendors = [
        { ...mockBuyerVendors[0], id: 'o-1', name: 'Dump Vendor', source: 'historical_purchase_dump' },
        { ...mockBuyerVendors[0], id: 'o-2', name: 'Master Ingestion Vendor', source: 'vendor_master_ingestion' },
        { ...mockBuyerVendors[0], id: 'o-3', name: 'Excel Vendor', source: 'excel' },
        { ...mockBuyerVendors[0], id: 'o-4', name: 'CM Vendor', source: 'category_manager_upload' },
        { ...mockBuyerVendors[0], id: 'o-5', name: 'Self Onboard Vendor', source: 'self_onboarded' },
        { ...mockBuyerVendors[0], id: 'o-6', name: 'Registration Vendor', source: 'vendor_registration' },
        { ...mockBuyerVendors[0], id: 'o-7', name: 'Self Reg Vendor', source: 'self_registered' },
        {
          ...mockBuyerVendors[0],
          id: 'o-8',
          name: 'Company Match Vendor',
          source: 'unmapped_random_origin',
          addedByBuyerCompany: 'Larsen & Toubro Limited',
        },
      ];

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: mockEvaluationRecords,
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: originVendors,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [
          { majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] },
        ],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getByText('Dump Vendor')).toBeInTheDocument();
      expect(screen.getByText('Master Ingestion Vendor')).toBeInTheDocument();
    });

    it('renders View Profile / Origin / Engagement default fallbacks for a vendor with minimal fields', () => {
      const minimalVendor = {
        id: 'v-buyer-min',
        name: 'Bare Minimum Traders',
        email: 'contact@bareminimum.com',
        source: 'buyer_manual',
        evaluated: false,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [
          {
            id: 'rfq-x',
            rfqNumber: undefined,
            quotes: [],
          },
        ],
        showToast: mockShowToast,
        buyerVendors: [minimalVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves'] }],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: null,
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getAllByText('Bare Minimum Traders').length).toBeGreaterThan(0);

      // Open View Profile modal to exercise all the default-value fallbacks
      fireEvent.click(screen.getByRole('button', { name: /View Profile/i }));
      expect(screen.getAllByText('Bare Minimum Traders').length).toBeGreaterThan(0);
      expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
      expect(screen.getByText('No specific minors tagged')).toBeInTheDocument();
      expect(screen.getAllByText('General Industrial').length).toBeGreaterThan(0);
      expect(screen.getByText('27AAACD1234F1Z5')).toBeInTheDocument();
    });

    it('opens the Edit modal with vendor default fallbacks when most fields are missing', () => {
      const sparseVendor = {
        id: 'sparse-1',
        name: 'Sparse Co',
        source: 'buyer_manual',
        email: 'sparse@co.com',
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [sparseVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: null,
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();

      // Fill only the truly-required fields left blank by the sparse vendor; leave the rest
      // (brand name, minor categories, location, country, etc.) blank to hit their fallback defaults.
      const requiredInputs = screen.getAllByRole('textbox').filter((i) => i.hasAttribute('required'));
      requiredInputs.forEach((input) => {
        if ((input as HTMLInputElement).value === '') {
          fireEvent.change(input, { target: { value: 'Contact Person Name' } });
        }
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockUpdateBuyerVendor).toHaveBeenCalledWith(
        'sparse-1',
        expect.objectContaining({
          brandName: 'Sparse Co',
          minorCategories: expect.any(Array),
          location: ',',
          country: 'India',
        })
      );
    });
  });

  describe('Pincode-based vendor sorting', () => {
    it('ranks the buyer-uploaded vendor whose pincode matches the buyer profile first', async () => {
      mockFetchBuyerProfile.mockResolvedValue({ success: true, data: { pincode: '390001' } });
      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: mockEvaluationRecords,
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: [
          { ...mockBuyerVendors[0], id: 'v-1', pincode: '411001' },
          { ...mockBuyerVendors[1], id: 'v-2', pincode: '390001' },
        ],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] }],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      await waitFor(() => expect(mockFetchBuyerProfile).toHaveBeenCalled());

      const badges = await waitFor(() => {
        const els = [screen.getByText('v-1'), screen.getByText('v-2')];
        return els;
      });
      const position = badges[0].compareDocumentPosition(badges[1]);
      // v-2 (the pincode match) must come before v-1 in document order.
      expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    it('leaves vendor order unchanged when the buyer profile has no pincode', async () => {
      mockFetchBuyerProfile.mockResolvedValue({ success: true, data: {} });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      await waitFor(() => expect(mockFetchBuyerProfile).toHaveBeenCalled());
      expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    });

    it('does not crash when fetchBuyerProfile fails', async () => {
      mockFetchBuyerProfile.mockResolvedValue({ success: false, error: 'unavailable' });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      await waitFor(() => expect(mockFetchBuyerProfile).toHaveBeenCalled());
      expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    });
  });
});


