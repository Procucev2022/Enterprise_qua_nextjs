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
    expect(screen.getByText('Daily Operations Overview')).toBeInTheDocument();

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

    // Switch to Daily Operations tab
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: {
        rfqsCreated: 12,
        quotesReceived: 25,
        newBuyersRegistered: 4,
        newVendorsRegistered: 7,
        totalAuditEvents: 88,
      },
    });

    const dailyTab = screen.getByText('Daily Operations Overview');
    fireEvent.click(dailyTab);

    await waitFor(() => {
      expect(screen.getByText('RFQs Dispatched')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  test('changing date filter presets and custom date inputs', async () => {
    render(<DailyDownloadableReports initialCategory="seller" />);

    const todayBtn = screen.getByText('Today');
    fireEvent.click(todayBtn);

    const weekBtn = screen.getByText('7 Days');
    fireEvent.click(weekBtn);

    const monthBtn = screen.getByText('Month');
    fireEvent.click(monthBtn);

    // Custom date changes
    const dateInputs = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/);
    if (dateInputs.length >= 2) {
      fireEvent.change(dateInputs[0], { target: { value: '2026-05-01' } });
      fireEvent.change(dateInputs[1], { target: { value: '2026-05-20' } });
    }

    const refreshBtn = await screen.findByText(/Refresh \/ Query Report/);
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(reportsClient.fetchReportData).toHaveBeenCalled();
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

  test('exports summary data when in daily activity mode', async () => {
    (reportsClient.fetchReportData as jest.Mock).mockResolvedValueOnce({
      success: true,
      summary: { rfqsCreated: 10 },
    });

    render(<DailyDownloadableReports initialCategory="daily_activity" />);

    await waitFor(() => {
      expect(screen.getByText('RFQs Dispatched')).toBeInTheDocument();
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
