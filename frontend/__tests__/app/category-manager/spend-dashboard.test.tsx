import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SpendDashboard from '@/app/category-manager/spend-dashboard';
import { useApp } from '@/lib/store';
import type { AuditLogEntry, RFQItem } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

const mockUseApp = useApp as jest.MockedFunction<typeof useApp>;

describe('SpendDashboard metrics', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('counts current RFQs and handles missing mode and follow-up data', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const rfqs = [
      {
        id: 'rfq-mode-one',
        rfqNumber: 'RFQ-MODE-ONE',
        title: 'Mode one RFQ',
        category: 'Industrial',
        sourcingMode: 'MODE 1' as RFQItem['sourcingMode'],
        createdAt,
        assignedVendors: [],
      },
      {
        id: 'rfq-no-mode',
        rfqNumber: 'RFQ-NO-MODE',
        title: 'RFQ without a sourcing mode',
        category: 'Industrial',
        sourcingMode: '',
        createdAt,
      },
    ] as unknown as RFQItem[];
    mockUseApp.mockReturnValue({ rfqs, auditLogs: [] as AuditLogEntry[] } as ReturnType<typeof useApp>);

    render(<SpendDashboard onBackToKanban={jest.fn()} />);

    const raisedCard = screen.getByText('RFQs Received (Raised)').closest('button');
    expect(raisedCard).not.toBeNull();
    expect(within(raisedCard as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Avg 0.0 downloads per RFQ')).toBeInTheDocument();
    expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0);
  });

  test('calculates populated metrics and invokes the available navigation actions', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const rfqs = [
      {
        id: 'rfq-mode-one',
        rfqNumber: 'RFQ-MODE-ONE',
        title: 'Mode one RFQ',
        category: 'Industrial',
        sourcingMode: 'MODE 1' as RFQItem['sourcingMode'],
        createdAt,
        assignedVendors: [{ id: 'vendor-1', name: 'Vendor One' }],
        followUpData: { totalInvited: 2, respondedCount: 1 },
      },
    ] as unknown as RFQItem[];
    const auditLogs = [
      { action: 'downloaded RFQ specification', rfqNumber: 'RFQ-MODE-ONE' },
      { action: 'opened RFQ specification', rfqNumber: 'RFQ-MODE-ONE' },
      { action: 'downloaded RFQ specification' },
    ] as AuditLogEntry[];
    const onBackToKanban = jest.fn();
    const onNavigateToAllRfqs = jest.fn();
    const onNavigateToVendorConsole = jest.fn();
    const onNavigateToKanban = jest.fn();
    mockUseApp.mockReturnValue({ rfqs, auditLogs } as ReturnType<typeof useApp>);

    render(
      <SpendDashboard
        onBackToKanban={onBackToKanban}
        onNavigateToAllRfqs={onNavigateToAllRfqs}
        onNavigateToVendorConsole={onNavigateToVendorConsole}
        onNavigateToKanban={onNavigateToKanban}
      />,
    );

    const raisedCard = screen.getByText('RFQs Received (Raised)').closest('button');
    expect(raisedCard).not.toBeNull();
    expect(within(raisedCard as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Avg 2.0 downloads per RFQ')).toBeInTheDocument();
    expect(screen.getByText('1 Downloads (50.0%)')).toBeInTheDocument();
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Back to Operational Monitoring Kanban'));
    fireEvent.click(raisedCard as HTMLElement);
    fireEvent.click(screen.getByText('Avg Vendors / RFQ').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('Vendor Response Rate').closest('button') as HTMLElement);

    expect(onBackToKanban).toHaveBeenCalledTimes(1);
    expect(onNavigateToAllRfqs).toHaveBeenCalledTimes(1);
    expect(onNavigateToVendorConsole).toHaveBeenCalledTimes(1);
    expect(onNavigateToKanban).toHaveBeenCalledTimes(1);
  });

  test('uses zero values and disables navigation when there is no RFQ data', () => {
    mockUseApp.mockReturnValue({ rfqs: [], auditLogs: [] } as unknown as ReturnType<typeof useApp>);

    render(<SpendDashboard onBackToKanban={jest.fn()} />);

    const raisedCard = screen.getByText('RFQs Received (Raised)').closest('button');
    const vendorCard = screen.getByText('Avg Vendors / RFQ').closest('button');
    expect(raisedCard).not.toBeNull();
    expect(vendorCard).not.toBeNull();
    expect(within(raisedCard as HTMLElement).getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Avg 0.0 downloads per RFQ')).toBeInTheDocument();
    expect((raisedCard as HTMLButtonElement).disabled).toBe(true);
    expect((vendorCard as HTMLButtonElement).disabled).toBe(true);
  });
});
