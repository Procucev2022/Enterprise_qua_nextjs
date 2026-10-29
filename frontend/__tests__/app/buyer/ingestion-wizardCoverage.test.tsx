import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import IngestionWizard, { resolveConfirmationVendorCount } from '@/app/buyer/ingestion-wizard';
import { useApp } from '@/lib/store';
import { getMajorCategories } from '@/lib/categoryTaxonomy';
import { validatePincode, type PostOfficeDetail } from '@/lib/validationSchemas';
import {
  extractLineItemsFromDocument,
  classifyLineItems,
  createRFQ,
  fetchAllVendors,
  requestVendorCategoryUpdateEmail,
} from '@/lib/rfqClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';
import type {
  ExtractedEntity,
  RFQIngestionResponse,
  RFQItem,
  RFQVendorCandidate,
  RFQVendorPageResult,
  VendorEntry,
} from '@/lib/types';

// ------------------------------------------------------------------------------
// Module mocks
//
// The wizard reads everything it needs from `useApp()`, so the store is mocked
// outright. That lets each test hand the wizard exactly the roster it needs (a
// vendor with no id, no name, no email, ...) and assert on the toasts and store
// actions it fires, instead of reproducing them through a bootstrap payload.
// ------------------------------------------------------------------------------

const mockRouterPush = jest.fn();
const mockUseRouter = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

// Defaults to the real implementation; one test narrows the master to "no majors".
jest.mock('@/lib/categoryTaxonomy', () => {
  const actual = jest.requireActual('@/lib/categoryTaxonomy');
  return {
    __esModule: true,
    ...actual,
    getMajorCategories: jest.fn(actual.getMajorCategories),
  };
});

jest.mock('@/lib/validationSchemas', () => ({
  __esModule: true,
  ...jest.requireActual('@/lib/validationSchemas'),
  validatePincode: jest.fn(),
}));

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  extractLineItemsFromDocument: jest.fn(),
  stageDocumentForExtraction: jest.fn().mockResolvedValue({ success: true, key: 'staged-test-key' }),
  classifyLineItems: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  createRFQ: jest.fn(),
  fetchAllVendors: jest.fn(),
  requestVendorCategoryUpdateEmail: jest.fn(),
}));

const { getMajorCategories: actualGetMajorCategories } =
  jest.requireActual<typeof import('@/lib/categoryTaxonomy')>('@/lib/categoryTaxonomy');

const mockUseApp = useApp as jest.Mock;
const mockGetMajorCategories = getMajorCategories as jest.MockedFunction<typeof getMajorCategories>;
const mockValidatePincode = validatePincode as jest.MockedFunction<typeof validatePincode>;
const mockExtract = extractLineItemsFromDocument as jest.MockedFunction<typeof extractLineItemsFromDocument>;
const mockClassify = classifyLineItems as jest.MockedFunction<typeof classifyLineItems>;
const mockCreateRFQ = createRFQ as jest.MockedFunction<typeof createRFQ>;
const mockFetchAllVendors = fetchAllVendors as jest.MockedFunction<typeof fetchAllVendors>;
const mockEmail = requestVendorCategoryUpdateEmail as jest.MockedFunction<typeof requestVendorCategoryUpdateEmail>;

const EXTRACTION = UI_STRINGS.rfqExtraction;
const MODAL = UI_STRINGS.manualRfqModal;
const MANUAL = UI_STRINGS.manualRfq;

const ALL_CATEGORIES = 'All Categories';
const MECHANICAL = 'Engineering Spares - Mechanical';
// An alphanumeric (international) postcode is accepted by the wizard but is not
// looked up against the Indian postal service, so it keeps these tests free of
// the 350 ms lookup debounce.
const INTL_PINCODE = 'SW1A 1AA';
const EN_DASH = '\u2013';

// ------------------------------------------------------------------------------
// Fixtures and helpers
// ------------------------------------------------------------------------------

interface MockStore {
  addNewRFQ: jest.Mock;
  adoptCreatedRFQ: jest.Mock;
  setCurrentMode: jest.Mock;
  showToast: jest.Mock;
  addBuyerVendor: jest.Mock;
  createBuyerPaymentLink: jest.Mock;
  currentMode: string | undefined;
  activeSubscription: string | null | undefined;
  buyerVendors: unknown[];
  categoryTaxonomy: unknown[];
  remainingFreeRFQs: number | undefined;
  activeBuyerAccount: unknown;
}

function setupStore(overrides: Partial<MockStore> = {}): MockStore {
  const store: MockStore = {
    addNewRFQ: jest.fn(),
    adoptCreatedRFQ: jest.fn(),
    setCurrentMode: jest.fn(),
    showToast: jest.fn(),
    addBuyerVendor: jest.fn().mockResolvedValue(undefined),
    createBuyerPaymentLink: jest.fn(),
    currentMode: 'mode_2',
    activeSubscription: 'version_3',
    buyerVendors: [],
    categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
    remainingFreeRFQs: 5,
    activeBuyerAccount: null,
    ...overrides,
  };
  mockUseApp.mockReturnValue(store);
  return store;
}

function vendor(overrides: Record<string, unknown>): VendorEntry {
  return overrides as unknown as VendorEntry;
}

function candidate(overrides: Record<string, unknown>): RFQVendorCandidate {
  return { alreadyInvited: false, ...overrides } as unknown as RFQVendorCandidate;
}

function pageResult(candidates: RFQVendorCandidate[]): RFQVendorPageResult {
  return {
    success: true,
    candidates,
    pagination: { page: 1, pageSize: 100, total: candidates.length, totalPages: 1 },
  };
}

const FAILED_PAGE: RFQVendorPageResult = { success: false, reason: 'SERVER', error: 'Directory unavailable' };

function createdRfq(overrides: Record<string, unknown> = {}): RFQItem {
  return {
    id: 'rfq-new-1',
    rfqNumber: 'RFQ-2026-00450',
    title: 'Pump Requirement',
    category: MECHANICAL,
    status: 'Quotes Pending',
    sourcingMode: 'mode_2',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-15',
    budget: 0,
    deliveryLocation: 'Navi Mumbai Plant',
    deliveryPincode: INTL_PINCODE,
    attachments: [],
    createdAt: '2026-09-10T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    assignedVendors: [],
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  } as unknown as RFQItem;
}

function classifiedAs(items: ExtractedEntity[], majorCategory: string, minorCategory: string): RFQIngestionResponse {
  return {
    success: true,
    data: {
      title: '',
      category: '',
      targetDeliveryDate: '',
      estimatedBudget: null,
      source: 'manual_entry',
      extractedEntities: items.map((item) => ({ ...item, majorCategory, minorCategory })),
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Lets promise continuations queued by mocked async dependencies settle.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

type WizardProps = React.ComponentProps<typeof IngestionWizard>;

function renderWizard(overrides: Partial<WizardProps> = {}) {
  const props: WizardProps = {
    onComplete: jest.fn(),
    onCancel: jest.fn(),
    forceSubscription: 'version_3',
    ...overrides,
  };
  const view = render(<IngestionWizard {...props} />);
  return { props, ...view };
}

const dispatchButton = () => screen.getByRole('button', { name: /Create & Dispatch RFQ/i });

function fillDelivery(location = 'Navi Mumbai Plant', pincode = INTL_PINCODE) {
  fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: location } });
  fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder), { target: { value: pincode } });
}

interface LineItemFields {
  name?: string;
  quantity?: string;
  unit?: string;
  major?: string;
  minor?: string;
}

function fillLineItem(index: number, fields: LineItemFields) {
  const row = screen.getAllByPlaceholderText(MODAL.itemPlaceholder)[index].closest('tr') as HTMLElement;
  const set = (element: HTMLElement, value: string | undefined) => {
    if (value !== undefined) fireEvent.change(element, { target: { value } });
  };
  set(within(row).getByPlaceholderText(MODAL.itemPlaceholder), fields.name);
  set(within(row).getByLabelText(MODAL.colMajor), fields.major);
  set(within(row).getByLabelText(MODAL.colMinor), fields.minor);
  set(within(row).getByPlaceholderText(MODAL.qtyPlaceholder), fields.quantity);
  set(within(row).getByPlaceholderText(MODAL.unitPlaceholder), fields.unit);
}

// The delivery fields go in last on purpose: in Mode 3 a new delivery location or
// pincode is what re-ranks the Procucev vendors, and by then the line item's
// categories (including its minor, which does not re-rank on its own) are all in.
function fillValidForm(category: { major?: string; minor?: string } = {}) {
  fillLineItem(0, { name: 'Centrifugal Pump', quantity: '10', unit: 'Nos', ...category });
  fillDelivery();
}

async function dispatchRfq() {
  fireEvent.click(dispatchButton());
  await waitFor(() => expect(mockCreateRFQ).toHaveBeenCalledTimes(1));
}

function dropFiles(files: File[]) {
  const dropZone = screen.getByText(/Drag and drop BOQ spreadsheets/i).closest('div') as HTMLElement;
  fireEvent.drop(dropZone, { dataTransfer: { files } });
}

const textFile = (name: string) => new File(['Need 10 centrifugal pumps'], name, { type: 'text/plain' });

const firstMajorSelect = () => screen.getByLabelText(MODAL.colMajor);

let directoryPool: RFQVendorCandidate[] = [];
let directoryFails = false;

beforeEach(() => {
  jest.clearAllMocks();
  directoryPool = [];
  directoryFails = false;

  mockUseRouter.mockReset();
  mockUseRouter.mockReturnValue({ push: mockRouterPush, replace: jest.fn(), back: jest.fn() });

  mockExtract.mockReset();
  mockClassify.mockReset();
  mockCreateRFQ.mockReset();
  mockCreateRFQ.mockResolvedValue({ success: true, rfq: createdRfq() });
  mockFetchAllVendors.mockReset();
  mockFetchAllVendors.mockImplementation(async () => (directoryFails ? FAILED_PAGE : pageResult(directoryPool)));
  mockEmail.mockReset();
  mockEmail.mockResolvedValue({ success: true });
  mockValidatePincode.mockReset();
  mockValidatePincode.mockResolvedValue({ isValid: true });
  mockGetMajorCategories.mockReset();
  mockGetMajorCategories.mockImplementation(actualGetMajorCategories);

  setupStore();
});

// ------------------------------------------------------------------------------
// Category detection and plan fallbacks
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: category detection and plan fallbacks', () => {
  it('trusts the network count when a line item carries only its own category field', () => {
    const withLineItemCategory = {
      sourcingMode: 'mode_2',
      procucevVendorCount: 12,
      extractedEntities: [{ category: 'Pumps & Accessories' }],
    };

    expect(resolveConfirmationVendorCount(withLineItemCategory)).toBe(12);
    // A blank category is no signal at all, so the whole-directory tally is ignored.
    expect(
      resolveConfirmationVendorCount({ ...withLineItemCategory, extractedEntities: [{ category: '   ' }] })
    ).toBe(0);
  });

  it('falls back to the free-trial plan when neither a forced, account nor store plan exists', () => {
    setupStore({ activeBuyerAccount: null, activeSubscription: null, remainingFreeRFQs: 0 });
    const { props, rerender } = renderWizard({ forceSubscription: undefined });

    expect(screen.getByTestId('ingestion-wizard-quota-exhausted-banner')).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.quotaExhaustedTitle)).toBeInTheDocument();

    // A paid plan from the store lifts the same zero-credit balance, so the banner above
    // really came from the free-trial fallback.
    setupStore({ activeBuyerAccount: null, activeSubscription: 'version_1', remainingFreeRFQs: 0 });
    rerender(<IngestionWizard {...props} />);
    expect(screen.queryByTestId('ingestion-wizard-quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('Clear Form returns to Mode 2 when the store has no current mode', async () => {
    const store = setupStore({ currentMode: undefined });
    renderWizard();

    fireEvent.click(screen.getByTestId('sourcing-mode-btn-mode_3'));
    expect(screen.getByTestId('sourcing-mode-btn-mode_3')).toHaveAttribute('aria-checked', 'true');
    // Mode 3 starts ranking the Procucev network as soon as it is chosen.
    await flushAsync();

    fireEvent.click(screen.getAllByRole('button', { name: /Clear Form/i })[0]);

    expect(screen.getByTestId('sourcing-mode-btn-mode_2')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sourcing-mode-btn-mode_3')).toHaveAttribute('aria-checked', 'false');
    expect(store.showToast).toHaveBeenCalledWith(
      'Form Cleared',
      'All fields, line items, and uploaded files have been reset.',
      'info'
    );
  });

  it('keeps a minor category that also belongs to the newly chosen major category', async () => {
    renderWizard();

    fillLineItem(0, { major: MECHANICAL });
    fillLineItem(0, { minor: 'Refractories' });
    expect(screen.getByLabelText(MODAL.colMinor)).toHaveValue('Refractories');

    // 'Refractories' is listed under Raw Material too, so it survives the switch...
    fillLineItem(0, { major: 'Raw Material' });
    expect(screen.getByLabelText(MODAL.colMinor)).toHaveValue('Refractories');

    // ...whereas a major that does not list it clears the minor.
    fillLineItem(0, { major: 'Civil Works' });
    expect(screen.getByLabelText(MODAL.colMinor)).toHaveValue('');
    await flushAsync();
  });
});

// ------------------------------------------------------------------------------
// Mode 1 / Mode 2 rosters holding sparse vendor records
// ------------------------------------------------------------------------------

describe.each(['mode_1', 'mode_2'] as const)('IngestionWizard coverage: sparse roster vendors in %s', (mode) => {
  // None of these match the category chosen below, so each lands on the
  // "Category Mismatch" tab where the update-email action lives.
  const idLessVendor = vendor({
    email: 'noid@vendor.test',
    contactPerson: 'Priya Contact',
    majorCategory: 'Civil Works',
    source: 'buyer_uploaded',
  });
  const nameLessVendor = vendor({ id: 'v-anon', email: 'anon@vendor.test', source: 'buyer_uploaded' });
  const ghostVendor = vendor({ source: 'buyer_uploaded' });

  async function openMismatchTab() {
    const store = setupStore({
      currentMode: mode,
      buyerVendors: [idLessVendor, nameLessVendor, ghostVendor],
    });
    renderWizard();
    fillLineItem(0, { major: MECHANICAL });
    fireEvent.click(await screen.findByRole('button', { name: /Category Mismatch \(3\)/ }));
    const sendButtons = screen.getAllByRole('button', { name: /Send Email to Update Category/i });
    expect(sendButtons).toHaveLength(3);
    return { store, sendButtons };
  }

  it('lists a registered category of None for records that carry no category', async () => {
    await openMismatchTab();

    expect(screen.getAllByText('Registered Category:')).toHaveLength(3);
    expect(screen.getAllByText('None')).toHaveLength(2);
    await flushAsync();
  });

  it('keys an id-less vendor by its email while the update request is sending and once it is sent', async () => {
    const { store, sendButtons } = await openMismatchTab();
    const pending = createDeferred<{ success: boolean }>();
    mockEmail.mockReturnValueOnce(pending.promise);

    fireEvent.click(sendButtons[0]);

    expect(mockEmail).toHaveBeenCalledWith({
      vendorId: undefined,
      vendorEmail: 'noid@vendor.test',
      vendorName: 'Priya Contact',
      rfqCategory: 'engineering spares mechanical',
      rfqTitle: 'Procurement Requisition',
    });
    expect(sendButtons[0]).toBeDisabled();
    expect(sendButtons[0]).toHaveTextContent(/Sending Email/);
    // Only the vendor being emailed is locked.
    expect(sendButtons[1]).toBeEnabled();

    await act(async () => {
      pending.resolve({ success: true });
    });

    expect(sendButtons[0]).toBeEnabled();
    expect(sendButtons[0]).toHaveTextContent(/Update Email Sent/);
    expect(store.showToast).toHaveBeenCalledWith(
      'Category Update Email Sent',
      'An email has been sent to Priya Contact (noid@vendor.test) requesting them to update their category to match this RFQ.',
      'success'
    );
  });

  it('addresses a vendor with neither a name nor a contact person generically', async () => {
    const { store, sendButtons } = await openMismatchTab();

    fireEvent.click(sendButtons[1]);

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith(
        'Category Update Email Sent',
        'An email has been sent to Vendor (anon@vendor.test) requesting them to update their category to match this RFQ.',
        'success'
      )
    );
    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 'v-anon', vendorEmail: 'anon@vendor.test', vendorName: undefined })
    );
  });

  it('warns with default copy when the update email is refused or the request throws without a message', async () => {
    const { store, sendButtons } = await openMismatchTab();

    mockEmail.mockResolvedValueOnce({ success: false });
    fireEvent.click(sendButtons[1]);
    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith('Email Delivery Issue', 'Failed to dispatch email.', 'warning')
    );

    mockEmail.mockRejectedValueOnce(new Error(''));
    fireEvent.click(sendButtons[1]);
    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith('Error', 'Failed to send update email.', 'warning')
    );

    // Neither failure marks the vendor as emailed, so the action stays available.
    expect(sendButtons[1]).toHaveTextContent(/Send Email to Update Category/);
    expect(sendButtons[1]).toBeEnabled();
  });

  it('ignores the update action for a record that has neither an id nor an email', async () => {
    const { store, sendButtons } = await openMismatchTab();

    fireEvent.click(sendButtons[2]);
    await flushAsync();

    expect(mockEmail).not.toHaveBeenCalled();
    expect(store.showToast).not.toHaveBeenCalled();
    expect(sendButtons[2]).toBeEnabled();
  });
});

describe('IngestionWizard coverage: Mode 1 roster search', () => {
  it('words an empty roster search differently on the Matched tab and on the All tab', async () => {
    setupStore({
      currentMode: 'mode_1',
      buyerVendors: [vendor({ id: 'v-a1', name: 'Alpha Bearings', source: 'buyer_uploaded', majorCategory: MECHANICAL })],
    });
    renderWizard();

    fireEvent.change(screen.getByPlaceholderText('Filter vendors...'), { target: { value: 'zzz-no-such-vendor' } });

    // Nothing to match against yet, so the copy cannot name an RFQ category.
    expect(screen.getByText('No Category-Matched Vendors in Roster')).toBeInTheDocument();
    expect(screen.getByText(/match the RFQ category \(selected\)/)).toBeInTheDocument();

    // Choosing a category reveals the filter tabs; the All tab drops the category wording.
    fillLineItem(0, { major: 'Civil Works' });
    fireEvent.click(screen.getByRole('button', { name: /^All \(1\)$/ }));

    expect(screen.getByText('No Vendors Found')).toBeInTheDocument();
    expect(screen.getByText('No vendors match your search or filter criteria.')).toBeInTheDocument();
    expect(screen.queryByText('No Category-Matched Vendors in Roster')).not.toBeInTheDocument();
    await flushAsync();
  });
});

// ------------------------------------------------------------------------------
// Add-vendor dialog (Mode 1 roster)
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: add-vendor dialog', () => {
  // A six-digit vendor pincode starts the 350 ms lookup debounce, so these tests
  // run on fake timers and the pending timer is discarded with them.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function openAddVendorDialog(): HTMLElement {
    fireEvent.click(screen.getByRole('button', { name: /Add Vendor/i }));
    return screen.getByRole('heading', { name: 'Add Approved Vendor' }).closest('.modal-content') as HTMLElement;
  }

  function fillVendorForm(dialog: HTMLElement) {
    const field = (placeholder: string, value: string) =>
      fireEvent.change(within(dialog).getByPlaceholderText(placeholder), { target: { value } });
    field('e.g. Ashok Industries', 'Ashok Industries');
    field('e.g. John Doe', 'John Doe');
    field('e.g. 9000000001', '9876543210');
    field('e.g. contact@example.com', 'john@ashok.in');
    field('e.g. Pune', 'Pune');
    field('e.g. Maharashtra', 'Maharashtra');
    field('e.g. 411001', '411001');
    field('e.g. 27AAAAA0000A1Z5', '27abcde1234f1z5');
  }

  const submitButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Add Vendor' });

  it('keeps the dialog open and reports the failure message when saving the vendor is rejected', async () => {
    const store = setupStore({ currentMode: 'mode_1' });
    store.addBuyerVendor.mockRejectedValueOnce(new Error('GSTIN already registered'));
    renderWizard();
    const dialog = openAddVendorDialog();
    fillVendorForm(dialog);

    fireEvent.click(submitButton(dialog));

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith('Failed to Add Vendor', 'GSTIN already registered', 'warning')
    );
    expect(screen.getByRole('heading', { name: 'Add Approved Vendor' })).toBeInTheDocument();
    await waitFor(() => expect(submitButton(dialog)).toBeEnabled());
  });

  it('falls back to a generic message when the rejected save carries no message', async () => {
    const store = setupStore({ currentMode: 'mode_1' });
    store.addBuyerVendor.mockRejectedValueOnce(new Error(''));
    renderWizard();
    const dialog = openAddVendorDialog();
    fillVendorForm(dialog);

    fireEvent.click(submitButton(dialog));

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith('Failed to Add Vendor', 'Could not save vendor.', 'warning')
    );
    expect(screen.getByRole('heading', { name: 'Add Approved Vendor' })).toBeInTheDocument();
  });

  it('saves the vendor with no minor category after the minor selection is cleared again', async () => {
    const store = setupStore({ currentMode: 'mode_1' });
    renderWizard();
    const dialog = openAddVendorDialog();
    fillVendorForm(dialog);

    const minorSelect = within(dialog).getAllByRole('combobox')[1] as HTMLSelectElement;
    fireEvent.change(minorSelect, { target: { value: 'Bricks' } });
    expect(minorSelect).toHaveValue('Bricks');
    fireEvent.change(minorSelect, { target: { value: '' } });
    expect(minorSelect).toHaveValue('');

    fireEvent.click(submitButton(dialog));

    await waitFor(() => expect(store.addBuyerVendor).toHaveBeenCalledTimes(1));
    expect(store.addBuyerVendor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ashok Industries',
        email: 'john@ashok.in',
        majorCategory: 'Civil Works',
        minorCategories: [],
        gst: '27ABCDE1234F1Z5',
        location: 'Pune, Maharashtra',
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Add Approved Vendor' })).not.toBeInTheDocument()
    );
    expect(store.showToast).toHaveBeenCalledWith(
      'Vendor Added',
      'Ashok Industries was successfully added to your approved vendor roster.',
      'success'
    );
  });

  it('closes the dialog from the header close button without saving anything', () => {
    const store = setupStore({ currentMode: 'mode_1' });
    renderWizard();
    const dialog = openAddVendorDialog();

    // The header close icon is the dialog's first control and has no accessible name.
    fireEvent.click(within(dialog).getAllByRole('button')[0]);

    expect(screen.queryByRole('heading', { name: 'Add Approved Vendor' })).not.toBeInTheDocument();
    expect(store.addBuyerVendor).not.toHaveBeenCalled();
  });

  it('accepts a pincode whose postal lookup returns no post offices', async () => {
    const store = setupStore({ currentMode: 'mode_1' });
    mockValidatePincode.mockResolvedValue({ isValid: true });
    renderWizard();
    const dialog = openAddVendorDialog();
    fillVendorForm(dialog);
    expect(within(dialog).getByText('Checking')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(mockValidatePincode).toHaveBeenCalledWith('411001');
    expect(within(dialog).queryByText('Checking')).not.toBeInTheDocument();
    // No post offices came back, so there is nothing to confirm and nothing to reject.
    expect(within(dialog).queryByText('Valid')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Invalid')).not.toBeInTheDocument();

    fireEvent.click(submitButton(dialog));
    await waitFor(() =>
      expect(store.addBuyerVendor).toHaveBeenCalledWith(expect.objectContaining({ pincode: '411001' }))
    );
  });

  it('defaults the new vendor major category to IT when the taxonomy lists no majors', async () => {
    const store = setupStore({ currentMode: 'mode_1' });
    mockGetMajorCategories.mockReturnValue([]);
    renderWizard();
    const dialog = openAddVendorDialog();
    fillVendorForm(dialog);

    // With no majors to choose from the select has no options, so the browser's
    // required-field check would block the click; submit the form directly.
    fireEvent.submit(within(dialog).getByPlaceholderText('e.g. Ashok Industries').closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(store.addBuyerVendor).toHaveBeenCalledWith(expect.objectContaining({ majorCategory: 'IT' }))
    );
  });
});

// ------------------------------------------------------------------------------
// Delivery pincode lookups
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: delivery pincode lookups', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const locationInput = () => screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder);
  const pincodeInput = () => screen.getByPlaceholderText(MODAL.deliveryPincodePlaceholder);
  const PUNE_OFFICE: PostOfficeDetail = { Name: 'Shivajinagar', District: 'Pune', State: 'Maharashtra' };

  describe('after the typing debounce', () => {
    it('fills the location from the PIN prefix map when the lookup lists no post offices', async () => {
      mockValidatePincode.mockResolvedValue({ isValid: true });
      renderWizard();

      fireEvent.change(pincodeInput(), { target: { value: '411001' } });
      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      expect(mockValidatePincode).toHaveBeenCalledWith('411001');
      expect(locationInput()).toHaveValue('Pune, Maharashtra');
    });

    it('keeps the typed location when the PIN prefix is unknown to the fallback map', async () => {
      mockValidatePincode.mockResolvedValue({ isValid: true });
      renderWizard();

      fireEvent.change(locationInput(), { target: { value: 'Hazira Works' } });
      fireEvent.change(pincodeInput(), { target: { value: '991234' } });
      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      expect(mockValidatePincode).toHaveBeenCalledWith('991234');
      expect(locationInput()).toHaveValue('Hazira Works');
    });

    it('shows the Valid badge and the resolved city once the lookup returns post offices', async () => {
      mockValidatePincode.mockResolvedValue({ isValid: true, postOffices: [PUNE_OFFICE] });
      renderWizard();

      fireEvent.change(pincodeInput(), { target: { value: '411001' } });
      expect(screen.queryByText('Valid')).not.toBeInTheDocument();
      await act(async () => {
        jest.advanceTimersByTime(400);
      });

      expect(screen.getByText('Valid')).toBeInTheDocument();
      expect(locationInput()).toHaveValue('Pune, Maharashtra');
    });
  });

  describe('on blur', () => {
    it('does not query the postal service for a pincode that is not six digits', async () => {
      renderWizard();
      fireEvent.change(pincodeInput(), { target: { value: 'AB1' } });

      fireEvent.blur(pincodeInput());
      await flushAsync();

      expect(mockValidatePincode).not.toHaveBeenCalled();
    });

    it('leaves the location alone when the postal service rejects the pincode', async () => {
      mockValidatePincode.mockResolvedValue({
        isValid: false,
        message: 'PIN Code is not found or invalid in postal records.',
      });
      renderWizard();
      fireEvent.change(locationInput(), { target: { value: 'Hazira Works' } });
      fireEvent.change(pincodeInput(), { target: { value: '411001' } });

      fireEvent.blur(pincodeInput());
      await flushAsync();

      expect(mockValidatePincode).toHaveBeenCalledTimes(1);
      expect(mockValidatePincode).toHaveBeenCalledWith('411001');
      expect(locationInput()).toHaveValue('Hazira Works');
      expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
    });

    it('fills the location from the PIN prefix map when the lookup lists no post offices', async () => {
      mockValidatePincode.mockResolvedValue({ isValid: true });
      renderWizard();
      fireEvent.change(pincodeInput(), { target: { value: '411001' } });

      fireEvent.blur(pincodeInput());
      await flushAsync();

      expect(locationInput()).toHaveValue('Pune, Maharashtra');
    });

    it('keeps the typed location when the PIN prefix is unknown to the fallback map', async () => {
      mockValidatePincode.mockResolvedValue({ isValid: true });
      renderWizard();
      fireEvent.change(locationInput(), { target: { value: 'Hazira Works' } });
      fireEvent.change(pincodeInput(), { target: { value: '991234' } });

      fireEvent.blur(pincodeInput());
      await flushAsync();

      expect(mockValidatePincode).toHaveBeenCalledWith('991234');
      expect(locationInput()).toHaveValue('Hazira Works');
    });
  });
});

// ------------------------------------------------------------------------------
// Uploaded documents and manual recovery
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: documents and manual recovery', () => {
  it('keeps the other document listed when one of two uploads is removed', () => {
    renderWizard();
    dropFiles([textFile('first-requisition.txt')]);
    dropFiles([textFile('second-requisition.txt')]);
    expect(screen.getByText(/Uploaded Documents \(2\)/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle('Remove file')[0]);

    expect(screen.getByText(/Uploaded Documents \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText('first-requisition.txt')).not.toBeInTheDocument();
    expect(screen.getByText('second-requisition.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Extract Line Items with AI/i })).toBeEnabled();
  });

  it('shows the plain-text cause when extraction is rejected with a non-error value', async () => {
    const store = setupStore();
    mockExtract.mockRejectedValueOnce('socket hang up');
    renderWizard();
    dropFiles([textFile('requisition.txt')]);

    fireEvent.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }));

    expect(await screen.findByText(EXTRACTION.unreadableResponse)).toBeInTheDocument();
    expect(screen.getByText(EXTRACTION.errorDetailLabel)).toBeInTheDocument();
    expect(screen.getByText('socket hang up')).toBeInTheDocument();
    expect(mockExtract).toHaveBeenCalledWith({ fileName: 'requisition.txt', documentText: 'Need 10 centrifugal pumps' });
    expect(store.showToast).toHaveBeenCalledWith(EXTRACTION.fallbackTitle, EXTRACTION.unreadableResponse, 'warning');
  });

  it('adds a blank line item to key into when manual entry is chosen after the table was emptied', async () => {
    const store = setupStore();
    mockExtract.mockResolvedValueOnce({ success: false, reason: 'NO_ITEMS_FOUND' });
    renderWizard();
    fireEvent.click(screen.getByTitle('Remove line item'));
    expect(screen.getByText(/No line items added yet\./i)).toBeInTheDocument();
    dropFiles([textFile('requisition.txt')]);
    fireEvent.click(screen.getByRole('button', { name: /Extract Line Items with AI/i }));
    expect(await screen.findByText(EXTRACTION.reasonMessages.NO_ITEMS_FOUND)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: EXTRACTION.manualEntryAction }));

    expect(screen.getAllByPlaceholderText(MODAL.itemPlaceholder)).toHaveLength(1);
    expect(screen.queryByText(/No line items added yet\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(EXTRACTION.reasonMessages.NO_ITEMS_FOUND)).not.toBeInTheDocument();
    expect(store.showToast).toHaveBeenCalledWith(EXTRACTION.fallbackTitle, EXTRACTION.manualEntryStarted, 'info');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});

// ------------------------------------------------------------------------------
// Auto-categorise
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: auto-categorise', () => {
  const autoCategorizeButton = () => screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });

  function addRowsNamed(names: string[]) {
    while (screen.getAllByPlaceholderText(MODAL.itemPlaceholder).length < names.length) {
      fireEvent.click(screen.getAllByRole('button', { name: /Add Line Item/i })[0]);
    }
    names.forEach((name, index) => fillLineItem(index, { name }));
  }

  const majorValues = () => screen.getAllByLabelText(MODAL.colMajor).map((select) => (select as HTMLSelectElement).value);

  it('classifies only the blank row and keeps the categories already chosen on the other rows', async () => {
    const store = setupStore();
    mockClassify.mockImplementationOnce(async (items) => classifiedAs(items, 'Raw Material', 'Aluminium'));
    renderWizard();
    addRowsNamed(['Gate Valve', 'Silicone Sealant', 'Bearing Housing']);
    fillLineItem(0, { major: 'Civil Works' });
    fillLineItem(2, { major: MECHANICAL });

    fireEvent.click(autoCategorizeButton());

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith(
        EXTRACTION.classifySuccessTitle,
        'Categorized 3 line items with appropriate categories.',
        'success'
      )
    );
    // Only the blank row was sent, with the blank-field defaults filled in.
    expect(mockClassify).toHaveBeenCalledTimes(1);
    expect(mockClassify.mock.calls[0][0]).toHaveLength(1);
    expect(mockClassify.mock.calls[0][0][0]).toEqual(
      expect.objectContaining({ itemName: 'Silicone Sealant', quantity: 1, unit: 'nos', majorCategory: '' })
    );
    expect(majorValues()).toEqual(['Civil Works', 'Raw Material', MECHANICAL]);
    expect(screen.getAllByLabelText(MODAL.colMinor)[1]).toHaveValue('Aluminium');
  });

  it('leaves a row blank when the server answers with a major category outside the master', async () => {
    const store = setupStore();
    mockClassify.mockImplementationOnce(async (items) => classifiedAs(items, 'Imaginary Division', 'Nonsense'));
    renderWizard();
    fillLineItem(0, { name: 'Mystery Widget' });

    fireEvent.click(autoCategorizeButton());

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith(
        EXTRACTION.classifySuccessTitle,
        'Categorized 0 of 1 line items. 1 could not be reliably categorized and were left empty.',
        'success'
      )
    );
    expect(majorValues()).toEqual(['']);
    expect(screen.getByLabelText(MODAL.colMinor)).toHaveValue('');
  });

  it('keeps a valid major category but drops a minor category that does not belong to it', async () => {
    const store = setupStore();
    mockClassify.mockImplementationOnce(async (items) => classifiedAs(items, 'Civil Works', 'Aluminium'));
    renderWizard();
    fillLineItem(0, { name: 'Aluminium Sheet' });

    fireEvent.click(autoCategorizeButton());

    await waitFor(() =>
      expect(store.showToast).toHaveBeenCalledWith(
        EXTRACTION.classifySuccessTitle,
        'Categorized 1 line items with appropriate categories.',
        'success'
      )
    );
    expect(majorValues()).toEqual(['Civil Works']);
    expect(screen.getByLabelText(MODAL.colMinor)).toHaveValue('');
    await flushAsync();
  });
});

// ------------------------------------------------------------------------------
// Submit validation and dispatch payloads
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: submit validation and dispatch payloads', () => {
  it('lists every blocking header field in the validation toast and leaves valid ones out', () => {
    const store = setupStore();
    renderWizard();
    fireEvent.change(screen.getByLabelText(MODAL.titleLabel), { target: { value: 'ab' } });
    fillDelivery();
    fireEvent.change(screen.getByLabelText(MODAL.targetDateLabel), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByTitle('Remove line item'));

    fireEvent.click(dispatchButton());

    expect(store.showToast).toHaveBeenCalledWith(
      'Validation Error',
      `Validation Error ${EN_DASH} Please complete: RFQ Title, Target Delivery Date (cannot be in the past), At least 1 complete line item.`,
      'warning'
    );
    expect(screen.getByText(formatString(MANUAL.titleLength, { min: 3, max: 200 }))).toBeInTheDocument();
    expect(screen.getByText(MANUAL.targetDateCannotBePast)).toBeInTheDocument();
    expect(screen.getByText(MANUAL.lineItemsRequired)).toBeInTheDocument();
    expect(mockCreateRFQ).not.toHaveBeenCalled();
    expect(store.setCurrentMode).not.toHaveBeenCalled();
  });

  it('falls back to the generic validation toast when only an unlisted field fails', () => {
    const store = setupStore();
    renderWizard();
    fillValidForm();

    fireEvent.change(screen.getByPlaceholderText('e.g. 500000'), { target: { value: '-5' } });
    fireEvent.click(dispatchButton());

    expect(store.showToast).toHaveBeenCalledWith(
      'Validation Error',
      `Validation Error ${EN_DASH} Please complete all required fields and line items before dispatching.`,
      'warning'
    );
    expect(screen.getByText(MANUAL.budgetNegative)).toBeInTheDocument();
    expect(mockCreateRFQ).not.toHaveBeenCalled();
  });

  it('assigns sparse roster records under fallback names and tags each by where it came from', async () => {
    const store = setupStore({
      currentMode: 'mode_2',
      buyerVendors: [
        vendor({ source: 'buyer_uploaded' }),
        vendor({ id: 'net-9', name: 'Network Fabricators', source: 'procucev_network' }),
      ],
    });
    renderWizard();
    fillValidForm();

    await dispatchRfq();

    expect(mockCreateRFQ.mock.calls[0][0].assignedVendors).toEqual([
      {
        id: undefined,
        name: 'Enterprise Vendor',
        email: null,
        contactPerson: null,
        phone: null,
        vendorCategory: 'Client List',
      },
      {
        id: 'net-9',
        name: 'Network Fabricators',
        email: null,
        contactPerson: 'Network Fabricators',
        phone: null,
        vendorCategory: 'Procucev Network',
      },
    ]);
    // With no category on the RFQ nothing is a mismatch, so no shortlist warning.
    expect(store.showToast).not.toHaveBeenCalledWith('Shortlist Adjusted', expect.anything(), expect.anything());
    expect(store.setCurrentMode).toHaveBeenCalledWith('mode_2');
    expect(store.adoptCreatedRFQ).toHaveBeenCalledWith(expect.objectContaining({ rfqNumber: 'RFQ-2026-00450' }));
  });
});

// ------------------------------------------------------------------------------
// Mode 3: top Procucev network vendors
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: Mode 3 Procucev ranking', () => {
  const ALPHA = candidate({
    id: 'net-alpha',
    name: 'Alpha Pumps',
    source: 'procucev_network',
    majorCategory: MECHANICAL,
    minorCategories: ['Pumps & Accessories'],
    rating: 4.5,
  });
  const BETA = candidate({
    id: 'net-beta',
    name: 'Beta Valves',
    source: 'procucev_network',
    majorCategory: MECHANICAL,
    minorCategories: ['Pumps & Accessories'],
    rating: 4.2,
  });

  const cardFor = async (name: string) =>
    (await screen.findAllByTestId('procucev-v3-vendor')).find((card) => within(card).queryByText(name)) as HTMLElement;

  const assignedVendorsSent = () => mockCreateRFQ.mock.calls[0][0].assignedVendors;

  it('drops a selected vendor that falls out of the re-ranked list when the delivery location changes', async () => {
    directoryPool = [ALPHA, BETA];
    setupStore({ currentMode: 'mode_3' });
    renderWizard();
    fillLineItem(0, { major: MECHANICAL });
    fireEvent.click(await cardFor('Alpha Pumps'));
    expect(await screen.findByText('1 of 2 selected')).toBeInTheDocument();

    directoryPool = [BETA];
    fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), { target: { value: 'Pune Plant' } });

    expect(await screen.findByText('0 of 1 selected')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Pumps')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Valves')).toBeInTheDocument();
  });

  it('does not invite the Procucev twin of a vendor already on the private roster twice', async () => {
    directoryPool = [
      candidate({
        id: 'dup-1',
        name: 'Dup Network Twin',
        source: 'procucev_network',
        majorCategory: MECHANICAL,
        minorCategories: ['Pumps & Accessories'],
        rating: 4.2,
      }),
    ];
    const store = setupStore({
      currentMode: 'mode_3',
      buyerVendors: [
        vendor({
          id: 'dup-1',
          name: 'Dup Roster Vendor',
          contactPerson: 'R. Dup',
          email: 'dup@roster.test',
          phone: '+91 90000 00001',
          source: 'buyer_uploaded',
          majorCategory: MECHANICAL,
          minorCategories: ['Pumps & Accessories'],
        }),
      ],
    });
    renderWizard();
    fillValidForm({ major: MECHANICAL });
    fireEvent.click(await cardFor('Dup Network Twin'));
    expect(await screen.findByText('1 of 1 selected')).toBeInTheDocument();

    await dispatchRfq();

    expect(assignedVendorsSent()).toEqual([
      {
        id: 'dup-1',
        name: 'Dup Roster Vendor',
        email: 'dup@roster.test',
        contactPerson: 'R. Dup',
        phone: '+91 90000 00001',
        vendorCategory: 'Client List',
      },
    ]);
    expect(store.adoptCreatedRFQ).toHaveBeenCalledTimes(1);
  });

  it('shows and dispatches ranked vendors that have no name, id or category on record', async () => {
    directoryPool = [
      candidate({ id: 'net-nameless', source: 'procucev_network' }),
      candidate({ name: 'Idless Network Co', source: 'procucev_network', majorCategory: 'Raw Material' }),
    ];
    setupStore({ currentMode: 'mode_3' });
    renderWizard();
    fillValidForm();

    const cards = await screen.findAllByTestId('procucev-v3-vendor');
    expect(cards).toHaveLength(2);
    const namelessCategory = within(cards[0]).getByTestId('procucev-v3-vendor-category');
    expect(namelessCategory).toHaveTextContent('General Industrial');
    expect(namelessCategory).toHaveAttribute('title', 'General Industrial');
    expect(within(cards[1]).getByText('Idless Network Co')).toBeInTheDocument();
    expect(within(cards[1]).getByTestId('procucev-v3-vendor-category')).toHaveTextContent('Raw Material');

    fireEvent.click(cards[0]);
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
    await dispatchRfq();

    expect(assignedVendorsSent()).toEqual([
      {
        id: 'net-nameless',
        name: 'Procucev Verified Supplier',
        email: null,
        contactPerson: null,
        phone: null,
        vendorCategory: 'Procucev Network',
        majorCategory: 'General Industrial',
        location: 'Nationwide supplier',
        matchScore: 54,
      },
    ]);
  });

  it('labels a ranked vendor by the category it matched on when it lists no major category', async () => {
    directoryPool = [
      candidate({
        id: 'net-minor',
        name: 'Minor Only Pumps',
        source: 'procucev_network',
        minorCategories: ['Pumps & Accessories'],
        city: 'Pune',
        rating: 4.1,
      }),
    ];
    setupStore({ currentMode: 'mode_3' });
    renderWizard();
    fillValidForm({ major: MECHANICAL, minor: 'Pumps & Accessories' });

    const card = await cardFor('Minor Only Pumps');
    const category = within(card).getByTestId('procucev-v3-vendor-category');
    expect(category).toHaveTextContent('Pumps & Accessories');
    expect(category).toHaveAttribute('title', 'Pumps & Accessories');

    fireEvent.click(card);
    await dispatchRfq();

    expect(assignedVendorsSent()).toEqual([
      expect.objectContaining({
        id: 'net-minor',
        name: 'Minor Only Pumps',
        vendorCategory: 'Procucev Network',
        majorCategory: 'Pumps & Accessories',
        location: 'Pune',
      }),
    ]);
  });

  it.each([
    ['echoes the dispatched list', [{ id: 'echo-1', name: 'Server Echo Vendor' }]],
    ['omits the dispatched list', undefined],
  ])(
    'still counts the buyer pick after a failed re-rank emptied the panel when the server %s',
    async (_label, echoedVendors) => {
      directoryPool = [ALPHA];
      setupStore({ currentMode: 'mode_3' });
      mockCreateRFQ.mockResolvedValue({
        success: true,
        rfq: createdRfq({ sourcingMode: 'mode_3', procucevVendorCount: 0, assignedVendors: echoedVendors }),
      });
      renderWizard();
      fillValidForm({ major: MECHANICAL });
      fireEvent.click(await cardFor('Alpha Pumps'));
      expect(await screen.findByText('1 of 1 selected')).toBeInTheDocument();

      // The directory goes down: the refresh empties the ranked panel, yet the pick is retained.
      directoryFails = true;
      fireEvent.change(screen.getByPlaceholderText(MODAL.deliveryLocationPlaceholder), {
        target: { value: 'Pune Plant' },
      });
      expect(await screen.findByText(/No Procucev network vendors matched/)).toBeInTheDocument();

      await dispatchRfq();

      expect(assignedVendorsSent()).toEqual([]);
      expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();
      expect(screen.getByTestId('confirmation-procucev-vendor-count')).toHaveTextContent('1');
    }
  );

  it('asks for the whole directory when a line item opts into All Categories', async () => {
    setupStore({ currentMode: 'mode_3' });
    renderWizard();
    await flushAsync();
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);

    fillLineItem(0, { major: ALL_CATEGORIES });
    await flushAsync();

    expect(screen.getByTestId('procucev-v3-panel')).toBeInTheDocument();
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(3);
    expect(mockFetchAllVendors.mock.calls.every(([options]) => options?.category === '')).toBe(true);

    fillLineItem(0, { major: 'Civil Works' });
    await flushAsync();

    expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ page: 1, pageSize: 100, search: '', category: 'Civil Works' });
  });
});

// ------------------------------------------------------------------------------
// Vendor directory lookups for the selected category
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: vendor directory lookups', () => {
  it('reuses the loaded directory when All Categories is selected again', async () => {
    directoryPool = [candidate({ id: 'net-1', name: 'Net One', source: 'procucev_network' })];
    renderWizard();

    fillLineItem(0, { major: ALL_CATEGORIES });
    await flushAsync();
    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
    expect(mockFetchAllVendors).toHaveBeenCalledWith({ page: 1, pageSize: 100, search: '', category: '' });

    // Un-choosing the category makes no request, and choosing All Categories again is
    // answered from the list that already loaded.
    fillLineItem(0, { major: '' });
    fillLineItem(0, { major: ALL_CATEGORIES });
    await flushAsync();

    expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
  });

  it('ignores a superseded directory response and tolerates a failed one', async () => {
    const first = createDeferred<RFQVendorPageResult>();
    const second = createDeferred<RFQVendorPageResult>();
    mockFetchAllVendors.mockReset();
    mockFetchAllVendors.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderWizard();

    fillLineItem(0, { major: 'Civil Works' });
    fillLineItem(0, { major: 'Professional Services' });

    expect(mockFetchAllVendors).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 100, search: '', category: 'Civil Works' });
    expect(mockFetchAllVendors).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 100,
      search: '',
      category: 'Professional Services',
    });

    await act(async () => {
      second.resolve(FAILED_PAGE);
      first.resolve(pageResult([candidate({ id: 'net-late', name: 'Late Vendor', source: 'procucev_network' })]));
    });

    expect(mockFetchAllVendors).toHaveBeenCalledTimes(2);
    expect(firstMajorSelect()).toHaveValue('Professional Services');
    expect(dispatchButton()).toBeEnabled();
  });
});

// ------------------------------------------------------------------------------
// Dispatch confirmation dialog
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: dispatch confirmation dialog', () => {
  it('names a Mode 0 RFQ that has category signals by its title', async () => {
    setupStore({ currentMode: 'mode_0' });
    mockCreateRFQ.mockResolvedValue({
      success: true,
      rfq: createdRfq({
        sourcingMode: 'mode_0',
        category: '',
        title: 'Hydraulic Pump Order',
        extractedEntities: [
          {
            id: 'e1',
            itemName: 'Pump',
            quantity: 1,
            unit: 'Nos',
            targetDate: '',
            technicalSpecs: '',
            confidence: 0,
            category: 'Pumps & Accessories',
            majorCategory: '',
            minorCategory: '',
          },
        ],
      }),
    });
    renderWizard();
    fillValidForm();

    await dispatchRfq();

    expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();
    expect(screen.getByText('Hydraulic Pump Order')).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized (Pending CM)')).not.toBeInTheDocument();
  });

  it('treats an RFQ confirmed without a sourcing mode as a mode with no Procucev vendor box', async () => {
    mockCreateRFQ.mockResolvedValue({ success: true, rfq: createdRfq({ sourcingMode: undefined }) });
    renderWizard();
    fillValidForm();

    await dispatchRfq();

    expect(await screen.findByText('RFQ Dispatched Successfully!')).toBeInTheDocument();
    expect(screen.getByText('Mode & Vendors')).toBeInTheDocument();
    expect(screen.queryByText('Your Invited Vendors')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirmation-vendor-count')).toHaveTextContent('0');
    expect(screen.queryByTestId('confirmation-procucev-vendor-box')).not.toBeInTheDocument();
  });

  it.each([
    ['Compare in Matrix', true],
    ['Done', false],
  ])('closes through "%s" without a completion callback', async (buttonName, navigates) => {
    renderWizard({ onComplete: undefined as unknown as WizardProps['onComplete'] });
    fillValidForm();
    await dispatchRfq();

    fireEvent.click(await screen.findByRole('button', { name: buttonName }));

    expect(screen.queryByText('RFQ Dispatched Successfully!')).not.toBeInTheDocument();
    if (navigates) {
      expect(mockRouterPush).toHaveBeenCalledWith('/buyer/quote-matrix?rfq=RFQ-2026-00450');
    } else {
      expect(mockRouterPush).not.toHaveBeenCalled();
    }
  });

  it('still completes when no router is available for the matrix link', async () => {
    mockUseRouter.mockImplementation(() => {
      throw new Error('app router is not mounted');
    });
    const { props } = renderWizard();
    fillValidForm();
    await dispatchRfq();

    fireEvent.click(await screen.findByRole('button', { name: 'Compare in Matrix' }));

    expect(screen.queryByText('RFQ Dispatched Successfully!')).not.toBeInTheDocument();
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------
// Free-quota banner
// ------------------------------------------------------------------------------

describe('IngestionWizard coverage: free-quota controls', () => {
  it.each([
    ['quota notice under the form', 1],
    ['footer action bar', 2],
  ])('switches to Mode 0 from the %s', (_label, position) => {
    renderWizard({ forceSubscription: 'free_trial', forceRemainingFreeRFQs: 0 });
    const switchButtons = screen.getAllByRole('button', { name: EXTRACTION.useV0Action });
    expect(switchButtons).toHaveLength(3);

    fireEvent.click(switchButtons[position]);

    expect(screen.queryByTestId('ingestion-wizard-quota-exhausted-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('sourcing-mode-btn-mode_0')).toHaveAttribute('aria-checked', 'true');
    expect(dispatchButton()).toBeEnabled();
  });
});
