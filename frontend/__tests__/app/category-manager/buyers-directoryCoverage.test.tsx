import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BuyersDirectory from '@/app/category-manager/buyers-directory';
import { useApp } from '@/lib/store';
import { exportReportToExcel } from '@/lib/reportsClient';
import { CURRENCY, RFQ_MODES, RFQ_MODE_LABELS, formatCurrency, formatIndianDateTime } from '@/lib/constants';
import type { AuditLogEntry, BuyerAccount, RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/reportsClient', () => ({
  exportReportToExcel: jest.fn(),
}));

type Fields = Record<string, unknown>;
type StoreState = Partial<Pick<ReturnType<typeof useApp>, 'buyerAccounts' | 'rfqs' | 'auditLogs'>>;

// Fixtures deliberately omit optional fields, so they are built from loose records.
const makeBuyer = (fields: Fields): BuyerAccount => fields as unknown as BuyerAccount;
const makeRfq = (fields: Fields): RFQItem => fields as unknown as RFQItem;
const makeAuditLog = (fields: Fields): AuditLogEntry => fields as unknown as AuditLogEntry;

const mockStore = (state: StoreState): void => {
  (useApp as jest.Mock).mockReturnValue(state);
};

const SEARCH_PLACEHOLDER = /Search company, contact person/;
const NO_RESULTS_TEXT = 'No buyer accounts found matching your query.';
const DOSSIER_ACTION = '360° Dossier';

const TAB_NAMES = {
  rfqs: /^RFQs \(\d+\)$/,
  credits: /^Credit$/,
  communications: /^Communications \(\d+\)$/,
  payments: /^Payments \(\d+\)$/,
};

/** The value paragraph rendered directly beneath a KPI or snapshot label. */
const valueBelow = (label: string): string => screen.getByText(label).nextElementSibling?.textContent ?? '';

const parentOf = (text: string): HTMLElement => {
  const parent = screen.getByText(text).parentElement;
  if (!parent) {
    throw new Error(`"${text}" is not rendered inside a parent element`);
  }
  return parent;
};

/** Finds a table row by its visible text. Pass plain text only (it becomes a RegExp). */
const rowFor = (text: string): HTMLElement => screen.getByRole('row', { name: new RegExp(text) });

const openDossier = (organizationName: string): void => {
  fireEvent.click(within(rowFor(organizationName)).getByText(DOSSIER_ACTION));
};

const openDossierAt = (index: number): void => {
  fireEvent.click(screen.getAllByText(DOSSIER_ACTION)[index]);
};

const openTab = (name: RegExp): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};

const exportDirectory = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /Export Directory/ }));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockStore({});
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BuyersDirectory with no store data', () => {
  test('renders zero KPIs and the no-results row when the store provides no collections', () => {
    render(<BuyersDirectory />);

    expect(valueBelow('Total Buyers')).toBe('0');
    expect(screen.getByText('0 Active Verified')).toBeInTheDocument();
    expect(valueBelow('Subscription Buyers')).toBe('0');
    expect(valueBelow('Total RFQs')).toBe('0');
    expect(valueBelow('Free RFQs')).toBe('0');
    expect(valueBelow('Paid RFQs')).toBe('0');
    expect(screen.getByText(NO_RESULTS_TEXT)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rows per page')).not.toBeInTheDocument();
  });

  test('exports an empty row set under a dated Buyers_Directory file name', () => {
    render(<BuyersDirectory />);

    exportDirectory();

    expect(exportReportToExcel).toHaveBeenCalledTimes(1);
    expect(exportReportToExcel).toHaveBeenCalledWith(
      [],
      expect.stringMatching(/^Buyers_Directory_\d{4}-\d{2}-\d{2}$/),
      'BuyersDirectory',
    );
  });
});

describe('BuyersDirectory summary cards', () => {
  test('counts buyers, active accounts, sourced RFQs and per-mode buyers from the store', () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'k-1', organizationName: 'Kpi One', sourcingMode: RFQ_MODES.MODE_1, status: 'ACTIVE_VERIFIED' }),
        makeBuyer({ id: 'k-2', organizationName: 'Kpi Two', sourcingMode: RFQ_MODES.MODE_1, status: 'ACTIVE' }),
        makeBuyer({ id: 'k-3', organizationName: 'Kpi Three', sourcingMode: RFQ_MODES.MODE_2, status: 'PENDING_VERIFICATION' }),
        makeBuyer({ id: 'k-4', organizationName: 'Kpi Four', sourcingMode: RFQ_MODES.MODE_3, status: 'ACTIVE_VERIFIED' }),
        makeBuyer({ id: 'k-5', organizationName: 'Kpi Five', sourcingMode: 'legacy_custom_mode', status: 'ACTIVE' }),
      ],
      rfqs: [
        makeRfq({ id: 'k-r1', rfqNumber: 'RFQ-K-1', buyerAccountId: 'k-1', budget: 100 }),
        makeRfq({ id: 'k-r2', rfqNumber: 'RFQ-K-2', buyerAccountId: 'k-3', budget: 200 }),
      ],
    });
    render(<BuyersDirectory />);

    expect(valueBelow('Total Buyers')).toBe('5');
    expect(screen.getByText('4 Active Verified')).toBeInTheDocument();
    expect(valueBelow('Subscription Buyers')).toBe('0');
    expect(valueBelow('Total RFQs')).toBe('2');
    expect(valueBelow('Free RFQs')).toBe('2');
    expect(valueBelow('Paid RFQs')).toBe('0');
  });
});

describe('BuyersDirectory table rows', () => {
  test('falls back from city to plant location to India in the location column', () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'l-1', organizationName: 'City Co', city: 'Nashik', primaryPlantLocation: 'Ignored Plant', sourcingMode: RFQ_MODES.MODE_1 }),
        makeBuyer({ id: 'l-2', organizationName: 'Plant Co', primaryPlantLocation: 'Bawal Industrial Area', sourcingMode: RFQ_MODES.MODE_1 }),
        makeBuyer({ id: 'l-3', organizationName: 'Nowhere Co', sourcingMode: RFQ_MODES.MODE_1 }),
      ],
    });
    render(<BuyersDirectory />);

    expect(within(rowFor('City Co')).getByText('Nashik')).toBeInTheDocument();
    expect(within(rowFor('City Co')).queryByText('Ignored Plant')).not.toBeInTheDocument();
    expect(within(rowFor('Plant Co')).getByText('Bawal Industrial Area')).toBeInTheDocument();
    expect(within(rowFor('Nowhere Co')).getByText('India')).toBeInTheDocument();
  });

  test('shows singular and plural RFQ counts using the larger of the recorded and matched totals', () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'c-1', organizationName: 'Single Co', totalRFQsCreated: 1, sourcingMode: RFQ_MODES.MODE_1 }),
        makeBuyer({ id: 'c-2', organizationName: 'Empty Co', sourcingMode: RFQ_MODES.MODE_1 }),
        makeBuyer({ id: 'c-3', organizationName: 'Live Co', totalRFQsCreated: 2, sourcingMode: RFQ_MODES.MODE_1 }),
        makeBuyer({ id: 'c-4', organizationName: 'Recorded Co', totalRFQsCreated: 7, sourcingMode: RFQ_MODES.MODE_1 }),
      ],
      rfqs: [
        makeRfq({ id: 'c-r1', rfqNumber: 'RFQ-C-1', buyerAccountId: 'c-3' }),
        makeRfq({ id: 'c-r2', rfqNumber: 'RFQ-C-2', buyerAccountId: 'c-3' }),
        makeRfq({ id: 'c-r3', rfqNumber: 'RFQ-C-3', buyerAccountId: 'c-3' }),
        makeRfq({ id: 'c-r4', rfqNumber: 'RFQ-C-4', buyerAccountId: 'c-4' }),
      ],
    });
    render(<BuyersDirectory />);

    expect(within(rowFor('Single Co')).getByText('1 RFQ')).toBeInTheDocument();
    expect(within(rowFor('Empty Co')).getByText('0 RFQs')).toBeInTheDocument();
    expect(within(rowFor('Live Co')).getByText('3 RFQs')).toBeInTheDocument();
    expect(within(rowFor('Recorded Co')).getByText('7 RFQs')).toBeInTheDocument();
  });

  test('shows placeholders for a missing status, plan and unrecognised sourcing mode', () => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 's-1', organizationName: 'Bare Co', sourcingMode: 'unmapped_mode' })],
    });
    render(<BuyersDirectory />);

    const bare = within(rowFor('Bare Co'));
    expect(bare.getByText('ACTIVE')).toBeInTheDocument();
    expect(bare.getByText('Free Trial')).toBeInTheDocument();
    expect(bare.getByText(RFQ_MODE_LABELS[RFQ_MODES.MODE_0])).toBeInTheDocument();
  });

  test('shows the recorded plan and mode and colour-codes verified versus unverified statuses', () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 's-2', organizationName: 'Pending Co', subscriptionPlan: 'version_2', status: 'PENDING_VERIFICATION', sourcingMode: RFQ_MODES.MODE_2 }),
        makeBuyer({ id: 's-3', organizationName: 'Verified Co', status: 'ACTIVE_VERIFIED', sourcingMode: RFQ_MODES.MODE_1 }),
      ],
    });
    render(<BuyersDirectory />);

    const pending = within(rowFor('Pending Co'));
    expect(pending.getByText('PENDING_VERIFICATION')).toHaveClass('bg-amber-50');
    expect(pending.getByText('version_2')).toBeInTheDocument();
    expect(pending.getByText(RFQ_MODE_LABELS[RFQ_MODES.MODE_2])).toBeInTheDocument();
    expect(within(rowFor('Verified Co')).getByText('ACTIVE_VERIFIED')).toHaveClass('bg-emerald-50');
  });
});

describe('BuyersDirectory search and filters', () => {
  const searchBuyers = [
    makeBuyer({ id: 'f-1', organizationName: 'Alpha Forge', contactPerson: 'Ravi Menon', corporateEmail: 'ravi@alpha.example', city: 'Pune', primaryPlantLocation: 'Chakan MIDC', sourcingMode: RFQ_MODES.MODE_1, status: 'ACTIVE_VERIFIED' }),
    makeBuyer({ id: 'f-2', organizationName: 'Beta Works', contactPerson: 'Meera Iyer', corporateEmail: 'meera@beta.example', city: 'Pune', primaryPlantLocation: 'Talegaon Plant', sourcingMode: RFQ_MODES.MODE_2, status: 'ACTIVE' }),
    makeBuyer({ id: 'f-3', organizationName: 'Gamma Mills', sourcingMode: RFQ_MODES.MODE_1, status: 'PENDING_VERIFICATION' }),
  ];

  test('matches contact person, plant location and city ignoring case, skipping buyers without them', () => {
    mockStore({ buyerAccounts: searchBuyers });
    render(<BuyersDirectory />);
    const search = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);

    fireEvent.change(search, { target: { value: 'RAVI MENON' } });
    expect(screen.getByText('Alpha Forge')).toBeInTheDocument();
    expect(screen.queryByText('Beta Works')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'talegaon' } });
    expect(screen.getByText('Beta Works')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Forge')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'pune' } });
    expect(screen.getByText('Alpha Forge')).toBeInTheDocument();
    expect(screen.getByText('Beta Works')).toBeInTheDocument();
    expect(screen.queryByText('Gamma Mills')).not.toBeInTheDocument();
  });

  test('combines search text with mode and status filters and recovers when they are cleared', () => {
    mockStore({ buyerAccounts: searchBuyers });
    render(<BuyersDirectory />);
    const search = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    const modeFilter = screen.getByDisplayValue('All Sourcing Modes');
    const statusFilter = screen.getByDisplayValue('All Statuses');

    fireEvent.change(search, { target: { value: 'pune' } });
    fireEvent.change(modeFilter, { target: { value: RFQ_MODES.MODE_2 } });
    expect(screen.getByText('Beta Works')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Forge')).not.toBeInTheDocument();

    fireEvent.change(statusFilter, { target: { value: 'PENDING_VERIFICATION' } });
    expect(screen.getByText(NO_RESULTS_TEXT)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(modeFilter, { target: { value: 'all' } });
    expect(screen.getByText('Gamma Mills')).toBeInTheDocument();
    expect(screen.queryByText('Beta Works')).not.toBeInTheDocument();

    fireEvent.change(statusFilter, { target: { value: 'all' } });
    expect(screen.getAllByText(DOSSIER_ACTION)).toHaveLength(3);
  });
});

describe('BuyersDirectory RFQ attribution', () => {
  const attributionBuyers = [
    makeBuyer({ id: 'm-1', organizationName: 'Alpha Forge', corporateEmail: 'Procure@Alpha.example', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'm-2', organizationName: 'Beta Works', corporateEmail: 'ops@beta.example', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'm-3', organizationName: 'Gamma Mills', corporateEmail: 'ops@gamma.example', buyerAccountId: 'legacy-gamma-77', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'm-4', organizationName: 'Delta Corp', sourcingMode: RFQ_MODES.MODE_1 }),
  ];
  const attributionRfqs = [
    makeRfq({ id: 'mr-1', rfqNumber: 'RFQ-M-EMAIL', title: 'Raised by email', raisedByEmail: '  procure@ALPHA.example ' }),
    makeRfq({ id: 'mr-2', rfqNumber: 'RFQ-M-NAME', title: 'Named organisation', buyerAccountName: '  beta WORKS ' }),
    makeRfq({ id: 'mr-3', rfqNumber: 'RFQ-M-LEGACY', title: 'Legacy account id', buyerAccountId: 'legacy-gamma-77' }),
    makeRfq({ id: 'mr-4', rfqNumber: 'RFQ-M-NOEMAIL', title: 'Email only', raisedByEmail: 'someone@delta.example' }),
    makeRfq({
      id: 'mr-5',
      rfqNumber: 'RFQ-M-OTHER',
      title: 'Unrelated',
      raisedByEmail: 'nobody@else.example',
      buyerAccountName: 'Unrelated Org',
      buyerAccountId: 'ghost-id',
    }),
  ];

  test.each<[string, string, string]>([
    ['raised-by email, trimmed and case-insensitive', 'Alpha Forge', 'RFQ-M-EMAIL'],
    ['buyer account name, trimmed and case-insensitive', 'Beta Works', 'RFQ-M-NAME'],
    ['legacy buyerAccountId property on the account', 'Gamma Mills', 'RFQ-M-LEGACY'],
  ])('attributes an RFQ to a buyer through the %s', (_rule, organizationName, rfqNumber) => {
    mockStore({ buyerAccounts: attributionBuyers, rfqs: attributionRfqs });
    render(<BuyersDirectory />);

    expect(within(rowFor(organizationName)).getByText('1 RFQ')).toBeInTheDocument();
    openDossier(organizationName);
    openTab(TAB_NAMES.rfqs);

    expect(screen.getByRole('button', { name: 'RFQs (1)' })).toBeInTheDocument();
    expect(screen.getByText(rfqNumber)).toBeInTheDocument();
    expect(screen.queryByText('RFQ-M-OTHER')).not.toBeInTheDocument();
    expect(screen.queryByText('RFQ-M-NOEMAIL')).not.toBeInTheDocument();
  });

  test('does not attribute an email-only RFQ to a buyer that has no corporate email', () => {
    mockStore({ buyerAccounts: attributionBuyers, rfqs: attributionRfqs });
    render(<BuyersDirectory />);

    expect(within(rowFor('Delta Corp')).getByText('0 RFQs')).toBeInTheDocument();
  });
});

describe('BuyersDirectory sourced spend', () => {
  const spendBuyers = [
    makeBuyer({ id: 'sp-1', organizationName: 'Live Spend Co', totalSpend: `${CURRENCY.SYMBOL}9,99,999`, sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'sp-2', organizationName: 'History Co', totalSpend: '$1,200', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'sp-3', organizationName: 'Zero Dollar Co', totalSpend: '$0', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'sp-4', organizationName: 'Opaque Co', totalSpend: 'TBD', sourcingMode: RFQ_MODES.MODE_1 }),
    makeBuyer({ id: 'sp-5', organizationName: 'Blank Co', sourcingMode: RFQ_MODES.MODE_1 }),
  ];
  const spendRfqs = [
    makeRfq({ id: 'sp-r1', rfqNumber: 'RFQ-SP-1', buyerAccountId: 'sp-1', budget: 0, awardedAmount: 120000 }),
    makeRfq({ id: 'sp-r2', rfqNumber: 'RFQ-SP-2', buyerAccountId: 'sp-1', budget: 0, quotes: [{ totalPrice: 98000 }, { totalPrice: 1 }] }),
    makeRfq({ id: 'sp-r3', rfqNumber: 'RFQ-SP-3', buyerAccountId: 'sp-1', budget: 0, quotes: [{ totalPrice: 'n/a' }] }),
    makeRfq({ id: 'sp-r4', rfqNumber: 'RFQ-SP-4', buyerAccountId: 'sp-1', budget: 50000, awardedAmount: 999 }),
  ];

  test.each<[string, string, string]>([
    ['budget, then awarded amount, then first quote price, ignoring a non-numeric price', 'Live Spend Co', formatCurrency(268000)],
    ['the historical baseline when no RFQ carries a value', 'History Co', formatCurrency(1200)],
    ['a rupee-converted baseline text when the baseline parses to zero', 'Zero Dollar Co', `${CURRENCY.SYMBOL}0`],
    ['the raw baseline text when it holds no digits', 'Opaque Co', 'TBD'],
    ['a rupee zero when no baseline is recorded', 'Blank Co', `${CURRENCY.SYMBOL}0`],
  ])('dossier spend is derived from %s', (_source, organizationName, expectedSpend) => {
    mockStore({ buyerAccounts: spendBuyers, rfqs: spendRfqs });
    render(<BuyersDirectory />);

    openDossier(organizationName);

    expect(valueBelow('Total Sourced Spend')).toBe(expectedSpend);
  });

  test('counts every matched RFQ for the buyer even when only some carry a value', () => {
    mockStore({ buyerAccounts: spendBuyers, rfqs: spendRfqs });
    render(<BuyersDirectory />);

    expect(within(rowFor('Live Spend Co')).getByText('4 RFQs')).toBeInTheDocument();
  });
});

describe('BuyersDirectory dossier when the buyer leaves the store', () => {
  test.each<[string, Fields, string, string]>([
    ['the recorded RFQ total and a rupee-converted spend baseline', { totalRFQsCreated: 12, totalSpend: '$4,500' }, '12', `${CURRENCY.SYMBOL}4,500`],
    ['zero RFQs and a zero rupee spend', {}, '0', `${CURRENCY.SYMBOL}0`],
  ])('keeps the open dossier usable with %s', (_fallback, extraFields, expectedRfqCount, expectedSpend) => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'gone-1', organizationName: 'Vanishing Co', sourcingMode: RFQ_MODES.MODE_1, ...extraFields })],
    });
    const { rerender } = render(<BuyersDirectory />);
    openDossier('Vanishing Co');

    mockStore({ buyerAccounts: [] });
    rerender(<BuyersDirectory />);

    expect(screen.getByRole('heading', { name: 'Vanishing Co' })).toBeInTheDocument();
    expect(valueBelow('Total RFQs Sourced')).toBe(expectedRfqCount);
    expect(valueBelow('Total Sourced Spend')).toBe(expectedSpend);
    openTab(/^RFQs \(0\)$/);
    expect(screen.getByText('No RFQs created by this buyer yet.')).toBeInTheDocument();
  });
});

describe('BuyersDirectory dossier profile', () => {
  test('shows the formatted registration time and mode badge in the dossier header', () => {
    const createdDate = '2026-03-04T05:06:07Z';
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'dated-1', organizationName: 'Dated Co', createdDate, sourcingMode: RFQ_MODES.MODE_3 })],
    });
    render(<BuyersDirectory />);

    openDossier('Dated Co');

    expect(screen.getByText(/Registered:/)).toHaveTextContent(`Registered: ${formatIndianDateTime(createdDate)}`);
    expect(screen.queryByText(/ID: dated-1/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dated Co' }).nextElementSibling).toHaveTextContent(
      RFQ_MODE_LABELS[RFQ_MODES.MODE_3],
    );
  });

  test('uses placeholders throughout the profile for a buyer that has only the mandatory details', () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'sparse-1', organizationName: 'Sparse Profile Co', corporateEmail: 'sparse@profile.example', sourcingMode: 'unmapped_mode' }),
      ],
    });
    render(<BuyersDirectory />);

    openDossier('Sparse Profile Co');

    expect(screen.getByText(/Registered:/)).toHaveTextContent(/Registered:\s*Verified Enterprise/);
    expect(screen.queryByText(/ID: sparse-1/)).not.toBeInTheDocument();
    const contact = within(parentOf('Corporate Contact'));
    expect(contact.getByText('Procurement Executive')).toBeInTheDocument();
    expect(contact.getByText('sparse@profile.example')).toBeInTheDocument();
    expect(contact.getByText('+91 Not provided')).toBeInTheDocument();
    expect(contact.getByText('India')).toBeInTheDocument();
    expect(screen.getByText('Sourcing Mode:').parentElement).toHaveTextContent('Sourcing Mode: Mode 0');
    expect(screen.getByText('Subscription Tier:').parentElement).toHaveTextContent('Subscription Tier: Enterprise Trial');
    expect(screen.getByText('Status:').parentElement).toHaveTextContent('Status: ACTIVE');
    expect(screen.getByText('Last Synced:').parentElement).toHaveTextContent('Last Synced: Real-time');
    expect(valueBelow('Available Quota')).toBe('5');
    ['General Procurement', 'Raw Materials', 'Spares'].forEach((category) => {
      expect(screen.getByText(category)).toBeInTheDocument();
    });
  });

  test.each<[string, Fields, string]>([
    ['a city and no plant location', { city: 'Nashik' }, 'Nashik, India'],
    ['a plant location and no city', { primaryPlantLocation: 'Bawal Industrial Area' }, 'Bawal Industrial Area'],
    ['both a city and a plant location', { city: 'Pune', primaryPlantLocation: 'Chakan MIDC' }, 'Pune, Chakan MIDC'],
  ])('writes the contact address for %s', (_case, locationFields, expectedAddress) => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'addr-1', organizationName: 'Address Co', sourcingMode: RFQ_MODES.MODE_1, ...locationFields })],
    });
    render(<BuyersDirectory />);

    openDossier('Address Co');

    expect(within(parentOf('Corporate Contact')).getByText(expectedAddress)).toBeInTheDocument();
  });

  test('reopens on the profile tab after another tab was open for the previous buyer', () => {
    mockStore({ buyerAccounts: [makeBuyer({ id: 'reopen-1', organizationName: 'Reopen Co', sourcingMode: RFQ_MODES.MODE_1 })] });
    render(<BuyersDirectory />);

    openDossier('Reopen Co');
    openTab(TAB_NAMES.credits);
    expect(screen.getByText('Remaining Free Credits')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close Dossier'));
    expect(screen.queryByText('Remaining Free Credits')).not.toBeInTheDocument();

    openDossier('Reopen Co');

    expect(screen.getByText('Corporate Contact')).toBeInTheDocument();
    expect(screen.queryByText('Remaining Free Credits')).not.toBeInTheDocument();
  });
});

describe('BuyersDirectory dossier RFQ history', () => {
  const rfqBuyer = makeBuyer({ id: 'rt-1', organizationName: 'Rfq Tab Co', corporateEmail: 'rfq@tab.example', sourcingMode: RFQ_MODES.MODE_2 });
  const detailedRfq = makeRfq({
    id: 'rt-r1',
    rfqNumber: 'RFQ-T-FULL',
    title: 'Full details',
    buyerAccountId: 'rt-1',
    sourcingMode: RFQ_MODES.MODE_2,
    budget: 250000,
    assignedVendors: [{}, {}],
    quotes: [{ totalPrice: 10 }, { totalPrice: 20 }, { totalPrice: 30 }],
    status: 'In Evaluation',
  });
  const bareRfq = makeRfq({ id: 'rt-r2', rfqNumber: 'RFQ-T-BARE', title: 'Bare minimum', buyerAccountId: 'rt-1', sourcingMode: 'unmapped_mode', budget: 0 });

  test('lists RFQs and allows clicking RFQ number to open details popup modal', () => {
    mockStore({ buyerAccounts: [rfqBuyer], rfqs: [detailedRfq, bareRfq] });
    render(<BuyersDirectory />);
    openDossier('Rfq Tab Co');

    openTab(TAB_NAMES.rfqs);

    expect(screen.getByText('RFQ-T-FULL')).toBeInTheDocument();
    expect(screen.getByText('RFQ-T-BARE')).toBeInTheDocument();

    // Click RFQ number to open details popup modal
    fireEvent.click(screen.getByText('RFQ-T-FULL'));
    expect(screen.getByText('Line Items & Technical Specifications')).toBeInTheDocument();
  });

  test('offers popup action per row and onSelectRFQ callback', () => {
    const onSelectRFQ = jest.fn();
    mockStore({ buyerAccounts: [rfqBuyer], rfqs: [detailedRfq, bareRfq] });
    render(<BuyersDirectory onSelectRFQ={onSelectRFQ} />);
    openDossier('Rfq Tab Co');
    openTab(TAB_NAMES.rfqs);

    const viewPopupBtns = screen.getAllByTitle('View RFQ Popup');
    expect(viewPopupBtns.length).toBeGreaterThan(0);
    fireEvent.click(viewPopupBtns[0]);
    expect(screen.getByText('Line Items & Technical Specifications')).toBeInTheDocument();

    const viewFullBtn = screen.getByText(/View Full Details/i);
    fireEvent.click(viewFullBtn);
    expect(onSelectRFQ).toHaveBeenCalledTimes(1);
  });
});

describe('BuyersDirectory dossier credits', () => {
  test('displays credit summary cards and entitlement mode', async () => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'cr-1', organizationName: 'Credit Co', remainingFreeRFQs: 5, sourcingMode: RFQ_MODES.MODE_1 })],
    });
    render(<BuyersDirectory />);
    openDossier('Credit Co');

    openTab(TAB_NAMES.credits);

    expect(await screen.findByText('Remaining Free Credits')).toBeInTheDocument();
    expect(screen.getByText('Total Credits Consumed')).toBeInTheDocument();
    expect(screen.getByText('Entitlement Mode')).toBeInTheDocument();
  });

  test.each<[string, string, string]>([
    ['a recognised sourcing mode', RFQ_MODES.MODE_3, RFQ_MODE_LABELS[RFQ_MODES.MODE_3]],
    ['an unrecognised sourcing mode', 'unmapped_mode', 'Mode 0'],
  ])('labels the entitlement mode for %s', async (_case, sourcingMode, expectedLabel) => {
    mockStore({ buyerAccounts: [makeBuyer({ id: 'ent-1', organizationName: 'Entitled Co', sourcingMode })] });
    render(<BuyersDirectory />);
    openDossier('Entitled Co');

    openTab(TAB_NAMES.credits);

    const elements = await screen.findAllByText(expectedLabel);
    expect(elements.length).toBeGreaterThan(0);
  });
});

describe('BuyersDirectory dossier communications and payments', () => {
  test('opens communications tab and displays communication channels sub-tabs', async () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'comm-1', organizationName: 'Comm Co', contactPerson: 'Nisha Verma', corporateEmail: 'nisha@comm.example', sourcingMode: RFQ_MODES.MODE_1 }),
      ],
    });
    render(<BuyersDirectory />);
    openDossier('Comm Co');

    openTab(TAB_NAMES.communications);
    expect(await screen.findByRole('button', { name: /Email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SMS/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /WhatsApp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call Logs/i })).toBeInTheDocument();
  });

  test('opens payments tab and displays payment history controls', async () => {
    mockStore({
      buyerAccounts: [
        makeBuyer({ id: 'pay42xyz', organizationName: 'Payer Co', sourcingMode: RFQ_MODES.MODE_1 }),
      ],
    });
    render(<BuyersDirectory />);
    openDossier('Payer Co');

    openTab(TAB_NAMES.payments);
    expect(await screen.findByText('Total Amount Paid')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search payments by invoice or description/i)).toBeInTheDocument();
  });
});

describe('BuyersDirectory dossier audit history', () => {
  test('verifies that the Audit tab is removed from visible navigation per dossier enhancement standard', () => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'aud-1', organizationName: 'Audit Co', sourcingMode: RFQ_MODES.MODE_1 })],
    });
    render(<BuyersDirectory />);
    openDossier('Audit Co');

    expect(screen.queryByRole('button', { name: /^Audit$/ })).not.toBeInTheDocument();
  });

  test('never renders an Audit tab regardless of audit log collection state', () => {
    mockStore({
      buyerAccounts: [makeBuyer({ id: 'aud-2', organizationName: 'Audit Two', sourcingMode: RFQ_MODES.MODE_1 })],
      auditLogs: [
        makeAuditLog({ id: 'nm-1', action: 'UNRELATED_EVENT', details: 'Something else', timestamp: '2026-03-01T10:00:00Z' }),
      ],
    });
    render(<BuyersDirectory />);
    openDossierAt(0);

    expect(screen.queryByRole('button', { name: /^Audit$/ })).not.toBeInTheDocument();
  });
});

describe('BuyersDirectory export', () => {
  const exportBuyers = [
    makeBuyer({
      id: 'e-1',
      organizationName: 'Export One',
      contactPerson: 'Asha Rao',
      corporateEmail: 'asha@export-one.example',
      mobileNumber: '+910000000001',
      city: 'Chennai',
      primaryPlantLocation: 'Ennore Plant',
      sourcingMode: RFQ_MODES.MODE_2,
      subscriptionPlan: 'version_2',
      remainingFreeRFQs: 0,
      totalRFQsCreated: 3,
      totalSpend: `${CURRENCY.SYMBOL}1,00,000`,
      status: 'ACTIVE_VERIFIED',
    }),
    makeBuyer({ id: 'e-2', organizationName: 'Export Two', corporateEmail: 'two@export.example', sourcingMode: 'legacy_mode', totalSpend: '$250' }),
    makeBuyer({ id: 'e-3', organizationName: 'Export Three', corporateEmail: 'three@export.example', sourcingMode: RFQ_MODES.MODE_1, totalSpend: '$0' }),
  ];
  const exportRfqs = [
    makeRfq({ id: 'e-r1', rfqNumber: 'RFQ-E-1', buyerAccountId: 'e-1', budget: 30000 }),
    makeRfq({ id: 'e-r2', rfqNumber: 'RFQ-E-2', buyerAccountId: 'e-1', budget: 20000 }),
  ];

  test('exports one row per buyer with live spend, fallbacks applied and a dated file name', () => {
    jest.useFakeTimers({ now: new Date('2026-05-17T10:00:00Z') });
    mockStore({ buyerAccounts: exportBuyers, rfqs: exportRfqs });
    render(<BuyersDirectory />);

    exportDirectory();

    expect(exportReportToExcel).toHaveBeenCalledTimes(1);
    expect(exportReportToExcel).toHaveBeenCalledWith(
      [
        {
          OrganizationName: 'Export One',
          ContactPerson: 'Asha Rao',
          Email: 'asha@export-one.example',
          Phone: '+910000000001',
          City: 'Chennai',
          PlantLocation: 'Ennore Plant',
          SourcingMode: RFQ_MODE_LABELS[RFQ_MODES.MODE_2],
          Plan: 'version_2',
          RemainingFreeRFQs: 0,
          TotalRFQsCreated: 3,
          TotalSpend: formatCurrency(50000),
          Status: 'ACTIVE_VERIFIED',
        },
        {
          OrganizationName: 'Export Two',
          ContactPerson: '',
          Email: 'two@export.example',
          City: '',
          PlantLocation: '',
          SourcingMode: 'Mode 0',
          Plan: 'standard',
          RemainingFreeRFQs: 5,
          TotalRFQsCreated: 0,
          TotalSpend: formatCurrency(250),
          Status: 'ACTIVE',
        },
        {
          OrganizationName: 'Export Three',
          ContactPerson: '',
          Email: 'three@export.example',
          City: '',
          PlantLocation: '',
          SourcingMode: RFQ_MODE_LABELS[RFQ_MODES.MODE_1],
          Plan: 'standard',
          RemainingFreeRFQs: 5,
          TotalRFQsCreated: 0,
          TotalSpend: `${CURRENCY.SYMBOL}0`,
          Status: 'ACTIVE',
        },
      ],
      'Buyers_Directory_2026-05-17',
      'BuyersDirectory',
    );
  });

  test('exports only the buyers that match the current search', () => {
    mockStore({ buyerAccounts: exportBuyers, rfqs: exportRfqs });
    render(<BuyersDirectory />);
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'ASHA@' } });

    exportDirectory();

    expect(exportReportToExcel).toHaveBeenCalledWith(
      [expect.objectContaining({ OrganizationName: 'Export One', TotalRFQsCreated: 3 })],
      expect.stringMatching(/^Buyers_Directory_\d{4}-\d{2}-\d{2}$/),
      'BuyersDirectory',
    );
  });
});

describe('BuyersDirectory pagination', () => {
  const makeDirectory = (count: number): BuyerAccount[] =>
    Array.from({ length: count }, (_, index) => {
      const position = String(index + 1).padStart(3, '0');
      return makeBuyer({
        id: `pg-${position}`,
        organizationName: `Buyer ${position}`,
        corporateEmail: `buyer${position}@directory.example`,
        sourcingMode: RFQ_MODES.MODE_1,
        status: 'ACTIVE_VERIFIED',
      });
    });

  const expectEntries = (from: number, to: number, total: number): void => {
    expect(parentOf('Showing')).toHaveTextContent(`Showing${from}to${to}of${total}entries`);
  };

  const visiblePageNumbers = (): string[] =>
    screen.getAllByRole('button', { name: /^Page \d+$/ }).map((button) => button.textContent ?? '');

  test('steps through pages with Next and Previous and disables them at either end', () => {
    mockStore({ buyerAccounts: makeDirectory(25) });
    render(<BuyersDirectory />);

    expectEntries(1, 10, 25);
    expect(screen.getByText('Buyer 001')).toBeInTheDocument();
    expect(screen.queryByText('Buyer 011')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).toBeEnabled();

    fireEvent.click(screen.getByLabelText('Next page'));
    expectEntries(11, 20, 25);
    expect(screen.getByText('Buyer 011')).toBeInTheDocument();
    expect(screen.queryByText('Buyer 001')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeEnabled();

    fireEvent.click(screen.getByLabelText('Next page'));
    expectEntries(21, 25, 25);
    expect(screen.getByLabelText('Next page')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Previous page'));
    expectEntries(11, 20, 25);
  });

  test('jumps straight to a numbered page and marks only that page as current', () => {
    mockStore({ buyerAccounts: makeDirectory(25) });
    render(<BuyersDirectory />);
    expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Page 3')).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByLabelText('Page 3'));

    expectEntries(21, 25, 25);
    expect(screen.getByLabelText('Page 3')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Page 1')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Buyer 025')).toBeInTheDocument();
  });

  test.each<[string, () => HTMLElement, string]>([
    ['search text', () => screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'Buyer'],
    ['sourcing mode filter', () => screen.getByDisplayValue('All Sourcing Modes'), RFQ_MODES.MODE_1],
    ['status filter', () => screen.getByDisplayValue('All Statuses'), 'ACTIVE_VERIFIED'],
  ])('returns to the first page when the %s changes', (_control, findControl, value) => {
    mockStore({ buyerAccounts: makeDirectory(25) });
    render(<BuyersDirectory />);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expectEntries(21, 25, 25);

    fireEvent.change(findControl(), { target: { value } });

    expectEntries(1, 10, 25);
    expect(screen.getByLabelText('Page 1')).toHaveAttribute('aria-current', 'page');
  });

  test('re-slices the directory and returns to the first page when rows per page changes', () => {
    mockStore({ buyerAccounts: makeDirectory(95) });
    render(<BuyersDirectory />);
    fireEvent.click(screen.getByLabelText('Page 10'));
    expectEntries(91, 95, 95);

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expectEntries(1, 50, 95);
    expect(visiblePageNumbers()).toEqual(['1', '2']);

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } });
    expectEntries(1, 95, 95);
    expect(visiblePageNumbers()).toEqual(['1']);
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  test('shows every page number while there are at most seven pages', () => {
    mockStore({ buyerAccounts: makeDirectory(61) });
    render(<BuyersDirectory />);

    expect(visiblePageNumbers()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(screen.queryByText('...')).not.toBeInTheDocument();
  });

  test('collapses distant page numbers around the current page once there are more than seven pages', () => {
    mockStore({ buyerAccounts: makeDirectory(95) });
    render(<BuyersDirectory />);

    expect(visiblePageNumbers()).toEqual(['1', '2', '10']);
    expect(screen.getAllByText('...')).toHaveLength(1);

    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByLabelText('Next page'));
    }
    expectEntries(41, 50, 95);
    expect(visiblePageNumbers()).toEqual(['1', '4', '5', '6', '10']);
    expect(screen.getAllByText('...')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Page 10'));
    expectEntries(91, 95, 95);
    expect(visiblePageNumbers()).toEqual(['1', '9', '10']);
    expect(screen.getAllByText('...')).toHaveLength(1);
  });

  test('clamps to the last page when the buyer list shrinks while a later page is open', () => {
    mockStore({ buyerAccounts: makeDirectory(25) });
    const { rerender } = render(<BuyersDirectory />);
    fireEvent.click(screen.getByLabelText('Page 3'));
    expectEntries(21, 25, 25);

    mockStore({ buyerAccounts: makeDirectory(12) });
    rerender(<BuyersDirectory />);

    expectEntries(11, 12, 12);
    expect(screen.getByLabelText('Page 2')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByText('Buyer 012')).toBeInTheDocument();
  });
});
describe('BuyersDirectory Additional Branch Coverage', () => {
  test('exercises sorting with undefined / empty fields across all columns', () => {
    const allColsVisible = [
      { key: 'organizationName', label: 'Buyer', visible: true, required: true },
      { key: 'contactPerson', label: 'Contact Person', visible: true },
      { key: 'corporateEmail', label: 'Email', visible: true },
      { key: 'mobileNumber', label: 'Phone', visible: true },
      { key: 'location', label: 'Location', visible: true },
      { key: 'sourcingMode', label: 'Mode', visible: true },
      { key: 'subscriptionPlan', label: 'Plan', visible: true },
      { key: 'totalRFQsCreated', label: 'RFQs', visible: true },
      { key: 'remainingFreeRFQs', label: 'Free Credits', visible: true },
      { key: 'totalSpend', label: 'Total Spend', visible: true },
      { key: 'status', label: 'Status', visible: true },
      { key: 'createdDate', label: 'Registration Date', visible: true },
      { key: 'actions', label: 'Actions', visible: true, required: true },
    ];
    window.localStorage.setItem('buyer_directory_columns_pref', JSON.stringify(allColsVisible));

    const b1 = makeBuyer({
      id: 'b-empty-1',
      organizationName: undefined,
      contactPerson: undefined,
      corporateEmail: undefined,
      mobileNumber: undefined,
      city: undefined,
      primaryPlantLocation: undefined,
      sourcingMode: undefined,
      subscriptionPlan: undefined,
      status: undefined,
      totalRFQsCreated: undefined,
      remainingFreeRFQs: undefined,
      createdDate: undefined,
    });
    const b2 = makeBuyer({
      id: 'b-partial-2',
      organizationName: 'Alpha Corp',
      contactPerson: 'Alice',
      corporateEmail: 'alice@alpha.com',
      mobileNumber: '9999999999',
      city: undefined,
      primaryPlantLocation: 'Pune Plant',
      sourcingMode: 'mode_1',
      subscriptionPlan: 'Enterprise growth tier',
      status: 'Active & Verified',
      totalRFQsCreated: 10,
      remainingFreeRFQs: 2,
      createdDate: '2026-01-01T00:00:00.000Z',
    });
    const b3 = makeBuyer({
      id: 'b-full-3',
      organizationName: 'Beta Corp',
      contactPerson: 'Bob',
      corporateEmail: 'bob@beta.com',
      mobileNumber: '8888888888',
      city: 'Mumbai',
      primaryPlantLocation: undefined,
      sourcingMode: 'mode_2',
      subscriptionPlan: 'Enterprise custom plan',
      status: 'Pending Verification',
      totalRFQsCreated: 5,
      remainingFreeRFQs: 4,
      createdDate: '2026-05-01T00:00:00.000Z',
    });

    mockStore({ buyerAccounts: [b1, b2, b3], rfqs: [] });
    render(<BuyersDirectory />);

    const columnHeaders = [
      'Buyer',
      'Contact Person',
      'Email',
      'Phone',
      'Location',
      'Mode',
      'Plan',
      'RFQs',
      'Free Credits',
      'Total Spend',
      'Status',
      'Registration Date',
    ];

    columnHeaders.forEach((name) => {
      const th = screen.queryByRole('columnheader', { name: new RegExp(name, 'i') });
      if (th) {
        fireEvent.click(th);
        fireEvent.click(th);
      }
    });
  });

  test('exercises communications and payments with growth, custom, and empty subscription plans', () => {
    const growthBuyer = makeBuyer({
      id: 'b-growth',
      organizationName: 'Growth Buyer',
      subscriptionPlan: 'growth_tier',
      corporateEmail: undefined,
      createdDate: '2026-01-15T10:00:00.000Z',
    });
    const customBuyer = makeBuyer({
      id: 'b-custom',
      organizationName: 'Custom Buyer',
      subscriptionPlan: 'custom_enterprise',
      corporateEmail: 'custom@buyer.com',
      createdDate: '2026-02-15T10:00:00.000Z',
    });
    const freeBuyer = makeBuyer({
      id: 'b-free',
      organizationName: 'Free Buyer',
      subscriptionPlan: '',
      corporateEmail: 'free@buyer.com',
      createdDate: undefined,
    });

    const weirdRfq = makeRfq({
      id: 'rfq-weird',
      buyerAccountId: 'b-growth',
      rfqNumber: 'RFQ-W-1',
      title: 'Weird RFQ',
      createdAt: '2026-01-20T00:00:00.000Z',
      sourcingMode: 'unknown_mode',
      assignedVendors: undefined,
    });

    mockStore({
      buyerAccounts: [growthBuyer, customBuyer, freeBuyer],
      rfqs: [weirdRfq],
    });

    render(<BuyersDirectory />);

    fireEvent.click(within(rowFor('Growth Buyer')).getByText(DOSSIER_ACTION));
    expect(screen.getByLabelText('Close dossier')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close dossier'));

    fireEvent.click(within(rowFor('Custom Buyer')).getByText(DOSSIER_ACTION));
    expect(screen.getByLabelText('Close dossier')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close dossier'));

    fireEvent.click(within(rowFor('Free Buyer')).getByText(DOSSIER_ACTION));
    expect(screen.getByLabelText('Close dossier')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close dossier'));
  });

  test('search matching city, primaryPlantLocation, and corporateEmail', () => {
    const b1 = makeBuyer({
      id: 'b-search-test',
      organizationName: 'Special Sourcing Corp',
      city: 'Ahmedabad',
      primaryPlantLocation: 'Gujarat SEZ',
      subscriptionPlan: 'Diamond Tier',
      corporateEmail: 'procurement@specialsourcing.com',
      sourcingMode: 'mode_3',
      status: 'Active & Verified',
    });

    mockStore({ buyerAccounts: [b1], rfqs: [] });
    render(<BuyersDirectory />);

    const searchInput = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);

    fireEvent.change(searchInput, { target: { value: 'Ahmedabad' } });
    expect(screen.getByText('Special Sourcing Corp')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Gujarat SEZ' } });
    expect(screen.getByText('Special Sourcing Corp')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'procurement@special' } });
    expect(screen.getByText('Special Sourcing Corp')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('Special Sourcing Corp')).toBeInTheDocument();
  });
});
