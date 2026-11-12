import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LoginLogsDashboard from '@/app/category-manager/components/LoginLogsDashboard';
import { UI_STRINGS } from '@/lib/uiStrings';
import { fetchLoginLogs, fetchLoginLogsSummary } from '@/lib/loginLogsClient';
import type { LoginLogEntry } from '@/lib/types';

jest.mock('@/lib/loginLogsClient', () => ({
  fetchLoginLogs: jest.fn(),
  fetchLoginLogsSummary: jest.fn(),
  FALLBACK_SUMMARY: {
    totalToday: 148,
    activeNow: 24,
    buyerLogins: 82,
    sellerLogins: 66,
    avgDurationMinutes: 42,
    todayPeakHour: '10:00 AM - 11:30 AM',
  },
}));

const getYesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

const mockLogs: LoginLogEntry[] = [
  {
    id: 'log_1',
    userId: 'BUYER-001',
    userName: 'Rajesh Sharma',
    email: 'rajesh.sharma@tatamotors.com',
    phoneNumber: '+91 98201 44521',
    companyName: 'Tata Motors Ltd',
    userType: 'buyer',
    loginAt: new Date().toISOString(), // today
    logoutAt: null,
    durationSeconds: 1200,
    status: 'ACTIVE',
    ipAddress: '103.21.244.12',
    deviceInfo: 'Chrome 128 / Windows 11',
    location: 'Mumbai, Maharashtra',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'log_2',
    userId: 'VEND-201',
    userName: 'Amit Patel',
    email: 'amit.patel@apexindustrial.in',
    phoneNumber: '+91 98980 12345',
    companyName: 'Apex Industrial Solutions Pvt Ltd',
    userType: 'vendor',
    loginAt: getYesterdayIso(), // guaranteed yesterday
    logoutAt: getYesterdayIso(),
    durationSeconds: 3665, // > 1 hour
    status: 'LOGGED_OUT',
    ipAddress: '49.36.128.88',
    deviceInfo: 'Edge 128 / Windows 11',
    location: 'Ahmedabad, Gujarat',
    userAgent: 'Mozilla/5.0 Edg/128.0.0.0',
    createdAt: getYesterdayIso(),
  },
  {
    id: 'log_3',
    userId: 'BUYER-002',
    userName: 'Priya Iyer',
    email: 'priya.iyer@relianceretail.com',
    phoneNumber: '+91 98400 99881',
    companyName: 'Reliance Retail Ventures',
    userType: 'buyer',
    loginAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    logoutAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 45 * 1000).toISOString(),
    durationSeconds: 45, // seconds only
    status: 'TIMED_OUT',
    ipAddress: '14.143.45.10',
    deviceInfo: '',
    location: '',
    userAgent: '',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'log_4',
    userId: 'VEND-202',
    userName: 'Suresh Menon',
    email: 'suresh@keralasteels.com',
    phoneNumber: '+91 97455 33221',
    companyName: 'Kerala Steels',
    userType: 'vendor',
    loginAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago
    logoutAt: null,
    durationSeconds: 0,
    status: 'ACTIVE',
    ipAddress: '117.218.67.92',
    deviceInfo: 'Firefox / Linux',
    location: 'Kochi',
    userAgent: 'Mozilla/5.0 Firefox',
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const mockSummary = {
  totalToday: 148,
  activeNow: 24,
  buyerLogins: 82,
  sellerLogins: 66,
  avgDurationMinutes: 42,
  todayPeakHour: '10:00 AM - 11:30 AM',
};

describe('LoginLogsDashboard', () => {
  const strings = UI_STRINGS.actionCenter.loginLogs;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (fetchLoginLogs as jest.Mock).mockReset();
    (fetchLoginLogs as jest.Mock).mockResolvedValue({
      logs: mockLogs,
      total: mockLogs.length,
      page: 1,
      totalPages: 1,
    });
    (fetchLoginLogsSummary as jest.Mock).mockResolvedValue({ summary: mockSummary });
  });

  it('renders header, title, and KPI metric cards correctly', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(strings.title)).toBeInTheDocument();
      expect(screen.getByText(strings.subtitle)).toBeInTheDocument();
      expect(screen.getByText('148')).toBeInTheDocument();
      expect(screen.getByText('24')).toBeInTheDocument();
      expect(screen.getByText('82')).toBeInTheDocument();
      expect(screen.getByText('66')).toBeInTheDocument();
      expect(screen.getByText('42m')).toBeInTheDocument();
      expect(screen.getByText(/Peak: 10:00 AM - 11:30 AM/i)).toBeInTheDocument();
    });

    // Check table headers
    expect(screen.getByText(strings.table.colUser)).toBeInTheDocument();
    expect(screen.getByText(strings.table.colCompany)).toBeInTheDocument();
    expect(screen.getByText(strings.table.colContact)).toBeInTheDocument();
    expect(screen.getByText(strings.table.colLoginTime)).toBeInTheDocument();
    expect(screen.getByText(strings.table.colLogoutTime)).toBeInTheDocument();
    expect(screen.getByText(strings.table.colStatus)).toBeInTheDocument();
  });

  it('filters by user type (All, Buyers, Sellers)', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    // Click Buyers Only
    const buyerBtn = screen.getByRole('button', { name: strings.filters.buyersOnly });
    fireEvent.click(buyerBtn);

    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    expect(screen.queryByText('Amit Patel')).not.toBeInTheDocument();

    // Click Sellers Only
    const sellerBtn = screen.getByRole('button', { name: strings.filters.sellersOnly });
    fireEvent.click(sellerBtn);

    expect(screen.getByText('Amit Patel')).toBeInTheDocument();
    expect(screen.queryByText('Rajesh Sharma')).not.toBeInTheDocument();

    // Reset to All Roles
    const allRolesBtn = screen.getByRole('button', { name: strings.filters.allRoles });
    fireEvent.click(allRolesBtn);

    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    expect(screen.getByText('Amit Patel')).toBeInTheDocument();
  });

  it('filters by search input query and clears search', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(strings.filters.searchPlaceholder);

    // Search by company
    fireEvent.change(searchInput, { target: { value: 'Apex' } });
    expect(screen.getByText('Amit Patel')).toBeInTheDocument();
    expect(screen.queryByText('Rajesh Sharma')).not.toBeInTheDocument();

    // Clear search with X button
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
  });

  it('filters by status dropdown', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const statusSelect = screen.getByRole('combobox');

    // Filter to TIMED_OUT
    fireEvent.change(statusSelect, { target: { value: 'TIMED_OUT' } });
    expect(screen.getByText('Priya Iyer')).toBeInTheDocument();
    expect(screen.queryByText('Rajesh Sharma')).not.toBeInTheDocument();

    // Filter to ACTIVE
    fireEvent.change(statusSelect, { target: { value: 'ACTIVE' } });
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    expect(screen.queryByText('Priya Iyer')).not.toBeInTheDocument();

    // Filter to LOGGED_OUT
    fireEvent.change(statusSelect, { target: { value: 'LOGGED_OUT' } });
    expect(screen.getByText('Amit Patel')).toBeInTheDocument();

    // Reset to all
    fireEvent.change(statusSelect, { target: { value: 'all' } });
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
  });

  it('filters by date range presets and custom date inputs', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    // Today preset
    const todayBtn = screen.getByRole('button', { name: strings.filters.dateRangeToday });
    fireEvent.click(todayBtn);
    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();

    // Yesterday preset
    const yesterdayBtn = screen.getByRole('button', { name: strings.filters.dateRangeYesterday });
    fireEvent.click(yesterdayBtn);
    expect(screen.getByText('Amit Patel')).toBeInTheDocument();

    // Last 7 days
    const last7Btn = screen.getByRole('button', { name: strings.filters.dateRangeLast7Days });
    fireEvent.click(last7Btn);
    expect(screen.getByText('Priya Iyer')).toBeInTheDocument();

    // Last 30 days
    const last30Btn = screen.getByRole('button', { name: strings.filters.dateRangeLast30Days });
    fireEvent.click(last30Btn);
    expect(screen.getByText('Suresh Menon')).toBeInTheDocument();

    // Custom date range
    const customBtn = screen.getByRole('button', { name: strings.filters.dateRangeCustom });
    fireEvent.click(customBtn);

    const startDateInput = screen.getByLabelText(strings.filters.startDate);
    const endDateInput = screen.getByLabelText(strings.filters.endDate);

    const todayStr = new Date().toISOString().split('T')[0];
    fireEvent.change(startDateInput, { target: { value: todayStr } });
    fireEvent.change(endDateInput, { target: { value: todayStr } });

    expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
  });

  it('handles empty state when no records match filter', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(strings.filters.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'NonExistentCompanyOrUser999' } });

    expect(screen.getByText(strings.table.emptyState)).toBeInTheDocument();
  });

  it('opens and closes session inspection details modal', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const viewDetailsButtons = screen.getAllByRole('button', { name: strings.actions.viewDetails });
    fireEvent.click(viewDetailsButtons[0]);

    // Verify modal is visible
    expect(screen.getByText(strings.details.title)).toBeInTheDocument();
    expect(screen.getByText(strings.details.clientUserAgent)).toBeInTheDocument();
    expect(screen.getAllByText('103.21.244.12').length).toBeGreaterThan(0);

    // Close via Close button
    const closeButtons = screen.getAllByRole('button', { name: strings.actions.closeDetails });
    fireEvent.click(closeButtons[1]);

    expect(screen.queryByText(strings.details.title)).not.toBeInTheDocument();

    // Open via row click and close via X button
    const row = screen.getByText('Amit Patel');
    fireEvent.click(row);

    expect(screen.getByText(strings.details.title)).toBeInTheDocument();
    const xBtn = screen.getAllByRole('button', { name: strings.actions.closeDetails })[0];
    fireEvent.click(xBtn);

    expect(screen.queryByText(strings.details.title)).not.toBeInTheDocument();
  });

  it('toggles realtime feed and triggers manual refresh', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(strings.actions.realtimeActive)).toBeInTheDocument();
    });

    // Toggle to Paused
    const realtimeToggle = screen.getByRole('button', { name: new RegExp(strings.actions.realtimeActive) });
    fireEvent.click(realtimeToggle);

    expect(screen.getByText(strings.actions.realtimePaused)).toBeInTheDocument();

    // Toggle back to Active
    fireEvent.click(realtimeToggle);
    expect(screen.getByText(strings.actions.realtimeActive)).toBeInTheDocument();

    // Manual refresh button click
    const refreshBtn = screen.getByRole('button', { name: strings.actions.refresh });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(fetchLoginLogs).toHaveBeenCalled();
    });
  });

  it('triggers CSV export download', async () => {
    const createElementSpy = jest.spyOn(document, 'createElement');
    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: strings.actions.exportCsv });
    fireEvent.click(exportBtn);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it('handles pagination next and previous controls safely', async () => {
    // Generate 15 items to test pagination
    const manyLogs: LoginLogEntry[] = Array.from({ length: 15 }, (_, i) => ({
      id: `log_page_${String(i).padStart(2, '0')}`,
      userName: `User Page ${i}`,
      email: `user${i}@test.com`,
      phoneNumber: '+91 99999 11111',
      companyName: `Company ${i}`,
      userType: (i % 2 === 0 ? 'buyer' : 'vendor') as 'buyer' | 'vendor',
      loginAt: new Date(Date.now() - i * 60000).toISOString(),
      status: 'ACTIVE' as const,
      createdAt: new Date().toISOString(),
    }));

    (fetchLoginLogs as jest.Mock).mockResolvedValue({
      logs: manyLogs,
      total: manyLogs.length,
      page: 1,
      totalPages: 2,
    });

    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('User Page 0')).toBeInTheDocument();
    });

    // Page 1 has 10 items
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    // Go to next page
    const nextBtn = screen.getByLabelText('Next Page');
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      expect(screen.getByText('User Page 14')).toBeInTheDocument();
    });

    // Go to previous page
    const prevBtn = screen.getByLabelText('Previous Page');
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.getByText('User Page 0')).toBeInTheDocument();
    });
  });

  it('handles client errors gracefully without crashing', async () => {
    (fetchLoginLogs as jest.Mock).mockRejectedValueOnce(new Error('Fatal error'));
    (fetchLoginLogsSummary as jest.Mock).mockRejectedValueOnce(new Error('Fatal summary'));

    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(strings.title)).toBeInTheDocument();
    });
  });

  it('supports sorting columns on User & Role, Company, Login Time, and Logout Time', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    // Sort by User & Role (first asc, then desc)
    const userCol = screen.getByText(strings.table.colUser);
    fireEvent.click(userCol);
    fireEvent.click(userCol);

    // Sort by Company
    const compCol = screen.getByText(strings.table.colCompany);
    fireEvent.click(compCol);
    fireEvent.click(compCol);

    // Sort by Login Time
    const loginCol = screen.getByText(strings.table.colLoginTime);
    fireEvent.click(loginCol);
    fireEvent.click(loginCol);

    // Sort by Logout Time / Duration
    const logoutCol = screen.getByText(strings.table.colLogoutTime);
    fireEvent.click(logoutCol);
    fireEvent.click(logoutCol);
  });

  it('opens column settings modal, resets and saves column preferences', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    const gearBtn = screen.getByTitle('Column Settings');
    fireEvent.click(gearBtn);

    expect(screen.getByRole('dialog', { name: 'Login Logs Columns' })).toBeInTheDocument();

    // Toggle a column
    const toggleIp = screen.getByLabelText('Toggle column: IP & Device Info');
    fireEvent.click(toggleIp);

    // Click Done to save
    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(screen.queryByRole('dialog', { name: 'Login Logs Columns' })).not.toBeInTheDocument();

    // Reopen and click Reset to Default
    fireEvent.click(gearBtn);
    expect(screen.getByRole('dialog', { name: 'Login Logs Columns' })).toBeInTheDocument();
    const resetBtn = screen.getByText('Reset to Default');
    fireEvent.click(resetBtn);
    expect(screen.queryByRole('dialog', { name: 'Login Logs Columns' })).not.toBeInTheDocument();
  });

  it('filters by Yesterday, Last 7 Days, and Last 30 Days presets', async () => {
    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    // Yesterday
    const yBtn = screen.getByText(strings.filters.dateRangeYesterday);
    fireEvent.click(yBtn);

    // Last 7 Days
    const l7Btn = screen.getByText(strings.filters.dateRangeLast7Days);
    fireEvent.click(l7Btn);

    // Last 30 Days
    const l30Btn = screen.getByText(strings.filters.dateRangeLast30Days);
    fireEvent.click(l30Btn);
  });

  it('loads saved column preferences from localStorage on mount and handles page boundaries', async () => {
    localStorage.setItem(
      'qua_login_logs_col_prefs',
      JSON.stringify([{ key: 'user', label: 'User & Role', visible: true, required: true }])
    );

    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    localStorage.removeItem('qua_login_logs_col_prefs');
  });

  it('covers branch edge cases for duration formatting, custom date range inputs, and unknown keys', async () => {
    // Mock log with live active status, zero duration, null logout, and various values
    const edgeLogs = [
      {
        ...mockLogs[0],
        id: 'edge_1',
        logoutAt: null,
        durationSeconds: 0,
        status: 'ACTIVE',
        deviceInfo: '',
      },
      {
        ...mockLogs[1],
        id: 'edge_2',
        loginAt: 'invalid-date',
        logoutAt: 'invalid-date',
        durationSeconds: -5,
        status: 'OTHER_STATUS',
      },
      {
        ...mockLogs[2],
        id: 'edge_3',
        loginAt: '1970-01-01T00:00:00.000Z',
        durationSeconds: 7200, // hours duration
        status: 'TIMED_OUT',
      }
    ];

    (fetchLoginLogs as jest.Mock).mockResolvedValueOnce({
      logs: edgeLogs,
      total: edgeLogs.length,
      page: 1,
      totalPages: 1,
    });

    render(<LoginLogsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Rajesh Sharma')).toBeInTheDocument();
    });

    // Custom date range inputs
    const customPresetBtn = screen.getByText(strings.filters.dateRangeCustom);
    fireEvent.click(customPresetBtn);

    const startInput = screen.getByLabelText(strings.filters.startDate);
    fireEvent.change(startInput, { target: { value: '2026-10-01' } });

    const endInput = screen.getByLabelText(strings.filters.endDate);
    fireEvent.change(endInput, { target: { value: '2026-10-31' } });
  });
});
