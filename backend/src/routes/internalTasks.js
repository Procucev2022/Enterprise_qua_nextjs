const express = require('express');
const router = express.Router();
const internalTaskController = require('../controllers/internalTaskController');
const { authenticate, requireRole } = require('../middleware/auth');

// Every route in this module exposes internal operational data or performs a
// management action. Keep the read and write boundary consistent.
const managementAccess = [authenticate, requireRole('admin', 'category_manager')];

// Registered Clients (Action Center Registrations Module)
router.get('/registrations', ...managementAccess, internalTaskController.getRegistrations);
router.post('/registrations/:id/action', ...managementAccess, internalTaskController.handleRegistrationAction);

// Task summary counts
router.get('/summary', ...managementAccess, internalTaskController.getSummary);
router.get('/assignees', ...managementAccess, internalTaskController.getAssignees);

// Task types (dynamic extensible types)
router.get('/task-types', ...managementAccess, internalTaskController.getTaskTypes);
router.post('/task-types', ...managementAccess, internalTaskController.createTaskType);

// Entity lookup for dynamic relationships (RFQ, BUYER, VENDOR, CATEGORY, USER, CREDIT, etc.)
router.get('/entities', ...managementAccess, internalTaskController.searchEntities);

// Export filtered tasks as CSV
router.get('/export', ...managementAccess, internalTaskController.exportTasks);

// Automated reminder check
router.post('/check-reminders', ...managementAccess, internalTaskController.checkReminders);

// Standard task CRUD
router.get('/', ...managementAccess, internalTaskController.getTasks);
router.post('/', ...managementAccess, internalTaskController.createTask);
router.get('/:id', ...managementAccess, internalTaskController.getTaskById);
router.put('/:id', ...managementAccess, internalTaskController.updateTask);
router.delete('/:id', ...managementAccess, internalTaskController.deleteTask);

// Task actions: credit approval workflow & activity log
router.post(
  '/:id/approve',
  ...managementAccess,
  internalTaskController.approveCreditTask
);
router.post(
  '/:id/reject',
  ...managementAccess,
  internalTaskController.rejectCreditTask
);
router.post('/:id/activities', ...managementAccess, internalTaskController.addTaskActivity);

module.exports = router;
