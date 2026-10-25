import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AllRFQsConsole from '@/app/category-manager/all-rfqs';
import * as rfqClient from '@/lib/rfqClient';
import * as storeModule from '@/lib/store';
import { formatCurrency, formatIndianDateTime } from '@/lib/constants';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type {
  ExtractedEntity,
  QuoteComparison,
  RFQAssignedVendor,
  RFQItem,
  RFQListResult,
} from '@/lib/types';

// Same approach as all-rfqs.test.tsx: the data client and the store are mocked, the three
// child modals (invite, buyer details, vendor details) render for real.
jest.mock('@/lib/rfqClient');
jest.mock('@/lib/store');

const S = UI_STRINGS.allRfqs;
const S2 = UI_STRINGS.inviteVendors;

/** Zero-based position of each column in an RFQ table row. */
const COL = {
  rfqNumber: 0,
  title: 1,
  buyer: 2,
  status: 3,
  quotes: 4,
  vendors: 5,
  budget: 6,
  created: 7,
  latestQuote: 8,
  actions: 9,
} as const;

// Literals the component hard-codes rather than reading from UI_STRINGS.
const EM_DASH = '\u2014';
const BULLET = '\u2022';
const PENDING_BADGE = 'Pending CM Assignment';
const ASSIGN_VENDORS_LABEL = 'Assign Vendors';
const INVITED_NOTICE = 'Invited to quote against this RFQ. Awaiting commercial quotation submission.';

const ALL_STATUSES: RFQItem['status'][] = [
  'Parsing',
  'Quotes Pending',
  'Quotes Received',
  'In Evaluation',
  'AI Recommended',
  'PO Generated',
  'Closed',
  'Expired',
];

const mockFetch = rfqClient.fetchAllRFQs as jest.Mock;
const mockFetchCandidates = rfqClient.fetchVendorCandidates as jest.Mock;
const mockFetchAllVendors = rfqClient.fetchAllVendors as jest.Mock;
const mockInvite = rfqClient.inviteVendorsToRFQ as jest.Mock;
const mockShowToast = jest.fn();

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeRfq(overrides: Partial<RFQItem> & { id: string }): RFQItem {
  return {
    rfqNumber: `RFQ-2026-${overrides.id}`,
    title: `Title ${overrides.id}`,
    category: 'Cables',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    budget: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    buyerAccountName: 'Alpha Buyer Co',
    ...overrides,
  };
}

/**
 * An RFQ as the summary list endpoint can return it: the named fields are genuinely
 * absent (not empty), so the component's `||` / `Array.isArray` fallbacks are what
 * keep the row renderable.
 */
function makeSparseRfq(id: string, absent: ReadonlyArray<keyof RFQItem>, overrides: Partial<RFQItem> = {}): RFQItem {
  const record: Partial<RFQItem> = makeRfq({ ...overrides, id });
  absent.forEach((field) => {
    delete record[field];
  });
  return record as RFQItem;
}

function makeEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Line item',
    quantity: 1,
    unit: 'Nos',
    targetDate: '2026-12-01',
    technicalSpecs: '',
    confidence: 90,
    category: '',
    majorCategory: '',
    minorCategory: '',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<QuoteComparison> = {}): QuoteComparison {
  return {
    vendorId: 'v-1',
    vendorName: 'Vendor One',
    vendorCategory: 'Client List',
    unitPrice: 1000,
    totalPrice: 10000,
    leadTimeDays: 7,
    aiMatchScore: 80,
    warrantyYears: 1,
    complianceStatus: 'Fully Compliant',
    paymentTerms: 'Net 30',
    remarks: '',
    ...overrides,
  };
}

const ALPHA_SUPPLIES: RFQAssignedVendor = {
  id: 'av-1',
  name: 'Alpha Supplies',
  email: 'sales@alpha-supplies.example',
  contactPerson: 'Asha Rao',
  phone: '+91 90000 00001',
  city: 'Pune',
};
// A legacy invitation record that stored the vendor under vendorName / vendorId.
const LEGACY_TRADERS = { name: '', vendorName: 'Legacy Traders', vendorId: 'legacy-7' } as RFQAssignedVendor;
// An invitation record with neither a name nor an id of any kind.
const NAMELESS_VENDOR: RFQAssignedVendor = { name: '' };
const DELTA_FABRICATORS: RFQAssignedVendor = { id: 'av-4', name: 'Delta Fabricators', contactPerson: 'Dev Patel' };
const INVITED_FOUR: RFQAssignedVendor[] = [ALPHA_SUPPLIES, LEGACY_TRADERS, NAMELESS_VENDOR, DELTA_FABRICATORS];

// ---------------------------------------------------------------------------
// Render + DOM helpers
// ---------------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Renders the console against `rfqs` and waits for the table to appear. */
async function renderLoaded(rfqs: RFQItem[], props: React.ComponentProps<typeof AllRFQsConsole> = {}) {
  mockFetch.mockResolvedValue({ success: true, rfqs });
  const view = render(<AllRFQsConsole {...props} />);
  await screen.findByRole('table');
  return view;
}

function rowOf(rfq: RFQItem): HTMLElement {
  return screen.getByRole('row', { name: new RegExp(rfq.rfqNumber) });
}

function cellOf(rfq: RFQItem, column: number): HTMLElement {
  return within(rowOf(rfq)).getAllByRole('cell')[column];
}

/** Renders a row with four invited vendors and opens its "+2 more" roster. */
async function openInvitedVendorList(): Promise<{ rfq: RFQItem; dialog: HTMLElement }> {
  const rfq = makeRfq({ id: 'il01', title: 'Invited Roster', assignedVendors: INVITED_FOUR });
  await renderLoaded([rfq]);
  fireEvent.click(within(cellOf(rfq, COL.vendors)).getByRole('button', { name: '+2 more' }));
  return { rfq, dialog: screen.getByRole('dialog') };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({ success: true, rfqs: [] });
  mockFetchCandidates.mockResolvedValue({ success: true, candidates: [] });
  mockFetchAllVendors.mockResolvedValue({
    success: true,
    candidates: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  });
  (storeModule.useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
});

// ---------------------------------------------------------------------------
// Load handling
// ---------------------------------------------------------------------------

describe('AllRFQsConsole load handling', () => {
  it('requests the cross-buyer summary list, capped at 100 rows, exactly once on mount', async () => {
    await renderLoaded([makeRfq({ id: 'ld01' })]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith({ summary: true, limit: 100 });
  });

  it('disables the refresh button and withholds the counts until the first load settles', async () => {
    const pending = deferred<RFQListResult>();
    mockFetch.mockReturnValueOnce(pending.promise);
    render(<AllRFQsConsole />);

    expect(screen.getByText(S.loading)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.retryAction })).toBeDisabled();
    expect(screen.queryByTestId('all-rfqs-count')).not.toBeInTheDocument();
    expect(screen.queryByText(formatString(S.resultCount, { shown: 0, total: 0 }))).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({
        success: true,
        rfqs: [makeRfq({ id: 'ld02' }), makeRfq({ id: 'ld03', buyerAccountName: 'Beta Buyer Co' })],
      });
    });

    expect(screen.queryByText(S.loading)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.retryAction })).toBeEnabled();
    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent(formatString(S.countSummary, { count: 2, buyers: 2 }));
  });

  it('falls back to the generic load-failed message when the server gives no error text, then recovers on retry', async () => {
    mockFetch.mockResolvedValueOnce({ success: false, reason: 'SERVER', error: '' });
    render(<AllRFQsConsole />);

    expect(await screen.findByText(S.loadFailed)).toBeInTheDocument();
    expect(screen.queryByTestId('all-rfqs-count')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    mockFetch.mockResolvedValueOnce({ success: true, rfqs: [makeRfq({ id: 'ld04', title: 'Recovered RFQ' })] });
    fireEvent.click(screen.getAllByRole('button', { name: S.retryAction })[1]);

    expect(await screen.findByText('Recovered RFQ')).toBeInTheDocument();
    expect(screen.queryByText(S.loadFailed)).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Records with missing fields
// ---------------------------------------------------------------------------

describe('AllRFQsConsole rows with missing fields', () => {
  it('renders placeholders instead of blanks for a record with no category, buyer, quotes or raised date', async () => {
    const sparse = makeSparseRfq('sp01', ['category', 'quotes', 'createdAt', 'buyerAccountName'], {
      title: 'Sparse Record',
      budget: 0,
    });
    await renderLoaded([sparse]);

    const categoryPlaceholder = within(cellOf(sparse, COL.title)).getByText(EM_DASH);
    expect(categoryPlaceholder).not.toHaveAttribute('title');
    expect(cellOf(sparse, COL.buyer)).toHaveTextContent(S.buyerUnknown);
    expect(cellOf(sparse, COL.quotes)).toHaveTextContent('0');
    expect(cellOf(sparse, COL.vendors)).toHaveTextContent(S.colVendorsNone);
    expect(cellOf(sparse, COL.budget)).toHaveTextContent(S.budgetUnset);
    expect(cellOf(sparse, COL.created)).toHaveTextContent(EM_DASH);
    expect(cellOf(sparse, COL.latestQuote)).toHaveTextContent(S.latestQuoteNone);
  });

  it('shows the category with a tooltip and the raised date in the viewer locale when both are present', async () => {
    const populated = makeRfq({
      id: 'pp01',
      title: 'Populated Record',
      category: 'Fasteners',
      createdAt: '2026-09-15T08:30:00.000Z',
      budget: 250000,
    });
    await renderLoaded([populated]);

    expect(cellOf(populated, COL.rfqNumber)).toHaveTextContent(populated.rfqNumber);
    expect(within(cellOf(populated, COL.title)).getByText('Fasteners')).toHaveAttribute('title', 'Fasteners');
    expect(cellOf(populated, COL.created)).toHaveTextContent(new Date('2026-09-15T08:30:00.000Z').toLocaleDateString());
    expect(cellOf(populated, COL.budget)).toHaveTextContent(formatCurrency(250000));
  });
});

// ---------------------------------------------------------------------------
// Latest quote column
// ---------------------------------------------------------------------------

describe('AllRFQsConsole latest quote column', () => {
  it('shows the most recent submission even when the newest quote is listed first', async () => {
    const newestFirst = makeRfq({
      id: 'lq01',
      title: 'Newest Listed First',
      quotesCount: 2,
      quotes: [
        makeQuote({ vendorId: 'v-late', vendorName: 'Late Vendor', submittedAt: '2026-10-05T14:30:00.000Z' }),
        makeQuote({ vendorId: 'v-early', vendorName: 'Early Vendor', submittedAt: '2026-10-01T09:00:00.000Z' }),
      ],
    });
    await renderLoaded([newestFirst]);

    const cell = cellOf(newestFirst, COL.latestQuote);
    expect(cell).toHaveTextContent(formatIndianDateTime('2026-10-05T14:30:00.000Z'));
    expect(cell).not.toHaveTextContent(formatIndianDateTime('2026-10-01T09:00:00.000Z'));
  });

  it('ignores quotes whose submission time is missing or unparseable', async () => {
    const noUsableTimes = makeRfq({
      id: 'lq02',
      title: 'No Usable Timestamps',
      quotesCount: 2,
      quotes: [
        makeQuote({ vendorId: 'v-a', vendorName: 'Garbled Vendor', submittedAt: 'not-a-date' }),
        makeQuote({ vendorId: 'v-b', vendorName: 'Untimed Vendor', submittedAt: undefined }),
      ],
    });
    const oneUsableTime = makeRfq({
      id: 'lq03',
      title: 'One Usable Timestamp',
      quotesCount: 2,
      quotes: [
        makeQuote({ vendorId: 'v-c', vendorName: 'Second Garbled Vendor', submittedAt: 'also-garbage' }),
        makeQuote({ vendorId: 'v-d', vendorName: 'Timed Vendor', submittedAt: '2026-11-02T08:00:00.000Z' }),
      ],
    });
    await renderLoaded([noUsableTimes, oneUsableTime]);

    expect(cellOf(noUsableTimes, COL.latestQuote)).toHaveTextContent(S.latestQuoteNone);
    expect(cellOf(oneUsableTime, COL.latestQuote)).toHaveTextContent(formatIndianDateTime('2026-11-02T08:00:00.000Z'));
  });
});

// ---------------------------------------------------------------------------
// Pending category-manager assignment
// ---------------------------------------------------------------------------

const V0_CASES: Array<{ name: string; rfq: RFQItem; pending: boolean }> = [
  {
    name: 'flags a V0 RFQ that carries no category anywhere',
    rfq: makeRfq({ id: 'v001', sourcingMode: 'mode_0', category: '', extractedEntities: [] }),
    pending: true,
  },
  {
    name: 'flags a V0 RFQ whose header and line-item categories are only whitespace',
    rfq: makeRfq({
      id: 'v002',
      sourcingMode: 'mode_0',
      category: '   ',
      extractedEntities: [makeEntity({ majorCategory: '  ', minorCategory: ' ', category: ' ' })],
    }),
    pending: true,
  },
  {
    name: 'flags a legacy "v0" sourcing mode with no category signal',
    rfq: makeRfq({ id: 'v003', sourcingMode: 'v0' as unknown as RFQItem['sourcingMode'], category: '' }),
    pending: true,
  },
  {
    name: 'flags a V0 RFQ whose line items are missing from the payload',
    rfq: makeSparseRfq('v004', ['extractedEntities'], { sourcingMode: 'mode_0', category: '' }),
    pending: true,
  },
  {
    name: 'flags a V0 RFQ whose invited-vendor list is empty',
    rfq: makeRfq({ id: 'v005', sourcingMode: 'mode_0', category: '', assignedVendors: [] }),
    pending: true,
  },
  {
    name: 'flags any RFQ the server marks as needing manual assignment',
    rfq: makeRfq({ id: 'v006', sourcingMode: 'mode_2', category: 'Cables', needsCategoryManagerAssignment: true }),
    pending: true,
  },
  {
    name: 'does not flag a V0 RFQ that has a header category',
    rfq: makeRfq({ id: 'v007', sourcingMode: 'mode_0', category: 'Cables' }),
    pending: false,
  },
  {
    name: 'does not flag a V0 RFQ whose only signal is a line-item major category',
    rfq: makeRfq({
      id: 'v008',
      sourcingMode: 'mode_0',
      category: '',
      extractedEntities: [makeEntity({ id: 'e-blank' }), makeEntity({ id: 'e-major', majorCategory: 'Pumps' })],
    }),
    pending: false,
  },
  {
    name: 'does not flag a V0 RFQ whose only signal is a line-item minor category',
    rfq: makeRfq({
      id: 'v009',
      sourcingMode: 'mode_0',
      category: '',
      extractedEntities: [makeEntity({ minorCategory: 'Gaskets' })],
    }),
    pending: false,
  },
  {
    name: 'does not flag a V0 RFQ whose only signal is a line-item category',
    rfq: makeRfq({
      id: 'v010',
      sourcingMode: 'mode_0',
      category: '',
      extractedEntities: [makeEntity({ category: 'Valves' })],
    }),
    pending: false,
  },
  {
    name: 'does not flag a V0 RFQ that already has invited vendors',
    rfq: makeRfq({ id: 'v011', sourcingMode: 'mode_0', category: '', assignedVendors: [ALPHA_SUPPLIES] }),
    pending: false,
  },
  {
    name: 'does not flag an uncategorised RFQ from another sourcing mode',
    rfq: makeRfq({ id: 'v012', sourcingMode: 'mode_1', category: '' }),
    pending: false,
  },
];

describe('AllRFQsConsole pending category-manager assignment', () => {
  it.each(V0_CASES)('$name', async ({ rfq, pending }) => {
    await renderLoaded([rfq]);

    const inviteButton = within(cellOf(rfq, COL.actions)).getByRole('button', {
      name: formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber }),
    });
    expect(within(cellOf(rfq, COL.status)).queryAllByText(PENDING_BADGE)).toHaveLength(pending ? 1 : 0);
    expect(inviteButton).toHaveTextContent(pending ? ASSIGN_VENDORS_LABEL : S.inviteVendorsAction);
  });
});

// ---------------------------------------------------------------------------
// Invited vendors column
// ---------------------------------------------------------------------------

describe('AllRFQsConsole invited vendors column', () => {
  it('lists invited vendors under an Invited count, accepting legacy vendorName / vendorId records', async () => {
    const invited = makeRfq({ id: 'iv01', title: 'Invited Pair', assignedVendors: [ALPHA_SUPPLIES, LEGACY_TRADERS] });
    await renderLoaded([invited]);

    const vendorsCell = cellOf(invited, COL.vendors);
    expect(within(vendorsCell).getByText('Invited (2)')).toBeInTheDocument();
    expect(within(vendorsCell).getByRole('button', { name: 'Alpha Supplies' })).toBeInTheDocument();
    expect(within(vendorsCell).getByRole('button', { name: 'Legacy Traders' })).toBeInTheDocument();
    expect(within(vendorsCell).queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
    expect(within(vendorsCell).queryByText(S.colVendorsNone)).not.toBeInTheDocument();
  });

  it('labels an invited vendor that has no name of any kind as "Vendor"', async () => {
    const nameless = makeRfq({ id: 'iv02', title: 'Nameless Invite', assignedVendors: [NAMELESS_VENDOR] });
    await renderLoaded([nameless]);

    fireEvent.click(within(cellOf(nameless, COL.vendors)).getByRole('button', { name: 'Vendor' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Vendor' })).toBeInTheDocument();
    expect(within(dialog).getByText(INVITED_NOTICE)).toBeInTheDocument();
  });

  it('opens the profile of an invited vendor from its chip using the invitation record', async () => {
    const invited = makeRfq({ id: 'iv03', title: 'Invited Detail', assignedVendors: [ALPHA_SUPPLIES, DELTA_FABRICATORS] });
    await renderLoaded([invited]);

    fireEvent.click(within(cellOf(invited, COL.vendors)).getByRole('button', { name: 'Alpha Supplies' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Alpha Supplies' })).toBeInTheDocument();
    expect(within(dialog).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'sales@alpha-supplies.example' })).toHaveAttribute(
      'href',
      'mailto:sales@alpha-supplies.example'
    );
    expect(within(dialog).getByText('Pune')).toBeInTheDocument();
    expect(within(dialog).getByText(INVITED_NOTICE)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows only the first two invited vendors and a +N more control for the rest', async () => {
    const many = makeRfq({ id: 'iv04', title: 'Invited Many', assignedVendors: INVITED_FOUR });
    await renderLoaded([many]);

    const vendorsCell = cellOf(many, COL.vendors);
    expect(within(vendorsCell).getByText('Invited (4)')).toBeInTheDocument();
    expect(within(vendorsCell).getByRole('button', { name: 'Alpha Supplies' })).toBeInTheDocument();
    expect(within(vendorsCell).getByRole('button', { name: 'Legacy Traders' })).toBeInTheDocument();
    expect(within(vendorsCell).queryByRole('button', { name: 'Delta Fabricators' })).not.toBeInTheDocument();
    expect(within(vendorsCell).getByRole('button', { name: '+2 more' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Invited vendors roster modal
// ---------------------------------------------------------------------------

describe('AllRFQsConsole invited vendors roster', () => {
  it('lists every invited vendor with its contact, city and awaiting-quotation status', async () => {
    const { rfq, dialog } = await openInvitedVendorList();

    expect(within(dialog).getByRole('heading', { name: 'Invited Vendors (4)' })).toBeInTheDocument();
    expect(within(dialog).getByText(`${rfq.rfqNumber} ${BULLET} ${rfq.title}`)).toBeInTheDocument();
    ['Alpha Supplies', 'Legacy Traders', 'Vendor', 'Delta Fabricators'].forEach((vendorName) => {
      expect(within(dialog).getByText(vendorName)).toBeInTheDocument();
    });
    expect(within(dialog).getAllByText(/^Contact:/)).toHaveLength(2);
    expect(within(dialog).getByText('Contact: Asha Rao')).toBeInTheDocument();
    expect(within(dialog).getByText('Contact: Dev Patel')).toBeInTheDocument();
    expect(within(dialog).getByText('Pune')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Awaiting Quotation')).toHaveLength(4);
    expect(within(dialog).getAllByRole('button', { name: 'View Details' })).toHaveLength(4);
  });

  it.each([
    { position: 0, expectedName: 'Alpha Supplies' },
    { position: 1, expectedName: 'Legacy Traders' },
    { position: 2, expectedName: 'Vendor' },
    { position: 3, expectedName: 'Delta Fabricators' },
  ])('opens the profile of $expectedName and dismisses the roster from View Details', async ({ position, expectedName }) => {
    const { dialog } = await openInvitedVendorList();

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'View Details' })[position]);

    const profile = screen.getByRole('dialog');
    expect(within(profile).getByRole('heading', { name: expectedName })).toBeInTheDocument();
    expect(within(profile).getByText(INVITED_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invited Vendors (4)' })).not.toBeInTheDocument();
  });

  it('closes from the header X button', async () => {
    const { dialog } = await openInvitedVendorList();

    // The X button is icon-only with no aria-label, so it is the one button with an empty accessible name.
    fireEvent.click(within(dialog).getByRole('button', { name: '' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes from the footer Close button', async () => {
    const { dialog } = await openInvitedVendorList();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the backdrop itself is clicked but not when its content is', async () => {
    const { dialog } = await openInvitedVendorList();

    fireEvent.click(within(dialog).getByRole('heading', { name: 'Invited Vendors (4)' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Quoted vendors roster modal
// ---------------------------------------------------------------------------

describe('AllRFQsConsole quoted vendors roster', () => {
  it('lists quotes from vendors without ids with price, lead time, warranty and the L1 flag', async () => {
    const quotedThree = makeRfq({
      id: 'qt01',
      title: 'Three Anonymous Quotes',
      status: 'Quotes Received',
      quotesCount: 3,
      quotes: [
        makeQuote({ vendorId: '', vendorName: 'Anon One', totalPrice: 120000, leadTimeDays: 10, warrantyYears: 0, isBestPrice: true }),
        makeQuote({ vendorId: '', vendorName: 'Anon Two', totalPrice: 150000, leadTimeDays: 12, warrantyYears: 2 }),
        makeQuote({ vendorId: '', vendorName: 'Anon Three', totalPrice: 175000, leadTimeDays: 15, warrantyYears: 3 }),
      ],
    });
    await renderLoaded([quotedThree]);

    const vendorsCell = cellOf(quotedThree, COL.vendors);
    expect(within(vendorsCell).getAllByText('L1')).toHaveLength(1);
    expect(within(vendorsCell).queryByRole('button', { name: /Anon Three/ })).not.toBeInTheDocument();

    fireEvent.click(within(vendorsCell).getByRole('button', { name: '+1 more' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Quoted Vendors (3)' })).toBeInTheDocument();
    expect(within(dialog).getByText(`${quotedThree.rfqNumber} ${BULLET} ${quotedThree.title}`)).toBeInTheDocument();
    expect(within(dialog).getByText(formatCurrency(120000))).toBeInTheDocument();
    expect(within(dialog).getByText(formatCurrency(150000))).toBeInTheDocument();
    expect(within(dialog).getByText(formatCurrency(175000))).toBeInTheDocument();
    expect(within(dialog).getByText('10d')).toBeInTheDocument();
    expect(within(dialog).getByText('0y')).toBeInTheDocument();
    expect(within(dialog).getByText('3y')).toBeInTheDocument();
    expect(within(dialog).getAllByText('L1 Best Price')).toHaveLength(1);
    expect(within(dialog).getAllByRole('button', { name: 'View Details' })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Search and filters
// ---------------------------------------------------------------------------

describe('AllRFQsConsole search', () => {
  const quoted = makeRfq({
    id: 'sr01',
    title: 'Quoted Cable Lot',
    category: 'Cables',
    buyerAccountName: 'Alpha Buyer Co',
    quotesCount: 1,
    quotes: [makeQuote({ vendorId: 'v-z', vendorName: 'Zenith Corp' })],
  });
  // No category and no quotes in the payload; the first invitee has no name.
  const invited = makeSparseRfq('sr02', ['category', 'quotes'], {
    title: 'Invited Pump Lot',
    buyerAccountName: 'Beta Buyer Co',
    assignedVendors: [LEGACY_TRADERS, { id: 'av-9', name: 'Orion Traders' }],
  });
  const plain = makeRfq({ id: 'sr03', title: 'Plain Valve Lot', category: 'Valves', buyerAccountName: 'Gamma Buyer Co' });

  it('finds an RFQ by the name of a vendor that has quoted on it', async () => {
    await renderLoaded([quoted, invited, plain]);

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'ZENITH' } });

    expect(screen.getByText('Quoted Cable Lot')).toBeInTheDocument();
    expect(screen.queryByText('Invited Pump Lot')).not.toBeInTheDocument();
    expect(screen.queryByText('Plain Valve Lot')).not.toBeInTheDocument();
    expect(screen.getByText(formatString(S.resultCount, { shown: 1, total: 3 }))).toBeInTheDocument();
  });

  it('finds an RFQ by the name of an invited vendor, even when another invitee has no name', async () => {
    await renderLoaded([quoted, invited, plain]);

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'orion' } });

    expect(screen.getByText('Invited Pump Lot')).toBeInTheDocument();
    expect(screen.queryByText('Quoted Cable Lot')).not.toBeInTheDocument();
    expect(screen.queryByText('Plain Valve Lot')).not.toBeInTheDocument();
    expect(screen.getByText(formatString(S.resultCount, { shown: 1, total: 3 }))).toBeInTheDocument();
  });

  it('matches an RFQ number regardless of case and surrounding spaces', async () => {
    await renderLoaded([quoted, invited, plain]);

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: '  rfq-2026-SR03  ' } });

    expect(screen.getByText('Plain Valve Lot')).toBeInTheDocument();
    expect(screen.queryByText('Quoted Cable Lot')).not.toBeInTheDocument();
    expect(screen.queryByText('Invited Pump Lot')).not.toBeInTheDocument();
  });

  it('shows the no-matches panel when nothing carries the term, and its own Clear filters restores the table', async () => {
    await renderLoaded([quoted, invited, plain]);

    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'no-such-vendor' } });

    expect(screen.getByText(S.noMatches)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const clearButtons = screen.getAllByRole('button', { name: S.clearFilters });
    expect(clearButtons).toHaveLength(2);
    fireEvent.click(clearButtons[1]);

    expect(screen.getByText(formatString(S.resultCount, { shown: 3, total: 3 }))).toBeInTheDocument();
    expect(screen.getByLabelText(S.searchLabel)).toHaveValue('');
  });
});

describe('AllRFQsConsole filters', () => {
  it('offers each buyer once in alphabetical order and filters to the chosen buyer', async () => {
    const rows = [
      makeRfq({ id: 'bf01', title: 'Zeta One', buyerAccountName: 'Zeta Co' }),
      makeRfq({ id: 'bf02', title: 'Zeta Two', buyerAccountName: 'Zeta Co' }),
      makeRfq({ id: 'bf03', title: 'Alpha One', buyerAccountName: 'Alpha Co' }),
      makeRfq({ id: 'bf04', title: 'Nobody Owns This', buyerAccountName: null }),
    ];
    await renderLoaded(rows);

    expect(screen.getByTestId('all-rfqs-count')).toHaveTextContent(formatString(S.countSummary, { count: 4, buyers: 2 }));
    const buyerSelect = screen.getByLabelText(S.buyerFilterLabel);
    expect(within(buyerSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      S.allBuyers,
      'Alpha Co',
      'Zeta Co',
    ]);

    fireEvent.change(buyerSelect, { target: { value: 'Zeta Co' } });
    expect(screen.getByText(formatString(S.resultCount, { shown: 2, total: 4 }))).toBeInTheDocument();
    expect(screen.getByText('Zeta One')).toBeInTheDocument();
    expect(screen.getByText('Zeta Two')).toBeInTheDocument();
    expect(screen.queryByText('Nobody Owns This')).not.toBeInTheDocument();
    expect(screen.getByText(S.filtersApplied)).toBeInTheDocument();

    fireEvent.change(buyerSelect, { target: { value: 'Alpha Co' } });
    expect(screen.getByText(formatString(S.resultCount, { shown: 1, total: 4 }))).toBeInTheDocument();
    expect(screen.getByText('Alpha One')).toBeInTheDocument();

    fireEvent.change(buyerSelect, { target: { value: 'all' } });
    expect(screen.getByText(formatString(S.resultCount, { shown: 4, total: 4 }))).toBeInTheDocument();
    expect(screen.queryByText(S.filtersApplied)).not.toBeInTheDocument();
  });

  it('lists all eight RFQ statuses and filters to each one in turn', async () => {
    const rows = ALL_STATUSES.map((status, index) => makeRfq({ id: `sf0${index}`, title: `Row ${status}`, status }));
    await renderLoaded(rows);

    const statusSelect = screen.getByLabelText(S.statusFilterLabel);
    expect(within(statusSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      S.allStatuses,
      ...ALL_STATUSES,
    ]);

    ALL_STATUSES.forEach((status, index) => {
      fireEvent.change(statusSelect, { target: { value: status } });

      expect(screen.getByText(formatString(S.resultCount, { shown: 1, total: ALL_STATUSES.length }))).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(2);
      expect(within(cellOf(rows[index], COL.status)).getByText(status)).toBeInTheDocument();
    });
  });

  it('narrows by status, buyer and search together and reports the filtered count', async () => {
    const rows = [
      makeRfq({ id: 'cf01', title: 'Alpha Open Cable', status: 'Quotes Pending', buyerAccountName: 'Alpha Buyer Co' }),
      makeRfq({ id: 'cf02', title: 'Alpha Closed Cable', status: 'Closed', buyerAccountName: 'Alpha Buyer Co' }),
      makeRfq({ id: 'cf03', title: 'Beta Open Cable', status: 'Quotes Pending', buyerAccountName: 'Beta Buyer Co' }),
    ];
    await renderLoaded(rows);

    fireEvent.change(screen.getByLabelText(S.statusFilterLabel), { target: { value: 'Quotes Pending' } });
    expect(screen.getByText(formatString(S.resultCount, { shown: 2, total: 3 }))).toBeInTheDocument();
    expect(screen.getByText(S.filtersApplied)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(S.buyerFilterLabel), { target: { value: 'Alpha Buyer Co' } });
    expect(screen.getByText(formatString(S.resultCount, { shown: 1, total: 3 }))).toBeInTheDocument();
    expect(screen.getByText('Alpha Open Cable')).toBeInTheDocument();

    // "closed" only matches the Alpha RFQ that the status filter has already excluded.
    fireEvent.change(screen.getByLabelText(S.searchLabel), { target: { value: 'closed' } });
    expect(screen.getByText(S.noMatches)).toBeInTheDocument();
    expect(screen.getByText(formatString(S.resultCount, { shown: 0, total: 3 }))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

describe('AllRFQsConsole row actions', () => {
  it('routes the Details and Quote Matrix actions of each row to that row only', async () => {
    const rows = [
      makeRfq({ id: 'ra01', title: 'First Row' }),
      makeRfq({ id: 'ra02', title: 'Second Row' }),
      makeRfq({ id: 'ra03', title: 'Third Row' }),
    ];
    const onViewDetails = jest.fn();
    const onNavigateToMatrix = jest.fn();
    await renderLoaded(rows, { onViewDetails, onNavigateToMatrix });

    fireEvent.click(screen.getByLabelText(formatString(S.viewDetailsAria, { rfqNumber: rows[2].rfqNumber })));
    fireEvent.click(screen.getByLabelText(formatString(S.viewMatrixAria, { rfqNumber: rows[0].rfqNumber })));

    expect(onViewDetails).toHaveBeenCalledTimes(1);
    expect(onViewDetails).toHaveBeenCalledWith(rows[2]);
    expect(onNavigateToMatrix).toHaveBeenCalledTimes(1);
    expect(onNavigateToMatrix).toHaveBeenCalledWith(rows[0]);
  });

  it('forwards the matrix action to the vendor profile modal and closes it on use', async () => {
    const quoted = makeRfq({
      id: 'mx01',
      title: 'Matrix Link RFQ',
      status: 'Quotes Received',
      quotesCount: 1,
      quotes: [makeQuote({ vendorId: 'v-m', vendorName: 'Matrix Vendor' })],
    });
    const onNavigateToMatrix = jest.fn();
    await renderLoaded([quoted], { onNavigateToMatrix });

    fireEvent.click(within(cellOf(quoted, COL.vendors)).getByRole('button', { name: /Matrix Vendor/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /View Comparative Matrix/ }));

    expect(onNavigateToMatrix).toHaveBeenCalledTimes(1);
    expect(onNavigateToMatrix).toHaveBeenCalledWith(quoted);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Buyer details
// ---------------------------------------------------------------------------

describe('AllRFQsConsole buyer details', () => {
  it('looks the buyer profile up by the buyer account id and name carried on the RFQ', async () => {
    const rfq = makeRfq({
      id: 'bd01',
      title: 'Buyer Lookup',
      buyerAccountName: 'Delta Buyer Co',
      buyerAccountId: 'acct-42',
    });
    await renderLoaded([rfq]);

    fireEvent.click(within(cellOf(rfq, COL.buyer)).getByRole('button', { name: 'Delta Buyer Co' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Delta Buyer Co' })).toBeInTheDocument();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/buyer-profile/details?email=&name=Delta%20Buyer%20Co&accountId=acct-42',
        expect.objectContaining({ headers: expect.any(Object) })
      )
    );
    await waitFor(() => expect(within(dialog).queryByText('Syncing...')).not.toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close modal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Invite vendors flow
// ---------------------------------------------------------------------------

describe('AllRFQsConsole invite vendors flow', () => {
  const pendingRfq = makeRfq({ id: 'ip01', title: 'Needs Vendors', sourcingMode: 'mode_0', category: '' });
  const untouchedRfq = makeRfq({ id: 'io01', title: 'Untouched RFQ' });
  const candidate = { id: 'cand-1', name: 'Gamma Industrial', majorCategory: 'Fasteners', alreadyInvited: false };

  async function openInviteFor(rfq: RFQItem): Promise<HTMLElement> {
    fireEvent.click(
      within(rowOf(rfq)).getByRole('button', { name: formatString(S.inviteVendorsAria, { rfqNumber: rfq.rfqNumber }) })
    );
    return screen.findByTestId('invite-vendors-modal');
  }

  beforeEach(() => {
    mockFetchAllVendors.mockResolvedValue({
      success: true,
      candidates: [candidate],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });
  });

  it('replaces only the invited RFQ with the server record once the invitation succeeds', async () => {
    const updated: RFQItem = {
      ...pendingRfq,
      category: 'Fasteners',
      needsCategoryManagerAssignment: false,
      assignedVendors: [{ id: 'cand-1', name: 'Gamma Industrial' }],
    };
    mockInvite.mockResolvedValue({ success: true, rfq: updated, invitedCount: 1 });
    await renderLoaded([pendingRfq, untouchedRfq]);
    expect(within(rowOf(pendingRfq)).getByText(PENDING_BADGE)).toBeInTheDocument();

    const modal = await openInviteFor(pendingRfq);
    expect(mockFetchCandidates).toHaveBeenCalledWith(pendingRfq.id);
    fireEvent.click(await within(modal).findByRole('checkbox'));
    fireEvent.click(within(modal).getByRole('button', { name: formatString(S2.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith(pendingRfq.id, ['cand-1']));
    await waitFor(() => expect(screen.queryByTestId('invite-vendors-modal')).not.toBeInTheDocument());
    expect(mockShowToast).toHaveBeenCalledWith(
      S2.successTitle,
      formatString(S2.successMessage, { count: 1, rfqNumber: pendingRfq.rfqNumber }),
      'success'
    );

    const refreshedRow = within(rowOf(updated));
    expect(refreshedRow.queryByText(PENDING_BADGE)).not.toBeInTheDocument();
    expect(refreshedRow.getByText('Invited (1)')).toBeInTheDocument();
    expect(refreshedRow.getByRole('button', { name: 'Gamma Industrial' })).toBeInTheDocument();
    expect(cellOf(updated, COL.title)).toHaveTextContent('Fasteners');
    expect(cellOf(untouchedRfq, COL.title)).toHaveTextContent('Untouched RFQ');
    expect(cellOf(untouchedRfq, COL.vendors)).toHaveTextContent(S.colVendorsNone);
  });

  it('leaves the table unchanged and keeps the modal open when the invitation is rejected', async () => {
    mockInvite.mockResolvedValue({ success: false, reason: 'SERVER', error: 'Mail server down.' });
    await renderLoaded([pendingRfq, untouchedRfq]);

    const modal = await openInviteFor(pendingRfq);
    fireEvent.click(await within(modal).findByRole('checkbox'));
    fireEvent.click(within(modal).getByRole('button', { name: formatString(S2.inviteAction, { count: 1 }) }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(S2.failTitle, 'Mail server down.', 'warning'));
    expect(screen.getByTestId('invite-vendors-modal')).toBeInTheDocument();
    expect(within(rowOf(pendingRfq)).getByText(PENDING_BADGE)).toBeInTheDocument();
    expect(cellOf(pendingRfq, COL.vendors)).toHaveTextContent(S.colVendorsNone);
  });
});
