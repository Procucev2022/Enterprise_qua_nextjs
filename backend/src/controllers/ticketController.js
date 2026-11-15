// ==============================================================================
// TICKET CONTROLLER
// ==============================================================================
// REST API handlers for tickets, customer complaints, bug triage, SLA metrics,
// and workflow escalations in the Action Center.
// The acting user is always the authenticated session (req.user). Request
// headers are never used as identity.
// ==============================================================================

const ticketQueries = require('../db/ticketQueries');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const { TICKET_MESSAGES, TICKET_CREATE_FIELD_ALIASES, formatMessage } = require('../config/constants');
const { logger } = require('../services/loggerService');

/**
 * Builds the acting user from the authenticated session (req.user). Returns null when the
 * session does not identify a user, so the caller can reject the request.
 */
function extractActor(req) {
  const user = req && req.user;
  if (!user || typeof user !== 'object') return null;
  const uuid = user.uuid || user.id || user.sub || null;
  const email = user.email || null;
  if (!uuid && !email) return null;
  return {
    uuid,
    name: user.fullName || user.name || email,
    email,
    role: user.role || null,
  };
}

function rejectWithoutSession(res) {
  return res.status(401).json({ success: false, error: TICKET_MESSAGES.SESSION_REQUIRED });
}

/**
 * Sends the failure response for a ticket operation.
 * - A client error (4xx) keeps its status and the message the query layer wrote.
 * - An unavailable store (503, or PERSISTENCE_UNAVAILABLE) returns 503 with its message.
 * - Any other error becomes a 500 with the handler's generic message. The caller logs the
 *   raw error, and the client never receives it.
 */
function sendTicketError(res, err, fallbackMessage) {
  const statusCode = err?.statusCode;
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({ success: false, error: err.message || fallbackMessage });
  }
  if (statusCode === 503 || err?.code === 'PERSISTENCE_UNAVAILABLE') {
    return res.status(503).json({
      success: false,
      error: err.message || TICKET_MESSAGES.STORAGE_UNAVAILABLE,
      retryable: true,
    });
  }
  return res.status(500).json({ success: false, error: fallbackMessage });
}

/**
 * Names every failing field in one message, so the client can show what to correct.
 */
function validationFailure(prefix, errors) {
  return [prefix, ...Object.values(errors)].join(' ');
}

/**
 * Copies each snake_case alias onto its camelCase schema field when the camelCase field is
 * absent. The request body itself is not modified.
 */
function withCreateFieldAliases(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const normalized = { ...source };
  for (const [alias, field] of Object.entries(TICKET_CREATE_FIELD_ALIASES)) {
    if (normalized[field] === undefined && source[alias] !== undefined) {
      normalized[field] = source[alias];
    }
  }
  return normalized;
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
    return sendTicketError(res, err, TICKET_MESSAGES.SUMMARY_FAILED);
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
    const pageLimit = Number(limit) || 50;
    const pageOffset = Number(offset) || 0;

    const result = await ticketQueries.getTickets({
      search,
      status,
      priority,
      category,
      project,
      assignedTo,
      dateFrom,
      dateTo,
      limit: pageLimit,
      offset: pageOffset,
    });

    return res.json({
      success: true,
      data: result.rows,
      total: result.total,
      limit: pageLimit,
      offset: pageOffset,
    });
  } catch (err) {
    logger.error('Failed to list tickets', err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.LIST_FAILED);
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
      return res.status(404).json({ success: false, error: formatMessage(TICKET_MESSAGES.NOT_FOUND, { id }) });
    }
    return res.json({ success: true, data: ticket });
  } catch (err) {
    logger.error(`Failed to fetch ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.DETAIL_FAILED);
  }
}

/**
 * POST /api/tickets
 */
async function createTicket(req, res) {
  try {
    const actor = extractActor(req);
    if (!actor) return rejectWithoutSession(res);

    const validation = validatePayload(VALIDATION_SCHEMAS.ticketCreate, withCreateFieldAliases(req.body));
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validationFailure(TICKET_MESSAGES.CREATE_VALIDATION_FAILED, validation.errors),
        details: validation.errors,
      });
    }

    const created = await ticketQueries.createTicket(validation.sanitizedData, actor);
    logger.info(`Ticket created: ${created.ticket_number} - ${created.subject}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Failed to create ticket', err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.CREATE_FAILED);
  }
}

/**
 * PUT /api/tickets/:id
 */
async function updateTicket(req, res) {
  try {
    const { id } = req.params;
    const actor = extractActor(req);
    if (!actor) return rejectWithoutSession(res);

    const validation = validatePayload(VALIDATION_SCHEMAS.ticketUpdate, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validationFailure(TICKET_MESSAGES.UPDATE_VALIDATION_FAILED, validation.errors),
        details: validation.errors,
      });
    }

    const updated = await ticketQueries.updateTicket(id, validation.sanitizedData, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: formatMessage(TICKET_MESSAGES.NOT_FOUND, { id }) });
    }

    logger.info(`Ticket updated: ${updated.ticket_number}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Failed to update ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.UPDATE_FAILED);
  }
}

/**
 * POST /api/tickets/:id/escalate
 */
async function escalateTicket(req, res) {
  try {
    const { id } = req.params;
    const actor = extractActor(req);
    if (!actor) return rejectWithoutSession(res);

    const validation = validatePayload(VALIDATION_SCHEMAS.ticketEscalate, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validationFailure(TICKET_MESSAGES.ESCALATE_VALIDATION_FAILED, validation.errors),
        details: validation.errors,
      });
    }

    const escalated = await ticketQueries.escalateTicket(id, validation.sanitizedData, actor);
    if (!escalated) {
      return res.status(404).json({ success: false, error: formatMessage(TICKET_MESSAGES.NOT_FOUND, { id }) });
    }

    logger.warn(
      `Ticket escalated: ${escalated.ticket_number} to ${validation.sanitizedData.escalatedTo}`,
      { actor: actor.email },
      'TICKET_CONTROLLER'
    );
    return res.json({ success: true, data: escalated });
  } catch (err) {
    logger.error(`Failed to escalate ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.ESCALATE_FAILED);
  }
}

/**
 * POST /api/tickets/:id/comments
 */
async function addComment(req, res) {
  try {
    const { id } = req.params;
    const actor = extractActor(req);
    if (!actor) return rejectWithoutSession(res);

    const validation = validatePayload(VALIDATION_SCHEMAS.ticketComment, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: validationFailure(TICKET_MESSAGES.COMMENT_VALIDATION_FAILED, validation.errors),
        details: validation.errors,
      });
    }

    const comment = await ticketQueries.addTicketComment(id, { comment: validation.sanitizedData.comment }, actor);
    if (!comment) {
      return res.status(404).json({ success: false, error: formatMessage(TICKET_MESSAGES.NOT_FOUND, { id }) });
    }

    return res.status(201).json({ success: true, data: comment });
  } catch (err) {
    logger.error(`Failed to add comment to ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.COMMENT_FAILED);
  }
}

/**
 * DELETE /api/tickets/:id
 */
async function deleteTicket(req, res) {
  try {
    const { id } = req.params;
    const actor = extractActor(req);
    if (!actor) return rejectWithoutSession(res);

    const deleted = await ticketQueries.deleteTicket(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: formatMessage(TICKET_MESSAGES.NOT_FOUND, { id }) });
    }

    logger.info(`Ticket deleted: ${id}`, { actor: actor.email }, 'TICKET_CONTROLLER');
    return res.json({ success: true, message: formatMessage(TICKET_MESSAGES.DELETED, { id }) });
  } catch (err) {
    logger.error(`Failed to delete ticket ${req.params.id}`, err, 'TICKET_CONTROLLER');
    return sendTicketError(res, err, TICKET_MESSAGES.DELETE_FAILED);
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
    return sendTicketError(res, err, TICKET_MESSAGES.EXPORT_FAILED);
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
