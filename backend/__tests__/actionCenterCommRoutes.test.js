const request = require('supertest');
const app = require('../src/app');
const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');

describe('Action Center Communications API Routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('POST /api/action-center/communications validates payload and dispatches message', async () => {
    const dispatchSpy = jest
      .spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
      .mockResolvedValueOnce({
        success: true,
        communication: { id: 'comm-route-1' },
      });

    const res = await request(app)
      .post('/api/action-center/communications')
      .set('x-user-email', 'category.lead@procucev.com')
      .send({
        entityType: 'internal_task',
        entityId: 'tsk-999',
        channel: 'EMAIL',
        recipientEmail: 'contractor@example.com',
        recipientName: 'Contractor A',
        subject: 'Procurement Notice',
        message: 'Please review specifications.',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.communication).toBeDefined();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    dispatchSpy.mockRestore();
  });

  test('POST /api/action-center/communications rejects invalid request with 400', async () => {
    const res = await request(app)
      .post('/api/action-center/communications')
      .send({
        channel: 'INVALID_CHANNEL',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/action-center/communications retrieves communication history', async () => {
    const getSpy = jest
      .spyOn(actionCenterNotificationService, 'getActionCenterCommunications')
      .mockResolvedValueOnce({
        items: [{ id: 'comm-r-1', channel: 'SMS' }],
        pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      });

    const res = await request(app)
      .get('/api/action-center/communications?entityType=ticket&entityId=tkt-88');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.items).toHaveLength(1);

    getSpy.mockRestore();
  });

  test('POST /api/action-center/communications/webhook updates delivery status', async () => {
    const updateSpy = jest
      .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
      .mockResolvedValueOnce({ id: 'comm-10', acknowledgementStatus: 'Acknowledged' });

    const res = await request(app)
      .post('/api/action-center/communications/webhook')
      .send({
        accountId: 'acc-200',
        acknowledgementStatus: 'Acknowledged',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    updateSpy.mockRestore();
  });
});

