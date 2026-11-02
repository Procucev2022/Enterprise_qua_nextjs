import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TicketsDashboard from '@/app/category-manager/components/TicketsDashboard';
import * as ticketClient from '@/lib/ticketClient';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/ticketClient', () => {
  const actual = jest.requireActual('@/lib/ticketClient');
  return {
    ...actual,
    fetchTicketSummary: jest.fn(),
    fetchTickets: jest.fn(),
    fetchTicketById: jest.fn(),
    createTicket: jest.fn(),
    updateTicket: jest.fn(),
    escalateTicket: jest.fn(),
    addTicketComment: jest.fn(),
    deleteTicket: jest.fn(),
    getExportTicketsUrl: jest.fn().mockReturnValue('/api/tickets/export?test=1'),
  };
});

const mockSummary = {
  total: 5,
  pending: 2,
  inProgress: 1,
  escalated: 1,
  completed: 1,
  criticalCount: 2,
};

const mockTicketsList = [
  {
    id: 't-101',
    ticket_number: 'TCK-1001',
    subject: 'Defective flange dimensional variance',
    issue_description: 'Variance in wall thickness of 2mm exceeding tolerance.',
    category: 'Quality Issue',
    priority: 'High',
    status: 'Pending',
    assigned_to_name: 'Naveen Kumar',
    customer_name: 'Tata Steel Solutions',
    customer_email: 'procurement@tatasteel.com',
    customer_phone: '+919876543210',
    project: 'Project Falcon',
    related_entity_type: 'RFQ',
    related_entity_id: 'rfq-922',
    escalation_level: 2,
    due_date: '2026-11-05T00:00:00Z',
    sla_hours: 48,
    created_at: '2026-10-29T10:00:00Z',
    updated_at: '2026-10-29T10:00:00Z',
  },
  {
    id: 't-102',
    ticket_number: 'TCK-1002',
    subject: 'Delayed dispatch of stainless steel fasteners',
    issue_description: 'Dispatch delayed by 4 business days.',
    category: 'Logistics & Dispatch',
    priority: 'Critical',
    status: 'Escalated',
    assigned_to_name: 'Priya Sharma',
    escalated_to: 'Head of Operations',
    escalation_reason: 'Breach of contractual SLA',
    customer_name: 'JSW Infrastructure',
    customer_email: 'admin@jsw.in',
    project: 'Project Orion',
    due_date: null,
    sla_hours: 24,
    created_at: '2026-10-28T09:00:00Z',
    updated_at: '2026-10-28T09:00:00Z',
  },
  {
    id: 't-103',
    ticket_number: 'TCK-1003',
    subject: 'Completed maintenance calibration',
    issue_description: 'Calibration verified.',
    category: 'General',
    priority: 'Low',
    status: 'Completed',
    assigned_to_name: 'Technician Desk',
    customer_name: '',
    customer_email: '',
    project: '',
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
  },
  {
    id: 't-104',
    ticket_number: 'TCK-1004',
    subject: 'Vendor invoice query',
    issue_description: 'Clarification on line item tax rate',
    category: 'Billing',
    priority: 'Medium',
    status: 'In Progress',
    assigned_to_name: 'Priya Sharma',
    customer_name: 'JSW Infrastructure',
    customer_email: 'finance@jsw.in',
    project: 'Project Titan',
    due_date: '2026-11-01T00:00:00Z',
    sla_hours: 24,
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T09:00:00Z',
  },
];

describe('TicketsDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ticketClient.fetchTicketSummary as jest.Mock).mockResolvedValue(mockSummary);
    (ticketClient.fetchTickets as jest.Mock).mockResolvedValue({
      data: mockTicketsList,
      total: 3,
      limit: 20,
      offset: 0,
    });
    (ticketClient.fetchTicketById as jest.Mock).mockImplementation(async (id: string) => {
      const found = mockTicketsList.find((t) => t.id === id);
      return found ? { ...found, activities: [{ id: 'act-1', comment: 'Initial ticket review', actor_name: 'Admin', created_at: '2026-10-29' }] } : null;
    });
    (ticketClient.createTicket as jest.Mock).mockResolvedValue({
      success: true,
      data: { id: 't-new', ticket_number: 'TCK-9999', subject: 'New created ticket' },
    });
    (ticketClient.updateTicket as jest.Mock).mockResolvedValue({ success: true });
    (ticketClient.escalateTicket as jest.Mock).mockResolvedValue({ success: true });
    (ticketClient.addTicketComment as jest.Mock).mockResolvedValue({ success: true });
    (ticketClient.deleteTicket as jest.Mock).mockResolvedValue(true);
  });

  it('renders summary cards and ticket table rows', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
      expect(screen.getByText('Defective flange dimensional variance')).toBeInTheDocument();
      expect(screen.getByText('TCK-1002')).toBeInTheDocument();
      expect(screen.getByText('TCK-1003')).toBeInTheDocument();
    });

    // Check summary cards counts
    expect(screen.getByText('5')).toBeInTheDocument(); // total
  });

  it('filters tickets by search query', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by ticket ID, subject/i);
    fireEvent.change(searchInput, { target: { value: 'dimensional' } });

    await waitFor(() => {
      expect(ticketClient.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'dimensional' })
      );
    });
  });

  it('opens filter panel and tests all filter dropdowns and date inputs', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    // Toggle filter panel open
    const filterBtn = screen.getByRole('button', { name: /Filter/i });
    fireEvent.click(filterBtn);

    const selects = screen.getAllByRole('combobox');
    // Status filter
    fireEvent.change(selects[0], { target: { value: 'Pending' } });
    // Priority filter
    fireEvent.change(selects[1], { target: { value: 'High' } });
    // Category filter
    fireEvent.change(selects[2], { target: { value: 'Quality Issue' } });
    // Project filter
    fireEvent.change(selects[3], { target: { value: 'Project Falcon' } });

    // Date range inputs
    const fromInput = screen.getByLabelText(/Filter From Date/i);
    const toInput = screen.getByLabelText(/Filter To Date/i);
    fireEvent.change(fromInput, { target: { value: '2026-10-01' } });
    fireEvent.change(toInput, { target: { value: '2026-10-31' } });

    await waitFor(() => {
      expect(ticketClient.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'Pending',
          priority: 'High',
          category: 'Quality Issue',
          project: 'Project Falcon',
        })
      );
    });

    // Test Reset Filters button
    const resetBtn = screen.getByRole('button', { name: /Reset Filters/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(ticketClient.fetchTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'all',
          priority: 'all',
          category: 'all',
          project: 'all',
        })
      );
    });

    // Toggle filter panel closed
    fireEvent.click(filterBtn);
  });

  it('handles refresh button click', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTitle('Refresh');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(ticketClient.fetchTicketSummary).toHaveBeenCalledTimes(2);
      expect(ticketClient.fetchTickets).toHaveBeenCalledTimes(2);
    });
  });

  it('opens Create Ticket modal, fills all fields, tests validations, and submits', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.createTicket });
    fireEvent.click(createBtn);

    const subjectInput = screen.getByPlaceholderText(/e.g. Discrepancy in motor test certificates/i);
    const descInput = screen.getByPlaceholderText(/Detail the technical or commercial fault/i);
    const projectInput = screen.getByPlaceholderText(/e.g. Tata Steel Mechanical Spares/i);
    const customerNameInput = screen.getByPlaceholderText(/e.g. Tata Steel Ltd/i);
    const customerEmailInput = screen.getByPlaceholderText(/buyer@tatasteel.com/i);
    const submitBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.saveTicket });

    // Test validation: submit with empty subject
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Please provide a ticket subject.')).toBeInTheDocument();
    });

    // Fill all form fields
    fireEvent.change(subjectInput, { target: { value: 'Cracked hydraulic hose' } });
    fireEvent.change(descInput, { target: { value: 'Observed oil seepage during load test' } });
    fireEvent.change(projectInput, { target: { value: 'Project Titan' } });
    fireEvent.change(customerNameInput, { target: { value: 'Titan Corp' } });
    fireEvent.change(customerEmailInput, { target: { value: 'titan@corp.com' } });

    // In modal, change priority and category selects
    const prioritySelect = screen.getByLabelText(/Ticket Priority/i);
    const categorySelect = screen.getByLabelText(/Ticket Category/i);
    fireEvent.change(prioritySelect, { target: { value: 'High' } });
    fireEvent.change(categorySelect, { target: { value: 'Quality & Compliance' } });

    const assignedInput = screen.getByLabelText(/Assigned Executive/i);
    const slaInput = screen.getByLabelText(/SLA Hours/i);
    fireEvent.change(assignedInput, { target: { value: 'Naveen Kumar' } });
    fireEvent.change(slaInput, { target: { value: '48' } });

    // Submit form
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(ticketClient.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Cracked hydraulic hose',
          description: 'Observed oil seepage during load test',
          priority: 'High',
          category: 'Quality & Compliance',
          project: 'Project Titan',
          customer_name: 'Titan Corp',
          customer_email: 'titan@corp.com',
        })
      );
    });
  });

  it('handles Cancel and Close in Create Ticket modal', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.createTicket });
    fireEvent.click(createBtn);

    // Click cancel button inside modal
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByPlaceholderText(/e.g. Discrepancy in motor test certificates/i)).not.toBeInTheDocument();

    // Reopen and close with X button
    fireEvent.click(createBtn);
    const buttons = screen.getAllByRole('button');
    const xBtn = buttons.find((b) => b.querySelector('svg.lucide-x'));
    if (xBtn) fireEvent.click(xBtn);
  });

  it('handles creation error returned from API', async () => {
    (ticketClient.createTicket as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Duplicate ticket error',
    });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.createTicket });
    fireEvent.click(createBtn);

    const subjectInput = screen.getByPlaceholderText(/e.g. Discrepancy in motor test certificates/i);
    fireEvent.change(subjectInput, { target: { value: 'Duplicate' } });

    const submitBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.saveTicket });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Duplicate ticket error')).toBeInTheDocument();
    });
  });

  it('opens ticket details drawer, adds comment, and closes drawer', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(ticketClient.fetchTicketById).toHaveBeenCalledWith('t-101');
      expect(screen.getByText(/Initial ticket review/i)).toBeInTheDocument();
    });

    // Test empty comment validation
    const postCommentBtn = screen.getByRole('button', { name: /Post/i });
    fireEvent.click(postCommentBtn);

    // Add valid comment
    const commentInput = screen.getByPlaceholderText(/Add an internal note or investigation update/i);
    fireEvent.change(commentInput, { target: { value: 'Site technician dispatched.' } });
    fireEvent.click(postCommentBtn);

    await waitFor(() => {
      expect(ticketClient.addTicketComment).toHaveBeenCalledWith('t-101', {
        comment: 'Site technician dispatched.',
      });
    });

    // Close drawer via close button (X)
    const drawerButtons = screen.getAllByRole('button');
    const drawerCloseBtn = drawerButtons.find((b) => b.querySelector('svg.lucide-x'));
    if (drawerCloseBtn) fireEvent.click(drawerCloseBtn);
  });

  it('opens escalation modal, tests validation, and escalates ticket to manager', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const escalateButtons = screen.getAllByTitle('Escalate Ticket');
    fireEvent.click(escalateButtons[0]);

    const reasonInput = screen.getByPlaceholderText(/Critical SLA breach risk/i);
    const submitEscalateBtn = screen.getByRole('button', { name: /Confirm Escalation/i });

    // Submit with empty reason
    fireEvent.click(submitEscalateBtn);

    await waitFor(() => {
      expect(screen.getByText('Please state a reason for escalation.')).toBeInTheDocument();
    });

    // Fill valid reason
    fireEvent.change(reasonInput, { target: { value: 'Vendor unresponsive for 48 hours' } });
    fireEvent.click(submitEscalateBtn);

    await waitFor(() => {
      expect(ticketClient.escalateTicket).toHaveBeenCalledWith(
        't-101',
        expect.objectContaining({
          reason: 'Vendor unresponsive for 48 hours',
        })
      );
    });
  });

  it('handles Cancel and Close in Escalation modal', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const escalateButtons = screen.getAllByTitle('Escalate Ticket');
    fireEvent.click(escalateButtons[0]);

    // Test changing target
    const targetInput = screen.getByLabelText(/Escalate Target/i);
    fireEvent.change(targetInput, { target: { value: 'VP Operations' } });

    // Click cancel in escalation modal
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Critical SLA breach risk/i)).not.toBeInTheDocument();
    });

    // Reopen and close with Close escalation modal button
    fireEvent.click(escalateButtons[0]);
    const closeBtn = screen.getByLabelText(/Close escalation modal/i);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Critical SLA breach risk/i)).not.toBeInTheDocument();
    });
  });

  it('marks ticket as completed and handles update failure', async () => {
    (ticketClient.updateTicket as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Cannot complete ticket',
    });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const completeButtons = screen.getAllByTitle('Mark as Completed');
    fireEvent.click(completeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Cannot complete ticket')).toBeInTheDocument();
    });
  });

  it('handles resolve ticket inside drawer', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Initial ticket review/i)).toBeInTheDocument();
    });

    const resolveBtn = screen.getByRole('button', { name: /Resolve Ticket/i });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(ticketClient.updateTicket).toHaveBeenCalledWith('t-101', expect.objectContaining({ status: 'Completed' }));
    });
  });

  it('handles empty ticket state gracefully', async () => {
    (ticketClient.fetchTickets as jest.Mock).mockResolvedValue({
      data: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.actionCenter.tickets.noTicketsFound)).toBeInTheDocument();
    });
  });

  it('handles escalation failure from API', async () => {
    (ticketClient.escalateTicket as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Escalation rejected by system',
    });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const escalateButtons = screen.getAllByTitle('Escalate Ticket');
    fireEvent.click(escalateButtons[0]);

    const reasonInput = screen.getByPlaceholderText(/Critical SLA breach risk/i);
    fireEvent.change(reasonInput, { target: { value: 'Escalation needed' } });

    const submitEscalateBtn = screen.getByRole('button', { name: /Confirm Escalation/i });
    fireEvent.click(submitEscalateBtn);

    await waitFor(() => {
      expect(screen.getByText('Escalation rejected by system')).toBeInTheDocument();
    });
  });

  it('handles escalation from inside details drawer and updates open ticket', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Initial ticket review/i)).toBeInTheDocument();
    });

    // In drawer, click Escalate button
    const escalateInDrawer = screen.getByRole('button', { name: /^Escalate$/i });
    fireEvent.click(escalateInDrawer);

    const reasonInput = screen.getByPlaceholderText(/Critical SLA breach risk/i);
    fireEvent.change(reasonInput, { target: { value: 'Managerial action needed' } });

    const submitEscalateBtn = screen.getByRole('button', { name: /Confirm Escalation/i });
    fireEvent.click(submitEscalateBtn);

    await waitFor(() => {
      expect(ticketClient.escalateTicket).toHaveBeenCalledWith('t-101', expect.objectContaining({ reason: 'Managerial action needed' }));
      expect(ticketClient.fetchTicketById).toHaveBeenCalledWith('t-101');
    });
  });

  it('handles comment failure toast', async () => {
    (ticketClient.addTicketComment as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Note cannot be saved',
    });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Initial ticket review/i)).toBeInTheDocument();
    });

    const commentInput = screen.getByPlaceholderText(/Add an internal note or investigation update/i);
    fireEvent.change(commentInput, { target: { value: 'Failing note test' } });

    const postCommentBtn = screen.getByRole('button', { name: /Post/i });
    fireEvent.click(postCommentBtn);

    await waitFor(() => {
      expect(screen.getByText('Note cannot be saved')).toBeInTheDocument();
    });
  });

  it('handles fetchTickets throwing an exception', async () => {
    (ticketClient.fetchTickets as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load tickets.')).toBeInTheDocument();
    });
  });

  it('marks ticket as completed from table row successfully when drawer closed', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const completeButtons = screen.getAllByTitle('Mark as Completed');
    fireEvent.click(completeButtons[0]);

    await waitFor(() => {
      expect(ticketClient.updateTicket).toHaveBeenCalledWith('t-101', { status: 'Completed' });
      expect(screen.getByText('Status updated to Completed.')).toBeInTheDocument();
    });
  });

  it('handles fetchTicketById returning null gracefully', async () => {
    (ticketClient.fetchTicketById as jest.Mock).mockResolvedValueOnce(null);

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(ticketClient.fetchTicketById).toHaveBeenCalledWith('t-101');
    });
  });

  it('creates ticket with empty customer details and zero SLA to test fallbacks', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    const createBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.createTicket });
    fireEvent.click(createBtn);

    const subjectInput = screen.getByPlaceholderText(/e.g. Discrepancy in motor test certificates/i);
    fireEvent.change(subjectInput, { target: { value: 'Minimal ticket' } });

    const submitBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.saveTicket });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(ticketClient.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Minimal ticket',
          customer_name: 'Enterprise Client',
          customer_email: 'client@procucev.com',
          customer_phone: '+919876543210',
          sla_hours: 24,
        })
      );
    });
  });

  it('handles fallback error messages when API fails without error property', async () => {
    (ticketClient.createTicket as jest.Mock).mockResolvedValueOnce({ success: false });
    (ticketClient.escalateTicket as jest.Mock).mockResolvedValueOnce({ success: false });
    (ticketClient.updateTicket as jest.Mock).mockResolvedValueOnce({ success: false });
    (ticketClient.addTicketComment as jest.Mock).mockResolvedValueOnce({ success: false });

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    // 1. Create ticket fallback error
    const createBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.createTicket });
    fireEvent.click(createBtn);
    const subjectInput = screen.getByPlaceholderText(/e.g. Discrepancy in motor test certificates/i);
    fireEvent.change(subjectInput, { target: { value: 'Fallback error test' } });
    const saveBtn = screen.getByRole('button', { name: UI_STRINGS.actionCenter.tickets.saveTicket });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to create ticket.')).toBeInTheDocument();
    });

    // 2. Escalate fallback error
    const escalateButtons = screen.getAllByTitle('Escalate Ticket');
    fireEvent.click(escalateButtons[0]);
    const reasonInput = screen.getByPlaceholderText(/Critical SLA breach risk/i);
    fireEvent.change(reasonInput, { target: { value: 'Escalate reason test' } });
    const submitEscalateBtn = screen.getByRole('button', { name: /Confirm Escalation/i });
    fireEvent.click(submitEscalateBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to escalate ticket.')).toBeInTheDocument();
    });

    // 3. Update status fallback error
    const completeButtons = screen.getAllByTitle('Mark as Completed');
    fireEvent.click(completeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to update status.')).toBeInTheDocument();
    });

    // 4. Add comment fallback error
    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Initial ticket review/i)).toBeInTheDocument();
    });
    const commentInput = screen.getByPlaceholderText(/Add an internal note or investigation update/i);
    fireEvent.change(commentInput, { target: { value: 'Fallback comment' } });
    const postCommentBtn = screen.getByRole('button', { name: /Post/i });
    fireEvent.click(postCommentBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to add note.')).toBeInTheDocument();
    });

  });
  it('opens ActionCenterComposeModal from ticket details drawer, exercises fallbacks, and closes', async () => {
    const minimalTicket = {
      id: 't-minimal',
      ticket_number: 'TCK-MIN-1',
      subject: 'Minimal Fields Ticket',
      description: 'Ticket with missing optional fields',
      status: 'Open',
      priority: 'Low',
      category: null,
      project: null,
      customer_name: null,
      customer_email: null,
      customer_phone: null,
      assigned_to_name: null,
      assigned_team: null,
      due_date: null,
      sla_hours: 0,
      activities: [
        {
          id: 'act-no-actor',
          actor_name: null,
          activity_type: 'SYSTEM',
          comment: 'Auto-generated note without actor',
          created_at: '2026-11-01T10:00:00.000Z',
        },
      ],
    };

    (ticketClient.fetchTickets as jest.Mock).mockResolvedValueOnce({
      success: true,
      data: [minimalTicket],
      total: 1,
    });
    (ticketClient.fetchTicketById as jest.Mock).mockResolvedValueOnce(minimalTicket);

    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-MIN-1')).toBeInTheDocument();
    });

    // Open drawer
    const viewButtons = screen.getAllByTitle('View Details');
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Auto-generated note without actor')).toBeInTheDocument();
    });

    // Click Send SMS / Email button in drawer
    const sendCommBtn = screen.getByRole('button', { name: /Send SMS \/ Email/i });
    fireEvent.click(sendCommBtn);

    // Modal should be visible
    await waitFor(() => {
      expect(screen.getByText(/Action Center Communication/i)).toBeInTheDocument();
    });

    // Close modal via Cancel button
    const cancelModalBtns = screen.getAllByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelModalBtns[0]);

    await waitFor(() => {
      expect(screen.queryByText(/Directly dispatch SMS alerts/i)).not.toBeInTheDocument();
    });
  });

  it('exercises status and priority filter change handlers and fallback rendering', async () => {
    render(<TicketsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });

    // Toggle filter panel
    const filterBtn = screen.getByRole('button', { name: /^Filter$/i });
    fireEvent.click(filterBtn);

    // Filter by Status dropdown
    const statusSelect = screen.getByLabelText(/Filter by Status/i);
    fireEvent.change(statusSelect, { target: { value: 'In_Progress' } });
    fireEvent.change(statusSelect, { target: { value: 'All' } });

    // Filter by Priority dropdown
    const prioritySelect = screen.getByLabelText(/Filter by Priority/i);
    fireEvent.change(prioritySelect, { target: { value: 'Critical' } });
    fireEvent.change(prioritySelect, { target: { value: 'All' } });

    await waitFor(() => {
      expect(screen.getByText('TCK-1001')).toBeInTheDocument();
    });
  });
});
