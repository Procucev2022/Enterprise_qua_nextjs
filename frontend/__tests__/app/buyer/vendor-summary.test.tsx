import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VendorSummary from '@/app/buyer/vendor-summary';
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
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: { organizationName: 'Larsen & Toubro Limited' },
    });
  });

  it('renders stats counters, vendor cards, and handles search & filters', () => {
    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    expect(screen.getByText('Evaluated Vendor Directory & Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Registered')).toBeInTheDocument();
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

    // Click Add New Vendor button
    fireEvent.click(screen.getByText(/Add New Vendor \/ Ingestion/i));
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

    // Status filter: NOT_EVALUATED
    fireEvent.change(selects[1], { target: { value: 'NOT_EVALUATED' } });
    expect(screen.getByText('TechnoForce Electricals Ltd')).toBeInTheDocument();

    // Status filter: PREFERRED
    fireEvent.change(selects[1], { target: { value: 'PREFERRED' } });
    expect(screen.getByText('Apex Supplies Ltd.')).toBeInTheDocument();

    // Status filter: CONDITIONAL
    fireEvent.change(selects[1], { target: { value: 'CONDITIONAL' } });
    expect(screen.getByText('Global Valves Ltd')).toBeInTheDocument();

    // Search with no results
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-12345' } });
    expect(screen.getByText('No vendors found matching query filters.')).toBeInTheDocument();
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

    // Trigger evaluation on non-evaluated vendor in Mode 3
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
    fireEvent.click(reviseBtns[1]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));

    // 3. Click Revise Rating for HydraFlow Systems (net-5, network vendor active in RFQ, not uploaded)
    fireEvent.click(reviseBtns[2]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

    // Test X close button
    const xBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument();

    // Click View Dispatched Email Notice
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

    // Click locked rating button on unengaged vendor (net-4)
    const lockedBtn = screen.getByText(/Rating Locked/i);
    fireEvent.click(lockedBtn);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Rating Revision Locked',
      expect.stringContaining('neither been used in any of your RFQs nor uploaded'),
      'warning'
    );

    // Open revision on engaged vendor and try submitting with empty remarks
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
    expect(screen.getAllByText('LOCKED (PENDING BID)')[0]).toBeInTheDocument();
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
    expect(screen.getAllByText(/Trigger Evaluation/i)[0]).toBeInTheDocument();
  });
});
