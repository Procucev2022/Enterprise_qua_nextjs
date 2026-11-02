// ==============================================================================
// INTERNAL TASK CONTROLLER
// ==============================================================================
// Exposes API handlers for Action Center internal tasks, dynamic entities, and export.
// ==============================================================================

const internalTaskQueries = require('../db/internalTaskQueries');
const registrationQueries = require('../db/registrationQueries');
const storeService = require('../services/storeService');
const { validatePayload } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');
const actionCenterNotificationService = require('../services/actionCenterNotificationService');

/**
 * List internal tasks with database-side filtering, searching, and pagination.
 */
async function getTasks(req, res) {
  try {
    const {
      search = '',
      status = '',
      priority = '',
      taskCategory = '',
      taskType = '',
      taskTypeId = '',
      relatedEntityType = '',
      assignedTo = '',
      createdBy = '',
      dueFrom = '',
      dueTo = '',
      limit = 50,
      offset = 0,
    } = req.query;

    const result = await internalTaskQueries.getInternalTasks({
      search,
      status,
      priority,
      taskCategory,
      taskType,
      taskTypeId,
      relatedEntityType,
      assignedTo,
      createdBy,
      dueFrom,
      dueTo,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });

    return res.status(200).json({
      success: true,
      tasks: result.rows,
      total: result.total,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });
  } catch (error) {
    logger.error('Failed to get internal tasks', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: 'Internal server error fetching tasks' });
  }
}

/**
 * Get internal task summary metrics.
 */
async function getSummary(req, res) {
  try {
    const { assignedTo = '', taskCategory } = req.query;
    const filter = {};
    if (assignedTo) filter.assignedTo = assignedTo;
    if (taskCategory) filter.taskCategory = taskCategory;
    const summary = await internalTaskQueries.getInternalTaskSummary(filter);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get internal tasks summary', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch task metrics' });
  }
}

/**
 * Get internal team members and available task assignees.
 */
async function getAssignees(req, res) {
  try {
    const assignees = await internalTaskQueries.getInternalAssignees();
    return res.status(200).json({ success: true, assignees });
  } catch (error) {
    logger.error('Failed to get internal assignees', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch assignees' });
  }
}

/**
 * Get all available dynamic task types.
 */
async function getTaskTypes(req, res) {
  try {
    const types = await internalTaskQueries.getTaskTypes();
    return res.status(200).json({ success: true, taskTypes: types });
  } catch (error) {
    logger.error('Failed to get task types', { error: error.message });
    return res.status(200).json({ success: true, taskTypes: internalTaskQueries.DEFAULT_TASK_TYPES || [] });
  }
}

/**
 * Create a new dynamic task type.
 */
async function createTaskType(req, res) {
  try {
    const { name, code, defaultModule, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Task type name is required.' });
    }
    const created = await internalTaskQueries.createTaskType({
      name: name.trim(),
      code: code ? code.trim() : '',
      defaultModule: defaultModule || 'GENERAL',
      description: description || '',
    });
    return res.status(201).json({ success: true, taskType: created });
  } catch (error) {
    logger.error('Failed to create task type', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Get single task by ID.
 */
async function getTaskById(req, res) {
  try {
    const { id } = req.params;
    const task = await internalTaskQueries.getInternalTaskById(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Internal task not found.' });
    }
    return res.status(200).json({ success: true, task });
  } catch (error) {
    logger.error('Failed to get task by id', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch task.' });
  }
}

/**
 * Create a new internal task.
 */
async function createTask(req, res) {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Task title is required.' });
    }

    const validation = validatePayload('createInternalTask', req.body);
    if (!validation.isValid) {
      const firstError = Object.values(validation.errors)[0] || 'Invalid task input.';
      return res.status(400).json({ success: false, error: firstError, errors: validation.errors });
    }

    const actor = req.user ?? { name: 'Admin', role: 'admin' };
    const task = await internalTaskQueries.createInternalTask(req.body, actor);

    // Notify assigned employee if assigned
    if (task && task.assigned_to_name && task.assigned_to_name !== 'Unassigned') {
      try {
        const assignees = await internalTaskQueries.getInternalAssignees();
        const targetMember = (assignees ?? []).find(
          (m) => (m.id && m.id === task.assigned_to_user_id) || m.name.toLowerCase() === task.assigned_to_name.toLowerCase()
        );
        if (targetMember && targetMember.email) {
          await actionCenterNotificationService.dispatchActionCenterCommunication(
            {
              entityType: 'internal_task',
              entityId: task.id,
              channel: 'EMAIL',
              recipientEmail: targetMember.email,
              recipientName: targetMember.name,
              subject: `[Task Assigned] ${task.task_number}: ${task.title}`,
              message: `You have been assigned internal task ${task.task_number} (${task.title}). Priority: ${task.priority}. Due: ${task.due_date || 'No deadline'}.`,
            },
            actor
          );
        }
      } catch {
        // Notification failure is non-blocking
      }
    }

    // Notify approver if Credit task in Pending Approval
    if (task && (task.task_category === 'CREDIT_MANAGEMENT' || task.status === 'Pending Approval')) {
      try {
        await actionCenterNotificationService.dispatchActionCenterCommunication(
          {
            entityType: 'internal_task',
            entityId: task.id,
            channel: 'EMAIL',
            recipientEmail: 'admin@procucev.com',
            recipientName: 'Administrator / Credit Approver',
            subject: `[Approval Required] Credit Request ${task.task_number}`,
            message: `A new credit allocation/deduction request (${task.task_number}) requires your approval. Target Account: ${task.credit_account_name ?? 'Account'}. Quantity: ${task.credit_quantity ?? 0}. Reason: ${task.credit_reason ?? 'N/A'}.`,
          },
          actor
        );
      } catch {
        // Safe non-blocking
      }
    }

    return res.status(201).json({ success: true, task });
  } catch (error) {
    logger.error('Failed to create internal task', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Update an existing internal task.
 */
async function updateTask(req, res) {
  try {
    const { id } = req.params;
    const actor = req.user ?? { name: 'Admin', role: 'admin' };

    const validation = validatePayload('updateInternalTask', req.body);
    if (!validation.isValid) {
      const firstError = Object.values(validation.errors)[0] || 'Invalid update parameters.';
      return res.status(400).json({ success: false, error: firstError, errors: validation.errors });
    }

    // Communication tasks requirement:
    // Do not automatically mark communication tasks as completed unless the required action is successfully performed or completion is explicitly confirmed.
    const isComm = req.body.taskCategory === 'COMMUNICATION';
    const isCompleted = req.body.status === 'Completed';
    const hasConfirmation = Boolean(
      req.body.completionConfirmed ||
      req.body.actionOutcome ||
      (req.body.activityComment && req.body.activityComment.trim().length > 3) ||
      (req.body.completionRemarks && req.body.completionRemarks.trim().length > 3)
    );
    if (isComm && isCompleted && !hasConfirmation) {
      return res.status(400).json({
        success: false,
        error: 'Communication tasks require explicit confirmation or resolution notes before being marked completed.',
      });
    }

    const updated = await internalTaskQueries.updateInternalTask(id, req.body, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Task not found to update.' });
    }

    // Notify requester if status changed
    if (updated && updated.created_by_user_id) {
      try {
        await actionCenterNotificationService.dispatchActionCenterCommunication(
          {
            entityType: 'internal_task',
            entityId: updated.id,
            channel: 'EMAIL',
            recipientEmail: updated.raw?.created_by_email || 'requester@procucev.com',
            recipientName: updated.created_by_name || 'Requester',
            subject: `[Task Status Update] ${updated.task_number}: ${updated.status}`,
            message: `Task ${updated.task_number} ("${updated.title}") status updated to ${updated.status}.`,
          },
          actor
        );
      } catch {
        // Non-blocking notification
      }
    }

    return res.status(200).json({ success: true, task: updated });
  } catch (error) {
    logger.error('Failed to update internal task', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Approve a Credit Add/Delete task.
 */
async function approveCreditTask(req, res) {
  try {
    const { id } = req.params;
    const actor = req.user ?? { name: 'Admin Approver', role: 'admin' };
    const { remarks = '' } = req.body;

    const task = await internalTaskQueries.getInternalTaskById(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const updated = await internalTaskQueries.approveCreditTask(id, actor, remarks);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to approve credit task.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Credit request approved and credit balance updated successfully.',
      task: updated,
    });
  } catch (error) {
    logger.error('Failed to approve credit task', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Reject a Credit Add/Delete task.
 */
async function rejectCreditTask(req, res) {
  try {
    const { id } = req.params;
    const actor = req.user ?? { name: 'Admin Approver', role: 'admin' };
    const { remarks = '' } = req.body;

    const task = await internalTaskQueries.getInternalTaskById(id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const updated = await internalTaskQueries.rejectCreditTask(id, actor, remarks);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to reject credit task.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Credit request rejected.',
      task: updated,
    });
  } catch (error) {
    logger.error('Failed to reject credit task', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Add an activity remark or progress note to task.
 */
async function addTaskActivity(req, res) {
  try {
    const { id } = req.params;
    const actor = req.user ?? { name: 'Employee', role: 'employee' };
    const { comment = '', actionType = 'COMMENT' } = req.body;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: 'Comment or note cannot be blank.' });
    }

    const activity = await internalTaskQueries.addTaskActivity(id, { comment: comment.trim(), actionType }, actor);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Task not found to add activity.' });
    }

    return res.status(201).json({ success: true, activity });
  } catch (error) {
    logger.error('Failed to add task activity', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Check deadlines and dispatch overdue/approaching reminders.
 */
async function checkReminders(req, res) {
  try {
    const tasks = await internalTaskQueries.getOverdueAndUpcomingTasks();
    const actor = req.user ?? { name: 'Reminder Service', role: 'system' };
    let remindersDispatched = 0;

    for (const t of (tasks ?? [])) {
      if (t.assigned_to_name && t.assigned_to_name !== 'Unassigned') {
        remindersDispatched++;
        try {
          const assignees = await internalTaskQueries.getInternalAssignees();
          const member = (assignees ?? []).find((m) => m.name.toLowerCase() === t.assigned_to_name.toLowerCase());
          if (member && member.email) {
            await actionCenterNotificationService.dispatchActionCenterCommunication(
              {
                entityType: 'internal_task',
                entityId: t.id,
                channel: 'EMAIL',
                recipientEmail: member.email,
                recipientName: member.name,
                subject: `[Task Reminder] ${t.task_number}: ${t.title} Deadline Alert`,
                message: `Reminder: Internal task ${t.task_number} ("${t.title}") has an approaching or overdue deadline (Due: ${t.due_date || 'N/A'}). Please review and update progress.`,
              },
              actor
            );
          }
        } catch {
          // ignore notification errors
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Reminder check completed. Evaluated ${(tasks ?? []).length} tasks, dispatched ${remindersDispatched} reminders.`,
      count: (tasks ?? []).length,
      dispatched: remindersDispatched,
      tasks: tasks ?? [],
    });
  } catch (error) {
    logger.error('Failed to check task reminders', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Delete a task.
 */
async function deleteTask(req, res) {
  try {
    const { id } = req.params;
    await internalTaskQueries.deleteInternalTask(id);
    return res.status(200).json({ success: true, message: 'Task deleted successfully.' });
  } catch (error) {
    logger.error('Failed to delete task', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to delete task.' });
  }
}

/**
 * Search real entities from database by type (RFQ, BUYER, VENDOR, CATEGORY, USER, CREDIT, etc.).
 */
async function searchEntities(req, res) {
  try {
    const { type = 'GENERAL', q = '' } = req.query;
    const entities = await internalTaskQueries.searchRelatedEntities(type, q);
    return res.status(200).json({ success: true, entities });
  } catch (error) {
    logger.error('Failed to search entities', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to search entities.' });
  }
}

/**
 * Export filtered tasks from database as CSV.
 */
async function exportTasks(req, res) {
  try {
    const {
      search = '',
      status = '',
      priority = '',
      taskCategory = '',
      taskType = '',
      taskTypeId = '',
      relatedEntityType = '',
      assignedTo = '',
      createdBy = '',
      dueFrom = '',
      dueTo = '',
    } = req.query;

    const result = await internalTaskQueries.getInternalTasks({
      search,
      status,
      priority,
      taskCategory,
      taskType,
      taskTypeId,
      relatedEntityType,
      assignedTo,
      createdBy,
      dueFrom,
      dueTo,
      limit: 1000,
      offset: 0,
    });

    const headers = [
      'Task ID',
      'Title',
      'Description',
      'Task Type',
      'Priority',
      'Status',
      'Assigned To',
      'Related Module',
      'Related Entity',
      'Due Date',
      'Created At',
      'Notes',
    ];

    const csvRows = [headers.join(',')];

    for (const task of result.rows) {
      const row = [
        task.task_number || task.id,
        `"${(task.title || '').replace(/"/g, '""')}"`,
        `"${(task.description || '').replace(/"/g, '""')}"`,
        `"${(task.task_type_name || task.task_type || task.task_type_id || '').replace(/"/g, '""')}"`,
        task.priority ?? 'Medium',
        task.status ?? 'Pending',
        `"${(task.assigned_to_name || 'Unassigned').replace(/"/g, '""')}"`,
        task.related_entity_type ?? 'GENERAL',
        `"${(task.related_entity_label || '').replace(/"/g, '""')}"`,
        task.due_date || '',
        task.created_at || '',
        `"${(task.notes || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="internal_tasks_${new Date().toISOString().slice(0, 10)}.csv"`
    );
    return res.status(200).send(csvContent);
  } catch (error) {
    logger.error('Failed to export tasks', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to export internal tasks.' });
  }
}

async function getRegistrations(req, res) {
  try {
    const {
      search = '',
      sourceType = 'all',
      status = 'all',
      limit = 100,
      offset = 0,
    } = req.query ?? {};

    logger.info('Fetching registered clients', { search, sourceType, status }, 'INTERNAL_TASK_CONTROLLER');
    const result = await registrationQueries.getRegisteredClients({
      search,
      sourceType,
      status,
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
    });

    return res.status(200).json({
      success: true,
      total: result.total,
      data: result.clients,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    logger.error('Failed to fetch registered clients', { error: error.message }, 'INTERNAL_TASK_CONTROLLER');
    return res.status(500).json({ success: false, error: 'Failed to retrieve registered clients.' });
  }
}

async function handleRegistrationAction(req, res) {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body ?? {};

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action provided. Expected "accept" or "reject".',
      });
    }

    logger.info('Processing client registration action', { id, action }, 'INTERNAL_TASK_CONTROLLER');
    const client = await registrationQueries.updateClientRegistrationStatus(id, action, remarks);

    if (!client) {
      return res.status(400).json({
        success: false,
        error: 'Registration record not found or already processed.',
      });
    }

    const actionText = action === 'accept' ? 'ACCEPTED' : 'REJECTED';
    storeService.addAuditLog(
      `Registration ID ${id} was ${actionText} by internal task management.`
    );

    const message = action === 'accept'
      ? 'Client registration accepted successfully.'
      : 'Client registration rejected successfully.';

    return res.status(200).json({
      success: true,
      message,
      client,
    });
  } catch (error) {
    logger.error('Failed to process client registration action', { error: error.message }, 'INTERNAL_TASK_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to update client registration status.',
    });
  }
}

module.exports = {
  getTasks,
  getSummary,
  getAssignees,
  getTaskTypes,
  createTaskType,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  searchEntities,
  exportTasks,
  getRegistrations,
  handleRegistrationAction,
  approveCreditTask,
  rejectCreditTask,
  addTaskActivity,
  checkReminders,
};
