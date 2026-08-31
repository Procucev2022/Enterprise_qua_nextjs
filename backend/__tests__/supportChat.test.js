const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');

describe('Support Chat & AI Assistant API', () => {
  test('POST /api/support-chat returns standard response for general query', async () => {
    const res = await request(app).post('/api/support-chat').send({
      prompt: 'Tell me about subscription plans',
      userRole: 'buyer',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toContain('Version 1');
    expect(res.body.isEscalated).toBe(false);
  });

  test('POST /api/support-chat detects dissatisfaction and escalates to human agent', async () => {
    const res = await request(app).post('/api/support-chat').send({
      prompt: 'I am not satisfied with this response, connect with agent',
      userRole: 'buyer',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isEscalated).toBe(true);
    expect(res.body.ticketId).toBeDefined();
    expect(res.body.reply).toContain('Senior Sourcing Specialist');
  });

  test('POST /api/support-chat returns 400 when prompt is missing', async () => {
    const res = await request(app).post('/api/support-chat').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
