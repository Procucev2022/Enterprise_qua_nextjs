import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as XLSX from 'xlsx';
import QuotationForm from '@/app/vendor/quotation-form';
import { authClient } from '@/lib/authClient';
import { UNLIMITED_ACCESS_EMAILS } from '@/lib/constants';
import { submitRFQInquiry } from '@/lib/rfqClient';
import { useApp } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import type {
  ExtractedEntity,
  LineItemBid,
  QuoteComparison,
  RFQItem,
  RFQQuoteAttachment,
  UserSession,
  VendorEntry,
  VendorOpportunity,
} from '@/lib/types';

// The logic half of quotation-form.tsx: helpers, ownership and visibility rules,
// category and search filtering, Excel import, clarification dispatch, the quote
// submission pipeline and the RFQ specification download. The store is replaced by
// a plain object so each test owns exactly the RFQs, vendor record and credit
// balance it needs; every network call goes through a per-test fetch router.
//
// Three defensive guards cannot be reached through the UI and are intentionally not
// exercised: the `|| []` fallback inside the submitted-quotes `.find` (the preceding
// `.filter` already guarantees the RFQ has quotes), the `|| []` fallback in the Excel
// import (the import control only renders for multi-item RFQs) and the `!biddingOn`
// guard in handleSubmitQuote (its button only exists while a bid form is open).

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/lib/store', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  submitRFQInquiry: jest.fn(),
}));
// Delegates to the real parser unless a test makes it throw.
jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, read: jest.fn(actual.read) };
});

type AppState = ReturnType<typeof useApp>;
type FormProps = React.ComponentProps<typeof QuotationForm>;

const mockShowToast = jest.fn();
const mockAddAuditLog = jest.fn();
const mockRefreshFromDB = jest.fn();
const mockAdoptCreatedRFQ = jest.fn();
const mockRefreshVendorCredits = jest.fn();
const mockUnlockRFQForVendor = jest.fn();
const mockCreateVendorPaymentLink = jest.fn();
const mockUpdateVendorSubscription = jest.fn();

const actualXlsxRead = jest.requireActual<typeof XLSX>('xlsx').read;
const originalSession = authClient.getSessionUser();
const originalToken = authClient.getToken();

const VENDOR_EMAIL = 'vendor@test.com';
const VENDOR_NAME = 'Test Vendor Co';
const VENDOR_ID = 'v-mine';
// Any address on the app's own unlimited-access allow-list.
const UNLIMITED_EMAIL = Array.from(UNLIMITED_ACCESS_EMAILS)[0];
const SUBSCRIPTION_COPY = UI_STRINGS.vendorSubscriptionModal;
// The upgrade prompt's own heading also contains "Submit Quotation", so match exactly.
const BID_FORM_TITLE = 'Submit Quotation';

// File reads and chained fetches settle on later ticks; leave headroom on busy machines.
configure({ asyncUtilTimeout: 4000 });

const VENDOR_SESSION: UserSession = {
  id: 'user-1',
  email: VENDOR_EMAIL,
  name: VENDOR_NAME,
  role: 'vendor',
  orgId: 'org-1',
  orgName: VENDOR_NAME,
};

// ─── Fixture builders ─────────────────────────────────────────────────────────

function lineItem(overrides: Partial<LineItemBid> = {}): LineItemBid {
  return {
    id: 'li-1',
    description: 'Centrifugal Pump',
    quantity: 2,
    unit: 'Nos',
    unitPrice: 0,
    leadTimeDays: 0,
    marketBandStatus: 'optimal',
    paymentTerms: '',
    ...overrides,
  };
}

function opportunity(overrides: Partial<VendorOpportunity> = {}): VendorOpportunity {
  return {
    id: 'opp-1',
    rfqNumber: 'RFQ-100',
    title: 'Pump Package',
    buyer: 'Alpha Industries',
    deadline: '2026-12-31',
    daysRemaining: 30,
    type: 'network_marketplace',
    deliveryLocation: 'Pune Plant',
    status: 'pending_bid',
    lineItems: [lineItem()],
    majorCategory: 'Mechanical',
    minorCategory: '',
    ...overrides,
  };
}

function entity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    id: 'ent-1',
    itemName: 'Centrifugal Pump',
    quantity: 2,
    unit: 'Nos',
    targetDate: '2026-12-31',
    technicalSpecs: '',
    confidence: 90,
    category: '',
    majorCategory: '',
    minorCategory: '',
    ...overrides,
  };
}

// The form also recognises its own bid by a `vendorEmail` field on the quote, which
// the shared QuoteComparison type does not declare.
type QuoteFixture = Partial<QuoteComparison> & { vendorEmail?: string };

function quote(overrides: QuoteFixture = {}): QuoteComparison {
  return {
    vendorId: 'someone-else',
    vendorName: 'Other Supplies',
    vendorCategory: 'Client List',
    unitPrice: 100,
    totalPrice: 200,
    leadTimeDays: 7,
    aiMatchScore: 80,
    warrantyYears: 1,
    complianceStatus: 'Fully Compliant',
    paymentTerms: '30 Days Net',
    remarks: '',
    ...overrides,
  };
}

function rfq(overrides: Partial<RFQItem> = {}): RFQItem {
  return {
    id: 'rfq-1',
    rfqNumber: 'RFQ-100',
    title: 'Pump Package',
    category: 'Mechanical',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-31',
    budget: 0,
    createdAt: '2026-09-01',
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  };
}

function storedAttachment(id: string, fileName: string): RFQQuoteAttachment {
  return { id, fileName, mimeType: 'application/pdf', size: 3, uploadedAt: '2026-09-02T10:00:00.000Z' };
}

function vendorRecord(overrides: Partial<VendorEntry> = {}): VendorEntry {
  return {
    id: VENDOR_ID,
    name: VENDOR_NAME,
    contactPerson: 'Vendor Contact',
    phone: '+91 90000 00000',
    email: VENDOR_EMAIL,
    majorCategory: 'Mechanical',
    minorCategories: [],
    location: 'Pune',
    rating: 4,
    source: 'buyer_uploaded',
    ...overrides,
  };
}

// ─── Store, fetch and render helpers ─────────────────────────────────────────

function setApp(overrides: Partial<AppState> = {}): AppState {
  const state = {
    rfqs: [],
    vendorOpportunities: [],
    buyerVendors: [],
    showToast: mockShowToast,
    addAuditLog: mockAddAuditLog,
    vendorSubscription: 'premium',
    currentUserSession: VENDOR_SESSION,
    refreshFromDB: mockRefreshFromDB,
    adoptCreatedRFQ: mockAdoptCreatedRFQ,
    vendorFreeCreditsRemaining: 5,
    vendorUnlockedRfqIds: [],
    refreshVendorCredits: mockRefreshVendorCredits,
    unlockRFQForVendor: mockUnlockRFQForVendor,
    createVendorPaymentLink: mockCreateVendorPaymentLink,
    updateVendorSubscription: mockUpdateVendorSubscription,
    ...overrides,
  } as unknown as AppState;
  jest.mocked(useApp).mockReturnValue(state);
  return state;
}

const settle = (): Promise<void> =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

interface FetchReply {
  ok?: boolean;
  status?: number;
  body?: unknown;
  blob?: Blob;
}
type FetchHandler = (url: string, init?: RequestInit) => FetchReply | Promise<FetchReply>;

const ROUTE_PATTERNS = {
  vendor: /\/api\/vendors\/[^/]+$/,
  upload: /\/api\/rfqs\/[^/]+\/quote-attachments$/,
  quote: /\/api\/rfqs\/[^/]+\/quotes$/,
  preview: /\/api\/rfqs\/[^/]+\/email-preview$/,
  attachment: /\/api\/rfqs\/attachments\/[^/]+$/,
  rfq: /\/api\/rfqs\/[^/]+$/,
};
type RouteName = keyof typeof ROUTE_PATTERNS;
type FetchCall = [string, RequestInit | undefined];

/** Routes every fetch by endpoint; unhandled endpoints answer a generic success. */
function stubFetch(handlers: Partial<Record<RouteName, FetchHandler>> = {}): void {
  const routes: Partial<Record<RouteName, FetchHandler>> = {
    vendor: () => ({ body: { success: true, data: { id: VENDOR_ID, name: VENDOR_NAME } } }),
    ...handlers,
  };
  (global.fetch as jest.Mock).mockReset().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const name = (Object.keys(ROUTE_PATTERNS) as RouteName[]).find((key) => ROUTE_PATTERNS[key].test(url));
    const handler = name ? routes[name] : undefined;
    const reply: FetchReply = handler ? await handler(url, init) : {};
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      json: async () => reply.body ?? { success: true, data: {} },
      blob: async () => reply.blob ?? new Blob(['file-bytes']),
    };
  });
}

function callsTo(name: RouteName): FetchCall[] {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => ROUTE_PATTERNS[name].test(String(url)));
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body));
}

async function renderForm(overrides: Partial<AppState> = {}, props: Partial<FormProps> = {}) {
  setApp(overrides);
  const onBack = jest.fn();
  const element = (next: Partial<FormProps>) => <QuotationForm onBack={onBack} {...next} />;
  const view = render(element(props));
  await settle();
  return {
    ...view,
    onBack,
    /** Re-renders with the current store state (call setApp first to change it). */
    refresh: async (next: Partial<FormProps> = props) => {
      view.rerender(element(next));
      await settle();
    },
  };
}

const rowFor = (rfqNumber: string): HTMLElement => screen.getByRole('row', { name: new RegExp(rfqNumber) });

function fileInputNear(anchor: HTMLElement): HTMLInputElement {
  const input = anchor.parentElement?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No file input next to the given element.');
  return input;
}

const excelInput = (): HTMLInputElement => fileInputNear(screen.getByRole('button', { name: /Upload Priced Excel/i }));
const documentsInput = (): HTMLInputElement => fileInputNear(screen.getByText(/Bid Documents/i));

async function openBidFormFor(rfqNumber = 'RFQ-100'): Promise<void> {
  fireEvent.click(await within(rowFor(rfqNumber)).findByRole('button', { name: /^Submit Quote$/ }));
  await screen.findByRole('heading', { name: BID_FORM_TITLE });
}

const submitQuotationButton = (): HTMLElement => screen.getByRole('button', { name: /^Submit Quotation$/ });

function workbookFile(rows: Array<Record<string, string | number>>): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Priced RFQ');
  const bytes: ArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([bytes], 'priced-rfq.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const downloadedFileNames: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  [
    mockShowToast,
    mockAddAuditLog,
    mockRefreshFromDB,
    mockAdoptCreatedRFQ,
    mockRefreshVendorCredits,
    mockUnlockRFQForVendor,
    mockCreateVendorPaymentLink,
    mockUpdateVendorSubscription,
  ].forEach((mock) => mock.mockReset());
  mockCreateVendorPaymentLink.mockResolvedValue(null);
  mockUpdateVendorSubscription.mockResolvedValue(true);
  jest.mocked(submitRFQInquiry).mockReset().mockResolvedValue({ success: true });
  jest.mocked(XLSX.read).mockReset().mockImplementation(actualXlsxRead);
  stubFetch();
  downloadedFileNames.length = 0;
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordDownload(this: HTMLAnchorElement) {
    downloadedFileNames.push(this.download);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  authClient.setSession(originalSession, originalToken);
});

// ─── Upgrade plan selection ───────────────────────────────────────────────────

describe('upgrade plan selection', () => {
  const lockedVendor = (): Partial<AppState> => ({
    vendorOpportunities: [opportunity()],
    vendorFreeCreditsRemaining: 0,
  });

  async function openUpgradeModal(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: SUBSCRIPTION_COPY.upgradeAction }));
    await screen.findByText(SUBSCRIPTION_COPY.upgradeTitle);
  }

  function planButton(plan: 'connect' | 'select'): HTMLElement {
    const match = screen
      .getAllByRole('button', { name: SUBSCRIPTION_COPY.upgradeAction })
      .find((candidate) => candidate.getAttribute('data-plan') === plan);
    if (!match) throw new Error(`No upgrade button for the ${plan} plan.`);
    return match;
  }

  test('switches to the Premium tier, confirms with a toast and closes the upgrade modal', async () => {
    await renderForm(lockedVendor());
    await openUpgradeModal();

    // The modal only renders Connect and Select buttons today; the handler also
    // supports a button carrying data-plan="premium".
    const button = planButton('connect');
    button.setAttribute('data-plan', 'premium');
    fireEvent.click(button);

    expect(mockUpdateVendorSubscription).toHaveBeenCalledWith('premium');
    expect(mockShowToast).toHaveBeenCalledWith('Switched Plan', 'Switched to Premium tier.', 'success');
    expect(screen.queryByText(SUBSCRIPTION_COPY.upgradeTitle)).not.toBeInTheDocument();
    expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument();
  });

  test('still confirms the Premium switch when the store exposes no subscription updater', async () => {
    await renderForm({ ...lockedVendor(), updateVendorSubscription: undefined });
    await openUpgradeModal();

    const button = planButton('select');
    button.setAttribute('data-plan', 'premium');
    fireEvent.click(button);

    expect(mockUpdateVendorSubscription).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Switched Plan', 'Switched to Premium tier.', 'success');
    expect(screen.queryByText(SUBSCRIPTION_COPY.upgradeTitle)).not.toBeInTheDocument();
  });

  test('ignores an upgrade button that carries no plan', async () => {
    await renderForm(lockedVendor());
    await openUpgradeModal();

    const button = planButton('select');
    button.removeAttribute('data-plan');
    fireEvent.click(button);

    expect(mockUpdateVendorSubscription).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(screen.getByText(SUBSCRIPTION_COPY.upgradeTitle)).toBeInTheDocument();
    expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument();
  });

  test.each([
    ['connect', 'Connect Model (Marketplace Access)', '₹2 / 3 months'],
    ['select', 'Select Model (Catalogue + Scale)', '₹5 / 3 months'],
  ] as const)(
    'opens checkout for the %s plan with its name and price and pays with that plan id',
    async (plan, planName, price) => {
      await renderForm(lockedVendor());
      await openUpgradeModal();

      fireEvent.click(planButton(plan));

      expect(screen.queryByText(SUBSCRIPTION_COPY.upgradeTitle)).not.toBeInTheDocument();
      expect(await screen.findByText('Secure Payment')).toBeInTheDocument();
      expect(screen.getByText(planName)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: `Pay ${price}` }));
      await waitFor(() => expect(mockCreateVendorPaymentLink).toHaveBeenCalledWith(plan));
      expect(await screen.findByText('Could not start checkout. Please try again.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Secure Payment')).not.toBeInTheDocument();
    }
  );
});

// ─── Credit balance ───────────────────────────────────────────────────────────

describe('quotation credit balance', () => {
  test('defaults to 5 free credits when neither the vendor record, the vendor list nor the store reports a balance', async () => {
    await renderForm({ vendorFreeCreditsRemaining: undefined });

    expect(screen.getByText('5 Free Left')).toBeInTheDocument();
  });
});

// ─── Which submitted quotes belong to this vendor ────────────────────────────

describe('submitted quote attribution', () => {
  test('counts quotes matched by vendor id, e-mail or company name and ignores every other quote', async () => {
    const rfqs = [
      rfq({
        id: 'r1',
        rfqNumber: 'RFQ-ID-1',
        status: 'PO Generated',
        quotes: [
          quote({ vendorId: 'competitor', vendorEmail: 'sales@competitor.com', vendorName: 'Competitor Ltd', totalPrice: 700 }),
          quote({ vendorId: VENDOR_ID, totalPrice: 1500, submittedAt: '2026-09-01T10:00:00.000Z' }),
        ],
      }),
      rfq({
        id: 'r2',
        rfqNumber: 'RFQ-EMAIL-2',
        quotes: [quote({ vendorId: 'x-email', vendorEmail: 'VENDOR@Test.com', totalPrice: 2500 })],
      }),
      rfq({
        id: 'r3',
        rfqNumber: 'RFQ-NAME-3',
        quotes: [quote({ vendorId: 'x-name', vendorName: '  test VENDOR co ', totalPrice: undefined })],
      }),
      rfq({ id: 'r4', rfqNumber: 'RFQ-NOQUOTES-4', quotes: undefined as unknown as QuoteComparison[] }),
      rfq({
        id: 'r5',
        rfqNumber: 'RFQ-OTHER-5',
        quotes: [quote({ vendorId: 'z', vendorName: 'Competitor Ltd', vendorEmail: 'sales@competitor.com' })],
      }),
    ];
    await renderForm({
      rfqs,
      vendorOpportunities: rfqs.map((item) => opportunity({ id: item.id, rfqNumber: item.rfqNumber, title: `Title ${item.rfqNumber}` })),
    });

    await waitFor(() => expect(screen.getByText('Quotations Submitted').parentElement).toHaveTextContent('3 Sent'));
    expect(within(rowFor('RFQ-ID-1')).getByText('₹1,500')).toBeInTheDocument();
    expect(within(rowFor('RFQ-ID-1')).getByText('PO Generated')).toBeInTheDocument();
    expect(within(rowFor('RFQ-EMAIL-2')).getByText('₹2,500')).toBeInTheDocument();
    // A quote without a price is still this vendor's bid, shown without an amount.
    expect(within(rowFor('RFQ-NAME-3')).getByText('Quote submitted')).toBeInTheDocument();
    expect(within(rowFor('RFQ-NAME-3')).getByText(/Portal Submission · -/)).toBeInTheDocument();
    expect(within(rowFor('RFQ-NOQUOTES-4')).getByText('No bid submitted')).toBeInTheDocument();
    expect(within(rowFor('RFQ-OTHER-5')).getByText('No bid submitted')).toBeInTheDocument();
  });
});

// ─── Which enquiries come from this vendor's own buyer ───────────────────────

describe('direct buyer relationship', () => {
  test('unlocks enquiries linked through the vendor lookup or any buyer link on the vendor record, and keeps other buyers locked', async () => {
    stubFetch({
      vendor: () => ({ body: { success: true, data: { id: VENDOR_ID, name: VENDOR_NAME, buyerId: 'buyer-from-lookup' } } }),
    });
    await renderForm({
      vendorSubscription: 'premium',
      vendorFreeCreditsRemaining: 0,
      buyerVendors: [
        vendorRecord({ id: 'someone-else', email: 'other@supplier.com', addedByBuyerCompany: 'Unrelated Co' }),
        vendorRecord({
          email: 'Vendor@Test.com',
          addedByBuyerCompany: 'Record Buyer Co',
          buyerId: 'record-buyer-id',
          buyerAccountId: 'record-account-id',
        }),
      ],
      vendorOpportunities: [
        opportunity({ id: 'o1', rfqNumber: 'RFQ-OWN-LOOKUP', buyer: 'Zeta Corp', buyerAccountId: 'buyer-from-lookup' }),
        opportunity({ id: 'o2', rfqNumber: 'RFQ-OWN-COMPANY', buyer: 'Record Buyer Co', buyerAccountId: 'unrelated' }),
        opportunity({ id: 'o3', rfqNumber: 'RFQ-OWN-BUYERID', buyer: 'Eta Corp', buyerAccountId: 'record-buyer-id' }),
        opportunity({ id: 'o4', rfqNumber: 'RFQ-OWN-ACCOUNT', buyer: 'Theta Corp', buyerAccountId: 'record-account-id' }),
        opportunity({ id: 'o5', rfqNumber: 'RFQ-EXTERNAL', buyer: 'Iota Corp', buyerAccountId: 'external-id' }),
      ],
    });

    for (const own of ['RFQ-OWN-LOOKUP', 'RFQ-OWN-COMPANY', 'RFQ-OWN-BUYERID', 'RFQ-OWN-ACCOUNT']) {
      expect(await within(rowFor(own)).findByRole('button', { name: /^Submit Quote$/ })).toBeInTheDocument();
      expect(within(rowFor(own)).queryByText(/Premium Locked/)).not.toBeInTheDocument();
    }
    expect(within(rowFor('RFQ-EXTERNAL')).getByText(/Premium Locked/)).toBeInTheDocument();
    expect(within(rowFor('RFQ-EXTERNAL')).queryByRole('button', { name: /^Submit Quote$/ })).not.toBeInTheDocument();
  });
});

// ─── Category, status and text filtering ─────────────────────────────────────

describe('enquiry filtering', () => {
  const categorySelect = (): HTMLElement => screen.getByRole('combobox', { name: /Filter enquiries by category/i });
  const statusSelect = (): HTMLElement => screen.getByRole('combobox', { name: /Filter enquiries by status/i });
  const categoryOptions = (): string[] =>
    within(categorySelect())
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');

  /** Each enquiry's RFQ number is rendered once, in its table row, so its presence means the row is listed. */
  function expectRows(shown: string[], hidden: string[]): void {
    shown.forEach((rfqNumber) => expect(screen.getByText(rfqNumber)).toBeInTheDocument());
    hidden.forEach((rfqNumber) => expect(screen.queryByText(rfqNumber)).not.toBeInTheDocument());
  }

  test('offers each distinct trimmed category once and skips blank categories', async () => {
    await renderForm({
      vendorOpportunities: [
        opportunity({ id: 'o1', rfqNumber: 'RFQ-A', majorCategory: '  Mechanical  ' }),
        opportunity({ id: 'o2', rfqNumber: 'RFQ-B', majorCategory: '', category: 'Electrical' }),
        opportunity({ id: 'o3', rfqNumber: 'RFQ-C', majorCategory: '' }),
      ],
      rfqs: [
        rfq({ id: 'r1', rfqNumber: 'RFQ-A', category: 'Hydraulics' }),
        rfq({
          id: 'r2',
          rfqNumber: 'RFQ-B',
          category: '   ',
          extractedEntities: [entity({ majorCategory: 'Civil' }), entity({ id: 'ent-2', majorCategory: '' })],
        }),
        rfq({ id: 'r3', rfqNumber: 'RFQ-C', category: '' }),
      ],
    });

    expect(categoryOptions()).toEqual(['All Categories (4)', 'Civil', 'Electrical', 'Hydraulics', 'Mechanical']);
  });

  test('the status filter separates open enquiries from quoted, submitted and closed ones', async () => {
    await renderForm({
      rfqs: [rfq({ id: 'r3', rfqNumber: 'RFQ-QUOTED', quotes: [quote({ vendorEmail: VENDOR_EMAIL, totalPrice: 900 })] })],
      vendorOpportunities: [
        opportunity({ id: 'o1', rfqNumber: 'RFQ-OPEN' }),
        opportunity({ id: 'o2', rfqNumber: 'RFQ-CLOSED', status: 'Closed' }),
        opportunity({ id: 'o3', rfqNumber: 'RFQ-QUOTED' }),
        opportunity({ id: 'o4', rfqNumber: 'RFQ-SUBMITTED', status: 'submitted' }),
        opportunity({ id: 'o5', rfqNumber: 'RFQ-EXPIRED', status: 'Expired' }),
      ],
    });

    fireEvent.change(statusSelect(), { target: { value: 'open' } });
    expectRows(['RFQ-OPEN'], ['RFQ-CLOSED', 'RFQ-QUOTED', 'RFQ-SUBMITTED', 'RFQ-EXPIRED']);
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 5 enquiries');

    fireEvent.change(statusSelect(), { target: { value: 'submitted' } });
    expectRows(['RFQ-QUOTED', 'RFQ-SUBMITTED'], ['RFQ-OPEN', 'RFQ-CLOSED', 'RFQ-EXPIRED']);

    fireEvent.change(statusSelect(), { target: { value: 'closed' } });
    expectRows(['RFQ-CLOSED', 'RFQ-EXPIRED'], ['RFQ-OPEN', 'RFQ-QUOTED', 'RFQ-SUBMITTED']);

    fireEvent.change(statusSelect(), { target: { value: 'all' } });
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 5 of 5 enquiries');
  });

  const everyCategoryRfq = ['RFQ-CAT-1', 'RFQ-CAT-2', 'RFQ-CAT-3', 'RFQ-CAT-4', 'RFQ-CAT-5', 'RFQ-CAT-6'];

  async function renderCategoryScenario(): Promise<void> {
    await renderForm({
      rfqs: [
        rfq({ id: 'r2', rfqNumber: 'RFQ-CAT-2', category: 'Electrical' }),
        rfq({ id: 'r3', rfqNumber: 'RFQ-CAT-3', category: '', extractedEntities: [entity({ majorCategory: 'Hydraulics' })] }),
        rfq({ id: 'r5', rfqNumber: 'RFQ-CAT-5', category: 'Mechanical', extractedEntities: [entity({ majorCategory: '', category: 'Electrical' })] }),
        rfq({ id: 'r6', rfqNumber: 'RFQ-CAT-6', category: 'Mechanical', extractedEntities: [entity({ majorCategory: '', category: '' })] }),
        rfq({ id: 'r7', rfqNumber: 'RFQ-ORPHAN', category: 'Civil' }),
      ],
      vendorOpportunities: [
        // No RFQ record at all, so only its own category is known.
        opportunity({ id: 'o1', rfqNumber: 'RFQ-CAT-1', majorCategory: 'Mechanical' }),
        // Blank category: taken from the RFQ record.
        opportunity({ id: 'o2', rfqNumber: 'RFQ-CAT-2', majorCategory: '' }),
        // Blank category and a blank RFQ category: taken from the first line item.
        opportunity({ id: 'o3', rfqNumber: 'RFQ-CAT-3', majorCategory: '' }),
        // No category anywhere.
        opportunity({ id: 'o4', rfqNumber: 'RFQ-CAT-4', majorCategory: '' }),
        // Own category is Mechanical, but a line item only carries the plain category "Electrical".
        opportunity({ id: 'o5', rfqNumber: 'RFQ-CAT-5', majorCategory: 'Mechanical' }),
        // Own category is Mechanical and its line item has no category at all.
        opportunity({ id: 'o6', rfqNumber: 'RFQ-CAT-6', majorCategory: 'Mechanical' }),
      ],
    });
  }

  test('keeps the enquiries whose own category, RFQ record or line items match the selected category', async () => {
    await renderCategoryScenario();
    expectRows(everyCategoryRfq, []);

    fireEvent.change(categorySelect(), { target: { value: 'Electrical' } });

    expectRows(['RFQ-CAT-2', 'RFQ-CAT-5'], ['RFQ-CAT-1', 'RFQ-CAT-3', 'RFQ-CAT-4', 'RFQ-CAT-6']);
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 6 enquiries');
    expect(screen.getByText('(Filtered by 1 category)')).toBeInTheDocument();
  });

  test('category chips add and remove categories one at a time', async () => {
    await renderCategoryScenario();
    fireEvent.change(categorySelect(), { target: { value: 'Electrical' } });

    fireEvent.click(screen.getByRole('button', { name: /^Hydraulics/ }));
    expectRows(['RFQ-CAT-2', 'RFQ-CAT-3', 'RFQ-CAT-5'], ['RFQ-CAT-1', 'RFQ-CAT-4', 'RFQ-CAT-6']);
    expect(screen.getByText('(Filtered by 2 categories)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Hydraulics/ }));
    expectRows(['RFQ-CAT-2', 'RFQ-CAT-5'], ['RFQ-CAT-3']);
    expect(screen.getByText('(Filtered by 1 category)')).toBeInTheDocument();
  });

  test('a category no enquiry belongs to leaves an empty state that can be cleared', async () => {
    await renderCategoryScenario();

    fireEvent.change(categorySelect(), { target: { value: 'Civil' } });

    expect(screen.getByText('No matching enquiries')).toBeInTheDocument();
    expect(
      screen.getByText('No RFQs match the selected category filter. Try clearing or selecting different categories.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expectRows(everyCategoryRfq, []);
    expect(categorySelect()).toHaveValue('all');
  });

  test('choosing All Categories from the chip or the dropdown lists every enquiry again', async () => {
    await renderCategoryScenario();

    fireEvent.change(categorySelect(), { target: { value: 'Electrical' } });
    fireEvent.click(screen.getByRole('button', { name: /^All Categories \(6\)$/ }));
    expectRows(everyCategoryRfq, []);
    expect(categorySelect()).toHaveValue('all');

    fireEvent.change(categorySelect(), { target: { value: 'Electrical' } });
    fireEvent.change(categorySelect(), { target: { value: 'all' } });
    expectRows(everyCategoryRfq, []);
    expect(screen.queryByText(/Filtered by/)).not.toBeInTheDocument();
  });

  test('searches enquiry fields, RFQ record fields and line item names case-insensitively', async () => {
    await renderForm({
      rfqs: [
        rfq({
          id: 'r1',
          rfqNumber: 'RFQ-SRCH-1',
          category: 'Mechanical',
          deliveryLocation: 'Navi Mumbai Warehouse',
          extractedEntities: [entity({ itemName: 'Ball Valve 2in' })],
        }),
      ],
      vendorOpportunities: [
        opportunity({ id: 'o1', rfqNumber: 'RFQ-SRCH-1', title: 'Alpha Pumps', buyer: 'Buyer One', deliveryLocation: 'Pune' }),
        // Has no RFQ record, so only its own fields can match.
        opportunity({ id: 'o2', rfqNumber: 'RFQ-SRCH-2', title: 'Cables', buyer: 'Buyer Two', deliveryLocation: 'Chennai' }),
      ],
    });
    const search = screen.getByRole('searchbox', { name: /Search enquiries/i });

    fireEvent.change(search, { target: { value: 'BALL VALVE' } });
    expectRows(['RFQ-SRCH-1'], ['RFQ-SRCH-2']);

    fireEvent.change(search, { target: { value: 'navi mumbai' } });
    expectRows(['RFQ-SRCH-1'], ['RFQ-SRCH-2']);

    fireEvent.change(search, { target: { value: 'buyer two' } });
    expectRows(['RFQ-SRCH-2'], ['RFQ-SRCH-1']);

    fireEvent.change(search, { target: { value: 'no such thing' } });
    expect(screen.getByText('No matching enquiries')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '   ' } });
    expectRows(['RFQ-SRCH-1', 'RFQ-SRCH-2'], []);
  });
});

// ─── Priced Excel import ─────────────────────────────────────────────────────

describe('priced Excel import', () => {
  async function openMultiItemForm(): Promise<void> {
    await renderForm({
      vendorOpportunities: [
        opportunity({
          id: 'o-multi',
          rfqNumber: 'RFQ-MULTI',
          lineItems: [
            lineItem({ id: 'li-1', description: 'Pump', quantity: 2 }),
            lineItem({ id: 'li-2', description: 'Valve', quantity: 4 }),
            lineItem({ id: 'li-3', description: 'Gasket', quantity: 10 }),
            lineItem({ id: 'li-4', description: 'Flange', quantity: 1 }),
            lineItem({ id: 'li-5', description: 'Hose', quantity: 3 }),
            lineItem({ id: 'li-6', description: '', quantity: 1 }),
          ],
        }),
      ],
      vendorUnlockedRfqIds: ['RFQ-MULTI'],
    });
    await openBidFormFor('RFQ-MULTI');
  }

  test('fills rates by item description or item id from any supported heading and skips unusable rows', async () => {
    await openMultiItemForm();

    fireEvent.change(excelInput(), {
      target: {
        files: [
          workbookFile([
            { 'Item Name': ' PUMP ', Rate: 100 },
            { Description: 'Valve', 'Unit Price (INR)': 250 },
            { 'Item Description': 'Gasket', 'Unit Price': 30 },
            { Item: 'Flange', Price: 45.5 },
            { Item: 'Renamed hose', 'Item ID': 'li-5', 'Rate (INR)': 77 },
            { 'Rate (INR)': 99 },
            { Item: 'Valve', 'Rate (INR)': 0 },
            { Item: 'Valve', 'Rate (INR)': 'abc' },
            { Item: 'Mystery part', 'Rate (INR)': 10 },
          ]),
        ],
      },
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Excel Imported', 'Successfully imported pricing for 5 item(s).', 'success')
    );
    expect(screen.getByLabelText('Rate for Pump')).toHaveValue(100);
    expect(screen.getByLabelText('Rate for Valve')).toHaveValue(250);
    expect(screen.getByLabelText('Rate for Gasket')).toHaveValue(30);
    expect(screen.getByLabelText('Rate for Flange')).toHaveValue(45.5);
    expect(screen.getByLabelText('Rate for Hose')).toHaveValue(77);
  });

  test('ignores a file chooser change that carries no file', async () => {
    await openMultiItemForm();

    fireEvent.change(excelInput(), { target: { files: [] } });
    await settle();

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Rate for Pump')).toHaveValue(null);
  });

  test('reports a workbook that cannot be parsed using the parser message', async () => {
    await openMultiItemForm();
    jest.mocked(XLSX.read).mockImplementationOnce(() => {
      throw new Error('Workbook is corrupt');
    });

    fireEvent.change(excelInput(), { target: { files: [workbookFile([{ Item: 'Pump', Rate: 100 }])] } });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Import Failed', 'Workbook is corrupt', 'warning'));
    expect(screen.getByLabelText('Rate for Pump')).toHaveValue(null);
  });

  test('falls back to a generic message when the parser gives no reason', async () => {
    await openMultiItemForm();
    jest.mocked(XLSX.read).mockImplementationOnce(() => {
      throw new Error('');
    });

    fireEvent.change(excelInput(), { target: { files: [workbookFile([{ Item: 'Pump', Rate: 100 }])] } });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Import Failed', 'Could not parse the uploaded Excel file.', 'warning')
    );
  });
});

// ─── Access to the bid form ──────────────────────────────────────────────────

describe('bid form access', () => {
  test.each([
    ['an unlimited-access account', { currentUserSession: { ...VENDOR_SESSION, email: UNLIMITED_EMAIL } }],
    ['an unlimited subscription', { vendorSubscription: 'unlimited' as const }],
  ])('lets %s open the bid form on an external RFQ with no free credits left', async (_label, access) => {
    await renderForm({
      vendorOpportunities: [opportunity()],
      vendorFreeCreditsRemaining: 0,
      vendorUnlockedRfqIds: ['RFQ-100'],
      ...access,
    });

    await openBidFormFor();

    expect(screen.getByRole('heading', { name: BID_FORM_TITLE })).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(screen.queryByText(SUBSCRIPTION_COPY.upgradeTitle)).not.toBeInTheDocument();
  });

  async function lapseSessionBeforeClicking(): Promise<void> {
    authClient.setSession({ ...VENDOR_SESSION, email: UNLIMITED_EMAIL }, 'unlimited-token');
    await renderForm({
      vendorOpportunities: [opportunity()],
      vendorFreeCreditsRemaining: 0,
      vendorUnlockedRfqIds: ['RFQ-100'],
    });
    const submitQuote = await within(rowFor('RFQ-100')).findByRole('button', { name: /^Submit Quote$/ });

    // The session expires between rendering the row and the click landing.
    authClient.setSession(null, null);
    fireEvent.click(submitQuote);
  }

  test('re-checks access at click time and offers the upgrade when the unlimited session has lapsed', async () => {
    await lapseSessionBeforeClicking();

    expect(mockShowToast).toHaveBeenCalledWith(
      SUBSCRIPTION_COPY.subscriptionRequiredToastTitle,
      SUBSCRIPTION_COPY.subscriptionRequiredToastDesc,
      'warning'
    );
    expect(await screen.findByText(SUBSCRIPTION_COPY.upgradeTitle)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();
  });

  test('uses built-in copy for the subscription prompt when the dictionary entry is missing', async () => {
    jest.replaceProperty(UI_STRINGS, 'vendorSubscriptionModal', undefined as unknown as typeof SUBSCRIPTION_COPY);

    await lapseSessionBeforeClicking();

    expect(mockShowToast).toHaveBeenCalledWith(
      'Subscription Required',
      'Your 5 free quotation credits are exhausted. Please upgrade your subscription to continue quoting on external buyer RFQs.',
      'warning'
    );
    expect(await screen.findByText('🔒 Upgrade Plan to Submit Quotations')).toBeInTheDocument();
  });
});

// ─── Clarification requests ──────────────────────────────────────────────────

describe('clarification requests', () => {
  async function openClarification(overrides: Partial<AppState> = {}, subject = opportunity()): Promise<HTMLElement> {
    await renderForm({ vendorOpportunities: [subject], ...overrides });
    fireEvent.click(await within(rowFor(subject.rfqNumber)).findByRole('button', { name: /Clarify/ }));
    return screen.findByPlaceholderText(/Type your question regarding specs/);
  }
  const sendButton = (): HTMLElement => screen.getByRole('button', { name: /Send Clarification/ });

  test('does not dispatch anything when Enter is pressed on an empty or blank message', async () => {
    const box = await openClarification();

    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: '    ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await settle();

    expect(submitRFQInquiry).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  test('sends the trimmed question under the vendor identity and adopts the updated RFQ', async () => {
    const updatedRfq = rfq({ id: 'rfq-updated', title: 'Updated by the server' });
    jest.mocked(submitRFQInquiry).mockResolvedValue({ success: true, rfq: updatedRfq });
    const box = await openClarification();

    fireEvent.change(box, { target: { value: '  Can you deliver in batches?  ' } });
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Clarification Sent',
        'Your query has been dispatched to the procurement officer.',
        'success'
      )
    );
    expect(submitRFQInquiry).toHaveBeenCalledWith('opp-1', {
      message: 'Can you deliver in batches?',
      vendorName: VENDOR_NAME,
      vendorEmail: VENDOR_EMAIL,
    });
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      `Inquiry / Clarification submitted by ${VENDOR_NAME} on RFQ-100: "Can you deliver in batches?..."`,
      'RFQ-100',
      VENDOR_EMAIL
    );
    expect(mockAdoptCreatedRFQ).toHaveBeenCalledWith(updatedRfq);
    expect(mockRefreshFromDB).toHaveBeenCalledTimes(1);
    expect(box).toHaveValue('');
  });

  test('falls back to the signed-in name, the RFQ number and no e-mail when the vendor lookup has nothing', async () => {
    const box = await openClarification(
      { currentUserSession: { ...VENDOR_SESSION, email: '' } },
      opportunity({ id: '' })
    );

    fireEvent.change(box, { target: { value: 'Is a site visit possible?' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success'));
    expect(submitRFQInquiry).toHaveBeenCalledWith('RFQ-100', {
      message: 'Is a site visit possible?',
      vendorName: VENDOR_NAME,
      vendorEmail: null,
    });
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      `Inquiry / Clarification submitted by ${VENDOR_NAME} on RFQ-100: "Is a site visit possible?..."`,
      'RFQ-100',
      undefined
    );
    expect(mockAdoptCreatedRFQ).not.toHaveBeenCalled();
  });

  test('introduces the sender as a vendor partner when no name is known anywhere', async () => {
    const box = await openClarification({ currentUserSession: { ...VENDOR_SESSION, email: '', name: '' } });

    fireEvent.change(box, { target: { value: 'What is the payment schedule?' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success'));
    expect(submitRFQInquiry).toHaveBeenCalledWith('opp-1', {
      message: 'What is the payment schedule?',
      vendorName: 'Vendor Partner',
      vendorEmail: null,
    });
  });

  test('reports a failed dispatch with the underlying reason and lets the vendor try again', async () => {
    mockRefreshFromDB.mockRejectedValueOnce(new Error('Sync failed'));
    const box = await openClarification();

    fireEvent.change(box, { target: { value: 'Please confirm the drawing revision.' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Inquiry Failed', 'Sync failed', 'warning'));
    expect(mockShowToast).not.toHaveBeenCalledWith('Clarification Sent', expect.any(String), 'success');
    expect(box).toBeEnabled();
  });

  test('reports a failed dispatch with default wording when the failure carries no reason', async () => {
    jest.mocked(submitRFQInquiry).mockRejectedValue(new Error(''));
    const box = await openClarification();

    fireEvent.change(box, { target: { value: 'Please confirm the drawing revision.' } });
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Inquiry Failed', 'Could not dispatch clarification.', 'warning')
    );
  });
});

// ─── Deep link from the opportunity feed ─────────────────────────────────────

describe('deep-linked opportunity', () => {
  const deepLinked = opportunity({ id: 'opp-deep', rfqNumber: 'RFQ-DEEP', title: 'Deep Linked Pump' });

  test('opens the bid form only once the enquiry list has loaded and never reopens it afterwards', async () => {
    const view = await renderForm({ vendorOpportunities: [] }, { opportunity: deepLinked });
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();

    setApp({ vendorOpportunities: [deepLinked] });
    await view.refresh();
    expect(await screen.findByRole('heading', { name: BID_FORM_TITLE })).toBeInTheDocument();
    expect(screen.getByText(/RFQ-DEEP — Deep Linked Pump/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();

    setApp({ vendorOpportunities: [deepLinked, opportunity({ id: 'opp-extra', rfqNumber: 'RFQ-EXTRA' })] });
    await view.refresh();
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();
  });

  test('does not open the bid form when this vendor has already quoted the deep-linked RFQ', async () => {
    await renderForm(
      {
        rfqs: [rfq({ id: 'r-deep', rfqNumber: 'RFQ-DEEP', quotes: [quote({ vendorEmail: VENDOR_EMAIL, totalPrice: 5000 })] })],
        vendorOpportunities: [deepLinked],
      },
      { opportunity: deepLinked }
    );

    expect(within(rowFor('RFQ-DEEP')).getByText('₹5,000')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();
  });

  test('quotes a single unit when the deep-linked opportunity carries no line items', async () => {
    stubFetch({ quote: () => ({ body: { success: true, data: {} } }) });
    const withoutLineItems = { ...deepLinked, lineItems: undefined } as unknown as VendorOpportunity;
    await renderForm({ vendorOpportunities: [deepLinked] }, { opportunity: withoutLineItems });
    await screen.findByRole('heading', { name: BID_FORM_TITLE });

    fireEvent.change(screen.getByPlaceholderText('e.g. 25000'), { target: { value: '250' } });
    fireEvent.click(submitQuotationButton());

    await waitFor(() => expect(callsTo('quote')).toHaveLength(1));
    const body = bodyOf(callsTo('quote')[0]);
    expect(body).toMatchObject({ unitPrice: 250, totalPrice: 250 });
    expect(body).not.toHaveProperty('lineItemQuotes');
  });

  test('does not open the bid form when the deep-linked RFQ is locked for this vendor', async () => {
    await renderForm(
      { vendorOpportunities: [deepLinked], vendorFreeCreditsRemaining: 0 },
      { opportunity: deepLinked }
    );

    expect(within(rowFor('RFQ-DEEP')).getByText(/Premium Locked/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();
  });
});

// ─── Submitting a quote ──────────────────────────────────────────────────────

describe('quote submission', () => {
  const quoteAccepted: FetchHandler = () => ({ body: { success: true, data: {} } });
  const pdf = (name = 'spec.pdf', content = 'abc'): File => new File([content], name, { type: 'application/pdf' });
  const fillPrice = (value: string): boolean =>
    fireEvent.change(screen.getByPlaceholderText('e.g. 25000'), { target: { value } });
  const attachFiles = (...files: File[]): boolean => fireEvent.change(documentsInput(), { target: { files } });

  async function openSingleItemForm(overrides: Partial<AppState> = {}, props: Partial<FormProps> = {}): Promise<void> {
    await renderForm({ vendorOpportunities: [opportunity()], vendorUnlockedRfqIds: ['RFQ-100'], ...overrides }, props);
    await openBidFormFor();
  }

  async function openMultiItemForm(lineItems: LineItemBid[]): Promise<void> {
    await renderForm({
      vendorOpportunities: [opportunity({ id: 'o-multi', rfqNumber: 'RFQ-MULTI', lineItems })],
      vendorUnlockedRfqIds: ['RFQ-MULTI'],
    });
    await openBidFormFor('RFQ-MULTI');
  }

  /** Replaces the browser FileReader with one that fails to deliver the file. */
  function breakFileReader(outcome: 'error' | 'no-data'): void {
    class BrokenFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(): void {
        void Promise.resolve().then(() => (outcome === 'error' ? this.onerror?.() : this.onload?.()));
      }
    }
    jest.spyOn(window, 'FileReader').mockImplementation(() => new BrokenFileReader() as unknown as FileReader);
  }

  describe('single line item', () => {
    test('submits the entered terms, then audits, notifies the parent and refreshes', async () => {
      const onSubmitSuccess = jest.fn();
      stubFetch({ quote: quoteAccepted });
      await openSingleItemForm({}, { onSubmitSuccess });

      fillPrice('1500');
      fireEvent.change(screen.getByPlaceholderText('e.g. 14'), { target: { value: '12' } });
      fireEvent.change(screen.getByPlaceholderText('e.g. 1'), { target: { value: '2' } });
      fireEvent.change(screen.getByDisplayValue('45 Days Net'), { target: { value: '30 Days Net' } });
      fireEvent.change(screen.getByPlaceholderText(/Special notes/), { target: { value: 'Freight included' } });
      fireEvent.click(submitQuotationButton());

      await waitFor(() => expect(onSubmitSuccess).toHaveBeenCalledTimes(1));
      const [quoteCall] = callsTo('quote');
      expect(quoteCall[0]).toBe('/api/rfqs/RFQ-100/quotes');
      expect(bodyOf(quoteCall)).toEqual({
        unitPrice: 1500,
        totalPrice: 3000,
        leadTimeDays: 12,
        warrantyYears: 2,
        paymentTerms: '30 Days Net',
        remarks: 'Freight included',
      });
      expect(mockAddAuditLog).toHaveBeenCalledWith(
        `${VENDOR_NAME} submitted a quotation for RFQ-100 (Unit Price: 1500)`,
        'RFQ-100',
        VENDOR_EMAIL
      );
      expect(mockShowToast).toHaveBeenCalledWith('Quote Submitted', expect.stringContaining('RFQ-100'), 'success');
      expect(mockRefreshFromDB).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('heading', { name: BID_FORM_TITLE })).not.toBeInTheDocument();
    });

    test('names the submitter "Vendor" in the audit entry when nobody has a name', async () => {
      stubFetch({
        vendor: () => ({ ok: false, status: 404, body: { success: false } }),
        quote: quoteAccepted,
      });
      await openSingleItemForm({ currentUserSession: { ...VENDOR_SESSION, name: '' } });

      fillPrice('10');
      fireEvent.click(submitQuotationButton());

      await waitFor(() =>
        expect(mockAddAuditLog).toHaveBeenCalledWith(
          'Vendor submitted a quotation for RFQ-100 (Unit Price: 10)',
          'RFQ-100',
          VENDOR_EMAIL
        )
      );
    });

    test('rejects a rate that overflows the quotation total', async () => {
      await openSingleItemForm();

      fillPrice('1e308');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('The entered rate produces an invalid quotation total.')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Check the rate and quantity.', 'warning');
      expect(callsTo('quote')).toHaveLength(0);
    });
  });

  describe('multiple line items', () => {
    test('requires a rate for every line item before submitting', async () => {
      await openMultiItemForm([
        lineItem({ id: 'li-1', description: 'Pump', quantity: 2 }),
        lineItem({ id: 'li-2', description: 'Valve', quantity: 3 }),
      ]);

      fireEvent.change(screen.getByLabelText('Rate for Pump'), { target: { value: '100' } });
      fireEvent.click(submitQuotationButton());

      expect(
        await screen.findByText('Please enter a valid unit price (greater than 0) for every line item.')
      ).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Enter a unit price for every line item.', 'warning');
      expect(callsTo('quote')).toHaveLength(0);
    });

    test('rejects line-item rates whose total is not a number', async () => {
      await openMultiItemForm([
        lineItem({ id: 'li-1', description: 'Pump', quantity: undefined as unknown as number }),
        lineItem({ id: 'li-2', description: 'Valve', quantity: 3 }),
      ]);

      fireEvent.change(screen.getByLabelText('Rate for Pump'), { target: { value: '100' } });
      fireEvent.change(screen.getByLabelText('Rate for Valve'), { target: { value: '50' } });
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('The entered line-item rates produce an invalid quotation total.')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Validation Error', 'Check the line-item quantities and rates.', 'warning');
      expect(callsTo('quote')).toHaveLength(0);
    });

    test('uses the total as the unit price when no line item has a quantity', async () => {
      stubFetch({ quote: quoteAccepted });
      await openMultiItemForm([
        lineItem({ id: 'li-1', description: 'Pump', quantity: 0 }),
        lineItem({ id: 'li-2', description: 'Valve', quantity: 0 }),
      ]);

      fireEvent.change(screen.getByLabelText('Rate for Pump'), { target: { value: '10' } });
      fireEvent.change(screen.getByLabelText('Rate for Valve'), { target: { value: '20' } });
      fireEvent.click(submitQuotationButton());

      await waitFor(() => expect(callsTo('quote')).toHaveLength(1));
      const body = bodyOf(callsTo('quote')[0]);
      expect(body.unitPrice).toBe(0);
      expect(body.totalPrice).toBe(0);
      expect(body.lineItemQuotes).toEqual([
        { lineItemId: 'li-1', itemName: 'Pump', quantity: 0, unitPrice: 10, totalPrice: 0 },
        { lineItemId: 'li-2', itemName: 'Valve', quantity: 0, unitPrice: 20, totalPrice: 0 },
      ]);
    });
  });

  describe('supporting documents', () => {
    test('stops before uploading when a document has no file type', async () => {
      await openSingleItemForm();
      attachFiles(new File(['abc'], 'mystery', { type: '' }));

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('mystery has an unsupported file type.')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', 'mystery has an unsupported file type.', 'warning');
      expect(callsTo('upload')).toHaveLength(0);
      expect(callsTo('quote')).toHaveLength(0);
    });

    test('uploads each document and sends the stored attachments with the quote', async () => {
      const stored = [storedAttachment('att-1', 'spec.pdf'), storedAttachment('att-2', 'sheet.pdf')];
      let uploads = 0;
      stubFetch({
        upload: () => ({ body: { success: true, data: stored[uploads++] } }),
        quote: quoteAccepted,
      });
      const onSubmitSuccess = jest.fn();
      await openSingleItemForm({}, { onSubmitSuccess });
      attachFiles(pdf('spec.pdf', 'abc'), pdf('sheet.pdf', 'xyz'));

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      await waitFor(() => expect(onSubmitSuccess).toHaveBeenCalledTimes(1));
      const uploadCalls = callsTo('upload');
      expect(uploadCalls.map(([url]) => url)).toEqual([
        '/api/rfqs/RFQ-100/quote-attachments',
        '/api/rfqs/RFQ-100/quote-attachments',
      ]);
      expect(bodyOf(uploadCalls[0])).toEqual({ fileName: 'spec.pdf', mimeType: 'application/pdf', content: 'YWJj' });
      expect(bodyOf(uploadCalls[1])).toEqual({ fileName: 'sheet.pdf', mimeType: 'application/pdf', content: 'eHl6' });
      expect(bodyOf(callsTo('quote')[0]).attachments).toEqual(stored);
    });

    test('reports the server reason when a document upload is rejected', async () => {
      stubFetch({
        upload: () => ({ ok: false, status: 400, body: { success: false, error: 'File type not allowed' } }),
        quote: quoteAccepted,
      });
      await openSingleItemForm();
      attachFiles(pdf());

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('File type not allowed')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', 'File type not allowed', 'warning');
      expect(callsTo('quote')).toHaveLength(0);
    });

    test('names the document in a generic message when the upload response carries no data', async () => {
      stubFetch({
        upload: () => ({ body: { success: true } }),
        quote: quoteAccepted,
      });
      await openSingleItemForm();
      attachFiles(pdf());

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('Could not upload spec.pdf.')).toBeInTheDocument();
      expect(callsTo('quote')).toHaveLength(0);
    });

    test('does not upload documents again when the submission is retried after a server error', async () => {
      const stored = storedAttachment('att-1', 'spec.pdf');
      let attempts = 0;
      stubFetch({
        upload: () => ({ body: { success: true, data: stored } }),
        quote: () =>
          ++attempts === 1
            ? { ok: false, status: 500, body: { success: false, error: 'Temporary outage' } }
            : { body: { success: true, data: {} } },
      });
      const onSubmitSuccess = jest.fn();
      await openSingleItemForm({}, { onSubmitSuccess });
      attachFiles(pdf());
      fillPrice('100');

      fireEvent.click(submitQuotationButton());
      expect(await screen.findByText('Temporary outage')).toBeInTheDocument();
      fireEvent.click(submitQuotationButton());

      await waitFor(() => expect(onSubmitSuccess).toHaveBeenCalledTimes(1));
      expect(callsTo('upload')).toHaveLength(1);
      expect(callsTo('quote')).toHaveLength(2);
      expect(bodyOf(callsTo('quote')[1]).attachments).toEqual([stored]);
    });

    test.each([
      ['the browser cannot read the file', 'error' as const],
      ['the browser returns no file data', 'no-data' as const],
    ])('stops and names the document when %s', async (_label, outcome) => {
      breakFileReader(outcome);
      await openSingleItemForm();
      attachFiles(pdf());

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('Could not read spec.pdf.')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', 'Could not read spec.pdf.', 'warning');
      expect(callsTo('upload')).toHaveLength(0);
      expect(callsTo('quote')).toHaveLength(0);
    });
  });

  describe('server and network failures', () => {
    test('asks the vendor to upgrade when the server reports exhausted credits without a message', async () => {
      stubFetch({ quote: () => ({ ok: false, status: 402, body: { success: false, upgradeRequired: true } }) });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText(SUBSCRIPTION_COPY.creditsExhaustedToastDesc)).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith(
        SUBSCRIPTION_COPY.creditsExhaustedToastTitle,
        SUBSCRIPTION_COPY.creditsExhaustedToastDesc,
        'warning'
      );
      expect(screen.getByText(SUBSCRIPTION_COPY.upgradeTitle)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Upgrade Plan to Continue Quoting' })).toHaveAttribute(
        'href',
        '/vendor/vendor-subscription'
      );
    });

    test('uses built-in copy for the credits-exhausted prompt when the dictionary entry is missing', async () => {
      jest.replaceProperty(UI_STRINGS, 'vendorSubscriptionModal', undefined as unknown as typeof SUBSCRIPTION_COPY);
      stubFetch({ quote: () => ({ ok: false, status: 402, body: { success: false, upgradeRequired: true } }) });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      const fallbackMessage =
        'Your 5 free quotation credits have been used. Please upgrade your subscription plan to continue submitting quotations.';
      expect(await screen.findByText(fallbackMessage)).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Quotation Credits Exhausted', fallbackMessage, 'warning');
    });

    test('treats a 403 as exhausted credits and keeps the server message', async () => {
      stubFetch({ quote: () => ({ ok: false, status: 403, body: { success: false, error: 'Plan upgrade required' } }) });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('Plan upgrade required')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith(
        SUBSCRIPTION_COPY.creditsExhaustedToastTitle,
        'Plan upgrade required',
        'warning'
      );
      expect(screen.getByText(SUBSCRIPTION_COPY.upgradeTitle)).toBeInTheDocument();
    });

    test('shows a generic failure when the server gives no reason', async () => {
      stubFetch({ quote: () => ({ ok: false, status: 500, body: { success: false } }) });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('Failed to submit quotation.')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', 'Failed to submit quotation.', 'warning');
      expect(screen.queryByText(SUBSCRIPTION_COPY.upgradeTitle)).not.toBeInTheDocument();
    });

    test('reports a network failure with its own message', async () => {
      stubFetch({
        quote: () => {
          throw new Error('socket hang up');
        },
      });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      expect(await screen.findByText('socket hang up')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', 'socket hang up', 'warning');
    });

    test('reports a network failure with default wording when it carries no message', async () => {
      stubFetch({
        quote: () => {
          throw new Error('');
        },
      });
      await openSingleItemForm();

      fillPrice('100');
      fireEvent.click(submitQuotationButton());

      const fallbackMessage = 'Could not submit the quote. Please check your network and try again.';
      expect(await screen.findByText(fallbackMessage)).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith('Submission Failed', fallbackMessage, 'warning');
    });
  });
});

// ─── RFQ specification download ──────────────────────────────────────────────

describe('RFQ specification download', () => {
  const clickDownload = async (rfqNumber = 'RFQ-100'): Promise<void> => {
    fireEvent.click(await within(rowFor(rfqNumber)).findByRole('button', { name: /Download RFQ/ }));
  };

  test('downloads the specification and every readable attachment, naming unnamed files after the RFQ', async () => {
    stubFetch({
      preview: () => ({ body: { success: true, data: { htmlBody: '<p>Specification</p>' } } }),
      rfq: () => ({
        body: {
          success: true,
          data: { attachments: [{ id: 'att-1', fileName: 'drawing.pdf' }, { id: 'att-2' }, { id: 'att-3', fileName: 'gone.pdf' }] },
        },
      }),
      attachment: (url) => (url.endsWith('att-3') ? { ok: false, status: 404 } : { blob: new Blob(['bytes']) }),
    });
    await renderForm({ vendorOpportunities: [opportunity()] });

    await clickDownload();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'RFQ Downloaded',
        'RFQ specification for RFQ-100 has been downloaded and unlocked.',
        'success'
      )
    );
    expect(downloadedFileNames).toEqual(['RFQ-100-specification.html', 'drawing.pdf', 'RFQ-100-attachment']);
    // Every temporary object URL is released once its file has been handed to the browser.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(callsTo('attachment').map(([url]) => url)).toEqual([
      '/api/rfqs/attachments/att-1',
      '/api/rfqs/attachments/att-2',
      '/api/rfqs/attachments/att-3',
    ]);
    expect(mockRefreshVendorCredits).toHaveBeenCalledTimes(1);
    expect(mockRefreshFromDB).toHaveBeenCalledTimes(1);
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      `${VENDOR_NAME} downloaded RFQ specification for RFQ-100`,
      'RFQ-100',
      VENDOR_EMAIL
    );
  });

  test('tells the vendor when the free download allowance is used up, keeping the server message', async () => {
    stubFetch({
      preview: () => ({ ok: false, status: 403, body: { success: false, error: 'Download allowance used up' } }),
    });
    await renderForm({ vendorOpportunities: [opportunity()] });

    await clickDownload();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Free Credits Exhausted', 'Download allowance used up', 'warning')
    );
    expect(downloadedFileNames).toEqual([]);
    expect(mockRefreshVendorCredits).not.toHaveBeenCalled();
  });

  test('uses the default allowance message when the server only flags the quota as exhausted', async () => {
    stubFetch({ preview: () => ({ ok: false, status: 200, body: { success: false, exhausted: true } }) });
    await renderForm({ vendorOpportunities: [opportunity()] });

    await clickDownload();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Free Credits Exhausted',
        'You have used all 5 free RFQ download credits. You cannot download another RFQ using your free allowance.',
        'warning'
      )
    );
    expect(downloadedFileNames).toEqual([]);
  });

  test('reports a generic failure when the server gives no reason', async () => {
    stubFetch({ preview: () => ({ ok: false, status: 500, body: { success: false } }) });
    await renderForm({ vendorOpportunities: [opportunity()] });

    await clickDownload();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Download Failed', 'Could not generate the RFQ specification.', 'warning')
    );
    expect(downloadedFileNames).toEqual([]);
  });

  test('reports a network failure with default wording when it carries no message', async () => {
    stubFetch({
      preview: () => {
        throw new Error('');
      },
    });
    await renderForm({ vendorOpportunities: [opportunity()] });

    await clickDownload();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Download Failed', 'Could not download the RFQ specification.', 'warning')
    );
  });

  test('downloads the specification first when quoting on an RFQ that is not unlocked yet', async () => {
    await renderForm({ vendorOpportunities: [opportunity()], vendorUnlockedRfqIds: ['RFQ-OTHER'] });

    await openBidFormFor();

    await waitFor(() => expect(callsTo('preview')).toHaveLength(1));
    expect(callsTo('preview')[0][0]).toBe('/api/rfqs/RFQ-100/email-preview');
  });

  test('does not download again when quoting on an RFQ unlocked earlier, whatever the letter case', async () => {
    await renderForm({ vendorOpportunities: [opportunity()], vendorUnlockedRfqIds: ['rfq-100'] });

    await openBidFormFor();
    await settle();

    expect(callsTo('preview')).toHaveLength(0);
  });
});
