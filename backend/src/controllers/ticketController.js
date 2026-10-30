// ==============================================================================
// TICKET CONTROLLER
// ==============================================================================
// REST API handlers for tickets, customer complaints, bug triage, SLA metrics,
// and workflow escalations in the Action Center.
// ==============================================================================

const ticketQueries = require('../db/ticketQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

function extractActor(req) {
  if (req.user) {
    return {
      uuid: req.user.uuid || req.user.id || null,
      name: req.user.fullName || req.user.name || req.user.email || 'Executive',
      email: req.user.email || null,
      role: req.user.role || 'category_manager',
    };
  }
  return {
    uuid: null,
    name: req.headers['x-user-name'] || 'System Executive',
    email: req.headers['x-user-email'] || 'admin@procucev.com',
    role: 'category_manager',
  };
}

/**
 * GET /api/tickets/summary
 */
async function getSummary(req, res) {
  try {
    const summary = await ticketQueries.getTicketSummary();
    return res.json({ success: true, summary });
  } catch (err) {
    logger.error('Failed to fetch ticket summary', err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve ticket summary statistics.' });
  }
}

/**
 * GET /api/tickets
 */
async function getTickets(req, res) {
  try {
    const {
      search,
      status,
      priority,
      category,
      project,
      assignedTo,
      dateFrom,
      dateTo,
      limit = 50,
      offset = 0,
    } = req.query;

    const result = await ticketQueries.getTickets({
      search,
      status,
      priority,
      category,
      project,
      assignedTo,
      dateFrom,
      dateTo,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });

    return res.json({
      success: true,
      data: result.rows,
      total: result.total,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  } catch (err) {
    logger.error('Failed to list tickets', err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve tickets.' });
  }
}

/**
 * GET /api/tickets/:id
 */
async function getTicketById(req, res) {
  try {
    const { id } = req.params;
    const ticket = await ticketQueries.getTicketById(id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: `Ticket with ID "${id}" was not found.` });
    }
    return res.json({ success: true, data: ticket });
  } catch (err) {
    logger.error(`Failed to fetch ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to fetch ticket details.' });
  }
}

/**
 * POST /api/tickets
 */
async function createTicket(req, res) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.ticketCreate, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on ticket payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const created = await ticketQueries.createTicket(validation.sanitizedData, actor);
    logger.info(`Ticket created: ${created.ticket_number} - ${created.subject}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Failed to create ticket', err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to create ticket record.' });
  }
}

/**
 * PUT /api/tickets/:id
 */
async function updateTicket(req, res) {
  try {
    const { id } = req.params;
    const validation = validatePayload(VALIDATION_SCHEMAS.ticketUpdate, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on ticket update payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const updated = await ticketQueries.updateTicket(id, validation.sanitizedData, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Ticket with ID "${id}" was not found.` });
    }

    logger.info(`Ticket updated: ${updated.ticket_number}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Failed to update ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to update ticket.' });
  }
}

/**
 * POST /api/tickets/:id/escalate
 */
async function escalateTicket(req, res) {
  try {
    const { id } = req.params;
    const validation = validatePayload(VALIDATION_SCHEMAS.ticketEscalate, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on ticket escalation payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const escalated = await ticketQueries.escalateTicket(id, validation.sanitizedData, actor);
    if (!escalated) {
      return res.status(404).json({ success: false, error: `Ticket with ID "${id}" was not found.` });
    }

    logger.warn(`Ticket escalated: ${escalated.ticket_number} to ${req.body.escalatedTo}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.json({ success: true, data: escalated });
  } catch (err) {
    logger.error(`Failed to escalate ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to escalate ticket.' });
  }
}

/**
 * POST /api/tickets/:id/comments
 */
async function addComment(req, res) {
  try {
    const { id } = req.params;
    const validation = validatePayload(VALIDATION_SCHEMAS.ticketComment, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on ticket comment payload.',
        details: validation.errors,
      });
    }

    const actor = extractActor(req);
    const comment = await ticketQueries.addTicketComment(id, { comment: validation.sanitizedData.comment }, actor);
    if (!comment) {
      return res.status(404).json({ success: false, error: `Ticket with ID "${id}" was not found.` });
    }

    return res.status(201).json({ success: true, data: comment });
  } catch (err) {
    logger.error(`Failed to add comment to ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to add comment to ticket.' });
  }
}

/**
 * DELETE /api/tickets/:id
 */
async function deleteTicket(req, res) {
  try {
    const { id } = req.params;
    const deleted = await ticketQueries.deleteTicket(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Ticket with ID "${id}" was not found.` });
    }
    return res.json({ success: true, message: `Ticket ${id} deleted.` });
  } catch (err) {
    logger.error(`Failed to delete ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to delete ticket.' });
  }
}

/**
 * GET /api/tickets/export
 */
async function exportTickets(req, res) {
  try {
    const { search, status, priority, category, project, assignedTo } = req.query;
    const result = await ticketQueries.getTickets({
      search,
      status,
      priority,
      category,
      project,
      assignedTo,
      limit: 2000,
      offset: 0,
    });

    const headers = [
      'Ticket Number',
      'Subject',
      'Status',
      'Priority',
      'Category',
      'Project',
      'Customer',
      'Assigned To',
      'Assigned Team',
      'Due Date',
      'Created Date',
      'Resolution Notes',
    ];

    const rows = result.rows.map((t) => [
      `"${t.ticket_number || ''}"`,
      `"${(t.subject || '').replace(/"/g, '""')}"`,
      `"${t.status || ''}"`,
      `"${t.priority || ''}"`,
      `"${t.category || ''}"`,
      `"${(t.project || '').replace(/"/g, '""')}"`,
      `"${(t.customer_name || '').replace(/"/g, '""')}"`,
      `"${(t.assigned_to_name || '').replace(/"/g, '""')}"`,
      `"${t.assigned_team || ''}"`,
      `"${t.due_date || ''}"`,
      `"${t.created_at || ''}"`,
      `"${(t.resolution_notes || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-export-${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    logger.error('Failed to export tickets CSV', err, 'TICKET_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to export tickets as CSV.' });
  }
}

module.exports = {
  getSummary,
  getTickets,
  getTicketById,
  createTicket,
  updateTicket,
  escalateTicket,
  addComment,
  deleteTicket,
  exportTickets,
};

