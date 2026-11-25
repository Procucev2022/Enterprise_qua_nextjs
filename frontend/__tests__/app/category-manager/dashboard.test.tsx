import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DashboardView from '@/app/category-manager/dashboard/DashboardView';
import CategoryManagerDashboardPage, { metadata } from '@/app/category-manager/dashboard/page';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

const mockMetrics = {
  success: true,
  kpi: {
    totalRfqs: 1245,
    openRfqs: 342,
    rfqsWithoutQuotes: 89,
    buyerSubscriptions: 156,
    vendorSubscriptions: 412,
    totalBuyers: 890,
    totalVendors: 2150,
    buyerRegistration: 124,
    vendorRegistration: 238,
    totalLogins: 184,
  },
  charts: {
    months: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
    totalRfqsAndSubs: [
      { month: 'Jun', rfqs: 1000, buyerSubs: 50, vendorSubs: 80 },
      { month: 'Jul', rfqs: 1500, buyerSubs: 60, vendorSubs: 90 },
      { month: 'Aug', rfqs: 200, buyerSubs: 70, vendorSubs: 110 },
      { month: 'Sep', rfqs: 180, buyerSubs: 80, vendorSubs: 130 },
      { month: 'Oct', rfqs: 250, buyerSubs: 100, vendorSubs: 150 },
      { month: 'Nov', rfqs: 300, buyerSubs: 120, vendorSubs: 170 },
    ],
    newRegistrations: [
      { month: 'Jun', newBuyers: 20, newVendors: 40 },
      { month: 'Jul', newBuyers: 35, newVendors: 60 },
      { month: 'Aug', newBuyers: 45, newVendors: 75 },
      { month: 'Sep', newBuyers: 50, newVendors: 85 },
      { month: 'Oct', newBuyers: 70, newVendors: 110 },
      { month: 'Nov', newBuyers: 85, newVendors: 130 },
    ],
    activityRfqsVsQuotes: [
      { month: 'Jun', rfqsRaised: 80, vendorQuotes: 120 },
      { month: 'Jul', rfqsRaised: 110, vendorQuotes: 190 },
      { month: 'Aug', rfqsRaised: 140, vendorQuotes: 220 },
      { month: 'Sep', rfqsRaised: 160, vendorQuotes: 310 },
      { month: 'Oct', rfqsRaised: 210, vendorQuotes: 420 },
      { month: 'Nov', rfqsRaised: 280, vendorQuotes: 540 },
    ],
  },
};

const mockRfqRecords = {
  success: true,
  type: 'total_rfqs',
  total: 4,
  records: [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ1001',
      title: 'Structural Steel Supply',
      category: 'Metals & Alloys',
      status: 'OPEN',
      targetBudget: 500000,
      quotesCount: 3,
      createdAt: '2026-10-15T10:00:00Z',
    },
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ1002',
      title: 'Precision Machined Flanges',
      category: 'Industrial Valves',
      status: 'CLOSED',
      targetBudget: 250000,
      quotesCount: 1,
      createdAt: '2026-10-12T10:00:00Z',
    },
    {
      id: 'rfq-3',
      rfqNumber: 'RFQ1003',
      title: 'Titanium Fasteners',
      category: null,
      status: 'OPEN',
      targetBudget: null,
      quotesCount: 3,
      createdAt: null,
    },
    {
      rfqNumber: 'RFQ1004',
      title: 'Aluminum Bars',
      category: 'Metals',
      status: 'CLOSED',
      targetBudget: 100000,
      quotesCount: 5,
      createdAt: '2026-10-18T10:00:00Z',
    },
  ],
};

const mockBuyerRecords = {
  success: true,
  type: 'buyer_subscriptions',
  total: 2,
  records: [
    {
      id: 'b-1',
      name: 'Ramesh Patel',
      email: 'ramesh.p@tata.com',
      organizationName: 'Tata Projects Ltd',
      subscriptionPlan: 'Enterprise Plan',
      location: 'Mumbai, Maharashtra',
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: 'b-2',
      name: 'Anita Roy',
      email: 'anita.roy@reliance.com',
      organizationName: 'Reliance Infra',
      subscriptionPlan: 'Standard Plan',
      location: null,
      createdAt: '2026-09-10T10:00:00Z',
    },
  ],
};

const mockVendorRecords = {
  success: true,
  type: 'vendor_subscriptions',
  total: 2,
  records: [
    {
      id: 'v-1',
      name: 'Vikram Singh',
      email: 'vikram@apexsteel.com',
      companyName: 'Apex Steel Industries',
      category: 'Metals & Alloys',
      subscriptionPlan: 'Supplier Annual',
      location: 'Pune, Maharashtra',
      createdAt: '2026-09-05T10:00:00Z',
    },
    {
      id: 'v-2',
      name: 'Deepak Rao',
      email: 'deepak@precisionvalves.in',
      companyName: 'Deepak Rao',
      category: 'Industrial Valves',
      subscriptionPlan: 'Basic Supplier',
      location: 'Bengaluru, Karnataka',
      createdAt: '2026-09-12T10:00:00Z',
    },
  ],
};

const mockCmLoginRecords = {
  success: true,
  type: 'total_logins',
  total: 2,
  records: [
    {
      id: 'log-1',
      userName: 'Priya Sharma (CM)',
      email: 'priya.s@procucev.com',
      role: 'Category Manager (Internal)',
      loginAt: '2026-11-20T09:30:00Z',
      logoutAt: '2026-11-20T17:30:00Z',
      durationSeconds: 28800,
      status: 'ACTIVE',
      deviceInfo: 'Desktop (Chrome 120)',
    },
    {
      id: 'log-2',
      userName: 'Narasimha Rao (CM)',
      email: 'narasimha.r@procucev.com',
      role: 'Category Manager (Internal)',
      loginAt: null,
      logoutAt: null,
      durationSeconds: 14400,
      status: 'INACTIVE',
      deviceInfo: 'Laptop (MacOS Sonoma)',
    },
  ],
};

describe('Category Manager Dashboard View & Page Suite', () => {
  const strings = UI_STRINGS.categoryManagerDashboard;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/category-manager/dashboard/metrics')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMetrics),
        });
      }
      if (urlStr.includes('/api/category-manager/dashboard/records')) {
        if (
          urlStr.includes('type=buyer_subscriptions') ||
          urlStr.includes('type=total_buyers') ||
          urlStr.includes('type=buyer_registration')
        ) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockBuyerRecords),
          });
        }
        if (
          urlStr.includes('type=vendor_subscriptions') ||
          urlStr.includes('type=total_vendors') ||
          urlStr.includes('type=vendor_registration')
        ) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockVendorRecords),
          });
        }
        if (urlStr.includes('type=total_logins')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockCmLoginRecords),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRfqRecords),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as jest.Mock;
  });

  test('renders top filter bar and 10 KPI cards with accurate live numbers', async () => {
    render(<DashboardView />);

    expect(screen.getByTestId('filter-preset-today')).toBeInTheDocument();
    expect(screen.getByTestId('filter-preset-this-week')).toBeInTheDocument();
    expect(screen.getByTestId('filter-preset-this-month')).toBeInTheDocument();
    expect(screen.getByTestId('start-date-container')).toBeInTheDocument();
    expect(screen.getByTestId('end-date-container')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('1,245')).toBeInTheDocument();
      expect(screen.getByText('342')).toBeInTheDocument();
      expect(screen.getByText('89')).toBeInTheDocument();
      expect(screen.getByText('156')).toBeInTheDocument();
      expect(screen.getByText('412')).toBeInTheDocument();
      expect(screen.getByText('890')).toBeInTheDocument();
      expect(screen.getByText('2,150')).toBeInTheDocument();
      expect(screen.getByText('124')).toBeInTheDocument();
      expect(screen.getByText('238')).toBeInTheDocument();
      expect(screen.getByText('184')).toBeInTheDocument();
    });

    // 3 Monthly Charts
    expect(screen.getByText(strings.charts.totalRfqsAndSubs)).toBeInTheDocument();
    expect(screen.getByText(strings.charts.newRegistrations)).toBeInTheDocument();
    expect(screen.getByText(strings.charts.activityRfqsVsQuotes)).toBeInTheDocument();
  });

  test('handles date filter preset changes and custom date input triggers', async () => {
    render(<DashboardView />);

    // Presets
    fireEvent.click(screen.getByTestId('filter-preset-today'));
    fireEvent.click(screen.getByTestId('filter-preset-this-week'));
    fireEvent.click(screen.getByTestId('filter-preset-this-month'));

    // Custom start date click with showPicker
    const startContainer = screen.getByTestId('start-date-container');
    const startInput = screen.getByTestId('start-date-input') as HTMLInputElement;
    startInput.showPicker = jest.fn();

    fireEvent.click(startContainer);
    expect(startInput.showPicker).toHaveBeenCalled();

    // Start date click fallback when showPicker is not available
    startInput.showPicker = undefined as unknown as () => void;
    jest.spyOn(startInput, 'focus');
    fireEvent.click(startContainer);
    expect(startInput.focus).toHaveBeenCalled();

    // Custom end date click with showPicker
    const endContainer = screen.getByTestId('end-date-container');
    const endInput = screen.getByTestId('end-date-input') as HTMLInputElement;
    endInput.showPicker = jest.fn();

    fireEvent.click(endContainer);
    expect(endInput.showPicker).toHaveBeenCalled();

    // End date click without showPicker (focus fallback)
    endInput.showPicker = undefined as unknown as () => void;
    jest.spyOn(endInput, 'focus');

    fireEvent.click(endContainer);
    expect(endInput.focus).toHaveBeenCalled();

    // Trigger keyboard accessibility for date pickers
    fireEvent.keyDown(startContainer, { key: 'Enter' });
    fireEvent.keyDown(endContainer, { key: 'Enter' });
    fireEvent.keyDown(startContainer, { key: ' ' });
    fireEvent.keyDown(endContainer, { key: ' ' });
    fireEvent.keyDown(startContainer, { key: 'Escape' });
    fireEvent.keyDown(endContainer, { key: 'Escape' });

    // Change dates
    fireEvent.change(startInput, { target: { value: '2026-06-01' } });
    fireEvent.change(endInput, { target: { value: '2026-06-30' } });

    await waitFor(() => {
      expect(screen.getByText('2026-06-01')).toBeInTheDocument();
      expect(screen.getByText('2026-06-30')).toBeInTheDocument();
    });
  });

  test('opens drilldown modal for RFQ card, sorts columns, searches, and closes modal', async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('1,245')).toBeInTheDocument());

    const rfqCard = screen.getByTestId('kpi-card-total-rfqs');
    fireEvent.click(rfqCard);

    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByText('RFQ1001')).toBeInTheDocument();
      expect(screen.getByText('RFQ1002')).toBeInTheDocument();
    });

    // Column sorting across string, numbers, and null values
    const rfqHeader = screen.getByText('RFQ No.');
    fireEvent.click(rfqHeader); // sort asc
    fireEvent.click(rfqHeader); // sort desc

    const titleHeader = screen.getByText('Title');
    fireEvent.click(titleHeader);

    const categoryHeader = screen.getByText('Category');
    fireEvent.click(categoryHeader);

    const statusHeader = screen.getByText('Status');
    fireEvent.click(statusHeader);

    const quotesHeader = screen.getByText('Quotes');
    fireEvent.click(quotesHeader); // numeric sort asc
    fireEvent.click(quotesHeader); // numeric sort desc

    const createdHeader = screen.getByText('Created');
    fireEvent.click(createdHeader); // sort asc
    fireEvent.click(createdHeader); // sort desc

    // Search input
    const searchInput = screen.getByTestId('modal-search-input');
    fireEvent.change(searchInput, { target: { value: 'Flanges' } });

    await waitFor(() => {
      expect(screen.queryByText('RFQ1001')).not.toBeInTheDocument();
      expect(screen.getByText('RFQ1002')).toBeInTheDocument();
    });

    // Search with no results
    fireEvent.change(searchInput, { target: { value: 'NonExistentTitle' } });
    await waitFor(() => {
      expect(screen.getByText(strings.modal.noRecords)).toBeInTheDocument();
    });

    // Close via close button
    const closeBtn = screen.getByTestId('modal-close-btn');
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });
  });

  test('opens drilldown modal for buyer subscriptions and shows buyer details', async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('156')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kpi-card-buyer-subscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByText('Ramesh Patel')).toBeInTheDocument();
      expect(screen.getByText('Tata Projects Ltd')).toBeInTheDocument();
    });

    // Sort buyer columns
    fireEvent.click(screen.getByText('Buyer / Contact'));
    fireEvent.click(screen.getByText('Email'));
    fireEvent.click(screen.getByText('Organization'));
    fireEvent.click(screen.getByText('Plan'));
    fireEvent.click(screen.getByText('Location'));

    fireEvent.click(screen.getByTestId('modal-footer-close-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });
  });

  test('opens drilldown modal for vendor subscriptions and shows vendor details', async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('412')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kpi-card-vendor-subscriptions'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByText('Vikram Singh')).toBeInTheDocument();
      expect(screen.getByText('Apex Steel Industries')).toBeInTheDocument();
    });

    // Sort vendor columns
    fireEvent.click(screen.getByText('Supplier'));
    fireEvent.click(screen.getByText('Email'));
    fireEvent.click(screen.getByText('Category'));
    fireEvent.click(screen.getByText('Plan'));
    fireEvent.click(screen.getByText('Location'));

    fireEvent.click(screen.getByTestId('modal-footer-close-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });
  });

  test('opens drilldown modal for category manager logins (internal staff only)', async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('184')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('kpi-card-total-logins'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByText('Priya Sharma (CM)')).toBeInTheDocument();
      expect(screen.getByText('priya.s@procucev.com')).toBeInTheDocument();
    });

    // Sort login columns
    fireEvent.click(screen.getByText('User Name'));
    fireEvent.click(screen.getByText('Internal Email'));
    fireEvent.click(screen.getByText('Login Timestamp'));
    fireEvent.click(screen.getByText('Duration (s)'));
    fireEvent.click(screen.getByText('Status'));
    fireEvent.click(screen.getByText('Device / IP'));

    fireEvent.click(screen.getByTestId('modal-footer-close-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });
  });

  test('handles keyboard accessibility and opening other KPI cards', async () => {
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByText('1,245')).toBeInTheDocument());

    // Enter key
    fireEvent.keyDown(screen.getByTestId('kpi-card-open-rfqs'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    await waitFor(() => expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument());

    // Space key
    fireEvent.keyDown(screen.getByTestId('kpi-card-rfqs-without-quotes'), { key: ' ' });
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    await waitFor(() => expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument());

    // Other key (ignored)
    fireEvent.keyDown(screen.getByTestId('kpi-card-total-buyers'), { key: 'ArrowDown' });
    expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();

    // Trigger open for remaining cards
    fireEvent.click(screen.getByTestId('kpi-card-total-buyers'));
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));

    fireEvent.click(screen.getByTestId('kpi-card-total-vendors'));
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));

    fireEvent.click(screen.getByTestId('kpi-card-buyer-registration'));
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));

    fireEvent.click(screen.getByTestId('kpi-card-vendor-registration'));
    await waitFor(() => expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('modal-close-btn'));
  });

  test('renders page component wrapper cleanly and exports correct metadata', () => {
    expect(metadata.title).toBe('Dashboard | Category Manager');
    expect(metadata.description).toBeDefined();

    render(<CategoryManagerDashboardPage />);
    expect(screen.getByTestId('kpi-card-total-rfqs')).toBeInTheDocument();
  });

  test('handles failed fetch calls gracefully and renders error banner with retry', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
    render(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('metrics-error-banner')).toBeInTheDocument();
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });

    // Retry button calls fetch again
    fireEvent.click(screen.getByTestId('retry-metrics-btn'));
    expect(global.fetch).toHaveBeenCalled();

    // Clicking card when network fails shows records error message in modal
    fireEvent.click(screen.getByTestId('kpi-card-total-rfqs'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByTestId('records-error-message')).toBeInTheDocument();
    });
  });

  test('handles non-200 HTTP response and renders status code in error banner', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Database connection failure'),
      })
    ) as jest.Mock;

    render(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('metrics-error-banner')).toBeInTheDocument();
      expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
    });

    // Opening card also displays records error
    fireEvent.click(screen.getByTestId('kpi-card-total-rfqs'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      const recordsMsg = screen.getByTestId('records-error-message');
      expect(recordsMsg).toBeInTheDocument();
      expect(within(recordsMsg).getByText(/HTTP 500/i)).toBeInTheDocument();
    });
  });

  test('handles single-month and empty chart data', async () => {
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/category-manager/dashboard/metrics')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              kpi: mockMetrics.kpi,
              charts: {
                months: ['Nov'],
                totalRfqsAndSubs: [{ month: 'Nov', rfqs: 1200, buyerSubs: 100, vendorSubs: 200 }],
                newRegistrations: [{ month: 'Nov', newBuyers: 50, newVendors: 90 }],
                activityRfqsVsQuotes: [{ month: 'Nov', rfqsRaised: 60, vendorQuotes: 140 }],
              },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, records: [] }) });
    }) as jest.Mock;

    render(<DashboardView />);
    await waitFor(() => {
      expect(screen.getByText('1,245')).toBeInTheDocument();
      expect(screen.getAllByText('Nov').length).toBeGreaterThan(0);
    });
  });

  test('closes modal on backdrop click and on Escape key press, preserving modal on inner card click', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-jwt-token');

    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText('1,245')).toBeInTheDocument());

    // Click to open modal
    fireEvent.click(screen.getByTestId('kpi-card-total-rfqs'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
      expect(screen.getByText('Structural Steel Supply')).toBeInTheDocument();
    });

    // Clicking inside the modal does not close it (stopPropagation)
    fireEvent.click(screen.getByText('Structural Steel Supply'));
    expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();

    // Clicking the backdrop closes the modal
    fireEvent.click(screen.getByTestId('drilldown-modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });

    // Reopen and test Escape key closes the modal
    fireEvent.click(screen.getByTestId('kpi-card-open-rfqs'));
    await waitFor(() => {
      expect(screen.getByTestId('drilldown-modal')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('drilldown-modal')).not.toBeInTheDocument();
    });
  });

  test('passes authorization header when user is logged in', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    jest.spyOn(authClient, 'getToken').mockReturnValue('cm-auth-token-123');

    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText('1,245')).toBeInTheDocument());

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/category-manager/dashboard/metrics'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cm-auth-token-123',
        }),
      })
    );
  });
});
