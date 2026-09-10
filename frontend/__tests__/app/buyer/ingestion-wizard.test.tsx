import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import { AppProvider } from '@/lib/store';
import { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment, createRFQ } from '@/lib/rfqClient';
import { UI_STRINGS } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type { ExtractedEntity, RFQExtractionResult, RFQItem } from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  extractLineItemsFromDocument: jest.fn(),
  classifyLineItems: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  createRFQ: jest.fn(),
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

    // Verify header and sections render directly
    expect(screen.getByText(/AI RFQ Ingestion & Multi-Mode Sourcing Dispatch/i)).toBeInTheDocument();
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

  it('allows adding, editing, and deleting line items in the table', () => {
    renderWizard();

    // Click Add Line Item
    const addBtn = screen.getByRole('button', { name: /Add Line Item/i });
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

  it('switches sourcing mode when clicking sourcing cards', () => {
    renderWizard();

    const version1Mode = screen.getByTestId('mode-mode_1');
    fireEvent.click(version1Mode);
    expect(version1Mode.getAttribute('aria-checked')).toBe('true');

    const version3Mode = screen.getByTestId('mode-mode_3');
    fireEvent.click(version3Mode);
    expect(version3Mode.getAttribute('aria-checked')).toBe('true');
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
    expect(onComplete).toHaveBeenCalled();
  });

  it('cancels when clicking Cancel button or Exit Wizard button', () => {
    const onCancel = jest.fn();
    renderWizard({ onCancel });

    fireEvent.click(screen.getByRole('button', { name: /Exit Wizard/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const cancelButtons = screen.getAllByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledTimes(2);
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

    // Simulate extraction throwing exception
    mockExtract.mockRejectedValueOnce(new Error('Network failure parsing document'));
    clickExtract();

    await waitFor(() => {
      expect(screen.getByText(/Network failure parsing document/i)).toBeInTheDocument();
    });
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
});

