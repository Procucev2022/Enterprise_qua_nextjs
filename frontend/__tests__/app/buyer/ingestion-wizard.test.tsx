import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as XLSX from 'xlsx';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import { useApp } from '@/lib/store';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

class MockFileReader {
  onload: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsArrayBuffer(file: any) {
    if (file.__error) {
      if (this.onerror) this.onerror(new Error('Read error'));
      return;
    }
    const buf = file.__buffer !== undefined ? file.__buffer : new ArrayBuffer(0);
    if (this.onload) {
      this.onload({ target: { result: buf } });
    }
  }

  readAsText(file: any) {
    if (file.__error) {
      if (this.onerror) this.onerror(new Error('Read error'));
      return;
    }
    if (this.onload) {
      this.onload({ target: { result: file.__text || 'Sample Text' } });
    }
  }
}

describe('app/buyer/ingestion-wizard.tsx', () => {
  const originalFileReader = global.FileReader;
  const mockAddNewRFQ = jest.fn();
  const mockSetCurrentMode = jest.fn();
  const mockShowToast = jest.fn();
  const mockAddBuyerVendor = jest.fn();
  const mockImportBuyerVendors = jest.fn();
  const mockDeleteBuyerVendor = jest.fn();
  const mockMatchSuitableVendors = jest.fn();
  const mockOpenStandardEmailModal = jest.fn();
  const mockSetSelectedOnboardingEmail = jest.fn();
  const mockSetOnboardingEmailModalOpen = jest.fn();
  const mockOpenOnboardingEmailModal = jest.fn();
  const mockTriggerVendorReminder = jest.fn();
  const mockCompleteVendorProfile = jest.fn();
  const mockOnComplete = jest.fn();
  const mockOnCancel = jest.fn();

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
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Pumps & Accessories', 'Hoses, Valves & Fittings'],
      profileCompletionStatus: 'completed',
    },
    {
      id: 'v-2',
      name: 'Global Valves Ltd',
      contactPerson: 'Suresh Rao',
      email: 'suresh@globalvalves.in',
      phone: '+91 98201 55443',
      location: 'Vadodara, Gujarat',
      rating: 4.2,
      score: 72,
      source: 'buyer_excel',
      status: 'CONDITIONAL / UNDER REVIEW',
      evaluated: true,
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Hoses, Valves & Fittings'],
      profileCompletionStatus: 'pending',
      isExistingInDatabase: true,
    },
    {
      id: 'v-3',
      name: 'Unrated Discovery Supplier',
      contactPerson: 'Karan Mehra',
      email: 'karan@discovery.com',
      phone: '+91 98000 11111',
      location: 'Chennai, TN',
      rating: null,
      source: 'procucev_network',
      status: 'NEW_DISCOVERY',
      evaluated: false,
      majorCategory: 'Engineering Spares - Mechanical',
      minorCategories: ['Pumps & Accessories'],
      isUnratedRecommendation: true,
    },
    {
      id: 'v-4',
      name: 'PowerGrid Electricals',
      contactPerson: 'Manoj Singh',
      email: 'manoj@powergrid.co.in',
      phone: '+91 98000 22222',
      location: 'Noida, UP',
      rating: 4.5,
      source: 'procucev_network',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
      majorCategory: 'Engineering Spares - Electrical',
      minorCategories: ['Panels', 'Transformers'],
    },
    {
      id: 'v-5',
      name: 'Everest Infra Build',
      contactPerson: 'Rohan Desai',
      email: 'rohan@everest.com',
      phone: '+91 98000 33333',
      location: 'Jamshedpur, JH',
      rating: 4.6,
      source: 'procucev_network',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
      majorCategory: 'Civil Works',
      minorCategories: ['PEB Structure', 'TMT BARS'],
    },
  ];

  beforeAll(() => {
    (global as any).FileReader = MockFileReader;
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterAll(() => {
    global.FileReader = originalFileReader;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (useApp as jest.Mock).mockReturnValue({
      addNewRFQ: mockAddNewRFQ,
      currentMode: 'mode_2',
      setCurrentMode: mockSetCurrentMode,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      importBuyerVendors: mockImportBuyerVendors,
      deleteBuyerVendor: mockDeleteBuyerVendor,
      matchSuitableVendors: mockMatchSuitableVendors.mockReturnValue(mockBuyerVendors),
      openStandardEmailModal: mockOpenStandardEmailModal,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      selectedOnboardingEmail: null,
      setSelectedOnboardingEmail: mockSetSelectedOnboardingEmail,
      onboardingEmailModalOpen: false,
      setOnboardingEmailModalOpen: mockSetOnboardingEmailModalOpen,
      openOnboardingEmailModal: mockOpenOnboardingEmailModal,
      triggerVendorReminder: mockTriggerVendorReminder,
      completeVendorProfile: mockCompleteVendorProfile,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders Step 1 with document upload and navigates through all 3 steps to dispatch RFQ', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();

    // Cancel button in Step 1
    fireEvent.click(screen.getByText('Exit Wizard'));
    expect(mockOnCancel).toHaveBeenCalled();

    // Proceed to Step 2
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    // Proceed to Step 3
    fireEvent.click(screen.getByText(/Proceed to Sourcing Mode & Vendor Matching/i));
    expect(screen.getByText(/STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH/i)).toBeInTheDocument();

    // Dispatch RFQ
    fireEvent.click(screen.getByText(/DISPATCH STANDARD RFQ EMAILS TO SUITABLE VENDORS/i));
    expect(mockAddNewRFQ).toHaveBeenCalled();
    expect(mockOnComplete).toHaveBeenCalled();
  });

  it('handles back button navigation across all steps', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Step 1 -> Step 2
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES/i)).toBeInTheDocument();

    // Back to step 1
    fireEvent.click(screen.getByText('Back to Ingestion'));
    expect(screen.getByText(/STEP 1: INGESTION SOURCE/i)).toBeInTheDocument();

    // Step 1 -> Step 2 -> Step 3
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByText(/Proceed to Sourcing Mode & Vendor Matching/i));
    expect(screen.getByText(/STEP 3: SOURCING MODE SELECTION/i)).toBeInTheDocument();

    // Back to step 2
    fireEvent.click(screen.getByText('Back to Review'));
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES/i)).toBeInTheDocument();
  });

  it('handles real Excel upload, PDF non-excel upload, and error catch in Step 1', () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Item Description': 'Centrifugal Water Pump 500 GPM',
        Quantity: 10,
        Unit: 'Units',
        'Target Date': '2026-09-30',
        'Technical Specs': 'Cast steel PN40 ANSI 300',
        Category: 'Pumps & Accessories',
      },
      {
        'Item Description': 'Flanged Gate Valve',
        Quantity: 5,
        Unit: 'Units',
        'Target Date': '2026-09-30',
        'Technical Specs': 'Class 150',
        Category: 'Hoses, Valves & Fittings',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOQ');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file: any = new File([buffer], 'custom_boq.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    file.__buffer = buffer;

    const { container, unmount } = render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Drag and drop Excel file
    const dropZone = container.querySelector('.border-dashed');
    if (dropZone) {
      fireEvent.dragOver(dropZone);
      fireEvent.dragLeave(dropZone);
      fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    }

    // Native file input change
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [file] } });
    }

    unmount();

    // Fresh mount for email_file subtab
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);
    const emailFileTab = screen.getByText(/Upload Email File/i);
    fireEvent.click(emailFileTab);
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
  });

  it('handles email tab ingestion for mechanical, electrical, and civil requisitions', () => {
    const { unmount } = render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Switch to Email tab
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));
    expect(screen.getByText(/Select Incoming Email Requisition Sample:/i)).toBeInTheDocument();

    // 1. Mechanical interactive review
    fireEvent.click(screen.getByText('Mechanical Pumps & Valves'));
    fireEvent.click(screen.getByText(/Interactive Review \(Step-by-Step\)/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getAllByText(/STEP 2: REVIEW ENTITIES/i)[0]).toBeInTheDocument();

    unmount();

    // 2. Electrical interactive review
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));
    fireEvent.click(screen.getByText('Electrical Switchgear'));
    fireEvent.click(screen.getByText(/Interactive Review \(Step-by-Step\)/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getAllByText(/STEP 2: REVIEW ENTITIES/i)[0]).toBeInTheDocument();

    // 3. Civil interactive review
    unmount();
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));
    fireEvent.click(screen.getByText('Civil & PEB Steel'));
    fireEvent.click(screen.getByText(/Interactive Review \(Step-by-Step\)/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(screen.getAllByText(/STEP 2: REVIEW ENTITIES/i)[0]).toBeInTheDocument();
  });

  it('handles autonomous auto-circulation in Step 1', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Switch to Email tab
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));

    // Run Autonomous AI Sourcing Auto-Circulation
    fireEvent.click(screen.getByText(/Autonomous Ingest, Categorize & Auto-Circulate RFQ/i));
    expect(screen.getByText(/Autonomous RFQ Ingestion & Auto-Circulation/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(mockAddNewRFQ).toHaveBeenCalled();
  });

  it('handles line item CRUD operations and auto-categorization in Step 2', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Go to Step 2
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // Change RFQ title and budget
    const titleInput = screen.getByDisplayValue('Centrifugal Water Pumps & Industrial Valves Procurement');
    fireEvent.change(titleInput, { target: { value: 'Updated RFQ Project 2026' } });

    const budgetInput = screen.getByDisplayValue('145000');
    fireEvent.change(budgetInput, { target: { value: '160000' } });

    // Add new line item
    fireEvent.click(screen.getByText(/Add Line Item/i));

    // Change entity majorCategory and minorCategory dropdowns
    const selects = screen.getAllByRole('combobox');
    if (selects[0]) fireEvent.change(selects[0], { target: { value: 'Engineering Spares - Electrical' } });

    // Auto-categorize all button
    fireEvent.click(screen.getByText(/AI Auto-Categorize All/i));
    expect(mockShowToast).toHaveBeenCalledWith('AI Auto-Categorization Complete', expect.any(String), 'success');

    // Delete a line item
    const deleteBtns = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-trash-2'));
    if (deleteBtns[0]) fireEvent.click(deleteBtns[0]);
  });

  it('handles sourcing mode switches, Mode 3 selection, top 5 auto-select, reset, profile modal, and unrated survey toggle in Step 3', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Go to Step 3
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByText(/Proceed to Sourcing Mode & Vendor Matching/i));

    // Preview Standard RFQ Email in Mode 2
    const previewEmailBtns = screen.getAllByText(/Preview Standard RFQ Email/i);
    if (previewEmailBtns[0]) fireEvent.click(previewEmailBtns[0]);
    expect(mockOpenStandardEmailModal).toHaveBeenCalled();

    // Switch to Version 1
    const v1Cards = screen.getAllByText('Version 1');
    if (v1Cards[0]) fireEvent.click(v1Cards[0]);

    // Switch to Version 3
    const v3Cards = screen.getAllByText('Version 3');
    if (v3Cards[0]) fireEvent.click(v3Cards[0]);

    // In Mode 3: Auto Select Top 5
    const top5Btn = screen.getByText(/Auto-Select Top 5/i);
    fireEvent.click(top5Btn);

    // In Mode 3: Reset selection
    const resetBtn = screen.getByText(/Reset \(Top 1\)/i);
    fireEvent.click(resetBtn);

    // In Mode 3: View Vendor Profile modal
    const viewProfileBtns = screen.getAllByText(/View Vendor Profile/i);
    if (viewProfileBtns[0]) {
      fireEvent.click(viewProfileBtns[0]);
      expect(screen.getByText(/Verified enterprise partner from the Procucev Network Database/i)).toBeInTheDocument();

      // Switch tabs inside profile modal (specs, compliance, machinery, esg)
      const tabs = screen.getAllByRole('button');
      const compTab = tabs.find((b) => b.textContent?.includes('Compliance'));
      if (compTab) fireEvent.click(compTab);

      const machTab = tabs.find((b) => b.textContent?.includes('Machinery'));
      if (machTab) fireEvent.click(machTab);

      const esgTab = tabs.find((b) => b.textContent?.includes('ESG'));
      if (esgTab) fireEvent.click(esgTab);

      // Close profile modal
      const closeBtn = tabs.find((b) => b.querySelector('svg.lucide-x'));
      if (closeBtn) fireEvent.click(closeBtn);
    }

    // Toggle unrated vendor / evaluate & send RFQ
    const allButtons = screen.getAllByRole('button');
    const evalBtn = allButtons.find((b) => b.textContent?.includes('Evaluate & Send RFQ') || b.textContent?.includes('Queued with 360° Evaluation'));
    if (evalBtn) fireEvent.click(evalBtn);

    // Dispatch in Mode 3
    fireEvent.click(screen.getByText(/DISPATCH STANDARD RFQ EMAILS TO SUITABLE VENDORS/i));
    expect(mockAddNewRFQ).toHaveBeenCalledWith(
      expect.objectContaining({ sourcingMode: 'mode_3' }),
      expect.any(Array)
    );
  });

  it('handles subscription restrictions and upgrade warnings in Step 3', () => {
    (useApp as jest.Mock).mockReturnValue({
      addNewRFQ: mockAddNewRFQ,
      currentMode: 'mode_1',
      setCurrentMode: mockSetCurrentMode,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      importBuyerVendors: mockImportBuyerVendors,
      deleteBuyerVendor: mockDeleteBuyerVendor,
      matchSuitableVendors: mockMatchSuitableVendors.mockReturnValue(mockBuyerVendors),
      openStandardEmailModal: mockOpenStandardEmailModal,
      remainingFreeRFQs: 0,
      activeSubscription: 'version_1', // Only version 1 allowed
      selectedOnboardingEmail: null,
      setSelectedOnboardingEmail: mockSetSelectedOnboardingEmail,
      onboardingEmailModalOpen: false,
      setOnboardingEmailModalOpen: mockSetOnboardingEmailModalOpen,
      openOnboardingEmailModal: mockOpenOnboardingEmailModal,
      triggerVendorReminder: mockTriggerVendorReminder,
      completeVendorProfile: mockCompleteVendorProfile,
    });

    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Proceed to Step 3
    fireEvent.click(screen.getByText(/Proceed to Step 2: Interactive Review & Taxonomy/i));
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByText(/Proceed to Sourcing Mode & Vendor Matching/i));

    // Try clicking Version 3 when locked
    const v3Cards = screen.getAllByText('Version 3');
    if (v3Cards[0]) fireEvent.click(v3Cards[0]);
    expect(mockShowToast).toHaveBeenCalledWith('Upgrade Required', expect.any(String), 'warning');

    // Try clicking Version 2 when locked
    const v2Cards = screen.getAllByText('Version 2');
    if (v2Cards[0]) fireEvent.click(v2Cards[0]);
    expect(mockShowToast).toHaveBeenCalledWith('Upgrade Required', expect.any(String), 'warning');
  });

  it('handles vendor master data management: manual vendor add with validation, excel upload, reminders, search, and copy credentials modal', () => {
    render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);

    // Click Manual Add vendor
    fireEvent.click(screen.getByText(/Click to Add New Vendor & Categorize/i));

    // 1. Submit with empty fields (Validation Error)
    fireEvent.click(screen.getByText(/Save & Categorize Vendor/i));
    expect(mockShowToast).toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');

    // 2. Fill fields
    const nameInput = screen.getByPlaceholderText(/Apex Supplies Ltd/i);
    fireEvent.change(nameInput, { target: { value: 'Delta Engineering Ltd' } });

    const contactInput = screen.getByPlaceholderText(/Rajesh Nair/i);
    fireEvent.change(contactInput, { target: { value: 'Sanjay Rawat' } });

    const emailInput = screen.getByPlaceholderText(/vendor@company.com/i);
    fireEvent.change(emailInput, { target: { value: 'sanjay@delta.com' } });

    // Toggle minor categories
    const minorPills = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Pumps & Accessories'));
    if (minorPills[0]) fireEvent.click(minorPills[0]);

    // Submit vendor
    fireEvent.click(screen.getByText(/Save & Categorize Vendor/i));
    expect(mockAddBuyerVendor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Delta Engineering Ltd' })
    );

    // Switch to Excel Upload tab in bottom section
    fireEvent.click(screen.getByText(/Excel Upload/i));

    // Click simulation upload
    fireEvent.click(screen.getByText(/Drag & Drop Vendor Master Spreadsheet Here/i));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockImportBuyerVendors).toHaveBeenCalled();

    // Trigger reminder
    const remindBtns = screen.getAllByText(/Simulate Day 3 Reminder/i);
    if (remindBtns[0]) fireEvent.click(remindBtns[0]);
    expect(mockTriggerVendorReminder).toHaveBeenCalled();

    // Delete vendor
    const deleteVendorBtns = screen.getAllByTitle('Delete vendor');
    if (deleteVendorBtns[0]) fireEvent.click(deleteVendorBtns[0]);
    expect(mockDeleteBuyerVendor).toHaveBeenCalled();

    // Open Onboarding Email Modal
    const emailBtns = screen.getAllByText(/View Email & Credentials/i);
    if (emailBtns[0]) fireEvent.click(emailBtns[0]);
    expect(mockOpenOnboardingEmailModal).toHaveBeenCalled();

    // Filter by search and major category
    const searchInputs = screen.getAllByPlaceholderText(/Search vendor or minor category/i);
    if (searchInputs[0]) fireEvent.change(searchInputs[0], { target: { value: 'Apex' } });

    // Render with onboardingEmailModalOpen = true
    (useApp as jest.Mock).mockReturnValue({
      addNewRFQ: mockAddNewRFQ,
      currentMode: 'mode_2',
      setCurrentMode: mockSetCurrentMode,
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      importBuyerVendors: mockImportBuyerVendors,
      deleteBuyerVendor: mockDeleteBuyerVendor,
      matchSuitableVendors: mockMatchSuitableVendors.mockReturnValue(mockBuyerVendors),
      openStandardEmailModal: mockOpenStandardEmailModal,
      remainingFreeRFQs: 5,
      activeSubscription: 'free_trial',
      selectedOnboardingEmail: {
        vendorId: 'v-1',
        vendorName: 'Apex Supplies Ltd.',
        email: 'rajesh@apex.in',
        username: 'v-apex',
        tempPassword: 'temp-password-123',
        authMethod: 'temp_password',
        profileUpdateInstructions: 'Update company address and GSTIN.',
        categoryUpdateInstructions: 'Verify product catalog.',
        nextReminderDate: 'Day 3 (2026-03-03)',
        shaSignature: 'c7d1e3a985f621b0e49c812d4a7f55e0921bc3d49f018a7c2b53e6144f5592a1',
        assignedMajorCategory: 'Engineering Spares - Mechanical',
        assignedMinorCategories: ['Pumps & Accessories', 'Valves & Fittings'],
      },
      setSelectedOnboardingEmail: mockSetSelectedOnboardingEmail,
      onboardingEmailModalOpen: true,
      setOnboardingEmailModalOpen: mockSetOnboardingEmailModalOpen,
      openOnboardingEmailModal: mockOpenOnboardingEmailModal,
      triggerVendorReminder: mockTriggerVendorReminder,
      completeVendorProfile: mockCompleteVendorProfile,
    });

    const { rerender } = render(<IngestionWizard onComplete={mockOnComplete} onCancel={mockOnCancel} />);
    expect(screen.getByText(/Official Vendor Onboarding Invitation & Credentials/i)).toBeInTheDocument();

    // Copy credentials
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
    fireEvent.click(screen.getByText(/Copy Login Credentials/i));
    expect(mockShowToast).toHaveBeenCalledWith('Credentials Copied', expect.any(String), 'success');

    // Close modal
    fireEvent.click(screen.getByText('Close Email Preview'));
    expect(mockSetOnboardingEmailModalOpen).toHaveBeenCalledWith(false);
  });
});
