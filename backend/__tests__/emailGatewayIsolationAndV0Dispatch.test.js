const emailGatewayService = require('../src/services/emailGatewayService');
const emailIngestionService = require('../src/services/emailIngestionService');
const emailGatewayQueries = require('../src/db/emailGatewayQueries');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const geminiService = require('../src/services/geminiService');
const mailerService = require('../src/services/mailerService');
const mailTransport = require('../src/services/mailTransport');
const storeService = require('../src/services/storeService');
const rfqChaserScheduler = require('../src/services/rfqChaserScheduler');
const pool = require('../src/db/pool');

const { INGESTION_OUTCOME } = emailGatewayQueries;

function buildRawEml({
  from = 'sender@example.com',
  to = 'rfq@procucev.com',
  cc = '',
  deliveredTo = '',
  originalTo = '',
  subject = 'Enquiry',
  messageId = `<msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com>`,
  inReplyTo = '',
  references = '',
  textBody = '',
  htmlBody = '',
}) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    deliveredTo ? `Delivered-To: ${deliveredTo}` : null,
    originalTo ? `X-Original-To: ${originalTo}` : null,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    'Date: Wed, 25 Nov 2026 12:32:00 +0530',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (htmlBody && textBody) {
    const boundary = '----=_Boundary_Isolate_001';
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return Buffer.from(
      [
        ...headers,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        textBody,
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        '',
        htmlBody,
        `--${boundary}--`,
      ].join('\r\n'),
      'utf8'
    );
  }
  if (htmlBody) {
    headers.push('Content-Type: text/html; charset=utf-8');
    return Buffer.from([...headers, '', htmlBody].join('\r\n'), 'utf8');
  }
  headers.push('Content-Type: text/plain; charset=utf-8');
  return Buffer.from([...headers, '', textBody].join('\r\n'), 'utf8');
}

describe('Email Gateway Mailbox Isolation, Vendor Protection & V0 Quote Dispatch', () => {
  const BUYER_CONFIG = emailGatewayService.resolveConfig({
    EMAIL_GATEWAY_ENABLED: 'true',
    EMAIL_GATEWAY_USER: 'rfq@procucev.com',
    EMAIL_GATEWAY_ADDRESS: 'rfq@procucev.com',
  });

  beforeEach(() => {
    storeService.reset();
    emailGatewayService.resetAutoReplyMemory();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    jest.spyOn(emailGatewayQueries, 'hasProcessed').mockResolvedValue(false);
    jest.spyOn(emailGatewayQueries, 'recordProcessed').mockResolvedValue(true);
    jest.spyOn(emailGatewayQueries, 'countRecentOutcomes').mockResolvedValue(0);
    jest.spyOn(emailGatewayQueries, 'claimPendingAcknowledgement').mockResolvedValue('claim-test-1');
    jest.spyOn(emailGatewayQueries, 'completeClaimedAcknowledgement').mockResolvedValue(true);
    jest.spyOn(emailGatewayQueries, 'releaseClaimedAcknowledgement').mockResolvedValue(true);
    jest.spyOn(mailerService, 'isConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    rfqChaserScheduler.clearScheduledChasers('all');
    jest.restoreAllMocks();
  });

  describe('Part 1: Strict Mailbox Gate & 4 Gateway Holes', () => {
    test('resolveVendorConfig always hardcodes autoRegisterUnregisteredBuyers: false', () => {
      const cfg = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'true',
        VENDOR_EMAIL_GATEWAY_USER: 'invitations@procucev.com',
        EMAIL_GATEWAY_AUTO_REGISTER: 'true',
        VENDOR_EMAIL_GATEWAY_AUTO_REGISTER: 'true',
      });
      expect(cfg.isVendorMailbox).toBe(true);
      expect(cfg.autoRegisterUnregisteredBuyers).toBe(false);
    });

    test('isStrictBuyerRfqMailbox enforces strict allowlist across To, Delivered-To, and X-Original-To', () => {
      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['rfq@procucev.com'],
      }, BUYER_CONFIG)).toBe(true);

      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['rfq@procucev.com'],
      }, { isVendorMailbox: true })).toBe(false);

      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['invitations@procucev.com'],
      }, BUYER_CONFIG)).toBe(false);

      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['gmtrfq@procucev.com'],
      }, BUYER_CONFIG)).toBe(false);

      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['rfq@procucev.com'],
        deliveredTo: ['invitations@procucev.com'],
      }, BUYER_CONFIG)).toBe(false);

      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        toAddresses: ['rfq@procucev.com'],
        originalTo: ['gmtrfq@procucev.com'],
      }, BUYER_CONFIG)).toBe(false);
    });

    test('Unregistered sender -> rfq@procucev.com is allowed to create buyer account + RFQ', async () => {
      jest.spyOn(geminiService, 'extractLineItems').mockResolvedValue({
        status: geminiService.EXTRACTION_STATUS.SUCCESS,
        documentTitle: 'Centrifugal Pump Enquiry',
        category: 'Engineering Spares - Mechanical',
        lineItems: [{ itemName: 'Centrifugal Pump 10HP', quantity: 2, unit: 'Nos' }],
      });
      const onboardSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail').mockResolvedValue({ sent: true });
      jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: { id: 'buyer-new-rfq', orgId: 'org-new-rfq', role: 'buyer' },
      });

      const eml = buildRawEml({
        from: 'procurement@newclient.in',
        to: 'rfq@procucev.com',
        subject: 'Need Centrifugal Pumps',
        textBody: 'Please quote 2 Nos Centrifugal Pump 10HP.',
      });

      const outcome = await emailGatewayService.processMessage(eml, BUYER_CONFIG);
      expect(outcome.status).toBe(INGESTION_OUTCOME.INGESTED);
      expect(storeService.buyerAccounts.some((b) => b.corporateEmail === 'procurement@newclient.in')).toBe(true);
      expect(storeService.rfqs).toHaveLength(1);
      expect(onboardSpy).toHaveBeenCalledTimes(1);
    });

    test('Unregistered sender -> invitations@procucev.com is blocked (skipped_non_buyer_mailbox) with 0 buyers and 0 RFQs', async () => {
      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ');
      const onboardSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail');

      const eml = buildRawEml({
        from: 'unregistered@vendor-prospect.in',
        to: 'invitations@procucev.com',
        subject: 'Need 50 Electric Motors',
        textBody: 'Please send quotation for 50 Electric Motors.',
      });

      const buyerPollerOutcome = await emailGatewayService.processMessage(eml, BUYER_CONFIG);
      expect(buyerPollerOutcome.status).toBe('skipped_non_buyer_mailbox');

      const vendorConfig = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'true',
        VENDOR_EMAIL_GATEWAY_USER: 'invitations@procucev.com',
        VENDOR_EMAIL_GATEWAY_ADDRESS: 'invitations@procucev.com',
      });
      const vendorPollerOutcome = await emailGatewayService.processMessage(eml, vendorConfig);
      expect(vendorPollerOutcome.status).toBe('skipped_non_buyer_mailbox');

      expect(insertBuyerSpy).not.toHaveBeenCalled();
      expect(createRfqSpy).not.toHaveBeenCalled();
      expect(onboardSpy).not.toHaveBeenCalled();
      expect(storeService.buyerAccounts).toHaveLength(0);
      expect(storeService.rfqs).toHaveLength(0);
    });

    test('Unregistered or registered sender -> gmtrfq@procucev.com is blocked (skipped_non_buyer_mailbox)', async () => {
      storeService.addBuyerAccount({
        id: 'reg-buyer-gmt',
        corporateEmail: 'buyer@registered.in',
        organizationName: 'Registered Corp',
        status: 'ACTIVE_VERIFIED',
      });
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ');
      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');

      for (const sender of ['stranger@outside.in', 'buyer@registered.in']) {
        const eml = buildRawEml({
          from: sender,
          to: 'gmtrfq@procucev.com',
          subject: 'Requirement for Copper Cables',
          textBody: 'Need 500m Copper Cable.',
        });
        const res = await emailGatewayService.processMessage(eml, BUYER_CONFIG);
        expect(res.status).toBe('skipped_non_buyer_mailbox');
      }

      expect(insertBuyerSpy).not.toHaveBeenCalled();
      expect(createRfqSpy).not.toHaveBeenCalled();
      expect(storeService.rfqs).toHaveLength(0);
    });

    test('Forwarded/aliased mail where Delivered-To or X-Original-To is invitations@procucev.com or gmtrfq@procucev.com on buyer poller is blocked', async () => {
      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ');

      const deliveredToInvitations = buildRawEml({
        from: 'alias-sender@example.com',
        to: 'rfq@procucev.com',
        deliveredTo: 'invitations@procucev.com',
        subject: 'Forwarded Quote',
        textBody: 'Please quote 10 Valves.',
      });
      const res1 = await emailGatewayService.processMessage(deliveredToInvitations, BUYER_CONFIG);
      expect(res1.status).toBe('skipped_non_buyer_mailbox');

      const originalToGmt = buildRawEml({
        from: 'alias-sender2@example.com',
        to: 'rfq@procucev.com',
        originalTo: 'gmtrfq@procucev.com',
        subject: 'Forwarded RFQ',
        textBody: 'Please quote 10 Pumps.',
      });
      const res2 = await emailGatewayService.processMessage(originalToGmt, BUYER_CONFIG);
      expect(res2.status).toBe('skipped_non_buyer_mailbox');

      expect(insertBuyerSpy).not.toHaveBeenCalled();
      expect(createRfqSpy).not.toHaveBeenCalled();
    });
  });

  describe('Part 1 Hole 3 & Hole 4: Vendor Protection (No "user" Row)', () => {
    test('getOrCreateBuyerAccount blocks calls without isStrictBuyerMailbox and blocks existing vendors in vendors table', async () => {
      const unstrict = await emailGatewayService.getOrCreateBuyerAccount('new@example.com');
      expect(unstrict.blocked).toBe(true);
      expect(unstrict.reason).toBe('non_buyer_mailbox');

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');

      // Vendor exists in DB/store without a corresponding identity "user" row (CM-added / GraphQL)
      const cmVendor = {
        id: 'v-cm-only-1',
        name: 'Dhairya Engineering',
        email: 'dhairya@dhairyaengineering.co.in',
        corporateEmail: 'dhairya@dhairyaengineering.co.in',
        status: 'VERIFIED SUPPLIER',
      };
      storeService.vendors.push(cmVendor);

      const blockedInMemory = await emailGatewayService.getOrCreateBuyerAccount('dhairya@dhairyaengineering.co.in', {
        isStrictBuyerMailbox: true,
      });
      expect(blockedInMemory).toMatchObject({ blocked: true, reason: 'existing_vendor' });

      storeService.vendors = [];
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValueOnce(cmVendor);
      const blockedFromDb = await emailGatewayService.getOrCreateBuyerAccount('dhairya@dhairyaengineering.co.in', {
        isStrictBuyerMailbox: true,
      });
      expect(blockedFromDb).toMatchObject({ blocked: true, reason: 'existing_vendor' });
      expect(insertBuyerSpy).not.toHaveBeenCalled();
    });

    test('Vendor with no "user" row emailing rfq@procucev.com or invitations@procucev.com with Subject Offer and Quote 25/11/2026 is blocked from Buyer RFQ creation', async () => {
      storeService.vendors.push({
        id: 'v-dhairya-cm',
        name: 'Dhairya Engineering',
        email: 'dhairya@dhairyaengineering.co.in',
        corporateEmail: 'dhairya@dhairyaengineering.co.in',
        status: 'VERIFIED SUPPLIER',
      });
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ');
      const onboardSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail');

      for (const mailbox of ['rfq@procucev.com', 'invitations@procucev.com']) {
        const offerEml = buildRawEml({
          from: 'Bhoomika Makwana <dhairya@dhairyaengineering.co.in>',
          to: mailbox,
          subject: 'Offer',
          htmlBody: '<table><tr><td colspan="3"><b>Quote 25/11/2026</b></td></tr><tr><td>1</td><td>Mitsubishi</td><td>FR-E720-0.2K</td></tr></table>',
        });

        const outcome = await emailGatewayService.processMessage(offerEml, BUYER_CONFIG);
        expect(outcome.status).toBe(INGESTION_OUTCOME.INVALID_RFQ);
      }

      // Direct Scenario 4 call must also block existing vendors
      const attribution = await emailGatewayService.resolveMultiBuyerAttribution({
        fromAddress: 'dhairya@dhairyaengineering.co.in',
        toAddresses: ['rfq@procucev.com'],
        cc: [],
      }, BUYER_CONFIG);
      expect(attribution.allowed).toBe(false);

      expect(insertBuyerSpy).not.toHaveBeenCalled();
      expect(createRfqSpy).not.toHaveBeenCalled();
      expect(onboardSpy).not.toHaveBeenCalled();
      expect(storeService.buyerAccounts).toHaveLength(0);
      expect(storeService.rfqs).toHaveLength(0);
    });
  });

  describe('Part 2: Outbound Invite Message-ID, RFQ Extraction Fallbacks, Strict Bid Binding & Dual-Trigger Buyer Dispatch', () => {
    test('buildRawMimeMessage + buildRfqInviteEmail embed rfqNumber in Message-ID without breaking default messages', () => {
      const inviteEmail = mailerService.buildRfqInviteEmail('vendor@example.com', {
        rfq: { rfqNumber: 'RFQ262511472105', title: 'Mitsubishi VFD', extractedEntities: [] },
        vendor: { id: 'v-101' },
      });
      expect(inviteEmail.messageId).toMatch(/^<rfq-RFQ262511472105-vv-101-\d+@procucev\.com>$/);

      const mimeWithId = Buffer.from(
        mailTransport.buildRawMimeMessage({
          from: 'invitations@procucev.com',
          to: 'vendor@example.com',
          subject: inviteEmail.subject,
          html: inviteEmail.html,
          messageId: inviteEmail.messageId,
        }),
        'base64url'
      ).toString('utf8');
      expect(mimeWithId).toContain(`Message-ID: ${inviteEmail.messageId}`);

      const mimeWithoutId = Buffer.from(
        mailTransport.buildRawMimeMessage({
          from: 'rfq@procucev.com',
          to: 'buyer@example.com',
          subject: 'Plain Notice',
          text: 'Hello',
        }),
        'base64url'
      ).toString('utf8');
      expect(mimeWithoutId).not.toContain('Message-ID:');
    });

    test('Vendor reply with subject "Offer" resolves RFQ via In-Reply-To/References OR unstripped quoted HTML OR unambiguous open 48h invite', async () => {
      const targetRfq = {
        id: 'rfq-resolve-1',
        rfqNumber: 'RFQ262511000888',
        title: 'Mitsubishi VFD FR-E720-0.2K',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        buyerAccountId: 'buyer-owner-1',
        assignedVendors: [{ id: 'v-resolve-1', email: 'sales@supplier.in', name: 'Supplier One' }],
        quotes: [],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(targetRfq);
      const inviteRec = storeService.recordRfqVendorInvite(targetRfq, {
        vendorId: 'v-resolve-1',
        vendorEmail: 'sales@supplier.in',
      });

      // 1. Resolve via stored inviteMessageId / In-Reply-To even with subject "Offer" and no RFQ in body
      const viaThread = await emailGatewayService.extractRfqReferenceFromEmail({
        fromAddress: 'sales@supplier.in',
        subject: 'Offer',
        bodyText: 'Please find Quote 25/11/2026 attached.',
        inReplyTo: inviteRec.inviteMessageId,
      });
      expect(viaThread.targetRfq?.rfqNumber).toBe('RFQ262511000888');

      // 2. Resolve via unstripped quoted HTML / rawBodyText when stripped bodyText lost the quote chain
      const parsedHtmlReply = await emailIngestionService.parseEmailMessage(
        buildRawEml({
          from: 'sales@supplier.in',
          to: 'invitations@procucev.com',
          subject: 'Offer',
          htmlBody: '<p>Please find Quote 25/11/2026: INR 12500.</p><hr/><p>On Wed, 25 Nov 2026 invitations@procucev.com wrote:<br/>New RFQ <b>RFQ262511000888</b> details</p>',
        })
      );
      expect(parsedHtmlReply.rawBodyText).toContain('RFQ262511000888');
      const viaRawHtml = await emailGatewayService.extractRfqReferenceFromEmail(parsedHtmlReply);
      expect(viaRawHtml.targetRfq?.rfqNumber).toBe('RFQ262511000888');

      // 3. Resolve via single unambiguous open 48h invite when subject, body, HTML, and headers all omit RFQ #
      const viaOpenInvite = await emailGatewayService.extractRfqReferenceFromEmail({
        fromAddress: 'sales@supplier.in',
        subject: 'Offer',
        bodyText: 'Quote 25/11/2026 INR 12500',
      }, {
        vendorRecord: { id: 'v-resolve-1', email: 'sales@supplier.in' },
        allowInviteFallback: true,
      });
      expect(viaOpenInvite.targetRfq?.rfqNumber).toBe('RFQ262511000888');
      expect(viaOpenInvite.resolutionMethod).toBe('single_open_invite_fallback');

      // Ambiguous case: adding a 2nd open invite prevents guessing
      const secondRfq = {
        ...targetRfq,
        id: 'rfq-resolve-2',
        rfqNumber: 'RFQ262511000999',
        assignedVendors: [{ id: 'v-resolve-1', email: 'sales@supplier.in', name: 'Supplier One' }],
      };
      storeService.rfqs.push(secondRfq);
      storeService.recordRfqVendorInvite(secondRfq, { vendorId: 'v-resolve-1', vendorEmail: 'sales@supplier.in' });

      const ambiguous = await emailGatewayService.extractRfqReferenceFromEmail({
        fromAddress: 'sales@supplier.in',
        subject: 'Offer',
        bodyText: 'Quote 25/11/2026 INR 12500',
      }, {
        vendorRecord: { id: 'v-resolve-1', email: 'sales@supplier.in' },
        allowInviteFallback: true,
      });
      expect(ambiguous.targetRfq).toBeNull();
    });

    test('Dual-Trigger V0 Buyer Dispatch (Trigger A immediate on 100% bids, idempotency, and late post-48h bid)', async () => {
      const buyerA = storeService.addBuyerAccount({
        id: 'buyer-a-v0',
        corporateEmail: 'buyer.a@company.in',
        organizationName: 'Company A',
        status: 'ACTIVE_VERIFIED',
      });
      const buyerB = storeService.addBuyerAccount({
        id: 'buyer-b-other',
        corporateEmail: 'buyer.b@other.in',
        organizationName: 'Company B',
        status: 'ACTIVE_VERIFIED',
      });

      const v1 = storeService.addVendor({ id: 'v-1', name: 'Vendor One', email: 'v1@supplier.in', status: 'VERIFIED SUPPLIER' });
      const v2 = storeService.addVendor({ id: 'v-2', name: 'Vendor Two', email: 'v2@supplier.in', status: 'VERIFIED SUPPLIER' });
      const vUninvited = storeService.addVendor({ id: 'v-uninv', name: 'Uninvited Co', email: 'uninvited@othercompany.in', status: 'VERIFIED SUPPLIER' });

      const rfqV0 = {
        id: 'rfq-v0-dual-1',
        rfqNumber: 'RFQ262511100001',
        title: 'Mitsubishi VFD',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        buyerAccountId: buyerA.id,
        buyerAccountName: buyerA.organizationName,
        buyerEmail: buyerA.corporateEmail,
        extractedEntities: [{ itemName: 'FR-E720-0.2K', quantity: 2, unit: 'Nos' }],
        assignedVendors: [
          { id: v1.id, name: v1.name, email: v1.email },
          { id: v2.id, name: v2.name, email: v2.email },
        ],
        quotes: [],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(rfqV0);
      const inv1 = storeService.recordRfqVendorInvite(rfqV0, { vendorId: v1.id, vendorEmail: v1.email });
      const inv2 = storeService.recordRfqVendorInvite(rfqV0, { vendorId: v2.id, vendorEmail: v2.email });
      expect(rfqV0.quotesDispatchDueAt).toBeTruthy();

      const comparisonMailSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });
      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });

      // Uninvited vendor trying to submit on V0 RFQ with tracked invites is rejected
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValue({ unitPrice: 9999, totalPrice: 19998, leadTimeDays: 5 });
      const uninvRes = await emailGatewayService.processMessage(buildRawEml({
        from: vUninvited.email,
        to: 'invitations@procucev.com',
        subject: `Offer ${rfqV0.rfqNumber}`,
        textBody: 'Unit Price INR 9999',
      }), BUYER_CONFIG);
      expect(uninvRes.status).toBe(INGESTION_OUTCOME.SENDER_NOT_ALLOWED);

      // Bid 1 (1 of 2): saved strictly under buyerA, no comparison email yet
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({ unitPrice: 11500, totalPrice: 23000, leadTimeDays: 7 });
      const bid1Res = await emailGatewayService.processMessage(buildRawEml({
        from: v1.email,
        to: 'invitations@procucev.com',
        subject: 'Offer',
        inReplyTo: inv1.inviteMessageId,
        textBody: 'Unit Price: 11500',
      }), BUYER_CONFIG);
      expect(bid1Res.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(comparisonMailSpy).not.toHaveBeenCalled();
      expect(rfqV0.buyerAccountId).toBe(buyerA.id);
      expect(buyerB.corporateEmail).not.toBe(buyerA.corporateEmail);

      // Bid 2 (2 of 2 before 48h): Trigger A fires sendRfqFinalComparisonEmail immediately ONCE to buyerA
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({ unitPrice: 10900, totalPrice: 21800, leadTimeDays: 5 });
      const bid2Res = await emailGatewayService.processMessage(buildRawEml({
        from: v2.email,
        to: 'invitations@procucev.com',
        subject: 'Offer',
        inReplyTo: inv2.inviteMessageId,
        textBody: 'Unit Price: 10900',
      }), BUYER_CONFIG);
      expect(bid2Res.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(comparisonMailSpy).toHaveBeenCalledTimes(1);
      expect(comparisonMailSpy).toHaveBeenCalledWith(
        buyerA.corporateEmail,
        expect.objectContaining({
          rfq: expect.objectContaining({ rfqNumber: rfqV0.rfqNumber }),
          quotes: expect.arrayContaining([
            expect.objectContaining({ vendorId: v1.id }),
            expect.objectContaining({ vendorId: v2.id }),
          ]),
        })
      );
      expect(storeService.getRFQById(rfqV0.id).buyerQuotesSentAt).toBeTruthy();

      // Concurrent / repeated dispatch checks or late revision NEVER duplicate email
      const dupCheck = await Promise.all([
        storeService.checkAndDispatchBuyerQuotations(rfqV0.rfqNumber, { trigger: 'concurrent_1' }),
        storeService.checkAndDispatchBuyerQuotations(rfqV0.rfqNumber, { trigger: 'concurrent_2' }),
      ]);
      expect(dupCheck.every((r) => r.dispatched === false)).toBe(true);
      expect(comparisonMailSpy).toHaveBeenCalledTimes(1);

      // Late bid after buyerQuotesSentAt is saved strictly under buyerA's RFQ without duplicating email
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValueOnce({ unitPrice: 10500, totalPrice: 21000, leadTimeDays: 4 });
      const lateBidRes = await emailGatewayService.processMessage(buildRawEml({
        from: v1.email,
        to: 'invitations@procucev.com',
        subject: 'Revised Offer',
        inReplyTo: inv1.inviteMessageId,
        textBody: 'Revised Unit Price: 10500',
      }), BUYER_CONFIG);
      expect(lateBidRes.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(storeService.getRFQById(rfqV0.id).quotes.find((q) => q.vendorId === v1.id)?.unitPrice).toBe(10500);
      expect(comparisonMailSpy).toHaveBeenCalledTimes(1);
    });

    test('Dual-Trigger V0 Buyer Dispatch Trigger B (48h timeout with partial bids) + DB atomic claim lock + concurrent scheduler', async () => {
      const buyer = storeService.addBuyerAccount({
        id: 'buyer-timeout-v0',
        corporateEmail: 'timeout.buyer@corp.in',
        organizationName: 'Timeout Corp',
      });
      const v1 = storeService.addVendor({ id: 'vt-1', name: 'V Timeout 1', email: 'vt1@supplier.in', status: 'VERIFIED SUPPLIER' });
      const v2 = storeService.addVendor({ id: 'vt-2', name: 'V Timeout 2', email: 'vt2@supplier.in', status: 'VERIFIED SUPPLIER' });

      const past49h = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
      const past1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const rfqPartial = {
        id: 'rfq-v0-timeout-1',
        rfqNumber: 'RFQ262511200002',
        title: 'Control Panel',
        sourcingMode: 'mode_0',
        status: 'Quotes Received',
        buyerAccountId: buyer.id,
        buyerAccountName: buyer.organizationName,
        buyerEmail: buyer.corporateEmail,
        assignedVendors: [
          { id: v1.id, name: v1.name, email: v1.email },
          { id: v2.id, name: v2.name, email: v2.email },
        ],
        quotes: [{ id: 'q-partial-1', vendorId: v1.id, vendorName: v1.name, unitPrice: 8000, leadTimeDays: 10 }],
        createdAt: past49h,
        quotesDispatchDueAt: past1h,
      };
      storeService.rfqs.push(rfqPartial);

      const comparisonSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });

      // Simulate concurrent scheduler invocations via Promise.all
      const [run1, run2] = await Promise.all([
        rfqChaserScheduler.dispatchDueV0BuyerQuotationJobs(25),
        rfqChaserScheduler.dispatchDueV0BuyerQuotationJobs(25),
      ]);
      expect(run1.dispatched + run2.dispatched).toBe(1);
      expect(comparisonSpy).toHaveBeenCalledTimes(1);
      expect(comparisonSpy).toHaveBeenCalledWith(
        'timeout.buyer@corp.in',
        expect.objectContaining({
          rfq: expect.objectContaining({ rfqNumber: 'RFQ262511200002' }),
        })
      );

      // Verify DB-backed atomic claim path too
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const dbRfq = {
        ...rfqPartial,
        rfqNumber: 'RFQ262511200003',
        buyerQuotesSentAt: null,
      };
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValue(dbRfq);
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(buyer);
      let claimedOnce = false;
      jest.spyOn(domainQueries, 'claimRfqBuyerQuotesDispatchInDB').mockImplementation(async (rfqNum, sentAt) => {
        if (claimedOnce) return null;
        claimedOnce = true;
        return { ...dbRfq, buyerQuotesSentAt: sentAt };
      });
      const dbRuns = await Promise.all([
        storeService.checkAndDispatchBuyerQuotations('RFQ262511200003', { trigger: 'concurrent_a' }),
        storeService.checkAndDispatchBuyerQuotations('RFQ262511200003', { trigger: 'concurrent_b' }),
      ]);
      expect(dbRuns.filter((r) => r.dispatched)).toHaveLength(1);
      expect(comparisonSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Part 3 End-to-End Smoke Test: Production Incident Reproduction', () => {
    test('dhairya@dhairyaengineering.co.in replying to invitations@procucev.com with Subject "Offer" and Quote 25/11/2026 creates 0 buyers, 0 RFQs, 0 onboarding emails, and links bid to original RFQ buyer', async () => {
      const originalBuyer = storeService.addBuyerAccount({
        id: 'buyer-govardhan',
        corporateEmail: 'govardhan@clientcorp.in',
        organizationName: 'Client Corp',
        status: 'ACTIVE_VERIFIED',
      });
      const dhairyaVendor = {
        id: 'v-dhairya-eng',
        name: 'Dhairya Engineering',
        email: 'dhairya@dhairyaengineering.co.in',
        corporateEmail: 'dhairya@dhairyaengineering.co.in',
        status: 'VERIFIED SUPPLIER',
        freeQuotationCredits: 5,
      };
      storeService.vendors.push(dhairyaVendor);

      const originalRfq = {
        id: 'rfq-orig-mitsubishi',
        rfqNumber: 'RFQ262511000555',
        title: 'Mitsubishi VFD FR-E720-0.2K',
        category: 'Electrical & Electronics',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        buyerAccountId: originalBuyer.id,
        buyerAccountName: originalBuyer.organizationName,
        buyerEmail: originalBuyer.corporateEmail,
        extractedEntities: [{ itemName: 'Mitsubishi FR-E720-0.2K', quantity: 1, unit: 'Nos' }],
        assignedVendors: [{ id: dhairyaVendor.id, name: dhairyaVendor.name, email: dhairyaVendor.email }],
        quotes: [],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(originalRfq);
      const invite = storeService.recordRfqVendorInvite(originalRfq, {
        vendorId: dhairyaVendor.id,
        vendorEmail: dhairyaVendor.email,
      });

      const insertBuyerSpy = jest.spyOn(identityQueries, 'insertBuyerAccount');
      const addBuyerSpy = jest.spyOn(storeService, 'addBuyerAccount');
      const createRfqSpy = jest.spyOn(storeService, 'createRFQ');
      const onboardingEmailSpy = jest.spyOn(mailerService, 'sendBuyerOnboardingWithRfqEmail');
      const comparisonEmailSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValue({ sent: true });
      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });

      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValue({
        unitPrice: 12800,
        totalPrice: 12800,
        leadTimeDays: 14,
        warrantyYears: 1,
        paymentTerms: 'GST + FREIGHT EXTRA',
        remarks: 'Mitsubishi FR-E720-0.2K',
      });

      const productionIncidentEml = buildRawEml({
        from: 'Bhoomika Makwana <dhairya@dhairyaengineering.co.in>',
        to: 'invitations <invitations@procucev.com>',
        cc: 'marketing <marketing@dhairyaengineering.co.in>, info@dhairyaengineering.co.in, sales01dhairyaengineering@zohomail.in',
        subject: 'Offer',
        inReplyTo: invite.inviteMessageId,
        htmlBody: `
          <p>Dear Sir,<br/>Please find the Offer below for your ready reference</p>
          <table>
            <tr><th colspan="3">Quote 25/11/2026</th></tr>
            <tr><td colspan="3">Govardhan</td></tr>
            <tr><th>SN.</th><th>MAKE</th><th>MODEL NO.</th></tr>
            <tr><td>1</td><td>Mitsubishi</td><td>FR-E720-0.2K</td></tr>
            <tr><td colspan="3">GST + FREIGHT EXTRA &nbsp; DELIVERY TIME - 2 to 3 weeks</td></tr>
          </table>
          <p>Please free feel to call any doubt or query .</p>
        `,
      });

      const vendorConfig = emailGatewayService.resolveVendorConfig({
        VENDOR_EMAIL_GATEWAY_ENABLED: 'true',
        VENDOR_EMAIL_GATEWAY_USER: 'invitations@procucev.com',
        VENDOR_EMAIL_GATEWAY_ADDRESS: 'invitations@procucev.com',
        EMAIL_GATEWAY_AUTO_REGISTER: 'true',
      });

      const outcome = await emailGatewayService.processMessage(productionIncidentEml, vendorConfig);

      expect(outcome.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
      expect(insertBuyerSpy).not.toHaveBeenCalled();
      expect(addBuyerSpy).not.toHaveBeenCalled();
      expect(createRfqSpy).not.toHaveBeenCalled();
      expect(onboardingEmailSpy).not.toHaveBeenCalled();
      expect(storeService.buyerAccounts).toHaveLength(1);
      expect(storeService.rfqs).toHaveLength(1);

      const updatedOriginalRfq = storeService.getRFQById(originalRfq.id);
      expect(updatedOriginalRfq.quotes).toHaveLength(1);
      expect(updatedOriginalRfq.quotes[0]).toMatchObject({
        vendorId: dhairyaVendor.id,
        unitPrice: 12800,
      });
      expect(comparisonEmailSpy).toHaveBeenCalledTimes(1);
      expect(comparisonEmailSpy).toHaveBeenCalledWith(
        originalBuyer.corporateEmail,
        expect.objectContaining({
          rfq: expect.objectContaining({
            rfqNumber: originalRfq.rfqNumber,
            buyerAccountId: originalBuyer.id,
          }),
        })
      );
    });
  });

  describe('Part 4: Branch & Edge Case Coverage for Mailbox Helpers, Invites & V0 Dispatch Rollback', () => {
    test('emailIngestion.extractHeaderAddresses parses string, array, object, and missing headers cleanly', () => {
      expect(emailIngestionService.extractHeaderAddresses(null, 'delivered-to')).toEqual([]);
      const headers = new Map([
        ['delivered-to', [
          'Alias <INVITATIONS@procucev.com>',
          { text: 'rfq@procucev.com; invitations@procucev.com' },
          { address: 'gmtrfq@procucev.com' },
          { value: [{ address: 'team@procucev.com' }, null] },
          12345,
        ]],
      ]);
      expect(emailIngestionService.extractHeaderAddresses(headers, 'x-missing')).toEqual([]);
      expect(emailIngestionService.extractHeaderAddresses(headers, 'delivered-to')).toEqual([
        'invitations@procucev.com',
        'rfq@procucev.com',
        'gmtrfq@procucev.com',
        'team@procucev.com',
      ]);
    });

    test('isStrictBuyerRfqMailbox & Hole 1 invalid-RFQ vendor guard cover all recipient/header shapes', async () => {
      expect(emailGatewayService.isStrictBuyerRfqMailbox(null, BUYER_CONFIG)).toBe(false);
      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        to: 'Intake <RFQ@procucev.com>, other@example.com',
      }, BUYER_CONFIG)).toBe(true);
      expect(emailGatewayService.isStrictBuyerRfqMailbox({
        to: [{ address: 'rfq@procucev.com' }],
        headers: { 'x-original-to': 'gmtrfq@procucev.com' },
      }, BUYER_CONFIG)).toBe(false);

      storeService.addVendor({
        id: 'v-hole1-invalid',
        name: 'Hole1 Vendor',
        email: 'hole1vendor@supplier.in',
        status: 'VERIFIED SUPPLIER',
      });
      const eml = buildRawEml({
        from: 'hole1vendor@supplier.in',
        to: 'rfq@procucev.com',
        subject: 'Re: RFQ999999999999 Offer',
        textBody: 'Unit Price 5000',
      });
      const res = await emailGatewayService.processMessage(eml, BUYER_CONFIG);
      expect(res.status).toBe(INGESTION_OUTCOME.INVALID_RFQ);
      expect(storeService.buyerAccounts).toHaveLength(0);
    });

    test('processVendorQuoteMessage tolerates checkAndDispatchBuyerQuotations rejection and still ingests quote', async () => {
      const buyer = storeService.addBuyerAccount({
        id: 'buyer-catch-v0',
        corporateEmail: 'catchbuyer@corp.in',
        organizationName: 'Catch Corp',
      });
      const vendor = storeService.addVendor({
        id: 'v-catch-1',
        name: 'Catch Vendor',
        email: 'catchv@supplier.in',
        status: 'VERIFIED SUPPLIER',
        freeQuotationCredits: 5,
      });
      const rfq = {
        id: 'rfq-v0-catch',
        rfqNumber: 'RFQ262511333444',
        title: 'Catch Valves',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        buyerAccountId: buyer.id,
        buyerEmail: buyer.corporateEmail,
        assignedVendors: [{ id: vendor.id, name: vendor.name, email: vendor.email }],
        quotes: [],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(rfq);
      const inv = storeService.recordRfqVendorInvite(rfq, { vendorId: vendor.id, vendorEmail: vendor.email });
      jest.spyOn(mailerService, 'sendQuoteAcknowledgementEmail').mockResolvedValue({ sent: true });
      jest.spyOn(geminiService, 'extractQuotationFromEmail').mockResolvedValue({ unitPrice: 2500, totalPrice: 2500 });
      jest.spyOn(storeService, 'checkAndDispatchBuyerQuotations').mockRejectedValueOnce(new Error('dispatch boom'));

      const out = await emailGatewayService.processMessage(buildRawEml({
        from: vendor.email,
        to: 'invitations@procucev.com',
        subject: 'Offer',
        inReplyTo: inv.inviteMessageId,
        textBody: 'Unit price 2500',
      }), BUYER_CONFIG);
      expect(out.status).toBe(INGESTION_OUTCOME.QUOTE_INGESTED);
    });

    test('storeService invite helpers, DB window lookup, isVendorInvitedToRfq, and rollback branches', async () => {
      expect(storeService.recordRfqVendorInvite(null, {})).toBeNull();
      expect(storeService.recordRfqVendorInvites(null, [])).toEqual([]);
      expect(storeService.findVendorInviteByMessageId(null)).toBeNull();
      expect(storeService.findVendorInviteByMessageId(['  '])).toBeNull();
      expect(await storeService.isVendorInvitedToRfq(null, null)).toBe(false);

      const rfq = {
        id: 'rfq-helper-1',
        rfqNumber: 'RFQ262511555666',
        sourcingMode: 'mode_0',
        status: 'Quotes Pending',
        assignedVendors: [{ id: 'v-help-1', email: 'vhelp1@sup.in' }],
        quotes: [],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(rfq);

      // In-memory 48h window fallback via assignedVendors (even without _rfqVendorInvites entry)
      const fallbackInvites = await storeService.getOpenVendorInvitesWithinWindow(
        { id: 'v-help-1', email: 'vhelp1@sup.in' },
        'vhelp1@sup.in'
      );
      expect(fallbackInvites).toHaveLength(1);
      expect(fallbackInvites[0].rfqNumber).toBe(rfq.rfqNumber);

      // Unlocked RFQ access grants invite permission
      expect(await storeService.isVendorInvitedToRfq(
        { ...rfq, assignedVendors: [{ id: 'other-v', email: 'other@sup.in' }] },
        { id: 'v-unlocked', email: 'un@sup.in', unlockedRfqIds: [rfq.id] },
        'un@sup.in'
      )).toBe(true);

      // DB storage branches for recordRfqVendorInvite, recordRfqVendorInvites, getOpenVendorInvitesWithinWindow, isVendorInvitedToRfq
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const recordDbSpy = jest.spyOn(domainQueries, 'recordRfqVendorInviteInDB').mockResolvedValue({ ok: true });
      const recordedBatch = storeService.recordRfqVendorInvites(rfq, [
        null,
        { email: '' },
        { vendor: { id: 'v-help-1', email: 'vhelp1@sup.in' } },
      ]);
      expect(recordedBatch).toHaveLength(1);
      expect(recordDbSpy).toHaveBeenCalledTimes(1);

      jest.spyOn(domainQueries, 'findOpenVendorInvitesWithinWindowFromDB').mockResolvedValueOnce([
        { rfq_id: 'rfq-db-1', rfq_number: 'RFQ262511777888', vendor_id: 'v-help-1', vendor_email: 'vhelp1@sup.in' },
      ]);
      const dbOpen = await storeService.getOpenVendorInvitesWithinWindow({ id: 'v-help-1' }, 'vhelp1@sup.in');
      expect(dbOpen.some((x) => x.rfqNumber === 'RFQ262511777888')).toBe(true);

      jest.spyOn(domainQueries, 'findOpenVendorInvitesWithinWindowFromDB').mockRejectedValueOnce(new Error('db read fail'));
      await expect(storeService.getOpenVendorInvitesWithinWindow({ id: 'v-help-1' }, 'vhelp1@sup.in')).resolves.toBeInstanceOf(Array);

      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValueOnce([
        { vendor_id: 'v-db-inv', vendor_email: 'dbinv@sup.in' },
      ]);
      expect(await storeService.isVendorInvitedToRfq(
        { id: 'rfq-db-inv', rfqNumber: 'RFQ262511888999', assignedVendors: [] },
        { id: 'v-db-inv', email: 'dbinv@sup.in' },
        'dbinv@sup.in'
      )).toBe(true);

      // checkAndDispatchBuyerQuotations validation & rollback branches
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await storeService.checkAndDispatchBuyerQuotations('')).toEqual({
        dispatched: false,
        reason: 'missing_rfq_number',
      });
      expect(await storeService.checkAndDispatchBuyerQuotations('RFQ-NONEXISTENT')).toEqual({
        dispatched: false,
        reason: 'not_found',
      });

      const noBuyerRfq = {
        id: 'rfq-nobuyer',
        rfqNumber: 'RFQ262511999111',
        sourcingMode: 'mode_0',
        status: 'Quotes Received',
        assignedVendors: [{ id: 'v-nb', email: 'nb@sup.in' }],
        quotes: [{ vendorId: 'v-nb', unitPrice: 100 }],
        createdAt: new Date().toISOString(),
      };
      storeService.rfqs.push(noBuyerRfq);
      expect(await storeService.checkAndDispatchBuyerQuotations(noBuyerRfq.rfqNumber)).toEqual({
        dispatched: false,
        reason: 'missing_buyer_email',
        rfqNumber: noBuyerRfq.rfqNumber,
      });
      // Claim must have been released so buyerQuotesSentAt is cleared
      expect(storeService.getRFQById(noBuyerRfq.id).buyerQuotesSentAt).toBeUndefined();

      // Delivery rejected + delivery throws release claim
      noBuyerRfq.buyerEmail = 'retrybuyer@corp.in';
      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValueOnce({ sent: false, reason: 'smtp_down' });
      expect(await storeService.checkAndDispatchBuyerQuotations(noBuyerRfq.rfqNumber)).toEqual({
        dispatched: false,
        reason: 'smtp_down',
        rfqNumber: noBuyerRfq.rfqNumber,
      });
      expect(storeService.getRFQById(noBuyerRfq.id).buyerQuotesSentAt).toBeUndefined();

      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockRejectedValueOnce(new Error('provider crash'));
      await expect(storeService.checkAndDispatchBuyerQuotations(noBuyerRfq.rfqNumber)).rejects.toThrow('provider crash');
      expect(storeService.getRFQById(noBuyerRfq.id).buyerQuotesSentAt).toBeUndefined();

      // DB-backed dispatchDueV0BuyerQuotations counts skipped and failed candidates
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'listDueV0RfqsForQuotesDispatchFromDB').mockResolvedValueOnce([
        { rfqNumber: 'RFQ-SKIP' },
        { rfqNumber: 'RFQ-ERR' },
      ]);
      const chkSpy = jest.spyOn(storeService, 'checkAndDispatchBuyerQuotations')
        .mockResolvedValueOnce({ dispatched: false, reason: 'conditions_not_met' })
        .mockRejectedValueOnce(new Error('cron candidate error'));
      const sweep = await storeService.dispatchDueV0BuyerQuotations(10);
      expect(sweep).toEqual({ checked: 2, dispatched: 0, skipped: 1, failed: 1 });
      chkSpy.mockRestore();

      // Already-sent guard & closed RFQ exclusion in getOpenVendorInvitesWithinWindow + DB release on missing buyer email
      storeService.rfqs.push({
        id: 'rfq-closed-win',
        rfqNumber: 'RFQ262511000990',
        status: 'Closed',
        assignedVendors: [{ id: 'v-closed-check', email: 'closedchk@sup.in' }],
        createdAt: new Date().toISOString(),
      });
      expect(await storeService.getOpenVendorInvitesWithinWindow({ id: 'v-closed-check' }, 'closedchk@sup.in')).toEqual([]);

      const sentAlreadyRfq = {
        id: 'rfq-already-sent',
        rfqNumber: 'RFQ262511000991',
        sourcingMode: 'mode_0',
        buyerQuotesSentAt: new Date().toISOString(),
      };
      storeService.rfqs.push(sentAlreadyRfq);
      expect(await storeService.checkAndDispatchBuyerQuotations('RFQ262511000991')).toEqual({
        dispatched: false,
        reason: 'already_sent',
        rfqNumber: 'RFQ262511000991',
      });

      // Name-only & email-only quote matching + DB releaseClaim when buyer email is missing
      const dbMissingBuyerRfq = {
        id: 'rfq-db-nobuyer',
        rfqNumber: 'RFQ262511000992',
        sourcingMode: 'mode_0',
        status: 'Quotes Received',
        buyerAccountId: 'buyer-missing-db',
        followUpData: { vendors: [{ email: 'nameonly@sup.in' }] },
        quotes: [{ vendorEmail: 'nameonly@sup.in', unitPrice: 100 }, { vendorName: 'Unnamed Co', unitPrice: 200 }, null],
        createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
      };
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValueOnce(dbMissingBuyerRfq);
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValueOnce([]);
      jest.spyOn(domainQueries, 'claimRfqBuyerQuotesDispatchInDB').mockResolvedValueOnce({ ...dbMissingBuyerRfq, buyerQuotesSentAt: new Date().toISOString() });
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValueOnce(null);
      const relSpy = jest.spyOn(domainQueries, 'releaseRfqBuyerQuotesDispatchClaimInDB').mockResolvedValueOnce(true);
      expect(await storeService.checkAndDispatchBuyerQuotations('RFQ262511000992')).toEqual({
        dispatched: false,
        reason: 'missing_buyer_email',
        rfqNumber: 'RFQ262511000992',
      });
      expect(relSpy).toHaveBeenCalledWith('RFQ262511000992');
    });

    test('mailerService.buildRfqInviteMessageId & buildRfqInviteEmail handle default/empty inputs', () => {
      const defId = mailerService.buildRfqInviteMessageId();
      expect(defId).toMatch(/^<rfq-UNKNOWN-vvendor-\d+@procucev\.com>$/);
      const badTsId = mailerService.buildRfqInviteMessageId('RFQ/1', 'v 2', 'not-a-number');
      expect(badTsId).toMatch(/^<rfq-RFQ-1-vv-2-\d+@procucev\.com>$/);

      const noRfqMail = mailerService.buildRfqInviteEmail('v@example.com', { rfq: { rfqNumber: '' } });
      expect(noRfqMail.messageId).toBeUndefined();
      const explicitIdMail = mailerService.buildRfqInviteEmail('v@example.com', {
        rfq: { rfqNumber: 'RFQ-EXPLICIT' },
        messageId: '<custom-id@procucev.com>',
      });
      expect(explicitIdMail.messageId).toBe('<custom-id@procucev.com>');
    });

    test('covers storeService V0 invite matching, DB owner resolution, claim conflicts, and due sweep edge cases', async () => {
      // Null / missing rfq & empty invite list
      expect(await storeService.isVendorInvitedToRfq(null, { id: 'v1' })).toBe(false);
      expect(await storeService.isVendorInvitedToRfq({ id: 'rfq-open-all', rfqNumber: 'RFQ-OPEN-ALL' }, { id: 'v1' })).toBe(true);

      // Assigned to another vendor, but matched via _rfqVendorInvites, DB invites, and unlockedRfqIds
      const scopedRfq = {
        id: 'rfq-scoped-branches',
        rfqNumber: 'RFQ262511000995',
        assignedVendors: [{ id: 'v-other', email: 'other@sup.in' }],
      };
      expect(await storeService.isVendorInvitedToRfq(scopedRfq, { id: 'v-unlisted' }, 'nobody@none.in')).toBe(false);
      expect(await storeService.isVendorInvitedToRfq(scopedRfq, { id: 'v-unlocked', unlockedRfqIds: [scopedRfq.id] }, 'u@none.in')).toBe(true);
      expect(await storeService.isVendorInvitedToRfq(scopedRfq, { id: 'v-unlocked-num', unlockedRfqIds: [scopedRfq.rfqNumber] }, 'u@none.in')).toBe(true);

      storeService.recordRfqVendorInvite(scopedRfq, { vendorId: 'v-mem-inv', vendorEmail: 'meminv@memcorp.in' });
      expect(await storeService.isVendorInvitedToRfq(scopedRfq, { id: 'v-mem-inv' }, 'alt@memcorp.in')).toBe(true);

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB').mockResolvedValueOnce([
        { vendor_id: 'v-db-inv', vendor_email: 'dbinv@dbcorp.in' },
      ]);
      expect(await storeService.isVendorInvitedToRfq(scopedRfq, { id: 'v-other-2' }, 'dbinv@dbcorp.in')).toBe(true);

      // checkAndDispatchBuyerQuotations validation & DB claim branches
      expect(await storeService.checkAndDispatchBuyerQuotations('')).toEqual({ dispatched: false, reason: 'missing_rfq_number' });
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValueOnce(null);
      expect(await storeService.checkAndDispatchBuyerQuotations('RFQ-GHOST-999')).toEqual({ dispatched: false, reason: 'not_found' });

      const dbDueRfq = {
        id: 'rfq-db-claimed',
        rfqNumber: 'RFQ262511000996',
        sourcingMode: 'v0',
        status: 'Quotes Received',
        buyerAccountId: 'buyer-db-ext',
        quotes_dispatch_due_at: new Date(Date.now() - 1000).toISOString(),
        quotes: [{ vendorId: 'v-a', unitPrice: 500 }],
      };
      jest.spyOn(domainQueries, 'getRFQByNumberFromDB').mockResolvedValueOnce(dbDueRfq).mockResolvedValueOnce(dbDueRfq);
      jest.spyOn(domainQueries, 'findRfqVendorInvitesByRfqNumberFromDB')
        .mockResolvedValueOnce([{ vendor_id: 'v-a', invited_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() }])
        .mockResolvedValueOnce([{ vendor_id: 'v-a', invited_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() }]);
      jest.spyOn(domainQueries, 'claimRfqBuyerQuotesDispatchInDB')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...dbDueRfq, buyerQuotesSentAt: '2026-11-26T00:00:00.000Z' });
      jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValueOnce({
        id: 'buyer-db-ext',
        corporateEmail: 'dbbuyer@corp.in',
        organizationName: 'DB Corp',
      });
      const mailOk = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockResolvedValueOnce({ sent: true });

      expect(await storeService.checkAndDispatchBuyerQuotations('RFQ262511000996', { now: new Date().toISOString() })).toEqual({
        dispatched: false,
        reason: 'already_claimed',
        rfqNumber: 'RFQ262511000996',
      });
      const dbDispatched = await storeService.checkAndDispatchBuyerQuotations('RFQ262511000996');
      expect(dbDispatched).toMatchObject({
        dispatched: true,
        buyerEmail: 'dbbuyer@corp.in',
        rfqNumber: 'RFQ262511000996',
      });
      expect(mailOk).toHaveBeenCalledWith('dbbuyer@corp.in', expect.objectContaining({ recipientName: 'DB Corp' }));

      // dispatchDueV0BuyerQuotations ignores null/missing rfqNumber rows
      jest.spyOn(domainQueries, 'listDueV0RfqsForQuotesDispatchFromDB').mockResolvedValueOnce([null, { id: 'no-num' }]);
      expect(await storeService.dispatchDueV0BuyerQuotations()).toEqual({ checked: 2, dispatched: 0, skipped: 0, failed: 0 });
    });

    test('covers recordRfqVendorInvites, findVendorInviteByMessageId, and DB/in-memory window branches', async () => {
      expect(storeService.recordRfqVendorInvites(null, [])).toEqual([]);
      expect(storeService.recordRfqVendorInvites({ rfqNumber: 'RFQ-X' }, null)).toEqual([]);

      const invRfq = { id: 'rfq-batch-inv', rfqNumber: 'RFQ262511000997', assignedVendors: [] };
      const recorded = storeService.recordRfqVendorInvites(invRfq, [
        null,
        { vendor: { id: 'v-no-mail', name: 'No Mail' } },
        { vendor: { id: 'v-sub-corp', corporateEmail: 'corp@sub.in' } },
        { recipientEmail: 'recip@only.in', invitedAt: new Date().toISOString() },
      ]);
      expect(recorded).toHaveLength(2);
      expect(invRfq.quotesDispatchDueAt).toBeTruthy();

      expect(storeService.findVendorInviteByMessageId([])).toBeNull();
      expect(storeService.findVendorInviteByMessageId(['   '])).toBeNull();
      expect(storeService.findVendorInviteByMessageId(['<nonexistent@id>'])).toBeNull();

      // DB open-invites path (success + error fallback) and in-memory open RFQ matching
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'findOpenVendorInvitesWithinWindowFromDB').mockResolvedValueOnce([
        null,
        { rfq_id: 'r1', rfq_number: 'RFQ-DB-OPEN-1', vendor_id: 'v-db1', vendor_email: 'db1@corp.in', invite_message_id: '<m1>', invited_at: new Date().toISOString() },
      ]);
      const dbOpen = await storeService.getOpenVendorInvitesWithinWindow({ id: 'v-db1' }, 'db1@corp.in');
      expect(dbOpen.map((r) => r.rfqNumber)).toContain('RFQ-DB-OPEN-1');

      jest.spyOn(domainQueries, 'findOpenVendorInvitesWithinWindowFromDB').mockRejectedValueOnce(new Error('db timeout'));
      storeService.rfqs.push({
        id: 'rfq-mem-due-open',
        rfqNumber: 'RFQ-MEM-DUE-OPEN',
        status: 'Quotes Pending',
        quotesDispatchDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        assignedVendors: [null, { vendorId: 'v-by-id-only' }],
      });
      const fallbackOpen = await storeService.getOpenVendorInvitesWithinWindow({ id: 'v-by-id-only' }, '');
      expect(fallbackOpen.map((r) => r.rfqNumber)).toContain('RFQ-MEM-DUE-OPEN');
    });
  });
});
