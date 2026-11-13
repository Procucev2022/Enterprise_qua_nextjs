const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');
const { SUPPORT_CHAT_MESSAGES, SUPPORT_CHAT_STATUS } = require('../src/config/constants');
const storeService = require('../src/services/storeService');
const supportChatController = require('../src/controllers/supportChatController');

// No assistant grounded in this application's data is connected. Every message must get an
// explicit not_configured result: no canned reply, no escalation and no support ticket.
describe('Support Chat & AI Assistant API', () => {
  test('POST /api/support-chat returns 503 not_configured instead of a canned reply', async () => {
    const res = await request(app).post('/api/support-chat').set(authHeader('buyer')).send({
      prompt: 'Tell me about subscription plans',
      userRole: 'buyer',
    });

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      status: SUPPORT_CHAT_STATUS.NOT_CONFIGURED,
      reply: null,
      isEscalated: false,
      ticketId: null,
      error: SUPPORT_CHAT_MESSAGES.NOT_CONFIGURED,
    });
  });

  test('POST /api/support-chat does not fake an escalation when the user asks for an agent', async () => {
    const res = await request(app).post('/api/support-chat').set(authHeader('buyer')).send({
      prompt: 'I am not satisfied with this response, connect with agent',
      userRole: 'buyer',
    });

    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.isEscalated).toBe(false);
    expect(res.body.ticketId).toBeNull();
    expect(res.body.reply).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Senior Sourcing Specialist');
  });

  test('POST /api/support-chat returns 400 when prompt is missing', async () => {
    const res = await request(app).post('/api/support-chat').set(authHeader('buyer')).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('forwards an unexpected service failure to the error handler instead of replying', () => {
    const failure = new Error('assistant lookup failed');
    const spy = jest.spyOn(storeService, 'handleSupportChat').mockImplementation(() => {
      throw failure;
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    try {
      supportChatController.sendMessage({ body: { prompt: 'hello' } }, res, next);
    } finally {
      spy.mockRestore();
    }

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('POST /api/support-chat requires authentication', async () => {
    const res = await request(app).post('/api/support-chat').send({ prompt: 'hi' });
    expect(res.statusCode).toBe(401);
  });
});
