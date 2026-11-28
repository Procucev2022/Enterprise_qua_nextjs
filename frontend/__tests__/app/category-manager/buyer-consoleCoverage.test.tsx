import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerConsole from '@/app/category-manager/buyer-console';
import { AppProvider } from '@/lib/store';
import { UI_STRINGS } from '@/lib/uiStrings';
import * as buyerProfileClient from '@/lib/buyerProfileClient';

jest.mock('@/lib/reportsClient', () => ({
  exportReportToCsv: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => {
  const actual = jest.requireActual('@/lib/buyerProfileClient');
  return {
    ...actual,
    fetchBuyerDirectoryKPIStats: jest.fn().mockResolvedValue({
      success: true,
      totalBuyers: 3,
      verifiedBuyers: 2,
      subscriptionBuyers: 1,
    }),
  };
});

describe('BuyerConsole Coverage Edge Cases', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('covers all sorting tie branches, missing phone/email, empty dates, and unknown modes', async () => {
    const baseImpl = (global.fetch as jest.Mock).getMockImplementation()!;
    (global.fetch as jest.Mock).mockImplementation((url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && /\/api\/bootstrap/.test(url)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              buyerAccounts: [
                {
                  id: 'ba-tie-1',
                  organizationName: 'Same Org',
                  corporateEmail: 'same@org.com',
                  contactPerson: 'Same Person',
                  mobileNumber: '+91 9999999999',
                  sourcingMode: 'mode_0',
                  createdDate: '2026-11-20',
                },
                {
                  id: 'ba-tie-2',
                  organizationName: 'Same Org',
                  corporateEmail: 'same@org.com',
                  contactPerson: 'Same Person',
                  mobileNumber: '',
                  sourcingMode: 'unknown_mode',
                  createdDate: '2026-11-20',
                },
                {
                  id: 'ba-tie-3',
                  organizationName: '',
                  corporateEmail: '',
                  contactPerson: '',
                  mobileNumber: null,
                  createdDate: '',
                  syncTimestamp: '2026-11-18T10:00:00Z',
                },
              ],
              vendors: [],
              evaluations: [],
              auditLogs: [],
              aiFeed: [],
              systemConfig: {},
            },
          }),
        });
      }
      if (typeof url === 'string' && /\/api\/rfqs(\?|$)/.test(url) && (init?.method || 'GET') === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: [
              {
                id: 'rfq-no-followup',
                rfqNumber: 'RFQ-NO-FOLLOWUP',
                title: 'No Follow Up RFQ',
                buyerAccountId: 'ba-tie-1',
                budget: 10000,
                quotesCount: 0,
              },
              {
                id: 'rfq-email-match',
                rfqNumber: 'RFQ-EMAIL-MATCH',
                title: 'Email Match RFQ',
                raisedByEmail: 'same@org.com',
                budget: NaN,
                quotesCount: 2,
                status: 'PO Generated',
              },
              {
                id: 'rfq-buyer-email-match',
                rfqNumber: 'RFQ-BUYER-EMAIL-MATCH',
                title: 'Buyer Email Match RFQ',
                buyerEmail: 'same@org.com',
                budget: 5000,
                quotesCount: 1,
              },
              {
                id: 'rfq-org-name-match',
                rfqNumber: 'RFQ-ORG-NAME-MATCH',
                title: 'Org Name Match RFQ',
                buyerAccountName: 'Same Org',
                budget: 15000,
                createdAt: '2026-11-19T00:00:00Z',
              },
            ],
          }),
        });
      }
      return baseImpl(url, init);
    });

    render(
      <AppProvider>
        <BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Same Person').length).toBeGreaterThan(0);
    });

    // Exercise search matching by email
    const searchInput = screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'same@org.com' } });
    expect(screen.getAllByText('Same Person').length).toBeGreaterThan(0);

    // Exercise search matching by company
    fireEvent.change(searchInput, { target: { value: 'Same Org' } });
    expect(screen.getAllByText('Same Person').length).toBeGreaterThan(0);

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Exercise sorting with identical values to hit cmp = 0 for all sort fields
    const headers = [
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

    for (const h of headers) {
      const el = screen.getByText(h);
      fireEvent.click(el);
      fireEvent.click(el);
    }

    (global.fetch as jest.Mock).mockImplementation(baseImpl);
  });

  test('covers header drag-and-drop edge cases (null dragged, same index)', async () => {
    render(
      <AppProvider>
        <BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Buyer Name')).toBeInTheDocument();
    });

    const headers = screen.getAllByRole('columnheader');
    // Drop without dragStart (draggedColIdx === null)
    fireEvent.drop(headers[0]);

    // Drag and drop onto same index (draggedColIdx === targetIdx)
    fireEvent.dragStart(headers[1], { dataTransfer: { effectAllowed: 'move' } });
    fireEvent.drop(headers[1]);
  });

  test('covers scrollIntoView when container or drilldown section is missing', async () => {
    render(
      <AppProvider>
        <BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(UI_STRINGS.buyerConsole.searchPlaceholder)).toBeInTheDocument();
    });

    // Remove element from DOM to exercise the null branch
    const container = document.getElementById('buyer-table-container');
    if (container) container.id = 'temp-removed';

    const nextBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.buyerConsole.nextPage, 'i') });
    if (!nextBtn.hasAttribute('disabled')) {
      fireEvent.click(nextBtn);
    }

    if (container) container.id = 'buyer-table-container';
  });

  test('covers pagination page windows when totalPages > 5 for middle and tail pages', async () => {
    (buyerProfileClient.fetchBuyerDirectoryKPIStats as jest.Mock).mockResolvedValueOnce({
      success: true,
      totalBuyers: 1000, // 10 pages with PAGE_SIZE = 100
      verifiedBuyers: 900,
      subscriptionBuyers: 800,
    });

    render(
      <AppProvider>
        <BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–100 of 1,000 Buyers/i)).toBeInTheDocument();
    });

    // Initial page: currentPage = 1 (currentPage <= 3 branch)
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();

    // Click Next button several times to reach page 5 (middle page: else branch pageNum = currentPage - 2 + i)
    const nextBtn = screen.getByRole('button', { name: new RegExp(UI_STRINGS.buyerConsole.nextPage, 'i') });
    fireEvent.click(nextBtn); // page 2
    fireEvent.click(nextBtn); // page 3
    fireEvent.click(nextBtn); // page 4
    fireEvent.click(nextBtn); // page 5
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();

    // Click Next button to reach page 9 (tail page: currentPage >= totalPages - 2 branch pageNum = totalPages - 4 + i)
    fireEvent.click(nextBtn); // page 6
    fireEvent.click(nextBtn); // page 7
    fireEvent.click(nextBtn); // page 8
    fireEvent.click(nextBtn); // page 9
    expect(screen.getByRole('button', { name: '9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10' })).toBeInTheDocument();
  });

  test('covers handleToggleBuyer setTimeout scroll and custom columns in localStorage', async () => {
    const customColumns = [
      { id: 'name', label: 'Buyer Name', visible: true, locked: true },
      { id: 'custom_col' as any, label: 'Custom Col', visible: true, locked: false },
      { id: 'actions', label: 'Actions', visible: true, locked: true },
    ];
    localStorage.setItem('buyer_console_table_columns_v1', JSON.stringify(customColumns));

    render(
      <AppProvider>
        <BuyerConsole onNavigateToMatrix={jest.fn()} onNavigateToEvaluation={jest.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('S. N. Subrahmanyan')).toBeInTheDocument();
    });

    const reviewButtons = screen.getAllByRole('button', { name: new RegExp(UI_STRINGS.actions.reviewRfqDetails, 'i') });
    expect(reviewButtons.length).toBeGreaterThan(0);

    // Click Review RFQ Details to expand
    fireEvent.click(reviewButtons[0]);

    // Wait for setTimeout (50ms) to fire and execute scrollIntoView
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Click again to close drill-down
    const hideButtons = screen.getAllByRole('button', { name: new RegExp(UI_STRINGS.actions.hideDetails, 'i') });
    expect(hideButtons.length).toBeGreaterThan(0);
    fireEvent.click(hideButtons[0]);
  });
});
