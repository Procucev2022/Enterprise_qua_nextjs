const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const pool = require('../src/db/pool');
const eventOutboxService = require('../src/services/eventOutboxService');
const { SYSTEM_ACTOR_EMAIL } = require('../src/config/constants');

describe('actionCenterNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('renderActionCenterEmailHtml', () => {
    it('renders html with given params', () => {
      const html = actionCenterNotificationService.renderActionCenterEmailHtml({
        recipientName: 'Acme Corp',
        subject: 'Custom Subject',
        message: 'This is an important message',
        linkUrl: 'https://procucev.com/tasks/123',
        entityType: 'ticket',
        senderName: 'Test CM',
      });

      expect(html).toContain('Acme Corp');
      expect(html).toContain('Custom Subject');
      expect(html).toContain('This is an important message');
      expect(html).toContain('https://procucev.com/tasks/123');
      expect(html).toContain('TICKET ALERT');
      expect(html).toContain('Test CM');
    });

    it('renders "Not specified" for an omitted recipient and sender instead of invented names', () => {
      const html = actionCenterNotificationService.renderActionCenterEmailHtml({});
      expect(html).toContain('Dear <strong>Not specified</strong>');
      expect(html).toContain('Action Center Notification');
      expect(html).toContain('ACTION CENTER ALERT');
      expect(html).toContain('Sent by: <strong>Not specified</strong>');
      expect(html).not.toContain('Valued Partner');
      expect(html).not.toContain('Category Management Team');
    });

    it('handles missing mailerService helper methods gracefully', () => {
      const origGetLogo = mailerService.getLogoUrl;
      const origGetFrontend = mailerService.getPublicFrontendUrl;
      delete mailerService.getLogoUrl;
      delete mailerService.getPublicFrontendUrl;

      const html = actionCenterNotificationService.renderActionCenterEmailHtml({
        subject: 'Fallback Test',
      });
      expect(html).toContain('Fallback Test');

      mailerService.getLogoUrl = origGetLogo;
      mailerService.getPublicFrontendUrl = origGetFrontend;
    });
  });

  describe('dispatchActionCenterCommunication', () => {
    it('persists configured Action Center delivery before returning a queued retry', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const pendingRecord = {
        id: 'comm-durable-pending',
        accountId: 'ticket-queued',
        channel: 'EMAIL',
        deliveryStatus: 'Pending',
        metadata: {},
      };
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue(pendingRecord);
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
        claimed: 0,
        completed: 0,
        retried: 0,
        dead: 0,
      });
      const readSpy = jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(null);
      const mailSpy = jest.spyOn(mailerService, 'deliver');
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask');

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'ticket-queued',
        channel: 'EMAIL',
        recipientEmail: 'vendor@example.test',
        recipientName: 'Vendor',
        subject: 'Review required',
        message: 'Please review the ticket.',
      }, { name: 'Category Manager', email: 'manager@example.test' });

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        deliveryStatus: 'Pending',
        notificationStatus: 'Notification Pending',
        metadata: expect.objectContaining({
          deliveryTemplate: 'action_center',
          deliveryRecipientEmail: 'vendor@example.test',
        }),
      }));
      expect(recordSpy.mock.invocationCallOrder[0]).toBeLessThan(dispatchSpy.mock.invocationCallOrder[0]);
      expect(dispatchSpy).toHaveBeenCalledWith(1, ['communication-delivery:comm-durable-pending']);
      expect(readSpy).toHaveBeenCalledWith('comm-durable-pending');
      expect(mailSpy).not.toHaveBeenCalled();
      expect(taskSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        queued: true,
        communication: pendingRecord,
        emailResult: { success: false, queued: true, error: 'Delivery is queued for retry.' },
      });

      taskSpy.mockRestore();
      mailSpy.mockRestore();
      readSpy.mockRestore();
      dispatchSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('reports configured SMS delivery as queued while its retry is pending', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const pendingRecord = { id: 'comm-sms-pending', channel: 'SMS', deliveryStatus: 'Pending', metadata: {} };
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue(pendingRecord);
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
        claimed: 1, completed: 0, retried: 1, dead: 0,
      });
      const readSpy = jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
        ...pendingRecord,
        metadata: { deliveryChannels: { sms: { success: false } } },
      });

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'supplier_dossier',
        entityId: 'vendor-sms-pending',
        channel: 'SMS',
        recipientPhone: '9123456780',
        message: 'A durable SMS retry should run.',
        metadata: null,
      });

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'SMS',
        deliveryStatus: 'Pending',
        metadata: expect.objectContaining({ deliveryTemplate: undefined }),
      }));
      expect(result).toMatchObject({
        success: true,
        queued: true,
        smsResult: { success: false, queued: true, error: 'Delivery is queued for retry.' },
      });
      expect(result.emailResult).toBeNull();

      readSpy.mockRestore();
      dispatchSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('returns provider-confirmed email and SMS status after configured delivery', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const pendingRecord = { id: 'comm-both-delivered', channel: 'BOTH', deliveryStatus: 'Pending', metadata: {} };
      const deliveredRecord = {
        ...pendingRecord,
        deliveryStatus: 'Delivered',
        metadata: {
          deliveryChannels: {
            email: { success: true, messageId: 'email-accepted' },
            sms: { success: true, messageId: 'sms-accepted' },
          },
        },
      };
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue(pendingRecord);
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
        claimed: 1, completed: 1, retried: 0, dead: 0,
      });
      const readSpy = jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue(deliveredRecord);
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'task-both-sent' });

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'payment_due',
        entityId: 'due-both-sent',
        channel: 'BOTH',
        recipientEmail: 'buyer@example.test',
        recipientPhone: '9123456780',
        message: 'Both delivery channels were accepted.',
        metadata: null,
      });

      expect(result).toMatchObject({
        success: true,
        queued: false,
        communication: deliveredRecord,
        emailResult: { success: true, messageId: 'email-accepted' },
        smsResult: { success: true, messageId: 'sms-accepted' },
      });
      expect(taskSpy).toHaveBeenCalledTimes(1);

      taskSpy.mockRestore();
      readSpy.mockRestore();
      dispatchSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('rejects configured delivery if persistence returns no record identifier', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue(null);
      const mailSpy = jest.spyOn(mailerService, 'deliver');

      await expect(actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'ticket-empty-persistence',
        channel: 'EMAIL',
        recipientEmail: 'buyer@example.test',
        message: 'Do not send without a durable history row.',
      })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

      expect(mailSpy).not.toHaveBeenCalled();
      mailSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('records no-destination requests without entering the configured delivery path', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-no-destination' });
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms');

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'supplier_dossier',
        entityId: 'vendor-no-destination',
        channel: 'SMS',
        recipientName: '',
        recipientEmail: 'fallback@example.test',
        recipientPhone: '',
        message: 'No channel recipient was supplied.',
        metadata: null,
      });

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'fallback@example.test' }));
      expect(smsSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);

      smsSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('does not contact an external provider when configured history persistence fails', async () => {
      const poolSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const persistenceError = Object.assign(new Error('database unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(persistenceError);
      const mailSpy = jest.spyOn(mailerService, 'deliver');

      await expect(actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'ticket-no-history',
        channel: 'EMAIL',
        recipientEmail: 'vendor@example.test',
        message: 'Please review the ticket.',
      })).rejects.toBe(persistenceError);

      expect(mailSpy).not.toHaveBeenCalled();
      mailSpy.mockRestore();
      recordSpy.mockRestore();
      poolSpy.mockRestore();
    });

    it('dispatches EMAIL successfully and creates tasks', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true, success: true, status: 'sent', messageId: 'msg-123' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({
        id: 'comm-1',
        accountId: 'ticket-101',
        channel: 'EMAIL',
      });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'tsk-1' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'ticket',
          entityId: 'ticket-101',
          channel: 'EMAIL',
          recipientEmail: 'vendor@example.com',
          recipientName: 'Vendor X',
          subject: 'Ticket Resolution Update',
          message: 'Your ticket has been marked in progress.',
          scheduleFollowup: {
            dueDate: '2026-11-05',
            priority: 'High',
            assigneeId: 'exec-1',
            assigneeName: 'Test Assignee',
            notes: 'Call vendor to verify delivery',
          },
        },
        { id: 'cm-1', name: 'Category Lead', email: 'cm@procucev.com' }
      );

      expect(deliverSpy).toHaveBeenCalledTimes(1);
      expect(deliverSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'vendor@example.com',
          subject: '[Procucev Alert] Ticket Resolution Update',
          replyTo: 'cm@procucev.com',
        }),
        'ACTION_CENTER_NOTIFICATION'
      );
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(taskSpy).toHaveBeenCalledTimes(2); // completed log task + followup task
      expect(res.success).toBe(true);
      expect(res.emailResult.success).toBe(true);
      expect(res.followupTask).toBeDefined();

      deliverSpy.mockRestore();
      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('records the activity and follow-up tasks under the COMMUNICATION category with a real task type', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true, success: true, status: 'sent', messageId: 'msg-task' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({
        id: 'comm-task',
        accountId: 'ticket-202',
        channel: 'EMAIL',
      });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'tsk-task' });

      await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'ticket-202',
        channel: 'EMAIL',
        recipientEmail: 'vendor@example.com',
        recipientName: 'Vendor Y',
        subject: 'Follow-up check',
        message: 'Please confirm receipt.',
        scheduleFollowup: { dueDate: '2030-01-01T00:00:00.000Z' },
      }, { name: 'Test Manager', email: 'manager@example.test' });

      expect(taskSpy).toHaveBeenCalledTimes(2);
      taskSpy.mock.calls.forEach(([data]) => {
        expect(data.category).toBeUndefined();
        expect(data.taskCategory).toBe('COMMUNICATION');
      });
      expect(taskSpy.mock.calls[0][0].taskType).toBe('Email');
      expect(taskSpy.mock.calls[1][0].taskType).toBe('Existing Follow-up');

      deliverSpy.mockRestore();
      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('handles EMAIL dispatch error gracefully without throwing', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockRejectedValueOnce(new Error('SMTP connection refused'));
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-2' });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValueOnce({ id: 'tsk-2' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'internal_task',
          entityId: 'task-55',
          channel: 'EMAIL',
          recipientEmail: 'broken@example.com',
          message: 'Task alert',
        },
        {}
      );

      expect(res.success).toBe(false);
      expect(res.emailResult.success).toBe(false);
      expect(res.emailResult.error).toContain('SMTP connection refused');
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: 'Failed' }));

      deliverSpy.mockRestore();
      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('reports an explicit email provider refusal when delivery resolves without acceptance', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: false });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-email-refused' });

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'ticket-email-refused',
        channel: 'EMAIL',
        recipientEmail: 'buyer@example.test',
        message: 'Provider did not accept this message.',
      });

      expect(result.emailResult).toMatchObject({ success: false, error: 'Email was not sent.' });
      expect(result.success).toBe(false);
      deliverSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('fails closed when the mailer has no deliver function, and never reports the email as sent', async () => {
      const origDeliver = mailerService.deliver;
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-3' });
      try {
        delete mailerService.deliver;

        const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
          {
            entityType: 'approval',
            entityId: 'appr-1',
            channel: 'EMAIL',
            recipientEmail: 'approver@example.com',
            message: 'Approval pending',
          },
          {}
        );

        expect(res.success).toBe(false);
        expect(res.emailResult).toMatchObject({
          success: false,
          status: 'failed',
          error: 'Email delivery is unavailable: the mailer service has no deliver function.',
        });
        expect(res.emailResult.mock).toBeUndefined();
      } finally {
        mailerService.deliver = origDeliver;
        recordSpy.mockRestore();
      }
    });

    it('dispatches SMS successfully', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({
        success: true,
        messageId: 'sms-msg-1',
        throttled: false,
        renderedMessage: 'Rendered SMS message text',
        isTruncated: false,
      });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-4' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'buyer_dossier',
          entityId: 'buyer-99',
          channel: 'SMS',
          recipientPhone: '9876543210',
          recipientName: 'Buyer Lead',
          message: 'Your credit limit has reached 90%',
        },
        { fullName: 'Admin User' }
      );

      expect(smsSpy).toHaveBeenCalledWith({
        mobile: '9876543210',
        recipientName: 'Buyer Lead',
        message: 'Your credit limit has reached 90%',
        linkUrl: '',
        entityType: 'buyer_dossier',
      });
      expect(res.success).toBe(true);
      expect(res.smsResult.success).toBe(true);
      expect(res.smsResult.messageId).toBe('sms-msg-1');
      expect(res.smsResult.renderedMessage).toBe('Rendered SMS message text');
      expect(res.smsResult.isTruncated).toBe(false);
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            dispatchedSmsText: 'Rendered SMS message text',
            isSmsTruncated: false,
          }),
        })
      );

      smsSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('handles SMS error without throwing', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockRejectedValueOnce(new Error('Gateway timeout'));
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-5' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'supplier_dossier',
          entityId: 'vendor-88',
          channel: 'SMS',
          recipientPhone: '9876543210',
          message: 'RFQ inquiry update',
        },
        {}
      );

      expect(res.success).toBe(false);
      expect(res.smsResult.success).toBe(false);
      expect(res.smsResult.error).toContain('Gateway timeout');

      smsSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('reports a resolved SMS refusal when the provider supplies no error detail', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: false });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-sms-refused' });

      const result = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityType: 'supplier_dossier',
        entityId: 'vendor-sms-refused',
        channel: 'SMS',
        recipientPhone: '9123456780',
        message: 'Provider did not accept this message.',
      });

      expect(result.smsResult).toMatchObject({ success: false, error: 'SMS delivery failed.' });
      expect(result.success).toBe(false);
      smsSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('dispatches BOTH channels and handles follow-up task error safely', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true, success: true, status: 'sent', messageId: 'm-1' });
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: true, messageId: 's-1' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-6' });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockRejectedValueOnce(new Error('Activity task DB error'))
        .mockRejectedValueOnce(new Error('Followup task DB error'));

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'payment_due',
          entityId: 'pd-12',
          channel: 'BOTH',
          recipientEmail: 'finance@buyer.com',
          recipientPhone: '9123456780',
          message: 'Payment overdue statement notice',
          scheduleFollowup: {
            dueDate: '2026-11-10',
          },
        },
        {}
      );

      expect(deliverSpy).toHaveBeenCalledTimes(1);
      expect(smsSpy).toHaveBeenCalledTimes(1);
      expect(res.success).toBe(true);
      expect(res.completedTask).toBeNull();
      expect(res.followupTask).toBeNull();

      deliverSpy.mockRestore();
      smsSpy.mockRestore();
      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('covers all default payload and actor parameter fallbacks', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-def' });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValueOnce({ id: 'tsk-def' });

      // Omit all optional payload fields and call with no actor
      const res = await actionCenterNotificationService.dispatchActionCenterCommunication({
        entityId: 'entity-def',
        channel: null,
        metadata: null,
      });

      expect(res.success).toBe(true);
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: 'internal_task',
          channel: 'EMAIL',
          recipient: undefined,
          communicatedBy: SYSTEM_ACTOR_EMAIL,
          notes: '',
        })
      );

      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('covers actor name and email fallbacks, and message fallback in follow-up task', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-actor' });
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: true, messageId: 's-act' });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockResolvedValueOnce({ id: 'tsk-act-1' })
        .mockResolvedValueOnce({ id: 'tsk-act-2' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'registration',
          entityId: 'reg-44',
          channel: 'SMS',
          recipientPhone: '9988776655',
          recipientName: '',
          subject: '',
          message: '',
          notes: 'Special admin note',
          scheduleFollowup: {
            dueDate: '2026-12-01',
            notes: '',
          },
        },
        { name: 'John Dispatcher', uuid: 'u-444' }
      );

      expect(res.success).toBe(true);
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: '9988776655',
          communicatedBy: 'John Dispatcher',
          notes: 'Special admin note',
        })
      );

      smsSpy.mockRestore();
      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('covers follow-up task default fallback description when both notes and message are empty', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-actor-2' });
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockResolvedValueOnce({ id: 'tsk-act-3' })
        .mockResolvedValueOnce({ id: 'tsk-act-4' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityId: 'reg-empty-msg',
          recipientName: '',
          subject: '',
          message: '',
          notes: '',
          scheduleFollowup: {
            dueDate: '2026-12-05',
          },
        },
        { email: 'dispatcher@procucev.com' }
      );

      expect(res.success).toBe(true);
      expect(taskSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          description: 'Follow up on communication dispatch.',
          assignedToName: 'dispatcher@procucev.com',
          relatedEntityLabel: 'reg-empty-msg',
        }),
        expect.anything()
      );

      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('covers partial success when BOTH channels are requested and email succeeds but SMS fails', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ sent: true, success: true, status: 'sent', messageId: 'm-part-1' });
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: false, error: 'SMS gateway error' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-part-1' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'ticket',
          entityId: 't-part-1',
          channel: 'BOTH',
          recipientEmail: 'user@example.com',
          recipientPhone: '9876543210',
          message: 'Partial test message',
        },
        {}
      );

      expect(res.success).toBe(false);
      expect(res.partialSuccess).toBe(true);
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: 'Partial',
        })
      );

      deliverSpy.mockRestore();
      smsSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('covers partial success when BOTH channels are requested and SMS succeeds but email fails', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockRejectedValueOnce(new Error('SMTP down'));
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: true, messageId: 's-part-2' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-part-2' });

      const res = await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'ticket',
          entityId: 't-part-2',
          channel: 'BOTH',
          recipientEmail: 'user@example.com',
          recipientPhone: '9876543210',
          message: 'Partial test message 2',
        },
        {}
      );

      expect(res.success).toBe(false);
      expect(res.partialSuccess).toBe(true);
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: 'Partial',
        })
      );

      deliverSpy.mockRestore();
      smsSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('covers recipient fallbacks for SMS and EMAIL when primary recipient field is missing', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({ success: true });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication')
        .mockResolvedValueOnce({ id: 'comm-rec-sms' })
        .mockResolvedValueOnce({ id: 'comm-rec-mail' });
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ messageId: 'm-rec' });

      // SMS with no phone, falls back to recipientName
      await actionCenterNotificationService.dispatchActionCenterCommunication({
        channel: 'SMS',
        recipientName: 'Vendor Name Fallback',
        recipientPhone: '',
      });

      expect(recordSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          recipient: 'Vendor Name Fallback',
        })
      );

      // EMAIL with no email, falls back to recipientPhone
      await actionCenterNotificationService.dispatchActionCenterCommunication({
        channel: 'EMAIL',
        recipientEmail: '',
        recipientPhone: '9988776655',
      });

      expect(recordSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          recipient: '9988776655',
        })
      );

      smsSpy.mockRestore();
      deliverSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('covers sanitizeActionUrl and escapeHtml edge-cases', () => {
      const { logger } = require('../src/services/loggerService');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      expect(actionCenterNotificationService.sanitizeActionUrl(null, 'https://fallback.com')).toBe('https://fallback.com');
      expect(actionCenterNotificationService.sanitizeActionUrl('not a valid url', 'https://fallback.com')).toBe('https://fallback.com');
      expect(actionCenterNotificationService.sanitizeActionUrl('javascript:alert(1)', 'https://fallback.com')).toBe('https://fallback.com');
      expect(actionCenterNotificationService.sanitizeActionUrl('http://insecure.com/path', 'https://fallback.com')).toBe('http://insecure.com/path');
      expect(actionCenterNotificationService.sanitizeActionUrl('https://secure.com/path', 'https://fallback.com')).toBe('https://secure.com/path');

      expect(actionCenterNotificationService.escapeHtml(null)).toBe('');
      expect(actionCenterNotificationService.escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
      expect(warnSpy).toHaveBeenCalledWith(
        'Malformed action notification URL; using the configured fallback',
        {},
        'ACTION_CENTER'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Unsupported action notification URL protocol; using the configured fallback',
        {},
        'ACTION_CENTER'
      );
      warnSpy.mockRestore();
    });
  });

  describe('getActionCenterCommunications', () => {
    it('returns filtered and paginated communication items', async () => {
      const mockResult = {
        items: [
          { id: '1', accountId: 'ent-1', accountType: 'ticket', channel: 'EMAIL' },
        ],
        total: 1,
      };
      const querySpy = jest.spyOn(paymentDuesQueries, 'queryCommunications').mockResolvedValueOnce(mockResult);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        entityId: 'ent-1',
        entityType: 'ticket',
        channel: 'EMAIL',
        page: 1,
        pageSize: 10,
      });

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'ent-1',
          entityType: 'ticket',
          channel: 'EMAIL',
          limit: 10,
          offset: 0,
          isCrossAccount: false,
        })
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('1');
      expect(res.pagination.total).toBe(1);

      querySpy.mockRestore();
    });

    it('retrieves all communications when entityId is omitted and filters by ALL channel', async () => {
      const mockResult = {
        items: [
          { id: '1', accountType: 'ticket', channel: 'EMAIL' },
          { id: '2', accountType: 'ticket', channel: 'SMS' },
        ],
        total: 2,
      };
      const querySpy = jest.spyOn(paymentDuesQueries, 'queryCommunications').mockResolvedValueOnce(mockResult);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        channel: 'ALL',
      });

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: '',
          isCrossAccount: true,
        })
      );
      expect(res.items).toHaveLength(2);
      expect(res.pagination.page).toBe(1);

      querySpy.mockRestore();
    });

    it('surfaces a failed history query instead of returning an empty history', async () => {
      const querySpy = jest.spyOn(paymentDuesQueries, 'queryCommunications').mockResolvedValueOnce(null);

      await expect(actionCenterNotificationService.getActionCenterCommunications()).rejects.toMatchObject({
        message: 'Action Center communication history could not be loaded from the database.',
        code: 'COMMUNICATIONS_QUERY_EMPTY',
      });

      querySpy.mockRestore();
    });

    it('filters by metadata.entityType when accountType is missing, handles edge page bounds', async () => {
      const mockResult = {
        items: [{ id: '11', accountType: 'buyer_dossier', channel: 'SMS' }],
        total: 1,
      };
      const querySpy = jest.spyOn(paymentDuesQueries, 'queryCommunications').mockResolvedValueOnce(mockResult);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        entityType: 'buyer_dossier',
        channel: 'SMS',
        page: -5,
        pageSize: 999,
      });

      expect(querySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'buyer_dossier',
          channel: 'SMS',
          limit: 100,
          offset: 0,
        })
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('11');
      expect(res.pagination.page).toBe(1);
      expect(res.pagination.pageSize).toBe(100);

      querySpy.mockRestore();
    });

    it('handles non-numeric page and pageSize strings with default fallbacks', async () => {
      const mockResult = {
        items: [{ id: '99', accountType: 'ticket' }],
        total: 1,
      };
      const querySpy = jest.spyOn(paymentDuesQueries, 'queryCommunications').mockResolvedValueOnce(mockResult);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        page: 'invalid-page',
        pageSize: 'invalid-size',
      });

      expect(res.pagination.page).toBe(1);
      expect(res.pagination.pageSize).toBe(20);
      expect(res.pagination.totalPages).toBe(1);

      querySpy.mockRestore();
    });
  });
});
