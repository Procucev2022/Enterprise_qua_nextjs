jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    gmail: jest.fn(),
  },
}));

const constants = require('../src/config/constants');
const mailerService = require('../src/services/mailerService');
const templates = require('../src/services/transactionalEmailTemplates');
const emailGateway = require('../src/services/emailGatewayService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const pool = require('../src/db/pool');
const storeService = require('../src/services/storeService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const rfqController = require('../src/controllers/rfqController');
const vendorController = require('../src/controllers/vendorController');
const eventOutboxService = require('../src/services/eventOutboxService');
const eventOutboxQueries = require('../src/db/eventOutboxQueries');
const vendorIngestionService = require('../src/services/vendorIngestionService');
const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const emailIngestionService = require('../src/services/emailIngestionService');
const geminiService = require('../src/services/geminiService');
const cryptoService = require('../src/services/cryptoService');

const INVITE_MAILBOX = 'invitations@procucev.test.store';
const DIRECT_MAILBOX = 'gmtrfq@procucev.test.com';
const BUYER_MAILBOX = 'rfq@procucev.com';

const DUAL_MAILBOX_ENV_KEYS = [
  'VENDOR_INVITE_EMAIL_ADDRESS',
  'VENDOR_DIRECT_RFQ_EMAIL_ADDRESS',
  'VENDOR_INVITE_GMAIL_SENDER_EMAIL',
  'VENDOR_DIRECT_RFQ_GMAIL_SENDER_EMAIL',
  'VENDOR_INVITE_GATEWAY_USER',
  'VENDOR_DIRECT_RFQ_GATEWAY_USER',
  'VENDOR_INVITE_GATEWAY_ENABLED',
  'VENDOR_DIRECT_RFQ_GATEWAY_ENABLED',
  'VENDOR_INVITE_GMAIL_CLIENT_ID',
  'VENDOR_INVITE_GMAIL_CLIENT_SECRET',
  'VENDOR_INVITE_GMAIL_REFRESH_TOKEN',
  'VENDOR_DIRECT_RFQ_GMAIL_CLIENT_ID',
  'VENDOR_DIRECT_RFQ_GMAIL_CLIENT_SECRET',
  'VENDOR_DIRECT_RFQ_GMAIL_REFRESH_TOKEN',
  'VENDOR_GMAIL_CLIENT_ID',
  'VENDOR_GMAIL_CLIENT_SECRET',
  'VENDOR_GMAIL_REFRESH_TOKEN',
  'VENDOR_GMAIL_SENDER_EMAIL',
  'VENDOR_EMAIL_GATEWAY_ADDRESS',
  'VENDOR_EMAIL_GATEWAY_USER',
  'VENDOR_EMAIL_GATEWAY_ENABLED',
  'EMAIL_GATEWAY_ADDRESS',
  'GMAIL_SENDER_EMAIL',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'FRONTEND_URL',
  'AES_ENCRYPTION_KEY',
];

function snapshotEnv() {
  const saved = {};
  for (const key of DUAL_MAILBOX_ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved) {
  for (const key of DUAL_MAILBOX_ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

function makeRawEmail({
  from = 'vendor@supplier.test.in',
  to = DIRECT_MAILBOX,
  subject = 'Re: RFQ',
  body = 'Unit Price: 125\nLead Time: 7 Days\nPayment Terms: Net 30',
  messageId = `<msg-${Date.now()}-${Math.random().toString(36).slice(2)}@mail.test>`,
  inReplyTo = '',
  references = '',
  extraHeaders = '',
} = {}) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    ...(extraHeaders ? [extraHeaders] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('Dual-Mailbox Vendor Email Architecture & CM Vendor Credentials', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = snapshotEnv();
    process.env.VENDOR_INVITE_EMAIL_ADDRESS = INVITE_MAILBOX;
    process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS = DIRECT_MAILBOX;
    process.env.EMAIL_GATEWAY_ADDRESS = BUYER_MAILBOX;
    process.env.FRONTEND_URL = 'https://app.procucev.test';
    emailGateway.resetAutoReplyMemory();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    emailGateway.stopPolling();
    emailGateway.resetAutoReplyMemory();
    restoreEnv(savedEnv);
  });

  describe('1. Constants & Dynamic Environment Mailbox Resolution', () => {
    test('loads both VENDOR_INVITE_EMAIL_ADDRESS and VENDOR_DIRECT_RFQ_EMAIL_ADDRESS dynamically', () => {
      expect(constants.VENDOR_EMAIL_GATEWAY_CONFIG.INVITE_ADDRESS).toBe(INVITE_MAILBOX);
      expect(constants.VENDOR_EMAIL_GATEWAY_CONFIG.DIRECT_RFQ_ADDRESS).toBe(DIRECT_MAILBOX);
      expect(constants.VENDOR_EMAIL_GATEWAY_CONFIG.GATEWAY_ADDRESS).toBe(DIRECT_MAILBOX);
      expect(constants.getConfiguredVendorMailboxes()).toEqual({
        inviteAddress: INVITE_MAILBOX.toLowerCase(),
        directRfqAddress: DIRECT_MAILBOX.toLowerCase(),
      });
    });

    test('resolveVendorInviteRouting enforces the 4-scenario sender matrix', () => {
      const rfqV0 = { id: 'rfq-v0', rfqNumber: 'RFQ-V0-100', sourcingMode: 'mode_0' };
      const rfqV1 = { id: 'rfq-v1', rfqNumber: 'RFQ-V1-101', sourcingMode: 'mode_1' };

      const networkRouting = mailerService.resolveVendorInviteRouting(
        { id: 'v-net', source: 'procucev_network', email: 'net@sup.in' },
        { isBuyerUploaded: false },
        rfqV0
      );
      expect(networkRouting.channel).toBe(constants.VENDOR_MAILBOX_CHANNELS.INVITE);
      expect(networkRouting.origin).toBe(constants.VENDOR_INVITE_ORIGINS.AUTO_MATCHED_NETWORK);
      expect(networkRouting.replyToQuoteAllowed).toBe(false);
      expect(networkRouting.from).toContain(INVITE_MAILBOX);
      expect(networkRouting.replyTo).toBe(INVITE_MAILBOX);

      const buyerRouting = mailerService.resolveVendorInviteRouting(
        { id: 'v-buy', source: 'buyer_manual', email: 'buy@sup.in' },
        { isBuyerUploaded: true },
        rfqV1
      );
      expect(buyerRouting.channel).toBe(constants.VENDOR_MAILBOX_CHANNELS.DIRECT);
      expect(buyerRouting.origin).toBe(constants.VENDOR_INVITE_ORIGINS.BUYER_UPLOADED);
      expect(buyerRouting.replyToQuoteAllowed).toBe(true);
      expect(buyerRouting.from).toContain(DIRECT_MAILBOX);
      expect(buyerRouting.replyTo).toBe(DIRECT_MAILBOX);

      const cmAssignedV0Routing = mailerService.resolveVendorInviteRouting(
        { id: 'v-cm-v0', source: 'procucev_network', email: 'cm@sup.in', isCmAssigned: true },
        {},
        rfqV0
      );
      expect(cmAssignedV0Routing.channel).toBe(constants.VENDOR_MAILBOX_CHANNELS.DIRECT);
      expect(cmAssignedV0Routing.origin).toBe(constants.VENDOR_INVITE_ORIGINS.CM_ASSIGNED);
      expect(cmAssignedV0Routing.replyToQuoteAllowed).toBe(true);
      expect(cmAssignedV0Routing.from).toContain(DIRECT_MAILBOX);

      const cmCreatedRouting = mailerService.resolveVendorInviteRouting(
        { id: 'v-cm-new', source: 'procucev_network', email: 'new@sup.in', isCmCreated: true },
        {},
        rfqV0
      );
      expect(cmCreatedRouting.channel).toBe(constants.VENDOR_MAILBOX_CHANNELS.DIRECT);
      expect(cmCreatedRouting.origin).toBe(constants.VENDOR_INVITE_ORIGINS.CM_CREATED);
      expect(cmCreatedRouting.replyToQuoteAllowed).toBe(true);
    });

    test('vendorFromAddress, vendorGatewayAddress, and OAuth config distinguish invite vs direct mailboxes', () => {
      expect(mailerService.vendorFromAddress('invite')).toContain(INVITE_MAILBOX);
      expect(mailerService.vendorGatewayAddress('invite')).toBe(INVITE_MAILBOX);
      expect(mailerService.vendorFromAddress('direct')).toContain(DIRECT_MAILBOX);
      expect(mailerService.vendorGatewayAddress('direct')).toBe(DIRECT_MAILBOX);
      expect(mailerService.vendorFromAddress({ senderMailbox: INVITE_MAILBOX })).toContain(INVITE_MAILBOX);
      expect(mailerService.vendorGatewayAddress({ replyToQuoteAllowed: false })).toBe(INVITE_MAILBOX);
      expect(mailerService.vendorGatewayAddress({ replyToQuoteAllowed: true })).toBe(DIRECT_MAILBOX);
      expect(mailerService.isVendorInviteGmailApiConfigured()).toBe(false);

      process.env.VENDOR_INVITE_GMAIL_CLIENT_ID = 'inv-cid';
      process.env.VENDOR_INVITE_GMAIL_CLIENT_SECRET = 'inv-sec';
      process.env.VENDOR_INVITE_GMAIL_REFRESH_TOKEN = 'inv-ref';
      process.env.VENDOR_DIRECT_RFQ_GMAIL_CLIENT_ID = 'dir-cid';
      process.env.VENDOR_DIRECT_RFQ_GMAIL_CLIENT_SECRET = 'dir-sec';
      process.env.VENDOR_DIRECT_RFQ_GMAIL_REFRESH_TOKEN = 'dir-ref';

      expect(mailerService.isVendorInviteGmailApiConfigured()).toBe(true);
      expect(mailerService.isVendorGmailApiConfigured('invite')).toBe(true);
      expect(mailerService.isVendorGmailApiConfigured('direct')).toBe(true);
      expect(mailerService.getVendorInviteGmailOAuthClient()).toBeTruthy();
      expect(mailerService.getVendorGmailOAuthClient('direct')).toBeTruthy();
      expect(mailerService.getGmailProviderKey('vendor_invite')).toMatch(/^gmail:vendorInvite:/);
    });
  });

  describe('2. Outbound Email Templates & Routing', () => {
    test('auto-matched network invite uses VENDOR_INVITE_EMAIL_ADDRESS and portal-only instructions without reply-to-quote prompt', () => {
      const rfq = {
        id: 'rfq-net-1',
        rfqNumber: 'RFQ-NET-1',
        title: 'Industrial Valves',
        category: 'Valves',
        items: [{ itemName: 'Gate Valve', quantity: 5, unit: 'Nos' }],
      };
      const mail = mailerService.buildRfqInviteEmail('net@sup.in', {
        rfq,
        recipientName: 'Network Supplier',
        vendor: { id: 'v-net-1', source: 'procucev_network' },
        isBuyerUploaded: false,
      });
      expect(mail.from).toContain(INVITE_MAILBOX);
      expect(mail.replyTo).toBe(INVITE_MAILBOX);
      expect(mail.html).not.toContain('Dear <strong>Network Supplier</strong>');
      expect(mail.html).not.toContain('Hello,');
      expect(mail.html).toContain('Greetings from <strong>Procucev!</strong>');
      expect(mail.html).toContain('/vendor/rfqs/RFQ-NET-1');
      expect(mail.html).toContain('Portal Submission Required (Do Not Reply to This Email)');
      expect(mail.html).toContain('Portal submission is required');
      expect(mail.html).toContain('no quotation will be created');
      expect(mail.html).not.toContain('How to Submit Your Quotation');
      expect(mail.html).not.toContain('Mandatory Quotation Information Required:');
      expect(mail.html).not.toContain('Email Reply Format (Copy, Fill & Send)');
    });

    test('buyer-uploaded and CM-assigned invites use VENDOR_DIRECT_RFQ_EMAIL_ADDRESS with email reply instructions', () => {
      const rfq = {
        id: 'rfq-dir-1',
        rfqNumber: 'RFQ-DIR-1',
        sourcingMode: 'mode_0',
        title: 'Steel Plates',
        category: 'Metals',
        items: [{ itemName: 'SS 304 Plate', quantity: 10, unit: 'Kg' }],
      };
      const buyerMail = mailerService.buildRfqInviteEmail('buyer-v@sup.in', {
        rfq,
        recipientName: 'Chola Turbo Machinery',
        vendor: { id: 'v-buy-1', source: 'buyer_manual' },
        isBuyerUploaded: true,
      });
      expect(buyerMail.from).toContain(DIRECT_MAILBOX);
      expect(buyerMail.replyTo).toBe(DIRECT_MAILBOX);
      expect(buyerMail.html).not.toContain('Dear <strong>Chola Turbo Machinery</strong>');
      expect(buyerMail.html).not.toContain('Hello,');
      expect(buyerMail.html).toContain('Greetings from <strong>Procucev!</strong>');
      expect(buyerMail.html).toContain('How to Submit Your Quotation');
      expect(buyerMail.html).toContain('Mandatory Quotation Information Required:');
      expect(buyerMail.html).toContain('Email Reply Format (Copy, Fill & Send)');

      const cmMail = mailerService.buildRfqInviteEmail('cm-v@sup.in', {
        rfq,
        vendor: { id: 'v-cm-1', source: 'procucev_network', isCmAssigned: true },
        isCmAssigned: true,
      });
      expect(cmMail.from).toContain(DIRECT_MAILBOX);
      expect(cmMail.replyTo).toBe(DIRECT_MAILBOX);
      expect(cmMail.html).not.toContain('Hello,');
      expect(cmMail.html).toContain('Mandatory Quotation Information Required:');
      expect(cmMail.html).toContain('Email Reply Format (Copy, Fill & Send)');
    });

    test('secondary vendor notices (complex redirect, mismatch, bulk invitation) honor vendor mailbox routing', () => {
      const rfq = { rfqNumber: 'RFQ-SEC-1', title: 'Pumps', items: Array.from({ length: 12 }, (_, idx) => ({ itemName: `P${idx}` })) };

      const complex = mailerService.buildComplexRfqPortalRedirectEmail('buy@sup.in', { rfq, itemCount: 12 });
      expect(complex.from).toContain(DIRECT_MAILBOX);
      expect(complex.replyTo).toBe(DIRECT_MAILBOX);

      const mismatchNet = mailerService.buildVendorCategoryMismatchEmail('net@sup.in', {
        rfq,
        vendor: { id: 'v-n', source: 'procucev_network' },
        isBuyerUploaded: false,
      });
      expect(mismatchNet.from).toContain(INVITE_MAILBOX);

      const bulkCm = mailerService.buildVendorBulkImportInvitationEmail({
        to: 'bulk-cm@sup.in',
        recipientName: 'Bulk CM',
        buyerOrganizationName: 'Procucev Category Management',
        vendorCode: 'v-bulk-1',
        isCmCreated: true,
      });
      expect(bulkCm.from).toContain(DIRECT_MAILBOX);
      expect(bulkCm.replyTo).toBe(DIRECT_MAILBOX);
    });

    test('sendTransactionalEmail preserves 13 registry templates, routes Emails 3/4/9/12/13 dynamically, and routes Emails 10/11 to direct mailbox', async () => {
      expect(templates.getAllTransactionalEmailTemplates()).toHaveLength(13);
      const deliverSpy = jest.spyOn(mailerService, 'deliverVendor').mockResolvedValue({ sent: true });

      await templates.sendTransactionalEmail('email_3', 'net@sup.in', {
        rfq_id: 'RFQ-3',
        rfq_title: 'Pumps',
        first_name: 'Net',
        item_count: 2,
        category: 'Pumps',
        delivery_location: 'Pune',
        quote_deadline: '2026-12-01',
        vendor: { id: 'v-n', source: 'procucev_network' },
        isBuyerUploaded: false,
      });
      expect(deliverSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ replyTo: INVITE_MAILBOX }),
        expect.any(String),
        expect.objectContaining({ vendorChannel: 'invite' })
      );

      await templates.sendTransactionalEmail('email_9', 'cm@sup.in', {
        rfq_id: 'RFQ-9',
        rfq_title: 'Motors',
        first_name: 'CM',
        quote_count: 1,
        quote_deadline: '2026-12-02',
        vendor: { id: 'v-c', source: 'procucev_network', isCmAssigned: true },
        isCmAssigned: true,
      });
      expect(deliverSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ replyTo: DIRECT_MAILBOX }),
        expect.any(String),
        expect.objectContaining({ vendorChannel: 'direct' })
      );

      await templates.sendTransactionalEmail('email_11', 'cm@sup.in', {
        rfq_id: 'RFQ-9',
        rfq_title: 'Motors',
        first_name: 'CM',
        quote_value: 'INR 50,000',
        quote_deadline: '2026-12-02',
      });
      expect(deliverSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ replyTo: DIRECT_MAILBOX }),
        expect.any(String),
        expect.objectContaining({ vendorChannel: 'direct' })
      );
    });

    test('buildVendorInvitePortalRedirectEmail generates registered and unregistered portal URLs from VENDOR_INVITE_EMAIL_ADDRESS', () => {
      const regMail = mailerService.buildVendorInvitePortalRedirectEmail('reg@sup.in', {
        rfqNumber: 'RFQ-2026-555',
        rfq: { rfqNumber: 'RFQ-2026-555', title: 'Bearings' },
        vendorName: 'Registered Co',
        isRegisteredVendor: true,
      });
      expect(regMail.from).toContain(INVITE_MAILBOX);
      expect(regMail.replyTo).toBe(INVITE_MAILBOX);
      expect(regMail.html).toContain('https://app.procucev.test/vendor/rfqs/RFQ-2026-555');

      const unregMail = mailerService.buildVendorInvitePortalRedirectEmail('new@sup.in', {
        rfqNumber: 'RFQ-2026-555',
        isRegisteredVendor: false,
      });
      expect(unregMail.html).toContain('https://app.procucev.test/vendor/register?rfq=RFQ-2026-555');
    });

    test('buildVendorOnboardingEmail({ isCmCreated: true }) builds CM welcome email from VENDOR_DIRECT_RFQ_EMAIL_ADDRESS with temp password and password-change note', () => {
      const mail = mailerService.buildVendorOnboardingEmail({
        to: 'fresh-cm-vendor@sup.in',
        recipientName: 'Fresh Supplier',
        buyerOrganizationName: 'Procucev Category Management',
        vendorCode: 'v-cm-101',
        tempPassword: 'Tmp#Pass991!',
        isCmCreated: true,
      });
      expect(mail.from).toContain(DIRECT_MAILBOX);
      expect(mail.replyTo).toBe(DIRECT_MAILBOX);
      expect(mail.html).toContain('fresh-cm-vendor@sup.in');
      expect(mail.html).toContain('Tmp#Pass991!');
      expect(mail.html).toContain('https://app.procucev.test/login');
      expect(mail.text).toContain('change your temporary password immediately after logging in');
    });
  });

  describe('3. Inbound Email Gateway Split Behavior & Isolation', () => {
    test('isStrictBuyerRfqMailbox rejects mail addressed to either VENDOR_INVITE_EMAIL_ADDRESS or VENDOR_DIRECT_RFQ_EMAIL_ADDRESS', () => {
      expect(emailGateway.isStrictBuyerRfqMailbox({ to: [INVITE_MAILBOX] }, {})).toBe(false);
      expect(emailGateway.isStrictBuyerRfqMailbox({ to: [DIRECT_MAILBOX] }, {})).toBe(false);
      expect(emailGateway.isStrictBuyerRfqMailbox({ to: [BUYER_MAILBOX] }, {})).toBe(true);
    });

    test('VENDOR_INVITE_EMAIL_ADDRESS reply does NOT create quotation, does NOT deduct credits, and sends /vendor/rfqs/[RFQ-ID] or /vendor/register?rfq=[RFQ-ID]', async () => {
      const rfq = await storeService.createRFQ({
        rfqNumber: 'RFQ-INV-ONLY-01',
        title: 'Hydraulic Hoses',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        items: [{ itemName: 'Hydraulic Hose 12mm', quantity: 20, unit: 'Mtr' }],
      });
      const registeredVendor = storeService.addVendor({
        name: 'Net Reg Vendor',
        email: 'netreg@sup.in',
        majorCategory: 'Hydraulics',
        source: 'procucev_network',
        freeQuotationCredits: 5,
      });

      const quoteSpy = jest.spyOn(emailGateway, 'processVendorQuoteMessage');
      const sendRedirectSpy = jest.spyOn(mailerService, 'sendVendorInvitePortalRedirectEmail').mockResolvedValue({
        sent: true,
        messageId: 'redir-1',
      });
      const findUserSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'u-reg-1', email: 'netreg@sup.in' });
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(rfq);
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(registeredVendor);
      jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
      const prepareSpy = jest.spyOn(emailIngestionService, 'prepareEmailForExtraction');

      prepareSpy.mockResolvedValueOnce({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<inv-reply-reg-1@sup.in>',
          fromAddress: 'netreg@sup.in',
          fromName: 'Net Reg Vendor',
          to: [INVITE_MAILBOX],
          subject: 'Re: New RFQ RFQ-INV-ONLY-01',
          bodyText: 'Unit Price: 450\nLead Time: 5 Days',
          attachments: [],
        },
        extractionInput: { documentText: 'Unit Price: 450\nLead Time: 5 Days' },
      });

      const resRegistered = await emailGateway.processMessage(
        makeRawEmail({
          from: 'netreg@sup.in',
          to: INVITE_MAILBOX,
          subject: 'Re: New RFQ RFQ-INV-ONLY-01',
          body: 'Unit Price: 450\nLead Time: 5 Days',
        }),
        emailGateway.resolveVendorInviteConfig()
      );

      expect(resRegistered.status).toBe(emailGateway.INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED);
      expect(quoteSpy).not.toHaveBeenCalled();
      expect(registeredVendor.freeQuotationCredits).toBe(5);
      expect(sendRedirectSpy).toHaveBeenCalledWith(
        'netreg@sup.in',
        expect.objectContaining({
          rfqNumber: 'RFQ-INV-ONLY-01',
          isRegisteredVendor: true,
        })
      );

      findUserSpy.mockResolvedValueOnce(null);
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValueOnce(null);
      prepareSpy.mockResolvedValueOnce({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<inv-reply-unreg-1@sup.in>',
          fromAddress: 'unregistered-reply@sup.in',
          fromName: 'Unregistered Supplier',
          to: [INVITE_MAILBOX],
          subject: 'Re: RFQ-INV-ONLY-01',
          bodyText: 'Unit Price: 400',
          attachments: [],
        },
        extractionInput: { documentText: 'Unit Price: 400' },
      });

      // Even if dispatched without explicit invite config, recipient To: INVITE_MAILBOX forces invite-only handling
      const resUnregistered = await emailGateway.processMessage(
        makeRawEmail({
          from: 'unregistered-reply@sup.in',
          to: INVITE_MAILBOX,
          subject: 'Re: RFQ-INV-ONLY-01',
          body: 'Unit Price: 400',
        }),
        emailGateway.resolveVendorConfig()
      );

      expect(resUnregistered.status).toBe(emailGateway.INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED);
      expect(quoteSpy).not.toHaveBeenCalled();
      expect(sendRedirectSpy).toHaveBeenLastCalledWith(
        'unregistered-reply@sup.in',
        expect.objectContaining({
          rfqNumber: 'RFQ-INV-ONLY-01',
          isRegisteredVendor: false,
        })
      );
    });

    test('VENDOR_INVITE_EMAIL_ADDRESS keeps bot/loop guards and 3 notices/hour/RFQ cooldown, and drops messages without resolvable RFQ', async () => {
      const sendSpy = jest.spyOn(mailerService, 'sendVendorInvitePortalRedirectEmail').mockResolvedValue({ sent: true });
      const prepareSpy = jest.spyOn(emailIngestionService, 'prepareEmailForExtraction');

      prepareSpy.mockResolvedValueOnce({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<bot-loop-1@external.com>',
          fromAddress: 'noreply@external.com',
          to: [INVITE_MAILBOX],
          subject: 'Auto-reply RFQ-999',
          bodyText: 'Out of office',
          automatedReason: 'auto-submitted: auto-replied',
          attachments: [],
        },
        extractionInput: { documentText: 'Out of office' },
      });

      const botResult = await emailGateway.processMessage(
        makeRawEmail({
          from: 'noreply@external.com',
          to: INVITE_MAILBOX,
          subject: 'Auto-reply RFQ-999',
          extraHeaders: 'Auto-Submitted: auto-replied',
        }),
        emailGateway.resolveVendorInviteConfig()
      );
      expect(botResult.status).toBe(emailGateway.INGESTION_OUTCOME.SKIPPED_OUTBOUND);
      expect(sendSpy).not.toHaveBeenCalled();

      prepareSpy.mockResolvedValueOnce({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<no-rfq-1@sup.in>',
          fromAddress: 'someone@sup.in',
          to: [INVITE_MAILBOX],
          subject: 'General greeting',
          bodyText: 'Hello team',
          attachments: [],
        },
        extractionInput: { documentText: 'Hello team' },
      });

      const noRfqResult = await emailGateway.processMessage(
        makeRawEmail({
          from: 'someone@sup.in',
          to: INVITE_MAILBOX,
          subject: 'General greeting',
          body: 'Hello team',
        }),
        emailGateway.resolveVendorInviteConfig()
      );
      expect(noRfqResult.status).toBe(emailGateway.INGESTION_OUTCOME.INVALID_RFQ);
      expect(sendSpy).not.toHaveBeenCalled();

      const rfq = await storeService.createRFQ({
        rfqNumber: 'RFQ-INV-COOLDOWN',
        title: 'Valves',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        items: [{ itemName: 'Valve', quantity: 5, unit: 'Nos' }],
      });
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(rfq);
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'u-cd', email: 'loop@sup.in' });
      jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(3);

      prepareSpy.mockResolvedValueOnce({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<cooldown-1@sup.in>',
          fromAddress: 'loop@sup.in',
          to: [INVITE_MAILBOX],
          subject: 'Re: RFQ-INV-COOLDOWN',
          bodyText: 'Unit Price: 100',
          attachments: [],
        },
        extractionInput: { documentText: 'Unit Price: 100' },
      });

      const throttled = await emailGateway.processMessage(
        makeRawEmail({
          from: 'loop@sup.in',
          to: INVITE_MAILBOX,
          subject: 'Re: RFQ-INV-COOLDOWN',
          body: 'Unit Price: 100',
        }),
        emailGateway.resolveVendorInviteConfig()
      );
      expect(throttled.status).toBe(emailGateway.INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    test('CM-assigned V0 vendor replying to VENDOR_DIRECT_RFQ_EMAIL_ADDRESS passes isVendorInvitedToRfq and submits quote with Email 11 ACK from DIRECT mailbox', async () => {
      const cmVendor = storeService.addVendor({
        name: 'CM V0 Invited Corp',
        email: 'cm-v0-supplier@sup.in',
        majorCategory: 'Fasteners',
        source: 'procucev_network',
      });
      const v0Rfq = await storeService.createRFQ({
        rfqNumber: 'RFQ-V0-CM-77',
        title: 'Hex Bolts',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        items: [{ itemName: 'M12 Hex Bolt', quantity: 100, unit: 'Nos' }],
      });

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue({ id: 'u-cm', email: cmVendor.email });
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const inviteRes = await storeService.inviteVendorsToRFQ(v0Rfq.id, [cmVendor.id], 'cm@procucev.test', {
        actorRole: 'category_manager',
      });
      expect(inviteRes.invitedCount).toBe(1);
      expect(inviteRes.updatedRFQ.assignedVendors[0]).toMatchObject({
        id: cmVendor.id,
        isCmAssigned: true,
        inviteChannel: 'direct',
        inviteOrigin: 'cm_assigned',
        replyToQuoteAllowed: true,
      });

      const refreshedRfq = storeService.getRFQById(v0Rfq.id);
      await expect(storeService.isVendorInvitedToRfq(refreshedRfq, cmVendor, cmVendor.email)).resolves.toBe(true);

      const ackSendSpy = jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true, messageId: 'ack-1' });
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValue({
        success: true,
        unitPrice: 120,
        leadTimeDays: 5,
        warrantyYears: 1,
        paymentTerms: 'Net 30',
        remarks: 'Ex-stock',
      });
      jest.spyOn(storeService, 'submitVendorQuoteDurably').mockImplementation(async (rfqId, quoteInput) => ({
        rfq: refreshedRfq,
        quoteId: 'q-cm-1',
        quote: { id: 'q-cm-1', ...quoteInput },
        vendorQuoteAcknowledgementQueued: false,
      }));
      jest.spyOn(emailIngestionService, 'prepareEmailForExtraction').mockResolvedValue({
        status: constants.EMAIL_INGESTION_STATUS.READY,
        message: {
          messageId: '<cm-v0-reply@sup.in>',
          fromAddress: cmVendor.email,
          fromName: 'CM V0 Invited Corp',
          to: [DIRECT_MAILBOX],
          subject: `Re: New RFQ ${refreshedRfq.rfqNumber}`,
          bodyText: 'Unit Price: 120\nLead Time: 5 Days\nWarranty: 1 Year\nPayment Terms: Net 30\nRemarks: Ex-stock',
          attachments: [],
        },
        extractionInput: {
          documentText: 'Unit Price: 120\nLead Time: 5 Days\nWarranty: 1 Year\nPayment Terms: Net 30\nRemarks: Ex-stock',
        },
      });

      const quoteRes = await emailGateway.processMessage(
        makeRawEmail({
          from: cmVendor.email,
          to: DIRECT_MAILBOX,
          subject: `Re: New RFQ ${refreshedRfq.rfqNumber}`,
        }),
        emailGateway.resolveVendorConfig()
      );

      expect(quoteRes.status).toBe(emailGateway.INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(ackSendSpy).toHaveBeenCalledWith(
        cmVendor.email,
        expect.objectContaining({ rfqNumber: refreshedRfq.rfqNumber })
      );

      const builtAck = mailerService.buildQuoteAcknowledgementEmail(cmVendor.email, {
        rfqNumber: refreshedRfq.rfqNumber,
        rfqTitle: refreshedRfq.title,
        vendorName: cmVendor.name,
        quote: { unitPrice: 120, totalPrice: 12000 },
      });
      expect(builtAck.from).toContain(DIRECT_MAILBOX);
      expect(builtAck.replyTo).toBe(DIRECT_MAILBOX);
    });

    test('pollBothInboxesOnce, startVendorPolling, stopPolling, retryPendingAcknowledgements, and getStatus handle dual vendor mailboxes', async () => {
      process.env.GMAIL_CLIENT_ID = 'b-cid';
      process.env.GMAIL_CLIENT_SECRET = 'b-sec';
      process.env.GMAIL_REFRESH_TOKEN = 'b-ref';
      process.env.VENDOR_GMAIL_CLIENT_ID = 'd-cid';
      process.env.VENDOR_GMAIL_CLIENT_SECRET = 'd-sec';
      process.env.VENDOR_GMAIL_REFRESH_TOKEN = 'd-ref';
      process.env.VENDOR_INVITE_GMAIL_CLIENT_ID = 'i-cid';
      process.env.VENDOR_INVITE_GMAIL_CLIENT_SECRET = 'i-sec';
      process.env.VENDOR_INVITE_GMAIL_REFRESH_TOKEN = 'i-ref';

      const buyerPollSpy = jest.spyOn(emailGateway, 'pollOnce').mockResolvedValue({ skipped: false, considered: 1, ingested: 1 });
      const directPollSpy = jest.spyOn(emailGateway, 'pollVendorViaGmailApi').mockResolvedValue({ skipped: false, considered: 2, ingested: 1 });
      const invitePollSpy = jest.spyOn(emailGateway, 'pollVendorInviteViaGmailApi').mockResolvedValue({ skipped: false, considered: 1, ingested: 0 });

      expect(emailGateway.resolveVendorConfigs()).toHaveLength(2);

      const combined = await emailGateway.pollBothInboxesOnce();
      expect(buyerPollSpy).toHaveBeenCalledTimes(1);
      expect(directPollSpy).toHaveBeenCalledTimes(1);
      expect(invitePollSpy).toHaveBeenCalledTimes(1);
      expect(combined.totalConsidered).toBe(4);
      expect(combined.totalIngested).toBe(2);
      expect(combined.vendorInviteMailbox.address).toBe(INVITE_MAILBOX);

      const started = emailGateway.startVendorPolling();
      expect(started.started).toBe(true);
      expect(started.inviteMailboxStarted).toBe(true);

      const status = await emailGateway.getStatus();
      expect(status.vendorGateway.gatewayAddress).toBe(DIRECT_MAILBOX);
      expect(status.vendorInviteGateway.gatewayAddress).toBe(INVITE_MAILBOX);

      emailGateway.stopPolling();

      const retrySendSpy = jest.spyOn(mailerService, 'sendVendorInvitePortalRedirectEmail').mockResolvedValue({ sent: true, messageId: 'retry-redir-1' });
      jest.spyOn(emailGatewayQueries, 'claimPendingAcknowledgements').mockResolvedValue([
        {
          message_id: '<pending-redir-1@test>',
          from_address: 'v-retry@sup.in',
          subject: 'Re: RFQ-RETRY-1',
          rfq_id: 'rfq-retry-1',
          rfq_number: 'RFQ-RETRY-1',
          processed_at: new Date().toISOString(),
          retry_claim_token: 'tok-1',
          detail: JSON.stringify({
            deliveryKind: constants.EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INVITE_PORTAL_REDIRECT,
            rfqTitle: 'Valves',
            vendorName: 'Retry Vendor',
            isRegisteredVendor: true,
          }),
        },
      ]);
      jest.spyOn(emailGatewayQueries, 'completeClaimedAcknowledgement').mockResolvedValue(true);

      const retryRes = await emailGateway.retryPendingAcknowledgements({
        deliveryKinds: [constants.EMAIL_GATEWAY_DELIVERY_KIND.VENDOR_INVITE_PORTAL_REDIRECT],
      });
      expect(retryRes.sent).toBe(1);
      expect(retrySendSpy).toHaveBeenCalledWith('v-retry@sup.in', expect.objectContaining({
        rfqNumber: 'RFQ-RETRY-1',
        isRegisteredVendor: true,
      }));
    });
  });

  describe('4. Category Manager New Vendor Immediate Credentials & Idempotency + Chasers', () => {
    test('CM first-time single vendor add creates resetPasswordRequired account & sends temp password from VENDOR_DIRECT_RFQ_EMAIL_ADDRESS; duplicate does not resend credentials', async () => {
      const uniqueEmail = `cm-added-${Date.now()}@sup.in`;
      const insertSpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true, user: { id: 'u-new-cm' } });
      const findUserSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const sendIngestionSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true, messageId: 'cred-msg-1' });
      jest.spyOn(domainQueries, 'upsertVendorInDB').mockImplementation(async (v) => ({ id: v.id, email: v.email, name: v.name, onboardingEmailStatus: 'pending' }));

      const reqFirst = {
        user: { role: 'category_manager', email: 'cm@procucev.test' },
        body: {
          name: 'CM First Time Supplier',
          email: uniqueEmail,
          contactPerson: 'Raj',
          majorCategory: 'Industrial Hardware & Fasteners',
          minorCategories: ['Fasteners'],
          city: 'Pune',
          state: 'Maharashtra',
        },
      };
      const resFirst = makeRes();
      await vendorController.createVendor(reqFirst, resFirst, jest.fn());

      expect(resFirst.statusCode).toBe(201);
      expect(resFirst.body.onboardingStatus).toBe('sent');
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
        email: uniqueEmail,
        resetPasswordRequired: true,
      }));
      const dispatchedPayload = sendIngestionSpy.mock.calls[0][0];
      expect(dispatchedPayload.from).toContain(DIRECT_MAILBOX);
      expect(dispatchedPayload.replyTo).toBe(DIRECT_MAILBOX);
      expect(dispatchedPayload.html).toContain(uniqueEmail);
      expect(dispatchedPayload.text).toContain('Temporary Password:');
      expect(dispatchedPayload.text).toContain('change your temporary password immediately after logging in');
      expect(sendIngestionSpy.mock.calls[0][2]).toEqual({ vendorChannel: 'direct' });

      // Idempotency check when account already exists
      insertSpy.mockClear();
      sendIngestionSpy.mockClear();
      findUserSpy.mockResolvedValue({ id: 'u-new-cm', email: uniqueEmail });
      const idempResult = await storeService.provisionVendorOnboarding(
        { id: 'v-cm-existing', name: 'Existing Sup', email: uniqueEmail, isCmCreated: true },
        'cm@procucev.test',
        { isCmCreated: true, mailboxChannel: 'direct' }
      );
      expect(idempResult.status).toBe('account_exists');
      expect(insertSpy).not.toHaveBeenCalled();
      expect(sendIngestionSpy).not.toHaveBeenCalled();
    });

    test('CM durable new-vendor create + invite-vendors sends both login credentials outbox email and RFQ invite without resending credentials', async () => {
      process.env.AES_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const uniqueEmail = `cm-durable-${Date.now()}@sup.in`;
      let storedVendor = null;
      let storedRfq = {
        id: 'rfq-cm-dur-1',
        rfqNumber: 'RFQ262711936607',
        title: 'IT Cloud Licenses',
        category: 'IT',
        status: 'Quotes Pending',
        sourcingMode: 'mode_0',
        assignedVendors: [],
      };
      let capturedOnboardingEvent = null;

      jest.spyOn(domainQueries, 'upsertVendorInDB').mockImplementation(async (v) => {
        storedVendor = { ...v };
        return storedVendor;
      });
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockImplementation(async (email) => (
        storedVendor && storedVendor.email === email ? storedVendor : null
      ));
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockImplementation(async (id) => (
        storedVendor && (storedVendor.id === id || storedVendor.email === id) ? storedVendor : null
      ));
      jest.spyOn(domainQueries, 'getVendorSnapshotByIdFromDB').mockImplementation(async (id) => (
        storedVendor && storedVendor.id === id ? { id: storedVendor.id, vendor: storedVendor, raw: JSON.stringify(storedVendor) } : null
      ));
      jest.spyOn(domainQueries, 'updateVendorIfUnchangedInDB').mockImplementation(async (_snap, nextVendor) => {
        storedVendor = { ...nextVendor };
        return storedVendor;
      });
      jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockImplementation(async (id) => (id === storedRfq.id ? storedRfq : null));
      jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockImplementation(async (id) => (
        id === storedRfq.id ? { id: storedRfq.id, rfq: storedRfq, raw: JSON.stringify(storedRfq) } : null
      ));
      jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(async (_snap, nextRfq) => {
        storedRfq = { ...nextRfq };
        return storedRfq;
      });
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockImplementation(async (r) => {
        storedRfq = { ...r };
        return storedRfq;
      });
      jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockResolvedValue(true);
      const bgPromises = [];
      jest.spyOn(storeService, '_persistVendor').mockImplementation(() => {});
      jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
      jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
      jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
      jest.spyOn(storeService, '_background').mockImplementation((promise) => {
        const tracked = Promise.resolve(promise).catch(() => {});
        bgPromises.push(tracked);
        return tracked;
      });
      const claimSpy = jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);

      const findUserSpy = jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertAccSpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockImplementation(async ({ onboardingEvent }) => {
        capturedOnboardingEvent = onboardingEvent;
        return { created: true, user: { id: 'u-cm-durable', email: uniqueEmail } };
      });
      const sendIngestionSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true, messageId: 'cred-outbox-1' });
      const sendRfqInviteSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true, messageId: 'invite-outbox-1' });
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      const reqCreate = {
        user: { role: 'category_manager', email: 'cm@procucev.test' },
        body: {
          name: 'CM Durable Supplier',
          email: uniqueEmail,
          contactPerson: 'Tikec',
          majorCategory: 'IT',
          minorCategories: ['Cloud'],
          city: 'Pune',
          state: 'Maharashtra',
        },
      };
      const resCreate = makeRes();
      const nextCreate = jest.fn();
      await vendorController.createVendor(reqCreate, resCreate, nextCreate);

      expect(nextCreate).not.toHaveBeenCalled();
      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.body.onboardingStatus).toBe('pending');
      expect(capturedOnboardingEvent).toBeTruthy();

      // Dispatch the queued VENDOR_ONBOARDING_EMAIL outbox job (guards against missing VENDOR_CM_ONBOARDING_NOTIFICATION import)
      claimSpy.mockResolvedValueOnce([
        {
          id: capturedOnboardingEvent.id,
          event_type: constants.EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
          attempts: 0,
          lease_token: 'lease-cm-cred-1',
          raw: capturedOnboardingEvent.payload,
        },
      ]);
      const markCompleteSpy = jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

      const credDispatch = await eventOutboxService.dispatchDueEventOutboxJobs(1, [capturedOnboardingEvent.id]);
      expect(credDispatch).toMatchObject({ completed: 1, retried: 0, dead: 0 });
      expect(sendIngestionSpy).toHaveBeenCalledTimes(1);
      expect(sendIngestionSpy.mock.calls[0][0]).toMatchObject({
        to: uniqueEmail,
        from: expect.stringContaining(DIRECT_MAILBOX),
        subject: constants.VENDOR_CM_ONBOARDING_NOTIFICATION.SUBJECT,
      });
      expect(sendIngestionSpy.mock.calls[0][0].html).toContain(constants.VENDOR_CM_ONBOARDING_NOTIFICATION.DEFAULT_ORGANIZATION_NAME);
      expect(sendIngestionSpy.mock.calls[0][2]).toEqual({ vendorChannel: 'direct' });
      expect(storedVendor.onboardingEmailStatus).toBe('sent');
      expect(markCompleteSpy).toHaveBeenCalledWith(capturedOnboardingEvent.id, 'lease-cm-cred-1');

      // Invite newly created vendor to RFQ: identity exists so credentials are NOT resent, RFQ email IS sent
      insertAccSpy.mockClear();
      sendIngestionSpy.mockClear();
      findUserSpy.mockResolvedValueOnce({ id: 'u-cm-durable', email: uniqueEmail });
      storeService.rfqs.push(storedRfq);

      const inviteResult = await storeService.inviteVendorsToRFQ(
        storedRfq.id,
        [storedVendor.id],
        'cm@procucev.test',
        { actorRole: 'category_manager' }
      );
      expect(inviteResult.invitedCount).toBe(1);
      expect(inviteResult.provisionedCount).toBe(0);
      expect(insertAccSpy).not.toHaveBeenCalled();
      expect(sendIngestionSpy).not.toHaveBeenCalled();

      const target = storedRfq.vendorInvitationTargets[0];
      claimSpy.mockResolvedValueOnce([
        {
          id: `rfq-vendor-invite:${target.key}`,
          event_type: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          attempts: 0,
          lease_token: 'lease-cm-rfq-inv-1',
          raw: { rfqId: storedRfq.id, target },
        },
      ]);
      const rfqDispatch = await eventOutboxService.dispatchDueEventOutboxJobs(1, [`rfq-vendor-invite:${target.key}`]);
      expect(rfqDispatch).toMatchObject({ completed: 1, retried: 0, dead: 0 });
      expect(sendRfqInviteSpy).toHaveBeenCalledWith(uniqueEmail, expect.objectContaining({
        isCmAssigned: true,
        inviteChannel: 'direct',
        replyToQuoteAllowed: true,
      }));
      await Promise.allSettled(bgPromises);
    });

    test('CM inviteVendorsToRFQ resets stale onboardingEmailStatus and provisions credentials when corporateEmail lacks identity', async () => {
      process.env.AES_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const corpEmail = `corp-unprov-${Date.now()}@sup.in`;
      let unprovVendor = {
        id: `v-unprov-${Date.now()}`,
        name: 'Unprovisioned Corp Vendor',
        corporateEmail: corpEmail,
        source: 'procucev_network',
        onboardingEmailStatus: 'failed',
      };
      let targetRfq = {
        id: `rfq-unprov-${Date.now()}`,
        rfqNumber: 'RFQ262711999999',
        title: 'IT Switches',
        category: 'IT',
        status: 'Quotes Pending',
        sourcingMode: 'mode_0',
        assignedVendors: [],
      };

      storeService.vendors.push(unprovVendor);
      storeService.rfqs.push(targetRfq);

      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(unprovVendor);
      jest.spyOn(domainQueries, 'getVendorSnapshotByIdFromDB').mockImplementation(async (id) => (
        id === unprovVendor.id ? { id: unprovVendor.id, vendor: unprovVendor, raw: JSON.stringify(unprovVendor) } : null
      ));
      jest.spyOn(domainQueries, 'updateVendorIfUnchangedInDB').mockImplementation(async (_snap, nextV) => {
        unprovVendor = { ...nextV };
        return unprovVendor;
      });
      jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(targetRfq);
      jest.spyOn(domainQueries, 'getRFQSnapshotByIdFromDB').mockImplementation(async () => ({
        id: targetRfq.id,
        rfq: targetRfq,
        raw: JSON.stringify(targetRfq),
      }));
      jest.spyOn(domainQueries, 'updateRFQIfUnchangedInDB').mockImplementation(async (_snap, nextR) => {
        targetRfq = { ...nextR };
        return targetRfq;
      });
      jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockResolvedValue(true);
      const bgPromises = [];
      jest.spyOn(storeService, '_persistNotification').mockImplementation(() => {});
      jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
      jest.spyOn(storeService, '_background').mockImplementation((promise) => {
        const tracked = Promise.resolve(promise).catch(() => {});
        bgPromises.push(tracked);
        return tracked;
      });
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([]);
      jest.spyOn(rfqChaserScheduler, 'scheduleRFQChasers').mockImplementation(() => {});

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertAccSpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValueOnce({
        created: true,
        user: { id: 'u-unprov-1', email: corpEmail },
      });

      const res = await storeService.inviteVendorsToRFQ(
        targetRfq.id,
        [unprovVendor.id],
        'cm@procucev.test',
        { actorRole: 'category_manager' }
      );
      expect(res.invitedCount).toBe(1);
      expect(res.provisionedCount).toBe(1);
      expect(insertAccSpy).toHaveBeenCalledWith(expect.objectContaining({
        email: corpEmail,
        resetPasswordRequired: true,
        onboardingEvent: expect.objectContaining({
          eventType: constants.EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
          payload: expect.objectContaining({ isCmCreated: true, mailboxChannel: 'direct' }),
        }),
      }));
      expect(unprovVendor.onboardingEmailStatus).toBe('pending');
      await Promise.allSettled(bgPromises);
    });

    test('CM vendor ingestion empanelment and recipient delivery provision immediate credentials on first-time vendor creation', async () => {
      jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        found: true,
        profile: {
          userId: 'cm-user-1',
          organizationId: 'org-cm-1',
          companyName: 'Procucev Category Team',
          contactEmail: 'cm@procucev.test',
          role: 'category_manager',
        },
      });
      jest.spyOn(vendorIngestionQueries, 'findSession').mockResolvedValue({ id: 'sess-1', currentStep: 3 });
      jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue(null);
      jest.spyOn(vendorIngestionQueries, 'attachVendorId').mockResolvedValue(true);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor').mockResolvedValue({
        id: 'v-ing-cm-1',
        name: 'Ingested CM Supplier',
        email: 'ing-cm@sup.in',
        isCmCreated: true,
        createdByRole: 'category_manager',
      });
      const provSpy = jest.spyOn(storeService, 'provisionVendorOnboarding').mockResolvedValue({ status: 'sent', error: null });

      const empVendor = await vendorIngestionService.empanelApprovedVendor(
        { userId: 'cm-user-1', email: 'cm@procucev.test', role: 'category_manager', organizationId: 'org-cm-1', organizationName: 'Procucev CM' },
        'sess-1',
        {
          id: 'map-1',
          vendorRecordId: 'vr-1',
          companyName: 'Ingested CM Supplier',
          email: 'ing-cm@sup.in',
          buyerMajorCategory: 'Industrial Valves',
          buyerMinorCategories: ['Gate Valves'],
          aiSuggestion: { majorCategory: 'Industrial Valves', minorCategories: ['Gate Valves'] },
        }
      );

      expect(empVendor.id).toBe('v-ing-cm-1');
      expect(empanelSpy).toHaveBeenCalled();
      expect(provSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'v-ing-cm-1' }),
        'cm@procucev.test',
        expect.objectContaining({ isCmCreated: true, mailboxChannel: 'direct' })
      );

      // Also test CM dispatch delivery auto-creating missing vendor account and sending via DIRECT channel
      jest.spyOn(vendorIngestionQueries, 'claimEmailSlot').mockResolvedValue({ id: 'slot-cm-1' });
      jest.spyOn(vendorIngestionQueries, 'markEmailSent').mockResolvedValue(true);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertAccSpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const sendIngSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true, messageId: 'ing-msg-1' });

      const deliverRes = await vendorIngestionService.deliverToRecipients(
        { userId: 'cm-user-1', email: 'cm@procucev.test', role: 'category_manager', organizationId: 'org-cm-1', organizationName: 'Procucev CM' },
        {
          sessionId: 'sess-1',
          dispatchId: 'disp-1',
          template: constants.VENDOR_DISPATCH_TEMPLATE.GENERAL_ONBOARDING,
          recipients: [
            {
              vendorRecordId: 'vr-2',
              email: 'cm-disp-new@sup.in',
              companyName: 'CM Dispatch New Co',
              vendorCode: 'v-cm-d2',
            },
          ],
        }
      );
      expect(deliverRes.sent).toBe(1);
      expect(insertAccSpy).toHaveBeenCalledWith(expect.objectContaining({
        email: 'cm-disp-new@sup.in',
        resetPasswordRequired: true,
      }));
      expect(sendIngSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'cm-disp-new@sup.in', replyTo: DIRECT_MAILBOX }),
        constants.VENDOR_DISPATCH_TEMPLATE.GENERAL_ONBOARDING,
        { vendorChannel: 'direct' }
      );
    });

    test('rfqController.inviteVendors passes actorRole into storeService.inviteVendorsToRFQ and rfqChaserScheduler preserves assigned mailbox channel', async () => {
      jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue({
        id: 'r1',
        rfqNumber: 'RFQ-R1',
        sourcingMode: 'mode_0',
      });
      const inviteSpy = jest.spyOn(storeService, 'inviteVendorsToRFQ').mockResolvedValue({ updatedRFQ: { id: 'r1' }, invitedCount: 1 });
      const res = makeRes();
      await rfqController.inviteVendors(
        {
          params: { id: 'r1' },
          body: { vendorIds: ['v1'] },
          user: { role: 'category_manager', email: 'cm@procucev.test' },
        },
        res,
        jest.fn()
      );
      expect(inviteSpy).toHaveBeenCalledWith('r1', ['v1'], 'cm@procucev.test', { actorRole: 'category_manager' });

      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValue([
        {
          vendor_id: 'v-ch-net',
          vendor_email: 'ch-net@sup.in',
          invite_channel: 'invite',
          invite_origin: 'auto_matched_network',
          sender_mailbox: INVITE_MAILBOX,
          reply_to_quote_allowed: 0,
        },
        {
          vendor_id: 'v-ch-cm',
          vendor_email: 'ch-cm@sup.in',
          invite_channel: 'direct',
          invite_origin: 'cm_assigned',
          sender_mailbox: DIRECT_MAILBOX,
          reply_to_quote_allowed: 1,
        },
      ]);
      const sendInviteSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });

      try {
        await rfqChaserScheduler._dispatchReminderEmail(
          { rfqNumber: 'RFQ-CHASER-1', title: 'Pumps', sourcingMode: 'mode_0' },
          { id: 'v-ch-net', name: 'Chaser Net', email: 'ch-net@sup.in', source: 'procucev_network' }
        );
        expect(sendInviteSpy).toHaveBeenLastCalledWith(
          'ch-net@sup.in',
          expect.objectContaining({
            isReminder: true,
            inviteChannel: 'invite',
            inviteOrigin: 'auto_matched_network',
            replyToQuoteAllowed: false,
          })
        );

        await rfqChaserScheduler._dispatchReminderEmail(
          { rfqNumber: 'RFQ-CHASER-1', title: 'Pumps', sourcingMode: 'mode_0' },
          { id: 'v-ch-cm', name: 'Chaser CM', email: 'ch-cm@sup.in', source: 'procucev_network' }
        );
        expect(sendInviteSpy).toHaveBeenLastCalledWith(
          'ch-cm@sup.in',
          expect.objectContaining({
            isReminder: true,
            inviteChannel: 'direct',
            inviteOrigin: 'cm_assigned',
            replyToQuoteAllowed: true,
          })
        );
      } finally {
        process.env.NODE_ENV = origNodeEnv;
      }
    });

    test('eventOutboxService and domainQueries persist and honor invite_channel, invite_origin, sender_mailbox, and reply_to_quote_allowed', async () => {
      const mockQuery = jest.fn(async () => ({
        rows: [
          {
            id: 'inv-1',
            rfq_id: 'rfq-db-1',
            rfq_number: 'RFQ-DB-1',
            vendor_id: 'v-db-cm',
            vendor_email: 'db-cm@sup.in',
            invite_channel: 'direct',
            invite_origin: 'cm_assigned',
            sender_mailbox: DIRECT_MAILBOX,
            reply_to_quote_allowed: true,
          },
        ],
      }));
      jest.spyOn(pool, 'query').mockImplementation(mockQuery);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const savedInvite = await domainQueries.recordRfqVendorInviteInDB({
        rfqId: 'rfq-db-1',
        rfqNumber: 'RFQ-DB-1',
        vendorId: 'v-db-cm',
        vendorEmail: 'db-cm@sup.in',
        inviteMessageId: '<inv-cm-1@procucev.test>',
        inviteChannel: 'direct',
        inviteOrigin: 'cm_assigned',
        senderMailbox: DIRECT_MAILBOX,
        replyToQuoteAllowed: true,
      });
      expect(savedInvite.inviteChannel).toBe('direct');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('invite_channel'),
        expect.arrayContaining(['direct', 'cm_assigned', DIRECT_MAILBOX, true]),
        expect.objectContaining({ d1: true })
      );

      jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
        id: 'rfq-db-1',
        rfqNumber: 'RFQ-DB-1',
        title: 'Valves',
        sourcingMode: 'mode_0',
      });
      jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockResolvedValue(savedInvite);
      const sendSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true, messageId: '<inv-cm-1@procucev.test>' });
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([
        {
          id: 'outbox-inv-cm-1',
          eventType: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          event_type: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          attempts: 0,
          raw: {
            rfqId: 'rfq-db-1',
            target: {
              key: 'k-inv-cm-1',
              vendorId: 'v-db-cm',
              recipientEmail: 'db-cm@sup.in',
              recipientName: 'DB CM Supplier',
              vendor: { id: 'v-db-cm', source: 'procucev_network', email: 'db-cm@sup.in', isCmAssigned: true },
              inviteChannel: 'direct',
              inviteOrigin: 'cm_assigned',
              senderMailbox: DIRECT_MAILBOX,
              replyToQuoteAllowed: true,
              isCmAssigned: true,
            },
          },
        },
      ]);
      jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      expect(sendSpy).toHaveBeenCalledWith('db-cm@sup.in', expect.objectContaining({
        inviteChannel: 'direct',
        inviteOrigin: 'cm_assigned',
        isCmAssigned: true,
        replyToQuoteAllowed: true,
      }));
    });
  });

  describe('5. Branch Coverage & Edge Cases', () => {
    test('covers transactionalEmailTemplates portal redirect, CM onboarding variations, and sendTransactionalEmail routing branches', async () => {
      const emptyRedirect = templates.buildVendorInvitePortalRedirectTemplate();
      expect(emptyRedirect.ctaUrl).toContain('/vendor/register');
      expect(emptyRedirect.subject).toBe(constants.VENDOR_INVITE_PORTAL_REDIRECT_NOTIFICATION.SUBJECT_FALLBACK);

      const fallbackRegRedirect = templates.buildVendorInvitePortalRedirectTemplate({
        rfq_id: '',
        is_registered_vendor: true,
        vendor_name: '',
      });
      expect(fallbackRegRedirect.ctaUrl).toContain('/vendor/opportunity-feed');

      const fullRedirect = templates.buildVendorInvitePortalRedirectTemplate({
        rfq_number: 'RFQ-Z-1',
        rfq_title: 'Valves',
        vendor_name: 'Acme Valves',
        is_registered_vendor: true,
        cta_url: 'https://portal.test/custom',
        invite_mailbox: INVITE_MAILBOX,
      });
      expect(fullRedirect.html).toContain(INVITE_MAILBOX);
      expect(fullRedirect.ctaUrl).toBe('https://portal.test/custom');

      const emptyCmOnboard = templates.buildCmVendorOnboardingTemplate();
      expect(emptyCmOnboard.text).toContain('Set during first login');
      expect(emptyCmOnboard.subject).toBe(constants.VENDOR_CM_ONBOARDING_NOTIFICATION.SUBJECT);

      const fullCmOnboard = templates.buildCmVendorOnboardingTemplate({
        to: 'cm-v@sup.in',
        recipient_name: 'Priya',
        buyer_organization_name: 'Custom Org',
        vendor_code: 'V-900',
        temp_password: 'Temp!900',
        contact_phone: '+919876543210',
        login_url: 'https://app.procucev.test/login',
      });
      expect(fullCmOnboard.html).toContain('V-900');
      expect(fullCmOnboard.html).toContain('+919876543210');

      const deliverVendorSpy = jest.spyOn(mailerService, 'deliverVendor').mockResolvedValue({ sent: true });
      const deliverBuyerSpy = jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true });

      await templates.sendTransactionalEmail('email_10', 'low@sup.in', {
        first_name: 'Low',
        credit_balance: 1,
        matched_rfq_count: 4,
      });
      expect(deliverVendorSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ replyTo: DIRECT_MAILBOX }),
        expect.any(String),
        expect.objectContaining({ vendorChannel: 'direct' })
      );

      await templates.sendTransactionalEmail('email_4', 'net@sup.in', {
        rfq_id: 'RFQ-4',
        rfq_title: 'Valves',
        first_name: 'Net',
        item_count: 1,
        credit_balance: 3,
        category: 'Valves',
        quote_deadline: '2026-12-01',
      }, { vendorChannel: 'invite' });
      expect(deliverVendorSpy).toHaveBeenLastCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({ vendorChannel: 'invite' })
      );

      // Cover branch where vendor gateway addresses are unset during sendTransactionalEmail
      delete process.env.VENDOR_INVITE_EMAIL_ADDRESS;
      delete process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS;
      delete process.env.VENDOR_GMAIL_SENDER_EMAIL;
      delete process.env.VENDOR_EMAIL_GATEWAY_ADDRESS;
      delete process.env.VENDOR_EMAIL_GATEWAY_USER;
      await templates.sendTransactionalEmail('email_11', 'cm@sup.in', {
        rfq_id: 'RFQ-11',
        rfq_title: 'Pumps',
      });
      expect(deliverVendorSpy).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ replyTo: expect.anything() }),
        expect.any(String),
        expect.any(Object)
      );

      await templates.sendTransactionalEmail('email_2', 'buyer@corp.in', {
        first_name: 'Buyer',
        rfq_id: 'RFQ-2',
        rfq_title: 'Bolts',
        category: 'Hardware',
        item_count: 2,
        suppliers_invited: 3,
      });
      expect(deliverBuyerSpy).toHaveBeenCalled();
    });

    test('covers mailerService fallback routing, normalizeVendorAddressOption, CC filtering, complex redirect, and closure branches', async () => {
      delete process.env.VENDOR_INVITE_EMAIL_ADDRESS;
      delete process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS;
      const legacyRouting = mailerService.resolveVendorInviteRouting(
        { id: 'v-leg', source: 'buyer_manual' },
        {},
        { rfqNumber: 'RFQ-LEG-1' }
      );
      expect(legacyRouting.channel).toBe('direct');
      expect(mailerService.resolveVendorInviteRouting(null, { inviteChannel: 'invite' }, null).replyToQuoteAllowed).toBe(false);

      process.env.VENDOR_INVITE_EMAIL_ADDRESS = INVITE_MAILBOX;
      process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS = DIRECT_MAILBOX;

      expect(mailerService.vendorFromAddress('unknown@other.test')).toContain(DIRECT_MAILBOX);
      expect(mailerService.vendorFromAddress({ inviteChannel: 'invite' })).toContain(INVITE_MAILBOX);
      expect(mailerService.vendorGatewayAddress({ from: INVITE_MAILBOX })).toBe(INVITE_MAILBOX);
      expect(mailerService.vendorFromAddress({ isCmAssigned: true })).toContain(DIRECT_MAILBOX);
      expect(mailerService.vendorFromAddress({ channel: 'other' })).toContain(DIRECT_MAILBOX);
      expect(mailerService.isVendorGmailApiConfigured('invite')).toBe(false);
      expect(mailerService.getVendorGmailOAuthClient('invite')).toBeUndefined();
      expect(mailerService.getGmailProviderKey('vendor_direct')).toBeNull();

      const complexInvite = mailerService.buildRfqInviteEmail('net@sup.in', {
        rfq: {
          rfqNumber: 'RFQ-CMP-1',
          buyerEmail: 'buyer@corp.in',
          items: Array.from({ length: 12 }, (_, idx) => ({ itemName: `Item ${idx + 1}`, quantity: 2 })),
        },
        cc: 'buyer@corp.in, ops@sup.in',
        buyerEmail: 'buyer@corp.in',
        isReminder: true,
        vendor: { id: 'v-n', source: 'procucev_network' },
      });
      expect(complexInvite.cc).toBe('ops@sup.in');
      expect(complexInvite.from).toContain(INVITE_MAILBOX);

      const onboardWithExplicitChannel = mailerService.buildVendorOnboardingEmail({
        to: 'v@sup.in',
        recipientName: 'V',
        vendorCode: 'V1',
        mailboxChannel: 'invite',
      });
      expect(onboardWithExplicitChannel.from).toContain(INVITE_MAILBOX);
      expect(onboardWithExplicitChannel.replyTo).toBe(INVITE_MAILBOX);

      // sendComplexRfqPortalRedirectEmail fallback when direct mailbox unset vs set
      const sendComplexSet = await mailerService.sendComplexRfqPortalRedirectEmail('v@sup.in', {
        rfq: { rfqNumber: 'RFQ-CMP-2' },
        itemCount: 12,
      });
      expect(sendComplexSet.sent).toBe(false);

      delete process.env.VENDOR_DIRECT_RFQ_EMAIL_ADDRESS;
      delete process.env.VENDOR_GMAIL_SENDER_EMAIL;
      delete process.env.VENDOR_EMAIL_GATEWAY_ADDRESS;
      const sendComplexUnset = await mailerService.sendComplexRfqPortalRedirectEmail('v@sup.in', {
        rfq: { rfqNumber: 'RFQ-CMP-2' },
        itemCount: 12,
      });
      expect(sendComplexUnset.sent).toBe(false);

      await expect(mailerService.sendVendorCategoryMismatchEmail('m@sup.in', {
        rfq: { rfqNumber: 'RFQ-MM-1' },
        vendor: { id: 'v-n', source: 'procucev_network' },
      })).resolves.toMatchObject({ sent: false });
      await expect(mailerService.sendVendorInvitePortalRedirectEmail('p@sup.in', {
        rfqNumber: 'RFQ-PR-1',
      })).resolves.toMatchObject({ sent: false });
    });

    test('covers emailGatewayService config env overrides, processVendorInviteReply fallbacks, and dual polling error handling', async () => {
      process.env.VENDOR_INVITE_GATEWAY_ENABLED = 'false';
      process.env.VENDOR_INVITE_GATEWAY_POLL_MS = '9000';
      process.env.VENDOR_INVITE_GATEWAY_MAX_PER_POLL = '4';
      process.env.VENDOR_INVITE_GATEWAY_ALLOWED_SENDERS = 'a@sup.in';
      process.env.VENDOR_INVITE_GATEWAY_ALLOWED_DOMAINS = 'sup.in';
      process.env.VENDOR_INVITE_GMAIL_LABEL_PROCESSED = 'INV_DONE';
      process.env.VENDOR_INVITE_GMAIL_LABEL_ERROR = 'INV_ERR';
      process.env.VENDOR_DIRECT_RFQ_GATEWAY_ENABLED = 'false';
      process.env.VENDOR_DIRECT_RFQ_GATEWAY_POLL_MS = '8000';
      process.env.VENDOR_DIRECT_RFQ_GATEWAY_MAX_PER_POLL = '6';
      process.env.VENDOR_DIRECT_RFQ_GMAIL_LABEL_PROCESSED = 'DIR_DONE';
      process.env.VENDOR_DIRECT_RFQ_GMAIL_LABEL_ERROR = 'DIR_ERR';

      const invCfg = emailGateway.resolveVendorInviteConfig();
      expect(invCfg.enabled).toBe(false);
      expect(invCfg.labelProcessed).toBe('INV_DONE');
      const dirCfg = emailGateway.resolveVendorConfig();
      expect(dirCfg.enabled).toBe(false);
      expect(dirCfg.labelError).toBe('DIR_ERR');

      expect(emailGateway.startVendorPolling(dirCfg, invCfg)).toMatchObject({ started: false });
      expect(emailGateway.isConfigured({ isVendorMailbox: false })).toBe(false);
      expect(emailGateway.isConfigured(invCfg)).toBe(false);
      expect(emailGateway.isConfigured(dirCfg)).toBe(false);

      // Invite reply referencing a nonexistent RFQ number + fallback registration check
      const invRefMiss = await emailGateway.processVendorInviteReply(
        { fromAddress: 'x@sup.in', fromName: 'X Supplier', subject: 'Re: RFQ-MISSING' },
        invCfg,
        { targetRfq: null, referencedNumber: 'RFQ-MISSING', vendorRecord: null }
      );
      expect(invRefMiss.status).toBe(emailGateway.INGESTION_OUTCOME.INVALID_RFQ);

      const sendRedirectSpy = jest.spyOn(mailerService, 'sendVendorInvitePortalRedirectEmail').mockResolvedValue({ sent: true });
      jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
      const invFallbackReg = await emailGateway.processVendorInviteReply(
        { fromAddress: 'mem-v@sup.in', fromName: 'Mem Vendor', messageId: '<m-mem@sup>', subject: 'Re: RFQ-MEM' },
        invCfg,
        {
          targetRfq: { id: 'rfq-m', rfqNumber: 'RFQ-MEM', title: 'Pipes' },
          referencedNumber: 'RFQ-MEM',
          vendorRecord: { id: 'v-mem', name: 'Mem Vendor', hasIdentity: false },
        }
      );
      expect(invFallbackReg.status).toBe(emailGateway.INGESTION_OUTCOME.PORTAL_SUBMISSION_REQUIRED);
      expect(sendRedirectSpy).toHaveBeenCalledWith('mem-v@sup.in', expect.objectContaining({ isRegisteredVendor: false }));

      // pollBothInboxesOnce rejecting invite poll + ensureHydrated
      process.env.VENDOR_INVITE_GMAIL_CLIENT_ID = 'i-c';
      process.env.VENDOR_INVITE_GMAIL_CLIENT_SECRET = 'i-s';
      process.env.VENDOR_INVITE_GMAIL_REFRESH_TOKEN = 'i-r';
      const buyerSpy = jest.spyOn(emailGateway, 'pollOnce').mockResolvedValue({ skipped: false, considered: 1, ingested: 0 });
      const vendorSpy = jest.spyOn(emailGateway, 'pollVendorViaGmailApi').mockResolvedValue({ skipped: false, considered: 0, ingested: 0 });
      const invitePollSpy = jest.spyOn(emailGateway, 'pollVendorInviteViaGmailApi').mockRejectedValue(new Error('invite boom'));
      const hydrationSpy = jest.fn(async () => {});
      const errCombined = await emailGateway.pollBothInboxesOnce(
        emailGateway.resolveConfig(),
        { ...dirCfg, enabled: true },
        {
          ensureHydrated: hydrationSpy,
          vendorInviteConfig: { ...invCfg, enabled: true },
        }
      );
      expect(errCombined.vendorInviteMailbox.error).toBe('invite boom');

      // Also exercise pollVendorViaGmailApi with invite channel & pollVendorInviteOnce directly
      buyerSpy.mockRestore();
      vendorSpy.mockRestore();
      invitePollSpy.mockRestore();
      jest.spyOn(emailGateway, 'pollViaGmailApi').mockResolvedValue({ skipped: true });
      await emailGateway.pollVendorViaGmailApi({ ...invCfg, enabled: true });
      await emailGateway.pollVendorInviteOnce({ ...invCfg, enabled: true });
    });

    test('covers storeService CM outbox onboarding, buyer role inviteVendorsToRFQ, chaser email matching, and eventOutbox branches', async () => {
      process.env.AES_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValue({});
      jest.spyOn(storeService, '_persistRFQ').mockImplementation(() => {});
      jest.spyOn(storeService, '_persistVendorOnboardingStatus').mockResolvedValue({ updated: { id: 'v-cm-d' }, warning: null });
      jest.spyOn(storeService, '_background').mockImplementation(() => {});
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertAccSpy = jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      const outboxDispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 0 });

      const durableCm = await storeService.provisionVendorOnboarding(
        { id: 'v-cm-d', email: 'cm-dur@sup.in', name: 'Durable CM Supplier', isCmCreated: true },
        'cm@procucev.test'
      );
      outboxDispatchSpy.mockRestore();
      expect(durableCm.status).toBe('pending');
      expect(insertAccSpy).toHaveBeenCalledWith(expect.objectContaining({
        resetPasswordRequired: true,
        onboardingEvent: expect.objectContaining({
          payload: expect.objectContaining({ isCmCreated: true, mailboxChannel: 'direct' }),
        }),
      }));

      // Chaser matcher with assignedVendors corporateEmail + DB boolean false reply_to_quote_allowed + record error catch
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValue([
        {
          vendor_id: 'other-id',
          vendor_email: 'corp@sup.in',
          invite_channel: 'invite',
          invite_origin: 'auto_matched_network',
          sender_mailbox: INVITE_MAILBOX,
          reply_to_quote_allowed: false,
        },
      ]);
      const sendChaserSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
      try {
        await rfqChaserScheduler._dispatchReminderEmail(
          {
            rfqNumber: 'RFQ-CH-BOOL',
            title: 'Valves',
            sourcingMode: 'mode_0',
            assignedVendors: [{ id: 'v-a1', corporateEmail: 'corp@sup.in', source: 'procucev_network' }],
          },
          { id: 'v-a1', name: 'Corp Sup', email: 'corp@sup.in', source: 'procucev_network' }
        );
        expect(sendChaserSpy).toHaveBeenCalledWith(
          'corp@sup.in',
          expect.objectContaining({ replyToQuoteAllowed: false, inviteChannel: 'invite' })
        );
      } finally {
        process.env.NODE_ENV = origEnv;
      }

      // eventOutboxService VENDOR_ONBOARDING_EMAIL with isCmCreated + RFQ_VENDOR_INVITE_EMAIL routing fallback + DB error catch
      jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
        id: 'rfq-eo-1',
        rfqNumber: 'RFQ-EO-1',
        title: 'Bolts',
        sourcingMode: 'mode_0',
      });
      jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockRejectedValue(new Error('non-fatal write failure'));
      jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true, messageId: '<eo-1>' });
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValue([
        {
          id: 'outbox-eo-fallback',
          eventType: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          event_type: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          attempts: 0,
          raw: {
            rfqId: 'rfq-eo-1',
            target: {
              key: 'k-eo-1',
              vendorId: 'v-eo-1',
              recipientEmail: 'eo@sup.in',
              recipientName: 'EO Sup',
              vendor: { id: 'v-eo-1', source: 'procucev_network', email: 'eo@sup.in' },
            },
          },
        },
      ]);
      jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
    });

    test('covers remaining eventOutboxService and storeService vendor-invite & dispatch branches', async () => {
      process.env.AES_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // 1. eventOutboxService: RFQ_VENDOR_INVITE_EMAIL with isCmCreated + no resolveVendorInviteRouting + explicit target metadata
      const originalResolveRouting = mailerService.resolveVendorInviteRouting;
      jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue({
        id: 'rfq-eo-2',
        rfqNumber: 'RFQ-EO-2',
        title: 'Gaskets',
        sourcingMode: 'mode_0',
      });
      jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockResolvedValue(true);
      const sendRfqSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true, messageId: '<eo-2>' });
      jest.spyOn(eventOutboxQueries, 'markEventOutboxCompleteInDB').mockResolvedValue(true);

      // Variant A: resolveVendorInviteRouting unavailable & no explicit metadata, isCmCreated: true
      mailerService.resolveVendorInviteRouting = undefined;
      try {
        jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValueOnce([
          {
            id: 'outbox-eo-no-routing',
            eventType: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
            event_type: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
            attempts: 0,
            raw: {
              rfqId: 'rfq-eo-2',
              target: {
                key: 'k-eo-2a',
                vendorId: 'v-eo-2a',
                recipientEmail: 'eo2a@sup.in',
                recipientName: 'EO2A Sup',
                isCmCreated: true,
                vendor: { id: 'v-eo-2a', email: 'eo2a@sup.in' },
              },
            },
          },
        ]);
        await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      } finally {
        mailerService.resolveVendorInviteRouting = originalResolveRouting;
      }

      // Variant B: explicit inviteChannel/inviteOrigin/senderMailbox/replyToQuoteAllowed on target
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValueOnce([
        {
          id: 'outbox-eo-explicit',
          eventType: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          event_type: constants.EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL,
          attempts: 0,
          raw: {
            rfqId: 'rfq-eo-2',
            target: {
              key: 'k-eo-2b',
              vendorId: 'v-eo-2b',
              recipientEmail: 'eo2b@sup.in',
              recipientName: 'EO2B Sup',
              inviteChannel: 'direct',
              inviteOrigin: 'cm_created',
              senderMailbox: DIRECT_MAILBOX,
              replyToQuoteAllowed: true,
              isCmCreated: false,
              vendor: { id: 'v-eo-2b', email: 'eo2b@sup.in' },
            },
          },
        },
      ]);
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ completed: 1 });
      expect(sendRfqSpy).toHaveBeenCalledWith(
        'eo2b@sup.in',
        expect.objectContaining({
          inviteChannel: 'direct',
          inviteOrigin: 'cm_created',
          senderMailbox: DIRECT_MAILBOX,
          replyToQuoteAllowed: true,
        })
      );

      // 2. eventOutboxService: HISTORICAL_VENDOR_ONBOARDING_EMAIL delivery rejected & save null & dead-letter null vendor
      const encryptedHist = cryptoService.encrypt(
        JSON.stringify({ to: 'hist@sup.in', subject: 'Welcome Supplier', text: 'Login details' }),
        { additionalData: 'vendor-historical-onboarding-email:v-hist-1' }
      ).encoded;
      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue({
        id: 'v-hist-1',
        email: 'hist@sup.in',
        onboardingEmailStatus: 'pending',
      });
      jest.spyOn(eventOutboxQueries, 'rescheduleEventOutboxInDB').mockResolvedValue(true);

      // Delivery returns { sent: false }
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValueOnce({ sent: false });
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValueOnce([
        {
          id: 'outbox-hist-notsent',
          eventType: constants.EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
          event_type: constants.EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
          attempts: 0,
          raw: { vendorId: 'v-hist-1', encryptedEmailPayload: encryptedHist },
        },
      ]);
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ retried: 1 });

      // Delivery succeeds, updateVendorDurably returns null & dead-letter also returns null
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValueOnce({ sent: true });
      jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue(null);
      jest.spyOn(eventOutboxQueries, 'claimDueEventOutboxInDB').mockResolvedValueOnce([
        {
          id: 'outbox-hist-notsaved',
          eventType: constants.EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
          event_type: constants.EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
          attempts: 99,
          raw: { vendorId: 'v-hist-1', encryptedEmailPayload: encryptedHist },
        },
      ]);
      await expect(eventOutboxService.dispatchDueEventOutboxJobs(1)).resolves.toMatchObject({ dead: 1 });

      // 3. storeService: getOpenVendorInvitesWithinWindow, isVendorInvitedToRfq, checkAndDispatchBuyerQuotations & dispatchDueV0BuyerQuotations branches
      hasStorageSpy.mockReturnValue(false);
      storeService.reset();

      const oldIso = new Date(Date.now() - 96 * 3600 * 1000).toISOString();
      const recentIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      storeService.rfqs.push(
        { id: 'rfq-win-closed', rfqNumber: 'RFQ-WIN-CLOSED', status: 'Closed', createdAt: recentIso, quotes: [] },
        { id: 'rfq-win-noassigned', rfqNumber: 'RFQ-WIN-NOASS', status: 'Open', createdAt: recentIso, quotes: [] },
        {
          id: 'rfq-win-expired-age',
          rfqNumber: 'RFQ-WIN-OLD',
          status: 'Open',
          createdAt: oldIso,
          quotesDispatchDueAt: oldIso,
          assignedVendors: [{ email: 'win@sup.in' }],
          quotes: [],
        },
        {
          id: 'rfq-win-active',
          rfqNumber: 'RFQ-WIN-ACT',
          status: 'Open',
          createdAt: recentIso,
          assignedVendors: [null, { corporateEmail: 'win@sup.in' }],
          quotes: [],
        }
      );
      storeService.recordRfqVendorInvite(
        { id: 'rfq-win-closed', rfqNumber: 'RFQ-WIN-CLOSED' },
        { vendorEmail: 'win@sup.in', invitedAt: recentIso, inviteMessageId: '<win-closed-1@mail.test>' }
      );
      storeService.recordRfqVendorInvites(
        { id: 'rfq-win-active', rfqNumber: 'RFQ-WIN-ACT' },
        [
          null,
          { name: 'MissingEmail' },
          {
            vendor: { id: 'v-rec-1', email: 'rec1@sup.in', inviteChannel: 'invite', inviteOrigin: 'auto_matched_network', replyToQuoteAllowed: false },
            senderMailbox: INVITE_MAILBOX,
          },
          { vendorId: 'v-rec-2', recipientEmail: 'rec2@sup.in', replyToQuoteAllowed: true },
        ]
      );
      expect(storeService.findVendorInviteByMessageId()).toBeNull();
      expect(storeService.findVendorInviteByMessageId(['<win-closed-1@mail.test>'])).toMatchObject({ rfqNumber: 'RFQ-WIN-CLOSED' });
      const openInvites = await storeService.getOpenVendorInvitesWithinWindow(null, 'win@sup.in');
      expect(openInvites.map((r) => r.rfqNumber)).toEqual(['RFQ-WIN-ACT']);

      // isVendorInvitedToRfq via followUpData.vendors & assignedVendors corporateEmail/vendorId & unlockedRfqIds & uninvited fallback
      const rfqFup = {
        id: 'rfq-fup-1',
        rfqNumber: 'RFQ-FUP-1',
        assignedVendors: [{ vendorId: 'v-other', corporateEmail: 'other@sup.in' }],
        followUpData: { vendors: [{ vendorId: 'v-fup-id', corporateEmail: 'fup-only@sup.in' }] },
      };
      await expect(storeService.isVendorInvitedToRfq(rfqFup, { id: 'v-other' })).resolves.toBe(true);
      await expect(storeService.isVendorInvitedToRfq(rfqFup, { corporateEmail: 'fup-only@sup.in' })).resolves.toBe(true);
      await expect(storeService.isVendorInvitedToRfq(rfqFup, { id: 'v-unlock', email: 'unl@sup.in', unlockedRfqIds: ['RFQ-FUP-1'] })).resolves.toBe(true);
      await expect(storeService.isVendorInvitedToRfq(rfqFup, { id: 'v-nope', email: 'nope@unrelated-vendor.example' })).resolves.toBe(false);

      // checkAndDispatchBuyerQuotations & dispatchDueV0BuyerQuotations: name-only vendorKey, invitedAt dueAtIso fallback, mailer { sent: false } releaseClaim
      const dueInviteAt = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const buyerAcc = storeService.addBuyerAccount({
        organizationName: 'Dispatch Buyer Co',
        corporateEmail: 'dispatch-buyer@corp.test',
      });
      storeService.rfqs.push({
        id: 'rfq-due-v0',
        rfqNumber: 'RFQ-DUE-V0',
        title: 'Due V0 RFQ',
        status: 'Open',
        sourcingMode: 'mode_0',
        buyerAccountId: buyerAcc.id,
        assignedVendors: [{ vendorName: 'Name Only Supplier' }],
        quotes: [{ vendorName: 'Name Only Supplier', totalPrice: 4200 }],
      });
      storeService.recordRfqVendorInvite(
        { id: 'rfq-due-v0', rfqNumber: 'RFQ-DUE-V0' },
        { vendorEmail: 'due-name-only@sup.in', invitedAt: dueInviteAt }
      );
      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValueOnce({ sent: false });
      const failedDispatch = await storeService.checkAndDispatchBuyerQuotations('RFQ-DUE-V0');
      expect(failedDispatch).toMatchObject({ dispatched: false, reason: 'email_delivery_not_accepted' });

      // Default now arg in dispatchDueV0BuyerQuotations + actual due RFQ sweep
      storeService.rfqs.push({
        id: 'rfq-due-sweep',
        rfqNumber: 'RFQ-DUE-SWEEP',
        title: 'Sweep V0 RFQ',
        status: 'Open',
        sourcingMode: 'mode_0',
        buyerAccountId: buyerAcc.id,
        quotesDispatchDueAt: new Date(Date.now() - 60000).toISOString(),
        assignedVendors: [{ vendorName: 'Sweep Supplier' }],
        quotes: [{ vendorName: 'Sweep Supplier', totalPrice: 5100 }],
      });
      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValueOnce({ sent: true });
      const sweepResult = await storeService.dispatchDueV0BuyerQuotations();
      expect(sweepResult).toMatchObject({ dispatched: 1 });
    });
  });
});
