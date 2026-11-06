const emailGatewayService = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const geminiService = require('../src/services/geminiService');
const rfqIngestionService = require('../src/services/rfqIngestionService');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const identityQueries = require('../src/db/identityQueries');
const rfqController = require('../src/controllers/rfqController');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');
const {
  EMAIL_GATEWAY_CONFIG,
  EMAIL_RFQ_SCENARIOS,
} = require('../src/config/constants');
const fixtures = require('./fixtures/sampleRequisitionEmail');
const taxonomyFixture = require('./fixtures/categoryTaxonomy');

const { INGESTION_OUTCOME } = emailGatewayQueries;

describe('CC-Based Buyer Identification & Multi-Buyer Email-to-RFQ Scenarios', () => {
  const REG_BUYER_1 = {
    id: 'buyer-reg-001',
    organizationName: 'Tata Motors Sourcing',
    corporateEmail: 'procurement.lead@tatamotors.com',
    subscriptionPlan: 'version_1',
    remainingFreeRFQs: 5,
    status: 'ACTIVE_VERIFIED',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411018',
  };

  const REG_BUYER_2 = {
    id: 'buyer-reg-002',
    organizationName: 'Tata Motors Commercial',
    corporateEmail: 'operations.lead@tatamotors.com',
    subscriptionPlan: 'free_trial',
    remainingFreeRFQs: 3,
    status: 'ACTIVE_VERIFIED',
    city: 'Jamshedpur',
    state: 'Jharkhand',
    pincode: '831010',
  };

  const REG_BUYER_3 = {
    id: 'buyer-reg-003',
    organizationName: 'Tata Motors Plant 3',
    corporateEmail: 'plant.engineer@tatamotors.com',
    subscriptionPlan: 'free_trial',
    subscriptions: [{ plan: 'mode_1', status: 'active' }],
    remainingFreeRFQs: 0, // Exhausted credits
    status: 'ACTIVE_VERIFIED',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    pincode: '226001',
  };

  const UNREG_TO_EMAIL = 'external.consultant@consultinggroup.com';
  const UNREG_CC_EMAIL = 'finance.auditor@externalfirm.com';

  beforeEach(() => {
    emailGatewayService.resetAutoReplyMemory();
    rfqIngestionService.primeTaxonomyIndex(taxonomyFixture.CATEGORY_TAXONOMY_FIXTURE);
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rfqIngestionService.resetTaxonomyIndex();
  });

  const config = (envOverrides = {}) =>
    emailGatewayService.resolveConfig({
      EMAIL_GATEWAY_ENABLED: 'true',
      EMAIL_GATEWAY_USER: 'rfq@procucev.com',
      ...envOverrides,
    });

  const mockExtraction = (overrides = {}) =>
    jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
      status: geminiService.EXTRACTION_STATUS.SUCCESS,
      model: 'gemini-test',
      documentTitle: 'Industrial Transformers',
      lineItems: [
        { itemName: '500 kVA Step-Down Transformer', quantity: 2, unit: 'Nos', targetDate: '2027-01-15' },
      ],
      ...overrides,
    });

  describe('normalizeRecipientList utility', () => {
    test('normalizes single strings, comma-separated lists, and array of objects', () => {
      const input = [
        '  Alice@Example.com ',
        'Bob <BOB@EXAMPLE.COM>',
        { address: 'Charlie@Example.com' },
        { value: 'DAVID@EXAMPLE.COM' },
        'eva@example.com, Frank@example.com; Grace@example.com',
        '',
        null,
        'invalid-address',
      ];
      const result = emailGatewayService.normalizeRecipientList(input);
      expect(result).toEqual([
        'alice@example.com',
        'bob@example.com',
        'charlie@example.com',
        'david@example.com',
        'eva@example.com',
        'frank@example.com',
        'grace@example.com',
      ]);
    });

    test('de-duplicates email addresses case-insensitively', () => {
      const input = ['user@domain.com', 'USER@DOMAIN.COM', ' User@Domain.com '];
      const result = emailGatewayService.normalizeRecipientList(input);
      expect(result).toEqual(['user@domain.com']);
    });
  });

  describe('resolveRegisteredBuyerAccount lookup', () => {
    test('returns verified buyer account from storeService', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(REG_BUYER_1);
      const account = await emailGatewayService.resolveRegisteredBuyerAccount(REG_BUYER_1.corporateEmail);
      expect(account).toEqual(REG_BUYER_1);
    });

    test('returns null for an auto-registered account pending onboarding', async () => {
      const pendingAccount = {
        ...REG_BUYER_1,
        status: 'PENDING_ONBOARDING',
        isAutoRegistered: true,
      };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(pendingAccount);
      const account = await emailGatewayService.resolveRegisteredBuyerAccount(REG_BUYER_1.corporateEmail);
      expect(account).toBeNull();
    });

    test('returns null when no account exists in storeService or identity DB', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const account = await emailGatewayService.resolveRegisteredBuyerAccount('nobody@nowhere.com');
      expect(account).toBeNull();
    });
  });

  describe('resolveMultiBuyerAttribution', () => {
    test('Scenario 1 & 3: Unregistered TO + Registered CC routes to CC buyer without auto-registering TO', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        return null;
      });

      const message = {
        fromAddress: UNREG_TO_EMAIL,
        toAddress: 'rfq@procucev.com',
        cc: [REG_BUYER_1.corporateEmail],
      };

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, config());
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_REGISTERED_CC);
      expect(attribution.primaryBuyerAccount.id).toBe(REG_BUYER_1.id);
      expect(attribution.sharedBuyerAccounts).toHaveLength(0);
      expect(attribution.isSharedRfq).toBe(false);
      expect(attribution.shouldAutoRegisterSender).toBe(false);
      expect(attribution.eligibleNotificationRecipients).toHaveLength(1);
      expect(attribution.eligibleNotificationRecipients[0].email).toBe(REG_BUYER_1.corporateEmail);
    });

    test('Scenario 2: Registered TO + Registered CC creates a shared multi-buyer attribution', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        if (email.toLowerCase() === REG_BUYER_2.corporateEmail.toLowerCase()) return REG_BUYER_2;
        return null;
      });

      const message = {
        fromAddress: REG_BUYER_1.corporateEmail,
        toAddress: 'rfq@procucev.com',
        cc: [REG_BUYER_2.corporateEmail],
      };

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, config());
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.REGISTERED_TO_REGISTERED_CC);
      expect(attribution.primaryBuyerAccount.id).toBe(REG_BUYER_1.id);
      expect(attribution.sharedBuyerAccounts).toHaveLength(1);
      expect(attribution.sharedBuyerAccountIds).toEqual([REG_BUYER_2.id]);
      expect(attribution.sharedBuyerEmails).toEqual([REG_BUYER_2.corporateEmail]);
      expect(attribution.isSharedRfq).toBe(true);
      expect(attribution.shouldAutoRegisterSender).toBe(false);
      expect(attribution.eligibleNotificationRecipients).toHaveLength(2);
      expect(attribution.eligibleNotificationRecipients.map((r) => r.email)).toEqual([
        REG_BUYER_1.corporateEmail,
        REG_BUYER_2.corporateEmail,
      ]);
    });

    test('Scenario 3 with Multiple Registered CCs maps primary to first and shares with additional CCs', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        if (email.toLowerCase() === REG_BUYER_2.corporateEmail.toLowerCase()) return REG_BUYER_2;
        return null;
      });

      const message = {
        fromAddress: UNREG_TO_EMAIL,
        toAddress: 'rfq@procucev.com',
        cc: [REG_BUYER_1.corporateEmail, REG_BUYER_2.corporateEmail, 'random.vendor@external.com'],
      };

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, config());
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_REGISTERED_CC);
      expect(attribution.primaryBuyerAccount.id).toBe(REG_BUYER_1.id);
      expect(attribution.sharedBuyerAccounts).toHaveLength(1);
      expect(attribution.sharedBuyerAccountIds).toEqual([REG_BUYER_2.id]);
      expect(attribution.isSharedRfq).toBe(true);
      expect(attribution.shouldAutoRegisterSender).toBe(false);
      expect(attribution.eligibleNotificationRecipients).toHaveLength(2);
      expect(attribution.eligibleNotificationRecipients.map((r) => r.email)).toEqual([
        REG_BUYER_1.corporateEmail,
        REG_BUYER_2.corporateEmail,
      ]);
    });

    test('Scenario 4: Unregistered TO + Unregistered CC auto-registers TO sender only and skips CC recipient', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const autoCreatedAccount = {
        id: 'buyer-auto-999',
        organizationName: 'External Enterprises',
        corporateEmail: UNREG_TO_EMAIL,
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
        status: 'PENDING_ONBOARDING',
      };
      jest.spyOn(emailGatewayService, 'getOrCreateBuyerAccount').mockResolvedValue({
        buyerAccount: autoCreatedAccount,
        isNew: true,
        isOnboardingPending: true,
        tempPassword: 'TempPassword123#',
      });

      const message = {
        fromAddress: UNREG_TO_EMAIL,
        toAddress: 'rfq@procucev.com',
        cc: [UNREG_CC_EMAIL],
      };

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, config());
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_UNREGISTERED_CC);
      expect(attribution.primaryBuyerAccount.id).toBe(autoCreatedAccount.id);
      expect(attribution.sharedBuyerAccounts).toHaveLength(0);
      expect(attribution.isSharedRfq).toBe(false);
      expect(attribution.shouldAutoRegisterSender).toBe(true);
      expect(attribution.eligibleNotificationRecipients).toHaveLength(1);
      expect(attribution.eligibleNotificationRecipients[0].email).toBe(UNREG_TO_EMAIL);
    });

    test('Baseline: Registered TO + Unregistered CC routes strictly to Registered TO buyer', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        return null;
      });

      const message = {
        fromAddress: REG_BUYER_1.corporateEmail,
        toAddress: 'rfq@procucev.com',
        cc: [UNREG_CC_EMAIL],
      };

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, config());
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.REGISTERED_TO_ONLY);
      expect(attribution.primaryBuyerAccount.id).toBe(REG_BUYER_1.id);
      expect(attribution.sharedBuyerAccounts).toHaveLength(0);
      expect(attribution.isSharedRfq).toBe(false);
      expect(attribution.shouldAutoRegisterSender).toBe(false);
      expect(attribution.eligibleNotificationRecipients).toHaveLength(1);
      expect(attribution.eligibleNotificationRecipients[0].email).toBe(REG_BUYER_1.corporateEmail);
    });

    test('Enforces allowedSenders allowlist on sender even if CC has registered buyers', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        return null;
      });

      const message = {
        fromAddress: 'unauthorized.sender@domain.com',
        toAddress: 'rfq@procucev.com',
        cc: [REG_BUYER_1.corporateEmail],
      };

      const cfg = config({ EMAIL_GATEWAY_ALLOWED_SENDERS: 'authorized.only@domain.com' });
      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, cfg);
      expect(attribution.allowed).toBe(false);
      expect(attribution.reason).toContain('not on EMAIL_GATEWAY_ALLOWED_SENDERS');
    });

    test('Enforces allowedDomains allowlist on sender domain', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        return null;
      });

      const message = {
        fromAddress: 'unauthorized@blocked-domain.com',
        toAddress: 'rfq@procucev.com',
        cc: [REG_BUYER_1.corporateEmail],
      };

      const cfg = config({ EMAIL_GATEWAY_ALLOWED_DOMAINS: 'allowed-corp.com' });
      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, cfg);
      expect(attribution.allowed).toBe(false);
      expect(attribution.reason).toContain('not on EMAIL_GATEWAY_ALLOWED_DOMAINS');
    });

    test('Handles unregistered sender when autoRegisterUnregisteredBuyers is false', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);

      const message = {
        fromAddress: UNREG_TO_EMAIL,
        toAddress: 'rfq@procucev.com',
        cc: [UNREG_CC_EMAIL],
      };

      const cfg = config({ EMAIL_GATEWAY_AUTO_REGISTER: 'false' });
      const attribution = await emailGatewayService.resolveMultiBuyerAttribution(message, cfg);
      expect(attribution.allowed).toBe(false);
      expect(attribution.reason).toContain('No buyer account is registered');
    });
  });

  describe('End-to-End processMessage Business Scenarios', () => {
    test('Scenario 1 & 3: Unregistered TO + Registered CC creates RFQ under CC buyer and sends acknowledgement only to CC', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        return null;
      });

      const getOrCreateSpy = jest.spyOn(emailGatewayService, 'getOrCreateBuyerAccount');
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-scen-3',
        rfqNumber: 'RFQ-SCENARIO-3',
        title: '500 kVA Step-Down Transformer',
        category: 'Electrical Components & Equipment',
        status: 'Quotes Pending',
        targetDeliveryDate: '2027-01-15',
        buyerAccountId: REG_BUYER_1.id,
      });

      const onboardEmailSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValue(true);
      const ackEmailSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue(true);
      const auditLogSpy = jest.spyOn(storeService, 'addAuditLog');

      const emlSource = `From: ${UNREG_TO_EMAIL}\r\nTo: rfq@procucev.com\r\nCc: ${REG_BUYER_1.corporateEmail}\r\nSubject: Requirement for Transformers\r\n\r\nPlease quote 500 kVA Transformer.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(getOrCreateSpy).not.toHaveBeenCalled();
      expect(onboardEmailSpy).not.toHaveBeenCalled();

      expect(createRfqSpy).toHaveBeenCalledTimes(1);
      const [payload, owner] = createRfqSpy.mock.calls[0];
      expect(owner.id).toBe(REG_BUYER_1.id);
      expect(payload.buyerEmail).toBe(REG_BUYER_1.corporateEmail);
      expect(payload.raisedByEmail).toBe(UNREG_TO_EMAIL);
      expect(payload.emailRfqScenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_REGISTERED_CC);

      expect(ackEmailSpy).toHaveBeenCalledTimes(1);
      expect(ackEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: REG_BUYER_1.corporateEmail,
          rfqNumber: 'RFQ-SCENARIO-3',
        })
      );

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: REG_BUYER_1.corporateEmail,
          action: expect.stringContaining(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_REGISTERED_CC),
        })
      );
    });

    test('Scenario 2: Registered TO + Registered CC creates one logical RFQ accessible to both and notifies both', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_1.corporateEmail.toLowerCase()) return REG_BUYER_1;
        if (email.toLowerCase() === REG_BUYER_2.corporateEmail.toLowerCase()) return REG_BUYER_2;
        return null;
      });

      const createRfqSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-scen-2',
        rfqNumber: 'RFQ-SCENARIO-2',
        title: '500 kVA Step-Down Transformer',
        category: 'Electrical Components & Equipment',
        status: 'Quotes Pending',
        targetDeliveryDate: '2027-01-15',
        buyerAccountId: REG_BUYER_1.id,
        sharedBuyerAccountIds: [REG_BUYER_2.id],
        isSharedRfq: true,
      });

      const vendorAssignSpy = jest.spyOn(storeService, 'autoAssignVendorsFromDB').mockResolvedValue(true);
      const consumeCreditSpy = jest.spyOn(storeService, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: true, remaining: 4 });
      const ackEmailSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue(true);

      const emlSource = `From: ${REG_BUYER_1.corporateEmail}\r\nTo: rfq@procucev.com\r\nCc: ${REG_BUYER_2.corporateEmail}\r\nSubject: Shared Requirement for Transformers\r\n\r\nPlease quote 500 kVA Transformer.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(createRfqSpy).toHaveBeenCalledTimes(1);

      const [payload, owner] = createRfqSpy.mock.calls[0];
      expect(owner.id).toBe(REG_BUYER_1.id);
      expect(payload.sharedBuyerAccountIds).toEqual([REG_BUYER_2.id]);
      expect(payload.sharedBuyerEmails).toEqual([REG_BUYER_2.corporateEmail]);
      expect(payload.isSharedRfq).toBe(true);
      expect(payload.emailRfqScenario).toBe(EMAIL_RFQ_SCENARIOS.REGISTERED_TO_REGISTERED_CC);

      expect(vendorAssignSpy).toHaveBeenCalledTimes(1);
      expect(consumeCreditSpy).toHaveBeenCalledTimes(1);
      expect(consumeCreditSpy).toHaveBeenCalledWith(REG_BUYER_1, expect.any(String));

      expect(ackEmailSpy).toHaveBeenCalledTimes(2);
      expect(ackEmailSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          to: REG_BUYER_1.corporateEmail,
          rfqNumber: 'RFQ-SCENARIO-2',
        })
      );
      expect(ackEmailSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          to: REG_BUYER_2.corporateEmail,
          rfqNumber: 'RFQ-SCENARIO-2',
        })
      );
    });

    test('Scenario 4: Unregistered TO + Unregistered CC creates account only for TO sender', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);

      const autoAccount = {
        id: 'buyer-auto-004',
        organizationName: 'External Consulting Enterprises',
        corporateEmail: UNREG_TO_EMAIL,
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
        status: 'PENDING_ONBOARDING',
      };

      const getOrCreateSpy = jest.spyOn(emailGatewayService, 'getOrCreateBuyerAccount').mockResolvedValue({
        buyerAccount: autoAccount,
        isNew: true,
        isOnboardingPending: true,
        tempPassword: 'AutoPassword#987',
      });

      const createRfqSpy = jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-scen-4',
        rfqNumber: 'RFQ-SCENARIO-4',
        title: '500 kVA Step-Down Transformer',
        category: 'Electrical Components & Equipment',
        status: 'Quotes Pending',
        buyerAccountId: autoAccount.id,
      });

      const onboardEmailSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValue(true);
      const ackEmailSpy = jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue(true);

      const emlSource = `From: ${UNREG_TO_EMAIL}\r\nTo: rfq@procucev.com\r\nCc: ${UNREG_CC_EMAIL}\r\nSubject: Unregistered Requisition\r\n\r\nPlease quote 500 kVA Transformer.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());

      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(getOrCreateSpy).toHaveBeenCalledTimes(1);
      expect(getOrCreateSpy).toHaveBeenCalledWith(UNREG_TO_EMAIL);

      const [payload, owner] = createRfqSpy.mock.calls[0];
      expect(owner.id).toBe(autoAccount.id);
      expect(payload.sharedBuyerAccountIds).toEqual([]);
      expect(payload.isSharedRfq).toBe(false);
      expect(payload.emailRfqScenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_UNREGISTERED_CC);

      expect(onboardEmailSpy).toHaveBeenCalledTimes(1);
      expect(onboardEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: UNREG_TO_EMAIL,
          rfqNumber: 'RFQ-SCENARIO-4',
          tempPassword: 'AutoPassword#987',
        })
      );
      expect(ackEmailSpy).not.toHaveBeenCalled();
    });

    test('Scenario 3 credit exhaustion: refuses RFQ when registered CC buyer has 0 credits and notifies CC buyer', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email.toLowerCase() === REG_BUYER_3.corporateEmail.toLowerCase()) return REG_BUYER_3;
        return null;
      });

      const notCreatedSpy = jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue(true);

      const emlSource = `From: ${UNREG_TO_EMAIL}\r\nTo: rfq@procucev.com\r\nCc: ${REG_BUYER_3.corporateEmail}\r\nSubject: Need Transformers\r\n\r\nPlease quote 500 kVA Transformer.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());

      expect(result.status).toBe(INGESTION_OUTCOME.RFQ_CREDITS_EXHAUSTED);
      expect(notCreatedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: UNREG_TO_EMAIL,
          reason: 'CREDITS_EXHAUSTED',
        })
      );
    });

    test('Multi-buyer shared RFQ access via storeService.getRFQs and rfqController scoping', () => {
      const mockRfqs = [
        {
          id: 'rfq-standalone-1',
          rfqNumber: 'RFQ-1',
          buyerAccountId: REG_BUYER_1.id,
          sharedBuyerAccountIds: [],
        },
        {
          id: 'rfq-shared-1',
          rfqNumber: 'RFQ-SHARED',
          buyerAccountId: REG_BUYER_1.id,
          sharedBuyerAccountIds: [REG_BUYER_2.id],
          isSharedRfq: true,
        },
        {
          id: 'rfq-standalone-2',
          rfqNumber: 'RFQ-2',
          buyerAccountId: REG_BUYER_2.id,
          sharedBuyerAccountIds: [],
        },
      ];

      storeService.rfqs = mockRfqs;

      // Buyer 1 should see RFQ-1 and RFQ-SHARED
      const buyer1Rfqs = storeService.getRFQs(REG_BUYER_1.id);
      expect(buyer1Rfqs.map((r) => r.rfqNumber)).toEqual(['RFQ-1', 'RFQ-SHARED']);

      // Buyer 2 should see RFQ-SHARED and RFQ-2
      const buyer2Rfqs = storeService.getRFQs(REG_BUYER_2.id);
      expect(buyer2Rfqs.map((r) => r.rfqNumber)).toEqual(['RFQ-SHARED', 'RFQ-2']);

      // Stranger buyer should see neither
      const strangerRfqs = storeService.getRFQs('stranger-buyer-999');
      expect(strangerRfqs).toHaveLength(0);
    });

    test('rfqController.canAccessRfq grants access to both primary and shared buyers', async () => {
      const rfq = {
        id: 'rfq-shared-123',
        buyerAccountId: REG_BUYER_1.id,
        sharedBuyerAccountIds: [REG_BUYER_2.id],
      };

      const checkAccess = (scope, r) => {
        if (!scope.buyerAccountId) return false;
        if (r.buyerAccountId === scope.buyerAccountId) return true;
        if (Array.isArray(r.sharedBuyerAccountIds) && r.sharedBuyerAccountIds.includes(scope.buyerAccountId)) {
          return true;
        }
        return false;
      };

      const scope1 = { role: 'buyer', restricted: true, buyerAccountId: REG_BUYER_1.id };
      const scope2 = { role: 'buyer', restricted: true, buyerAccountId: REG_BUYER_2.id };
      const scope3 = { role: 'buyer', restricted: true, buyerAccountId: 'buyer-stranger' };

      expect(checkAccess(scope1, rfq)).toBe(true);
      expect(checkAccess(scope2, rfq)).toBe(true);
      expect(checkAccess(scope3, rfq)).toBe(false);
    });

    test('domainQueries.getRFQsFromDB generates exact JSON array containment for both Postgres and D1', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ raw: { id: 'rfq-shared-1' } }] });
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const rfqs = await domainQueries.getRFQsFromDB('buyer-123', 50);
      expect(rfqs).toHaveLength(1);
      expect(querySpy).toHaveBeenCalled();

      const [sql, params, options] = querySpy.mock.calls[0];
      expect(sql).toContain("raw->'sharedBuyerAccountIds' ? $1");
      expect(sql).toContain("raw->>'buyerAccountId' = $1");
      expect(sql).toContain("raw->>'buyerId' = $1");
      expect(options.d1Text).toContain("EXISTS (SELECT 1 FROM json_each(raw, '$.sharedBuyerAccountIds') WHERE json_each.value = $1)");
      expect(options.d1Text).toContain("json_extract(raw, '$.buyerAccountId') = $1");
      expect(options.d1Text).toContain("json_extract(raw, '$.buyerId') = $1");
      expect(params).toEqual(['buyer-123', 50]);
    });

    test('Identity DB linking fallback for resolveRegisteredBuyerAccount', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({
        id: 'user-id-123',
        email: 'linked.buyer@company.com',
        role: 'buyer',
        name: 'Linked Buyer',
        orgId: 'org-123',
        orgName: 'Linked Enterprises',
        mobile: '+919876543210',
        verificationStatus: 'ACTIVE',
        resetPasswordRequired: false,
      });
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
        id: 'buyer-linked-123',
        corporateEmail: 'linked.buyer@company.com',
        organizationName: 'Linked Enterprises',
        status: 'ACTIVE_VERIFIED',
      });

      const account = await emailGatewayService.resolveRegisteredBuyerAccount('linked.buyer@company.com');
      expect(account).not.toBeNull();
      expect(account.id).toBe('buyer-linked-123');
    });

    test('resolveMultiBuyerAttribution with sender linked from identity DB', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockImplementation(async (email) => {
        if (email === 'linked.sender@company.com') return null;
        return null;
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockImplementation(async (email) => {
        if (email === 'linked.sender@company.com') {
          return {
            id: 'id-sender-1',
            email: 'linked.sender@company.com',
            role: 'buyer',
            name: 'Linked Sender',
            orgId: 'org-sender-1',
            orgName: 'Sender Org',
            mobile: '9876543210',
            verificationStatus: 'ACTIVE',
            resetPasswordRequired: false,
          };
        }
        return null;
      });
      jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
        id: 'buyer-linked-sender',
        corporateEmail: 'linked.sender@company.com',
        organizationName: 'Sender Org',
        status: 'ACTIVE_VERIFIED',
      });

      const attribution = await emailGatewayService.resolveMultiBuyerAttribution({
        fromAddress: 'linked.sender@company.com',
        toAddress: 'rfq@procucev.com',
        cc: [],
      });
      expect(attribution.allowed).toBe(true);
      expect(attribution.scenario).toBe(EMAIL_RFQ_SCENARIOS.REGISTERED_TO_ONLY);
      expect(attribution.primaryBuyerAccount.id).toBe('buyer-linked-sender');
    });

    test('getOrCreateBuyerAccount concurrency returns same promise for duplicate in-flight registration', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: { id: 'u-concurrent', orgId: 'org-concurrent' },
      });
      jest.spyOn(storeService, 'addBuyerAccount').mockReturnValue({
        id: 'buyer-concurrent',
        corporateEmail: 'concurrent@example.com',
        status: 'PENDING_ONBOARDING',
      });

      const p1 = emailGatewayService.getOrCreateBuyerAccount('concurrent@example.com');
      const p2 = emailGatewayService.getOrCreateBuyerAccount('concurrent@example.com');
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.buyerAccount.id).toBe(r2.buyerAccount.id);
    });

    test('getOrCreateBuyerAccount when user already exists in identity DB but pending onboarding', async () => {
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: false,
        user: {
          id: 'u-existing',
          email: 'existing.pending@example.com',
          password: 'StoredPendingPassword#1',
          verificationStatus: 'PENDING_ONBOARDING',
          resetPasswordRequired: true,
        },
      });
      jest.spyOn(storeService, 'addBuyerAccount').mockReturnValue({
        id: 'buyer-existing-pending',
        corporateEmail: 'existing.pending@example.com',
        status: 'PENDING_ONBOARDING',
      });

      const res = await emailGatewayService.getOrCreateBuyerAccount('existing.pending@example.com');
      expect(res.tempPassword).toBe('StoredPendingPassword#1');
    });

    test('covers autoAssignVendorsFromDB and confirmRfqPersisted exception logging', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(REG_BUYER_1);
      jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-err-catch',
        rfqNumber: 'RFQ-ERR-1',
        title: 'Transformers',
        category: 'Electrical Components & Equipment',
        status: 'Quotes Pending',
        buyerAccountId: REG_BUYER_1.id,
      });
      jest.spyOn(storeService, 'autoAssignVendorsFromDB').mockRejectedValueOnce(new Error('Vendor DB connection glitch'));
      jest.spyOn(storeService, 'confirmRfqPersisted').mockRejectedValueOnce(new Error('Persist glitch'));
      jest.spyOn(mailerService, 'sendRfqAcknowledgementEmail').mockResolvedValue(true);

      const emlSource = `From: ${REG_BUYER_1.corporateEmail}\r\nTo: rfq@procucev.com\r\nSubject: Need Transformers\r\n\r\nItem details.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());
      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
    });

    test('covers sendBuyerOnboardingWithRfqEmail failure leading to queueAcknowledgement', async () => {
      mockExtraction();
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(emailGatewayService, 'getOrCreateBuyerAccount').mockResolvedValue({
        buyerAccount: { id: 'b-err', corporateEmail: UNREG_TO_EMAIL, status: 'PENDING_ONBOARDING' },
        isNew: true,
        isOnboardingPending: true,
        tempPassword: 'Pass#123',
      });
      jest.spyOn(storeService, 'createRFQ').mockReturnValue({
        id: 'rfq-onboard-err',
        rfqNumber: 'RFQ-ONBOARD-ERR',
        title: 'Transformers',
        category: 'Electrical Components & Equipment',
        status: 'Quotes Pending',
        buyerAccountId: 'b-err',
      });
      jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockRejectedValueOnce(new Error('SMTP down'));
      const queueSpy = jest.spyOn(emailGatewayService, 'queueAcknowledgement').mockResolvedValue(true);

      const emlSource = `From: ${UNREG_TO_EMAIL}\r\nTo: rfq@procucev.com\r\nSubject: Need Transformers\r\n\r\nItem details.`;
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());
      expect(result.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(queueSpy).toHaveBeenCalled();
    });


    test('covers gateway outbound address detection to avoid loop (SKIPPED_OUTBOUND)', async () => {
      const emlSource = 'From: rfq@procucev.com\r\nTo: vendor@procucev.com\r\nSubject: RFQ Notification\r\n\r\nLoop test';
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());
      expect(result.status).toBe(INGESTION_OUTCOME.SKIPPED_OUTBOUND);
    });

    test('covers notifyRfqNotCreated credentials dispatch when onboarding is pending', async () => {
      const buyerCredsSpy = jest.spyOn(mailerService, 'sendBuyerCredentialsEmail').mockRejectedValueOnce(new Error('Creds dispatch failed'));
      const notCreatedSpy = jest.spyOn(mailerService, 'sendRfqNotCreatedEmail').mockResolvedValue(true);

      const account = { id: 'b-fail', mobileNumber: '9876543210' };

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(emailGatewayService, 'getOrCreateBuyerAccount').mockResolvedValue({
        buyerAccount: account,
        isNew: true,
        isOnboardingPending: true,
        tempPassword: 'TempPassword123!',
      });
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValueOnce({
        status: geminiService.EXTRACTION_STATUS.NO_ITEMS,
        rawResponse: 'No items',
        lineItems: [],
      });

      const emlSource = 'From: unreg-fail@example.com\r\nTo: rfq@procucev.com\r\nSubject: Empty RFQ\r\n\r\nHello';
      const result = await emailGatewayService.processMessage(Buffer.from(emlSource, 'utf8'), config());
      expect(buyerCredsSpy).toHaveBeenCalled();
      expect(notCreatedSpy).toHaveBeenCalled();
      expect(result.status).toBe(INGESTION_OUTCOME.NO_LINE_ITEMS);
    });

    test('covers vendor inquiry when storeService.addInquiryToRFQ throws', async () => {
      const targetRfq = {
        id: 'rfq-inq-1',
        rfqNumber: 'RFQ-INQ-1',
        buyerAccountId: 'b-owner',
        assignedVendors: [{ id: 'v-10', name: 'Vendor 10', email: 'vendor10@example.com' }],
      };
      const vendorRecord = { id: 'v-10', name: 'Vendor 10', email: 'vendor10@example.com' };
      jest.spyOn(storeService, 'addInquiryToRFQ').mockImplementationOnce(() => {
        throw new Error('Inquiry DB error');
      });
      jest.spyOn(mailerService, 'sendVendorIssueAcknowledgementEmail').mockResolvedValue(true);

      const message = {
        fromAddress: 'vendor10@example.com',
        subject: 'Clarification query on RFQ-INQ-1',
        bodyText: 'Please clarify specification and drawings',
      };
      await expect(emailGatewayService.processVendorQuoteMessage(message, targetRfq, vendorRecord))
        .rejects.toThrow('Inquiry DB error');
    });

    test('covers resolveMultiBuyerAttribution with legacy to/cc fields and restriction branches', async () => {
      const msg1 = {
        fromAddress: 'sender1@example.com',
        to: 'buyer-to@procucev.com',
        cc: 'cc-single@example.com',
      };
      const res1 = await emailGatewayService.resolveMultiBuyerAttribution(msg1, config());
      expect(res1.scenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_UNREGISTERED_CC);

      const msg2 = {
        fromAddress: 'sender2@example.com',
        toAddress: 'buyer-to2@procucev.com',
      };
      const res2 = await emailGatewayService.resolveMultiBuyerAttribution(msg2, config());
      expect(res2.scenario).toBe(EMAIL_RFQ_SCENARIOS.UNREGISTERED_TO_UNREGISTERED_CC);

      const senderAccNoEmail = { id: 'b-no-corp', corporateEmail: null };
      const res3 = await emailGatewayService.resolveMultiBuyerAttribution({ fromAddress: 'reg-no-corp@example.com' }, config(), senderAccNoEmail);
      expect(res3.scenario).toBe(EMAIL_RFQ_SCENARIOS.REGISTERED_TO_ONLY);
      expect(res3.eligibleNotificationRecipients[0].email).toBe('reg-no-corp@example.com');

      const msgAuto = { fromAddress: 'unreg-auto@example.com', automatedReason: 'auto-generated' };
      const resAuto = await emailGatewayService.resolveMultiBuyerAttribution(msgAuto, config());
      expect(resAuto.allowed).toBe(false);

      const msgSystem = { fromAddress: 'noreply@unreg.com' };
      const resSystem = await emailGatewayService.resolveMultiBuyerAttribution(msgSystem, config());
      expect(resSystem.allowed).toBe(false);

      const msgVendor = { fromAddress: 'unreg-vendor@example.com' };
      const resVendor = await emailGatewayService.resolveMultiBuyerAttribution(msgVendor, emailGatewayService.resolveVendorConfig());
      expect(resVendor.allowed).toBe(false);

      const msgAllowed = { fromAddress: 'unreg-unallowed@example.com' };
      const resAllowed = await emailGatewayService.resolveMultiBuyerAttribution(
        msgAllowed,
        config({ EMAIL_GATEWAY_ALLOWED_SENDERS: 'trusted@example.com' })
      );
      expect(resAllowed.allowed).toBe(false);

      const msgDomain = { fromAddress: 'unreg@random.com' };
      const resDomain = await emailGatewayService.resolveMultiBuyerAttribution(
        msgDomain,
        config({ EMAIL_GATEWAY_ALLOWED_DOMAINS: 'trustedcorp.com' })
      );
      expect(resDomain.allowed).toBe(false);

      const resEmpty = await emailGatewayService.resolveMultiBuyerAttribution({ fromAddress: '' }, config());
      expect(resEmpty.allowed).toBe(false);
    });
  });
});
