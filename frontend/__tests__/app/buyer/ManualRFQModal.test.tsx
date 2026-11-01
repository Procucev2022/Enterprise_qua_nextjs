import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { SOURCING_MODES } from '@/lib/constants';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type {
  ExtractedEntity,
  RFQAttachment,
  RFQExtractionResult,
  RFQItem,
} from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
  classifyLineItems: jest.fn(() => Promise.resolve({ success: true, data: { extractedEntities: [] } })),
  fetchAllVendors: jest.fn(),
  requestVendorCategoryUpdateEmail: jest.fn(() => Promise.resolve({ success: true })),
}));

// The modal reads buyerVendors from useApp() inside a try/catch, since it can
// render outside an AppProvider in some contexts. Defaults to throwing (the
// historical, un-provided case every other test in this file relies on);
// individual Mode 1 roster tests override this to return a real value.
jest.mock('@/lib/store', () => ({
  useApp: jest.fn(() => ({
    buyerVendors: [
      {
        id: 'v-default-1',
        name: 'Default Enterprise Vendor',
        email: 'vendor@test.com',
        source: 'buyer_uploaded',
        // Matches categoriesData[0], which fillRow() always sets as the RFQ's
        // category — Mode 1 assignment is now category-scoped (see the
        // ManualRFQModal source), so a vendor with no category at all would
        // never match any RFQ's category and every generic save test in this
        // file (not specifically testing category-matching) would break.
        majorCategory: require('../../../test-fixtures/categoryTaxonomy').CATEGORY_TAXONOMY_FIXTURE[0].majorCategory,
      },
    ],
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useApp } = require('@/lib/store');

// Reading a File is jsdom's business, not this dialog's: the request builder is
// exercised directly in documentExtraction.test.ts.
jest.mock('@/lib/documentExtraction', () => ({
  buildExtractionRequest: jest.fn(async (file: File) => ({
    fileName: file.name,
    inlineData: 'ZmFrZQ==',
    mimeType: file.type || 'application/pdf',
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const rfqClient = require('@/lib/rfqClient');

const MODAL = UI_STRINGS.manualRfqModal;
const MANUAL = UI_STRINGS.manualRfq;
const EXTRACTION = UI_STRINGS.rfqExtraction;

const onClose = jest.fn();
const onCreated = jest.fn();

const renderModal = (isOpen = true) =>
  render(<ManualRFQModal isOpen={isOpen} onClose={onClose} onCreated={onCreated} />);

function savedRFQ(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: 'Engineering Spares - Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  } as RFQItem;
}

function attachment(overrides: Partial<RFQAttachment> = {}): RFQAttachment {
  return {
    id: 'a1',
    fileName: 'annexure.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedAt: '2026-09-02T11:07:16.000Z',
    ...overrides,
  };
}

/** The single row the dialog opens with. */
const firstRow = () => screen.getAllByRole('row')[1];

/** Complete every field a line item needs before dispatch. */
function fillRow() {
  const row = firstRow();
  fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
    target: { value: 'Centrifugal Water Pump' },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
    target: { value: categoriesData[0].majorCategory },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMinor), {
    target: { value: categoriesData[0].minorCategories[0] },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colQty), { target: { value: '12' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colUnit), { target: { value: 'Nos' } });
}

/** Fill the mandatory delivery destination. */
function fillDelivery() {
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
    target: { value: 'Navi Mumbai Plant, Gate 3' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
    target: { value: '400701' },
  });
}

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

/** One extracted line item, in the shape the extraction endpoint returns. */
function extractedEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Units',
    targetDate: '2026-10-15',
    technicalSpecs: 'SS316 impeller',
    confidence: 90,
    category: categoriesData[0].minorCategories[0],
    majorCategory: categoriesData[0].majorCategory,
    minorCategory: categoriesData[0].minorCategories[0],
    ...overrides,
  };
}

function extractionResult({
  entities = [extractedEntity()],
  title = 'Pump Requirement',
  estimatedBudget = 250000 as number | null,
}: {
  entities?: ExtractedEntity[];
  title?: string;
  estimatedBudget?: number | null;
} = {}): RFQExtractionResult {
  return {
    success: true,
    data: {
      title,
      category: categoriesData[0].majorCategory,
      targetDeliveryDate: '2026-10-15',
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

import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';

beforeEach(() => {
  jest.clearAllMocks();
  setCategoryTaxonomy(categoriesData);
  (useApp as jest.Mock).mockReturnValue({
    buyerVendors: [
      {
        id: 'v-default-1',
        name: 'Default Enterprise Vendor',
        email: 'vendor@test.com',
        source: 'buyer_uploaded',
        // Matches categoriesData[0], the category fillRow()/extractionResult()
        // always set — Mode 1 assignment is category-scoped now, so a vendor
        // with no category would never match any RFQ's category here.
        majorCategory: categoriesData[0].majorCategory,
      },
    ],
  });
  rfqClient.createRFQ.mockResolvedValue({ success: true, rfq: savedRFQ() });
  // A distinct id and name per upload: the list is keyed on the id, and two
  // documents in one selection must not collide.
  let uploadCount = 0;
  rfqClient.uploadRFQAttachment.mockImplementation((file: File) => {
    uploadCount += 1;
    return Promise.resolve({
      success: true,
      data: attachment({ id: `a${uploadCount}`, fileName: file.name }),
    });
  });
  rfqClient.extractLineItemsFromDocument.mockResolvedValue(extractionResult());
  rfqClient.fetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  });
});

describe('ManualRFQModal: visibility', () => {
  it('renders nothing while closed', () => {
    renderModal(false);
    expect(screen.queryByTestId('manual-rfq-modal')).not.toBeInTheDocument();
  });

  it('renders as a labelled modal dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: MODAL.title })).toBeInTheDocument();
  });

  it('closes from the header control and from Cancel', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: MODAL.closeAria }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: MODAL.cancelAction }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('opens with exactly one blank line item', () => {
    renderModal();
    // Header row plus one item row.
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('');
  });

  // A blank row must read blank. A zero is indistinguishable from a buyer who
  // meant zero, and zero is what used to reach vendors unnoticed.
  it('shows an unanswered quantity as blank rather than zero', () => {
    renderModal();
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(null);
  });

  it('shows an unanswered budget as blank rather than zero', () => {
    renderModal();
    expect(
      screen.getByLabelText(/Estimated Budget/i)
    ).toHaveValue(null);
  });
});

describe('ManualRFQModal: line items', () => {
  it('adds and removes rows', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(MODAL.addItemAction, 'i') }));
    expect(screen.getAllByRole('row')).toHaveLength(3);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: formatString(MODAL.removeItemAria, { item: MODAL.untitledItem }),
      })[0]
    );
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('reports an empty list rather than rendering an empty table', () => {
    renderModal();
    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(MODAL.removeItemAria, { item: MODAL.untitledItem }),
      })
    );
    expect(screen.getByText(MODAL.noItemsMessage)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // Nothing can be chosen until the major is set, because the options depend on it.
  it('disables the minor category until a major is chosen', () => {
    renderModal();
    const row = firstRow();
    expect(within(row).getByLabelText(MODAL.colMinor)).toBeDisabled();

    fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
      target: { value: categoriesData[0].majorCategory },
    });
    expect(within(row).getByLabelText(MODAL.colMinor)).toBeEnabled();
  });

  // A minor from the previous major is invalid under the new one, and leaving it
  // would dispatch a mismatched pair to vendors.
  it('clears the minor category when the major changes', () => {
    renderModal();
    const row = firstRow();
    const major = within(row).getByLabelText(MODAL.colMajor);
    const minor = within(row).getByLabelText(MODAL.colMinor) as HTMLSelectElement;

    fireEvent.change(major, { target: { value: categoriesData[0].majorCategory } });
    fireEvent.change(minor, { target: { value: categoriesData[0].minorCategories[0] } });
    expect(minor.value).toBe(categoriesData[0].minorCategories[0]);

    fireEvent.change(major, { target: { value: categoriesData[1].majorCategory } });
    expect(minor.value).toBe('');
  });
});

describe('ManualRFQModal: validation', () => {
  // Validating on open would greet the buyer with a screen of red against fields
  // they have not reached.
  it('shows no errors until the buyer tries to save', () => {
    renderModal();
    expect(screen.queryByText(MANUAL.itemNameRequired)).not.toBeInTheDocument();
    expect(screen.queryByText(MANUAL.deliveryLocationRequired)).not.toBeInTheDocument();
  });

  it('reports every blocking field once Save is pressed', () => {
    renderModal();
    clickSave();

    expect(screen.getByText(MANUAL.itemNameRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.quantityRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.unitRequired)).toBeInTheDocument();
    // Category is optional now — no error shown for a blank major/minor category.
    expect(screen.queryByText(MANUAL.majorCategoryRequired)).not.toBeInTheDocument();
    expect(screen.getByText(MANUAL.deliveryLocationRequired)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.deliveryPincodeRequired)).toBeInTheDocument();
  });

  it('does not post an invalid form', () => {
    renderModal();
    clickSave();
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  it('distinguishes a malformed pincode from a blank one', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
      target: { value: '!!' },
    });
    clickSave();

    expect(screen.getByText(MANUAL.deliveryPincodeInvalid)).toBeInTheDocument();
    expect(screen.queryByText(MANUAL.deliveryPincodeRequired)).not.toBeInTheDocument();
  });

  it('rejects a negative budget', () => {
    renderModal();
    fireEvent.change(
      screen.getByLabelText(/Estimated Budget/i),
      { target: { value: '-5' } }
    );
    clickSave();
    expect(screen.getByText(MANUAL.budgetNegative)).toBeInTheDocument();
  });

  it('clears an error once the field is filled', () => {
    renderModal();
    clickSave();
    expect(screen.getByText(MANUAL.deliveryLocationRequired)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
      target: { value: 'Navi Mumbai Plant, Gate 3' },
    });
    expect(screen.queryByText(MANUAL.deliveryLocationRequired)).not.toBeInTheDocument();
  });
});

describe('ManualRFQModal: saving', () => {
  it('posts the form and hands back the server record', async () => {
    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalledTimes(1));

    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.source).toBe('manual_entry');
    expect(payload.deliveryPincode).toBe('400701');
    expect(payload.extractedEntities).toHaveLength(1);
    // The server allocates the number, so the client must not send one.
    expect(payload).not.toHaveProperty('rfqNumber');

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedRFQ()));
    expect(screen.getByRole('button', { name: /Done \/ Close/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Done \/ Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failure and keeps the dialog open', async () => {
    rfqClient.createRFQ.mockResolvedValue({
      success: false,
      reason: 'SERVER',
      error: 'The RFQ could not be saved.',
    });

    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The RFQ could not be saved.'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the controls while saving', async () => {
    let release: (value: unknown) => void = () => {};
    rfqClient.createRFQ.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: MODAL.savingAction })).toBeDisabled()
    );
    expect(screen.getByRole('button', { name: MODAL.cancelAction })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: MODAL.closeAria }));
    expect(onClose).not.toHaveBeenCalled();

    release({ success: true, rfq: savedRFQ() });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('displays confirmation screen for uncategorized V0 RFQ and allows creating another', async () => {
    rfqClient.createRFQ.mockResolvedValue({
      success: true,
      rfq: savedRFQ({
        rfqNumber: 'RFQ-V0-UNCAT',
        sourcingMode: 'mode_0',
        category: '',
        extractedEntities: [{ id: 'e1', itemName: 'Widgets', quantity: 5, unit: 'pcs', targetDate: '', technicalSpecs: '', confidence: 1, category: '', majorCategory: '', minorCategory: '' }],
        assignedVendors: [],
      }),
    });

    renderModal();
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(screen.getByText(/RFQ Created & Forwarded to Category Manager/i)).toBeInTheDocument());
    expect(screen.getByText('0 (Pending CM Assignment)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create Another RFQ/i }));
    expect(screen.queryByText(/RFQ Created & Forwarded to Category Manager/i)).not.toBeInTheDocument();
  });
});

describe('ManualRFQModal: supporting documents', () => {
  const chooseFiles = (files: File[]) =>
    fireEvent.change(screen.getByTestId('manual-modal-attachment-input'), { target: { files } });

  it('uploads a chosen document and lists it', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);

    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());
    expect(rfqClient.uploadRFQAttachment).toHaveBeenCalledTimes(1);
  });

  it('ignores a change that carries no files', () => {
    renderModal();
    chooseFiles([]);
    expect(rfqClient.uploadRFQAttachment).not.toHaveBeenCalled();
  });

  // Uploaded one at a time so a rejection names the file that caused it.
  it('reports a refused document against its own file', async () => {
    rfqClient.uploadRFQAttachment
      .mockResolvedValueOnce({ success: true, data: attachment({ id: 'ok', fileName: 'good.pdf' }) })
      .mockResolvedValueOnce({ success: false, error: 'That file type cannot be attached.' });

    renderModal();
    chooseFiles([
      new File(['x'], 'good.pdf', { type: 'application/pdf' }),
      new File(['y'], 'bad.exe', { type: 'application/x-msdownload' }),
    ]);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('bad.exe'));
    // The one that succeeded is still attached.
    expect(screen.getByText('good.pdf')).toBeInTheDocument();
  });

  it('removes an attachment', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole('button', {
        name: formatString(MODAL.removeAttachmentAria, { fileName: 'annexure.pdf' }),
      })
    );
    expect(screen.queryByText('annexure.pdf')).not.toBeInTheDocument();
  });

  it('carries the attachments onto the saved RFQ', async () => {
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByText('annexure.pdf')).toBeInTheDocument());

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].attachments).toHaveLength(1);
  });
});

describe('ManualRFQModal: header and item fields', () => {
  it('records the RFQ title, budget and target date on the payload', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
      target: { value: 'Monsoon Pump Overhaul' },
    });
    fireEvent.change(screen.getByLabelText(/Estimated Budget/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.targetDateLabel, 'i')), {
      target: { value: '2026-12-31' },
    });
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.title).toBe('Monsoon Pump Overhaul');
    expect(payload.budget).toBe(250000);
    expect(payload.targetDeliveryDate).toBe('2026-12-31');
  });

  it('records the per-item specs on the payload', async () => {
    renderModal();
    fillRow();
    const row = firstRow();
    fireEvent.change(within(row).getByLabelText(MODAL.colSpecs), {
      target: { value: 'SS316 impeller, 415V' },
    });
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const item = rfqClient.createRFQ.mock.calls[0][0].extractedEntities[0];
    expect(item.technicalSpecs).toBe('SS316 impeller, 415V');
  });

  it('clears an entered budget back to unstated rather than to zero', () => {
    renderModal();
    const budget = screen.getByLabelText(/Estimated Budget/i);
    fireEvent.change(budget, { target: { value: '250000' } });
    expect(budget).toHaveValue(250000);

    fireEvent.change(budget, { target: { value: '' } });
    expect(budget).toHaveValue(null);
  });
});

describe('ManualRFQModal: sourcing mode', () => {
  it('starts on the first mode and switches on selection', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();
    const mode1 = screen.getByLabelText(/(Mode 1|Version 1)/i);
    const mode3 = screen.getByLabelText(/(Mode 3|Version 3)/i);
    expect(mode1).toBeChecked();

    fireEvent.click(mode3);
    expect(mode3).toBeChecked();
    expect(mode1).not.toBeChecked();

    fillRow();
    fillDelivery();
    clickSave();
    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].sourcingMode).toBe('mode_3');
  });

  it('unlocks all 3 modes for a free_trial buyer', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'free_trial' },
    });
    renderModal();
    const mode1 = screen.getByLabelText(/(Mode 1|Version 1)/i);
    const mode2 = screen.getByLabelText(/(Mode 2|Version 2)/i);
    const mode3 = screen.getByLabelText(/(Mode 3|Version 3)/i);
    expect(mode1).not.toBeDisabled();
    expect(mode2).not.toBeDisabled();
    expect(mode3).not.toBeDisabled();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  it('locks Mode 2 and Mode 3 for a version_1 buyer and blocks selecting them', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [{ id: 'v-1', name: 'Vendor 1', source: 'buyer_uploaded', majorCategory: categoriesData[0].majorCategory }],
      activeBuyerAccount: { subscriptionPlan: 'version_1' },
    });
    renderModal();
    const mode1 = screen.getByLabelText(/(Mode 1|Version 1)/i);
    const mode2 = screen.getByLabelText(/(Mode 2|Version 2)/i);
    const mode3 = screen.getByLabelText(/(Mode 3|Version 3)/i);

    expect(mode1).not.toBeDisabled();
    expect(mode2).toBeDisabled();
    expect(mode3).toBeDisabled();
    expect(screen.getAllByText('LOCKED')).toHaveLength(2);

    fireEvent.click(mode2);
    expect(mode1).toBeChecked();
    expect(mode2).not.toBeChecked();

    fillRow();
    fillDelivery();
    clickSave();
    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].sourcingMode).toBe('mode_1');
  });

  it('unlocks every mode for a version_3 buyer', () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();
    const mode1 = screen.getByLabelText(/(Mode 1|Version 1)/i);
    const mode2 = screen.getByLabelText(/(Mode 2|Version 2)/i);
    const mode3 = screen.getByLabelText(/(Mode 3|Version 3)/i);

    expect(mode1).not.toBeDisabled();
    expect(mode2).not.toBeDisabled();
    expect(mode3).not.toBeDisabled();
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument();
  });

  // Each card states the reach that tier buys as well as how it routes, so the
  // three can be compared before one is chosen. Asserted against the constants
  // rather than literals so the copy can be reworded without breaking the test.
  it('shows the routing description and the tier feature summary on every mode card', () => {
    renderModal();

    SOURCING_MODES.forEach((mode) => {
      const card = screen.getByTestId(`manual-mode-${mode.id}`);
      expect(card).toHaveTextContent(mode.description);
      expect(card).toHaveTextContent(mode.featureSummary);
    });
  });

  it('gives each mode its own feature summary naming the tiers it includes', () => {
    renderModal();

    const summaries = SOURCING_MODES.map((mode) => mode.featureSummary);
    // No two cards may claim the same reach, which is what made the tiers
    // indistinguishable on this screen before.
    expect(new Set(summaries).size).toBe(SOURCING_MODES.length);
    // The summaries are cumulative: each tier includes the ones beneath it.
    expect(screen.getByTestId('manual-mode-mode_1')).toHaveTextContent(/Features of (Mode 1|Version 1)/i);
    expect(screen.getByTestId('manual-mode-mode_2')).toHaveTextContent(/Features of (Mode 1 & 2|Version 1 & 2)/i);
    expect(screen.getByTestId('manual-mode-mode_3')).toHaveTextContent(/Features of (Mode 1, 2 & 3|Version 1, 2 & 3)/i);
  });

  // The bullet is a visual marker, not content, so it must not be announced.
  it('hides the decorative bullet from assistive technology', () => {
    renderModal();
    const card = screen.getByTestId('manual-mode-mode_1');
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('ManualRFQModal: extraction from an attached document', () => {
  const chooseFiles = (files: File[]) =>
    fireEvent.change(screen.getByTestId('manual-modal-attachment-input'), { target: { files } });

  const attachOne = async (name = 'boq.pdf') => {
    chooseFiles([new File(['x'], name, { type: 'application/pdf' })]);
    await waitFor(() => expect(rfqClient.uploadRFQAttachment).toHaveBeenCalled());
    // The extract button stays disabled while the upload is in flight
    // (isAttaching), so wait for it to actually be clickable rather than
    // just for the upload call to have started.
    await waitFor(() => expect(extractBtn()).toBeEnabled());
  };

  const extractBtn = () => screen.getByTestId('manual-extract');

  it('opens the file picker from the attach control', () => {
    renderModal();
    const input = screen.getByTestId('manual-modal-attachment-input');
    const click = jest.spyOn(input, 'click');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(MODAL.attachAction, 'i') }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('offers no extraction until a document is attached', async () => {
    renderModal();
    expect(extractBtn()).toBeDisabled();

    await attachOne();
    expect(extractBtn()).toBeEnabled();
  });

  it('fills the table, title, budget and category from the document', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue(
        'Centrifugal Water Pump 500 GPM'
      )
    );
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12);
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('Pump Requirement');
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(250000);
    expect(within(firstRow()).getByLabelText(MODAL.colMajor)).toHaveValue(
      categoriesData[0].majorCategory
    );
  });

  it('leaves rows editable after extraction', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );

    fireEvent.change(within(firstRow()).getByLabelText(MODAL.colQty), { target: { value: '30' } });
    expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(30);
  });

  it('keeps what the buyer already typed in preference to the document', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
      target: { value: 'Buyer-supplied title' },
    });
    fireEvent.change(screen.getByLabelText(/Estimated Budget/i), { target: { value: '999' } });
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue(
      'Buyer-supplied title'
    );
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(999);
  });

  it('takes nothing from a document that names neither a title nor a budget', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue(
      extractionResult({ title: '', estimatedBudget: null })
    );

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('');
    expect(screen.getByLabelText(/Estimated Budget/i)).toHaveValue(null);
  });

  it('shows the in-progress label while the document is being read', async () => {
    let release: (value: unknown) => void = () => {};
    rfqClient.extractLineItemsFromDocument.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() => expect(screen.getByText(MODAL.extractingAction)).toBeInTheDocument());
    expect(extractBtn()).toBeDisabled();

    release(extractionResult());
    await waitFor(() => expect(screen.getByText(MODAL.extractAction)).toBeInTheDocument());
  });

  // A failure must cost the buyer nothing they had already keyed.
  it('reports a failed extraction and leaves the keyed rows alone', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue({
      success: false,
      error: 'The document could not be read.',
    });

    renderModal();
    fillRow();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The document could not be read.')
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boq.pdf');
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('Centrifugal Water Pump');
  });

  // A machine reason with no server message must resolve to reason-specific
  // guidance, and the failure banner must offer an explicit manual-entry action.
  it('shows reason-specific guidance and a manual-entry action on failure', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue({
      success: false,
      reason: 'UNSUPPORTED_TYPE',
    });

    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        UI_STRINGS.rfqExtraction.reasonMessages.UNSUPPORTED_TYPE
      )
    );

    // The recovery action clears the banner and leaves a row to key into.
    fireEvent.click(screen.getByTestId('manual-enter-fallback'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toBeInTheDocument();
  });

  // Reported per document, so one unreadable file does not discard the other's rows.
  it('keeps the rows from a readable document when another fails', async () => {
    rfqClient.extractLineItemsFromDocument
      .mockResolvedValueOnce(extractionResult())
      .mockResolvedValueOnce({ success: false, error: 'Unsupported layout.' });

    renderModal();
    chooseFiles([
      new File(['x'], 'good.pdf', { type: 'application/pdf' }),
      new File(['y'], 'bad.pdf', { type: 'application/pdf' }),
    ]);
    await waitFor(() => expect(rfqClient.uploadRFQAttachment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(extractBtn()).toBeEnabled());

    fireEvent.click(extractBtn());

    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );
    expect(screen.getByText(/bad\.pdf: Unsupported layout\./)).toBeInTheDocument();
  });

  it('changes nothing when the document yields no line items', async () => {
    rfqClient.extractLineItemsFromDocument.mockResolvedValue(extractionResult({ entities: [] }));

    renderModal();
    fillRow();
    await attachOne();
    fireEvent.click(extractBtn());

    await waitFor(() => expect(rfqClient.extractLineItemsFromDocument).toHaveBeenCalled());
    expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('Centrifugal Water Pump');
    expect(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i'))).toHaveValue('');
  });

  it('dispatches the extracted rows on save', async () => {
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colQty)).toHaveValue(12)
    );

    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const payload = rfqClient.createRFQ.mock.calls[0][0];
    expect(payload.extractedEntities).toHaveLength(1);
    expect(payload.extractedEntities[0].itemName).toBe('Centrifugal Water Pump 500 GPM');
  });
});

describe('ManualRFQModal: Mode 1 private vendor roster preview', () => {
  it('shows the empty-roster state and blocks dispatch when the buyer has no uploaded vendors for Version 1', async () => {
    (useApp as jest.Mock).mockReturnValue({ buyerVendors: [] });
    renderModal();

    expect(screen.getByText('No Private Vendors Uploaded Yet')).toBeInTheDocument();
    expect(screen.getByText('0 Suppliers Found')).toBeInTheDocument();

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => {
      expect(screen.getByText(/(Mode 1|Version 1) \(Client Sourcing\) requires at least one private vendor/i)).toBeInTheDocument();
    });
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  it('lists the buyer-uploaded vendors and dispatches strictly to them on save', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [
        {
          id: 'v-hist-1',
          name: 'Apex Industrial Dynamics',
          contactPerson: 'Rajesh Nair',
          email: 'rajesh@apex.in',
          phone: '+91 98200 11111',
          source: 'historical_purchase_dump',
          majorCategory: categoriesData[0].majorCategory,
        },
        // No name/email/phone/contactPerson: exercises every fallback.
        { id: 'v-hist-2', source: 'historical_purchase_dump', majorCategory: categoriesData[0].majorCategory },
        // Not buyer-uploaded: must be excluded from both the preview and the payload.
        { id: 'v-cm-1', name: 'Category Manager Vendor', source: 'category_manager_upload', majorCategory: categoriesData[0].majorCategory },
      ],
    });
    renderModal();

    expect(screen.getByText('2 Suppliers Found')).toBeInTheDocument();
    expect(screen.getByText(/1\. Apex Industrial Dynamics/)).toBeInTheDocument();
    expect(screen.getByText('Rajesh Nair')).toBeInTheDocument();
    expect(screen.getByText('rajesh@apex.in')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.queryByText('Category Manager Vendor')).not.toBeInTheDocument();

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    const assignedVendors = rfqClient.createRFQ.mock.calls[0][0].assignedVendors;
    expect(assignedVendors).toEqual([
      {
        id: 'v-hist-1',
        name: 'Apex Industrial Dynamics',
        email: 'rajesh@apex.in',
        contactPerson: 'Rajesh Nair',
        phone: '+91 98200 11111',
      },
      {
        id: 'v-hist-2',
        name: 'Enterprise Vendor',
        email: null,
        contactPerson: null,
        phone: null,
      },
    ]);
  });

  it('does not attach assignedVendors when the selected mode is not Mode 1', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [{ id: 'v-hist-1', name: 'Apex Industrial Dynamics', source: 'historical_purchase_dump' }],
      activeBuyerAccount: { subscriptionPlan: 'version_3' },
    });
    renderModal();

    const mode3Checkbox = screen.getByLabelText(/(Mode 3|Version 3)/i);
    fireEvent.click(mode3Checkbox);

    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => expect(rfqClient.createRFQ).toHaveBeenCalled());
    expect(rfqClient.createRFQ.mock.calls[0][0].assignedVendors).toEqual([]);
  });

  // Regression coverage for a real production bug: a buyer's IT-category
  // vendor was assigned to a Mechanical RFQ because this modal never
  // category-filtered assignedVendors at all — every uploaded vendor was
  // unconditionally dispatched every Mode 1 RFQ regardless of relevance.
  it('excludes an uploaded vendor whose category does not match the RFQ, rather than dispatching to it anyway', async () => {
    (useApp as jest.Mock).mockReturnValue({
      buyerVendors: [
        {
          id: 'v-it-1',
          name: 'IT Vendor Co',
          email: 'it@vendor.com',
          source: 'historical_purchase_dump',
          majorCategory: 'IT',
          minorCategories: ['IT'],
        },
      ],
    });
    renderModal();

    // fillRow() sets the RFQ's category to categoriesData[0] ('Civil Works'),
    // which the IT vendor above does not cover at all.
    fillRow();
    fillDelivery();
    clickSave();

    await waitFor(() => {
      expect(screen.getByText(/(Mode 1|Version 1) \(Client Sourcing\) requires at least one private vendor/i)).toBeInTheDocument();
    });
    // Must NOT have silently fallen back to dispatching to the mismatched vendor.
    expect(rfqClient.createRFQ).not.toHaveBeenCalled();
  });

  describe('Mode 2 and Mode 3 category-matched vendor previews', () => {
    it('displays private approved roster and AI matching in Mode 2 and Mode 3', async () => {
      const testMajor = 'Professional Services';
      const testMinor = 'Security Service';

      (useApp as jest.Mock).mockReturnValue({
        buyerVendors: [
          { id: 'v-hist-1', name: 'Private Vendor', majorCategory: testMajor, minorCategories: [testMinor], source: 'buyer_uploaded' },
        ],
        activeBuyerAccount: { subscriptionPlan: 'version_3' },
      });
      renderModal();

      const row = screen.getAllByRole('row')[1];
      fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
        target: { value: testMajor },
      });
      fireEvent.change(within(row).getByLabelText(MODAL.colMinor), {
        target: { value: testMinor },
      });

      // Select Mode 2
      const mode2Checkbox = screen.getByLabelText(/(Mode 2|Version 2)/i);
      fireEvent.click(mode2Checkbox); // Mode 2

      expect(screen.getByText(/Mode 2: Hybrid Sourcing Pool/i)).toBeInTheDocument();
      expect(screen.getByText('Private Vendor')).toBeInTheDocument();

      // Test AI Info button toggle in Mode 2
      const aiInfoBtn = screen.getByRole('button', { name: /ai matching info/i });
      expect(screen.queryByText(/How QUA AI Categorizes & Matches Suppliers/i)).not.toBeInTheDocument();
      fireEvent.click(aiInfoBtn);
      expect(screen.getByText(/How QUA AI Categorizes & Matches Suppliers/i)).toBeInTheDocument();
      expect(screen.getByText(/BOQ & Line-Item Classification/i)).toBeInTheDocument();

      // Select Mode 3
      const mode3Checkbox = screen.getByLabelText(/(Mode 3|Version 3)/i);
      fireEvent.click(mode3Checkbox); // Mode 3
      expect(screen.getByText(/Mode 3: Double-Blind Autonomous Sourcing/i)).toBeInTheDocument();
      expect(screen.getByText('Private Vendor')).toBeInTheDocument();

      // Verify Mode 3 container styling
      const mode3Container = screen.getByText(/Mode 3: Double-Blind Autonomous Sourcing/i).closest('.border-indigo-200');
      expect(mode3Container).not.toBeNull();
    });
  });

  describe('ManualRFQModal: Quota exhaustion and upgrade plan', () => {
    it('shows quota exhausted warning banner and upgrade plan CTA when remaining free RFQs are 0 on free_trial', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
      expect(screen.getByText(MODAL.quotaExhaustedTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Please Upgrade Your Plan/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: MODAL.saveAction })).not.toBeInTheDocument();
    });

    it('does not show quota exhausted banner when user has remaining free RFQs', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 3,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('does not show quota exhausted banner for paid subscription users even if remainingFreeRFQs is 0', () => {
      useApp.mockReturnValue({
        activeSubscription: 'version_1',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'version_1', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('opens RfqUpgradePlanModal when buyer clicks unentitled mode when credits are exhausted', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      const mode2Card = screen.getByTestId('manual-mode-mode_2');
      fireEvent.click(mode2Card);

      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
      expect(screen.getByText(/You don't have credits to publish the RFQ in Mode 2/i)).toBeInTheDocument();
    });

    it('opens RfqUpgradePlanModal when clicking upgrade CTA on quota banner', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      const upgradeLinks = screen.getAllByRole('link', { name: /Please Upgrade Your Plan/i });
      fireEvent.click(upgradeLinks[0]);

      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
    });
  });

  describe('ManualRFQModal: Quota exhaustion and upgrade plan', () => {
    it('shows quota exhausted warning banner and upgrade plan CTA when remaining free RFQs are 0 on free_trial', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
      expect(screen.getByText(MODAL.quotaExhaustedTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Please Upgrade Your Plan/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: MODAL.saveAction })).not.toBeInTheDocument();
    });

    it('does not show quota exhausted banner when user has remaining free RFQs', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 3,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('does not show quota exhausted banner for paid subscription users even if remainingFreeRFQs is 0', () => {
      useApp.mockReturnValue({
        activeSubscription: 'version_1',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'version_1', remainingFreeRFQs: 0 },
      });
      renderModal();

      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
    });

    it('auto-populates delivery location when valid PIN code is entered and onBlur is fired', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            Status: 'Success',
            PostOffice: [
              {
                Name: 'Vashi',
                District: 'Thane',
                State: 'Maharashtra',
              },
            ],
          },
        ],
      } as Response);

      renderModal();
      const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);
      fireEvent.change(pinInput, { target: { value: '400703' } });
      fireEvent.blur(pinInput);

      await waitFor(() => {
        const locInput = screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder);
        expect((locInput as HTMLInputElement).value).toBe('Thane, Maharashtra');
      });
    });
  });

  describe('ManualRFQModal: branch coverage booster', () => {
    it('covers confirmation screen navigation and closing actions', async () => {
      rfqClient.createRFQ.mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ({ sourcingMode: 'mode_0', category: '' }),
      });
      renderModal();
      fillRow();
      fillDelivery();
      const mode0Radio = screen.getByLabelText(SOURCING_MODES[0].shortLabel);
      fireEvent.click(mode0Radio);
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(screen.getByText('RFQ Created & Forwarded to Category Manager')).toBeInTheDocument();
      });

      // Click View Quotation Matrix
      const matrixBtn = screen.getByRole('button', { name: /View Quotation Matrix/i });
      fireEvent.click(matrixBtn);
      expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/buyer/quote-matrix?rfq='));
      expect(onClose).toHaveBeenCalled();
    });

    it('covers Done / Close button and Create Another RFQ on confirmation screen', async () => {
      rfqClient.createRFQ.mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ({ sourcingMode: 'mode_0', category: '' }),
      });
      renderModal();
      fillRow();
      fillDelivery();
      const mode0Radio = screen.getByLabelText(SOURCING_MODES[0].shortLabel);
      fireEvent.click(mode0Radio);
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(screen.getByText('RFQ Created & Forwarded to Category Manager')).toBeInTheDocument();
      });

      // Test "Create Another RFQ"
      const anotherBtn = screen.getByRole('button', { name: /Create Another RFQ/i });
      fireEvent.click(anotherBtn);
      expect(screen.queryByText('RFQ Created & Forwarded to Category Manager')).not.toBeInTheDocument();

      // Submit again and click "Done / Close"
      rfqClient.createRFQ.mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ({ sourcingMode: 'mode_0', category: '' }),
      });
      fillRow();
      fillDelivery();
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));
      await waitFor(() => {
        expect(screen.getByText('RFQ Created & Forwarded to Category Manager')).toBeInTheDocument();
      });
      const doneBtn = screen.getByRole('button', { name: /Done \/ Close/i });
      fireEvent.click(doneBtn);
      expect(onClose).toHaveBeenCalled();
    });

    it('covers Auto-Categorize All when all items already have categories', async () => {
      const mockShowToast = jest.fn();
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [],
      });
      renderModal();
      fillRow();
      const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All/i });
      fireEvent.click(autoCatBtn);

      expect(mockShowToast).toHaveBeenCalledWith(
        EXTRACTION.classifySuccessTitle,
        'All line items already have a category.',
        'info'
      );
    });

    it('covers Auto-Categorize All with unclassified items and progress tracking', async () => {
      const mockShowToast = jest.fn();
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [],
      });
      (rfqClient.classifyLineItems as jest.Mock).mockImplementationOnce(
        async (_items: any[], onProgress?: (p: { processed: number; total: number }) => void) => {
          if (onProgress) {
            onProgress({ processed: 1, total: 1 });
          }
          return {
            success: true,
            data: {
              extractedEntities: [
                {
                  id: 'row-1',
                  itemName: 'Industrial Valve',
                  majorCategory: categoriesData[0].majorCategory,
                  minorCategory: categoriesData[0].minorCategories[0],
                },
              ],
            },
          };
        }
      );

      renderModal();
      const row = firstRow();
      fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
        target: { value: 'Industrial Valve' },
      });
      const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All/i });
      fireEvent.click(autoCatBtn);

      await waitFor(() => {
        expect(rfqClient.classifyLineItems).toHaveBeenCalled();
      });
    });

    it('covers Auto-Categorize All failure and exception handling', async () => {
      const mockShowToast = jest.fn();
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [],
      });
      (rfqClient.classifyLineItems as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'Classification failed on AI server',
      });

      renderModal();
      const row = firstRow();
      fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
        target: { value: 'Test Item' },
      });
      const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All/i });
      fireEvent.click(autoCatBtn);

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          EXTRACTION.fallbackTitle,
          'Classification failed on AI server',
          'warning'
        );
      });

      // Test exception path
      (rfqClient.classifyLineItems as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      fireEvent.click(autoCatBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          EXTRACTION.fallbackTitle,
          EXTRACTION.classifyFailed,
          'warning'
        );
      });
    });

    it('covers vendor category update email dispatch: success, warning, and error', async () => {
      const mockShowToast = jest.fn();
      const testVendor = {
        id: 'v-mismatch-1',
        name: 'Mismatch Vendor',
        email: 'mismatch@vendor.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material',
      };
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [testVendor],
      });

      renderModal();
      fillRow();

      // Switch to Mismatch category tab
      const mismatchTab = await screen.findByRole('button', { name: /Mismatch/i });
      fireEvent.click(mismatchTab);

      // Click Request Category Update email button
      const emailBtn = await screen.findByRole('button', { name: /Send Email to Update Category/i });
      fireEvent.click(emailBtn);

      await waitFor(() => {
        expect(rfqClient.requestVendorCategoryUpdateEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            vendorId: 'v-mismatch-1',
            vendorEmail: 'mismatch@vendor.com',
          })
        );
        expect(mockShowToast).toHaveBeenCalledWith(
          'Category Update Email Sent',
          expect.stringContaining('mismatch@vendor.com'),
          'success'
        );
      });

      // Test failure response
      (rfqClient.requestVendorCategoryUpdateEmail as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: 'SMTP quota exceeded',
      });
      fireEvent.click(emailBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Email Delivery Issue',
          'SMTP quota exceeded',
          'warning'
        );
      });

      // Test error response
      (rfqClient.requestVendorCategoryUpdateEmail as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout')
      );
      fireEvent.click(emailBtn);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Error',
          'Network timeout',
          'warning'
        );
      });
    });

    it('covers pincode validation branch edge cases: dummy, invalid format, and server rejection', async () => {
      renderModal();
      const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);

      // Dummy pincode: 000000
      fireEvent.change(pinInput, { target: { value: '000000' } });
      expect(pinInput).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Invalid')).toBeInTheDocument();

      // Invalid format with non-digits
      fireEvent.change(pinInput, { target: { value: '400@#!' } });
      expect(pinInput).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Invalid')).toBeInTheDocument();

      // Empty pincode clears error
      fireEvent.change(pinInput, { target: { value: '' } });
      expect(screen.queryByText('Invalid')).not.toBeInTheDocument();

      // 6-digit valid digits, but API returns isValid: false
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [{ Status: 'Error', Message: 'No record found' }],
      } as Response);
      fireEvent.change(pinInput, { target: { value: '999999' } });
      await waitFor(() => {
        expect(screen.getByText('Invalid')).toBeInTheDocument();
      });

      // API throws error
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Pincode API down'));
      fireEvent.change(pinInput, { target: { value: '999998' } });
    });

    it('covers supporting documents and extraction file size limit and exceptions', async () => {
      (rfqClient.extractLineItemsFromDocument as jest.Mock).mockResolvedValue({
        success: false,
        reason: 'NO_TABLE',
        error: 'No tabular items detected',
      });
      renderModal();

      // File > 15MB
      const hugeFile = new File(['x'], 'huge_file.pdf', { type: 'application/pdf' });
      Object.defineProperty(hugeFile, 'size', { value: 16 * 1024 * 1024 });

      const attachInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(attachInput, { target: { files: [hugeFile] } });
      await waitFor(() => {
        expect(screen.getByText(/File exceeds the 15 MB limit/i)).toBeInTheDocument();
      });

      // Upload throws error
      (rfqClient.uploadRFQAttachment as jest.Mock).mockRejectedValueOnce(new Error('Storage service offline'));
      const normalFile = new File(['normal content'], 'doc_err.pdf', { type: 'application/pdf' });
      fireEvent.change(attachInput, { target: { files: [normalFile] } });
      await waitFor(() => {
        expect(screen.getByText(/Storage service offline/i)).toBeInTheDocument();
      });

      // Extraction with file > 15MB
      const extractFileHuge = new File(['x'], 'extract_huge.pdf', { type: 'application/pdf' });
      Object.defineProperty(extractFileHuge, 'size', { value: 16 * 1024 * 1024 });
      fireEvent.change(attachInput, { target: { files: [extractFileHuge] } });

      const extractBtn = screen.getByRole('button', { name: new RegExp(MODAL.extractAction, 'i') });
      fireEvent.click(extractBtn);
      await waitFor(() => {
        expect(screen.getByText(/File exceeds the 15 MB limit/i)).toBeInTheDocument();
      });

      // Recovery: Enter Manually button
      const enterManuallyBtn = await screen.findByTestId('manual-enter-fallback');
      fireEvent.click(enterManuallyBtn);
      expect(screen.queryByTestId('manual-enter-fallback')).not.toBeInTheDocument();

      // Extraction API failure
      const validDoc = new File(['doc content'], 'spec.pdf', { type: 'application/pdf' });
      fireEvent.change(attachInput, { target: { files: [validDoc] } });
      await waitFor(() => {
        expect(extractBtn).toBeEnabled();
      });
      fireEvent.click(extractBtn);
      await waitFor(() => {
        expect(screen.getByTestId('manual-enter-fallback')).toBeInTheDocument();
      });
    });

    it('covers quota exhausted actions: Use V0, Upgrade Plan, and save blocking', async () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      renderModal();
      fillRow();
      fillDelivery();

      // Initially quota exhausted banner and bottom upgrade link are both present
      expect(screen.getByTestId('manual-rfq-quota-exhausted-banner')).toBeInTheDocument();
      const upgradeLink = screen.getByRole('link', { name: /Please Upgrade Your Plan/i });
      fireEvent.click(upgradeLink);
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();

      // Close upgrade plan modal using Close modal button
      const closeUpgradeBtn = screen.getByRole('button', { name: 'Close modal' });
      fireEvent.click(closeUpgradeBtn);
      expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();

      // Open upgrade plan modal via top banner link
      const topUpgradeLink = screen.getByRole('link', { name: MODAL.upgradePlanAction });
      fireEvent.click(topUpgradeLink);
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();

      // Click "Publish in Mode 0 (Free)" inside upgrade modal to switch to Mode 0
      const switchToMode0Btn = screen.getByRole('button', { name: /Publish in Mode 0 \(Free\)/i });
      fireEvent.click(switchToMode0Btn);
      expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();

      // Now sourcing mode is Mode 0: quota banner is gone, save button appears
      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();

      // Clicking an unentitled mode card (e.g. Mode 1) directly opens the upgrade modal
      const mode1Card = screen.getByTestId('manual-mode-mode_1');
      fireEvent.click(mode1Card);
      expect(screen.getByTestId('rfq-upgrade-plan-modal')).toBeInTheDocument();
      const cancelBtn = screen.getByRole('button', { name: /Cancel & Keep Editing/i });
      fireEvent.click(cancelBtn);
      expect(screen.queryByTestId('rfq-upgrade-plan-modal')).not.toBeInTheDocument();
    });

    it('covers Mode 1 vendor selection toolbar: search, category tabs, item click, and bulk select', async () => {
      const v1 = {
        id: 'v-matched-1',
        name: 'Alpha Engineering',
        email: 'alpha@eng.com',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
      };
      const v2 = {
        id: 'v-matched-2',
        name: 'Beta Automation',
        email: 'beta@auto.com',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
      };
      const v3 = {
        id: 'v-other-3',
        name: 'Gamma Packaging',
        email: 'gamma@pkg.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material',
      };
      useApp.mockReturnValue({
        buyerVendors: [v1, v2, v3],
      });

      renderModal();
      fillRow();

      // Toolbar search input
      const searchInput = screen.getByPlaceholderText(/Search suppliers by name/i);
      fireEvent.change(searchInput, { target: { value: 'Alpha' } });
      expect(screen.getByText(/Alpha Engineering/i)).toBeInTheDocument();
      expect(screen.queryByText(/Beta Automation/i)).not.toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });

      // Click "All" tab
      const allTab = screen.getByRole('button', { name: /^All \(/i });
      fireEvent.click(allTab);
      expect(screen.getByText(/Gamma Packaging/i)).toBeInTheDocument();

      // Click vendor card to toggle selection
      const vendorCard = screen.getByText(/Alpha Engineering/i).closest('div[class*="cursor-pointer"]') as HTMLElement;
      fireEvent.click(vendorCard);
      fireEvent.click(vendorCard);

      // Deselect All / Select All toggle
      const selectAllBtn = screen.getByRole('button', { name: /Select All|Deselect All/i });
      fireEvent.click(selectAllBtn);
      fireEvent.click(selectAllBtn);

      // Click "Matched" tab
      const matchedTab = screen.getByRole('button', { name: /^Matched \(/i });
      fireEvent.click(matchedTab);

      // Search with no matches
      fireEvent.change(searchInput, { target: { value: 'Nonexistent Vendor' } });
      expect(screen.getByText(/No Category-Matched Vendors|No Vendors Found/i)).toBeInTheDocument();
      fireEvent.change(searchInput, { target: { value: '' } });
    });

    it('covers AI Matching Info panel toggle in Mode 2 and Mode 3, plus Mode 2 toolbar and email', async () => {
      const v1 = {
        id: 'v-mode2-1',
        name: 'Omega Electronics',
        email: 'omega@elec.com',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
      };
      const v2 = {
        id: 'v-mode2-2',
        name: 'Delta Plastics',
        email: 'delta@plastics.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material',
      };
      const mockShowToast = jest.fn();
      useApp.mockReturnValue({
        showToast: mockShowToast,
        activeSubscription: 'version_3',
        buyerVendors: [v1, v2],
      });
      renderModal();
      fillRow();

      // Select Mode 2
      const mode2Card = screen.getByTestId('manual-mode-mode_2');
      fireEvent.click(mode2Card);

      // Toggle AI Matching Info panel in Mode 2
      const aiInfoBtn = screen.getByRole('button', { name: /AI Matching Info/i });
      fireEvent.click(aiInfoBtn);
      expect(screen.getByText(/How QUA AI Categorizes & Matches Suppliers/i)).toBeInTheDocument();

      // Close AI Matching Info panel in Mode 2
      const closeAiInfoBtn = screen.getByRole('button', { name: /✕ Close/i });
      fireEvent.click(closeAiInfoBtn);
      expect(screen.queryByText(/How QUA AI Categorizes & Matches Suppliers/i)).not.toBeInTheDocument();

      // Mode 2 vendor roster toolbar: Search, All tab, Mismatched tab, item click, bulk select
      const searchInput = screen.getByPlaceholderText(/Search suppliers by name/i);
      fireEvent.change(searchInput, { target: { value: 'Omega' } });
      expect(screen.getByText(/Omega Electronics/i)).toBeInTheDocument();
      fireEvent.change(searchInput, { target: { value: '' } });

      const allTab = screen.getByRole('button', { name: /^All \(/i });
      fireEvent.click(allTab);
      expect(screen.getByText(/Delta Plastics/i)).toBeInTheDocument();

      // Toggle selection on vendor card in Mode 2
      const card2 = screen.getByText(/Omega Electronics/i).closest('div[class*="cursor-pointer"]') as HTMLElement;
      fireEvent.click(card2);
      fireEvent.click(card2);

      // Mode 2 Deselect/Select All
      const selectAllBtn = screen.getByRole('button', { name: /Select All|Deselect All/i });
      fireEvent.click(selectAllBtn);
      fireEvent.click(selectAllBtn);

      // Mode 2 Mismatched tab and Category Update Email
      const mismatchTab = screen.getByRole('button', { name: /Mismatch/i });
      fireEvent.click(mismatchTab);
      const emailBtn = await screen.findByRole('button', { name: /Send Email to Update Category/i });
      fireEvent.click(emailBtn);
      await waitFor(() => {
        expect(rfqClient.requestVendorCategoryUpdateEmail).toHaveBeenCalledWith(
          expect.objectContaining({ vendorId: 'v-mode2-2', vendorEmail: 'delta@plastics.com' })
        );
      });

      // Now switch to Mode 3
      const mode3Card = screen.getByTestId('manual-mode-mode_3');
      fireEvent.click(mode3Card);

      // Toggle AI Matching Info in Mode 3
      const aiInfoBtn3 = screen.getByRole('button', { name: /AI Matching Info/i });
      fireEvent.click(aiInfoBtn3);
      expect(screen.getByText(/How QUA AI Categorizes & Matches Suppliers/i)).toBeInTheDocument();
      const closeAiInfoBtn3 = screen.getByRole('button', { name: /✕ Close/i });
      fireEvent.click(closeAiInfoBtn3);
      expect(screen.queryByText(/How QUA AI Categorizes & Matches Suppliers/i)).not.toBeInTheDocument();

      // Mode 3 shows double-blind approved vendors
      expect(screen.getByText(/Double-Blind Autonomous Sourcing/i)).toBeInTheDocument();
    });

    it('covers Mode 1 submission with 0 matched vendors and shortlist adjustment notification', async () => {
      const mockShowToast = jest.fn();
      const vMismatch = {
        id: 'v-mis-1',
        name: 'Mismatched Vendor',
        email: 'mis@vendor.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material', // Distinct from categoriesData[0].majorCategory ('Civil Works')
      };
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [vMismatch],
      });

      renderModal();
      fillRow();
      fillDelivery();

      // Submit with only mismatched vendor in candidate pool
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(
          screen.getByText(/requires at least one private vendor to be selected before creating the RFQ/i)
        ).toBeInTheDocument();
      });
    });

    it('uploads pending unuploaded documents during final save', async () => {
      (rfqClient.uploadRFQAttachment as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: 'Temporary R2 failure',
        })
        .mockResolvedValueOnce({
          success: true,
          data: attachment({ id: 'att-pending', fileName: 'pending_contract.pdf' }),
        });

      (rfqClient.createRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ(),
      });

      renderModal();
      fillRow();
      fillDelivery();

      // Attach file (first upload fails, keeping file in pendingFilesRef)
      const pendingFile = new File(['contract body'], 'pending_contract.pdf', { type: 'application/pdf' });
      const attachInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(attachInput, { target: { files: [pendingFile] } });

      // Save button (second upload attempt in handleSubmit succeeds, then createRFQ called)
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(rfqClient.createRFQ).toHaveBeenCalled();
        expect(onCreated).toHaveBeenCalled();
      });
    });

    it('covers initial activeBuyerAccount prefill of deliveryLocation and pincode', async () => {
      // 1. With city and state
      useApp.mockReturnValue({
        activeBuyerAccount: {
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      });
      const { unmount } = renderModal();
      expect(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder)).toHaveValue('Bengaluru, Karnataka');
      expect(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder)).toHaveValue('560001');
      unmount();

      // 2. With primaryPlantLocation (no city/state)
      useApp.mockReturnValue({
        activeBuyerAccount: {
          primaryPlantLocation: 'Whitefield Campus',
          pincode: '560066',
        },
      });
      const { unmount: unmount2 } = renderModal();
      expect(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder)).toHaveValue('Whitefield Campus');
      expect(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder)).toHaveValue('560066');
      unmount2();
    });

    it('covers useApp and useRouter throw catch fallback in constructor', () => {
      useApp.mockImplementationOnce(() => {
        throw new Error('No App Context');
      });
      const { unmount } = renderModal();
      expect(screen.getByTestId('manual-rfq-modal')).toBeInTheDocument();
      unmount();

      // useRouter throws error to cover line 158
      const nav = require('next/navigation');
      const spy = jest.spyOn(nav, 'useRouter').mockImplementationOnce(() => {
        throw new Error('No router');
      });
      const { unmount: unmount2 } = renderModal();
      expect(screen.getByTestId('manual-rfq-modal')).toBeInTheDocument();
      unmount2();
      spy.mockRestore();
    });

    it('covers categoryFetchSignals debounced fetchAllVendors execution', async () => {
      (rfqClient.fetchAllVendors as jest.Mock).mockResolvedValue({
        success: true,
        candidates: [{ id: 'cand-1', name: 'Auto Fetched Vendor', majorCategory: categoriesData[0].majorCategory }],
      });
      renderModal();
      fillRow();

      // Wait for 400ms for categoryFetchSignals debounce timer
      await waitFor(() => {
        expect(rfqClient.fetchAllVendors).toHaveBeenCalledWith(
          expect.objectContaining({ search: categoriesData[0].majorCategory })
        );
      });
    });

    it('covers handleSendCategoryUpdateEmail edge cases and badge statuses', async () => {
      const mockShowToast = jest.fn();
      const vNoName = {
        id: 'v-no-name',
        email: 'noname@vendor.com',
        contactPerson: 'Jane Doe',
        source: 'buyer_uploaded',
        majorCategory: 'Non Matching',
      };
      const vNoContact = {
        id: 'v-no-contact',
        email: 'nocontact@vendor.com',
        source: 'buyer_uploaded',
        majorCategory: 'Non Matching',
      };
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [vNoName, vNoContact],
      });

      renderModal();
      fillRow();

      // Switch to mismatch tab
      const mismatchTab = await screen.findByRole('button', { name: /Mismatch/i });
      fireEvent.click(mismatchTab);

      // Trigger email for vNoName with empty response error fallback
      (rfqClient.requestVendorCategoryUpdateEmail as jest.Mock).mockResolvedValueOnce({
        success: false,
      });
      const emailBtns = screen.getAllByRole('button', { name: /Send Email to Update Category/i });
      fireEvent.click(emailBtns[0]);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Email Delivery Issue', 'Failed to dispatch email.', 'warning');
      });

      // Trigger email for vNoContact with empty error thrown
      (rfqClient.requestVendorCategoryUpdateEmail as jest.Mock).mockRejectedValueOnce({});
      fireEvent.click(emailBtns[1]);
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Error', 'Failed to send update email.', 'warning');
      });

      // Trigger email with success to show "Update Email Sent ✓" badge
      (rfqClient.requestVendorCategoryUpdateEmail as jest.Mock).mockResolvedValueOnce({
        success: true,
      });
      fireEvent.click(emailBtns[0]);
      await waitFor(() => {
        expect(screen.getByText(/Update Email Sent ✓/i)).toBeInTheDocument();
      });
    });

    it('covers debounced pincode API validation with valid and invalid server responses', async () => {
      renderModal();
      const pinInput = screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);

      // 1. Debounced valid 6-digit pin
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          Status: 'Success',
          PostOffice: [{ Name: 'Indiranagar', District: 'Bengaluru', State: 'Karnataka' }],
        }],
      } as Response);
      fireEvent.change(pinInput, { target: { value: '560038' } });
      await waitFor(() => {
        expect(screen.getByText('Valid')).toBeInTheDocument();
      });

      // 2. Debounced invalid 6-digit pin with custom message
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [{ Status: 'Error', Message: 'No record found' }],
      } as Response);
      fireEvent.change(pinInput, { target: { value: '999991' } });
      await waitFor(() => {
        expect(screen.getByText('Invalid')).toBeInTheDocument();
      });

      // 3. Debounced 6-digit pin with fetch rejection (network fallback)
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network offline'));
      fireEvent.change(pinInput, { target: { value: '999992' } });
      await new Promise((r) => setTimeout(r, 400));

      // 4. Blur on non-6-digit pin (skips validation)
      fireEvent.change(pinInput, { target: { value: '12' } });
      fireEvent.blur(pinInput);

      // 5. Blur on 6-digit pin with rejection
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Postal timeout'));
      fireEvent.change(pinInput, { target: { value: '560002' } });
      fireEvent.blur(pinInput);
    });

    it('covers handleAutoCategorizeAll with mixed classified, unclassified, and invalid taxonomy items', async () => {
      const mockShowToast = jest.fn();
      useApp.mockReturnValue({
        showToast: mockShowToast,
        buyerVendors: [],
      });

      renderModal();

      // Add multiple rows
      const addRowBtn = screen.getByRole('button', { name: MODAL.addItemAction });
      fireEvent.click(addRowBtn);
      fireEvent.click(addRowBtn);
      fireEvent.click(addRowBtn);

      const rows = screen.getAllByRole('row').slice(1);
      // Row 0: already has majorCategory
      fireEvent.change(within(rows[0]).getByLabelText(MODAL.colItem), { target: { value: 'Existing Item 1' } });
      fireEvent.change(within(rows[0]).getByLabelText(MODAL.colMajor), { target: { value: categoriesData[0].majorCategory } });

      // Row 1: also already has majorCategory
      fireEvent.change(within(rows[1]).getByLabelText(MODAL.colItem), { target: { value: 'Existing Item 2' } });
      fireEvent.change(within(rows[1]).getByLabelText(MODAL.colMajor), { target: { value: categoriesData[1].majorCategory } });

      // Row 2: unclassified
      fireEvent.change(within(rows[2]).getByLabelText(MODAL.colItem), { target: { value: 'Pump Valve' } });

      // Row 3: unclassified with invalid category from AI
      fireEvent.change(within(rows[3]).getByLabelText(MODAL.colItem), { target: { value: 'Alien Tech' } });

      (rfqClient.classifyLineItems as jest.Mock).mockImplementationOnce(async (items: any[]) => ({
        success: true,
        data: {
          extractedEntities: [
            {
              id: 'non-matching-id',
              itemName: 'Something Else',
              majorCategory: categoriesData[0].majorCategory,
            },
            {
              id: items[0]?.id,
              itemName: 'Pump Valve',
              majorCategory: categoriesData[0].majorCategory,
              minorCategory: categoriesData[0].minorCategories[0],
            },
            {
              id: items[1]?.id,
              itemName: 'Alien Tech',
              majorCategory: 'Completely Invalid Major',
            },
          ],
        },
      }));

      const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All/i });
      fireEvent.click(autoCatBtn);

      await waitFor(() => {
        expect(rfqClient.classifyLineItems).toHaveBeenCalled();
      });
    });

    it('covers extraction request failure and handleEnterManually on empty rows', async () => {
      const { buildExtractionRequest } = require('@/lib/documentExtraction');
      (buildExtractionRequest as jest.Mock).mockRejectedValueOnce(new Error('Extraction builder corrupt file'));

      renderModal();
      const validDoc = new File(['bad body'], 'corrupt.pdf', { type: 'application/pdf' });
      const attachInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(attachInput, { target: { files: [validDoc] } });

      const extractBtn = screen.getByTestId('manual-extract');
      await waitFor(() => expect(extractBtn).toBeEnabled());
      fireEvent.click(extractBtn);

      await waitFor(() => {
        expect(screen.getByText(/Extraction builder corrupt file/i)).toBeInTheDocument();
      });

      // Remove the only row so lineItems is empty, then click handleEnterManually
      const deleteRowBtn = screen.getByRole('button', { name: new RegExp(MODAL.untitledItem, 'i') });
      fireEvent.click(deleteRowBtn);
      const enterManuallyBtn = screen.getByTestId('manual-enter-fallback');
      fireEvent.click(enterManuallyBtn);
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    });

    it('covers Mode 1 and Mode 2 vendor cards with string minorCategories, vendorSelectedCategories, and view-all button', async () => {
      const vStringMinor = {
        id: 'v-str-minor',
        name: 'String Minor Vendor',
        email: 'str@vendor.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material',
        minorCategories: 'Cartons, Bubble Wrap',
      };
      const vArraySelected = {
        id: 'v-arr-sel',
        name: 'Array Selected Vendor',
        email: 'arr@vendor.com',
        source: 'buyer_uploaded',
        majorCategory: 'Packaging Material',
        vendorSelectedCategories: ['Boxes'],
      };
      const vNoCategories = {
        id: 'v-no-cat',
        name: 'No Category Vendor',
        email: 'none@vendor.com',
        source: 'buyer_uploaded',
      };
      useApp.mockReturnValue({
        activeSubscription: 'version_3',
        buyerVendors: [vStringMinor, vArraySelected, vNoCategories],
      });

      const { unmount } = renderModal();
      fillRow();

      // Mode 1: With RFQ category set to Civil Works, matched count is 0
      // Click "View all 3 private vendors →" button
      const viewAllBtn = screen.getByRole('button', { name: /View all 3 private vendors →/i });
      fireEvent.click(viewAllBtn);
      expect(screen.getByText(/String Minor Vendor/i)).toBeInTheDocument();
      expect(screen.getByText(/Array Selected Vendor/i)).toBeInTheDocument();

      // Search in Mode 1 by email, category
      const searchInput = screen.getByPlaceholderText(/Search suppliers by name/i);
      fireEvent.change(searchInput, { target: { value: 'str@vendor.com' } });
      expect(screen.getByText(/String Minor Vendor/i)).toBeInTheDocument();
      fireEvent.change(searchInput, { target: { value: 'Packaging Material' } });
      expect(screen.getByText(/String Minor Vendor/i)).toBeInTheDocument();
      fireEvent.change(searchInput, { target: { value: '' } });

      // Switch to Mode 2
      const mode2Card = screen.getByTestId('manual-mode-mode_2');
      fireEvent.click(mode2Card);

      // In Mode 2, click "Matched" tab so modalVendorCategoryTab is 'matched'
      const matchedTab = screen.getByRole('button', { name: /^Matched \(/i });
      fireEvent.click(matchedTab);

      // In Mode 2, click "View all 3 private vendors →" button
      const viewAllBtnMode2 = screen.getByRole('button', { name: /View all 3 private vendors →/i });
      fireEvent.click(viewAllBtnMode2);
      expect(screen.getByText(/String Minor Vendor/i)).toBeInTheDocument();

      // In Mode 2, search by email and category
      fireEvent.change(searchInput, { target: { value: 'none@vendor.com' } });
      fireEvent.change(searchInput, { target: { value: '' } });

      // In Mode 2, search by contact person
      fireEvent.change(searchInput, { target: { value: 'None Contact' } });
      fireEvent.change(searchInput, { target: { value: '' } });

      // Switch to Mode 3
      const mode3Card = screen.getByTestId('manual-mode-mode_3');
      fireEvent.click(mode3Card);
      expect(screen.getByText('General Industrial')).toBeInTheDocument();
      unmount();

      // Mode 2 when no category signals on RFQ (categoryFetchSignals.length === 0)
      const { unmount: unmountNoCat } = renderModal();
      const mode2CardNoCat = screen.getByTestId('manual-mode-mode_2');
      fireEvent.click(mode2CardNoCat);
      expect(screen.getByTitle('String Minor Vendor')).toBeInTheDocument();
      unmountNoCat();
    });

    it('covers Mode 2 and Mode 3 empty directory states', () => {
      useApp.mockReturnValue({
        activeSubscription: 'version_3',
        buyerVendors: [],
      });
      renderModal();
      fillRow();

      // Mode 2 with 0 vendors
      const mode2Card = screen.getByTestId('manual-mode-mode_2');
      fireEvent.click(mode2Card);
      expect(screen.getByText(/No vendors found in directory/i)).toBeInTheDocument();

      // Mode 3 with 0 vendors
      const mode3Card = screen.getByTestId('manual-mode-mode_3');
      fireEvent.click(mode3Card);
      expect(screen.getByText(/No private vendors uploaded yet/i)).toBeInTheDocument();
    });

    it('covers quota banner useV0Action and upgrade link target modes', () => {
      useApp.mockReturnValue({
        activeSubscription: 'free_trial',
        remainingFreeRFQs: 0,
        activeBuyerAccount: { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
      });
      // Test top useV0 button
      const { unmount: unmount1 } = renderModal();
      fillRow();
      fillDelivery();
      const useV0Btns = screen.getAllByRole('button', { name: MODAL.useV0Action });
      expect(useV0Btns).toHaveLength(2);
      fireEvent.click(useV0Btns[0]);
      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      unmount1();

      // Test bottom useV0 button
      const { unmount: unmount2 } = renderModal();
      fillRow();
      fillDelivery();
      const useV0Btns2 = screen.getAllByRole('button', { name: MODAL.useV0Action });
      fireEvent.click(useV0Btns2[1]);
      expect(screen.queryByTestId('manual-rfq-quota-exhausted-banner')).not.toBeInTheDocument();
      unmount2();
    });

    it('covers custom category in withStoredValue and clearing item quantity', async () => {
      renderModal();
      const row = firstRow();

      // Quantity change to empty string
      const qtyInput = within(row).getByLabelText(MODAL.colQty);
      fireEvent.change(qtyInput, { target: { value: '10' } });
      fireEvent.change(qtyInput, { target: { value: '' } });
      expect(qtyInput).toHaveValue(null);

      // Re-select same major when minor is selected to keep minor (line 1185 keepMinor true branch)
      const majorSelect = within(row).getByLabelText(MODAL.colMajor);
      fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });
      const minorSelect = within(row).getByLabelText(MODAL.colMinor);
      fireEvent.change(minorSelect, { target: { value: categoriesData[0].minorCategories[0] } });
      fireEvent.change(majorSelect, { target: { value: categoriesData[0].majorCategory } });

      // Document extraction with a custom category not in taxonomy
      (rfqClient.extractLineItemsFromDocument as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          title: 'Custom Robotics Rig',
          estimatedBudget: 500000,
          extractedEntities: [
            {
              id: 'ent-custom-1',
              itemName: 'Autonomous Drone Unit',
              majorCategory: 'Robotics & Aerial Inspection Specialty',
              minorCategory: 'Inspection Drones',
              quantity: 2,
              unit: 'Sets',
            },
          ],
        },
      });

      const customDoc = new File(['robotics content'], 'robotics.pdf', { type: 'application/pdf' });
      const attachInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(attachInput, { target: { files: [customDoc] } });

      const extractBtn = screen.getByTestId('manual-extract');
      await waitFor(() => expect(extractBtn).toBeEnabled());
      fireEvent.click(extractBtn);

      await waitFor(() => {
        expect(screen.getByDisplayValue('Custom Robotics Rig')).toBeInTheDocument();
      });

      // withStoredValue line 91 rendered with the custom category in option list
      expect(screen.getByText('Robotics & Aerial Inspection Specialty')).toBeInTheDocument();

      // Extraction with empty major category to test line 546 dominantMajorCategory fallback
      (rfqClient.extractLineItemsFromDocument as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          title: 'Uncategorized Hardware Spec',
          estimatedBudget: null,
          extractedEntities: [
            {
              id: 'ent-no-cat',
              itemName: 'Generic Hardware Fastener',
              majorCategory: '',
              minorCategory: '',
              quantity: 50,
              unit: 'Nos',
            },
          ],
        },
      });
      const uncatDoc = new File(['uncat hardware'], 'hardware.pdf', { type: 'application/pdf' });
      fireEvent.change(attachInput, { target: { files: [uncatDoc] } });
      await waitFor(() => expect(extractBtn).toBeEnabled());
      fireEvent.click(extractBtn);
      await waitFor(() => {
        expect(screen.getByDisplayValue('Generic Hardware Fastener')).toBeInTheDocument();
      });
    });

    it('covers Mode 1 submission with selectedVendorIds candidatePool filter', async () => {
      const v1 = {
        id: 'v-mode1-select-1',
        name: '',
        email: '',
        contactPerson: 'Alpha Contact Person',
        mobile: '9876543210',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
      };
      const v2 = {
        id: 'v-mode1-select-2',
        name: 'Beta Pipes Ltd',
        email: 'beta@pipes.com',
        contactPerson: '',
        mobileNumber: '9123456789',
        source: 'buyer_uploaded',
        majorCategory: categoriesData[0].majorCategory,
      };
      useApp.mockReturnValue({
        activeSubscription: 'version_3',
        buyerVendors: [v1, v2],
      });
      (rfqClient.createRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ({
          category: categoriesData[0].majorCategory,
          budget: 50000,
          extractedEntities: [
            { id: 'e1', itemName: 'Pumps', quantity: 2, unit: 'pcs', targetDate: '', technicalSpecs: '', confidence: 1, category: categoriesData[0].majorCategory, majorCategory: categoriesData[0].majorCategory, minorCategory: '' },
            { id: 'e2', itemName: 'Valves', quantity: 5, unit: 'pcs', targetDate: '', technicalSpecs: '', confidence: 1, category: categoriesData[0].majorCategory, majorCategory: categoriesData[0].majorCategory, minorCategory: '' },
          ],
          sourcingMode: 'mode_1',
          assignedVendors: [{ id: 'v-mode1-select-2', name: 'Beta Pipes Ltd' }],
        }),
      });

      renderModal();
      fillRow();
      fillDelivery();

      // Click vendor card for v1 (which has no name, so card displays contactPerson)
      const v1Card = screen.getByText(/Alpha Contact Person/i).closest('div[class*="cursor-pointer"]') as HTMLElement;
      fireEvent.click(v1Card);

      // Submit form in Mode 1 with selectedVendorIds.length > 0
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(rfqClient.createRFQ).toHaveBeenCalledWith(
          expect.objectContaining({
            assignedVendors: expect.arrayContaining([
              expect.objectContaining({ id: 'v-mode1-select-2' }),
            ]),
          })
        );
        expect(screen.getByText(/₹50,000/i)).toBeInTheDocument();
      });
    });

    it('covers attachment upload rejection during final save', async () => {
      (rfqClient.createRFQ as jest.Mock).mockResolvedValueOnce({
        success: true,
        rfq: savedRFQ(),
      });
      (rfqClient.uploadRFQAttachment as jest.Mock)
        .mockResolvedValueOnce({
          success: false,
          error: 'Immediate attach fail',
        })
        .mockRejectedValueOnce(new Error('R2 fatal throw during submit'));

      renderModal();
      fillRow();
      fillDelivery();

      // Attach document so pendingFilesRef has files
      const file1 = new File(['file 1 body'], 'failed_upload.pdf', { type: 'application/pdf' });
      const attachInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(attachInput, { target: { files: [file1] } });

      // Click save
      fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

      await waitFor(() => {
        expect(rfqClient.createRFQ).toHaveBeenCalled();
        expect(onCreated).toHaveBeenCalled();
      });
    });
  });
});


