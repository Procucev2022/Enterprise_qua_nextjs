import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { setCategoryTaxonomy } from '@/lib/categoryTaxonomy';
import * as rfqClient from '@/lib/rfqClient';
import { buildExtractionRequest } from '@/lib/documentExtraction';
import { useApp } from '@/lib/store';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE as categoriesData } from '../../../test-fixtures/categoryTaxonomy';
import type { ExtractedEntity, RFQAttachment, RFQExtractionResult, RFQItem, SourcingMode } from '@/lib/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('@/lib/rfqClient', () => ({
  createRFQ: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  extractLineItemsFromDocument: jest.fn(),
  classifyLineItems: jest.fn(),
  fetchAllVendors: jest.fn(),
  requestVendorCategoryUpdateEmail: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/documentExtraction', () => ({
  buildExtractionRequest: jest.fn(),
}));

// The upgrade dialog fetches pricing on open. These tests only need to know it
// opened and which mode it was asked to target, so it is stubbed to a marker.
jest.mock('@/app/buyer/RfqUpgradePlanModal', () => {
  const { createElement } = require('react');
  return {
    __esModule: true,
    default: ({ isOpen, targetMode }: { isOpen: boolean; targetMode: string }) =>
      isOpen
        ? createElement('div', { 'data-testid': 'rfq-upgrade-plan-modal', 'data-target-mode': targetMode })
        : null,
  };
});

// The client functions are typed loosely here: each test supplies only the
// response fields the branch under test reads.
const createRFQ = rfqClient.createRFQ as jest.Mock;
const uploadRFQAttachment = rfqClient.uploadRFQAttachment as jest.Mock;
const extractLineItemsFromDocument = rfqClient.extractLineItemsFromDocument as jest.Mock;
const classifyLineItems = rfqClient.classifyLineItems as jest.Mock;
const fetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const requestVendorCategoryUpdateEmail = rfqClient.requestVendorCategoryUpdateEmail as jest.Mock;
const mockedUseApp = useApp as jest.Mock;
const mockedBuildExtractionRequest = buildExtractionRequest as jest.Mock;

const MODAL = UI_STRINGS.manualRfqModal;
const MANUAL = UI_STRINGS.manualRfq;
const EXTRACTION = UI_STRINGS.rfqExtraction;
const VENDOR_UPDATE = UI_STRINGS.vendorCategoryUpdate;
const SEARCH_PLACEHOLDER = 'Search suppliers by name, category, or email...';

const HOME_CATEGORY = categoriesData[0];
const OTHER_CATEGORY = categoriesData[1];

const onClose = jest.fn();
const onCreated = jest.fn();
const showToast = jest.fn();

/** Buyer-uploaded and matching the RFQ category that fillRow() sets. */
const matchingVendor = {
  id: 'v-match',
  name: 'Matching Co',
  email: 'match@test.com',
  source: 'buyer_uploaded',
  majorCategory: HOME_CATEGORY.majorCategory,
  minorCategories: ['Back filing', 'Bricks', 'Drilling'],
};

/** The rest of the roster lacks a category match, so each one is offered a category update email. */
const mismatchedNamed = {
  id: 'v-mis',
  name: 'Mismatch Co',
  email: 'mis@test.com',
  source: 'buyer_uploaded',
  majorCategory: OTHER_CATEGORY.majorCategory,
};
const noIdWithEmail = {
  email: 'noid@test.com',
  contactPerson: 'Dee',
  source: 'buyer_uploaded',
  majorCategory: OTHER_CATEGORY.majorCategory,
};
const noIdNoEmail = {
  source: 'buyer_uploaded',
  majorCategory: OTHER_CATEGORY.majorCategory,
};
const idWithoutName = {
  id: 'v-noname',
  source: 'buyer_uploaded',
  majorCategory: OTHER_CATEGORY.majorCategory,
};
const ROSTER = [matchingVendor, mismatchedNamed, noIdWithEmail, noIdNoEmail, idWithoutName];

function storeWith(overrides: Record<string, unknown> = {}) {
  return {
    buyerVendors: [matchingVendor],
    activeBuyerAccount: { subscriptionPlan: 'version_3' },
    showToast,
    ...overrides,
  };
}

function savedRFQ(): RFQItem {
  return {
    id: '41',
    rfqNumber: 'RFQ260409000512',
    title: 'Mechanical Spares Procurement',
    category: HOME_CATEGORY.majorCategory,
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
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

function extractedEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Water Pump 500 GPM',
    quantity: 12,
    unit: 'Units',
    targetDate: '2026-10-15',
    technicalSpecs: 'SS316 impeller',
    confidence: 90,
    category: HOME_CATEGORY.minorCategories[0],
    majorCategory: HOME_CATEGORY.majorCategory,
    minorCategory: HOME_CATEGORY.minorCategories[0],
    ...overrides,
  };
}

function extractionResult({
  entities = [extractedEntity()],
  targetDeliveryDate = '2026-10-15',
}: {
  entities?: ExtractedEntity[];
  targetDeliveryDate?: string;
} = {}): RFQExtractionResult {
  return {
    success: true,
    data: {
      title: 'Pump Requirement',
      category: HOME_CATEGORY.majorCategory,
      targetDeliveryDate,
      estimatedBudget: 250000,
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
  } as RFQExtractionResult;
}

const renderModal = () =>
  render(<ManualRFQModal isOpen={true} onClose={onClose} onCreated={onCreated} />);

/** The single row the dialog opens with. */
const firstRow = () => screen.getAllByRole('row')[1];

/** Complete every field a line item needs before dispatch. */
function fillRow() {
  const row = firstRow();
  fireEvent.change(within(row).getByLabelText(MODAL.colItem), {
    target: { value: 'Centrifugal Water Pump' },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMajor), {
    target: { value: HOME_CATEGORY.majorCategory },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colMinor), {
    target: { value: HOME_CATEGORY.minorCategories[0] },
  });
  fireEvent.change(within(row).getByLabelText(MODAL.colSpecs), { target: { value: 'SS316 impeller, 2 HP' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colQty), { target: { value: '12' } });
  fireEvent.change(within(row).getByLabelText(MODAL.colUnit), { target: { value: 'Nos' } });
}

/** Fill the mandatory header fields: the title, the target delivery date and the destination. */
function fillHeaderFields() {
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.titleLabel, 'i')), {
    target: { value: 'Centrifugal pump replacement' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.targetDateLabel, 'i')), {
    target: { value: '2099-12-01' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryLocationLabel, 'i')), {
    target: { value: 'Navi Mumbai Plant, Gate 3' },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(MODAL.deliveryPincodeLabel, 'i')), {
    target: { value: '400701' },
  });
}

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: MODAL.saveAction }));

const chooseMode = (mode: SourcingMode) => fireEvent.click(screen.getByTestId(`manual-mode-${mode}`));

const chooseFiles = (files: File[]) =>
  fireEvent.change(screen.getByTestId('manual-modal-attachment-input'), { target: { files } });

const extractBtn = () => screen.getByTestId('manual-extract');

/** Attach one document and wait until the extract control is clickable. */
async function attachOne(name = 'boq.pdf') {
  chooseFiles([new File(['x'], name, { type: 'application/pdf' })]);
  await waitFor(() => expect(uploadRFQAttachment).toHaveBeenCalled());
  await waitFor(() => expect(extractBtn()).toBeEnabled());
}

beforeEach(() => {
  jest.resetAllMocks();
  setCategoryTaxonomy(categoriesData);
  mockedUseApp.mockReturnValue(storeWith());
  createRFQ.mockResolvedValue({ success: true, rfq: savedRFQ() });
  // A distinct id per upload, so two documents in one selection do not collide.
  let uploadCount = 0;
  uploadRFQAttachment.mockImplementation((file: File) => {
    uploadCount += 1;
    return Promise.resolve({
      success: true,
      data: attachment({ id: `a${uploadCount}`, fileName: file.name }),
    });
  });
  classifyLineItems.mockResolvedValue({ success: true, data: { extractedEntities: [] } });
  extractLineItemsFromDocument.mockResolvedValue(extractionResult());
  fetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  });
  requestVendorCategoryUpdateEmail.mockResolvedValue({ success: true, deliveryStatus: 'sent' });
  mockedBuildExtractionRequest.mockImplementation(async (file: File) => ({
    fileName: file.name,
    inlineData: 'ZmFrZQ==',
    mimeType: file.type || 'application/pdf',
  }));
});

describe.each(['mode_1', 'mode_2'] as const)('ManualRFQModal %s roster branches', (mode: SourcingMode) => {
  it('filters by name, email and contact, and requests category updates from each vendor shape', async () => {
    mockedUseApp.mockReturnValue(storeWith({ buyerVendors: ROSTER }));
    renderModal();
    fillRow();
    chooseMode(mode);

    // The default tab lists only the vendors whose category matches the RFQ.
    expect(await screen.findByText(/Matching Co/)).toBeInTheDocument();
    expect(screen.queryByText(/Mismatch Co/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All (5)' }));
    expect(screen.getByText(/Mismatch Co/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Send Email to Update Category/ })).toHaveLength(4);

    const search = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No Vendors Found')).toBeInTheDocument();
    expect(screen.getByText('No vendors match your search term.')).toBeInTheDocument();

    // Only the contact person matches, so the vendor has no name or email to search on.
    fireEvent.change(search, { target: { value: 'dee' } });
    const contactMatch = screen.getAllByRole('button', { name: /Send Email to Update Category/ });
    expect(contactMatch).toHaveLength(1);
    fireEvent.click(contactMatch[0]);
    await waitFor(() =>
      expect(requestVendorCategoryUpdateEmail).toHaveBeenCalledWith(
        expect.objectContaining({ vendorEmail: 'noid@test.com' })
      )
    );
    expect(await screen.findByRole('button', { name: VENDOR_UPDATE.completedButton })).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      VENDOR_UPDATE.sentTitle,
      formatString(VENDOR_UPDATE.sentMessage, { vendorName: 'Dee', vendorEmail: 'noid@test.com' }),
      'success'
    );

    fireEvent.change(search, { target: { value: '' } });
    // The contact-matched vendor now shows its completed label, so three request buttons remain:
    // mismatchedNamed, noIdNoEmail, idWithoutName, in roster order.
    const pendingRequests = screen.getAllByRole('button', { name: /Send Email to Update Category/ });
    expect(pendingRequests).toHaveLength(3);

    // A vendor with neither id nor email has nothing to key or address the request by.
    fireEvent.click(pendingRequests[1]);
    expect(requestVendorCategoryUpdateEmail).toHaveBeenCalledTimes(1);

    // An id but no name, contact or email: the name shows the not-recorded placeholder, not an invented name.
    fireEvent.click(pendingRequests[2]);
    await waitFor(() => expect(requestVendorCategoryUpdateEmail).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(showToast).toHaveBeenLastCalledWith(
        VENDOR_UPDATE.sentTitle,
        formatString(VENDOR_UPDATE.sentMessage, { vendorName: UI_STRINGS.recordPlaceholders.notRecorded, vendorEmail: '' }),
        'success'
      )
    );
    // Both accepted requests now show their completed label, so every pending state has settled.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: VENDOR_UPDATE.completedButton })).toHaveLength(2)
    );
  });

  it('explains an empty roster search when no RFQ category is chosen', () => {
    mockedUseApp.mockReturnValue(storeWith({ buyerVendors: ROSTER }));
    renderModal();
    chooseMode(mode);

    // With no category, the default tab shows every private vendor.
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'zzz' } });
    expect(screen.getByText('No Category-Matched Vendors')).toBeInTheDocument();
    expect(screen.getByText(/match the selected RFQ category \(selected\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View all 5 private vendors/ }));
    expect(screen.getByText('No Vendors Found')).toBeInTheDocument();
    expect(screen.getByText('No vendors match your search term.')).toBeInTheDocument();
  });
});

describe('ManualRFQModal: Mode 3 roster', () => {
  it('lists a vendor that has no id under its contact person', () => {
    mockedUseApp.mockReturnValue(storeWith({ buyerVendors: [noIdWithEmail] }));
    renderModal();
    chooseMode('mode_3');
    expect(screen.getByText('Dee')).toBeInTheDocument();
  });
});

describe('ManualRFQModal: auto-categorize', () => {
  const typeItemName = () =>
    fireEvent.change(within(firstRow()).getByLabelText(MODAL.colItem), {
      target: { value: 'Centrifugal Water Pump' },
    });
  const autoCategorize = () => fireEvent.click(screen.getByRole('button', { name: /Auto-Categorize All/ }));

  it('shows the generic classification message when the server gives no reason', async () => {
    classifyLineItems.mockResolvedValueOnce({ success: false });
    renderModal();
    typeItemName();
    autoCategorize();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(EXTRACTION.fallbackTitle, EXTRACTION.classifyFailed, 'warning')
    );
  });

  it('applies the category the server detects to a row that has none', async () => {
    // Echo each submitted row back with the category the server detected for it.
    classifyLineItems.mockImplementationOnce((items: Array<{ id: string; itemName: string }>) =>
      Promise.resolve({
        success: true,
        data: {
          extractedEntities: items.map((item) =>
            extractedEntity({
              id: item.id,
              itemName: item.itemName,
              majorCategory: HOME_CATEGORY.majorCategory,
              minorCategory: HOME_CATEGORY.minorCategories[0],
            })
          ),
        },
      })
    );
    renderModal();
    typeItemName();
    autoCategorize();
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colMajor)).toHaveValue(HOME_CATEGORY.majorCategory)
    );
  });
});

describe('ManualRFQModal: exhausted credits on a plan outside the paid list', () => {
  // A plan name the entitlement table does not list falls back to the Version 1
  // modes, so a buyer with no credits left can still pick Mode 1 and reach the
  // upgrade offer.
  const exhaustedStore = () =>
    storeWith({
      activeSubscription: 'starter',
      remainingFreeRFQs: 0,
      activeBuyerAccount: { subscriptionPlan: 'starter', remainingFreeRFQs: 0 },
    });

  it('opens the upgrade plan from the banner for the mode the buyer picked', () => {
    mockedUseApp.mockReturnValue(exhaustedStore());
    renderModal();
    chooseMode('mode_1');
    fireEvent.click(screen.getByRole('link', { name: MODAL.upgradePlanAction }));
    expect(screen.getByTestId('rfq-upgrade-plan-modal')).toHaveAttribute('data-target-mode', 'mode_1');
  });

  it('opens the upgrade plan from the footer link for the mode the buyer picked', () => {
    mockedUseApp.mockReturnValue(exhaustedStore());
    renderModal();
    chooseMode('mode_1');
    fireEvent.click(screen.getByRole('link', { name: 'Please Upgrade Your Plan' }));
    expect(screen.getByTestId('rfq-upgrade-plan-modal')).toHaveAttribute('data-target-mode', 'mode_1');
  });
});

describe('ManualRFQModal: attachment failures', () => {
  it('names the file when the upload is refused without a reason', async () => {
    uploadRFQAttachment.mockResolvedValueOnce({ success: false });
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('annexure.pdf'));
  });

  it('reports an upload that rejects with no error value', async () => {
    uploadRFQAttachment.mockRejectedValueOnce(undefined);
    renderModal();
    chooseFiles([new File(['x'], 'annexure.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('annexure.pdf'));
  });
});

describe('ManualRFQModal: extraction messages', () => {
  it('uses the generic message when reading a document fails without one', async () => {
    mockedBuildExtractionRequest.mockRejectedValueOnce({});
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Document upload failed.'));
  });

  it('fills the rows when no extracted line item carries a category', async () => {
    extractLineItemsFromDocument.mockResolvedValueOnce(
      extractionResult({
        entities: [extractedEntity({ majorCategory: undefined, minorCategory: undefined, category: undefined })],
      })
    );
    renderModal();
    await attachOne();
    fireEvent.click(extractBtn());
    await waitFor(() =>
      expect(within(firstRow()).getByLabelText(MODAL.colItem)).toHaveValue('Centrifugal Water Pump 500 GPM')
    );
  });

  it('reads the second document without replacing the delivery date from the first', async () => {
    extractLineItemsFromDocument
      .mockResolvedValueOnce(
        extractionResult({ entities: [extractedEntity({ id: 'ent-a' })], targetDeliveryDate: '2099-01-01' })
      )
      .mockResolvedValueOnce(
        extractionResult({ entities: [extractedEntity({ id: 'ent-b' })], targetDeliveryDate: '2099-01-01' })
      );
    renderModal();
    chooseFiles([
      new File(['x'], 'boq-a.pdf', { type: 'application/pdf' }),
      new File(['y'], 'boq-b.pdf', { type: 'application/pdf' }),
    ]);
    await waitFor(() => expect(screen.getByText('boq-b.pdf')).toBeInTheDocument());
    await waitFor(() => expect(extractBtn()).toBeEnabled());
    fireEvent.click(extractBtn());
    await waitFor(() => expect(extractLineItemsFromDocument).toHaveBeenCalledTimes(2));
  });
});

describe('ManualRFQModal: saving branches', () => {
  it('passes the server credit balance to the store with the created RFQ', async () => {
    const adoptCreatedRFQ = jest.fn();
    mockedUseApp.mockReturnValue(storeWith({ adoptCreatedRFQ }));
    createRFQ.mockResolvedValueOnce({ success: true, rfq: savedRFQ(), remainingFreeRFQs: 2 });
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();
    await waitFor(() => expect(adoptCreatedRFQ).toHaveBeenCalledWith(savedRFQ(), 2));
  });

  it('hands the store only the created RFQ when the server reports no credit balance', async () => {
    const adoptCreatedRFQ = jest.fn();
    mockedUseApp.mockReturnValue(storeWith({ adoptCreatedRFQ }));
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_1');
    clickSave();
    await waitFor(() => expect(adoptCreatedRFQ).toHaveBeenCalledWith(savedRFQ()));
  });

  it('still creates the RFQ when a pending document cannot be uploaded at save time', async () => {
    uploadRFQAttachment
      .mockResolvedValueOnce({ success: false, error: 'Storage is unavailable.' })
      .mockResolvedValueOnce({ success: false });
    renderModal();
    chooseFiles([new File(['x'], 'spec.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('spec.pdf'));

    fillRow();
    fillHeaderFields();
    chooseMode('mode_0');
    clickSave();
    await waitFor(() => expect(createRFQ).toHaveBeenCalledTimes(1));
    expect(uploadRFQAttachment).toHaveBeenCalledTimes(2);
  });

  it('dispatches Mode 2 to matching vendors from the whole directory, not only private ones', async () => {
    const networkSupplier = {
      id: 'v-network-1',
      name: 'Network Supplier',
      source: 'self_onboarded',
      majorCategory: HOME_CATEGORY.majorCategory,
      minorCategories: [HOME_CATEGORY.minorCategories[0]],
    };
    mockedUseApp.mockReturnValue(storeWith({ buyerVendors: [networkSupplier] }));
    renderModal();
    fillRow();
    fillHeaderFields();
    chooseMode('mode_2');
    clickSave();
    await waitFor(() => expect(createRFQ).toHaveBeenCalledTimes(1));
    expect(createRFQ.mock.calls[0][0].assignedVendors).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'v-network-1' })])
    );
  });

  it('does not create an RFQ when the form fails validation at save time', () => {
    renderModal();
    fillRow();
    chooseMode('mode_0');
    clickSave();
    expect(createRFQ).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
  });
});

describe('ManualRFQModal: category directory lookup', () => {
  it('keeps the form usable when the category directory lookup is refused', async () => {
    fetchAllVendors.mockResolvedValueOnce({ success: false, error: 'Directory unavailable.' });
    renderModal();
    fillRow();
    await waitFor(() => expect(fetchAllVendors).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: MODAL.saveAction })).toBeInTheDocument();
  });
});
