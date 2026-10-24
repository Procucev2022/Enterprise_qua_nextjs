const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');

describe('Transactional Email HTTP Routes', () => {
  describe('GET /api/transactional-emails/templates', () => {
    test('returns the list of 13 templates', async () => {
      const res = await request(app).get('/api/transactional-emails/templates');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(13);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].templateId).toBe('EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED');
    });
  });

  describe('GET /api/transactional-emails/templates/:id', () => {
    test('returns template details by template number', async () => {
      const res = await request(app).get('/api/transactional-emails/templates/1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.templateNumber).toBe(1);
      expect(res.body.data.subject).toContain('live on Qua AI');
    });

    test('returns 404 for non-existent template', async () => {
      const res = await request(app).get('/api/transactional-emails/templates/999');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/transactional-emails/preview', () => {
    test('returns rendered HTML and text for valid template', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/preview')
        .send({
          templateId: 'EMAIL_4_NEW_RFQ_TO_QUOTE',
          params: {
            first_name: 'Harish',
            rfq_id: 'RFQ-8800',
            rfq_title: 'Centrifugal Compressors',
            credit_balance: 15,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subject).toContain('RFQ-8800');
      expect(res.body.data.text).toContain('Harish');
      expect(res.body.data.html).toContain('Centrifugal Compressors');
    });

    test('returns 400 for invalid body payload', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/preview')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 404 for invalid templateId', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/preview')
        .send({ templateId: 'does_not_exist' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/transactional-emails/send', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/send')
        .send({
          templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
          recipientEmail: 'someone@example.com',
        });

      expect(res.status).toBe(401);
    });

    test('accepts authenticated admin / buyer requests and delivers email', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/send')
        .set(authHeader('admin'))
        .send({
          templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
          recipientEmail: 'someone@example.com',
          params: { first_name: 'Buyer' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.result).toBeDefined();
    });

  });
});
