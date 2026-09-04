import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import { AppProvider, useApp } from '@/lib/store';
import { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment } from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES } from '@/lib/constants';
import categoriesData from '@/lib/categories.json';
import type { ExtractedEntity, RFQAttachment, RFQExtractionResult } from '@/lib/types';

jest.mock('@/lib/rfqClient', () => ({
  extractLineItemsFromDocument: jest.fn(),
  classifyLineItems: jest.fn(),
  uploadRFQAttachment: jest.fn(),
}));

// The wizard flattens a workbook with header:1, so the mock returns row arrays.
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
const mockExtract = extractLineItemsFromDocument as jest.Mock;
const mockClassify = classifyLineItems as jest.Mock;
const mockAttach = uploadRFQAttachment as jest.Mock;

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

/** The budget input starts empty, so it is found by its label, not its value. */
const budgetField = () =>
  screen.getByLabelText(new RegExp(EXTRACTION.budgetLabel.replace('({symbol})', ''), 'i'));

/** The Auto-Categorize control, resolved from the UI string not a literal. */
const clickClassify = () => screen.getByRole('button', { name: new RegExp(EXTRACTION.classifyAction, 'i') });

/**
 * Completes the fields a blank row leaves empty. Every one is required before
 * Step 3 unlocks, because a vendor cannot quote against a missing quantity,
 * unit or category.
 */
const fillBlankRow = (row: HTMLElement) => {
  const [major, minor] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
  fireEvent.change(major, { target: { value: categoriesData[0].majorCategory } });
  fireEvent.change(minor, { target: { value: categoriesData[0].minorCategories[0] } });
  fireEvent.change(within(row).getByPlaceholderText(EXTRACTION.itemQtyPlaceholder), {
    target: { value: '4' },
  });
  fireEvent.change(within(row).getByPlaceholderText(EXTRACTION.itemUnitPlaceholder), {
    target: { value: 'Nos' },
  });
};

const clickExtract = () =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.extractAction, 'i') }));

const clickProceed = () =>
  fireEvent.click(screen.getByRole('button', { name: /Proceed to Sourcing Mode/i }));

const setDeliveryLocation = (value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(EXTRACTION.deliveryLocationLabel, 'i')), {
    target: { value },
  });

const setDeliveryPincode = (value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(EXTRACTION.deliveryPincodeLabel, 'i')), {
    target: { value },
  });

/**
 * The delivery destination, which is mandatory before Step 3 unlocks. Extraction
 * never supplies it, so every test that needs the sourcing step keys it by hand
 * exactly as a buyer does.
 */
const fillDelivery = () => {
  setDeliveryLocation('Navi Mumbai Plant, Gate 3');
  setDeliveryPincode('400701');
};

/** Supplies the mandatory delivery destination, then leaves Step 2. */
const proceedToSourcing = () => {
  fillDelivery();
  clickProceed();
};

describe('IngestionWizard: Step 1 AI document extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
  });

  it('keeps the review and sourcing steps locked until a document is extracted', () => {
    renderWizard();
    // The step strip is a clickable panel rather than a button.
    fireEvent.click(screen.getByTestId('wizard-step-2'));
    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wizard-step-3'));
    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();

    // Nothing is fabricated ahead of extraction either.
    expect(screen.queryByDisplayValue(/Centrifugal Water Pump/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-2').getAttribute('aria-disabled')).toBe('true');
  });

  // Toasts render in the workspace shell, not in a bare provider, so staying on
  // Step 1 with no API call is the observable outcome here.
  it('refuses to extract until a document has been chosen', async () => {
    renderWizard();
    clickExtract();

    await waitFor(() => expect(mockExtract).not.toHaveBeenCalled());
    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();
  });

  it('flattens a spreadsheet to text and sends it for extraction', async () => {
    renderWizard();
    uploadFile(new File(['binary'], 'BOQ_Pumps.xlsx', { type: '' }));

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    const payload = mockExtract.mock.calls[0][0];
    expect(payload.fileName).toBe('BOQ_Pumps.xlsx');
    // Rows are pipe-joined so quantities stay aligned with their item.
    expect(payload.documentText).toContain('Centrifugal Water Pump 500 GPM | 12 | Units');
    expect(payload.documentText).toContain('SHEET: Sheet1');
    // Blank rows are dropped rather than sent as noise.
    expect(payload.documentText).not.toMatch(/\n\s*\|\s*\|\s*\n/);
    expect(payload.inlineData).toBeUndefined();
  });

  it('sends a PDF as inline base64 with its mime type', async () => {
    renderWizard();
    uploadFile(new File(['%PDF-1.4'], 'requirement.pdf', { type: 'application/pdf' }));

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    const payload = mockExtract.mock.calls[0][0];
    expect(payload.mimeType).toBe('application/pdf');
    expect(typeof payload.inlineData).toBe('string');
    expect(payload.inlineData).not.toContain('data:');
    expect(payload.documentText).toBeUndefined();
  });

  it('defaults an unknown browser mime type to PDF', async () => {
    renderWizard();
    uploadFile(new File(['scan'], 'scan.pdf', { type: '' }));

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    expect(mockExtract.mock.calls[0][0].mimeType).toBe('application/pdf');
  });

  it('extracts the pasted requisition text on the email gateway path', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    const payload = mockExtract.mock.calls[0][0];
    expect(payload.documentText).toContain('SUBJECT:');
    expect(payload.documentText).toContain('FROM:');
    expect(payload.documentText).toContain('Centrifugal Water Pump');
  });
});

describe('IngestionWizard: Step 2 review of extracted line items', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const extractThen = async (result: RFQExtractionResult) => {
    mockExtract.mockResolvedValue(result);
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
  };

  it('advances to review and reports what the model read', async () => {
    await extractThen(successResult());

    expect(screen.getByText(EXTRACTION.successTitle)).toBeInTheDocument();
    expect(
      screen.getByText(
        formatString(EXTRACTION.successSummary, { accepted: 1, model: 'gemini-3.6-flash', needsReview: 0 })
      )
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
    // The AI-derived title pre-fills the RFQ header.
    expect(screen.getByDisplayValue('Pump Requirement')).toBeInTheDocument();
  });

  // The whole point of the fallback: an unreadable document must not dead-end.
  it('explains why extraction failed and offers manual entry', async () => {
    await extractThen({
      success: false,
      reason: 'NO_ITEMS_FOUND',
      error: 'No procurement line items could be identified in this document.',
    });

    expect(screen.getByText(EXTRACTION.fallbackTitle)).toBeInTheDocument();
    expect(
      screen.getByText('No procurement line items could be identified in this document.')
    ).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.fallbackHint)).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(EXTRACTION.addFirstItemAction, 'i') })
    ).toBeInTheDocument();
  });

  it('surfaces the NOT_CONFIGURED reason when no API key is set', async () => {
    await extractThen({
      success: false,
      reason: 'NOT_CONFIGURED',
      error: 'AI extraction is not configured on this environment (GEMINI_API_KEY is unset).',
    });

    expect(screen.getByText(/GEMINI_API_KEY is unset/i)).toBeInTheDocument();
  });

  it('lets the buyer key a line item after a failed extraction', async () => {
    await extractThen({ success: false, reason: 'AI_FAILED', error: 'AI extraction could not read this document.' });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.addFirstItemAction, 'i') }));

    expect(screen.queryByText(EXTRACTION.emptyTitle)).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('blocks sourcing while a line item has no description', async () => {
    await extractThen(successResult([entity({ itemName: '' })]));

    proceedToSourcing();

    // Held on Step 2: the Coming Soon panel that only Step 3 renders is absent.
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
    expect(screen.queryByText(EXTRACTION.vendorComingSoonTitle)).not.toBeInTheDocument();
  });

  it('blocks sourcing when there are no line items at all', async () => {
    await extractThen({ success: false, reason: 'AI_FAILED', error: 'unreadable' });

    proceedToSourcing();

    expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByText(EXTRACTION.vendorComingSoonTitle)).not.toBeInTheDocument();
  });

  it('reaches sourcing once every line item is described', async () => {
    await extractThen(successResult());

    proceedToSourcing();

    expect(screen.getByText(EXTRACTION.vendorComingSoonTitle)).toBeInTheDocument();
  });
});

describe('IngestionWizard: Step 3 sourcing mode only', () => {
  const reachStep3 = async (forceSubscription: 'version_1' | 'version_2' | 'version_3' = 'version_3') => {
    mockExtract.mockResolvedValue(successResult());
    const onComplete = jest.fn();
    renderWizard({ forceSubscription, onComplete });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();
    return onComplete;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers every sourcing mode', async () => {
    await reachStep3();
    SOURCING_MODES.forEach((mode) => {
      expect(screen.getByTestId(`mode-card-${mode.id}`)).toBeInTheDocument();
    });
  });

  it('marks vendor matching as coming soon and shows no vendor list', async () => {
    await reachStep3();

    expect(screen.getByText(EXTRACTION.vendorComingSoonTitle)).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.vendorComingSoonBadge)).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.vendorComingSoonMessage)).toBeInTheDocument();
    // The old matched-vendor grid and Mode 3 pool are gone.
    expect(screen.queryByText(/Matched Suitable Vendors/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose Max 5 out of 10 Suppliers/i)).not.toBeInTheDocument();
  });

  it('summarises what will be saved against the chosen mode', async () => {
    await reachStep3();
    fireEvent.click(screen.getByTestId('mode-card-mode_2'));

    const mode2 = SOURCING_MODES.find((m) => m.id === 'mode_2')!;
    // The RFQ number is generated, so the assertion matches the stable tail.
    expect(
      screen.getByText((content) =>
        content.includes(`1 categorised line items will be saved under ${mode2.code}`)
      )
    ).toBeInTheDocument();
  });

  it('locks Mode 3 behind a Version 3 plan', async () => {
    await reachStep3('version_1');

    const mode3 = screen.getByTestId('mode-card-mode_3');
    // Version 1 locks both Mode 2 and Mode 3, so the badge is scoped to the card.
    expect(mode3.textContent).toMatch(/Upgrade Required/i);

    fireEvent.click(mode3);
    // The locked card is never selected, so it keeps the unselected border.
    expect(mode3.className).not.toContain('border-indigo-600');
  });

  it('saves the RFQ with the selected mode and no vendors attached', async () => {
    let captured: { sourcingMode?: string; vendorCount?: number; itemCount?: number } | undefined;

    function Harness() {
      const { rfqs } = useApp();
      const mine = rfqs.find((r) => r.title === 'Pump Requirement');
      if (mine) {
        captured = {
          sourcingMode: mine.sourcingMode,
          vendorCount: mine.followUpData?.totalInvited ?? 0,
          itemCount: mine.extractedEntities.length,
        };
      }
      return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_3" />;
    }

    mockExtract.mockResolvedValue(successResult([entity()], 145000));
    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );

    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();
    fireEvent.click(screen.getByTestId('mode-card-mode_2'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    await waitFor(() => expect(captured).toBeDefined());
    expect(captured).toMatchObject({ sourcingMode: 'mode_2', itemCount: 1 });
    // Vendors are Coming Soon, so nothing is invited and no chaser is aimed at a
    // supplier the buyer never picked.
    expect(captured?.vendorCount).toBe(0);
  });

  it('returns to review from sourcing', async () => {
    await reachStep3();

    fireEvent.click(screen.getByRole('button', { name: /Back to Review/i }));

    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1 intake controls: tabs, drag-and-drop, and the email gateway simulator
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: Step 1 intake controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
  });

  const dropZone = () => screen.getByText(/Click to Browse or Drag & Drop/i).closest('div') as HTMLElement;

  it('switches between the BOQ and email-file upload tabs', () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: /Upload Email File/i }));
    expect(screen.getByText(/Drag & Drop Requisition Email/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /BOQ Spreadsheet \/ Drawing/i }));
    expect(screen.getByText(/Drag & Drop RFQ Document/i)).toBeInTheDocument();
  });

  it('accepts a dropped document and shows the selected file', async () => {
    renderWizard();
    const zone = dropZone();

    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'Dropped_BOQ.xlsx', { type: '' })] } });

    expect(await screen.findByText('Dropped_BOQ.xlsx')).toBeInTheDocument();
  });

  it('ignores a drop that carries no file', () => {
    renderWizard();

    fireEvent.drop(dropZone(), { dataTransfer: { files: [] } });

    expect(screen.queryByText(/Selected File:/i)).not.toBeInTheDocument();
  });

  it('shows no selected-file chip until a document is chosen', () => {
    renderWizard();
    expect(screen.queryByText(/Selected File:/i)).not.toBeInTheDocument();
  });

  it('loads each sample requisition into the email simulator', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));

    fireEvent.click(screen.getByRole('button', { name: /Electrical Switchgear/i }));
    expect(screen.getByDisplayValue(/LV Switchgear Panels & MCCB Breakers/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Civil & PEB Steel/i }));
    expect(screen.getByDisplayValue(/Structural Steel PEB & High-Grade TMT Rebars/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mechanical Pumps & Valves/i }));
    expect(screen.getByDisplayValue(/Centrifugal Water Pumps & Industrial Valves/i)).toBeInTheDocument();
  });

  it('lets the buyer edit the sender, subject and body before extracting', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));

    fireEvent.change(screen.getByDisplayValue(/project.procurement@lt-heavy.com/i), {
      target: { value: 'plant@buyer.com' },
    });
    fireEvent.change(screen.getByDisplayValue(/Centrifugal Water Pumps & Industrial Valves/i), {
      target: { value: 'Need 4 gearboxes' },
    });
    const body = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'Gearbox 40 HP - Qty 4' } });

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    const payload = mockExtract.mock.calls[0][0];
    expect(payload.fileName).toBe('Need 4 gearboxes');
    expect(payload.documentText).toContain('plant@buyer.com');
    expect(payload.documentText).toContain('Gearbox 40 HP - Qty 4');
  });

  it('returns to the web portal method from the email gateway', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));
    expect(screen.getByText(/Autonomous Lights-Out Ingestion/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Web Portal & File Ingestion/i }));
    expect(screen.getByText(/Click to Browse or Drag & Drop/i)).toBeInTheDocument();
  });

  it('exits the wizard through the header control', () => {
    const onCancel = jest.fn();
    renderWizard({ onCancel });

    fireEvent.click(screen.getByRole('button', { name: /Exit Wizard/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the free-trial quota banner on a free account', async () => {
    mockExtract.mockResolvedValue(successResult());
    renderWizard({ forceSubscription: 'free_trial' });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();

    expect(screen.getByText(/Free Starter Account/i)).toBeInTheDocument();
    expect(screen.getByText(/All 3 Versions Unlocked/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2 line-item editing
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: Step 2 line-item editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
  });

  const reachStep2 = async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
  };

  const selects = () =>
    screen.getAllByRole('combobox').filter((el): el is HTMLSelectElement => el.tagName === 'SELECT');

  it('edits the RFQ title and budget', async () => {
    await reachStep2();

    fireEvent.change(screen.getByDisplayValue('Pump Requirement'), { target: { value: 'Revised Title' } });
    expect(screen.getByDisplayValue('Revised Title')).toBeInTheDocument();

    fireEvent.change(budgetField(), { target: { value: '250000' } });
    expect(screen.getByDisplayValue('250000')).toBeInTheDocument();
  });

  it('edits a line item description, specification, quantity, unit and date', async () => {
    await reachStep2();

    fireEvent.change(screen.getByDisplayValue('Centrifugal Water Pump 500 GPM'), {
      target: { value: 'Booster Pump' },
    });
    expect(screen.getByDisplayValue('Booster Pump')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('SS316 impeller'), { target: { value: 'CI casing' } });
    expect(screen.getByDisplayValue('CI casing')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '30' } });
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Units'), { target: { value: 'Sets' } });
    expect(screen.getByDisplayValue('Sets')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('2026-09-15'), { target: { value: '2026-10-01' } });
    expect(screen.getByDisplayValue('2026-10-01')).toBeInTheDocument();
  });

  it('lets the quantity be cleared and shows it as blank rather than zero', async () => {
    await reachStep2();

    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '0' } });

    // Clamping every entry up to 1 meant the field could never be emptied, and a
    // quantity of 1 nobody typed was dispatched to vendors. Scoped to the row so
    // the budget input, which legitimately holds 0, is not matched.
    const qty = within(screen.getAllByRole('row')[1]).getByPlaceholderText(EXTRACTION.itemQtyPlaceholder);
    expect(qty).toHaveValue(null);
  });

  it('locks sourcing while a row has no quantity', async () => {
    await reachStep2();

    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '0' } });

    proceedToSourcing();
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('true');
  });

  // Changing the major category must reset the minor, otherwise the row would
  // keep a minor category that does not belong to its new major.
  it('resets the minor category when the major category changes', async () => {
    await reachStep2();
    const majorSelect = selects().find((s) =>
      Array.from(s.options).some((o) => o.value === 'Civil Works')
    ) as HTMLSelectElement;

    fireEvent.change(majorSelect, { target: { value: 'Civil Works' } });

    // The row falls back to the first minor of the newly chosen major.
    const expectedMinor = categoriesData.find((c) => c.majorCategory === 'Civil Works')!.minorCategories[0];
    const minorSelect = selects().find((s) =>
      Array.from(s.options).some((o) => o.value === expectedMinor)
    ) as HTMLSelectElement;
    expect(minorSelect.value).toBe(expectedMinor);
  });

  it('re-categorises every row through the server taxonomy on demand', async () => {
    await reachStep2();

    mockClassify.mockResolvedValue({
      success: true,
      data: {
        ...successResult().data,
        extractedEntities: [
          entity({ minorCategory: 'Hoses, Valves & Fittings', category: 'Hoses, Valves & Fittings' }),
        ],
      },
      classification: {
        totalExtracted: 1,
        accepted: 1,
        duplicatesRemoved: 0,
        needsReview: 0,
        autoClassified: 1,
      },
    });

    fireEvent.click(clickClassify());

    // The server owns the 280+ category taxonomy, so the row is whatever it says.
    await waitFor(() => {
      const minorSelect = selects().find((s) =>
        Array.from(s.options).some((o) => o.value === 'Hoses, Valves & Fittings')
      ) as HTMLSelectElement;
      expect(minorSelect.value).toBe('Hoses, Valves & Fittings');
    });

    // Only quotable rows are sent; rfqClient decides what fields travel.
    const [sent] = mockClassify.mock.calls[0];
    expect(sent).toHaveLength(1);
    expect(sent[0].itemName).toBe('Centrifugal Water Pump 500 GPM');
  });

  it('keeps a row the server dropped when re-categorising', async () => {
    await reachStep2();
    fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));
    expect(screen.getAllByRole('row')).toHaveLength(3);

    // A blank row has no description, so the server never returns it.
    mockClassify.mockResolvedValue({
      success: true,
      data: { ...successResult().data, extractedEntities: [entity()] },
      classification: {
        totalExtracted: 1,
        accepted: 1,
        duplicatesRemoved: 0,
        needsReview: 0,
        autoClassified: 1,
      },
    });

    fireEvent.click(clickClassify());

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
    // Still three rows: the blank one was preserved rather than discarded.
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('leaves the rows untouched when re-categorisation fails', async () => {
    await reachStep2();
    mockClassify.mockResolvedValue({ success: false, error: EXTRACTION.classifyFailed });

    fireEvent.click(clickClassify());

    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
    expect(screen.getByDisplayValue('Centrifugal Water Pump 500 GPM')).toBeInTheDocument();
  });

  it('does not call the classifier when no row has a description', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      reason: 'NO_ITEMS_FOUND',
      error: EXTRACTION.unreadableResponse,
    });
    renderWizard();
    uploadFile(new File(['x'], 'note.pdf', { type: 'application/pdf' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.addFirstItemAction, 'i') }));
    fireEvent.click(clickClassify());

    expect(mockClassify).not.toHaveBeenCalled();
  });

  it('adds and deletes line items', async () => {
    await reachStep2();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + one row

    fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));
    expect(screen.getAllByRole('row')).toHaveLength(3);

    fireEvent.click(screen.getAllByTitle(/Delete item/i)[1]);
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('returns to ingestion from review', async () => {
    await reachStep2();

    fireEvent.click(screen.getByRole('button', { name: /Back to Ingestion/i }));

    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();
  });

  it('navigates via the step strip', async () => {
    await reachStep2();

    fireEvent.click(screen.getByText(/STEP 1: INGESTION/i));
    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/STEP 2: MINOR CATEGORIZATION/i));
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Remaining branches: read failures, keyword classification, and the step strip
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: edge cases', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require('xlsx');

  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
    XLSX.read.mockImplementation(() => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }));
    XLSX.utils.sheet_to_json.mockImplementation(() => [
      ['Item', 'Qty', 'Unit'],
      ['Centrifugal Water Pump 500 GPM', 12, 'Units'],
    ]);
  });

  // A corrupt workbook must surface the manual-entry fallback, not a crash.
  it('falls back to manual entry when the document cannot be read', async () => {
    XLSX.read.mockImplementation(() => {
      throw new Error('corrupt workbook');
    });
    renderWizard();
    uploadFile(new File(['x'], 'broken.xlsx', { type: '' }));

    clickExtract();

    await waitFor(() => expect(screen.getByText(EXTRACTION.fallbackTitle)).toBeInTheDocument());
    expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('opens the file picker when the drop zone is clicked', () => {
    renderWizard();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByText(/Click to Browse or Drag & Drop/i).closest('div') as HTMLElement);

    expect(clickSpy).toHaveBeenCalled();
  });

  it('changes a minor category directly', async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    const minorSelect = screen
      .getAllByRole('combobox')
      .filter((el): el is HTMLSelectElement => el.tagName === 'SELECT')
      .find((s) => Array.from(s.options).some((o) => o.value === 'Bearings & Accessories')) as HTMLSelectElement;

    fireEvent.change(minorSelect, { target: { value: 'Bearings & Accessories' } });

    expect(minorSelect.value).toBe('Bearings & Accessories');
  });

  // The step strip bypasses the Step 2 gate, so dispatch itself must also refuse
  // an RFQ whose line items lost their descriptions.
  it('refuses to save when a line item was blanked after reaching sourcing', async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    // Reach Step 3 while every row is still valid, then blank one from there.
    proceedToSourcing();
    expect(screen.getByText(EXTRACTION.vendorComingSoonTitle)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wizard-step-2'));
    fireEvent.change(screen.getByDisplayValue('Centrifugal Water Pump 500 GPM'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('wizard-step-3'));

    // Step 3 locks again the moment a row loses its description.
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fallback branches on optional values
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: fallback branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult());
  });

  it('ignores a file input change that carries no file', () => {
    renderWizard();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [] } });

    expect(screen.queryByText(/Selected File:/i)).not.toBeInTheDocument();
  });

  it('names the email payload generically when the subject is cleared', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Email Ingestion Gateway/i }));
    fireEvent.change(screen.getByDisplayValue(/Centrifugal Water Pumps & Industrial Valves/i), {
      target: { value: '' },
    });

    clickExtract();

    await waitFor(() => expect(mockExtract).toHaveBeenCalled());
    expect(mockExtract.mock.calls[0][0].fileName).toBe('requisition-email');
  });

  it('keeps the extracted title when the model supplies none', async () => {
    const result = successResult();
    result.data!.title = '';
    mockExtract.mockResolvedValue(result);

    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();

    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    // Nothing is invented: the title input simply stays empty for the buyer.
    expect(screen.getByLabelText(/Procurement Project Title/i)).toHaveValue('');
  });

  it('derives counts from the entity list when classification is absent', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      data: {
        title: 'Pump Requirement',
        category: 'Engineering Spares - Mechanical',
        targetDeliveryDate: '2026-09-15',
        extractedEntities: [entity()],
        source: 'web_portal',
      },
    });

    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();

    await waitFor(() => expect(screen.getByText(EXTRACTION.successTitle)).toBeInTheDocument());
    expect(
      screen.getByText(formatString(EXTRACTION.successSummary, { accepted: 1, model: '', needsReview: 0 }))
    ).toBeInTheDocument();
  });

  it('locks sourcing when a line item carries no major category', async () => {
    mockExtract.mockResolvedValue(successResult([entity({ majorCategory: '' })], 145000));
    renderWizard();

    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    // The RFQ header category is taken from the leading item, so an unclassified
    // row cannot reach dispatch.
    proceedToSourcing();
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
  });

  it('allows every mode on a version_2 plan except Mode 3', async () => {
    mockExtract.mockResolvedValue(successResult());
    renderWizard({ forceSubscription: 'version_2' });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();

    fireEvent.click(screen.getByTestId('mode-card-mode_2'));
    expect(screen.getByTestId('mode-card-mode_2').className).toContain('border-indigo-600');

    expect(screen.getByTestId('mode-card-mode_3').textContent).toMatch(/Upgrade Required/i);
  });

  it('refuses to select a locked mode and keeps the current selection', async () => {
    mockExtract.mockResolvedValue(successResult());
    renderWizard({ forceSubscription: 'version_2' });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();

    // Mode 3 is gated behind the Version 3 plan, so the click must be rejected.
    fireEvent.click(screen.getByTestId('mode-card-mode_3'));
    expect(screen.getByTestId('mode-card-mode_3').className).not.toContain('border-indigo-600');
  });

  it('refuses to select Mode 2 on a version_1 plan', async () => {
    mockExtract.mockResolvedValue(successResult());
    renderWizard({ forceSubscription: 'version_1' });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    proceedToSourcing();

    // Version 1 only unlocks Mode 1, so the upgrade path for Mode 2 is taken.
    fireEvent.click(screen.getByTestId('mode-card-mode_2'));
    expect(screen.getByTestId('mode-card-mode_2').className).not.toContain('border-indigo-600');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Estimated budget read from the uploaded document
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: estimated budget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const reachStep2 = async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
  };

  it('fills the budget from the value read off the document', async () => {
    mockExtract.mockResolvedValue(successResult([entity()], 348000));
    await reachStep2();

    expect(budgetField()).toHaveValue(348000);
    expect(screen.getByText(formatString(EXTRACTION.budgetFromDocumentHint, { fileName: 'BOQ.xlsx' })))
      .toBeInTheDocument();
  });

  it('asks the buyer for a budget when the document priced nothing', async () => {
    mockExtract.mockResolvedValue(successResult([entity()], null));
    await reachStep2();

    expect(budgetField()).toHaveValue(0);
    expect(screen.getByText(EXTRACTION.budgetMissingHint)).toBeInTheDocument();
  });

  it('drops the document attribution once the buyer overrides the figure', async () => {
    mockExtract.mockResolvedValue(successResult([entity()], 348000));
    await reachStep2();

    fireEvent.change(budgetField(), { target: { value: '400000' } });

    expect(
      screen.queryByText(formatString(EXTRACTION.budgetFromDocumentHint, { fileName: 'BOQ.xlsx' }))
    ).not.toBeInTheDocument();
    // A positive override needs no prompt either.
    expect(screen.queryByText(EXTRACTION.budgetMissingHint)).not.toBeInTheDocument();
  });

  it('clears a stale budget when a later extraction fails', async () => {
    mockExtract.mockResolvedValue(successResult([entity()], 348000));
    await reachStep2();
    expect(budgetField()).toHaveValue(348000);

    // Second upload cannot be read: the previous document's figure must not stick.
    mockExtract.mockResolvedValue({
      success: false,
      reason: 'NO_ITEMS_FOUND',
      error: EXTRACTION.unreadableResponse,
    });
    fireEvent.click(screen.getByTestId('wizard-step-1'));
    uploadFile(new File(['y'], 'note.pdf', { type: 'application/pdf' }));
    clickExtract();

    await waitFor(() => expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument());
    expect(budgetField()).toHaveValue(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sequential step gating
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: step gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult([entity()], 348000));
  });

  it('unlocks the review step once extraction has been attempted', async () => {
    renderWizard();
    expect(screen.getByTestId('wizard-step-2').getAttribute('aria-disabled')).toBe('true');

    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    expect(screen.getByTestId('wizard-step-2').getAttribute('aria-disabled')).toBe('false');
    // Valid line items are not enough on their own: the delivery destination is
    // mandatory too, and extraction never supplies it.
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('true');

    fillDelivery();
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('false');
  });

  it('unlocks the review step even when extraction found nothing', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      reason: 'NO_ITEMS_FOUND',
      error: EXTRACTION.unreadableResponse,
    });
    renderWizard();
    uploadFile(new File(['x'], 'note.pdf', { type: 'application/pdf' }));
    clickExtract();

    await waitFor(() => expect(screen.getByText(EXTRACTION.emptyTitle)).toBeInTheDocument());
    // Manual entry is the documented fallback, so Step 2 must be reachable,
    // while sourcing stays locked until a line item exists.
    expect(screen.getByTestId('wizard-step-2').getAttribute('aria-disabled')).toBe('false');
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('true');
  });

  it('allows navigation back to a completed step', async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('wizard-step-1'));
    expect(screen.getByText(/INGESTION SOURCE/i)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Manual RFQ entry, delivery details and the now-optional budget
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: manual entry and delivery details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult([entity()], 348000));
  });

  const startManual = () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('intake-manual'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.manualStartAction, 'i') }));
  };

  it('offers a manual path that skips extraction entirely', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('intake-manual'));

    // The manual panel is what replaces the upload and email panels.
    expect(screen.getByRole('button', { name: new RegExp(EXTRACTION.manualStartAction, 'i') })).toBeInTheDocument();
    // No document is involved, so the AI extract action must not be offered.
    expect(
      screen.queryByRole('button', { name: new RegExp(EXTRACTION.extractAction, 'i') })
    ).not.toBeInTheDocument();
  });

  it('opens the review step with one empty row and never calls the extractor', () => {
    startManual();

    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
    expect(mockExtract).not.toHaveBeenCalled();
    // Header row plus the single blank line item.
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('unlocks the review step for manual entry even though no extraction ran', () => {
    startManual();
    expect(screen.getByTestId('wizard-step-2').getAttribute('aria-disabled')).toBe('false');
  });

  // Manual rows carry no AI confidence, so the banner says so rather than
  // leaving the buyer wondering why no extraction summary appeared.
  it('explains that the rows were keyed by hand', () => {
    startManual();
    expect(screen.getByText(EXTRACTION.manualBannerMessage)).toBeInTheDocument();
  });

  it('records a manually keyed RFQ against the manual_entry source', async () => {
    let captured: { source?: string; deliveryLocation?: string; deliveryPincode?: string } | undefined;

    function Harness() {
      const { rfqs } = useApp();
      // Matched on the derived title so the seeded RFQs from jest.setup are not
      // picked up instead.
      const mine = rfqs.find((r) => r.title === 'Hydraulic Hose Assembly');
      if (mine) {
        captured = {
          source: mine.source,
          deliveryLocation: mine.deliveryLocation,
          deliveryPincode: mine.deliveryPincode,
        };
      }
      return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_3" />;
    }

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );

    fireEvent.click(screen.getByTestId('intake-manual'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.manualStartAction, 'i') }));

    const itemRow = screen.getAllByRole('row')[1];
    fireEvent.change(within(itemRow).getAllByRole('textbox')[0], {
      target: { value: 'Hydraulic Hose Assembly' },
    });
    // The row starts completely blank, so every quoted-against field is keyed.
    fillBlankRow(itemRow);

    // proceedToSourcing keys the destination asserted on below.
    proceedToSourcing();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    await waitFor(() => expect(captured).toBeDefined());
    expect(captured!.source).toBe('manual_entry');
    expect(captured!.deliveryLocation).toBe('Navi Mumbai Plant, Gate 3');
    expect(captured!.deliveryPincode).toBe('400701');
  });


  it('titles a manual RFQ from its leading line item when none was typed', async () => {
    let capturedTitle: string | undefined;

    function Harness() {
      const { rfqs } = useApp();
      const mine = rfqs.find((r) => r.title === 'Bearing Housing Assembly');
      if (mine) capturedTitle = mine.title;
      return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_3" />;
    }

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );

    fireEvent.click(screen.getByTestId('intake-manual'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.manualStartAction, 'i') }));
    expect(screen.getByLabelText(/Procurement Project Title/i)).toHaveValue('');

    const row = screen.getAllByRole('row')[1];
    fireEvent.change(within(row).getAllByRole('textbox')[0], {
      target: { value: 'Bearing Housing Assembly' },
    });
    fillBlankRow(row);

    proceedToSourcing();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    // The API requires a title of at least three characters, so an empty one
    // would have been rejected on save.
    await waitFor(() => expect(capturedTitle).toBe('Bearing Housing Assembly'));
  });

  // The budget is optional now: a document that prices nothing must still save.
  it('saves an RFQ with no budget at all', async () => {
    const onComplete = jest.fn();
    mockExtract.mockResolvedValue(successResult([entity()], null));

    renderWizard({ onComplete });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    expect(budgetField()).toHaveValue(0);

    proceedToSourcing();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('refuses to save a malformed pincode and returns to the review step', async () => {
    const onComplete = jest.fn();
    renderWizard({ onComplete });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    // The location is supplied so the malformed pincode is the only blocker.
    setDeliveryLocation('Navi Mumbai Plant, Gate 3');
    setDeliveryPincode('-!');
    // Flagged inline while the buyer is still on the field. A malformed value is
    // reported straight away, unlike a blank one, which waits for Proceed.
    expect(screen.getByText(EXTRACTION.deliveryPincodeInvalidMessage)).toBeInTheDocument();

    // A malformed pincode now blocks the Step 2 gate rather than only failing on
    // save, so sourcing is never reached and there is no dispatch button to press.
    clickProceed();

    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') })
    ).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  // Both fields start empty, so validating on first render greeted the buyer with
  // two errors against fields they had not reached yet.
  it('holds back the blank-field warnings until the buyer tries to move on', async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    expect(screen.queryByText(EXTRACTION.deliveryLocationRequiredMessage)).not.toBeInTheDocument();
    expect(screen.queryByText(EXTRACTION.deliveryPincodeRequiredMessage)).not.toBeInTheDocument();

    clickProceed();

    expect(screen.getByText(EXTRACTION.deliveryLocationRequiredMessage)).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.deliveryPincodeRequiredMessage)).toBeInTheDocument();
    expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument();
  });

  // Each warning clears on its own so the buyer can see which field is still open.
  it('clears each blank-field warning as that field is filled', async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    clickProceed();
    setDeliveryLocation('Navi Mumbai Plant, Gate 3');

    expect(screen.queryByText(EXTRACTION.deliveryLocationRequiredMessage)).not.toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.deliveryPincodeRequiredMessage)).toBeInTheDocument();

    setDeliveryPincode('400701');

    expect(screen.queryByText(EXTRACTION.deliveryPincodeRequiredMessage)).not.toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('false');
  });

  it('accepts an international zipcode with a space or hyphen', async () => {
    const onComplete = jest.fn();
    renderWizard({ onComplete });
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());

    setDeliveryLocation('Tilbury Docks, Berth 4');
    setDeliveryPincode('SW1A 1AA');
    expect(screen.queryByText(EXTRACTION.deliveryPincodeInvalidMessage)).not.toBeInTheDocument();

    clickProceed();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A row added by hand starts genuinely blank
//
// Defaults used to be pre-filled — quantity 1, unit Nos, a target date and the
// first taxonomy pair — which read as answers the buyer had given. A quantity of
// 1 and a category of "Civil Works" are exactly the values that get dispatched
// to vendors unnoticed.
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: blank added row', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult([entity()], 145000));
  });

  const addedRow = async () => {
    renderWizard();
    uploadFile(new File(['x'], 'BOQ.xlsx', { type: '' }));
    clickExtract();
    await waitFor(() => expect(screen.getByText(/REVIEW ENTITIES/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Add Line Item/i }));
    // Row 1 is the extracted item, row 2 the one just added.
    return screen.getAllByRole('row')[2];
  };

  it('leaves every field on the new row empty', async () => {
    const row = await addedRow();

    const [name, specs] = within(row).getAllByRole('textbox') as HTMLTextAreaElement[];
    expect(name).toHaveValue('');
    expect(specs).toHaveValue('');
    expect(within(row).getByPlaceholderText(EXTRACTION.itemQtyPlaceholder)).toHaveValue(null);
    expect(within(row).getByPlaceholderText(EXTRACTION.itemUnitPlaceholder)).toHaveValue('');

    const [major, minor] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    expect(major.value).toBe('');
    expect(minor.value).toBe('');
  });

  it('guides each empty field with a placeholder', async () => {
    const row = await addedRow();

    expect(within(row).getByPlaceholderText(EXTRACTION.itemNamePlaceholder)).toBeInTheDocument();
    expect(within(row).getByPlaceholderText(EXTRACTION.itemSpecsPlaceholder)).toBeInTheDocument();
    expect(within(row).getByText(EXTRACTION.categoryPlaceholder)).toBeInTheDocument();
    expect(within(row).getByText(EXTRACTION.minorCategoryPlaceholder)).toBeInTheDocument();
  });

  // A green 0% badge would report a score that was never computed.
  it('reports no confidence rather than zero percent', async () => {
    const row = await addedRow();

    expect(within(row).getByText(EXTRACTION.confidenceUnset)).toBeInTheDocument();
    expect(within(row).queryByText('0%')).not.toBeInTheDocument();
  });

  it('keeps sourcing locked until the new row is completed', async () => {
    const row = await addedRow();
    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: 'Gasket Set' } });
    fillBlankRow(row);
    fillDelivery();

    expect(screen.getByTestId('wizard-step-3').getAttribute('aria-disabled')).toBe('false');
  });

  it('clears the minor category when the major is changed', async () => {
    const row = await addedRow();
    fillBlankRow(row);

    const [major, minor] = within(row).getAllByRole('combobox') as HTMLSelectElement[];
    expect(minor.value).toBe(categoriesData[0].minorCategories[0]);

    // The minor belongs to the major, so it must follow it rather than keep a
    // value from a different family.
    fireEvent.change(major, { target: { value: categoriesData[1].majorCategory } });
    expect(minor.value).toBe(categoriesData[1].minorCategories[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Supporting documents on the manual path
//
// Attached for reference and never extracted: on this path the buyer keys the
// line items, so spending Gemini quota reading the file would be pointless.
// ═══════════════════════════════════════════════════════════════════════════════
describe('IngestionWizard: manual attachments', () => {
  const stored = (overrides: Partial<RFQAttachment> = {}): RFQAttachment => ({
    id: 'a1b2c3d4-0000-4000-8000-abcdefabcdef',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-09-02T11:07:16.000Z',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockExtract.mockResolvedValue(successResult([entity()], 145000));
    mockAttach.mockResolvedValue({ success: true, data: stored() });
  });

  const openManual = () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('intake-manual'));
  };

  const attach = (files: File[]) =>
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files } });

  const pdf = (name = 'annexure.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });

  it('offers document upload on the manual path', () => {
    openManual();
    expect(screen.getByText(EXTRACTION.attachTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(EXTRACTION.attachAction, 'i') })).toBeInTheDocument();
  });

  it('stores the chosen document and lists it', async () => {
    openManual();
    attach([pdf()]);

    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());
    expect(screen.getByText(formatString(EXTRACTION.attachedHeading, { count: 1 }))).toBeInTheDocument();
    // 2048 bytes shown in the units a buyer reads.
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  // The whole point of the manual path: nothing is sent for extraction.
  it('never calls the extractor when a document is attached', async () => {
    openManual();
    attach([pdf()]);

    await waitFor(() => expect(mockAttach).toHaveBeenCalled());
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('uploads each of several files separately', async () => {
    mockAttach
      .mockResolvedValueOnce({ success: true, data: stored({ id: 'id-one', fileName: 'drawing.pdf' }) })
      .mockResolvedValueOnce({ success: true, data: stored({ id: 'id-two', fileName: 'indent.pdf' }) });

    openManual();
    attach([pdf('drawing.pdf'), pdf('indent.pdf')]);

    await waitFor(() => expect(screen.getByText('indent.pdf')).toBeInTheDocument());
    expect(screen.getByText('drawing.pdf')).toBeInTheDocument();
    expect(mockAttach).toHaveBeenCalledTimes(2);
  });

  it('reports a refused document against the file that caused it', async () => {
    mockAttach.mockResolvedValue({ success: false, error: 'That file type cannot be attached.' });
    openManual();

    attach([pdf('payload.exe')]);

    await waitFor(() => expect(mockAttach).toHaveBeenCalled());
    // Nothing is listed, because nothing was stored.
    expect(screen.queryByText('payload.exe')).not.toBeInTheDocument();
  });

  it('removes an attachment from the RFQ', async () => {
    openManual();
    attach([pdf()]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole('button', { name: formatString(EXTRACTION.attachRemoveAria, { fileName: 'annexure.pdf' }) })
    );

    expect(screen.queryByText('annexure.pdf')).not.toBeInTheDocument();
  });

  it('ignores a file input change that carries no files', () => {
    openManual();
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [] } });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('carries the attachments onto the saved RFQ', async () => {
    let captured: RFQAttachment[] | undefined;

    function Harness() {
      const { rfqs } = useApp();
      const mine = rfqs.find((r) => r.title === 'Gasket Set');
      if (mine) captured = mine.attachments;
      return <IngestionWizard onComplete={jest.fn()} onCancel={jest.fn()} forceSubscription="version_3" />;
    }

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );

    fireEvent.click(screen.getByTestId('intake-manual'));
    attach([pdf()]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.manualStartAction, 'i') }));
    const row = screen.getAllByRole('row')[1];
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: 'Gasket Set' } });
    fillBlankRow(row);

    proceedToSourcing();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(EXTRACTION.dispatchAction, 'i') }));

    await waitFor(() => expect(captured).toBeDefined());
    expect(captured).toHaveLength(1);
    expect(captured![0].fileName).toBe('annexure.pdf');
  });

  it('refuses to attach beyond the per-RFQ limit', async () => {
    openManual();

    // Fill the allowance one file at a time.
    for (let i = 0; i < 10; i += 1) {
      mockAttach.mockResolvedValueOnce({
        success: true,
        data: stored({ id: `id-${i}`, fileName: `doc-${i}.pdf` }),
      });
      attach([pdf(`doc-${i}.pdf`)]);
      await waitFor(() => expect(screen.getByText(`doc-${i}.pdf`)).toBeInTheDocument());
    }
    expect(mockAttach).toHaveBeenCalledTimes(10);

    attach([pdf('one-too-many.pdf')]);

    // The eleventh is refused before a request is made.
    expect(mockAttach).toHaveBeenCalledTimes(10);
    expect(screen.queryByText('one-too-many.pdf')).not.toBeInTheDocument();
  });
});
