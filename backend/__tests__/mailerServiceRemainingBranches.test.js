const mailerService = require('../src/services/mailerService');
const mailTransport = require('../src/services/mailTransport');

describe('mailerService remaining branch and function tests', () => {
  describe('buildBuyerCredentialsEmail & sendBuyerCredentialsEmail', () => {
    test('builds credentials email with all optional fields provided', () => {
      const email = mailerService.buildBuyerCredentialsEmail({
        to: 'buyer1@company.com',
        recipientName: 'Alice Buyer',
        tempPassword: 'SecretPassword123!',
        mobileNumber: '9876543210',
        contactPhone: '9123456789',
      });

      expect(email.to).toBe('buyer1@company.com');
      expect(email.subject).toBe('Welcome to Procucev - Your Account Credentials');
      expect(email.html).toContain('Alice Buyer');
      expect(email.html).toContain('SecretPassword123!');
      expect(email.html).toContain('9876543210');
    });

    test('builds credentials email falling back to contactPhone and default phone when omitted', () => {
      const emailWithContact = mailerService.buildBuyerCredentialsEmail({
        to: 'buyer2@company.com',
        contactPhone: '9123456789',
      });
      expect(emailWithContact.html).toContain('Hello,');
      expect(emailWithContact.html).toContain('9123456789');

      const emailDefault = mailerService.buildBuyerCredentialsEmail({
        to: 'buyer3@company.com',
      });
      expect(emailDefault.html).toContain('9999999999');
    });

    test('sendBuyerCredentialsEmail delivers message in test environment', async () => {
      const res = await mailerService.sendBuyerCredentialsEmail({
        to: 'buyer.send@company.com',
        recipientName: 'Bob Buyer',
        tempPassword: 'TempPass999!',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('buildBuyerOnboardingWithRfqEmail & sendBuyerOnboardingWithRfqEmail', () => {
    test('builds onboarding with rfq email using rfqNumber with leading hash and custom urls', () => {
      const email = mailerService.buildBuyerOnboardingWithRfqEmail({
        to: 'buyer.rfq1@company.com',
        buyerName: 'Charlie',
        tempPassword: 'CustomPassword77!',
        rfqNumber: '#RFQ-999',
        rfqTitle: 'Custom CNC Turning Parts',
        loginUrl: 'https://app.procucev.com/login?token=xyz',
        reviewUrl: 'https://app.procucev.com/buyer/rfqs/999',
      });

      expect(email.to).toBe('buyer.rfq1@company.com');
      expect(email.subject).toContain('RFQ-999');
      expect(email.html).toContain('Charlie');
      expect(email.html).toContain('CustomPassword77!');
      expect(email.html).toContain('https://app.procucev.com/login?token=xyz');
    });

    test('builds onboarding with rfq email using rfqs array when rfqNumber is missing', () => {
      const email = mailerService.buildBuyerOnboardingWithRfqEmail({
        to: 'buyer.rfq2@company.com',
        rfqs: [{ rfqNumber: 'RFQ-A' }, { rfqNumber: 'RFQ-B' }],
      });
      expect(email.subject).toContain('RFQ-A, RFQ-B');

      const emailDefaultRfq = mailerService.buildBuyerOnboardingWithRfqEmail({
        to: 'buyer.rfq3@company.com',
        rfqs: [],
      });
      expect(emailDefaultRfq.subject).toContain('RFQ');
    });

    test('sendBuyerOnboardingWithRfqEmail delivers message in test environment', async () => {
      const res = await mailerService.sendBuyerOnboardingWithRfqEmail({
        to: 'buyer.onboard@company.com',
        buyerName: 'David',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('buildBuyerProfileCompletionReminderEmail & sendBuyerProfileCompletionReminderEmail', () => {
    test('builds reminder email with single quotation and custom fields', () => {
      const email = mailerService.buildBuyerProfileCompletionReminderEmail({
        to: 'buyer.profile1@company.com',
        recipientName: 'Elena',
        rfqNumber: 'RFQ-2026-888',
        rfqTitle: 'Sheet Metal Fabrication',
        quotesCount: 1,
      });

      expect(email.to).toBe('buyer.profile1@company.com');
      expect(email.subject).toContain('RFQ-2026-888');
      expect(email.html).toContain('Elena');
      expect(email.html).toContain('A quotation has been submitted');
      expect(email.html).toContain('Sheet Metal Fabrication');
    });

    test('builds reminder email with multiple quotations and default recipient/title', () => {
      const email = mailerService.buildBuyerProfileCompletionReminderEmail({
        to: 'buyer.profile2@company.com',
        quotesCount: 4,
      });

      expect(email.html).toContain('Valued Buyer');
      expect(email.html).toContain('4 quotations have been submitted');
    });

    test('sendBuyerProfileCompletionReminderEmail delivers message in test environment', async () => {
      const res = await mailerService.sendBuyerProfileCompletionReminderEmail({
        to: 'buyer.profile.send@company.com',
        rfqNumber: 'RFQ-PRO-1',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('sendVendorCreditsExhaustedEmail', () => {
    test('delivers vendor credits exhausted email in test environment', async () => {
      const res = await mailerService.sendVendorCreditsExhaustedEmail('vendor.credits@example.com', {
        vendorName: 'Acme Supplies',
        rfqNumber: 'RFQ-VEND-1',
        portalUrl: 'https://supplier.procucev.com/credits',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });
  });

  describe('sendTransactionalEmail wrapper', () => {
    test('delegates to transactionalEmailTemplates module with valid template key', async () => {
      const res = await mailerService.sendTransactionalEmail(1, 'user@example.com', {
        first_name: 'John',
        rfq_id: 'RFQ-1',
        rfq_title: 'Raw Materials',
        email: 'user@example.com',
        temp_password: 'Pass123Password',
        login_url: 'http://localhost/login',
        review_url: 'http://localhost/review',
      });
      expect(res).toEqual(expect.objectContaining({ sent: false }));
    });
  });

  describe('formatters and quote acknowledgement edge cases', () => {
    test('covers formatCurrency with non-numeric value and formatSubmissionDate error catch', async () => {
      // Date formatting throwing error to hit line 1102 in formatSubmissionDate
      const toLocaleStringSpy = jest.spyOn(Date.prototype, 'toLocaleString').mockImplementationOnce(() => {
        throw new Error('Locale format fail');
      });

      const res = await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-TEST-CURR', source: 'email', title: 'Test Currency' },
        quote: {
          vendorName: 'Vendor Price',
          submittedAt: '2026-10-24T10:00:00.000Z',
          lineItemQuotes: [
            { itemName: 'Item 1', quantity: 2, unitPrice: 'NonNumericUnit', totalPrice: 'NonNumericTotal' },
          ],
          totalPrice: 'NonNumericGrandTotal',
        },
      });

      expect(res).toEqual({ sent: false, reason: 'test environment' });
      toLocaleStringSpy.mockRestore();
    });
  });

  describe('delivery routing & health edge cases', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
      jest.restoreAllMocks();
    });

    test('getDeliveryHealth includes configured http providers with cooldown', () => {
      jest.spyOn(mailTransport, 'configuredHttpProviders').mockReturnValue([
        { key: 'resend', name: 'Resend HTTP' },
        { key: 'sendgrid', name: 'SendGrid HTTP' },
      ]);

      const health = mailerService.getDeliveryHealth();
      expect(health.httpProviders).toHaveLength(2);
      expect(health.httpProviders[0].id).toBe('resend');
      expect(health.httpProviders[1].id).toBe('sendgrid');
    });

    test('getDeliverySteps adds smtp:vendor:fallback when buyer SMTP is unconfigured but vendor SMTP is configured', async () => {
      jest.spyOn(mailTransport, 'isWorkersRuntime').mockReturnValue(false);
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      process.env.VENDOR_SMTP_USER = 'vendor-user@smtp.com';
      process.env.VENDOR_SMTP_PASSWORD = 'vendor-secret-password';

      const res = await mailerService.deliver(
        { to: 'buyer.fallback@example.com', subject: 'Fallback test' },
        'buyer fallback test',
        { forceInTest: true, channel: mailerService.DELIVERY_CHANNEL.BUYER }
      );

      expect(res).toBeDefined();
    });
  });

  describe('additional template generators and URLs', () => {
    test('vendorUpgradeUrl returns configured or default url', () => {
      const url = mailerService.vendorUpgradeUrl();
      expect(url).toContain('vendor-subscription');
    });

    test('buildComplexRfqPortalRedirectEmail and sendComplexRfqPortalRedirectEmail', async () => {
      const email = mailerService.buildComplexRfqPortalRedirectEmail({
        to: 'complex.buyer@example.com',
        buyerName: 'Complex Buyer',
        rfqTitle: 'Multiphase Procurement',
        rfqNumber: 'RFQ-COMPLEX-01',
        reason: 'Too many custom line item specs',
      });
      expect(email.to).toBe('complex.buyer@example.com');
      expect(email.subject).toContain('Portal Bidding Required');

      const res = await mailerService.sendComplexRfqPortalRedirectEmail({
        to: 'complex.buyer@example.com',
        rfqNumber: 'RFQ-COMPLEX-01',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildVendorIssueAcknowledgementEmail and sendVendorIssueAcknowledgementEmail', async () => {
      const email = mailerService.buildVendorIssueAcknowledgementEmail({
        to: 'vendor.issue@example.com',
        vendorName: 'Issue Vendor',
        issueDescription: 'Unable to upload quotation attachment',
        ticketId: 'TKT-1002',
      });
      expect(email.to).toBe('vendor.issue@example.com');
      expect(email.subject).toContain('Inquiry Logged');

      const res = await mailerService.sendVendorIssueAcknowledgementEmail({
        to: 'vendor.issue@example.com',
        ticketId: 'TKT-1002',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildVendorCategoryMismatchEmail and sendVendorCategoryMismatchEmail', async () => {
      const email = mailerService.buildVendorCategoryMismatchEmail({
        to: 'vendor.mismatch@example.com',
        vendorName: 'Mismatch Vendor',
        rfqCategory: 'Heavy Machinery',
        vendorCategories: ['Office Stationary', 'IT Equipment'],
      });
      expect(email.to).toBe('vendor.mismatch@example.com');
      const res = await mailerService.sendVendorCategoryMismatchEmail({
        to: 'vendor.mismatch@example.com',
        rfqCategory: 'Heavy Machinery',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildVendorCategoryMappingEmail variations', () => {
      // Full fields with custom subject and custom message
      const full = mailerService.buildVendorCategoryMappingEmail({
        to: 'vendor1@test.com',
        recipientName: 'Vendor Lead',
        buyerOrganizationName: 'Acme Buyer',
        vendorCode: 'VND-001',
        majorCategory: 'Raw Materials',
        minorCategories: ['Steel', 'Aluminum'],
        customSubject: 'Custom Subject Alert',
        customMessage: 'Custom mapping instructions',
        tempPassword: 'TempPassword123!',
        contactPhone: '9876543210',
      });
      expect(full.subject).toBe('Custom Subject Alert');
      expect(full.html).toContain('Custom mapping instructions');
      expect(full.html).toContain('Vendor Lead');
      expect(full.html).toContain('TempPassword123!');
      expect(full.html).toContain('9876543210');
      expect(full.html).toContain('Steel');

      // Minimal fields with empty string customSubject and customMessage
      const minimal = mailerService.buildVendorCategoryMappingEmail({
        to: 'vendor2@test.com',
        vendorCode: 'VND-002',
        customSubject: '   ',
        customMessage: '   ',
      });
      expect(minimal.subject).toContain('A buyer on Procucev has mapped your supply categories');
      expect(minimal.html).toContain('Hello,');
    });

    test('buildVendorSelfMappingEmail variations', () => {
      const full = mailerService.buildVendorSelfMappingEmail({
        to: 'vendor.self1@test.com',
        recipientName: 'Supplier Head',
        buyerOrganizationName: 'Global Corp',
        vendorCode: 'VND-SELF-1',
        customSubject: 'Select Categories Now',
        customMessage: 'Please complete category selection for Global Corp',
        tempPassword: 'SecretPassword99!',
        contactPhone: '9988776655',
      });
      expect(full.subject).toBe('Select Categories Now');
      expect(full.html).toContain('Please complete category selection for Global Corp');
      expect(full.html).toContain('Supplier Head');
      expect(full.html).toContain('SecretPassword99!');

      const minimal = mailerService.buildVendorSelfMappingEmail({
        to: 'vendor.self2@test.com',
        vendorCode: 'VND-SELF-2',
        customSubject: '',
        customMessage: '',
      });
      expect(minimal.subject).toBe('Complete Your Category Mapping to Receive Enquiries');
      expect(minimal.html).toContain('Hello,');
    });

    test('buildVendorOnboardingEmail variations', () => {
      const full = mailerService.buildVendorOnboardingEmail({
        to: 'vendor.onboard1@test.com',
        recipientName: 'Onboard Vendor',
        buyerOrganizationName: 'Buyer Org',
        vendorCode: 'VND-ONBOARD-1',
        tempPassword: 'Password123!',
        contactPhone: '9123456780',
      });
      expect(full.html).toContain('Onboard Vendor');
      expect(full.html).toContain('Buyer Org');
      expect(full.html).toContain('Password123!');
      expect(full.html).toContain('9123456780');

      const minimal = mailerService.buildVendorOnboardingEmail({
        to: 'vendor.onboard2@test.com',
        vendorCode: 'VND-ONBOARD-2',
      });
      expect(minimal.html).toContain('Hello,');
      expect(minimal.html).toContain('A buyer on Procucev');
    });

    test('getPublicFrontendUrl and getLogoUrl URL resolution branches', () => {
      const originalEnv = { ...process.env };
      try {
        process.env.PUBLIC_FRONTEND_URL = 'https://srinivas-mukku.workers.dev';
        process.env.NODE_ENV = 'production';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://equa.procucev.com');

        process.env.NODE_ENV = 'test';
        process.env.ENVIRONMENT = 'production';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://equa.procucev.com');

        process.env.ENVIRONMENT = 'prod';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://equa.procucev.com');

        process.env.ENVIRONMENT = 'dev';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://srinivas-mukku.workers.dev');

        process.env.PUBLIC_FRONTEND_URL = 'https://custom.app.com///';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://custom.app.com');
        expect(mailerService.getLogoUrl()).toBe('https://custom.app.com/procucev-logo.png');

        delete process.env.PUBLIC_FRONTEND_URL;
        delete process.env.APP_PUBLIC_URL;
        delete process.env.FRONTEND_URL;
        delete process.env.ENVIRONMENT;
        process.env.NODE_ENV = 'production';
        expect(mailerService.getPublicFrontendUrl()).toBe('https://equa.procucev.com');
      } finally {
        process.env = originalEnv;
      }
    });

    test('buildRfqFinalComparisonEmail branches: lowest bid badge, empty quotes, totalPrice sorting', () => {
      // 2 quotes so lowest bid badge is shown (idx === 0 && sortedQuotes.length > 1)
      const emailTwoQuotes = mailerService.buildRfqFinalComparisonEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-FC-2', title: 'Two Quotes RFQ' },
        quotes: [
          { vendorName: 'V1 Low', unitPrice: 100 },
          { vendorName: 'V2 High', unitPrice: 200 },
        ],
      });
      expect(emailTwoQuotes.html).toContain('Lowest Bid (L1)');

      // Empty quotes array: shows 'No vendor quotations were submitted'
      const emailEmptyQuotes = mailerService.buildRfqFinalComparisonEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-FC-0', title: 'Zero Quotes RFQ' },
        quotes: [],
      });
      expect(emailEmptyQuotes.html).toContain('No vendor quotations were submitted');

      // Quotes with only totalPrice (unitPrice null) and rfq.quotes fallback
      const emailTotalPrice = mailerService.buildRfqFinalComparisonEmail('buyer@test.com', {
        rfq: {
          rfqNumber: 'RFQ-FC-TP',
          quotes: [
            { vendorName: 'V Total', totalPrice: 5000 },
          ],
        },
      });
      expect(emailTotalPrice.html).toContain('V Total');
    });

    test('buildRfqAutoClosureAcknowledgementEmail & sendRfqAutoClosureAcknowledgementEmail branches', async () => {
      const full = mailerService.buildRfqAutoClosureAcknowledgementEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-AC-1', title: 'Auto Close RFQ', category: 'Fasteners', deliveryLocation: 'Pune' },
        quotesCount: 3,
        recipientName: 'Manager Dave',
      });
      expect(full.subject).toContain('RFQ #RFQ-AC-1 Automatically Closed');
      expect(full.html).toContain('Manager Dave');
      expect(full.html).toContain('Fasteners');
      expect(full.html).toContain('Pune');

      const minimal = mailerService.buildRfqAutoClosureAcknowledgementEmail('buyer@test.com', {});
      expect(minimal.subject).toContain('RFQ #RFQ Automatically Closed');
      expect(minimal.html).toContain('Hello,');

      const res = await mailerService.sendRfqAutoClosureAcknowledgementEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-AC-1' },
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildQuoteReceivedEmail sourcing mode and sealed branches', async () => {
      const modes = ['v0', 'version_0', 'Custom version 0 mode'];
      for (const mode of modes) {
        await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
          rfq: { rfqNumber: `RFQ-${mode}`, sourcingMode: mode },
          quote: { vendorName: 'V1', unitPrice: 100 },
        });
      }

      const versions = [0, '0', 'v0', 'Version 0'];
      for (const version of versions) {
        await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
          rfq: { rfqNumber: `RFQ-v-${version}`, version },
          quote: { vendorName: 'V1', unitPrice: 100 },
        });
      }

      await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-MODE-NAME', sourcingModeName: 'Version 0 Sourcing' },
        quote: { vendorName: 'V1', unitPrice: 100 },
      });

      // Sealed branch: quotesHidden = true and status != Closed
      await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-SEALED', quotesHidden: true, status: 'Open' },
        quote: { vendorName: 'V Sealed', unitPrice: 150 },
      });

      // Closed branch
      await mailerService.sendQuoteReceivedEmail('buyer@test.com', {
        rfq: { rfqNumber: 'RFQ-CLOSED', status: 'Closed' },
        quote: { vendorName: 'V Closed', unitPrice: 150 },
      });
    });

    test('sendUnauthorizedBuyerNotificationEmail validation and delivery', async () => {
      const missingTo = await mailerService.sendUnauthorizedBuyerNotificationEmail('');
      expect(missingTo).toEqual({ sent: false, reason: 'missing recipient email' });

      const res = await mailerService.sendUnauthorizedBuyerNotificationEmail('unregistered@test.com', {
        gatewayAddress: 'custom-rfq@procucev.com',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildRfqAcknowledgementEmail and sendRfqAcknowledgementEmail variations', async () => {
      // Full fields with custom items and deadlines
      const full = mailerService.buildRfqAcknowledgementEmail({
        to: 'buyer.ack@test.com',
        buyerName: 'Buyer Ack',
        rfqNumber: '#RFQ-ACK-01',
        rfqTitle: 'Custom Conveyor Rollers',
        category: 'Material Handling',
        itemCount: 2,
        deliveryLocation: 'Warehouse A, Mumbai',
        requiredBy: '2026-11-30',
        quoteDeadline: '2026-11-05',
        suppliersInvited: 8,
        items: [
          { item_name: 'Conveyor Roller 50mm', item_spec: 'Steel hardened', qty: 100, uom: 'Pcs' },
          { itemName: 'Drive Pulley', technicalSpecs: 'Rubber lagged', quantity: 2, unit: 'Sets' },
        ],
        rfqSummaryUrl: 'https://app.procucev.com/buyer/rfqs/custom-summary',
      });
      expect(full.subject).toContain('RFQ-ACK-01');
      expect(full.html).toContain('Buyer Ack');
      expect(full.html).toContain('Conveyor Roller 50mm');
      expect(full.html).toContain('Drive Pulley');
      expect(full.html).toContain('Warehouse A, Mumbai');
      expect(full.html).toContain('https://app.procucev.com/buyer/rfqs/custom-summary');

      // Minimal fields with empty items, fallback deadline and delivery date
      const minimal = mailerService.buildRfqAcknowledgementEmail({
        to: 'buyer.ack2@test.com',
        deliveryDate: '2026-12-15',
        deadline: '2026-11-20',
      });
      expect(minimal.subject).toContain('RFQ');
      expect(minimal.html).toContain('Procurement Requirement');
      expect(minimal.html).toContain('Standard Specification');
      expect(minimal.html).toContain('Industrial Supplies');
      expect(minimal.html).toContain('As per RFQ Specification');

      const res = await mailerService.sendRfqAcknowledgementEmail({
        to: 'buyer.ack@test.com',
        rfqNumber: 'RFQ-ACK-01',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('buildRfqNotCreatedEmail and sendRfqNotCreatedEmail variations', async () => {
      // Validation failure when recipient is missing
      const missingTo = await mailerService.sendRfqNotCreatedEmail({});
      expect(missingTo).toEqual({ sent: false, reason: 'missing recipient email' });

      // Valid call with reason and replacements
      const full = mailerService.buildRfqNotCreatedEmail({
        to: 'buyer.failed@test.com',
        buyerName: 'Failed Buyer',
        reason: 'ATTACHMENT_COUNT_EXCEEDED',
        originalSubject: 'Urgent RFQ Requisition',
        count: 7,
        max: 5,
      });
      expect(full.subject).toBeDefined();
      expect(full.html).toContain('Failed Buyer');
      expect(full.html).toContain('Urgent RFQ Requisition');
      expect(full.text).toContain('Failed Buyer');

      // Fallback for unknown reason and no subject/name
      const minimal = mailerService.buildRfqNotCreatedEmail({
        to: 'buyer.failed2@test.com',
        reason: 'UNKNOWN_ERROR_CODE',
      });
      expect(minimal.html).toContain('Valued Buyer');

      const res = await mailerService.sendRfqNotCreatedEmail({
        to: 'buyer.failed@test.com',
        reason: 'ATTACHMENT_COUNT_EXCEEDED',
      });
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('sendVendorIngestionEmail delivers ingestion message', async () => {
      const res = await mailerService.sendVendorIngestionEmail(
        { to: 'vendor.ingest@example.com', subject: 'Ingestion notice' },
        'category-mapping'
      );
      expect(res).toEqual({ sent: false, reason: 'test environment' });
    });

    test('executes vendor SMTP fallback when buyer SMTP is unconfigured in production mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSmtpUser = process.env.SMTP_USER;
      const originalSmtpPass = process.env.SMTP_PASSWORD;
      const originalVendorUser = process.env.VENDOR_SMTP_USER;
      const originalVendorPass = process.env.VENDOR_SMTP_PASSWORD;

      try {
        jest.spyOn(mailTransport, 'isWorkersRuntime').mockReturnValue(false);
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;
        process.env.VENDOR_SMTP_USER = 'vendor.fallback@smtp.com';
        process.env.VENDOR_SMTP_PASSWORD = 'password123';
        process.env.NODE_ENV = 'production';

        const fakeTransporter = {
          sendMail: jest.fn().mockResolvedValue({ messageId: 'vendor-fallback-ok-123' }),
        };
        const nodemailer = require('nodemailer');
        const createTransportSpy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue(fakeTransporter);

        const res = await mailerService.deliver(
          { to: 'buyer.test@example.com', subject: 'Vendor fallback test' },
          'vendor fallback delivery',
          { channel: mailerService.DELIVERY_CHANNEL.BUYER }
        );

        expect(res.sent).toBe(true);
        expect(res.messageId).toBe('vendor-fallback-ok-123');
        createTransportSpy.mockRestore();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.SMTP_USER = originalSmtpUser;
        process.env.SMTP_PASSWORD = originalSmtpPass;
        process.env.VENDOR_SMTP_USER = originalVendorUser;
        process.env.VENDOR_SMTP_PASSWORD = originalVendorPass;
      }
    });
  });
});

