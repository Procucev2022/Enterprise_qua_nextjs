// internalTaskController imports its validator by destructuring, so the validator module is
// wrapped here. Real validation runs unless a test sets a validator result. Task storage and
// notification dispatch are spied at their module boundaries.
jest.mock('../src/config/validationSchemas', () => {
  const actual = jest.requireActual('../src/config/validationSchemas');
  return { ...actual, validatePayload: jest.fn() };
});

const internalTaskController = require('../src/controllers/internalTaskController');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const validationSchemas = require('../src/config/validationSchemas');
const actualValidationSchemas = jest.requireActual('../src/config/validationSchemas');
const { logger } = require('../src/services/loggerService');
const { AUTH_MESSAGES, PERSISTENCE_MESSAGES } = require('../src/config/constants');

const SESSION_USER = { role: 'admin', email: 'staff@procucev.test', name: 'Staff Admin', sub: 'staff-1' };
const VALID_VALIDATION = { isValid: true, errors: {}, sanitizedData: {} };
const INVALID_EMPTY_VALIDATION = { isValid: false, errors: {}, sanitizedData: {} };

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('internalTaskController branches', () => {
  const savedEnv = {
    CREDIT_APPROVER_EMAIL: process.env.CREDIT_APPROVER_EMAIL,
    ADMIN_NOTIFICATION_EMAIL: process.env.ADMIN_NOTIFICATION_EMAIL,
  };

  beforeEach(() => {
    validationSchemas.validatePayload.mockImplementation((...args) => actualValidationSchemas.validatePayload(...args));
    delete process.env.CREDIT_APPROVER_EMAIL;
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('task list error mapping', () => {
    test('answers 401 when the task query reports that no session is present', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(
        Object.assign(new Error('no actor'), { code: 'ACTOR_REQUIRED' })
      );
      const res = mockRes();

      await internalTaskController.getTasks({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    });

    test('answers with the status carried by a validation error', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(
        Object.assign(new Error('Invalid due date range.'), { code: 'VALIDATION_FAILED', statusCode: 422 })
      );
      const res = mockRes();

      await internalTaskController.getTasks({ query: { dueFrom: '2026-12-01', dueTo: '2026-01-01' } }, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid due date range.' });
    });

    test('defaults a validation error with no status to 400', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(
        Object.assign(new Error('Invalid sort order.'), { code: 'VALIDATION_FAILED' })
      );
      const res = mockRes();

      await internalTaskController.getTasks({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid sort order.' });
    });

    test('answers 503 with the database message when task storage is unavailable', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(
        Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const res = mockRes();

      await internalTaskController.getTasks({ query: {} }, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
        retryable: true,
      });
    });

    test('falls back to the default limit and offset when they are not numbers', async () => {
      const listSpy = jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({ rows: [], total: 0 });
      const res = mockRes();

      await internalTaskController.getTasks({ query: { limit: 'lots', offset: 'later' } }, res);

      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });
  });

  describe('createTask', () => {
    const TASK_BODY = { title: 'Replace seal', taskCategory: 'COMMUNICATION' };

    test('rejects a payload the validator marks invalid without naming a field', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(INVALID_EMPTY_VALIDATION);
      const createSpy = jest.spyOn(internalTaskQueries, 'createInternalTask');
      const res = mockRes();

      await internalTaskController.createTask({ body: TASK_BODY, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid task input.', errors: {} });
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('refuses task creation when no session user is present', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      const createSpy = jest.spyOn(internalTaskQueries, 'createInternalTask');
      const res = mockRes();

      await internalTaskController.createTask({ body: TASK_BODY }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('creates the task without a notice when no assignee list is available', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
        id: 'tsk-1',
        task_number: 'TSK-1',
        title: 'Replace seal',
        assigned_to_name: 'Assignee One',
        assigned_to_user_id: 'mem-1',
        priority: 'High',
        due_date: '2026-11-01',
      });
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue(null);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication');
      const res = mockRes();

      await internalTaskController.createTask({ body: TASK_BODY, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('sends the assignment notice to an assignee matched by id', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
        id: 'tsk-2',
        task_number: 'TSK-2',
        title: 'Replace seal',
        assigned_to_name: 'Label Not In Roster',
        assigned_to_user_id: 'mem-1',
        priority: 'Medium',
        due_date: null,
      });
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { id: 'mem-1', name: 'Assignee One', email: 'assignee-one@procucev.test' },
      ]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
      const res = mockRes();

      await internalTaskController.createTask({ body: TASK_BODY, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'internal_task',
          recipientEmail: 'assignee-one@procucev.test',
          message: expect.stringContaining('Due: No deadline.'),
        }),
        SESSION_USER
      );
    });

    test('skips the assignment notice when the matched assignee has no email', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
        id: 'tsk-3',
        task_number: 'TSK-3',
        title: 'Replace seal',
        assigned_to_name: 'Assignee One',
        assigned_to_user_id: 'mem-1',
        priority: 'Low',
      });
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([{ id: 'mem-1', name: 'Assignee One' }]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication');
      const res = mockRes();

      await internalTaskController.createTask({ body: TASK_BODY, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('tells the approver "Not recorded" for each credit detail that is missing', async () => {
      process.env.CREDIT_APPROVER_EMAIL = 'approver@procucev.test';
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
        id: 'tsk-credit',
        task_number: 'TSK-CR-1',
        title: 'Credit request',
        task_category: 'CREDIT_MANAGEMENT',
        status: 'Pending Approval',
        assigned_to_name: 'Unassigned',
        credit_account_name: null,
        credit_quantity: null,
        credit_reason: '',
      });
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
      const res = mockRes();

      await internalTaskController.createTask({ body: { title: 'Credit request' }, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'approver@procucev.test',
          message: expect.stringContaining('Target Account: Not recorded. Quantity: Not recorded. Reason: Not recorded.'),
        }),
        SESSION_USER
      );
    });

    test('keeps the task created and logs a warning when the approver notice fails', async () => {
      process.env.ADMIN_NOTIFICATION_EMAIL = 'admin-alerts@procucev.test';
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
        id: 'tsk-credit-2',
        task_number: 'TSK-CR-2',
        title: 'Credit request',
        task_category: 'CREDIT_MANAGEMENT',
        assigned_to_name: 'Unassigned',
        credit_account_name: 'Buyer Org One',
        credit_quantity: 50,
        credit_reason: 'Seasonal top-up',
      });
      jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockRejectedValue(new Error('smtp down'));
      const warnSpy = jest.spyOn(logger, 'warn');
      const res = mockRes();

      await internalTaskController.createTask({ body: { title: 'Credit request' }, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to dispatch credit approval notification',
        { error: 'smtp down' },
        'INTERNAL_TASK_CONTROLLER'
      );
    });
  });

  describe('updateTask', () => {
    test('refuses an update when no session user is present', async () => {
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask');
      const res = mockRes();

      await internalTaskController.updateTask({ params: { id: 'tsk-1' }, body: { status: 'In Progress' } }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test('rejects an update the validator marks invalid without naming a field', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(INVALID_EMPTY_VALIDATION);
      const res = mockRes();

      await internalTaskController.updateTask({ params: { id: 'tsk-1' }, body: { status: 'In Progress' }, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid update parameters.', errors: {} });
    });

    test('refuses to complete a communication task without confirmation, even with short notes', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask');
      const res = mockRes();

      await internalTaskController.updateTask({
        params: { id: 'tsk-1' },
        body: {
          taskCategory: 'COMMUNICATION',
          status: 'Completed',
          completionConfirmed: false,
          actionOutcome: '',
          activityComment: 'ok',
          completionRemarks: 'no',
        },
        user: SESSION_USER,
      }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.stringContaining('require explicit confirmation'),
      }));
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test.each([
      ['an explicit completion confirmation', { completionConfirmed: true }],
      ['an action outcome', { actionOutcome: 'Reached the buyer' }],
      ['a detailed activity comment', { activityComment: 'Buyer confirmed the order' }],
      ['detailed completion remarks', { completionRemarks: 'Order closed with the vendor' }],
    ])('accepts a communication completion backed by %s', async (_label, evidence) => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      const updateSpy = jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        id: 'tsk-9',
        task_number: 'TSK-9',
        title: 'Call buyer',
        status: 'Completed',
      });
      const res = mockRes();

      await internalTaskController.updateTask({
        params: { id: 'tsk-9' },
        body: { taskCategory: 'COMMUNICATION', status: 'Completed', ...evidence },
        user: SESSION_USER,
      }, res);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('addresses the status notice to the requester email when no requester name is recorded', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        id: 'tsk-10',
        task_number: 'TSK-10',
        title: 'Follow up',
        status: 'In Progress',
        created_by_user_id: 'u-7',
        raw: { created_by_email: 'requester@buyer.test' },
      });
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
      const res = mockRes();

      await internalTaskController.updateTask({
        params: { id: 'tsk-10' },
        body: { status: 'In Progress' },
        user: SESSION_USER,
      }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'requester@buyer.test', recipientName: 'requester@buyer.test' }),
        SESSION_USER
      );
    });

    test('keeps the update successful and logs a warning when the requester notice fails', async () => {
      validationSchemas.validatePayload.mockReturnValueOnce(VALID_VALIDATION);
      jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
        id: 'tsk-11',
        task_number: 'TSK-11',
        title: 'Follow up',
        status: 'Completed',
        created_by_user_id: 'u-8',
        created_by_name: 'Requester One',
        raw: { created_by_email: 'requester-one@buyer.test' },
      });
      jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockRejectedValue(new Error('mail relay down'));
      const warnSpy = jest.spyOn(logger, 'warn');
      const res = mockRes();

      await internalTaskController.updateTask({
        params: { id: 'tsk-11' },
        body: { status: 'Completed', completionConfirmed: true, taskCategory: 'COMMUNICATION' },
        user: SESSION_USER,
      }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to dispatch task status update notification',
        { error: 'mail relay down' },
        'INTERNAL_TASK_CONTROLLER'
      );
    });
  });

  describe('addTaskActivity', () => {
    test('refuses an activity note when no session user is present', async () => {
      const addSpy = jest.spyOn(internalTaskQueries, 'addTaskActivity');
      const res = mockRes();

      await internalTaskController.addTaskActivity({ params: { id: 'tsk-1' }, body: { comment: 'Called the buyer' } }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(addSpy).not.toHaveBeenCalled();
    });

    test('treats a missing comment as blank', async () => {
      const addSpy = jest.spyOn(internalTaskQueries, 'addTaskActivity');
      const res = mockRes();

      await internalTaskController.addTaskActivity({ params: { id: 'tsk-1' }, body: {}, user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Comment or note cannot be blank.' });
      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkReminders', () => {
    const OVERDUE_TASK = {
      id: 'tsk-1',
      task_number: 'TSK-1',
      title: 'Inspect pump',
      assigned_to_name: 'Assignee One',
      due_date: '2026-11-01',
    };

    test('refuses a reminder run when no session user is present', async () => {
      const overdueSpy = jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks');
      const res = mockRes();

      await internalTaskController.checkReminders({}, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(overdueSpy).not.toHaveBeenCalled();
    });

    test('reports an empty evaluation when the task and assignee lists are missing', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue(null);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue(null);
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 0, dispatched: 0, tasks: [] }));
    });

    test('dispatches a reminder to an assignee matched by name', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([OVERDUE_TASK]);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { id: 'mem-1', name: 'Assignee One', email: 'assignee-one@procucev.test' },
      ]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'assignee-one@procucev.test', subject: expect.stringContaining('TSK-1') }),
        SESSION_USER
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 1, dispatched: 1 }));
    });

    test('matches an assignee by user id when the task label does not match any name', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([
        { ...OVERDUE_TASK, assigned_to_name: 'Former Label', assigned_to_user_id: 'MEM-2' },
      ]);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { id: 'mem-2', name: 'Assignee Two', email: 'assignee-two@procucev.test' },
      ]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'assignee-two@procucev.test' }),
        SESSION_USER
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dispatched: 1 }));
    });

    test('does not dispatch for a task whose assignee cannot be matched to anyone', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([
        { ...OVERDUE_TASK, assigned_to_name: 'Unknown Person', assigned_to_user_id: null },
      ]);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { id: 'mem-1', name: 'Assignee One', email: 'assignee-one@procucev.test' },
      ]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication');
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 1, dispatched: 0 }));
    });

    test('ignores assignee entries that carry neither a name nor an id', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([OVERDUE_TASK]);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { email: 'anonymous-one@procucev.test' },
        { name: '', id: '', email: 'anonymous-two@procucev.test' },
      ]);
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication');
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ dispatched: 0 }));
    });

    test('counts a reminder that fails to dispatch as not sent and logs it', async () => {
      jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([OVERDUE_TASK]);
      jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
        { id: 'mem-1', name: 'Assignee One', email: 'assignee-one@procucev.test' },
      ]);
      jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockRejectedValue(new Error('relay refused'));
      const warnSpy = jest.spyOn(logger, 'warn');
      const res = mockRes();

      await internalTaskController.checkReminders({ user: SESSION_USER }, res);

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to dispatch reminder notification',
        { error: 'relay refused' },
        'INTERNAL_TASK_CONTROLLER'
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 1, dispatched: 0 }));
    });
  });

  describe('exportTasks', () => {
    test('writes an empty type cell for a task that records no type', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
        rows: [{ id: 'tsk-untyped', title: 'No type', status: 'Open' }],
        total: 1,
      });
      const res = mockRes();

      await internalTaskController.exportTasks({ query: {} }, res);

      const csv = res.send.mock.calls[0][0];
      expect(csv).toContain('"No type","",""');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
