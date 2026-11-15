const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');

jest.setTimeout(30000);

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
    test('returns template metadata by template number without body or placeholder fields', async () => {
      const res = await request(app).get('/api/transactional-emails/templates/1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.templateNumber).toBe(1);
      expect(res.body.data.subject).toContain('live on Qua AI');
      expect(res.body.data.subjectPlaceholders).toEqual(['rfq_id']);
      expect(res.body.data).not.toHaveProperty('bodyTemplate');
      expect(res.body.data).not.toHaveProperty('requiredPlaceholders');
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
            item_count: 3,
            credit_balance: 15,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subject).toContain('RFQ-8800');
      expect(res.body.data.text).toContain('Harish');
      expect(res.body.data.html).toContain('Centrifugal Compressors');
    });

    test('returns 400 naming the missing field when required template data is absent', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/preview')
        .send({
          templateId: 'EMAIL_4_NEW_RFQ_TO_QUOTE',
          params: { first_name: 'Harish', rfq_title: 'Centrifugal Compressors' },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("'rfq_id'");
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

    test('reports success false and status skipped when no email provider accepted the message', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/send')
        .set(authHeader('admin'))
        .send({
          templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
          recipientEmail: 'buyer.test@procucev-test.invalid',
          params: {
            first_name: 'Buyer',
            rfq_id: 'RFQ-8801',
            email: 'buyer.test@procucev-test.invalid',
            temp_password: 'temporary-test-value',
          },
        });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['message', 'result', 'success']);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe(
        'Transactional email EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED was not sent. Delivery status: skipped. No email provider accepted it.'
      );
      expect(res.body.result).toMatchObject({ sent: false, success: false, status: 'skipped' });
    });

    test('returns 400 naming the missing field when the send is missing required template data', async () => {
      const res = await request(app)
        .post('/api/transactional-emails/send')
        .set(authHeader('admin'))
        .send({
          templateId: 'EMAIL_1_RFQ_CREATED_ACCOUNT_AUTO_CREATED',
          recipientEmail: 'buyer.test@procucev-test.invalid',
          params: { first_name: 'Buyer' },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("'rfq_id'");
    });

  });
});
