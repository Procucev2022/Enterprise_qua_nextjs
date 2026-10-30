import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InternalTasksDashboard from '@/app/category-manager/internal-tasks';
import CategoryManagerInternalTasksPage from '@/app/category-manager/internal-tasks/page';
import * as internalTaskClient from '@/lib/internalTaskClient';

jest.mock('@/lib/internalTaskClient', () => {
  const actual = jest.requireActual('@/lib/internalTaskClient');
  return {
    ...actual,
    fetchInternalTasks: jest.fn(),
    fetchTaskTypes: jest.fn(),
    createNewTaskType: jest.fn(),
    fetchTaskSummary: jest.fn(),
    fetchTaskById: jest.fn(),
    createInternalTask: jest.fn(),
    updateInternalTask: jest.fn(),
    deleteInternalTask: jest.fn(),
    searchRelatedEntities: jest.fn(),
    getExportTasksUrl: jest.fn(),
    escalateTask: jest.fn(),
    fetchApprovals: jest.fn(),
    fetchApprovalSummary: jest.fn(),
    updateApprovalStatus: jest.fn(),
    createApprovalRequest: jest.fn(),
    fetchApprovalRules: jest.fn(),
    updateApprovalRule: jest.fn(),
  };
});

const todayStr = new Date().toISOString().slice(0, 10);
const futureDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const pastDate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

const mockTasks: internalTaskClient.InternalTask[] = [
  {
    id: 'tsk_101',
    task_number: 'TASK-1001',
    title: 'Audit Mechanical Spares RFQ Quotes',
    description: 'Check technical quotes submitted by vendors',
    task_type_id: 'itt_quotation_review',
    task_type_name: 'Quotation Review',
    priority: 'High',
    status: 'Pending',
    assigned_to_name: 'Sudheer Kangala',
    due_date: todayStr,
    related_entity_type: 'RFQ',
    related_entity_id: 'rfq-1',
    related_entity_label: 'RFQ262910743626 — Engineering Spares',
    notes: 'Urgent priority check',
    created_at: '2026-10-29T10:00:00Z',
    updated_at: '2026-10-29T10:00:00Z',
  },
  {
    id: 'tsk_102',
    task_number: 'TASK-1002',
    title: 'Verify Buyer Account Documents',
    description: 'Verify GSTIN and CIN documents',
    task_type_id: 'itt_buyer_onboarding',
    task_type_name: 'Buyer Onboarding',
    priority: 'Critical',
    status: 'Completed',
    assigned_to_name: 'Priya Sharma',
    due_date: pastDate,
    related_entity_type: 'BUYER',
    related_entity_id: 'buyer-1',
    related_entity_label: 'Tata Steel Solutions Ltd',
    created_at: '2026-10-28T09:00:00Z',
    updated_at: '2026-10-28T09:00:00Z',
  },
  {
    id: 'tsk_103',
    task_number: 'TASK-1003',
    title: 'Audit Vendor Workshop Facilities',
    description: 'Site audit for solar frames',
    task_type_id: 'itt_vendor_followup',
    task_type_name: 'Vendor Follow-up',
    priority: 'Medium',
    status: 'In Progress',
    assigned_to_name: 'Rahul Varma',
    due_date: futureDate,
    related_entity_type: 'VENDOR',
    related_entity_id: 'vendor-1',
    related_entity_label: 'Unique Ceramic Solutions',
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
  },
  {
    id: 'tsk_104',
    task_number: 'TASK-1004',
    title: 'Credit Waiver Reconciliation',
    description: 'Waiver review for enterprise trial',
    task_type_id: 'itt_credit',
    task_type_name: 'Credit Review',
    priority: 'Low',
    status: 'Escalated',
    assigned_to_name: 'Finance Desk',
    due_date: pastDate,
    related_entity_type: 'CREDIT',
    related_entity_id: 'cred-1',
    related_entity_label: 'Credit Allocation #991',
    created_at: '2026-10-26T09:00:00Z',
    updated_at: '2026-10-26T09:00:00Z',
  },
  {
    id: 'tsk_105',
    task_number: 'TASK-1005',
    title: 'Taxonomy Category Migration',
    description: 'Minor category mapping',
    task_type_id: 'itt_cat',
    task_type_name: 'Category Audit',
    priority: 'Low',
    status: 'Blocked',
    assigned_to_name: 'Ops Team',
    due_date: '',
    related_entity_type: 'CATEGORY',
    related_entity_id: 'cat-1',
    related_entity_label: 'Mechanical > Pipes',
    created_at: '2026-10-25T09:00:00Z',
    updated_at: '2026-10-25T09:00:00Z',
  },
  {
    id: 'tsk_106',
    task_number: '',
    title: 'Payment Reconciliation Settlement',
    description: '',
    task_type_id: '',
    task_type_name: '',
    priority: 'Low',
    status: 'Completed',
    assigned_to_name: '',
    due_date: '',
    related_entity_type: 'GENERAL',
    related_entity_id: 'pay-1',
    related_entity_label: '',
    notes: '',
    created_at: '2026-10-24T09:00:00Z',
    updated_at: '',
  },
];

const mockTaskTypes: internalTaskClient.TaskType[] = [
  { id: 'itt_quotation_review', name: 'Quotation Review', code: 'quotation_review', default_module: 'RFQ' },
  { id: 'itt_buyer_onboarding', name: 'Buyer Onboarding', code: 'buyer_onboarding', default_module: 'BUYER' },
  { id: 'itt_vendor_followup', name: 'Vendor Follow-up', code: 'vendor_followup', default_module: 'VENDOR' },
];

const mockApprovals: internalTaskClient.ApprovalItem[] = [
  {
    id: 'app_101',
    requestId: 'REQ-2026-081',
    module: 'Credit Allocations',
    project: 'Enterprise Steel Tender 2026',
    applicant: 'Tata Steel Solutions Ltd',
    valueImpact: '+50 Credits (₹25,000 allowance)',
    makerName: 'Sudheer Kangala',
    status: 'Pending',
    notes: 'Requested for extra RFQ technical quote downloads during pilot.',
    createdAt: '2026-10-29T11:30:00Z',
  },
  {
    id: 'app_102',
    requestId: 'REQ-2026-082',
    module: 'Credit Allocations',
    project: 'Solar EPC Procurement',
    applicant: 'Apex Solar Energy Pvt Ltd',
    valueImpact: 'KYC & GSTIN Verification Verified',
    makerName: 'Priya Sharma',
    status: 'Pending',
    notes: 'Buyer registration awaiting category manager approval.',
    createdAt: '2026-10-29T10:15:00Z',
  },
  {
    id: 'app_103',
    requestId: 'REQ-2026-083',
    module: 'Credit Allocations',
    project: 'Heavy Machinery Fab',
    applicant: 'L&T Heavy Engineering',
    valueImpact: '+200 Unlimited Credits',
    makerName: 'Rahul Varma',
    status: 'Rejected',
    createdAt: '2026-10-25T08:30:00Z',
    reviewedAt: '2026-10-25T11:00:00Z',
  },
  {
    id: 'app_104',
    requestId: 'REQ-2026-084',
    module: 'Credit Allocations',
    project: 'Ceramic Tender',
    applicant: 'Unique Ceramic Solutions',
    valueImpact: '₹1,20,000 NEFT',
    makerName: 'Finance Desk Lead',
    status: 'Approved',
    createdAt: '2026-10-24T08:30:00Z',
  },
];

describe('Action Center & Internal Tasks Redesign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (internalTaskClient.fetchTaskTypes as jest.Mock).mockResolvedValue(mockTaskTypes);
    (internalTaskClient.fetchTaskSummary as jest.Mock).mockResolvedValue({
      total: 5,
      pending: 1,
      inProgress: 1,
      blocked: 1,
      completed: 1,
      escalated: 1,
      criticalCount: 1,
    });
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: 50,
    });
    (internalTaskClient.getExportTasksUrl as jest.Mock).mockReturnValue('/api/internal-tasks/export');
    (internalTaskClient.fetchApprovals as jest.Mock).mockResolvedValue(mockApprovals);
    (internalTaskClient.fetchApprovalSummary as jest.Mock).mockResolvedValue({
      pending: 1,
      approved: 1,
      rejected: 0,
      total: 2,
    });
    (internalTaskClient.updateApprovalStatus as jest.Mock).mockImplementation((id, status) => {
      const found = mockApprovals.find((a) => a.id === id);
      if (!found) return Promise.resolve(null);
      return Promise.resolve({ ...found, status, reviewedAt: '2026-10-30T10:00:00Z' });
    });
    (internalTaskClient.escalateTask as jest.Mock).mockResolvedValue({
      id: 'tsk_101',
      task_number: 'TASK-1001',
      title: 'Audit Mechanical Spares RFQ Quotes',
      priority: 'Critical',
      status: 'Escalated',
      assigned_to_name: 'Priya Sharma',
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValue({
      ...mockTasks[0],
      status: 'Completed',
    });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValue({
      id: 'tsk_new_1',
      task_number: 'TASK-9999',
      title: 'New Created Task',
      priority: 'Medium',
      status: 'Pending',
    });
    (internalTaskClient.deleteInternalTask as jest.Mock).mockResolvedValue(true);
    (internalTaskClient.searchRelatedEntities as jest.Mock).mockResolvedValue([
      { id: 'rfq-1', label: 'RFQ262910743626 — Engineering Spares', entityType: 'RFQ' },
    ]);
    (internalTaskClient.createApprovalRequest as jest.Mock).mockImplementation((payload) =>
      Promise.resolve({
        id: 'app_new_1',
        requestId: 'REQ-2026-999',
        ...payload,
        status: 'Pending',
        createdAt: '2026-10-30T10:00:00Z',
      })
    );
    (internalTaskClient.fetchApprovalRules as jest.Mock).mockResolvedValue(internalTaskClient.DEFAULT_APPROVAL_RULES);
    (internalTaskClient.updateApprovalRule as jest.Mock).mockImplementation((id, updates) =>
      Promise.resolve({
        id,
        name: 'Credit Allocation Cap',
        module: 'Credit Allocations',
        threshold: 'Credit addition > 50 credits (₹25,000)',
        requiresReview: false,
        approverRole: 'Finance Desk Lead / Admin',
        ...updates,
      })
    );
  });

  test('renders top section controls, KPI cards, and tasks list', async () => {
    render(<InternalTasksDashboard />);

    expect(screen.getByText('Internal tasks')).toBeInTheDocument();
    expect(screen.getByText('Total Tasks')).toBeInTheDocument();
    expect(screen.getByText('Pending Tasks')).toBeInTheDocument();
    expect(screen.getByText('Escalated Tasks')).toBeInTheDocument();
    expect(screen.getByText('Completed Tasks')).toBeInTheDocument();
    expect(screen.getByText('Critical / Overdue')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
      expect(screen.getByText('Verify Buyer Account Documents')).toBeInTheDocument();
    });

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Search by name, unit, customer/i);
    fireEvent.change(searchInput, { target: { value: 'Mechanical' } });

    // Test Reset button
    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);

    // Test Refresh button
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Exercise row action handlers across rendered task rows
    const viewDetailButtons = screen.getAllByTitle('View details');
    fireEvent.click(viewDetailButtons[0]);

    const detailsBackdrop = screen.getByTestId('details-drawer-backdrop');
    fireEvent.click(detailsBackdrop);

    const escalateButtons = screen.getAllByTitle('Escalate to co-exec or manager');
    fireEvent.click(escalateButtons[0]);

    // Close escalate modal if open
    const cancelModalBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelModalBtn);
  });

  test('handles scope selector: My Items, Exec wise Tasks, and All Tasks', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const scopeSelect = screen.getByDisplayValue('My Items');
    fireEvent.change(scopeSelect, { target: { value: 'exec' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue(/Sudheer Kangala/i)).toBeInTheDocument();
    });

    // Switch to All Tasks
    fireEvent.change(scopeSelect, { target: { value: 'all' } });
  });

  test('customizes columns dropdown toggle and exercises all column checkboxes', async () => {
    render(<InternalTasksDashboard />);

    const columnsBtn = screen.getByRole('button', { name: /Columns/i });
    fireEvent.click(columnsBtn);

    expect(screen.getByText('Customize Columns')).toBeInTheDocument();

    const checkboxLabels = [
      /Status & Toggle/i,
      /Task Subject & Context/i,
      /Project \/ Module/i,
      /Related Customer \/ Unit/i,
      /Task Type/i,
      /Priority/i,
      /Due Date/i,
      /Days Overdue \/ Age/i,
      /Last Edited/i,
      /Actions/i,
    ];

    for (const label of checkboxLabels) {
      const cb = screen.getByLabelText(label);
      fireEvent.click(cb);
      fireEvent.click(cb); // toggle back
    }

    fireEvent.click(columnsBtn);
  });

  test('exercises all inline filter dropdowns and date inputs on toolbar', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    // Status select
    fireEvent.change(selects[1], { target: { value: 'In Progress' } });
    // Priority select
    fireEvent.change(selects[2], { target: { value: 'High' } });
    // Related entity select
    fireEvent.change(selects[3], { target: { value: 'RFQ' } });

    // Due date inline inputs
    const dateInputs = screen.getAllByDisplayValue('');
    const dueFrom = dateInputs.find((input) => (input as HTMLInputElement).type === 'date');
    if (dueFrom) {
      fireEvent.change(dueFrom, { target: { value: '2026-10-01' } });
    }
  });

  test('exercises filter drawer fields in detail', async () => {
    render(<InternalTasksDashboard />);

    const filterBtn = screen.getByRole('button', { name: /Filters/i });
    fireEvent.click(filterBtn);

    expect(screen.getByText('Filter Tasks')).toBeInTheDocument();

    const statusSelects = screen.getAllByDisplayValue('All Statuses');
    fireEvent.change(statusSelects[statusSelects.length - 1], { target: { value: 'Completed' } });

    const prioritySelects = screen.getAllByDisplayValue('All Priorities');
    fireEvent.change(prioritySelects[prioritySelects.length - 1], { target: { value: 'Low' } });

    const moduleSelects = screen.getAllByDisplayValue(/All Modules/i);
    fireEvent.change(moduleSelects[moduleSelects.length - 1], { target: { value: 'BUYER' } });

    const assignedInput = screen.getByPlaceholderText(/Search by executive name/i);
    fireEvent.change(assignedInput, { target: { value: 'Priya' } });

    const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
    fireEvent.click(applyBtn);

    // Reopen and test backdrop click
    fireEvent.click(filterBtn);
    const backdrop = screen.getByTestId('filter-drawer-backdrop');
    fireEvent.click(backdrop);
  });

  test('exercises full Create Task modal with all fields and custom inline type', async () => {
    render(<InternalTasksDashboard />);

    const createBtn = screen.getByRole('button', { name: /\+ Create Internal Task/i });
    fireEvent.click(createBtn);

    expect(screen.getByText('Create Internal Task')).toBeInTheDocument();

    // Fill all form inputs
    const titleInput = screen.getByPlaceholderText(/e\.g\. Audit Mechanical Spares RFQ Quotes/i);
    fireEvent.change(titleInput, { target: { value: 'Full Modal Task' } });

    const descInput = screen.getByPlaceholderText(/Provide operational context/i);
    fireEvent.change(descInput, { target: { value: 'Detailed operational context for review' } });

    const assignedInput = screen.getByPlaceholderText(/e\.g\. Sudheer Kangala/i);
    fireEvent.change(assignedInput, { target: { value: 'Sudheer Kangala' } });

    const notesInput = screen.getByPlaceholderText(/Private notes for team executives/i);
    fireEvent.change(notesInput, { target: { value: 'Confidential executive notes' } });

    const prioritySelect = screen.getByDisplayValue('Medium');
    fireEvent.change(prioritySelect, { target: { value: 'Critical' } });

    const submitBtn = screen.getByRole('button', { name: /Create Task/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Full Modal Task',
          description: 'Detailed operational context for review',
          priority: 'Critical',
          assignedToName: 'Sudheer Kangala',
          notes: 'Confidential executive notes',
        })
      );
    });
  });

  test('handles task creation error and validation', async () => {
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce(null);

    render(<InternalTasksDashboard />);

    const createBtn = screen.getByRole('button', { name: /\+ Create Internal Task/i });
    fireEvent.click(createBtn);

    const titleInput = screen.getByPlaceholderText(/e\.g\. Audit Mechanical Spares RFQ Quotes/i);
    fireEvent.change(titleInput, { target: { value: 'Task That Fails' } });

    const submitBtn = screen.getByRole('button', { name: /Create Task/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to create task in database.')).toBeInTheDocument();
    });

    // Exception handling
    (internalTaskClient.createInternalTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Error saving task.')).toBeInTheDocument();
    });
  });

  test('handles escalation modal fields, cancel, backdrop, and error', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('escalate-task-tsk_101')).toBeInTheDocument();
    });

    const escalateBtn = screen.getByTestId('escalate-task-tsk_101');
    fireEvent.click(escalateBtn);

    expect(screen.getByText(/Escalate Task to Co-exec \/ Manager/i)).toBeInTheDocument();

    // Change fields
    const selects = screen.getAllByRole('combobox');
    const reasonSelect = screen.getByDisplayValue('SLA Breach / At Risk');
    fireEvent.change(reasonSelect, { target: { value: 'High Value Approval Needed' } });

    const notesTextarea = screen.getByPlaceholderText(/Provide specific context or reason requiring manager/i);
    fireEvent.change(notesTextarea, { target: { value: 'Urgent waiver required' } });

    // Cancel modal
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    // Reopen and test backdrop click
    fireEvent.click(escalateBtn);
    const backdrop = screen.getByTestId('escalate-modal-backdrop');
    fireEvent.click(backdrop);

    // Reopen and test failure branch
    fireEvent.click(escalateBtn);
    (internalTaskClient.escalateTask as jest.Mock).mockResolvedValueOnce(null);
    const confirmBtn = screen.getByTestId('confirm-escalation-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to escalate task.')).toBeInTheDocument();
    });

    // Test rejection branch
    fireEvent.click(escalateBtn);
    (internalTaskClient.escalateTask as jest.Mock).mockRejectedValueOnce(new Error('Network Boom'));
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Error during task escalation.')).toBeInTheDocument();
    });
  });

  test('handles Approvals filters, export toast, and failure state', async () => {
    render(<InternalTasksDashboard />);

    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    // Test export button toast
    const exportBtn = screen.getByRole('button', { name: /Export/i });
    fireEvent.click(exportBtn);
    expect(screen.getByText('Exporting approvals audit log...')).toBeInTheDocument();

    // Test refresh button
    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    // Test Project select
    const projectSelect = screen.getByDisplayValue('All Projects');
    fireEvent.change(projectSelect, { target: { value: 'Steel' } });

    // Test Status select
    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'Pending' } });

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Search by request ID, customer, requester/i);
    fireEvent.change(searchInput, { target: { value: 'Tata' } });

    const searchBtn = screen.getByRole('button', { name: /Search/i });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('REQ-2026-081')).toBeInTheDocument();
    });

    // Test failure branch in updateApprovalStatus
    (internalTaskClient.updateApprovalStatus as jest.Mock).mockResolvedValueOnce(null);
    const approveBtn = screen.getAllByRole('button', { name: /^Approve$/i })[0];
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByText(/Failed to update REQ-2026-081/i)).toBeInTheDocument();
    });
  });

  test('handles empty approvals state', async () => {
    (internalTaskClient.fetchApprovals as jest.Mock).mockResolvedValueOnce([]);

    render(<InternalTasksDashboard />);

    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    await waitFor(() => {
      expect(screen.getByText('No approval requests match the selected filters.')).toBeInTheDocument();
    });
  });

  test('handles deletion cancel and failure', async () => {
    window.confirm = jest.fn().mockReturnValue(false);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByTitle('Delete task');
    fireEvent.click(deleteBtns[0]);
    expect(internalTaskClient.deleteInternalTask).not.toHaveBeenCalled();

    // When API returns false
    window.confirm = jest.fn().mockReturnValue(true);
    (internalTaskClient.deleteInternalTask as jest.Mock).mockResolvedValueOnce(false);
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to delete task.')).toBeInTheDocument();
    });
  });

  test('handles proper empty state when no tasks exist', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('No internal tasks found matching current filters.')).toBeInTheDocument();
    });
  });

  test('handles error state with retry button', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockRejectedValue(new Error('DB Failed'));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load internal tasks from database.')).toBeInTheDocument();
    });

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: 50,
    });

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
  });

  test('handles pagination: Next and Previous page clicks', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 - 20 of 50 tasks/i)).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 2')).toBeInTheDocument();
    });

    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeInTheDocument();
    });
  });

  test('opens right-side filter drawer, configures all filters, applies and resets them', async () => {
    render(<InternalTasksDashboard />);

    const filterBtn = screen.getByRole('button', { name: /Filters/i });
    fireEvent.click(filterBtn);

    expect(screen.getByText('Filter Tasks')).toBeInTheDocument();

    const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
    fireEvent.click(applyBtn);

    // Open again to reset
    fireEvent.click(filterBtn);
    const resetDrawerBtn = screen.getByRole('button', { name: /Reset All/i });
    fireEvent.click(resetDrawerBtn);
  });

  test('quick toggles task status via checkbox', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_101',
        expect.objectContaining({ status: 'Completed' })
      );
    });
  });

  test('opens Create Task modal, fills fields, and submits', async () => {
    render(<InternalTasksDashboard />);

    const createBtn = screen.getByRole('button', { name: /\+ Create Internal Task/i });
    fireEvent.click(createBtn);

    expect(screen.getByText('Create Internal Task')).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(/e\.g\. Audit Mechanical Spares RFQ Quotes/i);
    fireEvent.change(titleInput, { target: { value: 'New Test Internal Task' } });

    const submitBtn = screen.getByRole('button', { name: /Create Task/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Test Internal Task' })
      );
    });
  });

  test('handles task escalation modal from table row', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('escalate-task-tsk_101')).toBeInTheDocument();
    });

    const escalateBtn = screen.getByTestId('escalate-task-tsk_101');
    fireEvent.click(escalateBtn);

    expect(screen.getByText(/Escalate Task to Co-exec \/ Manager/i)).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('confirm-escalation-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(internalTaskClient.escalateTask).toHaveBeenCalledWith(
        'tsk_101',
        expect.objectContaining({ escalateTo: 'Sudheer Kangala' })
      );
    });
  });

  test('opens task details drawer, tests escalate button inside drawer, and deletes task', async () => {
    window.confirm = jest.fn().mockReturnValue(true);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Click on title to open details drawer
    fireEvent.click(screen.getByText('Audit Mechanical Spares RFQ Quotes'));

    expect(screen.getAllByText('TASK-1001').length).toBeGreaterThanOrEqual(1);

    // Click escalate inside drawer
    const drawerEscalateBtn = screen.getByTestId('drawer-escalate-btn');
    fireEvent.click(drawerEscalateBtn);

    expect(screen.getAllByText(/Escalate Task to Co-exec \/ Manager/i).length).toBeGreaterThanOrEqual(1);
    const cancelModalBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelModalBtn);

    // Reopen drawer if needed to delete
    const deleteBtn = screen.getByTestId('drawer-delete-task-btn');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(internalTaskClient.deleteInternalTask).toHaveBeenCalledWith('tsk_101');
    });
  });

  test('switches to Approvals tab, interacts with pills, and approves/rejects an item', async () => {
    render(<InternalTasksDashboard />);

    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    expect(screen.getByText('Management Approvals Center')).toBeInTheDocument();
    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    expect(screen.getByText('Awaiting managerial decision')).toBeInTheDocument();

    // Test sub-module pills
    const creditPill = screen.getByRole('button', { name: /Credit Allocations/i });
    fireEvent.click(creditPill);

    await waitFor(() => {
      expect(screen.getByText('REQ-2026-081')).toBeInTheDocument();
    });

    // Test Approve button for first item
    const approveButtons = screen.getAllByRole('button', { name: /^Approve$/i });
    fireEvent.click(approveButtons[0]);

    await waitFor(() => {
      expect(internalTaskClient.updateApprovalStatus).toHaveBeenCalledWith(
        'app_101',
        'Approved',
        'Category Manager Admin'
      );
    });

    // Test Reject button for second pending item
    const rejectButtons = screen.getAllByRole('button', { name: /^Reject$/i });
    fireEvent.click(rejectButtons[0]);

    await waitFor(() => {
      expect(internalTaskClient.updateApprovalStatus).toHaveBeenCalledWith(
        'app_102',
        'Rejected',
        'Category Manager Admin'
      );
    });

    // Test Configure Rules modal
    const configRulesBtn = screen.getByRole('button', { name: /Configure Rules/i });
    fireEvent.click(configRulesBtn);

    expect(screen.getByText(/Approval Rules & Authorization Thresholds/i)).toBeInTheDocument();
    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
  });

  test('switches to Scorecard tab and verifies performance metrics and executive cards', async () => {
    render(<InternalTasksDashboard />);

    const scorecardTab = screen.getByRole('button', { name: /Scorecard/i });
    fireEvent.click(scorecardTab);

    expect(screen.getByText('Individual & Team Performance Scorecards')).toBeInTheDocument();
    expect(screen.getByText('Total Resolved Tasks')).toBeInTheDocument();
    expect(screen.getByText('Team SLA Adherence')).toBeInTheDocument();
    expect(screen.getByText('Sudheer Kangala')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
  });

  test('switches to Tickets tab and verifies Future Phase roadmap', async () => {
    render(<InternalTasksDashboard />);

    const ticketsTab = screen.getByRole('button', { name: /Tickets/i });
    fireEvent.click(ticketsTab);

    expect(screen.getByText('Client Tickets & Complaints Hub')).toBeInTheDocument();
    expect(screen.getByText(/Future Phase — Roadmap/i)).toBeInTheDocument();
    expect(screen.getByText('Client Error Ingestion')).toBeInTheDocument();
    expect(screen.getByText('Buyer Complaints Escalation')).toBeInTheDocument();
  });

  test('exercises quick toggle on Completed task and toggle failure', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Verify Buyer Account Documents')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // The second task is Completed
    fireEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_102',
        expect.objectContaining({ status: 'Pending' })
      );
    });

    // When updateInternalTask returns null
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(checkboxes[0]);
  });

  test('exercises drawer and modal close buttons, executive change, and date inputs', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Open task drawer
    const taskTitle = screen.getByText('Audit Mechanical Spares RFQ Quotes');
    fireEvent.click(taskTitle);
    expect(screen.getByText('Linked Entity')).toBeInTheDocument();

    // Close using X button
    const closeButtons = screen.getAllByRole('button');
    const xButton = closeButtons.find((b) => b.querySelector('svg.lucide-x'));
    if (xButton) fireEvent.click(xButton);

    // Reopen task drawer and close using bottom Close button
    fireEvent.click(screen.getByText('Audit Mechanical Spares RFQ Quotes'));
    const bottomCloseBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(bottomCloseBtn);

    // Open other tasks to exercise module badges (BUYER, VENDOR, CREDIT, CATEGORY)
    fireEvent.click(screen.getByText('Verify Buyer Account Documents'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByText('Audit Vendor Workshop Facilities'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByText('Credit Waiver Reconciliation'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Scope select to exec and change executive
    const scopeSelect = screen.getByDisplayValue('My Items');
    fireEvent.change(scopeSelect, { target: { value: 'exec' } });

    const execSelect = screen.getByDisplayValue(/Sudheer Kangala/i);
    fireEvent.change(execSelect, { target: { value: 'Priya Sharma' } });

    // Open Create modal, change task type, due date, status, notes
    const createBtn = screen.getByRole('button', { name: /\+ Create Internal Task/i });
    fireEvent.click(createBtn);

    const typeSelect = screen.getByDisplayValue('Quotation Review');
    fireEvent.change(typeSelect, { target: { value: 'itt_buyer_onboarding' } });

    const dateInputs = screen.getAllByDisplayValue('');
    const dueInput = dateInputs.find((i) => (i as HTMLInputElement).type === 'date');
    if (dueInput) {
      fireEvent.change(dueInput, { target: { value: '2026-11-15' } });
    }

    const cancelModalBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelModalBtn);

    // Approvals tab: test all module pills, date inputs and modal X button
    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    const modulePills = [
      'All Modules',
      'Credit Allocations',
      'Account Approvals',
      'Discounts & Waivers',
      'Trial Period Extensions',
      'Payment Reconciliations',
    ];
    for (const mod of modulePills) {
      fireEvent.click(screen.getByRole('button', { name: mod }));
    }

    const appDateInputs = screen.getAllByDisplayValue('');
    const appDates = appDateInputs.filter((i) => (i as HTMLInputElement).type === 'date');
    if (appDates.length >= 2) {
      fireEvent.change(appDates[0], { target: { value: '2026-10-01' } });
      fireEvent.change(appDates[1], { target: { value: '2026-10-31' } });
    }

    // Configure Rules X button
    const configRulesBtn = screen.getByRole('button', { name: /Configure Rules/i });
    fireEvent.click(configRulesBtn);

    const rulesXBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (rulesXBtn) fireEvent.click(rulesXBtn);

    // Switch back to tasks tab
    fireEvent.click(screen.getByRole('button', { name: /Internal tasks/i }));
  });

  test('exercises empty title validation, task without notes in drawer, and custom escalation', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Payment Reconciliation Settlement')).toBeInTheDocument();
    });

    // Open task without notes or description in drawer
    fireEvent.click(screen.getByText('Payment Reconciliation Settlement'));
    expect(screen.getByText('No description provided.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Open Create modal and submit empty title
    const createBtn = screen.getByRole('button', { name: /\+ Create Internal Task/i });
    fireEvent.click(createBtn);

    const titleInput = screen.getByPlaceholderText(/e\.g\. Audit Mechanical Spares RFQ Quotes/i);
    fireEvent.change(titleInput, { target: { value: '   ' } });

    const submitBtn = screen.getByRole('button', { name: /Create Task/i });
    fireEvent.click(submitBtn);

    expect(internalTaskClient.createInternalTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: '' })
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    // Test escalation with Operations Manager
    const escalateBtns = screen.getAllByTitle('Escalate to co-exec or manager');
    fireEvent.click(escalateBtns[0]);

    const targetSelect = screen.getByDisplayValue(/Sudheer Kangala/i);
    fireEvent.change(targetSelect, { target: { value: 'Operations Manager' } });

    const confirmBtn = screen.getByTestId('confirm-escalation-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(internalTaskClient.escalateTask).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ escalateTo: 'Operations Manager' })
      );
    });
  });

  test('exercises toolbar dueTo input, empty state create button, modal backdrops, and close buttons', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // 1. Toolbar inline dueTo input
    const dueToInputs = screen.getAllByPlaceholderText('Due To');
    fireEvent.change(dueToInputs[0], { target: { value: '2026-11-15' } });
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // 2. Open create modal, test backdrop and close button
    const openCreateBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(openCreateBtn);
    expect(screen.getByTestId('create-modal-backdrop')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-modal-backdrop'));

    fireEvent.click(openCreateBtn);
    const createCloseBtn = screen.getByTestId('create-modal-close-btn');
    fireEvent.click(createCloseBtn);

    // 3. Open Escalate modal, test close button
    const escalateBtn = screen.getAllByTitle('Escalate to co-exec or manager')[0];
    fireEvent.click(escalateBtn);
    const escalateCloseBtn = screen.getByTestId('escalate-modal-close-btn');
    fireEvent.click(escalateCloseBtn);

    // 4. Open details drawer, test close button and backdrop
    const viewDetailBtn = screen.getAllByTitle('View details')[0];
    fireEvent.click(viewDetailBtn);
    const detailsCloseBtn = screen.getByTestId('details-drawer-close-btn');
    fireEvent.click(detailsCloseBtn);

    // 5. Escalate from inside details drawer (exercising setSelectedTaskDetails(updated))
    fireEvent.click(viewDetailBtn);
    const drawerEscalateBtn = screen.getByTestId('drawer-escalate-btn');
    fireEvent.click(drawerEscalateBtn);
    const confirmBtn = screen.getByTestId('confirm-escalation-btn');
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(internalTaskClient.escalateTask).toHaveBeenCalled();
    });

    // 6. Approvals tab: Configure rules modal backdrop and close button
    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);
    const rulesBtn = screen.getByRole('button', { name: /Configure Rules/i });
    fireEvent.click(rulesBtn);
    const rulesBackdrop = screen.getByTestId('rules-modal-backdrop');
    fireEvent.click(rulesBackdrop);

    fireEvent.click(rulesBtn);
    const rulesCloseBtn = screen.getByTestId('rules-modal-close-btn');
    fireEvent.click(rulesCloseBtn);

    // 7. Filter drawer: close button and dueTo date input
    const internalTasksTab = screen.getByRole('button', { name: /Internal tasks/i });
    fireEvent.click(internalTasksTab);

    const filterDrawerBtn = screen.getByRole('button', { name: /Filters/i });
    fireEvent.click(filterDrawerBtn);

    const drawerDueToInput = screen.getAllByPlaceholderText('Due To')[0];
    if (drawerDueToInput) {
      fireEvent.change(drawerDueToInput, { target: { value: '2026-12-01' } });
    }
    const filterCloseBtn = screen.getByTestId('filter-drawer-close-btn');
    fireEvent.click(filterCloseBtn);
  });

  test('renders empty state and allows clicking Create Internal Task', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValueOnce({
      tasks: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('No internal tasks found matching current filters.')).toBeInTheDocument();
    });

    const createEmptyBtns = screen.getAllByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createEmptyBtns[createEmptyBtns.length - 1]);
    expect(screen.getByText('Task Title *')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
  });

  test('exercises fully working Approvals: KPI filters, request modal, details drawer, and rule toggles', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const approvalsTab = screen.getByRole('button', { name: /Approvals/i });
    fireEvent.click(approvalsTab);

    // 0. Export Approvals to CSV
    const exportApprovalsBtn = screen.getByRole('button', { name: /^Export$/i });
    fireEvent.click(exportApprovalsBtn);

    // 1. Clickable KPI cards and toggling
    fireEvent.click(screen.getByTestId('approvals-kpi-pending'));
    fireEvent.click(screen.getByTestId('approvals-kpi-pending')); // toggles back to 'all'
    fireEvent.click(screen.getByTestId('approvals-kpi-approved'));
    fireEvent.click(screen.getByTestId('approvals-kpi-rejected'));
    fireEvent.click(screen.getByTestId('approvals-kpi-total'));

    // 2. Request Approval Modal
    const requestApprovalBtn = screen.getByRole('button', { name: /\+ Request Approval/i });
    fireEvent.click(requestApprovalBtn);
    const modalEl = screen.getByTestId('request-approval-modal');
    expect(modalEl).toBeInTheDocument();

    const requestBackdrop = screen.getByTestId('request-approval-backdrop');
    fireEvent.click(requestBackdrop);

    fireEvent.click(requestApprovalBtn);
    const requestCloseBtn = screen.getByTestId('request-approval-close-btn');
    fireEvent.click(requestCloseBtn);

    // Test form field changes and validations
    fireEvent.click(requestApprovalBtn);
    const modalEl2 = screen.getByTestId('request-approval-modal');
    const formEl = modalEl2.querySelector('form')!;

    // Validation branch 1: both empty
    fireEvent.submit(formEl);
    expect(screen.getByText('Applicant and Value / Impact are required.')).toBeInTheDocument();

    // Validation branch 2: applicant filled, value empty
    const applicantInputEmpty = within(modalEl2).getByPlaceholderText(/e\.g\. Apex Solar Energy Ltd/i);
    fireEvent.change(applicantInputEmpty, { target: { value: 'Applicant Only' } });
    fireEvent.submit(formEl);
    expect(screen.getByText('Applicant and Value / Impact are required.')).toBeInTheDocument();

    const moduleSelect = within(modalEl2).getByRole('combobox');
    fireEvent.change(moduleSelect, { target: { value: 'Discounts & Waivers' } });

    const projectInput = within(modalEl2).getByDisplayValue('Enterprise Steel Tender 2026');
    fireEvent.change(projectInput, { target: { value: 'Solar EPC Phase 2' } });

    const makerInput = within(modalEl2).getByDisplayValue('Sudheer Kangala');
    fireEvent.change(makerInput, { target: { value: 'Marketing Executive' } });

    const notesInput = within(modalEl2).getByPlaceholderText(/Provide commercial rationale/i);
    fireEvent.change(notesInput, { target: { value: 'Special promo discount' } });

    // Cancel button in modal
    const cancelModalBtn = within(modalEl2).getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelModalBtn);

    // Reopen and test valid submission
    fireEvent.click(requestApprovalBtn);
    const applicantInput = screen.getByPlaceholderText(/e\.g\. Apex Solar Energy Ltd/i);
    const valueInput = screen.getByPlaceholderText(/e\.g\. \+75 Credits/i);

    fireEvent.change(applicantInput, { target: { value: 'Inox Wind Solutions' } });
    fireEvent.change(valueInput, { target: { value: '₹50,000 NEFT waiver' } });

    fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => {
      expect(internalTaskClient.createApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          applicant: 'Inox Wind Solutions',
          valueImpact: '₹50,000 NEFT waiver',
        })
      );
    });

    // Test rejection in catch block for request submission
    (internalTaskClient.createApprovalRequest as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(requestApprovalBtn);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Apex Solar Energy Ltd/i), { target: { value: 'Fail Corp' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \+75 Credits/i), { target: { value: '₹10,000' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => {
      expect(screen.getByText('Error submitting approval request.')).toBeInTheDocument();
    });

    // 3. Approval Details Drawer & Row clicks
    // Click table row directly
    fireEvent.click(screen.getByText('REQ-2026-081'));
    const detailsDrawer = screen.getByTestId('approval-details-drawer');
    expect(detailsDrawer).toBeInTheDocument();

    // Close via bottom Close button
    const drawerBottomCloseBtn = within(detailsDrawer).getByRole('button', { name: /^Close$/i });
    fireEvent.click(drawerBottomCloseBtn);

    // Reopen and test Reject from drawer
    fireEvent.click(screen.getByText('REQ-2026-081'));
    const drawerRejectBtn = screen.getByTestId('drawer-reject-btn');
    fireEvent.click(drawerRejectBtn);

    // Click on reviewed item without reviewedAt date
    fireEvent.click(screen.getByText('Unique Ceramic Solutions'));
    const drawerReviewed = screen.getByTestId('approval-details-drawer');
    expect(within(drawerReviewed).getByText(/Decision logged on/i)).toBeInTheDocument();
    fireEvent.click(within(drawerReviewed).getByRole('button', { name: /^Close$/i }));

    // Reopen and test Approve from drawer
    const viewDetailsButtons = screen.getAllByTitle('View details');
    if (viewDetailsButtons.length > 0) {
      fireEvent.click(viewDetailsButtons[0]);
      const drawerCloseBtn = screen.getByTestId('approval-details-close-btn');
      fireEvent.click(drawerCloseBtn);

      fireEvent.click(viewDetailsButtons[0]);
      const drawerBackdrop = screen.getByTestId('approval-drawer-backdrop');
      fireEvent.click(drawerBackdrop);

      fireEvent.click(viewDetailsButtons[0]);
      const drawerApproveBtn = screen.queryByTestId('drawer-approve-btn');
      if (drawerApproveBtn) {
        fireEvent.click(drawerApproveBtn);
      }
    }

    // 4. Configure Rules toggle
    const rulesBtn = screen.getByRole('button', { name: /Configure Rules/i });
    fireEvent.click(rulesBtn);
    const enforceButtons = screen.getAllByText(/Enforce Review|Auto-Approve/i);
    if (enforceButtons.length > 0) {
      fireEvent.click(enforceButtons[0]);
      expect(internalTaskClient.updateApprovalRule).toHaveBeenCalled();

      // Test null update return
      (internalTaskClient.updateApprovalRule as jest.Mock).mockResolvedValueOnce(null);
      fireEvent.click(enforceButtons[0]);
    }
    const rulesClose = screen.getByTestId('rules-modal-close-btn');
    fireEvent.click(rulesClose);
  });

  test('exercises fully working Scorecard: period filters, department filters, and executive profile drawer navigation', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const scorecardTab = screen.getByRole('button', { name: /Scorecard/i });
    fireEvent.click(scorecardTab);

    // Period filters
    const todayPeriod = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(todayPeriod);
    const weekPeriod = screen.getByRole('button', { name: 'This Week' });
    fireEvent.click(weekPeriod);
    const monthPeriod = screen.getByRole('button', { name: 'This Month' });
    fireEvent.click(monthPeriod);
    const allPeriod = screen.getByRole('button', { name: 'All Time' });
    fireEvent.click(allPeriod);

    // Department filters
    const catDept = screen.getByRole('button', { name: 'Category Management' });
    fireEvent.click(catDept);
    const growthDept = screen.getByRole('button', { name: 'Growth / Marketing' });
    fireEvent.click(growthDept);
    const opsDept = screen.getByRole('button', { name: 'Operations' });
    fireEvent.click(opsDept);
    const financeDept = screen.getByRole('button', { name: 'Finance' });
    fireEvent.click(financeDept);
    const allRoles = screen.getByRole('button', { name: 'All Roles' });
    fireEvent.click(allRoles);

    // Executive Card click -> Profile Drawer
    const execCards = screen.getAllByText(/Sudheer Kangala/i);
    fireEvent.click(execCards[0]);

    const execDrawer = screen.getByTestId('exec-profile-drawer');
    expect(execDrawer).toBeInTheDocument();
    const execCloseBtn = screen.getByTestId('exec-drawer-close-btn');
    fireEvent.click(execCloseBtn);

    // Reopen and test bottom Close button
    fireEvent.click(execCards[0]);
    const execDrawer2 = screen.getByTestId('exec-profile-drawer');
    const execBottomCloseBtn = within(execDrawer2).getByRole('button', { name: /^Close$/i });
    fireEvent.click(execBottomCloseBtn);

    // Reopen and test backdrop
    fireEvent.click(execCards[0]);
    const execBackdrop = screen.getByTestId('exec-drawer-backdrop');
    fireEvent.click(execBackdrop);

    // Reopen and test Action Center shortcut
    fireEvent.click(execCards[0]);
    const viewExecTasksBtn = screen.getByTestId('view-exec-tasks-btn');
    fireEvent.click(viewExecTasksBtn);

    // Verifies navigation back to Internal Tasks with exec scope active
    await waitFor(() => {
      expect(screen.getByDisplayValue(/Exec wise Tasks/i)).toBeInTheDocument();
    });
  });

  test('renders page wrapper CategoryManagerInternalTasksPage', () => {
    render(<CategoryManagerInternalTasksPage />);
    expect(screen.getByText('Internal tasks')).toBeInTheDocument();
  });
});
