import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CategorySummaryDashboard, {
  parseTimestamp,
  rfqsInWindow,
  growthPercentFor,
  demandStatusFor,
  GrowthBadge,
  extractQuotesFromRfqs,
  doesBuyerMatchRfq,
  formatLocation,
  formatContactInfo,
  formatRating,
  formatContactPerson,
} from '@/app/category-manager/category-summary-dashboard';
import * as storeModule from '@/lib/store';
import { RFQItem, VendorEntry, BuyerAccount } from '@/lib/types';
import { CATEGORY_TAXONOMY_FIXTURE } from '../../../test-fixtures/categoryTaxonomy';

jest.mock('@/lib/store');

// Fixed "now" so every fixture's createdAt is relative to a known reference
// point instead of the real wall clock. Midnight keeps the day-boundary math
// in fixture comments ("N days ago") exact against date-only createdAt values.
const NOW = new Date('2026-06-15T00:00:00Z');

function makeRfq(overrides: Partial<RFQItem> & { category: string; createdAt: string }): RFQItem {
  return {
    id: `rfq-${Math.random().toString(36).slice(2)}`,
    rfqNumber: `RFQ-${Math.random().toString(36).slice(2)}`,
    title: 'Test RFQ',
    sourcingMode: 'mode_1',
    status: 'Quotes Pending',
    quotesCount: 0,
    targetDeliveryDate: '2026-12-01',
    budget: 10000,
    extractedEntities: [],
    quotes: [],
    chasingActive: false,
    ...overrides,
  };
}

function makeVendor(overrides: Partial<VendorEntry> & { majorCategory: string }): VendorEntry {
  return {
    id: `v-${Math.random().toString(36).slice(2)}`,
    name: 'Test Vendor Co',
    contactPerson: 'Test Contact',
    phone: '+91 90000 00000',
    email: 'vendor@test.com',
    minorCategories: [],
    location: 'Mumbai',
    rating: 4.0,
    source: 'buyer_manual',
    ...overrides,
  };
}

function makeBuyerAccount(overrides: Partial<BuyerAccount> & { id: string }): BuyerAccount {
  return {
    organizationName: 'Test Buyer Org',
    corporateEmail: 'buyer@test.com',
    contactPerson: 'Test Buyer',
    mobileNumber: '+91 90000 00001',
    gstin: '27AAAAA0000A1Z5',
    industrySector: 'Testing',
    sourcingMode: 'mode_1',
    subscriptionPlan: 'version_1',
    remainingFreeRFQs: 5,
    accountSource: 'web_registration',
    status: 'ACTIVE_VERIFIED',
    primaryPlantLocation: 'Mumbai',
    supportedMajorCategories: [],
    totalRFQsCreated: 0,
    totalSpend: '₹0',
    syncTimestamp: '2026-01-01 00:00 UTC',
    createdDate: '2026-01-01',
    ...overrides,
  };
}

// ── Pure time-window / growth math — direct unit tests, no rendering ───────

describe('category-summary-dashboard pure helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('parseTimestamp', () => {
    it('parses a valid date string', () => {
      expect(parseTimestamp('2026-06-01')).toBe(new Date('2026-06-01').getTime());
    });

    it('returns 0 for an unparseable string instead of NaN', () => {
      expect(parseTimestamp('not-a-date')).toBe(0);
    });
  });

  describe('rfqsInWindow', () => {
    const rfqs: RFQItem[] = [
      makeRfq({ category: 'Civil Works', createdAt: '2026-06-14' }), // 1 day ago
      makeRfq({ category: 'Civil Works', createdAt: '2026-05-01' }), // ~45 days ago
      makeRfq({ category: 'IT', createdAt: '2026-06-14' }),
    ];

    it('returns RFQs within the window, scoped to a major category', () => {
      const result = rfqsInWindow(rfqs, 30, 0, 'Civil Works');
      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBe('2026-06-14');
    });

    it('returns RFQs across all categories when none is given', () => {
      expect(rfqsInWindow(rfqs, 1, 0)).toHaveLength(2);
    });

    it('excludes RFQs outside the window', () => {
      // The 45-day-old fixture falls outside a 30-day *current* window.
      expect(rfqsInWindow(rfqs, 30, 0, 'Civil Works')).toHaveLength(1);
    });
  });

  describe('growthPercentFor', () => {
    it('returns null when there is current-period activity but no prior baseline', () => {
      const rfqs = [makeRfq({ category: 'Civil Works', createdAt: '2026-06-14' })];
      expect(growthPercentFor(rfqs, 30, 'Civil Works')).toBeNull();
    });

    it('returns 0 when both the current and prior periods have no activity', () => {
      expect(growthPercentFor([], 30, 'Civil Works')).toBe(0);
    });

    it('computes a positive percentage when current activity exceeds the prior period', () => {
      const rfqs = [
        makeRfq({ category: 'Logistics', createdAt: '2026-06-14' }),
        makeRfq({ category: 'Logistics', createdAt: '2026-06-13' }),
        makeRfq({ category: 'Logistics', createdAt: '2026-06-12' }),
        makeRfq({ category: 'Logistics', createdAt: '2026-05-01' }),
      ];
      expect(growthPercentFor(rfqs, 30, 'Logistics')).toBe(200);
    });

    it('computes a negative percentage when current activity is below the prior period', () => {
      const rfqs = [
        makeRfq({ category: 'Raw Material', createdAt: '2026-05-01' }),
        makeRfq({ category: 'Raw Material', createdAt: '2026-05-02' }),
      ];
      expect(growthPercentFor(rfqs, 30, 'Raw Material')).toBe(-100);
    });
  });

  describe('demandStatusFor', () => {
    it('classifies 0 as No Activity', () => {
      expect(demandStatusFor(0)).toBe('No Activity');
    });
    it('classifies 1 as Emerging', () => {
      expect(demandStatusFor(1)).toBe('Emerging');
    });
    it('classifies 2-4 as Growing', () => {
      expect(demandStatusFor(2)).toBe('Growing');
      expect(demandStatusFor(4)).toBe('Growing');
    });
    it('classifies 5-9 as Optimal', () => {
      expect(demandStatusFor(5)).toBe('Optimal');
      expect(demandStatusFor(9)).toBe('Optimal');
    });
    it('classifies 10+ as High Demand', () => {
      expect(demandStatusFor(10)).toBe('High Demand');
      expect(demandStatusFor(50)).toBe('High Demand');
    });
  });

  describe('GrowthBadge', () => {
    it('renders New for null value', () => {
      const { container } = render(<GrowthBadge value={null} />);
      expect(container).toHaveTextContent('New');
    });

    it('renders Flat for 0 value', () => {
      const { container } = render(<GrowthBadge value={0} />);
      expect(container).toHaveTextContent('Flat');
    });

    it('renders positive growth with plus sign', () => {
      const { container } = render(<GrowthBadge value={25.5} />);
      expect(container).toHaveTextContent('+25.5%');
    });

    it('renders negative growth without plus sign', () => {
      const { container } = render(<GrowthBadge value={-12.3} />);
      expect(container).toHaveTextContent('-12.3%');
    });
  });

  describe('extractQuotesFromRfqs', () => {
    it('extracts real quotes when quotes array is populated', () => {
      const rfq = makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-01',
        quotes: [
          {
            vendorId: 'v-1',
            vendorName: 'Apex Infra',
            vendorCategory: 'Procucev Network',
            unitPrice: 50000,
            totalPrice: 50000,
            leadTimeDays: 7,
            aiMatchScore: 90,
            warrantyYears: 1,
            complianceStatus: 'Fully Compliant',
            paymentTerms: 'Net 30',
            remarks: 'Bid details',
          },
        ],
      });
      const result = extractQuotesFromRfqs([rfq], []);
      expect(result).toHaveLength(1);
      expect(result[0].quote.vendorName).toBe('Apex Infra');
      expect(result[0].quote.unitPrice).toBe(50000);
    });

    it('synthesizes quotes when quotesCount is set but quotes array is empty', () => {
      const rfq = makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-01',
        quotesCount: 2,
        assignedVendors: [{ id: 'v-10', name: 'Vendor Ten' }],
        budget: 100000,
      });
      const vendor: VendorEntry = makeVendor({
        id: 'v-20',
        name: 'Vendor Twenty',
        majorCategory: 'Civil Works',
        minorCategories: [],
        rating: 4.5,
      });
      const result = extractQuotesFromRfqs([rfq], [vendor]);
      expect(result).toHaveLength(2);
      expect(result[0].quote.vendorName).toBe('Vendor Ten');
    });
  });

  describe('doesBuyerMatchRfq', () => {
    const account: BuyerAccount = makeBuyerAccount({
      id: 'acc-1',
      organizationName: 'Acme Corp',
      contactPerson: 'Jane Doe',
      corporateEmail: 'jane@acme.com',
      accountSource: 'public_system',
      sourcingMode: 'mode_1',
      status: 'ACTIVE_VERIFIED',
    });

    it('matches by buyerAccountId', () => {
      const rfq = makeRfq({ category: 'IT', createdAt: '2026-06-01', buyerAccountId: 'acc-1' });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(true);
    });

    it('matches by organizationName', () => {
      const rfq = makeRfq({ category: 'IT', createdAt: '2026-06-01', buyerAccountName: 'Acme Corp' });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(true);
    });

    it('matches by contactPerson', () => {
      const rfq = makeRfq({ category: 'IT', createdAt: '2026-06-01', buyerAccountName: 'Jane Doe' });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(true);
    });

    it('matches by corporateEmail', () => {
      const rfq = makeRfq({ category: 'IT', createdAt: '2026-06-01', raisedByEmail: 'jane@acme.com' });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(true);
    });

    it('returns false when no fields match', () => {
      const rfq = makeRfq({
        category: 'IT',
        createdAt: '2026-06-01',
        buyerAccountId: 'diff-id',
        buyerAccountName: 'Different Corp',
        raisedByEmail: 'diff@other.com',
      });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(false);
    });

    it('synthesizes quotes with default vendor and pricing when budget and vendors are absent', () => {
      const rfq = makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-01',
        quotesCount: 1,
        budget: undefined,
      });
      const result = extractQuotesFromRfqs([rfq], []);
      expect(result).toHaveLength(1);
      expect(result[0].quote.vendorName).toBe('Supplier Response #1');
      expect(result[0].quote.unitPrice).toBe(50000);
    });

    it('returns false for unrelated rfq', () => {
      const rfq = makeRfq({ category: 'IT', createdAt: '2026-06-01', buyerAccountId: 'acc-999' });
      expect(doesBuyerMatchRfq(account, rfq)).toBe(false);
    });
  });

  describe('formatLocation', () => {
    it('returns National when city is empty', () => {
      expect(formatLocation(undefined, undefined)).toBe('National');
    });

    it('returns city, state when both are given', () => {
      expect(formatLocation('Mumbai', 'Maharashtra')).toBe('Mumbai, Maharashtra');
    });

    it('returns city when state is not given', () => {
      expect(formatLocation('Mumbai', undefined)).toBe('Mumbai');
    });
  });

  describe('formatContactInfo', () => {
    it('returns phone when available', () => {
      expect(formatContactInfo('+91 99999', 'test@example.com')).toBe('+91 99999');
    });

    it('returns email when phone is missing', () => {
      expect(formatContactInfo(undefined, 'test@example.com')).toBe('test@example.com');
    });

    it('returns dash when both are missing', () => {
      expect(formatContactInfo(undefined, undefined)).toBe('—');
    });
  });
});

// ── Component wiring — real derived data rendered correctly ────────────────

describe('CategorySummaryDashboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const mockAddAuditLog = jest.fn();
  const mockShowToast = jest.fn();

  function mockApp(rfqs: RFQItem[], buyerVendors: VendorEntry[] = [], buyerAccounts: BuyerAccount[] = []) {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs,
      buyerVendors,
      buyerAccounts,
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
      categoryTaxonomy: CATEGORY_TAXONOMY_FIXTURE,
      categoryTaxonomyError: null,
    });
  }

  it('renders real category/RFQ/vendor counts instead of any hardcoded figures', () => {
    const rfqs = [
      makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-14',
        buyerAccountId: 'buyer-1',
        buyerAccountName: 'Real Buyer Org',
        quotesCount: 2,
        extractedEntities: [
          {
            id: 'e1',
            itemName: 'Cement',
            quantity: 10,
            unit: 'Bags',
            targetDate: '2026-07-01',
            technicalSpecs: 'Grade 53',
            confidence: 90,
            category: 'Civil Works',
            majorCategory: 'Civil Works',
            minorCategory: 'Bricks',
          },
        ],
      }),
    ];
    const vendors = [makeVendor({ majorCategory: 'Civil Works', name: 'Real Vendor Co', rating: 4.7 })];
    const accounts = [makeBuyerAccount({ id: 'buyer-1', organizationName: 'Real Buyer Org' })];
    mockApp(rfqs, vendors, accounts);

    render(<CategorySummaryDashboard />);

    expect(screen.getByText(/Category Governance & Demand-Supply Analytics/i)).toBeInTheDocument();
    // No RFQ activity yet has landed for this account, so it isn't "active".
    expect(screen.getByText('1 Buyers')).toBeInTheDocument();
    // The one real RFQ has no prior-period baseline -> "New", not a fabricated %.
    expect(screen.getAllByText('New').length).toBeGreaterThan(0);
    // Real buyer/vendor names, not the old hardcoded L&T/Apex Supplies fixtures.
    expect(screen.getAllByText('Real Buyer Org').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Real Vendor Co').length).toBeGreaterThan(0);
  });

  it('shows "Flat" growth and No Activity for a category with no RFQs at all', () => {
    mockApp([], [], []);
    render(<CategorySummaryDashboard />);

    expect(screen.getAllByText('No Activity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Flat').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No buyer activity yet').length).toBeGreaterThan(0);
  });

  it('shows a negative growth badge (not a fabricated positive one) when activity has dropped', () => {
    const rfqs = [
      makeRfq({ category: 'Raw Material', createdAt: '2026-05-01' }),
      makeRfq({ category: 'Raw Material', createdAt: '2026-05-02' }),
    ];
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    expect(screen.getAllByText('-100%').length).toBeGreaterThan(0);
  });

  it('classifies High Demand and Optimal categories from real RFQ volume', () => {
    const highDemand = Array.from({ length: 10 }, () =>
      makeRfq({ category: 'CAPEX - Equipment & Machinery', createdAt: '2026-06-14' })
    );
    const optimal = Array.from({ length: 6 }, () =>
      makeRfq({ category: 'Engineering Spares - Mechanical', createdAt: '2026-06-14' })
    );
    mockApp([...highDemand, ...optimal], [], []);
    render(<CategorySummaryDashboard />);

    expect(screen.getByText('High Demand')).toBeInTheDocument();
    expect(screen.getByText('Optimal')).toBeInTheDocument();
  });

  it('expands a category to show real per-minor-category RFQ counts', () => {
    const rfqs = [
      makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-14',
        extractedEntities: [
          {
            id: 'e1',
            itemName: 'Cement',
            quantity: 10,
            unit: 'Bags',
            targetDate: '2026-07-01',
            technicalSpecs: 'Grade 53',
            confidence: 90,
            category: 'Civil Works',
            majorCategory: 'Civil Works',
            minorCategory: 'Bricks',
          },
        ],
      }),
    ];
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Civil Works minor categories' }));

    expect(screen.getByText('Bricks')).toBeInTheDocument();
    // The tagged minor category shows a real count, not a fabricated one.
    const minorRow = screen.getByText('Bricks').closest('div')!;
    expect(minorRow).toHaveTextContent('1 RFQs');
    // An untouched minor category in the same major genuinely has zero RFQs.
    const untaggedMinor = screen.getByText('Excavation').closest('div')!;
    expect(untaggedMinor).toHaveTextContent('0 RFQs');
  });

  it('filters by search term across category, buyer, and vendor names', () => {
    const rfqs = [makeRfq({ category: 'Civil Works', createdAt: '2026-06-14', buyerAccountName: 'Searchable Buyer' })];
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    const searchInput = screen.getByPlaceholderText(/Search category, buyer, or vendor/i);
    fireEvent.change(searchInput, { target: { value: 'Searchable Buyer' } });
    expect(screen.getByText('Civil Works')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Nothing Matches This' } });
    expect(screen.getByText(/No categories match this search/i)).toBeInTheDocument();
  });

  it('logs an audit entry, shows a toast, and opens category details modal when Details is clicked and closes via X button', () => {
    const rfqs = [makeRfq({ category: 'Civil Works', createdAt: '2026-06-01' })];
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsBtns[0]);

    expect(mockAddAuditLog).toHaveBeenCalledWith(expect.stringContaining('inspected deep analytics'));
    expect(mockShowToast).toHaveBeenCalledWith('Category Telemetry', expect.any(String), 'info');
    expect(screen.getByText(/Relevant RFQs/i)).toBeInTheDocument();

    // Close using X button
    const closeBtns = screen.getAllByRole('button');
    const xBtn = closeBtns.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByText(/Relevant RFQs/i)).not.toBeInTheDocument();
  });

  it('opens and closes KPI drilldown modals when KPI cards are clicked', () => {
    const mockVendor1: VendorEntry = makeVendor({
      id: 'v-1',
      name: 'Alpha Supplies',
      majorCategory: 'Civil Works',
      minorCategories: ['Concrete'],
      rating: 4.8,
      city: 'Delhi',
      state: 'DL',
      email: 'alpha@supplies.com',
      phone: '+91 99999 88888',
    });

    const mockVendor2: VendorEntry = makeVendor({
      id: 'v-2',
      name: 'Beta Supplies',
      majorCategory: 'Civil Works',
      minorCategories: ['Concrete'],
    });

    const mockAccount: BuyerAccount = makeBuyerAccount({
      id: 'b-1',
      organizationName: 'Tata Projects',
      contactPerson: 'Sunil Verma',
      corporateEmail: 'sunil@tataprojects.com',
      accountSource: 'public_system',
      sourcingMode: 'mode_1',
      status: 'ACTIVE_VERIFIED',
    });

    const rfqs = [makeRfq({ category: 'Civil Works', createdAt: '2026-06-01', buyerAccountId: 'b-1', quotesCount: 1 })];
    mockApp(rfqs, [mockVendor1, mockVendor2], [mockAccount]);
    render(<CategorySummaryDashboard />);

    // Click Active Categories KPI card
    fireEvent.click(screen.getAllByText(/Active Categories/i)[0]);
    expect(screen.getByRole('heading', { name: /Active Categories Breakdown/i })).toBeInTheDocument();
    const xBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
    expect(screen.queryByRole('heading', { name: /Active Categories Breakdown/i })).not.toBeInTheDocument();

    // Click RFQs Raised KPI card
    fireEvent.click(screen.getAllByText(/RFQs Raised \(30D\)/i)[0]);
    expect(screen.getByRole('heading', { name: /RFQs Raised Breakdown/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Click Quotes Received KPI card
    fireEvent.click(screen.getAllByText(/Quotes Received/i)[0]);
    expect(screen.getByRole('heading', { name: /Quotes Received Breakdown/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Click Active Buyers KPI card
    fireEvent.click(screen.getAllByText(/Active Buyers/i)[0]);
    expect(screen.getByRole('heading', { name: /Active Enterprise Buyers/i })).toBeInTheDocument();
    expect(screen.getByText('Sunil Verma')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Click Available Vendors KPI card
    fireEvent.click(screen.getAllByText(/Available Vendors/i)[0]);
    expect(screen.getByRole('heading', { name: /Available Supplier Network/i })).toBeInTheDocument();
    expect(screen.getAllByText('Alpha Supplies').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByText(/Close Breakdown/i));
  });

  it('switches timeframes and recomputes the displayed RFQ count', () => {
    const rfqs = [makeRfq({ category: 'Civil Works', createdAt: '2026-06-01' })]; // 14 days ago
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    // Default is 30d, which includes this RFQ.
    expect(screen.getAllByText('RFQs Raised (30D)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 RFQs').length).toBeGreaterThan(0);

    // 7d excludes it — the RFQ is 14 days old.
    fireEvent.click(screen.getByRole('button', { name: '7 Days' }));
    expect(screen.getAllByText('RFQs Raised (7D)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 RFQs').length).toBeGreaterThan(0);
  });

  it('renders quotes in Quotes Received breakdown modal when quotes exist', () => {
    const rfqs = [
      makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-01',
        quotesCount: 2,
        quotes: [
          {
            vendorId: 'v-1',
            vendorName: 'Apex Infra Solutions',
            vendorCategory: 'Procucev Network',
            unitPrice: 45000,
            totalPrice: 45000,
            leadTimeDays: 5,
            aiMatchScore: 92,
            warrantyYears: 2,
            complianceStatus: 'Fully Compliant',
            paymentTerms: 'Net 30',
            remarks: 'Best value bid',
          },
        ],
      }),
    ];
    mockApp(rfqs, [], []);
    render(<CategorySummaryDashboard />);

    // Open Quotes Received modal
    fireEvent.click(screen.getAllByText(/Quotes Received/i)[0]);
    expect(screen.getByRole('heading', { name: /Quotes Received Breakdown/i })).toBeInTheDocument();
    expect(screen.getByText('Apex Infra Solutions')).toBeInTheDocument();
    expect(screen.getAllByText('₹45,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('5 Days')).toBeInTheDocument();
    expect(screen.queryByText(/No quotation responses recorded in this timeframe/i)).not.toBeInTheDocument();
  });

  it('switches between tabs in Category Details modal and handles explore action from categories KPI modal', () => {
    const mockVendor: VendorEntry = makeVendor({
      id: 'v-1',
      name: 'Apex Concrete Ltd',
      majorCategory: 'Civil Works',
      minorCategories: ['Concrete'],
      rating: 4.8,
      city: 'Mumbai',
      state: 'Maharashtra',
      email: 'sales@apexconcrete.com',
      contactPerson: 'Ramesh Patel',
      phone: '+91 9876543210',
      pan: 'ABCDE1234F',
      gstin: '27ABCDE1234F1Z5',
      msme: 'Medium',
    });

    const mockAccount: BuyerAccount = makeBuyerAccount({
      id: 'b-1',
      organizationName: 'Tata Projects',
      contactPerson: 'Sunil Verma',
      corporateEmail: 'sunil@tataprojects.com',
      accountSource: 'public_system',
      sourcingMode: 'mode_1',
      status: 'ACTIVE_VERIFIED',
    });

    const rfqs = [
      makeRfq({
        category: 'Civil Works',
        createdAt: '2026-06-01',
        buyerAccountId: 'b-1',
        buyerAccountName: 'Tata Projects',
        quotesCount: 1,
        quotes: [
          {
            vendorId: 'v-1',
            vendorName: 'Apex Concrete Ltd',
            vendorCategory: 'Procucev Network',
            unitPrice: 50000,
            totalPrice: 50000,
            leadTimeDays: 7,
            aiMatchScore: 90,
            warrantyYears: 1,
            complianceStatus: 'Fully Compliant',
            paymentTerms: 'Net 30',
            remarks: 'Standard rate',
          },
        ],
      }),
    ];

    mockApp(rfqs, [mockVendor], [mockAccount]);
    render(<CategorySummaryDashboard />);

    // Click Active Categories KPI card -> Explore Scope & Details
    fireEvent.click(screen.getAllByText(/Active Categories/i)[0]);
    const exploreBtn = screen.getAllByRole('button', { name: /Explore Scope & Details/i })[0];
    fireEvent.click(exploreBtn);

    // Should open Category Details Modal
    expect(screen.getByRole('heading', { name: 'Civil Works' })).toBeInTheDocument();

    // Tab 2: Quotes & Pricing
    fireEvent.click(screen.getByRole('button', { name: /Quotes & Pricing/i }));
    expect(screen.getAllByText('Apex Concrete Ltd').length).toBeGreaterThanOrEqual(1);

    // Tab 3: Enterprise Buyers
    fireEvent.click(screen.getByRole('button', { name: /Enterprise Buyers/i }));
    expect(screen.getAllByText('Tata Projects').length).toBeGreaterThanOrEqual(1);

    // Tab 4: Available Suppliers
    fireEvent.click(screen.getByRole('button', { name: /Available Suppliers/i }));
    expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();

    // Tab 5: Minor Categories
    fireEvent.click(screen.getByRole('button', { name: /Minor Categories \(/i }));
    expect(screen.getByText('Excavation')).toBeInTheDocument();

    // Back to Relevant RFQs tab
    fireEvent.click(screen.getByRole('button', { name: /Relevant RFQs \(/i }));
    expect(screen.getAllByText('Tata Projects').length).toBeGreaterThanOrEqual(1);

    // Close Details Modal
    fireEvent.click(screen.getByText('Close Details'));
    expect(screen.queryByRole('heading', { name: 'Civil Works' })).not.toBeInTheDocument();
  });

  it('handles empty states in all KPI modals and details tabs', () => {
    mockApp([], [], []);
    render(<CategorySummaryDashboard />);

    // RFQs KPI Modal with 0 RFQs
    fireEvent.click(screen.getAllByText(/RFQs Raised/i)[0]);
    expect(screen.getByText(/No RFQs created in this timeframe/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Quotes KPI Modal with 0 Quotes
    fireEvent.click(screen.getAllByText(/Quotes Received/i)[0]);
    expect(screen.getByText(/No quotation responses recorded in this timeframe/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Buyers KPI Modal with 0 Buyers
    fireEvent.click(screen.getAllByText(/Active Buyers/i)[0]);
    expect(screen.getByText(/No registered enterprise buyer accounts found/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Vendors KPI Modal with 0 Vendors
    fireEvent.click(screen.getAllByText(/Available Vendors/i)[0]);
    expect(screen.getByText(/No suppliers found in directory/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Close Breakdown/i));

    // Open Details for first category with empty data
    const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsBtns[0]);

    // Quotes tab empty state
    fireEvent.click(screen.getByRole('button', { name: /Quotes & Pricing/i }));
    expect(screen.getByText(/No supplier quotations received for this category yet/i)).toBeInTheDocument();

    // Buyers tab empty state
    fireEvent.click(screen.getByRole('button', { name: /Enterprise Buyers/i }));
    expect(screen.getByText(/No active buyers have issued RFQs for this category yet/i)).toBeInTheDocument();

    // Vendors tab empty state
    fireEvent.click(screen.getByRole('button', { name: /Available Suppliers/i }));
    expect(screen.getByText(/No suppliers mapped to/i)).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByText('Close Details'));

    // Switch remaining timeframe filters (90d, 180d, 1y)
    fireEvent.click(screen.getByRole('button', { name: '90 Days' }));
    expect(screen.getAllByText('RFQs Raised (90D)').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '180 Days' }));
    expect(screen.getAllByText('RFQs Raised (180D)').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '1 Year' }));
    expect(screen.getAllByText('RFQs Raised (1Y)').length).toBeGreaterThan(0);
  });

  it('renders populated data across all tabs in Category Details Modal', () => {
    const mockVendor: VendorEntry = makeVendor({
      id: 'v-1',
      name: 'Alpha Infra',
      majorCategory: 'Civil Works',
      minorCategories: ['Bricks'],
      rating: 4.9,
      contactPerson: 'Rajesh Sharma',
      city: 'Mumbai',
      state: 'Maharashtra',
      email: 'rajesh@alphainfra.com',
      phone: '+91 9876543210',
    });

    const mockAccount: BuyerAccount = makeBuyerAccount({
      id: 'b-1',
      organizationName: 'L&T Construction',
      contactPerson: 'Amit Patel',
      corporateEmail: 'amit@lntecc.com',
      accountSource: 'public_system',
      sourcingMode: 'mode_1',
      status: 'ACTIVE_VERIFIED',
    });

    const mockRfq = makeRfq({
      id: 'rfq-101',
      rfqNumber: 'RFQ-CIVIL-101',
      title: 'Structural Steel and Brick Work',
      category: 'Civil Works',
      createdAt: '2026-06-01',
      buyerAccountId: 'b-1',
      buyerAccountName: 'L&T Construction',
      quotesCount: 2,
      extractedEntities: [
        {
          id: 'ee-1',
          itemName: 'Bricks',
          quantity: 5000,
          unit: 'pcs',
          targetDate: '2026-07-01',
          technicalSpecs: '',
          confidence: 0.9,
          category: 'Civil Works',
          majorCategory: 'Civil Works',
          minorCategory: 'Bricks',
        },
      ],
      quotes: [
        {
          vendorId: 'v-1',
          vendorName: 'Alpha Infra',
          vendorCategory: 'Client List',
          unitPrice: 150000,
          totalPrice: 150000,
          leadTimeDays: 30,
          aiMatchScore: 90,
          warrantyYears: 1,
          complianceStatus: 'Fully Compliant',
          paymentTerms: 'Immediate delivery',
          remarks: '',
        },
      ],
    });

    mockApp([mockRfq], [mockVendor], [mockAccount]);
    render(<CategorySummaryDashboard />);

    // Open Details for Civil Works
    const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsBtns[0]);

    // Tab 1: Relevant RFQs
    expect(screen.getByText(/Relevant RFQs/i)).toBeInTheDocument();
    expect(screen.getByText('RFQ-CIVIL-101')).toBeInTheDocument();
    expect(screen.getByText('Structural Steel and Brick Work')).toBeInTheDocument();

    // Tab 2: Quotes & Pricing
    fireEvent.click(screen.getByRole('button', { name: /Quotes & Pricing/i }));
    expect(screen.getAllByText('Alpha Infra').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹1,50,000').length).toBeGreaterThanOrEqual(1);

    // Tab 3: Enterprise Buyers
    fireEvent.click(screen.getByRole('button', { name: /Enterprise Buyers/i }));
    expect(screen.getAllByText('L&T Construction').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Category RFQs:/i)).toBeInTheDocument();

    // Tab 4: Available Suppliers
    fireEvent.click(screen.getByRole('button', { name: /Available Suppliers/i }));
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    expect(screen.getByText('Mumbai, Maharashtra')).toBeInTheDocument();

    // Tab 5: Minor Categories
    fireEvent.click(screen.getByRole('button', { name: /^Minor Categories/i }));
    expect(screen.getByText(/Bricks/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 RFQs/i).length).toBeGreaterThanOrEqual(1);

    // Close Details Modal
    fireEvent.click(screen.getByText('Close Details'));
  });

  describe('formatRating and formatContactPerson helpers', () => {
    it('formats rating correctly with fallback', () => {
      expect(formatRating(4.8)).toBe('4.8');
      expect(formatRating(0)).toBe('0');
      expect(formatRating(undefined)).toBe('4.5');
      expect(formatRating(NaN)).toBe('4.5');
    });

    it('formats contact person correctly with fallback', () => {
      expect(formatContactPerson('John Doe')).toBe('John Doe');
      expect(formatContactPerson('   ')).toBe('Sales Coordinator');
      expect(formatContactPerson('')).toBe('Sales Coordinator');
      expect(formatContactPerson(undefined)).toBe('Sales Coordinator');
    });

    it('formats location correctly with city and state combinations', () => {
      expect(formatLocation('Mumbai', 'Maharashtra')).toBe('Mumbai, Maharashtra');
      expect(formatLocation('Delhi', '')).toBe('Delhi');
      expect(formatLocation('', 'Karnataka')).toBe('National');
      expect(formatLocation('', '')).toBe('National');
      expect(formatLocation(undefined, undefined)).toBe('National');
    });

    it('formats contact info with phone and email combinations', () => {
      expect(formatContactInfo('+91 99999 88888', 'a@b.com')).toBe('+91 99999 88888');
      expect(formatContactInfo('', 'a@b.com')).toBe('a@b.com');
      expect(formatContactInfo('', '')).toBe('—');
      expect(formatContactInfo(undefined, undefined)).toBe('—');
    });

    it('calculates parseTimestamp, growthPercentFor, and demandStatusFor accurately', () => {
      expect(parseTimestamp('invalid-date')).toBe(0);
      expect(parseTimestamp('2026-06-01T00:00:00Z')).toBeGreaterThan(0);

      const now = Date.now();
      const currentRfq = makeRfq({ category: 'Civil Works', createdAt: new Date(now - 86400000).toISOString() });
      const priorRfq = makeRfq({ category: 'Civil Works', createdAt: new Date(now - 10 * 86400000).toISOString() });

      expect(growthPercentFor([currentRfq, priorRfq], 7)).toBe(0);
      expect(growthPercentFor([currentRfq], 7)).toBe(null);
      expect(growthPercentFor([], 7)).toBe(0);

      expect(demandStatusFor(15)).toBe('High Demand');
      expect(demandStatusFor(7)).toBe('Optimal');
      expect(demandStatusFor(3)).toBe('Growing');
      expect(demandStatusFor(1)).toBe('Emerging');
      expect(demandStatusFor(0)).toBe('No Activity');
    });

    it('renders GrowthBadge with various values', () => {
      const { container: positive } = render(<GrowthBadge value={25} />);
      expect(positive.textContent).toContain('+25%');

      const { container: negative } = render(<GrowthBadge value={-15} />);
      expect(negative.textContent).toContain('-15%');

      const { container: flat } = render(<GrowthBadge value={0} />);
      expect(flat.textContent).toContain('Flat');

      const { container: newBadge } = render(<GrowthBadge value={null} />);
      expect(newBadge.textContent).toContain('New');
    });
  });
});
