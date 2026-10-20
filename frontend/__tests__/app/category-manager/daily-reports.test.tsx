import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailyDownloadableReports from '@/app/category-manager/daily-reports';
import CategoryManagerDailyReportsPage from '@/app/category-manager/daily-reports/page';
import * as reportsClient from '@/lib/reportsClient';

jest.mock('@/lib/reportsClient', () => {
  const actual = jest.requireActual('@/lib/reportsClient');
  return {
    ...actual,
    fetchReportData: jest.fn(),
    exportReportToExcel: jest.fn(),
    exportReportToCsv: jest.fn(),
  };
});

describe('DailyDownloadableReports Component Suite', () => {
  const mockSellerData = [
    {
      RFQDate: '2026-10-18',
      RFQID: 'RFQ-001',
      SellerCompanyName: 'Alpha Supplies',
      SourcingMode: 'Mode 1',
      Status: 'Quote Submitted',
    },
    {
      RFQDate: '2026-10-19',
      RFQID: 'RFQ-002',
      SellerCompanyName: 'Beta Tech',
      SourcingMode: 'Mode 2',
      Status: 'Pending Bid',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValue({
      success: true,
      totalRecords: 2,
      data: mockSellerData,
    });
  });

  test('renders page title, category tabs, and initial report data', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    expect(screen.getByText('Daily Downloadable Reports')).toBeInTheDocument();
    expect(screen.getByText('Seller Reports')).toBeInTheDocument();
    expect(screen.getByText('RFQ Reports')).toBeInTheDocument();
    expect(screen.getByText('Buyer Reports')).toBeInTheDocument();
    expect(screen.queryByText('Daily Operations Overview')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Alpha Supplies')).toBeInTheDocument();
      expect(screen.getByText('Beta Tech')).toBeInTheDocument();
      expect(screen.getByText('Mode 1')).toBeInTheDocument();
    });
  });

  test('switches category tabs and updates sub-report options', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    // Switch to RFQ Reports tab
    const rfqTab = screen.getByText('RFQ Reports');
    fireEvent.click(rfqTab);

    await waitFor(() => {
      expect(reportsClient.fetchReportData).toHaveBeenCalled();
    });

    // Switch to Buyer Reports tab
    const buyerTab = screen.getByText('Buyer Reports');
    fireEvent.click(buyerTab);

    await waitFor(() => {
      expect(reportsClient.fetchReportData).toHaveBeenCalled();
    });
  });

  test('default empty dates, date filter presets, manual dates and clear dates', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    const startDateInput = screen.getByLabelText('Start Date');
    const endDateInput = screen.getByLabelText('End Date');

    // Wait for initial fetch to settle so loading is false
    await waitFor(() => {
      expect(screen.getByText('Alpha Supplies')).toBeInTheDocument();
    });

    // Default: no dates selected
    expect(startDateInput).toHaveValue('');
    expect(endDateInput).toHaveValue('');

    // Test clicking presets
    const todayBtn = screen.getByText('Today');
    fireEvent.click(todayBtn);
    expect(startDateInput.getAttribute('value')).toBeTruthy();
    expect(reportsClient.fetchReportData).toHaveBeenCalled();

    const weekBtn = screen.getByText('7 Days');
    fireEvent.click(weekBtn);
    expect(reportsClient.fetchReportData).toHaveBeenCalled();

    const monthBtn = screen.getByText('Month');
    fireEvent.click(monthBtn);
    expect(reportsClient.fetchReportData).toHaveBeenCalled();

    const thirtyDaysBtn = screen.getByText('30 Days');
    await waitFor(() => expect(thirtyDaysBtn).not.toBeDisabled());
    fireEvent.click(thirtyDaysBtn);
    expect(reportsClient.fetchReportData).toHaveBeenCalled();

    // Clear dates
    await waitFor(() => {
      const clearBtn = screen.getByText('Clear dates');
      expect(clearBtn).not.toBeDisabled();
    });
    const clearBtn = screen.getByText('Clear dates');
    fireEvent.click(clearBtn);
    expect(startDateInput).toHaveValue('');
    expect(endDateInput).toHaveValue('');

    // Custom manual date inputs
    fireEvent.change(startDateInput, { target: { value: '2026-05-01' } });
    fireEvent.change(endDateInput, { target: { value: '2026-05-20' } });

    expect(startDateInput).toHaveValue('2026-05-01');
    expect(endDateInput).toHaveValue('2026-05-20');

    const refreshBtn = await screen.findByText(/Refresh \/ Query Report/);
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(reportsClient.fetchReportData).toHaveBeenCalledWith(
        expect.anything(),
        '2026-05-01',
        '2026-05-20'
      );
    });
  });

  test('search filtering across columns in table', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Supplies')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search report columns...');
    fireEvent.change(searchInput, { target: { value: 'Beta' } });

    expect(screen.queryByText('Alpha Supplies')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Tech')).toBeInTheDocument();
  });

  test('pagination page size and page navigation', async () => {
    const manyRows = Array.from({ length: 25 }, (_, i) => ({
      RFQID: `RFQ-00${i}`,
      Seller: `Vendor ${i}`,
    }));

    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: true,
      totalRecords: 25,
      data: manyRows,
    });

    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('Vendor 0')).toBeInTheDocument();
    });

    const nextBtn = screen.getByText('Next');
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    });

    const prevBtn = screen.getByText('Previous');
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    const pageSizeSelect = screen.getByDisplayValue('10 per page');
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });

    await waitFor(() => {
      expect(screen.getByText('Vendor 24')).toBeInTheDocument();
    });
  });

  test('displays error message when report query fails', async () => {
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Backend service timeout',
    });

    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('Backend service timeout')).toBeInTheDocument();
    });
  });

  test('global export buttons invoke Excel and CSV export functions', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Supplies')).toBeInTheDocument();
    });

    const excelBtn = screen.getByText('Excel (.xlsx)');
    fireEvent.click(excelBtn);
    expect(reportsClient.exportReportToExcel).toHaveBeenCalled();

    const csvBtn = screen.getByText('CSV (.csv)');
    fireEvent.click(csvBtn);
    expect(reportsClient.exportReportToCsv).toHaveBeenCalled();
  });



  test('renders empty state when report has no data', async () => {
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [],
    });

    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('No records found for the selected date range or query.')).toBeInTheDocument();
    });
  });

  test('renders Mode 0 fallback when SourcingMode is empty', async () => {
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [{ RFQID: 'RFQ-FALLBACK', SourcingMode: '' }],
    });

    render(<DailyDownloadableReports initialCategory="seller" />);

    await waitFor(() => {
      expect(screen.getByText('Mode 0')).toBeInTheDocument();
    });
  });

  test('page wrapper component CategoryManagerDailyReportsPage mounts successfully', () => {
    render(<CategoryManagerDailyReportsPage />);
    expect(screen.getByText('Daily Downloadable Reports')).toBeInTheDocument();
  });
});
