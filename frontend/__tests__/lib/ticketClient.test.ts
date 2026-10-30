import {
  fetchTickets,
  fetchTicketSummary,
  fetchTicketById,
  createTicket,
  updateTicket,
  escalateTicket,
  addTicketComment,
  deleteTicket,
  getExportTicketsUrl,
} from '@/lib/ticketClient';
import { authClient } from '@/lib/authClient';

describe('ticketClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchTickets', () => {
    it('fetches tickets with query parameters', async () => {
      const mockResponse = {
        data: [{ id: 't-1', ticket_number: 'TCK-001' }],
        total: 1,
        limit: 10,
        offset: 0,
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchTickets({
        status: 'Pending',
        priority: 'High',
        category: 'Quality',
        assignedTo: 'user-1',
        project: 'Project Alpha',
        search: 'crack',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/tickets?'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      );
    });

    it('returns empty result on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const result = await fetchTickets();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns empty result on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const result = await fetchTickets();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('fetchTicketSummary', () => {
    it('fetches ticket summary successfully', async () => {
      const mockSummary = {
        total: 10,
        pending: 3,
        inProgress: 2,
        escalated: 1,
        completed: 4,
        criticalCount: 2,
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: mockSummary }),
      });

      const result = await fetchTicketSummary();
      expect(result).toEqual(mockSummary);
    });

    it('returns fallback summary on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 });
      const result = await fetchTicketSummary();
      expect(result).toEqual({
        total: 0,
        pending: 0,
        inProgress: 0,
        escalated: 0,
        completed: 0,
        criticalCount: 0,
      });

      global.fetch = jest.fn().mockRejectedValue(new Error('Summary error'));
      const result2 = await fetchTicketSummary();
      expect(result2).toEqual({
        total: 0,
        pending: 0,
        inProgress: 0,
        escalated: 0,
        completed: 0,
        criticalCount: 0,
      });
    });
  });

  describe('fetchTicketById', () => {
    it('fetches a single ticket with activities', async () => {
      const mockTicket = { id: 't-123', subject: 'Test issue', activities: [] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockTicket }),
      });

      const result = await fetchTicketById('t-123');
      expect(result).toEqual(mockTicket);
    });

    it('returns null on error or non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
      const res1 = await fetchTicketById('not-found');
      expect(res1).toBeNull();

      global.fetch = jest.fn().mockRejectedValue(new Error('Failed'));
      const res2 = await fetchTicketById('bad-id');
      expect(res2).toBeNull();
    });
  });

  describe('createTicket', () => {
    it('sends POST request to create ticket', async () => {
      const newTicket = { id: 't-new', subject: 'New defect' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: newTicket }),
      });

      const result = await createTicket({
        subject: 'New defect',
        description: 'Detailed notes',
        priority: 'High',
        category: 'Quality Issue',
      });

      expect(result).toEqual({ success: true, data: newTicket });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('returns error result on bad response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Subject required' }),
      });

      const result = await createTicket({ subject: '' });
      expect(result).toEqual({ success: false, error: 'Subject required' });
    });

    it('returns fallback error when json body has no error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      const result = await createTicket({ subject: 'x' });
      expect(result).toEqual({ success: false, error: 'Failed to create ticket.' });
    });

    it('catches exception and returns network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed fetch'));
      const result = await createTicket({ subject: 'x' });
      expect(result).toEqual({ success: false, error: 'Failed fetch' });

      global.fetch = jest.fn().mockRejectedValue('string-err');
      const result2 = await createTicket({ subject: 'x' });
      expect(result2).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('updateTicket', () => {
    it('sends PUT request to update ticket', async () => {
      const updated = { id: 't-1', status: 'Completed' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: updated }),
      });

      const result = await updateTicket('t-1', { status: 'Completed' });
      expect(result).toEqual({ success: true, data: updated });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets/t-1',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('returns error result when update fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Not allowed' }),
      });

      const result = await updateTicket('t-1', { status: 'Completed' });
      expect(result).toEqual({ success: false, error: 'Not allowed' });
    });

    it('returns fallback error on non-ok without error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      const result = await updateTicket('t-1', { status: 'Completed' });
      expect(result).toEqual({ success: false, error: 'Failed to update ticket.' });
    });

    it('handles exception during update', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));
      const result = await updateTicket('t-1', { status: 'Completed' });
      expect(result).toEqual({ success: false, error: 'Network fail' });

      global.fetch = jest.fn().mockRejectedValue(null);
      const result2 = await updateTicket('t-1', { status: 'Completed' });
      expect(result2).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('escalateTicket', () => {
    it('sends POST request to escalate endpoint', async () => {
      const escalated = { id: 't-1', status: 'Escalated' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: escalated }),
      });

      const result = await escalateTicket('t-1', {
        reason: 'Client escalated to executive management',
        escalatedTo: 'Head of Operations',
      });

      expect(result).toEqual({ success: true, data: escalated });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets/t-1/escalate',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('returns error result when escalation fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Escalation error' }),
      });

      const result = await escalateTicket('t-1', { reason: 'reason', escalatedTo: 'mgr' });
      expect(result).toEqual({ success: false, error: 'Escalation error' });
    });

    it('returns fallback error when json lacks error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      const result = await escalateTicket('t-1', { reason: 'reason', escalatedTo: 'mgr' });
      expect(result).toEqual({ success: false, error: 'Failed to escalate ticket.' });
    });

    it('catches exception and returns error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection dropped'));
      const result = await escalateTicket('t-1', { reason: 'reason', escalatedTo: 'mgr' });
      expect(result).toEqual({ success: false, error: 'Connection dropped' });

      global.fetch = jest.fn().mockRejectedValue(123);
      const result2 = await escalateTicket('t-1', { reason: 'reason', escalatedTo: 'mgr' });
      expect(result2).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('addTicketComment', () => {
    it('sends POST request to comments endpoint', async () => {
      const commentRes = { id: 'act-1', comment: 'Fixed issue' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: commentRes }),
      });

      const result = await addTicketComment('t-1', { comment: 'Fixed issue' });
      expect(result).toEqual({ success: true, data: commentRes });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets/t-1/comments',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('returns error result on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Comment required' }),
      });

      const result = await addTicketComment('t-1', { comment: '' });
      expect(result).toEqual({ success: false, error: 'Comment required' });
    });

    it('returns fallback error on failure without error field', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      const result = await addTicketComment('t-1', { comment: '' });
      expect(result).toEqual({ success: false, error: 'Failed to add comment.' });
    });

    it('catches exception during add comment', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Post failed'));
      const result = await addTicketComment('t-1', { comment: 'hello' });
      expect(result).toEqual({ success: false, error: 'Post failed' });

      global.fetch = jest.fn().mockRejectedValue('not an error');
      const result2 = await addTicketComment('t-1', { comment: 'hello' });
      expect(result2).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('deleteTicket', () => {
    it('sends DELETE request and returns true on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await deleteTicket('t-1');
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets/t-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('returns false when delete fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });
      const result = await deleteTicket('t-1');
      expect(result).toBe(false);

      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));
      const result2 = await deleteTicket('t-1');
      expect(result2).toBe(false);
    });
  });

  describe('getExportTicketsUrl', () => {
    it('generates export url with filter query parameters', () => {
      const url = getExportTicketsUrl({
        status: 'In Progress',
        priority: 'Urgent',
        category: 'Quality',
        project: 'Project Alpha',
        assignedTo: 'user-1',
        search: 'motor',
      });
      expect(url).toContain('/api/tickets/export?');
      expect(url).toContain('status=In+Progress');
      expect(url).toContain('priority=Urgent');
      expect(url).toContain('category=Quality');
      expect(url).toContain('project=Project+Alpha');
      expect(url).toContain('assignedTo=user-1');
      expect(url).toContain('search=motor');
    });

    it('omits all filter parameter when set to "all"', () => {
      const url = getExportTicketsUrl({
        status: 'all',
        priority: 'all',
        category: 'all',
        project: 'all',
        assignedTo: 'all',
      });
      expect(url).toBe('/api/tickets/export?');
    });
  });

  describe('authHeaders fallback', () => {
    it('works when token is null', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null as any);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: {} }),
      });

      await fetchTicketSummary();
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tickets/summary',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });
});
