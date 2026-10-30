const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { optionalAuthenticate } = require('../middleware/auth');

// Summary counts
router.get('/summary', optionalAuthenticate, ticketController.getSummary);

// Export CSV
router.get('/export', optionalAuthenticate, ticketController.exportTickets);

// Standard Ticket CRUD & Workflows
router.get('/', optionalAuthenticate, ticketController.getTickets);
router.post('/', optionalAuthenticate, ticketController.createTicket);
router.get('/:id', optionalAuthenticate, ticketController.getTicketById);
router.put('/:id', optionalAuthenticate, ticketController.updateTicket);
router.post('/:id/escalate', optionalAuthenticate, ticketController.escalateTicket);
router.post('/:id/comments', optionalAuthenticate, ticketController.addComment);
router.delete('/:id', optionalAuthenticate, ticketController.deleteTicket);

module.exports = router;

