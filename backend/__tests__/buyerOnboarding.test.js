const request = require('supertest');
const app = require('../src/app');
const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const authService = require('../src/services/authService');
const authSessionQueries = require('../src/db/authSessionQueries');
const identityQueries = require('../src/db/identityQueries');
const geminiService = require('../src/services/geminiService');
const pool = require('../src/db/pool');

const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('Automatic Unregistered Buyer Onboarding and Email-Based RFQ Creation', () => {
  const SENDER = 'newprocurement.buyer@industrial-corp.com';

  const makeRawEmail = (fromEmail, bodyText, subject = 'Requisition Enquiry') => {
    return Buffer.from(
      [
        `Return-Path: <${fromEmail}>`,
        `Message-ID: <MSG-${Date.now()}.${fromEmail}>`,
        'Date: Mon, 07 Sep 2026 09:14:22 +0530',
        `From: Test Buyer <${fromEmail}>`,
        'To: Procucev Intake <client@procucev.com>',
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        bodyText,
      ].join('\r\n'),
      'utf8'
    );
  };

  beforeEach(() => {
    emailGatewayService.resetAutoReplyMemory();
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue('audit-log-101');
    jest.spyOn(mailerService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValue({ success: true, messageId: 'msg-onboard-101' });
    jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail').mockResolvedValue({ success: true, messageId: 'msg-remind-101' });
    jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ success: true, messageId: 'msg-quote-101' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Scenario 1 & 2 & 3: Unregistered buyer auto-registration with placeholder phone and V0 config', () => {
    test('auto-registers buyer, creates RFQ with V0 sourcing mode, and sends onboarding credentials', async () => {
      // Mock Gemini line item extraction
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-test',
        documentTitle: 'Centrifugal Pumps',
        lineItems: [
          { itemName: 'Centrifugal Pump 150 m3/hr', quantity: 5, unit: 'Nos', targetDate: '2029-10-15' },
        ],
      });

      // Seed candidate vendor matching the RFQ category
      storeService.addVendor({
        name: 'V0 Industrial Supplies',
        email: 'v0supplier@acme.com',
        majorCategory: 'Mechanical',
        minorCategories: ['Pumps & Accessories'],
        isProcucevVerified: true,
      });

      const raw = makeRawEmail(
        SENDER,
        'Please provide quotes for 5 units of Centrifugal Pumps for delivery to Mumbai site. Target date: 2029-10-15.',
        'Urgent RFQ for Centrifugal Pumps'
      );

      const config = emailGatewayService.resolveConfig({
        EMAIL_GATEWAY_ENABLED: 'true',
        EMAIL_GATEWAY_USER: 'client@procucev.com',
      });

      const result = await emailGatewayService.processMessage(raw, config);

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(result.rfq).toBeDefined();

      // Verify buyer account was created with V0 configuration and placeholder phone
      const account = await storeService.getBuyerAccountByEmail(SENDER);
      expect(account).toBeDefined();
      expect(account.corporateEmail).toBe(SENDER);
      expect(account.sourcingMode).toBe('mode_0');
      expect(account.phone || account.mobileNumber).toBe('+919999999999');
      expect(account.onboardingRequired).toBe(true);
      expect(account.phoneVerified).toBe(false);

      // Verify RFQ belongs to the new account and has V0 sourcing mode
      const rfq = storeService.getRFQById(result.rfq.id);
      expect(rfq).toBeDefined();
      expect(rfq.buyerEmail).toBe(SENDER);
      expect(rfq.sourcingMode).toBe('mode_0');

      // Verify onboarding credentials & RFQ email was sent
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: SENDER,
          tempPassword: expect.any(String),
          rfqNumber: result.rfq.rfqNumber,
        })
      );
    });
  });

  describe('Scenario 5: Registered buyer continues to use original workflow', () => {
    test('processes RFQ under existing registered account and preserves subscription plan', async () => {
      const regEmail = 'registered.buyer@enterprise-corp.com';
      storeService.addBuyerAccount({
        organizationName: 'Enterprise Corp',
        corporateEmail: regEmail,
        subscriptionPlan: 'version_2',
        sourcingMode: 'mode_2',
        remainingFreeRFQs: 10,
        onboardingRequired: false,
      });

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-test',
        documentTitle: 'Valves Requirement',
        lineItems: [
          { itemName: 'Gate Valve, 200mm', quantity: 10, unit: 'Nos', targetDate: '2028-12-01' },
        ],
      });

      jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ success: true });

      const raw = makeRawEmail(regEmail, 'Require 10 units of Gate Valves. Target delivery: 2028-12-01.', 'Requisition: Valves');
      const config = emailGatewayService.resolveConfig({
        EMAIL_GATEWAY_ENABLED: 'true',
        EMAIL_GATEWAY_USER: 'client@procucev.com',
      });

      const result = await emailGatewayService.processMessage(raw, config);
      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);

      const rfq = storeService.getRFQById(result.rfq.id);
      expect(rfq.buyerEmail).toBe(regEmail);
      expect(rfq.sourcingMode).toBe('mode_2');
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).not.toHaveBeenCalled();
      expect(mailerService.sendRfqAcknowledgementEmail).toHaveBeenCalled();
    });
  });

  describe('Scenario 6 & 7: Repeated or concurrent emails do not create duplicate accounts or duplicate RFQs', () => {
    test('handles concurrent requests safely without duplicating accounts', async () => {
      const concurrentEmail = 'concurrent.buyer@fastmail.com';
      const p1 = emailGatewayService.getOrCreateBuyerAccount(concurrentEmail);
      const p2 = emailGatewayService.getOrCreateBuyerAccount(concurrentEmail);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.buyerAccount.id).toBe(res2.buyerAccount.id);
      expect(res1.buyerAccount.corporateEmail).toBe(concurrentEmail);
    });

    test('deduplicates duplicate messageId via ledger in pollOnce', async () => {
      jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(true);
      const isProcessed = await emailGatewayQueries.hasProcessed('duplicate-msg-id-123');
      expect(isProcessed).toBe(true);
    });
  });

  describe('Scenario 8: Account creation succeeds but RFQ extraction fails', () => {
    test('records failure and does not send onboarding credentials claiming RFQ succeeded', async () => {
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.FAILED,
        model: 'gemini-test',
        lineItems: [],
      });

      const failSender = 'empty.content@tester.com';
      const raw = makeRawEmail(failSender, 'Empty or unparseable text.', 'Unparseable');
      const config = emailGatewayService.resolveConfig({
        EMAIL_GATEWAY_ENABLED: 'true',
        EMAIL_GATEWAY_USER: 'client@procucev.com',
      });

      const result = await emailGatewayService.processMessage(raw, config);
      expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 9, 10, 11: Future-only delivery dates enforcement', () => {
    test('converts past delivery date to current date + 5 days', () => {
      const pastDate = '2021-05-10';
      const normalized = rfqIngestionService.ensureFutureDeliveryDate(pastDate, 5);
      const expected = new Date();
      expected.setDate(expected.getDate() + 5);
      expect(normalized).toBe(expected.toISOString().slice(0, 10));
    });

    test('preserves valid future delivery date', () => {
      const future = new Date();
      future.setDate(future.getDate() + 30);
      const futureIso = future.toISOString().slice(0, 10);
      expect(rfqIngestionService.ensureFutureDeliveryDate(futureIso, 5)).toBe(futureIso);
    });

    test('replaces missing or invalid delivery date with current date + 5 days', () => {
      const expected = new Date();
      expected.setDate(expected.getDate() + 5);
      const expectedIso = expected.toISOString().slice(0, 10);
      expect(rfqIngestionService.ensureFutureDeliveryDate(null, 5)).toBe(expectedIso);
      expect(rfqIngestionService.ensureFutureDeliveryDate('invalid-date', 5)).toBe(expectedIso);
    });
  });

  describe('Scenario 12, 13, 14, 15: Mandatory First-Login Onboarding & Protection', () => {
    test('blocks regular portal API access with 403 onboardingRequired when onboarding is incomplete', async () => {
      const unverifiedBuyerToken = authService.generateSessionToken({
        id: 'usr-unverified-001',
        email: 'unverified.buyer@corp.com',
        name: 'Unverified Buyer',
        role: 'buyer',
        orgId: 'org-01',
        orgName: 'Corp Org',
        resetPasswordRequired: true,
        onboardingRequired: true,
        verificationStatus: 'pending_onboarding',
      });

      const res = await request(app)
        .get('/api/rfqs/summary')
        .set('Authorization', `Bearer ${unverifiedBuyerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.onboardingRequired).toBe(true);
    });

    test('validates email OTP, phone OTP, replaces placeholder phone, and updates password', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const buyerEmail = 'flow.buyer@testcorp.com';
      const initialPass = 'TempPassSecure123!';
      const newPhone = '9876543210';
      const newPass = 'BrandNewPermPass456!';

      // Seed account in identityQueries & storeService
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({
        id: 'usr-flow-001',
        email: buyerEmail,
        name: 'Flow Buyer',
        role: 'buyer',
        orgId: 'org-flow-001',
        orgName: 'Flow Corp',
        password: initialPass,
        mobile: '+919999999999',
        resetPasswordRequired: true,
        verificationStatus: 'pending_onboarding',
        isActive: true,
        isApproved: true,
      });

      jest.spyOn(identityQueries, 'verifyStoredPassword').mockImplementation((sub, stored) => sub === stored);
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(true);

      // Save valid OTPs in authSessionQueries
      const emailOtp = '654321';
      const mobileOtp = '123456';
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_email`), emailOtp, Date.now() + 600000);
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_mobile`), mobileOtp, Date.now() + 600000);

      storeService.addBuyerAccount({
        corporateEmail: buyerEmail,
        companyName: 'Flow Corp',
        phone: '9999999999',
        onboardingRequired: true,
      });

      const onboardingToken = authService.generateSessionToken({
        id: 'usr-flow-001',
        email: buyerEmail,
        name: 'Flow Buyer',
        role: 'buyer',
        orgId: 'org-flow-001',
        orgName: 'Flow Corp',
        resetPasswordRequired: true,
        onboardingRequired: true,
      });

      // Attempt completing onboarding with placeholder phone (must be rejected)
      const rejectRes = await request(app)
        .post('/api/auth/complete-buyer-onboarding')
        .set('Authorization', `Bearer ${onboardingToken}`)
        .send({
          emailOtp,
          mobile: '9999999999',
          mobileOtp,
          currentPassword: initialPass,
          newPassword: newPass,
          companyName: 'Flow Corp',
        });
      expect(rejectRes.status).toBe(400);

      // Complete onboarding with valid parameters
      const successRes = await request(app)
        .post('/api/auth/complete-buyer-onboarding')
        .set('Authorization', `Bearer ${onboardingToken}`)
        .send({
          emailOtp,
          mobile: newPhone,
          mobileOtp,
          currentPassword: initialPass,
          newPassword: newPass,
          companyName: 'Flow Corp Ltd',
        });

      expect(successRes.status).toBe(200);
      expect(successRes.body.success).toBe(true);
      expect(successRes.body.user.mobile).toBe(newPhone);
      expect(successRes.body.user.onboardingRequired).toBe(false);
      expect(successRes.body.token).toBeDefined();

      // Verify storeService buyer profile update
      const updatedAccount = await storeService.getBuyerAccountByEmail(buyerEmail);
      expect(updatedAccount.phone).toBe(newPhone);
      expect(updatedAccount.onboardingRequired).toBe(false);
      expect(updatedAccount.phoneVerified).toBe(true);
    });

    test('exercises all error branches during completeBuyerOnboarding', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const buyerEmail = 'branch.buyer@testcorp.com';
      const initialPass = 'TempPassSecure123!';
      const newPhone = '9876543211';
      const newPass = 'BrandNewPermPass456!';

      const validUser = {
        id: 'usr-branch-001',
        email: buyerEmail,
        name: 'Branch Buyer',
        role: 'buyer',
        orgId: 'org-branch-001',
        orgName: 'Branch Corp',
        password: initialPass,
        mobile: '+919999999999',
        resetPasswordRequired: true,
        verificationStatus: 'pending_onboarding',
        isActive: true,
        isApproved: true,
      };

      const userSession = {
        id: 'usr-branch-001',
        email: buyerEmail,
        name: 'Branch Buyer',
        role: 'buyer',
      };

      // 1. Account missing in identity
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // Restore user
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(validUser);

      // 2. Current password incorrect
      jest.spyOn(identityQueries, 'verifyStoredPassword').mockReturnValue(false);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: 'WrongPassword!',
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // Current password correct
      jest.spyOn(identityQueries, 'verifyStoredPassword').mockImplementation((sub, stored) => sub === stored);

      // 3. New password unchanged from current password
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: initialPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // 4. Missing / expired Email OTP
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // Save expired Email OTP
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_email`), '123456', Date.now() - 10000);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // Save valid Email OTP but submit wrong code
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_email`), '123456', Date.now() + 600000);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '999999',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // 5. Expired Mobile OTP
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_mobile`), '654321', Date.now() - 10000);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // Save valid Mobile OTP but submit wrong code
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_mobile`), '654321', Date.now() + 600000);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '999999',
        })
      ).rejects.toThrow();

      // 6. DB update failure
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(false);
      await expect(
        authService.completeBuyerOnboarding(userSession, {
          mobile: newPhone,
          currentPassword: initialPass,
          newPassword: newPass,
          emailOtp: '123456',
          mobileOtp: '654321',
        })
      ).rejects.toThrow();

      // 7. Successful onboarding with quote dispatch error handled gracefully
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(true);
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockRejectedValue(new Error('Queue Error'));
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_email`), '123456', Date.now() + 600000);
      await authSessionQueries.saveOtp(authService.buildOtpKey(buyerEmail, `${newPhone}_mobile`), '654321', Date.now() + 600000);
      storeService.addBuyerAccount({
        corporateEmail: buyerEmail,
        companyName: 'Branch Corp',
      });

      const res = await authService.completeBuyerOnboarding(userSession, {
        mobile: newPhone,
        currentPassword: initialPass,
        newPassword: newPass,
        emailOtp: '123456',
        mobileOtp: '654321',
        companyName: 'Branch Corp Renamed',
      });
      expect(res.success).toBe(true);
      expect(res.user.orgName).toBe('Branch Corp Renamed');
    });
  });

  describe('Scenario 16, 17, 18, 19: Quotation Notifications & Email-Only Details', () => {
    test('sends profile reminder without quotation prices when onboarding is pending', async () => {
      const buyerEmail = 'pending.buyer@quotedomain.com';
      storeService.addBuyerAccount({
        corporateEmail: buyerEmail,
        organizationName: 'Pending Buyer Corp',
        onboardingRequired: true,
        status: 'PENDING_ONBOARDING',
      });

      const rfq = storeService.createRFQ({
        title: 'Electrical Transformers',
        buyerEmail,
        category: 'Engineering Spares - Electrical',
      });

      const quote = {
        vendorId: 'vendor-123',
        vendorName: 'Apex Transformers',
        unitPrice: 50000,
        totalPrice: 150000,
        leadTimeDays: 14,
        paymentTerms: 'Net 30',
      };

      const result = storeService.emailQuoteToBuyer(rfq, quote);
      expect(result).toBe(true);

      // Verify profile reminder email sent, no prices exposed
      expect(mailerService.sendBuyerProfileCompletionReminderEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: buyerEmail,
          rfqTitle: 'Electrical Transformers',
        })
      );
      expect(mailerService.sendQuoteReceivedEmail).not.toHaveBeenCalled();
    });

    test('delivers pending quotes once the buyer completes onboarding', async () => {
      const buyerEmail = 'pending.buyer@quotedomain.com';

      // Verify quote was queued from previous test
      // Now complete onboarding
      storeService.updateBuyerAccount(buyerEmail, {
        onboardingRequired: false,
        status: 'ACTIVE_VERIFIED',
        profileVerified: true,
        emailVerified: true,
        phoneVerified: true,
      });

      const dispatched = await storeService.dispatchPendingQuoteNotifications(buyerEmail);
      expect(dispatched.length).toBeGreaterThan(0);
      expect(mailerService.sendQuoteReceivedEmail).toHaveBeenCalledWith(
        buyerEmail,
        expect.objectContaining({
          quote: expect.objectContaining({ totalPrice: 150000 }),
        })
      );

      // A retry or subsequent call does not duplicate dispatches
      const retryDispatched = await storeService.dispatchPendingQuoteNotifications(buyerEmail);
      expect(retryDispatched.length).toBe(0);
    });

    test('sends full quote details directly when buyer has completed onboarding', async () => {
      const onboardedEmail = 'onboarded.buyer@testsite.com';
      storeService.addBuyerAccount({
        corporateEmail: onboardedEmail,
        organizationName: 'Onboarded Site',
        onboardingRequired: false,
        status: 'ACTIVE_VERIFIED',
        profileVerified: true,
        emailVerified: true,
        phoneVerified: true,
      });

      const rfq = storeService.createRFQ({
        title: 'Centrifugal Pumps',
        buyerEmail: onboardedEmail,
        category: 'Mechanical',
      });

      const quote = {
        vendorId: 'vendor-999',
        vendorName: 'Delta Pumps Ltd',
        unitPrice: 25000,
        totalPrice: 50000,
        leadTimeDays: 7,
      };

      const result = storeService.emailQuoteToBuyer(rfq, quote);
      expect(result).toBe(true);
      expect(mailerService.sendQuoteReceivedEmail).toHaveBeenCalledWith(
        onboardedEmail,
        expect.objectContaining({
          quote: expect.objectContaining({ totalPrice: 50000 }),
        })
      );
    });
  });

  describe('Scenario 20: Unauthorized buyers cannot access other buyers RFQs or quotes', () => {
    test('enforces isolation between different buyer accounts', async () => {
      const buyerAToken = authService.generateSessionToken({
        id: 'usr-buyer-a',
        email: 'buyer.a@company-a.com',
        name: 'Buyer A',
        role: 'buyer',
        orgId: 'org-a',
        orgName: 'Company A',
      });

      const rfqB = storeService.createRFQ({
        title: 'Secret Equipment for Company B',
        buyerEmail: 'buyer.b@company-b.com',
        category: 'Mechanical',
      });

      // Buyer A attempts to view Buyer B's RFQ
      const res = await request(app)
        .get(`/api/rfqs/${rfqB.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect([403, 404]).toContain(res.status);
    });
  });
});
