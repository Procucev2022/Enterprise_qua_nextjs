import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SpendDashboard from '@/app/category-manager/spend-dashboard';
import * as storeModule from '@/lib/store';
import type { RFQItem, AuditLogEntry } from '@/lib/types';

jest.mock('@/lib/store');

describe('SpendDashboard Component Suite', () => {
  const mockOnBackToKanban = jest.fn();
  const mockOnNavigateToAllRfqs = jest.fn();
  const mockOnNavigateToVendorConsole = jest.fn();
  const mockOnNavigateToKanban = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const sampleRfqs: RFQItem[] = [
    {
      id: 'rfq-1',
      rfqNumber: 'RFQ-001',
      title: 'Centrifugal Pumps Sourcing',
      category: 'Pumps & Valves',
      sourcingMode: 'MODE 1',
      status: 'In Progress',
      createdAt: new Date().toISOString(),
      assignedVendors: ['v-1', 'v-2'],
      followUpData: {
        totalInvited: 2,
        respondedCount: 1,
      },
    } as unknown as RFQItem,
    {
      id: 'rfq-2',
      rfqNumber: 'RFQ-002',
      title: 'High Pressure Valves',
      category: 'Pumps & Valves',
      sourcingMode: 'MODE 2',
      status: 'Open',
      createdAt: new Date().toISOString(),
      assignedVendors: ['v-3'],
      followUpData: {
        totalInvited: 4,
        respondedCount: 2,
      },
    } as unknown as RFQItem,
    {
      id: 'rfq-3',
      rfqNumber: 'RFQ-003',
      title: 'Electrical Motors Supply',
      category: 'Electricals',
      sourcingMode: 'MODE 3',
      status: 'Open',
      createdAt: new Date().toISOString(),
      assignedVendors: ['v-4', 'v-5', 'v-6'],
      followUpData: {
        totalInvited: 5,
        respondedCount: 3,
      },
    } as unknown as RFQItem,
    {
      id: 'rfq-4',
      rfqNumber: 'RFQ-004',
      title: 'Uncategorized Sourcing',
      category: 'General',
      sourcingMode: '',
      status: 'Draft',
      createdAt: new Date().toISOString(),
      assignedVendors: undefined,
      followUpData: undefined,
    } as unknown as RFQItem,
    {
      id: 'rfq-5',
      rfqNumber: undefined,
      title: 'Undefined Mode RFQ',
      category: 'General',
      sourcingMode: undefined,
      status: 'Draft',
      createdAt: new Date().toISOString(),
      assignedVendors: [],
      followUpData: {
        totalInvited: 0,
        respondedCount: 0,
      },
    } as unknown as RFQItem,
  ];

  const sampleAuditLogs: AuditLogEntry[] = [
    {
      id: 'log-1',
      action: 'Vendor downloaded RFQ specification for RFQ-001',
      rfqNumber: 'RFQ-001',
      timestamp: new Date().toISOString(),
      user: 'vendor@test.com',
      shaSignature: 'sha1',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
    {
      id: 'log-2',
      action: 'Vendor downloaded RFQ specification for rfq-2',
      rfqNumber: 'rfq-2',
      timestamp: new Date().toISOString(),
      user: 'vendor2@test.com',
      shaSignature: 'sha2',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
    {
      id: 'log-3',
      action: 'Vendor downloaded RFQ specification for RFQ-003',
      rfqNumber: 'RFQ-003',
      timestamp: new Date().toISOString(),
      user: 'vendor3@test.com',
      shaSignature: 'sha3',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
    {
      id: 'log-4',
      action: 'Vendor downloaded RFQ specification for unlinked RFQ',
      rfqNumber: 'RFQ-NONEXISTENT',
      timestamp: new Date().toISOString(),
      user: 'vendor4@test.com',
      shaSignature: 'sha4',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
    {
      id: 'log-5',
      action: 'Vendor downloaded RFQ specification without rfqNumber',
      rfqNumber: undefined,
      timestamp: new Date().toISOString(),
      user: 'vendor5@test.com',
      shaSignature: 'sha5',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
    {
      id: 'log-6',
      action: 'Other action not related to specification download',
      rfqNumber: 'RFQ-001',
      timestamp: new Date().toISOString(),
      user: 'buyer@test.com',
      shaSignature: 'sha6',
      status: 'VERIFIED',
      ipAddress: '127.0.0.1',
    },
  ];

  it('renders correctly with populated RFQs and audit logs, displaying all KPI metrics and mode breakdown', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: sampleRfqs,
      auditLogs: sampleAuditLogs,
    });

    render(
      <SpendDashboard
        onBackToKanban={mockOnBackToKanban}
        onNavigateToAllRfqs={mockOnNavigateToAllRfqs}
        onNavigateToVendorConsole={mockOnNavigateToVendorConsole}
        onNavigateToKanban={mockOnNavigateToKanban}
      />
    );

    // Header & Titles
    expect(screen.getByText(/Back to Operational Monitoring Kanban/i)).toBeInTheDocument();
    expect(screen.getByText(/RFQs Received \(Raised\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/RFQs Downloaded/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Avg Vendors \/ RFQ/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendor Response Rate/i)).toBeInTheDocument();

    // Mode Titles
    expect(screen.getByText('Private Client Roster')).toBeInTheDocument();
    expect(screen.getByText('Hybrid Base Network')).toBeInTheDocument();
    expect(screen.getByText('360° AI Evaluated Roster')).toBeInTheDocument();

    // Navigation buttons are active and clickable
    fireEvent.click(screen.getByText(/Back to Operational Monitoring Kanban/i));
    expect(mockOnBackToKanban).toHaveBeenCalledTimes(1);

    const allRfqsButtons = screen.getAllByRole('button', { name: /RFQs/i });
    fireEvent.click(allRfqsButtons[0]);
    expect(mockOnNavigateToAllRfqs).toHaveBeenCalled();

    const vendorConsoleBtn = screen.getByRole('button', { name: /Avg Vendors \/ RFQ/i });
    fireEvent.click(vendorConsoleBtn);
    expect(mockOnNavigateToVendorConsole).toHaveBeenCalledTimes(1);

    const kanbanBtn = screen.getByRole('button', { name: /Vendor Response Rate/i });
    fireEvent.click(kanbanBtn);
    expect(mockOnNavigateToKanban).toHaveBeenCalledTimes(1);
  });

  it('handles empty data state gracefully with default zero/fallback values and disabled navigation buttons when callbacks are omitted', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: [],
      auditLogs: [],
    });

    render(<SpendDashboard onBackToKanban={mockOnBackToKanban} />);

    // SLA should show fallback dashes '—'
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);

    // Rate calculations should display '0.0' or '0.0%'
    expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0);
    expect(screen.getByText(/Avg 0.0 downloads per RFQ/i)).toBeInTheDocument();

    // Navigation buttons without callbacks should be disabled
    const rfqReceivedBtn = screen.getByRole('button', { name: /RFQs Received \(Raised\)/i });
    expect(rfqReceivedBtn).toBeDisabled();

    const rfqDownloadedBtn = screen.getByRole('button', { name: /RFQs Downloaded/i });
    expect(rfqDownloadedBtn).toBeDisabled();

    const avgVendorsBtn = screen.getByRole('button', { name: /Avg Vendors \/ RFQ/i });
    expect(avgVendorsBtn).toBeDisabled();

    const vendorResponseBtn = screen.getByRole('button', { name: /Vendor Response Rate/i });
    expect(vendorResponseBtn).toBeDisabled();
  });

  it('handles edge cases where invited is 0, modeRfqs is empty, or audit logs lack rfq numbers', () => {
    const edgeRfqs: RFQItem[] = [
      {
        id: 'rfq-no-invited',
        rfqNumber: 'RFQ-ZERO',
        title: 'Zero Invited RFQ',
        sourcingMode: 'MODE 1',
        status: 'Quotes Pending',
        followUpData: {
          totalInvited: 0,
          respondedCount: 0,
        },
      } as unknown as RFQItem,
    ];

    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: edgeRfqs,
      auditLogs: [],
    });

    render(
      <SpendDashboard
        onBackToKanban={mockOnBackToKanban}
        onNavigateToAllRfqs={mockOnNavigateToAllRfqs}
      />
    );

    // Mode 1 exists, but Mode 2 and Mode 3 have 0 RFQs
    expect(screen.getByText('Private Client Roster')).toBeInTheDocument();
    expect(screen.getByText('3.6 Days')).toBeInTheDocument();
    // Mode 2 and 3 should have '—'
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
