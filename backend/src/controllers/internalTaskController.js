// ==============================================================================
// INTERNAL TASK CONTROLLER
// ==============================================================================
// Exposes API handlers for Action Center internal tasks, dynamic entities, and export.
// ==============================================================================

const internalTaskQueries = require('../db/internalTaskQueries');
const { logger } = require('../services/loggerService');

/**
 * List internal tasks with database-side filtering, searching, and pagination.
 */
async function getTasks(req, res) {
  try {
    const {
      search = '',
      status = '',
      priority = '',
      taskTypeId = '',
      relatedEntityType = '',
      assignedTo = '',
      dueFrom = '',
      dueTo = '',
      limit = 50,
      offset = 0,
    } = req.query;

    const result = await internalTaskQueries.getInternalTasks({
      search,
      status,
      priority,
      taskTypeId,
      relatedEntityType,
      assignedTo,
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
    const summary = await internalTaskQueries.getInternalTaskSummary();
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    logger.error('Failed to get internal tasks summary', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch task metrics' });
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

    const actor = req.user || { name: 'Admin', role: 'admin' };
    const task = await internalTaskQueries.createInternalTask(req.body, actor);
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
    const actor = req.user || { name: 'Admin', role: 'admin' };
    const updated = await internalTaskQueries.updateInternalTask(id, req.body, actor);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Task not found to update.' });
    }
    return res.status(200).json({ success: true, task: updated });
  } catch (error) {
    logger.error('Failed to update internal task', { error: error.message });
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
      taskTypeId = '',
      relatedEntityType = '',
      assignedTo = '',
      dueFrom = '',
      dueTo = '',
    } = req.query;

    const result = await internalTaskQueries.getInternalTasks({
      search,
      status,
      priority,
      taskTypeId,
      relatedEntityType,
      assignedTo,
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
        `"${(task.task_type_name || task.task_type_id || '').replace(/"/g, '""')}"`,
        task.priority || 'Medium',
        task.status || 'Pending',
        `"${(task.assigned_to_name || 'Unassigned').replace(/"/g, '""')}"`,
        task.related_entity_type || 'GENERAL',
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

module.exports = {
  getTasks,
  getSummary,
  getTaskTypes,
  createTaskType,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  searchEntities,
  exportTasks,
};
