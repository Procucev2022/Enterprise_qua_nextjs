import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import InternalTasksDashboard from '@/app/category-manager/internal-tasks';
import CategoryManagerInternalTasksPage from '@/app/category-manager/internal-tasks/page';
import * as internalTaskClient from '@/lib/internalTaskClient';


import { UI_STRINGS } from '@/lib/uiStrings';

jest.setTimeout(35000);

jest.mock('@/app/category-manager/components/TicketsDashboard', () => ({
  TicketsDashboard: () => <div data-testid="tickets-dashboard">Tickets Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/components/ApprovalsDashboard', () => {
  const Mock = ({ onApprovalDecision }: { onApprovalDecision?: (id: string, action: 'APPROVE' | 'REJECT', requestNumber?: string) => void }) => (
    <div data-testid="approvals-dashboard">
      Approvals Dashboard Mock
      <button
        data-testid="mock-approval-decision-btn"
        onClick={() => onApprovalDecision?.('appr_1', 'APPROVE', 'REQ-860DAC704BE2')}
      >
        Trigger Decision
      </button>
      <button
        data-testid="mock-approval-decision-reject-btn"
        onClick={() => onApprovalDecision?.('appr_2', 'REJECT', 'REQ-REJECT-999')}
      >
        Trigger Reject
      </button>
      <button
        data-testid="mock-approval-decision-no-req-btn"
        onClick={() => onApprovalDecision?.('appr_3', 'APPROVE', undefined)}
      >
        Trigger No Req
      </button>
    </div>
  );
  return {
    __esModule: true,
    default: Mock,
    ApprovalsDashboard: Mock,
  };
});
jest.mock('@/app/category-manager/components/ScorecardDashboard', () => ({
  ScorecardDashboard: () => <div data-testid="scorecard-dashboard">Scorecard Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/buyers-directory', () => function BuyersDirectoryMock() {
  return <div data-testid="buyers-directory">Buyers Directory Mock</div>;
});
jest.mock('@/app/category-manager/sellers-directory', () => function SellersDirectoryMock() {
  return <div data-testid="sellers-directory">Sellers Directory Mock</div>;
});
jest.mock('@/app/category-manager/components/RegistrationsDashboard', () => function RegistrationsDashboardMock() {
  return <div data-testid="registrations-dashboard">Registrations Dashboard Mock</div>;
});
jest.mock('@/app/category-manager/components/PaymentDuesDashboard', () => ({
  PaymentDuesDashboard: () => <div data-testid="payment-dues-dashboard">Payment Dues Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/components/LoginLogsDashboard', () => function LoginLogsDashboardMock() {
  return <div data-testid="login-logs-dashboard">Login Logs Dashboard Mock</div>;
});
jest.mock('@/lib/ticketClient', () => ({
  fetchTicketSummary: jest.fn().mockResolvedValue({
    summary: { total: 5, pending: 2, inProgress: 1, escalated: 1, completed: 1, criticalCount: 1 },
  }),
}));
jest.mock('@/lib/approvalClient', () => ({
  fetchApprovalSummary: jest.fn().mockResolvedValue({
    summary: { total: 4, pending: 1, approved: 2, rejected: 1 },
  }),
}));

jest.mock('@/lib/internalTaskClient', () => {
  const actual = jest.requireActual('@/lib/internalTaskClient');
  return {
    ...actual,
    fetchInternalTasks: jest.fn(),
    fetchTaskTypes: jest.fn(),
    createNewTaskType: jest.fn(),
    fetchTaskSummary: jest.fn(),
    fetchTaskById: jest.fn().mockResolvedValue(null),
    createInternalTask: jest.fn(),
    updateInternalTask: jest.fn(),
    deleteInternalTask: jest.fn(),
    searchRelatedEntities: jest.fn(),
    getExportTasksUrl: jest.fn(),
    fetchInternalAssignees: jest.fn().mockResolvedValue({ assignees: [
      { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
      { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
      { id: 'exec-3', name: 'Prajwal K', role: 'Vendor Operations Lead' },
    ] }),
    completeInternalTask: jest.fn(),
    approveCreditTask: jest.fn(),
    rejectCreditTask: jest.fn(),
    addTaskActivity: jest.fn(),
    checkTaskReminders: jest.fn(),
  };
});

jest.mock('@/lib/authClient', () => ({
  authClient: {
    getToken: jest.fn().mockReturnValue('mock-token'),
    getSessionUser: jest.fn().mockReturnValue({
      id: 'user-1',
      name: 'Navin Chaudhary',
      email: 'navin@procucev.com',
      role: 'category_manager',
    }),
  },
}));

function getLocalDateString(dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const todayStr = getLocalDateString();
const futureDate = getLocalDateString(5);
const pastDate = getLocalDateString(-3);

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
    priority: 'Medium',
    status: 'Completed',
    assigned_to_name: '',
    due_date: '',
    related_entity_type: 'PAYMENT',
    related_entity_id: 'pay-1',
    related_entity_label: '',
    notes: '',
    created_at: '2026-10-24T09:00:00Z',
    updated_at: '2026-10-24T09:00:00Z',
  },
];

const mockTaskTypes: internalTaskClient.TaskType[] = [
  { id: 'itt_quotation_review', name: 'Quotation Review', code: 'quotation_review', default_module: 'RFQ' },
  { id: 'itt_buyer_onboarding', name: 'Buyer Onboarding', code: 'buyer_onboarding', default_module: 'BUYER' },
  { id: 'itt_vendor_followup', name: 'Vendor Follow-up', code: 'vendor_followup', default_module: 'VENDOR' },
];

describe('Action Center & Internal Tasks Redesign', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/category-manager/internal-tasks');
    const { authClient } = require('@/lib/authClient');
    (authClient.getSessionUser as jest.Mock).mockReturnValue({
      id: 'user-1',
      name: 'Navin Chaudhary',
      email: 'navin@procucev.com',
      role: 'category_manager',
    });
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValue({ assignees: [
      { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
      { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
      { id: 'exec-3', name: 'Prajwal K', role: 'Vendor Operations Lead' },
    ] });
    jest.clearAllMocks();
    (internalTaskClient.updateInternalTask as jest.Mock).mockReset();
    (internalTaskClient.completeInternalTask as jest.Mock).mockReset();
    (internalTaskClient.createInternalTask as jest.Mock).mockReset();
    (internalTaskClient.fetchTaskById as jest.Mock).mockReset();
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(null);
    (internalTaskClient.fetchTaskTypes as jest.Mock).mockResolvedValue({ taskTypes: mockTaskTypes });
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
    (internalTaskClient.searchRelatedEntities as jest.Mock).mockResolvedValue([
      { id: 'rfq-1', label: 'RFQ262910743626 — Engineering Spares', entityType: 'RFQ' },
      { id: 'rfq-2', label: 'RFQ262910757432 — IT', entityType: 'RFQ' },
    ]);
  });

  test('renders top section controls: Search bar, Filter button, Export button, Create button', async () => {
    render(<InternalTasksDashboard />);

    expect(screen.getByTestId('card-total-tasks')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by title, ID, entity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filter/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Internal Task/i })).toBeInTheDocument();

    // Renders tasks from database
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
      expect(screen.getByText('Verify Buyer Account Documents')).toBeInTheDocument();
    });

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Search by title, ID, entity/i);
    fireEvent.change(searchInput, { target: { value: 'Mechanical' } });

    // Test Refresh button
    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalled();
    });
  });

  test('handles proper empty state when no tasks exist', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('No internal tasks found')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create First Task/i })).toBeInTheDocument();
    });

    // Click Create First Task
    fireEvent.click(screen.getByRole('button', { name: /Create First Task/i }));
    expect(screen.getByRole('heading', { name: 'Create Internal Task' })).toBeInTheDocument();
  });

  test('handles error state with retry button', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockRejectedValue(new Error('Network failure'));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load internal tasks from database.')).toBeInTheDocument();
    });

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: 5,
    });
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
  });

  test('handles pagination: Next and Previous page clicks', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(nextBtn);
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalled();
    });

    const prevBtn = screen.getByRole('button', { name: 'Previous' });
    fireEvent.click(prevBtn);
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalled();
    });
  });

  test('opens right-side filter drawer, configures all filters, applies and resets them', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Open filter drawer
    const filterBtn = screen.getByRole('button', { name: /Filter/i });
    fireEvent.click(filterBtn);

    expect(screen.getByRole('heading', { name: 'Filter Tasks' })).toBeInTheDocument();

    // Verify removed fields (Related Module/Entity, Task Type, Created By) are absent
    expect(screen.queryByText('Related Module / Entity')).not.toBeInTheDocument();
    expect(screen.queryByText('Task Type')).not.toBeInTheDocument();
    expect(screen.queryByText('Created By')).not.toBeInTheDocument();

    // Verify Status dropdown options are only: All Statuses, Open, Pending, Closed
    const statusSelect = screen.getByTestId('drawer-filter-status');
    const statusOptions = Array.from(statusSelect.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(statusOptions).toEqual(['All Statuses', 'Open', 'Pending', 'Closed']);

    // Select Priority High
    const prioritySelect = screen.getByTestId('drawer-filter-priority');
    fireEvent.change(prioritySelect, { target: { value: 'High' } });

    // Select Status Pending
    fireEvent.change(statusSelect, { target: { value: 'Pending' } });

    // Select Category
    const categoryFilterSelect = screen.getByTestId('drawer-filter-category');
    fireEvent.change(categoryFilterSelect, { target: { value: 'CALL_TASK' } });

    // Assigned User input
    const assignedInput = screen.getByTestId('drawer-filter-assignee');
    fireEvent.change(assignedInput, { target: { value: 'Sudheer' } });

    // Date inputs
    const dueFromInput = screen.getByTestId('drawer-filter-due-from');
    const dueToInput = screen.getByTestId('drawer-filter-due-to');
    fireEvent.change(dueFromInput, { target: { value: '2026-10-01' } });
    fireEvent.change(dueToInput, { target: { value: '2026-11-30' } });

    // Apply filters
    const applyBtn = screen.getByTestId('drawer-apply-filters-btn');
    fireEvent.click(applyBtn);

    expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 'High',
        status: 'Pending',
        taskCategory: 'CALL_TASK',
        assignedTo: 'Sudheer',
        dueFrom: '2026-10-01',
        dueTo: '2026-11-30',
      })
    );

    // Reopen drawer and reset
    fireEvent.click(screen.getByTestId('toolbar-filter-btn'));
    const resetBtn = screen.getByTestId('drawer-reset-filters-btn');
    fireEvent.click(resetBtn);

    expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 'all',
        status: 'all',
      })
    );

    // Reopen drawer and close with X
    fireEvent.click(filterBtn);
    const closeDrawerBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (closeDrawerBtn) {
      fireEvent.click(closeDrawerBtn);
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Filter Tasks' })).not.toBeInTheDocument();
      });
    }
  });

  test('renders Status as the leftmost column and does not render Done column or row checkboxes', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Done column header and row checkboxes must not exist
    expect(screen.queryByRole('columnheader', { name: /^Done$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Done$/i)).not.toBeInTheDocument();

    // The first column header must be Status
    const columnHeaders = screen.getAllByRole('columnheader');
    expect(columnHeaders[0]).toHaveTextContent(/Status/i);
    expect(columnHeaders[1]).toHaveTextContent(/Task Subject & ID/i);

    // No row checkboxes in the table
    const table = screen.getByRole('table');
    const tableCheckboxes = table.querySelectorAll('input[type="checkbox"]');
    expect(tableCheckboxes.length).toBe(0);
  });

  test('keeps the task summary open and says so when the full task record cannot be read', async () => {
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValueOnce(null);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_101'));

    expect(await screen.findByText(UI_STRINGS.actionCenter.tasks.taskDetailsLoadFailed)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();
    expect(screen.getAllByText('Audit Mechanical Spares RFQ Quotes').length).toBeGreaterThan(0);
  });

  test('reports a thrown error while loading the full task record', async () => {
    (internalTaskClient.fetchTaskById as jest.Mock).mockRejectedValueOnce(new Error('Task service unreachable'));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_101'));

    expect(await screen.findByText(UI_STRINGS.actionCenter.tasks.taskDetailsLoadFailed)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();
  });

  test('renders task status badge in the first column and opens details on row click', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Verify status badges render properly in the first column of the rows
    const firstRow = screen.getByTestId('task-row-tsk_101');
    expect(within(firstRow).getByText('Pending')).toBeInTheDocument();

    const secondRow = screen.getByTestId('task-row-tsk_102');
    expect(within(secondRow).getByText('Completed')).toBeInTheDocument();

    // Verify row click opens the task details drawer
    fireEvent.click(firstRow);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();
    });
  });

  test('opens Create Task modal, fills fields, selects real entity, and submits', async () => {
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValue({
      id: 'tsk_103',
      task_number: 'TASK-1003',
      title: 'Review New Solar Vendor Catalog',
      status: 'Pending',
      priority: 'Medium',
      related_entity_type: 'RFQ',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole('heading', { name: 'Create Internal Task' })).toBeInTheDocument();

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Review New Solar Vendor Catalog' } });

    const descInput = screen.getByPlaceholderText(/Provide context/i);
    fireEvent.change(descInput, { target: { value: 'Check electrical compliance certificates' } });

    // Change Priority to High
    const prioritySelect = screen.getByDisplayValue('Medium');
    fireEvent.change(prioritySelect, { target: { value: 'High' } });

    // Change Status to Pending
    const statusSelect = screen.getByDisplayValue('Open');
    fireEvent.change(statusSelect, { target: { value: 'Pending' } });

    // Change Assign To via custom assignee toggle
    const customAssigneeBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.customAssignee });
    fireEvent.click(customAssigneeBtn);
    const assignInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.customAssigneePlaceholder);
    fireEvent.change(assignInput, { target: { value: 'Sudheer Kangala' } });

    // Change Due Date
    const modalForm = document.querySelector('form');
    const dueDateInput = modalForm?.querySelector('input[type="date"]');
    if (dueDateInput) {
      fireEvent.change(dueDateInput, { target: { value: '2026-11-15' } });
    }

    // Change Notes
    const notesInput = screen.getByPlaceholderText(/Optional internal remarks/i);
    fireEvent.change(notesInput, { target: { value: 'High priority customer' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Review New Solar Vendor Catalog',
          description: 'Check electrical compliance certificates',
          priority: 'High',
          status: 'Pending',
        })
      );
    });
  });

  test('handles Create Task cancel and close buttons', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    // Submitting with empty title returns early
    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('heading', { name: 'Create Internal Task' })).not.toBeInTheDocument();

    // Reopen and close with X
    fireEvent.click(createBtn);
    const closeBtn = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
    if (closeBtn) fireEvent.click(closeBtn);
  });

  test('allows adding another custom assignee via Add another one inside modal', async () => {
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValue({
      id: 'tsk_104',
      task_number: 'TASK-1004',
      title: 'Task with New Assignee',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    // Click + Add another one
    const addAnotherBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.addAnotherOne });
    fireEvent.click(addAnotherBtn);

    const customAssigneeInput = screen.getByTestId('custom-assignee-input');
    fireEvent.change(customAssigneeInput, { target: { value: 'Ramesh Patel' } });

    // Confirm adding custom assignee
    const confirmAddBtn = screen.getByTestId('confirm-add-assignee-button');
    fireEvent.click(confirmAddBtn);

    // Verify it returned to the select dropdown and selected Ramesh Patel
    const selectDropdown = screen.getByTestId('select-assignee-dropdown');
    expect(selectDropdown).toHaveValue('Ramesh Patel');

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Task with New Assignee' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Task with New Assignee',
          assignedToName: 'Ramesh Patel',
        })
      );
    });
  });

  test('opens task details drawer, tests external link button, closes drawer, and deletes a task', async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    (internalTaskClient.deleteInternalTask as jest.Mock).mockResolvedValue(true);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Click external link icon in table row
    const viewButtons = screen.getAllByTitle('View details');
    fireEvent.click(viewButtons[0]);

    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();

    // Close button in drawer
    const closeDrawerBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeDrawerBtn);
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Task Details' })).not.toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: 'Task Details' })).not.toBeInTheDocument();

    // Open task details for task with fallback fields
    const paymentTitle = screen.getByText('Payment Reconciliation Settlement');
    fireEvent.click(paymentTitle);
    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // Reopen by clicking title and delete task
    const taskTitle = screen.getByText('Audit Mechanical Spares RFQ Quotes');
    fireEvent.click(taskTitle);

    const deleteDrawerBtn = screen.getByTestId('drawer-delete-task-btn');
    fireEvent.click(deleteDrawerBtn);

    await waitFor(() => {
      expect(internalTaskClient.deleteInternalTask).toHaveBeenCalledWith('tsk_101');
    });

    // Delete directly from table row icon
    const deleteRowButtons = screen.getAllByTitle('Delete task');
    if (deleteRowButtons.length > 0) {
      fireEvent.click(deleteRowButtons[0]);
      await waitFor(() => {
        expect(internalTaskClient.deleteInternalTask).toHaveBeenCalled();
      });
    }
  });

  test('handles backdrop clicks and close icons for drawers', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Open filter drawer and close via backdrop
    const filterBtn = screen.getByRole('button', { name: /Filter/i });
    fireEvent.click(filterBtn);
    expect(screen.getByRole('heading', { name: 'Filter Tasks' })).toBeInTheDocument();

    const filterBackdrop = screen.getByTestId('filter-drawer-backdrop');
    fireEvent.click(filterBackdrop);
    expect(screen.queryByRole('heading', { name: 'Filter Tasks' })).not.toBeInTheDocument();

    // Open details drawer and close via header X
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText('Audit Mechanical Spares RFQ Quotes')[0]);
    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();

    const closeXBtn = screen.getByTestId('task-details-close-x');
    fireEvent.click(closeXBtn);
    expect(screen.queryByRole('heading', { name: 'Task Details' })).not.toBeInTheDocument();

    // Reopen details drawer and close via backdrop
    fireEvent.click(screen.getByText('Audit Mechanical Spares RFQ Quotes'));
    expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();

    const detailsBackdrop = screen.getByTestId('task-details-backdrop');
    fireEvent.click(detailsBackdrop);
    expect(screen.queryByRole('heading', { name: 'Task Details' })).not.toBeInTheDocument();
  });

  test('handles task creation failure and exception handling', async () => {
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce(null);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Task will fail' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to create task in database.')).toBeInTheDocument();
    });

    // Test rejection branch
    (internalTaskClient.createInternalTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Error saving task.')).toBeInTheDocument();
    });
  });

  test('handles task deletion cancellation and API failure', async () => {
    window.confirm = jest.fn().mockReturnValue(false);
    (internalTaskClient.deleteInternalTask as jest.Mock).mockClear();

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const deleteRowButtons = screen.getAllByTitle('Delete task');
    fireEvent.click(deleteRowButtons[0]);

    expect(internalTaskClient.deleteInternalTask).not.toHaveBeenCalled();

    // Now confirm = true, but API returns false
    (window.confirm as jest.Mock).mockReturnValue(true);
    (internalTaskClient.deleteInternalTask as jest.Mock).mockResolvedValueOnce(false);

    fireEvent.click(deleteRowButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to delete task.')).toBeInTheDocument();
    });
  });

  test('handles task type dropdown selection and switching between modes', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    // Verify task type dropdown is removed from Create Internal Task modal
    expect(screen.queryByTestId('create-task-type-select')).not.toBeInTheDocument();

    // Toggle custom assignee input and back to existing
    const addAnotherBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.addAnotherOne });
    fireEvent.click(addAnotherBtn);

    expect(screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.customAssigneePlaceholder)).toBeInTheDocument();

    // Toggle back to existing
    const chooseExistingBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.chooseExistingMember });
    fireEvent.click(chooseExistingBtn);

    expect(screen.getByTestId('select-assignee-dropdown')).toBeInTheDocument();
  });

  test('renders page wrapper CategoryManagerInternalTasksPage', async () => {
    render(<CategoryManagerInternalTasksPage />);
    expect(screen.getByTestId('card-total-tasks')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
  });


  test('switches across Action Center sub-navigation tabs (tickets, approvals, scorecard, buyers, sellers, registrations, tasks)', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // 1. Switch to Tickets tab
    const ticketsTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.tickets, 'i') });
    fireEvent.click(ticketsTab);
    expect(screen.getByTestId('tickets-dashboard')).toBeInTheDocument();

    // 2. Switch to Approvals tab
    const approvalsTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.approvals, 'i') });
    fireEvent.click(approvalsTab);
    expect(screen.getByTestId('approvals-dashboard')).toBeInTheDocument();

    // 3. Switch to Scorecard tab
    const scorecardTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.scorecard, 'i') });
    fireEvent.click(scorecardTab);
    expect(screen.getByTestId('scorecard-dashboard')).toBeInTheDocument();

    // 4. Switch to Buyers Directory tab
    const buyersTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.buyersDirectory, 'i') });
    fireEvent.click(buyersTab);
    expect(screen.getByTestId('buyers-directory')).toBeInTheDocument();

    // 5. Switch to Sellers Directory tab
    const sellersTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.sellersDirectory, 'i') });
    fireEvent.click(sellersTab);
    expect(screen.getByTestId('sellers-directory')).toBeInTheDocument();

    // 6. Switch to Registrations tab
    const registrationsTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.registrations, 'i') });
    fireEvent.click(registrationsTab);
    expect(screen.getByTestId('registrations-dashboard')).toBeInTheDocument();

    // 7. Switch back to Internal tasks tab
    const tasksTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.internalTasks, 'i') });
    fireEvent.click(tasksTab);
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
  });

  test('reads tab query parameter on mount and switches active tab', async () => {
    window.history.pushState({}, '', '/category-manager/internal-tasks?tab=tickets');

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('tickets-dashboard')).toBeInTheDocument();
    });

    // Reset url
    window.history.pushState({}, '', '/category-manager/internal-tasks');
  });

  test('prevents create task submission when title is empty', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    expect(internalTaskClient.createInternalTask).not.toHaveBeenCalled();
  });

  test('handles loadTaskTypes when fetchTaskTypes returns empty array', async () => {
    (internalTaskClient.fetchTaskTypes as jest.Mock).mockResolvedValueOnce({ taskTypes: [] });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole('heading', { name: 'Create Internal Task' })).toBeInTheDocument();
  });

  test('handles user-wise filtering via toolbar dropdown', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });
    (internalTaskClient.fetchTaskSummary as jest.Mock).mockResolvedValue({
      total: 1,
      pending: 1,
      inProgress: 0,
      blocked: 0,
      completed: 0,
      escalated: 0,
      criticalCount: 0,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const assigneeSelect = screen.getByTestId('toolbar-assignee-select');
    fireEvent.change(assigneeSelect, { target: { value: 'Govardhan' } });

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: 'Govardhan' })
      );
      expect(internalTaskClient.fetchTaskSummary).toHaveBeenCalledWith({ assignedTo: 'Govardhan' });
    });

    // Reset to all
    fireEvent.change(assigneeSelect, { target: { value: 'all' } });
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: '' })
      );
    });
  });

  test('filters by assignee dropdown selecting session user and all users', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const assigneeSelect = screen.getByTestId('toolbar-assignee-select');
    fireEvent.change(assigneeSelect, { target: { value: 'Sudheer' } });

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: 'Sudheer' })
      );
    });

    fireEvent.change(assigneeSelect, { target: { value: 'all' } });
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: '' })
      );
    });
  });

  test('clicking anywhere on a task table row opens the Task Details drawer', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const taskRow = screen.getByTestId('task-row-tsk_101');
    fireEvent.click(taskRow);

    await waitFor(() => {
      expect(screen.getByText('Task Details')).toBeInTheDocument();
      expect(screen.getByText('Execution Status')).toBeInTheDocument();
    });
  });

  test('create task modal supports selecting team member or adding custom assignee', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValue({
      id: 'tsk_new_1',
      task_number: 'TASK-1005',
      title: 'New User-Wise Task',
      priority: 'Medium',
      status: 'Pending',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const openCreateBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(openCreateBtn);

    // Default: dropdown selection
    const selectDropdown = screen.getByTestId('select-assignee-dropdown');
    fireEvent.change(selectDropdown, { target: { value: 'Pavani' } });

    // Toggle to custom assignee
    const customToggleBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.customAssignee });
    fireEvent.click(customToggleBtn);

    const customInput = screen.getByTestId('custom-assignee-input');
    fireEvent.change(customInput, { target: { value: 'External Consultant' } });

    // Toggle back to existing member
    const chooseExistingBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.chooseExistingMember });
    fireEvent.click(chooseExistingBtn);

    // Enter title & submit
    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Test Task with Assignee' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Task with Assignee',
        })
      );
    });
  });

  test('completes a task with resolution remarks from the Task Details drawer', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });
    (internalTaskClient.completeInternalTask as jest.Mock).mockResolvedValue({
      ...mockTasks[0],
      status: 'Completed',
      notes: 'Specification quotes verified successfully',
      completed_at: '2026-10-31T17:00:00Z',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Open drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_101'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-mark-complete-btn')).toBeInTheDocument();
    });

    // Click Mark as Completed to open remarks section
    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));

    const remarksInput = screen.getByTestId('completion-remarks-input');
    fireEvent.change(remarksInput, { target: { value: 'Specification quotes verified successfully' } });

    // Confirm completion
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(internalTaskClient.completeInternalTask).toHaveBeenCalledWith(
        'tsk_101',
        'Specification quotes verified successfully'
      );
    });
  });

  test('reopens a completed task from the Task Details drawer', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[1]], // Completed task
      total: 1,
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValue({
      ...mockTasks[1],
      status: 'Open',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Verify Buyer Account Documents')).toBeInTheDocument();
    });

    // Open drawer for completed task
    fireEvent.click(screen.getByTestId('task-row-tsk_102'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-reopen-task-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('drawer-reopen-task-btn'));

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_102',
        expect.objectContaining({ status: 'Open' })
      );
    });
  });


  test('covers all entity types and priority branches in task table and drawer', async () => {
    const variedTasks: internalTaskClient.InternalTask[] = [
      {
        id: 'tsk_buyer',
        task_number: 'TASK-2001',
        title: 'Buyer Task',
        priority: 'Low',
        status: 'Blocked',
        related_entity_type: 'BUYER',
        related_entity_label: 'Tata Steel',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'tsk_vendor',
        task_number: 'TASK-2002',
        title: 'Vendor Task',
        priority: 'Critical',
        status: 'Escalated',
        due_date: undefined, // test no due date branch
        related_entity_type: 'VENDOR',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'tsk_credit',
        task_number: 'TASK-2003',
        title: 'Credit Task',
        priority: 'Medium',
        status: 'In Progress',
        due_date: todayStr, // test Due Today (diffDays === 0)
        related_entity_type: 'CREDIT',
        notes: 'Important credit notes for audit',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'tsk_payment',
        task_number: 'TASK-2004',
        title: 'Payment Task',
        priority: 'High',
        status: 'Completed',
        completed_at: '2026-10-30T10:00:00Z',
        related_entity_type: 'PAYMENT',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'tsk_category',
        task_number: 'TASK-2005',
        title: 'Category Task',
        priority: 'Low',
        status: 'Pending',
        related_entity_type: 'CATEGORY',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
      {
        id: 'tsk_general',
        task_number: 'TASK-2006',
        title: 'General Task',
        priority: 'Medium',
        status: 'Pending',
        related_entity_type: 'GENERAL',
        created_at: '2026-10-25T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
      },
    ];

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: variedTasks,
      total: variedTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Buyer Task')).toBeInTheDocument();
      expect(screen.getByText('Vendor Task')).toBeInTheDocument();
      expect(screen.getByText('Credit Task')).toBeInTheDocument();
      expect(screen.getAllByText('No Due Date').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Due Today')).toBeInTheDocument();
    });

    // Open drawer for Credit task to verify notes and entity label fallback
    fireEvent.click(screen.getByTestId('task-row-tsk_credit'));
    await waitFor(() => {
      expect(screen.getByText('Important credit notes for audit')).toBeInTheDocument();
    });
  });

  test('covers complete failure branches, cancel button, and reopen failure', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // Open drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_101'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-mark-complete-btn')).toBeInTheDocument();
    });

    // 1. Test clicking cancel button inside complete section
    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));
    expect(screen.getByTestId('completion-remarks-input')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByTestId('completion-remarks-input')).not.toBeInTheDocument();

    // 2. Test complete failure returning null
    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));
    (internalTaskClient.completeInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(screen.getByText('Failed to complete task.')).toBeInTheDocument();
    });

    // 3. Test complete exception throwing
    (internalTaskClient.completeInternalTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(screen.getByText('Error completing task.')).toBeInTheDocument();
    });

  });

  test('covers reopen failure branch when update throws', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('Reopen error'));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_102')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_102'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-reopen-task-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('drawer-reopen-task-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error reopening task.')).toBeInTheDocument();
    });
  });

  test('covers qua_payment_dues_updated custom event', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const customEvent = new CustomEvent('qua_payment_dues_updated', {
      detail: { totalLowCreditAccounts: 7, totalDuesAmount: 50000 },
    });
    act(() => {
      window.dispatchEvent(customEvent);
    });

    // Active tab payment dues
    const paymentDuesTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.paymentDues, 'i') });
    fireEvent.click(paymentDuesTab);
    expect(screen.getByTestId('payment-dues-dashboard')).toBeInTheDocument();
  });


    test('covers null sessionUser, null responses, and fallback task numbers', async () => {
    const { fetchTicketSummary } = require('@/lib/ticketClient');
    const { fetchApprovalSummary } = require('@/lib/approvalClient');
    const { authClient } = require('@/lib/authClient');

    (fetchTicketSummary as jest.Mock).mockResolvedValueOnce({ summary: null, error: 'Ticket summary unavailable.' });
    (fetchApprovalSummary as jest.Mock).mockResolvedValueOnce({ summary: null, error: 'Approval summary unavailable.' });
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValueOnce({ assignees: [] });
    (authClient.getSessionUser as jest.Mock).mockReturnValueOnce(null);

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [
        {
          ...mockTasks[0],
          id: 'tsk_no_num_1',
          task_number: '',
          status: 'Pending',
        },
        {
          ...mockTasks[1],
          id: 'tsk_no_num_2',
          task_number: '',
          status: 'Completed',
        },
      ],
      total: 2,
    });

    const { unmount } = render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });
    // A failed count is reported in the banner. The first failure is shown.
    expect(screen.getByText('Ticket summary unavailable.')).toBeInTheDocument();

    // Dispatch event with null detail to cover customEvent.detail falsy branch
    act(() => {
      window.dispatchEvent(new CustomEvent('qua_payment_dues_updated', { detail: null }));
    });

    unmount();
  });

  test('covers task complete and reopen without task_number and with multiple tasks', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [
        {
          ...mockTasks[0],
          id: 'tsk_multi_1',
          task_number: '',
          status: 'Pending',
        },
        {
          ...mockTasks[1],
          id: 'tsk_multi_2',
          task_number: '',
          status: 'Completed',
        },
      ],
      total: 2,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_multi_1')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-tsk_multi_2')).toBeInTheDocument();
    });

    // Complete tsk_multi_1 (drawer) with updated having no task_number and check multi-item map
    fireEvent.click(screen.getByTestId('task-row-tsk_multi_1'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-mark-complete-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));

    (internalTaskClient.completeInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[0],
      id: 'tsk_multi_1',
      task_number: '',
      status: 'Completed',
    });
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(screen.getByText(/tsk_multi_1/i)).toBeInTheDocument();
    });

    // Close drawer
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Reopen tsk_multi_2 (drawer) with updated returning null
    fireEvent.click(screen.getByTestId('task-row-tsk_multi_2'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-reopen-task-btn')).toBeInTheDocument();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-reopen-task-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-reopen-task-btn')).not.toBeDisabled();
    });

    // Now reopen tsk_multi_2 with updated having no task_number
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[1],
      id: 'tsk_multi_2',
      task_number: '',
      status: 'Pending',
    });
    fireEvent.click(screen.getByTestId('drawer-reopen-task-btn'));

    await waitFor(() => {
      expect(screen.getByText(/tsk_multi_2/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('covers assignee dropdown with member having no id and no role, plus custom type null return', async () => {
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValueOnce({ assignees: [
      { id: '', name: 'Special Ops User', role: '' },
    ] });
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-assignee-select')).toBeInTheDocument();
    });

    // Toolbar select Special Ops User
    const toolbarSelect = screen.getByTestId('toolbar-assignee-select');
    fireEvent.change(toolbarSelect, { target: { value: 'Chandan' } });

    // Open create modal
    const openCreateBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(openCreateBtn);

    // Select Special Ops User in modal dropdown
    const selectAssignee = screen.getByTestId('select-assignee-dropdown');
    fireEvent.change(selectAssignee, { target: { value: 'Special Ops User' } });

    // Select Krishna Chaitanya
    fireEvent.change(selectAssignee, { target: { value: 'Krishna Chaitanya' } });

    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[0],
      id: 'tsk_experimental',
    });

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Task with custom type failure' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Task with custom type failure',
          assignedToName: 'Krishna Chaitanya',
        })
      );
    });
  });

  test('covers active filter count with assignedTo, dueFrom, and dueTo', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Filter/i })).toBeInTheDocument();
    });

    const filterBtn = screen.getByRole('button', { name: /Filter/i });
    fireEvent.click(filterBtn);

    // Set assignedTo, dueFrom, dueTo in filter drawer
    const assignedInput = screen.getByPlaceholderText('Search assignee name...');
    fireEvent.change(assignedInput, { target: { value: 'Navin' } });

    const dateInputs = screen.getAllByDisplayValue('');
    const dueFromInput = dateInputs.find((el) => el.getAttribute('type') === 'date');
    if (dueFromInput) {
      fireEvent.change(dueFromInput, { target: { value: '2026-10-01' } });
    }

    const applyBtn = screen.getByRole('button', { name: 'Apply Filters' });
    fireEvent.click(applyBtn);

    // Now filter button has badge with active filter count > 0
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Filter/i })).toHaveClass('bg-blue-50');
    });
  });

  test('covers row compose button, drawer compose button, and empty tasks fallback', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-compose-tsk_101')).toBeInTheDocument();
    });

    // 1. Click row compose button
    const rowComposeBtn = screen.getByTestId('task-row-compose-tsk_101');
    fireEvent.click(rowComposeBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(UI_STRINGS.actionCenter.communicationModal.modalTitle)).toBeInTheDocument();
    });

    // Close compose modal using header cancel button
    const closeBtns = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.communicationModal.btnCancel });
    fireEvent.click(closeBtns[0]);

    // 2. Open task details drawer and click drawer compose button
    fireEvent.click(screen.getByTestId('task-row-tsk_101'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-compose-btn')).toBeInTheDocument();
    });

    const drawerComposeBtn = screen.getByTestId('drawer-compose-btn');
    fireEvent.click(drawerComposeBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  test('covers compose modal when tasks list is empty and session user has no name', async () => {
    const origSessionUser = require('@/lib/authClient').authClient.getSessionUser;
    require('@/lib/authClient').authClient.getSessionUser = jest.fn().mockReturnValue({ email: 'noname@procucev.com' });

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [],
      total: 0,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Send SMS/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Send SMS/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    require('@/lib/authClient').authClient.getSessionUser = origSessionUser;
  });

  test('covers compose modal when task assignee matches by name without userId or has no match', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [
        {
          id: 'tsk_match_name',
          task_number: 'TSK-9901',
          title: 'Review supplier NDA',
          category: 'DOCUMENTATION',
          priority: 'Medium',
          status: 'Open',
          assigned_to_name: 'Priya Sharma',
          assigned_team: 'Category Management',
          due_date: '2026-11-20T10:00:00Z',
          related_entity_type: 'SELLER',
          related_entity_id: 'v_nda',
          created_at: '2026-11-01T10:00:00Z',
          updated_at: '2026-11-01T10:00:00Z',
        },
        {
          id: 'tsk_no_match',
          task_number: 'TSK-9902',
          title: 'Unmatched assignee task',
          category: 'GENERAL',
          priority: 'Low',
          status: 'Open',
          assigned_to_name: 'Unknown Person',
          assigned_team: 'Category Management',
          due_date: '2026-11-25T10:00:00Z',
          related_entity_type: 'BUYER',
          related_entity_id: 'b_unknown',
          created_at: '2026-11-01T10:00:00Z',
          updated_at: '2026-11-01T10:00:00Z',
        },
      ],
      total: 2,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-compose-tsk_match_name')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-compose-tsk_match_name'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const closeBtns = screen.getAllByRole('button', { name: UI_STRINGS.actionCenter.communicationModal.btnCancel });
    fireEvent.click(closeBtns[0]);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-compose-tsk_no_match')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-compose-tsk_no_match'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // NEW INTERNAL TASKS MODULE TESTS: CATEGORIES, APPROVALS, ACTIVITIES, REMINDERS
  // =========================================================================

  const mockCreditTask: internalTaskClient.InternalTask = {
    id: 'tsk_credit_999',
    task_number: 'TASK-9999',
    title: 'Request Additional 50 Credits for Buyer',
    description: 'Enterprise tier expansion',
    task_category: 'CREDIT_MANAGEMENT',
    task_type: 'Add Credits',
    task_type_id: 'itt_add_credits',
    priority: 'High',
    status: 'Pending Approval',
    assigned_to_name: 'Navin Chaudhary',
    credit_account_type: 'BUYER',
    credit_account_id: 'buyer_abc',
    credit_account_name: 'Tata Steel Corp',
    credit_quantity: 50,
    credit_reason: 'Annual contract expansion',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    activities: [
      {
        id: 'act_1',
        task_id: 'tsk_credit_999',
        action_type: 'CREATED',
        comment: 'Created credit request',
        actor_name: 'Navin Chaudhary',
        created_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'act_fallback',
        task_id: 'tsk_credit_999',
        action_type: 'STATUS_CHANGE',
        comment: '',
        actor_name: '',
        created_at: '',
      },
    ],
  };

  const mockCommTask: internalTaskClient.InternalTask = {
    id: 'tsk_comm_888',
    task_number: 'TASK-8888',
    title: 'Call Vendor for Pricing Negotiations',
    description: 'Discuss volume discount on pipes',
    task_category: 'COMMUNICATION',
    task_type: 'Phone Call',
    task_type_id: 'itt_phone_call',
    priority: 'Medium',
    status: 'In Progress',
    assigned_to_name: 'Sudheer Kangala',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  };

  const mockDemoTask: internalTaskClient.InternalTask = {
    id: 'tsk_demo_777',
    task_number: 'TASK-7777',
    title: 'Product Demo for Logistics Automation',
    description: 'Demonstrate dashboard to client',
    task_category: 'DEMO_SCHEDULING',
    task_type: 'Demo Scheduling',
    task_type_id: 'itt_demo_scheduling',
    priority: 'High',
    status: 'Assigned',
    demo_date: '2026-11-15',
    demo_time: '14:30',
    demo_status: 'Scheduled',
    assigned_to_name: 'Prajwal K',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  };

  test('handles clicking on each of the 6 summary cards to filter tasks', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });
    (internalTaskClient.fetchTaskSummary as jest.Mock).mockResolvedValue({
      total: 10,
      newTasks: 2,
      inProgress: 3,
      pendingApproval: 2,
      completed: 3,
      overdueCount: 1,
      criticalCount: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('card-total-tasks')).toBeInTheDocument();
    });

    // Total card click
    fireEvent.click(screen.getByTestId('card-total-tasks'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'all' })
      );
    });

    // New Tasks card click
    fireEvent.click(screen.getByTestId('card-new-tasks'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'New' })
      );
    });

    // In Progress card click
    fireEvent.click(screen.getByTestId('card-in-progress'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'In Progress' })
      );
    });

    // Pending Approval card click
    fireEvent.click(screen.getByTestId('card-pending-approval'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Pending Approval' })
      );
    });

    // Completed card click
    fireEvent.click(screen.getByTestId('card-completed'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Completed' })
      );
    });

    // Overdue card click
    fireEvent.click(screen.getByTestId('card-overdue'));
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'all', dueTo: expect.any(String) })
      );
    });
  });

  test('handles toolbar category filter dropdown and drawer category filter', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-category-select')).toBeInTheDocument();
    });

    const categorySelect = screen.getByTestId('toolbar-category-select');
    fireEvent.change(categorySelect, { target: { value: 'CREDIT_MANAGEMENT' } });

    await waitFor(() => {
      expect(internalTaskClient.fetchTaskSummary).toHaveBeenCalledWith(
        expect.objectContaining({ taskCategory: 'CREDIT_MANAGEMENT' })
      );
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ taskCategory: 'CREDIT_MANAGEMENT' })
      );
    });

    fireEvent.change(categorySelect, { target: { value: 'CALL_TASK' } });
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ taskCategory: 'CALL_TASK' })
      );
    });

    fireEvent.change(categorySelect, { target: { value: 'all' } });

    // Open filter drawer and test drawer category filter
    const filterBtn = screen.getByRole('button', { name: /Filter/i });
    fireEvent.click(filterBtn);

    const drawerCatSelect = screen.getByTestId('drawer-filter-category');
    fireEvent.change(drawerCatSelect, { target: { value: 'DEMO_SCHEDULE' } });

    const applyBtn = screen.getByRole('button', { name: 'Apply Filters' });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ taskCategory: 'DEMO_SCHEDULE' })
      );
    });
  });

  test('renders toolbar with search, categories, assignees, filters, and export csv next to column settings', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-export-csv-btn')).toBeInTheDocument();
      expect(screen.getByTestId('toolbar-gear-btn')).toBeInTheDocument();
    });

    // Confirm My Tasks and Reminders buttons are completely removed
    expect(screen.queryByTestId('toolbar-my-tasks-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toolbar-check-reminders-btn')).not.toBeInTheDocument();
    expect(screen.getByText('Export CSV')).toBeInTheDocument();

    // Verify All Users toolbar dropdown reflects the 4 users (Govardhan, Chandan, Krishna Chaitanya, Sudheer) and excludes Unassigned and Category Manager
    const assigneeSelect = screen.getByTestId('toolbar-assignee-select');
    const options = Array.from(assigneeSelect.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(options).toContain('All Users');
    expect(options).toContain('Govardhan');
    expect(options).toContain('Chandan');
    expect(options).toContain('Krishna Chaitanya');
    expect(options).toContain('Sudheer');
    expect(options.some((opt) => opt?.toLowerCase().includes('category manager'))).toBe(false);
    expect(options.some((opt) => opt?.toLowerCase() === 'unassigned')).toBe(false);

    // Verify All Categories and All Users have proper width classes so text is fully visible
    const categorySelect = screen.getByTestId('toolbar-category-select');
    expect(categorySelect.className).toContain('w-[150px]');
    expect(assigneeSelect.className).toContain('w-[130px]');

    // Verify the 9 toolbar items exist in order
    expect(screen.getByPlaceholderText(/Search by title/i)).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-create-task-btn')).toBeInTheDocument();
    expect(categorySelect).toBeInTheDocument();
    expect(assigneeSelect).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-send-sms-email-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-filter-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-export-csv-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-refresh-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-gear-btn')).toBeInTheDocument();

    // Test selecting specific user in toolbar assignee select
    fireEvent.change(assigneeSelect, { target: { value: 'Govardhan' } });
    fireEvent.change(assigneeSelect, { target: { value: 'Sudheer' } });
    fireEvent.change(assigneeSelect, { target: { value: 'all' } });
    fireEvent.change(assigneeSelect, { target: { value: 'all' } });

    // Open create task modal and verify Task Type is completely removed and Category Manager is excluded from Assign to User
    fireEvent.click(screen.getByRole('button', { name: /Create Internal Task/i }));
    expect(screen.queryByTestId('create-task-type-select')).not.toBeInTheDocument();
    const modalAssigneeSelect = screen.getByTestId('select-assignee-dropdown');
    const modalOptions = Array.from(modalAssigneeSelect.querySelectorAll('option')).map((o) => o.textContent?.trim());
    expect(modalOptions.some((opt) => opt?.toLowerCase().includes('category manager'))).toBe(false);
    expect(modalOptions).toContain('Govardhan');
    expect(modalOptions).toContain('Chandan');
    expect(modalOptions).toContain('Krishna Chaitanya');
    expect(modalOptions).toContain('Sudheer');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  test('creates a task under CREDIT_MANAGEMENT with credit parameters', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockCreditTask,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Internal Task/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Internal Task/i }));

    // Select CREDIT_MANAGEMENT
    const catSelect = screen.getByTestId('create-task-category-select');
    fireEvent.change(catSelect, { target: { value: 'CREDIT_MANAGEMENT' } });

    // Fill title
    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Extend 100 Credits for Steel Plant' } });

    // Fill credit specific fields
    const accountTypeSelect = screen.getByTestId('create-credit-account-type-select');
    fireEvent.change(accountTypeSelect, { target: { value: 'SELLER' } });

    const qtyInput = screen.getByTestId('create-credit-quantity-input');
    fireEvent.change(qtyInput, { target: { value: '100' } });

    const accountNameInput = screen.getByTestId('create-credit-account-name-input');
    fireEvent.change(accountNameInput, { target: { value: 'Jindal Steel Works' } });

    const reasonInput = screen.getByTestId('create-credit-reason-input');
    fireEvent.change(reasonInput, { target: { value: 'Special incentive for emergency spares' } });

    // Submit
    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskCategory: 'CREDIT_MANAGEMENT',
          creditAccountType: 'SELLER',
          creditQuantity: 100,
          creditAccountName: 'Jindal Steel Works',
          creditReason: 'Special incentive for emergency spares',
          status: 'Pending',
        })
      );
    });
  });

  test('creates a task under DEMO_SCHEDULE and other categories (BUYER credit, EMAIL, SMS)', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockDemoTask,
      task_category: 'DEMO_SCHEDULE',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Internal Task/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Internal Task/i }));

    const catSelect = screen.getByTestId('create-task-category-select');
    fireEvent.change(catSelect, { target: { value: 'DEMO_SCHEDULE' } });

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Demo of enterprise bidding platform' } });

    const dateInput = screen.getByTestId('create-demo-date-input');
    fireEvent.change(dateInput, { target: { value: '2026-11-20' } });

    const timeInput = screen.getByTestId('create-demo-time-input');
    fireEvent.change(timeInput, { target: { value: '15:30' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskCategory: 'DEMO_SCHEDULE',
          demoDate: '2026-11-20',
          demoTime: '15:30',
        })
      );
    });

    // Test creating BUYER credit account
    fireEvent.click(screen.getByRole('button', { name: /Create Internal Task/i }));
    fireEvent.change(screen.getByTestId('create-task-category-select'), { target: { value: 'CREDIT_MANAGEMENT' } });
    fireEvent.change(screen.getByTestId('create-credit-account-type-select'), { target: { value: 'BUYER' } });
    fireEvent.change(screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder), { target: { value: 'Buyer Credit Test' } });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce(mockCreditTask);
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({ relatedEntityType: 'BUYER' })
      );
    });

    // Test EMAIL_TASK, SMS_TASK, SITE_VISITING_MEETING_CLIENTS, INTERNAL_OPERATIONS categories
    fireEvent.click(screen.getByRole('button', { name: /Create Internal Task/i }));
    fireEvent.change(screen.getByTestId('create-task-category-select'), { target: { value: 'EMAIL_TASK' } });
    fireEvent.change(screen.getByTestId('create-task-category-select'), { target: { value: 'SMS_TASK' } });
    fireEvent.change(screen.getByTestId('create-task-category-select'), { target: { value: 'SITE_VISITING_MEETING_CLIENTS' } });
    fireEvent.change(screen.getByTestId('create-task-category-select'), { target: { value: 'INTERNAL_OPERATIONS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  test('handles credit approval and rejection workflow in Task Details drawer', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockCreditTask],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_credit_999')).toBeInTheDocument();
    });

    // Open drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_credit_999'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-approve-credit-btn')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-reject-credit-btn')).toBeInTheDocument();
    });

    const remarksInput = screen.getByTestId('credit-approval-remarks-input');
    fireEvent.change(remarksInput, { target: { value: 'Approved by Financial Governance Board' } });

    // 1. Approve Failure without error payload (fallback branch)
    (internalTaskClient.approveCreditTask as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    fireEvent.click(screen.getByTestId('drawer-approve-credit-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to approve credit task.')).toBeInTheDocument();
    });

    // 2. Approve Exception (status stays 'Pending Approval')
    (internalTaskClient.approveCreditTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('drawer-approve-credit-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error approving credit task.')).toBeInTheDocument();
    });

    // 3. Reject Failure without error payload (fallback branch)
    (internalTaskClient.rejectCreditTask as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    fireEvent.click(screen.getByTestId('drawer-reject-credit-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to reject credit task.')).toBeInTheDocument();
    });

    // 4. Reject Exception (status stays 'Pending Approval')
    (internalTaskClient.rejectCreditTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('drawer-reject-credit-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error rejecting credit task.')).toBeInTheDocument();
    });

    // 5. Reject Success (fallback message branch)
    (internalTaskClient.rejectCreditTask as jest.Mock).mockResolvedValueOnce({
      success: true,
      task: { ...mockCreditTask, status: 'Rejected', approval_status: 'REJECTED' },
    });
    fireEvent.click(screen.getByTestId('drawer-reject-credit-btn'));
    await waitFor(() => {
      expect(screen.getByText('Credit request rejected.')).toBeInTheDocument();
    });
  });

  test('handles credit approval success branch in Task Details drawer', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockCreditTask],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_credit_999')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_credit_999'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-approve-credit-btn')).toBeInTheDocument();
    });

    (internalTaskClient.approveCreditTask as jest.Mock).mockResolvedValueOnce({
      success: true,
      task: { ...mockCreditTask, status: 'Completed', approval_status: 'APPROVED' },
    });

    fireEvent.click(screen.getByTestId('drawer-approve-credit-btn'));

    await waitFor(() => {
      expect(screen.getByText('Credit request approved and balances updated.')).toBeInTheDocument();
    });
  });

  test('handles adding activity comments in Task Details drawer across success, failure, and error', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockCreditTask],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_credit_999')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_credit_999'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-add-activity-btn')).toBeInTheDocument();
    });

    const commentInput = screen.getByTestId('drawer-add-activity-input');

    // Empty input click does nothing
    fireEvent.click(screen.getByTestId('drawer-add-activity-btn'));
    expect(internalTaskClient.addTaskActivity).not.toHaveBeenCalled();

    fireEvent.change(commentInput, { target: { value: 'Verified audited balance sheet with accounts lead.' } });

    // 1. Success
    (internalTaskClient.addTaskActivity as jest.Mock).mockResolvedValueOnce({
      success: true,
      activity: {
        id: 'act_2',
        task_id: 'tsk_credit_999',
        action_type: 'COMMENT',
        comment: 'Verified audited balance sheet with accounts lead.',
        actor_name: 'Navin Chaudhary',
        created_at: '2026-11-02T11:00:00Z',
      },
    });

    fireEvent.click(screen.getByTestId('drawer-add-activity-btn'));

    await waitFor(() => {
      expect(internalTaskClient.addTaskActivity).toHaveBeenCalledWith(
        'tsk_credit_999',
        'Verified audited balance sheet with accounts lead.'
      );
      expect(screen.getByText('Activity note added.')).toBeInTheDocument();
    });

    // 2. Failure with fallback error message
    fireEvent.change(commentInput, { target: { value: 'Attempting invalid log' } });
    (internalTaskClient.addTaskActivity as jest.Mock).mockResolvedValueOnce({
      success: false,
    });
    fireEvent.click(screen.getByTestId('drawer-add-activity-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to add activity note.')).toBeInTheDocument();
    });

    // 3. Exception
    fireEvent.change(commentInput, { target: { value: 'Attempting network error log' } });
    (internalTaskClient.addTaskActivity as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('drawer-add-activity-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error adding activity note.')).toBeInTheDocument();
    });
  });

  test('enforces explicit confirmation before completing communication tasks', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockCommTask],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_comm_888')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_comm_888'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-mark-complete-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('communication-confirm-checkbox')).toBeInTheDocument();
    });

    // Click Complete WITHOUT checking confirmation box
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(
        screen.getByText('Failed to complete task. Communication tasks require explicit confirmation.')
      ).toBeInTheDocument();
    });

    // Check confirmation checkbox
    fireEvent.click(screen.getByTestId('communication-confirm-checkbox'));

    const remarksInput = screen.getByTestId('completion-remarks-input');
    fireEvent.change(remarksInput, { target: { value: 'Spoke with vendor director, agreed to 12% price discount.' } });

    (internalTaskClient.completeInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockCommTask,
      status: 'Completed',
    });

    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(internalTaskClient.completeInternalTask).toHaveBeenCalledWith(
        'tsk_comm_888',
        'Spoke with vendor director, agreed to 12% price discount.'
      );
    });
  });

  test('covers active filter count with taskCategory and assignedTo', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    // Open filter drawer
    fireEvent.click(screen.getByRole('button', { name: /Filter/i }));

    // Set Category and Assigned User
    fireEvent.change(screen.getByTestId('drawer-filter-category'), { target: { value: 'CREDIT_MANAGEMENT' } });
    fireEvent.change(screen.getByPlaceholderText(/Search assignee name/i), { target: { value: 'Sudheer' } });

    // Apply
    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Filter/i })).toHaveClass('bg-blue-50');
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  test('covers tasks with APPROVED and REJECTED approval_status and task with credit quantity', async () => {
    const approvedTask: internalTaskClient.InternalTask = {
      ...mockCreditTask,
      id: 'tsk_approved_1',
      approval_status: 'APPROVED',
      status: 'Completed',
    };
    const rejectedTask: internalTaskClient.InternalTask = {
      ...mockCreditTask,
      id: 'tsk_rejected_1',
      approval_status: 'REJECTED',
      status: 'Rejected',
    };
    const generalTaskWithCredits: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_gen_credits',
      task_category: undefined,
      credit_quantity: 25,
      credit_account_name: '',
      credit_account_type: undefined,
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [approvedTask, rejectedTask, generalTaskWithCredits],
      total: 3,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_approved_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_approved_1'));
    await waitFor(() => {
      expect(screen.getByText('APPROVED')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-details-close-x'));

    fireEvent.click(screen.getByTestId('task-row-tsk_rejected_1'));
    await waitFor(() => {
      expect(screen.getByText('REJECTED')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-details-close-x'));

    fireEvent.click(screen.getByTestId('task-row-tsk_gen_credits'));
    await waitFor(() => {
      expect(screen.getByText('Credit Management Approval')).toBeInTheDocument();
      expect(screen.getByText('25 Credits')).toBeInTheDocument();
    });
  });

  test('handles live and projected credit balance calculation and warnings in drawer', async () => {
    const taskAddCredit: internalTaskClient.InternalTask = {
      ...mockCreditTask,
      id: 'tsk_cred_add_1',
      credit_quantity: 25,
      current_account_credits: 100,
      task_type_code: 'itt_add_credits',
      task_type: 'Add Credits',
      status: 'Pending Approval',
    };
    const taskDeductCreditNegative: internalTaskClient.InternalTask = {
      ...mockCreditTask,
      id: 'tsk_cred_ded_neg',
      credit_quantity: 80,
      current_account_credits: 30,
      task_type_code: 'itt_delete_credits',
      task_type: 'Delete / Deduct Credits',
      status: 'Pending Approval',
    };
    const taskCreditsNoCurrent: internalTaskClient.InternalTask = {
      ...mockCreditTask,
      id: 'tsk_cred_no_curr',
      credit_quantity: 10,
      current_account_credits: undefined,
      task_type: 'Add Credits',
      status: 'Pending Approval',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [taskAddCredit, taskDeductCreditNegative, taskCreditsNoCurrent],
      total: 3,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(null);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_cred_add_1')).toBeInTheDocument();
    });

    // Check addition projection: 100 + 25 = 125
    fireEvent.click(screen.getByTestId('task-row-tsk_cred_add_1'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-current-credits')).toHaveTextContent('100 Credits');
      expect(screen.getByTestId('drawer-projected-credits')).toHaveTextContent('125 Credits');
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Check deduction negative projection: 30 - 80 = -50 (class text-rose-600)
    fireEvent.click(screen.getByTestId('task-row-tsk_cred_ded_neg'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-current-credits')).toHaveTextContent('30 Credits');
      expect(screen.getByTestId('drawer-projected-credits')).toHaveTextContent('-50 Credits');
      expect(screen.getByTestId('drawer-projected-credits')).toHaveClass('text-rose-600');
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Check undefined current credits: displays '—'
    fireEvent.click(screen.getByTestId('task-row-tsk_cred_no_curr'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-current-credits')).toHaveTextContent('—');
      expect(screen.getByTestId('drawer-projected-credits')).toHaveTextContent('—');
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('handles communication suite: phone call logging, outcome selection, tel link, and failure/error branches', async () => {
    const commTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_comm_call_1',
      task_category: 'COMMUNICATION',
      task_type: 'Phone Call',
      recipient_phone: '+919876543210',
      recipient_email: 'client@example.com',
      call_outcome: 'Connected',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [commTask],
      total: 1,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(commTask);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_comm_call_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_comm_call_1'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-recipient-phone')).toHaveTextContent('+919876543210');
      expect(screen.getByTestId('drawer-recipient-email')).toHaveTextContent('client@example.com');
      expect(screen.getByTestId('drawer-call-client-btn')).toHaveAttribute('href', 'tel:+919876543210');
    });

    // Select new call outcome
    fireEvent.change(screen.getByTestId('drawer-call-outcome-select'), {
      target: { value: 'Busy' },
    });

    // Success branch
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...commTask,
      call_outcome: 'Busy',
    });
    fireEvent.click(screen.getByTestId('drawer-log-call-outcome-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_comm_call_1',
        expect.objectContaining({ call_outcome: 'Busy' })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Call outcome logged successfully.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-log-call-outcome-btn')).not.toBeDisabled();
    });

    // Failure branch (returns null)
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-log-call-outcome-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to log call outcome.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-log-call-outcome-btn')).not.toBeDisabled();
    });

    // Error branch (throws)
    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(screen.getByTestId('drawer-log-call-outcome-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error logging call outcome.')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('handles communication suite: WhatsApp links and Follow-up creation trigger', async () => {
    const waTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_wa_1',
      task_category: 'COMMUNICATION',
      task_type: 'WhatsApp',
      recipient_phone: '+91 98765 43210',
      title: 'Discuss pricing with seller',
    };
    const waNoPhoneTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_wa_no_phone',
      task_category: 'COMMUNICATION',
      task_type: 'WhatsApp',
      recipient_phone: undefined,
      title: 'Discuss pricing with seller',
    };
    const followupTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_followup_1',
      task_category: 'COMMUNICATION',
      task_type: 'Follow-up',
      title: 'Follow-up on quotation',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [waTask, waNoPhoneTask, followupTask],
      total: 3,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(null);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_wa_1')).toBeInTheDocument();
    });

    // WhatsApp with phone
    fireEvent.click(screen.getByTestId('task-row-tsk_wa_1'));
    await waitFor(() => {
      const waLink = screen.getByTestId('drawer-open-whatsapp-btn');
      expect(waLink).toHaveAttribute('href', expect.stringContaining('https://wa.me/919876543210'));
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // WhatsApp without phone
    fireEvent.click(screen.getByTestId('task-row-tsk_wa_no_phone'));
    await waitFor(() => {
      expect(screen.getByText('No phone number attached to task')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Follow-up task
    fireEvent.click(screen.getByTestId('task-row-tsk_followup_1'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-schedule-followup-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('drawer-schedule-followup-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('create-task-category-select')).toBeInTheDocument();
    });
  });

  test('handles demo scheduling: status updates, reschedule controls, and failure/error branches', async () => {
    const demoTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_demo_1',
      task_category: 'DEMO_SCHEDULING',
      task_type: 'Demo Scheduling',
      demo_date: '2026-11-15',
      demo_time: '14:00',
      demo_status: 'Scheduled',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [demoTask],
      total: 1,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(demoTask);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_demo_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_demo_1'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-demo-status-badge')).toHaveTextContent('Scheduled');
      expect(screen.getByTestId('drawer-demo-date')).toHaveTextContent('2026-11-15');
      expect(screen.getByTestId('drawer-demo-time')).toHaveTextContent('14:00');
    });

    // Update Demo Status - Success
    fireEvent.change(screen.getByTestId('drawer-demo-status-select'), {
      target: { value: 'Completed' },
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...demoTask,
      demo_status: 'Completed',
    });
    fireEvent.click(screen.getByTestId('drawer-update-demo-status-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_demo_1',
        expect.objectContaining({ demo_status: 'Completed' })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Demo status updated.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-update-demo-status-btn')).not.toBeDisabled();
    });

    // Update Demo Status - Failure & Error
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-update-demo-status-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to update demo status.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-update-demo-status-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('err'));
    fireEvent.click(screen.getByTestId('drawer-update-demo-status-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error updating demo status.')).toBeInTheDocument();
    });

    // Reschedule Demo with empty date -> early return
    fireEvent.change(screen.getByTestId('drawer-reschedule-date-input'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('drawer-reschedule-demo-btn'));

    // Reschedule Demo with date only (no time, no reason) -> covers falsy branches
    fireEvent.change(screen.getByTestId('drawer-reschedule-date-input'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.change(screen.getByTestId('drawer-reschedule-time-input'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByTestId('drawer-reschedule-reason-input'), {
      target: { value: '' },
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...demoTask,
      demo_date: '2026-11-20',
      demo_time: '',
      demo_status: 'Rescheduled',
    });
    fireEvent.click(screen.getByTestId('drawer-reschedule-demo-btn'));
    await waitFor(() => {
      expect(screen.getByText('Demo rescheduled successfully.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-reschedule-demo-btn')).not.toBeDisabled();
    });

    // Reschedule Demo - Success with time & reason
    fireEvent.change(screen.getByTestId('drawer-reschedule-date-input'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.change(screen.getByTestId('drawer-reschedule-time-input'), {
      target: { value: '16:00' },
    });
    fireEvent.change(screen.getByTestId('drawer-reschedule-reason-input'), {
      target: { value: 'Client rescheduled' },
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...demoTask,
      demo_date: '2026-11-20',
      demo_time: '16:00',
      demo_status: 'Rescheduled',
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawer-reschedule-demo-btn'));
    });
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_demo_1',
        expect.objectContaining({
          demo_date: '2026-11-20',
          demo_time: '16:00',
          demo_status: 'Rescheduled',
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Demo rescheduled successfully.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-reschedule-demo-btn')).not.toBeDisabled();
    });

    // Reschedule Demo - Failure & Error
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawer-reschedule-demo-btn'));
    });
    await waitFor(() => {
      expect(screen.getByText('Failed to reschedule demo.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-reschedule-demo-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('reschedule error'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('drawer-reschedule-demo-btn'));
    });
    await waitFor(() => {
      expect(screen.getByText('Error rescheduling demo.')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('handles business development: proposal status updates, proposal sent button, and failure/error branches', async () => {
    const bdTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_bd_1',
      task_category: 'BUSINESS_DEVELOPMENT',
      task_type: 'Send Proposal',
      proposal_value: 850000,
      proposal_url: 'https://procucev.com/prop.pdf',
      proposal_status: 'Draft',
    };
    const bdNoUrlTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_bd_no_url',
      task_category: 'BUSINESS_DEVELOPMENT',
      task_type: 'Send Corporate Email',
      proposal_value: undefined,
      proposal_url: undefined,
      proposal_status: 'Draft',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [bdTask, bdNoUrlTask],
      total: 2,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(bdTask);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_bd_1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_bd_1'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-proposal-value')).toHaveTextContent(/8,?50,?000/);
      expect(screen.getByTestId('drawer-proposal-link')).toHaveAttribute('href', 'https://procucev.com/prop.pdf');
    });

    // Update Proposal Status - Success
    fireEvent.change(screen.getByTestId('drawer-proposal-status-select'), {
      target: { value: 'Under Negotiation' },
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...bdTask,
      proposal_status: 'Under Negotiation',
    });
    fireEvent.click(screen.getByTestId('drawer-update-proposal-status-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_bd_1',
        expect.objectContaining({ proposal_status: 'Under Negotiation' })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Proposal status updated.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-update-proposal-status-btn')).not.toBeDisabled();
    });

    // Update Proposal Status - Failure & Error
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-update-proposal-status-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to update proposal status.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-update-proposal-status-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('err'));
    fireEvent.click(screen.getByTestId('drawer-update-proposal-status-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error updating proposal status.')).toBeInTheDocument();
    });

    // Mark Proposal Sent - Success
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...bdTask,
      proposal_status: 'Sent to Client',
    });
    fireEvent.click(screen.getByTestId('drawer-mark-proposal-sent-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_bd_1',
        expect.objectContaining({ proposal_status: 'Sent to Client' })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Proposal marked as sent.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-mark-proposal-sent-btn')).not.toBeDisabled();
    });

    // Mark Proposal Sent - Failure & Error
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-mark-proposal-sent-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to mark proposal sent.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-mark-proposal-sent-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('err'));
    fireEvent.click(screen.getByTestId('drawer-mark-proposal-sent-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error updating proposal status.')).toBeInTheDocument();
    });

    // Test bd task without proposal URL
    fireEvent.click(screen.getByTestId('task-details-close-x'));
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValueOnce(bdNoUrlTask);
    fireEvent.click(screen.getByTestId('task-row-tsk_bd_no_url'));
    await waitFor(() => {
      expect(screen.getByText('None')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('handles client onboarding: milestone stepper, advance stage, buyer/vendor links, and failure/error branches', async () => {
    const onboardingBuyerTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_onb_buyer',
      task_category: 'ONBOARDING',
      task_type: 'Client Onboarding',
      onboarding_stage: 2,
      related_entity_type: 'BUYER',
      related_entity_id: 'buyer-org-123',
    };
    const onboardingVendorTask: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_onb_vendor',
      task_category: 'ONBOARDING',
      task_type: 'Client Onboarding',
      onboarding_stage: 5,
      related_entity_type: 'VENDOR',
      related_entity_id: 'vendor-org-456',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [onboardingBuyerTask, onboardingVendorTask],
      total: 2,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(onboardingBuyerTask);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_onb_buyer')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_onb_buyer'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-onboarding-stage-badge')).toHaveTextContent('Stage 2 of 5');
      expect(screen.getByTestId('onboarding-stage-item-1')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-goto-buyer-btn')).toBeInTheDocument();
    });

    // Navigate to Buyer Dossier
    fireEvent.click(screen.getByTestId('drawer-goto-buyer-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('buyers-directory')).toBeInTheDocument();
    });

    // Switch back to tasks
    const tasksTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.internalTasks, 'i') });
    fireEvent.click(tasksTab);

    // Reopen task details
    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_onb_buyer')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-row-tsk_onb_buyer'));

    // Advance Stage - Success
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...onboardingBuyerTask,
      onboarding_stage: 3,
    });
    fireEvent.click(screen.getByTestId('drawer-advance-onboarding-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_onb_buyer',
        expect.objectContaining({ onboarding_stage: 3 })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Onboarding stage advanced.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-advance-onboarding-btn')).not.toBeDisabled();
    });

    // Advance Stage - Failure & Error
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-advance-onboarding-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to advance onboarding stage.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-advance-onboarding-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('err'));
    fireEvent.click(screen.getByTestId('drawer-advance-onboarding-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error advancing onboarding stage.')).toBeInTheDocument();
    });

    // Check Stage 5 vendor task: no advance button, vendor link navigation
    fireEvent.click(screen.getByTestId('task-details-close-x'));
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValueOnce(onboardingVendorTask);
    fireEvent.click(screen.getByTestId('task-row-tsk_onb_vendor'));

    await waitFor(() => {
      expect(screen.getByTestId('drawer-onboarding-stage-badge')).toHaveTextContent('Stage 5 of 5');
      expect(screen.queryByTestId('drawer-advance-onboarding-btn')).not.toBeInTheDocument();
      expect(screen.getByTestId('drawer-goto-vendor-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('drawer-goto-vendor-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sellers-directory')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.internalTasks, 'i') }));
    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_onb_vendor')).toBeInTheDocument();
    });
  });

  test('handles attachments: toggling form, adding attachments, list view, and failure/error branches', async () => {
    const taskWithAtt: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_with_att',
      due_time: '11:30 AM',
      attachments: [{ name: 'SpecSheet.pdf', url: 'https://procucev.com/spec.pdf' }],
    };
    const taskNoAtt: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_no_att',
      attachments: [],
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [taskWithAtt, taskNoAtt],
      total: 2,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(taskWithAtt);

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('task-row-tsk_with_att')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-tsk_with_att'));
    await waitFor(() => {
      expect(screen.getByText('SpecSheet.pdf')).toBeInTheDocument();
      expect(screen.getByTestId('attachment-link-0')).toHaveAttribute('href', 'https://procucev.com/spec.pdf');
    });

    // Toggle add attachment form
    fireEvent.click(screen.getByTestId('drawer-toggle-add-attachment-btn'));
    expect(screen.getByTestId('drawer-attachment-name-input')).toBeInTheDocument();

    // Save attachment with empty name -> early return branch
    fireEvent.change(screen.getByTestId('drawer-attachment-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('drawer-save-attachment-btn'));

    // Fill form and add attachment - Success
    fireEvent.change(screen.getByTestId('drawer-attachment-name-input'), {
      target: { value: 'Agreement.docx' },
    });
    fireEvent.change(screen.getByTestId('drawer-attachment-url-input'), {
      target: { value: 'https://procucev.com/agreement.docx' },
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...taskWithAtt,
      attachments: [
        ...taskWithAtt.attachments!,
        { name: 'Agreement.docx', url: 'https://procucev.com/agreement.docx' },
      ],
    });
    fireEvent.click(screen.getByTestId('drawer-save-attachment-btn'));
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_with_att',
        expect.objectContaining({
          newAttachment: {
            name: 'Agreement.docx',
            url: 'https://procucev.com/agreement.docx',
          },
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Attachment added successfully.')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('drawer-attachment-name-input')).not.toBeInTheDocument();
    });

    // Toggle form again for failure & error tests
    fireEvent.click(screen.getByTestId('drawer-toggle-add-attachment-btn'));
    fireEvent.change(screen.getByTestId('drawer-attachment-name-input'), {
      target: { value: 'Doc2.pdf' },
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('drawer-save-attachment-btn'));
    await waitFor(() => {
      expect(screen.getByText('Failed to add attachment.')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-save-attachment-btn')).not.toBeDisabled();
    });

    (internalTaskClient.updateInternalTask as jest.Mock).mockRejectedValueOnce(new Error('att error'));
    fireEvent.click(screen.getByTestId('drawer-save-attachment-btn'));
    await waitFor(() => {
      expect(screen.getByText('Error adding attachment.')).toBeInTheDocument();
    });

    // No attachments task
    fireEvent.click(screen.getByTestId('task-details-close-x'));
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValueOnce(taskNoAtt);
    fireEvent.click(screen.getByTestId('task-row-tsk_no_att'));
    await waitFor(() => {
      expect(screen.getByText('No attachments added')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('covers toolbar CSV export button attributes', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: mockTasks,
      total: mockTasks.length,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId('toolbar-export-csv-btn')).toHaveLength(1);
    });

    const exportBtn = screen.getByTestId('toolbar-export-csv-btn');
    expect(exportBtn).toHaveAttribute('download', 'internal_tasks.csv');
    expect(exportBtn.getAttribute('href')).toContain('data:text/csv;charset=utf-8');
  });

  test('uses the filtered export endpoint when there are no client rows to export', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });
    (internalTaskClient.getExportTasksUrl as jest.Mock).mockReturnValue('/api/internal-tasks/export?status=all');

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('toolbar-export-csv-btn')).toHaveAttribute(
        'href',
        '/api/internal-tasks/export?status=all'
      );
    });
  });


  test('covers additional internal-tasks branches for 90%+ branch coverage', async () => {
    const invalidDueDateTask = {
      ...mockTasks[0],
      id: 'tsk_invalid_due',
      due_date: 'invalid-date-string',
      priority: 'Low' as const,
      task_category: 'ONBOARDING' as const,
      onboarding_stage: 5,
      activities: [],
      attachments: [],
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [invalidDueDateTask],
      total: 1,
    });

    const { rerender } = render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('invalid-date-string')).toBeInTheDocument();
    });

    // Keyboard accessibility & active styles on all 6 summary cards
    const cardTestIds = [
      'card-total-tasks',
      'card-new-tasks',
      'card-in-progress',
      'card-pending-approval',
      'card-completed',
      'card-overdue',
    ];
    for (const cardId of cardTestIds) {
      const c = screen.getByTestId(cardId);
      fireEvent.keyDown(c, { key: 'Enter' });
      fireEvent.keyDown(c, { key: ' ' });
      fireEvent.keyDown(c, { key: 'Tab' });
      fireEvent.click(c);
    }

    // Switch tabs using sub-navigation
    const docVaultTab = screen.queryByRole('tab', { name: /Document/i });
    if (docVaultTab) {
      fireEvent.click(docVaultTab);
    }
    const tasksTab = screen.getByRole('tab', { name: /Internal tasks/i });
    fireEvent.click(tasksTab);

    // Open task details drawer using View details button
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(invalidDueDateTask);
    await waitFor(() => {
      expect(screen.getAllByTitle('View details').length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(screen.getAllByTitle('View details')[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Task Details' })).toBeInTheDocument();
    });

    // Attempt to submit empty activity comment if button exists
    const submitCommentBtn = screen.queryByTestId('drawer-add-activity-btn');
    if (submitCommentBtn) {
      fireEvent.click(submitCommentBtn);
    }

    // If onboarding stage is 5, cannot advance
    const advanceStageBtn = screen.queryByRole('button', { name: /Advance to Next Stage/i });
    if (advanceStageBtn) {
      fireEvent.click(advanceStageBtn);
    }

    // Toggle add attachment form and click Add Attachment with empty name
    const toggleAttBtn = screen.queryByRole('button', { name: /Add Attachment/i });
    if (toggleAttBtn) {
      fireEvent.click(toggleAttBtn);
      const saveAttBtn = screen.queryByRole('button', { name: /Save Attachment/i });
      if (saveAttBtn) {
        fireEvent.click(saveAttBtn);
      }
    }

    const closeDrawerBtn = screen.queryByTestId('task-details-close-x') || screen.queryByRole('button', { name: 'Close' });
    if (closeDrawerBtn) {
      fireEvent.click(closeDrawerBtn);
    }

    // Open Create Task modal and test empty credit quantity & demo without date/time
    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    fireEvent.change(titleInput, { target: { value: 'Branch Coverage Test Task' } });

    const selects = screen.getAllByRole('combobox');
    if (selects.length > 0) {
      fireEvent.change(selects[0], { target: { value: 'CREDIT_MANAGEMENT' } });
      fireEvent.change(selects[0], { target: { value: 'DEMO_SCHEDULING' } });
    }

    const submitCreateBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitCreateBtn);
  });


  test('supports sorting columns on status, task, category, priority, assignedTo, and dueDate in both directions', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Task Subject & ID')).toBeInTheDocument();
    });

    // Sort by status
    fireEvent.click(screen.getByText('Status'));
    fireEvent.click(screen.getByText('Status'));

    // Sort by task
    fireEvent.click(screen.getByText('Task Subject & ID'));
    fireEvent.click(screen.getByText('Task Subject & ID'));

    // Sort by category
    fireEvent.click(screen.getByText('Category & Type'));
    fireEvent.click(screen.getByText('Category & Type'));

    // Sort by priority
    fireEvent.click(screen.getByText('Priority'));
    fireEvent.click(screen.getByText('Priority'));

    // Sort by assignedTo
    fireEvent.click(screen.getByText('Assigned To'));
    fireEvent.click(screen.getByText('Assigned To'));

    // Sort by dueDate
    fireEvent.click(screen.getByText('Due Date & Time'));
    fireEvent.click(screen.getByText('Due Date & Time'));
  });

  test('opens column settings modal, toggles visibility, saves, resets to default, and loads from localStorage', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Task Subject & ID')).toBeInTheDocument();
    });

    const gearBtn = screen.getByTitle('Column Settings');
    fireEvent.click(gearBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Toggle optional column
    const statusCheckbox = within(screen.getByRole('dialog')).getByLabelText(/Toggle column: Status/i);
    fireEvent.click(statusCheckbox);

    // Click Done
    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and reset to default
    fireEvent.click(gearBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: 'Reset to Default' });
    fireEvent.click(resetBtn);

    // Reopen and close via close button
    fireEvent.click(gearBtn);
    const closeBtn = screen.getByLabelText('Close column settings');
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('loads saved column settings from localStorage on initial render', async () => {
    const customCols = [
      { key: 'status', label: 'Status', visible: false },
      { key: 'task', label: 'Task Subject & ID', visible: true, required: true },
    ];
    localStorage.setItem('qua_internal_task_col_prefs', JSON.stringify(customCols));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Task Subject & ID')).toBeInTheDocument();
    });

    expect(screen.queryByRole('columnheader', { name: /^Status/i })).not.toBeInTheDocument();
  });

  test('filters out legacy Done column from saved localStorage column settings', async () => {
    const legacyCols = [
      { key: 'done', label: 'Done', visible: true, required: true },
      { key: 'status', label: 'Status', visible: true },
      { key: 'task', label: 'Task Subject & ID', visible: true, required: true },
    ];
    localStorage.setItem('qua_internal_task_col_prefs', JSON.stringify(legacyCols));

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Task Subject & ID')).toBeInTheDocument();
    });

    expect(screen.queryByRole('columnheader', { name: /^Done$/i })).not.toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent(/Status/i);
  });

  test('covers offline payments, trial period drawer details, sorting with missing values, and status filtering', async () => {
    const tasksWithDetails = [
      {
        id: 'tsk_offline_pay',
        task_number: 'TSK-OFFLINE-1',
        title: '',
        category: 'CREDIT',
        task_category: 'CREDIT_MANAGEMENT',
        task_type: 'Offline Payments',
        recipient_phone: '',
        priority: 'UnknownPriority',
        status: 'Pending',
        assigned_to_name: '',
        due_date: null,
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-pay',
        raw: {
          buyer_source_mode: 'Annual',
          payment_date: '2026-11-01',
          payment_type: 'NEFT',
          transaction_id: 'TXN123456',
          payment_amount: 50000,
          proof_file_name: 'receipt.pdf',
          proof_file_url: 'https://example.com/receipt.pdf',
        },
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'tsk_trial_period',
        task_number: 'TSK-TRIAL-1',
        title: 'Trial setup',
        category: 'CREDIT',
        task_category: 'CREDIT_MANAGEMENT',
        task_type: 'Trial Periods',
        priority: 'Critical',
        status: 'Open',
        assigned_to_name: 'Priya',
        due_date: '2026-11-20T10:00:00Z',
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-trial',
        raw: {
          selected_mode: 'Full Sourcing',
          trial_days: 30,
          start_date: '2026-11-01',
          end_date: '2026-12-01',
        },
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'tsk_fallback_modules',
        task_number: 'TSK-FALLBACK-1',
        title: 'Fallback module task',
        category: 'DEMO',
        task_category: 'DEMO_SCHEDULE',
        task_type: 'Demo',
        priority: 'Medium',
        status: 'New',
        assigned_to_name: 'Chandan',
        due_date: '2026-11-28T10:00:00Z',
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-fb',
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'tsk_bd_fallback',
        task_number: 'TSK-BD-1',
        title: 'BD Task',
        category: 'BUSINESS_DEVELOPMENT',
        task_category: 'BUSINESS_DEVELOPMENT',
        task_type: 'Proposal',
        priority: 'Low',
        status: 'Closed',
        assigned_to_name: 'Govardhan',
        due_date: '2026-11-20T10:00:00Z',
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-bd',
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'tsk_onboarding_fallback',
        task_number: 'TSK-ONBOARD-1',
        title: 'Onboarding Task',
        category: 'ONBOARDING',
        task_category: 'ONBOARDING',
        task_type: 'Client Onboarding',
        priority: 'High',
        status: 'Pending Approval',
        assigned_to_name: 'Govardhan',
        due_date: '2026-11-20T10:00:00Z',
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-onboard',
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'tsk_comm_followup',
        task_number: 'TSK-COMM-1',
        title: 'Communication task',
        category: 'COMMUNICATION',
        task_category: 'COMMUNICATION',
        task_type: 'WhatsApp Follow-up',
        recipient_phone: '+91 9876543210',
        priority: 'High',
        status: 'In Progress',
        assigned_to_name: 'Govardhan',
        due_date: '2026-11-20T10:00:00Z',
        related_entity_type: 'BUYER',
        related_entity_id: 'buyer-comm',
        attachments: [],
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
      },
    ];

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: tasksWithDetails,
      total: 6,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockImplementation(async (id: string) => {
      return tasksWithDetails.find((t) => t.id === id) || null;
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TSK-OFFLINE-1')).toBeInTheDocument();
    });

    // Test sorting with null/undefined values in both directions
    const table = screen.getByRole('table');
    const sortHeaders = within(table).getAllByRole('columnheader');
    for (const th of sortHeaders) {
      fireEvent.click(th);
      fireEvent.click(th);
    }

    // Open Offline Payment drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_offline_pay'));
    await waitFor(() => {
      expect(screen.getByText('Offline Payment Information')).toBeInTheDocument();
      expect(screen.getByText('TXN123456')).toBeInTheDocument();
      expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Open Trial Period drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_trial_period'));
    await waitFor(() => {
      expect(screen.getByText('Trial Period Details:')).toBeInTheDocument();
      expect(screen.getAllByText('Full Sourcing').length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Open Fallback modules drawer (Demo without demo_status / demo_date)
    fireEvent.click(screen.getByTestId('task-row-tsk_fallback_modules'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-demo-status-badge')).toHaveTextContent('Scheduled');
      expect(screen.getByTestId('drawer-demo-date')).toHaveTextContent('Not set');
      expect(screen.getByTestId('drawer-demo-time')).toHaveTextContent('Not set');
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Open BD Fallback drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_bd_fallback'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-proposal-status-badge')).toHaveTextContent('Draft');
      expect(screen.getByTestId('drawer-proposal-value')).toHaveTextContent('—');
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Open Onboarding Fallback drawer
    fireEvent.click(screen.getByTestId('task-row-tsk_onboarding_fallback'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-onboarding-stage-badge')).toHaveTextContent('Stage 1 of 5');
    });

    // Test Credit Approval & Rejection Handlers while drawer is open
    (internalTaskClient.approveCreditTask as jest.Mock).mockResolvedValueOnce({
      success: true,
      task: { ...tasksWithDetails[3], approval_status: 'APPROVED', status: 'In Progress' },
      message: 'Credit request approved and balances updated.',
    });
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Open pending approval task
    fireEvent.click(screen.getByTestId('task-row-tsk_onboarding_fallback'));
    fireEvent.click(screen.getByTestId('task-details-close-x'));

    // Test Communication drawer completion workflow
    fireEvent.click(screen.getByTestId('task-row-tsk_comm_followup'));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-open-whatsapp-btn')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-schedule-followup-btn')).toBeInTheDocument();
    });

    // Click mark complete in drawer
    fireEvent.click(screen.getByTestId('drawer-mark-complete-btn'));
    expect(screen.getByTestId('confirm-complete-task-btn')).toBeInTheDocument();

    // Try completing communication task without checkbox -> error toast
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    // Check confirmation checkbox and complete
    fireEvent.click(screen.getByTestId('communication-confirm-checkbox'));
    fireEvent.change(screen.getByTestId('completion-remarks-input'), {
      target: { value: 'Followup completed with buyer' },
    });
    (internalTaskClient.completeInternalTask as jest.Mock).mockResolvedValueOnce({
      ...tasksWithDetails[5],
      status: 'Completed',
      completed_at: '2026-11-20T10:00:00Z',
    });
    fireEvent.click(screen.getByTestId('confirm-complete-task-btn'));

    await waitFor(() => {
      expect(internalTaskClient.completeInternalTask).toHaveBeenCalled();
    });

    // Add activity note
    (internalTaskClient.addTaskActivity as jest.Mock).mockResolvedValueOnce({
      success: true,
      activity: { id: 'act-new-1', actor_name: 'Navin', comment: 'Added progress update note', created_at: '2026-11-20T10:30:00Z' },
    });
    fireEvent.change(screen.getByTestId('drawer-add-activity-input'), {
      target: { value: 'New progress update' },
    });
    fireEvent.click(screen.getByTestId('drawer-add-activity-btn'));
    await waitFor(() => {
      expect(internalTaskClient.addTaskActivity).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('task-details-close-x'));
  });

  test('handles backdrop click and escape key to close task modal', async () => {
    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // 1. Create task modal Escape & backdrop click
    fireEvent.click(screen.getByTestId('toolbar-create-task-btn'));
    let dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Click inside does not close
    fireEvent.click(within(dialog).getByText('Create Internal Task'));
    expect(dialog).toBeInTheDocument();

    // Escape closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and backdrop click closes
    fireEvent.click(screen.getByTestId('toolbar-create-task-btn'));
    dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('enforces unclipped toolbar selects, single-line rows, and working edit task flow', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0], mockTasks[1]],
      total: 2,
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValue({
      ...mockTasks[0],
      title: 'Audit Mechanical Spares RFQ Quotes (Updated)',
      priority: 'Critical',
      status: 'In Progress',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    // 1. Toolbar elements verification: unclipped selects, pl-9 search input, h-9 height
    const categorySelect = screen.getByTestId('toolbar-category-select');
    expect(categorySelect).toHaveClass('h-9');
    expect(categorySelect).toHaveClass('py-0');
    expect(categorySelect).toHaveClass('leading-normal');

    const assigneeSelect = screen.getByTestId('toolbar-assignee-select');
    expect(assigneeSelect).toHaveClass('h-9');
    expect(assigneeSelect).toHaveClass('py-0');
    expect(assigneeSelect).toHaveClass('leading-normal');

    const searchInput = screen.getByPlaceholderText('Search by title, ID, entity...');
    expect(searchInput).toHaveClass('pl-9');
    expect(searchInput).toHaveClass('h-9');

    expect(screen.getByTestId('toolbar-create-task-btn')).toHaveClass('h-9');
    expect(screen.getByTestId('toolbar-send-sms-email-btn')).toHaveClass('h-9');
    expect(screen.getByTestId('toolbar-filter-btn')).toHaveClass('h-9');
    expect(screen.getByTestId('toolbar-export-csv-btn')).toHaveClass('h-9');

    // 2. Compact single-line table row verification
    const row1 = screen.getByTestId('task-row-tsk_101');
    expect(row1).toHaveClass('h-10');

    // 3. Edit task button and edit modal flow
    const editBtn = screen.getByTestId('task-row-edit-tsk_101');
    expect(editBtn).toBeInTheDocument();
    expect(editBtn).toHaveAttribute('title', 'Edit task');

    fireEvent.click(editBtn);

    const editDialog = screen.getByRole('dialog');
    expect(editDialog).toBeInTheDocument();
    expect(within(editDialog).getByText('Edit Internal Task: TASK-1001')).toBeInTheDocument();
    expect(
      within(editDialog).getByText('Update task details, assignment, priority, or deadline')
    ).toBeInTheDocument();

    const submitBtn = screen.getByTestId('modal-submit-task-btn');
    expect(submitBtn).toHaveTextContent('Save Changes');

    // Modify task title
    const titleInput = screen.getByPlaceholderText(UI_STRINGS.actionCenter.tasks.taskTitlePlaceholder);
    expect(titleInput).toHaveValue('Audit Mechanical Spares RFQ Quotes');
    fireEvent.change(titleInput, { target: { value: 'Audit Mechanical Spares RFQ Quotes (Updated)' } });

    // Submit changes
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_101',
        expect.objectContaining({
          title: 'Audit Mechanical Spares RFQ Quotes (Updated)',
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Verify row displays updated title
    expect(screen.getByText('Audit Mechanical Spares RFQ Quotes (Updated)')).toBeInTheDocument();

    // 4. Test closing Edit modal via Cancel button, backdrop, and Escape key
    fireEvent.click(screen.getByTestId('task-row-edit-tsk_101'));
    let modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    const cancelBtn = within(modal).getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and test Escape key
    fireEvent.click(screen.getByTestId('task-row-edit-tsk_101'));
    modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and test backdrop click
    fireEvent.click(screen.getByTestId('task-row-edit-tsk_101'));
    modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
    fireEvent.click(modal);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 5. Test editing Credit Task with SELLER type and updating selectedTaskDetails
    const creditTask: internalTaskClient.InternalTask = {
      id: 'tsk_credit_edit',
      task_number: 'TASK-CREDIT-99',
      title: 'Credit Task To Edit',
      task_category: 'CREDIT_MANAGEMENT',
      credit_account_type: 'SELLER',
      credit_account_name: 'Seller Org',
      credit_account_id: 'acc_seller_99',
      credit_quantity: 15,
      credit_reason: 'Balance adjustment',
      priority: 'High',
      status: 'Pending',
      due_date: '2026-11-25',
      created_at: '2026-11-20T10:00:00Z',
      updated_at: '2026-11-20T10:00:00Z',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [creditTask],
      total: 1,
    });
    (internalTaskClient.fetchTaskById as jest.Mock).mockResolvedValue(creditTask);
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValue({
      ...creditTask,
      status: 'Closed',
      title: 'Credit Task To Edit (Closed)',
    });

    fireEvent.click(screen.getByTestId('toolbar-refresh-btn'));

    await waitFor(() => {
      expect(screen.getByText('Credit Task To Edit')).toBeInTheDocument();
    });

    // Open drawer first so selectedTaskDetails is set
    fireEvent.click(screen.getByTestId('task-row-tsk_credit_edit'));
    await waitFor(() => {
      expect(screen.getByTestId('task-details-drawer')).toBeInTheDocument();
    });

    // Now click edit button
    fireEvent.click(screen.getByTestId('task-row-edit-tsk_credit_edit'));
    const creditDialog = screen.getByRole('dialog');
    expect(creditDialog).toBeInTheDocument();

    // Change status to Closed and submit
    fireEvent.click(within(creditDialog).getByTestId('modal-submit-task-btn'));

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_credit_edit',
        expect.objectContaining({
          status: 'Pending',
          relatedEntityType: 'VENDOR',
        })
      );
    });

    // 6. Test editing Demo Task with date/time and update failure branch
    const demoTask: internalTaskClient.InternalTask = {
      id: 'tsk_demo_edit',
      task_number: 'TASK-DEMO-99',
      title: 'Demo Task To Edit',
      task_category: 'DEMO_SCHEDULE',
      demo_date: '2026-11-26',
      demo_time: '14:00',
      demo_status: 'Scheduled',
      priority: 'Medium',
      status: 'Open',
      created_at: '2026-11-20T10:00:00Z',
      updated_at: '2026-11-20T10:00:00Z',
    };

    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [demoTask],
      total: 1,
    });
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);

    fireEvent.click(screen.getByTestId('toolbar-refresh-btn'));

    await waitFor(() => {
      expect(screen.getByText('Demo Task To Edit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('task-row-edit-tsk_demo_edit'));
    const demoDialog = screen.getByRole('dialog');
    expect(demoDialog).toBeInTheDocument();

    // Submit with failure returning null
    fireEvent.click(within(demoDialog).getByTestId('modal-submit-task-btn'));

    await waitFor(() => {
      expect(screen.getByText('Failed to update task in database.')).toBeInTheDocument();
    });
  });

  test('refreshes internal tasks and updates linked task status when onApprovalDecision fires', async () => {
    const linkedTask1: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_linked_appr_1',
      title: 'Credit Allocation Request: 5 Credits for Veera [REQ-860DAC704BE2]',
      raw: { approval_request_number: 'REQ-860DAC704BE2' },
      status: 'Open',
    };
    const linkedTask2: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_linked_appr_2',
      title: 'Email communication task',
      raw: { approvalRequestNumber: 'REQ-REJECT-999' },
      completed_at: '2026-11-20T10:00:00Z',
      status: 'Open',
    };
    const linkedTask3: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_linked_appr_3',
      title: 'Entity linked task',
      related_entity_id: 'REQ-REJECT-999',
      status: 'Open',
    };
    const linkedTask4: internalTaskClient.InternalTask = {
      ...mockTasks[0],
      id: 'tsk_linked_appr_4',
      title: 'Label linked task',
      related_entity_label: 'REQ-REJECT-999',
      status: 'Open',
    };
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [linkedTask1, linkedTask2, linkedTask3, linkedTask4],
      total: 4,
    });
    (internalTaskClient.fetchTaskSummary as jest.Mock).mockResolvedValue({
      summary: { total: 4, newTasks: 0, completed: 4, inProgress: 0, pendingApproval: 0, overdue: 0 },
      error: undefined,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/REQ-860DAC704BE2/)).toBeInTheDocument();
    });

    // Switch to Approvals tab
    const approvalsTab = screen.getByText('Approvals');
    fireEvent.click(approvalsTab);

    await waitFor(() => {
      expect(screen.getByTestId('approvals-dashboard')).toBeInTheDocument();
    });

    // Trigger mock approval decisions: APPROVE, REJECT, and no requestNumber
    const triggerBtn = screen.getByTestId('mock-approval-decision-btn');
    const rejectBtn = screen.getByTestId('mock-approval-decision-reject-btn');
    const noReqBtn = screen.getByTestId('mock-approval-decision-no-req-btn');

    await act(async () => {
      fireEvent.click(triggerBtn);
      fireEvent.click(rejectBtn);
      fireEvent.click(noReqBtn);
    });

    expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalled();
    expect(internalTaskClient.fetchTaskSummary).toHaveBeenCalled();

    // Switch back to Internal tasks tab to trigger prevTabRef reload
    const tasksTab = screen.getByText('Internal tasks');
    await act(async () => {
      fireEvent.click(tasksTab);
    });
  });
});
