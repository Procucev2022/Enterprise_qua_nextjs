const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');

describe('Action Center Communications API Routes', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: {
        sub: 'usr-cm-1',
        email: 'category.lead@procucev.com',
        role: 'category_manager',
        fullName: 'Category Lead',
      },
    });
  });

  test('POST /api/action-center/communications rejects unauthenticated callers with 401', async () => {
    const res = await request(app)
      .post('/api/action-center/communications')
      .send({
        channel: 'EMAIL',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/action-center/communications rejects unauthorized role with 403', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: {
        sub: 'usr-vendor-1',
        email: 'supplier@example.com',
        role: 'vendor',
      },
    });

    const res = await request(app)
      .post('/api/action-center/communications')
      .set('Authorization', 'Bearer vendor-token')
      .send({
        channel: 'EMAIL',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
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
      .set('Authorization', 'Bearer valid-cm-token')
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
      .set('Authorization', 'Bearer valid-cm-token')
      .send({
        channel: 'INVALID_CHANNEL',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/action-center/communications rejects unauthenticated callers with 401', async () => {
    const res = await request(app)
      .get('/api/action-center/communications');

    expect(res.status).toBe(401);
  });

  test('GET /api/action-center/communications retrieves communication history for authorized user', async () => {
    const getSpy = jest
      .spyOn(actionCenterNotificationService, 'getActionCenterCommunications')
      .mockResolvedValueOnce({
        items: [{ id: 'comm-r-1', channel: 'SMS' }],
        pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
      });

    const res = await request(app)
      .get('/api/action-center/communications?entityType=ticket&entityId=tkt-88')
      .set('Authorization', 'Bearer valid-cm-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.items).toHaveLength(1);

    getSpy.mockRestore();
  });

  test('POST /api/action-center/communications/webhook rejects unauthenticated webhook with 401', async () => {
    const res = await request(app)
      .post('/api/action-center/communications/webhook')
      .send({
        accountId: 'acc-200',
        acknowledgementStatus: 'Acknowledged',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/action-center/communications/webhook updates delivery status with valid secret', async () => {
    const updateSpy = jest
      .spyOn(paymentDuesQueries, 'updateAcknowledgementStatus')
      .mockResolvedValueOnce({ id: 'comm-10', acknowledgementStatus: 'Acknowledged' });

    const res = await request(app)
      .post('/api/action-center/communications/webhook')
      .set('x-webhook-secret', 'procucev-dlt-webhook-secret')
      .send({
        communicationId: 'comm-10',
        accountId: 'acc-200',
        acknowledgementStatus: 'Acknowledged',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        communicationId: 'comm-10',
        accountId: 'acc-200',
        acknowledgementStatus: 'Acknowledged',
      })
    );

    updateSpy.mockRestore();
  });
});
