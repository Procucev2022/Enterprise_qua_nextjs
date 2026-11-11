const express = require('express');
const supertest = require('supertest');
const mailerService = require('../src/services/mailerService');
const authService = require('../src/services/authService');
const enterpriseInquiryQueries = require('../src/db/enterpriseInquiryQueries');
const eventOutboxService = require('../src/services/eventOutboxService');
const { logger } = require('../src/services/loggerService');
const enterpriseInquiriesRouter = require('../src/routes/enterpriseInquiries');

describe('Enterprise Inquiries Email Notification & Route', () => {
  let app;
  let inquiries;
  const originalEnvEmail = process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/enterprise-inquiries', enterpriseInquiriesRouter);
  });

  beforeEach(() => {
    inquiries = [];
    jest.spyOn(authService, 'assertSessionActive').mockImplementation(async (token) => ({
      valid: token === 'manager-token' || token === 'buyer-token',
      user: {
        role: token === 'buyer-token' ? 'buyer' : 'category_manager',
        name: 'Verified Manager',
        email: 'manager@example.test',
      },
      error: 'Invalid session token.',
    }));
    jest.spyOn(enterpriseInquiryQueries, 'createEnterpriseInquiry').mockImplementation(async (input) => {
      const created = {
        id: `test-inquiry-${inquiries.length + 1}`,
        ...input,
        buyerAccountId: null,
        status: 'NEW',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      inquiries.unshift(created);
      return { inquiry: created, created: true };
    });
    jest.spyOn(enterpriseInquiryQueries, 'getEnterpriseInquiries').mockImplementation(async (limit) =>
      inquiries.slice(0, limit)
    );
    jest.spyOn(enterpriseInquiryQueries, 'updateEnterpriseInquiry').mockImplementation(async (id, updates) => {
      const index = inquiries.findIndex((item) => item.id === id);
      if (index < 0) return null;
      inquiries[index] = { ...inquiries[index], ...updates, updatedAt: new Date().toISOString() };
      return inquiries[index];
    });
    jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({
      claimed: 2, completed: 2, retried: 0, dead: 0,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalEnvEmail !== undefined) {
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = originalEnvEmail;
    } else {
      delete process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;
    }
  });

  describe('mailerService enterprise inquiry helpers', () => {
    test('getEnterpriseInquiryRecipient defaults to info@procucev.com when env is unset', () => {
      delete process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;
      expect(mailerService.getEnterpriseInquiryRecipient()).toBe('info@procucev.com');
    });

    test('getEnterpriseInquiryRecipient returns configured env email when set', () => {
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = 'custom.manager@example.com';
      expect(mailerService.getEnterpriseInquiryRecipient()).toBe('custom.manager@example.com');
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = 'info@procucev.com';
    });

    test('buildEnterpriseInquiryNotificationEmail formats inquiry data with complete details', () => {
      const inquiry = {
        id: 'ent-inq-12345',
        companyName: 'Acme Mega Corp',
        email: 'procurement@acme.com',
        mobile: '+919876543210',
        notes: 'Need 10,000 unit bulk contract',
        buyerAccountId: 'buyer-acc-99',
        createdAt: '2026-10-16T10:00:00.000Z',
      };

      const mail = mailerService.buildEnterpriseInquiryNotificationEmail({ inquiry });

      expect(mail.to).toBe('info@procucev.com');
      expect(mail.replyTo).toBe('procurement@acme.com');
      expect(mail.subject).toContain('Acme Mega Corp');
      expect(mail.html).toContain('Acme Mega Corp');
      expect(mail.html).toContain('procurement@acme.com');
      expect(mail.html).toContain('+919876543210');
      expect(mail.html).toContain('ent-inq-12345');
      expect(mail.html).toContain('buyer-acc-99');
      expect(mail.html).toContain('Need 10,000 unit bulk contract');
      expect(mail.text).toContain('Acme Mega Corp');
      expect(mail.text).toContain('+919876543210');
    });

    test('buildEnterpriseInquiryBuyerConfirmationEmail builds buyer confirmation', () => {
      const inquiry = {
        id: 'ent-inq-777',
        companyName: 'Beta Logistics',
        email: 'lead@betalogistics.com',
        mobile: '+919123456780',
      };

      const mail = mailerService.buildEnterpriseInquiryBuyerConfirmationEmail(inquiry);

      expect(mail.to).toBe('lead@betalogistics.com');
      expect(mail.subject).toContain('Enterprise Contracts');
      expect(mail.html).toContain('Beta Logistics');
      expect(mail.html).toContain('ent-inq-777');
      expect(mail.html).toContain('24 hours');
    });

    test('sendEnterpriseInquiryNotificationEmail handles test environment cleanly', async () => {
      const inquiry = {
        id: 'ent-inq-test',
        companyName: 'Test Corp',
        email: 'test@example.com',
        mobile: '+919999999999',
      };

      const res = await mailerService.sendEnterpriseInquiryNotificationEmail(inquiry);
      expect(res).toBeDefined();
      expect(res.sent).toBe(false);
      expect(res.reason).toBe('test environment');
    });

    test('sendEnterpriseInquiryBuyerConfirmationEmail handles missing email and test environment', async () => {
      const noEmailRes = await mailerService.sendEnterpriseInquiryBuyerConfirmationEmail({});
      expect(noEmailRes.sent).toBe(false);
      expect(noEmailRes.reason).toBe('missing recipient email');

      const okRes = await mailerService.sendEnterpriseInquiryBuyerConfirmationEmail({
        email: 'buyer@test.com',
        companyName: 'Test Buyer',
      });
      expect(okRes.sent).toBe(false);
      expect(okRes.reason).toBe('test environment');
    });
  });

  describe('POST /api/enterprise-inquiries integration', () => {
    test('submits inquiry, stores it, and dispatches its durable email intents', async () => {

      const payload = {
        companyName: 'Global Enterprises Inc',
        email: 'global@enterprise.com',
        mobile: '+919876500000',
        notes: 'Interested in annual tier 3 contract',
        buyerAccountId: 'acc-global-1',
      };

      const res = await supertest(app)
        .post('/api/enterprise-inquiries')
        .set('Idempotency-Key', 'b714f6d8-83a1-4f34-9d89-72ebddb1186d')
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.companyName).toBe('Global Enterprises Inc');
      expect(res.body.data.email).toBe('global@enterprise.com');
      expect(res.body.data.mobile).toBe('+919876500000');
      expect(enterpriseInquiryQueries.createEnterpriseInquiry).toHaveBeenCalledWith({
        companyName: 'Global Enterprises Inc',
        email: 'global@enterprise.com',
        mobile: '+919876500000',
        notes: 'Interested in annual tier 3 contract',
        idempotencyKey: 'b714f6d8-83a1-4f34-9d89-72ebddb1186d',
      });

      expect(eventOutboxService.dispatchDueEventOutboxJobs).toHaveBeenCalledTimes(1);
    });

    test('returns 201 when immediate email dispatch fails because the database outbox retains both intents', async () => {
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockRejectedValueOnce(
        new Error('outbox claim failed')
      );
      const response = await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'Resilient Co', email: 'contact@resilient.com', mobile: '+919811122233' })
        .expect(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.companyName).toBe('Resilient Co');
    });

    test.each([
      [{ claimed: 1, completed: 0, retried: 1, dead: 0 }],
      [{ claimed: 1, completed: 0, retried: 0, dead: 1 }],
    ])('logs durable email recovery status when dispatch returns retry counts', async (dispatchResult) => {
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValueOnce(dispatchResult);
      const warnSpy = jest.spyOn(logger, 'warn');

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'Queued Co', email: 'queued@example.test', mobile: '+919811122234' })
        .expect(201);

      expect(warnSpy).toHaveBeenCalledWith(
        'Enterprise inquiry email delivery remains in the durable retry queue',
        expect.objectContaining({ inquiryId: 'test-inquiry-1' }),
        'ENTERPRISE_INQUIRIES'
      );
    });

    test('validates required fields', async () => {
      await supertest(app)
        .post('/api/enterprise-inquiries')
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ email: 'no-company@test.com', mobile: '123' })
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'No Email', mobile: '123' })
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'No Mobile', email: 'a@b.com' })
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'X', email: 'bad-email', mobile: '123' })
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .set('Content-Type', 'application/json')
        .send('null')
        .expect(400);

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ companyName: 'Valid Company', email: 'valid@company.test', mobile: '+919876543210' })
        .expect(400);
    });

    test('GET /api/enterprise-inquiries lists all inquiries', async () => {
      const res = await supertest(app)
        .get('/api/enterprise-inquiries')
        .set('Authorization', 'Bearer manager-token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    test('GET /api/enterprise-inquiries respects limit query parameter', async () => {
      await enterpriseInquiryQueries.createEnterpriseInquiry({
        companyName: 'Limit Test Co 1',
        email: 'limit1@test.com',
        mobile: '+919988776651',
      });
      await enterpriseInquiryQueries.createEnterpriseInquiry({
        companyName: 'Limit Test Co 2',
        email: 'limit2@test.com',
        mobile: '+919988776652',
      });

      const res = await supertest(app)
        .get('/api/enterprise-inquiries?limit=1')
        .set('Authorization', 'Bearer manager-token')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(1);

      // Also exercise non-positive / non-integer limit
      const resInvalid = await supertest(app)
        .get('/api/enterprise-inquiries?limit=invalid')
        .set('Authorization', 'Bearer manager-token')
        .expect(400);
      expect(resInvalid.body.success).toBe(false);

      await supertest(app)
        .get('/api/enterprise-inquiries?limit=1.5')
        .set('Authorization', 'Bearer manager-token')
        .expect(400);
    });

    test('PATCH /api/enterprise-inquiries/:id updates status, notes, contactedBy', async () => {
      const createdResult = await enterpriseInquiryQueries.createEnterpriseInquiry({
        companyName: 'Patch Test Co',
        email: 'patch@test.com',
        mobile: '+919988776655',
      });
      const created = createdResult.inquiry;

      const res = await supertest(app)
        .patch(`/api/enterprise-inquiries/${created.id}`)
        .set('Authorization', 'Bearer manager-token')
        .send({
          status: 'CONTACTED',
          notes: 'Called buyer today',
          contactedBy: 'Navin Manager',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CONTACTED');
      expect(res.body.data.notes).toBe('Called buyer today');
      expect(res.body.data.contactedBy).toBe('Verified Manager');
      expect(res.body.data.contactedAt).toBeDefined();
    });

    test('PATCH /api/enterprise-inquiries/:id returns 404 for non-existent inquiry', async () => {
      const res = await supertest(app)
        .patch('/api/enterprise-inquiries/non-existent-id')
        .set('Authorization', 'Bearer manager-token')
        .send({ status: 'CLOSED' })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });

    test('list and update endpoints require a category manager or admin session', async () => {
      await supertest(app).get('/api/enterprise-inquiries').expect(401);
      await supertest(app)
        .get('/api/enterprise-inquiries')
        .set('Authorization', 'Bearer buyer-token')
        .expect(403);
      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer buyer-token')
        .send({ status: 'CLOSED' })
        .expect(403);
    });

    test('rejects empty and invalid updates before database access', async () => {
      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-token')
        .expect(400);

      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-token')
        .send({})
        .expect(400);
      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-token')
        .send({ status: 'UNKNOWN' })
        .expect(400);
      expect(enterpriseInquiryQueries.updateEnterpriseInquiry).not.toHaveBeenCalled();
    });

    test('maps persistence failures to retryable service unavailable responses', async () => {
      jest.spyOn(enterpriseInquiryQueries, 'createEnterpriseInquiry').mockRejectedValueOnce(
        Object.assign(new Error('Database unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );

      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'Retryable Co', email: 'retryable@example.test', mobile: '+919876543210' })
        .expect(503);

      jest.spyOn(enterpriseInquiryQueries, 'getEnterpriseInquiries').mockRejectedValueOnce(
        Object.assign(new Error('Database unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );

      await supertest(app)
        .get('/api/enterprise-inquiries')
        .set('Authorization', 'Bearer manager-token')
        .expect(503);

      jest.spyOn(enterpriseInquiryQueries, 'updateEnterpriseInquiry').mockRejectedValueOnce(
        Object.assign(new Error('Database unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );

      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-token')
        .send({ status: 'CLOSED' })
        .expect(503);
    });

    test('does not repeat email notifications for an idempotent replay', async () => {
      const inquiry = {
        id: 'ent-inq-idempotent',
        companyName: 'Retry Company',
        email: 'retry@example.test',
        mobile: '+919876543210',
        status: 'NEW',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jest.spyOn(enterpriseInquiryQueries, 'createEnterpriseInquiry').mockResolvedValueOnce({ inquiry, created: false });
      const notifySpy = jest.spyOn(mailerService, 'sendEnterpriseInquiryNotificationEmail');
      const confirmationSpy = jest.spyOn(mailerService, 'sendEnterpriseInquiryBuyerConfirmationEmail');

      const response = await supertest(app)
        .post('/api/enterprise-inquiries')
        .set('Idempotency-Key', 'b714f6d8-83a1-4f34-9d89-72ebddb1186d')
        .send({ companyName: 'Retry Company', email: 'retry@example.test', mobile: '+919876543210' })
        .expect(201);

      expect(response.body.data.id).toBe(inquiry.id);
      expect(notifySpy).not.toHaveBeenCalled();
      expect(confirmationSpy).not.toHaveBeenCalled();
      expect(eventOutboxService.dispatchDueEventOutboxJobs).not.toHaveBeenCalled();
    });

    test('supports notes-only updates and uses authenticated manager attribution fallbacks', async () => {
      await enterpriseInquiryQueries.createEnterpriseInquiry({
        companyName: 'Attribution Test Co',
        email: 'attribution@example.test',
        mobile: '+919876543210',
      });
      const sessionSpy = jest.spyOn(authService, 'assertSessionActive').mockImplementation(async (token) => ({
        valid: true,
        user: {
          role: 'category_manager',
          ...(token === 'manager-email-token' ? { email: 'email.manager@example.test' } : {}),
        },
      }));

      const emailAttributed = await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-email-token')
        .send({ notes: 'Email-attributed manager follow-up' })
        .expect(200);
      expect(emailAttributed.body.data.contactedBy).toBe('email.manager@example.test');
      expect(enterpriseInquiryQueries.updateEnterpriseInquiry).toHaveBeenLastCalledWith(
        'test-inquiry-1',
        expect.objectContaining({ notes: 'Email-attributed manager follow-up' })
      );

      const fallbackAttributed = await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer fallback-manager-token')
        .send({ notes: 'Fallback-attributed manager follow-up' })
        .expect(200);
      expect(fallbackAttributed.body.data.contactedBy).toBe('Category Manager');
      expect(sessionSpy).toHaveBeenCalledTimes(2);
    });

    test('GET and PATCH non-persistence failures pass to the error handler', async () => {
      jest.spyOn(enterpriseInquiryQueries, 'getEnterpriseInquiries').mockRejectedValueOnce(
        new Error('Database read failure')
      );
      await supertest(app)
        .get('/api/enterprise-inquiries')
        .set('Authorization', 'Bearer manager-token')
        .expect(500);

      jest.spyOn(enterpriseInquiryQueries, 'updateEnterpriseInquiry').mockRejectedValueOnce(
        new Error('Database write failure')
      );
      await supertest(app)
        .patch('/api/enterprise-inquiries/test-inquiry-1')
        .set('Authorization', 'Bearer manager-token')
        .send({ status: 'CLOSED' })
        .expect(500);

      jest.spyOn(enterpriseInquiryQueries, 'createEnterpriseInquiry').mockRejectedValueOnce(
        new Error('Database write failure')
      );
      await supertest(app)
        .post('/api/enterprise-inquiries')
        .send({ companyName: 'Database failure', email: 'fail@example.com', mobile: '+919876543210' })
        .expect(500);
    });
  });
});
