const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const identityQueries = require('../src/db/identityQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const storeService = require('../src/services/storeService');
const geminiService = require('../src/services/geminiService');
const rfqAttachmentService = require('../src/services/rfqAttachmentService');
const cryptoService = require('../src/services/cryptoService');
const { EMAIL_GATEWAY_CONFIG, EMAIL_GATEWAY_DELIVERY_KIND, EMAIL_GATEWAY_MESSAGES } = require('../src/config/constants');
const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('emailGatewayService remaining branch coverage', () => {
  let originalAesEncryptionKey;
  let originalAesSecretKey;

  beforeEach(() => {
    originalAesEncryptionKey = process.env.AES_ENCRYPTION_KEY;
    originalAesSecretKey = process.env.AES_SECRET_KEY;
    emailGatewayService.resetAutoReplyMemory();
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    emailGatewayService.stopPolling();
    if (originalAesEncryptionKey === undefined) delete process.env.AES_ENCRYPTION_KEY;
    else process.env.AES_ENCRYPTION_KEY = originalAesEncryptionKey;
    if (originalAesSecretKey === undefined) delete process.env.AES_SECRET_KEY;
    else process.env.AES_SECRET_KEY = originalAesSecretKey;
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
      process.env.AES_ENCRYPTION_KEY = 'email-gateway-branches-test-key';
      delete process.env.AES_SECRET_KEY;
      const messageId = 'ack-1';
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([
        {
          message_id: messageId,
          from_address: 'buyer@procucev.com',
          rfq_number: 'RFQ-ACK-01',
          subject: 'RFQ Subject',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({
            encryptedTempPassword: cryptoService.encrypt('initial-password-123', {
              additionalData: `email-gateway-ack:${messageId}`,
            }).encoded,
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
      expect(mailerService.sendBuyerOnboardingWithRfqEmail).toHaveBeenCalledWith(
        expect.objectContaining({ tempPassword: 'initial-password-123' })
      );
    });

    test.each([
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_QUOTE_FAILURE,
        method: 'sendQuoteFailureEmail',
        detail: {
          vendorName: 'Apex Valves',
          reason: 'Unit price is required.',
          missingFields: ['Unit Price'],
          cc: 'buyer@example.com',
        },
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_CREDITS_EXHAUSTED,
        method: 'sendVendorCreditsExhaustedEmail',
        detail: {
          vendorName: 'Apex Valves',
          cc: 'buyer@example.com',
        },
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_PORTAL_REDIRECT,
        method: 'sendComplexRfqPortalRedirectEmail',
        detail: {
          vendorName: 'Apex Valves',
          itemCount: 11,
          cc: 'buyer@example.com',
        },
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_UNAUTHORIZED_SENDER,
        method: 'sendUnauthorizedBuyerNotificationEmail',
        detail: {
          originalSubject: 'Industrial valves',
          gatewayAddress: 'buyer-intake@example.com',
        },
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_UNAUTHORIZED_SENDER,
        method: 'sendUnauthorizedBuyerNotificationEmail',
        detail: {
          originalSubject: 'Industrial valves',
          gatewayAddress: 'vendor-intake@example.com',
        },
      },
    ])('retries $deliveryKind notices from the durable email ledger', async ({ deliveryKind, method, detail }) => {
      const messageId = `notice-${deliveryKind}`;
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([
        {
          message_id: messageId,
          from_address: 'sales@vendor.in',
          rfq_number: 'RFQ-RETRY-01',
          subject: 'Industrial valves',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({
            deliveryKind,
            rfqTitle: 'Industrial valves',
            ...detail,
          }),
        },
      ]);
      const deliverySpy = jest.spyOn(mailerService, method).mockResolvedValueOnce({ sent: true });
      const recordSpy = jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result.sent).toBe(1);
      const expectedDeliveryContext = [
        EMAIL_GATEWAY_DELIVERY_KIND.BUYER_UNAUTHORIZED_SENDER,
        EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_UNAUTHORIZED_SENDER,
      ].includes(deliveryKind)
        ? {
          subject: 'Industrial valves',
          gatewayAddress: detail.gatewayAddress,
        }
        : deliveryKind === EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_PORTAL_REDIRECT
          ? {
            rfq: { rfqNumber: 'RFQ-RETRY-01', title: 'Industrial valves' },
            vendorName: 'Apex Valves',
            itemCount: 11,
            cc: 'buyer@example.com',
          }
          : {
            rfqNumber: 'RFQ-RETRY-01',
            rfqTitle: 'Industrial valves',
            vendorName: 'Apex Valves',
            cc: 'buyer@example.com',
          };
      expect(deliverySpy).toHaveBeenCalledWith('sales@vendor.in', expect.objectContaining(expectedDeliveryContext));
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        messageId,
        status: INGESTION_OUTCOME.ACK_SENT,
      }));
    });

    test('reconstructs a vendor quote acknowledgement from its persisted RFQ and quote IDs', async () => {
      const quote = { id: 'quote-ack-1', vendorId: 'vendor-1', vendorName: 'Apex Valves', unitPrice: 120 };
      const rfq = { id: 'rfq-ack-1', rfqNumber: 'RFQ-ACK-01', title: 'Industrial valves', quotes: [quote] };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([{
        message_id: 'notice-vendor-quote-ack',
        rfq_id: rfq.id,
        from_address: 'sales@vendor.in',
        rfq_number: rfq.rfqNumber,
        subject: rfq.title,
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({
          deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_QUOTE_ACK,
          quoteId: quote.id,
          vendorName: quote.vendorName,
          buyerEmail: 'buyer@example.com',
        }),
      }]);
      jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      const deliverySpy = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValueOnce({ sent: true });
      const recordSpy = jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result.sent).toBe(1);
      expect(deliverySpy).toHaveBeenCalledWith('sales@vendor.in', expect.objectContaining({
        rfqNumber: rfq.rfqNumber,
        rfqTitle: rfq.title,
        vendorName: quote.vendorName,
        quote,
        buyerEmail: 'buyer@example.com',
      }));
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        messageId: 'notice-vendor-quote-ack',
        status: INGESTION_OUTCOME.ACK_SENT,
      }));
    });

    test('reconstructs a vendor issue acknowledgement from its persisted inquiry and message IDs', async () => {
      const inquiryMessage = {
        id: 'msg-vendor-issue-retry-1',
        senderRole: 'vendor',
        senderEmail: 'sales@vendor.in',
        message: 'Please confirm the drawing revision before we submit our quote.',
      };
      const inquiry = {
        id: 'inquiry-vendor-issue-retry-1',
        vendorName: 'Apex Valves',
        vendorEmail: 'sales@vendor.in',
        messages: [inquiryMessage],
      };
      const rfq = {
        id: 'rfq-vendor-issue-retry-1',
        rfqNumber: 'RFQ-VENDOR-ISSUE-RETRY-01',
        title: 'Industrial valves',
        inquiries: [inquiry],
      };
      const row = {
        message_id: 'notice-vendor-inquiry-retry-1',
        rfq_id: rfq.id,
        from_address: 'sales@vendor.in',
        rfq_number: rfq.rfqNumber,
        subject: rfq.title,
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({
          deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK,
          inquiryId: inquiry.id,
          inquiryMessageId: inquiryMessage.id,
        }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@example.com');
      const deliverySpy = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValueOnce({ sent: true });
      const recordSpy = jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result).toEqual({ sent: 1, abandoned: 0, stillPending: 0 });
      expect(deliverySpy).toHaveBeenCalledWith('sales@vendor.in', expect.objectContaining({
        rfq,
        rfqNumber: rfq.rfqNumber,
        rfqTitle: rfq.title,
        vendorName: inquiry.vendorName,
        issueMessage: inquiryMessage.message,
        reason: EMAIL_GATEWAY_MESSAGES.VENDOR_ISSUE_REPLY_REASON,
        cc: 'buyer@example.com',
      }));
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        messageId: row.message_id,
        status: INGESTION_OUTCOME.ACK_SENT,
      }));
    });

    test('retries a vendor inquiry acknowledgement from process-local storage', async () => {
      const inquiryMessage = {
        id: 'local-message-1',
        message: 'Please confirm the drawing revision.',
      };
      const inquiry = {
        id: 'local-inquiry-1',
        vendorName: 'Local Supplier',
        vendorEmail: 'sales@local-vendor.in',
        messages: [inquiryMessage],
      };
      const rfq = {
        id: 'local-rfq-1',
        rfqNumber: 'RFQ-LOCAL-RETRY-1',
        title: 'Local retry RFQ',
        inquiries: [inquiry],
      };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      jest.spyOn(storeService, 'resolveBuyerEmailForRFQ').mockReturnValue('buyer@example.com');
      const deliverySpy = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValueOnce({ sent: true });
      const messageKey = 'local-inbound#notice-vendor_inquiry_ack';

      await emailGatewayService.queueAcknowledgement(messageKey, {
        to: inquiry.vendorEmail,
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK,
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
        inquiryId: inquiry.id,
        inquiryMessageId: inquiryMessage.id,
      });
      const result = await emailGatewayService.retryPendingAcknowledgements({
        deliveryKinds: [EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK],
      });

      expect(result).toEqual({ sent: 1, abandoned: 0, stillPending: 0 });
      expect(deliverySpy).toHaveBeenCalledWith(inquiry.vendorEmail, expect.objectContaining({
        rfq,
        issueMessage: inquiryMessage.message,
        reason: EMAIL_GATEWAY_MESSAGES.VENDOR_ISSUE_REPLY_REASON,
        cc: 'buyer@example.com',
      }));
      await expect(emailGatewayQueries.listByStatus(INGESTION_OUTCOME.ACK_PENDING, 5, {
        deliveryKinds: [EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK],
      })).resolves.toEqual([]);
    });

    test('keeps vendor inquiry retries pending when the persisted message is missing', async () => {
      const rfq = {
        id: 'rfq-vendor-issue-missing-message',
        rfqNumber: 'RFQ-VENDOR-ISSUE-MISSING-MESSAGE',
        inquiries: [{ id: 'inquiry-vendor-issue-missing-message', vendorEmail: 'sales@vendor.in', messages: [] }],
      };
      const row = {
        message_id: 'notice-vendor-inquiry-missing-message',
        rfq_id: rfq.id,
        from_address: 'sales@vendor.in',
        rfq_number: rfq.rfqNumber,
        subject: 'Industrial valves',
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({
          deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK,
          inquiryId: 'inquiry-vendor-issue-missing-message',
          inquiryMessageId: 'missing-message-id',
        }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      const deliverySpy = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail');

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result).toEqual({ sent: 0, abandoned: 0, stillPending: 1 });
      expect(deliverySpy).not.toHaveBeenCalled();
    });

    test.each([
      {
        name: 'the RFQ reference is missing',
        rfqId: null,
        fromAddress: 'sales@vendor.in',
        rfq: null,
        detail: { inquiryId: 'inquiry-1', inquiryMessageId: 'message-1' },
      },
      {
        name: 'the RFQ has no inquiry list',
        rfqId: 'rfq-without-inquiries',
        fromAddress: 'sales@vendor.in',
        rfq: { id: 'rfq-without-inquiries', inquiries: null },
        detail: { inquiryId: 'inquiry-1', inquiryMessageId: 'message-1' },
      },
      {
        name: 'the persisted inquiry has a blank ID and no message list',
        rfqId: 'rfq-with-inquiry-without-messages',
        fromAddress: 'sales@vendor.in',
        rfq: {
          id: 'rfq-with-inquiry-without-messages',
          inquiries: [{ id: '', vendorEmail: 'sales@vendor.in' }],
        },
        detail: {},
      },
      {
        name: 'the persisted message has a blank ID and its message reference is missing',
        rfqId: 'rfq-with-blank-message-id',
        fromAddress: 'sales@vendor.in',
        rfq: {
          id: 'rfq-with-blank-message-id',
          inquiries: [{
            id: 'inquiry-with-blank-message-id',
            vendorEmail: 'sales@vendor.in',
            messages: [{ id: '', message: 'Question about the specification.' }],
          }],
        },
        detail: { inquiryId: 'inquiry-with-blank-message-id' },
      },
    ])('keeps vendor inquiry retries pending when $name', async ({ rfqId, fromAddress, rfq, detail }) => {
      const row = {
        message_id: 'notice-vendor-inquiry-invalid-reference',
        rfq_id: rfqId,
        from_address: fromAddress,
        rfq_number: 'RFQ-VENDOR-INQUIRY-INVALID',
        subject: 'Industrial valves',
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({
          deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INQUIRY_ACK,
          ...detail,
        }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      if (rfq) {
        jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      }
      const deliverySpy = jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail');

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result).toEqual({ sent: 0, abandoned: 0, stillPending: 1 });
      expect(deliverySpy).not.toHaveBeenCalled();
    });

    test.each([
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_QUOTE_RECEIVED,
        detail: { recipientName: 'Buyer Organization', quotesCount: 2 },
        buyerAccountName: 'Buyer Organization',
        expectedRecipientName: 'Buyer Organization',
        expectedQuotesCount: 2,
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_PROFILE_COMPLETION_REMINDER,
        detail: { recipientName: 'Buyer Organization', quotesCount: 2 },
        buyerAccountName: 'Buyer Organization',
        expectedRecipientName: 'Buyer Organization',
        expectedQuotesCount: 2,
      },
      {
        deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_PROFILE_COMPLETION_REMINDER,
        detail: {},
        expectedRecipientName: 'Buyer',
        expectedQuotesCount: 1,
      },
    ])('reconstructs persisted buyer quote delivery $deliveryKind from its RFQ and quote IDs', async ({
      deliveryKind,
      detail,
      buyerAccountName,
      expectedRecipientName,
      expectedQuotesCount,
    }) => {
      const quote = { id: 'buyer-retry-quote-1', vendorId: 'vendor-1', vendorName: 'Apex Valves', unitPrice: 120 };
      const rfq = {
        id: 'buyer-retry-rfq-1',
        rfqNumber: 'RFQ-BUYER-RETRY-01',
        title: 'Industrial valves',
        ...(buyerAccountName ? { buyerAccountName } : {}),
        quotes: [quote],
      };
      const row = {
        message_id: `notice-${deliveryKind.toLowerCase()}`,
        rfq_id: rfq.id,
        from_address: 'buyer@example.com',
        rfq_number: rfq.rfqNumber,
        subject: rfq.title,
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({ deliveryKind, quoteId: quote.id, ...detail }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB').mockResolvedValueOnce(rfq);
      const quoteDelivery = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: true });
      const reminderDelivery = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail').mockResolvedValue({ sent: true });
      const markReminder = jest.spyOn(storeService, 'markQuoteAckSent').mockImplementation(() => {});
      const recordSpy = jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result.sent).toBe(1);
      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ messageId: row.message_id, status: INGESTION_OUTCOME.ACK_SENT }));
      if (deliveryKind === EMAIL_GATEWAY_DELIVERY_KIND.BUYER_PROFILE_COMPLETION_REMINDER) {
        expect(reminderDelivery).toHaveBeenCalledWith({
          to: row.from_address,
          recipientName: expectedRecipientName,
          rfqNumber: rfq.rfqNumber,
          rfqTitle: rfq.title,
          quotesCount: expectedQuotesCount,
        });
        expect(markReminder).toHaveBeenCalledWith(rfq);
        expect(quoteDelivery).not.toHaveBeenCalled();
      } else {
        expect(quoteDelivery).toHaveBeenCalledWith(row.from_address, { rfq, quote, recipientName: expectedRecipientName });
        expect(reminderDelivery).not.toHaveBeenCalled();
        expect(markReminder).not.toHaveBeenCalled();
      }
    });

    test('keeps buyer quote retries pending when the persisted RFQ is unavailable', async () => {
      const row = {
        message_id: 'notice-buyer-quote-missing-rfq',
        from_address: 'buyer@example.com',
        rfq_number: 'RFQ-MISSING-BUYER-RETRY',
        subject: 'Buyer quote notice',
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({
          deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_QUOTE_RECEIVED,
          quoteId: 'quote-missing-rfq',
        }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      const loadRfq = jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB');
      const sendQuote = jest.spyOn(mailerService, 'sendQuoteReceivedEmail');

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result).toEqual({ sent: 0, abandoned: 0, stillPending: 1 });
      expect(loadRfq).not.toHaveBeenCalled();
      expect(sendQuote).not.toHaveBeenCalled();
    });

    test('keeps malformed quote acknowledgement rows pending without attempting delivery', async () => {
      const listSpy = jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([
        {
          message_id: 'notice-missing-rfq-id',
          from_address: 'sales@vendor.in',
          rfq_number: 'RFQ-MISSING-ID',
          subject: 'Industrial valves',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({ deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_QUOTE_ACK, quoteId: 'quote-1' }),
        },
        {
          message_id: 'notice-missing-quotes',
          rfq_id: 'rfq-missing-quotes',
          from_address: 'sales@vendor.in',
          rfq_number: 'RFQ-MISSING-QUOTES',
          subject: 'Industrial valves',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({ deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_QUOTE_ACK, quoteId: 'quote-1' }),
        },
        {
          message_id: 'notice-missing-quote-id',
          rfq_id: 'rfq-missing-quote-id',
          from_address: 'sales@vendor.in',
          rfq_number: 'RFQ-MISSING-QUOTE-ID',
          subject: 'Industrial valves',
          processed_at: new Date().toISOString(),
          detail: JSON.stringify({ deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_QUOTE_ACK }),
        },
      ]);
      const lookup = jest.spyOn(require('../src/db/domainQueries'), 'getRFQByIdFromDB')
        .mockResolvedValueOnce({ id: 'rfq-missing-quotes' })
        .mockResolvedValueOnce({ id: 'rfq-missing-quote-id', quotes: [{ vendorName: 'Legacy Vendor' }] });
      const deliverySpy = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail');

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result).toEqual({ sent: 0, abandoned: 0, stillPending: 3 });
      expect(listSpy).toHaveBeenCalled();
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(deliverySpy).not.toHaveBeenCalled();
    });

    test('retries legacy unauthorized-sender rows with the subject and gateway defaults', async () => {
      const row = {
        message_id: 'legacy-unauthorized-notice',
        from_address: 'stranger@outside.org',
        rfq_number: null,
        subject: 'Legacy request for pumps',
        processed_at: new Date().toISOString(),
        detail: JSON.stringify({ deliveryKind: EMAIL_GATEWAY_DELIVERY_KIND.BUYER_UNAUTHORIZED_SENDER }),
      };
      jest.spyOn(emailGatewayQueries, 'listByStatus').mockResolvedValueOnce([row]);
      const deliverySpy = jest.spyOn(mailerService, 'sendUnauthorizedBuyerNotificationEmail').mockResolvedValueOnce({ sent: true });
      jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);

      const result = await emailGatewayService.retryPendingAcknowledgements();

      expect(result.sent).toBe(1);
      expect(deliverySpy).toHaveBeenCalledWith(row.from_address, {
        subject: row.subject,
        gatewayAddress: EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
      });
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

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
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
      jest.spyOn(storeService, 'submitVendorQuoteDurably').mockResolvedValue({
        rfq: { ...targetRfq, status: 'Active' },
        quoteId: 'quote-profile-reminder-test',
        buyerQuoteNotificationQueued: false,
        buyerProfileReminderQueued: false,
        vendorQuoteAcknowledgementQueued: false,
        autoClosureEmailQueued: false,
      });
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


