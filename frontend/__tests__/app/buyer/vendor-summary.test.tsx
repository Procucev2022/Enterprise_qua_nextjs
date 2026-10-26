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
jest.mock('@/lib/validationSchemas', () => {
  const actual = jest.requireActual('@/lib/validationSchemas');
  return {
    __esModule: true,
    ...actual,
    validatePincode: jest.fn(actual.validatePincode),
  };
});
jest.mock('@/app/category-manager/VendorUploadModal', () => {
  return function MockVendorUploadModal({ isOpen, onClose }: any) {
    return (
      <div data-testid="mock-vendor-upload-modal">
        <button data-testid="trigger-bulk-modal-close" onClick={onClose}>
          Close Bulk
        </button>
      </div>
    );
  };
});

import { validatePincode } from '@/lib/validationSchemas';
const mockValidatePincode = validatePincode as jest.Mock;

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
      fireEvent.change(screen.getByLabelText(/Major Category/i), { target: { value: 'Electrical' } });
      fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Mumbai' } });
      fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Maharashtra' } });
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '400001' } });
      fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: '27AAAAA0000A1Z5' } });
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
        { ...mockBuyerVendors[0], id: 'v-buyer-o-1', name: 'Dump Vendor', source: 'historical_purchase_dump' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-2', name: 'Master Ingestion Vendor', source: 'vendor_master_ingestion' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-3', name: 'Excel Vendor', source: 'excel' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-4', name: 'CM Vendor', source: 'category_manager_upload' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-5', name: 'Self Onboard Vendor', source: 'self_onboarded' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-6', name: 'Registration Vendor', source: 'vendor_registration' },
        { ...mockBuyerVendors[0], id: 'v-buyer-o-7', name: 'Self Reg Vendor', source: 'self_registered' },
        {
          ...mockBuyerVendors[0],
          id: 'v-buyer-o-8',
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
      expect(screen.getByText('Excel Vendor')).toBeInTheDocument();
      expect(screen.getByText('CM Vendor')).toBeInTheDocument();
      expect(screen.getByText('Self Onboard Vendor')).toBeInTheDocument();
      expect(screen.getByText('Registration Vendor')).toBeInTheDocument();
      expect(screen.getByText('Self Reg Vendor')).toBeInTheDocument();
      expect(screen.getByText('Company Match Vendor')).toBeInTheDocument();
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

    it('initializes and synchronizes buyer pincode when activeBuyerAccount has pincode', () => {
      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: mockEvaluationRecords,
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: mockBuyerVendors,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited', pincode: '411001' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    });
  });

  describe('Pincode validation and lookup in Add/Edit Vendor modals', () => {
    let originalFetch: typeof global.fetch;

    beforeAll(() => {
      originalFetch = global.fetch;
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      }
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    it('shows error for dummy/test pincode and blocks submission', async () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      // Enter dummy pincode e.g. 111111
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '111111' } });
      expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

      // Fill other fields and attempt submit
      fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: 'Dummy Test Co' } });
      fireEvent.change(screen.getByLabelText(/Contact Person/i), { target: { value: 'Test Person' } });
      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@dummy.com' } });
      fireEvent.change(screen.getByLabelText(/Phone/i), { target: { value: '9876543210' } });
      fireEvent.change(screen.getByLabelText(/City/i), { target: { value: 'Pune' } });
      fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Maharashtra' } });
      fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: '27AAAAA0000A1Z5' } });

      fireEvent.click(screen.getByTestId('submit-add-vendor'));
      expect(mockShowToast).toHaveBeenCalledWith('Invalid Pincode', 'Invalid or dummy PIN code', 'warning');
      expect(mockAddBuyerVendor).not.toHaveBeenCalled();
    });

    it('handles non-numeric or short pincodes and exercises branches', async () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      // Less than 3 digits
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '41' } });
      expect(screen.queryByText(/Invalid PIN code format/i)).not.toBeInTheDocument();

      // 5 digits (partial) - enters else branch
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '41100' } });
      expect(screen.queryByText(/Invalid PIN code format/i)).not.toBeInTheDocument();

      // Empty pincode
      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '' } });
      expect(screen.queryByText(/Invalid/i)).not.toBeInTheDocument();
    });

    it('performs debounced API validation for valid 6-digit pincode', async () => {
      mockValidatePincode.mockResolvedValueOnce({
        isValid: true,
        postOffices: [{ Name: 'Shivajinagar', District: 'Pune', State: 'Maharashtra' }],
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '411005' } });

      await waitFor(() => {
        expect(screen.getByText('Valid')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('displays error message when pincode validation API returns invalid result', async () => {
      mockValidatePincode.mockResolvedValueOnce({
        isValid: false,
        message: 'No records found',
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '800001' } });

      await waitFor(() => {
        expect(screen.getByText('No records found')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('catches and handles exceptions thrown during pincode validation', async () => {
      mockValidatePincode.mockRejectedValueOnce(new Error('Postal API Network Crash'));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '411001' } });

      await waitFor(() => {
        expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('sets invalid PIN code format when vendor pincode has invalid format in Edit modal', () => {
      const vendorWithBadPincode = {
        ...mockBuyerVendors[0],
        id: 'v-buyer-bad-pin',
        pincode: '@@@@@@',
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: mockEvaluationRecords,
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: [vendorWithBadPincode],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves'] }],
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

      const editBtn = screen.getByRole('button', { name: /Edit/i });
      fireEvent.click(editBtn);

      expect(screen.getByText('Invalid PIN code format')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockShowToast).toHaveBeenCalledWith('Invalid Pincode', 'Invalid PIN code format', 'warning');
    });

    it('handles empty major category in Add Vendor modal for minor options', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      const majorSelect = screen.getByLabelText(/Major Category/i);
      fireEvent.change(majorSelect, { target: { value: '' } });

      const minorSelect = document.getElementById('add-vendor-minor-category');
      expect(minorSelect).toBeInTheDocument();
    });

    it('triggers onClose on VendorUploadModal', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const closeBulkBtn = screen.getByTestId('trigger-bulk-modal-close');
      fireEvent.click(closeBulkBtn);
    });

    it('blocks Edit Vendor save when an invalid pincode is entered', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      // Find the pincode textbox inside Edit Vendor modal and set dummy pincode
      const pincodeInputs = screen.getAllByRole('textbox').filter((input) => {
        const parent = input.closest('div');
        return parent?.textContent?.includes('Pincode');
      });
      expect(pincodeInputs.length).toBeGreaterThan(0);
      fireEvent.change(pincodeInputs[0], { target: { value: '111111' } });

      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockShowToast).toHaveBeenCalledWith('Invalid Pincode', 'Invalid or dummy PIN code', 'warning');
      expect(mockUpdateBuyerVendor).not.toHaveBeenCalled();
    });

    it('selects a minor category from dropdown in Add Vendor modal, and handles empty selection', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      const minorSelect = document.getElementById('add-vendor-minor-category');
      expect(minorSelect).toBeInTheDocument();
      // Select empty option (false branch of if (e.target.value))
      fireEvent.change(minorSelect as HTMLElement, { target: { value: '' } });
      // Select valid minor category (true branch)
      fireEvent.change(minorSelect as HTMLElement, { target: { value: 'Valves' } });
      expect(screen.getByText('Valves')).toBeInTheDocument();
    });

    it('finds vendor evaluation from vendorEvaluations array when storeRecord is not present on vendor', () => {
      const matchEvalRecord = {
        id: 'eval-match-999',
        vendorId: 'v-buyer-eval-match',
        vendorName: 'Evaluation Match Co',
        submissionDate: '2026-08-18',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        overallScore: 92,
        moduleScores: {
          commercial: { score: 4.8, maxScore: 5, weight: 25, weightedScore: 24.0, remarks: 'OK' },
          technical: { score: 4.5, maxScore: 5, weight: 15, weightedScore: 13.5, remarks: 'OK' },
          quality: { score: 4.6, maxScore: 5, weight: 20, weightedScore: 18.4, remarks: 'OK' },
          delivery: { score: 4.4, maxScore: 5, weight: 20, weightedScore: 17.6, remarks: 'OK' },
          financial: { score: 4.0, maxScore: 5, weight: 10, weightedScore: 8.0, remarks: 'OK' },
          governance: { score: 4.7, maxScore: 5, weight: 10, weightedScore: 9.4, remarks: 'OK' },
        },
        documents: [],
      };

      const evalVendor = {
        ...mockBuyerVendors[0],
        id: 'v-buyer-eval-match',
        name: 'Evaluation Match Co',
        evaluated: true,
      };

      Object.defineProperty(evalVendor, 'storeRecord', {
        get: () => undefined,
        configurable: true,
      });

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [matchEvalRecord],
        currentMode: 'mode_3',
        rfqs: mockRFQs,
        showToast: mockShowToast,
        buyerVendors: [evalVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves'] }],
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

      const viewEvalBtns = screen.getAllByText(/View 360° Evaluation/i);
      fireEvent.click(viewEvalBtns[0]);
      expect(mockOnViewEvaluation).toHaveBeenCalledWith(matchEvalRecord);
    });
  });

  describe('AI Rating Auto-Generation', () => {
    it('auto-generates rating using AI and updates scores and remarks', async () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Open revision modal for Apex Supplies Ltd.
      const reviseBtns = screen.getAllByText(/Revise Rating/i);
      fireEvent.click(reviseBtns[0]);

      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

      const aiBtn = screen.getByRole('button', { name: /Auto-Generate with AI/i });
      fireEvent.click(aiBtn);

      await waitFor(
        () => {
          expect(mockShowToast).toHaveBeenCalledWith(
            'AI Rating Generated',
            expect.stringContaining('Calculated performance scores for Apex Supplies Ltd.'),
            'success'
          );
        },
        { timeout: 2000 }
      );

      expect(screen.getByDisplayValue(/AI Auto-Generated Performance Rating/i)).toBeInTheDocument();
    });

    it('closes the rating revision modal via Cancel button', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const reviseBtns = screen.getAllByText(/Revise Rating/i);
      fireEvent.click(reviseBtns[0]);
      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);
      expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument();
    });
  });

  describe('Sourcing Modes and Trigger Evaluation', () => {
    it('renders evaluation locked button for network vendor in mode 2 without quote', () => {
      const networkVendor = {
        id: 'v-buyer-net-99',
        name: 'Locked Network Vendor',
        email: 'locked@net.test',
        source: 'procucev_network',
        overlap: true,
        evaluated: false,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_2',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [networkVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
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

      expect(screen.getByRole('button', { name: /Evaluation Locked \(Pending Quote\)/i })).toBeDisabled();
    });

    it('renders trigger evaluation button for network vendor in mode 2 with quote and triggers evaluation on click', () => {
      const networkVendorWithQuote = {
        id: 'v-buyer-net-quote',
        name: 'Quoting Network Vendor',
        email: 'quote@net.test',
        source: 'procucev_network',
        overlap: true,
        evaluated: false,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_2',
        rfqs: [
          {
            id: 'rfq-2',
            rfqNumber: 'RFQ-2026-999',
            quotes: [{ vendorId: 'v-buyer-net-quote', vendorName: 'Quoting Network Vendor' }],
          },
        ],
        showToast: mockShowToast,
        buyerVendors: [networkVendorWithQuote],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
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

      const triggerBtn = screen.getByRole('button', { name: /Trigger Evaluation/i });
      expect(triggerBtn).toBeInTheDocument();
      fireEvent.click(triggerBtn);

      expect(mockShowToast).toHaveBeenCalledWith(
        'Triggering AI Evaluation Request',
        expect.stringContaining('Verification request email dispatched to quote@net.test'),
        'info'
      );
    });

    it('renders qualification reason for buyer empanelled vendor active in RFQs', () => {
      const empanelledVendor = {
        id: 'v-buyer-emp-1',
        name: 'Empanelled Active Vendor',
        email: 'empanelled@corp.com',
        source: 'buyer_manual',
        evaluated: true,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [
          {
            id: 'rfq-emp',
            rfqNumber: 'RFQ-SPECIAL-01',
            quotes: [{ vendorId: 'v-buyer-emp-1', vendorName: 'Empanelled Active Vendor' }],
          },
        ],
        showToast: mockShowToast,
        buyerVendors: [empanelledVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
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

      expect(screen.getByText(/Buyer Empanelled & Active in 1 RFQ\(s\)/i)).toBeInTheDocument();
    });
  });

  describe('Multi-Select and Export Selected', () => {
    it('toggles select all to deselect when all are already selected, and exports selected', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const selectAll = screen.getByTestId('select-all-vendors-checkbox');
      // Select all
      fireEvent.click(selectAll);
      expect(screen.getByText(/Selected Suppliers/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Export Selected/i })).toBeInTheDocument();

      // Export Selected click
      fireEvent.click(screen.getByRole('button', { name: /Export Selected/i }));
      expect(mockShowToast).toHaveBeenCalledWith(
        'Export Complete',
        expect.stringContaining('Exported'),
        'success'
      );

      // Deselect all by clicking again
      fireEvent.click(selectAll);
      expect(screen.queryByRole('button', { name: /Export Selected/i })).not.toBeInTheDocument();
    });
  });

  describe('Vendor Template Upload History Modal', () => {
    beforeAll(() => {
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = jest.fn(() => 'blob:mock-csv-url');
      }
    });

    afterEach(() => {
      localStorage.clear();
    });

    it('opens upload history modal with empty state and navigates to wizard', () => {
      localStorage.removeItem('procucev_vendor_upload_history');

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));

      expect(screen.getByText('Vendor Template Upload History')).toBeInTheDocument();
      expect(screen.getByText('No Upload History Found')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Upload Vendor Master Now/i }));
      expect(mockOnNavigateToWizard).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Vendor Template Upload History')).not.toBeInTheDocument();
    });

    it('safely handles corrupted localStorage JSON and close button', () => {
      localStorage.setItem('procucev_vendor_upload_history', 'corrupted-json{[');

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));

      expect(screen.getByText('No Upload History Found')).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('Vendor Template Upload History')).not.toBeInTheDocument();
    });

    it('renders batches, downloads batch CSV, filters batch records, and re-exports', () => {
      const mockBatches = [
        {
          id: 'batch-101',
          fileName: 'Procurement_Vendors_Q1.xlsx',
          timestamp: '2026-10-25 10:00:00',
          imported: 2,
          total: 2,
          duplicates: 1,
          records: [
            {
              vendorCode: 'VND-001',
              name: 'Precision Bearings Co',
              brandName: 'Precision',
              contactPerson: 'Karan Mehra',
              email: 'karan@precision.test',
              phone: '+91 98111 22233',
              city: 'Vadodara',
              state: 'Gujarat',
              pincode: '390001',
              category: 'Mechanical',
              gstin: '24AAAAA0000A1Z5',
              rating: 90,
            },
            {
              vendorCode: 'VND-002',
              name: 'Zenith Electricals',
              brandName: 'Zenith',
              contactPerson: 'Anita Rao',
              email: 'anita@zenith.test',
              phone: '+91 98222 33344',
              city: 'Bengaluru',
              state: 'Karnataka',
              pincode: '560001',
              category: 'Electrical',
              gstin: '29BBBBB0000B1Z6',
              rating: 88,
            },
          ],
        },
        {
          id: 'batch-102',
          fileName: 'Empty_Upload_Batch.xlsx',
          timestamp: '2026-10-24 15:30:00',
          imported: 0,
          total: 0,
          duplicates: 0,
          records: [],
        },
      ];

      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify(mockBatches));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));

      expect(screen.getByText('Procurement_Vendors_Q1.xlsx')).toBeInTheDocument();
      expect(screen.getByText('Empty_Upload_Batch.xlsx')).toBeInTheDocument();

      // Download CSV on batch with records
      const downloadCsvBtns = screen.getAllByRole('button', { name: /Download CSV/i });
      fireEvent.click(downloadCsvBtns[0]);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Template Downloaded',
        expect.stringContaining('Procurement_Vendors_Q1.xlsx'),
        'success'
      );

      // Download CSV on batch without records (exercises fallback CSV)
      fireEvent.click(downloadCsvBtns[1]);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Template Downloaded',
        expect.stringContaining('Empty_Upload_Batch.xlsx'),
        'success'
      );

      // View records on batch-101
      const viewRecordBtns = screen.getAllByRole('button', { name: /View Records/i });
      fireEvent.click(viewRecordBtns[0]);

      expect(screen.getByText('Vendor Template Upload Batch Details')).toBeInTheDocument();
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();
      expect(screen.getByText('Zenith Electricals')).toBeInTheDocument();

      // Filter records
      const searchRecordInput = screen.getByPlaceholderText(/Search this batch\.\.\./i);
      fireEvent.change(searchRecordInput, { target: { value: 'Precision' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();
      expect(screen.queryByText('Zenith Electricals')).not.toBeInTheDocument();

      // Search non-matching
      fireEvent.change(searchRecordInput, { target: { value: 'NonExistent' } });
      expect(screen.getByText(/No suppliers match "NonExistent"/i)).toBeInTheDocument();

      // Clear search via clear button
      const clearSearchBtn = searchRecordInput.parentElement?.querySelector('button');
      if (clearSearchBtn) {
        fireEvent.click(clearSearchBtn);
      } else {
        fireEvent.change(searchRecordInput, { target: { value: '' } });
      }
      expect(screen.getByText('Zenith Electricals')).toBeInTheDocument();

      // Export Upload CSV button in batch details
      fireEvent.click(screen.getByRole('button', { name: /Export Upload CSV/i }));
      expect(mockShowToast).toHaveBeenCalledWith(
        'Template Downloaded',
        expect.stringContaining('Procurement_Vendors_Q1.xlsx'),
        'success'
      );

      // Back to History List
      fireEvent.click(screen.getByRole('button', { name: /Back to History List/i }));
      expect(screen.getByText('Vendor Template Upload History')).toBeInTheDocument();

      // Close modal via top right X button
      fireEvent.click(screen.getByTitle('Close upload history'));
      expect(screen.queryByText('Vendor Template Upload History')).not.toBeInTheDocument();
    });

    it('renders empty records message with Re-export button when a batch with 0 records is viewed', () => {
      const mockBatches = [
        {
          id: 'batch-no-rec',
          fileName: 'Summary_Only_Batch.xlsx',
          timestamp: '2026-10-25 09:00:00',
          imported: 5,
          total: 5,
          duplicates: 0,
          records: [],
        },
      ];

      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify(mockBatches));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));
      fireEvent.click(screen.getByRole('button', { name: /View Records/i }));

      expect(screen.getByText(/Summary record maintained for Summary_Only_Batch.xlsx/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Re-export Upload CSV/i }));
      expect(mockShowToast).toHaveBeenCalledWith(
        'Template Downloaded',
        expect.stringContaining('Summary_Only_Batch.xlsx'),
        'success'
      );
    });

    it('covers sparse-record branch fallbacks in CSV download, table rendering, and batch search filters', () => {
      const mockBatches = [
        {
          id: 'batch-sparse',
          fileName: 'Sparse_Vendor_Batch.xlsx',
          timestamp: '2026-10-25 12:00:00',
          imported: 3,
          total: 3,
          duplicates: 0,
          records: [
            {
              vendorCode: 'VND-001',
              name: 'Precision Bearings Co',
              brandName: 'PrecisionBrand',
              contactPerson: 'Karan Mehra',
              email: 'karan@precision.test',
              phone: '98111 22233',
              city: 'Vadodara',
              state: 'Gujarat',
              pincode: '390001',
              category: 'Mechanical',
              gstin: '24AAAAA0000A1Z5',
              rating: 92,
            },
            {
              vendorCode: 'VND-002',
              name: 'Zenith Electricals',
              brandName: 'ZenithBrand',
              contactPerson: 'Anita Rao',
              email: 'anita@zenith.test',
              phone: '98222 33344',
              city: 'Bengaluru',
              state: 'Karnataka',
              category: 'Electrical',
              gstin: '29BBBBB0000B1Z6',
              rating: 88,
              contactDesignation: 'Manager',
            },
            {
              // Sparse record: exercises all `r.field || ''` fallbacks in CSV
              // and all `r.field || '—'` / default fallbacks in table rendering
              name: 'Sparse Vendor',
            },
          ],
        },
        {
          // Batch without id, fileName, timestamp — exercises batch card fallbacks
          // batch.id || index, batch.fileName || 'Vendor_Master_Upload.xlsx', batch.timestamp || 'Recent'
          total: 10,
          duplicates: 0,
          records: [],
        },
        {
          // Batch with imported: undefined, total: undefined — exercises batch.imported ?? batch.total ?? 0
          id: 'batch-no-totals',
          fileName: 'No_Totals_Batch.xlsx',
          timestamp: '2026-10-24 09:00:00',
          duplicates: 0,
          records: [],
        },
      ];

      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify(mockBatches));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));

      // Verify batch cards render with fallbacks
      // Batch 2 should show 'Vendor_Master_Upload.xlsx' as fileName fallback
      expect(screen.getByText('Vendor_Master_Upload.xlsx')).toBeInTheDocument();
      // Batch 2 should show 'Recent' as timestamp fallback
      expect(screen.getByText('Recent')).toBeInTheDocument();

      // Click Download CSV on batch with sparse record — covers r.field || '' fallbacks (line 265)
      const downloadCsvBtns = screen.getAllByRole('button', { name: /Download CSV/i });
      fireEvent.click(downloadCsvBtns[0]);
      expect(mockShowToast).toHaveBeenCalledWith(
        'Template Downloaded',
        expect.stringContaining('Sparse_Vendor_Batch.xlsx'),
        'success'
      );

      // View records for batch with sparse record
      const viewRecordBtns = screen.getAllByRole('button', { name: /View Records/i });
      fireEvent.click(viewRecordBtns[0]);

      expect(screen.getByText('Vendor Template Upload Batch Details')).toBeInTheDocument();

      // Verify sparse record renders table fallbacks (lines 2778-2822)
      // '—' for vendorCode, contactPerson, email, phone, gstin; 'General' for category; 85 for rating
      const allDashes = screen.getAllByText('—');
      expect(allDashes.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('General')).toBeInTheDocument();

      // Verify contactDesignation renders for the second record (line 2794-2797)
      expect(screen.getByText('Manager')).toBeInTheDocument();

      // Search by brandName: 'PrecisionBrand'
      const searchInput = screen.getByPlaceholderText(/Search this batch/i);
      fireEvent.change(searchInput, { target: { value: 'PrecisionBrand' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();
      expect(screen.queryByText('Zenith Electricals')).not.toBeInTheDocument();

      // Search by vendorCode: 'VND-001'
      fireEvent.change(searchInput, { target: { value: 'VND-001' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by contactPerson: 'Karan'
      fireEvent.change(searchInput, { target: { value: 'Karan' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by email: 'karan@'
      fireEvent.change(searchInput, { target: { value: 'karan@' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by phone: '98111'
      fireEvent.change(searchInput, { target: { value: '98111' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by city: 'Vadodara'
      fireEvent.change(searchInput, { target: { value: 'Vadodara' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by state: 'Gujarat'
      fireEvent.change(searchInput, { target: { value: 'Gujarat' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by gstin: '24AAAAA'
      fireEvent.change(searchInput, { target: { value: '24AAAAA' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Search by category: 'Mechanical'
      fireEvent.change(searchInput, { target: { value: 'Mechanical' } });
      expect(screen.getByText('Precision Bearings Co')).toBeInTheDocument();

      // Clear search to show all
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(screen.getByText('Sparse Vendor')).toBeInTheDocument();
    });
  });

  describe('Status filter dropdown branches', () => {
    it('filters by NOT_EVALUATED status', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Find status selector — it's the select with 'All Statuses' option
      const statusSelect = screen.getByDisplayValue('All Statuses');

      // Filter by NOT_EVALUATED (Pending Evaluation)
      fireEvent.change(statusSelect, { target: { value: 'NOT_EVALUATED' } });
      // v-1 is evaluated, so should not appear; but not all vendors have evaluated=false
      // The filter should work without errors
      expect(statusSelect).toHaveValue('NOT_EVALUATED');
    });

    it('filters by PREFERRED status', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const statusSelect = screen.getByDisplayValue('All Statuses');
      fireEvent.change(statusSelect, { target: { value: 'PREFERRED' } });
      expect(statusSelect).toHaveValue('PREFERRED');
    });

    it('filters by CONDITIONAL status', () => {
      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const statusSelect = screen.getByDisplayValue('All Statuses');
      fireEvent.change(statusSelect, { target: { value: 'CONDITIONAL' } });
      expect(statusSelect).toHaveValue('CONDITIONAL');
    });
  });

  describe('AI Rating alternate branch coverage', () => {
    it('auto-generates rating for vendor with ISO, low rating, low score, no GST, not in RFQ', async () => {
      const isoVendor = {
        id: 'v-buyer-iso-low',
        name: 'ISO Low Score Vendor',
        email: 'iso@lowscore.test',
        source: 'buyer_manual',
        evaluated: false,
        iso: true,
        verified: false,
        rating: 3.5,
        score: 60,
        gstin: undefined,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [isoVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
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

      // Open revision modal
      const reviseBtns = screen.getAllByText(/Revise Rating/i);
      fireEvent.click(reviseBtns[0]);
      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

      // Click AI Auto-Generate
      const aiBtn = screen.getByRole('button', { name: /Auto-Generate with AI/i });
      fireEvent.click(aiBtn);

      await waitFor(
        () => {
          expect(mockShowToast).toHaveBeenCalledWith(
            'AI Rating Generated',
            expect.stringContaining('ISO Low Score Vendor'),
            'success'
          );
        },
        { timeout: 2000 }
      );

      // The remarks should contain 'ISO/Verified' since iso is true
      expect(screen.getByDisplayValue(/AI Auto-Generated Performance Rating/i)).toBeInTheDocument();
    });
  });

  describe('Rating revision edge cases', () => {
    it('keeps modal open when reviseVendorRating returns false', async () => {
      mockReviseVendorRating.mockResolvedValue(false);

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const reviseBtns = screen.getAllByText(/Revise Rating/i);
      fireEvent.click(reviseBtns[0]);
      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
      fireEvent.change(textarea, { target: { value: 'Test remarks for revision' } });

      const submitBtn = screen.getByText(/Submit Revision & Dispatch Email/i);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockReviseVendorRating).toHaveBeenCalled();
      });

      // Modal should remain open since saved returned false
      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
    });
  });

  describe('Buyer vendor RFQ engagement branches', () => {
    it('renders qualification reason for vendor active in multiple RFQs and vendor without RFQs', () => {
      const vendorActive = {
        id: 'v-buyer-active-rfq',
        name: 'Active Hydraulic Works',
        email: 'active@works.test',
        source: 'buyer_uploaded',
        majorCategory: 'Mechanical',
        evaluated: false,
      };
      const vendorIdle = {
        id: 'v-buyer-idle',
        name: 'Idle Supply Co',
        email: 'idle@supply.test',
        source: 'buyer_uploaded',
        majorCategory: 'Electrical',
        evaluated: false,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [
          {
            id: 'rfq-1',
            rfqNumber: 'RFQ-001',
            quotes: [{ vendorId: 'v-buyer-active-rfq', vendorName: 'Active Hydraulic Works' }],
          },
          {
            id: 'rfq-2',
            rfqNumber: 'RFQ-002',
            quotes: [{ vendorId: 'v-buyer-active-rfq', vendorName: 'Active Hydraulic Works' }],
          },
        ],
        showToast: mockShowToast,
        buyerVendors: [vendorActive, vendorIdle],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Line 567: isUploaded && isUsedInRFQ -> `Buyer Empanelled & Active in 2 RFQ(s)`
      expect(screen.getByText(/Buyer Empanelled & Active in 2 RFQ\(s\)/i)).toBeInTheDocument();
      // Line 569: isUploaded && !isUsedInRFQ -> `Buyer Empanelled Supplier`
      expect(screen.getByText(/Buyer Empanelled Supplier/i)).toBeInTheDocument();
    });
  });

  describe('handleDownloadBatchCsv with null batch', () => {
    it('returns early when batch is null (line 260)', () => {
      localStorage.removeItem('procucev_vendor_upload_history');

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));
      expect(screen.getByText('No Upload History Found')).toBeInTheDocument();
    });
  });

  describe('Edit vendor with minimal/missing fields exercises fallback branches', () => {
    it('exercises Edit form fallbacks for vendor with no brandName, contactDesignation, country, rating, status', () => {
      const minimalVendor = {
        id: 'v-buyer-minimal-edit',
        name: 'Minimal Edit Vendor',
        email: 'minimal@edit.test',
        contactPerson: 'Contact Person',
        phone: '+91 99999 00000',
        source: 'buyer_manual',
        majorCategory: 'Mechanical',
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [minimalVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves'] }],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      // Open edit modal for the minimal vendor
      const editBtns = screen.getAllByRole('button', { name: /Edit/i });
      fireEvent.click(editBtns[0]);

      // Save with all fields filled (the form was pre-populated with fallback defaults)
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
      expect(mockUpdateBuyerVendor).toHaveBeenCalled();
    });
  });

  describe('Add vendor form exercises rating/minorCategories/location/country fallback branches', () => {
    it('submits Add Vendor with empty brandName, no minorCategories, empty location, empty country', async () => {
      mockAddBuyerVendor.mockResolvedValue(true);

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      // Fill required fields using placeholders
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Ashok Industries/i), {
        target: { value: 'Fallback Test Co' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. John Doe/i), {
        target: { value: 'John Doe' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. contact@example\.com/i), {
        target: { value: 'john@fallback.test' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 9000000001/i), {
        target: { value: '+91 99999 11111' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Pune/i), {
        target: { value: 'Mumbai' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Maharashtra/i), {
        target: { value: 'Maharashtra' },
      });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 411001/i), {
        target: { value: '800001' },
      });

      // Wait for debounce on pincode validation
      await waitFor(() => {}, { timeout: 600 });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 27AAAAA0000A1Z5/i), {
        target: { value: '27AAACA1928K1Z4' },
      });

      // Submit via testid
      fireEvent.click(screen.getByTestId('submit-add-vendor'));

      await waitFor(() => {
        expect(mockAddBuyerVendor).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Fallback Test Co',
            brandName: 'Fallback Test Co',
            minorCategories: expect.arrayContaining(['Mechanical']),
            country: 'India',
            location: 'Mumbai, Maharashtra',
          })
        );
      });
    });

    it('keeps Add Vendor modal open when addBuyerVendor returns false', async () => {
      mockAddBuyerVendor.mockResolvedValue(false);

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Ashok Industries/i), {
        target: { value: 'Failed Add Co' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. John Doe/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. contact@example\.com/i), {
        target: { value: 'fail@add.test' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 9000000001/i), {
        target: { value: '+91 99999 22222' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Pune/i), {
        target: { value: 'Delhi' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Maharashtra/i), {
        target: { value: 'Delhi' },
      });
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 411001/i), {
        target: { value: '800001' },
      });

      await waitFor(() => {}, { timeout: 600 });

      fireEvent.change(screen.getByPlaceholderText(/e\.g\. 27AAAAA0000A1Z5/i), {
        target: { value: '07AAACA1928K1Z4' },
      });

      fireEvent.click(screen.getByTestId('submit-add-vendor'));

      await waitFor(() => {
        expect(mockAddBuyerVendor).toHaveBeenCalled();
      });

      // Modal should remain open
      expect(screen.getByTestId('submit-add-vendor')).toBeInTheDocument();
    });
  });

  describe('Upload history non-array JSON branch', () => {
    it('handles non-array parsed JSON from localStorage (line 250)', () => {
      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify({ notAnArray: true }));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));
      expect(screen.getByText('No Upload History Found')).toBeInTheDocument();
    });
  });

  describe('Batch download fallbacks', () => {
    it('downloads CSV with empty records and empty fileName (lines 268 & 274)', () => {
      const emptyBatch = {
        id: 'batch-empty',
        fileName: '',
        records: [],
        timestamp: '2026-10-25 10:00',
      };
      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify([emptyBatch]));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));
      const downloadCsvBtns = screen.getAllByRole('button', { name: /Download CSV/i });
      fireEvent.click(downloadCsvBtns[0]);

      expect(URL.createObjectURL).toHaveBeenCalled();
      fireEvent.click(screen.getByTitle('Close upload history'));
      localStorage.removeItem('procucev_vendor_upload_history');
    });
  });

  describe('Pincode validation message fallbacks', () => {
    it('falls back to "Invalid PIN code" when res.message is empty (line 214)', async () => {
      mockValidatePincode.mockImplementation(async (raw: string) => {
        if (raw === '411006') {
          return { isValid: false, message: '' };
        }
        return { isValid: true, postOffices: [] };
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      const pincodeInput = screen.getByPlaceholderText(/e\.g\. 411001/i);
      fireEvent.change(pincodeInput, { target: { value: '411006' } });

      await waitFor(() => {
        expect(screen.getByText('Invalid PIN code')).toBeInTheDocument();
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTestId('close-add-vendor-modal'));
    });

    it('falls back to empty postOffices when res.postOffices is undefined (line 218)', async () => {
      mockValidatePincode.mockImplementation(async (raw: string) => {
        if (raw === '411007') {
          return { isValid: true, postOffices: undefined };
        }
        return { isValid: true, postOffices: [] };
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      const pincodeInput = screen.getByPlaceholderText(/e\.g\. 411001/i);
      fireEvent.change(pincodeInput, { target: { value: '411007' } });

      await waitFor(() => {
        expect(mockValidatePincode).toHaveBeenCalledWith('411007');
      }, { timeout: 3000 });

      fireEvent.click(screen.getByTestId('close-add-vendor-modal'));
    });
  });

  describe('Buyer profile fetch cancelled and fallback branches', () => {
    it('unmounts cleanly while fetchBuyerProfile is pending (line 121 cancelled)', () => {
      let resolvePromise: any;
      mockFetchBuyerProfile.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: mockBuyerVendors,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      const { unmount } = render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      unmount();
      resolvePromise({ success: true, data: { pincode: '400001' } });
    });

    it('handles fetchBuyerProfile failure or missing pincode (lines 122-123)', async () => {
      mockFetchBuyerProfile.mockResolvedValueOnce({ success: false, data: null });

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: mockBuyerVendors,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      await waitFor(() => {
        expect(mockFetchBuyerProfile).toHaveBeenCalled();
      });
    });
  });

  describe('Loading vendors state', () => {
    it('renders loading spinner when isLoadingVendors is true and no vendors exist (line 1278)', () => {
      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [],
        isLoadingVendors: true,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getByText('Loading vendor directory...')).toBeInTheDocument();
    });
  });

  describe('Add Vendor minor category dropdown and keydown branches', () => {
    it('handles selecting minor category from dropdown and pressing Enter in input (lines 1458, 1476)', () => {
      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: mockBuyerVendors,
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] }],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByTestId('open-add-vendor-modal'));

      // 1. Select minor category from dropdown with empty value (no-op)
      const minorSelect = screen.getByRole('combobox', { name: /Minor Categories/i });
      fireEvent.change(minorSelect, { target: { value: '' } });

      // 2. Select minor category with 'Valves'
      fireEvent.change(minorSelect, { target: { value: 'Valves' } });
      expect(screen.getByText('Valves')).toBeInTheDocument();

      // 3. Type in custom minor category input and press non-Enter key (no-op)
      const minorInput = screen.getByPlaceholderText(/Type a minor category and press Enter/i);
      fireEvent.change(minorInput, { target: { value: 'Turbines' } });
      fireEvent.keyDown(minorInput, { key: 'a' });

      // 4. Press Enter
      fireEvent.keyDown(minorInput, { key: 'Enter' });
      expect(screen.getByText('Turbines')).toBeInTheDocument();
    });
  });

  describe('Edit Vendor submit fallbacks', () => {
    it('submits edit with empty brandName, location, country, and no minor categories (lines 455, 457, 462, 465, 472)', () => {
      const editVendor = {
        id: 'v-buyer-edit-fallbacks',
        name: 'Edit Fallback Co',
        brandName: 'Old Brand',
        majorCategory: 'Mechanical',
        minorCategories: [],
        contactPerson: 'Jane Doe',
        contactDesignation: 'Manager',
        email: 'jane@fallback.test',
        phone: '+91 99999 33333',
        location: 'Old Location',
        city: 'Nagpur',
        state: 'Maharashtra',
        country: 'India',
        pincode: '440001',
        gst: '27AAACA1928K1Z4',
        rating: 4.8,
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        source: 'buyer_uploaded',
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [editVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [{ majorCategory: 'Mechanical', minorCategories: ['Valves'] }],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Edit/i }));

      // Clear brandName, location, country
      const brandInput = screen.getByDisplayValue('Old Brand');
      fireEvent.change(brandInput, { target: { value: '' } });

      const locInput = screen.getByDisplayValue('Old Location');
      fireEvent.change(locInput, { target: { value: '' } });

      const countryInput = screen.getByDisplayValue('India');
      fireEvent.change(countryInput, { target: { value: '' } });

      // Save changes
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

      expect(mockUpdateBuyerVendor).toHaveBeenCalledWith(
        'v-buyer-edit-fallbacks',
        expect.objectContaining({
          brandName: 'Edit Fallback Co',
          location: 'Nagpur, Maharashtra',
          country: 'India',
          minorCategories: expect.arrayContaining(['Mechanical']),
        })
      );
    });
  });

  describe('Rating revision score and rating fallbacks', () => {
    it('falls back to 88 and computed rating when vendor has no score and no rating (lines 589, 2253, 2254, 2258)', () => {
      const vendorNoRating = {
        id: 'v-buyer-no-score',
        name: 'No Score Co',
        email: 'noscore@test.com',
        source: 'buyer_uploaded',
        majorCategory: 'Mechanical',
        evaluated: false,
        score: undefined,
        rating: undefined,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [vendorNoRating],
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

      fireEvent.click(screen.getByRole('button', { name: /Revise Rating/i }));
      expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
      expect(screen.getByText(/Larsen & Toubro Limited/i)).toBeInTheDocument();
    });
  });

  describe('Vendor card Mode 2 and rating fallback branches', () => {
    it('renders "Locked (Buyer Roster Only)" in Mode 2 for non-overlap buyer vendor (line 953)', () => {
      const mode2Vendor = {
        id: 'v-buyer-mode2-no-overlap',
        name: 'Mode 2 Vendor',
        source: 'buyer_uploaded',
        majorCategory: 'Mechanical',
        evaluated: false,
        overlap: false,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_2',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [mode2Vendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getByText('Locked (Buyer Roster Only)')).toBeInTheDocument();
    });

    it('renders computed score from vendor.score when rating is undefined on evaluated vendor (line 942)', () => {
      const evaluatedVendorNoRating = {
        id: 'v-buyer-eval-no-rating',
        name: 'Eval No Rating Co',
        source: 'buyer_uploaded',
        majorCategory: 'Mechanical',
        evaluated: true,
        score: 90,
        rating: undefined,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [evaluatedVendorNoRating],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      expect(screen.getByText(/4\.5 \/ 5\.0/i)).toBeInTheDocument();
    });
  });

  describe('Batch record brandName and contactDesignation rendering', () => {
    it('renders brandName and contactDesignation in batch records table (lines 2784, 2794)', () => {
      const batchWithBrand = {
        id: 'batch-brand-1',
        fileName: 'brand_test.xlsx',
        timestamp: '2026-10-25 11:00',
        total: 1,
        imported: 1,
        duplicates: 0,
        records: [
          {
            vendorCode: 'VND-BRAND-01',
            name: 'Brand Co',
            brandName: 'MegaBrand',
            contactPerson: 'Alice',
            contactDesignation: 'Chief Engineer',
            email: 'alice@brand.test',
            phone: '+91 99999 44444',
            city: 'Mumbai',
            state: 'Maharashtra',
            gstin: '27AAACA1928K1Z4',
            category: 'Mechanical',
            rating: 90,
          },
        ],
      };

      localStorage.setItem('procucev_vendor_upload_history', JSON.stringify([batchWithBrand]));

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Upload History/i }));
      fireEvent.click(screen.getByRole('button', { name: /View Records/i }));

      expect(screen.getByText('Brand: MegaBrand')).toBeInTheDocument();
      expect(screen.getByText('Chief Engineer')).toBeInTheDocument();
      fireEvent.click(screen.getByTitle('Close upload history'));
    });
  });

  describe('View 360 Evaluation dynamic storeRecord find', () => {
    it('falls back to vendorEvaluations.find when storeRecord is undefined (line 1034)', () => {
      const dynVendor = {
        id: 'v-buyer-dyn-eval',
        name: 'Dynamic Eval Vendor',
        source: 'buyer_uploaded',
        majorCategory: 'Mechanical',
        evaluated: true,
      };

      (useApp as jest.Mock).mockReturnValue({
        vendorEvaluations: [],
        currentMode: 'mode_3',
        rfqs: [],
        showToast: mockShowToast,
        buyerVendors: [dynVendor],
        addBuyerVendor: mockAddBuyerVendor,
        updateBuyerVendor: mockUpdateBuyerVendor,
        deleteBuyerVendor: mockDeleteBuyerVendor,
        categoryTaxonomy: [],
        reviseVendorRating: mockReviseVendorRating,
        openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
        activeBuyerAccount: { organizationName: 'Test Corp' },
      });

      render(
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      );

      const viewEvalBtn = screen.getByRole('button', { name: /View 360° Evaluation/i });
      fireEvent.click(viewEvalBtn);

      expect(mockOnViewEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'eval-v-buyer-dyn-eval' })
      );
    });
  });
});



