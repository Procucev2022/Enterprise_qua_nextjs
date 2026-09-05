import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CategorySummaryDashboard, {
  parseTimestamp,
  rfqsInWindow,
  growthPercentFor,
  demandStatusFor,
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

  it('logs an audit entry and shows a toast when Details is clicked', () => {
    mockApp([], [], []);
    render(<CategorySummaryDashboard />);

    const detailsBtns = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsBtns[0]);

    expect(mockAddAuditLog).toHaveBeenCalledWith(expect.stringContaining('inspected deep analytics'));
    expect(mockShowToast).toHaveBeenCalledWith('Category Telemetry', expect.any(String), 'info');
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
});
