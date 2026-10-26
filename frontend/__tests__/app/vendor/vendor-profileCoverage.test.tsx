/**
 * Extra coverage for the vendor supplier-profile screen (app/vendor/vendor-profile.tsx).
 *
 * The existing suites drive this screen through the real AppProvider with one canned
 * vendor record, so the store's toasts are invisible and the session, taxonomy and
 * category registry are whatever the provider happens to hold. This suite mocks
 * `useApp` instead, so each test controls the session, the category taxonomy and the
 * store callbacks directly and can assert on the exact toasts, audit entries and API
 * requests the screen produces. Only `validatePincode` (the postal lookup) is replaced
 * in `@/lib/validationSchemas`, which lets the debounced PIN code flow run
 * deterministically under fake timers.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorProfilePage from '@/app/vendor/vendor-profile';
import { useApp } from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { validatePincode, type PostOfficeDetail } from '@/lib/validationSchemas';
import { UI_STRINGS } from '@/lib/uiStrings';
import type { MajorMinorCategory, UserSession } from '@/lib/types';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/validationSchemas', () => ({
  ...jest.requireActual('@/lib/validationSchemas'),
  validatePincode: jest.fn(),
}));

const mockedUseApp = useApp as jest.Mock;
const mockedValidatePincode = validatePincode as jest.MockedFunction<typeof validatePincode>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VENDOR_EMAIL = 'vendor@example.com';
const TEST_TOKEN = 'test-session-token';
const VALID_PAN = 'AAACA9876K';
const VALID_GST = '27AAACA9876K1Z9';
const ELECTRICAL = 'Engineering Spares - Electrical';
const MECHANICAL = 'Engineering Spares - Mechanical';
const OTHER_GROUP = UI_STRINGS.vendorProfile.customCategoryGroup;
const REMOVE_CHIP = UI_STRINGS.vendorProfile.removeCategoryTitle;

const VENDOR_SESSION: UserSession = {
  id: 'usr-vendor-1',
  email: VENDOR_EMAIL,
  name: 'Vikram Malhotra',
  role: 'vendor',
  orgId: 'org-vendor-1',
  orgName: 'Apex Supplies Pvt Ltd',
};

/** A saved backend vendor record: valid tax identifiers, two saved categories, no PIN code. */
const VENDOR_RECORD = {
  id: 'v-100',
  name: 'Apex Supplies Pvt Ltd',
  pan: VALID_PAN,
  gst: VALID_GST,
  city: 'Mumbai',
  state: 'Maharashtra',
  clientMappedCategories: ['Bearings & Accessories'],
  vendorSelectedCategories: ['Bearings & Accessories', 'Cables'],
};

/** Small single-group taxonomies keep the page light and make the first category row predictable. */
const ELECTRICAL_ONLY: MajorMinorCategory[] = [
  { majorCategory: ELECTRICAL, minorCategories: ['Cables', 'Motors', 'Panels'] },
];
const LOGISTICS_ONLY: MajorMinorCategory[] = [
  { majorCategory: 'Logistics', minorCategories: ['Air Logistics', 'Courier & Parcel', 'Road transport'] },
];
const BESPOKE_ONLY: MajorMinorCategory[] = [{ majorCategory: 'Bespoke Services', minorCategories: [] }];

const TEN_CUSTOM_CATEGORIES = Array.from({ length: 10 }, (_, index) => `Custom Item ${index + 1}`);

const LABEL = {
  company: 'Vendor Legal Entity Name *',
  pan: 'PAN Number *',
  gst: 'GSTIN / GST Number *',
  city: 'City',
  state: 'State',
  pincode: 'PIN Code',
  email: 'Email Address',
} as const;

const SAVE_BUTTON_NAME = /^Save Supplier Profile$/;

// ---------------------------------------------------------------------------
// Store mock
// ---------------------------------------------------------------------------

interface VendorAppState {
  addAuditLog: jest.Mock;
  showToast: jest.Mock;
  vendorSubscription: string;
  completeVendorProfile: jest.Mock;
  clientMappedCategories: string[];
  vendorSelectedCategories: string[];
  saveVendorProfileCategories: jest.Mock | undefined;
  currentUserSession: UserSession | null;
  categoryTaxonomy: MajorMinorCategory[];
  categoryTaxonomyError: string | null;
}

const showToast = jest.fn();
const addAuditLog = jest.fn();
const saveVendorProfileCategories = jest.fn();

function useAppState(overrides: Partial<VendorAppState> = {}): void {
  const state: VendorAppState = {
    addAuditLog,
    showToast,
    vendorSubscription: 'connect',
    completeVendorProfile: jest.fn(),
    clientMappedCategories: [],
    vendorSelectedCategories: [],
    saveVendorProfileCategories,
    currentUserSession: VENDOR_SESSION,
    categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
    categoryTaxonomyError: null,
    ...overrides,
  };
  mockedUseApp.mockReturnValue(state);
}

// ---------------------------------------------------------------------------
// Vendor API mock
// ---------------------------------------------------------------------------

type ApiOutcome =
  | { kind: 'reply'; ok: boolean; status: number; body: unknown }
  | { kind: 'reject'; reason: unknown };

function reply(body: unknown, ok = true, status = ok ? 200 : 400): ApiOutcome {
  return { kind: 'reply', ok, status, body };
}

function rejectWith(reason: unknown): ApiOutcome {
  return { kind: 'reject', reason };
}

function settle(outcome: ApiOutcome): Promise<unknown> {
  if (outcome.kind === 'reject') return Promise.reject(outcome.reason);
  return Promise.resolve({ ok: outcome.ok, status: outcome.status, json: async () => outcome.body });
}

interface VendorApiScript {
  /** GET /api/vendors/:email. Defaults to 404, i.e. no backend record yet. */
  loadProfile?: ApiOutcome;
  /** POST /api/vendors. */
  createProfile?: ApiOutcome;
  /** PUT /api/vendors/:id. */
  updateProfile?: ApiOutcome;
  /** PUT /api/vendors/:id/categories. */
  saveCategories?: ApiOutcome;
}

const OK_EMPTY = reply({ success: true, data: {} });
const NOT_FOUND = reply({ success: false, error: 'Not found' }, false, 404);

function installVendorApi(script: VendorApiScript = {}): jest.Mock {
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (/\/categories$/.test(url)) return settle(script.saveCategories ?? OK_EMPTY);
    if (method === 'POST') return settle(script.createProfile ?? OK_EMPTY);
    if (method === 'PUT') return settle(script.updateProfile ?? OK_EMPTY);
    return settle(script.loadProfile ?? NOT_FOUND);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

function recordedRequests(): RecordedRequest[] {
  return (global.fetch as jest.Mock).mock.calls.map(([url, init]: [string, RequestInit | undefined]) => ({
    url,
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
  }));
}

function requestsMatching(method: string, pattern: RegExp): RecordedRequest[] {
  return recordedRequests().filter((request) => request.method === method && pattern.test(request.url));
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** The page's labels are not wired to their inputs, so walk up from the label to the one input beside it. */
function inputForLabel(labelText: string): HTMLInputElement {
  let node: HTMLElement | null = screen.getByText(labelText);
  while (node) {
    const inputs = within(node).queryAllByRole('textbox');
    if (inputs.length === 1) return inputs[0] as HTMLInputElement;
    node = node.parentElement;
  }
  throw new Error(`No text input found beside the label "${labelText}"`);
}

function setField(labelText: string, value: string): void {
  fireEvent.change(inputForLabel(labelText), { target: { value } });
}

function customCategoryInput(): HTMLInputElement {
  return screen.getByPlaceholderText(UI_STRINGS.vendorProfile.customCategoryPlaceholder) as HTMLInputElement;
}

function addCustomCategory(name: string): void {
  fireEvent.change(customCategoryInput(), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.vendorProfile.addCategoryButton }));
}

function chipRemoveButton(categoryName: string): HTMLElement {
  return screen.getByRole('button', { name: `${REMOVE_CHIP}: ${categoryName}` });
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: SAVE_BUTTON_NAME });
}

/** The icon-only chevron of the first category row (every row has a select toggle, then the chevron). */
function firstRowChevron(): HTMLElement {
  const [, chevron] = screen.getAllByRole('button', { name: '' });
  return chevron;
}

async function renderPage(): Promise<void> {
  render(<VendorProfilePage />);
  // The save buttons stay disabled until the profile load has settled.
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

async function saveProfile(): Promise<void> {
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

function fillRequiredFields(): void {
  setField(LABEL.company, 'Apex Supplies Pvt Ltd');
  setField(LABEL.pan, VALID_PAN);
  setField(LABEL.gst, VALID_GST);
  addCustomCategory('Cables');
}

async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VendorProfilePage extended coverage (mocked store)', () => {
  let getTokenSpy: jest.SpyInstance<string | null, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppState();
    mockedValidatePincode.mockResolvedValue({ isValid: true });
    getTokenSpy = jest.spyOn(authClient, 'getToken').mockReturnValue(TEST_TOKEN);
    installVendorApi();
  });

  afterEach(() => {
    jest.useRealTimers();
    getTokenSpy.mockRestore();
  });

  describe('PIN code validation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      useAppState({ currentUserSession: null });
    });

    it('flags a dummy PIN code at once, highlights the field and skips the postal lookup', async () => {
      await renderPage();

      fireEvent.change(inputForLabel(LABEL.pincode), { target: { value: '111111' } });

      expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();
      expect(screen.getByText('Invalid')).toBeInTheDocument();
      expect(inputForLabel(LABEL.pincode)).toHaveClass('border-rose-400');
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      expect(mockedValidatePincode).not.toHaveBeenCalled();
    });

    it('flags a malformed PIN code that was loaded from the vendor record', async () => {
      useAppState();
      installVendorApi({ loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, pincode: '#12AB6' } }) });
      await renderPage();

      expect(inputForLabel(LABEL.pincode)).toHaveValue('#12AB6');
      expect(screen.getByText('Invalid PIN code format')).toBeInTheDocument();
      expect(screen.getByText('Invalid')).toBeInTheDocument();
      expect(mockedValidatePincode).not.toHaveBeenCalled();
    });

    it('clears the error and stays quiet while the PIN code is still being typed', async () => {
      await renderPage();
      const pincode = inputForLabel(LABEL.pincode);

      fireEvent.change(pincode, { target: { value: '111111' } });
      expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

      fireEvent.change(pincode, { target: { value: '1111' } });

      expect(screen.queryByText('Invalid or dummy PIN code')).not.toBeInTheDocument();
      expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      expect(pincode).not.toHaveClass('border-rose-400');
      await advanceTimers(1000);
      expect(mockedValidatePincode).not.toHaveBeenCalled();
    });

    it('looks up a complete PIN code after a short pause and fills in the city and state', async () => {
      mockedValidatePincode.mockResolvedValue({
        isValid: true,
        postOffices: [{ Name: 'Andheri', District: 'Mumbai Suburban', Division: 'Mumbai North', State: 'Maharashtra' }],
      });
      await renderPage();

      setField(LABEL.pincode, '400053');

      expect(screen.getByText('Checking')).toBeInTheDocument();
      expect(mockedValidatePincode).not.toHaveBeenCalled();

      await advanceTimers(350);

      expect(mockedValidatePincode).toHaveBeenCalledTimes(1);
      expect(mockedValidatePincode).toHaveBeenCalledWith('400053');
      expect(inputForLabel(LABEL.city)).toHaveValue('Mumbai Suburban');
      expect(inputForLabel(LABEL.state)).toHaveValue('Maharashtra');
      expect(screen.getByText('Valid')).toBeInTheDocument();
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
    });

    it.each<[string, PostOfficeDetail, string, string]>([
      [
        'uses the district as the city and the post office state',
        { Name: 'Andheri SO', District: 'Mumbai Suburban', Division: 'Mumbai North', State: 'Maharashtra' },
        'Mumbai Suburban',
        'Maharashtra',
      ],
      [
        'falls back to the division when the district is blank',
        { Name: 'Thane HO', District: '', Division: 'Thane Division', State: 'Maharashtra' },
        'Thane Division',
        'Maharashtra',
      ],
      [
        'falls back to the post office name when district and division are blank',
        { Name: 'Powai SO', District: '', State: 'Maharashtra' },
        'Powai SO',
        'Maharashtra',
      ],
      [
        'keeps the typed city when the post office carries no place name',
        { Name: '', District: '', State: 'Goa' },
        'Existing City',
        'Goa',
      ],
      [
        'keeps the typed state when the post office carries no state',
        { Name: 'Margao', District: 'South Goa', State: '' },
        'South Goa',
        'Existing State',
      ],
    ])('autofill: %s', async (_scenario, postOffice, expectedCity, expectedState) => {
      mockedValidatePincode.mockResolvedValue({ isValid: true, postOffices: [postOffice] });
      await renderPage();
      setField(LABEL.city, 'Existing City');
      setField(LABEL.state, 'Existing State');

      setField(LABEL.pincode, '403601');
      await advanceTimers(350);

      expect(mockedValidatePincode).toHaveBeenCalledWith('403601');
      expect(inputForLabel(LABEL.city)).toHaveValue(expectedCity);
      expect(inputForLabel(LABEL.state)).toHaveValue(expectedState);
    });

    it('shows the postal service message when the PIN code is not found', async () => {
      mockedValidatePincode.mockResolvedValue({
        isValid: false,
        message: 'PIN Code is not found or invalid in postal records.',
      });
      await renderPage();

      setField(LABEL.pincode, '400053');
      await advanceTimers(350);

      expect(screen.getByText('PIN Code is not found or invalid in postal records.')).toBeInTheDocument();
      expect(screen.getByText('Invalid')).toBeInTheDocument();
      expect(screen.queryByText('Valid')).not.toBeInTheDocument();
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      expect(inputForLabel(LABEL.pincode)).toHaveClass('border-rose-400');
    });

    it('falls back to a generic message when the postal service gives no reason', async () => {
      mockedValidatePincode.mockResolvedValue({ isValid: false });
      await renderPage();

      setField(LABEL.pincode, '400053');
      await advanceTimers(350);

      expect(screen.getByText('Invalid PIN code')).toBeInTheDocument();
      expect(screen.getByText('Invalid')).toBeInTheDocument();
    });

    it('ignores a failed lookup: no error is shown, checking stops and the address is untouched', async () => {
      mockedValidatePincode.mockRejectedValue(new Error('postal service unreachable'));
      await renderPage();
      setField(LABEL.city, 'Existing City');

      setField(LABEL.pincode, '400053');
      expect(screen.getByText('Checking')).toBeInTheDocument();
      await advanceTimers(350);

      expect(mockedValidatePincode).toHaveBeenCalledWith('400053');
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
      expect(screen.queryByText('Invalid')).not.toBeInTheDocument();
      expect(screen.queryByText('Valid')).not.toBeInTheDocument();
      expect(inputForLabel(LABEL.city)).toHaveValue('Existing City');
    });

    it('restarts the pause when the PIN code changes so only the final value is looked up', async () => {
      await renderPage();

      setField(LABEL.pincode, '400053');
      await advanceTimers(200);
      setField(LABEL.pincode, '400054');
      await advanceTimers(200);
      expect(mockedValidatePincode).not.toHaveBeenCalled();

      await advanceTimers(150);

      expect(mockedValidatePincode).toHaveBeenCalledTimes(1);
      expect(mockedValidatePincode).toHaveBeenCalledWith('400054');
    });
  });

  describe('loading the vendor profile', () => {
    it.each<[string, string | null, Record<string, string>]>([
      ['sends the session token as a bearer credential', TEST_TOKEN, { Authorization: `Bearer ${TEST_TOKEN}` }],
      ['sends no credential when there is no stored token', null, {}],
    ])('profile request %s', async (_scenario, token, expectedHeaders) => {
      getTokenSpy.mockReturnValue(token);
      const fetchMock = installVendorApi();

      await renderPage();

      expect(fetchMock).toHaveBeenCalledWith(`/api/vendors/${encodeURIComponent(VENDOR_EMAIL)}`, {
        headers: expectedHeaders,
      });
    });

    it('does not call the vendor API while nobody is signed in', async () => {
      useAppState({ currentUserSession: null });

      await renderPage();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.queryByText(/Loading your supplier profile/)).not.toBeInTheDocument();
      expect(inputForLabel(LABEL.email)).toHaveValue('');
    });

    it('rebuilds the selection from a sparse record: blanks dropped, duplicates merged, unknown names filed under Other', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({
          success: true,
          data: {
            id: 'v-sparse',
            pan: VALID_PAN,
            gst: VALID_GST,
            vendorSelectedCategories: [
              'Pumps & Accessories',
              ' Pumps & Accessories ',
              '',
              '   ',
              null,
              'Hand-Forged Gadgets',
            ],
          },
        }),
      });

      await renderPage();

      // A record without a name leaves the company field blank rather than inventing one.
      expect(inputForLabel(LABEL.company)).toHaveValue('');
      expect(inputForLabel(LABEL.pan)).toHaveValue(VALID_PAN);
      expect(screen.getAllByRole('button', { name: new RegExp(`^${REMOVE_CHIP}:`) })).toHaveLength(2);
      expect(chipRemoveButton('Pumps & Accessories')).toBeInTheDocument();
      expect(chipRemoveButton('Hand-Forged Gadgets')).toBeInTheDocument();
      expect(screen.getByText('2 / 10 Selected')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: OTHER_GROUP })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Hand-Forged Gadgets/ })).toBeChecked();
    });
  });

  describe('custom category entry', () => {
    it('asks for a category name when Enter is pressed on a blank field', async () => {
      await renderPage();
      const input = customCategoryInput();

      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(showToast).toHaveBeenCalledWith(
        'Validation Error',
        UI_STRINGS.vendorProfile.categoryEmptyMessage,
        'warning'
      );
      expect(screen.queryByRole('button', { name: new RegExp(`^${REMOVE_CHIP}:`) })).not.toBeInTheDocument();
    });

    it('submits a typed category on the Enter key only', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();
      const input = customCategoryInput();
      fireEvent.change(input, { target: { value: 'Cables' } });

      fireEvent.keyDown(input, { key: 'a' });
      expect(showToast).not.toHaveBeenCalled();
      expect(input).toHaveValue('Cables');

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        `Found and automatically selected "Cables" under "${ELECTRICAL}".`,
        'success'
      );
      expect(input).toHaveValue('');
    });

    it('ticks an existing category found by exact name, opens its group and clears the field', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();

      addCustomCategory('motors');

      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        `Found and automatically selected "Motors" under "${ELECTRICAL}".`,
        'success'
      );
      expect(screen.getByRole('checkbox', { name: /Motors/ })).toBeChecked();
      expect(chipRemoveButton('Motors')).toBeInTheDocument();
      expect(customCategoryInput()).toHaveValue('');
    });

    it('treats a typed major category name as a request for its first minor category', async () => {
      useAppState({ categoryTaxonomy: LOGISTICS_ONLY });
      await renderPage();

      addCustomCategory('logistics');

      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        'Found and automatically selected "Air Logistics" under "Logistics".',
        'success'
      );
      expect(screen.getByRole('checkbox', { name: /Air Logistics/ })).toBeChecked();
    });

    it('falls back to the major name itself when the matched major has no minor categories', async () => {
      useAppState({ categoryTaxonomy: BESPOKE_ONLY });
      await renderPage();

      addCustomCategory('bespoke services');

      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        'Found and automatically selected "Bespoke Services" under "Bespoke Services".',
        'success'
      );
      expect(chipRemoveButton('Bespoke Services')).toBeInTheDocument();
    });

    it.each<[string, string, string]>([
      ['a fragment of an existing minor category', 'cable', 'Cables'],
      ['a phrase that contains an existing minor category', 'industrial motors kit', 'Motors'],
    ])('selects the matching minor category when the typed text is %s', async (_scenario, typed, expectedMinor) => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();

      addCustomCategory(typed);

      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        `Found and automatically selected "${expectedMinor}" under "${ELECTRICAL}".`,
        'success'
      );
      expect(screen.getByRole('checkbox', { name: new RegExp(expectedMinor) })).toBeChecked();
    });

    it('falls back to the shared category registry when the name is not in the displayed taxonomy', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();

      addCustomCategory('Fasteners');

      expect(showToast).toHaveBeenCalledWith(
        'Category Selected',
        `Found and automatically selected "Fasteners" under "${MECHANICAL}".`,
        'success'
      );
      expect(chipRemoveButton('Fasteners')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3, name: MECHANICAL })).not.toBeInTheDocument();
    });

    it('reports an already-selected category and reopens its collapsed group', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, vendorSelectedCategories: ['Cables'] } }),
      });
      await renderPage();
      expect(screen.getByRole('checkbox', { name: /Cables/ })).toBeChecked();

      fireEvent.click(firstRowChevron());
      expect(screen.queryByRole('checkbox', { name: /Cables/ })).not.toBeInTheDocument();

      addCustomCategory('CABLES');

      expect(showToast).toHaveBeenCalledWith(
        'Category Already Selected',
        `"Cables" under "${ELECTRICAL}" is already selected.`,
        'info'
      );
      expect(screen.getByRole('checkbox', { name: /Cables/ })).toBeChecked();
      expect(customCategoryInput()).toHaveValue('');
    });

    it('refuses an existing category once ten categories are selected', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, vendorSelectedCategories: TEN_CUSTOM_CATEGORIES } }),
      });
      await renderPage();
      expect(screen.getByText('10 / 10 Categories Selected')).toBeInTheDocument();

      addCustomCategory('Motors');

      expect(showToast).toHaveBeenCalledWith(
        'Maximum 10 Categories Reached',
        'You have selected 10/10 categories. Please uncheck a category to select "Motors".',
        'warning'
      );
      expect(screen.queryByRole('button', { name: `${REMOVE_CHIP}: Motors` })).not.toBeInTheDocument();
      expect(customCategoryInput()).toHaveValue('Motors');
    });

    it('refuses a brand-new category once ten categories are selected', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, vendorSelectedCategories: TEN_CUSTOM_CATEGORIES } }),
      });
      await renderPage();

      addCustomCategory('Zyx Widgets');

      expect(showToast).toHaveBeenCalledWith(
        'Maximum 10 Categories Reached',
        'You have selected 10/10 categories. Please uncheck a category to add "Zyx Widgets".',
        'warning'
      );
      expect(screen.queryByRole('button', { name: `${REMOVE_CHIP}: Zyx Widgets` })).not.toBeInTheDocument();
      expect(customCategoryInput()).toHaveValue('Zyx Widgets');
    });
  });

  describe('category selection', () => {
    it('adds a minor category to a group that is already selected', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, vendorSelectedCategories: ['Cables'] } }),
      });
      await renderPage();

      fireEvent.click(screen.getByRole('checkbox', { name: /Motors/ }));

      expect(screen.getByRole('checkbox', { name: /Motors/ })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /Cables/ })).toBeChecked();
      expect(chipRemoveButton('Motors')).toBeInTheDocument();
      expect(screen.getByText('2 / 10 Selected')).toBeInTheDocument();
    });

    it('expands and collapses a category group from its chevron', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();
      expect(screen.queryByRole('checkbox', { name: /Cables/ })).not.toBeInTheDocument();

      fireEvent.click(firstRowChevron());
      expect(screen.getByRole('checkbox', { name: /Cables/ })).toBeInTheDocument();

      fireEvent.click(firstRowChevron());
      expect(screen.queryByRole('checkbox', { name: /Cables/ })).not.toBeInTheDocument();
    });

    it('drops a group from the saved profile when its last chip is removed', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({
          success: true,
          data: { ...VENDOR_RECORD, vendorSelectedCategories: ['Bearings & Accessories', 'Cables', 'Motors'] },
        }),
      });
      await renderPage();
      expect(screen.getAllByRole('button', { name: new RegExp(`^${REMOVE_CHIP}:`) })).toHaveLength(3);

      fireEvent.click(chipRemoveButton('Bearings & Accessories'));

      expect(screen.queryByRole('button', { name: `${REMOVE_CHIP}: Bearings & Accessories` })).not.toBeInTheDocument();
      expect(screen.getByText('2 / 10 Selected')).toBeInTheDocument();

      await saveProfile();

      const [profileUpdate] = requestsMatching('PUT', /\/api\/vendors\/v-100$/);
      expect(profileUpdate.body).toEqual(
        expect.objectContaining({ majorCategory: ELECTRICAL, minorCategories: ['Cables', 'Motors'] })
      );
    });

    it.each<[string, MajorMinorCategory[], string[]]>([
      [
        'merges custom categories into an Other group that already lists minors',
        [...ELECTRICAL_ONLY, { majorCategory: OTHER_GROUP, minorCategories: ['Miscellaneous'] }],
        ['Miscellaneous'],
      ],
      [
        'builds the Other group when the taxonomy lists it without minors',
        [...ELECTRICAL_ONLY, { majorCategory: OTHER_GROUP } as unknown as MajorMinorCategory],
        [],
      ],
    ])('%s', async (_scenario, taxonomy, otherUntickedMinors) => {
      useAppState({ categoryTaxonomy: taxonomy });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, vendorSelectedCategories: ['Zyx Widgets'] } }),
      });

      await renderPage();

      expect(screen.getAllByRole('heading', { level: 3, name: OTHER_GROUP })).toHaveLength(1);
      expect(screen.getByRole('checkbox', { name: /Zyx Widgets/ })).toBeChecked();
      otherUntickedMinors.forEach((minor) => {
        expect(screen.getByRole('checkbox', { name: new RegExp(minor) })).not.toBeChecked();
      });
    });

    it('files a brand-new category under Other even when the taxonomy lists Other without minors', async () => {
      useAppState({
        categoryTaxonomy: [...ELECTRICAL_ONLY, { majorCategory: OTHER_GROUP } as unknown as MajorMinorCategory],
      });
      await renderPage();

      addCustomCategory('Quill Pens');

      expect(showToast).toHaveBeenCalledWith(
        'Added to Other',
        `"Quill Pens" has been added under ${OTHER_GROUP} and selected for your profile.`,
        'success'
      );
      expect(chipRemoveButton('Quill Pens')).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /Quill Pens/ })).toBeChecked();
    });

    it.each<[string, string | null, string]>([
      [
        'the load error when the taxonomy could not be loaded',
        'Category master could not be loaded.',
        'Category master could not be loaded.',
      ],
      ['the empty-taxonomy notice when there is no load error', null, UI_STRINGS.buyerProfile.taxonomyEmpty],
    ])('a search with no matches shows %s', async (_scenario, taxonomyError, expectedMessage) => {
      useAppState({ categoryTaxonomyError: taxonomyError });
      await renderPage();

      fireEvent.change(screen.getByPlaceholderText(/Search supply categories/), {
        target: { value: 'zzz-no-such-category' },
      });

      expect(screen.getByText(expectedMessage)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3, name: 'Civil Works' })).not.toBeInTheDocument();
    });
  });

  describe('saving the profile', () => {
    it('blocks the save with a sign-in prompt when there is no session', async () => {
      useAppState({ currentUserSession: null, categoryTaxonomy: ELECTRICAL_ONLY });
      await renderPage();
      fillRequiredFields();

      await saveProfile();

      expect(showToast).toHaveBeenLastCalledWith(
        'Not Signed In',
        'Your session could not be verified. Please sign in again.',
        'warning'
      );
      // Every field check passed: the session is the only thing that stopped the save.
      expect(showToast).not.toHaveBeenCalledWith('Validation Error', expect.any(String), 'warning');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(addAuditLog).not.toHaveBeenCalled();
    });

    it('blocks the save while the PIN code is invalid and shows the reason', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({ loadProfile: reply({ success: true, data: VENDOR_RECORD }) });
      await renderPage();
      setField(LABEL.pincode, '111111');

      await saveProfile();

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith('Validation Error', 'Invalid or dummy PIN code', 'warning');
      expect(requestsMatching('PUT', /\/api\/vendors\//)).toHaveLength(0);
      expect(addAuditLog).not.toHaveBeenCalled();
    });

    it('saves the profile then its categories, and reports the result to the store', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: VENDOR_RECORD }),
        saveCategories: reply({
          success: true,
          data: { clientMappedCategories: ['Bearings & Accessories', 'Pumps & Accessories'] },
        }),
      });
      await renderPage();

      await saveProfile();

      const [profileUpdate] = requestsMatching('PUT', /\/api\/vendors\/v-100$/);
      expect(profileUpdate.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      });
      expect(profileUpdate.body).toEqual(
        expect.objectContaining({
          name: 'Apex Supplies Pvt Ltd',
          pan: VALID_PAN,
          gst: VALID_GST,
          majorCategory: MECHANICAL,
          minorCategories: ['Bearings & Accessories', 'Cables'],
          location: 'Mumbai, Maharashtra, India',
        })
      );
      const [categoryUpdate] = requestsMatching('PUT', /\/api\/vendors\/v-100\/categories$/);
      expect(categoryUpdate.body).toEqual({
        clientMappedCategories: ['Bearings & Accessories'],
        vendorSelectedCategories: ['Bearings & Accessories', 'Cables'],
      });
      expect(saveVendorProfileCategories).toHaveBeenCalledWith(
        VENDOR_EMAIL,
        ['Bearings & Accessories'],
        ['Bearings & Accessories', 'Cables']
      );
      expect(addAuditLog).toHaveBeenCalledWith(
        'Updated Vendor Supplier Profile & Manufacturing Capabilities for Apex Supplies Pvt Ltd'
      );
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        'Profile Saved',
        'Supplier details and manufacturing categories updated successfully.',
        'success'
      );
      // The server-confirmed client-mapped list replaces the one on screen.
      expect(screen.getByText('Pumps & Accessories')).toBeInTheDocument();
    });

    it('saves without credentials or a store callback and keeps the client-mapped list the server omits', async () => {
      getTokenSpy.mockReturnValue(null);
      useAppState({
        categoryTaxonomy: ELECTRICAL_ONLY,
        saveVendorProfileCategories: undefined,
        clientMappedCategories: ['Pumps & Accessories'],
      });
      installVendorApi({
        loadProfile: reply({ success: true, data: { ...VENDOR_RECORD, clientMappedCategories: [] } }),
        saveCategories: reply({ success: true, data: {} }),
      });
      await renderPage();

      await saveProfile();

      const [profileUpdate] = requestsMatching('PUT', /\/api\/vendors\/v-100$/);
      expect(profileUpdate.headers).toEqual({ 'Content-Type': 'application/json' });
      const [categoryUpdate] = requestsMatching('PUT', /\/categories$/);
      expect(categoryUpdate.body).toEqual({
        clientMappedCategories: ['Pumps & Accessories'],
        vendorSelectedCategories: ['Bearings & Accessories', 'Cables'],
      });
      expect(addAuditLog).toHaveBeenCalledWith(
        'Updated Vendor Supplier Profile & Manufacturing Capabilities for Apex Supplies Pvt Ltd'
      );
      expect(showToast).toHaveBeenCalledWith(
        'Profile Saved',
        'Supplier details and manufacturing categories updated successfully.',
        'success'
      );
      expect(screen.getByText('Pumps & Accessories')).toBeInTheDocument();
    });

    it('reports a generic failure when updating the profile is rejected without a reason', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: VENDOR_RECORD }),
        updateProfile: reply({ success: false }, false, 500),
      });
      await renderPage();

      await saveProfile();

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith('Save Failed', 'Failed to save profile.', 'warning');
      expect(requestsMatching('PUT', /\/categories$/)).toHaveLength(0);
      expect(addAuditLog).not.toHaveBeenCalled();
      expect(saveButton()).toBeEnabled();
    });

    it('reports a generic failure when saving the categories is rejected without a reason', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: VENDOR_RECORD }),
        saveCategories: reply({ success: false }, false, 500),
      });
      await renderPage();

      await saveProfile();

      expect(requestsMatching('PUT', /\/api\/vendors\/v-100$/)).toHaveLength(1);
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith('Save Failed', 'Failed to save category taxonomy.', 'warning');
      expect(saveVendorProfileCategories).not.toHaveBeenCalled();
      expect(addAuditLog).not.toHaveBeenCalled();
    });

    it('reports a generic failure when the request fails without an error message', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({
        loadProfile: reply({ success: true, data: VENDOR_RECORD }),
        updateProfile: rejectWith(undefined),
      });
      await renderPage();

      await saveProfile();

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        'Save Failed',
        'Could not save the supplier profile. Please try again.',
        'warning'
      );
      expect(addAuditLog).not.toHaveBeenCalled();
      expect(saveButton()).toBeEnabled();
    });

    it('reports a generic failure when creating a new vendor record is rejected without a reason', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({ createProfile: reply({ success: false }, false, 500) });
      await renderPage();
      fillRequiredFields();

      await saveProfile();

      expect(requestsMatching('POST', /^\/api\/vendors$/)).toHaveLength(1);
      expect(showToast).toHaveBeenLastCalledWith('Save Failed', 'Failed to create vendor profile.', 'warning');
      expect(requestsMatching('PUT', /\/categories$/)).toHaveLength(0);
    });

    it('creates the vendor record, saves its categories under the new id and updates that record next time', async () => {
      useAppState({ categoryTaxonomy: ELECTRICAL_ONLY });
      installVendorApi({ createProfile: reply({ success: true, data: { id: 'v-new-7' } }) });
      await renderPage();
      fillRequiredFields();

      await saveProfile();

      const [creation] = requestsMatching('POST', /^\/api\/vendors$/);
      expect(creation.body).toEqual(
        expect.objectContaining({ name: 'Apex Supplies Pvt Ltd', pan: VALID_PAN, gst: VALID_GST })
      );
      expect(requestsMatching('PUT', /\/api\/vendors\/v-new-7\/categories$/)).toHaveLength(1);
      expect(showToast).toHaveBeenLastCalledWith(
        'Profile Saved',
        'Supplier details and manufacturing categories updated successfully.',
        'success'
      );

      await saveProfile();

      expect(requestsMatching('PUT', /\/api\/vendors\/v-new-7$/)).toHaveLength(1);
      expect(requestsMatching('POST', /^\/api\/vendors$/)).toHaveLength(1);
    });
  });
});
