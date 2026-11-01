const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const internalTaskQueries = require('../src/db/internalTaskQueries');

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
        senderName: 'Navin CM',
      });

      expect(html).toContain('Acme Corp');
      expect(html).toContain('Custom Subject');
      expect(html).toContain('This is an important message');
      expect(html).toContain('https://procucev.com/tasks/123');
      expect(html).toContain('TICKET ALERT');
      expect(html).toContain('Navin CM');
    });

    it('renders html with default fallback values when params omitted', () => {
      const html = actionCenterNotificationService.renderActionCenterEmailHtml({});
      expect(html).toContain('Valued Partner');
      expect(html).toContain('Action Center Notification');
      expect(html).toContain('ACTION CENTER ALERT');
      expect(html).toContain('Category Management Team');
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
    it('dispatches EMAIL successfully and creates tasks', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ messageId: 'msg-123' });
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
            assigneeName: 'Pavani',
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

    it('handles mock email deliver branch when deliver is not a function', async () => {
      const origDeliver = mailerService.deliver;
      delete mailerService.deliver;
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-3' });

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

      expect(res.success).toBe(true);
      expect(res.emailResult.mock).toBe(true);

      mailerService.deliver = origDeliver;
      recordSpy.mockRestore();
    });

    it('dispatches SMS successfully', async () => {
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockResolvedValueOnce({
        success: true,
        messageId: 'sms-msg-1',
        throttled: false,
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

    it('dispatches BOTH channels and handles follow-up task error safely', async () => {
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValueOnce({ messageId: 'm-1' });
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
          recipient: 'Partner',
          communicatedBy: 'Category Manager',
          notes: '',
        })
      );

      recordSpy.mockRestore();
      taskSpy.mockRestore();
    });

    it('covers actor name and email fallbacks, and message fallback in follow-up task', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValueOnce({ id: 'comm-actor' });
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
  });

  describe('getActionCenterCommunications', () => {
    it('returns filtered and paginated communication items', async () => {
      const mockRecords = [
        { id: '1', accountId: 'ent-1', accountType: 'ticket', channel: 'EMAIL' },
        { id: '2', accountId: 'ent-1', accountType: 'ticket', channel: 'SMS' },
        { id: '3', accountId: 'ent-2', accountType: 'approval', channel: 'EMAIL' },
      ];
      const getHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce(mockRecords);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        entityId: 'ent-1',
        entityType: 'ticket',
        channel: 'EMAIL',
        page: 1,
        pageSize: 10,
      });

      expect(getHistorySpy).toHaveBeenCalledWith('ent-1');
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('1');
      expect(res.pagination.total).toBe(1);

      getHistorySpy.mockRestore();
    });

    it('retrieves all communications when entityId is omitted and filters by ALL channel', async () => {
      const mockRecords = [
        { id: '1', accountType: 'ticket', channel: 'EMAIL' },
        { id: '2', accountType: 'ticket', channel: 'SMS' },
      ];
      const getHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce(mockRecords);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        channel: 'ALL',
      });

      expect(getHistorySpy).toHaveBeenCalledWith('');
      expect(res.items).toHaveLength(2);
      expect(res.pagination.page).toBe(1);

      getHistorySpy.mockRestore();
    });

    it('handles non-array response from database gracefully', async () => {
      const getHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce(null);

      const res = await actionCenterNotificationService.getActionCenterCommunications();
      expect(res.items).toEqual([]);
      expect(res.pagination.total).toBe(0);

      getHistorySpy.mockRestore();
    });

    it('filters by metadata.entityType when accountType is missing, handles edge page bounds', async () => {
      const mockRecords = [
        { id: '10', accountType: null, metadata: { entityType: 'buyer_dossier' }, channel: null },
        { id: '11', accountType: 'buyer_dossier', channel: 'SMS' },
        { id: '12', accountType: 'other' },
      ];
      const getHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce(mockRecords);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        entityType: 'buyer_dossier',
        channel: 'SMS',
        page: -5,
        pageSize: 999,
      });

      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe('11');
      expect(res.pagination.page).toBe(1);
      expect(res.pagination.pageSize).toBe(100);

      getHistorySpy.mockRestore();
    });

    it('handles non-numeric page and pageSize strings with default fallbacks', async () => {
      const mockRecords = [{ id: '99', accountType: 'ticket' }];
      const getHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValueOnce(mockRecords);

      const res = await actionCenterNotificationService.getActionCenterCommunications({
        page: 'invalid-page',
        pageSize: 'invalid-size',
      });

      expect(res.pagination.page).toBe(1);
      expect(res.pagination.pageSize).toBe(20);
      expect(res.pagination.totalPages).toBe(1);

      getHistorySpy.mockRestore();
    });
  });
});
