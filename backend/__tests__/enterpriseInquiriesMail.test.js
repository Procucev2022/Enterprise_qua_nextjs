const express = require('express');
const supertest = require('supertest');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const enterpriseInquiriesRouter = require('../src/routes/enterpriseInquiries');

describe('Enterprise Inquiries Email Notification & Route', () => {
  let app;
  const originalEnvEmail = process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/enterprise-inquiries', enterpriseInquiriesRouter);
  });

  afterAll(() => {
    if (originalEnvEmail !== undefined) {
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = originalEnvEmail;
    } else {
      delete process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;
    }
  });

  describe('mailerService enterprise inquiry helpers', () => {
    test('getEnterpriseInquiryRecipient defaults to navin.procucev@gmail.com when env is unset', () => {
      delete process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL;
      expect(mailerService.getEnterpriseInquiryRecipient()).toBe('navin.procucev@gmail.com');
    });

    test('getEnterpriseInquiryRecipient returns configured env email when set', () => {
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = 'custom.manager@example.com';
      expect(mailerService.getEnterpriseInquiryRecipient()).toBe('custom.manager@example.com');
      process.env.ENTERPRISE_INQUIRY_NOTIFICATION_EMAIL = 'navin.procucev@gmail.com';
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

      expect(mail.to).toBe('navin.procucev@gmail.com');
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
    test('submits inquiry, stores it, and attempts email dispatches', async () => {
      const sendSpy = jest.spyOn(mailerService, 'sendEnterpriseInquiryNotificationEmail');
      const confirmSpy = jest.spyOn(mailerService, 'sendEnterpriseInquiryBuyerConfirmationEmail');

      const payload = {
        companyName: 'Global Enterprises Inc',
        email: 'global@enterprise.com',
        mobile: '+919876500000',
        notes: 'Interested in annual tier 3 contract',
        buyerAccountId: 'acc-global-1',
      };

      const res = await supertest(app)
        .post('/api/enterprise-inquiries')
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.companyName).toBe('Global Enterprises Inc');
      expect(res.body.data.email).toBe('global@enterprise.com');
      expect(res.body.data.mobile).toBe('+919876500000');

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          companyName: 'Global Enterprises Inc',
          email: 'global@enterprise.com',
        })
      );

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'global@enterprise.com',
        })
      );

      sendSpy.mockRestore();
      confirmSpy.mockRestore();
    });

    test('returns 201 even if mailerService throws error', async () => {
      const sendSpy = jest.spyOn(mailerService, 'sendEnterpriseInquiryNotificationEmail').mockRejectedValueOnce(
        new Error('SMTP connection timed out')
      );

      const payload = {
        companyName: 'Resilient Co',
        email: 'contact@resilient.com',
        mobile: '+919811122233',
      };

      const res = await supertest(app)
        .post('/api/enterprise-inquiries')
        .send(payload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.companyName).toBe('Resilient Co');

      sendSpy.mockRestore();
    });

    test('validates required fields', async () => {
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
    });
  });
});
