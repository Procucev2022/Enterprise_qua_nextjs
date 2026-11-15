const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { authenticate, requireRole } = require('../middleware/auth');

// Ticket lists, customer details, comments, exports, and workflow mutations are
// staff data and are used by the category-manager action center.
router.use(authenticate, requireRole('admin', 'category_manager'));

// Summary counts
router.get('/summary', ticketController.getSummary);

// Export CSV
router.get('/export', ticketController.exportTickets);

// Standard Ticket CRUD & Workflows
router.get('/', ticketController.getTickets);
router.post('/', ticketController.createTicket);
router.get('/:id', ticketController.getTicketById);
router.put('/:id', ticketController.updateTicket);
router.post('/:id/escalate', ticketController.escalateTicket);
router.post('/:id/comments', ticketController.addComment);
router.delete('/:id', ticketController.deleteTicket);

module.exports = router;

