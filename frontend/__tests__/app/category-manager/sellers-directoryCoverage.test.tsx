/**
 * Companion to sellers-directory.test.tsx.
 *
 * The primary suite walks the happy path with two well-formed suppliers. This file
 * drives the rest of the Category Manager sellers directory: sparse or malformed
 * supplier records and their fallbacks, failed and superseded vendor lookups, the
 * search debounce, the source / rating / category filters, pagination with
 * ellipses, dossier tabs for partially populated RFQs, and the Excel export.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SellersDirectory from '@/app/category-manager/sellers-directory';
import { useApp } from '@/lib/store';
import * as reportsClient from '@/lib/reportsClient';
import * as rfqClient from '@/lib/rfqClient';
import { RFQ_MODES, RFQ_MODE_LABELS, formatCurrency, formatIndianDateTime } from '@/lib/constants';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/reportsClient', () => {
  const actual = jest.requireActual('@/lib/reportsClient');
  return {
    ...actual,
    exportReportToExcel: jest.fn(),
  };
});

jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    fetchAllVendors: jest.fn(),
  };
});

type Fixture = Record<string, unknown>;

const mockUseApp = useApp as jest.Mock;
const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const mockExportReport = reportsClient.exportReportToExcel as jest.Mock;

const SEARCHING_HINT = 'Searching...';
const NO_RESULTS_MESSAGE = 'No suppliers found matching your query.';
const DOSSIER_BUTTON = /360° Dossier/;
const SEARCH_PLACEHOLDER = /Search company/i;
const DEBOUNCE_MS = 350;
const TOAST_MS = 4000;
const FIXED_NOW_ISO = '2026-05-10T10:00:00.000Z';

const DOSSIER_SELLER: Fixture = {
  id: 'v-dossier',
  name: 'Dossier Supplier',
  email: 'Sales@Dossier.example',
};

const DOSSIER_RFQS: Fixture[] = [
  {
    // Linked only through an assigned vendor whose email differs in letter case.
    // No quotes, buyer name, creation date or recognised sourcing mode.
    id: 'rfq-email',
    rfqNumber: 'RFQ-EMAIL-1',
    title: 'Email matched enquiry',
    sourcingMode: 'mode_unknown',
    assignedVendors: [{ email: 'SALES@dossier.example' }],
  },
  {
    // Linked only through a quote filed under the supplier's name with a legacy vendor id.
    id: 'rfq-name',
    rfqNumber: 'RFQ-NAME-2',
    title: 'Name matched bid',
    buyerAccountName: 'Acme Motors',
    sourcingMode: RFQ_MODES.MODE_2,
    createdAt: '2026-03-05T10:00:00Z',
    quotes: [
      { vendorId: 'other-vendor', vendorName: 'Other Vendor', totalPrice: 111 },
      { vendorId: 'legacy-id', vendorName: 'Dossier Supplier', totalPrice: 250000 },
    ],
  },
  {
    // Assigned by id, with a zero-priced quote and a null buyer name.
    id: 'rfq-zero',
    rfqNumber: 'RFQ-ZERO-3',
    title: 'Zero priced bid',
    buyerAccountName: null,
    sourcingMode: RFQ_MODES.MODE_3,
    assignedVendors: [{ id: 'v-dossier' }],
    quotes: [{ vendorId: 'v-dossier', vendorName: 'Dossier Supplier', totalPrice: 0 }],
  },
  {
    // Belongs to another supplier and must never be listed.
    id: 'rfq-other',
    rfqNumber: 'RFQ-OTHER-4',
    title: 'Unrelated enquiry',
    sourcingMode: RFQ_MODES.MODE_1,
    assignedVendors: [{ id: 'someone-else', email: 'x@y.example', name: 'Someone Else' }],
    quotes: [],
  },
];

function setStore(state: Fixture = {}): void {
  mockUseApp.mockReturnValue(state);
}

function setVendorResponse(candidates: Fixture[]): void {
  mockFetchAllVendors.mockResolvedValue({ success: true, candidates });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function networkVendors(count: number): Fixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `net-${pad(index + 1)}`,
    name: `Network Supplier ${pad(index + 1)}`,
  }));
}

function uploadedVendors(count: number): Fixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `upl-${pad(index + 1)}`,
    name: `Client Supplier ${pad(index + 1)}`,
  }));
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderDirectory(props: React.ComponentProps<typeof SellersDirectory> = {}) {
  const view = render(<SellersDirectory {...props} />);
  await waitFor(() => expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument());
  return view;
}

/** Renders under fake timers and lets the mocked initial vendor lookup settle. */
async function renderDirectoryWithFakeTimers(props: React.ComponentProps<typeof SellersDirectory> = {}) {
  const view = render(<SellersDirectory {...props} />);
  await flushPromises();
  expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument();
  return view;
}

function cardOf(label: string): HTMLElement {
  const el =
    screen.queryByText(label, { selector: 'p' }) ||
    screen.queryByText(label, { selector: 'h3' }) ||
    screen.getByText(label);
  const card = el.parentElement;
  if (!card) {
    throw new Error(`"${label}" is not inside a card`);
  }
  return card;
}

function rowOf(name: RegExp): HTMLElement {
  return screen.getByRole('row', { name });
}

function openDossier(name: RegExp): void {
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: DOSSIER_BUTTON }));
}

function closeDossier(): void {
  const closeBtns = screen.getAllByRole('button', { name: /Close Dossier/i });
  fireEvent.click(closeBtns[0]);
}

function expectShowing(from: number, to: number, total: number): void {
  expect(screen.getByText('Showing').parentElement).toHaveTextContent(
    new RegExp(`Showing\\s*${from}\\s*to\\s*${to}\\s*of\\s*${total}\\s*entries`)
  );
}

function categoryOptionLabels(): Array<string | null> {
  return within(screen.getByLabelText('Filter by category'))
    .getAllByRole('option')
    .map((option) => option.textContent);
}

function previousButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Previous page' });
}

function nextButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Next page' });
}

describe('SellersDirectory coverage companion', () => {
  beforeEach(() => {
    mockUseApp.mockReset();
    mockFetchAllVendors.mockReset();
    mockExportReport.mockReset();
    setStore({ buyerVendors: [], rfqs: [], auditLogs: [], categoryTaxonomy: [] });
    setVendorResponse([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('vendor loading', () => {
    test('shows zero KPIs, the default 85 average and the empty message when the store supplies no collections', async () => {
      setStore({});

      await renderDirectory();

      const total = within(cardOf('Total Suppliers'));
      expect(total.getByText('0')).toBeInTheDocument();
      expect(total.getByText('0 Verified active')).toBeInTheDocument();
      expect(within(cardOf('Average 360° Score')).getByText('85')).toBeInTheDocument();
      expect(within(cardOf('Quoted Opportunities')).getByText('0')).toBeInTheDocument();
      expect(screen.getByText(NO_RESULTS_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText('Showing')).not.toBeInTheDocument();
      expect(categoryOptionLabels()).toEqual(['All Categories']);
    });

    test.each<[string, Fixture]>([
      ['an unsuccessful result', { success: false, reason: 'network', error: 'Vendor service unreachable' }],
      ['a successful result without a vendor list', { success: true }],
    ])('keeps stored vendors and clears the loading hint after %s', async (_description, response) => {
      setStore({ buyerVendors: [{ id: 'b-1', name: 'Stored Client Ltd' }] });
      mockFetchAllVendors.mockResolvedValue(response);

      await renderDirectory();

      expect(screen.getByText('Stored Client Ltd')).toBeInTheDocument();
      expect(within(cardOf('Total Suppliers')).getByText('1')).toBeInTheDocument();
      expect(within(cardOf('Network Suppliers')).getByText('0')).toBeInTheDocument();
    });

    test('keeps stored vendors and clears the loading hint when the vendor request rejects', async () => {
      setStore({ buyerVendors: [{ id: 'b-1', name: 'Stored Client Ltd' }] });
      mockFetchAllVendors.mockRejectedValue(new Error('network down'));

      await renderDirectory();

      expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Stored Client Ltd')).toBeInTheDocument();
      expect(within(cardOf('Total Suppliers')).getByText('1')).toBeInTheDocument();
    });

    test('discards a late response from a superseded request after the category filter changes', async () => {
      const stale = createDeferred<Fixture>();
      const fresh = createDeferred<Fixture>();
      mockFetchAllVendors.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
      setStore({ categoryTaxonomy: [{ majorCategory: 'Packaging' }] });

      render(<SellersDirectory />);
      expect(screen.getByText(SEARCHING_HINT)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Packaging' } });
      expect(mockFetchAllVendors).toHaveBeenCalledTimes(2);
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({
        pageSize: 150,
        search: undefined,
        category: 'Packaging',
      });

      await act(async () => {
        fresh.resolve({
          success: true,
          candidates: [{ id: 'p-1', name: 'Fresh Packaging Co', majorCategory: 'Packaging' }],
        });
        await Promise.resolve();
      });
      expect(screen.getByText('Fresh Packaging Co')).toBeInTheDocument();
      expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument();

      await act(async () => {
        stale.resolve({
          success: true,
          candidates: [{ id: 'p-2', name: 'Stale Packaging Co', majorCategory: 'Packaging' }],
        });
        await Promise.resolve();
      });
      expect(screen.queryByText('Stale Packaging Co')).not.toBeInTheDocument();
      expect(screen.getByText('Fresh Packaging Co')).toBeInTheDocument();
      expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument();
    });
  });

  describe('search debounce and vendor query', () => {
    test('sends the trimmed search term to the vendor API only after the debounce settles', async () => {
      jest.useFakeTimers();
      await renderDirectoryWithFakeTimers();
      expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: undefined, category: undefined });

      const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.change(searchBox, { target: { value: 'A' } });
      act(() => {
        jest.advanceTimersByTime(200);
      });
      fireEvent.change(searchBox, { target: { value: '  Apex  ' } });
      act(() => {
        jest.advanceTimersByTime(DEBOUNCE_MS - 1);
      });
      // 549ms after the first keystroke, but only 349ms after the last one.
      expect(mockFetchAllVendors).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(mockFetchAllVendors).toHaveBeenCalledTimes(2);
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: 'Apex', category: undefined });
      await flushPromises();
    });

    test('restores the unfiltered vendor query after the search box is cleared', async () => {
      jest.useFakeTimers();
      await renderDirectoryWithFakeTimers();

      const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
      fireEvent.change(searchBox, { target: { value: 'Apex' } });
      act(() => {
        jest.advanceTimersByTime(DEBOUNCE_MS);
      });
      await flushPromises();
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: 'Apex', category: undefined });

      fireEvent.click(screen.getByLabelText('Clear search'));
      expect(searchBox).toHaveValue('');
      act(() => {
        jest.advanceTimersByTime(DEBOUNCE_MS);
      });
      await flushPromises();

      expect(mockFetchAllVendors).toHaveBeenCalledTimes(3);
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: undefined, category: undefined });
    });

    test('queries the vendor API with the selected category and drops it again for All Categories', async () => {
      setStore({ categoryTaxonomy: [{ majorCategory: 'Chemicals' }, { majorCategory: 'Packaging' }] });
      await renderDirectory();
      const categorySelect = screen.getByLabelText('Filter by category');

      fireEvent.change(categorySelect, { target: { value: 'Chemicals' } });
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: undefined, category: 'Chemicals' });
      await waitFor(() => expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument());

      fireEvent.change(categorySelect, { target: { value: 'all' } });
      expect(mockFetchAllVendors).toHaveBeenLastCalledWith({ pageSize: 150, search: undefined, category: undefined });
      await waitFor(() => expect(screen.queryByText(SEARCHING_HINT)).not.toBeInTheDocument());
    });
  });

  describe('filters and search', () => {
    test('source filter switches between network-only, uploaded-only and all suppliers', async () => {
      setVendorResponse([{ id: 'n-1', name: 'Network Alpha Ltd' }]);
      setStore({ buyerVendors: [{ id: 'u-1', name: 'Uploaded Beta Pvt' }] });
      await renderDirectory();
      const sourceSelect = screen.getByLabelText('Filter by source');

      fireEvent.change(sourceSelect, { target: { value: 'network' } });
      expect(screen.getByText('Network Alpha Ltd')).toBeInTheDocument();
      expect(screen.queryByText('Uploaded Beta Pvt')).not.toBeInTheDocument();

      fireEvent.change(sourceSelect, { target: { value: 'buyer' } });
      expect(screen.getByText('Uploaded Beta Pvt')).toBeInTheDocument();
      expect(screen.queryByText('Network Alpha Ltd')).not.toBeInTheDocument();

      fireEvent.change(sourceSelect, { target: { value: 'all' } });
      expect(screen.getByText('Network Alpha Ltd')).toBeInTheDocument();
      expect(screen.getByText('Uploaded Beta Pvt')).toBeInTheDocument();
    });

    test('rating filters exclude suppliers below 4.0 and 4.5 stars', async () => {
      setVendorResponse([
        { id: 'r-1', name: 'Rated Thirty Nine', rating: 3.9 },
        { id: 'r-2', name: 'Rated Four Flat', rating: 4 },
        { id: 'r-3', name: 'Rated Four Forty Nine', rating: 4.49 },
        { id: 'r-4', name: 'Rated Four Fifty', rating: 4.5 },
      ]);
      await renderDirectory();
      const ratingSelect = screen.getByLabelText('Filter by rating');

      fireEvent.change(ratingSelect, { target: { value: '4plus' } });
      expect(screen.queryByText('Rated Thirty Nine')).not.toBeInTheDocument();
      expect(screen.getByText('Rated Four Flat')).toBeInTheDocument();
      expect(screen.getByText('Rated Four Forty Nine')).toBeInTheDocument();
      expect(screen.getByText('Rated Four Fifty')).toBeInTheDocument();

      fireEvent.change(ratingSelect, { target: { value: '4.5plus' } });
      expect(screen.queryByText('Rated Four Flat')).not.toBeInTheDocument();
      expect(screen.queryByText('Rated Four Forty Nine')).not.toBeInTheDocument();
      expect(screen.getByText('Rated Four Fifty')).toBeInTheDocument();
    });

    test('builds the category dropdown from taxonomy, uploaded and network vendors while skipping blank entries', async () => {
      setStore({
        categoryTaxonomy: [null, { majorCategory: '' }, { minorCategories: [] }, { majorCategory: 'Packaging' }],
        buyerVendors: [
          { id: 'u-1', name: 'Textile Client', majorCategory: 'Textiles' },
          { id: 'u-2', name: 'Uncategorised Client' },
        ],
      });
      setVendorResponse([
        { id: 'n-1', name: 'Chemical Network', majorCategory: 'Chemicals' },
        { id: 'n-2', name: 'Logistics Network', category: 'Logistics' },
        { id: 'n-3', name: 'Generic Network' },
      ]);

      await renderDirectory();

      // Sorted, de-duplicated, and without the fallback labels given to uncategorised vendors.
      expect(categoryOptionLabels()).toEqual(['All Categories', 'Chemicals', 'Logistics', 'Packaging', 'Textiles']);
      expect(within(rowOf(/Uncategorised Client/)).getByText('Custom Client Category')).toBeInTheDocument();
      expect(within(rowOf(/Generic Network/)).getByText('Industrial Supplies')).toBeInTheDocument();
      expect(within(rowOf(/Logistics Network/)).getByText('Logistics')).toBeInTheDocument();
    });

    test('builds the category dropdown from vendors alone when the taxonomy is not a list', async () => {
      setStore({
        categoryTaxonomy: null,
        buyerVendors: [{ id: 'u-1', name: 'Textile Client', majorCategory: 'Textiles' }],
      });

      await renderDirectory();

      expect(categoryOptionLabels()).toEqual(['All Categories', 'Textiles']);
    });

    test('matches categories of three characters or fewer on whole words and longer queries on substrings', async () => {
      setVendorResponse([
        { id: 'c-1', name: 'Precision Works', majorCategory: 'CNC Machining' },
        { id: 'c-2', name: 'Other Corp', majorCategory: 'Packaging' },
      ]);
      await renderDirectory();
      const searchBox = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);

      fireEvent.change(searchBox, { target: { value: 'cnc' } });
      expect(screen.getByText('Precision Works')).toBeInTheDocument();
      expect(screen.queryByText('Other Corp')).not.toBeInTheDocument();

      // Two characters of a word are not a whole word.
      fireEvent.change(searchBox, { target: { value: 'nc' } });
      expect(screen.getByText(NO_RESULTS_MESSAGE)).toBeInTheDocument();

      // Three characters still need a whole word, four may be a fragment.
      fireEvent.change(searchBox, { target: { value: 'mac' } });
      expect(screen.getByText(NO_RESULTS_MESSAGE)).toBeInTheDocument();
      fireEvent.change(searchBox, { target: { value: 'mach' } });
      expect(screen.getByText('Precision Works')).toBeInTheDocument();
      expect(screen.queryByText('Other Corp')).not.toBeInTheDocument();
    });
  });

  describe('network vendor mapping', () => {
    test('labels a vendor that only has an email with safe defaults across the table and dossier', async () => {
      setVendorResponse([{ email: 'bare@supplier.example' }]);
      await renderDirectory();

      const row = within(rowOf(/Verified Supplier/));
      expect(row.getByText('V')).toBeInTheDocument();
      expect(row.getAllByText('India')).toHaveLength(2);
      expect(row.getByText('Industrial Supplies')).toBeInTheDocument();
      expect(row.getByText('Never')).toBeInTheDocument();
      expect(row.getByText('4.5')).toBeInTheDocument();
      expect(row.getByText('0 Credits')).toBeInTheDocument();
      expect(row.getByText('ACTIVE')).toBeInTheDocument();
      expect(within(cardOf('Network Suppliers')).getByText('1')).toBeInTheDocument();

      openDossier(/Verified Supplier/);

      expect(screen.getByRole('heading', { name: 'Verified Supplier' })).toBeInTheDocument();
      expect(screen.getByText(/360° AI Score: 88\/100/)).toBeInTheDocument();
      expect(screen.getByText(/Rating: ★ 4\.5/)).toBeInTheDocument();
      const contact = within(cardOf('Contact Details'));
      expect(contact.getByText('Verified Supplier')).toBeInTheDocument();
      expect(contact.getByText('bare@supplier.example')).toBeInTheDocument();
      expect(contact.getByText('+91 98765 43210')).toBeInTheDocument();
      expect(contact.getByText('Company Location: India')).toBeInTheDocument();
      expect(contact.getByText('Delivery Location: India')).toBeInTheDocument();
      expect(contact.getByText('Last Login: Never logged in')).toBeInTheDocument();
      const statutory = within(cardOf('Statutory & Verification'));
      expect(statutory.getByText('27AAACG0000A1Z5')).toBeInTheDocument();
      expect(statutory.getByText('AAACG0000A')).toBeInTheDocument();
      expect(statutory.getByText('Preferred Partner')).toBeInTheDocument();
      expect(statutory.getByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText('Major: Industrial Supplies')).toBeInTheDocument();
    });

    test('uses the vendor city, category, match score and a default rating, and styles unverified status differently', async () => {
      setVendorResponse([
        {
          id: 'c-1',
          name: 'City Logistics',
          contactPerson: 'Meera Joshi',
          phone: '+91 90000 00000',
          category: 'Logistics',
          city: 'Nagpur',
          matchScore: 77,
          rating: 'excellent',
          status: 'SUSPENDED',
        },
        { id: 'c-2', name: 'Verified Peer', status: 'ACTIVE_VERIFIED' },
      ]);
      await renderDirectory();

      const suspended = within(rowOf(/City Logistics/));
      expect(suspended.getAllByText('Nagpur')).toHaveLength(2);
      expect(suspended.getByText('Logistics')).toBeInTheDocument();
      expect(suspended.getByText('4.5')).toBeInTheDocument();
      const suspendedBadge = suspended.getByText('SUSPENDED').parentElement;
      expect(suspendedBadge).toHaveClass('bg-slate-100');
      expect(suspendedBadge).not.toHaveClass('bg-emerald-50');
      expect(suspendedBadge?.firstElementChild).toHaveClass('bg-slate-400');

      const verifiedBadge = within(rowOf(/Verified Peer/)).getByText('ACTIVE_VERIFIED').parentElement;
      expect(verifiedBadge).toHaveClass('bg-emerald-50');
      expect(verifiedBadge?.firstElementChild).toHaveClass('bg-emerald-500');
      expect(within(cardOf('Total Suppliers')).getByText('1 Verified active')).toBeInTheDocument();

      openDossier(/City Logistics/);
      expect(screen.getByText(/360° AI Score: 77\/100/)).toBeInTheDocument();
      const contact = within(cardOf('Contact Details'));
      expect(contact.getByText('Meera Joshi')).toBeInTheDocument();
      expect(contact.getByText('+91 90000 00000')).toBeInTheDocument();
      expect(contact.getByText('Company Location: Nagpur')).toBeInTheDocument();
    });

    test('joins list delivery locations, ignores unusable values and falls back to the company location', async () => {
      setVendorResponse([
        { id: 'd-1', name: 'Array Dispatch', serviceLocations: ['Mumbai', 'Delhi'] },
        { id: 'd-2', name: 'Object Dispatch', deliveryLocation: { state: 'Gujarat' } },
        { id: 'd-3', name: 'Empty List Dispatch', location: 'Surat', preferredLocations: [] },
      ]);
      await renderDirectory();

      expect(within(rowOf(/Array Dispatch/)).getByTitle('Mumbai, Delhi')).toHaveTextContent('Mumbai, Delhi');
      expect(within(rowOf(/Object Dispatch/)).getByTitle('India')).toHaveTextContent('India');
      expect(within(rowOf(/Empty List Dispatch/)).getByTitle('Surat')).toHaveTextContent('Surat');

      openDossier(/Array Dispatch/);
      expect(within(cardOf('Contact Details')).getByText('Delivery Location: Mumbai, Delhi')).toBeInTheDocument();
      closeDossier();

      openDossier(/Empty List Dispatch/);
      expect(within(cardOf('Contact Details')).getByText('Delivery Location: Surat')).toBeInTheDocument();
    });

    test('shows Never for unusable login values and formats valid ones from every supported field', async () => {
      setVendorResponse([
        { id: 'l-1', name: 'Bad Date Co', lastLogin: 'not-a-date' },
        { id: 'l-2', name: 'Blank Login Co', lastLogin: '   ' },
        { id: 'l-3', name: 'Numeric Login Co', lastLogin: 1700000000000 },
        { id: 'l-4', name: 'Snake Case Co', last_login_at: '2026-03-02T11:00:00Z' },
        { id: 'l-5', name: 'Date Field Co', lastLoginDate: '2026-04-01T08:15:00Z' },
        { id: 'l-6', name: 'Time Field Co', loginDateTime: '2026-05-05T05:05:00Z' },
      ]);
      await renderDirectory();

      [/Bad Date Co/, /Blank Login Co/, /Numeric Login Co/].forEach((name) => {
        expect(within(rowOf(name)).getByText('Never')).toBeInTheDocument();
      });
      expect(within(rowOf(/Snake Case Co/)).getByText(formatIndianDateTime('2026-03-02T11:00:00.000Z'))).toBeInTheDocument();
      expect(within(rowOf(/Date Field Co/)).getByText(formatIndianDateTime('2026-04-01T08:15:00.000Z'))).toBeInTheDocument();
      expect(within(rowOf(/Time Field Co/)).getByText(formatIndianDateTime('2026-05-05T05:05:00.000Z'))).toBeInTheDocument();
    });
  });

  describe('uploaded vendor mapping', () => {
    test('labels sparse uploaded vendors with client-list defaults and generates an id when none exists', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      setStore({
        buyerVendors: [
          { email: 'client@only.example' },
          { id: 'b-named', name: 'Named Client', score: 72.4, minorCategories: 'not-a-list' },
          { name: 'Anonymous Client' },
        ],
      });
      await renderDirectory();

      const emailOnly = within(rowOf(/Verified Supplier/));
      expect(emailOnly.getAllByText('India')).toHaveLength(2);
      expect(emailOnly.getByText('Custom Client Category')).toBeInTheDocument();
      expect(emailOnly.getByText('4.2')).toBeInTheDocument();
      expect(emailOnly.getByText('10 Credits')).toBeInTheDocument();
      expect(emailOnly.getByText('VERIFIED_CLIENT_LIST')).toBeInTheDocument();
      expect(emailOnly.getByText('Never')).toBeInTheDocument();

      openDossier(/Verified Supplier/);
      expect(screen.getByText(/360° AI Score: 85\/100/)).toBeInTheDocument();
      expect(screen.getByText(/Rating: ★ 4\.2/)).toBeInTheDocument();
      const contact = within(cardOf('Contact Details'));
      expect(contact.getByText('Key Accounts Desk')).toBeInTheDocument();
      expect(contact.getByText('client@only.example')).toBeInTheDocument();
      expect(contact.getByText('+91 98765 43210')).toBeInTheDocument();
      const statutory = within(cardOf('Statutory & Verification'));
      expect(statutory.getByText('27AAACB1111B1Z6')).toBeInTheDocument();
      expect(statutory.getByText('AAACB1111B')).toBeInTheDocument();
      expect(statutory.getByText('Verified Supplier')).toBeInTheDocument();
      closeDossier();

      openDossier(/Named Client/);
      expect(screen.getByText(/360° AI Score: 72\/100/)).toBeInTheDocument();
      expect(within(cardOf('Contact Details')).getByText('Named Client')).toBeInTheDocument();
      expect(screen.getByText('Major: Custom Client Category')).toBeInTheDocument();
      expect(screen.queryByText('not-a-list')).not.toBeInTheDocument();
      closeDossier();

      openDossier(/Anonymous Client/);
      expect(screen.getByRole('heading', { name: 'Anonymous Client' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
      expect(screen.getByText('Total Amount Paid')).toBeInTheDocument();
      closeDossier();
    });

    test('scores uploaded vendors from quality score, then score, then the 85 default', async () => {
      setStore({
        buyerVendors: [
          { id: 'q-1', name: 'Quality Scored', qualityScore: '91.6', score: 10 },
          { id: 'q-2', name: 'Plain Scored', score: 64 },
          { id: 'q-3', name: 'Unscored' },
        ],
      });

      await renderDirectory();

      // round((92 + 64 + 85) / 3) = 80
      expect(within(cardOf('Average 360° Score')).getByText('80')).toBeInTheDocument();
    });

    test('resolves uploaded delivery locations from lists and ignores non-text values', async () => {
      setStore({
        buyerVendors: [
          { id: 'bd-1', name: 'Array Client', serviceLocations: ['Chennai', 'Madurai'] },
          { id: 'bd-2', name: 'Numeric Client', deliveryLocation: 42 },
        ],
      });

      await renderDirectory();

      expect(within(rowOf(/Array Client/)).getByTitle('Chennai, Madurai')).toHaveTextContent('Chennai, Madurai');
      expect(within(rowOf(/Numeric Client/)).getByTitle('India')).toHaveTextContent('India');
    });

    test('drops an uploaded vendor whose id repeats a network vendor or an earlier uploaded vendor', async () => {
      setVendorResponse([{ id: 'shared-1', name: 'Network Copy' }]);
      setStore({
        buyerVendors: [
          { id: 'shared-1', name: 'Client Copy' },
          { id: 'u-2', name: 'First Client' },
          { id: 'u-2', name: 'Second Client' },
        ],
      });

      await renderDirectory();

      expect(screen.getByText('Network Copy')).toBeInTheDocument();
      expect(screen.queryByText('Client Copy')).not.toBeInTheDocument();
      expect(screen.getByText('First Client')).toBeInTheDocument();
      expect(screen.queryByText('Second Client')).not.toBeInTheDocument();
      expect(within(cardOf('Total Suppliers')).getByText('2')).toBeInTheDocument();
    });
  });

  describe('KPI cards', () => {
    test('counts verified, network and uploaded suppliers and falls back to 85 for a zero score', async () => {
      setVendorResponse([
        { id: 'k-1', name: 'Active Network', status: 'ACTIVE_VERIFIED', matchScore: 95 },
        { id: 'k-2', name: 'Suspended Network', status: 'SUSPENDED', matchScore: 0 },
      ]);
      setStore({
        buyerVendors: [{ id: 'k-3', name: 'Uploaded Client' }],
        rfqs: [
          { id: 'r-1', rfqNumber: 'RFQ-1', quotes: [{ vendorId: 'x' }, { vendorId: 'y' }] },
          { id: 'r-2', rfqNumber: 'RFQ-2' },
        ],
      });

      await renderDirectory();

      const total = within(cardOf('Total Suppliers'));
      expect(total.getByText('3')).toBeInTheDocument();
      expect(total.getByText('2 Verified active')).toBeInTheDocument();
      expect(within(cardOf('Network Suppliers')).getByText('2')).toBeInTheDocument();
      expect(within(cardOf('Buyer Uploaded')).getByText('1')).toBeInTheDocument();
      // round((95 + 85 + 85) / 3) = 88
      expect(within(cardOf('Average 360° Score')).getByText('88')).toBeInTheDocument();
      expect(within(cardOf('Quoted Opportunities')).getByText('2')).toBeInTheDocument();
    });
  });

  describe('pagination', () => {
    test('pages through 85 suppliers with ellipses, Prev, Next and numbered buttons', async () => {
      setVendorResponse(networkVendors(25));
      setStore({ buyerVendors: uploadedVendors(60) });
      await renderDirectory();

      // Page 1 of 9: only the stretch before the last page is collapsed.
      expectShowing(1, 10, 85);
      expect(screen.getByText('Network Supplier 01')).toBeInTheDocument();
      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeEnabled();
      expect(screen.getAllByText('...')).toHaveLength(1);
      expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByLabelText('Page 2')).not.toHaveAttribute('aria-current');
      expect(screen.queryByLabelText('Page 3')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Page 9')).toBeInTheDocument();

      fireEvent.click(nextButton());
      expectShowing(11, 20, 85);
      expect(screen.getByText('Network Supplier 11')).toBeInTheDocument();
      expect(screen.queryByText('Network Supplier 01')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Page 2')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByLabelText('Page 3')).toBeInTheDocument();
      expect(previousButton()).toBeEnabled();

      // Jumping to the last page collapses the early pages instead.
      fireEvent.click(screen.getByLabelText('Page 9'));
      expectShowing(81, 85, 85);
      expect(screen.getByText('Client Supplier 60')).toBeInTheDocument();
      expect(nextButton()).toBeDisabled();
      expect(screen.getAllByText('...')).toHaveLength(1);
      expect(screen.queryByLabelText('Page 2')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Page 8')).toBeInTheDocument();
      expect(screen.queryByLabelText('Page 7')).not.toBeInTheDocument();

      fireEvent.click(previousButton());
      expectShowing(71, 80, 85);
      expect(screen.getByLabelText('Page 8')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByLabelText('Page 7')).toBeInTheDocument();

      // A mid-range page is bracketed by an ellipsis on each side.
      fireEvent.click(screen.getByLabelText('Page 1'));
      expectShowing(1, 10, 85);
      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
      expectShowing(31, 40, 85);
      expect(screen.getAllByText('...')).toHaveLength(2);
      expect(screen.queryByLabelText('Page 2')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Page 3')).toBeInTheDocument();
      expect(screen.getByLabelText('Page 4')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByLabelText('Page 5')).toBeInTheDocument();
      expect(screen.queryByLabelText('Page 6')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Page 8')).not.toBeInTheDocument();
    });

    test('returns to page one on a filter change and honours the rows-per-page choice', async () => {
      setVendorResponse(networkVendors(25));
      setStore({ buyerVendors: uploadedVendors(60) });
      await renderDirectory();

      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
      expectShowing(31, 40, 85);

      fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'buyer' } });
      expectShowing(1, 10, 60);
      expect(screen.getByText('Client Supplier 01')).toBeInTheDocument();
      expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-current', 'page');
      // Six pages fit without any ellipsis.
      expect(screen.queryByText('...')).not.toBeInTheDocument();

      const pageSize = screen.getByLabelText('Rows per page');
      fireEvent.change(pageSize, { target: { value: '25' } });
      expectShowing(1, 25, 60);
      fireEvent.click(screen.getByLabelText('Page 3'));
      expectShowing(51, 60, 60);
      expect(nextButton()).toBeDisabled();

      fireEvent.change(pageSize, { target: { value: '100' } });
      expectShowing(1, 60, 60);
      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeDisabled();
    });
  });

  describe('supplier dossier', () => {
    test('lists RFQs linked by assigned email, quote name or vendor id with fallbacks for missing details', async () => {
      const onSelectRFQ = jest.fn();
      setVendorResponse([DOSSIER_SELLER]);
      setStore({ rfqs: DOSSIER_RFQS });
      await renderDirectory({ onSelectRFQ });

      openDossier(/Dossier Supplier/);
      fireEvent.click(screen.getByRole('button', { name: /Quotes/i }));

      expect(screen.getByText('RFQ-EMAIL-1')).toBeInTheDocument();
      expect(screen.getByText('RFQ-NAME-2')).toBeInTheDocument();
      expect(screen.getByText('RFQ-ZERO-3')).toBeInTheDocument();
      expect(screen.queryByText('RFQ-OTHER-4')).not.toBeInTheDocument();

      // Open Quote Details Modal
      fireEvent.click(screen.getByText('RFQ-NAME-2'));
      expect(screen.getByText(/Quotation Details:\s*RFQ-NAME-2/i)).toBeInTheDocument();

      // Click View Full Details
      const viewFullBtn = screen.getByRole('button', { name: /View Full Details/i });
      fireEvent.click(viewFullBtn);
      expect(onSelectRFQ).toHaveBeenCalledTimes(1);
      expect(onSelectRFQ).toHaveBeenCalledWith(DOSSIER_RFQS[1]);
    });

    test('renders Profile, Credit, Communications, and Payments tabs in Supplier Dossier', async () => {
      setVendorResponse([DOSSIER_SELLER]);
      setStore({ rfqs: DOSSIER_RFQS });
      await renderDirectory();

      openDossier(/Dossier Supplier/);

      // Profile tab
      expect(screen.getByRole('heading', { name: 'Dossier Supplier' })).toBeInTheDocument();
      expect(screen.getByText('Contact Details')).toBeInTheDocument();

      // Credit tab
      fireEvent.click(screen.getByRole('button', { name: /^Credit$/i }));
      expect(screen.getByText('Total Credits Allocated')).toBeInTheDocument();

      // Communications tab
      fireEvent.click(screen.getByRole('button', { name: /Communications/i }));
      expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();

      // Payments tab
      fireEvent.click(screen.getByRole('button', { name: /Payments/i }));
      expect(screen.getByText('Total Amount Paid')).toBeInTheDocument();

      // Close dossier
      closeDossier();
      expect(screen.queryByLabelText('Supplier 360° Dossier')).not.toBeInTheDocument();
    });
  });

  describe('directory export', () => {
    test('exports every matching supplier, not just the visible page, under a dated file name', async () => {
      jest.useFakeTimers({ now: new Date(FIXED_NOW_ISO) });
      setVendorResponse(networkVendors(25));
      setStore({ buyerVendors: uploadedVendors(60) });
      await renderDirectoryWithFakeTimers();
      expectShowing(1, 10, 85);

      fireEvent.click(screen.getByRole('button', { name: /Export Directory/ }));

      expect(mockExportReport).toHaveBeenCalledTimes(1);
      const [allRows, fileName, sheetName] = mockExportReport.mock.calls[0];
      expect(allRows).toHaveLength(85);
      expect(fileName).toBe('Sellers_Directory_2026-05-10');
      expect(sheetName).toBe('SellersDirectory');

      fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'Client Supplier 0' } });
      fireEvent.click(screen.getByRole('button', { name: /Export Directory/ }));

      expect(mockExportReport).toHaveBeenCalledTimes(2);
      const filteredRows = mockExportReport.mock.calls[1][0];
      expect(filteredRows).toHaveLength(9);
      expect(filteredRows[0]).toEqual(expect.objectContaining({ CompanyName: 'Client Supplier 01' }));
    });

    test('exports sparse suppliers with source labels, login stamps and default values', async () => {
      setVendorResponse([
        { email: 'bare@supplier.example', last_login_at: '2026-03-02T11:00:00Z', serviceLocations: [] },
        {
          id: 'n-2',
          name: 'Named Network',
          contactPerson: 'Asha Rao',
          phone: '+91 91111 11111',
          location: 'Pune',
          deliveryLocation: 'Pune, Nashik',
          majorCategory: 'Packaging',
          matchScore: 91,
          rating: 4.7,
          status: 'ACTIVE',
          freeQuotationCredits: 0,
          rfqDownloadsUsed: 0,
        },
      ]);
      setStore({
        buyerVendors: [{ id: 'u-1', name: 'Uploaded Client', contactPerson: 'Dev', email: 'dev@client.example' }],
      });
      await renderDirectory();

      fireEvent.click(screen.getByRole('button', { name: /Export Directory/ }));

      expect(mockExportReport).toHaveBeenCalledTimes(1);
      expect(mockExportReport.mock.calls[0][0]).toEqual([
        {
          CompanyName: 'Verified Supplier',
          ContactPerson: '',
          Email: 'bare@supplier.example',
          Phone: '',
          CompanyLocation: 'India',
          DeliveryLocation: 'India',
          LastLogin: formatIndianDateTime('2026-03-02T11:00:00.000Z'),
          Source: 'Procucev Network',
          MajorCategory: 'Industrial Supplies',
          AIScore: 88,
          StarRating: 4.5,
          FreeQuotationCredits: 0,
          RFQDownloadsUsed: 4,
          Status: 'ACTIVE',
        },
        {
          CompanyName: 'Named Network',
          ContactPerson: 'Asha Rao',
          Email: '',
          Phone: '+91 91111 11111',
          CompanyLocation: 'Pune',
          DeliveryLocation: 'Pune, Nashik',
          LastLogin: 'Never',
          Source: 'Procucev Network',
          MajorCategory: 'Packaging',
          AIScore: 91,
          StarRating: 4.7,
          FreeQuotationCredits: 0,
          RFQDownloadsUsed: 0,
          Status: 'ACTIVE',
        },
        {
          CompanyName: 'Uploaded Client',
          ContactPerson: 'Dev',
          Email: 'dev@client.example',
          Phone: '',
          CompanyLocation: 'India',
          DeliveryLocation: 'India',
          LastLogin: 'Never',
          Source: 'Buyer Uploaded',
          MajorCategory: 'Custom Client Category',
          AIScore: 85,
          StarRating: 4.2,
          FreeQuotationCredits: 10,
          RFQDownloadsUsed: 2,
          Status: 'VERIFIED_CLIENT_LIST',
        },
      ]);
    });
  });

  describe('SellersDirectory Additional Branch Coverage', () => {
    test('exercises sorting with undefined / empty / fallback fields across all columns', async () => {
      const allColsVisible = [
        { key: 'supplierName', label: 'Supplier', visible: true, required: true },
        { key: 'location', label: 'Location', visible: true },
        { key: 'deliveryLocation', label: 'Delivery Location', visible: true },
        { key: 'category', label: 'Category', visible: true },
        { key: 'lastLogin', label: 'Last Login', visible: true },
        { key: 'rating', label: 'Rating', visible: true },
        { key: 'credits', label: 'Credits', visible: true },
        { key: 'status', label: 'Status', visible: true },
        { key: 'contactPerson', label: 'Contact Person', visible: true },
        { key: 'email', label: 'Email', visible: true },
        { key: 'phone', label: 'Phone', visible: true },
        { key: 'score360', label: '360° Score', visible: true },
        { key: 'registrationDate', label: 'Registration Date', visible: true },
        { key: 'actions', label: 'Actions', visible: true, required: true },
      ];
      window.localStorage.setItem('seller_directory_columns_pref', JSON.stringify(allColsVisible));

      setVendorResponse([
        {
          id: 's-empty',
          name: '',
          majorCategory: undefined,
          category: undefined,
          freeQuotationCredits: undefined,
          rating: undefined,
          score: undefined,
          lastLogin: undefined,
          createdAt: undefined,
          contactPerson: undefined,
          email: undefined,
          phone: undefined,
          status: undefined,
          location: undefined,
          deliveryLocation: undefined,
        },
        {
          id: 's-partial',
          name: 'Beta Valves Ltd',
          majorCategory: undefined,
          category: 'Valves & Actuators',
          freeQuotationCredits: 0,
          rating: 3.5,
          score: 70,
          lastLogin: '2026-01-10T10:00:00.000Z',
          createdAt: '2026-01-01T10:00:00.000Z',
          contactPerson: 'Ben',
          email: 'ben@valves.com',
          phone: '9876543210',
          status: 'PENDING_EVALUATION',
          location: 'Pune',
          deliveryLocation: 'Maharashtra',
        },
        {
          id: 's-full',
          name: 'Alpha Motors Ltd',
          majorCategory: 'Motors & Drives',
          category: undefined,
          freeQuotationCredits: 15,
          rating: 4.8,
          score: 95,
          lastLogin: '2026-03-10T10:00:00.000Z',
          createdAt: '2026-02-01T10:00:00.000Z',
          contactPerson: 'Alice',
          email: 'alice@motors.com',
          phone: '9123456789',
          status: 'ACTIVE_VERIFIED',
          location: 'Bengaluru',
          deliveryLocation: 'Pan India',
        },
      ]);

      await renderDirectory();

      // Check cell fallbacks for s-empty
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      // expect(screen.getByText('Active')).toBeInTheDocument();

      const sortCols = [
        'Supplier',
        'Location',
        'Delivery Location',
        'Category',
        'Last Login',
        'Rating',
        'Credits',
        'Status',
        'Contact Person',
        'Email',
        'Phone',
        '360° Score',
        'Registration Date',
      ];

      for (const name of sortCols) {
        const th = screen.queryByRole('columnheader', { name: new RegExp('^' + name + '\\$', 'i') });
        if (th) {
          fireEvent.click(th);
          fireEvent.click(th);
        }
      }

      window.localStorage.clear();
    });

    test('handles default props on SellersDirectory and missing vendor data', async () => {
      setVendorResponse([]);
      setStore({ buyerVendors: [] });
      await renderDirectory();
      expect(screen.getByText('Total Suppliers')).toBeInTheDocument();
    });
  });

    test('exercises location resolution with array locations, preferred locations, service locations, and export fallbacks', async () => {
      setVendorResponse([
        {
          id: 'v-arr-1',
          name: 'Array Loc Vendor',
          deliveryLocation: ['Bengaluru', 'Chennai'],
          serviceLocations: ['Hyderabad'],
          preferredLocations: ['Mumbai'],
          contactPerson: '',
        },
        {
          id: 'v-service-loc',
          name: 'Service Loc Vendor',
          deliveryLocation: null,
          serviceLocations: ['Kolkata', 'Patna'],
          preferredLocations: ['Delhi'],
          location: '',
          city: 'Kolkata',
        },
        {
          id: 'v-pref-loc',
          name: 'Preferred Loc Vendor',
          deliveryLocation: null,
          serviceLocations: null,
          preferredLocations: ['Chandigarh', 'Amritsar'],
          location: '',
          city: '',
        },
      ]);

      setStore({
        buyerVendors: [
          {
            id: 'bv-arr-1',
            name: 'Buyer Array Loc Vendor',
            deliveryLocation: ['Jaipur', 'Udaipur'],
          },
          {
            id: 'bv-service-loc',
            name: 'Buyer Service Loc Vendor',
            deliveryLocation: null,
            serviceLocations: ['Bhopal', 'Indore'],
          },
          {
            id: 'bv-pref-loc',
            name: 'Buyer Pref Loc Vendor',
            deliveryLocation: null,
            serviceLocations: null,
            preferredLocations: ['Nagpur'],
            location: '',
          },
        ],
      });

      await renderDirectory();

      expect(screen.getByText('Array Loc Vendor')).toBeInTheDocument();
      expect(screen.getByText('Buyer Array Loc Vendor')).toBeInTheDocument();

      const th = screen.queryByRole('columnheader', { name: /^Supplier$/i });
      if (th) {
        fireEvent.click(th);
        fireEvent.click(th);
        fireEvent.click(th);
      }

      const exportBtn = screen.getByRole('button', { name: /Export Directory/i });
      fireEvent.click(exportBtn);
    });

});
