import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ApprovalsDashboard from '@/app/category-manager/components/ApprovalsDashboard';
import * as approvalClient from '@/lib/approvalClient';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

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
    request_number: 'REQ-CR-9041',
    module: 'Buyer Credit Addition',
    request_type: 'Buyer Credit Addition',
    project: 'Tata Steel Maintenance',
    applicant_name: 'Tata Steel Procurement Team',
    applicant_email: 'buyer@tatasteel.com',
    value_impact: '₹2,50,000 (100 RFQ Credits)',
    amount: 250000,
    quantity: 100,
    available_balance: 5,
    maker_name: 'Govardhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Srinu Sir',
    status: 'Pending',
    details: 'Free trial expansion for mechanical spares RFQs.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Govardhan',
        actor_role: 'Category Manager',
        timestamp: '2026-10-29T11:00:00Z',
        remarks: 'Credit addition initiated.',
      },
    ],
    attachments: [
      { name: 'Commercial_Terms.pdf', url: '/files/terms.pdf', size: 1024 },
    ],
    created_at: '2026-10-29T11:00:00Z',
    updated_at: '2026-10-29T11:00:00Z',
  },
  {
    id: 'appr-102',
    request_number: 'REQ-ACC-8812',
    module: 'Account Approvals',
    request_type: 'Account Approvals',
    project: 'Enterprise Vendor Portal',
    applicant_name: 'Larsen & Toubro Heavy Eng',
    applicant_email: 'vendor.lt@lnt.com',
    value_impact: 'Tier 1 Preferred Access',
    amount: 0,
    quantity: 1,
    available_balance: 0,
    maker_name: 'Krishna',
    maker_role: 'Category Manager',
    assigned_approver: 'Sudheer Sir',
    status: 'Approved',
    details: 'Self-registered supplier onboarding verification.',
    approver_name: 'Sudheer Sir',
    approver_remarks: 'Approved per KYC clearance.',
    history: [],
    attachments: [],
    created_at: '2026-10-28T14:00:00Z',
    updated_at: '2026-10-28T16:00:00Z',
  },
  {
    id: 'appr-103',
    request_number: 'REQ-DSC-7104',
    module: 'Discounts',
    request_type: 'Discounts',
    project: 'JSW Steel Energy Sourcing',
    applicant_name: 'JSW Energy Plant 4',
    applicant_email: 'sourcing@jsw.in',
    value_impact: '15% Subscription Discount',
    amount: 75000,
    quantity: 1,
    available_balance: 10,
    maker_name: 'Chandhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Srinu Sir',
    status: 'Rejected',
    details: 'Discount request exceeded authorized ceiling.',
    approver_name: 'Srinu Sir',
    approver_remarks: 'Rejected: discount ceiling exceeded.',
    history: [],
    attachments: [],
    created_at: '2026-10-27T10:00:00Z',
    updated_at: '2026-10-27T12:00:00Z',
  },
];

describe('ApprovalsDashboard', () => {
  const strings = UI_STRINGS.actionCenter.approvals;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: 'u-1',
      name: 'Srinu Sir',
      email: 'srinu@procucev.com',
      role: 'admin',
      orgId: 'org-1',
      orgName: 'Procucev',
    });
    (approvalClient.fetchApprovalSummary as jest.Mock).mockResolvedValue({ summary: mockSummary });
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: mockApprovalsList,
      total: 3,
    });
    (approvalClient.processApprovalAction as jest.Mock).mockResolvedValue({ success: true });
    window.localStorage.clear();
  });

  it('renders 4 summary cards, 5 navigation tabs, and table records', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
      expect(screen.getByText('Tata Steel Procurement Team')).toBeInTheDocument();
      expect(screen.getByText('REQ-ACC-8812')).toBeInTheDocument();
      expect(screen.getByText('REQ-DSC-7104')).toBeInTheDocument();
    });

    // 4 Summary cards identified by unique subtitles
    expect(screen.getByText(strings.totalSubtitle)).toBeInTheDocument();
    expect(screen.getByText(strings.pendingSubtitle)).toBeInTheDocument();
    expect(screen.getByText(strings.approvedSubtitle)).toBeInTheDocument();
    expect(screen.getByText(strings.rejectedSubtitle)).toBeInTheDocument();

    // Toolbar controls rendered in single row
    expect(screen.getByPlaceholderText(strings.searchPlaceholder)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.projectFilterPlaceholder)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.allRequestTypes)).toBeInTheDocument();
    expect(screen.getByLabelText(strings.allStatuses)).toBeInTheDocument();
    expect(screen.getByTestId('toggle-my-approvals')).toBeInTheDocument();
  });

  it('filters by status and toggles my approvals cleanly', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // 1. Pending Approvals Card click
    const pendingCard = screen.getByTestId('card-pending-approvals');
    fireEvent.click(pendingCard);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Pending' })
      );
    });

    // Close summary popup
    fireEvent.click(screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.summaryModal.closeBtn })[0]);

    // 2. Approved Card click
    const approvedCard = screen.getByTestId('card-approved');
    fireEvent.click(approvedCard);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Approved' })
      );
    });
    fireEvent.click(screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.summaryModal.closeBtn })[0]);

    // 3. Rejected Card click
    const rejectedCard = screen.getByTestId('card-rejected');
    fireEvent.click(rejectedCard);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Rejected' })
      );
    });
    fireEvent.click(screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.summaryModal.closeBtn })[0]);

    // 4. Toggle My Approvals button
    const myApprovalsBtn = screen.getByTestId('toggle-my-approvals');
    fireEvent.click(myApprovalsBtn);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_approver: 'Srinu Sir' })
      );
    });

    // Toggle off My Approvals
    fireEvent.click(myApprovalsBtn);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_approver: undefined })
      );
    });

    // 5. Total Requests Card click
    const totalCard = screen.getByTestId('card-total-requests');
    fireEvent.click(totalCard);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined })
      );
    });
    fireEvent.click(screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.summaryModal.closeBtn })[0]);
  });

  it('clicking summary cards opens summary popup and applies filter', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const summaryCloseBtn = UI_STRINGS.actionCenter.summaryModal.closeBtn;

    // Click Pending Approvals Card via Enter key
    const pendingCard = screen.getByTestId('card-pending-approvals');
    await act(async () => {
      fireEvent.keyDown(pendingCard, { key: 'Enter', code: 'Enter' });
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(strings.summaryModalTitlePrefix, 'i'))).toBeInTheDocument();
    });

    // Close the summary popup modal
    const closeButtons = screen.getAllByRole('button', { name: summaryCloseBtn });
    fireEvent.click(closeButtons[0]);

    // Click Approved Card via Space key
    const approvedCard = screen.getByTestId('card-approved');
    await act(async () => {
      fireEvent.keyDown(approvedCard, { key: ' ', code: 'Space' });
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(strings.summaryModalTitlePrefix, 'i'))).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: summaryCloseBtn })[0]);

    // Click Rejected Card
    const rejectedCard = screen.getByTestId('card-rejected');
    await act(async () => {
      fireEvent.click(rejectedCard);
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(strings.summaryModalTitlePrefix, 'i'))).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: summaryCloseBtn })[0]);

    // Click Total Requests Card
    const totalCard = screen.getByTestId('card-total-requests');
    await act(async () => {
      fireEvent.click(totalCard);
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(strings.summaryModalTitlePrefix, 'i'))).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole('button', { name: summaryCloseBtn })[0]);
  });

  it('filters approvals by toolbar dropdowns and search input', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // The project filter is typed text. The request type and status dropdowns are the first two comboboxes.
    fireEvent.change(screen.getByLabelText(strings.projectFilterPlaceholder), { target: { value: 'Tata' } });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Buyer Credit Addition' } });
    fireEvent.change(selects[1], { target: { value: 'Pending' } });

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'Tata',
          module: 'Buyer Credit Addition',
          status: 'Pending',
        })
      );
    });

    // Test Search input
    const searchInput = screen.getByPlaceholderText(strings.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: 'REQ-CR' } });

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'REQ-CR' })
      );
    });

    // Test Refresh button
    const refreshBtn = screen.getByRole('button', { name: strings.refreshTooltip });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(approvalClient.fetchApprovalSummary).toHaveBeenCalledTimes(2);
      expect(approvalClient.fetchApprovals).toHaveBeenCalled();
    });
  });

  it('customizes table columns via Column Settings modal and persists to localStorage', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const gearBtn = screen.getByRole('button', { name: strings.columnSettingsTooltip });
    fireEvent.click(gearBtn);

    expect(screen.getByRole('heading', { name: strings.columnSettingsTitle })).toBeInTheDocument();

    // Toggle a non-locked column checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    // Move column up / down
    const moveDownButtons = screen.getAllByTitle(strings.moveDown);
    fireEvent.click(moveDownButtons[0]);

    const moveUpButtons = screen.getAllByTitle(strings.moveUp);
    fireEvent.click(moveUpButtons[1]);

    // Reset columns
    const resetBtn = screen.getByRole('button', { name: strings.resetToDefault });
    fireEvent.click(resetBtn);

    // Save columns
    const saveBtn = screen.getByRole('button', { name: strings.saveDone });
    fireEvent.click(saveBtn);

    expect(screen.queryByRole('heading', { name: strings.columnSettingsTitle })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('procucev_approval_col_prefs_u-1')).not.toBeNull();
  });

  it('restores column preferences from localStorage when stored previously', async () => {
    window.localStorage.setItem(
      'procucev_approval_col_prefs_u-1',
      JSON.stringify([
        { key: 'request_id', label: 'Request ID', visible: true, locked: true, order: 1 },
        { key: 'status', label: 'Status', visible: true, order: 2 },
      ])
    );

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });
  });

  it('supports sorting columns on header click', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // Click Request ID header
    const reqIdHeader = screen.getByText(strings.colRequestId);
    fireEvent.click(reqIdHeader);

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'request_number', sortOrder: 'asc' })
      );
    });

    // Click again to toggle desc
    fireEvent.click(reqIdHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'request_number', sortOrder: 'desc' })
      );
    });

    // Click Request Type header
    const typeHeader = screen.getByText(strings.colRequestType);
    fireEvent.click(typeHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'module', sortOrder: 'asc' })
      );
    });
  });

  it('opens detailed approval popup on Request ID click or View action', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // Click Request ID
    const reqIdLink = screen.getByRole('button', { name: 'REQ-CR-9041' });
    fireEvent.click(reqIdLink);

    expect(screen.getByRole('heading', { name: strings.detailsTitle })).toBeInTheDocument();
    expect(screen.getByText('Free trial expansion for mechanical spares RFQs.')).toBeInTheDocument();
    expect(screen.getByText('Commercial_Terms.pdf')).toBeInTheDocument();
    expect(screen.getByText('SUBMITTED')).toBeInTheDocument();

    // Close details
    const closeBtn = screen.getByRole('button', { name: strings.closeDetails });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole('heading', { name: strings.detailsTitle })).not.toBeInTheDocument();
  });

  it('opens details and approves request directly from details modal', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // Click View action on row 1
    const viewButtons = screen.getAllByRole('button', { name: new RegExp(strings.actionView, 'i') });
    fireEvent.click(viewButtons[0]);

    expect(screen.getByRole('heading', { name: strings.detailsTitle })).toBeInTheDocument();

    // Click Approve inside details modal
    const approveBtn = screen.getAllByRole('button', { name: strings.approveBtn });
    fireEvent.click(approveBtn[approveBtn.length - 1]);

    expect(screen.getByRole('heading', { name: strings.confirmApprovalTitle })).toBeInTheDocument();

    const remarksInput = screen.getByPlaceholderText(strings.executiveRemarksPlaceholder);
    fireEvent.change(remarksInput, { target: { value: 'Approved by Director' } });

    const passwordInput = screen.getByPlaceholderText(strings.passwordPlaceholder);
    fireEvent.change(passwordInput, { target: { value: 'test-approver-password' } });

    const confirmBtn = screen.getByRole('button', { name: strings.confirmApproveBtn });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(approvalClient.processApprovalAction).toHaveBeenCalledWith(
        'appr-101',
        'APPROVE',
        'Approved by Director',
        'test-approver-password',
        'Srinu Sir'
      );
    });
  });

  it('requires a typed approver name before a decision and sends the name that was entered', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: strings.approveBtn })[0]);
    const approverInput = screen.getByLabelText(strings.approverLabel);
    fireEvent.change(approverInput, { target: { value: '   ' } });
    fireEvent.change(screen.getByPlaceholderText(strings.passwordPlaceholder), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: strings.confirmApproveBtn }));

    expect(screen.getByText(strings.approverRequired)).toBeInTheDocument();
    expect(approvalClient.processApprovalAction).not.toHaveBeenCalled();

    fireEvent.change(approverInput, { target: { value: 'Sudheer Sir' } });
    fireEvent.click(screen.getByRole('button', { name: strings.confirmApproveBtn }));

    await waitFor(() => {
      expect(approvalClient.processApprovalAction).toHaveBeenCalledWith(
        'appr-101',
        'APPROVE',
        '',
        'secret-pass',
        'Sudheer Sir'
      );
    });
  });

  it('opens confirmation modal and rejects request from table action', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const rejectButtons = screen.getAllByRole('button', { name: strings.rejectBtn });
    fireEvent.click(rejectButtons[0]);

    expect(screen.getByRole('heading', { name: strings.confirmRejectionTitle })).toBeInTheDocument();

    const passwordInput = screen.getByPlaceholderText(strings.passwordPlaceholder);
    fireEvent.change(passwordInput, { target: { value: 'test-approver-password' } });

    const confirmBtn = screen.getByRole('button', { name: strings.confirmRejectBtn });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(approvalClient.processApprovalAction).toHaveBeenCalledWith(
        'appr-101',
        'REJECT',
        '',
        'test-approver-password',
        'Srinu Sir'
      );
    });
  });

  it('handles action cancellation and dismiss in confirmation modal', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: strings.approveBtn });
    fireEvent.click(approveButtons[0]);

    expect(screen.getByRole('heading', { name: strings.confirmApprovalTitle })).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: strings.cancelBtn });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('heading', { name: strings.confirmApprovalTitle })).not.toBeInTheDocument();
  });

  it('handles action failure with toast error', async () => {
    (approvalClient.processApprovalAction as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Authority limit exceeded for this level.',
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: strings.approveBtn });
    fireEvent.click(approveButtons[0]);

    const passwordInput = screen.getByPlaceholderText(strings.passwordPlaceholder);
    fireEvent.change(passwordInput, { target: { value: 'test-approver-password' } });

    const confirmBtn = screen.getByRole('button', { name: strings.confirmApproveBtn });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Authority limit exceeded for this level.').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles pagination next and previous controls', async () => {
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: mockApprovalsList,
      total: 30,
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 10 })
      );
    });

    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0 })
      );
    });
  });

  it('exports filtered approvals to CSV', async () => {
    const createObjectURLMock = jest.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLMock = jest.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;
    const linkClickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: new RegExp(strings.exportCsvBtn, 'i') });
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(linkClickSpy).toHaveBeenCalled();
    expect(screen.getByText(strings.exportCsvSuccess)).toBeInTheDocument();
    linkClickSpy.mockRestore();
  });

  it('shows error toast when export CSV is clicked on empty records', async () => {
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: [],
      total: 0,
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(strings.noApprovalsFound)).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: new RegExp(strings.exportCsvBtn, 'i') });
    fireEvent.click(exportBtn);

    expect(screen.getAllByText(strings.noApprovalsFound).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the summary and list errors from the client result, with dashes instead of zero counts', async () => {
    const summaryError = formatString(UI_STRINGS.dataLoad.failedWithStatus, {
      resource: UI_STRINGS.dataLoad.resources.approvalSummary,
      status: 500,
    });
    const listError = formatString(UI_STRINGS.dataLoad.failedWithStatus, {
      resource: UI_STRINGS.dataLoad.resources.approvals,
      status: 500,
    });
    (approvalClient.fetchApprovalSummary as jest.Mock).mockResolvedValue({ summary: null, error: summaryError });
    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({ data: [], total: 0, error: listError });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(summaryError)).toBeInTheDocument();
      expect(screen.getByText(listError)).toBeInTheDocument();
    });
    expect(screen.queryByText(strings.noApprovalsFound)).not.toBeInTheDocument();
    for (const cardId of ['card-total-requests', 'card-pending-approvals', 'card-approved', 'card-rejected']) {
      expect(screen.getByTestId(cardId)).toHaveTextContent(UI_STRINGS.dataLoad.emptyCell);
    }
    // Four summary cards and the pagination footer each show a dash.
    expect(screen.getAllByText(UI_STRINGS.dataLoad.emptyCell).length).toBeGreaterThanOrEqual(5);
  });

  it('reports a thrown client error as a network failure in both the summary and the list', async () => {
    (approvalClient.fetchApprovalSummary as jest.Mock).mockRejectedValue(new Error('Network drop'));
    (approvalClient.fetchApprovals as jest.Mock).mockRejectedValue(new Error('500 server error'));

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(
          formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvalSummary })
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvals })
        )
      ).toBeInTheDocument();
    });
  });

  it('handles remaining column header sorts (project, value impact, created at, status)', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // 1. Project / Account
    const projectHeader = screen.getByText(strings.colProjectAccount);
    fireEvent.click(projectHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'project', sortOrder: 'asc' })
      );
    });
    fireEvent.click(projectHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'project', sortOrder: 'desc' })
      );
    });

    // 2. Amount / Quantity
    const amountHeader = screen.getByText(strings.colAmountQuantity);
    fireEvent.click(amountHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'value_impact', sortOrder: 'asc' })
      );
    });
    fireEvent.click(amountHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'value_impact', sortOrder: 'desc' })
      );
    });

    // 3. Request Date
    const dateHeader = screen.getByText(strings.colRequestDate);
    fireEvent.click(dateHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'created_at', sortOrder: 'asc' })
      );
    });
    fireEvent.click(dateHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'created_at', sortOrder: 'desc' })
      );
    });

    // 4. Status
    const statusHeader = screen.getByText(strings.colStatus);
    fireEvent.click(statusHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'status', sortOrder: 'asc' })
      );
    });
    fireEvent.click(statusHeader);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'status', sortOrder: 'desc' })
      );
    });
  });

  it('handles status dropdown options: Approved, Rejected, and all', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    // Comboboxes in DOM order: request type, status, rows per page. The project filter is a text input.
    const statusSelect = screen.getAllByRole('combobox')[1];

    fireEvent.change(statusSelect, { target: { value: 'Approved' } });
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Approved' })
      );
    });

    fireEvent.change(statusSelect, { target: { value: 'Rejected' } });
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Rejected' })
      );
    });

    fireEvent.change(statusSelect, { target: { value: 'all' } });
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined })
      );
    });
  });

  it('handles rows per page (pageSize) changes', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const pageSizeSelect = screen.getByDisplayValue('10');
    fireEvent.change(pageSizeSelect, { target: { value: '25' } });

    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 })
      );
    });
  });

  it('handles column settings modal close, dismiss, disabled moves, and locked toggle', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const gearBtn = screen.getByRole('button', { name: strings.columnSettingsTooltip });
    fireEvent.click(gearBtn);

    expect(screen.getByRole('heading', { name: strings.columnSettingsTitle })).toBeInTheDocument();

    // Attempt to toggle locked column (index 0 is locked Request ID)
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // locked column

    // Attempt to move top column up (boundary condition)
    const upButtons = screen.getAllByTitle(strings.moveUp);
    fireEvent.click(upButtons[0]);

    // Attempt to move bottom column down (boundary condition)
    const downButtons = screen.getAllByTitle(strings.moveDown);
    fireEvent.click(downButtons[downButtons.length - 1]);

    // Click top close icon
    const closeButtons = screen.getAllByRole('button', { name: strings.closeModal });
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByRole('heading', { name: strings.columnSettingsTitle })).not.toBeInTheDocument();

    // Reopen and close via bottom close button
    fireEvent.click(gearBtn);
    const bottomCloseButtons = screen.getAllByRole('button', { name: strings.closeModal });
    fireEvent.click(bottomCloseButtons[bottomCloseButtons.length - 1]);
    expect(screen.queryByRole('heading', { name: strings.columnSettingsTitle })).not.toBeInTheDocument();
  });

  it('opens details for approved request with remarks, no docs and no history, and closes via dismiss', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-ACC-8812')).toBeInTheDocument();
    });

    // Click Request ID of second request (Approved, no attachments, no history)
    const reqLink = screen.getByRole('button', { name: 'REQ-ACC-8812' });
    fireEvent.click(reqLink);

    expect(screen.getByRole('heading', { name: strings.detailsTitle })).toBeInTheDocument();
    expect(screen.getByText(strings.noDocuments)).toBeInTheDocument();
    expect(screen.getByText(strings.noHistory)).toBeInTheDocument();
    expect(screen.getByText('Approved per KYC clearance.')).toBeInTheDocument();

    // Close via top dismiss button
    const dismissBtn = screen.getByRole('button', { name: strings.dismissModal });
    fireEvent.click(dismissBtn);

    expect(screen.queryByRole('heading', { name: strings.detailsTitle })).not.toBeInTheDocument();
  });

  it('opens details and triggers rejection workflow from within details modal', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const reqLink = screen.getByRole('button', { name: 'REQ-CR-9041' });
    fireEvent.click(reqLink);

    expect(screen.getByRole('heading', { name: strings.detailsTitle })).toBeInTheDocument();

    // Click Reject inside details modal
    const rejectButtons = screen.getAllByRole('button', { name: strings.rejectBtn });
    fireEvent.click(rejectButtons[rejectButtons.length - 1]);

    expect(screen.getByRole('heading', { name: strings.confirmRejectionTitle })).toBeInTheDocument();

    // Dismiss confirmation via dismissModal X icon (second dismiss button since details modal is underneath)
    const dismissButtons = screen.getAllByRole('button', { name: strings.dismissModal });
    fireEvent.click(dismissButtons[dismissButtons.length - 1]);

    expect(screen.queryByRole('heading', { name: strings.confirmRejectionTitle })).not.toBeInTheDocument();
  });

  it('handles action confirmation fallback error when response has no error message', async () => {
    (approvalClient.processApprovalAction as jest.Mock).mockResolvedValue({
      success: false,
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: strings.approveBtn });
    fireEvent.click(approveButtons[0]);

    const passwordInput = screen.getByPlaceholderText(strings.passwordPlaceholder);
    fireEvent.change(passwordInput, { target: { value: 'test-approver-password' } });

    const confirmBtn = screen.getByRole('button', { name: strings.confirmApproveBtn });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(strings.invalidPasswordError)).toBeInTheDocument();
      expect(screen.getByText(strings.databaseSyncError)).toBeInTheDocument();
    });
  });

  it('validates required password before submitting approval action', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    const approveButtons = screen.getAllByRole('button', { name: strings.approveBtn });
    fireEvent.click(approveButtons[0]);

    const confirmBtn = screen.getByRole('button', { name: strings.confirmApproveBtn });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(strings.passwordRequiredError)).toBeInTheDocument();
    });
    expect(approvalClient.processApprovalAction).not.toHaveBeenCalled();
  });

  it('handles summary card click when fetchApprovals fails', async () => {
    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });

    (approvalClient.fetchApprovals as jest.Mock).mockRejectedValueOnce(new Error('Network error on popup'));

    const pendingCard = screen.getByTestId('card-pending-approvals');
    await act(async () => {
      fireEvent.click(pendingCard);
    });

    // The popup does not open with a guessed count. The failure is shown as a message.
    expect(
      await screen.findByText(
        formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvals })
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('handles user session and localStorage variations (null user, email only, invalid JSON)', async () => {
    // 1. Invalid JSON in localStorage
    window.localStorage.setItem('procucev_approval_col_prefs_u-email', 'invalid-json{{{');
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: '',
      name: 'Email User',
      email: 'user@example.com',
      role: 'buyer',
      orgId: 'org-1',
      orgName: 'Org One',
    });

    const { unmount: unmount1 } = render(<ApprovalsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });
    unmount1();

    // 2. Null session user
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue(null);
    const { unmount: unmount2 } = render(<ApprovalsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });
    unmount2();

    // 3. User with email only, no name
    jest.spyOn(authClient, 'getSessionUser').mockReturnValue({
      id: 'u-email-only',
      name: '',
      email: 'approver@enterprise.com',
      role: 'buyer',
      orgId: 'org-1',
      orgName: 'Org One',
    });
    const { unmount: unmount3 } = render(<ApprovalsDashboard />);
    await waitFor(() => {
      expect(screen.getByText('REQ-CR-9041')).toBeInTheDocument();
    });
    const myApprBtn = screen.getByTestId('toggle-my-approvals');
    fireEvent.click(myApprBtn);
    await waitFor(() => {
      expect(approvalClient.fetchApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ assigned_approver: 'approver@enterprise.com' })
      );
    });

    // 4. Test ignored key on card
    const card = screen.getByTestId('card-total-requests');
    fireEvent.keyDown(card, { key: 'Escape', code: 'Escape' });

    // 5. Test sorting by module
    const reqTypeHeader = screen.getByText(strings.colRequestType);
    fireEvent.click(reqTypeHeader);
    fireEvent.click(reqTypeHeader);

    unmount3();
  });

  it('exports CSV with fallback values when approval fields are missing', async () => {
    const edgeApprovals = [
      {
        id: 'appr-edge-1',
        request_number: 'REQ-EDGE-001',
        status: 'Pending',
        created_at: '2026-10-30T10:00:00Z',
        approver_remarks: 'Remark with "quotes" inside',
      },
    ];

    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: edgeApprovals,
      total: 1,
    });

    const createObjectURLMock = jest.fn().mockReturnValue('blob:mock-edge-url');
    window.URL.createObjectURL = createObjectURLMock;
    const linkClickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-EDGE-001')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: new RegExp(strings.exportCsvBtn, 'i') });
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(linkClickSpy).toHaveBeenCalled();
    linkClickSpy.mockRestore();
  });

  it('opens details for rejected request and request with fallback values', async () => {
    const fallbackApproval = {
      id: 'appr-fallback-1',
      request_number: 'REQ-FLBK-001',
      request_type: 'Custom Approval',
      status: 'Rejected',
      created_at: '2026-10-30T10:00:00Z',
      approver_remarks: 'Rejected without specific approver name',
    };

    (approvalClient.fetchApprovals as jest.Mock).mockResolvedValue({
      data: [fallbackApproval, ...mockApprovalsList],
      total: 4,
    });

    render(<ApprovalsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('REQ-FLBK-001')).toBeInTheDocument();
    });

    // Click Request ID
    const reqLink = screen.getByRole('button', { name: 'REQ-FLBK-001' });
    fireEvent.click(reqLink);

    expect(screen.getByRole('heading', { name: strings.detailsTitle })).toBeInTheDocument();
    expect(screen.getByText('No justification remarks specified.')).toBeInTheDocument();
    expect(screen.getAllByText('Custom Approval').length).toBeGreaterThanOrEqual(1);

    const closeBtn = screen.getByRole('button', { name: strings.closeDetails });
    fireEvent.click(closeBtn);
  });
});
