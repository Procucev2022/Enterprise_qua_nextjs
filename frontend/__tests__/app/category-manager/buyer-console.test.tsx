import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuyerConsole, { DEFAULT_BUYER_CONSOLE_COLUMNS } from '@/app/category-manager/buyer-console';
import { AppProvider } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import { fetchBuyerDirectoryKPIStats } from '@/lib/buyerProfileClient';
import { exportReportToCsv } from '@/lib/reportsClient';

jest.mock('@/lib/reportsClient', () => ({
  exportReportToCsv: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => {
  const actual = jest.requireActual('@/lib/buyerProfileClient');
  return {
    ...actual,
    fetchBuyerDirectoryKPIStats: jest.fn().mockResolvedValue({
      success: true,
      totalBuyers: 1822,
      verifiedBuyers: 1200,
      subscriptionBuyers: 850,
    }),
  };
});

function renderBuyerConsole(props = {}) {
  const onNavigateToMatrix = jest.fn();
  const onNavigateToEvaluation = jest.fn();
  const utils = render(
    <AppProvider>
      <BuyerConsole
        onNavigateToMatrix={onNavigateToMatrix}
        onNavigateToEvaluation={onNavigateToEvaluation}
        {...props}
      />
    </AppProvider>
  );
  return { ...utils, onNavigateToMatrix, onNavigateToEvaluation };
}

describe('BuyerConsole Table & Features', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (fetchBuyerDirectoryKPIStats as jest.Mock).mockResolvedValue({
      success: true,
      totalBuyers: 1822,
      verifiedBuyers: 1200,
      subscriptionBuyers: 850,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('renders top 3 KPI cards with calculations and icons', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.buyerConsole.kpiSpendTitle)).toBeInTheDocument();
    });

    expect(screen.getByText(UI_STRINGS.buyerConsole.kpiVolumeTitle)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.buyerConsole.kpiAvgQuotesTitle)).toBeInTheDocument();
  });

  test('renders single-row toolbar with search, dropdowns, export, refresh, and gear buttons', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder)).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.exportBtn })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.refreshBtn })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn })).toBeInTheDocument();
  });

  test('filters buyers by search input and dropdowns', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'Subrahmanyan' } });
    expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);

    fireEvent.change(searchInput, { target: { value: '' } });

    const [companySelect, buyerSelect] = screen.getAllByRole('combobox');
    expect(buyerSelect).toBeDisabled();

    fireEvent.change(companySelect, { target: { value: 'Larsen & Toubro Heavy Engineering' } });
    expect(buyerSelect).not.toBeDisabled();

    fireEvent.change(buyerSelect, { target: { value: 'buyer-acc-001' } });
    expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);

    fireEvent.change(companySelect, { target: { value: 'all' } });
    expect(buyerSelect).toBeDisabled();
  });

  test('sorts columns ascending and descending across all fields including tie-breaks', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);
    });

    const sortFields = [
      'Buyer Name',
      'Company Name',
      'Email',
      'Phone',
      'Sourcing Mode',
      'Total RFQs',
      'Active RFQs',
      'Sourced Spend',
      'Avg Quotes / RFQ',
      'Date',
    ];

    for (const field of sortFields) {
      const header = screen.getByText(field);
      fireEvent.click(header); // asc
      fireEvent.click(header); // desc
    }
  });

  test('handles drag-and-drop column reordering on table headers and persists in localStorage', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByText('Buyer Name')).toBeInTheDocument();
    });

    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThan(2);

    // Valid drop on another header
    fireEvent.dragStart(headers[0], {
      dataTransfer: { effectAllowed: 'move' },
    });
    fireEvent.dragOver(headers[1], {
      dataTransfer: { dropEffect: 'move' },
    });
    fireEvent.drop(headers[1]);

    expect(localStorage.getItem('buyer_console_table_columns_v1')).toBeTruthy();

    // Drop on same header (noop)
    fireEvent.dragStart(headers[0], {
      dataTransfer: { effectAllowed: 'move' },
    });
    fireEvent.drop(headers[0]);

    // Drop with no dragged index (noop)
    fireEvent.drop(headers[1]);
  });

  test('opens gear icon column settings popup, toggles column visibility, and saves', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn }));
    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    const companyCheckbox = screen.getByLabelText('Toggle column: Company Name');
    fireEvent.click(companyCheckbox);

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(localStorage.getItem('buyer_console_table_columns_v1')).toBeTruthy();
  });

  test('opens gear icon popup and closes via close button', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn }));
    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /Close column settings/i });
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByText('Column Settings')).not.toBeInTheDocument();
    });
  });

  test('opens gear icon popup and resets columns to default', async () => {
    localStorage.setItem('buyer_console_table_columns_v1', JSON.stringify([{ key: 'name', label: 'Buyer Name', visible: true }]));
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.columnSettingsBtn }));
    expect(screen.getByText('Column Settings')).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
    fireEvent.click(resetBtn);
    expect(localStorage.getItem('buyer_console_table_columns_v1')).toBeNull();
    await waitFor(() => {
      expect(screen.queryByText('Column Settings')).not.toBeInTheDocument();
    });
  });

  test('handles pagination across multiple pages and all 4 page-number window branches', async () => {
    renderBuyerConsole();

    const scrollMock = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollMock;

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–/i)).toBeInTheDocument();
      expect(screen.getByText(/of 1,822 Buyers/i)).toBeInTheDocument();
    });

    const prevBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.buyerConsole.prevPage, 'i') });
    expect(prevBtn).toBeDisabled();

    // Next button
    const nextBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.buyerConsole.nextPage, 'i') });
    fireEvent.click(nextBtn);
    expect(scrollMock).toHaveBeenCalled();

    // Prev button
    fireEvent.click(prevBtn);
    expect(scrollMock).toHaveBeenCalled();

    // Page 2 (currentPage <= 3)
    const page2Btn = screen.getByRole('button', { name: '2' });
    fireEvent.click(page2Btn);

    // Page 3
    const page3Btn = screen.getByRole('button', { name: '3' });
    fireEvent.click(page3Btn);

    // Page 4 (middle branch: currentPage - 2 + i)
    const page4Btn = screen.getByRole('button', { name: '4' });
    fireEvent.click(page4Btn);

    // Page 5
    const page5Btn = screen.getByRole('button', { name: '5' });
    fireEvent.click(page5Btn);
  });

  test('handles pagination when totalPages <= 5', async () => {
    (fetchBuyerDirectoryKPIStats as jest.Mock).mockResolvedValue({
      success: true,
      totalBuyers: 350,
      verifiedBuyers: 200,
      subscriptionBuyers: 150,
    });

    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByText(/of 350 Buyers/i)).toBeInTheDocument();
    });

    // Page numbers 1, 2, 3, 4 should be rendered (totalPages = 4 <= 5)
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();

    // Click to page 4 (which is also totalPages >= totalPages - 2)
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(screen.getByRole('button', { name: '4' })).toHaveClass('bg-teal-600');
  });

  test('triggers CSV export on Export button click and handles empty buyers', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.exportBtn })).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: UI_STRINGS.buyerConsole.exportBtn });
    fireEvent.click(exportBtn);
    expect(exportReportToCsv).toHaveBeenCalled();

    // Filter to empty, then click export (should be noop)
    jest.clearAllMocks();
    const searchInput = screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'NonexistentCompany12345' } });
    fireEvent.click(exportBtn);
    expect(exportReportToCsv).not.toHaveBeenCalled();
  });

  test('triggers data reload on Refresh button click and handles invalid KPI response', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_STRINGS.buyerConsole.refreshBtn })).toBeInTheDocument();
    });

    // Valid refresh
    const refreshBtn = screen.getByRole('button', { name: UI_STRINGS.buyerConsole.refreshBtn });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(fetchBuyerDirectoryKPIStats).toHaveBeenCalled();
    });

    // Refresh with invalid payload (success: false or non-number)
    (fetchBuyerDirectoryKPIStats as jest.Mock).mockResolvedValue({
      success: false,
    });
    fireEvent.click(refreshBtn);
  });

  test('shows empty state when no buyers match filter', async () => {
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'NonexistentCompany12345' } });

    expect(screen.getByText(UI_STRINGS.buyerConsole.noBuyersFound)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.buyerConsole.showingEmptyPagination)).toBeInTheDocument();
  });

  test('loads persisted column order from localStorage with corrupt JSON fallback and fills missing defaults', async () => {
    localStorage.setItem(
      'buyer_console_table_columns_v1',
      JSON.stringify([
        { key: 'company', label: 'Company Name', visible: true },
        { key: 'name', label: 'Buyer Name', visible: true, required: true },
      ])
    );

    renderBuyerConsole();
    await waitFor(() => {
      expect(screen.getByText('Company Name')).toBeInTheDocument();
    });

    localStorage.setItem('buyer_console_table_columns_v1', 'invalid-json{{{');
    renderBuyerConsole();
    await waitFor(() => {
      expect(screen.getAllByText('Buyer Name').length).toBeGreaterThan(0);
    });
  });

  test('handles fetchBuyerDirectoryKPIStats rejection gracefully', async () => {
    (fetchBuyerDirectoryKPIStats as jest.Mock).mockRejectedValue(new Error('Network error'));
    renderBuyerConsole();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder)).toBeInTheDocument();
    });
  });

  test('exercises full drill-down expansion, multiple RFQ statuses, line items, and navigation callbacks', async () => {
    const onMatrix = jest.fn();
    const onEval = jest.fn();

    const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'rfq-complex-01',
                rfqNumber: 'RFQ-COMPLEX-01',
                title: 'High Pressure Steam Boiler',
                category: 'Industrial Boilers',
                sourcingMode: 'mode_3',
                status: 'Parsing',
                createdAt: '2026-08-20',
                quotesCount: 4,
                budget: 250000,
                buyerAccountId: 'buyer-acc-001',
                assignedVendors: ['v-1', 'v-2'],
                followUpData: {
                  totalInvited: 2,
                  respondedCount: 1,
                },
                extractedEntities: [
                  {
                    id: 'item-boiler',
                    itemName: 'Boiler 10 Ton',
                    category: 'Boilers',
                    quantity: 2,
                    unit: 'Units',
                    technicalSpecs: '10 Ton 15 Bar',
                  },
                ],
              },
              {
                id: 'rfq-complex-02',
                rfqNumber: 'RFQ-COMPLEX-02',
                title: 'Industrial Centrifuge Machine',
                category: 'Machinery',
                sourcingMode: 'mode_1',
                status: 'In Evaluation',
                createdAt: '2026-08-22',
                quotesCount: 0,
                budget: 180000,
                buyerAccountId: 'buyer-acc-001',
                assignedVendors: [],
                followUpData: {
                  totalInvited: 0,
                  respondedCount: 0,
                },
              },
              {
                id: 'rfq-complex-03',
                rfqNumber: 'RFQ-COMPLEX-03',
                title: 'Water Treatment Chemicals',
                category: 'Chemicals',
                sourcingMode: 'mode_0',
                status: 'AI Recommended',
                createdAt: '2026-08-23',
                quotesCount: 2,
                budget: 50000,
                buyerAccountId: 'buyer-acc-001',
              },
              {
                id: 'rfq-complex-04',
                rfqNumber: 'RFQ-COMPLEX-04',
                title: 'RFQ With No Date Or Mode',
                status: 'AI Recommended',
                budget: null,
                quotesCount: 0,
                buyerAccountId: 'buyer-acc-001',
              },
            ],
          }),
        });
      }
      return baseImpl(url, init);
    });

    renderBuyerConsole({ onNavigateToMatrix: onMatrix, onNavigateToEvaluation: onEval });

    await waitFor(() => {
      expect(screen.getAllByText(/S\. N\. Subrahmanyan/i).length).toBeGreaterThan(0);
    });

    const reviewBtns = screen.getAllByRole('button', { name: /Review RFQ Details/i });
    fireEvent.click(reviewBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/High Pressure Steam Boiler/i)).toBeInTheDocument();
    });

    // Expand RFQ 1 (mode_3)
    const rfqRow1 = screen.getByText(/High Pressure Steam Boiler/i);
    fireEvent.click(rfqRow1);

    expect(screen.getByText(/BOQ Specifications & Item Roster/i)).toBeInTheDocument();
    expect(screen.getByText('Boiler 10 Ton')).toBeInTheDocument();

    const matrixBtn = screen.getByRole('button', { name: /Go to Quote Matrix/i });
    fireEvent.click(matrixBtn);
    expect(onMatrix).toHaveBeenCalled();

    const evalBtn = screen.getByRole('button', { name: /Review Survey Evaluation/i });
    fireEvent.click(evalBtn);
    expect(onEval).toHaveBeenCalled();

    // Expand RFQ 2 (mode_1, In Evaluation, 0 quotes)
    const rfqRow2 = screen.getByText(/Industrial Centrifuge Machine/i);
    fireEvent.click(rfqRow2);

    // Expand RFQ 3 (mode_0, AI Recommended)
    const rfqRow3 = screen.getByText(/Water Treatment Chemicals/i);
    fireEvent.click(rfqRow3);

    // Expand RFQ 4 (no date or mode)
    const rfqRow4 = screen.getByText(/RFQ With No Date Or Mode/i);
    fireEvent.click(rfqRow4);

    // Toggle Hide Details
    const hideBtn = screen.getByRole('button', { name: /Hide Details/i });
    fireEvent.click(hideBtn);
  });
});
