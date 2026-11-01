import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import InternalTasksDashboard from '@/app/category-manager/internal-tasks';
import CategoryManagerInternalTasksPage from '@/app/category-manager/internal-tasks/page';
import * as internalTaskClient from '@/lib/internalTaskClient';


import { UI_STRINGS } from '@/lib/uiStrings';

jest.setTimeout(35000);

jest.mock('@/app/category-manager/components/TicketsDashboard', () => ({
  TicketsDashboard: () => <div data-testid="tickets-dashboard">Tickets Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/components/ApprovalsDashboard', () => ({
  ApprovalsDashboard: () => <div data-testid="approvals-dashboard">Approvals Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/components/ScorecardDashboard', () => ({
  ScorecardDashboard: () => <div data-testid="scorecard-dashboard">Scorecard Dashboard Mock</div>,
}));
jest.mock('@/app/category-manager/buyers-directory', () => () => (
  <div data-testid="buyers-directory">Buyers Directory Mock</div>
));
jest.mock('@/app/category-manager/sellers-directory', () => () => (
  <div data-testid="sellers-directory">Sellers Directory Mock</div>
));
jest.mock('@/app/category-manager/components/RegistrationsDashboard', () => () => (
  <div data-testid="registrations-dashboard">Registrations Dashboard Mock</div>
));
jest.mock('@/app/category-manager/components/PaymentDuesDashboard', () => ({
  PaymentDuesDashboard: () => <div data-testid="payment-dues-dashboard">Payment Dues Dashboard Mock</div>,
}));
jest.mock('@/lib/ticketClient', () => ({
  fetchTicketSummary: jest.fn().mockResolvedValue({ total: 5, pending: 2, inProgress: 1, escalated: 1, completed: 1, criticalCount: 1 }),
}));
jest.mock('@/lib/approvalClient', () => ({
  fetchApprovalSummary: jest.fn().mockResolvedValue({ total: 4, pending: 1, approved: 2, rejected: 1 }),
}));

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
    fetchInternalAssignees: jest.fn().mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
      { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
      { id: 'exec-3', name: 'Prajwal K', role: 'Vendor Operations Lead' },
    ]),
    completeInternalTask: jest.fn(),
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
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
      { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
      { id: 'exec-3', name: 'Prajwal K', role: 'Vendor Operations Lead' },
    ]);
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
    (internalTaskClient.searchRelatedEntities as jest.Mock).mockResolvedValue([
      { id: 'rfq-1', label: 'RFQ262910743626 — Engineering Spares', entityType: 'RFQ' },
      { id: 'rfq-2', label: 'RFQ262910757432 — IT', entityType: 'RFQ' },
    ]);
  });

  test('renders top section controls: Search bar, Filter button, Export button, Create button', async () => {
    render(<InternalTasksDashboard />);

    expect(screen.getByText('Action Center')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search by title, task ID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filter/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Internal Task/i })).toBeInTheDocument();

    // Renders tasks from database
    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
      expect(screen.getByText('Verify Buyer Account Documents')).toBeInTheDocument();
    });

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Search by title, task ID/i);
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

    // Select Priority High
    const prioritySelect = screen.getByDisplayValue('All Priorities');
    fireEvent.change(prioritySelect, { target: { value: 'High' } });

    // Select Status Pending
    const statusSelect = screen.getByDisplayValue('All Statuses');
    fireEvent.change(statusSelect, { target: { value: 'Pending' } });

    // Select Related Module RFQ
    const moduleSelect = screen.getByDisplayValue('All Modules');
    fireEvent.change(moduleSelect, { target: { value: 'RFQ' } });

    // Select Task Type
    const typeSelect = screen.getByDisplayValue('All Task Types');
    fireEvent.change(typeSelect, { target: { value: 'itt_quotation_review' } });

    // Assigned User input
    const assignedInput = screen.getByPlaceholderText(/Search assignee name/i);
    fireEvent.change(assignedInput, { target: { value: 'Sudheer' } });

    // Date inputs
    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length >= 2) {
      fireEvent.change(dateInputs[0], { target: { value: '2026-10-01' } });
      fireEvent.change(dateInputs[1], { target: { value: '2026-11-30' } });
    }

    // Apply filters
    const applyBtn = screen.getByRole('button', { name: 'Apply Filters' });
    fireEvent.click(applyBtn);

    expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 'High',
        status: 'Pending',
        relatedEntityType: 'RFQ',
        taskTypeId: 'itt_quotation_review',
        assignedTo: 'Sudheer',
        dueFrom: '2026-10-01',
        dueTo: '2026-11-30',
      })
    );

    // Reopen drawer and reset
    fireEvent.click(filterBtn);
    const resetBtn = screen.getByRole('button', { name: 'Reset' });
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

  test('quick toggles task status via checkbox', async () => {
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValue({
      ...mockTasks[0],
      status: 'Completed',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(1);
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_101',
        expect.objectContaining({ status: 'Completed' })
      );
    });

    // Toggle completed task back to pending
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[1],
      status: 'Pending',
    });
    fireEvent.click(checkboxes[1]);
    await waitFor(() => {
      expect(internalTaskClient.updateInternalTask).toHaveBeenCalledWith(
        'tsk_102',
        expect.objectContaining({ status: 'Pending' })
      );
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

    const titleInput = screen.getByPlaceholderText(/e\.g\. Verify mechanical spare specifications/i);
    fireEvent.change(titleInput, { target: { value: 'Review New Solar Vendor Catalog' } });

    const descInput = screen.getByPlaceholderText(/Provide context/i);
    fireEvent.change(descInput, { target: { value: 'Check electrical compliance certificates' } });

    // Change Priority to High
    const prioritySelect = screen.getByDisplayValue('Medium');
    fireEvent.change(prioritySelect, { target: { value: 'High' } });

    // Change Status to In Progress
    const statusSelect = screen.getByDisplayValue('Pending');
    fireEvent.change(statusSelect, { target: { value: 'In Progress' } });

    // Change Assign To via custom assignee toggle
    const customAssigneeBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.customAssignee });
    fireEvent.click(customAssigneeBtn);
    const assignInput = screen.getByPlaceholderText(/e\.g\. Sudheer Kangala/i);
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

    // Select Task Type
    const taskTypeSelect = screen.getByDisplayValue(/Quotation Review/i);
    fireEvent.change(taskTypeSelect, { target: { value: 'itt_buyer_onboarding' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Review New Solar Vendor Catalog',
          description: 'Check electrical compliance certificates',
          priority: 'High',
          status: 'In Progress',
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

  test('allows creating custom task type inline inside modal', async () => {
    (internalTaskClient.createNewTaskType as jest.Mock).mockResolvedValue({
      id: 'itt_custom_solar',
      name: 'Solar Panel Compliance',
      default_module: 'RFQ',
    });
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValue({
      id: 'tsk_104',
      task_number: 'TASK-1004',
      title: 'Task with Custom Type',
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    const addCustomBtn = screen.getByRole('button', { name: /\+ Add Custom Task Type/i });
    fireEvent.click(addCustomBtn);

    const customTypeInput = screen.getByPlaceholderText(/e\.g\. GST Exemption Verification/i);
    fireEvent.change(customTypeInput, { target: { value: 'Solar Panel Compliance' } });

    const titleInput = screen.getByPlaceholderText(/e\.g\. Verify mechanical spare specifications/i);
    fireEvent.change(titleInput, { target: { value: 'Task with Custom Type' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createNewTaskType).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Solar Panel Compliance' })
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
    fireEvent.click(screen.getByText('Audit Mechanical Spares RFQ Quotes'));
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

    const titleInput = screen.getByPlaceholderText(/e\.g\. Verify mechanical spare specifications/i);
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

    // Verify task type dropdown exists and options are populated
    const taskTypeSelect = screen.getByDisplayValue(/Quotation Review/i);
    expect(taskTypeSelect).toBeInTheDocument();

    // Change task type select
    fireEvent.change(taskTypeSelect, { target: { value: 'itt_vendor_followup' } });

    // Toggle custom task type inline input
    const addCustomBtn = screen.getByRole('button', { name: /\+ Add Custom Task Type/i });
    fireEvent.click(addCustomBtn);

    expect(screen.getByPlaceholderText(/e\.g\. GST Exemption Verification/i)).toBeInTheDocument();

    // Toggle back to existing
    const chooseExistingBtn = screen.getByRole('button', { name: /Choose Existing/i });
    fireEvent.click(chooseExistingBtn);

    expect(screen.getByDisplayValue(/Vendor Follow-up/i)).toBeInTheDocument();
  });

  test('renders page wrapper CategoryManagerInternalTasksPage', async () => {
    render(<CategoryManagerInternalTasksPage />);
    expect(screen.getByText('Action Center')).toBeInTheDocument();
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
    (internalTaskClient.fetchTaskTypes as jest.Mock).mockResolvedValueOnce([]);

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
    fireEvent.change(assigneeSelect, { target: { value: 'Pavani' } });

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: 'Pavani' })
      );
      expect(internalTaskClient.fetchTaskSummary).toHaveBeenCalledWith({ assignedTo: 'Pavani' });
    });

    // Reset to all
    fireEvent.change(assigneeSelect, { target: { value: 'all' } });
    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: '' })
      );
    });
  });

  test('toggles My Tasks button on and off', async () => {
    (internalTaskClient.fetchInternalTasks as jest.Mock).mockResolvedValue({
      tasks: [mockTasks[0]],
      total: 1,
    });

    render(<InternalTasksDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
    });

    const myTasksBtn = screen.getByTestId('toolbar-my-tasks-btn');
    // Click on
    fireEvent.click(myTasksBtn);

    await waitFor(() => {
      expect(internalTaskClient.fetchInternalTasks).toHaveBeenCalledWith(
        expect.objectContaining({ assignedTo: 'Navin Chaudhary' })
      );
    });

    // Click off (toggles back to all)
    fireEvent.click(myTasksBtn);
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
    const titleInput = screen.getByPlaceholderText(/e.g. Verify mechanical spare specifications/i);
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
      status: 'Pending',
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
        expect.objectContaining({ status: 'Pending' })
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
        due_date: new Date().toISOString().slice(0, 10), // test Due Today (diffDays === 0)
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

    (fetchTicketSummary as jest.Mock).mockResolvedValueOnce(null);
    (fetchApprovalSummary as jest.Mock).mockResolvedValueOnce(null);
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValueOnce([]);
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

    // Dispatch event with null detail to cover customEvent.detail falsy branch
    act(() => {
      window.dispatchEvent(new CustomEvent('qua_payment_dues_updated', { detail: null }));
    });

    // Quick toggle task with no task_number to test fallback to task.id
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[0],
      id: 'tsk_no_num_1',
      task_number: '',
      status: 'Completed',
    });
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(screen.getByText(/tsk_no_num_1/i)).toBeInTheDocument();
    });

    // Quick toggle when updateInternalTask returns null
    (internalTaskClient.updateInternalTask as jest.Mock).mockResolvedValueOnce(null);
    fireEvent.click(checkboxes[1]);

    // Click My Tasks toggle when sessionUser is null to test fallback 'My Tasks'
    const myTasksBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tasks.myTasks });
    fireEvent.click(myTasksBtn);

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
  });

  test('covers assignee dropdown with member having no id and no role, plus custom type null return', async () => {
    (internalTaskClient.fetchInternalAssignees as jest.Mock).mockResolvedValueOnce([
      { id: '', name: 'Special Ops User', role: '' },
    ]);
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
    fireEvent.change(toolbarSelect, { target: { value: 'Special Ops User' } });

    // Open create modal
    const openCreateBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(openCreateBtn);

    // Select Special Ops User in modal dropdown
    const selectAssignee = screen.getByTestId('select-assignee-dropdown');
    fireEvent.change(selectAssignee, { target: { value: 'Special Ops User' } });

    // Select Unassigned (empty string)
    fireEvent.change(selectAssignee, { target: { value: '' } });

    // Switch to inline custom type mode and mock createNewTaskType returning null
    const addTypeBtn = screen.getByRole('button', { name: '+ Add Custom Task Type' });
    fireEvent.click(addTypeBtn);
    const customTypeInput = screen.getByPlaceholderText('e.g. GST Exemption Verification');
    fireEvent.change(customTypeInput, { target: { value: 'Experimental Type' } });

    (internalTaskClient.createNewTaskType as jest.Mock).mockResolvedValueOnce(null);
    (internalTaskClient.createInternalTask as jest.Mock).mockResolvedValueOnce({
      ...mockTasks[0],
      id: 'tsk_experimental',
    });

    const titleInput = screen.getByPlaceholderText(/e\.g\. Verify mechanical spare specifications/i);
    fireEvent.change(titleInput, { target: { value: 'Task with custom type failure' } });

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(internalTaskClient.createInternalTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Task with custom type failure',
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

});
