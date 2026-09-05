import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
      addedByBuyerCompany: 'Larsen & Toubro Limited',
      onboardingEmailStatus: 'delivered',
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
        { vendorId: 'net-5', vendorName: 'HydraFlow Systems' },
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
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
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

  it('handles rating revision modal workflow with all inputs, submit, cancel, and X close', async () => {
    mockReviseVendorRating.mockResolvedValue(true);

    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Click Revise Rating for Apex Supplies
    const reviseBtns = screen.getAllByText(/Revise Rating/i);
    fireEvent.click(reviseBtns[0]);

    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();

    // Sliders and number inputs
    const rangeInputs = screen.getAllByRole('slider');
    fireEvent.change(rangeInputs[0], { target: { value: '94' } });
    fireEvent.change(rangeInputs[1], { target: { value: '86' } });
    fireEvent.change(rangeInputs[2], { target: { value: '92' } });

    const numberInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(numberInputs[0], { target: { value: '95' } });
    fireEvent.change(numberInputs[1], { target: { value: '88' } });
    fireEvent.change(numberInputs[2], { target: { value: '96' } });

    // Remarks input
    const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
    fireEvent.change(textarea, { target: { value: 'Outstanding delivery speed and zero quality defects.' } });

    // Submit revision form inside act
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));
    });

    expect(mockReviseVendorRating).toHaveBeenCalledWith(
      'v-1',
      95,
      88,
      96,
      'Outstanding delivery speed and zero quality defects.'
    );

    // Re-open and test cancel button
    fireEvent.click(screen.getAllByText(/Revise Rating/i)[0]);
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Revise Supplier Performance Rating')).not.toBeInTheDocument();

    // Re-open and test X close button
    fireEvent.click(screen.getAllByText(/Revise Rating/i)[0]);
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
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

  it('handles Mode 1 and Mode 2 rendering rules and quote submissions', () => {
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

  it('handles Add Single Vendor validation errors and full submission', () => {
    const mockAddBuyerVendor = jest.fn();

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_3',
      rfqs: mockRFQs,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
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

    // 1. Trigger validation failure with empty name/email
    fireEvent.click(screen.getByText(/Add Single Vendor/i));
    fireEvent.submit(document.querySelector('.modal-content form')!);
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Vendor name and email are required.', 'warning');

    // 2. Fill all fields on Add Single Vendor Modal
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Apex Industrial Solutions Ltd\./i), {
      target: { value: 'New Test Supplier' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Vikram Verma/i), {
      target: { value: 'Vikram Verma' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. sales@apexvalves\.com/i), {
      target: { value: 'test@supplier.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+91 98200 12345/i), {
      target: { value: '+91 98200 12345' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Pune, Maharashtra/i), {
      target: { value: 'Pune, Maharashtra' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Industrial Valves, Centrifugal Pumps, Gaskets/i), {
      target: { value: 'Valves, Actuators' },
    });

    const formSelects = document.querySelectorAll('.modal-content select');
    if (formSelects[0]) {
      fireEvent.change(formSelects[0], { target: { value: 'Electrical & Power Systems' } });
    }
    const formRatingInput = document.querySelector('.modal-content input[type="number"]');
    if (formRatingInput) {
      fireEvent.change(formRatingInput, { target: { value: '4.8' } });
    }
    if (formSelects[1]) {
      fireEvent.change(formSelects[1], { target: { value: 'PREFERRED ENTERPRISE SUPPLIER' } });
    }

    fireEvent.submit(document.querySelector('.modal-content form')!);
    expect(mockAddBuyerVendor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Test Supplier',
        email: 'test@supplier.com',
        majorCategory: 'Electrical & Power Systems',
        rating: 4.8,
        status: 'PREFERRED ENTERPRISE SUPPLIER',
      })
    );
  });

  it('handles View Details, Edit Vendor, and Delete Vendor modals with all field changes and X buttons', () => {
    const mockUpdateBuyerVendor = jest.fn();
    const mockDeleteBuyerVendor = jest.fn();

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_3',
      rfqs: mockRFQs,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: mockUpdateBuyerVendor,
      deleteBuyerVendor: mockDeleteBuyerVendor,
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

    // 1. Open Details Modal, test X button and Close button
    const detailBtns = screen.getAllByText(/Details/i);
    fireEvent.click(detailBtns[0]);
    expect(screen.getByText('Approved Minor Lines:')).toBeInTheDocument();
    const detailsCloseX = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (detailsCloseX) fireEvent.click(detailsCloseX);
    expect(screen.queryByText('Approved Minor Lines:')).not.toBeInTheDocument();

    fireEvent.click(detailBtns[0]);
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByText('Approved Minor Lines:')).not.toBeInTheDocument();

    // 2. Open Edit Modal, change every field, test X button and Save
    const editBtns = screen.getAllByText(/Edit/i);
    fireEvent.click(editBtns[0]);
    expect(screen.getByText(/Update supplier details for/i)).toBeInTheDocument();
    const editCloseX = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (editCloseX) fireEvent.click(editCloseX);
    expect(screen.queryByText(/Update supplier details for/i)).not.toBeInTheDocument();

    fireEvent.click(editBtns[0]);
    fireEvent.change(screen.getByDisplayValue('Apex Supplies Ltd.'), {
      target: { value: 'Apex Supplies Updated Ltd.' },
    });
    fireEvent.change(screen.getByDisplayValue('Rajesh Nair'), {
      target: { value: 'Rajesh Nair Updated' },
    });
    fireEvent.change(screen.getByDisplayValue('rajesh@apex.in'), {
      target: { value: 'newemail@apexvalves.com' },
    });
    fireEvent.change(screen.getByDisplayValue('+91 98201 44820'), {
      target: { value: '+91 98201 99999' },
    });
    fireEvent.change(screen.getByDisplayValue('Pune, Maharashtra'), {
      target: { value: 'Mumbai, Maharashtra' },
    });
    fireEvent.change(screen.getByDisplayValue('Mechanical'), {
      target: { value: 'Mechanical Engineering' },
    });
    fireEvent.change(screen.getByDisplayValue('Valves, Pumps'), {
      target: { value: 'Valves, High Pressure Pumps' },
    });

    const editRatingInput = document.querySelector('.modal-content input[type="number"]');
    if (editRatingInput) {
      fireEvent.change(editRatingInput, { target: { value: '4.9' } });
    }
    const editStatusSelect = document.querySelector('.modal-content select');
    if (editStatusSelect) {
      fireEvent.change(editStatusSelect, { target: { value: 'CONDITIONAL / UNDER REVIEW' } });
    }

    fireEvent.click(screen.getByText(/Save Changes/i));
    expect(mockUpdateBuyerVendor).toHaveBeenCalledWith(
      'v-1',
      expect.objectContaining({
        name: 'Apex Supplies Updated Ltd.',
        contactPerson: 'Rajesh Nair Updated',
        email: 'newemail@apexvalves.com',
        phone: '+91 98201 99999',
        location: 'Mumbai, Maharashtra',
        majorCategory: 'Mechanical Engineering',
        minorCategories: ['Valves', 'High Pressure Pumps'],
        rating: 4.9,
        status: 'CONDITIONAL / UNDER REVIEW',
      })
    );

    // 3. Open Delete Modal and Confirm / Cancel
    const deleteBtns = screen.getAllByTitle('Delete vendor from directory');
    fireEvent.click(deleteBtns[0]);
    expect(screen.getByText('This action cannot be undone')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('This action cannot be undone')).not.toBeInTheDocument();

    fireEvent.click(deleteBtns[0]);
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(mockDeleteBuyerVendor).toHaveBeenCalledWith('v-1');

    // 4. Test Details modal "Edit Profile" button flow
    fireEvent.click(screen.getAllByText(/Details/i)[0]);
    fireEvent.click(screen.getByText(/Edit Profile/i));
    expect(screen.getByText(/Update supplier details for/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
  });

  it('handles fallback evaluation record creation and revision error edge case', async () => {
    mockReviseVendorRating.mockResolvedValue(false);

    const extraVendors = [
      {
        id: 'v-fallback-eval',
        name: 'Fallback Eval Vendor',
        contactPerson: 'Fallback Contact',
        email: 'fallback@vendor.com',
        phone: '+91 98000 11111',
        location: 'Delhi',
        rating: 4.4,
        score: 88,
        source: 'buyer_excel',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        evaluated: true,
        majorCategory: 'Mechanical',
        minorCategories: [],
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [], // empty evaluations list to trigger fallback evalRec object
      currentMode: 'mode_3',
      rfqs: [],
      showToast: mockShowToast,
      buyerVendors: extraVendors,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
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

    // Click View 360 evaluation on vendor without storeRecord
    const viewEvalBtns = screen.getAllByText(/View 360° Evaluation/i);
    fireEvent.click(viewEvalBtns[0]);
    expect(mockOnViewEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorName: 'Fallback Eval Vendor',
        overallScore: 88,
      })
    );

    // Edit vendor with empty minorCategories
    fireEvent.click(screen.getAllByText(/Edit/i)[0]);
    fireEvent.click(screen.getByText(/Save Changes/i));

    // Revise rating failure branch
    fireEvent.click(screen.getAllByText(/Revise Rating/i)[0]);
    const textarea = screen.getByPlaceholderText(/Describe specific delivery delays/i);
    fireEvent.change(textarea, { target: { value: 'Test remarks' } });
    await act(async () => {
      fireEvent.click(screen.getByText(/Submit Revision & Dispatch Email/i));
    });
    expect(mockReviseVendorRating).toHaveBeenCalled();
  });

  it('covers all vendor source labels, search variations, and ID-based RFQ matches', () => {
    const varietyVendors = [
      {
        id: 'v-manual-src',
        name: 'Manual Sourced Ltd',
        contactPerson: 'Sunil Gupta',
        email: 'sunil@manual.com',
        phone: '+91 91111 22222',
        location: 'Kochi, Kerala',
        source: 'manual',
        status: 'CONDITIONAL / UNDER REVIEW',
        evaluated: false,
        majorCategory: 'Instrumentation',
        minorCategories: ['Transmitters', 'Flow Meters'],
      },
      {
        id: 'v-excel-src',
        name: 'Excel Sourced Ltd',
        contactPerson: 'Meera Rao',
        email: 'meera@excel.com',
        phone: '+91 92222 33333',
        location: 'Hyderabad, TS',
        source: 'excel',
        status: 'REGISTERED',
        evaluated: false,
        majorCategory: 'Civil',
        minorCategories: ['Rebar', 'Cement'],
      },
      {
        id: 'net-nonoverlap',
        name: 'Pure Network Vendor',
        contactPerson: 'Arun Bhat',
        email: 'arun@network.com',
        phone: '+91 93333 44444',
        location: 'Noida, UP',
        source: 'procucev_network',
        overlap: false,
        status: 'REGISTERED',
        evaluated: true,
        score: 75,
        rating: 3.8,
        majorCategory: 'Electrical',
        minorCategories: [],
      },
    ];

    const rfqsWithIdMatch = [
      {
        id: 'rfq-id-match',
        rfqNumber: 'RFQ-ID-MATCH-01',
        quotes: [{ vendorId: 'net-nonoverlap', vendorName: 'Different Name' }],
        followUpData: {
          vendors: [{ vendorId: 'v-manual-src', vendorName: 'Other Name' }],
        },
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [],
      currentMode: 'mode_3',
      rfqs: rfqsWithIdMatch,
      showToast: mockShowToast,
      buyerVendors: varietyVendors,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: { organizationName: 'Tata Projects Ltd' },
    });

    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Search by contact person
    const searchInput = screen.getByPlaceholderText(/Search vendors by name, contact, category/i);
    fireEvent.change(searchInput, { target: { value: 'Sunil' } });
    expect(screen.getByText('Manual Sourced Ltd')).toBeInTheDocument();

    // Search by category
    fireEvent.change(searchInput, { target: { value: 'Instrumentation' } });
    expect(screen.getByText('Manual Sourced Ltd')).toBeInTheDocument();

    // Search by minor category
    fireEvent.change(searchInput, { target: { value: 'Transmitters' } });
    expect(screen.getByText('Manual Sourced Ltd')).toBeInTheDocument();

    // Reset search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Open and close Add Single Modal with Cancel button and X button
    fireEvent.click(screen.getByText(/Add Single Vendor/i));
    fireEvent.click(screen.getByText('Cancel'));

    fireEvent.click(screen.getByText(/Add Single Vendor/i));
    const closeButtons = document.querySelectorAll('.modal-content button');
    const xButton = Array.from(closeButtons).find((b) => b.querySelector('svg.lucide-x'));
    if (xButton) fireEvent.click(xButton);

    // Open Details on vendor with score < 80 and empty minors
    const detailsButtons = screen.getAllByText(/Details/i);
    fireEvent.click(detailsButtons[detailsButtons.length - 1]);
    const modalTitle = document.querySelector('.modal-content h3');
    expect(modalTitle).toHaveTextContent('Pure Network Vendor');
    fireEvent.click(screen.getByText('Close'));
  });

  it('covers Mode 2 non-overlap buyer vendors and bare vendor records without score or ratings', () => {
    const bareVendors = [
      {
        id: 'bare-1',
        name: 'Bare Vendor Corp',
        contactPerson: '',
        email: 'bare@corp.com',
        phone: '',
        location: '',
        source: 'buyer_excel',
        status: 'OTHER_STATUS',
        evaluated: false,
        overlap: false,
        majorCategory: '',
        minorCategories: undefined,
        score: null,
        rating: null,
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [],
      currentMode: 'mode_2',
      rfqs: [],
      showToast: mockShowToast,
      buyerVendors: bareVendors,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
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

    expect(screen.getByText('BUYER ROSTER (NO EVAL)')).toBeInTheDocument();

    // Revise rating on bare vendor (triggers score fallback 88 and previousScore calculation)
    fireEvent.click(screen.getByText(/Revise Rating/i));
    expect(screen.getByText('Revise Supplier Performance Rating')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));

    // Open Details on bare vendor
    fireEvent.click(screen.getByText(/Details/i));
    expect(document.querySelector('.modal-content h3')).toHaveTextContent('Bare Vendor Corp');
    fireEvent.click(screen.getByText('Close'));

    // Open Edit on bare vendor and save with empty rating
    fireEvent.click(screen.getByText(/Edit/i));
    const editRating = document.querySelector('.modal-content input[type="number"]');
    if (editRating) fireEvent.change(editRating, { target: { value: '' } });
    fireEvent.click(screen.getByText(/Save Changes/i));
  });

  it('covers vendor with score and no rating, and details modal with addedByBuyerCompany', () => {
    const scoredVendor = [
      {
        id: 'v-score-only',
        name: 'Score Only Vendor',
        contactPerson: 'Aditi Sharma',
        email: 'aditi@score.com',
        phone: '+91 99000 11111',
        location: 'Jaipur, RJ',
        source: 'buyer_manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        evaluated: true,
        score: 92,
        rating: null,
        addedByBuyerCompany: 'Larsen & Toubro Limited',
        onboardingEmailStatus: 'delivered',
        majorCategory: 'Mechanical',
        minorCategories: ['Valves'],
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [],
      currentMode: 'mode_3',
      rfqs: [],
      showToast: mockShowToast,
      buyerVendors: scoredVendor,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
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

    // Verifies score-to-rating calculation fallback: 92 / 20 = 4.6
    expect(screen.getByText('4.6 / 5.0')).toBeInTheDocument();

    // Open Details to exercise addedByBuyerCompany and onboardingEmailStatus
    fireEvent.click(screen.getByText(/Details/i));
    expect(screen.getByText('Larsen & Toubro Limited')).toBeInTheDocument();
    expect(screen.getByText(/delivered/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
  });

  it('covers vendor engagement in follow-up data and search by phone/vendorCode', () => {
    const engagedVendor = [
      {
        id: 'vnd-engaged-1',
        vendorCode: 'VND-ENG-99',
        name: 'Precision Turbines India',
        contactPerson: 'Karan Mehra',
        email: 'karan@turbines.in',
        phone: '+91 98765 43210',
        location: 'Bengaluru, KA',
        source: 'manual',
        status: 'PREFERRED ENTERPRISE SUPPLIER',
        evaluated: false,
        majorCategory: 'Power Systems',
        minorCategories: ['Turbines', 'Generators'],
      },
    ];

    const rfqsWithFollowUp = [
      {
        id: 'rfq-followup-101',
        title: 'Turbine Overhaul RFQ',
        status: 'ACTIVE',
        quotes: [],
        followUpData: {
          vendors: [
            {
              vendorId: 'vnd-engaged-1',
              vendorName: 'Precision Turbines India',
              responseStatus: 'responded',
            },
          ],
        },
      },
    ];

    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: [],
      currentMode: 'mode_3',
      rfqs: rfqsWithFollowUp,
      showToast: mockShowToast,
      buyerVendors: engagedVendor,
      addBuyerVendor: jest.fn(),
      updateBuyerVendor: jest.fn(),
      deleteBuyerVendor: jest.fn(),
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      activeBuyerAccount: { organizationName: 'Tata Power Corp' },
    });

    render(
      <VendorSummary
        onViewEvaluation={mockOnViewEvaluation}
        onNavigateToWizard={mockOnNavigateToWizard}
      />
    );

    // Search by vendorCode
    const searchInput = screen.getByPlaceholderText(/Search vendors by name/i);
    fireEvent.change(searchInput, { target: { value: 'VND-ENG-99' } });
    expect(screen.getByText('Precision Turbines India')).toBeInTheDocument();

    // Search by phone
    fireEvent.change(searchInput, { target: { value: '98765 43210' } });
    expect(screen.getByText('Precision Turbines India')).toBeInTheDocument();
  });
});
