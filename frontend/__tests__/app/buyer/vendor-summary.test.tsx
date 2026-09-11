import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorSummary, { isBuyerUploaded, isProcucevVendor } from '@/app/buyer/vendor-summary';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

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

  it('renders two tabs: Uploaded by Buyer and Procucev Vendors', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    expect(screen.getByText('Vendor Directory & Summary')).toBeInTheDocument();

    // Verify tab buttons
    const buyerTabBtn = screen.getByRole('button', { name: /Uploaded by Buyer/i });
    expect(buyerTabBtn).toBeInTheDocument();

    const procucevTabBtn = screen.getByRole('button', { name: /Procucev Vendors/i });
    expect(procucevTabBtn).toBeInTheDocument();

    // In default BUYER_UPLOADED tab:
    expect(screen.getByText(/Vendors added through Buyer Initial Setup/i)).toBeInTheDocument();
  });

  it('handles tab switches between Uploaded by Buyer and Procucev Vendors', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Initial BUYER_UPLOADED state: buyer vendors present
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.queryByText('TechnoForce Electricals Ltd')).not.toBeInTheDocument();

    // Click "Procucev Vendors" tab button
    const procucevTabBtn = screen.getByRole('button', { name: /Procucev Vendors/i });
    fireEvent.click(procucevTabBtn);

    expect(screen.queryByText('Apex Supplies Ltd.')).not.toBeInTheDocument();
    expect(screen.getByText('TechnoForce Electricals Ltd')).toBeInTheDocument();

    // Click "Uploaded by Buyer" tab button
    const buyerTabBtn = screen.getByRole('button', { name: /Uploaded by Buyer/i });
    fireEvent.click(buyerTabBtn);

    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.queryByText('TechnoForce Electricals Ltd')).not.toBeInTheDocument();
  });

  it('renders stats counters, vendor cards, and handles search & filters', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    expect(screen.getByText('Vendor Directory & Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Registered')).toBeInTheDocument();
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
    expect(screen.queryByText('TechnoForce Electricals Ltd')).not.toBeInTheDocument();

    fireEvent.change(selects[0], { target: { value: 'ALL' } });

    // Status filter: EVALUATED
    fireEvent.change(selects[1], { target: { value: 'EVALUATED' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Switch to Procucev Vendors tab to test NOT_EVALUATED
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
    fireEvent.change(selects[1], { target: { value: 'NOT_EVALUATED' } });
    expect(screen.getByText('TechnoForce Electricals Ltd')).toBeInTheDocument();

    // Switch back to Uploaded by Buyer tab
    fireEvent.click(screen.getByRole('button', { name: /Uploaded by Buyer/i }));

    // Status filter: PREFERRED
    fireEvent.change(selects[1], { target: { value: 'PREFERRED' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Status filter: CONDITIONAL
    fireEvent.change(selects[1], { target: { value: 'CONDITIONAL' } });
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

    // Search with no results
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-12345' } });
    expect(screen.getByText(/No buyer-uploaded vendors match the selected filters/i)).toBeInTheDocument();
  });

  it('handles viewing 360° evaluation report and triggering AI evaluation request', () => {
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

    // Trigger evaluation on non-evaluated vendor in Mode 3 (in Procucev Vendors tab)
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
    const triggerBtns = screen.getAllByText(/Trigger Evaluation/i);
    fireEvent.click(triggerBtns[0]);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Triggering AI Evaluation Request',
      expect.stringContaining('Verification request email dispatched'),
      'info'
    );
  });

  it('handles rating revision modal workflow for vendor with and without prior revision', () => {
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

    // 3. Click Revise Rating for HydraFlow Systems (net-5, network vendor active in RFQ, in Procucev tab)
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
    const procucevReviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(procucevReviseBtns[0]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

    // Test X close button
    const xBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument();

    // Click View Dispatched Email Notice (switch to buyer tab where Apex is)
    fireEvent.click(screen.getByRole('button', { name: /Uploaded by Buyer/i }));
    fireEvent.click(screen.getByText(/View Dispatched Email Notice/i));
    expect(mockOpenRatingRevisionEmailModal).toHaveBeenCalled();
  });

  it('handles locked rating revision on unengaged vendors and empty remarks warning', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Switch to Procucev tab to find locked vendor net-4
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));

    // Click locked rating button on unengaged vendor (net-4)
    const lockedBtn = screen.getByText(/Rating Locked/i);
    fireEvent.click(lockedBtn);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Rating Revision Locked',
      expect.stringContaining('neither been used in any of your RFQs nor uploaded'),
      'warning'
    );

    // Switch back to buyer tab, open revision on engaged vendor and try submitting with empty remarks
    fireEvent.click(screen.getByRole('button', { name: /Uploaded by Buyer/i }));
    const reviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(reviseBtns[0]);

    const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Remarks Required',
      'Please provide performance remarks explaining the rating change.',
      'warning'
    );
  });

  it('handles Mode 1 and Mode 2 rendering rules, non-overlap, and quote submissions', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
    expect(screen.getAllByText('UNAVAILABLE IN V1')[0]).toBeInTheDocument();

    // Mode 2: Hybrid Sourcing with quote lock on network partners
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_2',
      rfqs: [], // 0 RFQ quotes so network partner is locked
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
    // Already in Procucev Vendors tab from previous step:
    expect(screen.getAllByText('LOCKED (PENDING BID)')[0]).toBeInTheDocument();

    // Switch to Uploaded by Buyer tab:
    fireEvent.click(screen.getByRole('button', { name: /Uploaded by Buyer/i }));
    expect(screen.getAllByText('BUYER ROSTER (NO EVAL)')[0]).toBeInTheDocument();

    // Mode 2: When network partner HAS submitted quote
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_2',
      rfqs: [
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-2026-00422',
          quotes: [{ vendorId: 'v-3', vendorName: 'TechnoForce Electricals Ltd' }],
          followUpData: { vendors: [] },
        },
      ],
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
    fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
    expect(screen.getAllByText(/Trigger Evaluation/i)[0]).toBeInTheDocument();
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

    it('handles tab navigation, search input, status filter, and category filter', () => {
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

      // Switch to Procucev Network Tab
      const procucevTab = screen.getByRole('button', { name: /Procucev Vendors/i });
      fireEvent.click(procucevTab);
      expect(screen.getByText('TechnoForce Electricals Ltd')).toBeInTheDocument();

      // Switch back to Buyer Uploaded Tab
      const buyerTab = screen.getByRole('button', { name: /Uploaded by Buyer/i });
      fireEvent.click(buyerTab);
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
        { ...mockBuyerVendors[0], id: 'o-1', source: 'historical_purchase_dump' },
        { ...mockBuyerVendors[0], id: 'o-2', source: 'vendor_master_ingestion' },
        { ...mockBuyerVendors[0], id: 'o-3', source: 'excel' },
        { ...mockBuyerVendors[0], id: 'o-4', source: 'category_manager_upload' },
        { ...mockBuyerVendors[0], id: 'o-5', source: 'self_onboarded' },
        { ...mockBuyerVendors[0], id: 'o-6', source: 'vendor_registration' },
        { ...mockBuyerVendors[0], id: 'o-7', source: 'self_registered' },
        {
          ...mockBuyerVendors[0],
          id: 'o-8',
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

      expect(screen.getAllByText('Apex Supplies Ltd.').length).toBeGreaterThan(0);

      // Excel / category-manager / self-onboarded sources are classified as non-buyer-uploaded,
      // so they render under the Procucev Vendors tab.
      fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
      expect(screen.getAllByText('Apex Supplies Ltd.').length).toBeGreaterThan(0);
    });

    it('renders View Profile / Origin / Engagement default fallbacks for a vendor with minimal fields', () => {
      const minimalVendor = {
        id: '',
        name: 'Bare Minimum Traders',
        email: 'contact@bareminimum.com',
        source: 'totally_unknown_source',
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

      // Non-buyer-uploaded, unrecognized source -> Procucev Vendors tab
      fireEvent.click(screen.getByRole('button', { name: /Procucev Vendors/i }));
      expect(screen.getByText('Bare Minimum Traders')).toBeInTheDocument();

      // Rating locked (not engaged in any RFQ, not buyer-uploaded)
      fireEvent.click(screen.getByText(/Rating Locked/i));

      // Open View Profile modal to exercise all the default-value fallbacks
      fireEvent.click(screen.getByRole('button', { name: /View Profile/i }));
      expect(screen.getByText('Procucev Network')).toBeInTheDocument();
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
});


