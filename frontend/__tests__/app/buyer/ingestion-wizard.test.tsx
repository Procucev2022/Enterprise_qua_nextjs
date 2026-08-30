import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import { AppProvider, useApp } from '@/lib/store';

// Mock XLSX for comprehensive file parser testing
jest.mock('xlsx', () => ({
  read: jest.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: {
    sheet_to_json: jest.fn(() => [
      { itemname: 'Centrifugal Water Pump', quantity: '10', unit: 'Units', targetdate: '2026-09-25', specs: '15 HP motor' },
      { description: 'Gate Valve Flanged', qty: '20', uom: 'Pcs', deadline: '2026-09-28', details: 'Class 150 flanged' },
      { product: 'Rotary Air Compressor', count: '2', unit: 'Sets', date: '2026-09-30', specification: '25 CFM screw compressor' },
      { material: 'LV Switchgear Panel', units: '5', uom: 'Units', targetdate: '2026-10-01', technicalspecs: 'Form 4b 4000A' },
      { part: 'Circuit Breaker MCCB', qty: '12', uom: 'Units', due_date: '2026-10-01', specs: '400A 50kA' },
      { item: 'Armoured Copper Cable', quantity: '500', uom: 'Meters', delivery_date: '2026-10-05', details: '3.5C x 240 sq.mm' },
      { itemname: 'Structural Steel PEB', quantity: '100', uom: 'MT', targetdate: '2026-10-10', specs: 'High tensile 345 MPa steel' },
      { itemname: 'Globe Control Valve', quantity: '-5', unit: '', targetdate: '', specs: 'High pressure globe valve' },
      { itemname: 'Flexible Hydraulic Hose', count: 'invalid_num', unit: 'Meters', targetdate: '2026-10-12', details: 'Braided hose' },
      { itemname: 'Electrical Wire Harness', units: '50', uom: 'Coils', targetdate: '2026-10-15', technicalspecs: 'Copper insulated wire' },
      { itemname: 'TMT Reinforcement Steel Bar', qty: '80', uom: 'Tons', due_date: '2026-10-20', specs: 'Fe 500D TMT rebar' },
      { unknownKey: 'no_match_fallback' },
    ]),
  },
}));

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockImplementation(() => Promise.resolve()),
  },
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function IngestionWizardVersion1Wrapper() {
  return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_1" />;
}

function IngestionWizardVersion2Wrapper() {
  return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_2" />;
}

function IngestionWizardVersion3Wrapper({ onComplete, onCancel }: { onComplete?: () => void; onCancel?: () => void } = {}) {
  return <IngestionWizard onComplete={onComplete || jest.fn()} onCancel={onCancel || jest.fn()} forceSubscription="version_3" />;
}

describe('IngestionWizard Comprehensive Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Step 1: Document Upload, Subtabs, Drag-and-drop, Excel/PDF File Uploads, and Step 2 Transition', () => {
    jest.useFakeTimers();
    const onCancel = jest.fn();
    const onComplete = jest.fn();
    renderWithProvider(<IngestionWizard onComplete={onComplete} onCancel={onCancel} />);

    // Exit Wizard
    const exitBtn = screen.getByRole('button', { name: /Exit Wizard/i });
    fireEvent.click(exitBtn);
    expect(onCancel).toHaveBeenCalled();

    // Switch to Email Ingestion Gateway and switch back to Web Portal
    const emailGatewayBtn = screen.getByRole('button', { name: /Email Ingestion Gateway/i });
    fireEvent.click(emailGatewayBtn);
    const webPortalBtn = screen.getByRole('button', { name: /Web Portal & File Ingestion/i });
    fireEvent.click(webPortalBtn);

    // Test PDF file upload and empty file input branch in Step 1 before advancing
    const initialFileInputs = document.querySelectorAll('input[type="file"]');
    if (initialFileInputs.length > 0) {
      fireEvent.change(initialFileInputs[0], { target: { files: [] } });

      const dummyPdfFile = new File(['pdf content'], 'Spec_Drawing.pdf', { type: 'application/pdf' });
      fireEvent.change(initialFileInputs[0], { target: { files: [dummyPdfFile] } });
    }

    // Go back to step 1
    fireEvent.click(screen.getByRole('button', { name: /Back to Ingestion/i }));

    // Switch between BOQ tab and Email File tab in Upload Method
    const emailFileTabBtn = screen.getByRole('button', { name: /Upload Email File/i });
    fireEvent.click(emailFileTabBtn);

    // Click Proceed from Email file upload
    const proceedFromEmailFileBtn = screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i });
    fireEvent.click(proceedFromEmailFileBtn);
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    // Go back to step 1
    fireEvent.click(screen.getByRole('button', { name: /Back to Ingestion/i }));

    const boqTabBtn = screen.getByRole('button', { name: /BOQ Spreadsheet/i });
    fireEvent.click(boqTabBtn);

    // Click upload dropzone and test drag & drop with excel file
    const dropzone = screen.getByText(/Click to Browse or Drag & Drop RFQ Document/i);
    fireEvent.click(dropzone);
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);

    // Drop with empty files
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [] },
    });

    const dummyExcelFile = new File(['dummy content'], 'Test_BOQ_Pumps.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const originalFileReader = global.FileReader;
    class MockFileReader {
      onload: any = null;
      readAsArrayBuffer() {
        if (this.onload) {
          this.onload({ target: { result: new ArrayBuffer(8) } });
        }
      }
    }
    global.FileReader = MockFileReader as any;

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [dummyExcelFile] },
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Test file input with .csv, .tsv, .xls
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length > 0) {
      fireEvent.change(fileInputs[0], { target: { files: [new File(['csv'], 'items.csv', { type: 'text/csv' })] } });
      fireEvent.change(fileInputs[0], { target: { files: [new File(['tsv'], 'items.tsv', { type: 'text/tab-separated-values' })] } });
      fireEvent.change(fileInputs[0], { target: { files: [new File(['xls'], 'items.xls', { type: 'application/vnd.ms-excel' })] } });
      fireEvent.change(fileInputs[0], { target: { files: [new File(['docx'], 'items.docx', { type: 'application/docx' })] } });
    }

    // Test reader error fallback
    class MockFailingFileReader {
      onload: any = null;
      readAsArrayBuffer() {
        if (this.onload) {
          this.onload({ target: null });
        }
      }
    }
    global.FileReader = MockFailingFileReader as any;
    if (fileInputs.length > 0) {
      fireEvent.change(fileInputs[0], { target: { files: [dummyExcelFile] } });
    }
    global.FileReader = originalFileReader;

    // Test Metadata inputs in Step 2
    const titleInputs = screen.queryAllByRole('textbox');
    if (titleInputs.length > 0) {
      fireEvent.change(titleInputs[0], { target: { value: 'High Capacity Submersible Pumps 2026' } });
    }
    jest.useRealTimers();
  });

  test('Step 1: Email Ingestion Gateway, Sample Requisitions, Editing, and Switching', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    renderWithProvider(<IngestionWizard onComplete={onComplete} onCancel={jest.fn()} />);

    // Switch to Email Simulation tab
    const emailTabBtn = screen.getByRole('button', { name: /Autonomous/i });
    fireEvent.click(emailTabBtn);

    expect(screen.getAllByText(/Autonomous Email Ingestion Gateway/i)[0]).toBeInTheDocument();

    // Edit email inputs (subject, sender, body)
    const inputs = screen.getAllByRole('textbox');
    if (inputs.length >= 3) {
      fireEvent.change(inputs[0], { target: { value: 'custom.procurement@example.com' } });
      fireEvent.change(inputs[2], { target: { value: 'Custom Subject Requisition' } });
    }
    const bodyInput = document.querySelector('textarea');
    if (bodyInput) {
      fireEvent.change(bodyInput, { target: { value: 'Line 1: High Pressure Centrifugal Pump' } });
    }

    // 1. Test Mechanical sample with Interactive Review
    const mechanicalBtn = screen.getByRole('button', { name: /Mechanical Pumps & Valves/i });
    fireEvent.click(mechanicalBtn);
    fireEvent.click(screen.getByRole('button', { name: /Interactive Review \(Step-by-Step\)/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    // Proceed to Step 3 from email review
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i }));
    expect(screen.getByText(/STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH/i)).toBeInTheDocument();

    // Dispatch Mode 2 with Email source
    const dispatchEmailSourceBtn = screen.getByRole('button', { name: /DISPATCH STANDARD RFQ EMAILS/i });
    fireEvent.click(dispatchEmailSourceBtn);
    expect(onComplete).toHaveBeenCalled();

    // 2. Test Electrical sample with Interactive Review
    const { unmount: unmountElec } = renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous/i })[0]);
    const electricalBtn = screen.getByRole('button', { name: /Electrical Switchgear/i });
    fireEvent.click(electricalBtn);
    fireEvent.click(screen.getByRole('button', { name: /Interactive Review \(Step-by-Step\)/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();
    unmountElec();

    // 3. Test Civil sample with Interactive Review
    const { unmount: unmountCivilRev } = renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous/i })[0]);
    const civilBtn = screen.getByRole('button', { name: /Civil & PEB Steel/i });
    fireEvent.click(civilBtn);
    fireEvent.click(screen.getByRole('button', { name: /Interactive Review \(Step-by-Step\)/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();
    unmountCivilRev();

    // 4. Test Electrical sample with Autonomous Auto-Circulate
    const { unmount: unmountElecAuto } = renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Electrical Switchgear/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous Ingest, Categorize & Auto-Circulate RFQ/i })[0]);
    act(() => {
      jest.advanceTimersByTime(600);
      jest.advanceTimersByTime(600);
      jest.advanceTimersByTime(600);
      jest.advanceTimersByTime(1200);
    });
    unmountElecAuto();

    // 5. Test Civil sample with Autonomous Auto-Circulate
    const { unmount: unmountCivilAuto } = renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Civil & PEB Steel/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous Ingest, Categorize & Auto-Circulate RFQ/i })[0]);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    unmountCivilAuto();

    // 6. Test Mechanical sample with Autonomous Auto-Circulate
    const { unmount: unmountMechAuto } = renderWithProvider(<IngestionWizard onComplete={onComplete} onCancel={jest.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Mechanical Pumps & Valves/i })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /Autonomous Ingest, Categorize & Auto-Circulate RFQ/i })[0]);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    unmountMechAuto();

    jest.useRealTimers();
  });

  test('Step 2: Line Items manipulation, Auto-Categorization keywords, Add, Edit, Delete & Taxonomy', () => {
    jest.useFakeTimers();
    renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);

    // Advance to Step 2
    const proceedBtn = screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i });
    fireEvent.click(proceedBtn);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    // Change RFQ Title and Budget
    const titleInput = screen.getByDisplayValue(/Centrifugal Water Pumps & Industrial Valves Procurement/i);
    fireEvent.change(titleInput, { target: { value: 'Updated Project Requisition 2026' } });

    const budgetInput = screen.getByDisplayValue('145000');
    fireEvent.change(budgetInput, { target: { value: '250000' } });

    // Add 4 Line Items
    const addBtn = screen.getByRole('button', { name: /Add Line Item/i });
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);

    const itemInputs = document.querySelectorAll('tbody input[type="text"]');
    if (itemInputs.length >= 4) {
      fireEvent.change(itemInputs[0], { target: { value: 'Submersible Impeller Pump' } });
      fireEvent.change(itemInputs[1], { target: { value: 'Hydraulic Valve and Hose' } });
      fireEvent.change(itemInputs[2], { target: { value: 'Electrical Switchgear Panel' } });
      fireEvent.change(itemInputs[3], { target: { value: 'General Mechanical Tool' } });
    }

    // Auto-Categorize All
    const autoCatBtn = screen.getByRole('button', { name: /AI Auto-Categorize All/i });
    fireEvent.click(autoCatBtn);

    // Edit quantity across all spinbuttons (both budget and item quantities)
    const numberInputs = screen.getAllByRole('spinbutton');
    numberInputs.forEach((inp) => {
      fireEvent.change(inp, { target: { value: '25' } });
      fireEvent.change(inp, { target: { value: '-5' } });
      fireEvent.change(inp, { target: { value: '0' } });
    });

    // Edit unit input
    const unitInputs = screen.getAllByPlaceholderText(/e.g. Units/i);
    unitInputs.forEach((inp) => {
      fireEvent.change(inp, { target: { value: 'Meters' } });
    });

    // Edit textarea specs
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach((ta) => {
      fireEvent.change(ta, { target: { value: 'Custom Grade Steel 345 MPa' } });
    });

    // Edit dropdowns on line items (major & minor)
    const selects = screen.getAllByRole('combobox');
    if (selects.length >= 2) {
      fireEvent.change(selects[0], { target: { value: 'Civil Works' } });
      fireEvent.change(selects[1], { target: { value: 'PEB Structure' } });
    }

    // Edit date
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach((d) => {
      fireEvent.change(d, { target: { value: '2026-10-15' } });
    });

    // Delete Line Item
    const deleteBtns = screen.queryAllByTitle(/Delete item/i);
    if (deleteBtns.length > 0) {
      fireEvent.click(deleteBtns[deleteBtns.length - 1]);
    }

    // Step progress indicator clicks
    const step1Indicator = screen.getByText(/STEP 1: INGESTION/i);
    fireEvent.click(step1Indicator);
    expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();

    // Click step 2 indicator
    const step2Indicator = screen.getByText(/STEP 2: MINOR CATEGORIZATION/i);
    fireEvent.click(step2Indicator);
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    // Click step 3 indicator
    const step3Indicator = screen.getByText(/3. STEP 3: SOURCING MODE/i);
    fireEvent.click(step3Indicator);
    expect(screen.getByText(/STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH/i)).toBeInTheDocument();

    jest.useRealTimers();
  });

  test('Step 3: Modes 1, 2, 3 switching, Mode 3 Vendor Selection, Profile Modal and RFQ Dispatch', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    renderWithProvider(<IngestionWizardVersion3Wrapper onComplete={onComplete} onCancel={jest.fn()} />);

    // Advance to Step 2
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Advance to Step 3
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i }));

    expect(screen.getByText(/STEP 3: SOURCING MODE SELECTION & STANDARD RFQ EMAIL DISPATCH/i)).toBeInTheDocument();

    // Preview Standard RFQ email header button
    const previewHeaderEmailBtns = screen.queryAllByRole('button', { name: /Preview Standard RFQ Email/i });
    if (previewHeaderEmailBtns.length > 0) {
      fireEvent.click(previewHeaderEmailBtns[0]);
    }

    // Mode 1 Selection & Preview Email for matched vendor & Dispatch in Mode 1
    const mode1Card = screen.getByTestId('mode-card-mode_1');
    fireEvent.click(mode1Card);

    let previewMatchedEmailBtns = screen.queryAllByRole('button', { name: /Preview Standard Email/i });
    if (previewMatchedEmailBtns.length > 0) {
      fireEvent.click(previewMatchedEmailBtns[0]);
    }

    // Mode 2 Selection & Preview Email
    const mode2Card = screen.getByTestId('mode-card-mode_2');
    fireEvent.click(mode2Card);

    previewMatchedEmailBtns = screen.queryAllByRole('button', { name: /Preview Standard Email/i });
    if (previewMatchedEmailBtns.length > 0) {
      fireEvent.click(previewMatchedEmailBtns[0]);
    }

    // Mode 3 Selection
    const mode3Card = screen.getByTestId('mode-card-mode_3');
    fireEvent.click(mode3Card);

    // Click vendor title button on card 0 to open profile
    const vendorNameBtns = screen.queryAllByRole('button', { name: /Match/i });
    if (vendorNameBtns.length > 0) {
      fireEvent.click(vendorNameBtns[0]);
      // Close profile with Close Profile button
      const closeBtn = screen.getByRole('button', { name: /Close Profile/i });
      fireEvent.click(closeBtn);
    }

    // Step 3: Test individual vendor selection toggle buttons
    let deselectBtns = screen.queryAllByTitle(/^Deselect vendor/i);
    if (deselectBtns.length > 0) {
      fireEvent.click(deselectBtns[0]);
    }

    // Select vendors 1, 2, 3, 4 to reach 5 vendors
    let selectBtns = screen.queryAllByTitle(/^Select vendor/i);
    if (selectBtns.length >= 4) {
      fireEvent.click(selectBtns[0]);
      fireEvent.click(selectBtns[1]);
      fireEvent.click(selectBtns[2]);
      fireEvent.click(selectBtns[3]);
    }

    // Attempting to select a 6th vendor triggers Maximum 5 Allowed toast
    selectBtns = screen.queryAllByTitle(/^Select vendor/i);
    if (selectBtns.length > 0) {
      fireEvent.click(selectBtns[0]);
    }

    // Deselect one vendor normally
    deselectBtns = screen.queryAllByTitle(/^Deselect vendor/i);
    if (deselectBtns.length > 0) {
      fireEvent.click(deselectBtns[0]);
    }

    // Click + Select Vendor card footer button
    const cardSelectBtns = screen.queryAllByRole('button', { name: /\+ Select Vendor/i });
    if (cardSelectBtns.length > 0) {
      fireEvent.click(cardSelectBtns[0]);
    }

    // Auto-Select Top 5 & Reset
    const top5Btn = screen.getByRole('button', { name: /Auto-Select Top 5/i });
    fireEvent.click(top5Btn);

    const resetBtn = screen.queryByRole('button', { name: /Reset \(Top 1\)/i });
    if (resetBtn) fireEvent.click(resetBtn);

    // Open profile modal for vendor 0
    let viewProfileBtns = screen.queryAllByRole('button', { name: /View Vendor Profile/i });
    if (viewProfileBtns.length > 0) {
      fireEvent.click(viewProfileBtns[0]);
      expect(screen.getByText(/Mode 3 Double-Blind Verification/i)).toBeInTheDocument();

      // Test Remove from Dispatch List if selected
      const removeBtn = screen.queryByRole('button', { name: /Remove from Dispatch List/i });
      if (removeBtn) {
        fireEvent.click(removeBtn);
      } else {
        const closeProfileBtn = screen.getByRole('button', { name: /Close Profile/i });
        fireEvent.click(closeProfileBtn);
      }
    }

    // Open profile modal again to test Select Vendor for RFQ
    viewProfileBtns = screen.queryAllByRole('button', { name: /View Vendor Profile/i });
    if (viewProfileBtns.length > 0) {
      fireEvent.click(viewProfileBtns[0]);
      const selectInModalBtn = screen.queryByRole('button', { name: /Select Vendor for RFQ/i });
      if (selectInModalBtn) {
        fireEvent.click(selectInModalBtn);
      } else {
        fireEvent.click(screen.getByRole('button', { name: /Close Profile/i }));
      }
    }

    // Open profile modal again and close with X button
    viewProfileBtns = screen.queryAllByRole('button', { name: /View Vendor Profile/i });
    if (viewProfileBtns.length > 0) {
      fireEvent.click(viewProfileBtns[0]);
      const modalCloseX = document.querySelector('.space-y-5 button.p-1\\.5.rounded-xl') as HTMLButtonElement;
      if (modalCloseX) {
        fireEvent.click(modalCloseX);
      } else {
        fireEvent.click(screen.getByRole('button', { name: /Close Profile/i }));
      }
    }

    // Back to Step 2 and return to Step 3
    const backBtn = screen.getByRole('button', { name: /Back to Review/i });
    fireEvent.click(backBtn);
    expect(screen.getByText(/STEP 2: REVIEW ENTITIES & MINOR CATEGORY CLASSIFICATION/i)).toBeInTheDocument();

    const proceedBtn = screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i });
    fireEvent.click(proceedBtn);

    // Switch to Mode 3
    const mode3CardFinal = screen.getByTestId('mode-card-mode_3');
    fireEvent.click(mode3CardFinal);

    // Auto-select Top 5
    const selectTop5Again = screen.getByRole('button', { name: /Auto-Select Top 5/i });
    fireEvent.click(selectTop5Again);

    // Mode 3 Dispatch
    const dispatchBtn = screen.getByRole('button', { name: /DISPATCH STANDARD RFQ EMAILS/i });
    fireEvent.click(dispatchBtn);

    expect(onComplete).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('Upgrade Warning Branches on Subscription Lock (Version 1, 2, 3)', () => {
    jest.useFakeTimers();

    // Version 1 tests
    const { unmount: unmountV1 } = renderWithProvider(<IngestionWizardVersion1Wrapper />);
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i }));

    const mode2Card = screen.getByTestId('mode-card-mode_2');
    fireEvent.click(mode2Card);

    const mode3Card = screen.getByTestId('mode-card-mode_3');
    fireEvent.click(mode3Card);
    unmountV1();

    // Version 2 tests
    const { unmount: unmountV2 } = renderWithProvider(<IngestionWizardVersion2Wrapper />);
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i }));

    const mode3CardV2 = screen.getByTestId('mode-card-mode_3');
    fireEvent.click(mode3CardV2);
    unmountV2();

    // Version 3 tests
    const { unmount: unmountV3 } = renderWithProvider(<IngestionWizardVersion3Wrapper />);
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Step 2: Interactive Review & Taxonomy/i }));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode & Vendor Matching/i }));
    fireEvent.click(screen.getByTestId('mode-card-mode_3'));
    unmountV3();

    jest.useRealTimers();
  });

  test('Vendor Master Data Management: Manual Add, Minor categories, Excel bulk upload, Credentials & Reminders', () => {
    jest.useFakeTimers();
    renderWithProvider(<IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} />);

    // Switch between manual and excel tabs
    const manualTabBtn = screen.getByRole('button', { name: /Manual/i });
    fireEvent.click(manualTabBtn);

    // Download CSV template
    const downloadTemplateBtn = screen.getByRole('button', { name: /Sample Template \(\.csv\)/i });
    fireEvent.click(downloadTemplateBtn);

    // Vendor master management: Add Vendor toggle
    const addVendorBtn = screen.getByRole('button', { name: /Click to Add New Vendor/i });
    fireEvent.click(addVendorBtn);

    // 1. Submit with empty fields (trigger validation warning)
    const saveVendorBtn = screen.getByRole('button', { name: /Save & Categorize Vendor/i });
    fireEvent.click(saveVendorBtn);

    // 2. Submit with missing contact person
    const vendorNameInput = screen.getByPlaceholderText(/e.g. Apex Supplies Ltd./i);
    fireEvent.change(vendorNameInput, { target: { value: 'Delta Dynamics Corp' } });
    fireEvent.click(saveVendorBtn);

    // 3. Submit with missing email
    const contactPersonInput = screen.getByPlaceholderText(/e.g. Rajesh Nair/i);
    fireEvent.change(contactPersonInput, { target: { value: 'Deepak Verma' } });
    fireEvent.click(saveVendorBtn);

    // 4. Fill in email
    const emailInput = screen.getByPlaceholderText(/vendor@company.com/i);
    fireEvent.change(emailInput, { target: { value: 'deepak@deltadynamics.com' } });

    const phoneInput = screen.getByPlaceholderText(/\+91 98201 44820/i);
    fireEvent.change(phoneInput, { target: { value: '+91 98201 99999' } });

    const locationInput = screen.getByPlaceholderText(/Mumbai, MH/i);
    fireEvent.change(locationInput, { target: { value: 'Pune, MH' } });

    // Major category change on new vendor
    const vendorMajorSelect = screen.getAllByRole('combobox').find(sel => sel.innerHTML.includes('Engineering Spares - Mechanical'));
    if (vendorMajorSelect) {
      fireEvent.change(vendorMajorSelect, { target: { value: 'Civil Works' } });
    }

    // Clear minor categories and try saving (trigger validation warning)
    const clearMinorsBtn = screen.getByRole('button', { name: /Clear/i });
    fireEvent.click(clearMinorsBtn);
    fireEvent.click(saveVendorBtn);

    // Select All minor categories
    const selectAllMinorsBtn = screen.getByRole('button', { name: /Select All/i });
    fireEvent.click(selectAllMinorsBtn);

    // Toggle individual minor tag
    const minorTags = screen.queryAllByRole('button', { name: /PEB Structure|Roofing Sheets|TMT BARS/i });
    if (minorTags.length > 0) {
      fireEvent.click(minorTags[0]);
      fireEvent.click(minorTags[0]);
    }

    // Close form using X button
    const closeFormXBtn = document.querySelector('.space-y-3 button.text-slate-400') as HTMLButtonElement;
    if (closeFormXBtn) fireEvent.click(closeFormXBtn);

    // Reopen and test Cancel button
    fireEvent.click(screen.getByRole('button', { name: /Click to Add New Vendor/i }));
    const cancelFormBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelFormBtn);

    // Reopen and save
    fireEvent.click(screen.getByRole('button', { name: /Click to Add New Vendor/i }));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Apex Supplies Ltd./i), { target: { value: 'Delta Dynamics Corp' } });
    fireEvent.change(screen.getByPlaceholderText(/e.g. Rajesh Nair/i), { target: { value: 'Deepak Verma' } });
    fireEvent.change(screen.getByPlaceholderText(/vendor@company.com/i), { target: { value: 'deepak@deltadynamics.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Select All/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save & Categorize Vendor/i }));

    // Switch to Excel Upload Method
    const excelMethodBtn = screen.getByRole('button', { name: /Excel Upload/i });
    fireEvent.click(excelMethodBtn);

    // Vendor bulk upload simulation
    const bulkUploadDrop = screen.getByText(/Drag & Drop Vendor Master Spreadsheet/i);
    fireEvent.click(bulkUploadDrop);
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Vendor search filter (search by vendor name, contact person, minor category)
    const vendorSearchInput = screen.getByPlaceholderText(/Search vendor or minor category/i);
    fireEvent.change(vendorSearchInput, { target: { value: 'Apex' } });
    fireEvent.change(vendorSearchInput, { target: { value: 'Deepak' } });
    fireEvent.change(vendorSearchInput, { target: { value: 'Pumps' } });
    fireEvent.change(vendorSearchInput, { target: { value: 'Hoses' } });
    fireEvent.change(vendorSearchInput, { target: { value: 'NonExistentVendor' } });
    fireEvent.change(vendorSearchInput, { target: { value: '' } });

    // Major Category filter dropdown
    const majorCategorySelect = screen.getAllByRole('combobox').find(sel => sel.innerHTML.includes('All Major Categories'));
    if (majorCategorySelect) {
      fireEvent.change(majorCategorySelect, { target: { value: 'Engineering Spares - Electrical' } });
      fireEvent.change(majorCategorySelect, { target: { value: 'ALL' } });
    }

    // View Dispatched Onboarding Email Modal
    const viewEmailBtns = screen.getAllByRole('button', { name: /View Email & Credentials/i });
    if (viewEmailBtns.length > 0) {
      fireEvent.click(viewEmailBtns[0]);
      expect(screen.getByText(/Official Vendor Onboarding Invitation & Credentials/i)).toBeInTheDocument();

      // Copy credentials to clipboard
      const copyBtn = screen.getByRole('button', { name: /Copy Login Credentials/i });
      fireEvent.click(copyBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      // Close modal
      const closeEmailBtn = screen.getByRole('button', { name: /Close Email Preview/i });
      fireEvent.click(closeEmailBtn);
    }

    // View Dispatched Onboarding Email Modal on a second vendor if available and close with X
    if (viewEmailBtns.length > 1) {
      fireEvent.click(viewEmailBtns[1]);
      const modalCloseX = document.querySelector('button.p-1\\.5.rounded-xl.text-slate-400') as HTMLButtonElement;
      if (modalCloseX) {
        fireEvent.click(modalCloseX);
      } else {
        const closeEmailBtn = screen.getByRole('button', { name: /Close Email Preview/i });
        fireEvent.click(closeEmailBtn);
      }
    }

    // Trigger Day 3 Reminder
    const reminderBtns = screen.getAllByRole('button', { name: /Simulate Day 3 Reminder/i });
    reminderBtns.forEach((btn) => {
      fireEvent.click(btn);
    });

    // Delete Vendor
    const deleteVendorBtns = screen.queryAllByTitle(/Delete vendor/i);
    deleteVendorBtns.forEach((btn) => {
      fireEvent.click(btn);
    });

    jest.useRealTimers();
  });
});
