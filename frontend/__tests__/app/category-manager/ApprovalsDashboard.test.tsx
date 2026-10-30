import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApprovalsDashboard from '@/app/category-manager/components/ApprovalsDashboard';
import * as approvalClient from '@/lib/approvalClient';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/approvalClient', () => {
  const actual = jest.requireActual('@/lib/approvalClient');
  return {
    ...actual,
    fetchApprovalSummary: jest.fn(),
    fetchApprovals: jest.fn(),
    processApprovalAction: jest.fn(),
  };
});

const mockSummary = {
  total: 6,
  pending: 2,
  approved: 3,
  rejected: 1,
};

const mockApprovalsList = [
  {
    id: 'appr-101',
    request_number: 'REQ-1001',
    module: 'Credit Notes',
    unit_project: 'Unit A-402 / Project Falcon',
    project: 'Tata',
    applicant_name: 'Tata Steel Solutions Ltd',
    applicant_email: 'procurement@tatasteel.com',
    value_impact: '₹1,50,000 credit adjustment',
    impact_amount: 150000,
    maker_name: 'Priya Sharma (Finance Exec)',
    maker_role: 'Finance Exec',
    status: 'Pending',
    created_at: '2026-10-29T11:00:00Z',
    updated_at: '2026-10-29T11:00:00Z',
  },
  {
    id: 'appr-102',
    request_number: 'REQ-1002',
    module: 'Offline Payments',
    unit_project: 'Unit B-101 / Project Orion',
    project: 'JSW',
    applicant_name: 'JSW Infrastructure',
    applicant_email: 'accounts@jsw.in',
    value_impact: '₹4,50,000 RTGS verification',
    impact_amount: 450000,
    maker_name: 'Rahul Varma (Sales Mgr)',
    maker_role: 'Sales Mgr',
    status: 'Approved',
    created_at: '2026-10-28T14:00:00Z',
    updated_at: '2026-10-28T16:00:00Z',
  },
  {
    id: 'appr-103',
    request_number: 'REQ-1003',
    module: 'Cancellations & Refunds',
    unit_project: 'Unit C-202 / Project Titan',
    project: 'Larsen',
    applicant_name: 'L&T Construction',
    applicant_email: 'contracts@lnt.com',
    value_impact: '₹12,00,000 cancellation fee',
    impact_amount: 1200000,
    maker_name: 'Sunil Mehta (Ops Head)',
    maker_role: 'Ops Head',
    status: 'Rejected',
    created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-27T12:00:00Z',
  },
];

describe('ApprovalsDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (approvalClient.fetchApprovalSummary as jest.Mock).mockResolvedValue(mockSummary);
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: mockApprovalsList,
      total: 3,
    });
    (approvalClient.processApprovalAction as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders summary cards and approval table rows with badges', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
      expect(screen.getByText('Tata Steel Solutions Ltd')).toBeInTheDocument();
      expect(screen.getByText('REQ-1002')).toBeInTheDocument();
      expect(screen.getByText('REQ-1003')).toBeInTheDocument();
    });

    // Check summary cards
    expect(screen.getByText('6')).toBeInTheDocument(); // total
  });

  it('filters approvals by module tabs', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const creditNotesTab = screen.getByRole('button', { name: UI_STRINGS.actionCenter.approvals.creditNotes });
    fireEvent.click(creditNotesTab);

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ module: 'Credit Notes' })
      );
    });
  });

  it('filters approvals by search input', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by request ID, applicant, maker/i);
    fireEvent.change(searchInput, { target: { value: 'Tata Steel' } });

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Tata Steel' })
      );
    });
  });

  it('filters approvals by project and status dropdowns', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Tata' } });
    fireEvent.change(selects[1], { target: { value: 'Pending' } });

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ project: 'Tata', status: 'Pending' })
      );
    });
  });

  it('handles refresh button click', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(approvalClient.fetchApprovalSummary).toHaveBeenCalledTimes(2);
      expect(approvalClient.fetchApprovals).toHaveBeenCalledTimes(2);
    });
  });

  it('opens modal, types remarks, and approves request', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.approvals.approveBtn });
    fireEvent.click(approveButtons[0]);

    expect(screen.getByRole('heading', { name: /Confirm Approval/i })).toBeInTheDocument();

    const remarksInput = screen.getByPlaceholderText(/Add audit justification or notes/i);
    fireEvent.change(remarksInput, { target: { value: 'Approved per delegation of authority' } });

    const confirmBtn = screen.getByRole('button', { name: /^Confirm Approval$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(approvalClient.processApprovalAction).toHaveBeenCalledWith(
        'appr-101',
        'APPROVE',
        'Approved per delegation of authority'
      );
    });
  });

  it('opens modal and handles Cancel and Close buttons', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.approvals.approveBtn });
    fireEvent.click(approveButtons[0]);

    // Click Cancel button
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('heading', { name: /Confirm Approval/i })).not.toBeInTheDocument();

    // Reopen and test close modal button
    fireEvent.click(approveButtons[0]);
    const closeBtn = screen.getByRole('button', { name: /Close Modal/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('heading', { name: /Confirm Approval/i })).not.toBeInTheDocument();
  });

  it('opens modal and rejects request with remarks', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const rejectButtons = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.approvals.rejectBtn });
    fireEvent.click(rejectButtons[0]);

    expect(screen.getByRole('heading', { name: /Confirm Rejection/i })).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /^Confirm Rejection$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(approvalClient.processApprovalAction).toHaveBeenCalledWith(
        'appr-101',
        'REJECT',
        expect.any(String)
      );
    });
  });

  it('handles approval action failure with error toast', async () => {
    (approvalClient.processApprovalAction as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Authority limit exceeded',
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-1001')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.approvals.approveBtn });
    fireEvent.click(approveButtons[0]);

    const confirmBtn = screen.getByRole('button', { name: /^Confirm Approval$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Authority limit exceeded')).toBeInTheDocument();
    });
  });

  it('handles fetch exceptions gracefully', async () => {
    (approvalClient.fetchApprovalSummary as jest.Mock).mockRejectedValueOnce(new Error('Summary error'));
    (approvalClient.fetchApprovals as jest.Mock).mockRejectedValueOnce(new Error('List error'));

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.approvals.noApprovalsFound)).toBeInTheDocument();
    });
  });

  it('handles empty approval state gracefully', async () => {
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: [],
      total: 0,
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.approvals.noApprovalsFound)).toBeInTheDocument();
    });
  });
});
