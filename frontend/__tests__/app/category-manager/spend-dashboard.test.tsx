import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SpendDashboard, { calculateTurnaround } from '@/app/category-manager/spend-dashboard';
import { useApp } from '@/lib/store';
import type { AuditLogEntry, RFQItem } from '@/lib/types';
import { UI_STRINGS } from '@/lib/uiStrings';

const EMPTY_VALUE = UI_STRINGS.dataLoad.emptyCell;

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
    // No invitations exist, so the response rate and mode efficiency are dashes rather than 0.0%.
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getAllByText(EMPTY_VALUE).length).toBeGreaterThan(0);
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
    expect(screen.getByText(`Avg ${EMPTY_VALUE} downloads per RFQ`)).toBeInTheDocument();
    expect((raisedCard as HTMLButtonElement).disabled).toBe(true);
    expect((vendorCard as HTMLButtonElement).disabled).toBe(true);
  });

  test('shows the recorded per-channel attempts and a dash for a channel with no attempts', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const rfqs = [
      {
        id: 'rfq-channels',
        rfqNumber: 'RFQ-CHANNELS',
        title: 'Channel RFQ',
        sourcingMode: 'MODE 2' as RFQItem['sourcingMode'],
        createdAt,
        assignedVendors: [],
        followUpData: {
          totalInvited: 4,
          respondedCount: 1,
          whatsappStats: { total: 4, delivered: 0, read: 0, replied: 1 },
          callStats: { total: 0, connected: 0, avgDuration: '' },
          smsStats: { total: 5, delivered: 0, clicked: 0 },
          emailStats: { total: 2, sent24h: 0, opened: 2 },
        },
      },
    ] as unknown as RFQItem[];
    mockUseApp.mockReturnValue({ rfqs, auditLogs: [] as AuditLogEntry[] } as ReturnType<typeof useApp>);

    render(<SpendDashboard onBackToKanban={jest.fn()} />);

    const whatsappRow = screen.getByText('WhatsApp replies').closest('div')?.parentElement as HTMLElement;
    expect(within(whatsappRow).getByText('25.0%')).toBeInTheDocument();
    expect(within(whatsappRow).getByText('1 of 4 recorded attempts')).toBeInTheDocument();

    const emailRow = screen.getByText('Email opens').closest('div')?.parentElement as HTMLElement;
    expect(within(emailRow).getByText('100.0%')).toBeInTheDocument();

    const smsRow = screen.getByText('SMS link clicks').closest('div')?.parentElement as HTMLElement;
    expect(within(smsRow).getByText('0.0%')).toBeInTheDocument();
    expect(within(smsRow).getByText('0 of 5 recorded attempts')).toBeInTheDocument();

    const callRow = screen.getByText('Voice call connections').closest('div')?.parentElement as HTMLElement;
    expect(within(callRow).getByText(EMPTY_VALUE)).toBeInTheDocument();
    expect(within(callRow).getByText('No attempts recorded for this channel')).toBeInTheDocument();
  });

  test('computes turnaround only from valid RFQ and quote timestamps', () => {
    const now = Date.now();
    const day = 86_400_000;
    const createdTwoDaysAgo = new Date(now - 2 * day).toISOString();
    const rfqs = [
      {
        id: 'rfq-timed',
        rfqNumber: 'RFQ-TIMED',
        title: 'Timed RFQ',
        sourcingMode: 'MODE 3' as RFQItem['sourcingMode'],
        createdAt: createdTwoDaysAgo,
        assignedVendors: [],
        quotes: [
          { vendorId: 'v-1', submittedAt: new Date(now - day).toISOString() },
          { vendorId: 'v-2' },
          { vendorId: 'v-3', submittedAt: 'not-a-date' },
          { vendorId: 'v-4', submittedAt: createdTwoDaysAgo },
        ],
      },
      {
        id: 'rfq-untimed',
        rfqNumber: 'RFQ-UNTIMED',
        title: 'Untimed RFQ',
        sourcingMode: 'MODE 3' as RFQItem['sourcingMode'],
        createdAt: '',
        assignedVendors: [],
        quotes: [{ vendorId: 'v-5', submittedAt: new Date(now).toISOString() }],
      },
    ] as unknown as RFQItem[];
    mockUseApp.mockReturnValue({ rfqs, auditLogs: [] as AuditLogEntry[] } as ReturnType<typeof useApp>);

    render(<SpendDashboard onBackToKanban={jest.fn()} />);

    expect(screen.getByText('1.0 Days')).toBeInTheDocument();
    expect(calculateTurnaround([])).toBe(EMPTY_VALUE);
    expect(calculateTurnaround(rfqs.slice(1))).toBe(EMPTY_VALUE);
  });
});
