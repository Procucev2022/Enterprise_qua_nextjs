import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import DailyDownloadableReports from '@/app/category-manager/daily-reports';
import {
  REPORT_OPTIONS,
  exportReportToCsv,
  exportReportToExcel,
  fetchReportData,
} from '@/lib/reportsClient';
import type { ReportCategoryKey, ReportConfig } from '@/lib/reportsClient';

jest.mock('@/lib/reportsClient', () => {
  const actual = jest.requireActual('@/lib/reportsClient');
  return {
    ...actual,
    fetchReportData: jest.fn(),
    exportReportToExcel: jest.fn(),
    exportReportToCsv: jest.fn(),
  };
});

type FetchResult = Awaited<ReturnType<typeof fetchReportData>>;
type ReportRow = Record<string, unknown>;
type DateCase = [description: string, start: string, end: string, suffix: string];
type PresetCase = [label: string, start: string, end: string, hint: string];

const mockFetchReportData = jest.mocked(fetchReportData);
const mockExportExcel = jest.mocked(exportReportToExcel);
const mockExportCsv = jest.mocked(exportReportToCsv);

// The screen hard-codes its copy (none of it comes from UI_STRINGS), so the literals are asserted as rendered.
const REFRESH_LABEL = 'Refresh / Query Report';
const GENERATING_LABEL = 'Generating Report...';
const LOADING_TEXT = 'Fetching and preparing report dataset...';
const EMPTY_TEXT = 'No records found for the selected date range or query.';
const GENERIC_FAILURE_TEXT = 'Failed to generate report.';
const EXCEL_LABEL = 'Excel (.xlsx)';
const CSV_LABEL = 'CSV (.csv)';
const SEARCH_PLACEHOLDER = 'Search report columns...';
const START_DATE_LABEL = 'Start Date';
const END_DATE_LABEL = 'End Date';
const CLEAR_DATES_LABEL = 'Clear dates';
const NO_DATES_HINT = 'No dates selected by default';
const CUSTOM_RANGE_HINT = 'Custom manual date range active';
const ACTIVE_TAB_CLASS = 'bg-indigo-600';
const ACTIVE_PRESET_CLASS = 'border-indigo-600';

const TAB_LABELS: Record<'seller' | 'rfq' | 'buyer', string> = {
  seller: 'Seller Reports',
  rfq: 'RFQ Reports',
  buyer: 'Buyer Reports',
};
const PRESET_LABELS = ['Today', '7 Days', '30 Days', 'Month'];
const LOCKABLE_BUTTONS = [EXCEL_LABEL, CSV_LABEL, ...Object.values(TAB_LABELS), ...PRESET_LABELS];

// 15 June 2026 at noon, built from local components so the expected YYYY-MM-DD values hold in any time zone.
const FIXED_NOW = new Date(2026, 5, 15, 12, 0, 0);

const PRESET_CASES: PresetCase[] = [
  ['Today', '2026-06-15', '2026-06-15', 'Filtering records for today'],
  ['7 Days', '2026-06-08', '2026-06-15', 'Filtering records for last 7 days'],
  ['30 Days', '2026-05-16', '2026-06-15', 'Filtering records for last 30 days'],
  ['Month', '2026-06-01', '2026-06-15', 'Filtering records for this calendar month'],
];

const DATE_CASES: DateCase[] = [
  ['no dates are applied', '', '', 'All_Time'],
  ['only a start date is applied', '2026-05-01', '', '2026-05-01_to_all'],
  ['only an end date is applied', '', '2026-05-20', 'all_to_2026-05-20'],
  ['both dates are applied', '2026-05-01', '2026-05-20', '2026-05-01_to_2026-05-20'],
];

const SELLER_ROWS: ReportRow[] = [
  { RFQID: 'RFQ-101', SellerCompanyName: 'Orion Fabricators', SourcingMode: 'Mode 1', Status: 'Quote Submitted' },
  { RFQID: 'RFQ-102', SellerCompanyName: 'Zenith Valves', SourcingMode: 'Mode 2', Status: 'Pending Bid' },
];

// Every location and login column is present but blank in different combinations, so each fallback in the
// load-time clean-up (and in the table cell) is exercised.
const LOCATION_LOGIN_ROWS: ReportRow[] = [
  {
    Seller: 'Alpha Supplies',
    CompanyLocation: '',
    SellerLocation: 'Pune',
    DeliveryLocation: 'Surat',
    LastLogin: '',
    LoginDateTime: '2026-06-01 09:30',
    LastLoginDate: '2026-05-30',
  },
  {
    Seller: 'Beta Tech',
    CompanyLocation: null,
    SellerLocation: '',
    DeliveryLocation: 'Chennai',
    LastLogin: null,
    LoginDateTime: '',
    LastLoginDate: '2026-05-29',
  },
  {
    Seller: 'Gamma Works',
    CompanyLocation: '',
    SellerLocation: '',
    DeliveryLocation: '',
    LastLogin: '',
    LoginDateTime: '',
    LastLoginDate: '',
  },
  {
    Seller: 'Delta Corp',
    CompanyLocation: 'Mumbai',
    SellerLocation: 'Pune',
    DeliveryLocation: '',
    LastLogin: '2026-06-10 08:00',
    LoginDateTime: '',
    LastLoginDate: '',
  },
];

function reportById(id: string): ReportConfig {
  const report = REPORT_OPTIONS.find((option) => option.id === id);
  if (!report) {
    throw new Error(`Report "${id}" is not registered`);
  }
  return report;
}

const SELLER_DETAILED = reportById('seller_detailed');

const reportsIn = (category: ReportCategoryKey): ReportConfig[] =>
  REPORT_OPTIONS.filter((option) => option.category === category);

const loaded = (data: ReportRow[], totalRecords?: number): FetchResult => ({ success: true, data, totalRecords });

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const renderReports = (initialCategory?: ReportCategoryKey) =>
  render(<DailyDownloadableReports initialCategory={initialCategory} />);

/** Resolves once the in-flight request has settled: the refresh button only shows its idle label then. */
const waitForIdle = (): Promise<HTMLElement> => screen.findByText(REFRESH_LABEL);

const button = (name: string): HTMLElement => screen.getByRole('button', { name });

// DOM order: the sub-report selector sits in the filter card, the page-size selector in the table toolbar.
const getReportSelect = (): HTMLElement => screen.getAllByRole('combobox')[0];
const getPageSizeSelect = (): HTMLElement => screen.getAllByRole('combobox')[1];

const optionLabels = (): string[] =>
  within(getReportSelect())
    .queryAllByRole('option')
    .map((option) => option.textContent ?? '');

const readHeaders = (): string[] => screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '');

/** Maps every column header to the text of that cell for the given data row (0-based). */
const readRow = (rowIndex: number): Record<string, string> => {
  const cells = within(screen.getAllByRole('row')[rowIndex + 1]).getAllByRole('cell');
  return Object.fromEntries(
    readHeaders().map((header, index): [string, string] => [header, cells[index].textContent ?? ''])
  );
};

const countDataRows = (): number => screen.getAllByRole('row').length - 1;

const changeDate = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/** Applies the range one bound at a time (each edit triggers its own query) and waits for each to settle. */
const applyDateRange = async (start: string, end: string): Promise<void> => {
  if (start) {
    changeDate(START_DATE_LABEL, start);
    await waitForIdle();
  }
  if (end) {
    changeDate(END_DATE_LABEL, end);
    await waitForIdle();
  }
};

// Only Date is faked: timers and microtasks stay real so Testing Library's polling keeps working.
const freezeDate = (): void => {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
};

beforeEach(() => {
  mockFetchReportData.mockReset();
  mockExportExcel.mockReset();
  mockExportCsv.mockReset();
  mockFetchReportData.mockResolvedValue(loaded(SELLER_ROWS));
});

describe('DailyDownloadableReports initial load', () => {
  test('queries the first report of the initial category once, without date bounds', async () => {
    renderReports();
    await waitForIdle();

    expect(mockFetchReportData).toHaveBeenCalledTimes(1);
    expect(mockFetchReportData).toHaveBeenCalledWith(SELLER_DETAILED, '', '');
    expect(screen.getByText('Report loaded successfully (2 records).')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-2 of 2 records')).toBeInTheDocument();
    expect(screen.getByText(NO_DATES_HINT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CLEAR_DATES_LABEL })).not.toBeInTheDocument();
    expect(button(TAB_LABELS.seller)).toHaveClass(ACTIVE_TAB_CLASS);
  });

  test('locks every control and shows the loading state while a request is in flight', async () => {
    const pending = createDeferred<FetchResult>();
    mockFetchReportData.mockReturnValueOnce(pending.promise);
    renderReports();

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(REFRESH_LABEL)).not.toBeInTheDocument();
    expect(button(GENERATING_LABEL)).toBeDisabled();
    LOCKABLE_BUTTONS.forEach((name) => expect(button(name)).toBeDisabled());
    expect(screen.getByLabelText(START_DATE_LABEL)).toBeDisabled();
    expect(screen.getByLabelText(END_DATE_LABEL)).toBeDisabled();
    expect(getReportSelect()).toBeDisabled();

    await act(async () => {
      pending.resolve(loaded(SELLER_ROWS));
    });
    await waitForIdle();

    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(button(REFRESH_LABEL)).toBeEnabled();
    LOCKABLE_BUTTONS.forEach((name) => expect(button(name)).toBeEnabled());
    expect(screen.getByLabelText(START_DATE_LABEL)).toBeEnabled();
    expect(screen.getByLabelText(END_DATE_LABEL)).toBeEnabled();
    expect(getReportSelect()).toBeEnabled();
  });

  test('falls back to the seller detailed report when the initial category has no registered reports', async () => {
    renderReports('not-a-category' as ReportCategoryKey);
    await waitForIdle();

    expect(mockFetchReportData).toHaveBeenCalledTimes(1);
    expect(mockFetchReportData).toHaveBeenCalledWith(SELLER_DETAILED, '', '');
    expect(optionLabels()).toEqual([]);
    expect(screen.getByText(SELLER_DETAILED.description)).toBeInTheDocument();
    Object.values(TAB_LABELS).forEach((label) => expect(button(label)).not.toHaveClass(ACTIVE_TAB_CLASS));
    expect(screen.getByText('Orion Fabricators')).toBeInTheDocument();
  });
});

describe('DailyDownloadableReports report selection', () => {
  test.each(REPORT_OPTIONS)('opens the $id report from the dropdown of its category', async (report) => {
    renderReports(report.category);
    await waitForIdle();

    expect(optionLabels()).toEqual(reportsIn(report.category).map((entry) => entry.label));

    fireEvent.change(getReportSelect(), { target: { value: report.id } });
    await waitForIdle();

    expect(getReportSelect()).toHaveValue(report.id);
    expect(screen.getByText(report.description)).toBeInTheDocument();
    expect(mockFetchReportData).toHaveBeenLastCalledWith(report, '', '');
  });

  test('each category tab lists only its own reports, highlights itself and loads its first report', async () => {
    renderReports();
    await waitForIdle();

    const visits = ['rfq', 'buyer', 'seller'] as const;
    for (let index = 0; index < visits.length; index += 1) {
      const category = visits[index];
      fireEvent.click(button(TAB_LABELS[category]));
      await waitForIdle();

      const reports = reportsIn(category);
      expect(mockFetchReportData).toHaveBeenCalledTimes(index + 2);
      expect(mockFetchReportData).toHaveBeenLastCalledWith(reports[0], '', '');
      expect(button(TAB_LABELS[category])).toHaveClass(ACTIVE_TAB_CLASS);
      expect(optionLabels()).toEqual(reports.map((report) => report.label));
      expect(getReportSelect()).toHaveValue(reports[0].id);
      expect(screen.getByText(reports[0].description)).toBeInTheDocument();
    }

    expect(button(TAB_LABELS.rfq)).not.toHaveClass(ACTIVE_TAB_CLASS);
    expect(button(TAB_LABELS.buyer)).not.toHaveClass(ACTIVE_TAB_CLASS);
  });

  test('queries the first registered report for an unrecognised dropdown value, then snaps back to the category', async () => {
    renderReports('buyer');
    await waitForIdle();
    const buyerDefault = reportById('buyer_detailed');
    expect(mockFetchReportData).toHaveBeenCalledTimes(1);

    fireEvent.change(getReportSelect(), { target: { value: 'not-a-registered-report' } });
    await waitForIdle();

    expect(mockFetchReportData).toHaveBeenNthCalledWith(2, SELLER_DETAILED, '', '');
    expect(mockFetchReportData).toHaveBeenLastCalledWith(buyerDefault, '', '');
    expect(getReportSelect()).toHaveValue(buyerDefault.id);
    expect(screen.getByText(buyerDefault.description)).toBeInTheDocument();
  });
});

describe('DailyDownloadableReports status messages', () => {
  test('reports zero records when a successful response carries neither rows nor a total', async () => {
    mockFetchReportData.mockResolvedValue({ success: true, summary: { rfqsCreated: 5 } });
    renderReports('daily_activity');
    await waitForIdle();

    expect(mockFetchReportData).toHaveBeenCalledWith(reportById('daily_activity'), '', '');
    expect(screen.getByText('Report loaded successfully (0 records).')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.getByText('Showing 0-0 of 0 records')).toBeInTheDocument();
    expect(button(EXCEL_LABEL)).toBeDisabled();
    expect(button(CSV_LABEL)).toBeDisabled();
    Object.values(TAB_LABELS).forEach((label) => expect(button(label)).not.toHaveClass(ACTIVE_TAB_CLASS));
  });

  test('prefers the total reported by the server over the number of rows returned', async () => {
    mockFetchReportData.mockResolvedValue(loaded(SELLER_ROWS, 42));
    renderReports();
    await waitForIdle();

    expect(screen.getByText('Report loaded successfully (42 records).')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-2 of 2 records')).toBeInTheDocument();
  });

  test('shows a generic message when a failed response carries no error text', async () => {
    mockFetchReportData.mockResolvedValue({ success: false });
    renderReports();
    await waitForIdle();

    expect(screen.getByText(GENERIC_FAILURE_TEXT)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(/Report loaded successfully/)).not.toBeInTheDocument();
  });

  test('replaces a server error with the success message once a refresh succeeds', async () => {
    mockFetchReportData.mockResolvedValueOnce({ success: false, error: 'Backend service timeout' });
    renderReports();
    await waitForIdle();

    expect(screen.getByText('Backend service timeout')).toBeInTheDocument();
    expect(button(EXCEL_LABEL)).toBeDisabled();
    expect(button(CSV_LABEL)).toBeDisabled();

    fireEvent.click(button(REFRESH_LABEL));
    await waitForIdle();

    expect(screen.getByText('Report loaded successfully (2 records).')).toBeInTheDocument();
    expect(screen.queryByText('Backend service timeout')).not.toBeInTheDocument();
    expect(screen.getByText('Orion Fabricators')).toBeInTheDocument();
    expect(button(EXCEL_LABEL)).toBeEnabled();
    expect(button(CSV_LABEL)).toBeEnabled();
  });

  test('clears the rows that were on screen when a later request fails', async () => {
    renderReports();
    await waitForIdle();
    expect(screen.getByText('Orion Fabricators')).toBeInTheDocument();

    mockFetchReportData.mockResolvedValueOnce({ success: false, error: 'Gateway unavailable' });
    fireEvent.click(button(REFRESH_LABEL));
    await waitForIdle();

    expect(screen.getByText('Gateway unavailable')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('Orion Fabricators')).not.toBeInTheDocument();
    expect(button(CSV_LABEL)).toBeDisabled();
  });
});

describe('DailyDownloadableReports date filters', () => {
  beforeEach(freezeDate);

  afterEach(() => {
    jest.useRealTimers();
  });

  test.each(PRESET_CASES)(
    'the %s preset fills %s to %s, highlights itself and re-queries the report',
    async (label, start, end, hint) => {
      renderReports();
      await waitForIdle();
      expect(screen.getByText(NO_DATES_HINT)).toBeInTheDocument();

      fireEvent.click(button(label));

      expect(screen.getByLabelText(START_DATE_LABEL)).toHaveValue(start);
      expect(screen.getByLabelText(END_DATE_LABEL)).toHaveValue(end);
      expect(screen.getByText(hint)).toBeInTheDocument();
      expect(screen.queryByText(NO_DATES_HINT)).not.toBeInTheDocument();
      expect(mockFetchReportData).toHaveBeenLastCalledWith(SELLER_DETAILED, start, end);
      await waitForIdle();

      expect(button(label)).toHaveClass(ACTIVE_PRESET_CLASS);
      PRESET_LABELS.filter((other) => other !== label).forEach((other) => {
        expect(button(other)).not.toHaveClass(ACTIVE_PRESET_CLASS);
      });
    }
  );

  test('editing a date after a preset keeps the other bound and switches to a custom range', async () => {
    renderReports();
    await waitForIdle();
    fireEvent.click(button('Today'));
    await waitForIdle();

    changeDate(END_DATE_LABEL, '2026-06-20');
    expect(screen.getByText(CUSTOM_RANGE_HINT)).toBeInTheDocument();
    expect(mockFetchReportData).toHaveBeenLastCalledWith(SELLER_DETAILED, '2026-06-15', '2026-06-20');
    expect(button('Today')).not.toHaveClass(ACTIVE_PRESET_CLASS);
    await waitForIdle();

    changeDate(START_DATE_LABEL, '2026-06-01');
    expect(mockFetchReportData).toHaveBeenLastCalledWith(SELLER_DETAILED, '2026-06-01', '2026-06-20');
    await waitForIdle();

    expect(screen.getByLabelText(START_DATE_LABEL)).toHaveValue('2026-06-01');
    expect(screen.getByLabelText(END_DATE_LABEL)).toHaveValue('2026-06-20');
    expect(screen.getByText(CUSTOM_RANGE_HINT)).toBeInTheDocument();
  });

  test('clear dates empties both inputs, restores the default hint and re-queries without bounds', async () => {
    renderReports();
    await waitForIdle();
    fireEvent.click(button('7 Days'));
    await waitForIdle();
    expect(screen.getByText('Filtering records for last 7 days')).toBeInTheDocument();

    fireEvent.click(button(CLEAR_DATES_LABEL));

    expect(screen.getByLabelText(START_DATE_LABEL)).toHaveValue('');
    expect(screen.getByLabelText(END_DATE_LABEL)).toHaveValue('');
    expect(screen.getByText(NO_DATES_HINT)).toBeInTheDocument();
    expect(mockFetchReportData).toHaveBeenLastCalledWith(SELLER_DETAILED, '', '');
    await waitForIdle();

    expect(screen.queryByRole('button', { name: CLEAR_DATES_LABEL })).not.toBeInTheDocument();
    expect(button('7 Days')).not.toHaveClass(ACTIVE_PRESET_CLASS);
  });
});

describe('DailyDownloadableReports table cells', () => {
  test('fills blank company locations and last logins from the alternate fields while loading', async () => {
    mockFetchReportData.mockResolvedValue(loaded(LOCATION_LOGIN_ROWS));
    renderReports();
    await waitForIdle();

    const rows = [0, 1, 2, 3].map((index) => readRow(index));

    expect(rows.map((row) => row.CompanyLocation)).toEqual(['Pune', 'Chennai', 'All India', 'Mumbai']);
    expect(rows.map((row) => row.LastLogin)).toEqual(['2026-06-01 09:30', '2026-05-29', 'Never', '2026-06-10 08:00']);
    expect(rows[0]).toMatchObject({ SellerLocation: 'Pune', DeliveryLocation: 'Surat', LoginDateTime: '2026-06-01 09:30' });
    expect(rows[3]).toMatchObject({ SellerLocation: 'Pune', DeliveryLocation: '', LoginDateTime: '' });
  });

  test('hands the cleaned-up rows, not the raw server rows, to the exports', async () => {
    mockFetchReportData.mockResolvedValue(loaded(LOCATION_LOGIN_ROWS));
    renderReports();
    await waitForIdle();

    fireEvent.click(button(EXCEL_LABEL));
    fireEvent.click(button(CSV_LABEL));

    const [excelRows] = mockExportExcel.mock.calls[0];
    const [csvRows] = mockExportCsv.mock.calls[0];
    expect(excelRows.map((row) => row.CompanyLocation)).toEqual(['Pune', 'Chennai', 'All India', 'Mumbai']);
    expect(excelRows.map((row) => row.LastLogin)).toEqual(['2026-06-01 09:30', '2026-05-29', '', '2026-06-10 08:00']);
    expect(csvRows).toEqual(excelRows);
  });

  test('falls back to alternate location and login fields for rows that lack those columns', async () => {
    mockFetchReportData.mockResolvedValue(
      loaded([
        { Seller: 'Alpha Supplies', CompanyLocation: 'Mumbai', LastLogin: '2026-06-10 08:00' },
        { Seller: 'Beta Tech', SellerLocation: 'Nagpur', LoginDateTime: '2026-06-09 17:45' },
        { Seller: 'Gamma Works', DeliveryLocation: 'Kochi', LastLoginDate: '2026-06-08' },
        { Seller: 'Delta Corp' },
      ])
    );
    renderReports();
    await waitForIdle();

    expect(readHeaders()).toEqual(['Seller', 'CompanyLocation', 'LastLogin']);
    expect(readRow(0)).toEqual({ Seller: 'Alpha Supplies', CompanyLocation: 'Mumbai', LastLogin: '2026-06-10 08:00' });
    expect(readRow(1)).toEqual({ Seller: 'Beta Tech', CompanyLocation: 'Nagpur', LastLogin: '2026-06-09 17:45' });
    expect(readRow(2)).toEqual({ Seller: 'Gamma Works', CompanyLocation: 'Kochi', LastLogin: '2026-06-08' });
    expect(readRow(3)).toEqual({ Seller: 'Delta Corp', CompanyLocation: 'All India', LastLogin: 'Never' });
  });

  test('renders null and missing values as blank while keeping zero and false visible', async () => {
    mockFetchReportData.mockResolvedValue(
      loaded([
        { Seller: 'Orion Fabricators', Quotes: 0, Remarks: null, Approved: false },
        { Seller: 'Zenith Valves', Quotes: 4, Approved: true },
      ])
    );
    renderReports();
    await waitForIdle();

    expect(readHeaders()).toEqual(['Seller', 'Quotes', 'Remarks', 'Approved']);
    expect(readRow(0)).toEqual({ Seller: 'Orion Fabricators', Quotes: '0', Remarks: '', Approved: 'false' });
    expect(readRow(1)).toEqual({ Seller: 'Zenith Valves', Quotes: '4', Remarks: '', Approved: 'true' });
  });

  test('shows the sourcing mode as given and falls back to Mode 0 when it is blank or null', async () => {
    mockFetchReportData.mockResolvedValue(
      loaded([
        { Seller: 'Orion Fabricators', SourcingMode: 'Mode 3' },
        { Seller: 'Zenith Valves', SourcingMode: '' },
        { Seller: 'Apex Traders', SourcingMode: null },
      ])
    );
    renderReports();
    await waitForIdle();

    expect([0, 1, 2].map((index) => readRow(index).SourcingMode)).toEqual(['Mode 3', 'Mode 0', 'Mode 0']);
  });
});

describe('DailyDownloadableReports search', () => {
  const SEARCH_ROWS: ReportRow[] = [
    { Seller: 'Alpha Supplies', Remarks: null, Region: 'West' },
    { Seller: 'Beta Tech', Remarks: '', Region: 'South' },
    { Seller: 'Gamma Works', Remarks: 'Urgent follow-up', Region: '' },
  ];

  const sellersShown = (): string[] =>
    screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent ?? '');

  const search = (value: string): void => {
    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value } });
  };

  beforeEach(() => {
    mockFetchReportData.mockResolvedValue(loaded(SEARCH_ROWS));
  });

  test('matches any column case-insensitively and treats blank cells as empty text', async () => {
    renderReports();
    await waitForIdle();
    expect(sellersShown()).toEqual(['Alpha Supplies', 'Beta Tech', 'Gamma Works']);

    search('URGENT');
    expect(sellersShown()).toEqual(['Gamma Works']);
    expect(screen.getByText('Showing 1-1 of 1 records')).toBeInTheDocument();

    search('south');
    expect(sellersShown()).toEqual(['Beta Tech']);
  });

  test('ignores a whitespace-only query', async () => {
    renderReports();
    await waitForIdle();

    search('   ');

    expect(sellersShown()).toEqual(['Alpha Supplies', 'Beta Tech', 'Gamma Works']);
    expect(screen.getByText('Showing 1-3 of 3 records')).toBeInTheDocument();
  });

  test('shows the empty state when nothing matches and restores the rows once the query is cleared', async () => {
    renderReports();
    await waitForIdle();

    search('no-such-seller');

    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.getByText('Showing 0-0 of 0 records')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    search('');

    expect(sellersShown()).toEqual(['Alpha Supplies', 'Beta Tech', 'Gamma Works']);
  });
});

describe('DailyDownloadableReports pagination', () => {
  const PAGED_ROWS: ReportRow[] = Array.from({ length: 25 }, (_, index) => ({
    RFQID: `RFQ-${index}`,
    Seller: `Vendor ${index}`,
  }));

  const pageLabel = (current: number, total: number): string => `Page ${current} of ${total}`;

  beforeEach(() => {
    mockFetchReportData.mockResolvedValue(loaded(PAGED_ROWS));
  });

  test('walks through the pages and disables the edge buttons', async () => {
    renderReports();
    await waitForIdle();

    expect(screen.getByText(pageLabel(1, 3))).toBeInTheDocument();
    expect(screen.getByText('Showing 1-10 of 25 records')).toBeInTheDocument();
    expect(countDataRows()).toBe(10);
    expect(button('Previous')).toBeDisabled();
    expect(button('Next')).toBeEnabled();

    fireEvent.click(button('Next'));
    expect(screen.getByText(pageLabel(2, 3))).toBeInTheDocument();
    expect(screen.getByText('Showing 11-20 of 25 records')).toBeInTheDocument();
    expect(screen.getByText('Vendor 10')).toBeInTheDocument();
    expect(button('Previous')).toBeEnabled();
    expect(button('Next')).toBeEnabled();

    fireEvent.click(button('Next'));
    expect(screen.getByText(pageLabel(3, 3))).toBeInTheDocument();
    expect(screen.getByText('Showing 21-25 of 25 records')).toBeInTheDocument();
    expect(countDataRows()).toBe(5);
    expect(button('Next')).toBeDisabled();

    fireEvent.click(button('Previous'));
    expect(screen.getByText(pageLabel(2, 3))).toBeInTheDocument();
  });

  test('changing the page size resets to page one and hides the pager when everything fits', async () => {
    renderReports();
    await waitForIdle();
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    expect(screen.getByText(pageLabel(3, 3))).toBeInTheDocument();

    fireEvent.change(getPageSizeSelect(), { target: { value: '50' } });

    expect(getPageSizeSelect()).toHaveValue('50');
    expect(screen.getByText('Showing 1-25 of 25 records')).toBeInTheDocument();
    expect(countDataRows()).toBe(25);
    expect(screen.queryByText(/^Page \d+ of \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();

    fireEvent.change(getPageSizeSelect(), { target: { value: '10' } });

    expect(screen.getByText(pageLabel(1, 3))).toBeInTheDocument();
    expect(countDataRows()).toBe(10);
  });

  test('refreshing the report returns to the first page', async () => {
    renderReports();
    await waitForIdle();
    fireEvent.click(button('Next'));
    expect(screen.getByText(pageLabel(2, 3))).toBeInTheDocument();

    fireEvent.click(button(REFRESH_LABEL));
    await waitForIdle();

    expect(screen.getByText(pageLabel(1, 3))).toBeInTheDocument();
    expect(screen.getByText('Showing 1-10 of 25 records')).toBeInTheDocument();
  });

  test('a new search returns to the first page of the filtered rows', async () => {
    renderReports();
    await waitForIdle();
    fireEvent.click(button('Next'));
    expect(screen.getByText(pageLabel(2, 3))).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'vendor 2' } });

    expect(screen.getByText('Showing 1-6 of 6 records')).toBeInTheDocument();
    expect(countDataRows()).toBe(6);
    expect(screen.queryByText(/^Page \d+ of \d+$/)).not.toBeInTheDocument();
  });
});

describe('DailyDownloadableReports exports', () => {
  test.each(DATE_CASES)(
    'the Excel export is named for the applied range when %s',
    async (_description, start, end, suffix) => {
      renderReports();
      await waitForIdle();
      await applyDateRange(start, end);

      fireEvent.click(button(EXCEL_LABEL));

      expect(mockExportExcel).toHaveBeenCalledTimes(1);
      expect(mockExportExcel).toHaveBeenCalledWith(
        SELLER_ROWS,
        `${SELLER_DETAILED.defaultFileName}_${suffix}`,
        SELLER_DETAILED.label
      );
      expect(mockExportCsv).not.toHaveBeenCalled();
    }
  );

  test.each(DATE_CASES)(
    'the CSV export is named for the applied range when %s',
    async (_description, start, end, suffix) => {
      renderReports();
      await waitForIdle();
      await applyDateRange(start, end);

      fireEvent.click(button(CSV_LABEL));

      expect(mockExportCsv).toHaveBeenCalledTimes(1);
      expect(mockExportCsv).toHaveBeenCalledWith(SELLER_ROWS, `${SELLER_DETAILED.defaultFileName}_${suffix}`);
      expect(mockExportExcel).not.toHaveBeenCalled();
    }
  );

  test('exports carry the file name and sheet label of the report that produced the rows on screen', async () => {
    renderReports('rfq');
    await waitForIdle();
    fireEvent.change(getReportSelect(), { target: { value: 'rfq_summary' } });
    await waitForIdle();
    const report = reportById('rfq_summary');

    fireEvent.click(button(EXCEL_LABEL));
    fireEvent.click(button(CSV_LABEL));

    expect(mockExportExcel).toHaveBeenCalledWith(SELLER_ROWS, `${report.defaultFileName}_All_Time`, report.label);
    expect(mockExportCsv).toHaveBeenCalledWith(SELLER_ROWS, `${report.defaultFileName}_All_Time`);
  });

  test('export buttons stay disabled and do nothing when the report has no rows', async () => {
    mockFetchReportData.mockResolvedValue(loaded([]));
    renderReports();
    await waitForIdle();

    expect(button(EXCEL_LABEL)).toBeDisabled();
    expect(button(CSV_LABEL)).toBeDisabled();

    fireEvent.click(button(EXCEL_LABEL));
    fireEvent.click(button(CSV_LABEL));

    expect(mockExportExcel).not.toHaveBeenCalled();
    expect(mockExportCsv).not.toHaveBeenCalled();
  });
});

describe('DailyDownloadableReports overlapping requests', () => {
  const STALE_ROWS: ReportRow[] = [{ Seller: 'Stale Vendor' }];
  const FRESH_ROWS: ReportRow[] = [{ Seller: 'Fresh Vendor' }];

  /**
   * Starts two queries back to back. The inputs are locked while a request is loading, but change events still
   * reach their handlers, which is the rapid-edit situation the request guard exists for.
   */
  const startOverlappingRequests = async () => {
    renderReports();
    await waitForIdle();

    const older = createDeferred<FetchResult>();
    const newer = createDeferred<FetchResult>();
    mockFetchReportData.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    changeDate(START_DATE_LABEL, '2026-06-01');
    changeDate(END_DATE_LABEL, '2026-06-10');

    expect(mockFetchReportData).toHaveBeenCalledTimes(3);
    expect(mockFetchReportData).toHaveBeenLastCalledWith(SELLER_DETAILED, '2026-06-01', '2026-06-10');
    return { older, newer };
  };

  test('drops a slower response that arrives after a newer request has completed', async () => {
    const { older, newer } = await startOverlappingRequests();

    await act(async () => {
      newer.resolve(loaded(FRESH_ROWS));
    });
    expect(await screen.findByText('Fresh Vendor')).toBeInTheDocument();
    expect(screen.getByText('Report loaded successfully (1 records).')).toBeInTheDocument();

    await act(async () => {
      older.resolve(loaded(STALE_ROWS));
    });

    expect(screen.queryByText('Stale Vendor')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh Vendor')).toBeInTheDocument();
    expect(screen.getByText('Report loaded successfully (1 records).')).toBeInTheDocument();
  });

  test('keeps the loading state until the newest request settles even if an older one finishes first', async () => {
    const { older, newer } = await startOverlappingRequests();

    await act(async () => {
      older.resolve(loaded(STALE_ROWS));
    });

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(REFRESH_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText('Stale Vendor')).not.toBeInTheDocument();

    await act(async () => {
      newer.resolve(loaded(FRESH_ROWS));
    });
    expect(await screen.findByText('Fresh Vendor')).toBeInTheDocument();

    expect(screen.queryByText('Stale Vendor')).not.toBeInTheDocument();
    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
  });
});
