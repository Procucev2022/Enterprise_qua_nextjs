const mailerService = require('../src/services/mailerService');
const transactionalEmailTemplates = require('../src/services/transactionalEmailTemplates');
const emailService = require('../src/services/emailService');
const storeService = require('../src/services/storeService');

describe('Conditionally Display Buyer Company Name in Vendor Email Templates', () => {
  const sampleRfq = {
    rfqNumber: 'RFQ262610210914',
    title: 'RFQ for Engineering Spares',
    category: 'Engineering Spares - Mechanical',
    buyerAccountName: 'Veera solutions pvt ltd',
    targetDeliveryDate: '2026-10-31',
    deliveryLocation: 'Hyderabad, Telangana',
    deliveryPincode: '500081',
    budget: 0,
    extractedEntities: [
      { itemName: 'Centrifugal Pump Shaft', quantity: 2, unit: 'Nos' },
      { itemName: 'Mechanical Seal 45mm', quantity: 4, unit: 'Sets' },
    ],
  };

  describe('isBuyerUploadedVendor Classifier Logic (Rule 4: database / assignment logic without email/company hardcoding)', () => {
    test('identifies vendor with addedByBuyerCompany as buyer-uploaded', () => {
      const vendor = { id: 'v-001', name: 'Vendor 1', addedByBuyerCompany: 'Any Random Corp' };
      expect(mailerService.isBuyerUploadedVendor(vendor)).toBe(true);
    });

    test('identifies vendor with buyerAccountId as buyer-uploaded', () => {
      const vendor = { id: 'v-002', name: 'Vendor 2', buyerAccountId: 'ba-999' };
      expect(mailerService.isBuyerUploadedVendor(vendor)).toBe(true);
    });

    test('identifies vendor with buyerId as buyer-uploaded', () => {
      const vendor = { id: 'v-003', name: 'Vendor 3', buyerId: 'b-777' };
      expect(mailerService.isBuyerUploadedVendor(vendor)).toBe(true);
    });

    test('identifies vendor with buyer-uploaded source taxonomies as buyer-uploaded', () => {
      const buyerSources = [
        'buyer_uploaded',
        'vendor_master_ingestion',
        'historical_purchase_dump',
        'buyer_manual',
        'buyer_excel',
        'excel_upload',
        'po_ingestion',
        'client_uploaded',
        'buyer',
      ];
      buyerSources.forEach((source) => {
        expect(mailerService.isBuyerUploadedVendor({ id: 'v-rand', source })).toBe(true);
        expect(mailerService.isBuyerUploadedVendor(null, { vendorSource: source })).toBe(true);
      });
    });

    test('identifies vendor with buyer ID prefixes as buyer-uploaded', () => {
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-buyer-001' })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'vm-custom-12' })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-hist-dump-3' })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-ingest-master' })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-navin-custom' })).toBe(true);
    });

    test('identifies Procucev platform vendors as NOT buyer-uploaded', () => {
      const platformVendors = [
        { id: 'v-plat-01', source: 'procucev_network' },
        { id: 'v-plat-02', source: 'platform' },
        { id: 'v-plat-03', source: 'marketplace' },
        { id: 'v-plat-04', source: 'self_registration' },
        { id: 'v-plat-05', source: 'procucev' },
        { id: 'v-001' },
      ];
      platformVendors.forEach((vendor) => {
        expect(mailerService.isBuyerUploadedVendor(vendor)).toBe(false);
      });
      expect(mailerService.isBuyerUploadedVendor(null, { isBuyerUploaded: false })).toBe(false);
      expect(mailerService.isBuyerUploadedVendor(null, { isProcucevVendor: true })).toBe(false);
      expect(mailerService.isBuyerUploadedVendor(null, {})).toBe(false);
      expect(mailerService.isBuyerUploadedVendor(null, null)).toBe(false);
    });

    test('respects explicit boolean overrides on vendor or context', () => {
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-001', isBuyerUploaded: true })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-buyer-001', isBuyerUploaded: false })).toBe(false);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-001', isProcucevVendor: false })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-buyer-001', isProcucevVendor: true })).toBe(false);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-001' }, { isBuyerUploaded: true })).toBe(true);
      expect(mailerService.isBuyerUploadedVendor({ id: 'v-buyer-001' }, { isBuyerUploaded: false })).toBe(false);
    });
  });

  describe('buildRfqInviteEmail: Vendor Source Conditional Buyer Name Display', () => {
    test('Scenario 1: Buyer-uploaded vendor sees the buyer company name', () => {
      const buyerUploadedVendor = {
        id: 'v-buyer-99',
        name: 'Chandan Enterprises',
        contactPerson: 'chandan',
        email: 'chandan@example.com',
        source: 'buyer_uploaded',
        addedByBuyerCompany: 'Veera solutions pvt ltd',
      };

      const email = mailerService.buildRfqInviteEmail(buyerUploadedVendor.email, {
        rfq: sampleRfq,
        recipientName: buyerUploadedVendor.contactPerson,
        vendor: buyerUploadedVendor,
        isBuyerUploaded: true,
      });

      expect(email.html).toContain('Dear <strong>chandan</strong>');
      expect(email.html).toContain('Greetings from <strong>Procucev!</strong>');
      // Buyer company name MUST be visible
      expect(email.html).toContain('We have a new verified business enquiry from <strong>Veera solutions pvt ltd</strong> that matches your category.');
      // Preserves all other RFQ details, branding, and variables
      expect(email.html).toContain('RFQ262610210914');
      expect(email.html).toContain('Engineering Spares - Mechanical');
      expect(email.html).toContain('Centrifugal Pump Shaft');
      expect(email.html).toContain('Mechanical Seal 45mm');
      expect(email.html).toContain('Hyderabad, Telangana (500081)');
      expect(email.html).toContain('Submit Quotation in 1-Click');
    });

    test('Scenario 2: Procucev platform vendor does NOT see the buyer company name', () => {
      const platformVendor = {
        id: 'v-plat-50',
        name: 'Apex Industrial Spares',
        contactPerson: 'chandan',
        email: 'chandan@example.com',
        source: 'procucev_network',
      };

      const email = mailerService.buildRfqInviteEmail(platformVendor.email, {
        rfq: sampleRfq,
        recipientName: platformVendor.contactPerson,
        vendor: platformVendor,
        isBuyerUploaded: false,
      });

      expect(email.html).toContain('Dear <strong>chandan</strong>');
      expect(email.html).toContain('Greetings from <strong>Procucev!</strong>');
      // Buyer company name MUST be hidden
      expect(email.html).not.toContain('Veera solutions pvt ltd');
      expect(email.html).toContain('We have a new verified business enquiry that matches your category. Please review the details below:');
      // Preserves all other RFQ details, branding, and variables
      expect(email.html).toContain('RFQ262610210914');
      expect(email.html).toContain('Engineering Spares - Mechanical');
      expect(email.html).toContain('Centrifugal Pump Shaft');
      expect(email.html).toContain('Mechanical Seal 45mm');
      expect(email.html).toContain('Hyderabad, Telangana (500081)');
      expect(email.html).toContain('Submit Quotation in 1-Click');
    });

    test('Reminder invitations conditionally display buyer name for buyer-uploaded vendors and hide for platform vendors', () => {
      const reminderBuyerUploaded = mailerService.buildRfqInviteEmail('v@buyer.com', {
        rfq: sampleRfq,
        isReminder: true,
        isBuyerUploaded: true,
      });
      expect(reminderBuyerUploaded.html).toContain('This is a reminder to submit your quotation for the verified business enquiry from <strong>Veera solutions pvt ltd</strong> matching your category.');

      const reminderPlatform = mailerService.buildRfqInviteEmail('v@plat.com', {
        rfq: sampleRfq,
        isReminder: true,
        isBuyerUploaded: false,
      });
      expect(reminderPlatform.html).not.toContain('Veera solutions pvt ltd');
      expect(reminderPlatform.html).toContain('This is a reminder to submit your quotation for the following verified business enquiry matching your category.');
    });

    test('handles fallback when buyerAccountName is missing on RFQ for buyer-uploaded vendor', () => {
      const rfqNoBuyer = { ...sampleRfq, buyerAccountName: null };
      const email = mailerService.buildRfqInviteEmail('v@buyer.com', {
        rfq: rfqNoBuyer,
        isBuyerUploaded: true,
      });
      expect(email.html).toContain('We have a new verified business enquiry from a corporate buyer that matches your category.');
    });
  });

  describe('buildVendorCategoryMismatchEmail: Conditional Buyer Company Name', () => {
    test('displays buyer company name when vendor is buyer-uploaded', () => {
      const email = mailerService.buildVendorCategoryMismatchEmail('v@x.com', {
        rfq: sampleRfq,
        rfqNumber: sampleRfq.rfqNumber,
        rfqTitle: sampleRfq.title,
        buyerAccountName: sampleRfq.buyerAccountName,
        vendorName: 'Supplier Co',
        isBuyerUploaded: true,
      });
      expect(email.html).toContain(`released by <strong>${sampleRfq.buyerAccountName}</strong>`);
    });

    test('hides buyer company name when vendor is a Procucev platform vendor', () => {
      const email = mailerService.buildVendorCategoryMismatchEmail('v@x.com', {
        rfq: sampleRfq,
        rfqNumber: sampleRfq.rfqNumber,
        rfqTitle: sampleRfq.title,
        buyerAccountName: sampleRfq.buyerAccountName,
        vendorName: 'Supplier Co',
        isBuyerUploaded: false,
      });
      expect(email.html).not.toContain(sampleRfq.buyerAccountName);
      expect(email.html).toContain(`You were identified as a potential supplier for RFQ <strong>#${sampleRfq.rfqNumber}</strong> (${sampleRfq.title}).`);
    });
  });

  describe('transactionalEmailTemplates (Emails 3, 4, 12): Conditional Buyer Company Name', () => {
    test('Email 3: displays buyer company only when vendor is buyer-uploaded', () => {
      const buyerUploaded = transactionalEmailTemplates.buildEmail3_NewRfqIntimation({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: true,
      });
      expect(buyerUploaded.html).toContain('Veera solutions pvt ltd');
      expect(buyerUploaded.text).toContain('Buyer: Veera solutions pvt ltd');

      const platformVendor = transactionalEmailTemplates.buildEmail3_NewRfqIntimation({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: false,
        buyer_industry: 'Heavy Industrial',
        buyer_city: 'Hyderabad',
      });
      expect(platformVendor.html).not.toContain('Veera solutions pvt ltd');
      expect(platformVendor.html).toContain('Heavy Industrial company, Hyderabad');
      expect(platformVendor.text).toContain('Buyer: Heavy Industrial company, Hyderabad');
    });

    test('Email 4: displays buyer company only when vendor is buyer-uploaded', () => {
      const buyerUploaded = transactionalEmailTemplates.buildEmail4_NewRfqToQuote({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: true,
      });
      expect(buyerUploaded.html).toContain('Veera solutions pvt ltd');
      expect(buyerUploaded.text).toContain('Buyer: Veera solutions pvt ltd');

      const platformVendor = transactionalEmailTemplates.buildEmail4_NewRfqToQuote({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: false,
        buyer_industry: 'Enterprise Buyer',
        buyer_city: 'Bengaluru',
      });
      expect(platformVendor.html).not.toContain('Veera solutions pvt ltd');
      expect(platformVendor.html).toContain('Enterprise Buyer company, Bengaluru');
      expect(platformVendor.text).toContain('Buyer: Enterprise Buyer company, Bengaluru');
    });

    test('Email 12: displays buyer company only when vendor is buyer-uploaded', () => {
      const buyerUploaded = transactionalEmailTemplates.buildEmail12_RfqRevisedBuyerQuestion({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: true,
        rfq_title: 'Centrifugal Pumps',
      });
      expect(buyerUploaded.html).toContain('<strong>Veera solutions pvt ltd</strong> has updated <strong>Centrifugal Pumps</strong>:');
      expect(buyerUploaded.text).toContain('Veera solutions pvt ltd has updated Centrifugal Pumps:');

      const platformVendor = transactionalEmailTemplates.buildEmail12_RfqRevisedBuyerQuestion({
        buyer_company: 'Veera solutions pvt ltd',
        is_buyer_uploaded: false,
        rfq_title: 'Centrifugal Pumps',
      });
      expect(platformVendor.html).not.toContain('Veera solutions pvt ltd');
      expect(platformVendor.html).toContain('The buyer has updated <strong>Centrifugal Pumps</strong>:');
      expect(platformVendor.text).toContain('The buyer has updated Centrifugal Pumps:');
    });
  });

  describe('emailService.generateStandardRFQEmail: Conditional Buyer Row', () => {
    test('renders Buyer row only when vendor is buyer-uploaded', () => {
      const buyerUploadedVendor = {
        name: 'Supplier Alpha',
        contactPerson: 'Alpha Contact',
        email: 'alpha@example.com',
        addedByBuyerCompany: 'Veera solutions pvt ltd',
      };
      const emailBuyer = emailService.generateStandardRFQEmail(sampleRfq, buyerUploadedVendor);
      expect(emailBuyer.htmlBody).toContain('Buyer:');
      expect(emailBuyer.htmlBody).toContain('Veera solutions pvt ltd');

      const platformVendor = {
        name: 'Supplier Beta',
        contactPerson: 'Beta Contact',
        email: 'beta@example.com',
        source: 'procucev_network',
      };
      const emailPlatform = emailService.generateStandardRFQEmail(sampleRfq, platformVendor);
      expect(emailPlatform.htmlBody).not.toContain('Veera solutions pvt ltd');
    });
  });

  describe('storeService Integration: Vendor In-App Notifications and Email Dispatch', () => {
    test('in-app notification displays buyer name only for buyer-uploaded vendor', () => {
      const buyerUploadedVendor = storeService.addVendor({
        name: 'BU Vendor',
        email: 'bu-notify@example.com',
        majorCategory: 'Engineering Spares - Mechanical',
        addedByBuyerCompany: 'Veera solutions pvt ltd',
      });

      const platformVendor = storeService.addVendor({
        name: 'Platform Vendor',
        email: 'plat-notify@example.com',
        majorCategory: 'Engineering Spares - Mechanical',
        source: 'procucev_network',
      });

      const rfqMode1 = {
        rfqNumber: 'RFQ-TEST-NOTIF-1',
        title: 'Mechanical Spares',
        category: 'Engineering Spares - Mechanical',
        buyerAccountName: 'Veera solutions pvt ltd',
      };

      const buNotifications = storeService.notifyVendorsOfNewRFQ(rfqMode1);
      const buNotif = buNotifications.find((n) => n.recipientId === buyerUploadedVendor.id);
      expect(buNotif).toBeDefined();
      expect(buNotif.message).toContain('Veera solutions pvt ltd raised RFQ-TEST-NOTIF-1');
      expect(buNotif.meta.buyerAccountName).toBe('Veera solutions pvt ltd');

      const rfqMode0 = {
        rfqNumber: 'RFQ-TEST-NOTIF-0',
        title: 'Mechanical Spares',
        category: 'Engineering Spares - Mechanical',
        sourcingMode: 'mode_0',
        buyerAccountName: 'Veera solutions pvt ltd',
      };

      const platNotifications = storeService.notifyVendorsOfNewRFQ(rfqMode0);
      const platNotif = platNotifications.find((n) => n.recipientId === platformVendor.id);
      expect(platNotif).toBeDefined();
      expect(platNotif.message).not.toContain('Veera solutions pvt ltd');
      expect(platNotif.message).toContain('A buyer raised RFQ-TEST-NOTIF-0');
      expect(platNotif.meta.buyerAccountName).toBeNull();
    });
  });
});
