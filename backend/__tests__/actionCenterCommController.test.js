const actionCenterCommController = require('../src/controllers/actionCenterCommController');
const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');

describe('actionCenterCommController', () => {
  let req;
  let res;

  beforeEach(() => {
    process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET = 'procucev-dlt-webhook-secret';
    req = {
      body: {},
      query: {},
      headers: {
        'x-webhook-secret': 'procucev-dlt-webhook-secret',
      },
      user: null,
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    jest.clearAllMocks();
  });

  describe('dispatchCommunication', () => {
    it('returns 400 when payload is invalid', async () => {
      req.body = {
        // Missing entityType, entityId, message, etc.
      };

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid communication payload.',
        })
      );
    });

    it('returns 400 when EMAIL channel lacks recipientEmail', async () => {
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-100',
        channel: 'EMAIL',
        message: 'Notification body',
      };

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'A valid recipient email address is required for Email dispatch.',
        })
      );
    });

    it('returns 400 when SMS channel lacks recipientPhone', async () => {
      req.body = {
        entityType: 'ticket',
        entityId: 'tkt-200',
        channel: 'SMS',
        message: 'SMS notification body',
      };

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'A valid recipient phone number is required for SMS dispatch.',
        })
      );
    });

    it('returns 200 on successful dispatch with authenticated user', async () => {
      req.user = { id: 'u-1', fullName: 'Navin Lead', email: 'navin@procucev.com' };
      req.body = {
        entityType: 'ticket',
        entityId: 'tkt-200',
        channel: 'EMAIL',
        recipientEmail: 'client@example.com',
        recipientName: 'Client X',
        subject: 'Resolution ETA',
        message: 'We are investigating your issue.',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-123' },
          emailResult: { success: true },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Communication dispatched and recorded successfully.',
          communication: { id: 'comm-123' },
        })
      );

      dispatchSpy.mockRestore();
    });

    it('covers resolveActor with uuid and name fallback', async () => {
      req.user = { uuid: 'uuid-999', name: 'Agent Smith' };
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-user',
        channel: 'EMAIL',
        recipientEmail: 'agent@example.com',
        message: 'Resolving actor test',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-user' },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'uuid-999',
          name: 'Agent Smith',
          email: null,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      dispatchSpy.mockRestore();
    });

    it('covers resolveActor with email fallback and empty user object', async () => {
      req.user = { email: 'onlyemail@example.com' };
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-email',
        channel: 'EMAIL',
        recipientEmail: 'target@example.com',
        message: 'Resolving actor email test',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-email' },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: null,
          name: 'onlyemail@example.com',
          email: 'onlyemail@example.com',
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      dispatchSpy.mockRestore();
    });

    it('covers resolveActor with empty user object fallback to Category Manager', async () => {
      req.user = {};
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-empty',
        channel: 'EMAIL',
        recipientEmail: 'target@example.com',
        message: 'Resolving actor empty test',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-empty' },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: null,
          name: 'Category Manager',
          email: null,
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      dispatchSpy.mockRestore();
    });

    it('covers resolveActor with null user falling back to Category Manager', async () => {
      req.user = null;
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-null-user',
        channel: 'EMAIL',
        recipientEmail: 'target@example.com',
        message: 'Resolving actor null test',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-hdr' },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Category Manager',
          email: null,
        })
      );

      dispatchSpy.mockRestore();
    });

    it('returns 200 with partial failure message when dispatch success is false', async () => {
      req.headers['x-user-email'] = 'lead@procucev.com';
      req.body = {
        entityType: 'approval',
        entityId: 'appr-50',
        channel: 'SMS',
        recipientPhone: '9876543210',
        message: 'Approval alert',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: false,
          communication: { id: 'comm-456' },
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Communication dispatch partially failed, but record was stored.',
        })
      );

      dispatchSpy.mockRestore();
    });

    it('returns 200 with followup warning message when followup task creation fails', async () => {
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-fol-err',
        channel: 'EMAIL',
        recipientEmail: 'someone@example.com',
        message: 'Notification with follow-up',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValueOnce({
          success: true,
          communication: { id: 'comm-fol-err' },
          followupError: 'Failed to assign follow-up task',
        });

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Communication dispatched, but scheduling follow-up task failed.',
          followupError: 'Failed to assign follow-up task',
        })
      );

      dispatchSpy.mockRestore();
    });

    it('returns 500 when service throws error', async () => {
      req.body = {
        entityType: 'internal_task',
        entityId: 'tsk-error',
        channel: 'EMAIL',
        recipientEmail: 'test@example.com',
        message: 'Hello world',
      };

      const dispatchSpy = jest
        .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockRejectedValueOnce(new Error('Fatal DB connection error'));

      await actionCenterCommController.dispatchCommunication(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'An internal server error occurred while dispatching the communication.',
        })
      );

      dispatchSpy.mockRestore();
    });
  });

  describe('getCommunications', () => {
    it('returns 200 with retrieved items and pagination', async () => {
      req.query = { entityType: 'ticket', entityId: 'tkt-1' };
      const getSpy = jest
        .spyOn(actionCenterNotificationService, 'getActionCenterCommunications')
        .mockResolvedValueOnce({
          items: [{ id: 'comm-1', subject: 'Subject A' }],
          pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
        });

      await actionCenterCommController.getCommunications(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        items: [{ id: 'comm-1', subject: 'Subject A' }],
        pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      });

      getSpy.mockRestore();
    });

    it('returns 400 when query validation fails', async () => {
      req.query = { pageSize: -5 };

      await actionCenterCommController.getCommunications(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid query parameters.',
        })
      );
    });

    it('returns 500 when getActionCenterCommunications throws', async () => {
      req.query = {};
      const getSpy = jest
        .spyOn(actionCenterNotificationService, 'getActionCenterCommunications')
        .mockRejectedValueOnce(new Error('Query timeout'));

      await actionCenterCommController.getCommunications(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to retrieve communication records.',
        })
      );

      getSpy.mockRestore();
    });
  });

  describe('handleDeliveryWebhook', () => {
    it('returns 401 when webhook authentication signature is missing', async () => {
      req.headers = {};
      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing webhook authentication signature.',
        })
      );
    });

    it('returns 401 when webhook authentication signature is invalid', async () => {
      req.headers = { 'x-webhook-secret': 'invalid-secret' };
      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid webhook authentication signature.',
        })
      );
    });

    it('returns 401 when webhook authentication is not configured on server', async () => {
      const orig = process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET;
      delete process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET;
      delete process.env.ACTION_CENTER_WEBHOOK_SECRET;
      delete process.env.WEBHOOK_SECRET;

      req.headers = { 'x-webhook-secret': 'some-secret' };
      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Webhook authentication is not configured.',
        })
      );

      process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET = orig;
    });

    it('returns 400 when req.body is undefined or null', async () => {
      req.body = undefined;

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'accountId is required.',
      });
    });

    it('returns 400 when accountId is missing', async () => {
      req.body = { acknowledgementStatus: 'Delivered' };

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'accountId is required.',
      });
    });

    it('returns 200 on successful status update with full details', async () => {
      req.body = {
        accountId: 'acc-101',
        acknowledgementStatus: 'Delivered',
        deliveryStatus: 'Delivered',
        notes: 'Carrier delivered',
      };

      const updateSpy = jest
        .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
        .mockResolvedValueOnce({ id: 'comm-1', acknowledgementStatus: 'Delivered' });

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(updateSpy).toHaveBeenCalledWith({
        accountId: 'acc-101',
        acknowledgementStatus: 'Delivered',
        notes: 'Carrier delivered',
        updatedBy: 'Category Manager',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Communication status updated successfully.',
        })
      );

      updateSpy.mockRestore();
    });

    it('returns 200 with fallback default notes and acknowledgementStatus', async () => {
      req.body = {
        accountId: 'acc-defaults',
      };

      const updateSpy = jest
        .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
        .mockResolvedValueOnce({ id: 'comm-def', acknowledgementStatus: 'Acknowledged' });

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(updateSpy).toHaveBeenCalledWith({
        accountId: 'acc-defaults',
        acknowledgementStatus: 'Acknowledged',
        notes: 'Webhook updated status to Acknowledged',
        updatedBy: 'Category Manager',
      });
      expect(res.status).toHaveBeenCalledWith(200);

      updateSpy.mockRestore();
    });

    it('returns 200 and passes communicationId when provided', async () => {
      req.body = {
        communicationId: 'comm-exact-99',
        accountId: 'acc-101',
        acknowledgementStatus: 'Delivered',
        notes: 'Delivered to recipient',
      };

      const updateSpy = jest
        .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
        .mockResolvedValueOnce({ id: 'comm-exact-99', acknowledgementStatus: 'Delivered' });

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(updateSpy).toHaveBeenCalledWith({
        communicationId: 'comm-exact-99',
        accountId: 'acc-101',
        acknowledgementStatus: 'Delivered',
        notes: 'Delivered to recipient',
        updatedBy: 'Category Manager',
      });
      expect(res.status).toHaveBeenCalledWith(200);

      updateSpy.mockRestore();
    });

    it('returns 500 when webhook update throws error', async () => {
      req.body = { accountId: 'acc-err' };

      const updateSpy = jest
        .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
        .mockRejectedValueOnce(new Error('DB failure'));

      await actionCenterCommController.handleDeliveryWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Failed to process delivery status webhook.',
        })
      );

      updateSpy.mockRestore();
    });
  });

  describe('timingSafeCompare', () => {
    it('returns true for matching strings', () => {
      expect(actionCenterCommController.timingSafeCompare('secret-123', 'secret-123')).toBe(true);
    });

    it('returns false for non-matching strings', () => {
      expect(actionCenterCommController.timingSafeCompare('secret-123', 'secret-456')).toBe(false);
    });

    it('returns false when first or second argument is not a string', () => {
      expect(actionCenterCommController.timingSafeCompare(null, 'secret')).toBe(false);
      expect(actionCenterCommController.timingSafeCompare('secret', undefined)).toBe(false);
      expect(actionCenterCommController.timingSafeCompare(123, 123)).toBe(false);
    });
  });
});
