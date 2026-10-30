/**
 * View-layer coverage for app/vendor/quotation-form.tsx: the JSX it renders and
 * the handlers wired inline to it. That covers the category filter (dropdown,
 * chips and empty state), the enquiry rows, the clarification thread modal, the
 * bid form (line-item rates, Excel upload, bid documents) and the upgrade and
 * payment modals.
 *
 * The store is mocked so each test controls exactly which opportunities, RFQ
 * records, inquiries and subscription state the screen receives. That includes
 * states the live backend does not produce on demand: closed enquiries, hidden
 * buyer details, an opportunity with no backing RFQ record.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import QuotationForm from '@/app/vendor/quotation-form';
import { downloadVendorQuotationExcel } from '@/lib/bidComparisonExport';
import { UNLIMITED_ACCESS_EMAILS, formatFileSize } from '@/lib/constants';
import { submitRFQInquiry } from '@/lib/rfqClient';
import { useApp } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import type {
  ExtractedEntity,
  LineItemBid,
  RFQInquiry,
  RFQItem,
  SourcingMode,
  UserSession,
  VendorOpportunity,
} from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual<typeof import('@/lib/rfqClient')>('@/lib/rfqClient'),
  submitRFQInquiry: jest.fn(),
}));

jest.mock('@/lib/bidComparisonExport', () => ({
  downloadVendorQuotationExcel: jest.fn(),
}));

const mockedSubmitRFQInquiry = submitRFQInquiry as jest.MockedFunction<typeof submitRFQInquiry>;
const mockedExcelExport = downloadVendorQuotationExcel as jest.MockedFunction<typeof downloadVendorQuotationExcel>;

// ─── Fixtures ──────────────────────────────────────────────────────────────

const VENDOR_EMAIL = 'vendor@test.com';
const OWN_BUYER = 'Own Buyer Industries';
const OTHER_BUYER = 'Other Buyer Ltd.';
const MIDDLE_DOT = '\u00B7';
const RUPEE = '\u20B9';
const EM_DASH = '\u2014';
const CLOSE_GLYPH = '\u2715';

const COPY = UI_STRINGS.vendorSubscriptionModal;

const SESSION: UserSession = {
  id: 'usr-vendor-1',
  email: VENDOR_EMAIL,
  name: 'Test Vendor Co',
  role: 'vendor',
  orgId: 'org-vendor-1',
  orgName: 'Test Vendor Co',
};

const VENDOR_RECORD = {
  id: 'v-test-vendor',
  name: 'Test Vendor Co',
  email: VENDOR_EMAIL,
  addedByBuyerCompany: OWN_BUYER,
};

function makeEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Item',
    quantity: 1,
    unit: 'Nos',
    targetDate: '2026-09-30',
    technicalSpecs: '',
    confidence: 90,
    category: '',
    majorCategory: '',
    minorCategory: '',
    ...overrides,
  };
}

function makeLineItem(overrides: Partial<LineItemBid> = {}): LineItemBid {
  return {
    id: 'li-1',
    description: 'Line item',
    quantity: 1,
    unitPrice: 0,
    leadTimeDays: 0,
    marketBandStatus: 'optimal',
    paymentTerms: '',
    ...overrides,
  };
}

function makeRfq(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1',
    rfqNumber: 'RFQ-TEST-001',
    title: 'Test requirement',
    category: 'Mechanical Spares',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-09-30',
    budget: 100000,
    createdAt: '2026-09-01T10:00:00.000Z',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    buyerAccountName: OTHER_BUYER,
    ...overrides,
  };
}

/** Mirrors how the store projects an RFQ onto the opportunity a vendor sees. */
function makeOpportunity(rfq: RFQItem, overrides: Partial<VendorOpportunity> = {}): VendorOpportunity {
  return {
    id: `opp-${rfq.id}`,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    buyer: rfq.buyerAccountName || OTHER_BUYER,
    deadline: rfq.targetDeliveryDate,
    daysRemaining: 7,
    type: 'direct_invitation',
    deliveryLocation: rfq.deliveryLocation || '',
    status: rfq.quotes.length > 0 ? 'under_review' : 'pending_bid',
    majorCategory: rfq.category,
    minorCategory: '',
    category: rfq.category,
    sourcingMode: rfq.sourcingMode,
    lineItems: rfq.extractedEntities.map((entity) =>
      makeLineItem({
        id: entity.id,
        description: entity.itemName,
        quantity: entity.quantity,
        unit: entity.unit || undefined,
      }),
    ),
    ...overrides,
  };
}

function makeInquiry(overrides: Partial<RFQInquiry> = {}): RFQInquiry {
  return {
    id: 'inq-1',
    rfqNumber: 'RFQ-THREAD-1',
    vendorName: SESSION.name,
    vendorEmail: VENDOR_EMAIL,
    message: '',
    createdAt: '2024-09-02T09:05:00.000Z',
    status: 'open',
    ...overrides,
  };
}

// ─── Store and network doubles ─────────────────────────────────────────────

type AppSlice = Pick<
  ReturnType<typeof useApp>,
  | 'rfqs'
  | 'vendorOpportunities'
  | 'buyerVendors'
  | 'showToast'
  | 'addAuditLog'
  | 'vendorSubscription'
  | 'currentUserSession'
  | 'refreshFromDB'
  | 'adoptCreatedRFQ'
  | 'vendorFreeCreditsRemaining'
  | 'vendorUnlockedRfqIds'
  | 'refreshVendorCredits'
  | 'unlockRFQForVendor'
  | 'createVendorPaymentLink'
  | 'updateVendorSubscription'
>;

let showToast: jest.Mock;
let addAuditLog: jest.Mock;
let refreshFromDB: jest.Mock;
let adoptCreatedRFQ: jest.Mock;
let createVendorPaymentLink: jest.Mock;

/** Serve the given store state to every `useApp()` call made by the screen. */
function installApp(overrides: Partial<AppSlice> = {}): AppSlice {
  const app: AppSlice = {
    rfqs: [],
    vendorOpportunities: [],
    buyerVendors: [],
    showToast,
    addAuditLog,
    vendorSubscription: 'premium',
    currentUserSession: null,
    refreshFromDB,
    adoptCreatedRFQ,
    vendorFreeCreditsRemaining: 5,
    vendorUnlockedRfqIds: [],
    refreshVendorCredits: jest.fn().mockResolvedValue(undefined),
    unlockRFQForVendor: jest.fn().mockResolvedValue({ success: true }),
    createVendorPaymentLink,
    updateVendorSubscription: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  (useApp as jest.Mock).mockReturnValue(app);
  return app;
}

function jsonReply(body: unknown, init: { ok?: boolean; status?: number } = {}): Promise<Response> {
  return Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response);
}

function defaultFetchHandler(url: string): Promise<Response> {
  if (/\/api\/vendors\/[^/]+$/.test(url)) {
    return jsonReply({ success: true, data: VENDOR_RECORD });
  }
  return jsonReply({ success: true, data: {} });
}

const realFetch = global.fetch;
let fetchHandler: (url: string, init?: RequestInit) => Promise<Response>;

// The i18n section the upgrade modal reads, restored after the one test that removes it.
const dictionary = UI_STRINGS as unknown as { vendorSubscriptionModal?: typeof UI_STRINGS.vendorSubscriptionModal };
const originalSubscriptionCopy = dictionary.vendorSubscriptionModal;

beforeEach(() => {
  jest.clearAllMocks();
  showToast = jest.fn();
  addAuditLog = jest.fn();
  refreshFromDB = jest.fn().mockResolvedValue(undefined);
  adoptCreatedRFQ = jest.fn();
  createVendorPaymentLink = jest.fn().mockResolvedValue(null);
  mockedSubmitRFQInquiry.mockReset();
  mockedSubmitRFQInquiry.mockResolvedValue({ success: true });
  fetchHandler = defaultFetchHandler;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(String(input), init),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  dictionary.vendorSubscriptionModal = originalSubscriptionCopy;
  jest.restoreAllMocks();
});

// ─── Rendering helpers ─────────────────────────────────────────────────────

/** Renders the screen and lets the on-mount vendor-record lookup settle inside act. */
async function renderForm(props: Partial<React.ComponentProps<typeof QuotationForm>> = {}) {
  const onBack = jest.fn();
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<QuotationForm onBack={onBack} {...props} />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  return { ...view, onBack };
}

/** The table row of one enquiry in the main enquiries table. */
function rowFor(rfqNumber: string): HTMLElement {
  const [enquiryTable] = screen.getAllByRole('table');
  const row = within(enquiryTable).getByText(rfqNumber).closest('tr');
  if (!row) throw new Error(`No enquiry row rendered for ${rfqNumber}`);
  return row;
}

function asElement(node: Element | null, description: string): HTMLElement {
  if (!(node instanceof HTMLElement)) throw new Error(`${description} was not rendered`);
  return node;
}

/** The time the thread shows for a message, spaced the way Testing Library normalises the DOM text. */
function formatTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    .replace(/\s+/g, ' ');
}

function expectInDocumentOrder(scope: HTMLElement, texts: string[]) {
  const nodes = texts.map((text) => within(scope).getByText(text));
  nodes.slice(1).forEach((node, index) => {
    expect(nodes[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
}

/** The sender and time line rendered directly above a chat bubble. */
function messageHeader(scope: HTMLElement, messageText: string): HTMLElement {
  return asElement(within(scope).getByText(messageText).previousElementSibling, `Header of "${messageText}"`);
}

// ─── Category filter ───────────────────────────────────────────────────────

describe('category filter', () => {
  const MECHANICAL = 'Mechanical Spares';
  const ELECTRICAL = 'Electrical Systems';

  function installCategoryScenario(extraRfqs: RFQItem[] = []) {
    const rfqs = [
      makeRfq({ id: 'rfq-a', rfqNumber: 'RFQ-A-001', title: 'Hydraulic Pump Set', category: MECHANICAL }),
      makeRfq({ id: 'rfq-b', rfqNumber: 'RFQ-B-002', title: 'Switchgear Panel', category: ELECTRICAL }),
      makeRfq({ id: 'rfq-c', rfqNumber: 'RFQ-C-003', title: 'Cable Drum Bundle', category: ELECTRICAL }),
    ];
    return installApp({
      rfqs: [...rfqs, ...extraRfqs],
      vendorOpportunities: rfqs.map((rfq) => makeOpportunity(rfq)),
    });
  }

  test('choosing a category in the dropdown narrows the enquiries and choosing all categories restores them', async () => {
    installCategoryScenario();
    await renderForm();

    const categorySelect = screen.getByRole('combobox', { name: /Filter enquiries by category/i });
    expect(categorySelect).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'All Categories (2)' })).toBeInTheDocument();

    fireEvent.change(categorySelect, { target: { value: ELECTRICAL } });

    expect(categorySelect).toHaveValue(ELECTRICAL);
    expect(screen.getByText('Switchgear Panel')).toBeInTheDocument();
    expect(screen.getByText('Cable Drum Bundle')).toBeInTheDocument();
    expect(screen.queryByText('Hydraulic Pump Set')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 3 enquiries');
    expect(screen.getByText('(Filtered by 1 category)')).toBeInTheDocument();

    fireEvent.change(categorySelect, { target: { value: 'all' } });

    expect(categorySelect).toHaveValue('all');
    expect(screen.getByText('Hydraulic Pump Set')).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3 enquiries');
    expect(screen.queryByText(/Filtered by/)).not.toBeInTheDocument();
  });

  test('category chips toggle a multi-category selection and show how many enquiries each holds', async () => {
    installCategoryScenario();
    await renderForm();

    // A chip signals that it is selected only through its highlight style, so that class is the observable state.
    const allChip = screen.getByRole('button', { name: /^All Categories \(3\)$/ });
    const electricalChip = screen.getByRole('button', { name: /^Electrical Systems/ });
    const mechanicalChip = screen.getByRole('button', { name: /^Mechanical Spares/ });
    expect(within(electricalChip).getByText('2')).toBeInTheDocument();
    expect(within(mechanicalChip).getByText('1')).toBeInTheDocument();
    expect(allChip).toHaveClass('bg-blue-600');
    expect(electricalChip).not.toHaveClass('bg-blue-600');

    fireEvent.click(electricalChip);

    expect(electricalChip).toHaveClass('bg-blue-600');
    expect(allChip).not.toHaveClass('bg-blue-600');
    expect(screen.getByRole('combobox', { name: /Filter enquiries by category/i })).toHaveValue(ELECTRICAL);
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 3 enquiries');
    expect(screen.getByText('(Filtered by 1 category)')).toBeInTheDocument();

    fireEvent.click(mechanicalChip);

    expect(screen.getByText('(Filtered by 2 categories)')).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3 enquiries');

    fireEvent.click(electricalChip);

    expect(electricalChip).not.toHaveClass('bg-blue-600');
    expect(screen.getByText('(Filtered by 1 category)')).toBeInTheDocument();
    expect(screen.getByText('Hydraulic Pump Set')).toBeInTheDocument();
    expect(screen.queryByText('Switchgear Panel')).not.toBeInTheDocument();

    fireEvent.click(allChip);

    expect(allChip).toHaveClass('bg-blue-600');
    expect(screen.queryByText(/Filtered by/)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3 enquiries');
  });

  test('counts an enquiry under its RFQ record category when the enquiry itself carries none', async () => {
    const mechanical = makeRfq({ id: 'rfq-a', rfqNumber: 'RFQ-A-001', title: 'Hydraulic Pump Set', category: MECHANICAL });
    const electrical = makeRfq({ id: 'rfq-b', rfqNumber: 'RFQ-B-002', title: 'Switchgear Panel', category: ELECTRICAL });
    const uncategorised = makeRfq({ id: 'rfq-u', rfqNumber: 'RFQ-U-003', title: 'Uncategorised Item', category: '' });
    installApp({
      rfqs: [mechanical, electrical, uncategorised],
      vendorOpportunities: [
        // The category lives only on the RFQ record for this one.
        makeOpportunity(mechanical, { majorCategory: '', category: '' }),
        makeOpportunity(electrical),
        // No category anywhere for this one.
        makeOpportunity(uncategorised, { majorCategory: '', category: '' }),
      ],
    });
    await renderForm();

    const mechanicalChip = screen.getByRole('button', { name: /^Mechanical Spares/ });
    expect(within(mechanicalChip).getByText('1')).toBeInTheDocument();

    fireEvent.click(mechanicalChip);

    expect(screen.getByText('Hydraulic Pump Set')).toBeInTheDocument();
    expect(screen.queryByText('Uncategorised Item')).not.toBeInTheDocument();
    expect(screen.queryByText('Switchgear Panel')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 3 enquiries');
  });

  test('shows a category-specific empty state and clears category, search and status together from it', async () => {
    // An RFQ the buyer raised that has no vendor-facing opportunity still offers its category as a chip.
    const orphan = makeRfq({ id: 'rfq-orphan', rfqNumber: 'RFQ-ORPHAN-9', title: 'Orphan', category: 'Safety Equipment' });
    installCategoryScenario([orphan]);
    await renderForm();

    fireEvent.click(screen.getByRole('button', { name: /^Safety Equipment/ }));

    expect(screen.getByText('No matching enquiries')).toBeInTheDocument();
    expect(
      screen.getByText('No RFQs match the selected category filter. Try clearing or selecting different categories.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 3 enquiries');

    const searchBox = screen.getByRole('searchbox', { name: /Search enquiries/i });
    const statusSelect = screen.getByRole('combobox', { name: /Filter enquiries by status/i });
    fireEvent.change(searchBox, { target: { value: 'pump' } });
    fireEvent.change(statusSelect, { target: { value: 'open' } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));

    expect(searchBox).toHaveValue('');
    expect(statusSelect).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: /Filter enquiries by category/i })).toHaveValue('all');
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3 enquiries');
    expect(screen.getByText('Hydraulic Pump Set')).toBeInTheDocument();
  });

  test('offers the clear action when only a category filter is active', async () => {
    const orphan = makeRfq({ id: 'rfq-orphan', rfqNumber: 'RFQ-ORPHAN-9', title: 'Orphan', category: 'Safety Equipment' });
    installCategoryScenario([orphan]);
    await renderForm();

    expect(screen.queryByRole('button', { name: 'Clear search and filters' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /Filter enquiries by category/i }), {
      target: { value: 'Safety Equipment' },
    });

    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 3 enquiries');
  });
});

// ─── Enquiry rows ──────────────────────────────────────────────────────────

describe('enquiry rows', () => {
  test('labels each enquiry with the version badge that matches its sourcing mode', async () => {
    const modes: Array<[SourcingMode, string]> = [
      ['mode_0', `V0 ${MIDDLE_DOT} Starter`],
      ['mode_1', `V1 ${MIDDLE_DOT} Private`],
      ['mode_2', `V2 ${MIDDLE_DOT} Hybrid`],
      ['mode_3', `V3 ${MIDDLE_DOT} Autonomous`],
    ];
    const rfqs = modes.map(([mode], index) =>
      makeRfq({ id: `rfq-mode-${index}`, rfqNumber: `RFQ-MODE-${index}`, title: `Mode ${index} requirement`, sourcingMode: mode }),
    );
    // No RFQ record and no sourcing mode on the enquiry: nothing to badge.
    const unbadged = makeOpportunity(makeRfq({ id: 'rfq-nomode', rfqNumber: 'RFQ-NOMODE-1', title: 'No mode requirement' }), {
      sourcingMode: undefined,
    });
    installApp({ rfqs, vendorOpportunities: [...rfqs.map((rfq) => makeOpportunity(rfq)), unbadged] });
    await renderForm();

    modes.forEach(([, label], index) => {
      expect(within(rowFor(`RFQ-MODE-${index}`)).getByText(label)).toBeInTheDocument();
    });
    expect(within(rowFor('RFQ-NOMODE-1')).queryByText(/^V\d/)).not.toBeInTheDocument();
  });

  test('lists the first two items of an enquiry and summarises the rest', async () => {
    const threeItems = makeRfq({
      id: 'rfq-three',
      rfqNumber: 'RFQ-THREE-1',
      title: 'Three item enquiry',
      extractedEntities: [
        makeEntity({ id: 'e1', itemName: 'Centrifugal Pump', quantity: 2, unit: 'Nos' }),
        makeEntity({ id: 'e2', itemName: 'Gate Valve', quantity: 5, unit: '' }),
        makeEntity({ id: 'e3', itemName: 'Seal Kit', quantity: 1, unit: 'Set' }),
      ],
    });
    const fourItems = makeRfq({
      id: 'rfq-four',
      rfqNumber: 'RFQ-FOUR-1',
      title: 'Four item enquiry',
      extractedEntities: [
        makeEntity({ id: 'f1', itemName: 'Cable Gland', quantity: 0, unit: 'Nos' }),
        makeEntity({ id: 'f2', itemName: 'Lug Terminal', quantity: 100, unit: 'Nos' }),
        makeEntity({ id: 'f3', itemName: 'Conduit Pipe', quantity: 20, unit: 'Mtr' }),
        makeEntity({ id: 'f4', itemName: 'Junction Box', quantity: 4, unit: 'Nos' }),
      ],
    });
    installApp({
      rfqs: [threeItems, fourItems],
      vendorOpportunities: [makeOpportunity(threeItems), makeOpportunity(fourItems)],
    });
    await renderForm();

    const threeRow = within(rowFor('RFQ-THREE-1'));
    expect(threeRow.getByText(`Centrifugal Pump ${MIDDLE_DOT} 2 Nos`)).toBeInTheDocument();
    expect(threeRow.getByText(`Gate Valve ${MIDDLE_DOT} 5`)).toBeInTheDocument();
    expect(threeRow.queryByText(/Seal Kit/)).not.toBeInTheDocument();
    expect(threeRow.getByText('+1 more item')).toBeInTheDocument();

    const fourRow = within(rowFor('RFQ-FOUR-1'));
    expect(fourRow.getByText('Cable Gland')).toBeInTheDocument();
    expect(fourRow.getByText(`Lug Terminal ${MIDDLE_DOT} 100 Nos`)).toBeInTheDocument();
    expect(fourRow.queryByText(/Conduit Pipe/)).not.toBeInTheDocument();
    expect(fourRow.getByText('+2 more items')).toBeInTheDocument();
  });

  test('falls back to the enquiry line items and its own delivery location when no RFQ record is loaded', async () => {
    const recordless = makeRfq({ id: 'rfq-recordless', rfqNumber: 'RFQ-NOREC-1', title: 'Record-less enquiry', category: '' });
    installApp({
      rfqs: [],
      vendorOpportunities: [
        makeOpportunity(recordless, {
          majorCategory: '',
          category: '',
          sourcingMode: undefined,
          deliveryLocation: 'Nagpur Depot',
          lineItems: [
            makeLineItem({ id: 'li-1', description: 'Flange DN100', quantity: 6 }),
            makeLineItem({ id: 'li-2', description: 'Gasket Set', quantity: 12 }),
            makeLineItem({ id: 'li-3', description: 'Bolt M12', quantity: 40 }),
          ],
        }),
      ],
    });
    await renderForm();

    const row = within(rowFor('RFQ-NOREC-1'));
    expect(row.getByText(`Flange DN100 ${MIDDLE_DOT} 6`)).toBeInTheDocument();
    expect(row.getByText(`Gasket Set ${MIDDLE_DOT} 12`)).toBeInTheDocument();
    expect(row.queryByText(/Bolt M12/)).not.toBeInTheDocument();
    expect(row.getByText('+1 more item')).toBeInTheDocument();
    expect(row.getByText(/Nagpur Depot/)).toBeInTheDocument();
    // With no categories anywhere there is nothing to offer as a category chip.
    expect(screen.queryByText('Categories:')).not.toBeInTheDocument();
  });

  test('shows the delivery location from the RFQ record when the enquiry has none', async () => {
    const rfq = makeRfq({ id: 'rfq-loc', rfqNumber: 'RFQ-LOC-1', title: 'Located requirement', deliveryLocation: 'Chennai Plant' });
    installApp({ rfqs: [rfq], vendorOpportunities: [makeOpportunity(rfq, { deliveryLocation: '' })] });
    await renderForm();

    expect(within(rowFor('RFQ-LOC-1')).getByText(/Chennai Plant/)).toBeInTheDocument();
  });

  test('keeps the buyer identity behind the 48-hour privacy notice while buyer details are protected', async () => {
    const rfq = makeRfq({ id: 'rfq-hidden', rfqNumber: 'RFQ-HIDDEN-1', title: 'Protected requirement', buyerDetailsHidden: true });
    installApp({
      rfqs: [rfq],
      vendorOpportunities: [
        makeOpportunity(rfq, { buyer: 'Buyer details protected for 48 hours', buyerDetailsHidden: true }),
      ],
    });
    await renderForm();

    const row = within(rowFor('RFQ-HIDDEN-1'));
    expect(row.getByText('Protected (48h privacy)')).toBeInTheDocument();
    expect(row.getByTitle(/remain confidential for 48 hours/i)).toBeInTheDocument();
    expect(row.queryByText('Procucev Network Sourced')).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /Buyer Details/i })).not.toBeInTheDocument();
  });

  test('shows a generic submitted label when this vendor quote carries no total price', async () => {
    const rfq = makeRfq({
      id: 'rfq-quoted',
      rfqNumber: 'RFQ-QUOTED-1',
      title: 'Quoted requirement',
      quotes: [
        { vendorEmail: VENDOR_EMAIL, vendorName: SESSION.name, totalPrice: 0 },
      ] as unknown as RFQItem['quotes'],
    });
    installApp({ rfqs: [rfq], vendorOpportunities: [makeOpportunity(rfq)], currentUserSession: SESSION });
    await renderForm();

    const row = within(rowFor('RFQ-QUOTED-1'));
    expect(row.getByText('Quote submitted')).toBeInTheDocument();
    expect(row.getByText(`Portal Submission ${MIDDLE_DOT} -`)).toBeInTheDocument();
    expect(row.getByText('Quote Submitted')).toBeInTheDocument();
    expect(row.queryByRole('button', { name: /Submit Quote$/ })).not.toBeInTheDocument();
  });

  test('summarises clarifications from the newest inquiry, not from the order they are listed in', async () => {
    const rfq = makeRfq({
      id: 'rfq-clar',
      rfqNumber: 'RFQ-CLAR-1',
      title: 'Clarified requirement',
      inquiries: [
        makeInquiry({
          id: 'inq-new',
          rfqNumber: 'RFQ-CLAR-1',
          message: 'Newest question',
          createdAt: '2024-09-03T10:00:00.000Z',
          status: 'open',
        }),
        makeInquiry({
          id: 'inq-old',
          rfqNumber: 'RFQ-CLAR-1',
          message: 'Older question',
          createdAt: '2024-09-01T10:00:00.000Z',
          status: 'answered',
          reply: 'Older reply',
        }),
      ],
    });
    installApp({ rfqs: [rfq], vendorOpportunities: [makeOpportunity(rfq)], currentUserSession: SESSION });
    await renderForm();

    const row = within(rowFor('RFQ-CLAR-1'));
    expect(row.getByText(`2 sent ${MIDDLE_DOT} Awaiting reply`)).toBeInTheDocument();
    expect(row.queryByText(/Latest reply:/)).not.toBeInTheDocument();
  });

  test('marks closed and expired enquiries as closed and offers no quoting or clarification for them', async () => {
    const open = makeRfq({ id: 'rfq-open', rfqNumber: 'RFQ-OPEN-1', title: 'Open requirement' });
    const closed = makeRfq({ id: 'rfq-closed', rfqNumber: 'RFQ-CLOSED-1', title: 'Closed requirement' });
    const expired = makeRfq({ id: 'rfq-expired', rfqNumber: 'RFQ-EXPIRED-1', title: 'Expired requirement' });
    installApp({
      rfqs: [open, closed, expired],
      vendorOpportunities: [
        makeOpportunity(open),
        makeOpportunity(closed, { status: 'Closed' }),
        makeOpportunity(expired, { status: 'Expired' }),
      ],
    });
    await renderForm();

    const openRow = within(rowFor('RFQ-OPEN-1'));
    expect(openRow.getByRole('button', { name: /Submit Quote$/ })).toBeInTheDocument();
    expect(openRow.getByRole('button', { name: /Clarify/ })).toBeInTheDocument();
    ['RFQ-CLOSED-1', 'RFQ-EXPIRED-1'].forEach((rfqNumber) => {
      const row = within(rowFor(rfqNumber));
      expect(row.getByText(/RFQ Closed/)).toBeInTheDocument();
      expect(row.queryByRole('button', { name: /Submit Quote$/ })).not.toBeInTheDocument();
      expect(row.queryByRole('button', { name: /Clarify/ })).not.toBeInTheDocument();
    });

    const statusSelect = screen.getByRole('combobox', { name: /Filter enquiries by status/i });
    fireEvent.change(statusSelect, { target: { value: 'closed' } });
    expect(screen.getByText('Closed requirement')).toBeInTheDocument();
    expect(screen.getByText('Expired requirement')).toBeInTheDocument();
    expect(screen.queryByText('Open requirement')).not.toBeInTheDocument();

    fireEvent.change(statusSelect, { target: { value: 'open' } });
    expect(screen.getByText('Open requirement')).toBeInTheDocument();
    expect(screen.queryByText('Closed requirement')).not.toBeInTheDocument();
    expect(screen.queryByText('Expired requirement')).not.toBeInTheDocument();
  });

  test('reports a failed RFQ specification download with a generic message when no detail is available', async () => {
    const rfq = makeRfq({ id: 'rfq-dl', rfqNumber: 'RFQ-DL-1', title: 'Downloadable requirement' });
    installApp({ rfqs: [rfq], vendorOpportunities: [makeOpportunity(rfq)] });
    fetchHandler = (url) =>
      /\/email-preview/.test(url) ? Promise.reject(new Error('')) : defaultFetchHandler(url);
    await renderForm();

    fireEvent.click(within(rowFor('RFQ-DL-1')).getByRole('button', { name: /Download RFQ/ }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Download Failed',
        'Could not download the RFQ specification.',
        'warning',
      ),
    );
  });
});

// ─── Quoting access ────────────────────────────────────────────────────────

describe('quoting access', () => {
  const externalRfq = makeRfq({ id: 'rfq-ext', rfqNumber: 'RFQ-EXT-001', title: 'External buyer pumps' });

  test('locks an external buyer enquiry once the free quotation credits are used up', async () => {
    installApp({
      rfqs: [externalRfq],
      vendorOpportunities: [makeOpportunity(externalRfq)],
      vendorFreeCreditsRemaining: 0,
      currentUserSession: SESSION,
    });
    await renderForm();

    const row = within(rowFor('RFQ-EXT-001'));
    expect(row.getByText(/Premium Locked/)).toBeInTheDocument();
    expect(row.queryByRole('button', { name: /Submit Quote$/ })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /Clarify/ })).not.toBeInTheDocument();
    expect(screen.getByText('0 Free Left')).toBeInTheDocument();
  });

  test('never locks a vendor with unlimited access, even with no free quotation credits left', async () => {
    installApp({
      rfqs: [externalRfq],
      vendorOpportunities: [makeOpportunity(externalRfq)],
      vendorFreeCreditsRemaining: 0,
      currentUserSession: { ...SESSION, email: Array.from(UNLIMITED_ACCESS_EMAILS)[0] },
    });
    await renderForm();

    const row = within(rowFor('RFQ-EXT-001'));
    expect(row.getByRole('button', { name: /Submit Quote$/ })).toBeInTheDocument();
    expect(row.getByRole('button', { name: /Clarify/ })).toBeInTheDocument();
    expect(row.queryByText(/Premium Locked/)).not.toBeInTheDocument();
  });
});

// ─── Clarification thread modal ────────────────────────────────────────────

describe('clarification thread modal', () => {
  const THREAD_RFQ_NUMBER = 'RFQ-THREAD-1';
  const unrelatedRfq = makeRfq({ id: 'rfq-unrelated', rfqNumber: 'RFQ-UNRELATED-1', title: 'Unrelated requirement' });

  function installThread(inquiries: RFQInquiry[]) {
    const threadRfq = makeRfq({ id: 'rfq-thread', rfqNumber: THREAD_RFQ_NUMBER, title: 'Thread requirement', inquiries });
    return installApp({
      // The thread RFQ is deliberately not first, so the lookup has to skip past another RFQ.
      rfqs: [unrelatedRfq, threadRfq],
      vendorOpportunities: [makeOpportunity(unrelatedRfq), makeOpportunity(threadRfq)],
      currentUserSession: SESSION,
    });
  }

  async function openThread() {
    const view = await renderForm();
    fireEvent.click(within(rowFor(THREAD_RFQ_NUMBER)).getByRole('button', { name: /Clarify/ }));
    const heading = screen.getByRole('heading', { name: 'Raise Issue / Clarification' });
    const modal = asElement(heading.closest('.fixed'), 'Clarification modal');
    return { ...view, heading, modal };
  }

  test('merges question and reply pairs into one chronological thread for this vendor only', async () => {
    installThread([
      makeInquiry({
        id: 'inq-1',
        vendorEmail: 'VENDOR@Test.com',
        message: 'Is drawing revision C final?',
        createdAt: '2024-09-02T09:05:00.000Z',
        status: 'answered',
        reply: 'Yes, revision C is final.',
        repliedBy: 'Priya Nair',
        repliedAt: '2024-09-02T11:30:00.000Z',
      }),
      makeInquiry({
        id: 'inq-2',
        message: 'Can delivery be split?',
        createdAt: '2024-09-03T08:40:00.000Z',
        status: 'answered',
        reply: 'Split delivery is acceptable.',
      }),
      // Sent from another mailbox: still this vendor's, matched on the vendor name.
      makeInquiry({
        id: 'inq-3',
        vendorEmail: 'second.mailbox@test.com',
        message: 'What is the packing standard?',
        createdAt: '2024-09-04T10:15:00.000Z',
      }),
      // A buyer-initiated note with no vendor question.
      makeInquiry({
        id: 'inq-4',
        message: '',
        createdAt: '2024-09-05T07:50:00.000Z',
        status: 'answered',
        reply: 'Reminder: quotes close on Friday.',
      }),
      // No vendor name and no timestamps at all.
      makeInquiry({
        id: 'inq-5',
        vendorName: '',
        message: 'Undated question',
        createdAt: '',
        status: 'answered',
        reply: 'Undated answer',
      }),
      makeInquiry({
        id: 'inq-rival',
        vendorName: 'Rival Supplies',
        vendorEmail: 'rival@else.com',
        message: 'Rival private question',
        createdAt: '2024-09-02T10:00:00.000Z',
      }),
    ]);
    const { modal } = await openThread();

    expect(within(modal).queryByText('No questions asked yet')).not.toBeInTheDocument();
    expect(within(modal).queryByText('Rival private question')).not.toBeInTheDocument();
    expectInDocumentOrder(modal, [
      'Is drawing revision C final?',
      'Yes, revision C is final.',
      'Can delivery be split?',
      'Split delivery is acceptable.',
      'What is the packing standard?',
      'Reminder: quotes close on Friday.',
      'Undated question',
      'Undated answer',
    ]);

    // Vendor messages are signed "(You)" and buyer messages "(Buyer)", each with its own time.
    const question = messageHeader(modal, 'Is drawing revision C final?');
    expect(question).toHaveTextContent('Test Vendor Co (You)');
    expect(question).toHaveTextContent(formatTime('2024-09-02T09:05:00.000Z'));
    const answer = messageHeader(modal, 'Yes, revision C is final.');
    expect(answer).toHaveTextContent('Priya Nair (Buyer)');
    expect(answer).toHaveTextContent(formatTime('2024-09-02T11:30:00.000Z'));
    // A reply with no named responder is signed by the procurement team.
    expect(messageHeader(modal, 'Split delivery is acceptable.')).toHaveTextContent('Buyer Procurement Team (Buyer)');
    expect(messageHeader(modal, 'Reminder: quotes close on Friday.')).toHaveTextContent('Buyer Procurement Team (Buyer)');
    // The name-matched inquiry keeps the vendor name it was sent under, and a nameless one reads "You".
    expect(messageHeader(modal, 'What is the packing standard?')).toHaveTextContent('Test Vendor Co (You)');
    expect(messageHeader(modal, 'Undated question')).toHaveTextContent('You (You)');
  });

  test('shows an explicit message thread as stored and labels undated messages as recent', async () => {
    installThread([
      makeInquiry({
        id: 'inq-thread',
        message: 'Legacy question text that the thread supersedes',
        messages: [
          { id: '', senderRole: 'buyer', senderName: 'Buyer Desk', message: 'Undated desk note', timestamp: '' },
          {
            id: 'm-1',
            senderRole: 'vendor',
            senderName: 'Test Vendor Co',
            message: 'Thread opener',
            timestamp: '2024-09-03T08:00:00.000Z',
          },
          {
            id: 'm-2',
            senderRole: 'buyer',
            senderName: 'Meera Rao',
            message: 'Thread answer',
            timestamp: '2024-09-03T09:20:00.000Z',
          },
          { id: '', senderRole: 'vendor', senderName: 'Test Vendor Co', message: 'Follow-up without a stamp', timestamp: '' },
        ],
      }),
    ]);
    const { modal } = await openThread();

    expect(within(modal).queryByText('Legacy question text that the thread supersedes')).not.toBeInTheDocument();
    expectInDocumentOrder(modal, ['Thread opener', 'Thread answer']);
    expect(within(modal).getAllByText('Recently')).toHaveLength(2);

    const opener = messageHeader(modal, 'Thread opener');
    expect(opener).toHaveTextContent('Test Vendor Co (You)');
    expect(opener).toHaveTextContent(formatTime('2024-09-03T08:00:00.000Z'));
    const answer = messageHeader(modal, 'Thread answer');
    expect(answer).toHaveTextContent('Meera Rao (Buyer)');
    expect(answer).toHaveTextContent(formatTime('2024-09-03T09:20:00.000Z'));

    const deskNote = messageHeader(modal, 'Undated desk note');
    expect(deskNote).toHaveTextContent('Buyer Desk (Buyer)');
    expect(deskNote).toHaveTextContent('Recently');
    const followUp = messageHeader(modal, 'Follow-up without a stamp');
    expect(followUp).toHaveTextContent('Test Vendor Co (You)');
    expect(followUp).toHaveTextContent('Recently');
  });

  test('matches inquiries by the signed-in name when the vendor record could not be loaded', async () => {
    fetchHandler = (url) =>
      /\/api\/vendors\/[^/]+$/.test(url)
        ? jsonReply({ success: false }, { ok: false, status: 404 })
        : defaultFetchHandler(url);
    installThread([
      makeInquiry({
        id: 'inq-shared',
        vendorEmail: 'shared.mailbox@test.com',
        message: 'Sent from a shared mailbox',
      }),
      makeInquiry({
        id: 'inq-rival',
        vendorName: 'Rival Supplies',
        vendorEmail: 'rival@else.com',
        message: 'Rival private question',
      }),
    ]);
    const { modal } = await openThread();

    expect(within(modal).getByText('Sent from a shared mailbox')).toBeInTheDocument();
    expect(within(modal).queryByText('Rival private question')).not.toBeInTheDocument();
  });

  test('closes the clarification modal from the header close button', async () => {
    installThread([]);
    const { heading, modal } = await openThread();
    expect(within(modal).getByText('No questions asked yet')).toBeInTheDocument();

    const header = asElement(heading.closest('.justify-between'), 'Clarification modal header');
    fireEvent.click(within(header).getByRole('button'));

    expect(screen.queryByRole('heading', { name: 'Raise Issue / Clarification' })).not.toBeInTheDocument();
  });

  test('sends a clarification only on a plain Enter key press', async () => {
    const updatedRfq = makeRfq({ id: 'rfq-thread', rfqNumber: THREAD_RFQ_NUMBER, title: 'Thread requirement' });
    mockedSubmitRFQInquiry.mockResolvedValue({ success: true, rfq: updatedRfq });
    installThread([]);
    const { modal } = await openThread();

    const sendButton = within(modal).getByRole('button', { name: /Send Clarification/ });
    const textarea = within(modal).getByPlaceholderText(/Type your question regarding specs/);
    expect(sendButton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'Please confirm the delivery terms' } });
    expect(sendButton).toBeEnabled();

    fireEvent.keyDown(textarea, { key: 'a' });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(mockedSubmitRFQInquiry).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(mockedSubmitRFQInquiry).toHaveBeenCalledTimes(1);
    expect(mockedSubmitRFQInquiry).toHaveBeenCalledWith('opp-rfq-thread', {
      message: 'Please confirm the delivery terms',
      vendorName: SESSION.name,
      vendorEmail: VENDOR_EMAIL,
    });
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Clarification Sent',
        'Your query has been dispatched to the procurement officer.',
        'success',
      ),
    );
    await waitFor(() => expect(textarea).toBeEnabled());
    expect(textarea).toHaveValue('');
    expect(adoptCreatedRFQ).toHaveBeenCalledWith(updatedRfq);
    expect(refreshFromDB).toHaveBeenCalledTimes(1);
  });
});

// ─── Bid form ──────────────────────────────────────────────────────────────

describe('bid form', () => {
  const BID_RFQ_NUMBER = 'RFQ-BID-1';
  const PUMP = makeEntity({ id: 'li-1', itemName: 'Centrifugal Pump 15HP', quantity: 2, unit: 'Nos' });
  const PLATE = makeEntity({ id: 'li-2', itemName: 'Mounting Base Plate', quantity: 4, unit: '' });

  function installBidScenario(entities: ExtractedEntity[]) {
    const rfq = makeRfq({ id: 'rfq-bid', rfqNumber: BID_RFQ_NUMBER, title: 'Bid requirement', extractedEntities: entities });
    const opportunity = makeOpportunity(rfq);
    installApp({ rfqs: [rfq], vendorOpportunities: [opportunity], vendorUnlockedRfqIds: [BID_RFQ_NUMBER] });
    return opportunity;
  }

  async function openBidForm() {
    const view = await renderForm();
    fireEvent.click(within(rowFor(BID_RFQ_NUMBER)).getByRole('button', { name: /Submit Quote$/ }));
    expect(screen.getByRole('heading', { name: 'Submit Quotation' })).toBeInTheDocument();
    return view;
  }

  function bidDocumentsInput(): HTMLInputElement {
    const input = screen.getByText(/Bid Documents/).parentElement?.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Bid documents input was not rendered');
    return input;
  }

  function pdf(name: string): File {
    return new File(['data'], name, { type: 'application/pdf' });
  }

  test('recomputes each line amount and the quotation total as rates are typed', async () => {
    installBidScenario([PUMP, PLATE]);
    await openBidForm();

    expect(screen.getByText('Line Item Pricing (2 items) *')).toBeInTheDocument();
    expect(screen.queryByText(/email bids are not accepted/)).not.toBeInTheDocument();
    const pumpRate = screen.getByLabelText('Rate for Centrifugal Pump 15HP');
    const plateRate = screen.getByLabelText('Rate for Mounting Base Plate');
    const pumpRow = asElement(pumpRate.closest('tr'), 'Pump rate row');
    const plateRow = asElement(plateRate.closest('tr'), 'Plate rate row');
    const totalRow = asElement(screen.getByText('Total').closest('tr'), 'Total row');
    expect(pumpRate).toHaveValue(null);
    expect(within(totalRow).getByText('0')).toBeInTheDocument();

    fireEvent.change(pumpRate, { target: { value: '1250' } });

    expect(pumpRate).toHaveValue(1250);
    expect(within(pumpRow).getByText('2,500')).toBeInTheDocument();
    expect(within(totalRow).getByText('2,500')).toBeInTheDocument();

    fireEvent.change(plateRate, { target: { value: '300' } });

    expect(within(plateRow).getByText('1,200')).toBeInTheDocument();
    // The plate has no unit of measure, so the UOM column shows a dash.
    expect(within(plateRow).getByText(EM_DASH)).toBeInTheDocument();
    expect(within(totalRow).getByText('3,700')).toBeInTheDocument();

    fireEvent.change(pumpRate, { target: { value: '1000' } });

    expect(within(pumpRow).getByText('2,000')).toBeInTheDocument();
    expect(within(totalRow).getByText('3,200')).toBeInTheDocument();
  });

  test('exports the line items together with the rates typed so far', async () => {
    const opportunity = installBidScenario([PUMP, PLATE]);
    await openBidForm();

    fireEvent.change(screen.getByLabelText('Rate for Centrifugal Pump 15HP'), { target: { value: '1250' } });
    fireEvent.change(screen.getByLabelText('Rate for Mounting Base Plate'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));

    expect(mockedExcelExport).toHaveBeenCalledTimes(1);
    expect(mockedExcelExport).toHaveBeenCalledWith(BID_RFQ_NUMBER, opportunity.lineItems, {
      'li-1': '1250',
      'li-2': '300',
    });
  });

  test('the upload button opens the file chooser of the Excel input', async () => {
    installBidScenario([PUMP, PLATE]);
    await openBidForm();

    const uploadButton = screen.getByRole('button', { name: /Upload Priced Excel/ });
    const excelInput = uploadButton.previousElementSibling;
    if (!(excelInput instanceof HTMLInputElement)) throw new Error('Excel input was not rendered');
    expect(excelInput).toHaveAttribute('type', 'file');
    expect(excelInput).toHaveAttribute('accept', '.xlsx,.xls,.csv');
    const openChooser = jest.spyOn(excelInput, 'click').mockImplementation(() => undefined);

    fireEvent.click(uploadButton);

    expect(openChooser).toHaveBeenCalledTimes(1);
  });

  test('warns that email bids are not accepted when the enquiry has more than ten items', async () => {
    installBidScenario(
      Array.from({ length: 11 }, (_, index) =>
        makeEntity({ id: `bulk-${index + 1}`, itemName: `Bulk item ${index + 1}`, quantity: index + 1 }),
      ),
    );
    await openBidForm();

    expect(screen.getByText('Line Item Pricing (11 items) *')).toBeInTheDocument();
    expect(screen.getByText(/RFQ has 11 items: email bids are not accepted/)).toBeInTheDocument();
  });

  test('lists attached bid documents with their sizes and removes only the one chosen', async () => {
    installBidScenario([]);
    await openBidForm();
    const names = ['a-spec.pdf', 'b-boq.pdf', 'c-drawing.pdf'];

    fireEvent.change(bidDocumentsInput(), { target: { files: names.map(pdf) } });

    names.forEach((name) => expect(screen.getByText(name)).toBeInTheDocument());
    expect(screen.getAllByText(`(${formatFileSize(pdf(names[0]).size)})`)).toHaveLength(3);

    const secondItem = asElement(screen.getByText('b-boq.pdf').closest('li'), 'Second document entry');
    fireEvent.click(within(secondItem).getByRole('button', { name: 'Remove' }));

    expect(screen.queryByText('b-boq.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('a-spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('c-drawing.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByText('a-spec.pdf')).not.toBeInTheDocument();
  });

  test('emptying the file selection clears the attached bid documents', async () => {
    installBidScenario([]);
    await openBidForm();
    const input = bidDocumentsInput();

    fireEvent.change(input, { target: { files: [pdf('only.pdf')] } });
    expect(screen.getByText('only.pdf')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: null } });

    expect(screen.queryByText('only.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  test('rejects a selection of more than five bid documents', async () => {
    installBidScenario([]);
    await openBidForm();

    fireEvent.change(bidDocumentsInput(), {
      target: { files: Array.from({ length: 6 }, (_, index) => pdf(`doc-${index + 1}.pdf`)) },
    });

    expect(showToast).toHaveBeenCalledWith('Too Many Documents', 'Attach no more than five documents.', 'warning');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  test('rejects an empty bid document and attaches nothing from that selection', async () => {
    installBidScenario([]);
    await openBidForm();

    fireEvent.change(bidDocumentsInput(), {
      target: { files: [pdf('fine.pdf'), new File([], 'empty.pdf', { type: 'application/pdf' })] },
    });

    expect(showToast).toHaveBeenCalledWith(
      'Empty Document',
      'empty.pdf is empty. Choose a file with content.',
      'warning',
    );
    expect(screen.queryByText('fine.pdf')).not.toBeInTheDocument();
  });

  test('rejects a bid document above the 10 MB limit and attaches nothing from that selection', async () => {
    installBidScenario([]);
    await openBidForm();
    const oversized = pdf('huge.pdf');
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });

    fireEvent.change(bidDocumentsInput(), { target: { files: [pdf('fine.pdf'), oversized] } });

    expect(showToast).toHaveBeenCalledWith('Document Too Large', 'huge.pdf exceeds the 10 MB limit.', 'warning');
    expect(screen.queryByText('fine.pdf')).not.toBeInTheDocument();
  });
});

// ─── Upgrade and payment modals ────────────────────────────────────────────

describe('upgrade and payment modals', () => {
  const lockedRfq = makeRfq({ id: 'rfq-ext', rfqNumber: 'RFQ-EXT-001', title: 'External buyer pumps' });

  function installLockedScenario(overrides: Partial<AppSlice> = {}) {
    return installApp({
      rfqs: [lockedRfq],
      vendorOpportunities: [makeOpportunity(lockedRfq)],
      vendorFreeCreditsRemaining: 0,
      vendorSubscription: 'premium',
      ...overrides,
    });
  }

  async function openUpgradeModalFromRow() {
    fireEvent.click(within(rowFor('RFQ-EXT-001')).getByRole('button', { name: COPY.upgradeAction }));
    const title = await screen.findByText(COPY.upgradeTitle);
    return asElement(title.closest('.modal-backdrop'), 'Upgrade modal');
  }

  function planCard(modal: HTMLElement, title: string): HTMLElement {
    return asElement(within(modal).getByText(title).closest('.border-2'), `Plan card ${title}`);
  }

  test('the upgrade button on a locked enquiry opens the plan chooser, which closes from either control', async () => {
    installLockedScenario();
    await renderForm();
    expect(within(rowFor('RFQ-EXT-001')).getByText(/Premium Locked/)).toBeInTheDocument();

    const modal = await openUpgradeModalFromRow();

    expect(within(modal).getByText(COPY.creditsExhaustedWarning)).toBeInTheDocument();
    expect(within(planCard(modal, COPY.connectTitle)).getByText(COPY.connectDesc)).toBeInTheDocument();
    expect(within(planCard(modal, COPY.selectTitle)).getByText(COPY.selectDesc)).toBeInTheDocument();
    expect(within(modal).queryByText(COPY.activeBadge)).not.toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('button', { name: CLOSE_GLYPH }));
    expect(screen.queryByText(COPY.upgradeTitle)).not.toBeInTheDocument();

    const reopened = await openUpgradeModalFromRow();
    fireEvent.click(within(reopened).getByRole('button', { name: COPY.closeAction }));
    expect(screen.queryByText(COPY.upgradeTitle)).not.toBeInTheDocument();
  });

  test.each([
    ['connect', 'Connect Model (Marketplace Access)', `${RUPEE}2 / 3 months`],
    ['select', 'Select Model (Catalogue + Scale)', `${RUPEE}5 / 3 months`],
  ])('upgrading to the %s plan opens secure checkout for that plan and cancelling closes it', async (planId, planName, price) => {
    installLockedScenario();
    await renderForm();
    const modal = await openUpgradeModalFromRow();

    const planButton = within(modal)
      .getAllByRole('button', { name: COPY.upgradeAction })
      .find((button) => button.getAttribute('data-plan') === planId);
    if (!planButton) throw new Error(`No upgrade button for the ${planId} plan`);
    fireEvent.click(planButton);

    expect(screen.queryByText(COPY.upgradeTitle)).not.toBeInTheDocument();
    expect(screen.getByText('Secure Payment')).toBeInTheDocument();
    expect(screen.getByText(planName)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Pay ${price}` }));

    expect(createVendorPaymentLink).toHaveBeenCalledWith(planId);
    expect(await screen.findByText('Could not start checkout. Please try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument();
  });

  test.each([
    ['connect', 'select'],
    ['select', 'connect'],
  ] as const)(
    'marks the %s plan Active and still offers the %s plan when the server asks the vendor to upgrade',
    async (activePlan, otherPlan) => {
      const planTitle = { connect: COPY.connectTitle, select: COPY.selectTitle };
      installApp({
        rfqs: [lockedRfq],
        vendorOpportunities: [makeOpportunity(lockedRfq)],
        vendorFreeCreditsRemaining: 0,
        vendorSubscription: activePlan,
        vendorUnlockedRfqIds: ['RFQ-EXT-001'],
      });
      fetchHandler = (url, init) =>
        /\/quotes$/.test(url) && init?.method === 'POST'
          ? jsonReply({ success: false, upgradeRequired: true }, { ok: false, status: 403 })
          : defaultFetchHandler(url);
      await renderForm();

      fireEvent.click(within(rowFor('RFQ-EXT-001')).getByRole('button', { name: /Submit Quote$/ }));
      fireEvent.change(screen.getByPlaceholderText('e.g. 25000'), { target: { value: '1500' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Quotation' }));

      const title = await screen.findByText(COPY.upgradeTitle);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Quotation' })).toBeEnabled());
      const modal = asElement(title.closest('.modal-backdrop'), 'Upgrade modal');
      expect(showToast).toHaveBeenCalledWith(
        COPY.creditsExhaustedToastTitle,
        COPY.creditsExhaustedToastDesc,
        'warning',
      );
      expect(screen.getByRole('link', { name: 'Upgrade Plan to Continue Quoting' })).toHaveAttribute(
        'href',
        '/vendor/vendor-subscription',
      );

      const activeCard = within(planCard(modal, planTitle[activePlan]));
      expect(activeCard.getByText(COPY.activeBadge)).toBeInTheDocument();
      expect(activeCard.queryByRole('button')).not.toBeInTheDocument();
      const otherCard = within(planCard(modal, planTitle[otherPlan]));
      expect(otherCard.getByRole('button', { name: COPY.upgradeAction })).toHaveAttribute('data-plan', otherPlan);
    },
  );

  test('falls back to the built-in English copy when the dictionary has no vendor subscription section', async () => {
    dictionary.vendorSubscriptionModal = undefined;
    expect(UI_STRINGS.vendorSubscriptionModal).toBeUndefined();
    installLockedScenario();
    const view = await renderForm();

    fireEvent.click(within(rowFor('RFQ-EXT-001')).getByRole('button', { name: 'Upgrade' }));

    const title = await screen.findByText(/Upgrade Plan to Submit Quotations/);
    const modal = asElement(title.closest('.modal-backdrop'), 'Upgrade modal');
    const connectTitle = `Connect Model (${RUPEE}2 / 3 mo)`;
    const selectTitle = `Select Model (${RUPEE}5 / 3 mo)`;
    expect(
      within(modal).getByText(/No Free Quotation Credits: Free quotation credits are not available/),
    ).toBeInTheDocument();
    expect(
      within(planCard(modal, connectTitle)).getByText('Quote and download up to 50 RFQs in 3 months from Marketplace.'),
    ).toBeInTheDocument();
    expect(
      within(planCard(modal, selectTitle)).getByText('Item Catalogue (100 products) + 100 RFQs / 3 months.'),
    ).toBeInTheDocument();
    expect(within(modal).getAllByRole('button', { name: 'Upgrade' })).toHaveLength(2);
    expect(within(modal).getByRole('button', { name: 'Close' })).toBeInTheDocument();

    // The plan changing underneath the open modal is reflected on its cards.
    installLockedScenario({ vendorSubscription: 'connect' });
    view.rerender(<QuotationForm onBack={view.onBack} />);
    expect(within(planCard(modal, connectTitle)).getByText('Active')).toBeInTheDocument();
    expect(within(modal).getAllByRole('button', { name: 'Upgrade' })).toHaveLength(1);

    installLockedScenario({ vendorSubscription: 'select' });
    view.rerender(<QuotationForm onBack={view.onBack} />);
    expect(within(planCard(modal, selectTitle)).getByText('Active')).toBeInTheDocument();
    expect(within(planCard(modal, connectTitle)).queryByText('Active')).not.toBeInTheDocument();
  });
});
