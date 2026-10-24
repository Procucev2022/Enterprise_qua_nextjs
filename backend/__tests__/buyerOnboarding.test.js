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
const rfqAttachmentService = require('../src/services/rfqAttachmentService');

const { INGESTION_OUTCOME } = emailGatewayQueries;
const { EMAIL_GATEWAY_STATE } = require('../src/config/constants');

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
    jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ success: true, messageId: 'msg-cred-101' });
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
        gstin: '27AAAAA0000A1Z5',
        pan: 'AAAAA0000A',
        address: 'Plot 42, Hinjewadi Phase 2',
      });
      expect(res.success).toBe(true);
      expect(res.user.orgName).toBe('Branch Corp Renamed');
      const account = await storeService.getBuyerAccountByEmail(buyerEmail);
      expect(account.gstin).toBe('27AAAAA0000A1Z5');
      expect(account.pan).toBe('AAAAA0000A');
      expect(account.address).toBe('Plot 42, Hinjewadi Phase 2');
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

    test('for V0 RFQs: asks buyer to update profile on 1st quote, suppresses duplicate acknowledgment on 2nd quote, and releases quotes after profile update', async () => {
      const v0BuyerEmail = 'v0.requisition.buyer@acmecorp.com';
      storeService.addBuyerAccount({
        corporateEmail: v0BuyerEmail,
        organizationName: 'Acme Heavy Industries',
        sourcingMode: 'mode_0',
        onboardingRequired: true,
        status: 'PENDING_ONBOARDING',
        mobileNumber: '+919999999999',
      });

      const rfq = storeService.createRFQ({
        id: 'rfq-v0-dedup-1',
        rfqNumber: 'RFQ-V0-2026-999',
        title: 'Industrial Valves',
        buyerEmail: v0BuyerEmail,
        sourcingMode: 'mode_0',
        category: 'Mechanical',
      });

      const quote1 = {
        vendorId: 'vendor-v1',
        vendorName: 'Alpha Valves Ltd',
        unitPrice: 15000,
        totalPrice: 45000,
      };

      const quote2 = {
        vendorId: 'vendor-v2',
        vendorName: 'Beta Valves Corp',
        unitPrice: 14000,
        totalPrice: 42000,
      };

      jest.clearAllMocks();

      // First quotation received: acknowledgment email sent once, quote queued, not directly exposed
      const res1 = storeService.emailQuoteToBuyer(rfq, quote1);
      expect(res1).toBe(true);
      expect(mailerService.sendBuyerProfileCompletionReminderEmail).toHaveBeenCalledTimes(1);
      expect(mailerService.sendBuyerProfileCompletionReminderEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: v0BuyerEmail,
          rfqNumber: 'RFQ-V0-2026-999',
        })
      );
      expect(mailerService.sendQuoteReceivedEmail).not.toHaveBeenCalled();

      // Second quotation received for same RFQ: queued, but duplicate acknowledgment is NOT sent
      const res2 = storeService.emailQuoteToBuyer(rfq, quote2);
      expect(res2).toBe(true);
      expect(mailerService.sendBuyerProfileCompletionReminderEmail).toHaveBeenCalledTimes(1); // Still 1, no duplicate
      expect(mailerService.sendQuoteReceivedEmail).not.toHaveBeenCalled();

      // Buyer now completes profile update
      storeService.updateBuyerAccount(v0BuyerEmail, {
        profileVerified: true,
        onboardingRequired: false,
        status: 'ACTIVE_VERIFIED',
        phoneVerified: true,
        phone: '9876543210',
        gstin: '27AAAAA0000A1Z5',
        address: 'Plot 55, Pune MIDC',
      });

      const dispatched = await storeService.dispatchPendingQuoteNotifications(v0BuyerEmail);
      expect(dispatched.length).toBe(2);
      expect(mailerService.sendQuoteReceivedEmail).toHaveBeenCalledTimes(2);
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

  describe('Scenario 21: Unregistered / Pending Onboarding Credentials & RFQ Acknowledgement', () => {
    test('sends sendBuyerOnboardingWithRfqEmail to a buyer who already has PENDING_ONBOARDING status in DB', async () => {
      const email = 'pending.retry.buyer@testdomain.com';
      storeService.addBuyerAccount({
        id: 'buyer-pending-retry-1',
        corporateEmail: email,
        organizationName: 'Pending Retry Corp',
        status: 'PENDING_ONBOARDING',
        onboardingRequired: true,
        tempPasswordRequired: true,
      });

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({
        id: 'usr-pending-1',
        email,
        password: 'StoredTempPass123',
        verificationStatus: 'PENDING_ONBOARDING',
        resetPasswordRequired: true,
      });

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-test',
        documentTitle: 'Industrial Valves',
        lineItems: [
          { itemName: 'Gate Valve 4 inch', quantity: 10, unit: 'Nos', targetDate: '2029-11-20' },
        ],
      });

      const raw = makeRawEmail(email, 'Please supply 10 gate valves.');
      const outcome = await emailGatewayService.processMessage(raw, {
        allowedSenders: [],
        allowedDomains: [],
        autoRegisterUnregisteredBuyers: true,
      });

      expect(outcome.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email,
          tempPassword: 'StoredTempPass123',
        })
      );
    });

    test('sends sendBuyerCredentialsEmail when line item extraction fails for an unregistered buyer', async () => {
      const email = 'failed.extract.buyer@testdomain.com';
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ success: true, messageId: 'msg-cred-1' });
      jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue({ success: true });

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND,
        model: 'gemini-test',
        lineItems: [],
      });

      const raw = makeRawEmail(email, 'Hello team, what is your price?');
      const outcome = await emailGatewayService.processMessage(raw, {
        allowedSenders: [],
        allowedDomains: [],
        autoRegisterUnregisteredBuyers: true,
      });

      expect(outcome.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
      expect(mailerService.sendBuyerCredentialsEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email,
          tempPassword: expect.any(String),
        })
      );
    });

    test('retryPendingAcknowledgements sends onboarding email when tempPassword is saved in detail', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([
        {
          message_id: 'msg-ack-test#ack',
          from_address: 'retry.ack.buyer@domain.com',
          subject: 'RFQ Requisition',
          rfq_number: 'RFQ-RETRY-001',
          detail: JSON.stringify({
            buyerName: 'Retry Buyer',
            rfqTitle: 'Pumps',
            tempPassword: 'RetryTempPass456',
            deliveryDate: '2029-12-01',
          }),
          processed_at: new Date().toISOString(),
        },
      ]);

      const outcome = await emailGatewayService.retryPendingAcknowledgements();
      expect(outcome.sent).toBe(1);
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'retry.ack.buyer@domain.com',
          tempPassword: 'RetryTempPass456',
          rfqNumber: 'RFQ-RETRY-001',
        })
      );
    });

    test('queues acknowledgement when sendBuyerOnboardingWithRfqEmail throws', async () => {
      const email = 'fail.send.onboard@domain.com';
      jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockRejectedValue(new Error('SMTP timeout'));

      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        model: 'gemini-test',
        documentTitle: 'Pressure Gauges',
        lineItems: [
          { itemName: 'Pressure Gauge 0-10 bar', quantity: 20, unit: 'Nos', targetDate: '2029-11-20' },
        ],
      });

      const raw = makeRawEmail(email, 'Please supply 20 pressure gauges.');
      const outcome = await emailGatewayService.processMessage(raw, {
        allowedSenders: [],
        allowedDomains: [],
        autoRegisterUnregisteredBuyers: true,
      });

      expect(outcome.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(emailGatewayQueries.recordProcessed).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: expect.stringContaining('#ack'),
          status: INGESTION_OUTCOME.ACK_PENDING,
          fromAddress: email,
        })
      );
    });

    test('handles identity lookup failure and generates fresh temp password in getOrCreateBuyerAccount', async () => {
      const email = 'existing.nopw@domain.com';
      storeService.addBuyerAccount({
        id: 'buyer-nopw-1',
        corporateEmail: email,
        organizationName: 'No PW Corp',
        status: 'PENDING_ONBOARDING',
      });

      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('DB unreachable'));
      const updatePwSpy = jest.spyOn(identityQueries, 'updateUserPassword').mockResolvedValue(true);

      const result = await emailGatewayService.getOrCreateBuyerAccount(email);
      expect(result.isOnboardingPending).toBe(true);
      expect(typeof result.tempPassword).toBe('string');
      expect(updatePwSpy).toHaveBeenCalledWith(email, result.tempPassword);
    });

    test('resolveSenderAuthorisation handles allowedSenders and allowedDomains with pending onboarding', async () => {
      const email = 'allowed.pending@alloweddomain.com';
      storeService.addBuyerAccount({
        id: 'buyer-allowed-pending-1',
        corporateEmail: email,
        organizationName: 'Allowed Pending Corp',
        status: 'PENDING_ONBOARDING',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({
        email,
        password: 'AllowedTempPass123',
        verificationStatus: 'PENDING_ONBOARDING',
      });

      // Allowed sender list match
      const auth1 = await emailGatewayService.resolveSenderAuthorisation(email, {
        allowedSenders: [email],
      });
      expect(auth1.allowed).toBe(true);
      expect(auth1.tempPassword).toBe('AllowedTempPass123');

      // Allowed domain list match
      const auth2 = await emailGatewayService.resolveSenderAuthorisation(email, {
        allowedDomains: ['alloweddomain.com'],
      });
      expect(auth2.allowed).toBe(true);
      expect(auth2.tempPassword).toBe('AllowedTempPass123');

      // Sender not in allowed list
      const auth3 = await emailGatewayService.resolveSenderAuthorisation('other@other.com', {
        allowedSenders: [email],
      });
      expect(auth3.allowed).toBe(false);

      // Domain not in allowed list
      const auth4 = await emailGatewayService.resolveSenderAuthorisation(email, {
        allowedDomains: ['someotherdomain.com'],
      });
      expect(auth4.allowed).toBe(false);
    });

    test('dispatches credentials email when RFQ extraction fails for an auto-registered sender', async () => {
      const email = 'failed.extract.buyer@industrial-corp.com';
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockResolvedValue({ success: true, messageId: 'msg-fail-cred' });
      jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue({ success: true });
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.FAILED,
        model: 'gemini-test',
        lineItems: [],
      });

      const raw = makeRawEmail(email, 'Unable to parse text requisition');
      const outcome = await emailGatewayService.processMessage(raw, {
        allowedSenders: [],
        allowedDomains: [],
        autoRegisterUnregisteredBuyers: true,
      });

      expect(outcome.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
      expect(mailerService.sendBuyerCredentialsEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: email,
          tempPassword: expect.any(String),
        })
      );
    });

    test('handles error if sendBuyerCredentialsEmail fails during failed RFQ notification', async () => {
      const email = 'failed.email.buyer@industrial-corp.com';
      jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockRejectedValue(new Error('SMTP down'));
      jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue({ success: true });
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.FAILED,
        model: 'gemini-test',
        lineItems: [],
      });

      const raw = makeRawEmail(email, 'Vague text request');
      const outcome = await emailGatewayService.processMessage(raw, {
        allowedSenders: [],
        allowedDomains: [],
        autoRegisterUnregisteredBuyers: true,
      });

      expect(outcome.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    });

    test('retryPendingAcknowledgements handles invalid JSON detail and sending failures', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValue([
        {
          id: 'ack-bad-json',
          message_id: 'msg-bad#ack',
          from_address: 'bad.json@domain.com',
          subject: 'RFQ Requisition',
          rfq_number: 'RFQ-BAD-001',
          detail: '{invalid-json',
          processed_at: new Date().toISOString(),
        },
        {
          id: 'ack-fail-send',
          message_id: 'msg-fail#ack',
          from_address: 'fail.send@domain.com',
          subject: 'RFQ Requisition',
          rfq_number: 'RFQ-FAIL-001',
          detail: JSON.stringify({ buyerName: 'Fail Buyer', tempPassword: 'Pass' }),
          processed_at: new Date().toISOString(),
        },
      ]);
      jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue({ success: true });
      jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockRejectedValue(new Error('Send failed'));

      const outcome = await emailGatewayService.retryPendingAcknowledgements();
      expect(outcome.sent).toBe(1);
      expect(outcome.stillPending).toBe(1);
    });

    test('covers resolveConnectionState, resolveVendorConfig, and isConfigured branches', () => {
      const cfg = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'false',
        VENDOR_EMAIL_GATEWAY_POLL_MS: '5000',
        VENDOR_EMAIL_GATEWAY_MAX_PER_POLL: '2',
        VENDOR_EMAIL_GATEWAY_ALLOWED_SENDERS: 'a@b.com, c@d.com',
        VENDOR_EMAIL_GATEWAY_ALLOWED_DOMAINS: 'b.com, d.com',
      });
      expect(cfg.enabled).toBe(false);
      expect(cfg.allowedSenders).toEqual(['a@b.com', 'c@d.com']);
      expect(cfg.allowedDomains).toEqual(['b.com', 'd.com']);
      expect(emailGatewayService.describeConfigurationFault(cfg)).toBeNull();

      // isConfigured
      jest.spyOn(mailerService, 'isVendorGmailApiConfigured').mockReturnValue(false);
      expect(emailGatewayService.isConfigured(cfg)).toBe(false);
      jest.spyOn(mailerService, 'isVendorGmailApiConfigured').mockReturnValue(true);
      expect(emailGatewayService.isConfigured(cfg)).toBe(true);

      const buyerCfg = { isVendorMailbox: false };
      jest.spyOn(mailerService, 'isGmailApiConfigured').mockReturnValue(false);
      expect(emailGatewayService.isConfigured(buyerCfg)).toBe(false);
      jest.spyOn(mailerService, 'isGmailApiConfigured').mockReturnValue(true);
      expect(emailGatewayService.isConfigured(buyerCfg)).toBe(true);

      // resolveConnectionState with disabled config
      jest.spyOn(mailerService, 'isVendorGmailApiConfigured').mockReturnValue(false);
      expect(emailGatewayService.resolveConnectionState(cfg)).toBe(EMAIL_GATEWAY_STATE.NOT_CONFIGURED);

      jest.spyOn(mailerService, 'isVendorGmailApiConfigured').mockReturnValue(true);
      expect(emailGatewayService.resolveConnectionState(cfg, { watching: true })).toBe(EMAIL_GATEWAY_STATE.SWITCHED_OFF);

      // resolveConnectionState with enabled config
      const enabledCfg = { ...cfg, enabled: true };
      expect(emailGatewayService.resolveConnectionState(enabledCfg, { lastError: 'Some error' })).toBe(EMAIL_GATEWAY_STATE.CONNECTION_ERROR);
      expect(emailGatewayService.resolveConnectionState(enabledCfg, { watching: true })).toBe(EMAIL_GATEWAY_STATE.ACTIVE_LISTENING);
      expect(emailGatewayService.resolveConnectionState(enabledCfg, { watching: false })).toBe(EMAIL_GATEWAY_STATE.SWITCHED_OFF);

      // describeConfigurationFault branch in resolveConnectionState and startPolling
      emailGatewayService.runtime.pollTimer = null;
      emailGatewayService.vendorRuntime.pollTimer = null;
      jest.spyOn(emailGatewayService, 'describeConfigurationFault').mockReturnValue('Missing configuration credentials');
      expect(emailGatewayService.resolveConnectionState(enabledCfg)).toBe(EMAIL_GATEWAY_STATE.CONNECTION_ERROR);
      expect(emailGatewayService.startBuyerPolling(enabledCfg)).toEqual({ started: false, reason: 'Missing configuration credentials' });
      expect(emailGatewayService.startVendorPolling(enabledCfg)).toEqual({ started: false, reason: 'Missing configuration credentials' });
    });

    test('covers checkRfqCredits branch permutations', () => {
      expect(emailGatewayService.checkRfqCredits(null, 'mode_0', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({}, 'mode_0', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', unlimitedAccess: true }, 'mode_1', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'version_1' }, 'mode_1', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'version_2' }, 'mode_1', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'version_3' }, 'mode_1', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial' }, 'mode_0', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial' }, 'v0', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial' }, 'version_0', 1)).toEqual({ ok: true, applies: false });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial' }, 'mode_1', 1)).toEqual({ ok: true, applies: true, remaining: 5, needed: 1 });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 }, 'mode_1', 1)).toEqual({ ok: false, applies: true, remaining: 0, needed: 1 });
      expect(emailGatewayService.checkRfqCredits({ id: 'b1', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 }, 'mode_1', 3)).toEqual({ ok: false, applies: true, remaining: 2, needed: 3 });
    });

    test('covers storeEmailAttachments branch permutations', async () => {
      expect(await emailGatewayService.storeEmailAttachments(null)).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({})).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({ attachments: null })).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({ attachments: [] })).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({ attachments: [null, { content: null }] })).toEqual([]);

      jest.spyOn(rfqAttachmentService, 'saveAttachment').mockResolvedValueOnce({
        status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED,
        attachment: { id: 'att-101', fileName: 'spec.pdf' },
      });
      const saved = await emailGatewayService.storeEmailAttachments({
        attachments: [{ fileName: 'spec.pdf', contentType: 'application/pdf', content: Buffer.from('PDF content') }],
      });
      expect(saved).toEqual([{ id: 'att-101', fileName: 'spec.pdf' }]);

      jest.spyOn(rfqAttachmentService, 'saveAttachment').mockResolvedValueOnce({
        status: rfqAttachmentService.ATTACHMENT_STATUS.UNSUPPORTED_TYPE,
      });
      const unsupp = await emailGatewayService.storeEmailAttachments({
        attachments: [{ fileName: 'spec.exe', contentType: 'application/x-msdownload', content: 'exe content' }],
      });
      expect(unsupp).toEqual([]);

      jest.spyOn(rfqAttachmentService, 'saveAttachment').mockRejectedValueOnce(new Error('S3 connection failure'));
      const failed = await emailGatewayService.storeEmailAttachments({
        attachments: [{ fileName: 'err.pdf', contentType: 'application/pdf', content: 'content' }],
      });
      expect(failed).toEqual([]);
    });

    test('covers isBounceOrAutoReplyMessage and isSystemOrAutomatedSender branches', () => {
      // isBounceOrAutoReplyMessage
      expect(emailGatewayService.isBounceOrAutoReplyMessage(null)).toBe(false);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'postmaster@domain.com' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'mailer-daemon@domain.com' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'mail-daemon@domain.com' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'bounce@domain.com' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'bounces@domain.com' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Undeliverable: Requisition' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Delivery status notification' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Mail delivery failed: return' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Returned mail for user' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Failure Notice' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ fromAddress: 'user@domain.com', subject: 'Standard Buyer Request' })).toBe(false);

      // isSystemOrAutomatedSender
      expect(emailGatewayService.isSystemOrAutomatedSender(null)).toBe(false);
      expect(emailGatewayService.isSystemOrAutomatedSender('')).toBe(false);
      expect(emailGatewayService.isSystemOrAutomatedSender('no-reply@domain.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('do_not_reply@domain.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('alerts@updates.example.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('admin@accounts.google.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('support@google.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('notify@notifications.google.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('service@googlemail.com')).toBe(true);
      expect(emailGatewayService.isSystemOrAutomatedSender('genuinebuyer@enterprise.com')).toBe(false);
    });

    test('covers isOwnNoticeSubject branches', () => {
      expect(emailGatewayService.isOwnNoticeSubject(null)).toBe(false);
      expect(emailGatewayService.isOwnNoticeSubject('Enterprise QUA - Buyer Registration Required')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Re[1]: Action Required – Quotation Could Not Be Processed')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Fwd: Action Required – 5 free quotation credits exhausted')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Portal bidding required for rfq #123')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Inquiry logged for rfq #123')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Action required: category mismatch')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Action Required – Your RFQ Email Could Not Be Processed')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Great news! Your requirement has been converted into RFQ #123')).toBe(true);
      expect(emailGatewayService.isOwnNoticeSubject('Urgent Quotation for Steel Pipes')).toBe(false);
    });

    test('covers shouldSendAutoReply and sendAutoReply branches', async () => {
      expect(await emailGatewayService.shouldSendAutoReply(null, 'UNAUTHORIZED_SENDER')).toEqual({
        allowed: false,
        reason: 'no sender address',
      });
      expect(
        await emailGatewayService.shouldSendAutoReply({ fromAddress: 'no-reply@test.com' }, 'UNAUTHORIZED_SENDER')
      ).toEqual({
        allowed: false,
        reason: 'automated sender address',
      });
      expect(
        await emailGatewayService.shouldSendAutoReply(
          { fromAddress: 'user@test.com', automatedReason: 'list-id' },
          'UNAUTHORIZED_SENDER'
        )
      ).toEqual({
        allowed: false,
        reason: 'automated message (list-id)',
      });
      expect(
        await emailGatewayService.shouldSendAutoReply({ fromAddress: 'user@test.com' }, 'UNKNOWN_COOLDOWN_KIND')
      ).toEqual({
        allowed: true,
      });
      expect(
        await emailGatewayService.shouldSendAutoReply(
          { fromAddress: 'user@test.com', subject: 'Enterprise QUA - Buyer Registration Required' },
          emailGatewayService.AUTO_REPLY_KIND.UNAUTHORIZED_SENDER
        )
      ).toEqual({
        allowed: false,
        reason: 'reply to our own notice',
      });
      expect(
        await emailGatewayService.shouldSendAutoReply(
          { fromAddress: 'user@procucev.com' },
          emailGatewayService.AUTO_REPLY_KIND.UNAUTHORIZED_SENDER
        )
      ).toEqual({
        allowed: false,
        reason: 'platform domain',
      });

      // In-memory cooldown limit
      const msg = { fromAddress: 'burst.sender@external.com', subject: 'RFQ Inquiry' };
      const kind = emailGatewayService.AUTO_REPLY_KIND.UNAUTHORIZED_SENDER;
      const res1 = await emailGatewayService.shouldSendAutoReply(msg, kind);
      expect(res1.allowed).toBe(true);
      const res2 = await emailGatewayService.shouldSendAutoReply(msg, kind);
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toBe('notice limit reached for this sender');

      // Database cooldown failure branch
      emailGatewayService.resetAutoReplyMemory();
      jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockRejectedValueOnce(new Error('DB read timeout'));
      const dbErr = await emailGatewayService.shouldSendAutoReply({ fromAddress: 'dberr@external.com' }, kind);
      expect(dbErr.allowed).toBe(false);
      expect(dbErr.reason).toBe('cooldown unavailable');

      // sendAutoReply branches
      const sendMock = jest.fn().mockResolvedValue({ success: true });
      expect(await emailGatewayService.sendAutoReply(null, kind, sendMock)).toBe(false);

      const sendThrowMock = jest.fn().mockRejectedValue(new Error('Send failure'));
      expect(await emailGatewayService.sendAutoReply({ fromAddress: 'throw@other.com' }, kind, sendThrowMock)).toBe(false);

      emailGatewayService.resetAutoReplyMemory();
      expect(await emailGatewayService.sendAutoReply({ fromAddress: 'throw@other.com' }, kind, sendMock)).toBe(true);
    });

    test('covers getOrCreateBuyerAccount validation and error branches', async () => {
      await expect(emailGatewayService.getOrCreateBuyerAccount('')).rejects.toThrow(
        'Email address is required for buyer onboarding.'
      );

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'buyer-existing-err',
        status: 'PENDING_ONBOARDING',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('Identity DB connection error'));
      jest.spyOn(identityQueries, 'updateUserPassword').mockRejectedValueOnce(new Error('Password persistence error'));

      const accRes = await emailGatewayService.getOrCreateBuyerAccount('errbuyer@industrial-corp.com');
      expect(accRes.buyerAccount.id).toBe('buyer-existing-err');
      expect(accRes.isOnboardingPending).toBe(true);
    });

    test('covers resolveVendorFromEmail edge cases', async () => {
      expect(await emailGatewayService.resolveVendorFromEmail(null)).toBeNull();
      expect(await emailGatewayService.resolveVendorFromEmail('rfqprocucev@gmail.com')).toBeNull();
      expect(await emailGatewayService.resolveVendorFromEmail('srinu20252026@gmail.com')).toBeNull();

      const matchedTarget = await emailGatewayService.resolveVendorFromEmail('assigned@targetvendor.com', {
        assignedVendors: [{ email: 'assigned@targetvendor.com', vendorId: 'v-assigned-101' }],
      });
      expect(matchedTarget).toEqual({ email: 'assigned@targetvendor.com', vendorId: 'v-assigned-101' });
    });

    test('covers resolveSenderAuthorisation and getOrCreateBuyerAccount temp password resolution branches', async () => {
      // 1. resolveSenderAuthorisation with existing temp password
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({
        verificationStatus: 'PENDING_ONBOARDING',
        password: 'existing-temp-pwd',
      });
      const authWithExisting = await emailGatewayService.resolveSenderAuthorisation(
        'pending@example.com',
        {},
        { status: 'PENDING_ONBOARDING' }
      );
      expect(authWithExisting.tempPassword).toBe('existing-temp-pwd');

      // 2. resolveSenderAuthorisation with findUserByEmail throwing error
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('Find error'));
      jest.spyOn(identityQueries, 'updateUserPassword').mockRejectedValueOnce(new Error('Update error'));
      const authWithThrow = await emailGatewayService.resolveSenderAuthorisation(
        'pending-throw@example.com',
        {},
        { status: 'PENDING_ONBOARDING' }
      );
      expect(authWithThrow.tempPassword).toBeTruthy();

      // 3. getOrCreateBuyerAccount with resetPasswordRequired
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'buyer-reset-pw',
        onboardingRequired: true,
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({
        resetPasswordRequired: true,
        password: 'reset-pwd-123',
      });
      const resetAcc = await emailGatewayService.getOrCreateBuyerAccount('resetbuyer@example.com');
      expect(resetAcc.tempPassword).toBe('reset-pwd-123');
    });
  });
});

