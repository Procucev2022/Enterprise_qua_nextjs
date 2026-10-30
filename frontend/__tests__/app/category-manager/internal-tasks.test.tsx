import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InternalTasksDashboard from '@/app/category-manager/internal-tasks';
import CategoryManagerInternalTasksPage from '@/app/category-manager/internal-tasks/page';
import * as internalTaskClient from '@/lib/internalTaskClient';


import { UI_STRINGS } from '@/lib/uiStrings';

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

    const prevBtn = screen.getByRole('button', { name: 'Previous' });
    fireEvent.click(prevBtn);
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
    if (closeDrawerBtn) fireEvent.click(closeDrawerBtn);
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

    // Change Assign To
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
    }
  });

  test('handles backdrop clicks and close icons for drawers', async () => {
    render(<InternalTasksDashboard />);

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

  test('renders page wrapper CategoryManagerInternalTasksPage', () => {
    render(<CategoryManagerInternalTasksPage />);
    expect(screen.getByText('Action Center')).toBeInTheDocument();
  });

  
  test('switches across Action Center sub-navigation tabs (tickets, approvals, scorecard, buyers, sellers, loans, tasks)', async () => {
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

    // 6. Switch to Loans tab (generic module placeholder)
    const loansTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.loans, 'i') });
    fireEvent.click(loansTab);
    expect(screen.getByText(/Integrated Action Center governance module for loans/i)).toBeInTheDocument();

    // 7. Switch back to Internal tasks tab
    const tasksTab = screen.getByRole('tab', { name: new RegExp(UI_STRINGS.actionCenter.tabs.internalTasks, 'i') });
    fireEvent.click(tasksTab);
    expect(screen.getByText('Audit Mechanical Spares RFQ Quotes')).toBeInTheDocument();
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

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    const submitBtn = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submitBtn);

    expect(internalTaskClient.createInternalTask).not.toHaveBeenCalled();
  });

  test('handles loadTaskTypes when fetchTaskTypes returns empty array', async () => {
    (internalTaskClient.fetchTaskTypes as jest.Mock).mockResolvedValueOnce([]);

    render(<InternalTasksDashboard />);

    const createBtn = screen.getByRole('button', { name: /Create Internal Task/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole('heading', { name: 'Create Internal Task' })).toBeInTheDocument();
  });
});
