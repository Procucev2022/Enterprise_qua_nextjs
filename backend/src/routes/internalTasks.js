const express = require('express');
const router = express.Router();
const internalTaskController = require('../controllers/internalTaskController');
const { optionalAuthenticate } = require('../middleware/auth');

// Registered Clients (Action Center Registrations Module)
router.get('/registrations', optionalAuthenticate, internalTaskController.getRegistrations);
router.post('/registrations/:id/action', optionalAuthenticate, internalTaskController.handleRegistrationAction);

// Task summary counts
router.get('/summary', optionalAuthenticate, internalTaskController.getSummary);
router.get('/assignees', optionalAuthenticate, internalTaskController.getAssignees);

// Task types (dynamic extensible types)
router.get('/task-types', optionalAuthenticate, internalTaskController.getTaskTypes);
router.post('/task-types', optionalAuthenticate, internalTaskController.createTaskType);

// Entity lookup for dynamic relationships (RFQ, BUYER, VENDOR, CATEGORY, USER, CREDIT, etc.)
router.get('/entities', optionalAuthenticate, internalTaskController.searchEntities);

// Export filtered tasks as CSV
router.get('/export', optionalAuthenticate, internalTaskController.exportTasks);

// Standard task CRUD
router.get('/', optionalAuthenticate, internalTaskController.getTasks);
router.post('/', optionalAuthenticate, internalTaskController.createTask);
router.get('/:id', optionalAuthenticate, internalTaskController.getTaskById);
router.put('/:id', optionalAuthenticate, internalTaskController.updateTask);
router.delete('/:id', optionalAuthenticate, internalTaskController.deleteTask);

module.exports = router;
