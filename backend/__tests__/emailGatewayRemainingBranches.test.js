const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const identityQueries = require('../src/db/identityQueries');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const geminiService = require('../src/services/geminiService');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');
const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('emailGatewayService remaining branch coverage', () => {
  beforeEach(() => {
    emailGatewayService.resetAutoReplyMemory();
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    emailGatewayService.stopPolling();
  });

  describe('resolveSenderAuthorisation branch coverage', () => {
    test('handles onboarding pending when identity user already has password or throws', async () => {
      // 1. identity user has verificationStatus PENDING_ONBOARDING and existing password
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({
        verificationStatus: 'PENDING_ONBOARDING',
        password: 'existing-temp-password-123',
      });

      const buyerAccountPending = {
        id: 'buyer-1',
        status: 'PENDING_ONBOARDING',
      };

      const auth1 = await emailGatewayService.resolveSenderAuthorisation(
        'buyer1@example.com',
        { allowedSenders: [] },
        buyerAccountPending
      );
      expect(auth1.allowed).toBe(true);
      expect(auth1.tempPassword).toBe('existing-temp-password-123');

      // 2. identityQueries throws and updateUserPassword throws
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('DB failure'));
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValueOnce('generated-pw-999');
      jest.spyOn(identityQueries, 'updateUserPassword').mockRejectedValueOnce(new Error('Update failed'));

      const auth2 = await emailGatewayService.resolveSenderAuthorisation(
        'buyer2@example.com',
        { allowedSenders: [] },
        { id: 'buyer-2', onboardingRequired: true }
      );
      expect(auth2.allowed).toBe(true);
      expect(auth2.tempPassword).toBe('generated-pw-999');

      // 3. allowedSenders not matching
      const auth3 = await emailGatewayService.resolveSenderAuthorisation(
        'stranger@example.com',
        { allowedSenders: ['allowed@example.com'] },
        { id: 'buyer-3', status: 'ACTIVE' }
      );
      expect(auth3.allowed).toBe(false);
    });
  });

  describe('checkRfqCredits branch coverage', () => {
    test('covers all permutations of buyerAccount, subscriptionPlan, and sourcingMode', () => {
      // Null buyerAccount
      expect(emailGatewayService.checkRfqCredits(null, 'mode_1', 1)).toEqual({ ok: true, applies: false });

      // Unlimited access account
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-unlim', unlimitedRfqAccess: true },
          'mode_1',
          1
        )
      ).toEqual({ ok: true, applies: false });

      // Paid plan
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-paid', subscriptionPlan: 'version_1' },
          'mode_1',
          5
        )
      ).toEqual({ ok: true, applies: false });

      // Mode 0 (V0)
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-v0', subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 },
          'mode_0',
          5
        )
      ).toEqual({ ok: true, applies: false });

      // Free trial with remaining >= needed
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-trial', subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 },
          'mode_1',
          2
        )
      ).toEqual({ ok: true, applies: true, remaining: 3, needed: 2 });

      // Free trial with remaining < needed
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-trial-low', subscriptionPlan: 'free_trial', remainingFreeRFQs: 1 },
          'mode_1',
          2
        )
      ).toEqual({ ok: false, applies: true, remaining: 1, needed: 2 });

      // Free trial with undefined remaining (defaults to 5)
      expect(
        emailGatewayService.checkRfqCredits(
          { id: 'b-trial-def', subscriptionPlan: 'free_trial' },
          'mode_1',
          10
        )
      ).toEqual({ ok: false, applies: true, remaining: 5, needed: 10 });
    });
  });

  describe('storeEmailAttachments branch coverage', () => {
    test('covers attachment filtering, save successes, save rejections, and throw errors', async () => {
      // Null or empty attachments
      expect(await emailGatewayService.storeEmailAttachments(null)).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({})).toEqual([]);
      expect(await emailGatewayService.storeEmailAttachments({ attachments: [{}] })).toEqual([]);

      // Attachments with content: 1 success, 1 rejected status, 1 throws
      jest.spyOn(rfqAttachmentService, 'saveAttachment')
        .mockResolvedValueOnce({
          status: rfqAttachmentService.ATTACHMENT_STATUS.SAVED,
          attachment: { id: 'att-1', fileName: 'spec.pdf' },
        })
        .mockResolvedValueOnce({
          status: 'REJECTED_UNSUPPORTED_TYPE',
        })
        .mockRejectedValueOnce(new Error('S3 connection failure'));

      const messageWithAttachments = {
        attachments: [
          { fileName: 'spec.pdf', contentType: 'application/pdf', content: Buffer.from('PDF data') },
          { fileName: 'bad.exe', contentType: 'application/x-msdownload', content: 'exe binary' },
          { fileName: 'drawing.dwg', contentType: 'image/vnd.dwg', content: 'dwg content' },
        ],
      };

      const saved = await emailGatewayService.storeEmailAttachments(messageWithAttachments);
      expect(saved.length).toBe(1);
      expect(saved[0].id).toBe('att-1');
    });
  });

  describe('processVendorQuoteMessage branch coverage', () => {
    test('handles vendor quotation credits exhausted with sanitized CC', async () => {
      const targetRfq = {
        id: 'rfq-credit-test',
        rfqNumber: 'RFQ-CREDIT-01',
        title: 'Steel Fasteners',
        buyerEmail: 'buyer@procucev.com',
        sourcingMode: 'mode_0',
      };
      const vendorRecord = {
        id: 'vendor-credit-01',
        name: 'Fastener Works',
      };
      const message = {
        fromAddress: 'vendor@fastenerworks.com',
        subject: 'Re: Quotation for RFQ-CREDIT-01',
        cc: ['buyer@procucev.com', 'partner@fastenerworks.com'],
      };

      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@procucev.com');
      jest.spyOn(storeService, 'checkVendorQuotationEligibility').mockReturnValue({
        eligible: false,
        subscriptionPlan: 'free_trial',
      });
      jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
      jest.spyOn(mailerService, 'sendVendorCreditsExhaustedEmail').mockResolvedValue({ messageId: 'm-exhaust' });

      const outcome = await emailGatewayService.processVendorQuoteMessage(message, targetRfq, vendorRecord);
      expect(outcome.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);
      expect(mailerService.sendVendorCreditsExhaustedEmail).toHaveBeenCalled();
    });

    test('handles AI extraction failure when extractQuotationFromEmail throws or returns null', async () => {
      const targetRfq = {
        id: 'rfq-extract-fail',
        rfqNumber: 'RFQ-FAIL-01',
        title: 'Transformers',
        buyerEmail: 'buyer@volt.com',
        sourcingMode: 'mode_1',
      };
      const vendorRecord = {
        id: 'vendor-volt',
        name: 'Volt Transformers Ltd',
      };
      const message = {
        fromAddress: 'sales@volttransformers.com',
        subject: 'Quote RFQ-FAIL-01',
        bodyText: 'We cannot parse this table',
      };

      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@volt.com');
      jest.spyOn(storeService, 'checkVendorQuotationEligibility').mockReturnValue({
        eligible: true,
      });
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockRejectedValue(new Error('Rate limit'));
      jest.spyOn(mailerService, 'sendQuoteFailureEmail').mockResolvedValue({ messageId: 'm-fail' });

      const outcome = await emailGatewayService.processVendorQuoteMessage(message, targetRfq, vendorRecord);
      expect(outcome.status).toBe(INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED);
      expect(mailerService.sendQuoteFailureEmail).toHaveBeenCalled();
    });
  });

  describe('startBuyerPolling and startVendorPolling error branches', () => {
    test('returns false when describeConfigurationFault returns an error', () => {
      jest.spyOn(emailGatewayService, 'isConfigured').mockReturnValue(true);
      jest.spyOn(emailGatewayService, 'describeConfigurationFault').mockReturnValue('Invalid OAuth client token');

      const res1 = emailGatewayService.startBuyerPolling({ enabled: true, pollIntervalMs: 5000 });
      expect(res1.started).toBe(false);
      expect(res1.reason).toBe('Invalid OAuth client token');

      const res2 = emailGatewayService.startVendorPolling({ enabled: true, pollIntervalMs: 5000 });
      expect(res2.started).toBe(false);
      expect(res2.reason).toBe('Invalid OAuth client token');
    });

    test('starts polling when configuration is valid', () => {
      jest.spyOn(emailGatewayService, 'isConfigured').mockReturnValue(true);
      jest.spyOn(emailGatewayService, 'describeConfigurationFault').mockReturnValue(null);

      const res = emailGatewayService.startBuyerPolling({
        enabled: true,
        pollIntervalMs: 60000,
        user: 'rfq@procucev.com',
        mailbox: 'INBOX',
      });
      expect(res.started).toBe(true);
      expect(res.pollIntervalMs).toBe(60000);

      const stopped = emailGatewayService.stopPolling();
      expect(stopped).toBe(true);
    });
  });

  describe('getOrCreateBuyerAccount comprehensive branch coverage', () => {
    test('throws on empty email', async () => {
      await expect(emailGatewayService.getOrCreateBuyerAccount('')).rejects.toThrow('Email address is required');
    });

    test('returns existing buyer account with pending password resolution or non-pending', async () => {
      // Pending onboarding with existing password
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-exist-1',
        status: 'PENDING_ONBOARDING',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({
        verificationStatus: 'PENDING_ONBOARDING',
        password: 'saved-password-xyz',
      });

      const res1 = await emailGatewayService.getOrCreateBuyerAccount('exist1@buyer.com');
      expect(res1.isNew).toBe(false);
      expect(res1.isOnboardingPending).toBe(true);
      expect(res1.tempPassword).toBe('saved-password-xyz');

      // Pending onboarding where identity lookup throws and password generation updates
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-exist-2',
        onboardingRequired: true,
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValueOnce(new Error('Network error'));
      jest.spyOn(storeService, '_generateTempPassword').mockReturnValueOnce('new-pw-123');
      jest.spyOn(identityQueries, 'updateUserPassword').mockRejectedValueOnce(new Error('Update failed'));

      const res2 = await emailGatewayService.getOrCreateBuyerAccount('exist2@buyer.com');
      expect(res2.isNew).toBe(false);
      expect(res2.isOnboardingPending).toBe(true);
      expect(res2.tempPassword).toBe('new-pw-123');

      // Non-pending existing account
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-exist-3',
        status: 'ACTIVE',
      });
      const res3 = await emailGatewayService.getOrCreateBuyerAccount('exist3@buyer.com');
      expect(res3.isNew).toBe(false);
      expect(res3.isOnboardingPending).toBe(false);
      expect(res3.tempPassword).toBeNull();
    });

    test('creates new buyer account handling identity insertion success and failure', async () => {
      // 1. Successful identity user creation
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValueOnce({
        user: { id: 'created-user-1', orgId: 'created-org-1' },
      });
      jest.spyOn(storeService, 'addBuyerAccount').mockImplementation((data) => data);

      const res1 = await emailGatewayService.getOrCreateBuyerAccount('newuser@brandcorp.com');
      expect(res1.isNew).toBe(true);
      expect(res1.buyerAccount.id).toBe('created-user-1');
      expect(res1.buyerAccount.organizationId).toBe('created-org-1');

      // 2. Identity user creation throws DB error
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockRejectedValueOnce(new Error('Duplicate identity user'));
      const res2 = await emailGatewayService.getOrCreateBuyerAccount('newuser2@brandcorp.com');
      expect(res2.isNew).toBe(true);
      expect(res2.buyerAccount.id).toMatch(/^buyer-user-/);
    });
  });

  describe('isBounceOrAutoReplyMessage and processMessage loop prevention', () => {
    test('identifies bounce subjects correctly', () => {
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ subject: 'Delivery status notification (Failure)' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ subject: 'Mail delivery failed: returning message' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ subject: 'Undeliverable mail' })).toBe(true);
      expect(emailGatewayService.isBounceOrAutoReplyMessage({ subject: 'Normal RFQ Subject' })).toBe(false);
    });

    test('processMessage skips message originating from gateway own configured address', async () => {
      const emailIngestionService = require('../src/services/emailIngestionService');
      const { EMAIL_INGESTION_STATUS } = require('../src/config/constants');
      jest.spyOn(emailIngestionService, 'prepareEmailForExtraction').mockResolvedValueOnce({
        status: EMAIL_INGESTION_STATUS.READY,
        message: { fromAddress: 'rfq-gateway@procucev.com', subject: 'Looping email' },
      });

      const outcome = await emailGatewayService.processMessage('dummy raw email', {
        address: 'rfq-gateway@procucev.com',
        user: 'rfq-gateway@procucev.com',
      });
      expect(outcome.status).toBe(INGESTION_OUTCOME.SKIPPED_OUTBOUND);
    });
  });

  describe('retryPendingAcknowledgements tempPassword branch', () => {
    test('dispatches onboarding email when pending acknowledgement contains tempPassword', async () => {
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([
        {
          message_id: 'ack-1',
          from_address: 'buyer@procucev.com',
          rfq_number: 'RFQ-ACK-01',
          subject: 'RFQ Subject',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({
            tempPassword: 'initial-password-123',
            buyerName: 'Procurement Officer',
            rfqTitle: 'Pumps Requirement',
            deliveryDate: '2026-12-01',
            category: 'Pumps',
            deliveryLocation: 'Mumbai',
          }),
        },
      ]);
      jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValueOnce({ messageId: 'm-ack' });
      jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValueOnce(true);

      const res = await emailGatewayService.retryPendingAcknowledgements();
      expect(res.sent).toBe(1);
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).toHaveBeenCalled();
    });
  });

  describe('processVendorQuoteMessage buyer profile completion reminder', () => {
    test('sends profile completion reminder when buyer profile update is required', async () => {
      const targetRfq = {
        id: 'rfq-profile-reminder',
        rfqNumber: 'RFQ-REMIND-01',
        title: 'Industrial Valves',
        buyerEmail: 'unverified-buyer@corp.com',
        sourcingMode: 'mode_1',
      };
      const vendorRecord = {
        id: 'vendor-valves',
        name: 'Apex Valves Ltd',
      };
      const message = {
        fromAddress: 'quotes@apexvalves.com',
        subject: 'Re: Quotation for RFQ-REMIND-01',
        bodyText: 'Quotation amount: INR 500,000 for 50 valves',
      };

      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('unverified-buyer@corp.com');
      jest.spyOn(storeService, 'checkVendorQuotationEligibility').mockReturnValue({ eligible: true });
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({
        isQuery: false,
        hasIssue: false,
        isInquiry: false,
        pricing: { totalPrice: 500000, currency: 'INR' },
        lineItems: [{ description: 'Gate valve', quantity: 50, unitPrice: 10000 }],
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-unverified',
        organizationName: 'Unverified Buyers Inc',
      });
      jest.spyOn(storeService, 'isBuyerProfileUpdateRequired').mockReturnValueOnce(true);
      jest.spyOn(storeService, 'hasQuoteAckBeenSent').mockReturnValueOnce(false);
      jest.spyOn(storeService, 'markQuoteAckSent').mockImplementation(() => {});
      jest.spyOn(storeService, 'queuePendingQuoteNotification').mockImplementation(() => {});
      jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail').mockResolvedValueOnce({ messageId: 'm-remind' });
      jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});

      // Mock storeService.recordVendorQuotation or save
      jest.spyOn(storeService, 'addQuoteToRFQ').mockReturnValueOnce({
        rfq: { ...targetRfq, status: 'Active' },
        quote: { id: 'q-1', vendorId: vendorRecord.id },
      });

      const outcome = await emailGatewayService.processVendorQuoteMessage(message, targetRfq, vendorRecord);
      expect(outcome.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(mailerService.sendBuyerProfileCompletionReminderEmail).toHaveBeenCalled();
    });

    test('covers isV1OrV3Rfq custom roster mode and unknown mode in processVendorQuoteMessage', async () => {
      const message = {
        fromAddress: 'vendor@fastenerworks.com',
        subject: 'Re: Quotation',
        cc: ['buyer@procucev.com'],
      };
      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@procucev.com');
      jest.spyOn(storeService, 'checkVendorQuotationEligibility').mockReturnValue({ eligible: false });
      jest.spyOn(mailerService, 'sendVendorCreditsExhaustedEmail').mockResolvedValue({ messageId: 'm' });

      // Mode containing 'roster'
      const outcome1 = await emailGatewayService.processVendorQuoteMessage(
        message,
        { id: 'rfq-roster', rfqNumber: 'RFQ-R1', sourcingMode: 'custom_roster_pool' },
        { id: 'v1', name: 'Vendor 1' }
      );
      expect(outcome1.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);

      // Mode containing unknown
      const outcome2 = await emailGatewayService.processVendorQuoteMessage(
        message,
        { id: 'rfq-unknown', rfqNumber: 'RFQ-U1', sourcingMode: 'arbitrary_unknown_mode' },
        { id: 'v1', name: 'Vendor 1' }
      );
      expect(outcome2.status).toBe(INGESTION_OUTCOME.CREDITS_EXHAUSTED);
    });
  });

  describe('additional branch edges in getOrCreateBuyerAccount and processMessage', () => {
    test('covers concurrent re-check branch in getOrCreateBuyerAccount', async () => {
      let callCount = 0;
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return null;
        return { id: 'concurrent-buyer-1', status: 'ACTIVE' };
      });
      const res = await emailGatewayService.getOrCreateBuyerAccount('concurrent@corp.com');
      expect(res.isNew).toBe(false);
      expect(res.buyerAccount.id).toBe('concurrent-buyer-1');
    });

    test('processMessage skips message originating from gateway config.address when user is different', async () => {
      const emailIngestionService = require('../src/services/emailIngestionService');
      const { EMAIL_INGESTION_STATUS } = require('../src/config/constants');
      jest.spyOn(emailIngestionService, 'prepareEmailForExtraction').mockResolvedValueOnce({
        status: EMAIL_INGESTION_STATUS.READY,
        message: { fromAddress: 'intake@external-relay.com', subject: 'Looping email' },
      });

      const outcome = await emailGatewayService.processMessage('dummy raw email', {
        address: 'intake@external-relay.com',
        user: 'different-oauth-user@gmail.com',
      });
      expect(outcome.status).toBe(INGESTION_OUTCOME.SKIPPED_OUTBOUND);
    });
  });
});


