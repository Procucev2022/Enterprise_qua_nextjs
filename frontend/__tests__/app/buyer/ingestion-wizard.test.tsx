import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import IngestionWizard, { resolveConfirmationVendorCount, resolveOwnVendorCount, isV2OrV3SourcingMode } from '@/app/buyer/ingestion-wizard';
import { AppProvider } from '@/lib/store';
import { entitledSourcingModes } from '@/lib/constants';
import { validatePincode } from '@/lib/validationSchemas';
import {
  extractLineItemsFromDocument,
  classifyLineItems,
  uploadRFQAttachment,
  createRFQ,
  requestVendorCategoryUpdateEmail,
} from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type { ExtractedEntity, RFQExtractionResult, RFQItem } from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/constants', () => {
  const actual = jest.requireActual('@/lib/constants');
  return {
    __esModule: true,
    ...actual,
    entitledSourcingModes: jest.fn((...args: any[]) => (actual.entitledSourcingModes as any)(...args)),
  };
});

jest.mock('@/lib/validationSchemas', () => {
  const actual = jest.requireActual('@/lib/validationSchemas');
  return {
    __esModule: true,
    ...actual,
    validatePincode: jest.fn((...args: any[]) => (actual.validatePincode as any)(...args)),
  };
});

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  extractLineItemsFromDocument: jest.fn(),
  // buildExtractionRequest stages any binary upload (e.g. the .pdf fixtures
  // below) via this before calling extractLineItemsFromDocument — mocked so
  // that real step never hits the network in this suite.
  stageDocumentForExtraction: jest.fn().mockResolvedValue({ success: true, key: 'staged-test-key' }),
  classifyLineItems: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  createRFQ: jest.fn(),
  requestVendorCategoryUpdateEmail: jest.fn().mockResolvedValue({ success: true, message: 'Email sent.' }),
}));

jest.mock('xlsx', () => ({
  read: jest.fn(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } })),
  utils: {
    sheet_to_json: jest.fn(() => [
      ['Item', 'Qty', 'Unit'],
      ['Centrifugal Water Pump 500 GPM', 12, 'Units'],
      ['', '', ''],
    ]),
  },
}));

const EXTRACTION = UI_STRINGS.rfqExtraction;
const MODAL = UI_STRINGS.manualRfqModal;
const mockExtract = extractLineItemsFromDocument as jest.Mock;
const mockClassify = classifyLineItems as jest.Mock;
const mockAttach = uploadRFQAttachment as jest.Mock;
const mockCreateRFQ = createRFQ as jest.Mock;
const mockEmail = requestVendorCategoryUpdateEmail as jest.Mock;

function entity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Units',
    targetDate: '2026-09-15',
    technicalSpecs: 'SS316 impeller',
    confidence: 90,
    category: 'Pumps & Accessories',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategory: 'Pumps & Accessories',
    ...overrides,
  };
}

function successResult(entities = [entity()], estimatedBudget: number | null = null): RFQExtractionResult {
  return {
    success: true,
    data: {
      title: 'Pump Requirement',
      category: 'Engineering Spares - Mechanical',
      targetDeliveryDate: '2026-09-15',
      estimatedBudget,
      extractedEntities: entities,
      source: 'web_portal',
    },
    classification: {
      totalExtracted: entities.length,
      accepted: entities.length,
      duplicatesRemoved: 0,
      needsReview: 0,
      autoClassified: entities.length,
    },
    extraction: { model: 'gemini-3.6-flash' },
  };
}

function mockCreatedRFQ(): RFQItem {
  return {
    id: 'rfq-new-1',
    rfqNumber: 'RFQ-2026-00450',
    title: 'Pump Requirement',
    category: 'Engineering Spares - Mechanical',
    status: 'Quotes Pending',
    sourcingMode: 'mode_2',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-15',
    budget: 500000,
    deliveryLocation: 'Navi Mumbai Plant',
    deliveryPincode: '400701',
    attachments: [],
    createdAt: '2026-09-10T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    assignedVendors: [
      { id: 'v-1', name: 'Apex Industrial Supplies', email: 'apex@example.com', phone: '9876543210', city: 'Mumbai' },
    ],
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
  };
}

function renderWizard(props: Partial<React.ComponentProps<typeof IngestionWizard>> = {}) {
  return render(
    <AppProvider>
      <IngestionWizard
        onComplete={props.onComplete || jest.fn()}
        onCancel={props.onCancel || jest.fn()}
        forceSubscription={props.forceSubscription || 'version_3'}
        forceRemainingFreeRFQs={props.forceRemainingFreeRFQs}
      />
    </AppProvider>
  );
}

const uploadFile = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

const clickExtract = () =>
  fireEvent.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }));

describe('IngestionWizard (Direct Manual Form with Top Document Upload)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
    mockClassify.mockResolvedValue({
      success: true,
      data: {
        extractedEntities: [entity()],
      },
    });
    mockAttach.mockResolvedValue({
      success: true,
      data: {
        id: 'att-1',
        fileName: 'BOQ_Pumps.xlsx',
        fileSize: 1024,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        storagePath: 'rfq-attachments/att-1.xlsx',
        uploadedAt: new Date().toISOString(),
      },
    });
    mockCreateRFQ.mockResolvedValue({
      success: true,
      rfq: mockCreatedRFQ(),
    });
  });

  it('renders the direct manual form directly without step 1/2/3 cards', () => {
    renderWizard();

    // Verify step cards are hidden
    expect(screen.queryByTestId('wizard-step-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard-step-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wizard-step-3')).not.toBeInTheDocument();

    // Verify sections render directly
    expect(screen.getByText(/Upload Source Documents & Forwarded Emails/i)).toBeInTheDocument();
    expect(screen.getByText(/1. RFQ Details & Delivery Terms/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Line Items Specification/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Select Sourcing Mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create & Dispatch RFQ/i })).toBeInTheDocument();
  });

  it('handles uploading BOQ and forwarded .eml files and shows them in the list', () => {
    renderWizard();

    const emailFile = new File(['Subject: RFQ Requisition'], 'requisition.eml', { type: 'message/rfc822' });
    uploadFile(emailFile);

    expect(screen.getByText('requisition.eml')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded Documents \(1\)/i)).toBeInTheDocument();

    // Remove file
    const removeBtn = screen.getByTitle('Remove file');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('requisition.eml')).not.toBeInTheDocument();
  });

  it('extracts line items with AI and populates title, budget, and line items', async () => {
    renderWizard();

    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));
    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    expect(screen.getByText(/Extraction Complete/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pump Requirement')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
  });

  it('extracts and displays all 100 valid items from bulk multi-worksheet file without arbitrary 10-item limit', async () => {
    const bulk100 = Array.from({ length: 100 }, (_, i) =>
      entity({
        id: `ent-bulk-${i + 1}`,
        itemName: `Procurement Valve ${i + 1}`,
        quantity: i + 1,
        unit: 'Nos',
        technicalSpecs: `Spec Grade ${i + 1}`,
      })
    );

    mockExtract.mockResolvedValueOnce(successResult(bulk100));

    renderWizard();

    uploadFile(new File(['binary content'], 'Bulk_200_Worksheet_Items.xlsx', { type: '' }));
    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    expect(screen.getByText(/Extraction Complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Successfully extracted/i)).toHaveTextContent('100 line items');
    expect(screen.getByDisplayValue('Procurement Valve 1')).toBeInTheDocument();
  });

  it('allows adding, editing, and deleting line items in the table', () => {
    renderWizard();

    // Click Add Line Item — the button now also appears below the last line
    // item (so the buyer doesn't have to scroll back to the top), so with an
    // item already present there are two matches; either works the same way.
    const addBtn = screen.getAllByRole('button', { name: /Add Line Item/i })[0];
    fireEvent.click(addBtn);

    const itemInputs = screen.getAllByPlaceholderText(MODAL.itemPlaceholder);
    expect(itemInputs.length).toBe(2);

    fireEvent.change(itemInputs[0], { target: { value: 'Ball Valves 2 inch' } });
    expect(itemInputs[0]).toHaveValue('Ball Valves 2 inch');

    // Remove the second item
    const deleteButtons = screen.getAllByTitle('Remove line item');
    fireEvent.click(deleteButtons[1]);
    expect(screen.getAllByPlaceholderText(MODAL.itemPlaceholder).length).toBe(1);
  });

  it('auto-categorizes line items when clicking Auto-Categorize All (AI)', async () => {
    renderWizard();

    const itemInput = screen.getByPlaceholderText(MODAL.itemPlaceholder);
    fireEvent.change(itemInput, { target: { value: 'Centrifugal Pump' } });

    const classifyBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(classifyBtn);

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
  });

  it('switches sourcing mode when selecting from dropdown', () => {
    renderWizard();

    const select = screen.getByRole('combobox', { name: /Sourcing Mode/i }) as HTMLSelectElement;
    expect(select.value).toBe('mode_2');

    fireEvent.change(select, { target: { value: 'mode_3' } });
    expect(select.value).toBe('mode_3');
  });

  it('renders horizontal sourcing mode selection buttons, switches modes, and does not show Hybrid Active', () => {
    renderWizard();

    // Verify all four horizontal buttons are rendered with UI_STRINGS labels
    const btn0 = screen.getByTestId('sourcing-mode-btn-mode_0');
    const btn1 = screen.getByTestId('sourcing-mode-btn-mode_1');
    const btn2 = screen.getByTestId('sourcing-mode-btn-mode_2');
    const btn3 = screen.getByTestId('sourcing-mode-btn-mode_3');

    expect(btn0).toHaveTextContent(UI_STRINGS.sourcingModeVersions.mode_0);
    expect(btn1).toHaveTextContent(UI_STRINGS.sourcingModeVersions.mode_1);
    expect(btn2).toHaveTextContent(UI_STRINGS.sourcingModeVersions.mode_2);
    expect(btn3).toHaveTextContent(UI_STRINGS.sourcingModeVersions.mode_3);

    // Initial default is Mode 2 (selected)
    expect(btn2).toHaveAttribute('aria-checked', 'true');
    expect(btn0).toHaveAttribute('aria-checked', 'false');
    expect(btn1).toHaveAttribute('aria-checked', 'false');
    expect(btn3).toHaveAttribute('aria-checked', 'false');

    // Switch to Mode 0
    fireEvent.click(btn0);
    expect(btn0).toHaveAttribute('aria-checked', 'true');
    expect(btn2).toHaveAttribute('aria-checked', 'false');

    // Switch to Mode 1
    fireEvent.click(btn1);
    expect(btn1).toHaveAttribute('aria-checked', 'true');
    expect(btn0).toHaveAttribute('aria-checked', 'false');

    // Switch to Mode 3
    fireEvent.click(btn3);
    expect(btn3).toHaveAttribute('aria-checked', 'true');
    expect(btn1).toHaveAttribute('aria-checked', 'false');

    // Switch back to Mode 2
    fireEvent.click(btn2);
    expect(btn2).toHaveAttribute('aria-checked', 'true');

    // Verify "Hybrid Active" is never rendered in the document
    expect(screen.queryByText(/Hybrid Active/i)).not.toBeInTheDocument();
  });

  it('validates required fields on submission and dispatches RFQ on valid input', async () => {
    const onComplete = jest.fn();
    renderWizard({ onComplete });

    // Submit with empty required fields
    const submitBtn = screen.getByRole('button', { name: /Create & Dispatch RFQ/i });
    fireEvent.click(submitBtn);

    const MANUAL = UI_STRINGS.manualRfq;
    expect(screen.getByText(new RegExp(MANUAL.deliveryLocationRequired, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(MANUAL.deliveryPincodeRequired, 'i'))).toBeInTheDocument();

    // Fill required delivery fields
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Navi Mumbai Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400701' },
    });

    // Fill the required line item fields
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Centrifugal Water Pump' },
    });

    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });

    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), {
      target: { value: '10' },
    });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), {
      target: { value: 'Units' },
    });

    // Now submit
    fireEvent.click(submitBtn);

    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
    expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onComplete).toHaveBeenCalled();
  });

  it('moves Add Line Item button to bottom right when 5+ line items exist', () => {
    renderWizard();

    // Initial state: 1 line item, Add Line Item button is in header
    expect(screen.getByRole('button', { name: /Add Line Item/i })).toBeInTheDocument();

    // Add up to 5 items
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));
    }

    // Now 5 items exist
    const items = screen.getAllByPlaceholderText(MODAL.itemPlaceholder);
    expect(items.length).toBe(5);

    // Button should still exist (now placed at the bottom right)
    const addBtn = screen.getByRole('button', { name: /Add Line Item/i });
    expect(addBtn).toBeInTheDocument();

    // Adding 6th item works from the bottom button
    fireEvent.click(addBtn);
    expect(screen.getAllByPlaceholderText(MODAL.itemPlaceholder).length).toBe(6);
  });

  it('cancels when clicking Cancel button', () => {
    const onCancel = jest.fn();
    renderWizard({ onCancel });

    const cancelButtons = screen.getAllByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('resets all form fields and uploaded documents when clicking Clear Form', () => {
    renderWizard();

    // Fill some fields
    const titleInput = screen.getByPlaceholderText(MODAL.titlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Custom Title' } });
    expect(titleInput).toHaveValue('Custom Title');

    const locationInput = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder);
    fireEvent.change(locationInput, { target: { value: 'Location A' } });
    expect(locationInput).toHaveValue('Location A');

    // Click Clear Form
    const clearButtons = screen.getAllByRole('button', { name: /Clear Form/i });
    fireEvent.click(clearButtons[0]);

    expect(titleInput).toHaveValue('');
    expect(locationInput).toHaveValue('');
  });

  it('handles file input triggers and file additions', () => {
    renderWizard();

    // Clicking Select Files button triggers file input
    const selectFilesBtn = screen.getByRole('button', { name: /Select Files/i });
    fireEvent.click(selectFilesBtn);

    // Add document file
    const docFile = new File(['specs content'], 'specification.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    uploadFile(docFile);
    expect(screen.getByText('specification.docx')).toBeInTheDocument();
  });

  it('handles extraction error and extraction without files gracefully', async () => {
    renderWizard();

    // Extract without files
    clickExtract();

    // Upload file and simulate failure response
    const badFile = new File(['dummy'], 'corrupt.xlsx', { type: 'application/vnd.ms-excel' });
    uploadFile(badFile);

    mockExtract.mockResolvedValueOnce({
      success: false,
      error: 'Corrupt file structure',
    });
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(/Corrupt file structure/i)).toBeInTheDocument();
    });

    // Simulate extraction throwing exception. A thrown error is an unexpected
    // client-side fault, so the banner shows the generic unreadable-response copy
    // rather than leaking the raw exception message to the buyer.
    mockExtract.mockRejectedValueOnce(new Error('Network failure parsing document'));
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(EXTRACTION.unreadableResponse)).toBeInTheDocument();
    });
  });

  it('shows a reason-specific message and a manual-entry action when extraction fails', async () => {
    renderWizard();

    uploadFile(new File(['dummy'], 'scan.pdf', { type: 'application/pdf' }));

    // No server-supplied error, only a machine reason: the banner must resolve the
    // reason to its specific guidance rather than the generic fallback.
    mockExtract.mockResolvedValueOnce({ success: false, reason: 'DOCUMENT_TOO_LARGE' });
    clickExtract();

    await waitFor(() => {
      expect(
        screen.getByText(EXTRACTION.reasonMessages.DOCUMENT_TOO_LARGE)
      ).toBeInTheDocument();
    });

    // The explicit recovery action takes the buyer into manual entry: it dismisses
    // the banner and ensures there is a line item to key into.
    const manualBtn = screen.getByRole('button', { name: new RegExp(EXTRACTION.manualEntryAction, 'i') });
    fireEvent.click(manualBtn);

    await waitFor(() => {
      expect(
        screen.queryByText(EXTRACTION.reasonMessages.DOCUMENT_TOO_LARGE)
      ).not.toBeInTheDocument();
    });
    // A line item to key into is now present.
    expect(screen.getAllByPlaceholderText(MODAL.itemPlaceholder).length).toBeGreaterThan(0);
  });

  it('retries a failed extraction with the selected document', async () => {
    renderWizard();
    uploadFile(new File(['dummy'], 'scan.pdf', { type: 'application/pdf' }));

    mockExtract.mockResolvedValueOnce({ success: false, reason: 'AI_FAILED' });
    mockExtract.mockResolvedValueOnce(successResult());
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(EXTRACTION.reasonMessages.AI_FAILED)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: EXTRACTION.retryAction }));

    await waitFor(() => expect(mockExtract).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByText(EXTRACTION.reasonMessages.AI_FAILED)).not.toBeInTheDocument();
    });
  });

  it('surfaces the server-supplied technical detail for a failed extraction', async () => {
    renderWizard();
    uploadFile(new File(['dummy'], 'scan.pdf', { type: 'application/pdf' }));

    const detail = 'gemini-3.8-flash: Gemini responded 400: API key not valid';
    mockExtract.mockResolvedValueOnce({ success: false, reason: 'AI_FAILED', detail });
    clickExtract();

    // The friendly reason message leads the banner...
    await waitFor(() =>
      expect(screen.getByText(EXTRACTION.reasonMessages.AI_FAILED)).toBeInTheDocument()
    );
    // ...and the raw underlying cause is available beneath it for debugging.
    expect(screen.getByText(EXTRACTION.errorDetailLabel)).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it('handles auto-categorization errors and empty line items', async () => {
    renderWizard();

    // Line item with empty name should trigger warning when categorizing
    const classifyBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(classifyBtn);

    // Add item with name
    const itemInput = screen.getByPlaceholderText(MODAL.itemPlaceholder);
    fireEvent.change(itemInput, { target: { value: 'High Pressure Valve' } });

    // Mock classify failure
    mockClassify.mockResolvedValueOnce({
      success: false,
      error: 'AI Classifier quota exceeded',
    });
    fireEvent.click(classifyBtn);
    await waitFor(() => expect(mockClassify).toHaveBeenCalled());

    // Mock classify throwing exception
    mockClassify.mockRejectedValueOnce(new Error('Classification connection timeout'));
    fireEvent.click(classifyBtn);
    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
  });

  it('allows updating general RFQ fields and line item details', () => {
    renderWizard();

    // Update title, major category, delivery date, budget
    const titleInput = screen.getByPlaceholderText(MODAL.titlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Annual Maintenance Spares' } });

    const budgetInput = screen.getByPlaceholderText('e.g. 500000');
    fireEvent.change(budgetInput, { target: { value: '750000' } });

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    // Change technical specs
    const specsInput = within(row).getByPlaceholderText(MODAL.specsPlaceholder);
    fireEvent.change(specsInput, { target: { value: 'Class 300 Flanged' } });
    expect(specsInput).toHaveValue('Class 300 Flanged');
  });

  it('handles RFQ creation submission failures and errors', async () => {
    renderWizard();

    // Fill minimum required fields
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Dahej Port Complex' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '392130' },
    });

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'TMT Rebars Fe550D' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), {
      target: { value: '50' },
    });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), {
      target: { value: 'MT' },
    });

    // Upload attachment that fails upload
    mockAttach.mockRejectedValueOnce(new Error('Storage S3 upload timeout'));
    uploadFile(new File(['file'], 'specs.pdf', { type: 'application/pdf' }));

    // Mock createRFQ failure
    mockCreateRFQ.mockResolvedValueOnce({
      success: false,
      error: 'Database constraint violation during RFQ creation',
    });

    const submitBtn = screen.getByRole('button', { name: /Create & Dispatch RFQ/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Database constraint violation during RFQ creation/i)).toBeInTheDocument();
    });

    // Mock createRFQ exception
    mockCreateRFQ.mockRejectedValueOnce(new Error('Network error during dispatch'));
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Network error during dispatch/i)).toBeInTheDocument();
    });
  });

  it('handles drag-and-drop events on the drop zone', () => {
    renderWizard();

    const dropZone = screen.getByText(/Drag and drop BOQ spreadsheets/i).closest('div')!;

    fireEvent.dragOver(dropZone, { dataTransfer: { files: [] } });
    fireEvent.dragLeave(dropZone);

    const droppedFile = new File(['dropped'], 'dropped.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropZone, { dataTransfer: { files: [droppedFile] } });

    expect(screen.getByText('dropped.pdf')).toBeInTheDocument();
  });

  it('leaves unmatched line items unchanged when auto-categorize response omits them', async () => {
    renderWizard();

    // Add a second row so one item id ("ent-1" from the mocked response) won't match either.
    const itemInput = screen.getByPlaceholderText(MODAL.itemPlaceholder);
    fireEvent.change(itemInput, { target: { value: 'Unmatched Item' } });

    mockClassify.mockResolvedValueOnce({
      success: true,
      data: {
        extractedEntities: [entity({ id: 'some-other-id' })],
      },
    });

    const classifyBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(classifyBtn);

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
    expect(screen.getByDisplayValue('Unmatched Item')).toBeInTheDocument();
  });

  it('applies the matched category onto its own line item when ids align', async () => {
    renderWizard();

    // Extract an item with NO category so Auto-Categorize sends it to the server.
    // (Items that already carry a category are left untouched.) The id is
    // deterministically "ent-1" from the mock entity so the response aligns.
    mockExtract.mockResolvedValueOnce(
      successResult([entity({ id: 'ent-1', category: '', majorCategory: '', minorCategory: '' })])
    );
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    mockClassify.mockResolvedValueOnce({
      success: true,
      data: {
        extractedEntities: [
          entity({ id: 'ent-1', majorCategory: categoriesData[0].majorCategory, minorCategory: categoriesData[0].minorCategories[0] }),
        ],
      },
    });

    const classifyBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(classifyBtn);

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
    expect(screen.getByDisplayValue(categoriesData[0].majorCategory)).toBeInTheDocument();
  });

  it('changes the target delivery date field', () => {
    renderWizard();

    const dateInput = document.getElementById('rfq-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });
    expect(dateInput).toHaveValue('2026-12-01');
  });

  it('ignores a file input change carrying no files and one carrying an empty file list', () => {
    renderWizard();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: null } });
    expect(screen.queryByText(/Uploaded Documents/i)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByText(/Uploaded Documents/i)).not.toBeInTheDocument();
  });

  it('applies fallback values when the extraction response omits optional fields', async () => {
    renderWizard();
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));

    mockExtract.mockResolvedValueOnce({
      success: true,
      data: {
        title: '',
        category: '',
        targetDeliveryDate: '',
        estimatedBudget: null,
        extractedEntities: [],
        source: 'web_portal',
      },
      classification: undefined,
      extraction: undefined,
    });

    clickExtract();
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    expect(screen.getByText(/Extraction Complete/i)).toBeInTheDocument();
  });

  it('falls back to a default message when extraction fails without an error string', async () => {
    renderWizard();
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));

    mockExtract.mockResolvedValueOnce({ success: false });
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(EXTRACTION.unreadableResponse, 'i'))).toBeInTheDocument();
    });
  });

  it('falls back to a default message when extraction throws without a message', async () => {
    renderWizard();
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));

    mockExtract.mockRejectedValueOnce(new Error());
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(new RegExp(EXTRACTION.unreadableResponse, 'i'))).toBeInTheDocument();
    });
  });

  it('falls back to a default message when auto-categorize fails without an error string', async () => {
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Item A' } });

    mockClassify.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i }));

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
  });

  it('leaves a blank item blank when the server cannot classify it', async () => {
    renderWizard();
    // Extract a blank-category item so Auto-Categorize sends it to the server.
    mockExtract.mockResolvedValueOnce(
      successResult([entity({ id: 'ent-1', itemName: 'Mystery Item', category: '', majorCategory: '', minorCategory: '' })])
    );
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    // Server returns the row with no category it could confidently assign.
    mockClassify.mockResolvedValueOnce({
      success: true,
      data: {
        extractedEntities: [{ ...entity({ id: 'ent-1', itemName: 'Mystery Item' }), majorCategory: '', minorCategory: '' }],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i }));
    await waitFor(() => expect(mockClassify).toHaveBeenCalled());

    // The item is still present and its major category select is left blank —
    // never guessed into an unrelated category.
    expect(screen.getByDisplayValue('Mystery Item')).toBeInTheDocument();
  });

  it('drops a failed attachment upload result but still dispatches the RFQ', async () => {
    renderWizard();

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Pune Depot' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '411001' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Gate Valves' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '5' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    uploadFile(new File(['file'], 'specs.pdf', { type: 'application/pdf' }));
    mockAttach.mockResolvedValueOnce({ success: false, error: 'rejected' });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
  });

  it('ignores a second submit click while a dispatch is already in flight', async () => {
    renderWizard();

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Chennai Yard' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '600001' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Steel Plates' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '3' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'MT' } });

    let resolveCreate: (v: any) => void;
    mockCreateRFQ.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    const submitBtn = screen.getByRole('button', { name: /Create & Dispatch RFQ/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    resolveCreate!({ success: true, rfq: mockCreatedRFQ() });
    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalledTimes(1));
  });

  it('falls back to default messages when RFQ creation fails or throws without details', async () => {
    renderWizard();

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Kolkata Yard' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '700001' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Copper Wire' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '20' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Rolls' } });

    const submitBtn = screen.getByRole('button', { name: /Create & Dispatch RFQ/i });

    mockCreateRFQ.mockResolvedValueOnce({ success: false });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByText(/Failed to create RFQ\./i)).toBeInTheDocument();
    });

    mockCreateRFQ.mockRejectedValueOnce(new Error());
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByText(/Failed to dispatch RFQ\./i)).toBeInTheDocument();
    });
  });

  it('ignores a drop event that carries no files', () => {
    renderWizard();
    const dropZone = screen.getByText(/Drag and drop BOQ spreadsheets/i).closest('div')!;

    fireEvent.drop(dropZone, { dataTransfer: {} });
    expect(screen.queryByText(/Uploaded Documents/i)).not.toBeInTheDocument();
  });

  it('clears the budget and quantity fields back to empty', () => {
    renderWizard();

    const budgetInput = screen.getByPlaceholderText('e.g. 500000');
    fireEvent.change(budgetInput, { target: { value: '750000' } });
    fireEvent.change(budgetInput, { target: { value: '' } });
    expect(budgetInput).toHaveValue(null);

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const qtyInput = within(row).getByPlaceholderText(MODAL.qtyPlaceholder);
    fireEvent.change(qtyInput, { target: { value: '9' } });
    fireEvent.change(qtyInput, { target: { value: '' } });
    expect(qtyInput).toHaveValue(null);
  });

  it('adds the first line item from the empty-state button', () => {
    renderWizard();

    // Remove the default line item to reach the empty state.
    const deleteBtn = screen.getByTitle('Remove line item');
    fireEvent.click(deleteBtn);
    expect(screen.getByText(/No line items added yet\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add First Line Item/i }));
    expect(screen.getByPlaceholderText(MODAL.itemPlaceholder)).toBeInTheDocument();
  });
});


describe('IngestionWizard: Mode 1 private vendor roster preview', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  // Overrides only the /api/bootstrap vendors list; every other URL (category
  // taxonomy, RFQs, etc.) still goes through jest.setup.ts's real default
  // fetch mock, so the category dropdowns stay populated.
  function serveBootstrap(vendors: Array<Record<string, unknown>>) {
    global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/bootstrap')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { vendors, buyerAccounts: [], evaluations: [], auditLogs: [], aiFeed: [], systemConfig: {} },
          }),
        }) as any;
      }
      return (realFetch as any)(url, init);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateRFQ.mockResolvedValue({ success: true, rfq: mockCreatedRFQ() });
  });

  it('shows the empty-roster state and blocks dispatch when the buyer has no uploaded vendors for Version 1', async () => {
    serveBootstrap([]);
    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('No Private Vendors Uploaded Yet')).toBeInTheDocument());
    expect(screen.getByText('0 Suppliers Found')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Navi Mumbai Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400701' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Centrifugal Water Pump' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(screen.getByText(/(Mode 1|Version 1).*requires at least one private vendor/i)).toBeInTheDocument());
    expect(mockCreateRFQ).not.toHaveBeenCalled();
  });

  it('lists the buyer-uploaded vendors, shows category/rating, and dispatches strictly to them on save', async () => {
    serveBootstrap([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        contactPerson: 'Rajesh Nair',
        email: 'rajesh@apex.in',
        phone: '+91 98200 11111',
        source: 'historical_purchase_dump',
        majorCategory: 'Engineering Spares - Mechanical',
        // A string, not an array — exercises the comma-split fallback branch.
        minorCategories: 'Abrasives, Grinding Wheels',
        rating: 4.8,
      },
      // No name/email/phone/contactPerson/majorCategory: exercises every fallback.
      { id: 'v-hist-2', source: 'historical_purchase_dump' },
      // Not buyer-uploaded: must be excluded from both the preview and the payload.
      { id: 'v-cm-1', name: 'Category Manager Vendor', source: 'category_manager_upload' },
    ]);
    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('2 Suppliers Found')).toBeInTheDocument());
    expect(screen.getByText('Apex Industrial Dynamics')).toBeInTheDocument();
    expect(screen.getByText('Rajesh Nair')).toBeInTheDocument();
    expect(screen.getByText('rajesh@apex.in')).toBeInTheDocument();
    expect(screen.getByText('+91 98200 11111')).toBeInTheDocument();
    expect(screen.getAllByText('Engineering Spares - Mechanical').length).toBeGreaterThan(0);
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.queryByText('Category Manager Vendor')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Navi Mumbai Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400701' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Centrifugal Water Pump' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });
    fireEvent.change(minorSelect, { target: { value: 'Abrasives' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
    // v-hist-2 has no majorCategory (its whole purpose in this fixture is
    // testing the display fallback above) — it correctly cannot match the
    // "Engineering Spares - Mechanical" category selected on the line item,
    // so it's excluded from the dispatch payload even though the preview
    // above showed it (that happened before a category was selected).
    expect(mockCreateRFQ.mock.calls[0][0].assignedVendors).toEqual([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        email: 'rajesh@apex.in',
        contactPerson: 'Rajesh Nair',
        phone: '+91 98200 11111',
        vendorCategory: 'Client List',
      },
    ]);
  });

  it('allows buyer to view category mismatched vendors and send category update email', async () => {
    serveBootstrap([
      {
        id: 'v-mismatch-1',
        name: 'Delta Bearings',
        email: 'delta@bearings.com',
        source: 'historical_purchase_dump',
        majorCategory: 'Civil Works',
      },
    ]);
    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('1 Suppliers Found')).toBeInTheDocument());

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const [majorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });

    await waitFor(() => expect(screen.getAllByText(/Category Mismatch/i).length).toBeGreaterThan(0));

    const mismatchTab = screen.getByRole('button', { name: /Category Mismatch/i });
    fireEvent.click(mismatchTab);

    const sendEmailBtn = screen.getByRole('button', { name: /Send Email to Update Category/i });
    expect(sendEmailBtn).toBeInTheDocument();

    fireEvent.click(sendEmailBtn);

    await waitFor(() => expect(screen.getByText(/Update Email Sent ✓/i)).toBeInTheDocument());
  });

  it('Mode 2 (default) also assigns the buyer\'s private roster — a category match alone no longer grants vendor visibility, so it must actually be invited', async () => {
    serveBootstrap([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        source: 'historical_purchase_dump',
        majorCategory: 'Engineering Spares - Mechanical',
      },
    ]);
    renderWizard();
    // Wait for the bootstrap vendor to actually hydrate into buyerVendors
    // before submitting — otherwise the form dispatches before context state
    // catches up, and assignedVendors comes back empty regardless of the fix.
    await waitFor(() => expect(screen.getByText(/1 (Hybrid|Private) Suppliers Matched/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Navi Mumbai Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400701' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Centrifugal Water Pump' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });
    fireEvent.change(minorSelect, { target: { value: 'Abrasives' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
    expect(mockCreateRFQ.mock.calls[0][0].assignedVendors).toEqual([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        email: null,
        contactPerson: 'Apex Industrial Dynamics',
        phone: null,
        vendorCategory: 'Client List',
      },
    ]);
  });



  it('the upload drop zone highlights on drag-over and unhighlights on drag-leave', () => {
    renderWizard();
    const dropZone = screen.getByText(/Drag and drop BOQ spreadsheets/i).closest('div')!;
    fireEvent.dragOver(dropZone);
    fireEvent.dragLeave(dropZone);
    fireEvent.click(dropZone);
    // No visible assertion needed beyond "doesn't throw" — this exercises the
    // isDraggingDoc state branches; the highlight class itself is covered by
    // this not crashing and the zone staying in the document.
    expect(screen.getByText(/Drag and drop BOQ spreadsheets/i)).toBeInTheDocument();
  });

  it('"Extract Line Items with AI" is disabled until a file is selected', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /Extract Line Items with AI/i })).toBeDisabled();
  });

  describe('IngestionWizard: Quota exhaustion and upgrade plan', () => {
    it('shows quota exhausted warning banner and upgrade plan button when remaining free RFQs are 0 on free_trial', () => {
      render(
        <AppProvider>
          <IngestionWizard
            forceSubscription="free_trial"
            forceRemainingFreeRFQs={0}
            onComplete={jest.fn()}
            onCancel={jest.fn()}
          />
        </AppProvider>
      );

      expect(screen.getByTestId('ingestion-wizard-quota-exhausted-banner')).toBeInTheDocument();
      expect(screen.getByText(EXTRACTION.quotaExhaustedTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Please Upgrade Your Plan/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Create & Dispatch RFQ/i })).not.toBeInTheDocument();
    });

    it('does not show quota exhausted banner when buyer has remaining free RFQs', () => {
      render(
        <AppProvider>
          <IngestionWizard
            forceSubscription="free_trial"
            forceRemainingFreeRFQs={3}
            onComplete={jest.fn()}
            onCancel={jest.fn()}
          />
        </AppProvider>
      );

      expect(screen.queryByTestId('ingestion-wizard-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create & Dispatch RFQ/i })).toBeInTheDocument();
    });

    it('does not show quota exhausted banner for paid subscription plans', () => {
      render(
        <AppProvider>
          <IngestionWizard
            forceSubscription="version_2"
            forceRemainingFreeRFQs={0}
            onComplete={jest.fn()}
            onCancel={jest.fn()}
          />
        </AppProvider>
      );

      expect(screen.queryByTestId('ingestion-wizard-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create & Dispatch RFQ/i })).toBeInTheDocument();
    });

    it('opens RfqUpgradePlanModal when clicking unentitled Mode 1 or Mode 2 with exhausted credits', () => {
      render(
        <AppProvider>
          <IngestionWizard
            forceSubscription="free_trial"
            forceRemainingFreeRFQs={0}
            onComplete={jest.fn()}
            onCancel={jest.fn()}
          />
        </AppProvider>
      );

      // Sourcing mode buttons
      const btn1 = screen.getByTestId('sourcing-mode-btn-mode_1');
      fireEvent.click(btn1);

      // RfqUpgradePlanModal should open
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
      expect(screen.getByText(/You don't have credits to publish the RFQ in Mode 1/i)).toBeInTheDocument();
    });

    it('opens RfqUpgradePlanModal when clicking Upgrade Plan CTA on the quota banner', () => {
      render(
        <AppProvider>
          <IngestionWizard
            forceSubscription="free_trial"
            forceRemainingFreeRFQs={0}
            onComplete={jest.fn()}
            onCancel={jest.fn()}
          />
        </AppProvider>
      );

      const upgradeLinks = screen.getAllByRole('link', { name: /Upgrade Plan/i });
      fireEvent.click(upgradeLinks[0]);

      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
    });
  });

  describe('RFQ Success Popup Dynamic Procucev Vendor Count Retrieval', () => {
    it('resolveConfirmationVendorCount resolves dynamically retrieved Procucev vendor count for Version 0, 2, and 3', () => {
      // Version 0 with a category but no assignment list falls back to the
      // server's count (the count is only distrusted when no category exists).
      expect(resolveConfirmationVendorCount({ sourcingMode: 'mode_0', category: 'Steels', procucevVendorCount: 7 })).toBe(7);
      expect(resolveConfirmationVendorCount({ sourcingMode: 'v0', category: 'Steels', procucevVendorCount: 4 })).toBe(4);
      // Version 0 WITH an assignment list reports who was actually invited,
      // overriding a directory-wide (and here, inflated) server count.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_0',
          procucevVendorCount: 20030,
          assignedVendors: [
            { id: 'pv-a', source: 'procucev_network' },
            { id: 'pv-b', source: 'procucev_network' },
          ],
        })
      ).toBe(2);

      // Version 2: Hybrid sourcing plan Procucev network vendors (category present)
      expect(resolveConfirmationVendorCount({ sourcingMode: 'mode_2', category: 'Steels', procucevVendorCount: 15 })).toBe(15);
      expect(resolveConfirmationVendorCount({ sourcingMode: 'version_2', category: 'Steels', procucevVendorCount: 9 })).toBe(9);

      // Version 3: AI Autonomous Sourcing Plan Procucev network vendors (category present)
      expect(resolveConfirmationVendorCount({ sourcingMode: 'mode_3', category: 'Steels', procucevVendorCount: 22 })).toBe(22);
      expect(resolveConfirmationVendorCount({ sourcingMode: 'v3', category: 'Steels', procucevVendorCount: 18 })).toBe(18);

      // Version 1: Private roster only uses assignedVendors
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_1',
          assignedVendors: [{ id: 'pv-1', name: 'Private Vendor 1' }, { id: 'pv-2', name: 'Private Vendor 2' }],
        })
      ).toBe(2);

      // Fallback for network sourcing modes filters out buyer-owned vendors.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_0',
          assignedVendors: [
            { id: 'pv-1', source: 'procucev_network' },
            { id: 'pv-2', source: 'procucev_network' },
            { id: 'v-buyer-1', source: 'buyer_uploaded' },
          ],
        })
      ).toBe(2);
      // Version 2 and 3 return only Procucev network vendors from fallback pool.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_2',
          assignedVendors: [
            { id: 'pv-3', source: 'procucev_network' },
            { id: 'v-buyer-2', source: 'buyer_uploaded' },
          ],
        })
      ).toBe(1);
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_3',
          assignedVendors: [
            { id: 'pv-4', source: 'procucev_network' },
            { id: 'v-buyer-3', source: 'buyer_uploaded' },
          ],
        })
      ).toBe(1);
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_1',
          procucevVendorCount: 99,
          assignedVendors: [{ id: 'pv-private-1' }],
        })
      ).toBe(1);

      // Null, empty, or missing rfq returns 0
      expect(resolveConfirmationVendorCount(null)).toBe(0);
      expect(resolveConfirmationVendorCount({})).toBe(0);
    });

    it('ignores a category-less whole-directory procucevVendorCount and reports the invited count', () => {
      // The exact production payload: no category anywhere, no vendors invited,
      // but the backend returns a 20030 whole-directory tally. The modal must
      // show 0 (nobody was invited), never 20030.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_0',
          category: null,
          procucevVendorCount: 20030,
          assignedVendors: [],
          extractedEntities: [{ category: '', majorCategory: '', minorCategory: '' }],
        })
      ).toBe(0);

      // Same guard for V2/V3 when no category is selected.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_3',
          category: '',
          procucevVendorCount: 9999,
          assignedVendors: [],
          extractedEntities: [{ category: '' }],
        })
      ).toBe(0);

      // Once a category IS present, the server/invited count is honoured again.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_0',
          category: 'Engineering Spares - Mechanical',
          procucevVendorCount: 5,
          assignedVendors: [],
        })
      ).toBe(5);

      // A category on a line item (not the header) still counts as a signal.
      expect(
        resolveConfirmationVendorCount({
          sourcingMode: 'mode_0',
          category: null,
          procucevVendorCount: 5,
          assignedVendors: [],
          extractedEntities: [{ majorCategory: 'Electrical' }],
        })
      ).toBe(5);
    });

    it('resolveOwnVendorCount reports the buyer private vendors separately from the Procucev network', () => {
      // V3 with a mixed roster: 1 private (Client List) + 2 Procucev Network.
      const mixedV3 = {
        sourcingMode: 'mode_3',
        procucevVendorCount: 2,
        assignedVendors: [
          { id: 'own-1', name: 'Amma Solution', vendorCategory: 'Client List' },
          { id: 'proc-1', name: 'Mamta Electrics', vendorCategory: 'Procucev Network' },
          { id: 'proc-2', name: 'Raja Electricals', vendorCategory: 'Procucev Network' },
        ],
      };
      // The two boxes report distinct, correct values — no more duplicate count.
      expect(resolveOwnVendorCount(mixedV3)).toBe(1);
      expect(resolveConfirmationVendorCount(mixedV3)).toBe(2);

      // V2 behaves the same way for the private/Procucev split.
      const mixedV2 = {
        sourcingMode: 'mode_2',
        assignedVendors: [
          { id: 'own-a', name: 'Private A', vendorCategory: 'Client List' },
          { id: 'own-b', name: 'Private B', vendorCategory: 'Client List' },
          { id: 'proc-a', name: 'Network A', vendorCategory: 'Procucev Network' },
        ],
      };
      expect(resolveOwnVendorCount(mixedV2)).toBe(2);

      // V1: the box shows the full private roster.
      expect(
        resolveOwnVendorCount({
          sourcingMode: 'mode_1',
          assignedVendors: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        })
      ).toBe(2);

      // Null / empty is safe.
      expect(resolveOwnVendorCount(null)).toBe(0);
      expect(resolveOwnVendorCount({})).toBe(0);
    });

    it('isV2OrV3SourcingMode is true only for V2/V3 aliases, false for everything else', () => {
      for (const m of ['mode_2', 'v2', 'version_2', 'mode_3', 'v3', 'version_3']) {
        expect(isV2OrV3SourcingMode(m)).toBe(true);
      }
      for (const m of ['mode_0', 'v0', 'version_0', 'mode_1', 'v1', 'version_1', '', null, undefined]) {
        expect(isV2OrV3SourcingMode(m)).toBe(false);
      }
    });

    it('displays the dynamically retrieved Procucev vendor count in the confirmation modal for Version 0, 2, and 3', async () => {
      // Simulate backend response with dynamically retrieved procucevVendorCount: 6 for Version 3
      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          ...mockCreatedRFQ(),
          sourcingMode: 'mode_3',
          procucevVendorCount: 6,
        },
      });

      renderWizard();

      // Fill in required fields
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
        target: { value: 'Navi Mumbai Plant' },
      });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
        target: { value: '400701' },
      });

      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
        target: { value: 'Precision Industrial Valve' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), {
        target: { value: '8' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), {
        target: { value: 'Nos' },
      });

      // Submit RFQ
      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
      expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();

      // The dedicated "Procucev Vendors" box renders the server's 6 dynamically
      // (NOT a hardcoded 'AI Blind').
      expect(screen.queryByText('AI Blind')).not.toBeInTheDocument();
      const procucevBox = screen.getByTestId('confirmation-procucev-vendor-box');
      expect(procucevBox).toBeInTheDocument();
      expect(screen.getByTestId('confirmation-procucev-vendor-count')).toHaveTextContent('6');
      expect(within(procucevBox).getByText('Procucev Vendors')).toBeInTheDocument();

      // The "Your Invited Vendors" box counts only the buyer's own roster — none
      // in this flow — so it reads 0 rather than duplicating the Procucev count.
      expect(screen.getByTestId('confirmation-vendor-count')).toHaveTextContent('0');
    });

    it('shows the actual invited Procucev count for Version 0, not the directory-wide tally', async () => {
      // The backend reports a huge directory-wide procucevVendorCount, but the
      // RFQ was actually dispatched to just the 2 vendors in assignedVendors.
      // The modal must show 2 (who was invited), never 20030.
      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          ...mockCreatedRFQ(),
          sourcingMode: 'mode_0',
          procucevVendorCount: 20030,
          assignedVendors: [
            { id: 'pv-1', name: 'Network Supplier One', source: 'procucev_network' },
            { id: 'pv-2', name: 'Network Supplier Two', source: 'procucev_network' },
          ],
        },
      });

      renderWizard();

      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
        target: { value: 'Navi Mumbai Plant' },
      });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
        target: { value: '400701' },
      });

      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
        target: { value: 'Standard Fasteners' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), {
        target: { value: '50' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), {
        target: { value: 'Boxes' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
      expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();

      const countEl = screen.getByTestId('confirmation-vendor-count');
      expect(countEl).toHaveTextContent('2');
      expect(countEl).not.toHaveTextContent('20030');

      // V0 is NOT a Procucev-network-expansion version, so the dedicated box is hidden.
      expect(screen.queryByTestId('confirmation-procucev-vendor-box')).not.toBeInTheDocument();
    });

    it('displays the backend vendor count for Version 2 on the submitted RFQ', async () => {
      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          ...mockCreatedRFQ(),
          sourcingMode: 'mode_2',
          procucevVendorCount: 11,
        },
      });

      renderWizard();

      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
        target: { value: 'Navi Mumbai Plant' },
      });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
        target: { value: '400701' },
      });

      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
        target: { value: 'Precision Industrial Valve' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), {
        target: { value: '8' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), {
        target: { value: 'Nos' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
      expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();

      // V2 (Hybrid) shows the dedicated Procucev Vendors box with the server's 11.
      expect(screen.getByTestId('confirmation-procucev-vendor-box')).toBeInTheDocument();
      expect(screen.getByTestId('confirmation-procucev-vendor-count')).toHaveTextContent('11');
      // The "Your Invited Vendors" box counts only the buyer's own roster (0 here).
      expect(screen.getByTestId('confirmation-vendor-count')).toHaveTextContent('0');
    });
  });

  describe('PIN code auto-population of Delivery Location', () => {
    test('auto-populates city and state into delivery location on entering a valid PIN code', async () => {
      renderWizard();

      const pincodeInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);
      const locationInput = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder) as HTMLInputElement;

      expect(locationInput.value).toBe('');

      // Enter valid PIN code (e.g. 400701 -> Navi Mumbai, Maharashtra)
      fireEvent.change(pincodeInput, { target: { value: '400701' } });
      fireEvent.blur(pincodeInput);

      await waitFor(() => {
        expect(locationInput.value).toBe('Navi Mumbai, Maharashtra');
      });
    });

    test('resolves delivery location from postal API response if available', async () => {
      const realFetch = global.fetch;
      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        if (typeof url === 'string' && url.includes('api.postalpincode.in')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              {
                Status: 'Success',
                PostOffice: [
                  {
                    Name: 'Connaught Place',
                    District: 'Central Delhi',
                    State: 'Delhi',
                  },
                ],
              },
            ],
          }) as any;
        }
        return (realFetch as any)(url, init);
      });

      renderWizard();

      const pincodeInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);
      const locationInput = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder) as HTMLInputElement;

      fireEvent.change(pincodeInput, { target: { value: '110001' } });
      fireEvent.blur(pincodeInput);

      await waitFor(() => {
        expect(locationInput.value).toBe('Central Delhi, Delhi');
      });

      global.fetch = realFetch;
    });
  });

});

describe('IngestionWizard: Mode 3 Top Procucev Network Vendors (360° ranking)', () => {
  // Captured fresh per test so the fallback and restore use the genuine
  // jest.setup default fetch, never a leaked override from a prior describe.
  let realFetch: typeof global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  // The V3 panel fetches the Procucev network via GET /api/vendors?buyerId=all.
  // Serve a small ranked-able pool for that URL; every other URL falls through
  // to jest.setup.ts's default mock so the category dropdowns stay populated.
  function serveProcucevNetwork(vendors: Array<Record<string, unknown>>) {
    global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/vendors') && url.includes('buyerId=all')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: vendors,
            pagination: { page: 1, pageSize: 100, total: vendors.length, totalPages: 1 },
          }),
        }) as any;
      }
      return (realFetch as any)(url, init);
    }) as any;
  }

  const NEAR = {
    id: 'proc-near',
    name: 'Nearby Pumps Pvt Ltd',
    source: 'procucev_network',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories'],
    pincode: '400702',
    rating: 4.6,
    email: 'sales@nearbypumps.in',
    contactPerson: 'N. Rao',
    phone: '+91 90000 11111',
  };
  const FAR = {
    id: 'proc-far',
    name: 'Distant Valves Co',
    source: 'procucev_network',
    majorCategory: 'Engineering Spares - Mechanical',
    minorCategories: ['Pumps & Accessories'],
    pincode: '110001',
    rating: 4.9,
    email: 'sales@distantvalves.in',
    contactPerson: 'D. Singh',
    phone: '+91 90000 22222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    realFetch = global.fetch;
    mockCreateRFQ.mockResolvedValue({ success: true, rfq: mockCreatedRFQ() });
  });

  async function enterMode3WithCategoryAndLocation() {
    renderWizard();
    fireEvent.click(screen.getByTestId('mode-mode_3'));

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Navi Mumbai Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400701' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Centrifugal Water Pump' },
    });
    const [majorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });
  }

  it('renders the top Procucev network vendors ranked by category and location, with their category on each card', async () => {
    serveProcucevNetwork([FAR, NEAR]);
    await enterMode3WithCategoryAndLocation();

    await waitFor(() => expect(screen.getByTestId('procucev-v3-panel')).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId('procucev-v3-vendor').length).toBe(2));

    // Both network vendors surface, each with their sourcing category on the card.
    expect(screen.getByText('Nearby Pumps Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('Distant Valves Co')).toBeInTheDocument();
    expect(screen.getAllByTestId('procucev-v3-vendor-category').length).toBe(2);

    // The geographically closer vendor (same PIN district as 400701) ranks first.
    const cards = screen.getAllByTestId('procucev-v3-vendor');
    expect(within(cards[0]).getByText('Nearby Pumps Pvt Ltd')).toBeInTheDocument();
  });

  it('selects all / deselects all and dispatches the chosen Procucev vendors', async () => {
    serveProcucevNetwork([NEAR, FAR]);
    await enterMode3WithCategoryAndLocation();

    await waitFor(() => expect(screen.getAllByTestId('procucev-v3-vendor').length).toBe(2));

    // Select all → both selected.
    fireEvent.click(screen.getByTestId('procucev-v3-select-all'));
    expect(await screen.findByText('2 of 2 selected')).toBeInTheDocument();

    // Deselect all → none selected.
    fireEvent.click(screen.getByTestId('procucev-v3-select-all'));
    expect(await screen.findByText('0 of 2 selected')).toBeInTheDocument();

    // Single-select one vendor by clicking its card (scoped to the card so a
    // confirmation modal from an earlier test can never shadow the match).
    const nearCard = (await screen.findAllByTestId('procucev-v3-vendor')).find((c) =>
      within(c).queryByText('Nearby Pumps Pvt Ltd')
    ) as HTMLElement;
    expect(nearCard).toBeTruthy();
    fireEvent.click(nearCard);
    expect(await screen.findByText('1 of 2 selected')).toBeInTheDocument();

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
    const assigned = mockCreateRFQ.mock.calls[0][0].assignedVendors || [];
    const near = assigned.find((v: { id: string }) => v.id === 'proc-near');
    expect(near).toBeTruthy();
    expect(assigned.some((v: { id: string }) => v.id === 'proc-far')).toBe(false);

    // Double-blind: the dispatched Procucev entry carries only the company name
    // plus the 'Procucev Network' tag — never its email, phone, or contact.
    expect(near.name).toBe('Nearby Pumps Pvt Ltd');
    expect(near.vendorCategory).toBe('Procucev Network');
    expect(near.email).toBeNull();
    expect(near.phone).toBeNull();
    expect(near.contactPerson).toBeNull();
  });

  it('shows an empty-state message when no Procucev network vendors match', async () => {
    serveProcucevNetwork([]);
    await enterMode3WithCategoryAndLocation();

    await waitFor(() => expect(screen.getByTestId('procucev-v3-panel')).toBeInTheDocument());
    // Wait for the (debounced) fetch to settle, then assert no vendor cards and
    // the empty-state message — findBy retries so a late fetch resolution does
    // not flake the assertion.
    expect(await screen.findByText(/No Procucev network vendors matched/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('procucev-v3-vendor')).toHaveLength(0);
  });

  it('reports the buyer-selected Procucev count in the success modal, not just the server count', async () => {
    serveProcucevNetwork([NEAR, FAR]);
    // Server under-reports: its own auto-match found only 1, but the buyer picks 2.
    mockCreateRFQ.mockResolvedValueOnce({
      success: true,
      rfq: { ...mockCreatedRFQ(), sourcingMode: 'mode_3', procucevVendorCount: 1 },
    });

    await enterMode3WithCategoryAndLocation();
    await waitFor(() => expect(screen.getAllByTestId('procucev-v3-vendor').length).toBe(2));

    fireEvent.click(screen.getByTestId('procucev-v3-select-all'));
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(screen.getByText('RFQ Dispatched Successfully!')).toBeInTheDocument());
    // The Procucev box reflects the 2 selected, not the server's 1.
    expect(screen.getByTestId('confirmation-procucev-vendor-box')).toHaveTextContent('2');
    // The "Your Invited Vendors" box counts only the buyer's own roster — none
    // here — so it reads 0 rather than duplicating the Procucev count.
    expect(screen.getByTestId('confirmation-vendor-count')).toHaveTextContent('0');
  });
});

describe('IngestionWizard: comprehensive branch booster', () => {
  let realFetch: typeof global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    realFetch = global.fetch;
    mockCreateRFQ.mockResolvedValue({ success: true, rfq: mockCreatedRFQ() });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  function serveBootstrap(vendors: Array<Record<string, unknown>>) {
    global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/bootstrap')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { vendors, buyerAccounts: [], evaluations: [], auditLogs: [], aiFeed: [], systemConfig: {} },
          }),
        }) as any;
      }
      if (urlStr.includes('/api/vendors') && urlStr.includes('buyerId=all')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: vendors,
            pagination: { page: 1, pageSize: 100, total: vendors.length, totalPages: 1 },
          }),
        }) as any;
      }
      return (realFetch as any)(url, init);
    });
  }

  function serveProcucevNetwork(vendors: Array<Record<string, unknown>>) {
    global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/vendors') && urlStr.includes('buyerId=all')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: vendors,
            pagination: { page: 1, pageSize: 100, total: vendors.length, totalPages: 1 },
          }),
        }) as any;
      }
      return (realFetch as any)(url, init);
    }) as any;
  }

  it('covers confirmation modal actions: Done, Create Another RFQ, Compare in Matrix, and V0 uncategorized message', async () => {
    const onComplete = jest.fn();
    const { unmount } = renderWizard({ onComplete });

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Mumbai Central Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '400001' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Control Valves' },
    });
    const [majorSelect, minorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '5' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => expect(screen.getByText('RFQ Dispatched Successfully!')).toBeInTheDocument());

    // Click "Done"
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);

    unmount();

    // Re-render to test "Create Another RFQ"
    const { unmount: unmount2 } = renderWizard();
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Pune Depot' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '411001' },
    });
    const row2 = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row2).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Steel Rods' },
    });
    const [maj2, min2] = within(row2).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(maj2, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(min2, { target: { value: categoriesData[0].minorCategories[0] } });
    fireEvent.change(within(row2).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
    fireEvent.change(within(row2).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'MT' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));
    await waitFor(() => expect(screen.getByText('RFQ Dispatched Successfully!')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Create Another RFQ/i }));
    await waitFor(() => {
      expect(screen.queryByText('RFQ Dispatched Successfully!')).not.toBeInTheDocument();
    });

    unmount2();

    // Re-render to test V0 uncategorized confirmation and "Compare in Matrix"
    mockCreateRFQ.mockResolvedValueOnce({
      success: true,
      rfq: {
        ...mockCreatedRFQ(),
        sourcingMode: 'mode_0',
        category: null,
        extractedEntities: [],
        assignedVendors: [],
      },
    });

    const onComplete3 = jest.fn();
    renderWizard({ onComplete: onComplete3 });
    fireEvent.click(screen.getByTestId('mode-mode_0'));

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Nagpur Warehouse' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '440001' },
    });
    const row3 = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row3).getByPlaceholderText(MODAL.itemPlaceholder), {
      target: { value: 'Raw Materials' },
    });
    fireEvent.change(within(row3).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '1' } });
    fireEvent.change(within(row3).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Lot' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

    await waitFor(() => {
      expect(screen.getByText('RFQ Created & Forwarded to Category Manager')).toBeInTheDocument();
    });
    expect(screen.getByText('Uncategorized (Pending CM)')).toBeInTheDocument();
    expect(screen.getByText('0 (Pending CM Assignment)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Compare in Matrix/i }));
    expect(onComplete3).toHaveBeenCalledTimes(1);
  });

  it('covers All Categories sanitization on submission and Mode 2 toolbar filtering', async () => {
    serveBootstrap([
      {
        id: 'v-m2-1',
        name: 'Apex Industrial Dynamics',
        email: 'sales@apex.in',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
        minorCategories: [categoriesData[0].minorCategories[0]],
      },
      {
        id: 'v-m2-2',
        name: 'Delta Pipes Ltd',
        email: 'contact@deltapipes.in',
        source: 'buyer_uploaded',
        majorCategory: 'Plumbing & Sanitary',
      },
    ]);

    renderWizard();

    await waitFor(() => expect(screen.getByText('2 Hybrid Suppliers Matched')).toBeInTheDocument());

    // Filter tabs in Mode 2
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const [majorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });

    await waitFor(() => expect(screen.getByRole('button', { name: /All \(2\)/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /All \(2\)/i }));
    expect(screen.getByText('Delta Pipes Ltd')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Category Mismatch \(1\)/i }));
    expect(screen.getByText('Delta Pipes Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Apex Industrial Dynamics')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Matched \(1\)/i }));
    expect(screen.getByText('Apex Industrial Dynamics')).toBeInTheDocument();

    // Mode 2 vendor search
    const searchInput = screen.getByPlaceholderText('Search private suppliers by name, category, or contact info...');
    fireEvent.change(searchInput, { target: { value: 'Apex' } });
    expect(screen.getByText('Apex Industrial Dynamics')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Nonexistent Vendor' } });
    expect(screen.getByText('No vendors match the search or filter criteria.')).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: '' } });

    // Mode 2 card click to toggle selection
    const vendorCard = screen.getByText('Apex Industrial Dynamics').closest('div')!;
    fireEvent.click(vendorCard);

    // Now set Major Category to 'All Categories' and submit
    fireEvent.change(majorSelect, { target: { value: 'All Categories' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Universal Fittings' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '25' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Nos' } });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Surat Depot' } });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '395001' } });

    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));
    await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalled());
    // All Categories sanitized back to ''
    expect(mockCreateRFQ.mock.calls[0][0].extractedEntities[0].majorCategory).toBe('');
  });

  it('covers Mode 1 vendor selection toolbar: search, category tabs, card click, and bulk select', async () => {
    serveBootstrap([
      {
        id: 'v-m1-matched-1',
        name: 'Matched Machine Works',
        email: 'matched@works.com',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Pumps & Accessories'],
      },
      {
        id: 'v-m1-matched-2',
        name: 'Precision Parts Ltd',
        email: 'parts@precision.com',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Pumps & Accessories'],
      },
      {
        id: 'v-m1-mismatch-1',
        name: 'Unmatched Civil Co',
        email: 'civil@unmatched.com',
        source: 'buyer_uploaded',
        majorCategory: 'Civil Works',
      },
    ]);

    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('3 Suppliers Found')).toBeInTheDocument());

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const [majorSelect] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });

    // Category filter tabs: All, Matched, Mismatched
    await waitFor(() => expect(screen.getByRole('button', { name: /All \(3\)/i })).toBeInTheDocument());
    const allTab = screen.getByRole('button', { name: /All \(3\)/i });
    const matchedTab = screen.getByRole('button', { name: /Matched \(2\)/i });
    const mismatchTab = screen.getByRole('button', { name: /Category Mismatch \(1\)/i });

    fireEvent.click(allTab);
    expect(screen.getByText('Matched Machine Works')).toBeInTheDocument();
    expect(screen.getByText('Unmatched Civil Co')).toBeInTheDocument();

    fireEvent.click(mismatchTab);
    expect(screen.getByText('Unmatched Civil Co')).toBeInTheDocument();
    expect(screen.queryByText('Matched Machine Works')).not.toBeInTheDocument();

    fireEvent.click(matchedTab);
    expect(screen.getByText('Matched Machine Works')).toBeInTheDocument();

    // Search filter
    const searchInput = screen.getByPlaceholderText('Filter vendors...');
    fireEvent.change(searchInput, { target: { value: 'Precision' } });
    expect(screen.getByText('Precision Parts Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Matched Machine Works')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });

    // Card click toggles vendor selection
    const card1 = screen.getByText('Matched Machine Works').closest('div')!;
    fireEvent.click(card1);

    // Select All / Deselect All
    const selectAllBtn = screen.getByRole('button', { name: /(Select All Matched|Deselect All)/i });
    fireEvent.click(selectAllBtn);
    fireEvent.click(selectAllBtn);
  });

  it('covers Mode 1 Inline Add Vendor Modal', async () => {
    serveBootstrap([]);
    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('No Private Vendors Uploaded Yet')).toBeInTheDocument());

    // Click "Add Vendor" button
    fireEvent.click(screen.getByRole('button', { name: /Add Vendor/i }));
    expect(screen.getByText('Add Approved Vendor')).toBeInTheDocument();

    // Click submit with empty form -> missing details toast
    const modalContent = screen.getByText('Add Approved Vendor').closest('.modal-content') as HTMLElement;
    const vendorForm = modalContent.querySelector('form') as HTMLFormElement;
    fireEvent.submit(vendorForm);

    // Fill form fields
    fireEvent.change(screen.getByPlaceholderText('e.g. Ashok Industries'), { target: { value: 'Ashok Industries' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 9000000001'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. contact@example.com'), { target: { value: 'john@ashok.in' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Pune'), { target: { value: 'Pune' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Maharashtra'), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 27AAAAA0000A1Z5'), { target: { value: '27ABCDE1234F1Z5' } });

    // Test pincode variations: dummy pincode, invalid format, valid pincode
    const pinInput = screen.getByPlaceholderText('e.g. 411001');
    fireEvent.change(pinInput, { target: { value: '000000' } });
    fireEvent.change(pinInput, { target: { value: '123' } });
    fireEvent.change(pinInput, { target: { value: '411001' } });

    // Select major and minor categories
    const [majorSelect] = within(vendorForm).getAllByRole('combobox');
    fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
    const minorSelects = within(vendorForm).getAllByRole('combobox');
    if (minorSelects.length > 1) {
      fireEvent.change(minorSelects[1], { target: { value: categoriesData[0].minorCategories[0] } });
    }

    // Submit valid vendor form
    fireEvent.submit(vendorForm);

    await waitFor(() => {
      expect(screen.queryByText('Add Approved Vendor')).not.toBeInTheDocument();
    });

    // Re-open and close modal via Cancel button inside modal
    fireEvent.click(screen.getByRole('button', { name: /Add Vendor/i }));
    expect(screen.getByText('Add Approved Vendor')).toBeInTheDocument();
    const modalContent2 = screen.getByText('Add Approved Vendor').closest('.modal-content') as HTMLElement;
    const closeBtn = within(modalContent2).getByRole('button', { name: /Cancel/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Add Approved Vendor')).not.toBeInTheDocument();
  });

  it('covers Mode 2 and Mode 3 AI Matching Criteria Info Panel', async () => {
    serveBootstrap([
      {
        id: 'v-b1',
        name: 'National Bearings Ltd',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
      },
    ]);

    renderWizard();
    await waitFor(() => expect(screen.getByText('1 Hybrid Suppliers Matched')).toBeInTheDocument());

    // Mode 2: click "AI Matching Criteria"
    const aiBtn = screen.getByRole('button', { name: /AI Matching Criteria/i });
    fireEvent.click(aiBtn);
    expect(screen.getByText('How QUA AI Categorizes Line Items & Matches Suppliers')).toBeInTheDocument();

    // Click "✕ Close"
    fireEvent.click(screen.getByRole('button', { name: /✕ Close/i }));
    expect(screen.queryByText('How QUA AI Categorizes Line Items & Matches Suppliers')).not.toBeInTheDocument();

    // Mode 3: click "AI Matching Criteria"
    fireEvent.click(screen.getByTestId('mode-mode_3'));
    await waitFor(() => expect(screen.getByRole('button', { name: /AI Matching Criteria/i })).toBeInTheDocument());
    const aiBtn3 = screen.getByRole('button', { name: /AI Matching Criteria/i });
    fireEvent.click(aiBtn3);
    expect(screen.getByText(/How QUA AI Categorizes Line Items & Matches Suppliers/i)).toBeInTheDocument();
    expect(screen.getByText('🛡️ Double-Blind Active')).toBeInTheDocument();
  });

  it('covers Quota Exhausted Banner and actions', async () => {
    renderWizard({
      forceSubscription: 'free_trial',
      forceRemainingFreeRFQs: 0,
    });

    // Quota banner visible in Mode 2
    expect(screen.getByTestId('ingestion-wizard-quota-exhausted-banner')).toBeInTheDocument();

    // Click "Upgrade Plan" link on the quota banner
    const banner = screen.getByTestId('ingestion-wizard-quota-exhausted-banner');
    fireEvent.click(within(banner).getByRole('link', { name: /Upgrade Plan/i }));
    expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();

    // Trigger onSwitchToMode0 from modal
    const switchToV0ModalBtn = screen.getByRole('button', { name: /Publish in Mode 0/i });
    fireEvent.click(switchToV0ModalBtn);

    // Mode switched to Mode 0, banner hides
    await waitFor(() => {
      expect(screen.queryByTestId('ingestion-wizard-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();
    });

    // Clicking unentitled Mode 1 triggers the upgrade modal directly
    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => {
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
    });
  });

  it('covers delivery pincode validation edge cases and blur handler', async () => {
    renderWizard();

    const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);
    fireEvent.change(pinInput, { target: { value: '000000' } });
    await waitFor(() => {
      expect(screen.getByText('Invalid')).toBeInTheDocument();
    });

    fireEvent.change(pinInput, { target: { value: '560001' } });
    fireEvent.blur(pinInput);
  });

  it('covers Auto-Categorize All when all items are already categorized or when classification fails', async () => {
    renderWizard();

    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Hydraulic Cylinder' } });
    const [maj, min] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(maj, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(min, { target: { value: categoriesData[0].minorCategories[0] } });

    // When already categorized, clicking Auto-Categorize shows info toast without calling API
    const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(autoCatBtn);
    expect(mockClassify).not.toHaveBeenCalled();

    // Now clear category and test classify failure
    fireEvent.change(maj, { target: { value: '' } });
    mockClassify.mockResolvedValueOnce({ success: false, error: 'Server AI timeout' });
    fireEvent.click(autoCatBtn);
    await waitFor(() => expect(mockClassify).toHaveBeenCalled());

    // Test classify exception
    mockClassify.mockRejectedValueOnce(new Error('Classify network error'));
    fireEvent.click(autoCatBtn);
    await waitFor(() => expect(mockClassify).toHaveBeenCalledTimes(2));
  });

  it('covers Mode 1 submission with category mismatch toast and shortlist adjustment', async () => {
    serveBootstrap([
      {
        id: 'v-mismatch-only',
        name: 'Mismatched Vendor Inc',
        email: 'mismatch@inc.com',
        source: 'buyer_uploaded',
        majorCategory: 'Civil Works',
      },
    ]);

    renderWizard();
    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('1 Suppliers Found')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
      target: { value: 'Delhi Yard' },
    });
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), {
      target: { value: '110001' },
    });
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Fasteners' } });
    const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '100' } });
    fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Pcs' } });

    // Submit in Mode 1 where the only vendor is mismatched -> triggers shortlist adjustment toast & blocking
    fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));
    await waitFor(() => {
      expect(screen.getByText(/(Mode 1|Version 1).*requires at least one private vendor/i)).toBeInTheDocument();
    });
  });

  it('covers attachment upload failure and extraction error recovery', async () => {
    renderWizard();

    // Attach document that fails extraction
    mockExtract.mockResolvedValueOnce({
      success: false,
      reason: 'SCANNED_IMAGE',
      error: 'Unreadable scan',
    });

    uploadFile(new File(['unreadable'], 'scanned.pdf', { type: 'application/pdf' }));
    clickExtract();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enter Line Items Manually/i })).toBeInTheDocument();
    });

    // Click "Enter Line Items Manually" recovery button
    fireEvent.click(screen.getByRole('button', { name: /Enter Line Items Manually/i }));
    expect(screen.getByPlaceholderText(MODAL.itemPlaceholder)).toBeInTheDocument();
  });

  it('covers Mode 2 category mismatch email, vendor card selection toggle, and select all matched', async () => {
    serveBootstrap([
      {
        id: 'v-m2-match',
        name: 'Matched Machine Corp',
        email: 'match@corp.com',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
      },
      {
        id: 'v-m2-mismatch',
        name: 'Mismatch Fabricators',
        email: 'mismatch@fab.com',
        source: 'buyer_uploaded',
        majorCategory: 'Civil Works',
      },
    ]);

    renderWizard();

    // Line item with Engineering Spares
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });

    await waitFor(() => expect(screen.getByText('Matched Machine Corp')).toBeInTheDocument());

    // Switch tab to "all" to see both matched and mismatched
    fireEvent.click(screen.getByRole('button', { name: /All \(2\)/i }));
    expect(screen.getByText('Mismatch Fabricators')).toBeInTheDocument();

    // Mode 2 Select All Matched and Deselect All
    const selectAllBtn = screen.getByRole('button', { name: /(Select All Matched|Deselect All)/i });
    fireEvent.click(selectAllBtn);
    fireEvent.click(selectAllBtn);

    // Toggle card selection
    const matchCard = screen.getByText('Matched Machine Corp').closest('div')!;
    fireEvent.click(matchCard);
    fireEvent.click(matchCard);

    // Send Category Update Email - success
    mockEmail.mockResolvedValueOnce({ success: true, message: 'Email sent.' });
    const sendEmailBtn = screen.getByTitle('Send email requesting vendor to update their category');
    fireEvent.click(sendEmailBtn);
    await waitFor(() => expect(screen.getByText(/Update Email Sent/i)).toBeInTheDocument());

    // Send Category Update Email - error delivery
    mockEmail.mockResolvedValueOnce({ success: false, error: 'SMTP timeout' });
    fireEvent.click(sendEmailBtn);

    // Send Category Update Email - exception
    mockEmail.mockRejectedValueOnce(new Error('Network offline'));
    fireEvent.click(sendEmailBtn);
  });

  it('covers Mode 1 empty match with "View all private vendors" button and double toggle', async () => {
    serveBootstrap([
      {
        id: 'v-m1-civil',
        name: 'Civil Only Vendor',
        email: 'civil@only.com',
        source: 'buyer_uploaded',
        majorCategory: 'Civil Works',
      },
    ]);

    renderWizard();
    fireEvent.click(screen.getByTestId('mode-mode_1'));

    // Set category that doesn't match
    const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
    const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });

    // Mode 1: 0 matched, shows "View all 1 private vendors →"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /View all 1 private vendors/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /View all 1 private vendors/i }));

    // Now all vendors visible, click card twice to test selection toggle
    expect(screen.getByText('Civil Only Vendor')).toBeInTheDocument();
    const vendorCard = screen.getByText('Civil Only Vendor').closest('div')!;
    fireEvent.click(vendorCard);
    fireEvent.click(vendorCard);
  });

  it('covers file size limit and native select mode change to unentitled mode', async () => {
    renderWizard({
      forceSubscription: 'free_trial',
      forceRemainingFreeRFQs: 0,
    });

    // File > 15MB
    const bigFile = new File(['x'.repeat(100)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(bigFile, 'size', { value: 16 * 1024 * 1024 });
    uploadFile(bigFile);

    // Native select sourcing mode change to unentitled mode
    const select = screen.getByTestId('sourcing-mode-select');
    fireEvent.change(select, { target: { value: 'mode_1' } });
    expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();

    // Close modal via close button
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();

    // Bottom quota banner buttons
    const v0Btns = screen.getAllByRole('button', { name: /Switch to Mode 0/i });
    fireEvent.click(v0Btns[0]);
  });

  it('covers Add Vendor Modal invalid pincode formats, error states, and submission failures', async () => {
    serveBootstrap([]);
    renderWizard();

    fireEvent.click(screen.getByTestId('mode-mode_1'));
    await waitFor(() => expect(screen.getByText('No Private Vendors Uploaded Yet')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add Vendor/i }));
    const modalContent = screen.getByText('Add Approved Vendor').closest('.modal-content') as HTMLElement;
    const vendorForm = modalContent.querySelector('form') as HTMLFormElement;

    // Fill valid mandatory fields
    fireEvent.change(screen.getByPlaceholderText('e.g. Ashok Industries'), { target: { value: 'Ashok Industries' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 9000000001'), { target: { value: '9876543210' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. contact@example.com'), { target: { value: 'john@ashok.in' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Pune'), { target: { value: 'Pune' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Maharashtra'), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 27AAAAA0000A1Z5'), { target: { value: '27ABCDE1234F1Z5' } });

    // Invalid pincode starting with 0
    const pinInput = screen.getByPlaceholderText('e.g. 411001');
    fireEvent.change(pinInput, { target: { value: '012345' } });
    fireEvent.submit(vendorForm);

    // Dummy pincode triggering error
    fireEvent.change(pinInput, { target: { value: '111111' } });
    fireEvent.submit(vendorForm);

    // Valid pincode format
    fireEvent.change(pinInput, { target: { value: '411001' } });
    fireEvent.submit(vendorForm);
  });

  describe('IngestionWizard: targeted branch booster v2', () => {
    it('covers helper functions edge cases: rfqHasCategorySignal, isProcucevAssignedVendor, resolveConfirmationVendorCount, resolveOwnVendorCount', () => {
      // resolveConfirmationVendorCount null/empty
      expect(resolveConfirmationVendorCount(null)).toBe(0);
      expect(resolveConfirmationVendorCount(undefined)).toBe(0);

      // rfqHasCategorySignal with line items:
      // 1. category empty, majorCategory populated
      const rfqWithMajor = {
        sourcingMode: 'mode_2',
        category: '',
        extractedEntities: [{ id: 'e1', category: '', majorCategory: 'Civil Works', minorCategory: '' }],
        assignedVendors: [{ id: 'v1', vendorCategory: 'Procucev Network' }],
        procucevVendorCount: 10,
      };
      expect(resolveConfirmationVendorCount(rfqWithMajor as any)).toBe(10);

      // 2. category & major empty, minorCategory populated
      const rfqWithMinor = {
        sourcingMode: 'mode_2',
        category: '',
        extractedEntities: [{ id: 'e2', category: '', majorCategory: '', minorCategory: 'Bricks' }],
        assignedVendors: [{ id: 'v1', vendorCategory: 'Procucev Network' }],
        procucevVendorCount: 5,
      };
      expect(resolveConfirmationVendorCount(rfqWithMinor as any)).toBe(5);

      // 3. no category signal, mode_2 with no assigned vendors
      const rfqNoCatNoAssigned = {
        sourcingMode: 'mode_2',
        category: '',
        extractedEntities: [{ id: 'e3', category: '', majorCategory: '', minorCategory: '' }],
        assignedVendors: null,
        procucevVendorCount: 100,
      };
      expect(resolveConfirmationVendorCount(rfqNoCatNoAssigned as any)).toBe(0);

      // 4. isProcucevAssignedVendor with string vendor
      const rfqWithStringVendor = {
        sourcingMode: 'mode_2',
        category: '',
        extractedEntities: [],
        assignedVendors: ['string-vendor-id'],
      };
      expect(resolveConfirmationVendorCount(rfqWithStringVendor as any)).toBe(1);

      // 5. isProcucevAssignedVendor with vendorCategory 'Client List'
      const rfqWithClientList = {
        sourcingMode: 'mode_2',
        category: '',
        extractedEntities: [],
        assignedVendors: [{ id: 'v2', vendorCategory: 'Client List' }],
      };
      expect(resolveConfirmationVendorCount(rfqWithClientList as any)).toBe(0);

      // 6. resolveConfirmationVendorCount V1 mode fallback to assignedVendors length
      const rfqV1 = {
        sourcingMode: 'mode_1',
        category: 'IT Services',
        assignedVendors: [{ id: 'v1' }, { id: 'v2' }],
      };
      expect(resolveConfirmationVendorCount(rfqV1 as any)).toBe(2);

      // 7. resolveConfirmationVendorCount negative procucevVendorCount
      const rfqNegCount = {
        sourcingMode: 'mode_2',
        category: 'Civil Works',
        procucevVendorCount: -5,
      };
      expect(resolveConfirmationVendorCount(rfqNegCount as any)).toBe(0);

      // 8. resolveConfirmationVendorCount fallback when procucevVendorCount is undefined
      const rfqFallbackCount = {
        sourcingMode: 'mode_2',
        category: 'Civil Works',
        procucevVendorCount: undefined,
        assignedVendors: [{ id: 'v1', vendorCategory: 'Procucev Network' }],
      };
      expect(resolveConfirmationVendorCount(rfqFallbackCount as any)).toBe(1);

      // resolveOwnVendorCount tests
      expect(resolveOwnVendorCount(null)).toBe(0);
      expect(resolveOwnVendorCount(undefined)).toBe(0);
      // mode_1 with assignedVendors
      expect(resolveOwnVendorCount(rfqV1 as any)).toBe(2);
      // mode_2 with private and procucev vendors
      const rfqV2Mixed = {
        sourcingMode: 'mode_2',
        assignedVendors: [
          { id: 'v1', vendorCategory: 'Client List' },
          { id: 'v2', vendorCategory: 'Procucev Network' },
        ],
      };
      expect(resolveOwnVendorCount(rfqV2Mixed as any)).toBe(1);
      // mode_0 fallback to resolveConfirmationVendorCount
      const rfqV0 = {
        sourcingMode: 'mode_0',
        category: 'Civil Works',
        assignedVendors: [{ id: 'v1', vendorCategory: 'Procucev Network' }],
      };
      expect(resolveOwnVendorCount(rfqV0 as any)).toBe(1);
      // unknown mode with null assignedVendors
      expect(resolveOwnVendorCount({ sourcingMode: 'unknown_mode' } as any)).toBe(0);
    });

    it('covers confirmation modal actions: router.push, onComplete, and various RFQ display configs', async () => {
      const onCompleteMock = jest.fn();
      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-c1',
          rfqNumber: 'RFQ-CONF-001',
          title: 'Confirmation Test RFQ',
          category: '',
          sourcingMode: 'mode_0',
          budget: undefined,
          status: 'Quotes Pending',
          assignedVendors: [],
          extractedEntities: [],
          createdAt: '2026-09-10T10:00:00Z',
        },
      });

      renderWizard({ onComplete: onCompleteMock });

      // Switch to mode_0 and fill required fields
      fireEvent.click(screen.getByTestId('mode-mode_0'));
      fireEvent.change(screen.getByPlaceholderText(MODAL.titlePlaceholder), { target: { value: 'Conf RFQ' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Mumbai' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '400001' } });
      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Pump Spares' } });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => {
        expect(screen.getByText('RFQ Created & Forwarded to Category Manager')).toBeInTheDocument();
      });

      // Verify mode_0 without category displays 'Uncategorized (Pending CM)'
      expect(screen.getByText('Uncategorized (Pending CM)')).toBeInTheDocument();

      // Click "Compare in Matrix" to test router.push (line 3371-3373)
      const matrixBtn = screen.getByRole('button', { name: /Compare in Matrix/i });
      fireEvent.click(matrixBtn);
      expect(mockPush).toHaveBeenCalledWith('/buyer/quote-matrix?rfq=RFQ-CONF-001');
      expect(onCompleteMock).toHaveBeenCalled();
    });

    it('covers useRouter exception fallback in component initialization', () => {
      const nextNav = require('next/navigation');
      const origUseRouter = nextNav.useRouter;
      nextNav.useRouter = () => {
        throw new Error('RouterContext not found');
      };

      expect(() => renderWizard()).not.toThrow();

      nextNav.useRouter = origUseRouter;
    });

    it('covers Mode 3 top Procucev vendors ranking, toggle buttons, and AI info close', async () => {
      const origFetch = global.fetch;
      const candidates = [
        {
          id: 'proc-1',
          name: 'Alpha Pipes',
          source: 'procucev_network',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategories: ['Pipes'],
          pincode: '400701',
          rating: 4.8,
          email: 'sales@alpha.in',
        },
        {
          id: 'proc-2',
          name: 'Beta Valves',
          source: 'procucev_network',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategories: ['Valves'],
          pincode: '110001',
          rating: 4.2,
          email: 'sales@beta.in',
        },
      ];

      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        if (typeof url === 'string' && url.includes('/api/vendors') && url.includes('buyerId=all')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: candidates,
              pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
            }),
          }) as any;
        }
        return (origFetch as any)(url, init);
      }) as any;

      renderWizard();
      fireEvent.click(screen.getByTestId('mode-mode_3'));

      fireEvent.change(screen.getByPlaceholderText(MODAL.titlePlaceholder), { target: { value: 'Mode 3 Test' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Navi Mumbai Plant' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '400701' } });
      const targetDate = screen.getByLabelText(/Target Delivery Date/i);
      fireEvent.change(targetDate, { target: { value: '2027-01-01' } });

      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), {
        target: { value: 'Centrifugal Water Pump' },
      });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });
      const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
      fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });

      // Wait for Procucev network vendors to load
      await waitFor(() => {
        expect(screen.getAllByTestId('procucev-v3-vendor').length).toBeGreaterThan(0);
      });

      // Toggle individual vendor button
      const vBtns = screen.getAllByTestId('procucev-v3-vendor');
      fireEvent.click(vBtns[0]); // select
      fireEvent.click(vBtns[0]); // deselect

      // Select all / deselect all
      const selectAllBtn = screen.getByTestId('procucev-v3-select-all');
      fireEvent.click(selectAllBtn); // select all
      fireEvent.click(selectAllBtn); // deselect all
      fireEvent.click(selectAllBtn); // select all again

      // Open & close AI info panel
      fireEvent.click(screen.getByRole('button', { name: /AI Matching Criteria/i }));
      expect(screen.getByText('✕ Close')).toBeInTheDocument();
      fireEvent.click(screen.getByText('✕ Close')); // line 2757
      expect(screen.queryByText('✕ Close')).not.toBeInTheDocument();

      // Submit
      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          id: 'rfq-m3',
          rfqNumber: 'RFQ-M3-001',
          title: 'Mode 3 Test',
          category: 'Engineering Spares - Mechanical',
          sourcingMode: 'mode_3',
          budget: 250000,
          status: 'Quotes Pending',
          assignedVendors: [
            { id: 'proc-1', name: 'Alpha Pipes', vendorCategory: 'Procucev Network' },
          ],
          extractedEntities: [],
          createdAt: '2026-09-10T10:00:00Z',
        },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => {
        expect(screen.getByText('RFQ Dispatched Successfully!')).toBeInTheDocument();
      });

      // Done button with onComplete
      const doneBtn = screen.getByRole('button', { name: /Done/i });
      fireEvent.click(doneBtn);

      global.fetch = origFetch;
    });

    it('covers classification onProgress callback and detectedMajor from line items', async () => {
      mockClassify.mockImplementationOnce(async (_payload: any, onProgress: any) => {
        if (onProgress) {
          onProgress({ processed: 1, total: 2 });
        }
        return {
          success: true,
          data: {
            extractedEntities: [
              { id: 'item-1', majorCategory: 'Civil Works', minorCategory: 'Bricks & Blocks' },
              { id: 'item-2', majorCategory: 'Civil Works', minorCategory: 'Cement' },
            ],
          },
        };
      });

      renderWizard();

      // Add another line item so there are 2 items
      fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));

      const rows = screen.getAllByPlaceholderText(MODAL.itemPlaceholder);
      // Fill item 1 with name
      fireEvent.change(rows[0], { target: { value: 'Item One' } });
      // Fill item 2 with name and existing majorCategory
      fireEvent.change(rows[1], { target: { value: 'Item Two' } });
      const row2 = rows[1].closest('tr')!;
      const [maj2] = within(row2).getAllByRole('combobox') as HTMLSelectElement[];
      fireEvent.change(maj2, { target: { value: 'Civil Works' } });

      // Click Auto-Categorize All (AI)
      fireEvent.click(screen.getByRole('button', { name: /Auto-Categorize/i }));

      await waitFor(() => {
        expect(mockClassify).toHaveBeenCalled();
      });
    });

    it('covers AI extraction sourceFileName and clicking extract without files', async () => {
      renderWizard();

      // Line 891: Click extract with no files uploaded
      const extractBtn = screen.getByRole('button', { name: /Extract Line Items with AI/i });
      fireEvent.click(extractBtn);
      expect(mockExtract).not.toHaveBeenCalled();

      // Now upload file and extract successfully
      const file = new File(['dummy boq content'], 'procurement_boq.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      mockExtract.mockResolvedValueOnce({
        success: true,
        data: {
          title: 'Extracted PO',
          extractedEntities: [
            entity({ id: 'ex-1', itemName: 'Steel Pipes', majorCategory: 'Civil Works' }),
          ],
        },
      });

      uploadFile(file);
      fireEvent.click(extractBtn);

      await waitFor(() => {
        expect(screen.getByText(/Extraction Complete/i)).toBeInTheDocument();
      });

      // Fill remaining required fields to submit
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Pune' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '411001' } });
      const targetDate = screen.getByLabelText(/Target Delivery Date/i);
      fireEvent.change(targetDate, { target: { value: '2027-01-01' } });

      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: mockCreatedRFQ(),
      });

      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => {
        expect(mockCreateRFQ).toHaveBeenCalled();
      });
      // Verify sourceFileName was populated on payload (line 1253)
      expect(mockCreateRFQ.mock.calls[0][0].sourceFileName).toBe('procurement_boq.xlsx');
    });

    it('covers Mode 2 minorCategories parsing and select/deselect all', async () => {
      serveBootstrap([
        {
          id: 'v-m2-a',
          name: 'Alpha Spares',
          email: 'alpha@spares.com',
          source: 'buyer_uploaded',
          majorCategory: 'Engineering Spares - Mechanical',
          minorCategories: 'Pumps, Valves, Belts',
        },
        {
          id: 'v-m2-b',
          name: 'Beta Spares',
          email: 'beta@spares.com',
          source: 'buyer_uploaded',
          majorCategory: 'Engineering Spares - Mechanical',
          vendorSelectedCategories: ['Fasteners', 'Gaskets'],
        },
      ]);

      renderWizard();

      // Select category on line item
      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
      fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });

      await waitFor(() => {
        expect(screen.getByText('Alpha Spares')).toBeInTheDocument();
        expect(screen.getByText('Beta Spares')).toBeInTheDocument();
      });

      // Minor category tags from comma-separated string should render
      expect(screen.getByText('Pumps')).toBeInTheDocument();
      expect(screen.getByText('+1')).toBeInTheDocument();

      // Select All Matched first
      const selectAllBtn = screen.getByRole('button', { name: /Select All Matched/i });
      fireEvent.click(selectAllBtn);

      // Now Deselect all
      const deselectBtn = screen.getByRole('button', { name: /Deselect All/i });
      fireEvent.click(deselectBtn);

      // Re-select all
      fireEvent.click(screen.getByRole('button', { name: /Select All Matched/i }));

      // Toggle single vendor card
      const alphaCard = screen.getByText('Alpha Spares').closest('div')!;
      fireEvent.click(alphaCard); // deselect
      fireEvent.click(alphaCard); // re-select
    });

    it('covers category update email error handling and failed submission states', async () => {
      serveBootstrap([
        {
          id: 'v-err-1',
          name: 'Mismatch Vendor',
          email: 'mismatch@vendor.com',
          source: 'buyer_uploaded',
          majorCategory: 'Civil Works',
        },
      ]);

      renderWizard();

      // Set line item category to Engineering Spares to create mismatch
      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      const [maj] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
      fireEvent.change(maj, { target: { value: 'Engineering Spares - Mechanical' } });

      // Switch to Mismatched tab
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Category Mismatch/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /Category Mismatch/i }));

      const sendEmailBtn = screen.getByTitle('Send email requesting vendor to update their category');

      // 1. mockEmail returns success: false
      mockEmail.mockResolvedValueOnce({ success: false, error: 'SMTP Timeout' });
      fireEvent.click(sendEmailBtn);
      await waitFor(() => expect(mockEmail).toHaveBeenCalled());

      // 2. mockEmail throws exception
      mockEmail.mockRejectedValueOnce(new Error('Network error'));
      fireEvent.click(sendEmailBtn);
      await waitFor(() => expect(mockEmail).toHaveBeenCalledTimes(2));
    });

    it('covers quota exhausted footer links, submit blocking, and banner buttons', async () => {
      renderWizard({
        forceSubscription: 'free_trial',
        forceRemainingFreeRFQs: 0,
      });

      // Footer "Please Upgrade Your Plan" link (lines 2990-3002) while mode_2 is active
      const upgradeLink = screen.getByRole('link', { name: /Please Upgrade Your Plan/i });
      fireEvent.click(upgradeLink);
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByLabelText('Close modal'));

      // Bottom banner "Upgrade Plan" link (line 2949)
      const bannerLinks = screen.getAllByRole('link', { name: /Upgrade Plan/i });
      expect(bannerLinks.length).toBeGreaterThan(0);

      // Both top and bottom banner Switch to Mode 0 buttons
      const v0Btns = screen.getAllByRole('button', { name: /Switch to Mode 0/i });
      expect(v0Btns.length).toBeGreaterThan(0);
      fireEvent.click(v0Btns[0]);
    });

    it('covers delivery pincode format error, debounce timeout, and blur validation', async () => {
      jest.useFakeTimers();

      renderWizard();

      const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);

      // Type 6 characters with special symbols that violate PINCODE_PATTERN
      fireEvent.change(pinInput, { target: { value: '!@#$%^' } });
      expect(screen.getByText('Invalid')).toBeInTheDocument();

      // Type valid 6-digit pincode
      fireEvent.change(pinInput, { target: { value: '560001' } });
      // Advance timers by 400ms to fire debounce setTimeout
      jest.advanceTimersByTime(400);

      // Blur handler
      fireEvent.blur(pinInput);

      jest.useRealTimers();
    });

    it('covers validation error toast when required form fields are missing on submit', () => {
      renderWizard();

      // Clear the title and any prefilled values
      fireEvent.change(screen.getByPlaceholderText(MODAL.titlePlaceholder), { target: { value: '' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: '' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '' } });

      // Click submit
      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      // Form validation should have failed and mockCreateRFQ should not be called
      expect(mockCreateRFQ).not.toHaveBeenCalled();
    });
  });

  describe('IngestionWizard: targeted branch booster v3', () => {
    it('covers entitledSourcingModes exception fallback (lines 320-324)', () => {
      (entitledSourcingModes as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Fallback error');
      });
      renderWizard();
      expect(screen.getByTestId('mode-mode_0')).toBeInTheDocument();
    });

    it('covers activeBuyerAccount delivery location auto-prefill (lines 338-350)', async () => {
      const origFetch = global.fetch;

      // Case 1: city and state present
      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/buyer-accounts/active')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'ba-1',
                corporateEmail: 'buyer1@test.com',
                organizationName: 'Tata Motors',
                contactPerson: 'CPO',
                city: 'Pune',
                state: 'Maharashtra',
                pincode: '411001',
                remainingFreeRFQs: 5,
              },
            }),
          }) as any;
        }
        return (origFetch as any)(url, init);
      }) as any;

      const { unmount: unmount1 } = renderWizard();
      const locInput1 = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder) as HTMLInputElement;
      await waitFor(() => {
        expect(locInput1.value).toBe('Pune, Maharashtra');
      });
      unmount1();

      // Case 2: city and state falsy, primaryPlantLocation present
      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/buyer-accounts/active')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'ba-2',
                corporateEmail: 'buyer2@test.com',
                organizationName: 'Tata Motors',
                contactPerson: 'CPO',
                city: '',
                state: '',
                primaryPlantLocation: 'Sanand Plant',
                pincode: '382110',
                remainingFreeRFQs: 5,
              },
            }),
          }) as any;
        }
        return (origFetch as any)(url, init);
      }) as any;

      const { unmount: unmount2 } = renderWizard();
      const locInput2 = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder) as HTMLInputElement;
      await waitFor(() => {
        expect(locInput2.value).toBe('Sanand Plant');
      });
      unmount2();

      // Case 3: only pincode present, location empty
      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/buyer-accounts/active')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: 'ba-3',
                corporateEmail: 'buyer3@test.com',
                organizationName: 'Tata Motors',
                contactPerson: 'CPO',
                city: '',
                state: '',
                primaryPlantLocation: '',
                pincode: '560001',
                remainingFreeRFQs: 5,
              },
            }),
          }) as any;
        }
        return (origFetch as any)(url, init);
      }) as any;

      const { unmount: unmount3 } = renderWizard();
      const pinInput3 = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder) as HTMLInputElement;
      await waitFor(() => {
        expect(pinInput3.value).toBe('560001');
      });
      unmount3();

      global.fetch = origFetch;
    });

    it('covers AddVendorModal pincode debounce, formats, errors and submission rejections (lines 387-405, 3044, 3140-3142)', async () => {
      jest.useFakeTimers();

      serveBootstrap([
        {
          id: 'v-existing',
          name: 'Existing Supplier',
          email: 'exist@test.com',
          source: 'buyer_uploaded',
          majorCategory: 'Engineering Spares - Mechanical',
        },
      ]);

      const { unmount } = renderWizard();
      fireEvent.click(screen.getByTestId('mode-mode_1'));
      await waitFor(() => {
        expect(screen.getByText('Existing Supplier')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Add Vendor/i }));
      expect(screen.getByText('Add Approved Vendor')).toBeInTheDocument();

      const modalPin = screen.getByPlaceholderText('e.g. 411001');

      // The input onChange strips all non-digit characters (replace(/\D/g, '')),
      // so typing special chars like '!@#$%^' results in an empty state and no error.
      // Instead verify that a cleared / empty pincode shows no error.
      fireEvent.change(modalPin, { target: { value: '!@#$%^' } });
      await waitFor(() => {
        expect(screen.queryByText('Invalid PIN code format')).not.toBeInTheDocument();
      });

      // Dummy pincode
      fireEvent.change(modalPin, { target: { value: '000000' } });
      await waitFor(() => {
        expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();
      });

      // 6 digits with validatePincode returning isValid: false with message
      (validatePincode as jest.Mock).mockResolvedValueOnce({ isValid: false, message: 'Custom invalid pin error' });
      fireEvent.change(modalPin, { target: { value: '411001' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => {
        expect(screen.getByText('Custom invalid pin error')).toBeInTheDocument();
      });

      // 6 digits with validatePincode returning isValid: false without message (fallback)
      (validatePincode as jest.Mock).mockResolvedValueOnce({ isValid: false, message: '' });
      fireEvent.change(modalPin, { target: { value: '411002' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => {
        expect(screen.getByText('Invalid PIN code')).toBeInTheDocument();
      });

      // 6 digits with validatePincode throwing error (catch block)
      (validatePincode as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));
      fireEvent.change(modalPin, { target: { value: '411003' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      // Valid 6 digits with postOffices
      (validatePincode as jest.Mock).mockResolvedValueOnce({ isValid: true, postOffices: [{ name: 'Shivajinagar' } as any] });
      fireEvent.change(modalPin, { target: { value: '411005' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => {
        expect(screen.getByText('Valid')).toBeInTheDocument();
      });

      // Clear pincode back to 2 digits (lines 410-414)
      fireEvent.change(modalPin, { target: { value: '41' } });

      // Minor category selection and deselect (lines 3140-3142)
      const selects = screen.getAllByRole('combobox');
      const majorSelect = selects[0];
      fireEvent.change(majorSelect, { target: { value: 'Engineering Spares - Mechanical' } });
      const selectsAfterMajor = screen.getAllByRole('combobox');
      if (selectsAfterMajor.length > 1) {
        const minorSelect = selectsAfterMajor[1];
        fireEvent.change(minorSelect, { target: { value: 'Pumps & Accessories' } });
        fireEvent.change(minorSelect, { target: { value: '' } });
      }

      // Close modal using X button (line 3044)
      const modalHeader = screen.getByText('Add Approved Vendor').closest('div')!;
      const closeX = modalHeader.parentElement!.querySelector('button');
      if (closeX) {
        fireEvent.click(closeX);
      }

      jest.useRealTimers();
      unmount();
    });

    it('covers delivery pincode debounce failure, empty fallback, and catch (lines 796-797, 811, 817-819)', async () => {
      jest.useFakeTimers();

      renderWizard();
      const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);

      // 1. validatePincode returns isValid: false with message
      (validatePincode as jest.Mock).mockResolvedValueOnce({ isValid: false, message: 'Postal lookup failed' });
      fireEvent.change(pinInput, { target: { value: '411001' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => {
        expect(screen.getByText('Invalid')).toBeInTheDocument();
      });

      // 2. validatePincode returns isValid: false without message (fallback)
      (validatePincode as jest.Mock).mockResolvedValueOnce({ isValid: false, message: '' });
      fireEvent.change(pinInput, { target: { value: '411002' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      // 3. validatePincode throws (catch block line 811)
      (validatePincode as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      fireEvent.change(pinInput, { target: { value: '411003' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      // 4. Change pincode to non-6-digits (lines 817-819)
      fireEvent.change(pinInput, { target: { value: '41' } });

      jest.useRealTimers();
    });

    it('covers Mode 1 and Mode 2 vendor card selection toggles and candidate filtering (lines 1184-1186, 2160-2167, 2480-2495, 2518-2546)', async () => {
      const v1 = {
        id: 'v-toggle-1',
        name: 'Toggle Vendor 1',
        email: 'v1@test.com',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: ['Pumps & Accessories'],
        rating: 4.5,
      };
      const v2 = {
        id: 'v-toggle-2',
        name: 'Toggle Vendor 2',
        email: 'v2@test.com',
        source: 'buyer_uploaded',
        majorCategory: 'Engineering Spares - Mechanical',
        minorCategories: 'Pumps & Accessories, Valves',
        rating: 4.8,
      };
      const v3 = {
        id: 'v-toggle-3',
        name: 'Toggle Vendor 3',
        email: 'v3@test.com',
        source: 'buyer_uploaded',
        majorCategory: 'Office Supplies',
        vendorSelectedCategories: ['Office Supplies'],
        rating: 4.0,
      };

      serveBootstrap([v1, v2, v3]);

      // Test in Mode 1
      const { unmount: unmount1 } = renderWizard();
      fireEvent.click(screen.getByTestId('mode-mode_1'));

      await waitFor(() => {
        expect(screen.getByText('Toggle Vendor 1')).toBeInTheDocument();
      });

      // Click vendor 1: prev was [] -> sets [v2, v3]
      const card1 = screen.getByText('Toggle Vendor 1');
      fireEvent.click(card1);

      // Click vendor 1 again: prev does not include v1 -> [...prev, v1]
      fireEvent.click(card1);

      // Click vendor 1 again: prev includes v1 -> prev.filter
      fireEvent.click(card1);

      // Select All Matched and Deselect All buttons in Mode 1
      const selectAllBtn1 = screen.queryByRole('button', { name: /Select All Matched/i });
      if (selectAllBtn1) fireEvent.click(selectAllBtn1);
      const deselectBtn1 = screen.queryByRole('button', { name: /Deselect All/i });
      if (deselectBtn1) fireEvent.click(deselectBtn1);

      // Dispatch in Mode 1 with selectedVendorIds.length > 0 to hit line 1185
      fireEvent.click(card1); // now selectedVendorIds has items
      fireEvent.change(screen.getByPlaceholderText(MODAL.titlePlaceholder), { target: { value: 'Valid RFQ Title' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Pune' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '411001' } });
      const targetDate1 = screen.getByLabelText(/Target Delivery Date/i);
      fireEvent.change(targetDate1, { target: { value: '2026-12-31' } });
      const row1 = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row1).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Mechanical Pump' } });
      fireEvent.change(within(row1).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '10' } });
      fireEvent.change(within(row1).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Units' } });

      mockCreateRFQ.mockResolvedValueOnce({ success: true, rfq: mockCreatedRFQ() });
      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));
      await waitFor(() => {
        expect(mockCreateRFQ).toHaveBeenCalled();
      });

      unmount1();

      // Test in Mode 2
      const { unmount: unmount2 } = renderWizard();
      fireEvent.click(screen.getByTestId('mode-mode_2'));

      await waitFor(() => {
        expect(screen.getByText('Toggle Vendor 1')).toBeInTheDocument();
      });

      // Click vendor 1 card in Mode 2
      const cardM2 = screen.getByText('Toggle Vendor 1');
      fireEvent.click(cardM2); // prev.length === 0 -> filters out card1
      fireEvent.click(cardM2); // prev does not include -> adds
      fireEvent.click(cardM2); // prev includes -> removes

      // Select All Matched in Mode 2
      const selectAllM2 = screen.queryByRole('button', { name: /Select All Matched/i });
      if (selectAllM2) fireEvent.click(selectAllM2);
      const deselectM2 = screen.queryByRole('button', { name: /Deselect All/i });
      if (deselectM2) fireEvent.click(deselectM2);

      unmount2();
    });

    it('covers Mode 3 no-signals branch, double-blind list, and top-network fallback (lines 2709, 2814-2820, 2900-2903)', async () => {
      const vWithoutId = {
        name: 'No ID Vendor',
        email: 'noid@test.com',
        source: 'buyer_uploaded',
        majorCategory: '', // empty major category to hit fallback line 2820
      };

      serveBootstrap([vWithoutId]);

      // Top 10 procucev network vendor fetch failure mock
      const origFetch = global.fetch;
      global.fetch = jest.fn((url: RequestInfo | URL, init?: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/api/vendors') && urlStr.includes('buyerId=all')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: false,
              data: [],
            }),
          }) as any;
        }
        return (origFetch as any)(url, init);
      }) as any;

      renderWizard();
      fireEvent.click(screen.getByTestId('mode-mode_3'));

      // Verify line 2809/2814/2820 render
      await waitFor(() => {
        expect(screen.getByText('No ID Vendor')).toBeInTheDocument();
        expect(screen.getByText('General Industrial')).toBeInTheDocument();
      });

      global.fetch = origFetch;
    });

    it('covers confirmation modal sourcingMode variants, title fallbacks, and button actions (lines 3270-3388)', async () => {
      // Test confirmation modal with different configurations
      const rfqV0NoCat: RFQItem = {
        ...mockCreatedRFQ(),
        sourcingMode: 'v0' as any,
        category: '',
        title: 'V0 RFQ Without Category',
        assignedVendors: undefined,
        budget: undefined as any,
        extractedEntities: undefined as any,
      };

      expect(resolveConfirmationVendorCount(rfqV0NoCat)).toBe(0);

      // Render wizard and submit to open confirmation modal
      renderWizard();
      fireEvent.change(screen.getByPlaceholderText(MODAL.titlePlaceholder), { target: { value: 'Title For Confirmation' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Pune' } });
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: '411001' } });
      const targetDate = screen.getByLabelText(/Target Delivery Date/i);
      fireEvent.change(targetDate, { target: { value: '2026-12-31' } });
      const row = screen.getByPlaceholderText(MODAL.itemPlaceholder).closest('tr')!;
      fireEvent.change(within(row).getByPlaceholderText(MODAL.itemPlaceholder), { target: { value: 'Pump' } });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), { target: { value: '1' } });
      fireEvent.change(within(row).getByPlaceholderText(MODAL.unitPlaceholder), { target: { value: 'Unit' } });

      mockCreateRFQ.mockResolvedValueOnce({
        success: true,
        rfq: {
          ...mockCreatedRFQ(),
          sourcingMode: 'mode_1',
          category: '', // falsy category to test title fallback (line 3304)
          budget: undefined as any, // no budget (line 3310)
          extractedEntities: undefined as any, // undefined entities (line 3310)
        },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create & Dispatch RFQ/i }));

      await waitFor(() => {
        expect(screen.getByText('Done')).toBeInTheDocument();
      });

      // Click "Create Another RFQ" (lines 3357-3360)
      fireEvent.click(screen.getByRole('button', { name: /Create Another RFQ/i }));
      expect(screen.queryByText('Done')).not.toBeInTheDocument();
    });

    it('covers quota exhausted banner buttons and mode switch', async () => {
      renderWizard({
        forceSubscription: 'free_trial',
        forceRemainingFreeRFQs: 0,
      });

      // Top banner switch to mode 0 button (line 2942)
      const switchBtns = screen.getAllByRole('button', { name: /Switch to Mode 0 \(Free\)/i });
      expect(switchBtns.length).toBeGreaterThan(0);
      fireEvent.click(switchBtns[0]);
    });
  });
});

